const config = {
    bindAttributeName: 'data-bind-state',
    commentTextPrefix: 'wcs-text',
    commentForPrefix: 'wcs-for',
    commentIfPrefix: 'wcs-if',
    commentElseIfPrefix: 'wcs-elseif',
    commentElsePrefix: 'wcs-else',
    tagNames: {
        state: 'wcs-state',
    },
};

function getUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Simple UUID generator
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0, v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

async function loadFromInnerScript(script, name) {
    let scriptModule = null;
    const uniq_comment = `\n//# sourceURL=${name}\n`;
    if (typeof URL.createObjectURL === 'function') {
        // Create a blob URL for the script and dynamically import it
        const blob = new Blob([script.text + uniq_comment], { type: "application/javascript" });
        const url = URL.createObjectURL(blob);
        try {
            scriptModule = await import(url);
        }
        finally {
            // Clean up blob URL to prevent memory leak
            URL.revokeObjectURL(url);
        }
    }
    else {
        // Fallback: Base64 encoding method (for test environment)
        // Convert script to Base64 and import via data: URL
        const b64 = btoa(String.fromCodePoint(...new TextEncoder().encode(script.text + uniq_comment)));
        scriptModule = await import(`data:application/javascript;base64,${b64}`);
    }
    return (scriptModule && typeof scriptModule.default === 'object') ? scriptModule.default : {};
}

function raiseError(message) {
    throw new Error(`[@wcstack/state] ${message}`);
}

async function loadFromJsonFile(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            raiseError(`Failed to fetch JSON file: ${response.statusText}`);
        }
        const data = await response.json();
        return data;
    }
    catch (e) {
        console.error('Failed to load JSON file:', e);
        return {};
    }
}

async function loadFromScriptFile(url) {
    try {
        const module = await import(/* @vite-ignore */ url);
        return module.default || {};
    }
    catch (e) {
        raiseError(`Failed to load script file: ${e}`);
    }
}

function loadFromScriptJson(id) {
    const script = document.getElementById(id);
    if (script && script.type === 'application/json') {
        try {
            const data = JSON.parse(script.textContent || '{}');
            return data;
        }
        catch (e) {
            raiseError('Failed to parse JSON from script element:' + e);
        }
    }
    return {};
}

const DELIMITER = '.';
const WILDCARD = '*';

const _cache = {};
function getPathInfo(path) {
    if (_cache[path]) {
        return _cache[path];
    }
    const pathInfo = new PathInfo(path);
    _cache[path] = pathInfo;
    return pathInfo;
}
class PathInfo {
    path = "";
    segments = [];
    wildcardPositions = [];
    wildcardPaths = [];
    wildcardParentPaths = [];
    wildcardPathInfos = [];
    wildcardParentPathInfos = [];
    _parentPathInfo = undefined;
    constructor(path) {
        this.path = path;
        this.segments = path.split(DELIMITER).filter(seg => seg.length > 0);
        this.wildcardPositions = this.segments
            .map((seg, index) => (seg === WILDCARD ? index : -1))
            .filter(index => index !== -1);
        this.wildcardPaths = this.wildcardPositions.map(pos => this.segments.slice(0, pos + 1).join(DELIMITER));
        this.wildcardParentPaths = this.wildcardPositions.map(pos => this.segments.slice(0, pos).join(DELIMITER));
        this.wildcardPathInfos = this.wildcardPaths.map(p => p === path ? this : getPathInfo(p));
        this.wildcardParentPathInfos = this.wildcardParentPaths.map(p => p === path ? this : getPathInfo(p));
    }
    get parentPathInfo() {
        if (typeof this._parentPathInfo !== "undefined") {
            return this._parentPathInfo;
        }
        if (this.segments.length === 0) {
            return null;
        }
        const parentSegments = this.segments.slice(0, -1);
        const parentPath = parentSegments.join(DELIMITER);
        this._parentPathInfo = getPathInfo(parentPath);
        return this._parentPathInfo;
    }
}

