/**
 * release.test.ts — the release add-on (src/features/release.ts): the binder protocol's `release(subtree)`
 * (version 2). Markup handed over and then thrown away for good by its inserter (htmx replacing search
 * results) kept its bindings, and every change wrote into the nodes it left behind (docs/seam-apps.md,
 * community-hall).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, release } from "../src/index";
import { engines } from "../src/dom/mount";
import { bind } from "../src/dom/binder";

const BINDER = Symbol.for("wcstack.binder");
const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([release]);
  bootstrapState();
});

const binder = () => (globalThis as any)[BINDER];

/** A bound shadow root; `write` changes the state and waits for the bindings. */
async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`release-test-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  const write = async (fn: (s: any) => void) => {
    el.createState("writable", fn);
    await flush();
  };
  return { root, el, write };
}

/** Inserts `html` into `parent` (as htmx does) and hands over each new element. */
function insert(parent: Element, html: string): Element[] {
  const t = document.createElement("template");
  t.innerHTML = html;
  const nodes = [...t.content.children];
  parent.append(document.importNode(t.content, true));
  const added = [...parent.children].slice(-nodes.length);
  for (const n of added) binder().bind(n);
  return added;
}

const FRAGMENT = `<div class="card"><span data-wcs="textContent: n"></span><ul><template data-wcs="for: items"><li data-wcs="textContent: .v"></li></template></ul><template data-wcs="if: on"><b data-wcs="textContent: n"></b></template><template data-wcs="elseif: off"><i>off</i></template></div>`;

describe("release add-on（binder プロトコルの release、版 2）", () => {
  it("full の入口では binder が版 2 で release を持つ", () => {
    expect(binder()).toMatchObject({ protocol: "wcs-binder", version: 2 });
    expect(typeof binder().release).toBe("function");
  });

  it("渡して捨てた中身を release すると、その束縛は以後の変更で書かれず、エンジンにも残らない。ページの同じリストの view は動き続ける", async () => {
    const { root, el, write } = await page(`<p>{{ n }}</p><ol><template data-wcs="for: items"><li data-wcs="textContent: .v"></li></template></ol><main></main>`, { n: 1, items: [{ v: "a" }], on: true, off: false });
    const main = root.querySelector("main")!;
    const [card] = insert(main, FRAGMENT);
    expect([card.querySelector("span")!.textContent, card.querySelectorAll("li").length, card.querySelector("b")!.textContent]).toEqual(["1", 1, "1"]);
    const kept = { span: card.querySelector("span")!, b: card.querySelector("b")!, ul: card.querySelector("ul")! };
    // htmx: htmx:beforeCleanupElement (still in the page), then the element goes
    binder().release(card);
    card.remove();
    await write((s) => { s.n = 2; s.items = [{ v: "a" }, { v: "b" }]; });
    expect([kept.span.textContent, kept.b.textContent, kept.ul.querySelectorAll("li").length]).toEqual(["1", "1", 1]);
    // the page's own view of the same list, and its own bindings, keep going
    expect([root.querySelector("p")!.textContent, root.querySelectorAll("ol li").length]).toEqual(["2", 2]);
    const engine = el.engine;
    const left = [...engine.rootBindings.values()].flatMap((set: Set<any>) => [...set]).filter((b: any) => card.contains(b.node));
    expect(left).toEqual([]);
    const list = engine.rootLists.get(engine.pattern("items"));
    expect([list.view, ...(list.extra ?? [])].filter((v: any) => v !== null && card.contains(v.anchor))).toEqual([]);
  });

  it("文書から外した後の release も、渡したときのルートのエンジンから外す", async () => {
    const { root, write } = await page(`<main></main>`, { n: 1, items: [], on: false, off: true });
    const [card] = insert(root.querySelector("main")!, FRAGMENT);
    expect(card.querySelector("i")!.textContent).toBe("off");
    const span = card.querySelector("span")!;
    card.remove();
    binder().release(card);
    await write((s) => { s.n = 5; s.on = true; });
    expect(span.textContent).toBe("1");
    expect(card.querySelector("b")).toBeNull();
  });

  it("何も束ねていない部分木・渡したことの無い外れた部分木の release は何もしない", async () => {
    const { root, write } = await page(`<p>{{ n }}</p><div id="empty"></div>`, { n: 1 });
    binder().release(root.querySelector("#empty")!);
    binder().release(document.createElement("section"));
    await write((s) => { s.n = 2; });
    expect(root.querySelector("p")!.textContent).toBe("2");
  });

  it("release した要素を渡し直しても束ね直さない（新しいマークアップを渡す）", async () => {
    const { root, write } = await page(`<main></main>`, { n: 1, items: [], on: false, off: false });
    const main = root.querySelector("main")!;
    const [card] = insert(main, FRAGMENT);
    binder().release(card);
    binder().bind(card);
    await write((s) => { s.n = 3; });
    expect(card.querySelector("span")!.textContent).toBe("1");
    const [fresh] = insert(main, FRAGMENT);
    expect(fresh.querySelector("span")!.textContent).toBe("3");
  });
});

describe("release add-on の取り付け", () => {
  it("<wcs-state> の後に入れた（分割の features）add-on は、この写しの binder に release を足す。別の写しの binder には触れない", () => {
    const slot = globalThis as any;
    const before = slot[BINDER];
    try {
      const ours = { protocol: "wcs-binder", version: 1, bind };
      slot[BINDER] = ours;
      release.install();
      expect(ours).toMatchObject({ version: 2 });
      expect(typeof (ours as any).release).toBe("function");
      const foreign = { protocol: "wcs-binder", version: 1, bind: vi.fn() };
      slot[BINDER] = foreign;
      release.install();
      expect(foreign).toEqual({ protocol: "wcs-binder", version: 1, bind: foreign.bind });
    } finally {
      slot[BINDER] = before;
    }
  });

  it("エンジンの無いルートへ渡した部分木の release は何もしない", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const box = host.appendChild(document.createElement("span"));
    binder().bind(box);
    expect(engines.get(document)).toBeUndefined();
    expect(() => binder().release(box)).not.toThrow();
    // a subtree handed over out of the document is not bound, and has no root to remember
    const loose = document.createElement("p");
    binder().bind(loose);
    expect(() => binder().release(loose)).not.toThrow();
  });
});
