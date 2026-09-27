/**
 * integration.nestedOuterIndex.test.ts — 外側の `for` の行の位置が変わったとき、行の中の入れ子の
 * テンプレート（内側の `for` の行・`if` / `else` の枝、その奥）に書いた外側の軸の添字（`$1` …）を
 * 当て直す（#360）。
 *
 * 旧挙動: 位置が変わった行（`changeIndexSet`）について `applyChangeToFor` が当て直すのは、その行の
 * Content が直接持つ添字の束縛だけだった。内側の `for` は同じ配列を描き続けるので差分が出ず、`if` は
 * 条件が変わらないので、入れ子の中の `$1` は並べ替える前の添字のまま残った（要素への書き込みが無くても、
 * 外側の配列を丸ごと並べ替えるだけで起きる）。
 *
 * いまは行の「位置が変わったときに当て直す列」に入れ子の構造ディレクティブのアンカーも入れ
 * （structural/createContent.ts・ssr/hydrateBindings.ts）、当て直しがそこから表示中の入れ子の Content へ
 * 辿る（apply/applyChangeToFor.ts の applyIndexBindings）。当て直すのは添字の束縛だけ。
 *
 * SSR: ハイドレートした行は、行の中の `if` の枝の中身の束縛も行が持つ。枝の Content がその中身の
 * ループ文脈を張る列まで持っていたので、枝を隠すと行の `$1` の束縛の文脈が外れ、その後の並べ替えが
 * `ListIndex not found` で `for` の適用ごと止まった（並べ替えが描かれない）。SSR の `{{ $1 }}` が空の件は
 * 別件（#350）なので、SSR の比較は `textContent: $1` の形で行う。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { flush, makeMount, write } from "./helpers/recursionTestUtils";
import { clientLoad, csrMarkup, serverRender, settle } from "./helpers/ssrRoundTrip";

beforeAll(() => {
  bootstrapState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const mount = makeMount("nested-outer-index-host");
const texts = (root: ParentNode, selector: string): (string | null)[] =>
  Array.from(root.querySelectorAll(selector)).map((element) => element.textContent);
const drain = async (): Promise<void> => {
  await flush();
  await flush();
};

describe("Issue の再現（CSR）", () => {
  it("内側の for の行の {{ $1 }} が、外側の反転の後に新しい添字になる（旧: 3:1 1:0 2:0）", async () => {
    const { host, shadowRoot, stateEl } = await mount({
      groups: [
        { n: "a", items: [{ id: 1 }, { id: 2 }] },
        { n: "b", items: [{ id: 3 }] },
      ],
    }, `<template data-wcs="for: groups"><p><b>{{ .n }}{{ $1 }}</b>` +
      `<template data-wcs="for: .items"><i>{{ .id }}:{{ $1 }}</i></template></p></template>`);
    expect(texts(shadowRoot, "b, i")).toEqual(["a0", "1:0", "2:0", "b1", "3:1"]);

    write(stateEl, (s) => { s.groups = [...s.groups].reverse(); });
    await drain();
    expect(texts(shadowRoot, "b, i")).toEqual(["b0", "3:0", "a1", "1:1", "2:1"]);
    host.remove();
  });

  it("行の中の if の枝の {{ $1 }} が、外側の反転の後に新しい添字になる（旧: b:1 a:0）", async () => {
    const { host, shadowRoot, stateEl } = await mount({
      groups: [{ n: "a", show: true }, { n: "b", show: true }],
    }, `<template data-wcs="for: groups"><p><b>{{ .n }}{{ $1 }}</b>` +
      `<template data-wcs="if: .show"><i>{{ .n }}:{{ $1 }}</i></template></p></template>`);
    expect(texts(shadowRoot, "b, i")).toEqual(["a0", "a:0", "b1", "b:1"]);

    write(stateEl, (s) => { s.groups = [...s.groups].reverse(); });
    await drain();
    expect(texts(shadowRoot, "b, i")).toEqual(["b0", "b:0", "a1", "a:1"]);
    host.remove();
  });

  it("$1 と $2 を並べた形: 外側の反転・同じバッチの内側の入れ替え・内側の反転のどれでも揃う", async () => {
    const { host, shadowRoot, stateEl } = await mount({
      groups: [
        { n: "a", items: [{ id: 1 }, { id: 2 }, { id: 3 }] },
        { n: "b", items: [{ id: 4 }, { id: 5 }] },
      ],
    }, `<template data-wcs="for: groups"><p>` +
      `<template data-wcs="for: .items"><i>{{ .id }}:{{ $1 }}.{{ $2 }}</i></template></p></template>`);
    const shown = () => texts(shadowRoot, "i").join(" ");
    expect(shown()).toBe("1:0.0 2:0.1 3:0.2 4:1.0 5:1.1");

    write(stateEl, (s) => { s.groups = [...s.groups].reverse(); });
    await drain();
    expect(shown()).toBe("4:0.0 5:0.1 1:1.0 2:1.1 3:1.2"); // 旧: 4:1.0 5:1.1 1:0.0 2:0.1 3:0.2

    // 外側の反転と同じバッチで内側の要素を入れ替える（入れ替えで描き直された行だけが新しくなっていた）
    write(stateEl, (s) => {
      const first = s["groups.1.items.0"];
      s["groups.1.items.0"] = s["groups.1.items.2"];
      s["groups.1.items.2"] = first;
      s.groups = [...s.groups].reverse();
    });
    await drain();
    expect(shown()).toBe("3:0.0 2:0.1 1:0.2 4:1.0 5:1.1");

    // 外側の反転と同じバッチで内側の配列を反転する（内側の差分で位置の変わらない行が古いままだった）
    write(stateEl, (s) => {
      s["groups.0.items"] = [...s["groups.0.items"]].reverse();
      s.groups = [...s.groups].reverse();
    });
    await drain();
    expect(shown()).toBe("4:0.0 5:0.1 1:1.0 2:1.1 3:1.2"); // 旧: 4:1.0 5:1.1 1:1.0 2:0.1 3:1.2
    host.remove();
  });
});

describe("さらに深い入れ子・挿入と削除・隠れた枝（CSR）", () => {
  // 3 段: 外側の行 → if → 中の for → 内側の for。外側の行には else の枝もある
  const MARKUP = `<template data-wcs="for: g"><section>` +
    `<template data-wcs="if: .show"><template data-wcs="for: .s"><template data-wcs="for: .t">` +
    `<i data-wcs="textContent: $1"></i><u data-wcs="textContent: $2"></u></template></template></template>` +
    `<template data-wcs="else:"><em data-wcs="textContent: $1"></em></template></section></template>`;
  const initial = () => ({
    g: [
      { show: true, s: [{ t: [{ v: "x" }] }, { t: [{ v: "y" }, { v: "z" }] }] },
      { show: false, s: [{ t: [{ v: "w" }] }] },
    ],
  });

  it("外側の反転・先頭への挿入・中の段の反転・先頭の削除の後、どの段の $1 / $2 も今の位置になる", async () => {
    const { host, shadowRoot, stateEl } = await mount(initial(), MARKUP);
    const shown = () => ({ i: texts(shadowRoot, "i"), u: texts(shadowRoot, "u"), em: texts(shadowRoot, "em") });
    expect(shown()).toEqual({ i: ["0", "0", "0"], u: ["0", "1", "1"], em: ["1"] });

    write(stateEl, (s) => { s.g = [...s.g].reverse(); });
    await drain();
    expect(shown()).toEqual({ i: ["1", "1", "1"], u: ["0", "1", "1"], em: ["0"] }); // 旧: i 0 0 0・em 1

    write(stateEl, (s) => { s.g = [{ show: false, s: [] }, ...s.g]; });
    await drain();
    expect(shown()).toEqual({ i: ["2", "2", "2"], u: ["0", "1", "1"], em: ["0", "1"] });

    // 中の段（$2 の軸）の反転は、内側の for の行（$2 を描く）まで当て直す
    write(stateEl, (s) => { s["g.2.s"] = [...s["g.2.s"]].reverse(); });
    await drain();
    expect(shown()).toEqual({ i: ["2", "2", "2"], u: ["0", "0", "1"], em: ["0", "1"] });

    write(stateEl, (s) => { s.g = s.g.slice(1); });
    await drain();
    expect(shown()).toEqual({ i: ["1", "1", "1"], u: ["0", "0", "1"], em: ["0"] });
    host.remove();
  });

  it("隠れている枝は並べ替えで辿らず、表示したときに今の位置で描かれる", async () => {
    const { host, shadowRoot, stateEl } = await mount(initial(), MARKUP);
    const shown = () => ({ i: texts(shadowRoot, "i"), u: texts(shadowRoot, "u"), em: texts(shadowRoot, "em") });

    // 描いたことのある枝を隠してから並べ替え、表示し直す
    write(stateEl, (s) => { s["g.0.show"] = false; });
    await drain();
    write(stateEl, (s) => { s.g = [...s.g].reverse(); });
    await drain();
    expect(shown()).toEqual({ i: [], u: [], em: ["0", "1"] });

    write(stateEl, (s) => { s["g.1.show"] = true; });
    await drain();
    expect(shown()).toEqual({ i: ["1", "1", "1"], u: ["0", "1", "1"], em: ["0"] });
    host.remove();
  });

  it("添字を条件に持つ if（if: $1|eq(0)）は、並べ替えで条件を評価し直す", async () => {
    const { host, shadowRoot, stateEl } = await mount({
      groups: [{ n: "a" }, { n: "b" }, { n: "c" }],
    }, `<template data-wcs="for: groups"><p><template data-wcs="if: $1|eq(0)"><i>{{ .n }}:{{ $1 }}</i></template></p></template>`);
    expect(texts(shadowRoot, "i")).toEqual(["a:0"]);

    write(stateEl, (s) => { s.groups = [...s.groups].reverse(); });
    await drain();
    expect(texts(shadowRoot, "i")).toEqual(["c:0"]);
    host.remove();
  });

  it("添字を条件に持つ if が真のまま動いた行でも、その中の for の行の $1 を当て直す", async () => {
    const { host, shadowRoot, stateEl } = await mount({
      groups: [{ items: [1, 2] }, { items: [3] }, { items: [4] }],
    }, `<template data-wcs="for: groups"><p><template data-wcs="if: $1|lt(2)">` +
      `<template data-wcs="for: .items"><i>{{ . }}:{{ $1 }}</i></template></template></p></template>`);
    expect(texts(shadowRoot, "i")).toEqual(["1:0", "2:0", "3:1"]);

    // 0 行目と 1 行目を入れ替える（どちらも条件は真のまま）
    write(stateEl, (s) => { s.groups = [s.groups[1], s.groups[0], s.groups[2]]; });
    await drain();
    expect(texts(shadowRoot, "i")).toEqual(["3:0", "1:1", "2:1"]);

    // 条件が偽になる行・真になる行が出る並べ替え
    write(stateEl, (s) => { s.groups = [s.groups[2], s.groups[1], s.groups[0]]; });
    await drain();
    expect(texts(shadowRoot, "i")).toEqual(["4:0", "1:1", "2:1"]);
    host.remove();
  });
});

// ---------------------------------------------------------------------------
// SSR（サーバー描画 → ハイドレーション）と CSR の対照
// ---------------------------------------------------------------------------

type Step = (s: any) => void;

/** 読み込み（CSR なら描画、SSR ならハイドレーション）→ 書き込みを 1 つずつ流し、観測と失敗の報告を集める */
async function run(html: string, make: () => any, steps: Step[], observe: () => unknown)
  : Promise<{ views: unknown[]; errors: string[] }> {
  const errors: string[] = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(" ")); });
  try {
    const el = await clientLoad(html, make);
    const views = [observe()];
    for (const step of steps) {
      write(el, step);
      await settle();
      views.push(observe());
    }
    return { views, errors };
  } finally {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    await settle();
  }
}

