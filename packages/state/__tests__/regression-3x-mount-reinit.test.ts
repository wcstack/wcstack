/**
 * regression-3x-mount-reinit.test.ts — 3.x の #417 / #418 / #419（main の PR #420 で直した、マウントの
 * スコープの同じ DOM の上での再初期化）を、4.0 のエンジン（state-next）で確かめる。移し元は 3.x の
 * packages/state/__tests__/integration.mountScopeReinit.test.ts。Shadow DOM 形と Light DOM 形の両方で流す。
 *
 * 4.0 の違い:
 * - `<wcs-state bind-component>` の準備（load → start）は要素ごとに 1 回だけ走る。準備の間の切断・接続は
 *   準備を始め直さない（claimComponent の connected / disconnected は mount の前には何もしない）。初期化中の移動で
 *   準備が 2 本走る 3.x の #418 は、4.0 では起きない（守り）。
 * - 同じ DOM の上のもう 1 回の初期化は、`<wcs-state bind-component>` だけを差し替えた形（古いものを外し、新しい
 *   ものを入れる）。接続したままの 2 つ目は "already has a connected" で拒む。
 * - 4.0 の束縛は、描いた DOM の上でもう一度歩いても作り直せない（`for:` の template は錨に置き換わり、`{{ }}` は
 *   値の Text になっている）。歩いたことのある要素は飛ばすので、新しいエンジンで歩き直すと束縛は死に（#417）、
 *   スコープの直下の Text と行は値を markup として読む（#419）。差し替えた `<wcs-state>` は、古い中身が残って
 *   いれば古いエンジン（束縛・行・`{{ }}` の錨）を引き継ぐ。
 * - 3.x の「張り直しに失敗した束縛の報告」と「MutationObserver が知らせない捨てた DOM」の形は、4.0 に対応する
 *   ものが無い（張り直さない・MutationObserver を使わない）ので移していない。中身を作り直した形は下の守りで確かめる。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, scopes } from "../src/index";

beforeAll(() => {
  installFeatures([scopes]);
  bootstrapState();
});

const hosts: HTMLElement[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const h of hosts.splice(0)) h.remove();
});

const flush = () => new Promise((r) => setTimeout(r));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await flush();
};

let counter = 0;
const uniqueTag = (prefix: string): string => `${prefix}-${++counter}`;

/**
 * The scope's markup: inside elements (as 3.x's test), and — what a walk of the scope root itself reads
 * in 4.0 — a `{{ }}` text and a `for:` directly in the scope root.
 */
const SCOPE_TEMPLATE =
  `<span class="plain" data-wcs="textContent: name"></span>` +
  `<i class="mustache">{{ name }}</i>` +
  `<button data-wcs="onclick: bump"></button>` +
  `<ul><template data-wcs="for: tags"><li data-wcs="textContent: .label"></li><b>{{ .label }}</b></template></ul>` +
  `[{{ name }}]` +
  `<template data-wcs="for: tags"><em>{{ .label }}</em></template>`;

/**
 * A component that renders its content once (on the first connect), in its shadow root or light DOM.
 * `log` records the mounted state's lifecycle (`cc` / `dc`) and the button's handler (`bump`); `own`
 * adds to the state (and may replace those), `before` is markup ahead of its `<wcs-state>`.
 */
function defineRenderOnce(tag: string, log: string[], light = false, own: Record<string, any> = {}, before = ""): void {
  customElements.define(tag, class extends HTMLElement {
    state: Record<string, any> = {
      bump() { log.push("bump"); },
      $connectedCallback() { log.push("cc"); },
      $disconnectedCallback() { log.push("dc"); },
      ...own,
    };
    constructor() {
      super();
      if (!light) this.attachShadow({ mode: "open" });
    }
    connectedCallback() {
      const root: ParentNode = light ? this : this.shadowRoot!;
      if (root.firstChild === null) {
        (root as Element | ShadowRoot).innerHTML = `${before}<wcs-state bind-component="state"></wcs-state>${SCOPE_TEMPLATE}`;
      }
    }
  });
}

