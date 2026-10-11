/**
 * fixes-lifecycle.test.ts — 4.0 の既知の制限（docs/migration-v4.md §5）のうち、要素の出し入れに関わる 5 つ:
 * KL1 ページを束ねたときに居なかったコンポーネントのホスト、KL2 差し替えた `<wcs-state bind-component>` を戻す、
 * KL3 外して戻した根の `<wcs-state>`、KL4 根の再接続・切断のライフサイクルの同期の例外、KL5 根を替えた後のメモリ。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import v8 from "node:v8";
import vm from "node:vm";
import { bootstrapState, getBindingsReady, installFeatures, scopes } from "../src/index";
import { engines } from "../src/dom/mount";
import { M, text as message } from "../src/messages";

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 4) => { for (let i = 0; i < n; i++) await flush(); };
const BINDER_KEY = Symbol.for("wcstack.binder");
const boom = new Error("boom");
let seq = 0;

beforeAll(() => {
  installFeatures([scopes]);
  bootstrapState();
});

const pages: Element[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const h of pages.splice(0)) h.remove();
});

/** A component: its `<wcs-state bind-component="state">` and `markup` in its shadow root, or (light) in its children. */
function define(markup: string, state: () => Record<string, any> = () => ({}), light = false): string {
  const tag = `fix-life-cmp-${seq++}`;
  const content = `<wcs-state bind-component="state"></wcs-state>${markup}`;
  customElements.define(tag, class extends HTMLElement {
    state = state();
    constructor() {
      super();
      if (!light) this.attachShadow({ mode: "open" }).innerHTML = content;
    }
    connectedCallback(): void {
      if (light && this.childElementCount === 0) this.innerHTML = content;
    }
  });
  return tag;
}

