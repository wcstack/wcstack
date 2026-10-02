/**
 * A mounted component whose content stays in place while its `<wcs-state bind-component>` initializes
 * again.
 *
 * - Moved while its `<wcs-state>` is still initializing: the element is not initialized yet, so the second
 *   connect prepares it again. The first, stale preparation used to go on as well — the scope was
 *   initialized twice and `$connectedCallback` ran twice for one connection. The newer connect now owns
 *   the preparation (connection generation).
 * - A component that swaps only its `<wcs-state>`: a real re-initialization on the same DOM.
 *   `initializeMountScope` disposes the scope's binding session, and the collection skips the nodes it
 *   bound before (they are registered already), so the scope's own bindings stayed dead. The nodes still
 *   in the scope are now bound again; the bindings of a discarded DOM stay disposed, even when no
 *   MutationObserver retired them first. The mustache conversion, run again over the rendered scope, read
 *   a `{{ … }}` in rendered data as markup (it bound it, private keys included, and replaced the anchor of
 *   the `{{ }}` binding that rendered it); rendered text is now left alone.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { BindingSession } from "../src/bindings/BindingSession";
import { buildMountRecord } from "../src/webComponent/mount";
import { initializeMountScope } from "../src/webComponent/mountScope";
import { getBindingsByNode } from "../src/bindings/getBindingsByNode";

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));
const settle = async () => {
  for (let i = 0; i < 4; i++) await flush();
};

let counter = 0;
const uniqueTag = (prefix: string): string => `${prefix}-${++counter}`;

const SCOPE_TEMPLATE =
  `<span class="plain" data-wcs="textContent: name"></span>` +
  `<i class="mustache">{{ name }}</i>` +
  `<button data-wcs="onclick: bump"></button>` +
  `<ul><template data-wcs="for: tags"><li data-wcs="textContent: .label"></li><b>{{ .label }}</b></template></ul>`;

/**
 * A component that renders its content once (on the first connect), in its shadow root or light DOM.
 * `log` records the mounted state's lifecycle (`cc` / `dc`) and the button's handler (`bump`).
 */
function defineRenderOnce(tag: string, log: string[], light = false, own: Record<string, any> = {}): void {
  class RenderOnce extends HTMLElement {
    state: Record<string, any> = {
      ...own,
      bump() { log.push("bump"); },
      $connectedCallback() { log.push("cc"); },
      $disconnectedCallback() { log.push("dc"); },
    };
    constructor() {
      super();
      if (!light) this.attachShadow({ mode: "open" });
    }
    connectedCallback() {
      const root: ParentNode = light ? this : this.shadowRoot!;
      if (root.firstChild === null) {
        (root as Element | ShadowRoot).innerHTML = `<wcs-state bind-component="state"></wcs-state>${SCOPE_TEMPLATE}`;
      }
    }
  }
  customElements.define(tag, RenderOnce);
}

const JSON_STATE = '{"user":{"name":"A","tags":[{"label":"x"}]}}';

function createHost(componentTag: string) {
  const host = document.createElement(uniqueTag("msr-host"));
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML =
    `<wcs-state json='${JSON_STATE}'></wcs-state>` +
    `<div id="a"><${componentTag} data-wcs="state: user"></${componentTag}></div><div id="b"></div>`;
  const parentStateElement = shadowRoot.querySelector("wcs-state") as State;
  const component = shadowRoot.querySelector(componentTag)!;
  return { host, shadowRoot, parentStateElement, component };
}

/** Mounts a render-once component and waits until its scope is built */
async function mountRenderOnce(prefix: string, light: boolean, own: Record<string, any> = {}) {
  const log: string[] = [];
  const tag = uniqueTag(prefix);
  defineRenderOnce(tag, log, light, own);
  const { host, shadowRoot, parentStateElement, component } = createHost(tag);
  document.body.appendChild(host);
  const scope: ParentNode = light ? component : component.shadowRoot!;
  await parentStateElement.connectedCallbackPromise;
  await (scope.querySelector("wcs-state") as State).connectedCallbackPromise;
  await settle();
  return { log, host, shadowRoot, parentStateElement, component, scope };
}

