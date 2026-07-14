import { describe, it, expect, vi } from "vitest";
import {
  OperationLane,
  type LanePolicy,
  type OperationTraceEvent,
} from "../src/core/operationLane";

/**
 * 全 policy の lane unit (09-remediation-design.md §8 phase4 完了条件)。
 * lane は promise を実行せず bookkeeping と guard の状態機械に徹するため、
 * ここでは ticket 発行・eligibility・terminal CAS・finalize の状態遷移を
 * 同期的に駆動して検証する (§10 検証設計: wall-clock sleep を使わない)。
 */

function begin(lane: OperationLane) {
  const started = lane.begin();
  if (started === null) throw new Error("begin returned null unexpectedly");
  return started;
}

describe("OperationLane — latest policy", () => {
  it("新しい begin が epoch を進め、旧 active を stale にする（switchMap）", () => {
    const lane = new OperationLane("fetch", "latest");
    const first = begin(lane);
    expect(lane.canCommit(first.ticket)).toBe(true);
    expect(lane.latestEpoch).toBe(1);

    const second = begin(lane);
    expect(lane.latestEpoch).toBe(2);
    // 旧 operation は eligibility を失う（最新 epoch でない）
    expect(lane.canCommit(first.ticket)).toBe(false);
    // 新 operation だけが commit 可能
    expect(lane.canCommit(second.ticket)).toBe(true);
  });

  it("supersede された operation は terminal を claim できず stale-drop になる", () => {
    const events: OperationTraceEvent[] = [];
    const lane = new OperationLane("fetch", "latest", { trace: (e) => events.push(e) });
    const first = begin(lane);
    const second = begin(lane);

    // 旧 operation は success を claim できない（eligibility 不一致）
    expect(lane.claimTerminal(first.ticket, "success")).toBe(false);
    lane.finalize(first.ticket);
    // 新 operation は success を claim できる
    expect(lane.claimTerminal(second.ticket, "success")).toBe(true);
    lane.finalize(second.ticket);

    expect(events).toEqual([
      { type: "io:operation-started", operationId: 1, laneKey: "fetch", policy: "latest" },
      { type: "io:operation-started", operationId: 2, laneKey: "fetch", policy: "latest" },
      { type: "io:stale-dropped", operationId: 1, laneKey: "fetch" },
      { type: "io:operation-settled", operationId: 2, laneKey: "fetch", outcome: "success" },
    ]);
  });

  it("withSignal は attempt ごとに AbortController を発行し supersede で abort する", () => {
    const lane = new OperationLane("fetch", "latest", { withSignal: true });
    const first = begin(lane);
    expect(first.attempt.signal).toBeInstanceOf(AbortSignal);
    expect(first.attempt.signal!.aborted).toBe(false);
    expect(lane.signalOf(first.ticket)).toBe(first.attempt.signal);

    const second = begin(lane);
    // 旧 controller が abort される（best-effort 中断）
    expect(first.attempt.signal!.aborted).toBe(true);
    expect(second.attempt.signal!.aborted).toBe(false);
  });

  it("abortActive は epoch を進めず、active operation を abort する（明示キャンセル）", () => {
    const lane = new OperationLane("fetch", "latest", { withSignal: true });
    const op = begin(lane);
    lane.abortActive();
    expect(op.attempt.signal!.aborted).toBe(true);
    // epoch は不変 → まだ eligibility を保つ → aborted を claim できる
    expect(lane.latestEpoch).toBe(1);
    expect(lane.claimTerminal(op.ticket, "aborted")).toBe(true);
  });

  it("abortActive は active が無ければ no-op", () => {
    const lane = new OperationLane("fetch", "latest", { withSignal: true });
    expect(() => lane.abortActive()).not.toThrow();
    const op = begin(lane);
    lane.finalize(op.ticket);
    expect(() => lane.abortActive()).not.toThrow();
  });
});

