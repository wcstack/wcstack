import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RecorderCore } from "../src/core/RecorderCore";
import {
  installRecorder, FakeMediaStream, FakeMediaRecorder, revokedUrls,
} from "./helpers";

describe("RecorderCore", () => {
  let recorder: { uninstall(): void };

  beforeEach(() => {
    recorder = installRecorder();
  });
  afterEach(() => {
    recorder.uninstall();
  });

  function makeStream(): MediaStream {
    return new FakeMediaStream("rec-stream") as unknown as MediaStream;
  }

  function capture(core: RecorderCore, type: string): unknown[] {
    const seen: unknown[] = [];
    core.addEventListener(type, (e) => seen.push((e as CustomEvent).detail));
    return seen;
  }

  it("attachStream→start→chunk→stop で Blob を組立て recorded を publish", () => {
    const core = new RecorderCore();
    const recorded = capture(core, "wcs-recorder:recorded");
    core.attachStream(makeStream());
    core.start();
    expect(core.recording).toBe(true);

    const mr = FakeMediaRecorder.instances[0];
    mr.emitData(new Blob(["chunk-1"]));
    mr.emitData(new Blob(["chunk-2"]));
    core.stop();

    expect(core.recording).toBe(false);
    expect(core.blob).toBeInstanceOf(Blob);
    expect(core.objectURL).toMatch(/^blob:fake-/);
    expect(recorded).toHaveLength(1);
    expect((recorded[0] as { blob: Blob }).blob).toBe(core.blob);
  });

  it("stream 未 attach で start すると error（NoStreamError）", () => {
    const core = new RecorderCore();
    core.start();
    expect(core.recording).toBe(false);
    expect(core.error?.name).toBe("NoStreamError");
  });

  it("MediaRecorder 不在で start すると error（unsupported）", () => {
    recorder.uninstall(); // MediaRecorder を外す
    const core = new RecorderCore();
    core.attachStream(makeStream());
    core.start();
    expect(core.error?.name).toBe("unsupported");
    recorder = installRecorder(); // afterEach の uninstall 用に再設置
  });

  it("非対応 mimeType は無視されデフォルトが使われる", () => {
    const core = new RecorderCore();
    core.attachStream(makeStream());
    core.start({ mimeType: "video/x-unsupported" });
    const mr = FakeMediaRecorder.instances[0];
    expect(mr.options.mimeType).toBeUndefined();
    expect(core.mimeType).toBe("video/webm");
  });

  it("対応 mimeType は MediaRecorder に渡る", () => {
    const core = new RecorderCore();
    core.attachStream(makeStream());
    core.start({ mimeType: "video/webm" });
    expect(FakeMediaRecorder.instances[0].options.mimeType).toBe("video/webm");
  });

  it("連続録画で前回 objectURL を revoke、dispose で最後の URL も revoke", () => {
    const core = new RecorderCore();
    core.attachStream(makeStream());

    core.start();
    FakeMediaRecorder.instances[0].emitData(new Blob(["a"]));
    core.stop();
    const firstUrl = core.objectURL;

    core.start();
    FakeMediaRecorder.instances[1].emitData(new Blob(["b"]));
    core.stop();
    // 1回目の URL が revoke された。
    expect(revokedUrls).toContain(firstUrl);

    const secondUrl = core.objectURL;
    core.dispose();
    expect(revokedUrls).toContain(secondUrl);
  });

  it("dispose は借用 stream の track を stop しない（所有権は camera）", () => {
    const core = new RecorderCore();
    const stream = new FakeMediaStream("borrowed");
    core.attachStream(stream as unknown as MediaStream);
    core.start();
    core.dispose();
    // 借用なので stop しない。
    expect(stream.tracks[0].stopped).toBe(false);
  });

  it("pause 後 resume せず stop しても duration は一時停止区間を含まない（回帰）", () => {
    let t = 0;
    const spy = vi.spyOn(performance, "now").mockImplementation(() => (t += 100));
    const core = new RecorderCore();
    core.attachStream(makeStream());
    core.start();          // _startTime = 100
    const mr = FakeMediaRecorder.instances[0];
    mr.emitData(new Blob(["x"]));
    core.pause();          // onpause: duration = elapsed（確定）
    const pausedDuration = core.duration;
    // ここで「放置」: performance.now は進み続ける（複数回呼ばれる）
    t += 5000;
    core.stop();           // onstop: paused 中なので再計算せず確定値を維持
    expect(core.duration).toBe(pausedDuration);
    spy.mockRestore();
  });

  it("pause/resume で paused が遷移する", () => {
    const core = new RecorderCore();
    core.attachStream(makeStream());
    core.start();
    core.pause();
    expect(core.paused).toBe(true);
    core.resume();
    expect(core.paused).toBe(false);
  });

  it("timeslice 指定時のみ dataavailable を event-token に出す", () => {
    const core = new RecorderCore();
    const chunks = capture(core, "wcs-recorder:dataavailable");
    core.attachStream(makeStream());
    core.start({ timeslice: 1000 });
    FakeMediaRecorder.instances[0].emitData(new Blob(["x"]));
    expect(chunks).toHaveLength(1);
  });

  it("timeslice なしでは dataavailable を出さない（stop で1 Blob のみ）", () => {
    const core = new RecorderCore();
    const chunks = capture(core, "wcs-recorder:dataavailable");
    core.attachStream(makeStream());
    core.start();
    FakeMediaRecorder.instances[0].emitData(new Blob(["x"]));
    expect(chunks).toHaveLength(0);
  });

  it("recorder onerror を error に正規化する", () => {
    const core = new RecorderCore();
    core.attachStream(makeStream());
    core.start();
    FakeMediaRecorder.instances[0].emitError("RecorderInternalError");
    expect(core.error?.name).toBe("RecorderInternalError");
  });

  it("MediaRecorder 構築失敗は error に正規化（never-throw）", () => {
    FakeMediaRecorder.throwOnConstruct = true;
    const core = new RecorderCore();
    core.attachStream(makeStream());
    core.start();
    expect(core.recording).toBe(false);
    expect(core.error?.name).toBe("NotSupportedError");
  });

  it("世代ガード: dispose 後に来た旧 recorder の onstop は state を変えない", () => {
    const core = new RecorderCore();
    core.attachStream(makeStream());
    core.start();
    const mr = FakeMediaRecorder.instances[0];
    core.dispose(); // _gen++ で旧 recorder を無効化
    const recordingBefore = core.recording;
    // dispose 後に古い recorder のコールバックが来ても無視される。
    if (mr.onstop) mr.onstop();
    expect(core.recording).toBe(recordingBefore);
  });

  it("二重 start は無視される", () => {
    const core = new RecorderCore();
    core.attachStream(makeStream());
    core.start();
    core.start();
    expect(FakeMediaRecorder.instances).toHaveLength(1);
  });

  it("世代ガード: dispose 後に来た全 recorder コールバックは bail する", () => {
    const core = new RecorderCore();
    core.attachStream(makeStream());
    core.start();
    const mr = FakeMediaRecorder.instances[0];
    core.dispose(); // gen++ で旧 recorder を無効化
    expect(() => {
      mr.ondataavailable?.({ data: new Blob(["x"]) });
      mr.onerror?.(new Event("error"));
      mr.onpause?.();
      mr.onresume?.();
      mr.onstop?.();
    }).not.toThrow();
    expect(core.recording).toBe(false);
  });

  it("onstop の二重発火は recording の同値ガードで安定する", () => {
    const core = new RecorderCore();
    core.attachStream(makeStream());
    core.start();
    const mr = FakeMediaRecorder.instances[0];
    mr.emitData(new Blob(["x"]));
    core.stop();
    mr.onstop?.(); // 二度目: setRecording(false) は同値ガードで早期 return
    expect(core.recording).toBe(false);
  });

  it("空チャンク（size 0）は収集しない・error 詳細無しの onerror も正規化する", () => {
    const core = new RecorderCore();
    core.attachStream(makeStream());
    core.start();
    const mr = FakeMediaRecorder.instances[0];
    mr.emitData(new Blob([])); // size 0 → push されない
    mr.onerror?.(new Event("error")); // error プロパティ無し → フォールバック name
    expect(core.error?.name).toBe("RecorderError");
    core.stop();
    expect(core.blob?.size).toBe(0);
  });

  it("recorder 無し / 不正状態での stop/pause/resume は no-op", () => {
    const core = new RecorderCore();
    expect(() => { core.stop(); core.pause(); core.resume(); }).not.toThrow();
    core.attachStream(makeStream());
    core.start();
    core.pause();
    core.pause(); // 既に paused → state!=="recording" で guard
    core.resume();
    core.resume(); // 既に recording → state!=="paused" で guard
    expect(core.recording).toBe(true);
  });
});
