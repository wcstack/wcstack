/**
 * integration.sharedInnerListRebind.test.ts — 2 つの外側の行が同じ内側の配列を持つ形（#256 が約束する形）で、外側の行が
 * 内側の配列を写しや別の配列に替えた後の書き込みが、書いたパスの配列に着地すること（#393 / #394）。
 *
 * 行の台帳は配列ごとに 1 組で、行の親は 1 つ（最初に展開した外側の行）。v3.3.0 まで、次の 3 つで書き込みが別の配列に
 * 着地した（state の破損）:
 *  - 行のアドレスは親のアドレスを最初に引いたときに憶え、台帳が行を付け替えた後も憶えた親を引き続けた（#394）。
 *  - 外側の行が内側の配列を別の配列に替えても、前の配列の行はその外側の行を親に持ち続けた（#394）。
 *  - 同じ中身の写しは、共有された配列の行を借りた — 行の親は元の配列を持つ外側の行なので、写しの要素の書き込みが元の
 *    配列に着地した（#393）。
 *
 * 修理（src/address/StateAddress.ts・src/list/listIndexesByList.ts・src/list/createListDiff.ts・
 * src/proxy/methods/setByAddress.ts）:
 *  - 行のアドレスの親は、行のいまの親から引く。
 *  - 外側の行の内側のパスへ別の値を書き、同じ要素のどのパスもその配列を持たなくなったら、前の配列の行にとってその外側の行は
 *    「退役した親」と同じ扱い（付け替えの元になり、戻り先にならない）。別のパスがまだ持つなら手放さず、新しい配列にも行を
 *    貸さない。要素書き込みの入れ替えの途中で別の要素を映している行へは付け替えない。
 *  - 差分は、ほかの外側の行もまだ持っている配列の行を写しに貸さない（写しには新しい行・元の配列の行は退役させない）。持って
 *    いるかはその都度見る（手放した・退役した外側の行は数えない）ので、共有をやめた配列の写しは、これまでどおり行を借りて
 *    描いた要素を保つ。行を貸した配列を後から別の外側の行が引いたら、付け替える代わりに新しい行を作る。行を写しへ貸した
 *    行集合と、差分が新しく鋳造する行は、新しい配列を持つ親を home にする。差分はキャッシュが当たっても台帳を引き直す。
 *  - 写しの行と元の配列の行は同じ要素オブジェクトを表すので、行の下への書き込みはもう片方の行のアドレスにも描画だけを
 *    やり直させる。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { flush, makeMount, read, write } from "./helpers/recursionTestUtils";

beforeAll(() => {
  bootstrapState();
});

const mount = makeMount("shared-inner-rebind-host");

let errorSpy: ReturnType<typeof vi.spyOn> | null = null;
function spyErrors(): ReturnType<typeof vi.spyOn> {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  return errorSpy;
}
afterEach(() => {
  errorSpy?.mockRestore();
  errorSpy = null;
});

const GROUPS =
  `<template data-wcs="for: groups"><div class="g"><template data-wcs="for: .items"><span>{{ .v }}</span></template></div></template>`;
const GROUPS_IF =
  `<template data-wcs="for: groups"><div class="g"><template data-wcs="if: .show">` +
  `<template data-wcs="for: .items"><span>{{ .v }}</span></template></template></div></template>`;
const GROUPS_TAGS_IF =
  `<template data-wcs="for: groups"><div class="g"><template data-wcs="if: .show"><template data-wcs="for: .items">` +
  `<span>{{ .v }}[<template data-wcs="for: .tags"><em>{{ .t }}</em></template>]</span></template></template></div></template>`;
const GROUPS_TAGS =
  `<template data-wcs="for: groups"><div class="g"><template data-wcs="for: .items">` +
  `<span>{{ .v }}[<template data-wcs="for: .tags"><em>{{ .t }}</em></template>]</span></template></div></template>`;

/** 外側の行ごとに、内側の行の値を `,` で繋ぐ（`if` で隠れた外側の行は空） */
const view = (root: ShadowRoot): string[] =>
  Array.from(root.querySelectorAll("div.g")).map((group) =>
    Array.from(group.querySelectorAll("span")).map((span) => span.textContent).join(","));
/** 状態の値を、view と同じ形で（隠れた外側の行も値を出す） */
const stateOf = (stateEl: State): string[] =>
  read(stateEl, (s) => s.groups.map((g: any) => g.items.map((x: any) => x.v).join(",")));
/** 3 段（`.tags`）の状態の値を、view と同じ形で */
const deepStateOf = (stateEl: State): string[] =>
  read(stateEl, (s) => s.groups.map((g: any) =>
    g.items.map((x: any) => `${x.v}[${x.tags.map((t: any) => t.t).join("")}]`).join(",")));

async function step(stateEl: State, fn: (s: any) => void): Promise<void> {
  write(stateEl, fn);
  await flush();
  await flush();
}

const shared = (...values: string[]) => {
  const inner = values.map((v) => ({ v }));
  return { groups: [{ items: inner }, { items: inner }] };
};

