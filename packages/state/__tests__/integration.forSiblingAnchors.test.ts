/**
 * integration.forSiblingAnchors.test.ts — 行の中で `for:` の後ろに別の `for:` / `if:` が並ぶ形で、前の `for:` が
 * 描いた行を全部外すときに、後ろの兄弟のアンカーを消さないこと（#392）。
 *
 * `for:` は描いた行を全部外すとき、親の中身が自分だけなら親を空にする近道を取る（applyChangeToFor の
 * isOnlyNodeInParentContent）。「自分だけか」は、自分の最後の行の末尾（lastNodeByNode）から後ろの兄弟を
 * 数えて決める。ところが描いた行が祖先の unmount（`if:` の非表示・外側の行がプールに入る）で既に外れて
 * いると、その末尾は DOM に居ないので後ろの兄弟が無く、「自分だけ」と覚えて兄弟の `for:` / `if:` の
 * アンカーごと親を空にしていた。
 *  - プールから戻した外側の行: #320 の修理で、内側の `for:` は前の行の子の行を自分のプールへ戻すように
 *    なった（それまでは台帳に残したまま作り直していた）。その「全部外す」が近道に入り、先頭を消した後に
 *    足した行で 2 つ目の `for:` が描かれず、`Cannot get absolute state address for disconnected binding`
 *    が console.error に出た（#320 の修理が入れた未リリースの退行。v3.3.0 は描ける）。
 *  - `if:` で隠している間にリストを空にしてから戻す: v3.3.0 でも後ろの兄弟が消える（エラーは出ない）。
 *
 * 修理: 描いた行の末尾が親に居ないときは、アンカーから数える。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { flush, makeMount, write } from "./helpers/recursionTestUtils";

beforeAll(() => {
  bootstrapState();
});

const mount = makeMount("forsibling-host");

let errorSpy: ReturnType<typeof vi.spyOn> | null = null;
/** 退行の手がかりは console.error（`binding "for: rows" failed to apply`）だけなので、全テストで数える */
function spyErrors(): ReturnType<typeof vi.spyOn> {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  return errorSpy;
}
afterEach(() => {
  errorSpy?.mockRestore();
  errorSpy = null;
});

async function step(stateEl: any, fn: (s: any) => void): Promise<void> {
  write(stateEl, fn);
  await flush();
}

/** `parent` から外されたアンカー（コメント）の数を、`fn` の間だけ数える（親を空にする近道はアンカーも外す） */
async function countRemovedAnchors(parent: Node, fn: () => Promise<void>): Promise<number> {
  let count = 0;
  const tally = (records: MutationRecord[]): void => {
    for (const record of records) {
      count += Array.from(record.removedNodes).filter((node) => node.nodeType === Node.COMMENT_NODE).length;
    }
  };
  const observer = new MutationObserver(tally);
  observer.observe(parent, { childList: true });
  await fn();
  tally(observer.takeRecords());
  observer.disconnect();
  return count;
}

/** 行ごとの中身（`<i>` / `<u>` / `<s>` の文字を並べる）: `91+95` の形 */
const view = (root: ParentNode, selector: string): string[] => Array.from(root.querySelectorAll(selector))
  .map((row) => Array.from(row.children).map((child) => child.textContent).join("+"));

const mk = (n: number) => ({ n, it: [{ v: n * 10 + 1 }], it2: [{ v: n * 10 + 5 }] });
const TWO_FORS =
  `<template data-wcs="for: rows"><div class="r"><template data-wcs="for: .it"><i>{{ .v }}</i></template>` +
  `<template data-wcs="for: .it2"><u>{{ .v }}</u></template></div></template>`;

