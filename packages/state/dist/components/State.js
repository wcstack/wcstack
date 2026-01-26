import { config } from "../config";
import { getUUID } from "../getUUID";
import { loadFromInnerScript } from "../stateLoader/loadFromInnerScript";
import { loadFromJsonFile } from "../stateLoader/loadFromJsonFile";
import { loadFromScriptFile } from "../stateLoader/loadFromScriptFile";
import { loadFromScriptJson } from "../stateLoader/loadFromScriptJson";
import { createStateProxy } from "../Proxy";
import { raiseError } from "../raiseError";
import { setElementByUUID } from "../elementByUUID";
import { setStateElementByName } from "../stateElementByName";
export class State extends HTMLElement {
    _uuid = getUUID();
    _state;
    _proxyState;
    _name = 'default';
    _initialized = false;
    _bindingInfosByPath = new Map();
    _initializePromise;
    _resolveInitialize = null;
    _listPaths = new Set();
    static get observedAttributes() { return ['name']; }
    constructor() {
        super();
        setElementByUUID(this._uuid, this);
        this._initializePromise = new Promise((resolve) => {
            this._resolveInitialize = resolve;
        });
    }
    get uuid() {
        return this._uuid;
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
    async _getState(name) {
        const script = this.querySelector('script[type="module"]');
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
    attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'name' && oldValue !== newValue) {
            this._name = newValue;
            setStateElementByName(this._name, this);
        }
    }
    async _initialize() {
        if (!this.hasAttribute('name')) {
            this.setAttribute('name', 'default');
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
    }
}
//# sourceMappingURL=State.js.map