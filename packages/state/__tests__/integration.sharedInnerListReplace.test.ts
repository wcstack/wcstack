/**
 * integration.sharedInnerListReplace.test.ts — 2 つの外側の行が同じ内側の配列を持つとき（`groups: [{ items: inner },
 * { items: inner }]` を `for: groups` > `for: .items` で描く）、内側の要素の差し替えが両方の外側の行に描かれる（#379）。
 *
 * 行の台帳は配列ごとに 1 組で、共有された内側の配列の行は、最初に展開した外側の行を親に持つ（#256）。どちらの
 * 外側の行の `for: .items` も同じ行を描く。
 *
 * 退行（#361 の修正で入った・v3.3.0 では両方描き直された）: 要素の差し替えは、入れ替えが揃ったときの通知
 * （src/proxy/methods/setByAddress.ts の notifySwappedList）だけが知らせるようになり、書いたパスの親（行の親の
 * 外側の行の `groups.*.items`）の描画と新しい行の書き込みしか積まなかった。修正前は書いた（外れる）行のアドレスへの
 * 通知が、両方の Content にある外れる行の束縛を読み直させていた。もう片方の外側の行の `for` は描き直されず、
 * 外れる行の Content が古い要素のまま残った。同じ退行は共有しないページにも出る: 外側の行を作り直すと
 * （`groups = groups.map((g) => ({ ...g }))`）内側の行は新しい外側の行へ付け替わる（#256）が、要素のアドレスが憶えて
 * いる親は退役した外側の行のままで、通知はどの `for` も居ないアドレスに積まれた。
 *
 * 修理: 描画の基準（lastListValue）の逆引き — state 要素ごとに、配列 → その配列を描いている `for` のアドレス
 * （list/lastListValueByAbsoluteStateAddress.ts）。入れ替えが揃ったら、書いたリストのアドレスのほか、同じ配列を描く
 * 全部の `for` に知らせて描き直させる。その `for` は、まだその配列を描くなら自分が描いた並び（入れ替えの前の写しへ
 * 移された #320 の記録）からの差分を取る（apply/applyChangeToFor.ts）。書き込みの間に他の行の値は読まない（行 getter を
 * 書き込みの途中で走らせない）し、費用は同じ配列を描く `for` の数に比例する（下の費用の番人）。着地は #361 のまま。
 *
 * この Issue の前の 2 つの修理はどちらも捨てた:
 *  - 外れる行のアドレスで読み直させる（v3.3.0 まで・最初の修理）は、外れる行が別の配列の台帳にも居ると壊れる —
 *    写しは元の配列の行を借りたまま持ち、差し替えで外した要素を別の外側の行へ移すと、その要素の子のリストの行は
 *    外れる行を親に持つ。外れる行のアドレスで読むと外れる位置の新しい要素がキャッシュに載り、書き込みが別の配列に
 *    着地した。
 *  - 書いた後に兄弟の外側の行の値を読んで探す（2 つ目の修理）は、書き込みの途中で行 getter を走らせて投げ、
 *    作り直した後の共有しない入れ子では外側の行の数の 2 乗で遅く、作り直した外側の行（付け替わった行の親）を見逃した。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getUpdater } from "../src/updater/updater";
import { flush, makeMount, read, write } from "./helpers/recursionTestUtils";
import { clientLoad, serverRender, settle } from "./helpers/ssrRoundTrip";

beforeAll(() => {
  bootstrapState();
});

const mount = makeMount("shared-inner-replace-host");

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
const GROUPS_WITH_BUTTON =
  `<template data-wcs="for: groups"><div class="g"><template data-wcs="for: .items">` +
  `<span>{{ .v }}</span><button data-wcs="onclick: upper">u</button></template></div></template>`;
const GROUPS_IF =
  `<template data-wcs="for: groups"><div class="g"><template data-wcs="if: .show">` +
  `<template data-wcs="for: .items"><span>{{ .v }}</span></template></template></div></template>`;
const GROUPS_TAGS =
  `<template data-wcs="for: groups"><div class="g"><template data-wcs="for: .items">` +
  `<span>{{ .v }}[<template data-wcs="for: .tags"><em>{{ .t }}</em></template>]</span></template></div></template>`;

/** 外側の行ごとに、内側の行の値を `,` で繋ぐ */
const view = (root: ShadowRoot): string[] =>
  Array.from(root.querySelectorAll("div.g")).map((group) =>
    Array.from(group.querySelectorAll("span")).map((span) => span.textContent).join(","));
/** 状態の値を、view と同じ形で */
const stateOf = (stateEl: State): string[] =>
  read(stateEl, (s) => s.groups.map((g: any) => g.items.map((x: any) => x.v).join(",")));
/** 3 段（`.tags`）の状態の値を、view と同じ形で */
const deepStateOf = (stateEl: State): string[] =>
  read(stateEl, (s) => s.groups.map((g: any) =>
    g.items.map((x: any) => `${x.v}[${x.tags.map((t: any) => t.t).join("")}]`).join(",")));

const sharedGroups = (...values: string[]) => {
  const inner = values.map((v) => ({ v }));
  return { groups: [{ items: inner }, { items: inner }] };
};
const item = (v: string, ...tags: string[]) => ({ v, tags: tags.map((t) => ({ t })) });

async function step(stateEl: State, fn: (s: any) => void): Promise<void> {
  write(stateEl, fn);
  await flush();
  await flush();
}

