import type { ReactNode } from 'react';

type Tone = 'blue' | 'amber' | 'green' | 'rose' | 'purple' | 'gray';

const TONES: Record<Tone, string> = {
  blue: 'bg-[#EEF4FF] text-[#1A3A8F]',
  amber: 'bg-[#FFF7E6] text-[#92400E]',
  green: 'bg-[#ECFDF5] text-[#065F46]',
  rose: 'bg-[#FEF2F2] text-[#991B1B]',
  purple: 'bg-purple-50 text-purple-700',
  gray: 'bg-[#EDF0F7] text-[#4B5880]',
};

export function Pill({
  tone = 'gray',
  size = 'md',
  dot,
  children,
  className = '',
}: {
  tone?: Tone;
  size?: 'sm' | 'md';
  dot?: string;
  children: ReactNode;
  className?: string;
}) {
  const sizeCls = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold ${TONES[tone]} ${sizeCls} ${className}`}
    >
      {dot && (
        <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: dot }} />
      )}
      {children}
    </span>
  );
}