const JSON_STATE = '{"user":{"name":"A","tags":[{"label":"x"}]}}';

/** The page's `<wcs-state>` loads JSON_STATE, or (`late`) waits for setInitialState. */
function createHost(componentTag: string, late = false) {
  const host = document.createElement(uniqueTag("rg3r-host"));
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML =
    (late ? `<wcs-state></wcs-state>` : `<wcs-state json='${JSON_STATE}'></wcs-state>`) +
    `<div id="a"><${componentTag} data-wcs="state: user"></${componentTag}></div><div id="b"></div>`;
  hosts.push(host);
  const parentStateElement = shadowRoot.querySelector("wcs-state") as any;
  const component = shadowRoot.querySelector(componentTag)!;
  return { host, shadowRoot, parentStateElement, component };
}

const scopeOf = (component: Element, light: boolean): Element | ShadowRoot => (light ? component : component.shadowRoot!);

/** Mounts a render-once component and waits until its scope is built (not for its `$connectedCallback`). */
async function mountRenderOnce(prefix: string, light: boolean, own: Record<string, any> = {}, before = "") {
  const log: string[] = [];
  const tag = uniqueTag(prefix);
  defineRenderOnce(tag, log, light, own, before);
  const { host, shadowRoot, parentStateElement, component } = createHost(tag);
  document.body.appendChild(host);
  const scope = scopeOf(component, light);
  await parentStateElement.connectedCallbackPromise;
  await getBindingsReady(shadowRoot);
  await (scope.querySelector("wcs-state") as any).initializePromise;
  await settle();
  return { log, host, shadowRoot, parentStateElement, component, scope };
}

/** Replaces the scope's `<wcs-state bind-component>` with a fresh one; does not wait. */
function swapRaw(scope: Element | ShadowRoot): any {
  const fresh = document.createElement("wcs-state") as any;
  fresh.setAttribute("bind-component", "state");
  scope.querySelector("wcs-state")!.replaceWith(fresh);
  return fresh;
}

/** "pending" when `p` has not settled after a few tasks. */
async function settled(p: Promise<unknown>): Promise<string> {
  const outcome = p.then(() => "resolved", () => "rejected");
  return Promise.race([outcome, settle().then(() => "pending")]);
}

const boom = new Error("boom");

/** Replaces the scope's `<wcs-state bind-component>` with a fresh one, keeping the rest of the DOM. */
async function swapStateElement(scope: Element | ShadowRoot): Promise<any> {
  const fresh = document.createElement("wcs-state") as any;
  fresh.setAttribute("bind-component", "state");
  scope.querySelector("wcs-state")!.replaceWith(fresh);
  await fresh.connectedCallbackPromise;
  await settle();
  return fresh;
}

/**
 * The scope's rendered text: the property binding, the `{{ }}` binding, each row's two bindings, then
 * the `{{ }}` text and the rows directly in the scope root.
 */
