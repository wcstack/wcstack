import { config } from "../config.js";
import { IWcBindable } from "../types.js";
import { WebSocketCore } from "../core/WebSocketCore.js";
import { WcsIoErrorInfo } from "../core/platformCapability.js";
import { registerAutoTrigger } from "../autoTrigger.js";
import { upgradeProperties } from "../protocol/upgradeProperties.js";
import { reflectAttribute, reflectBooleanAttribute } from "../protocol/inputAttribute.js";

export class WcsWebSocket extends HTMLElement {
  static hasConnectedCallbackPromise = true;
  static wcBindable: IWcBindable = {
    ...WebSocketCore.wcBindable,
    properties: [
      ...WebSocketCore.wcBindable.properties,
      { name: "trigger", event: "wcs-ws:trigger-changed", semantics: "state" },
      { name: "send", event: "wcs-ws:send-changed", semantics: "state" },
    ],
    inputs: [
      { name: "url", attribute: "url" },
      { name: "protocols", attribute: "protocols" },
      { name: "autoReconnect", attribute: "auto-reconnect" },
      { name: "reconnectInterval", attribute: "reconnect-interval" },
      { name: "maxReconnects", attribute: "max-reconnects" },
      { name: "binaryType", attribute: "binary-type" },
      { name: "staleAfter", attribute: "stale-after" },
      { name: "manual", attribute: "manual" },
      { name: "trigger" },
      { name: "send" },
    ],
    commands: [
      { name: "connect" },
      { name: "sendMessage" },
      { name: "close" },
    ],
  };
  static get observedAttributes(): string[] { return ["url"]; }

  private _core: WebSocketCore;
  private _trigger: boolean = false;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  private _internals: ElementInternals | null = null;
  // connectedCallback が接続の判断を終えてから disconnectedCallback までの間だけ true。
  // url 属性の変化による再接続はこの間に限る — upgrade 時は attributeChangedCallback が
  // connectedCallback より先に（isConnected のまま）呼ばれるので、そこで接続すると
  // connectedCallback の接続と合わせて 2 本になる。初回の接続は connectedCallback が持つ。
  private _attached = false;
  // _scheduleConnect のマイクロタスクが待っている間 true
  private _connectPending = false;

