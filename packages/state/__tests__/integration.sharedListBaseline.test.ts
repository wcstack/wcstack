/**
 * integration.sharedListBaseline.test.ts — 同じリストを 2 つの `for` が描き、片方が画面から外れている
 * 間にリストが変わる形（#320）。
 *
 * 差分の基準（lastListValue）はアドレスごとに 1 本で、行の Content の台帳は `for`（アンカー）ごと。
 * 画面から外れている `for`（`if` で消された・作者のコードで DOM から外された）は描かれないので、共有の
 * 基準はもう片方の `for` が描いた値へ進む。戻した `for` がその基準で差分を取ると「行は全部そのまま」に
 * なり、消えている間に増えた行を描かず、`Content not found for ListIndex` を投げて同じ `if` の残りの
 * バインドまで古いまま残した（v1.10.0 から）。
 *
 * 修理: `for` ごとに「自分が描いた並び」を覚え、共有の基準と違えば、行の台帳は共有の差分で進めたうえで、
 * 自分の行と今の行を行の同一性で突き合わせる（applyChangeToFor）。要素書き込みは配列と台帳をその場で
 * 書き換えるので、書き込む前の並びの写しを、その配列を描いた全ての `for` に届ける
 * （lastListValueByAbsoluteStateAddress の IRenderedList）。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { getContentSetByNode } from "../src/structural/contentsByNode";
import { flush, makeMount, write } from "./helpers/recursionTestUtils";

beforeAll(() => {
  bootstrapState();
});

const mount = makeMount("sharedbaseline-host");

let errorSpy: ReturnType<typeof vi.spyOn> | null = null;
/** 失敗の手がかりは console.error（`binding "if: showA" failed to apply`）だけなので、全テストで数える */
function spyErrors(): ReturnType<typeof vi.spyOn> {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  return errorSpy;
}
afterEach(() => {
  errorSpy?.mockRestore();
  errorSpy = null;
});

const texts = (root: ParentNode, selector: string) =>
  Array.from(root.querySelectorAll(selector)).map((node) => (node.textContent ?? "").trim());

function forAnchorIn(parent: Node): Node {
  return Array.from(parent.childNodes)
    .find((node) => node.nodeType === Node.COMMENT_NODE && (node as Comment).data.startsWith("@@wcs-for"))!;
}

const row = (id: number) => ({ id });
const rows = (...ids: number[]) => ids.map(row);

const UL_IN_IF =
  `<div><template data-wcs="if: showA"><ul><template data-wcs="for: items"><li>{{ .id }}</li></template></ul></template></div>`;
const UL = `<ul><template data-wcs="for: items"><li>{{ .id }}</li></template></ul>`;
const OL = `<ol><template data-wcs="for: items"><li>{{ .id }}</li></template></ol>`;

async function step(stateEl: any, fn: (s: any) => void): Promise<void> {
  write(stateEl, fn);
  await flush();
}

