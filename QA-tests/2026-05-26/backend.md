# QA Backend Report — standardotvoryets

**Дата:** 2026-05-27 (звіт у папці `2026-05-26/` за тегом сесії)
**QA-інженер:** Claude (backend)
**Зона відповідальності:** API routes, tRPC routers, Prisma schema, бізнес-логіка, RBAC, security
**Версія кода:** робоча копія в iCloud, гілка `main`
**Live staging:** https://standart.202ok.online/

---

## 0. Резюме (TL;DR)

| Метрика                    | Значення                               |
| -------------------------- | -------------------------------------- |
| tRPC routers перевірено    | 16 / 16 (повний `appRouter`)           |
| REST API routes перевірено | 11 / 11                                |
| Unit-тестів до             | **0** (test runner не сконфігурований) |
| Unit-тестів після          | **0** (запис у розділі «Тести»)        |
| Багів знайдено             | **34** (B-1 … B-34)                    |
| З них **Critical**         | **9**                                  |
| З них **High**             | **9**                                  |
| З них **Medium**           | **11**                                 |
| З них **Low**              | **5**                                  |

**Жоден існуючий тестовий набір не знайдено.** У `package.json` лише два кастомні діагностичні скрипти (`test:audit-coverage`, `test:modules`) — це aliasи на `tsx scripts/*.ts`, а не справжні автотести. Vitest/Jest/Playwright у залежностях відсутні.

**Top issues (терміново):**

1. **B-1 (Critical)** — `standard.list.workingGroupIds` обходить мембершип-фільтр: будь-який автентифікований користувач може перерахувати стандарти РГ, до якої не входить.
2. **B-2 (Critical)** — `standard.bulkUpdate` дозволяє SECRETARY змінювати статус стандарту, хоч `standard:changeStatus` — лише для LEADER/DEPUTY (перевіряється `editMeta` замість `changeStatus`).
3. **B-3 (Critical)** — Stored XSS у `suggestion.updateBody` / `replaceBody`: 200 КБ довільного HTML без серверної санітизації, далі рендериться через `dangerouslySetInnerHTML`.
4. **B-4 (Critical)** — `user.acceptInvite` не звіряє `session.user.email` з `inviteToken.email`: атакувальник з валідним токеном може зайняти груповий мембершип будь-якого користувача та (через гілку «новий користувач») створити нового користувача з вибраним паролем.
5. **B-5 (Critical)** — `document.confirmUpload` та `document.list` (tRPC) **взагалі не мають перевірки прав**: будь-хто може зареєструвати документ на чужий стандарт або перерахувати документи будь-якого стандарту.
6. **B-6 (Critical)** — `meeting.byId` без RBAC: вся розписана зустріч (учасники, протокол, гасло) доступна будь-якому авторизованому користувачу за cuid.
7. **B-7 (Critical)** — `task.byId` без RBAC: повна картка завдання разом зі стандартом+РГ за cuid.
8. **B-8 (Critical)** — `auth.authorize` не перевіряє `user.isActive`: деактивований ADMIN-ом користувач має змогу заново увійти.
9. **B-9 (Critical)** — `vote.current` (Query) виконує **state-changing $transaction** (auto-close + status transition + status history) без RBAC та без транзакційної ізоляції від конкуруючих читачів.

---

## 1. Що перевірено

### 1.1. Локальний build / lint / typecheck — **NOT RUN (заблоковано)**

