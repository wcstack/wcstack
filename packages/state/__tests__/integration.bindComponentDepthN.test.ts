/**
 * bind-component の境界を複数枚重ねたとき（深さ N の接ぎ木）に相似形が保たれるかの統合テスト。
 *
 * 既存の bind-component カバレッジは unit / e2e とも**すべて深さ 1** で、
 * ホスト → コンポーネントの 1 枚しか通していない。`bind-component-nested-for` も
 * 入れ子なのは `for` であって境界ではない（`group-eager` / `group-lazy` は
 * 親ループ内の兄弟）。
 *
 * 一方 `innerState` の解決は構成的で、`getOuterAbsolutePathInfo` が返す
 * 「外側の stateElement」はそれ自身また innerState でありうる。つまり多段は
 * 特別扱いなしに成立する**形**にはなっている。ここではそれを実測する。
 *
 * 構成は「同じ形のコンポーネントを N 段入れ子にする」= 相似形そのもの:
 *
 *   host scope   { box: { label } }
 *     └ <c1 data-wcs="state.box: box">   … 境界 1 枚目
 *          └ <c2 data-wcs="state.box: box">  … 境界 2 枚目
 *               └ … (N 段)
 *                    └ textContent: box.label
 *
 * 最下層の `box.label` は N 枚の境界を遡って host の `box.label` に解決されなければならない。
 * 深さを変数にしているのは、通る／通らないではなく**どこで破綻するか**を測るため。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));

let counter = 0;
const uniqueTag = (prefix: string): string => `${prefix}-${++counter}`;

/** shadow の構築タイミング。§1.9 の理由で両方を並べる。 */
type BuildTiming = "constructor" | "connectedCallback";

function defineComponent(
  tag: string,
  initialState: Record<string, any>,
  innerTemplate: string,
  timing: BuildTiming,
): void {
  const markup = `<wcs-state bind-component="state"></wcs-state>${innerTemplate}`;
  class Comp extends HTMLElement {
    state: Record<string, any> = structuredClone(initialState);
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      if (timing === "constructor") {
        this.shadowRoot!.innerHTML = markup;
      }
    }
    connectedCallback() {
      if (timing === "connectedCallback" && this.shadowRoot!.childNodes.length === 0) {
        this.shadowRoot!.innerHTML = markup;
      }
    }
  }
  customElements.define(tag, Comp);
}

/** shadow 内の `<wcs-state>` の初期化とバインディング確立を待つ。 */
async function readyScope(root: DocumentFragment): Promise<State> {
  const stateElement = root.querySelector("wcs-state") as State;
  await stateElement.connectedCallbackPromise;
  await State.getBindingsReady(root as unknown as ShadowRoot);
  return stateElement;
}

const textOf = (root: ParentNode, selector: string): string | null =>
  (root.querySelector(selector) as HTMLElement | null)?.textContent ?? null;

/**
 * 同一構造のコンポーネントを `depth` 段入れ子にしてマウントする。
 * 返り値の `scopes[0]` が最上位（host）、`scopes[depth]` が最下層。
 */
async function mountChain(depth: number, timing: BuildTiming) {
  // 最下層から組み立てる（内側のタグが決まらないと外側のテンプレートが書けない）
  let innerMarkup = `<span class="view" data-wcs="textContent: box.label"></span>`;
  const tags: string[] = [];
  for (let level = depth; level >= 1; level--) {
    const tag = uniqueTag(`bcn-l${level}`);
    defineComponent(tag, { box: {} }, innerMarkup, timing);
    innerMarkup =
      `<span class="view" data-wcs="textContent: box.label"></span>` +
      `<${tag} data-wcs="state.box: box"></${tag}>`;
    tags.unshift(tag);
  }

  const host = document.createElement(uniqueTag("bcn-host"));
  const hostShadow = host.attachShadow({ mode: "open" });
  hostShadow.innerHTML =
    `<wcs-state json='{"box":{"label":"A"}}'></wcs-state>` + innerMarkup;
  document.body.appendChild(host);

  // 各段の scope を上から順に確立する
  const states: State[] = [await readyScope(hostShadow)];
  const roots: ParentNode[] = [hostShadow];
  let current: ParentNode = hostShadow;
  for (const tag of tags) {
    const element = current.querySelector(tag) as HTMLElement;
    const shadow = element.shadowRoot!;
    states.push(await readyScope(shadow));
    roots.push(shadow);
    current = shadow;
  }
  await flush();

  return {
    host,
    states,
    /** 各段のビューの表示値。index 0 が host、index depth が最下層。 */
    views: () => roots.map((root) => textOf(root, ".view")),
  };
}

const DEPTHS = [1, 2, 3, 4];