  constructor() {
    super();
    this._core = new WebSocketCore(this);
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-ws:connected-changed": (d) => ({ connected: d === true }),
      "wcs-ws:loading-changed":   (d) => ({ loading: d === true }),
      "wcs-ws:error":             (d) => ({ error: d != null }),
    });
  }

  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  // CSS state reflection (:state()) — debug-only snapshot getter. NOT part of
  // wc-bindable (not a bind target); see README "CSS styling with :state()".
  // MUST NOT return the live CustomStateSet (that would let callers write
  // states from outside, defeating the point of :state() being read-only).
  get debugStates(): string[] {
    return this._internals ? [...this._internals.states] : [];
  }

  private _initInternals(): ElementInternals | null {
    // never-throw (async-io-node-guidelines.md §3.6): attachInternals is absent
    // in happy-dom / older environments, and pre-125 Chromium rejects
    // non-dashed state names from states.add() (probed and discarded here).
    // Either case silently disables reflection — the component still works,
    // it just doesn't expose :state() selectors.
    try {
      if (typeof this.attachInternals !== "function") return null;
      const internals = this.attachInternals();
      internals.states.add("wcs-probe");
      internals.states.delete("wcs-probe");
      return internals;
    } catch {
      return null;
    }
  }

  private _wireStates(map: Record<string, (detail: any) => Record<string, boolean>>): void {
    if (this._internals === null) return;
    const states = this._internals.states;
    for (const [event, toStates] of Object.entries(map)) {
      this.addEventListener(event, (e) => {
        const debug = this.hasAttribute("debug-states");
        for (const [name, on] of Object.entries(toStates((e as CustomEvent).detail))) {
          try {
            if (on) { states.add(name); } else { states.delete(name); }
          } catch { /* never-throw */ }
          if (debug) this.toggleAttribute(`data-wcs-state-${name}`, on);
        }
      });
    }
  }

  // --- Attribute accessors ---
  //
  // Input setters never let setAttribute stringify null / undefined (an
  // "undefined" url would reconnect to "undefined"): `null` removes the
  // attribute (the documented default; an empty url does not connect),
  // `undefined` restores the attribute the element started with (wc-bindable
  // producer guidance P1; React 19 and a direct assignment deliver it,
  // @wcstack/state does not).

  get url(): string {
    return this.getAttribute("url") || "";
  }

  set url(value: string | null | undefined) {
    reflectAttribute(this, "url", value);
  }

  get protocols(): string {
    return this.getAttribute("protocols") || "";
  }

  set protocols(value: string | null | undefined) {
    reflectAttribute(this, "protocols", value);
  }

  get autoReconnect(): boolean {
    return this.hasAttribute("auto-reconnect");
  }

  set autoReconnect(value: boolean | null | undefined) {
    reflectBooleanAttribute(this, "auto-reconnect", value);
  }

  get reconnectInterval(): number {
    const attr = this.getAttribute("reconnect-interval");
    const parsed = attr ? parseInt(attr, 10) : 3000;
    return Number.isNaN(parsed) ? 3000 : parsed;
  }

  set reconnectInterval(value: number | null | undefined) {
    reflectAttribute(this, "reconnect-interval", value);
  }

  get maxReconnects(): number {
    const attr = this.getAttribute("max-reconnects");
    const parsed = attr ? parseInt(attr, 10) : Infinity;
    return Number.isNaN(parsed) ? Infinity : parsed;
  }

  set maxReconnects(value: number | null | undefined) {
    reflectAttribute(this, "max-reconnects", value);
  }

  // Incoming binary frame representation. Backed by the `binary-type` attribute;
  // any value other than "arraybuffer" normalizes to the platform default "blob".
  get binaryType(): BinaryType {
    return this.getAttribute("binary-type") === "arraybuffer" ? "arraybuffer" : "blob";
  }

  set binaryType(value: string | null | undefined) {
    reflectAttribute(this, "binary-type", value);
  }

  // 何も届かない時間（ms）がこれを超えた開いている接続を、失われたとみなす（0・未指定・数でない
  // 値は見張らない）。接続オプションの 1 つで、接続するときに読む。
  get staleAfter(): number {
    const parsed = Number(this.getAttribute("stale-after"));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  set staleAfter(value: number | null | undefined) {
    reflectAttribute(this, "stale-after", value);
  }

  get manual(): boolean {
    return this.hasAttribute("manual");
  }

  set manual(value: boolean | null | undefined) {
    reflectBooleanAttribute(this, "manual", value);
  }

  // --- Core delegated getters ---

  get message(): any {
    return this._core.message;
  }

  get connected(): boolean {
    return this._core.connected;
  }

  get loading(): boolean {
    return this._core.loading;
  }

  get error(): any {
    return this._core.error;
  }

  get errorInfo(): WcsIoErrorInfo | null {
    return this._core.errorInfo;
  }

  get readyState(): number {
    return this._core.readyState;
  }

  // --- Command properties ---

  get trigger(): boolean {
    return this._trigger;
  }

  set trigger(value: boolean) {
    const v = !!value;
    if (v) {
      this._trigger = true;
      this.connect();
      this._trigger = false;
      this.dispatchEvent(new CustomEvent("wcs-ws:trigger-changed", {
        detail: false,
        bubbles: true,
      }));
    }
  }

  // `send` is a write-only command surface: assigning transmits immediately.
  // Reading always returns null (no payload is retained) — consistent with the
  // null carried by wcs-ws:send-changed and the documented "resets to null".
  get send(): any {
    return null;
  }

  set send(data: any) {
    if (data === null || data === undefined) return;
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    this._core.send(payload);
    this.dispatchEvent(new CustomEvent("wcs-ws:send-changed", {
      detail: null,
      bubbles: true,
    }));
  }

  // --- Public methods ---

  connect(): void {
    // an explicit connect (trigger included) or close takes the pending connect-time decision
    this._connectPending = false;
    const protocols = this.protocols
      ? this.protocols.split(",").map(p => p.trim()).filter(Boolean)
      : undefined;

    this._core.connect(this.url, {
      protocols: protocols && protocols.length === 1 ? protocols[0] : protocols,
      autoReconnect: this.autoReconnect,
      reconnectInterval: this.reconnectInterval,
      maxReconnects: this.maxReconnects,
      binaryType: this.binaryType,
      staleAfter: this.staleAfter,
    });
  }

  sendMessage(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this._core.send(data);
  }

  close(code?: number, reason?: string): void {
    this._connectPending = false;
    this._core.close(code, reason);
  }

  // --- Lifecycle ---

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    // 再接続するのは url が「変わった」ときだけ。同じ値の書き込み（url の setter 自身の
    // setAttribute の後に、属性も書く binder — @wcstack/state 3.x の inputs[].attribute ミラー —
    // が同じ値を書く、など）
    // は何もしない。connectedCallback より前（upgrade 中・DOM の外）の変化は、
    // connectedCallback がそのときの url で 1 回だけ接続する。
    if (name === "url" && oldValue !== newValue && this._attached && !this.manual && newValue) {
      this._scheduleConnect();
    }
  }

  // 接続の判断はマイクロタスクで、そのときの url / manual で 1 回だけ行う
  // （timing-and-firing-contract §23）。router は遷移で同じノードを入れ直し、新しいルートの
  // params から state が url を書くのはマイクロタスク — その場で接続すると、前の url へ
  // つないでから閉じていた（docs/seam-apps.md、shift-desk）。間の url の変化もここへまとまる。
  private _scheduleConnect(): void {
    if (this._connectPending) return;
    this._connectPending = true;
    queueMicrotask(() => {
      if (!this._connectPending) return; // an explicit command took the decision meanwhile
      this._connectPending = false;
      if (this._attached && !this.manual && this.url) {
        this.connect();
      }
    });
  }

  connectedCallback(): void {
    // upgrade 前に代入された input を取り込み直す（doc 13 §1.2 / Phase A1）。
    // ここで url の setter が走っても _attached はまだ false なので接続しない —
    // 接続は下で、取り込み後の url / manual を見て 1 回だけ行う。
    upgradeProperties(this);
    this.style.display = "none";
    if (config.autoTrigger) {
      registerAutoTrigger();
    }
    // observe() は command-driven node では ready を返す no-op（§3.5）。SSR は
    // connectedCallbackPromise を await して初期スナップショットを取れる。
    this._connectedCallbackPromise = this._core.observe();
    this._attached = true;
    window.addEventListener("pagehide", this._onPageHide);
    window.addEventListener("pageshow", this._onPageShow);
    this._scheduleConnect();
  }

  // back/forward cache（docs/seam-apps.md、shift-desk）: 開いた WebSocket はページを cache から外す
  // （Chromium は復元しない — 理由 "websocket"）。ページが cache に入りうるとき（pagehide の persisted）
  // 閉じて終わりをその場で知らせ、戻ったとき（pageshow の persisted）、閉じる前に接続していたなら
  // つなぎ直す。ページが自分で閉じると、閉じた知らせは復元の後に届き、pageshow の時点の state は
  // まだ接続中だった。
  private _reopenOnShow = false;

  private _onPageHide = (event: Event): void => {
    if (!(event as PageTransitionEvent).persisted) return;
    if (this._core.suspend()) this._reopenOnShow = true;
  };

  private _onPageShow = (event: Event): void => {
    if (!(event as PageTransitionEvent).persisted || !this._reopenOnShow) return;
    this._reopenOnShow = false;
    // (the listeners live only while the element is connected)
    if (this.url) this.connect();
  };

  disconnectedCallback(): void {
    this._attached = false;
    this._reopenOnShow = false;
    window.removeEventListener("pagehide", this._onPageHide);
    window.removeEventListener("pageshow", this._onPageShow);
    // dispose() が _gen を bump して進行中のソケット/再接続を無効化し、close() する。
    this._core.dispose();
  }
}
