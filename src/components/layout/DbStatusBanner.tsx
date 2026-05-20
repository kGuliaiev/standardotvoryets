'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, X } from 'lucide-react';

/**
 * Global banner for the authenticated shell. Polls /api/db-status and,
 * when the database is unreachable, shows a clear "technical problem"
 * strip across the top of the app.
 *
 * Why this exists: a user with a valid session token gets past the
 * login gate into the app, but if the DB is down every tRPC query
 * fails and the pages just show empty / "•••" loading states with no
 * explanation. This banner tells them WHY, retries automatically, and
 * refreshes the page once the DB recovers so data reappears without a
 * manual reload.
 */

const POLL_OK_MS = 60_000; // when healthy, check once a minute
const POLL_DOWN_MS = 15_000; // when down, check more aggressively

interface DbStatus {
  ok: boolean;
  code?: string | null;
  error?: string;
  dbHost?: string | null;
  timestamp?: string;
}

export function DbStatusBanner() {
  const [down, setDown] = useState(false);
  const [info, setInfo] = useState<DbStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // Tracks whether we've ever seen the DB down this session, so a
  // recovery can trigger a one-time refresh to reload data.
  const wasDownRef = useRef(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/db-status', { cache: 'no-store' });
      if (res.ok) {
        if (wasDownRef.current) {
          // DB just recovered — reload so all the failed queries refetch
          // and the empty cards fill in.
          window.location.reload();
          return;
        }
        setDown(false);
        setInfo(null);
      } else {
        const body = (await res.json().catch(() => null)) as DbStatus | null;
        wasDownRef.current = true;
        setInfo(body);
        setDown(true);
        setDismissed(false); // re-show on a fresh failure
      }
    } catch (e) {
      wasDownRef.current = true;
      setInfo({
        ok: false,
        error: e instanceof Error ? e.message : 'Сервер не відповідає',
        code: 'EDGE',
      });
      setDown(true);
      setDismissed(false);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(
        () => {
          void check().then(schedule);
        },
        down ? POLL_DOWN_MS : POLL_OK_MS,
      );
    };
    schedule();
    return () => clearTimeout(timer);
    // `down` in deps so the interval cadence adapts when state flips.
  }, [check, down]);

  if (!down || dismissed) return null;

  return (
    <div className="bg-amber-500/15 border-b border-amber-500/40 px-4 py-2">
      <div className="flex items-center gap-3 max-w-screen-2xl mx-auto">
        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
        <div className="flex-1 min-w-0 text-xs">
          <span className="font-semibold text-amber-800 dark:text-amber-200">
            Технічна проблема: база даних недоступна.
          </span>{' '}
          <span className="text-amber-700 dark:text-amber-300/90">
            Дані можуть не завантажуватися. Перевіряємо автоматично — сторінка оновиться сама, щойно
            з’єднання відновиться.
          </span>
          {info?.code && (
            <span className="ml-2 font-mono text-[10px] text-amber-600/80 dark:text-amber-400/70">
              [{info.code}
              {info.dbHost ? ` · ${info.dbHost}` : ''}]
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void check()}
          disabled={checking}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 dark:text-amber-200 hover:underline disabled:opacity-60 shrink-0"
        >
          {checking ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          Перевірити
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          title="Сховати"
          className="text-amber-700/70 dark:text-amber-300/70 hover:text-amber-900 dark:hover:text-amber-100 shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
