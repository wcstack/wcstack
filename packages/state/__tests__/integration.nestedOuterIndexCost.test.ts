/**
 * integration.nestedOuterIndexCost.test.ts — 外側の `for` の行の位置が変わったときの添字の当て直し（#360）が、
 * 中に添字の束縛（`$1` …）の無い入れ子の Content を辿らない（#390）。
 *
 * 旧挙動（#360 の修正の直後）: 行の「位置が変わったときに当て直す列」に、入れ子の構造ディレクティブ
 * （内側の `for`・`if` / `else`）を中身を問わず入れていた。位置の変わった行ごとに当て直し
 * （apply/applyChangeToFor.ts の applyIndexBindings）が表示中の入れ子の Content を全部辿るので、`$1` を
 * 使わない入れ子の一覧でも、先頭に足す・先頭を消す更新の費用が「位置の変わった行 × 入れ子の行の数」に
 * なった（Chromium・外側 3,000 行で 1.6〜3.8 倍）。
 *
 * いまは入れ子のテンプレートの中（その奥も含む）で使う添字の集合をテンプレートごとに一度だけ求め、動いた行の
 * 段の添字（`for: rows` の行なら `$1`、その中の `for: .it` の行なら `$2`）を使う入れ子だけを辿る。for の行の
 * 列には、その行の段と外側の段の添字を使う入れ子だけを入れる（structural/createContent.ts の isIndexBinding。
 * SSR の行 — ssr/hydrateBindings.ts — も同じ）。辿るときは、動いた段の添字を使わない入れ子を飛ばす
 * （apply/applyChangeToFor.ts の applyIndexBindings）。内側の行が自分の番号（`$2`）だけを描く形は、外側の
 * 行が動いても変わらないので辿らない。
 *
 * 費用は機械の速さに依らない量で固定する: 当て直しが列を引いた Content の数（`getIndexBindingsByContent`
 * の呼び出し — 当て直しは Content ごとに 1 回引く。ほかに引くのは未定義カスタム要素への spread を持つ行の
 * 活性化だけで、ここのテンプレートには無い）と、引いた列の長さの合計。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import type { State } from "../src/components/State";
import { flush, makeMount, write } from "./helpers/recursionTestUtils";
import { clientLoad, csrMarkup, serverRender, settle } from "./helpers/ssrRoundTrip";

const probe = vi.hoisted(() => ({ on: false, contents: 0, entries: 0 }));

vi.mock("../src/bindings/indexBindingsByContent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/bindings/indexBindingsByContent")>();
  return {
    ...actual,
    getIndexBindingsByContent: (content: Parameters<typeof actual.getIndexBindingsByContent>[0]) => {
      const bindings = actual.getIndexBindingsByContent(content);
      if (probe.on) {
        probe.contents++;
        probe.entries += bindings.length;
      }
      return bindings;
    },
  };
});

beforeAll(() => {
  bootstrapState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const mount = makeMount("nested-outer-index-cost-host");
const texts = (root: ParentNode, selector: string): (string | null)[] =>
  Array.from(root.querySelectorAll(selector)).map((element) => element.textContent);
const drain = async (): Promise<void> => {
  await flush();
  await flush();
};

/** 1 回の書き込み（と描画）の間に、当て直しが列を引いた Content の数と、列の長さの合計 */
async function measure(stateEl: State, fn: (s: any) => void): Promise<{ contents: number; entries: number }> {
  probe.contents = 0;
  probe.entries = 0;
  probe.on = true;
  try {
    write(stateEl, fn);
    await drain();
  } finally {
    probe.on = false;
  }
  return { contents: probe.contents, entries: probe.entries };
}

const ROWS = 20;
const rows = <T>(make: (n: number) => T): T[] => Array.from({ length: ROWS }, (_, n) => make(n));

