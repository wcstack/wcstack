import { parse } from "../parse.js";
import { createOutlet } from "./Outlet.js";
import { config } from "../config.js";
import { raiseError } from "../raiseError.js";
import { IOutlet, IRoute, IRouter, IRouterCommit } from "./types.js";
import { IWcBindable } from "../types.js";
import { applyRoute } from "../applyRoute.js";
import { getNavigation } from "../Navigation.js";
import { matchRoutes } from "../matchRoutes.js";
import { normalizeBasename, normalizePathname, sliceBasename } from "../normalizePathname.js";
import { parseSearchParams, shallowEqualRecords } from "../searchParams.js";
import { splitUrlTarget, effectiveSearch } from "../splitUrlTarget.js";
import { upgradeProperties } from "../protocol/upgradeProperties.js";
import { bindSubtree } from "../protocol/binder.js";
import { inSsr } from "../inSsr.js";

interface NavigateEventLike {
  canIntercept: boolean;
  hashChange: boolean;
  downloadRequest: string | null;
  destination: { url: string };
  /** Navigation API の navigationType。mock / polyfill では欠け得る */
  navigationType?: "push" | "replace" | "traverse" | "reload";
  intercept: (options: {
    handler: () => Promise<void>;
    scroll?: "after-transition" | "manual";
    focusReset?: "after-transition" | "manual";
  }) => void;
}

const EMPTY_RECORD: Record<string, never> = Object.freeze({});

/**
 * AppRoutes - Root component for @wcstack/router
 *
 * Container element that manages route definitions and navigation.
 */
