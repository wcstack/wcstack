const _config = {
    tagNames: {
        permission: "wcs-permission",
    },
};
function deepFreeze(obj) {
    if (obj === null || typeof obj !== "object")
        return obj;
    Object.freeze(obj);
    for (const key of Object.keys(obj)) {
        deepFreeze(obj[key]);
    }
    return obj;
}
function deepClone(obj) {
    if (obj === null || typeof obj !== "object")
        return obj;
    const clone = {};
    for (const key of Object.keys(obj)) {
        clone[key] = deepClone(obj[key]);
    }
    return clone;
}
let frozenConfig = null;
const config = _config;
function getConfig() {
    if (!frozenConfig) {
        frozenConfig = deepFreeze(deepClone(_config));
    }
    return frozenConfig;
}
/** A misspelt option would otherwise do nothing: `bootstrapPermission` refuses it. */
function invalid(key) {
    throw new Error(`[@wcstack/permission] bootstrapPermission: "${key}" is not one of its options, or not of the option's type.`);
}
/**
 * Applies the options given; an undefined value is left out. An option this package does not
 * have, a value of another type than its default (null, or an array for an object, included) or
 * a tag name it does not define throws, and then nothing is applied.
 */
function setConfig(partialConfig) {
    const options = _config;
    const tags = _config.tagNames;
    const given = Object.entries(partialConfig).filter(([, value]) => value !== undefined);
    const givenTags = Object.entries(partialConfig.tagNames ?? {}).filter(([, tag]) => tag !== undefined);
    for (const [key, value] of given) {
        const current = options[key];
        if (!Object.hasOwn(options, key) || value === null || typeof value !== typeof current || Array.isArray(value) !== Array.isArray(current)) {
            invalid(key);
        }
    }
    for (const [name, tag] of givenTags) {
        if (!Object.hasOwn(tags, name) || typeof tag !== "string")
            invalid(`tagNames.${name}`);
    }
    for (const [name, tag] of givenTags)
        tags[name] = tag;
    frozenConfig = null;
}

var pkg = {"name":"@wcstack/permission","version":"4.11.2"};

// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /io-core/platform-capability.ts by scripts/sync-io-core.mjs.
// Run `node scripts/sync-io-core.mjs` after editing the source.
// ===========================================================================
/** Permissions-Policy が制御する機能(permission 名と同じ文字列)。 */
const POLICY_CONTROLLED = new Set([
    "camera", "microphone", "geolocation", "midi", "clipboard-read", "clipboard-write",
    "screen-wake-lock", "idle-detection", "accelerometer", "gyroscope", "magnetometer",
    "ambient-light-sensor", "display-capture",
]);
function featureUnavailable(feature) {
    const g = globalThis;
    if (g.isSecureContext === false)
        return "insecure-context";
    if (!POLICY_CONTROLLED.has(feature))
        return null;
    const policy = g.document?.permissionsPolicy ?? g.document?.featurePolicy;
    if (policy === undefined || typeof policy.allowsFeature !== "function")
        return null;
    try {
        return policy.allowsFeature(feature) ? null : "policy-blocked";
    }
    catch {
        return null;
    }
}

/**
 * Headless permission-state primitive. A thin, framework-agnostic wrapper around
 * the Permissions API exposed through the wc-bindable protocol.
 *
 * Unlike the other @wcstack IO nodes (geolocation / clipboard / sse / …), the
 * Permissions API is **read-only**: it has `query()` but no standard `request()`.
 * Asking the user for a grant is the job of the feature node (`<wcs-geo>` etc.);
 * this node only *observes*. It is therefore a pure element → state monitor with
 * **no commands** — command-token does not apply, only event-token.
 *
 * The single observable is `state` (`navigator.permissions.query(descriptor)`'s
 * `PermissionState`, or `"unsupported"`), published via the `wcs-permission:change`
 * event. `granted` / `denied` / `prompt` / `unsupported` are convenience booleans
 * derived from that one event (mirroring how GeolocationCore exposes latitude/…
 * from one `wcs-geo:position` event), so a binding like `hidden@granted` works
 * directly. The live `change` event of the PermissionStatus is tracked so a grant
 * flipping in browser settings flows into the declarative state.
 */
class PermissionCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "state", event: "wcs-permission:change", semantics: "state" },
            { name: "granted", event: "wcs-permission:change", semantics: "state", getter: (e) => e.detail === "granted" },
            { name: "denied", event: "wcs-permission:change", semantics: "state", getter: (e) => e.detail === "denied" },
            { name: "prompt", event: "wcs-permission:change", semantics: "state", getter: (e) => e.detail === "prompt" },
            { name: "unsupported", event: "wcs-permission:change", semantics: "state", getter: (e) => e.detail === "unsupported" },
        ],
        // No commands: the Permissions API is read-only (query-only). See class docs.
        commands: [],
    };
    _target;
    _descriptor = null;
    _state = "prompt";
    // Live PermissionStatus handle (when the Permissions API is available), kept so
    // the `change` listener can be removed on dispose().
    _permissionStatus = null;
    // True once a permission subscription has been (or is being) established, and
    // reset by dispose(). Guards observe() so a reconnect after dispose() re-queries
    // while a redundant observe() on an already-live subscription does not.
    _permissionSubscribed = false;
    // Monotonic id of the current permission query. Bumped by every _initPermission()
    // and by dispose(). Each in-flight query captures its id and, on resolve, bails
    // unless it is still current — so a query superseded by a rapid (synchronous)
    // disconnect→reconnect, or one that resolves after dispose(), never attaches a
    // listener. A plain boolean cannot cover this: dispose()→observe() flips it
    // false→true again, reopening the window for the stale query to slip through.
    _permGen = 0;
    // Resolves once the most recent query settles (or immediately when the API is
    // unsupported). The Shell exposes this as connectedCallbackPromise so SSR can
    // await the first probe before snapshotting the HTML.
    _ready = Promise.resolve();
    constructor(descriptor, target) {
        super();
        this._target = target ?? this;
        // Headless ergonomics: when a descriptor is supplied up front, probe the
        // permission state immediately so observers see the real value before the
        // first read. The Shell passes nothing and drives the first query from
        // connectedCallback via observe(), once the element's attributes resolve.
        if (descriptor) {
            this._descriptor = descriptor;
            this._ready = this._initPermission();
        }
    }
    get state() {
        return this._state;
    }
    get granted() {
        return this._state === "granted";
    }
    get denied() {
        return this._state === "denied";
    }
    get prompt() {
        return this._state === "prompt";
    }
    get unsupported() {
        return this._state === "unsupported";
    }
    /** Resolves once the current (or initial) query settles. */
    get ready() {
        return this._ready;
    }
    // --- State setter with event dispatch ---
    _setState(state) {
        // Same-value guard: `state` is the only stored value and the derived booleans
        // change in lockstep with it, so suppressing identical re-dispatches is safe.
        if (this._state === state)
            return;
        this._state = state;
        this._target.dispatchEvent(new CustomEvent("wcs-permission:change", {
            detail: state,
            bubbles: true,
        }));
    }
    // --- Public API ---
    /**
     * Start observing `descriptor` (e.g. `{ name: "geolocation" }`). Idempotent
     * while already subscribed — calling it again only updates the stored descriptor
     * for a *future* re-subscription; it does **not** re-query, even when called with
     * a different descriptor (the Shell binds at a fixed connect-time descriptor and
     * does not re-query on a `name` change in v1). To switch permission mid-life,
     * dispose() first, then observe() the new descriptor. On the first call, or after
     * a dispose(), it issues the query and subscribes to the live `change` event.
     * Returns a promise that resolves once that query settles, for SSR.
     */
    observe(descriptor) {
        this._descriptor = descriptor;
        if (!this._permissionSubscribed) {
            this._ready = this._initPermission();
        }
        return this._ready;
    }
    /**
     * Detach the live permission `change` listener. Call from the Shell's
     * `disconnectedCallback` so a removed element does not leak the subscription.
     * A later reconnect can re-subscribe via observe().
     *
     * Headless callers (using PermissionCore directly, without the Shell) own this
     * lifecycle themselves: call dispose() when the observer is no longer needed,
     * otherwise the live PermissionStatus `change` listener keeps this instance
     * reachable for as long as the status is alive. dispose() is safe to call when
     * never subscribed and may be paired with a later observe() to resume.
     */
    dispose() {
        this._permissionSubscribed = false;
        // Invalidate any in-flight query so its .then() bails instead of attaching a
        // listener after teardown.
        this._permGen++;
        if (this._permissionStatus) {
            this._permissionStatus.removeEventListener("change", this._onPermissionChange);
            this._permissionStatus = null;
        }
    }
    // --- Internal ---
    _initPermission() {
        // Guard a missing/empty permission name (e.g. a `<wcs-permission>` with no
        // `name` attribute). Such a descriptor would only ever reject at query() and
        // silently fall back to "unsupported", which is hard to diagnose. Short-circuit
        // to "unsupported" without issuing a doomed query so the misconfiguration
        // surfaces deterministically and no listener is attached.
        if (!this._descriptor || !this._descriptor.name) {
            this._setState("unsupported");
            return Promise.resolve();
        }
        // A feature this page cannot use — not a secure context, or turned off by a
        // Permissions-Policy (a header, an <iframe> without `allow`) — is "unsupported",
        // as it is for the element that would acquire it. The Permissions API does not
        // tell: Chromium answers "granted" in a policy-blocked frame and "denied" on an
        // insecure origin, the same as a user's refusal, which the site settings would
        // fix and these cannot. Neither changes while the page lives, so nothing is
        // subscribed.
        if (featureUnavailable(this._descriptor.name) !== null) {
            this._setState("unsupported");
            return Promise.resolve();
        }
        // The Permissions API is optional. When absent (or it rejects, e.g. the
        // browser does not accept the requested permission name), report "unsupported"
        // and leave it at that — there is nothing to retry.
        if (typeof navigator === "undefined" || !navigator.permissions || typeof navigator.permissions.query !== "function") {
            // Route through _setState (not a bare assignment) so observers stay in sync
            // with the public state. The same-value guard means no redundant dispatch
            // when the state does not actually change.
            this._setState("unsupported");
            // Intentionally does NOT set _permissionSubscribed: there is no listener to
            // tear down, so a reconnect simply re-probes (idempotent — the same-value
            // guard suppresses any dispatch and no listener is ever attached). Mirrors
            // GeolocationCore's reinitPermission behavior in unsupported environments.
            return Promise.resolve();
        }
        this._permissionSubscribed = true;
        const gen = ++this._permGen;
        // Cast: WcsPermissionDescriptor widens `name` to string (and allows extra
        // descriptor members like userVisibleOnly / sysex) where the lib DOM type
        // expects the PermissionName union.
        return navigator.permissions.query(this._descriptor).then((status) => {
            // Stale resolution: this query was superseded (rapid reconnect) or the
            // element was disposed while it was in flight. Drop it so only the current
            // subscription attaches a listener.
            if (gen !== this._permGen)
                return;
            this._permissionStatus = status;
            this._setState(status.state);
            status.addEventListener("change", this._onPermissionChange);
        }, () => {
            if (gen !== this._permGen)
                return;
            this._setState("unsupported");
        });
    }
    _onPermissionChange = (event) => {
        const status = event.target;
        this._setState(status.state);
    };
}

// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /protocol/upgrade-properties.ts by scripts/sync-protocol-types.mjs.
// Run `node scripts/sync-protocol-types.mjs` after editing the source.
// ===========================================================================
function hasAccessorOnPrototype(target, name) {
    let proto = Object.getPrototypeOf(target);
    while (proto !== null) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, name);
        if (descriptor !== undefined) {
            return typeof descriptor.get === "function" || typeof descriptor.set === "function";
        }
        proto = Object.getPrototypeOf(proto);
    }
    return false;
}
// 属性になってしまったオブジェクトの入力（`files="[object File]"`）を、要素ごとに 1 回だけ言う。
// React 19 は定義前の要素にプロパティが無いのでオブジェクトを属性に書き、Vue の `.attr` も
// 書く。要素はその入力をプロパティでしか読まないので、何も受け取らず、何も言わなかった
// （docs/seam-apps.md、fw-inventory）。
const toldObjectAttribute = new WeakSet();
function warnObjectAttribute(element, name, value) {
    if (toldObjectAttribute.has(element))
        return;
    toldObjectAttribute.add(element);
    const tag = element.localName ?? "element";
    console.warn(`[wcs/input-as-attribute] <${tag}> has the attribute ${name}="${value}": an object was written as an ` +
        `attribute, so the element did not receive it. A framework does that when the property is set before the ` +
        `element's definition loads (React 19), or when told to (Vue's .attr). Load the definition before rendering, ` +
        `or assign the property through a ref (Vue: .prop). (Said once per element.)`, element);
}
/**
 * `connectedCallback` の先頭で呼ぶ。宣言済み input のうち upgrade 前の代入で
 * accessor をシャドウしている own プロパティを、delete → 再代入で setter に通し直す。
 *
 * - 冪等: 再代入は accessor を通るので own プロパティは残らず、2 回目以降は no-op。
 * - 宣言に `inputs` が無い要素、`wcBindable` を持たない要素では何もしない。
 * - 値の意味は変えない。今まで捨てられていた代入が届くようになる一方向の変化。
 * - 値が `[object …]` の属性（属性に書かれてしまったオブジェクトの入力）は、要素ごとに 1 回警告する。
 */
