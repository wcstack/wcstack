/**
 * 次期メジャーの破壊的変更の候補（docs/state-next-major-requirements.md §3、B1〜B14）の現状を固定する
 * 回帰テスト（受け入れ基準 A6、要件 D20）。
 *
 * ここに書いたのは**今の挙動**で、望ましい挙動ではない。どの項目も、採るかどうかを決めたら（D20）、
 * 採った項目のテストはここで新しい契約へ書き換える — 黙って変わらないことを保証するのがこのファイルの役目。
 * 監査の再現例（scripts/audit-state-next.mjs・scripts/audit-state-browser.mjs、
 * docs/research/state-next/selection-and-profiles.json）をランタイムのテストへ移したもの。
 *
 * 別のテストが既に固定している項目:
 *   B11 スコープ能力（$scan は root 専用）— scan.lifecycle.test.ts の「SSR / ボリューム / マウント（D8）」
 *   B13 exports と副作用 — 実装済み（分割エントリ。entries.core.test.ts・check-state-split.mjs）
 *   B14 ② own key が明示した部分マウントに勝つ — webComponent.mount.test.ts の「規則 2」
 *   B14 ③ volume に注入口が無い — 機能の不在なので固定するテストは無い
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { parseBindTextsForElement } from "../src/bindTextParser/parseBindTextsForElement";
import { resolveFilterFn } from "../src/core/filterRegistry";
import { builtinFilterArity, outputBuiltinFilters } from "../src/formats/builtinFilters";
import { builtinFilterMeta } from "../src/filters/filterMeta";

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));
let seq = 0;

async function mount(initial: Record<string, unknown>, body: string): Promise<{ root: ShadowRoot; stateEl: State }> {
  const host = document.createElement(`major-candidates-host-${++seq}`);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = body + `<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = root.querySelector("wcs-state") as State;
  stateEl.setInitialState(initial);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(root);
  await flush();
  return { root, stateEl };
}

const parseOne = (text: string) => parseBindTextsForElement(text)[0];
const output = (name: string, args: string[]) => resolveFilterFn(name, args, "output");

describe("B1 引用符と区切り（現状: 外側の分割が引用符解析より先）", () => {
  it("区切りを含まない引用符の引数は通ること", () => {
    expect(parseOne("textContent: x|join(', ')").outFilters[0].args).toEqual([", "]);
  });

  it("引用符の中の ; と | でフィルタが壊れること", () => {
    expect(() => parseBindTextsForElement("textContent: x|join(';')")).toThrow(/missing closing parenthesis/);
    expect(() => parseBindTextsForElement("textContent: x|join('|')")).toThrow(/missing closing parenthesis/);
  });
});

describe("B2 不正構文の受理（現状: 受理して黙って丸める）", () => {
  it("未閉じの引用符が通ること", () => {
    expect(parseOne("textContent: x|join('unterminated)").outFilters[0].args).toEqual(["unterminated"]);
  });

  it("value#ro#wo は ro だけが残り、未知の修飾子もそのまま通ること", () => {
    expect(parseOne("value#ro#wo: x").propModifiers).toEqual(["ro"]);
    expect(parseOne("value#unknown: x").propModifiers).toEqual(["unknown"]);
  });

  it("else: の右辺は捨てられること", () => {
    const result = parseOne("else: ignored");
    expect(result.bindingType).toBe("else");
    expect(result.statePathName).toBe("#else");
  });
});

describe("B3 フィルタ引数（3.0 で採用: 構造的なキャッシュキーと引数の個数の検査）", () => {
  it("['a,b'] と ['a'] を別の関数に解決すること", () => {
    expect(output("join", ["a,b"])).not.toBe(output("join", ["a"]));
    expect(output("join", ["a,b"])(["X", "Y"])).toBe("Xa,bY");
    expect(output("join", ["a"])(["X", "Y"])).toBe("XaY");
  });

  it("過剰な引数と不足した引数を、束縛計画の段で [wcs/filter-arity] として拒否すること", () => {
    // 解析の段は引数をそのまま運ぶ（文法としては正しい）
    expect(parseOne("textContent: x|join(a,b)").outFilters[0].args).toEqual(["a", "b"]);
    expect(() => output("join", ["a", "b"])).toThrow(/\[wcs\/filter-arity\] filter "join" accepts at most 1 argument\(s\) \(2 given\)/);
    expect(() => output("clamp", ["0"])).toThrow(/\[wcs\/filter-arity\] filter "clamp" requires at least 2 argument\(s\) \(1 given\)/);
  });

  it("書式機能の引数の個数の表が builtinFilterMeta（lint と同じ正本）と一致すること", () => {
    for (const name of Object.keys(outputBuiltinFilters)) {
      const meta = builtinFilterMeta[name];
      expect(builtinFilterArity[name], name).toEqual([meta.minArgs, meta.maxArgs]);
    }
    expect(Object.keys(builtinFilterArity).sort()).toEqual(Object.keys(outputBuiltinFilters).sort());
  });
});

describe("B4 修飾子とバインド種別（現状: 修飾子が種別を変える）", () => {
  it("radio: は専用の種別で、radio#ro: は汎用プロパティに落ちること", () => {
    expect(parseOne("radio: x").bindingType).toBe("radio");
    const withModifier = parseOne("radio#ro: x");
    expect(withModifier.bindingType).toBe("prop");
    expect(withModifier.propName).toBe("radio");
  });
});

describe("B5 on 接頭辞（現状: on で始まる名前はすべてイベント）", () => {
  it("only: / online: がイベント束縛として解釈されること", () => {
    expect(parseOne("only: x").bindingType).toBe("event");
    expect(parseOne("online: x").bindingType).toBe("event");
    expect(parseOne("onclick: x").bindingType).toBe("event");
  });
});

describe("B6 readonly の抜け穴（3.0 で採用: 書き込み API の入口がすべて検査する）", () => {
  it("readonly のプロキシでは直接代入・$resolve の書き・$setAll がすべて throw し、書かないこと", async () => {
    const { stateEl } = await mount({ selectedIndex: 0 }, "");
    const errors: string[] = [];
    stateEl.createState("readonly", (s: any) => {
      try { s.selectedIndex = 8; } catch (e) { errors.push((e as Error).message); }
      try { s.$resolve("selectedIndex", [], 9); } catch (e) { errors.push((e as Error).message); }
      try { s.$setAll("selectedIndex", [], 10); } catch (e) { errors.push((e as Error).message); }
      // 読みは通る
      expect(s.$resolve("selectedIndex", [])).toBe(0);
    });
    expect(errors).toEqual(Array(3).fill("[@wcstack/state] This state is readonly."));
    let after: unknown;
    stateEl.createState("readonly", (s: any) => { after = s.selectedIndex; });
    expect(after).toBe(0);
  });
});

describe("B7 $resolve のオーバーロード（3.0 で採用: 引数の個数で読みと書きを分ける）", () => {
  it("$resolve(path, []) は読み、$resolve(path, [], undefined) は undefined の書きになること", async () => {
    const { stateEl } = await mount({ selectedIndex: 7 }, "");
    let read: unknown;
    let after: unknown = "untouched";
    stateEl.createState("writable", (s: any) => {
      read = s.$resolve("selectedIndex", []);
      s.$resolve("selectedIndex", [], undefined);
      after = s.selectedIndex;
    });
    expect(read).toBe(7);
    expect(after).toBeUndefined();
  });
});

describe("B8 空値の契約（現状: 表面ごとにばらばら）", () => {
  it("undefined と null が textContent・mustache・属性で別々の結果になること", async () => {
    const { root, stateEl } = await mount({ x: "seed" },
      `<span id="prop" data-wcs="textContent: x"></span><span id="text">{{ x }}</span><span id="attr" data-wcs="attr.title: x"></span>`);
    const snapshot = () => ({
      property: root.querySelector("#prop")!.textContent,
      mustache: root.querySelector("#text")!.textContent,
      attribute: root.querySelector("#attr")!.getAttribute("title"),
    });
    expect(snapshot()).toEqual({ property: "seed", mustache: "seed", attribute: "seed" });

    stateEl.createState("writable", (s: any) => { s.x = undefined; });
    await flush();
    // undefined: textContent は前の値を保持、mustache は空、属性は文字列 "undefined"
    expect(snapshot()).toEqual({ property: "seed", mustache: "", attribute: "undefined" });

    stateEl.createState("writable", (s: any) => { s.x = null; });
    await flush();
    // null: textContent と mustache は空、属性は文字列 "null"
    expect(snapshot()).toEqual({ property: "", mustache: "", attribute: "null" });
  });
});

describe("B9 フィルタのリテラル型（現状: 引数は文字列、数値変換だけがある）", () => {
  it("真偽値 true に eq(true) は false、数値 1 に eq(1) は true を返すこと", () => {
    expect(output("eq", ["true"])(true)).toBe(false);
    expect(output("eq", ["1"])(1)).toBe(true);
  });
});

describe("B10 真偽判定（3.0 で採用: JavaScript の真偽判定に揃えた）", () => {
  it("truthy / falsy / boolean / defaults が 0n を含めて Boolean() と一致すること", () => {
    for (const value of [0n, 1n, 0, -0, NaN, "", "0", null, undefined, false, true, [], {}]) {
      expect(output("truthy", [])(value)).toBe(Boolean(value));
      expect(output("falsy", [])(value)).toBe(!value);
      expect(output("boolean", [])(value)).toBe(Boolean(value));
      expect(output("defaults", ["fallback"])(value)).toBe(value ? value : "fallback");
    }
  });
});

describe("B12 名前の正典化（現状の語彙のうち、値で確かめられるもの）", () => {
  it("defaults は 0 と空文字も置き換え、pad は先頭側だけを埋めること", () => {
    expect(output("defaults", ["fallback"])(0)).toBe("fallback");
    expect(output("defaults", ["fallback"])("")).toBe("fallback");
    expect(output("pad", ["5", "0"])("7")).toBe("00007");
  });
});

describe("B14 ① マウントの修飾子（現状: state#ro: を受理するが、マウントは修飾子を読まない）", () => {
  it("state#ro: でマウントしたコンポーネントからの書き込みがホストへ届くこと", async () => {
    expect(parseOne("state#ro: user").propModifiers).toEqual(["ro"]);

    const tag = `major-candidates-card-${++seq}`;
    class Card extends HTMLElement {
      state: Record<string, unknown> = {};
      constructor() {
        super();
        this.attachShadow({ mode: "open" });
      }
      connectedCallback() {
        this.shadowRoot!.innerHTML = `<wcs-state bind-component="state"></wcs-state><span class="name" data-wcs="textContent: name"></span>`;
      }
    }
    customElements.define(tag, Card);
    const { root, stateEl } = await mount({ user: { name: "A" } }, `<${tag} data-wcs="state#ro: user"></${tag}>`);
    const card = root.querySelector(tag)!;
    const childState = card.shadowRoot!.querySelector("wcs-state") as State;
    await childState.connectedCallbackPromise;
    await State.getBindingsReady(card.shadowRoot!);
    await flush();
    expect(card.shadowRoot!.querySelector(".name")!.textContent).toBe("A");

    // マウントされたコンポーネントは element.state 経由で書く（自前の state を持たない）
    (card as any).state.name = "B";
    await flush();
    await flush();
    let hostName: unknown;
    stateEl.createState("readonly", (s: any) => { hostName = s["user.name"]; });
    expect(hostName).toBe("B");
  });
});
