/**
 * オーバーレイ getter の公開（docs/state-overlay-export-design.md — D10 の開放）。
 *
 * 「ツリーに無いキーの読みは、その位置にマウントされたコンポーネントの getter で答える。
 * ツリーにあるキーはツリーが勝つ。私有キーとメソッドは見せない。」
 *
 * 受け入れマトリクス E1〜E11 をそのまま並べる。E3〜E5 は自己再帰コンポーネント
 * （自分自身を `for: children` の行に `state: .` でマウントする木）で、各段の
 * `total = value + Σ $getAll("children.*.total")` が深さに依らず閉じることを測る。
 *
 * happy-dom は `<template>` 内容のパース時にも constructor を走らせるため、shadow の
 * 構築は connectedCallback に置く（constructor だと自分自身を無限に生成する）。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));
let counter = 0;
const uniqueTag = (prefix: string): string => `${prefix}-${++counter}`;

function defineComponent(tag: string, stateFactory: () => Record<string, any>, innerTemplate: string): void {
  const markup = `<wcs-state bind-component="state"></wcs-state>${innerTemplate}`;
  class Comp extends HTMLElement {
    state: Record<string, any> = stateFactory();
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
    }
    connectedCallback() {
      if (this.shadowRoot!.childNodes.length === 0) {
        this.shadowRoot!.innerHTML = markup;
      }
    }
  }
  customElements.define(tag, Comp);
}

async function readyScope(root: DocumentFragment): Promise<State> {
  const stateElement = root.querySelector("wcs-state") as State;
  await stateElement.connectedCallbackPromise;
  await State.getBindingsReady(root as unknown as ShadowRoot);
  return stateElement;
}

async function mountHost(json: string, body: string) {
  const host = document.createElement(uniqueTag("me-host"));
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `<wcs-state json='${json}'></wcs-state>${body}`;
  document.body.appendChild(host);
  const rootState = await readyScope(shadowRoot);
  await flush();
  await flush();
  return { host, shadowRoot, rootState };
}

const textOf = (root: ParentNode, selector: string): string | null =>
  (root.querySelector(selector) as HTMLElement | null)?.textContent ?? null;

async function write(rootState: State, fn: (s: any) => void): Promise<void> {
  await rootState.createState("writable", (s: any) => { fn(s); });
  await flush();
  await flush();
}

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

describe("mountExport: 静的マウント（E1 / E6 / E7 / E8 / E10）", () => {
  it("E1: 親テンプレートが `session.user.display` を読むと、マウントされたコンポーネントの getter が答え、依存元の更新で再描画されること", async () => {
    const tag = uniqueTag("me-card");
    defineComponent(tag, () => ({
      get display() { return `${this.name} <${this.email}>`; },
    }), `<span class="inner" data-wcs="textContent: display"></span>`);
    const { host, shadowRoot, rootState } = await mountHost(
      '{"session":{"user":{"name":"Alice","email":"a@x"}}}',
      `<${tag} data-wcs="state: session.user"></${tag}>` +
      `<span class="outer" data-wcs="textContent: session.user.display"></span>`);
    const card = shadowRoot.querySelector(tag) as HTMLElement;
    await readyScope(card.shadowRoot!);
    await flush();
    expect(textOf(card.shadowRoot!, ".inner")).toBe("Alice <a@x>");
    expect(textOf(shadowRoot, ".outer")).toBe("Alice <a@x>");

    await write(rootState, (s) => { s["session.user.name"] = "Bob"; });
    expect(textOf(card.shadowRoot!, ".inner")).toBe("Bob <a@x>");
    expect(textOf(shadowRoot, ".outer")).toBe("Bob <a@x>");
    host.remove();
  });

  it("E6: ツリーに同名キーがあればツリーが勝ち、登録時に warn が 1 回出ること", async () => {
    const tag = uniqueTag("me-shadowed");
    defineComponent(tag, () => ({
      get label() { return "from-getter"; },
    }), `<span class="inner" data-wcs="textContent: label"></span>`);
    const { host, shadowRoot } = await mountHost(
      '{"item":{"label":"from-tree"}}',
      `<${tag} data-wcs="state: item"></${tag}>` +
      `<span class="outer" data-wcs="textContent: item.label"></span>`);
    const comp = shadowRoot.querySelector(tag) as HTMLElement;
    await readyScope(comp.shadowRoot!);
    await flush();
    // コンポーネント内では規則 1（getter）が勝つ。親からはツリー（X1）
    expect(textOf(comp.shadowRoot!, ".inner")).toBe("from-getter");
    expect(textOf(shadowRoot, ".outer")).toBe("from-tree");
    const messages = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(messages.filter((m) => m.includes("[wcs/mount-export-shadowed]") && m.includes("item.label"))).toHaveLength(1);
    host.remove();
  });

  it("E7: 同一パスに同名 getter を持つコンポーネントが 2 つマウントされていると、親からの読みが raise すること", async () => {
    const tagA = uniqueTag("me-dup-a");
    const tagB = uniqueTag("me-dup-b");
    defineComponent(tagA, () => ({ get display() { return "A"; } }), `<span data-wcs="textContent: display"></span>`);
    defineComponent(tagB, () => ({ get display() { return "B"; } }), `<span data-wcs="textContent: display"></span>`);
    const { host, shadowRoot, rootState } = await mountHost(
      '{"user":{"name":"x"}}',
      `<${tagA} data-wcs="state: user"></${tagA}><${tagB} data-wcs="state: user"></${tagB}>`);
    await readyScope((shadowRoot.querySelector(tagA) as HTMLElement).shadowRoot!);
    await readyScope((shadowRoot.querySelector(tagB) as HTMLElement).shadowRoot!);
    await flush();
    let error: unknown = null;
    await rootState.createState("readonly", (s: any) => {
      try { void s["user.display"]; } catch (e) { error = e; }
    });
    expect(String((error as Error)?.message)).toContain("user.display");
    expect(String((error as Error)?.message)).toContain(tagA);
    expect(String((error as Error)?.message)).toContain(tagB);
    host.remove();
  });

  it("E8: 私有キーとメソッドは親から見えない（undefined のまま）こと", async () => {
    const tag = uniqueTag("me-private");
    defineComponent(tag, () => ({
      editing: true,
      save() { return "saved"; },
      get display() { return this.name; },
    }), `<span data-wcs="textContent: display"></span>`);
    const { host, shadowRoot, rootState } = await mountHost(
      '{"user":{"name":"x"}}',
      `<${tag} data-wcs="state: user"></${tag}>`);
    await readyScope((shadowRoot.querySelector(tag) as HTMLElement).shadowRoot!);
    await flush();
    let editing: unknown = "unset";
    let save: unknown = "unset";
    let display: unknown = "unset";
    await rootState.createState("readonly", (s: any) => {
      editing = s["user.editing"];
      save = s["user.save"];
      display = s["user.display"];
    });
    expect(editing).toBeUndefined();
    expect(save).toBeUndefined();
    expect(display).toBe("x");
    host.remove();
  });

  it("E10: getter のみの公開キーへの親からの書き込みは raise し、setter があれば setter が評価されること", async () => {
    const tag = uniqueTag("me-write");
    defineComponent(tag, () => ({
      get display() { return this.name; },
      get upper() { return String(this.name).toUpperCase(); },
      set upper(v: string) { this.name = String(v).toLowerCase(); },
    }), `<span data-wcs="textContent: display"></span>`);
    const { host, shadowRoot, rootState } = await mountHost(
      '{"user":{"name":"x"}}',
      `<${tag} data-wcs="state: user"></${tag}><span class="outer" data-wcs="textContent: user.name"></span>`);
    await readyScope((shadowRoot.querySelector(tag) as HTMLElement).shadowRoot!);
    await flush();
    let error: unknown = null;
    await rootState.createState("writable", (s: any) => {
      try { s["user.display"] = "y"; } catch (e) { error = e; }
    });
    expect(String((error as Error)?.message)).toContain("no setter");
    let raw: unknown = "unset";
    await rootState.createState("readonly", (s: any) => { raw = s["user.display"]; });
    expect(raw).toBe("x"); // ツリーにキーが作られていない（getter を隠していない）

    await write(rootState, (s) => { s["user.upper"] = "ZED"; });
    expect(textOf(shadowRoot, ".outer")).toBe("zed");
    host.remove();
  });

  it("E11: マウントの無い state では未存在パスの読みが今日どおり undefined であること", async () => {
    const { host, rootState } = await mountHost('{"user":{"name":"x"}}', ``);
    let value: unknown = "unset";
    await rootState.createState("readonly", (s: any) => { value = s["user.display"]; });
    expect(value).toBeUndefined();
    host.remove();
  });

  it("親オブジェクトが消えた後は公開 getter を評価せず undefined を返すこと", async () => {
    const tag = uniqueTag("me-missing-parent");
    const getter = vi.fn(() => "available");
    defineComponent(tag, () => ({ get display() { return getter(); } }), "");
    const { host, shadowRoot, rootState } = await mountHost('{"user":{}}', `<${tag} data-wcs="state: user"></${tag}>`);
    try {
      await readyScope((shadowRoot.querySelector(tag) as HTMLElement).shadowRoot!);
      await rootState.createState("readonly", (s: any) => { expect(s["user.display"]).toBe("available"); });
      getter.mockClear();
      for (const value of [null, undefined]) {
        await write(rootState, (s) => { s.user = value; });
        await rootState.createState("readonly", (s: any) => { expect(s["user.display"]).toBeUndefined(); });
      }
      expect(getter).not.toHaveBeenCalled();
    } finally {
      host.remove();
    }
  });
});

describe("mountExport: 行マウントと自己再帰（E2 / E3 / E4 / E5）", () => {
  it("E10: 行の公開 setter が正規化した値を親・子・行バインドが読み、getter のみへの失敗した書き込みもキャッシュを固定しないこと", async () => {
    const tag = uniqueTag("me-row-write");
    defineComponent(tag, () => ({
      get upper() { return `${this.name}!`; },
      set upper(v: string) { this.name = v.toLowerCase(); },
      get display() { return `${this.name}?`; },
    }), `<span class="inner" data-wcs="textContent: upper"></span>`);
    const { host, shadowRoot, rootState } = await mountHost(
      '{"users":[{"name":"a"},{"name":"b"}]}',
      `<template data-wcs="for: users"><${tag} data-wcs="state: ."></${tag}>` +
      `<span class="outer" data-wcs="textContent: .upper"></span></template>`);
    try {
      const comps = Array.from(shadowRoot.querySelectorAll(tag)) as HTMLElement[];
      for (const comp of comps) await readyScope(comp.shadowRoot!);
      await write(rootState, (s) => {
        s["users.0.upper"] = "ZED";
        expect(s["users.0.upper"]).toBe("zed!");
        expect(() => { s["users.0.display"] = "bad"; }).toThrow(/no setter/);
        expect(s["users.0.display"]).toBe("zed?");
      });
      await rootState.createState("readonly", (s: any) => {
        expect(s.$getAll("users.*.upper")).toEqual(["zed!", "b!"]);
        expect(s["users.0.display"]).toBe("zed?");
      });
      expect(comps.map((c) => textOf(c.shadowRoot!, ".inner"))).toEqual(["zed!", "b!"]);
      expect(Array.from(shadowRoot.querySelectorAll(".outer"), (e) => e.textContent)).toEqual(["zed!", "b!"]);
    } finally {
      host.remove();
    }
  });

  it("内部ワイルドカード getter は親へ公開せず、未解決の行バインドの警告を抑止しないこと", async () => {
    const tag = uniqueTag("me-wildcard");
    defineComponent(tag, () => ({
      get "children.*.label"() { return "local"; },
    }), `<template data-wcs="for: children"><span class="inner" data-wcs="textContent: .label"></span></template>`);
    const { host, shadowRoot, rootState } = await mountHost(
      '{"root":{"children":[{},{}]}}',
      `<${tag} data-wcs="state: root"></${tag}>` +
      `<template data-wcs="for: root.children"><span class="outer" data-wcs="textContent: .label"></span></template>`);
    try {
      const comp = shadowRoot.querySelector(tag) as HTMLElement;
      await readyScope(comp.shadowRoot!);
      await flush();
      expect(Array.from(comp.shadowRoot!.querySelectorAll(".inner"), (e) => e.textContent)).toEqual(["local", "local"]);
      await rootState.createState("readonly", (s: any) => {
        expect(s.$getAll("root.children.*.label")).toEqual([undefined, undefined]);
      });
      const missing = warnSpy.mock.calls.map((c) => String(c[0])).filter((m) =>
        m.includes("[wcs/binding-path-missing]") && m.includes('"root.children.*.label"'));
      expect(missing).toHaveLength(1);
    } finally {
      host.remove();
    }
  });

  it("E2: 行マウント `state: .` の getter を親の `$getAll(\"users.*.display\")` と行バインドで読めること", async () => {
    const tag = uniqueTag("me-row");
    defineComponent(tag, () => ({
      get display() { return `${this.name}!`; },
    }), `<span data-wcs="textContent: display"></span>`);
    const { host, shadowRoot, rootState } = await mountHost(
      '{"users":[{"name":"a"},{"name":"b"}]}',
      `<ul><template data-wcs="for: users"><li><${tag} data-wcs="state: ."></${tag}>` +
      `<span class="outer" data-wcs="textContent: .display"></span></li></template></ul>`);
    const comps = Array.from(shadowRoot.querySelectorAll(tag)) as HTMLElement[];
    expect(comps).toHaveLength(2);
    for (const c of comps) await readyScope(c.shadowRoot!);
    await flush(); await flush();
    const outers = () => Array.from(shadowRoot.querySelectorAll(".outer")).map((e) => e.textContent);
    expect(outers()).toEqual(["a!", "b!"]);
    let all: unknown = null;
    await rootState.createState("readonly", (s: any) => { all = s.$getAll("users.*.display", []); });
    expect(all).toEqual(["a!", "b!"]);

    await write(rootState, (s) => { s["users.1.name"] = "B"; });
    expect(outers()).toEqual(["a!", "B!"]);
    host.remove();
  });

  async function mountTree(json: string, onEvaluate?: (label: string) => void) {
    const tag = uniqueTag("me-tree");
    defineComponent(tag, () => ({
      open: false,
      get total(): number {
        const self = this as any;
        onEvaluate?.(self.label);
        const kids: unknown[] = self.$getAll("children.*.total") ?? [];
        return (Number(self.value) || 0) + kids.reduce<number>((a, b) => a + (Number(b) || 0), 0);
      },
    }),
      `<span class="label" data-wcs="textContent: label"></span>` +
      `<span class="total" data-wcs="textContent: total"></span>` +
      `<ul><template data-wcs="for: children"><li><${tag} data-wcs="state: ."></${tag}></li></template></ul>`);
    const { host, shadowRoot, rootState } = await mountHost(json, `<${tag} data-wcs="state: root"></${tag}>`);
    const kidsOf = (n: HTMLElement) => Array.from(n.shadowRoot!.querySelectorAll(`ul > li > ${tag}`)) as HTMLElement[];
    const settle = async (n: HTMLElement): Promise<void> => {
      await readyScope(n.shadowRoot!);
      await flush();
      for (const k of kidsOf(n)) await settle(k);
    };
    const root = shadowRoot.querySelector(tag) as HTMLElement;
    await settle(root);
    await flush(); await flush(); await flush();
    const totalOf = (n: HTMLElement) => textOf(n.shadowRoot!, ".total");
    return { host, rootState, root, kidsOf, totalOf, settle };
  }

  const TREE = '{"root":{"label":"r","value":1,"children":[' +
    '{"label":"a","value":10,"children":[{"label":"a1","value":100,"children":[]}]},' +
    '{"label":"b","value":20,"children":[]}]}}';

  it("E3: 深さ 3 の木で各段の total が閉じ、葉の更新が根まで届くこと", async () => {
    const { host, rootState, root, kidsOf, totalOf } = await mountTree(TREE);
    const [a, b] = kidsOf(root);
    const [a1] = kidsOf(a);
    expect([totalOf(root), totalOf(a), totalOf(b), totalOf(a1)]).toEqual(["131", "110", "20", "100"]);

    await write(rootState, (s) => { s["root.children.0.children.0.value"] = 200; });
    expect([totalOf(a1), totalOf(a), totalOf(root)]).toEqual(["200", "210", "231"]);
    host.remove();
  });

  it("E4: 子を後から足すと新しい段が生え、祖先の total が収束すること", async () => {
    const { host, rootState, root, kidsOf, totalOf, settle } = await mountTree(TREE);
    const [, b] = kidsOf(root);
    await write(rootState, (s) => {
      s["root.children.1.children"] = [...s["root.children.1.children"], { label: "b1", value: 5, children: [] }];
    });
    const [b1] = kidsOf(b);
    expect(b1).toBeTruthy();
    await settle(b1);
    await flush(); await flush();
    expect([totalOf(b1), totalOf(b), totalOf(root)]).toEqual(["5", "25", "136"]);
    host.remove();
  });

  it("E5: 子を減らすと祖先の total が再評価されること", async () => {
    const { host, rootState, root, kidsOf, totalOf } = await mountTree(TREE);
    await write(rootState, (s) => { s["root.children.0.children"] = []; });
    const [a] = kidsOf(root);
    expect(kidsOf(a)).toHaveLength(0);
    expect([totalOf(a), totalOf(root)]).toEqual(["10", "31"]);
    host.remove();
  });

  it.each([2, 3, 5])("P2-5: 深さ %i・分岐 3 の木で葉を 100 回更新しても再評価は祖先経路に限定されること", async (depth) => {
    const evaluations: string[] = [];
    const tree = (level: number, label: string): object => ({
      label, value: 1,
      children: level === depth ? [] : Array.from({ length: 3 }, (_, i) => tree(level + 1, `${label}.${i}`)),
    });
    const { host, rootState, root, totalOf } = await mountTree(JSON.stringify({ root: tree(0, "r") }), (label) => evaluations.push(label));
    try {
      const nodes = (3 ** (depth + 1) - 1) / 2;
      expect(totalOf(root)).toBe(String(nodes));
      evaluations.length = 0;
      const ancestorPath = new Set(Array.from({ length: depth + 1 }, (_, level) => `r${".0".repeat(level)}`));
      for (let update = 1; update <= 100; update++) {
        evaluations.length = 0;
        await write(rootState, (s) => { s[`root${".children.0".repeat(depth)}.value`] = update + 1; });
        expect(totalOf(root)).toBe(String(nodes + update));
        expect(new Set(evaluations)).toEqual(ancestorPath);
        // Allow a second evaluation during propagation, bounded by path length.
        expect(evaluations.length).toBeLessThanOrEqual(2 * (depth + 1));
      }
    } finally {
      host.remove();
    }
  }, 30000);
});

describe("mountExport: 遅延診断と devtools（E9 / X7）", () => {
  it("E9: 公開 getter へのバインドは子の登録前に確立しても [wcs/binding-path-missing] を出さず、未解決のままなら 1 マクロタスク後に 1 回出ること", async () => {
    const tag = uniqueTag("me-diag");
    defineComponent(tag, () => ({
      get display() { return this.name; },
    }), `<span data-wcs="textContent: display"></span>`);
    const { host, shadowRoot } = await mountHost(
      '{"user":{"name":"x"}}',
      // 親テンプレートの順序: 公開 getter へのバインドがホスト要素より先（子未登録で評価される）
      `<span class="outer" data-wcs="textContent: user.display"></span>` +
      `<span class="typo" data-wcs="textContent: user.dispaly"></span>` +
      `<${tag} data-wcs="state: user"></${tag}>`);
    await readyScope((shadowRoot.querySelector(tag) as HTMLElement).shadowRoot!);
    await flush();
    await flush();
    expect(textOf(shadowRoot, ".outer")).toBe("x");
    const missing = warnSpy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("[wcs/binding-path-missing]"));
    expect(missing.filter((m) => m.includes('"user.display"'))).toHaveLength(0);
    expect(missing.filter((m) => m.includes('"user.dispaly"'))).toHaveLength(1);
    host.remove();
  });

  it("devtools の overlays() が公開パスを exports として返すこと", async () => {
    const { getMountRecordsForStateElement } = await import("../src/webComponent/mount");
    const tag = uniqueTag("me-dev");
    defineComponent(tag, () => ({
      editing: false,
      get display() { return this.name; },
    }), `<span data-wcs="textContent: display"></span>`);
    const { host, shadowRoot, rootState } = await mountHost('{"user":{"name":"x"}}', `<${tag} data-wcs="state: user"></${tag}>`);
    await readyScope((shadowRoot.querySelector(tag) as HTMLElement).shadowRoot!);
    const records = getMountRecordsForStateElement(rootState as any);
    expect(records.map((r) => [...r.exports.keys()])).toEqual([["user.display"]]);
    host.remove();
  });
});
