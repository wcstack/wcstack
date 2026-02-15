import { config } from "../config";
import { loadFromInnerScript } from "../stateLoader/loadFromInnerScript";
import { loadFromJsonFile } from "../stateLoader/loadFromJsonFile";
import { loadFromScriptFile } from "../stateLoader/loadFromScriptFile";
import { loadFromScriptJson } from "../stateLoader/loadFromScriptJson";
import { raiseError } from "../raiseError";
import { setStateElementByName } from "../stateElementByName";
import { createLoopContextStack } from "../list/loopContext";
import { NO_SET_TIMEOUT, STATE_CONNECTED_CALLBACK_NAME, STATE_DISCONNECTED_CALLBACK_NAME, WILDCARD } from "../define";
import { getPathInfo } from "../address/PathInfo";
import { createStateProxy } from "../proxy/StateHandler";
import { bindWebComponent } from "../webComponent/bindWebComponent";
import { connectedCallbackSymbol, disconnectedCallbackSymbol } from "../proxy/symbols";
function getAllPropertyDescriptors(obj) {
    let descriptors = {};
    let proto = obj;
    while (proto && proto !== Object.prototype) {
        Object.assign(descriptors, Object.getOwnPropertyDescriptors(proto));
        proto = Object.getPrototypeOf(proto);
    }
    return descriptors;
}
function getStateInfo(state) {
    const getterPaths = new Set();
    const setterPaths = new Set();
    const descriptors = getAllPropertyDescriptors(state);
    for (const [key, descriptor] of Object.entries(descriptors)) {
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
export class State extends HTMLElement {
    __state;
    _name = 'default';
    _initialized = false;
    _initializePromise;
    _resolveInitialize = null;
    _loadingPromise;
    _resolveLoading = null;
    _setStatePromise = null;
    _resolveSetState = null;
    _listPaths = new Set();
    _elementPaths = new Set();
    _getterPaths = new Set();
    _setterPaths = new Set();
    _loopContextStack = createLoopContextStack();
    _dynamicDependency = new Map();
    _staticDependency = new Map();
    _pathSet = new Set();
    _version = 0;
    _rootNode = null;
    _boundComponent = null;
    _boundComponentStateProp = null;
    constructor() {
        super();
        this._initializePromise = new Promise((resolve) => {
            this._resolveInitialize = resolve;
        });
        this._loadingPromise = new Promise((resolve) => {
            this._resolveLoading = resolve;
        });
        this._setStatePromise = new Promise((resolve) => {
            this._resolveSetState = resolve;
        });
    }
    get _state() {
        if (typeof this.__state === "undefined") {
            raiseError(`${config.tagNames.state} _state is not initialized yet.`);
        }
        return this.__state;
    }
    set _state(value) {
        this.__state = value;
        this._listPaths.clear();
        this._elementPaths.clear();
        this._getterPaths.clear();
        this._pathSet.clear();
        const stateInfo = getStateInfo(value);
        for (const path of stateInfo.getterPaths) {
            this._getterPaths.add(path);
        }
        for (const path of stateInfo.setterPaths) {
            this._setterPaths.add(path);
        }
        this._resolveLoading?.();
    }
    get name() {
        return this._name;
    }
    async _initialize() {
        try {
            if (this.hasAttribute('state')) {
                const state = this.getAttribute('state');
                this._state = loadFromScriptJson(state);
            }
            else if (this.hasAttribute('src')) {
                const src = this.getAttribute('src');
                if (src && src.endsWith('.json')) {
                    this._state = await loadFromJsonFile(src);
                }
                else if (src && src.endsWith('.js')) {
                    this._state = await loadFromScriptFile(src);
                }
                else {
                    raiseError(`Unsupported src file type: ${src}`);
                }
            }
            else if (this.hasAttribute('json')) {
                const json = this.getAttribute('json');
                this._state = JSON.parse(json);
            }
            else {
                const script = this.querySelector('script[type="module"]');
                if (script) {
                    this._state = await loadFromInnerScript(script, `state#${this._name}`);
                }
                else {
                    const timerId = setTimeout(() => {
                        console.warn(`[@wcstack/state] Warning: No state source found for <${config.tagNames.state}> element with name="${this._name}".`);
                    }, NO_SET_TIMEOUT);
                    // 要注意！！！APIでセットする場合はここで待機する必要がある --(1)
                    this._state = await this._setStatePromise;
                    clearTimeout(timerId);
                }
            }
        }
        catch (e) {
            raiseError(`Failed to initialize state: ${e}`);
        }
        await this._loadingPromise;
        this._name = this.getAttribute('name') || 'default';
        setStateElementByName(this.rootNode, this._name, this);
    }
    async _initializeBindWebComponent() {
        if (this.hasAttribute(config.bindComponentAttributeName)) {
            if (!(this.rootNode instanceof ShadowRoot)) {
                raiseError(`${config.bindComponentAttributeName} can only be used inside a shadow root.`);
            }
            const boundComponent = this.rootNode.host;
            const boundComponentStateProp = this.getAttribute(config.bindComponentAttributeName);
            try {
                await customElements.whenDefined(boundComponent.tagName.toLowerCase());
                if (!(boundComponentStateProp in boundComponent)) {
                    raiseError(`Component does not have property "${boundComponentStateProp}" for state binding.`);
                }
                const state = boundComponent[boundComponentStateProp];
                if (typeof state !== 'object' || state === null) {
                    raiseError(`Component property "${boundComponentStateProp}" is not an object for state binding.`);
                }
                this.setInitialState(state);
                this._boundComponent = boundComponent;
                this._boundComponentStateProp = boundComponentStateProp;
            }
            catch (e) {
                raiseError(`Failed to bind web component: ${e}`);
            }
        }
    }
    async _bindWebComponent() {
        if (this._boundComponent === null || this._boundComponentStateProp === null) {
            return;
        }
        await bindWebComponent(this, this._boundComponent, this._boundComponentStateProp);
    }
    async _callStateConnectedCallback() {
        await this.createStateAsync("writable", async (state) => {
            // stateに"$connectedCallback"があるか確認し、connectedCallbackAPIを呼び出す
            if (STATE_CONNECTED_CALLBACK_NAME in state) {
                await state[connectedCallbackSymbol]();
            }
        });
    }
    _callStateDisconnectedCallback() {
        this.createState("writable", (state) => {
            // stateに"$disconnectedCallback"があるか確認し、disconnectedCallbackAPIを呼び出す
            if (STATE_DISCONNECTED_CALLBACK_NAME in state) {
                state[disconnectedCallbackSymbol]();
            }
        });
    }
    async connectedCallback() {
        this._rootNode = this.getRootNode();
        if (!this._initialized) {
            await this._initializeBindWebComponent();
            await this._initialize();
            this._initialized = true;
            this._resolveInitialize?.();
            await this._bindWebComponent();
        }
        await this._callStateConnectedCallback();
    }
    disconnectedCallback() {
        if (this._rootNode !== null) {
            this._callStateDisconnectedCallback();
            setStateElementByName(this.rootNode, this._name, null);
            this._rootNode = null;
        }
    }
    get initializePromise() {
        return this._initializePromise;
    }
    get listPaths() {
        return this._listPaths;
    }
    get elementPaths() {
        return this._elementPaths;
    }
    get getterPaths() {
        return this._getterPaths;
    }
    get setterPaths() {
        return this._setterPaths;
    }
    get loopContextStack() {
        return this._loopContextStack;
    }
    get dynamicDependency() {
        return this._dynamicDependency;
    }
    get staticDependency() {
        return this._staticDependency;
    }
    get version() {
        return this._version;
    }
    get rootNode() {
        if (this._rootNode === null) {
            raiseError('State rootNode is not available.');
        }
        return this._rootNode;
    }
    get boundComponentStateProp() {
        return this._boundComponentStateProp;
    }
    _addDependency(map, sourcePath, targetPath) {
        const deps = map.get(sourcePath);
        if (deps === undefined) {
            map.set(sourcePath, [targetPath]);
            return true;
        }
        else if (!deps.includes(targetPath)) {
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
    addDynamicDependency(sourcePath, targetPath) {
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
    addStaticDependency(sourcePath, targetPath) {
        return this._addDependency(this._staticDependency, sourcePath, targetPath);
    }
    setPathInfo(path, bindingType) {
        if (bindingType === "for") {
            this._listPaths.add(path);
            this._elementPaths.add(path + '.' + WILDCARD);
        }
        if (!this._pathSet.has(path)) {
            const pathInfo = getPathInfo(path);
            this._pathSet.add(path);
            if (pathInfo.parentPath !== null) {
                let currentPathInfo = pathInfo;
                while (currentPathInfo.parentPath !== null) {
                    if (!this.addStaticDependency(currentPathInfo.parentPath, currentPathInfo.path)) {
                        break;
                    }
                    currentPathInfo = getPathInfo(currentPathInfo.parentPath);
                }
            }
        }
    }
    _createState(rootNode, mutability, callback) {
        try {
            const stateProxy = createStateProxy(rootNode, this._state, this._name, mutability);
            return callback(stateProxy);
        }
        finally {
            // cleanup if needed
        }
    }
    async createStateAsync(mutability, callback) {
        return await this._createState(this.rootNode, mutability, callback);
    }
    createState(mutability, callback) {
        this._createState(this.rootNode, mutability, callback);
    }
    nextVersion() {
        this._version++;
        return this._version;
    }
    bindProperty(prop, desc) {
        Object.defineProperty(this._state, prop, desc);
    }
    setInitialState(state) {
        if (!this._initialized) {
            this._resolveSetState?.(state);
        }
        else {
            this._state = state;
        }
    }
}
//# sourceMappingURL=State.js.map