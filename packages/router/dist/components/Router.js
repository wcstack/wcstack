import { parse } from "../parse.js";
import { createOutlet } from "./Outlet.js";
import { config } from "../config.js";
import { raiseError } from "../raiseError.js";
import { applyRoute } from "../applyRoute.js";
import { getNavigation } from "../Navigation.js";
/**
 * AppRoutes - Root component for @wcstack/router
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
    _listeningPopState = false;
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
     * - treat trailing file extensions (e.g. .html) as directory root
     * - remove trailing slash except root "/"
     */
    _normalizePathname(_path) {
        let path = _path || "/";
        if (!path.startsWith("/"))
            path = "/" + path;
        path = path.replace(/\/{2,}/g, "/");
        // e.g. "/app/index.html" -> "/app"
        const exts = config.basenameFileExtensions;
        if (exts.length > 0) {
            const extPattern = new RegExp(`\\/[^/]+(?:${exts.map(e => e.replace(/\./g, '\\.')).join('|')})$`, 'i');
            path = path.replace(extPattern, "");
        }
        if (path === "")
            path = "/";
        if (path.length > 1 && path.endsWith("/"))
            path = path.slice(0, -1);
        return path;
    }
    /**
     * Normalize basename.
     * - "" or "/" -> ""
     * - "/app/" -> "/app"
     * - "/app/index.html" -> "/app"
     */
    _normalizeBasename(_path) {
        let path = _path || "";
        if (!path)
            return "";
        if (!path.startsWith("/"))
            path = "/" + path;
        path = path.replace(/\/{2,}/g, "/");
        const exts = config.basenameFileExtensions;
        if (exts.length > 0) {
            const extPattern = new RegExp(`\\/[^/]+(?:${exts.map(e => e.replace(/\./g, '\\.')).join('|')})$`, 'i');
            path = path.replace(extPattern, "");
        }
        if (path.length > 1 && path.endsWith("/"))
            path = path.slice(0, -1);
        if (path === "/")
            return "";
        return path;
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
        const fullPath = this._joinInternalPath(this._basename, path);
        const navigation = getNavigation();
        if (navigation?.navigate) {
            navigation.navigate(fullPath);
        }
        else {
            history.pushState(null, '', fullPath);
            await applyRoute(this, this.outlet, fullPath, this._path);
            this._notifyLocationChange();
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
            handler: async () => {
                const url = new URL(navEvent.destination.url);
                const fullPath = routesNode._normalizePathname(url.pathname);
                await applyRoute(routesNode, routesNode.outlet, fullPath, routesNode.path);
            },
        });
    }
    _onNavigate = this._onNavigateFunc.bind(this);
    _onPopState = async () => {
        // back/forward for environments without Navigation API
        const fullPath = this._normalizePathname(window.location.pathname);
        await applyRoute(this, this.outlet, fullPath, this._path);
        this._notifyLocationChange();
    };
    async _initialize() {
        this._initialized = true;
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
        if (Router._instance === this) {
            Router._instance = null;
        }
    }
}
//# sourceMappingURL=Router.js.map