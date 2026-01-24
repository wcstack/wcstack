const _config = {
    tagNames: {
        route: "wcs-route",
        router: "wcs-router",
        outlet: "wcs-outlet",
        layout: "wcs-layout",
        layoutOutlet: "wcs-layout-outlet",
        link: "wcs-link",
        head: "wcs-head"
    },
    enableShadowRoot: false,
    basenameFileExtensions: [".html"]
};
// 後方互換のため config もエクスポート（読み取り専用として使用）
const config = _config;
function setConfig(partialConfig) {
    if (partialConfig.tagNames) {
        Object.assign(_config.tagNames, partialConfig.tagNames);
    }
    if (typeof partialConfig.enableShadowRoot === "boolean") {
        _config.enableShadowRoot = partialConfig.enableShadowRoot;
    }
    if (Array.isArray(partialConfig.basenameFileExtensions)) {
        _config.basenameFileExtensions = partialConfig.basenameFileExtensions;
    }
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

function raiseError(message) {
    throw new Error(`[@wcstack/router] ${message}`);
}

class GuardCancel extends Error {
    fallbackPath;
    constructor(message, fallbackPath) {
        super(message);
        this.fallbackPath = fallbackPath;
    }
}

const builtinParamTypes = {
    "int": {
        typeName: "int",
        pattern: /^-?\d+$/,
        parse(value) {
            if (!this.pattern.test(value)) {
                return undefined;
            }
            return parseInt(value, 10);
        }
    },
    "float": {
        typeName: "float",
        pattern: /^-?\d+(?:\.\d+)?$/,
        parse(value) {
            if (!this.pattern.test(value)) {
                return undefined;
            }
            return parseFloat(value);
        }
    },
    "bool": {
        typeName: "bool",
        pattern: /^(true|false|0|1)$/,
        parse(value) {
            if (!this.pattern.test(value)) {
                return undefined;
            }
            return value === "true" || value === "1";
        }
    },
    "uuid": {
        typeName: "uuid",
        pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        parse(value) {
            if (!this.pattern.test(value)) {
                return undefined;
            }
            return value;
        }
    },
    "slug": {
        typeName: "slug",
        pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        parse(value) {
            if (!this.pattern.test(value)) {
                return undefined;
            }
            return value;
        }
    },
    "isoDate": {
        typeName: "isoDate",
        pattern: /^\d{4}-\d{2}-\d{2}$/,
        parse(value) {
            if (!this.pattern.test(value)) {
                return undefined;
            }
            const [year, month, day] = value.split("-").map(Number);
            const date = new Date(year, month - 1, day);
            // 元の値と一致するか確認（補正されていないか）
            if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
                return undefined;
            }
            return date;
        }
    },
    "any": {
        typeName: "any",
        pattern: /^.+$/,
        parse(value) {
            if (!this.pattern.test(value)) {
                return undefined;
            }
            return value;
        }
    },
};

