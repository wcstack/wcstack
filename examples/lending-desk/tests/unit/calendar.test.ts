import { describe, expect, it } from "vitest";
import { buildCalendar, canGoNext, canGoPrev, clickDay } from "../../src/lib/calendar.ts";

describe("the month calendar", () => {
  const weeks = buildCalendar({ month: "2026-12", today: "2026-12-03", lastDay: "2027-03-03", stock: 2,
    booked: [{ from: "2026-12-05", to: "2026-12-06", quantity: 2 }], from: "2026-12-10", to: "2026-12-12" });
  const days = weeks.flatMap((w) => w.days).filter((d) => !d.pad);
  it("has whole weeks starting on Sunday", () => {
    expect(weeks.every((w) => w.days.length === 7)).toBe(true);
    expect(weeks[0]?.days.findIndex((d) => !d.pad)).toBe(2); // 2026-12-01 is a Tuesday
    expect(days).toHaveLength(31);
  });
  it("free per day, none marked, today marked, past days disabled", () => {
    expect(days[4]).toMatchObject({ date: "2026-12-05", free: 0, none: true, label: "空き 0" });
    expect(days[2]).toMatchObject({ isToday: true, disabled: false });
    expect(days[1]).toMatchObject({ disabled: true, label: "" });
  });
  it("the chosen period", () => {
    expect(days.filter((d) => d.inRange).map((d) => d.day)).toEqual([10, 11, 12]);
    expect(days.filter((d) => d.edge).map((d) => d.day)).toEqual([10, 12]);
  });
  it("first click, second click, a click before the first swaps, a third starts over", () => {
    expect(clickDay("", "", "2026-12-10")).toEqual({ from: "2026-12-10", to: "" });
    expect(clickDay("2026-12-10", "", "2026-12-12")).toEqual({ from: "2026-12-10", to: "2026-12-12" });
    expect(clickDay("2026-12-10", "", "2026-12-08")).toEqual({ from: "2026-12-08", to: "2026-12-10" });
    expect(clickDay("2026-12-10", "2026-12-12", "2026-12-20")).toEqual({ from: "2026-12-20", to: "" });
  });
  it("previous / next month: from this month to 3 months ahead", () => {
    expect(canGoPrev("2026-12", "2026-12-03")).toBe(false);
    expect(canGoPrev("2027-01", "2026-12-03")).toBe(true);
    expect(canGoNext("2027-02", "2026-12-03")).toBe(true);
    expect(canGoNext("2027-03", "2026-12-03")).toBe(false);
  });
});
