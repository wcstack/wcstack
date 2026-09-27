/**
 * integration.ssrStructuralFilters.test.ts — `<wcs-ssr>` のテンプレートが構造束縛（`for:` / `if:` / `elseif:`）の
 * 出力フィルタを運ぶことを、**実際のサーバー出力**から固定する。
 *
 * スナップショットはテンプレートの束縛を `${bindingType}: ${statePathName}` と組み直していたので、フィルタが
 * 落ちた。`if: x|not` は `if: x` としてハイドレーションされ、条件が反転した（`x=true` で出て `x=false` で消えた）。
 * `else:` はクライアントが直前の `if:` の否定として組むので、フィルタの無い条件の否定になった。
 *
 * 契約: 構造束縛の文は出力フィルタ（名前と引数）ごと書き出す。読み直すと同じ引数と値（要件 B9 の型付きの値）
 * になる。どの形も `enable-ssr` を外した CSR と同じ表示で、失敗も警告も報告しない。フィルタの無い束縛の文は
 * 従来と同じ（修正前のサーバー出力もそのまま読める）。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { parseBindTextsForElement } from "../src/bindTextParser/parseBindTextsForElement";
import { registerFilters } from "../src/core/filterRegistry";
import { structuralBindText } from "../src/ssr/Ssr";
import { write } from "./helpers/recursionTestUtils";
import { clientLoad, csrMarkup, serverRender, settle } from "./helpers/ssrRoundTrip";

beforeAll(() => {
  bootstrapState();
  // 配列を返す出力フィルタ（`for:` のフィルタの確かめ用。組み込みには配列を返すものが無い）
  registerFilters("output", {
    take: (options) => (value: unknown) => (value as unknown[]).slice(0, Number(options?.[0])),
  });
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

async function compare(body: string, make: () => any, steps: Step[]): Promise<{ csr: IRun; ssr: IRun; serverHtml: string }> {
  const markup = `<wcs-state enable-ssr></wcs-state><div id="root">${body}</div>`;
  const csr = await run(csrMarkup(markup), make, steps);
  const serverHtml = await serverRender(markup, make);
  const ssr = await run(serverHtml, make, steps);
  return { csr, ssr, serverHtml };
}

/** 属性値の `"` は実体参照にする（束縛の文の引用符をそのまま書ける） */
const T = (bind: string, body: string): string => `<template data-wcs="${bind.replace(/"/g, "&quot;")}">${body}</template>`;
const set = (key: string, value: unknown): Step => (s) => { s[key] = value; };

/** スナップショットのテンプレートの束縛の文（文書順） */
function snapshotBindTexts(serverHtml: string): string[] {
  const host = document.createElement("div");
  host.innerHTML = serverHtml;
  return Array.from(host.querySelectorAll("wcs-ssr template")).map((tpl) => tpl.getAttribute("data-wcs") ?? "");
}

