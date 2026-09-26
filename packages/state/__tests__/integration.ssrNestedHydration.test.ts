/**
 * integration.ssrNestedHydration.test.ts — #258 の残りの穴を、**実際のサーバー出力**から固定する。
 *
 * どのシナリオも同じ手順を 2 回流して比べる: `enable-ssr` を外した CSR の対照と、サーバー描画
 * （buildSsrDocument。renderToString と同じ最終パス）→ ハイドレーション。fixture は手で書かない
 * （helpers/ssrRoundTrip.ts の注記 — 手書きの断片が入れ子の穴を見逃した）。
 *
 * 契約:
 *  - 入れ子の for・if の中の for はハイドレーションせず、クライアントの全描画に倒す（既知の制限）。
 *    倒したことを console.warn で 1 回知らせ、ページは止まらず CSR と同じ DOM になり、以後の書き込みに
 *    追従する。
 *  - for の行の中の if・内側が空の入れ子・初めて真になる if の中の for は、ハイドレートしたまま CSR と
 *    同じに動く（失敗の報告を出さない）。
 *  - 行の中・if の中の bind-component の子（部分マウント・丸ごとマウント、Shadow / Light DOM）は、
 *    ハイドレーション後の親への書き込みに追従し、ハイドレーションで切断・再接続されず、誤った
 *    `mount-own-key-shadow` を出さない。
 *  - 行の中の `{{ }}` は、行の葉への書き込みと行の getter に追従する。
 *  - 同じリストを回す 2 つの for は、どちらも書き込みに追従する（行はリストごとに 1 組）。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { write } from "./helpers/recursionTestUtils";
import { clientLoad, csrMarkup, serverRender, settle } from "./helpers/ssrRoundTrip";

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

type Step = (s: any) => void;

interface IRun {
  /** 読み込み直後と各書き込みの後の観測 */
  views: unknown[];
  warns: string[];
  errors: string[];
  /** 読み込み直後の DOM（`<wcs-ssr>` と SSR のコメントが残っていないかを見る） */
  html: string;
}

/** 読み込み（CSR なら描画、SSR ならハイドレーション）→ 書き込みを 1 つずつ流し、観測を集める */
async function run(html: string, make: () => any, steps: Step[], observe: () => unknown): Promise<IRun> {
  const warns: string[] = [];
  const errors: string[] = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => { warns.push(args.map(String).join(" ")); });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(" ")); });
  try {
    const el = await clientLoad(html, make);
    const views = [observe()];
    const loadedHtml = document.body.innerHTML;
    for (const step of steps) {
      write(el, step);
      await settle();
      views.push(observe());
    }
    return { views, warns, errors, html: loadedHtml };
  } finally {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    await settle();
  }
}

/** CSR の対照と、サーバー描画 → ハイドレーションを同じ手順で流す */
async function compare(markup: string, make: () => any, steps: Step[], observe: () => unknown)
  : Promise<{ csr: IRun; ssr: IRun; serverHtml: string }> {
  const csr = await run(csrMarkup(markup), make, steps, observe);
  const serverHtml = await serverRender(markup, make);
  const ssr = await run(serverHtml, make, steps, observe);
  return { csr, ssr, serverHtml };
}

const FALLBACK = "Falling back to full render.";

