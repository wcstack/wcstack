/**
 * Declarative Custom Components (`[data-wc-definition]`, src/scopes/dcc.ts): validation, `$stream`
 * members, the definition host itself, queued writes and the definition's own `<wcs-state>`.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, config, getBindingsReady, installFeatures, scopes, setConfig, temporal } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([temporal, scopes]);
  bootstrapState();
});

/**
 * A definition host built with the DOM API (happy-dom has no declarative shadow DOM): the state
 * is handed to each <wcs-state> by setInitialState.
 */
async function defineComponent(markup: string, state: () => Record<string, any>, tag = `cov-dcc-${seq++}`) {
  const def = document.createElement(tag) as any;
  def.setAttribute("data-wc-definition", "");
  const shadow = def.attachShadow({ mode: "open" });
  shadow.innerHTML = `${markup}<wcs-state></wcs-state>`;
  const defState = shadow.querySelector("wcs-state") as any;
  defState.setInitialState(state());
  document.body.appendChild(def);
  await defState.connectedCallbackPromise;
  const create = async (parent: Node = document.body) => {
    const el = document.createElement(tag) as any;
    parent.appendChild(el);
    const inner = el.stateElement;
    inner.setInitialState(state());
    await inner.connectedCallbackPromise;
    await getBindingsReady(el.shadowRoot);
    await flush();
    return el;
  };
  return { tag, def, defState, create };
}

const counter = () => ({
  count: 0,
  other: "x",
  increment(this: any) { this.count++; return this.count; },
  $bindables: ["count"],
});

describe("DCC の定義の検査", () => {
  it.each([
    [{ a: 1, $bindables: [""] }, "$bindables entries must be non-empty strings"],
    [{ a: 1, $bindables: [1] }, "$bindables entries must be non-empty strings"],
    [{ f() {}, $commands: ["nope"] }, '$commands entry "nope" does not exist on the state'],
  ])("違反は報告され、タグは定義されない（%#）", async (state, message) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { tag } = await defineComponent(``, () => state);
      expect(customElements.get(tag)).toBeUndefined();
      expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining(message) }));
    } finally {
      error.mockRestore();
    }
  });

  it("bind-component の <wcs-state> は定義にならない（仕組みは 1 つ）", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const tag = `cov-dcc-${seq++}`;
      const def = document.createElement(tag);
      def.setAttribute("data-wc-definition", "");
      const shadow = def.attachShadow({ mode: "open" });
      shadow.innerHTML = `<wcs-state bind-component="state"></wcs-state>`;
      (shadow.querySelector("wcs-state") as any).setInitialState({ a: 1 });
      document.body.appendChild(def);
      await (shadow.querySelector("wcs-state") as any).connectedCallbackPromise;
      expect(customElements.get(tag)).toBeUndefined();
      expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("cannot define a component") }));
    } finally {
      error.mockRestore();
    }
  });
});

