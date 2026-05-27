'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

/**
 * Tiny app-wide toast system (sonner-style). A module-level store lets any
 * code — including tRPC `onError`/`onSuccess` callbacks outside React — fire a
 * toast via `toast.success(...)` / `toast.error(...)`, replacing the native
 * `alert()` calls. `<Toaster />` is mounted once in the root layout.
 */

type ToastVariant = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

let counter = 0;
let items: ToastItem[] = [];
const listeners = new Set<(items: ToastItem[]) => void>();

function emit() {
  listeners.forEach((l) => l(items));
}

function dismiss(id: number) {
  items = items.filter((i) => i.id !== id);
  emit();
}

function push(message: string, variant: ToastVariant, ms: number) {
  const id = ++counter;
  items = [...items, { id, message, variant }];
  emit();
  if (ms > 0) setTimeout(() => dismiss(id), ms);
  return id;
}

export const toast = {
  success: (message: string) => push(message, 'success', 4000),
  error: (message: string) => push(message, 'error', 6000),
  info: (message: string) => push(message, 'info', 4000),
  dismiss,
};

const VARIANT: Record<ToastVariant, { icon: typeof CheckCircle2; cls: string; iconCls: string }> = {
  success: {
    icon: CheckCircle2,
    cls: 'border-green-200 dark:border-green-900/60',
    iconCls: 'text-green-600 dark:text-green-400',
  },
  error: {
    icon: AlertCircle,
    cls: 'border-red-200 dark:border-red-900/60',
    iconCls: 'text-red-600 dark:text-red-400',
  },
  info: {
    icon: Info,
    cls: 'border-hairline',
    iconCls: 'text-brand',
  },
};

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>(items);
  useEffect(() => {
    listeners.add(setList);
    setList(items);
    return () => {
      listeners.delete(setList);
    };
  }, []);

  if (list.length === 0) return null;

  return (
    <div className="fixed z-[200] bottom-4 right-4 flex flex-col gap-2 max-w-[calc(100vw-2rem)] w-[360px]">
      {list.map((t) => {
        const v = VARIANT[t.variant];
        const Icon = v.icon;
        return (
          <div
            key={t.id}
            role="status"
            aria-live="polite"
            className={`flex items-start gap-2.5 rounded-xl border bg-card shadow-lg px-3.5 py-3 text-sm text-ink ${v.cls}`}
          >
            <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${v.iconCls}`} />
            <span className="flex-1 leading-snug break-words">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Закрити"
              className="shrink-0 text-light hover:text-ink transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
