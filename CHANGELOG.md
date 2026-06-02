# Changelog

Усі помітні зміни проєкту. Формат вільний, найновіше — зверху.
Оновлюється при кожному merge гілки в `main` (див. `CONTINUATION.md §8`).

## [Unreleased]

### UX, notifications — 2026-05-29 (in-flight)

- **DRAFT → IN_REVIEW gate.** Server (`standard.changeStatus`) rejects the transition unless the standard has ≥1 active (unlocked) document of type `STANDARD` (the actual standard text — ТЗ is NOT required). UI disables the button with tooltip «Спочатку завантажте документ типу «Стандарт»». ADMIN keeps the escape hatch. Error surfaces as a `toast.error` (was silent).
- **Auto-edit on create.** After creating/uploading a `STANDARD` or `TECH_SPEC` document, the editor opens immediately in `'edit'` mode (`StandardBodyEditor` gained `initialMode` prop). Reopening later still lands in `'view'`. Other types behave as before.
- **Smart default doc-type.** `DocumentUploadModal` takes an `initialType` prop; `StandardDetail` computes it: no STANDARD but has ТЗ → default `STANDARD`; nothing yet → default `TECH_SPEC`; both present → `ATTACHMENT`.
- **Toasts — top-right + filled cards.** All `toast.success/error/info` now render top-right (matches the notification popup column). Filled colored backgrounds (`emerald-600` / `rose-600`; `info` stays neutral), `px-5 py-4`, `rounded-2xl`, `shadow-2xl`. Width 380px.
- **`VOTE_OPENED`** now pings ALL WG members (including secretary + guests) PLUS DIRECTOR/ADMIN. `emit()` dedupes by user id so dual-membership users get one notification.
- **Editor default mode = view.** `StandardBodyEditor` lands on `'view'` by default everywhere (was `'edit'` when the user had edit rights). Mode toggle still works. Override available via the new `initialMode` prop for fresh-create flows.
- **Doc-delete: Enter submits.** The 6-digit-code modal on hard-delete now fires the delete on `Enter` when the typed code matches (same gating as the button).

### Features — voting document lifecycle 2026-05-29 (`feat/documents-voting-lifecycle`)

