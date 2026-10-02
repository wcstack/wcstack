/**
 * integration.elementWriteCachedChildren.test.ts — 要素の書き込み・`$postUpdate` が、キャッシュに載った
 * 子のパス（`items.0.name`）とそれを読む getter に届く（#364）。
 *
 * 旧挙動: 行の中で子を描く `for` が無いと（`for` があっても行の中で `.name` を描いていないと）、
 * - 形 A: 同じオブジェクトをその場で書き換えて知らせる（`it.name = "z"; this["items.0"] = it` /
 *   `$postUpdate("items.0")` / `$postUpdate("items")`）の後も、`this["items.0.name"]` と表示・getter が
 *   古い値を返した。
 * - 形 B: 新しいオブジェクトに差し替える（`this["items.0"] = { name: "z" }`）と、直接の読みは新しくなるが、
 *   同じリストを `$getAll` で集める getter が先に評価されていると、`this["items.0.name"]` を読む getter が
 *   古い値のまま残った（行マウントのコンポーネントの getter でも同じ）。
 *
 * 原因: ワイルドカードを含むパスは行ごとにキャッシュされる（isCacheable）が、要素パス（`items.*`）から
 * 子のパス（`items.*.name`）への静的な辺はバインドが張るので、行の中で子を描いていないと無かった。
 * 形 A はキャッシュに、形 B は getter の依存（`$getAll` が行 0 を先にキャッシュすると、`first` の依存は
 * 子のパスにだけ付く）に、要素の書き込みの依存ウォークが届かなかった。
 *
 * いまはキャッシュに載せるときに、そのパスを要素パスからの静的な辺に載せる
 * （src/cache/cacheEntryByAbsoluteStateAddress.ts）。listPaths に無い（`for` で描いていない）リストの
 * 行への辺は、据え置いた行の中身が変わりうるとき（`$postUpdate`・変化の見えない再代入）だけ行ごとに
 * 展開する（src/dependency/walkDependency.ts の _collectDependencies）。変化の見える代入では差分も取らない。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getListIndexesByList } from "../src/list/listIndexesByList";
import { flush, makeMount, read, write } from "./helpers/recursionTestUtils";

beforeAll(() => {
  bootstrapState();
});

const mount = makeMount("element-write-cached-children");

const txt = (root: ShadowRoot, selector: string) =>
  Array.from(root.querySelectorAll(selector)).map((n) => n.textContent);
const raw = (stateEl: any) => stateEl._state;
const flushTimes = async (n = 3) => {
  for (let i = 0; i < n; i++) await flush();
};

/** 行の中を何も描かない for（Issue の「同じ結果になる形」）と、行の中で .name を描く for（対照） */
const VARIANTS: [string, string][] = [
  ["for で描かない", ""],
  ["行の中で .name を描かない for", `<ul><template data-wcs="for: items"><li>row</li></template></ul>`],
  ["対照: 行の中で .name を描く for", `<ul><template data-wcs="for: items"><li>{{ .name }}</li></template></ul>`],
];

// ---------------------------------------------------------------------------
// 形 A: 同じオブジェクトをその場で書き換えて知らせる
// ---------------------------------------------------------------------------

