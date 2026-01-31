import { config } from "../config";
import { loadFromInnerScript } from "../stateLoader/loadFromInnerScript";
import { loadFromJsonFile } from "../stateLoader/loadFromJsonFile";
import { loadFromScriptFile } from "../stateLoader/loadFromScriptFile";
import { loadFromScriptJson } from "../stateLoader/loadFromScriptJson";
import { raiseError } from "../raiseError";
import { IBindingInfo, IState } from "../types";
import { IStateElement } from "./types";
import { setStateElementByName } from "../stateElementByName";
import { ILoopContextStack } from "../list/types";
import { createLoopContextStack } from "../list/loopContext";
import { IStateAddress } from "../address/types";
import { ICacheEntry } from "../cache/types";
import { IVersionInfo } from "../version/types";
import { WILDCARD } from "../define";
import { get } from "../proxy/traps/get";
import { getPathInfo } from "../address/PathInfo";
import { IStateProxy } from "../proxy/types";
import { createStateProxy } from "../proxy/StateHandler";
import { IUpdater } from "../updater/types";
import { createUpdater } from "../updater/updater";
import { getListIndexByBindingInfo } from "../list/getListIndexByBindingInfo";
import { createStateAddress } from "../address/StateAddress";

type Descriptors = Record<string, PropertyDescriptor>;

function getAllPropertyDescriptors(obj: Object): Descriptors {
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
  getterPaths: Set<string> 
} {
  const getterPaths: Set<string> = new Set<string>();
  const descriptors = getAllPropertyDescriptors(state);
  for(const [ key, descriptor ] of Object.entries(descriptors)) {
    if (typeof descriptor.get === "function") {
      getterPaths.add(key);
    }
  }
  return {
    getterPaths,
  };
}

export class State extends HTMLElement implements IStateElement {
  private __state: IState | undefined;
  private _proxyState: IStateProxy | undefined;
  private _name: string = 'default';
  private _initialized: boolean = false;
  private _bindingInfosByAddress = new Map<IStateAddress, IBindingInfo[]>();
  private _initializePromise: Promise<void>;
  private _resolveInitialize: (() => void) | null = null;
  private _listPaths: Set<string> = new Set<string>();
  private _elementPaths: Set<string> = new Set<string>();
  private _getterPaths: Set<string> = new Set<string>();
  private _isLoadingState: boolean = false;
  private _isLoadedState: boolean = false;
  private _loopContextStack: ILoopContextStack = createLoopContextStack();
  private _cache: Map<IStateAddress, ICacheEntry> = new Map<IStateAddress, ICacheEntry>();
  private _mightChangeByPath: Map<string, IVersionInfo> = new Map<string, IVersionInfo>();
  private _dynamicDependency: Map<string, string[]> = new Map<string, string[]>();
  private _staticDependency: Map<string, string[]> = new Map<string, string[]>();
  private _pathSet: Set<string> = new Set<string>();
  private _version = 0;

  static get observedAttributes() { return [ 'name', 'src', 'state' ]; }

