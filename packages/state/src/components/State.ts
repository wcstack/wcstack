import { config } from "../config";
import { loadFromInnerScript } from "../stateLoader/loadFromInnerScript";
import { loadFromJsonFile } from "../stateLoader/loadFromJsonFile";
import { loadFromScriptFile } from "../stateLoader/loadFromScriptFile";
import { loadFromScriptJson } from "../stateLoader/loadFromScriptJson";
import { raiseError } from "../raiseError";
import { BindingType, IState } from "../types";
import { IStateElement } from "./types";
import { setStateElementByName } from "../stateElementByName";
import { ILoopContextStack } from "../list/types";
import { createLoopContextStack } from "../list/loopContext";
import { NO_SET_TIMEOUT, WILDCARD } from "../define";
import { getPathInfo } from "../address/PathInfo";
import { IStateProxy, Mutability } from "../proxy/types";
import { createStateProxy } from "../proxy/StateHandler";
import { bindWebComponent } from "../webComponent/bindWebComponent";

type Descriptors = Record<string, PropertyDescriptor>;

function getAllPropertyDescriptors(obj: object): Descriptors {
  let descriptors: Descriptors = {};
  let proto = obj;
  while (proto && proto !== Object.prototype) {
    Object.assign(descriptors, Object.getOwnPropertyDescriptors(proto));
    proto = Object.getPrototypeOf(proto);
  }
  return descriptors;
}

function getStateInfo(
  state: IState
): { 
  getterPaths: Set<string>,
  setterPaths: Set<string>,
} {
  const getterPaths: Set<string> = new Set<string>();
  const setterPaths: Set<string> = new Set<string>();
  const descriptors = getAllPropertyDescriptors(state);
  for(const [ key, descriptor ] of Object.entries(descriptors)) {
    if (typeof descriptor.get === "function") {
      getterPaths.add(key);
    }
    if (typeof descriptor.set === "function") {
      setterPaths.add(key);
    }
  }
  return {
    getterPaths, setterPaths
  };
}

export class State extends HTMLElement implements IStateElement {
  private __state: IState | undefined;
  private _name: string = 'default';
  private _initialized: boolean = false;
  private _initializePromise: Promise<void>;
  private _resolveInitialize: (() => void) | null = null;
  private _loadingPromise: Promise<void>;
  private _resolveLoading: (() => void) | null = null;
  private _setStatePromise: Promise<Record<string, any>> | null = null;
  private _resolveSetState: ((value: Record<string, any>) => void) | null = null;
  private _listPaths: Set<string> = new Set<string>();
  private _elementPaths: Set<string> = new Set<string>();
  private _getterPaths: Set<string> = new Set<string>();
  private _setterPaths: Set<string> = new Set<string>();
  private _loopContextStack: ILoopContextStack = createLoopContextStack();
  private _dynamicDependency: Map<string, string[]> = new Map<string, string[]>();
  private _staticDependency: Map<string, string[]> = new Map<string, string[]>();
  private _pathSet: Set<string> = new Set<string>();
  private _version = 0;

  constructor() {
    super();
    this._initializePromise = new Promise<void>((resolve) => {
      this._resolveInitialize = resolve;
    });
    this._loadingPromise = new Promise<void>((resolve) => {
      this._resolveLoading = resolve;
    });
    this._setStatePromise = new Promise<Record<string, any>>((resolve) => {
      this._resolveSetState = resolve;
    });
  }

  private get _state(): IState {
    if (typeof this.__state === "undefined") {
      raiseError(`${config.tagNames.state} _state is not initialized yet.`);
    }
    return this.__state;
  }

  private set _state(value: IState) {
    this.__state = value;
    this._listPaths.clear();
    this._elementPaths.clear();
    this._getterPaths.clear();
    this._pathSet.clear();
    const stateInfo = getStateInfo(value);
    for(const path of stateInfo.getterPaths) {
      this._getterPaths.add(path);
    }
    for(const path of stateInfo.setterPaths) {
      this._setterPaths.add(path);
    }
    this._resolveLoading?.();
  }

  get name(): string {
    return this._name;
  }

  private async _initialize() {
    try {
      if (this.hasAttribute('state')) {
        const state = this.getAttribute('state');
        this._state = loadFromScriptJson(state!);
      } else if (this.hasAttribute('src')) {
        const src = this.getAttribute('src');
        if (src && src.endsWith('.json')) {
          this._state = await loadFromJsonFile(src);
        } else if (src && src.endsWith('.js')) {
          this._state = await loadFromScriptFile(src);
        } else {
          raiseError(`Unsupported src file type: ${src}`);
        }
      } else if (this.hasAttribute('json')) {
         const json = this.getAttribute('json');
          this._state = JSON.parse(json!);
      } else {
        const script = this.querySelector<HTMLScriptElement>('script[type="module"]');
        if (script) {
          this._state = await loadFromInnerScript(script, `state#${this._name}`);
        } else {
          const timerId = setTimeout(() => {
            console.warn(`[@wcstack/state] Warning: No state source found for <${config.tagNames.state}> element with name="${this._name}".`);
          }, NO_SET_TIMEOUT);
          // 要注意！！！APIでセットする場合はここで待機する必要がある --(1)
          this._state = await this._setStatePromise!;
          clearTimeout(timerId);
        }
      }
    } catch(e) {
      raiseError(`Failed to initialize state: ${e}`);
    }
    await this._loadingPromise;
    this._name = this.getAttribute('name') || 'default';
    setStateElementByName(this._name, this);

  }

