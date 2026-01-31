import { IBindingInfo } from "../types";
declare function getHandlerKey(bindingInfo: IBindingInfo, eventName: string): string;
declare function getEventName(bindingInfo: IBindingInfo): string;
export declare function attachTwowayEventHandler(bindingInfo: IBindingInfo): boolean;
export declare function detachTwowayEventHandler(bindingInfo: IBindingInfo): boolean;
export declare const __private__: {
    handlerByHandlerKey: Map<string, (event: Event) => any>;
    bindingInfoSetByHandlerKey: Map<string, Set<IBindingInfo>>;
    getHandlerKey: typeof getHandlerKey;
    getEventName: typeof getEventName;
    twowayEventHandlerFunction: (stateName: string, propName: string, statePathName: string) => (event: Event) => any;
};
export {};
//# sourceMappingURL=twowayHandler.d.ts.map