const weights = {
    'static': 2,
    'param': 1,
    'catch-all': 0
};
class Route extends HTMLElement {
    _name = '';
    _path = '';
    _routeParentNode = null;
    _routeChildNodes = [];
    _routerNode = null;
    _uuid = getUUID();
    _placeHolder = document.createComment(`@@route:${this._uuid}`);
    _childNodeArray;
    _paramNames;
    _absoluteParamNames;
    _params = {};
    _typedParams = {};
    _weight;
    _absoluteWeight;
    _childIndex = 0;
    _hasGuard = false;
    _guardHandler = null;
    _waitForSetGuardHandler = null;
    _resolveSetGuardHandler = null;
    _guardFallbackPath = '';
    _initialized = false;
    _isFallbackRoute = false;
    _segmentCount;
    _segmentInfos = [];
    _absoluteSegmentInfos;
    constructor() {
        super();
    }
    get routeParentNode() {
        return this._routeParentNode;
    }
    get routeChildNodes() {
        return this._routeChildNodes;
    }
    get routerNode() {
        if (!this._routerNode) {
            raiseError(`${config.tagNames.route} has no routerNode.`);
        }
        return this._routerNode;
    }
    get path() {
        return this._path;
    }
    get isRelative() {
        return !this._path.startsWith('/');
    }
    _checkParentNode(hasParentCallback, noParentCallback) {
        // fallbackはルーター直下のみ許可されるため、相対パスチェックはスキップ
        if (!this._isFallbackRoute) {
            if (this.isRelative && !this._routeParentNode) {
                raiseError(`${config.tagNames.route} is relative but has no parent route.`);
            }
            if (!this.isRelative && this._routeParentNode) {
                raiseError(`${config.tagNames.route} is absolute but has a parent route.`);
            }
        }
        if (this.isRelative && this._routeParentNode) {
            return hasParentCallback(this._routeParentNode);
        }
        else {
            return noParentCallback();
        }
    }
    get absolutePath() {
        return this._checkParentNode((routeParentNode) => {
            const parentPath = routeParentNode.absolutePath;
            return parentPath.endsWith('/')
                ? parentPath + this._path
                : parentPath + '/' + this._path;
        }, () => {
            return this._path;
        });
    }
    get uuid() {
        return this._uuid;
    }
    get placeHolder() {
        return this._placeHolder;
    }
    get childNodeArray() {
        if (typeof this._childNodeArray === 'undefined') {
            this._childNodeArray = Array.from(this.childNodes);
        }
        return this._childNodeArray;
    }
    get routes() {
        if (this.routeParentNode) {
            return this.routeParentNode.routes.concat(this);
        }
        else {
            return [this];
        }
    }
    get segmentInfos() {
        return this._segmentInfos;
    }
    // indexの場合、{ type: 'static', segmentText: '' }となる、indexが複数連続する場合もある
    get absoluteSegmentInfos() {
        if (typeof this._absoluteSegmentInfos === 'undefined') {
            this._absoluteSegmentInfos = this._checkParentNode((routeParentNode) => {
                return [
                    ...routeParentNode.absoluteSegmentInfos,
                    ...this._segmentInfos
                ];
            }, () => {
                return [...this._segmentInfos];
            });
        }
        return this._absoluteSegmentInfos;
    }
    get params() {
        return this._params;
    }
    get typedParams() {
        return this._typedParams;
    }
    get paramNames() {
        if (typeof this._paramNames === 'undefined') {
            const names = [];
            for (const info of this._segmentInfos) {
                if (info.paramName) {
                    names.push(info.paramName);
                }
            }
            this._paramNames = names;
        }
        return this._paramNames;
    }
    get absoluteParamNames() {
        if (typeof this._absoluteParamNames === 'undefined') {
            this._absoluteParamNames = this._checkParentNode((routeParentNode) => {
                return [
                    ...routeParentNode.absoluteParamNames,
                    ...this.paramNames
                ];
            }, () => {
                return [...this.paramNames];
            });
        }
        return this._absoluteParamNames;
    }
    get weight() {
        if (typeof this._weight === 'undefined') {
            let weight = 0;
            for (const info of this._segmentInfos) {
                weight += weights[info.type];
            }
            this._weight = weight;
        }
        return this._weight;
    }
    get absoluteWeight() {
        if (typeof this._absoluteWeight === 'undefined') {
            this._absoluteWeight = this._checkParentNode((routeParentNode) => {
                return routeParentNode.absoluteWeight + this.weight;
            }, () => {
                return this.weight;
            });
        }
        return this._absoluteWeight;
    }
    get childIndex() {
        return this._childIndex;
    }
    get name() {
        return this._name;
    }
    async guardCheck(matchResult) {
        if (this._hasGuard && this._waitForSetGuardHandler) {
            await this._waitForSetGuardHandler;
        }
        if (this._guardHandler) {
            const toPath = matchResult.path;
            const fromPath = matchResult.lastPath;
            const allowed = await this._guardHandler(toPath, fromPath);
            if (!allowed) {
                throw new GuardCancel('Navigation cancelled by guard.', this._guardFallbackPath);
            }
        }
    }
    shouldChange(newParams) {
        for (const key of this.paramNames) {
            if (this.params[key] !== newParams[key]) {
                return true;
            }
        }
        return false;
    }
    get guardHandler() {
        if (!this._guardHandler) {
            raiseError(`${config.tagNames.route} has no guardHandler.`);
        }
        return this._guardHandler;
    }
    set guardHandler(value) {
        this._resolveSetGuardHandler?.();
        this._guardHandler = value;
    }
    initialize(routerNode, routeParentNode) {
        if (this._initialized) {
            return;
        }
        this._initialized = true;
        // 単独で影響のないものから設定していく
        if (this.hasAttribute('path')) {
            this._path = this.getAttribute('path') || '';
        }
        else if (this.hasAttribute('index')) {
            this._path = '';
        }
        else if (this.hasAttribute('fallback')) {
            this._path = '';
            this._isFallbackRoute = true;
        }
        else {
            raiseError(`${config.tagNames.route} should have a "path" or "index" attribute.`);
        }
        this._name = this.getAttribute('name') || '';
        this._routerNode = routerNode;
        this._routeParentNode = routeParentNode;
        const routeChildContainer = routeParentNode || routerNode;
        routeChildContainer.routeChildNodes.push(this);
        this._childIndex = routeChildContainer.routeChildNodes.length - 1;
        if (this._isFallbackRoute) {
            if (routeParentNode) {
                raiseError(`${config.tagNames.route} with fallback attribute must be a direct child of ${config.tagNames.router}.`);
            }
            if (routerNode.fallbackRoute) {
                raiseError(`${config.tagNames.router} can have only one fallback route.`);
            }
            routerNode.fallbackRoute = this;
        }
        // index属性の場合は特別扱い（セグメントを消費しない）
        if (this.hasAttribute('index')) {
            this._segmentInfos.push({
                type: 'static',
                segmentText: '',
                paramName: null,
                pattern: /^$/,
                isIndex: true
            });
        }
        const segments = this._path.split('/');
        for (let idx = 0; idx < segments.length; idx++) {
            const segment = segments[idx];
            // 末尾の空セグメントはスキップ（/parent/ のような場合）
            if (segment === '' && idx === segments.length - 1 && idx > 0) {
                continue;
            }
            if (segment === '*') {
                this._segmentInfos.push({
                    type: 'catch-all',
                    segmentText: segment,
                    paramName: '*',
                    pattern: new RegExp('^(.*)$')
                });
                // Catch-all: matches remaining path segments
                break; // Ignore subsequent segments
            }
            else if (segment.startsWith(':')) {
                const matchType = segment.match(/^:([^()]+)(\(([^)]+)\))?$/);
                let paramName;
                let typeName = 'any';
                if (matchType) {
                    paramName = matchType[1];
                    if (matchType[3] && Object.keys(builtinParamTypes).includes(matchType[3])) {
                        typeName = matchType[3];
                    }
                }
                else {
                    paramName = segment.substring(1);
                }
                this._segmentInfos.push({
                    type: 'param',
                    segmentText: segment,
                    paramName: paramName,
                    pattern: new RegExp('^([^\\/]+)$'),
                    paramType: typeName
                });
            }
            else if (segment !== '' || !this.hasAttribute('index')) {
                // 空セグメントはindex以外の場合のみ追加（絶対パスの先頭 '' など）
                this._segmentInfos.push({
                    type: 'static',
                    segmentText: segment,
                    paramName: null,
                    pattern: new RegExp(`^${segment}$`)
                });
            }
        }
        this._hasGuard = this.hasAttribute('guard');
        if (this._hasGuard) {
            this._guardFallbackPath = this.getAttribute('guard') || '/';
            this._waitForSetGuardHandler = new Promise((resolve) => {
                this._resolveSetGuardHandler = resolve;
            });
        }
        this.setAttribute('fullpath', this.absolutePath);
    }
    get fullpath() {
        return this.absolutePath;
    }
    get segmentCount() {
        if (typeof this._segmentCount === 'undefined') {
            let count = 0;
            for (const info of this._segmentInfos) {
                if (info.type !== 'catch-all') {
                    count++;
                }
            }
            this._segmentCount = this._path === "" ? 0 : count;
        }
        return this._segmentCount;
    }
    get absoluteSegmentCount() {
        return this._checkParentNode((routeParentNode) => {
            return routeParentNode.absoluteSegmentCount + this.segmentCount;
        }, () => {
            return this.segmentCount;
        });
    }
    testAncestorNode(ancestorNode) {
        let currentNode = this._routeParentNode;
        while (currentNode) {
            if (currentNode === ancestorNode) {
                return true;
            }
            currentNode = currentNode.routeParentNode;
        }
        return false;
    }
    clearParams() {
        this._params = {};
        this._typedParams = {};
    }
}