describe("OperationLane — terminal CAS & CommitGuard", () => {
  it("terminal は一回限り: 先着が committing を claim し後着は弾かれる", () => {
    const lane = new OperationLane("fetch", "latest");
    const op = begin(lane);
    expect(lane.claimTerminal(op.ticket, "success")).toBe(true);
    // 二度目（timeout 後成功 / 追い越し）は弾かれる
    expect(lane.claimTerminal(op.ticket, "timeout")).toBe(false);
    expect(lane.claimTerminal(op.ticket, "error")).toBe(false);
    expect(lane.claimedOutcome(op.ticket)).toBe("success");
  });

  it("claim 済みでも committing 中は canCommit が true（multi-setter commit を許す）", () => {
    const lane = new OperationLane("fetch", "latest");
    const op = begin(lane);
    lane.claimTerminal(op.ticket, "error");
    // committing 中は複数 setter を通せる
    expect(lane.canCommit(op.ticket)).toBe(true);
    lane.finalize(op.ticket);
    // finalize 後は terminal settle 済み → canCommit false
    expect(lane.canCommit(op.ticket)).toBe(false);
  });

  it("commit 権のない ticket は canCommit / claimTerminal とも false（abort 無視）", () => {
    const lane = new OperationLane("fetch", "latest");
    const first = begin(lane);
    begin(lane); // supersede first
    expect(lane.canCommit(first.ticket)).toBe(false);
    expect(lane.claimTerminal(first.ticket, "success")).toBe(false);
  });

  it("owner generation 不一致（dispose 後）は commit 不可", () => {
    const lane = new OperationLane("fetch", "latest");
    const op = begin(lane);
    lane.disposeOwner();
    expect(lane.canCommit(op.ticket)).toBe(false);
    expect(lane.claimTerminal(op.ticket, "success")).toBe(false);
  });

  it("finalize は冪等（二度目は状態を変えない）", () => {
    const lane = new OperationLane("fetch", "latest");
    const op = begin(lane);
    lane.claimTerminal(op.ticket, "success");
    lane.finalize(op.ticket);
    expect(lane.inFlightCount).toBe(0);
    lane.finalize(op.ticket); // 冪等
    expect(lane.inFlightCount).toBe(0);
  });

  it("claim せず finalize すると stale として確定する", () => {
    const events: OperationTraceEvent[] = [];
    const lane = new OperationLane("fetch", "latest", { trace: (e) => events.push(e) });
    const op = begin(lane);
    lane.finalize(op.ticket);
    expect(events.at(-1)).toEqual({ type: "io:stale-dropped", operationId: 1, laneKey: "fetch" });
  });
});

describe("OperationLane — queue policy", () => {
  it("FIFO で先頭だけ active・commit 可能、finalize で次が昇格する", () => {
    const lane = new OperationLane("speak", "queue");
    const a = begin(lane);
    const b = begin(lane);
    const c = begin(lane);
    expect(lane.activeOperationId).toBe(a.ticket.operationId);
    expect(lane.canCommit(a.ticket)).toBe(true);
    expect(lane.canCommit(b.ticket)).toBe(false);
    expect(lane.canCommit(c.ticket)).toBe(false);

    lane.claimTerminal(a.ticket, "success");
    lane.finalize(a.ticket);
    // 次の ticket が昇格
    expect(lane.activeOperationId).toBe(b.ticket.operationId);
    expect(lane.canCommit(b.ticket)).toBe(true);

    lane.claimTerminal(b.ticket, "success");
    lane.finalize(b.ticket);
    lane.claimTerminal(c.ticket, "success");
    lane.finalize(c.ticket);
    expect(lane.activeOperationId).toBeUndefined();
    expect(lane.inFlightCount).toBe(0);
  });
});

describe("OperationLane — exhaust policy", () => {
  it("実行中は新要求を拒否し（begin=null）、唯一の active だけ commit 可能", () => {
    const lane = new OperationLane("timer", "exhaust");
    const a = begin(lane);
    expect(lane.canCommit(a.ticket)).toBe(true);
    // 実行中は begin が null（冪等 no-op）
    expect(lane.begin()).toBeNull();

    lane.claimTerminal(a.ticket, "success");
    lane.finalize(a.ticket);
    // active が空いたので次の begin は成功
    const b = begin(lane);
    expect(lane.canCommit(b.ticket)).toBe(true);
  });
});

describe("OperationLane — overlap policy", () => {
  it("複数 in-flight を許容し、各 operation が commit 可能（個別 observable は公開しない）", () => {
    const lane = new OperationLane("share", "overlap");
    const a = begin(lane);
    const b = begin(lane);
    expect(lane.inFlightCount).toBe(2);
    // active set 内の各 operation が commit 可能（後着勝ちの上書きは Core 側の責務）
    expect(lane.canCommit(a.ticket)).toBe(true);
    expect(lane.canCommit(b.ticket)).toBe(true);

    lane.claimTerminal(a.ticket, "success");
    lane.finalize(a.ticket);
    expect(lane.inFlightCount).toBe(1);
    // a を抜いても b は依然 commit 可能
    expect(lane.canCommit(b.ticket)).toBe(true);
    lane.claimTerminal(b.ticket, "success");
    lane.finalize(b.ticket);
    expect(lane.inFlightCount).toBe(0);
  });

  it("abortActive は overlap の active set 全体を abort する", () => {
    const lane = new OperationLane("share", "overlap", { withSignal: true });
    const a = begin(lane);
    const b = begin(lane);
    lane.abortActive();
    expect(a.attempt.signal!.aborted).toBe(true);
    expect(b.attempt.signal!.aborted).toBe(true);
  });
});

