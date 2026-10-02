import "../polyfills";
import { createListIndex, rehomeListIndex, setListIndexValue } from "./createListIndex";
import { disownListIndexes, isHeldElsewhere, markListLent, resolveListIndexesByList, retireListIndexes, reviveListIndexes, setListIndexesByList } from "./listIndexesByList";
import { IListDiff, IListIndex } from "./types";
import { dropKeyedSubscriptionsByListIndex, moveIndexWatchers, rekeyIndexSubscriptions } from "../dependency/keyedDependency";
import { updateBatch } from "../updater/updateBatch";

const listDiffByOldListByNewList = new WeakMap<readonly unknown[], WeakMap<readonly unknown[], IListDiff>>();

const EMPTY_LIST = Object.freeze([]);
const EMPTY_SET = new Set<IListIndex>();
/** 行はそのままで要素が替わった行（syncListIndexes・#359）。新しい配列ごとに、拾ったバッチの番号と一緒に持つ */
const valueChangesByList = new WeakMap<readonly unknown[], [number, IListIndex[]]>();

/**
 * 新しい配列 → まだ state に居る前の配列（#362）。配列をそのまま返していた getter が写しを返すようになった
 * （TodoMVC の絞り込み all → done）ときに、getter の評価が控える（proxy/methods/getByAddress.ts）。
 * 差分は前の配列の行を新しい配列へ貸さない — 貸すと行の添字が写しの位置へ振り直され、前の配列（`todos`）の
 * 数値添字の読み書きが別の要素に着地した。前の配列は生きているので、その行を退役させもしない。
 * 前の配列は弱く持つ — 強く持つと、写しを書き直すたびに写しの鎖（とそれぞれの行）が残った（同じ外側の行の 2 つのキーに
 * 写しを書き直す 300 回で happy-dom のヒープが 58 MB → 594 MB）。state から消えた前の配列は、もう生きていない
 */
const livePreviousLists = new WeakMap<object, WeakRef<object>>();

export function keepPreviousList(list: object, previous: unknown): void {
  livePreviousLists.set(list, new WeakRef(Object(previous)));
}

function previousOf(list: object): unknown {
  return livePreviousLists.get(list)?.deref();
}

function getListDiff(rawOldList: readonly unknown[], rawNewList: readonly unknown[]): IListDiff | null {
  const oldList = (Array.isArray(rawOldList) && rawOldList.length > 0) ? rawOldList : EMPTY_LIST;
  const newList = (Array.isArray(rawNewList) && rawNewList.length > 0) ? rawNewList : EMPTY_LIST;
  let diffByNewList = listDiffByOldListByNewList.get(oldList);
  if (!diffByNewList) {
    return null;
  }
  return diffByNewList.get(newList) || null;
}

function setListDiff(oldList: readonly unknown[], newList: readonly unknown[], diff: IListDiff): void {
  let diffByNewList = listDiffByOldListByNewList.get(oldList);
  if (!diffByNewList) {
    diffByNewList = new WeakMap<readonly unknown[], IListDiff>();
    listDiffByOldListByNewList.set(oldList, diffByNewList);
  }
  diffByNewList.set(newList, diff);
}
/**
 * Checks if two lists are identical by comparing length and each element.
 * @param oldList - Previous list to compare
 * @param newList - New list to compare
 * @returns True if lists are identical, false otherwise
 */
