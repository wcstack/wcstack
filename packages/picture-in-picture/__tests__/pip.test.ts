import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { WcsPip } from "../src/components/Pip.js";
import { PipCore } from "../src/core/PipCore.js";
import {
  makeVideo,
  removeRequestPictureInPicture,
  installPictureInPictureElement,
  setPictureInPictureElement,
  removePictureInPictureElement,
  installExitPictureInPicture,
  removeExitPictureInPicture,
  emitEnter,
  emitLeave,
} from "./mocks.js";

beforeAll(() => {
  if (!customElements.get("wcs-pip")) {
    customElements.define("wcs-pip", WcsPip);
  }
});

function makeEl(attrs: Record<string, string> = {}): WcsPip {
  const el = document.createElement("wcs-pip") as WcsPip;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  return el;
}

describe("<wcs-pip>", () => {
  afterEach(() => {
    removePictureInPictureElement();
    removeExitPictureInPicture();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  describe("target 解決と display", () => {
    it("target 省略 + 子あり(video) → 最初の子を対象にし display:contents", async () => {
      installPictureInPictureElement(null);
      const el = makeEl();
      const video = makeVideo();
      el.appendChild(video);
      document.body.appendChild(el);

      expect(el.style.display).toBe("contents");

      setPictureInPictureElement(video);
      emitEnter(video);
      expect(el.active).toBe(true);
    });

    it("target 省略 + 子なし → 自分を対象にし display:block", () => {
      installPictureInPictureElement(null);
      const el = makeEl();
      document.body.appendChild(el);
      expect(el.style.display).toBe("block");
    });

    it('target="self" → 自分を対象にし display:block', () => {
      installPictureInPictureElement(null);
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      expect(el.style.display).toBe("block");
    });

    it("target=セレクタ(video) → 参照先を対象にし display:none", () => {
      installPictureInPictureElement(null);
      const video = makeVideo();
      video.id = "player";
      document.body.appendChild(video);
      const el = makeEl({ target: "#player" });
      document.body.appendChild(el);

      expect(el.style.display).toBe("none");

      setPictureInPictureElement(video);
      emitEnter(video);
      expect(el.active).toBe(true);
    });

    it("target=不正セレクタ → throw せず未解決扱い（never-throw）", () => {
      const el = makeEl({ target: ":::" });
      expect(() => document.body.appendChild(el)).not.toThrow();
      expect(el.style.display).toBe("none");
    });

    it("target=未マッチセレクタ → display:none で active は false のまま", () => {
      const el = makeEl({ target: "#missing" });
      expect(() => document.body.appendChild(el)).not.toThrow();
      expect(el.style.display).toBe("none");
      expect(el.active).toBe(false);
    });
  });

  describe("tagName !== VIDEO 検証", () => {
    it("target が <div> を指す場合、requestPictureInPicture() は例外を投げず即 error になる", async () => {
      const div = document.createElement("div");
      div.id = "not-a-video";
      document.body.appendChild(div);
      const el = makeEl({ target: "#not-a-video" });
      document.body.appendChild(el);

      await expect(el.requestPictureInPicture()).resolves.toBeUndefined();
      expect(el.error).toEqual({ message: "target must be a <video> element." });
    });

    it("target 省略 + 子要素が <div> の場合も同様に error になる", async () => {
      const el = makeEl();
      const div = document.createElement("div");
      el.appendChild(div);
      document.body.appendChild(el);

      await el.requestPictureInPicture();
      expect(el.error).toEqual({ message: "target must be a <video> element." });
    });
  });

  describe("target 属性変更でのリスナー張り替え", () => {
    it("target 属性を変更すると旧 video のリスナーが外れ、新 video に張り替わる", () => {
      installPictureInPictureElement(null);
      const videoA = makeVideo();
      videoA.id = "a";
      const videoB = makeVideo();
      videoB.id = "b";
      document.body.appendChild(videoA);
      document.body.appendChild(videoB);

      const el = makeEl({ target: "#a" });
      document.body.appendChild(el);

      el.setAttribute("target", "#b");

      // 旧 video (a) に PiP イベントを送っても el.active は反応しない
      setPictureInPictureElement(videoA);
      emitEnter(videoA);
      expect(el.active).toBe(false);

      // 新 video (b) には反応する
      setPictureInPictureElement(videoB);
      emitEnter(videoB);
      expect(el.active).toBe(true);
    });

    it("同値の属性変更は無視する（再 observe しない）", () => {
      installPictureInPictureElement(null);
      const video = makeVideo();
      video.id = "a";
      document.body.appendChild(video);
      const el = makeEl({ target: "#a" });
      document.body.appendChild(el);

      const addSpy = vi.spyOn(video, "addEventListener");
      el.setAttribute("target", "#a");

      expect(addSpy).not.toHaveBeenCalled();
    });

    it("未接続なら attributeChangedCallback は何もしない", () => {
      const el = makeEl({ target: "#a" });
      expect(() => el.setAttribute("target", "#b")).not.toThrow();
    });
  });

  describe("commands", () => {
    it("requestPictureInPicture() が Shell 解決の要素を Core へ渡し、成功で active が追従する", async () => {
      installPictureInPictureElement(null);
      const video = makeVideo();
      const el = makeEl();
      el.appendChild(video);
      document.body.appendChild(el);

      const promise = el.requestPictureInPicture();
      video.__pipResolve!();
      await promise;

      expect(el.error).toBeNull();
    });

    it("requestPictureInPicture() の reject は never-throw で error に格納される", async () => {
      const video = makeVideo();
      const el = makeEl();
      el.appendChild(video);
      document.body.appendChild(el);
      const err = new DOMException("nope", "NotAllowedError");

      const promise = el.requestPictureInPicture();
      video.__pipReject!(err);

      await expect(promise).resolves.toBeUndefined();
      expect(el.error).toBe(err);
    });

    it("requestPictureInPicture 不在（unsupported）環境では error になる", async () => {
      const video = makeVideo();
      removeRequestPictureInPicture(video);
      const el = makeEl();
      el.appendChild(video);
      document.body.appendChild(el);

      await el.requestPictureInPicture();
      expect(el.error).toEqual({ message: "Picture-in-Picture API is not supported." });
    });

    it("exitPictureInPicture() は何も PiP でない状態では silent no-op", async () => {
      installPictureInPictureElement(null);
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);

      await expect(el.exitPictureInPicture()).resolves.toBeUndefined();
      expect(el.error).toBeNull();
    });

    it("exitPictureInPicture() は PiP 中なら document.exitPictureInPicture を呼ぶ", async () => {
      const video = makeVideo();
      installPictureInPictureElement(video);
      const { resolve } = installExitPictureInPicture();
      const el = makeEl();
      el.appendChild(video);
      document.body.appendChild(el);

      const promise = el.exitPictureInPicture();
      resolve();
      await promise;

      expect(el.error).toBeNull();
    });
  });

  describe("複数インスタンス同時存在での自己判定", () => {
    it("#a と #b それぞれのインスタンスが自分の video の PiP のみ反映する", () => {
      installPictureInPictureElement(null);
      const videoA = makeVideo();
      videoA.id = "a";
      const videoB = makeVideo();
      videoB.id = "b";
      document.body.appendChild(videoA);
      document.body.appendChild(videoB);

      const elA = makeEl({ target: "#a" });
      const elB = makeEl({ target: "#b" });
      document.body.appendChild(elA);
      document.body.appendChild(elB);

      setPictureInPictureElement(videoA);
      emitEnter(videoA);

      expect(elA.active).toBe(true);
      expect(elB.active).toBe(false);
    });
  });

  describe("disconnectedCallback / dispose", () => {
    it("disconnect 後は Core が dispose され、切断後の enterpictureinpicture を無視する", () => {
      installPictureInPictureElement(null);
      const video = makeVideo();
      const el = makeEl();
      el.appendChild(video);
      document.body.appendChild(el);
      el.remove();

      setPictureInPictureElement(video);
      emitEnter(video);

      expect(el.active).toBe(false);
    });

    it("_gen 世代ガード: disconnect 後に resolve しても error/active を書き換えない", async () => {
      const video = makeVideo();
      const el = makeEl();
      el.appendChild(video);
      document.body.appendChild(el);

      const promise = el.requestPictureInPicture();
      el.remove();
      video.__pipResolve!();
      await promise;

      expect(el.error).toBeNull();
    });
  });

  describe("Shell wcBindable / 静的契約", () => {
    it("hasConnectedCallbackPromise は true（SSR 対応）", () => {
      expect(WcsPip.hasConnectedCallbackPromise).toBe(true);
    });

    it("observedAttributes は target のみ", () => {
      expect(WcsPip.observedAttributes).toEqual(["target"]);
    });

    it("properties は Core を継承する", () => {
      const names = WcsPip.wcBindable.properties.map((p) => p.name);
      for (const p of PipCore.wcBindable.properties) {
        expect(names).toContain(p.name);
      }
    });

    it("inputs は target 属性ヒントのみ", () => {
      expect(WcsPip.wcBindable.inputs).toEqual([{ name: "target", attribute: "target" }]);
    });

    it("commands は Core の commands をそのまま継承する（同一参照で追従漏れ防止）", () => {
      expect(WcsPip.wcBindable.commands).toBe(PipCore.wcBindable.commands);
      const names = WcsPip.wcBindable.commands!.map((c) => c.name);
      expect(names).toEqual(["requestPictureInPicture", "exitPictureInPicture"]);
    });
  });

  describe("SSR / connectedCallbackPromise", () => {
    it("接続前は解決済みの promise を返す", async () => {
      const el = makeEl({ target: "self" });
      await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
    });

    it("connectedCallback で Core の ready（即時解決）を connectedCallbackPromise に設定する", async () => {
      installPictureInPictureElement(null);
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
    });
  });

  describe("属性アクセサ", () => {
    it("target の get/set が属性に反映される", () => {
      const el = makeEl();
      el.target = "#a";
      expect(el.getAttribute("target")).toBe("#a");
      expect(el.target).toBe("#a");
    });

    it("target 未設定時は空文字", () => {
      const el = makeEl();
      expect(el.target).toBe("");
    });
  });

  describe("Core delegated getters", () => {
    it("active/error は Core の値をそのまま反映する", () => {
      installPictureInPictureElement(null);
      const video = makeVideo();
      const el = makeEl();
      el.appendChild(video);
      document.body.appendChild(el);

      expect(el.active).toBe(false);
      expect(el.error).toBeNull();

      setPictureInPictureElement(video);
      emitEnter(video);
      expect(el.active).toBe(true);

      setPictureInPictureElement(null);
      emitLeave(video);
      expect(el.active).toBe(false);
    });
  });
});
