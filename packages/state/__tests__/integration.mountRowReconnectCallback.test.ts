/**
 * #368: `for:` の行にマウントしたコンポーネントの `$connectedCallback` が、行の Content をプールから
 * 使い回したとき（と `if:` で再表示したとき）にツリーのキーを読むと `ListIndex not found` で投げていた。
 * 再接続の `$connectedCallback` は DOM に戻した瞬間に同期で走るが、行の Content のループ文脈は
 * その後の activateContent が張っていたため、要素の行が引けなかった。for / if は DOM に戻す前に
 * ループ文脈を張る。
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

const USERS = '{"users":[{"name":"Anna","show":true},{"name":"Ben","show":true},{"name":"Cy","show":true}]}';
const INNER = '<span class="name">{{ name }}</span><span class="seen">{{ seen }}</span>';
const SEEN = (): Record<string, any> => ({
  seen: "-",
  $connectedCallback(this: any) { this.seen = `saw ${this.name}`; },
});

function defineRow(createState: () => Record<string, any>, inner: string): string {
  const tag = uniqueTag("mrrc-row");
  class Component extends HTMLElement {
    state: Record<string, any> = createState();
    constructor() {
      super();
      this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state>${inner}`;
    }
  }
  customElements.define(tag, Component);
  return tag;
}

async function mountRows(
  body: (tag: string) => string,
  createState: () => Record<string, any> = SEEN,
  json: string = USERS,
  inner: string = INNER,
) {
  const tag = defineRow(createState, inner);
  const host = document.createElement(uniqueTag("mrrc-host"));
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `<wcs-state json='${json}'></wcs-state>${body(tag)}`;
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
  const write = async (fn: (state: any) => void): Promise<void> => {
    parentStateElement.createState("writable", fn);
    await settle();
  };
  const read = (fn: (state: any) => unknown): unknown => {
    let value: unknown;
    parentStateElement.createState("readonly", (state: any) => { value = fn(state); });
    return value;
  };
  return { host, tag, shadowRoot, rows, texts, write, read };
}

const FOR = (binding: string) => (tag: string) =>
  `<div><template data-wcs="for: users"><${tag} data-wcs="${binding}"></${tag}></template></div>`;

describe.each(["state: .", "state.name: .name"])("行の再接続の $connectedCallback（#368・%s）", (binding) => {
  it("プールから使い回した行で、ツリーのキーを同期で読み、新しい行の値を書けること", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { host, rows, texts, write } = await mountRows(FOR(binding));
    expect(texts(".seen")).toEqual(["saw Anna", "saw Ben", "saw Cy"]);
    const ben = rows()[1];
    await write((state) => { state.users = [state.users[0], state.users[2]]; });
    await write((state) => { state.users = [...state.users, { name: "Dan" }]; });
    expect(rows()[2]).toBe(ben); // Ben の要素が Dan の行に使い回されている
    expect(texts(".name")).toEqual(["Anna", "Cy", "Dan"]);
    expect(texts(".seen")).toEqual(["saw Anna", "saw Cy", "saw Dan"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("行を消して足すのを 1 つのバッチで書いても同じこと", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { host, texts, write } = await mountRows(FOR(binding));
    await write((state) => { state.users = [state.users[0], state.users[2], { name: "Dan" }]; });
    expect(texts(".seen")).toEqual(["saw Anna", "saw Cy", "saw Dan"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("要素が行の直下でない（行の要素の子）ときも同じこと", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { host, texts, write } = await mountRows((tag) =>
      `<ul><template data-wcs="for: users"><li><${tag} data-wcs="${binding}"></${tag}></li></template></ul>`);
    await write((state) => { state.users = [state.users[0], state.users[2]]; });
    await write((state) => { state.users = [...state.users, { name: "Dan" }]; });
    expect(texts(".seen")).toEqual(["saw Anna", "saw Cy", "saw Dan"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("行の中の if: に置いた要素を持つ行をプールから使い回しても、消えた行の位置にある別の行を読まないこと", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { host, texts, write } = await mountRows((tag) =>
      `<div><template data-wcs="for: users"><template data-wcs="if: .show"><${tag} data-wcs="${binding}"></${tag}></template></template></div>`);
    await write((state) => { state.users = [state.users[0], state.users[2]]; });
    await write((state) => { state.users = [...state.users, { name: "Dan", show: true }]; });
    // 旧: if の Content に外した Ben の行の文脈が残り、その位置（1）にいまある Cy を黙って読んでいた
    //（部分マウントは `saw Cy`、完全マウントは書き込みが外した行の私有データに落ちて `-`）
    expect(texts(".seen")).toEqual(["saw Anna", "saw Cy", "saw Dan"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("$connectedCallback からメソッドを同期で呼べること", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { host, texts, write } = await mountRows(FOR(binding), () => ({
      seen: "-",
      load(this: any) { this.seen = `load ${this.name}`; },
      $connectedCallback(this: any) { this.load(); },
    }));
    await write((state) => { state.users = [state.users[0], state.users[2], { name: "Dan" }]; });
    expect(texts(".seen")).toEqual(["load Anna", "load Cy", "load Dan"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("if: で再表示した行で、隠している間に変わったツリーのキーを同期で読めること", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { host, texts, write } = await mountRows((tag) =>
      `<div><template data-wcs="for: users"><template data-wcs="if: .show"><${tag} data-wcs="${binding}"></${tag}></template></template></div>`);
    await write((state) => { state["users.1.show"] = false; });
    await write((state) => { state["users.1.name"] = "Ben2"; });
    await write((state) => { state["users.1.show"] = true; });
    expect(texts(".name")).toEqual(["Anna", "Ben2", "Cy"]);
    expect(texts(".seen")).toEqual(["saw Anna", "saw Ben2", "saw Cy"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("使い回しでも $disconnectedCallback → $connectedCallback が 1 回ずつ、この順で呼ばれること（回数・順序は変わらない）", async () => {
    const log: string[] = [];
    const { host, write } = await mountRows(FOR(binding), () => ({
      seen: "-",
      $connectedCallback(this: any) { log.push(`connect:${this.name}`); },
      $disconnectedCallback() { log.push("disconnect"); },
    }));
    expect(log).toEqual(["connect:Anna", "connect:Ben", "connect:Cy"]);
    log.length = 0;
    await write((state) => { state.users = [state.users[0], state.users[2]]; });
    await write((state) => { state.users = [...state.users, { name: "Dan" }]; });
    expect(log).toEqual(["disconnect", "connect:Dan"]);
    host.remove();
  });
});

const FLAGS = '{"on":true,"users":[{"name":"Anna","flag":"-","show":true},{"name":"Ben","flag":"-","show":true},{"name":"Cy","flag":"-","show":true}]}';
const GROUPS = '{"groups":[{"users":[{"name":"x-Anna","flag":"-"},{"name":"x-Ben","flag":"-"}]},{"users":[{"name":"y-Ed","flag":"-"},{"name":"y-Flo","flag":"-"}]}]}';
// 部分マウントの私有キーでも写しでもないキー（`{{ seen }}`）を置かない — 置くと別の読みになる（報告の注記）
const NAME_ONLY = '<span class="name">{{ name }}</span>';
const flagsOf = (users: any[]): string[] => users.map((user) => `${user.name}:${user.flag}`);

/** `$disconnectedCallback` でツリーのキーを読み、行のキーに書く。投げたらその文言を残す */
function disconnectLogger(log: string[]): () => Record<string, any> {
  return () => ({
    $disconnectedCallback(this: any) {
      try {
        log.push(`read:${this.name}`);
        this.flag = `gone:${this.name}`;
      } catch (error: any) {
        log.push(`threw:${error.message}`);
      }
    },
  });
}

