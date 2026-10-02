/**
 * A 4.0 client on the output of @wcstack/server 3.x (`golden/ssr-3x.json`, recorded by
 * `node scripts/ssr-3x.mjs` from the checked-in 3.5.0 dists of packages/server and packages/state):
 * the snapshot is discarded and the page renders on the client from its templates.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bootstrapState, getBindingsReady, installFeatures, scopes, ssr } from "../src/index";
import { formats } from "../src/features/formats";

const golden = JSON.parse(readFileSync(resolve(__dirname, "golden/ssr-3x.json"), "utf8")) as {
  engine: string;
  components: Record<string, Record<string, unknown>>;
  pages: Record<string, { page: string; output: string }>;
};
const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  // (no diagnostics: the add-on's warning is its own text)
  installFeatures([ssr, formats, scopes]);
  bootstrapState();
  // the custom elements the server rendered with
  for (const [tag, state] of Object.entries(golden.components)) {
    customElements.define(tag, class extends HTMLElement { state = structuredClone(state); });
  }
});

let warn: MockInstance;
let error: MockInstance;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  error.mockRestore();
});

/**
 * Loads a 3.x output in a page (a shadow root); `state` replaces the element's own source (an inline
 * script, which this environment cannot import). `before` sees the server's DOM before it loads.
 */
