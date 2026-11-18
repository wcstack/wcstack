import { describe, expect, it } from "vitest";
import type { Reservation, ReservationLine } from "../../shared/api.ts";
import { bookedOn, bookingsOf, freeInPeriod, freeOn, stockConflicts } from "../../shared/stock.ts";

const line = (itemId: number, from: string, to: string, quantity: number, stock = 2, itemName = "プロジェクター"): ReservationLine =>
  ({ itemId, from, to, quantity, itemName, centerId: 1, stock, deposit: 1000 });
const res = (id: number, status: Reservation["status"], lines: ReservationLine[]): Reservation =>
  ({ id, groupId: "G01", groupName: "x", status, lines, purpose: "p", pickupAt: "2026-12-01T09:00", createdAt: "2026-11-01T09:00" });

describe("free counts from reservations", () => {
  const booked = [{ from: "2026-12-05", to: "2026-12-06", quantity: 1 }, { from: "2026-12-06", to: "2026-12-07", quantity: 2 }];
  it("per day", () => {
    expect(bookedOn(booked, "2026-12-05")).toBe(1);
    expect(bookedOn(booked, "2026-12-06")).toBe(3);
    expect(freeOn(5, booked, "2026-12-06")).toBe(2);
    expect(freeOn(2, booked, "2026-12-06")).toBe(0);
  });
  it("the least free on any day of the period", () => {
    expect(freeInPeriod(5, booked, "2026-12-04", "2026-12-05")).toBe(4);
    expect(freeInPeriod(5, booked, "2026-12-04", "2026-12-08")).toBe(2);
    expect(freeInPeriod(5, booked, "2026-12-08", "2026-12-04")).toBe(0);
  });
  it("only approved and pending requests book stock", () => {
    const list = [res(1, "approved", [line(7, "2026-12-01", "2026-12-02", 1)]), res(2, "denied", [line(7, "2026-12-01", "2026-12-02", 1)]),
      res(3, "pending", [line(7, "2026-12-02", "2026-12-03", 1)]), res(4, "cancelled", [line(7, "2026-12-01", "2026-12-01", 1)])];
    expect(bookingsOf(7, list)).toHaveLength(2);
    expect(bookingsOf(7, list, { from: "2026-12-03", to: "2026-12-10" })).toHaveLength(1);
  });
});

describe("the stock check of /admin", () => {
  it("marks a request that would exceed the stock together with approved ones", () => {
    const approved = [res(1, "approved", [line(7, "2026-12-05", "2026-12-06", 1)])];
    const candidate = res(2, "pending", [line(7, "2026-12-04", "2026-12-05", 2)]);
    expect(stockConflicts(candidate, approved)).toEqual([{ itemId: 7, itemName: "プロジェクター", day: "2026-12-05", need: 3, stock: 2 }]);
  });
  it("ignores pending, denied and its own entry", () => {
    const others = [res(1, "pending", [line(7, "2026-12-05", "2026-12-05", 2)]), res(2, "denied", [line(7, "2026-12-05", "2026-12-05", 2)])];
    const candidate = res(3, "pending", [line(7, "2026-12-05", "2026-12-05", 2)]);
    expect(stockConflicts(candidate, [...others, candidate])).toEqual([]);
  });
  it("adds the candidate's own lines of one item", () => {
    const candidate = res(3, "pending", [line(7, "2026-12-05", "2026-12-06", 1), line(7, "2026-12-06", "2026-12-07", 2)]);
    expect(stockConflicts(candidate, [])[0]?.day).toBe("2026-12-06");
  });
});
