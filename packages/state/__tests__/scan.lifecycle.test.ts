/**
 * scan.lifecycle.test.ts
 *
 * `$scan` の寿命（docs/state-scan-design.md D7 / D8 / §2-4）。
 * 切断・再接続・`_state` 再セット・throw した再セット・SSR・ボリューム・マウント。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { getAbsolutePathInfo } from "../src/address/AbsolutePathInfo";
import { createAbsoluteStateAddress } from "../src/address/AbsoluteStateAddress";
import { getPathInfo } from "../src/address/PathInfo";
import { bootstrapState } from "../src/bootstrapState";
import type { State } from "../src/components/State";
import { getScanRegistry } from "../src/scan/scanRegistry";
import { getUpdater } from "../src/updater/updater";
import { getActiveWatchStateElements } from "../src/watch/watchRegistry";
import type { IState } from "../src/types";
import { flushAsync, flushTimes, makeConnectHost, readState, writeState } from "./helpers/streamTestUtils";

beforeAll(() => {
  bootstrapState();
});

const connectHost = makeConnectHost("scan-lc-host");

describe("切断と再接続（D8）", () => {
  it("切断中のバッチは畳まず、再接続後は再開し、出力は保持されること", async () => {
    const fold = vi.fn((acc: number, cur: number) => acc + cur);
    const { host, stateEl } = await connectHost("", {
      n: 0,
      $scan: { total: { from: "n", initial: 0, fold } },
    } as unknown as IState);

    writeState(stateEl, (s) => { s.n = 1; });
    await flushTimes();
    expect(readState(stateEl, (s) => s.total)).toBe(1);

    host.remove();
    await flushAsync();
    expect(getActiveWatchStateElements().has(stateEl)).toBe(false);
    // registry は保持する（切断は「発火しなくなる」だけ — $watch と同じ二段構え）
    expect(getScanRegistry(stateEl)).toBeDefined();

    // 切断中に from が書かれたバッチ
    (stateEl as any).__state.n = 5;
    getUpdater().testApplyChange([createAbsoluteStateAddress(getAbsolutePathInfo(stateEl, getPathInfo("n")), null)]);
    await flushTimes();
    expect(fold).toHaveBeenCalledTimes(1);

    document.body.appendChild(host);
    await stateEl.connectedCallbackPromise;
    await flushAsync();
    expect(getActiveWatchStateElements().has(stateEl)).toBe(true);
    expect(readState(stateEl, (s) => s.total), "出力は保持される").toBe(1);

    writeState(stateEl, (s) => { s.n = 7; });
    await flushTimes();
    expect(readState(stateEl, (s) => s.total)).toBe(8);
    expect(fold).toHaveBeenCalledTimes(2);
    host.remove();
  });
});

describe("_state の再セット（§2-4）", () => {
  it("宣言を作り直し、旧宣言の scan は発火せず、宣言が消えたら registry と scanPaths も消えること", async () => {
    const foldA = vi.fn((acc: number) => acc + 1);
    const foldB = vi.fn((acc: number) => acc + 1);
    const { host, stateEl } = await connectHost("", {
      n: 0,
      $scan: { a: { from: "n", initial: 0, fold: foldA } },
    } as unknown as IState);

    stateEl.setInitialState({ n: 0, $scan: { b: { from: "n", initial: 0, fold: foldB } } } as unknown as IState);
    await flushAsync();
    writeState(stateEl, (s) => { s.n = 1; });
    await flushTimes();
    expect(foldA).not.toHaveBeenCalled();
    expect(foldB).toHaveBeenCalledTimes(1);

    stateEl.setInitialState({ n: 0 } as unknown as IState);
    await flushAsync();
    expect(stateEl.scanPaths).toBeNull();
    expect(getScanRegistry(stateEl)).toBeUndefined();
    expect(getActiveWatchStateElements().has(stateEl)).toBe(false);
    writeState(stateEl, (s) => { s.n = 2; });
    await flushTimes();
    expect(foldB).toHaveBeenCalledTimes(1);
    host.remove();
  });

  it("$scan の検証で throw した再セットは世代を進めず、旧宣言のまま発火し続けること", async () => {
    const foldA = vi.fn((acc: number) => acc + 1);
    const { host, stateEl } = await connectHost("", {
      n: 0,
      $scan: { a: { from: "n", initial: 0, fold: foldA } },
    } as unknown as IState);

    expect(() => stateEl.setInitialState({ n: 100, $scan: { bad: 1 } } as unknown as IState))
      .toThrow(/\[wcs\/scan-declaration-invalid\]/);
    expect(readState(stateEl, (s) => s.n), "旧世代の state のまま").toBe(0);

    writeState(stateEl, (s) => { s.n = 1; });
    await flushTimes();
    expect(foldA).toHaveBeenCalledTimes(1);
    expect(readState(stateEl, (s) => s.a)).toBe(1);
    host.remove();
  });

  it("同じオブジェクトの再セットでは出力が既にあるので、累積を保持すること（D7）", async () => {
    const raw = {
      n: 0,
      $scan: { total: { from: "n", initial: 0, fold: (acc: number, cur: number) => acc + cur } },
    } as unknown as IState;
    const { host, stateEl } = await connectHost("", raw);

    writeState(stateEl, (s) => { s.n = 3; });
    await flushTimes();
    stateEl.setInitialState(raw);
    await flushAsync();
    expect(readState(stateEl, (s) => s.total)).toBe(3);

    writeState(stateEl, (s) => { s.n = 4; });
    await flushTimes();
    expect(readState(stateEl, (s) => s.total)).toBe(7);
    host.remove();
  });
});

describe("SSR / ボリューム / マウント（D8）", () => {
  it("SSR では from が発火せず、出力の実体化だけ行うこと", async () => {
    document.documentElement.setAttribute("data-wcs-server", "");
    let host: HTMLElement | null = null;
    try {
      const fold = vi.fn((acc: unknown) => acc);
      const raw = { n: 0, $scan: { out: { from: "n", initial: "seed", fold } } } as unknown as IState;
      const connected = await connectHost("", raw);
      host = connected.host;

      expect((raw as Record<string, unknown>).out).toBe("seed");
      expect(getActiveWatchStateElements().has(connected.stateEl)).toBe(false);
      writeState(connected.stateEl, (s) => { s.n = 1; });
      await flushTimes();
      expect(fold).not.toHaveBeenCalled();
    } finally {
      host?.remove();
      document.documentElement.removeAttribute("data-wcs-server");
    }
  });

  it("ボリュームの $scan は接ぎ木前に名指しで拒否されること", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      document.body.innerHTML = `<wcs-state json='{"root":1}'></wcs-state><wcs-state mount="sc"></wcs-state>`;
      const rootEl = document.querySelector("wcs-state:not([mount])") as State;
      const volumeEl = document.querySelector("wcs-state[mount]") as State;
      volumeEl.setInitialState({ plain: 1, $scan: { x: { from: "plain", initial: 0, fold: (acc: unknown) => acc } } } as unknown as IState);
      await rootEl.connectedCallbackPromise;
      await volumeEl.connectedCallbackPromise;
      await flushTimes();

      const messages = errorSpy.mock.calls.map((call) => String(call[0]) + "|" + String((call[1] as any)?.message ?? ""));
      expect(messages.some((m) => m.includes("declares $scan, which volumes do not support yet"))).toBe(true);
      expect((rootEl as any).__state.sc).toBeUndefined();
    } finally {
      errorSpy.mockRestore();
      document.body.innerHTML = "";
    }
  });

  it("マウントされたコンポーネントの $scan は誘導 warn の対象になること", async () => {
    const { clearMountDollarWarnsForTesting, buildMountRecord, warnMountedDollarDeclarations } =
      await import("../src/webComponent/mount");
    clearMountDollarWarnsForTesting();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const component = document.createElement("scan-mount-decl");
      const record = buildMountRecord(
        component,
        "state",
        [{
          propName: "state", propSegments: ["state"], propModifiers: [],
          statePathName: "user", statePathInfo: getPathInfo("user"),
          inFilters: [], outFilters: [], bindingType: "prop", uuid: null,
          node: component, replaceNode: component,
        } as any],
        { name: "default" } as any,
        { $scan: { count: { from: "n", initial: 0, fold: (acc: unknown) => acc } } },
      );
      warnMountedDollarDeclarations(record);
      const warns = warn.mock.calls.map((call) => String(call[0])).filter((m) => m.includes("[wcs/mount-dollar-declaration]"));
      expect(warns).toHaveLength(1);
      expect(warns[0]).toContain("declares $scan");
    } finally {
      warn.mockRestore();
    }
  });
});