async function load(name: string, state?: Record<string, any>, before?: (root: ShadowRoot) => void, html = golden.pages[name].output) {
  const h = document.createElement(`ssr3-client-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = html;
  const el = root.querySelector("wcs-state") as any;
  if (state !== undefined) {
    el.removeAttribute("json");
    el.querySelector("script")?.remove();
    el.setInitialState(state);
  }
  before?.(root);
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

const texts = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll(selector)).map((e) => e.textContent);

/** Nothing of the 3.x server's is left: its marks, `data-wcs-ssr-id`, `<wcs-ssr>`. */
function clean(root: ShadowRoot): void {
  expect(root.innerHTML).not.toContain("@@wcs-");
  expect(root.querySelector("[data-wcs-ssr-id]")).toBeNull();
  expect(root.querySelector("wcs-ssr")).toBeNull();
}

describe("3.x の @wcstack/server の出力（版の違い）", () => {
  it("記録は 3.x のサーバと state の出力で、3.x の印を含む", () => {
    expect(golden.engine).toMatch(/^@wcstack\/server 3\.\d+\.\d+ \+ @wcstack\/state 3\.\d+\.\d+/);
    const out = golden.pages.basic.output;
    expect(out).toMatch(/<wcs-ssr version="3\./);
    expect(out).toContain("<!--@@wcs-for-start:");
    expect(out).toContain("<!--@@wcs-text-start:title-->");
    expect(out).toContain("data-wcs-ssr-id");
  });

  it("スナップショットを捨て、3.x の印と行を外し、テンプレートからクライアントで描く（以後の変更が効く）", async () => {
    let serverLi: Element | null = null;
    const { root, write } = await load("basic", undefined, (r) => { serverLi = r.querySelector("li"); });
    // the warning says what happens
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('<wcs-ssr version="3.5.0"> does not match');
    expect(warn.mock.calls[0][0]).toContain("its snapshot is discarded, and the page renders on the client from its own state.");
    expect(error).not.toHaveBeenCalled();
    clean(root);
    // the server's rows are gone; the client's are rendered from the template
    expect(serverLi!.isConnected).toBe(false);
    expect(texts(root, "li")).toEqual(["Apple 1", "Banana 2"]);
    expect(root.querySelector("h1")!.textContent).toBe("Hello");
    expect(root.querySelector("p.count")!.textContent).toBe("3");
    expect(texts(root, "div.shown")).toEqual(["shown 3"]);
    expect(root.querySelector("div.hidden")).toBeNull();
    expect(root.querySelector("p.comment")!.textContent).toBe("Hello");
    expect((root.querySelector("input") as HTMLInputElement).value).toBe("Hello");
    await write((s) => {
      s.title = "Bye";
      s.count = 4;
      s.items = [...s.items, { name: "Cherry", n: 3 }];
    });
    expect(root.querySelector("h1")!.textContent).toBe("Bye");
    expect(root.querySelector("p.comment")!.textContent).toBe("Bye");
    expect(root.querySelector("p.count")!.textContent).toBe("4");
    expect(texts(root, "li")).toEqual(["Apple 1", "Banana 2", "Cherry 3"]);
    expect(texts(root, "div.shown")).toEqual(["shown 4"]);
    await write((s) => { s.show = false; });
    expect(root.querySelector("div.shown")).toBeNull();
    expect(texts(root, "div.hidden")).toEqual(["hidden"]);
    // two-way: an input writes back
    const input = root.querySelector("input") as HTMLInputElement;
    input.value = "Typed";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(root.querySelector("h1")!.textContent).toBe("Typed");
  });

  it("入れ子の for（相対パス）と行の中の if を、入れ子のテンプレートまで戻して描く", async () => {
    const { root, write } = await load("nested");
    expect(error).not.toHaveBeenCalled();
    clean(root);
    expect(texts(root, "h2")).toEqual(["A", "B"]);
    expect(texts(root, "p")).toEqual(["1", "0", "3"]);
    expect(texts(root, "i")).toEqual(["1", "3"]);
    await write((s) => { s["groups.0.items.1.v"] = 5; s["groups.1.items"] = [...s["groups.1.items"], { v: 7 }]; });
    expect(texts(root, "p")).toEqual(["1", "5", "3", "7"]);
    expect(texts(root, "i")).toEqual(["1", "5", "3", "7"]);
  });

  it("3.x が else の中の if にした elseif を、書いたとおりの if / elseif / else の並びに戻す", async () => {
    const { root, write } = await load("chain");
    expect(error).not.toHaveBeenCalled();
    clean(root);
    // the chain as written: four sibling templates (their anchors), no else nested in an else
    expect(root.innerHTML.match(/<!--wcs-(?:if|elseif|else)-->/g)).toEqual(["<!--wcs-if-->", "<!--wcs-elseif-->", "<!--wcs-elseif-->", "<!--wcs-else-->"]);
    const shown = () => texts(root, "b");
    expect(shown()).toEqual(["two 2"]);
    await write((s) => { s.n = 3; });
    expect(shown()).toEqual(["three"]);
    await write((s) => { s.n = 1; });
    expect(shown()).toEqual(["one"]);
    await write((s) => { s.n = 9; });
    expect(shown()).toEqual(["other"]);
  });

  it("$connectedCallback はクライアントで走り、サーバのスナップショットの値は使わない", async () => {
    // the server ran its $connectedCallback: the snapshot and the rows say "server"
    expect(golden.pages.connected.output).toContain('{"items":["server"]}');
    const calls: string[] = [];
    const { root } = await load("connected", {
      items: [] as string[],
      $connectedCallback(this: any) { calls.push("connected"); this.items = ["client"]; },
    });
    expect(calls).toEqual(["connected"]);
    clean(root);
    expect(texts(root, "li")).toEqual(["client"]);
  });

  it("ボリュームは自分のソースから接ぎ木し（3.x のスナップショットのボリュームのデータは使わない）、カスタム要素の中の for も描く", async () => {
    // 3.x's snapshot holds the volume's data under its mount path
    expect(golden.pages.volume.output).toContain('"cart":{"count":2,"lines":["a","b"]}');
    const { root, write } = await load("volume");
    expect(error).not.toHaveBeenCalled();
    clean(root);
    expect(root.querySelector("p.t")!.textContent).toBe("T / 2");
    expect(texts(root, "li.line")).toEqual(["a", "b"]);
    expect(texts(root, "my-box > b.n")).toEqual(["1", "2"]);
    await write((s) => { s["cart.count"] = 3; s["cart.lines"] = [...s["cart.lines"], "c"]; s.items = [{ n: 7 }]; });
    expect(root.querySelector("p.t")!.textContent).toBe("T / 3");
    expect(texts(root, "li.line")).toEqual(["a", "b", "c"]);
    expect(texts(root, "my-box > b.n")).toEqual(["7"]);
  });

  it("テンプレートの外のテキストのフィルタは 3.x の出力に残っていないので外れ、警告がそう言う（テンプレートの中は残る）", async () => {
    const { root } = await load("filters");
    clean(root);
    // 3.x's mark names the path only: {{ price|toFixed(2) }} comes back as {{ price }}
    expect(golden.pages.filters.output).toContain("<!--@@wcs-text-start:price-->3.14<!--@@wcs-text-end:price-->");
    expect(root.querySelector("p.price")!.textContent).toBe("3.14159");
    expect(warn.mock.calls[0][0]).toContain("3.x output keeps only the path of a text binding outside a template, so such a binding loses its filters: deploy @wcstack/server 4.0 with this client.");
    // a template keeps its expressions
    expect(texts(root, "li")).toEqual(["1.50"]);
  });

  describe("ページから配線した Light DOM のコンポーネント（3.x はパスをページのパスで書く）", () => {
    /** What the components show. */
    const view = (root: ShadowRoot) => ({
      light: ["name", "age", "mine", "mode", "where", "bound"].map((c) => root.querySelector(`x-light > p.${c}`)!.textContent),
      title: root.querySelector("x-light")!.getAttribute("title"),
      tags: texts(root, "x-light li"),
      on: texts(root, "x-light i"),
      inner: texts(root, "x-light x-inner em"),
      part: ["label", "other"].map((c) => root.querySelector(`x-part > p.${c}`)!.textContent),
      box: texts(root, "x-part em.box"),
      // private keys named like their own mount path
      named: ["deep", "deep-city", "own", "own-k", "own-x"].map((c) => root.querySelector(`em.${c}`)!.textContent),
    });
    const writes = (s: any) => {
      s["user.name"] = "Bo";
      s["user.age"] = 7;
      s["user.tags"] = [...s["user.tags"], "c"];
      s["user.on"] = false;
      s["user.profile.city"] = "Y";
      s["theme.mode"] = "light";
    };

    it("丸ごとのマウント（私有のキー・内側の for・if / else）・隣の部分マウント・部分マウントだけ（私有のキー）・入れ子のコンポーネント（私有のキーの下も、マウントのパスと同じ名前の私有のキーも）を、SSR の無いページと同じに描き、書き込みに追従する", async () => {
      // the 3.x output writes them as the page's paths
      const out = golden.pages.light.output;
      for (const mark of ["@@wcs-text-start:user.name", "@@wcs-text-start:user.#m1.mine", "@@wcs-text-start:#m2.other", "@@wcs-text-start:user.profile.city", "@@wcs-text-start:#m2.box.k", "@@wcs-text-start:user.profile.#m4.profile", "@@wcs-text-start:#m2.box.#m6.box-", "@@wcs-text-start:#m2.box.#m7.box.x", 'data-wcs="for: user.tags"', 'data-wcs="if: user.on|not"']) {
        expect(out).toContain(mark);
      }
      const csr = await load("light", undefined, undefined, golden.pages.light.page);
      const ssr3 = await load("light");
      expect(error).not.toHaveBeenCalled();
      clean(ssr3.root);
      // the same, but for {{ age|add(1) }}: a text binding outside a template loses its filters (3.x's
      // mark keeps only its path — the warning says so), in a component as on the page
      const expected = { light: ["Ann", "4", "own", "dark", "X", "Ann"], title: "T", tags: ["a", "b"], on: ["Ann"], inner: ["X"], part: ["Ann", "o"], box: ["v"], named: ["deep-own", "X", "mine", "v", "own-x"] };
      const unfiltered = (v: typeof expected, age: string) => ({ ...v, light: v.light.map((t, i) => (i === 1 ? age : t)) });
      expect({ csr: view(csr.root), ssr3: view(ssr3.root) }).toEqual({ csr: expected, ssr3: unfiltered(expected, "3") });
      await csr.write(writes);
      await ssr3.write(writes);
      const after = { light: ["Bo", "8", "own", "light", "Y", "Bo"], title: "T", tags: ["a", "b", "c"], on: ["off"], inner: ["Y"], part: ["Bo", "o"], box: ["v"], named: ["deep-own", "Y", "mine", "v", "own-x"] };
      expect({ csr: view(csr.root), ssr3: view(ssr3.root) }).toEqual({ csr: after, ssr3: unfiltered(after, "7") });
      expect(error).not.toHaveBeenCalled();
    });
  });

  describe("3.x の印でないものは触らない", () => {
    /** A template id of the recorded output (u…: 3.x numbers them). */
    const someId = (name: string) => /<template id="([^"]+)"/.exec(golden.pages[name].output)![1];

    it("router の @@route: や @@wcs-text: のコメントは、テンプレートの id と同じ文字でもテンプレートに置き換えない", async () => {
      const id = someId("basic");
      const html = golden.pages.basic.output.replace('<p class="comment">', `<!--@@route:${id}--><p class="comment">`);
      const { root } = await load("basic", undefined, undefined, html.replace("<h1>", `<h1><!--@@wcs-text:${id}-->`));
      // (the comment binding is bound as a text binding — and fails to read, its path not being in the
      // state — not replaced by the template)
      expect(error.mock.calls.map((c) => c[0])).toEqual([`[@wcstack/state] #12 "text" "${id}"`]);
      const left = Array.from(root.childNodes).filter((n) => n.nodeType === 8).map((n) => (n as Comment).data);
      expect(left).toContain(`@@route:${id}`);
      expect(root.querySelectorAll("template").length).toBe(0);
      expect(texts(root, "li")).toEqual(["Apple 1", "Banana 2"]);
    });

    it("終わりの印が兄弟に無い始まりの印は、後ろの兄弟を消さずにそのまま残す", async () => {
      // a cut output: a start mark whose end is not among its siblings
      const html = golden.pages.basic.output.replace('<p class="comment">', '<!--@@wcs-if-start:zz:x--><p class="comment">');
      const { root } = await load("basic", undefined, undefined, html);
      expect(error).not.toHaveBeenCalled();
      expect(root.querySelector("p.comment")!.textContent).toBe("Hello");
      expect((root.querySelector("input") as HTMLInputElement).value).toBe("Hello");
      expect(Array.from(root.childNodes).some((n) => n.nodeType === 8 && (n as Comment).data === "@@wcs-if-start:zz:x")).toBe(true);
    });
  });
});
