import { IBindingInfo } from "../types";
import { IStateElement } from "./types";
import { ILoopContextStack } from "../list/types";
import { IStateProxy, Mutability } from "../proxy/types";
export declare class State extends HTMLElement implements IStateElement {
    private __state;
    private _name;
    private _initialized;
    private _initializePromise;
    private _resolveInitialize;
    private _listPaths;
    private _elementPaths;
    private _getterPaths;
    private _setterPaths;
    private _isLoadingState;
    private _isLoadedState;
    private _loopContextStack;
    private _dynamicDependency;
    private _staticDependency;
    private _pathSet;
    private _version;
    static get observedAttributes(): string[];
    constructor();
    private get _state();
    private set _state(value);
    get name(): string;
    attributeChangedCallback(name: string, oldValue: string, newValue: string): void;
    private _initialize;
    connectedCallback(): Promise<void>;
    disconnectedCallback(): void;
    get initializePromise(): Promise<void>;
    get listPaths(): Set<string>;
    get elementPaths(): Set<string>;
    get getterPaths(): Set<string>;
    get setterPaths(): Set<string>;
    get loopContextStack(): ILoopContextStack;
    get dynamicDependency(): Map<string, string[]>;
    get staticDependency(): Map<string, string[]>;
    get version(): number;
    private _addDependency;
    /**
     * source,           target
     *
     * products.*.price => products.*.tax
     * get "products.*.tax"() { return this["products.*.price"] * 0.1; }
     *
     * products.*.price => products.summary
     * get "products.summary"() { return this.$getAll("products.*.price", []).reduce(sum); }
     *
     * categories.*.name => categories.*.products.*.categoryName
     * get "categories.*.products.*.categoryName"() { return this["categories.*.name"]; }
     *
     * @param sourcePath
     * @param targetPath
     */
    addDynamicDependency(sourcePath: string, targetPath: string): void;
    /**
     * source,      target
     * products => products.*
     * products.* => products.*.price
     * products.* => products.*.name
     *
     * @param sourcePath
     * @param targetPath
     */
    addStaticDependency(sourcePath: string, targetPath: string): void;
    setBindingInfo(bindingInfo: IBindingInfo): void;
    private _createState;
    createStateAsync(mutability: Mutability, callback: (state: IStateProxy) => Promise<void>): Promise<void>;
    createState(mutability: Mutability, callback: (state: IStateProxy) => void): void;
    nextVersion(): number;
}
//# sourceMappingURL=State.d.ts.map