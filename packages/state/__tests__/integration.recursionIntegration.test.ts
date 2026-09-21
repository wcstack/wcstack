/**
 * integration.recursionIntegration.test.ts — 再帰パス（docs/state-recursive-path-impl-plan.md §7 /
 * Phase E）の**統合**の検証。Phase B〜D が固定した単体の契約ではなく、再帰が他の
 * スコープ機構（bind-component のマウントスコープ・`mount=` のボリューム）、state の
 * 世代（再セット・再接続・木の伸縮）、SSR / hydration と**同居**したときに何が成立し、
 * 何が成立しないかを実測で固定する。
 *
 * このファイルには 2 種類の it が混ざっている（recursionKnownDefects.test.ts と同じ規約）。
 *  - **契約**: 期待値は正しい値。壊れたら赤くなる。
 *  - **現状固定（characterization）**: `DEFECT:` コメント付きで、assert は**誤った現状の値**。
 *    直したらここが赤くなるのが正常で、緑を保つために期待値を緩めてはならない。
 *
 * 期待値は全て実行して確かめた値である。手で畳んだ算術（`131 = 1 + (10 + 100) + 20`、
 * 全 value の合計 `133`）は二重計上が起きていないことの独立した検算。
 *
 * 【この形でしか測れない理由】
 *  - マウントスコープ（v2 bind-component）は**独立ツリーを持たない**。子の
 *    `<wcs-state bind-component>` は `__state` を持たず（実測: `hasRecursion === false`）、
 *    パースしたバインドテキストを親ツリーの絶対パスへ翻訳して親の台帳に載せる。
 *    つまり再帰の宣言・実体化・依存はすべて**ホスト側 1 箇所**で起きる。単体テストは
 *    境界の片側しかモックできないので、実モジュールだけで組んで往復を観測する。
 *  - happy-dom は `element.textContent = false` / `= 0` を空文字にするので、DOM の
 *    assert は**真値だけ**に置き、偽値は state 側（`$getAll`）で確かめている。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { flush, read, write } from "./helpers/recursionTestUtils";
import { buildSsrDocument } from "../src/ssr/buildSsrDocument";

beforeAll(() => {
  bootstrapState();
});

// flush / read / write は helpers/recursionTestUtils
let seq = 0;
const uniqueTag = (prefix: string): string => `${prefix}-${++seq}`;

// ---------------------------------------------------------------------------
// 木と再帰 state
// ---------------------------------------------------------------------------

type TNode = { value: number; children: TNode[]; selected: boolean };
const node = (value: number, children: TNode[] = []): TNode => ({ value, children, selected: false });

/**
 * 深さ 3 の木。
 *   nodes[0] = 1 ─┬─ 10 ── 100
 *                 └─ 20
 *   nodes[1] = 2
 * 手で畳んだ total: 131 / 110 / 100 / 20 / 2、全 value の合計 = 133。
 */
const forest = (): TNode[] => [node(1, [node(10, [node(100)]), node(20)]), node(2)];

const eventLog: unknown[][] = [];

/**
 * 標準の再帰 state。アクセサはオブジェクトリテラルの getter として書くと
 * spread で本体が評価されてしまうので descriptor で足す。`enumerable: false` は
 * クラスの getter（プロトタイプ側）と同じ可視性にするため — SSR の
 * `Ssr.extractStateData` は own+enumerable だけを見る（§4 の it が測っている）。
 */
function treeState(nodes: TNode[] = forest()): any {
  const state: any = {
    title: "tree",
    $recursion: { "nodes.*": "children.*" },
    nodes,
    selectAll(this: any) {
      this.$setAll("nodes.**.selected", [], true);
    },
    probe(this: any, _event: Event, ...indexes: number[]) {
      eventLog.push(["indexes", indexes]);
      eventLog.push(["explicitAll", this.$getAll("nodes.**.value", [])]);
      eventLog.push(["omitted", this.$getAll("nodes.**.value")]);
      this.$setAll("nodes.**.selected", [], true);
      eventLog.push(["setAll", "ok"]);
    },
  };
  Object.defineProperty(state, "nodes.**.total", {
    get(this: any) {
      return this["nodes.**.value"] +
        this.$getAll("nodes.**.children.*.total").reduce((a: number, b: number) => a + b, 0);
    },
    enumerable: false, configurable: true,
  });
  // 再帰 getter の中の `$1` は「その getter が評価されている深さの**先頭**の添字」。
  // どの深さでも枝の根の行番号になる（子スコープの行番号にはならない）。
  Object.defineProperty(state, "nodes.**.rootIndex", {
    get(this: any) { return String(this.$1); },
    enumerable: false, configurable: true,
  });
  Object.defineProperty(state, "grandTotal", {
    get(this: any) { return this.$getAll("nodes.**.value", []).reduce((a: number, b: number) => a + b, 0); },
    enumerable: false, configurable: true,
  });
  Object.defineProperty(state, "selectedCount", {
    get(this: any) { return this.$getAll("nodes.**.selected", []).filter(Boolean).length; },
    enumerable: false, configurable: true,
  });
  return state;
}


/** shadow ホストにルート state を 1 本置く。 */
async function mountHost(initial: any, innerHTML = "") {
  const host = document.createElement(uniqueTag("rint-host"));
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `<wcs-state></wcs-state>` + innerHTML;
  document.body.appendChild(host);
  const el = shadowRoot.querySelector("wcs-state") as State;
  el.setInitialState(initial);
  await el.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  await flush();
  return { host, shadowRoot, el };
}

/** shadow を辿って全ての `<wcs-state>` の初期化を待つ（自己参照コンポーネントは段が動的）。 */
async function settleTree(root: ParentNode): Promise<void> {
  for (let round = 0; round < 6; round++) {
    const elements: State[] = [];
    const walk = (parent: ParentNode): void => {
      parent.querySelectorAll("*").forEach((element) => {
        if (element.tagName.toLowerCase() === "wcs-state") elements.push(element as State);
        const shadow = (element as HTMLElement).shadowRoot;
        if (shadow !== null && typeof shadow !== "undefined") walk(shadow);
      });
    };
    walk(root);
    for (const element of elements) await element.connectedCallbackPromise;
    await flush();
  }
}