function upgradeProperties(element) {
    const declaration = element.constructor?.wcBindable;
    const inputs = declaration?.inputs;
    if (inputs === undefined)
        return;
    const getAttribute = element.getAttribute;
    for (const input of inputs) {
        const name = input.name;
        const attribute = typeof getAttribute === "function" ? getAttribute.call(element, name.toLowerCase()) : null;
        if (attribute !== null && attribute.startsWith("[object "))
            warnObjectAttribute(element, name, attribute);
        if (!Object.prototype.hasOwnProperty.call(element, name))
            continue;
        if (!hasAccessorOnPrototype(element, name))
            continue;
        const record = element;
        const value = record[name];
        delete record[name];
        record[name] = value;
    }
}

// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /protocol/input-attribute.ts by scripts/sync-protocol-types.mjs.
// Run `node scripts/sync-protocol-types.mjs` after editing the source.
// ===========================================================================
// 属性へ反映する wc-bindable 入力の producer 側（SPEC-extensions § Producer guidance for inputs の P1〜P3）。
// 入力の setter は属性をこの 2 関数で書く。それで次が揃う:
//   - `undefined` は「値が無い」（P1）: 属性を、この関数で最初に書く前の状態 — マークアップに書かれた値、
//     無ければ属性なし（= その入力の文書化した既定値）— へ戻す。applier プロファイルを宣言する binder は
//     値の後の `undefined` を書き（A2）、React 19 も書き、直接の代入でも届く。
//   - `null` はクリア（P2）: 属性なし、つまり文書化した既定値。
//   - どちらも文字列 "undefined" / "null" として属性に入らない。
//
// 「最初に書く前」は、その最初の書き込みのときに読む（遅延）。upgrade 前に代入されたプロパティは
// connectedCallback の upgradeProperties() が通し直すので、そのときにはパーサが書いた属性が揃っている。
// 要素自身が setter を通さずに書いた属性は、最初の書き込みより前なら「最初の状態」に含まれる。
//
// SINGLE SOURCE OF TRUTH: edit only this file (/protocol/input-attribute.ts), then run
// `node scripts/sync-protocol-types.mjs` to regenerate the per-package copies
// (packages/<pkg>/src/protocol/inputAttribute.ts). Those copies are generated — do not edit them.
const initialAttributes = new WeakMap();
/** The attribute as it stood before the first write through these helpers. */
function initialAttribute(el, name) {
    let byName = initialAttributes.get(el);
    if (byName === undefined) {
        byName = new Map();
        initialAttributes.set(el, byName);
    }
    if (!byName.has(name))
        byName.set(name, el.getAttribute(name));
    return byName.get(name);
}
function writeAttribute(el, name, value) {
    if (value === null)
        el.removeAttribute(name);
    else
        el.setAttribute(name, value);
}
/**
 * A value attribute. `value` is written as `String(value)`; `null` removes the attribute;
 * `undefined` restores the attribute the element started with.
 */
