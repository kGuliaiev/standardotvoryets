/**
 * BullMQ Worker entry point.
 * Runs as a separate process: `pnpm worker`
 *
 * Workers will be added here as tasks are completed:
 * - TASK-006: email.worker (invite emails)
 * - TASK-012: email.worker (comment notifications)
 * - TASK-013: vote.worker (auto-close voting)
 * - TASK-016: meeting.worker (reminders)
 * - TASK-017: task.worker (overdue notifications)
 * - TASK-020: document.worker (PDF generation)
 */

import { Redis } from 'ioredis';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

// Test Redis connection on startup
const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });

redis.on('connect', () => {
  console.log('✅ Worker: Redis connected');
});

redis.on('error', (err) => {
  console.error('❌ Worker: Redis error', err);
});

console.log('🚀 Workers started. Waiting for jobs...');

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down workers...');
  await redis.quit();
  process.exit(0);
});
