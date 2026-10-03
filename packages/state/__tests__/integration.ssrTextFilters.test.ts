/**
 * integration.ssrTextFilters.test.ts — server-rendered `{{ }}` / `<!--@@: -->` text keeps its output filters
 * after hydration, pinned from **real server output** (#373, and symptom 1 of #372).
 *
 * The server wrote only the binding's path (`statePathName`) into a text binding's boundary comments
 * (`<!--@@wcs-text-start:…-->` / `<!--@@wcs-text-end:…-->`). The client (Ssr.restoreTextBindings) turns
 * everything after the `:` back into `<!--@@: …-->`, so `{{ price|toFixed(2) }}` was restored as a filterless
 * `price`: it showed `3.14159` instead of `3.14`, and later writes skipped the filter too. Server-rendered rows
 * and branches are adopted the same way. Inside a Light DOM `bind-component` child the path was already
 * translated to the host's vocabulary, which the child's scope cannot translate again, so the text hydrated
 * empty for good (#372, symptom 1).
 *
 * Contract: the boundary comments carry the binding's expression (path and output filters) — the original text
 * for a binding from a comment (the child's vocabulary inside a child), the serialized path and filters for text
 * cloned from a template into a row or a branch. Every form shows what the same page shows without
 * `enable-ssr` (CSR) and reports nothing. An expression a comment cannot hold (one with `--`, …) is written as
 * its path alone, as before. The reader (restoreTextBindings) is unchanged, so 3.x clients from before the fix
 * read this output too.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { parseBindTextsForElement } from "../src/bindTextParser/parseBindTextsForElement";
import { textMarker } from "../src/ssr/Ssr";
import type { IBindingInfo } from "../src/types";
import { write } from "./helpers/recursionTestUtils";
import { clientLoad, csrMarkup, serverRender, settle, SSR_SERVER_MODES, type SsrServerMode } from "./helpers/ssrRoundTrip";

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

/** The text of each `.v` in `#root`, in document order, whitespace collapsed */
const view = (): string => Array.from(document.querySelectorAll("#root .v"),
  (el) => (el.textContent ?? "").replace(/\s+/g, " ").trim()).join(" / ");

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

const page = (body: string): string => `<wcs-state enable-ssr></wcs-state><div id="root">${body}</div>`;

async function compare(body: string, data: Record<string, unknown>, steps: Step[], mode: SsrServerMode = "orchestrated")
  : Promise<{ csr: IRun; ssr: IRun; serverHtml: string }> {
  const make = (): any => structuredClone(data);
  const csr = await run(csrMarkup(page(body)), make, steps);
  const serverHtml = await serverRender(page(body), make, mode);
  const ssr = await run(serverHtml, make, steps);
  return { csr, ssr, serverHtml };
}

const T = (bind: string, body: string): string => `<template data-wcs="${bind}">${body}</template>`;
const set = (key: string, value: unknown): Step => (s) => { s[key] = value; };
/** A boundary comment pair (the start and the end carry the same expression) */
const marked = (expression: string, text: string): string =>
  `<!--@@wcs-text-start:${expression}-->${text}<!--@@wcs-text-end:${expression}-->`;

let seq = 0;
/** A Light DOM child (a partial mount). Its content (the child's `<wcs-state>` and bindings) is in the markup */
function defineKid(): string {
  const tag = `ssr-text-kid-${++seq}`;
  customElements.define(tag, class extends HTMLElement { state: Record<string, unknown> = {}; });
  return tag;
}

