import { IBindingInfo } from "../types";
export declare function attachEventHandler(bindingInfo: IBindingInfo): boolean;
export declare function detachEventHandler(bindingInfo: IBindingInfo): boolean;
export declare const __private__: {
    handlerByHandlerKey: Map<string, (event: Event) => any>;
    bindingInfoSetByHandlerKey: Map<string, Set<IBindingInfo>>;
};
//# sourceMappingURL=handler.d.ts.map