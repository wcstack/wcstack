import { config } from "../config";
import { getUUID } from "../getUUID";
import { raiseError } from "../raiseError";
import { getNavigation } from "../Navigation";
import { Router } from "./Router";
import { ILink } from "./types";

export class Link extends HTMLElement implements ILink {
  static get observedAttributes(): string[] {
    return ['to'];
  }

  private _childNodeArray: Node[] = [];
  private _uuid: string = getUUID();
  private _path: string = "";
  private _router: Router | null = null;
  private _anchorElement: HTMLAnchorElement | null = null;
  private _initialized: boolean = false;
  private _onClick?: (e: MouseEvent) => void;

  constructor() {
    super();
  }

  get uuid(): string {
    return this._uuid;
  }
  
  get router(): Router {
    if (this._router) {
      return this._router;
    }
    const router = document.querySelector<Router>(config.tagNames.router);
    if (router) {
      return (this._router = router);
    }
    raiseError(`${config.tagNames.link} is not connected to a router.`);
  }

  private _initialize() {
    this.style.display = "none";
    this._childNodeArray = Array.from(this.childNodes);
    this._path = this.getAttribute('to') || '';
    this._initialized = true;
  }

  private _normalizePathname(path: string): string {
    let p = path || "/";
    if (!p.startsWith("/")) p = "/" + p;
    p = p.replace(/\/{2,}/g, "/");
    if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
    return p;
  }

  private _joinInternalPath(basename: string, to: string): string {
    const base = (basename || "").replace(/\/{2,}/g, "/").replace(/\/$/, "");
    const internal = to.startsWith("/") ? to : "/" + to;
    const path = this._normalizePathname(internal);
    if (!base) return path;
    if (path === "/") return base + "/";
    return base + path;
  }

  private _setAnchorHref(anchor: HTMLAnchorElement,path: string) {
    if (path.startsWith('/')) {
      anchor.href = this._joinInternalPath(this.router.basename, path);
    } else {
      try {
        anchor.href = new URL(path).toString();
      } catch {
        raiseError(`[${config.tagNames.link}] Invalid URL in 'to' attribute: ${path}`);
      }
    }
  }

  connectedCallback() {
    if (!this._initialized) {
      this._initialize();
    }
    const parentNode = this.parentNode;
    if (!parentNode) {
      // should not happen if connected
      return; 
    }
    const nextSibling = this.nextSibling;
    const link = document.createElement('a');
    this._setAnchorHref(link, this._path);
    for(const childNode of this._childNodeArray) {
      link.appendChild(childNode);
    }
    if (nextSibling) {
      parentNode.insertBefore(link, nextSibling);
    } else {
      parentNode.appendChild(link);
    }
    this._anchorElement = link;

    // ロケーション変更を監視
    getNavigation()?.addEventListener('currententrychange', this._updateActiveState);
    window.addEventListener('wcs:navigate', this._updateActiveState as EventListener);
    window.addEventListener('popstate', this._updateActiveState as EventListener);

    // Navigation API が無い場合は、クリックで router.navigate にフォールバック
    if (this._path.startsWith('/') && !getNavigation()?.navigate) {
      this._onClick = async (e: MouseEvent) => {
        // only left-click without modifiers
        if (e.defaultPrevented) return;
        if (e.button !== 0) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
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
    window.removeEventListener('wcs:navigate', this._updateActiveState as EventListener);
    window.removeEventListener('popstate', this._updateActiveState as EventListener);
    if (this._anchorElement) {
      if (this._onClick) {
        this._anchorElement.removeEventListener('click', this._onClick);
        this._onClick = undefined;
      }
      this._anchorElement.remove();
      this._anchorElement = null;
    }
    for(const childNode of this._childNodeArray) {
      childNode.parentNode?.removeChild(childNode);
    }
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
    if (name === 'to' && oldValue !== newValue) {
      this._path = newValue || '';
      if (this._anchorElement) {
        this._setAnchorHref(this._anchorElement, this._path);
        this._updateActiveState();
      }
    }
  }

  private _updateActiveState = () => {
    const currentPath = this._normalizePathname(new URL(window.location.href).pathname);
    const linkPath = this._normalizePathname(
      this._path.startsWith('/') ? this._joinInternalPath(this.router.basename, this._path) : this._path
    );
    
    if (this._anchorElement) {
      if (currentPath === linkPath) {
        this._anchorElement.classList.add('active');
      } else {
        this._anchorElement.classList.remove('active');
      }
    }
  };

  get anchorElement(): HTMLAnchorElement | null {
    return this._anchorElement;
  }
}