import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getDefinitionCoordinator } from "../src/bindings/DefinitionCoordinator";

beforeAll(() => {
  bootstrapState();
});

let counter = 0;
function uniqueTag(prefix: string): string {
  return `${prefix}-${++counter}`;
}

async function flushUpdates(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

/** 後から定義される要素（integration.spreadDeferredTemplate.test.ts と同じ形） */
function greetClass(tag: string): CustomElementConstructor {
  return class extends HTMLElement {
    static wcBindable = {
      protocol: "wc-bindable",
      version: 1,
      properties: [{ name: "status", event: `${tag}:status` }],
      inputs: [{ name: "name" }],
    };
    set name(v: unknown) {
      (this as any)._n = v;
      this.textContent = `hello ${v}`;
    }
    get name(): unknown { return (this as any)._n; }
    get status(): unknown { return "ready"; }
  };
}

/**
 * 1 つのタグだけ「後から定義される」registry（integration.spreadDeferredTemplate.test.ts の注記のとおり、
 * happy-dom の本物の define では同じノードへの適用を確かめられないので、要素の registry の口に差し込む）。
 * ブラウザは定義済みのタグの要素を文書に差し込んだ時点で upgrade するので、定義の後に文書の中で
 * registry を引かれた要素は upgrade しておく（外したまま定義した要素を戻す形のため）。
 */
function lateRegistry(tag: string) {
  const cls = greetClass(tag);
  let defined = false;
  let resolve!: (c: CustomElementConstructor) => void;
  const promise = new Promise<CustomElementConstructor>((r) => { resolve = r; });
  const registry = {
    get: (name: string) => (name === tag ? (defined ? cls : undefined) : customElements.get(name)),
    whenDefined: (name: string) => (name === tag ? promise : customElements.whenDefined(name)),
    upgrade: (root: Node) => {
      if (defined && (root as Element).localName === tag) Object.setPrototypeOf(root, cls.prototype);
    },
  };
  Object.defineProperty(HTMLElement.prototype, "customElementRegistry", {
    configurable: true,
    get(this: Element) {
      if (this.localName !== tag) return undefined;
      if (this.isConnected) registry.upgrade(this);
      return registry;
    },
  });
  return {
    define(): void { defined = true; resolve(cls); },
    /** この registry で定義を待っている数 */
    pending(): number { return getDefinitionCoordinator(registry).pendingCount(tag); },
  };
}

async function mount(html: string) {
  const host = document.createElement(uniqueTag("x-reconnect-host"));
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = html;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  await flushUpdates();
  return { host, shadowRoot, stateEl };
}

async function write(stateEl: State, fn: (state: any) => void): Promise<void> {
  stateEl.createState("writable", fn);
  await flushUpdates();
}

function texts(root: ParentNode, selector: string): (string | null)[] {
  return Array.from(root.querySelectorAll(selector)).map((node) => node.textContent);
}

/** 要素をいったん DOM の外（切り離した要素）へ退避する。戻す関数を返す（タブ・パネルの DOM 退避の形） */
async function detach(el: Element): Promise<() => Promise<void>> {
  const parent = el.parentNode!;
  const next = el.nextSibling;
  document.createElement("div").append(el);
  await flushUpdates();
  return async () => {
    parent.insertBefore(el, next);
    await flushUpdates();
  };
}

const JSON_LATE = `{"late":[{"name":"a"},{"name":"b"}],"one":{"name":"z"}}`;

function html(tag: string, rowBind: string, rootBind: string): string {
  return `
    <wcs-state json='${JSON_LATE}'></wcs-state>
    <ul id="late"><template data-wcs="for: late"><li><${tag} data-wcs="${rowBind}"></${tag}></li></template></ul>
    <div id="rootlate"><${tag} data-wcs="${rootBind}"></${tag}></div>
    <div id="other"></div>
  `;
}

/**
 * #352: 未定義の要素への束縛の定義待ちは、待つ間に要素を DOM から外して戻すと取り消されたままになり、
 * 定義しても値が入らなかった。外れたときに registry の待ちを下ろすのはそのまま（戻らない要素を掴まない）、
 * 戻ったら待ち直す — spread は下ろした待ちを張り直し、行のプロパティの束縛は適用し直す。
 */
describe("定義待ちの間に外して戻した要素（#352）", () => {
  afterEach(() => {
    delete (HTMLElement.prototype as any).customElementRegistry;
  });

  it("spread（行・ルート）: 外して戻してから定義すると展開され、書き込みに追従すること", async () => {
    const tag = uniqueTag("x-late");
    const late = lateRegistry(tag);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { host, shadowRoot, stateEl } = await mount(html(tag, "...: .", "...: one"));
    expect(late.pending()).toBe(3);

    const restoreList = await detach(shadowRoot.getElementById("late")!);
    const restoreRoot = await detach(shadowRoot.getElementById("rootlate")!);
    // 外れている間は registry に待ちを残さない
    expect(late.pending()).toBe(0);
    await restoreList();
    await restoreRoot();
    expect(late.pending()).toBe(3);

    late.define();
    await flushUpdates();
    expect(texts(shadowRoot, `#late ${tag}`)).toEqual(["hello a", "hello b"]);
    expect(texts(shadowRoot, `#rootlate ${tag}`)).toEqual(["hello z"]);

    await write(stateEl, (s) => { s["late.0.name"] = "A"; s["one.name"] = "Z"; });
    expect(texts(shadowRoot, `#late ${tag}`)).toEqual(["hello A", "hello b"]);
    expect(texts(shadowRoot, `#rootlate ${tag}`)).toEqual(["hello Z"]);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
    host.remove();
  });

  it("行のプロパティの束縛: 外して戻してから定義すると、書き込まない行にも値が入ること", async () => {
    const tag = uniqueTag("x-late");
    const late = lateRegistry(tag);
    const { host, shadowRoot, stateEl } = await mount(html(tag, "name: .name", "name: one.name"));

    const restoreList = await detach(shadowRoot.getElementById("late")!);
    const restoreRoot = await detach(shadowRoot.getElementById("rootlate")!);
    expect(late.pending()).toBe(0);
    await restoreList();
    await restoreRoot();

    late.define();
    await flushUpdates();
    expect(texts(shadowRoot, `#late ${tag}`)).toEqual(["hello a", "hello b"]);
    expect(texts(shadowRoot, `#rootlate ${tag}`)).toEqual(["hello z"]);

    await write(stateEl, (s) => { s["late.0.name"] = "A"; });
    expect(texts(shadowRoot, `#late ${tag}`)).toEqual(["hello A", "hello b"]);
    host.remove();
  });

  it("同じツリーの別の場所へ時間をおいて移しても、定義後に値が入ること", async () => {
    const tag = uniqueTag("x-late");
    const late = lateRegistry(tag);
    const { host, shadowRoot } = await mount(html(tag, "...: .", "name: one.name"));
    const other = shadowRoot.getElementById("other")!;

    const list = shadowRoot.getElementById("late")!;
    const rootBox = shadowRoot.getElementById("rootlate")!;
    await detach(list);
    await detach(rootBox);
    other.append(list, rootBox);
    await flushUpdates();

    late.define();
    await flushUpdates();
    expect(texts(other, `#late ${tag}`)).toEqual(["hello a", "hello b"]);
    expect(texts(other, `#rootlate ${tag}`)).toEqual(["hello z"]);
    host.remove();
  });

  it("外したまま定義しても値は入らず待ちも残らない。定義の後に戻すと値が入ること", async () => {
    const tag = uniqueTag("x-late");
    const late = lateRegistry(tag);
    const { host, shadowRoot } = await mount(html(tag, "...: .", "name: one.name"));
    const list = shadowRoot.getElementById("late")!;
    const rootBox = shadowRoot.getElementById("rootlate")!;

    const restoreList = await detach(list);
    const restoreRoot = await detach(rootBox);
    expect(late.pending()).toBe(0);
    late.define();
    await flushUpdates();
    expect(texts(list, tag)).toEqual(["", ""]);
    expect(texts(rootBox, tag)).toEqual([""]);

    await restoreList();
    await restoreRoot();
    expect(texts(shadowRoot, `#late ${tag}`)).toEqual(["hello a", "hello b"]);
    expect(texts(shadowRoot, `#rootlate ${tag}`)).toEqual(["hello z"]);
    host.remove();
  });
});
