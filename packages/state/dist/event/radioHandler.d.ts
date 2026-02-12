import { IBindingInfo, IFilterInfo } from "../types";
declare function getHandlerKey(binding: IBindingInfo, eventName: string): string;
declare function getEventName(binding: IBindingInfo): string;
export declare function attachRadioEventHandler(binding: IBindingInfo): boolean;
export declare function detachRadioEventHandler(binding: IBindingInfo): boolean;
export declare const __private__: {
    handlerByHandlerKey: Map<string, (event: Event) => any>;
    bindingSetByHandlerKey: Map<string, Set<IBindingInfo>>;
    getHandlerKey: typeof getHandlerKey;
    getEventName: typeof getEventName;
    radioEventHandlerFunction: (stateName: string, statePathName: string, inFilters: IFilterInfo[]) => (event: Event) => any;
};
export {};
//# sourceMappingURL=radioHandler.d.ts.map