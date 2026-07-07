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
      let bubbles: boolean | undefined;
      core.addEventListener("wcs-orientation:change", (e) => {
        events.push((e as CustomEvent).detail);
        bubbles = e.bubbles;
      });

      core.observe();

      expect(core.type).toBe("landscape-primary");
      expect(core.angle).toBe(90);
      expect(core.landscape).toBe(true);
      expect(core.portrait).toBe(false);
      expect(events).toEqual([{ type: "landscape-primary", angle: 90 }]);
      // async-io-node-guidelines.md §3.3 MUST: イベントは必ず bubbles: true（族横断で共通）
      expect(bubbles).toBe(true);
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

    it("dispose() は error をリセットしない（sticky — geolocation/wakelock/fullscreen 等と同じ族の支配的パターン）", () => {
      const orientation = installOrientation();
      orientation.unlock = vi.fn(() => {
        throw new Error("boom");
      });
      const core = new ScreenOrientationCore();
      core.observe();
      core.unlock(); // error を確立する
      expect(core.error).toBeInstanceOf(Error);

      core.dispose();

      expect(core.error).toBeInstanceOf(Error);
    });

    it("dispose→observe（再接続）をまたいでも error は保持される（_snapshot は再読込されるが _error は非対称に据え置かれる）", () => {
      const orientation = installOrientation({ type: "portrait-primary" });
      orientation.unlock = vi.fn(() => {
        throw new Error("boom");
      });
      const core = new ScreenOrientationCore();
      core.observe();
      core.unlock();
      expect(core.error).toBeInstanceOf(Error);

      core.dispose();
      installOrientation({ type: "landscape-primary", angle: 90 });
      core.observe();

      expect(core.type).toBe("landscape-primary"); // _snapshot は再読込される
      expect(core.error).toBeInstanceOf(Error); // _error は据え置き（sticky）
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
      let bubbles: boolean | undefined;
      core.addEventListener("wcs-orientation:error", (e) => {
        events.push((e as CustomEvent).detail);
        bubbles = e.bubbles;
      });

      await expect(core.lock("landscape")).resolves.toBeUndefined();
      expect(core.error).toEqual({ name: "NotSupportedError", message: "not supported" });
      expect(events).toHaveLength(1);
      // async-io-node-guidelines.md §3.3 MUST: イベントは必ず bubbles: true（族横断で共通）
      expect(bubbles).toBe(true);
    });

    it("失敗で確立した error は、続く成功した lock() で null にクリアされる", async () => {
      const orientation = installOrientation();
      orientation.lock = vi.fn(() => Promise.reject({ name: "NotSupportedError", message: "not supported" }));
      const core = new ScreenOrientationCore();

      await core.lock("landscape");
      expect(core.error).toEqual({ name: "NotSupportedError", message: "not supported" });

      orientation.lock = vi.fn(() => Promise.resolve());
      await core.lock("portrait");

      expect(core.error).toBeNull();
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

    it("失敗で確立した error は、続く成功した unlock() で null にクリアされる", () => {
      const orientation = installOrientation();
      orientation.unlock = vi.fn(() => {
        throw new Error("boom");
      });
      const core = new ScreenOrientationCore();

      core.unlock();
      expect(core.error).toBeInstanceOf(Error);

      orientation.unlock = vi.fn();
      core.unlock();

      expect(core.error).toBeNull();
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

  describe("unsupported error の同値ガード（共有定数を参照するため repeated call でも再 dispatch しない）", () => {
    it("非対応環境で lock() を連続呼び出しても error イベントは初回のみ dispatch する", async () => {
      removeOrientation();
      const core = new ScreenOrientationCore();
      const events: any[] = [];
      core.addEventListener("wcs-orientation:error", (e) => events.push((e as CustomEvent).detail));

      await core.lock("landscape");
      await core.lock("portrait");

      expect(events).toHaveLength(1);
      expect(core.error).toEqual({ message: "unsupported" });
    });

    it("非対応環境で unlock() を連続呼び出しても error イベントは初回のみ dispatch する", () => {
      removeOrientation();
      const core = new ScreenOrientationCore();
      const events: any[] = [];
      core.addEventListener("wcs-orientation:error", (e) => events.push((e as CustomEvent).detail));

      core.unlock();
      core.unlock();

      expect(events).toHaveLength(1);
    });

    it("非対応環境で lock() の後に unlock() を呼んでも同一の unsupported 値なので再 dispatch しない", async () => {
      removeOrientation();
      const core = new ScreenOrientationCore();
      const events: any[] = [];
      core.addEventListener("wcs-orientation:error", (e) => events.push((e as CustomEvent).detail));

      await core.lock("landscape");
      core.unlock();

      expect(events).toHaveLength(1);
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

    it("unlock() は進行中の lock() の世代を無効化する（stale な reject が unlock() 確立済みの error を上書きしない）", async () => {
      const orientation = installOrientation();
      let rejectFn!: (e: unknown) => void;
      orientation.lock = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectFn = reject; }));
      const core = new ScreenOrientationCore();

      const p = core.lock("landscape");
      core.unlock();
      // unlock() 自身は成功しているので、この時点で error は null
      expect(core.error).toBeNull();

      // stale 化した lock() が後から reject しても、unlock() が確立した error(null) を
      // 上書きしないことを確認する。resolve + null 比較では、_gen++ を欠いた変異体でも
      // 同じ null に落ち着いてしまい弁別できないため（そもそも error が既に null なので
      // 変異体側の再代入が観測不能）、reject で到達可能なエラー値を注入して弁別する。
      rejectFn({ name: "NotSupportedError", message: "stale lock rejection" });
      await p;

      expect(core.error).toBeNull();
    });

    it("unlock() 自身の失敗は独立して error に反映される（_gen とは無関係な経路）", () => {
      const orientation = installOrientation();
      orientation.unlock = vi.fn(() => {
        throw new Error("unlock failed");
      });
      const core = new ScreenOrientationCore();

      core.unlock();

      expect(core.error).toBeInstanceOf(Error);
    });
  });

  describe("観測（monitoring）は _gen を消費しない（§6.1 の非対称性）", () => {
    it("observe() は進行中の lock() の _gen を進めない（監視と command の世代管理が独立していることの検証）", async () => {
      const orientation = installOrientation();
      let rejectFn!: (e: unknown) => void;
      orientation.lock = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectFn = reject; }));
      const core = new ScreenOrientationCore();

      const p = core.lock("landscape");
      // lock() の in-flight 中に observe() を初回（購読パス）と再呼び出し（冪等
      // early-return パス）の両方走らせる。どちらかが _gen を消費する変異体なら
      // この lock() は stale 扱いになり、reject しても error は初期値 null の
      // まま更新されない。注入エラーの「到達」を assert することで弁別する
      // （resolve + null 比較では実装と変異体のどちらも pass してしまう）。
      core.observe();
      core.observe();
      rejectFn({ name: "NotSupportedError", message: "injected after observe()" });
      await p;

      expect(core.error).toEqual({ name: "NotSupportedError", message: "injected after observe()" });
    });
  });

  describe("target 指定", () => {
    it("target を渡すとそこへ change/error を dispatch する", async () => {
      const orientation = installOrientation({ type: "portrait-primary" });
      orientation.lock = vi.fn(() => Promise.reject({ name: "NotSupportedError", message: "not supported" }));
      const target = new EventTarget();
      const changeEvents: any[] = [];
      const errorEvents: any[] = [];
      target.addEventListener("wcs-orientation:change", (e) => changeEvents.push((e as CustomEvent).detail));
      target.addEventListener("wcs-orientation:error", (e) => errorEvents.push((e as CustomEvent).detail));
      const core = new ScreenOrientationCore(target);
      core.observe();

      await core.lock("landscape");

      expect(changeEvents).toHaveLength(1);
      expect(errorEvents).toEqual([{ name: "NotSupportedError", message: "not supported" }]);
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
