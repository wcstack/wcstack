import { expect } from "vitest";
import { DefinedSnapshot } from "../src/types.js";

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

// The Custom Elements registry has no un-define and persists across `it` blocks in
// a file, so every test must use a fresh tag name. A monotonic counter gives stable,
// collision-free names (no Math.random needed).
let _seq = 0;

/** A unique, valid custom element tag name for this test run. */
export function uniqueTag(prefix = "wcs-test"): string {
  _seq++;
  return `${prefix}-${_seq}`;
}

/** Register a trivial element under `tag`, resolving its whenDefined() waiters. */
export function defineTag(tag: string): void {
  customElements.define(tag, class extends HTMLElement {});
}

/** Flush pending microtasks so whenDefined()'s .then()/.catch() handlers run. */
export function flush(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve());
}

/** Assert the snapshot invariant `total === count + pending + missing`. */
export function expectInvariant(snap: DefinedSnapshot): void {
  expect(snap.total).toBe(snap.count + snap.pending.length + snap.missing.length);
}
