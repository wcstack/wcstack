/**
 * twice.test.ts — `[wcs/package-twice]` for `<wcs-state>` / `<wcs-ssr>` (src/twice.ts,
 * docs/timing-and-firing-contract.md §24): the full entries wrap the core's define() and say when
 * another copy of @wcstack/state defined the tags first. The helper itself is tested by the shared
 * copy (protocol.defineElement.test.ts).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { defineOnce } from "../src/twice";
import { WcsState } from "../src/element";
import { bootstrapState, VERSION } from "../src/exports";
import { setConfig } from "../src/config";
import { PACKAGE_STAMP, stampPackage } from "../src/protocol/defineElement";

const PKG = `@wcstack/state@${VERSION}`;

/** `get` / `define` だけの合成レジストリ（定義を Map に記録する）。 */
function fakeRegistry(entries: [string, CustomElementConstructor][] = []) {
  const defined = new Map<string, CustomElementConstructor>(entries);
  const registry = {
    get: (tag: string) => defined.get(tag),
    define: (tag: string, cls: CustomElementConstructor) => { defined.set(tag, cls); },
  } as unknown as CustomElementRegistry;
  return { registry, defined };
}

const foreign = (stamp?: string) => {
  const cls = class {} as unknown as CustomElementConstructor;
  if (stamp !== undefined) stampPackage(cls, stamp);
  return cls;
};
const stampOf = (cls: CustomElementConstructor | undefined) => (cls as unknown as Record<symbol, string | undefined>)[PACKAGE_STAMP];

/** the core's define() as far as this wrapper sees it: `<wcs-state>`, and `<wcs-ssr>` when `ssr` */
const coreDefine = (r: { registry: CustomElementRegistry }, ssr = true) => () => {
  if (r.registry.get("wcs-state") === undefined) r.registry.define("wcs-state", class extends WcsState {});
  if (ssr && r.registry.get("wcs-ssr") === undefined) r.registry.define("wcs-ssr", foreign());
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("defineOnce", () => {
  it("定義したタグに @wcstack/state の版の印を付け、何も言わない", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = fakeRegistry();
    defineOnce(coreDefine(r), r.registry);
    expect(stampOf(r.defined.get("wcs-state"))).toBe(PKG);
    expect(stampOf(r.defined.get("wcs-ssr"))).toBe(PKG);
    expect(warn).not.toHaveBeenCalled();
  });

  it("ssr の add-on が無ければ <wcs-state> にだけ印を付ける", () => {
    const r = fakeRegistry();
    defineOnce(coreDefine(r, false), r.registry);
    expect(stampOf(r.defined.get("wcs-state"))).toBe(PKG);
    expect(r.defined.has("wcs-ssr")).toBe(false);
  });

  it("このコピーがもう一度定義しても、利用者が WcsState の派生を定義していても何も言わない", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const again = fakeRegistry();
    defineOnce(coreDefine(again), again.registry);
    defineOnce(coreDefine(again), again.registry);
    const adopter = fakeRegistry([["wcs-state", class extends WcsState {} as unknown as CustomElementConstructor]]);
    defineOnce(coreDefine(adopter), adopter.registry);
    expect(warn).not.toHaveBeenCalled();
  });

  it("印の無い別のコピー（4.11 より前）の <wcs-state> を名指しして 1 回警告する", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const theirs = foreign();
    const r = fakeRegistry([["wcs-state", theirs], ["wcs-ssr", foreign()]]);
    defineOnce(coreDefine(r), r.registry);
    expect(r.defined.get("wcs-state")).toBe(theirs);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(
      "[@wcstack/state] [wcs/package-twice] <wcs-state> is already defined by an earlier copy (before 4.11); " +
      `this copy, ${PKG}, does nothing. Load each package once.`,
    );
  });

  it("別の版のコピーはその版を名指しし、同じ版のコピーには何も言わない", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const same = fakeRegistry([["wcs-state", foreign(PKG)]]);
    defineOnce(coreDefine(same), same.registry);
    expect(warn).not.toHaveBeenCalled();
    const other = fakeRegistry([["wcs-state", foreign("@wcstack/state@4.12.0")]]);
    defineOnce(coreDefine(other), other.registry);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("<wcs-state> is already defined by @wcstack/state@4.12.0;");
  });

  it("<wcs-ssr> だけ別のコピーが定義していれば、それを名指しする（同じ版なら何も言わない）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const same = fakeRegistry([["wcs-ssr", foreign(PKG)]]);
    defineOnce(coreDefine(same), same.registry);
    expect(warn).not.toHaveBeenCalled();
    const other = fakeRegistry([["wcs-ssr", foreign()]]);
    defineOnce(coreDefine(other), other.registry);
    expect(stampOf(other.defined.get("wcs-state"))).toBe(PKG);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("<wcs-ssr> is already defined by an earlier copy (before 4.11);");
  });
});

describe("bootstrapState（`.`）", () => {
  it("別のコピーの <wcs-state> が先にあれば警告し、無ければ定義して印を付ける", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fresh = fakeRegistry();
    bootstrapState(undefined, fresh.registry);
    expect(stampOf(fresh.defined.get("wcs-state"))).toBe(PKG);
    expect(stampOf(fresh.defined.get("wcs-ssr"))).toBe(PKG);
    expect(warn).not.toHaveBeenCalled();
    const taken = fakeRegistry([["wcs-state", foreign()]]);
    bootstrapState(undefined, taken.registry);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("[wcs/package-twice] <wcs-state>");
  });

  it("config の tagNames で名前を変えたタグを見る", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = fakeRegistry([["x-twice-state", foreign()]]);
    try {
      bootstrapState({ tagNames: { state: "x-twice-state" } }, r.registry);
    } finally {
      setConfig({ tagNames: { state: "wcs-state" } });
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("<x-twice-state> is already defined by an earlier copy");
  });
});