- **`DocumentType` rebuilt.** `DRAFT_STANDARD` → `STANDARD`; `FINAL` removed. Migration script `scripts/pre-db-push.sh` + `pre-db-push.sql` runs before `prisma db push` on every Railway boot — adds the new enum value, migrates rows (`DRAFT_STANDARD` → `STANDARD`, `FINAL` → `ATTACHMENT`). Idempotent and skips fresh DBs. `MEETING_MINUTES` kept in the enum (legacy rows) but removed from the upload picker — the Протоколи module is the new source of truth.
- **Voting freezes the standard doc.** When a voting closes, the active `STANDARD` document is locked (`Document.lockedAt`, `Document.lockedByVotingId`, filename suffixed with `(Голосування №N, прийнято/відхилено DD.MM.YYYY)`, `isCurrent=false`). `Voting.documentId` records the snapshot — the voting itself is never deleted.
- **REJECTED → DRAFT (not REJECTED).** A failed voting sends the standard back to `DRAFT` and clones the locked doc into a fresh editable version with bumped `vN+1` so the WG can iterate. ADOPTED keeps the standard at `ADOPTED` — the locked snapshot IS the final.
- **Locked docs are immutable for everyone (incl. ADMIN).** `StandardBodyEditor` accepts `documentLocked` + `documentLockInfo`, renders a banner «Документ заблоковано — Голосування №N, завершено DD.MM.YYYY», disables edits and new suggestions/comments. Suggestion router (`updateBody`/`replaceBody`/`updateMeta`) and document router (`update`/`setAsCurrent`/`updateMeta`) reject writes server-side on locked docs.
- **`isCurrent` only for `STANDARD` and `TECH_SPEC`.** Server-side coerced to `false` for other types in `createEmpty` / `registerMetadata` / `confirmUpload` / `updateMeta` / proxy upload route. UI hides the toggle when the picked type doesn't support it. `assertUniqueTypePerStandard` counts only `lockedAt: null` rows, so historical locked snapshots stack up freely under one «active» STANDARD/TECH_SPEC.
- **Voting quorum fix.** Pass threshold is now `forVotes / eligibleCount > 0.5` where `eligibleCount` = active WG members with role `LEADER`/`DEPUTY`/`MEMBER` (SECRETARY and GUEST don't vote). 1 «за» in a 5-voter WG → REJECTED. `Voting.eligibleAtClose Int?` snapshots the denominator at close time so the archive verdict can't flip later if roster changes. UI bar shows «За X з Y» + 50% threshold marker.
- **Admin wipe.** `vote.adminWipeAll` mutation + `/admin/settings` «Небезпечна зона» with type-to-confirm `WIPE-ALL-VOTINGS` deletes every Voting+Vote system-wide and reverts standards in VOTING/ADOPTED/REJECTED back to IN_REVIEW with audit history. ADMIN-only.
- **`Voting.seqNumber`** assigned at open time (per-standard, 1, 2, 3…) — used in the locked-doc filename and the editor banner so historical references stay readable.
- **Server-side state machine (Pack 3 / B-16).** `standard.changeStatus` enforces `STATUS_TRANSITIONS` (DRAFT↔IN_REVIEW↔ARCHIVED; VOTING→IN_REVIEW; ADOPTED→ARCHIVED; REJECTED→DRAFT/ARCHIVED). ADOPTED/REJECTED reachable only via `vote.closeVoting`. ADMIN bypasses.
- **IN_REVIEW body lock (Pack 1).** Direct WYSIWYG editing of standard.bodyText AND attached document.bodyHtml is disabled while the parent standard is `IN_REVIEW` (suggestions only). ADMIN bypasses. Applied via `documentLocked` prop OR `standardStatus === 'IN_REVIEW'` gate.

### Security — QA-cycle 2026-05-26 hotfix (`fix/security-hotfix-2026-05-26`)

- **B-1** `standard.list` now intersects client `workingGroupId(s)` with the user's visible groups (no foreign-WG enumeration).
- **B-2** `standard.bulkUpdate` requires `standard:changeStatus` (not just `editMeta`) to patch status.
- **B-3** Server-side DOMPurify sanitization (`src/lib/sanitizeHtml.ts`) of `suggestion.updateBody`/`replaceBody`/`create` HTML before persistence; `isomorphic-dompurify` marked `serverComponentsExternalPackages`.
- **B-4** `user.acceptInvite` rejects when session email ≠ invite email; membership + token consumption made atomic.
- **B-5** RBAC added to `document.confirmUpload` (`document:upload`) and `document.list` (membership).
- **B-6 / B-7** RBAC (membership) added to `meeting.byId` and `task.byId`.
- **B-8** `auth.authorize` blocks login for deactivated (`!isActive`) users.
- **B-9** `vote.current` is now read-only; overdue auto-close moved to a privileged, Serializable, idempotent `vote.closeOverdue` mutation.

### Added — QA Part 3: test infra

- **Vitest** уніт-набір: `vitest.config.ts` (happy-dom, `@/`-alias), dev-deps `vitest @vitest/ui happy-dom @testing-library/{react,jest-dom,user-event}`, 5 файлів у `src/lib/__tests__` (`utils`, `wordDiff`, `standardBody`, `ranks`, `rbac`) → **48/48 passes**. Скрипти `pnpm test`, `test:watch`, `test:ui`, `test:coverage`.
- **`scripts/qa-smoke.sh`** — read-only smoke проти staging: NextAuth login (admin@test.ua) + unauth probes + 7 authed tRPC reads + RBAC-negative для `meeting.byId`/`task.byId`. Виходить з ненульовим кодом при провалах; запуск `pnpm qa:smoke` (можна перевизначити `BASE`/`EMAIL`/`PASS`).

> ⚠️ Чистка тест-артефакту `cmpoc1qpm0001gb43j0h5nhrm` (`[QA-TEST] Після редагування`, в архіві на проді) — зробити через адмін-кнопку «Видалити стандарт» (type-to-confirm) у `/standards/<id>` після того, як Railway підхопить останній build.

### Fixed — QA frontend HIGH + quick wins 2026-05-26

- **F-1** ✅ (no change needed) — tRPC `loggerLink` already uses `enabled: opts => NODE_ENV==='development' || (down && Error)`, which is exactly what QA recommended.
- **F-2 / F-10** — `Modal`: implemented focus-trap (Tab / Shift+Tab cycle inside the panel, initial focus skips the close-X so form modals land on the first field, focus returns to the opener on close); backdrop dismiss switched from `onMouseDown` to `onClick` so selecting text and accidentally releasing on the backdrop no longer closes.
- **D-5** — Escape closes the РГ multi-select on `/standards`.
- **D-7** — Topbar: added `/profile`, `/reports`, `/discussions`, `/protocols` titles; `/protocols` no longer falls through to «Засідання».
- **D-10** — Ukrainian plural picker (`src/lib/pluralize.ts`) + applied to `/discussions` («1 коментар / 2 коментарі / 5 коментарів»).
- **D-18** — `/standards` search input has a clear (✕) button (input persists in localStorage; old values like «QA-T» used to stick invisibly).
- **F-3** — `ThemeProvider` lazy-initialises from `document.documentElement.classList`; the Sun/Moon icon flicker and the logout→login light-flash are gone.
- **F-5** — Localised 404 page (`src/app/not-found.tsx`) with brand colour + button «На головну».

### Fixed — QA designer release-blockers 2026-05-26

- **D-1 / D-15 / F-6 / F-7 — `/login`:** `(auth)/layout` тепер світла/темна (`bg-gradient-to-br from-blue-50 ... dark:from-slate-900 ...`), `LoginForm` повністю на токенах (`bg-page`, `border-hairline`, `text-ink/mid/light`, `bg-card`), прибрано дублюючий заголовок «Вхід до системи» (D-15), додано `aria-label` для toggle паролю (F-7).
- **D-2 — Dashboard «Прострочені завдання» ↔ `/tasks`:** KPI більше не фільтрує по `assigneeId=me` і скоупиться по видимих РГ — лічильник нарешті збігається з `/tasks` хедером.
- **D-3 — Sidebar «Стандарти» ↔ KPI «Активних»:** `navCounts.standards` тепер той самий active-набір (`DRAFT/IN_REVIEW/VOTING`), що й у KPI.
- **D-4 — `/standards` «filter active» індикатор:** під фільтр-карткою з’являється рядок «Фільтр:» з чіпами обраних РГ (колір + код + ✕) і кнопкою «Скинути все».
- **D-9 — `/working-groups/[id]` hex колір:** прибрав код-блок поряд зі swatch'ем; hex тепер у `title` tooltip-і swatch'а.

### Fixed

- **Сповіщення — синхронізація + клік + вирівнювання:** клікнутий top-right попап тепер позначає нотифікацію прочитаною і веде на її лінк (`toast.notify({onClick})`); watcher одночасно інвалідовує `notification.unreadCount` + `notification.list` → колокольчик і `/notifications` оновлюються разом з попапом, без чекання власного polling-у. Poll watcher'а 20→15с, колокольчика 60→15с. `localStorage.lastSeenAt` дозволяє попапам спрацьовувати на нотифікації, що прийшли під час відсутності (з обмеженням 5/раз). Час у списку `/notifications` нарешті стоїть праворуч (час — сусід колонки, а не вкладений; кнопка «прочитати» — `absolute`).

### Added

- **Політика нотифікацій уніфікована**: керівництво РГ (LEADER/DEPUTY/SECRETARY) отримує **все**; учасник (MEMBER) — нові правки + зміни їх статусу, відповіді на **його** коментарі та зміну статусу **його** inline-коментарів. Suggestion-події тепер broadcast по РГ; comment-події broadcast тільки керівництву; додано notify на resolve/unresolve inline-коментаря.

- **Нотифікації для коментарів/правок:** новий top-level коментар → керівництву РГ + відповідальному за стандарт; відповідь на коментар → автору батьківського; новий inline-коментар → керівництву + відповідальному (зі сніпетом виділення); відповідь на inline-коментар → автору вихідного + всім попереднім відповідачам. Приймання/відхилення правки в документі вже надсилало нотифікацію автору (`notifySuggestionResolved`); попап тепер спрацьовує надійно. Опитування watcher'а зменшено з 30с до 20с.

- **Сповіщення в реальному часі:** нові нотифікації спливають у правому верхньому куті (≈5с, ✕ для закриття, клік веде на лінк нотифікації). Воркер у `(app)/layout` поллить кожні 30с (паузується у фоновій вкладці), `/notifications` тепер рефетчиться кожні 15с і при поверненні фокусу. `toast` отримав `position: top-right` + `title`/`href` (метод `toast.notify({title, message, href})`).

- **Адмін: видалення стандарту** + усіх пов'язаних даних (документи, завдання, голосування, коментарі, журнал — через DB cascade) + best-effort видалення файлів зі сховища (S3). Захищено type-to-confirm: адмін мусить вручну ввести код стандарту (перевіряється і на сервері). `ConfirmModal` отримав багаторазову type-to-confirm-підтримку (`confirmText`/`confirmTextLabel`).

### Changed

- **Уніфіковано всі підтвердження/сповіщення:** додано app-wide toast (`src/lib/toast.tsx`, `<Toaster>` у root layout) і прибрано **всі** нативні браузерні `confirm()`/`alert()`. Тепер `confirm()` → `ConfirmModal` (bulk-архів стандартів, скидання прав, видалення з РГ, архів/відновлення РГ), `alert()` → `toast` (помилки мутацій, результат bulk-update, імпорт .docx тощо). Закриває QA F-4.

### Fixed

- **Видалення inline-коментаря:** замість нативного `confirm()` браузера тепер показується in-app `ConfirmModal` (destructive, inline-помилка, спінер).
- **Календар засідань (Тиждень):** у тижневому режимі тулбар тепер показує діапазон тижня (напр. «25–31 трав. 2026») і стрілки `‹ ›` гортають по тижнях, а не по місяцях; місяць/рік синхронізуються з тижнем (за четвергом) — дані стежать за тижнем.

### Changed

- `/admin/permissions`: дозвіл `standard:editBody` («Редагувати текст документа») перенесено з групи «Стандарти» до «Документи» (косметика, без зміни поведінки).

### Added (continued)

- Інфраструктура «вічного контексту»: `QA-tests/` (архів QA-прогонів + шаблон), `HANDOFF.md` (знімок стану для нового агента), `docs/DECISIONS.md` (ADR). `CONTINUATION.md` приведено до структури живого документа.
- Імпортовано QA-цикл `2026-05-26/` (backend/designer/frontend + summary).