describe("形 A: 同じオブジェクトをその場で書き換えて知らせる", () => {
  const NOTIFY: [string, (s: any) => void][] = [
    ["同じオブジェクトの再代入", (s) => { const it = s["items.0"]; it.name = "z"; s["items.0"] = it; }],
    ["$postUpdate(\"items.0\")", (s) => { s["items.0"].name = "z"; s.$postUpdate("items.0"); }],
    ["$postUpdate(\"items\")", (s) => { s["items.0"].name = "z"; s.$postUpdate("items"); }],
    ["$resolve(\"items.*\", [0], it)", (s) => { const it = s["items.0"]; it.name = "z"; s.$resolve("items.*", [0], it); }],
  ];

  for (const [variant, extra] of VARIANTS) {
    it.each(NOTIFY)(`%s の後、添字の読み・表示・getter・$getAll が新しい値になる（${variant}）`, async (_label, notify) => {
      const { host, stateEl, shadowRoot } = await mount({
        items: [{ name: "a" }, { name: "b" }],
        get first() { return (this as any)["items.0.name"]; },
        get all() { return (this as any).$getAll("items.*.name", []).join(","); },
      }, `<p class="p">{{ items.0.name }}</p><b class="f">{{ first }}</b><i class="a">{{ all }}</i>` + extra);
      const shown = () => [...txt(shadowRoot, ".p"), ...txt(shadowRoot, ".f"), ...txt(shadowRoot, ".a")];
      expect(shown()).toEqual(["a", "a", "a,b"]);

      write(stateEl, notify);
      await flushTimes();
      expect(raw(stateEl).items[0].name).toBe("z");
      expect(read(stateEl, (s) => s["items.0.name"])).toBe("z"); // 旧（対照以外）: "a"
      expect(shown()).toEqual(["z", "z", "z,b"]); // 旧（対照以外）: ["a", "a", "a,b"]
      host.remove();
    });
  }

  it("対照: リストでないオブジェクトは、同じ知らせ方で前から新しい値になる", async () => {
    const { host, stateEl, shadowRoot } = await mount({ user: { name: "a" } }, `<p class="p">{{ user.name }}</p>`);
    write(stateEl, (s) => { const u = s.user; u.name = "z"; s.user = u; });
    await flushTimes();
    expect(txt(shadowRoot, ".p")).toEqual(["z"]);
    write(stateEl, (s) => { s.user.name = "y"; s.$postUpdate("user"); });
    await flushTimes();
    expect(txt(shadowRoot, ".p")).toEqual(["y"]);
    host.remove();
  });

  it("葉を書いてキャッシュに載せた子のパスにも、その後の同じオブジェクトの再代入が届く", async () => {
    const { host, stateEl } = await mount({ items: [{ name: "a" }, { name: "b" }] });
    // 読む前に書く — 値は書き込みがキャッシュに載せる（読みのキャッシュ漏れを経ない）
    write(stateEl, (s) => { s["items.0.name"] = "q"; });
    write(stateEl, (s) => { const it = s["items.0"]; it.name = "z"; s["items.0"] = it; });
    expect(read(stateEl, (s) => s["items.0.name"])).toBe("z"); // 旧: "q"
    host.remove();
  });

  it("入れ子のリスト: 外側の要素を同じオブジェクトで知らせると、内側の行の値も読み直す", async () => {
    const { host, stateEl } = await mount({ groups: [{ items: [{ v: 1 }, { v: 2 }] }, { items: [{ v: 3 }] }] });
    expect(read(stateEl, (s) => [s.$getAll("groups.*.items.*.v", []), s["groups.0.items.1.v"]])).toEqual([[1, 2, 3], 2]);

    write(stateEl, (s) => { const g = s["groups.0"]; g.items[1].v = 20; s["groups.0"] = g; });
    await flushTimes();
    // 旧: [[1, 2, 3], 2]
    expect(read(stateEl, (s) => [s.$getAll("groups.*.items.*.v", []), s["groups.0.items.1.v"]])).toEqual([[1, 20, 3], 20]);

    // 内側の配列ごと入れ替えても（行の数が変わっても）読み直す
    write(stateEl, (s) => { const g = s["groups.1"]; g.items = [{ v: 30 }, { v: 31 }]; s.$postUpdate("groups.1"); });
    await flushTimes();
    expect(read(stateEl, (s) => s.$getAll("groups.*.items.*.v", []))).toEqual([1, 20, 30, 31]);
    host.remove();
  });

  it("差分の基準が古くても、行のある配列を代入し直すと getter が新しい値を読む（$setAll が作った行・前の配列に戻した行）", async () => {
    // `$setAll` は行を作るが差分の基準を確定しない。前の配列へ戻した代入は、基準（最後に見た配列）と中身が違う。
    // どちらも「基準と同じ要素の並びか」だけで判定すると、読み直させる展開をしなかった
    const { host, stateEl, shadowRoot } = await mount({
      items: [{ name: "a" }, { name: "b" }],
      get first() { return (this as any)["items.0.name"]; },
    }, `<b class="f">{{ first }}</b>`);
    write(stateEl, (s) => { s.$setAll("items.*.name", [], ["x", "y"], { spread: true }); });
    await flushTimes();
    expect(txt(shadowRoot, ".f")).toEqual(["x"]);
    write(stateEl, (s) => { const a = s.items; a[0].name = "m"; s.items = a; });
    await flushTimes();
    expect([txt(shadowRoot, ".f"), read(stateEl, (s) => s["items.0.name"])]).toEqual([["m"], "m"]);
    write(stateEl, (s) => { const a = s.items; a[0].name = "n"; s.items = [...a]; });
    await flushTimes();
    expect([txt(shadowRoot, ".f"), read(stateEl, (s) => s["items.0.name"])]).toEqual([["n"], "n"]);

    const other = [{ name: "c" }, { name: "d" }];
    const back = raw(stateEl).items;
    write(stateEl, (s) => { s.items = other; });
    await flushTimes();
    write(stateEl, (s) => { s.items = back; });
    await flushTimes();
    expect(txt(shadowRoot, ".f")).toEqual(["n"]);
    write(stateEl, (s) => { const a = s.items; a[0].name = "z"; s.items = a; });
    await flushTimes();
    expect([txt(shadowRoot, ".f"), read(stateEl, (s) => s["items.0.name"])]).toEqual([["z"], "z"]);
    host.remove();
  });

  it("描いていないリストのリフレッシュ綴り（その場で書き換えて同じ要素の写しを代入）が、getter に届く", async () => {
    const { host, stateEl, shadowRoot } = await mount({
      items: [{ name: "a" }, { name: "b" }],
      get all() { return (this as any).$getAll("items.*.name", []).join(","); },
    }, `<i class="a">{{ all }}</i>`);
    write(stateEl, (s) => { const arr = s.items; arr[1].name = "y"; s.items = [...arr]; });
    await flushTimes();
    expect(txt(shadowRoot, ".a")).toEqual(["a,y"]); // 旧: ["a,b"]
    host.remove();
  });
});

