const _config = {
    autoTrigger: true,
    triggerAttribute: "data-storagetarget",
    tagNames: {
        storage: "wcs-storage",
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
/** A misspelt option would otherwise do nothing: `bootstrapStorage` refuses it. */
function invalid(key) {
    throw new Error(`[@wcstack/storage] bootstrapStorage: "${key}" is not one of its options, or not of the option's type.`);
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
    for (const [key, value] of given) {
        if (key !== "tagNames") {
            options[key] = value;
        }
    }
    for (const [name, tag] of givenTags)
        tags[name] = tag;
    frozenConfig = null;
}

var pkg = {"name":"@wcstack/storage","version":"4.11.2"};

// Single source of truth for the custom event names dispatched by StorageCore /
// Storage. These names appear in two places that must stay in lock-step:
//   1. the `wcBindable.properties[].event` declarations (consumed by bind())
//   2. the `dispatchEvent(new CustomEvent(...))` calls that emit them
// Hard-coding the same string literal in both places risks a silent typo that
// makes bind() listen for an event no one ever fires. Referencing these
// constants from both sites keeps them in sync.
const STORAGE_EVENTS = {
    valueChanged: "wcs-storage:value-changed",
    loadingChanged: "wcs-storage:loading-changed",
    error: "wcs-storage:error",
    errorInfoChanged: "wcs-storage:error-info-changed",
    triggerChanged: "wcs-storage:trigger-changed",
};

/**
 * storageCapabilities.ts
 *
 * Storage node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。storage の load / save / remove は同期で互いに競合しないため lane は
 * 持たず、error taxonomy(errorInfo)のみを採用する。
 */
/** 安定した storage error code(taxonomy)。値は公開キーとして固定。 */
const WCS_STORAGE_ERROR_CODE = {
    /** `key` 未設定 / 不正な `type` などの入力不備。retry では回復しない。 */
    InvalidArgument: "invalid-argument",
    /** `QuotaExceededError` — 容量超過。空きを作れば回復しうる(環境要因)。 */
    QuotaExceeded: "quota-exceeded",
    /** `SecurityError` — storage アクセス拒否(cookie 無効 / third-party context 等)。retry では回復しない。 */
    NotAllowed: "not-allowed",
    /** その他の caught 例外。 */
    StorageError: "storage-error",
};
/**
 * storage の失敗を serializable な error taxonomy に写す。
 *
 * `name` は caught 例外の `Error.name`(load / save / remove の catch から渡る)。
 * 未指定(undefined)は inline 構築の validation error(不正 `type` / `key` 未設定)を意味し、
 * これは開始前の入力不備なので phase="start" / `invalid-argument` / recoverable=false。
 * caught 例外は実行中の失敗なので phase="execute"。`QuotaExceededError` は環境要因で
 * 空きを作れば回復しうる(recoverable=true)、`SecurityError` は retry で回復しない。
 */
function deriveStorageErrorInfo(error, name) {
    if (name === undefined) {
        return {
            code: WCS_STORAGE_ERROR_CODE.InvalidArgument,
            phase: "start",
            recoverable: false,
            message: error.message,
        };
    }
    if (name === "QuotaExceededError") {
        return { code: WCS_STORAGE_ERROR_CODE.QuotaExceeded, phase: "execute", recoverable: true, message: error.message };
    }
    if (name === "SecurityError") {
        return { code: WCS_STORAGE_ERROR_CODE.NotAllowed, phase: "execute", recoverable: false, message: error.message };
    }
    return { code: WCS_STORAGE_ERROR_CODE.StorageError, phase: "execute", recoverable: true, message: error.message };
}

/** What JSON cannot keep, named for the warning; `null` for a value it keeps. */
function unkept(v) {
    if (v === null || typeof v !== "object")
        return null;
    if (typeof File !== "undefined" && v instanceof File)
        return "a File";
    if (typeof Blob !== "undefined" && v instanceof Blob)
        return "a Blob";
    if (v instanceof Map)
        return "a Map";
    if (v instanceof Set)
        return "a Set";
    if (v instanceof ArrayBuffer || ArrayBuffer.isView(v))
        return "binary data";
    return null;
}
class StorageCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "value", event: STORAGE_EVENTS.valueChanged, semantics: "state", getter: (e) => e.detail },
            { name: "loading", event: STORAGE_EVENTS.loadingChanged, semantics: "state" },
            { name: "error", event: STORAGE_EVENTS.error, semantics: "state" },
            // Serializable failure taxonomy (stable code / phase / recoverable), or null.
            // Additive bindable output derived from `error` (invalid-argument / quota-exceeded
            // / not-allowed / storage-error); the existing `error` property/event are unchanged.
            // Fires wcs-storage:error-info-changed. No lane — load/save/remove don't compete.
            { name: "errorInfo", event: STORAGE_EVENTS.errorInfoChanged, semantics: "state" },
        ],
        inputs: [
            { name: "key" },
            { name: "type" },
        ],
        // load / save / remove are synchronous, so none carry the `async` hint.
        commands: [
            { name: "load" },
            { name: "save" },
            { name: "remove" },
        ],
    };
    _target;
    _value = null;
    _loading = false;
    _error = null;
    _errorInfo = null;
    _key = "";
    /** Whether `[wcs/storage-unserializable]` was said for this element. */
    _toldUnkept = false;
    /** Whether `[wcs/command-not-ready]` was said in this outage (an operation without a key; a key resets it). */
    _toldNoKey = false;
    _type = "local";
    _storageListener = null;
    // Generation guard: bumped on dispose(). The cross-tab `storage` listener
    // captures the generation active when startSync() ran; a callback that fires
    // after dispose() (or a teardown→re-setup) has a stale gen and MUST NOT write
    // state to a torn-down element. A boolean flag is insufficient (dispose→observe
    // would let a stale listener slip through).
    _gen = 0;
    // SSR: storage access is synchronous, so there is no asynchronous probe to
    // await — readiness is immediate.
    _ready = Promise.resolve();
    constructor(target) {
        super();
        this._target = target ?? this;
    }
    get ready() {
        return this._ready;
    }
    // Lifecycle (§3.5). Storage sync is command-driven (the Shell calls startSync()
    // from connectedCallback), so observe() is an idempotent no-op that resolves
    // once ready; dispose() tears down the cross-tab listener and invalidates any
    // in-flight listener callback.
    observe() {
        return this._ready;
    }
    dispose() {
        this._gen++;
        this.stopSync();
    }
    get value() {
        return this._value;
    }
    // Set the current value *without* persisting it. Persistence happens only via
    // save() / remove() / a cross-tab storage event. This setter exists so the
    // Shell (manual mode) can stage a value handed in via a `value` binding and
    // then commit it later with save()/trigger. It mirrors the value to observers
    // through the same `value-changed` event load()/save() use (CSBC: a Core value
    // change is observable), but it deliberately does not touch storage.
    //
    // Same-value writes are skipped to break a potential feedback loop:
    // value-changed → state binding → value setter → value-changed → …
    set value(v) {
        if (Object.is(v, this._value))
            return;
        this._setValue(v);
    }
    get loading() {
        return this._loading;
    }
    get error() {
        return this._error;
    }
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable`), or null. Additive wc-bindable property (event
     * `wcs-storage:error-info-changed`), derived from `error`; the existing `error`
     * property/event are unchanged.
     */
    get errorInfo() {
        return this._errorInfo;
    }
    get key() {
        return this._key;
    }
    set key(value) {
        // Defensive normalization for direct Core use (the Shell already passes a
        // string via `getAttribute("key") || ""`). Coercing to String keeps a
        // non-string assignment from poisoning the cross-tab `e.key !== _key`
        // comparison; empty keys are still rejected at operation time.
        this._key = String(value);
        // ready again: an operation refused in the next outage is said again
        if (this._key)
            this._toldNoKey = false;
    }
    get type() {
        return this._type;
    }
    set type(value) {
        if (value !== "local" && value !== "session") {
            // never-throw: an invalid type is routed to the error property and the
            // current type is kept (the safe default), rather than throwing out of the
            // setter / setAttribute / connectedCallback.
            this._setError({ operation: "type", message: `Invalid storage type: "${value}". Must be "local" or "session".` });
            return;
        }
        this._type = value;
    }
    _getStorage() {
        return this._type === "session" ? sessionStorage : localStorage;
    }
    _setLoading(loading) {
        this._loading = loading;
        this._target.dispatchEvent(new CustomEvent(STORAGE_EVENTS.loadingChanged, {
            detail: loading,
            bubbles: true,
        }));
    }
    // `name` is the caught exception's `Error.name` (passed only from the
    // load/save/remove catch blocks); it stays out of the public `error` shape and
    // is used solely to classify errorInfo (quota vs security vs generic). Inline
    // validation errors (invalid type / missing key) pass no name → invalid-argument.
    _setError(error, name) {
        // Same-value guard (async-io-node-guidelines.md §3.3). `error` is state-ish,
        // so suppressing redundant null→null dispatches (every load/save/remove start
        // clears a usually-already-null error) avoids a spurious error event per
        // successful operation. Reference identity is sufficient: each failure builds
        // a fresh object, and the clear path always passes null.
        if (this._error === error)
            return;
        this._error = error;
        // Keep the additive `errorInfo` taxonomy in sync with `error`: derive from the
        // error (or null on clear). Fires before the `error` event so an observer
        // binding both sees the classification first, mirroring the io-node family.
        this._commitErrorInfo(error === null ? null : deriveStorageErrorInfo(error, name));
        this._target.dispatchEvent(new CustomEvent(STORAGE_EVENTS.error, {
            detail: error,
            bubbles: true,
        }));
    }
    // Called only from _setError (which already same-value-guards on the error
    // reference), so errorInfo transitions exactly when error does — no separate
    // guard needed here.
    _commitErrorInfo(info) {
        this._errorInfo = info;
        this._target.dispatchEvent(new CustomEvent(STORAGE_EVENTS.errorInfoChanged, {
            detail: info,
            bubbles: true,
        }));
    }
    // Wrap a caught storage exception into the documented WcsStorageError shape,
    // tagging it with the failing operation so consumers know which call failed.
    _toStorageError(operation, e) {
        return {
            operation,
            message: e instanceof Error ? e.message : String(e),
        };
    }
    // The caught exception's `Error.name` for errorInfo classification (quota vs
    // security vs generic), or "" for a non-Error throw (→ storage-error). Returning
    // a string (never undefined) keeps a caught exception in the execute phase; only
    // inline validation errors, which pass no name to _setError, become start-phase
    // invalid-argument. Single chokepoint so the ternary is covered in one place.
    _errName(e) {
        return e instanceof Error ? e.name : "";
    }
    _setValue(value) {
        this._value = value;
        this._target.dispatchEvent(new CustomEvent(STORAGE_EVENTS.valueChanged, {
            detail: value,
            bubbles: true,
        }));
    }
    load() {
        if (!this._key) {
            // never-throw: a missing key is routed to the error property and a
            // sanitized null is returned, rather than throwing.
            this._setError({ operation: "load", message: "key is required." });
            this._warnNoKey("load");
            return null;
        }
        this._setLoading(true);
        this._setError(null);
        try {
            const storage = this._getStorage();
            const raw = storage.getItem(this._key);
            if (raw === null) {
                this._setValue(null);
            }
            else {
                try {
                    this._setValue(JSON.parse(raw));
                }
                catch {
                    this._setValue(raw);
                }
            }
            this._setLoading(false);
            return this._value;
        }
        catch (e) {
            this._setError(this._toStorageError("load", e), this._errName(e));
            this._setLoading(false);
            return null;
        }
    }
    save(value) {
        if (!this._key) {
            // never-throw: a missing key is routed to the error property instead of
            // throwing. No return value to sanitize (save returns void).
            this._setError({ operation: "save", message: "key is required." });
            this._warnNoKey("save");
            return;
        }
        this._setLoading(true);
        this._setError(null);
        try {
            const storage = this._getStorage();
            if (value === null || value === undefined) {
                storage.removeItem(this._key);
                // Normalize the removed value to null (matching remove() and load() of a
                // missing key) so saving `undefined` does not leave the getter returning
                // `undefined`. README's serialization table documents null/undefined as
                // "null" on read-back.
                this._setValue(null);
            }
            else if (typeof value === "string") {
                storage.setItem(this._key, value);
                this._setValue(value);
            }
            else {
                let lost = null;
                const json = JSON.stringify(value, (key, v) => {
                    if (lost === null) {
                        const what = unkept(v);
                        if (what !== null)
                            lost = key === "" ? what : `${what} at "${key}"`;
                    }
                    return v;
                });
                storage.setItem(this._key, json);
                this._setValue(value);
                if (lost !== null)
                    this._warnUnkept(lost);
            }
            this._setLoading(false);
        }
        catch (e) {
            this._setError(this._toStorageError("save", e), this._errName(e));
            this._setLoading(false);
        }
    }
    // An operation without a key does nothing, and only a page that binds `error` heard of it. In React and
    // Vue the usual cause is `key` itself: both keep it for themselves and never hand it to the element
    // (docs/seam-apps.md, fw-inventory). Said once per outage (the I/O command policy,
    // docs/v4-direction-2026-10.md): a key resets it. Once per element was once per page life — a
    // route puts the same element back on every entry, so the next outage went unsaid
    // (docs/seam-apps.md, shift-desk).
    _warnNoKey(operation) {
        if (this._toldNoKey)
            return;
        this._toldNoKey = true;
        console.warn(`[@wcstack/storage] [wcs/command-not-ready] ${operation}() was refused: there is no key, so nothing is ` +
            "loaded or stored. It goes to `error` too. Give the element a `key` — in React and Vue, which keep `key` " +
            "for themselves, write `storage-key`. (Said once until the element has a key again.)", this._target);
    }
    // JSON keeps none of these: a Blob or File is stored as {}, a Map or Set as {}, binary
    // data as an object of its bytes. Saved without a word, they came back empty after a
    // reload (docs/seam-apps.md, state-field-report: a recorded clip kept in a draft was
    // uploaded as a 15-byte "video"). Said once per element.
    _warnUnkept(what) {
        if (this._toldUnkept)
            return;
        this._toldUnkept = true;
        console.warn(`[@wcstack/storage] [wcs/storage-unserializable] The value saved under "${this._key}" holds ${what}, ` +
            "which JSON cannot keep: it is stored as {} and comes back empty after a reload. Keep it out of the " +
            "stored value (Blobs and files belong in IndexedDB or on a server). (Said once per element.)", this._target);
    }
    remove() {
        if (!this._key) {
            // never-throw: a missing key is routed to the error property instead of
            // throwing. No return value to sanitize (remove returns void).
            this._setError({ operation: "remove", message: "key is required." });
            this._warnNoKey("remove");
            return;
        }
        this._setLoading(true);
        this._setError(null);
        try {
            const storage = this._getStorage();
            storage.removeItem(this._key);
            this._setValue(null);
            this._setLoading(false);
        }
        catch (e) {
            this._setError(this._toStorageError("remove", e), this._errName(e));
            this._setLoading(false);
        }
    }
    startSync() {
        if (this._storageListener)
            return;
        // Capture the generation active when sync starts. A `storage` event that
        // fires after dispose() (which bumps _gen and removes the listener) carries a
        // stale gen and must not write state to a torn-down element. stopSync()
        // already detaches the listener, but the gen guard also covers a queued event
        // delivered between dispose()'s bump and the actual removeEventListener.
        const gen = ++this._gen;
        this._storageListener = (e) => {
            if (gen !== this._gen)
                return;
            if (e.key !== this._key)
                return;
            if (this._type === "session")
                return;
            // A fresh value arriving from another tab supersedes any stale error from
            // a prior failed load/save/remove. Clearing it here keeps the sync path
            // consistent with load()/save()/remove(), which all reset error to null at
            // the start of a successful operation — otherwise an "error present + fresh
            // value" inconsistency could persist after a cross-tab update.
            this._setError(null);
            if (e.newValue === null) {
                this._setValue(null);
            }
            else {
                try {
                    this._setValue(JSON.parse(e.newValue));
                }
                catch {
                    this._setValue(e.newValue);
                }
            }
        };
        globalThis.addEventListener("storage", this._storageListener);
    }
    stopSync() {
        if (!this._storageListener)
            return;
        globalThis.removeEventListener("storage", this._storageListener);
        this._storageListener = null;
    }
}

let registered = false;
function handleClick(event) {
    const target = event.target;
    if (!(target instanceof Element))
        return;
    const triggerElement = target.closest(`[${config.triggerAttribute}]`);
    if (!triggerElement)
        return;
    const storageId = triggerElement.getAttribute(config.triggerAttribute);
    if (!storageId)
        return;
    // Resolve the registered constructor at call time instead of importing Storage
    // as a value. The value import created a components/Storage.ts ⇄ autoTrigger.ts
    // cycle (Storage.connectedCallback() calls registerAutoTrigger()). instanceof
    // against the customElements registry keeps the exact same identity guarantee
    // — only the registered <wcs-storage> class matches — without the import cycle.
    const StorageCtor = customElements.get(config.tagNames.storage);
    const storageElement = document.getElementById(storageId);
    if (!StorageCtor || !(storageElement instanceof StorageCtor))
        return;
    event.preventDefault();
    storageElement.save();
}
function registerAutoTrigger() {
    if (registered)
        return;
    registered = true;
    document.addEventListener("click", handleClick);
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

class Storage extends HTMLElement {
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...StorageCore.wcBindable,
        properties: [
            ...StorageCore.wcBindable.properties,
            { name: "trigger", event: STORAGE_EVENTS.triggerChanged, semantics: "state" },
        ],
        // Shell-level input surface. The Core declares only the portable `key` / `type`;
        // the Shell adds the DOM-driven settable surface. No `attribute` hints are given:
        // the `key` / `type` / `manual` setters reflect to their attributes themselves, and a
        // binding system that mirrored inputs[].attribute (@wcstack/state 3.x) would set the
        // attribute twice (`value` / `trigger` are not attribute-backed). `commands` (load / save / remove)
        // are inherited unchanged from the Core via the spread above.
        inputs: [
            { name: "key" },
            { name: "storageKey" },
            { name: "type" },
            { name: "value" },
            { name: "manual" },
            { name: "trigger" },
        ],
    };
    static get observedAttributes() { return ["key", "storage-key", "type"]; }
    _core;
    _trigger = false;
    // Storage load()/save() are synchronous, so connection work never defers.
    // This stays an already-resolved Promise for the whole lifecycle; it exists
    // only to satisfy the `hasConnectedCallbackPromise` protocol (consumers may
    // `await el.connectedCallbackPromise`). connectedCallback intentionally does
    // not reassign it — there is nothing async to wait for, unlike <wcs-fetch>.
    _connectedCallbackPromise = Promise.resolve();
    _internals = null;
    // connectedCallback ran before (a reconnect defers its load: _scheduleLoad)
    _everConnected = false;
    // _scheduleLoad's microtask is waiting
    _loadPending = false;
    constructor() {
        super();
        this._core = new StorageCore(this);
        this._internals = this._initInternals();
        this._wireStates({
            [STORAGE_EVENTS.loadingChanged]: (d) => ({ loading: d === true }),
            [STORAGE_EVENTS.error]: (d) => ({ error: d != null }),
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
    // Push the Shell's current attribute-derived key / type down into the Core.
    // Every operation (load / save / remove / value setter) and every lifecycle
    // hook that may run a Core operation or cross-tab sync must do this first, so
    // the Core never acts on a stale key / type. Centralizing it here avoids the
    // previous pattern of repeating `_core.key = …; _core.type = …;` at each call
    // site, which risked a future call site forgetting one of the two.
    _syncCore() {
        this._core.key = this.key;
        this._core.type = this.type;
    }
    // Input setters never let setAttribute stringify null / undefined (a "null" /
    // "undefined" key would load and save under that literal key): `null` removes
    // the attribute (the default), `undefined` restores the attribute the element
    // started with (wc-bindable producer guidance P1; React 19 and a direct
    // assignment deliver it, @wcstack/state does not).
    get key() {
        return this.getAttribute("key") || this.getAttribute("storage-key") || "";
    }
    set key(value) {
        reflectAttribute(this, "key", value);
    }
    // `key` under another name. React and Vue take `key` for themselves and never hand it to
    // the element, so `<wcs-storage key="…">` in JSX or a Vue template stored nothing, with no
    // error (docs/seam-apps.md, fw-inventory). `storage-key` reaches the element in both;
    // `key` wins when both are written.
    get storageKey() {
        return this.key;
    }
    set storageKey(value) {
        reflectAttribute(this, "storage-key", value);
    }
    get type() {
        // Normalize at the Shell boundary: any attribute value other than the
        // exact "session" falls back to "local". This keeps an invalid attribute
        // (e.g. type="foo") from reaching the Core's validating setter and throwing
        // out of setAttribute / connectedCallback.
        return this.getAttribute("type") === "session" ? "session" : "local";
    }
    set type(value) {
        reflectAttribute(this, "type", value);
    }
    // The type attribute last warned about (once per value).
    _warnedType = null;
    // A type attribute that is neither "local" nor "session" falls back to "local" (the getter above).
    // Say so: data meant for the session would otherwise be kept on disk without a word
    // (docs/mistake-catalogue.md, "storage-type-typo").
    _checkType() {
        const type = this.getAttribute("type");
        if (type === null || type === "" || type === "local" || type === "session" || type === this._warnedType)
            return;
        this._warnedType = type;
        console.warn(`[@wcstack/storage] [wcs/storage-type-invalid] <${config.tagNames.storage} type="${type}"> is neither ` +
            `"local" nor "session": it uses localStorage, so the data is kept after the session ends.`);
    }
    get value() {
        return this._core.value;
    }
    set value(v) {
        // `undefined` is "no value supplied" (wc-bindable producer guidance P1; React 19
        // and a direct assignment deliver it, @wcstack/state does not): a no-op in both
        // modes, so the stored entry is kept and nothing is staged. `null` still clears —
        // it removes the key (non-manual) or stages null (manual).
        if (v === undefined)
            return;
        // Non-manual mode: assigning `value` auto-saves the *assigned* argument `v`
        // (write-through). Note this differs from save()/trigger, which persist the
        // *current* `_core.value` (which load() or a cross-tab `storage` event may
        // have updated). See README "Design Notes" for the rationale.
        //
        // Manual mode: assigning `value` does NOT persist — it only stages the value
        // into the Core (no storage write). This keeps the getter/setter consistent
        // (`el.value = x; el.value === x`) and lets a later save()/trigger commit the
        // staged value, so a `value: …` + `trigger: …` binding pair works as
        // documented. The actual write still happens only via save()/trigger.
        if (!this.manual) {
            this._syncCore();
            this._core.save(v);
        }
        else {
            this._core.value = v;
        }
    }
    get loading() {
        return this._core.loading;
    }
    get error() {
        return this._core.error;
    }
    get errorInfo() {
        return this._core.errorInfo;
    }
    get connectedCallbackPromise() {
        return this._connectedCallbackPromise;
    }
    get manual() {
        return this.hasAttribute("manual");
    }
    set manual(value) {
        reflectBooleanAttribute(this, "manual", value);
    }
    get trigger() {
        return this._trigger;
    }
    set trigger(value) {
        const v = !!value;
        if (v) {
            this._trigger = true;
            // save() is never-throw (a failure — e.g. key unset — is routed to the
            // `error` property, not thrown), but the try/finally is kept defensively
            // to guarantee the trigger resets to false and the completion event fires
            // even in the unexpected event of a throw, so the trigger never gets stuck
            // in the `true` state.
            try {
                this.save();
            }
            finally {
                this._trigger = false;
                this.dispatchEvent(new CustomEvent(STORAGE_EVENTS.triggerChanged, {
                    detail: false,
                    bubbles: true,
                }));
            }
        }
    }
    load() {
        this._syncCore();
        return this._core.load();
    }
    // The `save` command differs in arity between the two CSBC surfaces:
    // - Core:  save(value)  — caller supplies the value to persist
    // - Shell: save()       — persists the current `_core.value` (no argument)
    // Both are exposed under the same `commands` entry name "save". The protocol
    // `commands` list is descriptive metadata only and carries no arity, so this
    // is not a protocol violation; the difference is contractual and documented
    // in the README ("Design Notes").
    save() {
        this._syncCore();
        this._core.save(this._core.value);
    }
    remove() {
        this._syncCore();
        this._core.remove();
    }
    attributeChangedCallback(name, _oldValue, _newValue) {
        if (!this.isConnected)
            return;
        // `storage-key` is the same input under a name the frameworks leave alone; `key` wins
        // when both are written (the getter), so a change to the other one changes nothing.
        if (name === "storage-key" && this.getAttribute("key"))
            return;
        if (name === "key" || name === "storage-key") {
            // Always keep the Core's key in sync with the attribute, regardless of
            // mode or whether the new value is empty. The cross-tab `storage` listener
            // compares `e.key !== _core.key`, so a stale Core key would make sync watch
            // the wrong (old/empty) key after a runtime key change. load() (which also
            // syncs the Core) only runs for non-manual mode with a non-empty key — the
            // key now in effect, so removing `key` falls back to `storage-key`.
            this._syncCore();
            // a reconnect's load is waiting for its microtask: it reads the key in effect then
            if (this.key && !this.manual && !this._loadPending) {
                this.load();
            }
        }
        if (name === "type") {
            // Route through the normalizing getter so an invalid attribute value
            // (e.g. type="foo") falls back to "local" instead of throwing.
            this._checkType();
            this._syncCore();
        }
    }
    connectedCallback() {
        // upgrade 前に代入された input を取り込み直す（doc 13 §1.2 / Phase A1）
        upgradeProperties(this);
        this.style.display = "none";
        this._checkType();
        if (config.autoTrigger) {
            registerAutoTrigger();
        }
        if (!this._everConnected) {
            // The first connect loads at once: a binding attached in the same task (a route's content
            // handed to @wcstack/state right after its insertion) pulls `value` and expects it loaded.
            this._everConnected = true;
            if (!this.manual && this.key) {
                this.load();
            }
        }
        else {
            // A reconnect decides in a microtask, with the key then (timing-and-firing-contract §23).
            // @wcstack/router puts the same nodes back on a parameter-only navigation, and the state
            // writes the new route's key in a microtask: loading at once read the previous key's value
            // and published it (docs/seam-apps.md, shift-desk).
            this._scheduleLoad();
        }
        // Always bind the cross-tab watcher to the Shell's current key/type before
        // starting sync. In paths where load()/save() never run (e.g. manual mode,
        // or key set via JS without a load), _core.key/_core.type would otherwise
        // keep a stale/empty value and the storage listener's `e.key !== _key`
        // check would compare against the wrong key. This also covers detach →
        // re-attach: stale Core key from a previous session is overwritten here.
        this._syncCore();
        this._core.startSync();
    }
    disconnectedCallback() {
        this._core.stopSync();
    }
    _scheduleLoad() {
        if (this._loadPending)
            return;
        this._loadPending = true;
        queueMicrotask(() => {
            this._loadPending = false;
            if (this.isConnected && !this.manual && this.key) {
                this.load();
            }
        });
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
        [config.tagNames.storage, Storage],
    ]);
}

function bootstrapStorage(userConfig, registry) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents(registry);
}

export { StorageCore, WCS_STORAGE_ERROR_CODE, Storage as WcsStorage, bootstrapStorage, getConfig };
//# sourceMappingURL=index.esm.js.map
