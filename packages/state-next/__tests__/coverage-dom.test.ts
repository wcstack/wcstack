/**
 * coverage-dom.test.ts — the DOM layer (src/dom/*, src/trustedTypes.ts) through the page:
 * mounting, plans, blocks, rows, event dispatch, custom elements and Trusted Types.
 * The core alone (no diagnostics add-on): failures read as numbered messages.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState, getBindingsReady, getTrustedTypesPolicy, setTrustedTypesPolicy } from "../src/index";
import { lisKeep } from "../src/dom/view";
import { M } from "../src/messages";

// the core's own message (no diagnostics add-on here): [@wcstack/state] [wcs/<code>] #<number> <values>
const core = (id: M) => new RegExp(String.raw`^\[@wcstack/state\] (\[wcs/[\w-]+\] )?#${id}( |$)`);

const flush = () => new Promise((r) => setTimeout(r, 0));
const RUNNER_KEY = Symbol.for("wcstack.transition-runner");
const LEDGER_KEY = Symbol.for("wcstack.state.view-transition-naming");
const BINDER_KEY = Symbol.for("wcstack.binder");
let seq = 0;

beforeAll(() => {
  bootstrapState();
});

afterEach(() => {
  delete (globalThis as any)[RUNNER_KEY];
  delete (globalThis as any)[LEDGER_KEY];
  setTrustedTypesPolicy(null);
  vi.restoreAllMocks();
});

/** A page (a shadow root) with a root `<wcs-state>` over `state`. */
async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`cov-dom-page-${seq++}`);
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
  const read = (path: string) => {
    let v: unknown;
    el.createState("readonly", (s: any) => { v = s[path]; });
    return v;
  };
  return { h, root, el, write, read };
}

/** A page whose initialization fails: resolves with what connectedCallbackPromise rejected with. */
async function failure(html: string, state: Record<string, any> = {}): Promise<Error> {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const h = document.createElement(`cov-dom-page-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  const e = await el.connectedCallbackPromise.then(() => null, (x: unknown) => x);
  expect(error).toHaveBeenCalledWith(e);
  error.mockRestore();
  return e as Error;
}

const texts = (c: ParentNode, sel: string) => Array.from(c.querySelectorAll(sel)).map((n) => n.textContent);

/** A fake view-transition arbiter that names blocks automatically, up to `limit`. */
function autoNaming(limit: number): void {
  (globalThis as any)[RUNNER_KEY] = {
    protocol: "wcs-transition-runner", version: 1, naming: "auto", namingLimit: limit,
    accepts: (source: string) => source === "state",
    run(mutate: () => void) {
      mutate();
      return Promise.resolve();
    },
  };
}

const vtName = (el: Element) => (el as HTMLElement).style.getPropertyValue("view-transition-name");

/** A wc-bindable element: `value` is a property (event `<tag>:change`) and an input, `label` an input, `ping` a command. */
function field(): string {
  const tag = `cov-field-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    static wcBindable = {
      protocol: "wc-bindable", version: 1,
      properties: [{ name: "value", event: `${tag}:change` }],
      inputs: [{ name: "value" }, { name: "label" }],
      commands: [{ name: "ping" }],
    };
    #value: unknown = "own";
    writes: unknown[] = [];
    label: unknown = "own label";
    pings: unknown[][] = [];
    get value() { return this.#value; }
    set value(v: unknown) {
      this.writes.push(v);
      this.#value = v;
    }
    ping(...args: unknown[]) { this.pings.push(args); }
  });
  return tag;
}

