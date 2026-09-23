/**
 * 鍵付き購読（`$eq` / `$eqPath` / `$eqIndex` — 3.0）の**派生先**への伝播。
 *
 * 通常の書き込みは `setByAddress` の `notifyWrite` が、書いたアドレスを enqueue したうえで
 * `walkDependency` で依存先まで辿る。鍵付き購読の通知（`notifyKeyed` → `createKeyedEnqueue`）は
 * かつて**購読者のアドレスを enqueue するだけ**で、そこから先の依存を辿らなかった。結果、
 * 「鍵付き getter に依存する別の getter」は書き込み後も古い値のまま残っていた
 * （3.0 の穴。マウント／ボリュームに固有ではなく、下の「素のツリー」の 2 件が証人 —
 * マウントは 1 つも無い）。マウントの公開 getter（`webComponent/exportIndex.ts` が張る
 * 別名の辺 `…#m1.k → ….k`）も**動的依存の辺**なので、同じ理由で外側が陳腐化していた。
 *
 * 直ったので、このファイルは**修正後の正しい挙動を固定する回帰テスト**になっている。
 * 収集（書き込み前）とウォーク（書き込み後）を分ける必要があるため、直し方には順序の制約がある —
 * 経緯と設計は docs/state-keyed-derived-propagation.md。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElement } from "../src/stateElementByName";
import { collectKeyedSubscriptions } from "../src/devtools/keyedSubscriptions";

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));
let counter = 0;

async function mountTree(body: string, state: Record<string, any>) {
  const host = document.createElement(`kd-host-${++counter}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `<wcs-state></wcs-state>${body}`;
  document.body.appendChild(host);
  const element = shadowRoot.querySelector("wcs-state") as State;
  element.setInitialState(state);
  await element.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  await flush();
  await flush();
  const write = async (fn: (s: any) => void): Promise<void> => {
    element.createState("writable", fn);
    await flush();
    await flush();
  };
  const all = (selector: string): (string | null)[] =>
    Array.from(shadowRoot.querySelectorAll(selector)).map((e) => e.textContent);
  return { host, shadowRoot, write, all };
}

const ROW_TEMPLATE =
  `<ul><template data-wcs="for: items"><li>` +
  `<span class="direct" data-wcs="textContent: items.*.picked"></span>` +
  `<span class="derived" data-wcs="textContent: items.*.label"></span>` +
  `</li></template></ul>`;

describe("鍵付き購読の派生先への伝播（素のツリー・マウント無し）", () => {
  it("対照: 鍵を使わない普通の追跡読みなら、派生 getter も追随すること", async () => {
    const { host, write, all } = await mountTree(ROW_TEMPLATE, {
      sel: 1,
      items: [{ id: 0 }, { id: 1 }],
      get "items.*.picked"(this: any) { return this.sel === this["items.*.id"] ? "Y" : "N"; },
      get "items.*.label"(this: any) { return `<${this["items.*.picked"]}>`; },
    });
    expect(all(".direct")).toEqual(["N", "Y"]);
    expect(all(".derived")).toEqual(["<N>", "<Y>"]);
    await write((s) => { s.sel = 0; });
    expect(all(".direct")).toEqual(["Y", "N"]);
    // 依存グラフ（walkDependency）を通るので派生先も更新される
    expect(all(".derived")).toEqual(["<Y>", "<N>"]);
    host.remove();
  });

  it("$eq で選んでも、購読者自身と派生 getter の両方が更新されること", async () => {
    const { host, write, all } = await mountTree(ROW_TEMPLATE, {
      sel: 1,
      items: [{ id: 0 }, { id: 1 }],
      get "items.*.picked"(this: any) { return this.$eq("sel", this["items.*.id"]) ? "Y" : "N"; },
      get "items.*.label"(this: any) { return `<${this["items.*.picked"]}>`; },
    });
    expect(all(".direct")).toEqual(["N", "Y"]);
    expect(all(".derived")).toEqual(["<N>", "<Y>"]);
    await write((s) => { s.sel = 0; });
    // 鍵付き購読の通知が購読者のアドレスを enqueue する（従来どおり）
    expect(all(".direct")).toEqual(["Y", "N"]);
    // そこから先の依存（`items.*.picked` → `items.*.label`）も、書き込み後の
    // `walkKeyedDependents` が辿る。上の対照（非鍵）と同じ結果になること
    expect(all(".derived")).toEqual(["<Y>", "<N>"]);
    host.remove();
  });
});

describe("鍵付き購読とマウントの公開 getter（同じ穴の別の顔）", () => {
  function defineRowComponent(tag: string, state: () => Record<string, any>): void {
    class Comp extends HTMLElement {
      state: Record<string, any> = state();
      constructor() { super(); this.attachShadow({ mode: "open" }); }
      connectedCallback() {
        if (this.shadowRoot!.childNodes.length === 0) {
          this.shadowRoot!.innerHTML =
            `<wcs-state bind-component="state"></wcs-state><span data-wcs="textContent: active"></span>`;
        }
      }
    }
    customElements.define(tag, Comp);
  }

  it("対照: 鍵を使わない公開 getter なら、外側のバインドも追随すること", async () => {
    const tag = `kd-plain-${++counter}`;
    defineRowComponent(tag, () => ({
      get active(this: any) { return `S${this.sel}`; },
    }));
    const { host, write, all } = await mountTree(
      `<ul><template data-wcs="for: items"><li><${tag} data-wcs="state: .; state.sel: cursor"></${tag}>` +
      `<span class="outer" data-wcs="textContent: .active"></span></li></template></ul>`,
      { cursor: 2, items: [{ id: 0 }, { id: 1 }] },
    );
    const comps = Array.from(host.shadowRoot!.querySelectorAll(tag)) as HTMLElement[];
    for (const c of comps) {
      await (c.shadowRoot!.querySelector("wcs-state") as State).connectedCallbackPromise;
    }
    await State.getBindingsReady(host.shadowRoot!);
    await flush(); await flush();
    expect(all(".outer")).toEqual(["S2", "S2"]);
    await write((s) => { s.cursor = 9; });
    expect(all(".outer")).toEqual(["S9", "S9"]);
    host.remove();
  });

  it("$eqIndex の公開 getter は、コンポーネント内も外側のバインドも更新されること", async () => {
    const tag = `kd-keyed-${++counter}`;
    defineRowComponent(tag, () => ({
      get active(this: any) { return this.$eqIndex("sel") ? "on" : "off"; },
    }));
    const { host, write, all } = await mountTree(
      `<ul><template data-wcs="for: items"><li><${tag} data-wcs="state: .; state.sel: cursor"></${tag}>` +
      `<span class="outer" data-wcs="textContent: .active"></span></li></template></ul>`,
      { cursor: 1, items: [{ id: 0 }, { id: 1 }] },
    );
    const comps = Array.from(host.shadowRoot!.querySelectorAll(tag)) as HTMLElement[];
    for (const c of comps) {
      await (c.shadowRoot!.querySelector("wcs-state") as State).connectedCallbackPromise;
    }
    await State.getBindingsReady(host.shadowRoot!);
    await flush(); await flush();
    const inners = (): (string | null)[] => comps.map((c) => c.shadowRoot!.querySelector("span")!.textContent);
    expect(inners()).toEqual(["off", "on"]);
    expect(all(".outer")).toEqual(["off", "on"]);

    await write((s) => { s.cursor = 0; });
    // 内側（マーカーパスへの直接の購読）は更新される
    expect(inners()).toEqual(["on", "off"]);
    // 公開の別名辺（`…#m.active` → `items.*.active`）は動的依存の辺。購読者から
    // `walkKeyedDependents` が辿るので、外側も内側と同じ値になる
    expect(all(".outer")).toEqual(["on", "off"]);
    host.remove();
  });
});

describe("鍵付き購読の派生先: $postUpdate 経由と、伝播の範囲", () => {
  it("`$postUpdate` の in-place 変異でも派生 getter が追随すること", async () => {
    const raw: Record<string, any> = {
      sel: 1,
      items: [{ id: 0 }, { id: 1 }],
      get "items.*.picked"(this: any) { return this.$eq("sel", this["items.*.id"]) ? "Y" : "N"; },
      get "items.*.label"(this: any) { return `<${this["items.*.picked"]}>`; },
    };
    const { host, write, all } = await mountTree(ROW_TEMPLATE, raw);
    expect(all(".direct")).toEqual(["N", "Y"]);
    expect(all(".derived")).toEqual(["<N>", "<Y>"]);

    // set トラップを通らない変異 → 正規の idiom で通知する
    raw.sel = 0;
    await write((s) => { s.$postUpdate("sel"); });
    expect(all(".direct")).toEqual(["Y", "N"]);
    expect(all(".derived")).toEqual(["<Y>", "<N>"]);
    host.remove();
  });

  /**
   * 鍵付き選択の存在理由は「選択の更新を**関係する行だけ**に抑える」こと。派生先を辿るように
   * しても、その範囲が全行へ広がっていないことを評価回数で固定する（広がると鍵付きの利点が消える）。
   */
  it("派生先を辿っても、再評価は選択が入れ替わる 2 行に留まること", async () => {
    let pickedEvals = 0;
    let labelEvals = 0;
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: i }));
    const { host, write, all } = await mountTree(ROW_TEMPLATE, {
      sel: 1,
      items: rows,
      get "items.*.picked"(this: any) { pickedEvals++; return this.$eq("sel", this["items.*.id"]) ? "Y" : "N"; },
      get "items.*.label"(this: any) { labelEvals++; return `<${this["items.*.picked"]}>`; },
    });
    expect(all(".direct")[1]).toBe("Y");
    pickedEvals = 0;
    labelEvals = 0;

    await write((s) => { s.sel = 0; });
    expect(all(".direct").slice(0, 2)).toEqual(["Y", "N"]);
    expect(all(".derived").slice(0, 2)).toEqual(["<Y>", "<N>"]);
    // 20 行あっても、外れる行と入る行の 2 行だけ（キャッシュ 1 回 + 適用 1 回で 2 評価/行が上限）
    expect(pickedEvals).toBeLessThanOrEqual(4);
    expect(labelEvals).toBeLessThanOrEqual(4);
    host.remove();
  });
});