const cache = new Map();
class Layout extends HTMLElement {
    _uuid = getUUID();
    _initialized = false;
    constructor() {
        super();
    }
    async _loadTemplateFromSource(source) {
        try {
            const response = await fetch(source);
            if (!response.ok) {
                raiseError(`${config.tagNames.layout} failed to fetch layout from source: ${source}, status: ${response.status}`);
            }
            const templateContent = await response.text();
            cache.set(source, templateContent);
            return templateContent;
        }
        catch (error) {
            raiseError(`${config.tagNames.layout} failed to load layout from source: ${source}, error: ${error}`);
        }
    }
    _loadTemplateFromDocument(id) {
        const element = document.getElementById(`${id}`);
        if (element) {
            if (element instanceof HTMLTemplateElement) {
                return element.innerHTML;
            }
        }
        return null;
    }
    async loadTemplate() {
        const source = this.getAttribute('src');
        const layoutId = this.getAttribute('layout');
        if (source && layoutId) {
            console.warn(`${config.tagNames.layout} have both "src" and "layout" attributes.`);
        }
        const template = document.createElement('template');
        if (source) {
            if (cache.has(source)) {
                template.innerHTML = cache.get(source) || '';
            }
            else {
                template.innerHTML = await this._loadTemplateFromSource(source) || '';
                cache.set(source, template.innerHTML);
            }
        }
        else if (layoutId) {
            const templateContent = this._loadTemplateFromDocument(layoutId);
            if (templateContent) {
                template.innerHTML = templateContent;
            }
            else {
                console.warn(`${config.tagNames.layout} could not find template with id "${layoutId}".`);
            }
        }
        return template;
    }
    get uuid() {
        return this._uuid;
    }
    get enableShadowRoot() {
        if (this.hasAttribute('enable-shadow-root')) {
            return true;
        }
        else if (this.hasAttribute('disable-shadow-root')) {
            return false;
        }
        return config.enableShadowRoot;
    }
    get name() {
        // Layout 要素が DOM に挿入されないケース（parseで置換）でも name を取れるようにする
        return this.getAttribute('name') || '';
    }
    _initialize() {
        this._initialized = true;
    }
    connectedCallback() {
        if (!this._initialized) {
            this._initialize();
        }
    }
}

class Outlet extends HTMLElement {
    _routesNode = null;
    _lastRoutes = [];
    _initialized = false;
    constructor() {
        super();
    }
    get routesNode() {
        if (!this._routesNode) {
            raiseError(`${config.tagNames.outlet} has no routesNode.`);
        }
        return this._routesNode;
    }
    set routesNode(value) {
        this._routesNode = value;
    }
    get rootNode() {
        if (this.shadowRoot) {
            return this.shadowRoot;
        }
        return this;
    }
    get lastRoutes() {
        return this._lastRoutes;
    }
    set lastRoutes(value) {
        this._lastRoutes = [...value];
    }
    _initialize() {
        if (config.enableShadowRoot) {
            this.attachShadow({ mode: 'open' });
        }
        this._initialized = true;
    }
    connectedCallback() {
        if (!this._initialized) {
            this._initialize();
        }
    }
}
function createOutlet() {
    return document.createElement(config.tagNames.outlet);
}

function getCustomTagName(element) {
    const tagName = element.tagName.toLowerCase();
    if (tagName.includes("-")) {
        return tagName;
    }
    const isAttr = element.getAttribute("is");
    if (isAttr && isAttr.includes("-")) {
        return isAttr;
    }
    return null;
}

const bindTypeSet = new Set(["props", "states", "attr", ""]);
function _assignParams(element, params, bindType) {
    for (const [key, value] of Object.entries(params)) {
        switch (bindType) {
            case "props":
                element.props = {
                    ...element.props,
                    [key]: value
                };
                break;
            case "states":
                element.states = {
                    ...element.states,
                    [key]: value
                };
                break;
            case "attr":
                element.setAttribute(key, value);
                break;
            case "":
                element[key] = value;
                break;
        }
    }
}
function assignParams(element, params) {
    if (!element.hasAttribute('data-bind')) {
        raiseError(`${element.tagName} has no 'data-bind' attribute.`);
    }
    const bindTypeText = element.getAttribute('data-bind') || '';
    if (!bindTypeSet.has(bindTypeText)) {
        raiseError(`${element.tagName} has invalid 'data-bind' attribute: ${bindTypeText}`);
    }
    const bindType = bindTypeText;
    const customTagName = getCustomTagName(element);
    if (customTagName && customElements.get(customTagName) === undefined) {
        customElements.whenDefined(customTagName).then(() => {
            if (element.isConnected) {
                // 要素が削除されていない場合のみ割り当てを行う
                _assignParams(element, params, bindType);
            }
        }).catch(() => {
            raiseError(`Failed to define custom element: ${customTagName}`);
        });
    }
    else {
        _assignParams(element, params, bindType);
    }
}

