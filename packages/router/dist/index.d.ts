/**
 * Observation semantics of a `properties` entry.
 *
 *   "state"  — current value. A snapshot may cache it, and equality-based dedupe is safe.
 *   "event"  — occurrence. Repeated identical payloads are distinct occurrences; never dedupe.
 *   "handle" — live / opaque resource with its own lifecycle (e.g. MediaStream). Not
 *              snapshot-safe and not necessarily serializable; consumers need an explicit
 *              ref / callback surface rather than a value slot.
 */
type WcBindableSemantics = "state" | "event" | "handle";
interface IWcBindableProperty {
    readonly name: string;
    readonly event: string;
    readonly getter?: (event: Event) => any;
    /**
     * Optional, additive, forward-compatible. An absent value means **unspecified**, NOT
     * "state": a reader that finds no `semantics` MUST keep the behavior it had before this
     * field existed (deliver the update as-is; do not start deduping, caching or serializing
     * on assumption). Only an explicit value licenses a reader to change its handling.
     */
    readonly semantics?: WcBindableSemantics;
}
interface IWcBindableInput {
    readonly name: string;
    readonly attribute?: string;
}
interface IWcBindableCommand {
    readonly name: string;
    readonly async?: boolean;
}
interface IWcBindable {
    readonly protocol: "wc-bindable";
    /** Integer protocol version. All versions >= 1 are core-compatible. */
    readonly version: number;
    readonly properties: readonly IWcBindableProperty[];
    readonly inputs?: readonly IWcBindableInput[];
    readonly commands?: readonly IWcBindableCommand[];
}

interface ITagNames {
    readonly route: string;
    readonly router: string;
    readonly outlet: string;
    readonly layout: string;
    readonly layoutOutlet: string;
    readonly link: string;
    readonly head: string;
    readonly guardHandler: string;
}
interface IWritableTagNames {
    route?: string;
    router?: string;
    outlet?: string;
    layout?: string;
    layoutOutlet?: string;
    link?: string;
    head?: string;
    guardHandler?: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
    readonly enableShadowRoot: boolean;
    readonly basenameFileExtensions: ReadonlyArray<string>;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
    enableShadowRoot?: boolean;
    basenameFileExtensions?: string[];
}
type BuiltinParamTypes = "int" | "float" | "bool" | "uuid" | "slug" | "isoDate" | "any";

/**
 * Initialize the router with optional configuration.
 * This is the main entry point for setting up the router.
 * @param config - Optional partial configuration to override defaults
 */
declare function bootstrapRouter(config?: Partial<IWritableConfig>, registry?: CustomElementRegistry): void;

declare function getConfig(): IConfig;

interface IRouteMatchResult {
    routes: IRoute[];
    params: Record<string, string>;
    typedParams: Record<string, any>;
    path: string;
    lastPath: string;
}
type GuardHandler = (toPath: string, fromPath: string) => boolean | Promise<boolean>;
interface _ILayout {
    readonly uuid: string;
    readonly enableShadowRoot: boolean;
    readonly name: string;
    loadTemplate(): Promise<HTMLTemplateElement>;
}
type ILayout = _ILayout & Pick<Element, 'childNodes'>;
type SegmentType = 'static' | 'param' | 'catch-all';
interface ISegmentInfo {
    type: SegmentType;
    segmentText: string;
    paramName: string | null;
    pattern: RegExp;
    isIndex?: boolean;
    paramType?: BuiltinParamTypes;
}
interface IRouteChildContainer {
    readonly routeChildNodes: IRoute[];
}
interface IRoute extends IRouteChildContainer {
    readonly routeParentNode: IRoute | null;
    readonly routerNode: IRouter;
    readonly path: string;
    readonly isRelative: boolean;
    readonly absolutePath: string;
    readonly uuid: string;
    readonly placeHolder: Comment;
    readonly childNodeArray: Node[];
    readonly routes: IRoute[];
    readonly params: Record<string, string>;
    readonly typedParams: Record<string, any>;
    readonly paramNames: string[];
    readonly absoluteParamNames: string[];
    readonly weight: number;
    readonly absoluteWeight: number;
    readonly childIndex: number;
    readonly name: string;
    readonly fullpath: string;
    readonly segmentCount: number;
    readonly absoluteSegmentCount: number;
    readonly segmentInfos: ISegmentInfo[];
    readonly absoluteSegmentInfos: ISegmentInfo[];
    /** guard 属性の有無。SSR の guard バリア判定に使う（docs/ssr-router-design.md §2-4） */
    readonly hasGuard: boolean;
    guardHandler: GuardHandler;
    shouldChange(newParams: Record<string, string>): boolean;
    guardCheck(matchResult: IRouteMatchResult): Promise<void>;
    initialize(routerNode: IRouter, parentRouteNode: IRoute | null): void;
    testAncestorNode(ancestorNode: IRoute): boolean;
    setParams(params: Record<string, string>, typedParams: Record<string, any>): void;
    clearParams(): void;
    notifyGuardHandlerLoadFailed(): void;
    /**
     * SSR ハイドレーションの採用: サーバー描画済みノード列を内容として引き取る
     * （docs/ssr-router-design.md §4）
     */
    adoptChildNodes(nodes: Node[]): void;
}
/**
 * Router 観測面のコミット 1 回分（docs/router-state-contract-design.md §3.4）。
 */
