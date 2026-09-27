/**
 * #367: 部分マウント（`state.name: .name`）のコンポーネントの async メソッドが await している間に
 * ホストの行が消え、その要素（行の Content）が別の行に使い回されると、await の後の書き込みが
 * 使い回された先の行に着地していた。部分マウントだけの記録はマーカーアドレスが行を持たないので、
 * ホストの行を読むたびに要素の**いまの**ループ文脈から取っていたため。完全マウント（`state: .`）は
 * 呼び出したときの行を持ち、その行が消えていれば投げる（#331）。部分マウントも評価を始めたときの
 * 行を持ち、同じく投げる。私有キー（要素ごとに 1 組）も、要素が別の行に使い回された後は書かない。
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

const CARD =
  '<span class="name">{{ name }}</span><span class="mode">{{ mode }}</span>' +
  '<button class="later" data-wcs="onclick: later"></button>';

function deferred(): { gate: Promise<void>; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return { gate, release };
}

async function mountRows(binding: string, gate: Promise<void>, extra: Record<string, any> = {}) {
  const tag = uniqueTag("mpar-row");
  class Component extends HTMLElement {
    state: Record<string, any> = {
      mode: "view",
      async later() {
        await gate;
        this.mode = "late";
        this.name = `${this.name}!`;
        return "done";
      },
      ...extra,
    };
    constructor() {
      super();
      this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state>${CARD}`;
    }
  }
  customElements.define(tag, Component);
  const host = document.createElement(uniqueTag("mpar-host"));
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `<wcs-state json='{"users":[{"name":"Anna"},{"name":"Ben"},{"name":"Cy"}]}'></wcs-state>` +
    `<div><template data-wcs="for: users"><${tag} data-wcs="${binding}"></${tag}></template></div>`;
  document.body.appendChild(host);
  const parentStateElement = shadowRoot.querySelector("wcs-state") as State;
  await parentStateElement.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  await settle();
  const rows = () => Array.from(shadowRoot.querySelectorAll(tag)) as any[];
  for (const row of rows()) {
    await (row.shadowRoot!.querySelector("wcs-state") as State).connectedCallbackPromise;
    await State.getBindingsReady(row.shadowRoot!);
  }
  await settle();
  const texts = (selector: string) => rows().map((row) => row.shadowRoot!.querySelector(selector)!.textContent);
  const users = (): unknown => {
    let value: unknown;
    parentStateElement.createState("readonly", (state: any) => { value = JSON.parse(JSON.stringify(state.users)); });
    return value;
  };
  const writeUsers = (fn: (users: any[]) => any[]): void => {
    parentStateElement.createState("writable", (state: any) => { state.users = fn(state.users); });
  };
  return { host, tag, rows, texts, users, writeUsers };
}

const REMOVED = (tag: string) => `The host row of <${tag}> was removed.`;
const reportedOf = (errors: ReturnType<typeof vi.spyOn>): string =>
  errors.mock.calls.flat().map((arg: any) => arg instanceof Error ? arg.message : String(arg)).join(" ");

describe("部分マウントの async メソッドの await の間にホストの行が消えたとき（#367）", () => {
  it("消えた行の要素が同じバッチで足した行に使い回されても、イベントから呼んだ書き込みはその行に着地せず、行が消えた旨を報告すること", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { gate, release } = deferred();
    const { host, tag, rows, texts, users, writeUsers } = await mountRows("state.name: .name", gate);
    const ben = rows()[1];
    (ben.shadowRoot!.querySelector(".later") as HTMLElement).click();
    await settle();
    writeUsers((list) => [list[0], list[2], { name: "Dan" }]);
    await settle();
    expect(rows()).toContain(ben); // Ben の要素が Dan の行に使い回されている
    release();
    await settle();
    expect(users()).toEqual([{ name: "Anna" }, { name: "Cy" }, { name: "Dan" }]);
    expect(texts(".name")).toEqual(["Anna", "Cy", "Dan"]);
    expect(texts(".mode")).toEqual(["view", "view", "view"]);
    expect(reportedOf(errors)).toContain(REMOVED(tag));
    host.remove();
  });

  it("消えた行と同じ位置に足した行に使い回されても着地しないこと", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { gate, release } = deferred();
    const { host, tag, rows, texts, users, writeUsers } = await mountRows("state.name: .name", gate);
    (rows()[1].shadowRoot!.querySelector(".later") as HTMLElement).click();
    await settle();
    writeUsers((list) => [list[0], { name: "Dan" }, list[2]]);
    await settle();
    release();
    await settle();
    expect(users()).toEqual([{ name: "Anna" }, { name: "Dan" }, { name: "Cy" }]);
    expect(texts(".mode")).toEqual(["view", "view", "view"]);
    expect(reportedOf(errors)).toContain(REMOVED(tag));
    host.remove();
  });

  it("公開面（element.state）から呼んだ async メソッドは、行が消えた旨で reject し、どの行にも書かないこと", async () => {
    const { gate, release } = deferred();
    const { host, tag, rows, texts, users, writeUsers } = await mountRows("state.name: .name", gate);
    const result = rows()[1].state.later();
    await settle();
    writeUsers((list) => [list[0], list[2], { name: "Dan" }]);
    await settle();
    release();
    await expect(result).rejects.toThrow(REMOVED(tag));
    await settle();
    expect(users()).toEqual([{ name: "Anna" }, { name: "Cy" }, { name: "Dan" }]);
    expect(texts(".mode")).toEqual(["view", "view", "view"]);
    host.remove();
  });

  it("await の後にツリーのキーを読むだけでも、使い回された先の行の値を返さず、行が消えた旨で reject すること", async () => {
    const { gate, release } = deferred();
    const { host, tag, rows, writeUsers } = await mountRows("state.name: .name", gate, {
      async peek(this: any) { await gate; return this.name; },
    });
    const result = rows()[1].state.peek();
    await settle();
    writeUsers((list) => [list[0], list[2], { name: "Dan" }]);
    await settle();
    release();
    await expect(result).rejects.toThrow(REMOVED(tag));
    host.remove();
  });

  it("行が消えただけ（使い回しなし）でも、完全マウントと同じ文言で reject すること（旧: ListIndex not found）", async () => {
    const { gate, release } = deferred();
    const { host, tag, rows, users, writeUsers } = await mountRows("state.name: .name", gate);
    const result = rows()[1].state.later();
    await settle();
    writeUsers((list) => [list[0], list[2]]);
    await settle();
    release();
    await expect(result).rejects.toThrow(REMOVED(tag));
    expect(users()).toEqual([{ name: "Anna" }, { name: "Cy" }]);
    host.remove();
  });

  it("await の間に行が並べ替わっただけなら、書き込みはそのインスタンスの行に着地すること", async () => {
    const { gate, release } = deferred();
    const { host, rows, texts, users, writeUsers } = await mountRows("state.name: .name", gate);
    const ben = rows()[1];
    const result = ben.state.later();
    await settle();
    writeUsers((list) => [list[1], list[0], list[2]]);
    await settle();
    release();
    await expect(result).resolves.toBe("done");
    await settle();
    expect(users()).toEqual([{ name: "Ben!" }, { name: "Anna" }, { name: "Cy" }]);
    expect(texts(".name")).toEqual(["Ben!", "Anna", "Cy"]);
    expect(texts(".mode")).toEqual(["late", "view", "view"]);
    host.remove();
  });

  it("行が消えるときの $disconnectedCallback は、私有キーに書いても投げないこと", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { gate } = deferred();
    const { host, writeUsers } = await mountRows("state.name: .name", gate, {
      $disconnectedCallback(this: any) { this.mode = "gone"; },
    });
    writeUsers((list) => [list[0], list[2]]);
    await settle();
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("完全マウント（state: .）は従来どおり、使い回された先の行に着地せず reject すること（対照）", async () => {
    const { gate, release } = deferred();
    const { host, tag, rows, texts, users, writeUsers } = await mountRows("state: .", gate);
    const result = rows()[1].state.later();
    await settle();
    writeUsers((list) => [list[0], list[2], { name: "Dan" }]);
    await settle();
    release();
    await expect(result).rejects.toThrow(REMOVED(tag));
    await settle();
    expect(users()).toEqual([{ name: "Anna" }, { name: "Cy" }, { name: "Dan" }]);
    expect(texts(".mode")).toEqual(["view", "view", "view"]);
    host.remove();
  });
});

/** 任意の形のホストに、部分マウントのコンポーネントを置く */
async function mountTree(json: string, body: (tag: string) => string, createState: () => Record<string, any>, inner: string) {
  const tag = uniqueTag("mpar-tree");
  class Component extends HTMLElement {
    state: Record<string, any> = createState();
    constructor() {
      super();
      this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state>${inner}`;
    }
  }
  customElements.define(tag, Component);
  const host = document.createElement(uniqueTag("mpar-host"));
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `<wcs-state json='${json}'></wcs-state>${body(tag)}`;
  document.body.appendChild(host);
  const parentStateElement = shadowRoot.querySelector("wcs-state") as State;
  await parentStateElement.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  await settle();
  const comps = () => Array.from(shadowRoot.querySelectorAll(tag)) as any[];
  for (const comp of comps()) {
    await (comp.shadowRoot!.querySelector("wcs-state") as State).connectedCallbackPromise;
    await State.getBindingsReady(comp.shadowRoot!);
  }
  await settle();
  const texts = (selector: string) => comps().map((comp) => comp.shadowRoot!.querySelector(selector)!.textContent);
  const write = async (fn: (state: any) => void): Promise<void> => {
    parentStateElement.createState("writable", fn);
    await settle();
  };
  const read = (path: string): unknown => {
    let value: unknown;
    parentStateElement.createState("readonly", (state: any) => { value = JSON.parse(JSON.stringify(state[path])); });
    return value;
  };
  return { host, comps, texts, write, read };
}

describe("行が生きている部分マウントは、修正の前と同じに動くこと（#367 の判定の対照）", () => {
  const GROUPS = '{"groups":[{"id":"A","users":[{"name":"a1"},{"name":"a2"}]},{"id":"B","users":[{"name":"b1"},{"name":"b2"}]}]}';
  const NESTED = (tag: string) => `<ul><template data-wcs="for: groups"><li><ol><template data-wcs="for: .users">` +
    `<li><${tag} data-wcs="state.name: .name"></${tag}></li></template></ol></li></template></ul>`;
  const CARD_STATE = () => ({
    mode: "v",
    get display(this: any) { return `${this.name}/${this.mode}`; },
    rename(this: any) { this.name = `${this.name}~`; this.mode = "renamed"; },
  });

  it("入れ子の for で外側の要素をコピーに差し替えても（内側の行は生きたまま）、getter・イベント・公開面が投げないこと", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { host, comps, texts, write, read } = await mountTree(GROUPS, NESTED, CARD_STATE,
      '<span class="display">{{ display }}</span><button class="rename" data-wcs="onclick: rename"></button>');
    await write((state) => { state.groups = state.groups.map((group: any) => ({ ...group })); });
    expect(texts(".display")).toEqual(["a1/v", "a2/v", "b1/v", "b2/v"]);
    (comps()[3].shadowRoot!.querySelector(".rename") as HTMLElement).click();
    await write(() => {});
    expect(texts(".display")).toEqual(["a1/v", "a2/v", "b1/v", "b2~/renamed"]);
    expect(comps()[3].state.display).toBe("b2~/renamed");
    expect((read("groups") as any[])[1].users).toEqual([{ name: "b1" }, { name: "b2~" }]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("if の再表示で呼ばれた $connectedCallback が await の後にツリーのキーを読んでも、その行に着地すること（要素がまだ行に置かれていない評価）", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { host, texts, write } = await mountTree(
      '{"users":[{"name":"Anna","show":true},{"name":"Ben","show":true}]}',
      (tag) => `<div><template data-wcs="for: users"><template data-wcs="if: .show"><${tag} data-wcs="state.name: .name"></${tag}></template></template></div>`,
      () => ({
        seen: "-",
        async load(this: any) { await null; this.seen = `load ${this.name}`; },
        async $connectedCallback(this: any) { await this.load(); },
      }),
      '<span class="seen">{{ seen }}</span>');
    await write((state) => { state["users.1.show"] = false; });
    await write((state) => { state["users.1.name"] = "Ben2"; });
    await write((state) => { state["users.1.show"] = true; });
    expect(texts(".seen")).toEqual(["load Anna", "load Ben2"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });
});
