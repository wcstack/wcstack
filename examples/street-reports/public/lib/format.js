// Dates are always shown in Japan time, regardless of the browser's time zone.
const TIME_ZONE = 'Asia/Tokyo';
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function tokyoParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = {};
  for (const p of partsFormatter.formatToParts(date)) parts[p.type] = p.value;
  return parts;
}

/** `2026/11/20` */
export function formatDate(value) {
  const p = tokyoParts(value);
  return `${p.year}/${p.month}/${p.day}`;
}

/** `2026/11/20 09:00` */
export function formatDateTime(value) {
  const p = tokyoParts(value);
  return `${formatDate(value)} ${p.hour}:${p.minute}`;
}

/** `2026-11-20` — the calendar day in Japan, as used by the date inputs and the export API. */
export function toIsoDay(value) {
  const p = tokyoParts(value);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Adds whole days to a `YYYY-MM-DD` string. */
export function addDays(isoDay, days) {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** たった今 / n 分前 / n 時間前 / YYYY/MM/DD */
export function formatRelative(value, now = new Date()) {
  const diff = now.getTime() - new Date(value).getTime();
  if (diff < MINUTE) return 'たった今';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分前`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 時間前`;
  return formatDate(value);
}

export function daysBetween(fromIso, toIso) {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / DAY;
}
