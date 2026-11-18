import { describe, expect, it } from "vitest";
import {
  addDays, addMonths, addMonthsToDate, daysInMonth, diffDays, eachDay, formatPeriod, formatShort, isIsoDate, japanDate,
  japanDateTime, overlaps, periodDays, weekday,
} from "../../shared/dates.ts";

describe("the day arithmetic", () => {
  it("adds days across a month's end and a year's end", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("counts the days of a period, both ends included", () => {
    expect(periodDays("2026-12-05", "2026-12-06")).toBe(2);
    expect(periodDays("2026-12-05", "2026-12-05")).toBe(1);
    expect(periodDays("2026-12-30", "2027-01-02")).toBe(4);
    expect(diffDays("2026-12-05", "2026-12-01")).toBe(-4);
    expect(eachDay("2026-11-29", "2026-12-02")).toEqual(["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"]);
  });
  it("formats a period the way the cart shows it", () => {
    expect(formatPeriod("2026-12-05", "2026-12-06")).toBe("12/5(土)〜12/6(日)・2日");
    expect(formatShort("2027-01-01")).toBe("1/1(金)");
    expect(weekday("2026-12-05")).toBe(6);
  });
  it("months: navigation and clamping", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2027-01", -1)).toBe("2026-12");
    expect(addMonthsToDate("2026-11-30", 3)).toBe("2027-02-28");
    expect(daysInMonth("2028-02")).toBe(29);
  });
  it("validates dates", () => {
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-2-3")).toBe(false);
    expect(isIsoDate("2026-12-05")).toBe(true);
    expect(isIsoDate(20261205)).toBe(false);
  });
  it("today in Japan does not depend on the runtime's time zone (23:59 and 00:01 JST)", () => {
    // 2026-12-31 23:59 JST = 14:59 UTC; 2027-01-01 00:01 JST = 2026-12-31 15:01 UTC
    expect(japanDate(Date.UTC(2026, 11, 31, 14, 59))).toBe("2026-12-31");
    expect(japanDate(Date.UTC(2026, 11, 31, 15, 1))).toBe("2027-01-01");
    expect(japanDateTime(Date.UTC(2026, 11, 31, 15, 1))).toBe("2027-01-01T00:01");
  });
  it("overlaps", () => {
    expect(overlaps("2026-12-01", "2026-12-03", "2026-12-03", "2026-12-04")).toBe(true);
    expect(overlaps("2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04")).toBe(false);
  });
});
