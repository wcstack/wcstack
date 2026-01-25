import { applyChangeToNode } from "../applyChangeToNode";
import { config } from "../config";
import { getBindingInfos } from "../getBindingInfos";
import { getSubscriberNodes } from "../getSubscriberNodes";
import { getUUID } from "../getUUID";
import { loadFromInnerScript } from "../stateLoader/loadFromInnerScript";
import { loadFromJsonFile } from "../stateLoader/loadFromJsonFile";
import { loadFromScriptFile } from "../stateLoader/loadFromScriptFile";
import { loadFromScriptJson } from "../stateLoader/loadFromScriptJson";
import { createStateProxy } from "../Proxy";
import { raiseError } from "../raiseError";
import { IBindingInfo, IState } from "../types";
import { IStateElement } from "./types";

export class State extends HTMLElement implements IStateElement {
  private _uuid: string = getUUID();
  private _state: IState | undefined;
  private _proxyState: IState | undefined;
  private _name: string = 'default';
  private _initialized: boolean = false;
  private _bindingInfosByPath = new Map<string, IBindingInfo[]>();
  private _initializePromise: Promise<void>;
  private _resolveInitialize: (() => void) | null = null;
  private _listPaths: Set<string> = new Set<string>();
  constructor() {
    super();
    this._initializePromise = new Promise<void>((resolve) => {
      this._resolveInitialize = resolve;
    });
  }

  get uuid(): string {
    return this._uuid;
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

  private async _getState(name: string): Promise<IState> {
    const script = this.querySelector<HTMLScriptElement>('script[type="module"]');
    if (script) {
      return await loadFromInnerScript(script, `state#${name}`);
    }
    const src = this.getAttribute('src');
    if (src && src.endsWith('.json')) {
      return await loadFromJsonFile(src);
    }
    if (src && src.endsWith('.js')) {
      return await loadFromScriptFile(src);
    }
    if (src) {
      raiseError(`Unsupported src file type: ${src}`);
    }
    const jsonKey = this.getAttribute('state');
    if (jsonKey) {
      return loadFromScriptJson(jsonKey);
    }
    return {};
  }

  private async _initialize() {
    const name = this.getAttribute('name');
    if (name === null) {
      this._name = 'default';
      this.setAttribute('name', this._name);
    } else {
      this._name = name;
    }
    this._state = await this._getState(this._name);
  }

  async connectedCallback() {
    if (!this._initialized) {
      await this._initialize();
      this._initialized = true;
      this._resolveInitialize?.();
    }
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
  }
}
