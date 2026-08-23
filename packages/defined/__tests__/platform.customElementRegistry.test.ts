import { afterEach, describe, expect, it, vi } from "vitest";
import { getCustomElementRegistry } from "../src/platform/customElementRegistry.js";

describe("customElementRegistry platform adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("既定では global registry を operation 時に解決する", () => {
    expect(getCustomElementRegistry()?.get).toBeTypeOf("function");
    expect(getCustomElementRegistry()?.whenDefined).toBeTypeOf("function");
    expect(getCustomElementRegistry(undefined)?.get).toBeTypeOf("function");
  });

  it("node の scoped registry を global より優先する", () => {
    const scoped = { get: vi.fn(), whenDefined: vi.fn() };
    expect(getCustomElementRegistry({ customElementRegistry: scoped } as unknown as Node))
      .toBe(scoped);
  });

  it("null レジストリの node は global へ fallback せず null を返す", () => {
    // global 側で定義済みのタグを「このツリーでも使える」と誤報しないため。
    expect(getCustomElementRegistry({ customElementRegistry: null } as unknown as Node))
      .toBeNull();
  });

  it("scoped registry を持たない platform の node は global へ fallback する", () => {
    const element = document.createElement("div");
    expect(getCustomElementRegistry(element)?.get).toBeTypeOf("function");
  });

  it("browser global が無い環境では null を返し module import を妨げない", () => {
    vi.stubGlobal("customElements", undefined);
    expect(getCustomElementRegistry()).toBeNull();
  });

  it("必要な registry surface が欠ける owner を拒否する", () => {
    const reject = (scoped: unknown) =>
      getCustomElementRegistry({ customElementRegistry: scoped } as unknown as Node);
    expect(reject("not-an-object")).toBeNull();
    expect(reject({})).toBeNull();
    expect(reject({ get() {} })).toBeNull();
  });
});
