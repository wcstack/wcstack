/**
 * integration.elementSwapLedger.test.ts — 要素書き込みの入れ替え（#4 の同一性モデル）が組み替える
 * 行の台帳（#335・#337）。
 *
 * #335: 入れ替えは、いまの配列の台帳の配列をその場で書き換えていた。同じバッチで一覧を新しい配列で
 * 置き換えた後だと、その台帳は置き換えの差分としてキャッシュした `newIndexes`（同じ中身の写しなら、
 * 前の配列の台帳そのもの — createListDiff の isSameList）と同じ配列なので、差し替えで入った行が
 * 差分の `addIndexSet` に無いまま `for` がその差分を適用し、`Content not found for ListIndex` で投げた。
 * 以後その `for` の描いた行と台帳が食い違ったまま、並べ替えにも追加にも追従しなかった。
 *
 * #337: 入れ替えは、書いた値を書き込む前の並びの写しから `indexOf` で探し、見つかった位置の行を
 * この位置へ移していた。別の行が同じ値を書くと、その行の listIndex を奪って台帳に重複ができ、
 * 「値が重複しない」を揃った印にしていたので入れ替えは揃わず、描き直しも起きなかった。
 * `$1` の並びが狂い（2, 0, 1）、一覧を縮めても消えない行が残った。入れ替えの途中の台帳には
 * index を振り直していない行が載るので、同じ位置へのもう一度の書き込みが別の位置に着地した。
 *
 * 要素から来た書き込み（行の要素が自分の行へ出す値）もこの入れ替えの経路を通っていたので、同じ値から進む
 * 行は別の行と入れ替わり、以後の出力が別の行に届いた。input で編集中の欄も別の位置へ動いた。
 *
 * 修理: 入れ替えの途中は台帳を書き込む前の行のままにし、揃ったら書き込む前の並びと突き合わせて
 * 新しい配列の台帳を作る（setByAddress の matchSwappedListIndexes）。差分のキャッシュは、新しい配列の
 * 台帳が差分の `newIndexes` と違えば台帳どうしで取り直す（createListDiff）。要素から来た書き込みは
 * 入れ替えに通さず、その行の値の更新として書く（proxy/occurrenceWrite.ts のトークン）。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { flush, makeMount, read, write } from "./helpers/recursionTestUtils";

beforeAll(() => {
  bootstrapState();
});

const mount = makeMount("swap-ledger-host");

let errorSpy: ReturnType<typeof vi.spyOn> | null = null;
/** 失敗の手がかりは console.error（`binding "for: items" failed to apply`）だけなので数える */
function spyErrors(): ReturnType<typeof vi.spyOn> {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  return errorSpy;
}
afterEach(() => {
  errorSpy?.mockRestore();
  errorSpy = null;
});

const texts = (root: ParentNode, selector: string): string[] =>
  Array.from(root.querySelectorAll(selector)).map((node) => (node.textContent ?? "").trim());

const UL = `<ul><template data-wcs="for: items"><li><b>{{ .id }}</b><i>{{ $1 }}</i></li></template></ul>`;

async function step(stateEl: State, fn: (s: any) => void): Promise<void> {
  write(stateEl, fn);
  await flush();
}

/** 描いた id・`$1`・状態の id が揃っていることを 1 度に見る */
function view(shadowRoot: ShadowRoot, stateEl: State): { ids: string[]; rows: string[]; state: string[] } {
  return {
    ids: texts(shadowRoot, "li > b"),
    rows: texts(shadowRoot, "li > i"),
    state: read(stateEl, (s: any) => s.items.map((item: any) => String(item.id))),
  };
}
const expected = (...ids: number[]) => ({
  ids: ids.map(String),
  rows: ids.map((_, i) => String(i)),
  state: ids.map(String),
});