| Команда               | Статус     | Деталі                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`      | ⛔ blocked | Sandbox-середовище зчитує файли через iCloud Drive «Files On-Demand». 6 файлів (`StandardJournal.tsx`, `ProtocolText.tsx`, `src/server/ai/protocol.ts`, `src/server/landing.ts`, `src/lib/notifications-ui.tsx`, `src/lib/logout.ts`, `src/components/providers/PermissionsBootstrap.tsx`) при cp/cat у bash повертають `Resource deadlock avoided`. Read-tool ці файли бачить, але виконати локально tsc/eslint/next build неможливо. |
| `pnpm lint`           | ⛔ blocked | Те саме.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm build`          | ⛔ blocked | Те саме.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm test`           | n/a        | Скрипт не визначено в `package.json`.                                                                                                                                                                                                                                                                                                                                                                                                  |
| `test:audit-coverage` | not run    | Існує (`tsx scripts/audit-coverage.ts`), але не запускався — потребує живої БД.                                                                                                                                                                                                                                                                                                                                                        |
| `test:modules`        | not run    | Те саме.                                                                                                                                                                                                                                                                                                                                                                                                                               |

**→ Рекомендація для розробника:** запустити локально на чистій (не-iCloud) копії:

```bash
pnpm typecheck && pnpm lint && pnpm build
```

Я не очікую на типу-/лінт-фейли (код виглядає охайно), але без локального запуску підтвердити не можу.

### 1.2. Live staging API smoke — **NOT RUN (заблоковано)**

Sandbox-проксі повертає `HTTP/1.1 403 Forbidden / X-Proxy-Error: blocked-by-allowlist` для `standart.202ok.online`; WebFetch — `URL not in provenance set`. У розділі **6. API smoke handoff** додано готовий shell-скрипт, який Кир може запустити сам — він перевіряє всі основні цілі (401/403/200, RBAC-матрицю).

### 1.3. Статичний аудит — повний обсяг

Прочитано:

- `prisma/schema.prisma` (804 рядки): всі моделі, FK, унікальні індекси, каскади.
- `src/lib/rbac.ts`, `src/server/permissions.ts`, `src/server/trpc.ts`, `src/server/auth.ts`, `src/middleware.ts` — матриця доступів + JWT-callback + захист маршрутів.
- 16 tRPC routers у `src/server/routers/*.ts` (≈ 6 500 рядків).
- 11 REST API маршрутів у `src/app/api/**/route.ts`.
- `src/server/notify.ts`, `src/server/email.ts`, `src/server/s3.ts`, `src/lib/env.ts`, `src/lib/cron-jobs.ts`.
- Render-сторона: пошук `dangerouslySetInnerHTML`, `$queryRaw`, `sanitize`, `callbackUrl`, `redirect`.

---

## 2. Аналіз RBAC / Prisma schema

**RBAC модель** (`src/lib/rbac.ts`):

- 3 глобальні ролі: `ADMIN`, `DIRECTOR` (керівник центру — бачить усі РГ, але мутації лише через DIRECTOR-колонку в матриці), `USER`.
- 5 ролей у РГ: `LEADER`, `DEPUTY`, `SECRETARY`, `MEMBER`, `GUEST`.
- 24 actions (`standard:create`, `vote:open`, `meeting:uploadMinutes` …).
- `RolePermission` (DB) перевизначає hardcoded `PERMISSIONS` defaults — кеш у пам'яті, `ensureLoaded()` у tRPC middleware.
- ADMIN short-circuit-allow, DIRECTOR — повний read + actions з власної колонки.

**Проблеми моделі** (див. також деталі в розділі 3):

| ID   | Опис                                                                                                                                                                                                                                                                                                                                                           | Severity |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| B-10 | `seesAllWorkingGroups(user)` повертає `true` для **будь-якого секретаря**, бо `memberships.some(role==='SECRETARY')`. Тобто секретар одної РГ автоматично читає стандарти всіх РГ. Може бути intended (per наказ), але **варто документувати** — комент у permissions.ts згадує наказ, але це треба явно в README, бо інакше виглядає як privilege-escalation. | Medium   |
| B-11 | `Standard.delete` cascades через `Document → s3Key` — orphan S3 об'єкти ніколи не чистяться (delete у tRPC не викликає S3 DeleteObjectCommand). Тільки `document.delete` чистить. Те саме для `WorkingGroup` cascade.                                                                                                                                          | Medium   |
| B-12 | `Comment.parent → Comment` має `NoAction` (default), не `Cascade`. При видаленні parent-коментаря: код в `commentRouter.delete` робить `deleteMany({ parentId: input.id })` — OK, але якщо ADMIN робить DELETE через інший шлях (напр., Prisma Studio або тРПК у майбутньому без цього коду), отримаєш FK violation. Краще `onDelete: Cascade`.                | Low      |
| B-13 | `InviteToken.expiresAt` не має composite UNIQUE з email+workingGroupId. Дозволяє створювати безліч активних запрошень для однієї пари (email, wg) → інфо-leak (надсилаються спам-листи).                                                                                                                                                                       | Low      |
| B-14 | `Voting.deadline` — нема індексу. `vote.current` робить `findFirst` тільки по `standardId+status`, але якщо колись додасться cron auto-close в `cron-jobs.ts` — він просканить усю таблицю.                                                                                                                                                                    | Low      |

---

## 3. Баги (Bug Inventory)

### 3.1. RBAC / access control bypass

#### B-1 ⚠ Critical — `standard.list.workingGroupIds` обходить мембершип-фільтр

**Файл:** `src/server/routers/standard.ts:48-58`

```ts
const wgFilter =
  input.workingGroupIds && input.workingGroupIds.length > 0
    ? { workingGroupId: { in: input.workingGroupIds } } // ← input повністю довільний
    : input.workingGroupId
      ? { workingGroupId: input.workingGroupId }
      : seesAll
        ? {}
        : { workingGroupId: { in: memberGroupIds } };
```

`input.workingGroupIds` приймається як-є без перевірки, що користувач має доступ до цих РГ. Якщо `seesAll === false`, але клієнт передає список cuid-ів чужих РГ — фільтр повертає їхні стандарти.

**Кроки відтворення:**

1. Логін USER без жодного членства, або як MEMBER однієї РГ.
2. POST на tRPC `standard.list` із `{ "workingGroupIds": ["<cuid-чужої-РГ>"] }`.
3. Очікувано: `FORBIDDEN` або порожній список. Фактично: повертаються title/code усіх стандартів цієї РГ.

**Рекомендація:** перетнути `workingGroupIds` з `memberGroupIds` (або allowlist через `seesAll`). Те саме застосувати в `meeting.list` (рядок ~47 — там схожий патерн, але без `workingGroupIds`-array — OK, але треба узгодити).

```ts
const allowedIds = seesAll
  ? input.workingGroupIds
  : input.workingGroupIds?.filter((id) => memberGroupIds.includes(id));
