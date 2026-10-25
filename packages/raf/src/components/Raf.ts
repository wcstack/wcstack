import { config } from "../config.js";
import { IWcBindable } from "../types.js";
import { RafCore } from "../core/RafCore.js";
import { registerAutoTrigger } from "../autoTrigger.js";
import { upgradeProperties } from "../protocol/upgradeProperties.js";
import { reflectAttribute, reflectBooleanAttribute } from "../protocol/inputAttribute.js";

export class Raf extends HTMLElement {
  static hasConnectedCallbackPromise = true;
  static wcBindable: IWcBindable = {
    ...RafCore.wcBindable,
    properties: [
      ...RafCore.wcBindable.properties,
      { name: "trigger", event: "wcs-raf:trigger-changed", semantics: "state" },
    ],
    // Shell-level settable surface. `attribute` is a purely descriptive hint
    // (per SPEC-extensions.md the binding core does not act on it) naming the
    // mirrored HTML attribute, matching <wcs-timer>. `trigger` is a momentary
    // command-property with no backing attribute, so it carries no hint.
    // `start` / `stop` / `reset` / `pause` / `resume` commands are inherited
    // from the Core above. Deliberately absent vs <wcs-timer>: `interval`
    // (rAF has no period) and `immediate` (the first frame already IS the
    // next rendering opportunity — no earlier meaningful moment exists).
    inputs: [
      { name: "once", attribute: "once" },
      { name: "repeat", attribute: "repeat" },
      { name: "manual", attribute: "manual" },
      { name: "reducedMotion", attribute: "reduced-motion" },
      { name: "trigger" },
    ],
  };

  static get observedAttributes(): string[] {
    return ["reduced-motion"];
  }

  private _core: RafCore;
  private _trigger: boolean = false;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  private _internals: ElementInternals | null = null;
  // _scheduleStart のマイクロタスクが待っている間 true
  private _startPending = false;

