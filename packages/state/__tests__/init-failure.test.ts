/**
 * A `<wcs-state>` that fails to initialize (v4-remaining §3.2 "初期化の失敗"): the report names the
 * element before the error (3.5's `<wcs-state src="…"> failed to initialize.`), and a DCC definition
 * or a component mount rejects its connectedCallbackPromise with the error, as 3.x — a volume
 * resolves it. getBindingsReady on the shadow root a component or a definition binds follows it.
 */
import { describe, it, expect, beforeAll, afterEach, vi, type MockInstance } from "vitest";
import { bootstrapState, diagnostics, getBindingsReady, installFeatures, scopes, ssr } from "../src/index";
import { VERSION } from "../src/version";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([scopes, ssr, diagnostics]);
  bootstrapState();
});

let error: MockInstance;
const spy = () => (error = vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => error?.mockRestore());

/** The reason a promise rejects with (fails when it resolves). */
async function rejection(p: Promise<unknown>): Promise<unknown> {
  return p.then(() => { throw new Error("resolved, expected a rejection"); }, (e) => e);
}

/** A page (a shadow root) holding `html`, connected. */
function page(html: string, state?: Record<string, any>) {
  const host = document.createElement(`init-fail-page-${seq++}`);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = html;
  const el = root.querySelector("wcs-state") as any;
  if (state !== undefined) el.setInitialState(state);
  document.body.appendChild(host);
  return { host, root, el };
}

/** A module URL whose evaluation throws `globalThis[key]` (unique, so no load is cached). */
const throwing = (key: string) => `data:text/javascript,${encodeURIComponent(`throw globalThis.${key}; //${seq++}.js`)}`;

describe("失敗の報告は要素を名指す（3.5 と同じ見出し）", () => {
  it("src= の読み込みの失敗: 見出しが src を名指し、その後に投げられた値そのもの。1 回だけで、promise も getBindingsReady も同じ値で reject する", async () => {
    spy();
    const thrown = new RangeError("the state module threw");
    (globalThis as any).__initFailSrc = thrown;
    try {
      const src = throwing("__initFailSrc");
      const { root, el } = page(`<wcs-state src="${src}"></wcs-state><p>{{ x }}</p>`);
      expect(await rejection(el.connectedCallbackPromise)).toBe(thrown);
      await expect(getBindingsReady(root)).rejects.toBe(thrown);
      await expect(el.initializePromise).resolves.toBeUndefined();
      expect(error).toHaveBeenCalledExactlyOnceWith(`[@wcstack/state] <wcs-state src="${src}"> failed to initialize.`, thrown);
    } finally {
      delete (globalThis as any).__initFailSrc;
    }
  });

  it("state= の id が無い: 見出しが state を名指す", async () => {
    spy();
    const { el } = page(`<wcs-state state="init-fail-nowhere"></wcs-state>`);
    const reason = await rejection(el.connectedCallbackPromise);
    expect(error).toHaveBeenCalledExactlyOnceWith('[@wcstack/state] <wcs-state state="init-fail-nowhere"> failed to initialize.', reason);
  });

  it("json= のパースの失敗: 見出しは要素だけ（json= は中身そのもので、SyntaxError がどこかを言う）", async () => {
    spy();
    const { el } = page(`<wcs-state json='{bad'></wcs-state>`);
    const reason = await rejection(el.connectedCallbackPromise);
    expect(reason).toBeInstanceOf(SyntaxError);
    expect(error).toHaveBeenCalledExactlyOnceWith("[@wcstack/state] <wcs-state> failed to initialize.", reason);
  });

  it("宣言の誤りで投げても、同じ見出しが付く（素の SyntaxError・TypeError でも要素が分かる）", async () => {
    spy();
    const { el } = page(`<wcs-state></wcs-state>`, { $features: "nope" });
    const reason = await rejection(el.connectedCallbackPromise);
    expect(error).toHaveBeenCalledExactlyOnceWith("[@wcstack/state] <wcs-state> failed to initialize.", reason);
  });

  it("SSR のスナップショットが読めないときも、同じ見出しで reject する", async () => {
    spy();
    // (the engine's own version: a snapshot of another one is discarded unread)
    const { el } = page(`<wcs-ssr version="${VERSION}"><script type="application/json">{bad</script></wcs-ssr><wcs-state enable-ssr></wcs-state>`, {});
    const reason = await rejection(el.connectedCallbackPromise);
    expect(reason).toBeInstanceOf(SyntaxError);
    expect(error).toHaveBeenCalledExactlyOnceWith("[@wcstack/state] <wcs-state> failed to initialize.", reason);
  });
});

