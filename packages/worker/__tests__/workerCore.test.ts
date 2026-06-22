import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WorkerCore } from "../src/core/WorkerCore.js";
import { FakeWorker, installWorker, removeWorker, restoreWorker } from "./mocks.js";

beforeEach(() => {
  installWorker();
});

afterEach(() => {
  restoreWorker();
  vi.useRealTimers();
});

describe("WorkerCore - start / spawn", () => {
  it("start で Worker を生成し running が true になる", () => {
    const core = new WorkerCore();
    core.start("worker.js");
    expect(FakeWorker.created).toHaveLength(1);
    expect(FakeWorker.last?.src).toBe("worker.js");
    expect(FakeWorker.last?.options).toEqual({ type: "module" });
    expect(core.running).toBe(true);
  });

  it("type オプションを Worker に渡す", () => {
    const core = new WorkerCore();
    core.start("worker.js", { type: "classic" });
    expect(FakeWorker.last?.options).toEqual({ type: "classic", name: undefined });
  });

  it("name オプションを Worker コンストラクタに渡す", () => {
    const core = new WorkerCore();
    core.start("worker.js", { name: "job" });
    expect(FakeWorker.last?.options?.name).toBe("job");
  });

  it("name 未指定なら name は undefined（省略扱い）", () => {
    const core = new WorkerCore();
    core.start("worker.js");
    expect(FakeWorker.last?.options?.name).toBeUndefined();
  });

  it("src が空なら TypeError を error に立て、生成しない", () => {
    const core = new WorkerCore();
    core.start("");
    expect(FakeWorker.created).toHaveLength(0);
    expect(core.error).toEqual({ name: "TypeError", message: "src is required." });
    expect(core.running).toBe(false);
  });

  it("同じ src での再 start は冪等（再生成しない）", () => {
    const core = new WorkerCore();
    core.start("worker.js");
    core.start("worker.js");
    expect(FakeWorker.created).toHaveLength(1);
  });

  it("異なる src での start は旧 Worker を terminate して張り替える", () => {
    const core = new WorkerCore();
    core.start("a.js");
    const first = FakeWorker.last!;
    core.start("b.js");
    expect(first.terminated).toBe(true);
    expect(FakeWorker.created).toHaveLength(2);
    expect(FakeWorker.last?.src).toBe("b.js");
  });

  it("Worker コンストラクタが Error を投げたら error に正規化（throw しない）", () => {
    const core = new WorkerCore();
    FakeWorker.nextConstructError = new DOMException("blocked", "SecurityError");
    core.start("worker.js");
    expect(core.error).toEqual({ name: "SecurityError", message: "blocked" });
    expect(core.running).toBe(false);
  });

  it("非 Error が投げられた場合も文字列化して error に立てる", () => {
    const core = new WorkerCore();
    FakeWorker.nextConstructError = "boom";
    core.start("worker.js");
    expect(core.error).toEqual({ name: "Error", message: "boom" });
  });

  it("Worker 未対応環境（コンストラクタ不在）でも spawn 失敗を error に集約", () => {
    const core = new WorkerCore();
    removeWorker();
    core.start("worker.js");
    expect(core.running).toBe(false);
    // `new Worker(...)` で Worker が undefined のとき "Worker is not a constructor"
    // の TypeError が投げられ、_normalizeError がその name/message を保持する。
    // フォールバックが Error 等へ退化したら検知できるよう実挙動を固定する。
    expect(core.error?.name).toBe("TypeError");
    expect(core.error?.message).toMatch(/constructor/);
  });
});