const listIndexesByList = new WeakMap();
function getListIndexesByList(list) {
    return listIndexesByList.get(list) || null;
}
function setListIndexesByList(list, listIndexes) {
    if (listIndexes === null) {
        listIndexesByList.delete(list);
        return;
    }
    listIndexesByList.set(list, listIndexes);
}

let version = 0;
class ListIndex {
    uuid = getUUID();
    parentListIndex;
    position;
    length;
    _index;
    _version;
    _indexes;
    _listIndexes;
    /**
     * Creates a new ListIndex instance.
     *
     * @param parentListIndex - Parent list index for nested loops, or null for top-level
     * @param index - Current index value in the loop
     */
    constructor(parentListIndex, index) {
        this.parentListIndex = parentListIndex;
        this.position = parentListIndex ? parentListIndex.position + 1 : 0;
        this.length = this.position + 1;
        this._index = index;
        this._version = version;
    }
    /**
     * Gets current index value.
     *
     * @returns Current index number
     */
    get index() {
        return this._index;
    }
    /**
     * Sets index value and updates version.
     *
     * @param value - New index value
     */
    set index(value) {
        this._index = value;
        this._version = ++version;
        this.indexes[this.position] = value;
    }
    /**
     * Gets current version number for change detection.
     *
     * @returns Version number
     */
    get version() {
        return this._version;
    }
    /**
     * Checks if parent indexes have changed since last access.
     *
     * @returns true if parent has newer version, false otherwise
     */
    get dirty() {
        if (this.parentListIndex === null) {
            return false;
        }
        else {
            return this.parentListIndex.dirty || this.parentListIndex.version > this._version;
        }
    }
    /**
     * Gets array of all index values from root to current level.
     * Rebuilds array if parent indexes have changed (dirty).
     *
     * @returns Array of index values
     */
    get indexes() {
        if (this.parentListIndex === null) {
            if (typeof this._indexes === "undefined") {
                this._indexes = [this._index];
            }
        }
        else {
            if (typeof this._indexes === "undefined" || this.dirty) {
                this._indexes = [...this.parentListIndex.indexes, this._index];
                this._version = version;
            }
        }
        return this._indexes;
    }
    /**
     * Gets array of WeakRef to all ListIndex instances from root to current level.
     *
     * @returns Array of WeakRef<IListIndex>
     */
    get listIndexes() {
        if (this.parentListIndex === null) {
            if (typeof this._listIndexes === "undefined") {
                this._listIndexes = [new WeakRef(this)];
            }
        }
        else {
            if (typeof this._listIndexes === "undefined") {
                this._listIndexes = [...this.parentListIndex.listIndexes, new WeakRef(this)];
            }
        }
        return this._listIndexes;
    }
    /**
     * Gets variable name for this loop index ($1, $2, etc.).
     *
     * @returns Variable name string
     */
    get varName() {
        return `$${this.position + 1}`;
    }
    /**
     * Gets ListIndex at specified position in hierarchy.
     * Supports negative indexing from end.
     *
     * @param pos - Position index (0-based, negative for from end)
     * @returns ListIndex at position or null if not found/garbage collected
     */
    at(pos) {
        if (pos >= 0) {
            return this.listIndexes[pos]?.deref() || null;
        }
        else {
            return this.listIndexes[this.listIndexes.length + pos]?.deref() || null;
        }
    }
}
/**
 * Factory function to create ListIndex instance.
 *
 * @param parentListIndex - Parent list index for nested loops, or null for top-level
 * @param index - Current index value in the loop
 * @returns New IListIndex instance
 */
function createListIndex(parentListIndex, index) {
    return new ListIndex(parentListIndex, index);
}

function createListIndexes(list, parentListIndex) {
    const listIndexes = [];
    for (let i = 0; i < list.length; i++) {
        listIndexes.push(createListIndex(parentListIndex, i));
    }
    return listIndexes;
}

