'use client';

import { Info } from 'lucide-react';

/**
 * Пара «(i) + панель опису» для рядків списків.
 *
 * У списках завдань/підзадач опис не показується — рядок має лишатися
 * однорядковим. Але користувач не бачить, чи він взагалі є. `InfoToggle`
 * з'являється лише коли опис непорожній, тож сама наявність іконки вже
 * сигналізує «тут є деталі», а клік розкриває `DescriptionNote` під
 * рядком (inline, не popover — картки списків мають overflow-hidden,
 * плаваюча панель обрізалася б).
 */

export function InfoToggle({
  open,
  onToggle,
  className = '',
}: {
  open: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={open ? 'Сховати опис' : 'Показати опис'}
      title={open ? 'Сховати опис' : 'Показати опис'}
      onClick={(e) => {
        // Рядки часто загорнуті у <Link>/клікабельний контейнер —
        // не даємо кліку піти на навігацію.
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className={`shrink-0 inline-flex items-center justify-center w-[18px] h-[18px] rounded-full transition-colors ${
        open ? 'bg-brand-soft text-brand' : 'text-light hover:text-brand hover:bg-pill'
      } ${className}`}
    >
      <Info className="w-3.5 h-3.5" />
    </button>
  );
}

export function DescriptionNote({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div
      className={`text-[12px] leading-relaxed text-mid whitespace-pre-wrap rounded-[8px] bg-page border border-hairline px-3 py-2 ${className}`}
    >
      {text}
    </div>
  );
}
