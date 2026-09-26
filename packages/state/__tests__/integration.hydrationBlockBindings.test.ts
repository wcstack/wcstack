/**
 * integration.hydrationBlockBindings.test.ts — ハイドレーションは SSR ブロックの中のバインディングにも
 * 初回値を適用する（#258 X6）。
 *
 * 旧挙動: `hydrateBindings` は `for` の行と `if` の中身のバインディングをアドレスに登録するだけで、
 * 初回値を適用するのはブロックの外の通常バインディングだけだった。getter の依存辺は getter を
 * 評価したときにしか張られないので、ブロックの中の getter バインドは、依存するパスを書いても
 * 一度も再評価されず、サーバーが書いたテキストのまま固まった（ブロックの外の集計は動くので
 * 「合計は動くのに行だけ止まる」形になる）。
 *
 * 契約（1 本ずつ固定する）:
 *  - `for` の行・`if` の中身の getter バインドが、ハイドレーション後の書き込みに追従する。
 *  - 適用してもサーバーが書いたテキストは変わらない。
 *  - 入れ子の `for` はハイドレーションせず、クライアントの全描画に倒す（#258。実際のサーバー出力での
 *    固定は integration.ssrNestedHydration.test.ts）。ここでは手書きの断片でも倒れることを固定する。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { flush, read, write } from "./helpers/recursionTestUtils";
import { clientLoad as clientHydrate, serverRender } from "./helpers/ssrRoundTrip";

beforeAll(() => {
  bootstrapState();
});

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

const texts = (selector: string, root: ParentNode = document): (string | null)[] =>
  Array.from(root.querySelectorAll(selector)).map((element) => element.textContent);

/** サーバーが返した HTML の中のテキスト（serverRender は後始末で DOM を空にする） */
function serverTexts(html: string, selector: string): (string | null)[] {
  const template = document.createElement("template");
  template.innerHTML = html;
  return texts(selector, template.content);
}

describe("for の行", () => {
  const rows = (): any => {
    const state: any = { items: [{ n: 1 }, { n: 2 }] };
    Object.defineProperty(state, "items.*.double", {
      get(this: any) { return this["items.*.n"] * 2; },
      enumerable: false, configurable: true,
    });
    return state;
  };
  const MARKUP =
    `<wcs-state enable-ssr></wcs-state>` +
    `<ul><template data-wcs="for: items"><li class="d" data-wcs="textContent: items.*.double"></li></template></ul>`;

  it("行の getter が葉の書き込みに追従し、適用してもサーバーのテキストは変わらない", async () => {
    const html = await serverRender(MARKUP, rows);
    expect(serverTexts(html, ".d")).toEqual(["2", "4"]);

    const el = await clientHydrate(html, rows);
    expect(texts(".d"), "サーバーが書いたテキストのまま").toEqual(["2", "4"]);

    write(el, (s: any) => { s["items.0.n"] = 10; });
    await flush();
    expect(texts(".d")).toEqual(["20", "4"]); // 旧: ["2", "4"]
    expect(read(el, (s: any) => s.$getAll("items.*.double", []))).toEqual([20, 4]);
  });
});

describe("if の中身", () => {
  const page = (): any => {
    const state: any = { show: true, a: 1, b: 2 };
    Object.defineProperty(state, "total", {
      get(this: any) { return this.a + this.b; },
      enumerable: false, configurable: true,
    });
    return state;
  };
  const MARKUP =
    `<wcs-state enable-ssr></wcs-state>` +
    `<template data-wcs="if: show"><p class="t" data-wcs="textContent: total"></p></template>`;

  it("if の中の getter バインドが依存パスの書き込みに追従する", async () => {
    const html = await serverRender(MARKUP, page);
    expect(serverTexts(html, ".t")).toEqual(["3"]);

    const el = await clientHydrate(html, page);
    expect(texts(".t")).toEqual(["3"]);

    write(el, (s: any) => { s.a = 10; });
    await flush();
    expect(texts(".t")).toEqual(["12"]); // 旧: ["3"]
  });
});