function applyChangeToAttribute(element, attrName, newValue) {
    if (element.getAttribute(attrName) !== newValue) {
        element.setAttribute(attrName, newValue);
    }
}

function applyChangeToClass(element, className, newValue) {
    if (typeof newValue !== "boolean") {
        raiseError(`Invalid value for class application: expected boolean, got ${typeof newValue}`);
    }
    element.classList.toggle(className, newValue);
}

function applyChangeToProperty(element, propName, newValue) {
    const currentValue = element[propName];
    if (currentValue !== newValue) {
        element[propName] = newValue;
    }
}

function applyChangeToStyle(node, styleName, newValue) {
    const style = node.style;
    const currentValue = style[styleName];
    if (currentValue !== newValue) {
        style[styleName] = newValue;
    }
}

function applyChangeToSubObject(element, propSegment, newValue) {
    const firstSegment = propSegment[0];
    let subObject = element[firstSegment];
    for (let i = 1; i < propSegment.length - 1; i++) {
        const segment = propSegment[i];
        if (subObject == null) {
            return;
        }
        subObject = subObject[segment];
    }
    const oldValue = subObject[propSegment[propSegment.length - 1]];
    if (oldValue !== newValue) {
        subObject[propSegment[propSegment.length - 1]] = newValue;
    }
}

function applyChangeToElement(element, propSegment, newValue) {
    if (propSegment.length === 0) {
        return;
    }
    const firstSegment = propSegment[0];
    if (firstSegment === "class") {
        applyChangeToClass(element, propSegment[1], newValue);
    }
    else if (firstSegment === "attr") {
        applyChangeToAttribute(element, propSegment[1], newValue);
    }
    else if (firstSegment === "style") {
        applyChangeToStyle(element, propSegment[1], newValue);
    }
    else {
        if (propSegment.length === 1) {
            applyChangeToProperty(element, firstSegment, newValue);
        }
        else {
            applyChangeToSubObject(element, propSegment, newValue);
        }
    }
    // const remainingSegments = propSegment.slice(1);
}

class Content {
    _content;
    _childNodeArray = [];
    _firstNode = null;
    _lastNode = null;
    constructor(content) {
        this._content = content;
        this._childNodeArray = Array.from(this._content.childNodes);
        this._firstNode = this._childNodeArray.length > 0 ? this._childNodeArray[0] : null;
        this._lastNode = this._childNodeArray.length > 0 ? this._childNodeArray[this._childNodeArray.length - 1] : null;
    }
    get firstNode() {
        return this._firstNode;
    }
    get lastNode() {
        return this._lastNode;
    }
    mountAfter(targetNode) {
        const parentNode = targetNode.parentNode;
        const nextSibling = targetNode.nextSibling;
        if (parentNode) {
            this._childNodeArray.forEach((node) => {
                parentNode.insertBefore(node, nextSibling);
            });
        }
    }
    unmount() {
        this._childNodeArray.forEach((node) => {
            if (node.parentNode) {
                node.parentNode.removeChild(node);
            }
        });
    }
}
function createContent(content) {
    return new Content(content);
}

const fragmentByUUID = new Map();
function getFragmentByUUID(uuid) {
    return fragmentByUUID.get(uuid) || null;
}
function setFragmentByUUID(uuid, fragment) {
    if (fragment === null) {
        fragmentByUUID.delete(uuid);
    }
    else {
        fragmentByUUID.set(uuid, fragment);
    }
}

