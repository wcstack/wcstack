/**
 * proxy.keyedRound3.test.ts — next-major prototype (sandbox only): `$eq` / `$eqPath` /
 * `$eqIndex` keyed subscriptions, dispose-tied unsubscription and diff-side re-keying.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElement } from "../src/stateElementByName";
import { countKeyedSubscriptions } from "../src/dependency/keyedDependency";

beforeAll(() => {
  bootstrapState();
});

let seq = 0;
const flush = () => new Promise((r) => setTimeout(r));

async function mount(initial: any, innerHTML: string) {
  const host = document.createElement(`keyed-host-${seq++}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = innerHTML + `<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(initial);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  const stateElement = getStateElement(shadowRoot)!;
  const write = async (fn: (s: any) => void) => { stateElement.createState("writable", fn); await flush(); };
  const selected = () => Array.from(shadowRoot.querySelectorAll("li")).filter((li) => li.classList.contains("sel")).map((li) => li.textContent);
  const texts = () => Array.from(shadowRoot.querySelectorAll("li")).map((li) => li.textContent);
  return { host, shadowRoot, stateElement, write, selected, texts };
}

const ROWS = `<ul><template data-wcs="for: items"><li data-wcs="class.sel: .selected; textContent: .id"></li></template></ul>`;

describe("$eqPath: 行 id を依存なしで鍵にする", () => {
  it("選択の書き込みは旧行と新行だけを再評価し、リスト置換は再評価しないこと", async () => {
    let evals = 0;
    const { host, write, selected, texts, stateElement } = await mount(
      {
        items: [{ id: "a" }, { id: "b" }, { id: "c" }],
        selectedId: null,
        get "items.*.selected"(this: any) { evals++; return this.$eqPath("selectedId", "items.*.id"); },
      },
      ROWS,
    );
    expect(evals).toBe(3);
    expect(selected()).toEqual([]);
    expect(countKeyedSubscriptions(stateElement, "selectedId")).toBe(3);

    await write((s) => { s.selectedId = "b"; });
    expect(selected()).toEqual(["b"]);
    expect(evals).toBe(4); // 新行 b だけ（旧値 null に購読者なし）

    await write((s) => { s.selectedId = "c"; });
    expect(selected()).toEqual(["c"]);
    expect(evals).toBe(6); // 旧行 b ＋ 新行 c

    // 置換（並べ替え）: パターン辺が無いので getter は 1 件も再評価されない
    const before = evals;
    await write((s) => { s.items = [...s.items].reverse(); });
    expect(texts()).toEqual(["c", "b", "a"]);
    expect(selected()).toEqual(["c"]);
    expect(evals).toBe(before);
    host.remove();
  });

  it("削除された行の購読は行と一緒に落ちること", async () => {
    let evals = 0;
    const { host, write, selected, stateElement } = await mount(
      {
        items: [{ id: "a" }, { id: "b" }, { id: "c" }],
        selectedId: "b",
        get "items.*.selected"(this: any) { evals++; return this.$eqPath("selectedId", "items.*.id"); },
      },
      ROWS,
    );
    expect(selected()).toEqual(["b"]);
    expect(countKeyedSubscriptions(stateElement, "selectedId")).toBe(3);

    await write((s) => { s.items = s.items.filter((x: any) => x.id !== "b"); });
    expect(selected()).toEqual([]);
    expect(countKeyedSubscriptions(stateElement, "selectedId")).toBe(2);

    const before = evals;
    await write((s) => { s.selectedId = "c"; });
    expect(selected()).toEqual(["c"]);
    expect(evals).toBe(before + 1); // 旧値 b の行は退役済みで通知されない
    host.remove();
  });

  it("入れ子のワイルドカードでも行単位に購読すること", async () => {
    let evals = 0;
    const { host, write, selected, stateElement } = await mount(
      {
        groups: [{ items: [{ id: "a" }, { id: "b" }] }, { items: [{ id: "c" }] }],
        selectedId: null,
        get "groups.*.items.*.selected"(this: any) { evals++; return this.$eqPath("selectedId", "groups.*.items.*.id"); },
      },
      `<template data-wcs="for: groups"><ul><template data-wcs="for: .items"><li data-wcs="class.sel: .selected; textContent: .id"></li></template></ul></template>`,
    );
    expect(evals).toBe(3);
    expect(countKeyedSubscriptions(stateElement, "selectedId")).toBe(3);
    await write((s) => { s.selectedId = "c"; });
    expect(selected()).toEqual(["c"]);
    expect(evals).toBe(4);
    await write((s) => { s.selectedId = "a"; });
    expect(selected()).toEqual(["a"]);
    expect(evals).toBe(6);
    host.remove();
  });
});

describe("$eqIndex: index を鍵にし、差分側で付け替える", () => {
  it("選択は index に付き、1 行削除は移動行のうち高々 2 行しか再評価しないこと", async () => {
    let evals = 0;
    const { host, write, selected, texts } = await mount(
      {
        items: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
        selectedIndex: null,
        get "items.*.selected"(this: any) { evals++; return this.$eqIndex("selectedIndex"); },
      },
      ROWS,
    );
    expect(evals).toBe(4);
    await write((s) => { s.selectedIndex = 1; });
    expect(selected()).toEqual(["b"]);
    expect(evals).toBe(5);

    // 行 a を削除: b は index 1 → 0（選択が外れる）、c は 2 → 1（選択される）、d は 3 → 2（値は変わらない）
    const before = evals;
    await write((s) => { s.items = s.items.slice(1); });
    expect(texts()).toEqual(["b", "c", "d"]);
    expect(selected()).toEqual(["c"]);
    expect(evals - before).toBe(2);

    // 続く選択変更も旧行・新行だけ
    await write((s) => { s.selectedIndex = 2; });
    expect(selected()).toEqual(["d"]);
    expect(evals - before).toBe(4);
    host.remove();
  });

  it("交換で移動した行の鍵が付いて行くこと", async () => {
    let evals = 0;
    const { host, write, selected, texts } = await mount(
      {
        items: [{ id: "a" }, { id: "b" }, { id: "c" }],
        selectedIndex: 0,
        get "items.*.selected"(this: any) { evals++; return this.$eqIndex("selectedIndex"); },
      },
      ROWS,
    );
    expect(selected()).toEqual(["a"]);
    const before = evals;
    await write((s) => { const next = [...s.items]; [next[0], next[2]] = [next[2], next[0]]; s.items = next; });
    expect(texts()).toEqual(["c", "b", "a"]);
    // index 0 に来た c が選択され、index 2 へ去った a は外れる
    expect(selected()).toEqual(["c"]);
    expect(evals - before).toBe(2);
    host.remove();
  });
});
