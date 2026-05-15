import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '@/server/trpc';
import { logActivity } from '@/server/audit';

const settingsSchema = z.object({
  meetingRemindLead1Hours: z.number().int().min(0).max(720),
  meetingRemindLead2Hours: z.number().int().min(0).max(720).nullable(),
  meetingInviteOnCreate: z.boolean(),
  meetingChangeNotify: z.boolean(),
  taskAssignNotify: z.boolean(),
  taskDeadlineLeadHours: z.number().int().min(0).max(720),
  taskOverdueNotify: z.boolean(),
  taskCompleteNotify: z.boolean(),
  voteOpenedNotify: z.boolean(),
  voteClosingLeadHours: z.number().int().min(0).max(720),
  voteClosedNotify: z.boolean(),
  standardStatusNotify: z.boolean(),
  commentMentionNotify: z.boolean(),
  documentUploadNotify: z.boolean(),
  channelEmail: z.boolean(),
  channelInApp: z.boolean(),
});

export const adminRouter = createTRPCRouter({
  // ── getSettings (any authenticated user can read — needed by user prefs page) ──
  getSettings: protectedProcedure.query(async ({ ctx }) => {
    const existing = await ctx.db.systemSettings.findUnique({ where: { id: 1 } });
    return existing ?? (await ctx.db.systemSettings.create({ data: { id: 1 } }));
  }),

  // ── updateSettings (ADMIN only) ──
  updateSettings: protectedProcedure.input(settingsSchema).mutation(async ({ ctx, input }) => {
    if (ctx.session.user.globalRole !== 'ADMIN') {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }
    const before = await ctx.db.systemSettings.findUnique({ where: { id: 1 } });
    const updated = await ctx.db.systemSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...input },
      update: input,
    });
    await logActivity(ctx.db, {
      userId: ctx.session.user.id,
      action: 'UPDATE',
      entity: 'SystemSettings',
      entityId: '1',
      before: before ?? {},
      after: updated,
    });
    return updated;
  }),
});
