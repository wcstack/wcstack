// Phase 3a — setProp / element-creation hardening (migration-plan §9-2 (5)):
//   - attribute→property name remapping (for→htmlFor, colspan→colSpan, …)
//   - read-only property guard (firstChild/childNodes fall through to setAttribute)
//   - SVG namespace creation (createElementNS)

import { describe, it, expect } from "vitest";
import { h, signal, flushSync } from "../src/dom.js";

describe("setProp: 属性→プロパティ名のリマップ", () => {
  it("`for` を htmlFor プロパティへ写す", () => {
    const el = h("label", { for: "field-1" }) as HTMLLabelElement;
    expect(el.htmlFor).toBe("field-1");
    expect(el.getAttribute("for")).toBe("field-1"); // htmlFor reflects to the attribute
  });

  it("`tabindex` を tabIndex（数値プロパティ）へ写す", () => {
    const el = h("div", { tabindex: 3 }) as HTMLDivElement;
    expect(el.tabIndex).toBe(3);
  });

  it("`colspan` / `rowspan` を colSpan / rowSpan へ写す", () => {
    const td = h("td", { colspan: 2, rowspan: 3 }) as HTMLTableCellElement;
    expect(td.colSpan).toBe(2);
    expect(td.rowSpan).toBe(3);
  });

  it("リアクティブ値でもリマップ先プロパティが更新される", () => {
    const id = signal("a");
    const el = h("label", { for: () => id.get() }) as HTMLLabelElement;
    expect(el.htmlFor).toBe("a");
    id.set("b");
    flushSync();
    expect(el.htmlFor).toBe("b");
  });
});

describe("setProp: read-only プロパティのガード", () => {
  it("read-only な DOM メンバー（firstChild）への代入は throw せず属性へ退避", () => {
    // `firstChild` is `in el` but has no setter — the old `key in el` path would
    // throw on assignment in strict mode. The guard must route it to setAttribute.
    expect(() => h("div", { firstChild: "x" })).not.toThrow();
    const el = h("div", { firstChild: "x" }) as HTMLDivElement;
    expect(el.getAttribute("firstChild")).toBe("x");
    expect(el.firstChild).toBeNull(); // the real property is untouched
  });

  it("writable な標準プロパティ（id）は従来どおりプロパティ代入", () => {
    const el = h("div", { id: "main" }) as HTMLDivElement;
    expect(el.id).toBe("main");
  });

  it("未知の属性は setAttribute にフォールバック", () => {
    const el = h("div", { "data-x": "y" }) as HTMLDivElement;
    expect(el.getAttribute("data-x")).toBe("y");
  });

  it("own データプロパティ（カスタム要素のフィールド）はプロパティ代入する", () => {
    // The field is an OWN data descriptor (writable), exercising the data-property
    // arm of the settability check (vs the accessor arm for DOM props like `id`).
    class FieldEl extends HTMLElement {
      foo = "init";
    }
    customElements.define("field-el", FieldEl);
    const el = h("field-el", { foo: "bar" }) as FieldEl;
    expect(el.foo).toBe("bar");
  });
});

describe("h: SVG 名前空間", () => {
  it("svg / path を SVG 名前空間で生成する", () => {
    const svg = h("svg", { viewBox: "0 0 10 10" },
      h("path", { d: "M0 0L10 10" }),
    ) as SVGElement;
    expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
    const path = svg.firstChild as SVGElement;
    expect(path.namespaceURI).toBe("http://www.w3.org/2000/svg");
    // SVG props are read-only → attributes are set via setAttribute.
    expect(svg.getAttribute("viewBox")).toBe("0 0 10 10");
    expect(path.getAttribute("d")).toBe("M0 0L10 10");
  });

  it("HTML と名前が衝突しないタグは HTML のまま", () => {
    const div = h("div") as HTMLElement;
    expect(div.namespaceURI).toBe("http://www.w3.org/1999/xhtml");
  });

  it("SVG 要素への class は属性経路で設定する（className 代入は SVG で throw）", () => {
    // SVGElement.className is a read-only SVGAnimatedString; assigning it throws in
    // strict mode. class must go through setAttribute (works for HTML and SVG).
    const svg = h("svg", { class: "icon" }, h("path", { class: "stroke" })) as SVGElement;
    expect(svg.getAttribute("class")).toBe("icon");
    expect((svg.firstChild as SVGElement).getAttribute("class")).toBe("stroke");
  });
});

describe("setProp: style オブジェクト形式", () => {
  it("camelCase / kebab-case / CSS カスタムプロパティを全て適用する", () => {
    const el = h("div", {
      style: { color: "blue", "font-weight": "bold", "--accent": "red" },
    }) as HTMLElement;
    expect(el.style.getPropertyValue("color")).toBe("blue");
    expect(el.style.getPropertyValue("font-weight")).toBe("bold"); // kebab via setProperty
    expect(el.style.getPropertyValue("--accent")).toBe("red"); // custom property
  });
});