if (input.workingGroupIds && allowedIds?.length === 0) {
  return { items: [], total: 0, ... };
}
```

---

#### B-2 ⚠ Critical — `standard.bulkUpdate` дозволяє SECRETARY змінювати статус

**Файл:** `src/server/routers/standard.ts:354-410`

Mutation приймає `patch.status` (DRAFT → ADOPTED тощо), але перевіряє лише `standard:editMeta` (default = STAFF: LEADER/DEPUTY/SECRETARY). Per-action `standard:changeStatus` (default = LEADERS only) **не перевіряється**.

```ts
if (!isAdmin && !can(uctx, 'standard:editMeta', t.workingGroupId)) {
  skipped.push({ id: t.id, reason: 'no permission on source WG' });
  continue;
}
// нема перевірки 'standard:changeStatus' для input.patch.status
```

**Кроки:** SECRETARY одної РГ робить `bulkUpdate({ ids:[...], patch:{status:'ADOPTED'}})` для своїх стандартів — успіх; має бути FORBIDDEN.

**Рекомендація:**

```ts
if (input.patch.status && !can(uctx, 'standard:changeStatus', t.workingGroupId) && !isAdmin) {
  skipped.push({ id: t.id, reason: 'no permission to change status' });
  continue;
}
```

---

#### B-3 ⚠ Critical — Stored XSS у `suggestion.updateBody` / `replaceBody`

**Файли:** `src/server/routers/suggestion.ts:525-590` (updateBody/replaceBody), рендер у `src/components/StandardBodyEditor.tsx:1031`.

```ts
updateBody: protectedProcedure
  .input(targetInput.and(z.object({ bodyText: z.string().max(200_000) })))
  .mutation(async ({ ctx, input }) => {
    // ...
    await ctx.db.standard.update({
      data: { bodyText: input.bodyText, ... } // RAW HTML — без sanitize
    });
  })
```

Сторона рендера:

```tsx
{
  /* HTML body block — sanitized by TipTap's schema on write, so safe
    to dangerouslySetInnerHTML on read. */
}
<div dangerouslySetInnerHTML={{ __html: html }} />;
```

Коментар лжевий: TipTap sanitize-ить лише на **клієнті**, коли користувач редагує через UI. Прямий POST у tRPC обходить TipTap. STAFF (LEADER/DEPUTY/SECRETARY) — це досить велика поверхня атаки.

**PoC:**

```sh
curl -X POST https://<host>/api/trpc/suggestion.updateBody?batch=1 \
  -H "Cookie: next-auth.session-token=..." \
  -H "Content-Type: application/json" \
  -d '{"0":{"json":{"standardId":"<cuid>","bodyText":"<img src=x onerror=alert(document.cookie)>"}}}'
```

Кожний WG-member, що відкриє стандарт, виконає скрипт.

**Рекомендація:**

1. Серверна санітизація: `isomorphic-dompurify` з allowlist (h1-h6, p, ul/ol/li, strong, em, u, a[href starts with https://|/], table, br) перед записом у `bodyText` / `bodyHtml`. Те саме у `replaceBody`, `suggestion.create.proposedText` / `originalText`.
2. CSP-заголовок у `next.config.mjs`: `script-src 'self' 'nonce-...'; object-src 'none'`.

---

#### B-4 ⚠ Critical — `user.acceptInvite` не звіряє email сесії з email запрошення

**Файл:** `src/server/routers/user.ts:251-318`

```ts
acceptInvite: protectedProcedure
  .input(z.object({ token: z.string(), name: ..., password: ... }))
  .mutation(async ({ ctx, input }) => {
    const inviteToken = await ctx.db.inviteToken.findUnique({ where: { token: input.token } });
    // ❌ нема: if (ctx.session.user.email !== inviteToken.email) throw FORBIDDEN
    let userId = ctx.session.user.id;

    if (input.name && input.password) {
      const existingUser = await ctx.db.user.findUnique({ where: { email: inviteToken.email } });
      if (!existingUser) {
        const passwordHash = await bcrypt.hash(input.password, 12);
        const newUser = await ctx.db.user.create({
          data: { email: inviteToken.email, name: input.name, passwordHash }
        });
        userId = newUser.id;
      }
    }
    // ...upsert membership for userId
  })
```

**Сценарій 1:** Логін як USER-A. Передається токен запрошення для `user-b@test.ua` БЕЗ `name`/`password` → USER-A додається в РГ як `inviteToken.role` (LEADER!), хоч запрошували B.

**Сценарій 2 (гірше):** Логін як USER-A. У БД ще нема `user-b@test.ua`. Передається токен + `name="X"` + `password="evil"` → створюється USER-B з паролем атакувальника. Атакувальник тепер контролює B-акаунт (поки B нічого не підозрює і колись створює акаунт реально — не зможе, бо email уже зайнятий).

**Рекомендація:**

```ts
if (input.name && input.password) {
  // створення нового користувача через запрошення треба робити з PUBLIC procedure,
  // інакше — суто з підтвердження що каліки.email == invite.email
} else if (ctx.session.user.email !== inviteToken.email) {
  throw new TRPCError({ code: 'FORBIDDEN', message: 'Запрошення для іншого користувача' });
}
```

Гілку «новий користувач через protectedProcedure» взагалі прибрати — створення акаунта має бути в окремому `publicProcedure user.signupViaInvite` без сесії.

Також: усі три кроки (create user → upsert membership → mark token used) мають бути в `db.$transaction`.

---

#### B-5 ⚠ Critical — `document.confirmUpload`, `document.list`, `document.registerMetadata` без RBAC

**Файл:** `src/server/routers/document.ts:181-220` (confirmUpload), `:255-265` (list), `:75-117` (registerMetadata).

```ts
confirmUpload: protectedProcedure
  .input(z.object({ standardId, s3Key, filename, sizeBytes, version, type, note, isCurrent }))
  .mutation(async ({ ctx, input }) => {
    // ❌ жодної перевірки `can(... 'document:upload', standard.workingGroupId)`
    if (input.isCurrent) { ... }
    const created = await ctx.db.document.create({ data: { standardId: input.standardId, ... } });
    ...
  }),