// ---------------------------------------------------------------------------
// 形 B: 新しいオブジェクトに差し替える（getter の依存）
// ---------------------------------------------------------------------------

describe("形 B: 新しいオブジェクトに差し替えると、子のパスを読む getter が新しい値になる", () => {
  for (const [variant, extra] of VARIANTS) {
    it(`$getAll で集める getter が先に評価されていても、first が新しい値になる（${variant}）`, async () => {
      const { host, stateEl, shadowRoot } = await mount({
        items: [{ name: "a" }, { name: "b" }],
        get all() { return (this as any).$getAll("items.*.name", []).join(","); },
        get first() { return (this as any)["items.0.name"]; },
        rename(this: any) { this["items.0"] = { name: "z" }; },
      }, `<p class="a">{{ all }}</p><p class="f">{{ first }}</p>` +
        `<button class="r" data-wcs="onclick: rename">r</button>` + extra);
      expect(txt(shadowRoot, ".f")).toEqual(["a"]);

      (shadowRoot.querySelector(".r") as HTMLButtonElement).click();
      await flushTimes();
      expect(txt(shadowRoot, ".a")).toEqual(["z,b"]);
      expect(read(stateEl, (s) => s.first)).toBe("z"); // 旧（対照以外）: "a"
      expect(txt(shadowRoot, ".f")).toEqual(["z"]); // 旧（対照以外）: ["a"]
      host.remove();
    });
  }

  it("対照: 評価の順を逆にする（first を先に描く）と、前から新しい値になる", async () => {
    const { host, stateEl, shadowRoot } = await mount({
      items: [{ name: "a" }, { name: "b" }],
      get all() { return (this as any).$getAll("items.*.name", []).join(","); },
      get first() { return (this as any)["items.0.name"]; },
    }, `<p class="f">{{ first }}</p><p class="a">{{ all }}</p>`);
    write(stateEl, (s) => { s["items.0"] = { name: "z" }; });
    await flushTimes();
    expect(txt(shadowRoot, ".f")).toEqual(["z"]);
    host.remove();
  });
});

// ---------------------------------------------------------------------------
// 行マウントのコンポーネント（bind-component）
// ---------------------------------------------------------------------------

let tagSeq = 0;