describe.each<BuildTiming>(["constructor", "connectedCallback"])(
  "bind-component: 境界を N 枚重ねた接ぎ木 [shadow を %s で構築]",
  (timing) => {
    describe.each(DEPTHS)("深さ %i", (depth) => {
      const expectAll = (views: (string | null)[], value: string) =>
        expect(views).toEqual(Array(depth + 1).fill(value));

      it("初期配送が全段を通ること", async () => {
        const { host, views } = await mountChain(depth, timing);
        expectAll(views(), "A");
        host.remove();
      });

      it("最上位スコープからの書き込みが最下層まで届くこと", async () => {
        const { host, states, views } = await mountChain(depth, timing);

        states[0].createState("writable", (s: any) => {
          s["box.label"] = "B";
        });
        await flush();

        expectAll(views(), "B");
        host.remove();
      });

      it("最下層スコープからの書き戻しが最上位まで届くこと", async () => {
        const { host, states, views } = await mountChain(depth, timing);

        states[depth].createState("writable", (s: any) => {
          s["box.label"] = "C";
        });
        await flush();

        expectAll(views(), "C");
        host.remove();
      });

      it("中間スコープからの書き込みが上下どちらにも届くこと", async () => {
        const { host, states, views } = await mountChain(depth, timing);

        const middle = Math.max(1, Math.floor(depth / 2));
        states[middle].createState("writable", (s: any) => {
          s["box.label"] = "D";
        });
        await flush();

        expectAll(views(), "D");
        host.remove();
      });
    });
  },
);

/**
 * リストが境界を N 枚越える形。
 *
 * リストの越境は §1.8 / §1.9 / §1.10 のいずれもが落ちた場所で、行の同一性
 * （`IListIndex`）を配列オブジェクトの同一性で親子が共有する前提に乗っている。
 * その前提が境界 2 枚以上でも保たれるかは一度も測られていない。
 *
 * **深さ 1 を対照として同じテストに含める**のが要点。深さ 1 は既存の
 * `integration.bindComponentListRow.test.ts` が固定している成立形なので、
 * 深さ 1 が通り深さ 2 が落ちるなら、それはテストの書き方ではなく機構の限界を指す。
 *
 *   host { rows: [...] }
 *     └ <p1 data-wcs="state.list: rows">   … 中継（配列を下へ渡すだけ）
 *          └ … <pN data-wcs="state.list: list">
 *               └ <template data-wcs="for: list">  … 最下層だけが回す
 */
describe.each([1, 2, 3])("bind-component: リストが境界を %i 枚越える", (depth) => {
  const LEAF_TEMPLATE =
    `<ul><template data-wcs="for: list">` +
    `<li class="row" data-wcs="textContent: list.*.name"></li>` +
    `</template></ul>`;

  async function mountListChain() {
    // 最下層から組み立てる
    let innerMarkup = LEAF_TEMPLATE;
    const tags: string[] = [];
    for (let level = depth; level >= 1; level--) {
      const tag = uniqueTag(`bcl-l${level}`);
      defineComponent(tag, { list: [] }, innerMarkup, "connectedCallback");
      // 最上段だけ host の `rows` を、それ以外は 1 つ外の `list` を受ける
      const outerPath = level === 1 ? "rows" : "list";
      innerMarkup = `<${tag} data-wcs="state.list: ${outerPath}"></${tag}>`;
      tags.unshift(tag);
    }

    const host = document.createElement(uniqueTag("bcl-host"));
    const hostShadow = host.attachShadow({ mode: "open" });
    hostShadow.innerHTML =
      `<wcs-state json='{"rows":[{"name":"a"},{"name":"b"}]}'></wcs-state>` + innerMarkup;
    document.body.appendChild(host);

    const hostState = await readyScope(hostShadow);
    const states: State[] = [hostState];
    let current: ParentNode = hostShadow;
    for (const tag of tags) {
      const element = current.querySelector(tag) as HTMLElement;
      const shadow = element.shadowRoot!;
      states.push(await readyScope(shadow));
      current = shadow;
    }
    await flush();

    const rows = () =>
      Array.from((current as ParentNode).querySelectorAll(".row")).map((el) => el.textContent);

    return { host, hostState, leafState: states[depth], rows };
  }

  it("初期描画が全境界を越えて行を作ること", async () => {
    const { host, rows } = await mountListChain();
    expect(rows()).toEqual(["a", "b"]);
    host.remove();
  });

  /**
   * §1.11 の回帰。深さ 2 以上ではこれだけが成立していなかった。
   *
   * `BindingSession.registerAddress` は行バインディングを親スコープのパターン台帳へ
   * 相乗りさせるが（§1.8）、相手を決める `getOuterRowPathInfo` は境界を 1 枚しか
   * 遡らず、控えも `record.outerPatternPathInfo` の単数フィールド 1 つきりだった。
   * 結果、深さ 2 では最下層の行が中間スコープの `list.*.name` にしか載らず、
   * host が `rows.*.name` へ書いても購読者が誰もいなかった。
   *
   * 他の経路が深さに強いのは、いずれも**再帰的に解決**しているため
   * （`innerState.get` / `set` は外側 stateElement へ再入し、その外側自身が
   * innerState でありうる）。ここだけが**明示的な 1 回登録**で 1 段に留まっていた。
   */
  it("最上位の行フィールドへの書き込みが最下層の行に届くこと", async () => {
    const { host, hostState, rows } = await mountListChain();

    hostState.createState("writable", (s: any) => {
      s["rows.0.name"] = "a2";
    });
    await flush();

    expect(rows()).toEqual(["a2", "b"]);
    host.remove();
  });

  it("最上位でのリスト置換が最下層に届くこと", async () => {
    const { host, hostState, rows } = await mountListChain();

    hostState.createState("writable", (s: any) => {
      s.rows = [{ name: "c" }, { name: "d" }, { name: "e" }];
    });
    await flush();

    expect(rows()).toEqual(["c", "d", "e"]);
    host.remove();
  });

  it("最下層からの行フィールド書き戻しが最上位に届くこと", async () => {
    const { host, hostState, leafState, rows } = await mountListChain();

    leafState.createState("writable", (s: any) => {
      s["list.0.name"] = "z";
    });
    await flush();

    expect(rows()).toEqual(["z", "b"]);

    let hostValue: unknown;
    hostState.createState("readonly", (s: any) => {
      hostValue = s["rows.0.name"];
    });
    expect(hostValue).toBe("z");

    host.remove();
  });
});

