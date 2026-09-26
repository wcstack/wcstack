/**
 * coverage-element-load.test.ts — `<wcs-state>` (src/element.ts): where the state comes from
 * (`state` / `src` / `json` / inner `<script type="module">` / `setInitialState()`), the element
 * API before initialization, `configure()` and `bootstrapState(config)`.
 * The core alone (no diagnostics add-on): errors read as numbered messages. Network loads are
 * stubbed (`fetch`) or served from `data:` URLs.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState, configure, DirtyStrategy, getBindingsReady } from "../src/index";
import { setConfig } from "../src/config";
import { define, registries } from "../src/element";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  bootstrapState();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A host whose shadow root holds `html`; `setup` runs on the `<wcs-state>` before it connects. */
function mountHost(html: string, setup?: (el: any) => void) {
  const h = document.createElement(`cov-load-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = html;
  const el = root.querySelector("wcs-state") as any;
  setup?.(el);
  document.body.appendChild(h);
  return { h, root, el };
}

async function load(html: string, setup?: (el: any) => void) {
  const out = mountHost(html, setup);
  await out.el.connectedCallbackPromise;
  await getBindingsReady(out.root);
  return out;
}

/** The message the element's initialization fails with. */
async function failure(html: string, setup?: (el: any) => void): Promise<string> {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await load(html, setup);
    return "(no error)";
  } catch (e) {
    return (e as Error).message;
  } finally {
    error.mockRestore();
  }
}

const text = (root: ShadowRoot, sel = "p") => root.querySelector(sel)!.textContent;

/** Runs `fn` where `URL.createObjectURL` does not exist (a server render removes it). */
async function withoutObjectURL(fn: () => Promise<void>): Promise<void> {
  const own = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  Object.defineProperty(URL, "createObjectURL", { value: undefined, configurable: true, writable: true });
  try {
    await fn();
  } finally {
    if (own !== undefined) Object.defineProperty(URL, "createObjectURL", own);
    else delete (URL as any).createObjectURL;
  }
  expect(typeof URL.createObjectURL).toBe("function");
}

describe("state 属性（JSON の <script> の id）", () => {
  it("同じ根（シャドウルート）の <script> を読む", async () => {
    const { root } = await load(`<script type="application/json" id="cov-own">{"msg":"shadow"}</script><wcs-state state="cov-own"></wcs-state><p>{{ msg }}</p>`);
    expect(text(root)).toBe("shadow");
  });

  it("根に無い id は document から探す", async () => {
    document.body.insertAdjacentHTML("beforeend", `<script type="application/json" id="cov-doc">{"msg":"document"}</script>`);
    try {
      const { root } = await load(`<wcs-state state="cov-doc"></wcs-state><p>{{ msg }}</p>`);
      expect(text(root)).toBe("document");
    } finally {
      document.getElementById("cov-doc")!.remove();
    }
  });

  it("読み込む前に要素が外されても document から探し、要素のあった根に束ねる（外したときには何も呼ばない）", async () => {
    document.body.insertAdjacentHTML("beforeend", `<script type="application/json" id="cov-detached">{"msg":"detached"}</script>`);
    try {
      const { root, el } = mountHost(`<wcs-state state="cov-detached"></wcs-state><p>{{ msg }}</p>`);
      // the load reads its source a microtask later: by then the element has no root to search
      el.remove();
      await el.connectedCallbackPromise;
      await getBindingsReady(root);
      expect(text(root)).toBe("detached");
    } finally {
      document.getElementById("cov-detached")!.remove();
    }
  });

  it("どこにも無い id は、その id を示して初期化に失敗する", async () => {
    expect(await failure(`<wcs-state state="cov-none"></wcs-state>`)).toBe('[@wcstack/state] #16 "cov-none"');
  });
});

describe("src 属性", () => {
  it(".json（クエリ付きも）は document の base URL に対して fetch し、その JSON を状態にする", async () => {
    const fetch = vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => ({ msg: `from ${url}` }) }));
    vi.stubGlobal("fetch", fetch);
    const { root } = await load(`<wcs-state src="data/state.json?v=2"></wcs-state><p>{{ msg }}</p>`);
    const url = new URL("data/state.json?v=2", document.baseURI).href;
    expect(fetch).toHaveBeenCalledWith(url);
    expect(text(root)).toBe(`from ${url}`);
  });

  it("失敗した応答は src と status を示して初期化に失敗する", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    expect(await failure(`<wcs-state src="missing.json"></wcs-state>`)).toBe('[@wcstack/state] #13 "missing.json" 404');
  });

  it(".json でない src はモジュールとして import し、その default export を状態にする", async () => {
    const src = "data:text/javascript;charset=utf-8," + encodeURIComponent("export default { msg: 'module src' };");
    const { root } = await load(`<wcs-state></wcs-state><p>{{ msg }}</p>`, (el) => el.setAttribute("src", src));
    expect(text(root)).toBe("module src");
  });

  it("default export の無いモジュールは空の状態になる", async () => {
    const src = "data:text/javascript;charset=utf-8," + encodeURIComponent("export const unused = 'src without default';");
    const { el } = await load(`<wcs-state></wcs-state>`, (e) => e.setAttribute("src", src));
    expect(el.engine.target).toEqual({});
  });
});

describe("内側の <script type=\"module\">", () => {
  it("createObjectURL のある環境では Blob の URL から読み、読み終えたら URL を破棄する", async () => {
    const code = "export default { msg: 'inline via blob' };";
    const blobs: Blob[] = [];
    const url = "data:text/javascript;charset=utf-8," + encodeURIComponent(code);
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob: Blob | MediaSource) => {
      blobs.push(blob as Blob);
      return url;
    });
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const { root } = await load(`<wcs-state><script type="module">${code}</script></wcs-state><p>{{ msg }}</p>`);
    expect(text(root)).toBe("inline via blob");
    expect(blobs).toHaveLength(1);
    expect(blobs[0].type).toBe("application/javascript");
    expect(await blobs[0].text()).toBe(code);
    expect(revoke).toHaveBeenCalledWith(url);
  });

  it("createObjectURL の無い環境（サーバ）では data: URL から読み、同じ本文の 2 つの要素も別々の状態を持つ", async () => {
    await withoutObjectURL(async () => {
      const html = `<wcs-state><script type="module">export default { items: ["server"] };</script></wcs-state><p>{{ items.length }}</p>`;
      const a = await load(html);
      const b = await load(html);
      expect(text(a.root)).toBe("1");
      expect(a.el.engine.target).not.toBe(b.el.engine.target);
      a.el.createState("writable", (s: any) => { s.items = ["x", "y"]; });
      await flush();
      expect(text(a.root)).toBe("2");
      expect(text(b.root)).toBe("1");
    });
  });

  it("default export の無いスクリプトは空の状態になる", async () => {
    await withoutObjectURL(async () => {
      const { el } = await load(`<wcs-state><script type="module">export const unused = "inline without default";</script></wcs-state>`);
      expect(el.engine.target).toEqual({});
    });
  });
});

describe("setInitialState と初期化前の要素", () => {
  it("接続して状態を待ち始めた後の setInitialState で初期化する", async () => {
    const { root, el } = mountHost(`<wcs-state></wcs-state><p>{{ n }}</p>`);
    await flush();
    // the element is waiting now: nothing is bound yet
    expect(el.engine).toBeNull();
    expect(text(root)).toBe("{{ n }}");
    el.setInitialState({ n: 9 });
    await el.connectedCallbackPromise;
    expect(text(root)).toBe("9");
  });

  it("状態を待つ間に外しても何も呼ばず、初期化後に外すと $disconnectedCallback を呼ぶ", async () => {
    const calls: string[] = [];
    const { h, root, el } = mountHost(`<wcs-state></wcs-state><p>{{ n }}</p>`);
    await flush();
    h.remove();
    el.setInitialState({ n: 1, $disconnectedCallback() { calls.push("disconnected"); } });
    await el.connectedCallbackPromise;
    expect(calls).toEqual([]);
    expect(text(root)).toBe("1");
    document.body.appendChild(h);
    h.remove();
    expect(calls).toEqual(["disconnected"]);
  });

  it("状態を待つ間の再接続は読み込みをやり直さず、状態が来たら 1 回だけ初期化する", async () => {
    const calls: string[] = [];
    const { h, root, el } = mountHost(`<wcs-state></wcs-state><p>{{ n }}</p>`);
    await flush();
    h.remove();
    document.body.appendChild(h);
    await flush();
    expect(el.engine).toBeNull();
    el.setInitialState({ n: 2, $connectedCallback() { calls.push("connected"); } });
    await el.connectedCallbackPromise;
    const engine = el.engine;
    await flush();
    expect(el.engine).toBe(engine);
    expect(calls).toEqual(["connected"]);
    expect(text(root)).toBe("2");
  });

  it("初期化前の createState / createStateAsync は wcs-state の未初期化で投げる", async () => {
    const el = document.createElement("wcs-state") as any;
    expect(() => el.createState("readonly", () => {})).toThrow(/^\[@wcstack\/state\] #15$/);
    const callback = vi.fn(async () => {});
    await expect(el.createStateAsync("writable", callback)).rejects.toThrow(/^\[@wcstack\/state\] #15$/);
    expect(callback).not.toHaveBeenCalled();
  });

  it("<wcs-state> の載っていない根の getBindingsReady はすぐ解決する", async () => {
    await expect(getBindingsReady(document.createElement("div"))).resolves.toBeUndefined();
  });
});

describe("configure と bootstrapState(config)", () => {
  it("configure の工場は、その後に作られるエンジンごとに 1 回呼ばれ、そのエンジンの戦略になる", async () => {
    const made: DirtyStrategy[] = [];
    configure(() => {
      const s = new DirtyStrategy();
      made.push(s);
      return s;
    });
    try {
      const a = await load(`<wcs-state json='{"n":1}'></wcs-state><p>{{ n }}</p>`);
      const b = await load(`<wcs-state json='{"n":2}'></wcs-state><p>{{ n }}</p>`);
      expect(made).toHaveLength(2);
      expect(a.el.engine.strategy).toBe(made[0]);
      expect(b.el.engine.strategy).toBe(made[1]);
      expect([text(a.root), text(b.root)]).toEqual(["1", "2"]);
    } finally {
      configure(() => new DirtyStrategy());
    }
  });

  it("define は登録簿に <wcs-state> を定義し、回収された登録簿は registries() から落ちる", () => {
    const defined = new Map<string, CustomElementConstructor>();
    const registry = {
      get: (n: string) => defined.get(n),
      define: (n: string, c: CustomElementConstructor) => { defined.set(n, c); },
    } as unknown as CustomElementRegistry;
    // stands in for a garbage collection: the reference define keeps to the registry is already dead
    vi.stubGlobal("WeakRef", class { deref(): undefined { return undefined; } });
    try {
      define(registry);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(defined.get("wcs-state")).toBeDefined();
    const live = registries();
    expect(live).not.toContain(registry);
    expect(live).toContain(customElements);
    // defining in it again registers it with a live reference
    define(registry);
    expect(registries()).toContain(registry);
  });

  it("bootstrapState の設定は、その後の束ねに効く（bindAttributeName）", async () => {
    bootstrapState({ bindAttributeName: "data-cov" });
    try {
      const { root } = await load(`<wcs-state json='{"msg":"hi"}'></wcs-state><p data-cov="textContent: msg"></p><i data-wcs="textContent: msg"></i>`);
      expect(text(root)).toBe("hi");
      expect(text(root, "i")).toBe("");
    } finally {
      setConfig({ bindAttributeName: "data-wcs" });
    }
  });
});
