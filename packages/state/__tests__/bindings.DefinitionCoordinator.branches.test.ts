import { describe, expect, it, vi } from "vitest";
import { DefinitionCoordinator, getDefinitionCoordinator } from "../src/bindings/DefinitionCoordinator";
import type { ICustomElementRegistryAdapter } from "../src/platform/customElementRegistry";

describe("DefinitionCoordinator branch ownership", () => {
  it("rejection を全 active waiter に配送し、default reject と二重 cancel を安全に扱うこと", async () => {
    let rejectDefinition!: (error: unknown) => void;
    const registry = {
      get: vi.fn(),
      whenDefined: vi.fn(() => new Promise<CustomElementConstructor>((_, reject) => {
        rejectDefinition = reject;
      })),
    } as ICustomElementRegistryAdapter;
    const coordinator = new DefinitionCoordinator(registry);
    const rejected = vi.fn();
    const cancel = coordinator.wait("X-Rejected", vi.fn(), rejected);
    coordinator.wait("x-rejected", vi.fn());

    cancel();
    cancel();
    rejectDefinition(new Error("definition failed"));
    await Promise.resolve();
    await Promise.resolve();

    expect(rejected).not.toHaveBeenCalled();
    expect(coordinator.pendingCount("x-rejected")).toBe(0);
  });

  it("reject callback と defensive settle branches を処理し、registry cache を再利用すること", async () => {
    let rejectDefinition!: (error: unknown) => void;
    const registry = {
      get: vi.fn(),
      whenDefined: vi.fn(() => new Promise<CustomElementConstructor>((_, reject) => {
        rejectDefinition = reject;
      })),
    } as ICustomElementRegistryAdapter;
    const coordinator = getDefinitionCoordinator(registry);
    const rejected = vi.fn();
    coordinator.wait("x-reject-active", vi.fn(), rejected);

    rejectDefinition(new Error("no definition"));
    await Promise.resolve();
    await Promise.resolve();
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(getDefinitionCoordinator(registry)).toBe(coordinator);

    (coordinator as any).settle("missing-entry", null);
    const inactive = { active: false, resolve: vi.fn(), reject: vi.fn() };
    (coordinator as any).entries.set("inactive-entry", { waiters: new Set([inactive]) });
    (coordinator as any).settle("inactive-entry", null);
    expect(inactive.resolve).not.toHaveBeenCalled();
  });
});
