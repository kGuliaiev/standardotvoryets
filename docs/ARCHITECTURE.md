# Стандартотворець — архітектура та функціонал

> **Що це за документ.** Єдиний опис того, як система працює **сьогодні**:
> доменна модель, ролі, життєві цикли, функціонал по модулях. Складений з коду
> (`prisma/schema.prisma`, `src/lib/rbac.ts`, `src/server/routers/*`), а не з планів.
>
> **Чим відрізняється від сусідніх документів:**
>
> | Документ | Про що | Коли читати |
> |---|---|---|
> | `docs/ARCHITECTURE.md` (цей) | Як влаштовано **зараз** | Щоб зрозуміти систему |
> | `TZ.md` | Що замовляли у травні 2026 | Щоб звірити з вимогами |
> | `HANDOFF.md` | Як увійти в роботу за 5 хвилин | Перед першим комітом |
> | `CONTINUATION.md` | Де ми зупинились, що відкрито | Щодня |
> | `docs/DECISIONS.md` | **Чому** саме так (ADR) | Перед тим, як переробляти |
> | `OPS.md` | Деплой, дебаг, відновлення | Коли щось впало |
> | `DESIGN.md` | Токени, патерни UI | Перед новим екраном |
>
> Актуально на `911085b` (2026-08-06). Оновлювати разом зі зміною моделі чи правил.

---

## 1. Призначення