/** Replaces the scope's `<wcs-state bind-component>` with a fresh one, keeping the rest of the DOM */
async function swapStateElement(scope: ParentNode): Promise<void> {
  const fresh = document.createElement("wcs-state") as State;
  fresh.setAttribute("bind-component", "state");
  scope.querySelector("wcs-state")!.replaceWith(fresh);
  await fresh.connectedCallbackPromise;
  await settle();
}

/** The scope's rendered text: the property binding, the `{{ }}` binding, then each row's two bindings */
const rendered = (scope: ParentNode): (string | null)[] => [
  scope.querySelector(".plain")!.textContent,
  scope.querySelector(".mustache")!.textContent,
  ...Array.from(scope.querySelectorAll("li, b")).map((node) => node.textContent),
];

/** Checks every binding kind of the scope against the tree, including after writes */
async function expectScopeAlive(scope: ParentNode, parentStateElement: State, log: string[]): Promise<void> {
  expect(rendered(scope)).toEqual(["A", "A", "x", "x"]);

  parentStateElement.createState("writable", (s: any) => {
    s["user.name"] = "B";
    s["user.tags"] = [...s["user.tags"], { label: "y" }];
  });
  await settle();
  // the rows were not drawn a second time next to the old ones
  expect(rendered(scope)).toEqual(["B", "B", "x", "x", "y", "y"]);

  // one listener on the button, not one per initialization
  const before = log.length;
  (scope.querySelector("button") as HTMLElement).dispatchEvent(new Event("click"));
  await settle();
  expect(log.slice(before)).toEqual(["bump"]);
}

for (const light of [false, true]) {
  const form = light ? "Light DOM" : "Shadow DOM";
  const scopeOf = (component: Element): ParentNode => light ? component : component.shadowRoot!;

  describe(`<wcs-state> の初期化中に移動したマウントコンポーネント（${form}）`, () => {
    it("1 回の接続につき準備も $connectedCallback も 1 回で、バインディングが生きていること", async () => {
      const log: string[] = [];
      const tag = uniqueTag("msr-move");
      defineRenderOnce(tag, log, light);
      const { host, shadowRoot, parentStateElement, component } = createHost(tag);
      document.body.appendChild(host);
      const childStateElement = scopeOf(component).querySelector("wcs-state") as State;
      // the inner <wcs-state> still awaits the host binding: it connects a second time, not initialized yet
      shadowRoot.querySelector("#b")!.appendChild(component);
      await parentStateElement.connectedCallbackPromise;
      await childStateElement.connectedCallbackPromise;
      await settle();

      expect(log).toEqual(["cc"]);
      await expectScopeAlive(scopeOf(component), parentStateElement, log);
      expect(log).toEqual(["cc", "bump"]);
      host.remove();
    });

    it("（守り。修正前も通る）初期化後の切断・再接続は $disconnectedCallback / $connectedCallback が対になること", async () => {
      const { log, host, shadowRoot, parentStateElement, component, scope } = await mountRenderOnce("msr-reconnect", light);
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
      host.remove();
    });
  });

  describe(`同じ DOM でのマウントスコープの再初期化（${form}）`, () => {
    it("<wcs-state> だけを差し替えて再初期化しても、同じ DOM のバインディングが生きていること", async () => {
      const { log, host, parentStateElement, scope } = await mountRenderOnce("msr-swap", light);
      expect(rendered(scope)).toEqual(["A", "A", "x", "x"]);

      await swapStateElement(scope);

      // the old <wcs-state> left, the new one connected
      expect(log).toEqual(["cc", "dc", "cc"]);
      await expectScopeAlive(scope, parentStateElement, log);
      host.remove();
    });

    it("描いた値の {{ … }} は束縛にならず（文字どおり・私有キーを読まない）、{{ }} の束縛も追随し続けること", async () => {
      const { host, parentStateElement, scope } = await mountRenderOnce("msr-inject", light, { secretLocal: "PRIVATE" });

      // data that looks like markup, rendered by property bindings and {{ }} bindings, in the scope and in a row
      const injected = "{{ secretLocal }}";
      parentStateElement.createState("writable", (s: any) => {
        s["user.name"] = injected;
        s["user.tags"] = [{ label: injected }];
      });
      await settle();
      expect(rendered(scope)).toEqual([injected, injected, injected, injected]);

      await swapStateElement(scope);
      expect(rendered(scope)).toEqual([injected, injected, injected, injected]);

      parentStateElement.createState("writable", (s: any) => {
        s["user.name"] = "plain text";
        s["user.tags"] = [{ label: "row text" }];
      });
      await settle();
      expect(rendered(scope)).toEqual(["plain text", "plain text", "row text", "row text"]);
      host.remove();
    });
  });
}