describe("同じ内側の配列を 2 つの外側の行が持つ形で、要素を差し替える（#379）", () => {
  it("Issue の手順: 行 0 を通して差し替えても、行 1 を通して差し替えても、両方の外側の行が描き直されること", async () => {
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount(sharedGroups("a", "b"), GROUPS);
    expect(view(shadowRoot)).toEqual(["a,b", "a,b"]);

    await step(stateEl, (s) => { s["groups.0.items.1"] = { v: "B" }; });
    // 旧: ["a,B", "a,b"]
    expect(view(shadowRoot)).toEqual(["a,B", "a,B"]);
    expect(read(stateEl, (s) => [s["groups.0.items.1.v"], s["groups.1.items.1.v"]])).toEqual(["B", "B"]);

    await step(stateEl, (s) => { s["groups.1.items.0"] = { v: "A" }; });
    // 旧: ["A,B", "a,b"]
    expect(view(shadowRoot)).toEqual(["A,B", "A,B"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("行 1 を通して最初に差し替えても、両方の外側の行が描き直されること", async () => {
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount(sharedGroups("a", "b"), GROUPS);

    await step(stateEl, (s) => { s["groups.1.items.1"] = { v: "B" }; });
    // 旧: ["a,B", "a,b"]（書いた行 1 ではなく行 0 が描き直された）
    expect(view(shadowRoot)).toEqual(["a,B", "a,B"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("行の中のボタンが自分の行の要素を差し替えても、両方の外側の行が描き直されること", async () => {
    const errors = spyErrors();
    const { shadowRoot } = await mount({
      ...sharedGroups("a", "b"),
      upper(this: any) { this["groups.*.items.*"] = { v: this["groups.*.items.*.v"].toUpperCase() }; },
    }, GROUPS_WITH_BUTTON);
    const button = (group: number, row: number) =>
      shadowRoot.querySelectorAll("div.g")[group].querySelectorAll("button")[row] as HTMLButtonElement;

    button(0, 1).click();
    await flush();
    await flush();
    // 旧: ["a,B", "a,b"]
    expect(view(shadowRoot)).toEqual(["a,B", "a,B"]);

    button(1, 0).click();
    await flush();
    await flush();
    expect(view(shadowRoot)).toEqual(["A,B", "A,B"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("揃わない書き込み（別の行と同じ要素）の後に新しい要素を書いて揃っても、両方の外側の行が描き直されること", async () => {
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount(sharedGroups("a", "b", "c"), GROUPS);

    await step(stateEl, (s) => { s["groups.0.items.0"] = s["groups.0.items.2"]; });
    expect(view(shadowRoot)).toEqual(["c,b,c", "c,b,c"]);

    await step(stateEl, (s) => { s["groups.0.items.0"] = { v: "N" }; });
    // 旧: ["N,b,c", "c,b,c"]
    expect(view(shadowRoot)).toEqual(["N,b,c", "N,b,c"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("差し替えた位置への葉の書き込みと、同じ位置の差し替えのやり直しも、両方の外側の行に描かれること", async () => {
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount(sharedGroups("a", "b"), GROUPS);

    await step(stateEl, (s) => { s["groups.0.items.1"] = { v: "B" }; });
    await step(stateEl, (s) => { s["groups.0.items.1.v"] = "Q"; });
    // v3.3.0: ["a,Q", "a,B"]（もう片方の外側の行は、外れた行の Content を描いたまま）
    expect(view(shadowRoot)).toEqual(["a,Q", "a,Q"]);

    await step(stateEl, (s) => { s["groups.1.items.1"] = { v: "C" }; });
    // v3.3.0: ["a,C", "a,B"]
    expect(view(shadowRoot)).toEqual(["a,C", "a,C"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("入れ替え（1 つのバッチ・2 つのバッチ）で、両方の外側の行が並べ替わること", async () => {
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount(sharedGroups("a", "b", "c"), GROUPS);

    await step(stateEl, (s) => {
      const first = s["groups.0.items.0"];
      s["groups.0.items.0"] = s["groups.0.items.2"];
      s["groups.0.items.2"] = first;
    });
    // v3.3.0: ["c,b,a", "a,b,c"]
    expect(view(shadowRoot)).toEqual(["c,b,a", "c,b,a"]);

    let held: unknown;
    await step(stateEl, (s) => { held = s["groups.1.items.0"]; s["groups.1.items.0"] = s["groups.1.items.1"]; });
    await step(stateEl, (s) => { s["groups.1.items.1"] = held; });
    expect(view(shadowRoot)).toEqual(["b,c,a", "b,c,a"]);
    await step(stateEl, (s) => { s["groups.0.items.0.v"] = "X"; });
    expect(view(shadowRoot)).toEqual(["X,c,a", "X,c,a"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("3 段で子のリストを共有する形（同じ外側の行の兄弟・別の外側の行のいとこ）でも、共有した全部の行に描かれること", async () => {
    const errors = spyErrors();
    const tags = () => [{ t: "x" }, { t: "y" }];
    const siblingTags = tags();
    const cousinTags = tags();
    const { shadowRoot, stateEl } = await mount({
      groups: [
        { items: [{ v: "a", tags: siblingTags }, { v: "b", tags: siblingTags }, { v: "c", tags: cousinTags }] },
        { items: [{ v: "d", tags: cousinTags }] },
      ],
    }, GROUPS_TAGS);

    await step(stateEl, (s) => { s["groups.0.items.1.tags.0"] = { t: "X" }; });
    // 旧: ["a[Xy],b[xy],c[xy]", "d[xy]"]
    expect(view(shadowRoot)).toEqual(["a[Xy],b[Xy],c[xy]", "d[xy]"]);
    await step(stateEl, (s) => { s["groups.0.items.0.tags.0.t"] = "W"; });
    // v3.3.0: ["a[Wy],b[Xy],c[xy]", "d[xy]"]（差し替えは外れる行の束縛が読み直したが、その後の葉は届かない）
    expect(view(shadowRoot)).toEqual(["a[Wy],b[Wy],c[xy]", "d[xy]"]);
    // 別の外側の行の下の行（いとこ）を通して書く
    await step(stateEl, (s) => { s["groups.1.items.0.tags.1"] = { t: "Y" }; });
    expect(view(shadowRoot)).toEqual(["a[Wy],b[Wy],c[xY]", "d[xY]"]);
    await step(stateEl, (s) => { s["groups.0.items.2.tags.1.t"] = "Q"; });
    expect(view(shadowRoot)).toEqual(["a[Wy],b[Wy],c[xQ]", "d[xQ]"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("if で隠れていた外側の行も、戻したときに差し替えた後の並びを描くこと", async () => {
    const errors = spyErrors();
    const inner = [{ v: "a" }, { v: "b" }];
    const { shadowRoot, stateEl } = await mount({ groups: [{ show: true, items: inner }, { show: true, items: inner }] }, GROUPS_IF);

    await step(stateEl, (s) => { s["groups.1.show"] = false; });
    await step(stateEl, (s) => { s["groups.0.items.1"] = { v: "B" }; });
    await step(stateEl, (s) => { s["groups.1.show"] = true; });
    // v3.3.0・旧: ["a,B", "a"]（戻した外側の行が差し替えた行を描かない）
    expect(view(shadowRoot)).toEqual(["a,B", "a,B"]);
    await step(stateEl, (s) => { s["groups.1.items.1.v"] = "Q"; });
    expect(view(shadowRoot)).toEqual(["a,Q", "a,Q"]);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("共有していた配列を写しに替えた後の差し替え（写しは元の配列の行を借りている）", () => {
  // 写しの台帳は元の配列の行を借りたまま持ち、その行の親は外側の行 0。差し替えでその行が外れる行になる。
  // 外れる行のアドレスで読み直すと、外側の行 0 の同じ位置の新しい要素が読め、写し側への書き込みがそこに着地した
  it("写して足した後に元の配列の要素を差し替え、写し側の葉に書く（push した写し）", async () => {
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount(sharedGroups("a", "b", "c"), GROUPS);

    await step(stateEl, (s) => { s["groups.1.items"] = [...s["groups.1.items"], { v: "d" }]; });
    await step(stateEl, (s) => { s["groups.0.items.0"] = { v: "N" }; });
    // 最初の修理: ["N,b,c", "N,b,c,d"]
    expect(view(shadowRoot)).toEqual(["N,b,c", "a,b,c,d"]);

    await step(stateEl, (s) => { s["groups.1.items.0.v"] = "Z"; });
    // 最初の修理: 状態 ["Z,b,c", "a,b,c,d"]（外側の行 1 への書き込みが外側の行 0 の要素に着地した）
    expect(stateOf(stateEl)).toEqual(["N,b,c", "Z,b,c,d"]);
    expect(view(shadowRoot)).toEqual(["N,b,c", "Z,b,c,d"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("そのままの写しに替えた後に元の配列の要素を差し替え、写し側の葉に書く", async () => {
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount(sharedGroups("a", "b", "c"), GROUPS);

    await step(stateEl, (s) => { s["groups.1.items"] = [...s["groups.1.items"]]; });
    await step(stateEl, (s) => { s["groups.0.items.2"] = { v: "N" }; });
    expect(view(shadowRoot)).toEqual(["a,b,N", "a,b,c"]);

    await step(stateEl, (s) => { s["groups.1.items.2.v"] = "Z"; });
    expect(stateOf(stateEl)).toEqual(["a,b,N", "a,b,Z"]);
    expect(view(shadowRoot)).toEqual(["a,b,N", "a,b,Z"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("slice で外側の行 0 を写し、その写しの要素を差し替える", async () => {
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount(sharedGroups("a", "b", "c"), GROUPS);

    await step(stateEl, (s) => { s["groups.0.items"] = s["groups.0.items"].slice(0, 2); });
    await step(stateEl, (s) => { s["groups.0.items.0"] = { v: "N" }; });
    // 最初の修理: ["N,b", "N,b,c"]（外側の行 1 が写しの新しい要素を描いた）
    expect(stateOf(stateEl)).toEqual(["N,b", "a,b,c"]);
    expect(view(shadowRoot)).toEqual(["N,b", "a,b,c"]);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("共有しない 3 段の入れ子で、差し替えで外した要素を別の外側の行へ移す", () => {
  // 移した要素の子のリスト（`.tags`）の行は、外れる行を親に持つ。外れる行のアドレスで読み直すと、外れる位置の
  // 新しい要素の `.tags` が読め、移した先の外側の行が新しい要素の子を描いた
  const board = () => ({ groups: [{ items: [item("a", "a1"), item("b", "b1", "b2")] }, { items: [item("c", "c1")] }] });

  it("同じバッチで差し替えて、外した要素を別の外側の行に置く", async () => {
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount(board(), GROUPS_TAGS);

    await step(stateEl, (s) => {
      const moved = s["groups.0.items.1"];
      s["groups.0.items.1"] = item("N", "n1");
      s["groups.1.items.0"] = moved;
    });
    // 最初の修理: ["a[a1],N[n1]", "b[n1]"]
    expect(view(shadowRoot)).toEqual(["a[a1],N[n1]", "b[b1b2]"]);
    expect(deepStateOf(stateEl)).toEqual(["a[a1],N[n1]", "b[b1b2]"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("差し替えと、外した要素を置く書き込みを 2 つのバッチに分ける", async () => {
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount(board(), GROUPS_TAGS);
    let moved: unknown;

    await step(stateEl, (s) => { moved = s["groups.0.items.1"]; s["groups.0.items.1"] = item("N", "n1"); });
    await step(stateEl, (s) => { s["groups.1.items.0"] = moved; });
    expect(view(shadowRoot)).toEqual(["a[a1],N[n1]", "b[b1b2]"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("外した要素を別の外側の行の配列に足してから差し替える（同じバッチ）", async () => {
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount(board(), GROUPS_TAGS);

    await step(stateEl, (s) => {
      const moved = s["groups.0.items.1"];
      s["groups.1.items"] = [...s["groups.1.items"], moved];
      s["groups.0.items.1"] = item("N", "n1");
    });
    expect(view(shadowRoot)).toEqual(["a[a1],N[n1]", "c[c1],b[b1b2]"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("差し替えた次のバッチで外した要素を足し、その子の葉に書く", async () => {
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount(board(), GROUPS_TAGS);
    let moved: unknown;

    await step(stateEl, (s) => { moved = s["groups.0.items.1"]; s["groups.0.items.1"] = item("N", "n1"); });
    await step(stateEl, (s) => { s["groups.1.items"] = [...s["groups.1.items"], moved]; });
    // 最初の修理: ["a[a1],N[n1]", "c[c1],b[n1]"]
    expect(view(shadowRoot)).toEqual(["a[a1],N[n1]", "c[c1],b[b1b2]"]);

    await step(stateEl, (s) => { s["groups.1.items.1.tags.0.t"] = "Z"; });
    // 最初の修理: 状態は ["a[a1],N[Z]", "c[c1],b[b1b2]"]（新しい要素 N の子に着地した）。描画はこの手の後も
    // 古いまま（["…", "c[c1],b[b1b2]"] — main・v3.3.0 と同じ別件）なので、状態だけを見る
    expect(deepStateOf(stateEl)).toEqual(["a[a1],N[n1]", "c[c1],b[Zb2]"]);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("外側の行を作り直した後の差し替え（共有しない — 内側の行は新しい外側の行へ付け替わる・#256）", () => {
  // 要素のアドレスが憶えている親は退役した外側の行のまま。書いたリストのアドレスにはどの `for` も居ないので、
  // 描き直すのは同じ配列を描いている `for`（新しい外側の行の `for`）を逆引きしたもの
  const plain = () => ({ groups: [{ items: [{ v: "a" }, { v: "b" }, { v: "c" }] }, { items: [{ v: "d" }, { v: "e" }, { v: "f" }] }] });

  it("外側の行を写し直した後、同じ行の位置を順に差し替えても描き直されること", async () => {
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount(plain(), GROUPS);

    await step(stateEl, (s) => { s.groups = s.groups.map((g: any) => ({ ...g })); });
    await step(stateEl, (s) => { s["groups.0.items.1"] = { v: "N" }; });
    // 旧: ["a,b,c", "d,e,f"]
    expect(view(shadowRoot)).toEqual(["a,N,c", "d,e,f"]);
    await step(stateEl, (s) => { s["groups.0.items.0"] = { v: "M" }; });
    // 旧: ["a,b,c", "d,e,f"]。2 つ目の修理: ["a,N,c", "d,e,f"]（1 つ前の手の描画で最初の行が付け替わり、印が付かなかった）
    expect(view(shadowRoot)).toEqual(["M,N,c", "d,e,f"]);
    await step(stateEl, (s) => { s["groups.1.items.2"] = { v: "P" }; });
    expect(view(shadowRoot)).toEqual(["M,N,c", "d,e,P"]);
    expect(stateOf(stateEl)).toEqual(["M,N,c", "d,e,P"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("作り直して逆順にした後・外側の行を 1 つ消した後も描き直されること", async () => {
    const errors = spyErrors();
    const reversed = await mount(plain(), GROUPS);
    await step(reversed.stateEl, (s) => { s.groups = s.groups.map((g: any) => ({ ...g })).reverse(); });
    await step(reversed.stateEl, (s) => { s["groups.0.items.1"] = { v: "N" }; });
    await step(reversed.stateEl, (s) => { s["groups.0.items.0"] = { v: "M" }; });
    // 旧: ["d,e,f", "a,b,c"]
    expect(view(reversed.shadowRoot)).toEqual(["M,N,f", "a,b,c"]);

    const shared = await mount(sharedGroups("a", "b"), GROUPS);
    await step(shared.stateEl, (s) => { s.groups = s.groups.filter((_: unknown, k: number) => k !== 0); });
    await step(shared.stateEl, (s) => { s["groups.0.items.1"] = { v: "N" }; });
    await step(shared.stateEl, (s) => { s["groups.0.items.0"] = { v: "M" }; });
    // 旧: ["a,b"]（残った外側の行の for は、消した外側の行の下の行を描いていた）
    expect(view(shared.shadowRoot)).toEqual(["M,N"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("3 段: 内側の行を写し直した後、その下のリストの要素を差し替えても描き直されること", async () => {
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount({ groups: [{ items: [item("a", "x", "y"), item("b", "z")] }] }, GROUPS_TAGS);

    await step(stateEl, (s) => { s["groups.0.items"] = s["groups.0.items"].map((i: any) => ({ ...i })); });
    await step(stateEl, (s) => { s["groups.0.items.0.tags.1"] = { t: "Q" }; });
    await step(stateEl, (s) => { s["groups.0.items.0.tags.0"] = { t: "R" }; });
    // 旧: ["a[xy],b[z]"]。2 つ目の修理: ["a[xQ],b[z]"]
    expect(view(shadowRoot)).toEqual(["a[RQ],b[z]"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("SSR のハイドレーションの後に外側の行を作り直しても、差し替えが描き直されること", async () => {
    const errors = spyErrors();
    const markup = `<wcs-state enable-ssr></wcs-state>` + GROUPS;
    const html = await serverRender(markup, plain);
    const stateEl = await clientLoad(html, plain);
    const drawn = () => Array.from(document.querySelectorAll("div.g")).map((group) =>
      Array.from(group.querySelectorAll("span")).map((span) => span.textContent).join(","));
    try {
      write(stateEl, (s) => { s.groups = s.groups.map((g: any) => ({ ...g })); });
      await settle();
      write(stateEl, (s) => { s["groups.0.items.1"] = { v: "N" }; });
      await settle();
      write(stateEl, (s) => { s["groups.0.items.0"] = { v: "M" }; });
      await settle();
      // 旧: ["a,b,c", "d,e,f"]。2 つ目の修理: ["a,N,c", "d,e,f"]
      expect(drawn()).toEqual(["M,N,c", "d,e,f"]);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      document.body.innerHTML = "";
    }
  });
});

describe("同じバッチで、共有していた外側の行の配列を替える", () => {
  it("別の配列に替えて差し替え、元の配列へ戻すと、戻した外側の行も差し替えを描くこと", async () => {
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount(sharedGroups("a", "b", "c"), GROUPS);

    await step(stateEl, (s) => {
      const inner = s["groups.0.items"];
      s["groups.1.items"] = [{ v: "y" }];
      s["groups.0.items.1"] = { v: "N" };
      s["groups.1.items"] = inner;
    });
    // 旧: ["a,N,c", "a,b,c"]（書いた時点で外側の行 1 は別の配列を持っていた）
    expect(view(shadowRoot)).toEqual(["a,N,c", "a,N,c"]);
    await step(stateEl, (s) => { s["groups.0.items.2"] = { v: "P" }; });
    expect(view(shadowRoot)).toEqual(["a,N,P", "a,N,P"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("別の配列に替えたまま差し替えても、替えた外側の行はその配列を描くこと", async () => {
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount(sharedGroups("a", "b", "c"), GROUPS);

    await step(stateEl, (s) => { s["groups.1.items"] = [{ v: "y" }]; s["groups.0.items.1"] = { v: "N" }; });
    // 写しの並びからの差分で描くと、新しい配列の行が写しの行集合の持ち主（外側の行 0）へ付け替わり、"a" を描いた
    expect(view(shadowRoot)).toEqual(["a,N,c", "y"]);
    await step(stateEl, (s) => { s["groups.1.items"] = s["groups.0.items"]; });
    await step(stateEl, (s) => { s["groups.1.items.0"] = { v: "Q" }; });
    // 旧: ["Q,N,c", "a,N,c"]
    expect(view(shadowRoot)).toEqual(["Q,N,c", "Q,N,c"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("差し替えた後、同じバッチで同じ中身の写しに替えても描き直されること", async () => {
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount(sharedGroups("a", "b", "c"), GROUPS);

    await step(stateEl, (s) => { s["groups.1.items.1"] = { v: "N" }; s["groups.1.items"] = [...s["groups.1.items"]]; });
    // 旧: ["a,N,c", "a,b,c"]
    expect(view(shadowRoot)).toEqual(["a,N,c", "a,N,c"]);
    await step(stateEl, (s) => { s["groups.0.items.2"] = { v: "P" }; });
    // 写しは元の配列の行を借りたまま持つ（その行の親は外側の行 0）。写し側を通した書き込みは元の配列に着地する —
    // main・v3.3.0 と同じ別件なので、ここでは元の配列への書き込みだけを見る
    expect(stateOf(stateEl)).toEqual(["a,N,P", "a,N,c"]);
    expect(view(shadowRoot)).toEqual(["a,N,P", "a,N,c"]);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("外側の行を作り直した後、共有していた配列の要素を差し替え、写しに替えて書く（書き込みが別の配列に着地しない）", () => {
  // 作り直すと共有した配列の行の親は退役した外側の行のまま残り、要素書き込みの入れ替えで入る新しい行も、要素のアドレスが
  // 憶えている退役した外側の行の下にできる。行は次にその配列の差分を取った外側の行（写しなら写しの外側の行）へ付け替わる
  // （#256）。3 つ目の修理は、知らせた別の外側の行の for の描き直しが新しい行を読み、行のアドレスに退役した親を憶えさせた。
  // その後に写しに替えて書くと、書き込みが元の配列（もう片方の外側の行）に着地した
  const rebuild = (s: any) => { s.groups = s.groups.map((g: any) => ({ ...g })); };
  const cases: [string, ((s: any) => void)[], string[]][] = [
    ["外側の行 1 を通して差し替え、外側の行 1 を写しに替えて書く", [
      rebuild,
      (s) => { s["groups.1.items.0"] = { v: "v30" }; },
      (s) => { s["groups.1.items"] = [...s["groups.1.items"], { v: "v34" }]; s["groups.1.items.0"] = { v: "v36" }; },
    ], ["v30,v1", "v36,v1,v34"]],
    ["外側の行 1 を通して差し替え、外側の行 0 を写しに替えて書く", [
      rebuild,
      (s) => { s["groups.1.items.0"] = { v: "v30" }; },
      (s) => { s["groups.0.items"] = [...s["groups.0.items"], { v: "v34" }]; s["groups.0.items.0"] = { v: "v36" }; },
    ], ["v36,v1,v34", "v30,v1"]],
    ["同じ配列を持つ外側の行を足してから差し替え、写しに替えて書く（2 つのバッチに分ける）", [
      rebuild,
      (s) => { s.groups = [...s.groups, { items: s["groups.1.items"] }]; },
      (s) => { s["groups.2.items.0"] = { v: "v30" }; },
      (s) => { s["groups.2.items"] = [...s["groups.2.items"], { v: "v34" }]; },
      (s) => { s["groups.2.items.0"] = { v: "v36" }; },
    ], ["v30,v1", "v30,v1", "v36,v1,v34"]],
    ["先頭に足した写しに替えて書く", [
      rebuild,
      (s) => { s["groups.1.items.0"] = { v: "v30" }; },
      (s) => { s["groups.1.items"] = [{ v: "n" }, ...s["groups.1.items"]]; s["groups.1.items.1"] = { v: "v36" }; },
    ], ["v30,v1", "n,v36,v1"]],
  ];

  it.each(cases)("%s", async (_label, steps, expected) => {
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount(sharedGroups("v0", "v1"), GROUPS);
    for (const fn of steps) {
      await step(stateEl, fn);
    }
    // 3 つ目の修理: 1 つ目は ["v36,v1", "v30,v1,v34"]（外側の行 1 の写しへの書き込みが外側の行 0 の配列に着地した）
    expect(stateOf(stateEl)).toEqual(expected);
    expect(view(shadowRoot)).toEqual(expected);
    expect(errors).not.toHaveBeenCalled();
  });

  it("if の中でも、写しに替えて書いた値が写しに着地すること", async () => {
    const errors = spyErrors();
    const inner = [{ v: "v0" }, { v: "v1" }];
    const { shadowRoot, stateEl } = await mount({ groups: [{ show: true, items: inner }, { show: true, items: inner }] }, GROUPS_IF);
    await step(stateEl, rebuild);
    await step(stateEl, (s) => { s["groups.1.items.0"] = { v: "v30" }; });
    await step(stateEl, (s) => { s["groups.1.items"] = [...s["groups.1.items"], { v: "v34" }]; s["groups.1.items.0"] = { v: "v36" }; });
    expect(stateOf(stateEl)).toEqual(["v30,v1", "v36,v1,v34"]);
    expect(view(shadowRoot)).toEqual(["v30,v1", "v36,v1,v34"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("filter の写しに替えて書いても、書き込みは写しに着地すること", async () => {
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount(sharedGroups("v0", "v1"), GROUPS);
    await step(stateEl, rebuild);
    await step(stateEl, (s) => { s["groups.1.items.0"] = { v: "v30" }; });
    await step(stateEl, (s) => { s["groups.1.items"] = s["groups.1.items"].filter(() => true); s["groups.1.items.0"] = { v: "v36" }; });
    // 共有された配列の写しは行を借りない（#393）。借りていた間は、行の親が写しの外側の行へ付け替わり、借りた行を描く
    // 外側の行 0 の Content が写しの値を読んで v36 を描いた
    expect(stateOf(stateEl)).toEqual(["v30,v1", "v36,v1"]);
    expect(view(shadowRoot)).toEqual(["v30,v1", "v36,v1"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("外側の行の入れ替えと同じバッチで差し替え、別の外側の行を写しに替えてから、また差し替える", async () => {
    // 入れ替えた外側の行の for は、同じバッチで書き込みとしても積まれる。この Issue の 4 つ目の修理の途中の形（知らされた
    // for の描き直しの間だけ行のアドレスに親を憶えさせない）では、行の親が次のバッチで写しに替えた外側の行へ付け替わって
    // から憶えられ、次の差し替えが写しに着地した。いまは行のアドレスが行のいまの親を引く（#394）
    const errors = spyErrors();
    const inner = [{ v: "v0" }, { v: "v1" }, { v: "v2" }];
    const { shadowRoot, stateEl } = await mount({ groups: [0, 1, 2, 3].map(() => ({ show: true, items: inner })) }, GROUPS_IF);
    await step(stateEl, (s) => { s.groups = [...s.groups, { show: true, items: s["groups.0.items"] }]; });
    await step(stateEl, (s) => { s.groups = s.groups.map((g: any) => ({ ...g })).reverse(); });
    await step(stateEl, (s) => {
      const moved = s["groups.2"];
      s["groups.2"] = s["groups.4"];
      s["groups.4"] = moved;
      s["groups.1.items.0"] = { v: "v31" };
    });
    await step(stateEl, (s) => { s["groups.2.items"] = [...s["groups.2.items"]]; });
    await step(stateEl, (s) => { s["groups.1.items.0"] = { v: "v47" }; });
    // その途中の形では状態も描画も ["v31,v1,v2", "v31,v1,v2", "v47,v1,v2", "v31,v1,v2", "v31,v1,v2"]（外側の行 1 を通した書き込みが
    // 外側の行 2 の写しに着地した）
    expect(stateOf(stateEl)).toEqual(["v47,v1,v2", "v47,v1,v2", "v31,v1,v2", "v47,v1,v2", "v47,v1,v2"]);
    expect(view(shadowRoot)).toEqual(["v47,v1,v2", "v47,v1,v2", "v31,v1,v2", "v47,v1,v2", "v47,v1,v2"]);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("書き込みの途中で他の行を読まない・別の state の for を描き直させない", () => {
  it("行 getter が描かれない行で投げる形でも、書き込みが投げず getter を呼ばないこと", async () => {
    const errors = spyErrors();
    const inner = [{ v: "a" }, { v: "b" }];
    const initial: any = { groups: [{ data: { items: inner } }, { data: null }, { data: { items: inner } }] };
    let getterCalls = 0;
    Object.defineProperty(initial, "groups.*.items", {
      get(this: any) { getterCalls++; return this["groups.*.data"].items; },
      enumerable: true, configurable: true,
    });
    const { shadowRoot, stateEl } = await mount(initial,
      `<template data-wcs="for: groups"><div class="g"><template data-wcs="if: .data">` +
      `<template data-wcs="for: .items"><span>{{ .v }}</span></template></template></div></template>`);

    getterCalls = 0;
    // 2 つ目の修理は兄弟の外側の行の getter を読み、`data: null` の行で TypeError を投げた
    expect(() => write(stateEl, (s) => { s["groups.0.items.1"] = { v: "N" }; })).not.toThrow();
    expect(getterCalls).toBe(0);
    await flush();
    await flush();
    expect(view(shadowRoot)).toEqual(["a,N", "", "a,N"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("2 つの <wcs-state> が同じ素の配列を持っても、書いた state の for だけを描き直し、エラーを出さないこと", async () => {
    const errors = spyErrors();
    const inner = [{ v: "a" }, { v: "b" }, { v: "c" }];
    const first = await mount({ groups: [{ items: inner }, { items: inner }] }, GROUPS);
    const second = await mount({ groups: [{ items: inner }, { items: inner }] }, GROUPS);

    await step(second.stateEl, (s) => { s["groups.0.items.0"] = { v: "N" }; });
    // 旧: ["a,b,c", "a,b,c"]
    expect(view(second.shadowRoot)).toEqual(["N,b,c", "N,b,c"]);
    await step(first.stateEl, (s) => { s["groups.0.items.1"] = { v: "M" }; });
    await step(first.stateEl, (s) => { s["groups.1.items.2"] = { v: "P" }; });
    expect(view(first.shadowRoot)).toEqual(["N,M,P", "N,M,P"]);
    // 2 つ目の修理: ["N,M,P", "a,b,c"] と Content not found（印が state をまたいでいた）
    expect(errors).not.toHaveBeenCalled();
  });

  it("同じ配列を別のパス（`other.*.items`）の for も描いていれば、そちらも描き直されること", async () => {
    const errors = spyErrors();
    const inner = [{ v: "a" }, { v: "b" }, { v: "c" }];
    const { shadowRoot, stateEl } = await mount({ groups: [{ items: inner }, { items: inner }], other: [{ items: inner }] },
      GROUPS + `<template data-wcs="for: other"><div class="g"><template data-wcs="for: .items"><span>{{ .v }}</span></template></div></template>`);

    await step(stateEl, (s) => { s["other.0.items.0"] = { v: "N" }; });
    await step(stateEl, (s) => { s["groups.0.items.1"] = { v: "M" }; });
    // 旧: ["N,M,c", "a,b,c", "a,b,c"]（書いた外側の行の for のほかは描き直されなかった）
    expect(view(shadowRoot)).toEqual(["N,M,c", "N,M,c", "N,M,c"]);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("費用の番人（描き直しの数は、同じ配列を描く for の数に比例する）", () => {
  /** 書き込みのあいだに積まれた描画だけのやり直しを数える */
  function countRenderOnly(run: () => void): number {
    const renderOnly = vi.spyOn(getUpdater(), "enqueueRenderOnlyAddress");
    try {
      run();
      return renderOnly.mock.calls.length;
    } finally {
      renderOnly.mockRestore();
    }
  }

  it("外側の行の無いリストで 200 行を差し替えても、描画だけのやり直しはリストのアドレスの 1 回ずつ", async () => {
    const N = 200;
    const { shadowRoot, stateEl } = await mount(
      { items: Array.from({ length: N }, (_, i) => ({ v: i, w: i })) },
      `<ul><template data-wcs="for: items"><li><b>{{ .v }}</b><i>{{ .w }}</i></li></template></ul>`,
    );
    expect(countRenderOnly(() => write(stateEl, (s) => { for (let i = 0; i < N; i++) s["items." + i] = { v: -i, w: -i }; }))).toBe(N);
    await flush();
    expect(Array.from(shadowRoot.querySelectorAll("li > b")).slice(0, 3).map((b) => b.textContent)).toEqual(["0", "-1", "-2"]);
  });

  it("外側の行を作り直した後、共有しない 60 行の位置 0 を 1 バッチで差し替えても、描き直しは書き込み 1 回に 1 回", async () => {
    const G = 60;
    const { shadowRoot, stateEl } = await mount({
      groups: Array.from({ length: G }, (_, g) => ({ items: [{ v: `a${g}` }, { v: `b${g}` }, { v: `c${g}` }] })),
    }, GROUPS);
    await step(stateEl, (s) => { s.groups = s.groups.map((g: any) => ({ ...g })); });

    // 書き込み 1 回に 1 回: 書いたリストのアドレス（新しい外側の行 — 要素のアドレスは行のいまの親を引く・#393 / #394）。
    // それまでは、要素のアドレスが憶えた退役した外側の行のアドレス（そこには for が居ない）と、同じ配列を描く新しい外側の
    // 行の for の 2 回だった。2 つ目の修理は、これに加えて書き込みごとに外側の行を全部読んだ（G × G）
    expect(countRenderOnly(() => write(stateEl, (s) => {
      for (let g = 0; g < G; g++) s[`groups.${g}.items.0`] = { v: `N${g}` };
    }))).toBe(G);
    await flush();
    const drawn = view(shadowRoot);
    expect([drawn[0], drawn[G - 1]]).toEqual(["N0,b0,c0", `N${G - 1},b${G - 1},c${G - 1}`]);
  });

  it("2 行ずつ同じ配列を持つ 60 行で各組の位置 0 を差し替えると、描き直しは組ごとに自分の for と相方の for", async () => {
    const G = 60;
    const { shadowRoot, stateEl } = await mount({
      groups: Array.from({ length: G / 2 }, (_, k) => {
        const inner = [{ v: `a${k}` }, { v: `b${k}` }, { v: `c${k}` }];
        return [{ items: inner }, { items: inner }];
      }).flat(),
    }, GROUPS);

    expect(countRenderOnly(() => write(stateEl, (s) => {
      for (let k = 0; k < G / 2; k++) s[`groups.${2 * k}.items.0`] = { v: `N${k}` };
    }))).toBe(G);
    await flush();
    const drawn = view(shadowRoot);
    expect([drawn[0], drawn[1], drawn[G - 1]]).toEqual(["N0,b0,c0", "N0,b0,c0", `N${G / 2 - 1},b${G / 2 - 1},c${G / 2 - 1}`]);
  });

  it("10 行が同じ配列を持つとき、同じバッチの 20 回の差し替えで相方の for に知らせるのは 1 回ずつ", async () => {
    const G = 10, N = 20;
    const inner = Array.from({ length: N }, (_, i) => ({ v: `${i}` }));
    const { shadowRoot, stateEl } = await mount({ groups: Array.from({ length: G }, () => ({ items: inner })) }, GROUPS);

    // 書き込みごとの自分の for（20）＋ 相方の for（9 — 知らせた for には同じバッチで知らせ直さない）
    expect(countRenderOnly(() => write(stateEl, (s) => {
      for (let i = 0; i < N; i++) s[`groups.0.items.${i}`] = { v: `x${i}` };
    }))).toBe(N + G - 1);
    await flush();
    await flush();
    const drawn = view(shadowRoot);
    expect(new Set(drawn).size).toBe(1);
    expect(drawn[0].split(",").slice(0, 2)).toEqual(["x0", "x1"]);
  });
});

describe("着地は書いた位置の行のまま（#361 の番人）", () => {
  it("差し替えの $watch(\"groups.*.items.*\") は、書いた位置で 1 回呼ばれること", async () => {
    const watched: [string, number, number][] = [];
    const { stateEl } = await mount({
      ...sharedGroups("a", "b"),
      $watch: {
        "groups.*.items.*"(current: any, _previous: unknown, group: number, row: number) { watched.push([current.v, group, row]); },
      },
    }, GROUPS);

    await step(stateEl, (s) => { s["groups.0.items.1"] = { v: "B" }; });
    expect(watched).toEqual([["B", 0, 1]]);
  });

  it("2 つのバッチに分けた入れ替えの $watch(\"groups.*.items.*\") は、揃ったバッチで書いた位置で呼ばれること", async () => {
    const watched: [string, number, number][] = [];
    const { stateEl } = await mount({
      ...sharedGroups("a", "b", "c"),
      $watch: {
        "groups.*.items.*"(current: any, _previous: unknown, group: number, row: number) { watched.push([current.v, group, row]); },
      },
    }, GROUPS);
    let first: unknown;

    await step(stateEl, (s) => { first = s["groups.0.items.0"]; s["groups.0.items.0"] = s["groups.0.items.2"]; });
    expect(watched).toEqual([["c", 0, 0]]);
    watched.length = 0;

    await step(stateEl, (s) => { s["groups.0.items.2"] = first; });
    // #361 の前（v3.3.0）は、前のバッチで書いた位置（0 の c）で呼ばれた
    expect(watched).toEqual([["a", 0, 2]]);
  });
});

describe("行 getter を通して 2 つの外側の行が描く配列（制約のまま）", () => {
  it("要素を差し替えると、どの外側の行を通して書いても、配列を最初に描いた外側の行だけが描き直されること", async () => {
    // 行 getter が返す配列の `for` は、書いた位置の行の親（配列を最初に描いた外側の行）のものだけが描き直される。
    // v3.3.0 はどちらの外側の行も描き直さなかった（["a,b,c", "a,b,c"]）
    const errors = spyErrors();
    const { shadowRoot, stateEl } = await mount({
      ...sharedGroups("a", "b", "c"),
      get "groups.*.shown"(this: any) { return this["groups.*.items"]; },
    }, `<template data-wcs="for: groups"><div class="g"><template data-wcs="for: .shown"><span>{{ .v }}</span></template></div></template>`);

    await step(stateEl, (s) => { s["groups.1.items.1"] = { v: "B" }; });
    expect(stateOf(stateEl)).toEqual(["a,B,c", "a,B,c"]);
    expect(view(shadowRoot)).toEqual(["a,B,c", "a,b,c"]);
    expect(errors).not.toHaveBeenCalled();
  });
});