describe("プールから戻した行の内側の for が、後ろの兄弟の for / if を消さない（#392）", () => {
  it("先頭を消してから先頭に足した行で、2 つ目の for も描くこと", async () => {
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount({ rows: [0, 1, 2, 3].map(mk) }, TWO_FORS);
    // 行 0 の器。先頭を消すとプールに入り、先頭に足す行が使い回す
    const recycled = shadowRoot.querySelector(".r")!;

    await step(stateEl, (s) => { s.rows = s.rows.slice(1); });
    expect(view(shadowRoot, ".r")).toEqual(["11+15", "21+25", "31+35"]);
    const removedAnchors = await countRemovedAnchors(recycled, () => step(stateEl, (s) => { s.rows = [mk(9), ...s.rows]; }));
    expect(shadowRoot.querySelector(".r")).toBe(recycled);
    // 修理前: 先頭が "91" だけ（内側の 1 つ目の for が器を空にして 2 つ目の for のアンカーを消し、console.error が出る）
    expect(view(shadowRoot, ".r")).toEqual(["91+95", "11+15", "21+25", "31+35"]);
    expect(removedAnchors).toBe(0);
    // 消えたアンカーは以後も描けない — 同じ行の 2 つ目のリストへの書き込みにも追従すること
    await step(stateEl, (s) => { s["rows.0.it2"] = [{ v: 96 }, { v: 97 }]; });
    expect(view(shadowRoot, ".r")[0]).toBe("91+96+97");
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("消した後に中へ挿した行・同じバッチで消して足した行でも、2 つ目の for を描くこと", async () => {
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount({ rows: [0, 1, 2, 3].map(mk) }, TWO_FORS);

    await step(stateEl, (s) => { s.rows = s.rows.slice(1); });
    await step(stateEl, (s) => { const r = [...s.rows]; r.splice(1, 0, mk(9)); s.rows = r; });
    expect(view(shadowRoot, ".r")).toEqual(["11+15", "91+95", "21+25", "31+35"]);
    await step(stateEl, (s) => { s.rows = [mk(8), ...s.rows.slice(1)]; });
    expect(view(shadowRoot, ".r")).toEqual(["81+85", "91+95", "21+25", "31+35"]);
    await step(stateEl, (s) => { s.rows = [4, 5].map(mk); });
    expect(view(shadowRoot, ".r")).toEqual(["41+45", "51+55"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("内側の for の後ろが if でも、プールから戻した行で if の枝を描くこと", async () => {
    const errors = spyErrors();
    const mkF = (n: number) => ({ n, f: true, it: [{ v: n * 10 + 1 }] });
    const { host, shadowRoot, stateEl } = await mount(
      { rows: [0, 1, 2].map(mkF) },
      `<template data-wcs="for: rows"><div class="r"><template data-wcs="for: .it"><i>{{ .v }}</i></template>` +
      `<template data-wcs="if: .f"><s>F</s></template></div></template>`,
    );

    await step(stateEl, (s) => { s.rows = s.rows.slice(1); });
    await step(stateEl, (s) => { s.rows = [mkF(9), ...s.rows]; });
    // 修理前: 先頭が "91" だけ（if のアンカーが黙って消える — エラーも出ない）
    expect(view(shadowRoot, ".r")).toEqual(["91+F", "11+F", "21+F"]);
    await step(stateEl, (s) => { s["rows.0.f"] = false; });
    await step(stateEl, (s) => { s["rows.0.f"] = true; });
    expect(view(shadowRoot, ".r")[0]).toBe("91+F");
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("入れ子の深さ 3 で内側の行をプールから戻しても、兄弟の for を描くこと", async () => {
    const errors = spyErrors();
    const mkG = (n: number) => ({ n, g: [mk(n), mk(n + 50)] });
    const { host, shadowRoot, stateEl } = await mount(
      { rows: [0, 1].map(mkG) },
      `<template data-wcs="for: rows"><section><template data-wcs="for: .g"><div class="r">` +
      `<template data-wcs="for: .it"><i>{{ .v }}</i></template><template data-wcs="for: .it2"><u>{{ .v }}</u></template>` +
      `</div></template></section></template>`,
    );

    await step(stateEl, (s) => { s.rows = s.rows.map((r: any) => ({ ...r, g: r.g.slice(1) })); });
    await step(stateEl, (s) => { s.rows = s.rows.map((r: any, i: number) => ({ ...r, g: [mk(90 + i), ...r.g] })); });
    expect(view(shadowRoot, ".r")).toEqual(["901+905", "501+505", "911+915", "511+515"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });
});

describe("if で隠している間にリストを空にしてから戻しても、後ろの兄弟の for を消さない（#392）", () => {
  it("戻したときに兄弟の for の行が残り、以後も両方が書き込みに追従すること", async () => {
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount(
      { show: true, a: [{ v: 1 }], b: [{ v: 2 }] },
      `<template data-wcs="if: show"><div class="r"><template data-wcs="for: a"><i>{{ .v }}</i></template>` +
      `<template data-wcs="for: b"><u>{{ .v }}</u></template></div></template>`,
    );

    await step(stateEl, (s) => { s.show = false; });
    await step(stateEl, (s) => { s.a = []; });
    await step(stateEl, (s) => { s.show = true; });
    // 修理前（v3.3.0 から）: 空の <div>（b のアンカーごと消える）
    expect(view(shadowRoot, ".r")).toEqual(["2"]);
    await step(stateEl, (s) => { s.a = [{ v: 3 }]; s.b = [{ v: 4 }, { v: 5 }]; });
    expect(view(shadowRoot, ".r")).toEqual(["3+4+5"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });
});

describe("対照: 親の中身が for だけなら、描いた行を全部外すと親を空にする近道を取る（#392）", () => {
  it("プールから戻した行の内側の for が兄弟を持たないときは、近道で器を空にして描くこと", async () => {
    const errors = spyErrors();
    const mk1 = (n: number) => ({ n, it: [{ v: n * 10 + 1 }, { v: n * 10 + 2 }] });
    const { host, shadowRoot, stateEl } = await mount(
      { rows: [0, 1, 2].map(mk1) },
      `<template data-wcs="for: rows"><div class="r"><template data-wcs="for: .it"><i>{{ .v }}</i></template></div></template>`,
    );
    const recycled = shadowRoot.querySelector(".r")!;

    await step(stateEl, (s) => { s.rows = s.rows.slice(1); });
    const removedAnchors = await countRemovedAnchors(recycled, () => step(stateEl, (s) => { s.rows = [mk1(9), ...s.rows]; }));
    expect(shadowRoot.querySelector(".r")).toBe(recycled);
    expect(view(shadowRoot, ".r")).toEqual(["91+92", "11+12", "21+22"]);
    // 近道は器を空にしてアンカーだけを戻す（アンカーから数えても「この for だけ」と判定する）
    expect(removedAnchors).toBe(1);
    expect(Array.from(recycled.childNodes).filter((node) => node.nodeType === Node.COMMENT_NODE)).toHaveLength(1);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });
});
