/**
 * coverage-dom-scopes.test.ts — a property binding on a custom element without a wc-bindable
 * declaration, with the scopes add-on installed (src/dom/view.ts attachCustomOrPlain).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, scopes } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
const BINDER_KEY = Symbol.for("wcstack.binder");
let seq = 0;

beforeAll(() => {
  installFeatures([scopes]);
  bootstrapState();
});

/** A page (a shadow root) with a root `<wcs-state>` over `state`. */
async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`cov-scopes-page-${seq++}`);
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
    await flush();
  };
  return { root, el, write };
}

/** A component whose `<wcs-state bind-component="state">` sits in its shadow root. */
function component(): string {
  const tag = `cov-scopes-cmp-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    state = { a: "own" };
    constructor() {
      super();
      this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state><p>{{ a }}</p>`;
    }
  });
  return tag;
}

describe("プレーンなカスタム要素へのプロパティバインディング", () => {
  it("ホストの結線はコンポーネントが状態を受け取る前に渡り、コンポーネントはツリーを読む", async () => {
    const tag = component();
    const { root, write } = await page(`<${tag} data-wcs="state.a: x"></${tag}>`, { x: "tree" });
    const c = root.querySelector(tag) as any;
    await (c.shadowRoot.querySelector("wcs-state") as any).connectedCallbackPromise;
    await flush();
    expect(c.shadowRoot.querySelector("p").textContent).toBe("tree");
    await write((s) => { s.x = "tree 2"; });
    expect(c.shadowRoot.querySelector("p").textContent).toBe("tree 2");
  });

  it("自分の状態を受け取った後のコンポーネントに後から結線を渡しても、要素に書かず自分の状態のまま", async () => {
    const tag = component();
    const { root, write } = await page(`<main></main>`, { x: "tree" });
    const c = document.createElement(tag) as any;
    root.querySelector("main")!.appendChild(c);
    await (c.shadowRoot.querySelector("wcs-state") as any).connectedCallbackPromise;
    await flush();
    expect(c.shadowRoot.querySelector("p").textContent).toBe("own");
    // the wiring arrives late (handed over through the binder protocol)
    c.setAttribute("data-wcs", "state.a: x");
    (globalThis as any)[BINDER_KEY].bind(c);
    await write((s) => { s.x = "tree 2"; });
    expect(c["state.a"]).toBeUndefined();
    expect(c.state.a).toBe("own");
    expect(c.shadowRoot.querySelector("p").textContent).toBe("own");
  });
});