interface IRouterCommit {
    params: Record<string, string>;
    typedParams: Record<string, any>;
    routeName: string;
    /** "?k=v" 形式または ""。パースは commit 側（Router）が行う */
    search: string;
    /** basename スライス後の path */
    path: string;
}
interface IRouter extends IRouteChildContainer {
    readonly basename: string;
    readonly outlet: IOutlet;
    readonly template: HTMLTemplateElement;
    fallbackRoute: IRoute | null;
    path: string;
    /** 現在マッチのマージ済み param（文字列・frozen）。fallback・初期化前は {} */
    readonly params: Record<string, string>;
    /** 同上の型変換済み値（frozen） */
    readonly typedParams: Record<string, any>;
    /** 現在 URL のクエリ（Record・last-wins・frozen）。クエリ無しは {} */
    readonly searchParams: Record<string, string>;
    /** 最深マッチルートの name 属性値。fallback 時は fallback ルートの name */
    readonly routeName: string;
    navigate(path: string): Promise<void>;
    /** navigateUrl（push）の対になる replace 遷移（§4.2） */
    replace(path: string): Promise<void>;
    /**
     * same-match 判定（§4.4）。比較は basename スライス後の path 同士。
     * 最初の成功 commit より前は常に false（初回ガード）。
     */
    isSameMatch(path: string): boolean;
    /**
     * 観測面のコミットと発火（§3.4）。全内部値を先にコミットし、その後で
     * params → route-name → search → path の順に変化したものだけ発火する。
     */
    commitNavigation(commit: IRouterCommit): void;
    /** `announce=` 用 live region。未生成なら null（docs/a11y-design.md §3-4） */
    readonly a11yRegion: HTMLElement | null;
    /** `<wcs-router focus=...>` の属性値（無ければ null） */
    readonly focusPolicy: string | null;
    /** `<wcs-router announce=...>` の属性値（無ければ null） */
    readonly announcePolicy: string | null;
}
interface IOutlet {
    routesNode: IRouter;
    readonly rootNode: HTMLElement | ShadowRoot;
    lastRoutes: IRoute[];
}
interface ILayoutOutlet {
    layout: ILayout;
    readonly name: string;
    assignParams(params: Record<string, any>): void;
}
interface ILink {
    readonly uuid: string;
    readonly router: IRouter;
    readonly anchorElement: HTMLAnchorElement | null;
}

/**
 * AppRoutes - Root component for @wcstack/router
 *
 * Container element that manages route definitions and navigation.
 */
