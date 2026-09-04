/**
 * `for` の行に `bind-component` のコンポーネントがある構成で、リストを差し替えたときの統合テスト。
 * README の "Loop with Components" の形（`<template data-wcs="for: users"><my-c data-wcs="state.x: .y">`）。
 *
 * 行の再生成では **DOM に戻る前に** apply が走る。行の content とその中のコンポーネント要素は
 * 再利用されるので、要素をキーにした `stateElementByWebComponent` は前回の（既に切断された）
 * state element を指したままで、そこへ `createState` すると raiseError していた。
 * updater の drain も applyChangeToFor の行ループも例外を捕まえないため、
 * **1 行が同じバッチの残り全部を道連れにし、for が空のまま以後どんな更新でも復帰しなくなる**
 * （docs/architecture-hardening/15-state-component-mechanism-consistency.md §1.9）。
 *
 * 既存の回帰は行フィールドの書き込みまでしか動かしておらず、リスト自体の差し替えを
 * 一度も通していなかった。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));

let counter = 0;
const uniqueTag = (prefix: string): string => `${prefix}-${++counter}`;

/** 行に置くコンポーネント。shadow の組み立て方で挙動が変わらないことも押さえる */
function defineRowComponent(tag: string, buildIn: "constructor" | "connectedCallback"): void {
  const markup =
    `<wcs-state bind-component="state"></wcs-state>` +
    `<span class="row-view" data-wcs="textContent: row.id"></span>`;
  class RowComponent extends HTMLElement {
    state: Record<string, any> = {}; // v2 R1: 既定値はマッピングを隠す（D19）
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      if (buildIn === "constructor") {
        this.shadowRoot!.innerHTML = markup;
      }
    }
    connectedCallback() {
      if (buildIn === "connectedCallback") {
        this.shadowRoot!.innerHTML = markup;
      }
    }
  }
  customElements.define(tag, RowComponent);
}

async function mountRows(buildIn: "constructor" | "connectedCallback") {
  const tag = uniqueTag("bcrr-row");
  defineRowComponent(tag, buildIn);

  const host = document.createElement(uniqueTag("bcrr-host"));
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `
    <wcs-state json='{"groups":[{"id":"g1"},{"id":"g2"}]}'></wcs-state>
    <div id="host-view"><template data-wcs="for: groups"><div class="grp"><span class="gid" data-wcs="textContent: groups.*.id"></span><${tag} data-wcs="state.row: groups.*"></${tag}></div></template></div>
  `;
  document.body.appendChild(host);

  const parentStateElement = shadowRoot.querySelector("wcs-state") as State;
  await parentStateElement.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  await flush();
  await flush();

  /** 親スコープ側の行（親自身のバインディング） */
  const hostIds = () => Array.from(shadowRoot.querySelectorAll(".gid")).map((e) => e.textContent);
  /** 子コンポーネントの Shadow 内のビュー（束ねが生きていないと動かない） */
  const shadowIds = () =>
    Array.from(shadowRoot.querySelectorAll(tag))
      .map((c) => (c as HTMLElement).shadowRoot?.querySelector(".row-view")?.textContent ?? null);

  return { host, shadowRoot, parentStateElement, hostIds, shadowIds };
}

describe("bind-component: 行にコンポーネントを持つリストの差し替え (integration)", () => {
  for (const buildIn of ["constructor", "connectedCallback"] as const) {
    describe(`shadow の組み立てが ${buildIn}`, () => {
      it("リストを差し替えても行が再描画され、子コンポーネントにも値が入ること", async () => {
        const { host, parentStateElement, hostIds, shadowIds } = await mountRows(buildIn);
        expect(hostIds()).toEqual(["g1", "g2"]);
        expect(shadowIds()).toEqual(["g1", "g2"]);

        parentStateElement.createState("writable", (s: any) => {
          s.groups = [{ id: "g9" }];
        });
        await flush();
        await flush();

        expect(hostIds()).toEqual(["g9"]);
        expect(shadowIds()).toEqual(["g9"]);

        host.remove();
      });

      it("差し替えのあとも後続の更新が通ること（バッチの道連れが無いこと）", async () => {
        const { host, parentStateElement, hostIds, shadowIds } = await mountRows(buildIn);

        parentStateElement.createState("writable", (s: any) => {
          s.groups = [{ id: "g9" }];
        });
        await flush();
        await flush();

        // 行フィールドの書き込み
        parentStateElement.createState("writable", (s: any) => {
          s["groups.0.id"] = "g9x";
        });
        await flush();
        await flush();
        expect(hostIds()).toEqual(["g9x"]);
        expect(shadowIds()).toEqual(["g9x"]);

        // もう一度の差し替え（1 回目で for が死んでいると空のまま戻らない）
        parentStateElement.createState("writable", (s: any) => {
          s.groups = [{ id: "gA" }, { id: "gB" }, { id: "gC" }];
        });
        await flush();
        await flush();
        expect(hostIds()).toEqual(["gA", "gB", "gC"]);
        expect(shadowIds()).toEqual(["gA", "gB", "gC"]);

        host.remove();
      });
    });
  }

  it("行オブジェクトを保った並べ替えでは行も子コンポーネントも保たれること", async () => {
    const { host, parentStateElement, shadowRoot, hostIds, shadowIds } = await mountRows("constructor");
    const tagName = (shadowRoot.querySelector("[data-wcs^='state.row']") as HTMLElement).tagName.toLowerCase();
    const before = Array.from(shadowRoot.querySelectorAll(tagName));

    parentStateElement.createState("writable", (s: any) => {
      s.groups = [s.groups[1], s.groups[0]];
    });
    await flush();
    await flush();

    expect(hostIds()).toEqual(["g2", "g1"]);
    expect(shadowIds()).toEqual(["g2", "g1"]);
    // 行の同一性が保たれる ＝ 作り直しではなく並べ替えとして処理されている
    const after = Array.from(shadowRoot.querySelectorAll(tagName));
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);

    host.remove();
  });

  it("空配列にしてから戻せること", async () => {
    const { host, parentStateElement, hostIds, shadowIds } = await mountRows("constructor");

    parentStateElement.createState("writable", (s: any) => { s.groups = []; });
    await flush();
    await flush();
    expect(hostIds()).toEqual([]);

    parentStateElement.createState("writable", (s: any) => { s.groups = [{ id: "z1" }, { id: "z2" }]; });
    await flush();
    await flush();
    expect(hostIds()).toEqual(["z1", "z2"]);
    expect(shadowIds()).toEqual(["z1", "z2"]);

    host.remove();
  });
});
