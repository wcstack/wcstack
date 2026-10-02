/**
 * integration.markupIndexPath.test.ts — マークアップに書いた数値添字のパス（`textContent: items.0.v`、
 * `{{ items.1.v }}`、行 getter の `items.0.double`）が、state のコードの `this["items.0.v"]` と同じ
 * 「いま 0 番目にある行の `v`」を表し、その行への書き込みに追従する（#332）。
 *
 * 修正前: 束縛のパスは `getPathInfo` が `*` だけをワイルドカードとして扱うので、`items.0.v` は行を
 * 持たない素のパスとして台帳に載っていた。`this["items.0.v"] = …` は `items.*.v` ＋ 行 0 のアドレスへ
 * 通知されるので届かず、初期表示のまま止まった（一覧の丸ごと置換だけが素のパスの親として届いた）。
 * 行 getter を数値添字で書いた束縛は初期表示から空で、`wcs/binding-path-missing` が出た。
 *
 * いまは数値添字の束縛を暗黙の getter にする（src/address/indexPathAccessor.ts）。読みは解決済みの
 * アドレスで行い、依存は getter と同じ動的な辺で張る。対象は数値の区切りがちょうど 1 つのパスで、
 * 2 つ以上のパス・拡張できない state・作者の同名キーは修正前と同じ素のパスのまま。要素の書き込みの
 * 経路（swap 経路に載せるか）は変えない。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { defineIndexPathAccessor, isIndexPath } from "../src/address/indexPathAccessor";
import { Ssr } from "../src/ssr/Ssr";
import { flush, makeMount, read, write, writeCount } from "./helpers/recursionTestUtils";

beforeAll(() => {
  bootstrapState();
});

const mount = makeMount("markup-index-path-host");
const settle = async (): Promise<void> => {
  await flush();
  await flush();
};
const txt = (root: ShadowRoot, selector: string): string =>
  Array.from(root.querySelectorAll(selector)).map((n) => n.textContent).join(",");
const raw = (stateEl: any) => stateEl._state;

/** console.warn / console.error を集める（テストの最後に戻す） */
function captureConsole(): { messages: string[]; restore: () => void } {
  const messages: string[] = [];
  const warn = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => { messages.push(String(args[0])); });
  const error = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { messages.push(String(args[0])); });
  return { messages, restore: () => { warn.mockRestore(); error.mockRestore(); } };
}

function issueState(): any {
  const state: any = {
    items: [{ v: 1 }, { v: 2 }],
    bump(this: any) { this["items.0.v"] = 9; },
  };
  Object.defineProperty(state, "items.*.double", {
    get(this: any) { return this["items.*.v"] * 2; }, enumerable: true, configurable: true,
  });
  return state;
}

const ISSUE_MARKUP =
  `<span class="a" data-wcs="textContent: items.0.v"></span>` +
  `<span class="b">{{ items.1.v }}</span>` +
  `<span class="d" data-wcs="textContent: items.0.double"></span>` +
  `<button data-wcs="onclick: bump">bump</button>`;
const FOR_MARKUP = `<ul><template data-wcs="for: items"><li>{{ .v }}</li></template></ul>`;

// ---------------------------------------------------------------------------
// Issue の表
// ---------------------------------------------------------------------------

describe.each([
  ["for: で同じリストを描くとき", true],
  ["for: が無いとき", false],
])("Issue の表（%s）", (_label, withFor) => {
  it("添字のパス・要素の差し替え・丸ごと置換のどれも .a / .b / .d に届き、警告も出ないこと", async () => {
    const console = captureConsole();
    try {
      const { host, stateEl, shadowRoot } = await mount(issueState(), ISSUE_MARKUP + (withFor ? FOR_MARKUP : ""));
      await settle();
      const row = () => [txt(shadowRoot, ".a"), txt(shadowRoot, ".b"), txt(shadowRoot, ".d")];
      // 修正前: .d は初期から空
      expect(row()).toEqual(["1", "2", "2"]);

      // 修正前: .a は 1 のまま・.d は空のまま
      write(stateEl, (s) => { s["items.0.v"] = 7; });
      await settle();
      expect(row()).toEqual(["7", "2", "14"]);

      write(stateEl, (s) => { s["items.1.v"] = 8; });
      await settle();
      expect(row()).toEqual(["7", "8", "14"]);

      // 修正前: .a は 1、.b は 2 のまま（for の無いときも同じ）
      write(stateEl, (s) => { s["items.0"] = { v: 50 }; });
      await settle();
      expect(row()).toEqual(["50", "8", "100"]);

      write(stateEl, (s) => { s.items = [{ v: 100 }, { v: 200 }]; });
      await settle();
      expect(row()).toEqual(["100", "200", "200"]);
      if (withFor) {
        expect(txt(shadowRoot, "li")).toBe("100,200");
      }
      // 修正前: `"double" is not declared` の wcs/binding-path-missing
      expect(console.messages).toEqual([]);
      host.remove();
    } finally {
      console.restore();
    }
  });

  it("ボタン（this[\"items.0.v\"] = 9）の書き込みも .a に届くこと", async () => {
    const { host, shadowRoot } = await mount(issueState(), ISSUE_MARKUP + (withFor ? FOR_MARKUP : ""));
    (shadowRoot.querySelector("button") as HTMLButtonElement).click();
    await settle();
    // 修正前: .a は 1 のまま（<li> は 9）
    expect(txt(shadowRoot, ".a")).toBe("9");
    expect(txt(shadowRoot, ".d")).toBe("18");
    if (withFor) {
      expect(txt(shadowRoot, "li")).toBe("9,2");
    }
    host.remove();
  });
});

