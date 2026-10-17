import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, ssr } from "../src/index";

// <wcs-link>（@wcstack/router）の振る舞いを写した要素: 自分の直後に <a> を描いて子をそこへ移す。
// サーバーでは 1 microtask 後に描き（パーサが子を入れ終えるのを待つ）、目印 data-wcs-ssr-link を付ける。
// クライアントでは直後の目印付き <a> を自分のものとして引き取り、目印を外す。切断されると <a> を取り除く。

const flush = () => new Promise((r) => setTimeout(r, 0));
const server = () => document.documentElement.hasAttribute("data-wcs-server");
let seq = 0;
/** false の間、クライアントでは要素が未定義のふり（state の後に定義される順序） */
let linksReady = true;

class FakeLink extends HTMLElement {
  static observedAttributes = ["to"];
  kids: Node[] | null = null;
  anchorElement: HTMLAnchorElement | null = null;
  connectedCallback() {
    if (server()) queueMicrotask(() => { if (this.isConnected) this.render(); });
    else if (linksReady) this.render();
  }
  render() {
    this.kids ??= Array.from(this.childNodes);
    const next = this.nextElementSibling;
    if (!server() && next?.localName === "a" && next.hasAttribute("data-wcs-ssr-link")) {
      next.removeAttribute("data-wcs-ssr-link");
      this.kids = Array.from(next.childNodes);
      this.anchorElement = next as HTMLAnchorElement;
      return;
    }
    const a = document.createElement("a");
    a.setAttribute("href", this.getAttribute("to") ?? "");
    a.append(...this.kids);
    this.after(a);
    this.anchorElement = a;
    if (server()) a.setAttribute("data-wcs-ssr-link", "");
  }
  disconnectedCallback() {
    const a = this.anchorElement;
    if (a === null) return;
    a.remove();
    for (const k of this.kids!) if (k.parentNode === a) a.removeChild(k);
    this.anchorElement = null;
  }
  attributeChangedCallback(_n: string, _o: string | null, v: string | null) {
    this.anchorElement?.setAttribute("href", v ?? "");
  }
}

beforeAll(() => {
  installFeatures([ssr]);
  bootstrapState();
  customElements.define("fake-link", FakeLink);
});

async function serverRender(html: string, state: Record<string, any>): Promise<string> {
  document.documentElement.setAttribute("data-wcs-server", "orchestrated");
  try {
    const h = document.createElement(`ssr-link-server-${seq++}`);
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

async function clientLoad(html: string, state: Record<string, any>, before?: (root: ShadowRoot) => void) {
  const h = document.createElement(`ssr-link-client-${seq++}`);
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
  return { root, write };
}

const page = `<wcs-state enable-ssr></wcs-state>
<ul><template data-wcs="for: items"><li><h2><fake-link data-wcs="attr.to: .href"><span data-wcs="textContent: .title"></span></fake-link></h2><p><fake-link data-wcs="attr.to: .href">Read</fake-link> <b data-wcs="textContent: .summary"></b></p></li></template></ul>
<template data-wcs="if: missing"><p class="missing">gone</p></template><template data-wcs="else:"><p class="back"><fake-link to="/">Back</fake-link> to the list</p></template>
<ol><template data-wcs="for: items"><fake-link data-wcs="attr.to: .href">{{ .title }}</fake-link></template></ol>`;

const state = () => ({
  missing: false,
  items: [
    { href: "/items/1", title: "One", summary: "first" },
    { href: "/items/2", title: "Two", summary: "second" },
  ],
});

describe("SSR: 自分の隣に描く要素（<wcs-link>）を含む行・枝", () => {
  it("サーバーは行・枝の中のリンクを描いたまま出力する（行を動かさないので、リンクは切断されない）", async () => {
    const html = await serverRender(page, state());
    expect(html).toContain(`<a href="/items/1" data-wcs-ssr-link=""><span>One</span></a>`);
    expect(html).toContain(`<a href="/items/2" data-wcs-ssr-link=""><span>Two</span></a>`);
    expect(html).toContain(`<a href="/" data-wcs-ssr-link="">Back</a> to the list`);
    // 行の最上位に置いたリンク
    expect(html).toMatch(/<a href="\/items\/1" data-wcs-ssr-link="">(<!--[^>]*-->)*One/);
  });

  it("クライアントはサーバーの行をそのまま引き取る（リンクが先に <a> を引き取った後でも）", async () => {
    const html = await serverRender(page, state());
    let spans: Element[] = [];
    let anchors: Element[] = [];
    const { root, write } = await clientLoad(html, state(), (r) => {
      spans = Array.from(r.querySelectorAll("li span"));
      anchors = Array.from(r.querySelectorAll("a"));
    });
    expect(spans.length).toBe(2);
    const bs = Array.from(root.querySelectorAll("li b"));
    expect(anchors.length).toBe(7);
    for (const n of [...spans, ...anchors, ...bs]) expect(n.isConnected).toBe(true);
    expect(root.querySelectorAll("a[data-wcs-ssr-link]").length).toBe(0);
    expect(Array.from(root.querySelectorAll("li b"))).toEqual(bs);
    expect(Array.from(root.querySelectorAll("li h2 a")).map((a) => `${a.getAttribute("href")} ${a.textContent}`)).toEqual(["/items/1 One", "/items/2 Two"]);
    // 束縛は生きている（サーバーの <span> と href に届く）
    await write((s) => { s["items.0.title"] = "Uno"; s["items.1.href"] = "/items/22"; });
    expect(spans[0].textContent).toBe("Uno");
    await write((s) => { s["items.0.summary"] = "primero"; });
    expect(bs[0].textContent).toBe("primero");
    expect(root.querySelectorAll("li h2 a")[1].getAttribute("href")).toBe("/items/22");
    // 行が消えると、リンクの <a> も消える
    await write((s) => { s.items = [s.items[1]]; });
    expect(Array.from(root.querySelectorAll("li h2 a")).map((a) => a.textContent)).toEqual(["Two"]);
    expect(Array.from(root.querySelectorAll("ol a")).map((a) => a.textContent)).toEqual(["Two"]);
    // 枝の切り替え
    await write((s) => { s.missing = true; });
    expect(root.querySelector("p.back")).toBeNull();
    expect(root.querySelector("p.missing")?.textContent).toBe("gone");
  });

  it("リンクが state より後に定義されても、行は引き取られ、リンクは目印付きの <a> を引き取る", async () => {
    const html = await serverRender(page, state());
    linksReady = false;
    let spans: Element[] = [];
    try {
      const { root, write } = await clientLoad(html, state(), (r) => { spans = Array.from(r.querySelectorAll("li span")); });
      for (const n of spans) expect(n.isConnected).toBe(true);
      // まだ引き取られていない <a> は目印付きのまま
      expect(root.querySelectorAll("a[data-wcs-ssr-link]").length).toBe(7);
      linksReady = true;
      for (const l of Array.from(root.querySelectorAll<FakeLink>("fake-link"))) l.render();
      expect(root.querySelectorAll("a[data-wcs-ssr-link]").length).toBe(0);
      expect(root.querySelectorAll("a").length).toBe(7);
      await write((s) => { s["items.1.title"] = "Dos"; });
      expect(spans[1].textContent).toBe("Dos");
    } finally {
      linksReady = true;
    }
  });
});