function reflectAttribute(el, name, value) {
    const initial = initialAttribute(el, name);
    writeAttribute(el, name, value === undefined ? initial : value === null ? null : String(value));
}
/**
 * A boolean attribute, present while `value` is truthy (`null` and `false` remove it);
 * `undefined` restores the attribute the element started with.
 */
function reflectBooleanAttribute(el, name, value) {
    const initial = initialAttribute(el, name);
    writeAttribute(el, name, value === undefined ? initial : value ? "" : null);
}

// 張られた deferred が無いときの _connectResolve（呼んでも何もしない）
const nothingArmed = () => { };
// Named WcsPermission (not `Permission`) so the class does not shadow any global,
// and to match the <wcs-geo> / <wcs-ws> convention (WcsGeolocation /
// WcsWebSocket). The public export keeps the `WcsPermission` name unchanged.
class WcsPermission extends HTMLElement {
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...PermissionCore.wcBindable,
        // Shell-level settable surface. `name` is the permission name; the descriptor
        // extras `user-visible-only` (push) and `sysex` (midi) are boolean flags that
        // reflect idempotently, so a binding system that writes through
        // inputs[].attribute is safe.
        inputs: [
            { name: "name", attribute: "name" },
            { name: "userVisibleOnly", attribute: "user-visible-only" },
            { name: "sysex", attribute: "sysex" },
        ],
        // No commands: read-only monitor (see PermissionCore). The Permissions API has
        // no request() — acquiring a grant is the feature node's job.
        commands: [],
    };
    // Created in the Shell constructor with no descriptor so the delegated getters
    // work before connect (returning the default "prompt" / false). The actual
    // query is driven from connectedCallback once the element's attributes resolve
    // (programmatically-created elements have no attributes at construction time).
    _core;
    _connectedCallbackPromise = Promise.resolve();
    // _scheduleObserve のマイクロタスクが待っている間 true
    _observePending = false;
    // connectedCallback で張った connectedCallbackPromise を解決する関数。
    // マイクロタスク（の query の決着）か disconnectedCallback が解決する
    _connectResolve = nothingArmed;
    _internals = null;
    constructor() {
        super();
        this._core = new PermissionCore(null, this);
        this._internals = this._initInternals();
        this._wireStates({
            "wcs-permission:change": (d) => ({
                granted: d === "granted",
                denied: d === "denied",
                prompt: d === "prompt",
                unsupported: d === "unsupported",
            }),
        });
    }
    // CSS state reflection (:state()) — debug-only snapshot getter. NOT part of
    // wc-bindable (not a bind target); see README "CSS styling with :state()".
    // MUST NOT return the live CustomStateSet (that would let callers write
    // states from outside, defeating the point of :state() being read-only).
    get debugStates() {
        return this._internals ? [...this._internals.states] : [];
    }
    _initInternals() {
        // never-throw (async-io-node-guidelines.md §3.6): attachInternals is absent
        // in happy-dom / older environments, and pre-125 Chromium rejects
        // non-dashed state names from states.add() (probed and discarded here).
        // Either case silently disables reflection — the component still works,
        // it just doesn't expose :state() selectors.
        try {
            if (typeof this.attachInternals !== "function")
                return null;
            const internals = this.attachInternals();
            internals.states.add("wcs-probe");
            internals.states.delete("wcs-probe");
            return internals;
        }
        catch {
            return null;
        }
    }
    _wireStates(map) {
        if (this._internals === null)
            return;
        const states = this._internals.states;
        for (const [event, toStates] of Object.entries(map)) {
            this.addEventListener(event, (e) => {
                const debug = this.hasAttribute("debug-states");
                for (const [name, on] of Object.entries(toStates(e.detail))) {
                    try {
                        if (on) {
                            states.add(name);
                        }
                        else {
                            states.delete(name);
                        }
                    }
                    catch { /* never-throw */ }
                    if (debug)
                        this.toggleAttribute(`data-wcs-state-${name}`, on);
                }
            });
        }
    }
    // --- Attribute accessors ---
    // Input setters never let setAttribute stringify null / undefined (an
    // "undefined" name would query a permission called "undefined"): `null`
    // removes the attribute (the default), `undefined` restores the attribute the
    // element started with (wc-bindable producer guidance P1; React 19 and a
    // direct assignment deliver it, @wcstack/state does not).
    get name() {
        return this.getAttribute("name") ?? "";
    }
    set name(value) {
        reflectAttribute(this, "name", value);
    }
    get userVisibleOnly() {
        return this.hasAttribute("user-visible-only");
    }
    set userVisibleOnly(value) {
        reflectBooleanAttribute(this, "user-visible-only", value);
    }
    get sysex() {
        return this.hasAttribute("sysex");
    }
    set sysex(value) {
        reflectBooleanAttribute(this, "sysex", value);
    }
    // --- Core delegated getters ---
    get state() {
        return this._core.state;
    }
    get granted() {
        return this._core.granted;
    }
    get denied() {
        return this._core.denied;
    }
    get prompt() {
        return this._core.prompt;
    }
    get unsupported() {
        return this._core.unsupported;
    }
    // wc-bindable connectedCallbackPromise protocol: resolves once the connect-time
    // query settles, so SSR (@wcstack/server render.ts) waits for the first probe
    // before snapshotting the HTML. Mirrors WcsGeolocation.connectedCallbackPromise.
    get connectedCallbackPromise() {
        return this._connectedCallbackPromise;
    }
    // --- Internal ---
    // Build the query descriptor from the current attributes. Only present extras
    // are included so a bare `{ name }` is passed for permissions that take no
    // additional members. The descriptor is fixed at connect time (v1 does not
    // re-query on a `name` change — see README).
    _descriptor() {
        const descriptor = { name: this.name };
        if (this.userVisibleOnly)
            descriptor.userVisibleOnly = true;
        if (this.sysex)
            descriptor.sysex = true;
        return descriptor;
    }
    // 何を query するか（name / user-visible-only / sysex）はマイクロタスクで、そのときの
    // 入力で 1 回だけ決める（timing-and-firing-contract §23）。router は遷移で同じノードを
    // 入れ直し、新しいルートの params から state が name を書くのはマイクロタスク — その場で
    // query すると、前の name の state を公開し、その購読に留まっていた（docs/seam-apps.md、
    // shift-desk）。その時点で外れていれば何もしない。
    _scheduleObserve() {
        if (this._observePending)
            return;
        this._observePending = true;
        queueMicrotask(() => {
            this._observePending = false;
            const resolveConnect = this._connectResolve;
            this._connectResolve = nothingArmed;
            if (!this.isConnected) {
                resolveConnect();
                return;
            }
            // Begin observing (or revive the subscription after a reconnect). query()
            // never rejects in a way that escapes — failures surface as the
            // `unsupported` state — so no .catch() is needed.
            void this._core.observe(this._descriptor()).then(resolveConnect);
        });
    }
    // --- Lifecycle ---
    connectedCallback() {
        // upgrade 前に代入された input を取り込み直す（doc 13 §1.2 / Phase A1）
        upgradeProperties(this);
        this.style.display = "none";
        // connectedCallbackPromise (SSR) resolves once the connect-time query settles.
        // The query itself is decided in a microtask (_scheduleObserve), so arm a
        // deferred here; the microtask resolves it on every path, and so does
        // disconnectedCallback, so awaiting it never hangs.
        this._connectedCallbackPromise = new Promise((resolve) => {
            this._connectResolve = resolve;
        });
        this._scheduleObserve();
    }
    disconnectedCallback() {
        this._core.dispose();
        // 同じタスクの remove() → append() では 2 回目の connectedCallback が
        // _connectResolve を上書きし、1 回目の deferred を待つ側が残される。外れた時点で
        // 接続時の初期化は意味を失うので、ここで解決する（Fetch.ts と同じ）。
        this._connectResolve();
        this._connectResolve = nothingArmed;
    }
}

// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /protocol/define-element.ts by scripts/sync-protocol-types.mjs.
// Run `node scripts/sync-protocol-types.mjs` after editing the source.
// ===========================================================================
/**
 * One copy of each package on a page (docs/timing-and-firing-contract.md §24). The first copy the
 * page evaluates defines the tags and a second one does nothing, so a copy that finds its tag defined
 * by another copy of the package — not its class, not a subclass of it, not the same version — warns
 * `[wcs/package-twice]` once per registry, naming both versions. The classes it defines carry
 * `"<package>@<version>"` under `Symbol.for("wcstack.package")`; a class without it is named
 * "another copy of <package> that does not name its version" (an older copy, or one loaded through
 * an entry that does not stamp).
 */
/** The static a class defined through this helper carries: `"@wcstack/fetch@<version>"`. */
const PACKAGE_STAMP = Symbol.for("wcstack.package");
/** The registries this copy warned about: one warning per package per registry. */
const warned = new WeakSet();
/**
 * Marks `cls` as defined by `pkg` (`"@wcstack/fetch@<version>"`). A subclass inherits the mark, and
 * `defineProperty` writes it even where a parent's mark is read-only.
 */
function stampPackage(cls, pkg) {
    Object.defineProperty(cls, PACKAGE_STAMP, { value: pkg, configurable: true });
}
/**
 * Warns when `tag` is defined as `existing` by another copy of the package `pkg` names: `existing`
 * is neither `own` nor a subclass of it (omit `own` when the copy has no class to compare with), and
 * carries another version or none. Once per registry.
 */
