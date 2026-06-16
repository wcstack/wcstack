import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { bootstrapCamera } from "../src/bootstrapCamera";
import { WcsCamera } from "../src/components/Camera";
import { installMedia, InstalledMedia, FakeMediaStream, flush } from "./helpers";

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
});

function setVisibility(state: "hidden" | "visible"): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}
