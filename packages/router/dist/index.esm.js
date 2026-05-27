const _config = {
    tagNames: {
        route: "wcs-route",
        router: "wcs-router",
        outlet: "wcs-outlet",
        layout: "wcs-layout",
        layoutOutlet: "wcs-layout-outlet",
        link: "wcs-link",
        head: "wcs-head",
        guardHandler: "wcs-guard-handler"
    },
    enableShadowRoot: false,
    basenameFileExtensions: [".html"]
};
function deepFreeze(obj) {
    if (obj === null || typeof obj !== "object")
        return obj;
    Object.freeze(obj);
    for (const key of Object.keys(obj)) {
        deepFreeze(obj[key]);
    }
    return obj;
}
function deepClone(obj) {
    if (obj === null || typeof obj !== "object")
        return obj;
    const clone = {};
    for (const key of Object.keys(obj)) {
        clone[key] = deepClone(obj[key]);
    }
    return clone;
}
let frozenConfig = null;
// 後方互換のため config もエクスポート（読み取り専用として使用）
const config = _config;
function getConfig() {
    if (!frozenConfig) {
        frozenConfig = deepFreeze(deepClone(_config));
    }
    return frozenConfig;
}
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
    frozenConfig = null;
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

function raiseError(message, options) {
    if (options && 'cause' in options) {
        throw new Error(`[@wcstack/router] ${message}`, { cause: options.cause });
    }
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
class RouteCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "params", event: "wcs-route:params-changed" },
            { name: "typedParams", event: "wcs-route:params-changed", getter: (e) => e.detail.typedParams },
            { name: "active", event: "wcs-route:active-changed" },
        ],
    };
    _target;
    _parentCore = null;
    _path = '';
    _name = '';
    _isFallbackRoute = false;
    _segmentInfos = [];
    _absoluteSegmentInfos;
    _paramNames;
    _absoluteParamNames;
    _weight;
    _absoluteWeight;
    _segmentCount;
    _params = {};
    _typedParams = {};
    _active = false;
    // Guard
    _hasGuard = false;
    _guardHandler = null;
    _guardFallbackPath = '';
    _waitForSetGuardHandler = null;
    _resolveSetGuardHandler = null;
    _guardHandlerLoadFailed = false;
    constructor(target) {
        super();
        this._target = target ?? this;
    }
    get parentCore() {
        return this._parentCore;
    }
    set parentCore(value) {
        this._parentCore = value;
    }
    get path() {
        return this._path;
    }
    get name() {
        return this._name;
    }
    get isFallbackRoute() {
        return this._isFallbackRoute;
    }
    get isRelative() {
        return !this._path.startsWith('/');
    }
    get segmentInfos() {
        return this._segmentInfos;
    }
    _checkParentCore(hasParentCallback, noParentCallback) {
        if (!this._isFallbackRoute) {
            if (this.isRelative && !this._parentCore) {
                raiseError(`${config.tagNames.route} is relative but has no parent route.`);
            }
            if (!this.isRelative && this._parentCore) {
                raiseError(`${config.tagNames.route} is absolute but has a parent route.`);
            }
        }
        if (this.isRelative && this._parentCore) {
            return hasParentCallback(this._parentCore);
        }
        else {
            return noParentCallback();
        }
    }
    get absolutePath() {
        return this._checkParentCore((parentCore) => {
            const parentPath = parentCore.absolutePath;
            return parentPath.endsWith('/')
                ? parentPath + this._path
                : parentPath + '/' + this._path;
        }, () => {
            return this._path;
        });
    }
    get absoluteSegmentInfos() {
        if (typeof this._absoluteSegmentInfos === 'undefined') {
            this._absoluteSegmentInfos = this._checkParentCore((parentCore) => {
                return [
                    ...parentCore.absoluteSegmentInfos,
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
    get active() {
        return this._active;
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
            this._absoluteParamNames = this._checkParentCore((parentCore) => {
                return [
                    ...parentCore.absoluteParamNames,
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
            this._absoluteWeight = this._checkParentCore((parentCore) => {
                return parentCore.absoluteWeight + this.weight;
            }, () => {
                return this.weight;
            });
        }
        return this._absoluteWeight;
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
        return this._checkParentCore((parentCore) => {
            return parentCore.absoluteSegmentCount + this.segmentCount;
        }, () => {
            return this.segmentCount;
        });
    }
    parsePath(path, options = {}) {
        // 連続呼び出し時のセグメント累積を防ぐためリセット
        this._segmentInfos = [];
        this._absoluteSegmentInfos = undefined;
        this._paramNames = undefined;
        this._absoluteParamNames = undefined;
        this._weight = undefined;
        this._absoluteWeight = undefined;
        this._segmentCount = undefined;
        this._path = path;
        this._name = options.name || '';
        this._isFallbackRoute = options.isFallback || false;
        if (options.isIndex) {
            this._segmentInfos.push({
                type: 'static',
                segmentText: '',
                paramName: null,
                pattern: /^$/,
                isIndex: true
            });
        }
        const segments = path.split('/');
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
            else if (segment !== '' || !options.isIndex) {
                // 空セグメントはindex以外の場合のみ追加（絶対パスの先頭 '' など）
                this._segmentInfos.push({
                    type: 'static',
                    segmentText: segment,
                    paramName: null,
                    pattern: new RegExp(`^${segment}$`)
                });
            }
        }
        this._hasGuard = options.hasGuard || false;
        if (this._hasGuard) {
            this._guardFallbackPath = options.guardFallback || '/';
            this._waitForSetGuardHandler = new Promise((resolve) => {
                this._resolveSetGuardHandler = resolve;
            });
        }
    }
    setParams(params, typedParams) {
        const wasActive = this._active;
        this._params = params;
        this._typedParams = typedParams;
        this._active = true;
        this._target.dispatchEvent(new CustomEvent("wcs-route:params-changed", {
            detail: { params, typedParams },
            bubbles: true,
        }));
        if (!wasActive) {
            this._target.dispatchEvent(new CustomEvent("wcs-route:active-changed", {
                detail: true,
                bubbles: true,
            }));
        }
    }
    clearParams() {
        const wasActive = this._active;
        this._params = {};
        this._typedParams = {};
        this._active = false;
        if (wasActive) {
            this._target.dispatchEvent(new CustomEvent("wcs-route:active-changed", {
                detail: false,
                bubbles: true,
            }));
        }
    }
    shouldChange(newParams) {
        for (const key of this.paramNames) {
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
        this._guardHandler = value;
        this._resolveSetGuardHandler?.();
    }
    /**
     * Guardハンドラのロードに失敗したことを通知し、guardCheck の待ちを解除する。
     * 解除後の guardCheck は guardHandler が未設定のため fallback パスへリダイレクトする。
     */
    notifyGuardHandlerLoadFailed() {
        this._guardHandlerLoadFailed = true;
        this._resolveSetGuardHandler?.();
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
        else if (this._hasGuard && this._guardHandlerLoadFailed) {
            // guardHandler のロードに失敗した場合は fallback パスへ
            throw new GuardCancel('Navigation cancelled: guard handler failed to load.', this._guardFallbackPath);
        }
    }
}

class Route extends HTMLElement {
    static wcBindable = RouteCore.wcBindable;
    _core;
    _routeParentNode = null;
    _routeChildNodes = [];
    _routerNode = null;
    _uuid = getUUID();
    _placeHolder = document.createComment(`@@route:${this._uuid}`);
    _childNodeArray;
    _childIndex = 0;
    _initialized = false;
    _routes;
    constructor() {
        super();
        this._core = new RouteCore(this);
    }
    // Shell-only properties
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
        // matchRoutes / testPath のホットパスで再帰的に呼ばれるため遅延キャッシュする。
        // initialize 後は routeParentNode が固定されるためキャッシュしても安全。
        if (typeof this._routes === 'undefined') {
            this._routes = this.routeParentNode
                ? this.routeParentNode.routes.concat(this)
                : [this];
        }
        return this._routes;
    }
    get childIndex() {
        return this._childIndex;
    }
    // Core delegates
    get path() {
        return this._core.path;
    }
    get name() {
        return this._core.name;
    }
    get isRelative() {
        return this._core.isRelative;
    }
    get absolutePath() {
        return this._core.absolutePath;
    }
    get segmentInfos() {
        return this._core.segmentInfos;
    }
    get absoluteSegmentInfos() {
        return this._core.absoluteSegmentInfos;
    }
    get params() {
        return this._core.params;
    }
    get typedParams() {
        return this._core.typedParams;
    }
    get paramNames() {
        return this._core.paramNames;
    }
    get absoluteParamNames() {
        return this._core.absoluteParamNames;
    }
    get weight() {
        return this._core.weight;
    }
    get absoluteWeight() {
        return this._core.absoluteWeight;
    }
    get segmentCount() {
        return this._core.segmentCount;
    }
    get absoluteSegmentCount() {
        return this._core.absoluteSegmentCount;
    }
    get fullpath() {
        return this.absolutePath;
    }
    get guardHandler() {
        return this._core.guardHandler;
    }
    set guardHandler(value) {
        this._core.guardHandler = value;
    }
    setParams(params, typedParams) {
        this._core.setParams(params, typedParams);
    }
    clearParams() {
        this._core.clearParams();
    }
    shouldChange(newParams) {
        return this._core.shouldChange(newParams);
    }
    async guardCheck(matchResult) {
        return this._core.guardCheck(matchResult);
    }
    notifyGuardHandlerLoadFailed() {
        this._core.notifyGuardHandlerLoadFailed();
    }
    /**
     * Shell（Route）の routeParentNode を辿って祖先関係を判定する。
     *
     * 責務の分担:
     * - Route（このクラス）は DOM ツリー上の親子関係（routeParentNode）を管理する。
     * - RouteCore はパスやパラメータといった論理的な親子関係（parentCore）を管理する。
     * DOM ツリーは Shell 層、論理ツリーは Core 層という分離のため、両者を独立に保持する。
     */
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
    initialize(routerNode, routeParentNode) {
        if (this._initialized) {
            return;
        }
        this._initialized = true;
        // 属性からパス情報を読み取り
        let path;
        let isIndex = false;
        let isFallback = false;
        if (this.hasAttribute('path')) {
            path = this.getAttribute('path') || '';
        }
        else if (this.hasAttribute('index')) {
            path = '';
            isIndex = true;
        }
        else if (this.hasAttribute('fallback')) {
            path = '';
            isFallback = true;
        }
        else {
            raiseError(`${config.tagNames.route} should have a "path" or "index" attribute.`);
        }
        // ルートツリーの構築
        this._routerNode = routerNode;
        this._routeParentNode = routeParentNode;
        const routeChildContainer = routeParentNode || routerNode;
        routeChildContainer.routeChildNodes.push(this);
        this._childIndex = routeChildContainer.routeChildNodes.length - 1;
        // Fallback検証
        if (isFallback) {
            if (routeParentNode) {
                raiseError(`${config.tagNames.route} with fallback attribute must be a direct child of ${config.tagNames.router}.`);
            }
            if (routerNode.fallbackRoute) {
                raiseError(`${config.tagNames.router} can have only one fallback route.`);
            }
            routerNode.fallbackRoute = this;
        }
        // 親CoreをCoreに設定
        if (routeParentNode) {
            this._core.parentCore = routeParentNode._core;
        }
        // Coreでパス解析
        this._core.parsePath(path, {
            isIndex,
            isFallback,
            hasGuard: this.hasAttribute('guard'),
            guardFallback: this.getAttribute('guard'),
            name: this.getAttribute('name') || '',
        });
        this.setAttribute('fullpath', this.absolutePath);
    }
}

const cache = new Map();
class Layout extends HTMLElement {
    _uuid = getUUID();
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
            // 元の例外を cause として伝播し、スタックトレースを保持する
            raiseError(`${config.tagNames.layout} failed to load layout from source: ${source}, error: ${error}`, { cause: error });
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
                // _loadTemplateFromSource は内部で cache.set を実行する
                template.innerHTML = await this._loadTemplateFromSource(source) || '';
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
    /**
     * shadowRoot 有効化判定。Layout と挙動を揃え、属性で個別オーバーライド可能にする。
     * - `enable-shadow-root` 属性あり → true
     * - `disable-shadow-root` 属性あり → false
     * - いずれもなし → config.enableShadowRoot を尊重
     */
    _resolveEnableShadowRoot() {
        if (this.hasAttribute('enable-shadow-root')) {
            return true;
        }
        if (this.hasAttribute('disable-shadow-root')) {
            return false;
        }
        return config.enableShadowRoot;
    }
    _initialize() {
        if (this._resolveEnableShadowRoot()) {
            this.attachShadow({ mode: 'open' });
        }
        this._initialized = true;
    }
    connectedCallback() {
        if (!this._initialized) {
            this._initialize();
        }
    }
    /**
     * Outlet が disconnect された際の状態クリーンアップ。
     *
     * `_lastRoutes` をクリアすることで、再接続後の applyRoute における diff
     * （既に show 済みのルートは show を skip する判定）が、切断中に外部から
     * 操作された DOM と整合しなくなる事故を防ぐ。
     *
     * 仕様前提として Outlet は Router と一体運用される（Router が `_getOutlet()` で
     * 自身の兄弟に Outlet を配置・参照する）。それでも単独で再接続される
     * エッジケースに備える防衛的措置として `_lastRoutes` のみクリアする。
     * `_initialized` と shadowRoot は維持し、再 attachShadow による
     * InvalidStateError を回避する。
     */
    disconnectedCallback() {
        this._lastRoutes = [];
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
                // null/undefined は属性削除として扱う（文字列 "null"/"undefined" になる事故を防ぐ）。
                // boolean/number は setAttribute の標準挙動に従って文字列化される。
                if (value === null || value === undefined) {
                    element.removeAttribute(key);
                }
                else {
                    element.setAttribute(key, String(value));
                }
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
        // 注意: customElements.whenDefined(tag) は当該タグが define されるまで pending のままになる。
        // element が削除されてもこの Promise は GC されず、closure に保持される element/params は
        // 解放されない（弱い参照を持つ手段がないため）。define されないまま要素のみが大量に作られる
        // ようなケースではリークになりうるが、通常の Web Components 利用では autoloader が
        // 一括 define するため実用上問題にならない。明示的にキャンセルしたい場合は将来 AbortSignal を
        // サポートすることを検討する。
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
    _initializing = false;
    _disconnectedDuringInit = false;
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
        this._initializing = true;
        try {
            this._initialized = true;
            // attachShadow は冪等にする: 一度 await loadTemplate() 中に切断されると
            // _initialized = false で戻され、再 connect 時に _initialize() が再度走るが、
            // その時点で shadowRoot は既に存在しているため、再度 attachShadow すると
            // InvalidStateError になる。
            if (this.layout.enableShadowRoot && !this.shadowRoot) {
                this.attachShadow({ mode: 'open' });
            }
            const template = await this.layout.loadTemplate();
            // await 中に切断された場合は DOM 副作用を残さず、次回再接続時に再初期化させる
            if (!this.isConnected) {
                this._initialized = false;
                return;
            }
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
        finally {
            this._initializing = false;
        }
    }
    async connectedCallback() {
        if (!this._initialized) {
            this._disconnectedDuringInit = false;
            await this._initialize();
            // 初期化中（await 中）に切断された場合は副作用を残さない
            if (this._disconnectedDuringInit || !this.isConnected) {
                return;
            }
        }
    }
    disconnectedCallback() {
        // _initialize 中（await 中）に呼ばれた場合はフラグを立てて再 connect 時に init を許可する
        if (this._initializing) {
            this._disconnectedDuringInit = true;
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

async function importModule(script, route) {
    let scriptModule = null;
    let firstError = null;
    // devtools での識別用 sourceURL suffix。
    // uuid を使う: Route インスタンスでは constructor で getUUID() により必ず設定される。
    // partial mock 等で undefined の可能性に備えて空文字列フォールバックを置く。
    const routeTag = route.uuid || "";
    const sourceURL = routeTag ? `wcs-guard-handler:${routeTag}` : `wcs-guard-handler`;
    const sourceComment = `\n//# sourceURL=${sourceURL}\n`;
    const scriptText = script.text + sourceComment;
    if (typeof URL.createObjectURL === 'function') {
        const blob = new Blob([scriptText], { type: "application/javascript" });
        const url = URL.createObjectURL(blob);
        try {
            scriptModule = await import(url);
        }
        catch (e) {
            // Blob URL import failed (e.g. happy-dom), fall through to data: URL
            firstError = e;
        }
        finally {
            URL.revokeObjectURL(url);
        }
    }
    if (!scriptModule) {
        // Fallback: Base64 data: URL (for test environments)
        const b64 = btoa(String.fromCodePoint(...new TextEncoder().encode(scriptText)));
        try {
            scriptModule = await import(`data:application/javascript;base64,${b64}`);
        }
        catch (e) {
            // 両 import が失敗した場合、Blob URL 側の元エラーを cause として失わないように包む
            // （Blob URL も失敗していなければ firstError は null）
            throw new Error(`loadGuardHandler: failed to import guard script. ` +
                `data: URL error: ${e?.message ?? String(e)}` +
                (firstError ? `. Blob URL error: ${firstError?.message ?? String(firstError)}` : ''), { cause: firstError ?? e });
        }
    }
    if (scriptModule && typeof scriptModule.default === 'function') {
        return scriptModule.default;
    }
    return null;
}
function loadGuardHandler(script, route) {
    importModule(script, route).then(handler => {
        if (handler) {
            route.guardHandler = handler;
        }
        else {
            // ハンドラが取得できなかった場合は guardCheck の待ちを解除する
            route.notifyGuardHandlerLoadFailed();
        }
    }).catch(err => {
        console.error('loadGuardHandler failed:', err);
        // import 失敗時も guardCheck の待ちを解除する
        route.notifyGuardHandlerLoadFailed();
    });
}

/**
 * 同一の絶対パスを持つ Route が複数定義された場合に警告を出力する。
 *
 * 仕様: 同一 absolutePath ごとに 1 回だけ警告する（複数重複でも警告は 1 件）。
 * これは過剰なログを避けるための意図的な設計。
 * テストでは Vitest の console.warn spy で 1 回出力を確認する。
 */
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
async function _parseNode(routerNode, node, routes, routesByPath) {
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
                appendNode = route.placeHolder;
                element = route;
            }
            else if (tagName === config.tagNames.guardHandler) {
                if (routes.length > 0) {
                    const route = routes[routes.length - 1];
                    const script = element.querySelector('script[type="module"]');
                    if (script) {
                        loadGuardHandler(script, route);
                    }
                }
                continue;
            }
            else if (tagName === config.tagNames.layout) {
                // <wcs-layout> は他の case と異なり element と appendNode が別物になる。
                // - element: cloneElement (Layout 本体)。後続の `element.innerHTML = ""; element.appendChild(children)`
                //   で再帰結果が Layout 内に流し込まれる。Layout はそれを slot 投影に使う。
                // - appendNode: layoutOutlet。最終的に fragment へ挿入されるのは layoutOutlet で、
                //   layoutOutlet が element (Layout) を参照して投影を行う。
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
            const children = await _parseNode(routerNode, element, routes, routesByPath);
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
    const routesByPath = new Map();
    const fr = await _parseNode(routerNode, routerNode.template.content, [], routesByPath);
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

function _matchRoutes(routeNode, normalizedPath, segments, results) {
    const matchResult = testPath(routeNode, normalizedPath, segments);
    if (matchResult) {
        results.push(matchResult);
    }
    for (const childRoute of routeNode.routeChildNodes) {
        _matchRoutes(childRoute, normalizedPath, segments, results);
    }
}
function matchRoutes(routerNode, normalizedPath) {
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
        _matchRoutes(route, normalizedPath, segments, results);
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
    const params = {};
    const typedParams = {};
    for (const key of route.paramNames) {
        params[key] = matchResult.params[key];
        typedParams[key] = matchResult.typedParams[key];
    }
    route.setParams(params, typedParams);
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

/**
 * ルートコンテンツを表示する。
 *
 * @returns ガードチェックを通過してコンテンツ表示が成立した場合 true、
 *          GuardCancel により中断（フォールバックへ再ナビゲート）した場合 false。
 *          呼び出し側（applyRoute）は false の場合、router.path / outlet.lastRoutes を
 *          更新しないことで「拒否されたパスでの path-changed 発火」を防ぐ。
 */
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
        if (e instanceof GuardCancel) {
            console.warn(`Navigation cancelled: ${e.message}. Redirecting to ${e.fallbackPath}`);
            queueMicrotask(() => {
                routerNode.navigate(e.fallbackPath).catch((err) => {
                    console.error('Fallback navigation failed:', err);
                });
            });
            return false;
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
    return true;
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
    const committed = await showRouteContent(routerNode, matchResult, lastRoutes);
    // GuardCancel により中断された場合は state を更新しない
    // （拒否されたパスでの wcs-router:path-changed 発火を防ぐため）
    if (!committed)
        return;
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

// basenameFileExtensions ベースの正規表現をキャッシュ（config 変更時のみ再生成）。
let _cachedExtensions = null;
let _cachedExtPattern = null;
/**
 * config.basenameFileExtensions から拡張子削除用の正規表現を生成（キャッシュ付き）。
 * config 変更が検知された場合のみ再生成する。
 */
function getExtPattern() {
    const exts = config.basenameFileExtensions;
    if (exts.length === 0)
        return null;
    if (_cachedExtensions === exts && _cachedExtPattern) {
        return _cachedExtPattern;
    }
    _cachedExtensions = exts;
    _cachedExtPattern = new RegExp(`\\/[^/]+(?:${exts.map(e => e.replace(/\./g, '\\.')).join('|')})$`, 'i');
    return _cachedExtPattern;
}
/**
 * URL pathname を route path に正規化する。
 * - 先頭スラッシュを保証
 * - 連続スラッシュを単一化
 * - 末尾のファイル拡張子（例: .html）をディレクトリルートとして扱う
 * - ルート以外の末尾スラッシュを除去
 */
function normalizePathname(path) {
    let p = path || "/";
    if (!p.startsWith("/"))
        p = "/" + p;
    p = p.replace(/\/{2,}/g, "/");
    const extPattern = getExtPattern();
    if (extPattern) {
        p = p.replace(extPattern, "");
    }
    if (p === "")
        p = "/";
    if (p.length > 1 && p.endsWith("/"))
        p = p.slice(0, -1);
    return p;
}
/**
 * basename を正規化する。
 * - "" or "/" -> ""
 * - "/app/" -> "/app"
 * - "/app/index.html" -> "/app"
 */
function normalizeBasename(path) {
    let p = path || "";
    if (!p)
        return "";
    if (!p.startsWith("/"))
        p = "/" + p;
    p = p.replace(/\/{2,}/g, "/");
    const extPattern = getExtPattern();
    if (extPattern) {
        p = p.replace(extPattern, "");
    }
    if (p.length > 1 && p.endsWith("/"))
        p = p.slice(0, -1);
    if (p === "/")
        return "";
    return p;
}

/**
 * AppRoutes - Root component for @wcstack/router
 *
 * Container element that manages route definitions and navigation.
 */
class Router extends HTMLElement {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "navigateUrl", event: "wcs-router:navigate-url-changed" },
            { name: "path", event: "wcs-router:path-changed" },
        ],
        inputs: [
            { name: "basename", attribute: "basename" },
        ],
        commands: [
            { name: "navigate", async: true },
        ],
    };
    _outlet = null;
    _template = null;
    _routeChildNodes = [];
    _basename = '';
    _path = '';
    _initialized = false;
    _fallbackRoute = null;
    _listeningPopState = false;
    _listeningNavigate = false;
    _navigateUrl = null;
    _disconnectedDuringInit = false;
    _initializing = false;
    constructor() {
        super();
    }
    /**
     * Normalize a URL pathname to a route path.
     * 共通実装は normalizePathname.ts を参照（Link との挙動整合のため）。
     */
    _normalizePathname(_path) {
        return normalizePathname(_path);
    }
    /**
     * Normalize basename.
     * 共通実装は normalizePathname.ts を参照。
     */
    _normalizeBasename(_path) {
        return normalizeBasename(_path);
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
    get basename() {
        return this._basename;
    }
    _getOutlet() {
        // 自身を起点に兄弟・子孫から Outlet を探す（マルチ Router 対応）
        const next = this.nextElementSibling;
        if (next && next.matches(config.tagNames.outlet)) {
            return next;
        }
        // なければ新規作成して自身の直後に挿入
        const outlet = createOutlet();
        if (this.parentNode) {
            this.parentNode.insertBefore(outlet, this.nextSibling);
        }
        else {
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
        const changed = this._path !== value;
        this._path = value;
        if (changed) {
            this.dispatchEvent(new CustomEvent("wcs-router:path-changed", {
                detail: value,
                bubbles: true,
            }));
        }
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
    get navigateUrl() {
        return this._navigateUrl;
    }
    set navigateUrl(value) {
        if (value === null || value === undefined || value === "")
            return;
        // 既に同一 URL の navigate 中なら再起動しない
        if (this._navigateUrl === value)
            return;
        this._navigateUrl = value;
        this.navigate(value).catch((err) => {
            console.error(`${config.tagNames.router} navigate failed:`, err);
        }).finally(() => {
            this._navigateUrl = null;
            this.dispatchEvent(new CustomEvent("wcs-router:navigate-url-changed", {
                detail: null,
                bubbles: true,
            }));
        });
    }
    async navigate(path) {
        const fullPath = this._joinInternalPath(this._basename, path);
        const navigation = getNavigation();
        if (navigation?.navigate) {
            // Navigation API は { committed, finished } を返す。
            // finished を await することで、navigate() の Promise が
            // 実際のナビゲーション完了まで pending となり、_navigateUrl の
            // 二重 navigate ガード (setter 内 `if (this._navigateUrl === value)`) が
            // 適切な時間ウィンドウで機能するようになる。
            // Polyfill や mock 環境で undefined / 戻り値なしのケースもあるため optional chaining。
            await navigation.navigate(fullPath)?.finished;
        }
        else {
            history.pushState(null, '', fullPath);
            await applyRoute(this, this.outlet, fullPath, this._path);
            this._notifyLocationChange();
        }
    }
    /**
     * basename 配下の URL かどうかを判定する。
     * basename が空の場合はすべての URL にマッチする。
     */
    _isOwnPath(fullPath) {
        if (this._basename === "")
            return true;
        return fullPath === this._basename || fullPath.startsWith(this._basename + "/");
    }
    _onNavigateFunc(navEvent) {
        if (!navEvent.canIntercept ||
            navEvent.hashChange ||
            navEvent.downloadRequest !== null) {
            return;
        }
        const url = new URL(navEvent.destination.url);
        const fullPath = this._normalizePathname(url.pathname);
        // basename 配下でない URL は無視（マルチ Router 対応）
        if (!this._isOwnPath(fullPath))
            return;
        const routesNode = this;
        navEvent.intercept({
            handler: async () => {
                try {
                    await applyRoute(routesNode, routesNode.outlet, fullPath, routesNode.path);
                }
                catch (err) {
                    console.error(`${config.tagNames.router} applyRoute failed:`, err);
                    throw err;
                }
            },
        });
    }
    _onNavigate = this._onNavigateFunc.bind(this);
    _onPopState = async () => {
        // back/forward for environments without Navigation API
        const fullPath = this._normalizePathname(window.location.pathname);
        // basename 配下でない URL は無視（マルチ Router 対応）
        if (!this._isOwnPath(fullPath))
            return;
        await applyRoute(this, this.outlet, fullPath, this._path);
        this._notifyLocationChange();
    };
    async _initialize() {
        this._initializing = true;
        try {
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
            this._initialized = true;
        }
        finally {
            this._initializing = false;
        }
    }
    async connectedCallback() {
        if (!this._initialized) {
            this._disconnectedDuringInit = false;
            await this._initialize();
            // 初期化中に disconnectedCallback が呼ばれた場合はイベントリスナを登録しない
            if (this._disconnectedDuringInit) {
                return;
            }
        }
        const navigation = getNavigation();
        if (navigation && !this._listeningNavigate) {
            navigation.addEventListener("navigate", this._onNavigate);
            this._listeningNavigate = true;
        }
        // Fallback for browsers without Navigation API
        if (!navigation && !this._listeningPopState) {
            window.addEventListener("popstate", this._onPopState);
            this._listeningPopState = true;
        }
    }
    disconnectedCallback() {
        // _initialize 中（await 中）に呼ばれた場合はフラグを立ててリスナ登録をスキップさせる
        if (this._initializing) {
            this._disconnectedDuringInit = true;
        }
        if (this._listeningNavigate) {
            getNavigation()?.removeEventListener("navigate", this._onNavigate);
            this._listeningNavigate = false;
        }
        if (this._listeningPopState) {
            window.removeEventListener("popstate", this._onPopState);
            this._listeningPopState = false;
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
    /**
     * 最寄りの Router を返す。
     *
     * 注意: この getter は DOM 走査で Router を探すため、
     * Router がまだ upgrade されていない場合は HTMLElement として返る可能性がある。
     * 通常は registerComponents() で Router を Link より先に upgrade することを推奨する。
     */
    get router() {
        if (this._router) {
            return this._router;
        }
        // DOM 祖先走査で最寄りの Router を探す（マルチ Router 対応）
        const ancestor = this.closest(config.tagNames.router);
        if (ancestor) {
            return (this._router = ancestor);
        }
        // 祖先にない場合は ownerDocument 内の Router を探す
        const root = this.getRootNode();
        const found = root.querySelector?.(config.tagNames.router);
        if (found) {
            return (this._router = found);
        }
        raiseError(`${config.tagNames.link} is not connected to a router.`);
    }
    _initialize() {
        this.style.display = "none";
        this._childNodeArray = Array.from(this.childNodes);
        this._path = this.getAttribute('to') || '';
        this._initialized = true;
    }
    /**
     * URL pathname を正規化する。Router と共通実装を使うことで
     * basenameFileExtensions の取り扱いを揃え、active 判定の取りこぼしを防ぐ。
     */
    _normalizePathname(path) {
        return normalizePathname(path);
    }
    _joinInternalPath(basename, to) {
        // Router._joinInternalPath と挙動を揃える
        const base = normalizeBasename(basename);
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
                // 動的に外部URLに変わった場合はブラウザのデフォルト挙動に委ねる
                if (!this._path.startsWith('/'))
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
        const anchor = this._anchorElement;
        if (anchor) {
            if (this._onClick) {
                anchor.removeEventListener('click', this._onClick);
                this._onClick = undefined;
            }
            anchor.remove();
            this._anchorElement = null;
        }
        // anchor 配下のままだった子要素のみ取り除く（別の親に移動されていた場合に誤って strip しないため）
        for (const childNode of this._childNodeArray) {
            if (anchor && childNode.parentNode === anchor) {
                anchor.removeChild(childNode);
            }
        }
        // Router キャッシュをクリア。別の Router 配下に動的に移動された場合や
        // Router 自体が入れ替わった場合に古い参照を返さないようにする。
        this._router = null;
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
 *
 * 設計仕様: `initialHeadCaptured` は最初の Head 接続時に一度だけ true になる。
 * SPA ライフタイム中の初期 head 状態は、最初の Head が接続された瞬間がベースラインで、
 * それ以降に追加された <head> 要素は「初期値」ではなく「現在の値」として扱う。
 * テストや SPA リセットで初期値を再キャプチャしたい場合は `_resetHeadStack()` を呼ぶ。
 */
const initialHeadValues = new Map();
let initialHeadCaptured = false;
/**
 * 要素ごとの `_getKey` 結果のキャッシュ。
 * 初期化時/キャプチャ時に算出し、以降の `_reapplyHead` ループで再計算しないようにする。
 * 要素の属性変更には追随しない（Head 内要素は初期化時に固定される前提）。
 */
const keyCache = new WeakMap();
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
     * 要素の一意キーを生成（WeakMap でキャッシュ）
     */
    _getKey(el) {
        const cached = keyCache.get(el);
        if (cached !== undefined) {
            return cached;
        }
        const key = this._computeKey(el);
        keyCache.set(el, key);
        return key;
    }
    /**
     * 要素の一意キーを計算（実体）
     */
    _computeKey(el) {
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
        if (tag === 'script') {
            const src = el.getAttribute('src') || '';
            const id = el.getAttribute('id') || '';
            const type = el.getAttribute('type') || '';
            if (src || id) {
                return `script:${src}:${id}:${type}`;
            }
            // インライン script はおおまかな先頭で識別（同等性は完全一致でなく簡易判定）
            return `script::${type}:${el.outerHTML.slice(0, 100)}`;
        }
        if (tag === 'style') {
            const id = el.getAttribute('id') || '';
            const media = el.getAttribute('media') || '';
            if (id) {
                return `style:${id}:${media}`;
            }
            // インライン style はおおまかな先頭で識別（同等性は完全一致でなく簡易判定）
            return `style::${media}:${el.outerHTML.slice(0, 100)}`;
        }
        // その他要素はおおまかに識別（同等性は完全一致でなく簡易判定）
        return `${tag}:${el.outerHTML.slice(0, 100)}`;
    }
    /**
     * head 内の要素を key で引ける Map を構築する。
     * `_reapplyHead` のループ前に一度だけ呼び出し、O(N) lookup に置き換えるためのヘルパ。
     *
     * 設計仕様: 同一 key の要素が複数 `document.head` 内に存在する場合は **first-wins**
     * （DOM 順で最初の要素のみ採用）。これは `_captureInitialHead` および
     * `initialHeadValues` の挙動とも整合する。
     * 重複は基本的にユーザーの記述ミスだが、_getKey の粒度（href/name 等の主要属性のみ）に
     * よる「論理的重複」もあり得るため、サイレントに first-wins とする。
     * 厳密な重複検出が必要な場合は呼び出し側で行う。
     */
    _buildHeadElementMap() {
        const map = new Map();
        for (const el of Array.from(document.head.children)) {
            const key = this._getKey(el);
            if (!map.has(key)) {
                map.set(key, el);
            }
        }
        return map;
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
        // 同時に key -> Element の lookup map も構築する（O(N²) を避けるため）
        const headElementMap = this._buildHeadElementMap();
        for (const key of headElementMap.keys()) {
            allKeys.add(key);
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
            const current = headElementMap.get(key) ?? null;
            if (targetElement) {
                if (current) {
                    current.replaceWith(targetElement);
                }
                else {
                    document.head.appendChild(targetElement);
                }
                // map を新しい要素に更新（後続の同 key 処理に備える）
                headElementMap.set(key, targetElement);
            }
            else {
                // 初期値もスタックにもない場合は削除
                current?.remove();
                headElementMap.delete(key);
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

var version = "1.11.0";
var pkg = {
	version: version};

const VERSION = pkg.version;

export { Route, RouteCore, Router, VERSION, bootstrapRouter, getConfig };
//# sourceMappingURL=index.esm.js.map
