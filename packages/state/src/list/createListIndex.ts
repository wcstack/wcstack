import { getUUID } from "../getUUID";
import { IListIndex } from "./types";

let version = 0;
/**
 * 親の付け替え（#256 の修理）の世代。`listIndexes` の WeakRef 連鎖は一度組んだら
 * 作り直されないので、祖先が付け替わったら子孫のキャッシュも無効にする必要がある。
 * `dirty`（version 比較）は `indexes` の再構築が消費してしまうため、連鎖専用の世代を持つ。
 */
let chainGeneration = 0;

/** 値が一度も記録されていない行の印（`undefined` を持つ行と区別するため）。 */
const NO_VALUE = Symbol("wcs.listIndex.noValue");

class ListIndex implements IListIndex {
  readonly uuid = getUUID();
  parentListIndex: IListIndex | null;
  readonly position: number;
  readonly length: number;

  private _index: number;
  private _version: number;
  private _indexes: number[] | undefined;
  private _listIndexes: WeakRef<IListIndex>[] | undefined;
  private _chainGeneration: number;
  /**
   * この行集合を最初に展開した親（`home`・#256）。付け替えても変わらない。退役した親から
   * 付け替えたあと、その親が戻ってきたら戻す先になる。1 組の行集合に home は 1 つ — 別の配列（写し）へ
   * 引き継いだ行集合は、引き継いだ親を home にする（`createListDiff` の rehomeListIndex・#394。前の home は
   * 新しい配列を持ったことが無い）。
   */
  private _homeParentListIndex: IListIndex | null;

  /**
   * この行が表しているリスト要素（#256）。差分が返すたびに付け直す。
   * 「同じ行が戻ってきた」を配列インスタンスをまたいで言えるのはこの値だけ ──
   * 行を戻す普通のやり方（新しい配列に同じ要素を並べ直す）は ListIndex を作り直すので、
   * 行オブジェクトの identity では判定できない。
   */
  private _value: unknown;

  /**
   * 行の下のキャッシュの印（#389）。行の下の値（`items.*.name`）のキャッシュは載せたときの印を持ち、
   * 印が進んだ行の項目は読みで外れる。行の要素・途中の値が変わったら、子のパスを 1 つずつ無効にする
   * 代わりに印を 1 つ進める（cache/cacheEntryByAbsoluteStateAddress.ts）。
   */
  cacheStamp = 0;

  /** 要素オブジェクトの索引が持つ、この行への弱い参照（rowsByElement・#393。載せたときに作る） */
  ref: WeakRef<ListIndex> | undefined;

  /**
   * Creates a new ListIndex instance.
   *
   * @param parentListIndex - Parent list index for nested loops, or null for top-level
   * @param index - Current index value in the loop
   * @param homeParentListIndex - Parent this row's set belongs to (#256)
   */
  constructor(parentListIndex: IListIndex | null, index: number, homeParentListIndex: IListIndex | null) {
    this.parentListIndex = parentListIndex;
    this.position = parentListIndex ? parentListIndex.position + 1 : 0;
    this.length = this.position + 1;
    this._homeParentListIndex = homeParentListIndex;
    this._value = NO_VALUE;
    this._index = index;
    this._version = version;
    this._chainGeneration = chainGeneration;
  }

  /**
   * Gets current index value.
   *
   * @returns Current index number
   */
  get index() {
    return this._index;
  }

  /**
   * Sets index value and updates version.
   *
   * @param value - New index value
   */
  set index(value: number) {
    this._index = value;
    this._version = ++version;
    this.indexes[this.position] = value;
  }

  /**
   * Gets current version number for change detection.
   *
   * @returns Version number
   */
  get version(): number {
    return this._version;
  }

  /** 行集合を最初に展開した親（付け替えても変わらない）。 */
  get homeParentListIndex(): IListIndex | null {
    return this._homeParentListIndex;
  }

  set homeParentListIndex(home: IListIndex | null) {
    this._homeParentListIndex = home;
  }

  /** この行が表しているリスト要素（未記録なら `NO_VALUE`）。 */
  get value(): unknown {
    return this._value;
  }

  set value(value: unknown) {
    this._value = value;
  }

  /**
   * Checks if parent indexes have changed since last access.
   *
   * @returns true if parent has newer version, false otherwise
   */
  get dirty(): boolean {
    if (this.parentListIndex === null) {
      return false;
    } else {
      return this.parentListIndex.dirty || this.parentListIndex.version > this._version;
    }
  }

  /**
   * Gets array of all index values from root to current level.
   * Rebuilds array if parent indexes have changed (dirty).
   *
   * @returns Array of index values
   */
  get indexes(): number[] {
    if (this.parentListIndex === null) {
      if (typeof this._indexes === "undefined") {
        this._indexes = [this._index];
      }
    } else {
      if (typeof this._indexes === "undefined" || this.dirty) {
        this._indexes = [...this.parentListIndex.indexes, this._index];
        this._version = version;
      }
    }
    return this._indexes;
  }

