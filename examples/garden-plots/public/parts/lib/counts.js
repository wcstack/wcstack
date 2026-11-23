// みどり市 共通部品 — the arithmetic the garden parts and the pages share (and the unit tests check).

/** The statuses a plot can have, in display order, with their Japanese labels. */
export const STATUSES = [
  { key: "free", label: "空き" },
  { key: "used", label: "利用中" },
  { key: "renewal", label: "更新待ち" },
  { key: "paused", label: "休止" },
];
export const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.key, s.label]));

/** A plot counts as "in use" when someone holds it: 利用中 and 更新待ち. */
export function isInUse(status) {
  return status === "used" || status === "renewal";
}

/**
 * Counts a list of statuses.
 * @param {string[]} statuses
 * @returns {{ total: number, free: number, used: number, renewal: number, paused: number, inUse: number }}
 */
export function countStatuses(statuses) {
  const c = { total: 0, free: 0, used: 0, renewal: 0, paused: 0, inUse: 0 };
  for (const s of statuses ?? []) {
    c.total += 1;
    if (s in c && s !== "total" && s !== "inUse") c[s] += 1;
    if (isInUse(s)) c.inUse += 1;
  }
  return c;
}

/** Plots in use / all plots, as a whole percentage (0 when there are no plots). */
export function usagePercent(inUse, total) {
  if (!total) return 0;
  return Math.round((inUse / total) * 100);
}

/** Does a plot status match the filter? "all" (or nothing) matches everything. */
export function matchesFilter(status, filter) {
  return !filter || filter === "all" || status === filter;
}

/** The statuses of every plot of a list of gardens (the API shape). */
export function allStatuses(gardens) {
  return (gardens ?? []).flatMap((g) => (g.areas ?? []).flatMap((a) => (a.plots ?? []).map((p) => p.status)));
}

/** The family name: the part of the name before the first space (full-width or not). */
export function familyName(name) {
  if (!name) return "";
  return String(name).trim().split(/[\s　]+/)[0];
}
