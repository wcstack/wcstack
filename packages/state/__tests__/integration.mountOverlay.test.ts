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

describe("mountOverlay: $ API の接頭辞翻訳（P2-9・設計書 §4-6）", () => {
  it("getter / メソッド内の $getAll・$resolve・$setAll が自スコープ相対で効くこと（行マウント）", async () => {
    const tag = uniqueTag("mo-dollar");
    defineWiredComponent(tag, () => ({
      get tagsJoined() { return ((this as any).$getAll("tags.*.name", []) as string[]).join(","); },
      renameFirst() { (this as any).$resolve("tags.*.name", [0], "Z"); },
      shoutAll() { (this as any).$setAll("tags.*.name", [], (v: string) => `${v}!`); },
    }),
      `<span class="joined" data-wcs="textContent: tagsJoined"></span>` +
      `<button class="first" data-wcs="onclick: renameFirst"></button>` +
      `<button class="all" data-wcs="onclick: shoutAll"></button>`);
    const { host, shadowRoot } = await mountHost(
      '{"users":[{"tags":[{"name":"x"}]},{"tags":[{"name":"y"},{"name":"z"}]}]}',
      `<div><template data-wcs="for: users"><${tag} data-wcs="state: ."></${tag}></template></div>`,
    );
    await flush();
    await flush();
    const rows = Array.from(shadowRoot.querySelectorAll(tag));
    for (const row of rows) {
      await childReady(row);
    }
    const joined = (i: number) => text(rows[i].shadowRoot!, ".joined");

    // $getAll: 各行の getter が「自分の行の tags だけ」を読む（先頭添字の合成）
    expect(joined(0)).toBe("x");
    expect(joined(1)).toBe("y,z");

    // $resolve 書き込み: 行 1 の先頭タグだけが変わる
    (rows[1].shadowRoot!.querySelector(".first") as HTMLElement).click();
    await flush();
    await flush();
    expect(joined(0)).toBe("x");
    expect(joined(1)).toBe("Z,z");

    // $setAll（mapper）: 行 0 の全タグだけが変わる
    (rows[0].shadowRoot!.querySelector(".all") as HTMLElement).click();
    await flush();
    await flush();
    expect(joined(0)).toBe("x!");
    expect(joined(1)).toBe("Z,z");

    // chroot 面: 行 1 の $getAll / $postUpdate も自スコープ相対
    const chroot1 = (rows[1] as any).state as Record<string, any>;
    expect(chroot1.$getAll("tags.*.name", [])).toEqual(["Z", "z"]);
    expect(() => chroot1.$postUpdate("tagsJoined")).not.toThrow();

    host.remove();
  });
});

describe("mountOverlay: トラップの端（シンボル・then・未解決キー）", () => {
  it("オーバーレイと公開 chroot がシンボル・then・未解決キーを安全に受けること", async () => {
    const { createOverlayValue } = await import("../src/webComponent/overlay");
    const { buildMountRecord: build } = await import("../src/webComponent/mount");
    const { createStateAddress } = await import("../src/address/StateAddress");
    const { getPathInfo } = await import("../src/address/PathInfo");

    // 部分マウントのみ（4b throw の形）の記録を直接組む
    const component = document.createElement("mo-edge-card");
    const parentStateElement = { name: "default", createState: (_m: string, cb: (s: any) => void) => cb({}) } as any;
    const record = build(component, "state", [{
      propName: "state.theme", propSegments: ["state", "theme"], propModifiers: [],
      statePathName: "theme", statePathInfo: getPathInfo("theme"), stateName: "default",
      inFilters: [], outFilters: [], bindingType: "prop", uuid: null,
      node: component, replaceNode: component,
    } as any], parentStateElement, { editing: "no" });

    const handler = {
      pushAddress() {}, popAddress() {}, beginUntrack() {}, endUntrack() {},
    } as any;
    const overlay = createOverlayValue(record, createStateAddress(getPathInfo(record.markerBasePath), null), {}, handler) as any;

    // get: シンボル / then
    const sym = Symbol("probe");
    expect(overlay[sym]).toBeUndefined();
    expect(overlay.then).toBeUndefined();
    // has: 未設定のシンボルは素の Reflect.has（false）
    expect(sym in overlay).toBe(false);
    // set: シンボルは素通し（target に載る＝has も真に転じる）
    expect(() => { overlay[sym] = 1; }).not.toThrow();
    expect(sym in overlay).toBe(true);
    // has: 部分マウントのみで解決しないキーは 4b throw を握って false
    expect("unresolvable" in overlay).toBe(false);
    // 私有キーは has が真
    expect("editing" in overlay).toBe(true);

    const { createPublicMountState } = await import("../src/webComponent/overlay");
    const chroot = createPublicMountState(record) as any;
    expect(chroot[sym]).toBeUndefined();
    expect(() => { chroot[sym] = 1; }).not.toThrow();
    expect(sym in chroot).toBe(false);
    // 公開 has も 4b throw を握って false
    expect("unresolvable" in chroot).toBe(false);
  });
});

