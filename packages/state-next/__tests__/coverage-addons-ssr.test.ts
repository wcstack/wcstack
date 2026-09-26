import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, ssr } from "../src/index";
import { installBuilder } from "../src/ssr/ssr";

const flush = () => new Promise((r) => setTimeout(r, 0));
const BUILDER = Symbol.for("wcstack.ssr.snapshotBuilder");
const IMPL = Symbol.for("wcstack.state.ssr.impl");
let seq = 0;

let definedBefore: unknown = "unset";
beforeAll(() => {
  // <wcs-state> is defined first: installing the add-on afterwards defines <wcs-ssr> in that registry too
  bootstrapState();
  definedBefore = customElements.get("wcs-ssr");
  installFeatures([ssr]);
});

const builder = (): any => (globalThis as any)[BUILDER];

/** Renders `html` as the server does (an orchestrated render, then the snapshot builder); its HTML. */
async function serverRender(html: string, state: Record<string, any>, before?: (root: ShadowRoot) => void): Promise<string> {
  document.documentElement.setAttribute("data-wcs-server", "orchestrated");
  try {
    const h = document.createElement(`cov-ssr-server-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = html;
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState(state);
    document.body.appendChild(h);
    await el.connectedCallbackPromise;
    await getBindingsReady(root);
    await flush();
    before?.(root);
    builder().build(root);
    const out = root.innerHTML;
    h.remove();
    return out;
  } finally {
    document.documentElement.removeAttribute("data-wcs-server");
  }
}

/** Loads the server's HTML in a page and hydrates it; `before` sees the page before the state loads. */
async function clientLoad(html: string, state: Record<string, any>, before?: (root: ShadowRoot) => void) {
  const h = document.createElement(`cov-ssr-client-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = html;
  before?.(root);
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

/** The snapshot's JSON replaced (escaped as the server does). */
const withData = (html: string, data: unknown) => {
  const json = JSON.stringify(data).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return html.replace(/<script type="application\/json">[^<]*<\/script>/, () => `<script type="application/json">${json}</script>`);
};

const texts = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll(selector)).map((n) => n.textContent);

const page = `<wcs-state enable-ssr></wcs-state>`
  + `<dl><template data-wcs="for: groups"><dt>{{ .name }}</dt><template data-wcs="for: .items"><dd>{{ .label }}</dd></template></template></dl>`
  + `<template data-wcs="if: open"><p class="open">open</p></template><template data-wcs="else:"><p class="closed">closed</p></template>`
  + `<template data-wcs="if: never"><b class="never">never</b></template>`
  + `<ul><template data-wcs="for: groups"><li>{{ .name }}</li></template></ul>`
  + `<p class="text">{{ text }}</p><p class="count">{{ count }}</p>`;

const TEXT = "</script><b>&\u2028\u2029";

const state = (calls: string[] = []) => ({
  open: true,
  never: false,
  text: TEXT,
  groups: [{ name: "a", items: [{ label: "a1" }, { label: "a2" }] }, { name: "b", items: [] as { label: string }[] }],
  tags: ["x", "y", "z"],
  get count() { return (this as any).$getAll("tags.*", []).length; },
  $connectedCallback() { calls.push("connected"); },
  $disconnectedCallback() { calls.push("disconnected"); },
});

describe("SSR の add-on の導入", () => {
  it("<wcs-state> の定義の後に入れても、その registry に <wcs-ssr> を定義する", () => {
    expect(definedBefore).toBeUndefined();
    expect(customElements.get("wcs-ssr")).toBeDefined();
  });
});

describe("サーバのスナップショット", () => {
  it("複数ノードの行と行の直下の入れ子の for、if の枝、同じリストの 2 つ目の for をそのまま引き取る", async () => {
    const calls: string[] = [];
    const html = await serverRender(page, state(calls));
    // (the server's page is removed after the render)
    expect(calls).toEqual(["connected", "disconnected"]);
    calls.length = 0;
    // the state's data, script-safe (no <, >, &, U+2028, U+2029 in the JSON)
    const json = /<script type="application\/json">([^<]*)<\/script>/.exec(html)![1];
    expect(json).toContain("\\u003c/script\\u003e\\u003cb\\u003e\\u0026\\u2028\\u2029");
    expect(JSON.parse(json).text).toBe(TEXT);
    // a nested region sits inside its row's region; an if with nothing rendered has no region
    expect(html).toContain("<!--wcs-|--><dt>b</dt><!--wcs-for--><!--wcs-[--><!--wcs-]-->");
    expect(html).toContain("<!--wcs-[:0--><p class=\"open\">open</p><!--wcs-]-->");
    expect(html).not.toContain("class=\"never\">never</b><!--wcs-]");

    let server: Node[] = [];
    const { h, root, write } = await clientLoad(html, state(calls), (r) => {
      server = Array.from(r.querySelectorAll("dt, dd, li, p.open"));
    });
    // the server's very nodes, bound
    expect(server).toHaveLength(7);
    for (const n of server) expect(n.isConnected).toBe(true);
    expect(texts(root, "dt")).toEqual(["a", "b"]);
    expect(texts(root, "dd")).toEqual(["a1", "a2"]);
    expect(texts(root, "li")).toEqual(["a", "b"]);
    expect(root.querySelector("p.open")).not.toBeNull();
    expect(root.querySelector("p.closed")).toBeNull();
    expect(root.querySelector("b.never")).toBeNull();
    expect(root.querySelector("p.text")!.textContent).toBe(TEXT);
    expect(root.querySelector("p.count")!.textContent).toBe("3");
    expect(root.innerHTML).not.toContain("wcs-[");
    expect(root.innerHTML).not.toContain("wcs-p:");
    // $connectedCallback ran on the server only
    expect(calls).toEqual([]);

    await write((s) => {
      s["groups.1.items"] = [{ label: "b1" }];
      s["groups.0.name"] = "A";
      s.open = false;
      s.never = true;
    });
    expect(texts(root, "dt")).toEqual(["A", "b"]);
    expect(texts(root, "dd")).toEqual(["a1", "a2", "b1"]);
    expect(texts(root, "li")).toEqual(["A", "b"]);
    expect(root.querySelector("p.closed")).not.toBeNull();
    expect(root.querySelector("b.never")).not.toBeNull();
    // the other hooks still run on the client
    h.remove();
    expect(calls).toEqual(["disconnected"]);
  });

  it("描いた後にページから外れた錨はスナップショットに入れない", async () => {
    const html = await serverRender(
      `<wcs-state enable-ssr></wcs-state><div class="gone"><template data-wcs="for: xs"><i>{{ . }}</i></template></div><ul><template data-wcs="for: xs"><li>{{ . }}</li></template></ul>`,
      { xs: [1, 2] },
      (root) => root.querySelector("div.gone")!.remove(),
    );
    expect(html.match(/<template id=/g)).toHaveLength(1);
    expect(html).toContain("<li>1</li>");
    expect(html).not.toContain("<i>");
    const { root } = await clientLoad(html, { xs: [] });
    expect(texts(root, "li")).toEqual(["1", "2"]);
  });

  it("スナップショットの作り直しはせず、ルートでない状態・始まっていない状態は飛ばす", async () => {
    document.documentElement.setAttribute("data-wcs-server", "orchestrated");
    const h = document.createElement(`cov-ssr-server-${seq++}`);
    try {
      const root = h.attachShadow({ mode: "open" });
      root.innerHTML = `<wcs-state enable-ssr></wcs-state><p>{{ n }}</p>`;
      const el = root.querySelector("wcs-state") as any;
      el.setInitialState({ n: 1 });
      document.body.appendChild(h);
      await el.connectedCallbackPromise;
      builder().build(root);
      builder().build(root);
      expect(root.querySelectorAll("wcs-ssr")).toHaveLength(1);
      // a volume, a component's state, and one that never started (no engine): no snapshot
      const other = document.createElement("div");
      other.innerHTML = `<wcs-state enable-ssr mount="a"></wcs-state><wcs-state enable-ssr bind-component="s"></wcs-state><wcs-state enable-ssr></wcs-state>`;
      builder().build(other);
      expect(other.querySelectorAll("wcs-ssr")).toHaveLength(0);
      expect(other.children).toHaveLength(3);
    } finally {
      h.remove();
      document.documentElement.removeAttribute("data-wcs-server");
    }
  });

  it("reset はテンプレートの id の連番を 0 に戻す", async () => {
    const src = `<wcs-state enable-ssr></wcs-state><ul><template data-wcs="for: xs"><li>{{ . }}</li></template></ul>`;
    await serverRender(src, { xs: [1] });
    const before = /<template id="wcs-t(\d+)"/.exec(await serverRender(src, { xs: [1] }))![1];
    expect(Number(before)).toBeGreaterThan(0);
    builder().reset();
    expect(await serverRender(src, { xs: [1] })).toContain('<template id="wcs-t0"');
  });

  it("別のエンジンのビルダーがあれば置き換えず、実装だけを最新にする", () => {
    const g = globalThis as any;
    const ours = g[BUILDER];
    const foreign = { protocol: "wcs-ssr-snapshot", version: 1, build: vi.fn(), reset: vi.fn() };
    g[BUILDER] = foreign;
    try {
      installBuilder();
      expect(g[BUILDER]).toBe(foreign);
      expect(typeof g[IMPL].build).toBe("function");
      expect(typeof g[IMPL].reset).toBe("function");
    } finally {
      g[BUILDER] = ours;
    }
  });

  it("document 直下の <wcs-state enable-ssr> も描き、引き取る", async () => {
    const src = `<wcs-state enable-ssr></wcs-state><p class="doc">{{ msg }}</p><ul class="doc"><template data-wcs="for: xs"><li>{{ . }}</li></template></ul>`;
    document.documentElement.setAttribute("data-wcs-server", "orchestrated");
    const server = document.createElement("div");
    let html: string;
    try {
      server.innerHTML = src;
      document.body.appendChild(server);
      const el = server.querySelector("wcs-state") as any;
      el.setInitialState({ msg: "hi", xs: ["a", "b"] });
      await el.connectedCallbackPromise;
      await flush();
      builder().build(document);
      html = server.innerHTML;
    } finally {
      server.remove();
      document.documentElement.removeAttribute("data-wcs-server");
    }
    expect(html).toContain("<wcs-ssr");
    expect(html).toContain("<!--wcs-t:msg-->hi<!--wcs-/t-->");
    const client = document.createElement("div");
    client.innerHTML = html;
    const serverLi = Array.from(client.querySelectorAll("li"));
    try {
      const el = client.querySelector("wcs-state") as any;
      el.setInitialState({ msg: "", xs: [] });
      document.body.appendChild(client);
      await el.connectedCallbackPromise;
      await flush();
      expect(client.querySelector("p.doc")!.textContent).toBe("hi");
      expect(texts(client, "li")).toEqual(["a", "b"]);
      for (const li of serverLi) expect(li.isConnected).toBe(true);
      expect(client.querySelector("wcs-ssr")).toBeNull();
      el.createState("writable", (s: any) => { s.msg = "bye"; });
      await flush();
      expect(client.querySelector("p.doc")!.textContent).toBe("bye");
    } finally {
      client.remove();
    }
  });
});

describe("クライアントでの引き取り", () => {
  it("スナップショットの無い enable-ssr のルートはクライアントで描き、$connectedCallback は走らせない", async () => {
    const calls: string[] = [];
    const first = await clientLoad(`<wcs-state enable-ssr></wcs-state><p>{{ n }}</p>`, { n: 1, $connectedCallback() { calls.push("a"); } });
    expect(first.root.querySelector("p")!.textContent).toBe("1");
    const second = await clientLoad(`<div></div><wcs-state enable-ssr></wcs-state><p>{{ n }}</p>`, { n: 2, $connectedCallback() { calls.push("b"); } });
    expect(second.root.querySelector("p")!.textContent).toBe("2");
    expect(calls).toEqual([]);
  });

  it("クライアントの状態の getter・メソッドはスナップショットの値で上書きしない", async () => {
    const html = await serverRender(`<wcs-state enable-ssr></wcs-state><p class="t">{{ title }}</p><p class="n">{{ n }}</p>`, { title: "S", n: 5, label: "x" });
    const { root, el } = await clientLoad(html, {
      n: 0,
      get title() { return "C"; },
      label() { return "method"; },
    });
    expect(root.querySelector("p.t")!.textContent).toBe("C");
    expect(root.querySelector("p.n")!.textContent).toBe("5");
    el.createState("readonly", (s: any) => { expect(s.label()).toBe("method"); });
  });

  it("データの <script> が無い・空のスナップショットではクライアントの状態のまま引き取る", async () => {
    const html = await serverRender(`<wcs-state enable-ssr></wcs-state><ul><template data-wcs="for: xs"><li>{{ . }}</li></template></ul>`, { xs: ["a", "b"] });
    let server: Element[] = [];
    const none = await clientLoad(html.replace(/<script type="application\/json">[^<]*<\/script>/, ""), { xs: ["a", "b"] }, (r) => {
      server = Array.from(r.querySelectorAll("li"));
    });
    expect(texts(none.root, "li")).toEqual(["a", "b"]);
    for (const li of server) expect(li.isConnected).toBe(true);
    const empty = await clientLoad(html.replace(/(<script type="application\/json">)[^<]*(<\/script>)/, "$1$2"), { xs: ["c"] });
    expect(texts(empty.root, "li")).toEqual(["c"]);
  });

  it("スナップショットにテンプレートが無ければその目印は残し、ほかは引き取る", async () => {
    const html = await serverRender(
      `<wcs-state enable-ssr></wcs-state><ul><template data-wcs="for: xs"><li>{{ . }}</li></template></ul><p>{{ title }}</p>`,
      { xs: ["a"], title: "T" },
    );
    const broken = html.replace(/<template id="wcs-t\d+"[^>]*>.*?<\/template>/, "");
    const { root, write } = await clientLoad(broken, { xs: [], title: "" });
    expect(root.querySelector("ul")!.innerHTML).toMatch(/^<!--wcs-p:wcs-t\d+-->$/);
    expect(root.querySelector("li")).toBeNull();
    expect(root.querySelector("p")!.textContent).toBe("T");
    await write((s) => { s.title = "U"; });
    expect(root.querySelector("p")!.textContent).toBe("U");
  });

  it("サーバと違う枝・形の合わない行・空だったリストの行は、サーバのノードを捨ててクライアントで作る", async () => {
    const html = await serverRender(page, state());
    const data = { ...JSON.parse(/<script type="application\/json">([^<]*)<\/script>/.exec(html)![1]) };
    // the client's data differs: the other branch, and a row in the list the server rendered empty
    data.open = false;
    data.groups = [{ name: "a", items: [{ label: "a1" }, { label: "a2" }] }, { name: "b", items: [{ label: "b1" }] }];
    // a single-node row with an extra node, and a two-node row missing its first node
    const tampered = withData(html, data)
      .replace("<!--wcs-|--><li>b</li>", "<!--wcs-|--><li>b</li><li>junk</li>")
      .replace("<!--wcs-|--><dt>a</dt>", "<!--wcs-|-->");
    let serverOpen: Element | null = null;
    let junk: Element | null = null;
    const { root } = await clientLoad(tampered, state(), (r) => {
      serverOpen = r.querySelector("p.open");
      junk = Array.from(r.querySelectorAll("li")).find((li) => li.textContent === "junk") ?? null;
    });
    expect(serverOpen!.isConnected).toBe(false);
    expect(junk!.isConnected).toBe(false);
    expect(root.querySelector("p.closed")).not.toBeNull();
    expect(texts(root, "li")).toEqual(["a", "b"]);
    expect(texts(root, "dt")).toEqual(["a", "b"]);
    expect(texts(root, "dd")).toEqual(["a1", "a2", "b1"]);
    expect(root.innerHTML).not.toContain("junk");
  });
});
