const config = {
    tagNames: {
        route: "wc-route",
        router: "wc-router",
        outlet: "wc-outlet",
        layout: "wc-layout",
        layoutOutlet: "wc-layout-outlet",
        link: "wc-link"
    },
    enableShadowRoot: false
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

function raiseError(message) {
    throw new Error(`[wc-router] ${message}`);
}

const bindTypeSet = new Set(["props", "states", "attr", ""]);
function assignParams(element, params) {
    if (!element.hasAttribute('data-bind')) {
        raiseError(`${element.tagName} has no 'data-bind' attribute.`);
    }
    const bindTypeText = element.getAttribute('data-bind') || '';
    if (!bindTypeSet.has(bindTypeText)) {
        raiseError(`${element.tagName} has invalid 'data-bind' attribute: ${bindTypeText}`);
    }
    const bindType = bindTypeText;
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

class GuardCancel extends Error {
    fallbackPath;
    constructor(message, fallbackPath) {
        super(message);
        this.fallbackPath = fallbackPath;
    }
}

class Route extends HTMLElement {
    _name = '';
    _path = '';
    _routeParentNode = null;
    _routeChildNodes = [];
    _routerNode = null;
    _uuid = getUUID();
    _placeHolder = null;
    _childNodeArray = [];
    _isMadeArray = false;
    _paramNames = [];
    _patternText = '';
    _params = {};
    _absolutePattern = null;
    _weight = -1;
    _absoluteWeight = 0;
    _childIndex = 0;
    _hasGuard = false;
    _guardHandler = null;
    _waitForSetGuardHandler = null;
    _resolveSetGuardHandler = null;
    _guardFallbackPath = '';
    _initialized = false;
    _isFallbackRoute = false;
    constructor() {
        super();
    }
    get routeParentNode() {
        return this._routeParentNode;
    }
    set routeParentNode(value) {
        this._routeParentNode = value;
        if (value) {
            value.routeChildNodes.push(this);
            this._childIndex = value.routeChildNodes.length - 1;
        }
        else {
            // Top-level route
            this.routerNode.routeChildNodes.push(this);
            this._childIndex = this.routerNode.routeChildNodes.length - 1;
        }
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
    set routerNode(value) {
        this._routerNode = value;
        if (this._isFallbackRoute) {
            if (this._routerNode.fallbackRoute) {
                raiseError(`${config.tagNames.router} can have only one fallback route.`);
            }
            this.routerNode.fallbackRoute = this;
        }
    }
    get path() {
        return this._path;
    }
    get isRelative() {
        return !this._path.startsWith('/');
    }
    _checkParentNode(hasParentCallback, noParentCallback) {
        if (this.isRelative && !this._routeParentNode) {
            raiseError(`${config.tagNames.route} is relative but has no parent route.`);
        }
        if (!this.isRelative && this._routeParentNode) {
            raiseError(`${config.tagNames.route} is absolute but has a parent route.`);
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
        if (!this._placeHolder) {
            raiseError(`${config.tagNames.route} placeHolder is not set.`);
        }
        return this._placeHolder;
    }
    set placeHolder(value) {
        this._placeHolder = value;
    }
    get rootElement() {
        return this.shadowRoot ?? this;
    }
    get childNodeArray() {
        if (!this._isMadeArray) {
            this._childNodeArray = Array.from(this.rootElement.childNodes);
            this._isMadeArray = true;
        }
        return this._childNodeArray;
    }
    testPath(path) {
        const params = {};
        const testResult = this._absolutePattern?.exec(path) ??
            (this._absolutePattern = new RegExp(`^${this.absolutePatternText}$`)).exec(path);
        if (testResult) {
            this.absoluteParamNames.forEach((paramName, index) => {
                params[paramName] = testResult[index + 1];
            });
            return {
                path: path,
                routes: this.routes,
                params: params,
                lastPath: ""
            };
        }
        return null;
    }
    get routes() {
        if (this.routeParentNode) {
            return this.routeParentNode.routes.concat(this);
        }
        else {
            return [this];
        }
    }
    get patternText() {
        return this._patternText;
    }
    get absolutePatternText() {
        return this._checkParentNode((routeParentNode) => {
            const parentPattern = routeParentNode.absolutePatternText;
            return parentPattern.endsWith('\\/')
                ? parentPattern + this._patternText
                : parentPattern + '\\/' + this._patternText;
        }, () => {
            return this._patternText;
        });
    }
    get params() {
        return this._params;
    }
    get absoluteParamNames() {
        return this._checkParentNode((routeParentNode) => {
            return [
                ...routeParentNode.absoluteParamNames,
                ...this._paramNames
            ];
        }, () => {
            return [...this._paramNames];
        });
    }
    get weight() {
        return this._weight;
    }
    get absoluteWeight() {
        if (this._absoluteWeight > 0) {
            return this._absoluteWeight;
        }
        return (this._absoluteWeight = this._checkParentNode((routeParentNode) => {
            return routeParentNode.absoluteWeight + this._weight;
        }, () => {
            return this._weight;
        }));
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
    show(params) {
        this._params = {};
        for (const key of this._paramNames) {
            this._params[key] = params[key];
        }
        const parentNode = this.placeHolder.parentNode;
        const nextSibling = this.placeHolder.nextSibling;
        for (const node of this.childNodeArray) {
            if (nextSibling) {
                parentNode?.insertBefore(node, nextSibling);
            }
            else {
                parentNode?.appendChild(node);
            }
            if (node.nodeType === Node.ELEMENT_NODE) {
                const element = node;
                element.querySelectorAll('[data-bind]').forEach((e) => {
                    assignParams(e, this._params);
                });
                if (element.hasAttribute('data-bind')) {
                    assignParams(element, this._params);
                }
                element.querySelectorAll(config.tagNames.layoutOutlet).forEach((layoutOutlet) => {
                    layoutOutlet.assignParams(this._params);
                });
                if (element.tagName.toLowerCase() === config.tagNames.layoutOutlet) {
                    element.assignParams(this._params);
                }
            }
        }
        return true;
    }
    hide() {
        this._params = {};
        for (const node of this.childNodeArray) {
            node.parentNode?.removeChild(node);
        }
    }
    shouldChange(newParams) {
        for (const key of this._paramNames) {
            if (this._params[key] !== newParams[key]) {
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
    initialize() {
        if (this._initialized) {
            return;
        }
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
        const segments = this._path.split('/');
        const patternSegments = [];
        for (const segment of segments) {
            if (segment.startsWith(':')) {
                this._paramNames.push(segment.substring(1));
                patternSegments.push('([^\\/]+)');
                this._weight += 1;
            }
            else {
                patternSegments.push(segment);
                this._weight += 2;
            }
        }
        this._patternText = patternSegments.join('\\/');
        this._hasGuard = this.hasAttribute('guard');
        if (this._hasGuard) {
            this._guardFallbackPath = this.getAttribute('guard') || '/';
            this._waitForSetGuardHandler = new Promise((resolve) => {
                this._resolveSetGuardHandler = resolve;
            });
        }
        this._initialized = true;
    }
}

const cache = new Map();
class Layout extends HTMLElement {
    _uuid = getUUID();
    _name = '';
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
        return this._name;
    }
    _initialize() {
        this._name = this.getAttribute('name') || '';
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

async function _parseNode(routesNode, node, routes, map) {
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
                route.initialize();
                route.routerNode = routesNode;
                route.routeParentNode = routeParentNode;
                route.placeHolder = document.createComment(`@@route:${route.uuid}`);
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
            const children = await _parseNode(routesNode, element, routes, map);
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
async function parse(routesNode) {
    const map = new Map();
    const fr = await _parseNode(routesNode, routesNode.template.content, [], map);
    return fr;
}

function _matchRoutes(routerNode, routeNode, routes, path, results) {
    const nextRoutes = routes.concat(routeNode);
    const matchResult = routeNode.testPath(path);
    if (matchResult) {
        results.push(matchResult);
        return; // Stop searching deeper routes once a match is found
    }
    for (const childRoute of routeNode.routeChildNodes) {
        _matchRoutes(routerNode, childRoute, nextRoutes, path, results);
    }
}
function matchRoutes(routerNode, path) {
    const routes = [];
    const topLevelRoutes = routerNode.routeChildNodes;
    const results = [];
    for (const route of topLevelRoutes) {
        _matchRoutes(routerNode, route, routes, path, results);
    }
    results.sort((a, b) => {
        const lastRouteA = a.routes.at(-1);
        const lastRouteB = b.routes.at(-1);
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

async function showRouteContent(routerNode, matchResult, lastRoutes) {
    // Hide previous routes
    const routesSet = new Set(matchResult.routes);
    for (const route of lastRoutes) {
        if (!routesSet.has(route)) {
            route.hide();
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
            force = route.show(matchResult.params);
        }
    }
}

async function applyRoute(routerNode, outlet, fullPath, lastPath) {
    const basename = routerNode.basename;
    const path = fullPath.startsWith(basename)
        ? fullPath.slice(basename.length)
        : fullPath;
    let matchResult = matchRoutes(routerNode, path);
    if (!matchResult) {
        if (routerNode.fallbackRoute) {
            matchResult = {
                routes: [routerNode.fallbackRoute],
                params: {},
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
 * AppRoutes - Root component for wc-router
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
    constructor() {
        super();
        if (Router._instance) {
            raiseError(`${config.tagNames.router} can only be instantiated once.`);
        }
        Router._instance = this;
    }
    _normalizePath(_path) {
        let path = _path;
        if (!path.endsWith("/")) {
            path = path.replace(/\/[^/]*$/, "/"); // ファイル名(or末尾セグメント)を落として / で終わらせる
        }
        // 念のため先頭 / と、連続スラッシュの正規化
        if (!path.startsWith("/"))
            path = "/" + path;
        path = path.replace(/\/{2,}/g, "/");
        return path;
    }
    _getBasename() {
        const base = new URL(document.baseURI);
        let path = base.pathname || "/";
        if (path === "/") {
            return "";
        }
        return this._normalizePath(path);
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
        const fullPath = this._basename + path;
        const navigation = getNavigation();
        if (navigation?.navigate) {
            navigation.navigate(fullPath);
        }
        else {
            history.pushState(null, '', fullPath);
            await applyRoute(this, this.outlet, fullPath, this._path);
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
            async handler() {
                const url = new URL(navEvent.destination.url);
                await applyRoute(routesNode, routesNode.outlet, url.pathname, this._path);
            }
        });
    }
    _onNavigate = this._onNavigateFunc.bind(this);
    async _initialize() {
        this._initialized = true;
        this._basename = this.getAttribute('basename')
            || this._getBasename()
            || '';
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
        const path = this._normalizePath(window.location.pathname);
        await applyRoute(this, this.outlet, path, this._path);
    }
    async connectedCallback() {
        if (!this._initialized) {
            await this._initialize();
        }
        getNavigation()?.addEventListener("navigate", this._onNavigate);
    }
    disconnectedCallback() {
        getNavigation()?.removeEventListener("navigate", this._onNavigate);
    }
}

class Link extends HTMLElement {
    _childNodeArray = [];
    _uuid = getUUID();
    _commentNode = document.createComment(`@@link:${this._uuid}`);
    _path = "";
    _router = null;
    _anchorElement = null;
    _initialized = false;
    constructor() {
        super();
    }
    get uuid() {
        return this._uuid;
    }
    get commentNode() {
        return this._commentNode;
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
        this.replaceWith(this._commentNode); // Link 要素自体は DOM から取り除く
        this._childNodeArray = Array.from(this.childNodes);
        this._path = this.getAttribute('to') || '';
        this._initialized = true;
    }
    connectedCallback() {
        if (!this._initialized) {
            this._initialize();
        }
        const parentNode = this._commentNode.parentNode;
        if (!parentNode) {
            raiseError(`${config.tagNames.link} comment node has no parent`);
        }
        const nextSibling = this._commentNode.nextSibling;
        const link = document.createElement('a');
        if (this._path.startsWith('/')) {
            link.href = this.router.basename + this._path;
        }
        else {
            link.href = new URL(this._path).toString();
        }
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
        this._updateActiveState();
    }
    disconnectedCallback() {
        getNavigation()?.removeEventListener('currententrychange', this._updateActiveState);
        if (this._anchorElement) {
            this._anchorElement.remove();
        }
        for (const childNode of this._childNodeArray) {
            childNode.parentNode?.removeChild(childNode);
        }
    }
    _updateActiveState = () => {
        const currentPath = new URL(window.location.href).pathname;
        const linkPath = this.router.basename + this._path;
        if (this._anchorElement) {
            if (currentPath === linkPath) {
                this._anchorElement.classList.add('active');
            }
            else {
                this._anchorElement.classList.remove('active');
            }
        }
    };
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
}

export { config, registerComponents };
//# sourceMappingURL=index.esm.js.map