describe("mountOverlay: $ ラッパと非 base オーバーレイの端", () => {
  function edgeRecord() {
    const component = document.createElement("mo-edge2-card");
    const parentStateElement = {
      name: "default",
      createState: (_m: string, cb: (s: any) => void) => cb({
        $resolve: (...args: unknown[]) => args,
        $other: "raw",
      }),
    } as any;
    return { component, parentStateElement };
  }

  it("listIndex の無いオーバーレイの $ ラッパが空の文脈添字で成立すること", async () => {
    const { createOverlayValue } = await import("../src/webComponent/overlay");
    const { buildMountRecord: build } = await import("../src/webComponent/mount");
    const { createStateAddress } = await import("../src/address/StateAddress");
    const { getPathInfo } = await import("../src/address/PathInfo");
    const { component, parentStateElement } = edgeRecord();
    const record = build(component, "state", [{
      propName: "state", propSegments: ["state"], propModifiers: [],
      statePathName: "user", statePathInfo: getPathInfo("user"), stateName: "default",
      inFilters: [], outFilters: [], bindingType: "prop", uuid: null,
      node: component, replaceNode: component,
    } as any], parentStateElement, {});
    const receiver = {
      $getAll: (...args: unknown[]) => ["got", ...args],
      $resolve: (...args: unknown[]) => ["res", ...args],
    } as any;
    const handler = { pushAddress() {}, popAddress() {} } as any;
    // listIndex null（Δ=0 のトップレベル）— contextIndexes は空列に倒れる
    const overlay = createOverlayValue(record, createStateAddress(getPathInfo(record.markerBasePath), null), receiver, handler) as any;

    expect(overlay.$getAll("name", [])).toEqual(["got", "user.name", []]);
    // $resolve は indexes 省略を空列に倒す
    expect(overlay.$resolve("name", undefined)).toEqual(["res", "user.name", []]);

    // 非 base のオーバーレイ（ワイルドカードアクセサの親）: own データを持たない
    const nonBase = createOverlayValue(record, createStateAddress(getPathInfo("other.#m9"), null), receiver, handler) as any;
    expect("nope" in nonBase).toBe(true); // ルートマウントは規則 3 で常に解決する
  });

  it("chroot の $resolve 読み形（readonly）と素の $ キー・素の書き込みが通ること", async () => {
    const { createPublicMountState } = await import("../src/webComponent/overlay");
    const { buildMountRecord: build } = await import("../src/webComponent/mount");
    const { getPathInfo } = await import("../src/address/PathInfo");
    const { component } = edgeRecord();
    const { setLoopContextSymbol } = await import("../src/proxy/symbols");
    const calls: Array<[string, unknown[]]> = [];
    const stateStub: any = {
      [setLoopContextSymbol]: (_ctx: unknown, inner: () => void) => inner(),
      $resolve: (...args: unknown[]) => { calls.push(["$resolve", args]); return "R"; },
      $other: "raw-value",
    };
    const parentStateElement = {
      name: "default",
      createState: (mutability: string, cb: (s: any) => void) => { calls.push(["createState", [mutability]]); cb(stateStub); },
    } as any;
    const record = build(component, "state", [{
      propName: "state", propSegments: ["state"], propModifiers: [],
      statePathName: "user", statePathInfo: getPathInfo("user"), stateName: "default",
      inFilters: [], outFilters: [], bindingType: "prop", uuid: null,
      node: component, replaceNode: component,
    } as any], parentStateElement, {});
    const chroot = createPublicMountState(record) as any;

    // 読み形（第 3 引数なし）→ readonly
    expect(chroot.$resolve("name", [])).toBe("R");
    // $getAll は indexes 省略を親 API に委ねる（文脈既定）
    stateStub.$getAll = (...args: unknown[]) => { calls.push(["$getAll", args]); return []; };
    expect(chroot.$getAll("name")).toEqual([]);
    expect(calls.some(([k, a]) => k === "$getAll" && (a as unknown[])[1] === undefined)).toBe(true);
    expect(calls.some(([k, a]) => k === "createState" && a[0] === "readonly")).toBe(true);
    // ラップ対象外の $ キーは素通し
    expect(chroot.$other).toBe("raw-value");
    // 素の $ キーへの書き込みも素通し（親の意味論のまま）
    expect(() => { chroot.$flag = true; }).not.toThrow();
    expect(stateStub.$flag).toBe(true);
  });
});

