import { IBindingInfo } from "../binding/types";
export interface IInitialBindingInfo {
    nodes: Node[];
    bindingInfos: IBindingInfo[];
}
export interface IInitializeBindingPromise {
    promise: Promise<void>;
    resolve: () => void;
}
//# sourceMappingURL=types.d.ts.map