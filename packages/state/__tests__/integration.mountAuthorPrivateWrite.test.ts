/**
 * #321: bind-component でマウントしたコンポーネントの作者のコード（メソッド・setter の本体）が
 * 自分の私有キー（own data key）に書いたら、その回に描き直されること。
 *
 * メソッドは `this` をオーバーレイの proxy に束ねて返され、私有キーの書き込みはその proxy の
 * set トラップで私有データへ直接代入されて終わっていた — 親の setByAddress を通らないので
 * enqueue も依存 walk もキャッシュ更新も起きず、表示は次の無関係な描画まで古いままだった。
 * 行マウントでは読みのキャッシュまで古く残り、外から同じ値を書いても同値ガードで捨てられた。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { installDccHooks } from "../src/dcc/addressHooks";

beforeAll(() => {
  bootstrapState();
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
  const host = document.createElement(uniqueTag("mapw-host"));
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `<wcs-state json='${json}'></wcs-state>${body}`;
  document.body.appendChild(host);
  const parentStateElement = shadowRoot.querySelector("wcs-state") as State;
  await parentStateElement.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  await settle();
  return { host, shadowRoot, parentStateElement };
}

async function childReady(component: Element): Promise<void> {
  const childShadow = component.shadowRoot!;
  const childStateElement = childShadow.querySelector("wcs-state") as State;
  await childStateElement.connectedCallbackPromise;
  await State.getBindingsReady(childShadow);
  await settle();
}

const text = (root: ParentNode, selector: string) => (root.querySelector(selector) as HTMLElement).textContent;
const click = (root: ParentNode, selector: string) => (root.querySelector(selector) as HTMLElement).click();

const CARD =
  '<span class="name">{{ name }}</span><span class="mode">{{ mode }}</span>' +
  '<span class="label" data-wcs="textContent: label"></span>' +
  '<button class="toggle" data-wcs="onclick: toggle"></button>' +
  '<button class="later" data-wcs="onclick: later"></button>' +
  '<button class="both" data-wcs="onclick: both"></button>' +
  '<button class="viaSetter" data-wcs="onclick: viaSetter"></button>';

function cardState(): Record<string, any> {
  return {
    mode: "view",
    get label() { return this.mode + "!"; },
    set modeSetter(v: string) { this.mode = v; },
    toggle() { this.mode = this.mode === "view" ? "edit" : "view"; },
    async later() {
      this.mode = "a";
      await new Promise((r) => setTimeout(r));
      this.mode = "b";
    },
    both() { this.mode = "edit"; this.name = "Carol"; },
    viaSetter() { this.modeSetter = "set"; },
  };
}

async function mountCard(json = '{"user":{"name":"Alice"}}') {
  const tag = uniqueTag("mapw-card");
  defineComponent(tag, cardState, CARD);
  const env = await mountHost(json, `<${tag} data-wcs="state: user"></${tag}>`);
  const card = env.shadowRoot.querySelector(tag)! as any;
  await childReady(card);
  return { ...env, card, cs: card.shadowRoot as ShadowRoot };
}

describe("マウントしたコンポーネントの作者のコードからの私有キーの書き込み（#321）", () => {
  it("メソッドが私有キーに書くと、その回に表示と私有キーに依存する getter が描き直されること", async () => {
    const { host, card, cs } = await mountCard();
    expect(text(cs, ".mode")).toBe("view");

    click(cs, ".toggle");
    await settle();
    expect(card.state.mode).toBe("edit");
    expect(text(cs, ".mode")).toBe("edit");
    expect(text(cs, ".label")).toBe("edit!");

    click(cs, ".toggle");
    await settle();
    expect(text(cs, ".mode")).toBe("view");
    expect(text(cs, ".label")).toBe("view!");
    host.remove();
  });

  it("async メソッドの await の後の書き込みも描き直されること", async () => {
    const { host, card, cs } = await mountCard();
    click(cs, ".later");
    await settle();
    await settle();
    expect(card.state.mode).toBe("b");
    expect(text(cs, ".mode")).toBe("b");
    host.remove();
  });

  it("同じメソッドで私有キーとツリーのキーに書くと、両方が描き直されること", async () => {
    const { host, cs, parentStateElement } = await mountCard();
    click(cs, ".both");
    await settle();
    expect(text(cs, ".mode")).toBe("edit");
    expect(text(cs, ".name")).toBe("Carol");
    let name: unknown;
    parentStateElement.createState("readonly", (state: any) => { name = state["user.name"]; });
    expect(name).toBe("Carol");
    host.remove();
  });

  it("メソッドから setter を経て私有キーに書いても、外から setter に書いても描き直されること", async () => {
    const first = await mountCard();
    click(first.cs, ".viaSetter");
    await settle();
    expect(text(first.cs, ".mode")).toBe("set");
    first.host.remove();

    const second = await mountCard();
    second.card.state.modeSetter = "external";
    await settle();
    expect(text(second.cs, ".mode")).toBe("external");
    expect(text(second.cs, ".label")).toBe("external!");
    second.host.remove();
  });

  it("外から el.state に書く経路（対照）は従来どおり描き直されること", async () => {
    const { host, card, cs } = await mountCard();
    card.state.mode = "edit";
    await settle();
    expect(text(cs, ".mode")).toBe("edit");
    expect(text(cs, ".label")).toBe("edit!");
    host.remove();
  });

  it("公開面から取り出したメソッドは読み取り専用のセッションで評価され、私有キーへの書き込みで投げないこと", async () => {
    // 読み取り専用の receiver へ回すと "This state is readonly" で投げる — 従来どおり私有データへ直接入れる。
    // 公開面から呼んだメソッドの書き込みの描き直しは、ここでは扱わない
    const { host, card } = await mountCard();
    expect(() => card.state.toggle()).not.toThrow();
    expect(card.state.mode).toBe("edit");
    host.remove();
  });
});

describe("行マウント（ホストの for: 行の中）の私有キーの書き込み（#321）", () => {
  async function mountRows(tag: string) {
    const env = await mountHost(
      '{"users":[{"name":"Anna"},{"name":"Ben"},{"name":"Cy"}]}',
      `<div><template data-wcs="for: users"><${tag} data-wcs="state: ."></${tag}></template></div>`);
    const rows = Array.from(env.shadowRoot.querySelectorAll(tag)) as any[];
    for (const row of rows) await childReady(row);
    return { ...env, rows };
  }

  it("メソッドが私有キーに書くと、その行だけが描き直され el.state の読みも一致すること", async () => {
    const tag = uniqueTag("mapw-row");
    defineComponent(tag, cardState, CARD);
    const { host, rows } = await mountRows(tag);

    click(rows[1].shadowRoot!, ".toggle");
    await settle();
    expect(rows.map((row) => text(row.shadowRoot!, ".mode"))).toEqual(["view", "edit", "view"]);
    expect(rows.map((row) => text(row.shadowRoot!, ".label"))).toEqual(["view!", "edit!", "view!"]);
    expect(rows.map((row) => row.state.mode)).toEqual(["view", "edit", "view"]);
    host.remove();
  });

  it("メソッドで書いた後に外から同じ値を書いても、表示と状態が食い違わないこと（同値ガード）", async () => {
    const tag = uniqueTag("mapw-row");
    defineComponent(tag, cardState, CARD);
    const { host, rows } = await mountRows(tag);
    const cs = rows[1].shadowRoot!;

    click(cs, ".toggle");
    await settle();
    click(cs, ".toggle");
    await settle();
    click(cs, ".toggle");
    await settle();
    expect(rows[1].state.mode).toBe("edit");
    expect(text(cs, ".mode")).toBe("edit");

    rows[1].state.mode = "edit";
    await settle();
    expect(rows[1].state.mode).toBe("edit");
    expect(text(cs, ".mode")).toBe("edit");
    host.remove();
  });

  it("await の間に行が入れ替わっても、書き込みはそのインスタンスの行に着地すること", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tag = uniqueTag("mapw-row");
    defineComponent(tag, () => ({
      mode: "view",
      async later() { await gate; this.mode = "late"; },
    }), '<span class="name">{{ name }}</span><span class="mode">{{ mode }}</span><button data-wcs="onclick: later"></button>');
    const { host, shadowRoot, rows, parentStateElement } = await mountRows(tag);

    (rows[1].shadowRoot!.querySelector("button") as HTMLElement).click(); // Ben
    await settle();
    parentStateElement.createState("writable", (state: any) => {
      state.users = [state.users[1], state.users[0], state.users[2]];
    });
    await settle();
    release();
    await settle();

    const now = Array.from(shadowRoot.querySelectorAll(tag)) as any[];
    expect(now.map((row) => text(row.shadowRoot!, ".name"))).toEqual(["Ben", "Anna", "Cy"]);
    expect(now.map((row) => text(row.shadowRoot!, ".mode"))).toEqual(["late", "view", "view"]);
    expect(now.map((row) => row.state.mode)).toEqual(["late", "view", "view"]);
    host.remove();
  });

  it("await の間に行が消えても投げず、残った行を書き換えないこと", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tag = uniqueTag("mapw-row");
    defineComponent(tag, () => ({
      mode: "view",
      async later() { await gate; this.mode = "late"; },
    }), '<span class="name">{{ name }}</span><span class="mode">{{ mode }}</span><button data-wcs="onclick: later"></button>');
    const { host, shadowRoot, rows, parentStateElement } = await mountRows(tag);

    (rows[1].shadowRoot!.querySelector("button") as HTMLElement).click(); // Ben
    await settle();
    parentStateElement.createState("writable", (state: any) => {
      state.users = [state.users[0], state.users[2]];
    });
    await settle();
    release();
    await settle();

    const now = Array.from(shadowRoot.querySelectorAll(tag)) as any[];
    expect(now.map((row) => text(row.shadowRoot!, ".name"))).toEqual(["Anna", "Cy"]);
    expect(now.map((row) => text(row.shadowRoot!, ".mode"))).toEqual(["view", "view"]);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    host.remove();
  });

  it("コンポーネントの中の for: 行のハンドラが私有キーに書いても描き直されること（ホスト行の中でも外でも）", async () => {
    const tag = uniqueTag("mapw-pick");
    defineComponent(tag, () => ({
      picked: -1,
      pick(_event: Event, index: number) { this.picked = index; },
    }), '<span class="picked">{{ picked }}</span><template data-wcs="for: items"><button data-wcs="onclick: pick"></button></template>');

    const single = await mountHost('{"user":{"items":["x","y"]}}', `<${tag} data-wcs="state: user"></${tag}>`);
    const card = single.shadowRoot.querySelector(tag)! as any;
    await childReady(card);
    (card.shadowRoot!.querySelectorAll("button")[1] as HTMLElement).click();
    await settle();
    expect(text(card.shadowRoot!, ".picked")).toBe("1");
    single.host.remove();

    const inRows = await mountHost(
      '{"users":[{"items":["x","y"]},{"items":["p","q"]}]}',
      `<div><template data-wcs="for: users"><${tag} data-wcs="state: ."></${tag}></template></div>`);
    const rows = Array.from(inRows.shadowRoot.querySelectorAll(tag)) as any[];
    for (const row of rows) await childReady(row);
    (rows[1].shadowRoot!.querySelectorAll("button")[1] as HTMLElement).click();
    await settle();
    expect(rows.map((row) => text(row.shadowRoot!, ".picked"))).toEqual(["-1", "1"]);
    expect(rows.map((row) => row.state.picked)).toEqual([-1, 1]);
    inRows.host.remove();
  });
});

describe("await の間にコンポーネントが外された場合（#321）", () => {
  it("外されたコンポーネントのメソッドが await の後に私有キーへ書いても投げないこと", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tag = uniqueTag("mapw-gone");
    defineComponent(tag, () => ({
      mode: "view",
      async later() { await gate; this.mode = "late"; },
    }), '<span class="mode">{{ mode }}</span><button data-wcs="onclick: later"></button>');
    const { host, shadowRoot } = await mountHost('{"user":{"name":"Alice"}}', `<${tag} data-wcs="state: user"></${tag}>`);
    const card = shadowRoot.querySelector(tag)! as any;
    await childReady(card);

    (card.shadowRoot!.querySelector("button") as HTMLElement).click();
    await settle();
    card.remove();
    await settle();
    release();
    await settle();

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    host.remove();
  });
});

describe("行マウントのメソッドの評価文脈（#321）", () => {
  it("メソッドは呼ぶたびにその回の文脈で評価され、2 回目以降もツリーのキーを読めること", async () => {
    const tag = uniqueTag("mapw-again");
    defineComponent(tag, () => ({
      n: 0,
      out: "",
      greet() { this.n = this.n + 1; this.out = `${this.name}:${this.n}`; },
    }), '<span class="o">{{ out }}</span><button data-wcs="onclick: greet"></button>');
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = await mountHost('{"users":[{"name":"Anna"},{"name":"Ben"}]}',
      `<div><template data-wcs="for: users"><${tag} data-wcs="state: ."></${tag}></template></div>`);
    const rows = Array.from(env.shadowRoot.querySelectorAll(tag)) as any[];
    for (const row of rows) await childReady(row);

    const seen: (string | null)[] = [];
    for (let i = 0; i < 3; i++) {
      (rows[1].shadowRoot!.querySelector("button") as HTMLElement).click();
      await settle();
      seen.push(text(rows[1].shadowRoot!, ".o"));
    }
    expect(seen).toEqual(["Ben:1", "Ben:2", "Ben:3"]);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    env.host.remove();
  });

  it("公開面からメソッドを先に呼んでも、その後のクリックの書き込みは描き直されること", async () => {
    const tag = uniqueTag("mapw-public-first");
    defineComponent(tag, () => ({
      count: 0,
      inc() { this.count = this.count + 1; },
    }), '<span class="c">{{ count }}</span><button data-wcs="onclick: inc"></button>');
    const env = await mountHost('{"users":[{"name":"Anna"},{"name":"Ben"}]}',
      `<div><template data-wcs="for: users"><${tag} data-wcs="state: ."></${tag}></template></div>`);
    const rows = Array.from(env.shadowRoot.querySelectorAll(tag)) as any[];
    for (const row of rows) await childReady(row);

    rows[1].state.inc();
    await settle();
    (rows[1].shadowRoot!.querySelector("button") as HTMLElement).click();
    await settle();
    (rows[1].shadowRoot!.querySelector("button") as HTMLElement).click();
    await settle();
    expect(rows[1].state.count).toBe(3);
    expect(text(rows[1].shadowRoot!, ".c")).toBe("3");
    env.host.remove();
  });
});

describe("私有キーの書き込みはマウントの外へ漏れない（#321）", () => {
  it("ルートの $updatedCallback は私有キーだけの更新では呼ばれず、ツリーのキーの更新では呼ばれること", async () => {
    const tag = uniqueTag("mapw-ucb");
    defineComponent(tag, cardState, CARD);
    const calls: unknown[] = [];
    const host = document.createElement(uniqueTag("mapw-ucb-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<wcs-state></wcs-state><${tag} data-wcs="state: user"></${tag}>`;
    const stateElement = shadowRoot.querySelector("wcs-state") as State;
    (stateElement as any).setInitialState({
      user: { name: "Alice" },
      $updatedCallback(paths: string[], indexes: unknown) { calls.push([paths, indexes]); },
    });
    document.body.appendChild(host);
    await stateElement.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    await settle();
    const card = shadowRoot.querySelector(tag)! as any;
    await childReady(card);
    calls.length = 0;

    click(card.shadowRoot!, ".toggle");
    await settle();
    card.state.mode = "external";
    await settle();
    expect(text(card.shadowRoot!, ".mode")).toBe("external");
    expect(calls).toEqual([]);

    click(card.shadowRoot!, ".both");
    await settle();
    expect(calls).toEqual([[["user.name"], {}]]);
    host.remove();
  });

  it("DCC の $bindables のメンバーの変更イベントは、マウントの私有キーの書き込みでは出ないこと", async () => {
    installDccHooks();
    const tag = uniqueTag("mapw-dcc");
    defineComponent(tag, cardState, CARD);
    const { host, parentStateElement, card, cs } = await mountCard();
    (parentStateElement as any).setBindableEventMap({ user: "x-card:user-changed" });
    const events: string[] = [];
    host.addEventListener("x-card:user-changed", (event) => events.push(event.type));

    click(cs, ".toggle");
    await settle();
    card.state.mode = "external";
    await settle();
    expect(text(cs, ".mode")).toBe("external");
    expect(events).toEqual([]);

    click(cs, ".both");
    await settle();
    expect(events).toEqual(["x-card:user-changed"]);
    host.remove();
  });
});
