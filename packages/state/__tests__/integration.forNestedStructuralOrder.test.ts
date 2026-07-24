/**
 * integration.forNestedStructuralOrder.test.ts — 行の末尾トップレベルノードが
 * 構造ディレクティブのアンカーになる `for` 行の順序契約。
 *
 * この形（`for > if > li` / `for > for` のようにラップ要素が無い行）では、
 * ネストした if/for が「自分のアンカーの直後」に実ノードを挿すため、行 content の
 * childNodeArray は実レンジより狭くなる。かつてはそれが 2 通りに壊れていた:
 *
 *  1. 位置追跡の過小前進 — applyChangeToFor の lastNode が行の実ノードではなく
 *     アンカーで止まり、次の行が前の行の実ノードの「手前」に入る。1 件ずつ
 *     逐次追加すると行が完全な逆順で描画された。
 *  2. 移動時の置き去り — mountAfter が content 自身のノードだけを動かすため、
 *     並べ替えでアンカーだけが移動し実ノードが元位置に残った（＝並べ替えても
 *     表示が変わらない）。
 *
 * 現在は該当テンプレートにだけ終端マーカーを付けて実レンジを閉じ、移動を
 * レンジ単位で行うことで両方を塞いでいる。一括描画は別経路（appendTo）のため
 * 元から正しく、退行検出には「逐次」と「並べ替え」が要る。
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

async function mount(initial: unknown, innerHTML: string) {
  const host = document.createElement(`nested-order-host-${seq++}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = innerHTML + `<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(initial);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  const stateElement = getStateElementByName(shadowRoot, "default")!;
  return {
    host,
    texts: () => Array.from(shadowRoot.querySelectorAll("li")).map((el) => el.textContent),
    async set(fn: (s: any) => void) {
      stateElement.createState("writable", fn);
      await flush();
    },
  };
}

const row = (text: string) => ({ text, show: true });

// 行を要素で包まず、if を行の直下（＝末尾トップレベルノード）に置く形
const IF_TPL = `<ul><template data-wcs="for: items"><template data-wcs="if: .show"><li>{{ .text }}</li></template></template></ul>`;

describe("行末尾が構造アンカーになる for の順序契約", () => {
  it("1 件ずつ逐次追加しても正順を保つこと（旧: 完全な逆順）", async () => {
    const { host, texts, set } = await mount({ items: [] }, IF_TPL);
    for (const t of ["a", "b", "c", "d"]) {
      await set((s) => { s.items = [...s.items, row(t)]; });
    }
    expect(texts()).toEqual(["a", "b", "c", "d"]);
    host.remove();
  });

  it("並べ替えで実ノードが追従すること（旧: アンカーだけ動き表示は不変）", async () => {
    const { host, texts, set } = await mount(
      { items: ["a", "b", "c"].map(row) },
      IF_TPL,
    );
    expect(texts()).toEqual(["a", "b", "c"]);

    await set((s) => { s.items = s.items.toReversed(); });
    expect(texts()).toEqual(["c", "b", "a"]);

    await set((s) => { s.items = s.items.toSorted((x: any, y: any) => x.text.localeCompare(y.text)); });
    expect(texts()).toEqual(["a", "b", "c"]);
    host.remove();
  });

  it("削除・先頭挿入・if のトグルが混在しても並びが保たれること", async () => {
    const { host, texts, set } = await mount(
      { items: ["a", "b", "c"].map(row) },
      IF_TPL,
    );
    await set((s) => { s.items = s.items.toSpliced(1, 1); });
    expect(texts()).toEqual(["a", "c"]);

    await set((s) => { s.items = [row("z"), ...s.items]; });
    expect(texts()).toEqual(["z", "a", "c"]);

    // 中間行を隠す → 残りの並びは不変
    await set((s) => {
      s.items = s.items.map((it: any) => (it.text === "a" ? { ...it, show: false } : it));
    });
    expect(texts()).toEqual(["z", "c"]);

    // 再表示で元の位置へ戻ること（アンカーは残っているので位置が保たれる）
    await set((s) => { s.items = s.items.map((it: any) => ({ ...it, show: true })); });
    expect(texts()).toEqual(["z", "a", "c"]);
    host.remove();
  });

  it("ネストした for（ラップ要素なし）でも逐次追加で正順を保つこと", async () => {
    const { host, set } = await mount(
      { groups: [] as { rows: { text: string }[] }[] },
      `<ul><template data-wcs="for: groups"><template data-wcs="for: .rows"><li>{{ .text }}</li></template></template></ul>`,
    );
    for (const g of [["a1", "a2"], ["b1"], ["c1", "c2"]]) {
      await set((s) => { s.groups = [...s.groups, { rows: g.map((text) => ({ text })) }]; });
    }
    const host2 = host as HTMLElement;
    const texts = Array.from(host2.shadowRoot!.querySelectorAll("li")).map((el) => el.textContent);
    expect(texts).toEqual(["a1", "a2", "b1", "c1", "c2"]);
    host.remove();
  });

  it("行を要素で包んだ形は終端マーカーを持たず、従来どおり動くこと", async () => {
    // 包んだ行の実レンジは <li> 自身で閉じるので範囲モードに入らない＝追加コストなし
    const { host, texts, set } = await mount(
      { items: [] },
      `<ul><template data-wcs="for: items"><li><template data-wcs="if: .show"><span>{{ .text }}</span></template></li></template></ul>`,
    );
    for (const t of ["a", "b", "c"]) {
      await set((s) => { s.items = [...s.items, row(t)]; });
    }
    expect(texts()).toEqual(["a", "b", "c"]);

    const ul = (host as HTMLElement).shadowRoot!.querySelector("ul")!;
    const markers = Array.from(ul.childNodes).filter(
      (n) => n.nodeType === Node.COMMENT_NODE && (n.textContent ?? "").startsWith("wcs-row-end"),
    );
    expect(markers).toHaveLength(0);
    host.remove();
  });
});
