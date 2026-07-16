const _config = {
    tagNames: {
        contacts: "wcs-contacts",
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
// Note: this is the live, mutable internal config. It is not part of the public
// package exports (see exports.ts) — only `getConfig()` (frozen snapshot) is
// surfaced; `setConfig()` is applied internally via `bootstrapContacts()` and is
// not re-exported from the package root — but a deep path import (`.../src/config.js`)
// can still reach and mutate it. Accepted as-is for cross-package consistency: every
// @wcstack package follows this same shape. Use `getConfig()` for a frozen, safe read.
const config = _config;
function getConfig() {
    if (!frozenConfig) {
        frozenConfig = deepFreeze(deepClone(_config));
    }
    return frozenConfig;
}
function setConfig(partialConfig) {
    if (partialConfig.tagNames) {
        Object.assign(_config.tagNames, partialConfig.tagNames);
    }
    frozenConfig = null;
}

// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /io-core/operation-lane.ts by scripts/sync-io-core.mjs.
// Run `node scripts/sync-io-core.mjs` after editing the source.
// ===========================================================================
/**
 * 1 レーン = 独立した排他単位。Core が 1 つ以上所有する (module singleton にしない —
 * 複数 <wcs-fetch> 間で漏れるため)。
 */
class OperationLane {
    laneKey;
    policy;
    _ownerGeneration = 0;
    _latestEpoch = 0;
    _nextOperationId = 1;
    // latest / queue / exhaust の単一 active。queue は head を指す。
    _activeOperationId = undefined;
    // overlap の active set (§5: 内部 bookkeeping のみ・observable 公開はしない)。
    _activeOperationIds = new Set();
    // queue policy の FIFO。
    _queue = [];
    _inFlightCount = 0;
    // opId → 終端状態 (absence = pending)。
    _terminal = new Map();
    // claimTerminal で確定した outcome (finalize が 'committing' を最終値へ移す)。
    _claimedOutcome = new Map();
    // opId → AbortController (identity は opId が保証。cross-op clobber は構造上起きない)。
    _controllers = new Map();
    // opId → attempt 数。
    _attempts = new Map();
    _withSignal;
    _trace;
    constructor(laneKey, policy, options = {}) {
        this.laneKey = laneKey;
        this.policy = policy;
        this._withSignal = options.withSignal ?? false;
        this._trace = options.trace;
    }
    get ownerGeneration() {
        return this._ownerGeneration;
    }
    get inFlightCount() {
        return this._inFlightCount;
    }
    get latestEpoch() {
        return this._latestEpoch;
    }
    get activeOperationId() {
        return this._activeOperationId;
    }
    /**
     * 新しい要求の到着。arrival policy を適用し ticket + 最初の attempt を発行する。
     * exhaust で実行中の場合だけ null を返す (新要求を ticket 化せず拒否 = 冪等 no-op)。
     */
    begin() {
        let supersedeEpoch;
        switch (this.policy) {
            case "latest": {
                // latestEpoch を進め、旧 active を abort (可能なら)。旧 ticket は settle 時に
                // eligibility 不一致で stale となる。
                supersedeEpoch = ++this._latestEpoch;
                if (this._activeOperationId !== undefined) {
                    this._abortController(this._activeOperationId);
                }
                break;
            }
            case "exhaust": {
                // 実行中なら新要求を拒否 (呼び出し側は既存結果へ合流)。
                if (this._activeOperationId !== undefined) {
                    return null;
                }
                break;
            }
        }
        const operationId = this._nextOperationId++;
        const ticket = {
            operationId,
            ownerGeneration: this._ownerGeneration,
            laneKey: this.laneKey,
            policy: this.policy,
            supersedeEpoch,
        };
        switch (this.policy) {
            case "latest":
            case "exhaust":
                this._activeOperationId = operationId;
                break;
            case "queue":
                this._queue.push(ticket);
                // 先頭だけを active にする (先行が完了するまで待つ)。
                if (this._activeOperationId === undefined) {
                    this._activeOperationId = operationId;
                }
                break;
            case "overlap":
                this._activeOperationIds.add(operationId);
                break;
        }
        this._inFlightCount += 1;
        this._attempts.set(operationId, 1);
        const attempt = this._makeAttempt(operationId, 1);
        if (this._trace !== undefined) {
            this._trace({ type: "io:operation-started", operationId, laneKey: this.laneKey, policy: this.policy });
        }
        return { ticket, attempt };
    }
    /**
     * retry: 同じ operationId に新しい attempt を作る。attempt number と resource signal
     * だけを更新する (§5)。既に終端した operation には作れない (null)。
     */
    retry(ticket) {
        if (ticket.ownerGeneration !== this._ownerGeneration)
            return null;
        if (this._terminal.has(ticket.operationId))
            return null;
        const previous = this._attempts.get(ticket.operationId);
        if (previous === undefined)
            return null;
        const attemptNo = previous + 1;
        this._attempts.set(ticket.operationId, attemptNo);
        // 前の attempt の signal は破棄し、新しい controller を張る。
        this._releaseController(ticket.operationId);
        const attempt = this._makeAttempt(ticket.operationId, attemptNo);
        if (this._trace !== undefined) {
            this._trace({ type: "io:operation-retried", operationId: ticket.operationId, laneKey: this.laneKey, attempt: attemptNo });
        }
        return attempt;
    }
    /**
     * CommitGuard (§5.1)。外部可視の setter / event dispatch の直前に呼ぶ。
     * (1) owner lifecycle generation 一致 (2) terminal settle 前 (3) policy eligibility。
     */
    canCommit(ticket) {
        if (ticket.ownerGeneration !== this._ownerGeneration)
            return false;
        const status = this._terminal.get(ticket.operationId);
        // absence = pending / 'committing' = multi-setter commit 中。どちらも settle 前。
        if (status !== undefined && status !== "committing")
            return false;
        return this._isEligible(ticket);
    }
    /**
     * terminal CAS (§5.1): pending → committing を claim する。勝者だけが true。
     * eligibility / owner gen を満たさない場合も false。claim 後は commit 中となり、
     * canCommit は各 setter の直前で再検査する (setter が同期 supersede しても取りこぼさない)。
     */
    claimTerminal(ticket, outcome) {
        if (ticket.ownerGeneration !== this._ownerGeneration)
            return false;
        if (this._terminal.has(ticket.operationId))
            return false; // 既に committing / 終端
        if (!this._isEligible(ticket))
            return false;
        this._terminal.set(ticket.operationId, "committing");
        this._claimedOutcome.set(ticket.operationId, outcome);
        return true;
    }
    /** claim 済み outcome (timer が claim → catch が読む等)。未 claim なら undefined。 */
    claimedOutcome(ticket) {
        return this._claimedOutcome.get(ticket.operationId);
    }
    /**
     * operation の後始末。claim 済みなら outcome を確定し、未 claim なら stale-drop。
     * controller を解放し in-flight を減らし、policy の bookkeeping を進める。冪等。
     */
    finalize(ticket) {
        const operationId = ticket.operationId;
        const status = this._terminal.get(operationId);
        if (status !== undefined && status !== "committing") {
            // 既に確定済み。冪等に return。
            return;
        }
        let outcome;
        if (status === "committing") {
            outcome = this._claimedOutcome.get(operationId) ?? "stale";
        }
        else {
            // 一度も claim されなかった (supersede / dispose で eligibility を失った)。
            outcome = "stale";
        }
        this._terminal.set(operationId, outcome);
        this._claimedOutcome.delete(operationId);
        this._releaseController(operationId);
        this._attempts.delete(operationId);
        if (this._inFlightCount > 0)
            this._inFlightCount -= 1;
        this._advanceBookkeeping(operationId);
        if (this._trace !== undefined) {
            if (outcome === "stale") {
                this._trace({ type: "io:stale-dropped", operationId, laneKey: this.laneKey });
            }
            else {
                this._trace({ type: "io:operation-settled", operationId, laneKey: this.laneKey, outcome });
            }
        }
    }
    /** operation の signal (resource 解放用)。withSignal でなければ undefined。 */
    signalOf(ticket) {
        return this._controllers.get(ticket.operationId)?.signal;
    }
    /** best-effort な resource 中断。正しさは owner gen / eligibility / terminal CAS が担う。 */
    abort(ticket) {
        this._abortController(ticket.operationId);
    }
    /**
     * 現在 active な operation を中断する (利用者による明示キャンセル)。epoch は進めない —
     * 中断された operation は eligibility を保ったまま 'aborted' を claim できる
     * (loading をクリアしつつ in-flight 状態を残す)。
     */
    abortActive() {
        if (this._activeOperationId !== undefined) {
            this._abortController(this._activeOperationId);
        }
        for (const operationId of this._activeOperationIds) {
            this._abortController(operationId);
        }
    }
    /**
     * dispose (§4.1 world generation)。owner generation を bump して全 ticket を無効化し、
     * 生きている controller を全て abort する。dispose 後に settle した operation は
     * owner gen 不一致で外部 commit しない。retention gate (§10.3) のため live な
     * 全 operation を即時に stale として finalize し、controller / attempt を解放する。
     */
    disposeOwner() {
        this._ownerGeneration += 1;
        for (const operationId of Array.from(this._controllers.keys())) {
            this._abortController(operationId);
            // finalize は dispose 後 (terminal='stale') に early-return するため controller を
            // 解放しない。retention gate (§10.3) を満たすためここで明示的に解放する。
            this._releaseController(operationId);
        }
        for (const operationId of Array.from(this._attempts.keys())) {
            if (!this._terminal.has(operationId)) {
                this._terminal.set(operationId, "stale");
            }
            this._claimedOutcome.delete(operationId);
            this._attempts.delete(operationId);
            if (this._trace !== undefined) {
                this._trace({ type: "io:stale-dropped", operationId, laneKey: this.laneKey });
            }
        }
        this._activeOperationId = undefined;
        this._activeOperationIds.clear();
        this._queue.length = 0;
        this._inFlightCount = 0;
    }
    // --- internal ---
    _makeAttempt(operationId, attemptNo) {
        let signal;
        // AbortController 不在環境(古い runtime / 一部 SSR)では degraded: signal なしで進む。
        // 正しさは owner generation / eligibility / terminal CAS が担うため、native 中断が
        // 無くても supersede / dispose は機能する(best-effort resource 中断が省かれるだけ)。
        if (this._withSignal && typeof AbortController === "function") {
            const controller = new AbortController();
            this._controllers.set(operationId, controller);
            signal = controller.signal;
        }
        return { operationId, attempt: attemptNo, signal };
    }
    _isEligible(ticket) {
        switch (this.policy) {
            case "latest":
                return ticket.supersedeEpoch === this._latestEpoch;
            case "queue":
            case "exhaust":
                return this._activeOperationId === ticket.operationId;
            case "overlap":
                return this._activeOperationIds.has(ticket.operationId);
        }
    }
    _advanceBookkeeping(operationId) {
        switch (this.policy) {
            case "latest":
            case "exhaust":
                if (this._activeOperationId === operationId) {
                    this._activeOperationId = undefined;
                }
                break;
            case "queue": {
                // 完了した ticket を FIFO から取り除き、次の先頭を active にする。filter で
                // 「先頭 / 非先頭 / 不在」を一様に扱う (finalize は冪等ガードを通った op のみ到達)。
                const remaining = this._queue.filter((t) => t.operationId !== operationId);
                this._queue.length = 0;
                this._queue.push(...remaining);
                this._activeOperationId = this._queue.length > 0 ? this._queue[0].operationId : undefined;
                break;
            }
            case "overlap":
                this._activeOperationIds.delete(operationId);
                break;
        }
    }
    _abortController(operationId) {
        const controller = this._controllers.get(operationId);
        if (controller !== undefined && !controller.signal.aborted) {
            controller.abort();
        }
    }
    _releaseController(operationId) {
        this._controllers.delete(operationId);
    }
}

// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /io-core/platform-capability.ts by scripts/sync-io-core.mjs.
// Run `node scripts/sync-io-core.mjs` after editing the source.
// ===========================================================================
function isSecureContext() {
    return globalThis.isSecureContext === true;
}
/**
 * capability を利用直前に評価して PlatformAssessment を作る。
 * required が 1 つでも欠ければ readiness は "idle"(開始不可)、
 * required 揃い + optional 欠けは "degraded"、全揃いは "ready"。
 */
function assessCapabilities(registry, options) {
    const availability = new Map();
    const evaluate = (id) => {
        const spec = registry.get(id);
        if (spec === undefined)
            return "unknown";
        return spec.probe() ? "available" : "missing";
    };
    let requiredAllAvailable = true;
    for (const id of options.required) {
        const a = evaluate(id);
        availability.set(id, a);
        if (a !== "available")
            requiredAllAvailable = false;
    }
    let optionalAllAvailable = true;
    for (const id of options.optional ?? []) {
        const a = evaluate(id);
        availability.set(id, a);
        if (a !== "available")
            optionalAllAvailable = false;
    }
    const readiness = !requiredAllAvailable ? "idle" : (optionalAllAvailable ? "ready" : "degraded");
    // preconditions: 対象 capability のいずれかが要求する場合だけ評価する。
    const allIds = [...options.required, ...(options.optional ?? [])];
    const needsSecure = allIds.some((id) => registry.get(id)?.requiresSecureContext === true);
    const needsActivation = allIds.some((id) => registry.get(id)?.requiresUserActivation === true);
    const secureContext = needsSecure ? (isSecureContext() ? "satisfied" : "required") : "not-applicable";
    const userActivation = needsActivation ? "required" : "not-applicable";
    return {
        availability,
        permission: options.permission ?? "not-applicable",
        readiness,
        activity: options.activity ?? "inactive",
        preconditions: { secureContext, userActivation },
        epoch: options.epoch ?? 0,
        lastError: options.lastError,
    };
}
/** availability から「required がすべて available か」を判定するヘルパ(supported の最低条件)。 */
function requiredCapabilitiesAvailable(assessment, required) {
    return required.every((id) => assessment.availability.get(id) === "available");
}

/**
 * contactsCapabilities.ts
 *
 * Contact Picker node 固有の capability registry と error code。汎用の assess 機構・
 * 型は `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)
 * から import する。node 固有の宣言はこのハンドライトファイルに置き、生成コピーとは
 * 分離する。
 */
/** 安定した contacts error code(taxonomy)。値は公開キーとして固定。 */
const WCS_CONTACTS_ERROR_CODE = {
    CapabilityMissing: "capability-missing",
    SelectFailed: "select-failed",
};
/** contacts node の capability registry。文字列 ID を eval せず明示 probe を持つ。 */
const CONTACTS_CAPABILITIES = new Map([
    ["web.contacts", { probe: () => typeof globalThis.navigator?.contacts?.select === "function", compatKey: "api.ContactsManager.select" }],
]);

/**
 * Headless Contact Picker primitive. A thin, framework-agnostic wrapper around
 * `navigator.contacts.select(properties, options)` exposed through the
 * wc-bindable protocol.
 *
 * Concurrency is owned by the shared `OperationLane` (io-core) with the `exhaust`
 * policy: the contact picker is a single system-modal surface, so while one
 * select() is in flight a new call is rejected as an idempotent no-op instead of
 * starting a second `navigator.contacts.select()`. This replaces the earlier
 * dispose-only `_gen` guard, which relied on the platform rejecting the second call
 * with `InvalidStateError` — but that let the rejected second call reset/overwrite
 * the still-pending first call's `error`/`loading` state. The lane's owner
 * generation still invalidates any in-flight select() on dispose().
 *
 * The Contact Picker API accepts no `AbortSignal`, so the lane runs with
 * `withSignal: false`. `select()` takes **two** positional arguments
 * (`properties`, `options`) rather than one — the command-token argument
 * pass-through does not special-case argument count, so this requires no protocol
 * change.
 */
class ContactsCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "value", event: "wcs-contacts:complete", getter: (e) => e.detail.value },
            { name: "loading", event: "wcs-contacts:loading-changed" },
            { name: "error", event: "wcs-contacts:error" },
            { name: "cancelled", event: "wcs-contacts:cancelled-changed" },
            // Serializable failure taxonomy (stable code / phase / recoverable), or null.
            // Additive bindable output; the existing `error` property/event are unchanged.
            // Fires its own `wcs-contacts:error-info-changed` event; no getter, so the
            // bound value is the event detail (mirrors `error` / `loading` / `cancelled`).
            { name: "errorInfo", event: "wcs-contacts:error-info-changed" },
        ],
        commands: [
            { name: "select", async: true },
        ],
    };
    // Required capability (probed at call time, never at module eval).
    static REQUIRED_CAPABILITIES = ["web.contacts"];
    _target;
    _value = null;
    _loading = false;
    _error = null;
    _cancelled = false;
    _errorInfo = null;
    // Concurrency lane (io-core). `exhaust`: only one picker at a time — a new begin()
    // while active returns null (idempotent no-op). `withSignal: false`:
    // navigator.contacts.select() has no AbortSignal. dispose() bumps the owner gen.
    _lane = new OperationLane("contacts", "exhaust", { withSignal: false });
    // SSR (§3.8): no asynchronous probe to await, so readiness is immediate.
    _ready = Promise.resolve();
    constructor(target) {
        super();
        this._target = target ?? this;
    }
    get ready() {
        return this._ready;
    }
    get value() {
        return this._value;
    }
    get loading() {
        return this._loading;
    }
    get error() {
        return this._error;
    }
    get cancelled() {
        return this._cancelled;
    }
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable` / `capabilityId`), or null. Exposed as an additive wc-bindable
     * property (event `wcs-contacts:error-info-changed`); the existing `error`
     * property/event are unchanged.
     */
    get errorInfo() {
        return this._errorInfo;
    }
    /**
     * Whether the required platform capability (`web.contacts`) is available right
     * now — decided by call-time feature detection, not User-Agent. Core-only,
     * additive.
     */
    get supported() {
        return requiredCapabilitiesAvailable(this.platformAssessment, ContactsCore.REQUIRED_CAPABILITIES);
    }
    /**
     * Full platform assessment (availability / readiness / preconditions), probed at
     * call time. Core-only opt-in dev / sidecar view.
     */
    get platformAssessment() {
        return assessCapabilities(CONTACTS_CAPABILITIES, {
            required: ContactsCore.REQUIRED_CAPABILITIES,
            activity: this._loading ? "active" : "inactive",
            lastError: this._errorInfo ?? undefined,
        });
    }
    // Lifecycle (§3.5). Select is command-driven with no subscription to establish,
    // so observe() is an idempotent no-op that resolves once ready; dispose() bumps
    // the lane's owner generation, invalidating any in-flight select() (a late
    // resolve then fails the terminal CAS). There is nothing to abort or unsubscribe.
    observe() {
        return this._ready;
    }
    dispose() {
        this._lane.disposeOwner();
    }
    _setLoading(loading) {
        if (this._loading === loading)
            return;
        this._loading = loading;
        this._target.dispatchEvent(new CustomEvent("wcs-contacts:loading-changed", {
            detail: loading,
            bubbles: true,
        }));
    }
    _setValue(value) {
        if (this._value === value)
            return;
        this._value = value;
        this._target.dispatchEvent(new CustomEvent("wcs-contacts:complete", {
            detail: { value },
            bubbles: true,
        }));
    }
    _setError(error) {
        if (this._error === error)
            return;
        this._error = error;
        this._target.dispatchEvent(new CustomEvent("wcs-contacts:error", {
            detail: error,
            bubbles: true,
        }));
    }
    _setCancelled(cancelled) {
        if (this._cancelled === cancelled)
            return;
        this._cancelled = cancelled;
        this._target.dispatchEvent(new CustomEvent("wcs-contacts:cancelled-changed", {
            detail: cancelled,
            bubbles: true,
        }));
    }
    // Single mutation point for `errorInfo`, mirroring `_setError`'s same-value guard
    // and event dispatch so the additive `errorInfo` wc-bindable property stays in
    // sync with `error`. Each failure builds a fresh object (reference guard passes);
    // the clear path passes null (suppresses a redundant null→null per select start).
    _setErrorInfo(code, phase, recoverable, message, capabilityId) {
        this._commitErrorInfo({ code, phase, recoverable, message, ...(capabilityId === undefined ? {} : { capabilityId }) });
    }
    _commitErrorInfo(info) {
        if (this._errorInfo === info)
            return;
        this._errorInfo = info;
        this._target.dispatchEvent(new CustomEvent("wcs-contacts:error-info-changed", {
            detail: info,
            bubbles: true,
        }));
    }
    async select(properties, options) {
        // never-throw + unsupported (§7.2): probe the required capability at call time.
        // Desktop browsers entirely lack this API, so this is the common case. If
        // `web.contacts` is absent, do NOT start — surface a stable `capability-missing`
        // taxonomy and the existing error message shape.
        const assessment = this.platformAssessment;
        if (!requiredCapabilitiesAvailable(assessment, ContactsCore.REQUIRED_CAPABILITIES)) {
            const missing = ContactsCore.REQUIRED_CAPABILITIES.find((id) => assessment.availability.get(id) !== "available");
            const message = "Contact Picker API is not supported in this browser.";
            this._setErrorInfo(WCS_CONTACTS_ERROR_CODE.CapabilityMissing, "start", false, message, missing);
            this._setError({ message });
            return null;
        }
        // exhaust: a picker is already open → reject this call as an idempotent no-op
        // instead of racing a second select() (which would reject and corrupt the
        // in-flight call's result). begin() returns null when active.
        const started = this._lane.begin();
        if (started === null) {
            return null;
        }
        const { ticket } = started;
        // Capability probed above → navigator.contacts.select is present. Resolve + bind
        // at call time (never cached, §3.7) so tests can install/remove it freely.
        const nav = globalThis.navigator;
        const selectFn = nav.contacts.select.bind(nav.contacts);
        // Start phase runs synchronously on a fresh ticket (no dispose can interleave
        // before the first await), so these setters are unconditional. Post-await
        // setters are gated by the lane's terminal CAS (claimTerminal), which fails on
        // a stale/disposed ticket — contacts (exhaust, no supersede/timeout) needs no
        // per-setter commit guard (unlike FetchCore's `latest` lane).
        this._setLoading(true);
        // Reset the previous outcome before starting a new select so a stale
        // cancelled/error/errorInfo does not linger into this call's result.
        this._commitErrorInfo(null);
        this._setError(null);
        this._setCancelled(false);
        try {
            const contacts = await selectFn(properties, options);
            // Terminal CAS: a stale (dispose-invalidated) completion loses the claim.
            if (!this._lane.claimTerminal(ticket, "success")) {
                return null;
            }
            // `multiple` does not change the result shape — even a single selection
            // resolves to a one-element array (docs/contact-picker-tag-design.md §3).
            this._setValue(contacts);
            this._setLoading(false);
            this._lane.finalize(ticket);
            return contacts;
        }
        catch (e) {
            const cancelled = e?.name === "AbortError";
            if (!this._lane.claimTerminal(ticket, cancelled ? "aborted" : "error")) {
                return null;
            }
            if (cancelled) {
                // The user dismissed the contact picker — a routine cancellation, not a
                // platform failure. Kept out of `error`/`errorInfo`.
                this._setCancelled(true);
            }
            else {
                const message = String(e?.message ?? "Contact selection failed.");
                this._setErrorInfo(WCS_CONTACTS_ERROR_CODE.SelectFailed, "execute", true, message);
                this._setError(e ?? { message });
            }
            this._setLoading(false);
            this._lane.finalize(ticket);
            return null;
        }
    }
}

/**
 * `<wcs-contacts>` — declarative Contact Picker API primitive.
 *
 * A thin command-only Shell (mirrors `<wcs-share>`): no attributes at all.
 * `select(properties, options)`'s arguments are per-call, not a declarative
 * setting to park on the element ahead of time.
 *
 * **Android Chrome only.** Desktop browsers entirely lack `navigator.contacts`
 * — treat `unsupported` as the default state, not an edge case, in any
 * example or consuming UI.
 */
class WcsContacts extends HTMLElement {
    // SSR (§4.4): observe() completes synchronously, but the Shell still exposes
    // connectedCallbackPromise so the state binder can await it uniformly across
    // all IO nodes before snapshotting.
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...ContactsCore.wcBindable,
        inputs: [],
        // Core の commands をそのまま継承（単一情報源）。
        commands: ContactsCore.wcBindable.commands,
    };
    _core;
    _connectedCallbackPromise = Promise.resolve();
    _internals = null;
    constructor() {
        super();
        this._core = new ContactsCore(this);
        this._internals = this._initInternals();
        this._wireStates({
            "wcs-contacts:loading-changed": (d) => ({ loading: d === true }),
            "wcs-contacts:cancelled-changed": (d) => ({ cancelled: d === true }),
            "wcs-contacts:error": (d) => ({ error: d != null }),
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
    // --- Core delegated getters ---
    get value() {
        return this._core.value;
    }
    get loading() {
        return this._core.loading;
    }
    get error() {
        return this._core.error;
    }
    get cancelled() {
        return this._core.cancelled;
    }
    get errorInfo() {
        return this._core.errorInfo;
    }
    get connectedCallbackPromise() {
        return this._connectedCallbackPromise;
    }
    // --- Commands ---
    select(properties, options) {
        return this._core.select(properties, options);
    }
    // --- Lifecycle ---
    connectedCallback() {
        this.style.display = "none";
        this._connectedCallbackPromise = this._core.observe();
    }
    disconnectedCallback() {
        this._core.dispose();
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.contacts)) {
        customElements.define(config.tagNames.contacts, WcsContacts);
    }
}

function bootstrapContacts(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { ContactsCore, WCS_CONTACTS_ERROR_CODE, WcsContacts, bootstrapContacts, getConfig };
//# sourceMappingURL=index.esm.js.map
