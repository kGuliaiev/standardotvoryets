import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '@/server/trpc';
import { can } from '@/lib/rbac';
import { seesAllWorkingGroups } from '@/server/permissions';
import { logActivity } from '@/server/audit';
import { s3, getPresignedUploadUrl, getPresignedDownloadUrl } from '@/server/s3';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { env } from '@/lib/env';
import type { DocumentType, GlobalRole, PrismaClient, WorkingGroupRole } from '@prisma/client';

// Types where at most ONE active (= not locked by a closed voting)
// document may exist per standard. Per user spec: "акутальный может
// быть 1 документ в категории DocumentType для STANDARD и TECH_SPEC".
// Locked snapshots of past votings don't count — there can be many of
// those, they're historical evidence pinned to a Voting row.
const ONE_PER_STANDARD_TYPES: ReadonlySet<DocumentType> = new Set<DocumentType>([
  'STANDARD',
  'TECH_SPEC',
]);
const ONE_PER_STANDARD_LABEL: Partial<Record<DocumentType, string>> = {
  STANDARD: 'Стандарт',
  TECH_SPEC: 'ТЗ',
};

// Same set, exposed under a clearer name for the isCurrent-toggle logic:
// the "актуальний" tag is only meaningful for these two types; for
// everything else the server forces isCurrent=false and the UI hides
// the toggle. Many FEEDBACK / AGENDA / ATTACHMENT rows can coexist
// without any of them being "current".
const HAS_CURRENT_FLAG: ReadonlySet<DocumentType> = ONE_PER_STANDARD_TYPES;

async function assertUniqueTypePerStandard(
  db: PrismaClient,
  standardId: string,
  type: DocumentType,
) {
  if (!ONE_PER_STANDARD_TYPES.has(type)) return;
  const existing = await db.document.findFirst({
    // Only UNLOCKED docs count toward the cap — frozen voting snapshots
    // can pile up indefinitely without blocking new editable versions.
    where: { standardId, type, lockedAt: null },
    select: { id: true, filename: true },
  });
  if (existing) {
    const label = ONE_PER_STANDARD_LABEL[type] ?? type;
    throw new TRPCError({
      code: 'CONFLICT',
      message: `На цьому стандарті вже є активний документ типу «${label}» («${existing.filename}»). Видаліть наявний, щоб завантажити новий.`,
    });
  }
}

