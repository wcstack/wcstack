import { config } from "../config";
import { getUUID } from "../getUUID";
import { raiseError } from "../raiseError";
import { getNavigation } from "../Navigation";
export class Link extends HTMLElement {
    _childNodeArray = [];
    _uuid = getUUID();
    _commentNode = document.createComment(`@@link:${this._uuid}`);
    _path = "";
    _router = null;
    _anchorElement = null;
    _initialized = false;
    _onClick;
    constructor() {
        super();
    }
    get uuid() {
        return this._uuid;
    }
    get commentNode() {
        return this._commentNode;
    }
    get router() {
        if (this._router) {
            return this._router;
        }
        const router = document.querySelector(config.tagNames.router);
        if (router) {
            return (this._router = router);
        }
        raiseError(`${config.tagNames.link} is not connected to a router.`);
    }
    _initialize() {
        this.replaceWith(this._commentNode); // Link 要素自体は DOM から取り除く
        this._childNodeArray = Array.from(this.childNodes);
        this._path = this.getAttribute('to') || '';
        this._initialized = true;
    }
    _normalizePathname(path) {
        let p = path || "/";
        if (!p.startsWith("/"))
            p = "/" + p;
        p = p.replace(/\/{2,}/g, "/");
        if (p.length > 1 && p.endsWith("/"))
            p = p.slice(0, -1);
        return p;
    }
    _joinInternalPath(basename, to) {
        const base = (basename || "").replace(/\/{2,}/g, "/").replace(/\/$/, "");
        const internal = to.startsWith("/") ? to : "/" + to;
        const path = this._normalizePathname(internal);
        if (!base)
            return path;
        if (path === "/")
            return base + "/";
        return base + path;
    }
    connectedCallback() {
        if (!this._initialized) {
            this._initialize();
        }
        const parentNode = this._commentNode.parentNode;
        if (!parentNode) {
            raiseError(`${config.tagNames.link} comment node has no parent`);
        }
        const nextSibling = this._commentNode.nextSibling;
        const link = document.createElement('a');
        if (this._path.startsWith('/')) {
            link.href = this._joinInternalPath(this.router.basename, this._path);
        }
        else {
            link.href = new URL(this._path).toString();
        }
        for (const childNode of this._childNodeArray) {
            link.appendChild(childNode);
        }
        if (nextSibling) {
            parentNode.insertBefore(link, nextSibling);
        }
        else {
            parentNode.appendChild(link);
        }
        this._anchorElement = link;
        // ロケーション変更を監視
        getNavigation()?.addEventListener('currententrychange', this._updateActiveState);
        window.addEventListener('wcs:navigate', this._updateActiveState);
        window.addEventListener('popstate', this._updateActiveState);
        // Navigation API が無い場合は、クリックで router.navigate にフォールバック
        if (this._path.startsWith('/') && !getNavigation()?.navigate) {
            this._onClick = async (e) => {
                // only left-click without modifiers
                if (e.defaultPrevented)
                    return;
                if (e.button !== 0)
                    return;
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
                    return;
                e.preventDefault();
                await this.router.navigate(this._path);
                this._updateActiveState();
            };
            link.addEventListener('click', this._onClick);
        }
        this._updateActiveState();
    }
    disconnectedCallback() {
        getNavigation()?.removeEventListener('currententrychange', this._updateActiveState);
        window.removeEventListener('wcs:navigate', this._updateActiveState);
        window.removeEventListener('popstate', this._updateActiveState);
        if (this._anchorElement) {
            if (this._onClick) {
                this._anchorElement.removeEventListener('click', this._onClick);
                this._onClick = undefined;
            }
            this._anchorElement.remove();
        }
        for (const childNode of this._childNodeArray) {
            childNode.parentNode?.removeChild(childNode);
        }
    }
    _updateActiveState = () => {
        const currentPath = this._normalizePathname(new URL(window.location.href).pathname);
        const linkPath = this._normalizePathname(this._path.startsWith('/') ? this._joinInternalPath(this.router.basename, this._path) : this._path);
        if (this._anchorElement) {
            if (currentPath === linkPath) {
                this._anchorElement.classList.add('active');
            }
            else {
                this._anchorElement.classList.remove('active');
            }
        }
    };
}
//# sourceMappingURL=Link.js.map