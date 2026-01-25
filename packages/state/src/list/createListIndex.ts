import { getUUID } from "../getUUID";
import { IListIndex } from "./types";

let version = 0;

class ListIndex implements IListIndex {
  readonly uuid = getUUID();
  readonly parentListIndex: IListIndex | null;
  readonly position: number;
  readonly length: number;

  private _index: number;
  private _version: number;
  private _indexes: number[] | undefined;
  private _listIndexes: WeakRef<IListIndex>[] | undefined;

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
      if (typeof this._listIndexes === "undefined") {
        this._listIndexes = [...this.parentListIndex.listIndexes, new WeakRef(this)];
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
