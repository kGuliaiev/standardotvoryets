### Companion docs (attach alongside this one for full context)

- **`OPS.md`** — operations runbook: Cloudflare, custom domain, Railway env vars, deploy pipeline, debugging cycle (redirect loops, build failures, auth, S3, cron). Read first when production is misbehaving.
- **`DESIGN.md`** — UI/UX rules: theming tokens, dark+light parity, sidebar, tabs/badges, modals, mobile responsiveness, empty states, forms, polling for live updates. Read first when building any screen.

---

# Стандартотворець — Continuation Brief

This document is the handoff for a new Claude session to pick up the project mid-flight. It captures **what's live**, **what's pending**, and **how to resume work**.

> Attach this file (or its path) at the start of a new chat. The file is committed to the repo root.

---

## 1. Live system

- **App**: <https://terrific-imagination-production.up.railway.app>
- **Repo**: <https://github.com/kGuliaiev/standardotvoryets> (branch `main` → Railway auto-deploys)
- **Railway project**: `standart` (id `c19b77cb-0ebb-482b-af9a-febdbe66b8db`)
- **Services**:
  - `Standartotvorets` (app — Next.js 14, Prisma, tRPC, NextAuth)
  - `Postgres` (DATABASE_URL via `${{Postgres.DATABASE_URL}}`)
  - `arranged-locker` (S3-compatible bucket, Railway-hosted)
- **Admin login**: `admin@test.ua` / `Admin123!` (seeded on every start via `pnpm prisma:seed` — idempotent upserts)
- **Test users**: olena.kovalenko/mykola.petrenko/iryna.savchenko/dmytro.bondarenko/natalia.moroz/vasyl.shevchenko + `@test.ua` — password `User123!`

## 2. Architecture in one breath

- **Framework**: Next.js 14 (App Router, `(app)` group requires auth, `(auth)` group is public)
- **DB**: PostgreSQL via Prisma (`prisma db push` on start — no migration files)
- **Auth**: NextAuth Credentials + JWT, session includes `globalRole` + `memberships[]`
- **API**: tRPC routers in `src/server/routers/*` (user, workingGroup, standard, document, vote, meeting, task, notification, dashboard, activityLog)
- **Storage**: S3 via `@aws-sdk/client-s3`, presigned URLs in `src/server/s3.ts`. Railway bucket uses virtual-hosted-style URLs.
- **RBAC**: `src/lib/rbac.ts` — `can(user, action, workingGroupId)`, plus global `ADMIN` and `DIRECTOR` short-circuits
- **Audit log**: `ActivityLog` model + `src/server/audit.ts` `logActivity()` helper + `<ActivityFeed>` component
- **Theming**: CSS variables in `src/app/globals.css` (`--c-*` tokens), `.dark` class on `<html>`, toggle in Topbar (Sun/Moon)
- **Design system**: tokens in `tailwind.config.ts` (`bg-card`, `text-ink`, `text-mid`, `text-light`, `bg-page`, `border-hairline`, `bg-pill`, `text-navy`, `bg-brand`, `bg-brand-soft`)
- **Reusable Modal**: `src/components/ui/Modal.tsx` (Esc-to-close, body scroll lock, backdrop blur+darken)

## 3. What's done (recent → older)

