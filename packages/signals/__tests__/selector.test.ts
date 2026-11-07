// selector(): one boolean per key over one source (Solid's createSelector) — docs/signals-performance-study.md.

import { describe, it, expect, vi } from "vitest";
import { signal, effect, computed, createRoot, flushSync, selector } from "../src/reactive.js";
import { h, For, selector as selectorFromDom } from "../src/dom.js";
import { selector as selectorFromEntry } from "../src/exports.js";

describe("selector: 変わった key の読み手だけを再実行する", () => {
  it("source が変わると、離れた key と移った key の読み手だけが再実行される", () => {
    const selected = signal<number | null>(null);
    const runs = [0, 0, 0, 0];
    const seen: boolean[] = [false, false, false, false];
    const dispose = createRoot((d) => {
      const isSelected = selector(selected);
      for (let i = 0; i < 4; i++) {
        effect(() => {
          seen[i] = isSelected(i);
          runs[i]++;
        });
      }
      return d;
    });
    expect(runs).toEqual([1, 1, 1, 1]);

    selected.set(1);
    flushSync();
    expect(seen).toEqual([false, true, false, false]);
    expect(runs).toEqual([1, 2, 1, 1]);

    selected.set(3);
    flushSync();
    expect(seen).toEqual([false, false, false, true]);
    expect(runs).toEqual([1, 3, 1, 2]);

    // 読み手のいない key へ: 離れた key の読み手だけ
    selected.set(9);
    flushSync();
    expect(seen).toEqual([false, false, false, false]);
    expect(runs).toEqual([1, 3, 1, 3]);

    // 同じ値の書き込みは誰も起こさない
    selected.set(9);
    flushSync();
    expect(runs).toEqual([1, 3, 1, 3]);
    dispose();
  });

  it("同じ tick で行って戻ると誰も再実行しない", () => {
    const selected = signal(0);
    let runs = 0;
    const dispose = createRoot((d) => {
      const isSelected = selector(selected);
      effect(() => {
        isSelected(0);
        runs++;
      });
      return d;
    });
    selected.set(1);
    selected.set(0);
    flushSync();
    expect(runs).toBe(1);
    dispose();
  });

  it("呼び出しは今の source を読む（effect が走る前でも、読み手の外からでも）", () => {
    const selected = signal("a");
    const dispose = createRoot((d) => {
      const isSelected = selector(selected);
      expect(isSelected("a")).toBe(true);
      selected.set("b");
      // まだ flush していない
      expect(isSelected("b")).toBe(true);
      expect(isSelected("a")).toBe(false);
      return d;
    });
    dispose();
  });

  it("key は Map のキーと同じに比べる（NaN は NaN と等しい）。オブジェクトは id の computed で選ぶ", () => {
    interface Item { id: number }
    const selected = signal<Item | null>({ id: 1 });
    const nan = signal(0);
    const runs: Record<number, number> = { 1: 0, 2: 0 };
    let second = false;
    let isNaNSelected = false;
    const dispose = createRoot((d) => {
      const isSelected = selector(computed(() => selected.get()?.id));
      effect(() => {
        isSelected(1);
        runs[1]++;
      });
      effect(() => {
        second = isSelected(2);
        runs[2]++;
      });
      const isNan = selector(nan);
      effect(() => {
        isNaNSelected = isNan(NaN);
      });
      return d;
    });
    // 同じ id の別オブジェクト: id は変わらないので誰も起こさない
    selected.set({ id: 1 });
    flushSync();
    expect(runs).toEqual({ 1: 1, 2: 1 });
    selected.set({ id: 2 });
    flushSync();
    expect(second).toBe(true);
    expect(runs).toEqual({ 1: 2, 2: 2 });
    nan.set(NaN);
    flushSync();
    expect(isNaNSelected).toBe(true);
    nan.set(Number.NaN); // NaN から NaN: 変わらない
    flushSync();
    expect(isNaNSelected).toBe(true);
    dispose();
  });

  it("computed の source と computed の読み手でも働く", () => {
    const n = signal(0);
    const parity = computed(() => n.get() % 2);
    const dispose = createRoot((d) => {
      const isParity = selector(parity);
      const odd = computed(() => isParity(1));
      let out: boolean[] = [];
      effect(() => {
        out = [odd.get()];
      });
      n.set(2); // parity は 0 のまま
      flushSync();
      expect(out).toEqual([false]);
      n.set(3);
      flushSync();
      expect(out).toEqual([true]);
      return d;
    });
    dispose();
  });
});

