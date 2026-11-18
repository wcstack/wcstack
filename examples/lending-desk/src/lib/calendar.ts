// The item page's month calendar: free counts per day, today, the chosen period. Pure, unit-tested.

import type { Booking, IsoDate } from "../../shared/api.ts";
import { addMonths, daysInMonth, formatMonth, weekday } from "../../shared/dates.ts";
import { freeOn } from "../../shared/stock.ts";

export interface CalendarDay {
  /** "" for the padding cells before the 1st / after the last day */
  date: IsoDate;
  day: number;
  free: number;
  /** before today, or past the last day that can be chosen */
  disabled: boolean;
  isToday: boolean;
  none: boolean;
  /** first or last day of the chosen period */
  edge: boolean;
  inRange: boolean;
  pad: boolean;
  label: string;
}

export interface CalendarWeek {
  days: CalendarDay[];
}

export interface CalendarInput {
  month: string;
  today: IsoDate;
  lastDay: IsoDate;
  stock: number;
  booked: readonly Booking[];
  from: IsoDate;
  to: IsoDate;
}

export function buildCalendar(c: CalendarInput): CalendarWeek[] {
  const n = daysInMonth(c.month);
  const first = `${c.month}-01`;
  const lead = weekday(first);
  const cells: CalendarDay[] = [];
  const pad = (): CalendarDay => ({ date: "", day: 0, free: 0, disabled: true, isToday: false, none: false, edge: false, inRange: false, pad: true, label: "" });
  for (let i = 0; i < lead; i++) cells.push(pad());
  for (let d = 1; d <= n; d++) {
    const date = `${c.month}-${String(d).padStart(2, "0")}`;
    const free = freeOn(c.stock, c.booked, date);
    const disabled = date < c.today || date > c.lastDay;
    const edge = date === c.from || date === c.to;
    const inRange = c.from !== "" && c.to !== "" && c.from <= date && date <= c.to;
    cells.push({
      date, day: d, free, disabled, isToday: date === c.today, none: !disabled && free === 0, edge, inRange, pad: false,
      label: disabled ? "" : `空き ${free}`,
    });
  }
  while (cells.length % 7 !== 0) cells.push(pad());
  const weeks: CalendarWeek[] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push({ days: cells.slice(i, i + 7) });
  return weeks;
}

/** First click picks `from`; a second click picks `to` (swapped when before `from`); a third starts over. */
export function clickDay(from: IsoDate, to: IsoDate, date: IsoDate): { from: IsoDate; to: IsoDate } {
  if (from === "" || to !== "") return { from: date, to: "" };
  if (date < from) return { from: date, to: from };
  return { from, to: date };
}

export function monthTitle(month: string): string {
  return formatMonth(month);
}

export function canGoPrev(month: string, today: IsoDate): boolean {
  return month > today.slice(0, 7);
}

/** At most 3 months ahead of this month. */
export function canGoNext(month: string, today: IsoDate): boolean {
  return month < addMonths(today.slice(0, 7), 3);
}