/**
 * 収集（書き込み前）とウォーク（書き込み後）を分ける必要があることの番人。
 *
 * 鍵付き購読の**購読者そのものがリスト**のとき、そこからの静的子展開（`filtered` → `filtered.*`）は
 * リストの実体を proxy で読む。`notifyKeyed` は旧値の鍵を引くために `Reflect.set` の**前**に走るので、
 * そこでウォークまで済ませると**書き込み前の配列**で展開してしまい、行が入れ替わらない。
 */
describe("鍵付き購読の購読者がリストのとき（順序の番人）", () => {
  it("鍵で切り替わるリスト getter の行が、書き込み後の配列で張り替わること", async () => {
    const { host, write } = await mountTree(
      `<ul><template data-wcs="for: filtered"><li data-wcs="textContent: filtered.*.name"></li></template></ul>`,
      {
        sel: 1,
        a: [{ name: "a1" }, { name: "a2" }],
        b: [{ name: "b1" }],
        get filtered(this: any) { return this.$eq("sel", 1) ? this.a : this.b; },
      },
    );
    const rows = (): (string | null)[] =>
      Array.from(host.shadowRoot!.querySelectorAll("li")).map((e) => e.textContent);
    expect(rows()).toEqual(["a1", "a2"]);
    await write((s) => { s.sel = 2; });
    // 書き込み**前**にウォークすると、`filtered` は旧 `sel` で評価された配列のまま展開され
    // `["a1","a2"]` が残る
    expect(rows()).toEqual(["b1"]);
    await write((s) => { s.sel = 1; });
    expect(rows()).toEqual(["a1", "a2"]);
    host.remove();
  });
});

