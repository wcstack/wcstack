import { describe, it, expect, beforeEach } from "vitest";
import { config, getConfig, setConfig } from "../src/config.js";
import { bootstrapViewTransition } from "../src/bootstrapViewTransition.js";
import { registerComponents } from "../src/registerComponents.js";
import { WcsViewTransition } from "../src/components/ViewTransition.js";

describe("config", () => {
  beforeEach(() => {
    setConfig({ tagNames: { viewTransition: "wcs-view-transition" } });
  });

  it("既定のタグ名は wcs-view-transition", () => {
    expect(config.tagNames.viewTransition).toBe("wcs-view-transition");
  });

  it("setConfig でタグ名を上書きできる", () => {
    setConfig({ tagNames: { viewTransition: "my-transition" } });
    expect(config.tagNames.viewTransition).toBe("my-transition");
  });

  it("tagNames を含まない setConfig は no-op", () => {
    setConfig({});
    expect(config.tagNames.viewTransition).toBe("wcs-view-transition");
  });

  it("getConfig は凍結スナップショットを返し、setConfig 後は作り直す", () => {
    const first = getConfig();
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.tagNames)).toBe(true);
    expect(getConfig()).toBe(first);

    setConfig({ tagNames: { viewTransition: "other-transition" } });
    expect(getConfig()).not.toBe(first);
    setConfig({ tagNames: { viewTransition: "wcs-view-transition" } });
  });
});

describe("bootstrapViewTransition", () => {
  it("タグを登録する（二重登録は no-op）", () => {
    bootstrapViewTransition();
    expect(customElements.get("wcs-view-transition")).toBe(WcsViewTransition);
    expect(() => bootstrapViewTransition()).not.toThrow();
  });

  it("userConfig を渡すとタグ名を差し替えて登録する", () => {
    const defined: string[] = [];
    const registry = {
      get: () => undefined,
      define: (name: string) => { defined.push(name); },
    } as unknown as CustomElementRegistry;
    bootstrapViewTransition({ tagNames: { viewTransition: "custom-view-transition" } }, registry);
    expect(defined).toEqual(["custom-view-transition"]);
    setConfig({ tagNames: { viewTransition: "wcs-view-transition" } });
  });

  it("スコープ付きレジストリへも登録できる", () => {
    const defined: string[] = [];
    const registry = {
      get: () => undefined,
      define: (name: string) => { defined.push(name); },
    } as unknown as CustomElementRegistry;
    registerComponents(registry);
    expect(defined).toEqual(["wcs-view-transition"]);
  });
});
