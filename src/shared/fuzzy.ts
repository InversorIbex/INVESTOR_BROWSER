/**
 * Small fuzzy matcher for the command palette and the address bar.
 * Returns 0 for "no match"; higher is better.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = normalize(query);
  const t = normalize(text);
  if (!q) return 1;
  if (!t) return 0;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 800 - Math.min(t.length, 200);
  const wordStart = t.indexOf(' ' + q);
  if (wordStart >= 0) return 600 - wordStart;
  const idx = t.indexOf(q);
  if (idx >= 0) return 400 - idx;
  // Subsequence match, rewarding consecutive characters and word starts.
  let score = 0;
  let ti = 0;
  let streak = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return 0;
    streak = found === ti ? streak + 1 : 0;
    score += 1 + streak * 2 + (found === 0 || t[found - 1] === ' ' ? 3 : 0);
    ti = found + 1;
  }
  return Math.min(score, 199);
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

export function rankBy<T>(items: T[], query: string, text: (item: T) => string, limit = 50): T[] {
  return items
    .map((item) => ({ item, score: fuzzyScore(query, text(item)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.item);
}