const lastValueByNode = new WeakMap();
const lastContentsByNode = new WeakMap();
function applyChangeToFor(node, uuid, _newValue) {
    const fragment = getFragmentByUUID(uuid);
    if (!fragment) {
        raiseError(`Fragment with UUID "${uuid}" not found.`);
    }
    lastValueByNode.get(node) ?? [];
    const newValue = Array.isArray(_newValue) ? _newValue : [];
    const listIndexes = getListIndexesByList(newValue) || [];
    node.parentNode;
    node.nextSibling;
    const lastContents = lastContentsByNode.get(node) || [];
    for (const content of lastContents) {
        content.unmount();
    }
    const newContents = [];
    let lastNode = node;
    for (const index of listIndexes) {
        const cloneFragment = document.importNode(fragment, true);
        const content = createContent(cloneFragment);
        content.mountAfter(lastNode);
        lastNode = content.lastNode || lastNode;
    }
    lastContentsByNode.set(node, newContents);
    lastValueByNode.set(node, newValue);
}

function applyChangeToText(node, newValue) {
    if (node.nodeValue !== newValue) {
        node.nodeValue = newValue;
    }
}

function applyChange(bindingInfo, newValue) {
    if (bindingInfo.bindingType === "text") {
        applyChangeToText(bindingInfo.placeHolderNode, newValue);
    }
    else if (bindingInfo.bindingType === "prop") {
        applyChangeToElement(bindingInfo.node, bindingInfo.propSegments, newValue);
    }
    else if (bindingInfo.bindingType === "for") {
        if (!bindingInfo.uuid) {
            throw new Error(`BindingInfo for 'for' binding must have a UUID.`);
        }
        applyChangeToFor(bindingInfo.node, bindingInfo.uuid, newValue);
    }
}

class StateHandler {
    _bindingInfosByPath;
    _listPaths;
    constructor(bindingInfosByPath, listPaths) {
        this._bindingInfosByPath = bindingInfosByPath;
        this._listPaths = listPaths;
    }
    _getNestValue(target, pathInfo, receiver) {
        let curPathInfo = pathInfo;
        if (curPathInfo.path in target) {
            return Reflect.get(target, curPathInfo.path, receiver);
        }
        const parentPathInfo = curPathInfo.parentPathInfo;
        if (parentPathInfo === null) {
            return undefined;
        }
        const parent = this._getNestValue(target, parentPathInfo, receiver);
        const lastSegment = curPathInfo.segments[curPathInfo.segments.length - 1];
        if (lastSegment in parent) {
            return Reflect.get(parent, lastSegment);
        }
        else {
            console.warn(`[@wcstack/state] Property "${pathInfo.path}" does not exist on state.`);
            return undefined;
        }
    }
    get(target, prop, receiver) {
        let value;
        try {
            if (typeof prop === "string") {
                const pathInfo = getPathInfo(prop);
                if (pathInfo.segments.length > 1) {
                    return (value = this._getNestValue(target, pathInfo, receiver));
                }
            }
            if (prop in target) {
                return (value = Reflect.get(target, prop, receiver));
            }
            else {
                console.warn(`[@wcstack/state] Property "${String(prop)}" does not exist on state.`);
                return undefined;
            }
        }
        finally {
            if (typeof prop === "string") {
                if (this._listPaths.has(prop)) {
                    if (getListIndexesByList(value) === null) {
                        // ToDo: parentListIndexをスタックから取得するように修正する
                        const listIndexes = createListIndexes(value ?? [], null);
                        setListIndexesByList(value, listIndexes);
                    }
                }
            }
        }
    }
    set(target, prop, value, receiver) {
        let result = false;
        if (typeof prop === "string") {
            const pathInfo = getPathInfo(prop);
            if (pathInfo.segments.length > 1) {
                if (pathInfo.parentPathInfo === null) {
                    return false;
                }
                const parent = this._getNestValue(target, pathInfo.parentPathInfo, receiver);
                const lastSegment = pathInfo.segments[pathInfo.segments.length - 1];
                result = Reflect.set(parent, lastSegment, value);
            }
            else {
                result = Reflect.set(target, prop, value, receiver);
            }
            if (this._bindingInfosByPath.has(String(prop))) {
                const bindingInfos = this._bindingInfosByPath.get(String(prop)) || [];
                for (const bindingInfo of bindingInfos) {
                    applyChange(bindingInfo, value);
                }
            }
        }
        else {
            result = Reflect.set(target, prop, value, receiver);
        }
        if (typeof prop === "string") {
            if (this._listPaths.has(prop)) {
                // ToDo: parentListIndexをスタックから取得するように修正する
                const listIndexes = createListIndexes(value ?? [], null);
                setListIndexesByList(value, listIndexes);
            }
        }
        return result;
    }
}
function createStateProxy(state, bindingInfosByPath, listPaths) {
    return new Proxy(state, new StateHandler(bindingInfosByPath, listPaths));
}

