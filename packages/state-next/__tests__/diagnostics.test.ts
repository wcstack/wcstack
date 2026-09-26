import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, DirtyStrategy, Engine, getBindingsReady, installFeatures, diagnostics, recursion, scopes, temporal } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([diagnostics, temporal, scopes, recursion]);
  bootstrapState();
});

async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`diag-test-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  await flush();
  return { root, el };
}

/** The warnings `run` leads to (console.warn, first argument). */
async function warnings(run: () => Promise<unknown>): Promise<string[]> {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await run();
    await flush();
    return warn.mock.calls.map((c) => String(c[0]));
  } finally {
    warn.mockRestore();
    error.mockRestore();
  }
}

describe("束ねたパスが状態に無い（wcs/binding-path-missing）", () => {
  it("深いパスの誤字を 1 マクロタスク後に 1 回だけ、近い名前と lint への誘導付きで警告する", async () => {
    const got = await warnings(() => page(`<p>{{ user.nmae }}</p><i>{{ user.nmae }}</i>`, { user: { name: "a" } }));
    expect(got).toEqual([
      '[@wcstack/state] [wcs/binding-path-missing] Bound path "user.nmae" does not resolve on the state tree: "nmae" is not declared. Did you mean "name"? Updates to this path will be silently dropped. Validate statically: npx @wcstack/lint <file>.',
    ]);
  });

  it("for の中の相対パスはワイルドカードのパスで報告し、行の getter も近い名前の候補にする", async () => {
    const got = await warnings(() => page(`<ul><template data-wcs="for: items"><li>{{ .nmae }}|{{ .subtotl }}</li></template></ul>`, {
      items: [{ name: "a", price: 1 }],
      get "items.*.subtotal"() { return 1; },
    }));
    expect(got).toHaveLength(2);
    expect(got[0]).toContain('Bound path "items.*.nmae"');
    expect(got[1]).toContain('Did you mean "subtotal"?');
  });

  it("$watch のキーは wcs/watch-path-missing（1 段のキーも）", async () => {
    const got = await warnings(() => page(``, { count: 0, $watch: { cout() {}, count() {} } }));
    expect(got).toHaveLength(1);
    expect(got[0]).toContain('[wcs/watch-path-missing] $watch path "cout"');
    expect(got[0]).toContain('Did you mean "count"?');
  });

  it("1 段のバインディングは警告しない（読みが core の [wcs/binding-path-missing] で失敗する）", async () => {
    const got = await warnings(() => page(`<p>{{ cout }}</p>`, { count: 0 }));
    expect(got).toEqual([]);
  });

  it("確かに無いと言えないパスでは黙る（null・空の配列・途中の getter・ドット付きの getter・行の getter・再帰の展開）", async () => {
    const got = await warnings(() => page(
      `<p>{{ none.x }}</p><p>{{ items.0.x }}</p><ul><template data-wcs="for: empty"><li>{{ .x }}</li></template></ul>`
      + `<p>{{ view.a.b }}</p><p>{{ user.full }}</p><ul><template data-wcs="for: nodes"><li>{{ .total }}</li></template></ul>`,
      {
        none: null, items: [], empty: [],
        get view() { return { a: { b: 1 } }; },
        user: { first: "a" },
        get "user.full"() { return "a b"; },
        nodes: [{ value: 1, children: [] }],
        $recursion: { "nodes.*": "children.*" },
        get "nodes.**.total"() { return (this as any)["nodes.**.value"]; },
      },
    ));
    expect(got).toEqual([]);
  });

  it("再セットで新しい状態に対してもう一度確かめる（戻した状態では黙る）", async () => {
    const { el } = await page(`<p>{{ user.name }}</p>`, { user: { name: "a" } });
    const first = await warnings(async () => { el.setInitialState({ user: { nick: "b" } }); });
    expect(first).toHaveLength(1);
    expect(first[0]).toContain('"name" is not declared');
    const second = await warnings(async () => {
      el.setInitialState({ user: {} });
      el.setInitialState({ user: { name: "c" } });
    });
    expect(second).toEqual([]);
  });

  it("マウントしたコンポーネントの中のマウントしたキーは黙る", async () => {
    const tag = `diag-cmp-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      state = {};
      constructor() {
        super();
        this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state><p>{{ address.city }}</p>`;
      }
    });
    const got = await warnings(() => page(`<${tag} data-wcs="state: user"></${tag}>`, { user: { address: { city: "x" } } }));
    expect(got).toEqual([]);
  });
});

describe("再帰の静的な検査（wcs/recursion-declaration-invalid）", () => {
  const make = (extra: Record<string, PropertyDescriptor>) =>
    new Engine(Object.defineProperties({ nodes: [], $recursion: { "nodes.*": "children.*" } }, extra), new DirtyStrategy());
  const getter = { get() { return 1; }, enumerable: true, configurable: true };

  it("構造そのものを名指しする族、深さだけ違う 2 つの族、展開と同じ名前の具体的なキーを拒む", () => {
    expect(() => make({ "nodes.**.children": getter })).toThrow("names the recursion structure itself");
    expect(() => make({ "nodes.**.x": getter, "nodes.**.children.*.x": getter })).toThrow("expand to the same concrete path at different depths");
    expect(() => make({ "nodes.**.x": getter, "nodes.*.children.*.x": getter })).toThrow("is already defined on the state");
    expect(() => make({ "nodes.**.x": getter, "nodes.**.y": getter })).not.toThrow();
  });
});

describe("番号付きのコアのメッセージの文面（src/messages.ts）", () => {
  it("コアが番号で投げたものを、以前と同じ文面で出す", async () => {
    const { raise, M, text } = await import("../src/messages");
    expect(() => raise(M.Readonly)).toThrow(/^\[@wcstack\/state\] This state is readonly\.$/);
    expect(text(M.IndexArityAtMost, ["$getAll", "m.*", 1, 2])).toBe('[wcs/index-arity] $getAll("m.*") takes at most 1 index(es), got 2.');
    expect(text(M.IndexParamRange, ["$129"])).toBe('[wcs/index-param-range] "$129": list index parameters run from $1 to $128.');
    expect(text(M.DrainNotSettled)).toBe("updates did not settle after 32 passes");
  });

  it("文面の後に助言が続く（did-you-mean と lint への誘導）", async () => {
    const { parseBindTextsForElement } = await import("../src/parser/parseBindTextsForElement");
    expect(() => parseBindTextsForElement("textContent: a|b(")).toThrow(
      /^\[@wcstack\/state\] \[wcs\/binding-syntax\] Invalid filter format: missing closing parenthesis in "b\("\..*lint/s,
    );
  });

  it("バインディングの失敗の console も文面になる", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await page(`<p>{{ bad }}</p>`, { get bad() { throw new Error("boom"); } });
    expect(err).toHaveBeenCalledWith('[@wcstack/state] binding "text: bad" failed to apply.', expect.any(Error));
    err.mockRestore();
  });
});