describe("OperationLane — retry", () => {
  it("retry は同じ operationId で attempt++ と新しい signal を作る", () => {
    const events: OperationTraceEvent[] = [];
    const lane = new OperationLane("fetch", "latest", { withSignal: true, trace: (e) => events.push(e) });
    const op = begin(lane);
    const firstSignal = op.attempt.signal;

    const retried = lane.retry(op.ticket)!;
    expect(retried.operationId).toBe(op.ticket.operationId);
    expect(retried.attempt).toBe(2);
    expect(retried.signal).not.toBe(firstSignal);
    expect(retried.signal!.aborted).toBe(false);
    // operationId は不変なので eligibility も保つ
    expect(lane.canCommit(op.ticket)).toBe(true);
    expect(events.at(-1)).toEqual({ type: "io:operation-retried", operationId: 1, laneKey: "fetch", attempt: 2 });
  });

  it("trace 未設定でも retry は attempt++ と新 signal を作る（trace 無し分岐）", () => {
    const lane = new OperationLane("fetch", "latest", { withSignal: true });
    const op = begin(lane);
    const retried = lane.retry(op.ticket)!;
    expect(retried.attempt).toBe(2);
    expect(retried.signal).not.toBe(op.attempt.signal);
  });

  it("終端済み / owner 不一致 / 未知の operation には retry できない", () => {
    const lane = new OperationLane("fetch", "latest");
    const op = begin(lane);
    lane.claimTerminal(op.ticket, "success");
    lane.finalize(op.ticket);
    expect(lane.retry(op.ticket)).toBeNull();

    const lane2 = new OperationLane("fetch", "latest");
    const op2 = lane2.begin()!;
    lane2.disposeOwner();
    expect(lane2.retry(op2.ticket)).toBeNull();

    // 別 lane の ticket（未知 operationId）
    const fresh = new OperationLane("fetch", "latest");
    expect(fresh.retry(op.ticket)).toBeNull();
  });
});

describe("OperationLane — disposeOwner", () => {
  it("owner 世代を進めて全 in-flight を stale として解放する（retention）", () => {
    const events: OperationTraceEvent[] = [];
    const lane = new OperationLane("fetch", "latest", { withSignal: true, trace: (e) => events.push(e) });
    const a = begin(lane);
    const b = begin(lane);
    const genBefore = lane.ownerGeneration;

    lane.disposeOwner();

    expect(lane.ownerGeneration).toBe(genBefore + 1);
    expect(lane.inFlightCount).toBe(0);
    expect(lane.activeOperationId).toBeUndefined();
    // 生きている controller は全て abort される
    expect(a.attempt.signal!.aborted).toBe(true);
    expect(b.attempt.signal!.aborted).toBe(true);
    // controller は解放され、以後 signalOf で到達できない（retention gate §10.3）
    expect(lane.signalOf(a.ticket)).toBeUndefined();
    expect(lane.signalOf(b.ticket)).toBeUndefined();
    // dispose 後に届いた settle は commit しない
    expect(lane.claimTerminal(a.ticket, "success")).toBe(false);
    // stale-dropped trace が全 operation 分出る
    const stale = events.filter((e) => e.type === "io:stale-dropped").map((e) => e.operationId);
    expect(stale).toEqual(expect.arrayContaining([1, 2]));
  });

  it("既に committing の operation は dispose で stale 上書きしない", () => {
    const lane = new OperationLane("fetch", "latest");
    const op = begin(lane);
    lane.claimTerminal(op.ticket, "success");
    lane.disposeOwner();
    // committing のまま finalize すれば success として確定する
    lane.finalize(op.ticket);
    expect(lane.claimedOutcome(op.ticket)).toBeUndefined(); // finalize でクリア済み
  });

  it("policy ごとの canCommit 分岐を網羅する", () => {
    const policies: LanePolicy[] = ["latest", "queue", "exhaust", "overlap"];
    for (const policy of policies) {
      const lane = new OperationLane("x", policy);
      const op = begin(lane);
      expect(lane.canCommit(op.ticket)).toBe(true);
      lane.claimTerminal(op.ticket, "success");
      lane.finalize(op.ticket);
      expect(lane.canCommit(op.ticket)).toBe(false);
    }
  });
});