/** A page (a shadow root, not connected yet) whose root `<wcs-state>` waits for setInitialState. */
function page(html: string) {
  const h = document.createElement(`fix-life-page-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  pages.push(h);
  const el = root.querySelector("wcs-state") as any;
  const write = async (fn: (s: any) => void) => {
    el.createState("writable", fn);
    await settle();
  };
  return { h, root, el, write };
}

/** A page connected and bound over `state`. */
async function bound(html: string, state: Record<string, any>) {
  const p = page(html);
  p.el.setInitialState(state);
  document.body.appendChild(p.h);
  await p.el.connectedCallbackPromise;
  await getBindingsReady(p.root);
  await settle();
  return p;
}

const text = (c: ParentNode, sel: string) => c.querySelector(sel)!.textContent;
const scopeOf = (c: Element, light: boolean): Element | ShadowRoot => (light ? c : c.shadowRoot!);

/** "pending" when `p` has not settled after a few tasks. */
async function outcome(p: Promise<unknown>): Promise<string> {
  const o = p.then(() => "resolved", () => "rejected");
  return Promise.race([o, settle().then(() => "pending")]);
}

/** Uncaught errors (a window error event, an unhandled rejection) while it is installed. */
function uncaught() {
  const seen: unknown[] = [];
  const onError = (e: any) => { seen.push(e?.error ?? e); e.preventDefault?.(); };
  const onRejection = (e: unknown) => { seen.push(e); };
  window.addEventListener("error", onError);
  process.on("unhandledRejection", onRejection);
  return {
    seen,
    stop() {
      window.removeEventListener("error", onError);
      process.off("unhandledRejection", onRejection);
    },
  };
}

for (const light of [false, true]) {
  const form = light ? "Light DOM" : "Shadow DOM";

  describe(`KL1 ページを束ねたときに居なかったホストは、その <wcs-state bind-component> がつながったときに結線する（${form}）`, () => {
    it("ページを束ねる前に外し、束ねた後で戻したホスト", async () => {
      const tag = define(`<p>{{ name }}</p>`, () => ({}), light);
      const { h, root, el, write } = page(`<div id="a"><${tag} data-wcs="state: user"></${tag}></div>`);
      document.body.appendChild(h);
      const card = root.querySelector(tag)!;
      const scope = scopeOf(card, light);
      const inner = scope.querySelector("wcs-state") as any;
      // its <wcs-state> has loaded and waits for the host's wiring; the host leaves before the page binds
      await settle();
      card.remove();
      el.setInitialState({ user: { name: "A" } });
      await el.connectedCallbackPromise;
      await getBindingsReady(root);
      expect(await outcome(inner.connectedCallbackPromise)).toBe("pending");
      root.querySelector("#a")!.appendChild(card);
      await inner.connectedCallbackPromise;
      await settle();
      expect(text(scope, "p")).toBe("A");
      await write((s) => { s["user.name"] = "B"; });
      expect(text(scope, "p")).toBe("B");
    });

    it("ページを束ねた後で初めて入れたホスト（ホストの他のバインディングも付く）", async () => {
      const tag = define(`<p>{{ name }}</p>`, () => ({}), light);
      const { root, write } = await bound(`<main></main>`, { user: { name: "A" }, mark: "on" });
      const box = document.createElement("div");
      box.innerHTML = `<${tag} data-wcs="state: user; attr.data-mark: mark"></${tag}>`;
      root.querySelector("main")!.appendChild(box);
      const card = box.firstElementChild!;
      const scope = scopeOf(card, light);
      await (scope.querySelector("wcs-state") as any).connectedCallbackPromise;
      await settle();
      expect(text(scope, "p")).toBe("A");
      expect(card.getAttribute("data-mark")).toBe("on");
      await write((s) => { s["user.name"] = "B"; s.mark = "off"; });
      expect(text(scope, "p")).toBe("B");
      expect(card.getAttribute("data-mark")).toBe("off");
    });

    it("根の <wcs-state> を外している間に入れたホストは、根を戻したときに結線する", async () => {
      const tag = define(`<p>{{ name }}</p>`, () => ({}), light);
      const { root, el, write } = await bound(`<main></main>`, { user: { name: "A" } });
      el.remove();
      root.querySelector("main")!.innerHTML = `<${tag} data-wcs="state: user"></${tag}>`;
      const card = root.querySelector(tag)!;
      const scope = scopeOf(card, light);
      const inner = scope.querySelector("wcs-state") as any;
      expect(await outcome(inner.connectedCallbackPromise)).toBe("pending");
      root.prepend(el);
      await inner.connectedCallbackPromise;
      await settle();
      expect(text(scope, "p")).toBe("A");
      await write((s) => { s["user.name"] = "B"; });
      expect(text(scope, "p")).toBe("B");
    });
  });

  describe(`KL2 差し替えた <wcs-state bind-component> を外して古い方を戻す（${form}）`, () => {
    /** A component whose state logs `cc` / `dc`, mounted on the page's `user`. */
    async function mounted(rerender = false) {
      const log: string[] = [];
      const tag = define(`<p>{{ name }}</p>`, () => ({
        $connectedCallback() { log.push("cc"); },
        $disconnectedCallback() { log.push("dc"); },
      }), light);
      const p = await bound(`<${tag} data-wcs="state: user"></${tag}>`, { user: { name: "A" } });
      const card = p.root.querySelector(tag)!;
      const scope = scopeOf(card, light);
      const old = scope.querySelector("wcs-state") as any;
      await old.connectedCallbackPromise;
      await settle();
      const fresh = document.createElement("wcs-state") as any;
      fresh.setAttribute("bind-component", "state");
      if (rerender) {
        // the component renders its content again around the new <wcs-state>: a new engine binds it
        old.remove();
        for (const n of [...scope.childNodes]) n.remove();
        scope.append(fresh);
        scope.appendChild(document.createElement("p")).textContent = "{{ name }}";
      } else {
        old.replaceWith(fresh);
      }
      await fresh.connectedCallbackPromise;
      await settle();
      return { ...p, log, scope, old, fresh };
    }

    it("新しい方がスコープを引き継いだ後: 戻した古い方がスコープを引き継ぎ、ホストに追従し、$connectedCallback を呼ぶ", async () => {
      const { scope, old, fresh, log, write } = await mounted();
      expect(log).toEqual(["cc", "dc", "cc"]);
      fresh.replaceWith(old);
      await settle();
      expect(log).toEqual(["cc", "dc", "cc", "dc", "cc"]);
      await write((s) => { s["user.name"] = "B"; });
      expect(text(scope, "p")).toBe("B");
      // the old element reaches the component's state again, the new one no longer does
      let name: unknown;
      old.createState("readonly", (s: any) => { name = s.name; });
      expect(name).toBe("B");
      expect(fresh.engine).toBeNull();
      old.remove();
      expect(log).toEqual(["cc", "dc", "cc", "dc", "cc", "dc"]);
    });

    it("新しい方が中身を描き直した後: 戻した古い方が新しい方のスコープを引き継ぐ", async () => {
      const { scope, old, fresh, log, write } = await mounted(true);
      expect(text(scope, "p")).toBe("A");
      fresh.replaceWith(old);
      await settle();
      expect(log).toEqual(["cc", "dc", "cc", "dc", "cc"]);
      await write((s) => { s["user.name"] = "B"; });
      expect(text(scope, "p")).toBe("B");
    });

    it("古い方を別の場所へ入れても、何もしない（止まったまま。報告もしない）", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { root, scope, old, fresh, log, write } = await mounted();
      fresh.remove();
      root.appendChild(document.createElement("div")).appendChild(old);
      await settle();
      expect(log).toEqual(["cc", "dc", "cc", "dc"]);
      expect(error).not.toHaveBeenCalled();
      await write((s) => { s["user.name"] = "B"; });
      expect(text(scope, "p")).toBe("A");
    });

    it("新しい方がつながったまま古い方も入れると報告し、新しい方のまま動く", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { scope, old, log, write } = await mounted();
      scope.append(old);
      await settle();
      expect(error).toHaveBeenCalledTimes(1);
      expect(String((error.mock.calls[0][0] as Error).message)).toContain('already has a connected <wcs-state bind-component="state">');
      expect(log).toEqual(["cc", "dc", "cc"]);
      await write((s) => { s["user.name"] = "B"; });
      expect(text(scope, "p")).toBe("B");
    });
  });
}

describe("KL1 入れ子の Light DOM のコンポーネント", () => {
  it("外側の Light DOM のコンポーネントの中のホストは、外側のコンポーネント（ページではない）が結線する。後から入れても同じ", async () => {
    const inner = define(`<b>{{ name }}</b>`, () => ({}), true);
    const outer = define(`<${inner} data-wcs="state: profile"></${inner}>`, () => ({}), true);
    const state = { user: { profile: { name: "U" } }, profile: { name: "PAGE" } };
    const { root, write } = await bound(`<${outer} data-wcs="state: user"></${outer}><main></main>`, state);
    const first = root.querySelector(`${outer} ${inner}`)!;
    await (first.querySelector("wcs-state") as any).connectedCallbackPromise;
    await settle();
    expect(text(first, "b")).toBe("U");
    root.querySelector("main")!.innerHTML = `<${outer} data-wcs="state: user"></${outer}>`;
    const late = root.querySelector(`main ${inner}`)!;
    await (late.querySelector("wcs-state") as any).connectedCallbackPromise;
    await settle();
    expect(text(late, "b")).toBe("U");
    await write((s) => { s["user.profile.name"] = "V"; });
    expect([text(first, "b"), text(late, "b")]).toEqual(["V", "V"]);
    // a host put into the content of the outer component after it mounted: its engine binds it
    const outerHost = root.querySelector(outer)!;
    const box = document.createElement("div");
    box.innerHTML = `<${inner} data-wcs="state: profile"></${inner}>`;
    outerHost.appendChild(box);
    const added = box.firstElementChild!;
    await (added.querySelector("wcs-state") as any).connectedCallbackPromise;
    await settle();
    expect(text(added, "b")).toBe("V");
  });
});

describe("KL1 根の初期化の失敗", () => {
  it("束ねる途中で失敗した根（マークアップの誤り）の後ろのホストは結線せず、コンポーネントは「will not mount」で決着する", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const tag = define(`<p>{{ name }}</p>`);
    const { h, root, el } = page(`<i data-wcs="textContent: name|nope"></i><${tag} data-wcs="state: user"></${tag}>`);
    el.setInitialState({ user: { name: "A" } });
    document.body.appendChild(h);
    await expect(el.connectedCallbackPromise).rejects.toThrow();
    const inner = root.querySelector(tag)!.shadowRoot!.querySelector("wcs-state") as any;
    await expect(inner.connectedCallbackPromise).rejects.toThrow("will not mount: the root state failed to initialize.");
    expect(text(root.querySelector(tag)!.shadowRoot!, "p")).toBe("{{ name }}");
    expect(error).toHaveBeenCalled();
  });
});

describe("KL3 外して戻した根の <wcs-state>", () => {
  it("根を外している間につながった volume は、根を戻したときに接ぎ木され、connectedCallbackPromise が決着する", async () => {
    const { root, el } = await bound(`<p>{{ cfg.flag }}</p>`, {});
    el.remove();
    const volume = document.createElement("wcs-state") as any;
    volume.setAttribute("mount", "cfg");
    volume.setAttribute("json", '{"flag": "on"}');
    root.appendChild(volume);
    expect(await outcome(volume.connectedCallbackPromise)).toBe("pending");
    root.prepend(el);
    await volume.connectedCallbackPromise;
    await settle();
    let flag: unknown;
    el.createState("readonly", (s: any) => { flag = s["cfg.flag"]; });
    expect(flag).toBe("on");
    expect(text(root, "p")).toBe("on");
  });

  it("根を外している間に binder に渡された中身は、根を戻したときに束ねる", async () => {
    const { root, el, write } = await bound(`<main></main>`, { n: 1 });
    el.remove();
    const box = document.createElement("div");
    box.innerHTML = `<b>{{ n }}</b><i data-wcs="textContent: n"></i>`;
    root.querySelector("main")!.appendChild(box);
    (globalThis as any)[BINDER_KEY].bind(box);
    expect(text(box, "b")).toBe("{{ n }}");
    root.prepend(el);
    expect([text(box, "b"), text(box, "i")]).toEqual(["1", "1"]);
    await write((s) => { s.n = 2; });
    expect([text(box, "b"), text(box, "i")]).toEqual(["2", "2"]);
  });

  it("根を外している間に範囲付きで渡されたルートの先頭の for: テンプレートは、根を戻したときに範囲どおり描く", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { root, el, write } = await bound(`<main></main>`, { items: [{ v: "a" }, { v: "b" }] });
    el.remove();
    const main = root.querySelector("main")!;
    main.innerHTML = `<template data-wcs="for: items"><i>{{ .v }}</i></template>`;
    (globalThis as any)[BINDER_KEY].bind(main.firstElementChild, { range: true });
    root.prepend(el);
    expect(Array.from(main.querySelectorAll("i"), (i) => i.textContent)).toEqual(["a", "b"]);
    await write((s) => { s.items = [...s.items, { v: "c" }]; });
    expect(Array.from(main.querySelectorAll("i"), (i) => i.textContent)).toEqual(["a", "b", "c"]);
    expect(error).not.toHaveBeenCalled();
  });

  it("根を外している間に同じパスの volume がつながると、根を戻したときにそちらは報告して決着し、パスは元の volume が持ち続ける", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const HAS = '[@wcstack/state] <wcs-state mount="cfg"> will not graft: the root state already has "cfg".';
    const HELD = '[@wcstack/state] <wcs-state mount="cfg"> will not graft: another volume already holds "cfg".';
    const volume = (flag: string | null): any => {
      const v = document.createElement("wcs-state") as any;
      v.setAttribute("mount", "cfg");
      if (flag !== null) v.setAttribute("json", JSON.stringify({ flag }));
      return v;
    };
    const reports = () => error.mock.calls.map((c) => c[0]);
    const { root, el } = await bound(`<p>{{ cfg.flag }}</p>`, {});
    const first = volume("one");
    root.appendChild(first);
    await first.connectedCallbackPromise;
    await settle();
    el.remove();
    const second = volume("two");
    root.appendChild(second);
    // (it loads, and waits for the root)
    expect(await outcome(second.connectedCallbackPromise)).toBe("pending");
    root.prepend(el);
    await second.connectedCallbackPromise;
    await settle();
    expect(text(root, "p")).toBe("one");
    expect(reports()).toEqual([HAS]);
    // the first holds its path again
    const third = volume("three");
    root.appendChild(third);
    await third.connectedCallbackPromise;
    expect(reports()).toEqual([HAS, HELD]);
    // one that has no state yet holds the path while the root is out: the first does not take it back
    el.remove();
    const pending = volume(null);
    root.appendChild(pending);
    root.prepend(el);
    pending.setInitialState({ flag: "late" });
    await pending.connectedCallbackPromise;
    expect(reports()).toEqual([HAS, HELD, HAS]);
    expect(text(root, "p")).toBe("one");
  });

  it("結線の無い Shadow DOM のコンポーネントの <wcs-state> を外している間につながった volume は、戻したときに接ぎ木される", async () => {
    const tag = define(`<p>{{ cfg.flag }}</p>`, () => ({ n: 1 }));
    const { root } = await bound(`<${tag}></${tag}>`, {});
    const scope = root.querySelector(tag)!.shadowRoot!;
    const own = scope.querySelector("wcs-state") as any;
    await own.connectedCallbackPromise;
    await settle();
    own.remove();
    const volume = document.createElement("wcs-state") as any;
    volume.setAttribute("mount", "cfg");
    volume.setAttribute("json", '{"flag": "on"}');
    scope.appendChild(volume);
    expect(await outcome(volume.connectedCallbackPromise)).toBe("pending");
    scope.prepend(own);
    await volume.connectedCallbackPromise;
    await settle();
    expect(text(scope, "p")).toBe("on");
  });

  it("外している間に別の根が束ねた root へ戻した古い根には、何も接ぎ木せず binder も渡さない", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { root, el } = await bound(`<main></main>`, { n: "old" });
    el.remove();
    const next = document.createElement("wcs-state") as any;
    next.setInitialState({ n: "new" });
    root.prepend(next);
    await next.connectedCallbackPromise;
    await settle();
    root.prepend(el);
    const box = document.createElement("div");
    box.innerHTML = `<b>{{ n }}</b>`;
    root.querySelector("main")!.appendChild(box);
    (globalThis as any)[BINDER_KEY].bind(box);
    expect(text(box, "b")).toBe("new");
    expect(engines.get(root)).toBe(next.engine);
    expect(error).not.toHaveBeenCalled();
  });
});

describe("KL4 根の再接続・切断で、ライフサイクルの失敗は初回の接続と同じく console.error に報告する", () => {
  it.each(["throw", "reject"])("再接続の $connectedCallback が失敗する（%s）: 「$connectedCallback failed.」で報告し、捕まらない例外にしない", async (how) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let n = 0;
    const { root, el } = await bound(`<p>{{ v }}</p>`, {
      v: 1,
      $connectedCallback() {
        if (++n === 1) return;
        if (how === "throw") throw boom;
        return Promise.reject(boom);
      },
    });
    el.remove();
    const u = uncaught();
    try {
      expect(() => root.prepend(el)).not.toThrow();
      await settle();
    } finally {
      u.stop();
    }
    expect(n).toBe(2);
    expect(u.seen).toEqual([]);
    expect(error.mock.calls).toEqual([[`[@wcstack/state] ${message(M.ConnectedFailed, ["wcs-state"])}`, boom]]);
  });

  it.each(["throw", "reject"])("$disconnectedCallback が失敗する（%s）: 「$disconnectedCallback failed.」で報告し、捕まらない例外にしない（毎回）", async (how) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { root, el, write } = await bound(`<p>{{ v }}</p>`, {
      v: 1,
      $disconnectedCallback() {
        if (how === "throw") throw boom;
        return Promise.reject(boom);
      },
    });
    const u = uncaught();
    try {
      expect(() => el.remove()).not.toThrow();
      root.prepend(el);
      expect(() => el.remove()).not.toThrow();
      await settle();
    } finally {
      u.stop();
    }
    expect(u.seen).toEqual([]);
    const report = [`[@wcstack/state] ${message(M.DisconnectedFailed, ["wcs-state"])}`, boom];
    expect(error.mock.calls).toEqual([report, report]);
    // the root still works
    root.prepend(el);
    await write((s) => { s.v = 2; });
    expect(text(root, "p")).toBe("2");
  });

  it("src= の根の報告は、初回の接続と同じく要素と読み込み元を名指す", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { root, el } = await bound(`<p>{{ v }}</p>`, {
      v: 1,
      $disconnectedCallback() { throw boom; },
    });
    el.setAttribute("state", "cfg");
    el.remove();
    root.prepend(el);
    await settle();
    expect(error.mock.calls).toEqual([[`[@wcstack/state] ${message(M.DisconnectedFailed, ["wcs-state", "state", "cfg"])}`, boom]]);
  });
});

v8.setFlagsFromString("--expose-gc");
const gc: () => void = vm.runInNewContext("gc");

/** Whether what `ref` points to is collected (a few rounds of tasks and collections). */
async function collected(ref: WeakRef<object>): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    await flush();
    gc();
    if (ref.deref() === undefined) return true;
  }
  return false;
}

describe("KL5 根を替えた後のメモリ", () => {
  it("外した根は、外している間は root の engine として登録されず、戻すとまた登録される", async () => {
    const { root, el } = await bound(`<p>{{ v }}</p>`, { v: 1 });
    const engine = el.engine;
    expect(engines.get(root)).toBe(engine);
    el.remove();
    expect(engines.get(root)).toBeUndefined();
    root.prepend(el);
    expect(engines.get(root)).toBe(engine);
    // moved into another root, it holds neither (its bindings stay where they are)
    const other = document.createElement(`fix-life-page-${seq++}`);
    pages.push(other);
    document.body.appendChild(other);
    other.attachShadow({ mode: "open" }).appendChild(el);
    expect([engines.get(root), engines.get(other.shadowRoot!)]).toEqual([undefined, undefined]);
  });

  /** A bound page with a grafted volume; only the shadow root and weak references to the rest are returned. */
  async function grafted(): Promise<{ root: ShadowRoot; refs: WeakRef<object>[] }> {
    const { root, el } = await bound(`<section><p>{{ v }}</p><p>{{ cfg.flag }}</p></section>`, { v: 1 });
    const volume = document.createElement("wcs-state") as any;
    volume.setAttribute("mount", "cfg");
    volume.setAttribute("json", '{"flag": "on"}');
    root.querySelector("section")!.appendChild(volume);
    await volume.connectedCallbackPromise;
    await settle();
    expect(text(root, "section p:last-of-type")).toBe("on");
    return { root, refs: [new WeakRef(el.engine), new WeakRef(el), new WeakRef(root.querySelector("section")!), new WeakRef(volume)] };
  }

  it("根を、束ねた中身と volume と一緒に外すと、別の <wcs-state> がその root を束ねなくても、状態と DOM は回収できる", async () => {
    const { root, refs } = await grafted();
    // the page's content goes: the root, its volume and what it bound
    root.replaceChildren();
    await settle();
    for (const ref of refs) expect(await collected(ref)).toBe(true);
  });
});
