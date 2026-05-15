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

### B. Functional gaps

- **Comments**: prototype has comment threads under standards; `comment` Prisma model exists but **no router, no UI**
- **Voting auto-close**: prototype shows time-based auto-close; backend `vote.openVoting` writes deadline, but no scheduled worker fires `closeVoting` at deadline
- **Email worker**: `workers/index.ts` is empty — Resend or SMTP is not wired; invite emails / meeting reminders / notifications don't send
- **PDF reports**: `@react-pdf/renderer` is in deps; protocol/meeting-minutes PDF export not implemented
- **Global search**: topbar input is decorative — no search across standards/tasks/meetings

### C. Audit log enhancements

- **Undo button**: per user's request — log entries should allow rolling back an UPDATE. Schema stores `before`/`after`, so we need a `restoreSnapshot` mutation that applies `before` to the entity. Be careful with relational data (StandardStatusHistory etc.).
- **Activity log not wired** for: task.update, task.changeStatus, workingGroup.update/setArchived, user.changeGlobalRole/setActive, document.confirmUpload/delete, vote.openVoting/cast/closeVoting. The pattern is `logActivity(ctx.db, { ... })` after the mutation succeeds — copy the existing wiring in `standard.ts` lines 192–204 and `meeting.ts` ~145–160.

### D. Dark theme iteration

User asked for "iteratively fix to achieve maximum result". The framework is in place but several screens still hardcode `bg-white`, `text-blue-700`, etc. Mass-conversion already done for major pages, but check screenshots in both themes:

- `/login` (auth layout has a navy gradient — fine, but inputs/labels need verifying)
- `/working-groups/[id]` Documents tab table
- Standard detail header card has `bg-card` already but row strip via `bg-page` may be wrong
- Tasks page tree colors — check that selected state has good contrast in dark

### E. Tasks page parity with prototype (final pass)

The current implementation has the tree + grouped lists, but the user attached two screenshots showing exactly how each row should look (priority dot, assignee chip with name fragment, due-date colored chip). Verify against `прототип.html` lines for Tasks screen.

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