class LayoutOutlet extends HTMLElement {
    _layout = null;
    _initialized = false;
    _layoutChildNodes = [];
    constructor() {
        super();
    }
    get layout() {
        if (!this._layout) {
            raiseError(`${config.tagNames.layoutOutlet} has no layout.`);
        }
        return this._layout;
    }
    set layout(value) {
        this._layout = value;
        this.setAttribute('name', value.name);
    }
    get name() {
        return this.layout.name;
    }
    async _initialize() {
        this._initialized = true;
        if (this.layout.enableShadowRoot) {
            this.attachShadow({ mode: 'open' });
        }
        const template = await this.layout.loadTemplate();
        if (this.shadowRoot) {
            this.shadowRoot.appendChild(template.content.cloneNode(true));
            for (const childNode of Array.from(this.layout.childNodes)) {
                this._layoutChildNodes.push(childNode);
                this.appendChild(childNode);
            }
        }
        else {
            const fragmentForTemplate = template.content.cloneNode(true);
            const slotElementBySlotName = new Map();
            fragmentForTemplate.querySelectorAll('slot').forEach((slotElement) => {
                const slotName = slotElement.getAttribute('name') || '';
                if (!slotElementBySlotName.has(slotName)) {
                    slotElementBySlotName.set(slotName, slotElement);
                }
                else {
                    console.warn(`${config.tagNames.layoutOutlet} duplicate slot name "${slotName}" in layout template.`);
                }
            });
            const fragmentBySlotName = new Map();
            const fragmentForChildNodes = document.createDocumentFragment();
            for (const childNode of Array.from(this.layout.childNodes)) {
                this._layoutChildNodes.push(childNode);
                if (childNode instanceof Element) {
                    const slotName = childNode.getAttribute('slot') || '';
                    if (slotName.length > 0 && slotElementBySlotName.has(slotName)) {
                        if (!fragmentBySlotName.has(slotName)) {
                            fragmentBySlotName.set(slotName, document.createDocumentFragment());
                        }
                        fragmentBySlotName.get(slotName)?.appendChild(childNode);
                        continue;
                    }
                }
                fragmentForChildNodes.appendChild(childNode);
            }
            for (const [slotName, slotElement] of slotElementBySlotName) {
                const fragment = fragmentBySlotName.get(slotName);
                if (fragment) {
                    slotElement.replaceWith(fragment);
                }
            }
            const defaultSlot = slotElementBySlotName.get('');
            if (defaultSlot) {
                defaultSlot.replaceWith(fragmentForChildNodes);
            }
            this.appendChild(fragmentForTemplate);
        }
    }
    async connectedCallback() {
        if (!this._initialized) {
            await this._initialize();
        }
    }
    assignParams(params) {
        for (const childNode of this._layoutChildNodes) {
            if (childNode instanceof Element) {
                childNode.querySelectorAll('[data-bind]').forEach((e) => {
                    // 子要素にパラメータを割り当て
                    assignParams(e, params);
                });
                if (childNode.hasAttribute('data-bind')) {
                    // 子要素にパラメータを割り当て
                    assignParams(childNode, params);
                }
            }
        }
    }
}
function createLayoutOutlet() {
    return document.createElement(config.tagNames.layoutOutlet);
}

function _duplicateCheck(routesByPath, route) {
    let routes = routesByPath.get(route.absolutePath);
    if (!routes) {
        routes = [];
    }
    for (const existingRoute of routes) {
        if (!route.testAncestorNode(existingRoute)) {
            console.warn(`Duplicate route path detected: '${route.absolutePath}' (defined as '${route.path}')`);
            break;
        }
    }
    routes.push(route);
    if (routes.length === 1) {
        routesByPath.set(route.absolutePath, routes);
    }
}
async function _parseNode(routerNode, node, routes, map, routesByPath) {
    const routeParentNode = routes.length > 0 ? routes[routes.length - 1] : null;
    const fragment = document.createDocumentFragment();
    const childNodes = Array.from(node.childNodes);
    for (const childNode of childNodes) {
        if (childNode.nodeType === Node.ELEMENT_NODE) {
            let appendNode = childNode;
            let element = childNode;
            const tagName = element.tagName.toLowerCase();
            if (tagName === config.tagNames.route) {
                const childFragment = document.createDocumentFragment();
                // Move child nodes to fragment to avoid duplication of
                for (const childNode of Array.from(element.childNodes)) {
                    childFragment.appendChild(childNode);
                }
                const cloneElement = document.importNode(element, true);
                customElements.upgrade(cloneElement);
                cloneElement.appendChild(childFragment);
                const route = cloneElement;
                route.initialize(routerNode, routeParentNode);
                _duplicateCheck(routesByPath, route);
                routes.push(route);
                map.set(route.uuid, route);
                appendNode = route.placeHolder;
                element = route;
            }
            else if (tagName === config.tagNames.layout) {
                const childFragment = document.createDocumentFragment();
                // Move child nodes to fragment to avoid duplication of
                for (const childNode of Array.from(element.childNodes)) {
                    childFragment.appendChild(childNode);
                }
                const cloneElement = document.importNode(element, true);
                customElements.upgrade(cloneElement);
                cloneElement.appendChild(childFragment);
                const layout = cloneElement;
                const layoutOutlet = createLayoutOutlet();
                layoutOutlet.layout = layout;
                appendNode = layoutOutlet;
                element = cloneElement;
            }
            const children = await _parseNode(routerNode, element, routes, map, routesByPath);
            element.innerHTML = "";
            element.appendChild(children);
            fragment.appendChild(appendNode);
        }
        else {
            fragment.appendChild(childNode);
        }
    }
    return fragment;
}
async function parse(routerNode) {
    const map = new Map();
    const routesByPath = new Map();
    const fr = await _parseNode(routerNode, routerNode.template.content, [], map, routesByPath);
    return fr;
}