async function compare(markup: string, make: () => any, steps: Step[], observe: () => unknown) {
  const csr = await run(csrMarkup(markup), make, steps, observe);
  const ssr = await run(await serverRender(markup, make), make, steps, observe);
  return { csr, ssr };
}

describe("SSR ハイドレーション後（textContent: $1 の形）", () => {
  it("行の中の if / else の枝: 切り替え → 並べ替え → 隠れていた枝の表示 → 先頭への挿入で CSR と同じ添字になり、失敗を報告しない", async () => {
    const MARKUP = `<wcs-state enable-ssr></wcs-state><template data-wcs="for: groups"><p>` +
      `<b data-wcs="textContent: $1"></b>` +
      `<template data-wcs="if: .show"><i data-wcs="textContent: $1"></i></template>` +
      `<template data-wcs="else:"><s data-wcs="textContent: $1"></s></template></p></template>`;
    const make = (): any => ({ groups: [{ show: true }, { show: true }, { show: false }] });
    const observe = (): unknown => ({ b: texts(document, "b"), i: texts(document, "i"), s: texts(document, "s") });
    const { csr, ssr } = await compare(MARKUP, make, [
      (s) => { s.groups = [...s.groups].reverse(); },
      // SSR で描いた枝を隠し、SSR で描かなかった枝を表示する
      (s) => { s["groups.0.show"] = true; s["groups.2.show"] = false; },
      (s) => { s.groups = [...s.groups].reverse(); },
      // 隠したまま動いた、SSR で描いた枝を表示し直す
      (s) => { s["groups.0.show"] = true; },
      (s) => { s.groups = [{ show: false }, ...s.groups]; },
    ], observe);

    expect(ssr.views).toEqual(csr.views);
    expect(csr.views).toEqual([
      { b: ["0", "1", "2"], i: ["0", "1"], s: ["2"] },
      { b: ["0", "1", "2"], i: ["1", "2"], s: ["0"] },
      { b: ["0", "1", "2"], i: ["0", "1"], s: ["2"] },
      // 旧（SSR）: 並べ替えが `ListIndex not found` で止まり、前の表示のまま
      { b: ["0", "1", "2"], i: ["1", "2"], s: ["0"] },
      { b: ["0", "1", "2"], i: ["0", "1", "2"], s: [] },
      { b: ["0", "1", "2", "3"], i: ["1", "2", "3"], s: ["0"] },
    ]);
    expect(ssr.errors).toEqual([]);
    expect(csr.errors).toEqual([]);
  });

  it("入れ子の for（ハイドレーションせず全描画に倒す形）の内側の行の $1 も、外側の並べ替えで CSR と同じになる", async () => {
    const MARKUP = `<wcs-state enable-ssr></wcs-state><template data-wcs="for: groups"><p>` +
      `<template data-wcs="for: .items"><i data-wcs="textContent: $1"></i></template></p></template>`;
    const make = (): any => ({ groups: [{ items: [{ id: 1 }, { id: 2 }] }, { items: [{ id: 3 }] }] });
    const observe = (): unknown => texts(document, "i");
    const { csr, ssr } = await compare(MARKUP, make, [
      (s) => { s.groups = [...s.groups].reverse(); },
      (s) => { s.groups = [{ items: [{ id: 0 }] }, ...s.groups]; },
    ], observe);

    expect(ssr.views).toEqual(csr.views);
    expect(csr.views).toEqual([["0", "0", "1"], ["0", "1", "1"], ["0", "1", "2", "2"]]);
    expect(ssr.errors).toEqual([]);
  });
});
