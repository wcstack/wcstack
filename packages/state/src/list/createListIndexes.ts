import { createListIndex } from "./createListIndex";
import { IListIndex } from "./types";

export function createListIndexes(list: Array<any>, parentListIndex: IListIndex | null): IListIndex[] {
  const listIndexes: IListIndex[] = [];
  for (let i = 0; i < list.length; i++) {
    listIndexes.push(createListIndex(parentListIndex, i));
  }
  return listIndexes;
}