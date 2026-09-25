import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, DirtyStrategy, Engine, getBindingsReady, installFeatures, recursion, scopes } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([recursion]);
  bootstrapState();
});

const forest = () => [
  { value: 1, tags: [{ v: 3 }], children: [{ value: 10, tags: [{ v: 4 }, { v: 5 }], children: [{ value: 100, tags: [], children: [] }] }, { value: 20, tags: [], children: [] }] },
  { value: 2, tags: [{ v: 7 }], children: [] },
];

const total = {
  get "nodes.**.total"() {
    const self = this as any;
    return self["nodes.**.value"] + self.$getAll("nodes.**.children.*.total").reduce((a: number, b: number) => a + b, 0);
  },
};

/** `state` with the `total` family (descriptors copied: a spread would call the getter). */
const withTotal = (state: Record<string, any>) => Object.defineProperties(state, Object.getOwnPropertyDescriptors(total));

/** An engine over `state` with the `nodes.*` / `children.*` anchor (descriptors kept). */
const make = (state: Record<string, any>) =>
  new Engine(Object.defineProperties({ $recursion: { "nodes.*": "children.*" } }, Object.getOwnPropertyDescriptors(state)), new DirtyStrategy());

describe("宣言（wcs/recursion-declaration-invalid ほか）", () => {
  it.each([
    [{ $recursion: "nodes.*" }, "must be an object"],
    [{ $recursion: {} }, "exactly one anchor"],
    [{ $recursion: { "a.*": "b.*", "c.*": "d.*" } }, "exactly one anchor"],
    [{ $recursion: { nodes: "children.*" } }, 'must end with ".*"'],
    [{ $recursion: { "a.*.b.*": "c.*" } }, 'exactly one "*"'],
    [{ $recursion: { "a.0.b.*": "c.*" } }, 'exactly one "*"'],
    [{ $recursion: { "$a.*": "c.*" } }, 'must not start with "$"'],
    [{ $recursion: { "a#m.*": "c.*" } }, 'must not contain "#"'],
    [{ $recursion: { "nodes.*": "" } }, "non-empty string"],
  ])("不正な宣言を拒む（%#）", (state, message) => {
    expect(() => new Engine(state as any, new DirtyStrategy())).toThrow(message);
  });

  it("** の getter は錨から始まり、** の後にパスを持ち、setter を持たない", () => {
    expect(() => make({ get "items.**.x"() { return 1; } })).toThrow("[wcs/recursion-anchor]");
    expect(() => make({ get "nodes.**"() { return 1; } })).toThrow("[wcs/recursion-anchor]");
    expect(() => make({ get "nodes.**.x"() { return 1; }, set "nodes.**.x"(_v: unknown) {} })).toThrow("a getter without a setter");
  });

  it("$recursion の無い状態の ** は [wcs/recursion-unsupported]", () => {
    expect(() => new Engine({ get "nodes.**.x"() { return 1; } }, new DirtyStrategy())).toThrow("[wcs/recursion-unsupported]");
  });
});