describe("WorkerCore - post", () => {
  it("Worker 未起動で post すると InvalidStateError", () => {
    const core = new WorkerCore();
    core.post({ a: 1 });
    expect(core.error).toEqual({
      name: "InvalidStateError",
      message: "Worker is not running. Call start(src) before post().",
    });
  });

  it("起動中は postMessage に委譲する", () => {
    const core = new WorkerCore();
    core.start("worker.js");
    core.post({ a: 1 });
    expect(FakeWorker.last?.posted).toEqual([{ data: { a: 1 }, transfer: undefined }]);
  });

  it("transfer 配列を第2引数として渡す", () => {
    const core = new WorkerCore();
    core.start("worker.js");
    const buf = new ArrayBuffer(8);
    core.post(buf, [buf]);
    expect(FakeWorker.last?.posted[0].transfer).toEqual([buf]);
  });

  it("transfer 指定時は元バッファが detach される（転送=コピーでない）", () => {
    const core = new WorkerCore();
    core.start("worker.js");
    const buf = new ArrayBuffer(8);
    expect(buf.byteLength).toBe(8);
    core.post(buf, [buf]);
    // 実 Worker と同様、転送されたバッファは元コンテキストで detach される。
    expect(buf.byteLength).toBe(0);
  });

  it("空の transfer 配列は transfer なしとして渡す", () => {
    const core = new WorkerCore();
    core.start("worker.js");
    core.post("x", []);
    expect(FakeWorker.last?.posted[0]).toEqual({ data: "x", transfer: undefined });
  });

  it("クローン不能な値は DataCloneError として error に集約", () => {
    const core = new WorkerCore();
    core.start("worker.js");
    core.post(() => {});
    expect(core.error?.name).toBe("DataCloneError");
  });

  it("start → terminate 後の post は InvalidStateError（順序契約）", () => {
    const core = new WorkerCore();
    core.start("worker.js");
    core.terminate();
    core.post({ a: 1 });
    expect(core.error).toEqual({
      name: "InvalidStateError",
      message: "Worker is not running. Call start(src) before post().",
    });
  });
});

describe("WorkerCore - 受信 (message / messageerror / error)", () => {
  it("worker からの message を取り込み message プロパティに反映", () => {
    const core = new WorkerCore();
    const seen: any[] = [];
    core.start("worker.js");
    (core as any)._target.addEventListener("wcs-worker:message", (e: CustomEvent) => seen.push(e.detail));
    FakeWorker.last!.emitMessage({ result: 42 });
    expect(core.message).toEqual({ result: 42 });
    expect(seen).toEqual([{ result: 42 }]);
  });

  it("同じ値の message でも毎回イベントを再発火する（冪等ガード無し）", () => {
    const core = new WorkerCore();
    const seen: any[] = [];
    core.start("worker.js");
    (core as any)._target.addEventListener("wcs-worker:message", (e: CustomEvent) => seen.push(e.detail));
    FakeWorker.last!.emitMessage("same");
    FakeWorker.last!.emitMessage("same");
    expect(seen).toEqual(["same", "same"]);
  });

  it("messageerror は DataError として error に立てる", () => {
    const core = new WorkerCore();
    core.start("worker.js");
    FakeWorker.last!.emitMessageError();
    expect(core.error).toEqual({
      name: "DataError",
      message: "Failed to deserialize a message received from the worker.",
    });
  });

  it("worker のスクリプトエラーは位置情報込みで error に立てる", () => {
    const core = new WorkerCore();
    core.start("worker.js");
    FakeWorker.last!.emitError({ message: "boom", filename: "worker.js", lineno: 3, colno: 7 });
    expect(core.error).toEqual({
      name: "Error",
      message: "boom",
      filename: "worker.js",
      lineno: 3,
      colno: 7,
    });
  });

  it("message が空のスクリプトエラーは既定メッセージにフォールバック", () => {
    const core = new WorkerCore();
    core.start("worker.js");
    FakeWorker.last!.emitError({});
    expect(core.error?.message).toBe("Worker script error.");
  });
});

