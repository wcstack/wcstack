import { IListDiff, IListIndex } from "./types";

/**
 * Indices into `seq` whose values form a longest strictly-increasing
 * subsequence, returned in ascending order. Classic patience-sorting
 * LIS in O(n log n). `seq` values are assumed distinct (old list
 * positions are unique).
 */
export function longestIncreasingSubsequence(seq: number[]): number[] {
  const n = seq.length;
  // tails[k] = index into seq of the smallest tail of an increasing
  // subsequence of length k+1; prev[i] = predecessor index to rebuild the chain.
  const tails: number[] = [];
  const prev: number[] = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const value = seq[i];
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]] < value) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    if (lo > 0) {
      prev[i] = tails[lo - 1];
    }
    tails[lo] = i;
  }
  const result: number[] = [];
  let k = tails.length > 0 ? tails[tails.length - 1] : -1;
  while (k >= 0) {
    result.push(k);
    k = prev[k];
  }
  result.reverse();
  return result;
}

/**
 * Determines which reused list indexes can stay where they are when the DOM
 * is brought into the new list order.
 *
 * Returns null when the reused indexes already appear in their old relative
 * order (no inversions) — the caller's existing position guard then performs
 * no moves, so nothing extra is needed. When inversions exist, returns the
 * set of indexes forming a longest increasing subsequence of old positions:
 * leaving exactly those in place and moving every other content yields the
 * correct final order with the fewest content moves (the naive forward walk
 * otherwise cascades: a single swap of rows 2/999 in 1000 rows moves ~997
 * contents instead of 2).
 *
 * Note: IListIndex.index is already mutated to the NEW position by
 * createListDiff, so old positions must come from the oldIndexes array order.
 */
export function computeStableIndexSet(diff: IListDiff): ReadonlySet<IListIndex> | null {
  // No reused index changed position, or nothing was reused: relative order
  // is already correct and the walk performs no moves.
  if (diff.changeIndexSet.size === 0 || diff.addIndexSet.size === diff.newIndexes.length) {
    return null;
  }
  const oldPosByIndex = new Map<IListIndex, number>();
  for (let i = 0; i < diff.oldIndexes.length; i++) {
    oldPosByIndex.set(diff.oldIndexes[i], i);
  }
  const reused: IListIndex[] = [];
  const seq: number[] = [];
  let prevPos = -1;
  let sorted = true;
  for (const index of diff.newIndexes) {
    if (diff.addIndexSet.has(index)) {
      continue;
    }
    const pos = oldPosByIndex.get(index);
    if (pos === undefined) {
      // Invariant break (a reused index missing from oldIndexes): fall back
      // to the settle walk rather than compute a stable set from bad data.
      return null;
    }
    if (pos < prevPos) {
      sorted = false;
    }
    prevPos = pos;
    reused.push(index);
    seq.push(pos);
  }
  if (sorted) {
    return null;
  }
  const lis = longestIncreasingSubsequence(seq);
  const stable = new Set<IListIndex>();
  for (const seqIndex of lis) {
    stable.add(reused[seqIndex]);
  }
  return stable;
}
