// Pure booking logic shared by the hall's booking form (booking.js) and the partner widget (widget-state.js).
// No wcstack here: these functions take plain values and return new ones, so the states can assign the result.

export const TICKET_TYPES = /** @type {const} */ (["adult", "child", "senior"]);
export const MAX_PER_TYPE = 6;

let seq = 0;
/** @returns {{ key: string, type: string, name: string, error: string }} */
export function newAttendee(type) {
  seq += 1;
  return { key: `a${seq}`, type, name: "", error: "" };
}

export function clampCount(v) {
  const n = Number.parseInt(String(v), 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(MAX_PER_TYPE, n);
}

/**
 * Make the attendee list hold `n` entries of `type`, keeping every object that stays (so the typed names stay with
 * their fields). Entries removed by lowering a count go to `stash` and come back, most recent first, when the count
 * goes up again. The list stays grouped by type in TICKET_TYPES order.
 * @returns {{ attendees: Array<{ key: string, type: string, name: string, error: string }>, stash: Record<string, Array<{ key: string, type: string, name: string, error: string }>> }}
 */
export function resizeAttendees(attendees, stash, type, n) {
  const mine = attendees.filter((a) => a.type === type);
  let nextMine = mine;
  let nextStash = stash;
  if (mine.length > n) {
    const removed = mine.slice(n);
    nextMine = mine.slice(0, n);
    nextStash = { ...stash, [type]: [...(stash[type] ?? []), ...removed.toReversed()] };
  } else if (mine.length < n) {
    const pool = [...(stash[type] ?? [])];
    const added = [];
    while (mine.length + added.length < n) added.push(pool.length ? pool.pop() : newAttendee(type));
    nextMine = [...mine, ...added];
    nextStash = { ...stash, [type]: pool };
  } else {
    return { attendees, stash };
  }
  const byType = (t) => (t === type ? nextMine : attendees.filter((a) => a.type === t));
  return { attendees: TICKET_TYPES.flatMap(byType), stash: nextStash };
}

/** Remove one attendee (the × on its row): the count of its type goes down by one. Not stashed — it was removed on purpose. */
export function removeAttendeeAt(attendees, tickets, index) {
  const a = attendees[index];
  if (!a) return { attendees, tickets };
  return {
    attendees: attendees.toSpliced(index, 1),
    tickets: { ...tickets, [a.type]: Math.max(0, (tickets[a.type] ?? 0) - 1) },
  };
}

export function ticketCount(tickets) {
  return TICKET_TYPES.reduce((s, t) => s + (Number(tickets?.[t]) || 0), 0);
}

export function totalPrice(tickets, prices) {
  return TICKET_TYPES.reduce((s, t) => s + (Number(tickets?.[t]) || 0) * (Number(prices?.[t]) || 0), 0);
}


/** The request body of POST /api/bookings. */
export function bookingBody(eventId, tickets, attendees, form) {
  return {
    eventId,
    tickets: { adult: tickets.adult, child: tickets.child, senior: tickets.senior },
    attendees: attendees.map((a) => a.name.trim()),
    name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim(),
  };
}

/** Split the server's 422 errors into form-level ones and one message per attendee position. */
export function splitErrors(errors) {
  const form = {};
  const attendees = [];
  for (const [k, v] of Object.entries(errors ?? {})) {
    const m = k.match(/^attendees\.(\d+)$/);
    if (m) attendees[Number(m[1])] = v;
    else form[k] = v;
  }
  return { form, attendees };
}

export const EMPTY_ERRORS = { name: "", phone: "", email: "", tickets: "", attendees: "" };

