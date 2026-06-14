import { describe, it, expect, vi } from "vitest";
import { signal, computed, effect, createRoot, onCleanup, flushSync, EffectHandle } from "../src/reactive.js";

describe("signal", () => {
  it("値の読み書きができる", () => {
    const s = signal(1);
    expect(s.get()).toBe(1);
    s.set(2);
    expect(s.get()).toBe(2);
  });

  it("peek は値を返すが依存を張らない", () => {
    const s = signal(1);
    let runs = 0;
    effect(() => {
      runs++;
      s.peek();
    });
    flushSync();
    expect(runs).toBe(1);
    s.set(2);
    flushSync();
    // peek なので再実行されない
    expect(runs).toBe(1);
  });

  it("同値の set は通知しない（Object.is ガード）", () => {
    const s = signal(1);
    let runs = 0;
    effect(() => {
      runs++;
      s.get();
    });
    flushSync();
    expect(runs).toBe(1);
    s.set(1);
    flushSync();
    expect(runs).toBe(1);
  });

  it("カスタム equals を使える", () => {
    const s = signal({ id: 1 }, (a, b) => a.id === b.id);
    let seen: any;
    effect(() => {
      seen = s.get();
    });
    flushSync();
    s.set({ id: 1 }); // 同じ id → 通知しない
    flushSync();
    expect(seen).toEqual({ id: 1 });
    s.set({ id: 2 });
    flushSync();
    expect(seen).toEqual({ id: 2 });
  });
});

