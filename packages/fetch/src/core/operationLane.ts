// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /io-core/operation-lane.ts by scripts/sync-io-core.mjs.
// Run `node scripts/sync-io-core.mjs` after editing the source.
// ===========================================================================

/**
 * operationLane.ts
 *
 * Phase 4 (docs/architecture-hardening/09-remediation-design.md §5, §5.1) の
 * OperationTicket / CommitGuard / terminal CAS を型付き実装した lane プリミティブ。
 * docs/async-execution-model.md §5 が既に規範化した排他モード
 * (latest / queue / exhaust / overlap) を、`AbortController` だけでは防げない
 * 「取消不能な Promise・abort と同時に完了した結果の commit」から守るための
 * 実行時ガードとして具体化する。
 *
 * 配置方針 (§5): 本ファイルは /io-core/ の単一正典であり、scripts/sync-io-core.mjs が
 * 各 IO ノードの src/core/ へ生成コピー (AUTO-GENERATED, 編集禁止) を配布する。
 * `protocol/wcBindable.ts` と同じ copy-distribution 方式で、ランタイム依存を導入せず
 * 各パッケージのバンドルへ inline される (zero-runtime-dep / 自己完結 CDN を維持)。
 * 編集はこの正典に対して行い、`node scripts/sync-io-core.mjs` で再配布する。
 *
 * PoC 実装対象は fetch の `latest` policy のみ。queue / exhaust / overlap は
 * 「全 policy の lane unit」(§8 完了条件) として `operationLane.test.ts` が
 * 直接検証する。lane 自体は promise を実行せず、bookkeeping と guard の
 * 状態機械に徹する — 実際の非同期処理は Core が駆動し lane に照合する。
 */

/** §5: 排他モードの語彙。async-execution-model.md §5 の 4 モードに対応 (parallel は予約語・スコープ外)。 */
export type LanePolicy = "latest" | "queue" | "exhaust" | "overlap";

/** §5: 各 operation の一回限りの終端結果。 */
export type TerminalOutcome = "success" | "error" | "timeout" | "aborted" | "stale";

/** §5: 論理操作 1 件の identity。retry は同じ operationId を再利用する。 */
export interface OperationTicket {
  readonly operationId: number;
  /** 発行時に捕捉した I/O Core の observe / reconnect / dispose lifecycle 世代。 */
  readonly ownerGeneration: number;
  readonly laneKey: string;
  readonly policy: LanePolicy;
  /** supersede bookkeeping に使う epoch (latest policy のみ)。 */
  readonly supersedeEpoch?: number;
}

/** §5: operation の 1 回の試行。retry で attempt++ と resource signal だけ差し替える。 */
export interface OperationAttempt {
  readonly operationId: number;
  readonly attempt: number;
  readonly signal?: AbortSignal;
}

/** §6: DevTools 側 channel へ流す trace（fetch では既定 off・zero-cost）。 */
export type OperationTraceEvent =
  | { readonly type: "io:operation-started"; readonly operationId: number; readonly laneKey: string; readonly policy: LanePolicy }
  | { readonly type: "io:operation-retried"; readonly operationId: number; readonly laneKey: string; readonly attempt: number }
  | { readonly type: "io:operation-settled"; readonly operationId: number; readonly laneKey: string; readonly outcome: TerminalOutcome }
  | { readonly type: "io:stale-dropped"; readonly operationId: number; readonly laneKey: string };

export interface OperationLaneOptions {
  /** attempt ごとに AbortController を発行し signal を渡す (fetch/upload 系)。 */
  readonly withSignal?: boolean;
  /**
   * trace subscriber。undefined なら trace record を一切生成しない
   * (§10.3 hook-off zero allocation の gate)。
   */
  readonly trace?: (event: OperationTraceEvent) => void;
}

/** 内部の終端状態。absence = pending。'committing' は multi-setter commit 中の中間状態。 */
type TerminalStatus = "committing" | TerminalOutcome;

/**
 * 1 レーン = 独立した排他単位。Core が 1 つ以上所有する (module singleton にしない —
 * 複数 <wcs-fetch> 間で漏れるため)。
 */
export class OperationLane {
  readonly laneKey: string;
  readonly policy: LanePolicy;

  private _ownerGeneration = 0;
  private _latestEpoch = 0;
  private _nextOperationId = 1;
  // latest / queue / exhaust の単一 active。queue は head を指す。
  private _activeOperationId: number | undefined = undefined;
  // overlap の active set (§5: 内部 bookkeeping のみ・observable 公開はしない)。
  private readonly _activeOperationIds = new Set<number>();
  // queue policy の FIFO。
  private readonly _queue: OperationTicket[] = [];
  private _inFlightCount = 0;
  // opId → 終端状態 (absence = pending)。
  private readonly _terminal = new Map<number, TerminalStatus>();
  // claimTerminal で確定した outcome (finalize が 'committing' を最終値へ移す)。
  private readonly _claimedOutcome = new Map<number, TerminalOutcome>();
  // opId → AbortController (identity は opId が保証。cross-op clobber は構造上起きない)。
  private readonly _controllers = new Map<number, AbortController>();
  // opId → attempt 数。
  private readonly _attempts = new Map<number, number>();
  private readonly _withSignal: boolean;
  private readonly _trace?: (event: OperationTraceEvent) => void;