describe("穴 1: 入れ子の for はクライアントの全描画に倒す", () => {
  const make = (): any => {
    const state: any = {
      count: 5,
      groups: [
        { title: "G1", items: [{ name: "x", n: 1 }, { name: "y", n: 2 }] },
        { title: "G2", items: [{ name: "z", n: 3 }] },
      ],
    };
    Object.defineProperty(state, "groups.*.items.*.double", {
      get(this: any) { return this["groups.*.items.*.n"] * 2; },
      enumerable: false, configurable: true,
    });
    return state;
  };
  const MARKUP =
    `<wcs-state enable-ssr></wcs-state>` +
    `<p id="c">{{ count }}</p><p id="c2" data-wcs="textContent: count"></p>` +
    `<div id="outer"><template data-wcs="for: groups"><section class="g"><h3 data-wcs="textContent: .title"></h3>` +
    `<ul><template data-wcs="for: .items"><li class="i" data-wcs="textContent: .name"></li>` +
    `<li class="d" data-wcs="textContent: .double"></li></template></ul></section></template></div>`;
  const observe = (): unknown => ({ c: texts("#c"), c2: texts("#c2"), h3: texts("h3"), i: texts(".i"), d: texts(".d") });

  it("ページ全体が止まらず（旧: ListIndex not found で ready が reject）、CSR と同じ DOM で以後の書き込みに追従する", async () => {
    const { csr, ssr, serverHtml } = await compare(MARKUP, make, [
      (s) => { s.count = 42; },
      (s) => { s["groups.0.title"] = "G1b"; },
      (s) => { s["groups.0.items.0.name"] = "x2"; },
      (s) => { s["groups.0.items.1.n"] = 20; },
      (s) => { s["groups.1.items"] = [...s["groups.1.items"], { name: "w", n: 4 }]; },
      (s) => { s.groups = [...s.groups, { title: "G3", items: [{ name: "v", n: 9 }] }]; },
    ], observe);

    // サーバーは内側の行をブロックとして描いている（この形がハイドレーション全体を止めていた）
    expect(serverHtml).toContain("@@wcs-for-start:");
    expect(serverHtml).toMatch(/@@wcs-for-start:\w+:groups\.\*\.items:0/);

    expect(ssr.views).toEqual(csr.views);
    // トップレベルの `{{ count }}` も生きている（旧: 読み込み直後に空になり、以後も追従しない）
    expect(ssr.views[0]).toEqual({ c: ["5"], c2: ["5"], h3: ["G1", "G2"], i: ["x", "y", "z"], d: ["2", "4", "6"] });
    expect(ssr.views[1]).toMatchObject({ c: ["42"], c2: ["42"] });
    expect(ssr.views[6]).toMatchObject({ h3: ["G1b", "G2", "G3"], i: ["x2", "y", "z", "w", "v"], d: ["2", "40", "6", "8", "18"] });
    expect(ssr.errors).toEqual([]);
    expect(ssr.html, "SSR の DOM は捨てて描き直す").not.toContain("wcs-ssr");
    expect(ssr.html).not.toContain("@@wcs-for-start");
  });

  it("バージョン不一致の全描画でも、平らなスナップショットの入れ子の内側が描かれる（旧: `text: <uuid>` の binding-path-missing）", async () => {
    const csr = await run(csrMarkup(MARKUP), make, [(s) => { s["groups.0.items.0.name"] = "x2"; }], observe);
    const serverHtml = (await serverRender(MARKUP, make)).replace(/(<wcs-ssr[^>]*version=")[^"]*"/, '$199.0.0"');
    const ssr = await run(serverHtml, make, [(s) => { s["groups.0.items.0.name"] = "x2"; }], observe);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.views[0]).toMatchObject({ i: ["x", "y", "z"] });
    expect(ssr.errors).toEqual([]);
    expect(ssr.warns).toHaveLength(1);
    expect(ssr.warns[0]).toContain("SSR version mismatch");
  });

  it("全描画に倒したことを、どのテンプレートのどの形かを名指しして 1 回だけ warn する", async () => {
    const { csr, ssr } = await compare(MARKUP, make, [], observe);
    expect(csr.warns).toEqual([]);
    expect(ssr.warns).toHaveLength(1);
    expect(ssr.warns[0]).toContain(`SSR: "for: groups.*.items" in "for: groups"`);
    expect(ssr.warns[0]).toContain("known limitation");
    expect(ssr.warns[0]).toContain(FALLBACK);
  });
});

