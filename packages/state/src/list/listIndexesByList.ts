import { IListIndex } from "./types";

const listIndexesByList = new WeakMap<Array<any>, IListIndex[]>();

export function getListIndexesByList(list: Array<any>): IListIndex[] | null {
  return listIndexesByList.get(list) || null;
}

export function setListIndexesByList(list: Array<any>, listIndexes: IListIndex[] | null): void {
  if (listIndexes === null) {
    listIndexesByList.delete(list);
    return;
  }
  listIndexesByList.set(list, listIndexes);
}