describe("WorkerCore - restart-on-error", () => {
  it("restartOnError 無効ならエラーで再生成しない", () => {
    const core = new WorkerCore();
    core.start("worker.js");
    FakeWorker.last!.emitError({ message: "x" });
    expect(FakeWorker.created).toHaveLength(1);
  });

  it("restartOnError 有効なら interval 後に再生成する", () => {
    vi.useFakeTimers();
    const core = new WorkerCore();
    core.start("worker.js", { restartOnError: true, restartInterval: 1000 });
    FakeWorker.last!.emitError({ message: "x" });
    expect(FakeWorker.created).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(FakeWorker.created).toHaveLength(2);
    expect(core.running).toBe(true);
  });

  it("maxRestarts に達したら再生成しない", () => {
    vi.useFakeTimers();
    const core = new WorkerCore();
    core.start("worker.js", { restartOnError: true, maxRestarts: 0 });
    FakeWorker.last!.emitError({ message: "x" });
    vi.advanceTimersByTime(0);
    expect(FakeWorker.created).toHaveLength(1);
  });

  it("restartCount は累積（安定稼働してもリセットされず maxRestarts は累積上限）", () => {
    vi.useFakeTimers();
    const core = new WorkerCore();
    core.start("worker.js", { restartOnError: true, maxRestarts: 1 });
    // 1回目のエラー → 累積1回目の restart（上限内）
    FakeWorker.last!.emitError({ message: "x" });
    vi.advanceTimersByTime(0);
    expect(FakeWorker.created).toHaveLength(2);
    // 再 spawn 後に安定稼働（message を受信）してもカウンタはリセットされない
    FakeWorker.last!.emitMessage("stable");
    // 2回目のエラー → 累積上限に達しているため再生成しない
    FakeWorker.last!.emitError({ message: "y" });
    vi.advanceTimersByTime(0);
    expect(FakeWorker.created).toHaveLength(2);
  });

  it("再 spawn 成功後は error がクリアされ running=true になる", () => {
    vi.useFakeTimers();
    const core = new WorkerCore();
    core.start("worker.js", { restartOnError: true, restartInterval: 1000 });
    FakeWorker.last!.emitError({ message: "boom", filename: "worker.js", lineno: 1, colno: 1 });
    // エラー直後は error が立ち、まだ旧 worker のまま
    expect(core.error).toEqual({
      name: "Error",
      message: "boom",
      filename: "worker.js",
      lineno: 1,
      colno: 1,
    });
    vi.advanceTimersByTime(1000);
    // 再 spawn 成功 → 正常稼働中なので error はクリアされる
    expect(FakeWorker.created).toHaveLength(2);
    expect(core.running).toBe(true);
    expect(core.error).toBeNull();
  });

  it("再 spawn が失敗した場合は新しい error が立つ（クリアで打ち消されない）", () => {
    vi.useFakeTimers();
    const core = new WorkerCore();
    core.start("worker.js", { restartOnError: true, restartInterval: 1000 });
    FakeWorker.last!.emitError({ message: "boom" });
    // 再 spawn 時にコンストラクタを失敗させる
    FakeWorker.nextConstructError = new DOMException("blocked", "SecurityError");
    vi.advanceTimersByTime(1000);
    expect(core.running).toBe(false);
    expect(core.error).toEqual({ name: "SecurityError", message: "blocked" });
  });

  it("リスタート待ち中の post は旧 worker に届く", () => {
    vi.useFakeTimers();
    const core = new WorkerCore();
    core.start("worker.js", { restartOnError: true, restartInterval: 1000 });
    const oldWorker = FakeWorker.last!;
    oldWorker.emitError({ message: "boom" });
    // まだ再 spawn 前: post は現在の（旧）worker に届く
    core.post({ a: 1 });
    expect(oldWorker.posted).toEqual([{ data: { a: 1 }, transfer: undefined }]);
    // 再 spawn 後は新 worker が現在の worker になる
    vi.advanceTimersByTime(1000);
    const newWorker = FakeWorker.last!;
    expect(newWorker).not.toBe(oldWorker);
    core.post({ b: 2 });
    expect(newWorker.posted).toEqual([{ data: { b: 2 }, transfer: undefined }]);
    expect(oldWorker.posted).toHaveLength(1);
  });

  it("再生成待ち中に terminate するとタイマがキャンセルされる", () => {
    vi.useFakeTimers();
    const core = new WorkerCore();
    core.start("worker.js", { restartOnError: true, restartInterval: 1000 });
    FakeWorker.last!.emitError({ message: "x" });
    core.terminate();
    vi.advanceTimersByTime(1000);
    expect(FakeWorker.created).toHaveLength(1);
    expect(core.running).toBe(false);
  });
});