declare class Router extends HTMLElement implements IRouter {
    /**
     * @wcstack/server の待機プロトコル（docs/ssr-router-design.md §3.2）。
     * renderToString はこのフラグを持つ要素の connectedCallbackPromise を待って
     * からシリアライズする — 初期ルート適用の完了がサーバー出力に反映される。
     */
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    private _outlet;
    private _template;
    private _routeChildNodes;
    private _basename;
    private _path;
    private _initialized;
    private _fallbackRoute;
    private _listeningPopState;
    private _listeningNavigate;
    private _navigateUrl;
    private _replaceUrl;
    private _disconnectedDuringInit;
    private _initializing;
    private _a11yRegion;
    private _params;
    private _typedParams;
    private _searchParams;
    private _routeName;
    /** 最初の成功 commit を通過したか（§4.4 の初回ガード） */
    private _hasCommitted;
    private _connectedCallbackPromise;
    private _resolveConnectedCallback;
    private _rejectConnectedCallback;
    constructor();
    get connectedCallbackPromise(): Promise<void>;
    get a11yRegion(): HTMLElement | null;
    get focusPolicy(): string | null;
    get announcePolicy(): string | null;
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
    private _ensureA11yRegion;
    /**
     * Normalize a URL pathname to a route path.
     * 共通実装は normalizePathname.ts を参照（Link との挙動整合のため）。
     */
    private _normalizePathname;
    /**
     * Normalize basename.
     * 共通実装は normalizePathname.ts を参照。
     */
    private _normalizeBasename;
    private _joinInternalPath;
    private _notifyLocationChange;
    private _getBasename;
    get basename(): string;
    private _getOutlet;
    private _getTemplate;
    get outlet(): IOutlet;
    get template(): HTMLTemplateElement;
    get routeChildNodes(): IRoute[];
    get path(): string;
    /**
     * applyRoute 内で設定される値です。
     */
    set path(value: string);
    get params(): Record<string, string>;
    get typedParams(): Record<string, any>;
    get searchParams(): Record<string, string>;
    get routeName(): string;
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
    isSameMatch(path: string): boolean;
    /**
     * 観測面のコミットと発火（docs/router-state-contract-design.md §3.4）。
     *
     * 全内部値を先にコミットし、その後で初めてイベントを発火する — どのイベントの
     * リスナーから要素プロパティを読んでも、遷移後スナップショットの一貫した値が
     * 見える。発火順序は params → route-name → search → path。`path` を最後に
     * 置くのは、既存例で `path` が「ナビゲーション完了」の信号として使われている
     * ため。各イベントは変化した commit のみ発火する。
     */
    commitNavigation(commit: IRouterCommit): void;
    get fallbackRoute(): IRoute | null;
    /**
     * Routeのfallback属性がある場合にそのルートを設定します。
     */
    set fallbackRoute(value: IRoute | null);
    get navigateUrl(): string | null;
    set navigateUrl(value: string | null);
    get replaceUrl(): string | null;
    /**
     * navigateUrl と完全同型の null-idle transient（docs/router-state-contract-design.md §4.2）。
     * null は待機・書き込みで replace() を起動・完了で自己リセットして
     * `wcs-router:replace-url-changed`（detail: null）を発火する。
     */
    set replaceUrl(value: string | null);
    navigate(path: string): Promise<void>;
    /**
     * navigateUrl（push）の対になる replace 遷移（docs/router-state-contract-design.md §4.2）。
     * Navigation API では `navigation.navigate(url, { history: "replace" })`、
     * フォールバックでは `history.replaceState` + applyRoute + 通知。
     */
    replace(path: string): Promise<void>;
    private _performNavigation;
    /**
     * basename 配下の URL かどうかを判定する。
     * basename が空の場合はすべての URL にマッチする。
     */
    private _isOwnPath;
    private _onNavigateFunc;
    private _onNavigate;
    private _onPopState;
    private _initialize;
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
    private _hydrateFromSsr;
    /**
     * SSR モードの初期ルート描画（docs/ssr-router-design.md §3.2）。
     * 初回描画は transition arbiter に渡らない既存規則（showRouteContent）により
     * 常に同期適用される。navigate / popstate リスナ・a11y region・
     * `wcs:navigate` 通知はサーバーでは不要（connectedCallback 側で登録しない）。
     */
    private _renderForSsr;
    /**
     * 初期表示ルートの内容を binder プロトコルへ差し出す。SSR 描画（_renderForSsr）と
     * ハイドレーション不能時の描き直し（state が先にハイドレートを終えている可能性が
     * ある）の両方から呼ぶ。bind() は冪等なので余分に差し出しても壊れない。
     */
    private _offerInitialContentToBinder;
    /** ルートツリー全体（ネスト含む）への走査 */
    private _forEachRoute;
    connectedCallback(): Promise<void>;
    disconnectedCallback(): void;
}

