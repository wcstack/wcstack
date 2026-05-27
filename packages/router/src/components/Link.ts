import { config } from "../config";
import { getUUID } from "../getUUID";
import { raiseError } from "../raiseError";
import { getNavigation } from "../Navigation";
import { normalizeBasename, normalizePathname } from "../normalizePathname";
import { ILink } from "./types";
import type { Router } from "./Router";

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
  
  /**
   * 最寄りの Router を返す。
   *
   * 注意: この getter は DOM 走査で Router を探すため、
   * Router がまだ upgrade されていない場合は HTMLElement として返る可能性がある。
   * 通常は registerComponents() で Router を Link より先に upgrade することを推奨する。
   */
  get router(): Router {
    if (this._router) {
      return this._router;
    }
    // DOM 祖先走査で最寄りの Router を探す（マルチ Router 対応）
    const ancestor = this.closest<Router>(config.tagNames.router);
    if (ancestor) {
      return (this._router = ancestor);
    }
    // 祖先にない場合は ownerDocument 内の Router を探す
    const root = this.getRootNode() as Document | ShadowRoot;
    const found = root.querySelector?.<Router>(config.tagNames.router);
    if (found) {
      return (this._router = found);
    }
    raiseError(`${config.tagNames.link} is not connected to a router.`);
  }

  private _initialize() {
    this.style.display = "none";
    this._childNodeArray = Array.from(this.childNodes);
    this._path = this.getAttribute('to') || '';
    this._initialized = true;
  }

  /**
   * URL pathname を正規化する。Router と共通実装を使うことで
   * basenameFileExtensions の取り扱いを揃え、active 判定の取りこぼしを防ぐ。
   */
  private _normalizePathname(path: string): string {
    return normalizePathname(path);
  }

  private _joinInternalPath(basename: string, to: string): string {
    // Router._joinInternalPath と挙動を揃える
    const base = normalizeBasename(basename);
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
        // 動的に外部URLに変わった場合はブラウザのデフォルト挙動に委ねる
        if (!this._path.startsWith('/')) return;
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
    const anchor = this._anchorElement;
    if (anchor) {
      if (this._onClick) {
        anchor.removeEventListener('click', this._onClick);
        this._onClick = undefined;
      }
      anchor.remove();
      this._anchorElement = null;
    }
    // anchor 配下のままだった子要素のみ取り除く（別の親に移動されていた場合に誤って strip しないため）
    for(const childNode of this._childNodeArray) {
      if (anchor && childNode.parentNode === anchor) {
        anchor.removeChild(childNode);
      }
    }
    // Router キャッシュをクリア。別の Router 配下に動的に移動された場合や
    // Router 自体が入れ替わった場合に古い参照を返さないようにする。
    this._router = null;
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