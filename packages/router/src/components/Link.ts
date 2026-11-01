import { config } from "../config";
import { getUUID } from "../getUUID";
import { raiseError } from "../raiseError";
import { getNavigation } from "../Navigation";
import { normalizeBasename, normalizePathname } from "../normalizePathname";
import { splitUrlTarget, effectiveSearch } from "../splitUrlTarget";
import { queryEquals, queryIncludes, queryKeysEqual } from "../searchParams";
import { inSsr } from "../inSsr";
import { SSR_LINK_ATTR } from "../ssrMarkers";
import { ILink } from "./types";
import type { Router } from "./Router";

// 生成 anchor へミラーする固定属性（docs/a11y-design.md §5）。`lang` / `dir` は SR の
// 読み上げ言語・方向に直結するため含める（多言語ナビで anchor 側に届かないと
// 読み上げが崩れる）。`aria-*` は開集合なので observedAttributes には載せられず、
// anchor 生成時の一括コピーのみ（接続後の動的 aria-* 変更 — data-wcs バインド経由を
// 含む — には追従しない。`for:` の行・`if:` の枝の中のリンクは接続前に束ねられるので、
// その時の値はコピーされる。README の明記された制限）。
const MIRRORED_ATTRIBUTES: readonly string[] = ['title', 'rel', 'target', 'download', 'hreflang', 'lang', 'dir'];

export class Link extends HTMLElement implements ILink {
  static get observedAttributes(): string[] {
    return ['to', 'match', 'query-keys', ...MIRRORED_ATTRIBUTES];
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
    // サーバーでは書かない: 直列化されると style 属性になり、厳しい style-src が拒む（docs/seam-apps.md、
    // ssr-news）。サーバーのホストは子を anchor へ移して空なので、隠さなくても見えない。
    // クライアントは upgrade でここを通り、CSSOM で書く
    if (!inSsr()) this.style.display = "none";
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
    if (path === '') {
      // 行き先がまだ無い: `attr.to:` の束縛が書く前に接続した（router を state より先に読むページ、
      // SSR の描き直す行 — docs/seam-apps.md、ssr-news）。href の無い <a> にして、`to` が来たら
      // attributeChangedCallback が書く。以前は外部 URL として throw し、anchor を作らずに終わっていた
      anchor.removeAttribute('href');
      return;
    }
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
      // microtask の中では投げない: 捕まえる者がいないので、Node ではプロセスが落ちる — router の無い
      // ページ、URL として読めない `to` で（docs/seam-apps.md、ssr-news）。サーバーのコンソールに報告し、
      // リンクは描かない（ホストが子を持ったまま出力される。クライアントでは従来どおり throw する）
      queueMicrotask(() => {
        if (this.isConnected) {
          try {
            this._connect();
          } catch (error) {
            console.error(error);
          }
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
      // ホスト属性の転送: `aria-*` prefix + 固定 7 名の一括コピー。
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
    // （`to` がまだ空のリンクも: 後から来る行き先は内部のことが多い。外部ならクリック時に素通しする）
    if ((this._path === '' || this._isInternalTarget(this._path)) && !getNavigation()?.navigate) {
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
    if ((name === 'match' || name === 'query-keys') && oldValue !== newValue) {
      // anchor 生成前（upgrade の属性の通知 — まだ router の下に居ないことがある）は接続時の判定に任せる
      if (this._anchorElement) {
        this._updateActiveState();
      }
      return;
    }
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
    // active 判定は pathname の比較（§1.1 欠陥 7 の修理）に、`to` のクエリを足す（`to` にクエリが無ければ
    // pathname だけ）。そのページ（aria-current="page"）は今のページのクエリが `to` のクエリと等しいとき、
    // match="prefix" なら含むときも（"true"、パスの「下」と同じ）。`/search?q=a` の「次のページ」
    // （`?q=a&page=2`）が「現在のページ」と読み上げられ（docs/seam-apps.md、city-library）、含む規則では
    // `page` を省いた 1 ページ目へのリンクがどのページでもそうだった（city-library の取り込み）。
    // `?` で終わる `to`（`to="/notices?"`、`to="?"` — 明示した空のクエリ）もクエリのある `to` で、そのページは
    // クエリの無いページだけ（href からは `?` を落とす）。クエリの無い `to` と同じに pathname だけで比べていたので、
    // 「すべて」のタブが `/notices?cat=event` でも現在のページで、現在のリンクが 2 つになった（docs/seam-apps.md、homeroom）
    //
    // `query-keys` はクエリのうち比べるキーを名指す。そのページそのもの（"page"）は今までどおりクエリ全体が等しいとき、
    // 名指したキーだけが等しければ "true"（どちらにも無いキーは等しい）。クエリの無い `to` もキーで比べる。ページも
    // クエリにある一覧では、`to="/notices?"` の「すべて」のタブは 1 ページ目でしか現在にならず、`match="prefix"` なら
    // どの区分でも現在だった — `query-keys="cat"` ならどのページでも「すべて」だけ（docs/seam-apps.md、homeroom の取り込み）
    const current = new URL(window.location.href);
    const currentPath = this._normalizePathname(current.pathname);
    const { pathname, search } = splitUrlTarget(this._path);
    const wanted = effectiveSearch(search);
    const keys = (this.getAttribute('query-keys') ?? '').split(/[\s,]+/).filter((key) => key !== '');
    const queryIncluded = queryIncludes(current.search, wanted);
    const queryEqual = (search === '' && keys.length === 0) || queryEquals(current.search, wanted);
    const linkPath = this._normalizePathname(
      this._isInternalTarget(this._path)
        ? (pathname === ""
            ? window.location.pathname
            : this._joinInternalPath(this.router.basename, pathname))
        : pathname
    );

    // match="prefix": 下のパスでも、`to` のクエリを含む余分なパラメータ付きのクエリでも active（サイドナビの
    // 「商品」が /products/3 でも印を付ける — docs/seam-apps.md、router-admin）。そのページそのものではないので
    // aria-current は "true"
    // 行き先の無いリンク（`to` が空）はどこでも active ではない（空のパスは "/" に正規化される）
    const samePath = currentPath === linkPath;
    const prefix = this.getAttribute('match') === 'prefix';
    const below = prefix && currentPath.startsWith(linkPath + '/');
    const exact = this._path !== '' && samePath && queryEqual;
    const within = !exact && this._path !== '' && (samePath || below) && (keys.length > 0
      ? queryKeysEqual(current.search, wanted, keys)
      : prefix && queryIncluded);
    if (this._anchorElement) {
      if (exact || within) {
        this._anchorElement.classList.add('active');
        // 修理・既定オン（docs/a11y-design.md §3-3）: active class と同じ事実の ARIA 表現。
        // 鮮度保証は active class と同一（同じ分岐・同じ呼び出し経路）。
        this._anchorElement.setAttribute('aria-current', exact ? 'page' : 'true');
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