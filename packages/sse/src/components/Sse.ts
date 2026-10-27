import { IWcBindable, WcsSseMessage } from "../types.js";
import { SseCore } from "../core/SseCore.js";
import { WcsIoErrorInfo } from "../core/platformCapability.js";
import { upgradeProperties } from "../protocol/upgradeProperties.js";
import { reflectAttribute, reflectBooleanAttribute } from "../protocol/inputAttribute.js";

export class WcsSse extends HTMLElement {
  // SSR (§4.1/§4.4): wc-bindable アダプタはこのフラグを見て connectedCallbackPromise を
  // 待ってからスナップショットを取る。SSE には同期接続しか無いが、骨格を全 IO ノードで
  // 揃えるため observe() の戻り（即解決）を connectedCallbackPromise として公開する。
  static hasConnectedCallbackPromise = true;
  static wcBindable: IWcBindable = {
    ...SseCore.wcBindable,
    properties: [
      ...SseCore.wcBindable.properties,
      { name: "trigger", event: "wcs-sse:trigger-changed", semantics: "state" },
    ],
    inputs: [
      { name: "url", attribute: "url" },
      { name: "withCredentials", attribute: "with-credentials" },
      { name: "events", attribute: "events" },
      { name: "raw", attribute: "raw" },
      { name: "autoReconnect", attribute: "auto-reconnect" },
      { name: "reconnectInterval", attribute: "reconnect-interval" },
      { name: "maxReconnects", attribute: "max-reconnects" },
      { name: "staleAfter", attribute: "stale-after" },
      { name: "manual", attribute: "manual" },
      { name: "trigger" },
    ],
    // Core の commands をそのまま継承（単一情報源）。<wcs-broadcast>/<wcs-worker> と
    // 同型。spread でも継承されるが、Core に command 追加時の追従漏れを防ぐため明示参照する。
    commands: SseCore.wcBindable.commands,
  };
  // 接続を張り直す価値があるのは url 変更のみ。with-credentials/events/raw/manual と
  // auto-reconnect/reconnect-interval/max-reconnects/stale-after は
  // 「初回接続時に評価される接続オプション」であり、observedAttributes に含めない＝
  // 後から属性を変えても既存接続には反映されない（再接続したい場合は close()→connect()）。
  static get observedAttributes(): string[] { return ["url"]; }

  private _core: SseCore;
  private _trigger: boolean = false;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  // _scheduleConnect のマイクロタスクが待っている間 true
  private _connectPending = false;
  private _internals: ElementInternals | null = null;

