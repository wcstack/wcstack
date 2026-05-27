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
interface IWcBindableProperty {
    readonly name: string;
    readonly event: string;
    readonly getter?: (event: Event) => any;
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
    readonly version: 1;
    readonly properties: IWcBindableProperty[];
    readonly inputs?: readonly IWcBindableInput[];
    readonly commands?: readonly IWcBindableCommand[];
}

/**
 * Initialize the router with optional configuration.
 * This is the main entry point for setting up the router.
 * @param config - Optional partial configuration to override defaults
 */
declare function bootstrapRouter(config?: Partial<IWritableConfig>): void;

declare function getConfig(): IConfig;

interface IRouteMatchResult {
    routes: IRoute[];
    params: Record<string, string>;
    typedParams: Record<string, any>;
    path: string;
    lastPath: string;
}
type GuardHandler = (toPath: string, fromPath: string) => boolean | Promise<boolean>;
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
    guardHandler: GuardHandler;
    shouldChange(newParams: Record<string, string>): boolean;
    guardCheck(matchResult: IRouteMatchResult): Promise<void>;
    initialize(routerNode: IRouter, parentRouteNode: IRoute | null): void;
    testAncestorNode(ancestorNode: IRoute): boolean;
    setParams(params: Record<string, string>, typedParams: Record<string, any>): void;
    clearParams(): void;
    notifyGuardHandlerLoadFailed(): void;
}
interface IRouter extends IRouteChildContainer {
    readonly basename: string;
    readonly outlet: IOutlet;
    readonly template: HTMLTemplateElement;
    fallbackRoute: IRoute | null;
    path: string;
    navigate(path: string): Promise<void>;
}
interface IOutlet {
    routesNode: IRouter;
    readonly rootNode: HTMLElement | ShadowRoot;
    lastRoutes: IRoute[];
}

/**
 * AppRoutes - Root component for @wcstack/router
 *
 * Container element that manages route definitions and navigation.
 */
declare class Router extends HTMLElement implements IRouter {
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
    private _disconnectedDuringInit;
    private _initializing;
    constructor();
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
    get fallbackRoute(): IRoute | null;
    /**
     * Routeのfallback属性がある場合にそのルートを設定します。
     */
    set fallbackRoute(value: IRoute | null);
    get navigateUrl(): string | null;
    set navigateUrl(value: string | null);
    navigate(path: string): Promise<void>;
    /**
     * basename 配下の URL かどうかを判定する。
     * basename が空の場合はすべての URL にマッチする。
     */
    private _isOwnPath;
    private _onNavigateFunc;
    private _onNavigate;
    private _onPopState;
    private _initialize;
    connectedCallback(): Promise<void>;
    disconnectedCallback(): void;
}

declare class Route extends HTMLElement implements IRoute {
    static wcBindable: IWcBindable;
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
declare class RouteCore extends EventTarget {
    static wcBindable: IWcBindable;
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

export { Route, RouteCore, Router, VERSION, bootstrapRouter, getConfig };
export type { IWritableConfig, IWritableTagNames, RouteParseOptions };
