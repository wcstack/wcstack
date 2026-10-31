// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /protocol/define-element.registration.test.ts by scripts/sync-protocol-types.mjs.
// Run `node scripts/sync-protocol-types.mjs` after editing the source.
// ===========================================================================

// 各パッケージの registerComponents が、2 つ目のコピーの規則（/protocol/define-element.ts、
// docs/timing-and-firing-contract.md §24）に従うことの適合テスト。
// コピーでだけ動く: import はコピーの置き場所（packages/<pkg>/__tests__/）から見たパス。
// タグとクラスはパッケージごとに違うので、空の合成レジストリへの登録から読む。
import { describe, it, expect, vi, afterEach } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { registerComponents } from "../src/registerComponents.js";
import { PACKAGE_STAMP, stampPackage } from "../src/protocol/defineElement.js";

const PKG = `${pkg.name}@${pkg.version}`;

/** `get` / `define` だけの合成レジストリ（定義を Map に記録する）。 */
function fakeRegistry(entries: [string, CustomElementConstructor][] = []) {
  const defined = new Map<string, CustomElementConstructor>(entries);
  const define = vi.fn((tag: string, cls: CustomElementConstructor) => { defined.set(tag, cls); });
  const registry = { get: (tag: string) => defined.get(tag), define } as unknown as CustomElementRegistry;
  return { registry, defined, define };
}

/** このパッケージが定義するタグとクラス。 */
function definitions(): [string, CustomElementConstructor][] {
  const { registry, defined } = fakeRegistry();
  registerComponents(registry);
  return [...defined];
}

const stampOf = (cls: CustomElementConstructor) => (cls as unknown as Record<symbol, string | undefined>)[PACKAGE_STAMP];

/** 別のコピーのクラスを全タグに先に定義したレジストリ（印は `stamp`、無ければ版を名乗らないコピー）。 */
function definedByAnotherCopy(stamp?: string) {
  return fakeRegistry(definitions().map(([tag]) => {
    const cls = class {} as unknown as CustomElementConstructor;
    if (stamp !== undefined) stampPackage(cls, stamp);
    return [tag, cls];
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe(`registerComponents（${pkg.name}）と別のコピー`, () => {
  it("空のレジストリには全タグを定義し、クラスにパッケージと版の印を付ける", () => {
    const defs = definitions();
    expect(defs.length).toBeGreaterThan(0);
    for (const [, cls] of defs) expect(stampOf(cls)).toBe(PKG);
  });

  it("同じコピーがもう一度登録しても定義し直さず、何も言わない", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { registry, define } = fakeRegistry(definitions());
    registerComponents(registry);
    expect(define).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("版を名乗らない別のコピーが先に定義していれば、何も定義せず 1 回だけ警告する", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { registry, define } = definedByAnotherCopy();
    const [[firstTag]] = definitions();
    registerComponents(registry);
    expect(define).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(
      `[${pkg.name}] [wcs/package-twice] <${firstTag}> is already defined by another copy of ${pkg.name} that does not name its version; ` +
      `this copy, ${PKG}, does nothing. Load each package once.`,
    );
  });

  it("別の版のコピーが先に定義していれば、その版を名指しして警告する", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { registry } = definedByAnotherCopy(`${pkg.name}@4.2.0`);
    registerComponents(registry);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(`is already defined by ${pkg.name}@4.2.0; this copy, ${PKG}, does nothing.`);
  });

  it("同じ版の別のコピーには何も言わない", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { registry, define } = definedByAnotherCopy(PKG);
    registerComponents(registry);
    expect(define).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("利用者がこのパッケージのクラスを継承して先に定義したタグには何も言わない", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { registry, define } = fakeRegistry(definitions().map(([tag, cls]) => [
      tag,
      class extends (cls as unknown as new () => HTMLElement) {} as unknown as CustomElementConstructor,
    ]));
    registerComponents(registry);
    expect(define).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
