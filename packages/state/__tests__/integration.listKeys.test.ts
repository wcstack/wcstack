/**
 * integration.listKeys.test.ts — `$listKeys`（キー一致行のオブジェクト値展開）の
 * エンドツーエンド契約（docs/state-list-key-design.md）。
 *
 * Phase 0（pin）: キー未宣言時の既存挙動を固定する。fetch 相当の全行置換で
 * 行 DOM の対応が壊れること自体が現行仕様であり、$listKeys 導入後もこの挙動は
 * 「宣言しなければ従来どおり」の不変条件（§7-1）として維持される。
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
  const host = document.createElement(`listkeys-host-${seq++}`);
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

/** 行内に「バインドされていない DOM 状態」（details の開閉）を持つテンプレート */
const ROW_TPL = `<ul><template data-wcs="for: items">
  <li><details><summary>s</summary>d</details><input data-wcs="value: .name"></li>
</template></ul>`;

const lis = (root: ShadowRoot) => Array.from(root.querySelectorAll("li"));
const inputs = (root: ShadowRoot) =>
  Array.from(root.querySelectorAll("input")) as HTMLInputElement[];
const opens = (root: ShadowRoot) =>
  lis(root).map((li) => (li.querySelector("details") as HTMLDetailsElement).open);

describe("Phase 0 pin: $listKeys 未宣言時の既存挙動", () => {
  it("参照が変わる全行置換で行 DOM の対応が壊れ、非バインド状態が別行へ移ること", async () => {
    const items = [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
      { id: 3, name: "c" },
    ];
    const { host, shadowRoot, stateElement } = await mount({ items }, ROW_TPL);

    const before = lis(shadowRoot);
    expect(inputs(shadowRoot).map((i) => i.value)).toEqual(["a", "b", "c"]);

    // 行 0 の details を開き、行 0 の input にフォーカス
    (before[0].querySelector("details") as HTMLDetailsElement).open = true;
    inputs(shadowRoot)[0].focus();
    expect(shadowRoot.activeElement).toBe(inputs(shadowRoot)[0]);

    // fetch 相当: 内容は同じだが全て新しいオブジェクト
    stateElement.createState("writable", (s: any) => {
      s.items = JSON.parse(JSON.stringify(items));
    });
    await flush();

    const after = lis(shadowRoot);
    expect(inputs(shadowRoot).map((i) => i.value)).toEqual(["a", "b", "c"]);
    // content プールが LIFO で再配布するため旧行 DOM は逆順に配られる
    expect(before.map((li) => after.indexOf(li))).toEqual([2, 1, 0]);
    // 行 0 で開いた details の状態が行 2 に現れる（消えるのではなくシャッフルされる）
    expect(opens(shadowRoot)).toEqual([false, false, true]);
    // フォーカスは失われる
    expect(shadowRoot.activeElement).toBe(null);

    host.remove();
  });

  it("プリミティブ配列は JSON ラウンドトリップでも全行再利用されること", async () => {
    const items = ["a", "b", "c"];
    const { host, shadowRoot, stateElement } = await mount(
      { items },
      `<ul><template data-wcs="for: items"><li>{{ . }}</li></template></ul>`,
    );
    const before = lis(shadowRoot);
    stateElement.createState("writable", (s: any) => {
      s.items = JSON.parse(JSON.stringify(items));
    });
    await flush();
    expect(lis(shadowRoot)).toEqual(before);
    host.remove();
  });

  it("in-place 変異と構造変化を 1 回の代入に混ぜると更新が取りこぼされること（§7.0 の穴）", async () => {
    const items = [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ];
    const { host, shadowRoot, stateElement } = await mount({ items }, ROW_TPL);
    expect(inputs(shadowRoot).map((i) => i.value)).toEqual(["a", "b"]);

    // 手書きの id 突合マージ（行オブジェクトの参照を保つ回避策）＋ 行追加
    const fresh = [
      { id: 1, name: "A" },
      { id: 2, name: "b" },
      { id: 3, name: "c" },
    ];
    stateElement.createState("writable", (s: any) => {
      const byId = new Map(s.items.map((r: any) => [r.id, r]));
      s.items = fresh.map((f: any) => {
        const cur: any = byId.get(f.id);
        if (cur) {
          Object.assign(cur, f);
          return cur;
        }
        return f;
      });
    });
    await flush();

    // 行 0 の name は "A" に変異済みだが、addIndexSet 非空のため展開されず stale
    expect(inputs(shadowRoot).map((i) => i.value)).toEqual(["a", "b", "c"]);
    host.remove();
  });
});

