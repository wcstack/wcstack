/**
 * regression-3x-mount.test.ts — @wcstack/state 3.4.0 で直した、マウントしたコンポーネント（行のマウントを含む）の
 * 不具合 #321 / #322 / #323 / #331 / #367 / #368 の回帰テストの形を、4.0 のエンジン（state-next）で流す。
 *
 * 移し元は 3.x の packages/state/__tests__/integration.mountAuthorPrivateWrite / mountRowHostIndexes /
 * mountPublicMethodCall / mountPartialAwaitRow / mountRowReconnectCallback / mountOverlay（#321 の差分）。
 * Issue の報告の手順そのもの（issues.test.ts / issues-misc.test.ts が移した）と重なる形は移していない。
 *
 * 4.0 の違い:
 * - 行は Content をプールから使い回さない（消した行の要素は捨て、足した行には新しい要素を作る。要素が外れて戻るのは
 *   並べ替えで動かしたとき — issues-misc.test.ts の #368 の注記）。3.x の「使い回された要素」の形は、4.0 では
 *   「消えた行の要素」と「新しい行の要素」の形として確かめる。
 * - 行の要素の書き込み（this["users.1"] = obj）は、その位置の値を差し替え、コンポーネントの要素と私有キーは残る
 *   （docs/migration-v4.md §3.4・§3.5）。
 * - 誤りの文言（3.x の `The host row of <x> was removed.` など）は確かめない。投げる・報告されることだけを確かめる。
 * - 行が消えた後のツリーのキーの読み（マウントしたキーの下のホストの行の getter も）は、3.4 と同じに
 *   `The host row of <x> was removed.` で投げる。私有キーは読み書きできる。消えた行のコンポーネントはもう描かない。
 * - 公開面（element.state）の作者のメソッドは、その proxy に束縛して返す（切り離して呼べる）。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, scopes } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 2; i++) await flush();
};
let seq = 0;
const hosts: HTMLElement[] = [];

beforeAll(() => {
  installFeatures([scopes]);
  bootstrapState();
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const h of hosts.splice(0)) h.remove();
});

/** A page (a shadow root) with a root `<wcs-state>` over `state`; `tag` names the components to wait for. */
async function page(html: string, state: Record<string, any>, tag?: string) {
  const host = document.createElement(`rg3m-page-${seq++}`);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(host);
  hosts.push(host);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  const comps = (): any[] => (tag === undefined ? [] : Array.from(root.querySelectorAll(tag)));
  const ready = async (): Promise<void> => {
    for (const c of comps()) {
      const inner = c.shadowRoot?.querySelector("wcs-state") as any;
      if (inner) await inner.connectedCallbackPromise.catch(() => {});
    }
    await settle();
  };
  await ready();
  const write = async (fn: (s: any) => void): Promise<void> => {
    el.createState("writable", fn);
    await ready();
  };
  /** A write that does not wait for the components (an async `$connectedCallback` holds a new one's promise). */
  const writeRaw = async (fn: (s: any) => void): Promise<void> => {
    el.createState("writable", fn);
    await settle();
  };
  const read = (path: string): any => {
    let v: unknown;
    el.createState("readonly", (s: any) => { v = s[path]; });
    return v;
  };
  /** A JSON copy of a path's value (plain data, no proxies). */
  const json = (path: string): any => JSON.parse(JSON.stringify(read(path)));
  /** The text of `sel` in each component's shadow root. */
  const texts = (sel: string): (string | null)[] => comps().map((c) => c.shadowRoot.querySelector(sel)?.textContent ?? null);
  return { host, root, el, comps, ready, write, writeRaw, read, json, texts };
}

/** A component whose `<wcs-state bind-component="state">` sits in its shadow root. */
function component(markup: string, state: () => Record<string, any>): string {
  const tag = `rg3m-cmp-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    state: Record<string, any> = state();
    constructor() {
      super();
      this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state>${markup}`;
    }
  });
  return tag;
}

const text = (c: any, sel: string): string | null => c.shadowRoot.querySelector(sel)?.textContent ?? null;
const all = (c: any, sel: string): (string | null)[] => Array.from(c.shadowRoot.querySelectorAll(sel) as NodeListOf<Element>).map((n) => n.textContent);
const click = (c: any, sel: string, at = 0): void => (c.shadowRoot.querySelectorAll(sel)[at] as HTMLElement).click();
const spyErrors = () => vi.spyOn(console, "error").mockImplementation(() => {});
const deferred = (): { gate: Promise<void>; release: () => void } => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  return { gate, release };
};
const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------- #321

const CARD =
  '<span class="name">{{ name }}</span><span class="mode">{{ mode }}</span>'
  + '<span class="label" data-wcs="textContent: label"></span>'
  + '<button class="toggle" data-wcs="onclick: toggle"></button>'
  + '<button class="later" data-wcs="onclick: later"></button>'
  + '<button class="both" data-wcs="onclick: both"></button>'
  + '<button class="viaSetter" data-wcs="onclick: viaSetter"></button>';

const cardState = (): Record<string, any> => ({
  mode: "view",
  get label() { return (this as any).mode + "!"; },
  set modeSetter(v: string) { (this as any).mode = v; },
  toggle(this: any) { this.mode = this.mode === "view" ? "edit" : "view"; },
  async later(this: any) {
    this.mode = "a";
    await new Promise((r) => setTimeout(r));
    this.mode = "b";
  },
  both(this: any) { this.mode = "edit"; this.name = "Carol"; },
  viaSetter(this: any) { this.modeSetter = "set"; },
});

async function mountCard() {
  const tag = component(CARD, cardState);
  const env = await page(`<${tag} data-wcs="state: user"></${tag}>`, { user: { name: "Alice" } }, tag);
  return { ...env, tag, card: env.comps()[0] };
}

const USERS = () => ({ users: [{ name: "Anna" }, { name: "Ben" }, { name: "Cy" }] });
const FOR = (wiring: string) => (tag: string) => `<div><template data-wcs="for: users"><${tag} data-wcs="${wiring}"></${tag}></template></div>`;

describe("#321 マウントしたコンポーネントの作者のコード（メソッド・setter）からの私有キーの書き込みが、その回に描き直される", () => {
  it("メソッドが私有キーに書くと、表示と私有キーに依存する getter がその回に描き直される（2 回目も）", async () => {
    const { card } = await mountCard();
    click(card, ".toggle");
    await settle();
    expect(card.state.mode).toBe("edit");
    expect([text(card, ".mode"), text(card, ".label")]).toEqual(["edit", "edit!"]);
    click(card, ".toggle");
    await settle();
    expect([text(card, ".mode"), text(card, ".label")]).toEqual(["view", "view!"]);
  });

  it("async メソッドの await の後の私有キーの書き込みも描き直される", async () => {
    const { card } = await mountCard();
    click(card, ".later");
    await settle();
    await settle();
    expect(card.state.mode).toBe("b");
    expect(text(card, ".mode")).toBe("b");
  });

  it("同じメソッドで私有キーとツリーのキーに書くと、両方が描き直され、ツリーのキーはホストに届く", async () => {
    const { card, read } = await mountCard();
    click(card, ".both");
    await settle();
    expect([text(card, ".mode"), text(card, ".name")]).toEqual(["edit", "Carol"]);
    expect(read("user.name")).toBe("Carol");
  });

  it("メソッドから setter を経て私有キーに書いても、外から setter に書いても描き直される", async () => {
    const first = await mountCard();
    click(first.card, ".viaSetter");
    await settle();
    expect(text(first.card, ".mode")).toBe("set");

    const second = await mountCard();
    second.card.state.modeSetter = "external";
    await settle();
    expect([text(second.card, ".mode"), text(second.card, ".label")]).toEqual(["external", "external!"]);
  });

  it("（対照）外から element.state の私有キーに書いても描き直される", async () => {
    const { card } = await mountCard();
    card.state.mode = "edit";
    await settle();
    expect([text(card, ".mode"), text(card, ".label")]).toEqual(["edit", "edit!"]);
  });

  it("$postUpdate を併用した既存の回避策（setter の中の this.$postUpdate）も壊れない（mountOverlay の差分）", async () => {
    const tag = component('<span class="d">{{ display }}</span><button data-wcs="onclick: bump"></button>', () => ({
      count: "1",
      get display() { return `c${(this as any).count}`; },
      set counter(v: any) { (this as any).count = v; (this as any).$postUpdate("display"); },
      bump(this: any) { this.counter = "9"; },
    }));
    const error = spyErrors();
    const { comps } = await page(`<${tag} data-wcs="state: user"></${tag}>`, { user: { name: "Alice" } }, tag);
    expect(text(comps()[0], ".d")).toBe("c1");
    click(comps()[0], "button");
    await settle();
    expect(text(comps()[0], ".d")).toBe("c9");
    expect(error).not.toHaveBeenCalled();
  });
});

