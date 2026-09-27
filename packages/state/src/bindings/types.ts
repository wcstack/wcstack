import { IBindingInfo } from "../binding/types";
import type { BindingSession } from "./BindingSession";
import type { IDeferredSpreadEntry } from "./collectNodesAndBindingInfos";

export interface IInitialBindingInfo {
  nodes: Node[];
  bindingInfos: IBindingInfo[];
  /** Internal owner transferred to structural Content. */
  bindingSession: BindingSession;
  /** 未定義カスタム要素への spread（#330）。行の活性化が定義待ちへ予約する */
  spreads: IDeferredSpreadEntry[];
}

export interface IInitializeBindingPromise {
  id: number;
  promise: Promise<void>;
  resolve: () => void;
}