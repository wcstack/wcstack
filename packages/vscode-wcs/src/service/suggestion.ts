/**
 * suggestion.ts — 「もしかして」の候補（編集距離 2 以内の最近傍）。validator が共有する
 * （独自実装すると「もしかして」の距離基準が validator ごとに割れる）。依存は文面のカタログだけなので、
 * どの validator から import しても循環しない。
 */
import type { WcsMessageCatalog } from '../core/messages.js';

/** 編集距離 2 以内の最近傍メンバーを「もしかして」として提示する。 */
export function suggestion(input: string, candidates: readonly string[], msgs: WcsMessageCatalog): string {
  let best: string | null = null;
  let bestDistance = 3;
  for (const c of candidates) {
    const d = editDistance(input.toLowerCase(), c.toLowerCase(), bestDistance);
    if (d < bestDistance) { best = c; bestDistance = d; }
  }
  return best !== null ? msgs.didYouMean(best) : '';
}

/** バウンド付き Levenshtein（bound 以上は bound を返す）。 */
function editDistance(a: string, b: string, bound: number): number {
  if (Math.abs(a.length - b.length) >= bound) return bound;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin >= bound) return bound;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return Math.min(prev[b.length], bound);
}
