'use client';

import { cn, getInitials } from '@/lib/utils';
import Image from 'next/image';

interface AvatarProps {
  name: string;
  avatarUrl?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-7 w-7 text-xs',
  md: 'h-8 w-8 text-sm',
  lg: 'h-10 w-10 text-base',
};

// Simple deterministic color based on name
function nameColor(name: string) {
  const colors = [
    'bg-blue-500',
    'bg-indigo-500',
    'bg-violet-500',
    'bg-emerald-500',
    'bg-teal-500',
    'bg-sky-500',
    'bg-rose-500',
    'bg-orange-500',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length] ?? 'bg-blue-500';
}

export function Avatar({ name, avatarUrl, size = 'md', className }: AvatarProps) {
  const initials = getInitials(name);
  const sizeClass = SIZE[size];

  if (avatarUrl) {
    return (
      <div className={cn('relative rounded-full overflow-hidden flex-shrink-0', sizeClass, className)}>
        <Image src={avatarUrl} alt={name} fill className="object-cover" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center font-semibold text-white flex-shrink-0',
        sizeClass,
        nameColor(name),
        className,
      )}
      title={name}
    >
      {initials}
    </div>
  );
}
