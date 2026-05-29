'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  children: React.ReactNode;
  footer?: React.ReactNode;
  closeOnOverlay?: boolean;
}

const SIZE_CLASSES: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'md:max-w-sm',
  md: 'md:max-w-lg',
  lg: 'md:max-w-2xl',
  xl: 'md:max-w-4xl',
  // `full` reserves almost the entire viewport for fullscreen editor-style
  // content (e.g. the document body editor) — the panel already has w-full
  // and the container adds ~16px gutters, so 96vw leaves a thin margin and
  // uses the rest of the screen instead of wasting it on side whitespace.
  full: 'md:max-w-[96vw]',
};

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  size = 'md',
  children,
  footer,
  closeOnOverlay = true,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // We render via createPortal to <body>. `mounted` keeps the first
  // SSR pass empty (no portal target yet) and renders client-side.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    // Remember whoever opened the modal so we can return focus to them on
    // close (F-2 — WCAG 2.4.3 Focus Order).
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const FOCUSABLE_SELECTOR =
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      // F-2 focus-trap: Tab / Shift+Tab cycles inside the panel.
      if (e.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusables.length === 0) {
          e.preventDefault();
          panelRef.current.focus();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (!panelRef.current.contains(active)) {
          e.preventDefault();
          first?.focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Initial focus: first interactive element inside the panel, skipping
    // the close-X (so a form modal lands the cursor in the first input, not
    // on "Закрити"). Defer to a microtask so any child with autoFocus fires
    // first — if so, respect it.
    const focusTimer = window.setTimeout(() => {
      if (!panelRef.current) return;
      if (panelRef.current.contains(document.activeElement)) return; // autoFocus already won
      const all = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      const nonClose = all.filter((el) => el.getAttribute('aria-label') !== 'Закрити');
      const target = nonClose[0] ?? all[0] ?? panelRef.current;
      target.focus();
    }, 0);

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(focusTimer);
      // F-2: return focus to the opener so keyboard users land where they were.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  // Portal'd to <body> so the overlay covers the entire viewport
  // regardless of stacking contexts on the Shell / Sidebar / Topbar
  // wrappers. Without the portal, `fixed inset-0` is positioned
  // relative to the nearest containing block whose transform/filter
  // breaks viewport semantics, leaving the top edge uncovered.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[200] flex md:items-center justify-center bg-[rgba(8,14,33,0.55)] backdrop-blur-md md:p-4 animate-fade-in items-end"
      // F-10: onClick (not onMouseDown) so selecting text inside the modal
      // and accidentally releasing the mouse on the backdrop doesn't close it.
      onClick={(e) => {
        if (closeOnOverlay && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`bg-card shadow-modal w-full overflow-y-auto outline-none
          md:rounded-[18px] md:max-h-[92vh]
          rounded-t-[18px] max-h-[90vh] animate-[slideInFromBottom_220ms_ease-out]
          md:animate-fade-in ${SIZE_CLASSES[size]}`}
      >
        {/* Grab-handle (mobile only) */}
        <div className="md:hidden flex justify-center py-2">
          <span className="w-10 h-1 rounded-full bg-hairline" />
        </div>
        {title && (
          // Sticky so the title (and close button) stay visible inside
          // long-scrolling modals — especially `size="full"` editors.
          <div className="sticky top-0 z-30 bg-card/90 backdrop-blur-md flex items-start justify-between gap-4 px-5 md:px-7 pt-3 md:pt-7 pb-4 border-b border-hairline">
            <div>
              {title && (
                <h3 className="text-[16px] md:text-[18px] font-extrabold text-navy">{title}</h3>
              )}
              {subtitle && <p className="text-[13px] text-mid mt-1">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-light hover:text-ink text-xl leading-none p-1 -mr-1"
              aria-label="Закрити"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}
        <div className="px-5 md:px-7 pb-5">{children}</div>
        {footer && (
          <div className="px-5 md:px-7 py-4 border-t border-hairline flex items-center justify-end gap-2.5 sticky bottom-0 bg-card">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