  private async _bindWebComponent() {
    if (this.hasAttribute('bind-component')) {
      const rootNode = this.getRootNode();
      if (!(rootNode instanceof ShadowRoot)) {
        raiseError('bind-component can only be used inside a shadow root.');
      }
      const component = rootNode.host;
      const componentStateProp = this.getAttribute('bind-component')!;
      try {
        await customElements.whenDefined(component.tagName.toLowerCase());
        if (!(componentStateProp in component)) {
          raiseError(`Component does not have property "${componentStateProp}" for state binding.`);
        }
        const state = (component as any)[componentStateProp] as Record<string, any>;
        if (typeof state !== 'object' || state === null) {
          raiseError(`Component property "${componentStateProp}" is not an object for state binding.`);
        }
        await this.bindWebComponent(component, componentStateProp, state);
      } catch(e) {
        raiseError(`Failed to bind web component: ${e}`);
      }
    }
  }

  async connectedCallback() {
    if (!this._initialized) {
      // (1)のデッドロック回避のためにawaitしない
      this._bindWebComponent();
      await this._initialize();
      this._initialized = true;
      this._resolveInitialize?.();
    }
  }

  disconnectedCallback() {
    setStateElementByName(this._name, null);
  }

  get initializePromise(): Promise<void> {
    return this._initializePromise;
  }

  get listPaths(): Set<string> {
    return this._listPaths;
  }

  get elementPaths(): Set<string> {
    return this._elementPaths;
  }

  get getterPaths(): Set<string> {
    return this._getterPaths;
  }

  get setterPaths(): Set<string> {
    return this._setterPaths;
  }

  get loopContextStack(): ILoopContextStack {
    return this._loopContextStack;
  }

  get dynamicDependency(): Map<string, string[]> {
    return this._dynamicDependency;
  }

  get staticDependency(): Map<string, string[]> {
    return this._staticDependency;
  }

  get version(): number {
    return this._version;
  }

  private _addDependency(
    map: Map<string, string[]>, 
    sourcePath: string, 
    targetPath: string
  ): boolean {
    const deps = map.get(sourcePath);
    if (deps === undefined) {
      map.set(sourcePath, [targetPath]);
      return true;
    } else if (!deps.includes(targetPath)) {
      deps.push(targetPath);
      return true;
    }
    return false;
  }  

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
  addDynamicDependency(sourcePath: string, targetPath: string): boolean {
    return this._addDependency(this._dynamicDependency, sourcePath, targetPath);
  }

  /**
   * source,      target
   * products => products.*
   * products.* => products.*.price
   * products.* => products.*.name
   * 
   * @param sourcePath 
   * @param targetPath 
   */
  addStaticDependency(sourcePath: string, targetPath: string): boolean {
    return this._addDependency(this._staticDependency, sourcePath, targetPath);
  }

  setPathInfo(path: string, bindingType: BindingType): void {
    if (bindingType === "for") {
      this._listPaths.add(path);
      this._elementPaths.add(path + '.' + WILDCARD);
    }
    if (!this._pathSet.has(path)) {
      const pathInfo = getPathInfo(path);
      this._pathSet.add(path);
      if (pathInfo.parentPath !== null) {
        let currentPathInfo = pathInfo;
        while(currentPathInfo.parentPath !== null) {
          if (!this.addStaticDependency(currentPathInfo.parentPath, currentPathInfo.path)) {
            break;
          }
          currentPathInfo = getPathInfo(currentPathInfo.parentPath);
        }
      }
    }
  }

  private _createState<T>(mutability: Mutability, callback: (state: IStateProxy) => T): T {
    try {
      const stateProxy = createStateProxy(this._state, this._name, mutability);
      return callback(stateProxy);
    } finally {
      // cleanup if needed
    }
  }

  async createStateAsync(mutability: Mutability, callback: (state: IStateProxy) => Promise<void>): Promise<void> {
    return await this._createState(mutability, callback);
  }

  createState(mutability: Mutability, callback: (state: IStateProxy) => void): void {
    this._createState(mutability, callback);
  }

  nextVersion(): number {
    this._version++;
    return this._version;
  }

  async bindWebComponent(component: Element, stateProp: string, initialState: Record<string, any>): Promise<void> {
    await bindWebComponent(this, component, stateProp, initialState);
  }

  bindProperty(prop: string, desc: PropertyDescriptor): void {
    Object.defineProperty(this._state, prop, desc);
  }

  setInitialState(state: Record<string, any>): void {
    if (this._initialized) {
      raiseError('setInitialState cannot be called after state is initialized.');
    }
    this._resolveSetState?.(state);
  }
}