const elementByUUID = new Map();
function setElementByUUID(uuid, element) {
    if (element === null) {
        elementByUUID.delete(uuid);
    }
    else {
        elementByUUID.set(uuid, element);
    }
}

const stateElementByName = new Map();
function getStateElementByName(name) {
    const result = stateElementByName.get(name) || null;
    if (result === null && name === 'default') {
        const state = document.querySelector(`${config.tagNames.state}:not([name])`);
        if (state instanceof State) {
            stateElementByName.set('default', state);
            return state;
        }
    }
    return result;
}
function setStateElementByName(name, element) {
    if (element === null) {
        stateElementByName.delete(name);
    }
    else {
        stateElementByName.set(name, element);
    }
}

class State extends HTMLElement {
    _uuid = getUUID();
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

function registerComponents() {
    // Register custom element
    if (!customElements.get(config.tagNames.state)) {
        customElements.define(config.tagNames.state, State);
    }
}

const STRUCTURAL_BINDING_TYPE_SET = new Set([
    "if",
    "elseif",
    "else",
    "for",
]);

const trimFn = (s) => s.trim();

// format: propName#moodifier1,modifier2
// propName-format: path.to.property (e.g., textContent, style.color, not include :)
// special path: 
//   'attr.attributeName' for attributes (e.g., attr.href, attr.data-id)
//   'style.propertyName' for style properties (e.g., style.backgroundColor, style.fontSize)
//   'class.className' for class names (e.g., class.active, class.hidden)
//   'onclick', 'onchange' etc. for event listeners
function parsePropPart(propPart) {
    const [propName, propModifiersText] = propPart.split('#').map(trimFn);
    const propSegments = propName.split('.').map(trimFn);
    const propModifiers = propModifiersText
        ? propModifiersText.split(',').map(trimFn)
        : [];
    return {
        propName,
        propSegments,
        propModifiers,
    };
}

// format: statePath@stateName|filter|filter
// statePath-format: path.to.property (e.g., user.name.first, users.*.name, users.0.name, not include @)
// stateName: optional, default is 'default'
// filters-format: filterName or filterName(arg1,arg2)
function parseStatePart(statePart) {
    const [stateAndPath, ...filterTexts] = statePart.split('|').map(trimFn);
    const [statePathName, stateName = 'default'] = stateAndPath.split('@').map(trimFn);
    return {
        stateName,
        statePathName,
        statePathInfo: getPathInfo(statePathName),
        filterTexts,
    };
}

// format: propPart:statePart; propPart:statePart; ...
// special-propPart:
//   if: statePart (single binding for conditional rendering)
//   else: (single binding for conditional rendering, and statePart is ignored)
//   elseif: statePart only (single binding for conditional rendering)
//   for: statePart only (single binding for loop rendering)
//   onclick: statePart, onchange: statePart etc. (event listeners)
function parseBindTextsForElement(bindText) {
    const [...bindTexts] = bindText.split(';').map(trimFn).filter(s => s.length > 0);
    const results = bindTexts.map((bindText) => {
        const separatorIndex = bindText.indexOf(':');
        if (separatorIndex === -1) {
            raiseError(`Invalid bindText: "${bindText}". Missing ':' separator between propPart and statePart.`);
        }
        const propPart = bindText.slice(0, separatorIndex).trim();
        const statePart = bindText.slice(separatorIndex + 1).trim();
        if (propPart === 'else') {
            return {
                propName: 'else',
                propSegments: ['else'],
                propModifiers: [],
                statePathName: '',
                statePathInfo: null,
                stateName: '',
                filterTexts: [],
                bindingType: 'else',
            };
        }
        else if (propPart === 'if' || propPart === 'elseif' || propPart === 'for') {
            const stateResult = parseStatePart(statePart);
            return {
                propName: propPart,
                propSegments: [propPart],
                propModifiers: [],
                ...stateResult,
                bindingType: propPart,
            };
        }
        else {
            const stateResult = parseStatePart(statePart);
            const propResult = parsePropPart(propPart);
            if (propResult.propSegments[0].startsWith('on')) {
                return {
                    ...propResult,
                    ...stateResult,
                    bindingType: 'event',
                };
            }
            else {
                return {
                    ...propResult,
                    ...stateResult,
                    bindingType: 'prop',
                };
            }
        }
    });
    // check for sigle binding for 'if', 'elseif', 'else', 'for'
    if (results.length > 1) {
        const isIncludeSingleBinding = results.some(r => STRUCTURAL_BINDING_TYPE_SET.has(r.bindingType));
        if (isIncludeSingleBinding) {
            raiseError(`Invalid bindText: "${bindText}". 'if', 'elseif', 'else', and 'for' bindings must be single binding.`);
        }
    }
    return results;
}

const bindTextByNode = new WeakMap();
// format: <!--@@wcs-text:path-->
// bind-stateはconfig.commentTextPrefixで変更可能
// format: <!--@@wcs-for:UUID-->
// bind-stateはconfig.commentForPrefixで変更可能
// format: <!--@@wcs-if:UUID-->
// bind-stateはconfig.commentIfPrefixで変更可能
// format: <!--@@wcs-else:UUID-->
// bind-stateはconfig.commentElsePrefixで変更可能
// format: <!--@@wcs-elseif:UUID-->
// bind-stateはconfig.commentElseIfPrefixで変更可能
const bindingTypeKeywordSet = new Set([
    config.commentTextPrefix,
    config.commentForPrefix,
    config.commentIfPrefix,
    config.commentElseIfPrefix,
    config.commentElsePrefix,
]);
const EMBEDDED_REGEX = new RegExp(`^\\s*@@\\s*(.+?)\\s*:\\s*(.+?)\\s*$`);
function isCommentNode(node) {
    if (node.nodeType !== Node.COMMENT_NODE) {
        return false;
    }
    const commentNode = node;
    const text = commentNode.data.trim();
    const match = EMBEDDED_REGEX.exec(text);
    if (match === null) {
        return false;
    }
    if (!bindingTypeKeywordSet.has(match[1])) {
        return false;
    }
    bindTextByNode.set(node, match[2]);
    return true;
}
function getCommentNodeBindText(node) {
    return bindTextByNode.get(node) || null;
}

function parseBindTextForEmbeddedNode(bindText) {
    const stateResult = parseStatePart(bindText);
    return {
        propName: 'textContent',
        propSegments: ['textContent'],
        propModifiers: [],
        ...stateResult,
        bindingType: 'text',
    };
}

const parseBindTextResultByUUID = new Map();
function getParseBindTextResultByUUID(uuid) {
    return parseBindTextResultByUUID.get(uuid) || null;
}
function setParseBindTextResultByUUID(uuid, parseBindTextResult) {
    if (parseBindTextResult === null) {
        parseBindTextResultByUUID.delete(uuid);
    }
    else {
        parseBindTextResultByUUID.set(uuid, parseBindTextResult);
    }
}

function getBindingInfos(node) {
    const bindingInfos = [];
    if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node;
        const bindText = element.getAttribute(config.bindAttributeName) || '';
        const bindingInfosFromElement = parseBindTextsForElement(bindText);
        for (const bindingInfo of bindingInfosFromElement) {
            bindingInfos.push({
                ...bindingInfo,
                node: node,
                placeHolderNode: element,
                uuid: null,
            });
        }
    }
    else if (node.nodeType === Node.COMMENT_NODE) {
        const bindTextOrUUID = getCommentNodeBindText(node);
        if (bindTextOrUUID === null) {
            raiseError(`Comment node binding text not found.`);
        }
        let parseBindingTextResult = getParseBindTextResultByUUID(bindTextOrUUID);
        let uuid = null;
        if (parseBindingTextResult === null) {
            // It is not a structural fragment UUID, so treat it as bindText
            parseBindingTextResult = parseBindTextForEmbeddedNode(bindTextOrUUID);
            uuid = null;
        }
        else {
            uuid = bindTextOrUUID;
        }
        let placeHolderNode = node;
        if (parseBindingTextResult.bindingType === "text") {
            placeHolderNode = document.createTextNode('');
        }
        bindingInfos.push({
            ...parseBindingTextResult,
            node: node,
            placeHolderNode: placeHolderNode,
            uuid: uuid,
        });
    }
    return bindingInfos;
}

