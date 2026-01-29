import { IBindingInfo, IState } from "../types";
import { IStateElement } from "./types";
import { ILoopContextStack } from "../list/types";
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
    private _loopContextStack;
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
    get loopContextStack(): ILoopContextStack;
    addBindingInfo(bindingInfo: IBindingInfo): void;
    deleteBindingInfo(bindingInfo: IBindingInfo): void;
}
//# sourceMappingURL=State.d.ts.map