import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '@/server/trpc';
import { can } from '@/lib/rbac';
import { s3, getPresignedUploadUrl, getPresignedDownloadUrl } from '@/server/s3';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { env } from '@/lib/env';
import type { DocumentType, GlobalRole, WorkingGroupRole } from '@prisma/client';

function userCtx(session: {
  user: { globalRole: string; memberships: { workingGroupId: string; role: string }[] };
}) {
  return {
    globalRole: session.user.globalRole as GlobalRole,
    memberships: session.user.memberships.map((m) => ({
      workingGroupId: m.workingGroupId,
      role: m.role as WorkingGroupRole,
    })),
  };
}

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.text',
];

export const documentRouter = createTRPCRouter({
  // ── getUploadUrl ──────────────────────────────────────────────────────
  getUploadUrl: protectedProcedure
    .input(
      z.object({
        standardId: z.string().cuid(),
        filename: z.string().min(1).max(255),
        contentType: z.string().refine((ct) => ALLOWED_MIME_TYPES.includes(ct), {
          message: 'Дозволені формати: PDF, DOCX, XLSX, ODT',
        }),
        type: z.enum(['DRAFT_STANDARD', 'MEETING_MINUTES', 'AGENDA', 'ATTACHMENT', 'FINAL']),
        version: z.string().min(1).max(20),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const standard = await ctx.db.standard.findUniqueOrThrow({
        where: { id: input.standardId },
        select: { workingGroupId: true },
      });

      if (!can(userCtx(ctx.session), 'document:upload', standard.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      const s3Key = `standards/${input.standardId}/${Date.now()}-${input.filename}`;
      const uploadUrl = await getPresignedUploadUrl(s3Key, input.contentType);

      return { uploadUrl, s3Key };
    }),

  // ── registerMetadata (no S3 — just creates a document record placeholder) ──
  registerMetadata: protectedProcedure
    .input(
      z.object({
        standardId: z.string().cuid(),
        filename: z.string().min(1).max(255),
        sizeBytes: z.number().int().min(0).default(0),
        version: z.string().min(1).max(20),
        type: z.enum(['DRAFT_STANDARD', 'MEETING_MINUTES', 'AGENDA', 'ATTACHMENT', 'FINAL']),
        note: z.string().optional(),
        isCurrent: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const standard = await ctx.db.standard.findUniqueOrThrow({
        where: { id: input.standardId },
        select: { workingGroupId: true },
      });
      if (!can(userCtx(ctx.session), 'document:upload', standard.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      if (input.isCurrent) {
        await ctx.db.document.updateMany({
          where: { standardId: input.standardId, isCurrent: true },
          data: { isCurrent: false },
        });
      }
      return ctx.db.document.create({
        data: {
          standardId: input.standardId,
          uploadedById: ctx.session.user.id,
          type: input.type,
          filename: input.filename,
          s3Key: `pending/${input.standardId}/${Date.now()}-${input.filename}`,
          sizeBytes: input.sizeBytes,
          version: input.version,
          note: input.note,
          isCurrent: input.isCurrent,
        },
      });
    }),

  // ── confirmUpload ─────────────────────────────────────────────────────
  confirmUpload: protectedProcedure
    .input(
      z.object({
        standardId: z.string().cuid(),
        s3Key: z.string(),
        filename: z.string(),
        sizeBytes: z.number().positive(),
        version: z.string(),
        type: z.enum(['DRAFT_STANDARD', 'MEETING_MINUTES', 'AGENDA', 'ATTACHMENT', 'FINAL']),
        note: z.string().optional(),
        isCurrent: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // If setting as current, unset previous current
      if (input.isCurrent) {
        await ctx.db.document.updateMany({
          where: { standardId: input.standardId, isCurrent: true },
          data: { isCurrent: false },
        });
      }

      return ctx.db.document.create({
        data: {
          standardId: input.standardId,
          uploadedById: ctx.session.user.id,
          type: input.type,
          filename: input.filename,
          s3Key: input.s3Key,
          sizeBytes: input.sizeBytes,
          version: input.version,
          note: input.note,
          isCurrent: input.isCurrent,
        },
      });
    }),

  // ── list ─────────────────────────────────────────────────────────────
  list: protectedProcedure
    .input(z.object({ standardId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.document.findMany({
        where: { standardId: input.standardId },
        include: {
          uploadedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    }),

  // ── byWorkingGroup ───────────────────────────────────────────────────
  // Returns standard documents + meeting minutes combined for a WG
  byWorkingGroup: protectedProcedure
    .input(z.object({ workingGroupId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const isAdmin = ctx.session.user.globalRole === 'ADMIN';
      const isMember = ctx.session.user.memberships?.some(
        (m) => m.workingGroupId === input.workingGroupId,
      );
      if (!isAdmin && !isMember) throw new TRPCError({ code: 'FORBIDDEN' });

      const [docs, meetingsWithMinutes] = await Promise.all([
        ctx.db.document.findMany({
          where: { standard: { workingGroupId: input.workingGroupId } },
          include: {
            uploadedBy: { select: { id: true, name: true } },
            standard: { select: { id: true, code: true, title: true } },
          },
          orderBy: { createdAt: 'desc' },
        }),
        ctx.db.meeting.findMany({
          where: {
            workingGroupId: input.workingGroupId,
            minutesText: { not: null },
          },
          select: {
            id: true,
            title: true,
            startAt: true,
            updatedAt: true,
            createdBy: { select: { id: true, name: true } },
          },
          orderBy: { startAt: 'desc' },
        }),
      ]);

      interface DocItem {
        kind: 'document';
        id: string;
        filename: string;
        version: string | null;
        type: DocumentType;
        sizeBytes: number;
        isCurrent: boolean;
        uploadedAt: Date;
        uploadedBy: { id: string; name: string };
        standard: { id: string; code: string; title: string };
      }
      interface ProtocolItem {
        kind: 'protocol';
        id: string;
        meetingTitle: string;
        meetingDate: Date;
        updatedAt: Date;
        uploadedBy: { id: string; name: string };
      }

      const documents: DocItem[] = docs.map((d) => ({
        kind: 'document',
        id: d.id,
        filename: d.filename,
        version: d.version,
        type: d.type,
        sizeBytes: d.sizeBytes,
        isCurrent: d.isCurrent,
        uploadedAt: d.createdAt,
        uploadedBy: d.uploadedBy,
        standard: d.standard,
      }));

      const protocols: ProtocolItem[] = meetingsWithMinutes.map((m) => ({
        kind: 'protocol',
        id: m.id,
        meetingTitle: m.title,
        meetingDate: m.startAt,
        updatedAt: m.updatedAt,
        uploadedBy: m.createdBy,
      }));

      return { documents, protocols };
    }),

  // ── setAsCurrent ──────────────────────────────────────────────────────
  setAsCurrent: protectedProcedure
    .input(z.object({ documentId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await ctx.db.document.findUniqueOrThrow({
        where: { id: input.documentId },
        include: { standard: { select: { workingGroupId: true } } },
      });

      if (!can(userCtx(ctx.session), 'document:setCurrent', doc.standard.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      await ctx.db.document.updateMany({
        where: { standardId: doc.standardId, isCurrent: true },
        data: { isCurrent: false },
      });

      return ctx.db.document.update({
        where: { id: input.documentId },
        data: { isCurrent: true },
      });
    }),

  // ── delete ────────────────────────────────────────────────────────────
  delete: protectedProcedure
    .input(z.object({ documentId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await ctx.db.document.findUniqueOrThrow({
        where: { id: input.documentId },
        include: { standard: { select: { workingGroupId: true } } },
      });

      if (!can(userCtx(ctx.session), 'document:delete', doc.standard.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      // Delete from S3
      await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: doc.s3Key }));

      return ctx.db.document.delete({ where: { id: input.documentId } });
    }),

  // ── getDownloadUrl ────────────────────────────────────────────────────
  getDownloadUrl: protectedProcedure
    .input(z.object({ documentId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const doc = await ctx.db.document.findUniqueOrThrow({
        where: { id: input.documentId },
        include: { standard: { select: { workingGroupId: true } } },
      });

      // Verify ownership / membership
      const isAdmin = ctx.session.user.globalRole === 'ADMIN';
      const isMember = ctx.session.user.memberships?.some(
        (m) => m.workingGroupId === doc.standard.workingGroupId,
      );

      if (!isAdmin && !isMember) throw new TRPCError({ code: 'FORBIDDEN' });

      const url = await getPresignedDownloadUrl(doc.s3Key);
      return { url, filename: doc.filename };
    }),
});
