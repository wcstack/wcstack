/**
 * Phase 2 slice 2 — オーバーレイ（D20 / D21）のプローブ統合テスト。
 *
 * 私有キー・getter・メソッドは予約セグメント（`#m<id>`）の絶対アドレスに載り、
 * 親 handler の dispatch は「マーカーで終わるパス」の 1 点だけ。それより深い読み書きは
 * 通常の親ウォークがオーバーレイ proxy への素の Reflect.get / Reflect.set として続く。
 * まだ State.ts には配線されていない（mountScope プローブと同じ組み立て方）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { buildMountRecord, IMountRecord } from "../src/webComponent/mount";
import { initializeMountScope } from "../src/webComponent/mountScope";
import { createPublicMountState } from "../src/webComponent/overlay";
import { getBindingsByNode } from "../src/bindings/getBindingsByNode";

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));

let counter = 0;
const uniqueTag = (prefix: string): string => `${prefix}-${++counter}`;

function defineShell(tag: string, innerTemplate: string): void {
  class Shell extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
    }
    connectedCallback() {
      if (this.shadowRoot!.childElementCount === 0) {
        this.shadowRoot!.innerHTML = innerTemplate;
      }
    }
  }
  customElements.define(tag, Shell);
}

async function mountHost(json: string, body: string) {
  const host = document.createElement(uniqueTag("mo-host"));
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `<wcs-state json='${json}'></wcs-state>${body}`;
  document.body.appendChild(host);
  const parentStateElement = shadowRoot.querySelector("wcs-state") as State;
  await parentStateElement.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  await flush();
  await flush();
  return { host, shadowRoot, parentStateElement };
}

function mountComponent(component: Element, parentStateElement: State, stateObject: Record<string, any>): IMountRecord {
  const hostBindings = (getBindingsByNode(component) ?? []).filter((b) => b.propSegments[0] === "state");
  const record = buildMountRecord(component, "state", hostBindings, parentStateElement as any, stateObject);
  initializeMountScope(record, component.shadowRoot as ShadowRoot);
  return record;
}

const text = (root: ParentNode, selector: string) => (root.querySelector(selector) as HTMLElement).textContent;

describe("mountOverlay: 私有キー（R1 / D21）", () => {
  it("私有キーはツリーに載らず、インスタンスごとに独立で、公開 chroot から読み書きできること", async () => {
    const tag = uniqueTag("mo-priv");
    defineShell(tag,
      `<span class="name" data-wcs="textContent: name"></span>` +
      `<span class="mode" data-wcs="textContent: mode"></span>`);
    const { host, shadowRoot, parentStateElement } = await mountHost(
      '{"user":{"name":"Alice"}}',
      `<${tag} id="a" data-wcs="state: user"></${tag}><${tag} id="b" data-wcs="state: user"></${tag}>`,
    );
    const a = shadowRoot.querySelector("#a")!;
    const b = shadowRoot.querySelector("#b")!;
    const recordA = mountComponent(a, parentStateElement, { mode: "view" });
    mountComponent(b, parentStateElement, { mode: "view" });
    await flush();

    expect(text(a.shadowRoot!, ".name")).toBe("Alice");
    expect(text(a.shadowRoot!, ".mode")).toBe("view");
    expect(text(b.shadowRoot!, ".mode")).toBe("view");

    const stateA = createPublicMountState(recordA);
    expect(stateA.mode).toBe("view");
    expect(stateA.name).toBe("Alice");

    stateA.mode = "edit";
    await flush();
    await flush();

    expect(text(a.shadowRoot!, ".mode")).toBe("edit");
    expect(text(b.shadowRoot!, ".mode")).toBe("view");
    expect(stateA.mode).toBe("edit");
    parentStateElement.createState("readonly", (s: any) => {
      expect("mode" in s.user).toBe(false);
    });

    // chroot 経由のツリー書き込みは親スコープに届く
    stateA.name = "Eve";
    await flush();
    await flush();
    expect(text(a.shadowRoot!, ".name")).toBe("Eve");
    expect(text(b.shadowRoot!, ".name")).toBe("Eve");
    parentStateElement.createState("readonly", (s: any) => {
      expect(s["user.name"]).toBe("Eve");
    });

    host.remove();
  });
});

describe("mountOverlay: getter（chroot 評価と依存追跡）", () => {
  it("単純 getter が this でツリーと私有を読み、どちらの変更でも再評価されること", async () => {
    const tag = uniqueTag("mo-getter");
    defineShell(tag, `<span class="display" data-wcs="textContent: display"></span>`);
    const { host, shadowRoot, parentStateElement } = await mountHost(
      '{"user":{"name":"Alice"}}',
      `<${tag} data-wcs="state: user"></${tag}>`,
    );
    const component = shadowRoot.querySelector(tag)!;
    const record = mountComponent(component, parentStateElement, {
      suffix: "!",
      get display() { return `${this.name}${this.suffix}`; },
    });
    await flush();

    const cs = component.shadowRoot!;
    expect(text(cs, ".display")).toBe("Alice!");

    // ツリー側の依存（user.name → user.#m.display の動的エッジ）
    parentStateElement.createState("writable", (s: any) => {
      s["user.name"] = "Carol";
    });
    await flush();
    await flush();
    expect(text(cs, ".display")).toBe("Carol!");

    // 私有側の依存（user.#m.suffix → user.#m.display）
    const state = createPublicMountState(record);
    state.suffix = "?";
    await flush();
    await flush();
    expect(text(cs, ".display")).toBe("Carol?");

    host.remove();
  });

  it("ツリーのリストの上のワイルドカード getter が行ごとに評価され、行と私有の両方に追随すること", async () => {
    const tag = uniqueTag("mo-wcget");
    defineShell(tag,
      `<ul><template data-wcs="for: children"><li data-wcs="textContent: .label"></li></template></ul>`);
    const { host, shadowRoot, parentStateElement } = await mountHost(
      '{"group":{"children":[{"name":"x"},{"name":"y"}]}}',
      `<${tag} data-wcs="state: group"></${tag}>`,
    );
    const component = shadowRoot.querySelector(tag)!;
    const record = mountComponent(component, parentStateElement, {
      suffix: "s",
      get "children.*.label"() { return `${this["children.*.name"]}@${this.suffix}`; },
    });
    await flush();

    const labels = () => Array.from(component.shadowRoot!.querySelectorAll("li")).map((li) => li.textContent);
    expect(labels()).toEqual(["x@s", "y@s"]);

    parentStateElement.createState("writable", (s: any) => {
      s["group.children.0.name"] = "xx";
    });
    await flush();
    await flush();
    expect(labels()).toEqual(["xx@s", "y@s"]);

    const state = createPublicMountState(record);
    state.suffix = "z";
    await flush();
    await flush();
    expect(labels()).toEqual(["xx@z", "y@z"]);

    host.remove();
  });
});

describe("mountOverlay: メソッドと $n のスコープ補正", () => {
  it("onclick のメソッドが chroot を this に実行され、ツリーへ書けること", async () => {
    const tag = uniqueTag("mo-method");
    defineShell(tag,
      `<span class="name" data-wcs="textContent: name"></span>` +
      `<button class="btn" data-wcs="onclick: rename"></button>`);
    const { host, shadowRoot, parentStateElement } = await mountHost(
      '{"user":{"name":"Alice"}}',
      `<${tag} data-wcs="state: user"></${tag}>`,
    );
    const component = shadowRoot.querySelector(tag)!;
    mountComponent(component, parentStateElement, {
      rename() { this.name = "Zoe"; },
    });
    await flush();

    (component.shadowRoot!.querySelector(".btn") as HTMLElement).click();
    await flush();
    await flush();

    expect(text(component.shadowRoot!, ".name")).toBe("Zoe");
    parentStateElement.createState("readonly", (s: any) => {
      expect(s["user.name"]).toBe("Zoe");
    });

    host.remove();
  });

  it("行マウント（Δ=1）の内側 for で $1 がスコープ内の添字になること", async () => {
    const tag = uniqueTag("mo-idx");
    defineShell(tag,
      `<ul><template data-wcs="for: tags"><li>{{ $1 }}</li></template></ul>`);
    const { host, shadowRoot, parentStateElement } = await mountHost(
      '{"users":[{"tags":[{"n":1}]},{"tags":[{"n":1},{"n":2}]}]}',
      `<div id="rows"><template data-wcs="for: users"><${tag} data-wcs="state: ."></${tag}></template></div>`,
    );
    const rows = Array.from(shadowRoot.querySelectorAll(tag));
    for (const row of rows) {
      mountComponent(row, parentStateElement, {});
    }
    await flush();

    const indexes = (i: number) => Array.from(rows[i].shadowRoot!.querySelectorAll("li")).map((li) => li.textContent);
    // 作者の $1 は「自分のスコープの 1 段目」＝内側 for の添字（ホスト行の添字ではない）
    expect(indexes(0)).toEqual(["0"]);
    expect(indexes(1)).toEqual(["0", "1"]);

    host.remove();
  });

  it("行マウントの私有キーが行のインスタンスに付き、swap で行と一緒に動くこと（D21）", async () => {
    const tag = uniqueTag("mo-rowpriv");
    defineShell(tag,
      `<span class="name" data-wcs="textContent: name"></span>` +
      `<span class="note" data-wcs="textContent: note"></span>`);
    const { host, shadowRoot, parentStateElement } = await mountHost(
      '{"users":[{"name":"Anna"},{"name":"Ben"}]}',
      `<div id="rows"><template data-wcs="for: users"><${tag} data-wcs="state: ."></${tag}></template></div>`,
    );
    const rowEls = () => Array.from(shadowRoot.querySelectorAll(tag));
    const records: IMountRecord[] = [];
    for (const row of rowEls()) {
      records.push(mountComponent(row, parentStateElement, { note: "-" }));
    }
    await flush();

    const notes = () => rowEls().map((row) => text(row.shadowRoot!, ".note"));
    const names = () => rowEls().map((row) => text(row.shadowRoot!, ".name"));
    expect(notes()).toEqual(["-", "-"]);

    // 行 0 の私有キーに書く
    createPublicMountState(records[0]).note = "starred";
    await flush();
    await flush();
    expect(notes()).toEqual(["starred", "-"]);

    // swap: listIndex は行と一緒に動くので、私有キーも行に付いて回る
    parentStateElement.createState("writable", (s: any) => {
      s.users = [s.users[1], s.users[0]];
    });
    await flush();
    await flush();
    expect(names()).toEqual(["Ben", "Anna"]);
    expect(notes()).toEqual(["-", "starred"]);

    host.remove();
  });
});

/* ------------------------------------------------------------------ *
 * slice 3 — 実配線（<wcs-state bind-component> 経由）のオーバーレイ面
 * ------------------------------------------------------------------ */

