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
import { setDevtoolsSink } from "../src/devtools/sink";
import type { DevtoolsEvent } from "../src/devtools/types";
import type { IState } from "../src/types";
import { __private__ as chainDepthPrivate } from "../src/watch/chainDepth";
import { __private__ as runtimePrivate } from "../src/watch/watchRuntime";
import { flushAsync, makeConnectHost } from "./helpers/streamTestUtils";

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