describe("穴 3: if の中の for はクライアントの全描画に倒す", () => {
  const make = (): any => {
    const state: any = { count: 1, show: true, items: [{ n: 1 }, { n: 2 }] };
    Object.defineProperty(state, "items.*.double", {
      get(this: any) { return this["items.*.n"] * 2; },
      enumerable: false, configurable: true,
    });
    return state;
  };
  const MARKUP =
    `<wcs-state enable-ssr></wcs-state><p id="c">{{ count }}</p>` +
    `<template data-wcs="if: show"><ul><template data-wcs="for: items">` +
    `<li class="n" data-wcs="textContent: .n"></li><li class="d" data-wcs="textContent: .double"></li>` +
    `</template></ul></template>`;
  const observe = (): unknown => ({ c: texts("#c"), n: texts(".n"), d: texts(".d") });

  it("行の葉の書き込みに追従し、push / 置換 / 縮小で SSR の行を残して重複しない（旧: [10,2,3,1,2]）", async () => {
    const { csr, ssr } = await compare(MARKUP, make, [
      (s) => { s["items.0.n"] = 10; },
      (s) => { s.items = [...s.items, { n: 3 }]; },
      (s) => { s["items.2.n"] = 30; },
      (s) => { s["items.1"] = { n: 20 }; },
      (s) => { s.items = [s.items[0]]; },
      (s) => { s.show = false; },
      (s) => { s.show = true; },
      (s) => { s["items.0.n"] = 11; },
    ], observe);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.views[1]).toEqual({ c: ["1"], n: ["10", "2"], d: ["20", "4"] });
    expect(ssr.views[2]).toEqual({ c: ["1"], n: ["10", "2", "3"], d: ["20", "4", "6"] });
    expect(ssr.views[5]).toEqual({ c: ["1"], n: ["10"], d: ["20"] });
    expect(ssr.errors).toEqual([]);
    expect(ssr.warns).toHaveLength(1);
    expect(ssr.warns[0]).toContain(`"for: items" in "if: show"`);
    expect(ssr.warns[0]).toContain(FALLBACK);
  });

  it("else の中の for も同じく全描画に倒し、枝の切り替えに追従する", async () => {
    const MARKUP =
      `<wcs-state enable-ssr></wcs-state><template data-wcs="if: show"><p class="p">none</p></template>` +
      `<template data-wcs="else:"><ul><template data-wcs="for: items"><li class="n" data-wcs="textContent: .n"></li></template></ul></template>`;
    const make = (): any => ({ show: false, items: [{ n: 1 }, { n: 2 }] });
    const { csr, ssr } = await compare(MARKUP, make, [
      (s) => { s["items.1.n"] = 20; },
      (s) => { s.show = true; },
      (s) => { s.show = false; },
    ], () => ({ p: texts(".p"), n: texts(".n") }));
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.views[1]).toEqual({ p: [], n: ["1", "20"] });
    expect(ssr.views[2]).toEqual({ p: ["none"], n: [] });
    expect(ssr.errors).toEqual([]);
    expect(ssr.warns).toHaveLength(1);
    expect(ssr.warns[0]).toContain(`"for: items" in "else: show"`);
  });
});