describe("mountOverlay: 他人のマーカー風パスは素通りすること", () => {
  it("hasMounts な state でも登録簿に無いマーカーは通常解決に落ちること", async () => {
    const tag = uniqueTag("mo-foreign");
    defineWiredComponent(tag, () => ({}), `<span data-wcs="textContent: name"></span>`);
    const { host, parentStateElement } = await mountHost(
      '{"user":{"name":"Alice"}}',
      `<${tag} data-wcs="state: user"></${tag}>`,
    );
    await childReady(host.shadowRoot!.querySelector(tag)!);

    let value: unknown = "sentinel";
    parentStateElement.createState("readonly", (s: any) => {
      value = s["user.#zz9.q"];
    });
    expect(value).toBeUndefined();

    host.remove();
  });
});

describe("mountOverlay: 宣言 warn とライフサイクル（設計書 §4-6）", () => {
  it("$watch 等の宣言は実行されず、(tag, prop) につき 1 回だけ誘導 warn が出ること", async () => {
    const { clearMountDollarWarnsForTesting } = await import("../src/webComponent/mount");
    clearMountDollarWarnsForTesting();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const watchFired: unknown[] = [];
      const tag = uniqueTag("mo-decl");
      defineWiredComponent(tag, () => ({
        $watch: { name(cur: unknown) { watchFired.push(cur); } },
        $listKeys: { tags: "id" },
      }), `<span class="n" data-wcs="textContent: name"></span>`);
      const { host, parentStateElement } = await mountHost(
        '{"user":{"name":"Alice"}}',
        `<${tag} data-wcs="state: user"></${tag}><${tag} data-wcs="state: user"></${tag}>`,
      );
      for (const c of Array.from(host.shadowRoot!.querySelectorAll(tag))) {
        await childReady(c);
      }
      parentStateElement.createState("writable", (s: any) => {
        s["user.name"] = "Bob";
      });
      await flush();
      await flush();

      expect(watchFired).toEqual([]); // 実行されない
      const warns = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("[wcs/mount-dollar-declaration]"));
      expect(warns).toHaveLength(1); // 2 インスタンスでも 1 回
      expect(warns[0]).toContain("$watch, $listKeys");
      expect(warns[0]).toContain("volume");
      host.remove();
    } finally {
      warn.mockRestore();
    }
  });

  it("$connectedCallback / $disconnectedCallback が chroot（element.state）で走ること", async () => {
    const log: string[] = [];
    const tag = uniqueTag("mo-life");
    defineWiredComponent(tag, () => ({
      seen: "no", // own key（私有）— $connectedCallback の chroot 書き込み先
      $connectedCallback(this: any) { log.push(`connect:${this.name}`); this.seen = "yes"; },
      $disconnectedCallback(this: any) { log.push(`disconnect:${this.name}`); },
    }), `<span class="n" data-wcs="textContent: name"></span>`);
    const { host, parentStateElement } = await mountHost(
      '{"user":{"name":"Alice"}}',
      `<${tag} data-wcs="state: user"></${tag}>`,
    );
    const card = host.shadowRoot!.querySelector(tag)!;
    await childReady(card);

    expect(log).toEqual(["connect:Alice"]);
    // chroot 書き込み（私有キー）はインスタンスの面に載っている
    expect((card as any).state.seen).toBe("yes");

    // カード単体の切断（親は生きている）→ chroot でツリーを読める
    card.remove();
    await flush();
    expect(log).toEqual(["connect:Alice", "disconnect:Alice"]);
    // 親ツリーは汚していない（seen は私有）
    parentStateElement.createState("readonly", (s: any) => {
      expect("seen" in s.user).toBe(false);
    });
    host.remove();
  });
});

describe("mountOverlay: 非同期ライフサイクルの reject 隔離", () => {
  it("async $connectedCallback の reject は console.error に隔離されること", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const tag = uniqueTag("mo-life-async");
      defineWiredComponent(tag, () => ({
        async $connectedCallback() { throw new Error("cc-boom"); },
      }), `<span data-wcs="textContent: name"></span>`);
      const { host } = await mountHost(
        '{"user":{"name":"Alice"}}',
        `<${tag} data-wcs="state: user"></${tag}>`,
      );
      await childReady(host.shadowRoot!.querySelector(tag)!);
      await flush();
      expect(error.mock.calls.some((c) => String(c[0]).includes("$connectedCallback failed"))).toBe(true);
      host.remove();
    } finally {
      error.mockRestore();
    }
  });
});