/**
 * data-bind-state 属性または埋め込みノード<!--{{}}-->を持つノードをすべて取得する
 * @param root
 * @returns
 */
function getSubscriberNodes(root) {
    const subscriberNodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT, {
        acceptNode(node) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                const element = node;
                const hasBinding = element.hasAttribute(config.bindAttributeName);
                return hasBinding
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_SKIP;
            }
            else {
                // Comment node
                return isCommentNode(node)
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_SKIP;
            }
        }
    });
    while (walker.nextNode()) {
        subscriberNodes.push(walker.currentNode);
    }
    return subscriberNodes;
}

const CHECK_TYPES = new Set(['radio', 'checkbox']);
const DEFAULT_VALUE_PROP_NAMES = new Set(['value', 'valueAsNumber', 'valueAsDate']);
function isPossibleTwoWay(node, propName) {
    if (node.nodeType !== Node.ELEMENT_NODE) {
        return false;
    }
    const element = node;
    const tagName = element.tagName.toLowerCase();
    if (tagName === 'input') {
        const inputType = (element.getAttribute('type') || 'text').toLowerCase();
        if (inputType === 'button') {
            return false;
        }
        if (CHECK_TYPES.has(inputType) && propName === 'checked') {
            return true;
        }
        if (DEFAULT_VALUE_PROP_NAMES.has(propName)) {
            return true;
        }
    }
    if (tagName === 'select' && propName === 'value') {
        return true;
    }
    if (tagName === 'textarea' && propName === 'value') {
        return true;
    }
    return false;
}

