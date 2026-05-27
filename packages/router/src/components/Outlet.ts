import { config } from "../config.js";
import { raiseError } from "../raiseError.js";
import { IOutlet, IRoute, IRouter } from "./types.js";

export class Outlet extends HTMLElement implements IOutlet {
  private _routesNode: IRouter | null = null;
  private _lastRoutes: IRoute[] = [];
  private _initialized: boolean = false;
  constructor() {
    super();
  }

  get routesNode(): IRouter {
    if (!this._routesNode) {
      raiseError(`${config.tagNames.outlet} has no routesNode.`);
    }
    return this._routesNode;
  }
  set routesNode(value: IRouter) {
    this._routesNode = value;
  }

  get rootNode(): HTMLElement | ShadowRoot {
    if (this.shadowRoot) {
      return this.shadowRoot;
    }
    return this;
  }

  get lastRoutes(): IRoute[] {
    return this._lastRoutes;
  }
  set lastRoutes(value: IRoute[]) {
    this._lastRoutes = [ ...value ];
  }

  /**
   * shadowRoot 有効化判定。Layout と挙動を揃え、属性で個別オーバーライド可能にする。
   * - `enable-shadow-root` 属性あり → true
   * - `disable-shadow-root` 属性あり → false
   * - いずれもなし → config.enableShadowRoot を尊重
   */
  private _resolveEnableShadowRoot(): boolean {
    if (this.hasAttribute('enable-shadow-root')) {
      return true;
    }
    if (this.hasAttribute('disable-shadow-root')) {
      return false;
    }
    return config.enableShadowRoot;
  }

  private _initialize() {
    if (this._resolveEnableShadowRoot()) {
      this.attachShadow({ mode: 'open' });
    }
    this._initialized = true;
  }

  connectedCallback() {
    if (!this._initialized) {
      this._initialize();
    }
  }

  /**
   * Outlet が disconnect された際の状態クリーンアップ。
   *
   * `_lastRoutes` をクリアすることで、再接続後の applyRoute における diff
   * （既に show 済みのルートは show を skip する判定）が、切断中に外部から
   * 操作された DOM と整合しなくなる事故を防ぐ。
   *
   * 仕様前提として Outlet は Router と一体運用される（Router が `_getOutlet()` で
   * 自身の兄弟に Outlet を配置・参照する）。それでも単独で再接続される
   * エッジケースに備える防衛的措置として `_lastRoutes` のみクリアする。
   * `_initialized` と shadowRoot は維持し、再 attachShadow による
   * InvalidStateError を回避する。
   */
  disconnectedCallback() {
    this._lastRoutes = [];
  }
}

export function createOutlet(): Outlet {
  return document.createElement(config.tagNames.outlet) as Outlet;
}
