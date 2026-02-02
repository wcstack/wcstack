import "../polyfills";
import { createListIndex } from "./createListIndex";
const listDiffByOldListByNewList = new WeakMap();
const EMPTY_LIST = Object.freeze([]);
const EMPTY_SET = new Set();
export function getListDiff(rawOldList, rawNewList) {
    const oldList = (Array.isArray(rawOldList) && rawOldList.length > 0) ? rawOldList : EMPTY_LIST;
    const newList = (Array.isArray(rawNewList) && rawNewList.length > 0) ? rawNewList : EMPTY_LIST;
    let diffByNewList = listDiffByOldListByNewList.get(oldList);
    if (!diffByNewList) {
        return null;
    }
    return diffByNewList.get(newList) || null;
}
function setListDiff(oldList, newList, diff) {
    let diffByNewList = listDiffByOldListByNewList.get(oldList);
    if (!diffByNewList) {
        diffByNewList = new WeakMap();
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
function isSameList(oldList, newList) {
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
export function createListIndexes(parentListIndex, rawOldList, rawNewList, oldIndexes) {
    // Normalize inputs to arrays (handles null/undefined)
    const oldList = (Array.isArray(rawOldList) && rawOldList.length > 0) ? rawOldList : EMPTY_LIST;
    const newList = (Array.isArray(rawNewList) && rawNewList.length > 0) ? rawNewList : EMPTY_LIST;
    const cachedDiff = getListDiff(oldList, newList);
    if (cachedDiff) {
        return cachedDiff.newIndexes;
    }
    const newIndexes = [];
    // Early return for empty list
    if (newList.length === 0) {
        setListDiff(oldList, newList, {
            oldIndexes: oldIndexes,
            newIndexes: [],
            changeIndexSet: EMPTY_SET,
            deleteIndexSet: new Set(oldIndexes),
            addIndexSet: EMPTY_SET,
        });
        return [];
    }
    // If old list was empty, create all new indexes
    if (oldList.length === 0) {
        for (let i = 0; i < newList.length; i++) {
            const newListIndex = createListIndex(parentListIndex, i);
            newIndexes.push(newListIndex);
        }
        setListDiff(oldList, newList, {
            oldIndexes: oldIndexes,
            newIndexes: newIndexes,
            changeIndexSet: EMPTY_SET,
            deleteIndexSet: EMPTY_SET,
            addIndexSet: new Set(newIndexes),
        });
        return newIndexes;
    }
    // If lists are identical, return existing indexes unchanged (optimization)
    if (isSameList(oldList, newList)) {
        setListDiff(oldList, newList, {
            oldIndexes: oldIndexes,
            newIndexes: oldIndexes,
            changeIndexSet: EMPTY_SET,
            deleteIndexSet: EMPTY_SET,
            addIndexSet: EMPTY_SET,
        });
        return oldIndexes;
    }
    // Use index-based map for efficiency
    // Supports duplicate values by storing array of indexes
    const indexByValue = new Map();
    for (let i = 0; i < oldList.length; i++) {
        const val = oldList[i];
        let indexes = indexByValue.get(val);
        if (!indexes) {
            indexes = [];
            indexByValue.set(val, indexes);
        }
        indexes.push(i);
    }
    // Build new indexes array by matching values with old list
    const changeIndexSet = new Set();
    const addIndexSet = new Set();
    for (let i = 0; i < newList.length; i++) {
        const newValue = newList[i];
        const existingIndexes = indexByValue.get(newValue);
        const oldIndex = existingIndexes && existingIndexes.length > 0 ? existingIndexes.shift() : undefined;
        if (typeof oldIndex === "undefined") {
            // New element
            const newListIndex = createListIndex(parentListIndex, i);
            newIndexes.push(newListIndex);
            addIndexSet.add(newListIndex);
        }
        else {
            // Reuse existing element
            const existingListIndex = oldIndexes[oldIndex];
            // Update index if position changed
            if (existingListIndex.index !== i) {
                existingListIndex.index = i;
                changeIndexSet.add(existingListIndex);
            }
            newIndexes.push(existingListIndex);
        }
    }
    const deleteIndexSet = (new Set(oldIndexes)).difference(new Set(newIndexes));
    setListDiff(oldList, newList, {
        oldIndexes: oldIndexes,
        newIndexes: newIndexes,
        changeIndexSet: changeIndexSet,
        deleteIndexSet: deleteIndexSet,
        addIndexSet: addIndexSet,
    });
    return newIndexes;
}
//# sourceMappingURL=createListIndexes.js.map