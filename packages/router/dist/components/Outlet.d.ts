import { IOutlet, IRoute, IRouter } from "./types.js";
export declare class Outlet extends HTMLElement implements IOutlet {
    private _routesNode;
    private _lastRoutes;
    private _initialized;
    constructor();
    get routesNode(): IRouter;
    set routesNode(value: IRouter);
    get rootNode(): HTMLElement | ShadowRoot;
    get lastRoutes(): IRoute[];
    set lastRoutes(value: IRoute[]);
    private _initialize;
    connectedCallback(): void;
}
export declare function createOutlet(): Outlet;
//# sourceMappingURL=Outlet.d.ts.map