describe("中に $N の無い入れ子は辿らない（CSR）", () => {
  it("内側の for が 1 段（行ごとに 3 件）: 先頭に足すと、位置の変わった外側の行だけを引く（旧: 内側の行 3 件ずつも）", async () => {
    const { host, shadowRoot, stateEl } = await mount({
      rows: rows((n) => ({ n, it: [{ v: 1 }, { v: 2 }, { v: 3 }] })),
    }, `<template data-wcs="for: rows"><div>{{ .n }}<template data-wcs="for: .it"><i>{{ .v }}</i></template></div></template>`);

    const cost = await measure(stateEl, (s) => { s.rows = [{ n: -1, it: [{ v: 9 }] }, ...s.rows]; });
    expect(cost).toEqual({ contents: ROWS, entries: 0 }); // 旧: { contents: 80, entries: 20 }
    expect(texts(shadowRoot, "div > i").length).toBe(ROWS * 3 + 1);
    host.remove();
  });

  it("内側の for が 2 段（2 件 × 2 件）: 先頭を消すと、位置の変わった外側の行だけを引く（旧: 入れ子の 6 件ずつも）", async () => {
    const { host, shadowRoot, stateEl } = await mount({
      rows: rows((n) => ({ n, it: [{ jt: [{ v: 1 }, { v: 2 }] }, { jt: [{ v: 3 }, { v: 4 }] }] })),
    }, `<template data-wcs="for: rows"><div><template data-wcs="for: .it"><section>` +
      `<template data-wcs="for: .jt"><i>{{ .v }}</i></template></section></template></div></template>`);

    const cost = await measure(stateEl, (s) => { s.rows = s.rows.slice(1); });
    expect(cost).toEqual({ contents: ROWS - 1, entries: 0 }); // 旧: { contents: 133, entries: 57 }
    expect(texts(shadowRoot, "i").length).toBe((ROWS - 1) * 4);
    host.remove();
  });

  it("行の中の if / else の枝: 反転しても、位置の変わった外側の行だけを引く（旧: 表示中の枝も）", async () => {
    const { host, shadowRoot, stateEl } = await mount({
      rows: rows((n) => ({ n, show: n % 2 === 0 })),
    }, `<template data-wcs="for: rows"><div><template data-wcs="if: .show"><i>{{ .n }}</i></template>` +
      `<template data-wcs="else:"><s>{{ .n }}</s></template></div></template>`);

    const cost = await measure(stateEl, (s) => { s.rows = [...s.rows].reverse(); });
    expect(cost).toEqual({ contents: ROWS, entries: 0 }); // 旧: { contents: 40, entries: 40 }
    expect(texts(shadowRoot, "i")[0]).toBe("18");
    host.remove();
  });
});

describe("$N のある入れ子だけを辿る（CSR）", () => {
  it("行に $1 のある入れ子と無い入れ子が並ぶと、$1 のある方の行だけを引き、その $1 を当て直す", async () => {
    const { host, shadowRoot, stateEl } = await mount({
      rows: rows((n) => ({ n, a: [{ v: 1 }, { v: 2 }, { v: 3 }], b: [{ v: 4 }, { v: 5 }, { v: 6 }] })),
    }, `<template data-wcs="for: rows"><div>` +
      `<template data-wcs="for: .a"><i>{{ .v }}:{{ $1 }}</i></template>` +
      `<template data-wcs="for: .b"><u>{{ .v }}</u></template></div></template>`);

    const cost = await measure(stateEl, (s) => { s.rows = [{ n: -1, a: [], b: [] }, ...s.rows]; });
    // 外側の行（20）＋ `for: .a` の行（20 × 3）。列は外側の行の `for: .a` の置き場 20 と、内側の行の `$1` 60
    expect(cost).toEqual({ contents: ROWS + ROWS * 3, entries: ROWS + ROWS * 3 }); // 旧: contents 140・entries 100
    expect(texts(shadowRoot, "i").slice(0, 3)).toEqual(["1:1", "2:1", "3:1"]);
    expect(texts(shadowRoot, "i").slice(-1)).toEqual([`3:${ROWS}`]);
    host.remove();
  });

  it("$1 が elseif の否定の枝（else）の奥にだけあっても、置き場を辿って当て直す", async () => {
    const { host, shadowRoot, stateEl } = await mount({
      rows: rows((n) => ({ n, x: false, y: false })),
    }, `<template data-wcs="for: rows"><div><template data-wcs="if: .x"><b>{{ .n }}</b></template>` +
      `<template data-wcs="elseif: .y"><u>{{ .n }}</u></template>` +
      `<template data-wcs="else:"><i>{{ .n }}:{{ $1 }}</i></template></div></template>`);

    const cost = await measure(stateEl, (s) => { s.rows = s.rows.slice(1); });
    // 外側の行 → if の否定の枝（elseif と else の置き場を持つ）→ else の枝（位置の変わった 19 行 × 3）。
    // 列は行の「if の否定の枝」の置き場・その中の else の置き場（19 × 2）と、else の枝の `$1`（19）。
    // elseif の置き場（中に `$1` が無い）は入らない
    expect(cost).toEqual({ contents: (ROWS - 1) * 3, entries: (ROWS - 1) * 3 }); // 旧: entries 95（elseif の置き場も）
    expect(texts(shadowRoot, "i").slice(0, 2)).toEqual(["1:0", "2:1"]);
    host.remove();
  });
});