function defineWiredComponent(tag: string, createState: () => Record<string, any>, innerTemplate: string): void {
  class Component extends HTMLElement {
    state: Record<string, any> = createState();
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
    }
    connectedCallback() {
      this.shadowRoot!.innerHTML = `<wcs-state bind-component="state"></wcs-state>${innerTemplate}`;
    }
  }
  customElements.define(tag, Component);
}

async function childReady(component: Element): Promise<void> {
  const childShadow = component.shadowRoot!;
  const childStateElement = childShadow.querySelector("wcs-state") as State;
  await childStateElement.connectedCallbackPromise;
  await State.getBindingsReady(childShadow);
  await flush();
}

describe("mountOverlay: 実配線（slice 3）", () => {
  it("setter アクセサ・メソッド・$postUpdate・has が chroot で成立すること", async () => {
    const tag = uniqueTag("mo-wired");
    defineWiredComponent(tag, () => ({
      count: "1",
      get display() { return `c${this.count}`; },
      // 私有キーの直接代入はオーバーレイ内で完結する（親を通らない）ので、
      // 再評価させたいときは作者が $postUpdate を打つ — D21 の規範形
      set counter(v: any) { this.count = v; this.$postUpdate("display"); },
      bump() { (this as any).counter = "9"; },
      // オーバーレイの has トラップ（作者コードの `in this`）の面を 1 つの getter で踏む
      get summary() {
        const hits = ["count", "display", "bump", "name"].filter((k) => k in (this as any));
        const leaked = ("$x" in (this as any)) || ("#z" in (this as any));
        return hits.join(",") + (leaked ? "!" : "");
      },
    }),
      `<span class="display" data-wcs="textContent: display"></span>` +
      `<span class="summary" data-wcs="textContent: summary"></span>` +
      `<button class="b" data-wcs="onclick: bump"></button>`);
    const { host, shadowRoot } = await mountHost(
      '{"user":{"name":"Alice"}}',
      `<${tag} data-wcs="state: user"></${tag}>`,
    );
    const card = shadowRoot.querySelector(tag)!;
    await childReady(card);
    const cs = card.shadowRoot!;
    const publicState = (card as any).state as Record<string, any>;

    expect(text(cs, ".display")).toBe("c1");

    // メソッド（onclick）→ setter アクセサ → 私有書き込み + $postUpdate
    (cs.querySelector(".b") as HTMLElement).click();
    await flush();
    await flush();
    expect(text(cs, ".display")).toBe("c9");
    expect(publicState.count).toBe("9");

    // 公開 chroot の私有キー書き込みは親ウォークを通るので通知も届く
    publicState.count = "5";
    await flush();
    await flush();
    expect(text(cs, ".display")).toBe("c5");

    // オーバーレイの has（作者コードの `in this`）: 私有・アクセサ・メソッド・ツリーが見える
    expect(text(cs, ".summary")).toBe("count,display,bump,name");

    // 公開面の has: 作者の面は own property、ツリーは「規則が解決するか」
    //（v1 innerState の has と同じ意味論 — ルートマウントでは未知キーも真）
    expect("count" in publicState).toBe(true);
    expect("display" in publicState).toBe(true);
    expect("name" in publicState).toBe(true);
    expect("anything" in publicState).toBe(true);
    expect("$anything" in publicState).toBe(false);
    expect("#m1" in publicState).toBe(false);

    // 公開面の $ キーは親の意味論のまま素通し（P2-9 までの契約）
    expect(typeof publicState.$postUpdate).toBe("function");
    // Promise 誤認ガードとシンボル
    expect(publicState.then).toBeUndefined();
    expect((publicState as any)[Symbol.iterator]).toBeUndefined();
    expect(() => { (publicState as any)[Symbol("x")] = 1; }).not.toThrow();

    host.remove();
  });

  it("getter 内の $n が行スコープの添字に補正されること（トラップの Δ 補正）", async () => {
    const tag = uniqueTag("mo-idx");
    defineWiredComponent(tag, () => ({
      get "tags.*.flag"() { return `i${(this as any).$1}`; },
    }),
      `<ul class="tags"><template data-wcs="for: tags"><li data-wcs="textContent: .flag"></li></template></ul>`);
    const { host, shadowRoot } = await mountHost(
      '{"users":[{"name":"Anna","tags":[{"name":"x"}]},{"name":"Ben","tags":[{"name":"y"},{"name":"z"}]}]}',
      `<div><template data-wcs="for: users"><${tag} data-wcs="state: ."></${tag}></template></div>`,
    );
    await flush();
    await flush();
    const rows = Array.from(shadowRoot.querySelectorAll(tag));
    for (const row of rows) {
      await childReady(row);
    }
    const tagsOf = (i: number) => Array.from(rows[i].shadowRoot!.querySelectorAll(".tags li")).map((li) => li.textContent);

    // 作者の $1 は自分のスコープの最初のワイルドカード（tags の添字）。
    // 翻訳後のパス users.*.tags.*.#m.flag では $2 に当たる — トラップが Δ を足す
    expect(tagsOf(0)).toEqual(["i0"]);
    expect(tagsOf(1)).toEqual(["i0", "i1"]);

    host.remove();
  });
});