export function isSameList(oldList: readonly unknown[], newList: readonly unknown[]): boolean {
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
 * 同じ走査で、行が表している要素も憶えさせる（#256）。行を戻す普通のやり方は
 * 配列を作り直すので ListIndex も作り直される ── 「同じ行が戻ってきた」と言えるのは
 * 行オブジェクトの identity ではなく、この値だけ。
 * 憶えていた要素と違う行は、行の同一性だけを突き合わせる差分（両方の配列に台帳がある）が「変わらない」と
 * 見る行で、要素だけが替わっている（#359 — 要素の書き込みがその場で行の要素を替えた配列から、その行の元の
 * 要素を持つ前の配列へ戻した）。`valueChangeIndexes` に集め、依存ウォークに行ごと描き直させる。
 * 拾えるのは最初の呼び出しだけ（憶えた要素をここで付け直す）なので、同じバッチの間は、同じ配列への差分を
 * 取り直した呼び出しにも前の呼び出しが拾った行を渡す（`valueChangesByList`）— 同じ配列を別のパスが描く
 * （配列をそのまま返す getter の `for`）と、そのパスのリストの展開は同じ配列への差分を取り直す。
 */
function syncListIndexes(diff: IListDiff, newList: readonly unknown[]): void {
  const newIndexes = diff.newIndexes;
  let changed: IListIndex[] | undefined;
  for (let i = 0; i < newIndexes.length; i++) {
    if (newIndexes[i].index !== i) {
      const oldIndex = newIndexes[i].index;
      newIndexes[i].index = i;
      // `$eqIndex` の購読は差分側で鍵を付け替える（dependency/keyedDependency.ts）
      rekeyIndexSubscriptions(newIndexes[i], oldIndex, i);
    }
    if (setListIndexValue(newIndexes[i], newList[i])) {
      (changed ??= []).push(newIndexes[i]);
    }
  }
  const kept = valueChangesByList.get(newList);
  if (kept?.[0] === updateBatch) {
    changed = changed ? kept[1].concat(changed) : kept[1];
  }
  if (changed) {
    valueChangesByList.set(newList, [updateBatch, changed]);
  }
  diff.valueChangeIndexes = changed;
}

/**
 * 行を退役させ、その行の鍵付き購読（`$eq` 系）を行と一緒に落とす。差分が捨てた行と、
 * 要素の書き込みが別の要素に差し替えた行（setByAddress の renewReplacedRow・#333）が使う。
 */
export function retireRows(rows: Iterable<IListIndex>): void {
  retireListIndexes(rows);
  for (const retired of rows) {
    dropKeyedSubscriptionsByListIndex(retired);
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
  syncListIndexes(
    diff,
    (Array.isArray(rawNewList) && rawNewList.length > 0) ? rawNewList : EMPTY_LIST,
  );
  // 捨てた行を退役、返した行を復活として記録する。台帳はこれを見て「共有」と「陳腐化」を
  // 分ける（#256）。両方を毎回の差分で付け直すので、消えない印は残らない。
  // deleteIndexSet と newIndexes は構造上交わらない。
  reviveListIndexes(diff.newIndexes);
  // 前の配列がまだ state に居る（livePreviousLists）なら、その行も `$eqIndex` の監視も前の配列のまま
  if (previousOf(rawNewList as object) !== rawOldList) {
    retireRows(diff.deleteIndexSet);
    // `$eqIndex` の最内段の監視は listIndex 配列に付く: 配列が変わったら移し、最後の値の位置の行を enqueue
    moveIndexWatchers(diff.oldIndexes, diff.newIndexes);
  }
  return diff;
}

/**
 * 前の配列の行を新しい配列へ貸した（#393 — listIndexesByList.ts の markListLent）。行集合は新しい配列を持つ親のものに
 * なるので、home もそこへ移す（#394。前の home は新しい配列を持ったことが無く、手放してもいないので、戻すと別の外側の行の
 * 配列を引いた）
 */
function lendRows(oldList: readonly unknown[], rows: IListIndex[], parentListIndex: IListIndex | null): void {
  markListLent(oldList);
  if (parentListIndex !== null) {
    for (const row of rows) {
      rehomeListIndex(row, parentListIndex);
    }
  }
}

function computeListDiff(
  parentListIndex: IListIndex | null,
  rawOldList: unknown,
  rawNewList: unknown,
): IListDiff {
  // Normalize inputs to arrays (handles null/undefined)
  const oldList: readonly unknown[] = (Array.isArray(rawOldList) && rawOldList.length > 0) ? rawOldList : EMPTY_LIST;
  const newList: readonly unknown[] = (Array.isArray(rawNewList) && rawNewList.length > 0) ? rawNewList : EMPTY_LIST;
  const cachedDiff = getListDiff(oldList, newList);
  // 差分を取った後で新しい配列の台帳が差し替わった（同じバッチの要素書き込みの入れ替えが揃った —
  // #335）なら、キャッシュした差分の行は古い。台帳どうしで取り直す。台帳はキャッシュが当たっても引き直す —
  // 行の親が退役した・配列を手放した外側の行のままだと、行の下の読みが別の外側の行の配列を引く（#256 / #394）
  if (cachedDiff && cachedDiff.newIndexes === resolveListIndexesByList(newList, parentListIndex)) {
    return cachedDiff;
  }
  // 台帳は 1 本の配列につき行集合 1 組（listIndexesByList.ts）。親は「行がぶら下がる親が
  // 退役していたら、この親へ付け替える」ための差し替え先として渡す（#256）。
  const oldIndexes = resolveListIndexesByList(oldList, parentListIndex) || [];
  // 新しく鋳造する行の home は鋳造した親（createListIndex の既定）。前の行集合を引き継ぐ行も、引き継いだ親を home に
  // する（lendRows）— 1 組の行集合に home は 1 つ（#256）
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
    // 前の配列がまだ state に居る（livePreviousLists）なら、その行を貸さずに新しい行を作る（#362）
    let newIndexes: IListIndex[] | null = resolveListIndexesByList(newList, parentListIndex);
    // ほかの外側の行もまだ持っている配列の行は、写しに貸さない（#393 — listIndexesByList.ts の holdersByList）。元の配列は
    // その外側の行にまだ居るので、行を退役させもしない
    if (newIndexes === null && parentListIndex !== null && isHeldElsewhere(oldList, parentListIndex)) {
      keepPreviousList(newList, oldList);
    }
    if (oldList.length === 0 || (newIndexes === null && previousOf(newList) === oldList)) {
      if (newIndexes === null) {
        newIndexes = [];
        for(let i = 0; i < newList.length; i++) {
          const newListIndex = createListIndex(parentListIndex, i);
          newIndexes.push(newListIndex);
        }
      }
      return retValue = {
        oldIndexes: oldIndexes,
        newIndexes: newIndexes,
        changeIndexSet: EMPTY_SET,
        deleteIndexSet: new Set<IListIndex>(oldIndexes),
        addIndexSet: new Set<IListIndex>(newIndexes),
      };
    }
    // If lists are identical, return existing indexes unchanged (optimization)
    // 新しい配列が別の行集合を持つなら下で行どうしを突き合わせる — 要素の書き込みは位置を新しい行にするので
    // （別の要素を書いてから元の要素へ戻す — #333）、同じ中身の配列でも行が違い、前の配列の行（退役した行を
    // 含む）を被せると、新しい配列を描いた `for` に無い行が台帳に戻る
    if (isSameList(oldList, newList) && (newIndexes ?? oldIndexes) === oldIndexes) {
      if (oldList !== newList) {
        lendRows(oldList, oldIndexes, parentListIndex);
      }
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
    // 前の配列の行を 1 つでも新しい配列へ貸したか（listIndexesByList.ts の markListLent・#393）
    let lent = false;
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
        lent = true;
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
    
    if (lent) {
      lendRows(oldList, newIndexes, parentListIndex);
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
      setListDiff(oldList, newList, retValue);
      // 差分が両方の台帳の配列を持つので、要素の書き込みはもうその場で書き換えない（listIndexesByList.ts）
      disownListIndexes(oldIndexes);
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
 * 台帳に書かず・キャッシュもしない純粋な突き合わせなので、共有の記録から外れていた `for` が
 * 自分の描いた行と今の行を突き合わせるのにも使う（applyChangeToFor、#320）。
 */
export function calcDiffIndexes(
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