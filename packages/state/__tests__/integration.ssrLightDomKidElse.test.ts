/**
 * integration.ssrLightDomKidElse.test.ts — Light DOM の `bind-component` の子が `if:` を持つページの `else:` の
 * 組み方を、**実際のサーバー出力**から固定する（#348）。
 *
 * ページのスコープは入れ子の Light DOM コンポーネントを走査から外す（collectStructuralFragments）ので、子の
 * `if:` はページのテンプレートの中身に `<template>` のまま居て、置き場を持たない。ハイドレーションは `else:` を
 * 同じ階層の直前の `if:` と組む（#336）が、階層を置き場を中身に持つテンプレートで決めていたので、子の `if:` は
 * 文書の直下とみなされ、スナップショットの並び（外側の `if:` → 子の `if:` → 外側の `else:`）でページの
 * `else:` が子の `if:` の否定になった（外側を偽にしても else が出ず、子を偽にすると外側の else が出た）。
 *
 * 契約: 子のテンプレートの階層は、生きている DOM の置き場を囲む一番内側の子（子は自分のスコープで組む —
 * CSR と同じ）。どの形も `enable-ssr` を外した CSR と同じ表示で、失敗を報告しない。
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

let seq = 0;
/** Light DOM の子（部分マウント）。中身（子の `<wcs-state>` とテンプレート）はマークアップに書く */
function defineKid(): string {
  const tag = `ssr-kid-else-${++seq}`;
  customElements.define(tag, class extends HTMLElement { state: Record<string, unknown> = {}; });
  return tag;
}

async function compare(body: (tag: string) => string, data: Record<string, unknown>, steps: Step[])
  : Promise<{ csr: IRun; ssr: IRun; serverHtml: string }> {
  const tag = defineKid();
  const markup = `<wcs-state enable-ssr></wcs-state><div id="root">${body(tag)}</div>`;
  const make = (): any => structuredClone(data);
  const csr = await run(csrMarkup(markup), make, steps);
  const serverHtml = await serverRender(markup, make);
  const ssr = await run(serverHtml, make, steps);
  return { csr, ssr, serverHtml };
}

const T = (bind: string, body: string): string => `<template data-wcs="${bind}">${body}</template>`;
const kid = (tag: string, bind: string, inner: string): string =>
  `<${tag} data-wcs="${bind}"><wcs-state bind-component="state"></wcs-state>${inner}</${tag}>`;
const set = (key: string, value: unknown): Step => (s) => { s[key] = value; };

describe("#348: Light DOM の子の if と、ページの else", () => {
  it("if の枝の中の子の if: ページの else はページの if の否定（旧: a=false で何も出ず、x=false で notA が出た）", async () => {
    const { csr, ssr, serverHtml } = await compare(
      (tag) => T("if: a", `<div>A ${kid(tag, "state.x: x", T("if: x", "<i>X</i>"))}</div>`) + T("else:", "<p>notA</p>"),
      { a: true, x: true },
      [set("a", false), set("a", true), set("x", false), set("x", true), set("a", false)]);
    // 子のテンプレートはスナップショットに載り、ページの if と else の間に並ぶ（この並びが旧実装で組み違えた）
    expect(serverHtml.match(/<template id="[^"]+" data-wcs="[^"]+"/g)).toEqual([
      expect.stringContaining('"if: a"'), expect.stringContaining('"if: x"'), expect.stringContaining('"else:"'),
    ]);
    expect(csr.views).toEqual(["A X", "notA", "A X", "A", "A X", "notA"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("子の if に else がある形: ページの else も子の else もそれぞれの if と組む（旧: a=false で何も出なかった）", async () => {
    const { csr, ssr } = await compare(
      (tag) => T("if: a", `<div>A ${kid(tag, "state.x: x", T("if: x", "<i>X</i>") + T("else:", "<s>nX</s>"))}</div>`) +
        T("else:", "<p>notA</p>"),
      { a: true, x: true },
      [set("a", false), set("a", true), set("x", false), set("a", false), set("a", true), set("x", true)]);
    expect(csr.views).toEqual(["A X", "notA", "A X", "A nX", "notA", "A nX", "A X"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("for の行の中の子の if: 一覧の前後のページの if / else が組む（旧: a=false で notA が出なかった）", async () => {
    const { csr, ssr } = await compare(
      (tag) => T("if: a", "<p>A</p>") +
        `<ul>${T("for: items", `<li>${kid(tag, "state.x: .x", T("if: x", "<i>X</i>"))}</li>`)}</ul>` + T("else:", "<p>notA</p>"),
      { a: true, items: [{ x: true }, { x: true }] },
      [set("a", false), set("a", true), set("items.0.x", false), set("a", false)]);
    expect(csr.views).toEqual(["AXX", "XXnotA", "AXX", "AX", "XnotA"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("ページの if と else の間に置いた子（枝の外）の if も、ページの else と組まない", async () => {
    const { csr, ssr } = await compare(
      (tag) => T("if: a", "<p>A</p>") + kid(tag, "state.x: x", T("if: x", "<i>X</i>")) + T("else:", "<p>notA</p>"),
      { a: true, x: true },
      [set("a", false), set("x", false), set("a", true), set("x", true)]);
    expect(csr.views).toEqual(["AX", "XnotA", "notA", "A", "AX"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("子の if の枝の中の if と子の else: 子の中でも階層ごとに組む（入れ子の置き場はテンプレートの中身の階層が勝つ）", async () => {
    const { csr, ssr } = await compare(
      (tag) => T("if: a", `<div>A ${kid(tag, "state.x: x; state.y: y",
        T("if: x", `<b>X ${T("if: y", "<i>Y</i>")}</b>`) + T("else:", "<s>nX</s>"))}</div>`) + T("else:", "<p>notA</p>"),
      { a: true, x: true, y: true },
      [set("y", false), set("x", false), set("a", false), set("a", true), set("x", true), set("y", true)]);
    expect(csr.views).toEqual(["A X Y", "A X", "A nX", "notA", "A nX", "A X", "A X Y"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });
});
