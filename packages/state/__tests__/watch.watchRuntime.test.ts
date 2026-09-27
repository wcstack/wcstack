/**
 * watch.watchRuntime.test.ts
 *
 * `$watch` の発火（実装計画 A-5 / A-6）。実 `<wcs-state>` を connect して
 * updater の drain を実駆動する（発火点が drain 終端フックであるため、
 * ここをモックすると検証にならない）。
 *
 * 受け入れ ID:
 * - P3:  binding が 1 つも無いパスの変更で発火する（headless の中核）
 * - P4:  cur / prev が正しい（スカラ）
 * - P5:  同一バッチの複数書き込みが 1 回に畳まれる
 * - P13: $updatedCallback → $watch の順（機構間の順序・層 1）
 * - P14: 複数ハンドラが $watch の宣言順に呼ばれる（層 2）
 * - S3:  同値の primitive 書き込みでは発火しない（same-value guard 経由）
 * - S5:  $postUpdate 経由は prev === undefined で発火する
 * - S6:  他 state のアドレスでは発火しない（越境不可）
 * - S7:  ハンドラの throw が他の watch を巻き添えにしない
 * - S8:  相互 watch が MAX_WATCH_CHAIN_DEPTH で打ち切られる
 */
import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { MAX_WATCH_CHAIN_DEPTH } from "../src/define";
import { setDevtoolsSink } from "../src/platform/devtoolsSink";
import type { DevtoolsEvent } from "../src/devtools/types";
import type { IState } from "../src/types";
import { __private__ as chainDepthPrivate, consumeWatchChainDepths } from "../src/watch/chainDepth";
import { __private__ as runtimePrivate } from "../src/watch/watchRuntime";
import { flushAsync, flushTimes, makeConnectHost } from "./helpers/streamTestUtils";

beforeAll(() => {
  bootstrapState();
});

const connectHost = makeConnectHost("watch-rt-host");

