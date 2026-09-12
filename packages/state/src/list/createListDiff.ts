import "../polyfills";
import { createListIndex } from "./createListIndex";
import { getLastRegisteredListIndexes, getListIndexesByList, setListIndexesByList } from "./listIndexesByList";
import { IListDiff, IListIndex } from "./types";

/** 親が null（ルート直下のリスト）の diff を入れるための番兵。 */
const ROOT_PARENT: object = Object.freeze({});

/**
 * (親, 旧リスト, 新リスト) → diff のメモ。**親をキーに含める**のが要点。同じ
 * (旧, 新) の組でも親が違えば別の diff になる ── 1 本の配列を 2 つの行が子として
 * 持つ形では、どちらの親から見ても基準が空なので (旧, 新) が完全に一致し、親を
 * 落とすと後から来た親が先着の親の行をそのまま受け取ってしまう（#256）。
 */
const listDiffByOldListByNewListByParent =
  new WeakMap<object, WeakMap<readonly unknown[], WeakMap<readonly unknown[], IListDiff>>>();

const EMPTY_LIST = Object.freeze([]);
const EMPTY_SET = new Set<IListIndex>();

function getListDiff(
  parentKey: object,
  rawOldList: readonly unknown[],
  rawNewList: readonly unknown[],
): IListDiff | null {
  const diffByOldList = listDiffByOldListByNewListByParent.get(parentKey);
  if (!diffByOldList) {
    return null;
  }
  const oldList = (Array.isArray(rawOldList) && rawOldList.length > 0) ? rawOldList : EMPTY_LIST;
  const newList = (Array.isArray(rawNewList) && rawNewList.length > 0) ? rawNewList : EMPTY_LIST;
  const diffByNewList = diffByOldList.get(oldList);
  if (!diffByNewList) {
    return null;
  }
  return diffByNewList.get(newList) || null;
}

function setListDiff(
  parentKey: object,
  oldList: readonly unknown[],
  newList: readonly unknown[],
  diff: IListDiff,
): void {
  let diffByOldList = listDiffByOldListByNewListByParent.get(parentKey);
  if (!diffByOldList) {
    diffByOldList = new WeakMap<readonly unknown[], WeakMap<readonly unknown[], IListDiff>>();
    listDiffByOldListByNewListByParent.set(parentKey, diffByOldList);
  }
  let diffByNewList = diffByOldList.get(oldList);
  if (!diffByNewList) {
    diffByNewList = new WeakMap<readonly unknown[], IListDiff>();
    diffByOldList.set(oldList, diffByNewList);
  }
  diffByNewList.set(newList, diff);
}
/**
 * Checks if two lists are identical by comparing length and each element.
 * @param oldList - Previous list to compare
 * @param newList - New list to compare
 * @returns True if lists are identical, false otherwise
 */
