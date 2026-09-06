// Test-only shim for ElementInternals / CustomStateSet, which happy-dom does
// not implement (docs/custom-state-reflection-design.md §3.6). Installed
// exactly once from setup.ts, and only when the real API is absent, so a
// future happy-dom release that adds it is never shadowed.

interface FakeElementInternals {
  states: Set<string>;
}

const internalsByElement = new WeakMap<HTMLElement, FakeElementInternals>();

export function installElementInternalsShim(): void {
  if (typeof HTMLElement.prototype.attachInternals === "function") {
    return;
  }

  HTMLElement.prototype.attachInternals = function (this: HTMLElement): ElementInternals {
    if (internalsByElement.has(this)) {
      throw new DOMException(
        "attachInternals() has already been called on this element.",
        "NotSupportedError",
      );
    }
    const fake: FakeElementInternals = { states: new Set<string>() };
    internalsByElement.set(this, fake);
    return fake as unknown as ElementInternals;
  };
}

// Test inspection helper: reads back the CustomStateSet-equivalent for an
// element that went through the shimmed attachInternals(). Returns undefined
// if the element never called attachInternals() (e.g. _internals is null).
export function getStates(el: HTMLElement): Set<string> | undefined {
  return internalsByElement.get(el)?.states;
}
