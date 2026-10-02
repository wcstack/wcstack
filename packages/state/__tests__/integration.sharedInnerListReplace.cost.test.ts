/**
 * integration.sharedInnerListReplace.cost.test.ts — 同じ内側の配列を描く別の `for` を描き直させる仕組み（#379）が、
 * 書き込みの間に読む数を外側の行の数に比例して増やさないこと（費用の番人）。
 *
 * 入れ替えが揃ったとき、同じ配列を描いている `for` は描画の基準の逆引きで引く（list/lastListValueByAbsoluteStateAddress.ts）。
 * この Issue の 2 つ目の修理は、書き込みのたびに外側の行を全部読んで同じ配列を持つ行を探したので、作り直した後の
 * 共有しない入れ子（外側の行の数 G・各行の位置 0 を 1 バッチで差し替え）で、読みが G × G で増えた（Chromium で
 * 3,000 行が 1.2 秒）。読みの数は機械の速さに依らないので、外側の行を 4 倍にしたときに読みも 4 倍（＋ 少し）に
 * 収まることを見る。読みは getByAddress の呼び出しを数える（src の中の呼び出しも含めて数えるためにモジュールごと包む）。
 *
 * 逆引きの集合も番をする（3 つ目の修理の検証で見つかった 2 つ）:
 *  - 同じ配列を N 行が持つページで、足すたびに集合を全部見直すと描画が N² になった（4,000 行で 800 万回）。見直しは
 *    行が退役しているかの判定（isRetiredListIndex）の呼び出しで数える。
 *  - 外側の行を外しても、その下の行（3 段の中の行・`$recursion` の子）は差分を通らず退役の印が付かないので、自分の行だけを
 *    見ると、深く作り直すたびに外したアドレスが集合に残った（400 回で 20,049）。
 *  - 外側の行を減らした後も、集合が育たないうちは外した外側の行の for が残り、要素書き込みのたびに数えた（4 つ目の修理の
 *    検証で見つかった — Chromium で 9,000 行を 1 行に減らした後の 100 回の書き込みが 5 倍遅い）。引くときにも外す。
 *  - 同じ配列を持つ外側の行の集合（#393 — list/listIndexesByList.ts の holdersByList）も、足すたびに全部を見直すと
 *    外側の行を作り直すたびに G² になった。見直しは前に見直した大きさの倍に育ったときと、引いたときだけ。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("../src/proxy/methods/getByAddress", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/proxy/methods/getByAddress")>();
  return {
    ...actual,
    getByAddress: (...args: Parameters<typeof actual.getByAddress>) => {
      reads.count++;
      return actual.getByAddress(...args);
    },
  };
});

vi.mock("../src/list/listIndexesByList", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/list/listIndexesByList")>();
  return {
    ...actual,
    isRetiredListIndex: (...args: Parameters<typeof actual.isRetiredListIndex>) => {
      retiredChecks.count++;
      return actual.isRetiredListIndex(...args);
    },
    getElementAliases: (...args: Parameters<typeof actual.getElementAliases>) => {
      const aliases = actual.getElementAliases(...args);
      aliasRows.count += aliases.length;
      return aliases;
    },
  };
});

vi.mock("../src/list/lastListValueByAbsoluteStateAddress", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/list/lastListValueByAbsoluteStateAddress")>();
  return {
    ...actual,
    markSwappedList: (...args: Parameters<typeof actual.markSwappedList>) => {
      swapNotices.count++;
      return actual.markSwappedList(...args);
    },
  };
});

const reads = vi.hoisted(() => ({ count: 0 }));
const swapNotices = vi.hoisted(() => ({ count: 0 }));
const retiredChecks = vi.hoisted(() => ({ count: 0 }));
const aliasRows = vi.hoisted(() => ({ count: 0 }));

import { bootstrapState } from "../src/bootstrapState";
import { flush, makeMount, read, write } from "./helpers/recursionTestUtils";
import { forceGc } from "./helpers/forceGc";
import { getRowsOfSameElement } from "../src/list/createListIndex";
import { getListIndexesByList } from "../src/list/listIndexesByList";
import { createAbsoluteStateAddress } from "../src/address/AbsoluteStateAddress";
import { getPathInfo } from "../src/address/PathInfo";
import { getTreePath } from "../src/address/TreePath";
import { getAddressesByLastListValue } from "../src/list/lastListValueByAbsoluteStateAddress";
import type { State } from "../src/components/State";

beforeAll(() => {
  bootstrapState();
});

const mount = makeMount("shared-inner-replace-cost-host");

const GROUPS =
  `<template data-wcs="for: groups"><div class="g"><template data-wcs="for: .items"><span>{{ .v }}</span></template></div></template>`;

const inner = (key: number | string) => [{ v: `a${key}` }, { v: `b${key}` }, { v: `c${key}` }];

/** 書き込み 1 バッチの間の読みの数 */
async function readsDuring(initial: unknown, prepare: ((s: any) => void) | null, run: (s: any) => void): Promise<number> {
  const { host, stateEl } = await mount(initial, GROUPS);
  if (prepare) {
    write(stateEl, prepare);
    await flush();
    await flush();
  }
  reads.count = 0;
  write(stateEl, run);
  const count = reads.count;
  await flush();
  await flush();
  host.remove();
  return count;
}

