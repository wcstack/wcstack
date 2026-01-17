import { parse } from "../parse.js";
import { createOutlet } from "./Outlet.js";
import { config } from "../config.js";
import { raiseError } from "../raiseError.js";
import { applyRoute } from "../applyRoute.js";
import { getNavigation } from "../Navigation.js";
/**
 * AppRoutes - Root component for wc-router
 *
 * Container element that manages route definitions and navigation.
 */
export class Router extends HTMLElement {
    static _instance = null;
    _outlet = null;
    _template = null;
    _routeChildNodes = [];
    _basename = '';
    _path = '';
    _initialized = false;
    _fallbackRoute = null;
    constructor() {
        super();
        if (Router._instance) {
            raiseError(`${config.tagNames.router} can only be instantiated once.`);
        }
        Router._instance = this;
    }
    _normalizePath(_path) {
        let path = _path;
        if (!path.endsWith("/")) {
            path = path.replace(/\/[^/]*$/, "/"); // ファイル名(or末尾セグメント)を落として / で終わらせる
        }
        // 念のため先頭 / と、連続スラッシュの正規化
        if (!path.startsWith("/"))
            path = "/" + path;
        path = path.replace(/\/{2,}/g, "/");
        return path;
    }
    _getBasename() {
        const base = new URL(document.baseURI);
        let path = base.pathname || "/";
        if (path === "/") {
            return "";
        }
        return this._normalizePath(path);
    }
    static get instance() {
        if (!Router._instance) {
            raiseError(`${config.tagNames.router} has not been instantiated.`);
        }
        return Router._instance;
    }
    static navigate(path) {
        Router.instance.navigate(path);
    }
    get basename() {
        return this._basename;
    }
    _getOutlet() {
        let outlet = document.querySelector(config.tagNames.outlet);
        if (!outlet) {
            outlet = createOutlet();
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
        this._path = value;
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
    async navigate(path) {
        const fullPath = this._basename + path;
        const navigation = getNavigation();
        if (navigation?.navigate) {
            navigation.navigate(fullPath);
        }
        else {
            history.pushState(null, '', fullPath);
            await applyRoute(this, this.outlet, fullPath, this._path);
        }
    }
    _onNavigateFunc(navEvent) {
        if (!navEvent.canIntercept ||
            navEvent.hashChange ||
            navEvent.downloadRequest !== null) {
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
    _onNavigate = this._onNavigateFunc.bind(this);
    async _initialize() {
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
//# sourceMappingURL=Router.js.map