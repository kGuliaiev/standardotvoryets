'use client';

import { useEffect, useRef } from 'react';
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
  // `full` reserves the viewport for fullscreen editor-style content
  // (kept under the 7xl Tailwind cap so the panel still has breathing
  // room on ultrawide displays).
  full: 'md:max-w-7xl',
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[200] flex md:items-center justify-center bg-page/95 backdrop-blur-2xl md:p-4 animate-fade-in items-end"
      onMouseDown={(e) => {
        if (closeOnOverlay && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`bg-card shadow-modal w-full overflow-y-auto
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
          // `bg-card` matches the panel so content scrolling underneath
          // doesn't bleed through.
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
    </div>
  );
}
