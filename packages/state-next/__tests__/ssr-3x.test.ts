/**
 * A 4.0 client on the output of @wcstack/server 3.x: the snapshot is discarded and the page renders on
 * the client from its templates.
 * - `golden/ssr-3x.json`: the output up to 3.5.2 (recorded from the 3.5.0 dists of packages/server and
 *   packages/state; frozen, see scripts/ssr-3x.mjs), whose text marks name the path alone;
 * - `golden/ssr-3x-353.json`: the output from 3.5.3 (`node scripts/ssr-3x.mjs`, from the checked-in
 *   dists), whose text marks hold the binding's expression, a Light DOM child's in its own vocabulary.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bootstrapState, getBindingsReady, installFeatures, scopes, ssr } from "../src/index";
import { formats } from "../src/features/formats";

type Golden = {
  engine: string;
  components: Record<string, Record<string, unknown>>;
  pages: Record<string, { page: string; output: string }>;
};
const read = (file: string) => JSON.parse(readFileSync(resolve(__dirname, "golden", file), "utf8")) as Golden;
const golden = read("ssr-3x.json");
const golden353 = read("ssr-3x-353.json");
const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  // (no diagnostics: the add-on's warning is its own text)
  installFeatures([ssr, formats, scopes]);
  bootstrapState();
  // the custom elements the server rendered with (both records define the shared ones alike)
  for (const [tag, state] of Object.entries({ ...golden.components, ...golden353.components })) {
    expect(golden.components[tag] ?? state).toEqual(state);
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

describe("3.5.3 以降の 3.x の出力（テキストの印がフィルタ込みの式を持ち、Light DOM の子の印はその子の語彙）", () => {
  const out = (name: string) => golden353.pages[name].output;
  /**
   * The page rendered on the client alone (`csr`: without `enable-ssr`, whose root runs no
   * `$connectedCallback` when it finds no snapshot), and from the 3.5.3 output (`ssr3`).
   */
  const both = async (name: string, state?: () => Record<string, any>) => ({
    csr: await load(name, state?.(), (r) => r.querySelector("wcs-state")!.removeAttribute("enable-ssr"), golden353.pages[name].page),
    ssr3: await load(name, state?.(), undefined, out(name)),
  });
  /** What a page shows: its text, the whitespace collapsed. */
  const shown = (root: ShadowRoot) => root.textContent!.replace(/\s+/g, " ").trim();

  it("記録は 3.5.3 以降のサーバと state の出力で、テキストの印が式を持つ（テンプレートの印はページのパスのまま）", () => {
    expect(golden353.engine).toMatch(/^@wcstack\/server 3\.\d+\.\d+ \+ @wcstack\/state 3\.\d+\.\d+/);
    const [minor, patch] = /<wcs-ssr version="3\.(\d+)\.(\d+)"/.exec(out("basic"))!.slice(1).map(Number);
    expect(minor * 1000 + patch).toBeGreaterThanOrEqual(5003);
    // the same pages as the frozen record (the older format), and the 3.5.3 ones
    for (const name of Object.keys(golden.pages)) expect(golden353.pages[name].page).toBe(golden.pages[name].page);
    expect(out("filters")).toContain("<!--@@wcs-text-start:price|toFixed(2)-->3.14<!--@@wcs-text-end:price|toFixed(2)-->");
    expect(out("swap")).toContain("<!--@@wcs-text-start:v-->host-w<!--@@wcs-text-end:v--> / <!--@@wcs-text-start:x-->host-v<!--@@wcs-text-end:x-->");
    for (const mark of ["@@wcs-text-start:name-->", "@@wcs-text-start:age|add(1)-->", "@@wcs-text-start:mine-->", "@@wcs-text-start:other-->", "@@wcs-text-start:box.x-->", 'data-wcs="for: user.tags"', 'data-wcs="if: user.on|not"']) {
      expect(out("light")).toContain(mark);
    }
    for (const mark of ["@@wcs-text-start:price|mul(10)|round|unit(' pt')-->31 pt", "@@wcs-text-start:name|padStart(6,'*')-->***Ann", "@@wcs-text-start:p|toFixed(2)-->3.14", "@@wcs-text-start:age|add(1)|unit(' y')-->4 y", "@@wcs-text-start:mine|upper-->OWN"]) {
      expect(out("exprs")).toContain(mark);
    }
    // an expression a comment cannot hold falls back to the path: in a Light DOM child, the page's
    expect(out("fallback")).toContain("<!--@@wcs-text-start:title-->T--");
    expect(out("fallback")).toMatch(/<!--@@wcs-text-start:#m\d+\.other-->o--/);
    expect(out("fallback")).toMatch(/<!--@@wcs-text-start:user\.#m\d+\.mine-->own--/);
    expect(out("fallback-wired")).toContain("<!--@@wcs-text-start:user.name-->Ann--");
  });

  const cases: [string, (s: any) => void, (() => Record<string, any>)?][] = [
    ["basic", (s) => { s.title = "Bye"; s.count = 4; s.items = [...s.items, { name: "Cherry", n: 3 }]; s.show = false; }],
    ["nested", (s) => { s["groups.0.items.1.v"] = 5; s["groups.1.items"] = [...s["groups.1.items"], { v: 7 }]; }],
    ["chain", (s) => { s.n = 3; }],
    ["connected", (s) => { s.items = [...s.items, "more"]; }, () => ({ items: [] as string[], $connectedCallback(this: any) { this.items = ["client"]; } })],
    ["volume", (s) => { s["cart.count"] = 3; s["cart.lines"] = [...s["cart.lines"], "c"]; s.items = [{ n: 7 }]; }],
    ["light", (s) => { s["user.name"] = "Bo"; s["user.age"] = 7; s["user.tags"] = [...s["user.tags"], "c"]; s["user.on"] = false; s["user.profile.city"] = "Y"; s["theme.mode"] = "light"; s.title = "U"; }],
    ["filters", (s) => { s.price = 2.5; s.items = [...s.items, 2]; }],
    ["swap", (s) => { s.v = "v2"; s.w = "w2"; }],
    ["exprs", (s) => { s.price = 1.25; s.name = "Bo"; s["user.age"] = 7; }],
  ];
  for (const [name, writes, state] of cases) {
    it(`${name}: SSR の無いページと同じに描き（テンプレートの外のフィルタも）、書き込みに追従し、3.x の印を残さない`, async () => {
      const { csr, ssr3 } = await both(name, state);
      // the warning: no sentence about lost filters
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/^\[@wcstack\/state\] <wcs-ssr version="3\.[^"]+"> does not match .* from its own state\.$/);
      expect(error).not.toHaveBeenCalled();
      clean(ssr3.root);
      const view = (root: ShadowRoot) => ({ text: shown(root), title: root.querySelector("x-light")?.getAttribute("title") });
      expect(view(ssr3.root)).toEqual(view(csr.root));
      await csr.write(writes);
      await ssr3.write(writes);
      expect(view(ssr3.root)).toEqual(view(csr.root));
      expect(error).not.toHaveBeenCalled();
    });
  }

  it("名前を入れ替えた配線（state.x: v; state.v: w）: 子の {{ v }} / {{ x }} は host-w / host-v で、w と v への書き込みに追従する", async () => {
    const { root, write } = await load("swap", undefined, undefined, out("swap"));
    const kid = () => root.querySelector("p.kid")!.textContent;
    expect(kid()).toBe("host-w / host-v");
    await write((s) => { s.w = "w2"; });
    expect(kid()).toBe("w2 / host-v");
    await write((s) => { s.v = "v2"; });
    expect(kid()).toBe("w2 / v2");
    expect(root.querySelector("p.page")!.textContent).toBe("v2 / w2");
  });

  it("フィルタの連鎖・文字列の引数（コメント束縛も）・Light DOM の子のフィルタ（部分マウント・丸ごとの私有のキー）を保つ", async () => {
    const { root, write } = await load("exprs", undefined, undefined, out("exprs"));
    const view = () => ["p.chain", "p.str", "x-num > p.p", "x-light > p.age", "x-light > p.mine"].map((s) => root.querySelector(s)!.textContent);
    expect(view()).toEqual(["31 pt", "***Ann", "3.14", "4 y", "OWN"]);
    await write((s) => { s.price = 1.25; s.name = "Bo"; s["user.age"] = 7; });
    expect(view()).toEqual(["13 pt", "****Bo", "1.25", "8 y", "OWN"]);
  });

  it("コメントに入らない式（--）は印がパスに戻る: フィルタは外れ（3.5.2 以前と同じ）、Light DOM の子の私有のキー（#mN.）は子のキーに戻す", async () => {
    const { csr, ssr3 } = await both("fallback");
    expect(error).not.toHaveBeenCalled();
    clean(ssr3.root);
    const view = (root: ShadowRoot) => ["p.page", "x-part > p.own", "x-part > p.kept", "x-light > p.own", "x-light > p.kept"].map((s) => root.querySelector(s)!.textContent);
    expect({ csr: view(csr.root), ssr3: view(ssr3.root) }).toEqual({
      csr: ["T--", "o--", "Ann!", "own--", "Ann!"],
      ssr3: ["T", "o", "Ann!", "own", "Ann!"],
    });
    const writes = (s: any) => { s.title = "U"; s["user.name"] = "Bo"; };
    await csr.write(writes);
    await ssr3.write(writes);
    expect({ csr: view(csr.root), ssr3: view(ssr3.root) }).toEqual({
      csr: ["U--", "o--", "Bo!", "own--", "Bo!"],
      ssr3: ["U", "o", "Bo!", "own", "Bo!"],
    });
    expect(error).not.toHaveBeenCalled();
  });

  it("（制限）配線したキーの式がコメントに入らないと、印はページのパス（user.name）になり、子の語彙として読む: 子にそのキーは無く、空のまま書き込みにも追従しない", async () => {
    // (the page's path cannot be told from the child's own text: `user.name` may be the child's own
    // key, and mapping it through the wiring would misread that common case — see legacy)
    const { csr, ssr3 } = await both("fallback-wired");
    clean(ssr3.root);
    const view = (root: ShadowRoot) => ["x-part > p.wired", "x-light > p.wired"].map((s) => root.querySelector(s)!.textContent);
    expect({ csr: view(csr.root), ssr3: view(ssr3.root) }).toEqual({ csr: ["Ann--", "Ann--"], ssr3: ["", ""] });
    await csr.write((s) => { s["user.name"] = "Bo"; });
    await ssr3.write((s) => { s["user.name"] = "Bo"; });
    expect({ csr: view(csr.root), ssr3: view(ssr3.root) }).toEqual({ csr: ["Bo--", "Bo--"], ssr3: ["", ""] });
    expect(error).not.toHaveBeenCalled();
  });

  // the version decides how a text mark reads: the swap page's marks are 3.5.3's (the child's own
  // vocabulary); read as older output, they go through the host's wiring, which turns the child's `v`
  // into its `x` (the reviewer's reproduction: host-v / host-v, and writes to `w` not followed)
  // (a prerelease, build metadata or a version that does not parse counts as older)
  it.each([
    ["3.5.3", true], ["3.5.10", true], ["3.6.0", true], ["3.10.0", true],
    ["3.5.2", false], ["3.4.9", false], ["3.5.3-rc.1", false], ["3.6.0-beta.1", false], ["3.5.3+build.1", false],
    ["3.5", false], ["3.5.3.1", false], ["3.5.3 ", false], ["3.x", false],
  ])('<wcs-ssr version="%s">: 3.5.3 以降の印として読むか（%s）。それより前と読めば配線で戻し、フィルタの文を警告に足す', async (version, fresh) => {
    const html = out("swap").replace(/<wcs-ssr version="[^"]+"/, `<wcs-ssr version="${version}"`);
    const { root, write } = await load("swap", undefined, undefined, html);
    const kid = () => root.querySelector("p.kid")!.textContent;
    expect(kid()).toBe(fresh ? "host-w / host-v" : "host-v / host-v");
    await write((s) => { s.w = "w2"; });
    expect(kid()).toBe(fresh ? "w2 / host-v" : "host-v / host-v");
    expect(warn.mock.calls[0][0]).toContain(`<wcs-ssr version="${version}"> does not match`);
    expect(warn.mock.calls[0][0].includes("so such a binding loses its filters")).toBe(!fresh);
  });
});