describe.each(["state: .", "state.name: .name; state.flag: .flag"])("行が消えたときの $disconnectedCallback（#368・%s）", (binding) => {
  // ツリーのキーは投げる（旧: 行の直下の要素は ListIndex not found: users.*.name、他の形は別の行を読み書きした）
  const REMOVED = (tag: string): string => `threw:[@wcstack/state] The host row of <${tag}> was removed.`;

  it("行の直下の要素は、ツリーのキーの読み書きが行が消えた旨で投げること（旧: ListIndex not found）", async () => {
    const log: string[] = [];
    const { host, tag, write, read } = await mountRows(FOR(binding), disconnectLogger(log), FLAGS, NAME_ONLY);
    await write((state) => { state.users = [state.users[0], state.users[2]]; });
    expect(log).toEqual([REMOVED(tag)]);
    expect(flagsOf(read((state) => state.users) as any[])).toEqual(["Anna:-", "Cy:-"]);
    host.remove();
  });

  it("行を引く $ API（$getAll / $resolve）も行が消えた旨で投げること", async () => {
    const log: string[] = [];
    const { host, tag, write } = await mountRows(FOR(binding), () => ({
      $disconnectedCallback(this: any) {
        for (const call of [() => this.$getAll("name", []), () => this.$resolve("name", [])]) {
          try { log.push(`read:${JSON.stringify(call())}`); } catch (error: any) { log.push(`threw:${error.message}`); }
        }
      },
    }), FLAGS, NAME_ONLY);
    await write((state) => { state.users = [state.users[0], state.users[2]]; });
    expect(log).toEqual([REMOVED(tag), REMOVED(tag)]);
    host.remove();
  });

  it("リストを丸ごと差し替える（全行の削除）と、消えた行の要素は投げ、同じ位置の新しい行を読み書きしないこと", async () => {
    const log: string[] = [];
    const { host, tag, write, read } = await mountRows(FOR(binding), disconnectLogger(log), FLAGS, NAME_ONLY);
    await write((state) => { state.users = [{ name: "Dan", flag: "-" }, { name: "Eve", flag: "-" }, { name: "Fay", flag: "-" }]; });
    // 旧: ["read:Dan", "read:Eve", "read:Fay"] と書き込み Dan:gone:Dan …（全削除の近道は親を空にして要素を外してから、行の文脈を外す）
    expect(log).toEqual([REMOVED(tag), REMOVED(tag), REMOVED(tag)]);
    expect(flagsOf(read((state) => state.users) as any[])).toEqual(["Dan:-", "Eve:-", "Fay:-"]);
    host.remove();
  });

  it("行の中の if: の要素も同じく投げ、残っている別の行（消えた行の位置の Cy）を読み書きしないこと", async () => {
    const log: string[] = [];
    const { host, tag, write, read } = await mountRows((tag) =>
      `<div><template data-wcs="for: users"><template data-wcs="if: .show"><${tag} data-wcs="${binding}"></${tag}></template></template></div>`,
    disconnectLogger(log), FLAGS, NAME_ONLY);
    await write((state) => { state.users = [state.users[0], state.users[2]]; });
    // 旧: ["read:Cy"] と書き込み Cy:gone:Cy
    expect(log).toEqual([REMOVED(tag)]);
    expect(flagsOf(read((state) => state.users) as any[])).toEqual(["Anna:-", "Cy:-"]);
    host.remove();
  });

  it("入れ子の for で外側の行を消すと、その行の要素は投げ、残った外側の行を読み書きしないこと", async () => {
    const log: string[] = [];
    const { host, tag, write, read } = await mountRows((tag) =>
      `<div><template data-wcs="for: groups"><section><template data-wcs="for: .users"><${tag} data-wcs="${binding}"></${tag}></template></section></template></div>`,
    disconnectLogger(log), GROUPS, NAME_ONLY);
    await write((state) => { state.groups = [state.groups[1]]; });
    // 旧: ["read:y-Ed", "read:y-Flo"] と書き込み y-Ed:gone:y-Ed, y-Flo:gone:y-Flo
    expect(log).toEqual([REMOVED(tag), REMOVED(tag)]);
    expect(flagsOf((read((state) => state.groups) as any[])[0].users)).toEqual(["y-Ed:-", "y-Flo:-"]);
    host.remove();
  });

  it("外側の行をコピーに差し替えると、内側の要素の $disconnectedCallback も投げ（外側の行は差し替わった）、再接続の $connectedCallback は新しい外側の行を読むこと", async () => {
    const log: string[] = [];
    const { host, tag, write } = await mountRows((tag) =>
      `<div><template data-wcs="for: groups"><section><template data-wcs="for: .users"><${tag} data-wcs="${binding}"></${tag}></template></section></template></div>`,
    () => ({
      ...disconnectLogger(log)(),
      $connectedCallback(this: any) { log.push(`connect:${this.name}`); },
    }), GROUPS, NAME_ONLY);
    log.length = 0;
    await write((state) => { state.groups = state.groups.map((group: any) => ({ ...group })); });
    // 旧: 消えた行の位置を読み、コピーが同じ位置に居たので ["read:x-Anna", …] と偶然同じ値になっていた
    expect(log.filter((entry) => entry.startsWith("threw:") || entry.startsWith("read:"))).toEqual([REMOVED(tag), REMOVED(tag), REMOVED(tag), REMOVED(tag)]);
    expect(log.filter((entry) => entry.startsWith("connect:")).sort()).toEqual(["connect:x-Anna", "connect:x-Ben", "connect:y-Ed", "connect:y-Flo"]);
    host.remove();
  });

  it("行が生きている（祖先の if: が for ごと隠した）ときは、その行を読み書きすること", async () => {
    const log: string[] = [];
    const { host, write, read } = await mountRows((tag) =>
      `<div><template data-wcs="if: on"><template data-wcs="for: users"><${tag} data-wcs="${binding}"></${tag}></template></template></div>`,
    disconnectLogger(log), FLAGS, NAME_ONLY);
    await write((state) => { state.on = false; });
    expect(log).toEqual(["read:Anna", "read:Ben", "read:Cy"]);
    expect(flagsOf(read((state) => state.users) as any[])).toEqual(["Anna:gone:Anna", "Ben:gone:Ben", "Cy:gone:Cy"]);
    host.remove();
  });

  const IN_IF = (tag: string) =>
    `<div><template data-wcs="for: users"><template data-wcs="if: .show"><${tag} data-wcs="${binding}"></${tag}></template></template></div>`;

  it("$disconnectedCallback から呼んだメソッドも、残っている別の行を読み書きしないこと", async () => {
    const log: string[] = [];
    const { host, tag, write, read } = await mountRows(IN_IF, () => ({
      cleanup(this: any) {
        try {
          log.push(`read:${this.name}`);
          this.flag = `gone:${this.name}`;
        } catch (error: any) {
          log.push(`threw:${error.message}`);
        }
      },
      $disconnectedCallback(this: any) { try { this.cleanup(); } catch (error: any) { log.push(`threw:${error.message}`); } },
    }), FLAGS, NAME_ONLY);
    await write((state) => { state.users = [state.users[0], state.users[2]]; });
    expect(log).toEqual([REMOVED(tag)]);
    expect(flagsOf(read((state) => state.users) as any[])).toEqual(["Anna:-", "Cy:-"]);
    host.remove();
  });

  it("$disconnectedCallback から呼んだ async メソッドは、await の間に要素が別の行に使い回されても、その行に書かないこと", async () => {
    const log: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { host, tag, write, read } = await mountRows(IN_IF, () => ({
      async save(this: any) {
        await gate;
        try {
          this.flag = `saved:${this.name}`;
          log.push("wrote");
        } catch (error: any) {
          log.push(`threw:${error.message}`);
        }
      },
      $disconnectedCallback(this: any) { try { this.save().catch(() => {}); } catch (error: any) { log.push(`threw:${error.message}`); } },
    }), FLAGS, NAME_ONLY);
    await write((state) => { state.users = [state.users[0], state.users[2]]; });
    await write((state) => { state.users = [...state.users, { name: "Dan", flag: "-", show: true }]; });
    release();
    await write(() => {});
    expect(log).toEqual([REMOVED(tag)]);
    expect(flagsOf(read((state) => state.users) as any[])).toEqual(["Anna:-", "Cy:-", "Dan:-"]);
    host.remove();
  });
});

