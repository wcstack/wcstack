/**
 * integration.elementSwapUnsettled.test.ts — 要素の書き込みの入れ替えが揃わない間の行（#359・#361）。
 *
 * 入れ替えが揃うまで、行はブロックを保ったまま位置どおりの値を映す（揃う前の台帳は書き込む前の行のまま —
 * setByAddress の matchSwappedListIndexes）。その間の行は「自分の要素ではない値を映している行」になる。
 *
 * #359: 前に代入していた配列そのものへ戻すと、その配列の台帳は同じ行オブジェクトを持っていて、差分は行の同一性
 * だけで突き合わせる（createListDiff の calcDiffIndexes）。行は同じ位置に居るので「変わらない」とされ、書いた
 * 位置の行は写した値を映したまま残った（状態は戻した配列の値）。以後その行は直らなかった。
 * 修理: 行がその場で映す要素を替えたとき（揃わない書き込み・行の要素から来た書き込み）に行へ憶えさせ、差分が
 * 憶えていた要素と違う行を拾い、依存ウォークが行ごと描き直す（createListDiff の syncListIndexes）。
 *
 * #361: 入れ替えを 2 つのバッチに分けると、揃ったバッチの書き込みは書いた位置の行（まだ揃う前の行）のアドレスで
 * 着地し、揃うとその行は値に付いて前のバッチで書いた位置へ動く。`$watch("items.*")` は前のバッチで通知済みの
 * 位置で呼ばれ、書いた位置の変化は届かなかった。
 * 修理: 揃った書き込みの着地を、書いた位置にいま居る行にする（その行がこのバッチの揃う前の書き込みで着地済み
 * なら書いた行のまま — 1 つのバッチで揃う入れ替えは今までどおり）。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { flush, makeMount, read, write } from "./helpers/recursionTestUtils";

beforeAll(() => {
  bootstrapState();
});

const mount = makeMount("swap-unsettled-host");

let errorSpy: ReturnType<typeof vi.spyOn> | null = null;
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
const UL_PRIMITIVE = `<ul><template data-wcs="for: items"><li><b>{{ . }}</b><i>{{ $1 }}</i></li></template></ul>`;

async function step(stateEl: State, fn: (s: any) => void): Promise<void> {
  write(stateEl, fn);
  await flush();
}

/** 描いた値・`$1`・状態を 1 度に見る */
function view(shadowRoot: ShadowRoot, stateEl: State, label: (item: any) => string): { drawn: string[]; rows: string[]; state: string[] } {
  return {
    drawn: texts(shadowRoot, "li > b"),
    rows: texts(shadowRoot, "li > i"),
    state: read(stateEl, (s: any) => s.items.map(label)),
  };
}
const expected = (...values: (string | number)[]) => ({
  drawn: values.map(String),
  rows: values.map((_, i) => String(i)),
  state: values.map(String),
});

