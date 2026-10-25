import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { bootstrapCamera } from "../src/bootstrapCamera";
import { WcsCamera, resetPreviewStyles } from "../src/components/Camera";
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

  it("disconnect で dispose（track.stop）し、active=false を要素のイベントで知らせる", async () => {
    const el = mount(`<wcs-camera></wcs-camera>`);
    const stream = new FakeMediaStream("s");
    media.resolveWith(stream);
    await el.connectedCallbackPromise;
    el.start();
    await flush();
    const seen: unknown[] = [];
    el.addEventListener("wcs-camera:active-changed", (e) => seen.push((e as CustomEvent).detail));
    el.remove();
    expect(stream.tracks[0].stopped).toBe(true);
    expect(seen).toEqual([false]);
    expect(el.active).toBe(false);
  });

  describe("プレビューのスタイル", () => {
    afterEach(() => {
      resetPreviewStyles();
    });

    it("構築したスタイルシートを shadow root に採用し、<style> を置かない（CSP の style-src に止められない）", () => {
      resetPreviewStyles();
      const a = mount(`<wcs-camera></wcs-camera>`);
      const b = mount(`<wcs-camera></wcs-camera>`);
      expect(a.shadowRoot!.querySelector("style")).toBeNull();
      expect(a.shadowRoot!.adoptedStyleSheets).toHaveLength(1);
      // 要素どうしで 1 枚を共有する
      expect(b.shadowRoot!.adoptedStyleSheets[0]).toBe(a.shadowRoot!.adoptedStyleSheets[0]);
    });

    it("構築したスタイルシートが使えない環境では <style> に戻る", () => {
      resetPreviewStyles();
      const original = globalThis.CSSStyleSheet;
      (globalThis as { CSSStyleSheet: unknown }).CSSStyleSheet = function () { throw new Error("no constructable sheets"); };
      try {
        const el = mount(`<wcs-camera></wcs-camera>`);
        expect(el.shadowRoot!.querySelector("style")!.textContent).toContain("display:inline-block");
      } finally {
        globalThis.CSSStyleSheet = original;
      }
    });
  });

  it("DOM 内移動（disconnect→reconnect）で autostart は再 dispose・再 acquire される（#5 挙動固定）", async () => {
    // autostart の acquire は接続時の判断（マイクロタスク）が起動するので、それより前に
    // 取得 stream を仕込む。
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

  // router は遷移で同じノードを入れ直し、state は新しい params からの入力をマイクロタスクで書く
  // （timing-and-firing-contract §23、docs/seam-apps.md の shift-desk）
  describe("取得の判断はマイクロタスクで、そのときの入力で", () => {
    const deviceIds = (): unknown[] =>
      media.control.calls.map((c) => (c.video as MediaTrackConstraints).deviceId);

    it("入れ直しの間に device-id が書かれると、前の device-id では取得せず、新しい device-id で 1 回だけ取得する", async () => {
      const el = mount(`<wcs-camera autostart device-id="cam-14"></wcs-camera>`);
      await el.connectedCallbackPromise;
      await flush();
      expect(deviceIds()).toEqual([{ exact: "cam-14" }]);
      expect(el.active).toBe(true);

      // state のマイクロタスクは、router が中身を入れ直す前に積まれている
      const host = el.parentElement!;
      queueMicrotask(() => { el.deviceId = "cam-11"; });
      el.remove();
      host.appendChild(el);
      await el.connectedCallbackPromise;
      await flush();
      expect(deviceIds()).toEqual([{ exact: "cam-14" }, { exact: "cam-11" }]);
      expect(el.active).toBe(true);
    });

    it("入れ直しの間に audio が外されると、前の audio でマイクの権限を問い合わせず、audioPermission は null に戻る", async () => {
      const el = mount(`<wcs-camera audio></wcs-camera>`);
      await el.connectedCallbackPromise;
      expect(el.audioPermission).toBe("prompt");

      const query = vi.spyOn(navigator.permissions, "query");
      const host = el.parentElement!;
      queueMicrotask(() => { el.audio = false; });
      el.remove();
      host.appendChild(el);
      await el.connectedCallbackPromise;
      expect(query.mock.calls.map(([descriptor]) => descriptor.name)).toEqual(["camera"]);
      expect(el.audioPermission).toBeNull();
    });

    it("入れ直しの間に audio が書かれると、接続時の権限の監視を新しい audio で始める", async () => {
      const el = mount(`<wcs-camera></wcs-camera>`);
      await el.connectedCallbackPromise;
      expect(el.audioPermission).toBeNull();

      const host = el.parentElement!;
      queueMicrotask(() => { el.audio = true; });
      el.remove();
      host.appendChild(el);
      await el.connectedCallbackPromise;
      expect(el.audioPermission).toBe("prompt");
    });

    it("判断の前に外した要素は取得せず、connectedCallbackPromise も解ける", async () => {
      const el = mount(`<wcs-camera autostart></wcs-camera>`);
      el.remove();
      await el.connectedCallbackPromise;
      await flush();
      expect(media.control.calls).toHaveLength(0);
      expect(el.active).toBe(false);
    });

    it("同じタスクで接続の後に autostart が書かれると、取得する", async () => {
      const el = mount(`<wcs-camera></wcs-camera>`);
      el.autostart = true;
      await el.connectedCallbackPromise;
      await flush();
      expect(media.control.calls).toHaveLength(1);
      expect(el.active).toBe(true);
    });

    it("同じタスクで接続の後に autostart が外されると、取得しない", async () => {
      const el = mount(`<wcs-camera autostart></wcs-camera>`);
      el.autostart = false;
      await el.connectedCallbackPromise;
      await flush();
      expect(media.control.calls).toHaveLength(0);
      expect(el.active).toBe(false);
    });

    it("同じタスクで接続の後に stop() が呼ばれると、autostart でも取得せず、権限の監視は始める", async () => {
      const el = mount(`<wcs-camera autostart></wcs-camera>`);
      el.stop();
      await el.connectedCallbackPromise;
      await flush();
      expect(media.control.calls).toHaveLength(0);
      expect(el.active).toBe(false);
      expect(media.control.permissionStatuses.has("camera")).toBe(true);
    });

    it("stop() の後に同じタスクで入れ直すと、次の判断は autostart に従って取得する", async () => {
      const el = mount(`<wcs-camera autostart></wcs-camera>`);
      el.stop();
      const host = el.parentElement!;
      el.remove();
      host.appendChild(el);
      await el.connectedCallbackPromise;
      await flush();
      expect(media.control.calls).toHaveLength(1);
      expect(el.active).toBe(true);
    });

    it("stop() で取り消した判断の後の接続は、また autostart に従う", async () => {
      const el = mount(`<wcs-camera autostart></wcs-camera>`);
      el.stop();
      await el.connectedCallbackPromise;
      const host = el.parentElement!;
      el.remove();
      host.appendChild(el);
      await el.connectedCallbackPromise;
      await flush();
      expect(media.control.calls).toHaveLength(1);
      expect(el.active).toBe(true);
    });

    it("判断の前の start() も、いまの属性の制約で取得する", async () => {
      const el = mount(`<wcs-camera device-id="cam-9"></wcs-camera>`);
      el.start();
      await el.connectedCallbackPromise;
      await flush();
      expect(deviceIds()).toEqual([{ exact: "cam-9" }]);
      expect(el.active).toBe(true);
    });

    it("接続の後、同じタスクの制約の変化はまとまり、最後の制約で 1 回だけ取り直す", async () => {
      const el = mount(`<wcs-camera autostart></wcs-camera>`);
      await el.connectedCallbackPromise;
      await flush();
      media.control.calls.length = 0;

      media.resolveWith(new FakeMediaStream("b"));
      el.width = 640;
      el.height = 480;
      el.deviceId = "cam-x";
      await flush();
      expect(media.control.calls).toHaveLength(1);
      const video = media.control.calls[0].video as MediaTrackConstraints;
      expect([video.width, video.height, video.deviceId]).toEqual([640, 480, { exact: "cam-x" }]);
    });

    it("接続の後、ストリームが無いときの制約の変化は取得しない（active ガード偽側）", async () => {
      const el = mount(`<wcs-camera></wcs-camera>`);
      await el.connectedCallbackPromise;
      el.deviceId = "cam-x";
      el.audio = true;
      await flush();
      expect(media.control.calls).toHaveLength(0);
      expect(el.active).toBe(false);
      // 制約は Core へ渡っている（マイクの監視が始まる）
      expect(el.audioPermission).toBe("prompt");
    });

    it("DOM の外の start() は権限の監視を始めない（属性を Core へ渡すのは接続中だけ）", async () => {
      const el = document.createElement("wcs-camera") as WcsCamera;
      el.setAttribute("device-id", "cam-9");
      el.start();
      await flush();
      expect(media.control.permissionStatuses.size).toBe(0);
      expect(deviceIds()).toEqual([undefined]);
      el.stop();
    });
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

  it("deviceId は使っているデバイスを返し、決まるまでは要求した device-id を返す", async () => {
    const el = mount(`<wcs-camera device-id="cam-req"></wcs-camera>`);
    expect(el.deviceId).toBe("cam-req"); // まだストリームが無い → 要求
    media.resolveWith(new FakeMediaStream("s", [new FakeMediaStreamTrack("video", { deviceId: "cam-real" })]));
    await el.connectedCallbackPromise;
    el.start();
    await flush();
    // wcs-camera:device-changed が運ぶ値と同じ（binder の初期同期もこれを読む）
    expect(el.deviceId).toBe("cam-real");
    expect(el.getAttribute("device-id")).toBe("cam-req"); // 要求はそのまま
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

  it("undefined はマークアップに書かれた属性へ戻し、null は属性を外して既定値にする（P1 / P2）", () => {
    const host = document.createElement("div");
    host.innerHTML = `<wcs-camera audio facing-mode="environment" device-id="cam-9" width="640" height="480" autostart keep-alive></wcs-camera>`;
    const el = host.firstElementChild as WcsCamera;
    const names = ["audio", "facing-mode", "device-id", "width", "height", "autostart", "keep-alive"];
    el.audio = false;
    el.facingMode = "user";
    el.deviceId = "cam-1";
    el.width = 1280;
    el.height = 720;
    el.autostart = false;
    el.keepAlive = false;
    el.audio = undefined;
    el.facingMode = undefined;
    el.deviceId = undefined;
    el.width = undefined;
    el.height = undefined;
    el.autostart = undefined;
    el.keepAlive = undefined;
    expect(names.map((n) => el.getAttribute(n))).toEqual(["", "environment", "cam-9", "640", "480", "", ""]);
    el.audio = null;
    el.facingMode = null;
    el.deviceId = null;
    el.width = null;
    el.height = null;
    el.autostart = null;
    el.keepAlive = null;
    expect(names.map((n) => el.hasAttribute(n))).toEqual(names.map(() => false));
    expect([el.audio, el.facingMode, el.deviceId, el.width, el.height, el.autostart, el.keepAlive])
      .toEqual([false, "user", "", NaN, NaN, false, false]);
  });

  it("device-id に undefined を書いても \"undefined\" を exact 制約にせず、指定なしで取り直す", async () => {
    const el = mount(`<wcs-camera></wcs-camera>`);
    media.resolveWith(new FakeMediaStream("a"));
    await el.connectedCallbackPromise;
    el.start();
    await flush();
    media.resolveWith(new FakeMediaStream("b"));
    el.deviceId = "cam-x";
    await flush();
    media.control.calls.length = 0;

    media.resolveWith(new FakeMediaStream("c"));
    el.deviceId = undefined;
    await flush();
    const last = media.control.calls[media.control.calls.length - 1];
    expect(el.hasAttribute("device-id")).toBe(false);
    expect((last.video as MediaTrackConstraints).deviceId).toBeUndefined();
  });
});

function setVisibility(state: "hidden" | "visible"): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}
