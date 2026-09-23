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
  return { host, write, all };
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
