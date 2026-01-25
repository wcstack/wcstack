import { IBindingInfo, IState } from "../types";
import { IStateElement } from "./types";
export declare class State extends HTMLElement implements IStateElement {
    private _uuid;
    private _state;
    private _proxyState;
    private _name;
    private _initialized;
    private _bindingInfosByPath;
    private _initializePromise;
    private _resolveInitialize;
    private _listPaths;
    constructor();
    get uuid(): string;
    get state(): IState;
    get name(): string;
    private _getState;
    private _initialize;
    connectedCallback(): Promise<void>;
    get bindingInfosByPath(): Map<string, IBindingInfo[]>;
    get initializePromise(): Promise<void>;
    get listPaths(): Set<string>;
    addBindingInfo(bindingInfo: IBindingInfo): void;
}
//# sourceMappingURL=State.d.ts.map