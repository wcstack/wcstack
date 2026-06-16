// Tier2 — メモリリーク非発生の自動テスト。
//
// ヒープの絶対量ではなく「内部集合のサイズ」で検証する（happy-dom/vitest で安定・決定的）。
// 観測指標:
//   - 親 signal の `_observers` 集合サイズ（購読の残留＝リーク）。
//   - flushSync 後に pendingEffects 由来の残留 effect が無い（再 flush で値が動かない）。
//   - DOM listener の付け外し回数（addEventListener/removeEventListener のバランス）。
//
// 内部集合へのアクセスは既存テスト（reactive.test.ts の `_observers` 覗き）に倣う。

import { describe, it, expect, vi } from "vitest";
import { signal, computed, effect, createRoot, flushSync } from "../src/reactive.js";
import { h, For, createSignalsElement } from "../src/dom.js";
import { resource } from "../src/resource.js";
import { streamResource } from "../src/streamResource.js";

// 既存テスト同様、source の `_observers` を覗く（テスト専用の内部アクセス）。
const observersOf = (s: unknown): Set<unknown> => (s as { _observers: Set<unknown> })._observers;

describe("リーク非発生: createRoot + dispose の反復", () => {
  it("createRoot + dispose を数千回反復しても親 signal の observer は定常（増えない）", () => {
    const src = signal(0);
    // ベースライン: 反復前の observer 数。
    const baseline = observersOf(src).size;

    const ITER = 3000;
    for (let i = 0; i < ITER; i++) {
      const dispose = createRoot((d) => {
        const c = computed(() => src.get() + 1);
        effect(() => {
          c.get(); // src → c → effect の購読チェーンを張る
        });
        return d;
      });
      flushSync();
      dispose(); // 配下の computed/effect は untrack されるべき
    }

    // 反復後も observer 数はベースラインに戻る（単調増加していない）。
    expect(observersOf(src).size).toBe(baseline);
    // flush しても残留 effect は走らない（pending 残なし）。生きている購読は無いので、
    // src.set でも observer は増えない。
    src.set(1);
    flushSync();
    expect(observersOf(src).size).toBe(baseline);
  });

  it("dispose 済みスコープの effect は flushSync 後に残留しない", () => {
    const src = signal(0);
    let runs = 0;
    const dispose = createRoot((d) => {
      effect(() => {
        src.get();
        runs++;
      });
      return d;
    });
    flushSync();
    expect(runs).toBe(1);
    dispose();
    // dispose 後はいくら set/flush しても走らない（残留 effect なし）。
    for (let i = 0; i < 100; i++) {
      src.set(i);
      flushSync();
    }
    expect(runs).toBe(1);
  });
});

describe("リーク非発生: SignalsElement connect/disconnect の反復", () => {
  const Base = createSignalsElement();
  // disconnect で render 配下の購読が全て切れることを、共有 signal の observer 数で測る。
  const shared = signal(0);

  class LeakProbeElement extends Base {
    protected render(): Node {
      return h("div", null, () => String(shared.get()));
    }
  }
  customElements.define("wcs-leak-probe", LeakProbeElement);

  it("connect/disconnect を数千回反復しても共有 signal の observer は単調増加しない", () => {
    const baseline = observersOf(shared).size;
    const ITER = 2000;
    for (let i = 0; i < ITER; i++) {
      const el = document.createElement("wcs-leak-probe") as HTMLElement;
      document.body.appendChild(el); // connectedCallback → render の購読が張られる
      flushSync();
      el.remove(); // disconnectedCallback → dispose で購読が切れる
    }
    // disconnect で毎回購読が切れているので、observer は溜まらない。
    expect(observersOf(shared).size).toBe(baseline);
    // 接続中の要素が無いので set しても DOM 更新 effect は走らない。
    shared.set(123);
    flushSync();
    expect(observersOf(shared).size).toBe(baseline);
  });
});

describe("リーク非発生: For の mount/unmount 反復と listener バランス", () => {
  it("For の行を反復 mount/unmount しても listener / 購読が積み上がらない", () => {
    const addSpy = vi.spyOn(HTMLElement.prototype, "addEventListener");
    const removeSpy = vi.spyOn(HTMLElement.prototype, "removeEventListener");
    try {
      const items = signal<readonly number[]>([]);
      const src = signal(0);
      const baselineObs = observersOf(src).size;

      const dispose = createRoot((d) => {
        h(
          "ul",
          null,
          For(
            items,
            (n) =>
              h(
                "li",
                {
                  // 各行に listener と src 購読を張る。unmount で両方剥がれるべき。
                  onClick: () => {},
                  "data-v": () => `${n}:${src.get()}`,
                },
                () => String(n),
              ),
            { key: (n) => n },
          ),
        );
        return d;
      });
      flushSync();

      // 何度も「100 行追加 → 全削除」を繰り返す。
      const ROUNDS = 30;
      for (let r = 0; r < ROUNDS; r++) {
        items.set(Array.from({ length: 100 }, (_, i) => i));
        flushSync();
        items.set([]); // 全行 unmount
        flushSync();
      }

      // 全行 unmount 後、src の observer はベースラインに戻る（行の購読が残っていない）。
      expect(observersOf(src).size).toBe(baselineObs);
      // addEventListener と removeEventListener の回数が一致（listener が積み上がっていない）。
      // 全行を消した状態なので、付けた数 = 剥がした数。
      expect(removeSpy.mock.calls.length).toBe(addSpy.mock.calls.length);

      dispose();
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });
});

describe("リーク非発生: resource / streamResource の restart 反復", () => {
  it("resource の args 連続変更（restart）で親 signal の observer 数が定常", async () => {
    const arg = signal(0);
    const baseline = observersOf(arg).size;

    const dispose = createRoot((d) => {
      resource(
        async (a: number, sig: AbortSignal) => {
          // 即解決。abort されたら何もしない（superseded run のリソースを残さない）。
          if (sig.aborted) return a;
          return a;
        },
        { args: () => arg.get() },
      );
      return d;
    });
    flushSync();

    const obsWhileActive = observersOf(arg).size;
    // args を連続変更 → 旧 run は abort、effect 再実行で arg を再購読。
    for (let i = 1; i <= 500; i++) {
      arg.set(i);
      flushSync();
    }
    await new Promise((r) => setTimeout(r, 0));

    // restart を繰り返しても arg の observer 数は active 時と同じ（旧 run の購読が積み上がらない）。
    expect(observersOf(arg).size).toBe(obsWhileActive);

    dispose();
    // dispose 後は購読が切れてベースラインに戻る。
    expect(observersOf(arg).size).toBe(baseline);
  });

  it("streamResource の args 連続変更（restart）で親 signal の observer 数が定常", async () => {
    const arg = signal(0);
    const baseline = observersOf(arg).size;

    const dispose = createRoot((d) => {
      streamResource<number, number, number>(
        async function* (a: number) {
          yield a; // 1 チャンクで即 done
        },
        { args: () => arg.get() },
      );
      return d;
    });
    flushSync();
    const obsWhileActive = observersOf(arg).size;

    for (let i = 1; i <= 300; i++) {
      arg.set(i);
      flushSync();
      await new Promise((r) => setTimeout(r, 0)); // ストリーム 1 周ぶん進める
    }

    expect(observersOf(arg).size).toBe(obsWhileActive);

    dispose();
    expect(observersOf(arg).size).toBe(baseline);
  });
});