/** A wc-bindable element with an output-only `status` (seeded from the element: "ready"). */
function status(): string {
  const tag = `cov-status-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "status", event: `${tag}:status` }] };
    status = "ready";
  });
  return tag;
}

describe("ページの走査（mount）", () => {
  it("script と style の中身はバインドしない（data-wcs も mustache もそのまま）", async () => {
    const { root } = await page(
      `<script type="text/plain" data-wcs="textContent: msg">keep</script><style>/* {{ msg }} */</style><p>{{ msg }}</p>`,
      { msg: "hi" },
    );
    expect(root.querySelector("script")!.textContent).toBe("keep");
    expect(root.querySelector("style")!.textContent).toBe("/* {{ msg }} */");
    expect(root.querySelector("p")!.textContent).toBe("hi");
  });

  it("構造ディレクティブの無い <template> はそのまま残し、中身をバインドしない", async () => {
    const { root } = await page(
      `<template id="plain"><p>{{ msg }}</p></template><template id="empty" data-wcs=""><i>{{ msg }}</i></template>`
      + `<ul><template data-wcs="for: items"><li><template class="inner"><b>{{ msg }}</b></template>{{ . }}</li></template></ul>`,
      { msg: "hi", items: ["a", "b"] },
    );
    const plain = root.querySelector("template#plain") as HTMLTemplateElement;
    expect(plain.content.querySelector("p")!.textContent).toBe("{{ msg }}");
    expect((root.querySelector("template#empty") as HTMLTemplateElement).content.querySelector("i")!.textContent).toBe("{{ msg }}");
    // inside a row: the template is cloned with every row, untouched
    const inner = Array.from(root.querySelectorAll("li > template.inner")) as HTMLTemplateElement[];
    expect(inner.length).toBe(2);
    expect(inner.map((t) => t.content.querySelector("b")!.textContent)).toEqual(["{{ msg }}", "{{ msg }}"]);
    expect(texts(root, "li")).toEqual(["a", "b"]);
  });

  it("閉じていない {{ は文字のまま残す（ページでも行でも）", async () => {
    const { root } = await page(`<p>a {{ b</p><ul><template data-wcs="for: items"><li>x {{ y</li></template></ul>`, { items: [1] });
    expect(root.querySelector("p")!.textContent).toBe("a {{ b");
    expect(texts(root, "li")).toEqual(["x {{ y"]);
  });

  it("if の後の空白・コメントを越えて else を読み、構造ディレクティブの無い <template> で連鎖を終える", async () => {
    const { root, write } = await page(
      `<div class="one"><template data-wcs="if: on"><b>yes</b></template>\n  <!-- between -->\n  <template data-wcs="else:"><i>no</i></template></div>`
      + `<div class="two"><template data-wcs="if: on"><b>yes</b></template><template class="after"><i>left alone</i></template></div>`,
      { on: true },
    );
    const one = root.querySelector(".one")!;
    const two = root.querySelector(".two")!;
    expect(one.querySelector("b")!.textContent).toBe("yes");
    expect(one.querySelector("i")).toBeNull();
    expect(one.querySelector("template")).toBeNull();
    expect(two.querySelector("b")!.textContent).toBe("yes");
    // not an else: the chain ends before it, and it stays a template
    expect(two.querySelector("template.after")).not.toBeNull();
    await write((s) => { s.on = false; });
    expect(one.querySelector("b")).toBeNull();
    expect(one.querySelector("i")!.textContent).toBe("no");
    expect(two.querySelector("b")).toBeNull();
    expect(two.querySelector(":scope > i")).toBeNull();
  });

  it("ページ直下の else: が if の後に無ければ初期化に失敗する", async () => {
    expect((await failure(`<template data-wcs="else:"><p>x</p></template>`)).message).toMatch(core(M.ElseWithoutIf));
  });

  it("行の中の elseif: が if の後に無ければ初期化に失敗する", async () => {
    const e = await failure(`<ul><template data-wcs="for: items"><template data-wcs="elseif: x"><li>x</li></template></template></ul>`, { items: [], x: 1 });
    expect(e.message).toMatch(core(M.ElseWithoutIf));
    expect(e.message).toContain('"elseif"');
  });

  it("for の外でワイルドカードのパスを直接バインドすると初期化に失敗する", async () => {
    const e = await failure(`<p data-wcs="textContent: items.*.name"></p>`, { items: [] });
    expect(e.message).toMatch(core(M.WildcardNoLoop));
    expect(e.message).toContain('"items.*.name"');
  });

  it("for の外でドット始まりのパスを書くと初期化に失敗する", async () => {
    const e = await failure(`<p data-wcs="textContent: .name"></p>`, { name: "x" });
    expect(e.message).toMatch(core(M.WildcardRelative));
    expect(e.message).toContain('".name"');
  });

  it("command.<メソッド>: の右辺が $command.<名前> でなければ初期化に失敗する", async () => {
    const tag = field();
    const e = await failure(`<${tag} data-wcs="command.ping: go"></${tag}>`, { go: 1 });
    expect(e.message).toMatch(core(M.CommandRightSide));
    expect(e.message).toContain('"command.ping" "go"');
  });
});

describe("binder の受け口（要素でないもの）", () => {
  it("要素でないノードを渡されても何もしない（投げない）", async () => {
    const { root } = await page(`<main></main>`, { msg: "hi" });
    const text = document.createTextNode("{{ msg }}");
    root.querySelector("main")!.appendChild(text);
    expect(() => (globalThis as any)[BINDER_KEY].bind(text)).not.toThrow();
    expect(text.data).toBe("{{ msg }}");
  });
});

describe("イベントのバインディング", () => {
  it("バブルしないイベントは要素そのものに付く（ページ直下と行の中、行では添字を渡す）", async () => {
    const seen: unknown[] = [];
    const { root } = await page(
      `<input id="top" data-wcs="onfocus: focused"><ul><template data-wcs="for: items"><li><input data-wcs="onblur: left"></li></template></ul>`,
      {
        items: ["a", "b"],
        focused(e: Event) { seen.push(["focus", (e.currentTarget as Element).id]); },
        left(e: Event, i: number) { seen.push(["blur", (e.currentTarget as Element).localName, i]); },
      },
    );
    root.querySelector("#top")!.dispatchEvent(new Event("focus"));
    root.querySelectorAll("li input")[1].dispatchEvent(new Event("blur"));
    expect(seen).toEqual([["focus", "top"], ["blur", "input", 1]]);
  });

  it("ハンドラが投げた例外は console.error に出て、イベントの送出には漏れない", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { root } = await page(`<button data-wcs="onclick: boom">x</button>`, { boom() { throw new Error("handler failed"); } });
    expect(() => (root.querySelector("button") as HTMLElement).click()).not.toThrow();
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: "handler failed" }));
  });

  it("行の委譲: 型の違うハンドラは呼ばず、ハンドラの無い要素のクリックでは何も呼ばない", async () => {
    const seen: unknown[] = [];
    const { root } = await page(
      `<ul><template data-wcs="for: items"><li><button data-wcs="onclick: hit">b</button><input data-wcs="oninput: typed"><span>plain</span></li></template></ul>`,
      {
        items: ["a", "b"],
        hit(_e: Event, i: number) { seen.push(["hit", i]); },
        typed(_e: Event, i: number) { seen.push(["typed", i]); },
      },
    );
    const lis = root.querySelectorAll("li");
    (lis[1].querySelector("span") as HTMLElement).click();
    expect(seen).toEqual([]);
    (lis[1].querySelector("button") as HTMLElement).click();
    expect(seen).toEqual([["hit", 1]]);
    lis[0].querySelector("input")!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(seen).toEqual([["hit", 1], ["typed", 0]]);
  });

  it("行の同じ要素に同じイベントを 2 つ書くと、書いた順に両方呼ぶ", async () => {
    const seen: string[] = [];
    const { root } = await page(
      `<ul><template data-wcs="for: items"><li><button data-wcs="onclick: first; onclick: second">b</button></li></template></ul>`,
      { items: ["a"], first() { seen.push("first"); }, second() { seen.push("second"); } },
    );
    (root.querySelector("button") as HTMLElement).click();
    expect(seen).toEqual(["first", "second"]);
  });
});

describe("複数の最上位ノードを持つ行", () => {
  const html = `<div><template data-wcs="for: items">{{ .n }}<b data-wcs="onclick: hit">{{ .n }}</b><i>/</i></template></div>`;

  it("先頭がテキストでもクリックはその行に届き、並べ替えは行のノードをまとめて動かし、空にすると全部消える", async () => {
    const hits: number[] = [];
    const { root, write } = await page(html, {
      items: [{ n: 1 }, { n: 2 }, { n: 3 }],
      hit(_e: Event, i: number) { hits.push(i); },
    });
    const div = root.querySelector("div")!;
    expect(div.textContent).toBe("11/22/33/");
    (div.querySelectorAll("b")[2] as HTMLElement).click();
    expect(hits).toEqual([2]);
    const before = Array.from(div.querySelectorAll("b"));
    await write((s) => { s.items = [s.items[2], s.items[0], s.items[1]]; });
    expect(div.textContent).toBe("33/11/22/");
    // kept rows: the same elements, moved
    expect(Array.from(div.querySelectorAll("b"))).toEqual([before[2], before[0], before[1]]);
    await write((s) => { s.items = []; });
    expect(div.textContent).toBe("");
    expect(div.querySelectorAll("b, i").length).toBe(0);
  });
});

describe("フォーム要素の書き戻し", () => {
  it("type=button の input の value は書き戻さない", async () => {
    const { root, read } = await page(`<input type="button" data-wcs="value: label">`, { label: "Send" });
    const input = root.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("Send");
    input.value = "changed";
    input.dispatchEvent(new Event("input"));
    await flush();
    expect(read("label")).toBe("Send");
  });

  it("radio#ro は状態を表示するが、選ばれても書き戻さない", async () => {
    const { root, read, write } = await page(
      `<input type="radio" id="a" value="a" data-wcs="radio#ro: pick"><input type="radio" id="b" value="b" data-wcs="radio#ro: pick">`,
      { pick: "a" },
    );
    const a = root.querySelector("#a") as HTMLInputElement;
    const b = root.querySelector("#b") as HTMLInputElement;
    expect([a.checked, b.checked]).toEqual([true, false]);
    b.checked = true;
    b.dispatchEvent(new Event("input"));
    await flush();
    expect(read("pick")).toBe("a");
    await write((s) => { s.pick = "b"; });
    expect([a.checked, b.checked]).toEqual([false, true]);
  });

  it("選ばれていない radio の input イベントは何も書かない", async () => {
    const { root, read } = await page(`<input type="radio" value="a" data-wcs="radio: pick">`, { pick: "b" });
    const a = root.querySelector("input") as HTMLInputElement;
    expect(a.checked).toBe(false);
    a.dispatchEvent(new Event("input"));
    await flush();
    expect(read("pick")).toBe("b");
  });

  it("checkbox: 状態が配列でなければ空の配列から足し、既に入っている値は書き直さない", async () => {
    const { root, read } = await page(
      `<input type="checkbox" id="x" value="x" data-wcs="checkbox: tags"><input type="checkbox" id="y" value="y" data-wcs="checkbox: kept">`,
      { tags: null, kept: ["y"] },
    );
    const x = root.querySelector("#x") as HTMLInputElement;
    x.checked = true;
    x.dispatchEvent(new Event("input"));
    await flush();
    expect(read("tags")).toEqual(["x"]);
    const y = root.querySelector("#y") as HTMLInputElement;
    expect(y.checked).toBe(true);
    const before = read("kept");
    y.dispatchEvent(new Event("input"));
    await flush();
    // already in the array: no write (the same array)
    expect(read("kept")).toBe(before);
    expect(before).toEqual(["y"]);
  });
});

describe("HTML の書き込み先と Trusted Types", () => {
  it("innerHTML: null / undefined は中身を空にする", async () => {
    const { root } = await page(`<div data-wcs="innerHTML: h"><i>old</i></div>`, { h: null });
    expect(root.querySelector("div")!.innerHTML).toBe("");
  });

  it("srcdoc は HTML の書き込み先: 文字列にして書き、null は空にする", async () => {
    const { root, write } = await page(`<iframe data-wcs="srcdoc: doc"></iframe>`, { doc: "<p>hi</p>" });
    const frame = root.querySelector("iframe") as HTMLIFrameElement;
    expect(frame.srcdoc).toBe("<p>hi</p>");
    await write((s) => { s.doc = null; });
    expect(frame.srcdoc).toBe("");
  });

  it("置いたポリシーは読み出せ、html: / innerHTML: / srcdoc: の値はそのポリシーを通る", async () => {
    const seen: string[] = [];
    const policy = {
      createHTML(input: string) {
        seen.push(input);
        return input.replace(/<script[\s\S]*?<\/script>/gi, "");
      },
    };
    setTrustedTypesPolicy(policy);
    expect(getTrustedTypesPolicy()).toBe(policy);
    const bad = `<b>ok</b><script>alert(1)</script>`;
    const { root } = await page(
      `<div class="html" data-wcs="html: body"></div><div class="inner" data-wcs="innerHTML: body"></div><iframe data-wcs="srcdoc: body"></iframe>`,
      { body: bad },
    );
    expect(root.querySelector(".html")!.innerHTML).toBe("<b>ok</b>");
    expect(root.querySelector(".inner")!.innerHTML).toBe("<b>ok</b>");
    expect((root.querySelector("iframe") as HTMLIFrameElement).srcdoc).toBe("<b>ok</b>");
    expect(seen).toEqual([bad, bad, bad]);
    setTrustedTypesPolicy(null);
    expect(getTrustedTypesPolicy()).toBeNull();
  });
});

describe("wc-bindable の要素へのプロパティ", () => {
  it("状態が undefined になっても要素は自分の値を保ち、同じ値は書き直さない", async () => {
    const tag = field();
    const { root, write } = await page(`<${tag} class="a" data-wcs="value: x"></${tag}><${tag} class="b" data-wcs="value: same"></${tag}>`, { x: "a", same: "own" });
    const a = root.querySelector(".a") as any;
    const b = root.querySelector(".b") as any;
    expect(a.value).toBe("a");
    expect(a.writes).toEqual(["a"]);
    // the element already shows "own": no write
    expect(b.writes).toEqual([]);
    await write((s) => { s.x = undefined; });
    expect(a.value).toBe("a");
    expect(a.writes).toEqual(["a"]);
    await write((s) => { s.x = "c"; s.same = "new"; });
    expect(a.value).toBe("c");
    expect(b.writes).toEqual(["new"]);
  });

  it("行の中のスプレッド: 行のオブジェクト（...: .）とルートのオブジェクト（...: shared）", async () => {
    const tag = field();
    const { root, read } = await page(
      `<ul><template data-wcs="for: items"><li><${tag} class="own" data-wcs="...: ."></${tag}><${tag} class="shared" data-wcs="...: shared"></${tag}></li></template></ul>`,
      { items: [{ value: "v0", label: "L0" }, { value: "v1", label: "L1" }], shared: { value: "s", label: "S" } },
    );
    const own = Array.from(root.querySelectorAll(".own")) as any[];
    expect(own.map((e) => [e.value, e.label])).toEqual([["v0", "L0"], ["v1", "L1"]]);
    const shared = Array.from(root.querySelectorAll(".shared")) as any[];
    expect(shared.map((e) => [e.value, e.label])).toEqual([["s", "S"], ["s", "S"]]);
    // as the element does: it takes the value, then announces it
    const change = (e: any, v: string) => {
      e.value = v;
      e.dispatchEvent(new CustomEvent(`${tag}:change`, { detail: v }));
    };
    change(own[1], "typed");
    change(shared[0], "both");
    await flush();
    expect(read("items.1.value")).toBe("typed");
    expect(read("shared.value")).toBe("both");
    await flush();
    expect(shared.map((e) => e.value)).toEqual(["both", "both"]);
  });

  it("行の中の command.<メソッド>: は行を消すと購読をやめる", async () => {
    const tag = field();
    const { root, write } = await page(
      `<button data-wcs="onclick: $command.go">go</button><ul><template data-wcs="for: items"><li><${tag} data-wcs="command.ping: $command.go"></${tag}></li></template></ul>`,
      { $commandTokens: ["go"], items: ["a", "b"] },
    );
    const [first, second] = Array.from(root.querySelectorAll(tag)) as any[];
    (root.querySelector("button") as HTMLElement).click();
    expect([first.pings.length, second.pings.length]).toEqual([1, 1]);
    await write((s) => { s.items = ["b"]; });
    // the removed row's element unsubscribed when the row went (not at the next emit)
    let tokenSize = -1;
    (root.querySelector("wcs-state") as any).createState("readonly", (s: any) => { tokenSize = s.$command.go.size; });
    expect(tokenSize).toBe(1);
    (root.querySelector("button") as HTMLElement).click();
    const pings = [first, second].filter((c) => c.isConnected).map((c) => c.pings.length);
    expect(pings).toEqual([2]);
  });

  it("if の中の command.<メソッド>: は分岐が消えると購読をやめる", async () => {
    const tag = field();
    const { root, write, el } = await page(
      `<template data-wcs="if: on"><${tag} data-wcs="command.ping: $command.go"></${tag}></template>`,
      { $commandTokens: ["go"], on: true },
    );
    const size = () => {
      let n = -1;
      el.createState("readonly", (s: any) => { n = s.$command.go.size; });
      return n;
    };
    expect(size()).toBe(1);
    const c = root.querySelector(tag) as any;
    el.createState("readonly", (s: any) => { s.$command.go.emit("x"); });
    expect(c.pings).toEqual([["x"]]);
    await write((s) => { s.on = false; });
    expect(size()).toBe(0);
  });
});

describe("行と分岐の構築", () => {
  it("行のスロットに付けたフィルタを通して表示する", async () => {
    const { root, write } = await page(`<ul><template data-wcs="for: items"><li>{{ .n|mul(10) }}</li></template></ul>`, { items: [{ n: 1 }, { n: 2 }] });
    expect(texts(root, "li")).toEqual(["10", "20"]);
    await write((s) => { s["items.1.n"] = 5; });
    expect(texts(root, "li")).toEqual(["10", "50"]);
  });

  it("行のスロットの読みに失敗すると、そのバインディングの失敗として報告し、他は描く", async () => {
    const errors: unknown[] = [];
    const state: Record<string, any> = {
      items: [{ n: 1 }, { n: 2 }],
      $errorCallback(error: Error, info: any) { errors.push([info.bindingType, info.path, error.message, (info.node as Node).nodeType]); },
    };
    Object.defineProperty(state, "items.*.bad", { get(this: any) { if (this.$1 === 1) throw new Error("row 1"); return "ok"; }, enumerable: true });
    const { root } = await page(`<ul><template data-wcs="for: items"><li><b>{{ .bad }}</b><i>{{ .n }}</i></li></template></ul>`, state);
    expect(texts(root, "li b")).toEqual(["ok", ""]);
    expect(texts(root, "li i")).toEqual(["1", "2"]);
    expect(errors).toEqual([["text", "items.*.bad", "row 1", 3]]);
  });

  it("入れ子の for のリストが読めなければその for の失敗として報告し、他の行は描く", async () => {
    const errors: unknown[] = [];
    const state: Record<string, any> = {
      groups: [{ name: "a", list: ["a1"] }, { name: "b", list: ["b1"] }],
      $errorCallback(error: Error, info: any) { errors.push([info.bindingType, info.path, error.message]); },
    };
    Object.defineProperty(state, "groups.*.items", {
      get(this: any) { if (this.$1 === 1) throw new Error("no items"); return this["groups.*.list"]; }, enumerable: true,
    });
    const { root } = await page(
      `<div><template data-wcs="for: groups"><section><template data-wcs="for: .items"><i>{{ . }}</i></template></section></template></div>`,
      state,
    );
    expect(Array.from(root.querySelectorAll("section")).map((s) => s.textContent)).toEqual(["a1", ""]);
    expect(errors).toEqual([["for", "groups.*.items", "no items"]]);
  });

  it("分岐の中のバインディングの失敗は報告し、分岐の他の部分は描く", async () => {
    const errors: unknown[] = [];
    const { root } = await page(
      `<template data-wcs="if: on"><p data-wcs="class.on: word">x</p><span>{{ msg }}</span></template>`,
      { on: true, word: "yes", msg: "shown", $errorCallback(error: Error, info: any) { errors.push([info.bindingType, info.path, error.message]); } },
    );
    expect(root.querySelector("span")!.textContent).toBe("shown");
    expect(root.querySelector("p")!.classList.contains("on")).toBe(false);
    expect(errors).toEqual([["prop", "word", expect.stringMatching(core(M.ClassNeedsBoolean))]]);
  });

  it("if / elseif の条件にフィルタを付けられる", async () => {
    const { root, write } = await page(
      `<div><template data-wcs="if: n|gt(10)"><b>big</b></template><template data-wcs="elseif: n|gt(0)"><i>small</i></template><template data-wcs="else:"><u>none</u></template></div>`,
      { n: 5 },
    );
    const div = root.querySelector("div")!;
    expect(div.textContent).toBe("small");
    await write((s) => { s.n = 20; });
    expect(div.textContent).toBe("big");
    await write((s) => { s.n = 0; });
    expect(div.textContent).toBe("none");
  });

  it("何も描いていない入れ子の if を持つ行も消せる", async () => {
    const { root, write } = await page(
      `<ul><template data-wcs="for: items"><li>{{ .name }}<template data-wcs="if: .on"><b>!</b></template></li></template></ul>`,
      { items: [{ name: "a", on: false }, { name: "b", on: true }] },
    );
    expect(texts(root, "li")).toEqual(["a", "b!"]);
    await write((s) => { s.items = [s.items[1]]; });
    expect(texts(root, "li")).toEqual(["b!"]);
    await write((s) => { s["items.0.on"] = false; });
    expect(texts(root, "li")).toEqual(["b"]);
  });

  it("同じリストを描く 2 つ目・3 つ目の for を分岐ごと消しても、残りの for は一覧に追従する", async () => {
    const { root, write } = await page(
      `<ol><template data-wcs="for: items"><li>{{ . }}</li></template></ol>`
      + `<template data-wcs="if: showA"><ul class="a"><template data-wcs="for: items"><li>{{ . }}</li></template></ul></template>`
      + `<template data-wcs="if: showB"><ul class="b"><template data-wcs="for: items"><li>{{ . }}</li></template></ul></template>`,
      { showA: true, showB: true, items: ["x", "y"] },
    );
    expect(texts(root, "ul.a li")).toEqual(["x", "y"]);
    expect(texts(root, "ul.b li")).toEqual(["x", "y"]);
    await write((s) => { s.showA = false; });
    expect(root.querySelector("ul.a")).toBeNull();
    await write((s) => { s.items = ["x", "y", "z"]; });
    expect(texts(root, "ol li")).toEqual(["x", "y", "z"]);
    expect(texts(root, "ul.b li")).toEqual(["x", "y", "z"]);
    await write((s) => { s.showB = false; });
    expect(root.querySelector("ul.b")).toBeNull();
    await write((s) => { s.items = ["z"]; s.showA = true; });
    expect(texts(root, "ol li")).toEqual(["z"]);
    expect(texts(root, "ul.a li")).toEqual(["z"]);
  });
});

describe("要素が状態を初期化する行（wc-bindable の出力のみのメンバー）", () => {
  it("行の構築中に届いた変更のスロットが反映に失敗しても報告して、行は描く", async () => {
    const tag = status();
    const errors: unknown[] = [];
    const { root } = await page(
      `<ul><template data-wcs="for: rows"><li><${tag} data-wcs="status: .st"></${tag}><span data-wcs="class.on: .st">{{ .st }}</span></li></template></ul>`,
      { rows: [{ st: false }], $errorCallback(error: Error, info: any) { errors.push([info.bindingType, info.path, error.message]); } },
    );
    expect(texts(root, "li span")).toEqual(["ready"]);
    // every report is this one failure (the build applies the reached slot, and the drain
    // applies it again because it was queued: it is currently reported once per apply)
    expect(errors.length).toBeGreaterThan(0);
    for (const e of errors) expect(e).toEqual(["prop", "rows.*.st", expect.stringMatching(core(M.ClassNeedsBoolean))]);
  });

  it("$renderedCallback があるとき、書き込みで作った行の中で届いた変更も描いたパスとして報告する", async () => {
    const tag = status();
    const seen: [string[], Record<string, number[][]>][] = [];
    const { root, write } = await page(
      `<ul><template data-wcs="for: rows"><li><${tag} data-wcs="status: .st"></${tag}><span>{{ .st }}</span></li></template></ul>`,
      { rows: [], $renderedCallback(paths: string[], idx: Record<string, number[][]>) { seen.push([paths, idx]); } },
    );
    await write((s) => { s.rows = [{ st: "a" }, { st: "b" }]; });
    expect(texts(root, "li span")).toEqual(["ready", "ready"]);
    const all = seen.flatMap(([paths]) => paths);
    expect(all).toContain("rows.*.st");
    const idx = seen.flatMap(([, i]) => i["rows.*.st"] ?? []);
    expect(idx).toEqual(expect.arrayContaining([[0], [1]]));
  });
});

describe("$renderedCallback と、描画中に作るブロック", () => {
  it("書き込みで作った行のスロットと、開いた分岐のバインディングを報告する", async () => {
    const seen: [string[], Record<string, number[][]>][] = [];
    const { root, write } = await page(
      `<ul><template data-wcs="for: items"><li>{{ .v }}</li></template></ul><template data-wcs="if: open"><p data-wcs="textContent: msg"></p></template>`,
      { items: [], open: false, msg: "m", $renderedCallback(paths: string[], idx: Record<string, number[][]>) { seen.push([paths, idx]); } },
    );
    await write((s) => { s.items = [{ v: 1 }, { v: 2 }]; });
    expect(texts(root, "li")).toEqual(["1", "2"]);
    expect(seen).toEqual([[["items.*.v"], { "items.*.v": [[0], [1]] }]]);
    await write((s) => { s.open = true; });
    expect(root.querySelector("p")!.textContent).toBe("m");
    expect(seen[1][0]).toEqual(expect.arrayContaining(["open", "msg"]));
  });
});

describe("view-transition-name の自動命名（naming=\"auto\"）", () => {
  it("行の先頭の要素に名前を付ける（先頭がテキストなら次の要素、要素が無い行には付けない）", async () => {
    autoNaming(100);
    const { root } = await page(
      `<div class="text"><template data-wcs="for: items">{{ . }}</template></div>`
      + `<div class="texts"><template data-wcs="for: items">{{ . }}-{{ . }}</template></div>`
      + `<div class="mixed"><template data-wcs="for: items">{{ . }}<b>{{ . }}</b></template></div>`,
      { items: ["a", "b"] },
    );
    expect(root.querySelector(".text")!.textContent).toBe("ab");
    expect(root.querySelector(".texts")!.textContent).toBe("a-ab-b");
    const bs = Array.from(root.querySelectorAll(".mixed b"));
    expect(bs.map(vtName)).toEqual(["wcs-row-1", "wcs-row-2"]);
    expect((bs[0] as HTMLElement).style.getPropertyValue("view-transition-class")).toBe("wcs-row");
  });

  it("上限を超えた分は名前を付けず、警告は何度超えても 1 回だけ", async () => {
    autoNaming(1);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { root } = await page(`<ul><template data-wcs="for: items"><li>{{ . }}</li></template></ul>`, { items: ["a", "b", "c"] });
    expect(Array.from(root.querySelectorAll("li")).map(vtName)).toEqual(["wcs-row-1", "", ""]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`#${M.NamingLimit} 1$`)));
  });
});

describe("lisKeep（行の移動を最小にする最長増加部分列）", () => {
  it("増加部分列の要素に印を付け、-1（新しい行）は含めない", () => {
    expect(Array.from(lisKeep(new Int32Array([2, 0, 1])))).toEqual([0, 1, 1]);
    expect(Array.from(lisKeep(new Int32Array([0, -1, 1, 3, 2])))).toEqual([1, 0, 1, 0, 1]);
    expect(Array.from(lisKeep(new Int32Array([3, 2, 1])))).toEqual([0, 0, 1]);
  });

  it("残す行が 1 つも無ければ何にも印を付けない", () => {
    expect(Array.from(lisKeep(new Int32Array([-1, -1])))).toEqual([0, 0]);
    expect(Array.from(lisKeep(new Int32Array(0)))).toEqual([]);
  });
});
