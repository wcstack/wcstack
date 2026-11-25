import { CATEGORIES, STATUSES } from './labels.js';
import { addDays, daysBetween, toIsoDay } from './format.js';

/** Aggregates exported reports for the statistics page. */
export function aggregate(reports, from, to) {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  const matrix = Object.fromEntries(CATEGORIES.map((c) => [c, Object.fromEntries(STATUSES.map((s) => [s, 0]))]));
  const perDayMap = new Map();
  for (let day = from; day <= to; day = addDays(day, 1)) perDayMap.set(day, 0);

  let closedCount = 0;
  let closedDays = 0;
  for (const r of reports) {
    byStatus[r.status] += 1;
    byCategory[r.category] += 1;
    matrix[r.category][r.status] += 1;
    const day = toIsoDay(r.reportedAt);
    if (perDayMap.has(day)) perDayMap.set(day, perDayMap.get(day) + 1);
    if (r.status === 'done' && r.closedAt) {
      closedCount += 1;
      closedDays += daysBetween(r.reportedAt, r.closedAt);
    }
  }

  return {
    total: reports.length,
    byStatus,
    byCategory,
    perDay: [...perDayMap].map(([day, count]) => ({ day, count })),
    averageDays: closedCount ? closedDays / closedCount : null,
    rows: CATEGORIES.map((category) => ({
      category,
      ...matrix[category],
      total: STATUSES.reduce((sum, s) => sum + matrix[category][s], 0),
    })),
  };
}

/** Stable sort of matrix rows by a numeric column. */
export function sortRows(rows, key, direction) {
  if (!key) return rows;
  const factor = direction === 'descending' ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => (a.row[key] - b.row[key]) * factor || a.index - b.index)
    .map(({ row }) => row);
}

export function formatAverageDays(value) {
  return value == null ? '—' : `${value.toFixed(1)} 日`;
}

/** The [from, to] range for a preset of n days ending today. */
export function presetRange(days, today) {
  return { from: addDays(today, -(days - 1)), to: today };
}