- **Email + invite flow**: `src/server/email.ts` sends via Resend if `RESEND_API_KEY` is set (no-op otherwise). `user.invite` now emails an invite link to `/invite/[token]`. New `/invite/[token]` page handles four states (not-found / used / expired / email-mismatch) and a one-click "Прийняти".
- **Meeting protocol PDF**: `/api/meetings/[id]/protocol` route renders a Cyrillic-safe PDF (NotoSans) with brand header, meta row, agenda, attendee table, minutes text, footer. "📄 PDF" link in MeetingDetail.
- **Voting auto-close**: `vote.current` query auto-closes any OPEN voting past its deadline on read (no worker required) and transitions standard to ADOPTED/REJECTED.
- **Global search**: `search.global` tRPC procedure + `<GlobalSearch>` Topbar component with Cmd+K, 300ms debounce, dropdown grouped by entity.
- **Undo button**: `activityLog.restore` mutation + button on every reversible log entry; whitelists fields per entity for safety.
- **Audit log expansion**: `logActivity` calls in `task.update/changeStatus`, `workingGroup.update/setArchived`, `user.changeGlobalRole/setActive` (added on top of `standard.update/changeStatus` and `meeting.update/cancel`).
- **Comments**: full router (list / create / update / delete) + threaded UI on Standard "Обговорення" tab; 2-level nesting; author or LEADER/ADMIN can delete; comment creation logs a Standard activity entry.
- **S3 storage**: Railway Bucket service `arranged-locker` connected; `S3_ENDPOINT`/`S3_REGION`/`S3_BUCKET`/`S3_ACCESS_KEY`/`S3_SECRET_KEY` wired via reference variables; `DocumentUploadModal` does real presigned PUT to S3
- **Audit log**: schema + `logActivity` helper + `<ActivityFeed entity="..." entityId="...">`. Wired in `standard.update`, `standard.changeStatus`, `meeting.update`, `meeting.cancel`. Displayed in Standard "Історія" tab and Meeting detail bottom.
- **Documents tab on WG**: `document.byWorkingGroup` returns standard docs + meeting protocols; rendered in `working-groups/[id]` "Документи" tab.
- **Light/Dark theme**: token-driven via CSS vars; toggle button in Topbar; bootstrap script in `src/app/layout.tsx` avoids FOUC.
- **Sidebar redesign**: white sidebar with sectioned nav (ГОЛОВНЕ / ЗАСІДАННЯ / РОБОТА / АДМІН) + live badge counts from new `dashboard.navCounts`.
- **Dashboard redesign**: 4 colored-stripe KPI cards, My tasks widget, upcoming meetings with date tiles, notifications, RG meetings table with colored progress bars.
- **Meetings calendar**: month grid + week + list views, RG legend pills as filters, right rail with monthly RG summary + day detail.
- **Tasks page**: 260px tree (РГ → стандарти with open-task counts) + grouped Відкриті/Виконані lists + filter chips (Всі/Відкриті/Виконані/Мої) + inline "+ Додати завдання" + create/edit modals.
- **Task & Document modals**: `TaskFormModal` (used in Tasks list and StandardDetail tasks tab), `DocumentUploadModal` (used in StandardDetail documents tab).
- **User edit modal** (admin): change global role, list memberships with per-WG role dropdown + remove, "Додати до групи" composer for multi-WG.
- **WG archive (admin)** + **User activate/deactivate** + Standard/Meeting/Task edit modals with form.
- **/standards/new**, **/meetings/new** dedicated form pages.
- **Stub pages** `/protocols`, `/documents`, `/discussions`, `/reports` to prevent 404s from sidebar.
- **CRUD + cache invalidation** on edits — list pages auto-refresh after a detail-screen update.
- **Escape closes all modals** (via `<Modal>` and `useEscape` hook).

## 4. What's still pending (user's outstanding asks)

In priority order, derived from the most recent user messages:

### A. Polish & visual fidelity to `прототип.html`

Working on this iteratively. The current implementations cover Dashboard, Tasks page, calendar, sidebar, but the user wants **every detail** to match:

- Standard card page (`/standards/[id]`): the prototype's right-side green voting panel, members card, document download row layout, voting result bars
- Standards list (`/standards`): the prototype shows mini progress bars in the table, owner avatar+name in the cell, deadline as a plain date with red highlight when overdue
- Meeting detail (`/meetings/[id]`): the modal shown in the prototype with header + agenda block tinted bg + footer split layout
- Working groups list (`/working-groups`): probably needs minor polish to match card style
- Login page: prototype has a 400px white card on navy→blue gradient with brand block — verify

### B. Functional gaps (remaining)

- **Audit log for document/vote mutations**: not yet wired in `document.confirmUpload/delete`, `vote.openVoting/cast/closeVoting`. Same pattern as elsewhere.
- **Meeting reminder emails**: `templateMeetingReminder` exists in `src/server/email.ts` but nothing schedules them. Need a daily cron route `/api/cron/meeting-reminders` that fetches meetings 24h ahead and emails PENDING attendees.
- **Comments**: 2 levels only — if customer wants deeper nesting, relax the parent.parentId check in `comment.create`.

### D. Dark theme iteration

User asked for "iteratively fix to achieve maximum result". The framework is in place but several screens still hardcode `bg-white`, `text-blue-700`, etc. Mass-conversion already done for major pages, but check screenshots in both themes:

- `/login` (auth layout has a navy gradient — fine, but inputs/labels need verifying)
- `/working-groups/[id]` Documents tab table
- Standard detail header card has `bg-card` already but row strip via `bg-page` may be wrong
- Tasks page tree colors — check that selected state has good contrast in dark

### E. Tasks page parity with prototype (final pass)

The current implementation has the tree + grouped lists, but the user attached two screenshots showing exactly how each row should look (priority dot, assignee chip with name fragment, due-date colored chip). Verify against `прототип.html` lines for Tasks screen.

### F-Done. Module coverage tests (2026-05-16)

Two scripts ship in `scripts/`:

