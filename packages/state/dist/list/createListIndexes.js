import { createListIndex } from "./createListIndex";
export function createListIndexes(list, parentListIndex) {
    const listIndexes = [];
    for (let i = 0; i < list.length; i++) {
        listIndexes.push(createListIndex(parentListIndex, i));
    }
    return listIndexes;
}
//# sourceMappingURL=createListIndexes.js.map