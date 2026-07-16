const _config = {
    autoTrigger: true,
    triggerAttribute: "data-uploadtarget",
    tagNames: {
        upload: "wcs-upload",
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
// `config` は内部用のライブビュー（live view）。setConfig() の更新が即座に反映される
// 実体 `_config` をそのまま公開しており、凍結もクローンもしていない。autoTrigger /
// components など同パッケージ内のモジュールが最新値を読むための窓口であり、
// 「変更不可なスナップショット」が必要な外部利用には getConfig()（凍結クローンを返す）
// を使うこと。型が readonly なのは内部からの誤書き換えを抑止するための表明にすぎない。
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
 * uploadCapabilities.ts
 *
 * Upload node 固有の capability registry と error code。汎用の assess 機構・型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。node 固有の宣言はこのハンドライトファイルに置き、生成コピーとは分離する。
 */
/** 安定した upload error code(taxonomy)。値は公開キーとして固定。 */
const WCS_UPLOAD_ERROR_CODE = {
    CapabilityMissing: "capability-missing",
    InvalidArgument: "invalid-argument",
    Network: "network",
    HttpError: "http-error",
};
/**
 * upload node の capability registry。`XMLHttpRequest`(progress 取得のため fetch では
 * なく XHR を用いる)の presence を probe する。
 */
const UPLOAD_CAPABILITIES = new Map([
    ["web.xhr", { probe: () => typeof globalThis.XMLHttpRequest === "function", compatKey: "api.XMLHttpRequest" }],
]);

class UploadCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "value", event: "wcs-upload:response", getter: (e) => e.detail.value },
            { name: "loading", event: "wcs-upload:loading-changed" },
            { name: "progress", event: "wcs-upload:progress" },
            { name: "error", event: "wcs-upload:error" },
            { name: "status", event: "wcs-upload:response", getter: (e) => e.detail.status },
            // Serializable failure taxonomy (stable code / phase / recoverable), or null.
            // Additive bindable output; the existing `error` property/event are unchanged.
            // Fires its own `wcs-upload:error-info-changed` event; no getter, so the bound
            // value is the event detail (mirrors `error` / `loading`). An abort() is not a
            // failure — it clears loading without setting error/errorInfo.
            { name: "errorInfo", event: "wcs-upload:error-info-changed" },
        ],
        inputs: [
            { name: "url" },
            { name: "method" },
            { name: "fieldName" },
        ],
        commands: [
            { name: "upload", async: true },
            { name: "abort" },
        ],
    };
    // Required capability (probed at call time, never at module eval).
    static REQUIRED_CAPABILITIES = ["web.xhr"];
    _target;
    _value = null;
    _loading = false;
    _progress = 0;
    _error = null;
    _status = 0;
    _errorInfo = null;
    _xhr = null;
    _promise = Promise.resolve(null);
    // Concurrency lane (io-core). `latest`: a new upload supersedes the in-flight one
    // (switchMap). `withSignal: false`: upload uses XMLHttpRequest.abort() rather than
    // an AbortSignal, so the lane owns epoch / commit-guard while abort() below owns
    // the XHR cancellation. dispose() bumps the owner generation and aborts the XHR.
    _lane = new OperationLane("upload", "latest", { withSignal: false });
    // SSR: no asynchronous probe to await, so readiness is immediate.
    _ready = Promise.resolve();
    constructor(target) {
        super();
        this._target = target ?? this;
    }
    get ready() {
        return this._ready;
    }
    // Lifecycle (§3.5). Upload is command-driven with no subscription to establish,
    // so observe() is an idempotent no-op that resolves once ready; dispose() bumps
    // the lane's owner generation (invalidating any in-flight upload) and aborts the
    // XHR.
    observe() {
        return this._ready;
    }
    dispose() {
        this._lane.disposeOwner();
        this.abort();
    }
    get value() {
        return this._value;
    }
    get loading() {
        return this._loading;
    }
    get progress() {
        return this._progress;
    }
    get error() {
        return this._error;
    }
    get status() {
        return this._status;
    }
    get promise() {
        return this._promise;
    }
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable` / `capabilityId`), or null. Exposed as an additive wc-bindable
     * property (event `wcs-upload:error-info-changed`); the existing `error`
     * property/event are unchanged. An abort() is not a failure (no errorInfo).
     */
    get errorInfo() {
        return this._errorInfo;
    }
    /**
     * Whether the required platform capability (`web.xhr`) is available right now —
     * decided by call-time feature detection, not User-Agent. Core-only, additive.
     */
    get supported() {
        return requiredCapabilitiesAvailable(this.platformAssessment, UploadCore.REQUIRED_CAPABILITIES);
    }
    /**
     * Full platform assessment (availability / readiness / preconditions), probed at
     * call time. Core-only opt-in dev / sidecar view.
     */
    get platformAssessment() {
        return assessCapabilities(UPLOAD_CAPABILITIES, {
            required: UploadCore.REQUIRED_CAPABILITIES,
            activity: this._loading ? "active" : "inactive",
            lastError: this._errorInfo ?? undefined,
        });
    }
    // CommitGuard (§5.1): external setters / event dispatch only run if the ticket
    // still holds owner generation, is pre-terminal, and is the lane's latest epoch
    // (a superseding upload can invalidate a ticket mid-commit).
    _commitStep(ticket, step) {
        if (this._lane.canCommit(ticket)) {
            step();
        }
    }
    // --- State setters with event dispatch ---
    _setLoading(loading) {
        this._loading = loading;
        this._target.dispatchEvent(new CustomEvent("wcs-upload:loading-changed", {
            detail: loading,
            bubbles: true,
        }));
    }
    _setProgress(progress) {
        this._progress = progress;
        this._target.dispatchEvent(new CustomEvent("wcs-upload:progress", {
            detail: progress,
            bubbles: true,
        }));
    }
    _setError(error) {
        // Same-value guard (async-io-node-guidelines.md §3.3). `error` is state-ish,
        // so suppressing redundant null→null dispatches (every upload start clears a
        // usually-already-null error) avoids a spurious wcs-upload:error per
        // successful upload. Reference identity is sufficient: each failure builds a
        // fresh object, and the clear path always passes null.
        if (this._error === error)
            return;
        this._error = error;
        this._target.dispatchEvent(new CustomEvent("wcs-upload:error", {
            detail: error,
            bubbles: true,
        }));
    }
    // Surface a Shell-originated error (e.g. maxSize / accept validation, which the
    // Core has no knowledge of) on the shared `error` property so `el.error` stays
    // sticky and consistent with Core-originated errors — same error contract as the
    // rest of the @wcstack IO nodes. A later successful upload() clears it via
    // _setError(null). Dispatches wcs-upload:error like any other error transition.
    setError(error) {
        this._setError(error);
    }
    _setResponse(value, status) {
        this._value = value;
        this._status = status;
        this._target.dispatchEvent(new CustomEvent("wcs-upload:response", {
            detail: { value, status },
            bubbles: true,
        }));
    }
    // Single mutation point for `errorInfo`, mirroring `_setError`'s same-value guard
    // and event dispatch so the additive `errorInfo` wc-bindable property stays in
    // sync with `error`. Each failure builds a fresh object (reference guard passes);
    // the clear path passes null (suppresses a redundant null→null per upload start).
    _setErrorInfo(code, phase, recoverable, message, capabilityId) {
        this._commitErrorInfo({ code, phase, recoverable, message, ...(capabilityId === undefined ? {} : { capabilityId }) });
    }
    _commitErrorInfo(info) {
        if (this._errorInfo === info)
            return;
        this._errorInfo = info;
        this._target.dispatchEvent(new CustomEvent("wcs-upload:error-info-changed", {
            detail: info,
            bubbles: true,
        }));
    }
    // --- Public API ---
    abort() {
        // Abort the current XHR. Its `abort` event handler claims the `aborted` terminal
        // (while the ticket is still latest — abort() runs before a superseding upload's
        // begin()), unifying the loading-release path with success/error/network. When a
        // superseding upload or dispose() has already advanced the epoch/owner gen, the
        // handler's claim fails and it writes nothing (stale-drop).
        if (this._xhr) {
            this._xhr.abort();
            this._xhr = null;
        }
    }
    async upload(url, files, options = {}) {
        // never-throw: 引数バリデーション失敗は例外ではなく error プロパティに流し、
        // サニタイズ値(null)を返す。command-token 経路からの呼び出しが unhandled
        // rejection にならず、「upload() は全終了ケースで resolve」契約とも整合する。
        if (!url) {
            this._setErrorInfo(WCS_UPLOAD_ERROR_CODE.InvalidArgument, "start", false, "url is required.");
            this._setError({ message: "url is required." });
            return null;
        }
        if (!files || files.length === 0) {
            this._setErrorInfo(WCS_UPLOAD_ERROR_CODE.InvalidArgument, "start", false, "files are required.");
            this._setError({ message: "files are required." });
            return null;
        }
        const p = this._doUpload(url, files, options);
        this._promise = p;
        return p;
    }
    // --- Internal ---
    _doUpload(url, files, options) {
        // Probe the required capability just before starting (SSR / very old runtime).
        const assessment = this.platformAssessment;
        if (!requiredCapabilitiesAvailable(assessment, UploadCore.REQUIRED_CAPABILITIES)) {
            const missing = UploadCore.REQUIRED_CAPABILITIES.find((id) => assessment.availability.get(id) !== "available");
            const message = `Required capability "${missing}" is unavailable.`;
            this._setErrorInfo(WCS_UPLOAD_ERROR_CODE.CapabilityMissing, "start", false, message, missing);
            this._setError({ message });
            return Promise.resolve(null);
        }
        // Abort the previous XHR BEFORE advancing the epoch, so its `abort` handler
        // claims `aborted` while still latest (preserving the loading true→false→true
        // supersede sequence). Then begin() advances the epoch for THIS upload.
        this.abort();
        const started = this._lane.begin(); // `latest` begin never returns null
        const { ticket } = started;
        this._commitStep(ticket, () => this._setLoading(true));
        this._commitStep(ticket, () => {
            this._setProgress(0);
            this._commitErrorInfo(null);
            this._setError(null);
        });
        const { method = "POST", headers = {}, fieldName = "file", } = options;
        const formData = new FormData();
        for (let i = 0; i < files.length; i++) {
            formData.append(fieldName, files[i]);
        }
        return new Promise((resolve) => {
            const xhr = new XMLHttpRequest();
            this._xhr = xhr;
            xhr.upload.addEventListener("progress", (event) => {
                // Guarded: a superseded / disposed upload's late progress writes nothing.
                this._commitStep(ticket, () => {
                    if (event.lengthComputable) {
                        this._setProgress(Math.round((event.loaded / event.total) * 100));
                    }
                });
            });
            xhr.addEventListener("load", () => {
                this._xhr = null;
                if (xhr.status >= 200 && xhr.status < 300) {
                    if (!this._lane.claimTerminal(ticket, "success")) {
                        resolve(null);
                        this._lane.finalize(ticket);
                        return;
                    }
                    let value = xhr.responseText;
                    const contentType = xhr.getResponseHeader("Content-Type") || "";
                    if (contentType.includes("application/json")) {
                        try {
                            value = JSON.parse(xhr.responseText);
                        }
                        catch { /* テキストのまま */ }
                    }
                    this._commitStep(ticket, () => this._setProgress(100));
                    this._commitStep(ticket, () => this._setResponse(value, xhr.status));
                    this._commitStep(ticket, () => this._setLoading(false));
                    this._lane.finalize(ticket);
                    resolve(value);
                }
                else {
                    if (!this._lane.claimTerminal(ticket, "error")) {
                        resolve(null);
                        this._lane.finalize(ticket);
                        return;
                    }
                    const error = { status: xhr.status, statusText: xhr.statusText, body: xhr.responseText };
                    this._commitStep(ticket, () => {
                        this._status = xhr.status; // HTTP error keeps status (no wcs-upload:response — value not reset)
                        this._setErrorInfo(WCS_UPLOAD_ERROR_CODE.HttpError, "execute", true, `HTTP ${xhr.status} ${xhr.statusText}`);
                        this._setError(error);
                    });
                    this._commitStep(ticket, () => this._setLoading(false));
                    this._lane.finalize(ticket);
                    resolve(null);
                }
            });
            xhr.addEventListener("error", () => {
                this._xhr = null;
                if (!this._lane.claimTerminal(ticket, "error")) {
                    resolve(null);
                    this._lane.finalize(ticket);
                    return;
                }
                const message = "Network error";
                this._commitStep(ticket, () => {
                    this._setErrorInfo(WCS_UPLOAD_ERROR_CODE.Network, "execute", true, message);
                    this._setError({ message });
                });
                this._commitStep(ticket, () => this._setLoading(false));
                this._lane.finalize(ticket);
                resolve(null);
            });
            xhr.addEventListener("abort", () => {
                this._xhr = null;
                // abort is a routine cancellation, not a failure: claim the `aborted`
                // terminal and clear loading only (no error/errorInfo). A superseded /
                // disposed ticket fails the claim and drops.
                if (this._lane.claimTerminal(ticket, "aborted")) {
                    this._commitStep(ticket, () => this._setLoading(false));
                }
                this._lane.finalize(ticket);
                resolve(null);
            });
            xhr.open(method, url);
            for (const [name, value] of Object.entries(headers)) {
                xhr.setRequestHeader(name, value);
            }
            xhr.send(formData);
        });
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
    const uploadId = triggerElement.getAttribute(config.triggerAttribute);
    if (!uploadId)
        return;
    // Resolve the registered constructor at call time instead of importing WcsUpload
    // as a value. The value import created a components/Upload.ts ⇄ autoTrigger.ts
    // cycle (WcsUpload.connectedCallback() calls registerAutoTrigger()). instanceof
    // against the customElements registry keeps the exact same identity guarantee
    // — only the registered <wcs-upload> class matches — without the import cycle.
    const UploadCtor = customElements.get(config.tagNames.upload);
    const el = document.getElementById(uploadId);
    if (!UploadCtor || !(el instanceof UploadCtor))
        return;
    const uploadElement = el;
    // ファイルと URL が揃っている場合のみ既定動作を抑止
    if (uploadElement.files && uploadElement.files.length > 0 && uploadElement.url) {
        event.preventDefault();
    }
    uploadElement.upload();
}
function registerAutoTrigger() {
    if (registered)
        return;
    registered = true;
    document.addEventListener("click", handleClick);
}

class WcsUpload extends HTMLElement {
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...UploadCore.wcBindable,
        properties: [
            ...UploadCore.wcBindable.properties,
            { name: "trigger", event: "wcs-upload:trigger-changed" },
            { name: "files", event: "wcs-upload:files-changed" },
        ],
        // Shell-level input surface. The Core declares only the portable `url` / `method` /
        // `fieldName`; the Shell adds the DOM-driven settable surface. No `attribute` hints
        // are given: the `url` / `method` / `fieldName` / `multiple` / `maxSize` / `accept` /
        // `manual` setters already reflect to their attributes, so a binding system that
        // mirrors inputs[].attribute would set the attribute twice (`files` / `trigger` are
        // not attribute-backed). `commands` (upload / abort) are inherited unchanged from the
        // Core via the spread above.
        inputs: [
            { name: "url" },
            { name: "method" },
            { name: "fieldName" },
            { name: "multiple" },
            { name: "maxSize" },
            { name: "accept" },
            { name: "manual" },
            { name: "files" },
            { name: "trigger" },
        ],
    };
    // `url` を観測するのは FetchCore のシェルと構造を揃えるためだが、upload は
    // url 変更だけでは送信できない（files が必須）。そのため attributeChangedCallback は
    // 意図的に何もしない。url 変更で自動送信しないことは仕様であり、テストで担保している。
    static get observedAttributes() { return ["url"]; }
    _core;
    _files = null;
    _trigger = false;
    _connectedCallbackPromise = Promise.resolve();
    _internals = null;
    constructor() {
        super();
        this._core = new UploadCore(this);
        this._internals = this._initInternals();
        this._wireStates({
            "wcs-upload:loading-changed": (d) => ({ loading: d === true }),
            "wcs-upload:error": (d) => ({ error: d != null }),
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
    get connectedCallbackPromise() {
        return this._connectedCallbackPromise;
    }
    // --- Attribute accessors ---
    get url() {
        return this.getAttribute("url") || "";
    }
    set url(value) {
        this.setAttribute("url", value);
    }
    get method() {
        return (this.getAttribute("method") || "POST").toUpperCase();
    }
    set method(value) {
        this.setAttribute("method", value);
    }
    get fieldName() {
        return this.getAttribute("field-name") || "file";
    }
    set fieldName(value) {
        this.setAttribute("field-name", value);
    }
    get multiple() {
        return this.hasAttribute("multiple");
    }
    set multiple(value) {
        if (value) {
            this.setAttribute("multiple", "");
        }
        else {
            this.removeAttribute("multiple");
        }
    }
    get maxSize() {
        const attr = this.getAttribute("max-size");
        if (attr === null) {
            return Infinity;
        }
        // 不正値（NaN になる "abc" など）や負数は「制限なし」(Infinity) として扱う。
        // NaN を返すと `size > NaN` が常に false になりサイズ検証が無言で無効化され、
        // 負数を返すと全ファイルが拒否されるため、いずれも安全側の Infinity に丸める。
        const n = parseInt(attr, 10);
        return Number.isFinite(n) && n >= 0 ? n : Infinity;
    }
    set maxSize(value) {
        this.setAttribute("max-size", String(value));
    }
    get accept() {
        return this.getAttribute("accept") || "";
    }
    set accept(value) {
        this.setAttribute("accept", value);
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
    // --- Core delegated getters ---
    get value() {
        return this._core.value;
    }
    get loading() {
        return this._core.loading;
    }
    get progress() {
        return this._core.progress;
    }
    get error() {
        return this._core.error;
    }
    get status() {
        return this._core.status;
    }
    get errorInfo() {
        return this._core.errorInfo;
    }
    get promise() {
        return this._core.promise;
    }
    // --- Command properties ---
    get trigger() {
        return this._trigger;
    }
    set trigger(value) {
        // 進行中に再度 trigger=true が来ても再入ガードはしない（FetchCore シェルと同一）。
        // upload() → _core.upload() が先頭で既存リクエストを abort し新規開始するため、
        // 連続トリガは「前回を中止して新しいアップロードを開始する」挙動になる。
        // 各 upload() の settle ごとに trigger-changed(false) が 1 回発火する。
        const v = !!value;
        if (v) {
            this._trigger = true;
            this.upload().finally(() => {
                this._trigger = false;
                this.dispatchEvent(new CustomEvent("wcs-upload:trigger-changed", {
                    detail: false,
                    bubbles: true,
                }));
            });
        }
    }
    get files() {
        return this._files;
    }
    set files(value) {
        this._files = value;
        this.dispatchEvent(new CustomEvent("wcs-upload:files-changed", {
            detail: value,
            bubbles: true,
        }));
        if (!this.manual && this.url && value && value.length > 0) {
            this.upload();
        }
    }
    // --- Validation ---
    _validate(files) {
        const maxSize = this.maxSize;
        if (maxSize !== Infinity) {
            for (let i = 0; i < files.length; i++) {
                if (files[i].size > maxSize) {
                    return { message: `File "${files[i].name}" exceeds maximum size of ${maxSize} bytes.` };
                }
            }
        }
        const accept = this.accept;
        if (accept) {
            const acceptList = accept.split(",").map(s => s.trim().toLowerCase());
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const fileType = file.type.toLowerCase();
                const fileName = file.name.toLowerCase();
                // file.type が空文字（OS が MIME を判定できないファイル）の場合、MIME 系
                // パターン（`image/*` / 厳密 MIME）は一致しない。その場合でも accept に
                // 拡張子パターン（`.pdf` 等）が含まれ拡張子が一致すれば受理される。
                // accept が MIME 系のみのときは型を確認できないため拒否する（安全側）。
                const matched = acceptList.some(pattern => {
                    if (pattern.startsWith(".")) {
                        return fileName.endsWith(pattern);
                    }
                    if (pattern.endsWith("/*")) {
                        return fileType !== "" && fileType.startsWith(pattern.slice(0, -1));
                    }
                    return fileType !== "" && fileType === pattern;
                });
                if (!matched) {
                    return { message: `File "${file.name}" does not match accepted types: ${accept}` };
                }
            }
        }
        return null;
    }
    // --- Public methods ---
    abort() {
        this._core.abort();
    }
    async upload() {
        const files = this._files;
        // url 未設定は no-op(null)。Core は never-throw（url 空なら error プロパティに
        // 載せて null を返す）だが、Shell は url/files のライフサイクルを所有しており
        // 「送信先が無い」を「ファイル無し」と同じ無操作として扱い、Core を呼ぶ前に return する。
        // これにより set trigger / set files の fire-and-forget 経路で unhandled rejection が
        // 発生せず、README の「upload() は全終了ケースで resolve し never reject」契約とも整合する。
        if (!files || files.length === 0 || !this.url) {
            return null;
        }
        const validationError = this._validate(files);
        if (validationError) {
            // Route through the Core so `el.error` (which reads _core.error) reflects
            // the validation failure and stays sticky until the next successful upload,
            // matching the family-wide error contract. The Core dispatches
            // wcs-upload:error on this element (its _target), so the observable event is
            // unchanged.
            this._core.setError(validationError);
            return null;
        }
        const result = await this._core.upload(this.url, files, {
            method: this.method,
            fieldName: this.fieldName,
        });
        // 自分が開始したアップロードのファイルだけをリセット
        // （途中で新しい files がセットされていたら触らない）
        if (this._files === files) {
            this._files = null;
            this.dispatchEvent(new CustomEvent("wcs-upload:files-changed", {
                detail: null,
                bubbles: true,
            }));
        }
        return result;
    }
    // --- Lifecycle ---
    attributeChangedCallback(_name, _oldValue, _newValue) {
        // 意図的に空。url 変更ではアップロードを自動実行しない（files が必要なため）。
        // observedAttributes のコメント参照。
    }
    connectedCallback() {
        this.style.display = "none";
        if (config.autoTrigger) {
            registerAutoTrigger();
        }
        this._connectedCallbackPromise = this._core.observe();
    }
    disconnectedCallback() {
        this._core.dispose();
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.upload)) {
        customElements.define(config.tagNames.upload, WcsUpload);
    }
}

function bootstrapUpload(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { UploadCore, WCS_UPLOAD_ERROR_CODE, WcsUpload, bootstrapUpload, getConfig };
//# sourceMappingURL=index.esm.js.map