- `pnpm test:audit-coverage` — static analysis using ts-morph. Scans every tRPC mutation in `src/server/routers/*.ts` and asserts each contains a `logActivity(` call. Current state: 41 covered, 6 exempt (notification UX + S3 plumbing), 0 uncovered. The exempt list is at the top of `scripts/audit-coverage.ts`. Add to CI so future PRs cannot regress audit coverage.
- `pnpm test:modules` — integration test that walks through full CRUD lifecycles for every domain entity (WorkingGroup, Standard, Task, Meeting, Vote, Comment, User, Admin, Notification, Dashboard, Search, ActivityLog) via `appRouter.createCaller`. For each step it also asserts an ActivityLog row exists. Uses a `TEST_<timestamp>` tag so it isolates and self-cleans. **Requires a reachable DB** at `DATABASE_URL` — run only against dev/test DBs.

### G. Future backlog (recorded 2026-05-16)

- **Mobile version** — adaptive layout for phones/tablets: hamburger menu instead of fixed 228px sidebar; vertical-stack tables; touch-friendly tap targets (44px); responsive Modal that becomes a bottom-sheet on <768px. Likely a 2-3 week separate effort.
- **Bug-found-to-task flow** — when QA / users find a bug they should be able to file it inline (button "Повідомити про помилку") that opens a TaskFormModal pre-filled with screenshot + URL + browser info, auto-assigned to admin or a "QA" working group. Saves manual copy-paste between chat and the task tracker.
- **Notification delivery worker** — wired 2026-05-16:
  - `src/server/notify.ts` central dispatcher reads `SystemSettings` + per-user `notifyEmail/notifyInApp` toggles, writes Notification rows and best-effort sends email via Resend.
  - Event-driven calls wired in: `meeting.create/update`, `task.create/update/changeStatus(DONE)`, `vote.openVoting/closeVoting`, `standard.changeStatus`.
  - Cron route `GET /api/cron/notifications?secret=$CRON_SECRET` handles scheduled reminders (meeting lead 1 & 2, task deadline lead, task overdue one-shot, vote closing). Disabled (503) unless `CRON_SECRET` env is set. Dedup via Notification table lookups.
  - **TODO**: configure Railway cron to hit `/api/cron/notifications?secret=…` every hour. Set `CRON_SECRET` in Railway env first.

## 5. How to find your way around

- **List pages**: `src/app/(app)/<thing>/page.tsx` is a thin server wrapper; real code is in `<Thing>List.tsx` (client)
- **Detail pages**: `src/app/(app)/<thing>/[id]/page.tsx` thin wrapper, real code in `<Thing>Detail.tsx`
- **Edit modals**: each detail page renders `<Modal>` inline with form state. Tasks have a shared `TaskFormModal` because it's used from two places.
- **Audit logging**: any mutation that should be tracked needs a `logActivity(ctx.db, ...)` call after the DB write
- **Adding a new screen**: copy a stub (`/protocols/page.tsx`) and replace `ComingSoon` with your client component

## 6. Common commands

```bash
# locally
pnpm install
pnpm prisma generate
pnpm lint
pnpm typecheck
pnpm build

# deploy = git push to main; Railway auto-builds
git add -A && git commit -m "feat: ..." && git push origin main
```

Railway's start command is `pnpm prisma db push --accept-data-loss && pnpm prisma:seed && pnpm start` — schema changes apply automatically, seed re-runs harmlessly.

## 7. Known gotchas

- **ESLint is `--max-warnings 0`** — even one warning blocks Railway build. Common offenders: unused imports, `||` instead of `??`, type assertions that lint marks as unnecessary, hardcoded `bg-white` vs token classes.
- **`bg-slate-*` colors don't auto-switch in dark mode** — must use the token classes (`bg-card`, `text-ink`, `text-mid`, `text-light`, `border-hairline`, `bg-page`, `bg-pill`). Mass-replaced once but new code keeps re-introducing slate-\* — watch for it.
- **Prisma JSON columns** (`ActivityLog.before/after/diff`) need `as Prisma.InputJsonValue` only at the very edge — internally we pass typed objects through `logActivity()`.
- **Tasks page Lucide icon type** — use `LucideIcon` from `lucide-react`, not custom `ComponentType<{ size }>` (strict-mode mismatch on `propTypes.size`).
- **Husky + lint-staged** sometimes runs on commit and may reformat or auto-fix; the `[STARTED] / [COMPLETED]` lines show in commit output and are not failures.

## 8. Communication

The user prefers **Ukrainian/Russian mix** in UI strings (Ukrainian for product), terse responses, and autonomous execution — they explicitly said "автономно проработай и итерациями двигайся". They will dispatch via Claude mobile when they want a fresh ping.
