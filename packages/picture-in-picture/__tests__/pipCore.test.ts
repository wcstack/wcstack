import { describe, it, expect, afterEach, vi } from "vitest";
import { PipCore } from "../src/core/PipCore";
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
} from "./mocks";

describe("PipCore", () => {
  afterEach(() => {
    removePictureInPictureElement();
    removeExitPictureInPicture();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  describe("初期状態", () => {
    it("active は false、error は null", () => {
      const core = new PipCore();
      expect(core.active).toBe(false);
      expect(core.error).toBeNull();
    });

    it("ready は即 resolve する（非同期 probe が無いため）", async () => {
      const core = new PipCore();
      await expect(core.ready).resolves.toBeUndefined();
    });
  });

  describe("observe() — リスナー着脱", () => {
    it("video 要素へ enterpictureinpicture/leavepictureinpicture を購読する", () => {
      installPictureInPictureElement(null);
      const video = makeVideo();
      const core = new PipCore();
      const addSpy = vi.spyOn(video, "addEventListener");

      core.observe(video);

      expect(addSpy).toHaveBeenCalledWith("enterpictureinpicture", expect.any(Function));
      expect(addSpy).toHaveBeenCalledWith("leavepictureinpicture", expect.any(Function));
    });

    it("同じ要素で observe() を再呼び出しても二重登録しない（冪等）", () => {
      installPictureInPictureElement(null);
      const video = makeVideo();
      const core = new PipCore();
      const addSpy = vi.spyOn(video, "addEventListener");

      core.observe(video);
      core.observe(video);

      expect(addSpy).toHaveBeenCalledTimes(2); // enter + leave のみ（2回目は早期return）
    });

    it("target 属性変更相当 — 旧 video のリスナーを外し新 video に張り替える", () => {
      installPictureInPictureElement(null);
      const videoA = makeVideo();
      const videoB = makeVideo();
      const core = new PipCore();
      core.observe(videoA);

      const removeSpyA = vi.spyOn(videoA, "removeEventListener");
      const addSpyB = vi.spyOn(videoB, "addEventListener");

      core.observe(videoB);

      expect(removeSpyA).toHaveBeenCalledWith("enterpictureinpicture", expect.any(Function));
      expect(removeSpyA).toHaveBeenCalledWith("leavepictureinpicture", expect.any(Function));
      expect(addSpyB).toHaveBeenCalledWith("enterpictureinpicture", expect.any(Function));
      expect(addSpyB).toHaveBeenCalledWith("leavepictureinpicture", expect.any(Function));

      // 旧 video にイベントを送っても active に影響しない（リスナーが外れている）
      setPictureInPictureElement(videoA);
      emitEnter(videoA);
      expect(core.active).toBe(false);
    });

    it("observe(null) は解決済み target 無しとして扱い、リスナーを持たない", () => {
      installPictureInPictureElement(null);
      const core = new PipCore();
      expect(() => core.observe(null)).not.toThrow();
      expect(core.active).toBe(false);
    });

    it("video を observe した後に observe(null) すると旧 video のリスナーを外す", () => {
      installPictureInPictureElement(null);
      const video = makeVideo();
      const core = new PipCore();
      core.observe(video);

      const removeSpy = vi.spyOn(video, "removeEventListener");
      core.observe(null);

      expect(removeSpy).toHaveBeenCalledWith("enterpictureinpicture", expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith("leavepictureinpicture", expect.any(Function));

      // 外れているので、以後 video に enterpictureinpicture が来ても反応しない
      setPictureInPictureElement(video);
      emitEnter(video);
      expect(core.active).toBe(false);
    });

    it("observe() 呼び出し直後に document.pictureInPictureElement と一致していれば active を同期する", () => {
      const video = makeVideo();
      installPictureInPictureElement(video);
      const core = new PipCore();

      core.observe(video);

      expect(core.active).toBe(true);
    });
  });

  describe("enterpictureinpicture / leavepictureinpicture の追従", () => {
    it("enterpictureinpicture で active が true になる", () => {
      installPictureInPictureElement(null);
      const video = makeVideo();
      const core = new PipCore();
      core.observe(video);

      setPictureInPictureElement(video);
      emitEnter(video);

      expect(core.active).toBe(true);
    });

    it("leavepictureinpicture で active が false になる", () => {
      const video = makeVideo();
      installPictureInPictureElement(video);
      const core = new PipCore();
      core.observe(video);
      expect(core.active).toBe(true);

      setPictureInPictureElement(null);
      emitLeave(video);

      expect(core.active).toBe(false);
    });

    it("同値の active では change イベントを再 dispatch しない（同値ガード）", () => {
      installPictureInPictureElement(null);
      const video = makeVideo();
      const core = new PipCore();
      core.observe(video);
      const events: any[] = [];
      core.addEventListener("wcs-pip:change", (e) => events.push((e as CustomEvent).detail));

      // pictureInPictureElement が変わらないまま enterpictureinpicture が発火しても
      // active は既に false のまま → 変化なしなので dispatch しない
      emitEnter(video);

      expect(events).toEqual([]);
    });

    it("wcs-pip:change イベントは bubbles: true", () => {
      const video = makeVideo();
      installPictureInPictureElement(null);
      const core = new PipCore();
      core.observe(video);
      let captured: CustomEvent | null = null;
      core.addEventListener("wcs-pip:change", (e) => { captured = e as CustomEvent; });

      setPictureInPictureElement(video);
      emitEnter(video);

      expect(captured).not.toBeNull();
      expect(captured!.bubbles).toBe(true);
      expect(captured!.detail).toEqual({ active: true });
    });
  });

  describe("複数インスタンス同時存在での自己判定", () => {
    it("他の video の enterpictureinpicture は自分の active に影響しない", () => {
      const videoA = makeVideo();
      const videoB = makeVideo();
      installPictureInPictureElement(null);
      const coreA = new PipCore();
      const coreB = new PipCore();
      coreA.observe(videoA);
      coreB.observe(videoB);

      setPictureInPictureElement(videoB);
      emitEnter(videoB);

      expect(coreB.active).toBe(true);
      expect(coreA.active).toBe(false);
    });
  });

  describe("target を渡した dispatch 先", () => {
    it("target を渡すとそこへ change を dispatch する", () => {
      const video = makeVideo();
      installPictureInPictureElement(null);
      const target = new EventTarget();
      const events: any[] = [];
      target.addEventListener("wcs-pip:change", (e) => events.push((e as CustomEvent).detail));

      const core = new PipCore(target);
      core.observe(video);
      setPictureInPictureElement(video);
      emitEnter(video);

      expect(events).toEqual([{ active: true }]);
    });
  });

  describe("requestPictureInPicture()", () => {
    it("成功時に enterpictureinpicture 経由で active が true になり error は null", async () => {
      const video = makeVideo();
      installPictureInPictureElement(null);
      const core = new PipCore();
      core.observe(video);

      const promise = core.requestPictureInPicture(video);
      video.__pipResolve!();
      await promise;

      expect(core.error).toBeNull();
    });

    it("tagName が VIDEO でない要素は即座に error になり例外を投げない（never-throw）", async () => {
      const div = document.createElement("div");
      const core = new PipCore();

      await expect(core.requestPictureInPicture(div as any)).resolves.toBeUndefined();
      expect(core.error).toEqual({ message: "target must be a <video> element." });
    });

    it("null を渡しても即座に error になり例外を投げない", async () => {
      const core = new PipCore();
      await expect(core.requestPictureInPicture(null)).resolves.toBeUndefined();
      expect(core.error).toEqual({ message: "target must be a <video> element." });
    });

    it("requestPictureInPicture 関数が無い（unsupported）環境では error に落ちる", async () => {
      const video = makeVideo();
      removeRequestPictureInPicture(video);
      const core = new PipCore();

      await core.requestPictureInPicture(video);

      expect(core.error).toEqual({ message: "Picture-in-Picture API is not supported." });
    });

    it("gesture 外呼び出し相当の reject (NotAllowedError) は never-throw で error に格納される", async () => {
      const video = makeVideo();
      const core = new PipCore();
      const err = new DOMException("Must be handling a user gesture", "NotAllowedError");

      const promise = core.requestPictureInPicture(video);
      video.__pipReject!(err);

      await expect(promise).resolves.toBeUndefined();
      expect(core.error).toBe(err);
    });

    it("_gen 世代ガード: dispose 後に resolve しても error/active を書き換えない", async () => {
      const video = makeVideo();
      installPictureInPictureElement(null);
      const core = new PipCore();
      core.observe(video);

      const promise = core.requestPictureInPicture(video);
      core.dispose();
      video.__pipResolve!();
      await promise;

      expect(core.error).toBeNull();
    });

    it("_gen 世代ガード: dispose 後に reject しても error を書き換えない", async () => {
      const video = makeVideo();
      const core = new PipCore();

      const promise = core.requestPictureInPicture(video);
      core.dispose();
      video.__pipReject!(new Error("boom"));

      await expect(promise).resolves.toBeUndefined();
      expect(core.error).toBeNull();
    });
  });

  describe("exitPictureInPicture()", () => {
    it("何も PiP でない状態では silent no-op（error も立たず例外も出ない）", async () => {
      removePictureInPictureElement();
      installPictureInPictureElement(null);
      const core = new PipCore();

      await expect(core.exitPictureInPicture()).resolves.toBeUndefined();
      expect(core.error).toBeNull();
    });

    it("PiP 中に exit すると成功時 error は null のまま", async () => {
      const video = makeVideo();
      installPictureInPictureElement(video);
      const { resolve } = installExitPictureInPicture();
      const core = new PipCore();

      const promise = core.exitPictureInPicture();
      resolve();
      await promise;

      expect(core.error).toBeNull();
    });

    it("exitPictureInPicture が無い（unsupported）環境では silent no-op", async () => {
      const video = makeVideo();
      installPictureInPictureElement(video);
      removeExitPictureInPicture();
      const core = new PipCore();

      await expect(core.exitPictureInPicture()).resolves.toBeUndefined();
      expect(core.error).toBeNull();
    });

    it("reject されたら never-throw で error に格納される", async () => {
      const video = makeVideo();
      installPictureInPictureElement(video);
      const { reject } = installExitPictureInPicture();
      const core = new PipCore();
      const err = new Error("exit failed");

      const promise = core.exitPictureInPicture();
      reject(err);

      await expect(promise).resolves.toBeUndefined();
      expect(core.error).toBe(err);
    });

    it("_gen 世代ガード: dispose 後に resolve/reject しても error を書き換えない", async () => {
      const video = makeVideo();
      installPictureInPictureElement(video);
      const { reject } = installExitPictureInPicture();
      const core = new PipCore();

      const promise = core.exitPictureInPicture();
      core.dispose();
      reject(new Error("late"));

      await expect(promise).resolves.toBeUndefined();
      expect(core.error).toBeNull();
    });

    it("_gen 世代ガード: dispose 後に resolve しても成功パスで error を書き換えない", async () => {
      const video = makeVideo();
      installPictureInPictureElement(video);
      const { reject } = installExitPictureInPicture();
      const core = new PipCore();

      // 先に error へ非 null な値をセットしておく（後続の stale な resolve が
      // それを誤って null 上書きしないことを検証するため）。
      const firstAttempt = core.exitPictureInPicture();
      reject(new Error("first failure"));
      await firstAttempt;
      expect(core.error).toEqual(new Error("first failure"));

      const { resolve } = installExitPictureInPicture();
      const promise = core.exitPictureInPicture();
      core.dispose();
      resolve();

      await expect(promise).resolves.toBeUndefined();
      expect(core.error).toEqual(new Error("first failure"));
    });
  });

  describe("dispose()", () => {
    it("dispose 後は enterpictureinpicture を受けても active が変わらない", () => {
      const video = makeVideo();
      installPictureInPictureElement(null);
      const core = new PipCore();
      core.observe(video);
      core.dispose();

      setPictureInPictureElement(video);
      emitEnter(video);

      expect(core.active).toBe(false);
    });

    it("一度も observe していない dispose は安全な no-op", () => {
      const core = new PipCore();
      expect(() => core.dispose()).not.toThrow();
    });

    it("dispose→observe で再購読でき、新しい video の状態を反映する", () => {
      const videoA = makeVideo();
      const videoB = makeVideo();
      installPictureInPictureElement(null);
      const core = new PipCore();
      core.observe(videoA);
      core.dispose();

      setPictureInPictureElement(videoB);
      core.observe(videoB);

      expect(core.active).toBe(true);

      emitLeave(videoB);
      setPictureInPictureElement(null);
      // leavepictureinpicture がそのまま発火して active を追従させる
      videoB.dispatchEvent(new Event("leavepictureinpicture"));
      expect(core.active).toBe(false);
    });

    it("observe(null) の状態から dispose しても安全", () => {
      const core = new PipCore();
      core.observe(null);
      expect(() => core.dispose()).not.toThrow();
    });
  });

  describe("wcBindable プロトコル宣言", () => {
    it("properties は active のみ", () => {
      const names = PipCore.wcBindable.properties.map((p) => p.name);
      expect(names).toEqual(["active"]);
    });

    it("active の getter が event.detail.active を読む", () => {
      const prop = PipCore.wcBindable.properties.find((p) => p.name === "active")!;
      const ev = new CustomEvent("wcs-pip:change", { detail: { active: true } });
      expect(prop.getter!(ev)).toBe(true);
    });

    it("commands は requestPictureInPicture/exitPictureInPicture の非同期コマンド2つ", () => {
      expect(PipCore.wcBindable.commands).toEqual([
        { name: "requestPictureInPicture", async: true },
        { name: "exitPictureInPicture", async: true },
      ]);
    });
  });
});
