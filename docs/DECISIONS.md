# Architecture Decision Records (ADR) — Стандартотворець

Короткі записи нетривіальних рішень, щоб майбутній агент (або майбутній ти) не
переоткривав колесо. Формат кожного запису: **Контекст / Рішення / Альтернативи /
Наслідки**. Найновіші — зверху. Нумерація наскрізна (ADR-NNNN).

> Додавай запис щоразу, коли приймаєш рішення, яке хтось згодом може поставити під
> сумнів ("а чому саме так?"). Коміт ADR — окремий від коду (`docs: ADR-NNNN …`).

---

## ADR-0004 — `db push` замість міграцій Prisma

- **Дата:** 2026-05-26 (зафіксовано ретроспективно)
- **Контекст:** Railway start-команда виконує `prisma db push --accept-data-loss && prisma:seed && start` на кожному деплої. У репо немає каталогу `prisma/migrations/`.
- **Рішення:** схема — source of truth; синхронізація через `db push`. Локально теж `pnpm prisma db push` (НЕ `migrate dev`). Кастомні індекси — окремо в `prisma/indexes.sql`.
- **Альтернативи:** повноцінні міграції (`migrate deploy`) — відкинуто на ранній стадії заради швидкості ітерацій pre-launch.
- **Наслідки:** ⚠️ будь-яка несумісна зміна схеми на проді = `--accept-data-loss` може дропнути колонки/таблиці. Правило: **тільки nullable-додавання** без узгодження; деструктивні зміни — окремо й обережно. Перехід на справжні міграції — кандидат на post-launch.

## ADR-0003 — In-process cron (node-cron), без зовнішнього планувальника

- **Дата:** 2026-05-26 (ретроспективно)
- **Контекст:** потрібні нагадування (засідання, дедлайни етапів, закриття голосувань), тижневий дайджест, нічний бекап БД → S3.
- **Рішення:** усе живе в тому самому контейнері через `node-cron`, графіки в `src/instrumentation.ts` (TZ Europe/Kyiv). Ручний тригер: `GET /api/cron/{notifications,digest,backup}` (захист `CRON_SECRET`). Перемикачі `CRON_DISABLED=1`, `CRON_IN_DEV=1`.
- **Альтернативи:** Railway Cron / окремий worker-сервіс — зайва складність для single-instance.
- **Наслідки:** при масштабуванні на кілька instance треба `CRON_DISABLED=1` на всіх, крім одного (інакше дублі). Backend-QA позначив (B-28): `CRON_SECRET` через query-параметр витікає в логи — кандидат прибрати query-fallback, лишити `Authorization: Bearer`.

## ADR-0002 — Token-driven theming (CSS-змінні + Tailwind токени)

- **Дата:** 2026-05-26 (ретроспективно)
- **Контекст:** потрібен повний паритет світлої/темної теми на всіх екранах.
- **Рішення:** CSS-змінні `--c-*` у `globals.css`, клас `.dark` на `<html>`, семантичні Tailwind-токени (`bg-card`, `text-ink`, `text-mid`, `text-light`, `bg-page`, `border-hairline`, `bg-pill`, `bg-brand`…). Bootstrap-скрипт у `layout.tsx` ставить клас до гідратації (анти-FOUC).
- **Альтернативи:** `next-themes` — не використано історично; розглядається для усунення F-3 (ThemeProvider state ≠ DOM на першому рендері).
- **Наслідки:** **заборонено** hardcoded `bg-white`/`bg-slate-*`/`text-blue-*` — вони не перемикаються в dark. Lint цього не ловить → ловиться очима в QA (D-1, F-3, F-6). Рішення про спосіб усунення FOUC (cookie vs читання DOM у useState-initializer) — записати окремим ADR при фіксі F-3.

## ADR-0001 — RBAC: 3 глобальні ролі × 5 ролей у РГ, DB-override дефолтів

- **Дата:** 2026-05-26 (ретроспективно)
- **Контекст:** держ-домен з тонким розмежуванням прав по робочих групах.
- **Рішення:** глобальні `ADMIN`/`DIRECTOR`/`USER`; у РГ `LEADER`/`DEPUTY`/`SECRETARY`/`MEMBER`/`GUEST`; ~24 actions. Hardcoded `PERMISSIONS`-дефолти перевизначаються таблицею `RolePermission` (кеш у пам'яті, `ensureLoaded()` у tRPC middleware). ADMIN — short-circuit allow; DIRECTOR — повний read + actions зі своєї колонки; `seesAllWorkingGroups()` дає read-усе для ADMIN/DIRECTOR/SECRETARY (per наказ).
- **Альтернативи:** проста role-enum без per-WG — недостатньо для домену.
- **Наслідки:** легко забути перевірку прав на нових процедурах → QA-Backend знайшов цілий клас IDOR/RBAC-bypass (B-1, B-2, B-5, B-6, B-7, B-9). Правило: **кожна нова tRPC-процедура з `byId`/`list`/мутацією має явну `can(...)` або membership-перевірку**; це треба покрити regression-тестами (`tests/security/idor.test.ts`).