  /**
   * Gets array of WeakRef to all ListIndex instances from root to current level.
   *
   * @returns Array of WeakRef<IListIndex>
   */
  get listIndexes(): WeakRef<IListIndex>[] {
    if (this.parentListIndex === null) {
      if (typeof this._listIndexes === "undefined") {
        this._listIndexes = [new WeakRef(this)];
      }
    } else {
      if (typeof this._listIndexes === "undefined" || this._chainGeneration !== chainGeneration) {
        this._listIndexes = [...this.parentListIndex.listIndexes, new WeakRef(this)];
        this._chainGeneration = chainGeneration;
      }
    }
    return this._listIndexes;
  }

  /**
   * Gets variable name for this loop index ($1, $2, etc.).
   *
   * @returns Variable name string
   */
  get varName(): string {
    return `$${this.position + 1}`;
  }

  /**
   * Gets ListIndex at specified position in hierarchy.
   * Supports negative indexing from end.
   *
   * @param pos - Position index (0-based, negative for from end)
   * @returns ListIndex at position or null if not found/garbage collected
   */
  /**
   * 退役した親を、同じ深さの生きた親へ差し替える（#256）。**行の identity は保つ**ので、
   * 描画済み content も、その行に紐づくバインドしていない DOM の状態も残る。
   * 添字の値は親が変われば変わりうる（並べ替えを伴う置換）ため、`indexes` と WeakRef 連鎖を
   * 捨て、version を進めて子孫の `dirty` を立てる。`_homeParentListIndex` は動かさない
   * ── 外した行が戻ってきたときに持ち主を返す先だから。
   */
  reparent(parentListIndex: IListIndex | null): void {
    this.parentListIndex = parentListIndex;
    this._indexes = undefined;
    this._listIndexes = undefined;
    this._version = ++version;
    chainGeneration++;
  }

  at(pos: number): IListIndex | null {
    if (pos >= 0) {
      return this.listIndexes[pos]?.deref() || null;
    } else {
      return this.listIndexes[this.listIndexes.length + pos]?.deref() || null;
    }
  }
}

/**
 * Factory function to create ListIndex instance.
 *
 * @param parentListIndex - Parent list index for nested loops, or null for top-level
 * @param index - Current index value in the loop
 * @param homeParentListIndex - Row set this row joins (#256); defaults to the minting parent
 * @returns New IListIndex instance
 */
export function createListIndex(
  parentListIndex: IListIndex | null,
  index: number,
  homeParentListIndex: IListIndex | null = parentListIndex,
): IListIndex {
  return new ListIndex(parentListIndex, index, homeParentListIndex);
}

/**
 * 台帳（`listIndexesByList`）専用の入口。行は必ずこのモジュールが鋳造した実体なので、
 * 到達不能な防御分岐を置かずに直接呼ぶ。
 */
export function reparentListIndex(listIndex: IListIndex, parentListIndex: IListIndex | null): void {
  (listIndex as ListIndex).reparent(parentListIndex);
}

/**
 * 台帳専用の入口その 2。行集合の home を読む（`IListIndex` を広げないための cast ──
 * この型は dist/index.d.ts に出るので、内部だけの都合で公開面を増やさない）。
 */
export function getHomeParentListIndex(listIndex: IListIndex): IListIndex | null {
  return (listIndex as ListIndex).homeParentListIndex;
}

/** 台帳専用の入口その 2'。行集合を別の配列へ引き継いだ親を home にする（createListDiff・#394） */
export function rehomeListIndex(listIndex: IListIndex, home: IListIndex | null): void {
  (listIndex as ListIndex).homeParentListIndex = home;
}

/**
 * キャッシュ専用の入口。行の下のキャッシュの印を読む（行の無いアドレスは undefined — #389）。
 * 載せるときと読むときの両方がこれで引くので、行の無いアドレスの項目は印の比較で外れない。
 */
export function getRowCacheStamp(listIndex: IListIndex | null): number | undefined {
  return (listIndex as ListIndex | null)?.cacheStamp;
}

/** キャッシュ専用の入口その 2。行の下のキャッシュをまとめて無効にする（#389） */
export function advanceRowCacheStamp(listIndex: IListIndex): void {
  (listIndex as ListIndex).cacheStamp++;
}

/**
 * 台帳専用の入口その 3。差分が返した行に、その行が表している要素を憶えさせる（#256）。
 * 要素の書き込みがその場で行の要素を替えたときも呼ぶ（setByAddress の _setByAddressWithSwap・#359）。
 * 前に憶えていた要素と違えば真を返す — 差分がこれを見て、行はそのままで要素だけが替わった行を
 * 描き直させる（createListDiff の syncListIndexes）。
 */
