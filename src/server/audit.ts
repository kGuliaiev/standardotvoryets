import type { Prisma, PrismaClient } from '@prisma/client';

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'STATUS_CHANGE' | 'ARCHIVE' | 'RESTORE';
export type AuditEntity =
  | 'Standard'
  | 'Meeting'
  | 'Task'
  | 'WorkingGroup'
  | 'User'
  | 'Document'
  | 'Vote'
  | 'Comment'
  | 'AgendaItem'
  | 'Attendance'
  | 'Invite'
  | 'Notification'
  | 'SystemSettings'
  | 'StandardSuggestion'
  | 'InlineComment'
  | 'InlineCommentReply'
  | 'RolePermission'
  | 'TaskChecklistItem';

/**
 * Compute a shallow diff between two snapshots. Returns null if no differences.
 */
export function computeDiff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Record<string, { before: unknown; after: unknown }> | null {
  if (!before && !after) return null;
  const keys = new Set([
    ...(before ? Object.keys(before) : []),
    ...(after ? Object.keys(after) : []),
  ]);
  const result: Record<string, { before: unknown; after: unknown }> = {};
  keys.forEach((k) => {
    if (k === 'createdAt' || k === 'updatedAt') return;
    const a = before?.[k];
    const b = after?.[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      result[k] = { before: a, after: b };
    }
  });
  return Object.keys(result).length > 0 ? result : null;
}

export async function logActivity(
  db: PrismaClient | Prisma.TransactionClient,
  params: {
    userId: string;
    action: AuditAction;
    entity: AuditEntity;
    entityId: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    note?: string;
  },
) {
  // Compute a diff whenever we have both snapshots — useful for STATUS_CHANGE,
  // ARCHIVE/RESTORE, etc. too, not just plain UPDATE.
  const diff =
    params.before || params.after ? computeDiff(params.before ?? null, params.after ?? null) : null;

  try {
    await db.activityLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        before: (params.before as Prisma.InputJsonValue) ?? undefined,
        after: (params.after as Prisma.InputJsonValue) ?? undefined,
        diff: (diff as Prisma.InputJsonValue) ?? undefined,
        note: params.note,
      },
    });
  } catch (err) {
    console.error('[audit] failed to log activity', err);
  }
}
