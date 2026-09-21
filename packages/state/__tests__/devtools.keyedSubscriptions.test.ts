/**
 * devtools.keyedSubscriptions.test.ts — source の `keyedSubscriptions(rootNode)`（protocol v2 追補・要件 D17）。
 * 鍵付き購読（`$eq` / `$eqPath` / `$eqIndex`）を path ごとに数えて返すこと、getter 由来の path が
 * 追跡付きの読みに落ちたことを `tracked` で出すことを固定する。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElement } from "../src/stateElementByName";
import { registerDevtoolsSource, __getRegisteredSourceForTest } from "../src/devtools/bridge";

beforeAll(() => {
  bootstrapState();
  registerDevtoolsSource();
});

let seq = 0;
const flush = () => new Promise((r) => setTimeout(r));

async function mount(initial: any, innerHTML: string) {
  const host = document.createElement(`keyed-summary-host-${seq++}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = innerHTML + `<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(initial);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  const stateElement = getStateElement(shadowRoot)!;
  const write = async (fn: (s: any) => void) => { stateElement.createState("writable", fn); await flush(); };
  const summary = () => __getRegisteredSourceForTest()!.keyedSubscriptions(shadowRoot);
  return { host, write, summary };
}

const ROWS = `<ul><template data-wcs="for: items"><li data-wcs="class.sel: .selected; textContent: .id"></li></template></ul>`;

describe("keyedSubscriptions: 鍵付き購読の要約", () => {
  it("$eq 系を一度も評価していない state は空配列を返すこと", async () => {
    const { host, summary } = await mount({ count: 1 }, `<span data-wcs="textContent: count"></span>`);
    expect(summary()).toEqual([]);
    host.remove();
  });

  it("$eq の行ごとの購読を数え、書き込みの値と行の削除を反映すること", async () => {
    const { host, write, summary } = await mount(
      {
        items: [{ id: "a" }, { id: "b" }, { id: "c" }],
        selectedIndex: null,
        get "items.*.selected"(this: any) { return this.$eq("selectedIndex", this.$1); },
      },
      ROWS,
    );
    expect(summary()).toEqual([
      { path: "selectedIndex", tracked: false, rows: 3, keys: 3, lists: 0, lastValue: null },
    ]);
    await write((s) => { s.selectedIndex = 1; });
    expect(summary()).toEqual([
      { path: "selectedIndex", tracked: false, rows: 3, keys: 3, lists: 0, lastValue: 1 },
    ]);
    // 退役した行の購読は台帳から落ちる
    await write((s) => { s.items = s.items.slice(1); });
    expect(summary()[0]).toMatchObject({ rows: 2, keys: 2 });
    host.remove();
  });

  it("$eqPath は同じ鍵を持つ行を 1 つの鍵に数えること", async () => {
    const { host, summary } = await mount(
      {
        items: [{ id: "a", kind: "x" }, { id: "b", kind: "x" }, { id: "c", kind: "y" }],
        mode: "x",
        get "items.*.selected"(this: any) { return this.$eqPath("mode", "items.*.kind"); },
      },
      ROWS,
    );
    expect(summary()).toEqual([
      { path: "mode", tracked: false, rows: 3, keys: 2, lists: 0, lastValue: "x" },
    ]);
    host.remove();
  });

  it("$eqIndex の最内段は行ごとの購読を持たず、リスト単位の監視として数えること", async () => {
    const { host, summary } = await mount(
      {
        items: [{ id: "a" }, { id: "b" }],
        selectedIndex: 0,
        get "items.*.selected"(this: any) { return this.$eqIndex("selectedIndex"); },
      },
      ROWS,
    );
    expect(summary()).toEqual([
      { path: "selectedIndex", tracked: false, rows: 0, keys: 0, lists: 1, lastValue: 0 },
    ]);
    host.remove();
  });

  it("getter 由来の path は 3 つの形とも tracked として出し、購読を持たないこと", async () => {
    const { host, summary } = await mount(
      {
        items: [{ id: "a" }, { id: "b" }],
        picked: { id: "b" },
        pickedIndex: 1,
        get current(this: any) { return this.picked; },
        get index(this: any) { return this.pickedIndex; },
        get "items.*.selected"(this: any) {
          return this.$eq("current.id", this["items.*.id"])
            || this.$eqPath("current", "items.*.id")
            || this.$eqIndex("index");
        },
      },
      ROWS,
    );
    expect(summary()).toEqual([
      { path: "current", tracked: true, rows: 0, keys: 0, lists: 0, lastValue: undefined },
      { path: "current.id", tracked: true, rows: 0, keys: 0, lists: 0, lastValue: undefined },
      { path: "index", tracked: true, rows: 0, keys: 0, lists: 0, lastValue: undefined },
    ]);
    host.remove();
  });

  it("getter の外（createState の中・setter）での呼び出しは購読も tracked も残さないこと", async () => {
    const { host, write, summary } = await mount(
      {
        items: [{ id: "a" }],
        pickedIndex: 0,
        get index(this: any) { return this.pickedIndex; },
        set "items.*.pick"(this: any, _v: unknown) { this.$eqIndex("index"); },
      },
      `<ul><template data-wcs="for: items"><li data-wcs="textContent: .id"></li></template></ul>`,
    );
    await write((s) => {
      s.$eq("index", 0);
      s.$eqPath("index", "pickedIndex");
      s.$eq("pickedIndex", 0);
      s["items.0.pick"] = 1;
    });
    expect(summary()).toEqual([]);
    host.remove();
  });
});
