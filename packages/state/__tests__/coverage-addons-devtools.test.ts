import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, devtools } from "../src/index";
import { registerSource } from "../src/devtools/devtools";

const flush = () => new Promise((r) => setTimeout(r, 0));
const HOOK = "__WCSTACK_DEVTOOLS_HOOK__";
let seq = 0;

beforeAll(() => {
  installFeatures([devtools]);
  bootstrapState();
});

const registry = (): any => (globalThis as any)[HOOK];
const source = (): any => [...registry().sources.values()].find((s: any) => s.kind === "state");

/** Attaches a listener; the events it receives. */
let detach: (() => void) | null = null;
function listen(): any[] {
  const events: any[] = [];
  detach = registry().addListener({ onEvent: (_id: string, e: any) => events.push(e) });
  return events;
}
afterEach(() => {
  detach?.();
  detach = null;
});

async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`cov-devtools-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  const write = async (fn: (s: any) => void) => {
    el.createState("writable", fn);
    await flush();
  };
  return { h, root, el, write };
}

const of = (events: any[], type: string) => events.filter((e) => e.type === type);
const mine = (events: any[], root: ShadowRoot) => events.filter((e) => e.absoluteAddress.absolutePathInfo.stateElement.getRootNode() === root);
const label = (e: any) => `${e.binding.propName}:${e.binding.statePathName}${e.absoluteAddress.listIndex === null ? "" : `[${e.absoluteAddress.listIndex.indexes}]`}`;
const labels = (events: any[]) => events.map(label).sort();

describe("DevTools フックのレジストリ", () => {
  it("同じ id の登録は無視し、聞き手には登録・登録解除を知らせ、解除済みの id と二重の detach は何もしない", () => {
    const reg = registry();
    const seen: string[] = [];
    const listener = {
      onSourceRegistered: (s: any) => seen.push(`+${s.id}`),
      onSourceUnregistered: (id: string) => seen.push(`-${id}`),
      onEvent: (id: string, e: any) => seen.push(`event ${id} ${e.type}`),
    };
    const off = reg.addListener(listener);
    // the state source already there is announced on attach
    expect(seen).toEqual([`+${source().id}`]);
    seen.length = 0;
    const sinks: unknown[] = [];
    const fake = { id: "fake:1", kind: "fake", _setSink: (s: unknown) => sinks.push(s) };
    reg.register(fake);
    expect(seen).toEqual(["+fake:1"]);
    // a listener is attached: the new source gets a sink that forwards to it with its id
    expect(typeof sinks[0]).toBe("function");
    (sinks[0] as (e: unknown) => void)({ type: "ping" });
    expect(seen).toEqual(["+fake:1", "event fake:1 ping"]);
    // the same id again: ignored (no second announcement, no second sink)
    reg.register({ id: "fake:1", _setSink: () => { throw new Error("must not be called"); } });
    expect(seen).toHaveLength(2);
    expect(reg.sources.get("fake:1")).toBe(fake);
    reg.unregister("fake:1");
    expect(sinks[sinks.length - 1]).toBe(null);
    expect(seen[seen.length - 1]).toBe("-fake:1");
    expect(reg.sources.has("fake:1")).toBe(false);
    // an id that is not registered: nothing happens
    const before = seen.length;
    reg.unregister("fake:1");
    reg.unregister("never");
    expect(seen).toHaveLength(before);
    off();
    // detaching twice does not touch the sinks again
    const count = sinks.length;
    off();
    expect(sinks).toHaveLength(count);
  });

  it("聞き手の無いレジストリへの登録はシンクを外したまま", () => {
    const reg = registry();
    const sinks: unknown[] = [];
    reg.register({ id: "fake:2", _setSink: (s: unknown) => sinks.push(s) });
    expect(sinks).toEqual([null]);
    reg.unregister("fake:2");
    expect(sinks).toEqual([null, null]);
  });

  it("サーバの描画（data-wcs-server）ではソースを登録しない", () => {
    const size = registry().sources.size;
    const seen: unknown[] = [];
    const off = registry().addListener({ onSourceRegistered: (s: unknown) => seen.push(s) });
    seen.length = 0;
    document.documentElement.setAttribute("data-wcs-server", "orchestrated");
    try {
      registerSource();
    } finally {
      document.documentElement.removeAttribute("data-wcs-server");
      off();
    }
    expect(registry().sources.size).toBe(size);
    expect(seen).toEqual([]);
  });
});

describe("バインディングの台帳（binding-added / binding-removed）", () => {
  it("attr. / style. の propName、同じ束縛の重複は 1 件、ルートの if / elseif の鎖は条件ごとの if と描いている枝の中身", async () => {
    const events = listen();
    const { root } = await page(
      `<p data-wcs="attr.title: t; style.color: c; attr.title: t"></p>`
      + `<template data-wcs="if: a"><b>{{ x }}</b></template><template data-wcs="elseif: b"><i>{{ y }}</i></template><template data-wcs="else:"><u>{{ z }}</u></template>`
      + `<template data-wcs="if: off"><s>{{ never }}</s></template>`,
      { t: "T", c: "red", a: false, b: true, off: false, x: 1, y: 2, z: 3, never: 0 },
    );
    await flush();
    const added = mine(of(events, "state:binding-added"), root);
    expect(labels(added)).toEqual(["attr.title:t", "if:a", "if:b", "if:off", "style.color:c", "textContent:y"].sort());
    const attr = added.find((e) => e.binding.propName === "attr.title");
    expect(attr.binding.bindingType).toBe("prop");
    expect(attr.binding.node).toBe(root.querySelector("p"));
    const cond = added.find((e) => e.binding.statePathName === "a");
    expect(cond.binding.bindingType).toBe("if");
    expect(cond.binding.node.nodeType).toBe(Node.COMMENT_NODE);
  });

  it("行の中のルートのパスと入れ子の for・if も数え、同じリストの 2 つ目の for も数える", async () => {
    const events = listen();
    const { root } = await page(
      `<ul><template data-wcs="for: items"><li><span>{{ title }}</span><template data-wcs="for: .tags"><i>{{ . }}</i></template>`
      + `<template data-wcs="if: .on"><b>{{ .v }}</b></template></li></template></ul>`
      + `<ol><template data-wcs="for: items"><li>{{ .v }}</li></template></ol>`
      // a list no for renders (made by $getAll): nothing of its own to report
      + `<p>{{ count }}</p>`,
      {
        title: "t", items: [{ v: 1, on: true, tags: ["a", "b"] }, { v: 2, on: false, tags: [] }], others: [1, 2, 3],
        get count() { return (this as any).$getAll("others.*", []).length; },
      },
    );
    expect(root.querySelector("p")!.textContent).toBe("3");
    await flush();
    const added = mine(of(events, "state:binding-added"), root);
    expect(labels(added)).toEqual([
      // the first for: the title read inside each row (a Binding of the row block, no row index)
      "for:items", "textContent:title", "textContent:title",
      // the nested for of each row, its rows, and the row's if (its condition and the rendered branch)
      "for:items.*.tags[0]", "for:items.*.tags[1]", "textContent:items.*.tags.*[0,0]", "textContent:items.*.tags.*[0,1]",
      "if:items.*.on[0]", "if:items.*.on[1]", "textContent:items.*.v[0]",
      // the second for over the same list (StateList.extra)
      "for:items", "textContent:items.*.v[0]", "textContent:items.*.v[1]",
      "textContent:count",
    ].sort());
    // a root-level path read inside a row carries no row index
    const title = added.find((e) => e.binding.statePathName === "title");
    expect(title.absoluteAddress.listIndex).toBe(null);
  });
});

describe("書き込み・再セット・トークン・接続", () => {
  it("setter への書き込みは write にならず batch にだけ入り、setter の中のデータの書き込みが write になる", async () => {
    const { root, write } = await page(`<p>{{ n }}</p>`, {
      _n: 1,
      get n() { return (this as any)._n; },
      set n(v: number) { (this as any)._n = v; },
    });
    const events = listen();
    await flush();
    events.length = 0;
    await write((s) => { s.n = 5; });
    expect(root.querySelector("p")!.textContent).toBe("5");
    const w = of(events, "state:write");
    expect(w.map((e) => e.absoluteAddress.absolutePathInfo.pathInfo.path)).toEqual(["_n"]);
    expect(w[0]).toMatchObject({ value: 5, oldValue: 1, hasOldValue: true });
    const batch = [...of(events, "state:update-batch")[0].addresses].map((a: any) => a.absolutePathInfo.pathInfo.path);
    expect(batch.sort()).toEqual(["_n", "n"]);
  });

  it("要素の一覧は setter を持つパスを数え、read は添字なしでも読める", async () => {
    const { root } = await page(``, {
      _n: 1,
      get n() { return (this as any)._n; },
      set n(v: number) { (this as any)._n = v; },
      get twice() { return (this as any)._n * 2; },
    });
    const sum = source().getStateElements().find((x: any) => x.rootNode === root);
    expect([...sum.paths.setter]).toEqual(["n"]);
    expect([...sum.paths.getter].sort()).toEqual(["n", "twice"]);
    expect(sum.watchPaths).toBe(null);
    expect(sum.keyedListPaths).toBe(null);
    expect(source().read(root, "twice")).toBe(2);
  });

  it("再セットは write でも update-batch でもなく、バインディングの差だけを報告する（別の配列の行は作り直し）", async () => {
    const { el, root } = await page(`<ul><template data-wcs="for: items"><li>{{ . }}</li></template></ul>`, { items: ["a", "b"] });
    const events = listen();
    await flush();
    events.length = 0;
    el.setInitialState({ items: ["c"] });
    await flush();
    expect(Array.from(root.querySelectorAll("li")).map((li) => li.textContent)).toEqual(["c"]);
    expect(of(events, "state:write")).toEqual([]);
    expect(of(events, "state:update-batch")).toEqual([]);
    // a new array instance: its rows (and their nodes) are new
    expect(labels(of(events, "state:binding-removed"))).toEqual(["textContent:items.*[0]", "textContent:items.*[1]"]);
    const added = of(events, "state:binding-added");
    expect(labels(added)).toEqual(["textContent:items.*[0]"]);
    expect(added[0].binding.node).toBe(root.querySelector("li")!.firstChild);
  });

  it("再セットで引き継いだ command トークンは 1 度だけ包まれ、新しい event トークンも包まれる。聞き手が無ければ何も送らない", async () => {
    const { el } = await page(``, { $commandTokens: ["go"], $eventTokens: ["done"] });
    let go: any;
    el.createState("readonly", (s: any) => { go = s.$command.go; });
    el.setInitialState({ $commandTokens: ["go"], $eventTokens: ["done"] });
    el.createState("readonly", (s: any) => { expect(s.$command.go).toBe(go); });
    // no DevTools attached: the wrapper only forwards
    const got: unknown[] = [];
    const off = go.subscribe((...a: unknown[]) => got.push(a));
    go.emit(0);
    expect(got).toEqual([[0]]);
    const events = listen();
    el.createState("readonly", (s: any) => { s.$command.go.emit(1); });
    // the event token the re-set made (what an element's eventToken binding emits)
    el.engine.events.get("done").emit("x");
    const e = of(events, "state:token-emit");
    expect(e.map((x) => [x.kind, x.tokenName, x.args])).toEqual([["command", "go", [1]], ["event", "done", ["x"]]]);
    expect(e[0].subscriberCount).toBe(1);
    expect(got).toEqual([[0], [1]]);
    off?.();
  });

  it("$connectedCallback を待つ間に付け外しされても、要素の登録は 1 回だけ", async () => {
    const events = listen();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let calls = 0;
    const h = document.createElement(`cov-devtools-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state><p>{{ n }}</p>`;
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState({ n: 1, $connectedCallback() { calls++; return calls === 1 ? gate : undefined; } });
    document.body.appendChild(h);
    await el.initializePromise;
    // disconnected and reconnected while the first $connectedCallback is still pending
    h.remove();
    document.body.appendChild(h);
    await flush();
    release();
    await el.connectedCallbackPromise;
    await flush();
    expect(calls).toBe(2);
    expect(of(events, "state:element-registered").filter((e) => e.rootNode === root)).toHaveLength(1);
    expect(source().getStateElements().filter((x: any) => x.rootNode === root)).toHaveLength(1);
    expect(labels(mine(of(events, "state:binding-added"), root))).toEqual(["textContent:n"]);
  });
});

describe("keyedSubscriptions", () => {
  it("$eqIndex の購読は lists に数え、ワイルドカードの源と読めない源の lastValue は undefined", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { root } = await page(
        `<ul><template data-wcs="for: items"><li data-wcs="class.cur: .cur; class.hit: .hit; class.sel: .sel"></li></template></ul>`,
        {
          cursor: 1, items: [{ id: 1 }, { id: 2 }],
          get "items.*.cur"() { return (this as any).$eqIndex("cursor"); },
          get "items.*.hit"() { return (this as any).$eqIndex("items.*.id"); },
          // a $eq source that is not in the state: the subscription is made before the read fails
          get "items.*.sel"() { return (this as any).$eq("missing", (this as any)["items.*.id"]); },
        },
      );
      expect(root.querySelectorAll("li")[1].classList.contains("cur")).toBe(true);
      const ks = source().keyedSubscriptions(root);
      const byPath = Object.fromEntries(ks.map((k: any) => [k.path, k]));
      expect(byPath.cursor).toEqual({ path: "cursor", tracked: false, rows: 0, keys: 0, lists: 1, lastValue: 1 });
      expect(byPath["items.*.id"]).toEqual({ path: "items.*.id", tracked: false, rows: 0, keys: 0, lists: 1, lastValue: undefined });
      expect(byPath.missing).toEqual({ path: "missing", tracked: false, rows: 2, keys: 2, lists: 0, lastValue: undefined });
    } finally {
      error.mockRestore();
    }
  });
});
