import { IStateElement } from "../components/types";
import { IStateProxy } from "../proxy/types";
import { IBindingInfo } from "../types";

export interface IApplyContext {
  readonly stateName: string;
  readonly stateElement: IStateElement;
  readonly state: IStateProxy;
}

export type ApplyChangeFn = (binding: IBindingInfo, context: IApplyContext, newValue: unknown) => void;
