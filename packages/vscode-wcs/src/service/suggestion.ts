/**
 * suggestion.ts — 「もしかして」の候補（編集距離 2 以内の最近傍）。validator が共有する
 * （独自実装すると「もしかして」の距離基準が validator ごとに割れる）。依存は文面のカタログ・候補の型・
 * 添字の読み替えだけなので、どの validator から import しても循環しない。
 */
import type { WcsMessageCatalog } from '../core/messages.js';
import type { PathCandidate } from './stateAnalyzer.js';
import { hasIndexSegment, toWildcardForm } from './indexPath.js';

/** The candidates as a tree: a path → the names under it. A deeper candidate makes the segments on its way. */
export function pathTree(candidates: readonly PathCandidate[]): Map<string, Set<string>> {
  const tree = new Map<string, Set<string>>();
  for (const c of candidates) {
    let parent = '';
    for (const segment of c.path.split('.')) {
      let names = tree.get(parent);
      if (names === undefined) tree.set(parent, (names = new Set()));
      names.add(segment);
      parent = parent === '' ? segment : `${parent}.${segment}`;
    }
  }
  return tree;
}

/**
 * The first segment of `path` the tree lacks, its parent path, and the names the tree has beside it (the keys of that
 * parent; not `*` or a `$` name). A numeric index reads as `*`, as the runtime reads it. null when every segment is there.
 */
export function missingSegment(
  path: string,
  tree: ReadonlyMap<string, ReadonlySet<string>>,
): { segment: string; parent: string; names: string[] } | null {
  let parent = '';
  for (const segment of (hasIndexSegment(path) ? toWildcardForm(path) : path).split('.')) {
    const names = tree.get(parent);
    if (names?.has(segment)) {
      parent = parent === '' ? segment : `${parent}.${segment}`;
      continue;
    }
    return { segment, parent, names: [...(names ?? [])].filter((name) => name !== '*' && !name.startsWith('$')) };
  }
  return null;
}

/**
 * 「もしかして」for a row field: the first segment of `path` the candidates lack lies under a row (a `*` before it —
 * `rows.*.amountLabl`), and a field of the same rows is near it (the runtime says the same for a data list's row).
 * Names the field (`. Did you mean "amountLabel"?`), or ''. The rows' fields are whatever the analyzer read: a data
 * list's rows, a getter's mapped literal, a JSDoc type.
 */
export function rowFieldSuggestion(path: string, candidates: readonly PathCandidate[], msgs: WcsMessageCatalog): string {
  // (built only for a path that is missing — a rare case — so not cached)
  const missing = missingSegment(path, pathTree(candidates));
  if (missing === null || !missing.parent.split('.').includes('*')) return '';
  return suggestion(missing.segment, missing.names, msgs);
}

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