/** async `$connectedCallback`: 門が開くまで待ってから、ツリーのキーを読み行のキーに書く */
function gatedConnect(log: string[], gates: (() => void)[], armed: { on: boolean }): () => Record<string, any> {
  return () => ({
    async $connectedCallback(this: any) {
      if (!armed.on) return;
      await new Promise<void>((resolve) => gates.push(resolve));
      try {
        log.push(`resume:${this.name}`);
        this.flag = `late:${this.name}`;
      } catch (error: any) {
        log.push(`threw:${error.message}`);
      }
    },
  });
}

describe.each(["state: .", "state.name: .name; state.flag: .flag"])("async $connectedCallback の await の後（#368・%s）", (binding) => {
  it("要素が別の行に使い回されていたら、行が消えた旨で投げ、どちらの行にも書かないこと", async () => {
    const log: string[] = [];
    const gates: (() => void)[] = [];
    const armed = { on: false };
    const { host, tag, write, read } = await mountRows(FOR(binding), gatedConnect(log, gates, armed), FLAGS, NAME_ONLY);
    armed.on = true;
    await write((state) => { state.users = [state.users[0], state.users[2]]; });
    await write((state) => { state.users = [...state.users, { name: "Dan", flag: "-" }]; }); // Ben の要素 → Dan（待機 1）
    await write((state) => { state.users = [state.users[0], state.users[1]]; }); // Dan を消す
    await write((state) => { state.users = [...state.users, { name: "Eve", flag: "-" }]; }); // 同じ要素 → Eve（待機 2）
    gates.shift()!();
    await write(() => {});
    // 旧: 待機 1 が Eve の行に "late:Eve" を書いていた
    expect(log).toEqual([`threw:[@wcstack/state] The host row of <${tag}> was removed.`]);
    expect(flagsOf(read((state) => state.users) as any[])).toEqual(["Anna:-", "Cy:-", "Eve:-"]);
    gates.shift()!();
    await write(() => {});
    expect(flagsOf(read((state) => state.users) as any[])).toEqual(["Anna:-", "Cy:-", "Eve:late:Eve"]);
    host.remove();
  });

  it("行が消えただけ（行の中の if: の要素・使い回しなし）でも投げ、消えた行の位置の別の行に書かないこと", async () => {
    const log: string[] = [];
    const gates: (() => void)[] = [];
    const armed = { on: false };
    const { host, tag, write, read } = await mountRows((t) =>
      `<div><template data-wcs="for: users"><template data-wcs="if: .show"><${t} data-wcs="${binding}"></${t}></template></template></div>`,
    gatedConnect(log, gates, armed), FLAGS, NAME_ONLY);
    armed.on = true;
    await write((state) => { state["users.1.show"] = false; });
    await write((state) => { state["users.1.show"] = true; }); // Ben の再表示（待機）
    await write((state) => { state.users = [state.users[0], state.users[2]]; });
    gates.shift()!();
    await write(() => {});
    expect(log).toEqual([`threw:[@wcstack/state] The host row of <${tag}> was removed.`]);
    expect(flagsOf(read((state) => state.users) as any[])).toEqual(["Anna:-", "Cy:-"]);
    host.remove();
  });

  it("行が動いただけなら、その行に書くこと", async () => {
    const log: string[] = [];
    const gates: (() => void)[] = [];
    const armed = { on: false };
    const { host, write, read } = await mountRows(FOR(binding), gatedConnect(log, gates, armed), FLAGS, NAME_ONLY);
    armed.on = true;
    await write((state) => { state.users = [state.users[0], state.users[2]]; });
    await write((state) => { state.users = [...state.users, { name: "Dan", flag: "-" }]; });
    await write((state) => { state.users = [state.users[2], state.users[0], state.users[1]]; });
    gates.shift()!();
    await write(() => {});
    expect(log).toEqual(["resume:Dan"]);
    expect(flagsOf(read((state) => state.users) as any[])).toEqual(["Dan:late:Dan", "Anna:-", "Cy:-"]);
    host.remove();
  });
});