describe("#321 行のマウント（ホストの for: の行に state: .）の私有キーの書き込み", () => {
  it("メソッドが私有キーに書くと、その行だけが描き直され、element.state の読みも一致する", async () => {
    const tag = component(CARD, cardState);
    const { comps, texts } = await page(FOR("state: .")(tag), USERS(), tag);
    click(comps()[1], ".toggle");
    await settle();
    expect(texts(".mode")).toEqual(["view", "edit", "view"]);
    expect(texts(".label")).toEqual(["view!", "edit!", "view!"]);
    expect(comps().map((c) => c.state.mode)).toEqual(["view", "edit", "view"]);
  });

  it("メソッドで書いた後に外から同じ値を書いても、表示と状態が食い違わない（同値ガード）", async () => {
    const tag = component(CARD, cardState);
    const { comps } = await page(FOR("state: .")(tag), USERS(), tag);
    const ben = comps()[1];
    for (let i = 0; i < 3; i++) {
      click(ben, ".toggle");
      await settle();
    }
    expect([ben.state.mode, text(ben, ".mode")]).toEqual(["edit", "edit"]);
    ben.state.mode = "edit";
    await settle();
    expect([ben.state.mode, text(ben, ".mode")]).toEqual(["edit", "edit"]);
  });

  it("await の間に行が並べ替わっても、私有キーの書き込みはそのインスタンスの行に着地する", async () => {
    const { gate, release } = deferred();
    const tag = component('<span class="name">{{ name }}</span><span class="mode">{{ mode }}</span><button data-wcs="onclick: later"></button>', () => ({
      mode: "view",
      async later(this: any) { await gate; this.mode = "late"; },
    }));
    const { comps, texts, write } = await page(FOR("state: .")(tag), USERS(), tag);
    click(comps()[1], "button"); // Ben
    await settle();
    await write((s) => { s.users = [s.users[1], s.users[0], s.users[2]]; });
    release();
    await settle();
    expect(texts(".name")).toEqual(["Ben", "Anna", "Cy"]);
    expect(texts(".mode")).toEqual(["late", "view", "view"]);
    expect(comps().map((c) => c.state.mode)).toEqual(["late", "view", "view"]);
  });

  it("await の間に行が消えても、私有キーだけの書き込みは投げず、残った行を書き換えない", async () => {
    const error = spyErrors();
    const { gate, release } = deferred();
    const tag = component('<span class="name">{{ name }}</span><span class="mode">{{ mode }}</span><button data-wcs="onclick: later"></button>', () => ({
      mode: "view",
      async later(this: any) { await gate; this.mode = "late"; },
    }));
    const { comps, texts, write } = await page(FOR("state: .")(tag), USERS(), tag);
    click(comps()[1], "button"); // Ben
    await settle();
    await write((s) => { s.users = [s.users[0], s.users[2]]; });
    release();
    await settle();
    expect(texts(".name")).toEqual(["Anna", "Cy"]);
    expect(texts(".mode")).toEqual(["view", "view"]);
    expect(error).not.toHaveBeenCalled();
  });

  it("行のマウントの中の for: の行のハンドラが私有キーに書いても、その行のインスタンスだけが描き直される", async () => {
    const tag = component('<span class="picked">{{ picked }}</span><template data-wcs="for: items"><button data-wcs="onclick: pick"></button></template>', () => ({
      picked: -1,
      pick(this: any, _e: Event, i: number) { this.picked = i; },
    }));
    const { comps, texts } = await page(FOR("state: .")(tag), { users: [{ items: ["x", "y"] }, { items: ["p", "q"] }] }, tag);
    click(comps()[1], "button", 1);
    await settle();
    expect(texts(".picked")).toEqual(["-1", "1"]);
    expect(comps().map((c) => c.state.picked)).toEqual([-1, 1]);
  });

  it("メソッドは呼ぶたびにその回の文脈で評価され、2 回目以降もツリーのキーを読める", async () => {
    const error = spyErrors();
    const tag = component('<span class="o">{{ out }}</span><button data-wcs="onclick: greet"></button>', () => ({
      n: 0,
      out: "",
      greet(this: any) { this.n = this.n + 1; this.out = `${this.name}:${this.n}`; },
    }));
    const { comps } = await page(FOR("state: .")(tag), { users: [{ name: "Anna" }, { name: "Ben" }] }, tag);
    const seen: (string | null)[] = [];
    for (let i = 0; i < 3; i++) {
      click(comps()[1], "button");
      await settle();
      seen.push(text(comps()[1], ".o"));
    }
    expect(seen).toEqual(["Ben:1", "Ben:2", "Ben:3"]);
    expect(error).not.toHaveBeenCalled();
  });

  it("element.state からメソッドを先に呼んでも、その後のクリックの書き込みは描き直される", async () => {
    const tag = component('<span class="c">{{ count }}</span><button data-wcs="onclick: inc"></button>', () => ({
      count: 0,
      inc(this: any) { this.count = this.count + 1; },
    }));
    const { comps } = await page(FOR("state: .")(tag), { users: [{ name: "Anna" }, { name: "Ben" }] }, tag);
    comps()[1].state.inc();
    await settle();
    click(comps()[1], "button");
    await settle();
    click(comps()[1], "button");
    await settle();
    expect([comps()[1].state.count, text(comps()[1], ".c")]).toEqual([3, "3"]);
  });
});

