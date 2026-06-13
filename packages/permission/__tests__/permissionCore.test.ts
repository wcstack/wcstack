import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PermissionCore } from "../src/core/PermissionCore";
import { installPermissions, removePermissions, makePermissionStatus } from "./mocks";

describe("PermissionCore", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("初期状態", () => {
    it("descriptor 未指定なら state は prompt・query しない", () => {
      const mock = installPermissions();
      const core = new PermissionCore();
      expect(core.state).toBe("prompt");
      expect(core.prompt).toBe(true);
      expect(core.granted).toBe(false);
      expect(core.denied).toBe(false);
      expect(core.unsupported).toBe(false);
      expect(mock.query).not.toHaveBeenCalled();
    });

    it("descriptor 指定で構築すると即 query する（ヘッドレス）", async () => {
      const mock = installPermissions({ state: "granted" });
      const core = new PermissionCore({ name: "geolocation" });
      await core.ready;
      expect(mock.query).toHaveBeenCalledTimes(1);
      expect(mock.descriptors[0]).toEqual({ name: "geolocation" });
      expect(core.state).toBe("granted");
    });
  });

  describe("4値の解決と派生 boolean", () => {
    beforeEach(() => {
      installPermissions();
    });

    it.each([
      ["granted", { granted: true, denied: false, prompt: false, unsupported: false }],
      ["denied", { granted: false, denied: true, prompt: false, unsupported: false }],
      ["prompt", { granted: false, denied: false, prompt: true, unsupported: false }],
    ] as const)("state=%s で派生 boolean が一致する", async (state, expected) => {
      installPermissions({ state });
      const core = new PermissionCore({ name: "geolocation" });
      await core.ready;
      expect(core.state).toBe(state);
      expect(core.granted).toBe(expected.granted);
      expect(core.denied).toBe(expected.denied);
      expect(core.prompt).toBe(expected.prompt);
      expect(core.unsupported).toBe(expected.unsupported);
    });
  });

  describe("wcs-permission:change イベント", () => {
    it("初回 query 解決で change を 1 回 dispatch する", async () => {
      installPermissions({ state: "granted" });
      const events: string[] = [];
      const core = new PermissionCore();
      core.addEventListener("wcs-permission:change", (e) => events.push((e as CustomEvent).detail));
      await core.observe({ name: "geolocation" });
      expect(events).toEqual(["granted"]);
    });

    it("初回が prompt（既定と同値）なら同値ガードで dispatch しない", async () => {
      installPermissions({ state: "prompt" });
      const events: string[] = [];
      const core = new PermissionCore();
      core.addEventListener("wcs-permission:change", (e) => events.push((e as CustomEvent).detail));
      await core.observe({ name: "geolocation" });
      expect(events).toEqual([]);
      expect(core.state).toBe("prompt");
    });

    it("getter 付き property は detail から boolean を派生する", () => {
      const byName = (n: string) => PermissionCore.wcBindable.properties.find((p) => p.name === n)!;
      const ev = (detail: string) => new CustomEvent("wcs-permission:change", { detail });
      // granted の detail に対し各 getter が正しく真偽を返す
      expect(byName("granted").getter!(ev("granted"))).toBe(true);
      expect(byName("denied").getter!(ev("granted"))).toBe(false);
      expect(byName("prompt").getter!(ev("granted"))).toBe(false);
      expect(byName("unsupported").getter!(ev("granted"))).toBe(false);
      // それぞれの一致ケース
      expect(byName("denied").getter!(ev("denied"))).toBe(true);
      expect(byName("prompt").getter!(ev("prompt"))).toBe(true);
      expect(byName("unsupported").getter!(ev("unsupported"))).toBe(true);
    });

    it("commands は空（read-only モニタ）", () => {
      expect(PermissionCore.wcBindable.commands).toEqual([]);
    });
  });

  describe("live change の追従", () => {
    it("PermissionStatus の change で state が遷移し再 publish する", async () => {
      const mock = installPermissions({ state: "prompt" });
      const events: string[] = [];
      const core = new PermissionCore();
      core.addEventListener("wcs-permission:change", (e) => events.push((e as CustomEvent).detail));
      await core.observe({ name: "geolocation" });

      mock.statuses[0].change("granted");
      expect(core.state).toBe("granted");
      mock.statuses[0].change("denied");
      expect(core.state).toBe("denied");
      expect(events).toEqual(["granted", "denied"]);
    });
  });

  describe("unsupported フォールバック", () => {
    it("navigator.permissions が無いと unsupported になる", async () => {
      removePermissions();
      const core = new PermissionCore();
      await core.observe({ name: "geolocation" });
      expect(core.state).toBe("unsupported");
      expect(core.unsupported).toBe(true);
    });

    it("query が無い（query が関数でない）と unsupported になる", async () => {
      Object.defineProperty(navigator, "permissions", {
        value: {},
        configurable: true,
        writable: true,
      });
      const core = new PermissionCore();
      await core.observe({ name: "geolocation" });
      expect(core.state).toBe("unsupported");
    });

    it("query が reject する名前は unsupported になる", async () => {
      installPermissions({ reject: true });
      const core = new PermissionCore();
      await core.observe({ name: "clipboard-read" });
      expect(core.state).toBe("unsupported");
    });

    it("name 未指定（空 name）は query せず unsupported に倒す", async () => {
      const mock = installPermissions({ state: "granted" });
      const core = new PermissionCore();
      await core.observe({ name: "" });
      expect(core.state).toBe("unsupported");
      expect(core.unsupported).toBe(true);
      // 失敗が約束された query は発行しない
      expect(mock.query).not.toHaveBeenCalled();
    });

    it("空 name で unsupported 後、dispose 無しで正常 name を observe すると再 query され state が反映される", async () => {
      // 空 name のガードは _permissionSubscribed を立てないので、後から正しい
      // descriptor を渡せば dispose 不要でそのまま購読を確立できる。
      const mock = installPermissions({ state: "granted" });
      const core = new PermissionCore();
      await core.observe({ name: "" });
      expect(core.state).toBe("unsupported");
      expect(mock.query).not.toHaveBeenCalled();

      await core.observe({ name: "geolocation" });
      expect(mock.query).toHaveBeenCalledTimes(1);
      expect(mock.descriptors[0]).toEqual({ name: "geolocation" });
      expect(core.state).toBe("granted");

      // 復帰後は live change も追従する（購読が正しく確立されている）
      mock.statuses[0].change("denied");
      expect(core.state).toBe("denied");
    });

    it("unsupported 環境で observe を2回呼ぶと query を都度試みるが dispatch は同値ガードで1回以下", async () => {
      // navigator.permissions 無し → unsupported（再購読フラグを立てないので再プローブする）
      removePermissions();
      const events: string[] = [];
      const core = new PermissionCore();
      core.addEventListener("wcs-permission:change", (e) => events.push((e as CustomEvent).detail));
      await core.observe({ name: "geolocation" });
      await core.observe({ name: "geolocation" });
      expect(core.state).toBe("unsupported");
      // 既定 prompt → unsupported の遷移は1回だけ。2回目は同値ガードで抑止される
      expect(events).toEqual(["unsupported"]);
    });
  });

  describe("descriptor の転送", () => {
    it("observe に渡した descriptor がそのまま query へ渡る", async () => {
      const mock = installPermissions();
      const core = new PermissionCore();
      await core.observe({ name: "push", userVisibleOnly: true });
      expect(mock.descriptors[0]).toEqual({ name: "push", userVisibleOnly: true });
    });
  });

  describe("dispose と再購読", () => {
    it("dispose 後は change を受けても publish しない", async () => {
      const mock = installPermissions({ state: "prompt" });
      const events: string[] = [];
      const core = new PermissionCore();
      core.addEventListener("wcs-permission:change", (e) => events.push((e as CustomEvent).detail));
      await core.observe({ name: "geolocation" });

      core.dispose();
      mock.statuses[0].change("granted");
      // change リスナーが外れているので state は変わらない
      expect(core.state).toBe("prompt");
      expect(events).toEqual([]);
    });

    it("dispose→observe で再購読し新しい status を追従する", async () => {
      const mock = installPermissions({ state: "prompt" });
      const core = new PermissionCore();
      await core.observe({ name: "geolocation" });
      core.dispose();
      await core.observe({ name: "geolocation" });
      expect(mock.query).toHaveBeenCalledTimes(2);

      mock.statuses[1].change("granted");
      expect(core.state).toBe("granted");
    });

    it("購読中の observe 再呼び出しは再 query しない（冪等）", async () => {
      const mock = installPermissions();
      const core = new PermissionCore();
      await core.observe({ name: "geolocation" });
      await core.observe({ name: "geolocation" });
      expect(mock.query).toHaveBeenCalledTimes(1);
    });

    it("購読中に別 descriptor で observe しても再 query しない（固定 descriptor）", async () => {
      const mock = installPermissions({ state: "granted" });
      const core = new PermissionCore();
      await core.observe({ name: "geolocation" });
      // 別の権限名で呼んでも、購読中なので再 query は発生しない
      await core.observe({ name: "camera" });
      expect(mock.query).toHaveBeenCalledTimes(1);
      expect(mock.descriptors).toEqual([{ name: "geolocation" }]);
      expect(core.state).toBe("granted");
      // dispose 後の observe で初めて新しい descriptor が反映される
      core.dispose();
      await core.observe({ name: "camera" });
      expect(mock.query).toHaveBeenCalledTimes(2);
      expect(mock.descriptors[1]).toEqual({ name: "camera" });
    });
  });

  describe("世代ガード（_permGen）", () => {
    it("dispose で無効化された in-flight query はリスナーを張らない", async () => {
      // query の解決を手動制御する
      const status = makePermissionStatus("granted");
      const addSpy = vi.spyOn(status, "addEventListener");
      let resolveQuery!: (s: typeof status) => void;
      const query = vi.fn(() => new Promise((res) => { resolveQuery = res as any; }));
      Object.defineProperty(navigator, "permissions", {
        value: { query }, configurable: true, writable: true,
      });

      const core = new PermissionCore();
      const ready = core.observe({ name: "geolocation" });
      // 解決前に dispose（世代を進める）
      core.dispose();
      resolveQuery(status);
      await ready;

      // stale 解決なので state は変わらず、change リスナーも張られない
      expect(core.state).toBe("prompt");
      expect(addSpy).not.toHaveBeenCalled();
    });

    it("dispose で無効化された in-flight query の reject も無視する", async () => {
      let rejectQuery!: (e: unknown) => void;
      const query = vi.fn(() => new Promise((_res, rej) => { rejectQuery = rej; }));
      Object.defineProperty(navigator, "permissions", {
        value: { query }, configurable: true, writable: true,
      });

      const events: string[] = [];
      const core = new PermissionCore();
      core.addEventListener("wcs-permission:change", (e) => events.push((e as CustomEvent).detail));
      const ready = core.observe({ name: "geolocation" });
      core.dispose();
      rejectQuery(new TypeError("x"));
      await ready;

      expect(core.state).toBe("prompt");
      expect(events).toEqual([]);
    });
  });

  describe("ターゲット指定", () => {
    it("target を渡すとそこへ change を dispatch する", async () => {
      installPermissions({ state: "granted" });
      const target = new EventTarget();
      const events: string[] = [];
      target.addEventListener("wcs-permission:change", (e) => events.push((e as CustomEvent).detail));
      const core = new PermissionCore({ name: "geolocation" }, target);
      await core.ready;
      expect(events).toEqual(["granted"]);
    });
  });
});