describe("構造束縛の出力フィルタをスナップショットに書き出す", () => {
  it("if: x|not と else: が反転しない（旧: x=true で出て x=false で消え、else: も反転した）", async () => {
    const body = `${T("if: x|not", "<b>notX</b>")}${T("else:", "<i>X</i>")}`;
    const { csr, ssr, serverHtml } = await compare(body, () => ({ x: false }), [set("x", true), set("x", false)]);
    expect(snapshotBindTexts(serverHtml)).toEqual(["if: x|not", "else:"]);
    expect(csr.views).toEqual(["notX", "X", "notX"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("複数のフィルタ・引数付きのフィルタ・elseif: の連鎖", async () => {
    const body = `${T("if: n|gt(3)|not", "<b>small</b>")}${T("elseif: n|eq(10)", "<i>ten</i>")}${T("else:", "<s>big</s>")}`;
    const { csr, ssr, serverHtml } = await compare(body, () => ({ n: 1 }), [set("n", 5), set("n", 10), set("n", 2)]);
    expect(snapshotBindTexts(serverHtml)).toContain("if: n|gt(3)|not");
    expect(snapshotBindTexts(serverHtml)).toContain("elseif: n|eq(10)");
    expect(csr.views).toEqual(["small", "big", "ten", "small"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("行の中の if: $1|eq(0) と if: .n|gt(3)", async () => {
    const body = `<ul>${T("for: items", `<li>${T("if: $1|eq(0)", "<b>first</b>")}<span data-wcs="textContent: .n"></span>${T("if: .n|gt(3)", "<i>!</i>")}${T("else:", "<s>-</s>")}</li>`)}</ul>`;
    const { csr, ssr } = await compare(body, () => ({ items: [{ n: 1 }, { n: 5 }, { n: 2 }] }), [
      set("items.0.n", 9), (s) => { s.items = [...s.items].reverse(); }, (s) => { s.items = s.items.slice(1); },
    ]);
    expect(csr.views).toEqual(["first1-5!2-", "first9!5!2-", "first2-5!9!", "first5!9!"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("文字列の引数（区切り・空白・引用符を含む）も同じ値で読み直される", async () => {
    const body = `${T(`if: label|eq("a, b")`, "<b>AB</b>")}${T(`if: label|eq('it'"'"'s "x"')`, "<i>Q</i>")}${T("if: label|eq( ' ' )", "<s>SP</s>")}`;
    const { csr, ssr } = await compare(body, () => ({ label: "a, b" }), [set("label", `it's "x"`), set("label", " "), set("label", "a, b")]);
    expect(csr.views).toEqual(["AB", "Q", "SP", "AB"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("for: のフィルタ", async () => {
    const body = `<ul>${T("for: items|take(2)", `<li data-wcs="textContent: .n"></li>`)}</ul>`;
    const { csr, ssr, serverHtml } = await compare(body, () => ({ items: [{ n: 1 }, { n: 2 }, { n: 3 }] }), [
      (s) => { s.items = [{ n: 0 }, ...s.items]; }, set("items.1.n", 7), (s) => { s.items = s.items.slice(2); },
    ]);
    expect(snapshotBindTexts(serverHtml)).toEqual(["for: items|take(2)"]);
    expect(csr.views).toEqual(["12", "01", "07", "23"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("バージョン不一致の全描画もテンプレートのフィルタを保つ（旧: 全描画も if: x として描いた）", async () => {
    const body = `${T("if: x|not", "<b>notX</b>")}${T("else:", "<i>X</i>")}`;
    const make = (): any => ({ x: false });
    const serverHtml = (await serverRender(`<wcs-state enable-ssr></wcs-state><div id="root">${body}</div>`, make))
      .replace(/<wcs-ssr version="[^"]*"/, '<wcs-ssr version="0.0.1"');
    const ssr = await run(serverHtml, make, [set("x", true), set("x", false)]);
    expect(ssr.views).toEqual(["notX", "X", "notX"]);
    expect(ssr.errors).toEqual([expect.stringContaining("SSR version mismatch")]);
  });

  it("フィルタの無い束縛の文は従来のまま（修正前のサーバー出力と同じ）", async () => {
    const body = `${T("if: a", `<ul>${T("for: items", "<li>{{ .n }}</li>")}</ul>`)}${T("elseif: b", "<b>B</b>")}${T("else:", "<i>none</i>")}`;
    const serverHtml = await serverRender(`<wcs-state enable-ssr></wcs-state><div id="root">${body}</div>`,
      () => ({ a: true, b: false, items: [{ n: 1 }] }));
    expect(snapshotBindTexts(serverHtml).sort()).toEqual(["else:", "else:", "elseif: b", "for: items", "if: a"]);
  });

  it("フィルタを落とした修正前のスナップショットも、これまでどおり読める", async () => {
    const body = `${T("if: n|gt(3)", "<b>big</b>")}<p>{{ n }}</p>`;
    const make = (): any => ({ n: 5 });
    const serverHtml = (await serverRender(`<wcs-state enable-ssr></wcs-state><div id="root">${body}</div>`, make))
      .replace(`data-wcs="if: n|gt(3)"`, `data-wcs="if: n"`);
    const ssr = await run(serverHtml, make, [set("n", 6)]);
    expect(ssr.views).toEqual(["big5", "big6"]);
    expect(ssr.errors).toEqual([]);
  });
});

describe("structuralBindText", () => {
  it("読み直すと同じ出力フィルタ（名前・引数・型付きの値）になる", () => {
    const source = `if: v|f(0, "0", -1.5e3, true, null, a b, '', " x ", 'it'"'"'s', "a,b|c(d)")|g()|h`;
    const [parsed] = parseBindTextsForElement(source);
    const [reparsed] = parseBindTextsForElement(structuralBindText(parsed));
    expect(reparsed.bindingType).toBe("if");
    expect(reparsed.statePathName).toBe("v");
    expect(reparsed.outFilters).toEqual(parsed.outFilters);
  });

  it("型付きの値を持たないフィルタ（組み立てた側が省略した形）は、引数を文字列として書く", () => {
    const [parsed] = parseBindTextsForElement("if: v");
    const text = structuralBindText({ ...parsed, outFilters: [{ filterName: "eq", args: ["1"] }] });
    expect(text).toBe("if: v|eq('1')");
  });
});