describe("全深さの $getAll と一斉書き込み", () => {
  it("接尾辞のワイルドカードは各ノードで展開し、深さ優先・前順で集める。** だけならノードそのもの", () => {
    const e = make({ nodes: forest() });
    expect(e.proxy.$getAll("nodes.**.tags.*.v", [])).toEqual([3, 4, 5, 7]);
    expect(e.proxy.$getAll("nodes.**", []).map((n: any) => n.value)).toEqual([1, 10, 100, 20, 2]);
    expect(e.proxy.$getAll("nodes.**.missing", [])).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("途中の添字や添字でない値は [wcs/recursion-getall-form]", () => {
    const e = make({ nodes: forest() });
    expect(() => e.proxy.$getAll("nodes.**.value", [0])).toThrow("[wcs/recursion-getall-form]");
    expect(() => e.proxy.$getAll("nodes.**.value", null)).toThrow("[wcs/recursion-getall-form]");
  });

  it("同じ配列を 2 度通る木・自分に戻る木・129 段の木は拒む", () => {
    const shared: any[] = [{ value: 9, children: [] }];
    expect(() => make({ nodes: [{ value: 1, children: shared }, { value: 2, children: shared }] }).proxy.$getAll("nodes.**.value", []))
      .toThrow("[wcs/recursion-shared-list]");
    const loop: any = { value: 1, children: [] };
    loop.children = [loop];
    expect(() => make({ nodes: [loop] }).proxy.$getAll("nodes.**.value", [])).toThrow("[wcs/recursion-cycle]");
    const chain = (n: number): any => ({ value: n, children: n === 0 ? [] : [chain(n - 1)] });
    expect(make({ nodes: [chain(127)] }).proxy.$getAll("nodes.**.value", [])).toHaveLength(128);
    expect(() => make({ nodes: [chain(128)] }).proxy.$getAll("nodes.**.value", [])).toThrow("[wcs/recursion-depth-exceeded]");
  });

  it("再帰の getter の中で [] を使うと自分を含むので [wcs/getter-cycle]", () => {
    const e = make({ nodes: forest(), get "nodes.**.bad"() { return (this as any).$getAll("nodes.**.bad", []).length; } });
    expect(() => e.proxy.$resolve("nodes.*.bad", [0])).toThrow("[wcs/getter-cycle]");
  });

  it("一斉書き込みは書いた数を返し、形の誤りや木の誤りでは何も書かない", () => {
    const e = make(withTotal({ nodes: forest() }));
    expect(e.proxy.$setAll("nodes.**.selected", [], true)).toBe(5);
    expect(e.proxy.$getAll("nodes.**.selected", [])).toEqual([true, true, true, true, true]);
    expect(() => e.proxy.$setAll("nodes.**.value", [], (v: number) => v + 1)).toThrow("plain value");
    expect(() => e.proxy.$setAll("nodes.**.value", [], [1], { spread: true })).toThrow("plain value");
    expect(() => e.proxy.$setAll("nodes.**.value", undefined as any, 1)).toThrow("needs indexes");
    expect(() => e.proxy.$setAll("nodes.**.children.*", [], 1)).toThrow("[wcs/recursion-structural-write]");
    expect(() => e.proxy.$setAll("nodes.**.total", [], 1)).toThrow("[wcs/recursion-readonly]");
    const shared: any[] = [{ value: 9, children: [] }];
    const bad = make({ nodes: [{ value: 1, children: shared }, { value: 2, children: shared }] });
    expect(() => bad.proxy.$setAll("nodes.**.value", [], 0)).toThrow("[wcs/recursion-shared-list]");
    expect(bad.proxy.$resolve("nodes.*.value", [0])).toBe(1);
  });

  it("展開への書き込みはどの経路でも [wcs/recursion-readonly]", () => {
    const e = make(withTotal({ nodes: forest() }));
    expect(e.proxy.$resolve("nodes.*.children.*.total", [0, 0])).toBe(110);
    expect(() => { e.proxy["nodes.0.children.0.total"] = 1; }).toThrow("[wcs/recursion-readonly]");
    expect(() => e.proxy.$resolve("nodes.*.total", [1], 5)).toThrow("[wcs/recursion-readonly]");
  });
});

describe("<wcs-state> の中の再帰パス", () => {
  async function host(html: string, state: Record<string, any>, family = false) {
    if (family) withTotal(state);
    const h = document.createElement(`recursion-test-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state>${html}`;
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState(state);
    document.body.appendChild(h);
    await el.connectedCallbackPromise;
    await getBindingsReady(root);
    await flush();
    return { root, el };
  }

  it("data-wcs の ** は解析の時点で [wcs/recursion-unsupported]（初期化の失敗）", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = document.createElement(`recursion-test-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state><p>{{ nodes.**.total }}</p>`;
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState(withTotal({ nodes: forest(), $recursion: { "nodes.*": "children.*" } }));
    document.body.appendChild(h);
    await expect(el.connectedCallbackPromise).rejects.toThrow("[wcs/recursion-unsupported]");
    error.mockRestore();
  });

  it("イベントハンドラの ** はその行の深さに束ねる", async () => {
    const seen: number[] = [];
    const { root } = await host(`<ul><template data-wcs="for: nodes"><li data-wcs="onclick: pick">{{ .value }}</li></template></ul>`, {
      nodes: forest(), $recursion: { "nodes.*": "children.*" },
      pick(this: any) { seen.push(this["nodes.**.value"]); },
    });
    (root.querySelectorAll("li")[1] as HTMLElement).click();
    expect(seen).toEqual([2]);
  });

  it("再セットは新しい宣言を差し替えの前に検査し、族の式の変更を描き直す", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { root, el } = await host(`<ul><template data-wcs="for: nodes"><li>{{ .total }}</li></template></ul>`, {
      nodes: forest(), $recursion: { "nodes.*": "children.*" },
    }, true);
    const texts = () => Array.from(root.querySelectorAll("li")).map((li) => li.textContent);
    expect(texts()).toEqual(["131", "2"]);
    expect(() => el.setInitialState({ nodes: forest(), $recursion: { nodes: "children.*" } })).toThrow('must end with ".*"');
    expect(texts()).toEqual(["131", "2"]);
    el.setInitialState({
      nodes: forest(), $recursion: { "nodes.*": "children.*" },
      get "nodes.**.total"() { return (this as any)["nodes.**.value"] * 2; },
    });
    await flush();
    expect(texts()).toEqual(["2", "4"]);
    error.mockRestore();
  });
});

describe("自己参照するコンポーネントの木", () => {
  it("いちばん深いコンポーネントの中から書いた葉の値と、足した子で、全段の再帰の getter が描き直される", async () => {
    installFeatures([scopes]);
    const tag = `recursion-tree-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      state = { addChild(this: any) { this.children = [...this.children, { value: 5, children: [] }]; } };
      connectedCallback() {
        if (this.shadowRoot) return;
        this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state>`
          + `<span>{{ value }}/{{ total }}</span><ul><template data-wcs="for: children"><li><${tag} data-wcs="state: ."></${tag}></li></template></ul>`;
      }
    });
    const h = document.createElement(`recursion-test-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state><p>{{ treeTotal }}</p><template data-wcs="for: nodes"><${tag} data-wcs="state: ."></${tag}></template>`;
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState(withTotal({
      nodes: [{ value: 1, children: [{ value: 10, children: [{ value: 100, children: [] }] }] }],
      $recursion: { "nodes.*": "children.*" },
      get treeTotal() { return (this as any).$getAll("nodes.**.value", []).reduce((a: number, b: number) => a + b, 0); },
    }));
    document.body.appendChild(h);
    await el.connectedCallbackPromise;
    for (let i = 0; i < 4; i++) await flush();
    const all = () => {
      const out: string[] = [root.querySelector("p")!.textContent!];
      const visit = (r: ShadowRoot) => {
        for (const t of Array.from(r.querySelectorAll(tag))) {
          out.push(t.shadowRoot!.querySelector("span")!.textContent!);
          visit(t.shadowRoot!);
        }
      };
      visit(root);
      return out.join(" ");
    };
    expect(all()).toBe("111 1/111 10/110 100/100");
    const deepest = root.querySelector(tag)!.shadowRoot!.querySelector(tag)!.shadowRoot!.querySelector(tag) as any;
    deepest.state.value = 1000;
    for (let i = 0; i < 4; i++) await flush();
    expect(all()).toBe("1011 1/1011 10/1010 1000/1000");
    // a child added under a node (from inside it), then under that new node: depths no row had
    deepest.state.addChild();
    for (let i = 0; i < 4; i++) await flush();
    expect(all()).toBe("1016 1/1016 10/1015 1000/1005 5/5");
    const added = deepest.shadowRoot.querySelector(tag);
    added.state.addChild();
    for (let i = 0; i < 4; i++) await flush();
    expect(all()).toBe("1021 1/1021 10/1020 1000/1010 5/10 5/5");
  });
});
