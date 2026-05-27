# Стандартотворець — Continuation Brief

> Живий документ. Прочитай разом із `HANDOFF.md` (статичний знімок) і `docs/DECISIONS.md` (ADR).
> Оновлюй після **кожної значимої віхи** (merge гілки, зміна вектора, перед паузою).
> Companion docs: **`OPS.md`** (runbook: Cloudflare/Railway/деплой/дебаг), **`DESIGN.md`** (UI/UX токени, dark+light, модалки).

---

## ▶ ПОТОЧНИЙ СТАН (оновлювати щоразу)

- **Гілка:** `main`
- **Останній коміт:** `910f5f8` — `docs: note local path + iCloud gotcha (moved out of ~/Documents)`
- **Зараз у роботі:** Part 1 — інфраструктура «вічного контексту» (`QA-tests/`, `HANDOFF.md`, `docs/DECISIONS.md`, цей файл). Далі — security-хотфікс QA-циклу 2026-05-26.
- **Закрито за останній цикл:** редактор тіла документа (#6–#11): дефолт TNR 14pt, актуальний шрифт при виділенні, інлайн-коментарі, тулбар без лагу (`6fb3cfa`, `c60329b`, `f8a4709`, `2f022f9`). Перенос репо з iCloud (`910f5f8`).
- **Останній QA-цикл:** `QA-tests/2026-05-26/` (34 backend / 20 designer / 11 frontend багів). Зведення — `QA-tests/2026-05-26/summary.md`.

### Відкриті задачі (за пріоритетом)

**🔴 P0 — Security hotfix** (гілка `fix/security-hotfix-2026-05-26`): B-1 (workingGroupIds bypass), B-2 (bulkUpdate status RBAC), B-3 (stored XSS у suggestion body → DOMPurify), B-4 (acceptInvite email-mismatch), B-5 (document confirmUpload/list/registerMetadata без RBAC), B-6 (meeting.byId), B-7 (task.byId), B-8 (auth.authorize isActive), B-9 (vote.current мутує без RBAC/ізоляції).

**🔴 P0 — Designer release-blockers** (`fix/qa-designer-2026-05-26`): D-1 (login завжди темна), D-2 (dashboard overdue ≠ /tasks), D-3 (sidebar count рассинхрон), D-4 (filter-active індикатор), D-9 (hex-колір як code-блок).

**🟠 P1 — Frontend HIGH** (`fix/qa-frontend-2026-05-26`): F-1 (tRPC dev-logger у проді), F-2 (Modal focus-trap).

**🟡 P2 — Quick wins** (`fix/qa-polish-2026-05-26`): D-5, D-7, D-10, D-15, D-18, F-3, F-4, F-5, F-6.

**🧪 P2 — Test infra (Part 3):** Vitest setup + 44 unit-кейси (портувати з iCloud-копії), `scripts/qa-smoke.sh`, hard-delete тест-стандарту `cmpoc1qpm0001gb43j0h5nhrm`.

**Backlog (не цей цикл):** B-15…B-34 (state-machine статусів B-16, last-leader guard B-18, транзакції B-20/B-25/B-27, cron-secret query B-28, /api/version leak B-29, CSP, iCal-token model B-32), D-6/D-8/D-11…D-20 (mobile QA окремо), F-7…F-11.

### Відомі блокери та обхідні шляхи

- **iCloud lock:** репо НЕ тримати в `~/Documents`/`~/Desktop` — sync вішає `tsc`/`eslint`/`next build` на `read()` `node_modules`. Перенесено в `~/Private/Claude/standardotvoryets` (2026-05-26). Обхід: працювати з не-синхронізованої копії.
- **Порт-конфлікт з `buildco-platform`:** на машині Kir інфра-порти (3000/5432/6379/9000/9001/1025/8025) бувають зайняті. Обхід: локальний `docker-compose.override.yml` (`ports: !override`, зміщені порти) + `PORT=3001 pnpm dev`. Файл — у `.gitignore`. Деталі в `HANDOFF.md`.
- **Prisma client (pnpm):** генерується в `.pnpm`-стор, не в `node_modules/.prisma/client`. Перед typecheck — `pnpm exec prisma generate`.

### Контекст архітектурних рішень (останні цикли)

Повний журнал — `docs/DECISIONS.md`. Стисло:

- **ADR-0004** `db push` замість міграцій → `--accept-data-loss` на кожному деплої, тільки nullable-додавання без узгодження.
- **ADR-0003** in-process `node-cron`, без зовнішнього планувальника (single-instance).
- **ADR-0002** token-driven theming → заборона hardcoded `bg-white`/`slate-*` (джерело D-1/F-3/F-6).
- **ADR-0001** RBAC 3×5 + DB-override → легко забути `can()` на нових процедурах (джерело класу IDOR-багів B-1/B-5/B-6/B-7/B-9).

### URL / credentials / секрети

**НЕ зберігаються тут.** Контракт ENV — `.env.example`; реальні значення — Railway → Variables. Логіни для QA — у `prisma/seed.ts`. Staging — `§1` нижче.

---

## 0. Локальне середовище (читати перед запуском)

- **Local path:** `~/Private/Claude/standardotvoryets` (macOS case-insensitive — може показуватись як `Private/claude`).
- **⚠️ Ніколи не тримати під iCloud** (`~/Documents`, `~/Desktop`) — sync вішає `tsc`/`eslint`/`next build` на 0% CPU; reboot не допомагає. Перенесено з `~/Documents/Claude/Projects/8 центр/` 2026-05-26.
- **Після свіжого clone:** `pnpm install && pnpm exec prisma generate` ПЕРЕД `pnpm typecheck`/`lint`. `.env` не в git — відновити з Railway → Variables (або `cp .env.example .env`).
- Повні команди запуску/тестів — `HANDOFF.md`.

## 1. Жива система

- **App (staging/prod):** <https://standart.202ok.online/> · Railway-домен: <https://terrific-imagination-production.up.railway.app>
- **Repo:** <https://github.com/kGuliaiev/standardotvoryets> (`main` → Railway auto-deploy)
- **Railway project:** `standart` (id `c19b77cb-0ebb-482b-af9a-febdbe66b8db`)
- **Services:** `Standartotvorets` (Next.js app) · `Postgres` (`${{Postgres.DATABASE_URL}}`) · `arranged-locker` (S3 bucket)
- **Логіни:** `admin@test.ua` (ADMIN) + тестові `<імя>.<прізв>@test.ua` (USER) — паролі в `prisma/seed.ts` (idempotent upsert на кожен старт). Тут не дублюємо.

## 2. Архітектура одним подихом

- **Framework:** Next.js 14 (App Router; `(app)` — auth-зона, `(auth)` — публічна)
- **DB:** PostgreSQL via Prisma (`db push` на старті — без migration-файлів; кастомні індекси — `prisma/indexes.sql`)
- **Auth:** NextAuth Credentials + JWT; сесія = `globalRole` + `memberships[]`
- **API:** tRPC роутери `src/server/routers/*` (16 шт.)
- **Storage:** S3 (`@aws-sdk/client-s3`), presigned URLs у `src/server/s3.ts`
- **RBAC:** `src/lib/rbac.ts` — `can(user, action, workingGroupId)`; ADMIN/DIRECTOR short-circuits; DB-override дефолтів через `RolePermission`
- **Audit:** `ActivityLog` + `src/server/audit.ts` `logActivity()` + `<ActivityFeed>`
- **Черги:** BullMQ + ioredis (`workers/`)
- **Theming:** CSS-змінні в `globals.css` (`--c-*`), `.dark` на `<html>`, токени в `tailwind.config.ts` (`bg-card`/`text-ink`/`text-mid`/`text-light`/`bg-page`/`border-hairline`/`bg-pill`/`bg-brand`)
- **Reusable Modal:** `src/components/ui/Modal.tsx` (Esc-close, scroll-lock, backdrop) — ⚠️ без focus-trap (F-2)

## 3. Як орієнтуватись у коді

- **List-сторінки:** `src/app/(app)/<thing>/page.tsx` — тонкий server-wrapper; код у `<Thing>List.tsx` (client).
- **Detail-сторінки:** `src/app/(app)/<thing>/[id]/page.tsx` тонкий wrapper, код у `<Thing>Detail.tsx`.
- **Edit-модалки:** кожна detail-сторінка рендерить `<Modal>` інлайн; Tasks — спільна `TaskFormModal`.
- **Audit:** будь-яка мутація, що має трекатись → `logActivity(ctx.db, ...)` після write. Перевірка покриття: `pnpm test:audit-coverage`.
- **Нова процедура:** ОБОВ'ЯЗКОВО `can(...)`/membership-перевірка на `byId`/`list`/мутаціях (урок B-1/B-5/B-6/B-7).

## 4. Що зроблено (історія, нове → старе)

Редактор тіла документа (#6–#11), інлайн-коментарі, email+invite flow (`/invite/[token]`, 4 стани), PDF-протокол засідання (кирилиця NotoSans), auto-close голосування, глобальний пошук (Cmd+K), undo (`activityLog.restore`), коментарі (2 рівні), S3-storage, audit-log + `<ActivityFeed>`, light/dark theme, sidebar redesign (`dashboard.navCounts`), dashboard KPI-картки, календар засідань, tasks-сторінка з деревом РГ, edit-модалки, `/standards/new` + `/meetings/new`, stub-сторінки, escape-close модалок. Module coverage scripts: `test:audit-coverage` (41/6/0), `test:modules` (CRUD integration).

## 5. Спільні команди

Див. `HANDOFF.md` (повний список). Деплой = `git push origin main` → Railway білдить. Railway start: `prisma db push --accept-data-loss && prisma:seed && start`.

## 6. Відомі gotchas

- **ESLint `--max-warnings 0`** — навіть один warning блокує Railway build. Часті: unused imports, `||` замість `??`, зайві type-assertions, hardcoded `bg-white`/`slate-*` замість токенів.
- **`bg-slate-*` не перемикається в dark** — тільки токени (`bg-card`/`text-ink`/`text-mid`/`text-light`/`border-hairline`/`bg-page`/`bg-pill`).
- **Prisma JSON columns** (`ActivityLog.before/after/diff`) — `as Prisma.InputJsonValue` лише на самому краю.
- **Lucide icon type** — `LucideIcon` з `lucide-react`, не кастомний `ComponentType<{size}>`.
- **Husky + lint-staged** на коміті може reformat/auto-fix; `[STARTED]/[COMPLETED]` рядки — не помилки.

## 7. Комунікація

Kir віддає перевагу **українській/російській мішанці** в UI (українська для продукту), стислим відповідям, автономному виконанню. Push у `main` дозволено; один коміт на задачу; перед паузою — синхронізуючий `wip:` коміт + оновлення цього файлу + push.

## 8. Регламент роботи (QA fix-cycle)

- Кожен фікс → окремий коміт, conventional message (`fix(security): B-3 sanitize suggestion body with DOMPurify`).
- Кожна гілка → окремий merge у `main` + оновлення `CHANGELOG.md`.
- Після кожного merge → оновити «ПОТОЧНИЙ СТАН» вище (що закрито, що далі).
- Кожні 3–5 комітів / зміна вектора → оновити `HANDOFF.md`, якщо щось фундаментальне.
- Архітектурне рішення → запис у `docs/DECISIONS.md` (окремий коміт).
- Перед паузою/завершенням → `wip: state at <дата>` + оновлення цього файлу + push.
