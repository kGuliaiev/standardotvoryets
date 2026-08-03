import { PrismaClient } from '@prisma/client';

/**
 * One-off bulk copy of СТД-100-200-001's tasks + subtasks into every
 * other standard on prod. Dates are rebased against the target's
 * stage plan (nearest-source-stage → same day-offset from target's
 * matching stage). Assignees are dropped.
 *
 * Run: DATABASE_URL=<prod> pnpm exec tsx scripts/bulk-copy-tasks-from-template.ts
 *
 * Idempotent: standards that already have any task are skipped.
 * Marks the template standard's isTaskTemplate=true along the way so
 * the "Створити з шаблону" flow finds it in the UI afterwards.
 */

const db = new PrismaClient();

// Program-plan stage keys — same order/names as the server's
// task.copyFromTemplate mutation.
type StageKey = 'techSpec' | 'draft' | 'feedback' | 'techReview' | 'final';
const STAGE_FIELDS: Record<StageKey, string> = {
  techSpec: 'techSpecDueDate',
  draft: 'draftDueDate',
  feedback: 'feedbackDueDate',
  techReview: 'techReviewDueDate',
  final: 'finalDueDate',
};

function stageDate(s: Record<string, unknown>, k: StageKey): Date | null {
  const v = s[STAGE_FIELDS[k]] as Date | null | undefined;
  return v ? new Date(v) : null;
}

function makeRebase(source: Record<string, unknown>, target: Record<string, unknown>) {
  function nearestStage(due: Date): StageKey | null {
    let bestKey: StageKey | null = null;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const k of Object.keys(STAGE_FIELDS) as StageKey[]) {
      const d = stageDate(source, k);
      if (!d) continue;
      const diff = Math.abs(due.getTime() - d.getTime());
      if (diff < bestDiff) {
        bestKey = k;
        bestDiff = diff;
      }
    }
    return bestKey;
  }
  return function rebase(due: Date | null): Date | null {
    if (!due) return null;
    const k = nearestStage(due);
    if (!k) return due;
    const src = stageDate(source, k);
    const tgt = stageDate(target, k);
    if (!src || !tgt) return null;
    const offsetMs = due.getTime() - src.getTime();
    return new Date(tgt.getTime() + offsetMs);
  };
}

async function main() {
  const TEMPLATE_CODE = 'СТД-100-200-001';

  const template = await db.standard.findFirst({
    where: {
      OR: [{ code: TEMPLATE_CODE }, { indeks: { contains: TEMPLATE_CODE } }],
    },
    include: {
      tasks: {
        include: {
          checklistItems: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!template) {
    throw new Error(`Template standard "${TEMPLATE_CODE}" not found`);
  }
  console.log(
    `[template] ${template.code} — ${template.title}`,
    `\n  tasks: ${template.tasks.length}`,
    `\n  subtasks: ${template.tasks.reduce((s, t) => s + t.checklistItems.length, 0)}`,
  );

  // Mark it as a template so the UI picker shows it.
  if (!template.isTaskTemplate) {
    await db.standard.update({ where: { id: template.id }, data: { isTaskTemplate: true } });
    console.log('  → marked as isTaskTemplate=true');
  }

  // Any user id — used as createdById on cloned tasks (needed FK).
  const admin = await db.user.findFirst({ where: { globalRole: 'ADMIN', isActive: true } });
  if (!admin) throw new Error('No ADMIN user found; needed to attribute cloned tasks');

  const targets = await db.standard.findMany({
    where: {
      id: { not: template.id },
      // Only touch active-status standards; ARCHIVED ones are dormant.
      status: { notIn: ['ARCHIVED'] },
    },
    include: { _count: { select: { tasks: true } } },
    orderBy: { code: 'asc' },
  });

  console.log(`\n[targets] ${targets.length} standard(s)`);

  const summary: {
    copiedTo: { code: string; tasks: number; subtasks: number }[];
    skipped: { code: string; reason: string }[];
  } = { copiedTo: [], skipped: [] };

  for (const t of targets) {
    if (t._count.tasks > 0) {
      summary.skipped.push({
        code: t.code,
        reason: `has ${t._count.tasks} existing task(s)`,
      });
      continue;
    }
    const rebase = makeRebase(template, t);
    let taskCount = 0;
    let subtaskCount = 0;
    await db.$transaction(
      async (tx) => {
        for (const src of template.tasks) {
          const clone = await tx.task.create({
            data: {
              standardId: t.id,
              createdById: admin.id,
              assigneeId: null,
              title: src.title,
              description: src.description,
              priority: src.priority,
              status: 'OPEN',
              dueDate: src.dueDate ? rebase(new Date(src.dueDate)) : null,
            },
          });
          taskCount += 1;
          for (const sub of src.checklistItems) {
            await tx.taskChecklistItem.create({
              data: {
                taskId: clone.id,
                title: sub.title,
                description: sub.description,
                order: sub.order,
                isDone: false,
                dueDate: sub.dueDate ? rebase(new Date(sub.dueDate)) : null,
                assigneeId: null,
              },
            });
            subtaskCount += 1;
          }
        }
      },
      { timeout: 30_000 },
    );
    summary.copiedTo.push({ code: t.code, tasks: taskCount, subtasks: subtaskCount });
    console.log(`  ✓ ${t.code}: +${taskCount} tasks, +${subtaskCount} subtasks`);
  }

  console.log('\n[done]', JSON.stringify(summary, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
