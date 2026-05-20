import {
  Bell,
  Calendar,
  CheckSquare,
  Vote as VoteIcon,
  Target,
  FileText,
  MessageSquare,
  CalendarDays,
  AtSign,
  ClipboardList,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { NotificationType } from '@prisma/client';

/**
 * Shared notification presentation metadata used by both the global
 * /notifications page and the per-standard "Журнал" tab, so the filter
 * chips and per-type icons stay in sync between the two views.
 */

export interface TypeCategory {
  key: string;
  label: string;
  types: NotificationType[];
  Icon: LucideIcon;
}

export const CATEGORIES: TypeCategory[] = [
  {
    key: 'meetings',
    label: 'Засідання',
    types: ['MEETING_INVITE', 'MEETING_REMINDER', 'ATTENDANCE_DECLINED', 'PROTOCOL_PUBLISHED'],
    Icon: Calendar,
  },
  {
    key: 'stages',
    label: 'Етапи',
    types: ['STAGE_DUE_SOON', 'STAGE_OVERDUE', 'STAGE_COMPLETED', 'STANDARD_STATUS_CHANGED'],
    Icon: Target,
  },
  {
    key: 'tasks',
    label: 'Завдання',
    types: ['TASK_ASSIGNED', 'TASK_OVERDUE'],
    Icon: CheckSquare,
  },
  { key: 'voting', label: 'Голосування', types: ['VOTE_OPENED', 'VOTE_CLOSED'], Icon: VoteIcon },
  {
    key: 'comments',
    label: 'Коментарі',
    types: ['MENTION', 'COMMENT_ADDED', 'SUGGESTION_NEW', 'SUGGESTION_RESOLVED'],
    Icon: MessageSquare,
  },
  {
    key: 'docs',
    label: 'Документи',
    types: ['DOCUMENT_UPLOADED'],
    Icon: FileText,
  },
  { key: 'digest', label: 'Звіти', types: ['WEEKLY_DIGEST'], Icon: CalendarDays },
];

export const TYPE_META: Partial<Record<NotificationType, { Icon: LucideIcon; tone: string }>> = {
  MEETING_INVITE: { Icon: Calendar, tone: 'text-blue-600 dark:text-blue-400' },
  MEETING_REMINDER: { Icon: Calendar, tone: 'text-blue-600 dark:text-blue-400' },
  ATTENDANCE_DECLINED: { Icon: Calendar, tone: 'text-amber-600 dark:text-amber-400' },
  PROTOCOL_PUBLISHED: { Icon: ClipboardList, tone: 'text-emerald-600 dark:text-emerald-400' },
  STAGE_DUE_SOON: { Icon: Target, tone: 'text-amber-600 dark:text-amber-400' },
  STAGE_OVERDUE: { Icon: Target, tone: 'text-red-600 dark:text-red-400' },
  STAGE_COMPLETED: { Icon: Target, tone: 'text-emerald-600 dark:text-emerald-400' },
  STANDARD_STATUS_CHANGED: { Icon: FileText, tone: 'text-mid' },
  TASK_ASSIGNED: { Icon: CheckSquare, tone: 'text-blue-600 dark:text-blue-400' },
  TASK_OVERDUE: { Icon: CheckSquare, tone: 'text-red-600 dark:text-red-400' },
  VOTE_OPENED: { Icon: VoteIcon, tone: 'text-amber-600 dark:text-amber-400' },
  VOTE_CLOSED: { Icon: VoteIcon, tone: 'text-mid' },
  COMMENT_ADDED: { Icon: MessageSquare, tone: 'text-mid' },
  MENTION: { Icon: AtSign, tone: 'text-blue-600 dark:text-blue-400' },
  SUGGESTION_NEW: { Icon: MessageSquare, tone: 'text-blue-600 dark:text-blue-400' },
  SUGGESTION_RESOLVED: { Icon: MessageSquare, tone: 'text-emerald-600 dark:text-emerald-400' },
  DOCUMENT_UPLOADED: { Icon: FileText, tone: 'text-mid' },
  WEEKLY_DIGEST: { Icon: CalendarDays, tone: 'text-brand' },
};

export const FALLBACK_TYPE_META = { Icon: Bell, tone: 'text-mid' };

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Bucket a timestamp into a human day-group label. */
export function groupLabel(createdAt: Date | string): string {
  const t = startOfDay(new Date(createdAt));
  const today = startOfDay(new Date());
  const yesterday = today - 86_400_000;
  if (t === today) return 'Сьогодні';
  if (t === yesterday) return 'Вчора';
  const sevenAgo = today - 7 * 86_400_000;
  if (t >= sevenAgo) return 'Цього тижня';
  const thirtyAgo = today - 30 * 86_400_000;
  if (t >= thirtyAgo) return 'Цього місяця';
  return 'Раніше';
}

/** Stable display order of the day-group buckets. */
export const GROUP_ORDER = ['Сьогодні', 'Вчора', 'Цього тижня', 'Цього місяця', 'Раніше'];

export function timeOfDay(d: Date | string): string {
  return new Date(d).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

export function fullDateTime(d: Date | string): string {
  return new Date(d).toLocaleString('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