declare class Route extends HTMLElement implements IRoute {
    private _core;
    private _routeParentNode;
    private _routeChildNodes;
    private _routerNode;
    private _uuid;
    private _placeHolder;
    private _childNodeArray;
    private _childIndex;
    private _initialized;
    private _routes;
    constructor();
    get routeParentNode(): IRoute | null;
    get routeChildNodes(): IRoute[];
    get routerNode(): IRouter;
    get uuid(): string;
    get placeHolder(): Comment;
    get childNodeArray(): Node[];
    /**
     * SSR ハイドレーションの採用（docs/ssr-router-design.md §4）。
     * サーバー描画済みの DOM ノード列をこのルートの内容として引き取る。
     * 以後の hideRoute / showRoute は採用ノードに対して従来どおり動く。
     * template 由来の fresh クローン（自身の childNodes）は不要になるため破棄する。
     */
    adoptChildNodes(nodes: Node[]): void;
    get routes(): IRoute[];
    get childIndex(): number;
    get path(): string;
    get name(): string;
    get isRelative(): boolean;
    get absolutePath(): string;
    get segmentInfos(): ISegmentInfo[];
    get absoluteSegmentInfos(): ISegmentInfo[];
    get params(): Record<string, string>;
    get typedParams(): Record<string, any>;
    get paramNames(): string[];
    get absoluteParamNames(): string[];
    get weight(): number;
    get absoluteWeight(): number;
    get segmentCount(): number;
    get absoluteSegmentCount(): number;
    get fullpath(): string;
    get hasGuard(): boolean;
    get guardHandler(): GuardHandler;
    set guardHandler(value: GuardHandler);
    setParams(params: Record<string, string>, typedParams: Record<string, any>): void;
    clearParams(): void;
    shouldChange(newParams: Record<string, string>): boolean;
    guardCheck(matchResult: IRouteMatchResult): Promise<void>;
    notifyGuardHandlerLoadFailed(): void;
    /**
     * Shell（Route）の routeParentNode を辿って祖先関係を判定する。
     *
     * 責務の分担:
     * - Route（このクラス）は DOM ツリー上の親子関係（routeParentNode）を管理する。
     * - RouteCore はパスやパラメータといった論理的な親子関係（parentCore）を管理する。
     * DOM ツリーは Shell 層、論理ツリーは Core 層という分離のため、両者を独立に保持する。
     */
    testAncestorNode(ancestorNode: IRoute): boolean;
    initialize(routerNode: IRouter, routeParentNode: IRoute | null): void;
}

interface RouteParseOptions {
    isIndex?: boolean;
    isFallback?: boolean;
    hasGuard?: boolean;
    guardFallback?: string | null;
    name?: string;
}
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
declare class RouteCore extends EventTarget {
    private _target;
    private _parentCore;
    private _path;
    private _name;
    private _isFallbackRoute;
    private _segmentInfos;
    private _absoluteSegmentInfos;
    private _paramNames;
    private _absoluteParamNames;
    private _weight;
    private _absoluteWeight;
    private _segmentCount;
    private _params;
    private _typedParams;
    private _active;
    private _hasGuard;
    private _guardHandler;
    private _guardFallbackPath;
    private _waitForSetGuardHandler;
    private _resolveSetGuardHandler;
    private _guardHandlerLoadFailed;
    constructor(target?: EventTarget);
    get parentCore(): RouteCore | null;
    set parentCore(value: RouteCore | null);
    get path(): string;
    get name(): string;
    get isFallbackRoute(): boolean;
    get isRelative(): boolean;
    get segmentInfos(): ISegmentInfo[];
    private _checkParentCore;
    get absolutePath(): string;
    get absoluteSegmentInfos(): ISegmentInfo[];
    get params(): Record<string, string>;
    get typedParams(): Record<string, any>;
    get active(): boolean;
    get paramNames(): string[];
    get absoluteParamNames(): string[];
    get weight(): number;
    get absoluteWeight(): number;
    get segmentCount(): number;
    get absoluteSegmentCount(): number;
    parsePath(path: string, options?: RouteParseOptions): void;
    setParams(params: Record<string, string>, typedParams: Record<string, any>): void;
    clearParams(): void;
    shouldChange(newParams: Record<string, string>): boolean;
    /**
     * guard 属性の有無（parsePath の options.hasGuard）。SSR の guard バリア
     * — guard 付きルートはサーバーで描かない（docs/ssr-router-design.md §2-4）—
     * がハンドラのロードを待たずに判定するために使う。
     */
    get hasGuard(): boolean;
    get guardHandler(): GuardHandler;
    set guardHandler(value: GuardHandler);
    /**
     * Guardハンドラのロードに失敗したことを通知し、guardCheck の待ちを解除する。
     * 解除後の guardCheck は guardHandler が未設定のため fallback パスへリダイレクトする。
     */
    notifyGuardHandlerLoadFailed(): void;
    guardCheck(matchResult: IRouteMatchResult): Promise<void>;
}