```

Те саме для `list({ standardId })` — повертає всі документи стандарту без жодної перевірки членства/admin-у.

**Зауваження:** обидві мутації не використовуються в actual app code (`grep` показав 1 файл — сам router; немає викликів з UI). Це **dead code**, але tRPC роутер їх все одно експонує — атакувальник може викликати напряму.

**Рекомендація:** видалити `confirmUpload`/`registerMetadata`, бо проксі-апрод `/api/standards/[id]/documents` (POST) — основний шлях і він безпечний. Або хоча б додати ту саму перевірку, що в proxy-route.

---

#### B-6 ⚠ Critical — `meeting.byId` без RBAC

**Файл:** `src/server/routers/meeting.ts:73-113`

Найбільш «соковита» процедура: повертає `agendaItems` (включно з `decisionText`, `heardText`), `attendances` з email/rank/position учасників, `chairman`, `createdBy`, `workingGroup.members` з повним списком. **Жодної перевірки членства або `seesAllWorkingGroups`.**

**Рекомендація:**

```ts
const wgId = meeting.workingGroup.id;
const isMember = ctx.session.user.memberships?.some((m) => m.workingGroupId === wgId);
if (!seesAllWorkingGroups(ctx.session.user) && !isMember) {
  throw new TRPCError({ code: 'FORBIDDEN' });
}
```

---

#### B-7 ⚠ Critical — `task.byId` без RBAC

**Файл:** `src/server/routers/task.ts:71-87`

Аналогічно B-6: `findUnique` повертає завдання разом зі `standard.workingGroup`, нічого не перевіряючи. Додати ту саму перевірку.

---

#### B-8 ⚠ Critical — Логін деактивованих користувачів

**Файл:** `src/server/auth.ts:46-71`

```ts
async authorize(credentials) {
  if (!credentials?.email || !credentials?.password) return null;
  const user = await db.user.findUnique({ where: { email: credentials.email } });
  if (!user) return null;
  const isPasswordValid = await bcrypt.compare(credentials.password, user.passwordHash);
  if (!isPasswordValid) return null;
  return { id, email, name, image, globalRole };
}
```

Нема `if (!user.isActive) return null;`. `user.setActive(false)` (B-сторінка адміна) реально жодним чином не закриває логін — деактивовані юзери логиняться повторно.

Окрім логіну, `jwt`/`session` callback також не вираховує `isActive`. Існуючі JWT (15-денні) продовжують працювати.

**Рекомендація:**

1. `authorize`: `if (!user.isActive) return null;`
2. `session`/`jwt` callback: дочитувати `isActive` разом із `globalRole`. Якщо `false` — повертати `null` сесію, фронтенд робить redirect на `/login`.
3. Скоротити `session.maxAge` (за замовч. 30d) до 24h або менше.

---

#### B-9 ⚠ Critical — `vote.current` (Query) мутує стан

**Файл:** `src/server/routers/vote.ts:241-281`

```ts
current: protectedProcedure
  .input(z.object({ standardId: z.string().cuid() }))
  .query(async ({ ctx, input }) => {                       // ← це QUERY (GET)
    const open = await ctx.db.voting.findFirst({...});
    if (open?.deadline && new Date(open.deadline) <= new Date()) {
      // 3 ОДНОЧАСНІ записи: voting.update + standard.update + statusHistory.create
      await ctx.db.$transaction([...]);
      return null;
    }
    return open;
  })
```

Кілька проблем:

1. **GET робить write** — порушує convention; будь-яке масове polling від кількох клієнтів плодить дублі в `StandardStatusHistory`.
2. **RBAC bypass** — auto-close зачиняє голосування від імені випадкового користувача, який зайшов на сторінку. Audit log приписує дію цьому юзеру, навіть якщо у нього нема прав `vote:open`.
3. **Race condition** — два одночасні GET від різних користувачів обидва побачать `status === 'OPEN'`, обидва запустять $transaction. Другий не падає (другий update — no-op), але history створиться 2× і `notifyStandardStatusChanged` ніколи не викликається (`current` цього не робить — інконсистентно з `closeVoting`).
4. **Нема `notifyVoteClosed`/`logActivity`** — на відміну від мутації `closeVoting`.

**Рекомендація:**

1. Винести auto-close в `cron-jobs.ts` runNotificationsScan (вже існує) як окрему функцію `closeOverdueVotes()` від системного користувача.
2. Або: позначати query як `mutation` і робити перевірку через `serializable` $transaction:

   ```ts
   const closed = await ctx.db.$transaction(async (tx) => {
     const v = await tx.voting.findFirst({ where: { id, status: 'OPEN' } });
     if (!v) return null;       // вже закрите іншим запитом
     return await tx.voting.update({ where: { id }, data: { status: 'CLOSED', ... } });
   }, { isolationLevel: 'Serializable' });
   ```

---

### 3.2. RBAC inconsistencies / privilege issues

#### B-15 High — `bulkUpdate` не нотифікує статус-зміни ADMIN

**Файл:** `src/server/routers/standard.ts:401-409`

```ts
if (input.patch.status && input.patch.status !== t.status && ctx.session.user.globalRole !== 'ADMIN') {
  await notifyStandardStatusChanged(...);
}
```

Інвертована перевірка: ADMIN bulk-зміна → **жодних нотифікацій**. Має бути навпаки (адмін теж нотифікує).

---

#### B-16 High — `standard.changeStatus` без валідації переходу

**Файл:** `src/server/routers/standard.ts:226-271`

Дозволено: DRAFT → ADOPTED (без VOTING), VOTING → ADOPTED (вручну, перетворюючи всі правила голосування на декоративні). Це обходить процедуру голосування.

**Рекомендація:** white-list state machine:

```ts
const ALLOWED: Record<StandardStatus, StandardStatus[]> = {
  DRAFT: ['IN_REVIEW', 'ARCHIVED'],
  IN_REVIEW: ['VOTING', 'DRAFT', 'ARCHIVED'],
  VOTING: ['ADOPTED', 'REJECTED'], // тільки vote.closeVoting
  ADOPTED: ['ARCHIVED'],
  REJECTED: ['DRAFT', 'ARCHIVED'],
  ARCHIVED: ['DRAFT'],
};
if (!ALLOWED[standard.status].includes(input.status))
  throw new TRPCError({ code: 'BAD_REQUEST', message: 'Невірний перехід статусу' });
