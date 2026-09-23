/**
 * ボリュームの注入口（要件 B14③・docs/state-3x-plan.ja.md D28〜D33）。
 * `<wcs-state mount="cart" data-wcs="state.taxRate: settings.taxRate">` で、ボリュームのコード
 * （getter・メソッド・$watch・ライフサイクル）の `this.taxRate` がルートの `settings.taxRate` になること、
 * 明示した注入が自前の既定値に勝つこと、`#ro`、`$updatedCallback` の相対配送、宣言の検査を固定する。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElement } from "../src/stateElementByName";
import { readVolumeInjections } from "../src/webComponent/volume";
import { getParseBindTextResults } from "../src/bindings/getParseBindTextResults";
import { createVolumeChroot, relativeVolumePath, translateVolumePath } from "../src/webComponent/volumeShared";
import { findMountEntry } from "../src/webComponent/mountEntries";
import { getPathInfo } from "../src/address/PathInfo";

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));
let counter = 0;

async function mountPage(inject: string, volumeState: Record<string, any>, rootState: Record<string, any>, body = "") {
  const host = document.createElement(`vol-inject-host-${++counter}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML =
    `<wcs-state mount="cart" data-wcs="${inject}"></wcs-state>` +
    `<wcs-state></wcs-state>` +
    `<span id="total" data-wcs="textContent: cart.total"></span>` + body;
  document.body.appendChild(host);
  const volumeElement = shadowRoot.querySelector("wcs-state[mount]") as State;
  const rootElement = shadowRoot.querySelector("wcs-state:not([mount])") as State;
  rootElement.setInitialState(rootState);
  volumeElement.setInitialState(volumeState);
  await rootElement.connectedCallbackPromise;
  await volumeElement.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  await flush();
  await flush();
  const stateElement = getStateElement(shadowRoot)!;
  const write = async (fn: (s: any) => void) => { stateElement.createState("writable", fn); await flush(); };
  const read = <T,>(fn: (s: any) => T): T => { let out!: T; stateElement.createState("readonly", (s: any) => { out = fn(s); }); return out; };
  const text = (selector: string) => (shadowRoot.querySelector(selector) as HTMLElement).textContent;
  return { host, shadowRoot, write, read, text };
}

describe("ボリュームの注入口（B14③）", () => {
  it("ボリュームの getter が注入したルートのパスを読み、その変化に追従すること", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { host, write, text } = await mountPage(
      "state.taxRate: settings.taxRate",
      { subtotal: 100, get total(this: any) { return Math.round(this.subtotal * (1 + this.taxRate)); } },
      { settings: { taxRate: 0.1 } },
    );
    expect(text("#total")).toBe("110");
    await write((s) => { s["settings.taxRate"] = 0.2; });
    expect(text("#total")).toBe("120");
    // ボリューム要素の `state.*` はルートの束縛にならない（無い `state` プロパティへの適用失敗を出さない）
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
    host.remove();
  });

  it("明示した注入が自前の既定値に勝ち、そのキーは接ぎ木されないこと（D30）", async () => {
    const { host, read, text } = await mountPage(
      "state.taxRate: settings.taxRate",
      { subtotal: 100, taxRate: 0, get total(this: any) { return Math.round(this.subtotal * (1 + this.taxRate)); } },
      { settings: { taxRate: 0.5 } },
    );
    expect(text("#total")).toBe("150");
    expect(read((s) => s["cart.subtotal"])).toBe(100);
    expect(read((s) => s["cart.taxRate"])).toBeUndefined();
    host.remove();
  });

  it("メソッドからの書き込みは注入先のルートのパスに届き、$getAll / $resolve / $postUpdate も翻訳されること", async () => {
    const { host, read } = await mountPage(
      "state.rate: settings.rate; state.rows: settings.rows",
      {
        seen: null as unknown,
        $connectedCallback(this: any) {
          this.rate = 3;
          this.$setAll("rows.*.n", [], 7);
          this.$resolve("rows.*.n", [1], 9);
          this.seen = [this.$getAll("rows.*.n", []), this.$resolve("rows.*.n", [0])];
          this.$postUpdate("rate");
        },
      },
      { settings: { rate: 1, rows: [{ n: 1 }, { n: 2 }] } },
    );
    expect(read((s) => s["settings.rate"])).toBe(3);
    expect(read((s) => s["settings.rows"]).map((r: { n: number }) => r.n)).toEqual([7, 9]);
    expect(read((s) => s["cart.seen"])).toEqual([[7, 9], 7]);
    host.remove();
  });

  it("#ro の注入は読めるが、書き込み・$setAll・書きの $resolve は [wcs/mount-readonly] で拒否されること（D31）", async () => {
    const outcomes: string[] = [];
    const attempt = (fn: () => void) => {
      try { fn(); outcomes.push("ok"); } catch (error) { const m = String((error as Error).message); outcomes.push(m.includes("[wcs/mount-readonly]") ? "ro" : "other:" + m); }
    };
    const { host, read } = await mountPage(
      "state.rows#ro: settings.rows",
      {
        count: 0,
        $connectedCallback(this: any) {
          this.count = this.rows.length;
          attempt(() => { this.rows = []; });
          attempt(() => { this.$setAll("rows.*.n", [], 0); });
          // 読みは通る（$resolve の読みはリストの index 台帳を要るので、先に $getAll で作る）
          attempt(() => { this.$getAll("rows.*.n", []); });
          attempt(() => { this.$resolve("rows.*.n", [0], 0); });
          attempt(() => { this.$resolve("rows.*.n", [0]); });
        },
      },
      { settings: { rows: [{ n: 1 }] } },
    );
    expect(outcomes).toEqual(["ro", "ro", "ok", "ro", "ok"]);
    expect(read((s) => s["cart.count"])).toBe(1);
    expect(read((s) => s["settings.rows"])).toEqual([{ n: 1 }]);
    host.remove();
  });

  it("注入したキーの $watch はルートのパスの変化で発火し、ハンドラの this もボリューム相対であること", async () => {
    const fired: unknown[] = [];
    const { host, write } = await mountPage(
      "state.taxRate: settings.taxRate",
      {
        subtotal: 100,
        get total(this: any) { return this.subtotal; },
        $watch: {
          taxRate(this: any, cur: unknown) { fired.push([cur, this.taxRate, this.subtotal]); },
        },
      },
      { settings: { taxRate: 0.1 } },
    );
    await write((s) => { s["settings.taxRate"] = 0.3; });
    expect(fired).toContainEqual([0.3, 0.3, 100]);
    host.remove();
  });

  it("$updatedCallback は注入したパスの更新を内側の名前で受けること（D33）", async () => {
    const received: string[][] = [];
    const { host, write } = await mountPage(
      "state.taxRate: settings.taxRate",
      {
        subtotal: 100,
        get total(this: any) { return this.subtotal; },
        $updatedCallback(this: any, paths: string[]) { received.push([...paths].sort()); },
      },
      { settings: { taxRate: 0.1 }, other: 1 },
      `<i data-wcs="textContent: settings.taxRate"></i><b data-wcs="textContent: other"></b>`,
    );
    await write((s) => { s["settings.taxRate"] = 0.4; s["cart.subtotal"] = 200; s.other = 2; });
    expect(received.flat()).toContain("taxRate");
    expect(received.flat()).not.toContain("other");
    host.remove();
  });
});

describe("注入口の宣言の検査", () => {
  it("state.<key> の 1 段・静的なパス・#ro だけ・フィルタ無し・重複無しを受け付けること", () => {
    const entries = readVolumeInjections("state.b#ro: x.b; state.a: x.a; title: t", "cart");
    expect(entries.map((e) => [e.innerSegments.join("."), e.outerPathInfo.path, e.readonly])).toEqual([
      ["b", "x.b", true],
      ["a", "x.a", false],
    ]);
    expect(readVolumeInjections("", "cart")).toEqual([]);
  });

  it.each([
    ["state: settings", /one key at a time/],
    ["state.a.b: settings.a", /one key at a time/],
    ["state.$x: settings.a", /one key at a time/],
    ["state.a: items.*.name", /static path/],
    ["state.a: $1", /static path/],
    ["state.a: settings.a|uc", /no filters/],
    ["state.a|number: settings.a", /no filters/],
    ["state.a#onchange: settings.a", /only #ro/],
    ["state.a: settings.a; state.a: settings.b", /twice/],
  ])("%s を [wcs/mount-path-invalid] で拒否すること", (bindText, message) => {
    expect(() => readVolumeInjections(bindText, "cart")).toThrow(message);
    expect(() => readVolumeInjections(bindText, "cart")).toThrow(/\[wcs\/mount-path-invalid\]/);
  });

  it("内側キーは必ず 1 段で、同じ長さの中では宣言順が保たれること（D28）", () => {
    // `readVolumeInjections` は戻り値を長さ降順にソートするが、D28 が内側キーを 1 段に
    // 限っている間はどれも長さ 1 なので、ソートの有無で結果は変わらない（＝この場から
    // ソートの番人は作れない）。ここが固定するのは D28 の制限と、安定ソートであること。
    // ソート自体は D28 を緩めたときに `findMountEntry` の最長一致が宣言順に依存しないための
    // 予防で、最長一致そのものの番人は `mountEntries` を直接使う下の 2 件
    const entries = readVolumeInjections("state.a: x.a; state.b: x.b; state.c: x.c", "cart");
    expect(entries.map((e) => e.innerSegments.length)).toEqual([1, 1, 1]);
    expect(entries.map((e) => e.innerSegments[0])).toEqual(["a", "b", "c"]);
    expect(() => readVolumeInjections("state.a.b: x.a", "cart")).toThrow(/one key at a time/);
  });

  it("findMountEntry は内側接頭辞の長い順に並んだ表で最長一致すること（ソートが守る契約）", () => {
    // 深いエントリを含む表を直に組み、「長い順なら最長一致・そうでなければ取り違える」ことを
    // 固定する。`readVolumeInjections` のソートはこの前提を満たすためにある
    const deep = { innerSegments: ["a", "b"], outerPathInfo: getPathInfo("outer.b"), readonly: false };
    const shallow = { innerSegments: ["a"], outerPathInfo: getPathInfo("outer.a"), readonly: false };
    expect(findMountEntry([deep, shallow], ["a", "b", "c"])).toBe(deep);
    // 短い順に並べると先頭一致で取り違える（ソートしない表の姿）
    expect(findMountEntry([shallow, deep], ["a", "b", "c"])).toBe(shallow);
  });

  it("パーサ自身の診断にも要素名と mount= の文脈を付けること", () => {
    // `**` は注入の検査より前にパーサが落とす。素のままでは「どの要素のどの属性か」が出ない
    expect(() => readVolumeInjections("state.a: tree.**.x", "cart"))
      .toThrow(/\[wcs\/mount-path-invalid\] <wcs-state mount="cart"> has an invalid data-wcs:/);
    expect(() => readVolumeInjections("state.a: tree.**.x", "cart")).toThrow(/recursion/);
  });

  it("空のキー（`state.:`）は解析の段の左辺検査で落ちること", () => {
    // 空のセグメントは注入の宣言としてではなく、左辺の書き間違いとして
    // `[wcs/binding-syntax]` で落ちる（bindTextParser/parsePropPart.ts）
    expect(() => readVolumeInjections("state.: settings.a", "cart"))
      .toThrow(/\[wcs\/binding-syntax\] "state\.": the left side of a binding must name a property/);
  });

  it("注入したキーと同名の getter やメソッドを宣言したボリュームは接ぎ木しないこと", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { host, read } = await mountPage(
      "state.taxRate: settings.taxRate",
      { subtotal: 1, get taxRate() { return 0; }, get total(this: any) { return this.subtotal; } },
      { settings: { taxRate: 0.1 } },
    );
    expect(errors.mock.calls.some((call) => String(call[1]?.message ?? "").includes("also injects it"))).toBe(true);
    expect(read((s) => s["cart.subtotal"])).toBeUndefined();
    errors.mockRestore();
    host.remove();
  });

  it("翻訳と逆翻訳: 注入の最長一致が先、無ければ接頭辞・関係ないパスは null", () => {
    const [entry] = readVolumeInjections("state.rate: settings.rate", "cart");
    expect(translateVolumePath("cart", [entry], "rate", false)).toBe("settings.rate");
    expect(translateVolumePath("cart", [entry], "rate.deep", false)).toBe("settings.rate.deep");
    expect(translateVolumePath("cart", [entry], "rated", false)).toBe("cart.rated");
    expect(translateVolumePath("cart", [], "rate", true)).toBe("cart.rate");
    expect(relativeVolumePath("cart", [entry], "settings.rate")).toBe("rate");
    expect(relativeVolumePath("cart", [entry], "settings.rate.deep")).toBe("rate.deep");
    expect(relativeVolumePath("cart", [entry], "cart")).toBe("");
    expect(relativeVolumePath("cart", [entry], "cart.total")).toBe("total");
    expect(relativeVolumePath("cart", [entry], "settings")).toBeNull();
  });

  it("逆翻訳は外側パスの最長一致で、宣言順に依存しないこと", () => {
    // 外側パスが入れ子になる 2 つの注入。読み（translateVolumePath）は内側の最長一致なので
    // `b` が `settings.tax` を指す。逆翻訳が宣言順の先頭一致だと `a.tax` が返り食い違う
    const entries = readVolumeInjections("state.a: settings; state.b: settings.tax", "cart");
    const reversed = readVolumeInjections("state.b: settings.tax; state.a: settings", "cart");
    for (const injections of [entries, reversed]) {
      expect(relativeVolumePath("cart", injections, "settings.tax")).toBe("b");
      expect(relativeVolumePath("cart", injections, "settings.tax.rate")).toBe("b.rate");
      expect(relativeVolumePath("cart", injections, "settings.other")).toBe("a.other");
    }
  });

  it("マウントポイント自身も最長一致の候補に入ること", () => {
    const injections = readVolumeInjections("state.a: settings", "settings.cart");
    expect(relativeVolumePath("settings.cart", injections, "settings.cart.x")).toBe("x");
    expect(relativeVolumePath("settings.cart", injections, "settings.cart")).toBe("");
    expect(relativeVolumePath("settings.cart", injections, "settings.other")).toBe("a.other");
  });

  it("注入したキーをプロトタイプの getter で宣言したボリュームも接ぎ木しないこと", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    class Cart {
      subtotal = 1;
      get taxRate(): number { return 0; }
    }
    const { host, read } = await mountPage(
      "state.taxRate: settings.taxRate",
      new Cart() as any,
      { settings: { taxRate: 0.1 } },
    );
    expect(errors.mock.calls.some((call) => String(call[1]?.message ?? "").includes("[wcs/mount-path-invalid]"))).toBe(true);
    expect(read((s) => s["cart.subtotal"])).toBeUndefined();
    errors.mockRestore();
    host.remove();
  });
});

describe("クラスで書いたボリューム（プロトタイプのアクセサ）", () => {
  it("プロトタイプの getter もツリーアクセサとして登録され、メソッドと constructor は載らないこと", async () => {
    class Cart {
      subtotal = 100;
      get total(this: any): number { return Math.round(this.subtotal * (1 + this.taxRate)); }
      addOne(this: any): void { this.subtotal = this.subtotal + 1; }
    }
    const { host, read, text, write } = await mountPage(
      "state.taxRate: settings.taxRate",
      new Cart() as any,
      { settings: { taxRate: 0.1 } },
    );
    // getter は prototype の上にあるが接ぎ木され、注入したキーの変化にも追従する
    expect(text("#total")).toBe("110");
    await write((s) => { s["settings.taxRate"] = 0.2; });
    expect(text("#total")).toBe("120");
    // own のクラスフィールドは従来どおりデータとして接ぎ木される
    expect(read((s) => s["cart.subtotal"])).toBe(100);
    // 接ぎ木されたデータはクラスフィールドだけ — メソッド・constructor・注入したキー・
    // アクセサ（別途 defineTreeAccessor で登録）はデータとして載らない
    expect(Object.keys(read((s) => s["cart"]) as object)).toEqual(["subtotal"]);
    expect(read((s) => s["cart.addOne"])).toBeUndefined();
    host.remove();
  });

  it("同名の own data key はプロトタイプの getter を隠すこと（解決順と同じ）", async () => {
    class Cart {
      subtotal = 1;
      get total(): number { return 999; }
    }
    const instance = new Cart() as any;
    // インスタンス側の値が勝つ（getAllPropertyDescriptors は手前が勝つ）
    Object.defineProperty(instance, "total", { value: 42, enumerable: true, writable: true, configurable: true });
    const { host, read, text } = await mountPage("", instance, {});
    expect(text("#total")).toBe("42");
    expect(read((s) => s["cart.total"])).toBe(42);
    host.remove();
  });
});

describe("ボリュームの $eq / $eqPath / $dependOn はスコープ内のパスを見る", () => {
  it("$eq / $eqPath がボリューム配下のパスを比べること（ルートに同名のキーが無い形）", async () => {
    // 翻訳が無いと `receiver.$eq("selectedId", …)` がルートを読み、ルートに `selectedId` が
    // 無いページでは `[wcs/binding-path-missing]`（作者が書いていないパスを名指しする throw）
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { host, text, write } = await mountPage(
      "",
      {
        selectedId: 2,
        chosen: 2,
        get total(this: any) { return `${this.$eq("selectedId", 2)}/${this.$eqPath("selectedId", "chosen")}`; },
      },
      { other: 1 },
    );
    expect(text("#total")).toBe("true/true");
    await write((s) => { s["cart.selectedId"] = 3; });
    expect(text("#total")).toBe("false/false");
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
    host.remove();
  });

  it("$dependOn がボリューム配下のパスに辺を張ること（ルートの同名パスではなく）", async () => {
    const { host, text, write } = await mountPage(
      "",
      {
        subtotal: 1,
        get total(this: any) { this.$dependOn("subtotal"); return `t${this.$untracked(() => this.subtotal)}`; },
      },
      { subtotal: 100 },
    );
    expect(text("#total")).toBe("t1");
    // ボリューム配下の書き込みで再評価される
    await write((s) => { s["cart.subtotal"] = 5; });
    expect(text("#total")).toBe("t5");
    host.remove();
  });
});

describe("スコープの chroot が翻訳する $ API の表（webComponent/dollarPathApis.ts）", () => {
  /** `$` API の呼び出しをそのまま記録するだけの receiver */
  function stubReceiver() {
    const calls: Array<[string, unknown[]]> = [];
    const receiver = new Proxy({} as Record<string, any>, {
      get: (_t, prop) => (...args: unknown[]) => { calls.push([String(prop), args]); return "called"; },
    });
    return { receiver, calls };
  }

  it("$eq / $eqPath / $eqIndex / $dependOn のパス引数を翻訳し、値・段・コールバックは素通しすること", () => {
    const { receiver, calls } = stubReceiver();
    const [entry] = readVolumeInjections("state.rate: settings.rate", "cart");
    const chroot = createVolumeChroot("cart", receiver, [entry]);
    // 第 2 引数は鍵の**値**なので翻訳しない
    chroot.$eq("selectedId", 2);
    // `$eqPath` は両方がパス。注入したキーは注入先（ルート）のパスへ
    chroot.$eqPath("selectedId", "rate");
    // `$eqIndex` の第 2 引数は段（数値）。省略形も壊さない
    chroot.$eqIndex("selectedIndex");
    chroot.$eqIndex("selectedIndex", 2);
    chroot.$dependOn("subtotal");
    chroot.$trackDependency("subtotal");
    expect(calls).toEqual([
      ["$eq", ["cart.selectedId", 2]],
      ["$eqPath", ["cart.selectedId", "settings.rate"]],
      ["$eqIndex", ["cart.selectedIndex"]],
      ["$eqIndex", ["cart.selectedIndex", 2]],
      ["$dependOn", ["cart.subtotal"]],
      ["$trackDependency", ["cart.subtotal"]],
    ]);
  });

  it("$untracked / $untrackDependency はコールバックを取るので翻訳しないこと", () => {
    const { receiver, calls } = stubReceiver();
    const chroot = createVolumeChroot("cart", receiver);
    const fn = (): number => 1;
    chroot.$untracked(fn);
    chroot.$untrackDependency(fn);
    expect(calls).toEqual([["$untracked", [fn]], ["$untrackDependency", [fn]]]);
  });
});

