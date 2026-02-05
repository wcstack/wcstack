import { IListIndex } from "./types";

const listIndexesByList = new WeakMap<readonly unknown[], IListIndex[]>();

export function getListIndexesByList(list: readonly unknown[]): IListIndex[] | null {
  return listIndexesByList.get(list) || null;
}

export function setListIndexesByList(list: readonly unknown[], listIndexes: IListIndex[] | null): void {
  if (listIndexes === null) {
    listIndexesByList.delete(list);
    return;
  }
  listIndexesByList.set(list, listIndexes);
}