import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { bootstrapCamera } from "../src/bootstrapCamera";
import { WcsRecorder } from "../src/components/Recorder";
import { installRecorder, FakeMediaStream, FakeMediaRecorder } from "./helpers";

beforeAll(() => {
  bootstrapCamera();
});

describe("<wcs-recorder> Shell", () => {
  let recorder: { uninstall(): void };

  beforeEach(() => {
    recorder = installRecorder();
  });
  afterEach(() => {
    recorder.uninstall();
  });

  function mount(html: string): WcsRecorder {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    return host.querySelector("wcs-recorder") as WcsRecorder;
  }

  it("connect で display:none になる（描画はしない）", () => {
    const el = mount(`<wcs-recorder></wcs-recorder>`);
    expect(el.style.display).toBe("none");
  });

  it("attachStream→start→stop を Core に委譲し blob/objectURL を公開する", () => {
    const el = mount(`<wcs-recorder></wcs-recorder>`);
    el.attachStream(new FakeMediaStream("s") as unknown as MediaStream);
    el.start();
    expect(el.recording).toBe(true);
    FakeMediaRecorder.instances[0].emitData(new Blob(["x"]));
    el.stop();
    expect(el.recording).toBe(false);
    expect(el.blob).toBeInstanceOf(Blob);
    expect(el.objectURL).toMatch(/^blob:fake-/);
  });

  it("属性 mime-type / timeslice / bitrate をパースして start options に渡す", () => {
    FakeMediaRecorder.supportedTypes = ["video/webm;codecs=vp9"];
    const el = mount(`<wcs-recorder mime-type="video/webm;codecs=vp9" timeslice="500" audio-bits="128000" video-bits="2500000"></wcs-recorder>`);
    el.attachStream(new FakeMediaStream("s") as unknown as MediaStream);
    el.start();
    const mr = FakeMediaRecorder.instances[0];
    expect(mr.options.mimeType).toBe("video/webm;codecs=vp9");
    expect(mr.options.audioBitsPerSecond).toBe(128000);
    expect(mr.options.videoBitsPerSecond).toBe(2500000);
  });

  it("pause/resume を委譲する", () => {
    const el = mount(`<wcs-recorder></wcs-recorder>`);
    el.attachStream(new FakeMediaStream("s") as unknown as MediaStream);
    el.start();
    el.pause();
    expect(el.paused).toBe(true);
    el.resume();
    expect(el.paused).toBe(false);
  });

  it("disconnect で dispose する（借用 stream は stop しない）", () => {
    const el = mount(`<wcs-recorder></wcs-recorder>`);
    const stream = new FakeMediaStream("borrowed");
    el.attachStream(stream as unknown as MediaStream);
    el.start();
    el.remove();
    expect(stream.tracks[0].stopped).toBe(false);
    expect(el.recording).toBe(false);
  });
});