describe("書き込みの間の読みは、外側の行の数に比例する（#379）", () => {
  it("外側の行を作り直した後、共有しない G 行の位置 0 を 1 バッチで差し替える", async () => {
    const measure = (G: number) => readsDuring(
      { groups: Array.from({ length: G }, (_, g) => ({ items: inner(g) })) },
      (s) => { s.groups = s.groups.map((g: any) => ({ ...g })); },
      (s) => { for (let g = 0; g < G; g++) s[`groups.${g}.items.0`] = { v: `N${g}` }; },
    );
    const small = await measure(30);
    const large = await measure(120);
    // 2 つ目の修理: 30 行で 1,050 回・120 行で 15,000 回（G × G）
    expect(large).toBeLessThanOrEqual(small * 4 + 16);
  });

  it("2 行ずつ同じ配列を持つ G 行で、各組の位置 0 を 1 バッチで差し替える", async () => {
    const measure = (G: number) => readsDuring(
      { groups: Array.from({ length: G / 2 }, (_, k) => { const items = inner(k); return [{ items }, { items }]; }).flat() },
      null,
      (s) => { for (let k = 0; k < G / 2; k++) s[`groups.${2 * k}.items.0`] = { v: `N${k}` }; },
    );
    const small = await measure(30);
    const large = await measure(120);
    // 2 つ目の修理: 30 行で 510 回・120 行で 7,440 回
    expect(large).toBeLessThanOrEqual(small * 4 + 16);
  });
});

/**
 * この state 要素で、この配列を描画の基準にしているアドレスの集合（逆引き）。引くと退役した行の下のアドレスを外すので、
 * 足すときの見直しを見るテストは、描いた直後に 1 回だけ引いた集合そのものの大きさを後で見る
 */
function holdersOf(stateEl: State, list: readonly unknown[]): ReadonlySet<unknown> {
  const anyAddress = createAbsoluteStateAddress(getTreePath(stateEl, getPathInfo("groups")), null);
  return getAddressesByLastListValue(anyAddress, list);
}