describe("入れ替えが揃わないうちに前の配列へ戻す（#359）", () => {
  type Variant = "object" | "primitive" | "halfSwap" | "filterBetween";
  const cases: { variant: Variant; restored: (string | number)[]; written: (string | number)[] }[] = [
    { variant: "object", restored: [1, 2, 3], written: [1, 9, 3] },
    { variant: "primitive", restored: ["a", "b", "c"], written: ["a", "z", "c"] },
    // 入れ替えの前半（控えを取ってから片側を書く）
    { variant: "halfSwap", restored: [1, 2, 3], written: [1, 9, 3] },
    // 揃わない書き込みの後、戻す前に一覧を別の配列（filter）にする
    { variant: "filterBetween", restored: [1, 2, 3], written: [1, 9, 3] },
  ];
  for (const { variant, restored, written } of cases) {
    it(`${variant}: 戻した配列の値が描かれ、以後の書き込みも位置どおりに描かれること`, async () => {
      const errors = spyErrors();
      const primitive = variant === "primitive";
      const label = (item: any): string => String(primitive ? item : item.id);
      const { host, shadowRoot, stateEl } = await mount(
        { items: primitive ? ["a", "b", "c"] : [{ id: 1 }, { id: 2 }, { id: 3 }] },
        primitive ? UL_PRIMITIVE : UL,
      );
      let saved: unknown;
      let held: unknown;
      await step(stateEl, (s) => { saved = s.items; s.items = [...s.items, primitive ? "d" : { id: 4 }]; });
      await step(stateEl, (s) => {
        if (variant === "halfSwap") {
          held = s["items.0"];
        }
        s["items.0"] = s["items.2"]; // 入れ替えの片側だけ（揃わない）
      });
      expect(held === undefined).toBe(variant !== "halfSwap");
      expect(view(shadowRoot, stateEl, label)).toEqual(expected(...(primitive ? ["c", "b", "c", "d"] : [3, 2, 3, 4])));
      if (variant === "filterBetween") {
        await step(stateEl, (s) => { s.items = s.items.filter((item: any) => item.id !== 2); });
        expect(view(shadowRoot, stateEl, label)).toEqual(expected(3, 3, 4));
      }

      await step(stateEl, (s) => { s.items = saved; }); // 前の配列そのものに戻す
      expect(view(shadowRoot, stateEl, label)).toEqual(expected(...restored)); // 修理前: 書いた位置の行が 3（c）のまま
      await step(stateEl, (s) => { s["items.1"] = primitive ? "z" : { id: 9 }; });
      expect(view(shadowRoot, stateEl, label)).toEqual(expected(...written)); // 修理前: 3,9,3（c,z,c）
      expect(errors).not.toHaveBeenCalled();
      host.remove();
    });
  }

  it("戻した配列から揃わない配列へもう一度戻しても位置どおりに描かれ、そこで揃えればブロックが値と一緒に動くこと", async () => {
    const watched: unknown[] = [];
    const { host, shadowRoot, stateEl } = await mount({
      items: [{ id: 1 }, { id: 2 }, { id: 3 }],
      $watch: { "items.*"(current: any, _previous: unknown, index: number) { watched.push([current.id, index]); } },
    }, UL);
    const label = (item: any): string => String(item.id);
    await flush();
    let saved: unknown;
    let unsettled: unknown;
    let first: unknown;
    await step(stateEl, (s) => { saved = s.items; s.items = [...s.items, { id: 4 }]; unsettled = s.items; });
    const blocks = Array.from(shadowRoot.querySelectorAll("li"));
    await step(stateEl, (s) => { first = s["items.0"]; s["items.0"] = s["items.2"]; });
    watched.length = 0;

    await step(stateEl, (s) => { s.items = saved; });
    expect(view(shadowRoot, stateEl, label)).toEqual(expected(1, 2, 3));
    // 要素が替わった位置だけが着地する（行 0 は 3 → 1。行 1・2 は変わっていない）
    expect(watched).toEqual([[1, 0]]);
    watched.length = 0;

    await step(stateEl, (s) => { s.items = unsettled; });
    expect(view(shadowRoot, stateEl, label)).toEqual(expected(3, 2, 3, 4));
    expect(watched).toEqual([[3, 0], [4, 3]]);
    watched.length = 0;

    await step(stateEl, (s) => { s["items.2"] = first; }); // ここで入れ替えが揃う
    expect(view(shadowRoot, stateEl, label)).toEqual(expected(3, 2, 1, 4));
    expect(Array.from(shadowRoot.querySelectorAll("li")), "ブロックが値と一緒に動く")
      .toEqual([blocks[2], blocks[1], blocks[0], blocks[3]]);
    expect(watched).toEqual([[1, 2]]);
    host.remove();
  });

  it("行の中の input が自分の行へ書いた後で前の配列へ戻しても、戻した配列の値が描かれること", async () => {
    const { host, shadowRoot, stateEl } = await mount(
      { items: ["a", "b", "c"] },
      `<ul><template data-wcs="for: items"><li><input data-wcs="value: ."><span>{{ . }}</span></li></template></ul>`,
    );
    let saved: unknown;
    await step(stateEl, (s) => { saved = s.items; s.items = [...s.items, "d"]; });
    const input = shadowRoot.querySelector("input") as HTMLInputElement;
    input.value = "x";
    input.dispatchEvent(new Event("input"));
    await flush();
    expect(texts(shadowRoot, "span")).toEqual(["x", "b", "c", "d"]);

    await step(stateEl, (s) => { s.items = saved; });
    expect(read(stateEl, (s: any) => [...s.items])).toEqual(["a", "b", "c"]);
    expect(texts(shadowRoot, "span")).toEqual(["a", "b", "c"]); // 修理前: x, b, c
    expect(Array.from(shadowRoot.querySelectorAll("input")).map((element) => element.value)).toEqual(["a", "b", "c"]);
    host.remove();
  });
});