describe("穴 5: ハイドレートしたまま動く入れ子（for の行の中の if・空の内側・初めて真になる if）", () => {
  it("for の行の中の if を切り替えられ、足した行の if も描かれる（旧: list index is null で表示が変わらない）", async () => {
    const MARKUP =
      `<wcs-state enable-ssr></wcs-state><ul><template data-wcs="for: items"><li><span class="n" data-wcs="textContent: .n"></span>` +
      `<template data-wcs="if: .on"><b class="on" data-wcs="textContent: .n"></b></template></li></template></ul>`;
    const make = (): any => ({ items: [{ n: 1, on: true }, { n: 2, on: false }] });
    const { csr, ssr } = await compare(MARKUP, make, [
      (s) => { s["items.0.n"] = 10; },
      (s) => { s["items.1.on"] = true; },
      (s) => { s["items.0.on"] = false; },
      (s) => { s.items = [...s.items, { n: 3, on: true }]; },
      (s) => { s["items.2.on"] = false; },
    ], () => ({ n: texts(".n"), on: texts(".on") }));
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.views[2]).toEqual({ n: ["10", "2"], on: ["10", "2"] });
    expect(ssr.views[3]).toEqual({ n: ["10", "2"], on: ["2"] });
    // 足した行はクライアントが `<wcs-ssr>` から復帰したテンプレートで作る — 行のテンプレートの中の
    // if のプレースホルダが、復帰の順序で `text: <uuid>` に潰されていないこと
    expect(ssr.views[4]).toEqual({ n: ["10", "2", "3"], on: ["2", "3"] });
    expect(ssr.errors).toEqual([]);
    expect(ssr.warns).toEqual([]);
  });

  it("内側のリストが全部空の入れ子 for はハイドレートし、後から内側・外側に行を足せる", async () => {
    const MARKUP =
      `<wcs-state enable-ssr></wcs-state><div><template data-wcs="for: groups"><section><h3 data-wcs="textContent: .title"></h3>` +
      `<ul><template data-wcs="for: .items"><li class="i" data-wcs="textContent: .name"></li></template></ul></section></template></div>`;
    const make = (): any => ({ groups: [{ title: "G1", items: [] }, { title: "G2", items: [] }] });
    const { csr, ssr } = await compare(MARKUP, make, [
      (s) => { s["groups.0.items"] = [{ name: "a" }]; },
      (s) => { s["groups.1.items"] = [{ name: "b" }, { name: "c" }]; },
      (s) => { s["groups.0.items.0.name"] = "a2"; },
      (s) => { s.groups = [...s.groups, { title: "G3", items: [{ name: "d" }] }]; },
    ], () => ({ h3: texts("h3"), i: texts(".i") }));
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.views[1]).toEqual({ h3: ["G1", "G2"], i: ["a"] });
    expect(ssr.views[4]).toEqual({ h3: ["G1", "G2", "G3"], i: ["a2", "b", "c", "d"] });
    expect(ssr.errors).toEqual([]);
    expect(ssr.warns, "内側のブロックが無いので全描画には倒さない").toEqual([]);
  });

  it("サーバーで空だった if の中の for はハイドレートし、後から行を足せる", async () => {
    const MARKUP =
      `<wcs-state enable-ssr></wcs-state><template data-wcs="if: show"><ul><template data-wcs="for: items">` +
      `<li class="n" data-wcs="textContent: .n"></li></template></ul></template>`;
    const make = (): any => ({ show: true, items: [] });
    const { csr, ssr } = await compare(MARKUP, make, [
      (s) => { s.items = [{ n: 1 }, { n: 2 }]; },
      (s) => { s["items.0.n"] = 10; },
      (s) => { s.items = [s.items[1]]; },
      (s) => { s.show = false; },
      (s) => { s.show = true; },
      (s) => { s.items = [...s.items, { n: 3 }]; },
    ], () => ({ n: texts(".n") }));
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.views[2]).toEqual({ n: ["10", "2"] });
    expect(ssr.views[6]).toEqual({ n: ["2", "3"] });
    expect(ssr.errors).toEqual([]);
    expect(ssr.warns, "行が無いので全描画には倒さない").toEqual([]);
  });

  it("サーバーで偽だった if の中の for は、クライアントで真になってから描かれる", async () => {
    const MARKUP =
      `<wcs-state enable-ssr></wcs-state><template data-wcs="if: show"><ul><template data-wcs="for: items">` +
      `<li class="n" data-wcs="textContent: .n"></li></template></ul></template>`;
    const make = (): any => ({ show: false, items: [{ n: 1 }, { n: 2 }] });
    const { csr, ssr } = await compare(MARKUP, make, [
      (s) => { s.show = true; },
      (s) => { s.items = [...s.items, { n: 3 }]; },
      (s) => { s["items.0.n"] = 10; },
    ], () => ({ n: texts(".n") }));
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.views[1]).toEqual({ n: ["1", "2"] });
    expect(ssr.views[3]).toEqual({ n: ["10", "2", "3"] });
    expect(ssr.errors).toEqual([]);
    expect(ssr.warns).toEqual([]);
  });
});

describe("同じリストを回す 2 つの for（#258 の調査で発見）", () => {
  it("どちらの for も書き込みに追従する（旧: 先の for が固まり、`for: items` の適用失敗を報告した）", async () => {
    const MARKUP =
      `<wcs-state enable-ssr></wcs-state>` +
      `<ul><template data-wcs="for: items"><li class="a" data-wcs="textContent: .n"></li></template></ul>` +
      `<ol><template data-wcs="for: items"><li class="b" data-wcs="textContent: .n"></li></template></ol>`;
    const make = (): any => ({ items: [{ n: 1 }, { n: 2 }] });
    const { csr, ssr } = await compare(MARKUP, make, [
      (s) => { s["items.0.n"] = 10; },
      (s) => { s["items.1"] = { n: 20 }; },
      (s) => { s.items = [...s.items, { n: 3 }]; },
      (s) => { s.items = [s.items[2], s.items[0]]; },
    ], () => ({ a: texts(".a"), b: texts(".b") }));
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.views[3]).toEqual({ a: ["10", "20", "3"], b: ["10", "20", "3"] });
    expect(ssr.views[4]).toEqual({ a: ["3", "10"], b: ["3", "10"] });
    expect(ssr.errors).toEqual([]);
    expect(ssr.warns).toEqual([]);
  });
});