describe("devtools: overlays(rootNode) がマウント記録を要約すること（protocol v2 / D20 の可視化）", () => {
  it("マウント表・Δ・私有キー・getter キーが出ること", async () => {
    const { registerDevtoolsSource, __getRegisteredSourceForTest, __resetDevtoolsBridgeForTest } =
      await import("../src/devtools/bridge");
    __resetDevtoolsBridgeForTest();
    registerDevtoolsSource();
    const source = __getRegisteredSourceForTest()!;

    const tag = uniqueTag("mo-devtools");
    defineShell(tag, `<wcs-state bind-component="state"></wcs-state><p data-wcs="textContent: name"></p>`);
    const { shadowRoot, parentStateElement, host } = await mountHost(
      '{"user":{"name":"Alice"}}',
      `<${tag} data-wcs="state: user"></${tag}>`,
    );
    const component = shadowRoot.querySelector(tag)!;
    mountComponent(component, parentStateElement, {
      secret: "mine",
      get shout() { return "!"; },
    });

    const overlays = (source as any).overlays(shadowRoot);
    expect(overlays).toHaveLength(1);
    expect(overlays[0].componentTag).toBe(tag);
    expect(overlays[0].stateProp).toBe("state");
    expect(overlays[0].marker).toMatch(/^#m\d+$/);
    expect(overlays[0].mountTable).toEqual([{ inner: "", outer: "user" }]);
    expect(overlays[0].delta).toBe(0);
    expect(overlays[0].privateKeys).toContain("secret");
    expect(overlays[0].getterKeys).toContain("shout");

    // マウントの無いルートは空配列
    const plainHost = document.createElement(uniqueTag("mo-plain"));
    const plainShadow = plainHost.attachShadow({ mode: "open" });
    plainShadow.innerHTML = `<wcs-state json='{"a":1}'></wcs-state>`;
    document.body.appendChild(plainHost);
    await (plainShadow.querySelector("wcs-state") as State).connectedCallbackPromise;
    expect((source as any).overlays(plainShadow)).toEqual([]);

    __resetDevtoolsBridgeForTest();
    host.remove();
    plainHost.remove();
  });
});

/**
 * setter の無い getter（computed）への書き込み — v2 レビューの修理。
 * set トラップがツリー行きフォールバックへ落とすと translateInnerPath が同じ
 * マーカーパスを返して循環し RangeError（無限再帰）だった。設定ミスとして
 * raiseError で loud に落とす。
 */
describe("mountOverlay: setter の無い getter への書き込みは raise すること", () => {
  it("chroot（element.state）経由の代入が無限再帰せず、setter が無い旨で throw すること", async () => {
    const tag = uniqueTag("mo-computed-write");
    defineShell(tag, `<span class="display" data-wcs="textContent: display"></span>`);
    const { host, shadowRoot, parentStateElement } = await mountHost(
      '{"user":{"name":"Alice"}}',
      `<${tag} data-wcs="state: user"></${tag}>`,
    );
    const component = shadowRoot.querySelector(tag)!;
    const record = mountComponent(component, parentStateElement, {
      get display() { return `<${(this as any).name}>`; },
    });
    await flush();
    expect(text(component.shadowRoot!, ".display")).toBe("<Alice>");

    const state = createPublicMountState(record);
    expect(() => { state.display = "x"; }).toThrow(/has no setter/);
    // setter 持ちの読み書き面は無傷（ツリーへの書き込みは通る）
    state.name = "Eve";
    await flush();
    await flush();
    expect(text(component.shadowRoot!, ".display")).toBe("<Eve>");

    host.remove();
  });
});

/**
 * $commandTokens / $eventTokens の宣言もマウントでは実行されない — 無言に捨てず
 * warn 対象に含める（設計書 §4-6 の実装注記・v2 レビューの修理）。
 */
describe("mountOverlay: $commandTokens / $eventTokens の宣言 warn", () => {
  it("トークン宣言も誘導 warn の対象になること", async () => {
    const { clearMountDollarWarnsForTesting, buildMountRecord: build, warnMountedDollarDeclarations } =
      await import("../src/webComponent/mount");
    clearMountDollarWarnsForTesting();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const component = document.createElement("mo-token-decl");
      const record = build(
        component,
        "state",
        [{
          propName: "state", propSegments: ["state"], propModifiers: [],
          statePathName: "user", statePathInfo: (await import("../src/address/PathInfo")).getPathInfo("user"),
          inFilters: [], outFilters: [], bindingType: "prop", uuid: null,
          node: component, replaceNode: component,
        } as any],
        { name: "default" } as any,
        {
          $commandTokens: ["focus"],
          $eventTokens: { changed: "onChanged" },
          $on: { changed() {} },
        },
      );
      warnMountedDollarDeclarations(record);
      const warns = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("[wcs/mount-dollar-declaration]"));
      expect(warns).toHaveLength(1);
      expect(warns[0]).toContain("$commandTokens, $eventTokens, $on");
      expect(warns[0]).toContain("root state");
    } finally {
      warn.mockRestore();
    }
  });
});
