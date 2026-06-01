import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TimerCore } from "../src/core/TimerCore";

describe("TimerCore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("EventTargetを継承している", () => {
    const core = new TimerCore();
    expect(core).toBeInstanceOf(EventTarget);
  });

  it("初期状態は tick=0 / elapsed=0 / running=false", () => {
    const core = new TimerCore();
    expect(core.tick).toBe(0);
    expect(core.elapsed).toBe(0);
    expect(core.running).toBe(false);
  });

  it("start でインターバルごとに tick が増える", () => {
    const core = new TimerCore();
    core.start({ interval: 1000 });
    expect(core.running).toBe(true);
    expect(core.tick).toBe(0);

    vi.advanceTimersByTime(1000);
    expect(core.tick).toBe(1);
    vi.advanceTimersByTime(2000);
    expect(core.tick).toBe(3);
  });

  it("wcs-timer:tick イベントが count と elapsed を載せて発火する", () => {
    const core = new TimerCore();
    const detail: any[] = [];
    core.addEventListener("wcs-timer:tick", (e) => detail.push((e as CustomEvent).detail));

    core.start({ interval: 1000 });
    vi.advanceTimersByTime(2000);

    expect(detail).toEqual([
      { count: 1, elapsed: 1000 },
      { count: 2, elapsed: 2000 },
    ]);
  });

  it("running-changed イベントが状態変化時のみ発火する", () => {
    const core = new TimerCore();
    const states: boolean[] = [];
    core.addEventListener("wcs-timer:running-changed", (e) => states.push((e as CustomEvent).detail));

    core.start({ interval: 1000 });
    core.start({ interval: 1000 }); // running中の再startはイベントを出さない
    core.stop();

    expect(states).toEqual([true, false]);
  });

  it("immediate で start 直後に1回発火する", () => {
    const core = new TimerCore();
    const detail: any[] = [];
    core.addEventListener("wcs-timer:tick", (e) => detail.push((e as CustomEvent).detail));

    core.start({ interval: 1000, immediate: true });
    expect(core.tick).toBe(1);
    expect(detail[0]).toEqual({ count: 1, elapsed: 0 });

    vi.advanceTimersByTime(1000);
    expect(core.tick).toBe(2);
  });

  it("repeat 回数で自動停止する", () => {
    const core = new TimerCore();
    core.start({ interval: 1000, repeat: 3 });

    vi.advanceTimersByTime(3000);
    expect(core.tick).toBe(3);
    expect(core.running).toBe(false);

    // 停止後は進まない
    vi.advanceTimersByTime(5000);
    expect(core.tick).toBe(3);
  });

  it("immediate + repeat=1 は即時1回で停止しインターバルを張らない", () => {
    const core = new TimerCore();
    core.start({ interval: 1000, repeat: 1, immediate: true });

    expect(core.tick).toBe(1);
    expect(core.running).toBe(false);

    vi.advanceTimersByTime(10000);
    expect(core.tick).toBe(1);
  });

  it("repeat=0 は無制限に動く", () => {
    const core = new TimerCore();
    core.start({ interval: 100, repeat: 0 });

    vi.advanceTimersByTime(1000);
    expect(core.tick).toBe(10);
    expect(core.running).toBe(true);
  });

  it("running中の start は二重に setInterval を張らない", () => {
    const core = new TimerCore();
    core.start({ interval: 1000 });
    core.start({ interval: 1000 });

    vi.advanceTimersByTime(1000);
    // 二重なら 2 になる
    expect(core.tick).toBe(1);
  });

  it("stop は count / elapsed を保持する", () => {
    const core = new TimerCore();
    core.start({ interval: 1000 });
    vi.advanceTimersByTime(2500);

    core.stop();
    expect(core.running).toBe(false);
    expect(core.tick).toBe(2);
    expect(core.elapsed).toBe(2500);

    // 停止後に時間が進んでも elapsed は固定
    vi.advanceTimersByTime(1000);
    expect(core.elapsed).toBe(2500);
  });

  it("reset は count / elapsed を0に戻し tick(0) を発火する", () => {
    const core = new TimerCore();
    const detail: any[] = [];
    core.addEventListener("wcs-timer:tick", (e) => detail.push((e as CustomEvent).detail));

    core.start({ interval: 1000 });
    vi.advanceTimersByTime(2000);
    core.reset();

    expect(core.tick).toBe(0);
    expect(core.elapsed).toBe(0);
    expect(core.running).toBe(false);
    expect(detail[detail.length - 1]).toEqual({ count: 0, elapsed: 0 });
  });

  it("pause / resume で elapsed が継続する", () => {
    const core = new TimerCore();
    core.start({ interval: 1000 });
    vi.advanceTimersByTime(1500);

    core.pause();
    expect(core.running).toBe(false);
    expect(core.elapsed).toBe(1500);

    // 一時停止中は時間が経っても elapsed も tick も進まない
    vi.advanceTimersByTime(5000);
    expect(core.elapsed).toBe(1500);
    expect(core.tick).toBe(1);

    core.resume();
    expect(core.running).toBe(true);
    vi.advanceTimersByTime(500);
    // 再開後 500ms で次の tick (累積 2000ms 相当) が発火
    expect(core.tick).toBe(2);
    expect(core.elapsed).toBe(2000);
  });

  it("resume 中に repeat へ到達した場合はインターバルを張り直さない", () => {
    const core = new TimerCore();
    core.start({ interval: 1000, repeat: 1 });
    vi.advanceTimersByTime(400);

    // 残り 600ms を抱えたまま一時停止 → 再開
    core.pause();
    core.resume();
    vi.advanceTimersByTime(600);

    // 境界 (累積1000ms) で1回発火し repeat=1 到達で停止
    expect(core.tick).toBe(1);
    expect(core.running).toBe(false);

    // 以降は進まない（張り直していない）
    vi.advanceTimersByTime(5000);
    expect(core.tick).toBe(1);
  });

  it("pause -> start -> pause で確実に停止する（_paused が残らない）", () => {
    const core = new TimerCore();
    core.start({ interval: 1000 });
    vi.advanceTimersByTime(500);

    core.pause();
    core.start({ interval: 1000 }); // 新しい running セグメントを開始し _paused を解除
    expect(core.running).toBe(true);

    core.pause(); // ここで no-op にならず停止できること
    expect(core.running).toBe(false);

    vi.advanceTimersByTime(5000);
    expect(core.tick).toBe(0);
  });

  it("pause -> start -> resume でタイマーが二重に張られない", () => {
    const core = new TimerCore();
    core.start({ interval: 1000 });
    vi.advanceTimersByTime(500);

    core.pause();
    core.start({ interval: 1000 }); // _paused 解除済み

    // _paused は false なので resume は no-op（稼働中ハンドルを上書きしない）
    core.resume();

    vi.advanceTimersByTime(1000);
    // 二重なら 2 以上になる。単一タイマーなので 1
    expect(core.tick).toBe(1);
  });

  it("interval が 0 / 負数 / 非有限の場合は無視され既定値が使われる", () => {
    const zero = new TimerCore();
    zero.start({ interval: 0 });
    vi.advanceTimersByTime(1000);
    expect(zero.tick).toBe(1); // 0 は無視 → 既定 1000ms

    const neg = new TimerCore();
    neg.start({ interval: -1 });
    vi.advanceTimersByTime(1000);
    expect(neg.tick).toBe(1);

    const inf = new TimerCore();
    inf.start({ interval: Infinity });
    vi.advanceTimersByTime(1000);
    expect(inf.tick).toBe(1);
  });

  it("不正な interval を与えても直前の有効な周期を保持する", () => {
    const core = new TimerCore();
    core.start({ interval: 250 });
    core.stop();
    core.start({ interval: 0 }); // 無視 → 250 を維持
    vi.advanceTimersByTime(250);
    expect(core.tick).toBe(1);
  });

  it("pause は非running時は何もしない", () => {
    const core = new TimerCore();
    core.pause();
    expect(core.running).toBe(false);

    // 二重 pause も no-op
    core.start({ interval: 1000 });
    core.pause();
    core.pause();
    expect(core.running).toBe(false);
  });

  it("resume は pause していなければ何もしない", () => {
    const core = new TimerCore();
    core.resume();
    expect(core.running).toBe(false);

    // stop 後の resume も無効（pause フラグが落ちている）
    core.start({ interval: 1000 });
    core.stop();
    core.resume();
    expect(core.running).toBe(false);
  });

  it("repeat 完走後に再 start すると次の run でも N 回 tick する", () => {
    const core = new TimerCore();
    core.start({ interval: 1000, repeat: 3 });
    vi.advanceTimersByTime(3000);
    expect(core.tick).toBe(3);
    expect(core.running).toBe(false);

    // reset せずに再 start。_tick は累積したまま (3) だが per-run で 3 回発火すべき
    core.start({ interval: 1000, repeat: 3 });
    expect(core.running).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(core.tick).toBe(6); // 3 + 3
    expect(core.running).toBe(false);

    // 念のため3回目の run も
    core.start({ interval: 1000, repeat: 3 });
    vi.advanceTimersByTime(3000);
    expect(core.tick).toBe(9);
  });

  it("オプションを持ち越さない: 履歴ありの Core で bare start() は repeat=0 / immediate=false に戻る", () => {
    const core = new TimerCore();
    // 一度 one-shot + immediate で構成
    core.start({ interval: 1000, repeat: 1, immediate: true });
    expect(core.tick).toBe(1);
    expect(core.running).toBe(false);

    // 省略 start(): 即時発火せず (immediate=false)、無制限に動く (repeat=0)
    core.start({ interval: 1000 });
    expect(core.tick).toBe(1); // immediate を引き継いでいたら 2 になる
    expect(core.running).toBe(true);

    vi.advanceTimersByTime(3000);
    expect(core.tick).toBe(4); // repeat=1 を引き継いでいたら 2 で停止していたはず
    expect(core.running).toBe(true);
  });

  it("repeat の負数・NaN は無制限 (0) に正規化される", () => {
    const neg = new TimerCore();
    neg.start({ interval: 1000, repeat: -3 });
    vi.advanceTimersByTime(3000);
    expect(neg.tick).toBe(3);
    expect(neg.running).toBe(true);

    const nan = new TimerCore();
    nan.start({ interval: 1000, repeat: NaN });
    vi.advanceTimersByTime(2000);
    expect(nan.running).toBe(true);
  });

  it("start は引数省略時に既定値 (interval=1000, repeat=0) を使う", () => {
    const core = new TimerCore();
    core.start();
    vi.advanceTimersByTime(2000);
    expect(core.tick).toBe(2);
    expect(core.running).toBe(true);
  });

  it("target を渡すとそのターゲットにイベントを発火する", () => {
    const target = new EventTarget();
    const core = new TimerCore(target);
    const detail: any[] = [];
    target.addEventListener("wcs-timer:tick", (e) => detail.push((e as CustomEvent).detail));

    core.start({ interval: 1000 });
    vi.advanceTimersByTime(1000);
    expect(detail).toEqual([{ count: 1, elapsed: 1000 }]);
  });

  it("wcBindable に tick / elapsed / running と各コマンドが宣言されている", () => {
    const props = TimerCore.wcBindable.properties.map((p) => p.name);
    expect(props).toEqual(["tick", "elapsed", "running"]);

    const commands = (TimerCore.wcBindable.commands ?? []).map((c) => c.name);
    expect(commands).toEqual(["start", "stop", "reset", "pause", "resume"]);

    // tick / elapsed は同一イベントから getter で取り出す
    const tickProp = TimerCore.wcBindable.properties.find((p) => p.name === "tick")!;
    const elapsedProp = TimerCore.wcBindable.properties.find((p) => p.name === "elapsed")!;
    const ev = new CustomEvent("wcs-timer:tick", { detail: { count: 7, elapsed: 700 } });
    expect(tickProp.getter!(ev)).toBe(7);
    expect(elapsedProp.getter!(ev)).toBe(700);
  });
});
