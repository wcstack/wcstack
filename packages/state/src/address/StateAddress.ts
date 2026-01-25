import { IListIndex } from "../list/types";
import { IPathInfo, IStateAddress } from "./types";

class StateAddress implements IStateAddress {
  readonly pathInfo: IPathInfo;
  readonly listIndex: IListIndex | null;

  constructor(pathInfo: IPathInfo, listIndex: IListIndex | null) {
    this.pathInfo = pathInfo;
    this.listIndex = listIndex;
  }

}

export function createStateAddress(pathInfo: IPathInfo, listIndex: IListIndex | null): IStateAddress {
  return new StateAddress(pathInfo, listIndex);
}