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

  constructor() {
    super();
    if (Router._instance) {
      raiseError(`${config.tagNames.router} can only be instantiated once.`);
    }
    Router._instance = this;
  }

  private _normalizePath(_path: string): string {
    let path = _path;
    if (!path.endsWith("/")) {
      path = path.replace(/\/[^/]*$/, "/"); // ファイル名(or末尾セグメント)を落として / で終わらせる
    }

    // 念のため先頭 / と、連続スラッシュの正規化
    if (!path.startsWith("/")) path = "/" + path;
    path = path.replace(/\/{2,}/g, "/");

    return path;
  }

  private _getBasename(): string {
    const base = new URL(document.baseURI);
    let path = base.pathname || "/";
    if (path === "/") {
      return "";
    }
    return this._normalizePath(path);
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
    const fullPath = this._basename + path;
    const navigation = getNavigation();
    if (navigation?.navigate) {
      navigation.navigate(fullPath);
    } else {
      history.pushState(null, '', fullPath);
      await applyRoute(this, this.outlet, fullPath, this._path);
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
      async handler() {
        const url = new URL(navEvent.destination.url);
        await applyRoute(routesNode, routesNode.outlet, url.pathname, this._path);
      }
    });
  }

  private _onNavigate = this._onNavigateFunc.bind(this);

  private async _initialize(): Promise<void> {
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
