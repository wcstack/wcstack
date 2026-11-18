// The cart: lines, merging and totals. Pure functions (no wcstack), unit-tested.

import type { IsoDate, ReservationLineInput } from "../../shared/api.ts";
import { formatPeriod, isIsoDate } from "../../shared/dates.ts";

export interface CartLine {
  /** itemId:from:to — one line per item and period */
  key: string;
  itemId: number;
  name: string;
  centerId: number;
  deposit: number;
  /** what was free on every day of the period when the line was added */
  max: number;
  from: IsoDate;
  to: IsoDate;
  quantity: number;
}

export interface CartTotals {
  lines: number;
  items: number;
  deposit: number;
}

export function lineKey(itemId: number, from: IsoDate, to: IsoDate): string {
  return `${itemId}:${from}:${to}`;
}

/** Add a line; the same item for the same period adds to that line (capped at its max). */
export function mergeLine(cart: readonly CartLine[], add: Omit<CartLine, "key">): CartLine[] {
  const key = lineKey(add.itemId, add.from, add.to);
  const i = cart.findIndex((l) => l.key === key);
  if (i < 0) return [...cart, { ...add, key, quantity: Math.min(add.quantity, add.max) }];
  const cur = cart[i]!;
  const max = Math.max(cur.max, add.max);
  return cart.with(i, { ...cur, max, quantity: Math.min(max, cur.quantity + add.quantity) });
}

export function lineDeposit(line: Pick<CartLine, "deposit" | "quantity">): number {
  return line.deposit * line.quantity;
}

export function cartTotals(cart: readonly Pick<CartLine, "deposit" | "quantity">[]): CartTotals {
  let items = 0;
  let deposit = 0;
  for (const l of cart) {
    items += l.quantity;
    deposit += lineDeposit(l);
  }
  return { lines: cart.length, items, deposit };
}

export function periodLabel(line: Pick<CartLine, "from" | "to">): string {
  return formatPeriod(line.from, line.to);
}

export function toRequestLines(cart: readonly CartLine[]): ReservationLineInput[] {
  return cart.map((l) => ({ itemId: l.itemId, from: l.from, to: l.to, quantity: l.quantity }));
}

/** A stored cart comes from localStorage (another version, another tab): keep only well-formed lines. */
export function sanitizeCart(v: unknown): CartLine[] | null {
  if (!Array.isArray(v)) return null;
  const out: CartLine[] = [];
  for (const x of v as unknown[]) {
    if (!x || typeof x !== "object") continue;
    const l = x as Record<string, unknown>;
    if (typeof l.itemId !== "number" || !isIsoDate(l.from) || !isIsoDate(l.to) || typeof l.quantity !== "number") continue;
    out.push({
      key: lineKey(l.itemId, l.from, l.to),
      itemId: l.itemId,
      name: typeof l.name === "string" ? l.name : `備品 ${l.itemId}`,
      centerId: typeof l.centerId === "number" ? l.centerId : 0,
      deposit: typeof l.deposit === "number" ? l.deposit : 0,
      max: typeof l.max === "number" ? l.max : l.quantity,
      from: l.from,
      to: l.to,
      quantity: l.quantity,
    });
  }
  return out;
}

export function yen(n: number): string {
  return `${n.toLocaleString("ja-JP")}円`;
}