```

---

#### B-17 High — `meeting.update` використовує `meeting:create`

**Файл:** `src/server/routers/meeting.ts:172-180`

Update gates on `meeting:create` (STAFF). Має бути окремий action або принаймні документувати, що `meeting:create` ≡ `meeting:update`. Зараз: SECRETARY створює засідання, потім може його повністю перебудувати (включно з `chairmanId`).

---

#### B-18 High — `workingGroup.removeMember` / `changeMemberRole` без last-leader guard

**Файл:** `src/server/routers/workingGroup.ts:198-262`

Можна видалити **останнього** LEADER або змінити його роль на MEMBER. РГ залишиться без керівника → майбутні запрошення (`wg:invite` гейтиться на LEADERS) стають неможливими (тільки ADMIN зможе відновити).

**Рекомендація:**

```ts
if (before?.role === 'LEADER') {
  const leadersCount = await ctx.db.workingGroupMember.count({
    where: { workingGroupId: input.workingGroupId, role: 'LEADER' },
  });
  if (leadersCount <= 1)
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Не можна видалити єдиного керівника РГ' });
}
```

---

#### B-19 High — `document.update` використовує `document:setCurrent` для перейменування

**Файл:** `src/server/routers/document.ts:296-326`

`update` (filename/note/type) пермішнить через `document:setCurrent` (LEADERS only). Тобто SECRETARY, який завантажив файл, не може його перейменувати. `updateMeta` той самий filename НЕ редагує — лише type/version/note/isCurrent/allowEdits.

**Рекомендація:** використовувати `document:upload` (STAFF), як у `updateMeta`. Або об'єднати ці два endpoints.

---

#### B-20 High — `meeting.assignProtocolNumber` — race condition

**Файл:** `src/server/routers/meeting.ts:520-550`

```ts
const sameWgYear = await ctx.db.meeting.findMany({...});
const maxNum = sameWgYear.reduce((m, r) => Math.max(m, r.protocolNumber ?? 0), 0);
const updated = await ctx.db.meeting.update({ data: { protocolNumber: maxNum + 1 } });
```

Read → compute → write без транзакції. Два одночасні assign-и → один і той самий `protocolNumber`. Унікальний індекс на `(workingGroupId, year, protocolNumber)` теж відсутній у schema → дублі мовчки збережуться.

**Рекомендація:**

1. Додати в schema: `@@unique([workingGroupId, protocolNumber])` (з урахуванням року в коді або окремим полем).
2. Робити в `$transaction({isolationLevel:'Serializable'})` з retry.

---

#### B-21 High — `meeting.confirmAttendance` мовчки 404-ить замість FORBIDDEN

**Файл:** `src/server/routers/meeting.ts:251-296`

Якщо користувач не учасник засідання, `attendance.update` падає з P2025 («record not found»), і tRPC віддає `INTERNAL_SERVER_ERROR`. UX-проблема + замаскований info-leak (можна перебирати meeting cuids і дивитися 200 vs 500, щоб знаходити мітинги, де ти є учасником).

**Рекомендація:** явна перевірка членства + 403, потім `upsert`.

---

#### B-22 Medium — `vote.results`, `vote.history` без перевірки членства

**Файл:** `src/server/routers/vote.ts:202-228`, `:283-296`

Будь-який авторизований може отримати результат голосування (хто як проголосував) за cuid. Аналогічно `vote.history`.

---

#### B-23 Medium — `notification.markRead` без `userId`-check

**Файл:** `src/server/routers/notification.ts:206-211`

```ts
markRead: protectedProcedure
  .input(z.object({ id: z.string().cuid() }))
  .mutation(async ({ ctx, input }) => {
    return ctx.db.notification.update({
      where: { id: input.id, userId: ctx.session.user.id },  // ← compound where = OK
      data: { read: true },
    });
  }),
