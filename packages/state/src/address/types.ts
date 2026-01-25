import { IListIndex } from "../list/types";

export interface IPathInfo {
  readonly path: string;
  readonly segments: string[];
  readonly wildcardPositions: number[];
  readonly parentPathInfo: IPathInfo | null;
}

export interface IStateAddress {
  readonly pathInfo: IPathInfo;
  readonly listIndex: IListIndex | null;
}