const _config = {
    tagNames: {
        mediaQuery: "wcs-media-query",
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
/** A misspelt option would otherwise do nothing: `bootstrapMediaQuery` refuses it. */
function invalid(key) {
    throw new Error(`[@wcstack/media-query] bootstrapMediaQuery: "${key}" is not one of its options, or not of the option's type.`);
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

var pkg = {"name":"@wcstack/media-query","version":"4.13.0"};

const UNSUPPORTED_SNAPSHOT = Object.freeze({
    matched: false,
    media: "",
    supported: false,
});
// "matchMedia exists but there is nothing to watch": an empty query, or a
// matchMedia call that threw. Same shape as UNSUPPORTED_SNAPSHOT except that
// `supported` stays honest about the API being present.
const IDLE_SNAPSHOT = Object.freeze({
    matched: false,
    media: "",
    supported: true,
});
/**
 * Headless media-query primitive. A thin, framework-agnostic wrapper around
 * `window.matchMedia` exposed through the wc-bindable protocol.
 *
 * `observe(query)` subscribes to one `MediaQueryList` and republishes its
 * `matches` / `media` as `matched` / `media` state; a different query while subscribed tears the
 * old list down and subscribes to the new one. Subscribing is synchronous, but
 * — unlike `@wcstack/network` — this Core does keep a `_gen` generation guard
 * (§3.4): each subscription's `change` listener captures the generation it was
 * created under and bails when it is stale, so a `MediaQueryList` whose
 * `removeEventListener` / `removeListener` misbehaves can never write the old
 * query's `matched` over the new query's (docs/media-query-tag-design.md §6).
 *
 * `matchMedia` is universally available in browsers; `supported === false` is
 * the non-browser case (SSR, workers) rather than a browser quirk.
 */
class MediaQueryCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "matched", event: "wcs-media-query:change", semantics: "state", getter: (e) => e.detail.matched },
            { name: "media", event: "wcs-media-query:change", semantics: "state", getter: (e) => e.detail.media },
            { name: "supported", event: "wcs-media-query:change", semantics: "state", getter: (e) => e.detail.supported },
        ],
        // Pure monitor: a MediaQueryList has no action to invoke.
        //
        // `matched`, not `matches`: `Element.prototype.matches(selector)` exists on
        // every element, and a wc-bindable property name is read straight off the
        // Shell — a boolean `matches` would shadow the platform method
        // (docs/media-query-tag-design.md §2.1).
        commands: [],
    };
    _target;
    _snapshot = UNSUPPORTED_SNAPSHOT;
    // The query currently subscribed (or last requested). "" means "nothing to watch".
    _query = "";
    // Detaches the live `change` listener of the current subscription, if any.
    _unsubscribe = null;
    // True between observe() and dispose(). Guards observe() so a redundant call
    // with the same query does not re-subscribe; dispose() resets it.
    _subscribed = false;
    // Generation guard (§3.4). Bumped by every (re)subscription and by dispose().
    // A `change` listener captures its generation and ignores the event once a
    // newer subscription exists — see the class docs for why this is kept even
    // though subscribing itself is synchronous.
    _gen = 0;
    // Injected matchMedia (tests / non-window hosts). `null` = resolve
    // `globalThis.matchMedia` at call time (§3.7).
    _injectedMatchMedia;
    // SSR (§3.8): no asynchronous probe to await — observe() completes
    // synchronously, so readiness is immediate.
    _ready = Promise.resolve();
    constructor(target, options) {
        super();
        this._target = target ?? this;
        this._injectedMatchMedia = options?.matchMedia ?? null;
    }
    get ready() {
        return this._ready;
    }
    get query() {
        return this._query;
    }
    get matched() {
        return this._snapshot.matched;
    }
    get media() {
        return this._snapshot.media;
    }
    get supported() {
        return this._snapshot.supported;
    }
    // Lifecycle (§3.5). Idempotent: observe() with the query already subscribed
    // is a no-op (no double listener, no redundant dispatch). A different query
    // re-subscribes (dispose-then-observe semantics in one call). Omitting the
    // argument keeps the current query — the reconnect case for the Shell.
    // Synchronous overall (no probe to await), so the returned promise is only
    // for API uniformity with other IO nodes.
    observe(query = this._query) {
        if (this._subscribed && query === this._query) {
            return this._ready;
        }
        this._teardown();
        this._query = query;
        this._subscribed = true;
        this._subscribe(query);
        return this._ready;
    }
    dispose() {
        this._subscribed = false;
        this._teardown();
    }
    // API resolution is call-time, never cached (§3.7): lets tests install/remove
    // globalThis.matchMedia freely and lets a non-browser host be detected
    // correctly on every observe(). Called as a method of globalThis so the
    // native implementation keeps its `this` (calling it unbound throws).
    _resolveMatchMedia() {
        if (this._injectedMatchMedia !== null) {
            return this._injectedMatchMedia;
        }
        const g = globalThis;
        return typeof g.matchMedia === "function" ? (q) => g.matchMedia(q) : null;
    }
    _subscribe(query) {
        const gen = ++this._gen;
        const matchMedia = this._resolveMatchMedia();
        if (matchMedia === null) {
            this._apply(UNSUPPORTED_SNAPSHOT);
            return;
        }
        if (query === "") {
            this._apply(IDLE_SNAPSHOT);
            return;
        }
        // never-throw (§3.6): browsers do not throw on an invalid query string
        // (they return `media: "not all"`), but a hostile host or a broken
        // MediaQueryList polyfill might — that must not kill observe().
        let list = null;
        try {
            list = matchMedia(query);
            const onChange = () => {
                if (gen !== this._gen)
                    return; // stale subscription — never write
                this._apply(this._read(list));
            };
            this._unsubscribe = attachChange(list, onChange);
        }
        catch {
            list = null;
            this._unsubscribe = null;
        }
        this._apply(list === null ? IDLE_SNAPSHOT : this._read(list));
    }
    _teardown() {
        this._gen++;
        if (this._unsubscribe !== null) {
            const unsubscribe = this._unsubscribe;
            this._unsubscribe = null;
            try {
                unsubscribe();
            }
            catch {
                // never-throw: a list that refuses to detach is already neutralized
                // by the generation bump above.
            }
        }
    }
    _read(list) {
        return {
            matched: list.matches === true,
            media: typeof list.media === "string" ? list.media : "",
            supported: true,
        };
    }
    // Same-value guard (§3.3 MUST): the native `change` event already fires only
    // when `matches` flips, but this Core still verifies field-by-field before
    // dispatching — a re-subscription to an equivalent query, or a legacy
    // `addListener` double-fire, must not produce a redundant event.
    _apply(next) {
        const prev = this._snapshot;
        if (prev.matched === next.matched &&
            prev.media === next.media &&
            prev.supported === next.supported) {
            return;
        }
        this._snapshot = next;
        this._target.dispatchEvent(new CustomEvent("wcs-media-query:change", {
            detail: next,
            // Family-wide MUST (async-io-node-guidelines.md §3.3): the event bubbles
            // from the Shell element so document-level consumers can delegate.
            bubbles: true,
        }));
    }
}
// Subscribe to a MediaQueryList's `change` with whichever listener API it has.
// Modern engines: EventTarget-style. Old Safari (< 14): the deprecated
// addListener / removeListener pair. Neither: no live updates — the snapshot
// taken at observe() is all there is (a static polyfill, for instance).
// Returns the matching detach function.
function attachChange(list, listener) {
    if (typeof list.addEventListener === "function" && typeof list.removeEventListener === "function") {
        list.addEventListener("change", listener);
        return () => list.removeEventListener("change", listener);
    }
    if (typeof list.addListener === "function" && typeof list.removeListener === "function") {
        list.addListener(listener);
        return () => list.removeListener(listener);
    }
    return () => { };
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
 * `<wcs-media-query query="(prefers-color-scheme: dark)">` — declarative
 * `matchMedia` monitor.
 *
 * One attribute (`query`), three outputs (`matched` / `media` / `supported`),
 * no commands. Changing `query` while connected re-subscribes the Core to the
 * new MediaQueryList (docs/media-query-tag-design.md §7).
 */
class WcsMediaQuery extends HTMLElement {
    // SSR (§4.4): observe() completes synchronously, but the Shell still exposes
    // connectedCallbackPromise so SSR (@wcstack/server render.ts) can await it
    // uniformly across all IO nodes before snapshotting the HTML.
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...MediaQueryCore.wcBindable,
        // Shell-level settable surface: the media query string, mirrored to the
        // `query` attribute (idempotent reflect, so a binder writing through
        // inputs[].attribute is safe).
        inputs: [
            { name: "query", attribute: "query" },
        ],
        // Core の commands をそのまま継承（単一情報源）。network と同型。
        commands: MediaQueryCore.wcBindable.commands,
    };
    // `query` is the only attribute worth re-subscribing for; it is the whole
    // configuration of this node.
    static get observedAttributes() { return ["query"]; }
    _core;
    _connectedCallbackPromise = Promise.resolve();
    _internals = null;
    constructor() {
        super();
        this._core = new MediaQueryCore(this);
        this._internals = this._initInternals();
        this._wireStates({
            "wcs-media-query:change": (d) => ({
                matched: d.matched === true,
                supported: d.supported === true,
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
    get query() {
        return this.getAttribute("query") ?? "";
    }
    // Never lets setAttribute stringify null / undefined (matchMedia("undefined")
    // is a valid, never-matching query): `null` removes the attribute ("watch
    // nothing"), `undefined` restores the attribute the element started with
    // (wc-bindable producer guidance P1; React 19 and a direct assignment deliver
    // it, @wcstack/state does not). Either way attributeChangedCallback
    // re-subscribes.
    set query(value) {
        reflectAttribute(this, "query", value);
    }
    // --- Core delegated getters ---
    get matched() {
        return this._core.matched;
    }
    get media() {
        return this._core.media;
    }
    get supported() {
        return this._core.supported;
    }
    get connectedCallbackPromise() {
        return this._connectedCallbackPromise;
    }
    // --- Lifecycle ---
    attributeChangedCallback(name, _oldValue, newValue) {
        // Re-subscribe on a live query change. Removing the attribute (newValue
        // null) is a real change too — it means "watch nothing", so `matched`
        // drops to false instead of lingering on the old query's value. Before
        // connect the attribute is simply read by connectedCallback.
        if (name === "query" && this.isConnected) {
            this._core.observe(newValue ?? "");
        }
    }
    connectedCallback() {
        // upgrade 前に代入された input を取り込み直す（doc 13 §1.2 / Phase A1）
        upgradeProperties(this);
        this.style.display = "none";
        this._connectedCallbackPromise = this._core.observe(this.query);
    }
    disconnectedCallback() {
        this._core.dispose();
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
        [config.tagNames.mediaQuery, WcsMediaQuery],
    ]);
}

function bootstrapMediaQuery(userConfig, registry) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents(registry);
}

export { MediaQueryCore, WcsMediaQuery, bootstrapMediaQuery, getConfig };
//# sourceMappingURL=index.esm.js.map
