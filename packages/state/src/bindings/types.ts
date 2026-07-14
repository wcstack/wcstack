import { IBindingInfo } from "../binding/types";
import type { BindingSession } from "./BindingSession";

export interface IInitialBindingInfo {
  nodes: Node[];
  bindingInfos: IBindingInfo[];
  /** Internal owner transferred to structural Content. */
  bindingSession: BindingSession;
}

export interface IInitializeBindingPromise {
  id: number;
  promise: Promise<void>;
  resolve: () => void;
}