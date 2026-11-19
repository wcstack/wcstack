// Date arithmetic on "YYYY-MM-DD" strings, shared by the server and the pages.
// Never `new Date("2026-12-05")` (midnight UTC — the day before west of Greenwich): every
// calculation here goes through Date.UTC and reads the UTC fields back, so the browser's
// time zone never enters it.

import type { IsoDate } from "./api.ts";

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(s: unknown): s is IsoDate {
  if (typeof s !== "string") return false;
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

function toUtcMs(s: IsoDate): number {
  const m = ISO_RE.exec(s);
  if (!m) throw new Error(`not a date: ${s}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fromUtcMs(ms: number): IsoDate {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

const DAY = 86_400_000;

export function addDays(s: IsoDate, n: number): IsoDate {
  return fromUtcMs(toUtcMs(s) + n * DAY);
}

/** Whole days from a to b (b - a). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY);
}

/** Days in the period, both ends included (12/5〜12/6 is 2). */
export function periodDays(from: IsoDate, to: IsoDate): number {
  return diffDays(from, to) + 1;
}

/** Every day of the period, both ends included. */
export function eachDay(from: IsoDate, to: IsoDate): IsoDate[] {
  const n = periodDays(from, to);
  const out: IsoDate[] = [];
  for (let i = 0; i < n; i++) out.push(addDays(from, i));
  return out;
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(s: IsoDate): number {
  return new Date(toUtcMs(s)).getUTCDay();
}

export const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** "12/5(土)" */
export function formatShort(s: IsoDate): string {
  const m = ISO_RE.exec(s);
  if (!m) return s;
  return `${Number(m[2])}/${Number(m[3])}(${WEEKDAYS_JA[weekday(s)]})`;
}

/** "12/5(土)〜12/6(日)・2日" */
export function formatPeriod(from: IsoDate, to: IsoDate): string {
  return `${formatShort(from)}〜${formatShort(to)}・${periodDays(from, to)}日`;
}

/** "2026年12月5日(土)" */
export function formatLong(s: IsoDate): string {
  const m = ISO_RE.exec(s);
  if (!m) return s;
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日(${WEEKDAYS_JA[weekday(s)]})`;
}

/** "YYYY-MM" of a date */
export function monthOf(s: IsoDate): string {
  return s.slice(0, 7);
}

/** "YYYY-MM" + n months */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/** The same day n months later, clamped to the month's last day (1/31 + 1 → 2/28). */
export function addMonthsToDate(s: IsoDate, n: number): IsoDate {
  const month = addMonths(monthOf(s), n);
  const day = Number(s.slice(8, 10));
  const last = daysInMonth(month);
  return `${month}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** "2026年12月" */
export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${y}年${m}月`;
}

/** Today's date in Japan for an instant (ms since epoch), whatever the runtime's time zone. */
export function japanDate(ms: number): IsoDate {
  // Japan has no daylight saving time: UTC+9 all year.
  return fromUtcMs(Math.floor((ms + 9 * 3_600_000) / DAY) * DAY);
}

/** "YYYY-MM-DDTHH:mm" in Japan for an instant. */
export function japanDateTime(ms: number): string {
  const d = new Date(ms + 9 * 3_600_000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${japanDate(ms)}T${hh}:${mm}`;
}

/** Do two periods share a day? */
export function overlaps(aFrom: IsoDate, aTo: IsoDate, bFrom: IsoDate, bTo: IsoDate): boolean {
  return aFrom <= bTo && bFrom <= aTo;
}

/** "12/5 10:00" from "YYYY-MM-DDTHH:mm" */
export function formatDateTime(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
  if (!m) return s;
  return `${Number(m[2])}/${Number(m[3])}(${WEEKDAYS_JA[weekday(`${m[1]}-${m[2]}-${m[3]}`)]}) ${m[4]}:${m[5]}`;
}
