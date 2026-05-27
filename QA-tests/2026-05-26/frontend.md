# QA-frontend — Стандартотворець, 2026-05-26

**Скоуп:** UI/клиентский слой Next.js-приложения (App Router, React 18,
Tailwind + Radix). Параллельно работают QA-Designer (визуал) и
QA-Backend (API/tRPC).

**Тестовое окружение:** prod — <https://standart.202ok.online/>
(Railway). Логин `admin@test.ua` / `Admin123!`. Local repo: `src/**`.

**Браузер:** Chrome (Claude in Chrome MCP), viewport ≈ 1562×784,
тёмная и светлая тема.

**Длительность:** ~60 мин.

---

## 1. Что проверено (E2E на prod)

| #   | Сценарий                                            | Результат                                                                                                                          |
| --- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Login (валид. creds)                                | ✅ редирект `/login → /dashboard`, сессия пишется                                                                                  |
| E2  | Login (пустые поля)                                 | ✅ client-side валидация Zod: «Введіть коректний email», «Введіть пароль»                                                          |
| E3  | Login (неверный пароль)                             | ✅ серверная ошибка показывается в баннере: «Невірний email або пароль», поля не очищаются                                         |
| E4  | Logout (`Вийти`)                                    | ✅ редирект на `/login`, сессия сброшена                                                                                           |
| E5  | CRUD стандарта (create → edit → archive)            | ✅ создан `[QA-TEST]`, отредактирован, заархивирован. ID `cmpoc1qpm0001gb43j0h5nhrm`                                               |
| E6  | XSS в имени стандарта (`<script>alert(1)</script>`) | ✅ выводится как escaped text — React `{value}` экранирует, в title `<h2>` и описании одинаково безопасно                          |
| E7  | XSS в описании (`<b>HTML</b>`)                      | ✅ выводится как plain text, не как жирный — escaping работает                                                                     |
| E8  | 404 на `/standards/<bad-id>`                        | ⚠️ пустой экран Shell + «Стандарт не знайдено». Нет CTA «Повернутися до списку»                                                    |
| E9  | 404 на неизвестном пути `/nonexistent-route`        | ❌ дефолтный Next.js «404 — This page could not be found.» — без brand, без локализации, без линка домой                           |
| E10 | Validation формы «Новий стандарт» (пустой submit)   | ✅ три инлайн-сообщения: «Оберіть робочу групу», «Мінімум 2 символи», «Мінімум 5 символів»                                         |
| E11 | Bulk-archive выделенного стандарта                  | ⚠️ работает без confirmation-dialog — кликнул `Архівувати`, действие применилось мгновенно. Для destructive flow надо ConfirmModal |
| E12 | Edit modal (открыть/save/close)                     | ✅ модалка с backdrop, save через tRPC POST, list-counter в sidebar реактивно обновляется (12→13→12)                               |
| E13 | Theme toggle (Sun/Moon в Topbar)                    | ⚠️ работает, но при logout/login наблюдается рассинхрон состояния React и DOM — см. F-3                                            |
| E14 | Network panel batching                              | ✅ tRPC использует `httpBatchLink` — dashboard грузит 8 процедур одним GET                                                         |
| E15 | Polling                                             | ⚠️ `dashboard.navCounts` + `comment.unreadCountForUser` пингуют каждые 60s — приемлемо, но добавит фон у 100+ юзеров               |

### Что НЕ проверено (по причинам)

- E2E с non-admin user (`olena.kovalenko@test.ua`) — пропущено из-за
  ограничений сессии Chrome MCP в текущем прогоне; CRUD без admin прав
  стоит проверить в следующей итерации (см. F-4 риск).
- Lighthouse — Chrome MCP `lighthouse`-инструмента нет; раздел
  Performance закрыт через ручной network-sweep (15 уникальных
  chunks, ~200 запросов на dashboard за 4 сек включая polling).
- Mobile-viewport — отложено, в `CONTINUATION.md` отмечено как
  future backlog.

---

## 2. Найденные баги

### F-1 [HIGH] — tRPC dev-logger включён в production-bundle

**Где:** `src/lib/trpc/client.ts` (предположительно
`loggerLink({enabled: () => true})` или без условия).

**Симптом:** На каждый запрос tRPC в DevTools Console сыпется лог
`%c << query #N %cstandard.byId%c %O` со специфическим bg-цветом
`#3fb0d8`. На `/admin/users` за один заход — 4 таких сообщения. На
страницах с polling — каждые 60 сек добавляются ещё. Сообщения
помечаются как `[ERROR]`, что вводит в заблуждение при триaже.

**Шаги:**

1. Открыть https://standart.202ok.online/ под админом.
2. F12 → Console.
3. Перейти на любую страницу с tRPC-запросами.
4. Каждый запрос даёт `<<` и `>>` записи.