const KEYED = { items: "id" };

describe("$listKeys: キー一致行のオブジェクト値展開", () => {
  it("fetch 相当の全行置換でも行 DOM・非バインド状態・フォーカスが保存されること", async () => {
    const items = [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
      { id: 3, name: "c" },
    ];
    const { host, shadowRoot, stateElement } = await mount(
      { items, $listKeys: KEYED },
      ROW_TPL,
    );
    const before = lis(shadowRoot);
    (before[0].querySelector("details") as HTMLDetailsElement).open = true;
    inputs(shadowRoot)[0].focus();

    // 内容も一部変わる（行 0 の name）新しいオブジェクト群
    stateElement.createState("writable", (s: any) => {
      s.items = [
        { id: 1, name: "A" },
        { id: 2, name: "b" },
        { id: 3, name: "c" },
      ];
    });
    await flush();

    expect(lis(shadowRoot)).toEqual(before); // 行 DOM 同一性が完全保存
    expect(inputs(shadowRoot).map((i) => i.value)).toEqual(["A", "b", "c"]);
    expect(opens(shadowRoot)).toEqual([true, false, false]); // 開閉が行 0 に残る
    expect(shadowRoot.activeElement).toBe(inputs(shadowRoot)[0]); // フォーカス維持
    host.remove();
  });

  it("in-place 更新と行追加が混在しても更新が取りこぼされないこと（§7.0 の穴を塞ぐ）", async () => {
    const items = [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ];
    const { host, shadowRoot, stateElement } = await mount(
      { items, $listKeys: KEYED },
      ROW_TPL,
    );
    const before = lis(shadowRoot);

    stateElement.createState("writable", (s: any) => {
      s.items = [
        { id: 1, name: "A" }, // 値変更（位置は不変）
        { id: 2, name: "b" },
        { id: 3, name: "c" }, // 追加
      ];
    });
    await flush();

    // Phase 0 pin では ["a","b","c"] で stale になっていたケース
    expect(inputs(shadowRoot).map((i) => i.value)).toEqual(["A", "b", "c"]);
    expect(lis(shadowRoot).slice(0, 2)).toEqual(before); // 既存行の DOM は保存
    host.remove();
  });

  it("並べ替え・削除・値変更が同時に起きても正しく反映されること", async () => {
    const items = [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
      { id: 3, name: "c" },
    ];
    const { host, shadowRoot, stateElement } = await mount(
      { items, $listKeys: KEYED },
      ROW_TPL,
    );
    const before = lis(shadowRoot);

    stateElement.createState("writable", (s: any) => {
      s.items = [
        { id: 3, name: "C" }, // 移動 + 値変更
        { id: 1, name: "a" }, // 移動
        // id: 2 は削除
      ];
    });
    await flush();

    expect(inputs(shadowRoot).map((i) => i.value)).toEqual(["C", "a"]);
    // 行 DOM は移動して再利用される（新規生成ではない）
    expect(lis(shadowRoot)).toEqual([before[2], before[0]]);
    host.remove();
  });

  it("無変化リフレッシュでは行が一切再適用されないこと（§2.2）", async () => {
    const items = [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ];
    const { host, shadowRoot, stateElement } = await mount(
      { items, $listKeys: KEYED },
      `<ul><template data-wcs="for: items"><li><span data-wcs="textContent: .name"></span></li></template></ul>`,
    );
    const spans = () => Array.from(shadowRoot.querySelectorAll("span"));
    expect(spans().map((s) => s.textContent)).toEqual(["a", "b"]);

    // 外部から DOM を汚しておき、再適用が起きれば上書きされることを利用して観測する
    spans().forEach((s) => (s.textContent = "TOUCHED"));

    stateElement.createState("writable", (s: any) => {
      s.items = JSON.parse(JSON.stringify(items));
    });
    await flush();

    // 再適用が走っていないので TOUCHED のまま
    expect(spans().map((s) => s.textContent)).toEqual(["TOUCHED", "TOUCHED"]);
    host.remove();
  });

  it("旧行に無いフィールドの追加と、新行から消えたフィールドが反映されること（§6）", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      {
        items: [{ id: 1, name: "a", note: "keep" }],
        $listKeys: KEYED,
      },
      `<ul><template data-wcs="for: items"><li><span class="n" data-wcs="textContent: .note"></span><span class="e" data-wcs="textContent: .extra"></span></li></template></ul>`,
    );
    const text = (cls: string) => shadowRoot.querySelector(`span.${cls}`)!.textContent;
    expect(text("n")).toBe("keep");

    stateElement.createState("writable", (s: any) => {
      s.items = [{ id: 1, name: "a", extra: "added" }]; // note が消え extra が増える
    });
    await flush();

    expect(text("e")).toBe("added");
    // 消えたフィールドは null 代入でクリアされる（undefined だと
    // applyChangeToProperty が書き込みをスキップして DOM に旧値が残る）
    expect(text("n")).toBe("");
    host.remove();
  });

  it("キー関数で複合キーを扱えること", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      {
        items: [
          { ns: "x", id: 1, name: "a" },
          { ns: "y", id: 1, name: "b" },
        ],
        $listKeys: { items: (row: any) => `${row.ns}/${row.id}` },
      },
      ROW_TPL,
    );
    const before = lis(shadowRoot);

    stateElement.createState("writable", (s: any) => {
      s.items = [
        { ns: "y", id: 1, name: "B" },
        { ns: "x", id: 1, name: "a" },
      ];
    });
    await flush();

    expect(inputs(shadowRoot).map((i) => i.value)).toEqual(["B", "a"]);
    expect(lis(shadowRoot)).toEqual([before[1], before[0]]);
    host.remove();
  });

  it("宣言されたネストパスも再帰的にキー突合されること（§4）", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      {
        groups: [
          { id: 1, name: "g1", rows: [{ id: 11, name: "r11" }, { id: 12, name: "r12" }] },
          { id: 2, name: "g2", rows: [{ id: 21, name: "r21" }] },
        ],
        $listKeys: { groups: "id", "groups.*.rows": "id" },
      },
      `<div><template data-wcs="for: groups">
        <section><template data-wcs="for: groups.*.rows">
          <li><details><summary>s</summary>d</details><span data-wcs="textContent: .name"></span></li>
        </template></section>
      </template></div>`,
    );
    const rows = () => Array.from(shadowRoot.querySelectorAll("li"));
    const rowTexts = () =>
      rows().map((li) => li.querySelector("span")!.textContent);
    expect(rowTexts()).toEqual(["r11", "r12", "r21"]);

    const before = rows();
    (before[0].querySelector("details") as HTMLDetailsElement).open = true;

    // fetch 相当: グループも行も全て新しいオブジェクト
    stateElement.createState("writable", (s: any) => {
      s.groups = [
        { id: 1, name: "g1", rows: [{ id: 11, name: "R11" }, { id: 12, name: "r12" }] },
        { id: 2, name: "g2", rows: [{ id: 21, name: "r21" }] },
      ];
    });
    await flush();

    expect(rowTexts()).toEqual(["R11", "r12", "r21"]);
    expect(rows()).toEqual(before); // ネストした行 DOM も同一性保存
    expect((rows()[0].querySelector("details") as HTMLDetailsElement).open).toBe(true);
    host.remove();
  });

  it("未宣言のネスト配列は従来どおり参照置換されること（段階導入）", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      {
        groups: [
          { id: 1, rows: [{ id: 11, name: "r11" }, { id: 12, name: "r12" }] },
        ],
        $listKeys: { groups: "id" }, // groups.*.rows は未宣言
      },
      `<div><template data-wcs="for: groups">
        <section><template data-wcs="for: groups.*.rows">
          <li><details><summary>s</summary>d</details><span data-wcs="textContent: .name"></span></li>
        </template></section>
      </template></div>`,
    );
    const rows = () => Array.from(shadowRoot.querySelectorAll("li"));
    const rowOpens = () =>
      rows().map((li) => (li.querySelector("details") as HTMLDetailsElement).open);
    (rows()[0].querySelector("details") as HTMLDetailsElement).open = true;
    expect(rowOpens()).toEqual([true, false]);

    stateElement.createState("writable", (s: any) => {
      s.groups = [
        { id: 1, rows: [{ id: 11, name: "R11" }, { id: 12, name: "r12" }] },
      ];
    });
    await flush();

    expect(rows().map((li) => li.querySelector("span")!.textContent)).toEqual(["R11", "r12"]);
    // 未宣言なのでネスト行は解体・再構築され、非バインド状態は行間でシャッフルされる
    // （宣言すれば §4 のテストのとおり保存される）
    expect(rowOpens()).toEqual([false, true]);
    host.remove();
  });

  it("初回代入（旧配列なし）は素通しで、以降の代入からキー突合が効くこと", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      { items: [], $listKeys: KEYED },
      ROW_TPL,
    );
    expect(lis(shadowRoot)).toEqual([]);

    stateElement.createState("writable", (s: any) => {
      s.items = [{ id: 1, name: "a" }];
    });
    await flush();
    const created = lis(shadowRoot);
    expect(inputs(shadowRoot).map((i) => i.value)).toEqual(["a"]);

    stateElement.createState("writable", (s: any) => {
      s.items = [{ id: 1, name: "A" }];
    });
    await flush();
    expect(inputs(shadowRoot).map((i) => i.value)).toEqual(["A"]);
    expect(lis(shadowRoot)).toEqual(created);
    host.remove();
  });

  it("for に描画されていないリストでも値が正しく反映されること", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      { items: [{ id: 1, name: "a" }], title: "t", $listKeys: KEYED },
      `<span data-wcs="textContent: title"></span>`, // items は描画しない
    );
    expect(shadowRoot.querySelector("span")!.textContent).toBe("t");

    stateElement.createState("writable", (s: any) => {
      s.items = [{ id: 1, name: "A" }, { id: 2, name: "b" }];
    });
    await flush();

    // listIndex 台帳が無い状態でも per-path 書き込みが行オブジェクトへ届く
    stateElement.createState("readonly", (s: any) => {
      expect(s.items.map((r: any) => r.name)).toEqual(["A", "b"]);
    });
    host.remove();
  });

  it("for に描画されていないリストでもワイルドカード読みが追随すること", async () => {
    // 書き込み側が読み手と別の listIndex 台帳を作ると、行オブジェクトの値は
    // 正しいのに $getAll / getter だけ旧値のまま残る（設計書 §8.1）。
    const { host, shadowRoot, stateElement } = await mount(
      {
        items: [{ id: 1, v: 1 }, { id: 2, v: 2 }],
        $listKeys: KEYED,
        get total(this: any) {
          return this.$getAll("items.*.v", []).reduce((a: number, b: number) => a + b, 0);
        },
      },
      `<div data-wcs="textContent: total"></div>`, // items は for で描画しない
    );
    expect(shadowRoot.querySelector("div")!.textContent).toBe("3");

    stateElement.createState("writable", (s: any) => {
      s.items = [{ id: 1, v: 10 }, { id: 2, v: 2 }];
    });
    await flush();

    expect(shadowRoot.querySelector("div")!.textContent).toBe("12");
    stateElement.createState("readonly", (s: any) => {
      expect(s.$getAll("items.*.v", [])).toEqual([10, 2]);
      expect(s.total).toBe(12);
    });
    host.remove();
  });

  // pin: 非表示（deactivate 済み）の for 配下は、行の同一性が保たれる更新を
  // 再表示時に取り戻せない。これは $listKeys 固有ではなく、行参照を保つ手書き
  // マージ（§7.0 のイディオム）でも同じに壊れる既存の穴で、本機能のスコープ外。
  // $listKeys は行同一性を保つ機能なので、この組み合わせを踏みやすくはする。
  it.each([
    ["$listKeys でキー突合", true],
    ["行参照を保つ手書きマージ", false],
  ])("非表示中の行内更新は再表示で反映されない（既存の穴・%s）", async (_label, keyed) => {
    const initial: any = { show: true, items: [{ id: 1, name: "a" }, { id: 2, name: "b" }] };
    if (keyed) initial.$listKeys = KEYED;
    const { host, shadowRoot, stateElement } = await mount(
      initial,
      `<template data-wcs="if: show">${ROW_TPL}</template>`,
    );
    expect(inputs(shadowRoot).map((i) => i.value)).toEqual(["a", "b"]);

    stateElement.createState("writable", (s: any) => { s.show = false; });
    await flush();
    stateElement.createState("writable", (s: any) => {
      if (keyed) {
        s.items = [{ id: 1, name: "A" }, { id: 2, name: "b" }];
      } else {
        const cur = s.items;
        cur[0].name = "A";
        s.items = [...cur];
      }
    });
    await flush();
    stateElement.createState("writable", (s: any) => { s.show = true; });
    await flush();

    // state 側は正しく更新されている
    stateElement.createState("readonly", (s: any) => {
      expect(s.items.map((r: any) => r.name)).toEqual(["A", "b"]);
    });
    // DOM は非表示中に落ちた更新を取り戻せず旧値のまま（現行挙動の固定）
    expect(inputs(shadowRoot).map((i) => i.value)).toEqual(["a", "b"]);
    host.remove();
  });
});

