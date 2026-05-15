'use client';

import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { Bell, Check, CheckCheck } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';

export function NotificationsList() {
  const utils = trpc.useUtils();
  const { data: notifications, isLoading } = trpc.notification.list.useQuery({ limit: 50 });
  const markReadMutation = trpc.notification.markRead.useMutation({
    onSuccess: () => void utils.notification.list.invalidate(),
  });
  const markAllReadMutation = trpc.notification.markAllRead.useMutation({
    onSuccess: () => void utils.notification.list.invalidate(),
  });

  const unread = notifications?.filter((n) => !n.read) ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-[19px] font-extrabold text-navy">
          Сповіщення
          {unread.length > 0 && (
            <span className="ml-2 inline-flex items-center justify-center text-xs bg-brand text-white rounded-full px-2 py-0.5 align-middle">
              {unread.length}
            </span>
          )}
        </h1>
        {unread.length > 0 && (
          <button
            onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending}
            className="btn-secondary"
          >
            <CheckCheck className="w-4 h-4" />
            Прочитати всі
          </button>
        )}
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-light text-sm">Завантаження…</div>
        ) : !notifications || notifications.length === 0 ? (
          <div className="py-16 text-center text-light text-sm">
            <Bell className="w-10 h-10 mx-auto mb-3 text-light" />
            Сповіщень немає
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {notifications.map((n) => (
              <li
                key={n.id}
                className={`flex items-start gap-3 px-5 py-4 transition-colors ${
                  n.read ? 'bg-white' : 'bg-brand-soft/40'
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${
                    n.read ? 'bg-slate-300' : 'bg-brand'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-semibold text-ink truncate">{n.title}</p>
                    <span className="text-[11px] text-light shrink-0">
                      {formatDateTime(n.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm text-mid mt-0.5">{n.body}</p>
                  {n.link && (
                    <Link
                      href={n.link}
                      className="text-xs text-brand hover:underline mt-1.5 inline-block"
                    >
                      Перейти →
                    </Link>
                  )}
                </div>
                {!n.read && (
                  <button
                    onClick={() => markReadMutation.mutate({ id: n.id })}
                    className="text-mid hover:text-brand p-1.5 rounded hover:bg-pill transition-colors"
                    title="Прочитано"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