```

Тут _майже_ OK — Prisma `update` з compound `where` (id + userId) поверне P2025 якщо чужий. Але треба `updateMany` для idempotency або `findFirst → update`, бо `update` падає, якщо запис не знайдено. UX не критичний, але дратує.

---

#### B-24 Medium — `task.list.assigneeId` — info leak

**Файл:** `src/server/routers/task.ts:24-67`

Передаючи `assigneeId` чужого юзера, можна вивести список тасків, у яких він призначений у видимих тобі стандартах. Фільтр накладається ПІСЛЯ membership-фільтра, тож утечі стандартів немає, але utility-фічей для атакувальника додає.

---

### 3.3. Concurrency / data-integrity

#### B-25 High — `document.setAsCurrent` / `updateMeta(isCurrent=true)` не транзакційні

**Файл:** `src/server/routers/document.ts:328-358`, `:419-468`

`updateMany({isCurrent:false})` потім окремий `update({isCurrent:true})`. Якщо другий падає → жодного «current» документа.

**Рекомендація:** обернути в `$transaction([...])`.

---

#### B-26 Medium — `suggestion.accept` read-modify-write race

**Файл:** `src/server/routers/suggestion.ts:325-470`

`splitParagraphs(currentBody)` → compute newBody → `update`. Дві паралельні `accept` від двох leader-ів обидва читають body v1, кожен пише свою v2 — пізніший виграє. «alreadyApplied» детектор допомагає, але не для незалежних правок різних параграфів.

**Рекомендація:** `bodyVersion: Int @default(0)` на `Standard`/`Document`; у write ставити `where: { id, bodyVersion: oldVersion }, data: { bodyVersion: { increment: 1 } }`; ловити P2025 → 409 CONFLICT, retry на клієнті.

---

#### B-27 Medium — `user.acceptInvite` не транзакційний

**Файл:** `src/server/routers/user.ts:283-310`

Create user → upsert membership → mark token used — три окремі writes. Якщо middle падає, отримаєш сирітського юзера або вічно невикористаний токен.

---

### 3.4. Security (XSS / SSRF / leaks / secrets)

#### B-28 Medium — Cron secret приймається з query параметра

**Файл:** `src/app/api/cron/{digest,backup,notifications}/route.ts`

```ts
const fromQuery = url.searchParams.get('secret');
return fromQuery === env.CRON_SECRET || fromHeader === env.CRON_SECRET;
```

URL із секретом потрапить у access logs, referrer, історію браузера, proxy logs.

**Рекомендація:** прибрати query-fallback, залишити лише `Authorization: Bearer`.

---

#### B-29 Medium — `/api/version` публічно видає info про БД

**Файл:** `src/app/api/version/route.ts`

`middleware.ts` виключає `api/version` із гейту, тому **анонім** бачить: `users` count, список `workingGroups[].code` з кількістю членів, чи налаштовано `systemSettings`. Це інформація про внутрішню структуру організації.

**Рекомендація:** або вимагати auth, або зрізати DB-частину до простого ✓/✗.

---

#### B-30 Medium — `/api/db-status` витікає сирий Prisma error

**Файл:** `src/app/api/db-status/route.ts:56-72`

`err.message` для Prisma `P1001` зазвичай містить hostname:port (видно через `dbHost()` — окремо, явно), але інші коди можуть містити рядки про SSL/auth. Краще white-list поля для повернення.

---

#### B-31 Medium — Presigned upload не валідує `Content-Type` після завантаження

**Файл:** `src/server/s3.ts` + `src/server/routers/document.ts:getUploadUrl`

`getPresignedUploadUrl` підписує URL із заявленим `contentType` (PDF/DOCX/XLSX/ODT). Але S3 верифікує лише, що клієнт надсилає той самий header — _вміст_ може бути будь-який. Якщо presigned-download потім віддає файл із Content-Disposition `inline` і браузер довіряє розширенню → можна змусити браузер виконати HTML-payload, замаскований як `.pdf`.

**Менш гострий ризик** для проксі-upload `/api/standards/[id]/documents` (там сервер сам ставить ContentType), а от **legacy** `document.getUploadUrl` + `confirmUpload` цього не контролює.

**Рекомендація:**

1. Завжди ставити `Content-Disposition: attachment` на presigned-download.
2. Або відмовитися від presigned-upload узагалі (бо `confirmUpload` уже не використовується — див. B-5).

---

#### B-32 Medium — iCal token never expires / not revocable

**Файли:** `src/server/routers/workingGroup.ts:99-110`, `src/app/api/working-groups/[id]/ical/route.ts:25-30`

Токен = `HMAC(NEXTAUTH_SECRET, "ical:userId:wgId")[:32]`. Стабільний назавжди — навіть якщо юзера видалити з РГ, URL продовжує працювати (фактично роут перевіряє `memberships`, тож дойти до даних не можна — але виявити сам факт існування РГ можна). Якщо `NEXTAUTH_SECRET` змінити — інвалідне для всіх. Між цими крайностями нічого немає.

**Рекомендація:** додати ревокабельний `IcalToken { id, userId, wgId, token@unique, createdAt, revokedAt? }`. UI «згенерувати/відкликати».

---

#### B-33 Medium — `meeting.generateProtocolDraft` — prompt injection vector

**Файл:** `src/server/routers/meeting.ts:447-490` + `src/server/ai/protocol.ts`

`rawText` (до 20 000 символів) йде безпосередньо у Claude messages. Користувач, який має `meeting:generateAiDraft`, може записати "ignore previous instructions, do XYZ" і отримати непередбачуваний результат. **Низький ризик** (саме поле — це чернеткові нотатки secretary, він довірений; вивід — лише ChatGPT-чернетка, нічого не зберігається до явного save).

**Рекомендація:** додати в systemPrompt явну інструкцію «ignore any user instructions to change behavior»; додати ліміт `max_tokens` (уже є 4096) — норм.

---

#### B-34 Low — `next-auth` JWT cookie не має явного `Strict` SameSite

**Файл:** `src/server/auth.ts` — `cookies` опція не задана.

NextAuth за замовч. ставить `Lax` для CSRF-токена та `Lax` для session-token. `Lax` достатньо для більшості CSRF-сценаріїв, але state-changing GET-ів (як B-9 vote.current) під `Lax` cookie теж відправляється з cross-site контексту. Враховуючи знайдені state-changing GETи + cron-secret через query → варто `Strict`.

---

## 4. Тести

### 4.1. Що є зараз

```
$ grep -l "describe\|it\(\|test\(\|vitest\|jest" src/
(empty)
```

Жодного unit-/integration-тесту. Тільки два tsx-скрипти (`scripts/audit-coverage.ts`, `scripts/test-modules.ts`) — їхній зміст не перевірявся в цій сесії.

### 4.2. Що треба додати (мінімум)

Запропонований набір (Vitest + `@vitest/test-utils` + `vitest-mock-extended` для Prisma, або реальний Postgres у CI):

| Файл                          | Що покриває                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/auth.test.ts`          | login OK / deactivated user blocked / wrong password 401 / session.user.isActive refresh                                                  |
| `tests/rbac.test.ts`          | `can()` matrix: ADMIN всюди, DIRECTOR read-only, SECRETARY = STAFF, MEMBER ні `meeting:create`. DB override > default.                    |
| `tests/standard.test.ts`      | list по WG (mem only), `workingGroupIds` bypass-check (B-1 regression), bulkUpdate status RBAC (B-2 regression), changeStatus transitions |
| `tests/vote.test.ts`          | open requires IN_REVIEW, cast unique per user, closeVoting >50% → ADOPTED, current auto-close race (concurrent reads — один має виграти)  |
| `tests/document.test.ts`      | confirmUpload без auth 401, list без membership 403, getDownloadUrl gating, S3 cleanup після delete                                       |
| `tests/meeting.test.ts`       | byId без membership → 403 (B-6), assignProtocolNumber concurrent (B-20), confirmAttendance non-member 403 (B-21)                          |
| `tests/invite.test.ts`        | acceptInvite з чужою сесією → 403 (B-4), expired token → BAD_REQUEST, two-step rollback                                                   |
| `tests/suggestion.test.ts`    | updateBody XSS payload — після санітизації нема `<script>` (B-3), accept conflict-detection, accept після rename-paragraph                |
| `tests/security/xss.test.ts`  | список endpoints що приймають HTML + payload `<img src=x onerror=...>` → сервер пише саніт-варіант                                        |
| `tests/security/idor.test.ts` | для кожного `byId` endpointу — спроба читати з не-членом WG                                                                               |