beforeEach(() => {
  // 前のテストで打ち切られた連鎖の深さを持ち越さない
  chainDepthPrivate.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("$watch の発火", () => {
  it("P3/P4: binding が 1 つも無いパスでも書き込みで発火し、cur/prev が渡ること", async () => {
    const calls: Array<[unknown, unknown]> = [];
    // markup は空 = isLoading をどこにもバインドしていない。
    // $updatedCallback は binding 駆動なのでこの状況では何も観測できない。
    const { host, stateEl } = await connectHost("", {
      isLoading: false,
      $watch: {
        isLoading(cur: unknown, prev: unknown) {
          calls.push([cur, prev]);
        },
      },
    } as unknown as IState);

    stateEl.createState("writable", (state) => { state.isLoading = true; });
    await flushAsync();

    expect(calls).toEqual([[true, false]]);
    host.remove();
  });

  it("P5: 同一バッチの複数書き込みは 1 回に畳まれ、cur は確定値・prev はバッチ開始値になること", async () => {
    const calls: Array<[unknown, unknown]> = [];
    const { host, stateEl } = await connectHost("", {
      count: 0,
      $watch: {
        count(cur: unknown, prev: unknown) { calls.push([cur, prev]); },
      },
    } as unknown as IState);

    stateEl.createState("writable", (state) => {
      state.count = 1;
      state.count = 2;
      state.count = 3;
    });
    await flushAsync();

    expect(calls).toEqual([[3, 0]]);
    host.remove();
  });

  it("S3: 同値の primitive 書き込みでは発火しないこと（same-value guard が enqueue ごと落とす）", async () => {
    const handler = vi.fn();
    const { host, stateEl } = await connectHost("", {
      count: 7,
      $watch: { count: handler },
    } as unknown as IState);

    stateEl.createState("writable", (state) => { state.count = 7; });
    await flushAsync();

    expect(handler).not.toHaveBeenCalled();
    host.remove();
  });

  it("S5: $postUpdate 経由では prev が undefined で発火すること（旧値が存在しない経路）", async () => {
    const calls: Array<[unknown, unknown]> = [];
    const { host, stateEl } = await connectHost("", {
      items: [1, 2],
      $watch: {
        items(cur: unknown, prev: unknown) { calls.push([cur, prev]); },
      },
    } as unknown as IState);

    stateEl.createState("writable", (state) => {
      state.items.push(3);          // in-place 変異（set トラップを通らない）
      state.$postUpdate("items");
    });
    await flushAsync();

    expect(calls.length).toBe(1);
    expect(calls[0][0]).toEqual([1, 2, 3]);
    expect(calls[0][1]).toBeUndefined();
    host.remove();
  });

  it("参照型の書き込みでは prev が undefined になること（guard が旧値を読まないため）", async () => {
    const calls: Array<[unknown, unknown]> = [];
    const { host, stateEl } = await connectHost("", {
      items: [1],
      $watch: {
        items(cur: unknown, prev: unknown) { calls.push([cur, prev]); },
      },
    } as unknown as IState);

    stateEl.createState("writable", (state) => { state.items = [9]; });
    await flushAsync();

    expect(calls.length).toBe(1);
    expect(calls[0][0]).toEqual([9]);
    expect(calls[0][1]).toBeUndefined();
    host.remove();
  });

  it("S6: 他の state 要素への書き込みでは発火しないこと（越境不可）", async () => {
    const handler = vi.fn();
    const a = await connectHost("", {
      count: 0,
      $watch: { count: handler },
    } as unknown as IState);
    // 同名パスを持つ別ホスト（別 stateElement）。絶対アドレスは stateElement 単位で
    // キャッシュされるので、同名 state でも取り違えない。
    const b = await connectHost("", { count: 0 } as unknown as IState);

    b.stateEl.createState("writable", (state) => { state.count = 5; });
    await flushAsync();

    expect(handler).not.toHaveBeenCalled();
    a.host.remove();
    b.host.remove();
  });

  it("P14: 複数のハンドラが $watch の宣言順に呼ばれること（利用者が並べ替えで制御できる層）", async () => {
    const order: string[] = [];
    const { host, stateEl } = await connectHost("", {
      a: 0,
      b: 0,
      $watch: {
        // 宣言順は b → a。書き込み順（a → b）ではなくこちらが優先される。
        b() { order.push("b"); },
        a() { order.push("a"); },
      },
    } as unknown as IState);

    stateEl.createState("writable", (state) => {
      state.a = 1;
      state.b = 1;
    });
    await flushAsync();

    expect(order).toEqual(["b", "a"]);
    host.remove();
  });

  it("P13: $updatedCallback が $watch より先に呼ばれること（機構間の順序）", async () => {
    const order: string[] = [];
    const { host, stateEl } = await connectHost(`<p data-wcs="textContent: count"></p>`, {
      count: 0,
      $updatedCallback() { order.push("updatedCallback"); },
      $watch: {
        count() { order.push("watch"); },
      },
    } as unknown as IState);

    // 接続時の初回バインディング適用でも $updatedCallback は走るので、そのぶんを捨ててから測る
    order.length = 0;
    stateEl.createState("writable", (state) => { state.count = 1; });
    await flushAsync();

    expect(order).toEqual(["updatedCallback", "watch"]);
    host.remove();
  });

  it("S7: ハンドラの throw が他の watch を巻き添えにしないこと（drain も壊さない）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => { /* silence */ });
    const later = vi.fn();
    const { host, stateEl } = await connectHost("", {
      a: 0,
      b: 0,
      $watch: {
        a() { throw new Error("boom"); },
        b: later,
      },
    } as unknown as IState);

    stateEl.createState("writable", (state) => {
      state.a = 1;
      state.b = 1;
    });
    await flushAsync();

    expect(later).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('$watch handler for "a" threw'),
      expect.any(Error),
    );
    host.remove();
  });

  it("ハンドラ内の書き込みが次のバッチで反映されること（this は writable state proxy）", async () => {
    const { host, stateEl } = await connectHost("", {
      source: 0,
      derived: "",
      $watch: {
        source(this: any, cur: unknown) { this.derived = `v=${cur}`; },
      },
    } as unknown as IState);

    stateEl.createState("writable", (state) => { state.source = 5; });
    await flushAsync();

    stateEl.createState("readonly", (state) => {
      expect(state.derived).toBe("v=5");
    });
    host.remove();
  });

  it("S8: 相互 watch の連鎖が MAX_WATCH_CHAIN_DEPTH で打ち切られること", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => { /* silence */ });
    let ticks = 0;
    const { host, stateEl } = await connectHost("", {
      a: 0,
      b: 0,
      $watch: {
        a(this: any, cur: unknown) { ticks++; this.b = (cur as number) + 1; },
        b(this: any, cur: unknown) { ticks++; this.a = (cur as number) + 1; },
      },
    } as unknown as IState);

    stateEl.createState("writable", (state) => { state.a = 1; });
    await flushAsync();

    // 打ち切られている（無限ループにならない）ことと、報告が出ていることを確認する。
    // 正確な回数は連鎖の畳まれ方に依存するが、1 バッチにつき hit するのは a / b の
    // どちらか 1 本なので、上限は定数から導出できる（定数を動かせばここも動く）。
    expect(ticks).toBeGreaterThan(0);
    expect(ticks).toBeLessThanOrEqual(MAX_WATCH_CHAIN_DEPTH + 1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("$watch chain depth limit exceeded"),
      expect.anything(),
    );
    host.remove();
  });

  it("ワイルドカードパスが行ごとに発火し、indexes 昇順で呼ばれること（層 3）", async () => {
    const calls: Array<[number, unknown, unknown]> = [];
    // $resolve でワイルドカード行を解決するには listIndex 台帳が要るので for を張る
    const { host, stateEl } = await connectHost(
      `<ul><template data-wcs="for: items"><li data-wcs="textContent: items.*.price"></li></template></ul>`,
      {
        items: [{ price: 1 }, { price: 2 }, { price: 3 }],
        $watch: {
          "items.*.price"(cur: unknown, prev: unknown, index: number) {
            calls.push([index, cur, prev]);
          },
        },
      } as unknown as IState,
    );

    stateEl.createState("writable", (state) => {
      // 書き込み順は 2 → 0。発火は indexes 昇順になる。
      state.$resolve("items.*.price", [2], 30);
      state.$resolve("items.*.price", [0], 10);
    });
    await flushAsync();

    expect(calls).toEqual([[0, 10, 1], [2, 30, 3]]);
    host.remove();
  });

  it("先行ハンドラが state を切断したら、後続のハンドラは発火しないこと（発火直前の live 再チェック）", async () => {
    const later = vi.fn();
    const { host, stateEl } = await connectHost("", {
      a: 0,
      b: 0,
      $watch: {
        a() { host.remove(); },
        b: later,
      },
    } as unknown as IState);

    stateEl.createState("writable", (state) => {
      state.a = 1;
      state.b = 1;
    });
    await flushAsync();

    expect(later).not.toHaveBeenCalled();
  });

  it("連鎖しない書き込みを繰り返しても打ち切られないこと（深さが伝染しない）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => { /* silence */ });
    const handler = vi.fn();
    const { host, stateEl } = await connectHost("", {
      count: 0,
      $watch: { count: handler },
    } as unknown as IState);

    // ハンドラは何も書き込まない → 何度バッチが起きても深さは 0 のまま
    for (let i = 1; i <= 40; i++) {
      stateEl.createState("writable", (state) => { state.count = i; });
      await flushAsync();
    }

    expect(handler).toHaveBeenCalledTimes(40);
    expect(errorSpy).not.toHaveBeenCalled();
    host.remove();
  });

  // #354: 深さは書き込みごとに数える（watch/chainDepth.ts）。バッチ単位で数えていたときは、ハンドラの書き込みと
  // 同じバッチに相乗りした描画の書き戻しで起きたハンドラまで連鎖の続きに数え、32 段を超える有限の描画の
  // 連鎖の途中で上限を誤って報告し、そのバッチの `$scan` / `$watch` を飛ばしていた
  describe("32 段を超える有限の描画の連鎖（#354）", () => {
    /** 描いて測って 1px 詰める（README の 64px → 18px の連鎖・描画 47 回）。測定の代わりに 18 と比べる */
    function shrinkState(extra: Record<string, unknown>): IState {
      return {
        text: "",
        size: 64,
        $renderedCallback(this: any) {
          if (this.text !== "" && this.size > 18) this.size = this.size - 1;
        },
        ...extra,
      } as unknown as IState;
    }

    async function run(markup: string, state: IState) {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => { /* silence */ });
      const connected = await connectHost(`<i>{{ text }}</i><h1>{{ size }}</h1>${markup}`, state);
      await flushAsync();
      connected.stateEl.createState("writable", (s) => { s.text = "a long heading"; });
      await flushTimes(4);
      const limitReports = errorSpy.mock.calls.filter((call) => String(call[0]).includes("chain depth limit exceeded"));
      return { ...connected, limitReports };
    }

    /** from から to まで 1 ずつ減る列 */
    function countdown(from: number, to: number): number[] {
      return Array.from({ length: from - to + 1 }, (_, i) => from - i);
    }

    it("$watch のハンドラが別のキーへ書いても上限を報告せず、どの値でもハンドラが呼ばれること", async () => {
      const seen: number[] = [];
      const { host, shadowRoot, limitReports } = await run(`<p>{{ last }}</p>`, shrinkState({
        last: 0,
        $watch: {
          size(this: any, cur: number) { seen.push(cur); this.last = cur; },
        },
      }));

      // 修正前は 62 から数えて 34 個目の 29 のバッチで `$watch chain depth limit exceeded` が出て、29 が来なかった
      expect(limitReports).toEqual([]);
      expect(countdown(62, 18).filter((v) => !seen.includes(v))).toEqual([]);
      expect(shadowRoot.querySelector("h1")!.textContent).toBe("18");
      expect(shadowRoot.querySelector("p")!.textContent).toBe("18");
      host.remove();
    });

    it("$scan の from を描画の連鎖が書き進めても、上限を報告せず、どの着地も畳むこと", async () => {
      const { host, stateEl, limitReports } = await run(`<p>{{ steps }}</p>`, shrinkState({
        $scan: {
          steps: { from: "size", initial: 0, fold: (acc: number) => acc + 1 },
        },
      }));

      // size は 63 から 18 まで 46 回着地する。修正前は scan の書き込み（steps）が相乗りしてバッチの深さが
      // 伸び、33 段目で上限を報告してその回の畳みを飛ばしていた
      expect(limitReports).toEqual([]);
      stateEl.createState("readonly", (state) => {
        expect(state.size).toBe(18);
        expect(state.steps).toBe(countdown(63, 18).length);
      });
      host.remove();
    });

    it("対照: 相互 $watch の循環は、描画の書き戻しが同じバッチに相乗りしても上限で打ち切られること", async () => {
      let ticks = 0;
      const { host, limitReports } = await run(`<p>{{ a }}</p><p>{{ b }}</p>`, shrinkState({
        a: 0,
        b: 0,
        $watch: {
          size(this: any) { if (this.a === 0) this.a = 1; },
          a(this: any, cur: number) { ticks++; this.b = cur + 1; },
          b(this: any, cur: number) { ticks++; this.a = cur + 1; },
        },
      }));

      // a / b の書き込みはハンドラ起点なので、描画の書き戻し（size）と同じバッチに載っても深さが伸び続ける
      expect(limitReports).toHaveLength(1);
      expect(String(limitReports[0][0])).toContain("$watch chain depth limit exceeded");
      expect(ticks).toBeGreaterThan(MAX_WATCH_CHAIN_DEPTH - 2);
      expect(ticks).toBeLessThanOrEqual(MAX_WATCH_CHAIN_DEPTH + 1);
      host.remove();
    });
  });

  // `$stream` の再開（args の依存への書き込みで起きる）は、drain 終了リスナーの中で `initial` と status を書く。
  // その書き込みは再開を起こした書き込みの連鎖の続きに数える。数えないと、`$watch` が args の依存へ書き、
  // 再開の書き込みがまたその `$watch` を起こす循環が、上限に掛からずに回り続ける
  describe("$stream の再開を挟む循環", () => {
    /** 値を出さずに abort を待つ source（再開のたびに abort される） */
    const never = (_args: unknown, signal: AbortSignal) => ({
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<unknown>>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
        };
      },
    });
    /** 測定用のハンドラ呼び出しの上限。修正が外れたときにテストをハングさせないため */
    const CAP = 300;

    async function runCycle(declare: (step: () => void) => Record<string, unknown>) {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => { /* silence */ });
      let calls = 0;
      const { host, stateEl } = await connectHost(`<i>{{ go }}</i>`, {
        q: 0,
        go: false,
        $stream: {
          results: { args: (s: any) => s.q, source: never, fold: (acc: unknown[], chunk: unknown) => [...acc, chunk], initial: [] },
        },
        // q を進める（args の依存への書き込み ＝ 再開）。go が立つまでは何もしない
        ...declare(function (this: any) {
          if (!this.go || ++calls > CAP) return;
          this.q = this.q + 1;
        }),
      } as unknown as IState);
      await flushTimes(2);
      stateEl.createState("writable", (s) => { s.go = true; s.q = 100; });
      await flushTimes(6);
      const limitReports = errorSpy.mock.calls.filter((call) => String(call[0]).includes("chain depth limit exceeded"));
      host.remove();
      return { calls, limitReports };
    }

    function expectCut(result: { calls: number; limitReports: unknown[][] }): void {
      expect(result.limitReports).toHaveLength(1);
      expect(String(result.limitReports[0][0])).toContain("$watch chain depth limit exceeded");
      // 1 周（ハンドラ → 再開 → ハンドラ）で 2 段伸びる
      expect(result.calls).toBeLessThanOrEqual(MAX_WATCH_CHAIN_DEPTH / 2 + 1);
    }

    it("$watch が args の依存へ書き、再開の書き込みがその $watch を起こす循環を、上限で打ち切ること", async () => {
      expectCut(await runCycle((step) => ({ $watch: { results: step } })));
    });

    it("循環に関係しない $watch の書き込みが相乗りしても、同じく打ち切ること", async () => {
      expectCut(await runCycle((step) => ({
        w: 0,
        $watch: {
          results: step,
          q(this: any, v: number) { this.w = v; },
        },
      })));
    });

    it("再開の書き込みを $scan が畳み、その出力の $watch が args の依存へ書く循環も、上限で打ち切ること", async () => {
      expectCut(await runCycle((step) => ({
        $scan: { count: { from: "results", initial: 0, fold: (acc: number) => acc + 1 } },
        $watch: { count: step },
      })));
    });

    it("$stream どうしが args で互いの値を読む循環も、$watch が無くても上限で止まり報告されること", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => { /* silence */ });
      let evaluations = 0;
      const counted = (read: (s: any) => unknown) => (s: any) => {
        if (++evaluations > CAP) throw new Error("runaway");
        return read(s);
      };
      const { host, stateEl } = await connectHost("", {
        go: 0,
        $stream: {
          a: { args: counted((s) => [s.b, s.go]), source: never, fold: (acc: unknown[], c: unknown) => [...acc, c], initial: [] },
          b: { args: counted((s) => s.a), source: never, fold: (acc: unknown[], c: unknown) => [...acc, c], initial: [] },
        },
      } as unknown as IState);
      await flushTimes(2);
      evaluations = 0;
      stateEl.createState("writable", (s) => { s.go = 1; });
      await flushTimes(6);

      // 再開のたびに 1 段伸びる。接続時の起動で 2 本とも書くので、連鎖は 2 本並んで回り、それぞれが 1 回報告する
      expect(evaluations).toBeLessThanOrEqual(MAX_WATCH_CHAIN_DEPTH + 2);
      const limitReports = errorSpy.mock.calls.filter((call) => String(call[0]).includes("$watch chain depth limit exceeded"));
      expect(limitReports.length).toBeGreaterThanOrEqual(1);
      expect(limitReports.length).toBeLessThanOrEqual(2);
      host.remove();
    });
  });

  describe("深さの台帳の持ち越し", () => {
    it("ハンドラが 5,000 行を書いてから自分のホストを外しても、深さの台帳を持ち越さないこと", async () => {
      let hostRef: HTMLElement | null = null;
      const { host, stateEl } = await connectHost(`<i>{{ go }}</i>`, {
        go: 0,
        items: Array.from({ length: 5000 }, (_, i) => ({ id: i, v: 0 })),
        $listKeys: { items: "id" },
        $watch: {
          go(this: any, v: number) {
            this.$setAll("items.*.v", [], v);
            hostRef!.remove();
          },
        },
      } as unknown as IState);
      hostRef = host;
      stateEl.createState("writable", (s) => { s.go = 1; });
      await flushTimes(3);

      // 発火する state が無くなった後の drain でも台帳は消費され、何も残らない（修正前は 5,000 件のアドレスが残った）
      expect(consumeWatchChainDepths(new Set())).toBe(0);
    });

    it("連鎖の途中でハンドラが自分のホストを外しても、残った深さが後の別の state の発火を打ち切らないこと", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => { /* silence */ });
      let hostRef: HTMLElement | null = null;
      const first = await connectHost(`<i>{{ a }}</i>`, {
        a: 0,
        b: 0,
        $watch: {
          // a のハンドラは深さ 0, 2, 4, … で cur = 1, 3, 5, … を受ける。深さ 32（上限ちょうど）で書いてから
          // ホストを外す — その書き込み（b）の深さ 33 は上限を越えているが、発火する state はもう無い
          a(this: any, cur: number) {
            this.b = cur + 1;
            if (cur > MAX_WATCH_CHAIN_DEPTH) hostRef!.remove();
          },
          b(this: any, cur: number) { this.a = cur + 1; },
        },
      } as unknown as IState);
      hostRef = first.host;
      first.stateEl.createState("writable", (s) => { s.a = 1; });
      await flushTimes(4);
      // 越えたバッチは、発火する state が無くても 1 回報告される（その drain で台帳を消費する）
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0][0])).toContain("$watch chain depth limit exceeded");

      const seen: number[] = [];
      const second = await connectHost("", {
        n: 0,
        $watch: { n(cur: number) { seen.push(cur); } },
      } as unknown as IState);
      second.stateEl.createState("writable", (s) => { s.n = 1; });
      await flushAsync();

      // 修正前は外れた state の深さ（上限 + 1）が台帳に残り、この作者の書き込みのバッチを打ち切っていた
      expect(seen).toEqual([1]);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      second.host.remove();
    });
  });
});