function testPath(route, path, segments) {
    const params = {};
    const typedParams = {};
    let testResult = true;
    let catchAllFound = false;
    let i = 0, segIndex = 0;
    while (i < route.absoluteSegmentInfos.length) {
        const segmentInfo = route.absoluteSegmentInfos[i];
        // index属性のルートはセグメントを消費しないのでスキップ
        if (segmentInfo.isIndex) {
            i++;
            continue;
        }
        // 先頭の空セグメント（絶対パスの /）はsegmentsから除外されているのでスキップ
        if (i === 0 && segmentInfo.segmentText === '' && segmentInfo.type === 'static') {
            i++;
            continue;
        }
        const segment = segments[segIndex];
        if (segment === undefined) {
            // セグメントが足りない
            testResult = false;
            break;
        }
        let match = false;
        if (segmentInfo.type === "param") {
            const paramType = segmentInfo.paramType || 'any';
            const builtinParamType = builtinParamTypes[paramType];
            const value = builtinParamType.parse(segment);
            if (typeof value !== 'undefined') {
                if (segmentInfo.paramName) {
                    params[segmentInfo.paramName] = segment;
                    typedParams[segmentInfo.paramName] = value;
                }
                match = true;
            }
        }
        else {
            match = segmentInfo.pattern.exec(segment) !== null;
        }
        if (match) {
            if (segmentInfo.type === 'catch-all') {
                // Catch-all: match remaining segments
                const remainingSegments = segments.slice(segIndex).join('/');
                params['*'] = remainingSegments;
                typedParams['*'] = remainingSegments;
                catchAllFound = true;
                break; // No more segments to process
            }
        }
        else {
            testResult = false;
            break;
        }
        i++;
        segIndex++;
    }
    let finalResult = false;
    if (testResult) {
        if (catchAllFound) {
            // catch-all は残り全部マッチ済み
            finalResult = true;
        }
        else if (i === route.absoluteSegmentInfos.length && segIndex === segments.length) {
            // 全セグメントが消費された
            finalResult = true;
        }
        else if (i === route.absoluteSegmentInfos.length && segIndex === segments.length - 1 && segments.at(-1) === '') {
            // 末尾スラッシュ対応: /users/ -> ['', 'users', '']
            finalResult = true;
        }
    }
    if (finalResult) {
        return {
            path: path,
            routes: route.routes,
            params: params,
            typedParams: typedParams,
            lastPath: ""
        };
    }
    return null;
}

function _matchRoutes(routerNode, routeNode, routes, normalizedPath, segments, results) {
    const nextRoutes = routes.concat(routeNode);
    const matchResult = testPath(routeNode, normalizedPath, segments);
    if (matchResult) {
        results.push(matchResult);
    }
    for (const childRoute of routeNode.routeChildNodes) {
        _matchRoutes(routerNode, childRoute, nextRoutes, normalizedPath, segments, results);
    }
}
function matchRoutes(routerNode, normalizedPath) {
    const routes = [];
    const topLevelRoutes = routerNode.routeChildNodes;
    const results = [];
    // セグメント配列を作成（先頭の/は除去せずにそのまま分割）
    // '/' => ['', ''] → filter → ['']
    // '/home' => ['', 'home']  → filter → ['home']
    // '/home/about' => ['', 'home', 'about'] → filter → ['home', 'about']
    // '' => ['']
    const rawSegments = normalizedPath.split('/');
    // 先頭の空セグメント（絶対パスの/）と末尾の空セグメント（/で終わるパス）を除去
    const segments = rawSegments.filter((s, i) => {
        if (i === 0 && s === '')
            return false; // 先頭の空セグメントをスキップ
        if (i === rawSegments.length - 1 && s === '' && rawSegments.length > 1)
            return false; // 末尾の空セグメントをスキップ
        return true;
    });
    for (const route of topLevelRoutes) {
        _matchRoutes(routerNode, route, routes, normalizedPath, segments, results);
    }
    results.sort((a, b) => {
        const lastRouteA = a.routes.at(-1);
        const lastRouteB = b.routes.at(-1);
        const diffSegmentCount = lastRouteA.absoluteSegmentCount - lastRouteB.absoluteSegmentCount;
        if (diffSegmentCount !== 0) {
            return -diffSegmentCount;
        }
        const diffWeight = lastRouteA.absoluteWeight - lastRouteB.absoluteWeight;
        if (diffWeight !== 0) {
            return -diffWeight;
        }
        const diffIndex = lastRouteA.childIndex - lastRouteB.childIndex;
        return diffIndex;
    });
    if (results.length > 0) {
        return results[0];
    }
    return null;
}

function hideRoute(route) {
    route.clearParams();
    for (const node of route.childNodeArray) {
        node.parentNode?.removeChild(node);
    }
}

function showRoute(route, matchResult) {
    route.clearParams();
    for (const key of route.paramNames) {
        route.params[key] = matchResult.params[key];
        route.typedParams[key] = matchResult.typedParams[key];
    }
    const parentNode = route.placeHolder.parentNode;
    const nextSibling = route.placeHolder.nextSibling;
    for (const node of route.childNodeArray) {
        // connectedCallbackが呼ばれる前に、プロパティにパラメータを割り当てる
        // connectedCallbackを実行するときにパラメータはすでに設定されている必要があるため
        if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node;
            element.querySelectorAll('[data-bind]').forEach((e) => {
                assignParams(e, route.typedParams);
            });
            if (element.hasAttribute('data-bind')) {
                assignParams(element, route.typedParams);
            }
            element.querySelectorAll(config.tagNames.layoutOutlet).forEach((layoutOutlet) => {
                layoutOutlet.assignParams(route.typedParams);
            });
            if (element.tagName.toLowerCase() === config.tagNames.layoutOutlet) {
                element.assignParams(route.typedParams);
            }
        }
        if (nextSibling) {
            parentNode?.insertBefore(node, nextSibling);
        }
        else {
            parentNode?.appendChild(node);
        }
    }
    return true;
}

async function showRouteContent(routerNode, matchResult, lastRoutes) {
    // Hide previous routes
    const routesSet = new Set(matchResult.routes);
    for (const route of lastRoutes) {
        if (!routesSet.has(route)) {
            hideRoute(route);
        }
    }
    try {
        for (const route of matchResult.routes) {
            await route.guardCheck(matchResult);
        }
    }
    catch (e) {
        const err = e;
        if ("fallbackPath" in err) {
            const guardCancel = err;
            console.warn(`Navigation cancelled: ${err.message}. Redirecting to ${guardCancel.fallbackPath}`);
            queueMicrotask(() => {
                routerNode.navigate(guardCancel.fallbackPath);
            });
            return;
        }
        else {
            throw e;
        }
    }
    const lastRouteSet = new Set(lastRoutes);
    let force = false;
    for (const route of matchResult.routes) {
        if (!lastRouteSet.has(route) || route.shouldChange(matchResult.params) || force) {
            force = showRoute(route, matchResult);
        }
    }
}