describe.each(SSR_SERVER_MODES)("#373: ページ直下の {{ }} の出力フィルタ（%s）", (mode) => {
  it("{{ }}・<!--@@: -->・フィルタの連鎖が、読み込み直後も書き込み後も CSR と同じ（旧: フィルタの無い値を出した）", async () => {
    const body = `<p class="v">{{ price|toFixed(2) }}</p><p class="v"><!--@@: price|toFixed(2) --></p>` +
      `<p class="v">[{{ name|upper|trim }}]</p>`;
    const { csr, ssr, serverHtml } = await compare(body, { price: 3.14159, name: "  alice  " },
      [set("price", 2.71828), set("name", "  bob  ")], mode);
    // The markers carry the expression (a binding from a comment: its original text)
    expect(serverHtml).toContain(marked("price|toFixed(2)", "3.14"));
    expect(serverHtml).toContain(marked("name|upper|trim", "ALICE"));
    expect(csr.views).toEqual(["3.14 / 3.14 / [ALICE]", "2.72 / 2.72 / [ALICE]", "2.72 / 2.72 / [BOB]"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });
});

describe("#373: 行・枝・子の中の {{ }} の出力フィルタ", () => {
  it("文字列の引数（引用符・区切り・空白を含む）も同じ値で読み直される — ページ直下と行", async () => {
    const body = `<p class="v">{{ code|padStart(5, '*') }}</p><p class="v">{{ w|unit(", kg") }}</p>` +
      `<ul>${T("for: items", `<li class="v">{{ .code|padStart(4, "0") }}{{ .w|unit(' it'"'"'s') }}</li>`)}</ul>`;
    const { csr, ssr, serverHtml } = await compare(body, { code: 42, w: 5, items: [{ code: 7, w: 1 }] },
      [set("code", 3), set("items.0.code", 12), (s) => { s.items = [...s.items, { code: 5, w: 2 }]; }]);
    expect(serverHtml).toContain(marked(`code|padStart(5, '*')`, "***42"));
    // Row text serializes the path and the filters: string arguments as '…' (a ' joined through "'"), typed values verbatim
    expect(serverHtml).toContain(marked(`items.*.code|padStart(4,'0')`, "0007"));
    expect(serverHtml).toContain(`<!--@@wcs-text-start:items.*.w|unit(' it'"'"'s')-->`);
    expect(csr.views).toEqual([
      "***42 / 5, kg / 00071 it's",
      "****3 / 5, kg / 00071 it's",
      "****3 / 5, kg / 00121 it's",
      "****3 / 5, kg / 00121 it's / 00052 it's",
    ]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("for: の行: 要素の書き込み・行の追加（クライアントで作る行）・並べ替えで CSR と同じ（旧: サーバーの行がフィルタを失った）", async () => {
    const body = `<ul>${T("for: items", `<li class="v">{{ .price|toFixed(2) }}</li>`)}</ul>`;
    const { csr, ssr, serverHtml } = await compare(body, { items: [{ price: 1.23456 }, { price: 2.5 }] }, [
      set("items.0.price", 9.87654),
      (s) => { s.items = [...s.items, { price: 7.777 }]; },
      (s) => { s.items = [...s.items].reverse(); },
    ]);
    expect(serverHtml).toContain(marked("items.*.price|toFixed(2)", "1.23"));
    expect(csr.views).toEqual(["1.23 / 2.50", "9.88 / 2.50", "9.88 / 2.50 / 7.78", "7.78 / 2.50 / 9.88"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("if: の枝: 書き込みと false → true の切り替えで CSR と同じ（旧: 引き取った枝が使い回され、フィルタが戻らなかった）", async () => {
    const body = `<div>${T("if: show", `<span class="v">{{ price|toFixed(2) }}</span>`)}</div>`;
    const { csr, ssr, serverHtml } = await compare(body, { show: true, price: 3.14159 },
      [set("price", 2.71828), set("show", false), set("show", true), set("price", 1.23456)]);
    expect(serverHtml).toContain(marked("price|toFixed(2)", "3.14"));
    expect(csr.views).toEqual(["3.14", "2.72", "", "2.72", "1.23"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("行の {{ $1|… }}: 追加・削除で CSR と同じ", async () => {
    const body = `<ul>${T("for: items", `<li class="v">{{ $1|add(1) }}:{{ .id|upper }}</li>`)}</ul>`;
    const { csr, ssr, serverHtml } = await compare(body, { items: [{ id: "a" }, { id: "b" }] }, [
      (s) => { s.items = [...s.items, { id: "c" }]; },
      (s) => { s.items = s.items.slice(1); },
    ]);
    expect(serverHtml).toContain(marked("$1|add(1)", "1"));
    expect(csr.views).toEqual(["1:A / 2:B", "1:A / 2:B / 3:C", "1:B / 2:C"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("#372 の症状 1: Light DOM の bind-component の子の {{ p|toFixed(2) }}（別名の配線）が子の語彙で復元される（旧: 空のまま戻らなかった）", async () => {
    const tag = defineKid();
    const body = `<${tag} data-wcs="state.p: price"><wcs-state bind-component="state"></wcs-state>` +
      `<span class="v">{{ p|toFixed(2) }}</span><span class="v">{{ p }}</span></${tag}>`;
    const { csr, ssr, serverHtml } = await compare(body, { price: 3.14159 }, [set("price", 2.71828)]);
    // The child's binding carries the expression the child wrote, not the host's path (price)
    expect(serverHtml).toContain(marked("p|toFixed(2)", "3.14"));
    expect(serverHtml).toContain(marked("p", "3.14159"));
    expect(csr.views).toEqual(["3.14 / 3.14159", "2.72 / 2.71828"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("ページの for: の行・if: の枝の中に置いた子の {{ p|toFixed(2) }} も子の語彙で復元される（旧: 空のまま戻らなかった）", async () => {
    const tag = defineKid();
    const kid = (wiring: string): string =>
      `<${tag} data-wcs="${wiring}"><wcs-state bind-component="state"></wcs-state><span class="v">{{ p|toFixed(2) }}</span></${tag}>`;
    const body = `<ul>${T("for: items", `<li>${kid("state.p: .price")}</li>`)}</ul><div>${T("if: show", kid("state.p: price"))}</div>`;
    const { csr, ssr, serverHtml } = await compare(body, { price: 3.14159, show: true, items: [{ price: 1.23456 }] }, [
      set("items.0.price", 9.87654), (s) => { s.items = [...s.items, { price: 7.777 }]; },
      set("price", 2.71828), set("show", false), set("show", true),
    ]);
    // Inside a template the child's binding is cloned as a comment (the child's scope binds it), so it carries its original text
    expect(serverHtml).toContain(marked("p|toFixed(2)", "1.23"));
    expect(serverHtml).toContain(marked("p|toFixed(2)", "3.14"));
    expect(csr.views).toEqual([
      "1.23 / 3.14", "9.88 / 3.14", "9.88 / 7.78 / 3.14", "9.88 / 7.78 / 2.72", "9.88 / 7.78", "9.88 / 7.78 / 2.72",
    ]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("子の if: の枝の {{ }}（別名の配線）: 枝のテキストはパス（ホストの語彙）とフィルタを運び、CSR と同じ", async () => {
    const tag = defineKid();
    const body = `<${tag} data-wcs="state.p: price; state.on: show"><wcs-state bind-component="state"></wcs-state>` +
      `${T("if: on", `<span class="v">{{ p|toFixed(2) }}</span>`)}</${tag}>`;
    const { csr, ssr, serverHtml } = await compare(body, { price: 3.14159, show: true },
      [set("price", 2.71828), set("show", false), set("show", true)]);
    // The child's templates are registered with translated parses, so the branch text's expression is in the host's
    // vocabulary. Hydration adopts this branch in the page's scope (#372, cause (b)), where that resolves
    expect(serverHtml).toContain(marked("price|toFixed(2)", "3.14"));
    expect(csr.views).toEqual(["3.14", "2.72", "", "2.72"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("バージョン不一致の全描画でも、ページ直下・行・枝の {{ }} がフィルタを保つ（旧: ページ直下のテキストだけが落ちた）", async () => {
    const body = `<p class="v">{{ price|toFixed(2) }}</p><p class="v"><!--@@: name|upper|trim --></p>` +
      `<ul>${T("for: items", `<li class="v">{{ .price|toFixed(2) }}</li>`)}</ul>` +
      `<div>${T("if: show", `<span class="v">{{ price|toFixed(1) }}</span>`)}</div>`;
    const make = (): any => ({ price: 3.14159, name: "  alice  ", show: true, items: [{ price: 1.23456 }] });
    const steps: Step[] = [set("price", 2.71828), set("items.0.price", 9.87654), set("show", false), set("show", true)];
    const csr = await run(csrMarkup(page(body)), make, steps);
    const serverHtml = (await serverRender(page(body), make)).replace(/<wcs-ssr version="[^"]*"/, '<wcs-ssr version="0.0.1"');
    const ssr = await run(serverHtml, make, steps);
    expect(csr.views).toEqual([
      "3.14 / ALICE / 1.23 / 3.1",
      "2.72 / ALICE / 1.23 / 2.7",
      "2.72 / ALICE / 9.88 / 2.7",
      "2.72 / ALICE / 9.88",
      "2.72 / ALICE / 9.88 / 2.7",
    ]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([expect.stringContaining("SSR version mismatch")]);
  });

  it("コメントに入れられない式（-- を含む）はパスだけを書き、ページを壊さない（ほかのテキストはフィルタを保つ）", async () => {
    const body = `<p class="v">{{ label|unit(' --') }}</p><p class="v">{{ price|toFixed(2) }}</p>` +
      `<ul>${T("for: items", `<li class="v">{{ .label|unit('a--b') }}</li>`)}</ul>`;
    const { csr, ssr, serverHtml } = await compare(body, { label: "x", price: 3.14159, items: [{ label: "y" }] },
      [set("price", 2.71828)]);
    // An expression with `--` cannot go into a comment (`-->` would end it early): the path alone, as before
    expect(serverHtml).toContain(marked("label", "x --"));
    expect(serverHtml).toContain(marked("items.*.label", "ya--b"));
    expect(serverHtml).toContain(marked("price|toFixed(2)", "3.14"));
    expect(csr.views).toEqual(["x -- / 3.14 / ya--b", "x -- / 2.72 / ya--b"]);
    // A binding that fell back to its path shows the unfiltered value (as before the fix; a known limit). The rest match CSR
    expect(ssr.views).toEqual(["x / 3.14 / y", "x / 2.72 / y"]);
    expect(ssr.errors).toEqual([]);
  });
});

describe("textMarker（境界コメントに書く式）", () => {
  /** A parsed binding on the given node (a comment, or a Text cloned from a template) */
  function bindingOf(source: string, node: Node, statePathName?: string): IBindingInfo {
    const [parsed] = parseBindTextsForElement(`textContent: ${source}`);
    return {
      ...parsed,
      bindingType: "text",
      ...(statePathName !== undefined ? { statePathName } : {}),
      inFilters: [],
      outFilters: parsed.outFilters as IBindingInfo["outFilters"],
      node,
      replaceNode: node,
    } as IBindingInfo;
  }

  it("コメント由来の束縛はコメントの原文（翻訳前の語彙・書いたままの空白）を返す", () => {
    const comment = document.createComment("@@:  p | toFixed(2)  ");
    expect(textMarker(bindingOf("p|toFixed(2)", comment, "price"))).toBe("p | toFixed(2)");
    expect(textMarker(bindingOf("name", document.createComment("@@wcs-text: name|upper|trim"), "name"))).toBe("name|upper|trim");
  });

  it("束縛のコメントとして読めないコメント（防御的な経路）はパスだけを返す", () => {
    expect(textMarker(bindingOf("price|toFixed(2)", document.createComment("just a comment"), "price"))).toBe("price");
  });

  it("Text の束縛はパスとフィルタを直列化し、読み直すと同じフィルタ（名前・引数・型付きの値）になる", () => {
    const source = `v|f(0, "0", -1.5e3, true, null, a b, '', " x ", 'it'"'"'s', "a,b|c(d)")|g()|h`;
    const binding = bindingOf(source, document.createTextNode(""));
    const marker = textMarker(binding);
    expect(marker).toBe(`v|f(0,'0',-1.5e3,true,null,'a b','',' x ','it'"'"'s','a,b|c(d)')|g|h`);
    const [reparsed] = parseBindTextsForElement(`textContent: ${marker}`);
    expect(reparsed.statePathName).toBe("v");
    expect(reparsed.outFilters).toEqual(binding.outFilters);
  });

  it("コメントに入れられない式はパスだけを返す（-- ・ --> ・ --!> ・末尾の - ・改行）", () => {
    const text = (): Node => document.createTextNode("");
    expect(textMarker(bindingOf(`v|unit('a--b')`, text()))).toBe("v");
    expect(textMarker(bindingOf(`v|unit('-->')`, text()))).toBe("v");
    expect(textMarker(bindingOf(`v|unit('--!>')`, text()))).toBe("v");
    expect(textMarker(bindingOf(`v|unit(' --')`, document.createComment(`@@: v|unit(' --')`), "v"))).toBe("v");
    expect(textMarker(bindingOf("v-", document.createComment("@@: v-"), "x"))).toBe("x");
    const multiline = bindingOf("v", text());
    expect(textMarker({ ...multiline, outFilters: [{ filterName: "unit", args: ["a\nb"], literals: ["a\nb"], filterFn: (x: unknown) => x }] }))
      .toBe("v");
    // Single `-` characters are fine
    expect(textMarker(bindingOf(`v|unit('-')|unit('a-b')`, text()))).toBe(`v|unit('-')|unit('a-b')`);
  });
});