const listIndexByNode = new WeakMap();
function setListIndexByNode(node, listIndex) {
    {
        listIndexByNode.delete(node);
        return;
    }
}

function replaceToComment(bindingInfo) {
    const node = bindingInfo.node;
    const placeHolderNode = bindingInfo.placeHolderNode;
    if (node === placeHolderNode) {
        return;
    }
    if (node.parentNode === null) {
        // already replaced
        return;
    }
    node.parentNode.replaceChild(placeHolderNode, node);
}

const registeredNodeSet = new WeakSet();
async function initializeBindings(root, parentListIndex) {
    const subscriberNodes = getSubscriberNodes(root);
    const allBindings = [];
    subscriberNodes.forEach(node => {
        if (!registeredNodeSet.has(node)) {
            registeredNodeSet.add(node);
            setListIndexByNode(node);
            const bindings = getBindingInfos(node);
            allBindings.push(...bindings);
        }
    });
    const applyInfoList = [];
    const cacheValueByPathByStateElement = new Map();
    for (const bindingInfo of allBindings) {
        const stateElement = getStateElementByName(bindingInfo.stateName);
        if (stateElement === null) {
            raiseError(`State element with name "${bindingInfo.stateName}" not found for binding.`);
        }
        // replace to comment node
        replaceToComment(bindingInfo);
        // event
        if (bindingInfo.propName.startsWith("on")) {
            const eventName = bindingInfo.propName.slice(2);
            bindingInfo.node.addEventListener(eventName, (event) => {
                const handler = stateElement.state[bindingInfo.statePathName];
                if (typeof handler === "function") {
                    handler.call(stateElement.state, event);
                }
            });
            continue;
        }
        // two-way binding
        if (isPossibleTwoWay(bindingInfo.node, bindingInfo.propName) && bindingInfo.propModifiers.indexOf('ro') === -1) {
            const tagName = bindingInfo.node.tagName.toLowerCase();
            let eventName = (tagName === 'select') ? 'change' : 'input';
            for (const modifier of bindingInfo.propModifiers) {
                if (modifier.startsWith('on')) {
                    eventName = modifier.slice(2);
                }
            }
            bindingInfo.node.addEventListener(eventName, (event) => {
                const target = event.target;
                if (typeof target === "undefined") {
                    console.warn(`[@wcstack/state] event.target is undefined.`);
                    return;
                }
                if (!(bindingInfo.propName in target)) {
                    console.warn(`[@wcstack/state] Property "${bindingInfo.propName}" does not exist on target element.`);
                    return;
                }
                const newValue = target[bindingInfo.propName];
                stateElement.state[bindingInfo.statePathName] = newValue;
            });
        }
        // register binding
        stateElement.addBindingInfo(bindingInfo);
        // get cache value
        let cacheValueByPath = cacheValueByPathByStateElement.get(stateElement);
        if (typeof cacheValueByPath === "undefined") {
            cacheValueByPath = new Map();
            cacheValueByPathByStateElement.set(stateElement, cacheValueByPath);
        }
        const cacheValue = cacheValueByPath.get(bindingInfo.statePathName);
        if (typeof cacheValue !== "undefined") {
            // apply cached value
            applyInfoList.push({ bindingInfo, value: cacheValue });
            continue;
        }
        // apply initial value
        await stateElement.initializePromise;
        const value = stateElement.state[bindingInfo.statePathName];
        applyInfoList.push({ bindingInfo, value });
        // set cache value
        cacheValueByPath.set(bindingInfo.statePathName, value);
    }
    // apply all at once
    for (const applyInfo of applyInfoList) {
        applyChange(applyInfo.bindingInfo, applyInfo.value);
    }
}