// ---------------------------------------------------------------------------
// 位置の意味: 並べ替え・削除・入れ替えの後は、新しくその位置に来た行を表示する
// ---------------------------------------------------------------------------

describe.each([
  ["for: で同じリストを描くとき", true],
  ["for: が無いとき", false],
])("位置の意味（%s）", (_label, withFor) => {
  it("並べ替え・先頭の削除・要素の入れ替えの後は、いまその位置にある行を表示すること", async () => {
    const markup = `<i class="a">{{ items.0.v }}</i><i class="b">{{ items.1.v }}</i>` +
      (withFor ? `<template data-wcs="for: items"><li>{{ .v }}</li></template>` : "");
    const { host, stateEl, shadowRoot } = await mount({ items: [{ v: 1 }, { v: 2 }, { v: 3 }] }, markup);
    const row = () => [txt(shadowRoot, ".a"), txt(shadowRoot, ".b")];

    write(stateEl, (s) => { s.items = s.items.toReversed(); });
    await settle();
    expect(row()).toEqual(["3", "2"]);

    write(stateEl, (s) => { s.items = s.items.slice(1); });
    await settle();
    expect(row()).toEqual(["2", "1"]);

    // 要素の入れ替え（行は値に付いて動く — #4 の同一性モデル）。修正前は "2" / "1" のまま
    write(stateEl, (s) => {
      const first = s["items.0"];
      const second = s["items.1"];
      s["items.0"] = second;
      s["items.1"] = first;
    });
    await settle();
    expect(row()).toEqual(["1", "2"]);
    expect(raw(stateEl).items.map((item: any) => item.v)).toEqual([1, 2]);

    // 入れ替えの後も、添字のパスの書き込みはいまその位置にある行に着地する。修正前は "2" / "1" のまま
    write(stateEl, (s) => { s["items.1.v"] = 9; });
    await settle();
    expect(row()).toEqual(["1", "9"]);
    if (withFor) {
      expect(txt(shadowRoot, "li")).toBe("1,9");
    }
    host.remove();
  });
});

describe("行が無い位置・行でないキー", () => {
  it("空のリストの添字は空のまま投げず、行が入れば表示し、空に戻れば空に戻ること", async () => {
    const console = captureConsole();
    try {
      const { host, stateEl, shadowRoot } = await mount({ items: [] as any[] },
        `<i class="a">{{ items.0.v }}</i><i class="far">{{ items.5.v }}</i>`);
      expect(txt(shadowRoot, ".a")).toBe("");

      write(stateEl, (s) => { s.items = [...s.items, { v: 3 }]; });
      await settle();
      expect(txt(shadowRoot, ".a")).toBe("3");
      expect(txt(shadowRoot, ".far")).toBe("");

      // 修正前: 追加された行を添字のパスで書いても "3" のまま
      write(stateEl, (s) => { s["items.0.v"] = 4; });
      await settle();
      expect(txt(shadowRoot, ".a")).toBe("4");

      write(stateEl, (s) => { s.items = []; });
      await settle();
      expect(txt(shadowRoot, ".a")).toBe("");
      // 行の無い位置の読みも、空配列の束縛も、警告・エラーを出さない
      expect(console.messages).toEqual([]);
      host.remove();
    } finally {
      console.restore();
    }
  });

  it("数値のキーを持つオブジェクト（配列でない）は、これまでどおり素のキーとして読むこと", async () => {
    const { host, stateEl, shadowRoot } = await mount({ sales: { "2024": { total: 5 } } },
      `<i class="a">{{ sales.2024.total }}</i>`);
    expect(txt(shadowRoot, ".a")).toBe("5");
    write(stateEl, (s) => { s.sales = { "2024": { total: 6 } }; });
    await settle();
    expect(txt(shadowRoot, ".a")).toBe("6");
    host.remove();
  });

  it("先頭が数値のパス（ルートの数値キー）は行として扱わず、素のキーとして読むこと", async () => {
    const { host, stateEl, shadowRoot } = await mount({ "2024": { total: 5 } }, `<i class="a">{{ 2024.total }}</i>`);
    expect(txt(shadowRoot, ".a")).toBe("5");
    expect(stateEl.getterPaths.has("2024.total")).toBe(false);
    host.remove();
  });
});

