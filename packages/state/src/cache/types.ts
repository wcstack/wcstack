import { IListIndex } from "../list/types";
import { IVersionInfo } from "../version/types";

export interface ICacheEntry {
  value: unknown;
  versionInfo: IVersionInfo;
}