describe("$watch の devtools 計装（設計書 §7-1）", () => {
  // watch は例外を自分で閉じる（drain と他機能を巻き添えにしないため）。
  // console.error だけだと devtools からは「静かに握られた失敗」が見えないので、
  // 同じ地点から sink にも流す。
  const events: DevtoolsEvent[] = [];

  beforeEach(() => {
    events.length = 0;
    setDevtoolsSink((event) => events.push(event));
  });

  afterEach(() => {
    setDevtoolsSink(null);
  });

  const watchEvents = () => events.filter((e) => e.type.startsWith("state:watch-"));

  it("ハンドラの throw が state:watch-error（phase: handler）として流れること", async () => {
    vi.spyOn(console, "error").mockImplementation(() => { /* silence */ });
    const { host, stateEl } = await connectHost("", {
      a: 0,
      $watch: { a() { throw new Error("boom"); } },
    } as unknown as IState);

    stateEl.createState("writable", (state) => { state.a = 1; });
    await flushAsync();

    // 発火自体は起きている（watch-fired はハンドラ呼び出し前に流れる）ので、
    // fired → error の順で 2 イベントになる。
    expect(watchEvents()).toEqual([
      expect.objectContaining({ type: "state:watch-fired", path: "a" }),
      expect.objectContaining({
        type: "state:watch-error",
        phase: "handler",
        path: "a",
        error: expect.any(Error),
      }),
    ]);
    host.remove();
  });

  it("正常発火が state:watch-fired として流れること（値は載せない・設計書 §11 / カバレッジ実測面）", async () => {
    const { host, stateEl } = await connectHost("", {
      a: 0,
      $watch: { a() { /* 正常 */ } },
    } as unknown as IState);

    stateEl.createState("writable", (state) => { state.a = 1; });
    await flushAsync();

    const fired = watchEvents();
    expect(fired).toEqual([
      expect.objectContaining({ type: "state:watch-fired", path: "a" }),
    ]);
    // payload は path + 発火元ツリー識別のみ（cur / prev / value を載せない契約は不変）。
    // stateElement は protocol v2 追補 — 複数ツリーの同名 watch パスの実測を
    // devtools 側でツリー別に分けるための識別。
    expect(Object.keys(fired[0]).sort()).toEqual(["path", "stateElement", "type"]);
    expect((fired[0] as { stateElement?: unknown }).stateElement).toBe(stateEl);
    host.remove();
  });

  it("cur の評価（getter）の throw が phase: evaluate として流れること", async () => {
    vi.spyOn(console, "error").mockImplementation(() => { /* silence */ });
    const { host, stateEl } = await connectHost("", {
      count: 1,
      get boom(this: any): number {
        if (this.count > 1) throw new Error("boom");
        return this.count;
      },
      $watch: { boom() { /* 到達しない */ } },
    } as unknown as IState);

    stateEl.createState("writable", (state) => { state.count = 2; });
    await flushAsync();

    expect(watchEvents()).toEqual([
      expect.objectContaining({ type: "state:watch-error", phase: "evaluate", path: "boom" }),
    ]);
    host.remove();
  });

  it("接続時の初回評価の throw が phase: prime として流れること", async () => {
    vi.spyOn(console, "error").mockImplementation(() => { /* silence */ });
    const { host } = await connectHost("", {
      count: 1,
      get boom(): number { throw new Error("boom at prime"); },
      $watch: { boom() { /* noop */ } },
    } as unknown as IState);
    await flushAsync();

    expect(watchEvents()).toEqual([
      expect.objectContaining({ type: "state:watch-error", phase: "prime", path: "boom" }),
    ]);
    host.remove();
  });

  it("連鎖の打ち切りが state:watch-chain-limit として流れること", async () => {
    vi.spyOn(console, "error").mockImplementation(() => { /* silence */ });
    const { host, stateEl } = await connectHost("", {
      a: 0,
      b: 0,
      $watch: {
        a(this: any, cur: unknown) { this.b = (cur as number) + 1; },
        b(this: any, cur: unknown) { this.a = (cur as number) + 1; },
      },
    } as unknown as IState);

    stateEl.createState("writable", (state) => { state.a = 1; });
    await flushAsync();

    const limits = events.filter((e) => e.type === "state:watch-chain-limit");
    expect(limits).toHaveLength(1);
    expect(limits[0]).toEqual(
      expect.objectContaining({ type: "state:watch-chain-limit", maxDepth: MAX_WATCH_CHAIN_DEPTH }),
    );
    // 打ち切りバッチは連鎖の折り返し次第で a 側にも b 側にもなるので、
    // どちらか一方であることだけを見る（報告の中身が空でないことが要点）。
    const { paths } = limits[0] as { paths: readonly string[] };
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => p === "a" || p === "b")).toBe(true);
    host.remove();
  });

  it("sink 未接続なら watch のイベントは生成されないこと（コスト規範）", async () => {
    setDevtoolsSink(null);
    vi.spyOn(console, "error").mockImplementation(() => { /* silence */ });
    const { host, stateEl } = await connectHost("", {
      a: 0,
      $watch: { a() { throw new Error("boom"); } },
    } as unknown as IState);

    stateEl.createState("writable", (state) => { state.a = 1; });
    await flushAsync();

    expect(events).toEqual([]);
    host.remove();
  });
});