async function applyRoute(routerNode, outlet, fullPath, lastPath) {
    const basename = routerNode.basename;
    let sliced = fullPath;
    if (basename !== "") {
        if (fullPath === basename) {
            sliced = "";
        }
        else if (fullPath.startsWith(basename + "/")) {
            sliced = fullPath.slice(basename.length);
        }
    }
    // when fullPath === basename (e.g. "/app"), treat it as root "/"
    const path = sliced === "" ? "/" : sliced;
    let matchResult = matchRoutes(routerNode, path);
    if (!matchResult) {
        if (routerNode.fallbackRoute) {
            matchResult = {
                routes: [routerNode.fallbackRoute],
                params: {},
                typedParams: {},
                path: path,
                lastPath: lastPath
            };
        }
        else {
            raiseError(`${config.tagNames.router} No route matched for path: ${path}`);
        }
    }
    matchResult.lastPath = lastPath;
    const lastRoutes = outlet.lastRoutes;
    await showRouteContent(routerNode, matchResult, lastRoutes);
    // if successful, update router and outlet state
    routerNode.path = path;
    outlet.lastRoutes = matchResult.routes;
}

function getNavigation() {
    const nav = window.navigation;
    if (!nav) {
        return null;
    }
    if (typeof nav.addEventListener !== "function" || typeof nav.removeEventListener !== "function") {
        return null;
    }
    return nav;
}

/**
 * AppRoutes - Root component for @wcstack/router
 *
 * Container element that manages route definitions and navigation.
 */
class Router extends HTMLElement {
    static _instance = null;
    _outlet = null;
    _template = null;
    _routeChildNodes = [];
    _basename = '';
    _path = '';
    _initialized = false;
    _fallbackRoute = null;
    _listeningPopState = false;
    constructor() {
        super();
        if (Router._instance) {
            raiseError(`${config.tagNames.router} can only be instantiated once.`);
        }
        Router._instance = this;
    }
    /**
     * Normalize a URL pathname to a route path.
     * - ensure leading slash
     * - collapse multiple slashes
     * - treat trailing file extensions (e.g. .html) as directory root
     * - remove trailing slash except root "/"
     */
    _normalizePathname(_path) {
        let path = _path || "/";
        if (!path.startsWith("/"))
            path = "/" + path;
        path = path.replace(/\/{2,}/g, "/");
        // e.g. "/app/index.html" -> "/app"
        const exts = config.basenameFileExtensions;
        if (exts.length > 0) {
            const extPattern = new RegExp(`\\/[^/]+(?:${exts.map(e => e.replace(/\./g, '\\.')).join('|')})$`, 'i');
            path = path.replace(extPattern, "");
        }
        if (path === "")
            path = "/";
        if (path.length > 1 && path.endsWith("/"))
            path = path.slice(0, -1);
        return path;
    }
    /**
     * Normalize basename.
     * - "" or "/" -> ""
     * - "/app/" -> "/app"
     * - "/app/index.html" -> "/app"
     */
    _normalizeBasename(_path) {
        let path = _path || "";
        if (!path)
            return "";
        if (!path.startsWith("/"))
            path = "/" + path;
        path = path.replace(/\/{2,}/g, "/");
        const exts = config.basenameFileExtensions;
        if (exts.length > 0) {
            const extPattern = new RegExp(`\\/[^/]+(?:${exts.map(e => e.replace(/\./g, '\\.')).join('|')})$`, 'i');
            path = path.replace(extPattern, "");
        }
        if (path.length > 1 && path.endsWith("/"))
            path = path.slice(0, -1);
        if (path === "/")
            return "";
        return path;
    }
    _joinInternalPath(basename, to) {
        const base = this._normalizeBasename(basename);
        // accept "about" as "/about"
        let path = to.startsWith("/") ? to : "/" + to;
        path = this._normalizePathname(path);
        if (!base)
            return path;
        // keep "/app/" for root
        if (path === "/")
            return base + "/";
        return base + path;
    }
    _notifyLocationChange() {
        // For environments without Navigation API (and for Link active-state updates)
        window.dispatchEvent(new CustomEvent("wcs:navigate"));
    }
    _getBasename() {
        const base = new URL(document.baseURI);
        let path = base.pathname || "/";
        if (path === "/") {
            return "";
        }
        return this._normalizeBasename(path);
    }
    static get instance() {
        if (!Router._instance) {
            raiseError(`${config.tagNames.router} has not been instantiated.`);
        }
        return Router._instance;
    }
    static navigate(path) {
        Router.instance.navigate(path);
    }
    get basename() {
        return this._basename;
    }
    _getOutlet() {
        let outlet = document.querySelector(config.tagNames.outlet);
        if (!outlet) {
            outlet = createOutlet();
            document.body.appendChild(outlet);
        }
        return outlet;
    }
    _getTemplate() {
        const template = this.querySelector("template");
        return template;
    }
    get outlet() {
        if (!this._outlet) {
            raiseError(`${config.tagNames.router} has no outlet.`);
        }
        return this._outlet;
    }
    get template() {
        if (!this._template) {
            raiseError(`${config.tagNames.router} has no template.`);
        }
        return this._template;
    }
    get routeChildNodes() {
        return this._routeChildNodes;
    }
    get path() {
        return this._path;
    }
    /**
     * applyRoute 内で設定される値です。
     */
    set path(value) {
        this._path = value;
    }
    get fallbackRoute() {
        return this._fallbackRoute;
    }
    /**
     * Routeのfallback属性がある場合にそのルートを設定します。
     */
    set fallbackRoute(value) {
        this._fallbackRoute = value;
    }
    async navigate(path) {
        const fullPath = this._joinInternalPath(this._basename, path);
        const navigation = getNavigation();
        if (navigation?.navigate) {
            navigation.navigate(fullPath);
        }
        else {
            history.pushState(null, '', fullPath);
            await applyRoute(this, this.outlet, fullPath, this._path);
            this._notifyLocationChange();
        }
    }
    _onNavigateFunc(navEvent) {
        if (!navEvent.canIntercept ||
            navEvent.hashChange ||
            navEvent.downloadRequest !== null) {
            return;
        }
        const routesNode = this;
        navEvent.intercept({
            handler: async () => {
                const url = new URL(navEvent.destination.url);
                const fullPath = routesNode._normalizePathname(url.pathname);
                await applyRoute(routesNode, routesNode.outlet, fullPath, routesNode.path);
            },
        });
    }
    _onNavigate = this._onNavigateFunc.bind(this);
    _onPopState = async () => {
        // back/forward for environments without Navigation API
        const fullPath = this._normalizePathname(window.location.pathname);
        await applyRoute(this, this.outlet, fullPath, this._path);
        this._notifyLocationChange();
    };
    async _initialize() {
        this._initialized = true;
        this._basename = this._normalizeBasename(this.getAttribute("basename") || this._getBasename() || "");
        const hasBaseTag = document.querySelector('base[href]') !== null;
        const url = new URL(window.location.href);
        if (this._basename === "" && !hasBaseTag && url.pathname !== "/") {
            raiseError(`${config.tagNames.router} basename is empty, but current path is not "/".`);
        }
        this._outlet = this._getOutlet();
        this._outlet.routesNode = this;
        this._template = this._getTemplate();
        if (!this._template) {
            raiseError(`${config.tagNames.router} should have a <template> child element.`);
        }
        const fragment = await parse(this);
        this._outlet.rootNode.appendChild(fragment);
        if (this.routeChildNodes.length === 0) {
            raiseError(`${config.tagNames.router} has no route definitions.`);
        }
        const fullPath = this._normalizePathname(window.location.pathname);
        await applyRoute(this, this.outlet, fullPath, this._path);
        this._notifyLocationChange();
    }
    async connectedCallback() {
        if (!this._initialized) {
            await this._initialize();
        }
        getNavigation()?.addEventListener("navigate", this._onNavigate);
        // Fallback for browsers without Navigation API
        if (!getNavigation()?.addEventListener && !this._listeningPopState) {
            window.addEventListener("popstate", this._onPopState);
            this._listeningPopState = true;
        }
    }
    disconnectedCallback() {
        getNavigation()?.removeEventListener("navigate", this._onNavigate);
        if (this._listeningPopState) {
            window.removeEventListener("popstate", this._onPopState);
            this._listeningPopState = false;
        }
        if (Router._instance === this) {
            Router._instance = null;
        }
    }
}