describe("逆引きの集合を見直す手間と大きさ（#379）", () => {
  it("同じ配列を N 行が持つページを描くと、見直しの手間は N に比例する", async () => {
    const measure = async (N: number) => {
      const items = inner("x");
      retiredChecks.count = 0;
      const { host } = await mount({ groups: Array.from({ length: N }, () => ({ items })) }, GROUPS);
      const count = retiredChecks.count;
      host.remove();
      return count;
    };
    const small = await measure(100);
    const large = await measure(400);
    // 足すたびに全部を見直すと、100 行で約 5,000 回・400 行で約 80,000 回（N² / 2）
    expect(large).toBeLessThanOrEqual(small * 4 + 64);
  });

  it("3 段の中の配列は、外側から深く作り直しても集合に外したアドレスが溜まらない", async () => {
    const leaves = Array.from({ length: 4 }, (_, k) => inner(k));
    const { host, stateEl } = await mount({ groups: [{ subs: [{ items: leaves[0] }, { items: leaves[1] }] }, { subs: [{ items: leaves[2] }, { items: leaves[3] }] }] },
      `<template data-wcs="for: groups"><section><template data-wcs="for: .subs"><div class="g"><template data-wcs="for: .items">` +
      `<span>{{ .v }}</span></template></div></template></section></template>`);
    const holders = leaves.map((leaf) => holdersOf(stateEl, leaf));
    for (let k = 0; k < 40; k++) {
      write(stateEl, (s: any) => { s.groups = s.groups.map((g: any) => ({ ...g, subs: g.subs.map((x: any) => ({ ...x })) })); });
      await flush();
      await flush();
    }
    // 自分の行だけを見ると 41（作り直すたびに 1 つ増えた）。見直しは集合が 8 に育ったとき
    expect(Math.max(...holders.map((set) => set.size))).toBeLessThanOrEqual(8);
    host.remove();
  });

  it("$recursion の木を不変更新で作り直しても、子の配列の集合に外したアドレスが溜まらない", async () => {
    const leaf = () => [{ value: 1, children: [] }, { value: 2, children: [] }];
    const leaves = [leaf(), leaf()];
    const { host, stateEl } = await mount({
      groups: [{ value: 0, children: [{ value: 10, children: leaves[0] }, { value: 11, children: leaves[1] }] }],
      $recursion: { "groups.*": "children.*" },
    }, `<template data-wcs="for: groups"><div class="g"><template data-wcs="for: .children"><span>{{ .value }}` +
      `<template data-wcs="for: .children"><em>{{ .value }}</em></template></span></template></div></template>`);
    const holders = leaves.map((list) => holdersOf(stateEl, list));
    for (let k = 0; k < 40; k++) {
      write(stateEl, (s: any) => { s.groups = s.groups.map((n: any) => ({ ...n, children: n.children.map((c: any) => ({ ...c })) })); });
      await flush();
      await flush();
    }
    expect(Math.max(...holders.map((set) => set.size))).toBeLessThanOrEqual(8);
    host.remove();
  });
});

describe("外側の行を減らした後の要素書き込み（逆引きに残った外した行の for）", () => {
  it("同じ配列を持つ 200 行を 1 行に減らした後、50 回の差し替えで外した行の for を数えない", async () => {
    const items = inner("x");
    const { host, stateEl } = await mount({ groups: Array.from({ length: 200 }, () => ({ items })) }, GROUPS);
    write(stateEl, (s: any) => { s.groups = [s.groups[0]]; });
    await flush();
    await flush();
    swapNotices.count = 0;
    for (let k = 0; k < 50; k++) {
      write(stateEl, (s: any) => { s[`groups.0.items.${k % 3}`] = { v: `X${k}` }; });
      await flush();
    }
    // 引くときに外さないと、書き込みのたびに外した 199 行の for を数える
    expect(swapNotices.count).toBeLessThanOrEqual(50);
    host.remove();
  });
});

