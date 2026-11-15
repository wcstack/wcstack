// The list the public site shows: a window [start, start + items.length) of one result,
// which grows at both ends. Pure functions; every change returns a new feed object.

export const PAGE_SIZE = 60;

/** The key of a filter: two feeds with the same key show the same result. */
export function filterKey({ q = "", area = "", sort = "old" } = {}) {
  return JSON.stringify([String(q).trim(), area || "", sort || "old"]);
}

export function emptyFeed(key, start = 0) {
  return { key, start, items: [], total: null, pages: [] };
}

export function endOffset(feed) {
  return feed.start + feed.items.length;
}

/** Everything after the window has been loaded. */
export function reachedEnd(feed) {
  return feed.total !== null && endOffset(feed) >= feed.total;
}

/** Everything before the window has been loaded. */
export function reachedStart(feed) {
  return feed.start <= 0;
}

/** The request that extends the window downwards, or null. */
export function nextDown(feed, pageSize = PAGE_SIZE) {
  if (reachedEnd(feed)) return null;
  return { offset: endOffset(feed), limit: pageSize, dir: "down" };
}

/** The request that extends the window upwards, or null. */
export function nextUp(feed, pageSize = PAGE_SIZE) {
  if (reachedStart(feed) || feed.total === null) return null;
  const offset = Math.max(0, feed.start - pageSize);
  return { offset, limit: feed.start - offset, dir: "up" };
}

/**
 * Which request to make now. `wantDown` / `wantUp`: the sentinel at that end is near the
 * screen. `busy`: a request is on its way. `failed`: the last request failed and waits for
 * もう一度. Down wins over up when both are wanted (the user reads downwards).
 */
export function plan(feed, { wantDown = false, wantUp = false, busy = false, failed = false } = {}, pageSize = PAGE_SIZE) {
  if (busy || failed) return null;
  if (feed.total === null) return { offset: feed.start, limit: pageSize, dir: "first" };
  if (wantDown) { const r = nextDown(feed, pageSize); if (r) return r; }
  if (wantUp) { const r = nextUp(feed, pageSize); if (r) return r; }
  return null;
}

/**
 * Merge a page answered for `feed.key` into the feed. Returns the same feed object when the
 * page does not belong (another key, not adjacent, already merged) — the caller can compare
 * identities to know whether anything changed. The rows themselves are not copied.
 */
export function mergePage(feed, page, key) {
  if (key !== undefined && key !== feed.key) return feed;
  if (!page || !Array.isArray(page.items)) return feed;
  const offset = Number(page.offset) || 0;
  if (feed.pages.includes(offset)) return feed;
  const total = Number(page.total);
  if (feed.total === null) {
    if (offset !== feed.start) return feed;
    return { ...feed, items: page.items, total, pages: [offset] };
  }
  if (offset === endOffset(feed)) {
    return { ...feed, items: feed.items.concat(page.items), total, pages: [...feed.pages, offset] };
  }
  if (offset + page.items.length === feed.start) {
    return { ...feed, start: offset, items: page.items.concat(feed.items), total, pages: [...feed.pages, offset] };
  }
  return feed;
}

/** Where to start a window that should show `offset` (a decade, a photo): its page start. */
export function windowStartFor(offset, pageSize = PAGE_SIZE) {
  return Math.max(0, Math.floor(offset / pageSize) * pageSize);
}

/** Is `offset` inside what the feed holds? */
export function holds(feed, offset) {
  return offset >= feed.start && offset < endOffset(feed);
}

/** The decade (1950, 1960, …) of a year. */
export function decadeOf(year) {
  return Math.floor(Number(year) / 10) * 10;
}

export const DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010];

/** The query string of the list for a filter (only what differs from the default). */
export function listSearch({ q = "", area = "", sort = "old" } = {}) {
  const p = new URLSearchParams();
  if (String(q).trim()) p.set("q", String(q).trim());
  if (area) p.set("area", area);
  if (sort && sort !== "old") p.set("sort", sort);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** The API query for a filter. */
export function apiQuery({ q = "", area = "", sort = "old" } = {}) {
  const p = new URLSearchParams();
  p.set("q", String(q).trim());
  p.set("area", area || "");
  p.set("sort", sort || "old");
  return p.toString();
}
