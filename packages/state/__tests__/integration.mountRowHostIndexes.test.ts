/**
 * #322 / #323: ホストの `for:` 行の中にマウントしたコンポーネントが、コンポーネントの語彙で
 * 書いたパスを行の外側のワイルドカードまで解決できること（README「Whole-object Mount」の
 * 「ホストの行の添字は自動で前に付く」）。
 *
 * - #322: 部分マウントだけの記録（`state.items: .items`）はマーカー基底 `#m<id>` が行の
 *   ワイルドカードを持たないので、ワイルドカードの無い getter・メソッドの評価中にホストの行が
 *   得られなかった。`$getAll` / `$setAll` / `$resolve` は添字 0 本として投げ、添字を省略した
 *   `$getAll` は全ホスト行へ展開して他の行を混ぜた値を黙って返し、素の読み（`this.items`）も
 *   `ListIndex not found` で投げた。
 * - #323: 数値添字の文字列パス（`this["items.0.v"]`）は接頭辞のワイルドカードが具体化されず
 *   `groups.*.items.0.v`（partial）になって投げた — 丸ごとマウント（`state: .`）でも同じ。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";

beforeAll(() => {
  bootstrapState();
});

const hosts: HTMLElement[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const host of hosts.splice(0)) host.remove();
});

const flush = () => new Promise((r) => setTimeout(r));

let counter = 0;
const uniqueTag = (prefix: string): string => `${prefix}-${++counter}`;

function defineComponent(tag: string, createState: () => Record<string, any>, innerTemplate: string): void {
  class Component extends HTMLElement {
    state: Record<string, any> = createState();
    constructor() {
      super();
      this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state>${innerTemplate}`;
    }
  }
  customElements.define(tag, Component);
}

async function mountHost(json: string, body: string, tag: string) {
  const host = document.createElement(uniqueTag("mrhi-host"));
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `<wcs-state json='${json}'></wcs-state>${body}`;
  document.body.appendChild(host);
  hosts.push(host);
  const parentStateElement = shadowRoot.querySelector("wcs-state") as State;
  await parentStateElement.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  await flush();
  const components = () => Array.from(shadowRoot.querySelectorAll(tag)) as any[];
  const settle = async (): Promise<void> => {
    for (const component of components()) {
      const childShadow = component.shadowRoot!;
      const childStateElement = childShadow.querySelector("wcs-state") as State;
      await childStateElement.connectedCallbackPromise;
      await State.getBindingsReady(childShadow);
    }
    await flush();
    await flush();
  };
  await settle();
  const readParent = (path: string): unknown => {
    let value: unknown;
    parentStateElement.createState("readonly", (state: any) => { value = state[path]; });
    return value;
  };
  const write = async (fn: (state: any) => void): Promise<void> => {
    parentStateElement.createState("writable", fn);
    await settle();
  };
  return { host, shadowRoot, parentStateElement, components, settle, readParent, write };
}

const text = (component: HTMLElement, selector: string) =>
  (component.shadowRoot!.querySelector(selector) as HTMLElement).textContent;
const texts = (component: HTMLElement, selector: string) =>
  Array.from(component.shadowRoot!.querySelectorAll(selector)).map((node) => node.textContent);
const click = (component: HTMLElement, selector: string, at = 0) =>
  (component.shadowRoot!.querySelectorAll(selector)[at] as HTMLElement).click();
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

const GROUPS = JSON.stringify({ groups: [{ id: "A", items: [{ v: 1 }, { v: 2 }] }, { id: "B", items: [{ v: 3 }, { v: 4 }] }] });
const LIST = '<ul><template data-wcs="for: items"><li>{{ .v }}</li></template></ul>';

const WIRINGS = [
  ["部分マウント", "state.items: .items"],
  ["丸ごとマウント", "state: ."],
] as const;

function rowBody(tag: string, wiring: string): string {
  return `<template data-wcs="for: groups"><section><b>{{ .id }}</b><${tag} data-wcs="${wiring}"></${tag}></section></template>`;
}

function spyErrors(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

/** console.error の引数（文字列・Error・{ error } 形）を 1 本の文字列にする */
function errorText(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.flat().map((arg: any) =>
    arg instanceof Error ? arg.message : arg?.error instanceof Error ? arg.error.message : String(arg)).join(" ");
}

