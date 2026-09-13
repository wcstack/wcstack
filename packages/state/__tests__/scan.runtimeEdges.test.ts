/**
 * scan.runtimeEdges.test.ts
 *
 * `$scan` の drain 側発火の境界（docs/state-scan-design.md §2-1 / §2-3）。
 * 多段 wildcard の並び・先行 fold による同期の切断と再セット・他ツリーのアドレス・
 * 行を特定できないアドレス・合流する依存グラフ・drain ゲートの数え方。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { getAbsolutePathInfo } from "../src/address/AbsolutePathInfo";
import { createAbsoluteStateAddress } from "../src/address/AbsoluteStateAddress";
import { getPathInfo } from "../src/address/PathInfo";
import { bootstrapState } from "../src/bootstrapState";
import type { State } from "../src/components/State";
import { getScanDrainRegistryCount, getScanRegistry } from "../src/scan/scanRegistry";
import { getUpdater } from "../src/updater/updater";
import type { IState } from "../src/types";
import { makeManualAsyncGenerator } from "./helpers/fakeStreamSources";
import { flushAsync, makeConnectHost } from "./helpers/streamTestUtils";

beforeAll(() => {
  bootstrapState();
});

const connectHost = makeConnectHost("scan-edge-host");

function write(stateEl: State, fn: (state: any) => void): void {
  stateEl.createState("writable", fn);
}

function read<T>(stateEl: State, fn: (state: any) => T): T {
  let value: T | undefined;
  stateEl.createState("readonly", (state) => {
    value = fn(state);
  });
  return value as T;
}

async function flush(times = 2): Promise<void> {
  for (let i = 0; i < times; i++) {
    await flushAsync();
  }
}

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
    await flush();

    write(stateEl, (s) => {
      s.$resolve("groups.*.items.*.qty", [1, 0], 30);
      s.$resolve("groups.*.items.*.qty", [0, 1], 20);
      s.$resolve("groups.*.items.*.qty", [0, 0], 10);
    });
    await flush(3);

    expect(read(stateEl, (s) => s.log)).toEqual(["0.0:10", "0.1:20", "1.0:30"]);
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

    write(stateEl, (s) => { s.n = 1; });
    await flush();

    expect(foldB).not.toHaveBeenCalled();
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

    write(stateEl, (s) => { s.n = 1; });
    await flush();

    expect(foldB).not.toHaveBeenCalled();
    // 収集はバッチの時点で終わっているので、差し替え後の宣言もこのバッチでは畳まない
    expect(foldReplacement).not.toHaveBeenCalled();
    host.remove();
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
    write(b.stateEl, (s) => { s.n = 1; });
    write(c.stateEl, (s) => { s.n = 1; });
    await flush();

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
    await flush();

    getUpdater().testApplyChange([
      createAbsoluteStateAddress(getAbsolutePathInfo(stateEl, getPathInfo("items.*.qty")), null),
    ]);
    await flush();

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
    expect(read(stateEl, (s) => s.total)).toBe(0);

    write(stateEl, (s) => { s.page = 2; });
    await flush();

    expect(read(stateEl, (s) => s["$streamStatus.pageResult"])).toBe("active");
    host.remove();
  });
});

describe("drain ゲートの数え方", () => {
  it("on だけの scan の registry は drain ゲートに数えず、作り直しても数は変わらないこと", async () => {
    const before = getScanDrainRegistryCount();
    const { host, stateEl } = await connectHost("", {
      $eventTokens: ["tick"],
      $scan: { count: { on: "tick", initial: 0, fold: (acc: number) => acc + 1 } },
    } as unknown as IState);
    expect(getScanRegistry(stateEl)).toBeDefined();
    expect(getScanDrainRegistryCount()).toBe(before);

    stateEl.setInitialState({ $eventTokens: ["tick"] } as unknown as IState);
    await flushAsync();
    expect(getScanRegistry(stateEl)).toBeUndefined();
    expect(getScanDrainRegistryCount()).toBe(before);
    host.remove();
  });

  it("from を持つ registry は数え、再セットで消せば数が戻ること", async () => {
    const before = getScanDrainRegistryCount();
    const { host, stateEl } = await connectHost("", {
      n: 0,
      $scan: { out: { from: "n", initial: 0, fold: (acc: unknown) => acc } },
    } as unknown as IState);
    expect(getScanDrainRegistryCount()).toBe(before + 1);

    stateEl.setInitialState({ n: 0 } as unknown as IState);
    await flushAsync();
    expect(getScanDrainRegistryCount()).toBe(before);
    host.remove();
  });
});
