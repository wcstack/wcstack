import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, ssr } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([ssr]);
  bootstrapState();
});

/** Renders `html` as the server does (an orchestrated render, then the snapshot builder); its HTML. */
async function serverRender(html: string, state: Record<string, any>): Promise<string> {
  document.documentElement.setAttribute("data-wcs-server", "orchestrated");
  try {
    const h = document.createElement(`ssr-server-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = html;
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState(state);
    document.body.appendChild(h);
    await el.connectedCallbackPromise;
    await getBindingsReady(root);
    await flush();
    (globalThis as any)[Symbol.for("wcstack.ssr.snapshotBuilder")].build(root);
    const out = root.innerHTML;
    h.remove();
    return out;
  } finally {
    document.documentElement.removeAttribute("data-wcs-server");
  }
}

/** Loads the server's HTML in a page and hydrates it; `before` sees the page before the state loads. */
async function clientLoad(html: string, state: Record<string, any>, before?: (root: ShadowRoot) => void) {
  const h = document.createElement(`ssr-client-${seq++}`);
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
  return { root, el, write };
}

const page = `<wcs-state enable-ssr></wcs-state>
<h1>{{ title }}</h1>
<ul class="groups"><template data-wcs="for: groups"><li><b>{{ .name }}</b><ol><template data-wcs="for: .items"><li data-wcs="onclick: pick">{{ .label }}</li></template></ol></li></template></ul>
<template data-wcs="if: open"><p class="open">open {{ count }}</p></template><template data-wcs="else:"><p class="closed">closed</p></template>
<p class="picked">{{ picked }}</p>`;

const state = () => ({
  title: "T",
  open: false,
  count: 1,
  picked: "",
  groups: [{ name: "a", items: [{ label: "a1" }, { label: "a2" }] }, { name: "b", items: [{ label: "b1" }] }],
  pick(this: any, _e: Event, i: number, j: number) { this.picked = `${i}.${j}`; },
});

describe("SSR", () => {
  it("サーバの DOM をそのまま引き取り（入れ子の for・if/else を含む）、以後の変更とイベントが効く", async () => {
    const html = await serverRender(page, state());
    expect(html).toContain("<wcs-ssr");
    expect(html).toContain("a2");
    let serverNodes: Element[] = [];
    const { root, write } = await clientLoad(html, state(), (r) => { serverNodes = Array.from(r.querySelectorAll("ol > li, h1, p.closed")); });
    // the very nodes the server rendered
    expect(serverNodes.length).toBe(5);
    for (const n of serverNodes) expect(n.isConnected).toBe(true);
    const texts = () => Array.from(root.querySelectorAll("ol > li")).map((li) => li.textContent);
    expect(texts()).toEqual(["a1", "a2", "b1"]);
    expect(root.querySelector("h1")!.textContent).toBe("T");
    expect(root.querySelector("p.closed")).not.toBeNull();
    expect(root.innerHTML).not.toContain("wcs-[");
    expect(root.querySelector("wcs-ssr")).toBeNull();
    // events on adopted rows, with both indexes
    (root.querySelectorAll("ol > li")[2] as HTMLElement).click();
    await flush();
    expect(root.querySelector("p.picked")!.textContent).toBe("1.0");
    // writes after hydration
    await write((s) => { s["groups.0.items"] = s["groups.0.items"].concat({ label: "a3" }); s.title = "U"; s.open = true; });
    expect(texts()).toEqual(["a1", "a2", "a3", "b1"]);
    expect(root.querySelector("h1")!.textContent).toBe("U");
    expect(root.querySelector("p.open")!.textContent).toBe("open 1");
    expect(root.querySelector("p.closed")).toBeNull();
    await write((s) => { s["groups.1.items.0.label"] = "B1"; });
    expect(texts()).toEqual(["a1", "a2", "a3", "B1"]);
  });

  it("隣り合う文字と空の文字も、行の構造どおりに引き取る", async () => {
    const html = await serverRender(
      `<wcs-state enable-ssr></wcs-state><ul><template data-wcs="for: rows"><li>{{ .a }}{{ .b }}-{{ .c }}</li></template></ul><p>{{ x }}{{ y }}</p>`,
      { rows: [{ a: "", b: "B", c: "" }, { a: "A", b: "", c: "C" }], x: "", y: "Y" },
    );
    const { root, write } = await clientLoad(html, { rows: [], x: "", y: "" });
    const texts = () => Array.from(root.querySelectorAll("li")).map((li) => li.textContent);
    expect(texts()).toEqual(["B-", "A-C"]);
    expect(root.querySelector("p")!.textContent).toBe("Y");
    await write((s) => { s["rows.0.a"] = "a"; s["rows.0.c"] = "c"; s.x = "X"; });
    expect(texts()).toEqual(["aB-c", "A-C"]);
    expect(root.querySelector("p")!.textContent).toBe("XY");
  });

  it("$connectedCallback はサーバだけで走り、そこで得た値がクライアントに渡る", async () => {
    const calls: string[] = [];
    const src = () => ({
      items: [] as string[],
      $connectedCallback(this: any) { calls.push("connected"); this.items = ["loaded on the server"]; },
    });
    const html = await serverRender(`<wcs-state enable-ssr></wcs-state><ul><template data-wcs="for: items"><li>{{ . }}</li></template></ul>`, src());
    expect(calls).toEqual(["connected"]);
    const { root } = await clientLoad(html, src());
    expect(calls).toEqual(["connected"]);
    expect(Array.from(root.querySelectorAll("li")).map((li) => li.textContent)).toEqual(["loaded on the server"]);
  });

  it("版（major.minor）が違えばサーバの DOM を捨て、クライアントで描き直す", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const html = (await serverRender(page, state())).replace(/<wcs-ssr version="[^"]*"/, '<wcs-ssr version="99.0.0"');
    let serverLi: Element | null = null;
    const { root } = await clientLoad(html, state(), (r) => { serverLi = r.querySelector("ol > li"); });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('version="99.0.0"'));
    expect(serverLi!.isConnected).toBe(false);
    expect(Array.from(root.querySelectorAll("ol > li")).map((li) => li.textContent)).toEqual(["a1", "a2", "b1"]);
    warn.mockRestore();
  });

  it("クライアントの状態と行の数が食い違っても、クライアントの状態どおりに描く", async () => {
    const html = await serverRender(`<wcs-state enable-ssr></wcs-state><ul><template data-wcs="for: rows"><li>{{ . }}</li></template></ul>`, { rows: ["a", "b", "c"] });
    const fewer = html.replace(/<script type="application\/json">[^<]*<\/script>/, '<script type="application/json">{"rows":["a"]}</script>');
    const { root } = await clientLoad(fewer, { rows: [] });
    expect(Array.from(root.querySelectorAll("li")).map((li) => li.textContent)).toEqual(["a"]);
    const more = html.replace(/<script type="application\/json">[^<]*<\/script>/, '<script type="application/json">{"rows":["a","b","c","d"]}</script>');
    const second = await clientLoad(more, { rows: [] });
    expect(Array.from(second.root.querySelectorAll("li")).map((li) => li.textContent)).toEqual(["a", "b", "c", "d"]);
  });

  it("サーバでは $stream を始めず（initial のまま）、クライアントで始める", async () => {
    const { temporal } = await import("../src/index");
    installFeatures([temporal]);
    const src = () => ({
      $stream: { tick: { initial: 0, async *source() { yield 5; } } },
    });
    const html = await serverRender(`<wcs-state enable-ssr></wcs-state><p>{{ tick }}</p>`, src());
    expect(html).toMatch(/<p><!--wcs-t:tick-->0<!--wcs-\/t--><\/p>/);
    const { root } = await clientLoad(html, src());
    await flush();
    expect(root.querySelector("p")!.textContent).toBe("5");
  });
});