describe("動いた行の段の添字を使う入れ子だけを辿る（CSR）", () => {
  it("内側の行が自分の番号（$2）だけを描く形: 外側の先頭に足しても内側の行を引かない（旧: 内側の行 3 件ずつも）", async () => {
    const { host, shadowRoot, stateEl } = await mount({
      rows: rows((n) => ({ n, it: [{ v: 1 }, { v: 2 }, { v: 3 }] })),
    }, `<template data-wcs="for: rows"><div>{{ .n }}<template data-wcs="for: .it"><i>{{ .v }}:{{ $2 }}</i></template></div></template>`);

    const cost = await measure(stateEl, (s) => { s.rows = [{ n: -1, it: [{ v: 9 }] }, ...s.rows]; });
    expect(cost).toEqual({ contents: ROWS, entries: 0 }); // 旧: { contents: 80, entries: 80 }
    expect(texts(shadowRoot, "i").slice(0, 7)).toEqual(["9:0", "1:0", "2:1", "3:2", "1:0", "2:1", "3:2"]);

    // 内側の並べ替えは、内側の for が自分の行の $2 を当て直す
    write(stateEl, (s) => { s["rows.1.it"] = [...s["rows.1.it"]].reverse(); });
    await drain();
    expect(texts(shadowRoot, "i").slice(1, 4)).toEqual(["3:0", "2:1", "1:2"]);
    host.remove();
  });

  // 3 段: g（$1）→ s（$2）→ 内側の for が 3 つ（a の行は $3 だけ、b の行は $2、c の行は $1）
  const MIXED = `<template data-wcs="for: g"><section><h2>{{ $1 }}</h2>` +
    `<template data-wcs="for: .s"><div><h3>{{ $2 }}</h3>` +
    `<template data-wcs="for: .a"><i>{{ $3 }}</i></template>` +
    `<template data-wcs="for: .b"><em>{{ $2 }}</em></template>` +
    `<template data-wcs="for: .c"><s>{{ $1 }}</s></template></div></template></section></template>`;
  const mixed = () => ({
    g: [0, 1].map(() => ({ s: [0, 1, 2].map(() => ({ a: [{}, {}], b: [{}, {}], c: [{}, {}] })) })),
  });
  const shownMixed = (root: ParentNode) => ({
    h2: texts(root, "h2").join(""), h3: texts(root, "h3").join(""),
    i: texts(root, "i").join(""), em: texts(root, "em").join(""), s: texts(root, "s").join(""),
  });

  it("$1 / $2 / $3 が混ざる 3 段: 中の段の反転は $2 を当て直し、$3 だけ・$1 だけの行は辿らない", async () => {
    const { host, shadowRoot, stateEl } = await mount(mixed(), MIXED);

    // g.0.s の反転で位置が変わるのは 0 と 2 の 2 行（1 はそのまま）。引くのはその 2 行と、その中の b の行（$2）の
    // 4 行。列は中の段の行の h3・b・c の置き場（2 × 3。a の置き場は $3 だけなので入らない）と、b の行の em（4）
    const cost = await measure(stateEl, (s) => { s["g.0.s"] = [...s["g.0.s"]].reverse(); });
    expect(cost).toEqual({ contents: 2 + 4, entries: 2 * 3 + 4 }); // 旧: { contents: 14, entries: 20 }
    expect(shownMixed(shadowRoot)).toEqual({
      h2: "01", h3: "012012", i: "01".repeat(6), em: "001122001122", s: "0".repeat(6) + "1".repeat(6),
    });
    host.remove();
  });

  it("$1 / $2 / $3 が混ざる 3 段: 外側の反転は $1 を当て直し、$2 だけ・$3 だけの行は辿らない", async () => {
    const { host, shadowRoot, stateEl } = await mount(mixed(), MIXED);
    // 外側で目印を付けて、反転したことを見分ける
    write(stateEl, (s) => { s["g.0.s"] = [...s["g.0.s"], { a: [], b: [], c: [] }]; });
    await drain();

    // 外側の 2 行が動く。引くのはその 2 行・中の段の 7 行・その中の c の行（$1）の 12 行。列は外側の行の
    // h2・s の置き場（2 × 2）、中の段の行の h3・b・c の置き場（7 × 3）、c の行の s（12）
    const cost = await measure(stateEl, (s) => { s.g = [...s.g].reverse(); });
    expect(cost).toEqual({ contents: 2 + 7 + 12, entries: 2 * 2 + 7 * 3 + 12 }); // 旧: { contents: 45, entries: 68 }
    expect(shownMixed(shadowRoot)).toEqual({
      h2: "01", h3: "0120123", i: "01".repeat(6), em: "001122001122", s: "0".repeat(6) + "1".repeat(6),
    });
    host.remove();
  });
});