function isSameList(oldList: readonly unknown[], newList: readonly unknown[]): boolean {
  if (oldList.length !== newList.length) {
    return false;
  }

  for (let i = 0; i < oldList.length; i++) {
    if (oldList[i] !== newList[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Aligns each list index's .index with its position in the new list.
 * A diff only becomes the rendered state once the updater applies it: an
 * earlier diff in the same batch (two replacements in one microtask) may have
 * moved shared indexes toward a list that never got applied, and a cache hit
 * skips recomputation entirely — so every createListDiff return re-aligns.
 */
function syncListIndexes(newIndexes: IListIndex[]): void {
  for (let i = 0; i < newIndexes.length; i++) {
    if (newIndexes[i].index !== i) {
      newIndexes[i].index = i;
    }
  }
}

/**
 * Creates or updates list indexes by comparing old and new lists.
 * Optimizes by reusing existing list indexes when values match.
 * @param parentListIndex - Parent list index for nested lists, or null for top-level
 * @param oldList - Previous list (will be normalized to array)
 * @param newList - New list (will be normalized to array)
 * @param oldIndexes - Array of existing list indexes to potentially reuse
 * @returns Array of list indexes for the new list
 */
export function createListDiff(
  parentListIndex: IListIndex | null,
  rawOldList: unknown,
  rawNewList: unknown,
): IListDiff {
  const diff = computeListDiff(parentListIndex, rawOldList, rawNewList);
  syncListIndexes(diff.newIndexes);
  return diff;
}

function computeListDiff(
  parentListIndex: IListIndex | null,
  rawOldList: unknown,
  rawNewList: unknown,
): IListDiff {
  // Normalize inputs to arrays (handles null/undefined)
  const oldList: readonly unknown[] = (Array.isArray(rawOldList) && rawOldList.length > 0) ? rawOldList : EMPTY_LIST;
  const newList: readonly unknown[] = (Array.isArray(rawNewList) && rawNewList.length > 0) ? rawNewList : EMPTY_LIST;
  const parentKey: object = parentListIndex ?? ROOT_PARENT;
  const cachedDiff = getListDiff(parentKey, oldList, newList);
  if (cachedDiff) {
    return cachedDiff;
  }
  // 台帳は (親, 配列) の組ごとに私有（listIndexesByList.ts）。この親のもとに行が
  // 無い（null）ということは、この親がこのリストを一度も展開していないということ。
  // 他の親の行を引き継ぐことはできない（それが #256 の別名化）ので、旧側は空として
  // 扱い、下の全行 add 分岐＝既存の鋳造経路へ落とす。
  const ownedOldIndexes = getListIndexesByList(oldList, parentListIndex);
  const oldIndexes = ownedOldIndexes ?? [];
  let retValue: IListDiff | undefined;
  try {
    // Early return for empty list
    if (newList.length === 0) {
      return retValue = {
        oldIndexes: oldIndexes,
        newIndexes: [] as IListIndex[],
        changeIndexSet: EMPTY_SET,
        deleteIndexSet: new Set<IListIndex>(oldIndexes),
        addIndexSet: EMPTY_SET,
      };
    }
    // If old list was empty, create all new indexes
    let newIndexes: IListIndex[] | null = getListIndexesByList(newList, parentListIndex);
    // この親には前世代の行が無い ── 旧リストが空（初回・別名化した 2 人目の親）か、
    // この親がこのリストを一度も展開していないか（親の付け替え）。どちらも全行 add で、
    // 位置変更は記録しない。違うのは**退役**の有無だけ:
    //  - 旧リストが空 ＝ 消すものが無い。ここで他の親の生きた行を delete 扱いにすると、
    //    別名化した親の描画済み content を消してしまう。
    //  - 親の付け替え ＝ 消費者は前世代の行を identity で握ったままなので、名指して
    //    消さないと content が画面に残る（単一スロット時代と同じ削除の帳簿に戻す）。
    if (oldList.length === 0 || ownedOldIndexes === null) {
      if (newIndexes === null) {
        newIndexes = [];
        for(let i = 0; i < newList.length; i++) {
          const newListIndex = createListIndex(parentListIndex, i);
          newIndexes.push(newListIndex);
        }
      }
      const retired = ownedOldIndexes === null
        ? (getLastRegisteredListIndexes(oldList) ?? [])
        : oldIndexes;
      const addIndexSet = new Set<IListIndex>(newIndexes);
      return retValue = {
        oldIndexes: retired,
        newIndexes: newIndexes,
        changeIndexSet: EMPTY_SET,
        deleteIndexSet: retired.length === 0
          ? EMPTY_SET
          : (new Set<IListIndex>(retired)).difference(addIndexSet),
        addIndexSet: addIndexSet,
      };
    }
    // If lists are identical, return existing indexes unchanged (optimization)
    if (isSameList(oldList, newList)) {
      return retValue = {
        oldIndexes: oldIndexes,
        newIndexes: oldIndexes,
        changeIndexSet: EMPTY_SET,
        deleteIndexSet: EMPTY_SET,
        addIndexSet: EMPTY_SET,
      };
    }
    if (newIndexes !== null) {
      return calcDiffIndexes(oldIndexes, newIndexes);
    }
    newIndexes = [];

    // Use index-based map for efficiency
    // Supports duplicate values by storing array of indexes
    const indexByValue = new Map<unknown, number[]>();
    for(let i = 0; i < oldList.length; i++) {
      const val = oldList[i];
      let indexes = indexByValue.get(val);
      if (!indexes) {
        indexes = [];
        indexByValue.set(val, indexes);
      }
      indexes.push(i);
    }

    // Build new indexes array by matching values with old list
    const changeIndexSet: Set<IListIndex> = new Set();
    const addIndexSet: Set<IListIndex> = new Set();
    for(let i = 0; i < newList.length; i++) {
      const newValue = newList[i];
      const existingIndexes = indexByValue.get(newValue);
      const oldIndex = existingIndexes && existingIndexes.length > 0 ? existingIndexes.shift() : undefined;
      
      if (typeof oldIndex === "undefined") {
        // New element
        const newListIndex = createListIndex(parentListIndex, i);
        newIndexes.push(newListIndex);
        addIndexSet.add(newListIndex);
      } else {
        // Reuse existing element
        const existingListIndex = oldIndexes[oldIndex];
        // Judge position change against the old list's order (oldIndexes array
        // order), not the mutable .index — an earlier diff in the same batch
        // may have already moved .index toward a list that was never applied.
        // The .index itself is re-aligned by syncListIndexes on return.
        if (oldIndex !== i) {
          changeIndexSet.add(existingListIndex);
        }
        newIndexes.push(existingListIndex);
      }
    }
    
    const deleteIndexSet: Set<IListIndex> = (new Set(oldIndexes)).difference(new Set(newIndexes));
    return retValue = {
      oldIndexes: oldIndexes,
      newIndexes: newIndexes,
      changeIndexSet: changeIndexSet,
      deleteIndexSet: deleteIndexSet,
      addIndexSet: addIndexSet,
    };
  } finally {
    if (typeof retValue !== "undefined") {
      setListDiff(parentKey, oldList, newList, retValue);
      setListIndexesByList(newList, retValue.newIndexes);
    }
  }
}

/**
 * Diff between two lists whose listIndex ledgers both already exist.
 * Rows are joined by listIndex identity — the same key applyChangeToFor and
 * walkDependency consume the result sets with. A value-based join could mark
 * oldIndexes-side objects that are absent from newIndexes (ledgers built along
 * unconnected diff chains hold different objects for the same value); such
 * orphan markers never match the consumers' has() lookups and only pollute
 * the dirty set. Rows without shared identity are represented as add+delete.
 */
function calcDiffIndexes(
  oldIndexes: IListIndex[],
  newIndexes: IListIndex[],
): IListDiff {
  const newIndexSet: Set<IListIndex> = new Set(newIndexes);
  const oldIndexSet: Set<IListIndex> = new Set(oldIndexes);
  const changeIndexSet: Set<IListIndex> = new Set();
  const addIndexSet: Set<IListIndex> = newIndexSet.difference(oldIndexSet);
  const deleteIndexSet: Set<IListIndex> = oldIndexSet.difference(newIndexSet);
  // Old positions come from the oldIndexes array order (.index may have been
  // mutated by an unapplied diff in the same batch).
  const oldPosByIndex = new Map<IListIndex, number>();
  for (let i = 0; i < oldIndexes.length; i++) {
    oldPosByIndex.set(oldIndexes[i], i);
  }
  for (let i = 0; i < newIndexes.length; i++) {
    const index = newIndexes[i];
    if (addIndexSet.has(index)) {
      continue;
    }
    if (oldPosByIndex.get(index) !== i) {
      // 位置が違うことだけを記録
      changeIndexSet.add(index);
    }
  }
  return {
    oldIndexes: oldIndexes,
    newIndexes: newIndexes,
    changeIndexSet: changeIndexSet,
    deleteIndexSet: deleteIndexSet,
    addIndexSet: addIndexSet,
  };
}