describe("DCC の定義の失敗は reject する（3.x と同じ）", () => {
  /** A definition host built with the DOM API (happy-dom has no declarative shadow DOM). */
  function definition(inner: string) {
    const tag = `init-fail-dcc-${seq++}`;
    const def = document.createElement(tag);
    def.setAttribute("data-wc-definition", "");
    const shadow = def.attachShadow({ mode: "open" });
    shadow.innerHTML = `<p>{{ count }}</p>${inner}`;
    document.body.appendChild(def);
    return { tag, def, shadow, el: shadow.querySelector("wcs-state") as any };
  }

  it("状態の読み込みに失敗すると、その SyntaxError で reject し、見出しを付けて 1 回報告し、タグは定義しない。定義の shadow root の getBindingsReady も reject する", async () => {
    spy();
    const { tag, shadow, el } = definition(`<wcs-state json='{bad'></wcs-state>`);
    const reason = await rejection(el.connectedCallbackPromise);
    expect(reason).toBeInstanceOf(SyntaxError);
    await expect(el.initializePromise).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledExactlyOnceWith("[@wcstack/state] <wcs-state> failed to initialize.", reason);
    expect(customElements.get(tag)).toBeUndefined();
    await expect(getBindingsReady(shadow)).rejects.toBe(reason);
  });

  it("定義の誤り（$bindables）も、その誤りで reject する", async () => {
    spy();
    const { el } = definition(`<wcs-state json='{"count":1,"$bindables":["nope"]}'></wcs-state>`);
    await expect(el.connectedCallbackPromise).rejects.toThrow('$bindables entry "nope" does not exist on the state');
  });

  it("bind-component の <wcs-state> は定義にならず、reject する（見出しが bind-component を名指す）", async () => {
    spy();
    const { tag, el } = definition(`<wcs-state bind-component="state" json='{"count":1}'></wcs-state>`);
    const reason = await rejection(el.connectedCallbackPromise);
    expect(String((reason as Error).message)).toContain("cannot define a component");
    expect(error).toHaveBeenCalledExactlyOnceWith('[@wcstack/state] <wcs-state bind-component="state"> failed to initialize.', reason);
    expect(customElements.get(tag)).toBeUndefined();
  });

  it("（対照）成功した定義は resolve し、getBindingsReady も resolve する", async () => {
    spy();
    const { tag, shadow, el } = definition(`<wcs-state json='{"count":1}'></wcs-state>`);
    await el.connectedCallbackPromise;
    await getBindingsReady(shadow);
    expect(customElements.get(tag)).toBeDefined();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("コンポーネントのマウント（bind-component）の失敗は reject する（3.x の README が設定の誤りについて約束するとおり）", () => {
  function component(state: unknown, light = false) {
    const tag = `init-fail-cmp-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      state = state;
      constructor() {
        super();
        if (!light) this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state><p>{{ n }}</p>`;
      }
    });
    return tag;
  }

  it("ホストの state がオブジェクトでなければ、その誤りで reject し、見出しを付けて報告する。その shadow root の getBindingsReady も reject し、ページは影響を受けない", async () => {
    spy();
    const tag = component(null);
    const { root, el } = page(`<wcs-state></wcs-state><${tag}></${tag}>`, {});
    await el.connectedCallbackPromise;
    const inner = root.querySelector(tag)!.shadowRoot!.querySelector("wcs-state") as any;
    const reason = await rejection(inner.connectedCallbackPromise);
    expect(String((reason as Error).message)).toContain(`<${tag}>.state must be an object`);
    await expect(inner.initializePromise).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledExactlyOnceWith('[@wcstack/state] <wcs-state bind-component="state"> failed to initialize.', reason);
    await expect(getBindingsReady(root.querySelector(tag)!.shadowRoot!)).rejects.toBe(reason);
    await expect(getBindingsReady(root)).resolves.toBeUndefined();
  });

  it("（対照）成功したマウント: その shadow root の getBindingsReady は、コンポーネントが束ね終えてから resolve する", async () => {
    spy();
    const tag = component({ n: "mounted" });
    const host = document.createElement(tag);
    document.body.appendChild(host);
    await getBindingsReady(host.shadowRoot!);
    expect(host.shadowRoot!.querySelector("p")!.textContent).toBe("mounted");
    await (host.shadowRoot!.querySelector("wcs-state") as any).connectedCallbackPromise;
    expect(error).not.toHaveBeenCalled();
  });

  it("Light DOM のマウントの失敗は、ページの getBindingsReady に混ざらない（ページの根の失敗を隠さない）", async () => {
    spy();
    const tag = component({ n: 1 }, true);
    const { root, el } = page(`<wcs-state></wcs-state><${tag} data-wcs="state: missing"><wcs-state bind-component="state"></wcs-state><p>{{ n }}</p></${tag}>`, { $features: "nope" });
    const reason = await rejection(el.connectedCallbackPromise);
    await expect(getBindingsReady(root)).rejects.toBe(reason);
  });
});

describe("ボリュームは失敗しても resolve する（3.x と同じ）", () => {
  it("状態の読み込みに失敗したボリュームは、見出しを付けて報告し、connectedCallbackPromise を resolve する。根は影響を受けない", async () => {
    spy();
    const { root, el } = page(`<wcs-state></wcs-state><wcs-state mount="v" json='{bad'></wcs-state><p>{{ a }}</p>`, { a: "root" });
    await el.connectedCallbackPromise;
    const vol = root.querySelectorAll("wcs-state")[1] as any;
    await expect(vol.connectedCallbackPromise).resolves.toBeUndefined();
    await expect(vol.initializePromise).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledExactlyOnceWith('[@wcstack/state] <wcs-state mount="v"> failed to initialize.', expect.any(SyntaxError));
    await expect(getBindingsReady(root)).resolves.toBeUndefined();
    await flush();
    expect(root.querySelector("p")!.textContent).toBe("root");
  });

  it("接ぎ木しないボリューム（不正なパス）は、自分の文面だけで報告して resolve する（見出しは付かない）", async () => {
    spy();
    const { root, el } = page(`<wcs-state></wcs-state><wcs-state mount="a.*" json='{"x":1}'></wcs-state>`, {});
    await el.connectedCallbackPromise;
    await expect((root.querySelectorAll("wcs-state")[1] as any).connectedCallbackPromise).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledExactlyOnceWith('[@wcstack/state] <wcs-state mount="a.*"> has an invalid mount path: it must be a static path (no "*", "$", "#", "@").');
  });
});

describe("束ねた後の $connectedCallback は初期化の失敗ではない（getBindingsReady は束ね終えた時点で resolve する）", () => {
  const flushes = async () => { for (let i = 0; i < 4; i++) await flush(); };
  /** "resolved" / "rejected" / "pending" after a few tasks. */
  const settle = (p: Promise<unknown>) => Promise.race([p.then(() => "resolved", () => "rejected"), flushes().then(() => "pending")]);
  const boom = new Error("connected failed");
  /** A component whose `$connectedCallback` never settles, or rejects. */
  const connected = (how: "pending" | "reject") => ({
    $connectedCallback: () => (how === "pending" ? new Promise(() => {}) : Promise.reject(boom)),
  });

  function shadowComponent(how: "pending" | "reject") {
    const tag = `init-fail-cc-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      state = { n: "rendered", ...connected(how) };
      constructor() {
        super();
        this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state><p>{{ n }}</p>`;
      }
    });
    const host = document.createElement(tag);
    document.body.appendChild(host);
    return { shadow: host.shadowRoot!, el: host.shadowRoot!.querySelector("wcs-state") as any };
  }

  function lightComponent(how: "pending" | "reject") {
    const tag = `init-fail-cc-${seq++}`;
    customElements.define(tag, class extends HTMLElement { state = connected(how); });
    const { root, el } = page(`<wcs-state></wcs-state><${tag} data-wcs="state: user"><wcs-state bind-component="state"></wcs-state><p>{{ n }}</p></${tag}>`, { user: { n: "rendered" } });
    return { root, rootEl: el, el: root.querySelector(`${tag} > wcs-state`) as any };
  }

  it("Shadow DOM: 終わらない $connectedCallback でも、その shadow root の getBindingsReady と initializePromise は描いた時点で resolve し、connectedCallbackPromise は待ったまま", async () => {
    spy();
    const { shadow, el } = shadowComponent("pending");
    await getBindingsReady(shadow);
    expect(shadow.querySelector("p")!.textContent).toBe("rendered");
    await expect(el.initializePromise).resolves.toBeUndefined();
    expect(await settle(el.connectedCallbackPromise)).toBe("pending");
    expect(error).not.toHaveBeenCalled();
  });

  it("Shadow DOM: reject する $connectedCallback は connectedCallbackPromise をそのエラーで reject し、「$connectedCallback failed.」と報告する（初期化の失敗とは言わない）。getBindingsReady は resolve のまま", async () => {
    spy();
    const { shadow, el } = shadowComponent("reject");
    await expect(el.connectedCallbackPromise).rejects.toBe(boom);
    await expect(getBindingsReady(shadow)).resolves.toBeUndefined();
    expect(shadow.querySelector("p")!.textContent).toBe("rendered");
    expect(error).toHaveBeenCalledExactlyOnceWith('[@wcstack/state] <wcs-state bind-component="state"> $connectedCallback failed.', boom);
  });

  it("Light DOM: 終わらない $connectedCallback でも、ページの getBindingsReady と部品の initializePromise は resolve し、部品の connectedCallbackPromise は待ったまま", async () => {
    spy();
    const { root, rootEl, el } = lightComponent("pending");
    await rootEl.connectedCallbackPromise;
    await getBindingsReady(root);
    await expect(el.initializePromise).resolves.toBeUndefined();
    expect(root.querySelector("p")!.textContent).toBe("rendered");
    expect(await settle(el.connectedCallbackPromise)).toBe("pending");
    expect(error).not.toHaveBeenCalled();
  });

  it("Light DOM: reject する $connectedCallback は部品の connectedCallbackPromise を reject し、「$connectedCallback failed.」と報告する。ページの getBindingsReady は resolve のまま", async () => {
    spy();
    const { root, rootEl, el } = lightComponent("reject");
    await rootEl.connectedCallbackPromise;
    await expect(el.connectedCallbackPromise).rejects.toBe(boom);
    await expect(getBindingsReady(root)).resolves.toBeUndefined();
    expect(root.querySelector("p")!.textContent).toBe("rendered");
    expect(error).toHaveBeenCalledExactlyOnceWith('[@wcstack/state] <wcs-state bind-component="state"> $connectedCallback failed.', boom);
  });

  it("根: reject する $connectedCallback も同じ報告で、ページは束ねたまま（getBindingsReady は resolve、再セットもできる）", async () => {
    spy();
    const { root, el } = page(`<wcs-state></wcs-state><p>{{ n }}</p>`, { n: "rendered", ...connected("reject") });
    await expect(el.connectedCallbackPromise).rejects.toBe(boom);
    await expect(getBindingsReady(root)).resolves.toBeUndefined();
    expect(root.querySelector("p")!.textContent).toBe("rendered");
    expect(error).toHaveBeenCalledExactlyOnceWith("[@wcstack/state] <wcs-state> $connectedCallback failed.", boom);
    el.setInitialState({ n: "again" });
    expect(root.querySelector("p")!.textContent).toBe("again");
  });
});