export function setListIndexValue(listIndex: IListIndex, value: unknown): boolean {
  const row = listIndex as ListIndex;
  const previous = row.value;
  const changed = previous !== NO_VALUE && !Object.is(previous, value);
  if (previous !== value) {
    rowsByElement.get(previous as object)?.delete(row.ref!);
    rememberRowOfElement(value, row);
  }
  row.value = value;
  return changed;
}

/**
 * 要素オブジェクト → それを表している入れ子のリストの行（#393）。同じ要素オブジェクトは別の行にも居る — 同じ配列の
 * 2 つの位置、共有された配列の写し（ほかの外側の行がまだ持つ配列の写しは、行を借りずに新しい行を作る — createListDiff）。
 * 行の下への書き込み（`groups.1.items.0.v`）は、同じ要素を表す別の行のアドレスにも知らせる（setByAddress の notifyWrite）。
 * 行は弱く持つ — 外側の行ごと外した行・捨てた state の行は差分を通らず退役の印も付かないので、強く持つと要素が生きている
 * 間ずっと残った（外側の行を不変更新するたびに内側の行の数だけ増えた）。集合は前に見直した大きさの倍に育ったときに、消えた
 * 行と、退役した行・退役した外側の行の下の行を外す — 消えた行だけを外すと、GC までの間、外側の行を消して戻すたびに集合が
 * 育った（500 回で 501）。ルート直下の行は載せない（別の行を引くのは入れ子の行の下への書き込みだけ）
 */
const rowsByElement = new WeakMap<object, Set<WeakRef<ListIndex>>>();
const pruneSizeByRows = new WeakMap<Set<WeakRef<ListIndex>>, number>();

function rememberRowOfElement(element: unknown, row: ListIndex): void {
  if (typeof element !== "object" || element === null || row.parentListIndex === null) {
    return;
  }
  let held = rowsByElement.get(element);
  if (typeof held === "undefined") {
    held = new Set();
    rowsByElement.set(element, held);
  } else if (held.size >= (pruneSizeByRows.get(held) ?? 8)) {
    liveRowsOf(held, row, true);
    pruneSizeByRows.set(held, held.size * 2 + 8);
  }
  held.add(row.ref ??= new WeakRef(row));
}

/** 集合の生きている行のうち `row` でないもの（消えた行は外す。`stale` なら退役した行・その下の行も外す） */
function liveRowsOf(held: Set<WeakRef<ListIndex>> | undefined, row: ListIndex, stale = false): ListIndex[] {
  const rows: ListIndex[] = [];
  held?.forEach((ref) => {
    const other = ref.deref();
    if (typeof other === "undefined" || (stale && isUnderRetiredRow(other))) {
      held.delete(ref);
    } else if (other !== row) {
      rows.push(other);
    }
  });
  return rows;
}

/** 同じ要素オブジェクトを表している別の行（台帳専用の入口その 4 — list/listIndexesByList.ts の getElementAliases） */
export function getRowsOfSameElement(listIndex: IListIndex): ListIndex[] {
  return liveRowsOf(rowsByElement.get((listIndex as ListIndex).value as object), listIndex as ListIndex);
}

/**
 * 差分で `newIndexes` から外れた行 ＝ 消費者が画面から外した行（list/listIndexesByList.ts の retireListIndexes /
 * reviveListIndexes が付け外しする）。「生きた親集合に属さない」の判定材料。要素の索引の見直しも引くのでここに置く
 */
export const retiredListIndexes = new WeakSet<IListIndex>();

/** 行か、その祖先の行が退役しているか */
export function isUnderRetiredRow(listIndex: IListIndex | null): boolean {
  for (let row = listIndex; row !== null; row = row.parentListIndex) {
    if (retiredListIndexes.has(row)) {
      return true;
    }
  }
  return false;
}

/** 行が表しているリスト要素（未記録なら undefined ではなく内部の印 — 台帳専用の入口その 5・list/listIndexesByList.ts の covers） */
export function getListIndexValue(listIndex: IListIndex): unknown {
  return (listIndex as ListIndex).value;
}

/**
 * 2 つの行が**同じリスト要素**を表しているか（#256）。
 * 差分を通っていない行（`hydrateBindings` / `setByAddress` が鋳造する行）は値を持たないので、
 * 未記録どうしは「同じ」と見なさない ── 値の無い行を取り違えて付け替えないため。
 * 行を書き換えない読むだけの判定なので、台帳の外からも使う: `$scan` の drain が、行のアドレスが
 * いまその位置の要素を表しているかを見る（scan/scanRuntime.ts の placementOf）。
 */
export function isSameListIndexValue(listIndex: IListIndex, other: IListIndex): boolean {
  const value = (listIndex as ListIndex).value;
  return value !== NO_VALUE && value === (other as ListIndex).value;
}
