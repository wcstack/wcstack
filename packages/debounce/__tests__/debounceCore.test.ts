import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DebounceCore } from "../src/core/DebounceCore";

describe("DebounceCore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("EventTarget を継承している", () => {
    expect(new DebounceCore()).toBeInstanceOf(EventTarget);
  });

  it("初期状態は value=undefined / fired=[] / pending=false", () => {
    const core = new DebounceCore();
    expect(core.value).toBeUndefined();
    expect(core.fired).toEqual([]);
    expect(core.pending).toBe(false);
  });

  // --- 値のデバウンス ---

  it("source 連打は wait 経過後に settled を1回だけ発火し最後の値を載せる", () => {
    const core = new DebounceCore("wcs-debounce", undefined, { wait: 100 });
    const settled: any[] = [];
    core.addEventListener("wcs-debounce:settled", (e) => settled.push((e as CustomEvent).detail.value));

    core.setSource("a");
    core.setSource("b");
    expect(settled).toEqual([]);

    vi.advanceTimersByTime(100);
    expect(settled).toEqual(["b"]);
    expect(core.value).toBe("b");
  });

  it("pending は schedule で true、settle で false になり同値では再発火しない", () => {
    const core = new DebounceCore("wcs-debounce", undefined, { wait: 100 });
    const states: boolean[] = [];
    core.addEventListener("wcs-debounce:pending-changed", (e) => states.push((e as CustomEvent).detail));

    core.setSource("a");
    core.setSource("b"); // 既に pending=true なので再発火しない
    expect(core.pending).toBe(true);

    vi.advanceTimersByTime(100);
    expect(core.pending).toBe(false);
    expect(states).toEqual([true, false]);
  });

  // --- シグナルのデバウンス ---

  it("trigger 連打は wait 経過後に fired を1回だけ発火し最後の args を載せる", () => {
    const core = new DebounceCore("wcs-debounce", undefined, { wait: 100 });
    const fired: any[][] = [];
    core.addEventListener("wcs-debounce:fired", (e) => fired.push((e as CustomEvent).detail.args));

    core.trigger(1, "x");
    core.trigger(2, "y");
    vi.advanceTimersByTime(100);

    expect(fired).toEqual([[2, "y"]]);
    expect(core.fired).toEqual([2, "y"]);
  });

  it("引数なし trigger は fired を空配列で発火する", () => {
    const core = new DebounceCore("wcs-debounce", undefined, { wait: 100 });
    const fired: any[][] = [];
    core.addEventListener("wcs-debounce:fired", (e) => fired.push((e as CustomEvent).detail.args));

    core.trigger();
    vi.advanceTimersByTime(100);
    expect(fired).toEqual([[]]);
  });

  // --- leading / trailing ---

  it("leading=true, trailing=false は先頭で即発火し末尾では発火しない", () => {
    const core = new DebounceCore("wcs-debounce", undefined, { wait: 100, leading: true, trailing: false });
    const settled: any[] = [];
    core.addEventListener("wcs-debounce:settled", (e) => settled.push((e as CustomEvent).detail.value));

    core.setSource("a");
    expect(settled).toEqual(["a"]);
    vi.advanceTimersByTime(100);
    expect(settled).toEqual(["a"]);
    expect(core.pending).toBe(false);
  });

  it("既定 (leading=false, trailing=true) は先頭で発火せず末尾で1回発火する", () => {
    const core = new DebounceCore("wcs-debounce", undefined, { wait: 100 });
    const settled: any[] = [];
    core.addEventListener("wcs-debounce:settled", (e) => settled.push((e as CustomEvent).detail.value));

    core.setSource("a");
    expect(settled).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(settled).toEqual(["a"]);
  });

  it("leading+trailing で1パルスは1回しか発火しない", () => {
    const core = new DebounceCore("wcs-debounce", undefined, { wait: 100, leading: true, trailing: true });
    const settled: any[] = [];
    core.addEventListener("wcs-debounce:settled", (e) => settled.push((e as CustomEvent).detail.value));

    core.setSource("a");
    vi.advanceTimersByTime(100);
    expect(settled).toEqual(["a"]);
  });

  it("leading+trailing で2パルス以上なら leading と trailing の両方が発火する", () => {
    const core = new DebounceCore("wcs-debounce", undefined, { wait: 100, leading: true, trailing: true });
    const settled: any[] = [];
    core.addEventListener("wcs-debounce:settled", (e) => settled.push((e as CustomEvent).detail.value));

    core.setSource("a");            // t=0 leading
    vi.advanceTimersByTime(50);
    core.setSource("b");            // t=50
    vi.advanceTimersByTime(50);     // t=100 タイマーは shouldInvoke=false で残り時間再武装
    vi.advanceTimersByTime(50);     // t=150 trailing 発火
    expect(settled).toEqual(["a", "b"]);
  });

  // --- maxWait / throttle ---

  it("maxWait 到達中の同期連打で即時発火し、古いタイマーを孤児化しない (tight-loop 分岐)", () => {
    const core = new DebounceCore("wcs-debounce", undefined, { wait: 100, maxWait: 100 });
    const settled: any[] = [];
    core.addEventListener("wcs-debounce:settled", (e) => settled.push((e as CustomEvent).detail.value));

    core.setSource("a");      // t=0 leadingEdge (leading=false) → 発火せずタイマー武装
    expect(vi.getTimerCount()).toBe(1);
    vi.setSystemTime(100);    // タイマーを動かさず時計だけ進める
    core.setSource("b");      // shouldInvoke=true かつ timer 保留中 → tight-loop で即発火
    expect(settled).toEqual(["b"]);
    // 旧タイマーは clear され、再武装した1本だけが残る（孤児化なし）。
    expect(vi.getTimerCount()).toBe(1);

    // 残ったタイマーを満了させても、消費済み（pendingKind=null）なので二重発火せず、
    // 孤児タイマーも存在しないため最終的にタイマーは0本になる。
    vi.advanceTimersByTime(200);
    expect(settled).toEqual(["b"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("maxWait は連続入力中でも一定間隔で発火させる", () => {
    const core = new DebounceCore("wcs-debounce", undefined, { wait: 100, leading: true, maxWait: 100 });
    const settled: any[] = [];
    core.addEventListener("wcs-debounce:settled", (e) => settled.push((e as CustomEvent).detail.value));

    core.setSource("start"); // leading 発火
    for (let t = 20; t <= 200; t += 20) {
      vi.advanceTimersByTime(20);
      core.setSource(t);
    }
    // leading の "start" に加え、maxWait 境界 (100, 200) で少なくとも2回発火する
    expect(settled[0]).toBe("start");
    expect(settled.length).toBeGreaterThanOrEqual(3);
  });

  it("maxWait を wait 未満で渡しても wait まで引き上げられる", () => {
    const core = new DebounceCore("wcs-debounce", undefined, { wait: 100, maxWait: 10 });
    const settled: any[] = [];
    core.addEventListener("wcs-debounce:settled", (e) => settled.push((e as CustomEvent).detail.value));

    core.setSource("a");
    vi.advanceTimersByTime(50); // maxWait が 10 のままなら既に発火しているはず
    expect(settled).toEqual([]);
    vi.advanceTimersByTime(50);
    expect(settled).toEqual(["a"]);
  });

  // --- cancel / flush ---

  it("cancel は保留中の発火を捨て、getter は前回値を保持する", () => {
    const core = new DebounceCore("wcs-debounce", undefined, { wait: 100 });
    const settled: any[] = [];
    core.addEventListener("wcs-debounce:settled", (e) => settled.push((e as CustomEvent).detail.value));

    core.setSource("a");
    vi.advanceTimersByTime(100);   // settled "a"
    core.setSource("b");           // 新たな保留
    core.cancel();
    vi.advanceTimersByTime(100);

    expect(settled).toEqual(["a"]); // "b" は発火しない
    expect(core.value).toBe("a");
    expect(core.pending).toBe(false);
  });

  it("flush は保留中のペイロードを即発火する", () => {
    const core = new DebounceCore("wcs-debounce", undefined, { wait: 100 });
    const settled: any[] = [];
    core.addEventListener("wcs-debounce:settled", (e) => settled.push((e as CustomEvent).detail.value));

    core.setSource("a");
    core.flush();
    expect(settled).toEqual(["a"]);
    expect(core.pending).toBe(false);

    vi.advanceTimersByTime(100); // 既に flush 済みなので追加発火しない
    expect(settled).toEqual(["a"]);
  });

  it("flush は leading 消費済みでタイマーだけ残る場合は二重発火しない", () => {
    const core = new DebounceCore("wcs-debounce", undefined, { wait: 100, leading: true });
    const settled: any[] = [];
    core.addEventListener("wcs-debounce:settled", (e) => settled.push((e as CustomEvent).detail.value));

    core.setSource("a"); // leading で即発火、pendingKind は消費済み、タイマーのみ残る
    core.flush();        // pendingKind=null なので再発火しない
    expect(settled).toEqual(["a"]);
    expect(core.pending).toBe(false);
  });

  it("maxWait 指定時に wait 内の追加入力で残り時間が再計算される", () => {
    const core = new DebounceCore("wcs-debounce", undefined, { wait: 100, maxWait: 300 });
    const settled: any[] = [];
    core.addEventListener("wcs-debounce:settled", (e) => settled.push((e as CustomEvent).detail.value));

    core.setSource("a");          // t=0
    vi.advanceTimersByTime(50);
    core.setSource("b");          // t=50
    vi.advanceTimersByTime(50);   // t=100 タイマー発火→ remainingWait(maxWait 分岐)で再武装
    expect(settled).toEqual([]);
    vi.advanceTimersByTime(50);   // t=150 trailing 発火
    expect(settled).toEqual(["b"]);
  });

  it("flush は保留がなければ何もしない", () => {
    const core = new DebounceCore("wcs-debounce", undefined, { wait: 100 });
    const settled: any[] = [];
    core.addEventListener("wcs-debounce:settled", (e) => settled.push((e as CustomEvent).detail.value));

    expect(() => core.flush()).not.toThrow();
    expect(settled).toEqual([]);
  });

  // --- kind 混在 / eventPrefix / target ---

  it("value と signal を混在させると最後に書かれた kind が勝つ (last-wins)", () => {
    const core = new DebounceCore("wcs-debounce", undefined, { wait: 100 });
    const settled: any[] = [];
    const fired: any[][] = [];
    core.addEventListener("wcs-debounce:settled", (e) => settled.push((e as CustomEvent).detail.value));
    core.addEventListener("wcs-debounce:fired", (e) => fired.push((e as CustomEvent).detail.args));

    core.setSource("v");   // value
    core.trigger("s");     // signal が後勝ち
    vi.advanceTimersByTime(100);

    expect(settled).toEqual([]);
    expect(fired).toEqual([["s"]]);
  });

  it("eventPrefix を変えると wcs-throttle:* で dispatch する", () => {
    const core = new DebounceCore("wcs-throttle", undefined, { wait: 100 });
    const settled: any[] = [];
    core.addEventListener("wcs-throttle:settled", (e) => settled.push((e as CustomEvent).detail.value));

    core.setSource("a");
    vi.advanceTimersByTime(100);
    expect(settled).toEqual(["a"]);
  });

  it("target を渡すと外部 EventTarget に dispatch する", () => {
    const target = new EventTarget();
    const core = new DebounceCore("wcs-debounce", target, { wait: 100 });
    const settled: any[] = [];
    target.addEventListener("wcs-debounce:settled", (e) => settled.push((e as CustomEvent).detail.value));

    core.setSource("a");
    vi.advanceTimersByTime(100);
    expect(settled).toEqual(["a"]);
  });

  it("時計が巻き戻っても setSource は例外なく処理される (timeSinceLastCall<0 分岐)", () => {
    const spy = vi.spyOn(Date, "now").mockReturnValue(1000);
    const core = new DebounceCore("wcs-debounce", undefined, { wait: 100 });
    core.setSource("a");      // lastCallTime=1000
    spy.mockReturnValue(500); // 時計が戻る
    core.setSource("b");      // shouldInvoke: -500<0 → true 分岐
    expect(core.pending).toBe(true);
    core.cancel();
  });

  // --- configure ---

  it("configure は不正な wait / maxWait を無視しデフォルトを保つ", () => {
    const core = new DebounceCore("wcs-debounce", undefined, { wait: 100 });
    const settled: any[] = [];
    core.addEventListener("wcs-debounce:settled", (e) => settled.push((e as CustomEvent).detail.value));

    core.configure({ wait: -5, maxWait: NaN }); // 無視 → wait は 100 のまま、maxWait 無効
    core.setSource("a");
    vi.advanceTimersByTime(99);
    expect(settled).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(settled).toEqual(["a"]);
  });

  it("configure で leading / trailing を切り替えられる", () => {
    const core = new DebounceCore("wcs-debounce", undefined, { wait: 100 });
    core.configure({ wait: 100, leading: true, trailing: false });
    const settled: any[] = [];
    core.addEventListener("wcs-debounce:settled", (e) => settled.push((e as CustomEvent).detail.value));

    core.setSource("a");
    expect(settled).toEqual(["a"]); // leading で即発火
  });
});