class Link extends HTMLElement {
    static get observedAttributes() {
        return ['to'];
    }
    _childNodeArray = [];
    _uuid = getUUID();
    _path = "";
    _router = null;
    _anchorElement = null;
    _initialized = false;
    _onClick;
    constructor() {
        super();
    }
    get uuid() {
        return this._uuid;
    }
    get router() {
        if (this._router) {
            return this._router;
        }
        const router = document.querySelector(config.tagNames.router);
        if (router) {
            return (this._router = router);
        }
        raiseError(`${config.tagNames.link} is not connected to a router.`);
    }
    _initialize() {
        this.style.display = "none";
        this._childNodeArray = Array.from(this.childNodes);
        this._path = this.getAttribute('to') || '';
        this._initialized = true;
    }
    _normalizePathname(path) {
        let p = path || "/";
        if (!p.startsWith("/"))
            p = "/" + p;
        p = p.replace(/\/{2,}/g, "/");
        if (p.length > 1 && p.endsWith("/"))
            p = p.slice(0, -1);
        return p;
    }
    _joinInternalPath(basename, to) {
        const base = (basename || "").replace(/\/{2,}/g, "/").replace(/\/$/, "");
        const internal = to.startsWith("/") ? to : "/" + to;
        const path = this._normalizePathname(internal);
        if (!base)
            return path;
        if (path === "/")
            return base + "/";
        return base + path;
    }
    _setAnchorHref(anchor, path) {
        if (path.startsWith('/')) {
            anchor.href = this._joinInternalPath(this.router.basename, path);
        }
        else {
            try {
                anchor.href = new URL(path).toString();
            }
            catch {
                raiseError(`[${config.tagNames.link}] Invalid URL in 'to' attribute: ${path}`);
            }
        }
    }
    connectedCallback() {
        if (!this._initialized) {
            this._initialize();
        }
        const parentNode = this.parentNode;
        if (!parentNode) {
            // should not happen if connected
            return;
        }
        const nextSibling = this.nextSibling;
        const link = document.createElement('a');
        this._setAnchorHref(link, this._path);
        for (const childNode of this._childNodeArray) {
            link.appendChild(childNode);
        }
        if (nextSibling) {
            parentNode.insertBefore(link, nextSibling);
        }
        else {
            parentNode.appendChild(link);
        }
        this._anchorElement = link;
        // ロケーション変更を監視
        getNavigation()?.addEventListener('currententrychange', this._updateActiveState);
        window.addEventListener('wcs:navigate', this._updateActiveState);
        window.addEventListener('popstate', this._updateActiveState);
        // Navigation API が無い場合は、クリックで router.navigate にフォールバック
        if (this._path.startsWith('/') && !getNavigation()?.navigate) {
            this._onClick = async (e) => {
                // only left-click without modifiers
                if (e.defaultPrevented)
                    return;
                if (e.button !== 0)
                    return;
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
                    return;
                e.preventDefault();
                await this.router.navigate(this._path);
                this._updateActiveState();
            };
            link.addEventListener('click', this._onClick);
        }
        this._updateActiveState();
    }
    disconnectedCallback() {
        getNavigation()?.removeEventListener('currententrychange', this._updateActiveState);
        window.removeEventListener('wcs:navigate', this._updateActiveState);
        window.removeEventListener('popstate', this._updateActiveState);
        if (this._anchorElement) {
            if (this._onClick) {
                this._anchorElement.removeEventListener('click', this._onClick);
                this._onClick = undefined;
            }
            this._anchorElement.remove();
            this._anchorElement = null;
        }
        for (const childNode of this._childNodeArray) {
            childNode.parentNode?.removeChild(childNode);
        }
    }
    attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'to' && oldValue !== newValue) {
            this._path = newValue || '';
            if (this._anchorElement) {
                this._setAnchorHref(this._anchorElement, this._path);
                this._updateActiveState();
            }
        }
    }
    _updateActiveState = () => {
        const currentPath = this._normalizePathname(new URL(window.location.href).pathname);
        const linkPath = this._normalizePathname(this._path.startsWith('/') ? this._joinInternalPath(this.router.basename, this._path) : this._path);
        if (this._anchorElement) {
            if (currentPath === linkPath) {
                this._anchorElement.classList.add('active');
            }
            else {
                this._anchorElement.classList.remove('active');
            }
        }
    };
    get anchorElement() {
        return this._anchorElement;
    }
}

