// 2 つ目のコピーの警告（/protocol/define-element.ts）の共有適合テスト。
// 生成コピーと同じ単位で各パッケージへ配布される（scripts/sync-protocol-types.mjs）。
// 実レジストリではなく合成レジストリと合成クラスで全分岐を突く — 生成物の意味が
// パッケージ間でずれていないことだけを見る。
import { describe, it, expect, vi, afterEach } from "vitest";
import { PACKAGE_STAMP, defineElements, stampPackage, warnIfAnotherCopy } from "./define-element.js";

const PKG = "@wcstack/example@4.11.0";

/** `get` / `define` だけの合成レジストリ（定義を Map に記録する）。 */
function fakeRegistry(entries: [string, CustomElementConstructor][] = []) {
  const defined = new Map<string, CustomElementConstructor>(entries);
  const define = vi.fn((tag: string, cls: CustomElementConstructor) => { defined.set(tag, cls); });
  const registry = { get: (tag: string) => defined.get(tag), define } as unknown as CustomElementRegistry;
  return { registry, defined, define };
}

const element = () => class {} as unknown as CustomElementConstructor;
const stamped = (pkg: string) => {
  const cls = element();
  stampPackage(cls, pkg);
  return cls;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("defineElements", () => {
  it("未定義のタグを定義し、クラスにパッケージと版の印を付ける", () => {
    const { registry, defined } = fakeRegistry();
    const a = element();
    const b = element();
    defineElements(registry, PKG, [["x-a", a], ["x-b", b]]);
    expect(defined.get("x-a")).toBe(a);
    expect(defined.get("x-b")).toBe(b);
    expect((a as unknown as Record<symbol, string>)[PACKAGE_STAMP]).toBe(PKG);
    expect((b as unknown as Record<symbol, string>)[PACKAGE_STAMP]).toBe(PKG);
  });

  it("印のキーは Symbol.for(\"wcstack.package\")（別のコピーと共有される）", () => {
    expect(PACKAGE_STAMP).toBe(Symbol.for("wcstack.package"));
  });

  it("同じコピーがもう一度登録しても定義し直さず、何も言わない", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = element();
    const { registry, define } = fakeRegistry([["x-a", a]]);
    defineElements(registry, PKG, [["x-a", a]]);
    expect(define).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("利用者がこのコピーのクラスを継承して先に定義したタグには何も言わない", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = element();
    const sub = class extends (a as unknown as new () => object) {} as unknown as CustomElementConstructor;
    const { registry, defined } = fakeRegistry([["x-a", sub]]);
    defineElements(registry, PKG, [["x-a", a]]);
    expect(defined.get("x-a")).toBe(sub);
    expect(warn).not.toHaveBeenCalled();
  });

  it("印の無い別のコピー（4.11 より前）が定義したタグは残し、両者を名指しして警告する", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const theirs = element();
    const { registry, defined } = fakeRegistry([["x-a", theirs]]);
    defineElements(registry, PKG, [["x-a", element()]]);
    expect(defined.get("x-a")).toBe(theirs);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(
      "[@wcstack/example] [wcs/package-twice] <x-a> is already defined by an earlier copy (before 4.11); " +
      "this copy, @wcstack/example@4.11.0, does nothing. Load each package once.",
    );
  });

  it("別の版のコピーが定義したタグは、その版を名指しして警告する", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { registry } = fakeRegistry([["x-a", stamped("@wcstack/example@4.12.0")]]);
    defineElements(registry, PKG, [["x-a", element()]]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(
      "[@wcstack/example] [wcs/package-twice] <x-a> is already defined by @wcstack/example@4.12.0; " +
      "this copy, @wcstack/example@4.11.0, does nothing. Load each package once.",
    );
  });

  it("同じ版の別のコピーには何も言わない（害が無い）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const theirs = stamped(PKG);
    const { registry, defined } = fakeRegistry([["x-a", theirs]]);
    defineElements(registry, PKG, [["x-a", element()]]);
    expect(defined.get("x-a")).toBe(theirs);
    expect(warn).not.toHaveBeenCalled();
  });

  it("警告はレジストリごとに 1 回（タグごとではない）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = fakeRegistry([["x-a", element()], ["x-b", element()]]);
    defineElements(first.registry, PKG, [["x-a", element()], ["x-b", element()]]);
    defineElements(first.registry, PKG, [["x-a", element()]]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("<x-a>");
    const second = fakeRegistry([["x-b", element()]]);
    defineElements(second.registry, PKG, [["x-a", element()], ["x-b", element()]]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1][0]).toContain("<x-b>");
    expect(second.defined.has("x-a")).toBe(true);
  });
});

describe("warnIfAnotherCopy", () => {
  it("比べるクラスが無いときは印だけで決める", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnIfAnotherCopy(fakeRegistry().registry, "x-a", stamped(PKG), undefined, PKG);
    expect(warn).not.toHaveBeenCalled();
    warnIfAnotherCopy(fakeRegistry().registry, "x-a", element(), undefined, PKG);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("an earlier copy (before 4.11)");
  });
});

describe("stampPackage", () => {
  it("サブクラスは親の印を継ぎ、自分の印で上書きできる", () => {
    const parent = stamped("@wcstack/example@4.10.0");
    const child = class extends (parent as unknown as new () => object) {} as unknown as CustomElementConstructor;
    expect((child as unknown as Record<symbol, string>)[PACKAGE_STAMP]).toBe("@wcstack/example@4.10.0");
    stampPackage(child, PKG);
    expect((child as unknown as Record<symbol, string>)[PACKAGE_STAMP]).toBe(PKG);
    expect((parent as unknown as Record<symbol, string>)[PACKAGE_STAMP]).toBe("@wcstack/example@4.10.0");
  });
});
