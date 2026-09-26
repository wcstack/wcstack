import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, devtools, listKeys, temporal } from "../src/index";
import { registerSource } from "../src/devtools/devtools";

const flush = () => new Promise((r) => setTimeout(r, 0));
const HOOK = "__WCSTACK_DEVTOOLS_HOOK__";
let seq = 0;

beforeAll(() => {
  installFeatures([temporal, listKeys, devtools]);
  bootstrapState();
});

const registry = (): any => (globalThis as any)[HOOK];
const source = (): any => [...registry().sources.values()][0];

/** Attaches a listener; the events it receives, as `[sourceId, event]`. */
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
  const h = document.createElement(`devtools-test-${seq++}`);
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
const paths = (events: any[]) => events.map((e) => `${e.binding.propName}:${e.binding.statePathName}${e.absoluteAddress.listIndex === null ? "" : `[${e.absoluteAddress.listIndex.indexes}]`}`);

describe("DevTools フックプロトコル v2", () => {
  it("レジストリは v2、ソースは kind=state で 1 つだけ登録される（キーは縮められない）", () => {
    expect(registry().version).toBe(2);
    expect(registry().sources.size).toBe(1);
    const s = source();
    expect(s.kind).toBe("state");
    expect(typeof s.packageVersion).toBe("string");
    for (const k of ["getStateElements", "overlays", "keyedSubscriptions", "keys", "read", "write", "_setSink"]) expect(typeof s[k]).toBe("function");
    expect(s.overlays()).toEqual([]);
  });

  it("要素の一覧・キー・読み・書きを引ける", async () => {
    const { root, el } = await page(`<p>{{ user.name }}</p><ul><template data-wcs="for: items"><li>{{ .v }}</li></template></ul>`, {
      user: { name: "a" }, items: [{ v: 1 }, { v: 2 }], n: 1,
      get double() { return this.n * 2; },
      get "items.*.w"() { return 0; },
      inc() {},
      $commandTokens: ["go"], $eventTokens: ["done"], $watch: { n() {} }, $listKeys: { items: "v" },
    });
    const s = source();
    const sum = s.getStateElements().find((x: any) => x.rootNode === root);
    expect(sum.element).toBe(el);
    expect([...sum.paths.list]).toContain("items");
    expect([...sum.paths.element]).toContain("items.*");
    expect([...sum.paths.getter]).toEqual(expect.arrayContaining(["double", "items.*.w"]));
    expect([...sum.commandTokenNames]).toEqual(["go"]);
    expect([...sum.eventTokenNames]).toEqual(["done"]);
    expect([...sum.watchPaths]).toEqual(["n"]);
    expect([...sum.keyedListPaths]).toEqual(["items"]);
    expect(s.keys(root)).toEqual(["user", "items", "n", "double"]);
    expect(s.read(root, "items.*.v", [1])).toBe(2);
    s.write(root, "user.name", "b");
    await flush();
    expect(root.querySelector("p")!.textContent).toBe("b");
    expect(() => s.keys(document.createElement("div"))).toThrow("no state tree on this root");
  });

  it("後から付いた DevTools は、そこにあるバインディングを遅延スロットも含めて binding-added で受け取る", async () => {
    const { root } = await page(`<p>{{ title }}</p><ul><template data-wcs="for: items"><li data-wcs="class.on: .on">{{ .v }}</li></template></ul>`, {
      title: "t", items: [{ v: 1, on: true }, { v: 2, on: false }],
    });
    const events = listen();
    await flush();
    const added = of(events, "state:binding-added").filter((e) => e.absoluteAddress.absolutePathInfo.stateElement.getRootNode() === root);
    expect(paths(added).sort()).toEqual([
      "class.on:items.*.on[0]", "class.on:items.*.on[1]", "for:items", "textContent:items.*.v[0]", "textContent:items.*.v[1]", "textContent:title",
    ].sort());
    const text = added.find((e) => e.binding.statePathName === "title");
    expect(text.binding.node.nodeType).toBe(Node.TEXT_NODE);
  });

  it("書き込みは write と update-batch、行の増減は binding-added / binding-removed になる", async () => {
    const a = { v: 1 };
    const { write } = await page(`<ul><template data-wcs="for: items"><li>{{ .v }}</li></template></ul>`, { items: [a] });
    const events = listen();
    await flush();
    events.length = 0;
    await write((s) => { s.items = [a, { v: 2 }]; });
    const w = of(events, "state:write");
    expect(w).toHaveLength(1);
    expect(w[0].absoluteAddress.absolutePathInfo.pathInfo.path).toBe("items");
    expect(w[0].hasOldValue).toBe(true);
    expect(w[0].value).toHaveLength(2);
    expect(of(events, "state:update-batch")).toHaveLength(1);
    expect(paths(of(events, "state:binding-added"))).toEqual(["textContent:items.*.v[1]"]);
    events.length = 0;
    await write((s) => { s.items = [a]; });
    expect(paths(of(events, "state:binding-removed"))).toEqual(["textContent:items.*.v[1]"]);
    expect(of(events, "state:binding-added")).toEqual([]);
  });

  it("行の中の書き込みは行の添字を持ち、派生した無効化は write にならず batch にだけ入る", async () => {
    const { write } = await page(`<ul><template data-wcs="for: items"><li>{{ .v }}</li></template></ul><p>{{ total }}</p>`, {
      items: [{ v: 1 }, { v: 2 }],
      get total() { return this.items.reduce((a: number, x: any) => a + x.v, 0); },
      bump(this: any) { this["items.*.v"] = 5; },
    });
    const events = listen();
    await flush();
    events.length = 0;
    await write((s) => { s.$resolve("items.*.v", [1], 7); });
    const w = of(events, "state:write");
    expect(w).toHaveLength(1);
    expect(w[0].absoluteAddress.listIndex.indexes).toEqual([1]);
    expect(w[0].oldValue).toBe(2);
    const batch = [...of(events, "state:update-batch")[0].addresses].map((a: any) => a.absolutePathInfo.pathInfo.path);
    expect(batch).toContain("items.*.v");
  });

  it("command / event トークンの発火は token-emit になる", async () => {
    const { el } = await page(``, { $commandTokens: ["go"], $eventTokens: ["done"] });
    const events = listen();
    el.createState("readonly", (s: any) => {
      s.$command.go.emit(1, 2);
    });
    const e = of(events, "state:token-emit");
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ kind: "command", tokenName: "go", args: [1, 2], subscriberCount: 0, stateElement: el });
  });

  it("要素の接続・切断は element-registered / element-unregistered になり、切断でバインディングは消える", async () => {
    const events = listen();
    const { h, root, el } = await page(`<p>{{ n }}</p>`, { n: 1 });
    expect(of(events, "state:element-registered").map((e) => e.element)).toContain(el);
    await flush();
    events.length = 0;
    h.remove();
    await flush();
    expect(of(events, "state:element-unregistered").map((e) => e.rootNode)).toEqual([root]);
    expect(paths(of(events, "state:binding-removed"))).toEqual(["textContent:n"]);
    expect(source().getStateElements().some((x: any) => x.rootNode === root)).toBe(false);
  });

  it("適用に失敗したバインディングは binding-apply-error になる", async () => {
    const tag = `devtools-throw-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      set val(v: number) { if (v === 2) throw new Error("no 2"); }
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { write } = await page(`<${tag} data-wcs="val: n"></${tag}>`, { n: 1 });
      const events = listen();
      await write((s) => { s.n = 2; });
      const e = of(events, "state:binding-apply-error");
      expect(e).toHaveLength(1);
      expect(e[0]).toMatchObject({ path: "n", bindingType: "prop" });
      expect(e[0].error.message).toBe("no 2");
    } finally {
      error.mockRestore();
    }
  });

  it("$eq の購読は keyedSubscriptions に数えられる", async () => {
    const { root } = await page(`<ul><template data-wcs="for: items"><li data-wcs="class.sel: .sel"></li></template></ul>`, {
      selected: 1, items: [{ id: 1 }, { id: 2 }, { id: 3 }],
      get "items.*.sel"() { return this.$eq("selected", this["items.*.id"]); },
    });
    const ks = source().keyedSubscriptions(root);
    expect(ks).toEqual([{ path: "selected", tracked: false, rows: 3, keys: 3, lists: 0, lastValue: 1 }]);
  });

  it("聞き手が外れるとシンクも外れ、付け直すと今のバインディングを受け取り直す", async () => {
    const events = listen();
    detach!();
    detach = null;
    const { root, write } = await page(`<p>{{ n }}</p>`, { n: 1 });
    await write((x) => { x.n = 2; });
    expect(events).toEqual([]);
    const again = listen();
    await flush();
    const mine = of(again, "state:binding-added").filter((e) => e.binding.node.getRootNode() === root);
    expect(paths(mine)).toEqual(["textContent:n"]);
  });

  it("別の版のレジストリが先にあれば警告して、それに登録する", () => {
    const saved = registry();
    const register = vi.fn();
    (globalThis as any)[HOOK] = { version: 3, register };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      registerSource();
      expect(warn.mock.calls[0][0]).toContain("devtools hook registry version 3, expected 2");
      expect(register).toHaveBeenCalledTimes(1);
      expect(register.mock.calls[0][0].kind).toBe("state");
    } finally {
      warn.mockRestore();
      (globalThis as any)[HOOK] = saved;
    }
  });
});
