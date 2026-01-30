import { IPathInfo } from "../address/types";

/**
 * Interface for hierarchical loop index management in nested loops.
 * Tracks parent-child relationships, versions, and provides access to index hierarchy.
 */
export interface IListIndex {
  readonly parentListIndex: IListIndex | null;
  readonly uuid: string;
  readonly position: number;
  readonly length: number;
  index: number;
  readonly version: number;
  readonly dirty: boolean;
  readonly indexes: number[];
  readonly listIndexes: WeakRef<IListIndex>[];
  readonly varName: string;
  at(position: number): IListIndex | null;
}

export interface IListManager {
  setListable(path: string): void;
  setList(path: string, list: Array<any>, parentListIndex: IListIndex | null): void;
  getListIndexes(path: string): IListIndex[] | null;
}

export interface ILoopContext {
  listPathInfo: IPathInfo;
  listIndex: IListIndex;
}

export interface ILoopContextStack {
  createLoopContext(
    listPathInfo: IPathInfo, 
    listIndex: IListIndex, 
    callback: (loopContext: ILoopContext) => void | Promise<void>
  ): void | Promise<void>;
}

export interface IListDiff {
  added: Array<any>;
  removed: Array<any>;
  moved: Array<{ item: any; from: number; to: number }>;
}