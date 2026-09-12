import { getUUID } from "../getUUID";
import { IListIndex } from "./types";

let version = 0;
/**
 * 親の付け替え（#256 の修理）の世代。`listIndexes` の WeakRef 連鎖は一度組んだら
 * 作り直されないので、祖先が付け替わったら子孫のキャッシュも無効にする必要がある。
 * `dirty`（version 比較）は `indexes` の再構築が消費してしまうため、連鎖専用の世代を持つ。
 */
let chainGeneration = 0;

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
   * Creates a new ListIndex instance.
   * 
   * @param parentListIndex - Parent list index for nested loops, or null for top-level
   * @param index - Current index value in the loop
   */
  constructor(parentListIndex: IListIndex | null, index: number) {
    this.parentListIndex = parentListIndex;
    this.position = parentListIndex ? parentListIndex.position + 1 : 0;
    this.length = this.position + 1;
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
   * 捨て、version を進めて子孫の `dirty` を立てる。
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
 * @returns New IListIndex instance
 */
export function createListIndex(parentListIndex: IListIndex | null, index: number): IListIndex {
  return new ListIndex(parentListIndex, index);
}

/**
 * 台帳（`listIndexesByList`）専用の入口。行は必ずこのモジュールが鋳造した実体なので、
 * 到達不能な防御分岐を置かずに直接呼ぶ。
 */
export function reparentListIndex(listIndex: IListIndex, parentListIndex: IListIndex | null): void {
  (listIndex as ListIndex).reparent(parentListIndex);
}
