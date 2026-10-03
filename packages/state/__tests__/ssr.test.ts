import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, ssr } from "../src/index";
import { VERSION } from "../src/version";

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
    expect(warn).toHaveBeenCalledWith(`[@wcstack/state] <wcs-ssr version="99.0.0"> does not match ${VERSION}: its snapshot is discarded, and the page renders on the client from its own state.`);
    expect(serverLi!.isConnected).toBe(false);
    expect(Array.from(root.querySelectorAll("ol > li")).map((li) => li.textContent)).toEqual(["a1", "a2", "b1"]);
    warn.mockRestore();
  });

  it("版が違えばスナップショットも捨てる: 状態は自分のソースから読み、$connectedCallback がクライアントで走る", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls: string[] = [];
    const src = (where: string) => ({
      items: [] as string[],
      $connectedCallback(this: any) { calls.push(where); this.items = [where]; },
    });
    const html = (await serverRender(`<wcs-state enable-ssr></wcs-state><ul><template data-wcs="for: items"><li>{{ . }}</li></template></ul>`, src("server")))
      .replace(/<wcs-ssr version="[^"]*"/, '<wcs-ssr version="99.0.0"');
    expect(html).toContain('["server"]');
    const { root } = await clientLoad(html, src("client"));
    expect(calls).toEqual(["server", "client"]);
    expect(Array.from(root.querySelectorAll("li")).map((li) => li.textContent)).toEqual(["client"]);
    expect(warn).toHaveBeenCalledTimes(1);
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

describe("SSR のフォームの値（3.x と同じく HTML に書く）", () => {
  const formPage = `<wcs-state enable-ssr></wcs-state>
<input class="name" data-wcs="value: name">
<input class="agreed" type="checkbox" checked data-wcs="checked: agreed">
<input class="news" type="checkbox" data-wcs="checked: news">
<select class="idx" data-wcs="selectedIndex: idx"><option>A</option><option>B</option><option>C</option></select>
<select class="color" data-wcs="value: color"><template data-wcs="for: colors"><option data-wcs="value: .; textContent: ."></option></template></select>
<textarea class="memo" data-wcs="value: memo"></textarea>
<ul><template data-wcs="for: todos"><li><input type="checkbox" data-wcs="checked: .done"><input class="t" data-wcs="value: .t"></li></template></ul>
<input class="r1" type="radio" name="size" value="s" checked data-wcs="radio: size"><input class="r2" type="radio" name="size" value="m" data-wcs="radio: size">`;

  const formState = () => ({
    name: "Alice", agreed: false, news: true, idx: 2, color: "green", colors: ["red", "green", "blue"],
    memo: "Hello </textarea> & World", todos: [{ done: true, t: "a" }, { done: false, t: "b" }], size: "m",
  });

  it("value / checked / selectedIndex / select の value / textarea / 行の中 / radio: の値がサーバの HTML に入る", async () => {
    const html = await serverRender(formPage, formState());
    // what a browser parses out of the server's HTML, before any script runs
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
    const q = (sel: string) => doc.querySelector(sel) as any;
    expect(q("input.name").getAttribute("value")).toBe("Alice");
    expect(q("input.agreed").hasAttribute("checked")).toBe(false);
    expect(q("input.news").hasAttribute("checked")).toBe(true);
    expect(Array.from(doc.querySelectorAll("select.idx option"), (o) => o.hasAttribute("selected"))).toEqual([false, false, true]);
    expect(Array.from(doc.querySelectorAll("select.color option"), (o) => o.hasAttribute("selected"))).toEqual([false, true, false]);
    expect(q("textarea.memo").textContent).toBe("Hello </textarea> & World");
    expect(Array.from(doc.querySelectorAll("li input[type=checkbox]"), (i) => i.hasAttribute("checked"))).toEqual([true, false]);
    expect(Array.from(doc.querySelectorAll("li input.t"), (i) => i.getAttribute("value"))).toEqual(["a", "b"]);
    expect([q("input.r1").hasAttribute("checked"), q("input.r2").hasAttribute("checked")]).toEqual([false, true]);
  });

  it("ハイドレーションはサーバのフォーム要素を引き取り、以後の書き込みに従う", async () => {
    const html = await serverRender(formPage, formState());
    let serverInputs: Element[] = [];
    const { root, write } = await clientLoad(html, formState(), (r) => { serverInputs = Array.from(r.querySelectorAll("input, select, textarea")); });
    for (const n of serverInputs) expect(n.isConnected).toBe(true);
    const q = (sel: string) => root.querySelector(sel) as any;
    expect(q("input.name").value).toBe("Alice");
    expect(q("input.agreed").checked).toBe(false);
    expect(q("input.news").checked).toBe(true);
    expect(q("select.idx").selectedIndex).toBe(2);
    expect(q("select.color").value).toBe("green");
    expect(q("textarea.memo").value).toBe("Hello </textarea> & World");
    expect(q("input.r2").checked).toBe(true);
    await write((s) => {
      s.name = "Bob"; s.agreed = true; s.news = false; s.idx = 0; s.color = "blue"; s.memo = "next";
      s["todos.1.done"] = true; s.size = "s";
    });
    expect(q("input.name").value).toBe("Bob");
    expect(q("input.agreed").checked).toBe(true);
    expect(q("input.news").checked).toBe(false);
    expect(q("select.idx").selectedIndex).toBe(0);
    expect(q("select.color").value).toBe("blue");
    expect(q("textarea.memo").value).toBe("next");
    expect(Array.from(root.querySelectorAll("li input[type=checkbox]"), (i: any) => i.checked)).toEqual([true, true]);
    expect(q("input.r1").checked).toBe(true);
  });

  it("サーバが変えていないフォーム要素の HTML は変えず、{{ を含む textarea の値はクライアントに任せる", async () => {
    const html = await serverRender(
      `<wcs-state enable-ssr></wcs-state><input class="plain" name="q"><input class="same" value="x" data-wcs="value: same"><select class="plain"><option disabled>-</option><option>A</option><option>B</option></select><textarea class="tpl" data-wcs="value: tpl"></textarea>`,
      { same: "x", tpl: "{{ secret }}" },
    );
    expect(html).toContain(`<input class="plain" name="q">`);
    expect(html).toContain(`<input class="same" value="x" data-wcs="value: same">`);
    expect(html).toContain(`<select class="plain"><option disabled="">-</option><option>A</option><option>B</option></select>`);
    expect(html).toContain(`<textarea class="tpl" data-wcs="value: tpl"></textarea>`);
    const { root } = await clientLoad(html, { same: "x", tpl: "{{ secret }}" });
    expect((root.querySelector("textarea") as HTMLTextAreaElement).value).toBe("{{ secret }}");
  });

  it("複数選択の select は最初の option だけの選択も書き、mustache を持つ textarea の中身はクライアントが戻す", async () => {
    const state = () => ({ first: "a", t: "T", v: "V" });
    const html = await serverRender(
      `<wcs-state enable-ssr></wcs-state><select multiple data-wcs="value: first"><option value="a">A</option><option value="b">B</option></select><textarea data-wcs="value: v">{{ t }}</textarea>`,
      state(),
    );
    expect(html).toContain(`<option value="a" selected="">A</option><option value="b">B</option>`);
    expect(html).toContain(`data-wcs-raw="{{ t }}"`);
    const { root } = await clientLoad(html, state());
    expect((root.querySelector("textarea") as HTMLTextAreaElement).value).toBe("V");
    expect((root.querySelector("select") as HTMLSelectElement).selectedOptions.length).toBe(1);
  });

  it("<wcs-state> の無い文書のフォーム要素には触れない", () => {
    const h = document.createElement(`ssr-plain-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<input>`;
    (root.querySelector("input") as HTMLInputElement).value = "typed";
    (globalThis as any)[Symbol.for("wcstack.ssr.snapshotBuilder")].build(root);
    expect(root.innerHTML).toBe("<input>");
  });
});