describe("共有された内側の配列を写しに替えた後の書き込み（#393）", () => {
  it("Issue の手順: 外側の行 1 を写しに替え、次の更新で写しの要素を差し替えると、写しに着地すること", async () => {
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount(shared("a", "b"), GROUPS);
    await step(stateEl, (s) => { s["groups.1.items"] = [...s["groups.1.items"]]; });
    await step(stateEl, (s) => { s["groups.1.items.0"] = { v: "M" }; });
    // 3.3.0: ["M,b", "a,b"]（元の配列に着地し、写しは変わらない）
    expect(stateOf(stateEl)).toEqual(["a,b", "M,b"]);
    expect(view(shadowRoot)).toEqual(["a,b", "M,b"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("最初に描いた外側の行 0 を写しに替えても、写しと元の配列にそれぞれ着地すること", async () => {
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount(shared("a", "b"), GROUPS);
    await step(stateEl, (s) => { s["groups.0.items"] = [...s["groups.0.items"]]; });
    await step(stateEl, (s) => { s["groups.0.items.0"] = { v: "M" }; });
    await step(stateEl, (s) => { s["groups.1.items.1"] = { v: "N" }; });
    expect(stateOf(stateEl)).toEqual(["M,b", "a,N"]);
    expect(view(shadowRoot)).toEqual(["M,b", "a,N"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("写しに足した後の葉の書き込みは、同じ要素を描く両方の外側の行に描かれること", async () => {
    // 写しは要素オブジェクトを元の配列と共有する（[...items]）ので、葉の書き込みは両方の配列の値を替える
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount(shared("a", "b"), GROUPS);
    await step(stateEl, (s) => { s["groups.1.items"] = [...s["groups.1.items"], { v: "c" }]; });
    await step(stateEl, (s) => { s["groups.1.items.0.v"] = "M"; });
    expect(view(shadowRoot)).toEqual(["M,b", "M,b,c"]);
    await step(stateEl, (s) => { s["groups.0.items.1.v"] = "N"; });
    expect(stateOf(stateEl)).toEqual(["M,N", "M,N,c"]);
    expect(view(shadowRoot)).toEqual(["M,N", "M,N,c"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("写しに替えた外側の行を通した葉の書き込みは、$watch に書いたパスの添字で届くこと", async () => {
    // 3.3.0: 写しの行は元の配列の行（親は外側の行 0）なので、外側の行 1 を通した書き込みも添字 0 で届いた（W@0.0）
    const calls: string[] = [];
    const { stateEl } = await mount({
      ...shared("a", "b"),
      $watch: { "groups.*.items.*.v"(value: unknown, _old: unknown, i: number, j: number) { calls.push(`${value}@${i}.${j}`); } },
    }, GROUPS);
    await step(stateEl, (s) => { s["groups.1.items"] = [...s["groups.1.items"]]; });
    calls.length = 0;
    await step(stateEl, (s) => { s["groups.1.items.0.v"] = "W"; });
    expect(calls).toEqual(["W@1.0"]);
  });

  it("元の配列を持つ外側の行が if で隠れていても、同じ更新の差し替えは元の配列に着地すること", async () => {
    const errors = spyErrors();
    const inner = [{ v: "v0" }, { v: "v1" }];
    const { shadowRoot, stateEl } = await mount({ groups: [{ show: false, items: inner }, { show: true, items: inner }] }, GROUPS_IF);
    await step(stateEl, (s) => { s["groups.1.items"] = [...s["groups.1.items"]]; s["groups.0.items.0"] = { v: "v4" }; });
    // 3.3.0: 状態は ["v0,v1", "v4,v1"]（元の配列への書き込みが写しに着地した）
    expect(stateOf(stateEl)).toEqual(["v4,v1", "v0,v1"]);
    expect(view(shadowRoot)).toEqual(["", "v0,v1"]);
    await step(stateEl, (s) => { s["groups.0.show"] = true; });
    expect(view(shadowRoot)).toEqual(["v4,v1", "v0,v1"]);
    // 写しは元の配列の行を借りている（元の配列を持つ外側の行はまだ引いていなかった）。元の配列を引いた外側の行へ
    // 行を付け替えると、写しの行も動き、写しへの書き込みが元の配列に着地する — 元の配列には新しい行を作る
    await step(stateEl, (s) => { s["groups.1.items.1"] = { v: "N" }; });
    expect(stateOf(stateEl)).toEqual(["v4,v1", "v0,N"]);
    expect(view(shadowRoot)).toEqual(["v4,v1", "v0,N"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("3 段: 写しの行の下の、2 つの行が持つタグの配列も、外側の行を作り直した後に描けること", async () => {
    const errors = spyErrors();
    const tags = [{ t: "S" }, { t: "s" }];
    const inner = [{ v: "v0", tags }, { v: "v3", tags: [{ t: "t4" }, { t: "t5" }] }, { v: "v6", tags }, { v: "v8", tags: [{ t: "t9" }, { t: "t10" }] }];
    const { shadowRoot, stateEl } = await mount({ groups: [0, 1, 2, 3].map(() => ({ items: inner })) }, GROUPS_TAGS);
    await step(stateEl, (s) => { s["groups.1.items"] = [...s["groups.1.items"]]; });
    await step(stateEl, (s) => { s.groups = s.groups.map((g: any) => ({ ...g })); });
    // 3.3.0 でも描ける。この修理の途中の形（写しに新しい行を作るだけ）では `Content not found`（写しの行の下のタグの
    // for が、同じ配列を描く別の行の for が残した描画の基準を自分のものと取り違えた）
    expect(view(shadowRoot)).toEqual(Array(4).fill("v0[Ss],v3[t4t5],v6[Ss],v8[t9t10]"));
    expect(deepStateOf(stateEl)).toEqual(Array(4).fill("v0[Ss],v3[t4t5],v6[Ss],v8[t9t10]"));
    expect(errors).not.toHaveBeenCalled();
  });

  it("3 段: 写しに移した要素を差し替えた後、その写しを別の外側の行にも持たせても描けること", async () => {
    // 同じ行を 2 つの外側の行の for が描く。その場で使い回す行の Content の、中の for が描いた行の台帳を捨てないと、
    // もう片方の外側の行の for が残した描画の基準を自分のものと取り違えて `Content not found` で落ちた（この修理の途中の形）
    const errors = spyErrors();
    const inner = [{ v: "v0", tags: [{ t: "S" }, { t: "s" }] }, { v: "v2", tags: [{ t: "t3" }] }];
    const { shadowRoot, stateEl } = await mount({ groups: [0, 1, 2].map(() => ({ items: inner })) }, GROUPS_TAGS);
    await step(stateEl, (s) => { s.groups = [...s.groups].reverse(); });
    await step(stateEl, (s) => {
      const moved = s["groups.0.items.1"];
      s["groups.0.items.1"] = { v: "v23", tags: [{ t: "t24" }] };
      s["groups.2.items"] = [...s["groups.2.items"], moved];
    });
    await step(stateEl, (s) => { s["groups.2.items.1"] = { v: "v29", tags: [{ t: "t30" }] }; });
    await step(stateEl, (s) => {
      s["groups.0.items.1"] = { v: "v32", tags: [{ t: "t33" }, { t: "t34" }] };
      s["groups.1.items"] = s["groups.2.items"];
    });
    const expected = ["v0[Ss],v32[t33t34]", "v0[Ss],v29[t30],v2[t3]", "v0[Ss],v29[t30],v2[t3]"];
    // 3.3.0: 状態は ["v0[Ss],v23[t24]", "v0[Ss],v32[t33t34],v2[t3]", "v0[Ss],v32[t33t34],v2[t3]"]（外側の行 0 を通した差し替えが
    // 写しに着地した）
    expect(deepStateOf(stateEl)).toEqual(expected);
    expect(view(shadowRoot)).toEqual(expected);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("写しを重ねた後の描画（#393）", () => {
  it("手放した外側の行から付け替えた配列は、2 つの外側の行が持っていた配列のまま扱い、写しに行を貸さないこと", async () => {
    // 外側の行 0 が写しに替えて手放した配列を、残った外側の行へ付け替えても、手放す前は 2 つの外側の行が持っていた — 写しは
    // まだ元の配列の行を描いている。その外側の行を数えずに写しへ行を貸すと、差し替えた値を描かなかった（この修理の途中の形）
    const errors = spyErrors();
    const inner = [{ v: "v0" }, { v: "v1" }];
    const { shadowRoot, stateEl } = await mount({ groups: [0, 1].map(() => ({ show: true, items: inner })) }, GROUPS_IF);
    await step(stateEl, (s) => { s.groups = s.groups.map((g: any) => ({ ...g })).reverse(); s["groups.0.items.0"] = { v: "v8" }; });
    await step(stateEl, (s) => { s["groups.0.show"] = false; s["groups.0.items"] = [...s["groups.0.items"], { v: "v12" }]; });
    await step(stateEl, (s) => {
      s["groups.1.items.1"] = { v: "v14" };
      const second = s["groups.1"];
      s["groups.1"] = s["groups.0"];
      s["groups.0"] = second;
      s["groups.0.items"] = [...s["groups.0.items"]];
    });
    expect(stateOf(stateEl)).toEqual(["v8,v14", "v8,v1,v12"]);
    expect(view(shadowRoot)).toEqual(["v8,v14", ""]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("写しに行を貸した配列を、隠れていた別の外側の行が引いても、写しの行を付け替えないこと", async () => {
    // 描いている外側の行 0 が写しに替えると、配列はまだ 1 つの外側の行からしか引かれていないので行を写しに貸す。後から
    // 隠れた外側の行の配列が同じ配列になり、引かれたときに行を付け替えると、写しの行も動き、写しへの書き込みが元の配列に
    // 着地した — 元の配列には新しい行を作る
    const errors = spyErrors();
    const inner = [{ v: "v0" }, { v: "v1" }, { v: "v2" }, { v: "v3" }];
    const { shadowRoot, stateEl } = await mount({
      groups: [{ show: true, items: inner }, { show: false, items: inner }, { show: false, items: [{ v: "v4" }, { v: "v5" }, { v: "v6" }] }],
    }, GROUPS_IF);
    await step(stateEl, (s) => { s["groups.0.items"] = [...s["groups.0.items"]]; });
    await step(stateEl, (s) => { s["groups.0.items.0"] = { v: "v13" }; s["groups.2.items"] = s["groups.1.items"]; });
    await step(stateEl, (s) => { s["groups.0.items.1"] = { v: "v17" }; });
    expect(stateOf(stateEl)).toEqual(["v13,v17,v2,v3", "v0,v1,v2,v3", "v0,v1,v2,v3"]);
    expect(view(shadowRoot)).toEqual(["v13,v17,v2,v3", "", ""]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("隠れた外側の行を通した要素の入れ替えの途中で、配列の行をその外側の行へ付け替えないこと（3 段）", async () => {
    // 入れ替えの片側だけを書いた時点で、書いた位置の行は別の要素を映している。その間にこの行の下の配列を引いて行を
    // 付け替えると、揃った後の書き込みが別の要素のタグに着地した
    const errors = spyErrors();
    const tags = [{ t: "S" }, { t: "s" }];
    const inner = [{ v: "v0", tags }, { v: "v3", tags: [{ t: "t4" }, { t: "t5" }] }, { v: "v6", tags }];
    const { shadowRoot, stateEl } = await mount({ groups: [false, false, true].map((show) => ({ show, items: inner })) }, GROUPS_TAGS_IF);
    await step(stateEl, (s) => { s["groups.2.items.0"] = { v: "v18", tags: [{ t: "t19" }, { t: "t20" }] }; });
    await step(stateEl, (s) => {
      const second = s["groups.0.items.1"];
      s["groups.0.items.1"] = s["groups.0.items.2"];
      s["groups.0.items.2"] = second;
    });
    await step(stateEl, (s) => { s["groups.0.items.1.tags.0"] = { t: "L31" }; });
    const expected = "v18[t19t20],v6[L31s],v3[t4t5]";
    // 3.3.0: 状態は "v18[L31t20],v6[Ss],v3[t4t5]"（書き込みが別の要素のタグに着地した）
    expect(deepStateOf(stateEl)).toEqual([expected, expected, expected]);
    expect(view(shadowRoot)).toEqual(["", "", expected]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("隠れた外側の行を通した差し替えと写しを重ねた後、表示した外側の行が描く配列を取り違えないこと", async () => {
    // 行の台帳を引いても行を付け替えないのは、state に居る配列だけ — 要素書き込みの入れ替えの前の並びの写し（描いた
    // 並びの記録）を引いたときに付け替えると、行集合を手放した外側の行（最初に展開した行）へ戻し、表示している外側の行が
    // 別の外側の行の写しの値を描いた（この修理の途中の形）
    const errors = spyErrors();
    const inner = [{ v: "v0" }, { v: "v1" }, { v: "v2" }];
    const { shadowRoot, stateEl } = await mount({ groups: [false, false, true].map((show) => ({ show, items: inner })) }, GROUPS_IF);
    await step(stateEl, (s) => { s["groups.2.items"] = [...s["groups.2.items"]]; });
    await step(stateEl, (s) => { s["groups.1.items.0"] = { v: "v7" }; });
    await step(stateEl, (s) => { s["groups.1.items"] = [...s["groups.1.items"]]; });
    await step(stateEl, (s) => { s["groups.2.items"] = s["groups.0.items"]; });
    await step(stateEl, (s) => { s["groups.2.items.0"] = { v: "v27" }; s["groups.1.items.1"] = { v: "v29" }; });
    await step(stateEl, (s) => { s["groups.2.items"] = s["groups.0.items"]; });
    // 3.3.0: 状態は ["v27,v1,v2", "v0,v29,v2", "v27,v1,v2"]（隠れた外側の行 1 を通した差し替えが写しに着地した）
    expect(stateOf(stateEl)).toEqual(["v27,v1,v2", "v7,v29,v2", "v27,v1,v2"]);
    expect(view(shadowRoot)).toEqual(["", "", "v27,v1,v2"]);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("外側の行が内側の配列を手放した後の書き込み（#394）", () => {
  const issue = () => {
    const A = [{ v: "v0" }, { v: "v1" }];
    const B = [{ v: "v3" }, { v: "v4" }];
    return { groups: [{ items: A }, { items: B }, { items: B }] };
  };
  const rebind = (s: any) => {
    s["groups.1.items"] = s["groups.0.items"];
    s.groups = [s.groups[0], s.groups[2], s.groups[1]];
  };

  it("Issue の手順: 別の行の配列を代入して並べ替え、作り直してから葉を書くと、書いたパスの配列に着地すること", async () => {
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount(issue(), GROUPS);
    await step(stateEl, rebind);
    await step(stateEl, (s) => { s.groups = s.groups.map((g: any) => ({ ...g })); s["groups.1.items.0.v"] = "L45"; });
    // 3.3.0: 状態は ["L45,v1", "v3,v4", "L45,v1"]（A に着地し、B は変わらない）
    expect(stateOf(stateEl)).toEqual(["v0,v1", "L45,v4", "v0,v1"]);
    expect(view(shadowRoot)).toEqual(["v0,v1", "L45,v4", "v0,v1"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("作り直さずに葉を書いても、書いたパスの配列に着地すること", async () => {
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount(issue(), GROUPS);
    await step(stateEl, rebind);
    await step(stateEl, (s) => { s["groups.1.items.0.v"] = "L45"; });
    expect(stateOf(stateEl)).toEqual(["v0,v1", "L45,v4", "v0,v1"]);
    expect(view(shadowRoot)).toEqual(["v0,v1", "L45,v4", "v0,v1"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("外側の行の入れ替えの途中で引いた配列の行を、入れ替えている行へ付け替えないこと", async () => {
    const errors = spyErrors();
    const inner = [{ v: "v0" }, { v: "v1" }, { v: "v2" }, { v: "v3" }];
    const { shadowRoot, stateEl } = await mount({ groups: [0, 1, 2].map(() => ({ items: inner })) }, GROUPS);
    await step(stateEl, (s) => { s.groups = [...s.groups, { items: s["groups.1.items"] }]; });
    await step(stateEl, (s) => { s["groups.2.items"] = [...s["groups.2.items"]]; s.groups = s.groups.map((g: any) => ({ ...g })); });
    await step(stateEl, (s) => {
      const second = s["groups.1"];
      s["groups.1"] = s["groups.2"];
      // 入れ替えの片側だけを書いた時点で、位置 2 の行は位置 1 の要素（inner を持つ）を映している
      s["groups.2"] = second;
      s["groups.2.items.1"] = { v: "v18" };
    });
    const shared18 = "v0,v18,v2,v3";
    expect(stateOf(stateEl)).toEqual([shared18, "v0,v1,v2,v3", shared18, shared18]);
    expect(view(shadowRoot)).toEqual([shared18, "v0,v1,v2,v3", shared18, shared18]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("手放した後に作り直して並べ替え、要素を読んで同じ位置へ書き戻しても、状態が変わらないこと", async () => {
    const errors = spyErrors();
    const A = [{ v: "v0" }, { v: "v1" }];
    const B = [{ v: "v2" }, { v: "v3" }, { v: "v4" }, { v: "v5" }];
    const { shadowRoot, stateEl } = await mount({ groups: [{ items: A }, { items: B }, { items: A }, { items: A }] }, GROUPS);
    await step(stateEl, (s) => { s["groups.0.items"] = s["groups.1.items"]; });
    await step(stateEl, (s) => { s.groups = [...s.groups].reverse(); });
    await step(stateEl, (s) => { s.groups = s.groups.map((g: any) => ({ ...g })).reverse(); s.groups = [...s.groups].reverse(); });
    const before = ["v0,v1", "v0,v1", "v2,v3,v4,v5", "v2,v3,v4,v5"];
    expect(stateOf(stateEl)).toEqual(before);
    await step(stateEl, (s) => { const element = s["groups.0.items.1"]; s["groups.0.items.1"] = element; });
    expect(stateOf(stateEl)).toEqual(before);
    expect(view(shadowRoot)).toEqual(before);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("同じ要素オブジェクトを表す別の行への知らせの範囲（#393）", () => {
  it("同じ配列の 2 つの位置に置いた同じオブジェクトは、書いた行でない方が古いまま残ること（#365 の制約のまま）", async () => {
    // 写しの行と元の配列の行は知らせ合うが、同じ配列の中の 2 つの行は README の「One object at two positions」の制約のまま
    const errors = spyErrors();
    const o = { v: "a" };
    const { shadowRoot, stateEl } = await mount({ groups: [{ items: [o, o] }] }, GROUPS);
    await step(stateEl, (s) => { s["groups.0.items.0.v"] = "z"; });
    expect(stateOf(stateEl)).toEqual(["z,z"]);
    expect(view(shadowRoot)).toEqual(["z,a"]);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("共有していない配列の写しは、行を借りて描いた要素を保つ（#393 の範囲）", () => {
  const TREE = `<template data-wcs="for: groups"><section><template data-wcs="for: .subs"><div class="g"><template data-wcs="for: .items">` +
    `<span>{{ .v }}</span></template></div></template></section></template>`;

  it("3 段の外側の行を作り直した後に内側の配列を写しに替えても、描いた要素を作り直さないこと", async () => {
    // 外側の行を作り直すと、真ん中の行は差分を通らないので退役の印が付かない。祖先が退役した行を「もう配列を持たない親」と
    // 見ないと、内側の配列の行は古い真ん中の行の下に残り、新しい真ん中の行から引いた配列を 2 つの行が持つ配列と取り違え、
    // 写しに行を貸さずに内側の要素を全部作り直した
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount({
      groups: [0, 1].map((g) => ({ subs: [0, 1].map((s) => ({ items: [{ v: `${g}${s}a` }, { v: `${g}${s}b` }] })) })),
    }, TREE);
    await step(stateEl, (s) => { s.groups = s.groups.map((g: any) => ({ ...g, subs: g.subs.map((x: any) => ({ ...x })) })); });
    const first = shadowRoot.querySelector("span");
    await step(stateEl, (s) => { s["groups.0.subs.0.items"] = [...s["groups.0.subs.0.items"], { v: "x" }]; });
    expect(shadowRoot.querySelector("span")).toBe(first);
    expect(Array.from(shadowRoot.querySelectorAll("div.g")).map((d) => d.textContent)).toEqual(["00a00bx", "01a01b", "10a10b", "11a11b"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it.each([
    // 入れ替えの片側を書いた時点では、書いた位置の行が別の要素を映していて、その要素の配列を引く — 共有ではない
    ["外側の行を 2 つの要素書き込みで入れ替えた後", (s: any) => { const first = s["groups.0"]; s["groups.0"] = s["groups.1"]; s["groups.1"] = first; }],
    // 新しい要素の行はまだ前の行（差分がこれから退役させる）の下にある配列を引く — 前の行は退役したら数えない
    ["外側の要素を同じ配列を持つ新しい要素に替えた後", (s: any) => { s["groups.0"] = { items: s["groups.0.items"] }; }],
  ] as [string, (s: any) => void][])("%s、内側の配列を写しに替えても、描いた要素を作り直さないこと", async (_label, op) => {
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount({ groups: [0, 1, 2].map((g) => ({ items: [{ v: `${g}a` }, { v: `${g}b` }] })) }, GROUPS);
    await step(stateEl, op);
    const first = shadowRoot.querySelector("span");
    await step(stateEl, (s) => { s["groups.0.items"] = [...s["groups.0.items"], { v: "x" }]; });
    expect(shadowRoot.querySelector("span")).toBe(first);
    expect(view(shadowRoot)).toEqual(stateOf(stateEl));
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("別の外側の行が引き継いだ配列を、さらに別の配列に替える（#394 — 行集合の home）", () => {
  const L = (...values: string[]) => values.map((v) => ({ v }));

  it("手放した配列を別の外側の行が引き、別の配列に替えてから書くと、その配列に着地すること", async () => {
    // 新しい配列の行は、前の行集合の home（配列を最初に展開した外側の行 0）を継いでいた。外側の行 0 は新しい配列を
    // 持ったことが無く、手放してもいないので、行集合は外側の行 0 へ戻され、書き込みが外側の行 0 の配列に着地した
    const errors = spyErrors();
    const A = L("a", "b");
    const { shadowRoot, stateEl } = await mount({ groups: [{ items: A }, { items: L("p", "q") }], pool: A }, GROUPS);
    await step(stateEl, (s) => { s["groups.0.items"] = L("d1", "d2"); });
    await step(stateEl, (s) => { s["groups.1.items"] = s.pool; });
    await step(stateEl, (s) => { s["groups.1.items"] = L("x", "y"); });
    await step(stateEl, (s) => { s["groups.1.items.0"] = { v: "M" }; });
    // 4 つ目の修理の途中の形: 状態は ["M,d2", "x,y"]、描画は外側の行 1 が "d1,d2"
    expect(stateOf(stateEl)).toEqual(["d1,d2", "M,y"]);
    expect(view(shadowRoot)).toEqual(["d1,d2", "M,y"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("内側の配列を別の外側の行へ移して替え、元の外側の行に足しても、それぞれの配列に着地すること", async () => {
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount({ groups: [{ items: L("a", "b") }, { items: L("p", "q") }] }, GROUPS);
    await step(stateEl, (s) => { const moved = s["groups.0.items"]; s["groups.0.items"] = []; s["groups.1.items"] = moved; });
    await step(stateEl, (s) => { s["groups.1.items"] = L("x", "y"); });
    await step(stateEl, (s) => { s["groups.1.items.0"] = { v: "M" }; });
    await step(stateEl, (s) => { s["groups.0.items"] = [...s["groups.0.items"], { v: "k" }]; });
    // 4 つ目の修理の途中の形: M が外側の行 0 に着地し、足すと TypeError（Cannot read properties of undefined）で落ちた
    expect(stateOf(stateEl)).toEqual(["k", "M,y"]);
    expect(view(shadowRoot)).toEqual(["k", "M,y"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("内側の配列を別の外側の行へ移して足した後も、移した先の外側の行に着地すること", async () => {
    // 足した写しは、移した行集合を引き継ぐ。引き継いだ行の home が元の外側の行のままだと、写しの行集合がそちらへ戻された。
    // 3.3.0: 移した先の外側の行は空の文字（","）を描き、M が外側の行 0 の配列に着地した
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount({ groups: [{ items: L("a", "b") }, { items: L("p", "q") }] }, GROUPS);
    await step(stateEl, (s) => { const moved = s["groups.0.items"]; s["groups.0.items"] = []; s["groups.1.items"] = moved; });
    await step(stateEl, (s) => { s["groups.1.items"] = [...s["groups.1.items"], { v: "c" }]; });
    await step(stateEl, (s) => { s["groups.1.items.0"] = { v: "M" }; });
    await step(stateEl, (s) => { s["groups.1.items.2.v"] = "C!"; });
    expect(stateOf(stateEl)).toEqual(["", "M,b,C!"]);
    expect(view(shadowRoot)).toEqual(["", "M,b,C!"]);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("同じ外側の行の 2 つのパスが同じ配列を持つ（#394 — 手放すのはどのパスも持たなくなったとき）", () => {
  const L = (...values: string[]) => values.map((v) => ({ v }));
  const TWO = `<template data-wcs="for: groups"><div class="g"><template data-wcs="for: .items"><span>{{ .v }}</span></template>` +
    `<template data-wcs="for: .alt"><b>{{ .v }}</b></template></div></template>`;
  const view2 = (root: ShadowRoot): string[] =>
    Array.from(root.querySelectorAll("div.g")).map((group) =>
      Array.from(group.querySelectorAll("span")).map((span) => span.textContent).join(",") + "|" +
      Array.from(group.querySelectorAll("b")).map((b) => b.textContent).join(","));
  const state2 = (stateEl: State): string[] =>
    read(stateEl, (s) => s.groups.map((g: any) => g.items.map((x: any) => x.v).join(",") + "|" + g.alt.map((x: any) => x.v).join(",")));

  it("片方のパスだけを替えた配列を別の外側の行が引いて替えても、もう片方のパスの書き込みはその配列に着地すること", async () => {
    // 片方のパスを替えただけで外側の行がその配列を手放したことにすると、別の外側の行が引いたときに行集合がそちらへ
    // 付け替わり、元の外側の行の書き込みが別の外側の行の配列に着地した（4 つ目の修理の途中の形）
    const errors = spyErrors();
    const A = L("a", "b");
    const { shadowRoot, stateEl } = await mount({ groups: [{ items: A, alt: A }, { items: L("p", "q"), alt: L("r") }] }, TWO);
    await step(stateEl, (s) => { s["groups.0.alt"] = L("z"); });
    await step(stateEl, (s) => { s["groups.1.items"] = s["groups.0.items"]; });
    await step(stateEl, (s) => { s["groups.1.items"] = L("x", "y"); });
    await step(stateEl, (s) => { s["groups.0.items.1"] = { v: "R" }; });
    expect(state2(stateEl)).toEqual(["a,R|z", "x,y|r"]);
    expect(view2(shadowRoot)).toEqual(["a,R|z", "x,y|r"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("片方のパスを絞り込んだ写しに替えても、もう片方のパスの葉の書き込みが描かれること", async () => {
    // 同じ外側の行の別のパスがまだ前の配列を持つので、写しに前の配列の行を貸さない — 貸すと行の添字が写しの位置に
    // 振り直され、前の配列を描くパスの葉の書き込みが描かれなかった（4 つ目の修理の途中の形）
    const errors = spyErrors();
    const A = L("a", "b", "c");
    const { shadowRoot, stateEl } = await mount({ groups: [{ items: A, alt: A }, { items: L("p"), alt: L("p") }] }, TWO);
    await step(stateEl, (s) => { s["groups.0.alt"] = s["groups.0.items"].filter((x: any) => x.v !== "b"); });
    await step(stateEl, (s) => { s["groups.1.items"] = s["groups.0.items"]; });
    await step(stateEl, (s) => { s["groups.1.items"] = L("p2"); });
    await step(stateEl, (s) => { s["groups.0.items.1.v"] = "B!"; });
    expect(state2(stateEl)).toEqual(["a,B!,c|a,c", "p2|p"]);
    expect(view2(shadowRoot)).toEqual(["a,B!,c|a,c", "p2|p"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("作り直した外側の行で 2 つのパスの片方を写しに替えた後、別の外側の行が引いて替えても、差し替えが着地すること", async () => {
    const errors = spyErrors();
    const A = L("a", "b");
    const { shadowRoot, stateEl } = await mount({ groups: [{ items: A, alt: A }, { items: L("p"), alt: L("q") }] }, TWO);
    await step(stateEl, (s) => { s.groups = s.groups.slice(1); });
    await step(stateEl, (s) => { const B = L("a", "b"); s.groups = [{ items: B, alt: B }, ...s.groups]; });
    await step(stateEl, (s) => { s["groups.0.items.0"] = { v: "M" }; });
    await step(stateEl, (s) => { s["groups.0.alt"] = [...s["groups.0.alt"]]; });
    await step(stateEl, (s) => { s["groups.0.items.1.v"] = "Q"; });
    await step(stateEl, (s) => { s["groups.1.items"] = s["groups.0.items"]; });
    await step(stateEl, (s) => { s["groups.1.items"] = L("n"); });
    await step(stateEl, (s) => { s["groups.0.items.1"] = { v: "R" }; });
    // 4 つ目の修理の途中の形: 最後の差し替えが別の配列に着地した
    expect(state2(stateEl)).toEqual(["M,R|M,Q", "n|q"]);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("共有をやめた配列の写し（#393 の範囲 — 共有の印は残さない）", () => {
  it("2 つの外側の行が持っていた配列を片方が手放した後は、もう片方の写しが描いた要素を保つこと", async () => {
    // 一度 2 つの外側の行から引かれた配列をずっと共有と数えると、共有をやめた後の写しにも行を貸さず、内側の要素を
    // 作り直した（4 つ目の修理の途中の形 — 4 つのうち 1 つしか保たれなかった。main と v3.3.0 は 3 つ）
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount(shared("a", "b", "c"), GROUPS);
    await step(stateEl, (s) => { s["groups.1.items"] = [{ v: "x" }]; });
    // 同じ要素を描いていた span がそのまま残るか（プールから戻った span が別の要素を描くのは数えない）
    const before = new Map(Array.from(shadowRoot.querySelectorAll("div.g")[0].querySelectorAll("span")).map((span) => [span.textContent, span]));
    await step(stateEl, (s) => { s["groups.0.items"] = [...s["groups.0.items"], { v: "d" }]; });
    const after = Array.from(shadowRoot.querySelectorAll("div.g")[0].querySelectorAll("span"));
    expect(after.filter((span) => before.get(span.textContent) === span)).toHaveLength(3);
    expect(view(shadowRoot)).toEqual(["a,b,c,d", "x"]);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("共有された配列を getter が絞り込む（#393 — 書かずに写しへ替わる外側の行）", () => {
  const SHOWN =
    `<template data-wcs="for: groups"><div class="g"><template data-wcs="for: .shown"><span>{{ .v }}</span></template></div></template>`;
  const init = () => {
    const A = [{ v: "a" }, { v: "b" }, { v: "c" }];
    return {
      groups: [{ items: A }, { items: A }],
      hide: false,
      get "groups.*.shown"(this: any) {
        return this.hide ? this["groups.*.items"].filter((x: any) => x.v !== "b") : this["groups.*.items"];
      },
    };
  };

  it("2 つの外側の行が持つ配列を getter で絞り込んで戻しても、どちらの外側の行も描いた並びを描くこと", async () => {
    // 外側の行はどちらも配列を手放していない（書いたのは hide だけ）ので、写しの差分を取る外側の行自身も配列を持つ外側の行に
    // 数えてある。自分を除いて、もう片方がまだ持つかを見る（写しは #362 のとおり新しい行で描く）
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount(init(), SHOWN);
    await step(stateEl, (s) => { s.hide = true; });
    expect(view(shadowRoot)).toEqual(["a,c", "a,c"]);
    await step(stateEl, (s) => { s.hide = false; });
    expect(view(shadowRoot)).toEqual(["a,b,c", "a,b,c"]);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("隠れた外側の行が持つ配列の写しを並べ替えた後（#393 — `if` で隠れた外側の行は持ち主に数えられない）", () => {
  // 隠れた外側の行は差分を通らないので、配列を持つ外側の行に数えられず、もう片方の外側の行の写しは元の配列の行を借りる。
  // 5 つ目の修理までは、後から隠れた外側の行が元の配列を引くと、借りた行が元の配列の並びへ振り直され、写しの描画と書き込みが
  // 元の配列の並びに移った。いまは行の親を、より多くのキーで配列を持つ外側の行へ付け替え、行のアドレスは、いまの親がその
  // キーでその行を持たなければ憶えた親を使う（address/StateAddress.ts）ので、写しの位置の書き込みは描いた要素に着地する。
  // main・v3.3.0 はどの段も正しい
  const hiddenShared = () => {
    const I = [{ v: "v0" }, { v: "v1" }, { v: "v2" }];
    return { groups: [{ show: true, items: I }, { show: false, items: I }] };
  };
  async function copyRebuildReorder(stateEl: State, reorder: (s: any) => void): Promise<void> {
    await step(stateEl, (s) => { s["groups.0.items"] = [...s["groups.0.items"]]; });
    await step(stateEl, (s) => { s.groups = s.groups.map((g: any) => ({ ...g })); });
    await step(stateEl, reorder);
  }

  it.each([
    ["$postUpdate", (s: any) => { s.$postUpdate("groups.1.items"); }],
    ["自己代入", (s: any) => { s["groups.1.items"] = s["groups.1.items"]; }],
    ["外側の要素の自己代入", (s: any) => { s["groups.1"] = s["groups.1"]; }],
  ])("隠れた外側の行の配列を %s で知らせても、写しの並びのまま描き、書き込みが描いた要素に着地すること", async (_name, touch) => {
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount(hiddenShared(), GROUPS_IF);
    await copyRebuildReorder(stateEl, (s) => { s["groups.0.items"] = [...s["groups.0.items"]].reverse(); });
    await step(stateEl, touch);
    // 5 つ目の修理: ["v0,v1,v2", ""]
    expect(view(shadowRoot)).toEqual(["v2,v1,v0", ""]);
    await step(stateEl, (s) => { s["groups.0.items.0.v"] = "W"; });
    // 5 つ目の修理: W が v0 に着地した
    expect(stateOf(stateEl)).toEqual(["W,v1,v0", "v0,v1,W"]);
    expect(view(shadowRoot)).toEqual(["W,v1,v0", ""]);
    expect(errors).not.toHaveBeenCalled();
  });

  it.each([
    ["絞り込んだ写し", (s: any) => { s["groups.0.items"] = s["groups.0.items"].filter((x: any) => x.v !== "v0"); }, "v1,v2", "W,v2", "v0,W,v2"],
    ["先頭に足した写し", (s: any) => { s["groups.0.items"] = [{ v: "n" }, ...s["groups.0.items"]]; }, "n,v0,v1,v2", "W,v0,v1,v2", "v0,v1,v2"],
  ])("%s に替えた後に隠れた外側の行の配列を知らせても、書き込みが描いた要素に着地すること", async (_name, reorder, drawn, written, hidden) => {
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount(hiddenShared(), GROUPS_IF);
    await copyRebuildReorder(stateEl, reorder);
    await step(stateEl, (s) => { s.$postUpdate("groups.1.items"); });
    expect(view(shadowRoot)).toEqual([drawn, ""]);
    await step(stateEl, (s) => { s["groups.0.items.0.v"] = "W"; });
    expect(stateOf(stateEl)).toEqual([written, hidden]);
    expect(view(shadowRoot)).toEqual([written, ""]);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("既知の制約（いまの振る舞いを固定する — 直したらこのテストを書き換える）", () => {
  const L = (...values: string[]) => values.map((v) => ({ v }));

  it("入れ子の別のパスがまだ持つ配列を別の外側の行に渡して作り直した後の葉の書き込みが、もう片方のキーの for に描かれないこと（状態は正しい） #398", async () => {
    // 外側の行が内側のパスを替えたときに配列を手放したか（releaseListAtParent）は、要素の直下のキーだけを見るので、`.items` を
    // 替えた外側の行 0 は `.sub.alt` にまだ残る配列も手放したことになり、作り直しで行集合が外側の行 1 の下へ移る。行の
    // アドレスは、いまの親がそのキーでこの行の配列を持たなければ憶えた親を使う（address/StateAddress.ts）ので、
    // `groups.0.sub.alt.0.v` は A に着地する（6 つ目の修理までは外側の行 1 の `.sub.alt` = C に着地した）。葉の書き込みは
    // 別のキー（外側の行 1 の `.items`）の `for` を描き直さない。main・v3.3.0 は状態は正しいが、外側の行 1 は 2 段目から
    // `b0,b1` を描いた
    const TWO_PATHS = `<template data-wcs="for: groups"><div class="g"><template data-wcs="for: .items"><span>{{ .v }}</span></template>` +
      `<template data-wcs="for: .sub.alt"><b>{{ .v }}</b></template></div></template>`;
    const view2 = (root: ShadowRoot): string[] =>
      Array.from(root.querySelectorAll("div.g")).map((group) =>
        Array.from(group.querySelectorAll("span")).map((span) => span.textContent).join(",") + "|" +
        Array.from(group.querySelectorAll("b")).map((b) => b.textContent).join(","));
    const state2 = (stateEl: State): string[] =>
      read(stateEl, (s) => s.groups.map((g: any) => g.items.map((x: any) => x.v).join(",") + "|" + g.sub.alt.map((x: any) => x.v).join(",")));
    const A = L("a0", "a1");
    const C = L("c0");
    const { shadowRoot, stateEl } = await mount({ groups: [{ items: A, sub: { alt: A } }, { items: C, sub: { alt: C } }] }, TWO_PATHS);
    await step(stateEl, (s) => { s["groups.0.items"] = L("b0", "b1"); });
    await step(stateEl, (s) => { s["groups.1.items"] = s["groups.0.sub.alt"]; });
    expect(view2(shadowRoot)).toEqual(["b0,b1|a0,a1", "a0,a1|c0"]);
    await step(stateEl, (s) => { s.groups = s.groups.map((g: any) => ({ ...g })); });
    expect(view2(shadowRoot)).toEqual(["b0,b1|a0,a1", "a0,a1|c0"]);
    await step(stateEl, (s) => { s["groups.0.sub.alt.0.v"] = "X"; });
    expect(state2(stateEl)).toEqual(["b0,b1|X,a1", "X,a1|c0"]);
    expect(view2(shadowRoot)).toEqual(["b0,b1|X,a1", "a0,a1|c0"]);
  });

  it("2 つの <wcs-state> が同じ内側の配列を持ち、片方で外側の行を作り直すと、もう片方の書き込みが写しに着地すること #397", async () => {
    // 行の台帳は配列ごとに 1 組で state をまたぐので、state a の作り直しで行集合の親が a の新しい外側の行へ移り、state b の
    // 行のアドレスがそれを経由する（R2）。5 つ目・6 つ目の修理から。main・v3.3.0 は A に着地する。同じ配列を 2 つの state の
    // 別の位置に持つ形は、どの版も書き込みが別の要素に着地する（実質的に未対応）
    const A = L("a", "b", "c");
    const first = await mount({ groups: [{ items: A }, { items: A }] }, GROUPS);
    const second = await mount({ groups: [{ items: A }, { items: A }] }, GROUPS);
    await step(first.stateEl, (s) => { s.groups = s.groups.map((g: any) => ({ ...g })); });
    await step(second.stateEl, (s) => { s["groups.0.items"] = [...s["groups.0.items"]]; });
    await step(second.stateEl, (s) => { s["groups.1.items.0"] = { v: "M" }; });
    expect(stateOf(second.stateEl)).toEqual(["M,b,c", "a,b,c"]);
    expect(stateOf(first.stateEl)).toEqual(["a,b,c", "a,b,c"]);
  });

  it("ルートと、ルートに接ぎ木したボリュームが同じ内側の配列を持つと、ルートの写しの後のボリュームの差し替えが投げること #397", async () => {
    // R2 の変形（ボリューム）。行の台帳は state をまたいで 1 組なので、ルートの写しが行の親を動かし、ボリュームの
    // `vol.groups.0.items.0` のアドレスがボリュームの外を指す。5 つ目の修理から。main は添字がたまたま揃って正しく着地する
    const A = L("a0", "a1");
    const host = document.createElement(`shared-inner-rebind-vol-${Math.random().toString(36).slice(2)}`);
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<wcs-state mount="vol"></wcs-state><wcs-state></wcs-state>` + GROUPS +
      `<section><template data-wcs="for: vol.groups"><p><template data-wcs="for: .items"><i>{{ .v }}</i></template></p></template></section>`;
    document.body.appendChild(host);
    const volume = shadowRoot.querySelector("wcs-state[mount]") as State;
    const root = shadowRoot.querySelector("wcs-state:not([mount])") as State;
    root.setInitialState({ groups: [{ items: A }, { items: A }] });
    volume.setInitialState({ groups: [{ items: A }] });
    await root.connectedCallbackPromise;
    await volume.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    await flush();
    await step(root, (s) => { s["groups.0.items"] = [...s["groups.0.items"]]; });
    expect(() => write(root, (s) => { s["vol.groups.0.items.0"] = { v: "M" }; })).toThrow("Reflect.set called on non-object");
    expect(read(root, (s) => s["vol.groups.0.items"].map((x: any) => x.v).join(","))).toBe("a0,a1");
    host.remove();
  });

  it("2 つの <wcs-state> が同じ外側の配列を持ち、片方で外側の行を作り直すと、もう片方の差し替えが描かれないこと（状態は正しい） #397", async () => {
    // R2 の変形（外側の配列そのものを共有 — 同じ取得結果を 2 つの state に流した形）。5 つ目の修理から。main・v3.3.0 は描く
    const G = [{ items: L("a", "b", "c") }, { items: L("x", "y") }];
    const first = await mount({ groups: G }, GROUPS);
    const second = await mount({ groups: G }, GROUPS);
    await step(first.stateEl, (s) => { s.groups = s.groups.map((g: any) => ({ ...g })); });
    await step(second.stateEl, (s) => { s["groups.0.items.1"] = { v: "M" }; });
    expect(stateOf(second.stateEl)).toEqual(["a,M,c", "x,y"]);
    expect(view(second.shadowRoot)).toEqual(["a,b,c", "x,y"]);
    first.host.remove();
    second.host.remove();
  });

  it("同じ配列を別の外側の行が別のキーに持つと、片方のキーを通した書き込みが別の配列に着地すること（B と同じ系統） #396", async () => {
    // 行集合の親は 1 つで、行のアドレスは親から引き直すので、`alt` に持つ外側の行 1 を親にした行の、外側の行 0 の `items`
    // を通したアドレスは外側の行 1 の `items`（別の配列）を指す。main・v3.3.0 は状態は正しい（["L,v0|v0,v1", …]）が、
    // 外側の行 0 の `items` を描き損ねる。外側の行をまたいで別のキーに持つ形は、近い手順でどの版も状態が壊れる
    const TWO_KEYS = `<template data-wcs="for: groups"><div class="g"><template data-wcs="for: .items"><span>{{ .v }}</span></template>` +
      `<template data-wcs="for: .alt"><b>{{ .v }}</b></template></div></template>`;
    const viewKeys = (root: ShadowRoot): string[] =>
      Array.from(root.querySelectorAll("div.g")).map((group) =>
        Array.from(group.querySelectorAll("span")).map((span) => span.textContent).join(",") + "|" +
        Array.from(group.querySelectorAll("b")).map((b) => b.textContent).join(","));
    const stateKeys = (stateEl: State): string[] =>
      read(stateEl, (s) => s.groups.map((g: any) => g.items.map((x: any) => x.v).join(",") + "|" + g.alt.map((x: any) => x.v).join(",")));
    const A = L("v0", "v1");
    const { shadowRoot, stateEl } = await mount({ groups: [0, 1, 2].map(() => ({ items: A, alt: A })) }, TWO_KEYS);
    await step(stateEl, (s) => { s["groups.1.alt"] = [...s["groups.1.alt"]].reverse(); });
    await step(stateEl, (s) => { s["groups.0.items"] = s["groups.1.alt"]; });
    expect(viewKeys(shadowRoot)).toEqual(["v0,v1|v0,v1", "v0,v1|v1,v0", "v0,v1|v0,v1"]);
    await step(stateEl, (s) => { s["groups.0.items.0.v"] = "L"; });
    expect(stateKeys(stateEl)).toEqual(["v1,L|L,v1", "L,v1|v1,L", "L,v1|L,v1"]);
  });

  it("写しの写しを別の外側の行にも持たせた後の葉の書き込みが、元の配列を描く外側の行に描かれないこと（状態は正しい） #398", async () => {
    // 同じ要素を表す別の行（getElementAliases）が元の配列の行を返さない。5 つ目の修理から。main・v3.3.0 は全部の外側の行が L を描く
    const I = L("v0", "v1", "v2");
    const { shadowRoot, stateEl } = await mount({ groups: [0, 1, 2, 3].map(() => ({ show: true, items: I })) }, GROUPS_IF);
    await step(stateEl, (s) => {
      s["groups.3.items"] = [...s["groups.3.items"]];
      s.groups = [...s.groups, { show: true, items: s["groups.3.items"] }];
    });
    await step(stateEl, (s) => { s["groups.4.items"] = [...s["groups.4.items"]]; });
    await step(stateEl, (s) => {
      s["groups.1.items"] = s["groups.4.items"];
      s["groups.4.items.0.v"] = "L";
    });
    expect(stateOf(stateEl)).toEqual(["L,v1,v2", "L,v1,v2", "L,v1,v2", "L,v1,v2", "L,v1,v2"]);
    expect(view(shadowRoot)).toEqual(["v0,v1,v2", "L,v1,v2", "v0,v1,v2", "L,v1,v2", "L,v1,v2"]);
  });

  it("2 つの要素が同じ tags を持つ配列で、片方の tags の要素の差し替えと別の外側の行の共有を 1 つの更新で重ねると、もう片方が描き直されないこと（状態は正しい） #398", async () => {
    // main も同じ。3.3.0 の後の main の途中（ce）は描いた
    const T = [{ t: "S" }, { t: "s" }];
    const I = [{ v: "v0", tags: T }, { v: "v2", tags: [{ t: "t3" }] }, { v: "v5", tags: T }];
    const J = [{ v: "w0", tags: [{ t: "u1" }] }];
    const { shadowRoot, stateEl } = await mount({ groups: [{ items: I }, { items: I }, { items: I }, { items: J }] }, GROUPS_TAGS);
    await step(stateEl, (s) => {
      s["groups.2.items"] = s["groups.3.items"];
      s["groups.1.items.0.tags.0"] = { t: "L" };
    });
    expect(deepStateOf(stateEl)).toEqual(["v0[Ls],v2[t3],v5[Ls]", "v0[Ls],v2[t3],v5[Ls]", "w0[u1]", "w0[u1]"]);
    expect(view(shadowRoot)).toEqual(["v0[Ls],v2[t3],v5[Ss]", "v0[Ls],v2[t3],v5[Ss]", "w0[u1]", "w0[u1]"]);
  });

  it("外側の行 0 の写しと、外側の行 2 の要素を外側の行 1 の写しへ移すのを 1 つの更新で重ねた後、外側の行 2 の tags の差し替えが外側の行 2 に描かれないこと（状態は正しい） #398", async () => {
    // 手放した外側の行の行集合を、配列を持つ別の外側の行へすぐ付け替える（releaseListAtParent）ようにしてから。5 つ目の修理は
    // 描いた。main・v3.3.0 は 1 つ目の更新で、外側の行 2 に書いた要素が外側の行 0 の写しにも着地する（状態が壊れる）
    const I = [{ v: "v0", tags: [{ t: "S" }, { t: "s" }] }, { v: "v3", tags: [{ t: "t4" }] }];
    const { shadowRoot, stateEl } = await mount({ groups: [{ items: I }, { items: I }, { items: I }] }, GROUPS_TAGS);
    await step(stateEl, (s) => {
      s["groups.0.items"] = [...s["groups.0.items"]];
      const moved = s["groups.2.items.0"];
      s["groups.2.items.0"] = { v: "v15", tags: [{ t: "t16" }] };
      s["groups.1.items"] = [...s["groups.1.items"], moved];
    });
    expect(view(shadowRoot)).toEqual(["v0[Ss],v3[t4]", "v15[t16],v3[t4],v0[Ss]", "v15[t16],v3[t4]"]);
    await step(stateEl, (s) => { s["groups.2.items.1.tags.0"] = { t: "L21" }; });
    expect(deepStateOf(stateEl)).toEqual(["v0[Ss],v3[L21]", "v15[t16],v3[L21],v0[Ss]", "v15[t16],v3[L21]"]);
    expect(view(shadowRoot)).toEqual(["v0[Ss],v3[L21]", "v15[t16],v3[L21],v0[Ss]", "v15[t16],v3[t4]"]);
  });
});

describe("配列を手放した外側の行が行集合の親のとき（#393 / #394 — 手放したらすぐ、配列を持つ別の外側の行へ付け替える）", () => {
  // 行集合の親が配列を手放してから、配列を持つ別の外側の行が引くまでの間に描き直した行の下のアドレスが、手放した外側の行を
  // 経由してその外側の行の新しい値（写し）を読み書きした（5 つ目の修理の検証の f5/if/1242・f5/if/1247）。main・v3.3.0 は
  // 下の 2 つの形を正しく描き、3 つ目は v3.3.0・main とも状態が壊れる
  const L = (...values: string[]) => values.map((v) => ({ v }));

  it("隠れた外側の行に知らせた更新で別の外側の行が写しに替えても、もう 1 つの外側の行の描画と書き込みは元の配列のままのこと", async () => {
    const errors = spyErrors();
    const I = L("v0", "v1");
    const { shadowRoot, stateEl } = await mount({
      groups: [{ show: false, items: I }, { show: true, items: I }, { show: true, items: I }, { show: true, items: I }],
    }, GROUPS_IF);
    await step(stateEl, (s) => { s["groups.2.show"] = false; });
    await step(stateEl, (s) => {
      s.$postUpdate("groups.2.items");
      s["groups.1.items"] = [...s["groups.1.items"]].reverse();
    });
    // 5 つ目の修理: ["", "v1,v0", "", "v1,v0"]（外側の行 3 が外側の行 1 の写しを読んだ）
    expect(view(shadowRoot)).toEqual(["", "v1,v0", "", "v0,v1"]);
    await step(stateEl, (s) => { s["groups.3.items.1.v"] = "L"; });
    // 5 つ目の修理: L が v0 に着地した
    expect(stateOf(stateEl)).toEqual(["v0,L", "L,v0", "v0,L", "v0,L"]);
    expect(view(shadowRoot)).toEqual(["", "L,v0", "", "v0,L"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("隠れた外側の行の配列を自己代入で知らせ、要素の入れ替え・表示・写しの逆順を 1 つの更新で重ねても、書き込みが描いた要素に着地すること", async () => {
    const errors = spyErrors();
    const I = L("v0", "v1");
    const { shadowRoot, stateEl } = await mount({ groups: [{ show: false, items: I }, { show: true, items: I }, { show: false, items: I }] }, GROUPS_IF);
    await step(stateEl, (s) => { s["groups.0.items"] = s["groups.0.items"]; });
    await step(stateEl, (s) => {
      const first = s["groups.1.items.0"];
      s["groups.1.items.0"] = s["groups.1.items.1"];
      s["groups.1.items.1"] = first;
      s["groups.0.show"] = true;
      s["groups.1.items"] = [...s["groups.1.items"]].reverse();
    });
    // 5 つ目の修理: ["v0,v1", "v0,v1", ""]
    expect(view(shadowRoot)).toEqual(["v1,v0", "v0,v1", ""]);
    await step(stateEl, (s) => { s["groups.0.items.0.v"] = "W"; });
    // 5 つ目の修理: W が v0 に着地した（["v1,W", "W,v1", "v1,W"]）
    expect(stateOf(stateEl)).toEqual(["W,v0", "v0,W", "W,v0"]);
    expect(view(shadowRoot)).toEqual(["W,v0", "v0,W", ""]);
    expect(errors).not.toHaveBeenCalled();
  });
  it("外側の行を逆順にして 1 つを隠し、別の外側の行が逆順の写しに替えた後で隠れた外側の行の配列を知らせても、描画と書き込みが元の配列のままのこと", async () => {
    // v3.3.0・main: 知らせた後に外側の行 0 が `v1,v0` を描き、L が v0 に着地した
    const errors = spyErrors();
    const I = L("v0", "v1");
    const { shadowRoot, stateEl } = await mount({
      groups: [{ show: false, items: I }, { show: true, items: I }, { show: true, items: I }, { show: true, items: I }],
    }, GROUPS_IF);
    await step(stateEl, (s) => { s.groups = [...s.groups].reverse(); });
    await step(stateEl, (s) => { s["groups.1.show"] = false; });
    await step(stateEl, (s) => { s["groups.2.items"] = [...s["groups.2.items"]].reverse(); });
    await step(stateEl, (s) => { s.$postUpdate("groups.1.items"); });
    expect(view(shadowRoot)).toEqual(["v0,v1", "", "v1,v0", ""]);
    await step(stateEl, (s) => { s["groups.0.items.1.v"] = "L"; });
    expect(stateOf(stateEl)).toEqual(["v0,L", "v0,L", "L,v0", "v0,L"]);
    expect(view(shadowRoot)).toEqual(["v0,L", "", "L,v0", ""]);
    expect(errors).not.toHaveBeenCalled();
  });
  it("同じ更新で、外側の行を外し、残った外側の行が共有した配列を写しに替えても、描画を続けること", async () => {
    // 外した外側の行に知らせた配列（自己代入）を、行を写しに貸した後で引いても、その外側の行のために新しい行集合を作らない —
    // 作ると、写しを描く `for` が描いた行を見失った（Content not found — 6 つ目の修理の途中の形・f5/mix/1065）
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount(shared("v0", "v1", "v2", "v3"), GROUPS);
    await step(stateEl, (s) => {
      s["groups.1.items"] = s["groups.1.items"];
      s.groups = s.groups.filter((_: unknown, k: number) => k !== 1);
      s["groups.0.items"] = [...s["groups.0.items"]];
    });
    expect(view(shadowRoot)).toEqual(["v0,v1,v2,v3"]);
    await step(stateEl, (s) => { s["groups.0.items.1"] = { v: "M" }; });
    expect(stateOf(stateEl)).toEqual(["v0,M,v2,v3"]);
    expect(view(shadowRoot)).toEqual(["v0,M,v2,v3"]);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("同じ外側の行が同じ配列を 2 つのキーに持ち、別の外側の行も持つ（R1 — 付け替え先は同じキーで持つ外側の行だけ）", () => {
  // 行のアドレスは行の親から引き直すので、片方のキー（`alt`）にしか配列を持たない外側の行を親にすると、もう片方のキー
  // （`items`）を通した読み書きが、その外側の行の `items`（別の配列）に着地した（6 つ目の修理の検証の f6 dual）。付け替え・
  // 手放したときの付け替えは、いまの親が配列を持つどのキーでも持つ外側の行にだけ、親より多くのキーで持つ外側の行が引いたら
  // そちらへ付け替える
  const L = (...values: string[]) => values.map((v) => ({ v }));
  const DUAL = `<template data-wcs="for: groups"><div class="g"><template data-wcs="for: .items"><span>{{ .v }}</span></template>` +
    `<template data-wcs="for: .alt"><b>{{ .v }}</b></template></div></template>`;
  const viewDual = (root: ShadowRoot): string[] =>
    Array.from(root.querySelectorAll("div.g")).map((group) =>
      Array.from(group.querySelectorAll("span")).map((span) => span.textContent).join(",") + "|" +
      Array.from(group.querySelectorAll("b")).map((b) => b.textContent).join(","));
  const stateDual = (stateEl: State): string[] =>
    read(stateEl, (s) => s.groups.map((g: any) => g.items.map((x: any) => x.v).join(",") + "|" + g.alt.map((x: any) => x.v).join(",")));

  it("外側の行を外し、残った外側の行の片方のキーを写しに替えた後、もう 1 つの外側の行を通した差し替えがその配列に着地すること", async () => {
    // 6 つ目の修理・5 つ目の修理: M が外側の行 1 の写しに着地し、A は変わらなかった。main は状態は正しいが描き直さない
    const errors = spyErrors();
    const A = L("v0", "v1", "v2");
    const { shadowRoot, stateEl } = await mount({ groups: [0, 1, 2].map(() => ({ items: A, alt: A })) }, DUAL);
    await step(stateEl, (s) => { s.groups = s.groups.filter((_: unknown, k: number) => k !== 0); });
    await step(stateEl, (s) => { s["groups.1.items"] = [...s["groups.1.items"], { v: "P" }]; });
    await step(stateEl, (s) => { s["groups.0.items.0"] = { v: "M" }; });
    expect(stateDual(stateEl)).toEqual(["M,v1,v2|M,v1,v2", "v0,v1,v2,P|M,v1,v2"]);
    expect(viewDual(shadowRoot)).toEqual(["M,v1,v2|M,v1,v2", "v0,v1,v2,P|M,v1,v2"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("片方のキーだけに配列を持つ外側の行がある一覧を逆順にして作り直しても、どの外側の行もそれぞれの配列を描き、差し替えが着地すること", async () => {
    // 6 つ目の修理: 作り直しの後、2 つの外側の行の `items` が B の値を描き、差し替えが B に着地した
    const errors = spyErrors();
    const A = L("a0", "a1");
    const B = L("b0", "b1");
    const { shadowRoot, stateEl } = await mount({ groups: [{ items: A, alt: A }, { items: A, alt: A }, { items: B, alt: A }] }, DUAL);
    await step(stateEl, (s) => { s.groups = [...s.groups].reverse(); });
    await step(stateEl, (s) => { s.groups = s.groups.map((g: any) => ({ ...g })); });
    expect(viewDual(shadowRoot)).toEqual(["b0,b1|a0,a1", "a0,a1|a0,a1", "a0,a1|a0,a1"]);
    await step(stateEl, (s) => { s["groups.2.items.0"] = { v: "M" }; });
    expect(stateDual(stateEl)).toEqual(["b0,b1|M,a1", "M,a1|M,a1", "M,a1|M,a1"]);
    expect(viewDual(shadowRoot)).toEqual(["b0,b1|M,a1", "M,a1|M,a1", "M,a1|M,a1"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("片方のキーを逆順の写しに替えて作り直した後、もう 1 つの外側の行を通した葉の書き込みが描いた要素に着地すること", async () => {
    // 6 つ目の修理: 作り直しの後、外側の行 1 の `alt` が写しの並びを描き、L が A の別の要素に着地した。葉の書き込みは、同じ
    // 配列を描く別のキー（`items`）の `for` にも知らせる（main・v3.3.0 は `items` を描き直さなかった）
    const errors = spyErrors();
    const A = L("v0", "v1", "v2");
    const { shadowRoot, stateEl } = await mount({ groups: [0, 1].map(() => ({ items: A, alt: A })) }, DUAL);
    await step(stateEl, (s) => { s["groups.0.alt"] = [...s["groups.0.alt"]].reverse(); });
    await step(stateEl, (s) => { s.groups = s.groups.map((g: any) => ({ ...g })); });
    expect(viewDual(shadowRoot)).toEqual(["v0,v1,v2|v2,v1,v0", "v0,v1,v2|v0,v1,v2"]);
    await step(stateEl, (s) => { s["groups.1.alt.1.v"] = "L"; });
    expect(stateDual(stateEl)).toEqual(["v0,L,v2|v2,L,v0", "v0,L,v2|v0,L,v2"]);
    expect(viewDual(shadowRoot)).toEqual(["v0,L,v2|v2,L,v0", "v0,L,v2|v0,L,v2"]);
    expect(errors).not.toHaveBeenCalled();
  });
  it("2 つのキーに同じ配列を持つ外側の行を足し、別の外側の行がその配列を片方のキーで引き継いで写しに替えた後も、差し替えがその配列に着地すること", async () => {
    // 片方のキーを写しに替えた外側の行は、もう片方のキーではまだ配列を持つので手放したことにならない。それでも行集合の親が
    // その外側の行なら、写しに替えたキーで配列を持つ外側の行へ付け替え、残ったキーのアドレスは憶えた親を使う（6 つ目の修理の
    // 検証の f6/dual/43 — 6 つ目の修理までは R が外側の行 0 の写しに着地した）。差し替えた要素は、外側の行 0 と 2 の
    // `items` で空に描かれる（状態は正しい）。main・v3.3.0 は状態は正しいが、足した外側の行の `items` を描き損ねる（`v0,`）
    const errors = spyErrors();
    const A = L("v0");
    const B = L("v1", "v2");
    const { shadowRoot, stateEl } = await mount({ groups: [{ items: A, alt: B }, { items: A, alt: B }] }, DUAL);
    await step(stateEl, (s) => { s.groups = [...s.groups, { items: s["groups.0.alt"], alt: s["groups.0.alt"] }]; });
    expect(viewDual(shadowRoot)).toEqual(["v0|v1,v2", "v0|v1,v2", "v1,v2|v1,v2"]);
    await step(stateEl, (s) => {
      s["groups.0.items"] = s["groups.2.items"];
      s.groups = s.groups.map((g: any) => ({ ...g }));
    });
    await step(stateEl, (s) => { s["groups.0.alt"] = [...s["groups.0.alt"]]; });
    await step(stateEl, (s) => { s["groups.1.alt.1"] = { v: "R" }; });
    expect(stateDual(stateEl)).toEqual(["v1,R|v1,v2", "v0|v1,R", "v1,R|v1,R"]);
    expect(viewDual(shadowRoot)).toEqual(["v1,|v1,v2", "v0|v1,R", "v1,|v1,R"]);
    expect(errors).not.toHaveBeenCalled();
  });
  it.each([
    ["items を替えてから alt に書く", (s: any) => { const moved = s["groups.0.items"]; s["groups.0.items"] = L("B"); s["groups.0.alt"] = moved; }],
    ["alt に書いてから items を替える", (s: any) => { const moved = s["groups.0.items"]; s["groups.0.alt"] = moved; s["groups.0.items"] = L("B"); }],
  ])("1 つの更新で同じ外側の行の items から alt へ配列を移しても（%s）、移した先のキーが配列を描き、差し替えが着地すること", async (_name, move) => {
    // 手放したときに行集合を別の外側の行（items でだけ持つ）へ付け替えると、移した先のキー（alt）のアドレスがその外側の行の
    // alt（別の配列）を読んだ（6 つ目の修理の検証の y7 — 6 つ目の修理の途中の形は `B|y,`）。同じバッチで別のキーに書いたら
    // 付け替えを戻す・付け替えない。その後、外側の行 1 の items の for は行集合の親（外側の行 0）の items を読んで `B,b` を描く
    // （状態は正しい — 別の外側の行が別のキーに持つ形の制約。main は描き直さず `a,b` のまま）
    const errors = spyErrors();
    const A = L("a", "b");
    const { shadowRoot, stateEl } = await mount({ groups: [{ items: A, alt: L("x") }, { items: A, alt: L("y") }] }, DUAL);
    await step(stateEl, move);
    expect(viewDual(shadowRoot)).toEqual(["B|a,b", "a,b|y"]);
    await step(stateEl, (s) => { s["groups.0.alt.0"] = { v: "M" }; });
    expect(stateDual(stateEl)).toEqual(["B|M,b", "M,b|y"]);
    expect(viewDual(shadowRoot)).toEqual(["B|M,b", "B,b|y"]);
    expect(errors).not.toHaveBeenCalled();
  });
  it("同じ更新で葉に書き、もう片方のキーを写しに替えても、同じ配列を描く別のキーの for に葉の書き込みが描かれること", async () => {
    // 葉の書き込みの依存はパスごとなので、同じ配列を描く別のキー（外側の行 1 の `alt`）の `for` には届かない。描画の基準の
    // 逆引きで、その `for` の同じ行の同じ葉にも知らせる（6 つ目・7 つ目の修理の検証の y15 — それまでは外側の行 1 の `alt` が
    // `v1,v2,v3` のまま。main・v3.3.0 は描いた）
    const errors = spyErrors();
    const A = L("v1", "v2", "v3");
    const { shadowRoot, stateEl } = await mount({ groups: [{ items: A, alt: A }, { items: A, alt: A }] }, DUAL);
    await step(stateEl, (s) => {
      s["groups.0.items.1.v"] = "L";
      s["groups.0.alt"] = [...s["groups.0.alt"]];
    });
    expect(stateDual(stateEl)).toEqual(["v1,L,v3|v1,L,v3", "v1,L,v3|v1,L,v3"]);
    expect(viewDual(shadowRoot)).toEqual(["v1,L,v3|v1,L,v3", "v1,L,v3|v1,L,v3"]);
    expect(errors).not.toHaveBeenCalled();
  });
});
