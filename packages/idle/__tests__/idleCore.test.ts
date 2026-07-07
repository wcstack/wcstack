import { describe, it, expect, afterEach, vi } from "vitest";
import { IdleCore } from "../src/core/IdleCore";
import { installIdleDetector, removeIdleDetector } from "./mocks";

describe("IdleCore", () => {
  afterEach(() => {
    removeIdleDetector();
    vi.restoreAllMocks();
  });

  it("EventTarget を継承している", () => {
    const core = new IdleCore();
    expect(core).toBeInstanceOf(EventTarget);
  });

  describe("wcBindable プロトコル宣言", () => {
    it("properties が userState/screenState/active/error を宣言している", () => {
      const names = IdleCore.wcBindable.properties.map((p) => p.name);
      expect(names).toEqual(["userState", "screenState", "active", "error"]);
    });

    it("commands が requestPermission(async)/start(async)/stop を宣言している", () => {
      const commands = IdleCore.wcBindable.commands!;
      expect(commands.map((c) => c.name)).toEqual(["requestPermission", "start", "stop"]);
      expect(commands.find((c) => c.name === "requestPermission")!.async).toBe(true);
      expect(commands.find((c) => c.name === "start")!.async).toBe(true);
      expect(commands.find((c) => c.name === "stop")!.async).toBeUndefined();
    });

    it("userState/screenState の getter が event.detail から値を取り出す", () => {
      const byName = (n: string) => IdleCore.wcBindable.properties.find((p) => p.name === n)!;
      const ev = new CustomEvent("wcs-idle:change", { detail: { userState: "idle", screenState: "locked" } });
      expect(byName("userState").getter!(ev)).toBe("idle");
      expect(byName("screenState").getter!(ev)).toBe("locked");
    });

    it("active の getter が userState==='active' から派生する", () => {
      const prop = IdleCore.wcBindable.properties.find((p) => p.name === "active")!;
      const ev = new CustomEvent("wcs-idle:change", { detail: { userState: "active", screenState: "unlocked" } });
      expect(prop.getter!(ev)).toBe(true);
      const ev2 = new CustomEvent("wcs-idle:change", { detail: { userState: "idle", screenState: "unlocked" } });
      expect(prop.getter!(ev2)).toBe(false);
    });

    it("4値のpermission状態は一切公開しない（<wcs-permission>との合成前提）", () => {
      const names = IdleCore.wcBindable.properties.map((p) => p.name);
      expect(names).not.toContain("granted");
      expect(names).not.toContain("denied");
      expect(names).not.toContain("prompt");
      expect(names).not.toContain("unsupported");
    });
  });

  describe("初期状態", () => {
    it("userState/screenState/active/error が既定値", () => {
      const core = new IdleCore();
      expect(core.userState).toBeNull();
      expect(core.screenState).toBeNull();
      expect(core.active).toBe(false);
      expect(core.error).toBeNull();
    });

    it("ready は即 resolve する（connect 時に自動 start しないため）", async () => {
      const core = new IdleCore();
      await expect(core.ready).resolves.toBeUndefined();
    });

    it("observe() は同期的な no-op で start() を自動的に呼ばない", () => {
      const { instances } = installIdleDetector();
      const core = new IdleCore();
      core.observe();
      expect(instances).toHaveLength(0);
    });
  });

  describe("requestPermission()", () => {
    it("成功時に 'granted' を返す", async () => {
      installIdleDetector({ requestPermission: () => Promise.resolve("granted") });
      const core = new IdleCore();
      await expect(core.requestPermission()).resolves.toBe("granted");
      expect(core.error).toBeNull();
    });

    it("事前に error が無い clean な成功時は wcs-idle:error を一度も発火しない（同値ガード）", async () => {
      installIdleDetector({ requestPermission: () => Promise.resolve("granted") });
      const core = new IdleCore();
      const events: any[] = [];
      core.addEventListener("wcs-idle:error", (e) => events.push((e as CustomEvent).detail));
      await core.requestPermission();
      expect(core.error).toBeNull();
      expect(events).toEqual([]);
    });

    it("拒否時に 'denied' を返す", async () => {
      installIdleDetector({ requestPermission: () => Promise.resolve("denied") });
      const core = new IdleCore();
      await expect(core.requestPermission()).resolves.toBe("denied");
      expect(core.error).toBeNull(); // 例外なしの denied は error を立てない
    });

    it("gesture 文脈外呼び出し等の reject は never-throw で 'denied' に倒し error に格納する", async () => {
      installIdleDetector({ requestPermission: () => Promise.reject(new Error("not in a user gesture")) });
      const core = new IdleCore();
      const result = await core.requestPermission();
      expect(result).toBe("denied");
      expect(core.error).not.toBeNull();
    });

    it("reject 時の wcs-idle:error は { error } 形状の detail で発火する", async () => {
      installIdleDetector({ requestPermission: () => Promise.reject(new Error("not in a user gesture")) });
      const core = new IdleCore();
      const events: any[] = [];
      core.addEventListener("wcs-idle:error", (e) => events.push((e as CustomEvent).detail));
      await core.requestPermission();
      expect(events).toEqual([{ error: expect.any(Error) }]);
    });

    it("直前の error がある状態で requestPermission() が成功すると error が null にクリアされる（start() との対称性）", async () => {
      installIdleDetector({ requestPermission: () => Promise.reject(new Error("not in a user gesture")) });
      const core = new IdleCore();
      await core.requestPermission();
      expect(core.error).not.toBeNull();

      installIdleDetector({ requestPermission: () => Promise.resolve("granted") });
      const events: any[] = [];
      core.addEventListener("wcs-idle:error", (e) => events.push((e as CustomEvent).detail));
      const result = await core.requestPermission();

      expect(result).toBe("granted");
      expect(core.error).toBeNull();
      expect(events).toEqual([null]);
    });

    it("unsupported 環境（IdleDetector 不在）では即 'denied' で error に落ちる", async () => {
      removeIdleDetector();
      const core = new IdleCore();
      const result = await core.requestPermission();
      expect(result).toBe("denied");
      expect(core.error).toEqual({ message: "IdleDetector is not supported in this browser" });
    });
  });

  describe("start() — 対応環境", () => {
    it("start() でセンサーが構築され change 経由で userState/screenState が反映される", async () => {
      const { instances } = installIdleDetector();
      const core = new IdleCore();
      await core.start(60000);

      expect(instances).toHaveLength(1);
      expect(instances[0].start).toHaveBeenCalledWith({ threshold: 60000, signal: expect.any(AbortSignal) });
      expect(core.userState).toBe("active");
      expect(core.screenState).toBe("unlocked");
      expect(core.active).toBe(true);
    });

    it("事前に error が無い clean な start() 成功時は wcs-idle:error を一度も発火しない（同値ガード）", async () => {
      installIdleDetector();
      const core = new IdleCore();
      const events: any[] = [];
      core.addEventListener("wcs-idle:error", (e) => events.push((e as CustomEvent).detail));
      await core.start();
      expect(core.error).toBeNull();
      expect(events).toEqual([]);
    });

    it("threshold 省略時は 60000 が既定値として渡る", async () => {
      const { instances } = installIdleDetector();
      const core = new IdleCore();
      await core.start();
      expect(instances[0].start).toHaveBeenCalledWith({ threshold: 60000, signal: expect.any(AbortSignal) });
    });

    it("change イベントで userState/screenState が更新され続ける", async () => {
      const { instances } = installIdleDetector();
      const core = new IdleCore();
      await core.start();

      instances[0].emitChange("idle", "locked");
      expect(core.userState).toBe("idle");
      expect(core.screenState).toBe("locked");
      expect(core.active).toBe(false);
    });

    it("同値の change 連続発火では再 dispatch しない（同値ガード）", async () => {
      const { instances } = installIdleDetector();
      const core = new IdleCore();
      await core.start();
      const events: any[] = [];
      core.addEventListener("wcs-idle:change", (e) => events.push((e as CustomEvent).detail));

      instances[0].emitChange("active", "unlocked"); // 現状と同値
      expect(events).toEqual([]);
    });

    it("userState は同値のまま screenState だけ変化した場合は change が発火する（&& ガードの検証）", async () => {
      const { instances } = installIdleDetector();
      const core = new IdleCore();
      await core.start(); // 既定: active/unlocked
      const events: any[] = [];
      core.addEventListener("wcs-idle:change", (e) => events.push((e as CustomEvent).detail));

      instances[0].emitChange("active", "locked"); // userState は同値、screenState のみ変化
      expect(events).toHaveLength(1);
      expect(core.userState).toBe("active");
      expect(core.screenState).toBe("locked");
    });

    it("直前に error がある状態で start() が成功すると error が null にクリアされ wcs-idle:error(detail=null) が発火する", async () => {
      removeIdleDetector();
      const core = new IdleCore();
      await core.start(); // unsupported → error セット
      expect(core.error).not.toBeNull();

      installIdleDetector();
      const events: any[] = [];
      core.addEventListener("wcs-idle:error", (e) => events.push((e as CustomEvent).detail));
      await core.start();

      expect(core.error).toBeNull();
      expect(events).toEqual([null]);
    });

    it("2回目の start() は進行中のセッションを止めてから開始する（供給過多の防止）", async () => {
      const { instances } = installIdleDetector();
      const core = new IdleCore();
      await core.start();
      await core.start();
      expect(instances).toHaveLength(2);
    });
  });

  describe("start() — 非対応環境", () => {
    it("IdleDetector 不在なら即 error に落ち userState は変化しない", async () => {
      removeIdleDetector();
      const core = new IdleCore();
      await core.start();
      expect(core.error).toEqual({ message: "IdleDetector is not supported in this browser" });
      expect(core.userState).toBeNull();
    });
  });

  describe("start() — reject/例外", () => {
    it("start() の reject（AbortError 以外）は error に格納される", async () => {
      installIdleDetector({ startImpl: () => Promise.reject(new Error("boom")) });
      const core = new IdleCore();
      await core.start();
      expect(core.error).toEqual({ error: expect.any(Error) });
      expect(core.userState).toBeNull();
    });

    it("name プロパティを持たない値（nullish）で reject されても error に落ちる", async () => {
      installIdleDetector({ startImpl: () => Promise.reject(undefined) });
      const core = new IdleCore();
      await core.start();
      expect(core.error).toEqual({ error: undefined });
    });

    it("threshold 未満による同期的な TypeError も catch されて error に格納される（never-throw）", async () => {
      installIdleDetector({
        startImpl: (options: { threshold: number; signal: AbortSignal }) => {
          if (options.threshold < 60000) {
            throw new TypeError("threshold must be >= 60000ms"); // ブラウザ実装の同期 throw を模す
          }
          return Promise.resolve();
        },
      });
      const core = new IdleCore();
      await expect(core.start(1000)).resolves.toBeUndefined();
      expect(core.error).toEqual({ error: expect.any(TypeError) });
      expect(core.userState).toBeNull();
    });

    it("start() 失敗後は _detector のリスナーが外れ、失敗したセッションからの後発 change を無視する", async () => {
      const { instances } = installIdleDetector({ startImpl: () => Promise.reject(new Error("boom")) });
      const core = new IdleCore();
      await core.start();
      expect(core.error).not.toBeNull();

      // 失敗した（=もう _detector として保持されていない）検知セッションの実体に
      // 後から change が来ても、リスナーは既に外れているため無視される。
      instances[0].emitChange("idle", "locked");
      expect(core.userState).toBeNull();
    });

    it("IdleDetector のコンストラクタ自体が同期的に throw しても never-throw で error に落ちる", async () => {
      class ThrowingIdleDetector extends EventTarget {
        static requestPermission = vi.fn(async () => "granted" as const);
        constructor() {
          super();
          throw new Error("constructor boom");
        }
      }
      (globalThis as any).IdleDetector = ThrowingIdleDetector;

      const core = new IdleCore();
      await expect(core.start()).resolves.toBeUndefined();
      expect(core.error).toEqual({ error: expect.any(Error) });
    });
  });

  describe("stop()", () => {
    it("進行中のセッションを止め、以後の change を無視する", async () => {
      const { instances } = installIdleDetector();
      const core = new IdleCore();
      await core.start();
      core.stop();

      instances[0].emitChange("idle", "locked");
      expect(core.userState).toBe("active"); // 変わらない
    });

    it("一度も start していない stop は安全な no-op", () => {
      const core = new IdleCore();
      expect(() => core.stop()).not.toThrow();
    });

    it("stop() による AbortError は無音（error に落ちない）", async () => {
      let rejectFn!: (e: unknown) => void;
      installIdleDetector({
        startImpl: () => new Promise<void>((_resolve, reject) => { rejectFn = reject; }),
      });
      const core = new IdleCore();
      const p = core.start();
      core.stop();
      rejectFn(Object.assign(new Error("aborted"), { name: "AbortError" }));
      await p;
      expect(core.error).toBeNull();
    });
  });

  describe("_gen 世代ガード", () => {
    it("dispose 後に resolve した stale な start() は状態を書かない", async () => {
      let resolveFn!: () => void;
      installIdleDetector({
        startImpl: () => new Promise<void>((resolve) => { resolveFn = resolve; }),
      });
      const core = new IdleCore();
      const p = core.start();
      core.dispose();
      resolveFn();
      await p;
      expect(core.userState).toBeNull();
    });

    it("dispose 後に reject（AbortError 以外）した stale な start() は状態を書かない", async () => {
      let rejectFn!: (e: unknown) => void;
      installIdleDetector({
        startImpl: () => new Promise<void>((_resolve, reject) => { rejectFn = reject; }),
      });
      const core = new IdleCore();
      const p = core.start();
      core.dispose();
      rejectFn(new Error("stale"));
      await p;
      expect(core.error).toBeNull();
    });
  });

  describe("dispose()", () => {
    it("stop() のエイリアスとして機能する", async () => {
      const { instances } = installIdleDetector();
      const core = new IdleCore();
      await core.start();
      core.dispose();
      instances[0].emitChange("idle", "locked");
      expect(core.userState).toBe("active");
    });
  });

  describe("target 指定", () => {
    it("target を渡すとそこへ change を dispatch する", async () => {
      installIdleDetector();
      const target = new EventTarget();
      const events: any[] = [];
      target.addEventListener("wcs-idle:change", (e) => events.push((e as CustomEvent).detail));
      const core = new IdleCore(target);
      await core.start();

      expect(events).toHaveLength(1);
    });
  });
});