describe("computed", () => {
  it("派生値を計算する", () => {
    const a = signal(2);
    const b = signal(3);
    const sum = computed(() => a.get() + b.get());
    expect(sum.get()).toBe(5);
    a.set(10);
    expect(sum.get()).toBe(13);
  });

  it("遅延評価かつメモ化される", () => {
    const a = signal(1);
    const fn = vi.fn(() => a.get() * 2);
    const c = computed(fn);
    expect(fn).not.toHaveBeenCalled(); // get するまで計算しない
    expect(c.get()).toBe(2);
    expect(c.get()).toBe(2);
    expect(fn).toHaveBeenCalledTimes(1); // メモ化
    a.set(5);
    expect(c.get()).toBe(10);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("computed をネストできる", () => {
    const a = signal(1);
    const doubled = computed(() => a.get() * 2);
    const quad = computed(() => doubled.get() * 2);
    expect(quad.get()).toBe(4);
    a.set(3);
    expect(quad.get()).toBe(12);
  });

  it("peek は computed でも依存を張らずに最新値を返す", () => {
    const a = signal(2);
    const c = computed(() => a.get() * 10);
    expect(c.peek()).toBe(20);
    a.set(3);
    expect(c.peek()).toBe(30);
  });

  it("購読者がいる computed が複数回 dirty 化されても通知は1回に畳まれる", () => {
    const a = signal(1);
    const c = computed(() => a.get() * 2);
    let runs = 0;
    effect(() => {
      runs++;
      c.get();
    });
    flushSync();
    expect(runs).toBe(1);
    a.set(2); // c は dirty false→true（effect を通知）
    a.set(3); // c は既に dirty → 通知をスキップ
    flushSync();
    expect(runs).toBe(2);
    expect(c.peek()).toBe(6);
  });

  it("動的依存: 条件で参照しなくなった signal は再実行しない", () => {
    const cond = signal(true);
    const x = signal(1);
    const y = signal(100);
    const fn = vi.fn(() => (cond.get() ? x.get() : y.get()));
    const c = computed(fn);
    expect(c.get()).toBe(1);
    cond.set(false);
    expect(c.get()).toBe(100);
    fn.mockClear();
    // x はもう依存に無い → 再計算不要
    x.set(2);
    c.get();
    expect(fn).not.toHaveBeenCalled();
    // y は依存している → 再計算
    y.set(200);
    expect(c.get()).toBe(200);
  });
});

describe("effect", () => {
  it("生成時に同期実行され、依存変化で再実行される", async () => {
    const s = signal(1);
    const seen: number[] = [];
    effect(() => {
      seen.push(s.get());
    });
    expect(seen).toEqual([1]); // 即時実行
    s.set(2);
    await Promise.resolve(); // microtask 待ち
    expect(seen).toEqual([1, 2]);
  });

  it("同一 tick の複数 set を 1 回の再実行に畳む（coalesce）", () => {
    const s = signal(0);
    let runs = 0;
    effect(() => {
      runs++;
      s.get();
    });
    expect(runs).toBe(1);
    s.set(1);
    s.set(2);
    s.set(3);
    flushSync();
    expect(runs).toBe(2); // 初回 + 1回だけ
  });

  it("再実行前と dispose 時に cleanup が呼ばれる", () => {
    const s = signal(0);
    const cleanup = vi.fn();
    const handle = effect(() => {
      s.get();
      return cleanup;
    });
    expect(cleanup).not.toHaveBeenCalled();
    s.set(1);
    flushSync();
    expect(cleanup).toHaveBeenCalledTimes(1); // 再実行前
    handle.dispose();
    expect(cleanup).toHaveBeenCalledTimes(2); // dispose 時
  });

  it("cleanup を返さない effect も問題なく動く", () => {
    const s = signal(0);
    let runs = 0;
    const handle = effect(() => {
      runs++;
      s.get();
    });
    s.set(1);
    flushSync();
    expect(runs).toBe(2);
    handle.dispose(); // cleanup 無しでも例外を投げない
  });

  it("dispose 後は再実行されない", () => {
    const s = signal(0);
    let runs = 0;
    const handle = effect(() => {
      runs++;
      s.get();
    });
    handle.dispose();
    s.set(1);
    flushSync();
    expect(runs).toBe(1);
  });

  it("dispose は冪等", () => {
    const cleanup = vi.fn();
    const handle = effect(() => cleanup);
    handle.dispose();
    handle.dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("既にキューに積まれた effect を dispose しても再実行されない", () => {
    const s = signal(0);
    let runs = 0;
    const handle = effect(() => {
      runs++;
      s.get();
    });
    s.set(1); // キューに積む
    handle.dispose(); // フラッシュ前に dispose
    flushSync();
    expect(runs).toBe(1);
  });

  it("同一バッチ内で他の effect を dispose すると、その effect は再実行されない", () => {
    const a = signal(0);
    let bRuns = 0;
    let handleB: EffectHandle | undefined;
    // A は実行のたびに B を dispose する。両者が同じ signal で同一バッチに積まれた
    // とき、A の実行中に B が dispose され、バッチに残った B の再実行は抑止される。
    effect(() => {
      a.get();
      handleB?.dispose();
    });
    handleB = effect(() => {
      bRuns++;
      a.get();
    });
    flushSync();
    expect(bRuns).toBe(1);
    a.set(1); // A と B が同一バッチに積まれる
    flushSync();
    expect(bRuns).toBe(1); // B は dispose 済みで再実行されない
  });

  it("effect 内で signal を更新するとループ内で追従する", () => {
    const a = signal(0);
    const mirror = signal(-1);
    effect(() => {
      mirror.set(a.get());
    });
    flushSync();
    expect(mirror.peek()).toBe(0);
    a.set(7);
    flushSync();
    expect(mirror.peek()).toBe(7);
  });
});

describe("ownership (createRoot / onCleanup)", () => {
  it("createRoot の dispose で配下の effect が止まる", () => {
    const a = signal(0);
    let runs = 0;
    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      effect(() => {
        runs++;
        a.get();
      });
    });
    expect(runs).toBe(1);
    a.set(1);
    flushSync();
    expect(runs).toBe(2);
    dispose();
    a.set(2);
    flushSync();
    expect(runs).toBe(2); // dispose 後は再実行されない
  });

  it("createRoot の dispose は冪等", () => {
    const cleanup = vi.fn();
    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      onCleanup(cleanup);
    });
    dispose();
    dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("createRoot は fn の戻り値を返す", () => {
    const result = createRoot(() => 42);
    expect(result).toBe(42);
  });

  it("親 effect が再実行されると、前回の実行で作った子 effect は dispose される", () => {
    const outer = signal(0);
    const inner = signal(0);
    let innerRuns = 0;
    createRoot(() => {
      effect(() => {
        outer.get(); // 親の依存
        // 親の実行ごとに子 effect を作る
        effect(() => {
          innerRuns++;
          inner.get();
        });
      });
    });
    expect(innerRuns).toBe(1);

    inner.set(1);
    flushSync();
    expect(innerRuns).toBe(2); // 子は生きている

    outer.set(1); // 親が再実行 → 前回の子は dispose、新しい子を作る
    flushSync();
    expect(innerRuns).toBe(3); // 新しい子の初回実行

    inner.set(2);
    flushSync();
    expect(innerRuns).toBe(4); // 新しい子だけが反応（古い子は dispose 済みで重複しない）
  });

  it("onCleanup は owner が無ければ no-op", () => {
    // 例外を投げないことの確認
    expect(() => onCleanup(() => {})).not.toThrow();
  });

  it("effect の dispose 時に子 effect も連鎖して dispose される", () => {
    const s = signal(0);
    let childRuns = 0;
    const parent = effect(() => {
      effect(() => {
        childRuns++;
        s.get();
      });
    });
    expect(childRuns).toBe(1);
    parent.dispose();
    s.set(1);
    flushSync();
    expect(childRuns).toBe(1); // 親 dispose で子も止まる
  });
});

describe("equality short-circuit（値等価の伝播短絡）", () => {
  it("computed が同値に再計算されたら下流 effect は再実行されない", () => {
    const a = signal(0);
    const parity = computed(() => a.get() % 2);
    let runs = 0;
    effect(() => {
      runs++;
      parity.get();
    });
    flushSync();
    expect(runs).toBe(1);

    a.set(2); // parity 0→0（同値）
    flushSync();
    expect(runs).toBe(1); // 短絡：再実行されない

    a.set(3); // parity 0→1（変化）
    flushSync();
    expect(runs).toBe(2);
  });

  it("CHECK 検証で signal ソースはスキップし computed のみ再評価する", () => {
    const a = signal(0);
    const b = signal("x");
    const parity = computed(() => a.get() % 2);
    let runs = 0;
    effect(() => {
      runs++;
      b.get(); // signal を直接依存に持つ
      parity.get(); // computed も依存
    });
    flushSync();
    expect(runs).toBe(1);

    a.set(2); // b 不変・parity 同値 → effect は CHECK だが skip
    flushSync();
    expect(runs).toBe(1);
  });

  it("連鎖 computed: 中間が同値なら最終 effect を skip、変化すれば実行", () => {
    const n = signal(2);
    const even = computed(() => n.get() % 2 === 0);
    const label = computed(() => (even.get() ? "even" : "odd"));
    let runs = 0;
    let last = "";
    effect(() => {
      runs++;
      last = label.get();
    });
    flushSync();
    expect([runs, last]).toEqual([1, "even"]);

    n.set(4); // even true→true、label 同値 → skip
    flushSync();
    expect(runs).toBe(1);

    n.set(3); // even→false、label "odd" → 実行
    flushSync();
    expect([runs, last]).toEqual([2, "odd"]);
  });

  it("computed のカスタム equals で短絡できる", () => {
    const a = signal({ v: 1, meta: "x" });
    const c = computed(
      () => a.get(),
      (prev, next) => prev.v === next.v,
    );
    let runs = 0;
    effect(() => {
      runs++;
      c.get();
    });
    flushSync();
    expect(runs).toBe(1);

    a.set({ v: 1, meta: "y" }); // v 同じ → 短絡
    flushSync();
    expect(runs).toBe(1);

    a.set({ v: 2, meta: "z" }); // v 変化 → 実行
    flushSync();
    expect(runs).toBe(2);
  });
});
