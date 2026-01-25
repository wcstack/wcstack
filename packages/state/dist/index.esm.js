const config = {
    bindAttributeName: 'data-bind-state',
    tagNames: {
        state: 'wcs-state',
        loop: 'wcs-loop',
    },
};

function findStateElement(rootElement, stateName) {
    const retElement = rootElement.querySelector(`${config.tagNames.state}[name="${stateName}"]`);
    return retElement;
}

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

class LoopContent {
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
function createLoopContent(content) {
    return new LoopContent(content);
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
        this.wildcardPathInfos = this.wildcardPaths.map(p => getPathInfo(p));
        this.wildcardParentPathInfos = this.wildcardParentPaths.map(p => getPathInfo(p));
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

function raiseError(message) {
    throw new Error(`[@wcstack/state] ${message}`);
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

function applyChangeToNode(node, propSegments, newValue) {
    if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node;
        if (propSegments.length === 1) {
            const propName = propSegments[0];
            element[propName] = newValue;
        }
        else {
            const typeKey = propSegments[0];
            if (typeKey === 'style') {
                const htmlElement = element;
                const stylePropName = propSegments[1];
                htmlElement.style[stylePropName] = newValue;
            }
            else if (typeKey === 'attr') {
                const attrName = propSegments[1];
                if (newValue === null || typeof newValue === "undefined") {
                    element.removeAttribute(attrName);
                }
                else {
                    element.setAttribute(attrName, String(newValue));
                }
            }
            else {
                const subObject = element[typeKey];
                if (typeof subObject === "object" && subObject !== null) {
                    const subPropName = propSegments[1];
                    subObject[subPropName] = newValue;
                }
            }
        }
    }
    else if (node.nodeType === Node.TEXT_NODE) {
        const textNode = node;
        textNode.textContent = String(newValue);
    }
}

const commentKey = `${config.bindAttributeName.replace(/^data-/, '')}:`;
function getBindingInfos(node) {
    const bindingInfos = [];
    const cacheState = new Map();
    const removeComments = [];
    if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node;
        const tagName = element.tagName.toLowerCase();
        if (tagName === config.tagNames.loop) {
            const loopElement = element;
            bindingInfos.push(loopElement.bindingInfo);
        }
        else {
            const bindAttributeText = element.getAttribute(config.bindAttributeName) || '';
            const bindTexts = bindAttributeText.split(';').map(s => s.trim()).filter(s => s.length > 0);
            for (const bindText of bindTexts) {
                const [propText, stateText] = bindText.split(':').map(s => s.trim());
                const [propName, modifierText] = (propText ?? '').split('#').map(s => s.trim());
                const modifiers = modifierText ? modifierText.split(',').map(s => s.trim()) : [];
                const propSegments = (propName ?? '').split('.').map(s => s.trim());
                const [statePathNameAndStateName, ...filterTexts] = (stateText ?? propSegments.at(-1) ?? '').split('|').map(s => s.trim());
                const statePathNameParts = statePathNameAndStateName.split('@').map(s => s.trim());
                const statePathName = statePathNameParts[0] || '';
                const stateName = statePathNameParts[1] || 'default';
                const statePathInfo = getPathInfo(statePathName);
                let stateElement = cacheState.get(stateName) ?? null;
                if (stateElement === null) {
                    stateElement = findStateElement(document, stateName);
                    if (stateElement !== null) {
                        cacheState.set(stateName, stateElement);
                    }
                }
                if (stateElement === null) {
                    raiseError(`State element with name "${stateName}" not found for binding "${bindText}".`);
                }
                if (propName === '' || statePathName === '') {
                    raiseError(`Invalid binding syntax: "${bindText}".`);
                }
                const bindingInfo = {
                    propName: propName || '',
                    propSegments: propSegments,
                    propModifiers: modifiers,
                    statePathName: statePathName,
                    statePathInfo: statePathInfo,
                    stateName: stateName,
                    stateElement,
                    filterTexts: filterTexts,
                    node: element,
                };
                bindingInfos.push(bindingInfo);
            }
        }
    }
    else if (node.nodeType === Node.COMMENT_NODE) {
        const commentNode = node;
        const text = commentNode.data.trim();
        const match = RegExp(`^{{\\s*${commentKey}\\s*(.+?)\\s*}}$`).exec(text);
        if (match !== null) {
            const stateText = match[1];
            const [statePathNameAndStateName, ...filterTexts] = (stateText ?? '').split('|').map(s => s.trim());
            const statePathNameParts = statePathNameAndStateName.split('@').map(s => s.trim());
            const statePathName = statePathNameParts[0] || '';
            const stateName = statePathNameParts[1] || 'default';
            const statePathInfo = getPathInfo(statePathName);
            let stateElement = cacheState.get(stateName) ?? null;
            if (stateElement === null) {
                stateElement = findStateElement(document, stateName);
                if (stateElement !== null) {
                    cacheState.set(stateName, stateElement);
                }
            }
            if (stateElement === null) {
                raiseError(`State element with name "${stateName}" not found for binding "${stateText}".`);
            }
            if (statePathName === '') {
                raiseError(`Invalid binding syntax: "${stateText}".`);
            }
            const textNode = document.createTextNode('');
            const parentNode = commentNode.parentNode;
            const nextSibling = commentNode.nextSibling;
            if (parentNode === null) {
                raiseError(`Comment node has no parent node.`);
            }
            parentNode.insertBefore(textNode, nextSibling);
            removeComments.push(commentNode);
            const bindingInfo = {
                propName: 'textContent',
                propSegments: ['textContent'],
                propModifiers: [],
                statePathName: statePathName,
                statePathInfo: statePathInfo,
                stateName: stateName,
                stateElement,
                filterTexts: filterTexts,
                node: textNode,
            };
            bindingInfos.push(bindingInfo);
        }
    }
    for (const commentNode of removeComments) {
        commentNode.remove();
    }
    return bindingInfos;
}

// format: <!--{{ bind-state:path }}-->
// bind-stateはconfig.bindAttributeNameで変更可能
const keyword = config.bindAttributeName.replace(/^data-/, '');
function isEmbeddedNode(node) {
    if (node.nodeType !== Node.COMMENT_NODE) {
        return false;
    }
    const commentNode = node;
    const text = commentNode.data.trim();
    const match = RegExp(`^{{\\s*${keyword}:(.+?)\\s*}}$`).exec(text);
    if (match === null) {
        return false;
    }
    return true;
}

function getSubscriberNodes(root) {
    const subscriberNodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL, 
    //    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT |, 
    {
        acceptNode(node) {
            console.log('node:', node);
            if (node.nodeType === Node.ELEMENT_NODE) {
                const element = node;
                const hasBinding = element.hasAttribute(config.bindAttributeName);
                return hasBinding
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_SKIP;
            }
            else {
                // Comment node
                return isEmbeddedNode(node)
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
    if (listIndex === null) {
        listIndexByNode.delete(node);
        return;
    }
    listIndexByNode.set(node, listIndex);
}

const registeredNodeSet = new WeakSet();
async function initializeBindings(root, parentListIndex) {
    const subscriberNodes = getSubscriberNodes(root);
    const allBindings = [];
    subscriberNodes.forEach(node => {
        if (!registeredNodeSet.has(node)) {
            registeredNodeSet.add(node);
            setListIndexByNode(node, parentListIndex);
            const bindings = getBindingInfos(node);
            allBindings.push(...bindings);
        }
    });
    const applyInfoList = [];
    const cacheValueByPathByStateElement = new Map();
    for (const bindingInfo of allBindings) {
        const stateElement = bindingInfo.stateElement;
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
                bindingInfo.stateElement.state[bindingInfo.statePathName] = newValue;
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
        applyChangeToNode(applyInfo.bindingInfo.node, applyInfo.bindingInfo.propSegments, applyInfo.value);
    }
}

class Loop extends HTMLElement {
    _uuid = getUUID();
    _path = '';
    _stateElement = null;
    _placeHolder = document.createComment(`@@loop:${this._uuid}`);
    _initializePromise;
    _resolveInitialize = null;
    _initialized = false;
    _loopContent = null;
    _loopContents = [];
    _loopValue = null;
    _bindingInfo = null;
    constructor() {
        super();
        this._initializePromise = new Promise((resolve) => {
            this._resolveInitialize = resolve;
        });
    }
    get uuid() {
        return this._uuid;
    }
    get path() {
        return this._path;
    }
    get stateElement() {
        if (this._stateElement === null) {
            raiseError(`Loop stateElement is not set.`);
        }
        return this._stateElement;
    }
    get loopContent() {
        if (this._loopContent === null) {
            raiseError(`Loop content is not initialized.`);
        }
        return this._loopContent;
    }
    get bindingInfo() {
        if (this._bindingInfo === null) {
            raiseError(`Loop bindingInfo is not set.`);
        }
        return this._bindingInfo;
    }
    get initializePromise() {
        return this._initializePromise;
    }
    initialize() {
        const template = this.querySelector('template');
        if (!template) {
            raiseError(`${config.tagNames.loop} requires a <template> child element.`);
        }
        this._loopContent = template.content;
        const bindText = this.getAttribute(config.bindAttributeName) || '';
        const [statePathName, stateTempName] = bindText.split('@').map(s => s.trim());
        if (statePathName === '') {
            raiseError(`Invalid loop binding syntax: "${bindText}".`);
        }
        const stateName = stateTempName ?? 'default';
        const statePathInfo = getPathInfo(statePathName);
        const stateElement = findStateElement(document, stateName);
        if (stateElement === null) {
            raiseError(`State element with name "${stateName}" not found for loop binding "${bindText}".`);
        }
        this._bindingInfo = {
            propName: 'loopValue',
            propSegments: ['loopValue'],
            propModifiers: [],
            statePathName,
            statePathInfo,
            stateName,
            stateElement,
            filterTexts: [],
            node: this,
        };
        stateElement.listPaths.add(statePathName);
    }
    async connectedCallback() {
        this.replaceWith(this._placeHolder);
        if (!this._initialized) {
            this.initialize();
            this._resolveInitialize?.();
            this._initialized = true;
        }
    }
    get loopValue() {
        return this._loopValue;
    }
    set loopValue(value) {
        this.render(value, this._loopValue);
        this._loopValue = value;
    }
    render(newValue, oldValue) {
        if (!Array.isArray(newValue)) {
            for (let content of this._loopContents) {
                content.unmount();
            }
        }
        else {
            const parentNode = this._placeHolder.parentNode;
            if (parentNode === null) {
                raiseError(`Loop placeholder has no parent node.`);
            }
            // Remove old contents
            for (let content of this._loopContents) {
                content.unmount();
            }
            this._loopContents = [];
            const listIndexes = getListIndexesByList(newValue);
            if (listIndexes === null) {
                raiseError(`List indexes not found for loop value.`);
            }
            // Create new contents
            let lastNode = this._placeHolder;
            for (let i = 0; i < newValue.length; i++) {
                const listIndex = listIndexes[i];
                const content = document.importNode(this.loopContent, true);
                initializeBindings(content, listIndex);
                const loopContent = createLoopContent(content);
                loopContent.mountAfter(lastNode);
                this._loopContents.push(loopContent);
                lastNode = loopContent.lastNode || lastNode;
            }
        }
    }
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
            return Reflect.get(parent, lastSegment, receiver);
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
                result = Reflect.set(parent, lastSegment, value, receiver);
            }
            else {
                result = Reflect.set(target, prop, value, receiver);
            }
            if (this._bindingInfosByPath.has(String(prop))) {
                const bindingInfos = this._bindingInfosByPath.get(String(prop)) || [];
                for (const bindingInfo of bindingInfos) {
                    applyChangeToNode(bindingInfo.node, bindingInfo.propSegments, value);
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
    constructor() {
        super();
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
    async _initialize() {
        const name = this.getAttribute('name');
        if (name === null) {
            this._name = 'default';
            this.setAttribute('name', this._name);
        }
        else {
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

function registerComponents() {
    // Register custom element
    if (!customElements.get(config.tagNames.state)) {
        customElements.define(config.tagNames.state, State);
    }
    if (!customElements.get(config.tagNames.loop)) {
        customElements.define(config.tagNames.loop, Loop);
    }
}

function registerHandler() {
    document.addEventListener("DOMContentLoaded", async () => {
        await initializeBindings(document.body, null);
    });
}

function bootstrapState() {
    registerComponents();
    registerHandler();
}

export { bootstrapState };
//# sourceMappingURL=index.esm.js.map
