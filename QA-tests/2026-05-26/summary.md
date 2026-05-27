# QA-цикл 2026-05-26 — Зведення (summary)

**Версія:** `main` @ `910f5f8` (на момент QA — робоча копія в iCloud)
**Staging:** https://standart.202ok.online/
**Агенти:** Designer, Backend, Frontend (3 паралельні прогони)
**Підсумок:** 34 backend-баги (B-1…B-34), 20 designer (D-1…D-20), 11 frontend (F-1…F-11).

> ⚠️ Backend не зміг запустити local build/typecheck/lint (iCloud `Resource deadlock`) і live HTTP smoke (sandbox proxy blocklist). Аудит — статичний (повне читання schema + routers + API routes). Code-агент має підтвердити фікси локальним `pnpm typecheck && pnpm lint && pnpm build` (репо тепер поза iCloud — блокер знятий).

---

## 🔴 Реліз-блокери (фіксити перш ніж demo)

### Security (Backend) — гілка `fix/security-hotfix-2026-05-26`

| ID  | Severity | Суть                                                                                                      | Файл                               |
| --- | -------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| B-1 | 🔴       | `standard.list.workingGroupIds` обходить membership-фільтр                                                | `src/server/routers/standard.ts`   |
| B-2 | 🔴       | `standard.bulkUpdate`: SECRETARY міняє статус (перевіряється `editMeta`, не `changeStatus`)               | `src/server/routers/standard.ts`   |
| B-3 | 🔴       | Stored XSS у `suggestion.updateBody/replaceBody` (200КБ HTML без санітизації → `dangerouslySetInnerHTML`) | `src/server/routers/suggestion.ts` |
| B-4 | 🔴       | `user.acceptInvite` не звіряє email сесії з email токена → захоплення запрошень                           | `src/server/routers/user.ts`       |
| B-5 | 🔴       | `document.confirmUpload/list/registerMetadata` без RBAC                                                   | `src/server/routers/document.ts`   |
| B-6 | 🔴       | `meeting.byId` без RBAC                                                                                   | `src/server/routers/meeting.ts`    |
| B-7 | 🔴       | `task.byId` без RBAC                                                                                      | `src/server/routers/task.ts`       |
| B-8 | 🔴       | `auth.authorize` не перевіряє `user.isActive` → деактивовані логиняться                                   | `src/server/auth.ts`               |
| B-9 | 🔴       | `vote.current` (Query) робить state-changing мутації без RBAC/ізоляції                                    | `src/server/routers/vote.ts`       |

### Designer release-blockers — гілка `fix/qa-designer-2026-05-26`

| ID  | Severity | Суть                                                              |
| --- | -------- | ----------------------------------------------------------------- |
| D-1 | 🔴       | `/login` завжди темна (ігнорує localStorage/prefers-color-scheme) |
| D-2 | 🔴       | Dashboard «Прострочені: 0» ↔ `/tasks` «Прострочено: 1»            |
| D-3 | 🟠       | Sidebar «Стандарти 12» ↔ «13» (navCounts TOTAL vs KPI ACTIVE)     |
| D-4 | 🟠       | Multi-select РГ-фільтр персиститься без видимого індикатора       |
| D-9 | 🟠       | Hex-колір РГ показано як code-блок                                |

### Frontend HIGH — гілка `fix/qa-frontend-2026-05-26`

| ID  | Severity | Суть                                                            |
| --- | -------- | --------------------------------------------------------------- |
| F-1 | 🟠       | tRPC dev-logger у проді (шум у Console)                         |
| F-2 | 🟠       | Modal без focus-trap і без повернення фокусу (WCAG 2.4.3/2.4.7) |

---

## 🟡 Quick wins — гілка `fix/qa-polish-2026-05-26`

D-5 (Escape не закриває multi-select), D-7 (топбар-заголовок зникає на /profile,/reports,/discussions; невірний на /protocols), D-10 (укр. відмінювання «1 коментар»), D-15 (дві title-зони на login), D-18 (search clear-button), F-3 (theme flash — state≠DOM), F-4 (bulk-archive без ConfirmModal), F-5 (немає `not-found.tsx`), F-6 (LoginForm hardcoded slate-\* → токени).

## Середній спринт / backlog (не в цьому циклі)

- Backend: B-15…B-34 (state-machine статусів B-16, last-leader guard B-18, транзакції document setCurrent B-25, cron-secret у query B-28, CSP-заголовок, iCal-token model B-32 тощо).
- Designer: D-6, D-8, D-11…D-14, D-16, D-17, D-19, D-20 (mobile).
- Frontend: F-7…F-11 (a11y aria-label/aria-current, TaskFormModal deps, Modal onClick, mobile).

## Інфраструктура тестів (Part 3)

- Vitest не встановлено. QA-Frontend написав 44 unit-кейси (`vitest.config.ts` + `src/lib/__tests__/{utils,wordDiff,standardBody,ranks,rbac}.test.ts`) — лежать в iCloud-копії, треба портувати в репо.
- Backend пропонує regression-набір (~60-80 тестів) + `qa-smoke.sh` (NextAuth логін + read-only перевірки проти staging).
- Тестовий артефакт: стандарт `cmpoc1qpm0001gb43j0h5nhrm` (`[QA-TEST] Після редагування`, в архіві) — hard-delete.

## Handoff Code-агенту

Порядок: security hotfix → designer blockers → frontend HIGH → quick wins → test infra. Кожен фікс — окремий коміт (`fix(<scope>): <ID> <опис>`). Кожна гілка — merge у main + оновлення `CONTINUATION.md`. Деталі кожного бага — у відповідному `backend.md` / `designer.md` / `frontend.md`.
