import { describe, it, expect } from "vitest";
import {
  compareBy, sortRecords, filterRecords, matches, reposition, visibleWindow, rangeIds, headerState, keepListed,
  moveIndex, scrollToKeep,
} from "../public/js/lib/table.js";

const recs = [
  { id: 1, title: "港の夕暮れ", year: 1960, area: "minato", tags: ["風景"], public: true, updatedAt: "2025-01-02" },
  { id: 2, title: "駅前の朝", year: 1990, area: "ekimae", tags: ["路面電車"], public: false, updatedAt: "2025-01-01" },
  { id: 3, title: "あおぞら", year: 1960, area: "kita", tags: [], public: true, updatedAt: "2025-01-03" },
];

describe("sorting and filtering", () => {
  it("by a column, reversed, ties by id", () => {
    expect(sortRecords(recs, "year", 1).map((r) => r.id)).toEqual([1, 3, 2]);
    expect(sortRecords(recs, "year", -1).map((r) => r.id)).toEqual([2, 1, 3]);
    expect(sortRecords(recs, "title", 1)[0].id).toBe(3);
    expect(sortRecords(recs, "public", 1)[0].id).toBe(2);
  });
  it("title and tags, every word, and the 地区", () => {
    expect(filterRecords(recs, "電車", "").map((r) => r.id)).toEqual([2]);
    expect(filterRecords(recs, "港 夕暮れ", "").map((r) => r.id)).toEqual([1]);
    expect(filterRecords(recs, "", "kita").map((r) => r.id)).toEqual([3]);
    expect(filterRecords(recs, "", "")).toBe(recs);
    expect(matches(recs[0], "朝", "")).toBe(false);
  });
  it("a changed record takes its place in the order", () => {
    const cmp = compareBy("year", 1);
    const sorted = sortRecords(recs, "year", 1);
    const changed = { ...recs[1], year: 1950 };
    expect(reposition(sorted, recs[1], changed, cmp).map((r) => r.id)).toEqual([2, 1, 3]);
    const added = { id: 4, title: "新", year: 1975, area: "kita", tags: [], public: true, updatedAt: "x" };
    expect(reposition(sorted, null, added, cmp).map((r) => r.id)).toEqual([1, 3, 4, 2]);
  });
});

describe("the visible window", () => {
  it("rows around the visible part, never past the ends", () => {
    expect(visibleWindow(0, 640, 12000)).toEqual({ start: 0, end: 31 });
    expect(visibleWindow(32 * 5000, 640, 12000)).toEqual({ start: 4990, end: 5031 });
    expect(visibleWindow(32 * 12000, 640, 12000)).toEqual({ start: 11990, end: 12000 });
    expect(visibleWindow(0, 640, 0)).toEqual({ start: 0, end: 0 });
  });
  it("keeps a row in view", () => {
    expect(scrollToKeep(10, 0, 320)).toBe(32 * 11 - 320);
    expect(scrollToKeep(2, 320, 320)).toBe(64);
    expect(scrollToKeep(12, 320, 320)).toBe(320);
  });
});

describe("selection", () => {
  const ids = [5, 9, 2, 7, 1];
  it("Shift+click ranges in the order shown", () => {
    expect(rangeIds(ids, 9, 7)).toEqual([9, 2, 7]);
    expect(rangeIds(ids, 7, 9)).toEqual([9, 2, 7]);
    expect(rangeIds(ids, 42, 7)).toEqual([7]);
  });
  it("the header box: none / some / all of what is listed", () => {
    expect(headerState(ids, new Set())).toBe("none");
    expect(headerState(ids, new Set([9]))).toBe("some");
    expect(headerState(ids, new Set(ids))).toBe("all");
    expect(headerState([], new Set([1]))).toBe("none");
  });
  it("a filter keeps selected only what is still listed", () => {
    const sel = new Set([1, 2, 3]);
    expect([...keepListed(sel, [2, 3, 4])]).toEqual([2, 3]);
    expect(keepListed(sel, [1, 2, 3, 4])).toBe(sel);
  });
  it("keys move the current row", () => {
    expect(moveIndex("ArrowDown", -1, 10, 5)).toBe(0);
    expect(moveIndex("ArrowUp", 0, 10, 5)).toBe(0);
    expect(moveIndex("PageDown", 3, 10, 5)).toBe(8);
    expect(moveIndex("End", 3, 10, 5)).toBe(9);
    expect(moveIndex("Home", 3, 10, 5)).toBe(0);
    expect(moveIndex("x", 3, 10, 5)).toBeNull();
  });
});
