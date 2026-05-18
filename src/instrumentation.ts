/**
 * Next.js instrumentation hook (runs once when the server process starts).
 *
 * Registers in-process cron jobs using node-cron. No external scheduler
 * needed — the app handles its own notifications and backups out of the
 * box on any platform that can run the Next.js server.
 *
 * The HTTP endpoints under /api/cron/* are kept as a manual debug hatch
 * (require CRON_SECRET if set) and call the same underlying functions.
 *
 * Schedules (cron expressions are in the host's local time zone — we
 * pass timezone: 'Europe/Kyiv' so they're predictable regardless of
 * where you deploy):
 *
 *   notifications scan   — every hour at :00
 *   weekly digest        — Monday 09:00 (self-gated so over-firing is safe)
 *   database backup      — 03:00 daily (Kyiv)
 *
 * Disabled in development unless CRON_IN_DEV=1 to avoid surprise jobs
 * during local work. Disabled entirely if CRON_DISABLED=1 (useful for
 * staging / multi-instance setups where you want only one runner).
 */

export async function register() {
  // Only Node.js runtime (instrumentation also runs in edge — skip there)
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  if (process.env.CRON_DISABLED === '1') {
    console.log('[cron] CRON_DISABLED=1 — scheduler not started');
    return;
  }

  if (process.env.NODE_ENV !== 'production' && process.env.CRON_IN_DEV !== '1') {
    console.log('[cron] Dev mode — scheduler not started (set CRON_IN_DEV=1 to enable)');
    return;
  }

  // Lazy-load so the module isn't pulled into edge/middleware bundles
  const cron = await import('node-cron');
  const { runNotificationsScan, runWeeklyDigest, runDatabaseBackup } =
    await import('@/lib/cron-jobs');

  const tz = 'Europe/Kyiv';

  cron.schedule(
    '0 * * * *',
    async () => {
      try {
        const stats = await runNotificationsScan();
        console.log('[cron:notifications]', JSON.stringify(stats));
      } catch (e) {
        console.error('[cron:notifications] failed', e);
      }
    },
    { timezone: tz },
  );

  cron.schedule(
    '0 9 * * 1',
    async () => {
      try {
        const res = await runWeeklyDigest({ force: true });
        console.log('[cron:digest]', JSON.stringify(res));
      } catch (e) {
        console.error('[cron:digest] failed', e);
      }
    },
    { timezone: tz },
  );

  cron.schedule(
    '0 3 * * *',
    async () => {
      try {
        const res = await runDatabaseBackup();
        console.log('[cron:backup]', JSON.stringify(res));
      } catch (e) {
        console.error('[cron:backup] failed', e);
      }
    },
    { timezone: tz },
  );

  console.log(
    '[cron] Scheduler started (Europe/Kyiv): notifications hourly, digest Mon 09:00, backup daily 03:00',
  );
}