describe("ボリュームの chroot", () => {
  it("$ で始まるキーへの書き込みは翻訳せず親の意味論に倒すこと（get と対称）", () => {
    const written: Record<string, unknown> = {};
    const receiver = new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => (prop === "$custom" ? "from-parent" : undefined),
      set: (_t, prop, value) => { written[prop as string] = value; return true; },
    });
    const chroot = createVolumeChroot("cart", receiver);
    chroot.total = 5;
    chroot.$custom = 7;
    expect(written).toEqual({ "cart.total": 5, "$custom": 7 });
    expect(chroot.$custom).toBe("from-parent");
  });
});

/**
 * 注入宣言は「`mount=` のあるボリューム要素」にだけ書ける（要件 B14③）。
 * `mount=` の無い `<wcs-state>` では、誰も読まないまま束縛として残り、存在しない
 * `state` プロパティへの書き込みとして適用の段で落ちていた（書いた場所を指す診断が無かった）。
 */
describe("注入宣言を書ける場所", () => {
  it("mount= の無い <wcs-state> の注入宣言を [wcs/mount-path-invalid] で名指しすること", () => {
    const element = document.createElement("wcs-state");
    element.setAttribute("data-wcs", "state.taxRate: settings.taxRate");
    expect(() => getParseBindTextResults(element))
      .toThrow(/\[wcs\/mount-path-invalid\] "state\.taxRate: settings\.taxRate" is a volume injection declaration/);
    expect(() => getParseBindTextResults(element)).toThrow(/a "mount" attribute/);
  });

  it("1 段の `state:` は「名前空間は予約されている」と案内すること（mount= を足せという助言が回らないように）", () => {
    const element = document.createElement("wcs-state");
    element.setAttribute("data-wcs", "state: settings");
    expect(() => getParseBindTextResults(element))
      .toThrow(/\[wcs\/mount-path-invalid\] "state" is the reserved namespace for volume injection/);
    expect(() => getParseBindTextResults(element)).toThrow(/state\.<key>: <path>/);
    // `mount=` を足すと今度は「1 つずつ書け」になる形（案内が一周する）を踏まないこと
    expect(() => getParseBindTextResults(element)).not.toThrow(/Add mount=/);
  });

  it("mount= があれば注入宣言は束縛から外れること（従来どおり）", () => {
    const element = document.createElement("wcs-state");
    element.setAttribute("mount", "cart");
    element.setAttribute("data-wcs", "state.taxRate: settings.taxRate");
    expect(getParseBindTextResults(element)).toEqual([]);
  });

  it("<wcs-state> 以外の要素の `state.x:` は従来どおり入れ子プロパティの束縛であること", () => {
    const element = document.createElement("div");
    element.setAttribute("data-wcs", "state.taxRate: settings.taxRate");
    const [result] = getParseBindTextResults(element);
    expect(result).toMatchObject({ bindingType: "prop", propSegments: ["state", "taxRate"] });
  });
});
