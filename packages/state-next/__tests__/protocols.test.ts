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
