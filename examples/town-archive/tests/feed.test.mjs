import { describe, it, expect } from "vitest";
import {
  filterKey, emptyFeed, plan, mergePage, nextUp, nextDown, holds, windowStartFor, decadeOf, listSearch, apiQuery,
  reachedEnd,
} from "../public/js/lib/feed.js";

const page = (offset, n, total) => ({ offset, total, items: Array.from({ length: n }, (_, i) => ({ id: offset + i + 1 })) });

describe("which pages to ask for", () => {
  const key = filterKey({ q: "路面電車" });
  it("the first page, then the next one when the end is near, one at a time", () => {
    let f = emptyFeed(key);
    expect(plan(f)).toEqual({ offset: 0, limit: 60, dir: "first" });
    f = mergePage(f, page(0, 60, 150), key);
    expect(plan(f)).toBeNull(); // the end is not near
    expect(plan(f, { wantDown: true })).toEqual({ offset: 60, limit: 60, dir: "down" });
    expect(plan(f, { wantDown: true, busy: true })).toBeNull(); // one at a time
    expect(plan(f, { wantDown: true, failed: true })).toBeNull(); // waits for もう一度
    f = mergePage(f, page(60, 60, 150), key);
    f = mergePage(f, page(120, 30, 150), key);
    expect(reachedEnd(f)).toBe(true);
    expect(plan(f, { wantDown: true })).toBeNull();
  });
  it("a window that starts later grows upwards too, by short pages down to 0", () => {
    let f = emptyFeed(key, 6662);
    expect(plan(f)).toEqual({ offset: 6662, limit: 60, dir: "first" });
    f = mergePage(f, page(6662, 60, 11731), key);
    expect(nextUp(f)).toEqual({ offset: 6602, limit: 60, dir: "up" });
    expect(plan(f, { wantDown: true, wantUp: true }).dir).toBe("down"); // down first
    const g = mergePage(emptyFeed(key, 40), page(40, 60, 100), key);
    expect(nextUp(g)).toEqual({ offset: 0, limit: 40, dir: "up" });
    expect(nextDown(g)).toBeNull();
  });
});

describe("merging pages at both ends", () => {
  const key = filterKey({});
  it("appends, prepends, ignores what does not belong", () => {
    let f = mergePage(emptyFeed(key, 120), page(120, 60, 1000), key);
    const before = f;
    expect(mergePage(f, page(120, 60, 1000), key)).toBe(before); // the same page again
    expect(mergePage(f, page(300, 60, 1000), key)).toBe(before); // not adjacent
    expect(mergePage(f, page(180, 60, 1000), filterKey({ q: "x" }))).toBe(before); // another filter
    f = mergePage(f, page(180, 60, 1000), key);
    expect(f.items.length).toBe(120);
    f = mergePage(f, page(60, 60, 1000), key);
    expect(f.start).toBe(60);
    expect(f.items[0].id).toBe(61);
    expect(f.items.map((p) => p.id)).toEqual(Array.from({ length: 180 }, (_, i) => 61 + i));
    expect(holds(f, 60)).toBe(true);
    expect(holds(f, 240)).toBe(false);
  });
  it("does not copy the rows (the same objects stay in the list)", () => {
    const p1 = page(0, 60, 200);
    let f = mergePage(emptyFeed(key), p1, key);
    const p2 = page(60, 60, 200);
    f = mergePage(f, p2, key);
    expect(f.items[0]).toBe(p1.items[0]);
    expect(f.items[60]).toBe(p2.items[0]);
  });
});

describe("urls and decades", () => {
  it("the list's query has only what differs from the default", () => {
    expect(listSearch({})).toBe("");
    expect(listSearch({ q: " 港 ", area: "minato", sort: "new" })).toBe("?q=%E6%B8%AF&area=minato&sort=new");
    expect(apiQuery({ sort: "title" })).toBe("q=&area=&sort=title");
    expect(filterKey({ q: "a " })).toBe(filterKey({ q: "a", sort: "old" }));
  });
  it("decades and page starts", () => {
    expect(decadeOf(1999)).toBe(1990);
    expect(windowStartFor(499)).toBe(480);
  });
});
