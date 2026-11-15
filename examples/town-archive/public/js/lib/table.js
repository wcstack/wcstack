// The cataloguers' table (整理台帳): sorting, filtering, the visible window, selection ranges.
// Pure functions — no DOM, no signals.

export const ROW_PX = 32;

const collator = new Intl.Collator("ja");

/** Compare two records by `key` in direction `dir` (1 / -1); ties by id, always ascending. */
export function compareBy(key, dir = 1) {
  const d = dir < 0 ? -1 : 1;
  const by = {
    id: (a, b) => a.id - b.id,
    title: (a, b) => collator.compare(a.title, b.title),
    year: (a, b) => a.year - b.year,
    area: (a, b) => (a.area < b.area ? -1 : a.area > b.area ? 1 : 0),
    tags: (a, b) => collator.compare(a.tags.join(","), b.tags.join(",")),
    public: (a, b) => Number(a.public) - Number(b.public),
    updatedAt: (a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0),
  }[key] ?? ((a, b) => a.id - b.id);
  return (a, b) => d * by(a, b) || a.id - b.id;
}

export function sortRecords(records, key, dir) {
  return records.slice().sort(compareBy(key, dir));
}

/** Does a record match the filter box (title or tags, every word) and the 地区? */
export function matches(record, text, area) {
  if (area && record.area !== area) return false;
  const words = String(text ?? "").trim().split(/[\s　]+/).filter(Boolean);
  for (const w of words) {
    if (!record.title.includes(w) && !record.tags.some((t) => t.includes(w))) return false;
  }
  return true;
}

export function filterRecords(sorted, text, area) {
  if (!String(text ?? "").trim() && !area) return sorted;
  return sorted.filter((r) => matches(r, text, area));
}

/**
 * Put `next` (a new version of a record, or a new record) at its place in `sorted`.
 * `old` is the version it replaces (or null). Returns a new array; O(log n) to find, O(n) to copy.
 */
export function reposition(sorted, old, next, cmp) {
  const out = sorted.slice();
  if (old) {
    let i = indexOfSorted(out, old, cmp);
    if (i < 0 || out[i].id !== old.id) i = out.findIndex((r) => r.id === old.id);
    if (i >= 0) out.splice(i, 1);
  }
  let lo = 0, hi = out.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cmp(out[mid], next) < 0) lo = mid + 1; else hi = mid;
  }
  out.splice(lo, 0, next);
  return out;
}

function indexOfSorted(arr, rec, cmp) {
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = cmp(arr[mid], rec);
    if (c === 0) return mid;
    if (c < 0) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}

/** Rows [start, end) to have in the document for a scroll position, with `overscan` rows each side. */
export function visibleWindow(scrollTop, viewportHeight, total, { rowHeight = ROW_PX, overscan = 10 } = {}) {
  if (total <= 0) return { start: 0, end: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const count = Math.ceil(Math.max(0, viewportHeight) / rowHeight) + 1;
  const start = Math.max(0, first - overscan);
  const end = Math.min(total, first + count + overscan);
  return { start: Math.min(start, end), end };
}

/** The ids from `anchorId` to `targetId` (both included) in the order `ids`. */
export function rangeIds(ids, anchorId, targetId) {
  const a = ids.indexOf(anchorId);
  const b = ids.indexOf(targetId);
  if (b < 0) return [];
  if (a < 0) return [targetId];
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return ids.slice(lo, hi + 1);
}

/** "none" | "some" | "all": how much of the listed rows is selected (for the header checkbox). */
export function headerState(listedIds, selected) {
  if (!listedIds.length) return "none";
  let n = 0;
  for (const id of listedIds) if (selected.has(id)) n++;
  return n === 0 ? "none" : n === listedIds.length ? "all" : "some";
}

/** The selection after a filter: only what is still listed. */
export function keepListed(selected, listedIds) {
  const listed = new Set(listedIds);
  const out = new Set();
  for (const id of selected) if (listed.has(id)) out.add(id);
  return out.size === selected.size ? selected : out;
}

/** Where the current row goes for a key (↑ ↓ PageUp PageDown Home End); null for other keys. */
export function moveIndex(key, index, total, pageRows) {
  if (total <= 0) return null;
  const i = index < 0 ? -1 : index;
  switch (key) {
    case "ArrowDown": return Math.min(total - 1, i + 1);
    case "ArrowUp": return Math.max(0, i < 0 ? 0 : i - 1);
    case "PageDown": return Math.min(total - 1, Math.max(0, i) + pageRows);
    case "PageUp": return Math.max(0, i - pageRows);
    case "Home": return 0;
    case "End": return total - 1;
    default: return null;
  }
}

/** scrollTop that keeps row `index` in view (or the same scrollTop when it already is). */
export function scrollToKeep(index, scrollTop, viewportHeight, rowHeight = ROW_PX) {
  const top = index * rowHeight;
  const bottom = top + rowHeight;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewportHeight) return bottom - viewportHeight;
  return scrollTop;
}

export function formatUpdated(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