  constructor() {
    super();
    this._core = new RafCore(this);
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-raf:running-changed": (d) => ({ running: d === true }),
      "wcs-raf:suspended-changed": (d) => ({ suspended: d === true }),
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

  // SSR (§4.1/§4.4): the Shell exposes the Core's readiness so a server-side
  // renderer can await the connect-time probe before snapshotting. There is no
  // async probe here (observe() resolves immediately), but the contract is
  // uniform across IO nodes.
  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  // --- Attribute accessors ---
  //
  // Setters never let setAttribute stringify null / undefined: `null` removes
  // the attribute (the default), `undefined` restores the attribute the element
  // started with (wc-bindable producer guidance P1; React 19 and a direct
  // assignment deliver it, @wcstack/state does not).

  get once(): boolean {
    return this.hasAttribute("once");
  }

  set once(value: boolean | null | undefined) {
    reflectBooleanAttribute(this, "once", value);
  }

  get repeat(): number {
    const attr = this.getAttribute("repeat");
    if (attr === null || attr.trim() === "") return 0;
    // Strict parse via Number() ("3px" -> NaN, not 3), matching <wcs-timer>.
    // Normalise any non-positive / non-numeric value to 0 (= unlimited).
    const parsed = Number(attr);
    return (Number.isFinite(parsed) && parsed > 0) ? parsed : 0;
  }

  set repeat(value: number | null | undefined) {
    reflectAttribute(this, "repeat", value);
  }

  get manual(): boolean {
    return this.hasAttribute("manual");
  }

  set manual(value: boolean | null | undefined) {
    reflectBooleanAttribute(this, "manual", value);
  }

  get reducedMotion(): "run" | "pause" {
    return this._core.reducedMotion;
  }

  set reducedMotion(value: string | null | undefined) {
    // 属性へミラーし、attributeChangedCallback が正規化して Core へ届ける
    // （null は属性を外して既定 "run"、undefined はマークアップの値へ戻す）
    reflectAttribute(this, "reduced-motion", value);
  }

  attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void {
    if (name === "reduced-motion") {
      // 未知値・属性なしは既定 "run" へ正規化（view-transition の setter 慣行）。
      // once/repeat と違い start 時の遅延読みでは足りない — ポリシーは実行中の
      // ループにも効く（reduce 中の付け外しがゲートの付け外し）ため、変更時に
      // Core へ届ける。
      this._core.reducedMotion = newValue === "pause" ? "pause" : "run";
    }
  }

  // --- Core delegated getters ---

  get tick(): number {
    return this._core.tick;
  }

  get elapsed(): number {
    return this._core.elapsed;
  }

  get dt(): number {
    return this._core.dt;
  }

  get running(): boolean {
    return this._core.running;
  }

  get suspended(): boolean {
    return this._core.suspended;
  }

  // --- Command property ---

  get trigger(): boolean {
    return this._trigger;
  }

  set trigger(value: boolean) {
    // Momentary command-property: a false→true write starts the loop. Mirrors
    // <wcs-timer>. Prefer the command-token protocol (`command.start:
    // $command.begin`) for state-driven starts; this exists mainly for the DOM
    // click trigger and simple boolean bindings.
    const v = !!value;
    if (v) {
      this._trigger = true;
      this.start();
      this._trigger = false;
      // The `trigger-changed` event reports the momentary flag returning to
      // false, i.e. that the trigger property *changed* — it is deliberately
      // not gated on whether start() actually began a new run (same contract
      // as <wcs-timer>).
      this.dispatchEvent(new CustomEvent("wcs-raf:trigger-changed", {
        detail: false,
        bubbles: true,
      }));
    }
  }

  // --- Commands ---
  //
  // stop / reset は、接続時の自動 start の予約（_scheduleStart）も取り消す。同じタスクで
  // 接続の後に呼ばれたとき、以前の同期の start を止めたのと同じく何も始めない
  // （timing-and-firing-contract §23）。pause は予約をその場で引き受けてから止める —
  // 以前と同じく、再開（resume）できる一時停止のループが残る。start / resume / trigger は
  // 取り消さない — start は実行中なら no-op（冪等）なので、予約が後から走っても二重に
  // ならない（resume は pause の後でなければ no-op）。

  start(): void {
    // `once` is sugar for "fire exactly one frame": map it to repeat=1, but
    // let an explicit repeat attribute win when both are present.
    const repeat = this.repeat > 0 ? this.repeat : (this.once ? 1 : 0);
    this._core.start({ repeat });
  }

  stop(): void {
    this._startPending = false;
    this._core.stop();
  }

  reset(): void {
    this._startPending = false;
    this._core.reset();
  }

  pause(): void {
    // 予約中の自動 start は、その場のいまの入力で行ってから止める（マイクロタスクと同じ判断）
    if (this._startPending) {
      this._startPending = false;
      if (this.isConnected && !this.manual) {
        this.start();
      }
    }
    this._core.pause();
  }

  resume(): void {
    this._core.resume();
  }

  // --- Lifecycle ---

  // 自動 start の判断はマイクロタスクで、そのときの manual / once / repeat で 1 回だけ行う
  // （timing-and-firing-contract §23）。router は遷移で同じノードを入れ直し、新しいルートの
  // params から state が入力を書くのはマイクロタスク — その場で start すると、前の入力で
  // ループを始めていた（docs/seam-apps.md、shift-desk）。判断の前に外れた要素は何もしない。
  private _scheduleStart(): void {
    if (this._startPending) return;
    this._startPending = true;
    queueMicrotask(() => {
      // stop / reset / pause が予約を取り消していれば何もしない（同じタスクで予約し直して
      // いれば、このマイクロタスクがその判断を受け持ち、後の分は何もしない）
      if (!this._startPending) return;
      this._startPending = false;
      if (this.isConnected && !this.manual) {
        this.start();
      }
    });
  }

  connectedCallback(): void {
    // upgrade 前に代入された input を取り込み直す（doc 13 §1.2 / Phase A1）
    upgradeProperties(this);
    this.style.display = "none";
    if (config.autoTrigger) {
      registerAutoTrigger();
    }
    // Establish monitoring (§3.5): observe() subscribes visibilitychange (the
    // `suspended` output) and resolves once ready; expose it as
    // connectedCallbackPromise for SSR. Note for SSR pages: an auto-started
    // frame loop keeps scheduling — prefer `manual` in server-rendered markup
    // (see README).
    // observe() は入力に依らない（reduced-motion は attributeChangedCallback が随時
    // Core へ届ける）ので、ここで同期に張る。
    this._connectedCallbackPromise = this._core.observe();
    this._scheduleStart();
  }

  disconnectedCallback(): void {
    // dispose() stops the loop, releases the visibility subscription and bumps
    // the generation so a frame already queued cannot fire onto a disconnected
    // element (§3.5 / §4.4).
    this._core.dispose();
  }
}
