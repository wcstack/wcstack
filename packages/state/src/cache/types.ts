import { IListIndex } from "../list/types";

export interface ICacheEntry {
  value: unknown;
  listIndexes: IListIndex[] | null;
  version: number;
  revision: number;
}
