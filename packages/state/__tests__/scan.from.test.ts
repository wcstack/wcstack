/**
 * scan.from.test.ts
 *
 * `$scan` の `from`（state パスの変化を畳む）と `resetOn` の drain 側の発火
 * （docs/state-scan-design.md §2-1 / D3〜D6 / D10 / D11 / D12）。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { getTreePath } from "../src/address/TreePath";
import { createAbsoluteStateAddress } from "../src/address/AbsoluteStateAddress";
import { getPathInfo } from "../src/address/PathInfo";
import { bootstrapState } from "../src/bootstrapState";
import type { State } from "../src/components/State";
import { setDevtoolsSink } from "../src/platform/devtoolsSink";
import { getListIndexesByList } from "../src/list/listIndexesByList";
import { startStreams } from "../src/stream/streamRuntime";
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

  it("prev は書き込む新しい値がプリミティブのときに記録され（旧値はオブジェクトでもよい）、新しい値が参照型なら undefined になること（$watch と同じ台帳）", async () => {
    const tag = (value: unknown): unknown => (typeof value === "object" && value !== null ? "<obj>" : value);
    const watched: unknown[] = [];
    const { host, stateEl } = await connectHost("", {
      v: 1,
      $scan: { log: { from: "v", initial: [], fold: (acc: unknown[], cur: unknown, prev: unknown) => [...acc, [tag(cur), tag(prev)]] } },
      $watch: { v(cur: unknown, prev: unknown) { watched.push([tag(cur), tag(prev)]); } },
    } as unknown as IState);

    for (const next of [{ a: 1 }, { a: 2 }, 5, 6]) {
      writeState(stateEl, (s) => { s.v = next; });
      await flushTimes(3);
    }

    // プリミティブ → オブジェクト、オブジェクト → オブジェクト、オブジェクト → プリミティブ、プリミティブ → プリミティブ
    const expected = [["<obj>", undefined], ["<obj>", undefined], [5, "<obj>"], [6, 5]];
    expect(readState(stateEl, (s) => s.log)).toEqual(expected);
    expect(watched).toEqual(expected);
    host.remove();
  });

  it("バインディングの適用中に $updatedCallback が from を書くと prev は undefined で、drain の外の書き込みは旧値を持つこと", async () => {
    const { host, stateEl } = await connectHost(`<span data-wcs="textContent: trigger"></span>`, {
      trigger: 0,
      n: 0,
      $scan: { log: { from: "n", initial: [], fold: (acc: unknown[], cur: unknown, prev: unknown) => [...acc, [cur, prev]] } },
      $updatedCallback(this: any) {
        if (this.trigger === 1 && this.n === 0) this.n = 10;
      },
    } as unknown as IState);
    await flushTimes();

    writeState(stateEl, (s) => { s.trigger = 1; });
    await flushTimes(3);
    // 台帳は $updatedCallback が走った drain の終わりに消え、n が載る次のバッチには残らない
    expect(readState(stateEl, (s) => s.log)).toEqual([[10, undefined]]);

    writeState(stateEl, (s) => { s.n = 11; });
    await flushTimes(3);
    expect(readState(stateEl, (s) => s.log)).toEqual([[10, undefined], [11, 10]]);
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

  it("連鎖深さの上限を超えたバッチでは、$watch と一緒に scan も畳まないこと", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { host, stateEl } = await connectHost("", {
        n: 0,
        $scan: { count: { from: "n", initial: 0, fold: (acc: number) => acc + 1 } },
        $watch: { n(this: any) { if (this.n < 40) this.n = this.n + 1; } },
      } as unknown as IState);

      writeState(stateEl, (s) => { s.n = 1; });
      await flushTimes(50);

      expect(errorSpy.mock.calls.some((call) => String(call[0]).includes("$scan folds and $watch handlers for this batch were skipped"))).toBe(true);
      // 深さ 0〜32 のバッチ（n = 1〜33 の着地）は畳み、n = 34 が着地した深さ 33 のバッチは畳まない
      expect(readState(stateEl, (s) => [s.n, s.count])).toEqual([34, 33]);
      host.remove();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("出力の source を $watch ハンドラが書き進め、出力の着地と source の新しい着地が同じバッチに載ると、出力を見る $watch は prev に前の着地を受け、cur が 1 段先行し、同じ値で 2 回発火し得ること（D12 の契約）", async () => {
    const totals: unknown[][] = [];
    const seenByCount: unknown[][] = [];
    const { host, stateEl } = await connectHost("", {
      count: 0,
      $scan: { total: { from: "count", initial: 0, fold: (acc: number, cur: number) => acc + cur } },
      $watch: {
        count(this: any) {
          seenByCount.push([this.count, this.total]);
          if (this.count < 3) this.count = this.count + 1;
        },
        total(cur: unknown, prev: unknown) { totals.push([cur, prev]); },
      },
    } as unknown as IState);

    writeState(stateEl, (s) => { s.count = 1; });
    await flushTimes(12);

    // 着地 1 は見えず、prev は前の着地を持ち、6 は 2 回（同じ値の 2 回目は prev undefined）
    expect(totals).toEqual([[3, 1], [6, 3], [6, undefined]]);
    // 同じ drain の $watch ハンドラは、この drain で畳んで書いた後の出力を読む
    expect(seenByCount).toEqual([[1, 1], [2, 3], [3, 6]]);
    expect(readState(stateEl, (s) => s.total)).toBe(6);
    host.remove();
  });

  it("$watch ハンドラは scan の書き込みの後に走るので、同じ drain でハンドラが出力へ書いた値が残ること（fold）", async () => {
    const { host, stateEl } = await connectHost("", {
      n: 0,
      $scan: { log: { from: "n", initial: [], fold: (acc: unknown[], cur: unknown) => [...acc, cur] } },
      $watch: { n(this: any) { if (this.n === 2) this.log = []; } },
    } as unknown as IState);

    writeState(stateEl, (s) => { s.n = 1; });
    await flushTimes(4);
    writeState(stateEl, (s) => { s.n = 2; });
    await flushTimes(4);
    // n = 2 の着地は [1, 2] に畳まれて書かれ、その後にハンドラが [] を書く
    expect(readState(stateEl, (s) => s.log)).toEqual([]);

    writeState(stateEl, (s) => { s.n = 3; });
    await flushTimes(4);
    expect(readState(stateEl, (s) => s.log), "以後はハンドラの値から畳む").toEqual([3]);
    host.remove();
  });

  it("$watch ハンドラは reset の書き込みの後に走るので、ハンドラが書いた seed が残ること", async () => {
    const { host, stateEl } = await connectHost("", {
      n: 0,
      host: "a",
      $scan: { log: { from: "n", initial: [], fold: (acc: unknown[], cur: unknown) => [...acc, cur], resetOn: ["host"] } },
      $watch: { host(this: any) { this.log = [`seed:${this.host}`]; } },
    } as unknown as IState);

    writeState(stateEl, (s) => { s.n = 1; });
    await flushTimes(4);
    writeState(stateEl, (s) => { s.host = "b"; });
    await flushTimes(4);
    expect(readState(stateEl, (s) => s.log)).toEqual(["seed:b"]);
    host.remove();
  });

  it("同じ job で source と、出力を書く $watch のパスを書くと、ハンドラの値が残ること", async () => {
    const { host, stateEl } = await connectHost("", {
      n: 0,
      clear: 0,
      $scan: { total: { from: "n", initial: 0, fold: (acc: number, cur: number) => acc + cur } },
      $watch: { clear(this: any) { this.total = 0; } },
    } as unknown as IState);

    writeState(stateEl, (s) => { s.n = 5; });
    await flushTimes(4);
    writeState(stateEl, (s) => { s.n = 6; s.clear = 1; });
    await flushTimes(4);
    expect(readState(stateEl, (s) => s.total)).toBe(0);
    host.remove();
  });

  it("ハンドラが scan の書き込みの後に、畳む前と同じ値・同じ参照を書いてもハンドラの値が残り、現在の値の自己再代入は無害であること", async () => {
    // 同じプリミティブ（same-value guard が enqueue 前に返す形）
    const primitive = await connectHost("", {
      n: 0,
      clear: 0,
      $scan: { total: { from: "n", initial: 0, fold: (acc: number, cur: number) => acc + cur } },
      $watch: { clear(this: any) { this.total = 0; } },
    } as unknown as IState);
    writeState(primitive.stateEl, (s) => { s.n = 6; s.clear = 1; });
    await flushTimes(4);
    expect(readState(primitive.stateEl, (s) => s.total)).toBe(0);
    primitive.host.remove();

    // 同じ参照（initial のまま）
    const INITIAL: unknown[] = [];
    const reference = await connectHost("", {
      n: 0,
      clear: 0,
      $scan: { log: { from: "n", initial: INITIAL, fold: (acc: unknown[], cur: unknown) => [...acc, cur] } },
      $watch: { clear(this: any) { this.log = INITIAL; } },
    } as unknown as IState);
    writeState(reference.stateEl, (s) => { s.n = 6; s.clear = 1; });
    await flushTimes(4);
    expect(readState(reference.stateEl, (s) => s.log)).toBe(INITIAL);
    reference.host.remove();

    // 現在の値（畳んで書いた後の [1, 2]）の自己再代入は無害
    const self = await connectHost("", {
      n: 0,
      freeze: 0,
      $scan: { log: { from: "n", initial: [], fold: (acc: unknown[], cur: unknown) => [...acc, cur] } },
      $watch: { freeze(this: any) { this.log = this.log; } },
    } as unknown as IState);
    writeState(self.stateEl, (s) => { s.n = 1; });
    await flushTimes(4);
    writeState(self.stateEl, (s) => { s.n = 2; s.freeze = 1; });
    await flushTimes(4);
    expect(readState(self.stateEl, (s) => s.log)).toEqual([1, 2]);
    self.host.remove();
  });

  it("出力の下のパスへの書き込みと $resolve も scan の書き込みの後に効き、他の state の同名パスへの書き込みはこの state の出力に影響しないこと", async () => {
    // 出力の下のパス
    const child = await connectHost("", {
      n: 0,
      clear: 0,
      $scan: { feed: { from: "n", initial: { items: [] }, fold: (acc: any, cur: number) => ({ items: [...acc.items, cur] }) } },
      $watch: { clear(this: any) { this["feed.items"] = ["cleared"]; } },
    } as unknown as IState);
    writeState(child.stateEl, (s) => { s.n = 1; s.clear = 1; });
    await flushTimes(4);
    expect(readState(child.stateEl, (s) => s["feed.items"])).toEqual(["cleared"]);
    child.host.remove();

    // $resolve（値付き）
    const resolved = await connectHost("", {
      n: 0,
      clear: 0,
      $scan: { total: { from: "n", initial: 0, fold: (acc: number, cur: number) => acc + cur } },
      $watch: { clear(this: any) { this.$resolve("total", [], 0); } },
    } as unknown as IState);
    writeState(resolved.stateEl, (s) => { s.n = 6; s.clear = 1; });
    await flushTimes(4);
    expect(readState(resolved.stateEl, (s) => s.total)).toBe(0);
    resolved.host.remove();

    // 他の state の同名パスへの書き込み
    const other = await connectHost("", { total: 0 } as unknown as IState);
    const owner = await connectHost("", {
      n: 0,
      $scan: { total: { from: "n", initial: 0, fold: (acc: number, cur: number) => acc + cur } },
      $watch: { n() { writeState(other.stateEl, (s) => { s.total = 99; }); } },
    } as unknown as IState);
    writeState(owner.stateEl, (s) => { s.n = 1; });
    await flushTimes(4);
    expect(readState(owner.stateEl, (s) => s.total)).toBe(1);
    expect(readState(other.stateEl, (s) => s.total)).toBe(99);
    owner.host.remove();
    other.host.remove();
  });

  it("連鎖した scan で上流の出力を $watch ハンドラが書き直すと、同じバッチの 2 つの書き込みは 1 回の着地に畳まれ、下流はその値だけを畳むこと", async () => {
    const { host, stateEl } = await connectHost("", {
      n: 0,
      $scan: {
        a: { from: "n", initial: 0, fold: (acc: number, cur: number) => acc + cur },
        history: { from: "a", initial: [], fold: (acc: unknown[], cur: unknown) => [...acc, cur] },
      },
      $watch: { n(this: any) { if (this.n === 2) this.a = 100; } },
    } as unknown as IState);

    writeState(stateEl, (s) => { s.n = 1; });
    await flushTimes(6);
    writeState(stateEl, (s) => { s.n = 2; });
    await flushTimes(6);

    // scan の書き込み（a = 3）とハンドラの書き込み（a = 100）は次のバッチの 1 回の着地（100）になる
    expect(readState(stateEl, (s) => [s.a, s.history])).toEqual([100, [1, 100]]);
    host.remove();
  });

  it("オブジェクトの出力でも同じ連鎖では、出力を見る $watch の cur が 1 段先行し、同じ値で 2 回発火し得ること（D12 の契約）", async () => {
    const calls: unknown[][] = [];
    const { host, stateEl } = await connectHost("", {
      n: 0,
      $scan: { feed: { from: "n", initial: { items: [] }, fold: (acc: any, cur: number) => ({ items: [...acc.items, cur] }) } },
      $watch: {
        n(this: any) { if (this.n < 3) this.n = this.n + 1; },
        feed(cur: any, prev: unknown) { calls.push([cur.items.length, prev]); },
      },
    } as unknown as IState);

    writeState(stateEl, (s) => { s.n = 1; });
    await flushTimes(12);

    // 参照型の出力は prev を持たない（same-value guard が旧値を読まない）
    expect(calls).toEqual([[2, undefined], [3, undefined], [3, undefined]]);
    host.remove();
  });

  it("drain の間に走る microtask が source を書き進めても、出力の着地と同じバッチに載れば同じ契約になること（D12 の契約）", async () => {
    const calls: unknown[][] = [];
    const { host, stateEl } = await connectHost("", {
      n: 0,
      $scan: { total: { from: "n", initial: 0, fold: (acc: number, cur: number) => acc + cur } },
      $watch: { total(cur: unknown, prev: unknown) { calls.push([cur, prev]); } },
    } as unknown as IState);

    writeState(stateEl, (s) => { s.n = 1; });
    // n = 1 の drain の後、total の着地の drain の前に走る（drain のリスナーではない書き手）
    queueMicrotask(() => { writeState(stateEl, (s) => { s.n = 2; }); });
    await flushTimes(8);

    expect(calls).toEqual([[3, 1], [3, undefined]]);
    expect(readState(stateEl, (s) => s.total)).toBe(3);
    host.remove();
  });

  it("バインディングの適用中（scan の書き込みより前）に source が書かれても同じ契約になり、fold はバッチの確定値を 2 回受け取ること（D12 の契約・D3）", async () => {
    const folds: unknown[][] = [];
    const calls: unknown[][] = [];
    const { host, stateEl } = await connectHost(`<span data-wcs="textContent: count"></span>`, {
      count: 0,
      $scan: {
        total: {
          from: "count",
          initial: 0,
          fold: (acc: number, cur: number, prev: unknown) => { folds.push([cur, prev]); return acc + cur; },
        },
      },
      $watch: { total(cur: unknown, prev: unknown) { calls.push([cur, prev]); } },
      $updatedCallback(this: any) { if (this.count === 1) this.count = 2; },
    } as unknown as IState);
    await flushTimes();

    writeState(stateEl, (s) => { s.count = 1; });
    await flushTimes(8);

    // 1 は一度も畳まれず、確定値 2 が 2 回畳まれる（既存の性質・退行ではない）
    expect(folds).toEqual([[2, 0], [2, undefined]]);
    expect(calls).toEqual([[4, 2], [4, undefined]]);
    expect(readState(stateEl, (s) => s.total)).toBe(4);
    host.remove();
  });

  it("$watch ハンドラが出力の子パスへ書いても、同じ drain の fold と両立し、着地を失わないこと", async () => {
    const { host, stateEl } = await connectHost("", {
      pageResult: null,
      $scan: {
        feed: {
          from: "pageResult",
          initial: { items: [], lastKind: "" },
          fold: (acc: any, chunk: any) => (chunk === null ? acc : { ...acc, items: [...acc.items, chunk.id] }),
        },
      },
      $watch: { pageResult(this: any, chunk: any) { if (chunk !== null) this["feed.lastKind"] = chunk.kind; } },
    } as unknown as IState);

    writeState(stateEl, (s) => { s.pageResult = { kind: "success", id: 1 }; });
    await flushTimes(4);
    writeState(stateEl, (s) => { s.pageResult = { kind: "success", id: 2 }; });
    await flushTimes(4);

    // 書き込みを $watch の後に回していたときは、子パスへの注記だけで fold がまるごと捨てられ、items は [] のままだった
    expect(readState(stateEl, (s) => s.feed)).toEqual({ items: [1, 2], lastKind: "success" });
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

  it("同じ job で行を書いてからリストを新しい行で置き換えると、退役した行は畳まず、新しい行を 1 回ずつ畳むこと（D3）", async () => {
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
      } as unknown as IState,
    );
    await flushTimes();

    writeState(stateEl, (s) => {
      s.$resolve("items.*.qty", [0], 10);
      s.items = [{ qty: 7 }, { qty: 8 }];
    });
    await flushTimes(3);

    // 退役した行のアドレスを添字で読むと新しい行 0 を読むので、"0:1->7" が余分に畳まれていた
    expect(readState(stateEl, (s) => s.log)).toEqual(["0:undefined->7", "1:undefined->8"]);
    host.remove();
  });

  it("同じ job で行を書いてからリストを短くしても、消えた行は畳まず、残った行の着地は畳むこと（D3・D4）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { host, stateEl } = await connectHost(
        `<template data-wcs="for: items"><span data-wcs="textContent: .qty"></span></template>`,
        {
          items: [{ qty: 1 }, { qty: 2 }, { qty: 3 }],
          $scan: {
            log: { from: "items.*.qty", initial: [], fold: (acc: string[], cur: unknown, _prev: unknown, index: number) => [...acc, `${index}:${cur}`] },
          },
        } as unknown as IState,
      );
      await flushTimes();

      writeState(stateEl, (s) => {
        s.$resolve("items.*.qty", [0], 10);
        s.$resolve("items.*.qty", [2], 30);
        s.items = s.items.slice(0, 2);
      });
      await flushTimes(3);

      // 消えた行 2 の読みが throw し、行 0 の着地まで巻き添えで捨てられていた（log は []）
      expect(readState(stateEl, (s) => s.log)).toEqual(["0:10"]);
      expect(errorSpy).not.toHaveBeenCalled();
      host.remove();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("同じ位置に、移ってきた行の着地と外れた行の着地が並んだら、移ってきた行の着地だけを 1 回畳むこと（D3）", async () => {
    const { host, stateEl } = await connectHost(
      `<template data-wcs="for: items"><span data-wcs="textContent: .qty"></span></template>`,
      {
        items: [{ qty: 1 }, { qty: 2 }, { qty: 3 }],
        $scan: {
          log: {
            from: "items.*.qty",
            initial: [],
            fold: (acc: string[], cur: unknown, prev: unknown, index: number) => [...acc, `${index}:${prev}->${cur}`],
          },
        },
      } as unknown as IState,
    );
    await flushTimes();

    writeState(stateEl, (s) => {
      // 行 2 を書き、行 1 を書き、行 1 を取り除く — 行 2 は位置 1 へ移り、外れた行 1 も位置 1 を名乗る
      s.$resolve("items.*.qty", [2], 30);
      s.$resolve("items.*.qty", [1], 20);
      s.items = [s.items[0], s.items[2]];
    });
    await flushTimes(3);

    // 外れた行 1 を添字で読むと、移ってきた行の値を prev 2 で二重に畳む
    expect(readState(stateEl, (s) => s.log)).toEqual(["1:3->30"]);
    host.remove();
  });

  it("同じ job で行を書いてからリストを空にしたら、何も畳まず報告もしないこと", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const initial: unknown[] = [];
      const { host, stateEl } = await connectHost(
        `<template data-wcs="for: items"><span data-wcs="textContent: .qty"></span></template>`,
        {
          items: [{ qty: 1 }],
          $scan: { log: { from: "items.*.qty", initial, fold: (acc: unknown[], cur: unknown) => [...acc, cur] } },
        } as unknown as IState,
      );
      await flushTimes();

      writeState(stateEl, (s) => {
        s.$resolve("items.*.qty", [0], 10);
        s.items = [];
      });
      await flushTimes(3);

      expect(readState(stateEl, (s) => s.log)).toEqual(initial);
      expect(errorSpy).not.toHaveBeenCalled();
      host.remove();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("2 段 wildcard で内側のリストを置き換えたら、退役した内側の行は畳まず、新しい行だけを畳むこと", async () => {
    const { host, stateEl } = await connectHost(
      `<template data-wcs="for: groups"><template data-wcs="for: groups.*.items"><span data-wcs="textContent: .qty"></span></template></template>`,
      {
        groups: [{ items: [{ qty: 1 }] }],
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
      s.$resolve("groups.*.items.*.qty", [0, 0], 10);
      s.$resolve("groups.*.items", [0], [{ qty: 5 }]);
    });
    await flushTimes(3);

    expect(readState(stateEl, (s) => s.log)).toEqual(["0.0:5"]);
    host.remove();
  });
});

describe("入れ子のリストの置換と、行の取り除き（#274・docs/state-scan-design.md §5-5）", () => {
  it("入れ子のリストを長い配列に置き換えると、以前の長さを超える位置の行も着地し、scan も $watch も行ごとに畳むこと", async () => {
    // 書き込みの依存展開が、書いたパス自身のキャッシュ（書き込み前の配列）を読んで差分を取り、
    // 「変化なし」として置き換える前の行だけを展開していた（トップレベルのリストはキャッシュされないので起きなかった）
    const watch = vi.fn();
    const { host, stateEl } = await connectHost(
      `<template data-wcs="for: groups"><template data-wcs="for: groups.*.items"><span data-wcs="textContent: .qty"></span></template></template>`,
      {
        groups: [{ items: [{ qty: 1 }] }],
        $scan: {
          log: {
            from: "groups.*.items.*.qty",
            initial: [],
            fold: (acc: string[], cur: unknown, _prev: unknown, g: number, i: number) => [...acc, `${g}.${i}:${cur}`],
          },
        },
        $watch: { "groups.*.items.*.qty": watch },
      } as unknown as IState,
    );
    await flushTimes();

    writeState(stateEl, (s) => { s.$resolve("groups.*.items", [0], [{ qty: 5 }, { qty: 6 }]); });
    await flushTimes(3);

    expect(readState(stateEl, (s) => s.log)).toEqual(["0.0:5", "0.1:6"]);
    expect(watch).toHaveBeenCalledTimes(2);
    expect(watch).toHaveBeenCalledWith(5, undefined, 0, 0);
    expect(watch).toHaveBeenCalledWith(6, undefined, 0, 1);
    host.remove();
  });

  it("行を書いた同じ job でその行をリストの途中から取り除くと、移ってきた変わっていない行を畳まないこと", async () => {
    // 移ってきた行は位置だけが変わった行なので着地しない。取り除いた行のアドレスを添字で読み、
    // 移ってきた行の値を取り除いた行の prev で 1 回畳んでいた（["1:2->3"]）
    const { host, stateEl } = await connectHost(
      `<template data-wcs="for: items"><span data-wcs="textContent: .qty"></span></template>`,
      {
        items: [{ qty: 1 }, { qty: 2 }, { qty: 3 }],
        $scan: {
          log: {
            from: "items.*.qty",
            initial: [],
            fold: (acc: string[], cur: unknown, prev: unknown, index: number) => [...acc, `${index}:${prev}->${cur}`],
          },
        },
      } as unknown as IState,
    );
    await flushTimes();

    writeState(stateEl, (s) => {
      s.$resolve("items.*.qty", [1], 20);
      s.items = [s.items[0], s.items[2]];
    });
    await flushTimes(3);

    expect(readState(stateEl, (s) => s.log)).toEqual([]);
    host.remove();
  });

  it("list.* へ要素を書き込んだ位置（差分を通らない行の差し込み）は、その位置のいまの値を 1 回畳むこと", async () => {
    // 要素の書き込みは台帳のその位置へ別の行を差し込むが、差し替えられた行は退役しない。
    // 退役した行だけを捨てるので、この着地は残る
    const { host, stateEl } = await connectHost(
      `<template data-wcs="for: items"><span data-wcs="textContent: .qty"></span></template>`,
      {
        items: [{ qty: 1 }, { qty: 2 }, { qty: 3 }],
        $scan: {
          log: {
            from: "items.*.qty",
            initial: [],
            fold: (acc: string[], cur: unknown, prev: unknown, index: number) => [...acc, `${index}:${prev}->${cur}`],
          },
        },
      } as unknown as IState,
    );
    await flushTimes();

    writeState(stateEl, (s) => { s.$resolve("items.*", [1], { qty: 9 }); });
    await flushTimes(3);

    expect(readState(stateEl, (s) => s.log)).toEqual(["1:undefined->9"]);
    host.remove();
  });

  it("list.* へ要素を書き込んだ位置に、差し込まれた行の着地も並んだら、差し込まれた行の着地だけを 1 回畳むこと", async () => {
    const { host, stateEl } = await connectHost(
      `<template data-wcs="for: items"><span data-wcs="textContent: .qty"></span></template>`,
      {
        items: [{ qty: 1 }, { qty: 2 }, { qty: 3 }],
        $scan: {
          log: {
            from: "items.*.qty",
            initial: [],
            fold: (acc: string[], cur: unknown, prev: unknown, index: number) => [...acc, `${index}:${prev}->${cur}`],
          },
        },
      } as unknown as IState,
    );
    await flushTimes();

    writeState(stateEl, (s) => {
      s.$resolve("items.*.qty", [1], 20);
      s.$resolve("items.*", [1], { qty: 9 });
      s.$resolve("items.*.qty", [1], 10);
    });
    await flushTimes(3);

    expect(readState(stateEl, (s) => s.log)).toEqual(["1:9->10"]);
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
    // 宣言の initial そのものではなく、その複製に戻す（§5-9）
    expect(readState(stateEl, (s) => s.log)).toEqual(initial);
    expect(readState(stateEl, (s) => s.log)).not.toBe(initial);
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
    expect(readState(stateEl, (s) => s.log)).toEqual(initial);
    host.remove();
  });

  it("オブジェクトのパスは、そのオブジェクト自身の書き込み（同じ内容・同じ参照の再代入を含む）で reset し、子への書き込みでは reset しないこと", async () => {
    const { host, stateEl } = await connectHost("", {
      n: 0,
      filter: { text: "a" },
      $scan: { log: { from: "n", initial: [], fold: (acc: unknown[], cur: unknown) => [...acc, cur], resetOn: ["filter"] } },
    } as unknown as IState);

    writeState(stateEl, (s) => { s.n = 1; });
    await flushTimes(3);
    writeState(stateEl, (s) => { s["filter.text"] = "b"; });
    await flushTimes(3);
    expect(readState(stateEl, (s) => s.log), "子への書き込み").toEqual([1]);

    writeState(stateEl, (s) => { s.filter = { text: "b" }; });
    await flushTimes(3);
    expect(readState(stateEl, (s) => s.log), "同じ内容の再代入").toEqual([]);

    writeState(stateEl, (s) => { s.n = 2; });
    await flushTimes(3);
    const current = readState(stateEl, (s) => s.filter);
    writeState(stateEl, (s) => { s.filter = current; });
    await flushTimes(3);
    expect(readState(stateEl, (s) => s.log), "同じ参照の再代入").toEqual([]);
    host.remove();
  });

  it("getter の無い setter は resetOn の引き金にでき、書くたびに initial に戻すこと（値は読まない）", async () => {
    const state: Record<string, unknown> = {
      n: 0,
      $scan: { log: { from: "n", initial: [], fold: (acc: unknown[], cur: unknown) => [...acc, cur], resetOn: ["clear"] } },
    };
    Object.defineProperty(state, "clear", { set(_value: unknown) { /* trigger only */ }, enumerable: true, configurable: true });
    const { host, stateEl } = await connectHost("", state as unknown as IState);

    writeState(stateEl, (s) => { s.n = 1; });
    await flushTimes(3);
    writeState(stateEl, (s) => { s.n = 2; });
    await flushTimes(3);
    expect(readState(stateEl, (s) => s.log)).toEqual([1, 2]);

    writeState(stateEl, (s) => { s.clear = true; });
    await flushTimes(3);
    expect(readState(stateEl, (s) => s.log)).toEqual([]);
    host.remove();
  });

  it("出力が initial の間に子パスへ書いても宣言の initial は変わらず、reset はいつも宣言どおりの値に戻すこと（plain なデータは複製して置く）", async () => {
    const INITIAL = { items: [] as number[], note: "" };
    const { host, stateEl } = await connectHost("", {
      n: 0,
      nonce: 0,
      $scan: { feed: { from: "n", initial: INITIAL, fold: (acc: any, cur: number) => ({ ...acc, items: [...acc.items, cur] }), resetOn: ["nonce"] } },
    } as unknown as IState);
    expect(readState(stateEl, (s) => s.feed)).not.toBe(INITIAL);

    writeState(stateEl, (s) => { s["feed.note"] = "typed"; });
    await flushTimes(3);
    expect(INITIAL).toEqual({ items: [], note: "" });
    writeState(stateEl, (s) => { s.n = 1; });
    await flushTimes(3);
    writeState(stateEl, (s) => { s.nonce = 1; });
    await flushTimes(3);
    // initial を参照のまま置いていたときは { items: [], note: "typed" }
    expect(readState(stateEl, (s) => s.feed)).toEqual({ items: [], note: "" });

    writeState(stateEl, (s) => { s["feed.note"] = "again"; });
    await flushTimes(3);
    writeState(stateEl, (s) => { s.nonce = 2; });
    await flushTimes(3);
    // initial を参照のまま置いていたときは、同じ参照なので書かれず "again" のまま
    expect(readState(stateEl, (s) => s.feed)).toEqual({ items: [], note: "" });
    expect(INITIAL).toEqual({ items: [], note: "" });
    host.remove();
  });

  it("出力が initial の間に $watch ハンドラが子パスへ注記しても（C2-17 の形）、reset は宣言どおりの initial に戻すこと", async () => {
    const INITIAL = { items: [] as number[], lastKind: "none" };
    const { host, stateEl } = await connectHost("", {
      src: 0,
      nonce: 0,
      $scan: {
        feed: {
          from: "src",
          initial: INITIAL,
          fold: (acc: any, cur: number) => (cur > 1 ? { ...acc, items: [...acc.items, cur] } : acc),
          resetOn: ["nonce"],
        },
      },
      $watch: { src(this: any, cur: number) { this["feed.lastKind"] = `src${cur}`; } },
    } as unknown as IState);

    writeState(stateEl, (s) => { s.src = 1; });
    await flushTimes(4);
    writeState(stateEl, (s) => { s.src = 2; });
    await flushTimes(4);
    expect(readState(stateEl, (s) => s.feed)).toEqual({ items: [2], lastKind: "src2" });

    writeState(stateEl, (s) => { s.nonce = 1; });
    await flushTimes(4);
    // initial を参照のまま置いていたときは { items: [], lastKind: "src1" }
    expect(readState(stateEl, (s) => s.feed)).toEqual({ items: [], lastKind: "none" });
    expect(INITIAL).toEqual({ items: [], lastKind: "none" });
    host.remove();
  });

  it("plain なデータの内側にある plain でない値は宣言と同じ参照のまま置かれ、その中へ書くと宣言の initial も変わって reset でも戻らず、凍結された値へ書くと throw すること", async () => {
    class Model { x = 0; }
    const model = new Model();
    const frozen = Object.freeze({ a: 1 });
    const INITIAL = { items: [] as number[], model, frozen };
    const { host, stateEl } = await connectHost("", {
      n: 0,
      nonce: 0,
      $scan: { feed: { from: "n", initial: INITIAL, fold: (acc: any, cur: number) => ({ ...acc, items: [...acc.items, cur] }), resetOn: ["nonce"] } },
    } as unknown as IState);
    const feed = () => (stateEl as any).__state.feed;
    // plain な部分（外側と items）は複製、内側の plain でない値は同じ参照
    expect(feed()).not.toBe(INITIAL);
    expect(feed().items).not.toBe(INITIAL.items);
    expect(feed().model).toBe(model);
    expect(feed().frozen).toBe(frozen);

    writeState(stateEl, (s) => { s["feed.model.x"] = 5; });
    await flushTimes(3);
    expect(model.x, "宣言の initial の中身が変わる").toBe(5);
    expect(() => writeState(stateEl, (s) => { s["feed.frozen.a"] = 2; })).toThrow();

    writeState(stateEl, (s) => { s.n = 1; });
    await flushTimes(3);
    writeState(stateEl, (s) => { s.nonce = 1; });
    await flushTimes(3);
    expect(feed().items).toEqual([]);
    expect(feed().model).toBe(model);
    expect(feed().model.x, "reset でも戻らない").toBe(5);
    host.remove();
  });

  it("getter を持つ initial は plain なデータではないので参照のまま置き、実体化から reset まで getter を実行しないこと", async () => {
    let calls = 0;
    const INITIAL = { get count(): number { calls++; return 0; } };
    const { host, stateEl } = await connectHost("", {
      n: 0,
      nonce: 0,
      $scan: { feed: { from: "n", initial: INITIAL, fold: (_acc: unknown, cur: number) => ({ count: cur }), resetOn: ["nonce"] } },
    } as unknown as IState);
    expect((stateEl as any).__state.feed).toBe(INITIAL);

    writeState(stateEl, (s) => { s.n = 1; });
    await flushTimes(3);
    writeState(stateEl, (s) => { s.nonce = 1; });
    await flushTimes(3);
    // 作り変えていたときは、getter がデータに潰れ、reset までに 3 回呼ばれていた
    expect((stateEl as any).__state.feed).toBe(INITIAL);
    expect(calls).toBe(0);
    host.remove();
  });

  it("plain でない initial（クラスのインスタンス）は参照のまま置き、reset もその参照に戻すこと", async () => {
    class Tally { count = 0; }
    const INITIAL = new Tally();
    const { host, stateEl } = await connectHost("", {
      n: 0,
      nonce: 0,
      $scan: { tally: { from: "n", initial: INITIAL, fold: (_acc: unknown, cur: number) => Object.assign(new Tally(), { count: cur }), resetOn: ["nonce"] } },
    } as unknown as IState);
    expect(readState(stateEl, (s) => s.tally)).toBe(INITIAL);

    writeState(stateEl, (s) => { s.n = 3; });
    await flushTimes(3);
    expect(readState(stateEl, (s) => s.tally.count)).toBe(3);
    writeState(stateEl, (s) => { s.nonce = 1; });
    await flushTimes(3);
    expect(readState(stateEl, (s) => s.tally)).toBe(INITIAL);
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

describe("$listKeys × 出力（D14）", () => {
  it("出力そのもの（平坦な配列）に $listKeys を付けると、キー突合で行を描き、reset で空にし、宣言の initial を書き換えないこと", async () => {
    type Row = { id: number; v: number };
    const INIT: Row[] = [];
    const watched: number[] = [];
    const { host, shadowRoot, stateEl } = await connectHost(
      `<ul><template data-wcs="for: log"><li data-wcs="textContent: .v"></li></template></ul>`,
      {
        src: 0,
        nonce: 0,
        $listKeys: { log: "id" },
        $scan: { log: { from: "src", initial: INIT, fold: (acc: Row[], cur: number) => [...acc, { id: cur, v: cur * 10 }], resetOn: ["nonce"] } },
        $watch: { log(cur: unknown[]) { watched.push(cur.length); } },
      } as unknown as IState,
    );
    await flushTimes(3);
    const rendered = (): Array<string | null> => Array.from(shadowRoot.querySelectorAll("li"), (li) => li.textContent);

    writeState(stateEl, (s) => { s.src = 1; });
    await flushTimes(4);
    expect(rendered()).toEqual(["10"]);
    writeState(stateEl, (s) => { s.src = 2; });
    await flushTimes(4);
    expect(rendered()).toEqual(["10", "20"]);
    writeState(stateEl, (s) => { s.nonce = 1; });
    await flushTimes(4);
    expect(rendered()).toEqual([]);
    writeState(stateEl, (s) => { s.src = 3; });
    await flushTimes(4);
    expect(rendered()).toEqual(["30"]);
    expect(INIT).toEqual([]);
    expect(watched).toEqual([1, 2, 0, 1]);
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

  it("行の読みが throw したらその行だけを報告して捨て、残りの行は畳むこと（devtools には phase: evaluate）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const events: unknown[] = [];
    setDevtoolsSink((event) => { events.push(event); });
    try {
      const refused = { get qty(): number { throw new Error("row read refused"); } };
      const { host, stateEl } = await connectHost(
        `<template data-wcs="for: items"><span></span></template>`,
        {
          items: [refused, { qty: 2 }],
          $scan: {
            log: { from: "items.*.qty", initial: [], fold: (acc: string[], cur: unknown, _prev: unknown, index: number) => [...acc, `${index}:${cur}`] },
          },
        } as unknown as IState,
      );
      await flushTimes();

      // 生きている 2 行のアドレスを同じバッチに載せる（行 0 は読むと throw する）
      const rows = getListIndexesByList((stateEl as any).__state.items)!;
      const pathInfo = getTreePath(stateEl, getPathInfo("items.*.qty"));
      getUpdater().testApplyChange(rows.map((row) => createAbsoluteStateAddress(pathInfo, row)));
      await flushTimes();

      expect(readState(stateEl, (s) => s.log)).toEqual(["1:2"]);
      const messages = errorSpy.mock.calls.map((call) => String(call[0]));
      expect(messages.some((m) => m.includes(`$scan could not read a "from" value for "log"`))).toBe(true);
      expect(messages.some((m) => m.includes(`$scan fold for "log" threw`))).toBe(false);
      expect(events).toContainEqual(expect.objectContaining({ type: "state:watch-error", phase: "evaluate", path: "$scan.log" }));
      host.remove();
    } finally {
      setDevtoolsSink(null);
      errorSpy.mockRestore();
    }
  });

  it("出力への書き込みが throw しても報告して、後続の scan は書き込むこと（devtools には phase: write）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const events: unknown[] = [];
    setDevtoolsSink((event: any) => {
      events.push(event);
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
      expect(events).toContainEqual(expect.objectContaining({ type: "state:watch-error", phase: "write", path: "$scan.bad" }));
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

  it("接ぎ木で後から getter になった from は fold だけを止め、resetOn による initial への書き込みは続けること（D5 後段）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const fold = vi.fn((acc: unknown[]) => [...acc, "x"]);
      const { host, stateEl } = await connectHost("", {
        host: "a",
        vol: { x: 1 },
        $scan: { out: { from: "vol.x", initial: [], fold, resetOn: ["host"] } },
      } as unknown as IState);
      writeState(stateEl, (s) => { s["vol.x"] = 2; });
      await flushTimes(3);
      expect(readState(stateEl, (s) => s.out)).toEqual(["x"]);

      stateEl.defineTreeAccessor("vol.x", { get() { return 42; }, enumerable: false, configurable: true });
      writeState(stateEl, (s) => { s.$postUpdate("vol.x"); });
      await flushTimes(3);
      expect(fold).toHaveBeenCalledTimes(1);

      // reset は getter を読まないので、止めずに initial に戻す
      writeState(stateEl, (s) => { s.host = "b"; });
      await flushTimes(3);
      expect(readState(stateEl, (s) => s.out)).toEqual([]);
      expect(errorSpy.mock.calls.filter((call) => String(call[0]).includes("[wcs/scan-source-computed]"))).toHaveLength(1);
      host.remove();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("接ぎ木で後から getter になった from は、1 回だけ console と devtools に報告して畳まないこと（D5 後段）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const events: any[] = [];
    setDevtoolsSink((event) => { events.push(event); });
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
      const sent = events.filter((event) => event.type === "state:watch-error");
      expect(sent).toEqual([expect.objectContaining({ phase: "fold", path: "$scan.out" })]);
      expect(String(sent[0].error.message)).toContain("[wcs/scan-source-computed]");
      host.remove();
    } finally {
      setDevtoolsSink(null);
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
    return createAbsoluteStateAddress(getTreePath(stateEl, getPathInfo(path)), null);
  }

  it.each([
    ["プリミティブ", (i: number): unknown => i * 10, [[10, null], [20, 10], [null, 20]]],
    ["オブジェクト", (i: number): unknown => ({ i }), [[{ i: 1 }, undefined], [{ i: 2 }, undefined], [null, { i: 2 }]]],
  ])("%s の chunk の prev はプリミティブを書いたときだけ記録され、restart が書く initial（null）への戻しは直前の chunk を prev に持つこと", async (_label, make, expected) => {
    const gens: Array<ReturnType<typeof makeManualAsyncGenerator<unknown>>> = [];
    const { host, stateEl } = await connectHost("", {
      page: 1,
      $streams: {
        pageResult: {
          args: (s: any) => s.page,
          initial: null,
          source: () => { const gen = makeManualAsyncGenerator<unknown>(); gens.push(gen); return gen.iterable; },
        },
      },
      $scan: { log: { from: "pageResult", initial: [], fold: (acc: unknown[], cur: unknown, prev: unknown) => [...acc, [cur, prev]] } },
    } as unknown as IState);
    await flushTimes(3);
    gens[0].push(make(1));
    await flushTimes(4);
    gens[0].push(make(2));
    await flushTimes(4);
    writeState(stateEl, (s) => { s.page = 2; });
    await flushTimes(6);

    expect(readState(stateEl, (s) => s.log)).toEqual(expected);
    host.remove();
  });

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

  it("起動時に args が scan 出力から導出した getter を読むと、stream の開始が raise し、正規化されずに stream は idle のまま接続も解決しないこと（D9・args の自己依存と同じ着地）", async () => {
    const host = document.createElement("scan-from-d9-start-host");
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<wcs-state></wcs-state>`;
    document.body.appendChild(host);
    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    stateEl.setInitialState({
      get page(this: any) { return this.feed.length + 1; },
      $streams: {
        pageResult: { args: (s: any) => s.page, source: () => makeManualAsyncGenerator<unknown>().iterable },
      },
      $scan: { feed: { from: "pageResult", initial: [], fold: (acc: unknown) => acc } },
    } as unknown as IState);
    let settled = false;
    stateEl.connectedCallbackPromise.then(() => { settled = true; }, () => { settled = true; });
    await flushTimes(5);

    expect(settled, "接続の promise は解決も reject もしない").toBe(false);
    expect(readState(stateEl, (s) => s["$streamStatus.pageResult"])).toBe("idle");
    expect(readState(stateEl, (s) => s["$streamError.pageResult"]), "$streamError は初期値のまま").toBeNull();
    // 起動（startStreams）そのものは raise する — 接続の外へ投げられ、$streamError には正規化されない
    expect(() => startStreams(stateEl)).toThrow(/\[wcs\/scan-feedback-loop\]/);
    host.remove();
  });

  it("stream の値を畳む scan の出力を別の scan が畳み、その出力から導出した getter を args が読んでも raise すること（連鎖した D9）", async () => {
    let derived = false;
    const { host, stateEl } = await connectHost("", {
      mode: 0,
      get page(this: any) { return this.feed2.length + 1; },
      $streams: {
        pageResult: {
          args: (s: any) => (derived ? s.page : s.mode),
          source: () => makeManualAsyncGenerator<unknown>().iterable,
        },
      },
      $scan: {
        feed: { from: "pageResult", initial: [], fold: (acc: unknown[], chunk: unknown) => (chunk === undefined ? acc : [...acc, chunk]) },
        feed2: { from: "feed", initial: [], fold: (_acc: unknown, cur: unknown) => cur },
      },
    } as unknown as IState);
    expect(readState(stateEl, (s) => s["$streamStatus.pageResult"])).toBe("active");

    derived = true;
    writeState(stateEl, (s) => { s.mode = 1; });
    await flushTimes();

    // scan の from → 出力の辺は依存グラフに無いので、それを辿らないと feed → feed2 → page が見えない
    expect(readState(stateEl, (s) => s["$streamStatus.pageResult"])).toBe("error");
    expect(String(readState(stateEl, (s) => s["$streamError.pageResult"]))).toContain(`[wcs/scan-feedback-loop] $stream entry "pageResult" args read "page"`);
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
