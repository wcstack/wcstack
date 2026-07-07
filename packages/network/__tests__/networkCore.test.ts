import { describe, it, expect, afterEach, vi } from "vitest";
import { NetworkCore } from "../src/core/NetworkCore";
import { installConnection, removeConnection, makeNetworkInformation } from "./mocks";

describe("NetworkCore", () => {
  afterEach(() => {
    removeConnection();
    vi.restoreAllMocks();
  });

  describe("初期状態（observe 前）", () => {
    it("connection 不在なら全プロパティが既定値", () => {
      const core = new NetworkCore();
      expect(core.effectiveType).toBeNull();
      expect(core.downlink).toBeNull();
      expect(core.rtt).toBeNull();
      expect(core.saveData).toBeNull();
      expect(core.supported).toBe(false);
    });

    it("ready は即 resolve する（非同期 probe が無いため）", async () => {
      const core = new NetworkCore();
      await expect(core.ready).resolves.toBeUndefined();
    });
  });

  describe("observe() — 対応環境", () => {
    it("connection ありなら observe() で即座に snapshot を反映し change を dispatch する", () => {
      installConnection({ effectiveType: "3g", downlink: 1.5, rtt: 200, saveData: true });
      const core = new NetworkCore();
      const events: any[] = [];
      core.addEventListener("wcs-network:change", (e) => events.push((e as CustomEvent).detail));

      core.observe();

      expect(core.effectiveType).toBe("3g");
      expect(core.downlink).toBe(1.5);
      expect(core.rtt).toBe(200);
      expect(core.saveData).toBe(true);
      expect(core.supported).toBe(true);
      expect(events).toEqual([
        { effectiveType: "3g", downlink: 1.5, rtt: 200, saveData: true, supported: true },
      ]);
    });

    it("observe() は冪等 — 二重呼び出しでリスナーが二重登録されず再 dispatch もしない", () => {
      const conn = installConnection({ effectiveType: "4g" });
      const addSpy = vi.spyOn(conn, "addEventListener");
      const core = new NetworkCore();
      const events: any[] = [];
      core.addEventListener("wcs-network:change", (e) => events.push((e as CustomEvent).detail));

      core.observe();
      core.observe();

      expect(addSpy).toHaveBeenCalledTimes(1);
      expect(events).toHaveLength(1);
    });

    it("observe() 後に購読したリスナーには初回スナップショットは届かない（現仕様の明示）", () => {
      // wc-bindable のイベントは後から購読した相手に再送されない純 pub-sub。
      // @wcstack/state のバインド確立(後続 microtask)より先に observe() の初回
      // dispatch が同期発火するため、初期値が必要な消費者は要素プロパティを
      // 直接 pull する必要がある(README「Notes & limitations」・族横断の契約)。
      const conn = installConnection({ effectiveType: "3g" });
      const core = new NetworkCore();
      core.observe(); // 初回スナップショットはここで同期 dispatch 済み
      const events: any[] = [];
      core.addEventListener("wcs-network:change", (e) => events.push((e as CustomEvent).detail));

      expect(events).toEqual([]); // 初回分は受け取れない
      expect(core.effectiveType).toBe("3g"); // ただしプロパティの pull では読める

      conn.change({ effectiveType: "2g" }); // 以後の変化は届く
      expect(events).toHaveLength(1);
    });
  });

  describe("observe() — 非対応環境", () => {
    it("connection 不在なら supported=false のまま、既定値と同値なので change は dispatch しない", () => {
      removeConnection();
      const core = new NetworkCore();
      const events: any[] = [];
      core.addEventListener("wcs-network:change", (e) => events.push((e as CustomEvent).detail));

      core.observe();

      expect(core.supported).toBe(false);
      expect(core.effectiveType).toBeNull();
      expect(events).toEqual([]);
    });
  });

  describe("change イベントの追従", () => {
    it("connection の change で値が更新され再 dispatch する", () => {
      const conn = installConnection({ effectiveType: "4g", downlink: 10, rtt: 50, saveData: false });
      const core = new NetworkCore();
      core.observe();
      const events: any[] = [];
      core.addEventListener("wcs-network:change", (e) => events.push((e as CustomEvent).detail));

      conn.change({ effectiveType: "2g", downlink: 0.4, rtt: 900 });

      expect(core.effectiveType).toBe("2g");
      expect(core.downlink).toBe(0.4);
      expect(core.rtt).toBe(900);
      expect(events).toEqual([
        { effectiveType: "2g", downlink: 0.4, rtt: 900, saveData: false, supported: true },
      ]);
    });

    it("同値の change 連続発火では再 dispatch しない（同値ガード）", () => {
      const conn = installConnection({ effectiveType: "4g", downlink: 10, rtt: 50, saveData: false });
      const core = new NetworkCore();
      core.observe();
      const events: any[] = [];
      core.addEventListener("wcs-network:change", (e) => events.push((e as CustomEvent).detail));

      // 実際には値を変えずに change イベントだけ発火させる（ブラウザの二重発火想定）
      conn.dispatchEvent(new Event("change"));
      conn.dispatchEvent(new Event("change"));

      expect(events).toEqual([]);
    });

    it("単一フィールドのみの変更（downlink/rtt/saveData 単独）でもそれぞれ dispatch する", () => {
      // 同値ガードが5フィールド全てを比較していることの検証。
      // effectiveType 単独は dispose→observe テストが、supported 単独は
      // _read() 正規化テストが実質カバーするため、残る3フィールドをここで押さえる。
      const conn = installConnection({ effectiveType: "4g", downlink: 10, rtt: 50, saveData: false });
      const core = new NetworkCore();
      core.observe();
      const events: any[] = [];
      core.addEventListener("wcs-network:change", (e) => events.push((e as CustomEvent).detail));

      conn.change({ downlink: 5 });
      expect(events).toHaveLength(1);
      expect(core.downlink).toBe(5);

      conn.change({ rtt: 400 });
      expect(events).toHaveLength(2);
      expect(core.rtt).toBe(400);

      conn.change({ saveData: true });
      expect(events).toHaveLength(3);
      expect(core.saveData).toBe(true);
    });
  });

  describe("dispose()", () => {
    it("dispose 後は change を受けても状態が変わらない", () => {
      const conn = installConnection({ effectiveType: "4g" });
      const core = new NetworkCore();
      core.observe();
      core.dispose();

      conn.change({ effectiveType: "2g" });

      expect(core.effectiveType).toBe("4g");
    });

    it("一度も observe していない dispose は安全な no-op", () => {
      const core = new NetworkCore();
      expect(() => core.dispose()).not.toThrow();
    });

    it("connection 不在で observe した場合の dispose も安全な no-op", () => {
      removeConnection();
      const core = new NetworkCore();
      core.observe();
      expect(() => core.dispose()).not.toThrow();
    });

    it("dispose→observe で再購読し、新しい connection の値を反映する", () => {
      installConnection({ effectiveType: "4g" });
      const core = new NetworkCore();
      core.observe();
      core.dispose();

      const conn2 = installConnection({ effectiveType: "3g", downlink: 2 });
      core.observe();

      expect(core.effectiveType).toBe("3g");
      expect(core.downlink).toBe(2);

      conn2.change({ effectiveType: "2g" });
      expect(core.effectiveType).toBe("2g");
    });
  });

  describe("_read() のフィールド正規化", () => {
    it("フィールドの型が期待と異なる場合は null に正規化する", () => {
      const conn = makeNetworkInformation();
      // 実装依存でフィールドが欠落/非期待型になるケースを模す
      (conn as any).effectiveType = undefined;
      (conn as any).downlink = "10"; // 文字列(数値でない)
      (conn as any).rtt = undefined;
      (conn as any).saveData = "false"; // 文字列(booleanでない)
      Object.defineProperty(navigator, "connection", { value: conn, configurable: true, writable: true });

      const core = new NetworkCore();
      core.observe();

      expect(core.effectiveType).toBeNull();
      expect(core.downlink).toBeNull();
      expect(core.rtt).toBeNull();
      expect(core.saveData).toBeNull();
      expect(core.supported).toBe(true);
    });
  });

  describe("target 指定", () => {
    it("target を渡すとそこへ change を dispatch する", () => {
      installConnection({ effectiveType: "4g" });
      const target = new EventTarget();
      const events: any[] = [];
      target.addEventListener("wcs-network:change", (e) => events.push((e as CustomEvent).detail));

      const core = new NetworkCore(target);
      core.observe();

      // target 経路でも detail にスナップショット全体が載ることまで確認する
      expect(events).toEqual([
        { effectiveType: "4g", downlink: 10, rtt: 50, saveData: false, supported: true },
      ]);
    });
  });

  describe("wcBindable プロトコル宣言", () => {
    it("commands は空（純粋 monitor）", () => {
      expect(NetworkCore.wcBindable.commands).toEqual([]);
    });

    it("各 property の getter が event.detail から正しく値を取り出す", () => {
      const byName = (n: string) => NetworkCore.wcBindable.properties.find((p) => p.name === n)!;
      const detail = { effectiveType: "3g", downlink: 1.5, rtt: 200, saveData: true, supported: true };
      const ev = new CustomEvent("wcs-network:change", { detail });

      expect(byName("effectiveType").getter!(ev)).toBe("3g");
      expect(byName("downlink").getter!(ev)).toBe(1.5);
      expect(byName("rtt").getter!(ev)).toBe(200);
      expect(byName("saveData").getter!(ev)).toBe(true);
      expect(byName("supported").getter!(ev)).toBe(true);
    });
  });
});
