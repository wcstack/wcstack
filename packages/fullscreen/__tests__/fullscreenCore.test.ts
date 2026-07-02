import { describe, it, expect, afterEach, vi } from "vitest";
import { FullscreenCore } from "../src/core/FullscreenCore";
import {
  stubRequestFullscreen,
  stubExitFullscreen,
  removeRequestFullscreen,
  removeExitFullscreen,
  setFullscreenElement,
  clearFullscreenElement,
  dispatchFullscreenChange,
  resetFullscreenEnvironment,
} from "./mocks";

describe("FullscreenCore", () => {
  afterEach(() => {
    resetFullscreenEnvironment();
    vi.restoreAllMocks();
  });

  describe("初期状態", () => {
    it("active/error は既定値", () => {
      const core = new FullscreenCore();
      expect(core.active).toBe(false);
      expect(core.error).toBeNull();
    });

    it("ready は即 resolve する（非同期 probe が無いため）", async () => {
      const core = new FullscreenCore();
      await expect(core.ready).resolves.toBeUndefined();
    });
  });

  describe("wcBindable プロトコル宣言", () => {
    it("properties に active のみ、getter が detail.active を取り出す", () => {
      expect(FullscreenCore.wcBindable.properties).toHaveLength(1);
      const prop = FullscreenCore.wcBindable.properties[0];
      expect(prop.name).toBe("active");
      expect(prop.event).toBe("wcs-fullscreen:change");
      const ev = new CustomEvent("wcs-fullscreen:change", { detail: { active: true } });
      expect(prop.getter!(ev)).toBe(true);
    });

    it("commands に requestFullscreen/exitFullscreen が async 宣言される", () => {
      const commands = FullscreenCore.wcBindable.commands!;
      expect(commands).toEqual([
        { name: "requestFullscreen", async: true },
        { name: "exitFullscreen", async: true },
      ]);
    });
  });

  describe("requestFullscreen() — 成功", () => {
    it("成功時に fullscreenchange 経由で active: true になる", async () => {
      const el = document.createElement("div");
      stubRequestFullscreen(el);
      const core = new FullscreenCore();
      core.observe();
      const events: any[] = [];
      core.addEventListener("wcs-fullscreen:change", (e) => events.push((e as CustomEvent).detail));

      await core.requestFullscreen(el);

      expect(core.active).toBe(true);
      expect(core.error).toBeNull();
      expect(events).toEqual([{ active: true }]);
    });

    it("target を渡すとそこへ change を dispatch する", async () => {
      const el = document.createElement("div");
      stubRequestFullscreen(el);
      const target = new EventTarget();
      const events: any[] = [];
      target.addEventListener("wcs-fullscreen:change", (e) => events.push((e as CustomEvent).detail));

      const core = new FullscreenCore(target);
      core.observe();
      await core.requestFullscreen(el);

      expect(events).toEqual([{ active: true }]);
    });
  });

  describe("requestFullscreen() — gesture 外呼び出し想定の reject", () => {
    it("NotAllowedError で reject しても never-throw で error に格納する", async () => {
      const el = document.createElement("div");
      const notAllowed = new Error("Permission denied");
      notAllowed.name = "NotAllowedError";
      stubRequestFullscreen(el, { rejectWith: notAllowed });
      const core = new FullscreenCore();
      core.observe();

      await expect(core.requestFullscreen(el)).resolves.toBeUndefined();

      expect(core.error).toBe(notAllowed);
      expect(core.active).toBe(false);
    });
  });

  describe("requestFullscreen() — unsupported", () => {
    it("標準 API・レガシー API ともに無い場合は error へ落ちる", async () => {
      const el = document.createElement("div");
      removeRequestFullscreen(el);
      const core = new FullscreenCore();
      core.observe();

      await core.requestFullscreen(el);

      expect(core.error).toEqual({ message: "Fullscreen API is not supported." });
      expect(core.active).toBe(false);
    });

    it("target 要素が null（未解決）の場合も error へ落ちる", async () => {
      const core = new FullscreenCore();
      core.observe();

      await core.requestFullscreen(null);

      expect(core.error).toEqual({ message: "Fullscreen API is not supported." });
      expect(core.active).toBe(false);
    });
  });

  describe("requestFullscreen() — レガシー API のみ存在", () => {
    it("webkitRequestFullscreen のみでも解決できる", async () => {
      const el = document.createElement("div");
      stubRequestFullscreen(el, { legacy: true });
      const core = new FullscreenCore();
      core.observe();

      await core.requestFullscreen(el);

      expect(core.active).toBe(true);
      expect(core.error).toBeNull();
    });
  });

  describe("複数インスタンス同時存在（§2.1 MUST）", () => {
    it("#a が fullscreen 化された場合、#a を target にしたインスタンスのみ active: true になる", async () => {
      const a = document.createElement("div");
      a.id = "a";
      const b = document.createElement("div");
      b.id = "b";
      stubRequestFullscreen(a);

      const coreA = new FullscreenCore();
      const coreB = new FullscreenCore();
      coreA.observe();
      coreB.observe();
      coreB.setTarget(b);

      await coreA.requestFullscreen(a);

      expect(coreA.active).toBe(true);
      expect(coreB.active).toBe(false);
    });

    it("同一 fullscreenchange を両方が受信しても、targetが一致するインスタンスだけが active になる", async () => {
      const a = document.createElement("div");
      const b = document.createElement("div");
      stubRequestFullscreen(a);

      const coreA = new FullscreenCore();
      const coreB = new FullscreenCore();
      coreA.observe();
      coreB.observe();
      coreA.setTarget(a);
      coreB.setTarget(b);

      // fullscreenchange は document 単位のイベント。両方の Core が同じイベントを
      // 受信することを、直接 dispatch して検証する。
      setFullscreenElement(a);
      dispatchFullscreenChange();

      expect(coreA.active).toBe(true);
      expect(coreB.active).toBe(false);
    });
  });

  describe("exitFullscreen() — 何もfullscreenでない状態", () => {
    it("silent no-op（error が立たず例外も出ない）", async () => {
      clearFullscreenElement();
      const core = new FullscreenCore();
      core.observe();

      await expect(core.exitFullscreen()).resolves.toBeUndefined();

      expect(core.error).toBeNull();
      expect(core.active).toBe(false);
    });

    it("unsupported（exitFullscreen も webkitExitFullscreen も無い）でも silent no-op", async () => {
      const el = document.createElement("div");
      stubRequestFullscreen(el);
      removeExitFullscreen();
      const core = new FullscreenCore();
      core.observe();
      await core.requestFullscreen(el);
      expect(core.active).toBe(true);

      await expect(core.exitFullscreen()).resolves.toBeUndefined();

      expect(core.error).toBeNull();
    });
  });

  describe("exitFullscreen() — 成功", () => {
    it("成功時に fullscreenchange 経由で active: false になる", async () => {
      const el = document.createElement("div");
      stubRequestFullscreen(el);
      stubExitFullscreen();
      const core = new FullscreenCore();
      core.observe();
      await core.requestFullscreen(el);
      expect(core.active).toBe(true);

      await core.exitFullscreen();

      expect(core.active).toBe(false);
      expect(core.error).toBeNull();
    });

    it("レガシー webkitExitFullscreen のみでも解決できる", async () => {
      const el = document.createElement("div");
      stubRequestFullscreen(el, { legacy: true });
      stubExitFullscreen({ legacy: true });
      const core = new FullscreenCore();
      core.observe();
      await core.requestFullscreen(el);
      expect(core.active).toBe(true);

      await core.exitFullscreen();

      expect(core.active).toBe(false);
    });
  });

  describe("exitFullscreen() — reject", () => {
    it("reject しても never-throw で error に格納する", async () => {
      const el = document.createElement("div");
      stubRequestFullscreen(el);
      const failure = new Error("exit failed");
      stubExitFullscreen({ rejectWith: failure });
      const core = new FullscreenCore();
      core.observe();
      await core.requestFullscreen(el);

      await expect(core.exitFullscreen()).resolves.toBeUndefined();

      expect(core.error).toBe(failure);
    });
  });

  describe("_gen 世代ガード", () => {
    it("dispose 後に requestFullscreen() の Promise が resolve しても状態を書き換えない", async () => {
      const el = document.createElement("div");
      let resolveFn: (() => void) | undefined;
      (el as any).requestFullscreen = () => new Promise<void>((resolve) => { resolveFn = resolve; });
      const core = new FullscreenCore();
      core.observe();

      const p = core.requestFullscreen(el);
      core.dispose();
      setFullscreenElement(el);
      resolveFn!();
      await p;

      expect(core.active).toBe(false);
      expect(core.error).toBeNull();
    });

    it("dispose 後に requestFullscreen() の Promise が reject しても状態を書き換えない", async () => {
      const el = document.createElement("div");
      let rejectFn: ((e: any) => void) | undefined;
      (el as any).requestFullscreen = () => new Promise<void>((_resolve, reject) => { rejectFn = reject; });
      const core = new FullscreenCore();
      core.observe();

      const p = core.requestFullscreen(el);
      core.dispose();
      rejectFn!(new Error("late failure"));
      await p;

      expect(core.error).toBeNull();
    });

    it("dispose 後に exitFullscreen() の Promise が resolve しても状態を書き換えない", async () => {
      const el = document.createElement("div");
      stubRequestFullscreen(el);
      const core = new FullscreenCore();
      core.observe();
      await core.requestFullscreen(el);

      let resolveFn: (() => void) | undefined;
      (document as any).exitFullscreen = () => new Promise<void>((resolve) => { resolveFn = resolve; });

      const p = core.exitFullscreen();
      core.dispose();
      clearFullscreenElement();
      resolveFn!();
      await p;

      // dispose() 後は active の書き換えが起きない = fullscreenchange リスナーも
      // 解除済みなので直前の true のままであることを確認する。
      expect(core.active).toBe(true);
    });

    it("dispose 後に exitFullscreen() の Promise が reject しても状態を書き換えない", async () => {
      const el = document.createElement("div");
      stubRequestFullscreen(el);
      const core = new FullscreenCore();
      core.observe();
      await core.requestFullscreen(el);

      let rejectFn: ((e: any) => void) | undefined;
      (document as any).exitFullscreen = () => new Promise<void>((_resolve, reject) => { rejectFn = reject; });

      const p = core.exitFullscreen();
      core.dispose();
      rejectFn!(new Error("late exit failure"));
      await p;

      // stale gen のため error は書き換えられない。
      expect(core.error).toBeNull();
    });
  });

  describe("observe()/dispose() の冪等性", () => {
    it("observe() の二重呼び出しでリスナーが二重登録されない", async () => {
      const el = document.createElement("div");
      stubRequestFullscreen(el);
      const addSpy = vi.spyOn(document, "addEventListener");
      const core = new FullscreenCore();

      core.observe();
      core.observe();

      const fullscreenCalls = addSpy.mock.calls.filter((c) => c[0] === "fullscreenchange");
      expect(fullscreenCalls).toHaveLength(1);
    });

    it("dispose 後の再 observe でリスナーが復活する", async () => {
      const el = document.createElement("div");
      stubRequestFullscreen(el);
      const core = new FullscreenCore();
      core.observe();
      core.dispose();
      core.observe();

      await core.requestFullscreen(el);

      expect(core.active).toBe(true);
    });

    it("一度も observe していない dispose は安全な no-op", () => {
      const core = new FullscreenCore();
      expect(() => core.dispose()).not.toThrow();
    });

    it("dispose の二重呼び出しでリスナー解除も二重に行われない", () => {
      const removeSpy = vi.spyOn(document, "removeEventListener");
      const core = new FullscreenCore();
      core.observe();
      core.dispose();
      core.dispose();

      const fullscreenCalls = removeSpy.mock.calls.filter((c) => c[0] === "fullscreenchange");
      expect(fullscreenCalls).toHaveLength(1);
    });
  });

  describe("setTarget()", () => {
    it("target 未解決（null）の場合は active が常に false", () => {
      const core = new FullscreenCore();
      core.observe();
      core.setTarget(null);
      setFullscreenElement(document.createElement("div"));

      // setTarget(null) 自体は fullscreenElement と比較しても一致しないため false のまま。
      expect(core.active).toBe(false);
    });

    it("setTarget で target を変更すると現在の fullscreenElement と再評価される", () => {
      const a = document.createElement("div");
      const b = document.createElement("div");
      setFullscreenElement(a);
      const core = new FullscreenCore();
      core.observe();

      core.setTarget(a);
      expect(core.active).toBe(true);

      core.setTarget(b);
      expect(core.active).toBe(false);
    });

    it("同値の active では change イベントが再発火しない（同値ガード）", () => {
      const a = document.createElement("div");
      setFullscreenElement(a);
      const core = new FullscreenCore();
      core.observe();
      core.setTarget(a);
      expect(core.active).toBe(true);

      const events: any[] = [];
      core.addEventListener("wcs-fullscreen:change", (e) => events.push((e as CustomEvent).detail));
      core.setTarget(a);

      expect(events).toEqual([]);
    });
  });

  describe("_fullscreenChangeEventName() — レガシー環境（onfullscreenchange 不在）", () => {
    it("標準の onfullscreenchange が無ければ webkitfullscreenchange を購読する", async () => {
      // "onfullscreenchange" は happy-dom のプロトタイプチェーン上にある own
      // property なので、document 自身に defineProperty しても `in` 演算子の
      // 判定は変わらない。プロトタイプチェーンを遡って所有者を見つけ、一時的に
      // 削除してからテスト後に必ず復元する。
      let proto: any = document;
      while (proto && !Object.prototype.hasOwnProperty.call(proto, "onfullscreenchange")) {
        proto = Object.getPrototypeOf(proto);
      }
      expect(proto).toBeTruthy();
      const descriptor = Object.getOwnPropertyDescriptor(proto, "onfullscreenchange");
      expect(descriptor).toBeDefined();
      delete proto.onfullscreenchange;
      try {
        expect("onfullscreenchange" in document).toBe(false);

        const el = document.createElement("div");
        stubRequestFullscreen(el, { legacy: true });
        const addSpy = vi.spyOn(document, "addEventListener");
        const core = new FullscreenCore();

        core.observe();

        expect(addSpy).toHaveBeenCalledWith("webkitfullscreenchange", expect.any(Function));

        await core.requestFullscreen(el);
        expect(core.active).toBe(true);

        core.dispose();
        const removeSpy = vi.spyOn(document, "removeEventListener");
        core.observe();
        core.dispose();
        expect(removeSpy).toHaveBeenCalledWith("webkitfullscreenchange", expect.any(Function));
      } finally {
        Object.defineProperty(proto, "onfullscreenchange", descriptor!);
      }
    });
  });
});
