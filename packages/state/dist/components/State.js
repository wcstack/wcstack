import { config } from "../config";
import { loadFromInnerScript } from "../stateLoader/loadFromInnerScript";
import { loadFromJsonFile } from "../stateLoader/loadFromJsonFile";
import { loadFromScriptFile } from "../stateLoader/loadFromScriptFile";
import { loadFromScriptJson } from "../stateLoader/loadFromScriptJson";
import { createStateProxy } from "../proxy/Proxy";
import { raiseError } from "../raiseError";
import { setStateElementByName } from "../stateElementByName";
export class State extends HTMLElement {
    _state;
    _proxyState;
    _name = 'default';
    _initialized = false;
    _bindingInfosByPath = new Map();
    _initializePromise;
    _resolveInitialize = null;
    _listPaths = new Set();
    _isLoadingState = false;
    _isLoadedState = false;
    static get observedAttributes() { return ['name', 'src', 'state']; }
    constructor() {
        super();
        this._initializePromise = new Promise((resolve) => {
            this._resolveInitialize = resolve;
        });
    }
    get state() {
        if (typeof this._state === "undefined") {
            raiseError(`${config.tagNames.state} _state is not initialized yet.`);
        }
        if (typeof this._proxyState === "undefined") {
            this._proxyState = createStateProxy(this._state, this._bindingInfosByPath, this._listPaths);
        }
        return this._proxyState;
    }
    get name() {
        return this._name;
    }
    attributeChangedCallback(name, oldValue, newValue) {
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
            }
            else if (newValue && newValue.endsWith('.js')) {
                this._isLoadingState = true;
                loadFromScriptFile(newValue).then((state) => {
                    this._isLoadedState = true;
                    this._state = state;
                }).finally(() => {
                    this._isLoadingState = false;
                });
            }
            else {
                raiseError(`Unsupported src file type: ${newValue}`);
            }
        }
    }
    async _initialize() {
        if (!this._isLoadedState && !this._isLoadingState) {
            this._isLoadingState = true;
            try {
                const script = this.querySelector('script[type="module"]');
                if (script) {
                    this._state = await loadFromInnerScript(script, `state#${this._name}`);
                    this._isLoadedState = true;
                }
            }
            catch (e) {
                raiseError(`Failed to load state from inner script: ${e.message}`);
            }
            finally {
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
    get bindingInfosByPath() {
        return this._bindingInfosByPath;
    }
    get initializePromise() {
        return this._initializePromise;
    }
    get listPaths() {
        return this._listPaths;
    }
    addBindingInfo(bindingInfo) {
        const path = bindingInfo.statePathName;
        const bindingInfos = this._bindingInfosByPath.get(path);
        if (typeof bindingInfos === "undefined") {
            this._bindingInfosByPath.set(path, [bindingInfo]);
        }
        else {
            bindingInfos.push(bindingInfo);
        }
        if (bindingInfo.bindingType === "for") {
            this._listPaths.add(path);
        }
    }
}
//# sourceMappingURL=State.js.map