import { describe, it, expect } from "vitest";
import {
  columnsFor, columnWidth, thumbSizeFor, dprFromQueries, leadingSpan, computeLayout, rowOf, itemsOfRows, rowsFor,
  thumbHeight, CARD_TEXT_PX,
} from "../public/js/lib/grid.js";

describe("columns", () => {
  it("as many as fit at 180 px (gaps included), at least 2, at most 8", () => {
    expect(columnsFor(0)).toBe(2);
    expect(columnsFor(300)).toBe(2);
    expect(columnsFor(372)).toBe(2); // 2×180 + 12
    expect(columnsFor(564)).toBe(3); // 3×180 + 2×12
    expect(columnsFor(563)).toBe(2);
    expect(columnsFor(972)).toBe(5);
    expect(columnsFor(5000)).toBe(8);
  });
  it("column width takes the gaps out", () => {
    expect(columnWidth(564, 3)).toBe(180);
    expect(columnWidth(0, 2)).toBe(0);
  });
});

describe("thumbnail sizes", () => {
  it("the smallest size that covers the column × the pixel ratio", () => {
    expect(thumbSizeFor(150, 1)).toBe(160);
    expect(thumbSizeFor(161, 1)).toBe(320);
    expect(thumbSizeFor(184, 1)).toBe(320);
    expect(thumbSizeFor(184, 2)).toBe(640);
    expect(thumbSizeFor(330, 2)).toBe(1280);
    expect(thumbSizeFor(900, 2)).toBe(1280); // nothing covers it: the largest
    expect(thumbSizeFor(184, 0.25)).toBe(160); // zoomed out to 25 %
  });
  it("pixel ratio from the resolution queries (upper bound of the bucket)", () => {
    expect(dprFromQueries({})).toBe(1);
    expect(dprFromQueries({ over1: true })).toBe(1.5);
    expect(dprFromQueries({ over1: true, over15: true })).toBe(2);
    expect(dprFromQueries({ over1: true, over15: true, over2: true })).toBe(3);
  });
});

describe("windowed layout", () => {
  const ratios = [0.75, 1, 0.5625, 1.333, 1, 0.75, 1.25];
  it("rows take the tallest card; the first card may start in a later column", () => {
    const l = computeLayout(ratios, { cols: 3, colW: 100, lead: 0, gap: 10 });
    expect(l.rows).toBe(3);
    expect(l.rowH).toEqual([100 + CARD_TEXT_PX, 133 + CARD_TEXT_PX, 125 + CARD_TEXT_PX]);
    expect(l.rowTop[1]).toBe(100 + CARD_TEXT_PX + 10);
    expect(l.total).toBe(l.rowTop[2] + l.rowH[2]);
    const led = computeLayout(ratios, { cols: 3, colW: 100, lead: 2, gap: 10 });
    expect(led.rows).toBe(3); // 2 empty cells + 7 cards = 9 cells
    expect(rowOf(led, 0)).toBe(0);
    expect(rowOf(led, 1)).toBe(1);
    expect(itemsOfRows(led, 1, 2, ratios.length)).toEqual([1, 4]);
  });
  it("leadingSpan keeps every card in column (index − origin) % cols", () => {
    expect(leadingSpan(0, 5)).toBe(0);
    expect(leadingSpan(7, 5)).toBe(2);
    expect(leadingSpan(-60, 7)).toBe(3); // 60 earlier photos above the origin
  });
  it("rows to render: around the view, in steps", () => {
    const many = Array.from({ length: 600 }, () => 1);
    const l = computeLayout(many, { cols: 6, colW: 100, gap: 10 }); // 100 rows
    expect(thumbHeight(1, 100)).toBe(100);
    const top = 9000;
    const [r0, r1] = rowsFor(l, top, 900, { margin: 900, step: 4 });
    expect(r0 % 4).toBe(0);
    expect(l.rowTop[r0]).toBeLessThanOrEqual(top - 900);
    expect(l.rowTop[r1 - 1] + l.rowH[r1 - 1]).toBeGreaterThanOrEqual(top + 900 + 900 - (l.rowH[0] + 10));
    expect(rowsFor(computeLayout([], { cols: 3, colW: 100 }), 0, 900)).toEqual([0, 0]);
    const [e0, e1] = rowsFor(l, 50000, 900); // past the end: still the last rows
    expect(e1).toBe(l.rows);
    expect(e0).toBeLessThan(e1);
  });
});