**Рекомендация:** `src/lib/trpc/client.ts` — в `loggerLink({...})`
проставить `enabled: (op) => process.env.NODE_ENV !== 'production' || op.direction === 'down' && op.result instanceof Error`.
В production оставить только реальные ошибки.

---

### F-2 [HIGH] — Modal не имеет focus-trap и не возвращает focus

**Где:** `src/components/ui/Modal.tsx` lines 32–113.

**Симптом:** `role="dialog"` + `aria-modal="true"` проставлены, но:

- Tab/Shift+Tab выводит фокус за пределы модалки (на сайдбар, topbar).
- Открытие модалки не фокусирует первый интерактивный элемент.
- Закрытие модалки не возвращает фокус на триггер (теряется).
- Объявлен `panelRef = useRef<HTMLDivElement>(null)`, но нигде не
  используется (мёртвый код, line 41 + ref={panelRef} line 88).

**Рекомендация:** Использовать `@radix-ui/react-dialog` (уже в
deps!) или интегрировать `focus-trap-react`. На минимум — `useEffect`
с `panelRef.current?.querySelector<HTMLElement>('button, [href], input, select, textarea')?.focus()`
при open=true; при close — `previouslyFocusedRef.current?.focus()`.

`src/components/ui/Modal.tsx:88` — переписать на `<Dialog.Root>` из Radix.

---

### F-3 [MEDIUM] — Theme provider создаёт state-mismatch с DOM

**Где:** `src/components/providers/ThemeProvider.tsx` lines 21–37,
`src/app/layout.tsx` lines 23–32 (themeBootstrap).

**Симптом:** Inline `themeBootstrap` правильно ставит класс `dark`
на `<html>` ДО гидратации (нет FOUC контента). Но React-state
`useState<Theme>('light')` стартует с `light`, и реальное чтение
localStorage происходит только в `useEffect`. В результате:

- Любой компонент, читающий `useTheme().theme` на первом рендере,
  получает `light` даже когда DOM уже тёмный.
- Иконка toggle (Sun/Moon в Topbar) может мелькнуть и переключиться.
- Наблюдаемо: после logout → login страница на момент видна в
  светлой теме, потом «прыгает» в тёмную.

**Рекомендация:** Прокинуть начальный theme как cookie (читается на
сервере → Server Component → пропсом в `<ThemeProvider initial=...>`),
ИЛИ инлайнить `data-theme` в `<html>` атрибут и читать его в
useState-initializer:

```ts
const [theme, setThemeState] = useState<Theme>(() => {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
});
```

И удалить дублирующий `useEffect`.

`src/components/providers/ThemeProvider.tsx:22`.

---

### F-4 [MEDIUM] — Bulk-archive без подтверждения

**Где:** `src/app/(app)/standards/StandardList.tsx` (детали не
прочитаны, но bulk-bar виден на `/standards`).

**Симптом:** Чекбокс → bulk-bar → клик `Архівувати` → действие
применяется без диалога. Несмотря на то что архив реверсивен (есть
вкладка «Архів»), это легко сделать массово и случайно. У вас есть
готовый `ConfirmModal` (`src/components/ui/ConfirmModal.tsx`) — он
именно для этого.

**Рекомендация:** Заменить прямой mutate на
`<ConfirmModal destructive title="Архівувати стандарт?" ...>`. То же
сделать для **Деактивувати** в `/admin/users` (видно прямо как
красная кнопка в строке).

---

### F-5 [MEDIUM] — Default 404 страница без брендинга

**Где:** нет `src/app/not-found.tsx`.

**Симптом:** Любой неизвестный путь (`/nonexistent-route`) даёт
дефолтный Next.js экран «404 — This page could not be found.»,
английский текст, чёрный фон, без линка на дашборд.

**Рекомендация:** Создать `src/app/not-found.tsx` с переводом
«Сторінку не знайдено» + кнопка «На головну». Аналогично
`src/app/error.tsx` для unhandled exceptions.

---

### F-6 [MEDIUM] — LoginForm использует hardcoded цвета вместо токенов

**Где:** `src/components/auth/LoginForm.tsx` lines 56–105.

**Симптом:** `bg-slate-900/60`, `border-slate-700`, `text-slate-300`,
`text-white`, `bg-blue-600` — все хардкод. По
`CONTINUATION.md → "Известные gotchas"`: `bg-slate-*` не
переключается автоматически в dark mode. Логин-страница в dark theme
выглядит непредсказуемо (тёмный фон + тёмные инпуты сливаются).

**Рекомендация:** перейти на токены: `bg-pill`, `border-hairline`,
`text-ink`, `text-mid`, `bg-brand`. Особенно для логин-карточки —
визуально login-окно сейчас один из выпадающих островков.

