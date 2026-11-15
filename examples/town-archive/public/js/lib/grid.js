// Columns and thumbnail sizes for the photo grid. Pure functions — no DOM.

export const COLUMN_MIN_PX = 180;
export const COLUMNS_MIN = 2;
export const COLUMNS_MAX = 8;
export const GRID_GAP_PX = 12;
export const THUMB_SIZES = [160, 320, 640, 1280];

/** How many columns of at least `min` px fit in `width` px (gaps included), clamped to [2, 8]. */
export function columnsFor(width, { min = COLUMN_MIN_PX, gap = GRID_GAP_PX, lo = COLUMNS_MIN, hi = COLUMNS_MAX } = {}) {
  const w = Number(width) || 0;
  const fit = Math.floor((w + gap) / (min + gap));
  return Math.max(lo, Math.min(hi, fit));
}

/** The width of one column in px. */
export function columnWidth(width, cols, gap = GRID_GAP_PX) {
  const w = Number(width) || 0;
  if (cols <= 0) return 0;
  return Math.max(0, (w - gap * (cols - 1)) / cols);
}

/** The smallest server size that covers `cssWidth` × `dpr` device pixels (the largest when none does). */
export function thumbSizeFor(cssWidth, dpr = 1, sizes = THUMB_SIZES) {
  const need = Math.ceil((Number(cssWidth) || 0) * (Number(dpr) || 1));
  for (const s of sizes) if (s >= need) return s;
  return sizes[sizes.length - 1];
}

/** Device pixel ratio from the answers of a few resolution media queries (the bucket's upper bound). */
export function dprFromQueries({ over1 = false, over15 = false, over2 = false, over3 = false } = {}) {
  if (over3) return 4;
  if (over2) return 3;
  if (over15) return 2;
  if (over1) return 1.5;
  return 1;
}

/** Grid columns for the first card so that every card keeps column (globalIndex % cols). */
export function leadingSpan(start, cols) {
  if (!cols) return 0;
  return ((start % cols) + cols) % cols;
}

// ---------------------------------------------------------------- windowed rendering
// Every card is a thumbnail of a known shape plus a text block of a fixed height, so the place of
// every row can be computed without the DOM: the list renders only the rows near the screen and
// spacers stand for the rest (the scrollbar still spans everything loaded).

export const CARD_TEXT_PX = 74; // title (2 lines) + year + paddings + borders — must match site.css

/** Height in px of a thumbnail of `ratio` (h / w) in a column `colW` px wide (whole pixels). */
export function thumbHeight(ratio, colW) {
  return Math.max(1, Math.round(colW * ratio));
}

/**
 * Rows of a grid whose first item sits in column `lead`. `ratios[k]` is h / w of item k.
 * Returns { rows, rowTop: number[], rowH: number[], total, lead, cols }.
 */
export function computeLayout(ratios, { cols, colW, lead = 0, gap = GRID_GAP_PX, textH = CARD_TEXT_PX }) {
  const n = ratios.length;
  const rowTop = [];
  const rowH = [];
  if (!cols || n === 0) return { rows: 0, rowTop, rowH, total: 0, lead, cols };
  const rows = Math.ceil((n + lead) / cols);
  let y = 0;
  for (let r = 0; r < rows; r++) {
    const from = Math.max(0, r * cols - lead);
    const to = Math.min(n, (r + 1) * cols - lead);
    let h = 0;
    for (let k = from; k < to; k++) h = Math.max(h, thumbHeight(ratios[k], colW));
    rowTop.push(y);
    rowH.push(h + textH);
    y += h + textH + gap;
  }
  return { rows, rowTop, rowH, total: Math.max(0, y - gap), lead, cols };
}

/** The row of item k. */
export function rowOf(layout, k) {
  return Math.floor((k + layout.lead) / layout.cols);
}

/** The items of rows [r0, r1): [from, to). */
export function itemsOfRows(layout, r0, r1, n) {
  if (!layout.cols) return [0, 0];
  return [Math.max(0, r0 * layout.cols - layout.lead), Math.min(n, r1 * layout.cols - layout.lead)];
}

/**
 * Rows to render for a view [top, top + height) in grid coordinates, with `margin` px more on each
 * side. Returned in steps of `step` rows so that small scrolls change nothing.
 */
export function rowsFor(layout, top, height, { margin = height, step = 4 } = {}) {
  if (!layout.rows) return [0, 0];
  const a = top - margin;
  const b = top + height + margin;
  let r0 = 0;
  let lo = 0, hi = layout.rows - 1;
  while (lo <= hi) { // first row whose bottom is below a
    const mid = (lo + hi) >> 1;
    if (layout.rowTop[mid] + layout.rowH[mid] < a) lo = mid + 1; else hi = mid - 1;
  }
  r0 = Math.min(lo, layout.rows - 1); // a view past the end (the layout just shrank): the last rows
  let r1 = r0;
  while (r1 < layout.rows && layout.rowTop[r1] < b) r1++;
  r0 = Math.max(0, Math.floor(r0 / step) * step);
  r1 = Math.min(layout.rows, Math.ceil(r1 / step) * step);
  if (r1 <= r0) r1 = Math.min(layout.rows, r0 + step);
  return [r0, r1];
}
