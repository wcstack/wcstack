import { IWcBindable, WcsSseMessage } from "../types.js";
import { SseCore } from "../core/SseCore.js";

export class WcsSse extends HTMLElement {
  // SSR (§4.1/§4.4): wc-bindable アダプタはこのフラグを見て connectedCallbackPromise を
  // 待ってからスナップショットを取る。SSE には同期接続しか無いが、骨格を全 IO ノードで
  // 揃えるため observe() の戻り（即解決）を connectedCallbackPromise として公開する。
  static hasConnectedCallbackPromise = true;
  static wcBindable: IWcBindable = {
    ...SseCore.wcBindable,
    properties: [
      ...SseCore.wcBindable.properties,
      { name: "trigger", event: "wcs-sse:trigger-changed" },
    ],
    inputs: [
      { name: "url", attribute: "url" },
      { name: "withCredentials", attribute: "with-credentials" },
      { name: "events", attribute: "events" },
      { name: "raw", attribute: "raw" },
      { name: "manual", attribute: "manual" },
      { name: "trigger" },
    ],
    // Core の commands をそのまま継承（単一情報源）。<wcs-broadcast>/<wcs-worker> と
    // 同型。spread でも継承されるが、Core に command 追加時の追従漏れを防ぐため明示参照する。
    commands: SseCore.wcBindable.commands,
  };
  // 接続を張り直す価値があるのは url 変更のみ。with-credentials/events/raw/manual は
  // 「初回接続時に評価される接続オプション」であり、observedAttributes に含めない＝
  // 後から属性を変えても既存接続には反映されない（再接続したい場合は close()→connect()）。
  static get observedAttributes(): string[] { return ["url"]; }

  private _core: SseCore;
  private _trigger: boolean = false;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
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

  get url(): string {
    return this.getAttribute("url") || "";
  }

  set url(value: string) {
    this.setAttribute("url", value);
  }

  get withCredentials(): boolean {
    return this.hasAttribute("with-credentials");
  }

  set withCredentials(value: boolean) {
    if (value) {
      this.setAttribute("with-credentials", "");
    } else {
      this.removeAttribute("with-credentials");
    }
  }

  // Shell の events は CSV 文字列（DOM 属性そのまま）。connect() で split して
  // SseCore.connect の string[] options.events に変換する（Core 側は配列）。
  get events(): string {
    return this.getAttribute("events") || "";
  }

  set events(value: string) {
    this.setAttribute("events", value);
  }

  get raw(): boolean {
    return this.hasAttribute("raw");
  }

  set raw(value: boolean) {
    if (value) {
      this.setAttribute("raw", "");
    } else {
      this.removeAttribute("raw");
    }
  }

  get manual(): boolean {
    return this.hasAttribute("manual");
  }

  set manual(value: boolean) {
    if (value) {
      this.setAttribute("manual", "");
    } else {
      this.removeAttribute("manual");
    }
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
    });
  }

  close(): void {
    this._core.close();
  }

  // --- Lifecycle ---

  attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void {
    // newValue が falsy（url を空文字に変更／属性除去）の場合は何もしない＝既存接続を
    // そのまま生かす。これは意図的で broadcast の name 変更と同型：宣言的サーフェスは
    // 「意味のある新 url」に対してのみ張り替え、falsy への変化を切断トリガーとはしない
    // （切断は close() か DOM からの除去で明示的に行う）。
    if (name === "url" && this.isConnected && !this.manual && newValue) {
      this.connect();
    }
  }

  connectedCallback(): void {
    this.style.display = "none";
    // §4.4: observe() の戻り（即解決の ready）を connectedCallbackPromise として保持。
    // SSE は command-driven なので observe() 自体は監視を張らず、実際の接続は下の
    // connect() が行う（観測 surface の確立だけを SSR 契約として公開する）。
    this._connectedCallbackPromise = this._core.observe();
    if (!this.manual && this.url) {
      this.connect();
    }
  }

  disconnectedCallback(): void {
    // §3.5/§4.4: dispose() は _gen を進めて進行中リスナを無効化しつつ接続を閉じる。
    this._core.dispose();
  }
}
