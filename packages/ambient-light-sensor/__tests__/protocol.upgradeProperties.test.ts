// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /protocol/upgrade-properties.test.ts by scripts/sync-protocol-types.mjs.
// Run `node scripts/sync-protocol-types.mjs` after editing the source.
// ===========================================================================

// property upgrade（/protocol/upgrade-properties.ts）の共有適合テスト。
// 生成コピーと同じ単位で各パッケージへ配布される（scripts/sync-protocol-types.mjs）。
// 実 Shell ではなく合成オブジェクトで全分岐を突く — 生成物の意味が
// パッケージ間でずれていないことだけを見る。
import { describe, it, expect, vi } from "vitest";
import { upgradeProperties } from "../src/protocol/upgradeProperties.js";

const declaration = (inputs?: { name: string }[]) => ({
  protocol: "wc-bindable" as const,
  version: 1,
  properties: [],
  ...(inputs === undefined ? {} : { inputs }),
});

class WithAccessor {
  static wcBindable = declaration([{ name: "url" }]);
  applied: string[] = [];
  private _url = "";
  get url(): string { return this._url; }
  set url(value: string) { this._url = value; this.applied.push(value); }
}

class WithDataPropertyOnPrototype {
  static wcBindable = declaration([{ name: "plain" }]);
}
(WithDataPropertyOnPrototype.prototype as unknown as { plain: string }).plain = "proto";

class WithoutAnything {
  static wcBindable = declaration([{ name: "missing" }]);
}

class WithoutInputs {
  static wcBindable = declaration();
}

describe("upgradeProperties", () => {
  it("upgrade 前に代入された own プロパティを setter へ通し直す", () => {
    const el = new WithAccessor();
    // upgrade 前の framework 代入を再現（accessor を own データプロパティが隠している状態）
    Object.defineProperty(el, "url", { value: "/late", writable: true, configurable: true, enumerable: true });
    expect(el.applied).toEqual([]);

    upgradeProperties(el);

    expect(Object.prototype.hasOwnProperty.call(el, "url")).toBe(false);
    expect(el.url).toBe("/late");
    expect(el.applied).toEqual(["/late"]);
  });

  it("冪等（2 回目以降は own プロパティが無いので何もしない）", () => {
    const el = new WithAccessor();
    Object.defineProperty(el, "url", { value: "/once", writable: true, configurable: true, enumerable: true });
    upgradeProperties(el);
    upgradeProperties(el);
    expect(el.applied).toEqual(["/once"]);
  });

  it("own プロパティが無ければ何もしない", () => {
    const el = new WithAccessor();
    upgradeProperties(el);
    expect(el.applied).toEqual([]);
  });

  it("prototype 側が accessor でなければ own プロパティを触らない", () => {
    const el = new WithDataPropertyOnPrototype() as unknown as Record<string, unknown>;
    Object.defineProperty(el, "plain", { value: "own", writable: true, configurable: true, enumerable: true });
    upgradeProperties(el);
    expect(Object.prototype.hasOwnProperty.call(el, "plain")).toBe(true);
    expect(el.plain).toBe("own");
  });

  it("prototype チェーンのどこにも無い名前は触らない", () => {
    const el = new WithoutAnything() as unknown as Record<string, unknown>;
    Object.defineProperty(el, "missing", { value: 1, writable: true, configurable: true, enumerable: true });
    upgradeProperties(el);
    expect(Object.prototype.hasOwnProperty.call(el, "missing")).toBe(true);
  });

  it("inputs 宣言が無ければ何もしない", () => {
    const el = new WithoutInputs() as unknown as Record<string, unknown>;
    Object.defineProperty(el, "whatever", { value: 1, writable: true, configurable: true, enumerable: true });
    upgradeProperties(el);
    expect(el.whatever).toBe(1);
  });

  it("wcBindable を持たないオブジェクトでも落ちない", () => {
    const plain = { a: 1 };
    expect(() => upgradeProperties(plain)).not.toThrow();
  });

  describe("属性になってしまったオブジェクトの入力（[wcs/input-as-attribute]）", () => {
    class WithAttributes {
      static wcBindable = declaration([{ name: "files" }, { name: "url" }]);
      localName = "wcs-upload";
      attrs: Record<string, string> = {};
      getAttribute(name: string): string | null { return name in this.attrs ? this.attrs[name] : null; }
    }

    it("値が [object …] の属性は、タグと属性を添えて要素ごとに 1 回だけ警告する", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const el = new WithAttributes();
        el.attrs.files = "[object File]";
        upgradeProperties(el);
        upgradeProperties(el);
        const said = warn.mock.calls.filter((c) => String(c[0]).includes("[wcs/input-as-attribute]"));
        expect(said).toHaveLength(1);
        expect(String(said[0][0])).toContain('<wcs-upload> has the attribute files="[object File]"');
        expect(said[0][1]).toBe(el);
      } finally {
        warn.mockRestore();
      }
    });

    it("ふつうの文字列の属性や、getAttribute を持たない対象では言わない", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const el = new WithAttributes();
        el.attrs.url = "/api/upload";
        upgradeProperties(el);
        upgradeProperties(new WithAccessor());
        expect(warn.mock.calls.filter((c) => String(c[0]).includes("[wcs/input-as-attribute]"))).toHaveLength(0);
      } finally {
        warn.mockRestore();
      }
    });

    it("localName の無い対象でも落ちない", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        class Anonymous {
          static wcBindable = declaration([{ name: "body" }]);
          getAttribute(): string { return "[object Object]"; }
        }
        upgradeProperties(new Anonymous());
        expect(String(warn.mock.calls[0][0])).toContain("<element>");
      } finally {
        warn.mockRestore();
      }
    });
  });
});
