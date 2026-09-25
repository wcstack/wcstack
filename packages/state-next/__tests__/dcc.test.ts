import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, scopes } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([scopes]);
  bootstrapState();
});

/**
 * A definition host built with the DOM API (happy-dom has no declarative shadow DOM, and cannot
 * import an inline module script): the state is handed to each <wcs-state> by setInitialState.
 */
async function defineComponent(markup: string, state: () => Record<string, any>, tag = `my-dcc-${seq++}`) {
  const def = document.createElement(tag);
  def.setAttribute("data-wc-definition", "");
  const shadow = def.attachShadow({ mode: "open" });
  shadow.innerHTML = `${markup}<wcs-state></wcs-state>`;
  (shadow.querySelector("wcs-state") as any).setInitialState(state());
  document.body.appendChild(def);
  await (shadow.querySelector("wcs-state") as any).connectedCallbackPromise;
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
  return { tag, create };
}

const counter = () => ({
  count: 0,
  user: { name: "a" },
  get doubled() { return (this as any).count * 2; },
  increment(this: any) { this.count++; return this.count; },
  bumpBy(this: any, step: number) { this.count += step; },
  $bindables: ["count", "user"],
  $commands: ["bumpBy"],
});

describe("DCC", () => {
  it("定義からタグができ、インスタンスごとに自分の状態で描く", async () => {
    const { create } = await defineComponent(`<p>{{ count }}|{{ doubled }}</p>`, counter);
    const a = await create();
    const b = await create();
    a.count = 3;
    await flush();
    expect(a.shadowRoot.querySelector("p").textContent).toBe("3|6");
    expect(b.shadowRoot.querySelector("p").textContent).toBe("0|0");
    expect(a.doubled).toBe(6);
  });

  it("メソッドは Promise を返し、状態の this で動く", async () => {
    const { create } = await defineComponent(`<p>{{ count }}</p>`, counter);
    const el = await create();
    await expect(el.increment()).resolves.toBe(1);
    await flush();
    expect(el.shadowRoot.querySelector("p").textContent).toBe("1");
  });

  it("初期化の前の書き込みは待たされ、初期化の後に入る", async () => {
    const { tag } = await defineComponent(`<p>{{ count }}</p>`, counter);
    const el = document.createElement(tag) as any;
    document.body.appendChild(el);
    el.count = 7;
    const inner = el.stateElement;
    inner.setInitialState(counter());
    await inner.connectedCallbackPromise;
    await flush();
    expect(el.count).toBe(7);
  });

  it("$bindables / $commands は wcBindable になり、変更で <tag>:<prop>-changed を出す（下のパスへの書き込みも。detail は本体への書き込みだけ）", async () => {
    const { tag, create } = await defineComponent(`<p>{{ count }}</p>`, counter);
    const cls = customElements.get(tag) as any;
    expect(cls.wcBindable).toEqual({
      protocol: "wc-bindable", version: 1,
      properties: [{ name: "count", event: `${tag}:count-changed`, getter: expect.any(Function) }, { name: "user", event: `${tag}:user-changed`, getter: expect.any(Function) }],
      inputs: [{ name: "count" }, { name: "user" }],
      commands: [{ name: "bumpBy", async: true }],
    });
    const el = await create();
    const seen: string[] = [];
    const property = (e: Event) => cls.wcBindable.properties.find((p: any) => e.type === p.event).getter(e);
    el.addEventListener(`${tag}:count-changed`, (e: CustomEvent) => seen.push(`count=${e.detail}/${property(e)}`));
    el.addEventListener(`${tag}:user-changed`, (e: CustomEvent) => seen.push(`user=${e.detail}/${property(e).name}`));
    el.count = 4;
    el.stateElement.createState("writable", (s: any) => { s["user.name"] = "b"; s.$postUpdate("count"); });
    expect(seen).toEqual(["count=4/4", "user=null/b", "count=null/4"]);
    const bubbled: string[] = [];
    document.body.addEventListener(`${tag}:count-changed`, (e) => bubbled.push(e.type), { once: true });
    el.count = 5;
    expect(bubbled).toEqual([`${tag}:count-changed`]);
  });

  it("親の状態と双方向に結び、command token でメソッドを呼べる", async () => {
    const { tag } = await defineComponent(`<p>{{ count }}</p>`, counter);
    const h = document.createElement(`dcc-parent-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state><${tag} data-wcs="count: parentCount; command.bumpBy: $command.bump"></${tag}><div>{{ parentCount }}</div>`;
    const el = root.querySelector(tag) as any;
    const parentState = root.querySelector("wcs-state") as any;
    parentState.setInitialState({ parentCount: 5, $commandTokens: ["bump"], fire(this: any) { this.$command.bump.emit(3); } });
    el.stateElement.setInitialState(counter());
    document.body.appendChild(h);
    await parentState.connectedCallbackPromise;
    await el.stateElement.connectedCallbackPromise;
    await flush();
    expect(el.count).toBe(5);
    await el.increment();
    await flush();
    expect(root.querySelector("div")!.textContent).toBe("6");
    parentState.createState("writable", (s: any) => { s.fire(); });
    await flush();
    await flush();
    expect(el.count).toBe(9);
    expect(root.querySelector("div")!.textContent).toBe("9");
  });

  it.each([
    [{ a: 1, $bindables: "a" }, "$bindables must be an array"],
    [{ a: 1, $bindables: ["a", "a"] }, 'entry "a" is duplicated'],
    [{ a: 1, $bindables: ["$x"] }, "internal ($) members are never exposed"],
    [{ a: 1, $bindables: ["nope"] }, 'entry "nope" does not exist on the state'],
    [{ f() {}, $bindables: ["f"] }, 'entry "f" is a method'],
    [{ a: 1, $commands: ["a"] }, 'entry "a" is not a method'],
  ])("$bindables / $commands の違反は定義しない（%#）", async (state, message) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { tag } = await defineComponent(``, () => state);
    expect(customElements.get(tag)).toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining(message) }));
    error.mockRestore();
  });

  it("カスタム要素名でないホストと、定義済みのタグは報告する", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await defineComponent(``, () => ({ a: 1 }), "section");
    const { tag } = await defineComponent(``, () => ({ a: 1 }));
    // a second definition host of the tag: an upgraded instance, whose own shadow is its definition
    const again = document.createElement(tag);
    again.setAttribute("data-wc-definition", "");
    const sr = again.attachShadow({ mode: "open" });
    sr.innerHTML = `<wcs-state></wcs-state>`;
    (sr.querySelector("wcs-state") as any).setInitialState({ a: 2 });
    document.body.appendChild(again);
    await (sr.querySelector("wcs-state") as any).connectedCallbackPromise;
    const messages = error.mock.calls.map((c) => String((c[0] as Error)?.message ?? c[0]));
    expect(messages.some((m) => m.includes("not a valid custom element name"))).toBe(true);
    expect(messages.some((m) => m.includes("is already defined"))).toBe(true);
    error.mockRestore();
  });
});
