/**
 * scan.runtimeEdges.test.ts
 *
 * `$scan` の drain 側発火の境界（docs/state-scan-design.md §2-1 / §2-3）。
 * 多段 wildcard の並び・先行 fold による同期の切断と再セット・他ツリーのアドレス・
 * 行を特定できないアドレス・合流する依存グラフ・drain ゲートの数え方。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { getTreePath } from "../src/address/TreePath";
import { createAbsoluteStateAddress } from "../src/address/AbsoluteStateAddress";
import { getPathInfo } from "../src/address/PathInfo";
import { bootstrapState } from "../src/bootstrapState";
import type { State } from "../src/components/State";
import { setDevtoolsSink } from "../src/platform/devtoolsSink";
import { getPendingScanResetCount } from "../src/scan/eventReset";
import { getScanDrainGateCount, getScanEventResetGateCount, getScanRegistry } from "../src/scan/scanRegistry";
import { getUpdater } from "../src/updater/updater";
import * as rowLanding from "../src/watch/rowLanding";
import type { IState } from "../src/types";
import { makeManualAsyncGenerator } from "./helpers/fakeStreamSources";
import { flushAsync, flushTimes, makeConnectHost, readState, writeState } from "./helpers/streamTestUtils";

beforeAll(() => {
  bootstrapState();
});

const connectHost = makeConnectHost("scan-edge-host");

describe("行の並び", () => {
  it("2 段 wildcard の from は、外側の段が同じ行も含めて indexes 昇順に畳むこと", async () => {
    const { host, stateEl } = await connectHost(
      `<template data-wcs="for: groups"><template data-wcs="for: groups.*.items"><span data-wcs="textContent: .qty"></span></template></template>`,
      {
        groups: [{ items: [{ qty: 1 }, { qty: 2 }] }, { items: [{ qty: 3 }] }],
        $scan: {
          log: {
            from: "groups.*.items.*.qty",
            initial: [],
            fold: (acc: string[], cur: unknown, _prev: unknown, g: number, i: number) => [...acc, `${g}.${i}:${cur}`],
          },
        },
      } as unknown as IState,
    );
    await flushTimes();

    writeState(stateEl, (s) => {
      s.$resolve("groups.*.items.*.qty", [1, 0], 30);
      s.$resolve("groups.*.items.*.qty", [0, 1], 20);
      s.$resolve("groups.*.items.*.qty", [0, 0], 10);
    });
    await flushTimes(3);

    expect(readState(stateEl, (s) => s.log)).toEqual(["0.0:10", "0.1:20", "1.0:30"]);
    host.remove();
  });
});

describe("先行 fold による同期の変化", () => {
  it("先行 fold が同期に切断したら、同じバッチの後続 scan は畳まないこと", async () => {
    let hostRef: HTMLElement | null = null;
    const foldB = vi.fn((acc: unknown) => acc);
    const { host, stateEl } = await connectHost("", {
      n: 0,
      $scan: {
        a: { from: "n", initial: 0, fold: (acc: unknown) => { hostRef?.remove(); return acc; } },
        b: { from: "n", initial: 0, fold: foldB },
      },
    } as unknown as IState);
    hostRef = host;

    writeState(stateEl, (s) => { s.n = 1; });
    await flushTimes();

    expect(foldB).not.toHaveBeenCalled();
  });

  it("後続の fold が同期に切断したら、先行 scan が計画した書き込みもしないこと（相 2 の再確認）", async () => {
    let hostRef: HTMLElement | null = null;
    const { stateEl } = await connectHost("", {
      n: 0,
      $scan: {
        a: { from: "n", initial: 0, fold: (acc: number) => acc + 1 },
        b: { from: "n", initial: 0, fold: (acc: unknown) => { hostRef?.remove(); return acc; } },
      },
    } as unknown as IState);
    hostRef = (stateEl.getRootNode() as ShadowRoot).host as HTMLElement;

    writeState(stateEl, (s) => { s.n = 1; });
    await flushTimes();

    expect((stateEl as any).__state.a).toBe(0);
  });

  it("先行 fold が同期に再セットしたら、旧宣言の後続 scan は畳まないこと", async () => {
    let stateElRef: State | null = null;
    const foldB = vi.fn((acc: unknown) => acc);
    const foldReplacement = vi.fn((acc: unknown) => acc);
    const { host, stateEl } = await connectHost("", {
      n: 0,
      $scan: {
        a: {
          from: "n",
          initial: 0,
          fold: (acc: unknown) => {
            stateElRef?.setInitialState({ n: 0, $scan: { b: { from: "n", initial: 0, fold: foldReplacement } } } as unknown as IState);
            return acc;
          },
        },
        b: { from: "n", initial: 0, fold: foldB },
      },
    } as unknown as IState);
    stateElRef = stateEl;

    writeState(stateEl, (s) => { s.n = 1; });
    await flushTimes();

    expect(foldB).not.toHaveBeenCalled();
    // 収集はバッチの時点で終わっているので、差し替え後の宣言もこのバッチでは畳まない
    expect(foldReplacement).not.toHaveBeenCalled();
    host.remove();
  });
});

describe("出力の読み", () => {
  it("出力の読みが throw したら fold も書き込みもせず、fold の失敗と区別して報告すること（devtools には phase: evaluate）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const events: unknown[] = [];
    setDevtoolsSink((event) => { events.push(event); });
    try {
      const fold = vi.fn((acc: number) => acc + 1);
      const { host, stateEl } = await connectHost("", {
        n: 0,
        $scan: { out: { from: "n", initial: 0, fold } },
      } as unknown as IState);
      stateEl.defineTreeAccessor("out", { get() { throw new Error("output read refused"); }, enumerable: false, configurable: true });

      writeState(stateEl, (s) => { s.n = 1; });
      await flushTimes();

      expect(fold).not.toHaveBeenCalled();
      const messages = errorSpy.mock.calls.map((call) => String(call[0]));
      expect(messages.some((m) => m.includes(`$scan could not read the output "out"`))).toBe(true);
      expect(messages.some((m) => m.includes(`$scan fold for "out" threw`))).toBe(false);
      expect(events).toContainEqual(expect.objectContaining({ type: "state:watch-error", phase: "evaluate", path: "$scan.out" }));
      host.remove();
    } finally {
      setDevtoolsSink(null);
      errorSpy.mockRestore();
    }
  });

  it("行の位置引きが throw したら、出力の読みの失敗と区別して from 側の失敗として報告すること", async () => {
    // `selectLandedRows`（watch/rowLanding.ts の placementOf）は `getByAddress` でリストを読むので
    // throw しうる。出力の読みは既に済んでいるので、`read-output`（出力を読めなかった）ではなく
    // `read-rows`（`from` の行を読めなかった）として報告する — 診断が指す先を source 側に合わせる
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const events: unknown[] = [];
    setDevtoolsSink((event) => { events.push(event); });
    const fold = vi.fn((acc: number, cur: number) => acc + cur);
    const { host, stateEl } = await connectHost(
      `<template data-wcs="for: items"><span data-wcs="textContent: items.*.qty"></span></template>`,
      {
        items: [{ qty: 1 }, { qty: 2 }],
        $scan: { total: { from: "items.*.qty", initial: 0, fold } },
      } as unknown as IState,
    );
    await flushTimes();
    fold.mockClear();
    errorSpy.mockClear();
    events.length = 0;
    const selectSpy = vi.spyOn(rowLanding, "selectLandedRows").mockImplementation(() => {
      throw new Error("placement read failed");
    });
    try {
      writeState(stateEl, (s) => { s.$resolve("items.*.qty", [0], 10); });
      await flushTimes(3);

      expect(selectSpy).toHaveBeenCalledTimes(1);
      expect(fold).not.toHaveBeenCalled();
      const messages = errorSpy.mock.calls.map((call) => String(call[0]));
      expect(messages.some((m) => m.includes(`$scan could not read the rows of "from" for "total"`))).toBe(true);
      expect(messages.some((m) => m.includes(`$scan could not read the output "total"`))).toBe(false);
      expect(messages.some((m) => m.includes(`$scan fold for "total" threw`))).toBe(false);
      expect(events).toContainEqual(expect.objectContaining({ type: "state:watch-error", phase: "evaluate", path: "$scan.total" }));
    } finally {
      selectSpy.mockRestore();
      setDevtoolsSink(null);
      errorSpy.mockRestore();
      host.remove();
    }
  });
});

describe("バッチに載る他のアドレス", () => {
  it("発火対象でない state・scan を持たない state のアドレスは素通りすること", async () => {
    const foldA = vi.fn((acc: unknown) => acc);
    const watchB = vi.fn();
    const a = await connectHost("", { n: 0, $scan: { out: { from: "n", initial: 0, fold: foldA } } } as unknown as IState);
    const b = await connectHost("", { n: 0, $watch: { n: watchB } } as unknown as IState);
    const c = await connectHost("", { n: 0 } as unknown as IState);

    // 同じ task の書き込みは 1 つのバッチに載る（updater は全ツリーで 1 本）
    writeState(b.stateEl, (s) => { s.n = 1; });
    writeState(c.stateEl, (s) => { s.n = 1; });
    await flushTimes();

    expect(watchB).toHaveBeenCalledTimes(1);
    expect(foldA).not.toHaveBeenCalled();
    a.host.remove();
    b.host.remove();
    c.host.remove();
  });

  it("wildcard の from に行を特定できないアドレスが載っても畳まないこと", async () => {
    const fold = vi.fn((acc: unknown) => acc);
    const { host, stateEl } = await connectHost(
      `<template data-wcs="for: items"><span data-wcs="textContent: .qty"></span></template>`,
      {
        items: [{ qty: 1 }],
        $scan: { log: { from: "items.*.qty", initial: [], fold } },
      } as unknown as IState,
    );
    await flushTimes();

    getUpdater().testApplyChange([
      createAbsoluteStateAddress(getTreePath(stateEl, getPathInfo("items.*.qty")), null),
    ]);
    await flushTimes();

    expect(fold).not.toHaveBeenCalled();
    host.remove();
  });
});

describe("自己ループの柵の探索（D9）", () => {
  it("依存グラフが合流していても探索は終わり、args が plain なカーソルなら raise しないこと", async () => {
    const { host, stateEl } = await connectHost("", {
      page: 1,
      get size(this: any) { return this.feed.length; },
      get total(this: any) { return this.size + this.feed.length; },
      $streams: {
        pageResult: { args: (s: any) => s.page, source: () => makeManualAsyncGenerator<unknown>().iterable },
      },
      $scan: { feed: { from: "pageResult", initial: [], fold: (acc: unknown) => acc } },
    } as unknown as IState);
    // feed → size・feed → total・size → total の辺を張る（total には 2 経路で届く）
    expect(readState(stateEl, (s) => s.total)).toBe(0);

    writeState(stateEl, (s) => { s.page = 2; });
    await flushTimes();

    expect(readState(stateEl, (s) => s["$streamStatus.pageResult"])).toBe("active");
    host.remove();
  });
});

describe("相 2 の書き込み", () => {
  it("相 1 の後に出力が計画と同じ値になっていたら、相 2 は書き直さないこと", async () => {
    let stateRef: State | null = null;
    const watched: unknown[] = [];
    const { host, stateEl } = await connectHost("", {
      n: 0,
      $scan: {
        a: { from: "n", initial: 0, fold: (acc: number, cur: number) => acc + cur },
        // 後続の scan の fold が、先行 scan の出力へ計画と同じ値を書く（相 1 の副作用）
        b: {
          from: "n",
          initial: 0,
          fold: (acc: number, cur: number) => {
            stateRef?.createState("writable", (s: any) => { s.a = cur; });
            return acc;
          },
        },
      },
      $watch: { a(cur: unknown) { watched.push(cur); } },
    } as unknown as IState);
    stateRef = stateEl;

    writeState(stateEl, (s) => { s.n = 5; });
    await flushTimes(4);

    expect(readState(stateEl, (s) => s.a)).toBe(5);
    expect(watched).toEqual([5]);
    host.remove();
  });
});

describe("drain ゲートの数え方", () => {
  it("on だけの scan の state は drain ゲートに数えず、作り直しても数は変わらないこと", async () => {
    const before = getScanDrainGateCount();
    const { host, stateEl } = await connectHost("", {
      $eventTokens: ["tick"],
      $scan: { count: { on: "tick", initial: 0, fold: (acc: number) => acc + 1 } },
    } as unknown as IState);
    expect(getScanRegistry(stateEl)).toBeDefined();
    expect(getScanDrainGateCount()).toBe(before);

    stateEl.setInitialState({ $eventTokens: ["tick"] } as unknown as IState);
    await flushAsync();
    expect(getScanRegistry(stateEl)).toBeUndefined();
    expect(getScanDrainGateCount()).toBe(before);
    host.remove();
  });

  it("切断でゲートから外れ（registry は保持する）、ルート <wcs-state> の再接続で数え直すこと", async () => {
    const drain0 = getScanDrainGateCount();
    const reset0 = getScanEventResetGateCount();
    const { host, stateEl } = await connectHost("", {
      host: "a",
      $eventTokens: ["tick"],
      $scan: { log: { on: "tick", initial: [], fold: (acc: unknown) => acc, resetOn: ["host"] } },
    } as unknown as IState);
    expect([getScanDrainGateCount(), getScanEventResetGateCount()]).toEqual([drain0 + 1, reset0 + 1]);

    host.remove();
    await flushAsync();
    expect(getScanRegistry(stateEl)).toBeDefined();
    expect([getScanDrainGateCount(), getScanEventResetGateCount()]).toEqual([drain0, reset0]);

    document.body.appendChild(host);
    await stateEl.connectedCallbackPromise;
    await flushAsync();
    expect([getScanDrainGateCount(), getScanEventResetGateCount()]).toEqual([drain0 + 1, reset0 + 1]);
    host.remove();
    await flushAsync();
    expect([getScanDrainGateCount(), getScanEventResetGateCount()]).toEqual([drain0, reset0]);
  });

  it("接続中の再セットで scan を足した宣言は、同じ再セットの中で数え、切断で外すこと", async () => {
    const drain0 = getScanDrainGateCount();
    const { host, stateEl } = await connectHost("", { n: 0 } as unknown as IState);
    expect(getScanDrainGateCount()).toBe(drain0);

    stateEl.setInitialState({ n: 0, $scan: { out: { from: "n", initial: 0, fold: (acc: unknown) => acc } } } as unknown as IState);
    expect(getScanDrainGateCount()).toBe(drain0 + 1);

    host.remove();
    await flushAsync();
    expect(getScanDrainGateCount()).toBe(drain0);
  });

  it("resetOn の書き込みと drain の間に再セットしたら、旧宣言の保留を新しい宣言へ引き継ぎ、数を二重に数えず、drain で使い切ること", async () => {
    const declaration = () => ({
      host: "a",
      $eventTokens: ["tick"],
      $scan: { log: { on: "tick", initial: [], fold: (acc: unknown) => acc, resetOn: ["host"] } },
    });
    const { host, stateEl } = await connectHost("", declaration() as unknown as IState);
    const pending0 = getPendingScanResetCount();

    stateEl.createState("writable", (s: any) => { s.host = "b"; });
    expect(getPendingScanResetCount()).toBe(pending0 + 1);
    stateEl.setInitialState(declaration() as unknown as IState);
    expect(getPendingScanResetCount()).toBe(pending0 + 1);
    await flushAsync();
    expect(getPendingScanResetCount()).toBe(pending0);
    host.remove();
  });

  it("resetOn を持つ on scan の state だけを enqueue ゲートに数え、再セットで消せば数が戻ること", async () => {
    const before = getScanEventResetGateCount();
    const { host, stateEl } = await connectHost("", {
      host: "a",
      n: 0,
      $eventTokens: ["tick"],
      $scan: {
        count: { on: "tick", initial: 0, fold: (acc: number) => acc + 1, resetOn: ["host"] },
        total: { from: "n", initial: 0, fold: (acc: number) => acc, resetOn: ["host"] },
      },
    } as unknown as IState);
    const registry = getScanRegistry(stateEl)!;
    expect([...registry.eventResetByPath.get("host")!].map((entry) => entry.name)).toEqual(["count"]);
    expect(getScanEventResetGateCount()).toBe(before + 1);

    stateEl.setInitialState({ host: "a", n: 0 } as unknown as IState);
    await flushAsync();
    expect(getScanEventResetGateCount()).toBe(before);
    host.remove();
  });

  it("from を持つ state は数え、再セットで消せば数が戻ること", async () => {
    const before = getScanDrainGateCount();
    const { host, stateEl } = await connectHost("", {
      n: 0,
      $scan: { out: { from: "n", initial: 0, fold: (acc: unknown) => acc } },
    } as unknown as IState);
    expect(getScanDrainGateCount()).toBe(before + 1);

    stateEl.setInitialState({ n: 0 } as unknown as IState);
    await flushAsync();
    expect(getScanDrainGateCount()).toBe(before);
    host.remove();
  });
});