describe("同じバッチで一覧を置き換えてから要素に書き込む（#335）", () => {
  it("形 A: 行を足してから行 0 を差し替えても投げず、以後の並べ替え・追加・置き換えにも追従すること", async () => {
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount({ items: [{ id: 1 }, { id: 2 }, { id: 3 }] }, UL);

    await step(stateEl, (s) => {
      s.items = [...s.items, { id: 4 }];
      s["items.0"] = { id: 99 };
    });
    expect(view(shadowRoot, stateEl)).toEqual(expected(99, 2, 3, 4)); // 修理前: <li> は 99, 2, 3
    await step(stateEl, (s) => { s.items = [...s.items].reverse(); });
    expect(view(shadowRoot, stateEl)).toEqual(expected(4, 3, 2, 99)); // 修理前: 99, 2, 3 のまま
    await step(stateEl, (s) => { s.items = [...s.items, { id: 5 }]; });
    expect(view(shadowRoot, stateEl)).toEqual(expected(4, 3, 2, 99, 5));
    await step(stateEl, (s) => { s.items = [{ id: 7 }, { id: 8 }]; });
    expect(view(shadowRoot, stateEl)).toEqual(expected(7, 8));
    // 修理前: 上の 3 手で毎回 `Content not found for ListIndex: 0 at path "items"`
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("形 B: 同じ中身の写しで置き換えてから行 1 を差し替えても投げず、丸ごとの置き換えで行が残らないこと", async () => {
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount({ items: [{ id: 1 }, { id: 2 }, { id: 3 }] }, UL);

    await step(stateEl, (s) => {
      s.items = [...s.items];
      s["items.1"] = { id: 99 };
    });
    expect(view(shadowRoot, stateEl)).toEqual(expected(1, 99, 3));
    await step(stateEl, (s) => { s.items = [...s.items].reverse(); });
    expect(view(shadowRoot, stateEl)).toEqual(expected(3, 99, 1)); // 修理前: <li> は 3, 1, 99
    await step(stateEl, (s) => { s.items = [...s.items, { id: 5 }]; });
    expect(view(shadowRoot, stateEl)).toEqual(expected(3, 99, 1, 5));
    await step(stateEl, (s) => { s.items = [{ id: 7 }, { id: 8 }]; });
    expect(view(shadowRoot, stateEl)).toEqual(expected(7, 8)); // 修理前: <li> は 7, 8, 99
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("置き換えた同じバッチで行を入れ替えても、ブロックが値と一緒に描かれること", async () => {
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount({ items: [{ id: 1 }, { id: 2 }, { id: 3 }] }, UL);

    await step(stateEl, (s) => {
      s.items = [...s.items, { id: 4 }];
      const first = s["items.0"];
      s["items.0"] = s["items.3"];
      s["items.3"] = first;
    });
    expect(view(shadowRoot, stateEl)).toEqual(expected(4, 2, 3, 1));
    await step(stateEl, (s) => { s.items = [...s.items].reverse(); });
    expect(view(shadowRoot, stateEl)).toEqual(expected(1, 3, 2, 4));
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });
});

let tagSeq = 0;
function defineOutputOnly(): string {
  const tag = `x-swap-ledger-out-${++tagSeq}`;
  customElements.define(tag, class extends HTMLElement {
    static wcBindable = {
      protocol: "wc-bindable",
      version: 1,
      properties: [{ name: "status", event: `${tag}:status` }],
    };
    get status(): string { return "ready"; } // どのインスタンスも同じ値
  });
  return tag;
}

function defineTwoWay(): string {
  const tag = `x-swap-ledger-store-${++tagSeq}`;
  customElements.define(tag, class extends HTMLElement {
    static wcBindable = {
      protocol: "wc-bindable",
      version: 1,
      properties: [{ name: "value", event: `${tag}:value-changed` }],
      inputs: [{ name: "value" }],
    };
    _value: unknown = "persisted";
    get value(): unknown { return this._value; }
    set value(v: unknown) {
      this._value = v;
      this.dispatchEvent(new CustomEvent(`${tag}:value-changed`, { detail: v }));
    }
  });
  return tag;
}

async function mountHtml(html: string) {
  const host = document.createElement(`swap-ledger-raw-${++tagSeq}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = html;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  await flush();
  await flush();
  return { host, shadowRoot, stateEl };
}

async function settle(stateEl: State, fn: (s: any) => void): Promise<void> {
  write(stateEl, fn);
  await flush();
  await flush();
}

const rowView = (shadowRoot: ShadowRoot, stateEl: State) => ({
  li: shadowRoot.querySelectorAll("li").length,
  index: texts(shadowRoot, "i"),
  rows: read(stateEl, (s: any) => [...s.rows]),
});

describe("行の要素が同じ値を行そのものへ書く（#337）", () => {
  for (const binding of ["status: .", "status: rows.*"]) {
    it(`出力専用メンバーを \`${binding}\` で束ね、どの要素も同じ値を返しても、$1 が並び、縮めた行が消えること`, async () => {
      const tag = defineOutputOnly();
      const errors = spyErrors();
      const { host, shadowRoot, stateEl } = await mountHtml(`
        <wcs-state json='{"rows":["a","b","c"]}'></wcs-state>
        <ul><template data-wcs="for: rows"><li><${tag} data-wcs="${binding}"></${tag}><span>{{ . }}</span><i>{{ $1 }}</i></li></template></ul>
      `);
      // 修理前: $1 は 2, 0, 1
      expect(rowView(shadowRoot, stateEl)).toEqual({ li: 3, index: ["0", "1", "2"], rows: ["ready", "ready", "ready"] });
      expect(texts(shadowRoot, "span")).toEqual(["ready", "ready", "ready"]);
      await settle(stateEl, (s) => { s.rows = ["x", "y"]; });
      // 修理前: <li> 4・$1 は 1, 0, 0, 1
      expect(rowView(shadowRoot, stateEl)).toEqual({ li: 2, index: ["0", "1"], rows: ["ready", "ready"] });
      await settle(stateEl, (s) => { s.rows = []; });
      // 修理前: <li> 3
      expect(rowView(shadowRoot, stateEl)).toEqual({ li: 0, index: [], rows: [] });
      expect(errors).not.toHaveBeenCalled();
      host.remove();
    });
  }

  it("双方向メンバーを `value#init=element: .` で束ね、どの要素も同じ値を持っても、縮めた行が消えること", async () => {
    const tag = defineTwoWay();
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mountHtml(`
      <wcs-state json='{"rows":["a","b","c"]}'></wcs-state>
      <ul><template data-wcs="for: rows"><li><${tag} data-wcs="value#init=element: ."></${tag}><i>{{ $1 }}</i></li></template></ul>
    `);
    expect(rowView(shadowRoot, stateEl)).toEqual({ li: 3, index: ["0", "1", "2"], rows: ["persisted", "persisted", "persisted"] });
    await settle(stateEl, (s) => { s.rows = ["x", "y"]; });
    expect(rowView(shadowRoot, stateEl)).toEqual({ li: 2, index: ["0", "1"], rows: ["persisted", "persisted"] }); // 修理前: <li> 4
    await settle(stateEl, (s) => { s.rows = []; });
    expect(rowView(shadowRoot, stateEl)).toEqual({ li: 0, index: [], rows: [] }); // 修理前: <li> 3
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("行の中の要素を if: で後から出し、行を 1 つずつ足しても、$1 が並び、縮めた行が消えること", async () => {
    const tag = defineOutputOnly();
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mountHtml(`
      <wcs-state json='{"show":false,"rows":["a"]}'></wcs-state>
      <ul><template data-wcs="for: rows"><li><template data-wcs="if: show"><${tag} data-wcs="status: rows.*"></${tag}></template><i>{{ $1 }}</i></li></template></ul>
    `);
    await settle(stateEl, (s) => { s.show = true; });
    for (const row of ["b", "c"]) {
      await settle(stateEl, (s) => { s.rows = [...s.rows, row]; });
    }
    // 修理前: $1 は 0, 2, 1
    expect(rowView(shadowRoot, stateEl)).toEqual({ li: 3, index: ["0", "1", "2"], rows: ["ready", "ready", "ready"] });
    await settle(stateEl, (s) => { s.rows = ["x", "y"]; });
    expect(rowView(shadowRoot, stateEl)).toEqual({ li: 2, index: ["0", "1"], rows: ["ready", "ready"] }); // 修理前: <li> 4
    await settle(stateEl, (s) => { s.rows = []; });
    expect(rowView(shadowRoot, stateEl)).toEqual({ li: 0, index: [], rows: [] }); // 修理前: <li> 3
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("同じ値の行を含む並びの入れ替えも揃い、ブロックが値と一緒に動くこと", async () => {
    const shared = { id: 1 };
    const { host, shadowRoot, stateEl } = await mount({ items: [shared, shared, { id: 2 }] }, UL);
    const blocks = Array.from(shadowRoot.querySelectorAll("li"));

    await step(stateEl, (s) => {
      const first = s["items.0"];
      s["items.0"] = s["items.2"];
      s["items.2"] = first;
    });
    expect(view(shadowRoot, stateEl)).toEqual(expected(2, 1, 1));
    // 修理前: 値が重複する並びは揃わず、ブロックは動かなかった（[0], [1], [2] のまま）
    expect(Array.from(shadowRoot.querySelectorAll("li"))).toEqual([blocks[2], blocks[1], blocks[0]]);
    host.remove();
  });
});

describe("入れ替えの途中の台帳（#337）", () => {
  it("別の行の値を写した後、同じ位置へもう一度書くとその位置に着地し、途中の読みも位置どおりであること", async () => {
    const { host, shadowRoot, stateEl } = await mount({ items: [{ id: 1 }, { id: 2 }, { id: 3 }] }, UL);
    const seen: unknown[] = [];

    await step(stateEl, (s) => {
      s["items.0"] = s["items.2"]; // 入れ替えの片側（3 が位置 0 と 2 の両方にある）
      seen.push(s["items.0"].id, s["items.2"].id);
      s["items.0"] = { id: 9 };
      seen.push(s["items.0"].id, s["items.1"].id, s["items.2"].id);
    });
    expect(seen).toEqual([3, 3, 9, 2, 3]);
    // 修理前: 2 回目の書き込みが位置 2 に着地し、状態は 3, 2, 9
    expect(view(shadowRoot, stateEl)).toEqual(expected(9, 2, 3));
    host.remove();
  });

  it("同じ値を持ち続ける行ができた並びは揃わないまま、行はブロックを保って位置どおりに描かれること", async () => {
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount({ items: [{ id: 1 }, { id: 2 }, { id: 3 }] }, UL);
    const blocks = Array.from(shadowRoot.querySelectorAll("li"));

    await step(stateEl, (s) => { s["items.1"] = s["items.0"]; }); // 1 が位置 0 と 1 に残る
    expect(view(shadowRoot, stateEl)).toEqual(expected(1, 1, 3));
    await step(stateEl, (s) => {
      const first = s["items.0"];
      s["items.0"] = s["items.2"];
      s["items.2"] = first;
    });
    // 1 が 2 つの位置に残るので、書き込む前の並び（1, 2, 3）から見て入れ替えの途中のまま
    expect(view(shadowRoot, stateEl)).toEqual(expected(3, 1, 1));
    expect(Array.from(shadowRoot.querySelectorAll("li"))).toEqual(blocks);
    await step(stateEl, (s) => { s.items = [...s.items].reverse(); });
    expect(view(shadowRoot, stateEl)).toEqual(expected(1, 1, 3));
    // 配列を置き換えた後は、同じ値の行を含む並びとして入れ替わる
    const reversed = Array.from(shadowRoot.querySelectorAll("li"));
    await step(stateEl, (s) => {
      const first = s["items.0"];
      s["items.0"] = s["items.2"];
      s["items.2"] = first;
    });
    expect(view(shadowRoot, stateEl)).toEqual(expected(3, 1, 1));
    expect(Array.from(shadowRoot.querySelectorAll("li"))).toEqual([reversed[2], reversed[1], reversed[0]]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("入れ替えの片側だけを書いたまま一覧を置き換えても、表示が状態と一致し、後の書き込みで揃うこと", async () => {
    const { host, shadowRoot, stateEl } = await mount({ items: [{ id: 1 }, { id: 2 }, { id: 3 }] }, UL);
    const blocks = Array.from(shadowRoot.querySelectorAll("li"));
    let first: unknown;

    await step(stateEl, (s) => {
      first = s["items.0"];
      s["items.0"] = s["items.2"];
    });
    expect(view(shadowRoot, stateEl)).toEqual(expected(3, 2, 3));
    await step(stateEl, (s) => { s.items = [...s.items, { id: 4 }]; });
    expect(view(shadowRoot, stateEl)).toEqual(expected(3, 2, 3, 4));
    await step(stateEl, (s) => { s["items.2"] = first; });
    expect(view(shadowRoot, stateEl)).toEqual(expected(3, 2, 1, 4));
    expect(Array.from(shadowRoot.querySelectorAll("li")).slice(0, 3)).toEqual(blocks);
    host.remove();
  });

  it("入れ替えの途中に新しい値をいくつ書いても、揃うまで位置どおりに描かれ、揃えば動いた行が値と一緒に動くこと", async () => {
    const errors = spyErrors();
    const { host, shadowRoot, stateEl } = await mount({ items: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] }, UL);
    const blocks = Array.from(shadowRoot.querySelectorAll("li"));
    let four: unknown;

    await step(stateEl, (s) => {
      four = s["items.3"];
      s["items.3"] = s["items.2"]; // 3 が位置 2 と 3 に残る（入れ替えの片側）
      s["items.0"] = { id: 9 };
      s["items.1"] = { id: 8 };
    });
    // 揃わないまま: 行はブロックを保って位置どおり
    expect(view(shadowRoot, stateEl)).toEqual(expected(9, 8, 3, 3));
    expect(Array.from(shadowRoot.querySelectorAll("li"))).toEqual(blocks);
    await step(stateEl, (s) => { s["items.2"] = four; });
    expect(view(shadowRoot, stateEl)).toEqual(expected(9, 8, 4, 3));
    // 揃った: 4 と 3 の行が入れ替わる。新しい値の行は、その位置のブロックがその場で受ける
    expect(Array.from(shadowRoot.querySelectorAll("li"))).toEqual([blocks[0], blocks[1], blocks[3], blocks[2]]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });
});

/** 出力専用のメンバー `status`。最初はどのインスタンスも `initial`、`report(v)` で自分の値を出す */
function defineReporter(initial: unknown): string {
  const tag = `x-swap-ledger-job-${++tagSeq}`;
  const reported = new WeakMap<HTMLElement, unknown>();
  customElements.define(tag, class extends HTMLElement {
    static wcBindable = {
      protocol: "wc-bindable",
      version: 1,
      properties: [{ name: "status", event: `${tag}:status` }],
    };
    get status(): unknown { return reported.has(this) ? reported.get(this) : initial; }
    report(value: unknown): void {
      reported.set(this, value);
      this.dispatchEvent(new CustomEvent(`${tag}:status`, { detail: value }));
    }
  });
  return tag;
}

describe("要素が自分の行へ出す値は、その行の値の更新（#337）", () => {
  async function mountJobs(rows: unknown[], tag: string) {
    const mounted = await mount({ rows }, `<ul><template data-wcs="for: rows"><li><${tag} data-wcs="status: ."></${tag}><span>{{ . }}</span><i>{{ $1 }}</i></li></template></ul>`);
    await flush();
    const elements = Array.from(mounted.shadowRoot.querySelectorAll(tag)) as (HTMLElement & { report(value: unknown): void })[];
    const blocks = Array.from(mounted.shadowRoot.querySelectorAll("li"));
    /** 各要素がいまどの `<li>` にいるか */
    const positions = () => elements.map((element) => blocks.indexOf(element.closest("li")!));
    return { ...mounted, elements, blocks, positions };
  }

  it("同じ値から進む行の要素が 1 つずつ値を出しても、行は入れ替わらず、以後の出力も自分の行に届くこと", async () => {
    const errors = spyErrors();
    const tag = defineReporter("idle");
    const { host, shadowRoot, stateEl, elements, blocks, positions } = await mountJobs(["a", "b", "c", "d"], tag);
    expect(read(stateEl, (s: any) => [...s.rows])).toEqual(["idle", "idle", "idle", "idle"]);

    for (const element of elements) {
      element.report("done");
      await flush();
    }
    // 修理前: 状態は done, done, done, idle、要素の位置は 3, 1, 2, 0
    expect(read(stateEl, (s: any) => [...s.rows])).toEqual(["done", "done", "done", "done"]);
    expect(positions()).toEqual([0, 1, 2, 3]);
    expect(Array.from(shadowRoot.querySelectorAll("li"))).toEqual(blocks);
    expect(texts(shadowRoot, "i")).toEqual(["0", "1", "2", "3"]);

    elements[0].report("error");
    await flush();
    // 修理前: 行 3 が error
    expect(read(stateEl, (s: any) => [...s.rows])).toEqual(["error", "done", "done", "done"]);
    expect(texts(shadowRoot, "span")).toEqual(["error", "done", "done", "done"]);
    expect(errors).not.toHaveBeenCalled();
    host.remove();
  });

  it("要素が別の行の値を出しても、その値は自分の行に着地し、別の要素の値も消えないこと", async () => {
    const tag = defineReporter("idle");
    const { host, shadowRoot, stateEl, elements, blocks, positions } = await mountJobs(["a", "b", "c"], tag);

    elements[0].report("b");
    await flush();
    elements[1].report("a");
    await flush();
    // 修理前: ["b", "idle", "idle"]（要素 1 の "a" が消える）
    expect(read(stateEl, (s: any) => [...s.rows])).toEqual(["b", "a", "idle"]);
    expect(texts(shadowRoot, "span")).toEqual(["b", "a", "idle"]);
    expect(positions()).toEqual([0, 1, 2]);
    expect(Array.from(shadowRoot.querySelectorAll("li"))).toEqual(blocks);
    host.remove();
  });

  it("プリミティブの一覧を input で編集し、別の行の値を打っても、入力中の欄は自分の行に留まること", async () => {
    const { host, shadowRoot, stateEl } = await mount({ tags: ["ab", "a", "c"] },
      `<ul><template data-wcs="for: tags"><li><input data-wcs="value: ."><i>{{ $1 }}</i></li></template></ul>`);
    const inputs = Array.from(shadowRoot.querySelectorAll("input"));
    const type = (input: HTMLInputElement, value: string) => {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };

    type(inputs[0], "a"); // 行 1 と同じ値
    await flush();
    type(inputs[1], "ab"); // 入れ替えの後半と区別できない値
    await flush();
    expect(read(stateEl, (s: any) => [...s.tags])).toEqual(["a", "ab", "c"]);
    // 修理前: 入力中の欄（行 1）が位置 0 へ移った
    expect(Array.from(shadowRoot.querySelectorAll("input"))).toEqual(inputs);
    expect(inputs.map((input) => input.value)).toEqual(["a", "ab", "c"]);
    expect(texts(shadowRoot, "i")).toEqual(["0", "1", "2"]);
    host.remove();
  });

  it("コードの入れ替えの途中で行の要素が値を出しても、その行は後で揃う入れ替えに巻き込まれないこと", async () => {
    const { host, shadowRoot, stateEl } = await mount({ tags: ["a", "b", "c"] },
      `<ul><template data-wcs="for: tags"><li><input data-wcs="value: ."><i>{{ $1 }}</i></li></template></ul>`);
    const inputs = Array.from(shadowRoot.querySelectorAll("input"));

    await step(stateEl, (s) => { s["tags.1"] = s["tags.0"]; }); // a が位置 0 と 1 に残る（入れ替えの片側）
    inputs[2].value = "b"; // 行 2 の欄に、書き込む前に行 1 にあった値を打つ
    inputs[2].dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    await step(stateEl, (s) => { s["tags.0"] = "z"; }); // a が位置 1 へ動いたことになり、入れ替えが揃う
    expect(read(stateEl, (s: any) => [...s.tags])).toEqual(["z", "a", "b"]);
    // 行 2 は値を更新しただけ。行 2 の欄が書き込む前の b の行と取り違えられると、打った欄が消えた
    expect(Array.from(shadowRoot.querySelectorAll("input"))[2]).toBe(inputs[2]);
    expect(Array.from(shadowRoot.querySelectorAll("input"))[1]).toBe(inputs[0]);
    expect(Array.from(shadowRoot.querySelectorAll("input")).map((input) => input.value)).toEqual(["z", "a", "b"]);
    expect(texts(shadowRoot, "i")).toEqual(["0", "1", "2"]);
    host.remove();
  });

  it("行の要素が同じオブジェクトから進んでも、行の下の束縛が自分の行の新しい値を映し、行は動かないこと", async () => {
    const idle = { name: "idle" };
    const done = { name: "done" };
    const tag = defineReporter(idle);
    const { host, shadowRoot, stateEl } = await mount({ rows: [{ name: "a" }, { name: "b" }, { name: "c" }] },
      `<ul><template data-wcs="for: rows"><li><${tag} data-wcs="status: ."></${tag}><b>{{ .name }}</b><i>{{ $1 }}</i></li></template></ul>`);
    await flush();
    const elements = Array.from(shadowRoot.querySelectorAll(tag)) as (HTMLElement & { report(value: unknown): void })[];
    const blocks = Array.from(shadowRoot.querySelectorAll("li"));
    expect(texts(shadowRoot, "b")).toEqual(["idle", "idle", "idle"]);

    for (const element of elements) {
      element.report(done);
      await flush();
    }
    elements[0].report({ name: "error" });
    await flush();
    expect(texts(shadowRoot, "b")).toEqual(["error", "done", "done"]);
    expect(read(stateEl, (s: any) => s.rows.map((row: any) => row.name))).toEqual(["error", "done", "done"]);
    expect(texts(shadowRoot, "i")).toEqual(["0", "1", "2"]);
    expect(Array.from(shadowRoot.querySelectorAll("li"))).toEqual(blocks);
    host.remove();
  });
});