const keywordByBindingType = new Map([
    ["for", config.commentForPrefix],
    ["if", config.commentIfPrefix],
    ["elseif", config.commentElseIfPrefix],
    ["else", config.commentElsePrefix],
]);
function collectStructuralFragments(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
        acceptNode(node) {
            const element = node;
            if (element instanceof HTMLTemplateElement) {
                const bindText = element.getAttribute(config.bindAttributeName) || '';
                if (bindText.length > 0) {
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
            return NodeFilter.FILTER_SKIP;
        }
    });
    while (walker.nextNode()) {
        const template = walker.currentNode;
        const bindText = template.getAttribute(config.bindAttributeName) || '';
        const parseBindTextResults = parseBindTextsForElement(bindText);
        const parseBindTextResult = parseBindTextResults[0];
        const fragment = template.content;
        const uuid = getUUID();
        setFragmentByUUID(uuid, fragment);
        setParseBindTextResultByUUID(uuid, parseBindTextResult);
        const keyword = keywordByBindingType.get(parseBindTextResult.bindingType);
        if (typeof keyword === 'undefined') {
            continue;
        }
        const placeHolder = document.createComment(`@@${keyword}:${uuid}`);
        template.replaceWith(placeHolder);
        collectStructuralFragments(fragment);
    }
}

function registerHandler() {
    document.addEventListener("DOMContentLoaded", async () => {
        collectStructuralFragments(document);
        await initializeBindings(document.body);
    });
}

function bootstrapState() {
    registerComponents();
    registerHandler();
}

export { bootstrapState };
//# sourceMappingURL=index.esm.js.map