describe("同じ DOM でのマウントスコープの再初期化（失敗と捨てた DOM）", () => {
  it("張り直しに失敗した binding は握りつぶさずに報告し、残りは張り直すこと", async () => {
    const { host, parentStateElement, scope } = await mountRenderOnce("msr-fail", false);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // the first binding the restart reaches (the .plain span) fails to start again
    const start = vi.spyOn(BindingSession.prototype as any, "start").mockImplementationOnce(() => {
      throw new Error("restart failed");
    });
    try {
      await swapStateElement(scope);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("failed to start again on the mount scope's re-initialization"),
        expect.objectContaining({ message: "restart failed" }),
      );

      parentStateElement.createState("writable", (s: any) => { s["user.name"] = "B"; });
      await settle();
      expect(scope.querySelector(".plain")!.textContent).toBe("A");
      expect(scope.querySelector(".mustache")!.textContent).toBe("B");
    } finally {
      start.mockRestore();
      error.mockRestore();
    }
    host.remove();
  });

  it("（守り。修正前も通る）MutationObserver が外れたノードを知らせなくても、捨てられた DOM のバインディングは再初期化で生き返らないこと", async () => {
    const calls: string[] = [];
    const tag = uniqueTag("msr-wipe");
    customElements.define(tag, class extends HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: "open" });
      }
    });
    const host = document.createElement(uniqueTag("msr-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<wcs-state json='${JSON_STATE}'></wcs-state><${tag} data-wcs="state: user"></${tag}>`;
    document.body.appendChild(host);
    const parentStateElement = shadowRoot.querySelector("wcs-state") as State;
    await parentStateElement.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    await settle();
    const component = shadowRoot.querySelector(tag)!;
    const scope = component.shadowRoot!;
    const template = `<span class="plain" data-wcs="textContent: name"></span><button data-wcs="onclick: bump"></button>`;
    scope.innerHTML = template;
    const hostBindings = (getBindingsByNode(component) ?? []).filter((b) => b.propSegments[0] === "state");
    const record = buildMountRecord(component, "state", hostBindings, parentStateElement as any, {
      bump() { calls.push("bump"); },
    });
    // the scope's owner is created without an observer: only the re-initialization retires the old nodes
    vi.stubGlobal("MutationObserver", undefined);
    try {
      initializeMountScope(record, scope);
    } finally {
      vi.unstubAllGlobals();
    }
    const oldSpan = scope.querySelector(".plain")!;
    const oldButton = scope.querySelector("button")!;
    expect(oldSpan.textContent).toBe("A");

    // new content: the old nodes are not in the scope any more
    scope.innerHTML = template;
    initializeMountScope(record, scope);
    parentStateElement.createState("writable", (s: any) => { s["user.name"] = "B"; });
    await settle();

    expect(scope.querySelector(".plain")!.textContent).toBe("B");
    expect(oldSpan.textContent).toBe("A");
    oldButton.dispatchEvent(new Event("click"));
    (scope.querySelector("button") as HTMLElement).dispatchEvent(new Event("click"));
    await settle();
    expect(calls).toEqual(["bump"]);
    host.remove();
  });
});
