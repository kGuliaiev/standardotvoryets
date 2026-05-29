'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Bell, CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

/**
 * Tiny app-wide toast system (sonner-style). A module-level store lets any
 * code — including tRPC `onError`/`onSuccess` callbacks outside React — fire
 * a toast via `toast.success(...)` / `toast.error(...)` / `toast.info(...)`,
 * which appear in the bottom-right (replaces native `alert()`).
 *
 * For domain notifications (new in-app notification arrived) use
 * `toast.notify({ title, message, href })` — these appear in the **top-right**,
 * carry an optional title + click-through link, and auto-dismiss in ~5s.
 *
 * `<Toaster />` is mounted once in the root layout.
 */

type ToastVariant = 'success' | 'error' | 'info';
type ToastPosition = 'bottom-right' | 'top-right';

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
  position: ToastPosition;
  title?: string;
  href?: string;
  onClick?: () => void;
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

interface PushOptions {
  title?: string;
  href?: string;
  position?: ToastPosition;
  onClick?: () => void;
}

function push(message: string, variant: ToastVariant, ms: number, opts: PushOptions = {}) {
  const id = ++counter;
  items = [
    ...items,
    {
      id,
      message,
      variant,
      position: opts.position ?? 'bottom-right',
      title: opts.title,
      href: opts.href,
      onClick: opts.onClick,
    },
  ];
  emit();
  if (ms > 0) setTimeout(() => dismiss(id), ms);
  return id;
}

interface NotifyArgs {
  /** Bold heading (notification title). */
  title?: string;
  /** Body text — required. */
  message: string;
  /** Click-through URL (whole toast becomes clickable). */
  href?: string;
  /** Auto-dismiss in ms (default 5000). */
  durationMs?: number;
  /** Custom click handler — if set, fires instead of the default href navigation.
   *  Use this to mark the source notification as read and then navigate. */
  onClick?: () => void;
}

export const toast = {
  success: (message: string) => push(message, 'success', 4000),
  error: (message: string) => push(message, 'error', 6000),
  info: (message: string) => push(message, 'info', 4000),
  /** Top-right notification popup (5s, optional title + click-through). */
  notify: (args: NotifyArgs) =>
    push(args.message, 'info', args.durationMs ?? 5000, {
      title: args.title,
      href: args.href,
      onClick: args.onClick,
      position: 'top-right',
    }),
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

function ToastCard({ t }: { t: ToastItem }) {
  const router = useRouter();
  const v = VARIANT[t.variant];
  // For top-right notification popups prefer the bell icon over the generic info.
  const Icon = t.position === 'top-right' && t.variant === 'info' ? Bell : v.icon;

  const clickable = Boolean(t.onClick) || Boolean(t.href);
  const handleCardClick = () => {
    if (t.onClick) {
      t.onClick();
      dismiss(t.id);
      return;
    }
    if (t.href) {
      router.push(t.href);
      dismiss(t.id);
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      onClick={clickable ? handleCardClick : undefined}
      className={`flex items-start gap-2.5 rounded-xl border bg-card shadow-lg px-3.5 py-3 text-sm text-ink ${v.cls} ${clickable ? 'cursor-pointer hover:shadow-xl transition-shadow' : ''}`}
    >
      <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${v.iconCls}`} />
      <div className="flex-1 min-w-0">
        {t.title && <div className="font-semibold leading-snug break-words mb-0.5">{t.title}</div>}
        <div className="leading-snug break-words text-mid">{t.message}</div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          dismiss(t.id);
        }}
        aria-label="Закрити"
        className="shrink-0 text-light hover:text-ink transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>(items);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    listeners.add(setList);
    setList(items);
    // Expose a console-callable test helper so it's trivial to verify the
    // popup channel renders end-to-end ("In DevTools: __testToast()" — if you
    // see a top-right card, the toast infra is working; if the watcher then
    // still doesn't pop on a real notification, the bug is upstream in the
    // watcher / data, not in rendering).
    if (typeof window !== 'undefined') {
      (window as unknown as { __testToast?: () => void }).__testToast = () => {
        toast.notify({
          title: 'Тест попапу',
          message: 'Якщо ти це бачиш — top-right popup-інфра рендериться правильно.',
        });
      };
    }
    return () => {
      listeners.delete(setList);
    };
  }, []);

  if (!mounted || list.length === 0) return null;

  const topRight = list.filter((t) => t.position === 'top-right');
  const bottomRight = list.filter((t) => t.position === 'bottom-right');

  // Render via createPortal directly into <body> so the toasts escape ANY
  // ancestor stacking context (transformed/blurred parents, etc.). Critical
  // positioning is done via inline `style` instead of Tailwind classes — that
  // way the container does NOT depend on Tailwind's content-scan picking up
  // `top-20` / `right-4` / `z-[9999]` (which is exactly the failure mode that
  // kept biting us: container rendered with the classes but no CSS was emitted,
  // so it appeared at 0,0 underneath everything).
  const topRightStyle: React.CSSProperties = {
    position: 'fixed',
    top: '80px',
    right: '16px',
    zIndex: 9999,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    width: '360px',
    maxWidth: 'calc(100vw - 32px)',
    pointerEvents: 'auto',
  };
  const bottomRightStyle: React.CSSProperties = {
    ...topRightStyle,
    top: undefined,
    bottom: '16px',
  };

  return createPortal(
    <>
      {topRight.length > 0 && (
        <div style={topRightStyle} data-toast-stack="top-right">
          {topRight.map((t) => (
            <ToastCard key={t.id} t={t} />
          ))}
        </div>
      )}
      {bottomRight.length > 0 && (
        <div style={bottomRightStyle} data-toast-stack="bottom-right">
          {bottomRight.map((t) => (
            <ToastCard key={t.id} t={t} />
          ))}
        </div>
      )}
    </>,
    document.body,
  );
}