describe("selector: 読み手が消えた key を覚えない", () => {
  it("key の最後の読み手が片付くと、その key を忘れる", () => {
    const selected = signal<string | null>(null);
    const del = vi.spyOn(Map.prototype, "delete");
    try {
      const outer = createRoot((d) => {
        const isSelected = selector(selected);
        const rowA = createRoot((dr) => {
          effect(() => {
            isSelected("key-a");
          });
          effect(() => {
            isSelected("key-a"); // 2 人目の読み手
          });
          return dr;
        });
        const rowB = createRoot((dr) => {
          effect(() => {
            isSelected("key-b");
          });
          return dr;
        });
        rowB();
        expect(del).toHaveBeenCalledWith("key-b");
        expect(del).not.toHaveBeenCalledWith("key-a");
        rowA();
        expect(del).toHaveBeenCalledWith("key-a");
        return d;
      });
      // 忘れた key をまた読むと購読を作り直す
      let seen = false;
      const again = createRoot((d) => {
        const isSelected = selector(selected);
        effect(() => {
          seen = isSelected("key-a");
        });
        return d;
      });
      selected.set("key-a");
      flushSync();
      expect(seen).toBe(true);
      again();
      outer();
    } finally {
      del.mockRestore();
    }
  });

  it("読み手の外からの呼び出しは key を覚えない", () => {
    const selected = signal(1);
    const set = vi.spyOn(Map.prototype, "set");
    try {
      const dispose = createRoot((d) => {
        const isSelected = selector(selected);
        set.mockClear();
        expect(isSelected(1)).toBe(true);
        expect(isSelected(2)).toBe(false);
        expect(set).not.toHaveBeenCalled();
        return d;
      });
      dispose();
    } finally {
      set.mockRestore();
    }
  });

  it("所有者を片付けると source の変化に反応しない", () => {
    const selected = signal(0);
    let runs = 0;
    const dispose = createRoot((d) => {
      const isSelected = selector(selected);
      effect(() => {
        isSelected(1);
        runs++;
      });
      return d;
    });
    dispose();
    selected.set(1);
    flushSync();
    expect(runs).toBe(1);
  });
});

describe("selector: リストの行（js-framework-benchmark の select row）", () => {
  it("For の行の class を selector で書くと、選び直しで動く行は 2 つだけ", () => {
    const rows = signal(Array.from({ length: 100 }, (_, i) => ({ id: i + 1, label: `row ${i + 1}` })));
    const selected = signal(0);
    let classRuns = 0;
    let tbody!: HTMLElement;
    const dispose = createRoot((d) => {
      const isSelected = selector(selected);
      tbody = h("tbody", null,
        For(rows, (row) => h("tr", {
          class: () => {
            classRuns++;
            return isSelected(row.id) ? "danger" : "";
          },
        }, row.label), { key: (row) => row.id }),
      ) as HTMLElement;
      return d;
    });
    expect(classRuns).toBe(100);
    selected.set(5);
    flushSync();
    expect(classRuns).toBe(101);
    expect(tbody.querySelector(".danger")?.textContent).toBe("row 5");
    selected.set(7);
    flushSync();
    expect(classRuns).toBe(103);
    expect(tbody.querySelectorAll(".danger").length).toBe(1);
    expect(tbody.querySelector(".danger")?.textContent).toBe("row 7");
    // 選んだ行を消してから戻しても、新しい行の読み手が拾う
    rows.set(rows.peek().filter((r) => r.id !== 7));
    flushSync();
    expect(tbody.querySelector(".danger")).toBeNull();
    rows.set([...rows.peek(), { id: 7, label: "row 7 again" }]);
    flushSync();
    expect(tbody.querySelector(".danger")?.textContent).toBe("row 7 again");
    dispose();
  });

  it("@wcstack/signals と /dom の両方から同じ selector を読める", () => {
    expect(selectorFromDom).toBe(selector);
    expect(selectorFromEntry).toBe(selector);
  });
});
