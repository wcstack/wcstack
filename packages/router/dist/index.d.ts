interface IWritableTagNames {
    route?: string;
    router?: string;
    outlet?: string;
    layout?: string;
    layoutOutlet?: string;
    link?: string;
    head?: string;
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
interface IWcBindable {
    readonly protocol: "wc-bindable";
    readonly version: number;
    readonly properties: IWcBindableProperty[];
}

/**
 * Initialize the router with optional configuration.
 * This is the main entry point for setting up the router.
 * @param config - Optional partial configuration to override defaults
 */
declare function bootstrapRouter(config?: Partial<IWritableConfig>): void;

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
    params: Record<string, string>;
    typedParams: Record<string, any>;
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
    guardCheck(matchResult: IRouteMatchResult): Promise<void>;
}

export { RouteCore, bootstrapRouter };
export type { IWritableConfig, IWritableTagNames, RouteParseOptions };
