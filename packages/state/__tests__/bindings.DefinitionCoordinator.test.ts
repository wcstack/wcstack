import { describe, expect, it, vi } from "vitest";
import { DefinitionCoordinator } from "../src/bindings/DefinitionCoordinator";
import type { ICustomElementRegistryAdapter } from "../src/platform/customElementRegistry";

describe("DefinitionCoordinator", () => {
  it("registry/tag ごとに whenDefined を共有し、cancel 済み waiter を保持しないこと", async () => {
    let define!: (constructor: CustomElementConstructor) => void;
    const whenDefined = vi.fn(() => new Promise<CustomElementConstructor>((resolve) => {
      define = resolve;
    }));
    const coordinator = new DefinitionCoordinator({
      get: vi.fn(),
      whenDefined,
    } as ICustomElementRegistryAdapter);
    const first = vi.fn();
    const second = vi.fn();

    const cancelFirst = coordinator.wait("x-shared-definition", first);
    coordinator.wait("x-shared-definition", second);
    cancelFirst();

    expect(whenDefined).toHaveBeenCalledTimes(1);
    expect(coordinator.pendingCount("x-shared-definition")).toBe(1);

    define(class extends HTMLElement {});
    await Promise.resolve();
    await Promise.resolve();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(coordinator.pendingCount("x-shared-definition")).toBe(0);
  });
});