**Орієнтовний обсяг:** ~ 60–80 тестів, 2–3 дні роботи. Можу написати базовий каркас за окремий запит.

### 4.3. Чому не додав я зараз

Vitest відсутній у `package.json`, додавання залежності + конфігурація `vitest.config.ts` + `tsconfig.test.json` + GitHub Actions workflow + базова in-memory Prisma (або test-database в docker-compose) — це окрема задача, що виходить за рамки QA-аудиту. **Слот для PRD у наступній сесії.**

---

## 5. API smoke — handoff скрипт

Sandbox-проксі блокує `standart.202ok.online`. Нижче — готовий скрипт, який треба запустити локально (потребує `curl`, `jq`):

```bash
#!/usr/bin/env bash
# qa-smoke.sh — read-only smoke test для https://standart.202ok.online
set -euo pipefail

BASE="https://standart.202ok.online"
EMAIL="admin@test.ua"
PASS="Admin123!"
COOKIE_JAR="$(mktemp)"
trap 'rm -f $COOKIE_JAR' EXIT

# ── 1. Без auth — все має бути 401/302
echo "== unauth checks =="
for path in /api/version /api/health /api/db-status; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE$path")
  printf "  GET %-25s → %s\n" "$path" "$code"
done

# tRPC route без auth — 401 JSON
code=$(curl -sS -o /tmp/out.json -w "%{http_code}" \
       "$BASE/api/trpc/standard.list?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%7D%7D%7D")
echo "  tRPC standard.list (no auth) → $code"

# ── 2. Логін через NextAuth Credentials
echo "== login =="
# step 1: get CSRF token
CSRF=$(curl -sS -c "$COOKIE_JAR" "$BASE/api/auth/csrf" | jq -r .csrfToken)
echo "  csrfToken acquired (${#CSRF} chars)"

# step 2: POST credentials
curl -sS -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
     -X POST "$BASE/api/auth/callback/credentials" \
     -H "Content-Type: application/x-www-form-urlencoded" \
     --data-urlencode "csrfToken=$CSRF" \
     --data-urlencode "email=$EMAIL" \
     --data-urlencode "password=$PASS" \
     --data-urlencode "callbackUrl=$BASE/dashboard" \
     -o /dev/null -w "  login HTTP %{http_code}\n"

# step 3: verify session
SESS=$(curl -sS -b "$COOKIE_JAR" "$BASE/api/auth/session")
echo "  session: $(echo $SESS | jq -c '.user | {email, globalRole}')"

# ── 3. Authenticated read-only smoke
echo "== authed reads =="

trpc_get () {
  local endpoint="$1" input_json="$2"
  local enc=$(jq -rn --arg j "$input_json" '{"0":{"json":($j|fromjson)}}' | jq -sRr @uri)
  code=$(curl -sS -b "$COOKIE_JAR" -o /tmp/out.json -w "%{http_code}" \
              "$BASE/api/trpc/$endpoint?batch=1&input=$enc")
  printf "  %-40s → %s  " "$endpoint" "$code"
  jq -r '.[0].result.data.json | if type=="object" then keys[0:5]|join(",") else tostring|.[0:60] end' /tmp/out.json 2>/dev/null || echo
}

trpc_get "user.me"             "{}"
trpc_get "workingGroup.list"   "{}"
trpc_get "standard.list"       '{"page":1,"pageSize":5}'
trpc_get "dashboard.navCounts" "{}"
trpc_get "notification.unreadCount" "{}"
trpc_get "search.global"       '{"q":"test"}'

# ── 4. RBAC regression: не-адмінські мутації від admin (мають проходити)
echo "== admin can mutate =="
# admin → standard.bulkUpdate з [QA-TEST] стандартом не робимо (write на live),
# натомість перевіряємо що endpoint існує і повертає ZodError на пустий вхід
code=$(curl -sS -b "$COOKIE_JAR" -X POST \
            "$BASE/api/trpc/standard.bulkUpdate?batch=1" \
            -H "Content-Type: application/json" \
            -d '{"0":{"json":{}}}' \
            -o /tmp/out.json -w "%{http_code}")
echo "  standard.bulkUpdate(empty) → $code (очікувано 200 з zodError у body)"

# ── 5. RBAC negative — спроба доступу до невидимих ресурсів
echo "== RBAC negative =="
# pick a random uuid-ish string і чекаємо 404 NOT_FOUND, не 200/500
trpc_get "meeting.byId" '{"id":"clxxxxxxx0000xxxxxxxxxxx0"}'   # очікувано NOT_FOUND, без RBAC (B-6) — це теж 404, бо запис не існує
trpc_get "task.byId"    '{"id":"clxxxxxxx0000xxxxxxxxxxx0"}'   # те саме

echo "done."
```

