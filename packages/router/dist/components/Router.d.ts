import { IOutlet, IRoute, IRouter } from "./types.js";
/**
 * AppRoutes - Root component for wc-router
 *
 * Container element that manages route definitions and navigation.
 */
export declare class Router extends HTMLElement implements IRouter {
    private static _instance;
    private _outlet;
    private _template;
    private _routeChildNodes;
    private _basename;
    private _path;
    private _initialized;
    private _fallbackRoute;
    constructor();
    private _normalizePath;
    private _getBasename;
    static get instance(): IRouter;
    static navigate(path: string): void;
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
    navigate(path: string): Promise<void>;
    private _onNavigateFunc;
    private _onNavigate;
    private _initialize;
    connectedCallback(): Promise<void>;
    disconnectedCallback(): void;
}
//# sourceMappingURL=Router.d.ts.map