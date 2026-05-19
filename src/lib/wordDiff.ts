/**
 * Word-level diff between two plain-text strings.
 *
 * Used to show "what specifically changed" inside a suggestion banner
 * — unchanged words pass through, deleted ones become red strike-
 * through, added ones become green. Tokenises on whitespace AND on
 * punctuation boundaries so single-character edits stay localised.
 *
 * The algorithm is a classic LCS / longest common subsequence DP.
 * O(n·m) time/space; fine for the paragraph-sized strings we feed it
 * (a few hundred tokens at most). For multi-paragraph diffs we'd
 * switch to Myers' algorithm to cap memory.
 */

export interface DiffPart {
  type: 'eq' | 'del' | 'add';
  text: string;
}

/** Split text into diff tokens — whitespace runs and word-like spans. */
function tokenize(s: string): string[] {
  // Keep whitespace and punctuation as their own tokens so a small
  // edit like "30 days" → "60 days" diffs as a single word change
  // rather than rewriting the whole line.
  // Letter + digit ranges chosen to cover Cyrillic + Latin without
  // needing the `u`-flag Unicode escapes (kept compatible with the
  // project's default ES2017 target).
  return s.match(/\s+|[A-Za-z0-9À-ɏЀ-ӿ]+|[^\sA-Za-z0-9À-ɏЀ-ӿ]/g) ?? [];
}

export function wordDiff(oldText: string, newText: string): DiffPart[] {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const n = a.length;
  const m = b.length;

  // Build LCS length table.
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array.from<number>({ length: m + 1 }).fill(0),
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      else dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }

  // Backtrack to produce the edit script.
  const out: DiffPart[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      out.unshift({ type: 'eq', text: a[i - 1]! });
      i--;
      j--;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
      out.unshift({ type: 'del', text: a[i - 1]! });
      i--;
    } else {
      out.unshift({ type: 'add', text: b[j - 1]! });
      j--;
    }
  }
  while (i > 0) {
    out.unshift({ type: 'del', text: a[--i]! });
  }
  while (j > 0) {
    out.unshift({ type: 'add', text: b[--j]! });
  }

  // Coalesce consecutive parts of the same type so the rendered output
  // doesn't fragment into one span per word.
  const merged: DiffPart[] = [];
  for (const p of out) {
    const last = merged[merged.length - 1];
    if (last?.type === p.type) last.text += p.text;
    else merged.push({ ...p });
  }
  return merged;
}
