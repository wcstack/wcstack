import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RecorderCore } from "../src/core/RecorderCore";
import {
  installRecorder, FakeMediaStream, FakeMediaStreamTrack, FakeMediaRecorder, revokedUrls,
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

  it("先行エラー後に正常 start すると error が null に戻り通知される（#7・null クリア分岐）", () => {
    const core = new RecorderCore();
    const errors = capture(core, "wcs-recorder:error");
    core.start(); // stream 未 attach → NoStreamError（非 null）
    expect(core.error?.name).toBe("NoStreamError");
    core.attachStream(makeStream());
    core.start(); // 成功 → _setError(null)：_error が非 null なので dispatch される
    expect(core.error).toBeNull();
    // 最後の通知は null（クリア）。
    expect(errors[errors.length - 1]).toBeNull();
  });

  it("MediaRecorder 不在で start すると error（unsupported）", () => {
    recorder.uninstall(); // MediaRecorder を外す
    const core = new RecorderCore();
    core.attachStream(makeStream());
    core.start();
    expect(core.error?.name).toBe("unsupported");
    recorder = installRecorder(); // afterEach の uninstall 用に再設置
  });

  it("recorder.mimeType が空なら recOptions.mimeType にフォールバックする（#5）", () => {
    FakeMediaRecorder.reportEmptyMimeType = true; // recorder.mimeType="" を強制
    const core = new RecorderCore();
    core.attachStream(makeStream());
    core.start({ mimeType: "video/webm" }); // 対応 type → recOptions.mimeType に乗る
    // recorder.mimeType（空）|| recOptions.mimeType（"video/webm"）が採用される。
    expect(core.mimeType).toBe("video/webm");
  });

  it("mimeType 未確定（空）なら Blob を type 無しで組み立てる（#6）", () => {
    FakeMediaRecorder.reportEmptyMimeType = true; // recorder.mimeType=""
    const core = new RecorderCore();
    core.attachStream(makeStream());
    core.start(); // mimeType 指定なし → recOptions.mimeType も undefined
    expect(core.mimeType).toBe(""); // _mimeType は空のまま
    FakeMediaRecorder.instances[0].emitData(new Blob(["x"]));
    core.stop(); // _assembleBlob: _mimeType 空 → { type } を渡さない（undefined 分岐）
    expect(core.blob).toBeInstanceOf(Blob);
    expect(core.blob?.type).toBe("");
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

  it("pause→resume→pause→stop で duration が一時停止区間を除外して累積する（#9 状態機械）", () => {
    let t = 0;
    const spy = vi.spyOn(performance, "now").mockImplementation(() => t);
    const core = new RecorderCore();
    core.attachStream(makeStream());

    t = 1000; core.start();   // _startTime = 1000
    t = 1300; core.pause();   // 区間1 = 300ms 録画 → duration=300、_startTime 据置
    expect(core.duration).toBe(300);
    t = 2300; core.resume();  // 1000ms 一時停止（除外）。_startTime = 2300 - 300 = 2000
    t = 2700; core.pause();   // 区間2 = 400ms 追加 → elapsed = 2700-2000 = 700
    expect(core.duration).toBe(700);
    // paused 中の stop は再計算しない（確定値 700 を維持）。
    t = 9999; core.stop();
    expect(core.duration).toBe(700);
    spy.mockRestore();
  });

  it("timeslice 複数チャンクが順次到着し、stop で全結合した1 Blob になる（#9 状態機械）", () => {
    const core = new RecorderCore();
    const chunks = capture(core, "wcs-recorder:dataavailable");
    const recorded = capture(core, "wcs-recorder:recorded");
    core.attachStream(makeStream());
    core.start({ timeslice: 100 });
    const mr = FakeMediaRecorder.instances[0];
    // 実ブラウザの timeslice 逐次到着を模す。
    mr.emitData(new Blob(["aaaa"]));   // 4 bytes
    mr.emitData(new Blob(["bb"]));     // 2 bytes
    mr.emitData(new Blob(["cccccc"])); // 6 bytes
    // 各チャンクが dataavailable として出る。
    expect(chunks).toHaveLength(3);
    core.stop();
    // stop で全チャンクを結合した1 Blob（4+2+6=12 bytes）。
    expect(recorded).toHaveLength(1);
    expect(core.blob?.size).toBe(12);
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

  it("2本目録画中も blob/objectURL は前クリップを保持する（#4 意図・挙動固定）", () => {
    const core = new RecorderCore();
    core.attachStream(makeStream());
    core.start();
    FakeMediaRecorder.instances[0].emitData(new Blob(["first"]));
    core.stop();
    const firstBlob = core.blob;
    const firstUrl = core.objectURL;
    expect(firstBlob).toBeInstanceOf(Blob);

    // 2本目を start（stop 前）。start は _blob/_objectURL をリセットしない。
    core.start();
    expect(core.recording).toBe(true);
    expect(core.blob).toBe(firstBlob);     // 前クリップを保持
    expect(core.objectURL).toBe(firstUrl);

    // 2本目 stop で新クリップに置き換わり、前 URL が revoke される。
    FakeMediaRecorder.instances[1].emitData(new Blob(["second"]));
    core.stop();
    expect(core.blob).not.toBe(firstBlob);
    expect(revokedUrls).toContain(firstUrl);
  });

  it("録画中に借用 stream のトラックが ended になっても自動終了せず、明示 stop で組み立てる（#2 非目標・挙動固定）", () => {
    const core = new RecorderCore();
    const track = new FakeMediaStreamTrack("video");
    const stream = new FakeMediaStream("borrowed", [track]);
    core.attachStream(stream as unknown as MediaStream);
    core.start();
    const mr = FakeMediaRecorder.instances[0];
    mr.emitData(new Blob(["x"]));

    // 借用トラックが OS 剥奪/camera stop で ended になる。
    expect(() => track.end()).not.toThrow();
    // Core は ended を購読しないので録画は自然終了しない（borrowed 設計の非目標）。
    expect(core.recording).toBe(true);
    // 借用トラックを止めるのは録画側の責務ではない（所有権は camera）。
    expect(track.stopped).toBe(false);

    // 明示 stop で、それまでに取れた chunk から Blob を組み立てる（never-throw）。
    core.stop();
    expect(core.recording).toBe(false);
    expect(core.blob).toBeInstanceOf(Blob);
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

  it("録画中の attachStream は現行録画を差し替えず、次の start から有効（#2 挙動固定）", () => {
    const core = new RecorderCore();
    const first = makeStream();
    core.attachStream(first);
    core.start();
    const mr1 = FakeMediaRecorder.instances[0];
    expect(mr1.stream).toBe(first);

    // 録画中に別 stream を attach しても、現行の MediaRecorder は旧 stream のまま。
    const second = makeStream();
    core.attachStream(second);
    expect(mr1.stream).toBe(first);
    core.stop();

    // 次の start から新 stream が使われる。
    core.start();
    const mr2 = FakeMediaRecorder.instances[1];
    expect(mr2.stream).toBe(second);
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
