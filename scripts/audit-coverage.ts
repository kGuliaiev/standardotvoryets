/**
 * Static-analysis check: every tRPC mutation should write to the audit log.
 *
 * Run: `pnpm tsx scripts/audit-coverage.ts`
 *
 * Scans src/server/routers/*.ts using ts-morph to find every `protectedProcedure
 * .mutation(...)` and reports those that don't contain a `logActivity(` call in
 * their body. The list of allowed exemptions (e.g. internal helpers, read-only
 * counters, getters) is centralised at the top of this file.
 *
 * Exit code 0 = all good; 1 = uncovered mutations found.
 */

import { Project, SyntaxKind } from 'ts-morph';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROUTERS_DIR = path.join(__dirname, '..', 'src', 'server', 'routers');

/**
 * Mutations that don't need an audit log entry — e.g. read-only setters or
 * those covered by the underlying entity's audit elsewhere.
 *
 * Format: `<routerFile>.<procedureName>`
 */
const EXEMPT = new Set<string>([
  // Notification CRUD is per-user UX state, not domain-relevant for audit
  'notification.markRead',
  'notification.markAllRead',
  'notification.markStandardRead',
  'notification.delete',
  'notification.deleteAll',
  // Document upload-URL plumbing — actual creation is `confirmUpload`
  'document.getUploadUrl',
  'document.registerMetadata',
  // ProtocolNumber helper — protected, but trivial counter
  // Suggestion reactions are per-user UX state (LIKE/DISLIKE), not a
  // domain event — the underlying create/accept/reject are audited.
  'suggestion.react',
  // ШІ-генерація чернетки протоколу: не персистить нічого (повертає draft
  // для ручного перегляду). Аудит відбувається при збереженні пунктів
  // через upsertAgendaItem.
  'meeting.generateProtocolDraft',
  // Task checklist per-item ops — trivial per-tick actions (tick/rename/
  // delete a single subtask). checklistAdd IS audited so the appearance
  // of new subtasks is journaled; the follow-up ops would just flood
  // the feed. Full checklist state is derivable from the parent Task's
  // updatedAt + current snapshot.
  'task.checklistToggle',
  'task.checklistUpdate',
  'task.checklistDelete',
  'task.checklistReorder',
]);

interface Finding {
  router: string;
  procedure: string;
  line: number;
}

function main() {
  const project = new Project({
    tsConfigFilePath: path.join(__dirname, '..', 'tsconfig.json'),
    skipAddingFilesFromTsConfig: true,
  });

  const sourceFiles = project.addSourceFilesAtPaths(`${ROUTERS_DIR}/*.ts`);

  const uncovered: Finding[] = [];
  const covered: Finding[] = [];
  const exempted: Finding[] = [];

  for (const sf of sourceFiles) {
    const routerName = path.basename(sf.getFilePath(), '.ts');

    // Find property assignments whose initializer chains include `.mutation(`
    sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment).forEach((prop) => {
      const initializer = prop.getInitializer();
      if (!initializer) return;
      const text = initializer.getText();
      // Match: protectedProcedure[.input(...)].mutation(...)
      if (!/protectedProcedure[\s\S]*\.mutation\(/.test(text)) return;

      const procedureName = prop.getName();
      const fqn = `${routerName}.${procedureName}`;
      const finding: Finding = {
        router: routerName,
        procedure: procedureName,
        line: prop.getStartLineNumber(),
      };
      if (EXEMPT.has(fqn)) {
        exempted.push(finding);
        return;
      }
      if (text.includes('logActivity(')) {
        covered.push(finding);
      } else {
        uncovered.push(finding);
      }
    });
  }

  console.log('═════════ Audit-log coverage report ═════════');
  console.log(`  Covered:   ${covered.length}`);
  console.log(`  Exempt:    ${exempted.length}`);
  console.log(`  Uncovered: ${uncovered.length}\n`);

  if (covered.length > 0) {
    console.log('✓ Covered mutations:');
    for (const f of covered) console.log(`    ${f.router}.${f.procedure}  (line ${f.line})`);
    console.log();
  }
  if (exempted.length > 0) {
    console.log('· Exempted mutations:');
    for (const f of exempted) console.log(`    ${f.router}.${f.procedure}  (line ${f.line})`);
    console.log();
  }
  if (uncovered.length > 0) {
    console.log('✗ Uncovered mutations (missing logActivity):');
    for (const f of uncovered) console.log(`    ${f.router}.${f.procedure}  (line ${f.line})`);
    console.log();
    console.error(
      `FAIL — ${uncovered.length} mutation(s) without audit log. Add logActivity(...) or add to EXEMPT.`,
    );
    process.exit(1);
  }

  console.log('OK — all mutations are audit-logged.');
}

main();
