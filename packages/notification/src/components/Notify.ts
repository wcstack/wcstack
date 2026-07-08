import { config } from "../config.js";
import {
  IWcBindable, NotifyBackend, NotifyOptions, PermissionStateOrUnsupported,
  WcsNotifyClickDetail, WcsNotifyErrorDetail,
} from "../types.js";
import { NotificationCore } from "../core/NotificationCore.js";
import { registerAutoTrigger } from "../autoTrigger.js";

/**
 * `<wcs-notify>` — declarative desktop notifications. Wraps NotificationCore and
 * exposes both directions in one tag:
 *
 * - **`notice`** (reactive input): writing a *changed* value shows a notification,
 *   suppressing same-value writes so it fires only when the bound source actually
 *   changes. The imperative `notify` command instead shows on demand (even the
 *   same text again). See `docs/notification-tag-design.md` § 2.
 * - **`request` / `notify` / `close` / `closeAll`** commands (state → element).
 * - per-notification options (`body` / `icon` / `badge` / `tag` / `lang` / `dir` /
 *   `require-interaction` / `silent` / `renotify`) as mirrored attributes.
 * - `mode` selects the show backend (`auto` / `sw` / `constructor`).
 * - the Core's observable surface (permission / granted / … / error / clicked /
 *   closed / shown) via delegated getters; clicked/closed/shown carry the
 *   `{ tag, data, action }` payload for event-token wiring.
 */
export class WcsNotify extends HTMLElement {
  static hasConnectedCallbackPromise = true;
  static wcBindable: IWcBindable = {
    ...NotificationCore.wcBindable,
    // Shell-level settable surface. `notice` is a momentary reactive command-property
    // with no mirrored attribute (it carries dynamic text, not declarative config),
    // mirroring <wcs-speak>'s `say`. The rest mirror their HTML attributes idempotently.
    inputs: [
      { name: "notice" },
      { name: "mode", attribute: "mode" },
      { name: "body", attribute: "body" },
      { name: "icon", attribute: "icon" },
      { name: "badge", attribute: "badge" },
      { name: "tag", attribute: "tag" },
      { name: "lang", attribute: "lang" },
      { name: "dir", attribute: "dir" },
      { name: "requireInteraction", attribute: "require-interaction" },
      { name: "silent", attribute: "silent" },
      { name: "renotify", attribute: "renotify" },
      { name: "manual", attribute: "manual" },
    ],
    commands: NotificationCore.wcBindable.commands,
  };

  private _core: NotificationCore;
  private _notice: string = "";
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  private _internals: ElementInternals | null = null;

