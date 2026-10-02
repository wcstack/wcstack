/**
 * integration.ssrBlockContent.test.ts — ハイドレーションで作るブロック（`for:` の行・`if:` の枝）の Content が
 * CSR の Content と同じ形になることを、**実際のサーバー出力**から固定する（#347 / #349 / #356）。
 *
 * ハイドレーションはブロックの Content を、境界コメント（`@@wcs-*-start/end`）の間のノード**すべて**から
 * 作っていた。そこには入れ子のブロック（行の直下の `if:`・要素で包まない枝の中の `if:`）の境界と中身、
 * 差し替える前の `{{ }}` のコメントも入り、範囲モード（トップレベルに構造の置き場を持つテンプレートの
 * Content が、終端マーカーまでを自分の範囲にする）にもならなかった。外側のブロックが入れ子の置き場の束縛まで
 * 登録し、内側の Content は束縛を持たなかった。
 *
 * 契約（CSR の Content と同じ）:
 *  - ブロックの Content が持つのは自分のトップレベルのノード（`{{ }}` は差し替えた後の Text）。入れ子の
 *    ブロックの束縛と文脈は、そのブロックの Content が持つ。
 *  - トップレベルに構造の置き場を持つブロックは範囲モードで、終端マーカーで範囲を閉じる。
 *  - サーバー出力に、取り残されたブロック境界の組（祖先の `if:` が隠れた・行が消えた後の入れ子の組）を残さない。
 * どの形も `enable-ssr` を外した CSR と同じ表示で、失敗も警告も報告しない。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { write } from "./helpers/recursionTestUtils";
import { clientLoad, csrMarkup, serverRender, settle, SSR_SERVER_MODES, SsrServerMode } from "./helpers/ssrRoundTrip";
import { removeStaleBlockBoundaries } from "../src/ssr/Ssr";
import { resetSsrRenderState } from "../src/ssr/buildSsrDocument";
import { State } from "../src/components/State";
import { ssrBlockRemoval } from "../src/config";

beforeAll(() => {
  bootstrapState();
});

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Step = (s: any) => void;

interface IRun {
  views: string[];
  errors: string[];
}

const later = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

/** `#root` の表示（空白を 1 つに詰める） */
const view = (): string => (document.querySelector("#root")?.textContent ?? "").replace(/\s+/g, " ").trim();

async function run(html: string, make: () => any, steps: Step[]): Promise<IRun> {
  const errors: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(" ")); });
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(" ")); });
  try {
    const el = await clientLoad(html, make);
    const views = [view()];
    for (const step of steps) {
      write(el, step);
      await settle();
      views.push(view());
    }
    return { views, errors };
  } finally {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    await settle();
  }
}

/** サーバーの描き方（describe.each が切り替える） */
let serverMode: SsrServerMode = "orchestrated";

/** 同じマークアップを CSR とサーバー描画＋ハイドレーションで読み、同じ書き込みを流す */
async function compare(body: string, make: () => any, steps: Step[]): Promise<{ csr: IRun; ssr: IRun; serverHtml: string }> {
  const markup = `<wcs-state enable-ssr></wcs-state><div id="root">${body}</div>`;
  const csr = await run(csrMarkup(markup), make, steps);
  const serverHtml = await serverRender(markup, make, serverMode);
  const ssr = await run(serverHtml, make, steps);
  return { csr, ssr, serverHtml };
}

/** サーバー出力の `#root` の中身（`<wcs-ssr>` の外） */
function serverRoot(serverHtml: string): string {
  const host = document.createElement("div");
  host.innerHTML = serverHtml;
  return host.querySelector("#root")!.innerHTML;
}

const T = (bind: string, body: string): string => `<template data-wcs="${bind}">${body}</template>`;
const set = (key: string, value: unknown): Step => (s) => { s[key] = value; };
/** 行の書き込み。値のオブジェクトは書くたびに作る（CSR と SSR の 2 つの state に同じオブジェクトを渡さない） */
const push = (make: () => unknown): Step => (s) => { s.items = [...s.items, make()]; };

