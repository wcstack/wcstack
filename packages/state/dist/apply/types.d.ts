import { IStateElement } from "../components/types";
import { IStateProxy } from "../proxy/types";
import { IBindingInfo } from "../binding/types";
export interface IApplyContext {
    readonly stateName: string;
    readonly stateElement: IStateElement;
    readonly state: IStateProxy;
    appliedBindingSet: Set<IBindingInfo>;
}
export type ApplyChangeFn = (binding: IBindingInfo, context: IApplyContext, newValue: unknown) => void;
//# sourceMappingURL=types.d.ts.map