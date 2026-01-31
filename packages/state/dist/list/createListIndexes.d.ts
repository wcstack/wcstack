import { IListIndex } from "./types";
/**
 * Creates or updates list indexes by comparing old and new lists.
 * Optimizes by reusing existing list indexes when values match.
 * @param parentListIndex - Parent list index for nested lists, or null for top-level
 * @param oldList - Previous list (will be normalized to array)
 * @param newList - New list (will be normalized to array)
 * @param oldIndexes - Array of existing list indexes to potentially reuse
 * @returns Array of list indexes for the new list
 */
export declare function createListIndexes(parentListIndex: IListIndex | null, rawOldList: unknown, rawNewList: unknown, oldIndexes: IListIndex[]): IListIndex[];
//# sourceMappingURL=createListIndexes.d.ts.map