// What <wcs-fetch> / <wcs-sse> hand to state is `unknown` until checked: the server can change
// shape (a renamed field, a null where the type says always). These checks decide whether a value
// IS our API type; a page that fails one shows "the server answered something unexpected" instead
// of rendering undefined.

import type {
  Center, CounterResponse, Item, ItemDetail, ItemsResponse, LoginResponse, Reservation, ReservationLine, User,
} from "../../shared/api.ts";
import { CATEGORIES, RESERVATION_STATUSES } from "../../shared/api.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export class ShapeError extends Error {
  what: string;
  at: string;
  constructor(what: string, at: string) {
    super(`${what}: unexpected value at ${at}`);
    this.what = what;
    this.at = at;
  }
}

function fail(what: string, at: string): never {
  throw new ShapeError(what, at);
}

export function isUser(v: unknown): v is User {
  return isObj(v) && isStr(v.id) && isStr(v.name) && (v.role === "group" || v.role === "staff");
}

export function isLoginResponse(v: unknown): v is LoginResponse {
  return isObj(v) && isStr(v.token) && isUser(v.user);
}

export function isCenter(v: unknown): v is Center {
  return isObj(v) && isNum(v.id) && isStr(v.name);
}

function checkItem(v: unknown, at: string): Item {
  if (!isObj(v)) fail("item", at);
  if (!isNum(v.id)) fail("item", `${at}.id`);
  if (!isStr(v.name)) fail("item", `${at}.name`);
  if (!isStr(v.category) || !(CATEGORIES as readonly string[]).includes(v.category)) fail("item", `${at}.category`);
  if (!isNum(v.centerId)) fail("item", `${at}.centerId`);
  if (!isNum(v.stock)) fail("item", `${at}.stock`);
  if (!isNum(v.deposit)) fail("item", `${at}.deposit`);
  if (!(v.note === null || isStr(v.note))) fail("item", `${at}.note`);
  if (!(v.free === undefined || isNum(v.free))) fail("item", `${at}.free`);
  return v as unknown as Item;
}

/** Throws ShapeError naming the first field that is not what the type says. */
export function checkItemsResponse(v: unknown): ItemsResponse {
  if (!isObj(v)) fail("items", "$");
  if (!Array.isArray(v.items)) fail("items", "$.items");
  v.items.forEach((it, i) => checkItem(it, `$.items[${i}]`));
  if (!isNum(v.total)) fail("items", "$.total");
  if (!isNum(v.page)) fail("items", "$.page");
  return v as unknown as ItemsResponse;
}

export function checkItemDetail(v: unknown): ItemDetail {
  checkItem(v, "$");
  const o = v as Obj;
  if (!Array.isArray(o.booked)) fail("item", "$.booked");
  o.booked.forEach((b, i) => {
    if (!isObj(b) || !isStr(b.from) || !isStr(b.to) || !isNum(b.quantity)) fail("item", `$.booked[${i}]`);
  });
  return v as ItemDetail;
}

function checkLine(v: unknown, at: string): ReservationLine {
  if (!isObj(v) || !isNum(v.itemId) || !isStr(v.from) || !isStr(v.to) || !isNum(v.quantity) || !isStr(v.itemName) || !isNum(v.stock) || !isNum(v.deposit)) {
    fail("reservation", at);
  }
  return v as unknown as ReservationLine;
}

export function checkReservation(v: unknown, at = "$"): Reservation {
  if (!isObj(v)) fail("reservation", at);
  if (!isNum(v.id)) fail("reservation", `${at}.id`);
  if (!isStr(v.groupId) || !isStr(v.groupName)) fail("reservation", `${at}.groupId`);
  if (!isStr(v.status) || !(RESERVATION_STATUSES as readonly string[]).includes(v.status)) fail("reservation", `${at}.status`);
  if (!Array.isArray(v.lines)) fail("reservation", `${at}.lines`);
  v.lines.forEach((l, i) => checkLine(l, `${at}.lines[${i}]`));
  if (!isStr(v.purpose)) fail("reservation", `${at}.purpose`);
  if (!isStr(v.pickupAt)) fail("reservation", `${at}.pickupAt`);
  if (!isStr(v.createdAt)) fail("reservation", `${at}.createdAt`);
  if (v.decidedBy !== undefined && !(isObj(v.decidedBy) && isStr(v.decidedBy.name))) fail("reservation", `${at}.decidedBy`);
  return v as unknown as Reservation;
}

export function checkReservations(v: unknown): Reservation[] {
  if (!Array.isArray(v)) fail("reservations", "$");
  return v.map((r, i) => checkReservation(r, `$[${i}]`));
}

export function checkCounter(v: unknown): CounterResponse {
  if (!isObj(v) || !isNum(v.centerId) || !isStr(v.centerName) || !Array.isArray(v.pickups) || !Array.isArray(v.returns)) fail("counter", "$");
  return v as unknown as CounterResponse;
}

/** Runs a check and returns the value, or null and a message. */
export function tryCheck<T>(check: (v: unknown) => T, v: unknown): { ok: T | null; problem: string } {
  if (v === null || v === undefined) return { ok: null, problem: "" };
  try {
    return { ok: check(v), problem: "" };
  } catch (e) {
    if (e instanceof ShapeError) return { ok: null, problem: `サーバーから想定外の応答がありました（${e.at}）` };
    throw e;
  }
}

/** The `422` body: errors keyed "purpose", "lines.2.quantity" … */
export function parseValidationErrors(body: string | undefined): Record<string, string> {
  if (!body) return {};
  try {
    const v: unknown = JSON.parse(body);
    if (isObj(v) && isObj(v.errors)) {
      const out: Record<string, string> = {};
      for (const [k, m] of Object.entries(v.errors)) if (isStr(m)) out[k] = m;
      return out;
    }
  } catch { /* not JSON */ }
  return {};
}

/** The message of an `{ error }` body. */
export function parseErrorMessage(body: string | undefined): string {
  if (!body) return "";
  try {
    const v: unknown = JSON.parse(body);
    if (isObj(v) && isStr(v.error)) return v.error;
  } catch { /* not JSON */ }
  return "";
}
