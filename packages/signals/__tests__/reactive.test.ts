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

  it("computed の fn が throw しても DIRTY 固着せず、回復後に再計算できる", () => {
    const a = signal(0);
    const c = computed(() => {
      if (a.get() === 1) {
        throw new Error("boom");
      }
      return a.get() * 10;
    });
    expect(c.get()).toBe(0);
    a.set(1);
    // throw は呼び出し元に伝播する（peek/get が throw）。
    expect(() => c.get()).toThrow(/boom/);
    // しかし状態は CLEAN に落ちているので、固着して毎回 throw し続けることはない。
    a.set(2);
    expect(c.get()).toBe(20); // 回復して正常に再計算
  });

  it("computed が自分自身を get する循環は明示的な例外で検出する（スタック爆発でなく）", () => {
    let c!: ReturnType<typeof computed<number>>;
    c = computed(() => c.get() + 1); // 自己参照
    // 初回計算で循環を検出。RangeError(スタックオーバーフロー)でなく分かりやすい
    // メッセージの Error で落ちる。
    let err: unknown;
    try {
      c.get();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(RangeError);
    expect((err as Error).message).toMatch(/circular dependency/);
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

  it("バッチ内の effect が throw しても、同一バッチの他の effect は実行される（隔離）", () => {
    const s = signal(0);
    let goodRuns = 0;
    // throw は reportError 経由で隔離報告される。テストでは捕捉して握りつぶす。
    // In this env reportError falls back to console.error; spy that so the
    // isolated error is captured (and not printed) without failing the test.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // 失敗 effect。本体で必ず throw する。
      effect(() => {
        s.get();
        if (s.peek() > 0) {
          throw new Error("boom");
        }
      });
      // 正常 effect。失敗 effect と同一 signal で同一バッチに積まれる。
      effect(() => {
        s.get();
        goodRuns++;
      });
      flushSync();
      expect(goodRuns).toBe(1); // 初回

      s.set(1); // 両 effect を同一バッチに積む。失敗 effect が throw する。
      flushSync();
      // 失敗 effect が throw しても正常 effect は再実行される（脱落しない）。
      expect(goodRuns).toBe(2);
      expect(spy).toHaveBeenCalled(); // エラーは握りつぶさず報告された
    } finally {
      spy.mockRestore();
    }
  });

  it("プラットフォームの reportError があればそちらに報告する", () => {
    const s = signal(0);
    const calls: unknown[] = [];
    const g = globalThis as { reportError?: (e: unknown) => void };
    const had = "reportError" in g;
    const prev = g.reportError;
    g.reportError = (e: unknown): void => {
      calls.push(e);
    };
    try {
      effect(() => {
        s.get();
        if (s.peek() > 0) {
          throw new Error("boom");
        }
      });
      flushSync();
      s.set(1);
      flushSync();
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect((calls[0] as Error).message).toBe("boom");
    } finally {
      if (had) {
        g.reportError = prev;
      } else {
        delete g.reportError;
      }
    }
  });

  it("throw した effect も次の依存変化でまた実行される（DIRTY 固着しない）", () => {
    const s = signal(0);
    const runs: number[] = [];
    // In this env reportError falls back to console.error; spy that so the
    // isolated error is captured (and not printed) without failing the test.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      effect(() => {
        runs.push(s.get());
        if (s.peek() === 1) {
          throw new Error("boom");
        }
      });
      flushSync(); // runs: [0]
      s.set(1);
      flushSync(); // throw するが CLEAN に落ちる
      s.set(2);
      flushSync(); // 再び実行される（固着していない）
    } finally {
      spy.mockRestore();
    }
    expect(runs).toEqual([0, 1, 2]);
  });

  it("循環 effect（2つの effect が互いの依存を毎回別値で書き換える）は上限で throw して暴走を止める", () => {
    const a = signal(0);
    const b = signal(0);
    // A は b を読み a を毎回別値で更新、B は a を読み b を毎回別値で更新。
    // 互いを永久に再キューし続ける収束しない循環。
    const ha = effect(() => {
      b.get();
      a.set(a.peek() + 1);
    });
    const hb = effect(() => {
      a.get();
      b.set(b.peek() + 1);
    });
    // 暴走はフラッシュ時。上限超過で throw し、キューを破棄して止める。
    expect(() => flushSync()).toThrow(/reactive cycle|exceeded/);
    // キューは破棄済みなので以降のフラッシュは正常（空ドレイン）
    expect(() => flushSync()).not.toThrow();
    ha.dispose();
    hb.dispose();
  });

  it("同一バッチ内で先行 effect が後続 effect の依存を書いても二重実行しない", () => {
    // A（先に積まれる）が shared を書く。B は trig と shared 双方に依存し A と同一
    // バッチに積まれる。A は B より先に走り、その時点で B はまだ DIRTY（キュー外）
    // なので markStale の wasClean ガードで再キューされず、B はこのバッチで 1 回だけ
    // 最新 shared を読んで走る（スプリアスな二重実行が起きない）。
    const trig = signal(0);
    const shared = signal(0);
    const bRuns: number[] = [];
    effect(() => {
      trig.get();
      shared.set(shared.peek() + 1);
    });
    effect(() => {
      trig.get();
      shared.get();
      bRuns.push(shared.peek());
    });
    flushSync();
    bRuns.length = 0;
    trig.set(1);
    flushSync();
    expect(bRuns).toEqual([2]); // 1 回だけ、かつ A の書き込み後の値
  });

  it("effect 本体内から flushSync を再入呼びしても他 effect を取りこぼさず二重実行しない", () => {
    // A は再入で flushSync を呼ぶ。外側ドレインは batch をローカル配列にスナップ
    // ショット済みなので、内側 flushSync が pendingEffects を clear しても外側の
    // B/C は失われない。B/C はそれぞれ 1 回だけ走る。
    const trig = signal(0);
    const order: string[] = [];
    effect(() => {
      trig.get();
      order.push("A");
      if (trig.peek() === 1) {
        flushSync(); // 再入
      }
    });
    effect(() => {
      trig.get();
      order.push("B");
    });
    effect(() => {
      trig.get();
      order.push("C");
    });
    flushSync();
    order.length = 0;
    trig.set(1);
    flushSync();
    const count = (x: string): number => order.filter((o) => o === x).length;
    expect([count("A"), count("B"), count("C")]).toEqual([1, 1, 1]);
  });

  it("再入 flushSync が内側で実仕事をドレインしても外側 effect は 1 回だけ走る", () => {
    const trig = signal(0);
    const inner = signal(0);
    const order: string[] = [];
    effect(() => {
      trig.get();
      order.push("A");
      if (trig.peek() === 1) {
        inner.set(inner.peek() + 1); // D をキュー
        flushSync(); // 内側で D をドレイン
      }
    });
    effect(() => {
      trig.get();
      order.push("B");
    });
    effect(() => {
      inner.get();
      order.push("D");
    });
    flushSync();
    order.length = 0;
    trig.set(1);
    flushSync();
    const count = (x: string): number => order.filter((o) => o === x).length;
    expect(count("B")).toBe(1); // 取りこぼし・二重なし
    expect(count("D")).toBe(1); // 内側でドレインされた
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

  it("createRoot の fn が throw すると、それまでに作った effect は dispose される（リークしない）", () => {
    const a = signal(0);
    let runs = 0;
    expect(() =>
      createRoot(() => {
        effect(() => {
          runs++;
          a.get();
        });
        throw new Error("render-boom"); // effect 生成後に失敗
      }),
    ).toThrow(/render-boom/);
    expect(runs).toBe(1); // 初回実行のみ
    a.set(1);
    flushSync();
    expect(runs).toBe(1); // throw 時に dispose 済み → もう反応しない
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

  it("effect 内で生成した computed は再実行で前回分が untrack され、source にリークしない", () => {
    const src = signal(0);
    const trigger = signal(0);
    // src の observer 集合を覗くための内部アクセス（テスト専用）。
    const observersOf = (s: unknown): Set<unknown> =>
      (s as { _observers: Set<unknown> })._observers;

    createRoot(() => {
      effect(() => {
        trigger.get(); // 再実行トリガ
        const c = computed(() => src.get() * 2); // 実行ごとに新しい computed
        c.get(); // 読んで src に依存を張る
      });
    });

    const initial = observersOf(src).size;
    // 何度も再実行させる。リークがあれば observer が単調増加する。
    for (let i = 1; i <= 10; i++) {
      trigger.set(i);
      flushSync();
    }
    // 前回の computed が untrack されていれば、observer 数は増えない。
    expect(observersOf(src).size).toBe(initial);
  });

  it("createRoot dispose で配下の computed も source から外れる", () => {
    const src = signal(0);
    const observersOf = (s: unknown): Set<unknown> =>
      (s as { _observers: Set<unknown> })._observers;
    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      const c = computed(() => src.get() + 1);
      c.get();
    });
    expect(observersOf(src).size).toBe(1);
    dispose();
    expect(observersOf(src).size).toBe(0); // computed が untrack された
  });

  it("createRoot は依存追跡コンテキストも切り離す（同期読みが外側 observer に漏れない）", () => {
    const inner = signal(0);
    let outerRuns = 0;
    const dispose = effect(() => {
      outerRuns++;
      // 外側 effect の実行中に createRoot 内で inner を同期読み。createRoot が
      // currentObserver を切らないと、この読みが外側 effect を inner の observer に
      // 登録してしまい、inner.set で外側 effect が再実行されてしまう。
      createRoot(() => {
        inner.get();
      });
    });
    expect(outerRuns).toBe(1);
    inner.set(1);
    flushSync();
    expect(outerRuns).toBe(1); // 外側 effect は inner に追跡されていない
    dispose.dispose();
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

  it("フラッシュ外の peek で computed が変化すると、購読 effect は取り残されず再実行される", async () => {
    // 指摘2: ComputedNode._update が観測者を DIRTY 昇格する際、キューに居ない
    // effect が恒久的に取り残されないこと（防御的 re-schedule）の検証。
    const a = signal(1);
    const c = computed(() => a.get() * 2);
    let runs = 0;
    let seen = 0;
    effect(() => {
      runs++;
      seen = c.get();
    });
    flushSync();
    expect([runs, seen]).toEqual([1, 2]);

    // peek で computed を「フラッシュ外」で先に再計算させる。
    // peek 自体は markStale を通らない（依存を張らない）ため、ここで _update が
    // effect を DIRTY に昇格する瞬間、防御的 add が無いと effect が宙に浮く。
    a.set(5);
    expect(c.peek()).toBe(10); // out-of-band 再計算
    flushSync();
    expect([runs, seen]).toEqual([2, 10]); // effect は取り残されず再実行
    await Promise.resolve();
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

  it("カスタム equals が throw しても CLEAN に確定し、毎回再評価で固まらない（例外安全性）", () => {
    // updateIfNecessary の try-finally が、_update（equals 経由）の throw 後も
    // _state を CLEAN にすることを文書化する。これがないと throw した node は
    // DIRTY のまま残り、以降の get/peek が毎回 throw する関数を再実行し続ける。
    const a = signal(1);
    const boom = new Error("equals exploded");
    const c = computed(
      () => a.get(),
      () => {
        throw boom; // user 提供 equals が例外を投げる
      },
    );

    expect(c.get()).toBe(1); // 初回は equals を呼ばない（前値なし）→ 正常

    a.set(2); // 再計算 → equals が throw する
    // 例外は呼び出し元へ伝播する（flush で隔離されない直接 get なので surface する）。
    expect(() => c.peek()).toThrow(boom);

    // throw 後も CLEAN に確定しているので、値の変わらない再読み取りは
    // equals を再実行せず（DIRTY でない）throw もしない。
    expect(() => c.peek()).not.toThrow();
    expect(c.peek()).toBe(2);
  });
});
