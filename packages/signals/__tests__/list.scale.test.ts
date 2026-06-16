// Tier2 — 大規模スケールテスト（For / Index）。
//
// 1,000〜数千要素規模で create / 全更新 / reorder（昇順↔降順・ランダムシャッフル）/
// 部分挿入・削除 / 全削除 の「正しさ」を検証する。LIS reorder が大規模でも正しい順序を
// 生成し、ノード identity を再利用することを固定する。性能は happy-dom の絶対時間ではなく
// 「insertBefore 移動回数」のゆるい上限で O(n^2) 退行のみを検知する（フレーク回避）。
//
// あわせて、computed の深いチェーン（数百段）が正しく伝播・収束することも確認する。

import { describe, it, expect } from "vitest";
import { h, For, Index, signal, computed, effect, createRoot, flushSync } from "../src/dom.js";

const SIZE = 1000;

interface Item {
  id: number;
}

const range = (n: number, from = 0): Item[] => Array.from({ length: n }, (_, i) => ({ id: from + i }));

// 決定的な擬似乱数（シード固定）。フレーク回避のため Math.random は使わない。
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    // xorshift32
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0xffffffff;
  };
}

function shuffled<T>(arr: readonly T[], rng: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// host の insertBefore 呼び出し回数を数える計装。reconcileOrder が動かす回数の上限を
// ゆるく押さえ、O(n^2) 退行（=フル並べ替えごとに n 回近く動く）を検知する。
function countingHost<T extends Node>(host: T): { host: T; moves: () => number; reset: () => void } {
  let moves = 0;
  const orig = host.insertBefore.bind(host);
  (host as unknown as { insertBefore: Node["insertBefore"] }).insertBefore = ((node: Node, ref: Node | null) => {
    moves++;
    return orig(node, ref);
  }) as Node["insertBefore"];
  return { host, moves: () => moves, reset: () => (moves = 0) };
}

describe("大規模 For: create / 全更新 / reorder / 挿入削除 / 全削除", () => {
  it("初期描画で 1000 行を正しい順序で展開する", () => {
    const list = signal<readonly Item[]>(range(SIZE));
    const dispose = createRoot((d) => {
      const ul = h("ul", null, For(list, (it) => h("li", null, () => String(it.id)), { key: (it) => it.id })) as HTMLUListElement;
      flushSync();
      const ids = [...ul.querySelectorAll("li")].map((li) => Number(li.textContent));
      expect(ids).toEqual(range(SIZE).map((it) => it.id));
      expect(ul.querySelectorAll("li").length).toBe(SIZE);
      return d;
    });
    dispose();
  });

  it("昇順↔降順の reorder で順序が正しく、Node identity を全行再利用する", () => {
    const list = signal<readonly Item[]>(range(SIZE));
    const dispose = createRoot((d) => {
      const ul = h("ul", null, For(list, (it) => h("li", null, () => String(it.id)), { key: (it) => it.id })) as HTMLUListElement;
      flushSync();
      const before = new Map([...ul.querySelectorAll("li")].map((li) => [Number(li.textContent), li]));

      // 降順へ。
      list.set(range(SIZE).slice().reverse());
      flushSync();
      const afterDesc = [...ul.querySelectorAll("li")];
      expect(afterDesc.map((li) => Number(li.textContent))).toEqual(range(SIZE).map((it) => it.id).reverse());
      // 全行が同一 DOM ノード（再利用、再生成なし）。
      for (const li of afterDesc) {
        expect(before.get(Number(li.textContent))).toBe(li);
      }

      // 昇順へ戻す。
      list.set(range(SIZE));
      flushSync();
      const afterAsc = [...ul.querySelectorAll("li")];
      expect(afterAsc.map((li) => Number(li.textContent))).toEqual(range(SIZE).map((it) => it.id));
      for (const li of afterAsc) {
        expect(before.get(Number(li.textContent))).toBe(li);
      }
      return d;
    });
    dispose();
  });

  it("ランダムシャッフルでも最終 DOM 順序が期待と一致し、ノードを再利用する（決定的シード）", () => {
    const rng = makeRng(0x9e3779b9);
    const list = signal<readonly Item[]>(range(SIZE));
    const dispose = createRoot((d) => {
      const ul = h("ul", null, For(list, (it) => h("li", null, () => String(it.id)), { key: (it) => it.id })) as HTMLUListElement;
      flushSync();
      const nodeById = new Map([...ul.querySelectorAll("li")].map((li) => [Number(li.textContent), li]));

      for (let round = 0; round < 5; round++) {
        const next = shuffled(range(SIZE), rng);
        list.set(next);
        flushSync();
        const after = [...ul.querySelectorAll("li")];
        expect(after.map((li) => Number(li.textContent))).toEqual(next.map((it) => it.id));
        // 同じ id の行は最初の DOM ノードがそのまま再利用される。
        for (const li of after) {
          expect(nodeById.get(Number(li.textContent))).toBe(li);
        }
      }
      return d;
    });
    dispose();
  });

  it("部分挿入・部分削除で順序と件数が正しい", () => {
    const list = signal<readonly Item[]>(range(SIZE));
    const dispose = createRoot((d) => {
      const ul = h("ul", null, For(list, (it) => h("li", null, () => String(it.id)), { key: (it) => it.id })) as HTMLUListElement;
      flushSync();

      // 中央に 100 件挿入（id は既存と衝突しない 10000 番台）。
      const base = range(SIZE);
      const inserted = range(100, 10000);
      const mid = base.length >> 1;
      const withInsert = [...base.slice(0, mid), ...inserted, ...base.slice(mid)];
      list.set(withInsert);
      flushSync();
      expect([...ul.querySelectorAll("li")].map((li) => Number(li.textContent))).toEqual(withInsert.map((it) => it.id));

      // 偶数 id を削除（部分削除）。
      const remaining = withInsert.filter((it) => it.id % 2 === 0 ? false : true);
      list.set(remaining);
      flushSync();
      expect([...ul.querySelectorAll("li")].map((li) => Number(li.textContent))).toEqual(remaining.map((it) => it.id));
      expect(ul.querySelectorAll("li").length).toBe(remaining.length);
      return d;
    });
    dispose();
  });

  it("全削除で行が消え、再投入で復活する", () => {
    const list = signal<readonly Item[]>(range(SIZE));
    const dispose = createRoot((d) => {
      const ul = h("ul", null, For(list, (it) => h("li", null, () => String(it.id)), { key: (it) => it.id })) as HTMLUListElement;
      flushSync();
      list.set([]);
      flushSync();
      expect(ul.querySelectorAll("li").length).toBe(0);
      list.set(range(SIZE));
      flushSync();
      expect([...ul.querySelectorAll("li")].map((li) => Number(li.textContent))).toEqual(range(SIZE).map((it) => it.id));
      return d;
    });
    dispose();
  });

  it("末尾追加 reorder の移動回数は O(n) 退行しない（ゆるい上限）", () => {
    // a,b,...,既存 が全て正位置に残り、末尾だけ増える場合、LIS が全既存行を拾うので
    // 移動は「新規追加分のみ」に収まるべき。O(n^2)/フル並べ替え退行なら移動が SIZE 規模になる。
    const N = 500;
    const list = signal<readonly Item[]>(range(N));
    const dispose = createRoot((d) => {
      const ul = h("ul", null, For(list, (it) => h("li", null, () => String(it.id)), { key: (it) => it.id })) as HTMLUListElement;
      flushSync();
      const inst = countingHost(ul);
      inst.reset();
      // 末尾に 50 件追加。
      list.set(range(N + 50));
      flushSync();
      // 追加 50 件ぶんの insertBefore だけで済むはず（既存行は LIS で据え置き）。
      // ゆるい上限: 追加件数の数倍まで許容（フレーク回避）。
      expect(inst.moves()).toBeLessThanOrEqual(50 * 3);
      expect([...ul.querySelectorAll("li")].map((li) => Number(li.textContent))).toEqual(range(N + 50).map((it) => it.id));
      return d;
    });
    dispose();
  });
});

describe("大規模 Index: create / 全更新 / 縮小拡大", () => {
  it("1000 スロットを描画し、値更新がスロット再利用で反映される", () => {
    const data = signal<readonly number[]>(Array.from({ length: SIZE }, (_, i) => i));
    const dispose = createRoot((d) => {
      const ul = h("ul", null, Index(data, (item) => h("li", null, () => String(item())))) as HTMLUListElement;
      flushSync();
      const before = [...ul.querySelectorAll("li")];
      expect(before.map((li) => Number(li.textContent))).toEqual(Array.from({ length: SIZE }, (_, i) => i));

      // 全更新（各スロットの値を +1000）。スロット（DOM ノード）は再利用される。
      data.set(Array.from({ length: SIZE }, (_, i) => i + 1000));
      flushSync();
      const after = [...ul.querySelectorAll("li")];
      expect(after.map((li) => Number(li.textContent))).toEqual(Array.from({ length: SIZE }, (_, i) => i + 1000));
      for (let i = 0; i < SIZE; i++) {
        expect(after[i]).toBe(before[i]); // 同一スロットノードを再利用
      }
      return d;
    });
    dispose();
  });

  it("縮小・拡大で件数が正しく追従する", () => {
    const data = signal<readonly number[]>(Array.from({ length: SIZE }, (_, i) => i));
    const dispose = createRoot((d) => {
      const ul = h("ul", null, Index(data, (item) => h("li", null, () => String(item())))) as HTMLUListElement;
      flushSync();
      data.set(Array.from({ length: 100 }, (_, i) => i)); // 縮小
      flushSync();
      expect(ul.querySelectorAll("li").length).toBe(100);
      data.set(Array.from({ length: 2000 }, (_, i) => i)); // 拡大
      flushSync();
      expect(ul.querySelectorAll("li").length).toBe(2000);
      expect([...ul.querySelectorAll("li")].map((li) => Number(li.textContent))).toEqual(
        Array.from({ length: 2000 }, (_, i) => i),
      );
      return d;
    });
    dispose();
  });
});

describe("深いチェーン: computed 数百段の伝播と収束", () => {
  it("400 段の computed チェーンが正しく伝播し、1 回の flush で収束する", () => {
    const DEPTH = 400;
    const dispose = createRoot((d) => {
      const base = signal(1);
      let prev: { get(): number; peek(): number } = base;
      for (let i = 0; i < DEPTH; i++) {
        const p = prev;
        prev = computed(() => p.get() + 1);
      }
      const tail = prev;
      let runs = 0;
      let seen = NaN;
      effect(() => {
        seen = tail.get();
        runs++;
      });
      flushSync();
      expect(seen).toBe(1 + DEPTH); // base=1 に +1 を DEPTH 回
      expect(runs).toBe(1);

      base.set(10);
      flushSync();
      expect(seen).toBe(10 + DEPTH);
      expect(runs).toBe(2); // 1 回の更新につき effect は 1 回（過剰実行なし）
      return d;
    });
    dispose();
  });

  it("深い effect 連鎖（各段が次段の signal を書く）が収束し、誤って循環検出 throw しない", () => {
    // 正常な深い連鎖: signal[0] → effect → signal[1] → effect → … → signal[N]。
    // MAX_FLUSH_ITERATIONS(=1000) 以内に収束し、循環ではないので throw しない。
    const N = 300;
    const dispose = createRoot((d) => {
      const sigs = Array.from({ length: N + 1 }, () => signal(0));
      for (let i = 0; i < N; i++) {
        const src = sigs[i];
        const dst = sigs[i + 1];
        effect(() => {
          dst.set(src.get() + 1); // 上流の値 +1 を下流に書く（一方向、循環なし）
        });
      }
      expect(() => flushSync()).not.toThrow();
      // 末尾は 0 → +1 を N 回伝播。
      expect(sigs[N].peek()).toBe(N);

      sigs[0].set(100);
      expect(() => flushSync()).not.toThrow();
      expect(sigs[N].peek()).toBe(100 + N);
      return d;
    });
    dispose();
  });
});