// ---------------------------------------------------------------------------
// 行 getter・入れ子・プリミティブの要素
// ---------------------------------------------------------------------------

describe("行 getter・入れ子のリスト・プリミティブの要素", () => {
  it("行 getter だけを束縛した（for の無い）ページでも、差し替え・依存先の書き込み・並べ替えに追従すること", async () => {
    const state: any = { items: [{ v: 1 }, { v: 2 }] };
    Object.defineProperty(state, "items.*.double", {
      get(this: any) { return this["items.*.v"] * 2; }, enumerable: true, configurable: true,
    });
    const { host, stateEl, shadowRoot } = await mount(state, `<i class="d">{{ items.0.double }}</i>`);
    // 修正前: 空
    expect(txt(shadowRoot, ".d")).toBe("2");

    write(stateEl, (s) => { s["items.0"] = { v: 50 }; });
    await settle();
    expect(txt(shadowRoot, ".d")).toBe("100");

    write(stateEl, (s) => { s["items.0.v"] = 3; });
    await settle();
    expect(txt(shadowRoot, ".d")).toBe("6");

    write(stateEl, (s) => { s.items = s.items.toReversed(); });
    await settle();
    expect(txt(shadowRoot, ".d")).toBe("4");
    host.remove();
  });

  it("数値の区切りが 2 つ以上のパス（groups.0.items.1.v）は修正前と同じ素のパスのまま、エラー無しで表示し、丸ごと置換に追従すること", async () => {
    const console = captureConsole();
    try {
      const { host, stateEl, shadowRoot } = await mount(
        { groups: [{ items: [{ v: 1 }, { v: 2 }] }, { items: [{ v: 3 }] }] },
        `<i class="a">{{ groups.0.items.1.v }}</i><i class="b">{{ groups.1.items.0.v }}</i>`,
      );
      const row = () => [txt(shadowRoot, ".a"), txt(shadowRoot, ".b")];
      expect(row()).toEqual(["2", "3"]);
      // 暗黙の getter は生やさない（数値のパスの `for` が作る 1 段の行と、2 段のワイルドカードパスの
      // 解決が食い違う — wcs/wildcard-rank）
      expect([...stateEl.getterPaths]).toEqual([]);

      write(stateEl, (s) => { s.groups = s.groups.toReversed(); });
      await settle();
      // groups.0 は元の groups.1（items が 1 行）: .a の位置に行は無い
      expect(row()).toEqual(["", "1"]);
      expect(console.messages).toEqual([]);
      host.remove();
    } finally {
      console.restore();
    }
  });

  it.each([
    ["for: groups.0.items と groups.0.items.1.v", { groups: [{ items: [{ v: 1 }, { v: 2 }] }] },
      `<template data-wcs="for: groups.0.items"><li>{{ .v }}</li></template><i class="a">{{ groups.0.items.1.v }}</i>`,
      "groups.0.items", [{ v: 7 }, { v: 8 }], ["1,2", "2"], ["7,8", "8"]],
    ["for: items.0.tags と items.0.tags.1", { items: [{ tags: ["a", "b"] }] },
      `<template data-wcs="for: items.0.tags"><li>{{ . }}</li></template><i class="a">{{ items.0.tags.1 }}</i>`,
      "items.0.tags", ["x", "y", "z"], ["a,b", "b"], ["x,y,z", "y"]],
  ] as const)("数値のパスの for と、その行を 2 つ目の数値で指す束縛（%s）が同じページにあっても、エラー無しで表示すること", async (_label, state, markup, listPath, next, before, after) => {
    const console = captureConsole();
    try {
      const { host, stateEl, shadowRoot } = await mount(structuredClone(state), markup);
      const row = () => [txt(shadowRoot, "li"), txt(shadowRoot, ".a")];
      // 修正前（v3.3.x）と同じ表示。数値の区切りを 2 つ持つ束縛に暗黙の getter を生やすと、for の 1 段の行で
      // 2 段のパスを解決して初期表示から空になり、バッチごとに `failed to apply` が出た
      expect(row()).toEqual(before);

      // for のリスト（数値の区切り 1 つ）の置き換えは、for の行にも、その下の素のパスにも届く
      write(stateEl, (s) => { s[listPath] = next; });
      await settle();
      expect(row()).toEqual(after);
      expect(console.messages).toEqual([]);
      host.remove();
    } finally {
      console.restore();
    }
  });

  it("プリミティブの要素（tags.0）も要素のパスの書き込みに追従すること", async () => {
    const { host, stateEl, shadowRoot } = await mount({ tags: ["x", "y"] }, `<i class="a">{{ tags.0 }}</i>`);
    expect(txt(shadowRoot, ".a")).toBe("x");
    write(stateEl, (s) => { s["tags.0"] = "z"; });
    await settle();
    // 修正前: "x" のまま
    expect(txt(shadowRoot, ".a")).toBe("z");
    host.remove();
  });

  it("同じ値が並ぶプリミティブのリストでも、末尾の添字の束縛は書いた位置の値を表示すること", async () => {
    // 末尾の添字の要素は swap 経路（同じ値が並ぶと入れ替えが完了しない）に載せない
    const { host, stateEl, shadowRoot } = await mount({ scores: [1, 1, 5] }, `<i class="a">{{ scores.2 }}</i>`);
    write(stateEl, (s) => { s["scores.2"] = 7; });
    await settle();
    expect(txt(shadowRoot, ".a")).toBe("7");
    expect(read(stateEl, (s) => s["scores.2"])).toBe(7);
    expect(stateEl.elementPaths.has("scores.*")).toBe(false);
    host.remove();
  });

  it("for: の対象が数値添字のパス（for: groups.0.items）でも、そのリストの置き換えに追従すること", async () => {
    const { host, stateEl, shadowRoot } = await mount({ groups: [{ items: [{ v: 1 }, { v: 2 }] }] },
      `<template data-wcs="for: groups.0.items"><li>{{ .v }}</li></template>`);
    expect(txt(shadowRoot, "li")).toBe("1,2");
    write(stateEl, (s) => { s["groups.0.items"] = [{ v: 5 }]; });
    await settle();
    // 修正前: "1,2" のまま
    expect(txt(shadowRoot, "li")).toBe("5");
    host.remove();
  });
});