/** shadow を貫いてクラス名でテキストを集める（深さ優先・文書順）。 */
function collectText(root: ParentNode, className: string): string[] {
  const out: string[] = [];
  const walk = (parent: ParentNode): void => {
    parent.querySelectorAll("*").forEach((element) => {
      if (element.classList?.contains(className)) out.push(element.textContent ?? "");
      const shadow = (element as HTMLElement).shadowRoot;
      if (shadow !== null && typeof shadow !== "undefined") walk(shadow);
    });
  };
  walk(root);
  return out;
}

/**
 * 自己参照コンポーネント。`rows` を回して各行の `total` / `rootIndex` を出し、
 * 自分の子リストを自分自身へ渡す。ホスト側の `**` getter を**通常の具体パス**
 * （`rows.*.total` → 翻訳後 `nodes.*.children.*.…`）として読む形。
 */
function defineTreeComponent(): string {
  const tag = uniqueTag("rint-tree");
  class TreeComponent extends HTMLElement {
    state: Record<string, any> = {};
    constructor() { super(); this.attachShadow({ mode: "open" }); }
    connectedCallback() {
      if (this.shadowRoot!.childNodes.length > 0) return;
      this.shadowRoot!.innerHTML =
        `<wcs-state bind-component="state"></wcs-state>` +
        `<ul><template data-wcs="for: rows">` +
        `<li><span class="tot" data-wcs="textContent: rows.*.total"></span>` +
        `<span class="ridx" data-wcs="textContent: rows.*.rootIndex"></span>` +
        `<${tag} data-wcs="state.rows: rows.*.children"></${tag}></li>` +
        `</template></ul>`;
    }
  }
  customElements.define(tag, TreeComponent);
  return tag;
}

// ===========================================================================
// 1. bind-component（v2 マウントスコープ）のスコープ
// ===========================================================================

