// Free counts and the stock check — shared so the server's 422 and the pages' numbers agree.

import type { Booking, IsoDate, Reservation, ReservationLine } from "./api.ts";
import { eachDay, overlaps } from "./dates.ts";

/** How many are booked on one day. */
export function bookedOn(bookings: readonly Booking[], day: IsoDate): number {
  let n = 0;
  for (const b of bookings) if (b.from <= day && day <= b.to) n += b.quantity;
  return n;
}

/** Free on one day (never below 0). */
export function freeOn(stock: number, bookings: readonly Booking[], day: IsoDate): number {
  return Math.max(0, stock - bookedOn(bookings, day));
}

/** The least free on any day of the period. */
export function freeInPeriod(stock: number, bookings: readonly Booking[], from: IsoDate, to: IsoDate): number {
  if (from > to) return 0;
  let min = stock;
  for (const day of eachDay(from, to)) {
    const f = freeOn(stock, bookings, day);
    if (f < min) min = f;
    if (min === 0) break;
  }
  return min;
}

export interface StockConflict {
  itemId: number;
  itemName: string;
  day: IsoDate;
  need: number;
  stock: number;
}

/**
 * Would approving `candidate` exceed an item's stock on some day, together with the
 * requests already approved? Returns the first conflicting day per item (in line order).
 */
export function stockConflicts(candidate: Pick<Reservation, "id" | "lines">, approved: readonly Pick<Reservation, "id" | "lines" | "status">[]): StockConflict[] {
  const out: StockConflict[] = [];
  const seen = new Set<number>();
  // The candidate's own lines for one item add up (two lines of the same item, different periods may overlap).
  for (const line of candidate.lines) {
    if (seen.has(line.itemId)) continue;
    const mine = candidate.lines.filter((l) => l.itemId === line.itemId);
    const others: Booking[] = [];
    for (const r of approved) {
      if (r.id === candidate.id || r.status !== "approved") continue;
      for (const l of r.lines) if (l.itemId === line.itemId) others.push(l);
    }
    const days = new Set<IsoDate>();
    for (const l of mine) for (const d of eachDay(l.from, l.to)) days.add(d);
    for (const day of [...days].sort()) {
      const need = bookedOn(mine, day) + bookedOn(others, day);
      if (need > line.stock) {
        out.push({ itemId: line.itemId, itemName: line.itemName, day, need, stock: line.stock });
        seen.add(line.itemId);
        break;
      }
    }
  }
  return out;
}

/** Bookings of one item from a list of reservations (pending and approved count). */
export function bookingsOf(itemId: number, reservations: readonly Pick<Reservation, "status" | "lines">[], window?: { from: IsoDate; to: IsoDate }): Booking[] {
  const out: Booking[] = [];
  for (const r of reservations) {
    if (r.status !== "approved" && r.status !== "pending") continue;
    for (const l of r.lines as readonly ReservationLine[]) {
      if (l.itemId !== itemId) continue;
      if (window && !overlaps(l.from, l.to, window.from, window.to)) continue;
      out.push({ from: l.from, to: l.to, quantity: l.quantity });
    }
  }
  return out;
}