/**
 * グローバルHeadスタック
 * 最後に接続されたHeadが優先される
 */
const headStack = [];
/**
 * 初期の<head>内容を記憶（最初のHead接続時に保存）
 */
const initialHeadValues = new Map();
let initialHeadCaptured = false;
class Head extends HTMLElement {
    _initialized = false;
    _childElementArray = [];
    constructor() {
        super();
        this.style.display = 'none';
    }
    _initialize() {
        if (this._initialized) {
            return;
        }
        this._initialized = true;
        this._childElementArray = Array.from(this.children);
        for (const child of this._childElementArray) {
            this.removeChild(child);
        }
    }
    connectedCallback() {
        this._initialize();
        // 初回のみ初期状態を保存
        if (!initialHeadCaptured) {
            this._captureInitialHead();
            initialHeadCaptured = true;
        }
        // スタックに追加
        headStack.push(this);
        // headを再適用
        this._reapplyHead();
    }
    disconnectedCallback() {
        // スタックから削除
        const index = headStack.indexOf(this);
        if (index !== -1) {
            headStack.splice(index, 1);
        }
        // headを再適用（スタックが空なら初期状態に戻す）
        this._reapplyHead();
    }
    get childElementArray() {
        if (!this._initialized) {
            raiseError('Head component is not initialized yet.');
        }
        return this._childElementArray;
    }
    /**
     * 要素の一意キーを生成
     */
    _getKey(el) {
        const tag = el.tagName.toLowerCase();
        if (tag === 'title') {
            return 'title';
        }
        if (tag === 'meta') {
            const name = el.getAttribute('name') || '';
            const property = el.getAttribute('property') || '';
            const httpEquiv = el.getAttribute('http-equiv') || '';
            const charset = el.hasAttribute('charset') ? 'charset' : '';
            const media = el.getAttribute('media') || '';
            return `meta:${name}:${property}:${httpEquiv}:${charset}:${media}`;
        }
        if (tag === 'link') {
            const rel = el.getAttribute('rel') || '';
            const href = el.getAttribute('href') || '';
            const media = el.getAttribute('media') || '';
            return `link:${rel}:${href}:${media}`;
        }
        if (tag === 'base') {
            return 'base';
        }
        // script, style等はouterHTMLの先頭で識別（フォールバック）
        return `${tag}:${el.outerHTML.slice(0, 100)}`;
    }
    /**
     * head内で指定のキーに一致する要素を検索
     */
    _findInHead(key) {
        const head = document.head;
        for (const el of Array.from(head.children)) {
            if (this._getKey(el) === key) {
                return el;
            }
        }
        return null;
    }
    /**
     * 初期の<head>状態をキャプチャ
     * document.head内の全ての要素をスキャンして保存する
     */
    _captureInitialHead() {
        const head = document.head;
        for (const child of Array.from(head.children)) {
            const key = this._getKey(child);
            if (!initialHeadValues.has(key)) {
                initialHeadValues.set(key, child.cloneNode(true));
            }
        }
    }
    /**
     * スタック全体からheadを再構築
     * 後のHeadが優先される（上書き）
     */
    _reapplyHead() {
        // 全スタックのHeadが扱うキーを収集
        const allKeys = new Set();
        for (const head of headStack) {
            for (const child of head._childElementArray) {
                allKeys.add(this._getKey(child));
            }
        }
        // 初期値にあるキーも追加
        for (const key of initialHeadValues.keys()) {
            allKeys.add(key);
        }
        // 現在のheadにある要素のキーも追加（管理下から外れたものを削除するため）
        for (const child of Array.from(document.head.children)) {
            allKeys.add(this._getKey(child));
        }
        // 各キーについて、最も優先度の高い値を決定
        for (const key of allKeys) {
            // スタックを逆順に見て、最初に見つかった値を使用
            let targetElement = null;
            for (let i = headStack.length - 1; i >= 0; i--) {
                const head = headStack[i];
                for (const child of head._childElementArray) {
                    if (this._getKey(child) === key) {
                        targetElement = child.cloneNode(true);
                        break;
                    }
                }
                if (targetElement)
                    break;
            }
            // スタックに該当がなければ初期値を使用
            if (!targetElement && initialHeadValues.has(key)) {
                const initial = initialHeadValues.get(key);
                // initialHeadValuesにはnullを保存しないため、has(key)がtrueならinitialは必ず存在しElementである
                targetElement = initial.cloneNode(true);
            }
            // headを更新
            const current = this._findInHead(key);
            if (targetElement) {
                if (current) {
                    current.replaceWith(targetElement);
                }
                else {
                    document.head.appendChild(targetElement);
                }
            }
            else {
                // 初期値もスタックにもない場合は削除
                current?.remove();
            }
        }
    }
}

function registerComponents() {
    // Register custom element
    if (!customElements.get(config.tagNames.layout)) {
        customElements.define(config.tagNames.layout, Layout);
    }
    if (!customElements.get(config.tagNames.layoutOutlet)) {
        customElements.define(config.tagNames.layoutOutlet, LayoutOutlet);
    }
    if (!customElements.get(config.tagNames.outlet)) {
        customElements.define(config.tagNames.outlet, Outlet);
    }
    if (!customElements.get(config.tagNames.route)) {
        customElements.define(config.tagNames.route, Route);
    }
    if (!customElements.get(config.tagNames.router)) {
        customElements.define(config.tagNames.router, Router);
    }
    if (!customElements.get(config.tagNames.link)) {
        customElements.define(config.tagNames.link, Link);
    }
    if (!customElements.get(config.tagNames.head)) {
        customElements.define(config.tagNames.head, Head);
    }
}

/**
 * Initialize the router with optional configuration.
 * This is the main entry point for setting up the router.
 * @param config - Optional partial configuration to override defaults
 */
function bootstrapRouter(config) {
    if (config) {
        setConfig(config);
    }
    registerComponents();
}

export { bootstrapRouter };
//# sourceMappingURL=index.esm.js.map