  constructor(laneKey: string, policy: LanePolicy, options: OperationLaneOptions = {}) {
    this.laneKey = laneKey;
    this.policy = policy;
    this._withSignal = options.withSignal ?? false;
    this._trace = options.trace;
  }

  get ownerGeneration(): number {
    return this._ownerGeneration;
  }

  get inFlightCount(): number {
    return this._inFlightCount;
  }

  get latestEpoch(): number {
    return this._latestEpoch;
  }

  get activeOperationId(): number | undefined {
    return this._activeOperationId;
  }

  /**
   * 新しい要求の到着。arrival policy を適用し ticket + 最初の attempt を発行する。
   * exhaust で実行中の場合だけ null を返す (新要求を ticket 化せず拒否 = 冪等 no-op)。
   */
  begin(): { ticket: OperationTicket; attempt: OperationAttempt } | null {
    let supersedeEpoch: number | undefined;
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
      case "queue":
      case "overlap":
        break;
    }

    const operationId = this._nextOperationId++;
    const ticket: OperationTicket = {
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
  retry(ticket: OperationTicket): OperationAttempt | null {
    if (ticket.ownerGeneration !== this._ownerGeneration) return null;
    if (this._terminal.has(ticket.operationId)) return null;
    const previous = this._attempts.get(ticket.operationId);
    if (previous === undefined) return null;
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
  canCommit(ticket: OperationTicket): boolean {
    if (ticket.ownerGeneration !== this._ownerGeneration) return false;
    const status = this._terminal.get(ticket.operationId);
    // absence = pending / 'committing' = multi-setter commit 中。どちらも settle 前。
    if (status !== undefined && status !== "committing") return false;
    return this._isEligible(ticket);
  }

  /**
   * terminal CAS (§5.1): pending → committing を claim する。勝者だけが true。
   * eligibility / owner gen を満たさない場合も false。claim 後は commit 中となり、
   * canCommit は各 setter の直前で再検査する (setter が同期 supersede しても取りこぼさない)。
   */
  claimTerminal(ticket: OperationTicket, outcome: TerminalOutcome): boolean {
    if (ticket.ownerGeneration !== this._ownerGeneration) return false;
    if (this._terminal.has(ticket.operationId)) return false; // 既に committing / 終端
    if (!this._isEligible(ticket)) return false;
    this._terminal.set(ticket.operationId, "committing");
    this._claimedOutcome.set(ticket.operationId, outcome);
    return true;
  }

  /** claim 済み outcome (timer が claim → catch が読む等)。未 claim なら undefined。 */
  claimedOutcome(ticket: OperationTicket): TerminalOutcome | undefined {
    return this._claimedOutcome.get(ticket.operationId);
  }

  /**
   * operation の後始末。claim 済みなら outcome を確定し、未 claim なら stale-drop。
   * controller を解放し in-flight を減らし、policy の bookkeeping を進める。冪等。
   */
  finalize(ticket: OperationTicket): void {
    const operationId = ticket.operationId;
    const status = this._terminal.get(operationId);
    if (status !== undefined && status !== "committing") {
      // 既に確定済み。冪等に return。
      return;
    }
    let outcome: TerminalOutcome;
    if (status === "committing") {
      outcome = this._claimedOutcome.get(operationId) ?? "stale";
    } else {
      // 一度も claim されなかった (supersede / dispose で eligibility を失った)。
      outcome = "stale";
    }
    this._terminal.set(operationId, outcome);
    this._claimedOutcome.delete(operationId);
    this._releaseController(operationId);
    this._attempts.delete(operationId);
    if (this._inFlightCount > 0) this._inFlightCount -= 1;
    this._advanceBookkeeping(operationId);
    if (this._trace !== undefined) {
      if (outcome === "stale") {
        this._trace({ type: "io:stale-dropped", operationId, laneKey: this.laneKey });
      } else {
        this._trace({ type: "io:operation-settled", operationId, laneKey: this.laneKey, outcome });
      }
    }
  }

  /** operation の signal (resource 解放用)。withSignal でなければ undefined。 */
  signalOf(ticket: OperationTicket): AbortSignal | undefined {
    return this._controllers.get(ticket.operationId)?.signal;
  }

  /** best-effort な resource 中断。正しさは owner gen / eligibility / terminal CAS が担う。 */
  abort(ticket: OperationTicket): void {
    this._abortController(ticket.operationId);
  }

  /**
   * 現在 active な operation を中断する (利用者による明示キャンセル)。epoch は進めない —
   * 中断された operation は eligibility を保ったまま 'aborted' を claim できる
   * (loading をクリアしつつ in-flight 状態を残す)。
   */
  abortActive(): void {
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
  disposeOwner(): void {
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

  private _makeAttempt(operationId: number, attemptNo: number): OperationAttempt {
    let signal: AbortSignal | undefined;
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

  private _isEligible(ticket: OperationTicket): boolean {
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

  private _advanceBookkeeping(operationId: number): void {
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

  private _abortController(operationId: number): void {
    const controller = this._controllers.get(operationId);
    if (controller !== undefined && !controller.signal.aborted) {
      controller.abort();
    }
  }

  private _releaseController(operationId: number): void {
    this._controllers.delete(operationId);
  }
}
