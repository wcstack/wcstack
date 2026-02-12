import { IBindingInfo, IFilterInfo } from "../types";
declare function getHandlerKey(binding: IBindingInfo, eventName: string): string;
declare function getEventName(binding: IBindingInfo): string;
export declare function attachTwowayEventHandler(binding: IBindingInfo): boolean;
export declare function detachTwowayEventHandler(binding: IBindingInfo): boolean;
export declare const __private__: {
    handlerByHandlerKey: Map<string, (event: Event) => any>;
    bindingSetByHandlerKey: Map<string, Set<IBindingInfo>>;
    getHandlerKey: typeof getHandlerKey;
    getEventName: typeof getEventName;
    twowayEventHandlerFunction: (stateName: string, propName: string, statePathName: string, inFilters: IFilterInfo[]) => (event: Event) => any;
};
export {};
//# sourceMappingURL=twowayHandler.d.ts.map