  constructor() {
    super();
    this._core = new SseCore(this);
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-sse:connected-changed": (d) => ({ connected: d === true }),
      "wcs-sse:loading-changed":   (d) => ({ loading: d === true }),
      "wcs-sse:error":             (d) => ({ error: d != null }),
    });
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

  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  // --- Attribute accessors ---
  //
  // setter は null / undefined を setAttribute に文字列化させない（"undefined" の url は
  // attributeChangedCallback が EventSource を /undefined へ張ってしまう）。`null` は属性を
  // 外して既定値へ、`undefined` は要素が最初に持っていた属性へ戻す（wc-bindable producer
  // guidance P1。React 19 や直接の代入は undefined を書く。@wcstack/state は書かない）。

  get url(): string {
    return this.getAttribute("url") || "";
  }

  set url(value: string | null | undefined) {
    reflectAttribute(this, "url", value);
  }

  get withCredentials(): boolean {
    return this.hasAttribute("with-credentials");
  }

  set withCredentials(value: boolean | null | undefined) {
    reflectBooleanAttribute(this, "with-credentials", value);
  }

  // Shell の events は CSV 文字列（DOM 属性そのまま）。connect() で split して
  // SseCore.connect の string[] options.events に変換する（Core 側は配列）。
  get events(): string {
    return this.getAttribute("events") || "";
  }

  set events(value: string | null | undefined) {
    reflectAttribute(this, "events", value);
  }

  get raw(): boolean {
    return this.hasAttribute("raw");
  }

  set raw(value: boolean | null | undefined) {
    reflectBooleanAttribute(this, "raw", value);
  }

  // auto-reconnect / reconnect-interval / max-reconnects は <wcs-ws> と同じ名前・同じ解釈
  // （既定 false / 3000 / Infinity、数でない値は既定）。接続オプションで、接続するときに読む。
  // 開き直すのはブラウザが諦めたストリーム（恒久エラー）だけ。
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

  get manual(): boolean {
    return this.hasAttribute("manual");
  }

  set manual(value: boolean | null | undefined) {
    reflectBooleanAttribute(this, "manual", value);
  }

  // 何も届かない時間（ms）がこれを超えた開いているストリームを、失われたとみなして開き直す
  // （0・未指定・数でない値は見張らない）。接続オプションの 1 つで、接続するときに読む。
  get staleAfter(): number {
    const parsed = Number(this.getAttribute("stale-after"));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  set staleAfter(value: number | null | undefined) {
    reflectAttribute(this, "stale-after", value);
  }

  // --- Core delegated getters ---

  get message(): WcsSseMessage | null {
    return this._core.message;
  }

  get connected(): boolean {
    return this._core.connected;
  }

  get loading(): boolean {
    return this._core.loading;
  }

  get error(): Event | Error | null {
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
      // try/finally で connect() が将来例外を投げても _trigger 固着を防ぎ、
      // auto-reset と完了通知（wcs-sse:trigger-changed）を必ず実行する。
      try {
        this.connect();
      } finally {
        this._trigger = false;
        this.dispatchEvent(new CustomEvent("wcs-sse:trigger-changed", {
          detail: false,
          bubbles: true,
        }));
      }
    }
  }

  // --- Public methods ---

  connect(): void {
    // 明示の connect（trigger も）と close は、待っている接続時の判断を引き取る
    this._connectPending = false;
    // Shell は宣言的サーフェス：url 未設定での connect()/trigger は静かに no-op する
    // （SseCore.connect("") は programmatic 誤用向けに throw するが、state 配線で trigger
    // が url より先に立っただけで例外が更新サイクルを壊すのは避ける。broadcast の
    // Broadcast.open() が `if (this.name)` でガードするのと同型）。
    if (!this.url) {
      return;
    }

    const events = this.events
      ? this.events.split(",").map(e => e.trim()).filter(Boolean)
      : undefined;

    this._core.connect(this.url, {
      withCredentials: this.withCredentials,
      events,
      raw: this.raw,
      staleAfter: this.staleAfter,
      autoReconnect: this.autoReconnect,
      reconnectInterval: this.reconnectInterval,
      maxReconnects: this.maxReconnects,
      // 開き直しは試行のときの url で（state の getter が url を作るなら、更新したトークンが入っている）。
      // 空なら何もしない。
      reconnectUrl: this._currentUrl,
    });
  }

  private _currentUrl = (): string => this.url;

  close(): void {
    this._connectPending = false;
    this._core.close();
  }

  // --- Lifecycle ---

  attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void {
    // newValue が falsy（url を空文字に変更／属性除去）の場合は何もしない＝既存接続を
    // そのまま生かす。これは意図的で broadcast の name 変更と同型：宣言的サーフェスは
    // 「意味のある新 url」に対してのみ張り替え、falsy への変化を切断トリガーとはしない
    // （切断は close() か DOM からの除去で明示的に行う）。
    if (name === "url" && this.isConnected && !this.manual && newValue) {
      this._scheduleConnect();
    }
  }

  // 接続の判断はマイクロタスクで、そのときの url / manual で 1 回だけ行う
  // （timing-and-firing-contract §23）。router は遷移で同じノードを入れ直し、新しいルートの
  // params から state が url を書くのはマイクロタスク — その場で接続すると前の url を使う
  // （docs/seam-apps.md、shift-desk）。間の url の変化もここへまとまる。
  private _scheduleConnect(): void {
    if (this._connectPending) return;
    this._connectPending = true;
    queueMicrotask(() => {
      if (!this._connectPending) return; // an explicit command took the decision meanwhile
      this._connectPending = false;
      if (this.isConnected && !this.manual && this.url) {
        this.connect();
      }
    });
  }

  connectedCallback(): void {
    // upgrade 前に代入された input を取り込み直す（doc 13 §1.2 / Phase A1）
    upgradeProperties(this);
    this.style.display = "none";
    // §4.4: observe() の戻り（即解決の ready）を connectedCallbackPromise として保持。
    // SSE は command-driven なので observe() 自体は監視を張らず、実際の接続は
    // _scheduleConnect が行う（観測 surface の確立だけを SSR 契約として公開する）。
    this._connectedCallbackPromise = this._core.observe();
    this._scheduleConnect();
  }

  disconnectedCallback(): void {
    // §3.5/§4.4: dispose() は _gen を進めて進行中リスナを無効化しつつ接続を閉じる
    // （待っている auto-reconnect のタイマーも外す）。
    this._core.dispose();
  }
}
