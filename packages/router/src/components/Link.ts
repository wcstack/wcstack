import { config } from "../config";
import { getUUID } from "../getUUID";
import { raiseError } from "../raiseError";
import { getNavigation } from "../Navigation";
import { normalizeBasename, normalizePathname } from "../normalizePathname";
import { splitUrlTarget, effectiveSearch } from "../splitUrlTarget";
import { inSsr } from "../inSsr";
import { SSR_LINK_ATTR } from "../ssrMarkers";
import { ILink } from "./types";
import type { Router } from "./Router";

// 生成 anchor へミラーする固定属性（docs/a11y-design.md §5）。`aria-*` は開集合なので
// observedAttributes には載せられず、anchor 生成時の一括コピーのみ（接続後の動的
// aria-* 変更 — data-wcs バインド経由を含む — には追従しない。README の明記された制限）。
const MIRRORED_ATTRIBUTES: readonly string[] = ['title', 'rel', 'target', 'download', 'hreflang'];

export class Link extends HTMLElement implements ILink {
  static get observedAttributes(): string[] {
    return ['to', ...MIRRORED_ATTRIBUTES];
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

  /**
   * router が扱う内部ターゲットか。`/` 始まりに加え、`?` 始まり（クエリのみ遷移 —
   * docs/router-state-contract-design.md §4.1）も内部ターゲットとして受理する。
   */
  private _isInternalTarget(path: string): boolean {
    return path.startsWith('/') || path.startsWith('?');
  }

  private _setAnchorHref(anchor: HTMLAnchorElement,path: string) {
    if (this._isInternalTarget(path)) {
      // basename 結合・正規化は pathname にのみ適用し、search / hash は再結合する。
      // pathname 空（to="?k=v"）は「現在 pathname + 指定クエリ」で組み立てる。
      const { pathname, search, hash } = splitUrlTarget(path);
      const joined = pathname === ""
        ? window.location.pathname
        : this._joinInternalPath(this.router.basename, pathname);
      anchor.href = joined + effectiveSearch(search) + hash;
    } else {
      try {
        anchor.href = new URL(path).toString();
      } catch {
        raiseError(`[${config.tagNames.link}] Invalid URL in 'to' attribute: ${path}`);
      }
    }
  }

  connectedCallback() {
    if (inSsr()) {
      // SSR（docs/ssr-router-design.md §3.2 / §4）: happy-dom のパーサは開始タグ
      // 時点で cc を呼ぶため、同期のまま進めると静的 Link の子が空のまま
      // anchor 化される。パースは同期完了するので 1 microtask 譲る。
      // renderToString は待機プロトコル要素（state / router）の await で
      // microtask を消化するため、serialize より先にこの初期化は完了する。
      queueMicrotask(() => {
        if (this.isConnected) {
          this._connect();
        }
      });
      return;
    }
    this._connect();
  }

  /**
   * サーバーが生成した目印付き anchor（直後の兄弟）。クライアントの採用対象
   */
  private _findSsrAnchor(): HTMLAnchorElement | null {
    const next = this.nextElementSibling;
    if (next !== null && next.tagName === 'A' && next.hasAttribute(SSR_LINK_ATTR)) {
      return next as HTMLAnchorElement;
    }
    return null;
  }

  private _connect(): void {
    if (!this._initialized) {
      this._initialize();
    }
    const parentNode = this.parentNode;
    if (!parentNode) {
      // should not happen if connected
      return;
    }
    const ssrAnchor = this._findSsrAnchor();
    let link: HTMLAnchorElement;
    if (ssrAnchor !== null) {
      // SSR 採用: サーバーの anchor をそのまま自分の anchor にする。
      // 生成経路（cc）でホストの子は anchor へ移動済みなので、子の正本は anchor 側
      link = ssrAnchor;
      link.removeAttribute(SSR_LINK_ATTR);
      this._childNodeArray = Array.from(link.childNodes);
      // href はクライアント側の解決で引き直す（basename / config の検算）
      this._setAnchorHref(link, this._path);
    } else {
      const nextSibling = this.nextSibling;
      link = document.createElement('a');
      this._setAnchorHref(link, this._path);
      // ホスト属性の転送: `aria-*` prefix + 固定 5 名の一括コピー。
      // to / style / class は除外 — ホストは display:none であり、class は active 契約を持つ。
      for (const attr of Array.from(this.attributes)) {
        if (attr.name.startsWith('aria-') || MIRRORED_ATTRIBUTES.includes(attr.name)) {
          link.setAttribute(attr.name, attr.value);
        }
      }
      for(const childNode of this._childNodeArray) {
        link.appendChild(childNode);
      }
      if (nextSibling) {
        parentNode.insertBefore(link, nextSibling);
      } else {
        parentNode.appendChild(link);
      }
    }
    this._anchorElement = link;

    if (inSsr()) {
      // サーバー: リスナは登録しない（レンダリングウィンドウは serialize 後に
      // 閉じる）。active 状態は SSR 出力に載せ、クライアントの採用が引き取る
      // 目印を付ける
      this._updateActiveState();
      link.setAttribute(SSR_LINK_ATTR, '');
      return;
    }

    // ロケーション変更を監視
    getNavigation()?.addEventListener('currententrychange', this._updateActiveState);
    window.addEventListener('wcs:navigate', this._updateActiveState as EventListener);
    window.addEventListener('popstate', this._updateActiveState as EventListener);

    // Navigation API が無い場合は、クリックで router.navigate にフォールバック
    // （`?` 始まりのクエリのみリンクも対象 — 素の href だとフルページ遷移になる）
    if (this._isInternalTarget(this._path) && !getNavigation()?.navigate) {
      this._onClick = async (e: MouseEvent) => {
        // only left-click without modifiers
        if (e.defaultPrevented) return;
        if (e.button !== 0) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        // 動的に外部URLに変わった場合はブラウザのデフォルト挙動に委ねる
        if (!this._isInternalTarget(this._path)) return;
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
    } else if (MIRRORED_ATTRIBUTES.includes(name)) {
      // 固定名のみ接続後も追従する。anchor 生成前（upgrade 前発火）は何もしない。
      const anchor = this._anchorElement;
      if (anchor) {
        if (newValue === null) {
          anchor.removeAttribute(name);
        } else {
          anchor.setAttribute(name, newValue);
        }
      }
    }
  }

  private _updateActiveState = () => {
    // クエリのみリンク（to="?k=v"）の href は現在 pathname に依存するため、
    // active 判定と同じリスナー経路でロケーション変更に追従させる（§4.1）。
    if (this._path.startsWith('?') && this._anchorElement) {
      this._setAnchorHref(this._anchorElement, this._path);
    }
    // active 判定は pathname のみの比較（クエリ非感応 — §1.1 欠陥 7 の修理）。
    const currentPath = this._normalizePathname(new URL(window.location.href).pathname);
    const { pathname } = splitUrlTarget(this._path);
    const linkPath = this._normalizePathname(
      this._isInternalTarget(this._path)
        ? (pathname === ""
            ? window.location.pathname
            : this._joinInternalPath(this.router.basename, pathname))
        : pathname
    );

    if (this._anchorElement) {
      if (currentPath === linkPath) {
        this._anchorElement.classList.add('active');
        // 修理・既定オン（docs/a11y-design.md §3-3）: active class と同じ事実の ARIA 表現。
        // 鮮度保証は active class と同一（同じ分岐・同じ呼び出し経路）。
        this._anchorElement.setAttribute('aria-current', 'page');
      } else {
        this._anchorElement.classList.remove('active');
        this._anchorElement.removeAttribute('aria-current');
      }
    }
  };

  get anchorElement(): HTMLAnchorElement | null {
    return this._anchorElement;
  }
}