import { IListIndex, IListManager } from "../list/types";
import { IBindingInfo, IState } from "../types";

export interface IStateElement {
  readonly name: string;
  readonly state: IState;
  readonly bindingInfosByPath: Map<string, IBindingInfo[]>;
  readonly initializePromise: Promise<void>;
  readonly listPaths: Set<string>;
  addBindingInfo(bindingInfo: IBindingInfo): void;
  deleteBindingInfo(bindingInfo: IBindingInfo): void;
}

export interface ILoopElement {
  readonly uuid: string;
  readonly path: string;
  readonly stateElement: IStateElement;
  readonly loopContent: DocumentFragment;
  readonly bindingInfo: IBindingInfo;
  readonly initializePromise: Promise<void>;
  loopValue: any;
}