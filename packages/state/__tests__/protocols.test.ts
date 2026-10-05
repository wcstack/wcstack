import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState, getBindingsReady, Engine, DirtyStrategy, mount } from "../src/index";
import { drainBinds } from "../src/dom/binder";
import { M } from "../src/messages";

// the core's own message (no diagnostics add-on here): [@wcstack/state] [wcs/<code>] #<number> <values>
const core = (id: M) => new RegExp(String.raw`^\[@wcstack/state\] (\[wcs/[\w-]+\] )?#${id}( |$)`);

const flush = () => new Promise((r) => setTimeout(r, 0));
const RUNNER_KEY = Symbol.for("wcstack.transition-runner");
const LEDGER_KEY = Symbol.for("wcstack.state.view-transition-naming");
const BINDER_KEY = Symbol.for("wcstack.binder");
const PENDING_KEY = Symbol.for("wcstack.binder.pending");
let seq = 0;

beforeAll(() => {
  bootstrapState();
});

afterEach(() => {
  delete (globalThis as any)[RUNNER_KEY];
  delete (globalThis as any)[LEDGER_KEY];
});

async function host(html: string, state?: Record<string, any>) {
  const h = document.createElement(`protocols-test-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = html;
  const el = root.querySelector("wcs-state") as any;
  if (state !== undefined) el.setInitialState(state);
  document.body.appendChild(h);
  if (state !== undefined) {
    await el.connectedCallbackPromise;
    await getBindingsReady(root);
  }
  return { h, root, el };
}

/** A fake view-transition arbiter on the protocol's global slot. */
function installRunner(opts: { naming?: "manual" | "auto"; limit?: number; defer?: boolean } = {}) {
  const calls: unknown[] = [];
  const deferred: (() => void)[] = [];
  (globalThis as any)[RUNNER_KEY] = {
    protocol: "wcs-transition-runner", version: 1,
    naming: opts.naming ?? "manual", namingLimit: opts.limit ?? 100,
    accepts: (source: string) => source === "state",
    run(mutate: () => void, options: unknown) {
      calls.push(options);
      if (opts.defer) deferred.push(mutate);
      else mutate();
      return Promise.resolve();
    },
  };
  return { calls, runDeferred: () => { for (const m of deferred.splice(0)) m(); } };
}

describe("transition-runner の受け口", () => {
  it("描画を変える書き込みは、アービターの run を 1 回通って反映される", async () => {
    const { root, el } = await host(`<wcs-state></wcs-state><p>{{ n }}</p>`, { n: 1 });
    const { calls } = installRunner();
    el.createState("writable", (s: any) => { s.n = 2; });
    await flush();
    expect(calls).toEqual([{ source: "state", types: undefined }]);
    expect(root.querySelector("p")!.textContent).toBe("2");
  });

  it("バインドの無いパスへの書き込みでは run を呼ばない（空の遷移を作らない）", async () => {
    const { el } = await host(`<wcs-state></wcs-state><p>{{ n }}</p>`, { n: 1, other: 0 });
    const { calls } = installRunner();
    el.createState("writable", (s: any) => { s.other = 5; });
    await flush();
    expect(calls).toEqual([]);
  });

  it("run が反映を後回しにしても、反映はちょうど 1 回で、その間の書き込みも最新の値で入る", async () => {
    const { root, el } = await host(`<wcs-state></wcs-state><p>{{ n }}</p>`, { n: 1 });
    const { calls, runDeferred } = installRunner({ defer: true });
    el.createState("writable", (s: any) => { s.n = 2; });
    await flush();
    expect(root.querySelector("p")!.textContent).toBe("1");
    el.createState("writable", (s: any) => { s.n = 3; });
    await flush();
    expect(calls.length).toBe(1);
    runDeferred();
    expect(root.querySelector("p")!.textContent).toBe("3");
    await flush();
    expect(calls.length).toBe(1);
  });

  it("初回の描画はアービターを通らない", async () => {
    const { calls } = installRunner();
    const { root } = await host(`<wcs-state></wcs-state><ul><template data-wcs="for: items"><li>{{ . }}</li></template></ul>`, { items: ["a", "b"] });
    await flush();
    expect(calls).toEqual([]);
    expect(root.querySelectorAll("li").length).toBe(2);
  });

  it("naming=\"auto\" のとき、行と if の中身の先頭要素に名前を付け、上限で止めて一度だけ警告する", async () => {
    installRunner({ naming: "auto", limit: 3 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { root } = await host(
      `<wcs-state></wcs-state><template data-wcs="if: on"><b>on</b></template><ul><template data-wcs="for: items"><li>{{ . }}</li></template></ul>`,
      { on: true, items: ["a", "b", "c"] },
    );
    const names = [root.querySelector("b")!, ...root.querySelectorAll("li")].map((e) => (e as HTMLElement).style.getPropertyValue("view-transition-name"));
    expect(names).toEqual(["wcs-branch-1", "wcs-row-2", "wcs-row-3", ""]);
    expect((root.querySelector("li") as HTMLElement).style.getPropertyValue("view-transition-class")).toBe("wcs-row");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("naming が manual（既定）なら名前を付けない", async () => {
    installRunner();
    const { root } = await host(`<wcs-state></wcs-state><ul><template data-wcs="for: items"><li>{{ . }}</li></template></ul>`, { items: ["a"] });
    expect((root.querySelector("li") as HTMLElement).style.getPropertyValue("view-transition-name")).toBe("");
  });
});

describe("binder の受け口", () => {
  const binder = () => (globalThis as any)[BINDER_KEY];

  it("state を読み込むと、binder がプロトコルの場所に載る", () => {
    expect(binder()).toMatchObject({ protocol: "wcs-binder", version: 1 });
  });

  it("後から文書に入ったサブツリーを、渡された時点で同期に結線する", async () => {
    const { root, el } = await host(`<wcs-state></wcs-state><main></main>`, { msg: "hi" });
    const section = document.createElement("section");
    section.innerHTML = `<p data-wcs="textContent: msg"></p><span>{{ msg }}</span>`;
    root.querySelector("main")!.appendChild(section);
    binder().bind(section);
    expect(section.querySelector("p")!.textContent).toBe("hi");
    expect(section.querySelector("span")!.textContent).toBe("hi");
    el.createState("writable", (s: any) => { s.msg = "bye"; });
    await flush();
    expect(section.querySelector("p")!.textContent).toBe("bye");
  });

  it("同じサブツリーを何度渡しても二重に結線しない（描画済みの一覧の行も含めて）", async () => {
    const state = { n: 0, items: ["a", "b"], hit(this: any) { this.n++; }, row(this: any) { this.n += 10; } };
    const { root } = await host(
      `<wcs-state></wcs-state><section><button data-wcs="onclick: hit">+</button><ul><template data-wcs="for: items"><li data-wcs="onclick: row">{{ . }}</li></template></ul><p>{{ n }}</p></section>`,
      state,
    );
    const section = root.querySelector("section")!;
    binder().bind(section);
    binder().bind(section);
    (root.querySelector("button") as HTMLElement).click();
    (root.querySelector("li") as HTMLElement).click();
    await flush();
    expect(root.querySelector("p")!.textContent).toBe("11");
    expect(root.querySelectorAll("li").length).toBe(2);
  });

  // <head> is outside the mount's walk (it walks <body>): what <wcs-head> puts there is bound
  // only when handed over — here before the document's engine exists
  it("初期構築の前に渡されたもの（binder へ直接・プロトコルの保留キュー）は、構築の直後に結線する", () => {
    const direct = document.createElement("title");
    direct.setAttribute("data-wcs", "textContent: msg");
    const queued = document.createElement("meta");
    queued.setAttribute("data-wcs", "attr.content: msg");
    document.head.append(direct, queued);
    binder().bind(direct);
    ((globalThis as any)[PENDING_KEY] ??= []).push(queued);
    expect(direct.textContent).toBe("");
    const engine = new Engine({ msg: "late" }, new DirtyStrategy());
    mount(engine, document);
    expect(direct.textContent).toBe("");
    drainBinds();
    expect(direct.textContent).toBe("late");
    expect(queued.getAttribute("content")).toBe("late");
    expect((globalThis as any)[PENDING_KEY]).toEqual([]);
    direct.remove();
    queued.remove();
  });
});

describe("初期化済みの要素への setInitialState（再セット）", () => {
  it("戻る前に、すべてのバインディングを新しい状態で反映し直す", async () => {
    const { root, el } = await host(`<wcs-state></wcs-state><p>{{ msg }}</p><ul><template data-wcs="for: items"><li>{{ . }}</li></template></ul>`, { msg: "a", items: ["x"] });
    el.setInitialState({ msg: "b", items: ["y", "z"] });
    expect(root.querySelector("p")!.textContent).toBe("b");
    expect(Array.from(root.querySelectorAll("li")).map((li) => li.textContent)).toEqual(["y", "z"]);
  });

  it("新しい状態に無いトップレベルのキーは、その下のパスと同じく空になる（失敗にせず、古い値も残さない）", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { root, el } = await host(
        `<wcs-state></wcs-state><p class="t">{{ msg }}</p><p class="p" data-wcs="textContent: msg"></p><p class="d">{{ user.name }}</p><p class="g">{{ shout }}</p><input data-wcs="value: msg"><ul><template data-wcs="for: items"><li>{{ . }}</li></template></ul>`,
        { msg: "a", user: { name: "ann" }, items: ["x"], get shout() { return `${(this as any).msg}!`; } },
      );
      const q = (sel: string) => root.querySelector(sel)!.textContent;
      // (the getter comes with the new state; msg and items do not)
      const next = { user: {}, get shout() { return `${(this as any).msg}!`; } };
      el.setInitialState(next);
      expect([q(".t"), q(".p"), q(".d"), q(".g")]).toEqual(["", "", "", "undefined!"]);
      expect(root.querySelectorAll("li").length).toBe(0);
      // an element input keeps its own value when state has none (B8)
      expect((root.querySelector("input") as HTMLInputElement).value).toBe("a");
      expect(error).not.toHaveBeenCalled();
      // the author's object is not written to
      expect(Object.keys(next)).toEqual(["user", "shout"]);
      // written again, the bindings follow
      el.createState("writable", (s: any) => { s.msg = "b"; s.items = ["y"]; });
      await flush();
      expect([q(".t"), q(".p")]).toEqual(["b", "b"]);
      expect(Array.from(root.querySelectorAll("li"), (li) => li.textContent)).toEqual(["y"]);
      // a key no state had still fails on read
      expect(() => el.createState("readonly", (s: any) => s.never)).toThrow("[wcs/binding-path-missing]");
    } finally {
      error.mockRestore();
    }
  });

  it.each([
    ["凍結した状態", () => Object.freeze({ user: Object.freeze({}) })],
    ["拡張を禁じた状態", () => Object.preventExtensions({ user: {} })],
    ["書き込みを拒む Proxy の状態", () => new Proxy({ user: {} } as Record<string, any>, { set: () => false, defineProperty: () => false })],
  ])("%s への再セットも、無いトップレベルのキーを空にし、状態のオブジェクトを変えない", async (_name, make) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { root, el } = await host(
        `<wcs-state></wcs-state><p class="t">{{ msg }}</p><ul><template data-wcs="for: items"><li>{{ . }}</li></template></ul>`,
        { msg: "a", user: {}, items: ["x"] },
      );
      const next = make();
      expect(() => el.setInitialState(next)).not.toThrow();
      expect(root.querySelector(".t")!.textContent).toBe("");
      expect(root.querySelectorAll("li").length).toBe(0);
      expect(Object.keys(next)).toEqual(["user"]);
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it("続けて 2 回再セットしても、前の再セットで無くなったキーは空のまま（3 回目に戻れば描く）", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { root, el } = await host(`<wcs-state></wcs-state><p class="t">{{ msg }}</p><p class="n">{{ n }}</p>`, { msg: "a", n: 1 });
      const q = (sel: string) => root.querySelector(sel)!.textContent;
      el.setInitialState({ n: 2 });
      expect([q(".t"), q(".n")]).toEqual(["", "2"]);
      // the second state lacks msg too (the first one never had it)
      const second = { n: 3 };
      el.setInitialState(second);
      expect([q(".t"), q(".n")]).toEqual(["", "3"]);
      expect(Object.keys(second)).toEqual(["n"]);
      el.setInitialState({ msg: "c", n: 4 });
      expect([q(".t"), q(".n")]).toEqual(["c", "4"]);
      expect(error).not.toHaveBeenCalled();
      // a key that is back is the state's again: dropped by the next re-set, it is empty again
      el.setInitialState({ n: 5 });
      expect([q(".t"), q(".n")]).toEqual(["", "5"]);
    } finally {
      error.mockRestore();
    }
  });

  it("クラスの状態の getter を持たない状態への再セットも、その getter を他の無くなったキーと同じく空にする", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      class Person {
        first = "ann";
        get full() { return `${this.first}!`; }
        get tags() { return [this.first]; }
      }
      const { root, el } = await host(
        `<wcs-state></wcs-state><p class="f">{{ full }}</p><p class="g">{{ greet }}</p><ul><template data-wcs="for: tags"><li>{{ . }}</li></template></ul>`,
        Object.assign(new Person(), { greet: "" }),
      );
      const q = (sel: string) => root.querySelector(sel)!.textContent;
      expect([q(".f"), root.querySelectorAll("li").length]).toEqual(["ann!", 1]);
      // the new state is a plain object: neither `full`, `tags` nor its class
      el.setInitialState({ first: "bob", get greet() { return `hi ${(this as any).full}`; } });
      expect([q(".f"), q(".g")]).toEqual(["", "hi undefined"]);
      expect(root.querySelectorAll("li").length).toBe(0);
      let read: unknown = "-";
      el.createState("readonly", (s: any) => { read = s.full; });
      expect(read).toBeUndefined();
      expect(error).not.toHaveBeenCalled();
      // written, it is the state's key
      el.createState("writable", (s: any) => { s.full = "cy"; });
      await flush();
      expect([q(".f"), q(".g")]).toEqual(["cy", "hi cy"]);
    } finally {
      error.mockRestore();
    }
  });

  it("再セットの後の列挙（Object.keys・in・for…in・スプレッド・JSON.stringify・delete）は、いまの状態のキーを使う", async () => {
    const { el } = await host(`<wcs-state></wcs-state><p>{{ a }}</p>`, { a: 1, b: 2 });
    const next: Record<string, any> = { a: 3, c: 4 };
    el.setInitialState(next);
    el.createState("writable", (s: any) => {
      const forIn: string[] = [];
      for (const k in s) forIn.push(k);
      expect(Object.keys(s)).toEqual(["a", "c"]);
      expect(forIn).toEqual(["a", "c"]);
      expect(["a" in s, "b" in s, "c" in s]).toEqual([true, false, true]);
      expect({ ...s }).toEqual({ a: 3, c: 4 });
      expect(JSON.parse(JSON.stringify(s))).toEqual({ a: 3, c: 4 });
      expect(Object.prototype.hasOwnProperty.call(s, "c")).toBe(true);
      expect(delete s.c).toBe(true);
      Object.defineProperty(s, "d", { value: 5, enumerable: true, writable: true, configurable: true });
    });
    // delete and defineProperty change the current state
    expect(next).toEqual({ a: 3, d: 5 });
  });

  it.each([
    ["凍結した最初の状態", () => Object.freeze({ a: 1, b: 2 }), () => ({ a: 3, c: 4 })],
    ["凍結した新しい状態", () => ({ a: 1, b: 2 }), () => Object.freeze({ a: 3, c: 4 })],
  ])("%s でも、再セットの後の列挙はいまの状態のキーを使う", async (_name, first, second) => {
    const { el } = await host(`<wcs-state></wcs-state><p>{{ a }}</p>`, first());
    el.setInitialState(second());
    el.createState("readonly", (s: any) => {
      expect(Object.keys(s)).toEqual(["a", "c"]);
      expect({ ...s }).toEqual({ a: 3, c: 4 });
      expect("b" in s).toBe(false);
    });
  });

  it("クラスの状態の instanceof は、いまの状態のクラスを答える", async () => {
    class A { n = 1; }
    class B { n = 2; }
    const { el } = await host(`<wcs-state></wcs-state><p>{{ n }}</p>`, new A());
    el.createState("readonly", (s: any) => { expect(s instanceof A).toBe(true); });
    el.setInitialState(new B());
    el.createState("readonly", (s: any) => { expect([s instanceof A, s instanceof B]).toEqual([false, true]); });
  });

  it("書き込みではない: $renderedCallback を呼ばない（その後の書き込みでは呼ぶ）", async () => {
    const { el } = await host(`<wcs-state></wcs-state><p>{{ n }}</p>`, { n: 1 });
    const rendered = vi.fn();
    el.setInitialState({ n: 2, $renderedCallback: rendered });
    await flush();
    expect(rendered).not.toHaveBeenCalled();
    el.createState("writable", (s: any) => { s.n = 3; });
    await flush();
    expect(rendered).toHaveBeenCalledTimes(1);
  });

  it("同じ名前の command token は同じトークンのまま（要素の購読が切れない）", async () => {
    const { el } = await host(`<wcs-state></wcs-state>`, { $commandTokens: ["go"] });
    let before: unknown;
    el.createState("readonly", (s: any) => { before = s.$command.go; });
    el.setInitialState({ $commandTokens: ["go", "stop"] });
    el.createState("readonly", (s: any) => {
      expect(s.$command.go).toBe(before);
      expect(Object.keys(s.$command)).toEqual(["go", "stop"]);
    });
  });

  it("初期化に失敗した要素には投げる（作り直す必要がある）", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { el } = await host(`<wcs-state state="no-such-script"></wcs-state>`);
    await el.connectedCallbackPromise.catch(() => {});
    expect(() => el.setInitialState({ n: 1 })).toThrow(core(M.ElementFailed));
    error.mockRestore();
  });
});
