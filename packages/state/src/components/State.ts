import { config } from "../config";
import { loadFromInnerScript } from "../stateLoader/loadFromInnerScript";
import { loadFromJsonFile } from "../stateLoader/loadFromJsonFile";
import { loadFromScriptFile } from "../stateLoader/loadFromScriptFile";
import { loadFromScriptJson } from "../stateLoader/loadFromScriptJson";
import { createStateProxy } from "../proxy/Proxy";
import { raiseError } from "../raiseError";
import { IBindingInfo, IState } from "../types";
import { IStateElement } from "./types";
import { setStateElementByName } from "../stateElementByName";

export class State extends HTMLElement implements IStateElement {
  private _state: IState | undefined;
  private _proxyState: IState | undefined;
  private _name: string = 'default';
  private _initialized: boolean = false;
  private _bindingInfosByPath = new Map<string, IBindingInfo[]>();
  private _initializePromise: Promise<void>;
  private _resolveInitialize: (() => void) | null = null;
  private _listPaths: Set<string> = new Set<string>();
  private _isLoadingState: boolean = false;
  private _isLoadedState: boolean = false;

  static get observedAttributes() { return [ 'name', 'src', 'state' ]; }

  constructor() {
    super();
    this._initializePromise = new Promise<void>((resolve) => {
      this._resolveInitialize = resolve;
    });
  }

  get state(): IState {
    if (typeof this._state === "undefined") {
      raiseError(`${config.tagNames.state} _state is not initialized yet.`);
    }
    if (typeof this._proxyState === "undefined") {
      this._proxyState = createStateProxy(this._state, this._bindingInfosByPath, this._listPaths);
    }
    return this._proxyState;
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

  get bindingInfosByPath(): Map<string, IBindingInfo[]> {
    return this._bindingInfosByPath;
  }

  get initializePromise(): Promise<void> {
    return this._initializePromise;
  }

  get listPaths(): Set<string> {
    return this._listPaths;
  }

  addBindingInfo(bindingInfo: IBindingInfo): void {
    const path = bindingInfo.statePathName;
    const bindingInfos = this._bindingInfosByPath.get(path);
    if (typeof bindingInfos === "undefined") {
      this._bindingInfosByPath.set(path, [ bindingInfo ]);
    } else {
      bindingInfos.push(bindingInfo);
    }
    if (bindingInfo.bindingType === "for") {
      this._listPaths.add(path);
    }
  }
}
