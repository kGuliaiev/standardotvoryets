# Стандартотворець

Платформа управління lifecycle стандартів у робочих групах.

## Вимоги

- Node.js 20.x LTS
- pnpm 9.x
- Docker + Docker Compose

## Старт для розробки

```bash
# 1. Клонувати репо та встановити залежності
git clone <repo_url> && cd standardotvoryets
pnpm install

# 2. Налаштувати середовище
cp .env.example .env.local
# Відредагувати .env.local (всі значення вже задані для локальної розробки)

# 3. Запустити сервіси (PostgreSQL + Redis + MinIO + MailHog)
docker compose up -d

# 4. Застосувати міграції та заповнити тестовими даними
pnpm prisma migrate dev
pnpm prisma db seed

# 5. Запустити dev-сервер
pnpm dev

# 6. (опційно) Запустити workers для черг BullMQ
pnpm worker
# або всі разом:
pnpm dev:all
```

Відкрити у браузері: http://localhost:3000

Тестовий адмін: `admin@test.ua` / `Admin123!`

## Інші сервіси (локально)

| Сервіс          | URL                                             |
| --------------- | ----------------------------------------------- |
| Prisma Studio   | `pnpm prisma:studio` → http://localhost:5555    |
| MinIO Console   | http://localhost:9001 (minioadmin / minioadmin) |
| MailHog (email) | http://localhost:8025                           |

## Корисні команди

```bash
pnpm typecheck        # перевірка TypeScript
pnpm lint             # ESLint
pnpm format           # Prettier
pnpm prisma:migrate   # нова міграція
pnpm prisma:reset     # скинути БД і перезасіяти
```

## Деплой

Проект — **standalone Docker image**, без зовнішніх залежностей від
платформи. Може бути розгорнутий на будь-якому Docker-хості з тих самих
ENV-змінних (див. `.env.example`).

### Railway (поточний production)

Railway автодетектить `Dockerfile`. Зміни в `main` гілці тригерять
автоматичний редеплой. Потрібно тільки заповнити Variables за
`.env.example`. Жодних додаткових сервісів — cron, бекапи й сповіщення
живуть всередині того ж контейнера.

### Fly.io / Render / Coolify / Docker host

```bash
docker build -t standardotvorets .
docker run -d --name standardotvorets -p 3000:3000 --env-file .env standardotvorets
```

### Повний self-hosted стек одною командою

```bash
cp .env.example .env  # обов'язково встанови NEXTAUTH_SECRET
docker compose --profile fullstack up -d
```

Підіймає app + Postgres + MinIO (S3) + Redis. Перевірка: `http://localhost:3000`.

### Cron / scheduler

Усі планові задачі (нагадування про засідання та етапи, тижневий
дайджест, нічний бекап БД) виконуються **в тому самому процесі** через
`node-cron` — зовнішній планувальник не потрібен. Графіки задані в
[`src/instrumentation.ts`](src/instrumentation.ts), часовий пояс
`Europe/Kyiv`:

| Задача                                      | Розклад                                           |
| ------------------------------------------- | ------------------------------------------------- |
| Нагадування / etap-deadlines / vote-closing | Щогодини в `:00` (stage-нагадування лише о 09:00) |
| Тижневий звіт керівникам                    | Понеділок 09:00                                   |
| Дамп БД → S3 (з ретеншеном 30 днів)         | Щодня 03:00                                       |

ENV-перемикачі: `CRON_DISABLED=1` повністю вимикає планувальник (для
сценаріїв з кількома instances), `CRON_IN_DEV=1` дозволяє його в
`NODE_ENV=development`. Ручний тригер: `GET /api/cron/{notifications,digest,backup}`
(захищений `CRON_SECRET` якщо встановлений).
