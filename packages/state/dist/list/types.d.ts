import { IPathInfo, IStateAddress } from "../address/types";
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
export interface ILoopContext extends IStateAddress {
    readonly pathInfo: IPathInfo;
    readonly listIndex: IListIndex;
}
export interface ILoopContextStack {
    createLoopContext(elementStateAddress: IStateAddress, callback: (loopContext: ILoopContext) => void | Promise<void>): void | Promise<void>;
}
export interface IListDiff {
    oldIndexes: IListIndex[];
    newIndexes: IListIndex[];
    changeIndexSet: Set<IListIndex>;
    deleteIndexSet: Set<IListIndex>;
    addIndexSet: Set<IListIndex>;
}
//# sourceMappingURL=types.d.ts.map