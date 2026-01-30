import { createListIndex } from "./createListIndex";
import { IListIndex } from "./types";

/**
 * Checks if two lists are identical by comparing length and each element.
 * @param oldList - Previous list to compare
 * @param newList - New list to compare
 * @returns True if lists are identical, false otherwise
 */
function isSameList(oldList: unknown[], newList: unknown[]): boolean {
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
 * Creates or updates list indexes by comparing old and new lists.
 * Optimizes by reusing existing list indexes when values match.
 * @param parentListIndex - Parent list index for nested lists, or null for top-level
 * @param oldList - Previous list (will be normalized to array)
 * @param newList - New list (will be normalized to array)
 * @param oldIndexes - Array of existing list indexes to potentially reuse
 * @returns Array of list indexes for the new list
 */
export function createListIndexes(
  parentListIndex: IListIndex | null,
  rawOldList: unknown,
  rawNewList: unknown,
  oldIndexes: IListIndex[]
): IListIndex[] {
  // Normalize inputs to arrays (handles null/undefined)
  const oldList: unknown[] = Array.isArray(rawOldList) ? rawOldList : [];
  const newList: unknown[] = Array.isArray(rawNewList) ? rawNewList : [];
  const newIndexes: IListIndex[] = [];
  // Early return for empty list
  if (newList.length === 0) {
    return [];
  }
  // If old list was empty, create all new indexes
  if (oldList.length === 0) {
    for(let i = 0; i < newList.length; i++) {
      const newListIndex = createListIndex(parentListIndex, i);
      newIndexes.push(newListIndex);
    }
    return newIndexes;
  }
  // If lists are identical, return existing indexes unchanged (optimization)
  if (isSameList(oldList, newList)) {
    return oldIndexes;
  }
  // Use index-based map for efficiency
  const indexByValue = new Map<unknown, number>();
  for(let i = 0; i < oldList.length; i++) {
    // For duplicate values, the last index takes precedence (maintains existing behavior)
    indexByValue.set(oldList[i], i);
  }

  // Build new indexes array by matching values with old list
  for(let i = 0; i < newList.length; i++) {
    const newValue = newList[i];
    const oldIndex = indexByValue.get(newValue);
    
    if (typeof oldIndex === "undefined") {
      // New element
      const newListIndex = createListIndex(parentListIndex, i);
      newIndexes.push(newListIndex);
    } else {
      // Reuse existing element
      const existingListIndex = oldIndexes[oldIndex];
      // Update index if position changed
      if (existingListIndex.index !== i) {
        existingListIndex.index = i;
      }
      newIndexes.push(existingListIndex);
    }
  }
  return newIndexes;

}