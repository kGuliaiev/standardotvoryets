/**
 * Ukrainian plural picker (uk-UA rule). Pass the three nominative forms:
 *   `pluralizeUk(n, ['коментар', 'коментарі', 'коментарів'])`
 *
 *   - 1, 21, 31, …             → forms[0]  (one)
 *   - 2–4, 22–24, 32–34, …     → forms[1]  (few)
 *   - 0, 5–20, 25–30, …        → forms[2]  (many)
 *
 * Works for any noun: ['день','дні','днів'], ['учасник','учасники','учасників'],
 * ['засідання','засідання','засідань'] (where one/few share a form, just pass
 * the same string).
 */
export function pluralizeUk(n: number, forms: readonly [string, string, string]): string {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/** Convenience: returns "5 коментарів" (number + space + plural form). */
export function nounUk(n: number, forms: readonly [string, string, string]): string {
  return `${n} ${pluralizeUk(n, forms)}`;
}
