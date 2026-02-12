import { IBindingInfo } from "../types";
export declare function attachEventHandler(binding: IBindingInfo): boolean;
export declare function detachEventHandler(binding: IBindingInfo): boolean;
export declare const __private__: {
    handlerByHandlerKey: Map<string, (event: Event) => any>;
    bindingSetByHandlerKey: Map<string, Set<IBindingInfo>>;
};
//# sourceMappingURL=handler.d.ts.map