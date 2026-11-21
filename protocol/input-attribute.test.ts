// 入力の属性反映（/protocol/input-attribute.ts）の共有適合テスト。
// 生成コピーと同じ単位で各パッケージへ配布される（scripts/sync-protocol-types.mjs）。
// 実 Shell ではなく素の要素で全分岐を突く — 生成物の意味がパッケージ間でずれていないことだけを見る。
import { describe, it, expect } from "vitest";
import { reflectAttribute, reflectBooleanAttribute } from "./input-attribute.js";

const element = (html = "<x-el></x-el>"): Element => {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.firstElementChild!;
};

describe("reflectAttribute", () => {
  it("値は String(value) で属性に書く", () => {
    const el = element();
    reflectAttribute(el, "url", "/a");
    expect(el.getAttribute("url")).toBe("/a");
    reflectAttribute(el, "timeout", 250);
    expect(el.getAttribute("timeout")).toBe("250");
    reflectAttribute(el, "url", "");
    expect(el.getAttribute("url")).toBe("");
  });

  it("null は属性を外す（文字列 \"null\" を書かない）", () => {
    const el = element('<x-el url="/a"></x-el>');
    reflectAttribute(el, "url", null);
    expect(el.hasAttribute("url")).toBe(false);
  });

  it("undefined はマークアップに書かれていた値へ戻す（文字列 \"undefined\" を書かない）", () => {
    const el = element('<x-el url="/authored"></x-el>');
    reflectAttribute(el, "url", "/bound");
    expect(el.getAttribute("url")).toBe("/bound");
    reflectAttribute(el, "url", undefined);
    expect(el.getAttribute("url")).toBe("/authored");
    // null で外した後も、戻す先は最初の状態のまま
    reflectAttribute(el, "url", null);
    reflectAttribute(el, "url", undefined);
    expect(el.getAttribute("url")).toBe("/authored");
  });

  it("最初から属性が無ければ、undefined は属性を外す", () => {
    const el = element();
    reflectAttribute(el, "url", "/bound");
    reflectAttribute(el, "url", undefined);
    expect(el.hasAttribute("url")).toBe(false);
  });

  it("最初の書き込みが undefined でも属性はそのまま", () => {
    const el = element('<x-el url="/authored"></x-el>');
    reflectAttribute(el, "url", undefined);
    expect(el.getAttribute("url")).toBe("/authored");
  });

  it("最初の状態は属性ごと・要素ごとに覚える", () => {
    const a = element('<x-el url="/a" method="POST"></x-el>');
    const b = element('<x-el url="/b"></x-el>');
    reflectAttribute(a, "url", "/x");
    reflectAttribute(a, "method", "PUT");
    reflectAttribute(b, "url", "/y");
    reflectAttribute(a, "url", undefined);
    reflectAttribute(a, "method", undefined);
    reflectAttribute(b, "url", undefined);
    expect(a.getAttribute("url")).toBe("/a");
    expect(a.getAttribute("method")).toBe("POST");
    expect(b.getAttribute("url")).toBe("/b");
  });
});

describe("reflectBooleanAttribute", () => {
  it("truthy で属性を付け、false / null で外す", () => {
    const el = element();
    reflectBooleanAttribute(el, "manual", true);
    expect(el.getAttribute("manual")).toBe("");
    reflectBooleanAttribute(el, "manual", false);
    expect(el.hasAttribute("manual")).toBe(false);
    reflectBooleanAttribute(el, "manual", 1);
    expect(el.hasAttribute("manual")).toBe(true);
    reflectBooleanAttribute(el, "manual", null);
    expect(el.hasAttribute("manual")).toBe(false);
  });

  it("undefined はマークアップに書かれていた状態へ戻す", () => {
    const authored = element("<x-el manual></x-el>");
    reflectBooleanAttribute(authored, "manual", false);
    expect(authored.hasAttribute("manual")).toBe(false);
    reflectBooleanAttribute(authored, "manual", undefined);
    expect(authored.hasAttribute("manual")).toBe(true);

    const bare = element();
    reflectBooleanAttribute(bare, "manual", true);
    reflectBooleanAttribute(bare, "manual", undefined);
    expect(bare.hasAttribute("manual")).toBe(false);
  });
});

// 有界の全数検査（docs/verification-practices-study.md §2.5 (c)）: 長さ DEPTH までの書き込みの列を全部、
// 素朴な模型と一歩ごとに突き合わせる。模型: 「最初の状態」は helper の最初の書き込みの時点の属性
// （それより前に要素自身が書いた属性も含む）。値の後の undefined はそこへ戻り、null は外し、ほかは
// String(value)（真偽の属性は truthy なら ""）。要素自身の書き込み（"ext"）はその後の最初の状態を変えない。
describe("reflectAttribute / reflectBooleanAttribute: 書き込みの列（有界の全数）", () => {
  const DEPTH = 4;
  type Write = { v: unknown } | "ext";
  const WRITES: Write[] = [undefined, null, "", "a", 0, 1, true, false].map((v) => ({ v })).concat(["ext" as const]);
  const INITIALS: (string | null)[] = [null, "", "x"];

  function* sequences(n: number): Generator<Write[]> {
    if (n === 0) { yield []; return; }
    for (const rest of sequences(n - 1)) for (const w of WRITES) yield [...rest, w];
  }

  for (const [label, reflect, encode] of [
    ["reflectAttribute", reflectAttribute, (v: unknown) => (v === null ? null : String(v))],
    ["reflectBooleanAttribute", reflectBooleanAttribute, (v: unknown) => (v ? "" : null)],
  ] as const) {
    it(`${label}: 長さ ${DEPTH} までのすべての列で、各段の属性が模型と一致する`, () => {
      let checked = 0;
      for (const start of INITIALS) {
        for (const seq of sequences(DEPTH)) {
          const el = element(start === null ? "<x-el></x-el>" : `<x-el a="${start}"></x-el>`);
          let attr: string | null = start;
          let initial: string | null | undefined; // (unset until the first write through the helper)
          for (const w of seq) {
            if (w === "ext") {
              el.setAttribute("a", "ext");
              attr = "ext";
            } else {
              if (initial === undefined) initial = attr;
              reflect(el, "a", w.v);
              attr = w.v === undefined ? initial : encode(w.v);
            }
            if (el.getAttribute("a") !== attr) {
              throw new Error(`${label}: start ${JSON.stringify(start)}, ${JSON.stringify(seq.map((x) => (x === "ext" ? "ext" : x.v === undefined ? "undefined" : x.v)))}: expected ${JSON.stringify(attr)}, got ${JSON.stringify(el.getAttribute("a"))}`);
            }
            checked++;
          }
        }
      }
      expect(checked).toBe(INITIALS.length * DEPTH * WRITES.length ** DEPTH);
    });
  }
});