describe("WorkerCore - terminate / dispose", () => {
  it("terminate で Worker を終了し running を false に", () => {
    const core = new WorkerCore();
    core.start("worker.js");
    const w = FakeWorker.last!;
    core.terminate();
    expect(w.terminated).toBe(true);
    expect(core.running).toBe(false);
  });

  it("未起動での terminate は no-op", () => {
    const core = new WorkerCore();
    expect(() => core.terminate()).not.toThrow();
    expect(core.running).toBe(false);
  });

  it("dispose は Worker を終了し error をリセットするが message は保持", () => {
    const core = new WorkerCore();
    core.start("worker.js");
    FakeWorker.last!.emitMessage("keep");
    FakeWorker.last!.emitError({ message: "x" });
    core.dispose();
    expect(core.running).toBe(false);
    expect(core.error).toBeNull();
    expect(core.message).toBe("keep");
  });

  it("dispose は保留中の restart タイマーをキャンセルし再生成しない", () => {
    vi.useFakeTimers();
    const core = new WorkerCore();
    core.start("worker.js", { restartOnError: true, restartInterval: 1000 });
    FakeWorker.last!.emitError({ message: "boom" });
    core.dispose();
    vi.advanceTimersByTime(1000);
    expect(FakeWorker.created).toHaveLength(1);
    expect(core.running).toBe(false);
  });
});

describe("WorkerCore - ライフサイクル (ready / observe / dispose の _gen ガード)", () => {
  it("ready は解決済み Promise を返す", async () => {
    const core = new WorkerCore();
    await expect(core.ready).resolves.toBeUndefined();
  });

  it("observe() は ready を返し、冪等に再呼び出しできる", async () => {
    const core = new WorkerCore();
    await expect(core.observe()).resolves.toBeUndefined();
    await expect(core.observe()).resolves.toBeUndefined();
  });

  it("dispose は _gen をインクリメントして進行中の非同期を無効化する", () => {
    const core = new WorkerCore();
    const before = (core as any)._gen;
    core.dispose();
    expect((core as any)._gen).toBe(before + 1);
  });

  it("世代が古い restart タイマーは発火しても再生成しない（_gen ガード）", () => {
    vi.useFakeTimers();
    const core = new WorkerCore();
    core.start("worker.js", { restartOnError: true, restartInterval: 1000 });
    // restart タイマーを予約（スケジュール時の _gen を捕捉）
    FakeWorker.last!.emitError({ message: "boom" });
    expect(FakeWorker.created).toHaveLength(1);
    // タイマーをキャンセルせずに _gen だけを進める（dispose 相当の世代失効を模す）
    (core as any)._gen++;
    vi.advanceTimersByTime(1000);
    // 世代が一致しないため再 spawn は起きない
    expect(FakeWorker.created).toHaveLength(1);
    expect(core.running).toBe(true);
  });
});

describe("WorkerCore - error 同値ガード", () => {
  it("成功した start は null→null の error 通知を抑制する", () => {
    const core = new WorkerCore();
    let count = 0;
    (core as any)._target.addEventListener("wcs-worker:error", () => count++);
    core.start("worker.js"); // _setError(null) but error already null
    expect(count).toBe(0);
    expect(core.error).toBeNull();
  });
});
