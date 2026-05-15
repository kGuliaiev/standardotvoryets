'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  children: React.ReactNode;
  footer?: React.ReactNode;
  closeOnOverlay?: boolean;
}

const SIZE_CLASSES: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
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
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(8,14,33,0.55)] backdrop-blur-sm p-4 animate-fade-in"
      onMouseDown={(e) => {
        if (closeOnOverlay && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`bg-card rounded-[18px] shadow-modal w-full ${SIZE_CLASSES[size]} max-h-[92vh] overflow-y-auto`}
      >
        {title && (
          <div className="flex items-start justify-between gap-4 px-7 pt-7 pb-4">
            <div>
              {title && <h3 className="text-[18px] font-extrabold text-navy">{title}</h3>}
              {subtitle && <p className="text-[13px] text-mid mt-1">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-light hover:text-ink text-xl leading-none p-1"
              aria-label="Закрити"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}
        <div className="px-7 pb-5">{children}</div>
        {footer && (
          <div className="px-7 py-4 border-t border-hairline flex items-center justify-end gap-2.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
