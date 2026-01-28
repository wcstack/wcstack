import { IBindingInfo, IState } from "../types";
import { IStateElement } from "./types";
export declare class State extends HTMLElement implements IStateElement {
    private _state;
    private _proxyState;
    private _name;
    private _initialized;
    private _bindingInfosByPath;
    private _initializePromise;
    private _resolveInitialize;
    private _listPaths;
    private _isLoadingState;
    private _isLoadedState;
    static get observedAttributes(): string[];
    constructor();
    get state(): IState;
    get name(): string;
    attributeChangedCallback(name: string, oldValue: string, newValue: string): void;
    private _initialize;
    connectedCallback(): Promise<void>;
    disconnectedCallback(): void;
    get bindingInfosByPath(): Map<string, IBindingInfo[]>;
    get initializePromise(): Promise<void>;
    get listPaths(): Set<string>;
    addBindingInfo(bindingInfo: IBindingInfo): void;
}
//# sourceMappingURL=State.d.ts.map