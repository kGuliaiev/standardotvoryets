'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { LoginForm } from '@/components/auth/LoginForm';

/**
 * Wraps the login form with a background DB health check. The form
 * renders immediately (no latency penalty), but if /api/health comes
 * back as "db down" we swap the form for a diagnostics panel so the
 * user gets a clear "service unavailable" message instead of a
 * mysterious "wrong password" when they try to log in against a dead
 * database.
 *
 * Why gate login specifically: NextAuth's credentials provider hits
 * the DB on submit. With the DB down the user would otherwise see
 * "Невірний email або пароль", which is misleading.
 */

interface HealthDown {
  ok: false;
  db: 'down';
  error?: string;
  code?: string | null;
  dbHost?: string | null;
  timestamp?: string;
  commit?: string;
}

type Status = 'checking' | 'up' | 'down';

export function LoginGate() {
  const [status, setStatus] = useState<Status>('checking');
  const [info, setInfo] = useState<HealthDown | null>(null);

  const check = useCallback(async () => {
    setStatus('checking');
    setInfo(null);
    try {
      const res = await fetch('/api/db-status', { cache: 'no-store' });
      if (res.ok) {
        setStatus('up');
        return;
      }
      const body = (await res.json().catch(() => null)) as HealthDown | null;
      setInfo(body);
      setStatus('down');
    } catch (e) {
      // Network error reaching our own server (504/502 from the edge):
      // treat as down too, with a synthetic message.
      setInfo({
        ok: false,
        db: 'down',
        error: e instanceof Error ? e.message : 'Сервер не відповідає',
        code: 'EDGE',
      });
      setStatus('down');
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  if (status === 'down') {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-100">
            <p className="font-semibold">Сервіс тимчасово недоступний</p>
            <p className="mt-1 text-amber-200/90">
              Не вдається підключитися до бази даних. Зазвичай це тимчасово — спробуйте за кілька
              хвилин.
            </p>
          </div>
        </div>

        {/* Technical details — collapsed by default, useful for us. */}
        {info && (
          <details className="rounded-xl border border-slate-700/60 bg-slate-900/60 px-4 py-3 text-xs text-slate-300">
            <summary className="cursor-pointer select-none text-slate-400 hover:text-slate-200">
              Технічні деталі
            </summary>
            <dl className="mt-2 space-y-1 font-mono">
              {info.code && (
                <div className="flex gap-2">
                  <dt className="text-slate-500 w-20 shrink-0">code</dt>
                  <dd className="text-rose-300">{info.code}</dd>
                </div>
              )}
              {info.error && (
                <div className="flex gap-2">
                  <dt className="text-slate-500 w-20 shrink-0">error</dt>
                  <dd className="break-all">{info.error}</dd>
                </div>
              )}
              {info.dbHost && (
                <div className="flex gap-2">
                  <dt className="text-slate-500 w-20 shrink-0">db</dt>
                  <dd className="break-all">{info.dbHost}</dd>
                </div>
              )}
              {info.commit && (
                <div className="flex gap-2">
                  <dt className="text-slate-500 w-20 shrink-0">commit</dt>
                  <dd>{info.commit.slice(0, 12)}</dd>
                </div>
              )}
              {info.timestamp && (
                <div className="flex gap-2">
                  <dt className="text-slate-500 w-20 shrink-0">time</dt>
                  <dd>{info.timestamp}</dd>
                </div>
              )}
            </dl>
          </details>
        )}

        <button
          type="button"
          onClick={() => void check()}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-700 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Спробувати ще раз
        </button>
      </div>
    );
  }

  // 'checking' and 'up' both render the form. We show the form during
  // the check rather than a spinner so login feels instant when the
  // DB is healthy; the brief check only matters when it's down.
  return (
    <div className="relative">
      {status === 'checking' && (
        <div className="absolute right-0 -top-9 inline-flex items-center gap-1.5 text-[11px] text-slate-500">
          <Loader2 className="w-3 h-3 animate-spin" />
          перевірка з’єднання…
        </div>
      )}
      <LoginForm />
    </div>
  );
}