declare const VERSION: string;

declare class Outlet extends HTMLElement implements IOutlet {
    private _routesNode;
    private _lastRoutes;
    private _initialized;
    constructor();
    get routesNode(): IRouter;
    set routesNode(value: IRouter);
    get rootNode(): HTMLElement | ShadowRoot;
    get lastRoutes(): IRoute[];
    set lastRoutes(value: IRoute[]);
    /**
     * shadowRoot 有効化判定。Layout と挙動を揃え、属性で個別オーバーライド可能にする。
     * - `enable-shadow-root` 属性あり → true
     * - `disable-shadow-root` 属性あり → false
     * - いずれもなし → config.enableShadowRoot を尊重
     */
    private _resolveEnableShadowRoot;
    private _initialize;
    connectedCallback(): void;
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
    disconnectedCallback(): void;
}

declare class Layout extends HTMLElement implements ILayout {
    private _uuid;
    constructor();
    private _loadTemplateFromSource;
    private _loadTemplateFromDocument;
    loadTemplate(): Promise<HTMLTemplateElement>;
    get uuid(): string;
    get enableShadowRoot(): boolean;
    get name(): string;
}

declare class LayoutOutlet extends HTMLElement implements ILayoutOutlet {
    private _layout;
    private _initialized;
    private _initializing;
    private _disconnectedDuringInit;
    private _layoutChildNodes;
    constructor();
    get layout(): ILayout;
    set layout(value: ILayout);
    get name(): string;
    private _initialize;
    connectedCallback(): Promise<void>;
    disconnectedCallback(): void;
    assignParams(params: Record<string, any>): void;
}

declare class Link extends HTMLElement implements ILink {
    static get observedAttributes(): string[];
    private _childNodeArray;
    private _uuid;
    private _path;
    private _router;
    private _anchorElement;
    private _initialized;
    private _onClick?;
    constructor();
    get uuid(): string;
    /**
     * 最寄りの Router を返す。
     *
     * 注意: この getter は DOM 走査で Router を探すため、
     * Router がまだ upgrade されていない場合は HTMLElement として返る可能性がある。
     * 通常は registerComponents() で Router を Link より先に upgrade することを推奨する。
     */
    get router(): Router;
    private _initialize;
    /**
     * URL pathname を正規化する。Router と共通実装を使うことで
     * basenameFileExtensions の取り扱いを揃え、active 判定の取りこぼしを防ぐ。
     */
    private _normalizePathname;
    private _joinInternalPath;
    /**
     * router が扱う内部ターゲットか。`/` 始まりに加え、`?` 始まり（クエリのみ遷移 —
     * docs/router-state-contract-design.md §4.1）も内部ターゲットとして受理する。
     */
    private _isInternalTarget;
    private _setAnchorHref;
    connectedCallback(): void;
    /**
     * サーバーが生成した目印付き anchor（直後の兄弟）。クライアントの採用対象
     */
    private _findSsrAnchor;
    private _connect;
    disconnectedCallback(): void;
    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void;
    private _updateActiveState;
    get anchorElement(): HTMLAnchorElement | null;
}

declare class Head extends HTMLElement {
    private _initialized;
    private _childElementArray;
    constructor();
    private _initialize;
    connectedCallback(): void;
    disconnectedCallback(): void;
    get childElementArray(): Element[];
    /**
     * 要素の一意キーを生成（WeakMap でキャッシュ）
     */
    private _getKey;
    /**
     * 要素の一意キーを計算（実体）
     */
    private _computeKey;
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
    private _buildHeadElementMap;
    /**
     * 初期の<head>状態をキャプチャ
     * document.head内の全ての要素をスキャンして保存する
     */
    private _captureInitialHead;
    /**
     * スタック全体からheadを再構築
     * 後のHeadが優先される（上書き）
     */
    private _reapplyHead;
}

declare global {
    interface HTMLElementTagNameMap {
        "wcs-router": Router;
        "wcs-route": Route;
        "wcs-outlet": Outlet;
        "wcs-layout": Layout;
        "wcs-layout-outlet": LayoutOutlet;
        "wcs-link": Link;
        "wcs-head": Head;
    }
}

export { Route, RouteCore, Router, VERSION, bootstrapRouter, getConfig };
export type { IWritableConfig, IWritableTagNames, RouteParseOptions };
