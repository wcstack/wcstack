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
/**
 * NOTE: RouteCore / Route は `static wcBindable` を**宣言しない**
 * （docs/router-state-contract-design.md §5.1 / D2）。
 *
 * `<wcs-route>` は parse 時に clone された detached コントローラであり、live DOM に
 * 入るのは placeholder コメントとスタンプされた子ノードだけ。data-wcs は live DOM
 * 上の属性走査で結線する仕組みなので、宣言しても構造的に到達不能な「果たせない
 * 約束」になる。params / typedParams / routeName の観測面は live DOM に居る
 * `<wcs-router>` に集約した（Router.wcBindable）。
 *
 * `wcs-route:params-changed` / `wcs-route:active-changed` の dispatch は存置する —
 * RouteCore は EventTarget であり、Core 直接消費（signals の正式推奨形）と
 * ユニットテストの観測面として生きている。
 */
class RouteCore extends EventTarget {
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
    /**
     * guard 属性の有無（parsePath の options.hasGuard）。SSR の guard バリア
     * — guard 付きルートはサーバーで描かない（docs/ssr-router-design.md §2-4）—
     * がハンドラのロードを待たずに判定するために使う。
     */
    get hasGuard() {
        return this._hasGuard;
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

// NOTE: `static wcBindable` は宣言しない — RouteCore.ts 冒頭の NOTE を参照
// （docs/router-state-contract-design.md §5.1 / D2）。
class Route extends HTMLElement {
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
    /**
     * SSR ハイドレーションの採用（docs/ssr-router-design.md §4）。
     * サーバー描画済みの DOM ノード列をこのルートの内容として引き取る。
     * 以後の hideRoute / showRoute は採用ノードに対して従来どおり動く。
     * template 由来の fresh クローン（自身の childNodes）は不要になるため破棄する。
     */
    adoptChildNodes(nodes) {
        this._childNodeArray = [...nodes];
        while (this.firstChild) {
            this.removeChild(this.firstChild);
        }
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
    get hasGuard() {
        return this._core.hasGuard;
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

const CSP_GUIDE = "https://github.com/wcstack/wcstack/blob/main/docs/csp.md";
/**
 * ガードスクリプトの評価失敗を、原因の分かるメッセージに変換する。
 *
 * CSP にブロックされた動的 import の rejection は CSP に一切言及しないため、
 * ブロックされた事実は securitypolicyviolation の観測（`cspBlocked`）でしか取れない。
 * 真ならブロック確定として対処方法を書き、偽なら構文エラー等と区別できないので
 * 元のエラーを主にして CSP は参照先を添えるに留める。
 *
 * ガードは state と違ってインライン専用（`<wcs-route>` 直下の `<script>`）なので、
 * `src=` に逃がすという回避策が無い。CSP を敷くなら blob: の許可が必須になる。
 */
function describeImportFailure(error, firstError, cspBlocked) {
    if (cspBlocked) {
        return `The guard <script> was blocked by Content-Security-Policy. ` +
            `Guard scripts are inline-only and are evaluated through a blob: URL, ` +
            `so script-src must allow blob:. See ${CSP_GUIDE}`;
    }
    return `loadGuardHandler: failed to import guard script. ` +
        `data: URL error: ${error?.message ?? String(error)}` +
        (firstError ? `. Blob URL error: ${firstError?.message ?? String(firstError)}` : '') +
        `. If this page sets a Content-Security-Policy, see ${CSP_GUIDE}`;
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
    // import() の失敗が CSP 由来かを判別するため、評価の間だけ違反を購読する。
    // blob: と data: はどちらも script-src で拒否されるので、両分岐を1つの観測で覆える。
    let cspBlocked = false;
    const onViolation = (event) => {
        if (event.effectiveDirective.startsWith("script-src")) {
            cspBlocked = true;
        }
    };
    document.addEventListener("securitypolicyviolation", onViolation);
    try {
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
                raiseError(describeImportFailure(e, firstError, cspBlocked), { cause: firstError ?? e });
            }
        }
    }
    finally {
        document.removeEventListener("securitypolicyviolation", onViolation);
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
            else if (tagName === "template") {
                // 不透明な葉として扱う。<template> の子は childNodes ではなく .content に
                // 居るため、汎用の再構築（_parseNode → innerHTML = "" → appendChild）に
                // 通すと content が空になり、ルート内容に書かれた state の構造テンプレート
                // （for / if）を黙って破壊する。route 定義は template の中には置けない
                // （inert）ので、中を辿る理由も無い。
                fragment.appendChild(element);
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

/**
 * route commit 後のオプトイン a11y ポリシー適用（docs/a11y-design.md §3-4 / D1〜D3）。
 *
 * 呼び出しは applyRoute の committed 判定後・mutate() の外・初回描画
 * （lastRoutes が空）を除く。guard 拒否はここに到達しない（D4）。
 *
 * - `announce="title"`: commit 時点の document.title のスナップショットを
 *   live region へ書き込む（D2）。<wcs-head> の静的 title は mutate() 内で同期に
 *   差し替わるため、ここでは必ず新ルートの値が読める。バインド title の遅延窓・
 *   ナビゲーション外の title 変化には追従しない（README の明記された制限）。
 * - `focus="heading"`: リーフ route が挿入した内容の最初の h1〜h6 に
 *   tabindex="-1" を付けて focus() する。見出し不在時は何もしない — 旧フォーカス
 *   要素が遷移で消えていればブラウザが body へ落とすため、結果は仕様既定の
 *   focusReset と同等に収束する（§3-4 の規定）。
 */
function applyA11yPolicies(routerNode, matchResult) {
    if (routerNode.announcePolicy === "title") {
        const region = routerNode.a11yRegion;
        if (region !== null) {
            region.textContent = document.title;
        }
    }
    if (routerNode.focusPolicy === "heading") {
        // matchRoutes / fallbackRoute の構成上 routes は常に 1 件以上
        const leaf = matchResult.routes[matchResult.routes.length - 1];
        const heading = findFirstHeading(leaf.childNodeArray);
        if (heading !== null) {
            if (!heading.hasAttribute("tabindex")) {
                heading.setAttribute("tabindex", "-1");
            }
            heading.focus();
        }
    }
}
/**
 * リーフ route のトップレベルノード列を document order で走査し、最初の見出しを
 * 返す。祖先 route の内容へは遡らない — 読者が「新しい画面」と認識する単位は
 * リーフである（docs/a11y-design.md §3-4）。ルート内容は Comment placeholder の
 * 兄弟として挿入されるため安定した「箱」が無く、内容から探すのが唯一の現実解。
 */
function findFirstHeading(nodes) {
    for (const node of nodes) {
        if (node.nodeType !== Node.ELEMENT_NODE)
            continue;
        const element = node;
        if (/^H[1-6]$/.test(element.tagName)) {
            return element;
        }
        const descendant = element.querySelector("h1,h2,h3,h4,h5,h6");
        if (descendant !== null) {
            return descendant;
        }
    }
    return null;
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
            // 全セグメントが消費された。
            // 末尾スラッシュ（例: /users/）は matchRoutes 側で処理済み: normalizePathname が
            // ルート以外の末尾スラッシュを除去し、matchRoutes の filter が末尾の空セグメントを
            // 落とすため、testPath に渡る segments に末尾 '' は含まれない。よってここで
            // 末尾スラッシュ用の分岐は不要（trailing-slash の結合テストは matchRoutes.test.ts 参照）。
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
 * fullPath から basename を取り除いた route path を返す。
 *
 * applyRoute のマッチング入力と same-match 判定
 * （docs/router-state-contract-design.md §4.4）で共有する。same-match の比較は
 * **basename スライス後の path 同士**で行う規範 — `router.path` に格納されるのは
 * スライス後のパスであり、スライス前の fullPath と比較すると basename 運用で
 * same-match が決して成立しない。
 */
function sliceBasename(fullPath, basename) {
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
    return sliced === "" ? "/" : sliced;
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

function hideRoute(route) {
    route.clearParams();
    for (const node of route.childNodeArray) {
        node.parentNode?.removeChild(node);
    }
}

/**
 * ルートへのパラメータ割り当て（setParams + 内容ノードへの data-bind /
 * LayoutOutlet 配送）。挿入とは独立に呼べるよう showRoute から抽出 —
 * SSR ハイドレーション（採用時は内容が既に DOM に居るため挿入しない）が
 * 同じ配送規則を共有する（docs/ssr-router-design.md §4）。
 *
 * connectedCallback が呼ばれる前に、プロパティにパラメータを割り当てる必要が
 * あるため（挿入時にパラメータはすでに設定されている必要がある）、showRoute は
 * これを挿入より先に呼ぶ。
 */
function assignRouteParams(route, matchResult) {
    const params = {};
    const typedParams = {};
    for (const key of route.paramNames) {
        params[key] = matchResult.params[key];
        typedParams[key] = matchResult.typedParams[key];
    }
    route.setParams(params, typedParams);
    for (const node of route.childNodeArray) {
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
    }
}
function showRoute(route, matchResult) {
    assignRouteParams(route, matchResult);
    const parentNode = route.placeHolder.parentNode;
    const nextSibling = route.placeHolder.nextSibling;
    for (const node of route.childNodeArray) {
        if (nextSibling) {
            parentNode?.insertBefore(node, nextSibling);
        }
        else {
            parentNode?.appendChild(node);
        }
    }
    return true;
}

// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /protocol/transition-runner.ts by scripts/sync-protocol-types.mjs.
// Run `node scripts/sync-protocol-types.mjs` after editing the source.
// ===========================================================================
// transition-runner protocol — how a package that mutates the DOM hands that
// mutation to whoever is arbitrating view transitions on the page.
//
// @wcstack/state and @wcstack/router must not depend on @wcstack/view-transition
// (zero runtime dependencies, independently publishable), so the arbiter installs
// itself on a well-known global symbol and the participants look it up lazily.
// No arbiter installed means the mutation is invoked directly, synchronously —
// byte-for-byte the behavior these packages had before the protocol existed.
//
// docs/view-transition-design.md §4 is the normative description.
//
// SINGLE SOURCE OF TRUTH: edit only this file (/protocol/transition-runner.ts), then run
// `node scripts/sync-protocol-types.mjs` to regenerate the per-package copies
// (packages/<pkg>/src/protocol/transitionRunner.ts). Those copies are generated — do not edit them.
/**
 * Global key the arbiter installs itself under. `Symbol.for` so independently
 * loaded copies of this file (two CDN bundles on one page) still agree.
 */
const TRANSITION_RUNNER_KEY = Symbol.for("wcstack.transition-runner");
/**
 * The installed arbiter, or null when there is none, it speaks a version this
 * reader does not, or it does not accept this participant.
 *
 * Looked up on every call rather than cached: the tag can be added, removed, or
 * reconfigured at any point in a page's life, and a stale cache would either
 * animate what the author just switched off or miss what they switched on.
 */
function getTransitionRunner(source) {
    const candidate = globalThis[TRANSITION_RUNNER_KEY];
    if (candidate === undefined || candidate === null)
        return null;
    if (candidate.protocol !== "wcs-transition-runner")
        return null;
    if (typeof candidate.version !== "number" || candidate.version < 1)
        return null;
    if (typeof candidate.run !== "function")
        return null;
    if (typeof candidate.accepts !== "function" || !candidate.accepts(source))
        return null;
    return candidate;
}
/**
 * Run `mutate` under the installed arbiter, or directly when there is none.
 *
 * Returns `undefined` in the no-arbiter case instead of a resolved promise: the
 * state drain calls this on every batch, and awaiting is a caller's choice, not
 * an allocation the common path should pay for. `await` accepts both.
 */
function runTransition(source, mutate, types) {
    const runner = getTransitionRunner(source);
    if (runner === null) {
        mutate();
        return undefined;
    }
    return runner.run(mutate, { source, types });
}

// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /protocol/binder.ts by scripts/sync-protocol-types.mjs.
// Run `node scripts/sync-protocol-types.mjs` after editing the source.
// ===========================================================================
// binder protocol — how a package that inserts DOM hands those nodes to whoever
// owns data bindings on the page.
//
// The dual of transition-runner: that one hands a *mutation* to whoever animates
// it, this one hands *new nodes* to whoever binds them.
//
// A `data-wcs` binding exists only for nodes @wcstack/state walked when it built
// its bindings. Nodes that arrive later — the content of a route that was not
// active at that moment, a <wcs-head> child reflected into <head> — were never
// walked, so their bindings silently do nothing, however often they are inserted.
// @wcstack/router must not depend on @wcstack/state (zero runtime dependencies,
// independently publishable), so state installs a binder on a well-known global
// symbol and inserters look it up lazily.
//
// No binder installed means nothing happens — byte-for-byte the behavior these
// packages had before the protocol existed.
//
// docs/binder-protocol-design.md is the normative description.
//
// SINGLE SOURCE OF TRUTH: edit only this file (/protocol/binder.ts), then run
// `node scripts/sync-protocol-types.mjs` to regenerate the per-package copies
// (packages/<pkg>/src/protocol/binder.ts). Those copies are generated — do not edit them.
/**
 * Global key the binder installs itself under. `Symbol.for` so independently
 * loaded copies of this file (two CDN bundles on one page) still agree.
 */
const BINDER_KEY = Symbol.for("wcstack.binder");
/**
 * The installed binder, or null when there is none or it speaks a version this
 * reader does not.
 *
 * Looked up on every call rather than cached, for the same reason
 * transition-runner does: the page's composition can change at any point, and a
 * stale cache would keep calling into a binder that is no longer there.
 */
function getBinder() {
    const candidate = globalThis[BINDER_KEY];
    if (candidate === undefined || candidate === null)
        return null;
    if (candidate.protocol !== "wcs-binder")
        return null;
    if (typeof candidate.version !== "number" || candidate.version < 1)
        return null;
    if (typeof candidate.bind !== "function")
        return null;
    return candidate;
}
/**
 * Subtrees offered before a binder existed, and the set of everything a binder
 * has taken. Both live on global symbols so that independently loaded copies of
 * this file — the router's and state's — share one queue.
 *
 * The queue is needed because of load order: the router's auto bundle runs
 * before state's, so `<wcs-head>` reflects its children into `<head>` while
 * there is still nothing to bind them. Offering them to a binder that arrives
 * later is the difference between working and silently blank.
 */
const PENDING_KEY = Symbol.for("wcstack.binder.pending");
const TAKEN_KEY = Symbol.for("wcstack.binder.taken");
function pendingQueue() {
    const globals = globalThis;
    let queue = globals[PENDING_KEY];
    if (queue === undefined) {
        queue = [];
        globals[PENDING_KEY] = queue;
    }
    return queue;
}
function takenSet() {
    const globals = globalThis;
    let taken = globals[TAKEN_KEY];
    if (taken === undefined) {
        taken = new WeakSet();
        globals[TAKEN_KEY] = taken;
    }
    return taken;
}
/**
 * Hand `subtree` to the installed binder, or hold it for one that arrives later.
 *
 * Returns whether a binder took it *now*. A `false` does not yet mean the markup
 * is doomed — check {@link wasBoundBy} once module scripts have run.
 */
function bindSubtree(subtree) {
    const binder = getBinder();
    if (binder === null) {
        pendingQueue().push(subtree);
        return false;
    }
    takenSet().add(subtree);
    binder.bind(subtree);
    return true;
}
/** Whether any binder has taken this subtree. */
function wasBoundBy(subtree) {
    return takenSet().has(subtree);
}

/**
 * 「後から差し込んだノードのバインドは効かない」ことを loud に報告する。
 *
 * `data-wcs` のバインドは、`@wcstack/state` がバインドを構築した時点で document に
 * 居たノードにしか作られない。router が後から差し込むノード —— 非活性ルートの内容
 * （`hideRoute` が切り離しているので走査されない）と `<wcs-head>` が head へ映す
 * クローン（元ノードとは別物）—— はどちらもその時点に存在せず、バインドは決して
 * 届かない。何度ナビゲーションを往復しても回復しない。
 *
 * **挙動は変えない。** 変えるのは「黙って空になる」を「原因を指す警告」にすること
 * だけである。症状（見出しが空・`<title>` が消える）は原因（バインド構築の時点）から
 * 遠く、しかも例外も出ないため、これまで気づく手立てが無かった。
 *
 * 恒久的な解決は binder プロトコル（docs/binder-protocol-design.md）で別途決める。
 *
 * 警告は要素ごとに 1 回。壊れている場合にのみ走るので、正常系のコストはゼロ。
 */
const warned = new WeakSet();
/** `data-wcs`。router は state の config を読めないので既定名を直接持つ */
const BIND_ATTRIBUTE = "data-wcs";
function hasBinding(element) {
    return element.hasAttribute(BIND_ATTRIBUTE) || element.querySelector(`[${BIND_ATTRIBUTE}]`) !== null;
}
/**
 * @param element 差し込まれるサブツリーの根
 * @param where   利用者が原因を特定できる位置の説明（例: `<wcs-route path="/about">`）
 * @param remedy  その位置に固有の回避策
 */
function warnUnboundMarkup(element, where, remedy) {
    if (warned.has(element) || !hasBinding(element)) {
        return;
    }
    warned.add(element);
    // 判定は **DOMContentLoaded まで**遅らせる。router の auto バンドルは state の
    // ものより先に走るので、`<wcs-head>` が差し出す時点では binder がまだ居ない。
    // そこで即断すると、この直後に正しく束ねられるノードを「壊れている」と報告する。
    //
    // タイマーでは足りない。deferred な module script はパース完了後に実行されるので、
    // `setTimeout(0)` は state の auto バンドルより**先に発火しうる**（実測）。
    // DOMContentLoaded は全 deferred script の実行後に発火するので、そこでは決着している。
    //
    // 見るのは「束ね終わったか」ではなく **binder が居るか**。バインド構築は
    // インライン state モジュールの読み込みを挟むので完了はさらに後になりうるが、
    // binder が居るなら保留キューはいずれ引き取られるので報告する理由が無い。
    whenLoadOrderSettled(() => {
        if (getBinder() !== null || wasBoundBy(element)) {
            return;
        }
        console.warn(`[@wcstack/router] ${where} contains ${BIND_ATTRIBUTE} bindings that will never be applied. ` +
            `A binding exists only for nodes that were in the document when @wcstack/state built its ` +
            `bindings, and these nodes were not. They will render empty. ${remedy}`);
    });
}
function whenLoadOrderSettled(check) {
    if (document.readyState !== "complete") {
        // `load` を待つ。`DOMContentLoaded` では足りない —— deferred script の実行中は
        // readyState が既に `"interactive"` なので「まだ loading か」では判別できず、
        // DOMContentLoaded を待つつもりが即断になる（実測）。`load` は必ず発火し、
        // 全 deferred script より確実に後に来る。診断なので多少遅くて構わない。
        window.addEventListener("load", check, { once: true });
        return;
    }
    // 起動後の挿入（ナビゲーション）。読み込み順はとうに決着している。
    check();
}

/**
 * 差し込んだルート内容を binder へ渡す。binder が居なければ、バインドが効かない
 * ことを 1 回だけ報告する。
 *
 * 挿入の**後**に呼ぶ。`bind()` は初期値の適用まで同期で行うので、挿入前に呼ぶと
 * まだ document に居ないノードを走査することになる。
 *
 * binder が居ないのは state を読み込んでいないページで、そこでは `data-wcs` が
 * そもそも動かない。報告に直し方まで書くのは、これが仕様の穴ではなく**分担の
 * 境界**だからである（examples/router-spa と examples/router-i18n が同じ分担）。
 */
function bindRouteContent(route) {
    for (const node of route.childNodeArray) {
        if (node.nodeType !== 1)
            continue;
        if (bindSubtree(node))
            continue;
        warnUnboundMarkup(node, `<${node.tagName.toLowerCase()}> inside a route`, `Load @wcstack/state on this page, or render data-driven markup outside ` +
            `<wcs-router> — bind the router's \`path\` into state and gate the markup ` +
            `with <template data-wcs="if: …">. See examples/router-i18n.`);
    }
}
/**
 * ガード相の単独実装。何も触らずに全ルートの guardCheck を待ち、GuardCancel なら
 * フォールバックへの再ナビゲートを microtask で予約して false を返す。
 *
 * showRouteContent の相 1 であると同時に、SSR ハイドレーション
 * （docs/ssr-router-design.md §4 — 採用はレンダリング最適化であって認可の
 * スキップではない）からも同じ規則で呼ばれるため抽出した。
 */
async function runGuardPhase(routerNode, matchResult) {
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
    return true;
}
/**
 * ルートコンテンツを表示する。
 *
 * 二相構成（docs/view-transition-design.md §7.1）:
 *   1. ガード相 — 何も触らずに全ルートの guardCheck を待つ。
 *   2. 変更相 — 旧ルートの hide と新ルートの show を「ひとまとまりの DOM 変更」
 *      として transition arbiter に渡す。arbiter が居なければ同期実行され、
 *      従来と同じ挙動になる。ただし初回描画は渡さない（下記）。
 *
 * ガードを変更相の中に入れないのは、更新コールバックの中で任意の await を
 * 走らせると遷移が開きっぱなしになるため（ブラウザの猶予は約 4 秒）。
 * 相を分けたことで「ガードが拒否したのに旧ルートだけ先に消えている」という
 * 順序の歪みも同時に解消している。
 *
 * @returns ガードチェックを通過してコンテンツ表示が成立した場合 true、
 *          GuardCancel により中断（フォールバックへ再ナビゲート）した場合 false。
 *          呼び出し側（applyRoute）は false の場合、router.path / outlet.lastRoutes を
 *          更新しないことで「拒否されたパスでの path-changed 発火」を防ぐ。
 */
async function showRouteContent(routerNode, matchResult, lastRoutes) {
    // --- ガード相 ---
    if (!(await runGuardPhase(routerNode, matchResult))) {
        return false;
    }
    // --- 変更相 ---
    const routesSet = new Set(matchResult.routes);
    const lastRouteSet = new Set(lastRoutes);
    const mutate = () => {
        // Hide previous routes
        for (const route of lastRoutes) {
            if (!routesSet.has(route)) {
                hideRoute(route);
            }
        }
        let force = false;
        for (const route of matchResult.routes) {
            if (!lastRouteSet.has(route) || route.shouldChange(matchResult.params) || force) {
                force = showRoute(route, matchResult);
                // 挿入の後。初回描画（lastRoutes が空）の内容は state のバインド構築時に
                // document に居るので、そこは binder に渡す必要も報告する必要も無い。
                // `bind()` 自体は冪等なので渡しても壊れないが、渡さないほうが安い。
                if (lastRoutes.length > 0 && !lastRouteSet.has(route)) {
                    bindRouteContent(route);
                }
            }
        }
    };
    // 初回描画（＝置き換える旧ルートが無い）は遷移に渡さない。state 側の
    // 「初期レンダリングは決して包まない、包むのは drain だけ」と同じ規則で、
    // 理由も同じ: 差し替えではなく入場であり、対比すべき旧状態が無い。入場は
    // @starting-style の担当（docs/view-transition-design.md §1）。
    //
    // これは好みの問題ではない。router の初期化は最初のルート適用を await するが、
    // その時点のドキュメントはまだ最初の描画を終えていない。そこで開始した遷移は
    // Chromium で更新コールバックが呼ばれないまま留まることがあり、_initialize が
    // 永久に解決しなくなる（ページが白いまま・path が空のまま）。実ブラウザでのみ
    // 再現するので e2e/tests/view-transition.spec.ts が唯一の回帰テストになる。
    let pending;
    if (lastRoutes.length === 0) {
        mutate();
    }
    else {
        pending = runTransition("router", mutate);
    }
    // arbiter が居ないときは同期適用済みで undefined が返る。そこで await すると
    // 無条件に 1 tick 増えて、既存のナビゲーション完了タイミングが変わってしまう。
    if (pending !== undefined) {
        await pending;
    }
    return true;
}

/**
 * ルートを適用する。返り値は committed — guard 拒否（GuardCancel）で中断された
 * 場合のみ false。呼び出し側はこれで commit 後の処理（フォールバック経路の
 * スクロール等）をゲートできる（docs/a11y-design.md §3-2 / D4）。
 *
 * `search` は現在 URL のクエリ（"?k=v" 形式または ""）。隠れた `window.location`
 * 読みにせず呼び出し元が明示供給する（docs/router-state-contract-design.md §3.6 —
 * テスト容易性と権威の明示のため）。
 */
async function applyRoute(routerNode, outlet, fullPath, lastPath, search = "") {
    const path = sliceBasename(fullPath, routerNode.basename);
    // same-match 高速パス（docs/router-state-contract-design.md §4.4）。
    // guard はルートへの進入を守るものであり、クエリ変化は進入ではない —
    // matchRoutes / guard 相 / showRouteContent をスキップし、transition-runner にも
    // 渡さず（DOM mutation が無いのに arbiter へ空遷移を依頼しない）、a11y の
    // 再アナウンスもしない。search を commit し、§3.4 の規範で発火する
    // （この場合 search-changed のみが発火し得る）。
    if (routerNode.isSameMatch(path)) {
        routerNode.commitNavigation({
            params: routerNode.params,
            typedParams: routerNode.typedParams,
            routeName: routerNode.routeName,
            search,
            path,
        });
        return true;
    }
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
        return false;
    // if successful, update router and outlet state
    // routeName は最深マッチの name。fallback 時は fallback ルートの name（D8）。
    routerNode.commitNavigation({
        params: matchResult.params,
        typedParams: matchResult.typedParams,
        routeName: matchResult.routes[matchResult.routes.length - 1]?.name ?? "",
        search,
        path,
    });
    outlet.lastRoutes = matchResult.routes;
    // オプトインの focus/announce は commit 直後・mutate() の外で適用する（D3）。
    // 初回描画（lastRoutes が空）では動かない — ページロードはブラウザの担当で、
    // view-transition の「初回は包まない」と同じ判定・同じ理由（§3-5）。
    // guard 拒否は上の return false で既に抜けている（D4）。
    if (lastRoutes.length > 0) {
        applyA11yPolicies(routerNode, matchResult);
    }
    return true;
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
 * searchParams の正規化（docs/router-state-contract-design.md §3.5）。
 *
 * - 読み取り形状は `Record<string, string>`。`URLSearchParams` の生ハンドルは
 *   露出しない（生ハンドルを state に入れない規範）。
 * - キー重複（`?tag=a&tag=b`）は **last-wins**。
 * - 値のデコードは `URLSearchParams` に委ねる（`+` → space を含む）。
 * - 露出オブジェクトは freeze したスナップショット（消費側の変異は loud failure）。
 */
function parseSearchParams(search) {
    const result = {};
    for (const [key, value] of new URLSearchParams(search)) {
        result[key] = value;
    }
    return Object.freeze(result);
}
/**
 * Record の shallow 比較。params の変化判定（§3.3: 文字列値の shallow 比較）と
 * searchParams の変化判定（§3.5: キーをソートした pair 列の比較 = 順序非依存）に
 * 共通で使う。
 */
function shallowEqualRecords(a, b) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length)
        return false;
    for (const key of aKeys) {
        if (!Object.prototype.hasOwnProperty.call(b, key))
            return false;
        if (a[key] !== b[key])
            return false;
    }
    return true;
}

function splitUrlTarget(to) {
    let rest = to;
    let hash = "";
    const hashIndex = rest.indexOf("#");
    if (hashIndex >= 0) {
        hash = rest.slice(hashIndex);
        rest = rest.slice(0, hashIndex);
    }
    let search = "";
    const searchIndex = rest.indexOf("?");
    if (searchIndex >= 0) {
        search = rest.slice(searchIndex);
        rest = rest.slice(0, searchIndex);
    }
    return { pathname: rest, search, hash };
}
/**
 * URL 再結合時の search。`?` 単独は「クエリの全消去」の合図なので "" にする。
 */
function effectiveSearch(search) {
    return search === "?" ? "" : search;
}

// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /protocol/upgrade-properties.ts by scripts/sync-protocol-types.mjs.
// Run `node scripts/sync-protocol-types.mjs` after editing the source.
// ===========================================================================
function hasAccessorOnPrototype(target, name) {
    let proto = Object.getPrototypeOf(target);
    while (proto !== null) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, name);
        if (descriptor !== undefined) {
            return typeof descriptor.get === "function" || typeof descriptor.set === "function";
        }
        proto = Object.getPrototypeOf(proto);
    }
    return false;
}
/**
 * `connectedCallback` の先頭で呼ぶ。宣言済み input のうち upgrade 前の代入で
 * accessor をシャドウしている own プロパティを、delete → 再代入で setter に通し直す。
 *
 * - 冪等: 再代入は accessor を通るので own プロパティは残らず、2 回目以降は no-op。
 * - 宣言に `inputs` が無い要素、`wcBindable` を持たない要素では何もしない。
 * - 値の意味は変えない。今まで捨てられていた代入が届くようになる一方向の変化。
 */
function upgradeProperties(element) {
    const declaration = element.constructor?.wcBindable;
    const inputs = declaration?.inputs;
    if (inputs === undefined)
        return;
    for (const input of inputs) {
        const name = input.name;
        if (!Object.prototype.hasOwnProperty.call(element, name))
            continue;
        if (!hasAccessorOnPrototype(element, name))
            continue;
        const record = element;
        const value = record[name];
        delete record[name];
        record[name] = value;
    }
}

/**
 * SSR モード判定。@wcstack/server の renderToString がレンダリング中の document
 * 要素へ `data-wcs-server` 属性を設定する。state 側（packages/state/src/config.ts の
 * inSsr）と同じ規約 — パッケージ間 import はせず、属性規約で合意する
 * （docs/ssr-router-design.md §3.2）。
 *
 * キャッシュしない: SSR モードはプロセスの属性ではなく「現在の document」の属性。
 * サーバーレンダリングの後、同一プロセスでクライアント側の起動（SSR→hydrate の
 * e2e）が走り得るため、呼び出しごとに現在の document を見る。
 */
function inSsr() {
    const html = document.documentElement;
    return html ? html.hasAttribute('data-wcs-server') : false;
}

/**
 * SSR ハイドレーションマーカー（docs/ssr-router-design.md §3.3 / §4）。
 *
 * サーバー（_renderForSsr）が書き、クライアント（_hydrateFromSsr / Link の採用）が
 * 読む。キーは route の absolutePath — placeholder の UUID はパースごとに再生成され
 * サーバーとクライアントで一致しないため、同一 template から決定的に導ける
 * absolutePath だけが突合キーになれる。
 */
/** サーバー描画済み outlet の目印（要素属性） */
const SSR_OUTLET_ATTR = 'data-wcs-ssr';
/** Link がサーバーで生成した anchor の目印（要素属性）。クライアントが採用して外す */
const SSR_LINK_ATTR = 'data-wcs-ssr-link';
/** route placeholder コメントの安定キー形式（`@@wcs-route-ph:<absolutePath>`） */
const ROUTE_PH_PREFIX = '@@wcs-route-ph:';
/** 表示中ルート内容の開始マーカー（`@@wcs-route-start:<absolutePath>`） */
const ROUTE_START_PREFIX = '@@wcs-route-start:';
/** 表示中ルート内容の終了マーカー（`@@wcs-route-end:<absolutePath>`） */
const ROUTE_END_PREFIX = '@@wcs-route-end:';

const EMPTY_RECORD = Object.freeze({});
/**
 * AppRoutes - Root component for @wcstack/router
 *
 * Container element that manages route definitions and navigation.
 */
class Router extends HTMLElement {
    /**
     * @wcstack/server の待機プロトコル（docs/ssr-router-design.md §3.2）。
     * renderToString はこのフラグを持つ要素の connectedCallbackPromise を待って
     * からシリアライズする — 初期ルート適用の完了がサーバー出力に反映される。
     */
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "navigateUrl", event: "wcs-router:navigate-url-changed", semantics: "state" },
            { name: "replaceUrl", event: "wcs-router:replace-url-changed", semantics: "state" },
            { name: "path", event: "wcs-router:path-changed", semantics: "state" },
            // 観測面（docs/router-state-contract-design.md §3.1）— output-only
            // （properties のみ・inputs に無い）。state 側の既存規範により authority は
            // element（attach 時に要素の現在値を読む）となり、state→element 書き込みは
            // 恒久ブロックされる。params-changed の detail は { params, typedParams }
            // なので、両プロパティとも getter で分派する。
            { name: "params", event: "wcs-router:params-changed", semantics: "state",
                getter: (e) => e.detail.params },
            { name: "typedParams", event: "wcs-router:params-changed", semantics: "state",
                getter: (e) => e.detail.typedParams },
            { name: "searchParams", event: "wcs-router:search-changed", semantics: "state" },
            { name: "routeName", event: "wcs-router:route-name-changed", semantics: "state" },
        ],
        // `navigateUrl` は observable output であると同時に settable な書き込み面でもある
        // （setter が navigate() を起動し、完了後に自分で null へ戻す）。properties にだけ
        // 宣言すると binding core は output-only とみなし、state → element の書き込みを
        // 抑止するため、state 経由のプログラム遷移が成立しなくなる。`path` は setter が
        // navigate せず内部値の反映だけなので、意図的に output のままにしている。
        inputs: [
            { name: "basename", attribute: "basename" },
            { name: "navigateUrl" },
            { name: "replaceUrl" },
        ],
        commands: [
            { name: "navigate", async: true },
            { name: "replace", async: true },
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
    _replaceUrl = null;
    _disconnectedDuringInit = false;
    _initializing = false;
    _a11yRegion = null;
    // 観測面の内部値（docs/router-state-contract-design.md §3）。露出オブジェクトは
    // frozen スナップショット — params は router の所有物であり、消費側の変異は
    // silent corruption ではなく loud failure にする。
    _params = EMPTY_RECORD;
    _typedParams = EMPTY_RECORD;
    _searchParams = EMPTY_RECORD;
    _routeName = '';
    /** 最初の成功 commit を通過したか（§4.4 の初回ガード） */
    _hasCommitted = false;
    _connectedCallbackPromise;
    _resolveConnectedCallback = null;
    _rejectConnectedCallback = null;
    constructor() {
        super();
        this._connectedCallbackPromise = new Promise((resolve, reject) => {
            this._resolveConnectedCallback = resolve;
            this._rejectConnectedCallback = reject;
        });
        // 初期化の失敗は reject として配管するが、この Promise は readiness プロトコルの
        // 消費者（renderToString / @wcstack/testing の mount）が居るときだけ await される。
        // 誰も await しない通常のページやユニットテストで reject を「未処理」として
        // 報告させないよう、ここで観測済みにしておく。await する側には従来どおり
        // reject が届く（別の consumer が付いても settled 結果は共有される）。
        this._connectedCallbackPromise.catch(() => { });
    }
    get connectedCallbackPromise() {
        return this._connectedCallbackPromise;
    }
    get a11yRegion() {
        return this._a11yRegion;
    }
    get focusPolicy() {
        return this.getAttribute('focus');
    }
    get announcePolicy() {
        return this.getAttribute('announce');
    }
    /**
     * `announce=` 用 live region を <wcs-router> 直下に空のまま用意する
     * （docs/a11y-design.md §3-4）。
     * - 告知より**前**から DOM に居ないと SR に読まれないため、announce 時の
     *   遅延生成はできない。
     * - outlet 配下はナビゲーションごとに破棄され、オプトインで shadow root にも
     *   なる。document.body 直下は router の寿命を超えて漏れ、マルチ router で
     *   競合する。よって配置は <wcs-router> 直下の一択。
     * - display:none は live region を殺すため、sr-only クリップで隠す。
     */
    _ensureA11yRegion() {
        if (this._a11yRegion !== null) {
            return;
        }
        const region = document.createElement('div');
        region.setAttribute('role', 'status');
        region.style.position = 'absolute';
        region.style.width = '1px';
        region.style.height = '1px';
        region.style.overflow = 'hidden';
        region.style.clipPath = 'inset(50%)';
        region.style.whiteSpace = 'nowrap';
        this.appendChild(region);
        this._a11yRegion = region;
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
    get params() {
        return this._params;
    }
    get typedParams() {
        return this._typedParams;
    }
    get searchParams() {
        return this._searchParams;
    }
    get routeName() {
        return this._routeName;
    }
    /**
     * same-match 判定（docs/router-state-contract-design.md §4.4）。
     *
     * 比較は **basename スライス後の path 同士**（`_path` はスライス後で保存済み）。
     * 判定が必要な地点は 2 箇所 — `_onNavigateFunc` の intercept オプション決定時と
     * `applyRoute` の入口分岐 — で、両方がこの単一実装を呼ぶ。
     *
     * 初回ガード: 最初の成功 commit より前には適用しない。初期 `_path = ""` が
     * 正規化後パス（常に `/` 始まり）と一致しないため偶然安全だが、
     * normalizePathname の実装詳細に依存させず規範として明示する。
     */
    isSameMatch(path) {
        if (!this._hasCommitted)
            return false;
        return this._path === path;
    }
    /**
     * 観測面のコミットと発火（docs/router-state-contract-design.md §3.4）。
     *
     * 全内部値を先にコミットし、その後で初めてイベントを発火する — どのイベントの
     * リスナーから要素プロパティを読んでも、遷移後スナップショットの一貫した値が
     * 見える。発火順序は params → route-name → search → path。`path` を最後に
     * 置くのは、既存例で `path` が「ナビゲーション完了」の信号として使われている
     * ため。各イベントは変化した commit のみ発火する。
     */
    commitNavigation(commit) {
        const nextParams = Object.freeze({ ...commit.params });
        const nextTypedParams = Object.freeze({ ...commit.typedParams });
        const nextSearchParams = parseSearchParams(commit.search);
        const paramsChanged = !shallowEqualRecords(this._params, nextParams);
        const routeNameChanged = this._routeName !== commit.routeName;
        const searchChanged = !shallowEqualRecords(this._searchParams, nextSearchParams);
        const pathChanged = this._path !== commit.path;
        // --- 先に全内部値をコミット ---
        // 変化した面だけ差し替える（ナビゲーションごとに新しいオブジェクトになるので
        // state の same-value guard を正しく通過する。不変の面は同一性を保つ）。
        if (paramsChanged) {
            this._params = nextParams;
            this._typedParams = nextTypedParams;
        }
        if (routeNameChanged) {
            this._routeName = commit.routeName;
        }
        if (searchChanged) {
            this._searchParams = nextSearchParams;
        }
        this._path = commit.path;
        this._hasCommitted = true;
        // --- その後で発火（順序規範: params → route-name → search → path） ---
        if (paramsChanged) {
            this.dispatchEvent(new CustomEvent("wcs-router:params-changed", {
                detail: { params: this._params, typedParams: this._typedParams },
                bubbles: true,
            }));
        }
        if (routeNameChanged) {
            this.dispatchEvent(new CustomEvent("wcs-router:route-name-changed", {
                detail: this._routeName,
                bubbles: true,
            }));
        }
        if (searchChanged) {
            this.dispatchEvent(new CustomEvent("wcs-router:search-changed", {
                detail: this._searchParams,
                bubbles: true,
            }));
        }
        if (pathChanged) {
            this.dispatchEvent(new CustomEvent("wcs-router:path-changed", {
                detail: commit.path,
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
    get replaceUrl() {
        return this._replaceUrl;
    }
    /**
     * navigateUrl と完全同型の null-idle transient（docs/router-state-contract-design.md §4.2）。
     * null は待機・書き込みで replace() を起動・完了で自己リセットして
     * `wcs-router:replace-url-changed`（detail: null）を発火する。
     */
    set replaceUrl(value) {
        if (value === null || value === undefined || value === "")
            return;
        // 既に同一 URL の replace 中なら再起動しない
        if (this._replaceUrl === value)
            return;
        this._replaceUrl = value;
        this.replace(value).catch((err) => {
            console.error(`${config.tagNames.router} replace failed:`, err);
        }).finally(() => {
            this._replaceUrl = null;
            this.dispatchEvent(new CustomEvent("wcs-router:replace-url-changed", {
                detail: null,
                bubbles: true,
            }));
        });
    }
    async navigate(path) {
        await this._performNavigation(path, false);
    }
    /**
     * navigateUrl（push）の対になる replace 遷移（docs/router-state-contract-design.md §4.2）。
     * Navigation API では `navigation.navigate(url, { history: "replace" })`、
     * フォールバックでは `history.replaceState` + applyRoute + 通知。
     */
    async replace(path) {
        await this._performNavigation(path, true);
    }
    async _performNavigation(path, replace) {
        // クエリ / ハッシュ込みターゲットの受理（docs/router-state-contract-design.md §4.1）。
        // normalizePathname / basename 結合は pathname にのみ適用し、search / hash は
        // 再結合して URL に渡す。pathname 空（"?k=v" / "?" / "#x"）は現在の pathname を
        // 維持する。search / hash まで空（navigate("")）は従来どおりルート扱い。
        const target = splitUrlTarget(path);
        const fullPath = target.pathname === "" && (target.search !== "" || target.hash !== "")
            ? window.location.pathname
            : this._joinInternalPath(this._basename, target.pathname);
        const url = fullPath + effectiveSearch(target.search) + target.hash;
        const navigation = getNavigation();
        if (navigation?.navigate) {
            // Navigation API は { committed, finished } を返す。
            // finished を await することで、navigate() の Promise が
            // 実際のナビゲーション完了まで pending となり、_navigateUrl / _replaceUrl の
            // 二重起動ガード (setter 内の同一値チェック) が適切な時間ウィンドウで機能する。
            // Polyfill や mock 環境で undefined / 戻り値なしのケースもあるため optional chaining。
            const result = replace
                ? navigation.navigate(url, { history: "replace" })
                : navigation.navigate(url);
            await result?.finished;
        }
        else {
            if (replace) {
                history.replaceState(null, '', url);
            }
            else {
                history.pushState(null, '', url);
            }
            // セグメントマッチにはクエリ・ハッシュを渡さない（渡すと 404 に落ちる —
            // §1.1 欠陥 6 の修理）。search は明示引数で供給する（§3.6）。
            const normalizedFullPath = this._normalizePathname(fullPath);
            const sameMatch = this.isSameMatch(sliceBasename(normalizedFullPath, this._basename));
            const committed = await applyRoute(this, this.outlet, normalizedFullPath, this._path, effectiveSearch(target.search));
            // 修理・既定オン（docs/a11y-design.md §3-2）: Navigation API 経路の仕様既定
            // （scroll: "after-transition" — push はトップへ）とフォールバック経路を揃える。
            // guard 拒否（committed === false）では動かさない。_onPopState 側は
            // history.scrollRestoration によるブラウザ復元が正解なので、決してスクロールしない。
            // same-match（クエリのみ遷移）でも動かさない — 1 打鍵ごとにトップへ戻る事故の
            // 防止（docs/router-state-contract-design.md §4.4）。
            if (committed && !sameMatch) {
                window.scrollTo(0, 0);
            }
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
        // same-match 判定は applyRoute 内の分岐と同じ共有実装（§4.4: スライス後比較）。
        // intercept オプションは applyRoute 実行前に決める必要があるためここでも判定する。
        const sameMatch = this.isSameMatch(sliceBasename(fullPath, this._basename));
        // scroll は navigationType で分岐する: push / replace の same-match は "manual"
        // （検索ボックスにバインドした書き込みの 1 打鍵ごとにスクロールがトップへ戻る
        // 事故の防止）。traverse（戻る/進む）は仕様既定 = ブラウザのスクロール位置復元を
        // 維持する — ?page=2 から戻る操作でスクロールが固定される事故を防ぐ。
        const sameMatchScrollManual = sameMatch &&
            (navEvent.navigationType === "push" || navEvent.navigationType === "replace");
        const search = url.search;
        const routesNode = this;
        navEvent.intercept({
            handler: async () => {
                try {
                    await applyRoute(routesNode, routesNode.outlet, fullPath, routesNode.path, search);
                }
                catch (err) {
                    console.error(`${config.tagNames.router} applyRoute failed:`, err);
                    throw err;
                }
            },
            // 仕様既定の明示（same-match 以外は挙動変更なし）。scroll: push はトップへ /
            // traverse はスクロール位置復元、focusReset: [autofocus] か body へ。この委譲が
            // router のアクセシビリティ契約であり、ここを "manual" に変える変更は
            // 契約の変更にあたる（docs/a11y-design.md §3-1）。same-match の扱いは
            // docs/router-state-contract-design.md §4.4 / D6b。
            scroll: sameMatchScrollManual ? "manual" : "after-transition",
            // focus= 指定時のみ manual。渡さないと router のフォーカス移動とブラウザの
            // after-transition リセットが二重処理になる（docs/a11y-design.md §3-5）。
            // same-match は常に manual — 1 打鍵ごとにフォーカスが body へ飛ぶ事故の防止。
            focusReset: sameMatch || routesNode.focusPolicy !== null ? "manual" : "after-transition",
        });
    }
    _onNavigate = this._onNavigateFunc.bind(this);
    _onPopState = async () => {
        // back/forward for environments without Navigation API
        const fullPath = this._normalizePathname(window.location.pathname);
        // basename 配下でない URL は無視（マルチ Router 対応）
        if (!this._isOwnPath(fullPath))
            return;
        // search は明示引数で供給（§3.6）。mock / 特殊環境で欠ける場合は "" 扱い
        await applyRoute(this, this.outlet, fullPath, this._path, window.location.search || "");
        this._notifyLocationChange();
    };
    async _initialize() {
        this._initializing = true;
        try {
            const ssr = inSsr();
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
            // SSR: parse は template.content を破壊的に消費する（route 要素は中身を
            // 移された抜け殻になり、非 route ノードは fragment へ移動する）。
            // シリアライズ出力に完全なルート定義を残してクライアントが従来どおり
            // 起動できるよう、退避してパース後に復元する（docs/ssr-router-design.md §3.2）。
            const templateSnapshot = ssr ? this._template.content.cloneNode(true) : null;
            const fragment = await parse(this);
            // クライアント側でサーバー描画済み outlet（data-wcs-ssr）を見つけたら
            // 採用（adoption）を試みる。fragment はまだ入れない — 採用が成立すれば
            // fresh クローンは不要で、失敗したときだけ従来どおり流し込む（§4）。
            const adoptable = !ssr &&
                this._outlet.hasAttribute(SSR_OUTLET_ATTR);
            if (!adoptable) {
                this._outlet.rootNode.appendChild(fragment);
            }
            if (templateSnapshot !== null) {
                const content = this._template.content;
                while (content.firstChild) {
                    content.removeChild(content.firstChild);
                }
                content.appendChild(templateSnapshot);
            }
            if (this.routeChildNodes.length === 0) {
                raiseError(`${config.tagNames.router} has no route definitions.`);
            }
            if (!ssr) {
                // 最初のナビゲーションより十分前に accessibility tree へ載せておく。
                // サーバーでは作らない — 初回描画はアナウンスしない既存規則により不要で、
                // 作るとクライアントの初期化が二重生成する（docs/ssr-router-design.md §3.2）。
                this._ensureA11yRegion();
            }
            const fullPath = this._normalizePathname(window.location.pathname);
            if (ssr) {
                await this._renderForSsr(fullPath);
                this._initialized = true;
                return;
            }
            if (adoptable) {
                const hydrated = await this._hydrateFromSsr(fullPath);
                if (hydrated) {
                    this._notifyLocationChange();
                    this._initialized = true;
                    return;
                }
                // 採用不能: サーバー DOM を破棄して従来経路で描き直す。安全側は常に CSR
                // （state の hydrateBindings →失敗→ buildBindings と同じ二段構え、§2-3）。
                const outletEl = this._outlet;
                outletEl.removeAttribute(SSR_OUTLET_ATTR);
                const rootNode = this._outlet.rootNode;
                while (rootNode.firstChild) {
                    rootNode.removeChild(rootNode.firstChild);
                }
                rootNode.appendChild(fragment);
            }
            await applyRoute(this, this.outlet, fullPath, this._path, window.location.search || "");
            if (adoptable || getBinder() !== null) {
                // 初期描画の内容を binder へ差し出す。
                // - adoptable（描き直し）: state がサーバー DOM を既にハイドレート済み（初期走査
                //   完了後）の場合、破棄と同時にそのバインドは死んでいる。
                // - binder が既に居る: state の初回走査が router の挿入より先に完了し得る
                //   （`json=` の state は I/O 無しで走査を終える。/auto の文書順ではなく
                //   bootstrap を先に済ませてから HTML を流し込むテストハーネス
                //   — @wcstack/testing の mount() — で起きる。_renderForSsr と同じ理由）。
                //   bind() は冪等なので、走査に間に合っていた分を再度渡しても壊れない。
                // binder が居なければ渡さない: state を読まないページで保留キューに
                // ノードを溜め続けないため（後から来る state は走査で拾う）。
                this._offerInitialContentToBinder();
            }
            this._notifyLocationChange();
            this._initialized = true;
        }
        finally {
            this._initializing = false;
        }
    }
    /**
     * サーバー描画済み outlet の採用（docs/ssr-router-design.md §4）。
     *
     * 検証（一意な absolutePath・マーカーの整合・現在 URL のマッチとの一致）を
     * **すべて DOM 変更の前に**行い、途中で断念しても半採用状態を残さない。
     * 成立すれば DOM 変更ゼロで「すでにナビゲート済み」の状態を確立する —
     * state がハイドレートしたバインディングは採用ノード上で生きたままになる。
     *
     * @returns 採用が成立した場合 true。false は呼び出し側（_initialize）が
     *          サーバー DOM を破棄して従来描画にフォールバックする。
     */
    async _hydrateFromSsr(fullPath) {
        const outletRoot = this.outlet.rootNode;
        // --- 検証相 ---
        // absolutePath → route の一意対応。重複定義（parse が警告するケース）は
        // マーカーの突合キーが曖昧になるため採用不能
        const routesByPath = new Map();
        let duplicated = false;
        this._forEachRoute((route) => {
            if (routesByPath.has(route.absolutePath)) {
                duplicated = true;
                return;
            }
            routesByPath.set(route.absolutePath, route);
        });
        if (duplicated)
            return false;
        // layout は採用の初版スコープ外 — slot 投影の状態はマーカーだけでは
        // 再構築できない（§4）。検出したらフォールバック
        if (outletRoot.querySelector(config.tagNames.layoutOutlet) !== null) {
            return false;
        }
        // マーカー走査（文書順の添字も記録し、start < end と範囲交差の検証に使う）
        const phByPath = new Map();
        const startByPath = new Map();
        const endByPath = new Map();
        const walker = document.createTreeWalker(outletRoot, NodeFilter.SHOW_COMMENT);
        let index = 0;
        while (walker.nextNode()) {
            const comment = walker.currentNode;
            const data = comment.data;
            index++;
            if (data.startsWith(ROUTE_PH_PREFIX)) {
                const key = data.slice(ROUTE_PH_PREFIX.length);
                if (phByPath.has(key) || !routesByPath.has(key))
                    return false;
                phByPath.set(key, comment);
            }
            else if (data.startsWith(ROUTE_START_PREFIX)) {
                const key = data.slice(ROUTE_START_PREFIX.length);
                if (startByPath.has(key) || !routesByPath.has(key))
                    return false;
                startByPath.set(key, { comment, index });
            }
            else if (data.startsWith(ROUTE_END_PREFIX)) {
                const key = data.slice(ROUTE_END_PREFIX.length);
                if (endByPath.has(key) || !routesByPath.has(key))
                    return false;
                endByPath.set(key, { comment, index });
            }
        }
        // start / end は対で、同じ親の下で start が先。範囲同士は交差しない
        // （交差していると内容収集の兄弟走査が他ルートの領域へはみ出す）
        if (startByPath.size !== endByPath.size)
            return false;
        const ranges = [];
        for (const [key, start] of startByPath) {
            const end = endByPath.get(key);
            if (!end)
                return false;
            if (end.comment.parentNode !== start.comment.parentNode)
                return false;
            if (end.index <= start.index)
                return false;
            ranges.push({ start: start.index, end: end.index });
        }
        for (const a of ranges) {
            for (const b of ranges) {
                if (a.start < b.start && b.start < a.end && a.end < b.end)
                    return false;
            }
        }
        // 現在 URL のマッチとマーカー集合の一致検証。サーバーが描いた集合と
        // クライアントが今マッチする集合が違えば、URL か template が変わっている
        const path = sliceBasename(fullPath, this._basename);
        let matchResult = matchRoutes(this, path);
        if (!matchResult) {
            if (this._fallbackRoute === null)
                return false;
            matchResult = {
                routes: [this._fallbackRoute],
                params: {},
                typedParams: {},
                path,
                lastPath: this._path,
            };
        }
        matchResult.lastPath = this._path;
        if (matchResult.routes.length !== startByPath.size)
            return false;
        for (const route of matchResult.routes) {
            if (!startByPath.has(route.absolutePath))
                return false;
        }
        // placeholder の集合はサーバー出力の形と**完全一致**でなければならない。
        // serialize される placeholder = トップレベルルート + 各マッチルートの直接の子。
        // 不足を許すと、そのルートへの後続ナビゲーションが anchor を失って無言で
        // 空描画になる。過剰（非活性ルートの子孫の ph）を許すと、再設置がその
        // placeholder を fresh クローンの内容から奪い、当該ルートを到達不能にする
        const requiredPh = new Set();
        for (const route of this.routeChildNodes) {
            requiredPh.add(route.absolutePath);
        }
        for (const matched of matchResult.routes) {
            for (const child of matched.routeChildNodes) {
                requiredPh.add(child.absolutePath);
            }
        }
        if (phByPath.size !== requiredPh.size)
            return false;
        for (const key of requiredPh) {
            if (!phByPath.has(key))
                return false;
        }
        // --- 採用相（以後は成立が確定している） ---
        // placeholder をクライアント側インスタンスへ差し替える。以後のナビゲーションの
        // anchor がサーバーの位置にそのまま据わる
        for (const [key, comment] of phByPath) {
            const route = routesByPath.get(key);
            comment.parentNode.replaceChild(route.placeHolder, comment);
        }
        // 各マッチルートの内容 = 自分の start/end マーカー間の兄弟ノード。ただし:
        // - 子ルートの範囲（start〜end）は**丸ごと除外**する — CSR で親の childNodeArray に
        //   入るのは子の placeholder だけで、子の内容は子が所有する（hideRoute の重複
        //   除去と showRoute の誤再挿入を防ぐ）
        // - Link が所有する anchor も除外する — CSR では anchor は Link の cc が後から
        //   生成する Link の所有物で、childNodeArray には決して入らない。入れると
        //   hide → show の往復で Link 自身の anchor 管理と二重になり anchor が重複する
        for (const route of matchResult.routes) {
            const start = startByPath.get(route.absolutePath).comment;
            const end = endByPath.get(route.absolutePath).comment;
            const nodes = [];
            const linkOwnedAnchors = new Set();
            let node = start.nextSibling;
            while (node !== null && node !== end) {
                if (node.nodeType === Node.COMMENT_NODE) {
                    const data = node.data;
                    if (data.startsWith(ROUTE_START_PREFIX)) {
                        const childKey = data.slice(ROUTE_START_PREFIX.length);
                        node = endByPath.get(childKey).comment.nextSibling;
                        continue;
                    }
                }
                if (linkOwnedAnchors.has(node)) {
                    node = node.nextSibling;
                    continue;
                }
                if (node.nodeType === Node.ELEMENT_NODE &&
                    node.tagName.toLowerCase() === config.tagNames.link) {
                    // anchor は host より後ろに居るので、先に登録してから host を収集する
                    const anchor = node.anchorElement;
                    if (anchor !== null) {
                        linkOwnedAnchors.add(anchor);
                    }
                }
                nodes.push(node);
                node = node.nextSibling;
            }
            route.adoptChildNodes(nodes);
        }
        // マーカー除去と目印の撤去
        for (const { comment } of startByPath.values())
            comment.remove();
        for (const { comment } of endByPath.values())
            comment.remove();
        this.outlet.removeAttribute(SSR_OUTLET_ATTR);
        // 表示済み状態の確立。内容は既に見えているので挿入はしない — パラメータ
        // 配送（setParams / data-bind / active イベント）だけ CSR と同じ規則で行う。
        // lastRoutes を guard より先に立てるのは、guard 拒否後の fallback 遷移が
        // 採用済み内容を hideRoute できるようにするため（CSR と異なり、内容は
        // guard の結果を待たずにサーバーが既に見せている）
        for (const route of matchResult.routes) {
            assignRouteParams(route, matchResult);
        }
        this.outlet.lastRoutes = matchResult.routes;
        // guard 相 — 採用はレンダリング最適化であって認可のスキップではない（§4-3）。
        // 自前のサーバー出力は guard 付きルートを描かない（§2-4）ため通常は素通り
        // するが、手書きや他システム由来の SSR HTML に対する防衛として実行する
        if (!(await runGuardPhase(this, matchResult))) {
            // fallback へのナビゲーションが microtask で予約済み。lastRoutes は
            // 立っているので、その遷移が採用済み内容を隠す。commit はしない
            //（拒否されたパスでの path-changed 発火を防ぐ — applyRoute と同じ規範）
            return true;
        }
        // 観測面の commit（applyRoute と同じ規範・同じ順序）。
        // routes はマッチ結果か [fallback] で必ず非空（検証相で確定済み）
        this.commitNavigation({
            params: matchResult.params,
            typedParams: matchResult.typedParams,
            routeName: matchResult.routes[matchResult.routes.length - 1].name,
            search: window.location.search || "",
            path,
        });
        return true;
    }
    /**
     * SSR モードの初期ルート描画（docs/ssr-router-design.md §3.2）。
     * 初回描画は transition arbiter に渡らない既存規則（showRouteContent）により
     * 常に同期適用される。navigate / popstate リスナ・a11y region・
     * `wcs:navigate` 通知はサーバーでは不要（connectedCallback 側で登録しない）。
     */
    async _renderForSsr(fullPath) {
        // guard バリア: guard 付きルートを含むマッチはサーバーで描かない（§2-4）。
        // guard は進入を守る認可点で、サーバーには判断材料（cookie 等）を渡す設計が
        // 無い。outlet を空・マーカー無しのまま返し、クライアントが従来どおり guard を
        // 実行して描く。ハンドラのロードは待たず属性の有無（hasGuard）で判定する。
        const path = sliceBasename(fullPath, this._basename);
        const matchResult = matchRoutes(this, path);
        const routes = matchResult?.routes
            ?? (this._fallbackRoute !== null ? [this._fallbackRoute] : []);
        if (routes.length === 0) {
            // マッチ無しかつ fallback 無し: クライアント（applyRoute）と同じ loud failure
            raiseError(`${config.tagNames.router} No route matched for path: ${path}`);
        }
        if (routes.some((route) => route.hasGuard)) {
            return;
        }
        await applyRoute(this, this.outlet, fullPath, this._path, window.location.search || "");
        // 表示済みルート内容を binder へ差し出す。クライアント初回描画の
        // 「state の走査時に既に document に居る」前提はサーバーでは成立しない —
        // state のロード方式（json 属性は I/O 無し・inline script は dynamic import）と
        // 文書順次第で、state の初回走査が router の挿入より先に完了し得る。binder は
        // 「未構築なら保留して構築末尾で引き取る／構築済みなら同期バインド」の両側を
        // 吸収する。bindRouteContent（showRouteContent 側）は使わない — binder 不在の
        // 警告はサーバーでは誤誘導になるため、warn 無しで直接差し出す。
        this._offerInitialContentToBinder();
        // ハイドレーションマーカー（Phase 2 の入力、§3.3）。キーは placeholder の
        // UUID ではなく absolutePath — UUID はパースごとに再生成されクライアントと
        // 一致しない。absolutePath は同一 template から決定的に導ける。
        // placeholder コメントも同じ理由で安定キーへ書き換える — クライアントの採用は
        // これを自分の placeholder（クライアント側インスタンス）と差し替える。
        this._forEachRoute((route) => {
            route.placeHolder.data = `${ROUTE_PH_PREFIX}${route.absolutePath}`;
        });
        this.outlet.setAttribute(SSR_OUTLET_ATTR, '');
        for (const route of this.outlet.lastRoutes) {
            // applyRoute 成功後の placeholder は必ず outlet 配下の DOM に居る
            const parentNode = route.placeHolder.parentNode;
            const contentNodes = route.childNodeArray;
            const start = document.createComment(`${ROUTE_START_PREFIX}${route.absolutePath}`);
            const end = document.createComment(`${ROUTE_END_PREFIX}${route.absolutePath}`);
            parentNode.insertBefore(start, contentNodes[0] ?? route.placeHolder.nextSibling);
            const last = contentNodes[contentNodes.length - 1];
            parentNode.insertBefore(end, last ? last.nextSibling : start.nextSibling);
        }
    }
    /**
     * 初期表示ルートの内容を binder プロトコルへ差し出す。SSR 描画（_renderForSsr）と
     * ハイドレーション不能時の描き直し（state が先にハイドレートを終えている可能性が
     * ある）の両方から呼ぶ。bind() は冪等なので余分に差し出しても壊れない。
     */
    _offerInitialContentToBinder() {
        for (const route of this.outlet.lastRoutes) {
            for (const node of route.childNodeArray) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    bindSubtree(node);
                }
            }
        }
    }
    /** ルートツリー全体（ネスト含む）への走査 */
    _forEachRoute(callback, container = this) {
        for (const route of container.routeChildNodes) {
            callback(route);
            this._forEachRoute(callback, route);
        }
    }
    async connectedCallback() {
        // upgrade 前に代入された input を取り込み直す（doc 13 §1.2 / Phase A1）。
        // await より前に同期で行い、初期化が古い値を読まないようにする。
        upgradeProperties(this);
        // SSR モード（docs/ssr-router-design.md §3.2）:
        // - enable-ssr 無し → サーバーでは一切初期化しない（クライアント専用 = 部分 CSR）
        // - enable-ssr あり → SSR 初期化のみ。navigate / popstate リスナは登録しない
        // どちらも connectedCallbackPromise を必ず決着させる — reject を配管しないと
        // renderToString が mutex を握ったまま無言ハングする（state 側と同じ理由）。
        if (inSsr()) {
            try {
                // happy-dom のパーサは開始タグの時点で connectedCallback を呼ぶため、
                // この時点では子（<template>）がまだパースされていない。パース自体は
                // 同期完了するので、1 microtask 譲れば子が揃う。クライアントでは
                // deferred な auto バンドルの upgrade 時に子が揃っているため不要
                // （サーバー専用の待避、docs/ssr-router-design.md §3.2）。
                await Promise.resolve();
                if (this.hasAttribute('enable-ssr') && !this._initialized) {
                    await this._initialize();
                }
            }
            catch (error) {
                this._rejectConnectedCallback?.(error);
                throw error;
            }
            this._resolveConnectedCallback?.();
            return;
        }
        if (!this._initialized) {
            this._disconnectedDuringInit = false;
            try {
                // ストリーミング型パーサ（happy-dom: `document.body.innerHTML = ...` の途中）は
                // 開始タグの時点で connectedCallback を呼び、子（<template>）がまだ無い。
                // SSR 経路と同じく 1 microtask 譲れば同期パースが完走して子が揃う。
                // ブラウザの deferred なバンドルでは upgrade 時に子が揃っているので、
                // template が既にあるときは譲らない（従来どおり）。
                if (this._getTemplate() === null) {
                    await Promise.resolve();
                }
                await this._initialize();
            }
            catch (error) {
                // reject を配管しないと、初期化の失敗（template 無し・ルート定義無し・
                // basename 不整合 …）が connectedCallbackPromise を永久に未決着にし、
                // waitForReady（@wcstack/server / @wcstack/testing）が無言でハングする。
                // SSR 経路と同じ扱いにする。
                this._rejectConnectedCallback?.(error);
                throw error;
            }
            // 初期化中に disconnectedCallback が呼ばれた場合はイベントリスナを登録しない
            if (this._disconnectedDuringInit) {
                this._resolveConnectedCallback?.();
                return;
            }
        }
        // 再接続時は disconnect で撤去された live region を回復する
        // （初回接続では _initialize が生成済みなので no-op）
        if (this._initialized) {
            this._ensureA11yRegion();
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
        this._resolveConnectedCallback?.();
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
        // live region は router の寿命に同期して撤去する（body 直下に置かない理由と同根）
        if (this._a11yRegion !== null) {
            this._a11yRegion.remove();
            this._a11yRegion = null;
        }
    }
}

// 生成 anchor へミラーする固定属性（docs/a11y-design.md §5）。`aria-*` は開集合なので
// observedAttributes には載せられず、anchor 生成時の一括コピーのみ（接続後の動的
// aria-* 変更 — data-wcs バインド経由を含む — には追従しない。README の明記された制限）。
const MIRRORED_ATTRIBUTES = ['title', 'rel', 'target', 'download', 'hreflang'];
class Link extends HTMLElement {
    static get observedAttributes() {
        return ['to', ...MIRRORED_ATTRIBUTES];
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
    /**
     * router が扱う内部ターゲットか。`/` 始まりに加え、`?` 始まり（クエリのみ遷移 —
     * docs/router-state-contract-design.md §4.1）も内部ターゲットとして受理する。
     */
    _isInternalTarget(path) {
        return path.startsWith('/') || path.startsWith('?');
    }
    _setAnchorHref(anchor, path) {
        if (this._isInternalTarget(path)) {
            // basename 結合・正規化は pathname にのみ適用し、search / hash は再結合する。
            // pathname 空（to="?k=v"）は「現在 pathname + 指定クエリ」で組み立てる。
            const { pathname, search, hash } = splitUrlTarget(path);
            const joined = pathname === ""
                ? window.location.pathname
                : this._joinInternalPath(this.router.basename, pathname);
            anchor.href = joined + effectiveSearch(search) + hash;
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
        if (inSsr()) {
            // SSR（docs/ssr-router-design.md §3.2 / §4）: happy-dom のパーサは開始タグ
            // 時点で cc を呼ぶため、同期のまま進めると静的 Link の子が空のまま
            // anchor 化される。パースは同期完了するので 1 microtask 譲る。
            // renderToString は待機プロトコル要素（state / router）の await で
            // microtask を消化するため、serialize より先にこの初期化は完了する。
            queueMicrotask(() => {
                if (this.isConnected) {
                    this._connect();
                }
            });
            return;
        }
        this._connect();
    }
    /**
     * サーバーが生成した目印付き anchor（直後の兄弟）。クライアントの採用対象
     */
    _findSsrAnchor() {
        const next = this.nextElementSibling;
        if (next !== null && next.tagName === 'A' && next.hasAttribute(SSR_LINK_ATTR)) {
            return next;
        }
        return null;
    }
    _connect() {
        if (!this._initialized) {
            this._initialize();
        }
        const parentNode = this.parentNode;
        if (!parentNode) {
            // should not happen if connected
            return;
        }
        const ssrAnchor = this._findSsrAnchor();
        let link;
        if (ssrAnchor !== null) {
            // SSR 採用: サーバーの anchor をそのまま自分の anchor にする。
            // 生成経路（cc）でホストの子は anchor へ移動済みなので、子の正本は anchor 側
            link = ssrAnchor;
            link.removeAttribute(SSR_LINK_ATTR);
            this._childNodeArray = Array.from(link.childNodes);
            // href はクライアント側の解決で引き直す（basename / config の検算）
            this._setAnchorHref(link, this._path);
        }
        else {
            const nextSibling = this.nextSibling;
            link = document.createElement('a');
            this._setAnchorHref(link, this._path);
            // ホスト属性の転送: `aria-*` prefix + 固定 5 名の一括コピー。
            // to / style / class は除外 — ホストは display:none であり、class は active 契約を持つ。
            for (const attr of Array.from(this.attributes)) {
                if (attr.name.startsWith('aria-') || MIRRORED_ATTRIBUTES.includes(attr.name)) {
                    link.setAttribute(attr.name, attr.value);
                }
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
        }
        this._anchorElement = link;
        if (inSsr()) {
            // サーバー: リスナは登録しない（レンダリングウィンドウは serialize 後に
            // 閉じる）。active 状態は SSR 出力に載せ、クライアントの採用が引き取る
            // 目印を付ける
            this._updateActiveState();
            link.setAttribute(SSR_LINK_ATTR, '');
            return;
        }
        // ロケーション変更を監視
        getNavigation()?.addEventListener('currententrychange', this._updateActiveState);
        window.addEventListener('wcs:navigate', this._updateActiveState);
        window.addEventListener('popstate', this._updateActiveState);
        // Navigation API が無い場合は、クリックで router.navigate にフォールバック
        // （`?` 始まりのクエリのみリンクも対象 — 素の href だとフルページ遷移になる）
        if (this._isInternalTarget(this._path) && !getNavigation()?.navigate) {
            this._onClick = async (e) => {
                // only left-click without modifiers
                if (e.defaultPrevented)
                    return;
                if (e.button !== 0)
                    return;
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
                    return;
                // 動的に外部URLに変わった場合はブラウザのデフォルト挙動に委ねる
                if (!this._isInternalTarget(this._path))
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
        else if (MIRRORED_ATTRIBUTES.includes(name)) {
            // 固定名のみ接続後も追従する。anchor 生成前（upgrade 前発火）は何もしない。
            const anchor = this._anchorElement;
            if (anchor) {
                if (newValue === null) {
                    anchor.removeAttribute(name);
                }
                else {
                    anchor.setAttribute(name, newValue);
                }
            }
        }
    }
    _updateActiveState = () => {
        // クエリのみリンク（to="?k=v"）の href は現在 pathname に依存するため、
        // active 判定と同じリスナー経路でロケーション変更に追従させる（§4.1）。
        if (this._path.startsWith('?') && this._anchorElement) {
            this._setAnchorHref(this._anchorElement, this._path);
        }
        // active 判定は pathname のみの比較（クエリ非感応 — §1.1 欠陥 7 の修理）。
        const currentPath = this._normalizePathname(new URL(window.location.href).pathname);
        const { pathname } = splitUrlTarget(this._path);
        const linkPath = this._normalizePathname(this._isInternalTarget(this._path)
            ? (pathname === ""
                ? window.location.pathname
                : this._joinInternalPath(this.router.basename, pathname))
            : pathname);
        if (this._anchorElement) {
            if (currentPath === linkPath) {
                this._anchorElement.classList.add('active');
                // 修理・既定オン（docs/a11y-design.md §3-3）: active class と同じ事実の ARIA 表現。
                // 鮮度保証は active class と同一（同じ分岐・同じ呼び出し経路）。
                this._anchorElement.setAttribute('aria-current', 'page');
            }
            else {
                this._anchorElement.classList.remove('active');
                this._anchorElement.removeAttribute('aria-current');
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
            // hreflang もキーに含める。含めないと、代表ロケールと `x-default` を同じ
            // href で併記する `rel="alternate"` の組が同一キーになり、片方が落ちる。
            // これは i18n の標準的な書き方（x-default は既定言語版を指す）なので、
            // 「同じ href の link は 1 本」という仮定はここで破れる。
            const hreflang = el.getAttribute('hreflang') || '';
            return `link:${rel}:${href}:${media}:${hreflang}`;
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
                // head へ入れたのは cloneNode なので、元ノードのバインドは引き継がれない。
                // `<title data-wcs="…">` はページからタイトルを消すという、未翻訳より
                // 悪い形で失敗する。クローンを binder に渡して、そこで初めて束ねる。
                // 挿入後に呼ぶのは、`bind()` が初期値の適用まで同期で行うため。
                if (!bindSubtree(targetElement)) {
                    warnUnboundMarkup(targetElement, `<${targetElement.tagName.toLowerCase()}> inside <${config.tagNames.head}>`, `<${config.tagNames.head}> reflects its children into <head> with cloneNode, ` +
                        `so the clone is not the node that was bound. Load @wcstack/state on this ` +
                        `page, or write the value statically here.`);
                }
            }
            else {
                // 初期値もスタックにもない場合は削除
                current?.remove();
                headElementMap.delete(key);
            }
        }
    }
}

/**
 * Register this package's tags. Pass a scoped `CustomElementRegistry` to define
 * them for a single shadow tree -- scoped registries do not inherit the global
 * one, so a tree using one needs its own definitions.
 */
function registerComponents(registry = customElements) {
    // Register custom element
    if (!registry.get(config.tagNames.layout)) {
        registry.define(config.tagNames.layout, Layout);
    }
    if (!registry.get(config.tagNames.layoutOutlet)) {
        registry.define(config.tagNames.layoutOutlet, LayoutOutlet);
    }
    if (!registry.get(config.tagNames.outlet)) {
        registry.define(config.tagNames.outlet, Outlet);
    }
    if (!registry.get(config.tagNames.route)) {
        registry.define(config.tagNames.route, Route);
    }
    if (!registry.get(config.tagNames.router)) {
        registry.define(config.tagNames.router, Router);
    }
    if (!registry.get(config.tagNames.link)) {
        registry.define(config.tagNames.link, Link);
    }
    if (!registry.get(config.tagNames.head)) {
        registry.define(config.tagNames.head, Head);
    }
}

/**
 * Initialize the router with optional configuration.
 * This is the main entry point for setting up the router.
 * @param config - Optional partial configuration to override defaults
 */
function bootstrapRouter(config, registry) {
    if (config) {
        setConfig(config);
    }
    registerComponents(registry);
}

var version = "1.33.0";
var pkg = {
	version: version};

const VERSION = pkg.version;

export { Route, RouteCore, Router, VERSION, bootstrapRouter, getConfig };
//# sourceMappingURL=index.esm.js.map
