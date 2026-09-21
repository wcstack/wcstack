/**
 * structural.planRender.test.ts — プラン初期描画（行ランタイム設計 R2）の境界。
 *
 * プラン行の活性化は、行の下の**素の葉**だけを行オブジェクトの生の値から書き、それ以外
 * （getter・入れ子リスト・event / index 束縛）は従来どおり `applyChange` を通る。載せない
 * state も 2 つある（`$updatedCallback` と `**`）。試作では再帰と `_state` 再セットで 8 件
 * 落ちたので、その 2 点をここで固定する。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import type { State } from "../src/components/State";

const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve));

beforeAll(() => {
  bootstrapState();
});

let seq = 0;
async function mount(initial: any, innerHTML: string): Promise<{ shadowRoot: ShadowRoot; stateEl: State }> {
  const host = document.createElement(`plan-render-host-${seq++}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = innerHTML + `<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(initial);
  await stateEl.connectedCallbackPromise;
  await (stateEl.constructor as typeof State).getBindingsReady(shadowRoot);
  return { shadowRoot, stateEl };
}

const texts = (root: ParentNode, selector: string): (string | null)[] =>
  Array.from(root.querySelectorAll(selector)).map((element) => element.textContent);

const ROWS = `<ul><template data-wcs="for: items"><li><span class="name" data-wcs="textContent: items.*.name"></span><span class="upper" data-wcs="textContent: items.*.upper"></span></li></template></ul>`;

describe("プラン初期描画", () => {
  it("素の葉は行の値を、getter は getter の値を描くこと", async () => {
    const { shadowRoot } = await mount({
      items: [{ name: "a" }, { name: "b" }],
      get "items.*.upper"(this: any) { return String(this["items.*.name"]).toUpperCase(); },
    }, ROWS);

    expect(texts(shadowRoot, ".name")).toEqual(["a", "b"]);
    expect(texts(shadowRoot, ".upper")).toEqual(["A", "B"]);
  });

  it("行の値の更新が届くこと（初期描画の後も通常の経路で動く）", async () => {
    const { shadowRoot, stateEl } = await mount({
      items: [{ name: "a" }, { name: "b" }],
      get "items.*.upper"(this: any) { return String(this["items.*.name"]).toUpperCase(); },
    }, ROWS);

    stateEl.createState("writable", (state: any) => {
      state.$resolve("items.*.name", [1], "z");
    });
    await flush();

    expect(texts(shadowRoot, ".name")).toEqual(["a", "z"]);
    expect(texts(shadowRoot, ".upper")).toEqual(["A", "Z"]);
  });

  it("入れ子のリストも行ごとに描けること（行より下のワイルドカードは素の葉にしない）", async () => {
    const { shadowRoot } = await mount({
      groups: [{ tags: ["x", "y"] }, { tags: ["z"] }],
    }, `<template data-wcs="for: groups"><div class="group"><template data-wcs="for: groups.*.tags"><span class="tag" data-wcs="textContent: groups.*.tags.*"></span></template></div></template>`);

    expect(texts(shadowRoot, ".tag")).toEqual(["x", "y", "z"]);
  });

  it("途中のオブジェクトが無い深いパスは空で描くこと（行の生の読みで親が辿れない）", async () => {
    const { shadowRoot } = await mount({
      items: [{ meta: { label: "has" } }, { meta: null }, {}],
    }, `<template data-wcs="for: items"><span class="label" data-wcs="textContent: items.*.meta.label"></span></template>`);

    expect(texts(shadowRoot, ".label")).toEqual(["has", "", ""]);
  });

  it("同じ drain で行の生成と行の値の書き込みが重なっても、二重に適用しないこと", async () => {
    const { shadowRoot, stateEl } = await mount({
      items: [{ name: "a" }],
      get "items.*.upper"(this: any) { return String(this["items.*.name"]).toUpperCase(); },
    }, ROWS);

    stateEl.createState("writable", (state: any) => {
      state.items = [{ name: "b" }, { name: "c" }];
      state.$resolve("items.*.name", [0], "B");
    });
    await flush();

    expect(texts(shadowRoot, ".name")).toEqual(["B", "c"]);
    expect(texts(shadowRoot, ".upper")).toEqual(["B", "C"]);
  });

  it("`**` を宣言した state は従来経路で描くこと（展開形の getter は getterPaths に無い）", async () => {
    const { shadowRoot } = await mount({
      $recursion: { "nodes.*": "children.*" },
      nodes: [
        { name: "root", value: 1, children: [{ name: "leaf", value: 2, children: [] }] },
      ],
      get "nodes.**.total"(this: any): number {
        return this["nodes.**.value"] +
          this.$getAll("nodes.**.children.*.total").reduce((a: number, b: number) => a + b, 0);
      },
    }, `<template data-wcs="for: nodes"><div class="node"><span class="name" data-wcs="textContent: nodes.*.name"></span><span class="total" data-wcs="textContent: nodes.*.total"></span></div></template>`);

    expect(texts(shadowRoot, ".name")).toEqual(["root"]);
    expect(texts(shadowRoot, ".total")).toEqual(["3"]);
  });

  it("`_state` の再セットで getter が入れ替わっても、行は新しい世代の値を描くこと", async () => {
    const { shadowRoot, stateEl } = await mount({
      items: [{ name: "a" }, { name: "b" }],
      get "items.*.upper"(this: any) { return String(this["items.*.name"]).toUpperCase(); },
    }, ROWS);
    expect(texts(shadowRoot, ".upper")).toEqual(["A", "B"]);

    // 2 世代目では upper が素のデータ（getter ではない）。getterPaths は作り直されるので、
    // プラン側に判定をキャッシュしていると古い経路で描いてしまう
    stateEl.setInitialState({
      items: [{ name: "c", upper: "plain-c" }, { name: "d", upper: "plain-d" }],
    });
    await flush();

    expect(texts(shadowRoot, ".name")).toEqual(["c", "d"]);
    expect(texts(shadowRoot, ".upper")).toEqual(["plain-c", "plain-d"]);
  });

  it("`$updatedCallback` を持つ state でも行が描けること（従来経路へ倒す）", async () => {
    const updated: string[] = [];
    const { shadowRoot, stateEl } = await mount({
      items: [{ name: "a" }, { name: "b" }],
      get "items.*.upper"(this: any) { return String(this["items.*.name"]).toUpperCase(); },
      $updatedCallback(paths: string[]) { updated.push(...paths); },
    }, ROWS);

    expect(texts(shadowRoot, ".name")).toEqual(["a", "b"]);
    stateEl.createState("writable", (state: any) => {
      state.$resolve("items.*.name", [0], "q");
    });
    await flush();

    expect(texts(shadowRoot, ".name")).toEqual(["q", "b"]);
    expect(updated).toContain("items.*.name");
  });
});