describe("入れ替えを 2 つのバッチに分ける（#361）", () => {
  it("揃ったバッチの $watch(\"items.*\") が書いた位置で呼ばれること（対照: 1 つのバッチ）", async () => {
    const watched: unknown[] = [];
    const { host, shadowRoot, stateEl } = await mount({
      items: [{ id: 1 }, { id: 2 }, { id: 3 }],
      $watch: { "items.*"(current: any, previous: unknown, index: number) { watched.push([current.id, previous, index]); } },
    }, UL);
    const label = (item: any): string => String(item.id);
    await flush();
    let first: unknown;
    await step(stateEl, (s) => { first = s["items.0"]; s["items.0"] = s["items.2"]; });
    expect(watched).toEqual([[3, undefined, 0]]);
    watched.length = 0;

    await step(stateEl, (s) => { s["items.2"] = first; });
    expect(view(shadowRoot, stateEl, label)).toEqual(expected(3, 2, 1));
    expect(watched).toEqual([[1, undefined, 2]]); // 修理前: [[3, undefined, 0]]（前のバッチで通知済みの位置と値）
    watched.length = 0;

    // 対照: 同じ入れ替えを 1 つのバッチで書くと、書いた 2 つの位置で 1 回ずつ
    await step(stateEl, (s) => { const zero = s["items.0"]; s["items.0"] = s["items.2"]; s["items.2"] = zero; });
    expect(view(shadowRoot, stateEl, label)).toEqual(expected(1, 2, 3));
    expect(watched).toEqual([[1, undefined, 0], [3, undefined, 2]]);
    host.remove();
  });

  it("行の下のパスの $watch(\"items.*.id\") も書いた位置で呼ばれること", async () => {
    const watched: unknown[] = [];
    const { host, stateEl } = await mount({
      items: [{ id: 1 }, { id: 2 }, { id: 3 }],
      $watch: { "items.*.id"(current: unknown, _previous: unknown, index: number) { watched.push([current, index]); } },
    }, UL);
    await flush();
    let first: unknown;
    await step(stateEl, (s) => { first = s["items.0"]; s["items.0"] = s["items.2"]; });
    expect(watched).toEqual([[3, 0]]);
    watched.length = 0;
    await step(stateEl, (s) => { s["items.2"] = first; });
    expect(watched).toEqual([[1, 2]]); // 修理前: [[3, 0]]
    host.remove();
  });

  it("プリミティブの一覧: 揃ったバッチの prev は書いた位置のバッチ前の値", async () => {
    const watched: unknown[] = [];
    const { host, shadowRoot, stateEl } = await mount({
      items: ["a", "b", "c"],
      $watch: { "items.*"(current: unknown, previous: unknown, index: number) { watched.push([current, previous, index]); } },
    }, UL_PRIMITIVE);
    await flush();
    let first: unknown;
    await step(stateEl, (s) => { first = s["items.0"]; s["items.0"] = s["items.2"]; });
    expect(watched).toEqual([["c", "a", 0]]);
    watched.length = 0;
    await step(stateEl, (s) => { s["items.2"] = first; });
    expect(texts(shadowRoot, "li > b")).toEqual(["c", "b", "a"]);
    expect(watched).toEqual([["a", "c", 2]]); // 修理前: [["c", "c", 0]]
    host.remove();
  });

  it("3 つのバッチに分けた巡回でも、各バッチは書いた位置で呼ばれ、揃えばブロックが値と一緒に動くこと", async () => {
    const watched: unknown[] = [];
    const { host, shadowRoot, stateEl } = await mount({
      items: ["a", "b", "c"],
      $watch: { "items.*"(current: unknown, previous: unknown, index: number) { watched.push([current, previous, index]); } },
    }, UL_PRIMITIVE);
    await flush();
    const blocks = Array.from(shadowRoot.querySelectorAll("li"));
    await step(stateEl, (s) => { s["items.0"] = "c"; });
    await step(stateEl, (s) => { s["items.1"] = "a"; });
    expect(watched).toEqual([["c", "a", 0], ["a", "b", 1]]);
    watched.length = 0;
    await step(stateEl, (s) => { s["items.2"] = "b"; }); // ここで揃う
    expect(watched).toEqual([["b", "c", 2]]); // 修理前: [["c", "c", 0]]
    expect(texts(shadowRoot, "li > b")).toEqual(["c", "a", "b"]);
    expect(texts(shadowRoot, "li > i")).toEqual(["0", "1", "2"]);
    expect(Array.from(shadowRoot.querySelectorAll("li")), "ブロックが値と一緒に動く")
      .toEqual([blocks[2], blocks[0], blocks[1]]);
    host.remove();
  });
});