/**
 * **リスト差分が駆動する鍵付き通知**（`dependency/keyedDependency.ts` の `moveIndexWatchers` と
 * `rekeyIndexSubscriptions`）も派生先へ届くこと。
 *
 * `d76ae9ca` の修正は `setByAddress` の `notifyKeyed` / `notifyKeyedPostUpdate` の 2 箇所だけで、
 * この 2 経路は購読者を enqueue するだけだった。差分側は `createListDiff` から呼ばれて state proxy を
 * 持たないので、**積むだけにして proxy を持つ地点（`walkDependency` の末尾 / `applyChangeToFor`）が
 * 引き取る**形で塞いだ（docs/state-keyed-derived-propagation.md）。
 */
describe("リスト差分が駆動する鍵付き通知も派生先へ届くこと", () => {
  it("対照: 非鍵（`$1 === this.sel`）なら、行削除でも派生 getter が追随すること", async () => {
    const { host, write, all } = await mountTree(ROW_TEMPLATE, {
      sel: 1,
      items: [{ n: "a" }, { n: "b" }, { n: "c" }],
      get "items.*.picked"(this: any) { return this.$1 === this.sel ? "Y" : "N"; },
      get "items.*.label"(this: any) { return `<${this["items.*.picked"]}>`; },
    });
    expect(all(".direct")).toEqual(["N", "Y", "N"]);
    await write((s) => { s.items = s.items.slice(1); });
    expect(all(".direct")).toEqual(["N", "Y"]);
    expect(all(".derived")).toEqual(["<N>", "<Y>"]);
    host.remove();
  });

  it("`$eqIndex`（最内段・moveIndexWatchers）でも、行削除で派生 getter が追随すること", async () => {
    const { host, write, all } = await mountTree(ROW_TEMPLATE, {
      sel: 1,
      items: [{ n: "a" }, { n: "b" }, { n: "c" }],
      get "items.*.picked"(this: any) { return this.$eqIndex("sel") ? "Y" : "N"; },
      get "items.*.label"(this: any) { return `<${this["items.*.picked"]}>`; },
    });
    expect(all(".direct")).toEqual(["N", "Y", "N"]);
    expect(all(".derived")).toEqual(["<N>", "<Y>", "<N>"]);
    await write((s) => { s.items = s.items.slice(1); });
    // 購読者自身も、そこから派生した getter も、差分後のインデックスで再評価される
    expect(all(".direct")).toEqual(["N", "Y"]);
    expect(all(".derived")).toEqual(["<N>", "<Y>"]);
    host.remove();
  });

  it("`$eqIndex`（外段・rekeyIndexSubscriptions）でも、親行削除で派生 getter が追随すること", async () => {
    // `groups.*.rows.*` の level 1 は最内段ではないので、行ごとの index-keyed 購読になり
    // 親リストの差分では `rekeyIndexSubscriptions` が張り替える（最内段の watcher とは別の経路）。
    const { host, write, all } = await mountTree(
      `<ul><template data-wcs="for: groups"><li><ul>` +
      `<template data-wcs="for: groups.*.rows"><li>` +
      `<span class="direct" data-wcs="textContent: groups.*.rows.*.picked"></span>` +
      `<span class="derived" data-wcs="textContent: groups.*.rows.*.label"></span>` +
      `</li></template></ul></li></template></ul>`,
      {
        sel: 1,
        groups: [{ rows: [{}] }, { rows: [{}] }, { rows: [{}] }],
        get "groups.*.rows.*.picked"(this: any) { return this.$eqIndex("sel", 1) ? "Y" : "N"; },
        get "groups.*.rows.*.label"(this: any) { return `<${this["groups.*.rows.*.picked"]}>`; },
      },
    );
    expect(all(".direct")).toEqual(["N", "Y", "N"]);
    expect(all(".derived")).toEqual(["<N>", "<Y>", "<N>"]);
    await write((s) => { s.groups = s.groups.slice(1); });
    expect(all(".direct")).toEqual(["N", "Y"]);
    expect(all(".derived")).toEqual(["<N>", "<Y>"]);
    host.remove();
  });
});