describe("compareHits（順序規約の比較関数）", () => {
  const hit = (order: number, indexes: number[]) =>
    ({ entry: { order }, indexes } as never);

  it("層 2: 宣言順（order）が indexes より優先されること", () => {
    expect(runtimePrivate.compareHits(hit(0, [9]), hit(1, [0]))).toBeLessThan(0);
    expect(runtimePrivate.compareHits(hit(2, [0]), hit(1, [9]))).toBeGreaterThan(0);
  });

  it("層 3: 同一 entry では indexes を段ごとに昇順比較すること", () => {
    expect(runtimePrivate.compareHits(hit(0, [1, 5]), hit(0, [2, 0]))).toBeLessThan(0);
    expect(runtimePrivate.compareHits(hit(0, [1, 5]), hit(0, [1, 9]))).toBeLessThan(0);
    expect(runtimePrivate.compareHits(hit(0, [1, 5]), hit(0, [1, 5]))).toBe(0);
  });

  it("indexes の長さが違う場合は短いほうを先にすること（同一パスでは通常起きない防御的分岐）", () => {
    expect(runtimePrivate.compareHits(hit(0, [1]), hit(0, [1, 0]))).toBeLessThan(0);
    expect(runtimePrivate.compareHits(hit(0, [1, 0]), hit(0, [1]))).toBeGreaterThan(0);
  });
});
