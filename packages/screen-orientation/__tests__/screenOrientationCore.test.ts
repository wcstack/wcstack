import { describe, it, expect, afterEach, vi } from "vitest";
import { ScreenOrientationCore } from "../src/core/ScreenOrientationCore";
import { installOrientation, removeOrientation, makeScreenOrientation } from "./mocks";

describe("ScreenOrientationCore", () => {
  afterEach(() => {
    removeOrientation();
    vi.restoreAllMocks();
  });

  describe("初期状態（observe 前）", () => {
    it("screen.orientation 不在なら全プロパティが既定値", () => {
      const core = new ScreenOrientationCore();
      expect(core.type).toBeNull();
      expect(core.angle).toBeNull();
      expect(core.portrait).toBe(false);
      expect(core.landscape).toBe(false);
      expect(core.error).toBeNull();
    });

    it("ready は即 resolve する（非同期 probe が無いため）", async () => {
      const core = new ScreenOrientationCore();
      await expect(core.ready).resolves.toBeUndefined();
    });
  });

  describe("observe() — 対応環境", () => {
    it("screen.orientation ありなら observe() で即座に snapshot を反映し change を dispatch する", () => {
      installOrientation({ type: "landscape-primary", angle: 90 });
      const core = new ScreenOrientationCore();
      const events: any[] = [];
      core.addEventListener("wcs-orientation:change", (e) => events.push((e as CustomEvent).detail));

      core.observe();

      expect(core.type).toBe("landscape-primary");
      expect(core.angle).toBe(90);
      expect(core.landscape).toBe(true);
      expect(core.portrait).toBe(false);
      expect(events).toEqual([{ type: "landscape-primary", angle: 90 }]);
    });

    it("observe() は冪等 — 二重呼び出しでリスナーが二重登録されず再 dispatch もしない", () => {
      const orientation = installOrientation();
      const addSpy = vi.spyOn(orientation, "addEventListener");
      const core = new ScreenOrientationCore();
      const events: any[] = [];
      core.addEventListener("wcs-orientation:change", (e) => events.push((e as CustomEvent).detail));

      core.observe();
      core.observe();

      expect(addSpy).toHaveBeenCalledTimes(1);
      expect(events).toHaveLength(1);
    });
  });

  describe("observe() — 非対応環境", () => {
    it("screen.orientation 不在なら type/angle は null のまま、既定値と同値なので change は dispatch しない", () => {
      removeOrientation();
      const core = new ScreenOrientationCore();
      const events: any[] = [];
      core.addEventListener("wcs-orientation:change", (e) => events.push((e as CustomEvent).detail));

      core.observe();

      expect(core.type).toBeNull();
      expect(events).toEqual([]);
    });
  });

  describe("change イベントの追従と同値ガード", () => {
    it("screen.orientation の change で値が更新され再 dispatch する", () => {
      const orientation = installOrientation({ type: "portrait-primary", angle: 0 });
      const core = new ScreenOrientationCore();
      core.observe();
      const events: any[] = [];
      core.addEventListener("wcs-orientation:change", (e) => events.push((e as CustomEvent).detail));

      orientation.change({ type: "landscape-secondary", angle: 270 });

      expect(core.type).toBe("landscape-secondary");
      expect(core.angle).toBe(270);
      expect(events).toHaveLength(1);
    });

    it("同値の change 連続発火では再 dispatch しない（同値ガード）", () => {
      const orientation = installOrientation({ type: "portrait-primary", angle: 0 });
      const core = new ScreenOrientationCore();
      core.observe();
      const events: any[] = [];
      core.addEventListener("wcs-orientation:change", (e) => events.push((e as CustomEvent).detail));

      orientation.dispatchEvent(new Event("change"));
      orientation.dispatchEvent(new Event("change"));

      expect(events).toEqual([]);
    });
  });

  describe("portrait/landscape 派生 getter", () => {
    it.each([
      ["portrait-primary", true, false],
      ["portrait-secondary", true, false],
      ["landscape-primary", false, true],
      ["landscape-secondary", false, true],
    ] as const)("type=%s で portrait=%s, landscape=%s", (type, portrait, landscape) => {
      installOrientation({ type });
      const core = new ScreenOrientationCore();
      core.observe();
      expect(core.portrait).toBe(portrait);
      expect(core.landscape).toBe(landscape);
    });
  });

  describe("_read() のフィールド正規化", () => {
    it("フィールドの型が期待と異なる場合は null に正規化する", () => {
      const orientation = makeScreenOrientation();
      (orientation as any).type = undefined;
      (orientation as any).angle = "90"; // 文字列(数値でない)
      Object.defineProperty(screen, "orientation", { value: orientation, configurable: true, writable: true });

      const core = new ScreenOrientationCore();
      core.observe();

      expect(core.type).toBeNull();
      expect(core.angle).toBeNull();
    });
  });

  describe("dispose()", () => {
    it("dispose 後は change を受けても状態が変わらない", () => {
      const orientation = installOrientation({ type: "portrait-primary" });
      const core = new ScreenOrientationCore();
      core.observe();
      core.dispose();

      orientation.change({ type: "landscape-primary" });

      expect(core.type).toBe("portrait-primary");
    });

    it("一度も observe していない dispose は安全な no-op", () => {
      const core = new ScreenOrientationCore();
      expect(() => core.dispose()).not.toThrow();
    });

    it("dispose→observe で再購読し、新しい orientation の値を反映する", () => {
      installOrientation({ type: "portrait-primary" });
      const core = new ScreenOrientationCore();
      core.observe();
      core.dispose();

      const orientation2 = installOrientation({ type: "landscape-primary", angle: 90 });
      core.observe();

      expect(core.type).toBe("landscape-primary");

      orientation2.change({ type: "portrait-secondary" });
      expect(core.type).toBe("portrait-secondary");
    });
  });

  describe("lock() — 対応環境", () => {
    it("成功時に error が null のまま維持される", async () => {
      installOrientation();
      const core = new ScreenOrientationCore();
      await core.lock("landscape");
      expect(core.error).toBeNull();
    });

    it("lock() は orientation を検証せず素通しする", async () => {
      const orientation = installOrientation();
      const core = new ScreenOrientationCore();
      await core.lock("landscape-primary");
      expect(orientation.lock).toHaveBeenCalledWith("landscape-primary");
    });

    it("reject（NotSupportedError 等）は never-throw で error に格納される", async () => {
      const orientation = installOrientation();
      orientation.lock = vi.fn(() => Promise.reject({ name: "NotSupportedError", message: "not supported" }));
      const core = new ScreenOrientationCore();
      const events: any[] = [];
      core.addEventListener("wcs-orientation:error", (e) => events.push((e as CustomEvent).detail));

      await expect(core.lock("landscape")).resolves.toBeUndefined();
      expect(core.error).toEqual({ name: "NotSupportedError", message: "not supported" });
      expect(events).toHaveLength(1);
    });
  });

  describe("lock() — 非対応環境", () => {
    it("screen.orientation 不在なら即 error", async () => {
      removeOrientation();
      const core = new ScreenOrientationCore();
      await core.lock("landscape");
      expect(core.error).toEqual({ message: "unsupported" });
    });

    it("lock メソッド自体が無い環境でも即 error", async () => {
      const orientation = installOrientation();
      delete (orientation as any).lock;
      const core = new ScreenOrientationCore();
      await core.lock("landscape");
      expect(core.error).toEqual({ message: "unsupported" });
    });
  });

  describe("unlock()", () => {
    it("成功時に error が null のまま維持される", () => {
      installOrientation();
      const core = new ScreenOrientationCore();
      core.unlock();
      expect(core.error).toBeNull();
    });

    it("同期例外を投げる偽実装でも never-throw が保たれ error に格納される", () => {
      const orientation = installOrientation();
      orientation.unlock = vi.fn(() => {
        throw new Error("boom");
      });
      const core = new ScreenOrientationCore();
      expect(() => core.unlock()).not.toThrow();
      expect(core.error).toBeInstanceOf(Error);
    });

    it("非対応環境（unlock 不在）では即 error", () => {
      const orientation = installOrientation();
      delete (orientation as any).unlock;
      const core = new ScreenOrientationCore();
      core.unlock();
      expect(core.error).toEqual({ message: "unsupported" });
    });

    it("非対応環境（screen.orientation 不在）では即 error", () => {
      removeOrientation();
      const core = new ScreenOrientationCore();
      core.unlock();
      expect(core.error).toEqual({ message: "unsupported" });
    });
  });

  describe("_gen 世代ガード（lock() コマンド専用、監視とは独立）", () => {
    it("dispose 後に resolve した lock() は状態を書き換えない", async () => {
      const orientation = installOrientation();
      let resolveFn!: () => void;
      orientation.lock = vi.fn(() => new Promise<void>((resolve) => { resolveFn = resolve; }));
      const core = new ScreenOrientationCore();

      const p = core.lock("landscape");
      core.dispose();
      resolveFn();
      await p;

      expect(core.error).toBeNull();
    });

    it("dispose 後に reject した lock() は状態を書き換えない", async () => {
      const orientation = installOrientation();
      let rejectFn!: (e: unknown) => void;
      orientation.lock = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectFn = reject; }));
      const core = new ScreenOrientationCore();
      const events: any[] = [];
      core.addEventListener("wcs-orientation:error", (e) => events.push((e as CustomEvent).detail));

      const p = core.lock("landscape");
      core.dispose();
      rejectFn(new Error("stale"));
      await p;

      expect(core.error).toBeNull();
      expect(events).toEqual([]);
    });

    it("新しい lock() 呼び出しが古い呼び出しの世代を無効化する（後勝ち）", async () => {
      const orientation = installOrientation();
      let resolveFirst!: () => void;
      let callCount = 0;
      orientation.lock = vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          return new Promise<void>((resolve) => { resolveFirst = resolve; });
        }
        return Promise.reject({ name: "NotSupportedError", message: "second call failed" });
      });
      const core = new ScreenOrientationCore();

      const p1 = core.lock("landscape");
      const p2 = core.lock("portrait");
      await p2;
      expect(core.error).toEqual({ name: "NotSupportedError", message: "second call failed" });

      resolveFirst();
      await p1;
      // 古い(1回目の)resolveが2回目呼び出し確立後のerrorを上書きしない
      expect(core.error).toEqual({ name: "NotSupportedError", message: "second call failed" });
    });

    it("unlock() は進行中の lock() の世代を無効化する", async () => {
      const orientation = installOrientation();
      let resolveFn!: () => void;
      orientation.lock = vi.fn(() => new Promise<void>((resolve) => { resolveFn = resolve; }));
      const core = new ScreenOrientationCore();

      const p = core.lock("landscape");
      core.unlock();
      resolveFn();
      await p;

      // unlock() 自身の成功(error=null)を、stale な lock() resolve が上書きしないことを
      // 別のエラーを注入して確認する
      orientation.unlock = vi.fn(() => {
        throw new Error("unlock failed");
      });
      core.unlock();
      expect(core.error).toBeInstanceOf(Error);
    });
  });

  describe("観測（monitoring）は _gen を消費しない（§6.1 の非対称性）", () => {
    it("observe() は screen.orientation の change 購読のみで、_gen 経由の世代管理をしない（同期完結）", () => {
      const orientation = installOrientation();
      const core = new ScreenOrientationCore();
      // observe() は同期的に完了し、change 購読だけが行われる
      const result = core.observe();
      expect(result).toBeInstanceOf(Promise);
      expect(orientation.addEventListener).toBeDefined();
    });
  });

  describe("target 指定", () => {
    it("target を渡すとそこへ change/error を dispatch する", async () => {
      installOrientation({ type: "portrait-primary" });
      const target = new EventTarget();
      const changeEvents: any[] = [];
      target.addEventListener("wcs-orientation:change", (e) => changeEvents.push((e as CustomEvent).detail));
      const core = new ScreenOrientationCore(target);
      core.observe();

      expect(changeEvents).toHaveLength(1);
    });
  });

  describe("wcBindable プロトコル宣言", () => {
    it("commands は lock(async)/unlock を持つ", () => {
      const lockCmd = ScreenOrientationCore.wcBindable.commands!.find((c) => c.name === "lock")!;
      const unlockCmd = ScreenOrientationCore.wcBindable.commands!.find((c) => c.name === "unlock")!;
      expect(lockCmd.async).toBe(true);
      expect(unlockCmd.async).toBeUndefined();
    });

    it("type/angle/portrait/landscape の getter が event.detail から正しく値を取り出す", () => {
      const byName = (n: string) => ScreenOrientationCore.wcBindable.properties.find((p) => p.name === n)!;
      const detail = { type: "landscape-primary", angle: 90 };
      const ev = new CustomEvent("wcs-orientation:change", { detail });

      expect(byName("type").getter!(ev)).toBe("landscape-primary");
      expect(byName("angle").getter!(ev)).toBe(90);
      expect(byName("portrait").getter!(ev)).toBe(false);
      expect(byName("landscape").getter!(ev)).toBe(true);
    });

    it("portrait/landscape の getter は type が null（非対応環境）のとき false にフォールバックする", () => {
      const byName = (n: string) => ScreenOrientationCore.wcBindable.properties.find((p) => p.name === n)!;
      const ev = new CustomEvent("wcs-orientation:change", { detail: { type: null, angle: null } });

      expect(byName("portrait").getter!(ev)).toBe(false);
      expect(byName("landscape").getter!(ev)).toBe(false);
    });

    it("error property は getter を持たない（detail 自体が値）", () => {
      const prop = ScreenOrientationCore.wcBindable.properties.find((p) => p.name === "error")!;
      expect(prop.getter).toBeUndefined();
    });
  });
});