describe("1 つのバッチで、揃う前の書き込みの後に入れ替えを揃える（#361 の修理の続き）", () => {
  // 揃う前の書き込みはその時点で位置に居た行に着地する。揃えた書き込みが新しい値を入れて、その行が押し出されたり
  // 動いたりしても、揃う前に書いた位置は、いまそこに居る行で着地する
  it("前の位置の値を写してから、その位置へ新しい値を書く: 書いた 2 つの位置で呼ばれること", async () => {
    const watched: unknown[] = [];
    const { host, shadowRoot, stateEl } = await mount({
      items: [{ id: 1 }, { id: 2 }, { id: 3 }],
      $watch: { "items.*"(current: any, _previous: unknown, index: number) { watched.push([current.id, index]); } },
    }, UL);
    await flush();
    await step(stateEl, (s) => { s["items.1"] = s["items.0"]; s["items.0"] = { id: 9 }; });
    expect(view(shadowRoot, stateEl, (item: any) => String(item.id))).toEqual(expected(9, 1, 3));
    expect(watched).toEqual([[9, 0], [1, 1]]); // 修理（#361 の最初の修理）前: [[9, 0]]
    watched.length = 0;
    await step(stateEl, (s) => { s["items.2"] = s["items.0"]; s["items.0"] = { id: 8 }; });
    expect(view(shadowRoot, stateEl, (item: any) => String(item.id))).toEqual(expected(8, 1, 9));
    expect(watched).toEqual([[8, 0], [9, 2]]);
    host.remove();
  });

  it("プリミティブ: 同じ値を写してから別の位置へ新しい値を書く", async () => {
    const watched: unknown[] = [];
    const { host, stateEl } = await mount({
      items: ["0", "1", "2", "1"],
      $watch: { "items.*"(current: unknown, _previous: unknown, index: number) { watched.push([current, index]); } },
    }, UL_PRIMITIVE);
    await flush();
    await step(stateEl, (s) => { s["items.0"] = "1"; s["items.3"] = "3"; });
    expect(read(stateEl, (s: any) => [...s.items])).toEqual(["1", "1", "2", "3"]);
    expect(watched).toEqual([["1", 0], ["3", 3]]); // 修理前: [["3", 3]]
    host.remove();
  });

  it("$scan の from も同じ位置で畳むこと", async () => {
    const { host, stateEl } = await mount({
      items: [{ id: 1 }, { id: 2 }, { id: 3 }],
      $scan: { hist: { from: "items.*", initial: [], fold: (acc: unknown[], current: any, _previous: unknown, index: number) => [...acc, [current.id, index]] } },
    }, UL);
    await flush();
    await step(stateEl, (s) => { s["items.1"] = s["items.0"]; s["items.0"] = { id: 9 }; });
    await flush();
    expect(read(stateEl, (s: any) => s.hist)).toEqual([[9, 0], [1, 1]]); // 修理前: [[9, 0]]
    host.remove();
  });
});

