import { IListIndex } from "../list/types";

export interface IPathInfo {
  readonly path: string;
  readonly segments: string[];
  readonly wildcardCount: number;
  readonly wildcardPositions: number[];
  readonly wildcardPaths: string[];
  readonly wildcardPathSet: Set<string>;
  readonly wildcardParentPaths: string[];
  readonly wildcardParentPathSet: Set<string>;
  readonly wildcardPathInfos: IPathInfo[];
  readonly wildcardPathInfoSet: Set<IPathInfo>;
  readonly wildcardParentPathInfos: IPathInfo[];
  readonly wildcardParentPathInfoSet: Set<IPathInfo>;
  readonly parentPathInfo: IPathInfo | null;
}

export interface IStateAddress {
  readonly pathInfo: IPathInfo;
  readonly listIndex: IListIndex | null;
}