describe("再帰 × bind-component: ホストが宣言し、子スコープが具体パスで読む", () => {
  async function mountSelfRecursiveTree(initial: any = treeState()) {
    const tag = defineTreeComponent();
    const { host, shadowRoot, el } = await mountHost(
      initial,
      `<div id="grand" data-wcs="textContent: grandTotal"></div>` +
      `<${tag} data-wcs="state.rows: nodes"></${tag}>`,
    );
    await settleTree(shadowRoot);
    return { host, shadowRoot, el, tag };
  }

  it("自己参照コンポーネントが木を描き、各段が正しい深さの再帰 getter を表示する", async () => {
    const { host, shadowRoot, el } = await mountSelfRecursiveTree();
    // 深さ優先・行きがけ: 131(1) / 110(10) / 100(100) / 20(20) / 2(2)
    expect(collectText(shadowRoot, "tot")).toEqual(["131", "110", "100", "20", "2"]);
    expect(shadowRoot.querySelector("#grand")?.textContent).toBe("133");
    // ホスト 1 箇所だけが実体化を持つ（読んだ深さのぶんだけ生える）
    const registry = (el as any).recursionRegistry;
    expect(Array.from(registry.materializedPaths).sort()).toEqual([
      "nodes.*.children.*.children.*.rootIndex",
      "nodes.*.children.*.children.*.total",
      "nodes.*.children.*.rootIndex",
      "nodes.*.children.*.total",
      "nodes.*.rootIndex",
      "nodes.*.total",
    ]);
    host.remove();
  });

  it("子スコープの <wcs-state bind-component> は独立ツリーを持たず、再帰宣言も持たない", async () => {
    const { host, shadowRoot, tag } = await mountSelfRecursiveTree();
    const component = shadowRoot.querySelector(tag) as HTMLElement;
    const childState = component.shadowRoot!.querySelector("wcs-state") as State;
    expect((childState as any).__state).toBeUndefined();
    expect((childState as any).hasRecursion).toBe(false);
    expect((childState as any).recursionRegistry).toBeNull();
    host.remove();
  });

  it("再帰 getter の中の $1 は枝の根の行添字で、子スコープの行添字ではない", async () => {
    const { host, shadowRoot, el } = await mountSelfRecursiveTree();
    // 深さ 2 の `100` は子スコープでは行 0 だが、$1 は根の行 0 のまま。
    // 末尾の `2` だけが根の行 1。
    expect(collectText(shadowRoot, "ridx")).toEqual(["0", "0", "0", "0", "1"]);
    // 描画経路と headless の列挙が同じ答えを返す
    expect(read(el, (s) => s.$getAll("nodes.**.rootIndex", []))).toEqual(["0", "0", "0", "0", "1"]);
    host.remove();
  });

  it("葉の更新がコンポーネント境界を越えて全段の集計に伝播する", async () => {
    const { host, shadowRoot, el } = await mountSelfRecursiveTree();
    write(el, (s: any) => { s["nodes.0.children.0.children.0.value"] = 1000; });
    await flush();
    expect(collectText(shadowRoot, "tot")).toEqual(["1031", "1010", "1000", "20", "2"]);
    expect(shadowRoot.querySelector("#grand")?.textContent).toBe("1033");
    host.remove();
  });

  it("空の枝へ子を足すと、その段のコンポーネントが生えて集計が追従する", async () => {
    const { host, shadowRoot, el } = await mountSelfRecursiveTree();
    write(el, (s: any) => { s["nodes.1.children"] = [node(5)]; });
    await flush();
    await settleTree(shadowRoot);
    expect(collectText(shadowRoot, "tot")).toEqual(["131", "110", "100", "20", "7", "5"]);
    expect(shadowRoot.querySelector("#grand")?.textContent).toBe("138");
    host.remove();
  });

  it("ホストの $setAll がコンポーネント境界を越えて全深さへ届く", async () => {
    const { host, shadowRoot, el } = await mountSelfRecursiveTree();
    expect(read(el, (s) => s.$getAll("nodes.**.selected", []))).toEqual([false, false, false, false, false]);
    write(el, (s: any) => { s.selectAll(); });
    await flush();
    expect(read(el, (s) => s.$getAll("nodes.**.selected", []))).toEqual([true, true, true, true, true]);
    expect(read(el, (s) => s.selectedCount)).toBe(5);
    // 集計は壊れていない（構造ではなく葉属性だけを書いたので）
    expect(collectText(shadowRoot, "tot")).toEqual(["131", "110", "100", "20", "2"]);
    host.remove();
  });

  it("ホストの行文脈から呼ばれても、[] の $getAll / $setAll は行に引きずられない", async () => {
    eventLog.length = 0;
    const { host, shadowRoot, el } = await mountHost(
      treeState(),
      `<ul><template data-wcs="for: nodes"><li><button class="b" data-wcs="onclick: probe"></button></li></template></ul>`,
    );
    await flush();
    const buttons = Array.from(shadowRoot.querySelectorAll(".b")) as HTMLElement[];
    expect(buttons.length).toBe(2);
    buttons[1].dispatchEvent(new Event("click"));
    await flush();
    expect(eventLog).toEqual([
      ["indexes", [1]],
      // [] は宣言アンカー全体（行文脈に関係なく全深さ）
      ["explicitAll", [1, 10, 100, 20, 2]],
      // 添字省略は「整合する最長接頭辞」＝いま居る行（nodes.1）の深さ 0
      ["omitted", [2]],
      ["setAll", "ok"],
    ]);
    expect(read(el, (s) => s.selectedCount)).toBe(5);
    host.remove();
  });

  it("マウントされた子の chroot からはホストのアンカーが見えない（診断で落ちる）", async () => {
    const messages: string[] = [];
    const tag = uniqueTag("rint-chroot");
    class Comp extends HTMLElement {
      state: Record<string, any> = {
        probe(this: any) {
          // ホストツリーのアンカー名（own key でもマウント規則でもない）
          try { this.$getAll("nodes.**.value", []); } catch (e: any) { messages.push("hostAnchor: " + e.message); }
          // 自分のマウント名。翻訳はホストのアンカーに当たるが、`**` はマウント
          // スコープでは解釈されない
          try { this.$getAll("rows.**.value", []); } catch (e: any) { messages.push("mappedName: " + e.message); }
        },
      };
      constructor() { super(); this.attachShadow({ mode: "open" }); }
      connectedCallback() {
        if (this.shadowRoot!.childNodes.length > 0) return;
        this.shadowRoot!.innerHTML =
          `<wcs-state bind-component="state"></wcs-state>` +
          `<ul><template data-wcs="for: rows"><li><button class="b" data-wcs="onclick: probe"></button></li></template></ul>`;
      }
    }
    customElements.define(tag, Comp);
    const { host, shadowRoot } = await mountHost(treeState(), `<${tag} data-wcs="state.rows: nodes"></${tag}>`);
    const component = shadowRoot.querySelector(tag) as HTMLElement;
    await (component.shadowRoot!.querySelector("wcs-state") as State).connectedCallbackPromise;
    await State.getBindingsReady(component.shadowRoot!);
    await flush();
    (component.shadowRoot!.querySelectorAll(".b")[0] as HTMLElement).dispatchEvent(new Event("click"));
    await flush();
    expect(messages).toHaveLength(2);
    // ホストのアンカー名は chroot の解決規則で止まる（再帰の話にすらならない）
    expect(messages[0]).toContain("does not resolve");
    expect(messages[0]).toContain("not an own key of the component state");
    // マウント名は翻訳されてから `**` が拒否される
    expect(messages[1]).toContain("[wcs/recursion-unsupported]");
    // DEFECT: 診断文が作者の書いた綴り（"rows.**.value"）ではなく翻訳後の
    // "nodes.**.value" を名指しする。マウントスコープでは `**` を解釈しない、と
    // 言うべき場所で、作者のソースに存在しない綴りを提示している。
    expect(messages[1]).toContain('"nodes.**.value"');
    expect(messages[1]).not.toContain('"rows.**.value"');
    host.remove();
  });

  it("HTML の data-wcs に ** を直接書くと wcs/recursion-unsupported で落ちる", async () => {
    let message = "";
    try {
      await mountHost(treeState(), `<span data-wcs="textContent: nodes.**.total"></span>`);
    } catch (error: any) {
      message = error?.message ?? String(error);
    }
    expect(message).toContain("[wcs/recursion-unsupported]");
    expect(message).toContain("nodes.**.total");
  });

  it("plain Shadow 形（ホスト配線なし）の子は自分の $recursion を持て、ホストと混ざらない", async () => {
    const tag = uniqueTag("rint-plain");
    class Comp extends HTMLElement {
      state: Record<string, any>;
      constructor() {
        super();
        this.attachShadow({ mode: "open" });
        const inner: any = { $recursion: { "rows.*": "children.*" }, rows: [node(5, [node(6)])] };
        Object.defineProperty(inner, "rows.**.total", {
          get(this: any) {
            return this["rows.**.value"] +
              this.$getAll("rows.**.children.*.total").reduce((a: number, b: number) => a + b, 0);
          },
          enumerable: false, configurable: true,
        });
        this.state = inner;
      }
      connectedCallback() {
        if (this.shadowRoot!.childNodes.length > 0) return;
        this.shadowRoot!.innerHTML =
          `<wcs-state bind-component="state"></wcs-state>` +
          `<ul><template data-wcs="for: rows"><li class="tot" data-wcs="textContent: rows.*.total"></li></template></ul>`;
      }
    }
    customElements.define(tag, Comp);
    const { host, shadowRoot, el } = await mountHost(treeState(), `<${tag}></${tag}>`);
    const component = shadowRoot.querySelector(tag) as HTMLElement;
    const childState = component.shadowRoot!.querySelector("wcs-state") as State;
    await childState.connectedCallbackPromise;
    await State.getBindingsReady(component.shadowRoot!);
    await flush();
    // 子は自分のアンカーで動く
    expect(collectText(component.shadowRoot!, "tot")).toEqual(["11"]);
    expect((childState as any).hasRecursion).toBe(true);
    expect((childState as any).recursionRegistry.spec.anchor).toBe("rows.*");
    expect(Array.from((childState as any).recursionRegistry.materializedPaths))
      .toEqual(["rows.*.total", "rows.*.children.*.total"]);
    // ホスト側は子の読みで実体化されない（宣言もアクセサもスコープ内に閉じている）
    expect(Array.from((el as any).recursionRegistry.materializedPaths)).toEqual([]);
    expect(read(el, (s) => s.grandTotal)).toBe(133);
    host.remove();
  });

  it("マウントされた子の $recursion には mount-dollar-declaration の誘導が出ること", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const tag = uniqueTag("rint-childrec");
    class Comp extends HTMLElement {
      state: Record<string, any>;
      constructor() {
        super();
        this.attachShadow({ mode: "open" });
        const inner: any = { $recursion: { "rows.*": "children.*" } };
        Object.defineProperty(inner, "rows.**.total", {
          get(this: any) { return this["rows.**.value"]; },
          enumerable: false, configurable: true,
        });
        this.state = inner;
      }
      connectedCallback() {
        if (this.shadowRoot!.childNodes.length > 0) return;
        this.shadowRoot!.innerHTML =
          `<wcs-state bind-component="state"></wcs-state>` +
          `<ul><template data-wcs="for: rows"><li class="tot" data-wcs="textContent: rows.*.total"></li></template></ul>`;
      }
    }
    customElements.define(tag, Comp);
    // ホスト側は再帰を宣言していない（子だけが宣言している形）
    const { host, shadowRoot } = await mountHost(
      { title: "x", nodes: [node(1), node(2)] },
      `<${tag} data-wcs="state.rows: nodes"></${tag}>`,
    );
    const component = shadowRoot.querySelector(tag) as HTMLElement;
    await (component.shadowRoot!.querySelector("wcs-state") as State).connectedCallbackPromise;
    await State.getBindingsReady(component.shadowRoot!);
    await flush();
    const warns = warnSpy.mock.calls.map((call) => String(call[0]));
    // Fixed by Phase E — was: 誘導が 1 件も出ず、作者が受け取るのは翻訳後のホストツリーの
    // パスを名指しする無関係な [wcs/binding-path-missing] だけだった。$recursion は
    // $watch / $streams / $listKeys と同じ「マウントスコープが実行しない宣言面」なので、
    // MOUNT_DOLLAR_DECLARATIONS に載せて 1 回だけ誘導を出す。
    expect(warns.some((w) => w.includes("[wcs/mount-dollar-declaration]"))).toBe(true);
    // 値は空のまま（診断が出るだけで、宣言が効くようになるわけではない）
    expect(collectText(component.shadowRoot!, "tot")).toEqual(["", ""]);
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    host.remove();
  });

  it("マウントされた子の `**` getter（$recursion 無し）にも mount-dollar-declaration の誘導が出ること", async () => {
    // Fixed by cycle-3 review — was: `markerizeAccessorPath` が `*` セグメントしか探さないので
    // `**` を含むキーは私有アンカーに落ち、参照されないまま永久に登録されず、warn も error も
    // 無く黙って捨てられていた（ボリュームは接ぎ木前に拒否、`$recursion` は誘導が出るのに）。
    const { clearMountDollarWarnsForTesting } = await import("../src/webComponent/mount");
    clearMountDollarWarnsForTesting();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const tag = uniqueTag("rint-childstar");
    class Comp extends HTMLElement {
      state: Record<string, any>;
      constructor() {
        super();
        this.attachShadow({ mode: "open" });
        const inner: any = {};
        Object.defineProperty(inner, "node.**.total", {
          get(this: any) { return 0; }, enumerable: false, configurable: true,
        });
        this.state = inner;
      }
      connectedCallback() {
        if (this.shadowRoot!.childNodes.length > 0) return;
        this.shadowRoot!.innerHTML =
          `<wcs-state bind-component="state"></wcs-state><span class="v" data-wcs="textContent: node.value"></span>`;
      }
    }
    customElements.define(tag, Comp);
    const { host, shadowRoot } = await mountHost(
      { title: "x", nodes: [node(1), node(2)] },
      `<template data-wcs="for: nodes"><${tag} data-wcs="state.node: nodes.*"></${tag}></template>`,
    );
    const component = shadowRoot.querySelector(tag) as HTMLElement;
    await (component.shadowRoot!.querySelector("wcs-state") as State).connectedCallbackPromise;
    await State.getBindingsReady(component.shadowRoot!);
    await flush();
    const warns = warnSpy.mock.calls.map((call) => String(call[0]));
    const guidance = warns.filter((w) => w.includes("[wcs/mount-dollar-declaration]"));
    expect(guidance).toHaveLength(1);   // (tag, prop) につき 1 回
    expect(guidance[0]).toContain(`"node.**.total"`);
    expect(guidance[0]).toContain('"**" getters expand against the root tree');
    expect(errorSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    host.remove();
  });
});