describe("マウントしたコンポーネントの中にマウントしたコンポーネント（#368）", () => {
  it("外側の行を使い回すと、内側（部分マウント）の $connectedCallback も新しい行を読むこと", async () => {
    const inner = defineRow(SEEN, INNER);
    const { host, rows, texts, write } = await mountRows(FOR("state.name: .name"), SEEN, USERS,
      `${INNER}<${inner} data-wcs="state.name: name"></${inner}>`);
    const innerSeen = () => rows().map((row) => row.shadowRoot!.querySelector(inner).shadowRoot.querySelector(".seen").textContent);
    expect(innerSeen()).toEqual(["saw Anna", "saw Ben", "saw Cy"]);
    await write((state) => { state.users = [state.users[0], state.users[2]]; });
    await write((state) => { state.users = [...state.users, { name: "Dan" }]; });
    expect(texts(".seen")).toEqual(["saw Anna", "saw Cy", "saw Dan"]);
    // 旧: 内側は元の位置（1）にいまある Cy を読んで "saw Cy"
    expect(innerSeen()).toEqual(["saw Anna", "saw Cy", "saw Dan"]);
    host.remove();
  });
});

const TID_INNER = '<span class="name">{{ name }}</span><span class="tid">{{ tid }}</span>';
const IN_ROW_IF = (binding: string) => (tag: string) =>
  `<div><template data-wcs="for: users"><template data-wcs="if: .show"><${tag} data-wcs="${binding}"></${tag}></template></template></div>`;
