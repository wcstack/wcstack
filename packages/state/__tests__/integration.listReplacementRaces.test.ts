/**
 * integration.listReplacementRaces.test.ts — リスト置換の既存バグ2件の回帰テスト
 * （diff-filter 展開作業のレビューで発見）。
 *
 * ① 同一 microtask 内の2回のリスト置換: createListDiff が diff 計算時に
 *    listIndex.index を先行変異するため、2回目の diff が「最後に描画された
 *    リスト」ではなく「未適用の中間リスト」基準で changeIndexSet を計算して
 *    しまい、インデックスバインディングの再適用漏れや値解決の乱れが起きる。
 * ② ループ外からの $resolve によるネストリスト置換: 直接適用では loop
 *    context スタックが空のため createLoopContext が throw する。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElementByName } from "../src/stateElementByName";

beforeAll(() => {
  bootstrapState();
});

let seq = 0;
const flush = () => new Promise((r) => setTimeout(r));

async function mount(initial: any, innerHTML: string) {
  const host = document.createElement(`listrace-host-${seq++}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = innerHTML + `<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(initial);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  const stateElement = getStateElementByName(shadowRoot, "default")!;
  return { host, shadowRoot, stateElement };
}

describe("同一 microtask 内の2回のリスト置換（バグ①）", () => {
  it("最終リストの順序が中間リストと同じでも、$1 バインディングが最終位置に追随すること", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      { items: [{ name: "a" }, { name: "b" }] },
      // |string は happy-dom の textContent falsy quirk 回避（数値 0 を代入すると空になる）
      `<ul><template data-wcs="for: items"><li><span class="i" data-wcs="textContent: $1|string"></span><span class="n">{{ .name }}</span></li></template></ul>`,
    );
    const texts = (cls: string) => Array.from(shadowRoot.querySelectorAll(`span.${cls}`)).map(el => el.textContent);
    expect(texts("n")).toEqual(["a", "b"]);
    expect(texts("i")).toEqual(["0", "1"]);

    stateElement.createState("writable", (s: any) => {
      const [a, b] = [s.items[0], s.items[1]];
      s.items = [b, a]; // 1回目: この diff は適用されないまま listIndex.index を変異させる
      s.items = [b, a]; // 2回目: 同順の別配列。diff は描画済みリスト基準で計算されるべき
    });
    await flush();

    expect(texts("n")).toEqual(["b", "a"]);
    // バグ時は changeIndexSet が空になり ["1", "0"] のまま残る
    expect(texts("i")).toEqual(["0", "1"]);
    host.remove();
  });

  it("置換後に同一 microtask 内で元のリスト参照へ戻すと、行の値解決が乱れないこと", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      { items: [{ name: "a" }, { name: "b" }] },
      `<ul><template data-wcs="for: items"><li data-wcs="textContent: .name"></li></template></ul>`,
    );
    const texts = () => Array.from(shadowRoot.querySelectorAll("li")).map(li => li.textContent);
    expect(texts()).toEqual(["a", "b"]);

    stateElement.createState("writable", (s: any) => {
      const orig = s.items; // 生配列参照
      s.items = [orig[1], orig[0]]; // 1回目: 反転（適用されないまま .index が変異する）
      s.items = orig;               // 2回目: 元の参照へ戻す（diff 上は変化なし）
    });
    await flush();

    // バグ時は .index が反転位置のまま残り、両行の値が入れ替わって描画される
    expect(texts()).toEqual(["a", "b"]);
    host.remove();
  });

  it("3回以上の置換でも最後の置換だけが反映されること", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      { items: [{ name: "a" }, { name: "b" }, { name: "c" }] },
      `<ul><template data-wcs="for: items"><li><span class="i" data-wcs="textContent: $1|string"></span><span class="n">{{ .name }}</span></li></template></ul>`,
    );
    const texts = (cls: string) => Array.from(shadowRoot.querySelectorAll(`span.${cls}`)).map(el => el.textContent);
    expect(texts("n")).toEqual(["a", "b", "c"]);

    stateElement.createState("writable", (s: any) => {
      const [a, b, c] = [s.items[0], s.items[1], s.items[2]];
      s.items = [c, a, b];
      s.items = [b, c, a];
      s.items = [c, b, a];
    });
    await flush();

    expect(texts("n")).toEqual(["c", "b", "a"]);
    expect(texts("i")).toEqual(["0", "1", "2"]);
    host.remove();
  });
});

describe("ループ外からの $resolve によるネストリスト置換（バグ②）", () => {
  it("先頭行のネストリストを $resolve で置換しても throw せず反映されること", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      { items: [{ children: [{ v: 1 }] }, { children: [{ v: 2 }] }] },
      `<ul><template data-wcs="for: items"><li><template data-wcs="for: items.*.children"><span>{{ .v }}</span></template></li></template></ul>`,
    );
    const texts = () => Array.from(shadowRoot.querySelectorAll("span")).map(el => el.textContent);
    expect(texts()).toEqual(["1", "2"]);

    stateElement.createState("writable", (s: any) => {
      s.$resolve("items.*.children", [0], [{ v: 9 }, { v: 10 }]);
    });
    await flush();

    expect(texts()).toEqual(["9", "10", "2"]);
    host.remove();
  });

  it("2行目のネストリスト置換でも親インデックスのチェーンが解決されること", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      { items: [{ children: [{ v: 1 }] }, { children: [{ v: 2 }] }] },
      `<ul><template data-wcs="for: items"><li><template data-wcs="for: items.*.children"><span>{{ .v }}</span></template></li></template></ul>`,
    );
    const texts = () => Array.from(shadowRoot.querySelectorAll("span")).map(el => el.textContent);
    expect(texts()).toEqual(["1", "2"]);

    stateElement.createState("writable", (s: any) => {
      s.$resolve("items.*.children", [1], [{ v: 9 }, { v: 10 }]);
    });
    await flush();

    expect(texts()).toEqual(["1", "9", "10"]);
    host.remove();
  });

  it("置換後のネスト行でインデックス（$2）が正しく解決されること", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      { items: [{ children: [{ v: 1 }] }] },
      `<ul><template data-wcs="for: items"><li><template data-wcs="for: items.*.children"><span data-wcs="textContent: $2|string"></span></template></li></template></ul>`,
    );
    const texts = () => Array.from(shadowRoot.querySelectorAll("span")).map(el => el.textContent);
    expect(texts()).toEqual(["0"]);

    stateElement.createState("writable", (s: any) => {
      s.$resolve("items.*.children", [0], [{ v: 5 }, { v: 6 }, { v: 7 }]);
    });
    await flush();

    expect(texts()).toEqual(["0", "1", "2"]);
    host.remove();
  });
});
