import { IBindingInfo } from "../binding/types";

export interface IInitialBindingInfo {
  nodes: Node[];
  bindingInfos: IBindingInfo[];
}

export interface IInitializeBindingPromise {
  id: number;
  promise: Promise<void>;
  resolve: () => void;
}