---

### F-7 [LOW] — Show-password button без accessible name

**Где:** `src/components/auth/LoginForm.tsx:95-101`.

**Симптом:** `<button type="button" onClick={...}>` показывает Eye
иконку, но не имеет ни `aria-label`, ни видимого текста. Screen reader
прочитает её как «button» без контекста.

**Рекомендация:**

```tsx
<button
  type="button"
  onClick={() => setShowPassword((v) => !v)}
  aria-label={showPassword ? 'Сховати пароль' : 'Показати пароль'}
  ...
>
```

---

### F-8 [LOW] — Sidebar active-link не выставляет aria-current

**Где:** `src/components/layout/Sidebar.tsx` — построение `<Link>`
для каждого `NavItem`. Active state виден визуально, но `aria-current="page"`
не проставляется → screen reader не сообщит, что вы на этой странице.

**Рекомендация:** добавить `aria-current={isActive ? 'page' : undefined}`
в проп `<Link>`.

---

### F-9 [LOW] — `TaskFormModal` useEffect deps включают объект `initial`

**Где:** `src/components/TaskFormModal.tsx:67-77`.

**Симптом:** `useEffect(..., [open, initial, lockedStandardId, lockedWorkingGroupId])`.
`initial` — объект, в большинстве вызовов литерал. Каждый render
родителя создаёт новую ссылку → форма сбрасывается посреди ввода,
если родитель ререндерится по polling/ws.

**Рекомендация:** либо `useMemo` для `initial` у вызывающего, либо
завернуть в реф и сравнивать по `initial?.id` (как уже делается у
`editing`).

---

### F-10 [LOW] — Modal `onMouseDown` для закрытия по backdrop

**Где:** `src/components/ui/Modal.tsx:80`.

**Симптом:** `onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}`.
Если пользователь выделяет текст в модалке и mouseup случайно
оказывается на backdrop — фильтр `target === currentTarget` проходит
и модалка закрывается. Лучше `onClick` (срабатывает только если
mousedown и mouseup на одном target).

**Рекомендация:** заменить `onMouseDown` на `onClick`.

---

### F-11 [INFO] — Mobile responsiveness не покрыта тестами

**Где:** общее.

В `CONTINUATION.md → "Future backlog"` mobile-версия отмечена как
2-3 недели работы. На текущий момент на viewport < 768px:

- Sidebar 228px съедает половину экрана (нет hamburger).
- Modal `<size=full>` рассчитан на desktop.
- Таблицы стандартов/пользователей с >5 колонок переполняются.

**Рекомендация:** перед мобайл-итерацией поставить media-query
breakpoint-snapshots в Playwright (`375px / 768px / 1024px / 1440px`).

---

## 3. Recommendations / next steps

1. **Установить Vitest** и подключить тесты, добавленные в этом
   прогоне (см. раздел 4). Скрипт:
   ```bash
   pnpm add -D vitest @vitest/ui happy-dom \
     @testing-library/react @testing-library/jest-dom @testing-library/user-event
   ```
   В `package.json`:
   ```json
   "test": "vitest run",
   "test:watch": "vitest",
   "test:coverage": "vitest run --coverage"
   ```
2. **Добавить Playwright** (или Cypress) и оформить smoke E2E:
   `tests/e2e/login.spec.ts`, `tests/e2e/standard-crud.spec.ts`,
   `tests/e2e/permission.spec.ts`. Конфиг — `baseURL`
   из ENV (локально `http://localhost:3000`, в CI — staging).
3. **CI gate**: `pnpm typecheck && pnpm lint && pnpm test &&
pnpm test:audit-coverage`. Falsify any of the four → блок мержа.
4. **a11y CI**: `@axe-core/playwright` в smoke-тестах автоматизирует
   находки F-2 / F-7 / F-8.
5. **Заменить кастомный `Modal` на `@radix-ui/react-dialog`** —
   Radix уже в зависимостях, дает focus-trap + initial/return focus
   из коробки. Это разом закроет F-2, F-10 и часть будущей
   мобильной адаптации.

---

## 4. Coverage до/после

### До прогона

- **Unit (Vitest/Jest):** 0 тестов, инфраструктура не настроена.
- **E2E (Playwright/Cypress):** 0.
- **Integration:** `scripts/test-modules.ts` (CRUD over tRPC, требует
  БД) + `scripts/audit-coverage.ts` (ts-morph статический анализ
  `logActivity` покрытия мутаций). Эти не покрывают frontend.

### После прогона