describe("行マウントのコンポーネントの getter", () => {
  const WRITES: [string, "click" | "host"][] = [["コンポーネントのメソッドで差し替える", "click"], ["ホストから差し替える", "host"]];

  it.each(WRITES)("ホストに $getAll の集計があっても、行の getter（this[\"tags.0.t\"]）が新しい値になる（%s）", async (_label, how) => {
    const tag = `ewcc-row-${++tagSeq}`;
    class Row extends HTMLElement {
      state = {
        get firstTag() { return (this as any)["tags.0.t"]; },
        ren(this: any) { this["tags.0"] = { t: this["tags.0.t"] + "!" }; },
      };
      constructor() {
        super();
        this.attachShadow({ mode: "open" }).innerHTML =
          `<wcs-state bind-component="state"></wcs-state><i class="f">{{ firstTag }}</i><button class="r" data-wcs="onclick: ren">r</button>`;
      }
    }
    customElements.define(tag, Row);
    const { host, stateEl, shadowRoot } = await mount({
      users: [{ tags: [{ t: "x" }, { t: "y" }] }, { tags: [{ t: "p" }] }],
      get allTags() { return (this as any).$getAll("users.*.tags.*.t", []).join(","); },
    }, `<b class="a">{{ allTags }}</b><template data-wcs="for: users"><${tag} data-wcs="state: ."></${tag}></template>`);
    const rows = Array.from(shadowRoot.querySelectorAll(tag)) as HTMLElement[];
    for (const row of rows) {
      const childState = row.shadowRoot!.querySelector("wcs-state") as State;
      await childState.connectedCallbackPromise;
      await State.getBindingsReady(row.shadowRoot!);
    }
    await flushTimes();
    const firsts = () => rows.map((row) => row.shadowRoot!.querySelector(".f")!.textContent);
    expect(firsts()).toEqual(["x", "p"]);

    if (how === "click") {
      (rows[0].shadowRoot!.querySelector(".r") as HTMLButtonElement).click();
    } else {
      write(stateEl, (s) => { s["users.0.tags.0"] = { t: "x!" }; });
    }
    await flushTimes(4);
    expect(txt(shadowRoot, ".a")).toEqual(["x!,y,p"]);
    expect(firsts()).toEqual(["x!", "p"]); // 旧: ["x", "p"]
    host.remove();
  });
});

// ---------------------------------------------------------------------------
// `$watch` の行の境界
// ---------------------------------------------------------------------------

describe("描いていないリストの $watch の行", () => {
  it("行を読み直させる代入・$postUpdate(\"items\") でも行の $watch は発火せず、getter は新しい値を読む", async () => {
    // 行を据え置いたまま中身を読み直させる展開は、キャッシュを無効にするだけで書き込みの着地にしない。
    // README の「headless な行 watch には `$listKeys` が要る」（`watch.wildcard.test.ts` の S13）のまま
    const calls: unknown[] = [];
    const { host, stateEl, shadowRoot } = await mount({
      items: [{ price: 1 }, { price: 2 }],
      get total() { return (this as any).$getAll("items.*.price", []).reduce((a: number, b: number) => a + b, 0); },
      $watch: { "items.*.price"(cur: unknown, _prev: unknown, index: number) { calls.push([index, cur]); } },
    }, `<b class="t">{{ total }}</b>`);
    await flushTimes();
    const STEPS: [(s: any) => void, string][] = [
      [(s) => { s.items[0].price = 10; s.items = s.items; }, "12"],
      [(s) => { s.items[1].price = 20; s.items = [...s.items]; }, "30"],
      [(s) => { s.items[0].price = 30; s.$postUpdate("items"); }, "50"],
      [(s) => { s.items = [{ price: 1 }, { price: 5 }]; }, "6"],
    ];
    for (const [step, total] of STEPS) {
      write(stateEl, step);
      await flushTimes();
      expect(txt(shadowRoot, ".t")).toEqual([total]);
    }
    expect(calls).toEqual([]);
    host.remove();
  });

  it("行の値が載った描いていないリストでも、中身の違う配列の代入は差分を取らず、新しい配列の台帳を作らない", async () => {
    // 追加した行には描くものもキャッシュも無い。読み手がいないのに台帳（行）を作るのは無駄な費用
    const { host, stateEl } = await mount({ items: [{ v: 1 }, { v: 2 }] });
    expect(read(stateEl, (s) => s["items.1.v"])).toBe(2); // 行の値をキャッシュに載せる（items → items.* の辺が張られる）
    expect(stateEl.staticDependency.get("items")).toEqual(["items.*"]);
    const next = [{ v: 3 }, { v: 4 }, { v: 5 }];
    write(stateEl, (s) => { s.items = next; });
    await flushTimes();
    expect(getListIndexesByList(next)).toBeNull();
    expect(read(stateEl, (s) => [s["items.2.v"], s.$getAll("items.*.v", [])])).toEqual([5, [3, 4, 5]]);
    host.remove();
  });
});
