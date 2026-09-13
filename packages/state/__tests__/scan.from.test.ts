/**
 * scan.from.test.ts
 *
 * `$scan` の `from`（state パスの変化を畳む）と `resetOn` の drain 側の発火
 * （docs/state-scan-design.md §2-1 / D3〜D6 / D10 / D11 / D12）。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { getAbsolutePathInfo } from "../src/address/AbsolutePathInfo";
import { createAbsoluteStateAddress } from "../src/address/AbsoluteStateAddress";
import { getPathInfo } from "../src/address/PathInfo";
import { bootstrapState } from "../src/bootstrapState";
import type { State } from "../src/components/State";
import { setDevtoolsSink } from "../src/devtools/sink";
import { getUpdater } from "../src/updater/updater";
import { getActiveWatchStateElements } from "../src/watch/watchRegistry";
import type { IState } from "../src/types";
import { makeManualAsyncGenerator } from "./helpers/fakeStreamSources";
import { flushTimes, makeConnectHost, readState, writeState } from "./helpers/streamTestUtils";

beforeAll(() => {
  bootstrapState();
});

const connectHost = makeConnectHost("scan-from-host");

describe("from: 発火単位と fold の引数", () => {
  it("バインドが無くても、from の書き込み 1 回につき fold 1 回で出力が更新されること", async () => {
    const fold = vi.fn((acc: number, cur: number) => acc + cur);
    const { host, stateEl } = await connectHost("", {
      n: 0,
      $scan: { total: { from: "n", initial: 0, fold } },
    } as unknown as IState);

    expect(getActiveWatchStateElements().has(stateEl)).toBe(true);
    expect(stateEl.scanPaths?.has("n")).toBe(true);

    writeState(stateEl, (s) => { s.n = 2; });
    await flushTimes();
    writeState(stateEl, (s) => { s.n = 3; });
    await flushTimes();

    expect(fold).toHaveBeenCalledTimes(2);
    expect(readState(stateEl, (s) => s.total)).toBe(5);
    host.remove();
  });

  it("fold は (acc, cur, prev) を受け、this は undefined であること（$watch 無しでも prev が取れる）", async () => {
    const calls: unknown[][] = [];
    let seenThis: unknown = "unset";
    const fold = function (this: unknown, acc: unknown, cur: unknown, prev: unknown): unknown {
      seenThis = this;
      calls.push([acc, cur, prev]);
      return acc;
    };
    const { host, stateEl } = await connectHost("", {
      n: 1,
      $scan: { out: { from: "n", initial: "seed", fold } },
    } as unknown as IState);

    writeState(stateEl, (s) => { s.n = 2; });
    await flushTimes();

    expect(calls).toEqual([["seed", 2, 1]]);
    expect(seenThis).toBeUndefined();
    host.remove();
  });

  it("同一 job 内の複数書き込みは 1 回の fold に畳まれること（変化の scan、D3）", async () => {
    const fold = vi.fn((_acc: unknown, cur: unknown, prev: unknown) => `${prev}->${cur}`);
    const { host, stateEl } = await connectHost("", {
      n: 0,
      $scan: { out: { from: "n", initial: "", fold } },
    } as unknown as IState);

    writeState(stateEl, (s) => { s.n = 1; s.n = 2; s.n = 3; });
    await flushTimes();

    expect(fold).toHaveBeenCalledTimes(1);
    expect(readState(stateEl, (s) => s.out)).toBe("0->3");
    host.remove();
  });

  it("acc と同一参照を返すと書き込まず、出力を見る $watch も鳴らないこと", async () => {
    const watch = vi.fn();
    const { host, stateEl } = await connectHost("", {
      n: 0,
      $scan: { out: { from: "n", initial: { v: 0 }, fold: (acc: unknown) => acc } },
      $watch: { out: watch },
    } as unknown as IState);

    writeState(stateEl, (s) => { s.n = 1; });
    await flushTimes(3);

    expect(watch).not.toHaveBeenCalled();
    host.remove();
  });

  it("祖先への丸ごと書き込みでも from が載り、prev は undefined であること（G8-c）", async () => {
    const { host, stateEl } = await connectHost("", {
      obj: { x: 1 },
      $scan: { out: { from: "obj.x", initial: [], fold: (acc: unknown[], cur: unknown, prev: unknown) => [...acc, [cur, prev]] } },
    } as unknown as IState);

    writeState(stateEl, (s) => { s.obj = { x: 2 }; });
    await flushTimes();

    expect(readState(stateEl, (s) => s.out)).toEqual([[2, undefined]]);
    host.remove();
  });
});

describe("from: 機構間の順序と同居（D11 / D12）", () => {
  it("同じバッチでは scan が $watch より先に発火すること", async () => {
    const order: string[] = [];
    const { host, stateEl } = await connectHost("", {
      n: 0,
      $scan: { out: { from: "n", initial: 0, fold: (_acc: unknown, cur: unknown) => { order.push("scan"); return cur; } } },
      $watch: { n() { order.push("watch"); } },
    } as unknown as IState);

    writeState(stateEl, (s) => { s.n = 1; });
    await flushTimes();

    expect(order).toEqual(["scan", "watch"]);
    host.remove();
  });

  it("scan の出力を $watch すると次のバッチで発火し、prev は undefined であること（D12）", async () => {
    const watch = vi.fn();
    const { host, stateEl } = await connectHost("", {
      n: 0,
      $scan: { count: { from: "n", initial: 0, fold: (acc: number) => acc + 1 } },
      $watch: { count: watch },
    } as unknown as IState);

    writeState(stateEl, (s) => { s.n = 5; });
    await flushTimes(3);

    expect(watch).toHaveBeenCalledTimes(1);
    expect(watch).toHaveBeenCalledWith(1, undefined);
    host.remove();
  });

  it("同じパスを $watch と 2 つの scan が見る形で、それぞれ 1 回ずつ発火すること", async () => {
    const watch = vi.fn();
    const foldA = vi.fn((acc: number) => acc + 1);
    const foldB = vi.fn((acc: number) => acc + 10);
    const { host, stateEl } = await connectHost("", {
      n: 0,
      $scan: {
        a: { from: "n", initial: 0, fold: foldA },
        b: { from: "n", initial: 0, fold: foldB },
      },
      $watch: { n: watch },
    } as unknown as IState);

    writeState(stateEl, (s) => { s.n = 1; });
    await flushTimes();

    expect(watch).toHaveBeenCalledTimes(1);
    expect(foldA).toHaveBeenCalledTimes(1);
    expect(foldB).toHaveBeenCalledTimes(1);
    expect(readState(stateEl, (s) => [s.a, s.b])).toEqual([1, 10]);
    host.remove();
  });

  it("scan の出力を別の scan の from に取ると、次のドレインで畳まれること", async () => {
    const { host, stateEl } = await connectHost("", {
      n: 0,
      $scan: {
        doubled: { from: "n", initial: 0, fold: (_acc: unknown, cur: number) => cur * 2 },
        history: { from: "doubled", initial: [], fold: (acc: unknown[], cur: unknown) => [...acc, cur] },
      },
    } as unknown as IState);

    writeState(stateEl, (s) => { s.n = 1; });
    await flushTimes(3);
    writeState(stateEl, (s) => { s.n = 4; });
    await flushTimes(3);

    expect(readState(stateEl, (s) => s.history)).toEqual([2, 8]);
    host.remove();
  });

  it.each([
    ["上流 → 下流", true],
    ["下流 → 上流", false],
  ])("連鎖した scan は、同じ drain で先行 scan が書いた値を先取りせず、着地した値を 1 回ずつ畳むこと（宣言順 %s、D18）", async (_label, upstreamFirst) => {
    // $watch が上流の source を書くので、上流 scan の書き込みと source が同じバッチに合流する。
    // 1 相で「畳んでは書く」実装だと、上流を先に宣言したとき history が [3, 6, 6] になる
    const total = { from: "count", initial: 0, fold: (acc: number, cur: number) => acc + cur };
    const history = { from: "total", initial: [], fold: (acc: unknown[], cur: unknown) => [...acc, cur] };
    const { host, stateEl } = await connectHost("", {
      count: 0,
      $scan: upstreamFirst ? { total, history } : { history, total },
      $watch: { count(this: any) { if (this.count < 3) this.count = this.count + 1; } },
    } as unknown as IState);

    writeState(stateEl, (s) => { s.count = 1; });
    await flushTimes(12);

    expect(readState(stateEl, (s) => [s.total, s.history])).toEqual([6, [1, 3, 6]]);
    host.remove();
  });

  it("on だけの scan は drain を要らないので、発火対象集合に載らないこと", async () => {
    const { host, stateEl } = await connectHost("", {
      $eventTokens: ["tick"],
      $scan: { count: { on: "tick", initial: 0, fold: (acc: number) => acc + 1 } },
    } as unknown as IState);

    expect(stateEl.scanPaths).toBeNull();
    expect(getActiveWatchStateElements().has(stateEl)).toBe(false);
    host.remove();
  });
});

describe("from: wildcard（行ごとの fold）", () => {
  it("同じバッチの複数行は indexes 昇順に acc を連鎖し、出力へは 1 回だけ書くこと", async () => {
    const watch = vi.fn();
    const { host, stateEl } = await connectHost(
      `<template data-wcs="for: items"><span data-wcs="textContent: .qty"></span></template>`,
      {
        items: [{ qty: 1 }, { qty: 2 }],
        $scan: {
          log: {
            from: "items.*.qty",
            initial: [],
            fold: (acc: string[], cur: unknown, prev: unknown, index: number) => [...acc, `${index}:${prev}->${cur}`],
          },
        },
        $watch: { log: watch },
      } as unknown as IState,
    );
    await flushTimes();

    writeState(stateEl, (s) => {
      s.$resolve("items.*.qty", [1], 20);
      s.$resolve("items.*.qty", [0], 10);
    });
    await flushTimes(3);

    expect(readState(stateEl, (s) => s.log)).toEqual(["0:1->10", "1:2->20"]);
    expect(watch).toHaveBeenCalledTimes(1);
    host.remove();
  });
});

describe("resetOn（D6）", () => {
  it("resetOn のパスが載ったら出力を initial に戻し、同じバッチの fold は行わないこと", async () => {
    const initial: number[] = [];
    const fold = vi.fn((acc: number[], cur: number) => [...acc, cur]);
    const { host, stateEl } = await connectHost("", {
      host: "a",
      n: 0,
      $scan: { log: { from: "n", initial, fold, resetOn: ["host"] } },
    } as unknown as IState);

    writeState(stateEl, (s) => { s.n = 1; });
    await flushTimes();
    writeState(stateEl, (s) => { s.n = 2; });
    await flushTimes();
    expect(readState(stateEl, (s) => s.log)).toEqual([1, 2]);

    writeState(stateEl, (s) => { s.host = "b"; s.n = 3; });
    await flushTimes();
    expect(readState(stateEl, (s) => s.log)).toBe(initial);
    expect(fold).toHaveBeenCalledTimes(2);

    writeState(stateEl, (s) => { s.n = 4; });
    await flushTimes();
    expect(readState(stateEl, (s) => s.log)).toEqual([4]);
    host.remove();
  });

  it("resetOn が from の祖先なら、行の書き込みは畳み、親の差し替えで initial に戻ること", async () => {
    const initial: unknown[] = [];
    const { host, stateEl } = await connectHost(
      `<template data-wcs="for: items"><span data-wcs="textContent: .qty"></span></template>`,
      {
        items: [{ qty: 1 }],
        $scan: { log: { from: "items.*.qty", initial, fold: (acc: unknown[], cur: unknown) => [...acc, cur], resetOn: ["items"] } },
      } as unknown as IState,
    );
    await flushTimes();

    writeState(stateEl, (s) => { s.$resolve("items.*.qty", [0], 5); });
    await flushTimes(3);
    expect(readState(stateEl, (s) => s.log)).toEqual([5]);

    // 差し替えで載る新しい行よりも reset が勝つ
    writeState(stateEl, (s) => { s.items = [{ qty: 7 }]; });
    await flushTimes(3);
    expect(readState(stateEl, (s) => s.log)).toBe(initial);
    host.remove();
  });

  it("出力が initial のままなら reset は書き込まないこと", async () => {
    const watch = vi.fn();
    const { host, stateEl } = await connectHost("", {
      host: "a",
      n: 0,
      $scan: { log: { from: "n", initial: [], fold: (acc: unknown) => acc, resetOn: ["host"] } },
      $watch: { log: watch },
    } as unknown as IState);

    writeState(stateEl, (s) => { s.host = "b"; });
    await flushTimes(3);

    expect(watch).not.toHaveBeenCalled();
    host.remove();
  });
});

describe("失敗の隔離（D4）", () => {
  it("fold の throw は報告して書かず、他の scan は続行すること（devtools にも phase: fold で流す）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const events: unknown[] = [];
    setDevtoolsSink((event) => { events.push(event); });
    try {
      const { host, stateEl } = await connectHost("", {
        n: 0,
        $scan: {
          bad: { from: "n", initial: 0, fold: () => { throw new Error("boom"); } },
          good: { from: "n", initial: 0, fold: (acc: number) => acc + 1 },
        },
      } as unknown as IState);

      writeState(stateEl, (s) => { s.n = 1; });
      await flushTimes();

      expect(readState(stateEl, (s) => [s.bad, s.good])).toEqual([0, 1]);
      expect(errorSpy.mock.calls.some((call) => String(call[0]).includes(`$scan fold for "bad" threw`))).toBe(true);
      expect(events).toContainEqual(expect.objectContaining({ type: "state:watch-error", phase: "fold", path: "$scan.bad" }));
      host.remove();
    } finally {
      setDevtoolsSink(null);
      errorSpy.mockRestore();
    }
  });

  it("出力への書き込みが throw しても報告して、後続の scan は書き込むこと", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setDevtoolsSink((event: any) => {
      if (event.type === "state:write" && event.absoluteAddress.absolutePathInfo.pathInfo.path === "bad") {
        throw new Error("write refused");
      }
    });
    try {
      const { host, stateEl } = await connectHost("", {
        n: 0,
        $scan: {
          bad: { from: "n", initial: 0, fold: (acc: number) => acc + 1 },
          good: { from: "n", initial: 0, fold: (acc: number) => acc + 1 },
        },
      } as unknown as IState);

      writeState(stateEl, (s) => { s.n = 1; });
      await flushTimes();

      expect(readState(stateEl, (s) => [s.bad, s.good])).toEqual([0, 1]);
      expect(errorSpy.mock.calls.some((call) => String(call[0]).includes(`$scan could not write the output "bad"`))).toBe(true);
      host.remove();
    } finally {
      setDevtoolsSink(null);
      errorSpy.mockRestore();
    }
  });

  it("fold が Promise を返したら報告して書かず、後から reject しても unhandled にならないこと", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { host, stateEl } = await connectHost("", {
        n: 0,
        $scan: { out: { from: "n", initial: "seed", fold: () => Promise.reject(new Error("later")) } },
      } as unknown as IState);

      writeState(stateEl, (s) => { s.n = 1; });
      await flushTimes(3);

      expect(readState(stateEl, (s) => s.out)).toBe("seed");
      const reported = errorSpy.mock.calls.find((call) => String(call[0]).includes(`$scan fold for "out" returned a Promise`));
      expect(String((reported?.[1] as Error).message)).toMatch(/returned a Promise/);
      host.remove();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("接ぎ木で後から getter になった from は、1 回だけ報告して畳まないこと（D5 後段）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const fold = vi.fn((acc: number) => acc + 1);
      const { host, stateEl } = await connectHost("", {
        vol: { x: 1 },
        $scan: { out: { from: "vol.x", initial: 0, fold } },
      } as unknown as IState);

      stateEl.defineTreeAccessor("vol.x", { get() { return 42; }, enumerable: false, configurable: true });
      writeState(stateEl, (s) => { s.$postUpdate("vol.x"); });
      await flushTimes();
      writeState(stateEl, (s) => { s.$postUpdate("vol.x"); });
      await flushTimes();

      expect(fold).not.toHaveBeenCalled();
      const reports = errorSpy.mock.calls.filter((call) => String(call[0]).includes("[wcs/scan-source-computed]"));
      expect(reports).toHaveLength(1);
      host.remove();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("from のパスが state に無ければ wcs/scan-path-missing で報告すること", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { host } = await connectHost("", {
        user: { name: "a" },
        $scan: { out: { from: "user.nmae", initial: 0, fold: (acc: unknown) => acc } },
      } as unknown as IState);

      expect(warnSpy.mock.calls.some((call) => String(call[0]).includes(`[wcs/scan-path-missing] $scan path "user.nmae"`))).toBe(true);
      host.remove();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("$streams との交差（D9 / D10）", () => {
  function abs(stateEl: State, path: string) {
    return createAbsoluteStateAddress(getAbsolutePathInfo(stateEl, getPathInfo(path)), null);
  }

  it("同じバッチにその stream の restart 依存が載っていたら畳まないこと（restart が勝つ、D10）", async () => {
    const runs: unknown[] = [];
    const { host, stateEl } = await connectHost("", {
      page: 1,
      $streams: {
        pageResult: {
          args: (s: any) => s.page,
          source: (page: unknown) => { runs.push(page); return makeManualAsyncGenerator<unknown>().iterable; },
        },
      },
      $scan: {
        feed: { from: "pageResult", initial: [], fold: (acc: unknown[], chunk: unknown) => (chunk === undefined ? acc : [...acc, chunk]) },
      },
    } as unknown as IState);
    expect(runs).toEqual([1]);
    const raw = (stateEl as any).__state;

    // 対照: chunk だけのバッチは畳む
    raw.pageResult = "c1";
    getUpdater().testApplyChange([abs(stateEl, "pageResult")]);
    await flushTimes();
    expect(readState(stateEl, (s) => s.feed)).toEqual(["c1"]);

    // chunk と restart 依存（page）が同じバッチ: 畳まずに restart させる
    raw.pageResult = "c2";
    raw.page = 2;
    getUpdater().testApplyChange([abs(stateEl, "pageResult"), abs(stateEl, "page")]);
    await flushTimes();
    expect(readState(stateEl, (s) => s.feed)).toEqual(["c1"]);
    expect(runs).toEqual([1, 2]);
    host.remove();
  });

  it("stream の args が scan 出力から導出した getter を読むと、restart では $streamError に正規化されること（D9）", async () => {
    let derived = false;
    const { host, stateEl } = await connectHost("", {
      mode: 0,
      get page(this: any) { return Math.floor(this.feed.length / 2) + 1; },
      $streams: {
        pageResult: {
          args: (s: any) => (derived ? s.page : s.mode),
          source: () => makeManualAsyncGenerator<unknown>().iterable,
        },
      },
      $scan: {
        feed: { from: "pageResult", initial: [], fold: (acc: unknown[], chunk: unknown) => (chunk === undefined ? acc : [...acc, chunk]) },
      },
    } as unknown as IState);
    expect(readState(stateEl, (s) => s["$streamStatus.pageResult"])).toBe("active");

    derived = true;
    writeState(stateEl, (s) => { s.mode = 1; });
    await flushTimes();

    expect(readState(stateEl, (s) => s["$streamStatus.pageResult"])).toBe("error");
    expect(String(readState(stateEl, (s) => s["$streamError.pageResult"]))).toContain("[wcs/scan-feedback-loop]");
    host.remove();
  });

  it("stream の args が scan 出力を直接読んでも raise すること（依存グラフの起点そのもの）", async () => {
    let direct = false;
    const { host, stateEl } = await connectHost("", {
      mode: 0,
      $streams: {
        pageResult: {
          args: (s: any) => (direct ? s.feed : s.mode),
          source: () => makeManualAsyncGenerator<unknown>().iterable,
        },
      },
      $scan: { feed: { from: "pageResult", initial: [], fold: (acc: unknown) => acc } },
    } as unknown as IState);

    direct = true;
    writeState(stateEl, (s) => { s.mode = 1; });
    await flushTimes();

    expect(String(readState(stateEl, (s) => s["$streamError.pageResult"]))).toContain(`args read "feed"`);
    host.remove();
  });

  it("カーソルが plain property なら raise しないこと（intersect-scroll の書き直しの形）", async () => {
    const { host, stateEl } = await connectHost("", {
      page: 1,
      $streams: {
        pageResult: { args: (s: any) => s.page, source: () => makeManualAsyncGenerator<unknown>().iterable },
      },
      $scan: { feed: { from: "pageResult", initial: [], fold: (acc: unknown) => acc } },
    } as unknown as IState);

    writeState(stateEl, (s) => { s.page = 2; });
    await flushTimes();

    expect(readState(stateEl, (s) => s["$streamStatus.pageResult"])).toBe("active");
    host.remove();
  });

  it("from の根が別の stream なら、この stream の args が scan 出力を読んでも raise しないこと", async () => {
    let readFeed = false;
    const { host, stateEl } = await connectHost("", {
      mode: 0,
      $streams: {
        upstream: { source: () => makeManualAsyncGenerator<unknown>().iterable },
        downstream: {
          args: (s: any) => (readFeed ? s.feed : s.mode),
          source: () => makeManualAsyncGenerator<unknown>().iterable,
        },
      },
      $scan: { feed: { from: "upstream", initial: [], fold: (acc: unknown) => acc } },
    } as unknown as IState);

    readFeed = true;
    writeState(stateEl, (s) => { s.mode = 1; });
    await flushTimes();

    expect(readState(stateEl, (s) => s["$streamStatus.downstream"])).toBe("active");
    host.remove();
  });
});