describe("入れ子の for（手書きの断片 — ハイドレーションの既知の制限）", () => {
  // **手書きの** SSR 断片。実際のサーバー出力とは 2 点違う: スナップショットのテンプレートが入れ子の
  // `<template>` のまま（実出力は平らで、入れ子は親の中身のプレースホルダ）、内側の行の終端コメントが
  // 正順（実出力は逆順）。この形は旧来、ハイドレーションが止まらずに「内側の行が黙って未適用」に
  // 見えていたが、実出力ではハイドレーション全体が止まっていた（#258 — 実出力での固定は
  // integration.ssrNestedHydration.test.ts）。ここで固定するのは、旧形の断片でも入れ子を検出して
  // 全描画に倒すこと（`Ssr.cleanupDom` の入れ子の `<template>` をそのまま使う経路）
  const FIXTURE = `
    <wcs-ssr name="default">
      <script type="application/json">{"groups":[{"title":"G1","items":[{"name":"x"},{"name":"y"}]}]}</script>
      <template id="hbb2" data-wcs="for: groups">
        <div class="group"><h3 data-wcs="textContent: groups.*.title"></h3><em class="outer-index" data-wcs="textContent: $1"></em>
          <template id="hbb3" data-wcs="for: groups.*.items">
            <i data-wcs="textContent: groups.*.items.*.name"></i><b class="inner-index" data-wcs="textContent: $2"></b>
          </template>
        </div>
      </template>
    </wcs-ssr>
    <wcs-state enable-ssr json='{"groups":[]}'></wcs-state>
    <div id="outer">
      <!--@@wcs-for:hbb2-->
      <!--@@wcs-for-start:hbb2:groups:0--><div class="group"><h3 data-wcs="textContent: groups.*.title">G1</h3><em class="outer-index" data-wcs="textContent: $1">0</em>
        <!--@@wcs-for:hbb3-->
        <!--@@wcs-for-start:hbb3:groups.*.items:0--><i data-wcs="textContent: groups.*.items.*.name">x</i><b class="inner-index" data-wcs="textContent: $2">0</b><!--@@wcs-for-end:hbb3:groups.*.items:0-->
        <!--@@wcs-for-start:hbb3:groups.*.items:1--><i data-wcs="textContent: groups.*.items.*.name">y</i><b class="inner-index" data-wcs="textContent: $2">1</b><!--@@wcs-for-end:hbb3:groups.*.items:1-->
      </div><!--@@wcs-for-end:hbb2:groups:0-->
    </div>
  `;

  it("入れ子を検出して全描画に倒し（warn 1 回）、内側の行も添字も書き込みに追従する（旧: 内側の行は固まっていた）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    document.body.innerHTML = FIXTURE;
    const el = document.querySelector("wcs-state") as State;
    await el.connectedCallbackPromise;
    await State.getBindingsReady(document);
    await flush();

    expect(warnSpy.mock.calls.map((args) => String(args[0]))).toEqual([
      `[@wcstack/state] SSR: "for: groups.*.items" in "for: groups" (known limitation). Falling back to full render.`,
    ]);
    expect(document.querySelector("wcs-ssr"), "SSR の DOM は捨てて描き直す").toBeNull();
    expect(texts("h3")).toEqual(["G1"]);
    expect(texts(".outer-index")).toEqual(["0"]);
    expect(texts("i")).toEqual(["x", "y"]);
    expect(texts(".inner-index")).toEqual(["0", "1"]);
    expect(errorSpy.mock.calls.map((args) => String(args[0])), "失敗の報告を出さない").toEqual([]);

    write(el, (s: any) => { s["groups.0.title"] = "G2"; });
    write(el, (s: any) => { s["groups.0.items.1.name"] = "y2"; });
    write(el, (s: any) => { s["groups.0.items"] = [{ name: "z" }, ...s["groups.0.items"]]; });
    await flush();
    expect(texts("h3")).toEqual(["G2"]);
    expect(texts("i")).toEqual(["z", "x", "y2"]);
    expect(texts(".inner-index")).toEqual(["0", "1", "2"]);
  });
});

describe("スナップショットに無い入れ子の置き場（手書きの旧形の断片）", () => {
  // **手書きの**断片。`<wcs-ssr>` のテンプレートの中に入れ子の `<template>` を残した旧形で、行の中の
  // `<!--@@wcs-if:hbb5-->` が指す uuid はスナップショットに載っていない。実際のサーバー出力は入れ子も
  // 平らに載せる（Ssr の collectReachableFragments）ので、この形は旧形・壊れた出力でしか起きない。
  // 置き場は構造として引けず `text: hbb5` と解釈される — 初回適用すると binding-path-missing を
  // 報告するだけなので、ハイドレーションはこれを適用しない（collectBlockBindings）
  const FIXTURE = `
    <wcs-ssr name="default">
      <script type="application/json">{"items":[{"n":1,"on":true}]}</script>
      <template id="hbb4" data-wcs="for: items"><li><span class="n" data-wcs="textContent: items.*.n"></span><template data-wcs="if: items.*.on"><b>on</b></template></li></template>
    </wcs-ssr>
    <wcs-state enable-ssr json='{"items":[]}'></wcs-state>
    <ul>
      <!--@@wcs-for:hbb4-->
      <!--@@wcs-for-start:hbb4:items:0--><li><span class="n" data-wcs="textContent: items.*.n">1</span><!--@@wcs-if:hbb5--><!--@@wcs-if-start:hbb5:items.*.on--><b>on</b><!--@@wcs-if-end:hbb5:items.*.on--></li><!--@@wcs-for-end:hbb4:items:0-->
    </ul>
  `;

  it("置き場を初回適用せず失敗を報告しない（行のほかのバインディングは追従する）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    document.body.innerHTML = FIXTURE;
    const el = document.querySelector("wcs-state") as State;
    await el.connectedCallbackPromise;
    await State.getBindingsReady(document);
    await flush();
    expect(errorSpy.mock.calls.map((args) => String(args[0]))).toEqual([]);
    expect(texts(".n")).toEqual(["1"]);

    write(el, (s: any) => { s["items.0.n"] = 10; });
    await flush();
    expect(texts(".n")).toEqual(["10"]);
  });
});
