import { IBindingInfo } from "../types";
import { ILoopElement, IStateElement } from "./types";
export declare class Loop extends HTMLElement implements ILoopElement {
    private _uuid;
    private _path;
    private _stateElement;
    private _placeHolder;
    private _initializePromise;
    private _resolveInitialize;
    private _initialized;
    private _loopContent;
    private _loopContents;
    private _loopValue;
    private _bindingInfo;
    static get observedAttributes(): string[];
    constructor();
    get uuid(): string;
    get path(): string;
    get stateElement(): IStateElement;
    get loopContent(): DocumentFragment;
    get bindingInfo(): IBindingInfo;
    get initializePromise(): Promise<void>;
    attributeChangedCallback(name: string, oldValue: string, newValue: string): void;
    initialize(): void;
    connectedCallback(): Promise<void>;
    get loopValue(): any;
    set loopValue(value: any);
    render(newValue: any, oldValue: any): void;
}
//# sourceMappingURL=Loop.d.ts.map