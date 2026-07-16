const _config = {
    autoTrigger: true,
    triggerAttribute: "data-fetchtarget",
    tagNames: {
        fetch: "wcs-fetch",
        fetchHeader: "wcs-fetch-header",
        fetchBody: "wcs-fetch-body",
        infiniteScroll: "wcs-infinite-scroll",
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
function setConfig(partialConfig) {
    if (typeof partialConfig.autoTrigger === "boolean") {
        _config.autoTrigger = partialConfig.autoTrigger;
    }
    if (typeof partialConfig.triggerAttribute === "string") {
        _config.triggerAttribute = partialConfig.triggerAttribute;
    }
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
 * fetchCapabilities.ts
 *
 * fetch node 固有の capability registry と error code。汎用の assess 機構・型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。node 固有の宣言はこのハンドライトファイルに置き、生成コピーとは分離する。
 */
/** 安定した fetch error code(taxonomy)。値は公開キーとして固定。 */
const WCS_FETCH_ERROR_CODE = {
    CapabilityMissing: "capability-missing",
    InvalidArgument: "invalid-argument",
    Network: "network",
    HttpError: "http-error",
    Timeout: "timeout",
    Aborted: "aborted",
};
/** fetch node の capability registry。文字列 ID を eval せず明示 probe を持つ。 */
const FETCH_CAPABILITIES = new Map([
    ["web.fetch", { probe: () => typeof globalThis.fetch === "function", compatKey: "api.fetch" }],
    ["web.abort-controller", { probe: () => typeof globalThis.AbortController === "function", compatKey: "api.AbortController" }],
]);

class FetchCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "value", event: "wcs-fetch:response", getter: (e) => e.detail.value },
            { name: "loading", event: "wcs-fetch:loading-changed" },
            { name: "error", event: "wcs-fetch:error" },
            { name: "status", event: "wcs-fetch:response", getter: (e) => e.detail.status },
            // Managed object URL for a `responseType: "blob"` response (null otherwise).
            // The Core revokes the previous URL on each new response and on dispose, so
            // a consumer can bind it straight into <img src> without lifecycle glue.
            { name: "objectURL", event: "wcs-fetch:response", getter: (e) => e.detail.objectURL },
            // Serializable failure taxonomy (stable code / phase / recoverable), or null.
            // Additive bindable output — the existing `error` property/event are unchanged.
            // Fires on its own `wcs-fetch:error-info-changed` event; no getter, so the
            // bound value is the event detail (mirrors `error` / `loading`).
            { name: "errorInfo", event: "wcs-fetch:error-info-changed" },
        ],
        inputs: [
            { name: "url" },
            { name: "method" },
        ],
        commands: [
            { name: "fetch", async: true },
            { name: "abort" },
        ],
    };
    _target;
    _value = null;
    _loading = false;
    _error = null;
    _status = 0;
    _objectURL = null;
    _promise = Promise.resolve(null);
    // Phase 4 (09-remediation-design.md §5): the request lane. `latest` policy —
    // a new fetch supersedes the in-flight one (switchMap). The lane owns the
    // per-operation AbortController, the owner generation (dispose lifecycle) and
    // the terminal CAS / CommitGuard that decide which completion may write state.
    // This replaces the ad-hoc `_gen` counter + single `_abortController`: a
    // superseded operation now fails the CommitGuard's epoch check instead of
    // relying on a coarse generation recheck, closing the "completion racing an
    // abort commits stale state" gap during body reads.
    _lane = new OperationLane("fetch", "latest", { withSignal: true });
    // SSR (§3.8): no asynchronous probe to await, so readiness is immediate.
    _ready = Promise.resolve();
    // Phase 6 (§7.2): error taxonomy. The existing `error` property/event shape is
    // unchanged; `errorInfo` projects the serializable WcsIoErrorInfo as an additive
    // wc-bindable output (event `wcs-fetch:error-info-changed`) so DevTools / adopters
    // can classify failures without a breaking change.
    _errorInfo = null;
    // Capability IDs (probed at call time, never at module eval / never eval'd as a
    // global path). `web.fetch` required; `web.abort-controller` optional (its
    // absence degrades to a fetch without an abort signal).
    static REQUIRED_CAPABILITIES = ["web.fetch"];
    static OPTIONAL_CAPABILITIES = ["web.abort-controller"];
    constructor(target) {
        super();
        this._target = target ?? this;
    }
    get ready() {
        return this._ready;
    }
    // Lifecycle (§3.5). Fetch is command-driven with no subscription to
    // establish, so observe() is an idempotent no-op that resolves once ready;
    // dispose() invalidates any in-flight request and aborts it.
    observe() {
        return this._ready;
    }
    dispose() {
        // world generation bump (§4.1): invalidates + aborts every in-flight request.
        this._lane.disposeOwner();
        // Release any outstanding blob object URL on teardown (the other revoke point
        // is _setResponse, which drops the previous URL when a new response arrives).
        if (this._objectURL !== null) {
            this._revokeObjectURL(this._objectURL);
            this._objectURL = null;
        }
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
    get status() {
        return this._status;
    }
    get objectURL() {
        return this._objectURL;
    }
    get promise() {
        return this._promise;
    }
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable` / `capabilityId`), or null. Exposed as an additive wc-bindable
     * property (event `wcs-fetch:error-info-changed`); the existing `error`
     * property/event are unchanged.
     */
    get errorInfo() {
        return this._errorInfo;
    }
    /**
     * Whether the required platform capabilities (`web.fetch`) are available right
     * now — the minimal "supported" signal, decided by call-time feature detection,
     * not User-Agent. Additive.
     */
    get supported() {
        return requiredCapabilitiesAvailable(this.platformAssessment, FetchCore.REQUIRED_CAPABILITIES);
    }
    /**
     * Full platform assessment (availability / readiness / preconditions), probed
     * at call time. `readiness` is `degraded` when only the optional
     * `web.abort-controller` is missing. Dev / sidecar view.
     */
    get platformAssessment() {
        return assessCapabilities(FETCH_CAPABILITIES, {
            required: FetchCore.REQUIRED_CAPABILITIES,
            optional: FetchCore.OPTIONAL_CAPABILITIES,
            activity: this._loading ? "active" : "inactive",
            lastError: this._errorInfo ?? undefined,
        });
    }
    _setErrorInfo(code, phase, recoverable, message, capabilityId) {
        this._commitErrorInfo({ code, phase, recoverable, message, ...(capabilityId === undefined ? {} : { capabilityId }) });
    }
    // Single mutation point for `errorInfo`, mirroring `_setError`'s same-value guard
    // and event dispatch so the additive `errorInfo` wc-bindable property stays in sync
    // with `error`. Each failure builds a fresh object (reference guard passes); the
    // clear path passes null (suppresses a redundant null→null per successful fetch).
    _commitErrorInfo(info) {
        if (this._errorInfo === info)
            return;
        this._errorInfo = info;
        this._target.dispatchEvent(new CustomEvent("wcs-fetch:error-info-changed", {
            detail: info,
            bubbles: true,
        }));
    }
    _setLoading(loading) {
        this._loading = loading;
        this._target.dispatchEvent(new CustomEvent("wcs-fetch:loading-changed", {
            detail: loading,
            bubbles: true,
        }));
    }
    _setError(error) {
        // Same-value guard (async-io-node-guidelines.md §3.3). `error` is state-ish,
        // so suppressing redundant null→null dispatches (every fetch start clears a
        // usually-already-null error) avoids a spurious wcs-fetch:error per successful
        // request. Reference identity is sufficient: each failure builds a fresh
        // object, and the clear path always passes null.
        if (this._error === error)
            return;
        this._error = error;
        this._target.dispatchEvent(new CustomEvent("wcs-fetch:error", {
            detail: error,
            bubbles: true,
        }));
    }
    _setResponse(value, status, objectURL = null) {
        // Revoke the previous blob object URL before replacing it. Any new response
        // (success, HTTP error, or network error all funnel through here) supersedes
        // the prior one, so the old URL is no longer needed; this plus dispose()
        // revocation keeps blob downloads leak-free.
        if (this._objectURL !== null) {
            this._revokeObjectURL(this._objectURL);
        }
        this._objectURL = objectURL;
        this._value = value;
        this._status = status;
        this._target.dispatchEvent(new CustomEvent("wcs-fetch:response", {
            detail: { value, status, objectURL },
            bubbles: true,
        }));
    }
    // Object URL lifecycle for responseType: "blob". The Core owns the blob's
    // object URL (mirrors RecorderCore) so a consumer can bind `objectURL` straight
    // into <img src>/<a href> without managing createObjectURL/revokeObjectURL. Both
    // helpers tolerate environments without URL.createObjectURL (SSR / headless).
    _createObjectURL(blob) {
        if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
            return URL.createObjectURL(blob);
        }
        return null;
    }
    _revokeObjectURL(url) {
        if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
            URL.revokeObjectURL(url);
        }
    }
    abort() {
        // Explicit user cancel: abort the active operation WITHOUT advancing the lane
        // epoch, so the aborted operation stays eligible and its AbortError branch may
        // commit loading=false (leaving the in-flight value/status). A superseding
        // fetch() instead advances the epoch (via the lane's begin()), which makes the
        // predecessor ineligible so its abort commits nothing (loading does not flicker).
        this._lane.abortActive();
    }
    // Run one guarded commit step (§5.1). The CommitGuard is re-checked before every
    // setter because a setter that synchronously dispatches an event can supersede
    // the same lane; an invalidation between setters stops the remaining commits
    // without rolling back what already fired.
    _commitStep(ticket, step) {
        if (this._lane.canCommit(ticket)) {
            step();
        }
    }
    async fetch(url, options = {}) {
        // never-throw (§3.6): 引数バリデーション失敗は例外ではなく error プロパティに
        // 流し、サニタイズ値(null)を返す。command-token 経路からの呼び出しが unhandled
        // rejection にならず、「fetch() は全終了ケースで resolve」契約とも整合する。
        if (!url) {
            // Existing `error` shape is unchanged (§7.2 / 07 §互換性); the taxonomy is
            // projected only through the additive `errorInfo`.
            this._setErrorInfo(WCS_FETCH_ERROR_CODE.InvalidArgument, "start", false, "url attribute is required.");
            this._setError({ message: "url attribute is required." });
            return null;
        }
        // Phase 6 (§7.2): probe required capabilities just before starting. If the
        // `web.fetch` API is absent (SSR / headless / very old runtime), do NOT start
        // the operation — surface a stable `capability-missing` taxonomy without
        // attempting the call (and without the generic network-error path).
        const assessment = this.platformAssessment;
        if (!requiredCapabilitiesAvailable(assessment, FetchCore.REQUIRED_CAPABILITIES)) {
            const missing = FetchCore.REQUIRED_CAPABILITIES.find((id) => assessment.availability.get(id) !== "available");
            this._setErrorInfo(WCS_FETCH_ERROR_CODE.CapabilityMissing, "start", false, `Required capability "${missing}" is unavailable.`, missing);
            this._setError({ message: `Required capability "${missing}" is unavailable.` });
            return null;
        }
        const p = this._doFetch(url, options);
        this._promise = p;
        return p;
    }
    async _doFetch(url, options) {
        // Issue a lane ticket. For the `latest` policy this advances the epoch and
        // aborts the previous in-flight request (supersede), returning a ticket +
        // attempt whose `signal` is the lane-owned AbortController for this operation.
        // `attempt.signal` is undefined when `web.abort-controller` is missing
        // (degraded): the request runs without a native abort signal.
        const started = this._lane.begin();
        // `latest` begin never returns null (exhaust is the only rejecting policy).
        const { ticket, attempt } = started;
        const signal = attempt.signal;
        this._commitStep(ticket, () => this._setLoading(true));
        this._commitStep(ticket, () => { this._commitErrorInfo(null); this._setError(null); });
        const { method = "GET", body = null, contentType = null, forceText = false, responseType = "auto", timeout = 0, } = options;
        // Timeout terminal (§5.1 / §7): a timer claims the `timeout` outcome via the
        // same terminal CAS as success/error, commits a guarded TimeoutError, THEN
        // aborts the native request and releases the lane — never "invalidate first".
        // A completion that arrives after the timer loses the CAS and writes nothing.
        let timeoutTimer = null;
        if (timeout > 0) {
            timeoutTimer = setTimeout(() => {
                if (!this._lane.claimTerminal(ticket, "timeout"))
                    return;
                const message = `Request timed out after ${timeout}ms.`;
                this._commitStep(ticket, () => {
                    this._setErrorInfo(WCS_FETCH_ERROR_CODE.Timeout, "execute", true, message);
                    this._setError({ name: "TimeoutError", message });
                });
                this._commitStep(ticket, () => this._setResponse(null, 0));
                this._commitStep(ticket, () => this._setLoading(false));
                this._lane.abort(ticket);
                this._lane.finalize(ticket);
            }, timeout);
        }
        // Copy the caller's headers so the contentType injection below never mutates
        // the object passed in by a headless consumer (the Shell already builds a
        // fresh object, but direct FetchCore users may reuse theirs).
        const headers = { ...(options.headers ?? {}) };
        try {
            if (contentType && !headers["Content-Type"]) {
                headers["Content-Type"] = contentType;
            }
            const requestInit = {
                method,
                headers,
                signal,
            };
            if (method !== "GET" && method !== "HEAD" && body !== null) {
                requestInit.body = body;
            }
            const response = await globalThis.fetch(url, requestInit);
            // Read the body first, then atomically claim the terminal at the commit
            // point. Claiming AFTER the body read closes the stale-write race: a fetch
            // that was superseded (or timed out) during the body read fails the
            // CommitGuard's epoch/CAS check and writes nothing, even if the body still
            // resolved. HEAD carries no body by spec.
            let value = null;
            if (method === "HEAD") {
                // HEAD responses carry no body — reading it would throw a parse error.
            }
            else if (!response.ok) {
                // HTTP error: read the body text for the error envelope. Handled below.
            }
            else if (forceText) {
                // HTML-replace mode (the Shell sets forceText when `target` is present)
                // always reads text and takes priority over responseType.
                value = await response.text();
            }
            else if (responseType === "blob") {
                // Only buffer the Blob here; the managed object URL is created AFTER the
                // terminal claim wins (below). Creating it before the claim would leak a
                // blob: URL when this operation loses the claim (supersede / timeout /
                // dispose during the body read) — it would never reach _setResponse and
                // never be revoked.
                value = await response.blob();
            }
            else if (responseType === "arrayBuffer") {
                value = await response.arrayBuffer();
            }
            else if (responseType === "text") {
                value = await response.text();
            }
            else if (responseType === "json") {
                value = await response.json();
            }
            else {
                // "auto" (default): sniff Content-Type — JSON when it says so, else text.
                const responseContentType = response.headers.get("Content-Type") || "";
                if (responseContentType.includes("application/json")) {
                    value = await response.json();
                }
                else {
                    value = await response.text();
                }
            }
            if (!response.ok) {
                const errorBody = await response.text().catch(() => "");
                const error = { status: response.status, statusText: response.statusText, body: errorBody };
                if (!this._lane.claimTerminal(ticket, "error")) {
                    return null;
                }
                this._commitStep(ticket, () => {
                    this._setErrorInfo(WCS_FETCH_ERROR_CODE.HttpError, "execute", true, `HTTP ${response.status} ${response.statusText}`);
                    this._setError(error);
                });
                // Notify `status` observers on HTTP errors too. The `status` property is
                // surfaced via the `wcs-fetch:response` event (getter reads detail.status),
                // so without dispatching it here a bind() subscriber would never see the
                // error status (404, 500, ...). `value` is reset to null on error.
                this._commitStep(ticket, () => this._setResponse(null, response.status));
                this._commitStep(ticket, () => this._setLoading(false));
                return null;
            }
            if (!this._lane.claimTerminal(ticket, "success")) {
                return null;
            }
            // Create the blob object URL only now that this operation owns the terminal,
            // so a dropped operation never allocates one (leak-free). HEAD/non-blob keep
            // value non-Blob → objectURL stays null.
            const objectURL = value instanceof Blob ? this._createObjectURL(value) : null;
            this._commitStep(ticket, () => this._setResponse(value, response.status, objectURL));
            this._commitStep(ticket, () => this._setLoading(false));
            return this._value;
        }
        catch (e) {
            if (e && e.name === "AbortError") {
                // AbortError with a still-eligible ticket is an explicit user abort() of
                // the current request: claim the `aborted` terminal and clear loading,
                // leaving the in-flight value/status untouched. A superseding fetch or
                // dispose() advanced the epoch / owner generation, so their predecessors
                // fail the claim (return without writing = stale-drop). A timeout already
                // claimed the terminal in its timer, so this branch also no-ops there.
                if (this._lane.claimTerminal(ticket, "aborted")) {
                    this._commitStep(ticket, () => this._setLoading(false));
                }
                return null;
            }
            // Network error. A superseded/disposed request fails the claim and drops.
            if (!this._lane.claimTerminal(ticket, "error")) {
                return null;
            }
            this._commitStep(ticket, () => {
                const message = String(e?.message ?? "Network request failed.");
                this._setErrorInfo(WCS_FETCH_ERROR_CODE.Network, "execute", true, message);
                // Coalesce a falsy rejection (Promise.reject(null)/throw null) to a non-null
                // envelope so the `error` same-value guard (cleared to null at start) cannot
                // suppress a genuine terminal error — keeping `error`/`wcs-fetch:error` in sync
                // with `errorInfo`. Truthy errors (real TypeErrors) pass through unchanged.
                this._setError(e ?? { message });
            });
            // Reset value/status on network errors too, mirroring the HTTP-error path.
            // Without this, a prior successful request's value/status would linger while
            // `error` is non-null. status=0 is the web-platform convention for "no HTTP
            // response" (matches XMLHttpRequest.status on network failure).
            this._commitStep(ticket, () => this._setResponse(null, 0));
            this._commitStep(ticket, () => this._setLoading(false));
            return null;
        }
        finally {
            if (timeoutTimer !== null) {
                clearTimeout(timeoutTimer);
            }
            // Release the operation (identity-safe: keyed by operationId, so a
            // late-settling superseded request never disarms the successor). Idempotent
            // with the timeout timer's own finalize().
            this._lane.finalize(ticket);
        }
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
    const fetchId = triggerElement.getAttribute(config.triggerAttribute);
    if (!fetchId)
        return;
    // Resolve the registered constructor at call time instead of importing Fetch
    // as a value. The value import created a components/Fetch.ts ⇄ autoTrigger.ts
    // cycle (Fetch.connectedCallback() calls registerAutoTrigger()). instanceof
    // against the customElements registry keeps the exact same identity guarantee
    // — only the registered <wcs-fetch> class matches — without the import cycle.
    const FetchCtor = customElements.get(config.tagNames.fetch);
    const el = document.getElementById(fetchId);
    if (!FetchCtor || !(el instanceof FetchCtor))
        return;
    const fetchElement = el;
    // Skip when the target has no url. fetch() is fire-and-forget here (its returned
    // promise is intentionally not awaited), and FetchCore.fetch() rejects synchronously
    // on an empty url. Without this guard that rejection would surface as an unhandled
    // promise rejection. Treat a url-less target as "nothing to do", consistent with the
    // other early returns above.
    if (!fetchElement.url)
        return;
    // Suppress the element's default action so a fetch can fire without navigating.
    // Intentional: do not attach data-fetchtarget to an element whose default action
    // you also want (real <a href> link, form-submit button) — it will be cancelled.
    // See README "Optional DOM Triggering".
    event.preventDefault();
    fetchElement.fetch();
}
function registerAutoTrigger() {
    if (registered)
        return;
    registered = true;
    document.addEventListener("click", handleClick);
}

class Fetch extends HTMLElement {
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...FetchCore.wcBindable,
        properties: [
            ...FetchCore.wcBindable.properties,
            { name: "trigger", event: "wcs-fetch:trigger-changed" },
        ],
        // Shell-level input surface. The Core declares only the portable `url` / `method`;
        // the Shell adds the DOM-driven settable surface. No `attribute` hints are given:
        // these setters already reflect to their attributes themselves, so a binding system
        // that mirrors inputs[].attribute would set the attribute twice. `commands`
        // (fetch / abort) are inherited unchanged from the Core via the spread above.
        inputs: [
            { name: "url" },
            { name: "method" },
            { name: "target" },
            { name: "manual" },
            { name: "body" },
            { name: "responseType" },
            { name: "trigger" },
        ],
    };
    static get observedAttributes() { return ["url"]; }
    _core;
    _body = null;
    _trigger = false;
    _connectedCallbackPromise = Promise.resolve();
    // Auto-fetch coalescing state (see _scheduleAutoFetch).
    _autoPending = false;
    _connectResolve = null;
    _lastFetchedUrl = null;
    _internals = null;
    constructor() {
        super();
        // State reflection is wired BEFORE the Core is constructed (canonical
        // order): a Core that dispatches synchronously from its constructor
        // (e.g. speech's unsupported-changed) would otherwise fire before the
        // listeners exist. FetchCore doesn't do that, so this is equivalent here,
        // but every Shell keeps the same order.
        this._internals = this._initInternals();
        this._wireStates({
            "wcs-fetch:loading-changed": (d) => ({ loading: d === true }),
            "wcs-fetch:error": (d) => ({ error: d != null }),
        });
        this._core = new FetchCore(this);
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
    // Input setters normalize null/undefined to attribute removal instead of
    // letting setAttribute stringify them ("undefined" url would auto-fetch
    // /undefined, "undefined" method is an invalid HTTP method). The binder
    // already skips undefined writes; this guards direct JS assignment too.
    get url() {
        return this.getAttribute("url") || "";
    }
    set url(value) {
        if (value == null) {
            this.removeAttribute("url");
        }
        else {
            this.setAttribute("url", value);
        }
    }
    get method() {
        return (this.getAttribute("method") || "GET").toUpperCase();
    }
    set method(value) {
        if (value == null) {
            this.removeAttribute("method");
        }
        else {
            this.setAttribute("method", value);
        }
    }
    get target() {
        return this.getAttribute("target");
    }
    set target(value) {
        if (value == null) {
            this.removeAttribute("target");
        }
        else {
            this.setAttribute("target", value);
        }
    }
    // Response body interpretation. Backed by the `response-type` attribute so it is
    // settable from HTML, JS, or a binding. An unknown value falls through to the
    // Core's "auto" branch. `target` (HTML-replace mode) overrides this.
    get responseType() {
        return this.getAttribute("response-type") || "auto";
    }
    set responseType(value) {
        if (value == null) {
            this.removeAttribute("response-type");
        }
        else {
            this.setAttribute("response-type", value);
        }
    }
    get value() {
        return this._core.value;
    }
    get loading() {
        return this._core.loading;
    }
    get error() {
        return this._core.error;
    }
    get status() {
        return this._core.status;
    }
    get objectURL() {
        return this._core.objectURL;
    }
    get errorInfo() {
        return this._core.errorInfo;
    }
    get promise() {
        return this._core.promise;
    }
    get connectedCallbackPromise() {
        return this._connectedCallbackPromise;
    }
    get manual() {
        return this.hasAttribute("manual");
    }
    set manual(value) {
        if (value) {
            this.setAttribute("manual", "");
        }
        else {
            this.removeAttribute("manual");
        }
    }
    get body() {
        return this._body;
    }
    set body(value) {
        // Normalize undefined to null: _collectBody treats "!== null" as "body was
        // provided", so a raw undefined would serialize as a JSON request body.
        this._body = value ?? null;
    }
    get trigger() {
        return this._trigger;
    }
    set trigger(value) {
        const v = !!value;
        if (v) {
            // Skip when url is empty. fetch() is fire-and-forget here (its returned
            // promise is intentionally only chained with .finally() to reset the flag,
            // never .catch()'d), and FetchCore.fetch() rejects on an empty url. Without
            // this guard that rejection — re-thrown by .finally() — surfaces as an
            // unhandled promise rejection. Mirrors the url-less guard in autoTrigger.
            //
            // Leave `_trigger` false (do not set it) and emit no event: nothing ran, so
            // surfacing a `wcs-fetch:trigger-changed` "completion" would lie to observers.
            // Keeping the flag false also avoids stalling — once url is provided, writing
            // `true` again is a real false→true transition that triggers the fetch.
            if (!this.url)
                return;
            this._trigger = true;
            this.fetch().finally(() => {
                this._trigger = false;
                this.dispatchEvent(new CustomEvent("wcs-fetch:trigger-changed", {
                    detail: false,
                    bubbles: true,
                }));
            });
        }
    }
    _collectHeaders() {
        const headers = {};
        const headerElements = this.querySelectorAll(config.tagNames.fetchHeader);
        for (const el of headerElements) {
            const name = el.headerName;
            const value = el.headerValue;
            if (name) {
                headers[name] = value;
            }
        }
        return headers;
    }
    // fetch がネイティブに扱える BodyInit か判定する。これらは JSON.stringify せず
    // 素通しし、Content-Type をブラウザに委ねる (FormData の multipart boundary、
    // Blob の type、URLSearchParams の application/x-www-form-urlencoded を自動付与
    // させるため、_collectBody は contentType に null を返す)。ReadableStream は
    // RequestInit.duplex: 'half' を要するため初版では対象外とし、従来どおり扱う。
    _isNativeBodyInit(value) {
        return value instanceof Blob // File は Blob のサブクラス
            || value instanceof FormData
            || value instanceof URLSearchParams
            || value instanceof ArrayBuffer
            || ArrayBuffer.isView(value); // TypedArray / DataView
    }
    _collectBody(bodySnapshot) {
        // JS API経由のbodyが優先
        if (bodySnapshot !== null) {
            // 文字列はそのまま。Content-Type はユーザーのヘッダ指定に委ねる。
            if (typeof bodySnapshot === "string") {
                return { body: bodySnapshot, contentType: null };
            }
            // ネイティブ BodyInit (Blob/File/FormData/URLSearchParams/ArrayBuffer/TypedArray)
            // は素通し。Content-Type はブラウザに委ねるため null を返す。
            if (this._isNativeBodyInit(bodySnapshot)) {
                return { body: bodySnapshot, contentType: null };
            }
            // それ以外のオブジェクトは JSON 化する。
            return { body: JSON.stringify(bodySnapshot), contentType: "application/json" };
        }
        // サブタグからbodyを取得
        const bodyElement = this.querySelector(config.tagNames.fetchBody);
        if (bodyElement) {
            return {
                body: bodyElement.bodyContent || null,
                contentType: bodyElement.contentType,
            };
        }
        return { body: null, contentType: null };
    }
    abort() {
        this._core.abort();
    }
    /**
     * Coalesce auto-fetch requests in the current task into a single microtask.
     *
     * Multiple synchronous input writes in the same tick — e.g. a `...` spread
     * writing `url` before `manual` — collapse into one decision made against the
     * FINAL element state, so the spread application order can no longer trigger a
     * stray fetch. The microtask re-reads `isConnected` / `manual` / `url` at fire
     * time; whatever was written last wins.
     *
     * Only the implicit auto-fetch (url attribute change, connect-time) is routed
     * here. Explicit triggers — the `trigger` setter, the `fetch` command, and
     * autoTrigger (data-fetchtarget clicks) — must fire immediately and stay on
     * their own synchronous paths.
     *
     * The connect-time promise (connectedCallbackPromise) is resolved here in
     * EVERY exit path, including the no-fetch branch, so awaiting it never hangs
     * when the final state turns out to be manual / url-less / disconnected.
     */
    _scheduleAutoFetch() {
        if (this._autoPending) {
            return;
        }
        this._autoPending = true;
        queueMicrotask(() => {
            this._autoPending = false;
            const resolveConnect = this._connectResolve;
            this._connectResolve = null;
            const url = this.url;
            // Same-value guard (Phase 4): skip a redundant auto-fetch for the url we
            // last fetched. A spread re-evaluation rewrites every input each cycle, so
            // the `url` setter calls setAttribute with an unchanged value and fires
            // attributeChangedCallback again; without this guard an unrelated state
            // change would refetch. Auto-path only — explicit fetch()/trigger/command
            // stay unconditional (a manual refresh of the same url must work), and
            // `_lastFetchedUrl` is reset on disconnect so a remount refetches.
            if (this.isConnected && !this.manual && url && url !== this._lastFetchedUrl) {
                // fetch() cannot reject here: FetchCore swallows network/HTTP errors and
                // only rejects on an empty url, which the `url` guard above rules out.
                this.fetch().finally(() => resolveConnect?.());
            }
            else {
                resolveConnect?.();
            }
        });
    }
    async fetch() {
        // Record the url for the auto-fetch same-value guard. Every fetch (explicit
        // included) updates it so a later auto-write of the same url is treated as a
        // no-op rather than a duplicate request.
        this._lastFetchedUrl = this.url;
        const headers = this._collectHeaders();
        // Snapshot and reset `body` synchronously, before any await. The body is a
        // one-shot input; resetting it after the await (when another caller may have
        // already set a new body for the next request) would silently drop that value.
        const bodySnapshot = this._body;
        this._body = null;
        const { body, contentType } = this._collectBody(bodySnapshot);
        // FormData に手動で Content-Type を付けると、ブラウザが付与するはずの multipart
        // boundary が失われてサーバー側でパースできなくなる。ヘッダはユーザー指定を
        // 尊重して素通しするが、この典型的な誤設定は警告する。
        if (body instanceof FormData &&
            Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) {
            console.warn("[@wcstack/fetch] A manual Content-Type header was set alongside a FormData body. " +
                "This drops the multipart boundary the browser adds automatically; remove the " +
                "Content-Type header (e.g. the <wcs-fetch-header>) to fix multipart uploads.");
        }
        const result = await this._core.fetch(this.url, {
            method: this.method,
            headers,
            body,
            contentType,
            forceText: !!this.target,
            responseType: this.responseType,
        });
        // HTML置換モード
        // Security: the response is injected as raw innerHTML without sanitization.
        // This is an opt-in convenience for trusted fragments only; the primary,
        // recommended path is state-driven binding via @wcstack/state. Do not point
        // `target` at an untrusted endpoint (XSS risk). See README "HTML Replace Mode".
        if (this.target && result !== null) {
            const targetElement = document.getElementById(this.target);
            if (targetElement) {
                targetElement.innerHTML = result;
            }
        }
        return result;
    }
    attributeChangedCallback(name, _oldValue, _newValue) {
        // Re-fetch on url changes, but intentionally do NOT update
        // `_connectedCallbackPromise`. Per the wc-bindable connectedCallbackPromise
        // protocol that promise represents the one-shot "connect-time initialization
        // is done" signal; it resolves once and is not re-armed for later url-driven
        // requests. Await `promise` if you need to track a specific re-fetch.
        //
        // Defer the decision to a microtask (see _scheduleAutoFetch) instead of
        // fetching synchronously here: a `...` spread writes `url` before `manual`,
        // so a synchronous fetch would fire before `manual` is applied. The final
        // state (isConnected / manual / url) is re-read at microtask time.
        if (name === "url") {
            this._scheduleAutoFetch();
        }
    }
    connectedCallback() {
        this.style.display = "none";
        if (config.autoTrigger) {
            registerAutoTrigger();
        }
        // Only the initial connect-time fetch is tracked by connectedCallbackPromise.
        // Arm a deferred here when an auto-fetch looks likely; the scheduled
        // microtask resolves it (in every exit path, so awaiting never hangs). The
        // actual fetch decision is re-evaluated at microtask time against the final
        // state, so a spread that sets `manual` after `url` still suppresses it.
        if (!this.manual && this.url) {
            this._connectedCallbackPromise = new Promise((resolve) => {
                this._connectResolve = resolve;
            });
        }
        this._scheduleAutoFetch();
    }
    disconnectedCallback() {
        this.abort();
        // Reset the same-value guard so a remount (reconnect with the same url)
        // refetches rather than being skipped as a duplicate.
        this._lastFetchedUrl = null;
        // Resolve any armed connect-time deferred before detaching. A synchronous
        // remove()→append() before the scheduled microtask fires would otherwise let
        // the second connectedCallback overwrite _connectResolve, orphaning the first
        // deferred and hanging any caller that already awaited connectedCallbackPromise.
        // Disconnection makes connect-time init moot, so resolving (never hanging) is
        // correct; the pending microtask then sees _connectResolve === null and no-ops.
        this._connectResolve?.();
        this._connectResolve = null;
    }
}

class FetchHeader extends HTMLElement {
    connectedCallback() {
        this.style.display = "none";
    }
    get headerName() {
        return this.getAttribute("name") || "";
    }
    get headerValue() {
        return this.getAttribute("value") || "";
    }
}

class FetchBody extends HTMLElement {
    constructor() {
        super();
        // スロットなしのShadow DOMでlight DOM（bodyテキスト）の描画を抑制
        this.attachShadow({ mode: "open" });
    }
    get contentType() {
        return this.getAttribute("type") || "application/json";
    }
    get bodyContent() {
        return this.textContent?.trim() || "";
    }
}

class InfiniteScroll extends HTMLElement {
    static get observedAttributes() {
        return ["target", "root", "root-margin", "threshold", "disabled"];
    }
    _observer = null;
    _done = false;
    get target() {
        return this.getAttribute("target") || "";
    }
    set target(value) {
        this.setAttribute("target", value);
    }
    get root() {
        return this.getAttribute("root");
    }
    set root(value) {
        if (value === null) {
            this.removeAttribute("root");
        }
        else {
            this.setAttribute("root", value);
        }
    }
    get rootMargin() {
        return this.getAttribute("root-margin") || "0px";
    }
    set rootMargin(value) {
        this.setAttribute("root-margin", value);
    }
    get threshold() {
        const value = Number(this.getAttribute("threshold") ?? "0");
        return Number.isFinite(value) ? value : 0;
    }
    set threshold(value) {
        this.setAttribute("threshold", String(value));
    }
    get disabled() {
        return this.hasAttribute("disabled");
    }
    set disabled(value) {
        if (value) {
            this.setAttribute("disabled", "");
        }
        else {
            this.removeAttribute("disabled");
        }
    }
    get once() {
        return this.hasAttribute("once");
    }
    set once(value) {
        if (value) {
            this.setAttribute("once", "");
        }
        else {
            this.removeAttribute("once");
        }
    }
    connectedCallback() {
        this._observe();
    }
    disconnectedCallback() {
        this._disconnectObserver();
    }
    attributeChangedCallback() {
        if (this.isConnected) {
            this._observe();
        }
    }
    _observe() {
        this._disconnectObserver();
        if (this._done || this.disabled || !this.target || typeof IntersectionObserver === "undefined") {
            return;
        }
        this._observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                this._triggerFetch();
            }
        }, {
            root: this._resolveRoot(),
            rootMargin: this.rootMargin,
            threshold: this.threshold,
        });
        this._observer.observe(this);
    }
    _disconnectObserver() {
        if (this._observer) {
            this._observer.disconnect();
            this._observer = null;
        }
    }
    _resolveRoot() {
        if (!this.root)
            return null;
        return document.getElementById(this.root) || null;
    }
    _triggerFetch() {
        const target = document.getElementById(this.target);
        if (!(target instanceof Fetch)) {
            return;
        }
        if (target.loading) {
            return;
        }
        target.trigger = true;
        if (this.once) {
            this._done = true;
            this._disconnectObserver();
        }
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.fetch)) {
        customElements.define(config.tagNames.fetch, Fetch);
    }
    if (!customElements.get(config.tagNames.fetchHeader)) {
        customElements.define(config.tagNames.fetchHeader, FetchHeader);
    }
    if (!customElements.get(config.tagNames.fetchBody)) {
        customElements.define(config.tagNames.fetchBody, FetchBody);
    }
    if (!customElements.get(config.tagNames.infiniteScroll)) {
        customElements.define(config.tagNames.infiniteScroll, InfiniteScroll);
    }
}

function bootstrapFetch(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { FetchCore, WCS_FETCH_ERROR_CODE, Fetch as WcsFetch, InfiniteScroll as WcsInfiniteScroll, bootstrapFetch, getConfig };
//# sourceMappingURL=index.esm.js.map
