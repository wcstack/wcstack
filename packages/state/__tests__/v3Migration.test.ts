/**
 * 3.0 で拒否される書き方・意味が変わる使い方の予告（次期メジャーの要件 D2）。
 * 2.x の挙動は変えず、`[wcs/v3-migration]` を同じ文面につき 1 回だけ出すことを固定する。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { parseBindTextsForElement } from "../src/bindTextParser/parseBindTextsForElement";
import { parseBindTextForEmbeddedNode } from "../src/bindTextParser/parseBindTextForEmbeddedNode";
import { outputBuiltinFilters as builtinFilters } from "../src/filters/builtinFilters";
import { builtinFilterMeta } from "../src/filters/filterMeta";
import { findEmbeddedV3MigrationIssues, findV3MigrationIssues } from "../src/parser";
import { maxFilterArgs } from "../src/v3MigrationRules";
import {
  checkBindTextForV3,
  checkEmbeddedBindTextForV3,
  clearV3MigrationWarningsForTesting,
  READONLY_WRITE,
  warnV3Migration,
} from "../src/v3Migration";

beforeAll(() => {
  bootstrapState();
});

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  clearV3MigrationWarningsForTesting();
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
});

const migrations = (): string[] =>
  warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("[wcs/v3-migration]"));

const flush = () => new Promise((r) => setTimeout(r));
let seq = 0;
async function mount(initial: Record<string, unknown>, body: string): Promise<{ root: ShadowRoot; stateEl: State }> {
  const host = document.createElement(`v3-migration-host-${++seq}`);
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

describe("v3Migration: 警告の台帳", () => {
  it("同じ文面は 1 回だけ警告し、README の節へ案内し、台帳を空にすれば再び出ること", () => {
    warnV3Migration("message.");
    warnV3Migration("message.");
    expect(migrations()).toEqual([
      '[@wcstack/state] [wcs/v3-migration] message. See "Preparing for 3.0" in the @wcstack/state README.',
    ]);
    clearV3MigrationWarningsForTesting();
    warnV3Migration("message.");
    expect(migrations()).toHaveLength(2);
  });
});

describe("v3Migration: 文法（3.0 は [wcs/binding-syntax] / [wcs/filter-arity] で拒否する）", () => {
  const check = (text: string) => checkBindTextForV3(text, parseBindTextsForElement(text));

  it("2 つ目の # ・else: の値・構造ディレクティブの修飾子・radio の修飾子・閉じていない引用符・引数の超過を知らせること", () => {
    check("value#ro#wo: x");
    check("else: ignored");
    check("for#ro: items");
    check("radio#ro: choice");
    check("textContent: x|join('a)");
    check("textContent: x|join(a,b)");
    const w = migrations();
    expect(w).toHaveLength(6);
    expect(w[0]).toContain('"value#ro#wo": 3.0 rejects a second "#". Write "value#ro,wo".');
    expect(w[1]).toContain('"else: ignored": 3.0 rejects a value after "else:".');
    expect(w[2]).toContain('"for#ro": 3.0 rejects modifiers and filters on "for". Write "for:".');
    expect(w[3]).toContain('3.0 keeps this a radio binding that honours the modifiers');
    expect(w[4]).toContain(`"x|join('a)": 3.0 rejects the unterminated quote.`);
    expect(w[5]).toContain('"join" takes at most 1 argument(s); 3.0 rejects more.');
  });

  it("正しい書き方・区切りの無い式・空の式は知らせず、同じ文字列は 1 回だけ知らせること", () => {
    check("textContent: x; value#ro,wo: y; ;");
    check("else:");
    check("textContent: x|join(',')");
    // 2.x のパーサが先に拒否する形（: が無い）は、直接渡しても何も言わない
    checkBindTextForV3("broken", []);
    expect(migrations()).toEqual([]);
    check("value#ro#wo: x");
    check("value#ro#wo: x");
    expect(migrations()).toHaveLength(1);
  });

  it("mustache（テキストバインディング）の閉じていない引用符と引数の超過も知らせ、同じ式は 1 回だけ調べること", () => {
    checkEmbeddedBindTextForV3("x|join('a)", parseBindTextForEmbeddedNode("x|join('a)"));
    checkEmbeddedBindTextForV3("x|join(a,b)", parseBindTextForEmbeddedNode("x|join(a,b)"));
    checkEmbeddedBindTextForV3("x|join(a,b)", parseBindTextForEmbeddedNode("x|join(a,b)"));
    checkEmbeddedBindTextForV3("x|uc", parseBindTextForEmbeddedNode("x|uc"));
    expect(migrations()).toHaveLength(2);
  });

  it("ランタイムの入口（属性と mustache）で調べること", async () => {
    await mount({ x: ["a", "b"], y: "t" },
      `<p data-wcs="textContent: y; title#ro#wo: y"></p><span>{{ x|join(a,b) }}</span>`);
    const w = migrations();
    expect(w.some((m) => m.includes('"title#ro#wo"'))).toBe(true);
    expect(w.some((m) => m.includes('"join" takes at most 1'))).toBe(true);
  });
});

describe("v3Migration: フィルタ（3.0 の型付きリテラル・JavaScript の真偽判定）", () => {
  it("引用符の無い true / false / null を取る eq / ne / defaults を原文で知らせ、引用符付きは知らせないこと", () => {
    expect(findV3MigrationIssues("textContent: flag|eq(true)|not")).toEqual([
      `"eq(true)": 3.0 reads an unquoted true as a boolean, not the text. Write eq('true') to keep the text.`,
    ]);
    expect(findV3MigrationIssues("textContent: x|ne( false )")[0]).toContain("as a boolean");
    expect(findV3MigrationIssues("textContent: x|defaults(null)")[0]).toContain(`as a null, not the text. Write defaults('null')`);
    // 2.x は引用符を剥がしてから渡すので値の側では区別できない — 書き換えた後は黙ること
    expect(findV3MigrationIssues("textContent: x|eq('true')")).toEqual([]);
    expect(findV3MigrationIssues("textContent: x|defaults('null')")).toEqual([]);
    expect(findV3MigrationIssues("textContent: x|eq(1)")).toEqual([]);
    expect(findEmbeddedV3MigrationIssues("x|eq(false)")[0]).toContain('"eq(false)"');
  });

  it("フィルタ関数は引用符の有無を見ず、eq('true') で書き換えた後も値で警告しないこと", () => {
    expect(builtinFilters.eq(["true"])(true)).toBe(false);
    expect(builtinFilters.defaults(["null"])("")).toBe("null");
    expect(migrations()).toEqual([]);
  });

  it("truthy / falsy / defaults が 0n を受けたら知らせること", () => {
    expect(builtinFilters.truthy()(0n)).toBe(true);
    expect(builtinFilters.falsy()(0n)).toBe(false);
    expect(builtinFilters.defaults(["x"])(0n)).toBe(0n);
    expect(builtinFilters.truthy()(1n)).toBe(true);
    const w = migrations();
    expect(w).toHaveLength(3);
    expect(w[0]).toContain('"truthy" got 0n: 3.0 treats it as falsy.');
  });

  it("parsed を渡せば式 1 つでもフィルタの引数の個数を見ること（lint が使う形）", () => {
    const expr = "textContent: x|join(a,b)";
    expect(findV3MigrationIssues(expr, parseBindTextsForElement(expr)[0])).toEqual([
      '"join" takes at most 1 argument(s); 3.0 rejects more.',
    ]);
    expect(findV3MigrationIssues(expr)).toEqual([]);
  });

  it("引数の上限の表は filterMeta の maxArgs と一致すること（説明文ごとランタイムに載せないための写し）", () => {
    for (const [name, meta] of Object.entries(builtinFilterMeta)) {
      expect([name, maxFilterArgs(name)]).toEqual([name, meta.maxArgs]);
    }
  });
});

describe("v3Migration: 空値（3.0 は表示の表面を空にし、属性・style を削除する）", () => {
  it("表示のプロパティ・属性・style への undefined / null を知らせ、2.x の結果は変えないこと", async () => {
    const { root, stateEl } = await mount({ x: "seed", n: 1 },
      `<p id="p" data-wcs="textContent: x"></p><p id="a" data-wcs="attr.title: x"></p><p id="s" data-wcs="style.color: x"></p><input id="i" data-wcs="value: x">`);
    stateEl.createState("writable", (s: any) => { s.x = undefined; });
    await flush();
    expect(root.querySelector("#p")!.textContent).toBe("seed");
    expect(root.querySelector("#a")!.getAttribute("title")).toBe("undefined");
    stateEl.createState("writable", (s: any) => { s.x = null; });
    await flush();
    const w = migrations();
    expect(w.some((m) => m.includes('"textContent: x" got undefined: 3.0 empties it.'))).toBe(true);
    expect(w.some((m) => m.includes('"attr.title: x" got undefined: 3.0 removes the attribute.'))).toBe(true);
    expect(w.some((m) => m.includes('"attr.title: x" got null: 3.0 removes the attribute.'))).toBe(true);
    expect(w.some((m) => m.includes('"style.color: x" got undefined: 3.0 clears it.'))).toBe(true);
    // 入力（value）への undefined は 3.0 でもスキップなので知らせない
    expect(w.some((m) => m.includes('"value: x"'))).toBe(false);
  });
});

describe("v3Migration: $resolve / $setAll（3.0 は引数の個数で読み書きを分け、readonly の書き込みを拒否する）", () => {
  it("明示した undefined の $resolve と、readonly のプロキシからの書き込みを知らせ、2.x の結果は変えないこと", async () => {
    const { stateEl } = await mount({ n: 7 }, "");
    let read: unknown;
    stateEl.createState("writable", (s: any) => {
      read = s.$resolve("n", [], undefined);
      s.$resolve("n", []);
    });
    expect(read).toBe(7);
    let after: unknown;
    stateEl.createState("readonly", (s: any) => {
      s.$resolve("n", [], 8);
      s.$setAll("n", [], 9);
      after = s.n;
    });
    expect(after).toBe(9);
    stateEl.createState("writable", (s: any) => {
      s.$resolve("n", [], 10);
      s.$setAll("n", [], 11);
    });
    const w = migrations();
    expect(w).toHaveLength(2);
    expect(w[0]).toContain('$resolve("n", indexes, undefined): 3.0 writes undefined. Pass two arguments to read.');
    expect(w[1]).toContain(READONLY_WRITE);
  });
});

describe("v3Migration: マウント（3.0 は #ro を守り、$errorCallback を名指しで知らせる）", () => {
  it("#ro のマウントを通るコンポーネント側の書き込みを知らせ、2.x では書けること", async () => {
    const tag = `v3-migration-card-${++seq}`;
    class Card extends HTMLElement {
      state: Record<string, unknown> = { editing: false };
      constructor() {
        super();
        this.attachShadow({ mode: "open" });
      }
      connectedCallback() {
        this.shadowRoot!.innerHTML = `<wcs-state bind-component="state"></wcs-state><span class="n" data-wcs="textContent: name"></span>`;
      }
    }
    customElements.define(tag, Card);
    const { root, stateEl } = await mount({ user: { name: "A" } }, `<${tag} data-wcs="state#ro: user"></${tag}>`);
    const card = root.querySelector(tag)!;
    const childState = card.shadowRoot!.querySelector("wcs-state") as State;
    await childState.connectedCallbackPromise;
    await State.getBindingsReady(card.shadowRoot!);
    await flush();

    (card as any).state.name = "B";
    (card as any).state.$setAll("name", [], "C");
    (card as any).state.$resolve("name", [], "D");
    (card as any).state.$resolve("name", []);
    (card as any).state.editing = true;
    await flush();
    let hostName: unknown;
    stateEl.createState("readonly", (s: any) => { hostName = s["user.name"]; });
    expect(hostName).toBe("D");
    const w = migrations().filter((m) => m.includes("#ro: user"));
    expect(w).toHaveLength(1);
    expect(w[0]).toContain(`<${tag}> writes "name" through "state#ro: user": 3.0 throws. Write it on the host, or drop #ro.`);
  });

  it("ボリュームとマウントされたコンポーネントの $errorCallback を名指しで知らせること", async () => {
    const host = document.createElement(`v3-migration-vol-${++seq}`);
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<wcs-state mount="cfg"></wcs-state><wcs-state json='{"count":1}'></wcs-state>`;
    document.body.appendChild(host);
    const volume = shadowRoot.querySelector("wcs-state[mount]") as State;
    const rootState = shadowRoot.querySelector("wcs-state:not([mount])") as State;
    volume.setInitialState({ value: 1, $errorCallback() {} });
    await rootState.connectedCallbackPromise;
    await volume.connectedCallbackPromise;
    await flush();
    const all = warn.mock.calls.map((c) => String(c[0]));
    expect(all.some((m) => m.includes('declares $errorCallback, which volumes do not support'))).toBe(true);
  });
});
