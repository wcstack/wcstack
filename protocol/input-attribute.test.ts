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
