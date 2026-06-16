import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { bootstrapCamera } from "../src/bootstrapCamera";
import { CameraCore } from "../src/core/CameraCore";
import { RecorderCore } from "../src/core/RecorderCore";
import { WcsCamera } from "../src/components/Camera";
import { WcsRecorder } from "../src/components/Recorder";
import {
  buildConstraints, normalizeMediaError, enumerateVideoDevices, stopAllTracks, requestUserMedia,
} from "../src/media/getUserMedia";
import {
  installMedia, InstalledMedia, installRecorder, FakeMediaStream, FakeMediaStreamTrack, FakeMediaRecorder, flush,
} from "./helpers";

beforeAll(() => {
  bootstrapCamera();
});

describe("wcBindable getter 関数（両 Core）", () => {
  it("CameraCore の全 getter を呼ぶ（streamReady=detail）", () => {
    const props = CameraCore.wcBindable.properties.filter((p) => p.getter);
    for (const p of props) {
      const stream = new FakeMediaStream("g");
      const value = p.getter!(new CustomEvent("x", { detail: stream }));
      expect(value).toBe(stream);
    }
  });

  it("RecorderCore の getter は detail から blob/objectURL/clip を引く（null フォールバックも）", () => {
    const byName = new Map(RecorderCore.wcBindable.properties.map((p) => [p.name, p.getter]));
    const blob = new Blob(["x"]);
    const detail = { blob, objectURL: "blob:u", mimeType: "video/webm", duration: 10 };
    expect(byName.get("blob")!(new CustomEvent("x", { detail }))).toBe(blob);
    expect(byName.get("objectURL")!(new CustomEvent("x", { detail }))).toBe("blob:u");
    expect(byName.get("recorded")!(new CustomEvent("x", { detail }))).toBe(detail);
    expect(byName.get("dataavailable")!(new CustomEvent("x", { detail: blob }))).toBe(blob);
    // null フォールバック分岐。
    expect(byName.get("blob")!(new CustomEvent("x", { detail: null }))).toBeNull();
    expect(byName.get("objectURL")!(new CustomEvent("x", { detail: null }))).toBeNull();
  });
});

describe("media/getUserMedia ヘルパ", () => {
  it("buildConstraints: deviceId 優先・facingMode・width/height・どちらも無ければ video:true", () => {
    expect(buildConstraints({ deviceId: "d" }).video).toEqual({ deviceId: { exact: "d" } });
    expect((buildConstraints({ facingMode: "user" }).video as MediaTrackConstraints).facingMode).toBe("user");
    expect((buildConstraints({ width: 320, height: 240 }).video as MediaTrackConstraints).width).toBe(320);
    expect(buildConstraints({}).video).toBe(true);
    expect(buildConstraints({ audio: true }).audio).toBe(true);
  });

  it("normalizeMediaError: name 付き object / message 欠落 / 空 message / 非 object", () => {
    expect(normalizeMediaError({ name: "NotFoundError", message: "x" })).toEqual({ name: "NotFoundError", message: "x" });
    expect(normalizeMediaError({ name: "NotFoundError" }).message).toMatch(/NotFoundError/);
    // message プロパティはあるが空 → フォールバック文言。
    expect(normalizeMediaError({ name: "X", message: "" }).message).toMatch(/X/);
    expect(normalizeMediaError("boom")).toEqual({ name: "Error", message: "Media request failed." });
    expect(normalizeMediaError(null)).toEqual({ name: "Error", message: "Media request failed." });
  });

  it("stopAllTracks(null) は何もしない", () => {
    expect(() => stopAllTracks(null)).not.toThrow();
  });

  it("enumerateVideoDevices / requestUserMedia は API 不在で空・unsupported を返す", async () => {
    const media = installMedia({ noMediaDevices: true });
    expect(await enumerateVideoDevices()).toEqual([]);
    expect((await requestUserMedia({ video: true })).error?.name).toBe("unsupported");
    media.uninstall();
  });

  it("enumerateVideoDevices は例外を握りつぶして空を返す", async () => {
    const media = installMedia();
    (navigator.mediaDevices as unknown as { enumerateDevices: () => Promise<never> }).enumerateDevices =
      () => Promise.reject(new Error("boom"));
    expect(await enumerateVideoDevices()).toEqual([]);
    media.uninstall();
  });
});