describe("同じバッチで一覧を代入してから、その配列にだけ居た行が消える（$watch の位置の確かめ）", () => {
  // 差分が退役させるのはバッチの始まりの並びから外した行だけで、途中の配列で足した行・要素の書き込みが作った行は、
  // その配列を置き換えても退役しない。`$watch` がその行のアドレスを添字で読むと範囲外で throw した
  const cases: [string, unknown[], string, (s: any) => void, unknown[]][] = [
    // 修理（#361 の最初の修理）前は、押し出した行の着地が位置の確かめを引き起こして投げなかった
    ["途中の配列で要素を書き、空にする", [{ id: 1 }, { id: 2 }], UL,
      (s) => { s.items = s.items.filter((_: unknown, k: number) => k !== 1); s["items.0"] = { id: 10 }; s.items = []; }, []],
    ["途中の配列で行を足し、置き換えてから要素を書く", ["0", "1", "2"], UL_PRIMITIVE,
      (s) => { s.items = [...s.items, "3"]; s.items = ["2"]; s["items.0"] = "1"; }, [["1", 0]]],
    // 修正前（main）でも投げていた形
    ["途中の配列で行を足し、先頭を取り除く", [{ id: 1 }, { id: 2 }], UL,
      (s) => { s.items = [...s.items, { id: 3 }]; s.items = s.items.filter((_: unknown, k: number) => k !== 0); }, [[3, 1]]],
  ];
  for (const [name, items, markup, fn, landed] of cases) {
    it(`${name}: 投げずに、いまの並びの位置だけで呼ばれること`, async () => {
      const errors = spyErrors();
      const watched: unknown[] = [];
      const { host, stateEl } = await mount({
        items,
        $watch: { "items.*"(current: any, _previous: unknown, index: number) { watched.push([typeof current === "object" ? current.id : current, index]); } },
      }, markup);
      await flush();
      await step(stateEl, fn);
      await flush();
      expect(errors).not.toHaveBeenCalled(); // 修理前: `ListIndex not found at index N of items`
      expect(watched).toEqual(landed);
      host.remove();
    });
  }
});

describe("要素のパスの setter が書いてから投げる", () => {
  it("書いた値は描かれ、$watch も呼ばれること（#361 の最初の修理で通知が抜けていた）", async () => {
    const watched: unknown[] = [];
    const { host, shadowRoot, stateEl } = await mount({
      items: [{ id: 1 }, { id: 2 }, { id: 3 }],
      get "items.*"() { return this.items[this.$1]; },
      set "items.*"(value: any) {
        this.items[this.$1] = value;
        if (value.id === 9) {
          throw new Error("rejected after write");
        }
      },
      $watch: { "items.*"(current: any, _previous: unknown, index: number) { watched.push([current.id, index]); } },
    }, `<ul><template data-wcs="for: items"><li>{{ .id }}</li></template></ul>`);
    await flush();
    expect(() => write(stateEl, (s: any) => { s["items.1"] = { id: 9 }; })).toThrow("rejected after write");
    await flush();
    await flush();
    expect(texts(shadowRoot, "li")).toEqual(["1", "9", "3"]);
    expect(watched).toEqual([[9, 1]]);
    host.remove();
  });
});

describe("$setAll の途中で入れ替えが揃う", () => {
  // $setAll は書き込み先を先に確定する（第 1 相）。要素そのもの（`items.*`）へ書くと、先の書き込みが揃う前の入れ替えを
  // 揃えて行が値に付いて動くので、確定した行は別の位置に居て、同じ位置に 2 回書き、書かない位置が残った（修正前も同じ）
  it("揃わない入れ替えが残る一覧へブロードキャストしても、全部の位置に書くこと", async () => {
    const { host, shadowRoot, stateEl } = await mount({ items: [{ id: 1 }, { id: 3 }] }, UL);
    const label = (item: any): string => String(item.id);
    await step(stateEl, (s) => { s.items = [...s.items, { id: 100 }]; s["items.2"] = s["items.0"]; });
    await step(stateEl, (s) => { const first = s["items.0"]; s["items.0"] = s["items.1"]; s["items.1"] = first; });
    expect(view(shadowRoot, stateEl, label)).toEqual(expected(3, 1, 1));
    await step(stateEl, (s) => { s["items.2"] = s["items.0"]; s.$setAll("items.*", [], { id: 9 }); });
    expect(view(shadowRoot, stateEl, label)).toEqual(expected(9, 9, 9)); // 修正前: 9, 1, 9
    host.remove();
  });
});