describe("#321 await の間にコンポーネントが外されたとき", () => {
  it("外されたコンポーネントのメソッドが await の後に私有キーへ書いても投げない", async () => {
    const error = spyErrors();
    const { gate, release } = deferred();
    const tag = component('<span class="mode">{{ mode }}</span><button data-wcs="onclick: later"></button>', () => ({
      mode: "view",
      async later(this: any) { await gate; this.mode = "late"; },
    }));
    const { comps } = await page(`<${tag} data-wcs="state: user"></${tag}>`, { user: { name: "Alice" } }, tag);
    const card = comps()[0];
    click(card, "button");
    await settle();
    card.remove();
    await settle();
    release();
    await settle();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("#321 私有キーの書き込みはマウントの外へ漏れない", () => {
  it("ルートの $renderedCallback は私有キーだけの更新では呼ばれず、ツリーのキーの更新では呼ばれる（3.x の $updatedCallback）", async () => {
    const tag = component(CARD, cardState);
    const calls: string[][] = [];
    const { comps } = await page(`<p>{{ user.name }}</p><${tag} data-wcs="state: user"></${tag}>`, {
      user: { name: "Alice" },
      $renderedCallback(paths: string[]) { calls.push(paths); },
    }, tag);
    const card = comps()[0];
    calls.length = 0;
    click(card, ".toggle");
    await settle();
    card.state.mode = "external";
    await settle();
    expect(text(card, ".mode")).toBe("external");
    expect(calls).toEqual([]);
    click(card, ".both");
    await settle();
    expect(calls).toEqual([["user.name"]]);
  });

  it("DCC の $bindables のメンバーの変更イベントは、そこにマウントしたコンポーネントの私有キーの書き込みでは出ない", async () => {
    const card = component(CARD, cardState);
    const tag = `rg3m-dcc-${seq++}`;
    const def = document.createElement(tag);
    def.setAttribute("data-wc-definition", "");
    const markup = `<${card} data-wcs="state: user"></${card}>`;
    const dccState = () => ({ user: { name: "Alice" }, $bindables: ["user"] });
    def.attachShadow({ mode: "open" }).innerHTML = `${markup}<wcs-state></wcs-state>`;
    (def.shadowRoot!.querySelector("wcs-state") as any).setInitialState(dccState());
    document.body.appendChild(def);
    hosts.push(def);
    await (def.shadowRoot!.querySelector("wcs-state") as any).connectedCallbackPromise;
    const el = document.createElement(tag) as any;
    document.body.appendChild(el);
    hosts.push(el);
    el.stateElement.setInitialState(dccState());
    await el.stateElement.connectedCallbackPromise;
    await getBindingsReady(el.shadowRoot);
    await settle();
    const c = el.shadowRoot.querySelector(card);
    const events: string[] = [];
    el.addEventListener(`${tag}:user-changed`, (e: Event) => events.push(e.type));
    click(c, ".toggle");
    await settle();
    c.state.mode = "external";
    await settle();
    expect(text(c, ".mode")).toBe("external");
    expect(events).toEqual([]);
    click(c, ".both");
    await settle();
    expect(events).toEqual([`${tag}:user-changed`]);
  });
});

// ---------------------------------------------------------------- #322 / #323

const GROUPS = () => ({ groups: [{ id: "A", items: [{ v: 1 }, { v: 2 }] }, { id: "B", items: [{ v: 3 }, { v: 4 }] }] });
const LIST = '<ul><template data-wcs="for: items"><li>{{ .v }}</li></template></ul>';
const WIRINGS = [["部分マウント（state.items: .items）", "state.items: .items"], ["丸ごとマウント（state: .）", "state: ."]] as const;
const rowBody = (tag: string, wiring: string): string =>
  `<template data-wcs="for: groups"><section><b>{{ .id }}</b><${tag} data-wcs="${wiring}"></${tag}></section></template>`;

describe("#322 ホストの for: の行にマウントしたコンポーネントの getter が、その行の値を読む", () => {
  it.each(WIRINGS)("%s: 行の文脈の無い getter の $getAll（[] / 省略 / [0]）・素の読み・添字のパスが、その行の値になる（省略しても他の行を混ぜない）", async (_label, wiring) => {
    const tag = component(LIST + '<p class="t">{{ total }}</p><p class="o">{{ totalOmitted }}</p><p class="z">{{ firstOnly }}</p>'
      + '<p class="c">{{ count }}</p><p class="f">{{ first }}</p>', () => ({
      get total() { return sum((this as any).$getAll("items.*.v", [])); },
      get totalOmitted() { return sum((this as any).$getAll("items.*.v")); },
      get firstOnly() { return sum((this as any).$getAll("items.*.v", [0])); },
      get count() { return (this as any).items.length; },
      get first() { return (this as any)["items.0.v"]; },
    }));
    const error = spyErrors();
    const { comps } = await page(rowBody(tag, wiring), GROUPS(), tag);
    expect(comps().map((c) => [".t", ".o", ".z", ".c", ".f"].map((s) => text(c, s)))).toEqual([["3", "3", "1", "2", "1"], ["7", "7", "3", "2", "3"]]);
    expect(error).not.toHaveBeenCalled();
  });

  it.each(WIRINGS)("%s: ホストの葉の書き込み・行の追加・グループの並べ替え・コンポーネントからの書き込み・グループの追加に getter が追従する", async (_label, wiring) => {
    const tag = component(LIST + '<p class="t">{{ total }}</p><p class="c">{{ count }}</p><p class="f">{{ first }}</p><button class="b" data-wcs="onclick: bump"></button>', () => ({
      get total() { return sum((this as any).$getAll("items.*.v", [])); },
      get count() { return (this as any).items.length; },
      get first() { return (this as any)["items.0.v"]; },
      bump(this: any) { this["items.0.v"] = this["items.0.v"] + 10; },
    }));
    const error = spyErrors();
    const { root, comps, write, ready } = await page(rowBody(tag, wiring), GROUPS(), tag);
    const view = () => Array.from(root.querySelectorAll("section")).map((section) => {
      const c = section.querySelector(tag);
      return `${section.querySelector("b")!.textContent}:${text(c, ".t")}/${text(c, ".c")}/${text(c, ".f")}`;
    });
    await write((s) => { s["groups.1.items.0.v"] = 30; });
    expect(view()).toEqual(["A:3/2/1", "B:34/2/30"]);
    await write((s) => { s["groups.1.items"] = [...s["groups.1.items"], { v: 100 }]; });
    expect(view()).toEqual(["A:3/2/1", "B:134/3/30"]);
    await write((s) => { s.groups = [s.groups[1], s.groups[0]]; });
    expect(view()).toEqual(["B:134/3/30", "A:3/2/1"]);
    click(comps()[0], ".b");
    await ready();
    expect(view()).toEqual(["B:144/3/40", "A:3/2/1"]);
    await write((s) => { s.groups = [...s.groups, { id: "C", items: [{ v: 5 }] }]; });
    expect(view()).toEqual(["B:144/3/40", "A:3/2/1", "C:5/1/5"]);
    expect(error).not.toHaveBeenCalled();
  });

  it.each(WIRINGS)("%s: 行を消して足しても・行を新しい配列で差し替えても・行の要素の書き込みで差し替えても、getter が新しい行の値になる", async (_label, wiring) => {
    const tag = component('<p class="t">{{ total }}</p><p class="c">{{ count }}</p><p class="f">{{ first }}</p>', () => ({
      get total() { return sum((this as any).$getAll("items.*.v", [])); },
      get count() { return (this as any).items.length; },
      get first() { return (this as any)["items.0.v"]; },
    }));
    const error = spyErrors();
    const { comps, write } = await page(rowBody(tag, wiring), GROUPS(), tag);
    const view = () => comps().map((c) => [text(c, ".t"), text(c, ".c"), text(c, ".f")]);
    await write((s) => { s.groups = [s.groups[1]]; });
    await write((s) => { s.groups = [...s.groups, { id: "C", items: [{ v: 10 }, { v: 20 }, { v: 30 }] }]; });
    expect(view()).toEqual([["7", "2", "3"], ["60", "3", "10"]]);
    await write((s) => { const g = [...s.groups]; g[0] = { id: "D", items: [{ v: 7 }] }; s.groups = g; });
    expect(view()).toEqual([["7", "1", "7"], ["60", "3", "10"]]);
    await write((s) => { s["groups.0.items.0.v"] = 70; });
    expect(view()).toEqual([["70", "1", "70"], ["60", "3", "10"]]);
    // 4.0: 行の要素の書き込みはその位置の値を差し替え、コンポーネントの要素は残る（migration-v4 §3.5）
    const second = comps()[1];
    await write((s) => { s["groups.1"] = { id: "E", items: [{ v: 1 }, { v: 1 }] }; });
    expect(comps()[1]).toBe(second);
    expect(view()).toEqual([["70", "1", "70"], ["2", "2", "1"]]);
    expect(error).not.toHaveBeenCalled();
  });

  it("README の Loop with Components（state.message: .name）に getter とメソッドを足しても、行ごとに読める", async () => {
    let fromMethod: unknown = null;
    const tag = component('<div class="m">{{ message }}</div><div class="s">{{ shout }}</div><button class="b" data-wcs="onclick: read"></button>', () => ({
      get shout() { return String((this as any).message).toUpperCase(); },
      read(this: any) { fromMethod = this.message; },
    }));
    const error = spyErrors();
    const { comps, write, ready } = await page(`<template data-wcs="for: users"><${tag} data-wcs="state.message: .name"></${tag}></template>`,
      { users: [{ name: "alice" }, { name: "bob" }] }, tag);
    expect(comps().map((c) => [text(c, ".m"), text(c, ".s")])).toEqual([["alice", "ALICE"], ["bob", "BOB"]]);
    click(comps()[1], ".b");
    await ready();
    expect(fromMethod).toBe("bob");
    await write((s) => { s["users.0.name"] = "carol"; });
    expect(comps().map((c) => text(c, ".s"))).toEqual(["CAROL", "BOB"]);
    expect(error).not.toHaveBeenCalled();
  });

  it("ホストの絶対パスで書いた $getAll（groups.*.items.*.v）はコンポーネントの語彙の外: ホストの値を返さず、失敗が報告される", async () => {
    const tag = component('<p class="t">{{ total }}</p>', () => ({
      get total() { return sum((this as any).$getAll("groups.*.items.*.v", [1])); },
    }));
    const error = spyErrors();
    const { texts } = await page(rowBody(tag, "state.items: .items"), GROUPS(), tag);
    expect(texts(".t")).not.toContain("7");
    expect(error).toHaveBeenCalled();
  });
});

describe("#322 / #323 ホストの for: の行にマウントしたコンポーネントのメソッド", () => {
  it.each(WIRINGS)("%s: メソッドから this[\"items.0.v\"] を読み書きでき、ホストのその行だけが変わる", async (_label, wiring) => {
    let seen: unknown = null;
    const tag = component(LIST + '<button class="b" data-wcs="onclick: bump"></button>', () => ({
      bump(this: any) { seen = this["items.0.v"]; this["items.0.v"] = this["items.0.v"] + 10; },
    }));
    const error = spyErrors();
    const { comps, read, ready } = await page(rowBody(tag, wiring), GROUPS(), tag);
    click(comps()[1], ".b");
    await ready();
    expect(seen).toBe(3);
    expect([read("groups.1.items.0.v"), read("groups.0.items.0.v")]).toEqual([13, 1]);
    expect(comps().map((c) => all(c, "li"))).toEqual([["1", "2"], ["13", "4"]]);
    expect(error).not.toHaveBeenCalled();
  });

  it.each(WIRINGS)("%s: メソッドの $getAll / $resolve（読み・書き）/ $setAll がその行に解決される", async (_label, wiring) => {
    let got: unknown = null;
    const tag = component(LIST + '<button class="g" data-wcs="onclick: readAll"></button><button class="r" data-wcs="onclick: viaResolve"></button>'
      + '<button class="s" data-wcs="onclick: viaSetAll"></button>', () => ({
      readAll(this: any) { got = this.$getAll("items.*.v", []); },
      viaResolve(this: any) { this.$resolve("items.*.v", [0], this.$resolve("items.*.v", [0]) + 10); },
      viaSetAll(this: any) { this.$setAll("items.*.v", [], (v: number) => v + 100); },
    }));
    const error = spyErrors();
    const { comps, read, ready } = await page(rowBody(tag, wiring), GROUPS(), tag);
    const target = comps()[1];
    click(target, ".g");
    await ready();
    expect(got).toEqual([3, 4]);
    click(target, ".r");
    await ready();
    expect(read("groups.1.items.0.v")).toBe(13);
    click(target, ".s");
    await ready();
    expect(all(target, "li")).toEqual(["113", "104"]);
    expect(all(comps()[0], "li")).toEqual(["1", "2"]);
    expect(error).not.toHaveBeenCalled();
  });

  it.each(WIRINGS)("%s: コンポーネントの中の for: の行のハンドラが、添字を組み立てたパス（items.<i>.v）で書ける", async (_label, wiring) => {
    const tag = component('<ul><template data-wcs="for: items"><li><span class="v">{{ .v }}</span><button class="i" data-wcs="onclick: inc"></button></li></template></ul>', () => ({
      inc(this: any, _e: Event, i: number) { this[`items.${i}.v`] = this[`items.${i}.v`] + 100; },
    }));
    const error = spyErrors();
    const { comps, read, ready } = await page(rowBody(tag, wiring), GROUPS(), tag);
    click(comps()[1], ".i", 1);
    await ready();
    expect(read("groups.1.items.1.v")).toBe(104);
    expect(comps().map((c) => all(c, ".v"))).toEqual([["1", "2"], ["3", "104"]]);
    expect(error).not.toHaveBeenCalled();
  });

  it.each(WIRINGS)("%s: 私有の配列を添字のパス（drafts.1.t）で読み書きすると、そのインスタンスの私有データに届く", async (_label, wiring) => {
    let seen: unknown = null;
    const tag = component('<template data-wcs="for: drafts"><i>{{ .t }}</i></template><button class="e" data-wcs="onclick: edit"></button>', () => ({
      drafts: [{ t: "a" }, { t: "b" }],
      edit(this: any) { seen = this["drafts.1.t"]; this["drafts.0.t"] = "z"; },
    }));
    const error = spyErrors();
    const { comps, ready } = await page(rowBody(tag, wiring), GROUPS(), tag);
    click(comps()[1], ".e");
    await ready();
    expect(seen).toBe("b");
    expect(comps().map((c) => all(c, "i"))).toEqual([["a", "b"], ["z", "b"]]);
    expect(error).not.toHaveBeenCalled();
  });

  it.each(WIRINGS)("%s: イベントから呼んだメソッドの素の読みと添字を省略した $getAll が、ホストの行に解決される", async (_label, wiring) => {
    let got: unknown = null;
    const tag = component('<button class="r" data-wcs="onclick: read"></button>', () => ({
      read(this: any) { got = [this.items.length, this.$getAll("items.*.v")]; },
    }));
    const error = spyErrors();
    const { comps, ready } = await page(rowBody(tag, wiring), GROUPS(), tag);
    click(comps()[1], ".r");
    await ready();
    expect(got).toEqual([2, [3, 4]]);
    expect(error).not.toHaveBeenCalled();
  });

  // 3.x はこの読みを ListIndex not found で失敗させる。4.0 は行の無い * のパスを（ページの直下の getter でも）
  // undefined と読み、報告しない。ここで確かめるのは「ホストの行に解決されない（どの行の値にもならない）」こと。
  it.each(WIRINGS)("%s: 行の文脈の無い getter で作者が * を書いたパス（items.*.v）は、ホストの行に解決されず、どの行の値にもならない", async (_label, wiring) => {
    const tag = component('<p class="s">{{ stray }}</p>', () => ({
      get stray() { return (this as any)["items.*.v"]; },
    }));
    spyErrors();
    const { comps, texts } = await page(rowBody(tag, wiring), GROUPS(), tag);
    expect(texts(".s")).toEqual(["", ""]);
    expect(comps().map((c) => c.state.stray)).toEqual([undefined, undefined]);
  });
});

describe("#323 ホストの for: の行にマウントしたコンポーネントの公開面（element.state）の添字のパス", () => {
  it("element.state[\"items.0.v\"] の読み書きがホストの行に解決される", async () => {
    const tag = component(LIST, () => ({}));
    const error = spyErrors();
    const { comps, read, ready } = await page(rowBody(tag, "state.items: .items"), GROUPS(), tag);
    const target = comps()[1];
    expect(target.state["items.0.v"]).toBe(3);
    target.state["items.0.v"] = 60;
    await ready();
    expect([read("groups.1.items.0.v"), read("groups.0.items.0.v")]).toEqual([60, 1]);
    expect(all(target, "li")).toEqual(["60", "4"]);
    expect(error).not.toHaveBeenCalled();
  });

  it("公開面の $postUpdate と $eq も、添字のパスをホストの行へ解決する", async () => {
    const tag = component(LIST, () => ({}));
    const error = spyErrors();
    const { comps } = await page(rowBody(tag, "state.items: .items"), GROUPS(), tag);
    const target = comps()[1];
    expect(target.state.$eq("items.0.v", 3)).toBe(true);
    expect(comps()[0].state.$eq("items.0.v", 1)).toBe(true);
    expect(() => target.state.$postUpdate("items.0.v")).not.toThrow();
    await settle();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("#323 添字のパスと、ホストの行の寿命", () => {
  const G3 = () => ({ groups: [{ id: "A", items: [{ v: 1 }] }, { id: "B", items: [{ v: 2 }, { v: 3 }] }, { id: "C", items: [{ v: 4 }] }] });

  it.each(WIRINGS)("%s: await の間にホストの行が消えたら、添字のパスと $resolve の書き込みは投げ、別の行に着地しない", async (_label, wiring) => {
    const { gate, release } = deferred();
    const outcomes: string[] = [];
    const tag = component(LIST + '<button class="l" data-wcs="onclick: later"></button>', () => ({
      async later(this: any) {
        await gate;
        try { this["items.0.v"] = 999; outcomes.push("wrote"); } catch { outcomes.push("threw"); }
        try { this.$resolve("items.*.v", [0], 998); outcomes.push("wrote"); } catch { outcomes.push("threw"); }
      },
    }));
    spyErrors();
    const { comps, write, json, ready } = await page(rowBody(tag, wiring), G3(), tag);
    click(comps()[0], ".l");
    await ready();
    await write((s) => { s.groups = [s.groups[1], s.groups[2]]; });
    release();
    await ready();
    await ready();
    expect(outcomes).toEqual(["threw", "threw"]);
    expect((json("groups") as any[]).map((g) => `${g.id}:${g.items.map((i: any) => i.v).join(",")}`)).toEqual(["B:2,3", "C:4"]);
  });

  it.each(WIRINGS)("%s: getter の $eq とメソッドの $postUpdate に添字のパスを渡せる（行ごとに自分の行と比べる）", async (_label, wiring) => {
    const tag = component(LIST + '<p class="e">{{ isOne }}</p><button class="p" data-wcs="onclick: poke"></button>', () => ({
      get isOne() { return (this as any).$eq("items.0.v", 1) ? "yes" : "no"; },
      poke(this: any) { this.$postUpdate("items.0.v"); },
    }));
    const error = spyErrors();
    const { comps, texts, write, ready } = await page(rowBody(tag, wiring), GROUPS(), tag);
    expect(texts(".e")).toEqual(["yes", "no"]);
    click(comps()[1], ".p");
    await ready();
    await write((s) => { s["groups.1.items.0.v"] = 1; });
    expect(texts(".e")).toEqual(["yes", "yes"]);
    expect(error).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- #331

const PUBLIC_CARD =
  '<span class="name">{{ name }}</span><span class="mode">{{ mode }}</span>'
  + '<span class="label" data-wcs="textContent: label"></span>'
  + '<button class="later" data-wcs="onclick: later"></button>';

const publicState = (gate: Promise<void> = Promise.resolve()) => (): Record<string, any> => ({
  mode: "view",
  get label() { return (this as any).mode + "!"; },
  toggle(this: any) { this.mode = this.mode === "view" ? "edit" : "view"; },
  rename(this: any) { this.name = "Bob"; },
  compute(this: any, suffix: string) { return `${this.name}/${this.mode}${suffix}`; },
  async later(this: any) {
    await gate;
    this.mode = "late";
    this.name = `${this.name}!`;
    return "done";
  },
});

async function publicCard(gate?: Promise<void>) {
  const tag = component(PUBLIC_CARD, publicState(gate));
  const env = await page(`<${tag} data-wcs="state: user"></${tag}>`, { user: { name: "Alice" } }, tag);
  return { ...env, tag, card: env.comps()[0] };
}

async function publicRows(gate?: Promise<void>, wiring = "state: .") {
  const tag = component(PUBLIC_CARD, publicState(gate));
  const env = await page(FOR(wiring)(tag), USERS(), tag);
  return { ...env, tag };
}

describe("#331 マウントしたコンポーネントのメソッドを公開面（element.state）から呼ぶと、イベントから呼んだのと同じに動く", () => {
  it("同期のメソッドは引数を受け、戻り値を同期のまま返す", async () => {
    const { card } = await publicCard();
    expect(card.state.compute("?")).toBe("Alice/view?");
  });

  it("async のメソッドは Promise を返し、await の後の私有キーとツリーのキーの書き込みも描き直される", async () => {
    const { gate, release } = deferred();
    const { card, read } = await publicCard(gate);
    const result = card.state.later();
    expect(result).toBeInstanceOf(Promise);
    release();
    await expect(result).resolves.toBe("done");
    await settle();
    expect([text(card, ".mode"), text(card, ".label"), text(card, ".name")]).toEqual(["late", "late!", "Alice!"]);
    expect(read("user.name")).toBe("Alice!");
  });

  // 4.0: element.state の作者のメソッドは、その proxy に束縛して返す（メソッドごとに 1 つ、初めて読んだときに作る）
  it("取り出したメソッドを切り離して呼んでも（const { toggle } = element.state）同じに動く", async () => {
    const { card } = await publicCard();
    const { toggle, rename } = card.state;
    toggle();
    rename();
    await settle();
    expect([text(card, ".mode"), text(card, ".name")]).toEqual(["edit", "Bob"]);
  });

  it("取り出したメソッドは読むたびに同じ関数で、クラスのプロトタイプのメソッドも、行のマウントでも切り離して呼べる", async () => {
    class CardState {
      mode = "view";
      flip(this: any) { this.mode = this.mode === "view" ? "edit" : "view"; }
      mark(this: any) { this.name = `${this.name}*`; }
    }
    const tag = component('<span class="name">{{ name }}</span><span class="mode">{{ mode }}</span>', () => new CardState());
    const { comps, texts, json } = await page(FOR("state: .")(tag), USERS(), tag);
    const ben = comps()[1];
    expect(ben.state.flip).toBe(ben.state.flip);
    // as a listener (the event target would be its `this`), it still runs on the state
    const button = document.createElement("button");
    button.addEventListener("click", ben.state.flip);
    button.click();
    expect(ben.state.mode).toBe("edit");
    button.click();
    expect(ben.state.mode).toBe("view");
    expect(ben.state.flip).not.toBe(comps()[0].state.flip);
    const { flip, mark } = ben.state;
    flip();
    mark();
    await settle();
    expect(texts(".mode")).toEqual(["view", "edit", "view"]);
    expect(json("users")).toEqual([{ name: "Anna" }, { name: "Ben*" }, { name: "Cy" }]);
    // (the class's own constructor is not one of its methods)
    expect(ben.state.constructor).toBe(CardState);
  });

  it("this で読む関数は、プロパティ（debounce の cancel）・クラスの static と new・name を保ち、どう呼んでも（切り離し・リスナー・call(other)）状態の上で走る（3.x の bind と同じ）", async () => {
    const seen: unknown[] = [];
    class Model { static create() { return new this(); } }
    const search = Object.assign(function (this: any) { seen.push(this); }, { cancel: () => "cancelled" });
    function run() { return "ran"; }
    const tag = component('<span class="name">{{ name }}</span>', () => ({
      search,
      Model,
      run,
      probe(this: any) {
        return [this.search.cancel(), this.Model.create() instanceof Model, new this.Model() instanceof Model, this.run.name, this.run()];
      },
    }));
    const { comps } = await page(`<${tag} data-wcs="state: user"></${tag}>`, { user: { name: "Alice" } }, tag);
    const card = comps()[0];
    expect(card.state.probe()).toEqual(["cancelled", true, true, "run", "ran"]);
    card.state.search.call({ other: true });
    card.state.search();
    const { search: detached } = card.state;
    detached();
    const button = document.createElement("button");
    button.addEventListener("click", card.state.search);
    button.click();
    expect(seen).toEqual([card.state, card.state, card.state, card.state]);
  });

  it("コンポーネントの <wcs-state> の createStateAsync(\"readonly\") は、メソッドを経た書き込みも（切り離して呼んでも）拒む（writable では書ける）", async () => {
    const { card } = await publicCard();
    const el = card.shadowRoot.querySelector("wcs-state");
    await expect(el.createStateAsync("readonly", async (s: any) => {
      await flush();
      s.toggle();
    })).rejects.toThrow("#8");
    // the readonly view hands the method out as it is: detached, it has no state to write to
    await expect(el.createStateAsync("readonly", async (s: any) => {
      await flush();
      const { toggle } = s;
      toggle();
    })).rejects.toThrow();
    expect(card.state.mode).toBe("view");
    await el.createStateAsync("writable", async (s: any) => {
      await flush();
      s.toggle();
    });
    expect(card.state.mode).toBe("edit");
  });

  it("関数でない値の読みと $ API（$getAll / $untracked）は従来どおり", async () => {
    const { card } = await publicCard();
    expect(card.state.mode).toBe("view");
    expect(card.state.label).toBe("view!");
    expect(card.state.$getAll("name")).toEqual(["Alice"]);
    expect(card.state.$untracked(() => "x")).toBe("x");
  });

  it("ツリーのキー・私有キー・getter が値として持つ関数は、同じ関数のまま返る（作者のメソッドだけを包む）", async () => {
    class Klass { tag = "k"; }
    const handler = Object.assign(vi.fn(), { extra: 1 });
    const tag = component('<span class="name">{{ name }}</span>', () => ({
      handler: null as unknown,
      get klass() { return Klass; },
      setHandler(this: any, fn: unknown) { this.handler = fn; },
    }));
    const { comps, write } = await page(`<${tag} data-wcs="state: user"></${tag}>`, { user: { name: "Alice" } }, tag);
    const card = comps()[0];
    await write((s) => { s.user = { name: "Alice", cb: handler }; });
    card.state.setHandler(handler);
    await settle();
    expect(card.state.cb).toBe(handler);
    expect(card.state.handler).toBe(handler);
    expect(card.state.handler.extra).toBe(1);
    expect(card.state.klass).toBe(Klass);
    expect(new card.state.klass()).toBeInstanceOf(Klass);
    const target = new EventTarget();
    target.addEventListener("x", card.state.cb);
    target.removeEventListener("x", card.state.cb);
    target.dispatchEvent(new Event("x"));
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("#331 行のマウント（state: .）のメソッドを公開面から呼ぶ", () => {
  it("その行にだけ着地して描き直され、ツリーのキーも読める", async () => {
    const { comps, texts, json } = await publicRows();
    comps()[1].state.toggle();
    comps()[1].state.rename();
    expect(comps()[1].state.compute("?")).toBe("Bob/edit?");
    await settle();
    expect(texts(".mode")).toEqual(["view", "edit", "view"]);
    expect(texts(".label")).toEqual(["view!", "edit!", "view!"]);
    expect(texts(".name")).toEqual(["Anna", "Bob", "Cy"]);
    expect(json("users")).toEqual([{ name: "Anna" }, { name: "Bob" }, { name: "Cy" }]);
  });

  it("async のメソッドの await の間に行が並べ替わっても、書き込みはそのインスタンスの行に着地する", async () => {
    const { gate, release } = deferred();
    const { comps, texts, json, write } = await publicRows(gate);
    const result = comps()[1].state.later(); // Ben
    await settle();
    await write((s) => { s.users = [s.users[1], s.users[0], s.users[2]]; });
    release();
    await expect(result).resolves.toBe("done");
    await settle();
    expect(json("users")).toEqual([{ name: "Ben!" }, { name: "Anna" }, { name: "Cy" }]);
    expect(texts(".name")).toEqual(["Ben!", "Anna", "Cy"]);
    expect(texts(".mode")).toEqual(["late", "view", "view"]);
  });

  it("async のメソッドの await の間にホストの行が消えたら、別の行に着地せず、reject する（#323 と同じ扱い）", async () => {
    const { gate, release } = deferred();
    const { comps, texts, json, write } = await publicRows(gate);
    const result = comps()[1].state.later(); // Ben
    result.catch(() => {});
    await settle();
    await write((s) => { s.users = [s.users[0], s.users[2]]; });
    release();
    await expect(result).rejects.toThrow();
    await settle();
    expect(json("users")).toEqual([{ name: "Anna" }, { name: "Cy" }]);
    expect(texts(".name")).toEqual(["Anna", "Cy"]);
    expect(texts(".mode")).toEqual(["view", "view"]);
  });
});

describe("#331 行のマウント（state: .）のイベントから呼んだ async メソッドの await の後のツリーのキー", () => {
  it("await の後の読み書きがその行に着地して描き直され、誤りを出さない", async () => {
    const error = spyErrors();
    const { gate, release } = deferred();
    const { comps, texts, json } = await publicRows(gate);
    click(comps()[1], ".later");
    await settle();
    release();
    await settle();
    expect(json("users")).toEqual([{ name: "Anna" }, { name: "Ben!" }, { name: "Cy" }]);
    expect(texts(".name")).toEqual(["Anna", "Ben!", "Cy"]);
    expect(texts(".mode")).toEqual(["view", "late", "view"]);
    expect(error).not.toHaveBeenCalled();
  });

  it("await の間にホストの行が消えたら、ツリーのキーの読み書きは別の行に着地せず、失敗が報告される", async () => {
    const error = spyErrors();
    const { gate, release } = deferred();
    const { comps, texts, json, write } = await publicRows(gate);
    click(comps()[1], ".later"); // Ben
    await settle();
    await write((s) => { s.users = [s.users[0], s.users[2]]; });
    release();
    await settle();
    expect(json("users")).toEqual([{ name: "Anna" }, { name: "Cy" }]);
    expect(texts(".name")).toEqual(["Anna", "Cy"]);
    expect(texts(".mode")).toEqual(["view", "view"]);
    expect(error).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- #367

describe("#367 部分マウント（state.name: .name）の async メソッドの await の間にホストの行が消えたとき", () => {
  const edits: [string, (s: any) => void, string[]][] = [
    ["Ben を消して同じバッチで Dan を足す", (s) => { s.users = [s.users[0], s.users[2], { name: "Dan" }]; }, ["Anna", "Cy", "Dan"]],
    ["Ben を同じ位置で Dan に差し替える（新しい配列）", (s) => { s.users = [s.users[0], { name: "Dan" }, s.users[2]]; }, ["Anna", "Dan", "Cy"]],
  ];

  it.each(edits)("イベントから呼んだ書き込みはどの行にも着地せず、失敗が報告される: %s", async (_label, edit, names) => {
    const error = spyErrors();
    const { gate, release } = deferred();
    const { comps, texts, json, write } = await publicRows(gate, "state.name: .name");
    click(comps()[1], ".later");
    await settle();
    await write(edit);
    release();
    await settle();
    expect((json("users") as any[]).map((u) => u.name)).toEqual(names);
    expect(texts(".name")).toEqual(names);
    expect(texts(".mode")).toEqual(["view", "view", "view"]);
    expect(error).toHaveBeenCalled();
  });

  it.each(["state.name: .name", "state: ."])("公開面（element.state）から呼んだ async メソッドは reject し、どの行にも書かない（%s）", async (wiring) => {
    const { gate, release } = deferred();
    const { comps, texts, json, write } = await publicRows(gate, wiring);
    const result = comps()[1].state.later();
    result.catch(() => {});
    await settle();
    await write((s) => { s.users = [s.users[0], s.users[2], { name: "Dan" }]; });
    release();
    await expect(result).rejects.toThrow();
    await settle();
    expect(json("users")).toEqual([{ name: "Anna" }, { name: "Cy" }, { name: "Dan" }]);
    expect(texts(".mode")).toEqual(["view", "view", "view"]);
  });

  it.each(["state.name: .name", "state: ."])("await の後にツリーのキーを読むだけでも、ほかの行（同じ位置の Cy・足した Dan）の値を返さない（%s）", async (wiring) => {
    const { gate, release } = deferred();
    const tag = component(PUBLIC_CARD, () => ({ ...publicState(gate)(), async peek(this: any) { await gate; return this.name; } }));
    const { comps, write } = await page(FOR(wiring)(tag), USERS(), tag);
    const result = comps()[1].state.peek();
    await settle();
    await write((s) => { s.users = [s.users[0], s.users[2], { name: "Dan" }]; });
    release();
    const outcome = await result.then((v: unknown) => `resolved ${v}`, () => "rejected");
    expect(["resolved Cy", "resolved Dan"]).not.toContain(outcome);
  });

  // 行が消えた後のツリーのキーの読みも、書き込みと同じに投げる（3.4 #367。消えた行の最後の値も返さない）
  it.each(["state.name: .name", "state: ."])("（3.4 の形）await の後にツリーのキーを読むだけでも、行が消えた旨で reject する（%s）", async (wiring) => {
    const { gate, release } = deferred();
    const tag = component(PUBLIC_CARD, () => ({ ...publicState(gate)(), async peek(this: any) { await gate; return this.name; } }));
    const { comps, write } = await page(FOR(wiring)(tag), USERS(), tag);
    const result = comps()[1].state.peek();
    result.catch(() => {});
    await settle();
    await write((s) => { s.users = [s.users[0], s.users[2], { name: "Dan" }]; });
    release();
    await expect(result).rejects.toThrow();
  });

  it("行を消した同じタスクの $postUpdate（書き込みではない）は投げず、消えた行の位置にいまある別の行（Cy）を描き直さない", async () => {
    const tag = component(PUBLIC_CARD, publicState());
    const rendered: Record<string, number[][]>[] = [];
    const { comps, write } = await page(`<div><template data-wcs="for: users"><p>{{ .name }}</p><${tag} data-wcs="state.name: .name"></${tag}></template></div>`, {
      ...USERS(),
      $renderedCallback(_paths: string[], indexes: Record<string, number[][]>) { rendered.push(indexes); },
    }, tag);
    const ben = comps()[1];
    // (the host's drain has not taken Ben's element out yet: its mount still hears its changes)
    await write((s) => {
      s.users = [s.users[0], s.users[2]];
      ben.state.$postUpdate("name");
    });
    expect(rendered.map((r) => r["users.*.name"] ?? [])).not.toContainEqual([[1]]);
  });

  it("行が消えただけ（足さない）でも reject し、残った行に書かない", async () => {
    const { gate, release } = deferred();
    const { comps, json, write } = await publicRows(gate, "state.name: .name");
    const result = comps()[1].state.later();
    result.catch(() => {});
    await settle();
    await write((s) => { s.users = [s.users[0], s.users[2]]; });
    release();
    await expect(result).rejects.toThrow();
    expect(json("users")).toEqual([{ name: "Anna" }, { name: "Cy" }]);
  });

  it("await の間に行が並べ替わっただけなら、書き込みはそのインスタンスの行に着地する", async () => {
    const { gate, release } = deferred();
    const { comps, texts, json, write } = await publicRows(gate, "state.name: .name");
    const result = comps()[1].state.later();
    await settle();
    await write((s) => { s.users = [s.users[1], s.users[0], s.users[2]]; });
    release();
    await expect(result).resolves.toBe("done");
    await settle();
    expect(json("users")).toEqual([{ name: "Ben!" }, { name: "Anna" }, { name: "Cy" }]);
    expect(texts(".name")).toEqual(["Ben!", "Anna", "Cy"]);
    expect(texts(".mode")).toEqual(["late", "view", "view"]);
  });

  it("行が消えるときの $disconnectedCallback は、私有キーに書いても投げない", async () => {
    const error = spyErrors();
    const tag = component(PUBLIC_CARD, () => ({ ...publicState()(), $disconnectedCallback(this: any) { this.mode = "gone"; } }));
    const { write } = await page(FOR("state.name: .name")(tag), USERS(), tag);
    await write((s) => { s.users = [s.users[0], s.users[2]]; });
    expect(error).not.toHaveBeenCalled();
  });
});

describe("#367 行が生きている部分マウントは、修正の前と同じに動く（判定の対照）", () => {
  it("入れ子の for で外側の要素をコピーに差し替えても、getter・イベント・公開面が投げない", async () => {
    const error = spyErrors();
    const tag = component('<span class="display">{{ display }}</span><button class="rename" data-wcs="onclick: rename"></button>', () => ({
      mode: "v",
      get display() { return `${(this as any).name}/${(this as any).mode}`; },
      rename(this: any) { this.name = `${this.name}~`; this.mode = "renamed"; },
    }));
    const { comps, texts, write, json } = await page(
      `<ul><template data-wcs="for: groups"><li><ol><template data-wcs="for: .users"><li><${tag} data-wcs="state.name: .name"></${tag}></li></template></ol></li></template></ul>`,
      { groups: [{ id: "A", users: [{ name: "a1" }, { name: "a2" }] }, { id: "B", users: [{ name: "b1" }, { name: "b2" }] }] }, tag);
    await write((s) => { s.groups = s.groups.map((g: any) => ({ ...g })); });
    expect(texts(".display")).toEqual(["a1/v", "a2/v", "b1/v", "b2/v"]);
    click(comps()[3], ".rename");
    await write(() => {});
    expect(texts(".display")).toEqual(["a1/v", "a2/v", "b1/v", "b2~/renamed"]);
    expect(comps()[3].state.display).toBe("b2~/renamed");
    expect((json("groups") as any[])[1].users).toEqual([{ name: "b1" }, { name: "b2~" }]);
    expect(error).not.toHaveBeenCalled();
  });

  it("if の再表示で呼ばれた async の $connectedCallback が await の後にツリーのキーを読んでも、その行に着地する", async () => {
    const error = spyErrors();
    const tag = component('<span class="seen">{{ seen }}</span>', () => ({
      seen: "-",
      async load(this: any) { await null; this.seen = `load ${this.name}`; },
      async $connectedCallback(this: any) { await this.load(); },
    }));
    const { texts, write } = await page(
      `<div><template data-wcs="for: users"><template data-wcs="if: .show"><${tag} data-wcs="state.name: .name"></${tag}></template></template></div>`,
      { users: [{ name: "Anna", show: true }, { name: "Ben", show: true }] }, tag);
    await write((s) => { s["users.1.show"] = false; });
    await write((s) => { s["users.1.name"] = "Ben2"; });
    await write((s) => { s["users.1.show"] = true; });
    expect(texts(".seen")).toEqual(["load Anna", "load Ben2"]);
    expect(error).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- #368

const SEEN_INNER = '<span class="name">{{ name }}</span><span class="seen">{{ seen }}</span>';
const seenState = (): Record<string, any> => ({ seen: "-", $connectedCallback(this: any) { this.seen = `saw ${this.name}`; } });
const FLAGS = () => ({ on: true, users: [{ name: "Anna", flag: "-", show: true }, { name: "Ben", flag: "-", show: true }, { name: "Cy", flag: "-", show: true }] });
const NESTED_GROUPS = () => ({ groups: [{ users: [{ name: "x-Anna", flag: "-" }, { name: "x-Ben", flag: "-" }] }, { users: [{ name: "y-Ed", flag: "-" }, { name: "y-Flo", flag: "-" }] }] });
const NAME_ONLY = '<span class="name">{{ name }}</span>';
const flagsOf = (users: any[]): string[] => users.map((u) => `${u.name}:${u.flag}`);
const IN_ROW_IF = (wiring: string) => (tag: string) =>
  `<div><template data-wcs="for: users"><template data-wcs="if: .show"><${tag} data-wcs="${wiring}"></${tag}></template></template></div>`;
const OUTER_IF = (wiring: string) => (tag: string) =>
  `<div><template data-wcs="if: on"><template data-wcs="for: users"><${tag} data-wcs="${wiring}"></${tag}></template></template></div>`;
const NESTED_FOR = (wiring: string) => (tag: string) =>
  `<div><template data-wcs="for: groups"><section><template data-wcs="for: .users"><${tag} data-wcs="${wiring}"></${tag}></template></section></template></div>`;

/** `$disconnectedCallback` reads a tree key and writes a row key; a throw is logged as "threw". */
const disconnectLogger = (log: string[]) => (): Record<string, any> => ({
  $disconnectedCallback(this: any) {
    try {
      log.push(`read:${this.name}`);
      this.flag = `gone:${this.name}`;
    } catch {
      log.push("threw");
    }
  },
});

/**
 * A removed row's element: its `$disconnectedCallback` never reads another row's name and its
 * write does not land (3.4 and 4.0 throw on the read already; the "（3.4 の形）" test pins that).
 */
const onlyOwn = (log: string[], own: string[]): void => {
  for (const entry of log) expect(entry === "threw" || own.includes(entry.slice("read:".length)), entry).toBe(true);
  expect(log).toContain("threw");
};

describe.each(["state: .", "state.name: .name"])("#368 for: の行の再接続・if: の再表示の $connectedCallback が、自分の行を読む（%s）", (wiring) => {
  it("要素が行の直下でない（行の要素の子）ときも、行を消して足した後に新しい行を読む", async () => {
    const error = spyErrors();
    const tag = component(SEEN_INNER, seenState);
    const { texts, write } = await page(`<ul><template data-wcs="for: users"><li><${tag} data-wcs="${wiring}"></${tag}></li></template></ul>`, USERS(), tag);
    await write((s) => { s.users = [s.users[0], s.users[2]]; });
    await write((s) => { s.users = [...s.users, { name: "Dan" }]; });
    expect(texts(".seen")).toEqual(["saw Anna", "saw Cy", "saw Dan"]);
    expect(error).not.toHaveBeenCalled();
  });

  it("行の中の if: に置いた要素でも、行を消して足した後に、消えた行の位置にある別の行（Cy）を読まない", async () => {
    const error = spyErrors();
    const tag = component(SEEN_INNER, seenState);
    const { texts, write } = await page(IN_ROW_IF(wiring)(tag), FLAGS(), tag);
    await write((s) => { s.users = [s.users[0], s.users[2]]; });
    await write((s) => { s.users = [...s.users, { name: "Dan", flag: "-", show: true }]; });
    expect(texts(".seen")).toEqual(["saw Anna", "saw Cy", "saw Dan"]);
    expect(error).not.toHaveBeenCalled();
  });

  it("$connectedCallback からメソッドを同期で呼べる", async () => {
    const error = spyErrors();
    const tag = component(SEEN_INNER, () => ({
      seen: "-",
      load(this: any) { this.seen = `load ${this.name}`; },
      $connectedCallback(this: any) { this.load(); },
    }));
    const { texts, write } = await page(FOR(wiring)(tag), USERS(), tag);
    await write((s) => { s.users = [s.users[0], s.users[2], { name: "Dan" }]; });
    expect(texts(".seen")).toEqual(["load Anna", "load Cy", "load Dan"]);
    expect(error).not.toHaveBeenCalled();
  });

  it("if: で再表示した行で、隠している間に変わったツリーのキーを同期で読める", async () => {
    const error = spyErrors();
    const tag = component(SEEN_INNER, seenState);
    const { texts, write } = await page(IN_ROW_IF(wiring)(tag), FLAGS(), tag);
    await write((s) => { s["users.1.show"] = false; });
    await write((s) => { s["users.1.name"] = "Ben2"; });
    await write((s) => { s["users.1.show"] = true; });
    expect(texts(".name")).toEqual(["Anna", "Ben2", "Cy"]);
    expect(texts(".seen")).toEqual(["saw Anna", "saw Ben2", "saw Cy"]);
    expect(error).not.toHaveBeenCalled();
  });

  it("行を消して足すと、$disconnectedCallback → $connectedCallback が 1 回ずつ、この順で呼ばれる", async () => {
    const log: string[] = [];
    const tag = component(SEEN_INNER, () => ({
      seen: "-",
      $connectedCallback(this: any) { log.push(`connect:${this.name}`); },
      $disconnectedCallback() { log.push("disconnect"); },
    }));
    const { write } = await page(FOR(wiring)(tag), USERS(), tag);
    expect(log).toEqual(["connect:Anna", "connect:Ben", "connect:Cy"]);
    log.length = 0;
    await write((s) => { s.users = [s.users[0], s.users[2]]; });
    await write((s) => { s.users = [...s.users, { name: "Dan" }]; });
    expect(log).toEqual(["disconnect", "connect:Dan"]);
  });
});

describe.each(["state: .", "state.name: .name; state.flag: .flag"])("#368 行が消えたときの $disconnectedCallback は、ほかの行を読み書きしない（%s）", (wiring) => {
  it("行の直下の要素: 書き込みは投げ、ほかの行を読まず、残った行を書き換えない", async () => {
    const log: string[] = [];
    const tag = component(NAME_ONLY, disconnectLogger(log));
    const { write, json } = await page(FOR(wiring)(tag), FLAGS(), tag);
    await write((s) => { s.users = [s.users[0], s.users[2]]; });
    onlyOwn(log, ["Ben"]);
    expect(flagsOf(json("users"))).toEqual(["Anna:-", "Cy:-"]);
  });

  // 行が消えた後の $disconnectedCallback のツリーのキーの読みも、書き込みと同じに投げる（3.4 #368。私有キーは
  // 読み書きできる — 下の後始末のテスト）
  it("（3.4 の形）行の直下の要素: ツリーのキーの読みも、行が消えた旨で投げる", async () => {
    const log: string[] = [];
    const tag = component(NAME_ONLY, disconnectLogger(log));
    const { write } = await page(FOR(wiring)(tag), FLAGS(), tag);
    await write((s) => { s.users = [s.users[0], s.users[2]]; });
    expect(log).toEqual(["threw"]);
  });

  it("行を引く $ API（$getAll / $resolve）は、ほかの行の値を返さない", async () => {
    const log: string[] = [];
    const tag = component(NAME_ONLY, () => ({
      $disconnectedCallback(this: any) {
        for (const call of [() => this.$getAll("name", []), () => this.$resolve("name", [])]) {
          try { log.push(`read:${JSON.stringify(call())}`); } catch { log.push("threw"); }
        }
      },
    }));
    const { write } = await page(FOR(wiring)(tag), FLAGS(), tag);
    await write((s) => { s.users = [s.users[0], s.users[2]]; });
    expect(log).toHaveLength(2);
    for (const entry of log) expect(["threw", 'read:["Ben"]', 'read:"Ben"'], entry).toContain(entry);
  });

  it("リストを丸ごと差し替える（全行の削除）と、消えた行の要素は同じ位置の新しい行を読み書きしない", async () => {
    const log: string[] = [];
    const tag = component(NAME_ONLY, disconnectLogger(log));
    const { write, json } = await page(FOR(wiring)(tag), FLAGS(), tag);
    await write((s) => { s.users = [{ name: "Dan", flag: "-" }, { name: "Eve", flag: "-" }, { name: "Fay", flag: "-" }]; });
    onlyOwn(log, ["Anna", "Ben", "Cy"]);
    expect(log.filter((e) => e === "threw")).toHaveLength(3);
    expect(flagsOf(json("users"))).toEqual(["Dan:-", "Eve:-", "Fay:-"]);
  });

  it("行の中の if: の要素も、残っている別の行（消えた行の位置の Cy）を読み書きしない", async () => {
    const log: string[] = [];
    const tag = component(NAME_ONLY, disconnectLogger(log));
    const { write, json } = await page(IN_ROW_IF(wiring)(tag), FLAGS(), tag);
    await write((s) => { s.users = [s.users[0], s.users[2]]; });
    onlyOwn(log, ["Ben"]);
    expect(flagsOf(json("users"))).toEqual(["Anna:-", "Cy:-"]);
  });

  it("入れ子の for で外側の行を消すと、その行の要素は残った外側の行を読み書きしない", async () => {
    const log: string[] = [];
    const tag = component(NAME_ONLY, disconnectLogger(log));
    const { write, json } = await page(NESTED_FOR(wiring)(tag), NESTED_GROUPS(), tag);
    await write((s) => { s.groups = [s.groups[1]]; });
    onlyOwn(log, ["x-Anna", "x-Ben"]);
    expect(log.filter((e) => e === "threw")).toHaveLength(2);
    expect(flagsOf((json("groups") as any[])[0].users)).toEqual(["y-Ed:-", "y-Flo:-"]);
  });

  it("外側の行をコピーに差し替えると、内側の要素の $disconnectedCallback は書かず、新しい要素の $connectedCallback は新しい外側の行を読む", async () => {
    const log: string[] = [];
    const tag = component(NAME_ONLY, () => ({
      ...disconnectLogger(log)(),
      $connectedCallback(this: any) { log.push(`connect:${this.name}`); },
    }));
    const { write, json } = await page(NESTED_FOR(wiring)(tag), NESTED_GROUPS(), tag);
    log.length = 0;
    await write((s) => { s.groups = s.groups.map((g: any) => ({ ...g })); });
    onlyOwn(log.filter((e) => !e.startsWith("connect:")), ["x-Anna", "x-Ben", "y-Ed", "y-Flo"]);
    expect(log.filter((e) => e.startsWith("connect:")).sort()).toEqual(["connect:x-Anna", "connect:x-Ben", "connect:y-Ed", "connect:y-Flo"]);
    expect((json("groups") as any[]).flatMap((g) => flagsOf(g.users))).toEqual(["x-Anna:-", "x-Ben:-", "y-Ed:-", "y-Flo:-"]);
  });

  it("行が生きている（祖先の if: が for ごと隠した）ときは、その行を読み書きする", async () => {
    const log: string[] = [];
    const tag = component(NAME_ONLY, disconnectLogger(log));
    const { write, json } = await page(OUTER_IF(wiring)(tag), FLAGS(), tag);
    await write((s) => { s.on = false; });
    expect(log).toEqual(["read:Anna", "read:Ben", "read:Cy"]);
    expect(flagsOf(json("users"))).toEqual(["Anna:gone:Anna", "Ben:gone:Ben", "Cy:gone:Cy"]);
  });

  it("$disconnectedCallback から呼んだメソッドも、残っている別の行を読み書きしない", async () => {
    const log: string[] = [];
    const tag = component(NAME_ONLY, () => ({
      cleanup(this: any) {
        try {
          log.push(`read:${this.name}`);
          this.flag = `gone:${this.name}`;
        } catch {
          log.push("threw");
        }
      },
      $disconnectedCallback(this: any) { try { this.cleanup(); } catch { log.push("threw"); } },
    }));
    const { write, json } = await page(IN_ROW_IF(wiring)(tag), FLAGS(), tag);
    await write((s) => { s.users = [s.users[0], s.users[2]]; });
    onlyOwn(log, ["Ben"]);
    expect(flagsOf(json("users"))).toEqual(["Anna:-", "Cy:-"]);
  });

  it("$disconnectedCallback から呼んだ async メソッドは、await の間に足した行に書かない", async () => {
    const log: string[] = [];
    const { gate, release } = deferred();
    const tag = component(NAME_ONLY, () => ({
      async save(this: any) {
        await gate;
        try {
          this.flag = `saved:${this.name}`;
          log.push("wrote");
        } catch {
          log.push("threw");
        }
      },
      $disconnectedCallback(this: any) { this.save().catch(() => {}); },
    }));
    const { write, json } = await page(IN_ROW_IF(wiring)(tag), FLAGS(), tag);
    await write((s) => { s.users = [s.users[0], s.users[2]]; });
    await write((s) => { s.users = [...s.users, { name: "Dan", flag: "-", show: true }]; });
    release();
    await write(() => {});
    expect(log).toEqual(["threw"]);
    expect(flagsOf(json("users"))).toEqual(["Anna:-", "Cy:-", "Dan:-"]);
  });
});

/** async `$connectedCallback`: waits for its gate, then reads a tree key and writes a row key. */
const gatedConnect = (log: string[], gates: (() => void)[], armed: { on: boolean }) => (): Record<string, any> => ({
  async $connectedCallback(this: any) {
    if (!armed.on) return;
    await new Promise<void>((r) => gates.push(r));
    try {
      const now = this.name;
      log.push(`read:${now}`);
      this.flag = `late:${now}`;
      log.push("wrote");
    } catch {
      log.push("threw");
    }
  },
});

describe.each(["state: .", "state.name: .name; state.flag: .flag"])("#368 async の $connectedCallback の await の後（%s）", (wiring) => {
  it("await の間に要素の行が消え、別の行が足されても、どちらの行にも書かない（後から足した行の要素は自分の行に書く）", async () => {
    const log: string[] = [];
    const gates: (() => void)[] = [];
    const armed = { on: false };
    const tag = component(NAME_ONLY, gatedConnect(log, gates, armed));
    const { writeRaw: write, json } = await page(FOR(wiring)(tag), FLAGS(), tag);
    armed.on = true;
    await write((s) => { s.users = [s.users[0], s.users[2]]; });
    await write((s) => { s.users = [...s.users, { name: "Dan", flag: "-" }]; }); // 待機 1（Dan）
    await write((s) => { s.users = [s.users[0], s.users[1]]; }); // Dan を消す
    await write((s) => { s.users = [...s.users, { name: "Eve", flag: "-" }]; }); // 待機 2（Eve）
    expect(gates).toHaveLength(2);
    gates.shift()!();
    await write(() => {});
    onlyOwn(log, ["Dan"]);
    expect(flagsOf(json("users"))).toEqual(["Anna:-", "Cy:-", "Eve:-"]);
    log.length = 0;
    gates.shift()!();
    await write(() => {});
    expect(log).toEqual(["read:Eve", "wrote"]);
    expect(flagsOf(json("users"))).toEqual(["Anna:-", "Cy:-", "Eve:late:Eve"]);
  });

  it("行が消えただけ（行の中の if: の再表示で待っている間に行を消す）でも、消えた行の位置の別の行に書かない", async () => {
    const log: string[] = [];
    const gates: (() => void)[] = [];
    const armed = { on: false };
    const tag = component(NAME_ONLY, gatedConnect(log, gates, armed));
    const { writeRaw: write, json } = await page(IN_ROW_IF(wiring)(tag), FLAGS(), tag);
    armed.on = true;
    await write((s) => { s["users.1.show"] = false; });
    await write((s) => { s["users.1.show"] = true; }); // Ben の再表示（待機）
    await write((s) => { s.users = [s.users[0], s.users[2]]; });
    expect(gates).toHaveLength(1);
    gates.shift()!();
    await write(() => {});
    onlyOwn(log, ["Ben"]);
    expect(flagsOf(json("users"))).toEqual(["Anna:-", "Cy:-"]);
  });

  it("行が動いただけなら、その行に書く", async () => {
    const log: string[] = [];
    const gates: (() => void)[] = [];
    const armed = { on: false };
    const tag = component(NAME_ONLY, gatedConnect(log, gates, armed));
    const { writeRaw: write, json } = await page(FOR(wiring)(tag), FLAGS(), tag);
    armed.on = true;
    await write((s) => { s.users = [s.users[0], s.users[2]]; });
    await write((s) => { s.users = [...s.users, { name: "Dan", flag: "-" }]; });
    await write((s) => { s.users = [s.users[2], s.users[0], s.users[1]]; });
    gates.shift()!();
    await write(() => {});
    expect(log).toEqual(["read:Dan", "wrote"]);
    expect(flagsOf(json("users"))).toEqual(["Dan:late:Dan", "Anna:-", "Cy:-"]);
  });
});

describe.each(["state: .", "state.name: .name"])("#368 $disconnectedCallback の後始末: 私有キー（接続で置いたタイマーの id）を読め、漏れが無い（%s）", (wiring) => {
  const TID_INNER = '<span class="name">{{ name }}</span><span class="tid">{{ tid }}</span>';
  const layouts: Record<string, (w: string) => (tag: string) => string> = { row: FOR, inIf: IN_ROW_IF, outerIf: OUTER_IF };
  const ops: Record<string, (s: any) => void> = {
    removeMid: (s) => { s.users = [s.users[0], s.users[2]]; },
    clear: (s) => { s.users = []; },
    replaceAll: (s) => { s.users = [{ name: "Dan", flag: "-", show: true }, { name: "Eve", flag: "-", show: true }]; },
    elemWrite: (s) => { s["users.1"] = { name: "Dan", flag: "-", show: true }; },
    hideRow: (s) => { s["users.1.show"] = false; },
    hideAll: (s) => { s.on = false; },
  };
  const cases: [string, string][] = [
    ["row", "removeMid"], ["row", "clear"], ["row", "replaceAll"],
    ["inIf", "removeMid"], ["inIf", "clear"], ["inIf", "replaceAll"], ["inIf", "elemWrite"], ["inIf", "hideRow"],
    ["outerIf", "removeMid"], ["outerIf", "clear"], ["outerIf", "replaceAll"], ["outerIf", "hideAll"],
  ];
  const timer = (active: Set<number>, counter: { n: number }) => (): Record<string, any> => ({
    tid: 0,
    stop(this: any) { active.delete(this.tid); },
    $connectedCallback(this: any) { const id = ++counter.n; this.tid = id; active.add(id); },
    $disconnectedCallback(this: any) { this.stop(); },
  });

  it.each(cases)("%s × %s", async (layout, op) => {
    const error = spyErrors();
    const active = new Set<number>();
    const tag = component(TID_INNER, timer(active, { n: 0 }));
    const { texts, write } = await page(layouts[layout](wiring)(tag), FLAGS(), tag);
    await write(ops[op]);
    expect([...active].sort()).toEqual(texts(".tid").map(Number).sort());
    expect(error).not.toHaveBeenCalled();
  });
});

/** Keeps each name's first `$connectedCallback` `this` (README's clock: the `this` inside setInterval). */
const savingConnect = (saved: Map<string, any>) => (): Record<string, any> => ({
  $connectedCallback(this: any) {
    const name = this.name;
    if (!saved.has(name)) saved.set(name, this);
  },
});

describe.each(["state: .", "state.name: .name; state.flag: .flag"])("#368 取っておいたライフサイクルの this の着地（%s）", (wiring) => {
  it("行の中の if: が要素を隠しただけ（行は生きている）なら、その行に書ける", async () => {
    const error = spyErrors();
    const saved = new Map<string, any>();
    const tag = component(NAME_ONLY, savingConnect(saved));
    const { write, json } = await page(IN_ROW_IF(wiring)(tag), FLAGS(), tag);
    await write((s) => { s["users.1.show"] = false; });
    const ben = saved.get("Ben");
    ben.flag = `late:${ben.name}`;
    expect(flagsOf(json("users"))).toEqual(["Anna:-", "Ben:late:Ben", "Cy:-"]);
    expect(error).not.toHaveBeenCalled();
  });

  it("行の要素の書き込みでその場の行が差し替わった（要素は残る）なら、新しい行に書く", async () => {
    const saved = new Map<string, any>();
    const tag = component(NAME_ONLY, savingConnect(saved));
    const { write, json } = await page(FOR(wiring)(tag), FLAGS(), tag);
    await write((s) => { s["users.1"] = { name: "Dan", flag: "-", show: true }; });
    const ben = saved.get("Ben");
    expect(ben.name).toBe("Dan");
    ben.flag = "late";
    expect(flagsOf(json("users"))).toEqual(["Anna:-", "Dan:late", "Cy:-"]);
  });

  it.each([
    ["並べ替え", [(s: any) => { s.users = [s.users[1], s.users[0], s.users[2]]; }]],
    ["for ごと隠す", [(s: any) => { s.on = false; }]],
    ["隠して戻す", [(s: any) => { s.on = false; }, (s: any) => { s.on = true; }]],
  ] as [string, ((s: any) => void)[]][])("行の要素の書き込みで差し替えた後に%sしても、取っておいた this は差し替えた行（Dan）に書く", async (_label, fns) => {
    const saved = new Map<string, any>();
    const tag = component(NAME_ONLY, savingConnect(saved));
    const { write, json } = await page(OUTER_IF(wiring)(tag), FLAGS(), tag);
    await write((s) => { s["users.1"] = { name: "Dan", flag: "-", show: true }; });
    for (const fn of fns) await write(fn);
    const ben = saved.get("Ben");
    expect(ben.name).toBe("Dan");
    ben.flag = "late";
    expect((json("users") as any[]).find((u) => u.name === "Dan").flag).toBe("late");
  });

  it("行が消えた後（同じバッチの後に行を足しても）、取っておいた this の書き込みは投げ、足した行（Eve）に書かない", async () => {
    const saved = new Map<string, any>();
    const tag = component(NAME_ONLY, savingConnect(saved));
    const { write, json } = await page(FOR(wiring)(tag), FLAGS(), tag);
    await write((s) => { s.users = [s.users[0], s.users[2]]; });
    await write((s) => { s.users = [...s.users, { name: "Eve", flag: "-", show: true }]; });
    const ben = saved.get("Ben");
    expect(() => { ben.flag = "late"; }).toThrow();
    expect(flagsOf(json("users"))).toEqual(["Anna:-", "Cy:-", "Eve:-"]);
  });

  it("行の中の if: が隠している間に公開面から同期で呼んだメソッドは、その行に書く", async () => {
    const error = spyErrors();
    const tag = component(NAME_ONLY, () => ({ mark(this: any) { this.flag = `m:${this.name}`; } }));
    const { comps, write, json } = await page(IN_ROW_IF(wiring)(tag), FLAGS(), tag);
    const ben = comps()[1];
    await write((s) => { s["users.1.show"] = false; });
    ben.state.mark();
    await settle();
    expect(flagsOf(json("users"))).toEqual(["Anna:-", "Ben:m:Ben", "Cy:-"]);
    expect(error).not.toHaveBeenCalled();
  });

  it("隠れている間に公開面から呼んだ async メソッドは、同じ行に再表示された後にその行へ書く", async () => {
    const { gate, release } = deferred();
    const tag = component(NAME_ONLY, () => ({
      async save(this: any, value: string) { await gate; this.flag = `${value}:${this.name}`; },
    }));
    const { comps, write, json } = await page(IN_ROW_IF(wiring)(tag), FLAGS(), tag);
    const ben = comps()[1];
    await write((s) => { s["users.1.show"] = false; });
    const result = ben.state.save("ext");
    await write((s) => { s["users.1.show"] = true; });
    release();
    await result;
    await settle();
    expect(flagsOf(json("users"))).toEqual(["Anna:-", "Ben:ext:Ben", "Cy:-"]);
  });

  it("行の中の if: が隠した要素の $disconnectedCallback は、自分の行を読み書きする", async () => {
    const log: string[] = [];
    const tag = component(NAME_ONLY, disconnectLogger(log));
    const { write, json } = await page(IN_ROW_IF(wiring)(tag), FLAGS(), tag);
    await write((s) => { s["users.1.show"] = false; });
    expect(log).toEqual(["read:Ben"]);
    expect(flagsOf(json("users"))).toEqual(["Anna:-", "Ben:gone:Ben", "Cy:-"]);
  });

  it("$connectedCallback と同じ接続の $disconnectedCallback は同じ this を受け取る", async () => {
    const seen = new WeakSet<object>();
    const log: string[] = [];
    const tag = component(NAME_ONLY, () => ({
      $connectedCallback(this: any) { seen.add(this); },
      $disconnectedCallback(this: any) { log.push(`same:${seen.has(this)}`); },
    }));
    const { write } = await page(FOR(wiring)(tag), FLAGS(), tag);
    await write((s) => { s.users = [s.users[0], s.users[2]]; });
    expect(log).toEqual(["same:true"]);
  });
});

describe.each(["state: .", "state.profile: .profile"])("#367 / #368 マウントしたキーの下にあるホストの行の getter（users.*.profile.upper）を、行が消えた後に読む（%s）", (wiring) => {
  const PROFILES = () => ({
    users: [{ name: "Anna", profile: { n: "anna" } }, { name: "Ben", profile: { n: "ben" } }, { name: "Cy", profile: { n: "cy" } }],
    get "users.*.profile.upper"() { return String((this as any)["users.*.profile.n"]).toUpperCase(); },
  });
  const profileCard = (log: string[], gate: Promise<void>) => component('<b class="u">{{ profile.upper }}</b><button data-wcs="onclick: later"></button>', () => ({
    async later(this: any) {
      await gate;
      try { log.push(`later:${this["profile.upper"]}`); } catch { log.push("later:threw"); }
    },
    $disconnectedCallback(this: any) {
      try { log.push(`disc:${this["profile.upper"]}`); } catch { log.push("disc:threw"); }
    },
  }));

  it("（対照）行が並べ替わっただけなら、await の後もその行の getter を読む", async () => {
    const log: string[] = [];
    const { gate, release } = deferred();
    const tag = profileCard(log, gate);
    const { comps, texts, write } = await page(FOR(wiring)(tag), PROFILES(), tag);
    expect(texts(".u")).toEqual(["ANNA", "BEN", "CY"]);
    click(comps()[1], "button"); // Ben
    await settle();
    await write((s) => { s.users = [s.users[2], s.users[1], s.users[0]]; });
    await write((s) => { s.users = [s.users[1], s.users[0], s.users[2]]; });
    release();
    await settle();
    // （並べ替えで動かした要素は外れて戻るので、$disconnectedCallback も走る — 生きている自分の行を読む）
    expect(log.filter((l) => l.startsWith("later:"))).toEqual(["later:BEN"]);
    expect(log.filter((l) => l.startsWith("disc:")).every((l) => l === "disc:BEN" || l === "disc:CY" || l === "disc:ANNA")).toBe(true);
  });

  // マウントしたキーの下のホストの行の getter は、消えた行の位置ではなくその行から解決する: 行が消えた後の読みは、
  // その位置にいまある別の行（Cy）を読まず、行が消えた旨で投げる（3.4 #368）
  it("$disconnectedCallback の読みは、消えた行の位置にいまある別の行（Cy）の値を返さない", async () => {
    const log: string[] = [];
    const tag = profileCard(log, Promise.resolve());
    const { write } = await page(FOR(wiring)(tag), PROFILES(), tag);
    await write((s) => { s.users = [s.users[0], s.users[2]]; });
    expect(log).toEqual(["disc:threw"]);
  });

  // await の間に行が消えると、await の後の同じ読みは、消えた行の位置にいまある別の行（Cy）を読まず、行が消えた旨で
  // 投げる（3.4 #367）
  it("async メソッドの await の後の読みは、消えた行の位置にいまある別の行（Cy）の値を返さない", async () => {
    const log: string[] = [];
    const { gate, release } = deferred();
    const tag = profileCard(log, gate);
    const { comps, write } = await page(FOR(wiring)(tag), PROFILES(), tag);
    click(comps()[1], "button"); // Ben
    await settle();
    await write((s) => { s.users = [s.users[0], s.users[2]]; });
    log.length = 0;
    release();
    await settle();
    expect(log).toEqual(["later:threw"]);
  });
});

describe("#368 マウントしたコンポーネントの中にマウントしたコンポーネント", () => {
  it("外側の行を消して足すと、内側（部分マウント）の $connectedCallback も新しい行を読む", async () => {
    const inner = component(SEEN_INNER, seenState);
    const outer = component(`${SEEN_INNER}<${inner} data-wcs="state.name: name"></${inner}>`, seenState);
    const { root, texts, write } = await page(FOR("state.name: .name")(outer), USERS(), outer);
    await settle();
    const innerSeen = () => Array.from(root.querySelectorAll(outer)).map((o: any) => text(o.shadowRoot.querySelector(inner), ".seen"));
    expect(innerSeen()).toEqual(["saw Anna", "saw Ben", "saw Cy"]);
    await write((s) => { s.users = [s.users[0], s.users[2]]; });
    await write((s) => { s.users = [...s.users, { name: "Dan" }]; });
    await settle();
    expect(texts(".seen")).toEqual(["saw Anna", "saw Cy", "saw Dan"]);
    expect(innerSeen()).toEqual(["saw Anna", "saw Cy", "saw Dan"]);
  });

  it("外側の <wcs-state bind-component> が内側の要素より後にあっても、内側の $connectedCallback は新しい行を読む", async () => {
    const inner = component(SEEN_INNER, seenState);
    const outer = `rg3m-outer-${seq++}`;
    customElements.define(outer, class extends HTMLElement {
      state: Record<string, any> = { seen: "-" };
      constructor() {
        super();
        this.attachShadow({ mode: "open" }).innerHTML = `${SEEN_INNER}<${inner} data-wcs="state.name: name"></${inner}><wcs-state bind-component="state"></wcs-state>`;
      }
    });
    const { root, write } = await page(FOR("state.name: .name")(outer), USERS(), outer);
    await settle();
    const innerSeen = () => Array.from(root.querySelectorAll(outer)).map((o: any) => text(o.shadowRoot.querySelector(inner), ".seen"));
    expect(innerSeen()).toEqual(["saw Anna", "saw Ben", "saw Cy"]);
    await write((s) => { s.users = [s.users[0], s.users[2]]; });
    await write((s) => { s.users = [...s.users, { name: "Dan" }]; });
    await settle();
    expect(innerSeen()).toEqual(["saw Anna", "saw Cy", "saw Dan"]);
  });

  it.each(["state: .", "state.name: .name; state.note: .note"])("部品の shadow の中の for: にある部品の $connectedCallback は、外の行を消して足しても、残っている別の行に書かない（%s）", async (wiring) => {
    let serial = 0;
    const inner = `rg3m-inner-${seq++}`;
    class Inner extends HTMLElement {
      serial = ++serial;
      state: Record<string, any> = ((element: Inner) => ({
        $connectedCallback(this: any) { this.note = `${this.name} by #${element.serial}`; },
      }))(this);
      constructor() {
        super();
        this.attachShadow({ mode: "open" }).innerHTML = '<wcs-state bind-component="state"></wcs-state><b class="n">{{ name }}</b>';
      }
    }
    customElements.define(inner, Inner);
    const outer = component(`<template data-wcs="for: items"><${inner} data-wcs="${wiring}"></${inner}></template>`, () => ({}));
    const { write, json } = await page(`<div><template data-wcs="for: groups"><${outer} data-wcs="state: ."></${outer}></template></div>`,
      { groups: [{ items: [{ name: "a1", note: "-" }] }, { items: [{ name: "b1", note: "-" }] }] }, outer);
    await settle();
    const notes = () => (json("groups") as any[]).map((g) => g.items[0].note);
    const [a1Note, b1Note] = notes();
    expect(a1Note).toMatch(/^a1 by #\d+$/);
    expect(b1Note).toMatch(/^b1 by #\d+$/);
    await write((s) => { s.groups = [s.groups[1], { items: [{ name: "c1", note: "-" }] }]; });
    await settle();
    const [first, second] = notes();
    expect(first).toBe(b1Note);
    expect(second).toMatch(/^c1 by #\d+$/);
  });
});

describe("#368 行の外のコンポーネントのライフサイクルの this", () => {
  it("切断・再接続の後も、取っておいた $connectedCallback の this で読み書きできる", async () => {
    const saved: any[] = [];
    const tag = component(NAME_ONLY, () => ({ $connectedCallback(this: any) { saved.push(this); } }));
    const { root, write, read } = await page(`<div><${tag} data-wcs="state: user"></${tag}></div>`, { user: { name: "Zed" } }, tag);
    const element = root.querySelector(tag)!;
    const parent = element.parentNode!;
    element.remove();
    await settle();
    parent.appendChild(element);
    await settle();
    expect(saved).toHaveLength(2);
    expect(saved[0].name).toBe("Zed");
    saved[0].name = "Zed2";
    await write(() => {});
    expect(read("user.name")).toBe("Zed2");
  });

  it("element.state と同じもので、接続をまたいで同じ", async () => {
    const seen: object[] = [];
    const tag = component(NAME_ONLY, () => ({
      $connectedCallback(this: any) { seen.push(this); },
      $disconnectedCallback(this: any) { seen.push(this); },
    }));
    const { root } = await page(`<div><${tag} data-wcs="state: user"></${tag}></div>`, { user: { name: "Zed" } }, tag);
    const element = root.querySelector(tag) as any;
    const parent = element.parentNode;
    element.remove();
    await settle();
    parent.appendChild(element);
    await settle();
    expect(seen).toHaveLength(3);
    expect(seen.every((self) => self === element.state)).toBe(true);
  });
});

describe("#368 shadow を connectedCallback で組み直す行の部品（外れた古い <wcs-state> に届く接続の反応）", () => {
  it("行を差し替えても、並べ替えで要素が外れて戻っても（4.0 は行の要素を使い回さず、再接続は並べ替えで起きる）、外れた古い <wcs-state> の接続の反応は投げない", async () => {
    const rejected: unknown[] = [];
    let rebuilt = 0;
    const markup = `<wcs-state bind-component="state"></wcs-state><span class="row-view">{{ row.id }}</span>`;
    const tag = `rg3m-cc-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      state: Record<string, any> = {};
      constructor() {
        super();
        this.attachShadow({ mode: "open" });
      }
      connectedCallback() {
        const previous = this.shadowRoot!.querySelector("wcs-state") as any;
        this.shadowRoot!.innerHTML = markup;
        if (previous !== null) {
          rebuilt++;
          // Chromium は古い <wcs-state> の接続の反応を innerHTML の差し替えの後（外れた後）に届け、続けて切断の反応を
          // 届ける（CEReactions）。happy-dom は外す前に届けるので、同じ順を足す
          try {
            Promise.resolve(previous.connectedCallback()).catch((e: unknown) => { rejected.push(e); });
            previous.disconnectedCallback();
          } catch (e) {
            rejected.push(e);
          }
        }
      }
    });
    const { root, write } = await page(
      `<ul><template data-wcs="for: groups"><li><span class="gid">{{ .id }}</span><${tag} data-wcs="state.row: ."></${tag}></li></template></ul>`,
      { groups: [{ id: "g1" }, { id: "g2" }] }, tag);
    await settle();
    const views = () => Array.from(root.querySelectorAll(tag)).map((r) => r.shadowRoot!.querySelector(".row-view")?.textContent);
    expect(views()).toEqual(["g1", "g2"]);
    await write((s) => { s.groups = [{ id: "g9" }]; });
    expect(views()).toEqual(["g9"]);
    await write((s) => { s.groups = [{ id: "gA" }, { id: "gB" }, { id: "gC" }]; });
    expect(views()).toEqual(["gA", "gB", "gC"]);
    await write((s) => { s.groups = [s.groups[2], s.groups[0], s.groups[1]]; });
    expect(views()).toEqual(["gC", "gA", "gB"]);
    expect(rebuilt).toBeGreaterThan(0);
    expect(rejected.map((e: any) => e?.message ?? String(e))).toEqual([]);
  });
});