describe("要素オブジェクトから行への索引は、外した行を持ち続けない（#393 の索引）", () => {
  // 索引（src/list/createListIndex.ts の rowsByElement）は入れ子の行だけを、弱く持つ。差分を通らずに外れた行（外側の行ごと
  // 外した行・捨てた state の行）には退役の印が付かないので、強く持つと要素が生きている間ずっと残った（5 つ目の修理の
  // 検証 — 不変更新 100 回で happy-dom のヒープが +107 MB、main は +1 MB）。数はヒープの大きさに依らず、GC の後に生きている
  // 行で数える
  const TODOS = `<template data-wcs="for: shown"><p>{{ .title }}</p></template>`;
  const todoState = () => ({
    todos: Array.from({ length: 20 }, (_, i) => ({ title: `t${i}`, done: i % 2 === 0 })),
    filter: "all",
    get shown() {
      return this.filter === "all" ? this.todos : this.todos.filter((t: any) => (this.filter === "done") === t.done);
    },
  });
  /** いまの配列 `list` の先頭の要素を表す、ほかの生きた行の数 */
  const othersOf = (list: readonly unknown[]): number => getRowsOfSameElement(getListIndexesByList(list)![0]).length;

  it("ルート直下のリストを絞り込みの getter で 100 回切り替えても、同じ要素を表す行は増えない", async () => {
    // TodoMVC の形: `for: shown` を `all` と `done` の写しで切り替える。ルート直下の行は索引に載せない（別の行を引くのは、
    // 入れ子の行の下への書き込みだけ）。載せると、写しの行が切り替えのたびに索引に残った
    const { host, stateEl } = await mount(todoState(), TODOS);
    for (let k = 0; k < 100; k++) {
      write(stateEl, (s: any) => { s.filter = s.filter === "all" ? "done" : "all"; });
      await flush();
    }
    expect(othersOf(read(stateEl, (s: any) => s.todos))).toBe(0);
    host.remove();
  });

  it("絞り込んだまま足してから全部に戻すのを 40 回繰り返しても、同じ要素を表す行は増えない", async () => {
    const { host, stateEl } = await mount(todoState(), TODOS);
    for (let k = 0; k < 40; k++) {
      write(stateEl, (s: any) => { s.filter = k % 2 ? "done" : "active"; });
      await flush();
      write(stateEl, (s: any) => { s.todos = [...s.todos, { title: `n${k}`, done: false }]; });
      await flush();
      write(stateEl, (s: any) => { s.filter = "all"; });
      await flush();
    }
    expect(othersOf(read(stateEl, (s: any) => s.todos))).toBe(0);
    host.remove();
  });

  const NODES = `<template data-wcs="for: nodes"><div class="n">{{ .value }}<template data-wcs="for: .children"><i>{{ .value }}` +
    `<template data-wcs="for: .children"><b>{{ .value }}</b></template></i></template></div></template>`;
  const BOARDS = `<template data-wcs="for: boards"><div class="b"><template data-wcs="for: .cols"><p><template data-wcs="for: .cards">` +
    `<span>{{ .v }}</span></template></p></template></div></template>`;
  const shapes: [string, () => any, string, (s: any, k: number) => void, (s: any) => readonly unknown[]][] = [
    ["外側の行の不変更新（`{ ...g, items: [...g.items] }`）",
      () => ({ groups: Array.from({ length: 4 }, (_, g) => ({ items: Array.from({ length: 10 }, (_, i) => ({ v: `v${g}.${i}` })) })) }),
      GROUPS, (s) => { s.groups = s.groups.map((g: any) => ({ ...g, items: [...g.items] })); }, (s) => s["groups.0.items"]],
    ["外側の行を消して戻す",
      () => {
        const els = Array.from({ length: 10 }, (_, i) => ({ v: `e${i}` }));
        return { els, groups: [{ items: els.slice(0, 5) }, { items: els.slice(5) }] };
      },
      GROUPS, (s) => {
        if (s.groups.length > 0) {
          s.groups = [];
        } else {
          s.groups = [{ items: s.els.slice(0, 5) }, { items: s.els.slice(5) }];
        }
      }, (s) => s["groups.0.items"]],
    ["`$recursion` の木の不変更新",
      () => ({
        nodes: [{ value: 1, children: [{ value: 10, children: [{ value: 100, children: [] }, { value: 101, children: [] }] }] }],
        $recursion: { "nodes.*": "children.*" },
      }),
      NODES, (s) => { s.nodes = s.nodes.map((n: any) => ({ ...n, children: n.children.map((c: any) => ({ ...c, children: [...c.children] })) })); },
      (s) => s.nodes[0].children[0].children],
    ["3 段の真ん中の行の不変更新",
      () => ({ boards: [{ cols: [{ cards: [{ v: "c0" }, { v: "c1" }] }, { cards: [{ v: "c2" }, { v: "c3" }] }] }] }),
      BOARDS, (s, k) => { s["boards.0.cols"] = s["boards.0.cols"].map((c: any, i: number) => i === k % 2 ? { ...c, cards: [...c.cards] } : c); },
      (s) => s["boards.0.cols.0.cards"]],
  ];

  it.each(shapes)("%s を繰り返しても、GC の後に同じ要素を表す行が増えない", async (_name, initial, html, update, listOf) => {
    const { host, stateEl } = await mount(initial(), html);
    const repeat = async (from: number, to: number): Promise<number> => {
      for (let k = from; k < to; k++) {
        write(stateEl, (s: any) => update(s, k));
        await flush();
        await flush();
      }
      await forceGc();
      return othersOf(read(stateEl, listOf));
    };
    const early = await repeat(0, 10);
    // 強く持つと、10 回で 10・40 回で 30 前後（繰り返した数だけ増えた）
    expect(await repeat(10, 40)).toBeLessThanOrEqual(early);
    expect(early).toBeLessThanOrEqual(1);
    host.remove();
  });

  it("setInitialState で同じ要素の新しい配列を渡し直しても、GC の後に同じ要素を表す行が増えない", async () => {
    // 外したホストは happy-dom が手放さない（main も同じ）ので、別の state を作って外す形はここでは数えない。索引が行を
    // 生かさないことは __tests__/list.createListIndex.test.ts で見る
    const store = Array.from({ length: 10 }, (_, i) => ({ v: `s${i}` }));
    const { host, stateEl } = await mount({ groups: [{ items: store.slice() }] }, GROUPS);
    const repeat = async (times: number): Promise<number> => {
      for (let k = 0; k < times; k++) {
        stateEl.setInitialState({ groups: [{ items: store.slice() }] });
        await flush();
        await flush();
      }
      await forceGc();
      return othersOf(read(stateEl, (s: any) => s["groups.0.items"]));
    };
    const early = await repeat(5);
    expect(await repeat(20)).toBeLessThanOrEqual(early);
    host.remove();
  });

  it("外側の一覧を空にして同じ要素で戻すのを 200 回繰り返しても、GC を待たずに同じ要素を表す行が増えない", async () => {
    // 消えた行だけを見直しで外すと、GC までの間、外した外側の行の下の行が残って集合が育った（6 つ目の修理の検証 — 500 回で
    // 501、Chromium で 3,000 回の後もヒープが main より 16〜25 MB 多いまま）。見直しで、退役した外側の行の下の行も外す
    const els = Array.from({ length: 4 }, (_, i) => ({ v: `e${i}` }));
    const { host, stateEl } = await mount({ groups: [{ items: els.slice() }] }, GROUPS);
    for (let k = 0; k < 200; k++) {
      write(stateEl, (s: any) => { s.groups = []; });
      await flush();
      write(stateEl, (s: any) => { s.groups = [{ items: els.slice() }]; });
      await flush();
    }
    expect(othersOf(read(stateEl, (s: any) => s["groups.0.items"]))).toBeLessThanOrEqual(16);
    host.remove();
  }, 30000);

  it("同じ外側の行の 2 つのキーに写しを書き直すのを繰り返しても、GC の後に前の写しの行が残らない", async () => {
    // 新しい配列 → まだ state に居る前の配列（createListDiff.ts の keepPreviousList）を強く持つと、写しの鎖とそれぞれの行が
    // 残った（6 つ目の修理の検証 — 要素 1,000 個で 300 回、happy-dom のヒープが 58 MB → 594 MB、Chromium で +35.5 MB）
    const DUAL = `<template data-wcs="for: groups"><div class="g"><template data-wcs="for: .items"><span>{{ .v }}</span></template>` +
      `<template data-wcs="for: .alt"><b>{{ .v }}</b></template></div></template>`;
    const A = Array.from({ length: 20 }, (_, i) => ({ v: `v${i}` }));
    const { host, stateEl } = await mount({ groups: [{ items: A, alt: A }] }, DUAL);
    const rows: WeakRef<object>[] = [];
    for (let k = 0; k < 40; k++) {
      write(stateEl, (s: any) => {
        const copy = [...s["groups.0.items"]];
        s["groups.0.items"] = copy;
        s["groups.0.alt"] = copy;
      });
      await flush();
      rows.push(new WeakRef(getListIndexesByList(read(stateEl, (s: any) => s["groups.0.items"]))![0]));
    }
    await forceGc();
    // 強く持つと 40 のまま
    expect(rows.filter((row) => typeof row.deref() !== "undefined").length).toBeLessThanOrEqual(3);
    host.remove();
  });

  it("外側の行を 100 回不変更新した後の葉の書き込みは、外した外側の行の下の行を別名に数えない", async () => {
    // 外した外側の行の下の行（退役の印は外側の行にだけ付く）を別名に数えると、書き込みのたびにその数だけ描き直しを積んだ
    // （5 つ目の修理の検証 — 不変更新 600 回の後の葉の書き込み 100 回が 98 ms、main は 17 ms）。GC に依らず数える
    const { host, stateEl } = await mount({
      groups: Array.from({ length: 4 }, (_, g) => ({ items: Array.from({ length: 25 }, (_, i) => ({ v: `v${g}.${i}` })) })),
    }, GROUPS);
    for (let k = 0; k < 100; k++) {
      write(stateEl, (s: any) => { s.groups = s.groups.map((g: any) => ({ ...g, items: [...g.items] })); });
      await flush();
    }
    aliasRows.count = 0;
    for (let k = 0; k < 20; k++) {
      write(stateEl, (s: any) => { s[`groups.${k % 4}.items.0.v`] = `W${k}`; });
      await flush();
    }
    expect(aliasRows.count).toBe(0);
    host.remove();
  });
});