/**
 * 入れ子リストの**親行**が退役したとき、子行の鍵付き購読も台帳から落ちること。
 *
 * `dropKeyedSubscriptionsByListIndex` はそのリスト自身の `deleteIndexSet` にしか呼ばれず、
 * `IListIndex` は `parentListIndex`（上向き）しか持たないので、かつては親から子孫へ辿れず
 * 購読が残り続けていた。描画は正しかった（updater が dead アドレスを弾く）が、(a) dead な
 * `IListIndex` / `IAbsoluteStateAddress` を強参照で保持するリークであり、(b) D17 の pull API が
 * 「4 行のページで rows=20」という嘘を返していた（この機能の存在理由に対して最悪の失敗様式）。
 *
 * 登録時に祖先の listIndex 側へ逆引き（`descendantRowsByAncestor`）を積んで解決した。
 */
describe("入れ子リストの親行退役で、子行の鍵付き購読も落ちること", () => {
  it("描画行が 4 のまま groups を差し替えても、台帳の rows が増えないこと", async () => {
    const makeGroups = () => Array.from({ length: 2 }, (_, gi) => ({ id: gi, rows: [{ id: 0 }, { id: 1 }] }));
    const { host, write, shadowRoot } = await mountTree(
      `<ul><template data-wcs="for: groups"><li><ul>` +
      `<template data-wcs="for: groups.*.rows"><li class="row" data-wcs="class.on: groups.*.rows.*.hit"></li></template>` +
      `</ul></li></template></ul>`,
      {
        sel: 0,
        groups: makeGroups(),
        get "groups.*.rows.*.hit"(this: any) { return this.$eq("sel", this["groups.*.rows.*.id"]); },
      },
    );
    const rendered = () => shadowRoot.querySelectorAll("li.row").length;
    const rows = () => (collectKeyedSubscriptions(getStateElement(shadowRoot)!)
      .find((e) => e.path === "sel")?.rows ?? 0);
    expect(rendered()).toBe(4);
    expect(rows()).toBe(4);

    for (let i = 1; i <= 3; i++) {
      await write((s) => { s.groups = makeGroups(); });
      expect(rendered()).toBe(4);
      // 親行が退役するたび、その配下の子行の購読も落ちる（描画と台帳が一致する）
      expect(rows(), `swap ${i}`).toBe(4);
    }
    await write((s) => { s.groups = []; });
    expect(rendered()).toBe(0);
    expect(rows()).toBe(0);
    host.remove();
  });
});

