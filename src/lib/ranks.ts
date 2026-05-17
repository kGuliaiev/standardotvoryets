/**
 * Ukrainian military rank metadata: enum keys → Ukrainian label + insignia.
 *
 * Insignias use Unicode chevron/star glyphs to represent shoulder boards in
 * a chat-friendly way without needing image assets. Colors match light/dark
 * theme tokens.
 */
import type { MilitaryRank } from '@prisma/client';

export interface RankInfo {
  label: string; // Ukrainian
  short: string; // shoulder-board glyph
  tier: 'civilian' | 'junior' | 'senior' | 'general';
}

export const RANKS: Record<MilitaryRank, RankInfo> = {
  CIVILIAN: { label: '', short: '', tier: 'civilian' },
  LIEUTENANT: { label: 'лейтенант', short: '★', tier: 'junior' },
  SENIOR_LIEUTENANT: { label: 'старший лейтенант', short: '★★', tier: 'junior' },
  CAPTAIN: { label: 'капітан', short: '★★★', tier: 'junior' },
  MAJOR: { label: 'майор', short: '★', tier: 'senior' },
  LIEUTENANT_COLONEL: { label: 'підполковник', short: '★★', tier: 'senior' },
  COLONEL: { label: 'полковник', short: '★★★', tier: 'senior' },
  BRIGADIER_GENERAL: { label: 'бригадний генерал', short: '✦', tier: 'general' },
  MAJOR_GENERAL: { label: 'генерал-майор', short: '✦✦', tier: 'general' },
  LIEUTENANT_GENERAL: { label: 'генерал-лейтенант', short: '✦✦✦', tier: 'general' },
  GENERAL: { label: 'генерал', short: '✦✦✦✦', tier: 'general' },
};

export const RANK_OPTIONS: { value: MilitaryRank; label: string }[] = [
  { value: 'CIVILIAN', label: 'Цивільний' },
  { value: 'LIEUTENANT', label: 'лейтенант' },
  { value: 'SENIOR_LIEUTENANT', label: 'старший лейтенант' },
  { value: 'CAPTAIN', label: 'капітан' },
  { value: 'MAJOR', label: 'майор' },
  { value: 'LIEUTENANT_COLONEL', label: 'підполковник' },
  { value: 'COLONEL', label: 'полковник' },
  { value: 'BRIGADIER_GENERAL', label: 'бригадний генерал' },
  { value: 'MAJOR_GENERAL', label: 'генерал-майор' },
  { value: 'LIEUTENANT_GENERAL', label: 'генерал-лейтенант' },
  { value: 'GENERAL', label: 'генерал' },
];

export function rankLabel(rank: MilitaryRank | null | undefined): string {
  if (!rank) return '';
  return RANKS[rank]?.label ?? '';
}

/**
 * Numeric weight for sorting: higher = more senior. Civilian = 0,
 * lieutenant = 1, …, full general = 10. Use descending order in sort.
 */
export function rankWeight(rank: MilitaryRank | null | undefined): number {
  if (!rank) return 0;
  return Math.max(
    0,
    RANK_OPTIONS.findIndex((o) => o.value === rank),
  );
}

/**
 * Extract surname from "Ім'я ПРІЗВИЩЕ" / "Ім'я По-Батькові ПРІЗВИЩЕ".
 * Military convention surnames are UPPERCASE Cyrillic — pick the last
 * such token. Falls back to the whole string for non-military names.
 */
export function extractSurname(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  // Find rightmost ALL-UPPERCASE Cyrillic token
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (!p) continue;
    if (p === p.toUpperCase() && /[А-ЯЁЇІЄҐ]/.test(p)) {
      return p;
    }
  }
  return parts[parts.length - 1] ?? fullName;
}

/**
 * Returns Tailwind classes for the shoulder-board pill based on rank tier.
 * Civilian renders nothing.
 */
export function rankPillClasses(rank: MilitaryRank | null | undefined): string {
  const tier = rank ? RANKS[rank]?.tier : 'civilian';
  switch (tier) {
    case 'junior':
      return 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
    case 'senior':
      return 'bg-amber-200 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200';
    case 'general':
      return 'bg-rose-200 text-rose-900 dark:bg-rose-900/50 dark:text-rose-200';
    default:
      return '';
  }
}
