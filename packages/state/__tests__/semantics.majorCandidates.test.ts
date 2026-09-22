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
import { parseBindTextForEmbeddedNode } from "../src/bindTextParser/parseBindTextForEmbeddedNode";
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

describe("B1 引用符と区切り（3.0 で採用: 引用符の中は区切らない）", () => {
  it("区切りを含まない引用符の引数は通ること", () => {
    expect(parseOne("textContent: x|join(', ')").outFilters[0].args).toEqual([", "]);
  });

  it("引用符の中の ; と | は引数のまま、外側の区切りは効くこと", () => {
    expect(parseOne("textContent: x|join(';')").outFilters[0].args).toEqual([";"]);
    expect(parseOne("textContent: x|join('|')").outFilters[0].args).toEqual(["|"]);
    const two = parseBindTextsForElement("textContent: x|join(';'); title: y|join(\"|\")|uc");
    expect(two.map((r) => r.propName)).toEqual(["textContent", "title"]);
    expect(two[1].outFilters.map((f) => [f.filterName, f.args])).toEqual([["join", ["|"]], ["uc", []]]);
    expect(output("join", [";"])(["X", "Y"])).toBe("X;Y");
  });
});

describe("B2 不正構文の受理（3.0 で採用: 拒否して名指しで診断する）", () => {
  it("閉じていない引用符を [wcs/binding-syntax] で拒否すること", () => {
    expect(() => parseBindTextsForElement("textContent: x|join('unterminated)")).toThrow(/\[wcs\/binding-syntax\] unterminated ' quote/);
  });

  it("value#ro#wo を拒否し、1 つの修飾子の並びへ誘導すること（未知の修飾子は従来どおり通る）", () => {
    expect(() => parseBindTextsForElement("value#ro#wo: x")).toThrow(/\[wcs\/binding-syntax\] "value#ro#wo": .* write "value#ro,wo"/);
    expect(parseOne("value#ro,wo: x").propModifiers).toEqual(["ro", "wo"]);
    expect(parseOne("value#unknown: x").propModifiers).toEqual(["unknown"]);
  });

  it("空のフィルタ（x| ・ x||y ・ x|(1)）を [wcs/binding-syntax] で拒否すること", () => {
    for (const text of ["textContent: x|", "textContent: x||uc", "textContent: x|(1)"]) {
      expect(() => parseBindTextsForElement(text), text).toThrow(/\[wcs\/binding-syntax\] an empty filter/);
    }
    expect(() => parseBindTextForEmbeddedNode("count | ")).toThrow(/\[wcs\/binding-syntax\] an empty filter/);
  });

  it("else: の右辺を拒否すること", () => {
    expect(() => parseBindTextsForElement("else: ignored")).toThrow(/\[wcs\/binding-syntax\] "else: ignored": "else" takes no value/);
    expect(parseOne("else:").bindingType).toBe("else");
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

describe("B4 修飾子とバインド種別（3.0 で採用: 修飾子は種別を変えない）", () => {
  it("radio#ro: / checkbox#ro: は radio / checkbox のまま修飾子を運ぶこと", () => {
    expect(parseOne("radio: x").bindingType).toBe("radio");
    const radio = parseOne("radio#ro: x");
    expect(radio.bindingType).toBe("radio");
    expect(radio.propName).toBe("radio");
    expect(radio.propModifiers).toEqual(["ro"]);
    expect(parseOne("checkbox#ro: x").bindingType).toBe("checkbox");
  });

  it("構造ディレクティブと spread に修飾子が付いたら拒否すること", () => {
    for (const text of ["for#ro: items", "if#ro: x", "elseif#x: y", "else#x:", "...#ro: slot"]) {
      expect(() => parseBindTextsForElement(text), text).toThrow(/\[wcs\/binding-syntax\] .* takes no modifiers/);
    }
  });

  it("radio#ro: は state に従ってチェックされ、要素の操作を state へ書き戻さないこと", async () => {
    const { root, stateEl } = await mount({ choice: "b" },
      `<input type="radio" name="g" value="a" data-wcs="radio#ro: choice"><input type="radio" name="g" value="b" data-wcs="radio#ro: choice">`);
    const [a, b] = Array.from(root.querySelectorAll("input")) as HTMLInputElement[];
    expect([a.checked, b.checked]).toEqual([false, true]);
    a.checked = true;
    a.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    let choice: unknown;
    stateEl.createState("readonly", (s: any) => { choice = s.choice; });
    expect(choice).toBe("b");
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

describe("B8 空値の契約（3.0 で採用: 表示の表面は undefined も null も空、要素の入力は undefined をスキップ）", () => {
  it("textContent・mustache・属性・style で、undefined と null がどちらも空（属性・style は削除）になること", async () => {
    const { root, stateEl } = await mount({ x: "seed" },
      `<span id="prop" data-wcs="textContent: x"></span><span id="text">{{ x }}</span><span id="attr" data-wcs="attr.title: x; style.color: x"></span>`);
    const snapshot = () => ({
      property: root.querySelector("#prop")!.textContent,
      mustache: root.querySelector("#text")!.textContent,
      attribute: root.querySelector("#attr")!.getAttribute("title"),
      hasAttribute: root.querySelector("#attr")!.hasAttribute("title"),
      style: (root.querySelector("#attr") as HTMLElement).style.color,
    });
    stateEl.createState("writable", (s: any) => { s.x = "red"; });
    await flush();
    expect(snapshot()).toEqual({ property: "red", mustache: "red", attribute: "red", hasAttribute: true, style: "red" });

    for (const empty of [undefined, null]) {
      stateEl.createState("writable", (s: any) => { s.x = "red"; });
      await flush();
      stateEl.createState("writable", (s: any) => { s.x = empty; });
      await flush();
      expect(snapshot(), String(empty)).toEqual({ property: "", mustache: "", attribute: null, hasAttribute: false, style: "" });
    }
  });

  it("使い回した行で、undefined の値が前の行の表示を残さないこと（textContent の既存の不具合）", async () => {
    const { root, stateEl } = await mount({ items: [{ nick: "Alice" }] },
      `<ul><template data-wcs="for: items"><li><span class="p" data-wcs="textContent: .nick"></span><span class="m">{{ .nick }}</span></li></template></ul>`);
    stateEl.createState("writable", (s: any) => { s.items = []; });
    await flush();
    stateEl.createState("writable", (s: any) => { s.items = [{ id: 2 }]; });
    await flush();
    const li = root.querySelector("li")!;
    expect(li.querySelector(".p")!.textContent).toBe("");
    expect(li.querySelector(".m")!.textContent).toBe("");
  });

  it("使い回した行で、undefined の class 値が行ごと消さないこと（クラスを外すだけ）", async () => {
    const { root, stateEl } = await mount({ items: [{ flag: true }] },
      `<ul><template data-wcs="for: items"><li data-wcs="class.on: .flag; attr.title: .t"></li></template></ul>`);
    expect(root.querySelector("li")!.className).toBe("on");
    stateEl.createState("writable", (s: any) => { s.items = []; });
    await flush();
    stateEl.createState("writable", (s: any) => { s.items = [{ id: 2 }]; });
    await flush();
    const li = root.querySelector("li");
    // かつては class の非 boolean が throw し、行そのものが描かれなかった（`attr.` は B8 で属性が消えるだけ）
    expect(li).not.toBeNull();
    expect(li!.classList.contains("on")).toBe(false);
    expect(li!.hasAttribute("title")).toBe(false);
  });

  it("要素の入力（表示以外のプロパティ）への undefined は従来どおりスキップし、null で消すこと", async () => {
    const { root, stateEl } = await mount({ v: "typed" }, `<input id="in" data-wcs="value#ro: v">`);
    const input = root.querySelector("#in") as HTMLInputElement;
    expect(input.value).toBe("typed");
    stateEl.createState("writable", (s: any) => { s.v = undefined; });
    await flush();
    expect(input.value).toBe("typed");
    stateEl.createState("writable", (s: any) => { s.v = null; });
    await flush();
    expect(input.value).toBe("");
  });
});

describe("B9 フィルタのリテラル型（3.0 で採用: 引用符の無い true / false / null / 数値は型付き）", () => {
  /** 束縛と同じ経路: パーサの型付きの値で解決する */
  const planned = (filterText: string) => {
    const f = parseOne(`textContent: x|${filterText}`).outFilters[0];
    return resolveFilterFn(f.filterName, f.args, "output", f.literals);
  };

  it("パーサが引数ごとに型付きの値を作ること", () => {
    expect(parseOne("textContent: x|eq(true)").outFilters[0].literals).toEqual([true]);
    expect(parseOne("textContent: x|eq('true')").outFilters[0].literals).toEqual(["true"]);
    expect(parseOne("textContent: x|eq(null)").outFilters[0].literals).toEqual([null]);
    expect(parseOne("textContent: x|slice(-1, 2.5)").outFilters[0].literals).toEqual([-1, 2.5]);
    expect(parseOne("textContent: x|locale(ja-JP)").outFilters[0].literals).toEqual(["ja-JP"]);
  });

  it("eq / ne は真偽値と null を型付きで比べ、数値と文字列の比べ方は変えないこと", () => {
    expect(planned("eq(true)")(true)).toBe(true);
    expect(planned("eq('true')")(true)).toBe(false);
    expect(planned("eq(false)")(false)).toBe(true);
    expect(planned("eq(null)")(null)).toBe(true);
    expect(planned("ne(true)")(true)).toBe(false);
    // 数値の値は数として、文字列の値は原文と比べる（フォームの値 "1" と eq(1) は従来どおり一致）
    expect(planned("eq(1)")(1)).toBe(true);
    expect(planned("eq(1)")("1")).toBe(true);
    expect(planned("eq('1')")(1)).toBe(true);
  });

  it("defaults は型付きの値を返し、eq(1) と eq('1') は別の関数に解決されること", () => {
    expect(planned("defaults(0)")(undefined)).toBe(0);
    expect(planned("defaults('0')")(undefined)).toBe("0");
    expect(planned("defaults(null)")("")).toBeNull();
    expect(planned("eq(1)")).not.toBe(planned("eq('1')"));
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

describe("B14 ① マウントの修飾子（3.0 で採用: マウント記録が #ro を尊重する）", () => {
  it("state#ro: でマウントしたコンポーネントからの書き込みは拒否され、ホストの書き込みは届くこと", async () => {
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
    expect(() => { (card as any).state.name = "B"; }).toThrow(/\[wcs\/mount-readonly\] .* cannot write "name": it is mounted read-only \("state#ro: user"\)/);
    expect(() => (card as any).state.$setAll("name", [], "C")).toThrow(/\[wcs\/mount-readonly\]/);
    expect(() => (card as any).state.$resolve("name", [], "D")).toThrow(/\[wcs\/mount-readonly\]/);
    // 読みは通る
    expect((card as any).state.name).toBe("A");
    await flush();
    let hostName: unknown;
    stateEl.createState("readonly", (s: any) => { hostName = s["user.name"]; });
    expect(hostName).toBe("A");

    // ホスト自身の書き込みは止めない
    stateEl.createState("writable", (s: any) => { s["user.name"] = "E"; });
    await flush();
    expect(card.shadowRoot!.querySelector(".name")!.textContent).toBe("E");
  });

  it("部分マウントの #ro はそのエントリだけを読み取り専用にし、コンポーネント内の双方向束縛も書き戻さないこと", async () => {
    const tag = `major-candidates-form-${++seq}`;
    class Form extends HTMLElement {
      state: Record<string, unknown> = {};
      constructor() {
        super();
        this.attachShadow({ mode: "open" });
      }
      connectedCallback() {
        this.shadowRoot!.innerHTML = `<wcs-state bind-component="state"></wcs-state><input class="title" data-wcs="value: title"><input class="note" data-wcs="value: note">`;
      }
    }
    customElements.define(tag, Form);
    const { root, stateEl } = await mount({ doc: { title: "T", note: "N" } },
      `<${tag} data-wcs="state.title#ro: doc.title; state.note: doc.note"></${tag}>`);
    const form = root.querySelector(tag)!;
    const childState = form.shadowRoot!.querySelector("wcs-state") as State;
    await childState.connectedCallbackPromise;
    await State.getBindingsReady(form.shadowRoot!);
    await flush();
    const title = form.shadowRoot!.querySelector(".title") as HTMLInputElement;
    const note = form.shadowRoot!.querySelector(".note") as HTMLInputElement;
    expect([title.value, note.value]).toEqual(["T", "N"]);

    title.value = "typed";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    note.value = "typed";
    note.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    let doc: unknown;
    stateEl.createState("readonly", (s: any) => { doc = { title: s["doc.title"], note: s["doc.note"] }; });
    expect(doc).toEqual({ title: "T", note: "typed" });
    expect(() => { (form as any).state.title = "x"; }).toThrow(/\[wcs\/mount-readonly\] .* \("state.title#ro: doc.title"\)/);
    (form as any).state.note = "y";
  });
});

describe("B14 ② 部分マウントと own key（3.0 で採用: 明示したエントリが勝つ）", () => {
  it("作者の既定値があっても、明示した部分マウントのホストの値が届くこと", async () => {
    const tag = `major-candidates-msg-${++seq}`;
    class Msg extends HTMLElement {
      state: Record<string, unknown> = { message: "own-default" };
      constructor() {
        super();
        this.attachShadow({ mode: "open" });
      }
      connectedCallback() {
        this.shadowRoot!.innerHTML = `<wcs-state bind-component="state"></wcs-state><span class="msg" data-wcs="textContent: message"></span>`;
      }
    }
    customElements.define(tag, Msg);
    const { root } = await mount({ user: { name: "Alice" } }, `<${tag} data-wcs="state.message: user.name"></${tag}>`);
    const msg = root.querySelector(tag)!;
    const childState = msg.shadowRoot!.querySelector("wcs-state") as State;
    await childState.connectedCallbackPromise;
    await State.getBindingsReady(msg.shadowRoot!);
    await flush();
    expect(msg.shadowRoot!.querySelector(".msg")!.textContent).toBe("Alice");
  });
});