/**
 * **既知の限界（§1.11 とは別件・修正前から不成立）**。
 *
 * §1.10 の入れ子形（コンポーネントが親の `for` の中にいて自分でも `for` を回す）に、
 * もう 1 枚境界を足した形。中間コンポーネントが Δ=1 の位置にいる。
 *
 *   host { groups: [ { children: [...] }, ... ] }
 *     └ <template for: groups>
 *          └ <panel state.items: groups.*.children>   … Δ=1 の中間（素通し）
 *               └ <card state.list: items>            … 最下層が回す
 *
 * これは `ListIndex not found: groups.*.children.*.name` で**初期描画から**落ちる。
 * つまり行フィールドの購読（§1.11）より手前、listIndex の越境そのものが成立していない。
 * `getBaseListIndex` はコンポーネント要素のループ文脈を 1 枚分しか見ないため、
 * 境界 2 枚を跨ぐと Δ の合成（Δ₁+Δ₂）が失われるものと見られる。
 *
 * §1.11 の修正（外向き walk の多段化）とは独立で、その修正の前後で症状は同一
 * ——修正前 4 件失敗 / 修正後 2 件失敗、残るのがこの 2 件——であることを確認済み。
 *
 * `it.fails` では固定できないので `describe.skip` にしてある。この形の失敗は
 * 同期アサーションではなく updater の drain から**非同期に throw** されるため、
 * `it.fails` を使うと Vitest の unhandled error として残りスイートが汚れる。
 * この形が直ったら `.skip` を外すこと（そのまま回帰テストになる）。
 */
describe.skip("bind-component: 親ループの中の中間コンポーネント越しに 2 枚越える (Δ>0)", () => {
  async function mountNestedChainDepth2() {
    const cardTag = uniqueTag("bcd2-card");
    const panelTag = uniqueTag("bcd2-panel");

    defineComponent(
      cardTag,
      { list: [] },
      `<ul><template data-wcs="for: list">` +
        `<li class="row" data-wcs="textContent: list.*.name"></li>` +
        `</template></ul>`,
      "connectedCallback",
    );
    defineComponent(
      panelTag,
      { items: [] },
      `<${cardTag} data-wcs="state.list: items"></${cardTag}>`,
      "connectedCallback",
    );

    const host = document.createElement(uniqueTag("bcd2-host"));
    const hostShadow = host.attachShadow({ mode: "open" });
    hostShadow.innerHTML =
      `<wcs-state json='{"groups":[{"children":[{"name":"a"},{"name":"b"}]},{"children":[{"name":"c"}]}]}'></wcs-state>` +
      `<template data-wcs="for: groups">` +
      `<${panelTag} data-wcs="state.items: groups.*.children"></${panelTag}>` +
      `</template>`;
    document.body.appendChild(host);

    const hostState = await readyScope(hostShadow);
    const panels = Array.from(hostShadow.querySelectorAll(panelTag)) as HTMLElement[];
    const leafShadows: ShadowRoot[] = [];
    for (const panel of panels) {
      await readyScope(panel.shadowRoot!);
      const card = panel.shadowRoot!.querySelector(cardTag) as HTMLElement;
      await readyScope(card.shadowRoot!);
      leafShadows.push(card.shadowRoot!);
    }
    await flush();

    const groupRows = () =>
      leafShadows.map((shadow) =>
        Array.from(shadow.querySelectorAll(".row")).map((el) => el.textContent),
      );

    return { host, hostState, groupRows };
  }

  it("初期描画が全グループで成立すること", async () => {
    const { host, groupRows } = await mountNestedChainDepth2();
    expect(groupRows()).toEqual([["a", "b"], ["c"]]);
    host.remove();
  });

  it("最上位の行フィールド書き込みが該当グループの行にだけ届くこと", async () => {
    const { host, hostState, groupRows } = await mountNestedChainDepth2();

    hostState.createState("writable", (s: any) => {
      s["groups.0.children.1.name"] = "b2";
    });
    await flush();

    expect(groupRows()).toEqual([["a", "b2"], ["c"]]);
    host.remove();
  });
});