const OUTER_IF = (binding: string) => (tag: string) =>
  `<div><template data-wcs="if: on"><template data-wcs="for: users"><${tag} data-wcs="${binding}"></${tag}></template></template></div>`;

describe.each(["state: .", "state.name: .name"])("$disconnectedCallback の後始末（私有キー）— 行が消えても自分の値を読むこと（#368・%s）", (binding) => {
  const layouts: Record<string, (b: string) => (tag: string) => string> = { row: FOR, inIf: IN_ROW_IF, outerIf: OUTER_IF };
  const ops: Record<string, (state: any) => void> = {
    removeMid: (state) => { state.users = [state.users[0], state.users[2]]; },
    clear: (state) => { state.users = []; },
    replaceAll: (state) => { state.users = [{ name: "Dan", flag: "-", show: true }, { name: "Eve", flag: "-", show: true }]; },
    elemWrite: (state) => { state["users.1"] = { name: "Dan", flag: "-", show: true }; },
    hideRow: (state) => { state["users.1.show"] = false; },
    hideAll: (state) => { state.on = false; },
  };
  const cases: [string, string][] = [
    ["row", "removeMid"], ["row", "clear"], ["row", "replaceAll"],
    ["inIf", "removeMid"], ["inIf", "clear"], ["inIf", "replaceAll"], ["inIf", "elemWrite"], ["inIf", "hideRow"],
    ["outerIf", "removeMid"], ["outerIf", "clear"], ["outerIf", "replaceAll"], ["outerIf", "hideAll"],
  ];
  it.each(cases)("%s × %s: 接続で置いたタイマーの id を切断で読み、漏れが無いこと", async (layout, op) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const active = new Set<number>();
    let seq = 0;
    const { host, texts, write } = await mountRows(layouts[layout](binding), () => ({
      tid: 0,
      $connectedCallback(this: any) { const id = ++seq; this.tid = id; active.add(id); },
      $disconnectedCallback(this: any) { active.delete(this.tid); },
    }), FLAGS, TID_INNER);
    await write(ops[op]);
    // 旧（main）: 完全マウントは ListIndex not found: users.*.#m<id>.tid で投げるか 0 を読み、消えた行のタイマーが残っていた
    expect([...active].sort()).toEqual(texts(".tid").map(Number).sort());
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("$disconnectedCallback から呼んだメソッドの中でも、自分のキーを読めること", async () => {
    const active = new Set<number>();
    let seq = 0;
    const { host, texts, write } = await mountRows(FOR(binding), () => ({
      tid: 0,
      stop(this: any) { active.delete(this.tid); },
      $connectedCallback(this: any) { const id = ++seq; this.tid = id; active.add(id); },
      $disconnectedCallback(this: any) { this.stop(); },
    }), FLAGS, TID_INNER);
    await write((state) => { state.users = [state.users[0], state.users[2]]; });
    expect([...active].sort()).toEqual(texts(".tid").map(Number).sort());
    host.remove();
  });
});

/** `$connectedCallback` の `this` を名前ごとに取っておく（README の時計の形 — setInterval の中の this） */
function savingConnect(saved: Map<string, any>): () => Record<string, any> {
  return () => ({
    $connectedCallback(this: any) {
      const name = this.name;
      if (!saved.has(name)) saved.set(name, this);
    },
  });
}

describe.each(["state: .", "state.name: .name; state.flag: .flag"])("取っておいたライフサイクルの this の着地（#368・%s）", (binding) => {
  it("行の中の if: が要素を隠しただけ（行は生きている）なら、その行に書けること（旧 wJ: 行が消えた旨で投げた）", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const saved = new Map<string, any>();
    const { host, write, read } = await mountRows(IN_ROW_IF(binding), savingConnect(saved), FLAGS, NAME_ONLY);
    await write((state) => { state["users.1.show"] = false; });
    const ben = saved.get("Ben");
    ben.flag = `late:${ben.name}`;
    expect(flagsOf(read((state) => state.users) as any[])).toEqual(["Anna:-", "Ben:late:Ben", "Cy:-"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("要素の書き込みでその場の行が差し替わった（切断されていない）なら、要素について新しい行に書くこと", async () => {
    const saved = new Map<string, any>();
    const { host, write, read } = await mountRows(FOR(binding), savingConnect(saved), FLAGS, NAME_ONLY);
    await write((state) => { state["users.1"] = { name: "Dan", flag: "-", show: true }; });
    const ben = saved.get("Ben");
    expect(ben.name).toBe("Dan");
    ben.flag = "late";
    expect(flagsOf(read((state) => state.users) as any[])).toEqual(["Anna:-", "Dan:late", "Cy:-"]);
    host.remove();
  });

  it("隠れている間に公開面から呼んだ async メソッドは、同じ行に再表示された後にその行へ書くこと", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { host, rows, write, read } = await mountRows(IN_ROW_IF(binding), () => ({
      async save(this: any, value: string) { await gate; this.flag = `${value}:${this.name}`; },
    }), FLAGS, NAME_ONLY);
    const ben = rows()[1];
    await write((state) => { state["users.1.show"] = false; });
    const result = ben.state.save("ext");
    await write((state) => { state["users.1.show"] = true; });
    release();
    await result;
    await settle();
    expect(flagsOf(read((state) => state.users) as any[])).toEqual(["Anna:-", "Ben:ext:Ben", "Cy:-"]);
    host.remove();
  });

  it("行の中の if: が隠した $disconnectedCallback は、自分の行を読み書きすること", async () => {
    const log: string[] = [];
    const { host, write, read } = await mountRows(IN_ROW_IF(binding), disconnectLogger(log), FLAGS, NAME_ONLY);
    await write((state) => { state["users.1.show"] = false; });
    expect(log).toEqual(["read:Ben"]);
    expect(flagsOf(read((state) => state.users) as any[])).toEqual(["Anna:-", "Ben:gone:Ben", "Cy:-"]);
    host.remove();
  });

  it("$connectedCallback と同じ接続の $disconnectedCallback は同じ this を受け取ること", async () => {
    const seen = new WeakSet<object>();
    const log: string[] = [];
    const { host, write } = await mountRows(FOR(binding), () => ({
      $connectedCallback(this: any) { seen.add(this); },
      $disconnectedCallback(this: any) { log.push(`same:${seen.has(this)}`); },
    }), FLAGS, NAME_ONLY);
    await write((state) => { state.users = [state.users[0], state.users[2]]; });
    expect(log).toEqual(["same:true"]);
    host.remove();
  });
});

describe("マウントしたコンポーネントの中のマウント — 外側の <wcs-state> が内側の要素より後にあっても（#368）", () => {
  it("外側の行を使い回すと、内側の $connectedCallback は新しい行を読むこと", async () => {
    const inner = defineRow(SEEN, INNER);
    const outer = uniqueTag("mrrc-outer");
    class Outer extends HTMLElement {
      state: Record<string, any> = { seen: "-" };
      constructor() {
        super();
        this.attachShadow({ mode: "open" }).innerHTML =
          `${INNER}<${inner} data-wcs="state.name: name"></${inner}><wcs-state bind-component="state"></wcs-state>`;
      }
    }
    customElements.define(outer, Outer);
    const { host, shadowRoot, write } = await mountRows(() =>
      `<div><template data-wcs="for: users"><${outer} data-wcs="state.name: .name"></${outer}></template></div>`);
    await settle();
    const innerSeen = () => Array.from(shadowRoot.querySelectorAll(outer)).map((element) =>
      (element.shadowRoot!.querySelector(inner) as any).shadowRoot.querySelector(".seen").textContent);
    expect(innerSeen()).toEqual(["saw Anna", "saw Ben", "saw Cy"]);
    await write((state) => { state.users = [state.users[0], state.users[2]]; });
    await write((state) => { state.users = [...state.users, { name: "Dan" }]; });
    // 旧: 内側は元の位置（1）にいまある Cy を読んで "saw Cy"
    expect(innerSeen()).toEqual(["saw Anna", "saw Cy", "saw Dan"]);
    host.remove();
  });
});

describe("行の外のコンポーネントの取っておいた this（#368）", () => {
  it("切断・再接続の後も、取っておいた $connectedCallback の this で読み書きできること", async () => {
    const saved: any[] = [];
    const { host, shadowRoot, write, read } = await mountRows((tag) => `<div><${tag} data-wcs="state: user"></${tag}></div>`,
      () => ({ $connectedCallback(this: any) { saved.push(this); } }),
      '{"user":{"name":"Zed"}}', NAME_ONLY);
    const element = shadowRoot.querySelector("div")!.firstElementChild!;
    const parent = element.parentNode!;
    element.remove();
    await settle();
    parent.appendChild(element);
    await settle();
    expect(saved).toHaveLength(2);
    expect(saved[0].name).toBe("Zed");
    saved[0].name = "Zed2";
    await write(() => {});
    expect(read((state) => state["user.name"])).toBe("Zed2");
    host.remove();
  });
});

describe("shadow を connectedCallback で組み直す行の部品 — 外れた古い <wcs-state> に届く接続の反応（#368）", () => {
  it("行を差し替えても、外れた古い <wcs-state> の再接続は張り替えをせず、投げないこと（e2e: state-bind-component-row-replace）", async () => {
    const rejected: unknown[] = [];
    const markup = `<wcs-state bind-component="state"></wcs-state><span class="row-view">{{ row.id }}</span>`;
    const tag = uniqueTag("mrrc-cc");
    class RowByCc extends HTMLElement {
      state: Record<string, any> = {};
      constructor() {
        super();
        this.attachShadow({ mode: "open" });
      }
      connectedCallback() {
        const previous = this.shadowRoot!.querySelector("wcs-state") as any;
        this.shadowRoot!.innerHTML = markup;
        if (previous !== null) {
          // Chromium は、挿入で積んだ古い <wcs-state> の接続の反応を innerHTML の差し替えの後（外れた後）に
          // 届け、続けて切断の反応を届ける（CEReactions）。happy-dom は外す前に届けるので、同じ順を足す
          previous.connectedCallback().catch((error: unknown) => { rejected.push(error); });
          previous.disconnectedCallback();
        }
      }
    }
    customElements.define(tag, RowByCc);
    const { host, shadowRoot, write } = await mountRows(() =>
      `<ul><template data-wcs="for: groups"><li><span class="gid">{{ groups.*.id }}</span><${tag} data-wcs="state.row: groups.*"></${tag}></li></template></ul>`,
    SEEN, '{"groups":[{"id":"g1"},{"id":"g2"}]}');
    await settle();
    const views = () => Array.from(shadowRoot.querySelectorAll(tag)).map((row) => row.shadowRoot!.querySelector(".row-view")?.textContent);
    expect(views()).toEqual(["g1", "g2"]);
    await write((state) => { state.groups = [{ id: "g9" }]; });
    expect(views()).toEqual(["g9"]);
    await write((state) => { state.groups = [{ id: "gA" }, { id: "gB" }, { id: "gC" }]; });
    expect(views()).toEqual(["gA", "gB", "gC"]);
    // 旧（前回の wJ）: Invalid value used as weak map key（スコープ根が null のまま同期で張り替えた）
    expect(rejected.map((error: any) => error.message)).toEqual([]);
    host.remove();
  });
});

describe.each(["state: .", "state.name: .name; state.flag: .flag"])("要素の書き込みで差し替わった行の、取っておいた this（#368・%s）", (binding) => {
  const OUTER = (tag: string) =>
    `<div><template data-wcs="if: on"><template data-wcs="for: users"><${tag} data-wcs="${binding}"></${tag}></template></template></div>`;
  const after: [string, ((state: any) => void)[]][] = [
    ["並べ替え", [(state) => { state.users = [state.users[1], state.users[0], state.users[2]]; }]],
    ["for ごと隠す", [(state) => { state.on = false; }]],
    ["隠して戻す", [(state) => { state.on = false; }, (state) => { state.on = true; }]],
  ];
  it.each(after)("差し替えの後に%sしても、取っておいた this は差し替わった行（Dan）に書くこと", async (_label, ops) => {
    const saved = new Map<string, any>();
    const { host, write, read } = await mountRows(OUTER, savingConnect(saved), FLAGS, NAME_ONLY);
    await write((state) => { state["users.1"] = { name: "Dan", flag: "-", show: true }; });
    for (const op of ops) await write(op);
    const ben = saved.get("Ben");
    // 旧（前回の wJ）: 接続の始まりの行（Ben）に留まり、The host row of <x> was removed. で投げた
    expect(ben.name).toBe("Dan");
    ben.flag = "late";
    expect((read((state) => state.users) as any[]).find((user) => user.name === "Dan").flag).toBe("late");
    host.remove();
  });
});

describe("部品の shadow の中の for にある部品 — 外の行を使い回したとき（#368）", () => {
  it.each(["state: .", "state.name: .name; state.note: .note"])("内側の $connectedCallback が、残っている別の行に書かないこと（%s）", async (binding) => {
    // 書いた要素を名乗らせる（行の名前だけだと、別の行に位置で書いても見分けられない）
    let serial = 0;
    const inner = uniqueTag("mrrc-inner");
    class Inner extends HTMLElement {
      serial = ++serial;
      state: Record<string, any> = ((element: Inner) => ({
        $connectedCallback(this: any) { this.note = `${this.name} by #${element.serial}`; },
      }))(this);
      constructor() {
        super();
        this.attachShadow({ mode: "open" }).innerHTML = '<wcs-state bind-component="state"></wcs-state><b class="n">{{ name }}</b>';
      }
    }
    customElements.define(inner, Inner);
    const outer = defineRow(() => ({}), `<template data-wcs="for: items"><${inner} data-wcs="${binding}"></${inner}></template>`);
    const json = '{"groups":[{"items":[{"name":"a1","note":"-"}]},{"items":[{"name":"b1","note":"-"}]}]}';
    const { host, write, read } = await mountRows(() =>
      `<div><template data-wcs="for: groups"><${outer} data-wcs="state: ."></${outer}></template></div>`, SEEN, json);
    await settle();
    const notes = () => (read((state) => state.groups) as any[]).map((group) => group.items[0].note);
    const [a1Note, b1Note] = notes();
    expect(a1Note).toMatch(/^a1 by #\d+$/);
    expect(b1Note).toMatch(/^b1 by #\d+$/);
    await write((state) => {
      state.groups = [state.groups[1], { items: [{ name: "c1", note: "-" }] }];
    });
    // 旧（main）: a1 の外の行を c1 に使い回すと、a1 を描いていた中の要素が再接続の瞬間に位置で読み、
    // 生きている b1 に "b1 by #<a1 の要素>" を書いた
    expect(notes()).toEqual([b1Note, `c1 by #${a1Note.split("#")[1]}`]);
    host.remove();
  });
});

describe("行の外の部品のライフサイクルの this（#368）", () => {
  it("element.state と同じもので、接続をまたいで同じであること", async () => {
    const seen: object[] = [];
    let element!: any;
    const { host, shadowRoot } = await mountRows((tag) => `<div><${tag} data-wcs="state: user"></${tag}></div>`,
      () => ({ $connectedCallback(this: any) { seen.push(this); }, $disconnectedCallback(this: any) { seen.push(this); } }),
      '{"user":{"name":"Zed"}}', NAME_ONLY);
    element = shadowRoot.querySelector("div")!.firstElementChild;
    const parent = element.parentNode;
    element.remove();
    await settle();
    parent.appendChild(element);
    await settle();
    expect(seen).toHaveLength(3);
    expect(seen.every((self) => self === element.state)).toBe(true);
    host.remove();
  });
});

describe("部分マウントの私有キーは要素ごとに 1 組（#368・README の注記の裏付け）", () => {
  it("$disconnectedCallback が私有キーに書いた値は、要素が別の行に使い回されても残っていること", async () => {
    const { host, rows, texts, write } = await mountRows(FOR("state.name: .name"), () => ({
      seen: "-",
      $disconnectedCallback(this: any) { this.seen = "bye"; },
    }));
    const ben = rows()[1];
    await write((state) => { state.users = [state.users[0], state.users[2]]; });
    await write((state) => { state.users = [...state.users, { name: "Dan" }]; });
    expect(rows()[2]).toBe(ben);
    // 部分マウントの私有キーは行ごとではなく要素ごと — 完全マウント（state: .）は行ごとに作り直す
    expect(texts(".seen")).toEqual(["-", "-", "bye"]);
    host.remove();
  });
});