describe("#347: 行テンプレートの直下の if: と {{ }}", () => {
  const ROW_IF = `<ul>${T("for: items", `<li data-wcs="textContent: .n"></li>${T("if: .show", `<li class="x">x</li>`)}`)}</ul>`;

  it("最後の行の if: が真のとき、末尾に足した行が出る（旧: 足した行が文書に入らなかった）", async () => {
    const { csr, ssr } = await compare(ROW_IF, () => ({ items: [{ n: 1, show: false }, { n: 2, show: true }] }),
      [push(() => ({ n: 3, show: false })), push(() => ({ n: 4, show: true })), (s) => { s.items = [...s.items].reverse(); }]);
    expect(csr.views).toEqual(["12x", "12x3", "12x34x", "4x32x1"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("行が if: だけの形でも、末尾に足した行が出る", async () => {
    const body = `<ul>${T("for: items", T("if: .show", `<li data-wcs="textContent: .n"></li>`))}</ul>`;
    const { csr, ssr } = await compare(body, () => ({ items: [{ n: 1, show: true }, { n: 2, show: true }] }),
      [push(() => ({ n: 3, show: true })), set("items.1.show", false), (s) => { s.items = s.items.slice(1); }]);
    expect(csr.views).toEqual(["12", "123", "13", "3"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("サーバー描画の最後に最後の行の if: が偽になった（行に空の境界の組が残る）形でも、末尾に足した行が出る", async () => {
    const make = (): any => ({
      items: [{ n: 1, show: true }, { n: 2, show: true }],
      async $connectedCallback(this: any) {
        await later();
        this["items.1.show"] = false;
      },
    });
    const { csr, ssr, serverHtml } = await compare(ROW_IF, make, [push(() => ({ n: 3, show: true })), set("items.1.show", true)]);
    // 行 1 の if: の組は、自分の置き場の直後に空のまま残る（取り残された組ではない）
    expect(serverRoot(serverHtml)).toMatch(/<!--@@wcs-if:(\w+)--><!--@@wcs-if-start:\1:items\.\*\.show--><!--@@wcs-if-end:\1:items\.\*\.show--><!--@@wcs-for-end:\w+:items:1-->/);
    expect(csr.views).toEqual(["1x2", "1x23x", "1x2x3x"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("要素の書き込みで、else: の枝がその行に出る（旧: 一覧の末尾に出た）", async () => {
    const body = `<ul>${T("for: items", `<li data-wcs="textContent: .n"></li>${T("if: .show", `<li class="x">x</li>`)}${T("else:", `<li class="y">y</li>`)}`)}</ul>`;
    const { csr, ssr } = await compare(body, () => ({ items: [{ n: 1, show: true }, { n: 2, show: true }] }), [
      (s) => { s["items.0"] = { n: 5, show: false }; },
      set("items.0.show", true),
      set("items.1.show", false),
      (s) => { s.items = [...s.items].reverse(); },
    ]);
    expect(csr.views).toEqual(["1x2x", "5y2x", "5x2x", "5x2y", "2y5x"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("テキストだけの行で、消す・並べ替える・空にするとき値の Text も行と一緒に動く（旧: 値が行の外に残った）", async () => {
    const body = `<p>${T("for: items", "[{{ .n }}]")}</p>`;
    const { csr, ssr } = await compare(body, () => ({ items: [{ n: 1 }, { n: 2 }, { n: 3 }] }), [
      (s) => { s.items = s.items.slice(1); },
      (s) => { s.items = [...s.items].reverse(); },
      push(() => ({ n: 4 })),
      (s) => { s.items = []; },
    ]);
    expect(csr.views).toEqual(["[1][2][3]", "[2][3]", "[3][2]", "[3][2][4]", ""]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("{{ }} と if: を行の直下に並べた形（範囲モードの行が差し替えた Text を持つ）", async () => {
    const body = `<p>${T("for: items", `[{{ .n }}]${T("if: .show", "!")}`)}</p>`;
    const { csr, ssr } = await compare(body, () => ({ items: [{ n: 1, show: true }, { n: 2, show: false }, { n: 3, show: true }] }), [
      (s) => { s.items = [...s.items].reverse(); },
      set("items.1.show", true),
      (s) => { s.items = s.items.slice(1); },
      push(() => ({ n: 4, show: true })),
    ]);
    expect(csr.views).toEqual(["[1]![2][3]!", "[3]![2][1]!", "[3]![2]![1]!", "[2]![1]!", "[2]![1]![4]!"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });
});

describe.each(SSR_SERVER_MODES)("#349: サーバーが描いた枝・行の中の if: の連鎖と入れ子（サーバー: %s）", (mode) => {
  beforeAll(() => {
    serverMode = mode;
  });
  afterAll(() => {
    serverMode = "orchestrated";
  });

  const CHAIN = T("if: a", `<div>A ${T("if: b", "<i>B</i>")}${T("elseif: c", "<i>C</i>")}${T("else:", "<s>nBC</s>")}</div>`);
  const flags = (data: Record<string, boolean>) => (): any => ({ a: false, b: false, c: false, ...data });

  it("描かれた if: の枝の中の if / elseif / else で、前の枝が残らない（旧: A B nBC・A C nBC）", async () => {
    const { csr, ssr } = await compare(CHAIN, flags({ a: true, c: true }),
      [set("c", false), set("b", true), set("b", false), set("c", true)]);
    expect(csr.views).toEqual(["A C", "A nBC", "A B", "A nBC", "A C"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("サーバーが else の枝を描いた形で、外側の if: を隠して戻しても前の枝が残らない（旧: A B C）", async () => {
    const { csr, ssr } = await compare(CHAIN, flags({ a: true }),
      [set("a", false), set("a", true), set("c", true), set("b", true)]);
    expect(csr.views).toEqual(["A nBC", "", "A nBC", "A C", "A B"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("要素で包まない 3 段の if: で、中段を偽にすると最も内側の枝も消える（旧: A C）", async () => {
    const body = T("if: a", `A ${T("if: b", `B ${T("if: c", "<i>C</i>")}`)}`);
    const { csr, ssr } = await compare(body, flags({ a: true, b: true }),
      [set("c", true), set("b", false), set("b", true), set("a", false), set("a", true)]);
    expect(csr.views).toEqual(["A B", "A B C", "A", "A B C", "", "A B C"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("最も内側に else: がある 3 段の形（旧: A nC）", async () => {
    const body = T("if: a", `A ${T("if: b", `B ${T("if: c", "<i>C</i>")}${T("else:", "<s>nC</s>")}`)}`);
    const { csr, ssr } = await compare(body, flags({ a: true, b: true, c: true }),
      [set("c", false), set("b", false), set("b", true), set("c", true)]);
    expect(csr.views).toEqual(["A B C", "A B nC", "A", "A B nC", "A B C"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("for: の行の中の if / elseif / else で、前の枝が残らない（旧: I EI / I）", async () => {
    const body = `<ul>${T("for: items", `<li>${T("if: .a", "<i>I</i>")}${T("elseif: .b", "<b>EI</b>")}${T("else:", "<s>E</s>")}</li>`)}</ul>`;
    const { csr, ssr } = await compare(body, () => ({ items: [{ a: false, b: false }, { a: true, b: false }] }), [
      set("items.0.a", true), set("items.0.a", false), set("items.0.b", true), set("items.0.a", true),
      set("items.1.a", false), (s) => { s.items = [...s.items].reverse(); }, push(() => ({ a: false, b: true })),
    ]);
    expect(csr.views).toEqual(["EI", "II", "EI", "EII", "II", "IE", "EI", "EIEI"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("行の直下の if / else の枝の中の {{ }} が、行の文脈で書き込みに追従する", async () => {
    const body = `<p>${T("for: items", `${T("if: .show", "[{{ .n }}]")}${T("else:", "({{ .n }})")}`)}</p>`;
    const { csr, ssr } = await compare(body, () => ({ items: [{ n: 1, show: true }, { n: 2, show: false }] }), [
      set("items.1.n", 20), set("items.0.n", 10), set("items.0.show", false), set("items.1.show", true),
      (s) => { s.items = [...s.items].reverse(); },
    ]);
    expect(csr.views).toEqual(["[1](2)", "[1](20)", "[10](20)", "(10)(20)", "(10)[20]", "[20](10)"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });
});

describe("#356: サーバー描画の最後に隠れた if: の中の境界", () => {
  /** サーバー描画中（`$connectedCallback` の await の後）に `shown` を偽にする state */
  const hideAtEnd = (data: Record<string, unknown>) => (): any => ({
    shown: true, count: 0, ...data,
    async $connectedCallback(this: any) {
      await later();
      this.shown = false;
    },
  });
  /** 出力に残る外側の空の組（要素で包んだ形と同じ） */
  const EMPTY_SHOWN = /^<!--@@wcs-if:(\w+)--><!--@@wcs-if-start:\1:shown--><!--@@wcs-if-end:\1:shown-->$/;

  it("中身が要素で包まない if: のとき、入れ子の境界を出力に残さず、真にすると枝が出る（旧: 何も出なかった）", async () => {
    const body = `<div id="d">${T("if: shown", T("if: inner", "<b>B</b>"))}</div><p>{{ count }}</p>`;
    const { csr, ssr, serverHtml } = await compare(body, hideAtEnd({ inner: true }),
      [set("count", 1), set("shown", true), set("inner", false), set("inner", true)]);
    const host = document.createElement("div");
    host.innerHTML = serverHtml;
    expect(host.querySelector("#d")!.innerHTML).toMatch(EMPTY_SHOWN);
    expect(csr.views).toEqual(["0", "1", "B1", "1", "B1"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("中身が要素で包まない for: のとき、行の境界を出力に残さず、全描画に倒れない（旧: 既知の制限の警告）", async () => {
    const body = `<ul id="d">${T("if: shown", T("for: items", `<li data-wcs="textContent: .n"></li>`))}</ul><p>{{ count }}</p>`;
    const { csr, ssr, serverHtml } = await compare(body, hideAtEnd({ items: [{ n: 1 }, { n: 2 }] }),
      [set("count", 1), set("shown", true), push(() => ({ n: 3 })), set("shown", false)]);
    const host = document.createElement("div");
    host.innerHTML = serverHtml;
    expect(host.querySelector("#d")!.innerHTML).toMatch(EMPTY_SHOWN);
    expect(csr.views).toEqual(["0", "1", "121", "1231", "1"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("要素で包まない 3 段の外側が隠れたとき、入れ子の入れ子の境界も残さない", async () => {
    const body = `<div id="d">${T("if: shown", `A ${T("if: b", `B ${T("if: c", "<i>C</i>")}`)}`)}</div>`;
    const { csr, ssr, serverHtml } = await compare(body, hideAtEnd({ b: true, c: true }),
      [set("shown", true), set("b", false), set("b", true), set("c", false)]);
    const host = document.createElement("div");
    host.innerHTML = serverHtml;
    expect(host.querySelector("#d")!.innerHTML).toMatch(EMPTY_SHOWN);
    expect(csr.views).toEqual(["", "A B C", "A", "A B C", "A B"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  /**
   * 真のまま描き直す `if:`（サーバー描画中に条件の値が変わっても真のまま）。旧: 描き直すたびに境界の組を
   * 置き直して枝のトップレベルのノードだけを移していたので、前の組が後ろに残った。取り残された組を除く
   * ようにした後は、同じ回に先に描いた入れ子の枝・行がその前の組の中に居て、一緒に消えた
   */
  //
  // どの形も同じ回に別の `if: gone` を隠す（枝を外した印が立ち、取り残された組の探索が走る）
  // （初期値は読み込むたびに複製する — CSR と SSR の 2 つの state に同じ行のオブジェクトを渡さない）
  const rerender = (data: Record<string, unknown>, mutate: (s: any) => void) => (): any => ({
    gone: true,
    ...JSON.parse(JSON.stringify(data)),
    async $connectedCallback(this: any) {
      await later();
      mutate(this);
    },
  });
  const GONE = `<p>${T("if: gone", "<i>G</i>")}</p>`;
  const OUTER = (inner: string): string => `<div id="d">${T("if: count|gt(0)", `A ${inner}`)}</div>${GONE}`;
  const rerenderCases: [string, string, () => any, Step[], string[], number][] = [
    ["入れ子の if: は描き直しの後で適用される（旧: 前の組が空のまま後ろに残った）",
      OUTER(T("if: inner", "<b>B</b>")), rerender({ count: 1, inner: true }, (s) => { s.count = 2; s.gone = false; }),
      [set("inner", false), set("count", 0), set("count", 3)], ["A B", "A", "", "A"], 2],
    ["入れ子の if: を同じ回に先に描いた（旧: 入れ子の枝がサーバー出力から消えた）",
      OUTER(T("if: inner", "<b>B</b>")), rerender({ count: 1, inner: false }, (s) => { s.inner = true; s.count = 2; s.gone = false; }),
      [set("inner", false), set("inner", true)], ["A B", "A", "A B"], 2],
    ["入れ子の if: / else: を同じ回に先に切り替えた",
      OUTER(`${T("if: inner", "<b>B</b>")}${T("else:", "<s>nB</s>")}`), rerender({ count: 1, inner: true }, (s) => { s.inner = false; s.count = 2; s.gone = false; }),
      [set("inner", true), set("inner", false)], ["A nB", "A B", "A nB"], 2],
    ["外側が items.length の if: で、中の要素で包まない if: を先に描いた",
      `<div id="d">${T("if: items.length", `N=<span data-wcs="textContent: items.length"></span> ${T("if: flag", "<b>F</b>")}`)}</div>${GONE}`,
      rerender({ items: [1], flag: false }, (s) => { s.flag = true; s.items = [1, 2]; s.gone = false; }),
      [set("flag", false), set("flag", true)], ["N=2F", "N=2", "N=2F"], 2],
    ["行の中の if: .c|gt(0) と、その中の if: .x",
      `<ul id="d">${T("for: items", `<li>row</li>${T("if: .c|gt(0)", `C ${T("if: .x", "<b>X</b>")}`)}`)}</ul>${GONE}`,
      rerender({ items: [{ c: 1, x: false }] }, (s) => { s["items.0.x"] = true; s["items.0.c"] = 2; s.gone = false; }),
      [set("items.0.x", false), set("items.0.x", true), push(() => ({ c: 1, x: true })), (s) => { s.items = [...s.items].reverse(); }],
      ["rowC X", "rowC", "rowC X", "rowC XrowC X", "rowC XrowC X"], 2],
  ];
  for (const [name, body, make, steps, views, starts] of rerenderCases) {
    it(`真のまま描き直した if: は境界の組を置き直さない: ${name}`, async () => {
      const { csr, ssr, serverHtml } = await compare(body, make, steps);
      const host = document.createElement("div");
      host.innerHTML = serverHtml;
      const out = host.querySelector("#d")!;
      // サーバー出力の本文（空白の入り方は CSR の表示と違うので詰めて比べる）
      expect((out.textContent ?? "").replace(/\s+/g, "")).toBe(views[0].replace(/\s+/g, ""));
      expect(Array.from(out.innerHTML.matchAll(/@@wcs-if-start:/g))).toHaveLength(starts);
      expect(csr.views).toEqual(views);
      expect(ssr.views).toEqual(csr.views);
      expect(ssr.errors).toEqual([]);
    });
  }

  it("サーバー描画中に消した行の中の if: の境界を残さない", async () => {
    const body = `<ul id="d">${T("for: items", `<li data-wcs="textContent: .n"></li>${T("if: .show", `<li class="x">x</li>`)}`)}</ul>`;
    const make = (): any => ({
      items: [{ n: 1, show: true }, { n: 2, show: true }, { n: 3, show: true }],
      async $connectedCallback(this: any) {
        await later();
        this.items = [this.items[0], this.items[2]];
      },
    });
    const { csr, ssr, serverHtml } = await compare(body, make, [push(() => ({ n: 4, show: false })), set("items.1.show", false)]);
    const host = document.createElement("div");
    host.innerHTML = serverHtml;
    expect(Array.from(host.querySelector("#d")!.innerHTML.matchAll(/@@wcs-if-start:/g))).toHaveLength(2);
    expect(csr.views).toEqual(["1x3x", "1x3x4", "1x34"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });
});

describe("#356: removeStaleBlockBoundaries（手で組んだ出力）", () => {
  it("行の組は置き場の直後か同じ for: の生きている前の行の直後なら残し、そうでなければ中身ごと除く", () => {
    const host = document.createElement("div");
    const liveRows = "<!--@@wcs-for:u1--><!--@@wcs-for-start:u1:items:0--><li>a</li><!--@@wcs-for-end:u1:items:0-->"
      + "<!--@@wcs-for-start:u1:items:1--><li>b</li><!--@@wcs-for-end:u1:items:1-->";
    // 別の for: の生きている行の直後に居る行と、その中の if: の組（外側と一緒に外れる）
    const staleRows = "<!--@@wcs-for-start:u2:list:0--><!--@@wcs-if-start:u3:x--><!--@@wcs-if-end:u3:x--><!--@@wcs-for-end:u2:list:0-->"
      + "<!--@@wcs-for-start:u2:list:1--><!--@@wcs-for-end:u2:list:1-->";
    // 置き場が前に無い（親の先頭に居る）枝の組
    const staleFirst = "<div><!--@@wcs-if-start:u4:y--><!--@@wcs-if-end:u4:y--><b></b></div>";
    host.innerHTML = liveRows + staleRows + "<i></i>" + staleFirst;
    removeStaleBlockBoundaries(host);
    expect(host.innerHTML).toBe(liveRows + "<i></i><div><b></b></div>");
  });
});

describe("#356: 取り残された組を探すのは、サーバー描画中に描いた枝・行を外したときだけ", () => {
  /** サーバーとして描き、`<wcs-ssr>` を書き出す前の印を返す（serverRender と同じ手順で、後始末の前に読む） */
  async function removalSeen(body: string, make: () => any): Promise<boolean> {
    document.documentElement.setAttribute("data-wcs-server", "");
    try {
      document.body.innerHTML = `<wcs-state enable-ssr></wcs-state><div id="root">${body}</div>`;
      const el = document.querySelector("wcs-state") as State;
      el.setInitialState(make());
      await el.connectedCallbackPromise;
      await State.getBindingsReady(document);
      await settle();
      return ssrBlockRemoval.seen;
    } finally {
      document.documentElement.removeAttribute("data-wcs-server");
      document.body.innerHTML = "";
      resetSsrRenderState();
    }
  }
  const afterAwait = (data: Record<string, unknown>, mutate: (s: any) => void) => (): any => ({
    ...data,
    async $connectedCallback(this: any) {
      await later();
      mutate(this);
    },
  });
  const ROWS = `<ul>${T("for: items", `<li data-wcs="textContent: .n"></li>`)}</ul>`;

  it("最初から偽の if:・行を足すだけ・真のまま描き直す if: では印が立たない", async () => {
    expect(await removalSeen(`${T("if: a", "<b>A</b>")}${T("if: count|gt(0)", "<i>C</i>")}${ROWS}`,
      afterAwait({ a: false, count: 1, items: [{ n: 1 }] }, (s) => { s.count = 2; s.items = [...s.items, { n: 2 }]; }))).toBe(false);
  });

  it("描いた if: を隠すと立ち、後始末で下りる", async () => {
    expect(await removalSeen(T("if: a", "<b>A</b>"), afterAwait({ a: true }, (s) => { s.a = false; }))).toBe(true);
    expect(ssrBlockRemoval.seen).toBe(false);
  });

  it("行を消すと立つ", async () => {
    expect(await removalSeen(ROWS, afterAwait({ items: [{ n: 1 }, { n: 2 }] }, (s) => { s.items = s.items.slice(1); }))).toBe(true);
  });
});