// ---------------------------------------------------------------------------
// 書き込みの入口: 双方向の束縛・$resolve・$watch
// ---------------------------------------------------------------------------

describe("書き込みの入口", () => {
  it("双方向の束縛（value: items.0.v）の書き戻しが行 0 に着地し、同じ位置の束縛と for の行に届くこと", async () => {
    const { host, stateEl, shadowRoot } = await mount({ items: [{ v: "a" }, { v: "b" }] },
      `<input data-wcs="value: items.0.v"><i class="a">{{ items.0.v }}</i>` +
      `<template data-wcs="for: items"><li>{{ .v }}</li></template>`);
    const input = shadowRoot.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("a");

    input.value = "typed";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    expect(raw(stateEl).items[0].v).toBe("typed");
    // 修正前: .a は "a" のまま
    expect(txt(shadowRoot, ".a")).toBe("typed");
    expect(txt(shadowRoot, "li")).toBe("typed,b");

    write(stateEl, (s) => { s["items.0.v"] = "fromState"; });
    await settle();
    // 修正前: input は "typed" のまま
    expect(input.value).toBe("fromState");
    expect(txt(shadowRoot, ".a")).toBe("fromState");
    host.remove();
  });

  it("for: の行の入力欄（value: .v）からの書き込みが、同じ位置の数値添字の束縛に届くこと", async () => {
    const { host, stateEl, shadowRoot } = await mount({ items: [{ v: "a" }, { v: "b" }] },
      `<i class="a">{{ items.0.v }}</i><i class="b">{{ items.1.v }}</i>` +
      `<template data-wcs="for: items"><input data-wcs="value: .v"></template>`);
    const second = shadowRoot.querySelectorAll("input")[1] as HTMLInputElement;
    second.value = "typed";
    second.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    expect(raw(stateEl).items[1].v).toBe("typed");
    // 修正前: "b" のまま
    expect([txt(shadowRoot, ".a"), txt(shadowRoot, ".b")]).toEqual(["a", "typed"]);
    host.remove();
  });

  it("$resolve に素のパス（items.0.v）で渡した書き込みも行 0 に着地し、for の行にも届くこと", async () => {
    const { host, stateEl, shadowRoot } = await mount({ items: [{ v: 1 }, { v: 2 }] },
      `<i class="a">{{ items.0.v }}</i><template data-wcs="for: items"><li>{{ .v }}</li></template>`);
    write(stateEl, (s) => { s.$resolve("items.0.v", [], 7); });
    await settle();
    expect(raw(stateEl).items[0].v).toBe(7);
    expect(txt(shadowRoot, ".a")).toBe("7");
    // 修正前: <li> は 1 のまま（素のパスへの書き込みは行のアドレスに届かなかった）
    expect(txt(shadowRoot, "li")).toBe("7,2");
    host.remove();
  });

  it("$resolve / $setAll に数値のキーのオブジェクトのパス（sales.2024.total）で渡した書き込みは、素のキーとして書いて表示も追従すること", async () => {
    const { host, stateEl, shadowRoot } = await mount({ sales: { "2024": { total: 5 } } },
      `<i class="a">{{ sales.2024.total }}</i><i class="y">{{ sales.2024 }}</i>`);
    // 修正前（v3.3.x）はどちらも書けた。暗黙の setter が行のパス（`this["sales.2024.total"] = …`）へ
    // 書き直すと `ListIndex not found at index 2024 of sales` で投げた
    write(stateEl, (s) => { s.$resolve("sales.2024.total", [], 52); });
    await settle();
    expect(raw(stateEl).sales["2024"].total).toBe(52);
    expect(txt(shadowRoot, ".a")).toBe("52");

    expect(writeCount(stateEl, (s) => s.$setAll("sales.2024.total", [], 54))).toBe(1);
    await settle();
    expect(txt(shadowRoot, ".a")).toBe("54");

    // 数値の区切りが末尾（親が配列でない）でも同じ
    write(stateEl, (s) => { s.$resolve("sales.2024", [], { total: 60 }); });
    await settle();
    expect(raw(stateEl).sales["2024"]).toEqual({ total: 60 });
    expect(txt(shadowRoot, ".a")).toBe("60");
    host.remove();
  });

  it("$watch の数値添字のキーが、添字のパスの書き込みと要素の差し替えで発火すること", async () => {
    const calls: unknown[] = [];
    const state: any = {
      items: [{ v: 1 }],
      $watch: { "items.0.v"(this: any, value: unknown) { calls.push(value); } },
    };
    const { host, stateEl } = await mount(state, `<i class="a">{{ items.0.v }}</i>`);
    write(stateEl, (s) => { s["items.0.v"] = 5; });
    await settle();
    write(stateEl, (s) => { s["items.0"] = { v: 6 }; });
    await settle();
    // 修正前: 一度も発火しない
    expect(calls).toEqual([5, 6]);
    host.remove();
  });
});