describe("CameraCore 追加分岐", () => {
  let media: InstalledMedia;
  beforeEach(() => { media = installMedia(); });
  afterEach(() => { media.uninstall(); });

  it("ready getter が解決する", async () => {
    const core = new CameraCore();
    const p = core.observe({});
    expect(core.ready).toBe(p);
    await core.ready;
  });

  it("Permissions API 不在では camera watcher が unsupported を報告", async () => {
    media.uninstall();
    media = installMedia({ noPermissions: true });
    const core = new CameraCore();
    await core.observe({});
    expect(core.permission).toBe("unsupported");
  });

  it("mediaDevices 不在で start すると error.name=unsupported → permission=unsupported", async () => {
    media.uninstall();
    media = installMedia({ noMediaDevices: true });
    const core = new CameraCore();
    await core.observe({});
    core.start();
    await flush();
    expect(core.permission).toBe("unsupported");
    expect(core.error?.name).toBe("unsupported");
  });

  it("video track が無い stream では deviceId を設定しない", async () => {
    const core = new CameraCore();
    media.resolveWith(new FakeMediaStream("audio-only", [new FakeMediaStreamTrack("audio")]));
    await core.observe({});
    core.start();
    await flush();
    expect(core.active).toBe(true);
    expect(core.deviceId).toBeNull();
  });

  it("track settings に deviceId が無ければ deviceId は null のまま", async () => {
    const core = new CameraCore();
    media.resolveWith(new FakeMediaStream("s", [new FakeMediaStreamTrack("video", {})]));
    await core.observe({});
    core.start();
    await flush();
    expect(core.active).toBe(true);
    expect(core.deviceId).toBeNull();
  });

  it("エラーかつ supersede された acquire は stream 無しでも安全に bail する", async () => {
    const core = new CameraCore();
    await core.observe({});
    media.rejectWith("NotAllowedError");
    core.start(); // gen1: reject（stream undefined）
    media.resolveWith(new FakeMediaStream("ok"));
    core.start(); // gen2: 成功で supersede
    await flush();
    // gen1 は stream 無しで bail、gen2 が採用される。
    expect(core.active).toBe(true);
    expect(core.permission).toBe("granted");
  });

  it("switchCamera は desired でなければ再取得しない", async () => {
    const core = new CameraCore();
    await core.observe({ facingMode: "user" });
    core.switchCamera(); // start していない＝desired false
    await flush();
    expect(core.active).toBe(false);
    expect(media.control.calls).toHaveLength(0);
  });

  it("suspend は stream 未取得でも安全、resume は active 中なら何もしない", async () => {
    const core = new CameraCore();
    media.resolveWith(new FakeMediaStream("s"));
    await core.observe({});
    core.suspend(); // stream 無し → no-op
    expect(core.active).toBe(false);
    core.start();
    await flush();
    expect(core.active).toBe(true);
    core.resume(); // active 中 → no-op（再取得しない）
    expect(media.control.calls).toHaveLength(1);
  });

  it("devices リスト変化で _devicesEqual が false を返し再 publish する", async () => {
    const core = new CameraCore();
    media.resolveWith(new FakeMediaStream("s1"));
    await core.observe({});
    core.start();
    await flush();
    expect(core.devices[0].deviceId).toBe("cam-1");
    // 同じ長さで内容の異なるリストに差し替え → _devicesEqual が false。
    media.control.devices = [
      { deviceId: "cam-2", label: "Back", groupId: "g2", kind: "videoinput" } as MediaDeviceInfo,
    ];
    media.resolveWith(new FakeMediaStream("s2"));
    core.start();
    await flush();
    expect(core.devices[0].deviceId).toBe("cam-2");
  });

  it("switchCamera は environment から user にも戻せる", async () => {
    const core = new CameraCore();
    media.resolveWith(new FakeMediaStream("back"));
    await core.observe({ facingMode: "environment" });
    core.start();
    await flush();
    media.resolveWith(new FakeMediaStream("front"));
    core.switchCamera();
    await flush();
    const last = media.control.calls[media.control.calls.length - 1];
    expect((last.video as MediaTrackConstraints).facingMode).toBe("user");
  });

  it("duration は経過時間で更新される（_setDuration 本体）", () => {
    const recorder = installRecorder();
    let t = 1000;
    const spy = vi.spyOn(performance, "now").mockImplementation(() => (t += 100));
    const core = new RecorderCore();
    core.attachStream(new FakeMediaStream("s") as unknown as MediaStream);
    core.start();
    FakeMediaRecorder.instances[0].emitData(new Blob(["x"]));
    core.stop();
    expect(core.duration).toBeGreaterThan(0);
    spy.mockRestore();
    recorder.uninstall();
  });
});

