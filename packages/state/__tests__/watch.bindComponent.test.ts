/**
 * watch.bindComponent.test.ts
 *
 * `$watch` の bind-component 境界（実装計画 Phase B / P9）。
 *
 * 親の `for` の中にコンポーネントがある形では、listIndex チェーンの長さが
 * Δ（ホスト行の深さ）+ W（そのパスのワイルドカード数）になる。ハンドラへ渡す indexes は
 * `getScopedIndexes` が Δ 段を落として「そのスコープ自身のループ分」だけにする ——
 * コンポーネントの作者は自分がリストの中に置かれるかを知らずに書くため、`$1` や
 * ハンドラ引数の意味が設置場所で変わってはいけない
 * （docs/state-bind-component-nested-for-design.md）。
 *
 * **mapped 形（`data-wcs="state.x: ..."` で親の値を子に写す形）では `$watch` を
 * 宣言できない**。子 state は innerState proxy で包まれ、その get トラップが `$` 始まりの
 * プロパティを一律 undefined で返すため、宣言が `_state` セッターに届かない
 * （webComponent/innerState.ts）。`$streams` を含む全ての `$` 宣言マップに共通の
 * 既存境界仕様であり、watch 固有の制約ではない。下の 1 本目がそれを固定する。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getWatchEntries } from "../src/watch/watchRegistry";

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));

let counter = 0;
const uniqueTag = (prefix: string): string => `${prefix}-${++counter}`;

/** 子スコープの watch が観測した (indexes, cur, prev) の記録先（全インスタンス共有） */
const observed: Array<[number[], unknown, unknown]> = [];

const LIST_TEMPLATE =
  `<ul id="inner-view"><template data-wcs="for: items">` +
  `<li data-wcs="textContent: items.*.name"></li>` +
  `</template></ul>`;

function defineComponent(tag: string, initialItems: Array<{ name: string }>): void {
  class Component extends HTMLElement {
    state: Record<string, any> = {
      items: initialItems.map((item) => ({ ...item })),
      $watch: {
        "items.*.name"(cur: unknown, prev: unknown, ...indexes: number[]) {
          observed.push([indexes, cur, prev]);
        },
      },
    };
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.shadowRoot!.innerHTML =
        `<wcs-state bind-component="state"></wcs-state>${LIST_TEMPLATE}`;
    }
  }
  customElements.define(tag, Component);
}

/**
 * 親の `for` の中にコンポーネントを置く（Δ=1）。
 * `mapped` が true なら `data-wcs="state.items: groups.*.children"` を付けて親の値を写し、
 * false なら属性を付けずコンポーネント自身のローカル state で `for` を回す。
 */
async function mountInParentFor(mapped: boolean) {
  const tag = uniqueTag("watch-bc-item");
  defineComponent(tag, [{ name: "x0" }, { name: "x1" }]);

  const attr = mapped ? ` data-wcs="state.items: groups.*.children"` : "";
  const host = document.createElement(uniqueTag("watch-bc-host"));
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `
    <wcs-state json='${JSON.stringify({
      groups: [
        { children: [{ name: "a0" }, { name: "a1" }] },
        { children: [{ name: "b0" }, { name: "b1" }] },
      ],
    })}'></wcs-state>
    <div id="outer"><template data-wcs="for: groups">
      <section><${tag}${attr}></${tag}></section>
    </template></div>
  `;
  document.body.appendChild(host);

  const parentStateElement = shadowRoot.querySelector("wcs-state") as State;
  await parentStateElement.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  await flush();

  const components = Array.from(shadowRoot.querySelectorAll(tag)) as HTMLElement[];
  const childStateElements: State[] = [];
  for (const component of components) {
    const childShadow = component.shadowRoot!;
    const childStateElement = childShadow.querySelector("wcs-state") as State;
    await childStateElement.connectedCallbackPromise;
    await State.getBindingsReady(childShadow);
    childStateElements.push(childStateElement);
  }
  await flush();

  const renderedOf = (i: number) =>
    Array.from(components[i].shadowRoot!.querySelectorAll("li")).map((li) => li.textContent);

  return { host, parentStateElement, childStateElements, renderedOf };
}

describe("$watch と bind-component 境界", () => {
  it("mapped 形では $watch 宣言が子スコープに届かないこと（innerState proxy が `$` を遮る既存仕様）", async () => {
    observed.length = 0;
    const { host, childStateElements, renderedOf } = await mountInParentFor(true);

    // 親の値は正しく写っている（マッピング自体は生きている）
    expect(renderedOf(1)).toEqual(["b0", "b1"]);
    // が、`$watch` は宣言として届かないので registry は空
    expect(childStateElements[1].watchPaths).toBeNull();
    expect(getWatchEntries(childStateElements[1]).size).toBe(0);

    childStateElements[1].createState("writable", (state) => {
      state.$resolve("items.*.name", [1], "B1!");
    });
    await flush();

    expect(observed).toEqual([]);
    expect(renderedOf(1)).toEqual(["b0", "B1!"]);
    host.remove();
  });

  it("P9: plain 形の子スコープでは、親の for の中にいても indexes が自スコープ分だけになること", async () => {
    observed.length = 0;
    const { host, childStateElements, renderedOf } = await mountInParentFor(false);
    expect(childStateElements).toHaveLength(2);
    expect(renderedOf(1)).toEqual(["x0", "x1"]);
    expect(childStateElements[1].watchPaths!.has("items.*.name")).toBe(true);

    // 親の行 1 に置かれたコンポーネントの、子スコープ行 1 を書き換える。
    // 設置場所（Δ）に関わらず、ハンドラが受けるのは子スコープ自身のループ分だけ。
    childStateElements[1].createState("writable", (state) => {
      state.$resolve("items.*.name", [1], "X1!");
    });
    await flush();

    expect(observed).toEqual([[[1], "X1!", "x1"]]);
    host.remove();
  });

  it("P9 補: 同じコンポーネントを親のどの行に置いても indexes の意味が変わらないこと", async () => {
    observed.length = 0;
    const { host, childStateElements } = await mountInParentFor(false);

    childStateElements[0].createState("writable", (state) => {
      state.$resolve("items.*.name", [0], "A0!");
    });
    await flush();
    childStateElements[1].createState("writable", (state) => {
      state.$resolve("items.*.name", [0], "B0!");
    });
    await flush();

    expect(observed).toEqual([
      [[0], "A0!", "x0"],
      [[0], "B0!", "x0"],
    ]);
    host.remove();
  });
});