/**
 * `$eqIndex` の最内段はリスト（listIndex 配列）単位の**監視**を置く（`registerIndexWatcher`）。
 * 入れ子リストでは親行が退役しても配列ごと捨てられるだけで差分が来ないので、
 * `watchersByElement` に死んだ監視が積み上がっていた（D17 の `lists` が単調増加）。
 * 監視を「そのリストを抱える親行」に紐づけて、親の退役で一緒に落とす。
 */
describe("入れ子リストの親行退役で、$eqIndex の監視も落ちること", () => {
  it("描画行が 4 のまま groups を差し替えても、台帳の lists が増えないこと", async () => {
    const makeGroups = () => Array.from({ length: 2 }, (_, gi) => ({ id: gi, rows: [{ id: 0 }, { id: 1 }] }));
    const { host, write, shadowRoot } = await mountTree(
      `<ul><template data-wcs="for: groups"><li><ul>` +
      `<template data-wcs="for: groups.*.rows"><li class="row" data-wcs="class.on: groups.*.rows.*.hit"></li></template>` +
      `</ul></li></template></ul>`,
      {
        sel: 0,
        groups: makeGroups(),
        get "groups.*.rows.*.hit"(this: any) { return this.$eqIndex("sel", 2); },
      },
    );
    const rendered = () => shadowRoot.querySelectorAll("li.row").length;
    const entry = () => collectKeyedSubscriptions(getStateElement(shadowRoot)!).find((e) => e.path === "sel");
    expect(rendered()).toBe(4);
    const baseline = entry()!.lists;
    expect(baseline).toBeGreaterThan(0);

    for (let i = 1; i <= 3; i++) {
      await write((s) => { s.groups = makeGroups(); });
      expect(rendered()).toBe(4);
      expect(entry()!.lists, `swap ${i}`).toBe(baseline);
    }
    await write((s) => { s.groups = []; });
    expect(rendered()).toBe(0);
    expect(entry()?.lists ?? 0).toBe(0);
    host.remove();
  });

  /**
   * 同じ入れ子リストに `$eqIndex` の監視が **2 つ**（別々の鍵）ぶら下がり、かつ親が生きたまま
   * 子行だけが消える形。ここだけが通る分岐が 3 つある:
   * - `registerIndexWatcher`: 同じ親行に 2 つ目の監視を足す（持ち主の集合が既にある）
   * - `unlinkAncestors`: 行を外しても祖先の集合が空にならない（兄弟が残っている）
   * - `dropWatchersOwnedBy`: 1 つ目を外してもリストの監視配列／パスの集合が空にならない
   */
  it("同じリストに鍵違いの監視が 2 つあっても、子行・親行の退役で過不足なく落ちること", async () => {
    const { host, write, shadowRoot, all } = await mountTree(
      `<ul><template data-wcs="for: groups"><li><ul>` +
      `<template data-wcs="for: groups.*.rows"><li>` +
      `<span class="a" data-wcs="textContent: groups.*.rows.*.a"></span>` +
      `<span class="b" data-wcs="textContent: groups.*.rows.*.b"></span>` +
      `</li></template></ul></li></template></ul>`,
      {
        selA: 0,
        selB: 2,
        groups: [{ rows: [{}, {}, {}] }, { rows: [{}, {}, {}] }],
        get "groups.*.rows.*.a"(this: any) { return this.$eqIndex("selA", 2) ? "A" : "-"; },
        get "groups.*.rows.*.b"(this: any) { return this.$eqIndex("selB", 2) ? "B" : "-"; },
      },
    );
    const counts = () => {
      const summaries = collectKeyedSubscriptions(getStateElement(shadowRoot)!);
      return {
        a: summaries.find((e) => e.path === "selA")?.lists ?? 0,
        b: summaries.find((e) => e.path === "selB")?.lists ?? 0,
      };
    };
    expect(all(".a")).toEqual(["A", "-", "-", "A", "-", "-"]);
    expect(all(".b")).toEqual(["-", "-", "B", "-", "-", "B"]);
    const baseline = counts();
    expect(baseline.a).toBeGreaterThan(0);
    expect(baseline.b).toBe(baseline.a);

    // 親は生きたまま、子行だけ 1 行消す（兄弟が残るので祖先の逆引きは空にならない）。
    // 親オブジェクトの同一性は保つので `groups` 側に差分は出ず、`rows` 側だけが 1 行減る
    await write((s) => {
      const groups = s.groups;
      groups[0].rows = groups[0].rows.slice(1);
      s.groups = [...groups];
    });
    expect(all(".a")).toEqual(["A", "-", "A", "-", "-"]);
    expect(all(".b")).toEqual(["-", "-", "-", "-", "B"]);
    expect(counts()).toEqual(baseline);

    // 親は生きたまま、子行を**全部**消す（祖先の逆引きが空になって外れる経路）
    await write((s) => {
      const groups = s.groups;
      groups[0].rows = [];
      s.groups = [...groups];
    });
    expect(all(".a")).toEqual(["A", "-", "-"]);
    expect(counts()).toEqual(baseline);

    // 親行を 1 つ落とす: そのリストの監視 2 つが一緒に落ちる
    await write((s) => { s.groups = s.groups.slice(1); });
    expect(all(".a")).toEqual(["A", "-", "-"]);
    expect(counts()).toEqual({ a: baseline.a - 1, b: baseline.b - 1 });

    await write((s) => { s.groups = []; });
    expect(all(".a")).toEqual([]);
    expect(counts()).toEqual({ a: 0, b: 0 });
    host.remove();
  });
});
