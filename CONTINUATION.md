# Стандартотворець — Continuation Brief

> Живий документ. Прочитай разом із `HANDOFF.md` (статичний знімок) і `docs/DECISIONS.md` (ADR).
> Оновлюй після **кожної значимої віхи** (merge гілки, зміна вектора, перед паузою).
> Companion docs: **`OPS.md`** (runbook: Cloudflare/Railway/деплой/дебаг), **`DESIGN.md`** (UI/UX токени, dark+light, модалки).

---

## ▶ ПОТОЧНИЙ СТАН (оновлювати щоразу)

- **Гілка:** `main`
- **Останній коміт:** `8ca4bbb` — `fix(standard): IN_REVIEW gate keys off STANDARD doc, not TECH_SPEC`.
- **Активний цикл:** voting + document lifecycle (рефакторинг типів документів + lock-on-close + clone-on-reject). Завершено: 5-пункт UX-пакет (TZ gate refined → STANDARD gate, auto-edit on create, smart default type, filled top-right toasts, VOTE_OPENED → WG + DIRECTOR). Voting quorum виправлений (`forVotes/eligibleCount > 0.5`).
- **Цикл QA 2026-05-26 закрито:** security (B-1…B-9), designer (D-1/2/3/4/9 + D-15/F-6/F-7), frontend HIGH (F-2/F-10), quick wins (D-5/7/10/18 + F-3/F-5), test infra (Vitest 48/48 + qa-smoke). State machine (B-16) + IN_REVIEW body lock — у проді.
- **UI-патерн:** підтвердження — `ConfirmModal` (type-to-confirm); сповіщення — `toast` (`success/error/info`/`notify`, всі top-right, filled cards). Нативні `confirm()/alert()` під забороною.
- **Документна модель (новий стан):** `DocumentType` = `STANDARD` | `TECH_SPEC` | `FEEDBACK` | `AGENDA` | `ATTACHMENT` (+ legacy `MEETING_MINUTES`, ховається з пікера). Видалено: `DRAFT_STANDARD` (→ `STANDARD`), `FINAL` (→ `ATTACHMENT`). Bckфіл у `scripts/pre-db-push.sql` (запускається перед `prisma db push` через `scripts/pre-db-push.sh`). `isCurrent` працює тільки для `STANDARD` і `TECH_SPEC` (інші ховаються, бекенд forces false).
- **Voting (новий стан):** ціль голосування — активний `STANDARD`-документ. На закриття: `Document.lockedAt`/`lockedByVotingId`, ім'я доповнюється `(Голосування №N, прийнято/відхилено DD.MM.YYYY)`, `Voting.documentId` тримає посилання. **REJECTED → standard.status = DRAFT** (не REJECTED) + клон документа з версією `vN+1` як новий editable. **ADOPTED → ADOPTED**, новий клон НЕ створюється. Голосування не видаляються. Поріг — `forVotes/eligibleCount > 0.5`, де `eligibleCount` = активні `LEADER/DEPUTY/MEMBER` (snapshot у `Voting.eligibleAtClose`).
- **DRAFT → IN_REVIEW gate:** потрібен ≥1 активний `STANDARD`-документ (НЕ ТЗ — ТЗ опціональний). Server + UI. ADMIN bypass.
- **Admin tools:** `/admin/settings` → «Небезпечна зона» → `vote.adminWipeAll` (type-to-confirm `WIPE-ALL-VOTINGS`) — видаляє всі Voting + Vote, повертає VOTING/ADOPTED/REJECTED стандарти у IN_REVIEW з аудит-історією.
- **Останній QA-цикл:** `QA-tests/2026-05-26/` (34 backend / 20 designer / 11 frontend). Зведення — `QA-tests/2026-05-26/summary.md`. Наступний QA-pass — після стабілізації documents/voting циклу.

### Відкриті задачі (за пріоритетом)

**🟢 P0 — Voting/documents lifecycle** — у роботі / стабілізація. Виконано: rename DRAFT_STANDARD→STANDARD, drop FINAL, lock-on-close, clone-on-reject, REJECT→DRAFT, eligibleAtClose, adminWipeAll, IN_REVIEW gate by STANDARD. Слідкуй за `Document.lockedAt`/`Voting.documentId` при роботі з документами.

**🟡 P1 — Product Tour / Онбординг** (`feat/onboarding-tour`, заплановано): guided walkthrough для нового користувача — overlay+spotlight+tooltip, role-aware кроки, кнопка «Навчання» в /profile або /admin/settings, флаг `onboarding_completed` у `User`. Бібліотека-кандидат: Driver.js або Shepherd.js (вибір — окремий ADR).

**🟠 P1 — Frontend / UX backlog:** D-6/D-8/D-11–D-14/D-16/D-17/D-19/D-20 (mobile QA окремо), F-8/F-9/F-11 (mobile), F-4 (closed раніше — toast unification).

**🟡 P2 — Backend security backlog:** B-8 follow-up (інвалідація активних JWT + `maxAge`), `meeting.list`/`task.list` single-WG bypass (як B-1), B-15…B-34 (last-leader guard B-18, транзакції B-20/B-25/B-27, cron-secret query B-28, `/api/version` leak B-29, CSP, iCal-token model B-32).

**Backlog (не цей цикл):** перехід з `db push` на `prisma migrate deploy` (ADR-0004 risk зростає з кожним destructive change — bckфіл `pre-db-push.sql` — поточний обхід), CSP headers, MEETING_MINUTES → повний редирект на Протоколи модуль (зараз тільки picker hidden).

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
