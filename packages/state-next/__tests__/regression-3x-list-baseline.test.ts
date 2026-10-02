/**
 * regression-3x-list-baseline.test.ts — @wcstack/state 3.4.0 で直した「同じリストの差分の基準・要素の書き込み・
 * 兄弟のアンカー」の不具合（#320・#335・#337・#359・#361・#392）の回帰の形を、4.0 のエンジン（state-next）で流す。
 *
 * 3.x の回帰テスト（packages/state/__tests__ の integration.sharedListBaseline / elementSwapLedger /
 * elementSwapUnsettled / elementSwapFuzz / forSiblingAnchors と、修正で変わった elementSwapIdentity /
 * sharedListRowRevival / createListDiff）の形ごとに 1 つずつ置く。Issue の報告そのものの形は
 * issues.test.ts（#320・#335・#337）と issues-lists.test.ts（#359・#361）に既にあるので、ここでは繰り返さない。
 *
 * 4.0 では要素の書き込みは「その位置の値の置き換え」で、行が値と一緒に動く「入れ替え」は無い
 * （docs/migration-v4.md §3.4「Writing a list element replaces the value at that position」）。3.x の期待のうち
 * ブロックの移動に依るもの（「揃えばブロックが値と一緒に動く」）は、4.0 の振る舞い（行は位置に留まり、値が
 * 置き換わる）を確かめる形に読み替える。描いた値・`$1`・状態の値・`$watch` の位置・console.error が出ないことは
 * そのまま確かめる。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, scopes, temporal } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([temporal, scopes]);
  bootstrapState();
});

let errorSpy: ReturnType<typeof vi.spyOn> | null = null;
/** 3.x の失敗の手がかりは console.error（`binding "for: items" failed to apply`）だけだったので数える */
function spyErrors(): ReturnType<typeof vi.spyOn> {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  return errorSpy;
}
afterEach(() => {
  errorSpy?.mockRestore();
  errorSpy = null;
});

/** A page (a shadow root) with a root `<wcs-state>` over `state`. */
async function page(html: string, state: Record<string, any>) {
  const host = document.createElement(`reg3x-listbase-page-${seq++}`);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(host);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  await flush();
  const write = async (fn: (s: any) => void) => {
    el.createState("writable", fn);
    await flush();
    await flush();
  };
  /** Reads through a readonly state: `fn` gets the state proxy. */
  const read = <T>(fn: (s: any) => T): T => {
    let v: T | undefined;
    el.createState("readonly", (s: any) => { v = fn(s); });
    return v as T;
  };
  return { host, root, el, write, read };
}

const texts = (c: ParentNode, sel: string): string[] => Array.from(c.querySelectorAll(sel)).map((n) => (n.textContent ?? "").trim());

const row = (id: number) => ({ id });
const rows = (...ids: number[]) => ids.map(row);

// ================================================================ #320

const UL_IN_IF =
  `<div><template data-wcs="if: showA"><ul><template data-wcs="for: items"><li>{{ .id }}</li></template></ul></template></div>`;
const UL = `<ul><template data-wcs="for: items"><li>{{ .id }}</li></template></ul>`;
const OL = `<ol><template data-wcs="for: items"><li>{{ .id }}</li></template></ol>`;