describe("$listKeys: 異常時は即エラー（§5）", () => {
  async function mountKeyed(initial: any) {
    return mount({ $listKeys: KEYED, ...initial }, ROW_TPL);
  }

  it("新配列のキー重複を検出すること", async () => {
    const { host, stateElement } = await mountKeyed({ items: [{ id: 1, name: "a" }] });
    expect(() =>
      stateElement.createState("writable", (s: any) => {
        s.items = [{ id: 7, name: "x" }, { id: 7, name: "y" }];
      }),
    ).toThrow(/duplicate key 7 in new list/);
    host.remove();
  });

  it("現在の配列のキー重複を検出すること", async () => {
    const { host, stateElement } = await mountKeyed({
      items: [{ id: 1, name: "a" }, { id: 1, name: "b" }],
    });
    expect(() =>
      stateElement.createState("writable", (s: any) => {
        s.items = [{ id: 1, name: "z" }];
      }),
    ).toThrow(/duplicate key 1 in current list/);
    host.remove();
  });

  it("キー欠落を検出すること", async () => {
    const { host, stateElement } = await mountKeyed({ items: [{ id: 1, name: "a" }] });
    expect(() =>
      stateElement.createState("writable", (s: any) => {
        s.items = [{ name: "no-id" }];
      }),
    ).toThrow(/has no key .*field "id".* returned undefined/);
    host.remove();
  });

  it("非 plain オブジェクト行を検出すること", async () => {
    class Row {
      constructor(public id: number, public name: string) {}
    }
    const { host, stateElement } = await mountKeyed({ items: [{ id: 1, name: "a" }] });
    expect(() =>
      stateElement.createState("writable", (s: any) => {
        s.items = [new Row(1, "a")];
      }),
    ).toThrow(/must be a plain object/);
    host.remove();
  });

  it("非オブジェクト行を検出すること", async () => {
    const { host, stateElement } = await mountKeyed({ items: [{ id: 1, name: "a" }] });
    expect(() =>
      stateElement.createState("writable", (s: any) => {
        s.items = ["not-a-row"];
      }),
    ).toThrow(/must be a plain object \(got string\)/);
    host.remove();
  });
});