const rendered = (scope: Element | ShadowRoot): (string | null)[] => [
  scope.querySelector(".plain")!.textContent,
  scope.querySelector(".mustache")!.textContent,
  ...Array.from(scope.querySelectorAll("li, b")).map((node) => node.textContent),
  Array.from(scope.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim(),
  ...Array.from(scope.children).filter((e) => e.localName === "em").map((e) => e.textContent),
];

/** Checks every binding kind of the scope against the tree, including after writes. */
async function expectScopeAlive(scope: Element | ShadowRoot, parentStateElement: any, log: string[]): Promise<void> {
  expect(rendered(scope)).toEqual(["A", "A", "x", "x", "[A]", "x"]);

  parentStateElement.createState("writable", (s: any) => {
    s["user.name"] = "B";
    s["user.tags"] = [...s["user.tags"], { label: "y" }];
  });
  await settle();
  // the rows were not drawn a second time next to the old ones
  expect(rendered(scope)).toEqual(["B", "B", "x", "x", "y", "y", "[B]", "x", "y"]);

  // one handler run per click, not one per initialization
  const before = log.length;
  (scope.querySelector("button") as HTMLElement).click();
  await settle();
  expect(log.slice(before)).toEqual(["bump"]);
}

describe("#417 / #419 結線の無い（独立した木の）Shadow DOM のコンポーネントの <wcs-state> の差し替え", () => {
  it("差し替えても束縛が生き、描いた値の {{ … }} は束縛にならない", async () => {
    const log: string[] = [];
    const tag = uniqueTag("rg3r-own");
    defineRenderOnce(tag, log, false, { secretLocal: "PRIVATE", name: "A", tags: [{ label: "x" }] });
    const host = document.createElement(uniqueTag("rg3r-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<${tag}></${tag}>`;
    hosts.push(host);
    document.body.appendChild(host);
    const component = shadowRoot.querySelector(tag) as any;
    const scope = component.shadowRoot!;
    await (scope.querySelector("wcs-state") as any).connectedCallbackPromise;
    await settle();
    expect(rendered(scope)).toEqual(["A", "A", "x", "x", "[A]", "x"]);
    component.state.name = "{{ secretLocal }}";
    await settle();

    await swapStateElement(scope);
    expect(log).toEqual(["cc", "dc", "cc"]);
    expect(rendered(scope)).toEqual(["{{ secretLocal }}", "{{ secretLocal }}", "x", "x", "[{{ secretLocal }}]", "x"]);
    component.state.name = "B";
    component.state.tags = [{ label: "y" }];
    await settle();
    expect(rendered(scope)).toEqual(["B", "B", "y", "y", "[B]", "y"]);
    (scope.querySelector("button") as HTMLElement).click();
    await settle();
    expect(log).toEqual(["cc", "dc", "cc", "bump"]);
  });
});

for (const light of [false, true]) {
  const form = light ? "Light DOM" : "Shadow DOM";

  describe(`#418 <wcs-state> の初期化中に移動したマウントのコンポーネント（${form}）`, () => {
    it("（守り。4.0 は準備を要素ごとに 1 回しか走らせない）1 回の接続につき $connectedCallback は 1 回で、束縛が生きている", async () => {
      const log: string[] = [];
      const tag = uniqueTag("rg3r-move");
      defineRenderOnce(tag, log, light);
      const { host, shadowRoot, parentStateElement, component } = createHost(tag);
      document.body.appendChild(host);
      const scope = scopeOf(component, light);
      const childStateElement = scope.querySelector("wcs-state") as any;
      // the inner <wcs-state> still waits for its host's definition and wiring: it disconnects and connects again
      shadowRoot.querySelector("#b")!.appendChild(component);
      await parentStateElement.connectedCallbackPromise;
      await childStateElement.connectedCallbackPromise;
      await settle();

      expect(log).toEqual(["cc"]);
      await expectScopeAlive(scope, parentStateElement, log);
      expect(log).toEqual(["cc", "bump"]);
    });

    it("（守り。4.0 は準備を要素ごとに 1 回しか走らせない）初期化中に外して、別のタスクで入れ直しても、$connectedCallback は 1 回で、束縛が生きている", async () => {
      const log: string[] = [];
      const tag = uniqueTag("rg3r-reinsert");
      defineRenderOnce(tag, log, light);
      // the page's state comes later: the inner <wcs-state> waits for its host's wiring meanwhile
      const { host, shadowRoot, parentStateElement, component } = createHost(tag, true);
      document.body.appendChild(host);
      const scope = scopeOf(component, light);
      const childStateElement = scope.querySelector("wcs-state") as any;
      component.remove();
      await settle();
      shadowRoot.querySelector("#a")!.appendChild(component);
      await settle();
      expect(log).toEqual([]);
      parentStateElement.setInitialState(JSON.parse(JSON_STATE));
      await parentStateElement.connectedCallbackPromise;
      await childStateElement.connectedCallbackPromise;
      await settle();

      expect(log).toEqual(["cc"]);
      await expectScopeAlive(scope, parentStateElement, log);
    });

    it("（守り。修正前も通る）初期化後の切断・再接続は $disconnectedCallback / $connectedCallback が対になる", async () => {
      const { log, shadowRoot, parentStateElement, component, scope } = await mountRenderOnce("rg3r-reconnect", light);
      expect(log).toEqual(["cc"]);

      // a move after initialization, then a removal and a re-insertion
      shadowRoot.querySelector("#b")!.appendChild(component);
      await settle();
      component.remove();
      await settle();
      shadowRoot.querySelector("#a")!.appendChild(component);
      await settle();

      expect(log).toEqual(["cc", "dc", "cc", "dc", "cc"]);
      await expectScopeAlive(scope, parentStateElement, log);
    });
  });

  describe(`#417 / #419 同じ DOM でのマウントのスコープの再初期化（${form}）`, () => {
    it("#417 <wcs-state> だけを差し替えても、同じ DOM の束縛（プロパティ・{{ }}・onclick・for:）が生きている", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { log, parentStateElement, scope } = await mountRenderOnce("rg3r-swap", light);
      expect(rendered(scope)).toEqual(["A", "A", "x", "x", "[A]", "x"]);

      const fresh = await swapStateElement(scope);

      // the old <wcs-state> left, the new one connected
      expect(log).toEqual(["cc", "dc", "cc"]);
      expect(fresh.engine).not.toBeNull();
      await expectScopeAlive(scope, parentStateElement, log);
      expect(error).not.toHaveBeenCalled();
    });

    it("#417 外している間のホストの書き込みも、差し替えた <wcs-state> が接続すると描かれる", async () => {
      const { log, parentStateElement, scope } = await mountRenderOnce("rg3r-swap-away", light);
      const old = scope.querySelector("wcs-state")!;
      old.remove();
      await settle();
      parentStateElement.createState("writable", (s: any) => { s["user.name"] = "C"; });
      await settle();
      expect(rendered(scope)).toEqual(["A", "A", "x", "x", "[A]", "x"]);
      const fresh = document.createElement("wcs-state") as any;
      fresh.setAttribute("bind-component", "state");
      scope.insertBefore(fresh, scope.firstChild);
      await fresh.connectedCallbackPromise;
      await settle();
      expect(log).toEqual(["cc", "dc", "cc"]);
      expect(rendered(scope)).toEqual(["C", "C", "x", "x", "[C]", "x"]);
    });

    it("#419 描いた値の {{ … }} は束縛にならず（文字どおり・私有キーを読まない）、{{ }} の束縛も追随し続ける", async () => {
      // (rows rendered since the mount, showing {{ … }}, are the old engine's: no warning about nodes added since)
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { parentStateElement, scope } = await mountRenderOnce("rg3r-inject", light, { secretLocal: "PRIVATE" });

      // data that looks like markup, rendered by property bindings and {{ }} bindings, in elements, in rows and in the scope root
      const injected = "{{ secretLocal }}";
      parentStateElement.createState("writable", (s: any) => {
        s["user.name"] = injected;
        s["user.tags"] = [{ label: injected }];
      });
      await settle();
      expect(rendered(scope)).toEqual([injected, injected, injected, injected, `[${injected}]`, injected]);

      await swapStateElement(scope);
      expect(rendered(scope)).toEqual([injected, injected, injected, injected, `[${injected}]`, injected]);

      parentStateElement.createState("writable", (s: any) => {
        s["user.name"] = "plain text";
        s["user.tags"] = [{ label: "row text" }];
      });
      await settle();
      expect(rendered(scope)).toEqual(["plain text", "plain text", "row text", "row text", "[plain text]", "row text"]);
      expect(warn).not.toHaveBeenCalled();
    });

    it("（守り）接続したままの 2 つ目の <wcs-state bind-component> は拒み、1 つ目の束縛はそのまま", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { log, parentStateElement, scope } = await mountRenderOnce("rg3r-second", light);
      const second = document.createElement("wcs-state") as any;
      second.setAttribute("bind-component", "state");
      scope.appendChild(second);
      // (it fails to initialize: its connectedCallbackPromise rejects, the report names it, then the error)
      await second.connectedCallbackPromise.catch(() => {});
      await settle();
      expect(error.mock.calls.flat().map((c) => String((c as Error)?.message ?? c)).some((m) => m.includes("already has a connected"))).toBe(true);
      second.remove();
      expect(log).toEqual(["cc"]);
      await expectScopeAlive(scope, parentStateElement, log);
    });

    it("（守り）中身ごと作り直した（<wcs-state> も新しい）なら、新しい中身を束ね、捨てた中身は束ねない", async () => {
      const { log, parentStateElement, scope } = await mountRenderOnce("rg3r-rebuild", light);
      const oldPlain = scope.querySelector(".plain")!;
      const oldButton = scope.querySelector("button")!;
      (scope as Element | ShadowRoot).innerHTML = `<wcs-state bind-component="state"></wcs-state>${SCOPE_TEMPLATE}`;
      await (scope.querySelector("wcs-state") as any).connectedCallbackPromise;
      await settle();
      expect(log).toEqual(["cc", "dc", "cc"]);
      await expectScopeAlive(scope, parentStateElement, log);
      expect(oldPlain.textContent).toBe("A");
      const before = log.length;
      oldButton.click();
      await settle();
      expect(log.length).toBe(before);
    });
  });

  describe(`#417 / #419 中身を描き直したか、<wcs-state> だけを差し替えたかの判定（${form}）`, () => {
    /** Takes out the scope's children but those `keep` keeps (the old <wcs-state> goes), then renders the content again with a new one. */
    async function rerender(scope: Element | ShadowRoot, keep: (n: ChildNode) => boolean): Promise<void> {
      for (const n of [...scope.childNodes]) if (!keep(n)) n.remove();
      const t = document.createElement("template");
      t.innerHTML = `<wcs-state bind-component="state"></wcs-state>${SCOPE_TEMPLATE}`;
      scope.append(t.content);
      await (scope.querySelector("wcs-state") as any).connectedCallbackPromise;
      await settle();
    }

    it("残した <style> は引き継ぐ理由にならない: 描き直した中身を束ねる", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { log, parentStateElement, scope } = await mountRenderOnce("rg3r-style", light, {}, "<style>i { color: red; }</style>");
      await rerender(scope, (n) => n.nodeName === "STYLE");
      expect(scope.querySelectorAll("style")).toHaveLength(1);
      expect(log).toEqual(["cc", "dc", "cc"]);
      await expectScopeAlive(scope, parentStateElement, log);
      expect(warn).not.toHaveBeenCalled();
    });

    it("残した空白だけの Text と束縛の無い要素も、引き継ぐ理由にならない", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { log, parentStateElement, scope } = await mountRenderOnce("rg3r-blank", light, {}, "\n  <p class=\"static\">hello</p>\n  ");
      await rerender(scope, (n) => (n.nodeType === 3 ? n.textContent!.trim() === "" : (n as Element).localName === "p"));
      expect(scope.querySelectorAll(".static")).toHaveLength(1);
      expect(log).toEqual(["cc", "dc", "cc"]);
      await expectScopeAlive(scope, parentStateElement, log);
      expect(warn).not.toHaveBeenCalled();
    });

    it("束縛のある古い中身を残したまま束縛のある中身を足すと、古い中身を引き継ぎ、足した中身は束ねずに警告する", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { log, parentStateElement, scope } = await mountRenderOnce("rg3r-mixed", light);
      scope.querySelector("wcs-state")!.remove();
      const added = document.createElement("p");
      added.className = "added";
      added.setAttribute("data-wcs", "textContent: name");
      const text = document.createTextNode("{{ name }}");
      const fresh = document.createElement("wcs-state") as any;
      fresh.setAttribute("bind-component", "state");
      scope.append(added, text, fresh);
      await fresh.connectedCallbackPromise;
      await settle();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("2 node(s) added beside the content taken over are not bound.");
      expect(log).toEqual(["cc", "dc", "cc"]);
      expect(added.textContent).toBe("");
      expect(text.data).toBe("{{ name }}");
      text.remove();
      await expectScopeAlive(scope, parentStateElement, log);
    });

    it("束縛の無いものを足しただけなら、警告せずに引き継ぐ", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { log, parentStateElement, scope } = await mountRenderOnce("rg3r-plain-add", light);
      scope.querySelector("wcs-state")!.remove();
      const fresh = document.createElement("wcs-state") as any;
      fresh.setAttribute("bind-component", "state");
      const note = document.createElement("small");
      note.textContent = "note";
      scope.append(note, fresh);
      await fresh.connectedCallbackPromise;
      await settle();
      expect(warn).not.toHaveBeenCalled();
      expect(log).toEqual(["cc", "dc", "cc"]);
      await expectScopeAlive(scope, parentStateElement, log);
    });

    it("束縛のある中身がスコープの直下の if: だけ（枝の中身は静的）でも引き継ぎ、条件の束縛が生きている", async () => {
      const tag = uniqueTag("rg3r-if");
      const log: string[] = [];
      customElements.define(tag, class extends HTMLElement {
        state: Record<string, any> = { $connectedCallback() { log.push("cc"); }, $disconnectedCallback() { log.push("dc"); } };
        constructor() {
          super();
          if (!light) this.attachShadow({ mode: "open" });
        }
        connectedCallback() {
          const root: ParentNode = light ? this : this.shadowRoot!;
          if (root.firstChild === null) {
            (root as Element | ShadowRoot).innerHTML = `<wcs-state bind-component="state"></wcs-state><template data-wcs="if: name"><s>shown</s></template>`;
          }
        }
      });
      const { host, shadowRoot, parentStateElement, component } = createHost(tag);
      document.body.appendChild(host);
      await parentStateElement.connectedCallbackPromise;
      await getBindingsReady(shadowRoot);
      const scope = scopeOf(component, light);
      await (scope.querySelector("wcs-state") as any).initializePromise;
      await settle();
      const shown = () => Array.from(scope.children).filter((e) => e.localName === "s").map((e) => e.textContent);
      expect(shown()).toEqual(["shown"]);
      await swapStateElement(scope);
      expect(log).toEqual(["cc", "dc", "cc"]);
      expect(shown()).toEqual(["shown"]);
      parentStateElement.createState("writable", (s: any) => { s["user.name"] = ""; });
      await settle();
      expect(shown()).toEqual([]);
      parentStateElement.createState("writable", (s: any) => { s["user.name"] = "B"; });
      await settle();
      expect(shown()).toEqual(["shown"]);
    });

    it("続けて 2 回差し替えても引き継ぎ、古い <wcs-state> はもう状態に届かない", async () => {
      const { log, parentStateElement, scope } = await mountRenderOnce("rg3r-twice", light);
      const first = scope.querySelector("wcs-state") as any;
      await swapStateElement(scope);
      await swapStateElement(scope);
      expect(log).toEqual(["cc", "dc", "cc", "dc", "cc"]);
      await expectScopeAlive(scope, parentStateElement, log);
      expect(first.engine).toBeNull();
      expect(() => first.createState("writable", (s: any) => { s.name = "X"; })).toThrow();
    });
  });

  describe(`#417 差し替えた <wcs-state> は、引き継いだ時点で束縛ができたことになる（${form}）`, () => {
    it("終わらない $connectedCallback を待たずに initializePromise（Shadow DOM では getBindingsReady も）が resolve する", async () => {
      let n = 0;
      const { parentStateElement, scope, log } = await mountRenderOnce("rg3r-built", light, {
        $connectedCallback() { if (++n > 1) return new Promise(() => {}); },
      });
      const fresh = swapRaw(scope);
      await fresh.initializePromise;
      if (!light) await getBindingsReady(scope);
      expect(await settled(fresh.connectedCallbackPromise)).toBe("pending");
      await expectScopeAlive(scope, parentStateElement, log);
    });

    it("$connectedCallback が投げると「$connectedCallback failed.」（#50。初期化の失敗の #49 ではない）と報告して reject し、getBindingsReady は resolve のまま", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      let n = 0;
      const { parentStateElement, scope, log } = await mountRenderOnce("rg3r-built-throw", light, {
        $connectedCallback() { if (++n > 1) throw boom; },
      });
      const fresh = swapRaw(scope);
      await expect(fresh.connectedCallbackPromise).rejects.toBe(boom);
      await expect(fresh.initializePromise).resolves.toBeUndefined();
      if (!light) await expect(getBindingsReady(scope)).resolves.toBeUndefined();
      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0][0])).toContain("#50");
      expect(error.mock.calls[0][1]).toBe(boom);
      await expectScopeAlive(scope, parentStateElement, log);
    });
  });

  describe(`マウントは作った時点から要素のもの（$connectedCallback の途中・失敗・初期化中の切断）（${form}）`, () => {
    it("$connectedCallback が投げても、外せば $disconnectedCallback が走り、ホストの書き込みはもう届かない", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const events: string[] = [];
      const { parentStateElement, component, scope } = await mountRenderOnce("rg3r-cc-throw", light, {
        $connectedCallback() { events.push("cc"); throw boom; },
        $disconnectedCallback() { events.push("dc"); },
      });
      expect(error).toHaveBeenCalled();
      component.remove();
      await settle();
      expect(events).toEqual(["cc", "dc"]);
      parentStateElement.createState("writable", (s: any) => { s["user.name"] = "Z"; });
      await settle();
      expect(scope.querySelector(".plain")!.textContent).toBe("A");
    });

    it("初期化中に外すと、外れたまま着地した初期化は $connectedCallback を呼ばず、入れ直すと 1 回呼ぶ", async () => {
      const log: string[] = [];
      const tag = uniqueTag("rg3r-late");
      const { host, shadowRoot, parentStateElement, component } = createHost(tag);
      document.body.appendChild(host);
      await parentStateElement.connectedCallbackPromise;
      await getBindingsReady(shadowRoot);
      // defined now: it renders and its <wcs-state> starts to initialize, then it is taken out
      defineRenderOnce(tag, log, light);
      const scope = scopeOf(component, light);
      const childStateElement = scope.querySelector("wcs-state") as any;
      component.remove();
      await childStateElement.initializePromise;
      await settle();
      expect(log).toEqual([]);
      shadowRoot.querySelector("#a")!.appendChild(component);
      await settle();
      expect(log).toEqual(["cc"]);
      await expectScopeAlive(scope, parentStateElement, log);
      component.remove();
      await settle();
      expect(log).toEqual(["cc", "bump", "dc"]);
    });

    it("<wcs-state> を差し替えた直後に外すと、外れたまま引き継ぎ $connectedCallback を呼ばず、入れ直すと 1 回呼ぶ", async () => {
      const { log, shadowRoot, parentStateElement, component, scope } = await mountRenderOnce("rg3r-swap-out", light);
      const fresh = swapRaw(scope);
      component.remove();
      await fresh.connectedCallbackPromise;
      await settle();
      expect(log).toEqual(["cc", "dc"]);
      shadowRoot.querySelector("#a")!.appendChild(component);
      await settle();
      expect(log).toEqual(["cc", "dc", "cc"]);
      await expectScopeAlive(scope, parentStateElement, log);
    });

    it("中身の誤り（知らないフィルタ）で初期化に失敗したマウントは、外しても入れ直しても $connectedCallback / $disconnectedCallback を呼ばず、外している間はホストの書き込みが届かない（つながっている間は誤りの前に束ねた分が追従する — #384）", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const log: string[] = [];
      const tag = uniqueTag("rg3r-bad-markup");
      customElements.define(tag, class extends HTMLElement {
        state: Record<string, any> = { $connectedCallback() { log.push("cc"); }, $disconnectedCallback() { log.push("dc"); } };
        constructor() {
          super();
          if (!light) this.attachShadow({ mode: "open" });
        }
        connectedCallback() {
          const root: ParentNode = light ? this : this.shadowRoot!;
          if (root.firstChild === null) {
            (root as Element | ShadowRoot).innerHTML = `<wcs-state bind-component="state"></wcs-state><i class="ok">{{ name }}</i><p data-wcs="textContent: name|nope"></p>`;
          }
        }
      });
      const { host, shadowRoot, parentStateElement, component } = createHost(tag);
      document.body.appendChild(host);
      await parentStateElement.connectedCallbackPromise;
      await getBindingsReady(shadowRoot);
      const scope = scopeOf(component, light);
      await expect((scope.querySelector("wcs-state") as any).connectedCallbackPromise).rejects.toThrow();
      await settle();
      expect(error).toHaveBeenCalled();
      const ok = scope.querySelector(".ok")!;
      const write = async (name: string): Promise<void> => {
        parentStateElement.createState("writable", (s: any) => { s["user.name"] = name; });
        await settle();
      };
      await write("B");
      expect(ok.textContent).toBe("B");
      component.remove();
      await settle();
      await write("C");
      expect(ok.textContent).toBe("B");
      shadowRoot.querySelector("#a")!.appendChild(component);
      await settle();
      expect(ok.textContent).toBe("C");
      await write("D");
      expect(ok.textContent).toBe("D");
      expect(log).toEqual([]);
    });

    it.each(["throw", "reject"])("再接続の $connectedCallback が失敗すると（%s）、console.error に報告し、捕まらない例外・扱われない reject にしない", async (how) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const unhandled: unknown[] = [];
      const onRejection = (e: unknown): void => { unhandled.push(e); };
      process.on("unhandledRejection", onRejection);
      try {
        let n = 0;
        const { shadowRoot, component } = await mountRenderOnce("rg3r-recc-fail", light, {
          $connectedCallback() {
            if (++n === 1) return;
            if (how === "throw") throw boom;
            return Promise.reject(boom);
          },
        });
        component.remove();
        await settle();
        expect(() => shadowRoot.querySelector("#a")!.appendChild(component)).not.toThrow();
        await settle();
      } finally {
        process.off("unhandledRejection", onRejection);
      }
      expect(error.mock.calls).toEqual([[boom]]);
      expect(unhandled).toEqual([]);
    });

    it("古い $connectedCallback の途中で <wcs-state> を差し替えても、$disconnectedCallback を挟まずに $connectedCallback が 2 回続かない", async () => {
      const events: string[] = [];
      const { parentStateElement, scope, log } = await mountRenderOnce("rg3r-cc-pending", light, {
        $connectedCallback() { events.push("cc"); if (events.length === 1) return new Promise(() => {}); },
        $disconnectedCallback() { events.push("dc"); },
      });
      expect(events).toEqual(["cc"]);
      await swapStateElement(scope);
      expect(events).toEqual(["cc", "dc", "cc"]);
      await expectScopeAlive(scope, parentStateElement, log);
    });
  });
}
