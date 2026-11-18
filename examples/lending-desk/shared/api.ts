// The API contract of みどり市 備品の貸出 — the one place its types live.
// Both the server (server/*.ts) and the pages (src/**/*.ts) import these with `import type`.
// Dates are "YYYY-MM-DD" strings, times "YYYY-MM-DDTHH:mm" in Japan time.

/** "YYYY-MM-DD" */
export type IsoDate = string;
/** "YYYY-MM-DDTHH:mm" (Japan time) */
export type IsoDateTime = string;

export type Role = "group" | "staff";

export interface User {
  id: string;
  name: string;
  role: Role;
}

export interface LoginRequest {
  id: string;
  phrase: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface MeResponse {
  user: User;
}

export interface OkResponse {
  ok: true;
}

export interface Center {
  id: number;
  name: string;
}

export const CATEGORIES = ["テント・タープ", "机・椅子", "映像・音響", "調理・イベント", "スポーツ・レク", "防災・安全"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Item {
  id: number;
  name: string;
  category: Category;
  centerId: number;
  stock: number;
  deposit: number;
  note: string | null;
  /** The least free on any day of the period — only when `from` and `to` were given. */
  free?: number;
}

export type ItemSort = "name" | "deposit";

export interface ItemsQuery {
  q?: string;
  category?: string;
  center?: string;
  from?: IsoDate;
  to?: IsoDate;
  sort?: ItemSort;
  page?: string;
  per?: string;
}

export interface ItemsResponse {
  items: Item[];
  total: number;
  page: number;
}

export interface Booking {
  from: IsoDate;
  to: IsoDate;
  quantity: number;
}

export interface ItemDetail extends Item {
  booked: Booking[];
}

export interface ReservationLineInput {
  itemId: number;
  from: IsoDate;
  to: IsoDate;
  quantity: number;
}

/** A line as the server returns it: the input plus what the server knows about the item. */
export interface ReservationLine extends ReservationLineInput {
  itemName: string;
  centerId: number;
  stock: number;
  deposit: number;
}

export interface ReservationRequest {
  lines: ReservationLineInput[];
  purpose: string;
  pickupAt: IsoDateTime;
}

export type ReservationStatus = "pending" | "approved" | "denied" | "cancelled";
export const RESERVATION_STATUSES: readonly ReservationStatus[] = ["pending", "approved", "denied", "cancelled"];

export interface PersonRef {
  id: string;
  name: string;
}

export interface Reservation {
  id: number;
  groupId: string;
  groupName: string;
  status: ReservationStatus;
  lines: ReservationLine[];
  purpose: string;
  pickupAt: IsoDateTime;
  createdAt: IsoDateTime;
  decidedAt?: IsoDateTime;
  decidedBy?: PersonRef;
  reason?: string;
  cancelledAt?: IsoDateTime;
}

/** `422` body: keys are "purpose", "pickupAt", "lines", "lines.<i>.<field>". */
export interface ValidationErrorResponse {
  errors: Record<string, string>;
}

export interface ErrorResponse {
  error: string;
}

export interface DecisionRequest {
  decision: "approved" | "denied";
  reason?: string;
}

export interface CounterEntry {
  reservationId: number;
  groupName: string;
  itemName: string;
  quantity: number;
  /** pickups: the pickup time; returns: the period's last day */
  at: string;
  status: ReservationStatus;
}

export interface CounterResponse {
  centerId: number;
  centerName: string;
  date: IsoDate;
  pickups: CounterEntry[];
  returns: CounterEntry[];
}

/** SSE `event: counter` payload. */
export interface CounterEvent {
  centerId: number;
}

export interface TestFailRequest {
  path: string;
  status: number;
  times: number;
}

export interface TestLogEntry {
  method: string;
  path: string;
  query: string;
  body: unknown;
  status: number;
  auth: string | null;
}

export interface TodayResponse {
  today: IsoDate;
}
