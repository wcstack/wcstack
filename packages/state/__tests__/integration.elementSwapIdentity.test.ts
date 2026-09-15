/**
 * integration.elementSwapIdentity.test.ts — 要素への書き込みで行を入れ替える・置き換えるとき、
 * 行のブロックは値と一緒に動く（#4 — 同一性モデル）。
 *
 * 旧挙動: `_setByAddressWithSwap` は台帳を「listIndex は値に付いて動く」形に組み替えて index を
 * 振り直すのに、同じ書き込みのキャッシュと再描画は「listIndex は位置に留まる」前提のままだった。
 * 代入値を書き込み前の listIndex のキャッシュに固定し、`for` の差分適用も走らないので、
 *  - ブロックは動かず中身だけが書き換わり、
 *  - パスの読み書きが別の行を指し（`items.0.name` が "a"）、
 *  - 行の `$1` が表示とずれ、
 *  - その後の配列置換でも表示が実配列と食い違った。
 * 行を別のオブジェクトに置き換える書き込み（`$resolve("items.*", [0], row)`）では、束ねていない
 * 行 getter の表示が更新されず、再帰の集計では古い葉と新しい子を足した値を表示した。
 *
 * 契約（1 本ずつ固定する）: 入れ替えが揃った時点で、リストは「書き込む前の並び → いまの並び」の
 * 置換として描画し直される。ブロックは値と一緒に動き、読み書き・`$1`・表示が実配列と一致する。
 * リストに無かった値の書き込み（行の置き換え）は新しい行になる（#274 の着地の契約どおり）が、`for` は
 * 同じ位置で外す行の DOM ブロックをその場で使い回す — 入力中の欄はフォーカスを保つ。要素パス自身の
 * `$watch` は、その位置の書き込む前の値を prev に受け取る。
 *
 * 末尾の describe は、置き換えの修理で見つかった drain の既存欠陥（同じバッチで消える行に書くと、
 * プールから使い回した Content に新しい行の値が当たらない）の固定。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { flush, makeMount, node, read, write } from "./helpers/recursionTestUtils";

beforeAll(() => {
  bootstrapState();
});

const mount = makeMount("swap-identity-host");

const texts = (root: ParentNode, selector: string): (string | null)[] =>
  Array.from(root.querySelectorAll(selector)).map((element) => element.textContent);

describe("要素書き込みによる入れ替え", () => {
  it("ブロックが値と一緒に動き、パスの読み書き・$1・表示・後の配列置換が実配列と一致する（Issue #4 の手順）", async () => {
    const picks: unknown[] = [];
    const html = `<ul><template data-wcs="for: items"><li data-wcs="onclick: pick">{{ .name }}</li></template></ul>`;
    const { host, shadowRoot, stateEl } = await mount({
      items: [{ name: "a" }, { name: "b" }, { name: "c" }],
      pick(this: any, _event: Event, index: number) { picks.push([index, this["items.*.name"]]); },
    }, html);
    const lis = (): HTMLLIElement[] => Array.from(shadowRoot.querySelectorAll("li"));
    const raw = (): unknown => read(stateEl, (s: any) => s.items.map((item: any) => item.name));
    const [blockA, blockB, blockC] = lis();

    write(stateEl, (s: any) => {
      const a = s["items.0"];
      const c = s["items.2"];
      s["items.0"] = c;
      s["items.2"] = a;
    });
    await flush();
    expect(raw()).toEqual(["c", "b", "a"]);
    expect(texts(shadowRoot, "li")).toEqual(["c", "b", "a"]);
    expect(lis(), "ブロックが値と一緒に動く").toEqual([blockC, blockB, blockA]); // 旧: [blockA, blockB, blockC]

    expect(read(stateEl, (s: any) => [s["items.0.name"], s["items.2.name"]])).toEqual(["c", "a"]); // 旧: ["a", "c"]

    lis().forEach((li) => li.dispatchEvent(new Event("click")));
    await flush();
    expect(picks, "DOM の並びでクリックした行の $1 と値").toEqual([[0, "c"], [1, "b"], [2, "a"]]);

    write(stateEl, (s: any) => { s["items.0.name"] = "Z"; });
    await flush();
    expect(raw()).toEqual(["Z", "b", "a"]); // 旧: ["c", "b", "Z"]（別の行に着地した）
    expect(texts(shadowRoot, "li")).toEqual(["Z", "b", "a"]);

    write(stateEl, (s: any) => { s.items = [s.items[1], s.items[0], s.items[2]]; });
    await flush();
    expect(raw()).toEqual(["b", "Z", "a"]);
    expect(texts(shadowRoot, "li")).toEqual(["b", "Z", "a"]); // 旧: 実配列と食い違った
    host.remove();
  });

  it("バインドしていない行の DOM の状態（入力中の値）が値と一緒に動く", async () => {
    const html =
      `<template data-wcs="for: items"><div class="row"><input class="note">` +
      `<span class="name" data-wcs="textContent: items.*.name"></span></div></template>`;
    const { host, shadowRoot, stateEl } = await mount({ items: [{ name: "a" }, { name: "b" }, { name: "c" }] }, html);
    (shadowRoot.querySelectorAll("input.note")[0] as HTMLInputElement).value = "typed-for-a";

    write(stateEl, (s: any) => {
      const a = s["items.0"];
      s["items.0"] = s["items.2"];
      s["items.2"] = a;
    });
    await flush();
    const rows = Array.from(shadowRoot.querySelectorAll(".row"));
    expect(rows.map((row) => row.querySelector(".name")!.textContent)).toEqual(["c", "b", "a"]);
    expect(rows.map((row) => (row.querySelector("input.note") as HTMLInputElement).value)).toEqual(["", "", "typed-for-a"]);
    host.remove();
  });

  it("行の getter と $1 を読む getter が入れ替えに追従する", async () => {
    const state: any = { items: [{ n: 1 }, { n: 2 }, { n: 3 }] };
    Object.defineProperty(state, "items.*.label", {
      get(this: any) { return `${this.$1}:${this["items.*.n"] * 10}`; },
      enumerable: true, configurable: true,
    });
    const html = `<template data-wcs="for: items"><b class="l" data-wcs="textContent: items.*.label"></b></template>`;
    const { host, shadowRoot, stateEl } = await mount(state, html);
    expect(texts(shadowRoot, ".l")).toEqual(["0:10", "1:20", "2:30"]);

    write(stateEl, (s: any) => {
      const first = s["items.0"];
      s["items.0"] = s["items.2"];
      s["items.2"] = first;
    });
    await flush();
    expect(texts(shadowRoot, ".l")).toEqual(["0:30", "1:20", "2:10"]);
    expect(read(stateEl, (s: any) => s.$getAll("items.*.label", []))).toEqual(["0:30", "1:20", "2:10"]);
    host.remove();
  });

  it("入れ替えを別々の書き込みに分けても（途中で重複が見えても）、揃った時点で描画が実配列と一致する", async () => {
    const html = `<template data-wcs="for: items"><i class="r" data-wcs="textContent: items.*.name"></i></template>`;
    const { host, shadowRoot, stateEl } = await mount({ items: [{ name: "a" }, { name: "b" }, { name: "c" }] }, html);
    const blocks = Array.from(shadowRoot.querySelectorAll(".r"));
    let a: unknown;
    write(stateEl, (s: any) => {
      a = s["items.0"];
      s["items.0"] = s["items.2"];
    });
    await flush();
    write(stateEl, (s: any) => { s["items.2"] = a; });
    await flush();
    expect(read(stateEl, (s: any) => s.items.map((item: any) => item.name))).toEqual(["c", "b", "a"]);
    expect(texts(shadowRoot, ".r")).toEqual(["c", "b", "a"]);
    expect(Array.from(shadowRoot.querySelectorAll(".r"))).toEqual([blocks[2], blocks[1], blocks[0]]);
    host.remove();
  });

  it("同じ書き込みの中で入れ替えを 2 回しても、最後の並びで描画され、ブロックは値に付いてくる", async () => {
    const html = `<template data-wcs="for: items"><i class="r" data-wcs="textContent: items.*.name"></i></template>`;
    const { host, shadowRoot, stateEl } = await mount({ items: [{ name: "a" }, { name: "b" }, { name: "c" }] }, html);
    const blockByName = new Map(Array.from(shadowRoot.querySelectorAll(".r")).map((block) => [block.textContent, block]));

    write(stateEl, (s: any) => {
      const zero = s["items.0"];
      s["items.0"] = s["items.2"];
      s["items.2"] = zero; // [c, b, a]
      const first = s["items.0"];
      s["items.0"] = s["items.1"];
      s["items.1"] = first; // [b, c, a]
    });
    await flush();
    expect(read(stateEl, (s: any) => s.items.map((item: any) => item.name))).toEqual(["b", "c", "a"]);
    expect(texts(shadowRoot, ".r")).toEqual(["b", "c", "a"]);
    expect(Array.from(shadowRoot.querySelectorAll(".r")))
      .toEqual([blockByName.get("b"), blockByName.get("c"), blockByName.get("a")]);
    host.remove();
  });
});

describe("入れ替えの完了は描画だけをやり直す（書き込みの着地を増やさない）", () => {
  const html = `<template data-wcs="for: items"><i class="r" data-wcs="textContent: items.*.name"></i></template>`;

  it("要素を入れ替えても、items の $watch は発火しない（配列の参照は変わっていない）", async () => {
    const itemsWatch = vi.fn();
    const { host, shadowRoot, stateEl } = await mount({
      items: [{ name: "a" }, { name: "b" }, { name: "c" }],
      $watch: { items: itemsWatch },
    }, html);
    await flush();
    itemsWatch.mockClear();

    write(stateEl, (s: any) => {
      const a = s["items.0"];
      s["items.0"] = s["items.2"];
      s["items.2"] = a;
    });
    await flush();
    await flush();
    expect(texts(shadowRoot, ".r")).toEqual(["c", "b", "a"]);
    expect(itemsWatch).not.toHaveBeenCalled();
    host.remove();
  });

  it("同じ書き込みの中で配列を置き換えてから要素を入れ替えても、最後の並びで描画し、items の $watch は 1 回", async () => {
    const itemsWatch = vi.fn();
    const { host, shadowRoot, stateEl } = await mount({
      items: [{ name: "a" }, { name: "b" }, { name: "c" }],
      $watch: { items: itemsWatch },
    }, html);
    await flush();
    itemsWatch.mockClear();

    write(stateEl, (s: any) => {
      s.items = [{ name: "x" }, { name: "y" }, { name: "z" }];
      const x = s["items.0"];
      s["items.0"] = s["items.2"];
      s["items.2"] = x;
    });
    await flush();
    await flush();
    expect(read(stateEl, (s: any) => s.items.map((item: any) => item.name))).toEqual(["z", "y", "x"]);
    expect(texts(shadowRoot, ".r")).toEqual(["z", "y", "x"]);
    expect(itemsWatch).toHaveBeenCalledTimes(1);
    host.remove();
  });
});

describe("README の書き方（$resolve でプリミティブの行を入れ替える）", () => {
  it("swapFirstTwo の形でもブロックが値と一緒に動く", async () => {
    const html = `<template data-wcs="for: items"><i class="r" data-wcs="textContent: items.*"></i></template>`;
    const { host, shadowRoot, stateEl } = await mount({ items: ["A", "B", "C"] }, html);
    const [blockA, blockB, blockC] = Array.from(shadowRoot.querySelectorAll(".r"));

    write(stateEl, (s: any) => {
      const a = s.$resolve("items.*", [0]);
      const b = s.$resolve("items.*", [1]);
      s.$resolve("items.*", [0], b);
      s.$resolve("items.*", [1], a);
    });
    await flush();
    expect(read(stateEl, (s: any) => [...s.items])).toEqual(["B", "A", "C"]);
    expect(texts(shadowRoot, ".r")).toEqual(["B", "A", "C"]);
    expect(Array.from(shadowRoot.querySelectorAll(".r"))).toEqual([blockB, blockA, blockC]);
    host.remove();
  });
});

describe("要素書き込みによる行の置き換え", () => {
  it("行を別のオブジェクトに置き換えると、束ねていない行 getter も新しい値を表示する（他の行はそのまま）", async () => {
    const state: any = { items: [{ n: 1 }, { n: 2 }] };
    Object.defineProperty(state, "items.*.double", {
      get(this: any) { return this["items.*.n"] * 2; },
      enumerable: true, configurable: true,
    });
    const html = `<template data-wcs="for: items"><b class="d" data-wcs="textContent: items.*.double"></b></template>`;
    const { host, shadowRoot, stateEl } = await mount(state, html);
    const blocks = Array.from(shadowRoot.querySelectorAll(".d"));

    write(stateEl, (s: any) => { s.$resolve("items.*", [0], { n: 50 }); });
    await flush();
    expect(texts(shadowRoot, ".d")).toEqual(["100", "4"]); // 旧: ["2", "4"]
    expect(read(stateEl, (s: any) => s.$getAll("items.*.double", []))).toEqual([100, 4]);
    expect(Array.from(shadowRoot.querySelectorAll(".d")), "置き換えた行もブロックはその場に残る").toEqual(blocks);
    host.remove();
  });

  it("プリミティブの行を双方向バインドで編集しても、入力欄は DOM から外れずフォーカスを保つ", async () => {
    const html = `<div class="box"><template data-wcs="for: tags"><input class="ed" data-wcs="value: tags.*"></template></div>`;
    const { host, shadowRoot, stateEl } = await mount({ tags: ["red", "green", "blue"] }, html);
    const editor = shadowRoot.querySelectorAll<HTMLInputElement>(".ed")[1];
    let detached = 0;
    const countDetached = (records: MutationRecord[]): void => {
      for (const record of records) {
        detached += Array.from(record.removedNodes).filter((removed) => removed === editor).length;
      }
    };
    const observer = new MutationObserver(countDetached);
    observer.observe(shadowRoot.querySelector(".box")!, { childList: true, subtree: true });
    editor.focus();

    for (const typed of ["greenx", "greenxy"]) {
      editor.value = typed;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      await flush();
    }
    await flush();
    countDetached(observer.takeRecords());
    observer.disconnect();
    expect(read(stateEl, (s: any) => [...s.tags])).toEqual(["red", "greenxy", "blue"]);
    expect(detached, "打鍵ごとにブロックを作り直さない").toBe(0); // 旧（このブランチの初版）: 2
    expect(shadowRoot.querySelectorAll(".ed")[1]).toBe(editor);
    expect(shadowRoot.activeElement).toBe(editor);
    host.remove();
  });

  it("1 行だけのリストでも、行を置き換える書き込みで入力欄が DOM から外れない", async () => {
    const html = `<div class="box"><template data-wcs="for: tags"><input class="ed" data-wcs="value: tags.*"></template></div>`;
    const { host, shadowRoot, stateEl } = await mount({ tags: ["solo"] }, html);
    const editor = shadowRoot.querySelector<HTMLInputElement>(".ed")!;
    editor.focus();

    editor.value = "solo!";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(read(stateEl, (s: any) => [...s.tags])).toEqual(["solo!"]);
    expect(shadowRoot.querySelector(".ed")).toBe(editor);
    expect(shadowRoot.activeElement, "親を空にする近道で外さない").toBe(editor);
    host.remove();
  });

  it("行ハンドラで行を新しいオブジェクトに差し替えても（不変更新）、ブロックと行の DOM の状態はその場に残る", async () => {
    const html =
      `<template data-wcs="for: todos"><div class="row">` +
      `<button class="toggle" data-wcs="onclick: toggle; textContent: todos.*.label"></button><input class="note">` +
      `</div></template>`;
    const { host, shadowRoot, stateEl } = await mount({
      todos: [{ label: "a" }, { label: "b" }],
      toggle(this: any) {
        const row = this["todos.*"];
        this["todos.*"] = { ...row, label: `${row.label}!` };
      },
    }, html);
    const rows = Array.from(shadowRoot.querySelectorAll(".row"));
    (rows[0].querySelector(".note") as HTMLInputElement).value = "typed";
    const button = rows[0].querySelector<HTMLButtonElement>(".toggle")!;
    button.focus();

    button.click();
    await flush();
    expect(read(stateEl, (s: any) => s.todos.map((todo: any) => todo.label))).toEqual(["a!", "b"]);
    expect(texts(shadowRoot, ".toggle")).toEqual(["a!", "b"]);
    expect(Array.from(shadowRoot.querySelectorAll(".row"))).toEqual(rows);
    expect((rows[0].querySelector(".note") as HTMLInputElement).value).toBe("typed");
    expect(shadowRoot.activeElement).toBe(button);
    host.remove();
  });

  it("プリミティブの行を置き換えると、$watch の prev は置き換える前の値", async () => {
    const calls: unknown[] = [];
    const html = `<template data-wcs="for: tags"><i data-wcs="textContent: tags.*"></i></template>`;
    const { host, stateEl } = await mount({
      tags: ["a", "b", "c"],
      $watch: {
        "tags.*"(current: unknown, previous: unknown, index: unknown) { calls.push([current, previous, index]); },
      },
    }, html);
    await flush();
    calls.length = 0;

    write(stateEl, (s: any) => { s["tags.1"] = "Q"; });
    await flush();
    await flush();
    expect(calls).toEqual([["Q", "b", 1]]); // 旧（このブランチの初版）: [["Q", undefined, 1]]
    host.remove();
  });

  it("同じバッチで同じ位置を 2 回置き換えても、$watch の prev はバッチが始まる前の値", async () => {
    const calls: unknown[] = [];
    const html = `<template data-wcs="for: tags"><i data-wcs="textContent: tags.*"></i></template>`;
    const { host, stateEl } = await mount({
      tags: ["a", "b", "c"],
      $watch: {
        "tags.*"(current: unknown, previous: unknown, index: unknown) { calls.push([current, previous, index]); },
      },
    }, html);
    await flush();
    calls.length = 0;

    write(stateEl, (s: any) => {
      s["tags.1"] = "Q";
      s["tags.1"] = "R";
    });
    await flush();
    await flush();
    expect(calls).toEqual([["R", "b", 1]]);
    host.remove();
  });

  it("再帰の集計を持つ行を置き換えても、表示が state と一致する", async () => {
    const state: any = { nodes: [node(7, [node(70)]), node(8)], $recursion: { "nodes.*": "children.*" } };
    Object.defineProperty(state, "nodes.**.total", {
      get(this: any) {
        return this["nodes.**.value"] +
          this.$getAll("nodes.**.children.*.total").reduce((a: number, b: number) => a + b, 0);
      },
      enumerable: true, configurable: true,
    });
    const html = `<div><template data-wcs="for: nodes"><span class="t" data-wcs="textContent: nodes.*.total"></span></template></div>`;
    const { host, shadowRoot, stateEl } = await mount(state, html);
    expect(texts(shadowRoot, ".t")).toEqual(["77", "8"]);

    write(stateEl, (s: any) => { s.$resolve("nodes.*", [0], node(9, [node(90)])); });
    await flush();
    expect(texts(shadowRoot, ".t")).toEqual(["99", "8"]); // 旧: ["97", "8"]
    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.total", []))).toEqual([99, 8]);
    host.remove();
  });
});

describe("同じバッチで消える行に書いてから置き換える（drain の既存欠陥）", () => {
  it("行の葉に書いてからその行を配列置換で入れ替えても、表示が state と一致する", async () => {
    // 行の葉への書き込みで enqueue された binding が `for` より先に前の行として適用され、`for` が同じ
    // Content をプールから新しい行に使い回したとき、適用済みの印で新しい行の値が当たらなかった
    // （main: 表示 ["5", "2"] / 読み [9, 2]）
    const html = `<template data-wcs="for: items"><i class="n" data-wcs="textContent: items.*.n"></i></template>`;
    const { host, shadowRoot, stateEl } = await mount({ items: [{ n: 1 }, { n: 2 }] }, html);

    write(stateEl, (s: any) => {
      s["items.0.n"] = 5;
      s.items = [{ n: 9 }, s.items[1]];
    });
    await flush();
    expect(texts(shadowRoot, ".n")).toEqual(["9", "2"]); // 旧: ["5", "2"]
    expect(read(stateEl, (s: any) => s.$getAll("items.*.n", []))).toEqual([9, 2]);
    host.remove();
  });
});

describe("入れ替えの記録（書き込む前の並び）", () => {
  const html = `<template data-wcs="for: items"><i class="r" data-wcs="onclick: pick; textContent: items.*.name"></i></template>`;

  it("入れ替えの途中で行を置き換え、押し出した値を別の位置へ戻しても、ブロックと読み書きが実配列と一致する", async () => {
    const picks: unknown[] = [];
    const { host, shadowRoot, stateEl } = await mount({
      items: [{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }],
      pick(this: any, _event: Event, index: number) { picks.push([index, this["items.*.name"]]); },
    }, html);
    const [, blockB, blockC, blockD] = Array.from(shadowRoot.querySelectorAll(".r"));

    write(stateEl, (s: any) => {
      const b = s["items.1"];
      s["items.0"] = s["items.3"]; // [d, b, c, d] — 重複があるので入れ替えはまだ揃っていない
      s["items.1"] = { name: "x" }; // [d, x, c, d]
      s["items.3"] = b; // [d, x, c, b] — b は元の行のまま位置 3 へ動き、x は新しい行
    });
    await flush();
    expect(read(stateEl, (s: any) => s.items.map((item: any) => item.name))).toEqual(["d", "x", "c", "b"]);
    expect(texts(shadowRoot, ".r")).toEqual(["d", "x", "c", "b"]);
    const blocks = Array.from(shadowRoot.querySelectorAll(".r"));
    expect([blocks[0], blocks[2], blocks[3]]).toEqual([blockD, blockC, blockB]);
    expect(read(stateEl, (s: any) => [s["items.1.name"], s["items.3.name"]])).toEqual(["x", "b"]);

    blocks.forEach((block) => block.dispatchEvent(new Event("click")));
    await flush();
    expect(picks).toEqual([[0, "d"], [1, "x"], [2, "c"], [3, "b"]]);

    write(stateEl, (s: any) => { s["items.1.name"] = "y"; });
    await flush();
    expect(texts(shadowRoot, ".r")).toEqual(["d", "y", "c", "b"]);
    host.remove();
  });

  it("別の state 要素で揃っていない入れ替えの記録を、同じパスのリストが拾わない", async () => {
    const first = await mount({ items: [{ name: "a" }, { name: "b" }, { name: "c" }], pick() {} }, html);
    const second = await mount({ items: [{ name: "p" }, { name: "q" }, { name: "r" }], pick() {} }, html);
    const firstBlocks = Array.from(first.shadowRoot.querySelectorAll(".r"));
    const secondBlocks = Array.from(second.shadowRoot.querySelectorAll(".r"));
    let a: unknown;

    write(first.stateEl, (s: any) => {
      a = s["items.0"];
      s["items.0"] = s["items.1"]; // [b, b, c] — 揃っていない
    });
    await flush();
    write(second.stateEl, (s: any) => { s["items.1"] = { name: "z" }; });
    await flush();
    expect(texts(second.shadowRoot, ".r")).toEqual(["p", "z", "r"]);
    expect(Array.from(second.shadowRoot.querySelectorAll(".r")), "もう一方の記録で行を作り直さない").toEqual(secondBlocks);

    write(first.stateEl, (s: any) => { s["items.1"] = a; }); // [b, a, c] — 揃う
    await flush();
    expect(texts(first.shadowRoot, ".r")).toEqual(["b", "a", "c"]);
    expect(Array.from(first.shadowRoot.querySelectorAll(".r"))).toEqual([firstBlocks[1], firstBlocks[0], firstBlocks[2]]);
    first.host.remove();
    second.host.remove();
  });
});
