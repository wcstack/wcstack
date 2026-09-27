/**
 * #331: bind-component でマウントしたコンポーネントのメソッドを公開面（`element.state`）から
 * 取り出して呼ぶと、イベントから呼んだのと同じ文脈（書き込み可能なセッション・ホストの
 * ループ文脈）で実行されること。
 *
 * 公開面の読みは読み取り専用のセッションで値を読み、メソッドはオーバーレイがその読み取り専用の
 * 文脈に束ねて返していた。そのため私有キーの書き込みは親ウォークへ回らず描き直されず、
 * ツリーのキーの書き込みは `This state is readonly.` で投げ、行マウントではツリーのキーの読みも
 * `ListIndex not found` で投げた（v1.33.0 では動き、v2.0.0 から壊れていた）。
 *
 * あわせて、行マウントの async メソッドが await の後にツリーのキーを読み書きすると、ループ文脈が
 * 外れていて `ListIndex not found` で投げていた（イベントから呼んだ場合も同じ）。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";

beforeAll(() => {
  bootstrapState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const flush = () => new Promise((r) => setTimeout(r));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await flush();
};

let counter = 0;
const uniqueTag = (prefix: string): string => `${prefix}-${++counter}`;

function defineComponent(tag: string, createState: () => Record<string, any>, innerTemplate: string): void {
  class Component extends HTMLElement {
    state: Record<string, any> = createState();
    constructor() {
      super();
      this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state>${innerTemplate}`;
    }
  }
  customElements.define(tag, Component);
}

async function mountHost(json: string, body: string) {
  const host = document.createElement(uniqueTag("mpmc-host"));
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `<wcs-state json='${json}'></wcs-state>${body}`;
  document.body.appendChild(host);
  const parentStateElement = shadowRoot.querySelector("wcs-state") as State;
  await parentStateElement.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  await settle();
  const readParent = (path: string): unknown => {
    let value: unknown;
    parentStateElement.createState("readonly", (state: any) => { value = state[path]; });
    return value;
  };
  return { host, shadowRoot, parentStateElement, readParent };
}

async function childReady(component: Element): Promise<void> {
  const childShadow = component.shadowRoot!;
  const childStateElement = childShadow.querySelector("wcs-state") as State;
  await childStateElement.connectedCallbackPromise;
  await State.getBindingsReady(childShadow);
  await settle();
}

const text = (root: ParentNode, selector: string) => (root.querySelector(selector) as HTMLElement).textContent;

const CARD =
  '<span class="name">{{ name }}</span><span class="mode">{{ mode }}</span>' +
  '<span class="label" data-wcs="textContent: label"></span>' +
  '<button class="later" data-wcs="onclick: later"></button>';

function cardState(gate: Promise<void> = Promise.resolve()): Record<string, any> {
  return {
    mode: "view",
    get label() { return this.mode + "!"; },
    toggle() { this.mode = this.mode === "view" ? "edit" : "view"; },
    rename() { this.name = "Bob"; },
    compute(suffix: string) { return `${this.name}/${this.mode}${suffix}`; },
    async later() {
      await gate;
      this.mode = "late";
      this.name = `${this.name}!`;
      return "done";
    },
  };
}

async function mountCard(gate?: Promise<void>) {
  const tag = uniqueTag("mpmc-card");
  defineComponent(tag, () => cardState(gate), CARD);
  const env = await mountHost('{"user":{"name":"Alice"}}', `<${tag} data-wcs="state: user"></${tag}>`);
  const card = env.shadowRoot.querySelector(tag)! as any;
  await childReady(card);
  return { ...env, card, cs: card.shadowRoot as ShadowRoot };
}

async function mountRows(gate?: Promise<void>) {
  const tag = uniqueTag("mpmc-row");
  defineComponent(tag, () => cardState(gate), CARD);
  const env = await mountHost(
    '{"users":[{"name":"Anna"},{"name":"Ben"},{"name":"Cy"}]}',
    `<div><template data-wcs="for: users"><${tag} data-wcs="state: ."></${tag}></template></div>`);
  const rows = () => Array.from(env.shadowRoot.querySelectorAll(tag)) as any[];
  for (const row of rows()) await childReady(row);
  const texts = (selector: string) => rows().map((row) => text(row.shadowRoot!, selector));
  return { ...env, tag, rows, texts };
}

function deferred(): { gate: Promise<void>; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return { gate, release };
}

describe("公開面から取り出したメソッドの呼び出し（#331）", () => {
  it("私有キーへの書き込みがその回に描き直され、私有キーに依存する getter も追随すること", async () => {
    const { host, card, cs } = await mountCard();
    card.state.toggle();
    await settle();
    expect(card.state.mode).toBe("edit");
    expect(text(cs, ".mode")).toBe("edit");
    expect(text(cs, ".label")).toBe("edit!");
    host.remove();
  });

  it("ツリーのキーへの書き込みが readonly で投げず、ホストのツリーと表示に届くこと", async () => {
    const { host, card, cs, readParent } = await mountCard();
    expect(() => card.state.rename()).not.toThrow();
    await settle();
    expect(readParent("user.name")).toBe("Bob");
    expect(text(cs, ".name")).toBe("Bob");
    host.remove();
  });

  it("同期メソッドは引数を受け、戻り値を同期のまま返すこと", async () => {
    const { host, card } = await mountCard();
    expect(card.state.compute("?")).toBe("Alice/view?");
    host.remove();
  });

  it("async メソッドは Promise を返し、await の後の私有キーとツリーのキーの書き込みも描き直されること", async () => {
    const { gate, release } = deferred();
    const { host, card, cs, readParent } = await mountCard(gate);
    const result = card.state.later();
    expect(result).toBeInstanceOf(Promise);
    release();
    await expect(result).resolves.toBe("done");
    await settle();
    expect(text(cs, ".mode")).toBe("late");
    expect(text(cs, ".label")).toBe("late!");
    expect(readParent("user.name")).toBe("Alice!");
    expect(text(cs, ".name")).toBe("Alice!");
    host.remove();
  });

  it("取り出したメソッドを切り離して呼んでも同じに動くこと", async () => {
    const { host, card, cs } = await mountCard();
    const { toggle, rename } = card.state;
    toggle();
    rename();
    await settle();
    expect(text(cs, ".mode")).toBe("edit");
    expect(text(cs, ".name")).toBe("Bob");
    host.remove();
  });

  it("関数でない値の読みと $ API は従来どおりであること", async () => {
    const { host, card } = await mountCard();
    expect(card.state.mode).toBe("view");
    expect(card.state.label).toBe("view!");
    expect(card.state.$getAll("name")).toEqual(["Alice"]);
    expect(card.state.$untracked(() => "x")).toBe("x");
    host.remove();
  });
});

describe("行マウントの公開面から取り出したメソッドの呼び出し（#331）", () => {
  it("その行にだけ着地して描き直され、ツリーのキーも読めること", async () => {
    const { host, rows, texts, readParent } = await mountRows();
    rows()[1].state.toggle();
    rows()[1].state.rename();
    expect(rows()[1].state.compute("?")).toBe("Bob/edit?");
    await settle();
    expect(texts(".mode")).toEqual(["view", "edit", "view"]);
    expect(texts(".label")).toEqual(["view!", "edit!", "view!"]);
    expect(texts(".name")).toEqual(["Anna", "Bob", "Cy"]);
    expect(readParent("users")).toEqual([{ name: "Anna" }, { name: "Bob" }, { name: "Cy" }]);
    host.remove();
  });

  it("async メソッドの await の間に行が入れ替わっても、書き込みはそのインスタンスの行に着地すること", async () => {
    const { gate, release } = deferred();
    const { host, rows, texts, parentStateElement, readParent } = await mountRows(gate);
    const result = rows()[1].state.later(); // Ben
    await settle();
    parentStateElement.createState("writable", (state: any) => {
      state.users = [state.users[1], state.users[0], state.users[2]];
    });
    await settle();
    release();
    await expect(result).resolves.toBe("done");
    await settle();
    expect(readParent("users")).toEqual([{ name: "Ben!" }, { name: "Anna" }, { name: "Cy" }]);
    expect(texts(".name")).toEqual(["Ben!", "Anna", "Cy"]);
    expect(texts(".mode")).toEqual(["late", "view", "view"]);
    host.remove();
  });

  it("async メソッドの await の間にホストの行が消えたら、ツリーのキーの読み書きは別の行に着地せず、行が消えた旨で reject すること（#323 と同じ扱い）", async () => {
    const { gate, release } = deferred();
    const { host, tag, rows, texts, parentStateElement, readParent } = await mountRows(gate);
    const result = rows()[1].state.later(); // Ben
    await settle();
    parentStateElement.createState("writable", (state: any) => {
      state.users = [state.users[0], state.users[2]];
    });
    await settle();
    release();
    await expect(result).rejects.toThrow(`The host row of <${tag}> was removed.`);
    await settle();
    expect(readParent("users")).toEqual([{ name: "Anna" }, { name: "Cy" }]);
    expect(texts(".name")).toEqual(["Anna", "Cy"]);
    expect(texts(".mode")).toEqual(["view", "view"]);
    host.remove();
  });
});

describe("行マウントのイベントから呼んだ async メソッドの await の後のツリーのキー（#331）", () => {
  it("await の後の読み書きがその行に着地して描き直され、エラーを出さないこと", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { gate, release } = deferred();
    const { host, rows, texts, readParent } = await mountRows(gate);
    (rows()[1].shadowRoot!.querySelector(".later") as HTMLElement).click();
    await settle();
    release();
    await settle();
    expect(readParent("users")).toEqual([{ name: "Anna" }, { name: "Ben!" }, { name: "Cy" }]);
    expect(texts(".name")).toEqual(["Anna", "Ben!", "Cy"]);
    expect(texts(".mode")).toEqual(["view", "late", "view"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("await の間にホストの行が消えたら、ツリーのキーの読み書きは別の行に着地せず、行が消えた旨を報告すること", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { gate, release } = deferred();
    const { host, tag, rows, texts, parentStateElement, readParent } = await mountRows(gate);
    (rows()[1].shadowRoot!.querySelector(".later") as HTMLElement).click(); // Ben
    await settle();
    parentStateElement.createState("writable", (state: any) => {
      state.users = [state.users[0], state.users[2]];
    });
    await settle();
    release();
    await settle();
    expect(readParent("users")).toEqual([{ name: "Anna" }, { name: "Cy" }]);
    expect(texts(".name")).toEqual(["Anna", "Cy"]);
    const reported = errors.mock.calls.flat().map((arg: any) => arg instanceof Error ? arg.message : String(arg)).join(" ");
    expect(reported).toContain(`The host row of <${tag}> was removed.`);
    host.remove();
  });
});

describe("公開面の関数の値は作者のメソッドだけを包むこと（#331）", () => {
  it("ツリーのキー・私有キー・getter が値として持つ関数は、同じ関数のまま返ること", async () => {
    class Klass { tag = "k"; }
    const handler = Object.assign(vi.fn(), { extra: 1 });
    const tag = uniqueTag("mpmc-fn");
    defineComponent(tag, () => ({
      handler: null as unknown,
      get klass() { return Klass; },
      setHandler(fn: unknown) { this.handler = fn; },
    }), '<span class="name">{{ name }}</span>');
    const env = await mountHost('{"user":{"name":"Alice"}}', `<${tag} data-wcs="state: user"></${tag}>`);
    const card = env.shadowRoot.querySelector(tag)! as any;
    await childReady(card);
    env.parentStateElement.createState("writable", (state: any) => {
      state.user = { name: "Alice", cb: handler };
    });
    await settle();
    card.state.setHandler(handler);
    await settle();
    expect(card.state.cb).toBe(handler);
    expect(card.state.handler).toBe(handler);
    expect(card.state.handler.extra).toBe(1);
    expect(card.state.klass).toBe(Klass);
    expect(new card.state.klass()).toBeInstanceOf(Klass);
    const target = new EventTarget();
    target.addEventListener("x", card.state.cb);
    target.removeEventListener("x", card.state.cb);
    target.dispatchEvent(new Event("x"));
    expect(handler).not.toHaveBeenCalled();
    env.host.remove();
  });
});