  constructor() {
    super();
    this._core = new NotificationCore(this);
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-notify:permission-change": (d) => ({
        granted: d === "granted", denied: d === "denied",
        prompt: d === "prompt", unsupported: d === "unsupported",
      }),
      "wcs-notify:error": (d) => ({ error: d != null }),
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

  // --- Attribute accessors ---

  get mode(): NotifyBackend {
    const m = this.getAttribute("mode");
    return (m === "sw" || m === "constructor") ? m : "auto";
  }

  set mode(value: NotifyBackend) {
    this.setAttribute("mode", value);
  }

  get body(): string {
    return this.getAttribute("body") ?? "";
  }

  set body(value: string | null) {
    this._reflect("body", value);
  }

  get icon(): string {
    return this.getAttribute("icon") ?? "";
  }

  set icon(value: string | null) {
    this._reflect("icon", value);
  }

  get badge(): string {
    return this.getAttribute("badge") ?? "";
  }

  set badge(value: string | null) {
    this._reflect("badge", value);
  }

  get tag(): string {
    return this.getAttribute("tag") ?? "";
  }

  set tag(value: string | null) {
    this._reflect("tag", value);
  }

  // NOTE: `lang` and `dir` intentionally repurpose the standard HTMLElement IDL
  // attributes as per-notification options (forwarded to NotificationOptions).
  // This element is always display:none, so overriding their normal rendering
  // semantics has no visual effect — but be aware the values mean "the
  // notification's language/direction", not the host element's.
  get lang(): string {
    return this.getAttribute("lang") ?? "";
  }

  set lang(value: string | null) {
    this._reflect("lang", value);
  }

  get dir(): string {
    return this.getAttribute("dir") ?? "";
  }

  set dir(value: string | null) {
    this._reflect("dir", value);
  }

  get requireInteraction(): boolean {
    return this.hasAttribute("require-interaction");
  }

  set requireInteraction(value: boolean) {
    this._reflectBool("require-interaction", value);
  }

  get silent(): boolean {
    return this.hasAttribute("silent");
  }

  set silent(value: boolean) {
    this._reflectBool("silent", value);
  }

  get renotify(): boolean {
    return this.hasAttribute("renotify");
  }

  set renotify(value: boolean) {
    this._reflectBool("renotify", value);
  }

  get manual(): boolean {
    return this.hasAttribute("manual");
  }

  set manual(value: boolean) {
    this._reflectBool("manual", value);
  }

  // --- Reactive command-property ---

  get notice(): string {
    return this._notice;
  }

  set notice(value: string | null) {
    // Reactive: writing a new value shows it. `manual` mutes the path entirely
    // (the imperative `notify` command still works). A conforming binder never
    // delivers `undefined` (it skips the write), but a direct assignment can, so
    // normalize null/undefined to a no-op.
    if (value == null) return;
    if (this.manual) return;
    const v = String(value);
    // Same-value guard: only show when the bound source actually changes. To show
    // the same text again on demand, use the `notify` command instead. (This is
    // the only spam guard the package provides — see docs § 2-c; debounce is the
    // caller's job via a filter, e.g. `notice@x|debounce(1000)`.)
    if (v === this._notice) return;
    this._notice = v;
    this.notify(v);
  }

  // --- Core delegated getters ---

  get permission(): PermissionStateOrUnsupported {
    return this._core.permission;
  }

  get granted(): boolean {
    return this._core.granted;
  }

  get denied(): boolean {
    return this._core.denied;
  }

  get prompt(): boolean {
    return this._core.prompt;
  }

  get unsupported(): boolean {
    return this._core.unsupported;
  }

  get error(): WcsNotifyErrorDetail | null {
    return this._core.error;
  }

  get clicked(): WcsNotifyClickDetail | null {
    return this._core.clicked;
  }

  get closed(): WcsNotifyClickDetail | null {
    return this._core.closed;
  }

  get shown(): WcsNotifyClickDetail | null {
    return this._core.shown;
  }

  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  // --- Commands ---

  request(): Promise<PermissionStateOrUnsupported> {
    return this._core.request();
  }

  notify(title: string, options?: NotifyOptions): string {
    // Explicit options (from a command-token emit) win per-key over the attribute
    // defaults, so `notify.emit(title, { body })` still picks up the element's icon.
    return this._core.notify(title, { ...this._options(), ...(options ?? {}) });
  }

  close(tag?: string): void {
    this._core.close(tag);
  }

  closeAll(): void {
    this._core.closeAll();
  }

  // --- Internal ---

  private _reflect(name: string, value: string | null): void {
    if (value == null) {
      this.removeAttribute(name);
    } else {
      this.setAttribute(name, String(value));
    }
  }

  private _reflectBool(name: string, value: boolean): void {
    if (value) {
      this.setAttribute(name, "");
    } else {
      this.removeAttribute(name);
    }
  }

  private _options(): NotifyOptions {
    const o: NotifyOptions = {};
    if (this.body !== "") o.body = this.body;
    if (this.icon !== "") o.icon = this.icon;
    if (this.badge !== "") o.badge = this.badge;
    if (this.tag !== "") o.tag = this.tag;
    if (this.lang !== "") o.lang = this.lang;
    if (this.dir === "auto" || this.dir === "ltr" || this.dir === "rtl") o.dir = this.dir;
    if (this.requireInteraction) o.requireInteraction = true;
    if (this.silent) o.silent = true;
    if (this.renotify) o.renotify = true;
    return o;
  }

  // --- Lifecycle ---

  connectedCallback(): void {
    this.style.display = "none";
    if (config.autoTrigger) {
      registerAutoTrigger();
    }
    // Begin observing permission and subscribing to SW click relays (or revive
    // after a reconnect). The returned promise is held as connectedCallbackPromise
    // for SSR.
    this._connectedCallbackPromise = this._core.observe(this.mode);
  }

  disconnectedCallback(): void {
    // Detach subscriptions. Open notifications are left on screen (see Core docs);
    // call close()/closeAll() to dismiss.
    this._core.dispose();
  }
}