function warnIfAnotherCopy(registry, tag, existing, own, pkg) {
    if (own !== undefined && (existing === own || existing.prototype instanceof own))
        return;
    const theirs = existing[PACKAGE_STAMP];
    if (theirs === pkg || warned.has(registry))
        return;
    warned.add(registry);
    const name = pkg.slice(0, pkg.lastIndexOf("@"));
    console.warn(`[${name}] [wcs/package-twice] <${tag}> is already defined by ` +
        `${theirs ?? `another copy of ${name} that does not name its version`}; ` +
        `this copy, ${pkg}, does nothing. Load each package once.`);
}
/**
 * Defines each `[tag, class]` in `registry` unless the tag is already defined, stamping the class
 * with `pkg` (`"@wcstack/fetch@<version>"`). A tag another copy of the package defined first is left
 * as it is, with the warning above.
 */
function defineElements(registry, pkg, definitions) {
    for (const [tag, cls] of definitions) {
        const existing = registry.get(tag);
        if (existing === undefined) {
            stampPackage(cls, pkg);
            registry.define(tag, cls);
        }
        else {
            warnIfAnotherCopy(registry, tag, existing, cls, pkg);
        }
    }
}

/**
 * Register this package's tags. Pass a scoped `CustomElementRegistry` to define
 * them for a single shadow tree -- scoped registries do not inherit the global
 * one, so a tree using one needs its own definitions.
 */
function registerComponents(registry = customElements) {
    defineElements(registry, `${pkg.name}@${pkg.version}`, [
        [config.tagNames.permission, WcsPermission],
    ]);
}

function bootstrapPermission(userConfig, registry) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents(registry);
}

export { PermissionCore, WcsPermission, bootstrapPermission, getConfig };
//# sourceMappingURL=index.esm.js.map