// Centralised input schema — accepts only the types the UI offers for
// uploads. MEETING_MINUTES is excluded (the Протоколи module owns those
// now); FINAL/DRAFT_STANDARD were dropped from the enum (migrated by
// scripts/pre-db-push.sql). Kept as a const so all four creation paths
// stay in lock-step.
const UPLOADABLE_DOC_TYPES = z.enum(['STANDARD', 'TECH_SPEC', 'FEEDBACK', 'AGENDA', 'ATTACHMENT']);

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
        type: UPLOADABLE_DOC_TYPES,
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
      await assertUniqueTypePerStandard(ctx.db, input.standardId, input.type);

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
        type: UPLOADABLE_DOC_TYPES,
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
      await assertUniqueTypePerStandard(ctx.db, input.standardId, input.type);
      // isCurrent has no meaning for FEEDBACK / AGENDA / ATTACHMENT —
      // coerce false even if the client sent true.
      const wantsCurrent = input.isCurrent && HAS_CURRENT_FLAG.has(input.type);
      if (wantsCurrent) {
        await ctx.db.document.updateMany({
          where: { standardId: input.standardId, type: input.type, isCurrent: true },
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
          isCurrent: wantsCurrent,
        },
      });
    }),

  // ── createEmpty ───────────────────────────────────────────────────────
  // Creates a document with no S3 object and an empty bodyHtml so the
  // user can start writing in the WYSIWYG editor right away. The file
  // can later be exported as .docx via the body-export endpoint.
  createEmpty: protectedProcedure
    .input(
      z.object({
        standardId: z.string().cuid(),
        filename: z.string().min(1).max(255),
        type: UPLOADABLE_DOC_TYPES,
        version: z.string().min(1).max(20).default('v0.1'),
        note: z.string().max(2000).optional(),
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
      await assertUniqueTypePerStandard(ctx.db, input.standardId, input.type);

      const wantsCurrent = input.isCurrent && HAS_CURRENT_FLAG.has(input.type);
      if (wantsCurrent) {
        await ctx.db.document.updateMany({
          where: { standardId: input.standardId, type: input.type, isCurrent: true },
          data: { isCurrent: false },
        });
      }

      // Filename guaranteed to end with .docx so the export endpoint
      // can serve it under the right name.
      const cleanName = input.filename.trim().toLowerCase().endsWith('.docx')
        ? input.filename.trim()
        : `${input.filename.trim()}.docx`;

      const created = await ctx.db.document.create({
        data: {
          standardId: input.standardId,
          uploadedById: ctx.session.user.id,
          type: input.type,
          filename: cleanName,
          s3Key: null,
          sizeBytes: 0,
          version: input.version,
          note: input.note ?? null,
          isCurrent: wantsCurrent,
          allowEdits: true,
          bodyHtml: '',
          bodyUpdatedAt: new Date(),
          bodyUpdatedById: ctx.session.user.id,
        },
      });

      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'CREATE',
        entity: 'Document',
        entityId: created.id,
        after: created,
        note: `Створено порожній документ: ${cleanName}`,
      });

      return created;
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
        type: UPLOADABLE_DOC_TYPES,
        note: z.string().optional(),
        isCurrent: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // RBAC: registering a document against a standard requires upload rights
      // on its WG — confirmUpload had none, so anyone could attach a document
      // to any standard by cuid (B-5). Mirror registerMetadata.
      const standard = await ctx.db.standard.findUniqueOrThrow({
        where: { id: input.standardId },
        select: { workingGroupId: true },
      });
      if (!can(userCtx(ctx.session), 'document:upload', standard.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      await assertUniqueTypePerStandard(ctx.db, input.standardId, input.type);

      const wantsCurrent = input.isCurrent && HAS_CURRENT_FLAG.has(input.type);
      if (wantsCurrent) {
        await ctx.db.document.updateMany({
          where: { standardId: input.standardId, type: input.type, isCurrent: true },
          data: { isCurrent: false },
        });
      }

      const created = await ctx.db.document.create({
        data: {
          standardId: input.standardId,
          uploadedById: ctx.session.user.id,
          type: input.type,
          filename: input.filename,
          s3Key: input.s3Key,
          sizeBytes: input.sizeBytes,
          version: input.version,
          note: input.note,
          isCurrent: wantsCurrent,
        },
      });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'CREATE',
        entity: 'Document',
        entityId: created.id,
        after: created,
        note: `Завантажено документ: ${created.filename}`,
      });
      return created;
    }),

  // ── list ─────────────────────────────────────────────────────────────
  list: protectedProcedure
    .input(z.object({ standardId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      // RBAC: documents belong to a standard's WG. Restrict to members
      // (admins/director/secretaries see all) — list had no check, so anyone
      // could enumerate any standard's documents by cuid (B-5).
      const standard = await ctx.db.standard.findUniqueOrThrow({
        where: { id: input.standardId },
        select: { workingGroupId: true },
      });
      const isMember = ctx.session.user.memberships?.some(
        (m) => m.workingGroupId === standard.workingGroupId,
      );
      if (!seesAllWorkingGroups(ctx.session.user) && !isMember) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
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
      // Visibility matches the WG's other tabs (standards/meetings): admins,
      // the center director and secretaries see all groups; everyone else
      // needs membership. Previously this gated on ADMIN || member only, so a
      // director (not a WG member) got FORBIDDEN and the Документи tab hung on
      // «Завантаження…».
      const isMember = ctx.session.user.memberships?.some(
        (m) => m.workingGroupId === input.workingGroupId,
      );
      if (!seesAllWorkingGroups(ctx.session.user) && !isMember) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

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
        lockedAt: Date | null;
        lockedByVotingId: string | null;
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
        lockedAt: d.lockedAt,
        lockedByVotingId: d.lockedByVotingId,
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

  // ── update (rename / change note / change type) ──────────────────────
  update: protectedProcedure
    .input(
      z.object({
        documentId: z.string().cuid(),
        filename: z.string().min(1).max(300).optional(),
        note: z.string().max(1000).optional().nullable(),
        type: UPLOADABLE_DOC_TYPES.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await ctx.db.document.findUniqueOrThrow({
        where: { id: input.documentId },
        include: { standard: { select: { workingGroupId: true } } },
      });
      if (!can(userCtx(ctx.session), 'document:setCurrent', doc.standard.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      // Locked snapshots are immutable — name carries voting reference
      // (see vote.closeVoting) and must not drift.
      if (doc.lockedAt) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Документ заблоковано — він прикріплений до завершеного голосування',
        });
      }
      const data = {
        filename: input.filename,
        note: input.note,
        type: input.type,
      };
      const updated = await ctx.db.document.update({
        where: { id: input.documentId },
        data,
      });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'UPDATE',
        entity: 'Document',
        entityId: input.documentId,
        before: { filename: doc.filename, note: doc.note, type: doc.type },
        after: data,
      });
      return updated;
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

      // Locked docs are immutable snapshots — they're never "current" again.
      if (doc.lockedAt) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Документ заблоковано після голосування — не може бути актуальним',
        });
      }
      // isCurrent only applies to STANDARD and TECH_SPEC; other types
      // can have multiple coexisting docs without an "actual" tag.
      if (!HAS_CURRENT_FLAG.has(doc.type)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Тег «актуальний» допустимий лише для документів типу Стандарт або ТЗ',
        });
      }

      await ctx.db.document.updateMany({
        where: { standardId: doc.standardId, type: doc.type, isCurrent: true },
        data: { isCurrent: false },
      });

      const updated = await ctx.db.document.update({
        where: { id: input.documentId },
        data: { isCurrent: true },
      });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'UPDATE',
        entity: 'Document',
        entityId: input.documentId,
        before: { isCurrent: doc.isCurrent },
        after: { isCurrent: true },
        note: `Призначено поточною версією: ${doc.filename}`,
      });
      return updated;
    }),

  // ── updateMeta ────────────────────────────────────────────────────────
  // Lets the leader / secretary tweak document card fields after
  // upload — type, version, note, isCurrent, allowEdits. The file
  // itself (s3Key, sizeBytes, filename) stays untouched; re-uploading
  // a new file is a separate flow.
  updateMeta: protectedProcedure
    .input(
      z.object({
        documentId: z.string().cuid(),
        type: UPLOADABLE_DOC_TYPES.optional(),
        version: z.string().min(1).max(50).optional(),
        note: z.string().max(2000).nullable().optional(),
        isCurrent: z.boolean().optional(),
        allowEdits: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await ctx.db.document.findUniqueOrThrow({
        where: { id: input.documentId },
        include: { standard: { select: { workingGroupId: true } } },
      });
      // Same permission as upload — secretary, leader, deputy, admin.
      if (!can(userCtx(ctx.session), 'document:upload', doc.standard.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      if (doc.lockedAt) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Документ заблоковано — голосування його закрило',
        });
      }
      // Coerce isCurrent against the (post-change) document type. The
      // "actual" tag only exists for STANDARD / TECH_SPEC; for anything
      // else we silently drop it server-side rather than 400-ing, since
      // the client may legitimately resend the previous value while
      // changing only `note`.
      const effectiveType = input.type ?? doc.type;
      const wantsCurrent =
        input.isCurrent !== undefined
          ? input.isCurrent && HAS_CURRENT_FLAG.has(effectiveType)
          : undefined;

      // If marking as current, unset any other current of the same type.
      if (wantsCurrent === true && !doc.isCurrent) {
        await ctx.db.document.updateMany({
          where: {
            standardId: doc.standardId,
            type: effectiveType,
            isCurrent: true,
            id: { not: doc.id },
          },
          data: { isCurrent: false },
        });
      }
      const before = {
        type: doc.type,
        version: doc.version,
        note: doc.note,
        isCurrent: doc.isCurrent,
        allowEdits: doc.allowEdits,
      };
      const updated = await ctx.db.document.update({
        where: { id: input.documentId },
        data: {
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.version !== undefined ? { version: input.version } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
          ...(wantsCurrent !== undefined ? { isCurrent: wantsCurrent } : {}),
          ...(input.allowEdits !== undefined ? { allowEdits: input.allowEdits } : {}),
        },
      });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'UPDATE',
        entity: 'Document',
        entityId: input.documentId,
        before,
        after: {
          type: updated.type,
          version: updated.version,
          note: updated.note,
          isCurrent: updated.isCurrent,
          allowEdits: updated.allowEdits,
        },
        note: `Оновлено картку документа: ${updated.filename}`,
      });
      return updated;
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

      // Delete from S3 (best-effort — log + continue if it fails).
      // Documents created empty have no s3Key, skip S3 entirely.
      if (doc.s3Key) {
        try {
          await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: doc.s3Key }));
        } catch (e) {
          console.warn('[document.delete] S3 delete failed (continuing)', e);
        }
      }

      const deleted = await ctx.db.document.delete({ where: { id: input.documentId } });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'DELETE',
        entity: 'Document',
        entityId: input.documentId,
        before: doc,
        note: `Видалено документ: ${doc.filename}`,
      });
      return deleted;
    }),

  // ── getDownloadUrl ────────────────────────────────────────────────────
  getDownloadUrl: protectedProcedure
    .input(z.object({ documentId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const doc = await ctx.db.document.findUniqueOrThrow({
        where: { id: input.documentId },
        include: { standard: { select: { workingGroupId: true } } },
      });

      // Visibility: admins / center director / secretaries see all groups;
      // everyone else needs membership (same rule as the documents list).
      const isMember = ctx.session.user.memberships?.some(
        (m) => m.workingGroupId === doc.standard.workingGroupId,
      );
      if (!seesAllWorkingGroups(ctx.session.user) && !isMember) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      // Documents created empty have no S3 object. Caller should fall
      // through to the body-export endpoint to generate a fresh .docx
      // from bodyHtml. We signal that by returning url=null.
      if (!doc.s3Key) {
        return { url: null, filename: doc.filename, bodyOnly: true } as const;
      }

      const url = await getPresignedDownloadUrl(doc.s3Key);
      return { url, filename: doc.filename, bodyOnly: false } as const;
    }),
});
