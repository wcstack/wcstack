import {
  IMidiDevice, IMidiMessage, IMidiOptions, IWcBindable, MidiMessageType,
  MidiPermissionState, WcsIoErrorInfo,
} from "../types.js";
import { MidiCore } from "../core/MidiCore.js";
import { upgradeProperties } from "../protocol/upgradeProperties.js";
import { reflectAttribute, reflectBooleanAttribute } from "../protocol/inputAttribute.js";

/**
 * `<wcs-midi>` — declarative Web MIDI input/output.
 *
 * Nothing happens on connect: `requestMIDIAccess()` can raise a permission
 * prompt, so access is command-driven (`command.request`). Add the `auto`
 * attribute to opt into requesting as soon as the element connects.
 */
export class WcsMidi extends HTMLElement {
  static hasConnectedCallbackPromise = true;
  static observedAttributes = ["input", "output", "channel"];

  static wcBindable: IWcBindable = {
    ...MidiCore.wcBindable,
    inputs: [
      { name: "input", attribute: "input" },
      { name: "output", attribute: "output" },
      { name: "channel", attribute: "channel" },
      { name: "sysex", attribute: "sysex" },
      { name: "auto", attribute: "auto" },
    ],
  };

  private _core: MidiCore;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  // connectedCallback が張った connectedCallbackPromise を解く関数。接続時の判断を下す
  // _scheduleRequest のマイクロタスクが（その前に外れたときは disconnectedCallback が）呼ぶ。
  private _connectResolve: ((value: void | PromiseLike<void>) => void) | null = null;
  // _scheduleRequest のマイクロタスクが待っている間 true
  private _requestPending: boolean = false;
  // 接続時の判断待ちに close() が呼ばれたら true — その判断は auto でも要求しない
  private _autoCancelled: boolean = false;
  private _internals: ElementInternals | null = null;