- **Unit (Vitest):**
  - `src/lib/__tests__/utils.test.ts` — 11 кейсов (cn, formatBytes,
    formatDate, formatDateTime, getInitials).
  - `src/lib/__tests__/wordDiff.test.ts` — 5 кейсов (identical,
    add-only, del-only, punctuation preservation, Cyrillic edits).
  - `src/lib/__tests__/standardBody.test.ts` — 13 кейсов
    (isPlainTextBody, migratePlainTextToHtml + XSS escape,
    normalizeBodyHtml, splitHtmlBlocks).
  - `src/lib/__tests__/ranks.test.ts` — 7 кейсов (метаданные,
    rankLabel, rankWeight sort-order).
  - `src/lib/__tests__/rbac.test.ts` — 8 кейсов (canAccessGroup,
    getUserRoleInGroup, can() short-circuits).
  - **Итого: 44 unit-кейса** (надо `pnpm i` + `pnpm test` для запуска).
- **E2E:** не добавлены файлы — Playwright не установлен в проекте;
  выше дана дорожная карта.
- **Покрытие лучше всего смотреть `pnpm test:coverage` после
  установки vitest (HTML-отчёт в `./coverage/`).**

### Уже протестированные компоненты (visually/manually)

- Modal (open/close/escape) — частично, но без a11y-тестов.
- LoginForm — manually E1–E3.
- StandardList + bulk-bar — E5, E11.
- Sidebar — passive observation (нет тестов).

### Не протестированы вовсе

- `RichTextEditor.tsx` (TipTap), `StandardBodyEditor.tsx`,
  `DocumentUploadModal.tsx`, `DocumentEditMetaModal.tsx`,
  `MentionTextarea.tsx`, `CommandPalette.tsx` (Cmd+K глобальный
  поиск), `CommentsThread.tsx`, `InlineComments.tsx`,
  `ActivityFeed.tsx`, `standards/StandardProgress.tsx`,
  `ui/SortableHeader.tsx`, `ui/StatusBadge.tsx`, `ui/Pill.tsx`,
  `ui/RankBadge.tsx`.

---

## 5. Top issues (краткий summary для лида)

| #       | Severity | Issue                                                                                       | Файл                                            |
| ------- | -------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **F-1** | HIGH     | tRPC dev-logger в проде → шум в Console, лишний CPU                                         | `src/lib/trpc/client.ts`                        |
| **F-2** | HIGH     | Modal без focus-trap и без возврата фокуса (WCAG 2.4.3, 2.4.7)                              | `src/components/ui/Modal.tsx:88`                |
| **F-3** | MEDIUM   | ThemeProvider state ≠ DOM на первом рендере — мерцание иконки/потенциальный визуальный jump | `src/components/providers/ThemeProvider.tsx:22` |
| **F-4** | MEDIUM   | Destructive bulk-actions без ConfirmModal                                                   | `src/app/(app)/standards/StandardList.tsx`      |
| **F-5** | MEDIUM   | Нет custom `not-found.tsx` / `error.tsx`                                                    | `src/app/`                                      |
| **F-6** | MEDIUM   | LoginForm hardcoded slate/blue — не темизируется                                            | `src/components/auth/LoginForm.tsx`             |
| F-7     | LOW      | Show-password button без aria-label                                                         | `src/components/auth/LoginForm.tsx:95`          |
| F-8     | LOW      | Sidebar активный link без `aria-current="page"`                                             | `src/components/layout/Sidebar.tsx`             |
| F-9     | LOW      | TaskFormModal useEffect rerun на каждый ререндер родителя                                   | `src/components/TaskFormModal.tsx:67`           |
| F-10    | LOW      | Modal закрывается по mouseDown на backdrop (false-positive при выделении текста)            | `src/components/ui/Modal.tsx:80`                |
| F-11    | INFO     | Mobile responsiveness ниже 768px не покрыта                                                 | global                                          |

---

## 6. Артефакты прогона

- Скриншоты (`ss_*` IDs в логах Chrome MCP) — не сохранены отдельно,
  доступны из истории сессии.
- Тестовая запись `[QA-TEST] Після редагування` (id
  `cmpoc1qpm0001gb43j0h5nhrm`) **архивирована**, не удалена — в проде
  её можно вернуть из вкладки «Архів» или окончательно удалить через
  admin.
- Тесты добавлены: `vitest.config.ts`,
  `src/lib/__tests__/{utils,wordDiff,standardBody,ranks,rbac}.test.ts`.
  Запуск — после `pnpm add -D vitest happy-dom @vitest/ui`.

## 7. Backend / Designer overlap

- **F-1** (логгер) частично затрагивает QA-Backend — там же возможно
  включён `loggerLink` на серверной стороне (`@trpc/server`). Стоит
  свериться.
- **F-3, F-6** — на стыке с QA-Designer (тема/токены). Перед фиксом
  согласовать palette.
- **F-2, F-7, F-8** — чистый frontend.
