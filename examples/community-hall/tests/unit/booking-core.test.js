import { describe, expect, it } from "vitest";
import {
  resizeAttendees, removeAttendeeAt, ticketCount, totalPrice, clampCount, bookingBody, splitErrors,
} from "../../public/js/booking-core.js";

describe("booking-core", () => {
  it("adds and removes name fields per type, keeping the objects that stay", () => {
    let { attendees, stash } = resizeAttendees([], {}, "adult", 2);
    ({ attendees, stash } = resizeAttendees(attendees, stash, "child", 1));
    expect(attendees.map((a) => a.type)).toEqual(["adult", "adult", "child"]);
    const [a1, a2, c1] = attendees;
    a1.name = "一"; a2.name = "二"; c1.name = "子";
    ({ attendees, stash } = resizeAttendees(attendees, stash, "senior", 1));
    expect(attendees.slice(0, 3)).toEqual([a1, a2, c1]);        // same objects, grouped by type
    expect(attendees[3].type).toBe("senior");
  });

  it("brings back what was typed when a count goes down and up again", () => {
    let { attendees, stash } = resizeAttendees([], {}, "adult", 3);
    attendees.forEach((a, i) => { a.name = `名${i}`; });
    ({ attendees, stash } = resizeAttendees(attendees, stash, "adult", 1));
    expect(attendees.map((a) => a.name)).toEqual(["名0"]);
    ({ attendees, stash } = resizeAttendees(attendees, stash, "adult", 2));
    expect(attendees.map((a) => a.name)).toEqual(["名0", "名1"]);
    ({ attendees, stash } = resizeAttendees(attendees, stash, "adult", 4));
    expect(attendees.map((a) => a.name)).toEqual(["名0", "名1", "名2", ""]);
  });

  it("removes one ticket in the middle and lowers its type's count", () => {
    const { attendees } = resizeAttendees([], {}, "adult", 3);
    attendees.forEach((a, i) => { a.name = `名${i}`; });
    const next = removeAttendeeAt(attendees, { adult: 3, child: 0, senior: 0 }, 1);
    expect(next.attendees.map((a) => a.name)).toEqual(["名0", "名2"]);
    expect(next.attendees[1]).toBe(attendees[2]);
    expect(next.tickets).toEqual({ adult: 2, child: 0, senior: 0 });
  });

  it("counts, totals and clamps", () => {
    expect(ticketCount({ adult: 2, child: 1, senior: 0 })).toBe(3);
    expect(totalPrice({ adult: 2, child: 1, senior: 1 }, { adult: 1000, child: 500, senior: 800 })).toBe(3300);
    expect(clampCount("9")).toBe(6);
    expect(clampCount("-1")).toBe(0);
    expect(clampCount("x")).toBe(0);
  });

  it("builds the request body and splits the 422 errors", () => {
    const body = bookingBody(3, { adult: 1, child: 0, senior: 0 }, [{ name: " 太郎 " }], { name: "太郎", phone: "0277-1-2345 ", email: "a@b.jp" });
    expect(body).toEqual({ eventId: 3, tickets: { adult: 1, child: 0, senior: 0 }, attendees: ["太郎"], name: "太郎", phone: "0277-1-2345", email: "a@b.jp" });
    const { form, attendees } = splitErrors({ phone: "x", "attendees.1": "y" });
    expect(form).toEqual({ phone: "x" });
    expect(attendees[1]).toBe("y");
    expect(attendees[0]).toBeUndefined();
  });
});