describe("#320 同じリストを描く for の片方が画面から外れている間にリストが変わっても、戻せば今の一覧を描く", () => {
  it("排他の if 2 つで同じリストを表とカードに切り替えても、どちらの表示も一覧に追従する", async () => {
    const errors = spyErrors();
    const { host, root, write } = await page(
      `<template data-wcs="if: isList"><ul><template data-wcs="for: items"><li>{{ .id }}</li></template></ul></template>`
      + `<template data-wcs="if: isCard"><ol><template data-wcs="for: items"><li>{{ .id }}</li></template></ol></template>`,
      {
        tab: "list",
        items: rows(1, 2),
        get isList() { return (this as any).tab === "list"; },
        get isCard() { return (this as any).tab === "card"; },
      },
    );
    const ul = () => texts(root, "ul > li");
    const ol = () => texts(root, "ol > li");
    await write((s) => { s.tab = "card"; });
    expect(ol()).toEqual(["1", "2"]);
    await write((s) => { s.tab = "list"; });
    await write((s) => { s.items = [...s.items, row(3)]; });
    expect(ul()).toEqual(["1", "2", "3"]);
    await write((s) => { s.tab = "card"; });
    expect(ol()).toEqual(["1", "2", "3"]);
    await write((s) => { s.items = [...s.items, row(4)]; });
    await write((s) => { s.tab = "list"; });
    expect(ul()).toEqual(["1", "2", "3", "4"]);
    expect(ol()).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("同じ if の中でリストより後ろにあるバインドも、戻したときに新しい値になる", async () => {
    const errors = spyErrors();
    const { host, root, write } = await page(
      `<div><template data-wcs="if: showA"><ul><template data-wcs="for: items"><li>{{ .id }}</li></template></ul>`
      + `<p class="after">{{ note }}</p></template></div>` + OL,
      { showA: true, note: "n1", items: rows(1, 2) },
    );
    await write((s) => { s.showA = false; });
    await write((s) => { s.items = [...s.items, row(4)]; s.note = "n2"; });
    await write((s) => { s.showA = true; });
    expect(texts(root, "ul > li")).toEqual(["1", "2", "4"]);
    expect(root.querySelector("p.after")!.textContent).toBe("n2");
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("作者のコードで DOM から外している間に変わったリストも、戻せば追従する", async () => {
    const errors = spyErrors();
    const { host, root, write } = await page(`<div class="box">${UL}</div>` + OL, { items: rows(1, 2) });
    const box = root.querySelector("div.box")!;
    const ul = box.querySelector("ul")!;
    const ulRows = () => texts(ul, ":scope > li");
    ul.remove();
    await flush();
    await write((s) => { s.items = [...s.items, row(3)]; });
    await write((s) => { s.items = s.items.filter((r: any) => r.id !== 1); });
    // （3.x は外している間は描かない。4.0 で外している間に描くかどうかは問わず、戻した後の一覧を確かめる）
    box.appendChild(ul);
    await flush();
    await flush();
    expect(ulRows()).toEqual(["2", "3"]);
    await write((s) => { s.items = [...s.items].reverse(); });
    expect(ulRows()).toEqual(["3", "2"]);
    await write((s) => { s.items = [...s.items, row(4)]; });
    expect(ulRows()).toEqual(["3", "2", "4"]);
    expect(texts(root, "ol > li")).toEqual(["3", "2", "4"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("描いた並びが空だった for も、消えている間に増えた行を描く", async () => {
    const errors = spyErrors();
    const { host, root, write } = await page(UL_IN_IF + OL, { showA: true, items: [] });
    await write((s) => { s.showA = false; });
    await write((s) => { s.items = rows(1, 2); });
    await write((s) => { s.showA = true; });
    expect(texts(root, "ul > li")).toEqual(["1", "2"]);
    await write((s) => { s.items = [...s.items].reverse(); });
    expect(texts(root, "ul > li")).toEqual(["2", "1"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });
});

describe("#320 消えている間の書き換えの綴りごとに、戻すと今の一覧を描き、その後の変更にも追従する", () => {
  type Case = readonly [title: string, edits: ((s: any) => void)[], expected: string[]];
  const cases: Case[] = [
    ["全置換（行オブジェクトを作り直す）", [(s) => { s.items = s.items.map((r: any) => ({ id: r.id * 10 })); }], ["10", "20", "30"]],
    ["行の差し替え（写して a[0] を置き換え、再代入）", [(s) => { const a = [...s.items]; a[0] = row(100); s.items = a; }], ["100", "2", "3"]],
    ["要素書き込み（items.0 に新しい行）", [(s) => { s["items.0"] = row(99); }], ["99", "2", "3"]],
    // 4.0 では入れ替えではなく 2 つの位置の値の置き換え（migration-v4 §3.4）。値と描画は 3.x と同じになる
    ["要素書き込みで items.0 と items.1 の値を入れ替える", [(s) => { const a = s["items.0"], b = s["items.1"]; s["items.0"] = b; s["items.1"] = a; }], ["2", "1", "3"]],
    ["削除", [(s) => { s.items = s.items.filter((r: any) => r.id !== 2); }], ["1", "3"]],
    ["並べ替え", [(s) => { s.items = [...s.items].reverse(); }], ["3", "2", "1"]],
    ["空にしてから足す", [(s) => { s.items = []; }, (s) => { s.items = [row(9)]; }], ["9"]],
  ];

  it.each(cases)("%s", async (_title, edits, expected) => {
    const errors = spyErrors();
    const { host, root, write } = await page(UL_IN_IF + OL, { showA: true, items: rows(1, 2, 3) });
    await write((s) => { s.showA = false; });
    for (const edit of edits) await write(edit);
    expect(texts(root, "ol > li")).toEqual(expected);
    await write((s) => { s.showA = true; });
    expect(texts(root, "ul > li")).toEqual(expected);
    await write((s) => { s.items = [...s.items].reverse(); });
    expect(texts(root, "ul > li")).toEqual([...expected].reverse());
    expect(texts(root, "ol > li")).toEqual([...expected].reverse());
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("消えている間に行を足してから要素書き込みをしても、戻すと今の一覧を描く", async () => {
    const errors = spyErrors();
    const { host, root, write } = await page(UL_IN_IF + OL, { showA: true, items: rows(1, 2, 3) });
    await write((s) => { s.showA = false; });
    await write((s) => { s.items = [...s.items, row(4)]; });
    await write((s) => { s["items.0"] = row(99); });
    await write((s) => { s.showA = true; });
    expect(texts(root, "ul > li")).toEqual(["99", "2", "3", "4"]);
    await write((s) => { s.items = [...s.items].reverse(); });
    expect(texts(root, "ul > li")).toEqual(["4", "3", "2", "99"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("消えている間に同じ配列へ別々のバッチで要素書き込みをしても、戻すと今の一覧を描く", async () => {
    const errors = spyErrors();
    const { host, root, write } = await page(UL_IN_IF + OL, { showA: true, items: rows(1, 2, 3) });
    await write((s) => { s.showA = false; });
    await write((s) => { s["items.0"] = row(91); });
    await write((s) => { s["items.2"] = row(93); });
    expect(texts(root, "ol > li")).toEqual(["91", "2", "93"]);
    await write((s) => { s.showA = true; });
    expect(texts(root, "ul > li")).toEqual(["91", "2", "93"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("消えている for が描いた配列インスタンスを戻してから要素書き込みをしても、戻すと今の一覧を描く", async () => {
    const errors = spyErrors();
    const { host, root, write } = await page(UL_IN_IF + OL, { showA: true, items: rows(1, 2, 3) });
    let original: unknown;
    await write((s) => { original = s.items; s.showA = false; });
    await write((s) => { s.items = [...s.items, row(4)]; });
    await write((s) => { s.items = original; });
    await write((s) => { s["items.0"] = row(99); });
    expect(texts(root, "ol > li")).toEqual(["99", "2", "3"]);
    await write((s) => { s.showA = true; });
    expect(texts(root, "ul > li")).toEqual(["99", "2", "3"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("hide / 全置換の繰り返し: 戻すたびに今の一覧を描き、ul の子ノードの数が増え続けない", async () => {
    const errors = spyErrors();
    const { host, root, write } = await page(UL_IN_IF + OL, { showA: true, items: rows(1, 2, 3) });
    const ul = () => root.querySelector("ul")!;
    let nextId = 100;
    const sizes: number[] = [];
    for (let cycle = 0; cycle < 5; cycle++) {
      await write((s) => { s.showA = false; });
      for (let k = 0; k < 5; k++) {
        await write((s) => { s.items = rows(nextId++, nextId++, nextId++); });
      }
      await write((s) => { s.showA = true; });
      expect(texts(ul(), "li"), `cycle ${cycle}`).toEqual(texts(root, "ol > li"));
      sizes.push(ul().childNodes.length);
    }
    expect(new Set(sizes).size).toBe(1);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });
});

describe("#320 入れ子のリスト: 消えている間に親や子の行が変わっても、戻すと子の行まで描く", () => {
  const GROUP_ROW = `<div class="g"><b>{{ .id }}</b><template data-wcs="for: .rows"><p>{{ .id }}</p></template></div>`;
  const GROUPS_IN_IF = `<div><template data-wcs="if: showA"><section class="a"><template data-wcs="for: groups">${GROUP_ROW}</template></section></template></div>`;
  const GROUPS = `<section class="b"><template data-wcs="for: groups">${GROUP_ROW}</template></section>`;
  const initial = () => ({ showA: true, groups: [{ id: 1, rows: rows(11, 12) }, { id: 2, rows: rows(21) }] });
  /** `1:11+12 2:21` の形（グループの id と、その子の id） */
  const view = (root: ParentNode, section: string) => Array.from(root.querySelectorAll(`section.${section} .g`))
    .map((group) => `${group.querySelector("b")!.textContent}:${texts(group, "p").join("+")}`)
    .join(" ");

  it("親の行を差し替え（写して g[0] を置き換え）、行の追加・子のリストの代入・並べ替えにも追従する", async () => {
    const errors = spyErrors();
    const { host, root, write } = await page(GROUPS_IN_IF + GROUPS, initial());
    await write((s) => { s.showA = false; });
    await write((s) => { const g = [...s.groups]; g[0] = { ...g[0], rows: [...g[0].rows, row(13)] }; s.groups = g; });
    expect(view(root, "b")).toBe("1:11+12+13 2:21");
    await write((s) => { s.showA = true; });
    expect(view(root, "a")).toBe("1:11+12+13 2:21");
    await write((s) => { s.groups = [...s.groups, { id: 3, rows: rows(31) }]; });
    expect(view(root, "a")).toBe("1:11+12+13 2:21 3:31");
    await write((s) => { s.showA = false; });
    await write((s) => { s.groups = [...s.groups, { id: 4, rows: rows(41) }]; });
    await write((s) => { s["groups.0.rows"] = [...s["groups.0.rows"], row(14)]; });
    await write((s) => { s.showA = true; });
    expect(view(root, "a")).toBe("1:11+12+13+14 2:21 3:31 4:41");
    await write((s) => { s.groups = [...s.groups].reverse(); });
    expect(view(root, "a")).toBe("4:41 3:31 2:21 1:11+12+13+14");
    expect(view(root, "b")).toBe("4:41 3:31 2:21 1:11+12+13+14");
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("親の要素書き込み・子の要素書き込み・要素書き込みでの親の値の入れ替えも、戻すと描く", async () => {
    const errors = spyErrors();
    const { host, root, write } = await page(GROUPS_IN_IF + GROUPS, initial());
    await write((s) => { s.showA = false; });
    await write((s) => { s["groups.0"] = { id: 9, rows: rows(91) }; });
    await write((s) => { s.showA = true; });
    expect(view(root, "a")).toBe("9:91 2:21");
    await write((s) => { s.showA = false; });
    await write((s) => { s["groups.1.rows.0"] = row(99); });
    await write((s) => { s.showA = true; });
    expect(view(root, "a")).toBe("9:91 2:99");
    await write((s) => { s.showA = false; });
    // 4.0 では 2 つの位置の値の置き換え（migration-v4 §3.4）
    await write((s) => { const a = s["groups.0"], b = s["groups.1"]; s["groups.0"] = b; s["groups.1"] = a; });
    await write((s) => { s.showA = true; });
    expect(view(root, "a")).toBe("2:99 9:91");
    expect(view(root, "b")).toBe("2:99 9:91");
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("消えている間に親の行を差し替えるのを繰り返しても、子の行は今の値どおり（子のノードが増え続けない）", async () => {
    const errors = spyErrors();
    const { host, root, write } = await page(
      `<div><template data-wcs="if: showA"><section class="a"><template data-wcs="for: groups">`
      + `<div class="g"><template data-wcs="for: .rows"><p>{{ .id }}</p></template></div></template></section></template></div>`
      + `<section class="b"><template data-wcs="for: groups">`
      + `<div class="g"><template data-wcs="for: .rows"><p>{{ .id }}</p></template></div></template></section>`,
      { showA: true, groups: [{ id: 1, rows: rows(11, 12) }, { id: 2, rows: rows(21) }] },
    );
    const sizes: string[] = [];
    for (let k = 0; k < 4; k++) {
      await write((s) => { s.showA = false; });
      await write((s) => { const g = [...s.groups]; g[0] = { ...g[0], rows: rows(100 + k, 200 + k) }; s.groups = g; });
      await write((s) => { s.showA = true; });
      expect(texts(root, "section.a p"), `round ${k}`).toEqual([String(100 + k), String(200 + k), "21"]);
      sizes.push(Array.from(root.querySelectorAll("section.a .g")).map((g) => g.childNodes.length).join(","));
    }
    expect(new Set(sizes).size).toBe(1);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("素の入れ子の for で親の行を何度も作り直しても（map-spread）、子の行は今の値どおり", async () => {
    const errors = spyErrors();
    const { host, root, write } = await page(
      `<template data-wcs="for: groups"><div class="g"><template data-wcs="for: .rows"><p>{{ .id }}</p></template></div></template>`,
      { groups: [{ id: 1, rows: rows(10, 20) }, { id: 2, rows: rows(30) }] },
    );
    const sizes: string[] = [];
    for (let round = 0; round < 3; round++) {
      await write((s) => { s.groups = s.groups.map((g: any) => ({ ...g })); });
      expect(texts(root, "p")).toEqual(["10", "20", "30"]);
      sizes.push(Array.from(root.querySelectorAll(".g")).map((g) => g.childNodes.length).join(","));
    }
    expect(new Set(sizes).size).toBe(1);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("入れ子の for で要素書き込みと値の入れ替えを重ねても、書き込みは書いた行のデータに入り、描画は状態どおり", async () => {
    const errors = spyErrors();
    const tags = (...values: number[]) => values.map((t) => ({ t }));
    const { host, root, write, read } = await page(
      `<div class="A"><template data-wcs="for: items"><section><b>{{ .id }}</b>:`
      + `<template data-wcs="for: .tags"><i>{{ .t }}</i></template></section></template></div>`,
      { items: [{ id: 110, tags: tags() }, { id: 100, tags: tags(109, 108) }, { id: 103, tags: tags(104) }] },
    );
    const data = () => read((s) => s.items.map((r: any) => `${r.id}:${r.tags.map((x: any) => x.t).join(",")}`).join("|"));
    await write((s) => { s["items.2"] = { id: 111, tags: tags(112) }; });
    await write((s) => { s["items.2.tags.0"] = { t: 113 }; });
    await write((s) => { const a = s["items.1"]; s["items.1"] = s["items.2"]; s["items.2"] = a; });
    await write((s) => { s["items.2"] = { id: 114, tags: tags(115) }; });
    await write((s) => { s["items.1.tags.0"] = { t: 116 }; });
    expect(data()).toBe("110:|111:116|114:115");
    expect(texts(root, "section")).toEqual(["110:", "111:116", "114:115"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });
});

describe("#320 対照: 基準を共有しない形", () => {
  it("for が 1 つだけなら、if で消している間の変更を戻したときに描く", async () => {
    const errors = spyErrors();
    const { host, root, write } = await page(UL_IN_IF, { showA: true, items: rows(1, 2) });
    await write((s) => { s.items = [...s.items, row(3)]; });
    await write((s) => { s.showA = false; });
    await write((s) => { s.items = [...s.items, row(4)]; });
    await write((s) => { s.showA = true; });
    expect(texts(root, "ul > li")).toEqual(["1", "2", "3", "4"]);
    await write((s) => { s.items = [...s.items].reverse(); });
    expect(texts(root, "ul > li")).toEqual(["4", "3", "2", "1"]);
    await write((s) => { s.showA = false; });
    await write((s) => { s["items.0"] = row(99); });
    await write((s) => { s.showA = true; });
    expect(texts(root, "ul > li")).toEqual(["99", "3", "2", "1"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("2 つとも if の外なら、どちらも毎回描かれて一覧に追従する", async () => {
    const errors = spyErrors();
    const { host, root, write } = await page(UL + OL, { items: rows(1, 2) });
    const both = () => [texts(root, "ul > li"), texts(root, "ol > li")];
    await write((s) => { s.items = [...s.items, row(3)]; });
    await write((s) => { s["items.0"] = row(99); });
    expect(both()).toEqual([["99", "2", "3"], ["99", "2", "3"]]);
    await write((s) => { s.items = [...s.items].reverse(); });
    await write((s) => { s.items = s.items.filter((r: any) => r.id !== 2); });
    expect(both()).toEqual([["3", "99"], ["3", "99"]]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });
});

// ================================================================ #335 / #337

const UL_IDX = `<ul><template data-wcs="for: items"><li><b>{{ .id }}</b><i>{{ $1 }}</i></li></template></ul>`;
const UL_IDX_PRIMITIVE = `<ul><template data-wcs="for: items"><li><b>{{ . }}</b><i>{{ $1 }}</i></li></template></ul>`;

type Page = Awaited<ReturnType<typeof page>>;
/** 描いた値・`$1`・状態を 1 度に見る */
const view = (p: Page, label: (item: any) => string = (item) => String(item.id)) => ({
  drawn: texts(p.root, "li > b"),
  rows: texts(p.root, "li > i"),
  state: p.read((s) => s.items.map(label)),
});
const expected = (...values: (string | number)[]) => ({
  drawn: values.map(String),
  rows: values.map((_, i) => String(i)),
  state: values.map(String),
});
const lis = (p: Page) => Array.from(p.root.querySelectorAll("li"));

describe("#335 同じバッチで一覧を置き換えてから要素に書き込む", () => {
  // 形 A（足してから行 0）と形 B（写しから行 1）は issues.test.ts「#335 …」にある
  it("置き換えた同じバッチで 2 つの位置の値を入れ替えても、描画・$1・状態が揃い、以後の並べ替えにも追従する", async () => {
    const errors = spyErrors();
    const p = await page(UL_IDX, { items: rows(1, 2, 3) });
    await p.write((s) => {
      s.items = [...s.items, row(4)];
      const first = s["items.0"];
      s["items.0"] = s["items.3"];
      s["items.3"] = first;
    });
    expect(view(p)).toEqual(expected(4, 2, 3, 1));
    await p.write((s) => { s.items = [...s.items].reverse(); });
    expect(view(p)).toEqual(expected(1, 3, 2, 4));
    expect(errors).not.toHaveBeenCalled();
    p.host.remove();
  });
});

let tagSeq = 0;
/** 出力専用のメンバー `status`（どのインスタンスも同じ値 "ready"） */
function defineOutputOnly(): string {
  const tag = `reg3x-listbase-out-${++tagSeq}`;
  customElements.define(tag, class extends HTMLElement {
    static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "status", event: `${tag}:status` }] };
    get status(): string { return "ready"; }
  });
  return tag;
}
/** 双方向のメンバー `value`（どのインスタンスも最初は "persisted"） */
function defineTwoWay(): string {
  const tag = `reg3x-listbase-store-${++tagSeq}`;
  customElements.define(tag, class extends HTMLElement {
    static wcBindable = {
      protocol: "wc-bindable", version: 1,
      properties: [{ name: "value", event: `${tag}:value-changed` }],
      inputs: [{ name: "value" }],
    };
    _value: unknown = "persisted";
    get value(): unknown { return this._value; }
    set value(v: unknown) {
      this._value = v;
      this.dispatchEvent(new CustomEvent(`${tag}:value-changed`, { detail: v }));
    }
  });
  return tag;
}
/** 出力専用のメンバー `status`。最初はどのインスタンスも `initial`、`report(v)` で自分の値を出す */
function defineReporter(initial: unknown): string {
  const tag = `reg3x-listbase-job-${++tagSeq}`;
  const reported = new WeakMap<HTMLElement, unknown>();
  customElements.define(tag, class extends HTMLElement {
    static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "status", event: `${tag}:status` }] };
    get status(): unknown { return reported.has(this) ? reported.get(this) : initial; }
    report(value: unknown): void {
      reported.set(this, value);
      this.dispatchEvent(new CustomEvent(`${tag}:status`, { detail: value }));
    }
  });
  return tag;
}
type Reporter = HTMLElement & { report(value: unknown): void };

const rowView = (p: Page) => ({
  li: p.root.querySelectorAll("li").length,
  index: texts(p.root, "i"),
  rows: p.read((s) => [...s.rows]),
});

describe("#337 行の要素が同じ値を行そのものへ書いても、一覧は壊れない", () => {
  // 出力専用メンバーを `status: .` / `status: rows.*` で束ねる形は issues.test.ts「#337 …」にある
  it("双方向メンバーを `value#init=element: .` で束ね、どの要素も同じ値を持っても、$1 が並び、縮めた行が消える", async () => {
    const tag = defineTwoWay();
    const errors = spyErrors();
    const p = await page(`<ul><template data-wcs="for: rows"><li><${tag} data-wcs="value#init=element: ."></${tag}><i>{{ $1 }}</i></li></template></ul>`, { rows: ["a", "b", "c"] });
    expect(rowView(p)).toEqual({ li: 3, index: ["0", "1", "2"], rows: ["persisted", "persisted", "persisted"] });
    await p.write((s) => { s.rows = ["x", "y"]; });
    expect(rowView(p)).toEqual({ li: 2, index: ["0", "1"], rows: ["persisted", "persisted"] });
    await p.write((s) => { s.rows = []; });
    expect(rowView(p)).toEqual({ li: 0, index: [], rows: [] });
    expect(errors).not.toHaveBeenCalled();
    p.host.remove();
  });

  it("行の中の要素を if: で後から出し、行を 1 つずつ足しても、$1 が並び、縮めた行が消える", async () => {
    const tag = defineOutputOnly();
    const errors = spyErrors();
    const p = await page(
      `<ul><template data-wcs="for: rows"><li><template data-wcs="if: show"><${tag} data-wcs="status: rows.*"></${tag}></template><i>{{ $1 }}</i></li></template></ul>`,
      { show: false, rows: ["a"] },
    );
    await p.write((s) => { s.show = true; });
    for (const r of ["b", "c"]) await p.write((s) => { s.rows = [...s.rows, r]; });
    expect(rowView(p)).toEqual({ li: 3, index: ["0", "1", "2"], rows: ["ready", "ready", "ready"] });
    await p.write((s) => { s.rows = ["x", "y"]; });
    expect(rowView(p)).toEqual({ li: 2, index: ["0", "1"], rows: ["ready", "ready"] });
    await p.write((s) => { s.rows = []; });
    expect(rowView(p)).toEqual({ li: 0, index: [], rows: [] });
    expect(errors).not.toHaveBeenCalled();
    p.host.remove();
  });
});

describe("#337 要素が自分の行へ出す値は、その行の値の更新", () => {
  async function mountJobs(initialRows: unknown[], tag: string, cell = `<span>{{ . }}</span>`) {
    const p = await page(`<ul><template data-wcs="for: rows"><li><${tag} data-wcs="status: ."></${tag}>${cell}<i>{{ $1 }}</i></li></template></ul>`, { rows: initialRows });
    await flush();
    const elements = Array.from(p.root.querySelectorAll(tag)) as Reporter[];
    const blocks = lis(p);
    /** 各要素がいまどの `<li>` にいるか */
    const positions = () => elements.map((element) => blocks.indexOf(element.closest("li")!));
    return { ...p, elements, blocks, positions };
  }

  it("同じ値から進む行の要素が 1 つずつ値を出しても、行は動かず、以後の出力も自分の行に届く", async () => {
    const errors = spyErrors();
    const tag = defineReporter("idle");
    const p = await mountJobs(["a", "b", "c", "d"], tag);
    expect(p.read((s) => [...s.rows])).toEqual(["idle", "idle", "idle", "idle"]);
    for (const element of p.elements) {
      element.report("done");
      await flush();
    }
    expect(p.read((s) => [...s.rows])).toEqual(["done", "done", "done", "done"]);
    expect(p.positions()).toEqual([0, 1, 2, 3]);
    expect(lis(p)).toEqual(p.blocks);
    expect(texts(p.root, "i")).toEqual(["0", "1", "2", "3"]);
    p.elements[0].report("error");
    await flush();
    expect(p.read((s) => [...s.rows])).toEqual(["error", "done", "done", "done"]);
    expect(texts(p.root, "span")).toEqual(["error", "done", "done", "done"]);
    expect(errors).not.toHaveBeenCalled();
    p.host.remove();
  });

  it("要素が別の行の値を出しても、その値は自分の行に着地し、別の要素の値も消えない", async () => {
    const errors = spyErrors();
    const tag = defineReporter("idle");
    const p = await mountJobs(["a", "b", "c"], tag);
    p.elements[0].report("b");
    await flush();
    p.elements[1].report("a");
    await flush();
    expect(p.read((s) => [...s.rows])).toEqual(["b", "a", "idle"]);
    expect(texts(p.root, "span")).toEqual(["b", "a", "idle"]);
    expect(p.positions()).toEqual([0, 1, 2]);
    expect(lis(p)).toEqual(p.blocks);
    expect(errors).not.toHaveBeenCalled();
    p.host.remove();
  });

  it("行の要素が同じオブジェクトから進んでも、行の下の束縛が自分の行の新しい値を映し、行は動かない", async () => {
    const errors = spyErrors();
    const idle = { name: "idle" };
    const done = { name: "done" };
    const tag = defineReporter(idle);
    const p = await mountJobs([{ name: "a" }, { name: "b" }, { name: "c" }], tag, `<b>{{ .name }}</b>`);
    expect(texts(p.root, "b")).toEqual(["idle", "idle", "idle"]);
    for (const element of p.elements) {
      element.report(done);
      await flush();
    }
    p.elements[0].report({ name: "error" });
    await flush();
    expect(texts(p.root, "b")).toEqual(["error", "done", "done"]);
    expect(p.read((s) => s.rows.map((r: any) => r.name))).toEqual(["error", "done", "done"]);
    expect(texts(p.root, "i")).toEqual(["0", "1", "2"]);
    expect(lis(p)).toEqual(p.blocks);
    expect(errors).not.toHaveBeenCalled();
    p.host.remove();
  });

  const typeInto = async (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    await flush();
  };

  it("プリミティブの一覧を input で編集し、別の行の値を打っても、入力中の欄は自分の行に留まる", async () => {
    const errors = spyErrors();
    const p = await page(`<ul><template data-wcs="for: tags"><li><input data-wcs="value: ."><i>{{ $1 }}</i></li></template></ul>`, { tags: ["ab", "a", "c"] });
    const inputs = Array.from(p.root.querySelectorAll("input"));
    await typeInto(inputs[0], "a"); // 行 1 と同じ値
    await typeInto(inputs[1], "ab"); // 3.x では入れ替えの後半と区別できなかった値
    expect(p.read((s) => [...s.tags])).toEqual(["a", "ab", "c"]);
    expect(Array.from(p.root.querySelectorAll("input"))).toEqual(inputs);
    expect(inputs.map((input) => input.value)).toEqual(["a", "ab", "c"]);
    expect(texts(p.root, "i")).toEqual(["0", "1", "2"]);
    expect(errors).not.toHaveBeenCalled();
    p.host.remove();
  });

  // 3.x: コードの書き込み（tags.1 = tags.0 → tags.0 = "z"）は入れ替えとして揃い、行 0 の欄が位置 1 へ動く。
  // 4.0 は要素の書き込みが位置の値の置き換えなので、どの欄も位置に留まる（migration-v4 §3.4）
  it("コードの書き込みの合間に行の要素が値を出しても、値は位置どおりで、欄はどれも自分の位置に留まる（4.0: 行は動かない）", async () => {
    const errors = spyErrors();
    const p = await page(`<ul><template data-wcs="for: tags"><li><input data-wcs="value: ."><i>{{ $1 }}</i></li></template></ul>`, { tags: ["a", "b", "c"] });
    const inputs = Array.from(p.root.querySelectorAll("input"));
    await p.write((s) => { s["tags.1"] = s["tags.0"]; });
    await typeInto(inputs[2], "b");
    await p.write((s) => { s["tags.0"] = "z"; });
    expect(p.read((s) => [...s.tags])).toEqual(["z", "a", "b"]);
    expect(Array.from(p.root.querySelectorAll("input"))).toEqual(inputs);
    expect(inputs.map((input) => input.value)).toEqual(["z", "a", "b"]);
    expect(texts(p.root, "i")).toEqual(["0", "1", "2"]);
    expect(errors).not.toHaveBeenCalled();
    p.host.remove();
  });
});

describe("#337 コードの要素書き込みの途中の読みと、同じ値を持つ行", () => {
  it("別の行の値を写した後、同じ位置へもう一度書くとその位置に着地し、途中の読みも位置どおり", async () => {
    const errors = spyErrors();
    const p = await page(UL_IDX, { items: rows(1, 2, 3) });
    const seen: unknown[] = [];
    await p.write((s) => {
      s["items.0"] = s["items.2"];
      seen.push(s["items.0"].id, s["items.2"].id);
      s["items.0"] = row(9);
      seen.push(s["items.0"].id, s["items.1"].id, s["items.2"].id);
    });
    expect(seen).toEqual([3, 3, 9, 2, 3]);
    expect(view(p)).toEqual(expected(9, 2, 3));
    expect(errors).not.toHaveBeenCalled();
    p.host.remove();
  });

  // 3.x では、配列を置き換えた後の 2 回目の入れ替えでブロックが値と一緒に動く。4.0 は行が位置に留まる（migration-v4 §3.4）
  it("同じ値を持つ行ができた並びで値を入れ替えても、描画・$1・状態は位置どおりで、行は位置に留まる", async () => {
    const errors = spyErrors();
    const p = await page(UL_IDX, { items: rows(1, 2, 3) });
    const blocks = lis(p);
    await p.write((s) => { s["items.1"] = s["items.0"]; });
    expect(view(p)).toEqual(expected(1, 1, 3));
    await p.write((s) => { const first = s["items.0"]; s["items.0"] = s["items.2"]; s["items.2"] = first; });
    expect(view(p)).toEqual(expected(3, 1, 1));
    expect(lis(p)).toEqual(blocks);
    await p.write((s) => { s.items = [...s.items].reverse(); });
    expect(view(p)).toEqual(expected(1, 1, 3));
    const reversed = lis(p);
    await p.write((s) => { const first = s["items.0"]; s["items.0"] = s["items.2"]; s["items.2"] = first; });
    expect(view(p)).toEqual(expected(3, 1, 1));
    expect(lis(p)).toEqual(reversed);
    expect(errors).not.toHaveBeenCalled();
    p.host.remove();
  });

  it("同じオブジェクトを 2 つ持つ並びで値を入れ替えても、描画・$1・状態は位置どおり", async () => {
    const errors = spyErrors();
    const shared = row(1);
    const p = await page(UL_IDX, { items: [shared, shared, row(2)] });
    const blocks = lis(p);
    await p.write((s) => { const first = s["items.0"]; s["items.0"] = s["items.2"]; s["items.2"] = first; });
    expect(view(p)).toEqual(expected(2, 1, 1));
    // 3.x: ブロックが値と一緒に動く（[2], [1], [0]）。4.0 は位置に留まる（migration-v4 §3.4）
    expect(lis(p)).toEqual(blocks);
    expect(errors).not.toHaveBeenCalled();
    p.host.remove();
  });

  it("片側だけを書いたまま一覧を置き換えても表示が状態と一致し、後の書き込みも位置どおり", async () => {
    const errors = spyErrors();
    const p = await page(UL_IDX, { items: rows(1, 2, 3) });
    const blocks = lis(p);
    let first: unknown;
    await p.write((s) => { first = s["items.0"]; s["items.0"] = s["items.2"]; });
    expect(view(p)).toEqual(expected(3, 2, 3));
    await p.write((s) => { s.items = [...s.items, row(4)]; });
    expect(view(p)).toEqual(expected(3, 2, 3, 4));
    await p.write((s) => { s["items.2"] = first; });
    expect(view(p)).toEqual(expected(3, 2, 1, 4));
    expect(lis(p).slice(0, 3)).toEqual(blocks);
    expect(errors).not.toHaveBeenCalled();
    p.host.remove();
  });

  // 3.x: 揃うと 4 と 3 の行のブロックが入れ替わる（[0], [1], [3], [2]）。4.0 は位置に留まる（migration-v4 §3.4）
  it("新しい値と写しを混ぜて書いても、各バッチで描画・$1・状態が位置どおり", async () => {
    const errors = spyErrors();
    const p = await page(UL_IDX, { items: rows(1, 2, 3, 4) });
    const blocks = lis(p);
    let four: unknown;
    await p.write((s) => {
      four = s["items.3"];
      s["items.3"] = s["items.2"];
      s["items.0"] = row(9);
      s["items.1"] = row(8);
    });
    expect(view(p)).toEqual(expected(9, 8, 3, 3));
    expect(lis(p)).toEqual(blocks);
    await p.write((s) => { s["items.2"] = four; });
    expect(view(p)).toEqual(expected(9, 8, 4, 3));
    expect(lis(p)).toEqual(blocks);
    expect(errors).not.toHaveBeenCalled();
    p.host.remove();
  });
});

// ================================================================ #359

describe("#359 要素の書き込みで値が替わった行のあとで前の配列へ戻しても、行は状態どおりの値を映す", () => {
  // Issue の手順・プリミティブ・控えを取る形・filter を挟む形は issues-lists.test.ts「#359 …」にある
  it("戻した配列から書き込み後の配列へもう一度戻しても位置どおりに描かれ、$watch(\"items.*\") は値が替わった位置で呼ばれる", async () => {
    const errors = spyErrors();
    const watched: unknown[] = [];
    const p = await page(UL_IDX, {
      items: rows(1, 2, 3),
      $watch: { "items.*"(current: any, _previous: unknown, index: number) { watched.push([current.id, index]); } },
    });
    let saved: unknown;
    let unsettled: unknown;
    let first: unknown;
    await p.write((s) => { saved = s.items; s.items = [...s.items, row(4)]; unsettled = s.items; });
    await p.write((s) => { first = s["items.0"]; s["items.0"] = s["items.2"]; });
    expect(view(p)).toEqual(expected(3, 2, 3, 4));
    watched.length = 0;

    await p.write((s) => { s.items = saved; });
    expect(view(p)).toEqual(expected(1, 2, 3));
    expect(watched).toEqual([[1, 0]]);
    watched.length = 0;

    await p.write((s) => { s.items = unsettled; });
    expect(view(p)).toEqual(expected(3, 2, 3, 4));
    // 3.x は [[3, 0], [4, 3]]（行は配列ごとの台帳に属し、書き込み後の配列の行 0 が「その場で 3 を映す行」として戻る）。
    // 4.0 は行を値の同一性で前から順に突き合わせ（src/list.ts reconcile）、全体の代入では「一覧に入った行」だけが
    // 着地する（src/temporal/watch.ts の冒頭）: 位置 0 の 3 は 1, 2, 3 の行 3 を引き継ぎ、位置 2 の 3 が新しい行になる
    expect(watched).toEqual([[3, 2], [4, 3]]);
    watched.length = 0;

    await p.write((s) => { s["items.2"] = first; });
    expect(view(p)).toEqual(expected(3, 2, 1, 4));
    expect(watched).toEqual([[1, 2]]);
    expect(errors).not.toHaveBeenCalled();
    p.host.remove();
  });

  it("行の中の input が自分の行へ書いた後で前の配列へ戻しても、戻した配列の値が描かれる", async () => {
    const errors = spyErrors();
    const p = await page(`<ul><template data-wcs="for: items"><li><input data-wcs="value: ."><span>{{ . }}</span></li></template></ul>`, { items: ["a", "b", "c"] });
    let saved: unknown;
    await p.write((s) => { saved = s.items; s.items = [...s.items, "d"]; });
    const input = p.root.querySelector("input") as HTMLInputElement;
    input.value = "x";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    await flush();
    expect(texts(p.root, "span")).toEqual(["x", "b", "c", "d"]);
    await p.write((s) => { s.items = saved; });
    expect(p.read((s) => [...s.items])).toEqual(["a", "b", "c"]);
    expect(texts(p.root, "span")).toEqual(["a", "b", "c"]);
    expect(Array.from(p.root.querySelectorAll("input")).map((element) => element.value)).toEqual(["a", "b", "c"]);
    expect(errors).not.toHaveBeenCalled();
    p.host.remove();
  });

  it("配列をそのまま返す getter の for も、前の配列へ戻すと戻した値を描く", async () => {
    const errors = spyErrors();
    const p = await page(UL + `<ol><template data-wcs="for: view"><li>{{ .id }}</li></template></ol>`, {
      items: rows(1, 2, 3),
      get view() { return (this as any).items; },
    });
    let saved: unknown;
    await p.write((s) => { saved = s.items; s.items = [...s.items, row(4)]; });
    await p.write((s) => { s["items.0"] = s["items.2"]; });
    expect(texts(p.root, "ul > li")).toEqual(["3", "2", "3", "4"]);
    expect(texts(p.root, "ol > li")).toEqual(["3", "2", "3", "4"]);
    await p.write((s) => { s.items = saved; });
    expect(texts(p.root, "ul > li")).toEqual(["1", "2", "3"]);
    expect(texts(p.root, "ol > li")).toEqual(["1", "2", "3"]);
    await p.write((s) => { s["items.1"] = row(9); });
    expect(texts(p.root, "ul > li")).toEqual(["1", "9", "3"]);
    expect(texts(p.root, "ol > li")).toEqual(["1", "9", "3"]);
    expect(errors).not.toHaveBeenCalled();
    p.host.remove();
  });

  it("別々の配列からそれぞれ要素の書き込みをした 2 つの一覧を、同じバッチで同じ前の配列へ戻しても、どちらも戻した値を描く", async () => {
    const errors = spyErrors();
    const saved = rows(1, 2);
    const p = await page(
      `<ul class="a"><template data-wcs="for: a"><li>{{ .id }}</li></template></ul>`
      + `<ul class="b"><template data-wcs="for: b"><li>{{ .id }}</li></template></ul>`,
      { a: saved, b: saved },
    );
    const both = () => [texts(p.root, "ul.a > li"), texts(p.root, "ul.b > li")];
    await p.write((s) => { s.a = [...s.a, row(3)]; s.b = [...s.b, row(4)]; });
    await p.write((s) => { s["a.0"] = s["a.1"]; s["b.1"] = s["b.0"]; });
    expect(both()).toEqual([["2", "2", "3"], ["1", "1", "4"]]);
    await p.write((s) => { s.a = saved; s.b = saved; });
    expect(both()).toEqual([["1", "2"], ["1", "2"]]);
    // 同じ配列を持つ 2 つの一覧: 片方を通した要素の書き込みは、もう片方にも出る
    await p.write((s) => { s["a.1"] = row(9); });
    expect(both()).toEqual([["1", "9"], ["1", "9"]]);
    expect(p.read((s) => s.b.map((r: any) => r.id))).toEqual([1, 9]);
    expect(errors).not.toHaveBeenCalled();
    p.host.remove();
  });
});

// ================================================================ #361

describe("#361 要素の書き込みを 2 つ以上のバッチに分けても、$watch は書いた位置で、その位置の prev で呼ばれる", () => {
  // オブジェクトの一覧の 2 バッチ（items.*）と 1 バッチの対照は issues-lists.test.ts「#361 …」、
  // プリミティブの 2 バッチ（揃えるバッチで 2 つ書く）は issues2-lists.test.ts「#380 …」にある
  it("行の下のパスの $watch(\"items.*.id\") も書いた位置で呼ばれる", async () => {
    const errors = spyErrors();
    const watched: unknown[] = [];
    const p = await page(UL_IDX, {
      items: rows(1, 2, 3),
      $watch: { "items.*.id"(current: unknown, _previous: unknown, index: number) { watched.push([current, index]); } },
    });
    let first: unknown;
    await p.write((s) => { first = s["items.0"]; s["items.0"] = s["items.2"]; });
    expect(watched).toEqual([[3, 0]]);
    watched.length = 0;
    await p.write((s) => { s["items.2"] = first; });
    expect(watched).toEqual([[1, 2]]);
    expect(view(p)).toEqual(expected(3, 2, 1));
    expect(errors).not.toHaveBeenCalled();
    p.host.remove();
  });

  it("プリミティブの一覧: 2 つ目のバッチの prev は書いた位置のバッチ前の値", async () => {
    const errors = spyErrors();
    const watched: unknown[] = [];
    const p = await page(UL_IDX_PRIMITIVE, {
      items: ["a", "b", "c"],
      $watch: { "items.*"(current: unknown, previous: unknown, index: number) { watched.push([current, previous, index]); } },
    });
    let first: unknown;
    await p.write((s) => { first = s["items.0"]; s["items.0"] = s["items.2"]; });
    expect(watched).toEqual([["c", "a", 0]]);
    watched.length = 0;
    await p.write((s) => { s["items.2"] = first; });
    expect(view(p, String)).toEqual(expected("c", "b", "a"));
    expect(watched).toEqual([["a", "c", 2]]);
    expect(errors).not.toHaveBeenCalled();
    p.host.remove();
  });

  // 3.x: 揃うとブロックが値と一緒に動く（[2], [0], [1]）。4.0 は位置に留まる（migration-v4 §3.4）
  it("3 つのバッチに分けた巡回でも、各バッチは書いた位置で呼ばれ、描画・$1 は位置どおり", async () => {
    const errors = spyErrors();
    const watched: unknown[] = [];
    const p = await page(UL_IDX_PRIMITIVE, {
      items: ["a", "b", "c"],
      $watch: { "items.*"(current: unknown, previous: unknown, index: number) { watched.push([current, previous, index]); } },
    });
    const blocks = lis(p);
    await p.write((s) => { s["items.0"] = "c"; });
    await p.write((s) => { s["items.1"] = "a"; });
    expect(watched).toEqual([["c", "a", 0], ["a", "b", 1]]);
    watched.length = 0;
    await p.write((s) => { s["items.2"] = "b"; });
    expect(watched).toEqual([["b", "c", 2]]);
    expect(view(p, String)).toEqual(expected("c", "a", "b"));
    expect(lis(p)).toEqual(blocks);
    expect(errors).not.toHaveBeenCalled();
    p.host.remove();
  });
});

describe("#361 1 つのバッチで、前の位置の値を写してから新しい値を書く", () => {
  const byIndex = (seen: unknown[]) => [...(seen as unknown[][])].sort((a, b) => (a[a.length - 1] as number) - (b[b.length - 1] as number));

  it("前の位置の値を写してから、その位置へ新しい値を書く: 書いた 2 つの位置で呼ばれる", async () => {
    const errors = spyErrors();
    const watched: unknown[] = [];
    const p = await page(UL_IDX, {
      items: rows(1, 2, 3),
      $watch: { "items.*"(current: any, _previous: unknown, index: number) { watched.push([current.id, index]); } },
    });
    await p.write((s) => { s["items.1"] = s["items.0"]; s["items.0"] = row(9); });
    expect(view(p)).toEqual(expected(9, 1, 3));
    expect(byIndex(watched)).toEqual([[9, 0], [1, 1]]);
    watched.length = 0;
    await p.write((s) => { s["items.2"] = s["items.0"]; s["items.0"] = row(8); });
    expect(view(p)).toEqual(expected(8, 1, 9));
    expect(byIndex(watched)).toEqual([[8, 0], [9, 2]]);
    expect(errors).not.toHaveBeenCalled();
    p.host.remove();
  });

  it("プリミティブ: 同じ値を写してから別の位置へ新しい値を書く", async () => {
    const errors = spyErrors();
    const watched: unknown[] = [];
    const p = await page(UL_IDX_PRIMITIVE, {
      items: ["0", "1", "2", "1"],
      $watch: { "items.*"(current: unknown, _previous: unknown, index: number) { watched.push([current, index]); } },
    });
    await p.write((s) => { s["items.0"] = "1"; s["items.3"] = "3"; });
    expect(p.read((s) => [...s.items])).toEqual(["1", "1", "2", "3"]);
    expect(view(p, String)).toEqual(expected("1", "1", "2", "3"));
    expect(byIndex(watched)).toEqual([["1", 0], ["3", 3]]);
    expect(errors).not.toHaveBeenCalled();
    p.host.remove();
  });
});

describe("#361 同じバッチで一覧を代入してから、途中の配列にだけ居た行が消えても、$watch は投げずにいまの並びの位置で呼ばれる", () => {
  const cases: [string, unknown[], string, (s: any) => void, unknown[]][] = [
    ["途中の配列で要素を書き、空にする", rows(1, 2), UL_IDX,
      (s) => { s.items = s.items.filter((_: unknown, k: number) => k !== 1); s["items.0"] = row(10); s.items = []; }, []],
    ["途中の配列で行を足し、置き換えてから要素を書く", ["0", "1", "2"], UL_IDX_PRIMITIVE,
      (s) => { s.items = [...s.items, "3"]; s.items = ["2"]; s["items.0"] = "1"; }, [["1", 0]]],
    ["途中の配列で行を足し、先頭を取り除く", rows(1, 2), UL_IDX,
      (s) => { s.items = [...s.items, row(3)]; s.items = s.items.filter((_: unknown, k: number) => k !== 0); }, [[3, 1]]],
  ];
  it.each(cases)("%s", async (_name, items, markup, fn, landed) => {
    const errors = spyErrors();
    const watched: unknown[] = [];
    const p = await page(markup, {
      items,
      $watch: { "items.*"(current: any, _previous: unknown, index: number) { watched.push([typeof current === "object" ? current.id : current, index]); } },
    });
    await p.write(fn);
    expect(errors).not.toHaveBeenCalled();
    expect(watched).toEqual(landed);
    p.host.remove();
  });
});

describe("#361 修理の続きで直った古い欠陥", () => {
  it("入れ子のリストを持つ行を要素の書き込みで置き換えると、$watch(\"groups.*.items.*\") が新しい内側の行で呼ばれる", async () => {
    const errors = spyErrors();
    const calls: unknown[] = [];
    const p = await page(
      `<template data-wcs="for: groups"><div class="group">`
      + `<template data-wcs="for: .items"><i class="item">{{ . }}</i></template></div></template>`,
      {
        groups: [{ items: ["a", "b"] }, { items: ["c"] }],
        $watch: { "groups.*.items.*"(current: unknown, _previous: unknown, ...indexes: number[]) { calls.push([current, ...indexes]); } },
      },
    );
    await p.write((s) => { s["groups.0"] = { items: ["p", "q"] }; });
    expect(texts(p.root, ".item")).toEqual(["p", "q", "c"]);
    expect(calls).toEqual([["p", 0, 0], ["q", 0, 1]]);
    expect(errors).not.toHaveBeenCalled();
    p.host.remove();
  });

  // 3.x #361 の修正の形が 4.0 で再現しない: setter が書いてから投げると、その書き込みが知らされない
  // （実測: 状態は 1, 9, 3 だが <li> は 1, 2, 3、$watch は呼ばれず、以後の書き込みでも行 1 は 2 のまま /
  // 期待: <li> は 1, 9, 3、$watch は [[9, 1]]）。src/engine.ts の write() が callAt(p.setter) の後の landed() を
  // try/finally で守っていない
  it.fails("要素のパスの setter が書いてから投げても、書いた値は描かれ、$watch も呼ばれる", async () => {
    const watched: unknown[] = [];
    const p = await page(`<ul><template data-wcs="for: items"><li>{{ .id }}</li></template></ul>`, {
      items: rows(1, 2, 3),
      get "items.*"() { return (this as any).items[(this as any).$1]; },
      set "items.*"(value: any) {
        (this as any).items[(this as any).$1] = value;
        if (value.id === 9) throw new Error("rejected after write");
      },
      $watch: { "items.*"(current: any, _previous: unknown, index: number) { watched.push([current.id, index]); } },
    });
    expect(() => p.el.createState("writable", (s: any) => { s["items.1"] = row(9); })).toThrow("rejected after write");
    await flush();
    await flush();
    expect(texts(p.root, "li")).toEqual(["1", "9", "3"]);
    expect(watched).toEqual([[9, 1]]);
    p.host.remove();
  });

  it("$setAll(\"items.*\") は、写しや入れ替えの書き込みが残る一覧でも全部の位置に書く", async () => {
    const errors = spyErrors();
    const p = await page(UL_IDX, { items: rows(1, 3) });
    await p.write((s) => { s.items = [...s.items, row(100)]; s["items.2"] = s["items.0"]; });
    await p.write((s) => { const first = s["items.0"]; s["items.0"] = s["items.1"]; s["items.1"] = first; });
    expect(view(p)).toEqual(expected(3, 1, 1));
    await p.write((s) => { s["items.2"] = s["items.0"]; s.$setAll("items.*", [], row(9)); });
    expect(view(p)).toEqual(expected(9, 9, 9));
    expect(errors).not.toHaveBeenCalled();
    p.host.remove();
  });
});

// ================================================================ #335 / #337 / #359 fuzz

describe("#335 #337 #359 要素の書き込みと一覧の置き換えの決定的なランダム差分（seed 固定）", () => {
  const SEEDS = 6;
  const STEPS = 25;

  function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  type Variant = "object" | "objectWithIf" | "primitive";
  const ROW = (value: string) => `<li><b>{{ ${value} }}</b><i>{{ $1 }}</i></li>`;
  const MARKUP: Record<Variant, string> = {
    object: `<ul><template data-wcs="for: items">${ROW(".id")}</template></ul>`,
    objectWithIf: `<ul><template data-wcs="for: items">${ROW(".id")}</template></ul>`
      + `<div><template data-wcs="if: show"><ol><template data-wcs="for: items">${ROW(".id")}</template></ol></template></div>`,
    primitive: `<ul><template data-wcs="for: items">${ROW(".")}</template></ul>`,
  };
  type Op = (s: any) => void;

  async function runSeed(variant: Variant, seed: number): Promise<string[]> {
    const random = rng(seed * 7919 + variant.length);
    const int = (n: number) => Math.floor(random() * n);
    let nextId = 100;
    const newValue = (): unknown => variant === "primitive" ? int(4) : { id: nextId++ };
    const label = (value: any): string => String(variant === "primitive" ? value : value.id);
    const initial = variant === "primitive" ? { items: [0, 1, 2, 1] } : { show: true, items: rows(1, 2, 3) };

    // 同じ操作を素の配列に当てるモデル（`s["items.3"]` は items[3]）
    const model: any = { show: true, items: [...initial.items] };
    const modelProxy = new Proxy({}, {
      get: (_t, key: string) => { const m = /^items\.(\d+)$/.exec(key); return m ? model.items[+m[1]] : model[key]; },
      set: (_t, key: string, value) => {
        const m = /^items\.(\d+)$/.exec(key);
        if (m) model.items[+m[1]] = value; else model[key] = value;
        return true;
      },
    });
    // 控えた配列（keep）とその長さ。戻す（restore）ときは、モデルも状態も自分の側で控えた配列そのものを代入する
    const kept = { model: [] as unknown[][], state: [] as unknown[][] };
    const keptLengths: number[] = [];
    const keptOf = (s: any): unknown[][] => s === modelProxy ? kept.model : kept.state;

    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(String((args[0] as Error)?.message ?? args[0])); });
    const p = await page(MARKUP[variant], initial);
    const failures: string[] = [];
    try {
      for (let step = 0; step < STEPS && failures.length === 0; step++) {
        const names: string[] = [];
        const ops: Op[] = [];
        let length: number = model.items.length;
        for (let k = 1 + int(3); k > 0; k--) {
          const kind = int(variant === "objectWithIf" ? 13 : 12);
          if (kind <= 2 && length > 0) {
            const i = int(length);
            const value = newValue();
            names.push(`set ${i}=${label(value)}`);
            ops.push((s) => { s[`items.${i}`] = value; });
          } else if (kind <= 4 && length > 1) {
            const i = int(length);
            const j = int(length);
            names.push(`swap ${i},${j}`);
            ops.push((s) => { const a = s[`items.${i}`]; s[`items.${i}`] = s[`items.${j}`]; s[`items.${j}`] = a; });
          } else if (kind === 5 && length > 1) {
            const i = int(length);
            const j = int(length);
            names.push(`copy ${j}->${i}`);
            ops.push((s) => { s[`items.${i}`] = s[`items.${j}`]; });
          } else if (kind === 6) {
            const value = newValue();
            names.push("push");
            ops.push((s) => { s.items = [...s.items, value]; });
            length++;
          } else if (kind === 7) {
            names.push("same");
            ops.push((s) => { s.items = [...s.items]; });
          } else if (kind === 8) {
            names.push("reverse");
            ops.push((s) => { s.items = [...s.items].reverse(); });
          } else if (kind === 9 && length > 0) {
            const i = int(length);
            names.push(`remove ${i}`);
            ops.push((s) => { s.items = s.items.filter((_: unknown, k2: number) => k2 !== i); });
            length--;
          } else if (kind === 10) {
            const values = int(4) === 0 ? [] : Array.from({ length: int(5) }, newValue);
            names.push(`replace ${values.length}`);
            ops.push((s) => { s.items = [...values]; });
            length = values.length;
          } else if (kind === 11 && keptLengths.length > 0 && int(2) === 0) {
            const j = int(keptLengths.length);
            names.push(`restore ${j}`);
            ops.push((s) => { s.items = keptOf(s)[j]; });
            length = keptLengths[j];
          } else if (kind === 11) {
            names.push(`keep ${keptLengths.length}`);
            ops.push((s) => { keptOf(s).push(s.items); });
            keptLengths.push(length);
          } else if (kind === 12) {
            names.push("toggle");
            ops.push((s) => { s.show = !s.show; });
          }
        }
        for (const op of ops) op(modelProxy);
        await p.write((s: any) => { for (const op of ops) op(s); });

        const want: string[] = model.items.map(label);
        const state: string[] = p.read((s) => s.items.map(label));
        const where = `${variant} seed ${seed} step ${step} [${names.join("; ")}]`;
        if (state.join() !== want.join()) failures.push(`${where}: state ${state} / model ${want}`);
        const lists = variant === "objectWithIf" && model.show ? ["ul", "ol"] : ["ul"];
        for (const list of lists) {
          const listRows = Array.from(p.root.querySelectorAll(`${list} > li`));
          const drawn = listRows.map((li) => li.querySelector("b")?.textContent);
          const indexes = listRows.map((li) => li.querySelector("i")?.textContent);
          if (drawn.join() !== state.join() || indexes.join() !== state.map((_: unknown, i: number) => i).join()) {
            failures.push(`${where}: <${list}> ${drawn} ($1 ${indexes}) / state ${state}`);
          }
        }
        if (errors.length > 0) failures.push(`${where}: ${errors[0].slice(0, 160)}`);
      }
    } finally {
      spy.mockRestore();
      p.host.remove();
    }
    return failures;
  }

  it.each<Variant>(["object", "objectWithIf", "primitive"])("%s: 状態がモデルと、描画と行の添字が状態と一致し、エラーが出ない", async (variant) => {
    const failures: string[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) failures.push(...await runSeed(variant, seed));
    expect(failures).toEqual([]);
  }, 30000);
});

// ================================================================ #392

const mk = (n: number) => ({ n, it: [{ v: n * 10 + 1 }], it2: [{ v: n * 10 + 5 }] });
const TWO_FORS =
  `<template data-wcs="for: rows"><div class="r"><template data-wcs="for: .it"><i>{{ .v }}</i></template>`
  + `<template data-wcs="for: .it2"><u>{{ .v }}</u></template></div></template>`;
/** 行ごとの中身（`<i>` / `<u>` / `<s>` の文字を並べる）: `91+95` の形 */
const rowsView = (root: ParentNode, selector: string): string[] => Array.from(root.querySelectorAll(selector))
  .map((r) => Array.from(r.children).map((child) => child.textContent).join("+"));

describe("#392 行の中で for: の後ろに並ぶ for: / if: は、前の for: が行を全部外しても消えない", () => {
  it("先頭を消してから先頭に足した行で、2 つ目の for も描き、その後の書き込みにも追従する", async () => {
    const errors = spyErrors();
    const { host, root, write } = await page(TWO_FORS, { rows: [0, 1, 2, 3].map(mk) });
    await write((s) => { s.rows = s.rows.slice(1); });
    expect(rowsView(root, ".r")).toEqual(["11+15", "21+25", "31+35"]);
    await write((s) => { s.rows = [mk(9), ...s.rows]; });
    expect(rowsView(root, ".r")).toEqual(["91+95", "11+15", "21+25", "31+35"]);
    await write((s) => { s["rows.0.it2"] = [{ v: 96 }, { v: 97 }]; });
    expect(rowsView(root, ".r")[0]).toBe("91+96+97");
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("消した後に中へ挿した行・同じバッチで消して足した行・丸ごとの置き換えでも、2 つ目の for を描く", async () => {
    const errors = spyErrors();
    const { host, root, write } = await page(TWO_FORS, { rows: [0, 1, 2, 3].map(mk) });
    await write((s) => { s.rows = s.rows.slice(1); });
    await write((s) => { const r = [...s.rows]; r.splice(1, 0, mk(9)); s.rows = r; });
    expect(rowsView(root, ".r")).toEqual(["11+15", "91+95", "21+25", "31+35"]);
    await write((s) => { s.rows = [mk(8), ...s.rows.slice(1)]; });
    expect(rowsView(root, ".r")).toEqual(["81+85", "91+95", "21+25", "31+35"]);
    await write((s) => { s.rows = [4, 5].map(mk); });
    expect(rowsView(root, ".r")).toEqual(["41+45", "51+55"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("内側の for の後ろが if でも、先頭を消してから足した行で if の枝を描く", async () => {
    const errors = spyErrors();
    const mkF = (n: number) => ({ n, f: true, it: [{ v: n * 10 + 1 }] });
    const { host, root, write } = await page(
      `<template data-wcs="for: rows"><div class="r"><template data-wcs="for: .it"><i>{{ .v }}</i></template>`
      + `<template data-wcs="if: .f"><s>F</s></template></div></template>`,
      { rows: [0, 1, 2].map(mkF) },
    );
    await write((s) => { s.rows = s.rows.slice(1); });
    await write((s) => { s.rows = [mkF(9), ...s.rows]; });
    expect(rowsView(root, ".r")).toEqual(["91+F", "11+F", "21+F"]);
    await write((s) => { s["rows.0.f"] = false; });
    expect(rowsView(root, ".r")[0]).toBe("91");
    await write((s) => { s["rows.0.f"] = true; });
    expect(rowsView(root, ".r")[0]).toBe("91+F");
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("入れ子の深さ 3 で内側の行を消して足しても、兄弟の for を描く", async () => {
    const errors = spyErrors();
    const mkG = (n: number) => ({ n, g: [mk(n), mk(n + 50)] });
    const { host, root, write } = await page(
      `<template data-wcs="for: rows"><section><template data-wcs="for: .g"><div class="r">`
      + `<template data-wcs="for: .it"><i>{{ .v }}</i></template><template data-wcs="for: .it2"><u>{{ .v }}</u></template>`
      + `</div></template></section></template>`,
      { rows: [0, 1].map(mkG) },
    );
    await write((s) => { s.rows = s.rows.map((r: any) => ({ ...r, g: r.g.slice(1) })); });
    await write((s) => { s.rows = s.rows.map((r: any, i: number) => ({ ...r, g: [mk(90 + i), ...r.g] })); });
    expect(rowsView(root, ".r")).toEqual(["901+905", "501+505", "911+915", "511+515"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("if で隠している間に前のリストを空にしてから戻しても、後ろの兄弟の for の行が残り、以後も両方が書き込みに追従する", async () => {
    const errors = spyErrors();
    const { host, root, write } = await page(
      `<template data-wcs="if: show"><div class="r"><template data-wcs="for: a"><i>{{ .v }}</i></template>`
      + `<template data-wcs="for: b"><u>{{ .v }}</u></template></div></template>`,
      { show: true, a: [{ v: 1 }], b: [{ v: 2 }] },
    );
    await write((s) => { s.show = false; });
    await write((s) => { s.a = []; });
    await write((s) => { s.show = true; });
    expect(rowsView(root, ".r")).toEqual(["2"]);
    await write((s) => { s.a = [{ v: 3 }]; s.b = [{ v: 4 }, { v: 5 }]; });
    expect(rowsView(root, ".r")).toEqual(["3+4+5"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("対照: 親の中身が for だけなら、先頭を消してから足した行も描く", async () => {
    const errors = spyErrors();
    const mk1 = (n: number) => ({ n, it: [{ v: n * 10 + 1 }, { v: n * 10 + 2 }] });
    const { host, root, write } = await page(
      `<template data-wcs="for: rows"><div class="r"><template data-wcs="for: .it"><i>{{ .v }}</i></template></div></template>`,
      { rows: [0, 1, 2].map(mk1) },
    );
    await write((s) => { s.rows = s.rows.slice(1); });
    await write((s) => { s.rows = [mk1(9), ...s.rows]; });
    expect(rowsView(root, ".r")).toEqual(["91+92", "11+12", "21+22"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });
});
