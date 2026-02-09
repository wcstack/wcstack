import { config } from "../config";
import { loadFromInnerScript } from "../stateLoader/loadFromInnerScript";
import { loadFromJsonFile } from "../stateLoader/loadFromJsonFile";
import { loadFromScriptFile } from "../stateLoader/loadFromScriptFile";
import { loadFromScriptJson } from "../stateLoader/loadFromScriptJson";
import { raiseError } from "../raiseError";
import { setStateElementByName } from "../stateElementByName";
import { createLoopContextStack } from "../list/loopContext";
import { WILDCARD } from "../define";
import { getPathInfo } from "../address/PathInfo";
import { createStateProxy } from "../proxy/StateHandler";
import { bindWebComponent } from "../webComponent/bindWebComponent";
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
    _listPaths = new Set();
    _elementPaths = new Set();
    _getterPaths = new Set();
    _setterPaths = new Set();
    _isLoadingState = false;
    _isLoadedState = false;
    _loopContextStack = createLoopContextStack();
    _dynamicDependency = new Map();
    _staticDependency = new Map();
    _pathSet = new Set();
    _version = 0;
    static get observedAttributes() { return ['name', 'src', 'state']; }
    constructor() {
        super();
        this._initializePromise = new Promise((resolve) => {
            this._resolveInitialize = resolve;
        });
        this._loadingPromise = new Promise((resolve) => {
            this._resolveLoading = resolve;
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
        if (!this._isLoadedState && !this._isLoadingState) {
            this._state = {};
        }
        await this._loadingPromise;
        setStateElementByName(this._name, this);
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
    _createState(mutability, callback) {
        try {
            const stateProxy = createStateProxy(this._state, this._name, mutability);
            return callback(stateProxy);
        }
        finally {
            // cleanup if needed
        }
    }
    async createStateAsync(mutability, callback) {
        return await this._createState(mutability, callback);
    }
    createState(mutability, callback) {
        this._createState(mutability, callback);
    }
    nextVersion() {
        this._version++;
        return this._version;
    }
    async bindWebComponent(component) {
        await bindWebComponent(component, this);
    }
    bindProperty(prop, desc) {
        Object.defineProperty(this._state, prop, desc);
    }
}
//# sourceMappingURL=State.js.map