describe("同じリストを描く for の片方が if で消えている間にリストが変わる（#320）", () => {
  it("Issue の手順: 消えている間に増えた行を描き、戻した後の並べ替えにも追従すること", async () => {
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount({ showA: true, items: rows(1, 2) }, UL_IN_IF + OL);
    const ul = () => texts(shadowRoot, "ul > li");
    const ol = () => texts(shadowRoot, "ol > li");

    await step(stateEl, (s) => { s.items = [...s.items, row(3)]; });
    expect(ul()).toEqual(["1", "2", "3"]);
    await step(stateEl, (s) => { s.showA = false; });
    expect(ul()).toEqual([]);
    await step(stateEl, (s) => { s.items = [...s.items, row(4)]; });
    expect(ol()).toEqual(["1", "2", "3", "4"]);
    await step(stateEl, (s) => { s.showA = true; });
    // 修理前: ["1", "2", "3"]（4 が欠ける）
    expect(ul()).toEqual(["1", "2", "3", "4"]);
    await step(stateEl, (s) => { s.items = [...s.items].reverse(); });
    // 修理前: ["1", "2", "3"] のまま
    expect(ul()).toEqual(["4", "3", "2", "1"]);
    expect(ol()).toEqual(["4", "3", "2", "1"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("排他の if 2 つで同じリストを表とカードに切り替えても、どちらの表示も一覧に追従すること", async () => {
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount({
      tab: "list",
      items: rows(1, 2),
      get isList() { return (this as any).tab === "list"; },
      get isCard() { return (this as any).tab === "card"; },
    },
      `<template data-wcs="if: isList"><ul><template data-wcs="for: items"><li>{{ .id }}</li></template></ul></template>` +
      `<template data-wcs="if: isCard"><ol><template data-wcs="for: items"><li>{{ .id }}</li></template></ol></template>`);
    const ul = () => texts(shadowRoot, "ul > li");
    const ol = () => texts(shadowRoot, "ol > li");

    await step(stateEl, (s) => { s.tab = "card"; });
    expect(ol()).toEqual(["1", "2"]);
    await step(stateEl, (s) => { s.tab = "list"; });
    await step(stateEl, (s) => { s.items = [...s.items, row(3)]; });
    expect(ul()).toEqual(["1", "2", "3"]);
    await step(stateEl, (s) => { s.tab = "card"; });
    // 修理前: ["1", "2"]
    expect(ol()).toEqual(["1", "2", "3"]);
    await step(stateEl, (s) => { s.items = [...s.items, row(4)]; });
    await step(stateEl, (s) => { s.tab = "list"; });
    // 修理前: ["1", "2", "3"]
    expect(ul()).toEqual(["1", "2", "3", "4"]);
    expect(ol()).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("同じ if の中でリストより後ろにあるバインドも、戻したときに新しい値になること", async () => {
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount(
      { showA: true, note: "n1", items: rows(1, 2) },
      `<div><template data-wcs="if: showA"><ul><template data-wcs="for: items"><li>{{ .id }}</li></template></ul>` +
      `<p class="after">{{ note }}</p></template></div>` + OL,
    );

    await step(stateEl, (s) => { s.showA = false; });
    await step(stateEl, (s) => { s.items = [...s.items, row(4)]; s.note = "n2"; });
    await step(stateEl, (s) => { s.showA = true; });
    expect(texts(shadowRoot, "ul > li")).toEqual(["1", "2", "4"]);
    // 修理前: "n1"（リストの throw で、同じ if の残りのバインドが適用されなかった）
    expect(shadowRoot.querySelector("p.after")!.textContent).toBe("n2");
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("作者のコードで DOM から外している間に変わったリストも、戻せば追従すること", async () => {
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount(
      { items: rows(1, 2) },
      `<div class="box">${UL}</div>` + OL,
    );
    const box = shadowRoot.querySelector("div.box")!;
    const ul = box.querySelector("ul")!;
    const ulRows = () => texts(ul, ":scope > li");

    ul.remove();
    await flush();
    await step(stateEl, (s) => { s.items = [...s.items, row(3)]; });
    await step(stateEl, (s) => { s.items = s.items.filter((r: any) => r.id !== 1); });
    expect(ulRows(), "外している間は描かれない").toEqual(["1", "2"]);
    box.appendChild(ul);
    await flush();
    // 修理前: ["1", "2"]（戻しても古いまま）
    expect(ulRows()).toEqual(["2", "3"]);
    await step(stateEl, (s) => { s.items = [...s.items].reverse(); });
    expect(ulRows()).toEqual(["3", "2"]);
    await step(stateEl, (s) => { s.items = [...s.items, row(4)]; });
    expect(ulRows()).toEqual(["3", "2", "4"]);
    expect(texts(shadowRoot, "ol > li")).toEqual(["3", "2", "4"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("描いた並びが空だった for も、消えている間に増えた行を描くこと", async () => {
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount({ showA: true, items: [] }, UL_IN_IF + OL);

    await step(stateEl, (s) => { s.showA = false; });
    await step(stateEl, (s) => { s.items = rows(1, 2); });
    await step(stateEl, (s) => { s.showA = true; });
    expect(texts(shadowRoot, "ul > li")).toEqual(["1", "2"]);
    await step(stateEl, (s) => { s.items = [...s.items].reverse(); });
    expect(texts(shadowRoot, "ul > li")).toEqual(["2", "1"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });
});

describe("消えている間の書き換えの綴り（#320）", () => {
  /** 消えている間の書き換え（1 要素 = 1 バッチ）と、書き換えた後の一覧 */
  type Case = readonly [title: string, edits: ((s: any) => void)[], expected: string[]];
  const cases: Case[] = [
    ["全置換（行オブジェクトを作り直す）", [(s) => { s.items = s.items.map((r: any) => ({ id: r.id * 10 })); }], ["10", "20", "30"]],
    ["行の差し替え（写して a[0] を置き換え、再代入）", [(s) => { const a = [...s.items]; a[0] = row(100); s.items = a; }], ["100", "2", "3"]],
    ["要素書き込み（items.0 に新しい行）", [(s) => { s["items.0"] = row(99); }], ["99", "2", "3"]],
    ["要素書き込みの入れ替え（items.0 と items.1）", [(s) => { const a = s["items.0"], b = s["items.1"]; s["items.0"] = b; s["items.1"] = a; }], ["2", "1", "3"]],
    ["削除", [(s) => { s.items = s.items.filter((r: any) => r.id !== 2); }], ["1", "3"]],
    ["並べ替え", [(s) => { s.items = [...s.items].reverse(); }], ["3", "2", "1"]],
    ["空にしてから足す", [(s) => { s.items = []; }, (s) => { s.items = [row(9)]; }], ["9"]],
  ];

  it.each(cases)("%s: 戻すと今の一覧を描き、その後の変更にも追従すること", async (_title, edits, expected) => {
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount({ showA: true, items: rows(1, 2, 3) }, UL_IN_IF + OL);

    await step(stateEl, (s) => { s.showA = false; });
    for (const edit of edits) {
      await step(stateEl, edit);
    }
    expect(texts(shadowRoot, "ol > li")).toEqual(expected);
    await step(stateEl, (s) => { s.showA = true; });
    expect(texts(shadowRoot, "ul > li")).toEqual(expected);
    await step(stateEl, (s) => { s.items = [...s.items].reverse(); });
    expect(texts(shadowRoot, "ul > li")).toEqual([...expected].reverse());
    expect(texts(shadowRoot, "ol > li")).toEqual([...expected].reverse());
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("消えている間に行を足してから要素書き込みをしても、戻すと今の一覧を描くこと", async () => {
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount({ showA: true, items: rows(1, 2, 3) }, UL_IN_IF + OL);

    await step(stateEl, (s) => { s.showA = false; });
    await step(stateEl, (s) => { s.items = [...s.items, row(4)]; });
    await step(stateEl, (s) => { s["items.0"] = row(99); });
    await step(stateEl, (s) => { s.showA = true; });
    expect(texts(shadowRoot, "ul > li")).toEqual(["99", "2", "3", "4"]);
    await step(stateEl, (s) => { s.items = [...s.items].reverse(); });
    expect(texts(shadowRoot, "ul > li")).toEqual(["4", "3", "2", "99"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  /**
   * 要素書き込みは配列をその場で書き換えるので、「描いた並び」を配列そのもので覚えると区別が付かない。
   * 消えている for が描いたのは書き込む前、もう片方がその後に描いたのは書き込んだ後 —
   * どちらも同じ配列インスタンス。その配列を描いた for は全員、書き込む前の写しを基準にする。
   */
  it("消えている間に同じ配列へ別々のバッチで要素書き込みをしても、戻すと今の一覧を描くこと", async () => {
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount({ showA: true, items: rows(1, 2, 3) }, UL_IN_IF + OL);

    await step(stateEl, (s) => { s.showA = false; });
    await step(stateEl, (s) => { s["items.0"] = row(91); });
    await step(stateEl, (s) => { s["items.2"] = row(93); });
    expect(texts(shadowRoot, "ol > li")).toEqual(["91", "2", "93"]);
    await step(stateEl, (s) => { s.showA = true; });
    expect(texts(shadowRoot, "ul > li")).toEqual(["91", "2", "93"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("消えている for が描いた配列インスタンスを戻してから要素書き込みをしても、戻すと今の一覧を描くこと", async () => {
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount({ showA: true, items: rows(1, 2, 3) }, UL_IN_IF + OL);
    let original: unknown[] = [];

    await step(stateEl, (s) => { original = s.items; s.showA = false; });
    await step(stateEl, (s) => { s.items = [...s.items, row(4)]; });
    // 消えている ul が描いたのと同じ配列インスタンスを、見えている ol がもう一度描く
    await step(stateEl, (s) => { s.items = original; });
    await step(stateEl, (s) => { s["items.0"] = row(99); });
    expect(texts(shadowRoot, "ol > li")).toEqual(["99", "2", "3"]);
    await step(stateEl, (s) => { s.showA = true; });
    expect(texts(shadowRoot, "ul > li")).toEqual(["99", "2", "3"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });
});

describe("入れ子のリスト（#320）", () => {
  const GROUP_ROW =
    `<div class="g"><b>{{ .id }}</b><template data-wcs="for: .rows"><p>{{ .id }}</p></template></div>`;
  const GROUPS_IN_IF =
    `<div><template data-wcs="if: showA"><section class="a"><template data-wcs="for: groups">${GROUP_ROW}</template></section></template></div>`;
  const GROUPS = `<section class="b"><template data-wcs="for: groups">${GROUP_ROW}</template></section>`;
  const initial = () => ({
    showA: true,
    groups: [{ id: 1, rows: rows(11, 12) }, { id: 2, rows: rows(21) }],
  });
  /** `1:11+12 2:21` の形（グループの id と、その子の id） */
  const view = (root: ParentNode, section: string) => Array.from(root.querySelectorAll(`section.${section} .g`))
    .map((group) => `${group.querySelector("b")!.textContent}:${texts(group, "p").join("+")}`)
    .join(" ");

  it("消えている間に親の行を差し替えても（写して g[0] を置き換え）、戻すと子の行まで描くこと", async () => {
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount(initial(), GROUPS_IN_IF + GROUPS);

    await step(stateEl, (s) => { s.showA = false; });
    await step(stateEl, (s) => { const g = [...s.groups]; g[0] = { ...g[0], rows: [...g[0].rows, row(13)] }; s.groups = g; });
    expect(view(shadowRoot, "b")).toBe("1:11+12+13 2:21");
    await step(stateEl, (s) => { s.showA = true; });
    // 修理前: 子の for が `Content not found` を投げ、戻した表示に子の行が出ない
    expect(view(shadowRoot, "a")).toBe("1:11+12+13 2:21");
    await step(stateEl, (s) => { s.groups = [...s.groups, { id: 3, rows: rows(31) }]; });
    expect(view(shadowRoot, "a")).toBe("1:11+12+13 2:21 3:31");

    await step(stateEl, (s) => { s.showA = false; });
    await step(stateEl, (s) => { s.groups = [...s.groups, { id: 4, rows: rows(41) }]; });
    await step(stateEl, (s) => { s["groups.0.rows"] = [...s["groups.0.rows"], row(14)]; });
    await step(stateEl, (s) => { s.showA = true; });
    expect(view(shadowRoot, "a")).toBe("1:11+12+13+14 2:21 3:31 4:41");
    await step(stateEl, (s) => { s.groups = [...s.groups].reverse(); });
    expect(view(shadowRoot, "a")).toBe("4:41 3:31 2:21 1:11+12+13+14");
    expect(view(shadowRoot, "b")).toBe("4:41 3:31 2:21 1:11+12+13+14");
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("消えている間の親の要素書き込み・子の要素書き込み・親の入れ替えも、戻すと描くこと", async () => {
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount(initial(), GROUPS_IN_IF + GROUPS);

    await step(stateEl, (s) => { s.showA = false; });
    await step(stateEl, (s) => { s["groups.0"] = { id: 9, rows: rows(91) }; });
    await step(stateEl, (s) => { s.showA = true; });
    expect(view(shadowRoot, "a")).toBe("9:91 2:21");

    await step(stateEl, (s) => { s.showA = false; });
    await step(stateEl, (s) => { s["groups.1.rows.0"] = row(99); });
    await step(stateEl, (s) => { s.showA = true; });
    expect(view(shadowRoot, "a")).toBe("9:91 2:99");

    await step(stateEl, (s) => { s.showA = false; });
    await step(stateEl, (s) => { const a = s["groups.0"], b = s["groups.1"]; s["groups.0"] = b; s["groups.1"] = a; });
    await step(stateEl, (s) => { s.showA = true; });
    expect(view(shadowRoot, "a")).toBe("2:99 9:91");
    expect(view(shadowRoot, "b")).toBe("2:99 9:91");
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });
});

describe("隠す・戻すを繰り返しても Content の台帳が伸びない（#320）", () => {
  it("消えている間に全置換を重ねても、戻した for のアンカーが持つ Content は描いている行の数のまま", async () => {
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount({ showA: true, items: rows(1, 2, 3) }, UL_IN_IF + OL);
    const ul = shadowRoot.querySelector("ul")!;
    const anchor = forAnchorIn(ul);
    let nextId = 100;

    for (let cycle = 0; cycle < 5; cycle++) {
      await step(stateEl, (s) => { s.showA = false; });
      for (let k = 0; k < 5; k++) {
        await step(stateEl, (s) => { s.items = rows(nextId++, nextId++, nextId++); });
      }
      await step(stateEl, (s) => { s.showA = true; });
      expect(texts(ul, "li")).toEqual(texts(shadowRoot, "ol > li"));
      expect(getContentSetByNode(anchor).size, `cycle ${cycle}`).toBe(3);
    }
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("入れ子: 消えている間に親の行を差し替えるのを繰り返しても、子の for の台帳が伸びない", async () => {
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount(
      { showA: true, groups: [{ id: 1, rows: rows(11, 12) }, { id: 2, rows: rows(21) }] },
      `<div><template data-wcs="if: showA"><section class="a"><template data-wcs="for: groups">` +
      `<div class="g"><template data-wcs="for: .rows"><p>{{ .id }}</p></template></div></template></section></template></div>` +
      `<section class="b"><template data-wcs="for: groups">` +
      `<div class="g"><template data-wcs="for: .rows"><p>{{ .id }}</p></template></div></template></section>`,
    );
    const innerLedgers = () => Array.from(shadowRoot.querySelectorAll("section.a .g"))
      .map((group) => getContentSetByNode(forAnchorIn(group)).size);

    for (let k = 0; k < 4; k++) {
      await step(stateEl, (s) => { s.showA = false; });
      await step(stateEl, (s) => { const g = [...s.groups]; g[0] = { ...g[0], rows: rows(100 + k, 200 + k) }; s.groups = g; });
      await step(stateEl, (s) => { s.showA = true; });
      expect(texts(shadowRoot, "section.a p")).toEqual([String(100 + k), String(200 + k), "21"]);
      expect(innerLedgers(), `round ${k}`).toEqual([2, 1]);
    }
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });
});

describe("対照: 基準を共有しない形は修理前から描けている（#320）", () => {
  it("for が 1 つだけなら、if で消している間の変更を戻したときに描くこと", async () => {
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount({ showA: true, items: rows(1, 2) }, UL_IN_IF);

    await step(stateEl, (s) => { s.items = [...s.items, row(3)]; });
    await step(stateEl, (s) => { s.showA = false; });
    await step(stateEl, (s) => { s.items = [...s.items, row(4)]; });
    await step(stateEl, (s) => { s.showA = true; });
    expect(texts(shadowRoot, "ul > li")).toEqual(["1", "2", "3", "4"]);
    await step(stateEl, (s) => { s.items = [...s.items].reverse(); });
    expect(texts(shadowRoot, "ul > li")).toEqual(["4", "3", "2", "1"]);
    await step(stateEl, (s) => { s.showA = false; });
    await step(stateEl, (s) => { s["items.0"] = row(99); });
    await step(stateEl, (s) => { s.showA = true; });
    expect(texts(shadowRoot, "ul > li")).toEqual(["99", "3", "2", "1"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("2 つとも if の外なら、どちらも毎回描かれて一覧に追従すること", async () => {
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount({ items: rows(1, 2) }, UL + OL);
    const both = () => [texts(shadowRoot, "ul > li"), texts(shadowRoot, "ol > li")];

    await step(stateEl, (s) => { s.items = [...s.items, row(3)]; });
    await step(stateEl, (s) => { s["items.0"] = row(99); });
    expect(both()).toEqual([["99", "2", "3"], ["99", "2", "3"]]);
    await step(stateEl, (s) => { s.items = [...s.items].reverse(); });
    await step(stateEl, (s) => { s.items = s.items.filter((r: any) => r.id !== 2); });
    expect(both()).toEqual([["3", "99"], ["3", "99"]]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });
});

/**
 * 突き合わせる今の行の親が、この for の行と食い違う台帳（要素書き込みが古い親の下に行を鋳造した、
 * 修正前からの欠陥）では突き合わせに使わず、従来の差分に戻す。使うと、その行が別の行の値を描き、
 * その後の書き込みを別の行のデータへ着地させた（修正前は Content not found で止まり、state は無事）。
 */
describe("行の親が食い違う台帳では突き合わせを使わない（#320）", () => {
  it("入れ子の for で要素書き込みと入れ替えを重ねても、書き込みは書いた行のデータに入ること", async () => {
    const errors = spyErrors();
    const html = `<div class="A"><template data-wcs="for: items"><section><b>{{ .id }}</b>:`
      + `<template data-wcs="for: .tags"><i>{{ .t }}</i></template></section></template></div>`;
    const tags = (...values: number[]) => values.map((t) => ({ t }));
    const { host, stateEl } = await mount({
      items: [{ id: 110, tags: tags() }, { id: 100, tags: tags(109, 108) }, { id: 103, tags: tags(104) }],
    }, html);
    const data = () => {
      let out = "";
      stateEl.createState("readonly", (s: any) => {
        out = s.items.map((r: any) => `${r.id}:${r.tags.map((x: any) => x.t).join(",")}`).join("|");
      });
      return out;
    };

    await step(stateEl, (s) => { s["items.2"] = { id: 111, tags: tags(112) }; });
    await step(stateEl, (s) => { s["items.2.tags.0"] = { t: 113 }; });
    await step(stateEl, (s) => { const a = s.items[1]; s["items.1"] = s.items[2]; s["items.2"] = a; });
    await step(stateEl, (s) => { s["items.2"] = { id: 114, tags: tags(115) }; });
    await step(stateEl, (s) => { s["items.1.tags.0"] = { t: 116 }; });

    // 誤った突き合わせでは "110:|111:113|114:116"（行 1 に書いたつもりが行 2 の tags が変わる）
    expect(data()).toBe("110:|111:116|114:115");
    // 台帳の食い違いは従来どおり見える失敗として残る（修正前からの欠陥・この修理の範囲外）
    expect(errors).toHaveBeenCalled();
    host.remove();
  });
});
