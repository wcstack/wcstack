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
            link.href = this.router.basename + this._path;
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
        this._updateActiveState();
    }
    disconnectedCallback() {
        getNavigation()?.removeEventListener('currententrychange', this._updateActiveState);
        if (this._anchorElement) {
            this._anchorElement.remove();
        }
        for (const childNode of this._childNodeArray) {
            childNode.parentNode?.removeChild(childNode);
        }
    }
    _updateActiveState = () => {
        const currentPath = new URL(window.location.href).pathname;
        const linkPath = this.router.basename + this._path;
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