describe("行の中のコンポーネントの getter（#322）", () => {
  for (const [label, wiring] of WIRINGS) {
    it(`${label}: ワイルドカードの無い getter の $getAll / 素の読み / 添字パスが、その行の値になること`, async () => {
      const tag = uniqueTag("mrhi-getter");
      defineComponent(tag, () => ({
        get total() { return sum(this.$getAll("items.*.v", [])); },
        get totalOmitted() { return sum(this.$getAll("items.*.v")); },
        get firstOnly() { return sum(this.$getAll("items.*.v", [0])); },
        get count() { return this.items.length; },
        get first() { return this["items.0.v"]; },
      }), LIST + '<p class="t">{{ total }}</p><p class="o">{{ totalOmitted }}</p><p class="z">{{ firstOnly }}</p>'
        + '<p class="c">{{ count }}</p><p class="f">{{ first }}</p>');
      const errors = spyErrors();
      const env = await mountHost(GROUPS, rowBody(tag, wiring), tag);
      const view = () => env.components().map((c) => [text(c, ".t"), text(c, ".o"), text(c, ".z"), text(c, ".c"), text(c, ".f")]);

      // 添字を省略した $getAll は他の行を混ぜない（旧挙動は部分マウントで 10 / 10）
      expect(view()).toEqual([["3", "3", "1", "2", "1"], ["7", "7", "3", "2", "3"]]);
      expect(errors).not.toHaveBeenCalled();
    });

    it(`${label}: ホストの書き込み・行の追加・入れ替え・グループの追加に getter が追従すること`, async () => {
      const tag = uniqueTag("mrhi-react");
      defineComponent(tag, () => ({
        get total() { return sum(this.$getAll("items.*.v", [])); },
        get count() { return this.items.length; },
        get first() { return this["items.0.v"]; },
        bump() { this["items.0.v"] = this["items.0.v"] + 10; },
      }), LIST + '<p class="t">{{ total }}</p><p class="c">{{ count }}</p><p class="f">{{ first }}</p>'
        + '<button class="b" data-wcs="onclick: bump"></button>');
      const errors = spyErrors();
      const env = await mountHost(GROUPS, rowBody(tag, wiring), tag);
      const view = () => Array.from(env.shadowRoot.querySelectorAll("section")).map((section) => {
        const c = section.querySelector(tag) as HTMLElement;
        return `${section.querySelector("b")!.textContent}:${text(c, ".t")}/${text(c, ".c")}/${text(c, ".f")}`;
      });

      await env.write((state) => { state["groups.1.items.0.v"] = 30; });
      expect(view()).toEqual(["A:3/2/1", "B:34/2/30"]);
      await env.write((state) => { state["groups.1.items"] = [...state["groups.1.items"], { v: 100 }]; });
      expect(view()).toEqual(["A:3/2/1", "B:134/3/30"]);
      await env.write((state) => { state.groups = [state.groups[1], state.groups[0]]; });
      expect(view()).toEqual(["B:134/3/30", "A:3/2/1"]);
      click(env.components()[0], ".b");
      await env.settle();
      expect(view()).toEqual(["B:144/3/40", "A:3/2/1"]);
      await env.write((state) => { state.groups = [...state.groups, { id: "C", items: [{ v: 5 }] }]; });
      expect(view()).toEqual(["B:144/3/40", "A:3/2/1", "C:5/1/5"]);
      expect(errors).not.toHaveBeenCalled();
    });

    it(`${label}: 行の content を別の行へ使い回しても・要素書き込みで行を置き換えても、getter が新しい行の値になること`, async () => {
      const tag = uniqueTag("mrhi-reuse");
      defineComponent(tag, () => ({
        get total() { return sum(this.$getAll("items.*.v", [])); },
        get count() { return this.items.length; },
        get first() { return this["items.0.v"]; },
      }), '<p class="t">{{ total }}</p><p class="c">{{ count }}</p><p class="f">{{ first }}</p>');
      const errors = spyErrors();
      const env = await mountHost(GROUPS, rowBody(tag, wiring), tag);
      const view = () => env.components().map((c) => [text(c, ".t"), text(c, ".c"), text(c, ".f")]);
      const componentOfA = env.components()[0];

      await env.write((state) => { state.groups = [state.groups[1]]; });
      await env.write((state) => { state.groups = [...state.groups, { id: "C", items: [{ v: 10 }, { v: 20 }, { v: 30 }] }]; });
      // プールから A の行の content が C に使い回される — 旧行のキャッシュが残らないこと
      expect(env.components()[1]).toBe(componentOfA);
      expect(view()).toEqual([["7", "2", "3"], ["60", "3", "10"]]);

      await env.write((state) => { const groups = [...state.groups]; groups[0] = { id: "D", items: [{ v: 7 }] }; state.groups = groups; });
      expect(view()).toEqual([["7", "1", "7"], ["60", "3", "10"]]);
      await env.write((state) => { state["groups.0.items.0.v"] = 70; });
      expect(view()).toEqual([["70", "1", "70"], ["60", "3", "10"]]);
      expect(errors).not.toHaveBeenCalled();
    });
  }

  it("README の Loop with Components（state.message: .name）に getter を足しても描けること", async () => {
    const tag = uniqueTag("mrhi-readme");
    let fromMethod: unknown = null;
    defineComponent(tag, () => ({
      get shout() { return String(this.message).toUpperCase(); },
      read() { fromMethod = this.message; },
    }), '<div class="m">{{ message }}</div><div class="s">{{ shout }}</div><button class="b" data-wcs="onclick: read"></button>');
    const errors = spyErrors();
    const env = await mountHost(JSON.stringify({ users: [{ name: "alice" }, { name: "bob" }] }),
      `<template data-wcs="for: users"><${tag} data-wcs="state.message: .name"></${tag}></template>`, tag);

    expect(env.components().map((c) => [text(c, ".m"), text(c, ".s")])).toEqual([["alice", "ALICE"], ["bob", "BOB"]]);
    click(env.components()[1], ".b");
    await env.settle();
    expect(fromMethod).toBe("bob");
    await env.write((state) => { state["users.0.name"] = "carol"; });
    expect(env.components().map((c) => text(c, ".s"))).toEqual(["CAROL", "BOB"]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("ホストの絶対パスで書いた $getAll はコンポーネントの語彙の外として従来どおり拒否されること", async () => {
    const tag = uniqueTag("mrhi-abs");
    defineComponent(tag, () => ({
      get total() { return sum(this.$getAll("groups.*.items.*.v", [1])); },
    }), '<p class="t">{{ total }}</p>');
    const errors = spyErrors();
    const env = await mountHost(GROUPS, rowBody(tag, "state.items: .items"), tag);

    expect(env.components().map((c) => text(c, ".t"))).toEqual(["", ""]);
    expect(errorText(errors)).toMatch(/no mount entry covers it/);
  });
});

describe("行の中のコンポーネントのメソッド（#322 / #323）", () => {
  for (const [label, wiring] of WIRINGS) {
    it(`${label}: メソッドから this["items.0.v"] を読み書きでき、ホストのその行だけが変わること`, async () => {
      const tag = uniqueTag("mrhi-bump");
      let read: unknown = null;
      defineComponent(tag, () => ({
        bump() { read = this["items.0.v"]; this["items.0.v"] = this["items.0.v"] + 10; },
      }), LIST + '<button class="b" data-wcs="onclick: bump"></button>');
      const errors = spyErrors();
      const env = await mountHost(GROUPS, rowBody(tag, wiring), tag);

      click(env.components()[1], ".b");
      await env.settle();
      expect(read).toBe(3);
      expect(env.readParent("groups.1.items.0.v")).toBe(13);
      expect(env.readParent("groups.0.items.0.v")).toBe(1);
      expect(env.components().map((c) => texts(c, "li"))).toEqual([["1", "2"], ["13", "4"]]);
      expect(errors).not.toHaveBeenCalled();
    });

    it(`${label}: メソッドの $getAll / $resolve / $setAll がその行に解決されること`, async () => {
      const tag = uniqueTag("mrhi-dollar");
      let got: unknown = null;
      defineComponent(tag, () => ({
        readAll() { got = this.$getAll("items.*.v", []); },
        viaResolve() { this.$resolve("items.*.v", [0], this.$resolve("items.*.v", [0]) + 10); },
        viaSetAll() { this.$setAll("items.*.v", [], (v: number) => v + 100); },
      }), LIST + '<button class="g" data-wcs="onclick: readAll"></button><button class="r" data-wcs="onclick: viaResolve"></button>'
        + '<button class="s" data-wcs="onclick: viaSetAll"></button>');
      const errors = spyErrors();
      const env = await mountHost(GROUPS, rowBody(tag, wiring), tag);
      const target = env.components()[1];

      click(target, ".g");
      await env.settle();
      expect(got).toEqual([3, 4]);
      click(target, ".r");
      await env.settle();
      expect(env.readParent("groups.1.items.0.v")).toBe(13);
      click(target, ".s");
      await env.settle();
      expect(texts(target, "li")).toEqual(["113", "104"]);
      expect(env.components().map((c) => texts(c, "li"))[0]).toEqual(["1", "2"]);
      expect(errors).not.toHaveBeenCalled();
    });

    it(`${label}: コンポーネントの中の for: 行のハンドラが添字を組み立てたパスで書けること`, async () => {
      const tag = uniqueTag("mrhi-inner");
      defineComponent(tag, () => ({
        inc(_event: Event, index: number) { this[`items.${index}.v`] = this[`items.${index}.v`] + 100; },
      }), '<ul><template data-wcs="for: items"><li><span class="v">{{ .v }}</span><button class="i" data-wcs="onclick: inc"></button></li></template></ul>');
      const errors = spyErrors();
      const env = await mountHost(GROUPS, rowBody(tag, wiring), tag);

      click(env.components()[1], ".i", 1);
      await env.settle();
      expect(env.readParent("groups.1.items.1.v")).toBe(104);
      expect(env.components().map((c) => texts(c, ".v"))).toEqual([["1", "2"], ["3", "104"]]);
      expect(errors).not.toHaveBeenCalled();
    });
  }
});

describe("行の中のコンポーネントの評価文脈の境界（#322 / #323）", () => {
  for (const [label, wiring] of WIRINGS) {
    it(`${label}: 私有の配列を添字のパスで読み書きすると、そのインスタンスの私有データに届くこと`, async () => {
      const tag = uniqueTag("mrhi-private");
      let read: unknown = null;
      defineComponent(tag, () => ({
        drafts: [{ t: "a" }, { t: "b" }],
        edit() { read = this["drafts.1.t"]; this["drafts.0.t"] = "z"; },
      }), '<template data-wcs="for: drafts"><i>{{ .t }}</i></template><button class="e" data-wcs="onclick: edit"></button>');
      const errors = spyErrors();
      const env = await mountHost(GROUPS, rowBody(tag, wiring), tag);

      click(env.components()[1], ".e");
      await env.settle();
      expect(read).toBe("b");
      expect(env.components().map((c) => texts(c, "i"))).toEqual([["a", "b"], ["z", "b"]]);
      expect(errors).not.toHaveBeenCalled();
    });

    it(`${label}: イベントから呼ばれたメソッドは、ホストの行の文脈で素の読みと添字省略の $getAll を解決すること`, async () => {
      const tag = uniqueTag("mrhi-context");
      let got: unknown = null;
      defineComponent(tag, () => ({
        read() { got = [this.items.length, this.$getAll("items.*.v")]; },
      }), '<button class="r" data-wcs="onclick: read"></button>');
      const errors = spyErrors();
      const env = await mountHost(GROUPS, rowBody(tag, wiring), tag);

      click(env.components()[1], ".r");
      await env.settle();
      expect(got).toEqual([2, [3, 4]]);
      expect(errors).not.toHaveBeenCalled();
    });

    it(`${label}: 行の文脈の無い getter で作者が * を書いたパスは、従来どおり解決できずに失敗すること`, async () => {
      const tag = uniqueTag("mrhi-wild");
      defineComponent(tag, () => ({
        get stray() { return this["items.*.v"]; },
      }), '<p class="s">{{ stray }}</p>');
      const errors = spyErrors();
      const env = await mountHost(GROUPS, rowBody(tag, wiring), tag);

      expect(env.components().map((c) => text(c, ".s"))).toEqual(["", ""]);
      expect(errorText(errors)).toMatch(/ListIndex not found: groups.*.items.*.v/);
    });
  }
});

describe("行の中のコンポーネントの公開面（#323）", () => {
  it("element.state[\"items.0.v\"] の読み書きがホストの行に解決されること", async () => {
    const tag = uniqueTag("mrhi-public");
    defineComponent(tag, () => ({}), LIST);
    const errors = spyErrors();
    const env = await mountHost(GROUPS, rowBody(tag, "state.items: .items"), tag);
    const target = env.components()[1];

    expect(target.state["items.0.v"]).toBe(3);
    target.state["items.0.v"] = 60;
    await env.settle();
    expect(env.readParent("groups.1.items.0.v")).toBe(60);
    expect(texts(target, "li")).toEqual(["60", "4"]);
    expect(env.readParent("groups.0.items.0.v")).toBe(1);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("行の中のコンポーネントの添字のパスと、ホストの行の寿命（#323）", () => {
  const G3 = JSON.stringify({ groups: [{ id: "A", items: [{ v: 1 }] }, { id: "B", items: [{ v: 2 }, { v: 3 }] }, { id: "C", items: [{ v: 4 }] }] });

  for (const [label, wiring] of WIRINGS) {
    it(`${label}: await の間にホストの行が消えたら、添字のパスの書き込みは別の行に着地しないこと`, async () => {
      const tag = uniqueTag("mrhi-gone");
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const outcomes: string[] = [];
      defineComponent(tag, () => ({
        async later() {
          await gate;
          try { this["items.0.v"] = 999; outcomes.push("wrote"); } catch (error) { outcomes.push((error as Error).message); }
          try { this.$resolve("items.*.v", [0], 998); outcomes.push("wrote"); } catch (error) { outcomes.push((error as Error).message); }
        },
      }), LIST + '<button class="l" data-wcs="onclick: later"></button>');
      spyErrors();
      const env = await mountHost(G3, rowBody(tag, wiring), tag);

      click(env.components()[0], ".l");
      await env.settle();
      await env.write((state) => { state.groups = [state.groups[1], state.groups[2]]; });
      release();
      await env.settle();
      await env.settle();

      expect(outcomes).toHaveLength(2);
      expect(outcomes).not.toContain("wrote");
      const groups = env.readParent("groups") as any[];
      expect(groups.map((group) => `${group.id}:${group.items.map((item: any) => item.v).join(",")}`)).toEqual(["B:2,3", "C:4"]);
    });

    it(`${label}: $postUpdate と $eq に添字のパスを渡せること`, async () => {
      const tag = uniqueTag("mrhi-pathapi");
      defineComponent(tag, () => ({
        get isOne() { return this.$eq("items.0.v", 1) ? "yes" : "no"; },
        poke() { this.$postUpdate("items.0.v"); },
      }), LIST + '<p class="e">{{ isOne }}</p><button class="p" data-wcs="onclick: poke"></button>');
      const errors = spyErrors();
      const env = await mountHost(GROUPS, rowBody(tag, wiring), tag);

      // 行ごとに自分の行の値と比べる（groups.0.items.0.v = 1 / groups.1.items.0.v = 3）
      expect(env.components().map((c) => text(c, ".e"))).toEqual(["yes", "no"]);
      click(env.components()[1], ".p");
      await env.settle();
      expect(errors).not.toHaveBeenCalled();
    });
  }

  it("公開面の $postUpdate と $eq も添字のパスをホストの行へ解決すること", async () => {
    const tag = uniqueTag("mrhi-publicapi");
    defineComponent(tag, () => ({}), LIST);
    const errors = spyErrors();
    const env = await mountHost(GROUPS, rowBody(tag, "state.items: .items"), tag);
    const target = env.components()[1];

    expect(target.state.$eq("items.0.v", 3)).toBe(true);
    expect(() => target.state.$postUpdate("items.0.v")).not.toThrow();
    expect(errors).not.toHaveBeenCalled();
  });
});