// ===========================================================================
// 2. mount=（ボリューム）のスコープ
// ===========================================================================

describe("再帰 × mount=（ボリューム）", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("ルートが宣言し、ボリュームがアンカー配下のデータを供給する形は成立する", async () => {
    document.body.innerHTML =
      `<wcs-state></wcs-state><wcs-state mount="sub"></wcs-state>` +
      `<div id="grand" data-wcs="textContent: subTotal"></div>`;
    const rootEl = document.querySelector("wcs-state:not([mount])") as State;
    const volumeEl = document.querySelector("wcs-state[mount]") as State;
    const rootState: any = { $recursion: { "sub.nodes.*": "children.*" } };
    Object.defineProperty(rootState, "sub.nodes.**.total", {
      get(this: any) {
        return this["sub.nodes.**.value"] +
          this.$getAll("sub.nodes.**.children.*.total").reduce((a: number, b: number) => a + b, 0);
      },
      enumerable: false, configurable: true,
    });
    Object.defineProperty(rootState, "subTotal", {
      get(this: any) { return this.$getAll("sub.nodes.**.value", []).reduce((a: number, b: number) => a + b, 0); },
      enumerable: false, configurable: true,
    });
    rootEl.setInitialState(rootState);
    volumeEl.setInitialState({ nodes: forest() });
    await rootEl.connectedCallbackPromise;
    await volumeEl.connectedCallbackPromise;
    await State.getBindingsReady(document);
    await flush();

    expect(read(rootEl, (s) => s.$getAll("sub.nodes.**.total", []))).toEqual([131, 110, 100, 20, 2]);
    expect(document.querySelector("#grand")?.textContent).toBe("133");
    // 葉の更新（接ぎ木された部分木の中）が集計に伝播する
    write(rootEl, (s: any) => { s["sub.nodes.0.children.0.children.0.value"] = 1000; });
    await flush();
    expect(document.querySelector("#grand")?.textContent).toBe("1033");
    // 一括書き込みも接ぎ木の向こうまで届く
    write(rootEl, (s: any) => { s.$setAll("sub.nodes.**.selected", [], true); });
    await flush();
    expect(read(rootEl, (s) => s.$getAll("sub.nodes.**.selected", []))).toEqual([true, true, true, true, true]);
  });

  it("マウントパスがアンカーの先頭セグメントでも成立する", async () => {
    document.body.innerHTML = `<wcs-state></wcs-state><wcs-state mount="nodes"></wcs-state>`;
    const rootEl = document.querySelector("wcs-state:not([mount])") as State;
    const volumeEl = document.querySelector("wcs-state[mount]") as State;
    const rootState: any = { $recursion: { "nodes.list.*": "children.*" } };
    Object.defineProperty(rootState, "nodes.list.**.total", {
      get(this: any) {
        return this["nodes.list.**.value"] +
          this.$getAll("nodes.list.**.children.*.total").reduce((a: number, b: number) => a + b, 0);
      },
      enumerable: false, configurable: true,
    });
    rootEl.setInitialState(rootState);
    volumeEl.setInitialState({ list: forest() });
    await rootEl.connectedCallbackPromise;
    await volumeEl.connectedCallbackPromise;
    await flush();
    expect(read(rootEl, (s) => s.$getAll("nodes.list.**.total", []))).toEqual([131, 110, 100, 20, 2]);
  });

  it("ボリュームの $recursion は接ぎ木前に名指しで拒否されること", async () => {
    // Fixed by Phase E — was: warn も error も 1 件も出ず、宣言が黙って捨てられていた。
    // アンカーはルートのツリーに対して解決されるので、ボリューム側の宣言は
    // 「受理されたように見えて、どの深さも解決しない」状態しか作らない。
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    document.body.innerHTML = `<wcs-state json='{"root":1}'></wcs-state><wcs-state mount="tree"></wcs-state>`;
    const rootEl = document.querySelector("wcs-state:not([mount])") as State;
    const volumeEl = document.querySelector("wcs-state[mount]") as State;
    volumeEl.setInitialState({ nodes: forest(), plain: 1, $recursion: { "nodes.*": "children.*" } });
    await rootEl.connectedCallbackPromise;
    await volumeEl.connectedCallbackPromise;
    await flush();

    const messages = errorSpy.mock.calls.map((call) => String(call[0]) + "|" + String((call[1] as any)?.message ?? ""));
    expect(messages.some((m) => m.includes("declares $recursion, which volumes do not support yet"))).toBe(true);
    expect(messages.some((m) => m.includes("Declare the recursion anchor on the root state"))).toBe(true);
    // 拒否は接ぎ木より前なので、データも載らない（$streams と同じ形）
    expect((rootEl as any).__state.tree).toBeUndefined();
    errorSpy.mockRestore();
  });

  it("対照: ボリュームの $streams は接ぎ木前に名指しで拒否される", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    document.body.innerHTML = `<wcs-state json='{"root":1}'></wcs-state><wcs-state mount="st"></wcs-state>`;
    const rootEl = document.querySelector("wcs-state:not([mount])") as State;
    const volumeEl = document.querySelector("wcs-state[mount]") as State;
    volumeEl.setInitialState({ plain: 1, $streams: { x: () => {} } });
    await rootEl.connectedCallbackPromise;
    await volumeEl.connectedCallbackPromise;
    await flush();
    const messages = errorSpy.mock.calls.map((call) => String(call[0]) + "|" + String((call[1] as any)?.message ?? ""));
    expect(messages.some((m) => m.includes("declares $streams, which volumes do not support yet"))).toBe(true);
    // 拒否は接ぎ木より前なので、データも載らない
    expect((rootEl as any).__state.st).toBeUndefined();
    errorSpy.mockRestore();
  });

  it("ボリュームの ** getter は接ぎ木前に拒否されること", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const lifecycle: string[] = [];
    document.body.innerHTML = `<wcs-state json='{"root":1}'></wcs-state><wcs-state mount="tv"></wcs-state>`;
    const rootEl = document.querySelector("wcs-state:not([mount])") as State;
    const volumeEl = document.querySelector("wcs-state[mount]") as State;
    const volumeState: any = {
      // $recursion は付けない — こちらは「`**` getter だけを持つボリューム」を隔離して測る
      nodes: forest(), plain: 1,
      $connectedCallback() { lifecycle.push("connected"); },
    };
    Object.defineProperty(volumeState, "nodes.**.total", {
      get(this: any) { return this["nodes.**.value"]; },
      enumerable: false, configurable: true,
    });
    Object.defineProperty(volumeState, "label", {
      get(this: any) { return "L" + this.plain; },
      enumerable: false, configurable: true,
    });
    volumeEl.setInitialState(volumeState);
    await rootEl.connectedCallbackPromise;
    await volumeEl.connectedCallbackPromise;
    await flush();

    // Fixed by Phase E — was: データだけ接ぎ木済みで、アクセサは 1 本も登録されず
    // （`**` より前の `label` すら）、$connectedCallback も呼ばれない「半端な接ぎ木」が
    // 残っていた。検査が defineTreeAccessor → getPathInfo まで遅れていたため。
    const messages = errorSpy.mock.calls.map((call) => String(call[0]) + "|" + String((call[1] as any)?.message ?? ""));
    expect(messages.some((m) => m.includes('declares "nodes.**.total", which uses "**"'))).toBe(true);
    expect(messages.some((m) => m.includes("Volumes do not support recursive getters yet"))).toBe(true);
    // 拒否は接ぎ木より前なので、データも載らない
    expect((rootEl as any).__state.tv).toBeUndefined();
    expect(lifecycle).toEqual([]);
    errorSpy.mockRestore();
  });
});