describe("穴 2（未固定だった部分）: 行の中の {{ }}", () => {
  it("行の葉への書き込み・行の getter・リストの置換に追従する", async () => {
    const make = (): any => {
      const state: any = { items: [{ n: 1 }, { n: 2 }] };
      Object.defineProperty(state, "items.*.double", {
        get(this: any) { return this["items.*.n"] * 2; },
        enumerable: false, configurable: true,
      });
      return state;
    };
    const MARKUP =
      `<wcs-state enable-ssr></wcs-state>` +
      `<ul><template data-wcs="for: items"><li class="m">n={{ items.*.n }} d={{ items.*.double }} s={{ .n }}</li></template></ul>`;
    const { csr, ssr } = await compare(MARKUP, make, [
      (s) => { s["items.0.n"] = 10; },
      (s) => { s["items.1.n"] = 20; },
      (s) => { s.items = [{ n: 7 }, { n: 8 }, { n: 9 }]; },
      (s) => { s["items.0.n"] = 70; },
    ], () => ({ m: texts(".m") }));
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.views[0]).toEqual({ m: ["n=1 d=2 s=1", "n=2 d=4 s=2"] });
    expect(ssr.views[1]).toEqual({ m: ["n=10 d=20 s=10", "n=2 d=4 s=2"] });
    expect(ssr.views[2]).toEqual({ m: ["n=10 d=20 s=10", "n=20 d=40 s=20"] });
    expect(ssr.views[4]).toEqual({ m: ["n=70 d=140 s=70", "n=8 d=16 s=8", "n=9 d=18 s=9"] });
    expect(ssr.errors).toEqual([]);
    expect(ssr.warns).toEqual([]);
  });

  it("行・if の中身の直下（要素に包まれない）の {{ }} も、ノードを動かさない収集で拾われる", async () => {
    const MARKUP =
      `<wcs-state enable-ssr></wcs-state>` +
      `<p id="row"><template data-wcs="for: items">[{{ .n }}]</template></p>` +
      `<p id="if"><template data-wcs="if: show">({{ msg }})</template></p>`;
    const make = (): any => ({ show: true, msg: "hi", items: [{ n: 1 }, { n: 2 }] });
    const { csr, ssr } = await compare(MARKUP, make, [
      (s) => { s["items.1.n"] = 20; },
      (s) => { s.msg = "yo"; },
      (s) => { s.items = [...s.items, { n: 3 }]; },
    ], () => ({ row: texts("#row"), if: texts("#if") }));
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.views[0]).toEqual({ row: ["[1][2]"], if: ["(hi)"] });
    expect(ssr.views[3]).toEqual({ row: ["[1][20][3]"], if: ["(yo)"] });
    expect(ssr.errors).toEqual([]);
  });
});

describe("行の添字（$1）", () => {
  it("SSR が描いた添字のまま始まり、並べ替え・先頭への追加で振り直される", async () => {
    const MARKUP =
      `<wcs-state enable-ssr></wcs-state><ul><template data-wcs="for: items">` +
      `<li><b class="ix" data-wcs="textContent: $1"></b><i class="n" data-wcs="textContent: .n"></i></li></template></ul>`;
    const make = (): any => ({ items: [{ n: "a" }, { n: "b" }] });
    const { csr, ssr } = await compare(MARKUP, make, [
      (s) => { s.items = [s.items[1], s.items[0]]; },
      (s) => { s.items = [{ n: "z" }, ...s.items]; },
    ], () => ({ ix: texts(".ix"), n: texts(".n") }));
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.views[0]).toEqual({ ix: ["0", "1"], n: ["a", "b"] });
    expect(ssr.views[2]).toEqual({ ix: ["0", "1", "2"], n: ["z", "b", "a"] });
    expect(ssr.errors).toEqual([]);
  });
});