  constructor() {
    super();
    this._core = new MidiCore(null, this);
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-midi:permission": (d) => ({
        granted: d === "granted",
        denied: d === "denied",
        unsupported: d === "unsupported",
      }),
      "wcs-midi:statechange": (d) => ({ connected: d === true }),
      "wcs-midi:error": (d) => ({ error: d !== null }),
    });
  }

  // CSS state reflection (:state()) — debug-only snapshot getter. NOT part of
  // wc-bindable (not a bind target); see README "CSS styling with :state()".
  get debugStates(): string[] {
    return this._internals ? [...this._internals.states] : [];
  }

  private _initInternals(): ElementInternals | null {
    // never-throw (async-io-node-guidelines.md §3.6): attachInternals is absent
    // in happy-dom / older environments, and pre-125 Chromium rejects non-dashed
    // state names. Either case silently disables reflection.
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
  // Input setters never let setAttribute stringify null / undefined (an
  // "undefined" input / output would select a port named "undefined", i.e. none),
  // and the booleans do not use toggleAttribute (an `undefined` force flips the
  // attribute): `null` removes the attribute (the default — every port, every
  // channel, off), `undefined` restores the attribute the element started with
  // (wc-bindable producer guidance P1; React 19 and a direct assignment deliver
  // it, @wcstack/state does not).

  get input(): string { return this.getAttribute("input") ?? ""; }
  set input(value: string | null | undefined) { reflectAttribute(this, "input", value); }

  get output(): string { return this.getAttribute("output") ?? ""; }
  set output(value: string | null | undefined) { reflectAttribute(this, "output", value); }

  get channel(): number | null {
    const raw = this.getAttribute("channel");
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  set channel(value: number | null | undefined) {
    reflectAttribute(this, "channel", value);
  }

  get sysex(): boolean { return this.hasAttribute("sysex"); }
  set sysex(value: boolean | null | undefined) { reflectBooleanAttribute(this, "sysex", value); }

  get auto(): boolean { return this.hasAttribute("auto"); }
  set auto(value: boolean | null | undefined) { reflectBooleanAttribute(this, "auto", value); }

  // --- Core delegated getters ---

  get message(): IMidiMessage | null { return this._core.message; }
  get type(): MidiMessageType | null { return this._core.type; }
  get note(): number | null { return this._core.note; }
  get velocity(): number | null { return this._core.velocity; }
  get control(): number | null { return this._core.control; }
  get value(): number | null { return this._core.value; }
  get devices(): IMidiDevice[] { return this._core.devices; }
  get connected(): boolean { return this._core.connected; }
  get permission(): MidiPermissionState { return this._core.permission; }
  get granted(): boolean { return this._core.granted; }
  get denied(): boolean { return this._core.denied; }
  get unsupported(): boolean { return this._core.unsupported; }
  get error(): string | null { return this._core.error; }
  get errorInfo(): WcsIoErrorInfo | null { return this._core.errorInfo; }

  /** Headless escape hatch: the Core backing this element. */
  get core(): MidiCore { return this._core; }

  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  // --- Commands ---

  request(): Promise<void> {
    // 要求の sysex は属性が正本。接続時の判断（マイクロタスク）が Core へ渡すより先の
    // request() でも、接続の後に sysex が変わった後でも、いまの属性で要求するよう渡しておく
    this._core.setOptions(this._options());
    return this._core.request();
  }

  close(): void {
    // 接続時の判断待ちなら、その auto の要求を取り消す — 同じタスクの append → close() で、
    // 後のマイクロタスクが要求しないように（判断が同期だった頃は、始めた要求を close() が
    // 捨てていた）。入れ直せば、次の判断は auto に従う
    if (this._connectResolve !== null) this._autoCancelled = true;
    this._core.close();
  }
  send(data: number[] | Uint8Array, timestamp?: number): void { this._core.send(data, timestamp); }

  // --- Internal ---

  private _options(): IMidiOptions {
    return {
      input: this.input,
      output: this.output,
      channel: this.channel,
      sysex: this.sysex,
      auto: this.auto,
    };
  }

  // --- Lifecycle ---

  // 接続時の要求の判断はマイクロタスクで、そのときの auto / sysex（と input / output /
  // channel）で 1 回だけ行う（timing-and-firing-contract §23）。router は遷移で同じノードを
  // 入れ直し、新しいルートの params から state が入力を書くのはマイクロタスク — その場で
  // 判断すると、前の auto / sysex で requestMIDIAccess を起こしていた（docs/seam-apps.md、
  // shift-desk）。
  private _scheduleRequest(): void {
    if (this._requestPending) return;
    this._requestPending = true;
    queueMicrotask(() => {
      this._requestPending = false;
      const resolveConnect = this._connectResolve;
      this._connectResolve = null;
      // 判断の前に外れた要素は何もしない（disconnectedCallback が解いて null にした）
      if (resolveConnect === null) return;
      const options = this._options();
      // 判断待ちに close() が呼ばれていたら、auto でも要求しない
      if (this._autoCancelled) options.auto = false;
      this._autoCancelled = false;
      resolveConnect(this._core.observe(options));
    });
  }

  connectedCallback(): void {
    // upgrade 前に代入された input を取り込み直す（doc 13 §1.2 / Phase A1）
    upgradeProperties(this);
    this.style.display = "none";
    // connectedCallbackPromise は接続時の判断（auto なら要求の結果）が済むまでを表す。
    // 判断はマイクロタスクなので、ここで張って _scheduleRequest で解く
    this._connectedCallbackPromise = new Promise<void>((resolve) => {
      this._connectResolve = resolve;
    });
    this._scheduleRequest();
  }

  disconnectedCallback(): void {
    // 判断の前に外れたら、張った connectedCallbackPromise をここで解く — 同じタスクで
    // 入れ直されると次の connectedCallback が張り替えるので、待つ側が取り残されないように
    this._connectResolve?.();
    this._connectResolve = null;
    this._autoCancelled = false;
    this._core.dispose();
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) return;
    // Port selection and channel filtering are live: they re-hook the existing
    // access rather than re-requesting it (no second permission prompt). They only
    // record the options and re-hook (no request), so they stay synchronous; the
    // connect-time decision reads them again.
    if (this.isConnected) this._core.setOptions(this._options());
  }
}
