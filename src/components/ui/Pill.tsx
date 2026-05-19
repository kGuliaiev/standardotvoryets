import type { ReactNode } from 'react';

type Tone = 'blue' | 'amber' | 'green' | 'rose' | 'purple' | 'gray';

// Two-tone palettes (light + dark) so chips don't drown the dark theme
// in muddy brown/red text. Tailwind classes here so the `.dark` class
// on <html> switches them automatically.
const TONES: Record<Tone, string> = {
  blue: 'bg-blue-50 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  amber: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  rose: 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  purple: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  gray: 'bg-pill text-mid',
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
