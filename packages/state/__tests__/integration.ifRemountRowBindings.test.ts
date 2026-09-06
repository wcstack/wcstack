/**
 * integration.ifRemountRowBindings.test.ts — 非表示（if:false）を跨いだ for 行の
 * バインディング復活契約（docs/state-deactivated-content-stale-update.md）。
 *
 * if の非表示は content.unmount() を再帰させ、配下の行 content は session ごと
 * dispose される。再表示時に applyChangeToFor が行を物理的に戻すだけだと binding は
 * dispose 済みのままで、**行の同一性が保たれる更新が以後すべて無視される**
 * （全行置換だけは行を作り直すため「たまたま」直る）。ここでは戻した行を
 * 再活性化する契約を固定する。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElement } from "../src/stateElementByName";

beforeAll(() => {
  bootstrapState();
});

let seq = 0;
const flush = () => new Promise((r) => setTimeout(r));

async function mount(initial: any, innerHTML: string) {
  const host = document.createElement(`ifrowbind-host-${seq++}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = innerHTML + `<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(initial);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  const stateElement = getStateElement(shadowRoot)!;
  return { host, shadowRoot, stateElement };
}

const LIST_IN_IF =
  `<template data-wcs="if: show"><ul><template data-wcs="for: items">` +
  `<li><span data-wcs="textContent: .name"></span></li></template></ul></template>`;

const texts = (root: ShadowRoot) =>
  Array.from(root.querySelectorAll("span")).map((s) => s.textContent);

/** 行オブジェクトの参照を保ったまま値だけ変える（§7.0 のイディオム） */
function mutateInPlace(state: any, name: string): void {
  const rows = state.items;
  rows[0].name = name;
  state.items = [...rows];
}

describe("非表示を跨いだ for 行のバインディング(統合)", () => {
  it("非表示中に行の同一性を保ったまま更新しても、再表示で新しい値が出ること", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      { show: true, items: [{ id: 1, name: "a" }, { id: 2, name: "b" }] },
      LIST_IN_IF,
    );
    expect(texts(shadowRoot)).toEqual(["a", "b"]);

    stateElement.createState("writable", (s: any) => { s.show = false; });
    await flush();
    stateElement.createState("writable", (s: any) => { mutateInPlace(s, "A"); });
    await flush();
    stateElement.createState("writable", (s: any) => { s.show = true; });
    await flush();

    expect(texts(shadowRoot)).toEqual(["A", "b"]);
    host.remove();
  });

  it("非表示 → 再表示を挟んだだけでも、その後の行内更新が届くこと", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      { show: true, items: [{ id: 1, name: "a" }, { id: 2, name: "b" }] },
      LIST_IN_IF,
    );

    stateElement.createState("writable", (s: any) => { s.show = false; });
    await flush();
    stateElement.createState("writable", (s: any) => { s.show = true; });
    await flush();
    expect(texts(shadowRoot)).toEqual(["a", "b"]);

    // 行 content は再利用されるので、binding が復活していないとここが無視される
    stateElement.createState("writable", (s: any) => { mutateInPlace(s, "Z"); });
    await flush();

    expect(texts(shadowRoot)).toEqual(["Z", "b"]);
    host.remove();
  });

  it("再表示後も行 DOM が再利用され、非バインド DOM 状態が保たれること", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      { show: true, items: [{ id: 1, name: "a" }, { id: 2, name: "b" }] },
      `<template data-wcs="if: show"><ul><template data-wcs="for: items">` +
      `<li><details><summary>s</summary>d</details><span data-wcs="textContent: .name"></span></li>` +
      `</template></ul></template>`,
    );
    const before = Array.from(shadowRoot.querySelectorAll("li"));
    (before[0].querySelector("details") as HTMLDetailsElement).open = true;

    stateElement.createState("writable", (s: any) => { s.show = false; });
    await flush();
    stateElement.createState("writable", (s: any) => { mutateInPlace(s, "A"); });
    await flush();
    stateElement.createState("writable", (s: any) => { s.show = true; });
    await flush();

    expect(Array.from(shadowRoot.querySelectorAll("li"))).toEqual(before);
    expect(texts(shadowRoot)).toEqual(["A", "b"]);
    expect((before[0].querySelector("details") as HTMLDetailsElement).open).toBe(true);
    host.remove();
  });

  it("ネストした for の行も再表示後に更新が届くこと", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      {
        show: true,
        groups: [
          { id: 1, rows: [{ id: 11, name: "r11" }, { id: 12, name: "r12" }] },
          { id: 2, rows: [{ id: 21, name: "r21" }] },
        ],
      },
      `<template data-wcs="if: show"><div><template data-wcs="for: groups">` +
      `<section><template data-wcs="for: groups.*.rows">` +
      `<span data-wcs="textContent: .name"></span>` +
      `</template></section></template></div></template>`,
    );
    expect(texts(shadowRoot)).toEqual(["r11", "r12", "r21"]);

    stateElement.createState("writable", (s: any) => { s.show = false; });
    await flush();
    stateElement.createState("writable", (s: any) => { s.show = true; });
    await flush();

    // ネストの行を in-place で変異させ、トップレベルのコピー再代入で通知する
    // （行の同一性は保たれるので、行 binding が生きていないと反映されない）
    stateElement.createState("writable", (s: any) => {
      const groups = s.groups;
      groups[0].rows[0].name = "R11";
      s.groups = [...groups];
    });
    await flush();

    expect(texts(shadowRoot)).toEqual(["R11", "r12", "r21"]);
    host.remove();
  });
});