describe("DCC のメンバー", () => {
  it("$stream の名前もメンバーになり（データと同名のものも 1 つ）、$bindables に挙げられ、流れた値で変更イベントを出す", async () => {
    const state = () => ({
      result: "cached",
      $stream: {
        result: { source: async function* () { yield "r"; } },
        live: { source: async function* () { yield "first"; yield "second"; }, initial: "-" },
      },
      $bindables: ["live"],
    });
    const { tag } = await defineComponent(`<p>{{ live }}</p>`, state);
    const cls = customElements.get(tag) as any;
    // no $commands: the declaration has no commands key
    expect(cls.wcBindable).toEqual({
      protocol: "wc-bindable", version: 1,
      properties: [{ name: "live", event: `${tag}:live-changed`, getter: expect.any(Function) }],
      inputs: [{ name: "live" }],
    });
    expect(Object.getOwnPropertyNames(cls.prototype).filter((n) => n !== "constructor" && n !== "connectedCallback" && n !== "stateElement").sort())
      .toEqual(["live", "result"]);
    const seen: unknown[] = [];
    const el = document.createElement(tag) as any;
    el.addEventListener(`${tag}:live-changed`, (e: CustomEvent) => seen.push(e.detail));
    document.body.appendChild(el);
    el.stateElement.setInitialState(state());
    await el.stateElement.connectedCallbackPromise;
    for (let i = 0; i < 4; i++) await flush();
    expect(el.live).toBe("second");
    expect(el.shadowRoot.querySelector("p").textContent).toBe("second");
    // the start writes the initial value it already holds (no change): only the chunks notify
    expect(seen).toEqual(["first", "second"]);
  });

  it("定義のホスト自身のメソッドは undefined で解決し、プロパティは読めない（状態を持たない）", async () => {
    const { def, create } = await defineComponent(`<p>{{ count }}</p>`, counter);
    await expect(def.increment()).resolves.toBeUndefined();
    expect(def.count).toBeUndefined();
    expect(def.stateElement).toBeNull();
    // the instances are unaffected
    const el = await create();
    await expect(el.increment()).resolves.toBe(1);
  });

  it("初期化の前の書き込みは順に積まれ、初期化の後に順に入る", async () => {
    const { tag } = await defineComponent(`<p>{{ count }}|{{ other }}</p>`, counter);
    const el = document.createElement(tag) as any;
    document.body.appendChild(el);
    el.count = 1;
    el.other = "y";
    el.count = 2;
    const inner = el.stateElement;
    inner.setInitialState(counter());
    await inner.connectedCallbackPromise;
    await flush();
    expect(el.count).toBe(2);
    expect(el.shadowRoot.querySelector("p").textContent).toBe("2|y");
  });

  it("$bindables に無いメンバーへの書き込みは変更イベントを出さない", async () => {
    const { tag, create } = await defineComponent(`<p>{{ count }}</p>`, counter);
    const el = await create();
    const seen: string[] = [];
    el.addEventListener(`${tag}:other-changed`, () => seen.push("other"));
    el.addEventListener(`${tag}:count-changed`, (e: CustomEvent) => seen.push(`count=${e.detail}`));
    el.other = "z";
    el.count = 3;
    expect(el.other).toBe("z");
    expect(seen).toEqual(["count=3"]);
  });

  it("中身に <wcs-state> が無いインスタンスは（$bindables があれば警告して）状態を持たない", async () => {
    const { tag } = await defineComponent(`<p>{{ count }}</p>`, counter);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const saved = config.tagNames.state;
    // the definition's content was captured with its <wcs-state>; renaming the tag afterwards
    // leaves an instance's copy of the content without a state element of the current name
    setConfig({ tagNames: { state: `cov-no-state-${seq++}` } });
    try {
      const el = document.createElement(tag) as any;
      document.body.appendChild(el);
      expect(el.stateElement).toBeNull();
      expect(el.count).toBeUndefined();
      await expect(el.increment()).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`DCC: <${tag}> declares $bindables but its content has no <cov-no-state-`));
    } finally {
      setConfig({ tagNames: { state: saved } });
      warn.mockRestore();
    }
  });
});

describe("DCC の定義の <wcs-state>", () => {
  it("定義のホストを外して戻しても何も起きず（定義は 1 度きり）、再セットは投げる", async () => {
    const { tag, def, defState, create } = await defineComponent(`<p>{{ count }}</p>`, counter);
    const cls = customElements.get(tag);
    def.remove();
    document.body.appendChild(def);
    expect(customElements.get(tag)).toBe(cls);
    const el = await create();
    el.count = 4;
    await flush();
    expect(el.shadowRoot.querySelector("p").textContent).toBe("4");
    expect(() => defState.setInitialState({ count: 1 })).toThrow("re-setting a DCC definition is not supported");
  });

  it("文書に直に置いた根の <wcs-state> は DCC のインスタンスではなく、その書き込みは変更イベントを出さない", async () => {
    const { tag } = await defineComponent(`<p>{{ count }}</p>`, counter);
    const seen: string[] = [];
    document.addEventListener(`${tag}:count-changed`, (e) => seen.push(e.type));
    // a root in the document itself (its root node has no host)
    document.body.innerHTML = `<wcs-state></wcs-state><p id="doc-count">{{ count }}</p>`;
    const rootEl = document.body.querySelector("wcs-state") as any;
    rootEl.setInitialState({ count: 0, $bindables: ["count"] });
    await rootEl.connectedCallbackPromise;
    await getBindingsReady(document);
    rootEl.createState("writable", (s: any) => { s.count = 5; });
    await flush();
    expect(document.getElementById("doc-count")!.textContent).toBe("5");
    expect(seen).toEqual([]);
  });
});