Платформа веде **життєвий цикл стандартів** у робочих групах державного сектору
(Держспецзв'язку). Ланцюжок: робоча група → стандарт → поетапний план → документи
→ обговорення й пропозиції → засідання → голосування → рішення, і наскрізно —
завдання та аудит-журнал.

Ключова властивість: **рішення мусить лишатись доказовим**. Тому голосування
ніколи не видаляються, документ на момент голосування заморожується, а кожна
значима мутація пише `ActivityLog`.

---

## 2. Технологічний стек

| Шар | Технологія | Примітка |
|---|---|---|
| Runtime | Node 20+ (dev на 22), pnpm 9.15.9 | |
| Framework | Next.js 14.2.35, App Router | `(app)` — автозона, `(auth)` — публічна |
| UI | React 18.3, TailwindCSS 3.4, Radix UI, lucide-react | темізація через токени (ADR-0002) |
| Редактор | TipTap 3 | тіло стандарту, протоколи |
| API | tRPC v11 (`@trpc/server` rc.522) + superjson | 16 роутерів |
| БД | PostgreSQL + Prisma 5.22 | **`db push`**, без міграцій (ADR-0004) |
| Auth | NextAuth v4 (Credentials + JWT) | сесія = `globalRole` + `memberships[]` |
| Сховище | S3-сумісне (`@aws-sdk/client-s3`), presigned URL | локально MinIO |
| Черги | BullMQ + ioredis | `workers/` |
| Пошта | Resend (prod) / MailHog (dev) | no-op без ключа |
| Планувальник | in-process `node-cron` | TZ Europe/Kyiv (ADR-0003) |
| Тести | Vitest + happy-dom | 48 кейсів, 5 файлів |
| Деплой | Railway, Dockerfile, auto-deploy з `main` | |

---

## 3. Доменна модель

### 3.1 Основні сутності

| Модель | Призначення | Ключові зв'язки |
|---|---|---|
| `User` | Користувач: `globalRole`, військове звання, організація, `isActive` | → `memberships`, `tasks`, `votes` |
| `WorkingGroup` | Робоча група (РГ №1…№9), колір для візуалізації | → `members`, `standards`, `meetings` |
| `WorkingGroupMember` | Членство: `User` × `WorkingGroup` + `WorkingGroupRole` | унікальне на пару |
| `Standard` | Стандарт: статус, поетапний план, метадані Програми, тіло | → `documents`, `tasks`, `votes`, `suggestions` |
| `Document` | Файл або тіло в HTML; версії, `isCurrent`, `lockedAt` | → `Standard`, `Voting` |
| `StandardSuggestion` | Пропозиція правки абзацу (`REPLACE`/`INSERT_AFTER`/`DELETE`) | → `Standard`, реакції |
| `InlineComment` | Коментар, прив'язаний до фрагмента тексту | + `InlineCommentReply` |
| `Voting` / `Vote` | Голосування та окремі голоси | `seqNumber`, `eligibleAtClose`, `documentId` |
| `Meeting` | Засідання: формат, статус, порядок денний | → `AgendaItem`, `Attendance` |
| `Task` | Завдання по стандарту | → `TaskChecklistItem` |
| `TaskChecklistItem` | Підзадача — один рівень вкладеності (ADR-0007) | → `Task`, `assignee` |
| `Notification` | Сповіщення користувачу | 18 типів |
| `ActivityLog` | Аудит-журнал: before/after/diff | наскрізно |
| `RolePermission` | DB-перевизначення дефолтів RBAC | `/admin/permissions` |
| `SystemSettings` | Системні налаштування | singleton |

### 3.2 Перелічення

| Enum | Значення |
|---|---|
| `GlobalRole` | `ADMIN` · `DIRECTOR` · `USER` |
| `WorkingGroupRole` | `LEADER` · `DEPUTY` · `SECRETARY` · `MEMBER` · `GUEST` |
| `StandardStatus` | `DRAFT` · `IN_REVIEW` · `VOTING` · `ADOPTED` · `REJECTED` · `ARCHIVED` |
| `StandardStage` | `TECH_SPEC` · `DRAFTING` · `FEEDBACK` · `TECH_REVIEW` · `FINALIZATION` · `COMPLETED` |
| `DocumentType` | `STANDARD` · `TECH_SPEC` · `FEEDBACK` · `AGENDA` · `ATTACHMENT` · `MEETING_MINUTES` (legacy) |
| `TaskStatus` / `TaskPriority` | `OPEN` · `IN_PROGRESS` · `DONE` · `CANCELLED` / `HIGH` · `MEDIUM` · `LOW` |
| `MeetingStatus` / `MeetingFormat` | `PLANNED` · `IN_PROGRESS` · `COMPLETED` · `CANCELLED` / `ONLINE` · `OFFLINE` · `HYBRID` |
| `VoteChoice` / `VoteStatus` | `FOR` · `AGAINST` · `ABSTAIN` / `OPEN` · `CLOSED` |
| `SuggestionStatus` / `SuggestionOp` | `PENDING` · `ACCEPTED` · `REJECTED` / `REPLACE` · `INSERT_AFTER` · `DELETE` |
| `MilitaryRank` | `CIVILIAN` … `GENERAL` (11 значень) |
| `Organization` | `DERZH_NDI` · `ADM_DSSZZI` · `OTHER` |

---

## 4. Ролі та права

Три **глобальні** ролі × п'ять ролей **у робочій групі** × ~35 дій.
Перевірка — `can(user, action, workingGroupId)` у `src/lib/rbac.ts`.

**Порядок вирішення:**

1. `ADMIN` — дозволено все, завжди (аварійний люк, свідомо).
2. `DIRECTOR` — бачить усі РГ; з дій має читання + те, що дозволено рядком `DIRECTOR` у матриці.
3. Інакше — роль користувача **в цій конкретній РГ**; не член → заборонено.
4. Запис у `RolePermission` перекриває дефолт (редагується в `/admin/permissions`).

### 4.1 Матриця дій

Легенда: ✅ дозволено за замовчуванням · — заборонено · 🔧 налаштовується в `/admin/permissions`

| Дія | LEADER | DEPUTY | SECRETARY | MEMBER | GUEST | DIRECTOR | ADMIN |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| **Читання** (`standard/document/comment/vote/meeting/task/wg:view`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `standard:create` | ✅ | ✅ | — | — | — | — | ✅ |
| `standard:changeStatus` | ✅ | ✅ | — | — | — | — | ✅ |
| `standard:editMeta` | ✅ | ✅ | ✅ | — | — | — | ✅ |
| `standard:editBody` 🔧 | ✅ | ✅ | ✅ | — | — | — | ✅ |
| `standard:delete` | — | — | — | — | — | — | ✅ |
| `document:upload` | ✅ | ✅ | ✅ | — | — | — | ✅ |
| `document:setCurrent` | ✅ | ✅ | — | — | — | — | ✅ |
| `document:delete` 🔧 | ✅ | ✅ | ✅ | — | — | — | ✅ |
| `comment:add` | ✅ | ✅ | ✅ | ✅ | — | — | ✅ |
| `vote:open` | ✅ | ✅ | — | — | — | — | ✅ |
| **`vote:cast`** | ✅ | ✅ | **—** | ✅ | **—** | — | ✅ |
| `meeting:create` | ✅ | ✅ | ✅ | — | — | — | ✅ |
| `meeting:cancel` | ✅ | ✅ | — | — | — | — | ✅ |
| `meeting:uploadMinutes` | ✅ | ✅ | ✅ | — | — | — | ✅ |
| `meeting:generateAiDraft` 🔧 | ✅ | ✅ | ✅ | — | — | — | ✅ |
| `meeting:deleteProtocol` 🔧 | ✅ | — | — | — | — | — | ✅ |
| `task:create` | ✅ | ✅ | ✅ | ✅ | — | — | ✅ |
| `task:editAny` | ✅ | ✅ | ✅ | — | — | — | ✅ |
| `wg:invite` | ✅ | ✅ | — | — | — | — | ✅ |
| `wg:removeMember` | ✅ | — | — | — | — | — | ✅ |
| Пункти меню (`menu:*`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

> ⚠️ **Хто голосує.** `vote:cast` мають тільки `LEADER` / `DEPUTY` / `MEMBER`.
> `SECRETARY` і `GUEST` **не голосують і не входять у знаменник кворуму** —
> це найчастіше джерело непорозумінь із підрахунком.

### 4.2 Пастки RBAC

- Нова процедура **без** `can(...)` або перевірки членства = IDOR. Цей клас багів уже ловили (B-1, B-5, B-6, B-7).
- Перевіряти треба й `byId`, і `list`, і мутації — не лише мутації.
- `list`-процедури мусять **перетинати** переданий клієнтом `workingGroupId` з видимими користувачу (урок B-1), інакше чужу РГ можна перелічити.

---

## 5. Життєвий цикл стандарту

```
DRAFT ──→ IN_REVIEW ──→ VOTING ──┬──→ ADOPTED ──→ ARCHIVED
  ↑           │                   │
  │           ↓                   └──→ (REJECTED) ──→ DRAFT
  └───────────┘                            клон документа vN+1
```

### 5.1 Таблиця переходів

`STATUS_TRANSITIONS` у `src/server/routers/standard.ts`:

| Зі стану | Дозволені переходи вручну | Хто/що виконує |
|---|---|---|
| `DRAFT` | `IN_REVIEW`, `ARCHIVED` | `standard.changeStatus` |
| `IN_REVIEW` | `DRAFT`, `ARCHIVED` | `standard.changeStatus` |
| `VOTING` | `IN_REVIEW` (скасування) | тільки ручне скасування |
| `ADOPTED` | `ARCHIVED` | `standard.changeStatus` |
| `REJECTED` | `DRAFT`, `ARCHIVED` | `standard.changeStatus` |
| `ARCHIVED` | — | кінцевий стан |

**Поза цією таблицею:**

- `VOTING` досягається **тільки** через `vote.openVoting`.
- `ADOPTED` / `REJECTED` — **тільки** через `vote.closeVoting` (або `closeOverdue`).
- `ADMIN` обходить машину станів скрізь.

### 5.2 Ворота DRAFT → IN_REVIEW

Потрібен **≥1 активний документ типу `STANDARD`** (сам текст стандарту).
ТЗ (`TECH_SPEC`) — **не обов'язковий**: його відсутність не блокує ні розгляд,
ні голосування. Перевіряється і на сервері, і в UI; `ADMIN` обходить.

### 5.3 Блокування тіла в IN_REVIEW

Поки `status === 'IN_REVIEW'`, прямий WYSIWYG-редакт тіла стандарту **і**
`bodyHtml` прикріплених документів заборонений усім, крім `ADMIN`. Зміни вносяться
через пропозиції (`StandardSuggestion`). Це **не те саме**, що voting-lock нижче.

### 5.4 Поетапний план

П'ять етапів із власними дедлайнами й відмітками виконання:

| Етап (`StandardStage`) | Поле дедлайну | Поле виконання |
|---|---|---|
| ТЗ | `techSpecDueDate` | `techSpecCompletedAt` |
| Розроблення проєкту | `draftDueDate` | `draftCompletedAt` |
| Відгуки | `feedbackDueDate` | `feedbackCompletedAt` |
| Технічна перевірка | `techReviewDueDate` | `techReviewCompletedAt` |
| Фіналізація | `finalDueDate` | `finalCompletedAt` |

Дати редагуються після створення — кнопка «Терміни» в шапці степера.
Цей же план — база для перерахунку дедлайнів при копіюванні задач із шаблону (§8.3).

---

## 6. Документи

### 6.1 Типи

| Тип | Призначення | `isCurrent`? | У пікері завантаження? |
|---|---|:--:|:--:|
| `STANDARD` | Сам текст стандарту — **ціль голосування** | ✅ | ✅ |
| `TECH_SPEC` | Технічне завдання (опціональне) | ✅ | ✅ |
| `FEEDBACK` | Відгуки | — | ✅ |
| `AGENDA` | Порядок денний | — | ✅ |
| `ATTACHMENT` | Додаткові матеріали | — | ✅ |
| `MEETING_MINUTES` | Протоколи — **legacy** | — | — (модуль Протоколи) |

Видалені типи: `DRAFT_STANDARD` → `STANDARD`, `FINAL` → `ATTACHMENT`.
Міграція — бекфіл у `scripts/pre-db-push.sql`, що виконується перед
`prisma db push` на кожному старті (ADR-0005).

### 6.2 Правила

- **Активний документ** — це `lockedAt IS NULL`. Обмеження «1 `STANDARD` + 1 `TECH_SPEC`
  на стандарт» рахується **тільки серед активних**, тож заморожені снапшоти
  накопичуються без обмежень.
- `isCurrent` сервер примусово виставляє в `false` для всіх типів, крім
  `STANDARD` / `TECH_SPEC` — у `createEmpty`, `registerMetadata`, `confirmUpload`,
  `updateMeta` і в proxy-роуті завантаження.
- Заблокований документ (`lockedAt != null`) — **read-only для всіх, включно з ADMIN**.
  Відмовляють і сервер (`document.update` / `setAsCurrent` / `updateMeta`,
  `suggestion.*`), і клієнт (банер у `StandardBodyEditor`).

---

## 7. Голосування

### 7.1 Кворум

```
прийнято  ⟺  forVotes / eligibleAtClose > 0.5
```

`eligibleAtClose` — **знімок** числа активних членів РГ із ролями
`LEADER` / `DEPUTY` / `MEMBER` на момент закриття. Знімок потрібен, щоб архівний
вердикт не «попливав» при зміні складу групи.

| Приклад | Склад РГ | «За» | Результат |
|---|---|---|---|
| 1 | 5 тих, хто голосує | 1 | **Відхилено** (0.2 ≤ 0.5) |
| 2 | 5 тих, хто голосує | 3 | **Прийнято** (0.6 > 0.5) |
| 3 | 4 ті, хто голосує | 2 | **Відхилено** (0.5 не > 0.5) |
| 4 | 5 тих, хто голосує + 2 секретарі | 3 | **Прийнято** — секретарі не в знаменнику |

Утримання й «проти» на знаменник не впливають — він фіксований складом РГ.
Для історичних голосувань без знімка UI відкочується на поточний `eligibleVoters`
або `(for + against)`.

### 7.2 Що відбувається на закритті

1. Знаходиться активний (`lockedAt IS NULL`) документ типу `STANDARD`.
2. Йому проставляються `lockedAt`, `lockedByVotingId`, `isCurrent = false`.
3. До імені файлу дописується `(Голосування №N, прийнято|відхилено DD.MM.YYYY)`.
4. `Voting.documentId` запам'ятовує, що саме голосували.
5. Далі — за результатом:

| Результат | Статус стандарту | Документ |
|---|---|---|
| **ADOPTED** | `ADOPTED` | заблокований снапшот **і є** фінал, клон не створюється |
| **REJECTED** | **`DRAFT`** (не `REJECTED`) | клонується в новий редагований із версією `vN+1` |

Логіка «відхилено → назад у чернетку» свідома: РГ продовжує роботу з чистого
старту, а заблокований снапшот лишається доказом, що саме відхилили (ADR-0006).

**Голосування ніколи не видаляються.** Аварійний люк — `vote.adminWipeAll`
(тільки `ADMIN`, type-to-confirm `WIPE-ALL-VOTINGS`) у `/admin/settings` →
«Небезпечна зона»: стирає всі `Voting` + `Vote` і повертає стандарти зі станів
`VOTING`/`ADOPTED`/`REJECTED` в `IN_REVIEW` із записом в аудит.

### 7.3 Автозакриття

`vote.closeOverdue` — привілейована, ідемпотентна, `Serializable` мутація, яку
смикає погодинний cron. Вона, а не читання `vote.current`, закриває прострочені
голосування (урок B-9: читання не має мати побічних ефектів).

---

## 8. Завдання та підзадачі

### 8.1 Задача проти підзадачі

| | `Task` | `TaskChecklistItem` |
|---|---|---|
| Назва, опис | ✅ | ✅ |
| Виконавець, дедлайн | ✅ | ✅ |
| Порядок (drag-and-drop) | — | ✅ (`order`) |
| Статус | `OPEN`/`IN_PROGRESS`/`DONE`/`CANCELLED` | лише `isDone` |
| Пріоритет | ✅ | — |
| Власна сторінка | ✅ `/tasks/[id]` | — |
| Власний `ActivityLog` | ✅ | — (пише батьківська) |
| У KPI дашборда | ✅ | — |
| У лічильниках простроченого | ✅ | — |
| Вкладеність | — | рівно один рівень |

Підзадачі свідомо **не** враховуються в KPI: інакше одна задача з 24 кроками
переважила б усі інші в статистиці (ADR-0007).

### 8.2 Процедури

`task.list` · `byId` · `create` · `update` · `changeStatus` · `delete` · `overdue` ·
`checklistAdd` · `checklistToggle` · `checklistUpdate` · `checklistReorder` ·
`checklistDelete` · `copyFromTemplate`

`checklist*`-процедури внесені в exempt-список `pnpm test:audit-coverage` — аудит
веде тільки батьківська задача.

### 8.3 Шаблони задач

Шаблон — це **прапорець** `Standard.isTaskTemplate`, а не окрема сутність:
той самий UI редагує і шаблон, і звичайні задачі (ADR-0008).

Копіювання (`task.copyFromTemplate`) **перераховує** дедлайни:

1. Для кожної вихідної задачі знаходиться **найближчий етап** поетапного плану джерела.
2. Запам'ятовується зсув у днях від цього етапу.
3. У цільовому стандарті дата = відповідний етап цілі **+ той самий зсув**.

Задача без дати лишається без дати; порожній етап цілі → порожній дедлайн.
Виконавці скидаються (склад РГ різний). Режими: `append` (додати до наявних) і
`replace` (видалити наявні, в одній транзакції).

### 8.4 Подання списку

- `/tasks` — дерево РГ → Стандарт або плоский список; перемикач зберігається
  в localStorage (`tasks.viewMode.v1`). Для області «один стандарт» дерево
  недоступне — ієрархія там зайва.
- Підзадачі розкриваються шевроном просто в рядку, без переходу в картку;
  розгорнуті id зберігаються per-user (`standartotvorets.expandedTaskIds.v1`).
- На lg+ гортається **тільки** перелік завдань — шапка з фільтрами нерухома.

---

## 9. Спільна робота з текстом

Три режими роботи з тілом документа (деталі — `docs/SPEC-document-editor.md`):

| Режим | Хто | Що можна |
|---|---|---|
| **Перегляд** | усі, хто бачить стандарт | читати; режим за замовчуванням при відкритті |
| **Пропозиції** | `comment:add` | лишати `StandardSuggestion` (`REPLACE`/`INSERT_AFTER`/`DELETE`) і коментарі до фрагментів |
| **Редагування** | `standard:editBody` | прямий WYSIWYG — **крім** `IN_REVIEW` і заблокованих документів |

Пропозиції мають реакції (`LIKE`/`DISLIKE`), статус (`PENDING`/`ACCEPTED`/`REJECTED`)
і модалку прийняття з дифом. Інлайн-коментарі прив'язані до фрагмента тексту й
мають власні відповіді та стан `OPEN`/`RESOLVED`.

HTML із пропозицій **санітизується на сервері** через DOMPurify
(`src/lib/sanitizeHtml.ts`) перед збереженням — урок B-3.

---

## 10. Засідання та протоколи

- Формати: `ONLINE` / `OFFLINE` / `HYBRID`; статуси `PLANNED` → `IN_PROGRESS` → `COMPLETED` / `CANCELLED`.
- Порядок денний — `AgendaItem` із секціями `AGENDA` / `HEARD` / `DECISION` (слухали / вирішили).
- Присутність — `Attendance` зі станами `PENDING` / `CONFIRMED` / `DECLINED`.
- **ШІ-чернетка протоколу** — кнопка під формальний стиль (`src/server/ai/protocol.ts`), право `meeting:generateAiDraft`.
- **PDF-протокол** із кирилицею (шрифт NotoSans), експорт у Word.
- **iCal** — підписка на календар засідань (`src/lib/ical.ts`).

---

## 11. Сповіщення

18 типів (`NotificationType`):

| Група | Типи |
|---|---|
| Засідання | `MEETING_INVITE`, `MEETING_REMINDER`, `ATTENDANCE_DECLINED`, `PROTOCOL_PUBLISHED` |
| Голосування | `VOTE_OPENED`, `VOTE_CLOSED` |
| Документи й текст | `DOCUMENT_UPLOADED`, `COMMENT_ADDED`, `MENTION`, `SUGGESTION_NEW`, `SUGGESTION_RESOLVED` |
| Завдання | `TASK_ASSIGNED`, `TASK_OVERDUE` |
| Стандарти й етапи | `STANDARD_STATUS_CHANGED`, `STAGE_DUE_SOON`, `STAGE_OVERDUE`, `STAGE_COMPLETED` |
| Періодичні | `WEEKLY_DIGEST` |

`VOTE_OPENED` надсилається **всім** членам РГ (включно з секретарями й гостями)
**плюс** `DIRECTOR`/`ADMIN`; `emit()` дедуплікує за id користувача, тож подвійне
членство не дає двох сповіщень.

---

## 12. Планові задачі (cron)

In-process `node-cron` у `src/instrumentation.ts`, TZ `Europe/Kyiv` (ADR-0003):

| Задача | Розклад |
|---|---|
| Нагадування, дедлайни етапів, автозакриття голосувань | щогодини о `:00` (етапні нагадування — лише о 09:00) |
| Тижневий звіт керівникам | понеділок 09:00 |
| Дамп БД → S3 (ретеншен 30 днів) | щодня 03:00 |

Перемикачі: `CRON_DISABLED=1` вимикає планувальник повністю (для кількох instance),
`CRON_IN_DEV=1` дозволяє в `NODE_ENV=development`.
Ручний тригер: `GET /api/cron/{notifications,digest,backup}` (захищено `CRON_SECRET`).

---

## 13. Аудит

Кожна значима мутація пише `ActivityLog` через `logActivity()` (`src/server/audit.ts`):
хто, що, коли, `before` / `after` / `diff` у JSON. Журнал показується компонентом
`<ActivityFeed>` на картках сутностей. `activityLog.restore` дає відкат (undo).

Покриття перевіряється автоматично: `pnpm test:audit-coverage` (ts-morph) обходить
усі tRPC-мутації й вимагає або виклик `logActivity`, або явний запис у exempt-списку.
Перевірка входить у CI.

---

## 14. Карта застосунку

| Маршрут | Призначення |
|---|---|
| `/dashboard` | KPI-картки, мої завдання, найближчі засідання |
| `/working-groups`, `/working-groups/[id]` | РГ і склад |
| `/standards`, `/standards/[id]` | список і картка стандарту (вкладки: документи, обговорення, завдання, голосування) |
| `/standards/new`, `/standards/[id]/open-voting` | створення, відкриття голосування |
| `/meetings`, `/meetings/[id]`, `/meetings/[id]/protocol`, `/meetings/new` | засідання й протоколи |
| `/protocols` | реєстр протоколів |
| `/tasks`, `/tasks/[id]` | завдання (дерево / список) і картка |
| `/discussions` | наскрізні обговорення |
| `/reports` | звіти |
| `/notifications`, `/profile` | сповіщення, профіль |
| `/admin`, `/admin/users`, `/admin/permissions`, `/admin/settings` | адміністрування |
| `/login`, `/invite/[token]` | публічна зона |

**API:** `/api/trpc/*` (основний), `/api/auth/*`, `/api/health`, `/api/version`,
`/api/db-status`, `/api/cron/*`, `/api/standards/*`, `/api/documents/*`,
`/api/meetings/*`, `/api/reports/*`, `/api/working-groups/*`.

**tRPC-роутери (16):** `user`, `workingGroup`, `standard`, `document`, `vote`,
`meeting`, `task`, `notification`, `dashboard`, `activityLog`, `comment`, `search`,
`admin`, `suggestion`, `inlineComment`, `permission`.

---

## 15. Інваріанти, які легко зламати

| Інваріант | Чому важливо | Де перевіряється |
|---|---|---|
| Нова процедура має `can()` / перевірку членства | інакше IDOR (B-1, B-5…B-7) | code review |
| `list` перетинає клієнтський `workingGroupId` з видимими | інакше перелік чужих РГ | `standard.list` |
| Мутація пише `logActivity` | інакше дірка в аудиті | `pnpm test:audit-coverage` (CI) |
| `lockedAt != null` ⇒ запис заборонено всім | інакше правлять «прийнятий» текст | сервер + UI |
| Кворум рахується від `eligibleAtClose` | інакше вердикт пливе зі складом РГ | `vote.closeVoting` |
| `ADOPTED`/`REJECTED` тільки через `vote.closeVoting` | інакше обхід голосування | `STATUS_TRANSITIONS` |
| Кольори тільки токенами | інакше ламається темна тема | ESLint + `DESIGN.md` |
| Зміни схеми — лише nullable-додавання | `db push --accept-data-loss` на кожному деплої | ADR-0004, узгодження з Kir |

---

## 16. Чого в системі свідомо немає

- Вкладеності підзадач глибше одного рівня (ADR-0007).
- Міграційних файлів Prisma — схема синхронізується `db push` (ADR-0004).
- Зовнішнього планувальника — cron живе в тому ж процесі (ADR-0003).
- Видалення голосувань у звичайному потоці — лише аварійний `adminWipeAll`.
- Окремої сутності «шаблон задач» — це прапорець на стандарті (ADR-0008).
