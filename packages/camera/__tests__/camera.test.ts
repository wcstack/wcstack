import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { bootstrapCamera } from "../src/bootstrapCamera";
import { WcsCamera } from "../src/components/Camera";
import { installMedia, InstalledMedia, FakeMediaStream, FakeMediaStreamTrack, flush } from "./helpers";

beforeAll(() => {
  bootstrapCamera();
});

describe("<wcs-camera> Shell", () => {
  let media: InstalledMedia;

  beforeEach(() => {
    media = installMedia();
  });
  afterEach(() => {
    // Disconnect every mounted element so its visibilitychange listener is removed
    // (a leaked listener would let a prior camera suspend a later test's stream).
    document.body.replaceChildren();
    setVisibility("visible");
    media.uninstall();
  });

  function mount(html: string): WcsCamera {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    return host.querySelector("wcs-camera") as WcsCamera;
  }

  it("shadow root に preview <video>（part=video・autoplay・muted・playsinline）を内包する", () => {
    const el = mount(`<wcs-camera></wcs-camera>`);
    const video = el.shadowRoot!.querySelector("video") as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(video.getAttribute("part")).toBe("video");
    expect(video.autoplay).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.hasAttribute("playsinline")).toBe(true);
  });

  it("属性 facing-mode / audio / device-id / width / height をパースして constraints に反映", async () => {
    const el = mount(`<wcs-camera facing-mode="environment" audio device-id="cam-9" width="640" height="480"></wcs-camera>`);
    await el.connectedCallbackPromise;
    el.start();
    await flush();
    const call = media.control.calls[0];
    expect((call.video as MediaTrackConstraints).deviceId).toEqual({ exact: "cam-9" });
    expect((call.video as MediaTrackConstraints).width).toBe(640);
    expect(call.audio).toBe(true);
  });

  it("stream-ready で内部 <video>.srcObject に生ハンドルを直結する（state を介さない）", async () => {
    const el = mount(`<wcs-camera></wcs-camera>`);
    const stream = new FakeMediaStream("preview-stream");
    media.resolveWith(stream);
    await el.connectedCallbackPromise;
    el.start();
    await flush();
    const video = el.shadowRoot!.querySelector("video") as HTMLVideoElement & { srcObject: unknown };
    expect(video.srcObject).toBe(stream);
  });

  it("active=false でプレビューの srcObject をクリアする", async () => {
    const el = mount(`<wcs-camera></wcs-camera>`);
    media.resolveWith(new FakeMediaStream("s"));
    await el.connectedCallbackPromise;
    el.start();
    await flush();
    el.stop();
    const video = el.shadowRoot!.querySelector("video") as HTMLVideoElement & { srcObject: unknown };
    expect(video.srcObject).toBeNull();
  });

  it("autostart 属性で connect 時に自動取得する", async () => {
    const el = mount(`<wcs-camera autostart></wcs-camera>`);
    await el.connectedCallbackPromise;
    await flush();
    expect(el.active).toBe(true);
  });

  it("disconnect で dispose（track.stop）する", async () => {
    const el = mount(`<wcs-camera></wcs-camera>`);
    const stream = new FakeMediaStream("s");
    media.resolveWith(stream);
    await el.connectedCallbackPromise;
    el.start();
    await flush();
    el.remove();
    expect(stream.tracks[0].stopped).toBe(true);
  });

  it("DOM 内移動（disconnect→reconnect）で autostart は再 dispose・再 acquire される（#5 挙動固定）", async () => {
    // autostart は connectedCallback で同期的に acquire を起動するので、mount 前に
    // 取得 stream を仕込む（mount 後では requestUserMedia に間に合わない）。
    const first = new FakeMediaStream("first");
    media.resolveWith(first);
    const el = mount(`<wcs-camera autostart></wcs-camera>`);
    await el.connectedCallbackPromise;
    await flush();
    expect(el.active).toBe(true);

    // 別の親へ移動する＝disconnect（旧 stream を dispose で stop）→ reconnect。
    el.remove();
    expect(first.tracks[0].stopped).toBe(true);
    expect(el.active).toBe(false);

    const second = new FakeMediaStream("second");
    media.resolveWith(second); // reconnect 時の acquire 用に先回りで仕込む
    const host2 = document.createElement("div");
    document.body.appendChild(host2);
    host2.appendChild(el); // reconnect: connectedCallback で observe + autostart 再取得
    await el.connectedCallbackPromise;
    await flush();
    expect(el.active).toBe(true);
  });

  it("visibilitychange: hidden で suspend・visible で resume、keep-alive で抑止", async () => {
    const el = mount(`<wcs-camera></wcs-camera>`);
    const stream = new FakeMediaStream("s1");
    media.resolveWith(stream);
    await el.connectedCallbackPromise;
    el.start();
    await flush();

    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(stream.tracks[0].stopped).toBe(true);
    expect(el.active).toBe(false);

    media.resolveWith(new FakeMediaStream("s2"));
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(el.active).toBe(true);

    // keep-alive を立てると hidden でも抑止。
    el.keepAlive = true;
    const current = (el.shadowRoot!.querySelector("video") as HTMLVideoElement & { srcObject: { tracks: { stopped: boolean }[] } }).srcObject;
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(el.active).toBe(true);
    expect(current.tracks[0].stopped).toBe(false);

    el.remove();
  });

  it("switchCamera 属性反転と stop コマンドを委譲する", async () => {
    const el = mount(`<wcs-camera facing-mode="user"></wcs-camera>`);
    media.resolveWith(new FakeMediaStream("front"));
    await el.connectedCallbackPromise;
    el.start();
    await flush();
    media.control.calls.length = 0;
    media.resolveWith(new FakeMediaStream("back"));
    el.switchCamera();
    await flush();
    const last = media.control.calls[media.control.calls.length - 1];
    expect((last.video as MediaTrackConstraints).facingMode).toBe("environment");
  });

  it("switchCamera は environment から user にも戻せる（Shell 属性反転）", async () => {
    const el = mount(`<wcs-camera facing-mode="environment"></wcs-camera>`);
    media.resolveWith(new FakeMediaStream("back"));
    await el.connectedCallbackPromise;
    el.start();
    await flush();
    media.control.calls.length = 0;
    media.resolveWith(new FakeMediaStream("front"));
    el.switchCamera();
    await flush();
    expect(el.getAttribute("facing-mode")).toBe("user");
    const last = media.control.calls[media.control.calls.length - 1];
    expect((last.video as MediaTrackConstraints).facingMode).toBe("user");
  });

  it("非アクティブ時の switchCamera は属性だけ更新し再取得しない（active ガード偽側）", async () => {
    const el = mount(`<wcs-camera facing-mode="user"></wcs-camera>`);
    await el.connectedCallbackPromise; // start していない＝非アクティブ
    expect(el.active).toBe(false);
    el.switchCamera();
    await flush();
    // DOM 属性は反転するが getUserMedia は走らない。
    expect(el.getAttribute("facing-mode")).toBe("environment");
    expect(media.control.calls).toHaveLength(0);
    expect(el.active).toBe(false);
  });

  it("device-id 設定状態で switchCamera すると、その再取得が反転後 facingMode で1回だけ走る（#2 回帰）", async () => {
    const el = mount(`<wcs-camera facing-mode="user" device-id="cam-1"></wcs-camera>`);
    media.resolveWith(new FakeMediaStream("front"));
    await el.connectedCallbackPromise;
    el.start();
    await flush();
    expect(el.active).toBe(true);

    // switchCamera 自身が起こす再取得だけを観測する。
    media.control.calls.length = 0;
    media.resolveWith(new FakeMediaStream("back"));
    el.switchCamera();
    await flush();

    // 2属性変更（device-id 除去 + facing-mode 反転）でも getUserMedia は 1 回だけ。
    expect(media.control.calls).toHaveLength(1);
    const call = media.control.calls[0];
    // 反転後の facingMode が使われ、device-id は混入しない（前後切替が効く）。
    expect((call.video as MediaTrackConstraints).facingMode).toBe("environment");
    expect((call.video as MediaTrackConstraints).deviceId).toBeUndefined();
    // DOM 属性・active も整合。
    expect(el.getAttribute("facing-mode")).toBe("environment");
    expect(el.hasAttribute("device-id")).toBe(false);
    expect(el.active).toBe(true);

    // その後に別の観測属性（width）が変わっても device-id 属性は消えたままなので
    // _constraints() が古い device-id を再注入して facingMode を無効化しない。
    media.control.calls.length = 0;
    media.resolveWith(new FakeMediaStream("back2"));
    el.setAttribute("width", "640");
    await flush();
    const last = media.control.calls[media.control.calls.length - 1];
    expect((last.video as MediaTrackConstraints).facingMode).toBe("environment");
    expect((last.video as MediaTrackConstraints).deviceId).toBeUndefined();
  });

  it("属性変更（device-id）が active 中は再取得を起こす", async () => {
    const el = mount(`<wcs-camera></wcs-camera>`);
    media.resolveWith(new FakeMediaStream("a"));
    await el.connectedCallbackPromise;
    el.start();
    await flush();
    media.control.calls.length = 0;

    media.resolveWith(new FakeMediaStream("b"));
    el.setAttribute("device-id", "cam-x");
    await flush();
    const last = media.control.calls[media.control.calls.length - 1];
    expect((last.video as MediaTrackConstraints).deviceId).toEqual({ exact: "cam-x" });
  });

  it("audio 属性の追加が active 中に再取得を起こし audio 制約を反映する（#4）", async () => {
    const el = mount(`<wcs-camera></wcs-camera>`);
    media.resolveWith(new FakeMediaStream("a"));
    await el.connectedCallbackPromise;
    el.start();
    await flush();
    expect(media.control.calls[0].audio).toBe(false);
    media.control.calls.length = 0;

    // audio を後付けすると再取得し、新しい constraints で audio:true になる。
    // grant した stream に audio track があるので audioPermission も granted になる（#1）。
    media.resolveWith(new FakeMediaStream("av", [
      new FakeMediaStreamTrack("video"),
      new FakeMediaStreamTrack("audio"),
    ]));
    el.setAttribute("audio", "");
    await flush();
    const last = media.control.calls[media.control.calls.length - 1];
    expect(last.audio).toBe(true);
    expect(el.audioPermission).toBe("granted");
  });
});

function setVisibility(state: "hidden" | "visible"): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}