// ---------------------------------------------------------------------------
// for の無い一覧で、同じ要素が 2 か所に並んだ後の位置の書き込み
// ---------------------------------------------------------------------------

describe("for の無い一覧で同じ要素が 2 か所に並んだ後も、位置の書き込みは書いた位置に着地すること", () => {
  // 数値添字の束縛だけのページで for の無いリストを swap 経路（elementPaths）に載せると、同じ要素が
  // 2 か所に並んだ間は入れ替えが完了せず、後の位置の書き込みが別の位置に着地した（データが化けた）
  it("要素の複写 → 別の行の葉 → 複写した位置へ新しい要素（別バッチ）", async () => {
    const { host, stateEl, shadowRoot } = await mount({ items: [{ v: 1 }, { v: 2 }, { v: 3 }] },
      `<i class="a">{{ items.0.v }}</i>`);
    write(stateEl, (s) => { s["items.1"] = s["items.0"]; });
    await settle();
    write(stateEl, (s) => { s["items.2.v"] = 30; });
    await settle();
    write(stateEl, (s) => { s["items.1"] = { v: 20 }; });
    await settle();
    // 登録していたとき: [20, 1, 30]
    expect(raw(stateEl).items).toEqual([{ v: 1 }, { v: 20 }, { v: 30 }]);
    expect(txt(shadowRoot, ".a")).toBe("1");
    host.remove();
  });

  it("$setAll で同じ要素を配った後に、末尾へ新しい要素", async () => {
    const { host, stateEl, shadowRoot } = await mount({ items: [{ v: 1 }, { v: 2 }, { v: 3 }] },
      `<i class="a">{{ items.0.v }}</i>`);
    write(stateEl, (s) => { s.$setAll("items.*", [], { v: 9 }); });
    await settle();
    write(stateEl, (s) => { s["items.2"] = { v: 7 }; });
    await settle();
    // 登録していたとき: [7, 9, 9]
    expect(raw(stateEl).items.map((item: any) => item.v)).toEqual([9, 9, 7]);
    expect(txt(shadowRoot, ".a")).toBe("9");
    host.remove();
  });

  it("プリミティブの一覧（行の下を読む names.0.length）で同じ値が並んだ後", async () => {
    // プリミティブの行の下の読み（文字列の length）は修正前から `failed to apply` になる（getByAddress は
    // 非オブジェクトの値を辿らない）。ここで見るのはデータだけ
    const console = captureConsole();
    try {
      const { host, stateEl } = await mount({ names: ["a", "b", "c"] }, `<i class="a">{{ names.0.length }}</i>`);
      write(stateEl, (s) => { s["names.2"] = "a"; });
      await settle();
      write(stateEl, (s) => { s["names.2"] = "z"; });
      await settle();
      write(stateEl, (s) => { s["names.1"] = "q"; });
      await settle();
      // 登録していたとき: ["z", "q", "a"]
      expect(raw(stateEl).names).toEqual(["a", "q", "z"]);
      host.remove();
    } finally {
      console.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// state・作者のキー・再セット
// ---------------------------------------------------------------------------

describe("state に生やすアクセサ", () => {
  it("列挙されず、データの形（Object.keys / JSON）を変えないこと", async () => {
    const { host, stateEl } = await mount({ items: [{ v: 1 }] }, `<i>{{ items.0.v }}</i>`);
    const state = raw(stateEl);
    expect(Object.keys(state)).toEqual(["items"]);
    expect(JSON.stringify(state)).toBe(`{"items":[{"v":1}]}`);
    // SSR のスナップショット（own かつ列挙可能なデータだけを運ぶ）にも載らない
    expect(Ssr.extractStateData(stateEl)).toEqual({ items: [{ v: 1 }] });
    expect(stateEl.getterPaths.has("items.0.v")).toBe(true);
    expect(read(stateEl, (s) => s["items.0.v"])).toBe(1);
    host.remove();
  });

  it("数値添字の束縛が無いページには何も生やさないこと", async () => {
    const { host, stateEl } = await mount({ items: [{ v: 1 }] },
      `<i>{{ items.length }}</i><template data-wcs="for: items"><li>{{ .v }}</li></template>`);
    expect(Object.getOwnPropertyNames(raw(stateEl))).toEqual(["items"]);
    expect([...stateEl.getterPaths]).toEqual([]);
    expect([...stateEl.elementPaths]).toEqual(["items.*"]);
    host.remove();
  });

  it("作者が同名のキーを宣言していれば、そちらを読むこと", async () => {
    const state: any = { items: [{ v: 1 }] };
    Object.defineProperty(state, "items.0.v", {
      get() { return "author"; }, enumerable: true, configurable: true,
    });
    const { host, shadowRoot } = await mount(state, `<i class="a">{{ items.0.v }}</i>`);
    expect(txt(shadowRoot, ".a")).toBe("author");
    host.remove();
  });

  it("state を再セットした後も、新しい state で添字のパスの書き込みに追従すること", async () => {
    const { host, stateEl, shadowRoot } = await mount({ items: [{ v: 1 }] }, `<i class="a">{{ items.0.v }}</i>`);
    stateEl.setInitialState({ items: [{ v: 10 }] });
    await settle();
    expect(txt(shadowRoot, ".a")).toBe("10");
    write(stateEl, (s) => { s["items.0.v"] = 11; });
    await settle();
    // 修正前: "10" のまま
    expect(txt(shadowRoot, ".a")).toBe("11");
    host.remove();
  });

  it("アクセサを生やすのは数値の区切りがちょうど 1 つのパスだけで、要素のパス（elementPaths）は登録しないこと", () => {
    const state = { items: [], "own.0": 1 };
    // 数値が 2 つ以上・`*` との混在・数値なし・先頭が数値（ルートのキー）・マウントのマーカー・作者の同名キー
    for (const path of ["groups.0.items.1.v", "matrix.0.1", "items.*.tags.0", "items.length", "2024.total", "users.0.#m1.mode", "own.0"]) {
      expect(isIndexPath(state, path)).toBe(false);
    }
    // state がまだ無い（セット時の経路情報の作り直しが戻ってくる）・拡張できない state
    expect(isIndexPath(undefined, "items.0.v")).toBe(false);
    expect(isIndexPath(Object.preventExtensions({ items: [] }), "items.0.v")).toBe(false);
    for (const path of ["items.0.v", "users.1.name", "items.0"]) {
      expect(isIndexPath(state, path)).toBe(true);
    }

    const elementPaths = new Set<string>();
    const defineTreeAccessor = vi.fn();
    defineIndexPathAccessor({ elementPaths, defineTreeAccessor } as any, "items.0.v");
    expect(defineTreeAccessor.mock.calls.map((call) => call[0])).toEqual(["items.0.v"]);
    // for の無いリストを swap 経路（setByAddress の _setByAddressWithSwap）に載せない — 載せると同じ要素が
    // 2 か所に並んだ後の位置の書き込みが別の位置に着地した（上の「同じ要素が 2 か所に並んだ後」）
    expect([...elementPaths]).toEqual([]);
  });

  it.each(["freeze", "seal", "preventExtensions"] as const)("拡張できない state（Object.%s）には生やさず、修正前と同じ素のパスとして表示すること", async (kind) => {
    const console = captureConsole();
    try {
      const state = Object[kind]({ items: [{ v: 1 }], title: "T" });
      // 修正前: 表示できた。生やそうとすると `Cannot define property items.0.v, object is not extensible` で初期化が落ちた
      const { host, stateEl, shadowRoot } = await mount(state, `<i class="a">{{ items.0.v }}</i><i class="t">{{ title }}</i>`);
      expect([txt(shadowRoot, ".a"), txt(shadowRoot, ".t")]).toEqual(["1", "T"]);
      expect([...stateEl.getterPaths]).toEqual([]);
      expect(console.messages).toEqual([]);
      host.remove();
    } finally {
      console.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// 数値の区切りでマウントしたコンポーネント（state: users.0）
// ---------------------------------------------------------------------------

describe("数値添字のパスにマウントしたコンポーネント", () => {
  it("マウント先のキーは添字のパスの書き込みに追従し、私有キー（#m のパス）はオーバーレイから読むこと", async () => {
    const tag = "markup-index-path-card";
    class Card extends HTMLElement {
      state: Record<string, any> = { mode: "view" };
      constructor() {
        super();
        this.attachShadow({ mode: "open" }).innerHTML =
          `<wcs-state bind-component="state"></wcs-state><b class="name">{{ name }}</b><b class="mode">{{ mode }}</b>`;
      }
    }
    customElements.define(tag, Card);
    const host = document.createElement("markup-index-path-mount-host");
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<wcs-state json='{"users":[{"name":"Alice"},{"name":"Bob"}]}'></wcs-state>` +
      `<${tag} data-wcs="state: users.0"></${tag}>`;
    document.body.appendChild(host);
    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    const card = shadowRoot.querySelector(tag)!;
    const cardState = card.shadowRoot!.querySelector("wcs-state") as State;
    await cardState.connectedCallbackPromise;
    await State.getBindingsReady(card.shadowRoot!);
    await settle();
    const cs = card.shadowRoot!;
    expect(txt(cs, ".name")).toBe("Alice");
    expect(txt(cs, ".mode")).toBe("view");

    write(stateEl, (s) => { s["users.0.name"] = "Zed"; });
    await settle();
    // 修正前: "Alice" のまま
    expect(txt(cs, ".name")).toBe("Zed");
    expect(txt(cs, ".mode")).toBe("view");
    host.remove();
  });
});

// ---------------------------------------------------------------------------
// 存在の診断: 数値添字のパスの for が生やした暗黙の getter は、行のパスの途中の宣言ではない（#388）
// ---------------------------------------------------------------------------

/** 報告の本文（`Updates to this path…` と lint の案内より前）。`hint` は did-you-mean */
const missingReport = (path: string, segment: string, hint = ""): string =>
  `[wcs/binding-path-missing] Bound path "${path}" does not resolve on the state tree: "${segment}" is not declared.${hint} Updates`;

function groupsState(): any {
  const state: any = { groups: [{ items: [{ name: "a", n: 1 }, { name: "b", n: 2 }] }] };
  Object.defineProperty(state, "groups.*.items.*.double", {
    get(this: any) { return this["groups.*.items.*.n"] * 2; }, enumerable: true, configurable: true,
  });
  return state;
}

describe("数値添字のパスの for の行の存在の診断（#388）", () => {
  it("Issue の表: for: groups.0.items の行の打ち間違い（.nmae）と解決しない行のパス（.double）を報告し、正しいパスは報告しないこと", async () => {
    const console = captureConsole();
    try {
      const { host, shadowRoot } = await mount(groupsState(),
        `<template data-wcs="for: groups.0.items"><i class="typo">{{ .nmae }}</i></template>` +
        `<template data-wcs="for: groups.0.items"><i class="double">{{ .double }}</i></template>` +
        `<template data-wcs="for: groups.0.items"><i class="name">{{ .name }}</i></template>`);
      await settle();
      expect([txt(shadowRoot, ".typo"), txt(shadowRoot, ".double"), txt(shadowRoot, ".name")]).toEqual([",", ",", "a,b"]);
      // 修正前（#332 の後）: どちらも無言。描いた後の state にある暗黙の getter `groups.0.items` を作者の getter と
      // みなし、その先を判定不能に倒していた（v3.3.0 と lint は両方を報告する）
      expect(console.messages).toEqual([
        expect.stringContaining(missingReport("groups.0.items.*.nmae", "nmae", ` Did you mean "name"?`)),
        expect.stringContaining(missingReport("groups.0.items.*.double", "double")),
      ]);
      host.remove();
    } finally {
      console.restore();
    }
  });

  it("同じページの #332 の形（行 getter・行の無い位置・空のリスト）は黙ったまま、数値のキーのオブジェクトの打ち間違いは報告すること", async () => {
    const console = captureConsole();
    try {
      const state: any = { items: [{ v: 1 }], empty: [], sales: { "2024": { total: 5, items: [{ name: "a" }] } } };
      Object.defineProperty(state, "items.*.double", {
        get(this: any) { return this["items.*.v"] * 2; }, enumerable: true, configurable: true,
      });
      const { host, shadowRoot } = await mount(state,
        `<i class="d">{{ items.0.double }}</i><i class="far">{{ items.5.v }}</i><i class="e">{{ empty.0.v }}</i>` +
        `<i class="t">{{ sales.2024.totl }}</i>` +
        `<template data-wcs="for: sales.2024.items"><b>{{ .nmae }}</b></template>`);
      await settle();
      expect([txt(shadowRoot, ".d"), txt(shadowRoot, ".far"), txt(shadowRoot, ".e"), txt(shadowRoot, ".t")]).toEqual(["2", "", "", ""]);
      // 修正前: `sales.2024.items.*.nmae` だけが無言（暗黙の getter `sales.2024.items` の先を判定不能に倒した）
      expect(console.messages).toHaveLength(2);
      expect(console.messages).toEqual(expect.arrayContaining([
        expect.stringContaining(missingReport("sales.2024.totl", "totl", ` Did you mean "total"?`)),
        expect.stringContaining(missingReport("sales.2024.items.*.nmae", "nmae", ` Did you mean "name"?`)),
      ]));
      host.remove();
    } finally {
      console.restore();
    }
  });

  it("行 getter（items.*.sub）の戻り値を for: items.0.sub で描く行、作者が宣言した同名の getter の行は、これまでどおり報告しないこと", async () => {
    const console = captureConsole();
    try {
      const state: any = { items: [{ subRaw: [{ x: 1 }, { x: 2 }] }], groups: [{ items: [{ name: "a" }] }], picked: [{ name: "z" }] };
      Object.defineProperty(state, "items.*.sub", {
        get(this: any) { return this["items.*.subRaw"]; }, enumerable: true, configurable: true,
      });
      Object.defineProperty(state, "groups.0.items", {
        get(this: any) { return this.picked; }, enumerable: true, configurable: true,
      });
      const { host, shadowRoot } = await mount(state,
        `<template data-wcs="for: items.0.sub"><i class="x">{{ .x }}</i></template>` +
        `<template data-wcs="for: groups.0.items"><i class="p">{{ .name }}</i><i class="q">{{ .nmae }}</i></template>`);
      await settle();
      expect([txt(shadowRoot, ".x"), txt(shadowRoot, ".p")]).toEqual(["1,2", "z"]);
      // 暗黙の getter の行のパス `items.*.sub` は行 getter（データの行には `sub` が無い）、`groups.0.items` は
      // 作者の getter: どちらも戻り値の形は評価しないと分からない
      expect(console.messages).toEqual([]);
      host.remove();
    } finally {
      console.restore();
    }
  });

  it("state を再セットすると、新しい世代でも行の打ち間違いを報告し直すこと", async () => {
    const console = captureConsole();
    try {
      const { host, stateEl } = await mount(groupsState(), `<template data-wcs="for: groups.0.items"><i>{{ .nmae }}</i></template>`);
      await settle();
      expect(console.messages).toHaveLength(1);
      stateEl.setInitialState(groupsState());
      await settle();
      expect(console.messages).toEqual([
        expect.stringContaining(missingReport("groups.0.items.*.nmae", "nmae", ` Did you mean "name"?`)),
        expect.stringContaining(missingReport("groups.0.items.*.nmae", "nmae", ` Did you mean "name"?`)),
      ]);
      host.remove();
    } finally {
      console.restore();
    }
  });
});

describe("数値添字のパスの暗黙の getter を did-you-mean の候補にしない（#388）", () => {
  it("for: users.0.frends の行の打ち間違いに、打ち間違えた名前そのものではなく正しい名前を提案すること", async () => {
    const console = captureConsole();
    try {
      const { host } = await mount({ users: [{ friends: [{ name: "f" }] }] },
        `<template data-wcs="for: users.0.frends"><i>{{ .name }}</i></template>`);
      await settle();
      // 修正前: 行のパスの報告が `"frends" is not declared. Did you mean "frends"?`（for: が生やした
      // 暗黙の getter `users.0.frends` の名前が候補に入り、距離 0 で選ばれた）
      expect(console.messages).toEqual(expect.arrayContaining([
        expect.stringContaining(missingReport("users.0.frends.*.name", "frends", ` Did you mean "friends"?`)),
      ]));
      expect(console.messages.join("\n")).not.toContain(`Did you mean "frends"?`);
      host.remove();
    } finally {
      console.restore();
    }
  });

  it("数値のキーのオブジェクトで、別の束縛の打ち間違い（sales.2024.totl）を提案しないこと", async () => {
    const console = captureConsole();
    try {
      const { host } = await mount({ sales: { "2024": { total: 5 } } },
        `<i>{{ sales.2024.totl }}</i><i>{{ sales.2024.totla }}</i>`);
      await settle();
      expect(console.messages).toEqual([
        expect.stringContaining(missingReport("sales.2024.totl", "totl", ` Did you mean "total"?`)),
        expect.stringContaining(missingReport("sales.2024.totla", "totla", ` Did you mean "total"?`)),
      ]);
      host.remove();
    } finally {
      console.restore();
    }
  });
});