describe("同じ配列を持つ外側の行の集合を見直す手間（#393 の holdersByList）", () => {
  /** 同じ配列を G 行が持つページで、1 バッチの書き込みの間に退役・手放した印を引く数（WeakSet.prototype.has の呼び出し） */
  async function checksDuring(G: number, run: (s: any) => void): Promise<number> {
    const has = vi.spyOn(WeakSet.prototype, "has");
    try {
      const items = inner("x");
      const { host, stateEl } = await mount({ groups: Array.from({ length: G }, () => ({ items })) }, GROUPS);
      has.mockClear();
      write(stateEl, (s: any) => run(s));
      await flush();
      await flush();
      const count = has.mock.calls.length;
      host.remove();
      return count;
    } finally {
      has.mockRestore();
    }
  }

  it("外側の行を作り直しても、見直しの手間は G に比例する", async () => {
    // 集合が 8 に育った後、足すたびに全部を見直すと G² になった（5 つ目の修理の途中の形 — Chromium で 9,000 行の作り直しが
    // 4 倍以上遅い）。数は機械の速さに依らない
    const rebuild = (s: any) => { s.groups = s.groups.map((g: any) => ({ ...g })); };
    expect(await checksDuring(400, rebuild)).toBeLessThanOrEqual(await checksDuring(100, rebuild) * 5);
  });

  it("どの外側の行も写しに替えても、見直しの手間は G に比例する", async () => {
    // 写しの差分ごとに集合を頭から見ると、手放した外側の行が前に並び G² になった。見た、もう持っていない外側の行は外す
    const copyEach = (s: any) => {
      for (let g = 0; g < s.groups.length; g++) {
        s[`groups.${g}.items`] = [...s[`groups.${g}.items`]];
      }
    };
    expect(await checksDuring(400, copyEach)).toBeLessThanOrEqual(await checksDuring(100, copyEach) * 5);
  });
});
