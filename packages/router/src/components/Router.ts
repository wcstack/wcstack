import { parse } from "../parse.js";
import { createOutlet, Outlet } from "./Outlet.js";
import { config } from "../config.js";
import { raiseError } from "../raiseError.js";
import { IOutlet, IRoute, IRouter } from "./types.js";
import { IWcBindable } from "../types.js";
import { applyRoute } from "../applyRoute.js";
import { getNavigation } from "../Navigation.js";

/**
 * AppRoutes - Root component for @wcstack/router
 *
 * Container element that manages route definitions and navigation.
 */
export class Router extends HTMLElement implements IRouter {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "navigateUrl", event: "wcs-router:navigate-url-changed" },
      { name: "path", event: "wcs-router:path-changed" },
    ],
  };

  private _outlet: IOutlet | null = null;
  private _template: HTMLTemplateElement | null = null;
  private _routeChildNodes: IRoute[] = [];
  private _basename: string = '';
  private _path: string = '';
  private _initialized: boolean = false;
  private _fallbackRoute: IRoute | null = null;
  private _listeningPopState: boolean = false;
  private _navigateUrl: string | null = null;

  constructor() {
    super();
  }

  /**
   * Normalize a URL pathname to a route path.
   * - ensure leading slash
   * - collapse multiple slashes
   * - treat trailing file extensions (e.g. .html) as directory root
   * - remove trailing slash except root "/"
   */
  private _normalizePathname(_path: string): string {
    let path = _path || "/";
    if (!path.startsWith("/")) path = "/" + path;
    path = path.replace(/\/{2,}/g, "/");
    // e.g. "/app/index.html" -> "/app"
    const exts = config.basenameFileExtensions;
    if (exts.length > 0) {
      const extPattern = new RegExp(
        `\\/[^/]+(?:${exts.map(e => e.replace(/\./g, '\\.')).join('|')})$`,
        'i'
      );
      path = path.replace(extPattern, "");
    }
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
    const exts = config.basenameFileExtensions;
    if (exts.length > 0) {
      const extPattern = new RegExp(
        `\\/[^/]+(?:${exts.map(e => e.replace(/\./g, '\\.')).join('|')})$`,
        'i'
      );
      path = path.replace(extPattern, "");
    }
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

  get basename(): string {
    return this._basename;
  }

  private _getOutlet(): IOutlet {
    // 自身を起点に兄弟・子孫から Outlet を探す（マルチ Router 対応）
    const next = this.nextElementSibling;
    if (next && next.matches(config.tagNames.outlet)) {
      return next as unknown as IOutlet;
    }
    // なければ新規作成して自身の直後に挿入
    const outlet = createOutlet();
    if (this.parentNode) {
      this.parentNode.insertBefore(outlet, this.nextSibling);
    } else {
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
    const changed = this._path !== value;
    this._path = value;
    if (changed) {
      this.dispatchEvent(new CustomEvent("wcs-router:path-changed", {
        detail: value,
        bubbles: true,
      }));
    }
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

  get navigateUrl(): string | null {
    return this._navigateUrl;
  }

  set navigateUrl(value: string | null) {
    if (value === null || value === undefined || value === "") return;
    this._navigateUrl = value;
    this.navigate(value).then(() => {
      this._navigateUrl = null;
      this.dispatchEvent(new CustomEvent("wcs-router:navigate-url-changed", {
        detail: null,
        bubbles: true,
      }));
    });
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

  /**
   * basename 配下の URL かどうかを判定する。
   * basename が空の場合はすべての URL にマッチする。
   */
  private _isOwnPath(fullPath: string): boolean {
    if (this._basename === "") return true;
    return fullPath === this._basename || fullPath.startsWith(this._basename + "/");
  }

  private _onNavigateFunc(navEvent: any) {
    if (
      !navEvent.canIntercept ||
      navEvent.hashChange ||
      navEvent.downloadRequest !== null
    ) {
      return;
    }
    const url = new URL(navEvent.destination.url);
    const fullPath = this._normalizePathname(url.pathname);
    // basename 配下でない URL は無視（マルチ Router 対応）
    if (!this._isOwnPath(fullPath)) return;
    const routesNode = this;
    navEvent.intercept({
      handler: async () => {
        await applyRoute(routesNode, routesNode.outlet, fullPath, routesNode.path);
      },
    });
  }

  private _onNavigate = this._onNavigateFunc.bind(this);

  private _onPopState = async () => {
    // back/forward for environments without Navigation API
    const fullPath = this._normalizePathname(window.location.pathname);
    // basename 配下でない URL は無視（マルチ Router 対応）
    if (!this._isOwnPath(fullPath)) return;
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
  }
}