export class Router extends HTMLElement implements IRouter {
  /**
   * @wcstack/server の待機プロトコル（docs/ssr-router-design.md §3.2）。
   * renderToString はこのフラグを持つ要素の connectedCallbackPromise を待って
   * からシリアライズする — 初期ルート適用の完了がサーバー出力に反映される。
   */
  static hasConnectedCallbackPromise = true;

  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "navigateUrl", event: "wcs-router:navigate-url-changed", semantics: "state" },
      { name: "replaceUrl", event: "wcs-router:replace-url-changed", semantics: "state" },
      { name: "path", event: "wcs-router:path-changed", semantics: "state" },
      // 観測面（docs/router-state-contract-design.md §3.1）— output-only
      // （properties のみ・inputs に無い）。state 側の既存規範により authority は
      // element（attach 時に要素の現在値を読む）となり、state→element 書き込みは
      // 恒久ブロックされる。params-changed の detail は { params, typedParams }
      // なので、両プロパティとも getter で分派する。
      { name: "params", event: "wcs-router:params-changed", semantics: "state",
        getter: (e: Event) => (e as CustomEvent).detail.params },
      { name: "typedParams", event: "wcs-router:params-changed", semantics: "state",
        getter: (e: Event) => (e as CustomEvent).detail.typedParams },
      { name: "searchParams", event: "wcs-router:search-changed", semantics: "state" },
      { name: "routeName", event: "wcs-router:route-name-changed", semantics: "state" },
    ],
    // `navigateUrl` は observable output であると同時に settable な書き込み面でもある
    // （setter が navigate() を起動し、完了後に自分で null へ戻す）。properties にだけ
    // 宣言すると binding core は output-only とみなし、state → element の書き込みを
    // 抑止するため、state 経由のプログラム遷移が成立しなくなる。`path` は setter が
    // navigate せず内部値の反映だけなので、意図的に output のままにしている。
    inputs: [
      { name: "basename", attribute: "basename" },
      { name: "navigateUrl" },
      { name: "replaceUrl" },
    ],
    commands: [
      { name: "navigate", async: true },
      { name: "replace", async: true },
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
  private _listeningNavigate: boolean = false;
  private _navigateUrl: string | null = null;
  private _replaceUrl: string | null = null;
  private _disconnectedDuringInit: boolean = false;
  private _initializing: boolean = false;
  private _a11yRegion: HTMLElement | null = null;
  // 観測面の内部値（docs/router-state-contract-design.md §3）。露出オブジェクトは
  // frozen スナップショット — params は router の所有物であり、消費側の変異は
  // silent corruption ではなく loud failure にする。
  private _params: Record<string, string> = EMPTY_RECORD;
  private _typedParams: Record<string, any> = EMPTY_RECORD;
  private _searchParams: Record<string, string> = EMPTY_RECORD;
  private _routeName: string = '';
  /** 最初の成功 commit を通過したか（§4.4 の初回ガード） */
  private _hasCommitted: boolean = false;
  private _connectedCallbackPromise: Promise<void>;
  private _resolveConnectedCallback: (() => void) | null = null;
  private _rejectConnectedCallback: ((reason?: unknown) => void) | null = null;

  constructor() {
    super();
    this._connectedCallbackPromise = new Promise<void>((resolve, reject) => {
      this._resolveConnectedCallback = resolve;
      this._rejectConnectedCallback = reject;
    });
  }

  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  get a11yRegion(): HTMLElement | null {
    return this._a11yRegion;
  }

  get focusPolicy(): string | null {
    return this.getAttribute('focus');
  }

  get announcePolicy(): string | null {
    return this.getAttribute('announce');
  }

  /**
   * `announce=` 用 live region を <wcs-router> 直下に空のまま用意する
   * （docs/a11y-design.md §3-4）。
   * - 告知より**前**から DOM に居ないと SR に読まれないため、announce 時の
   *   遅延生成はできない。
   * - outlet 配下はナビゲーションごとに破棄され、オプトインで shadow root にも
   *   なる。document.body 直下は router の寿命を超えて漏れ、マルチ router で
   *   競合する。よって配置は <wcs-router> 直下の一択。
   * - display:none は live region を殺すため、sr-only クリップで隠す。
   */
  private _ensureA11yRegion(): void {
    if (this._a11yRegion !== null) {
      return;
    }
    const region = document.createElement('div');
    region.setAttribute('role', 'status');
    region.style.position = 'absolute';
    region.style.width = '1px';
    region.style.height = '1px';
    region.style.overflow = 'hidden';
    region.style.clipPath = 'inset(50%)';
    region.style.whiteSpace = 'nowrap';
    this.appendChild(region);
    this._a11yRegion = region;
  }

  /**
   * Normalize a URL pathname to a route path.
   * 共通実装は normalizePathname.ts を参照（Link との挙動整合のため）。
   */
  private _normalizePathname(_path: string): string {
    return normalizePathname(_path);
  }

  /**
   * Normalize basename.
   * 共通実装は normalizePathname.ts を参照。
   */
  private _normalizeBasename(_path: string): string {
    return normalizeBasename(_path);
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

  get params(): Record<string, string> {
    return this._params;
  }

  get typedParams(): Record<string, any> {
    return this._typedParams;
  }

  get searchParams(): Record<string, string> {
    return this._searchParams;
  }

  get routeName(): string {
    return this._routeName;
  }

  /**
   * same-match 判定（docs/router-state-contract-design.md §4.4）。
   *
   * 比較は **basename スライス後の path 同士**（`_path` はスライス後で保存済み）。
   * 判定が必要な地点は 2 箇所 — `_onNavigateFunc` の intercept オプション決定時と
   * `applyRoute` の入口分岐 — で、両方がこの単一実装を呼ぶ。
   *
   * 初回ガード: 最初の成功 commit より前には適用しない。初期 `_path = ""` が
   * 正規化後パス（常に `/` 始まり）と一致しないため偶然安全だが、
   * normalizePathname の実装詳細に依存させず規範として明示する。
   */
  isSameMatch(path: string): boolean {
    if (!this._hasCommitted) return false;
    return this._path === path;
  }

  /**
   * 観測面のコミットと発火（docs/router-state-contract-design.md §3.4）。
   *
   * 全内部値を先にコミットし、その後で初めてイベントを発火する — どのイベントの
   * リスナーから要素プロパティを読んでも、遷移後スナップショットの一貫した値が
   * 見える。発火順序は params → route-name → search → path。`path` を最後に
   * 置くのは、既存例で `path` が「ナビゲーション完了」の信号として使われている
   * ため。各イベントは変化した commit のみ発火する。
   */
  commitNavigation(commit: IRouterCommit): void {
    const nextParams = Object.freeze({ ...commit.params });
    const nextTypedParams = Object.freeze({ ...commit.typedParams });
    const nextSearchParams = parseSearchParams(commit.search);
    const paramsChanged = !shallowEqualRecords(this._params, nextParams);
    const routeNameChanged = this._routeName !== commit.routeName;
    const searchChanged = !shallowEqualRecords(this._searchParams, nextSearchParams);
    const pathChanged = this._path !== commit.path;
    // --- 先に全内部値をコミット ---
    // 変化した面だけ差し替える（ナビゲーションごとに新しいオブジェクトになるので
    // state の same-value guard を正しく通過する。不変の面は同一性を保つ）。
    if (paramsChanged) {
      this._params = nextParams;
      this._typedParams = nextTypedParams;
    }
    if (routeNameChanged) {
      this._routeName = commit.routeName;
    }
    if (searchChanged) {
      this._searchParams = nextSearchParams;
    }
    this._path = commit.path;
    this._hasCommitted = true;
    // --- その後で発火（順序規範: params → route-name → search → path） ---
    if (paramsChanged) {
      this.dispatchEvent(new CustomEvent("wcs-router:params-changed", {
        detail: { params: this._params, typedParams: this._typedParams },
        bubbles: true,
      }));
    }
    if (routeNameChanged) {
      this.dispatchEvent(new CustomEvent("wcs-router:route-name-changed", {
        detail: this._routeName,
        bubbles: true,
      }));
    }
    if (searchChanged) {
      this.dispatchEvent(new CustomEvent("wcs-router:search-changed", {
        detail: this._searchParams,
        bubbles: true,
      }));
    }
    if (pathChanged) {
      this.dispatchEvent(new CustomEvent("wcs-router:path-changed", {
        detail: commit.path,
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
    // 既に同一 URL の navigate 中なら再起動しない
    if (this._navigateUrl === value) return;
    this._navigateUrl = value;
    this.navigate(value).catch((err) => {
      console.error(`${config.tagNames.router} navigate failed:`, err);
    }).finally(() => {
      this._navigateUrl = null;
      this.dispatchEvent(new CustomEvent("wcs-router:navigate-url-changed", {
        detail: null,
        bubbles: true,
      }));
    });
  }

  get replaceUrl(): string | null {
    return this._replaceUrl;
  }

  /**
   * navigateUrl と完全同型の null-idle transient（docs/router-state-contract-design.md §4.2）。
   * null は待機・書き込みで replace() を起動・完了で自己リセットして
   * `wcs-router:replace-url-changed`（detail: null）を発火する。
   */
  set replaceUrl(value: string | null) {
    if (value === null || value === undefined || value === "") return;
    // 既に同一 URL の replace 中なら再起動しない
    if (this._replaceUrl === value) return;
    this._replaceUrl = value;
    this.replace(value).catch((err) => {
      console.error(`${config.tagNames.router} replace failed:`, err);
    }).finally(() => {
      this._replaceUrl = null;
      this.dispatchEvent(new CustomEvent("wcs-router:replace-url-changed", {
        detail: null,
        bubbles: true,
      }));
    });
  }

  async navigate(path: string): Promise<void> {
    await this._performNavigation(path, false);
  }

  /**
   * navigateUrl（push）の対になる replace 遷移（docs/router-state-contract-design.md §4.2）。
   * Navigation API では `navigation.navigate(url, { history: "replace" })`、
   * フォールバックでは `history.replaceState` + applyRoute + 通知。
   */
  async replace(path: string): Promise<void> {
    await this._performNavigation(path, true);
  }

  private async _performNavigation(path: string, replace: boolean): Promise<void> {
    // クエリ / ハッシュ込みターゲットの受理（docs/router-state-contract-design.md §4.1）。
    // normalizePathname / basename 結合は pathname にのみ適用し、search / hash は
    // 再結合して URL に渡す。pathname 空（"?k=v" / "?" / "#x"）は現在の pathname を
    // 維持する。search / hash まで空（navigate("")）は従来どおりルート扱い。
    const target = splitUrlTarget(path);
    const fullPath =
      target.pathname === "" && (target.search !== "" || target.hash !== "")
        ? window.location.pathname
        : this._joinInternalPath(this._basename, target.pathname);
    const url = fullPath + effectiveSearch(target.search) + target.hash;
    const navigation = getNavigation();
    if (navigation?.navigate) {
      // Navigation API は { committed, finished } を返す。
      // finished を await することで、navigate() の Promise が
      // 実際のナビゲーション完了まで pending となり、_navigateUrl / _replaceUrl の
      // 二重起動ガード (setter 内の同一値チェック) が適切な時間ウィンドウで機能する。
      // Polyfill や mock 環境で undefined / 戻り値なしのケースもあるため optional chaining。
      const result = replace
        ? navigation.navigate(url, { history: "replace" })
        : navigation.navigate(url);
      await result?.finished;
    } else {
      if (replace) {
        history.replaceState(null, '', url);
      } else {
        history.pushState(null, '', url);
      }
      // セグメントマッチにはクエリ・ハッシュを渡さない（渡すと 404 に落ちる —
      // §1.1 欠陥 6 の修理）。search は明示引数で供給する（§3.6）。
      const normalizedFullPath = this._normalizePathname(fullPath);
      const sameMatch = this.isSameMatch(sliceBasename(normalizedFullPath, this._basename));
      const committed = await applyRoute(
        this, this.outlet, normalizedFullPath, this._path, effectiveSearch(target.search)
      );
      // 修理・既定オン（docs/a11y-design.md §3-2）: Navigation API 経路の仕様既定
      // （scroll: "after-transition" — push はトップへ）とフォールバック経路を揃える。
      // guard 拒否（committed === false）では動かさない。_onPopState 側は
      // history.scrollRestoration によるブラウザ復元が正解なので、決してスクロールしない。
      // same-match（クエリのみ遷移）でも動かさない — 1 打鍵ごとにトップへ戻る事故の
      // 防止（docs/router-state-contract-design.md §4.4）。
      if (committed && !sameMatch) {
        window.scrollTo(0, 0);
      }
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

  private _onNavigateFunc(navEvent: NavigateEventLike) {
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
    // same-match 判定は applyRoute 内の分岐と同じ共有実装（§4.4: スライス後比較）。
    // intercept オプションは applyRoute 実行前に決める必要があるためここでも判定する。
    const sameMatch = this.isSameMatch(sliceBasename(fullPath, this._basename));
    // scroll は navigationType で分岐する: push / replace の same-match は "manual"
    // （検索ボックスにバインドした書き込みの 1 打鍵ごとにスクロールがトップへ戻る
    // 事故の防止）。traverse（戻る/進む）は仕様既定 = ブラウザのスクロール位置復元を
    // 維持する — ?page=2 から戻る操作でスクロールが固定される事故を防ぐ。
    const sameMatchScrollManual =
      sameMatch &&
      (navEvent.navigationType === "push" || navEvent.navigationType === "replace");
    const search = url.search;
    const routesNode = this;
    navEvent.intercept({
      handler: async () => {
        try {
          await applyRoute(routesNode, routesNode.outlet, fullPath, routesNode.path, search);
        } catch (err) {
          console.error(`${config.tagNames.router} applyRoute failed:`, err);
          throw err;
        }
      },
      // 仕様既定の明示（same-match 以外は挙動変更なし）。scroll: push はトップへ /
      // traverse はスクロール位置復元、focusReset: [autofocus] か body へ。この委譲が
      // router のアクセシビリティ契約であり、ここを "manual" に変える変更は
      // 契約の変更にあたる（docs/a11y-design.md §3-1）。same-match の扱いは
      // docs/router-state-contract-design.md §4.4 / D6b。
      scroll: sameMatchScrollManual ? "manual" : "after-transition",
      // focus= 指定時のみ manual。渡さないと router のフォーカス移動とブラウザの
      // after-transition リセットが二重処理になる（docs/a11y-design.md §3-5）。
      // same-match は常に manual — 1 打鍵ごとにフォーカスが body へ飛ぶ事故の防止。
      focusReset: sameMatch || routesNode.focusPolicy !== null ? "manual" : "after-transition",
    });
  }

  private _onNavigate = this._onNavigateFunc.bind(this) as unknown as EventListener;

  private _onPopState = async () => {
    // back/forward for environments without Navigation API
    const fullPath = this._normalizePathname(window.location.pathname);
    // basename 配下でない URL は無視（マルチ Router 対応）
    if (!this._isOwnPath(fullPath)) return;
    // search は明示引数で供給（§3.6）。mock / 特殊環境で欠ける場合は "" 扱い
    await applyRoute(this, this.outlet, fullPath, this._path, window.location.search || "");
    this._notifyLocationChange();
  };

  private async _initialize(): Promise<void> {
    this._initializing = true;
    try {
      const ssr = inSsr();
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
      // SSR: parse は template.content を破壊的に消費する（route 要素は中身を
      // 移された抜け殻になり、非 route ノードは fragment へ移動する）。
      // シリアライズ出力に完全なルート定義を残してクライアントが従来どおり
      // 起動できるよう、退避してパース後に復元する（docs/ssr-router-design.md §3.2）。
      const templateSnapshot = ssr ? this._template.content.cloneNode(true) : null;
      const fragment = await parse(this);
      this._outlet.rootNode.appendChild(fragment);
      if (templateSnapshot !== null) {
        const content = this._template.content;
        while (content.firstChild) {
          content.removeChild(content.firstChild);
        }
        content.appendChild(templateSnapshot);
      }
      if (this.routeChildNodes.length === 0) {
        raiseError(`${config.tagNames.router} has no route definitions.`);
      }
      if (!ssr) {
        // 最初のナビゲーションより十分前に accessibility tree へ載せておく。
        // サーバーでは作らない — 初回描画はアナウンスしない既存規則により不要で、
        // 作るとクライアントの初期化が二重生成する（docs/ssr-router-design.md §3.2）。
        this._ensureA11yRegion();
      }

      const fullPath = this._normalizePathname(window.location.pathname);
      if (ssr) {
        await this._renderForSsr(fullPath);
        this._initialized = true;
        return;
      }
      await applyRoute(this, this.outlet, fullPath, this._path, window.location.search || "");
      this._notifyLocationChange();
      this._initialized = true;
    } finally {
      this._initializing = false;
    }
  }

  /**
   * SSR モードの初期ルート描画（docs/ssr-router-design.md §3.2）。
   * 初回描画は transition arbiter に渡らない既存規則（showRouteContent）により
   * 常に同期適用される。navigate / popstate リスナ・a11y region・
   * `wcs:navigate` 通知はサーバーでは不要（connectedCallback 側で登録しない）。
   */
  private async _renderForSsr(fullPath: string): Promise<void> {
    // guard バリア: guard 付きルートを含むマッチはサーバーで描かない（§2-4）。
    // guard は進入を守る認可点で、サーバーには判断材料（cookie 等）を渡す設計が
    // 無い。outlet を空・マーカー無しのまま返し、クライアントが従来どおり guard を
    // 実行して描く。ハンドラのロードは待たず属性の有無（hasGuard）で判定する。
    const path = sliceBasename(fullPath, this._basename);
    const matchResult = matchRoutes(this, path);
    const routes = matchResult?.routes
      ?? (this._fallbackRoute !== null ? [this._fallbackRoute] : []);
    if (routes.length === 0) {
      // マッチ無しかつ fallback 無し: クライアント（applyRoute）と同じ loud failure
      raiseError(`${config.tagNames.router} No route matched for path: ${path}`);
    }
    if (routes.some((route) => route.hasGuard)) {
      return;
    }
    await applyRoute(this, this.outlet, fullPath, this._path, window.location.search || "");
    // 表示済みルート内容を binder へ差し出す。クライアント初回描画の
    // 「state の走査時に既に document に居る」前提はサーバーでは成立しない —
    // state のロード方式（json 属性は I/O 無し・inline script は dynamic import）と
    // 文書順次第で、state の初回走査が router の挿入より先に完了し得る。binder は
    // 「未構築なら保留して構築末尾で引き取る／構築済みなら同期バインド」の両側を
    // 吸収する。bindRouteContent（showRouteContent 側）は使わない — binder 不在の
    // 警告はサーバーでは誤誘導になるため、warn 無しで直接差し出す。
    for (const route of this.outlet.lastRoutes) {
      for (const node of route.childNodeArray) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          bindSubtree(node);
        }
      }
    }
    // ハイドレーションマーカー（Phase 2 の入力、§3.3）。キーは placeholder の
    // UUID ではなく absolutePath — UUID はパースごとに再生成されクライアントと
    // 一致しない。absolutePath は同一 template から決定的に導ける。
    (this.outlet as unknown as Element).setAttribute('data-wcs-ssr', '');
    for (const route of this.outlet.lastRoutes) {
      // applyRoute 成功後の placeholder は必ず outlet 配下の DOM に居る
      const parentNode = route.placeHolder.parentNode!;
      const contentNodes = route.childNodeArray;
      const start = document.createComment(`@@wcs-route-start:${route.absolutePath}`);
      const end = document.createComment(`@@wcs-route-end:${route.absolutePath}`);
      parentNode.insertBefore(start, contentNodes[0] ?? route.placeHolder.nextSibling);
      const last = contentNodes[contentNodes.length - 1];
      parentNode.insertBefore(end, last ? last.nextSibling : start.nextSibling);
    }
  }

  async connectedCallback() {
    // upgrade 前に代入された input を取り込み直す（doc 13 §1.2 / Phase A1）。
    // await より前に同期で行い、初期化が古い値を読まないようにする。
    upgradeProperties(this);
    // SSR モード（docs/ssr-router-design.md §3.2）:
    // - enable-ssr 無し → サーバーでは一切初期化しない（クライアント専用 = 部分 CSR）
    // - enable-ssr あり → SSR 初期化のみ。navigate / popstate リスナは登録しない
    // どちらも connectedCallbackPromise を必ず決着させる — reject を配管しないと
    // renderToString が mutex を握ったまま無言ハングする（state 側と同じ理由）。
    if (inSsr()) {
      try {
        // happy-dom のパーサは開始タグの時点で connectedCallback を呼ぶため、
        // この時点では子（<template>）がまだパースされていない。パース自体は
        // 同期完了するので、1 microtask 譲れば子が揃う。クライアントでは
        // deferred な auto バンドルの upgrade 時に子が揃っているため不要
        // （サーバー専用の待避、docs/ssr-router-design.md §3.2）。
        await Promise.resolve();
        if (this.hasAttribute('enable-ssr') && !this._initialized) {
          await this._initialize();
        }
      } catch (error) {
        this._rejectConnectedCallback?.(error);
        throw error;
      }
      this._resolveConnectedCallback?.();
      return;
    }
    if (!this._initialized) {
      this._disconnectedDuringInit = false;
      await this._initialize();
      // 初期化中に disconnectedCallback が呼ばれた場合はイベントリスナを登録しない
      if (this._disconnectedDuringInit) {
        this._resolveConnectedCallback?.();
        return;
      }
    }
    // 再接続時は disconnect で撤去された live region を回復する
    // （初回接続では _initialize が生成済みなので no-op）
    if (this._initialized) {
      this._ensureA11yRegion();
    }
    const navigation = getNavigation();
    if (navigation && !this._listeningNavigate) {
      navigation.addEventListener("navigate", this._onNavigate);
      this._listeningNavigate = true;
    }
    // Fallback for browsers without Navigation API
    if (!navigation && !this._listeningPopState) {
      window.addEventListener("popstate", this._onPopState);
      this._listeningPopState = true;
    }
    this._resolveConnectedCallback?.();
  }

  disconnectedCallback() {
    // _initialize 中（await 中）に呼ばれた場合はフラグを立ててリスナ登録をスキップさせる
    if (this._initializing) {
      this._disconnectedDuringInit = true;
    }
    if (this._listeningNavigate) {
      getNavigation()?.removeEventListener("navigate", this._onNavigate);
      this._listeningNavigate = false;
    }
    if (this._listeningPopState) {
      window.removeEventListener("popstate", this._onPopState);
      this._listeningPopState = false;
    }
    // live region は router の寿命に同期して撤去する（body 直下に置かない理由と同根）
    if (this._a11yRegion !== null) {
      this._a11yRegion.remove();
      this._a11yRegion = null;
    }
  }
}
