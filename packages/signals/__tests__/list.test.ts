// Phase 3b — keyed lists For / Index (migration-plan §9-3).

import { describe, it, expect } from "vitest";
import {
  h, For, Index, signal, computed, createRoot, onCleanup, flushSync,
} from "../src/dom.js";

interface Person {
  id: number;
  name: string;
}

const P = (id: number, name: string): Person => ({ id, name });

describe("For: keyed リスト", () => {
  it("初期描画でリストを行に展開する", () => {
    const list = signal<readonly Person[]>([P(1, "a"), P(2, "b"), P(3, "c")]);
    const ul = h("ul", null,
      For(list, (p) => h("li", null, () => p.name), { key: (p) => p.id }),
    ) as HTMLUListElement;
    flushSync();
    expect([...ul.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["a", "b", "c"]);
  });

  it("並び替えで Node を再利用し移動だけ行う（VDOM 再生成しない）", () => {
    const list = signal<readonly Person[]>([P(1, "a"), P(2, "b"), P(3, "c")]);
    const ul = h("ul", null,
      For(list, (p) => h("li", null, () => p.name), { key: (p) => p.id }),
    ) as HTMLUListElement;
    flushSync();
    const [a, b, c] = [...ul.querySelectorAll("li")];

    list.set([P(3, "c"), P(1, "a"), P(2, "b")]);
    flushSync();
    const after = [...ul.querySelectorAll("li")];
    expect(after.map((li) => li.textContent)).toEqual(["c", "a", "b"]);
    // Same DOM nodes, just reordered — not rebuilt.
    expect(after[0]).toBe(c);
    expect(after[1]).toBe(a);
    expect(after[2]).toBe(b);
  });

  it("末尾が既に正位置なら移動をスキップする（追加のみ）", () => {
    const list = signal<readonly Person[]>([P(1, "a"), P(2, "b")]);
    const ul = h("ul", null,
      For(list, (p) => h("li", null, p.name), { key: (p) => p.id }),
    ) as HTMLUListElement;
    flushSync();
    const [a, b] = [...ul.querySelectorAll("li")];
    list.set([P(1, "a"), P(2, "b"), P(3, "c")]); // a,b stay put; c appended
    flushSync();
    const after = [...ul.querySelectorAll("li")];
    expect(after[0]).toBe(a);
    expect(after[1]).toBe(b);
    expect(after.map((li) => li.textContent)).toEqual(["a", "b", "c"]);
  });

  it("消えたキーの行を dispose する（onCleanup 発火）", () => {
    const disposed: number[] = [];
    const list = signal<readonly Person[]>([P(1, "a"), P(2, "b")]);
    const ul = h("ul", null,
      For(list, (p) => {
        onCleanup(() => disposed.push(p.id));
        return h("li", null, p.name);
      }, { key: (p) => p.id }),
    ) as HTMLUListElement;
    flushSync();
    list.set([P(1, "a")]); // remove id=2
    flushSync();
    expect(disposed).toEqual([2]);
    expect(ul.querySelectorAll("li").length).toBe(1);
  });

  it("index アクセサが移動で更新され、不変なら据え置き", () => {
    const list = signal<readonly Person[]>([P(1, "a"), P(2, "b")]);
    const ul = h("ul", null,
      For(list, (p, index) => h("li", { "data-i": () => String(index()) }, p.name), { key: (p) => p.id }),
    ) as HTMLUListElement;
    flushSync();
    expect([...ul.querySelectorAll("li")].map((li) => li.getAttribute("data-i"))).toEqual(["0", "1"]);
    list.set([P(2, "b"), P(1, "a")]); // swap → indices change
    flushSync();
    const after = [...ul.querySelectorAll("li")];
    expect(after.map((li) => li.textContent)).toEqual(["b", "a"]);
    expect(after.map((li) => li.getAttribute("data-i"))).toEqual(["0", "1"]);
  });

  it("each 本体で index() を同期読みしても並び替えで reconcile が暴走しない", () => {
    // createRoot が依存追跡コンテキストを切り離すので、行構築中の同期 index() 読みが
    // 外側の reconcile effect を idx の observer にしてしまう自己ループは起きない。
    const list = signal<readonly Person[]>([P(1, "a"), P(2, "b"), P(3, "c")]);
    const ul = h("ul", null,
      For(
        list,
        (p, index) => {
          // 同期読み（サンク経由でない）。
          const snapshot = index();
          return h("li", { "data-init": String(snapshot) }, p.name);
        },
        { key: (p) => p.id },
      ),
    ) as HTMLUListElement;
    flushSync();
    // 暴走せず並び替えできる（MAX_FLUSH 超過で throw しない）。
    expect(() => {
      list.set([P(3, "c"), P(1, "a"), P(2, "b")]);
      flushSync();
    }).not.toThrow();
    expect([...ul.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["c", "a", "b"]);
    // 行は再利用される（data-init は構築時の index 固定値のまま）。
    expect([...ul.querySelectorAll("li")].map((li) => li.getAttribute("data-init"))).toEqual(["2", "0", "1"]);
  });

  it("重複キーは初期描画で throw する", () => {
    expect(() =>
      h("ul", null, For(() => [P(1, "a"), P(1, "b")], (p) => h("li", null, p.name), { key: (p) => p.id })),
    ).toThrow(/duplicate key/);
  });

  it("each がレンダリング中に throw しても、その回に新規生成済みの行は dispose される", () => {
    // 異常系: ユーザ提供 each が途中の行で例外を投げる。reconcile が rows=next の
    // 入れ替え前に中断しても、その回に make() で先に生成済みの行（fresh）を確実に
    // dispose し、デタッチされた createRoot を孤立させない。
    const disposed: number[] = [];
    expect(() =>
      h("ul", null,
        For(
          () => [P(1, "a"), P(2, "b"), P(3, "c")],
          (p) => {
            if (p.id === 3) {
              throw new Error("each boom");
            }
            onCleanup(() => disposed.push(p.id));
            return h("li", null, p.name);
          },
          { key: (p) => p.id },
        ),
      ),
    ).toThrow(/each boom/);
    // id=1,2 は throw 前に生成済み → ロールバックで dispose 済み（onCleanup 発火）。
    expect(disposed.sort()).toEqual([1, 2]);
  });

  it("key 省略時は値の同一性（identity）でキーイングする", () => {
    const a = P(1, "a");
    const b = P(2, "b");
    const list = signal<readonly Person[]>([a, b]);
    const ul = h("ul", null, For(list, (p) => h("li", null, p.name))) as HTMLUListElement;
    flushSync();
    const [liA] = [...ul.querySelectorAll("li")];
    list.set([b, a]); // same refs reordered → reuse
    flushSync();
    expect([...ul.querySelectorAll("li")][1]).toBe(liA);
  });

  it("list を関数アクセサで渡せる（signal を内部参照）", () => {
    const data = signal<readonly Person[]>([P(1, "a")]);
    const ul = h("ul", null,
      For(() => data.get(), (p) => h("li", null, p.name), { key: (p) => p.id }),
    ) as HTMLUListElement;
    flushSync();
    data.set([P(1, "a"), P(2, "b")]);
    flushSync();
    expect(ul.querySelectorAll("li").length).toBe(2);
  });

  it("null/undefined のリストは空として扱う", () => {
    const list = signal<readonly Person[] | null>(null);
    const ul = h("ul", null,
      For(list as never, (p: Person) => h("li", null, p.name), { key: (p: Person) => p.id }),
    ) as HTMLUListElement;
    flushSync();
    expect(ul.querySelectorAll("li").length).toBe(0);
    list.set([P(1, "a")]);
    flushSync();
    expect(ul.querySelectorAll("li").length).toBe(1);
  });

  it("anchor が外れた後の更新は安全（host null 経路）", () => {
    const list = signal<readonly Person[]>([P(1, "a")]);
    const ul = h("ul", null, For(list, (p) => h("li", null, p.name), { key: (p) => p.id })) as HTMLUListElement;
    flushSync();
    ul.textContent = ""; // 行も anchor も除去
    list.set([P(1, "a"), P(2, "b")]); // 再実行時 anchor.parentNode は null
    flushSync();
    expect(ul.querySelectorAll("li").length).toBe(0); // 例外なく no-op
  });

  it("囲みスコープ（createRoot）破棄で全行を dispose する", () => {
    const disposed: number[] = [];
    const list = signal<readonly Person[]>([P(1, "a"), P(2, "b")]);
    const host = document.createElement("ul");
    const dispose = createRoot((d) => {
      host.appendChild(
        h(
          "div",
          null,
          For(list, (p) => {
            onCleanup(() => disposed.push(p.id));
            return h("li", null, p.name);
          }, { key: (p) => p.id }),
        ),
      );
      return d;
    });
    flushSync();
    dispose();
    expect(disposed.sort()).toEqual([1, 2]);
  });
});

describe("For: LIS ベースの最小移動 reorder", () => {
  // Helper: build a For over a numeric key list and return the <ul> + a snapshot of
  // the live <li> nodes keyed by their value, so a test can assert both ORDER and
  // node IDENTITY (reuse) after a reorder, and count the actual DOM moves.
  const build = (initial: number[]) => {
    const list = signal<readonly number[]>(initial);
    const ul = h(
      "ul",
      null,
      For(list, (v) => h("li", null, String(v)), { key: (v) => v }),
    ) as HTMLUListElement;
    flushSync();
    return { list, ul };
  };

  const order = (ul: HTMLUListElement): string[] =>
    [...ul.querySelectorAll("li")].map((li) => li.textContent ?? "");

  // Instrument insertBefore on the actual parent to count DOM moves for a single
  // list.set + flush, then restore. Returns [movesCount].
  const countMoves = (ul: HTMLUListElement, mutate: () => void): number => {
    const parent = ul.querySelector("li")?.parentNode as Node | undefined;
    const target = (parent ?? ul) as Node & { insertBefore: Node["insertBefore"] };
    const original = target.insertBefore.bind(target);
    let moves = 0;
    (target as any).insertBefore = (node: Node, ref: Node | null) => {
      moves++;
      return original(node, ref);
    };
    try {
      mutate();
      flushSync();
    } finally {
      (target as any).insertBefore = original;
    }
    return moves;
  };

  it("全同順なら DOM 移動はゼロ", () => {
    const { list, ul } = build([1, 2, 3, 4, 5]);
    const before = [...ul.querySelectorAll("li")];
    const moves = countMoves(ul, () => list.set([1, 2, 3, 4, 5]));
    expect(moves).toBe(0);
    expect(order(ul)).toEqual(["1", "2", "3", "4", "5"]);
    // all nodes reused
    [...ul.querySelectorAll("li")].forEach((li, i) => expect(li).toBe(before[i]));
  });

  it("完全逆順でも結果順は正しく、移動は最小（LIS=1要素ぶんだけ据え置き）", () => {
    const { list, ul } = build([1, 2, 3, 4, 5]);
    const nodes = new Map(
      [...ul.querySelectorAll("li")].map((li) => [li.textContent, li] as const),
    );
    const moves = countMoves(ul, () => list.set([5, 4, 3, 2, 1]));
    expect(order(ul)).toEqual(["5", "4", "3", "2", "1"]);
    // Reverse: LIS over previous indices [4,3,2,1,0] has length 1, so 4 of 5 move.
    expect(moves).toBe(4);
    // every node reused, none rebuilt
    [...ul.querySelectorAll("li")].forEach((li) =>
      expect(li).toBe(nodes.get(li.textContent)),
    );
  });

  it("先頭に1要素挿入しても既存行は1つも移動しない（インデックス全シフト耐性）", () => {
    const { list, ul } = build([1, 2, 3, 4, 5]);
    const existing = [...ul.querySelectorAll("li")];
    // Insert a new head: naive reorder would shift every existing node; LIS keeps
    // 1..5 in place and only inserts the new "0" before them → exactly 1 move.
    const moves = countMoves(ul, () => list.set([0, 1, 2, 3, 4, 5]));
    expect(order(ul)).toEqual(["0", "1", "2", "3", "4", "5"]);
    expect(moves).toBe(1);
    // existing nodes preserved (same identity, same relative order)
    const after = [...ul.querySelectorAll("li")];
    existing.forEach((li, i) => expect(after[i + 1]).toBe(li));
  });

  it("削除と移動の混在でも結果順が一致する", () => {
    const { list, ul } = build([1, 2, 3, 4, 5, 6]);
    const nodes = new Map(
      [...ul.querySelectorAll("li")].map((li) => [li.textContent, li] as const),
    );
    // remove 2 and 5, and reorder the survivors.
    list.set([6, 1, 4, 3]);
    flushSync();
    expect(order(ul)).toEqual(["6", "1", "4", "3"]);
    // survivors reused
    [...ul.querySelectorAll("li")].forEach((li) =>
      expect(li).toBe(nodes.get(li.textContent)),
    );
  });

  it("空 → 非空 → 空 の遷移", () => {
    const list = signal<readonly number[]>([]);
    const ul = h(
      "ul",
      null,
      For(list, (v) => h("li", null, String(v)), { key: (v) => v }),
    ) as HTMLUListElement;
    flushSync();
    expect(ul.querySelectorAll("li").length).toBe(0);

    list.set([1, 2, 3]);
    flushSync();
    expect(order(ul)).toEqual(["1", "2", "3"]);

    list.set([]);
    flushSync();
    expect(ul.querySelectorAll("li").length).toBe(0);
  });

  it("内部移動（中央の2要素入れ替え）でも順序一致＋移動最小", () => {
    const { list, ul } = build([1, 2, 3, 4, 5]);
    const nodes = new Map(
      [...ul.querySelectorAll("li")].map((li) => [li.textContent, li] as const),
    );
    // swap 2 and 4 → previous indices [0,3,2,1,4]; LIS=[0,2,4] (len 3) stays put,
    // so only the two swapped nodes move.
    const moves = countMoves(ul, () => list.set([1, 4, 3, 2, 5]));
    expect(order(ul)).toEqual(["1", "4", "3", "2", "5"]);
    expect(moves).toBe(2);
    [...ul.querySelectorAll("li")].forEach((li) =>
      expect(li).toBe(nodes.get(li.textContent)),
    );
  });

  it("末尾追加と内部移動の混在（新規ノードのみ挿入し既存LISは据え置き）", () => {
    const { list, ul } = build([1, 2, 3]);
    // move 3 to front, append new 4,5: 1,2 keep order; 3 and the new tail move/insert.
    list.set([3, 1, 2, 4, 5]);
    flushSync();
    expect(order(ul)).toEqual(["3", "1", "2", "4", "5"]);
  });
});

describe("Index: 位置キーのリスト", () => {
  it("初期描画してスロット更新で内容だけ差し替える（Node 再利用）", () => {
    const list = signal<readonly string[]>(["x", "y"]);
    const ul = h("ul", null,
      Index(list, (item) => h("li", null, () => item())),
    ) as HTMLUListElement;
    flushSync();
    const [lx, ly] = [...ul.querySelectorAll("li")];
    expect([lx.textContent, ly.textContent]).toEqual(["x", "y"]);

    list.set(["x", "z"]); // slot0 unchanged, slot1 value changes
    flushSync();
    const after = [...ul.querySelectorAll("li")];
    expect(after[0]).toBe(lx); // same node
    expect(after[1]).toBe(ly); // same node, new content
    expect(after.map((li) => li.textContent)).toEqual(["x", "z"]);
  });

  it("grow / shrink で末尾の行を追加・破棄する", () => {
    const disposed: number[] = [];
    const list = signal<readonly number[]>([0, 1]);
    const ul = h("ul", null,
      Index(list, (item, i) => {
        onCleanup(() => disposed.push(i));
        return h("li", null, () => String(item()));
      }),
    ) as HTMLUListElement;
    flushSync();
    list.set([0, 1, 2]); // grow
    flushSync();
    expect(ul.querySelectorAll("li").length).toBe(3);
    list.set([0]); // shrink: drop indices 1,2
    flushSync();
    expect(ul.querySelectorAll("li").length).toBe(1);
    expect(disposed.sort()).toEqual([1, 2]);
  });

  it("index は固定・item はアクセサ（computed 連動）", () => {
    const list = signal<readonly number[]>([10]);
    const ul = h("ul", null,
      Index(list, (item) => {
        const doubled = computed(() => item() * 2);
        return h("li", null, () => String(doubled.get()));
      }),
    ) as HTMLUListElement;
    flushSync();
    expect(ul.querySelector("li")?.textContent).toBe("20");
    list.set([15]);
    flushSync();
    expect(ul.querySelector("li")?.textContent).toBe("30");
  });

  it("list を signal で直接渡せる / null は空", () => {
    const list = signal<readonly number[] | null>(null);
    const ul = h("ul", null,
      Index(list as never, (item: () => number) => h("li", null, () => String(item()))),
    ) as HTMLUListElement;
    flushSync();
    expect(ul.querySelectorAll("li").length).toBe(0);
    list.set([1, 2]);
    flushSync();
    expect(ul.querySelectorAll("li").length).toBe(2);
  });

  it("anchor が外れた後の grow は安全（host null 経路）", () => {
    const list = signal<readonly number[]>([0]);
    const ul = h("ul", null, Index(list, (item) => h("li", null, () => String(item())))) as HTMLUListElement;
    flushSync();
    ul.textContent = "";
    list.set([0, 1]); // grow with anchor.parentNode null
    flushSync();
    expect(ul.querySelectorAll("li").length).toBe(0);
  });

  it("囲みスコープ破棄で全行を dispose する", () => {
    const disposed: number[] = [];
    const list = signal<readonly number[]>([0, 1]);
    const host = document.createElement("ul");
    const dispose = createRoot((d) => {
      host.appendChild(
        h("div", null,
          Index(list, (item, i) => {
            onCleanup(() => disposed.push(i));
            return h("li", null, () => String(item()));
          }),
        ),
      );
      return d;
    });
    flushSync();
    dispose();
    expect(disposed.sort()).toEqual([0, 1]);
  });

  it("静的な兄弟と混在しても grow がアンカー直前に正しく挿入される", () => {
    // The list shares its parent with a static header/footer and another list.
    // Each list owns the region ending at its anchor; grow inserts before that
    // anchor, so its own rows stay grouped and ordered without disturbing siblings.
    const a = signal<readonly number[]>([1]);
    const b = signal<readonly string[]>(["x"]);
    const ul = h(
      "ul",
      null,
      h("li", { id: "head" }, "HEAD"),
      Index(a, (item) => h("li", { class: "a" }, () => String(item()))),
      h("li", { id: "mid" }, "MID"),
      Index(b, (item) => h("li", { class: "b" }, () => item())),
      h("li", { id: "foot" }, "FOOT"),
    ) as HTMLUListElement;
    flushSync();

    a.set([1, 2, 3]); // grow list A
    b.set(["x", "y"]); // grow list B
    flushSync();

    const labels = [...ul.querySelectorAll("li")].map(
      (li) => li.id || `${li.className}:${li.textContent}`,
    );
    expect(labels).toEqual([
      "head",
      "a:1", "a:2", "a:3",
      "mid",
      "b:x", "b:y",
      "foot",
    ]);
  });
});
