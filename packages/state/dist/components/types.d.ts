import { ILoopContextStack } from "../list/types";
import { IBindingInfo, IState } from "../types";
export interface IStateElement {
    readonly name: string;
    readonly state: IState;
    readonly bindingInfosByPath: Map<string, IBindingInfo[]>;
    readonly initializePromise: Promise<void>;
    readonly listPaths: Set<string>;
    readonly loopContextStack: ILoopContextStack;
    addBindingInfo(bindingInfo: IBindingInfo): void;
    deleteBindingInfo(bindingInfo: IBindingInfo): void;
}
//# sourceMappingURL=types.d.ts.map