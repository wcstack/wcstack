import { describe, it, expect } from "vitest";
import { SeenBatcher, isSeen } from "../public/js/lib/seen.js";

describe("見た写真", () => {
  it("half of the card on the screen, or half of the screen for a card taller than two screens", () => {
    expect(isSeen({ isIntersecting: true, intersectionRatio: 0.5 })).toBe(true);
    expect(isSeen({ isIntersecting: true, intersectionRatio: 0.49, intersectionRect: { height: 100 }, rootBounds: { height: 800 } })).toBe(false);
    expect(isSeen({ isIntersecting: true, intersectionRatio: 0.3, intersectionRect: { height: 400 }, rootBounds: { height: 400 } })).toBe(true);
    expect(isSeen({ isIntersecting: false, intersectionRatio: 0 })).toBe(false);
  });
  it("each id once per visit, in batches; a failed batch goes back; a beacon takes the rest", () => {
    const b = new SeenBatcher();
    for (const id of [1, 2, 3, 2, 1]) b.add(id);
    expect(b.waiting).toBe(3);
    expect(b.take(2)).toEqual([1, 2]);
    expect(b.take(2)).toEqual([]); // one batch in flight at a time
    b.failed();
    expect(b.waiting).toBe(3);
    expect(b.take()).toEqual([1, 2, 3]);
    b.done();
    expect(b.add(3)).toBe(false); // already reported this visit
    for (let i = 10; i < 260; i++) b.add(i);
    const batches = b.drainForBeacon(100);
    expect(batches.map((x) => x.length)).toEqual([100, 100, 50]);
    expect(b.waiting).toBe(0);
  });
});
