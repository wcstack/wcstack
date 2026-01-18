import { parse } from "../parse.js";
import { createOutlet, Outlet } from "./Outlet.js";
import { config } from "../config.js";
import { raiseError } from "../raiseError.js";
import { IOutlet, IRoute, IRouter } from "./types.js";
import { applyRoute } from "../applyRoute.js";
import { getNavigation } from "../Navigation.js";

/**
 * AppRoutes - Root component for @wcstack/router
 * 
 * Container element that manages route definitions and navigation.
 */
export class Router extends HTMLElement implements IRouter {
  private static _instance: IRouter | null = null;
  private _outlet: IOutlet | null = null;
  private _template: HTMLTemplateElement | null = null;
  private _routeChildNodes: IRoute[] = [];
  private _basename: string = '';
  private _path: string = '';
  private _initialized: boolean = false;
  private _fallbackRoute: IRoute | null = null;
  private _listeningPopState: boolean = false;

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
   * - treat trailing "/index.html" (or "*.html") as directory root
   * - remove trailing slash except root "/"
   */
  private _normalizePathname(_path: string): string {
    let path = _path || "/";
    if (!path.startsWith("/")) path = "/" + path;
    path = path.replace(/\/{2,}/g, "/");
    // e.g. "/app/index.html" -> "/app"
    path = path.replace(/\/[^/]+\.html$/i, "");
    if (path === "") path = "/";
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    return path;
  }

  /**
   * Normalize basename.
   * - "" or "/" -> ""
   * - "/app/" -> "/app"
   * - "/app/index.html" -> "/app"
   */
  private _normalizeBasename(_path: string): string {
    let path = _path || "";
    if (!path) return "";
    if (!path.startsWith("/")) path = "/" + path;
    path = path.replace(/\/{2,}/g, "/");
    path = path.replace(/\/[^/]+\.html$/i, "");
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    if (path === "/") return "";
    return path;
  }

  private _joinInternalPath(basename: string, to: string): string {
    const base = this._normalizeBasename(basename);
    // accept "about" as "/about"
    let path = to.startsWith("/") ? to : "/" + to;
    path = this._normalizePathname(path);
    if (!base) return path;
    // keep "/app/" for root
    if (path === "/") return base + "/";
    return base + path;
  }

  private _notifyLocationChange(): void {
    // For environments without Navigation API (and for Link active-state updates)
    window.dispatchEvent(new CustomEvent("wcs:navigate"));
  }

  private _getBasename(): string {
    const base = new URL(document.baseURI);
    let path = base.pathname || "/";
    if (path === "/") {
      return "";
    }
    return this._normalizeBasename(path);
  }

  static get instance(): IRouter {
    if (!Router._instance) {
      raiseError(`${config.tagNames.router} has not been instantiated.`);
    }
    return Router._instance;
  }

  static navigate(path: string): void {
    Router.instance.navigate(path);
  }

  get basename(): string {
    return this._basename;
  }

  private _getOutlet(): IOutlet {
    let outlet = document.querySelector<Outlet>(config.tagNames.outlet);
    if (!outlet) {
      outlet = createOutlet();
      document.body.appendChild(outlet);
    }
    return outlet;
  }

  private _getTemplate() {
    const template = this.querySelector("template");
    return template;
  }
  
  get outlet(): IOutlet {
    if (!this._outlet) {
      raiseError(`${config.tagNames.router} has no outlet.`);
    }
    return this._outlet;
  }

  get template(): HTMLTemplateElement {
    if (!this._template) {
      raiseError(`${config.tagNames.router} has no template.`);
    }
    return this._template;
  }

  get routeChildNodes(): IRoute[] {
    return this._routeChildNodes;
  }

  get path(): string {
    return this._path;
  }
  /**
   * applyRoute 内で設定される値です。
   */
  set path(value: string) {
    this._path = value;
  }

  get fallbackRoute(): IRoute | null {
    return this._fallbackRoute;
  }
  /**
   * Routeのfallback属性がある場合にそのルートを設定します。
   */
  set fallbackRoute(value: IRoute | null) {
    this._fallbackRoute = value;
  }

  async navigate(path: string): Promise<void> {
    const fullPath = this._joinInternalPath(this._basename, path);
    const navigation = getNavigation();
    if (navigation?.navigate) {
      navigation.navigate(fullPath);
    } else {
      history.pushState(null, '', fullPath);
      await applyRoute(this, this.outlet, fullPath, this._path);
      this._notifyLocationChange();
    }
  }

  private _onNavigateFunc(navEvent: any) {
    if (
      !navEvent.canIntercept ||
      navEvent.hashChange ||
      navEvent.downloadRequest !== null
    ) {
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

  private _onNavigate = this._onNavigateFunc.bind(this);

  private _onPopState = async () => {
    // back/forward for environments without Navigation API
    const fullPath = this._normalizePathname(window.location.pathname);
    await applyRoute(this, this.outlet, fullPath, this._path);
    this._notifyLocationChange();
  };

  private async _initialize(): Promise<void> {
    this._initialized = true;
    this._basename = this._normalizeBasename(
      this.getAttribute("basename") || this._getBasename() || ""
    );
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
  }
}