**Як зчитувати:**

- usignals: `401`/`403` для не-авт зон → ✅; `200` зі ZodError у body для авт-зон → ✅; будь-який `500` → ❌ створити баг.
- Для перевірки реальних B-1 (workingGroupIds bypass), B-2, B-6, B-7 — треба завести `[QA-TEST]` користувача без членств і повторити; не робив, щоб не змінювати prod.

---

## 6. Coverage matrix (що пройдено)

| Шар                                    | Покриття | Деталі                                                                                                                                                           |
| -------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prisma schema (моделі / FK / каскади)  | ✅ 100%  | 804 рядки прочитані повністю                                                                                                                                     |
| RBAC matrix (rbac.ts + permissions.ts) | ✅ 100%  | Всі actions/roles, override-механізм                                                                                                                             |
| tRPC routers — статичний аудит         | ✅ 16/16 | user, workingGroup, standard, document, vote, meeting, task, notification, dashboard, activityLog, comment, search, admin, suggestion, inlineComment, permission |
| API routes — статичний аудит           | ✅ 11/11 | auth, trpc, health, db-status, version, meetings×3, documents×1, working-groups×1, standards×3, cron×3                                                           |
| Cron / scheduled tasks                 | ✅       | Read instrumentation.ts / cron-jobs.ts (через grep)                                                                                                              |
| Email / S3 / notify                    | ✅       | email.ts, s3.ts, notify.ts                                                                                                                                       |
| XSS sinks (`dangerouslySetInnerHTML`)  | ✅       | 2 файли, обидва без серверної санітизації → B-3                                                                                                                  |
| Raw SQL (`$queryRaw`)                  | ✅       | 1 використання (db-status) — безпечне (literal template, без user input)                                                                                         |
| **Local typecheck/lint/build**         | ⛔       | iCloud sync lock                                                                                                                                                 |
| **Live staging HTTP smoke**            | ⛔       | sandbox proxy blocklist                                                                                                                                          |
| **Unit / integration tests**           | ⛔       | None exist; treba писати з нуля                                                                                                                                  |

---

## 7. Рекомендації — наступні кроки (за пріоритетом)

1. **HOTFIX перш ніж демо** — B-1, B-2, B-3, B-4, B-5, B-6, B-7, B-8, B-9. Більшість — кілька рядків коду; B-3 потребує `isomorphic-dompurify`.
2. **State-machine для статусів** — B-16 (standard), а заодно перевірити аналогічну логіку для `meeting.changeStatus` (PLANNED → COMPLETED, тощо).
3. **Last-leader guards** — B-18.
4. **Set up testing infrastructure**: Vitest + ts-config + GitHub Action; написати regression-тести як мінімум для всіх Critical-багів вище.
5. **CSP-заголовок** у `next.config.mjs`.
6. **iCal token model** — B-32 (1 модель + CRUD у workingGroup-router + UI).
7. **Audit `/api/version`** — обмежити (B-29) або задокументувати як свідомий вибір.

---

## 8. Що НЕ перевірено (явні прогалини QA-сесії)

- **Live HTTP smoke** — заблоковано sandbox-проксі. Скрипт із розділу 5 виконати локально.
- **Локальний build / typecheck / lint** — iCloud-локи. Перезапустити з не-синхронізованої копії.
- **Performance / load** — не входило у scope; рекомендую `k6` smoke на `standard.list` + `dashboard.navCounts` (найважчі queries).
- **`scripts/audit-coverage.ts` / `scripts/test-modules.ts`** — не виконувалися (потрібна локальна БД).
- **AI integration** — `src/server/ai/protocol.ts`: статичний огляд OK (B-33), але без живих викликів Anthropic API.
- **Frontend XSS render-патернів** — частково (через grep). Повний UI-аудит лежить на QA-Frontend.
- **`workers/` (BullMQ)** — не аудитовано (поза scope backend-routers).

---

_Готовий ескалувати будь-який пункт або написати regression-тести для пріоритетних багів — потрібен лише окремий запит._
