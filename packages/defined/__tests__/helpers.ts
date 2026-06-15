import { expect } from "vitest";
import { DefinedSnapshot } from "../src/types.js";

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
