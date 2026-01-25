const listIndexesByList = new WeakMap();
export function getListIndexesByList(list) {
    return listIndexesByList.get(list) || null;
}
export function setListIndexesByList(list, listIndexes) {
    if (listIndexes === null) {
        listIndexesByList.delete(list);
        return;
    }
    listIndexesByList.set(list, listIndexes);
}
//# sourceMappingURL=listIndexesByList.js.map