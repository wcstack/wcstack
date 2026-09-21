/**
 * proxy.keyed.test.ts — 鍵付き購読 `$eq` / `$eqPath` / `$eqIndex`（dependency/keyedDependency.ts）。
 * 選択のような「1 行だけ真」の行 getter が、パスへの書き込みで旧行と新行だけを再評価すること、
 * 退役した行の購読が行と一緒に落ちること、`$eqIndex` の鍵が差分側で付け替わることを固定する。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElement } from "../src/stateElementByName";
import { countKeyedSubscriptions, dropKeyedSubscriptionsByListIndex, keyedDependents, rekeyIndexSubscriptions } from "../src/dependency/keyedDependency";
import { createListIndex } from "../src/list/createListIndex";
import { buildSsrDocument } from "../src/buildSsrDocument";

beforeAll(() => {
  bootstrapState();
});

let seq = 0;
const flush = () => new Promise((r) => setTimeout(r));

async function mount(initial: any, innerHTML: string) {
  const host = document.createElement(`keyed-host-${seq++}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = innerHTML + `<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(initial);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  const stateElement = getStateElement(shadowRoot)!;
  const write = async (fn: (s: any) => void) => { stateElement.createState("writable", fn); await flush(); };
  const read = <T,>(fn: (s: any) => T): T => { let out!: T; stateElement.createState("readonly", (s: any) => { out = fn(s); }); return out; };
  const selected = () => Array.from(shadowRoot.querySelectorAll("li")).filter((li) => li.classList.contains("sel")).map((li) => li.textContent);
  const texts = () => Array.from(shadowRoot.querySelectorAll("li")).map((li) => li.textContent);
  return { host, shadowRoot, stateElement, write, read, selected, texts };
}

const ROWS = `<ul><template data-wcs="for: items"><li data-wcs="class.sel: .selected; textContent: .id"></li></template></ul>`;

describe("$eq: 任意の鍵で購読する", () => {
  it("`$1` を鍵にした選択は書き込みで旧行と新行だけを再評価し、削除では再評価で鍵が移ること", async () => {
    let evals = 0;
    const { host, write, selected, texts, stateElement } = await mount(
      {
        items: [{ id: "a" }, { id: "b" }, { id: "c" }],
        selectedIndex: null,
        get "items.*.selected"(this: any) { evals++; return this.$eq("selectedIndex", this.$1); },
      },
      ROWS,
    );
    expect(evals).toBe(3);
    expect(countKeyedSubscriptions(stateElement, "selectedIndex")).toBe(3);
    await write((s) => { s.selectedIndex = 1; });
    expect(selected()).toEqual(["b"]);
    expect(evals).toBe(4);
    await write((s) => { s.selectedIndex = 2; });
    expect(selected()).toEqual(["c"]);
    expect(evals).toBe(6);
    // 同じ値の書き込みは同値ガードで落ちる
    await write((s) => { s.selectedIndex = 2; });
    expect(evals).toBe(6);
    // 行 a を削除: `$1` を読む getter は移動した全行が再評価され、鍵が新しい index へ移る
    await write((s) => { s.items = s.items.slice(1); });
    expect(texts()).toEqual(["b", "c"]);
    expect(selected()).toEqual([]);
    expect(countKeyedSubscriptions(stateElement, "selectedIndex")).toBe(2);
    await write((s) => { s.selectedIndex = 1; });
    expect(selected()).toEqual(["c"]);
    host.remove();
  });

  it("行の外の getter でも購読でき、書き込みで再評価されること（listIndex 無しの登録）", async () => {
    let evals = 0;
    const { host, write, read, stateElement } = await mount(
      {
        mode: "a",
        get isA(this: any) { evals++; return this.$eq("mode", "a"); },
      },
      `<span data-wcs="textContent: isA"></span>`,
    );
    expect(read((s) => s.isA)).toBe(true);
    const before = evals;
    expect(countKeyedSubscriptions(stateElement, "mode")).toBe(1);
    await write((s) => { s.mode = "b"; });
    expect(read((s) => s.isA)).toBe(false);
    expect(evals).toBeGreaterThan(before);
    host.remove();
  });

  it("getter の外（メソッド）で呼ぶと比較結果を返すだけで購読しないこと", async () => {
    const { host, read, stateElement } = await mount(
      {
        selectedId: "x",
        alias: "x",
        check(this: any) { return [this.$eq("selectedId", "x"), this.$eqPath("selectedId", "alias"), this.$eq("selectedId", "y")]; },
      },
      `<span></span>`,
    );
    expect(read((s) => s.check())).toEqual([true, true, false]);
    expect(countKeyedSubscriptions(stateElement, "selectedId")).toBe(0);
    expect(countKeyedSubscriptions(stateElement, "nowhere")).toBe(0);
    host.remove();
  });
});

describe("$eqPath: 行 id を依存なしで鍵にする", () => {
  it("選択の書き込みは旧行と新行だけを再評価し、リスト置換は再評価しないこと", async () => {
    let evals = 0;
    const { host, write, selected, texts, stateElement } = await mount(
      {
        items: [{ id: "a" }, { id: "b" }, { id: "c" }],
        selectedId: null,
        get "items.*.selected"(this: any) { evals++; return this.$eqPath("selectedId", "items.*.id"); },
      },
      ROWS,
    );
    expect(evals).toBe(3);
    expect(selected()).toEqual([]);
    expect(countKeyedSubscriptions(stateElement, "selectedId")).toBe(3);

    await write((s) => { s.selectedId = "b"; });
    expect(selected()).toEqual(["b"]);
    expect(evals).toBe(4); // 新行 b だけ（旧値 null に購読者なし）

    await write((s) => { s.selectedId = "c"; });
    expect(selected()).toEqual(["c"]);
    expect(evals).toBe(6); // 旧行 b ＋ 新行 c

    // 置換（並べ替え）: パターン辺が無いので getter は 1 件も再評価されない
    const before = evals;
    await write((s) => { s.items = [...s.items].reverse(); });
    expect(texts()).toEqual(["c", "b", "a"]);
    expect(selected()).toEqual(["c"]);
    expect(evals).toBe(before);
    host.remove();
  });

  it("削除された行の購読は行と一緒に落ち、購読の無いリストの削除は素通りすること", async () => {
    let evals = 0;
    const { host, write, selected, stateElement, shadowRoot } = await mount(
      {
        items: [{ id: "a" }, { id: "b" }, { id: "c" }],
        plain: [{ id: "p" }, { id: "q" }],
        selectedId: "b",
        get "items.*.selected"(this: any) { evals++; return this.$eqPath("selectedId", "items.*.id"); },
      },
      ROWS + `<ol><template data-wcs="for: plain"><li>{{ .id }}</li></template></ol>`,
    );
    expect(selected()).toEqual(["b"]);
    expect(countKeyedSubscriptions(stateElement, "selectedId")).toBe(3);

    await write((s) => { s.items = s.items.filter((x: any) => x.id !== "b"); });
    expect(selected()).toEqual([]);
    expect(countKeyedSubscriptions(stateElement, "selectedId")).toBe(2);

    const before = evals;
    await write((s) => { s.selectedId = "c"; });
    expect(selected()).toEqual(["c"]);
    expect(evals).toBe(before + 1); // 旧値 b の行は退役済みで通知されない

    // 購読を持たないリストの行削除（退役フックは何もしない）
    await write((s) => { s.plain = s.plain.slice(1); });
    expect(Array.from(shadowRoot.querySelectorAll("ol li")).map((li) => li.textContent)).toEqual(["q"]);
    expect(evals).toBe(before + 1);
    host.remove();
  });

  it("入れ子のワイルドカードでも行単位に購読すること", async () => {
    let evals = 0;
    const { host, write, selected, stateElement } = await mount(
      {
        groups: [{ items: [{ id: "a" }, { id: "b" }] }, { items: [{ id: "c" }] }],
        selectedId: null,
        get "groups.*.items.*.selected"(this: any) { evals++; return this.$eqPath("selectedId", "groups.*.items.*.id"); },
      },
      `<template data-wcs="for: groups"><ul><template data-wcs="for: .items"><li data-wcs="class.sel: .selected; textContent: .id"></li></template></ul></template>`,
    );
    expect(evals).toBe(3);
    expect(countKeyedSubscriptions(stateElement, "selectedId")).toBe(3);
    await write((s) => { s.selectedId = "c"; });
    expect(selected()).toEqual(["c"]);
    expect(evals).toBe(4);
    await write((s) => { s.selectedId = "a"; });
    expect(selected()).toEqual(["a"]);
    expect(evals).toBe(6);
    host.remove();
  });
});

describe("$eqIndex: index を鍵にし、差分側で付け替える", () => {
  it("選択は index に付き、1 行削除は移動行のうち高々 2 行しか再評価しないこと", async () => {
    let evals = 0;
    const { host, write, selected, texts } = await mount(
      {
        items: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
        selectedIndex: null,
        get "items.*.selected"(this: any) { evals++; return this.$eqIndex("selectedIndex"); },
      },
      ROWS,
    );
    expect(evals).toBe(4);
    await write((s) => { s.selectedIndex = 1; });
    expect(selected()).toEqual(["b"]);
    expect(evals).toBe(5);

    // 行 a を削除: b は index 1 → 0（選択が外れる）、c は 2 → 1（選択される）、d は 3 → 2（値は変わらない）
    const before = evals;
    await write((s) => { s.items = s.items.slice(1); });
    expect(texts()).toEqual(["b", "c", "d"]);
    expect(selected()).toEqual(["c"]);
    expect(evals - before).toBe(2);

    // 続く選択変更も旧行・新行だけ
    await write((s) => { s.selectedIndex = 2; });
    expect(selected()).toEqual(["d"]);
    expect(evals - before).toBe(4);
    host.remove();
  });

  it("交換で移動した行の鍵が付いて行くこと", async () => {
    let evals = 0;
    const { host, write, selected, texts } = await mount(
      {
        items: [{ id: "a" }, { id: "b" }, { id: "c" }],
        selectedIndex: 0,
        get "items.*.selected"(this: any) { evals++; return this.$eqIndex("selectedIndex"); },
      },
      ROWS,
    );
    expect(selected()).toEqual(["a"]);
    const before = evals;
    await write((s) => { const next = [...s.items]; [next[0], next[2]] = [next[2], next[0]]; s.items = next; });
    expect(texts()).toEqual(["c", "b", "a"]);
    // index 0 に来た c が選択され、index 2 へ去った a は外れる
    expect(selected()).toEqual(["c"]);
    expect(evals - before).toBe(2);
    host.remove();
  });

  it("入れ子リストでは level で段を選び、内側の行の削除で購読が落ちること", async () => {
    let evals = 0;
    const { host, write, selected, stateElement } = await mount(
      {
        groups: [{ items: [{ id: "a" }, { id: "b" }] }, { items: [{ id: "c" }, { id: "d" }] }],
        selectedGroup: 1,
        get "groups.*.items.*.selected"(this: any) { evals++; return this.$eqIndex("selectedGroup", 1); },
      },
      `<template data-wcs="for: groups"><ul><template data-wcs="for: .items"><li data-wcs="class.sel: .selected; textContent: .id"></li></template></ul></template>`,
    );
    expect(evals).toBe(4);
    expect(selected()).toEqual(["c", "d"]);
    expect(countKeyedSubscriptions(stateElement, "selectedGroup")).toBe(4);
    // 内側の行 d を削除: 行の購読だけが落ち、段 1 の付け替え台帳からも消える
    await write((s) => { s["groups.1.items"] = s["groups.1.items"].slice(0, 1); });
    expect(countKeyedSubscriptions(stateElement, "selectedGroup")).toBe(3);
    expect(selected()).toEqual(["c"]);
    // 外側のグループを入れ替える: 段 1 の index が動き、内側の行の鍵が付け替わる
    await write((s) => { s.groups = [...s.groups].reverse(); });
    expect(selected()).toEqual(["a", "b"]);
    host.remove();
  });

  it("行の外の getter や存在しない段では明示エラーになること", async () => {
    const { host, read } = await mount(
      {
        items: [{ id: "a" }],
        x: 0,
        get "items.*.deep"(this: any) { return this.$eqIndex("x", 2); },
        get top(this: any) { return this.$eqIndex("x"); },
      },
      // 行を描画して listIndex を作っておく（`items.0.deep` の解決に要る）。deep 自体は束縛しない
      `<ul><template data-wcs="for: items"><li>{{ .id }}</li></template></ul>`,
    );
    expect(() => read((s) => s.top)).toThrow(/needs a list row scope/);
    expect(() => read((s) => s["items.0.deep"])).toThrow(/no list index at that level/);
    host.remove();
  });
});

describe("$eqIndex の最内段: リスト単位の監視", () => {
  it("範囲外・非数値の書き込み、選択行自身の削除、末尾の削除、同一内容の再代入を扱うこと", async () => {
    let evals = 0;
    const { host, write, selected, texts, stateElement } = await mount(
      {
        items: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
        selectedIndex: null,
        get "items.*.selected"(this: any) { evals++; return this.$eqIndex("selectedIndex"); },
      },
      ROWS,
    );
    expect(countKeyedSubscriptions(stateElement, "selectedIndex")).toBe(0); // 行ごとの購読は持たない
    // 選択が無いまま削除しても何も enqueue しない
    let before = evals;
    await write((s) => { s.items = s.items.slice(0, 3); });
    expect(texts()).toEqual(["a", "b", "c"]);
    expect(evals).toBe(before);
    // 範囲外の index と非数値は該当行なし
    await write((s) => { s.selectedIndex = 99; });
    await write((s) => { s.selectedIndex = "b" as any; });
    expect(selected()).toEqual([]);
    expect(evals).toBe(before);
    await write((s) => { s.selectedIndex = 1; });
    expect(selected()).toEqual(["b"]);
    expect(evals).toBe(before + 1);
    // 末尾の削除: 選択行の位置は変わらないので再評価なし
    before = evals;
    await write((s) => { s.items = s.items.slice(0, 2); });
    expect(texts()).toEqual(["a", "b"]);
    expect(selected()).toEqual(["b"]);
    expect(evals).toBe(before);
    // 同じ内容の再代入: 差分に変化が無く監視も動かない
    await write((s) => { s.items = [...s.items]; });
    expect(selected()).toEqual(["b"]);
    // 選択行自身を削除: 退役した行は飛ばし、その位置に来た行だけを再評価する
    await write((s) => { s.items = [s.items[0], { id: "e" }, { id: "f" }]; });
    expect(texts()).toEqual(["a", "e", "f"]);
    expect(selected()).toEqual(["e"]);
    // 選択が範囲外になる縮小
    await write((s) => { s.items = s.items.slice(0, 1); });
    expect(selected()).toEqual([]);
    host.remove();
  });

  it("別のリストへ代入すると監視が移り、同じ配列を見る監視は合流すること", async () => {
    const { host, write, shadowRoot } = await mount(
      {
        items: [{ id: "a" }, { id: "b" }],
        others: [{ id: "c" }, { id: "d" }],
        selectedIndex: 1,
        get "items.*.selected"(this: any) { return this.$eqIndex("selectedIndex"); },
        get "others.*.selected"(this: any) { return this.$eqIndex("selectedIndex"); },
      },
      `<ul><template data-wcs="for: items"><li data-wcs="class.sel: .selected; textContent: .id"></li></template></ul>
       <ol><template data-wcs="for: others"><li data-wcs="class.sel: .selected; textContent: .id"></li></template></ol>`,
    );
    const sel = (scope: string) => Array.from(shadowRoot.querySelectorAll(`${scope} li`)).filter((li) => li.classList.contains("sel")).map((li) => li.textContent);
    expect(sel("ul")).toEqual(["b"]);
    expect(sel("ol")).toEqual(["d"]);
    // items に others の配列を代入: items の監視が others の listIndex 配列へ移り、既存の監視と合流する
    await write((s) => { s.items = s.others; });
    expect(Array.from(shadowRoot.querySelectorAll("ul li")).map((li) => li.textContent)).toEqual(["c", "d"]);
    expect(sel("ul")).toEqual(["d"]);
    await write((s) => { s.selectedIndex = 0; });
    expect(sel("ul")).toEqual(["c"]);
    expect(sel("ol")).toEqual(["c"]);
    host.remove();
  });
});

describe("SSR ハイドレーション経路", () => {
  const MARKUP =
    `<wcs-state enable-ssr></wcs-state>` +
    `<ul><template data-wcs="for: items"><li data-wcs="class.sel: .selected; textContent: .id"></li></template></ul>`;
  const make = () => ({
    items: [{ id: "a" }, { id: "b" }, { id: "c" }],
    selectedId: "b",
    get "items.*.selected"(this: any) { return this.$eqPath("selectedId", "items.*.id"); },
  });
  const selectedIds = () => Array.from(document.querySelectorAll("li")).filter((li) => li.classList.contains("sel")).map((li) => li.textContent);

  it("ハイドレーション後の行 getter が購読を張り直し、選択の書き込みに追従すること", async () => {
    document.body.innerHTML = "";
    // サーバー側描画
    document.documentElement.setAttribute("data-wcs-server", "");
    document.body.innerHTML = MARKUP;
    let el = document.querySelector("wcs-state") as State;
    el.setInitialState(make());
    await el.connectedCallbackPromise;
    await State.getBindingsReady(document);
    await flush();
    buildSsrDocument(document);
    const html = document.body.innerHTML;
    document.documentElement.removeAttribute("data-wcs-server");
    expect(selectedIds()).toEqual(["b"]);

    // クライアント側ハイドレーション
    document.body.innerHTML = html;
    el = document.querySelector("wcs-state") as State;
    el.setInitialState(make());
    await el.connectedCallbackPromise;
    await State.getBindingsReady(document);
    await flush();
    const stateElement = getStateElement(document)!;
    expect(selectedIds()).toEqual(["b"]);
    expect(countKeyedSubscriptions(stateElement, "selectedId")).toBe(3);

    stateElement.createState("writable", (s: any) => { s.selectedId = "c"; });
    await flush();
    expect(selectedIds()).toEqual(["c"]);
    document.body.innerHTML = "";
  });
});

describe("keyedDependency の直接呼び出し", () => {
  it("未登録の state / listIndex に対しては何もしないこと", () => {
    const fakeElement = {} as any;
    expect(keyedDependents(fakeElement, "nowhere", true, 1, 2)).toEqual([]);
    const listIndex = createListIndex(null, 0, null);
    expect(() => dropKeyedSubscriptionsByListIndex(listIndex)).not.toThrow();
    expect(() => rekeyIndexSubscriptions(listIndex, 0, 1)).not.toThrow();
  });
});
