import { IAbsoluteStateAddress } from "../address/types";
import { IBindingInfo } from "./types";
export declare function getBindingSetByAbsoluteStateAddress(absoluteStateAddress: IAbsoluteStateAddress): Set<IBindingInfo>;
export declare function addBindingByAbsoluteStateAddress(absoluteStateAddress: IAbsoluteStateAddress, binding: IBindingInfo): void;
export declare function clearBindingSetByAbsoluteStateAddress(absoluteStateAddress: IAbsoluteStateAddress): void;
export declare function removeBindingByAbsoluteStateAddress(absoluteStateAddress: IAbsoluteStateAddress, binding: IBindingInfo): void;
//# sourceMappingURL=getBindingSetByAbsoluteStateAddress.d.ts.map