describe("穴 4: 行の中・if の中の bind-component の子", () => {
  const lifecycle: string[] = [];
  const KID_BODY =
    `<wcs-state bind-component="state"></wcs-state><span class="kn" data-wcs="textContent: n"></span>` +
    `<span class="kl" data-wcs="textContent: label"></span>`;
  let seq = 0;
  function defineShadowKid(): string {
    const tag = `ssr-nested-skid-${++seq}`;
    customElements.define(tag, class extends HTMLElement {
      state: Record<string, unknown> = {};
      constructor() {
        super();
        this.attachShadow({ mode: "open" }).innerHTML = KID_BODY;
      }
      connectedCallback(): void { lifecycle.push("connected"); }
      disconnectedCallback(): void { lifecycle.push("disconnected"); }
    });
    return tag;
  }
  /**
   * Light DOM 形の中身（子の `<wcs-state>` とその束縛）はマークアップに書く（`body` を返す）。
   * connectedCallback で作ると、パーサが子を足す前に接続が来る環境（happy-dom の innerHTML・
   * 定義済みの要素を読むブラウザのパーサ）で、サーバーが描いた中身と二重になる
   */
  function defineLightKid(): string {
    const tag = `ssr-nested-lkid-${++seq}`;
    customElements.define(tag, class extends HTMLElement {
      state: Record<string, unknown> = {};
      connectedCallback(): void { lifecycle.push("connected"); }
      disconnectedCallback(): void { lifecycle.push("disconnected"); }
    });
    return tag;
  }
  const kids = (tag: string) => (): unknown => Array.from(document.querySelectorAll(tag)).map((kid) => {
    const root: ParentNode = (kid as HTMLElement).shadowRoot ?? kid;
    return `${texts(".kn", root).join()}/${texts(".kl", root).join()}`;
  });

  /** CSR の対照と比べ、ハイドレーションで子が切断されず、誤った shadow warn が出ないことを見る */
  async function kidCase(tag: string, markup: string, make: () => any, steps: Step[]): Promise<{ ssr: IRun }> {
    const csr = await run(csrMarkup(markup), make, steps, kids(tag));
    const serverHtml = await serverRender(markup, make);
    lifecycle.length = 0;
    let hydrationLifecycle: string[] = [];
    const ssr = await run(serverHtml, make, steps, () => {
      if (hydrationLifecycle.length === 0) hydrationLifecycle = [...lifecycle];
      return kids(tag)();
    });
    expect(ssr.views).toEqual(csr.views);
    expect(hydrationLifecycle.length, "子は読み込みで 1 回ずつ接続される").toBeGreaterThan(0);
    expect(hydrationLifecycle, "ハイドレーションで子を切断・再接続しない").not.toContain("disconnected");
    expect(ssr.warns.filter((w) => w.includes("mount-own-key-shadow")), "誤った mount-own-key-shadow を出さない").toEqual([]);
    expect(ssr.errors).toEqual([]);
    return { ssr };
  }

  const rowMake = (): any => ({ items: [{ n: 1, label: "a" }, { n: 2, label: "b" }] });
  const rowSteps: Step[] = [
    (s) => { s["items.0.n"] = 10; },
    (s) => { s["items.1"] = { n: 20, label: "B" }; },
    (s) => { s.items = [...s.items, { n: 3, label: "c" }]; },
  ];
  const ifMake = (): any => ({ show: true, item: { n: 1, label: "a" } });
  const ifSteps: Step[] = [
    (s) => { s["item.n"] = 10; },
    (s) => { s.item = { n: 20, label: "b" }; },
  ];

  for (const [form, define, body] of [
    ["Shadow DOM", defineShadowKid, ""],
    ["Light DOM", defineLightKid, KID_BODY],
  ] as const) {
    it(`${form}: 行の中の部分マウント（state.n: .n）が親への書き込みに追従する`, async () => {
      const tag = define();
      const { ssr } = await kidCase(tag,
        `<wcs-state enable-ssr></wcs-state><div><template data-wcs="for: items">` +
        `<${tag} data-wcs="state.n: .n; state.label: .label">${body}</${tag}></template></div>`,
        rowMake, rowSteps);
      expect(ssr.views).toEqual([["1/a", "2/b"], ["10/a", "2/b"], ["10/a", "20/B"], ["10/a", "20/B", "3/c"]]);
    });

    it(`${form}: 行の中の丸ごとマウント（state: items.*）が親への書き込みに追従する`, async () => {
      const tag = define();
      const { ssr } = await kidCase(tag,
        `<wcs-state enable-ssr></wcs-state><div><template data-wcs="for: items">` +
        `<${tag} data-wcs="state: items.*">${body}</${tag}></template></div>`,
        rowMake, rowSteps);
      expect(ssr.views).toEqual([["1/a", "2/b"], ["10/a", "2/b"], ["10/a", "20/B"], ["10/a", "20/B", "3/c"]]);
    });

    it(`${form}: if の中の部分マウントと丸ごとマウントが親への書き込みに追従する`, async () => {
      const tag = define();
      const { ssr } = await kidCase(tag,
        `<wcs-state enable-ssr></wcs-state><template data-wcs="if: show">` +
        `<${tag} data-wcs="state.n: item.n; state.label: item.label">${body}</${tag}>` +
        `<${tag} data-wcs="state: item">${body}</${tag}></template>`,
        ifMake, ifSteps);
      expect(ssr.views).toEqual([["1/a", "1/a"], ["10/a", "10/a"], ["20/b", "20/b"]]);
    });
  }
});