// ===========================================================================
// 3. 世代（再セット・再接続・木の伸縮）
// ===========================================================================

describe("再帰の世代: registry と生成アクセサが増え続けない", () => {
  async function mountPlainHost(initial: any = treeState()) {
    const host = document.createElement(uniqueTag("rint-gen"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<wcs-state></wcs-state><div data-wcs="textContent: title"></div>`;
    document.body.appendChild(host);
    const el = shadowRoot.querySelector("wcs-state") as State;
    el.setInitialState(initial);
    await el.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    await flush();
    return { host, shadowRoot, el };
  }
  /** 「実体化アクセサ数 / getterPaths 数 / listPaths 数」の 3 つ組。 */
  const census = (el: State): string =>
    `${(el as any).recursionRegistry.materializedPaths.size}` +
    `/${(el as any).getterPaths.size}` +
    `/${(el as any).listPaths.size}`;

  it("setInitialState の再セットを 5 回繰り返しても登録数が頭打ちになる", async () => {
    const { host, el } = await mountPlainHost();
    const sizes: string[] = [];
    for (let i = 0; i < 5; i++) {
      expect(read(el, (s) => s.$getAll("nodes.**.total", []))).toEqual([131, 110, 100, 20, 2]);
      sizes.push(census(el));
      el.setInitialState(treeState());
      await flush();
    }
    // 深さ 3 の木 → 生成アクセサ 3 本（total だけを読んだので rootIndex は生えない）、
    // listPaths 3 本（nodes / nodes.*.children / nodes.*.children.*.children）。
    expect(sizes).toEqual(["3/7/3", "3/7/3", "3/7/3", "3/7/3", "3/7/3"]);
    host.remove();
  });

  it("同じ state オブジェクトを再セットしても listPaths の登録が抜け落ちない", async () => {
    const { host, el } = await mountPlainHost();
    const same = treeState();
    el.setInitialState(same);
    await flush();
    const sizes: string[] = [];
    for (let i = 0; i < 4; i++) {
      expect(read(el, (s) => s.$getAll("nodes.**.total", []))).toEqual([131, 110, 100, 20, 2]);
      sizes.push(census(el));
      el.setInitialState(same);
      await flush();
      // Fixed by Phase E — was: [] （再セット直後は空で、次に読むまで張り直されなかった）。
      // アンカーのリストパスは宣言から静的に分かるので、再セットの時点で登録される。
      expect(Array.from((el as any).listPaths)).toEqual(["nodes"]);
      // 1 回読めば経路上のリストパスが張り直される（registry.ts の WeakSet 判定）
      read(el, (s) => s.$getAll("nodes.**.total", []));
      expect(Array.from((el as any).listPaths))
        .toEqual(["nodes", "nodes.*.children", "nodes.*.children.*.children"]);
    }
    expect(sizes).toEqual(["3/7/3", "3/7/3", "3/7/3", "3/7/3"]);
    host.remove();
  });

  it("切断→再接続を 4 往復しても登録数も集計も変わらない", async () => {
    const { host, el } = await mountPlainHost();
    const sizes: string[] = [];
    for (let i = 0; i < 4; i++) {
      expect(read(el, (s) => s.$getAll("nodes.**.total", []))).toEqual([131, 110, 100, 20, 2]);
      sizes.push(census(el));
      host.remove();
      await flush();
      document.body.appendChild(host);
      await flush();
    }
    expect(sizes).toEqual(["3/7/3", "3/7/3", "3/7/3", "3/7/3"]);
    expect(read(el, (s) => s.grandTotal)).toBe(133);
    host.remove();
  });

  it("固定の最大深さで木を 6 回伸縮しても登録数が頭打ちになる", async () => {
    const { host, el } = await mountPlainHost();
    const sizes: string[] = [];
    const results: number[][] = [];
    for (let i = 0; i < 6; i++) {
      // 偶数回は深さ 4、奇数回は深さ 1（最大深さは 4 で固定）
      write(el, (s: any) => {
        s.nodes = i % 2 === 0 ? [node(1, [node(2, [node(3, [node(4)])])])] : [node(9)];
      });
      await flush();
      results.push(read(el, (s) => s.$getAll("nodes.**.total", [])));
      sizes.push(census(el));
    }
    expect(results).toEqual([
      [10, 9, 7, 4], [9], [10, 9, 7, 4], [9], [10, 9, 7, 4], [9],
    ]);
    // 一度到達した深さ 4 のぶんだけ生えて、縮んでも減らず、増えもしない
    expect(sizes).toEqual(["4/8/4", "4/8/4", "4/8/4", "4/8/4", "4/8/4", "4/8/4"]);
    host.remove();
  });

  it("再帰を読んだ後に再セットしても、以後の構造書き込みが通ること", async () => {
    // Fixed by Phase E — was: 3 回とも
    // "Cannot expand dynamic dependency with wildcard for non-list address: nodes.*"。
    // 生成アクセサの setPathInfo が張った静的辺（nodes → nodes.*）は依存表に残るのに、
    // _listPaths はセッタでクリアされ、次に再帰パスを読むまで張り直されなかった。
    // その隙間に構造書き込みが来ると walkDependency が listIndex を持たない nodes.* に
    // 到達して落ち、**自己回復しなかった**（値だけは書かれるのでデータと表示が乖離する）。
    // アンカーのリストパスは宣言から静的に分かるので、再セットの時点で登録する。
    const { host, el } = await mountPlainHost();
    expect(read(el, (s) => s.$getAll("nodes.**.total", []))).toEqual([131, 110, 100, 20, 2]);
    el.setInitialState(treeState());
    await flush();

    const messages: string[] = [];
    for (let i = 0; i < 3; i++) {
      try {
        write(el, (s: any) => { s.nodes = [node(i + 1, [node(1)])]; });
        messages.push("ok");
      } catch (error: any) {
        messages.push(error.message);
      }
      await flush();
    }
    expect(messages).toEqual(["ok", "ok", "ok"]);
    // 書いた木がそのまま読める（データと通知が乖離していない）
    expect(read(el, (s) => s.$getAll("nodes.**.value", []))).toEqual([3, 1]);
    host.remove();
  });

  it("回避策の固定: 再セット後に一度読めば、構造書き込みは通る", async () => {
    const { host, el } = await mountPlainHost();
    read(el, (s) => s.$getAll("nodes.**.total", []));
    el.setInitialState(treeState());
    await flush();
    read(el, (s) => s.$getAll("nodes.**.total", []));   // ← これが listPaths を張り直す
    expect(() => write(el, (s: any) => { s.nodes = [node(3, [node(4)])]; })).not.toThrow();
    await flush();
    expect(read(el, (s) => s.$getAll("nodes.**.total", []))).toEqual([7, 4]);
    host.remove();
  });

  it("対照: 再帰なしの state は同じ手順で throw しない", async () => {
    const plain = () => {
      const state: any = { title: "plain", nodes: [{ value: 1 }, { value: 2 }] };
      Object.defineProperty(state, "nodes.*.double", {
        get(this: any) { return this["nodes.*.value"] * 2; },
        enumerable: false, configurable: true,
      });
      return state;
    };
    const { host, el } = await mountPlainHost(plain());
    expect(read(el, (s) => s.$getAll("nodes.*.double"))).toEqual([2, 4]);
    el.setInitialState(plain());
    await flush();
    expect(() => write(el, (s: any) => { s.nodes = [{ value: 9 }]; })).not.toThrow();
    await flush();
    expect(read(el, (s) => s.$getAll("nodes.*.double"))).toEqual([18]);
    host.remove();
  });
});

// ===========================================================================
// 4. SSR / hydration
// ===========================================================================

describe("再帰 × SSR / hydration", () => {
  /** クラス形（getter はプロトタイプ側 = own でも enumerable でもない）。 */
  class TreeStateClass {
    title = "tree";
    $recursion = { "nodes.*": "children.*" };
    nodes = forest();
    get "nodes.**.total"(this: any): number {
      return this["nodes.**.value"] +
        this.$getAll("nodes.**.children.*.total").reduce((a: number, b: number) => a + b, 0);
    }
    get grandTotal(this: any): number {
      return this.$getAll("nodes.**.value", []).reduce((a: number, b: number) => a + b, 0);
    }
  }

  const MARKUP =
    `<wcs-state enable-ssr></wcs-state>` +
    `<div id="grand" data-wcs="textContent: grandTotal"></div>` +
    `<ul><template data-wcs="for: nodes"><li class="t" data-wcs="textContent: nodes.*.total"></li></template></ul>`;

  const rowTexts = () => Array.from(document.querySelectorAll(".t")).map((n) => n.textContent);

  beforeEach(() => { document.body.innerHTML = ""; });
  afterEach(() => { document.documentElement.removeAttribute("data-wcs-server"); });

  async function serverRender(markup: string, make: () => any): Promise<string> {
    document.documentElement.setAttribute("data-wcs-server", "");
    document.body.innerHTML = markup;
    const el = document.querySelector("wcs-state") as State;
    el.setInitialState(make());
    await el.connectedCallbackPromise;
    await State.getBindingsReady(document);
    await flush();
    buildSsrDocument(document);
    const html = document.body.innerHTML;
    document.documentElement.removeAttribute("data-wcs-server");
    return html;
  }

  async function clientHydrate(html: string, make: () => any): Promise<State> {
    document.body.innerHTML = html;
    const el = document.querySelector("wcs-state") as State;
    el.setInitialState(make());
    await el.connectedCallbackPromise;
    await State.getBindingsReady(document);
    await flush();
    return el;
  }

  it("サーバー側で再帰集計が描画される", async () => {
    await serverRender(MARKUP, () => new TreeStateClass());
    expect(document.querySelector("#grand")?.textContent).toBe("133");
    expect(rowTexts()).toEqual(["131", "2"]);
  });

  it("スナップショットに ** も展開後の具体 getter パスも載らない（契約）", async () => {
    const html = await serverRender(MARKUP, () => new TreeStateClass());
    const json = document.querySelector("wcs-ssr script[type='application/json']")?.textContent ?? "";
    const snapshot = JSON.parse(json);
    // データだけ。宣言（$recursion）も getter も入らない
    expect(Object.keys(snapshot).sort()).toEqual(["nodes", "title"]);
    expect(json).not.toContain("**");
    expect(json).not.toContain("nodes.*.total");
    expect(json).not.toContain("$recursion");
    // 文書全体（テンプレート・プロパティ復元を含む）にも `**` は現れない
    expect(html).not.toContain("**");
    // 展開深さを載せる仕組みも無い（載せるとしたら <wcs-ssr> 側の属性になる）
    const ssrEl = document.querySelector("wcs-ssr")!;
    expect(ssrEl.getAttributeNames().sort()).toEqual(["version"]);
  });

  it("クライアントは宣言だけから再生成し、サーバーと同じ集計を出す", async () => {
    const html = await serverRender(MARKUP, () => new TreeStateClass());
    const el = await clientHydrate(html, () => new TreeStateClass());
    expect(document.querySelector("#grand")?.textContent).toBe("133");
    expect(rowTexts()).toEqual(["131", "2"]);
    // headless の列挙もサーバーと一致する（実体化はここで初めて起きる）
    expect(read(el, (s) => s.$getAll("nodes.**.total", []))).toEqual([131, 110, 100, 20, 2]);
    expect(Array.from((el as any).recursionRegistry.materializedPaths)).toEqual([
      "nodes.*.total",
      "nodes.*.children.*.total",
      "nodes.*.children.*.children.*.total",
    ]);
  });

  it("hydration 後、トップレベルの集計 getter は葉の更新に追従する", async () => {
    const html = await serverRender(MARKUP, () => new TreeStateClass());
    const el = await clientHydrate(html, () => new TreeStateClass());
    write(el, (s: any) => { s["nodes.0.children.0.children.0.value"] = 1000; });
    await flush();
    expect(document.querySelector("#grand")?.textContent).toBe("1033");
  });

  it("hydration 後、行の再帰 getter バインドも葉の更新に追従する（#258 X6）", async () => {
    const html = await serverRender(MARKUP, () => new TreeStateClass());
    const el = await clientHydrate(html, () => new TreeStateClass());
    // ハイドレーションが行のバインドにも初回値を適用する。その評価が生成アクセサを実体化し、依存辺を張る
    // （旧挙動: 初回適用が無く、この時点で実体化は 0 本・行のバインドは依存辺を持たなかった）
    expect(Array.from((el as any).recursionRegistry.materializedPaths)).toContain("nodes.*.total");
    expect(rowTexts(), "適用してもサーバーが書いたテキストと同じ").toEqual(["131", "2"]);
    write(el, (s: any) => { s["nodes.0.children.0.children.0.value"] = 1000; });
    await flush();
    expect(rowTexts()).toEqual(["1031", "2"]); // 旧: ["131", "2"]（サーバーが書いたテキストのまま）
    expect(read(el, (s) => s.$getAll("nodes.**.total", []))).toEqual([1031, 1010, 1000, 20, 2]);
  });

  it("再帰でない行 getter も、hydration 後の葉の更新に追従する（#258 X6 は再帰に固有ではなかった）", async () => {
    const plain = () => {
      const state: any = { title: "plain", nodes: forest() };
      Object.defineProperty(state, "nodes.*.double", {
        get(this: any) { return this["nodes.*.value"] * 2; },
        enumerable: false, configurable: true,
      });
      return state;
    };
    const markup =
      `<wcs-state enable-ssr></wcs-state>` +
      `<ul><template data-wcs="for: nodes"><li class="t" data-wcs="textContent: nodes.*.double"></li></template></ul>`;
    const html = await serverRender(markup, plain);
    expect(rowTexts()).toEqual(["2", "4"]);
    const el = await clientHydrate(html, plain);
    write(el, (s: any) => { s["nodes.0.value"] = 7; });
    await flush();
    // 旧: ["2", "4"]。再帰と無関係に同じ形で取り残されていた（スナップショット側の穴ではなく、
    // ハイドレーションが行のバインドに初回値を適用しなかったため）
    expect(rowTexts()).toEqual(["14", "4"]);
    expect(read(el, (s) => s.$getAll("nodes.*.double"))).toEqual([14, 4]);
  });

  it("hydration 後でも、一度読んでからの葉の更新は行のバインドに届く", async () => {
    const html = await serverRender(MARKUP, () => new TreeStateClass());
    const el = await clientHydrate(html, () => new TreeStateClass());
    read(el, (s) => s.$getAll("nodes.**.total", []));  // ← 実体化 + 依存辺
    write(el, (s: any) => { s["nodes.0.children.0.children.0.value"] = 1000; });
    await flush();
    expect(rowTexts()).toEqual(["1031", "2"]);
  });

  it("対照: hydration を経ない CSR では、行の再帰 getter が葉の更新に追従する", async () => {
    document.body.innerHTML = MARKUP.replace(" enable-ssr", "");
    const el = document.querySelector("wcs-state") as State;
    el.setInitialState(new TreeStateClass() as any);
    await el.connectedCallbackPromise;
    await State.getBindingsReady(document);
    await flush();
    expect(rowTexts()).toEqual(["131", "2"]);
    write(el, (s: any) => { s["nodes.0.children.0.children.0.value"] = 1000; });
    await flush();
    expect(rowTexts()).toEqual(["1031", "2"]);
  });

  it("own+enumerable な ** getter を持つ state でも SSR が通ること", async () => {
    // Fixed by Phase E — was: TypeError "$getAll is not a function" でページ全体の SSR が
    // 落ちた。Ssr.extractStateData が Object.entries で own+enumerable な getter を
    // **生の state オブジェクト**を this にして評価していたため。スナップショットが運ぶのは
    // データで、派生値はクライアントが同じ宣言から作り直す。
    const literal = () => ({
      title: "lit",
      $recursion: { "nodes.*": "children.*" },
      nodes: forest(),
      get "nodes.**.total"(this: any) {
        return this["nodes.**.value"] +
          this.$getAll("nodes.**.children.*.total").reduce((a: number, b: number) => a + b, 0);
      },
      get grandTotal(this: any) {
        return this.$getAll("nodes.**.value", []).reduce((a: number, b: number) => a + b, 0);
      },
    });
    // CSR では同じ state が正しく動く
    document.body.innerHTML = MARKUP.replace(" enable-ssr", "");
    let el = document.querySelector("wcs-state") as State;
    el.setInitialState(literal() as any);
    await el.connectedCallbackPromise;
    await State.getBindingsReady(document);
    await flush();
    expect(rowTexts()).toEqual(["131", "2"]);

    // SSR でも通り、サーバー描画の中身が出る
    document.documentElement.setAttribute("data-wcs-server", "");
    document.body.innerHTML = MARKUP;
    el = document.querySelector("wcs-state") as State;
    el.setInitialState(literal() as any);
    let message = "";
    try { await el.connectedCallbackPromise; } catch (error: any) { message = error?.message ?? String(error); }
    expect(message).toBe("");
    expect(document.querySelector("wcs-ssr")).not.toBeNull();
    // スナップショットにはデータだけが載る（派生値は載らない）
    const json = document.querySelector("wcs-ssr script[type='application/json']")?.textContent ?? "";
    const snapshot = JSON.parse(json);
    expect(Object.keys(snapshot).sort()).toEqual(["nodes", "title"]);
  });

  it("対照: プレーンなワイルドカード getter もスナップショットに載らないこと", async () => {
    // Fixed by Phase E — was: 生 this で評価されて NaN → JSON の null が載っていた。
    const literal = () => ({
      title: "plain",
      nodes: [{ value: 1 }, { value: 2 }],
      get "nodes.*.double"(this: any) { return this["nodes.*.value"] * 2; },
    });
    await serverRender(`<wcs-state enable-ssr></wcs-state>`, literal);
    const json = document.querySelector("wcs-ssr script[type='application/json']")?.textContent ?? "";
    const snapshot = JSON.parse(json);
    expect("nodes.*.double" in snapshot).toBe(false);
    expect(snapshot.nodes).toEqual([{ value: 1 }, { value: 2 }]);
  });
});
