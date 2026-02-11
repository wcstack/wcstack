import { IStateElement } from "../components/types";
import { IStateProxy } from "../proxy/types";
import { IBindingInfo } from "../binding/types";
import { IAbsoluteStateAddress } from "../address/types";

export interface IApplyContext {
  readonly rootNode: Node;
  readonly stateName: string;
  readonly stateElement: IStateElement;
  readonly state: IStateProxy;
  appliedBindingSet: Set<IBindingInfo>;
  newListValueByAbsAddress: Map<IAbsoluteStateAddress, readonly unknown[]>;
}

export type ApplyChangeFn = (binding: IBindingInfo, context: IApplyContext, newValue: unknown) => void;