  constructor() {
    super();
    this._initializePromise = new Promise<void>((resolve) => {
      this._resolveInitialize = resolve;
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
    this._proxyState = undefined;
    const stateInfo = getStateInfo(value);
    for(const path of stateInfo.getterPaths) {
      this._getterPaths.add(path);
    }
  }

  get name(): string {
    return this._name;
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string): void {
    if (name === 'name' && oldValue !== newValue) {
      setStateElementByName(this._name, null);
      this._name = newValue;
      setStateElementByName(this._name, this);
    }
    if (name === 'state' && oldValue !== newValue) {
      if (this._isLoadedState) {
        raiseError(`The state has already been loaded. The 'state' attribute cannot be changed multiple times.`);
      }
      if (this._isLoadingState) {
        raiseError(`The state is currently loading. The 'state' attribute cannot be changed during loading.`);
      }
      this._state = loadFromScriptJson(newValue);
      this._isLoadedState = true;
    }
    if (name === 'src' && oldValue !== newValue) {
      if (this._isLoadedState) {
        raiseError(`The state has already been loaded. The 'src' attribute cannot be changed multiple times.`);
      }
      if (this._isLoadingState) {
        raiseError(`The state is currently loading. The 'src' attribute cannot be changed during loading.`);
      }
      if (newValue && newValue.endsWith('.json')) {
        this._isLoadingState = true;
        loadFromJsonFile(newValue).then((state) => {
          this._isLoadedState = true;
          this._state = state;
        }).finally(() => {
          this._isLoadingState = false;
        });
      } else if (newValue && newValue.endsWith('.js')) {
        this._isLoadingState = true;
        loadFromScriptFile(newValue).then((state) => {
          this._isLoadedState = true;
          this._state = state;
        }).finally(() => {
          this._isLoadingState = false;
        });
      } else {
        raiseError(`Unsupported src file type: ${newValue}`);
      }
    }
  }

  private async _initialize() {
    if (!this._isLoadedState && !this._isLoadingState) {
      this._isLoadingState = true;
      try {
        const script = this.querySelector<HTMLScriptElement>('script[type="module"]');
        if (script) {
          this._state = await loadFromInnerScript(script, `state#${this._name}`);
          this._isLoadedState = true;
        }
      } catch(e) {
        raiseError(`Failed to load state from inner script: ${(e as Error).message}`);

      } finally {
        this._isLoadingState = false;

      }
    }
    if (typeof this._state === "undefined") {
      this._state = {};
    }
  }

  async connectedCallback() {
    if (!this._initialized) {
      await this._initialize();
      this._initialized = true;
      this._resolveInitialize?.();
    }
  }

  disconnectedCallback() {
    setStateElementByName(this._name, null);
  }

  get bindingInfosByAddress(): Map<IStateAddress, IBindingInfo[]> {
    return this._bindingInfosByAddress;
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

  get loopContextStack(): ILoopContextStack {
    return this._loopContextStack;
  }

  get cache(): Map<IStateAddress, ICacheEntry> {
    return this._cache;
  }

  get mightChangeByPath(): Map<string, IVersionInfo> {
    return this._mightChangeByPath;
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

  addDynamicDependency(fromPath: string, toPath: string): void {
    const deps = this._dynamicDependency.get(fromPath);
    if (typeof deps === "undefined") {
      this._dynamicDependency.set(fromPath, [ toPath ]);
    } else {
      if (!deps.includes(toPath)) {
        deps.push(toPath);
      }
    }
  }

  addStaticDependency(fromPath: string, toPath: string): void {
    const deps = this._staticDependency.get(fromPath);
    if (typeof deps === "undefined") {
      this._staticDependency.set(fromPath, [ toPath ]);
    } else {
      if (!deps.includes(toPath)) {
        deps.push(toPath);
      }
    }
  }

  addBindingInfo(bindingInfo: IBindingInfo): void {
    const listIndex = getListIndexByBindingInfo(bindingInfo);
    const address = createStateAddress(bindingInfo.statePathInfo!, listIndex);
    const path = bindingInfo.statePathName;
    const bindingInfos = this._bindingInfosByAddress.get(address);
    if (typeof bindingInfos === "undefined") {
      this._bindingInfosByAddress.set(address, [ bindingInfo ]);
    } else {
      bindingInfos.push(bindingInfo);
    }
    if (bindingInfo.bindingType === "for") {
      this._listPaths.add(path);
      this._elementPaths.add(path + '.' + WILDCARD);
    }
    if (!this._pathSet.has(path)) {
      const pathInfo = getPathInfo(path);
      this._pathSet.add(path);
      if (pathInfo.parentPath !== null) {
        this.addStaticDependency(pathInfo.parentPath, path);
      }
    }
  }

  deleteBindingInfo(bindingInfo: IBindingInfo): void {
    const listIndex = getListIndexByBindingInfo(bindingInfo);
    const address = createStateAddress(bindingInfo.statePathInfo!, listIndex);
    const bindingInfos = this._bindingInfosByAddress.get(address);
    if (typeof bindingInfos !== "undefined") {
      const index = bindingInfos.indexOf(bindingInfo);
      if (index !== -1) {
        bindingInfos.splice(index, 1);
      }
    }
  }

  async createState(callback: (state: IStateProxy) => Promise<void>): Promise<void> {
    const stateProxy = createStateProxy(this._state, this._name);
    return callback(stateProxy);
  }

  nextVersion(): number {
    this._version++;
    return this._version;
  }
}