describe("入れ子でないものを入れ子と取り違えない・行ごとの if（#258 の検証で見つかった形）", () => {
  it("サーバー描画中に空でないリストへ行をまとめて足しても、全描画に倒さず CSR と同じ行になる", async () => {
    // 空でないリストに 1 回で 2 行以上を足すと、サーバーの終端コメントが入れ子の順に並ぶ。
    // 同じ for の行なので入れ子ではない — 倒すと SSR の行が取り残されて重複した
    const make = (): any => ({
      count: 0,
      items: [] as any[],
      async $connectedCallback(this: any) {
        for (let page = 0; page < 3; page++) {
          await new Promise((resolve) => setTimeout(resolve));
          this.items = [...this.items, { n: page * 10 + 1 }, { n: page * 10 + 2 }];
        }
      },
    });
    const MARKUP = `<wcs-state enable-ssr></wcs-state><p id="c">{{ count }}</p>`
      + `<ul><template data-wcs="for: items"><li data-wcs="textContent: .n"></li></template></ul>`;
    const observe = (): unknown => ({ c: texts("#c"), li: texts("li") });
    const { csr, ssr, serverHtml } = await compare(MARKUP, make, [(s) => { s.count = 7; }], observe);

    // 前の行の終端より先に次の行の開始が来る（入れ子の順）— この形を取り違えていた
    expect(serverHtml.search(/@@wcs-for-start:\w+:items:5/)).toBeLessThan(serverHtml.search(/@@wcs-for-end:\w+:items:4/));
    expect(ssr.warns.filter((w) => w.includes(FALLBACK))).toEqual([]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.views[0]).toEqual({ c: ["0"], li: ["1", "2", "11", "12", "21", "22"] });
  });

  it("サーバーで枝が描かれていたどの行でも、行の中の if を切り替えられ、枝が重ならない", async () => {
    const make = (): any => ({ items: [{ n: 1, on: true }, { n: 2, on: true }, { n: 3, on: true }] });
    const MARKUP = `<wcs-state enable-ssr></wcs-state>`
      + `<ul><template data-wcs="for: items"><li><template data-wcs="if: .on"><b data-wcs="textContent: .n"></b></template>`
      + `<template data-wcs="else:"><i>off</i></template></li></template></ul>`;
    const observe = (): unknown => Array.from(document.querySelectorAll("li"))
      .map((li) => Array.from(li.children).map((child) => `${child.localName}:${child.textContent}`).join(","));
    const { csr, ssr } = await compare(MARKUP, make, [
      (s) => { s["items.1.on"] = false; },
      (s) => { s["items.2.on"] = false; },
      (s) => { s["items.1.on"] = true; },
      (s) => { s["items.0.on"] = false; },
    ], observe);

    expect(ssr.views).toEqual(csr.views);
    expect(ssr.views[4]).toEqual(["i:off", "b:2", "i:off"]);
    expect(ssr.errors).toEqual([]);
  });
});
