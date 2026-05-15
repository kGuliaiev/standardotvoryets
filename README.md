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

| Сервіс | URL |
|--------|-----|
| Prisma Studio | `pnpm prisma:studio` → http://localhost:5555 |
| MinIO Console | http://localhost:9001 (minioadmin / minioadmin) |
| MailHog (email) | http://localhost:8025 |

## Корисні команди

```bash
pnpm typecheck        # перевірка TypeScript
pnpm lint             # ESLint
pnpm format           # Prettier
pnpm prisma:migrate   # нова міграція
pnpm prisma:reset     # скинути БД і перезасіяти
```

## Деплой

GitHub Actions → Railway. Деталі: `agent-pack/09_deploy.md`

Зміни в `main` автоматично деплояться на Railway.