// ---------------------------------------------------------------------------
// SSR（サーバー描画 → ハイドレーション）: ハイドレートした行も同じ振り分け
// ---------------------------------------------------------------------------

async function hydrateAndMeasure(markup: string, make: () => any, step: (s: any) => void) {
  const errors: string[] = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(" ")); });
  try {
    const html = await serverRender(markup, make);
    // ハイドレーションした（全描画に倒していない）ことを確かめる材料: サーバーのスナップショットを持つ
    expect(html).toContain("<wcs-ssr");
    const el = await clientLoad(html, make);
    probe.contents = 0;
    probe.entries = 0;
    probe.on = true;
    try {
      write(el, step);
      await settle();
    } finally {
      probe.on = false;
    }
    return { cost: { contents: probe.contents, entries: probe.entries }, i: texts(document, "i"), errors };
  } finally {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    await settle();
  }
}

describe("SSR ハイドレーション後", () => {
  const make = (): any => ({ rows: Array.from({ length: 6 }, (_, n) => ({ n, show: true })) });

  it("行の中の if の枝に $1 が無ければ、並べ替えで枝を辿らない（旧: 表示中の枝も）", async () => {
    const MARKUP = `<wcs-state enable-ssr></wcs-state><template data-wcs="for: rows"><p>` +
      `<template data-wcs="if: .show"><i data-wcs="textContent: .n"></i></template></p></template>`;
    const { cost, i, errors } = await hydrateAndMeasure(MARKUP, make, (s) => { s.rows = [...s.rows].reverse(); });
    expect(cost).toEqual({ contents: 6, entries: 0 }); // 旧: { contents: 12, entries: 6 }
    expect(i).toEqual(["5", "4", "3", "2", "1", "0"]);
    expect(errors).toEqual([]);
  });

  it("行の中の if の枝に $1 があれば、並べ替えで枝を辿って当て直す（CSR と同じ）", async () => {
    const MARKUP = `<wcs-state enable-ssr></wcs-state><template data-wcs="for: rows"><p>` +
      `<template data-wcs="if: .show"><i data-wcs="textContent: $1"></i></template></p></template>`;
    const { cost, i, errors } = await hydrateAndMeasure(MARKUP, make, (s) => { s.rows = [...s.rows].reverse(); });
    expect(cost).toEqual({ contents: 12, entries: 12 });
    expect(i).toEqual(["0", "1", "2", "3", "4", "5"]);
    expect(errors).toEqual([]);

    // CSR の対照
    const csr = await clientLoad(csrMarkup(MARKUP), make);
    write(csr, (s) => { s.rows = [...s.rows].reverse(); });
    await settle();
    expect(texts(document, "i")).toEqual(["0", "1", "2", "3", "4", "5"]);
    document.body.innerHTML = "";
    await settle();
  });
});
