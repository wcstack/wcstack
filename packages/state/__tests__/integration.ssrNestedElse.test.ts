/**
 * integration.ssrNestedElse.test.ts — `if:` の枝の中に `if:` がある形の `else:` の組み方を、**実際のサーバー
 * 出力**から固定する（#336）。
 *
 * ハイドレーションは `<wcs-ssr>` のテンプレートを復帰するとき、`else:` を「並びで直前の `if:` / `elseif:`」
 * の否定として組んでいた。並びは描いた文書の文書順なので、外側の枝が描かれていると内側の置き場が外側の
 * `else:` より前に並び、外側の `else:` が内側の `if:` と組んだ（外側を偽にしても else が出ず、内側を偽に
 * すると外側の else が出た）。内側にも `else:` があると、外側の `else:` は否定の相手を失って常に真になった。
 *
 * 契約: `else:` は**同じ階層**（同じテンプレートの中身か、文書の直下）で直前の `if:` / `elseif:` の否定
 * （クライアントの collectStructuralFragments と同じ組み方）。どの形も `enable-ssr` を外した CSR と同じ表示で、
 * 失敗を報告しない。
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

async function compare(body: string, data: Record<string, unknown>, steps: Step[]): Promise<{ csr: IRun; ssr: IRun }> {
  const markup = `<wcs-state enable-ssr></wcs-state><div id="root">${body}</div>`;
  const make = (): any => ({ a: false, b: false, c: false, d: false, ...data });
  const csr = await run(csrMarkup(markup), make, steps);
  const ssr = await run(await serverRender(markup, make), make, steps);
  return { csr, ssr };
}

const T = (bind: string, body: string): string => `<template data-wcs="${bind}">${body}</template>`;
const set = (key: string, value: unknown): Step => (s) => { s[key] = value; };

describe("#336: if の枝の中の if と、外側の else", () => {
  it("内側に else が無い形: 外側の else は外側の if の否定（旧: 内側の if と組み、a=false で何も出ず、b=false で notA が出た）", async () => {
    const body = T("if: a", `<div>A ${T("if: b", "<i>B</i>")}</div>`) + T("else:", "<p>notA</p>");
    const { csr, ssr } = await compare(body, { a: true, b: true },
      [set("a", false), set("a", true), set("b", false), set("b", true)]);
    expect(csr.views).toEqual(["A B", "notA", "A B", "A", "A B"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("内側にも else がある形: 外側の else が外側の if の否定になる（旧: 否定の相手を失い、a=false で何も出なかった）", async () => {
    const body = T("if: a", `<div>A ${T("if: b", "<i>B</i>")}${T("else:", "<s>notB</s>")}</div>`) + T("else:", "<p>notA</p>");
    const { csr, ssr } = await compare(body, { a: true, b: true },
      [set("a", false), set("a", true), set("b", false), set("a", false), set("a", true)]);
    expect(csr.views).toEqual(["A B", "notA", "A B", "A notB", "notA", "A notB"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("外側の条件が最初から偽の形（サーバーは外側の else を描く）も変わらず動く", async () => {
    const body = T("if: a", `<div>A ${T("if: b", "<i>B</i>")}${T("else:", "<s>notB</s>")}</div>`) + T("else:", "<p>notA</p>");
    const { csr, ssr } = await compare(body, { a: false, b: true },
      [set("a", true), set("b", false), set("a", false), set("a", true)]);
    expect(csr.views).toEqual(["notA", "A B", "A notB", "notA", "A notB"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("if の中の if の中の if（3 段）で、各段の else がそれぞれの if と組む", async () => {
    const body = T("if: a", `<div>A ${T("if: b", `<span>B ${T("if: c", "<i>C</i>")}${T("else:", "<s>notC</s>")}</span>`)}` +
      `${T("else:", "<s>notB</s>")}</div>`) + T("else:", "<p>notA</p>");
    const { csr, ssr } = await compare(body, { a: true, b: true, c: true },
      [set("c", false), set("b", false), set("a", false), set("a", true), set("b", true), set("c", true)]);
    expect(csr.views).toEqual(["A B C", "A B notC", "A notB", "notA", "A notB", "A B notC", "A B C"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("if → elseif → else の連鎖で、if と elseif の枝の中に if があっても、else は連鎖の直前の elseif と組む", async () => {
    const body = T("if: a", `<div>A ${T("if: b", "<i>B</i>")}</div>`) + T("elseif: c", "<b>C</b>") +
      T("elseif: d", `<div>D ${T("if: b", "<i>B3</i>")}${T("else:", "<s>notB3</s>")}</div>`) + T("else:", "<p>none</p>");
    const steps = [set("a", false), set("c", true), set("a", true), set("b", false), set("c", false),
      set("a", false), set("d", true), set("b", true), set("a", true)];
    const fromA = await compare(body, { a: true, b: true, c: true, d: true }, steps);
    expect(fromA.csr.views).toEqual(["A B", "C", "C", "A B", "A", "A", "D notB3", "D notB3", "D B3", "A B"]);
    expect(fromA.ssr.views).toEqual(fromA.csr.views);
    expect(fromA.ssr.errors).toEqual([]);

    const fromD = await compare(body, { a: false, b: true, c: false, d: true }, steps);
    expect(fromD.ssr.views).toEqual(fromD.csr.views);
    expect(fromD.ssr.views[0]).toBe("D B3");
    expect(fromD.ssr.errors).toEqual([]);
  });
});