describe("RecorderCore 追加分岐", () => {
  let recorder: { uninstall(): void };
  beforeEach(() => { recorder = installRecorder(); });
  afterEach(() => { recorder.uninstall(); });

  it("URL.createObjectURL 不在では objectURL は空文字", () => {
    const core = new RecorderCore();
    const orig = URL.createObjectURL;
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = undefined;
    core.attachStream(new FakeMediaStream("s") as unknown as MediaStream);
    core.start();
    FakeMediaRecorder.instances[0].emitData(new Blob(["x"]));
    core.stop();
    expect(core.objectURL).toBe("");
    URL.createObjectURL = orig;
  });

});

describe("Shell アクセサ網羅", () => {
  let media: InstalledMedia;
  let recorder: { uninstall(): void };
  beforeEach(() => { media = installMedia(); recorder = installRecorder(); });
  afterEach(() => { document.body.replaceChildren(); media.uninstall(); recorder.uninstall(); });

  it("<wcs-camera> の全アクセサを読み書きする", () => {
    const el = document.createElement("wcs-camera") as WcsCamera;
    document.body.appendChild(el);
    el.audio = true; expect(el.audio).toBe(true);
    el.audio = false; expect(el.audio).toBe(false);
    el.facingMode = "environment"; expect(el.facingMode).toBe("environment");
    el.deviceId = "cam-7"; expect(el.deviceId).toBe("cam-7");
    el.width = 800; expect(el.width).toBe(800);
    el.height = 600; expect(el.height).toBe(600);
    el.autostart = true; expect(el.autostart).toBe(true);
    el.autostart = false; expect(el.autostart).toBe(false);
    el.keepAlive = true; expect(el.keepAlive).toBe(true);
    el.keepAlive = false; expect(el.keepAlive).toBe(false);
    expect(el.videoElement.tagName).toBe("VIDEO");
    expect(el.active).toBe(false);
    expect(el.permission).toBe("prompt");
    expect(el.audioPermission).toBeNull();
    expect(el.devices).toEqual([]);
    expect(el.error).toBeNull();
    // 非数値属性は NaN（既定）を返す。
    el.setAttribute("width", "abc");
    expect(Number.isNaN(el.width)).toBe(true);
  });

  it("<wcs-recorder> の全アクセサを読み書きする", () => {
    const el = document.createElement("wcs-recorder") as WcsRecorder;
    document.body.appendChild(el);
    el.mimeType = "video/webm"; expect(el.mimeType).toBe("video/webm");
    el.timeslice = 200; expect(el.timeslice).toBe(200);
    el.audioBitsPerSecond = 96000; expect(el.audioBitsPerSecond).toBe(96000);
    el.videoBitsPerSecond = 1000000; expect(el.videoBitsPerSecond).toBe(1000000);
    expect(el.recording).toBe(false);
    expect(el.paused).toBe(false);
    expect(el.duration).toBe(0);
    expect(el.blob).toBeNull();
    expect(el.objectURL).toBeNull();
    expect(el.error).toBeNull();
    el.setAttribute("timeslice", "");
    expect(Number.isNaN(el.timeslice)).toBe(true);
  });
});
