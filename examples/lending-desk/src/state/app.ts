// The state of the SPA (index.html): <wcs-state src="src/state/app.ts">.
// In development Vite serves this file as JavaScript; `npm run build` emits it as its own chunk and
// rewrites the src (wcstack() in vite.config.ts). `npm run schema` derives wcstack.manifest.json from its
// type (`wcs-schema emit`), and the lint checks index.html against that schema.

import { defineState } from "@wcstack/state/define";
import type { WcsFetchHttpError } from "@wcstack/fetch";
import type {
  Center, IsoDate, Item, ItemDetail, ItemsResponse, LoginRequest, LoginResponse, Reservation, ReservationLine,
  ReservationRequest, ReservationStatus,
} from "../../shared/api.ts";
import { CATEGORIES, RESERVATION_STATUSES } from "../../shared/api.ts";
import { addMonths, addMonthsToDate, formatDateTime, formatLong, formatPeriod, isIsoDate, japanDate, periodDays } from "../../shared/dates.ts";
import { freeInPeriod, stockConflicts } from "../../shared/stock.ts";
import type { CalendarWeek } from "../lib/calendar.ts";
import { buildCalendar, canGoNext, canGoPrev, clickDay, monthTitle } from "../lib/calendar.ts";
import type { CartLine, CartTotals } from "../lib/cart.ts";
import { cartTotals, lineDeposit, lineKey, mergeLine, periodLabel, sanitizeCart, toRequestLines, yen } from "../lib/cart.ts";
import {
  checkItemDetail, checkItemsResponse, checkReservation, checkReservations, isCenter, isLoginResponse,
  parseErrorMessage, parseValidationErrors, tryCheck,
} from "../lib/check.ts";
import type { PageLink, SearchForm } from "../lib/search.ts";
import { formFromQuery, hasPeriod, itemsApiUrl, pageFromQuery, pageLinks, sameSearch, searchHref } from "../lib/search.ts";
import type { SubmitProblems } from "../lib/submit-errors.ts";
import { mapSubmitErrors, NO_PROBLEMS } from "../lib/submit-errors.ts";

type FetchError = WcsFetchHttpError | Error | null;

/** `event.detail` of `<wcs-fetch>`'s response event (eventToken.value). */
interface FetchResponseDetail {
  value: unknown;
  status: number;
}
/** `event.detail` of `<wcs-sse>`'s message (eventToken.message): `data` is parsed JSON. */
interface SseMessageDetail {
  event: string;
  data: unknown;
  lastEventId: string;
}

const STATUS_JA: Record<ReservationStatus, string> = { pending: "申請中", approved: "承認", denied: "却下", cancelled: "取消" };

function httpBody(e: FetchError): string | undefined {
  return e && "body" in e ? e.body : undefined;
}

function decided(r: Reservation): boolean {
  return r.status === "approved" || r.status === "denied";
}

function linesSummary(lines: readonly ReservationLine[]): string {
  return lines.map((l) => `${l.itemName}×${l.quantity}`).join("、");
}

function upsert(list: readonly Reservation[], r: Reservation): Reservation[] {
  const i = list.findIndex((x) => x.id === r.id);
  return i < 0 ? [r, ...list] : list.with(i, r);
}

export default defineState({
  // ---- the router's outputs and inputs ----
  path: "",
  routeName: "",
  routeParams: {} as Record<string, unknown>,
  query: {} as Record<string, string>,
  navigateUrl: null as string | null,
  replaceUrl: null as string | null,

  // ---- the clock (a <wcs-timer> tick writes nowMs) ----
  nowMs: Date.now(),
  clockTick: 0,
  get today(): IsoDate {
    return japanDate(this.nowMs);
  },
  get lastDay(): IsoDate {
    return addMonthsToDate(this.today, 3);
  },

  // ---- session (<wcs-storage key="midori.session">) ----
  /** what storage holds — unchecked until `auth` */
  session: null as unknown,
  get auth(): LoginResponse | null {
    return isLoginResponse(this.session) ? this.session : null;
  },
  get signedIn(): boolean {
    return this.auth !== null;
  },
  get isStaff(): boolean {
    return this.auth?.user.role === "staff";
  },
  get isGroup(): boolean {
    return this.auth?.user.role === "group";
  },
  get headerName(): string {
    const a = this.auth;
    return a ? (a.user.role === "staff" ? "職員" : a.user.name) : "";
  },
  get authHeader(): string | null {
    const a = this.auth;
    return a ? `Bearer ${a.token}` : null;
  },
  get currentHref(): string {
    const q = new URLSearchParams(this.query).toString();
    return `${this.path || "/"}${q ? `?${q}` : ""}`;
  },

  // ---- sign in ----
  loginForm: { id: "", phrase: "" },
  loginBody: null as LoginRequest | null,
  loginSending: false,
  loginLoading: false,
  loginError: null as FetchError,
  loginMessage: "",
  /** set by ログアウト so the session watch does not add ?next= */
  signingOut: false,
  get loginNext(): string {
    const n = this.query.next ?? "";
    return n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/login") ? n : "/";
  },
  login(e: Event): void {
    e.preventDefault();
    this.loginMessage = "";
    this.loginBody = { id: this["loginForm.id"].trim(), phrase: this["loginForm.phrase"] };
    this.loginSending = true;
  },
  logout(): void {
    const header = this.authHeader;
    // the command carries its own header: the session (and the bound header) is cleared right after
    if (header) this.$command.logoutReq.emit("/api/logout", { method: "POST", headers: { Authorization: header } });
    this.signingOut = true;
    this.clearSession("");
    this.navigateUrl = "/login";
  },
  /** Signed out: `sseUrl` becomes null, and a cleared url closes <wcs-sse>'s stream. */
  clearSession(message: string): void {
    this.session = null;
    this.cart = [];
    this.reservations = [];
    this.loginMessage = message;
  },
  /** A 401 on any request: the token is no longer accepted. The cart is kept in storage until sign out. */
  expire(): void {
    if (this.session === null) return;
    const next = this.currentHref;
    this.session = null;
    this.reservations = [];
    this.loginMessage = "サインインの有効期限が切れました。もう一度サインインしてください。";
    this.replaceUrl = `/login?next=${encodeURIComponent(next)}`;
  },

  // ---- centres ----
  centersResult: null as unknown,
  centersError: null as FetchError,
  get centers(): Center[] {
    return Array.isArray(this.centersResult) ? this.centersResult.filter(isCenter) : [];
  },
  get categories(): string[] {
    return [...CATEGORIES];
  },
  get "centers.*.value"(): string {
    return String(this["centers.*.id"]);
  },
  /** each option says whether it is chosen: the options arrive after the select's value would be set */
  get "centers.*.selected"(): boolean {
    return String(this["centers.*.id"]) === this["form.center"];
  },

  // ---- search (/) — the URL is the source of truth ----
  form: { q: "", category: "", center: "", from: "", to: "", sort: "name" } as SearchForm,
  /** <wcs-debounce>'s value: the keyword once typing has paused (null until then) */
  settledQ: null as string | null,
  searchResult: null as unknown,
  searchLoading: false,
  searchError: null as FetchError,
  get searchPage(): number {
    return pageFromQuery(this.query);
  },
  get searchUrl(): string | null {
    if (this.routeName !== "search" || !this.auth) return null;
    return itemsApiUrl(formFromQuery(this.query), this.searchPage, this.query.delay);
  },
  get searchChecked(): { ok: ItemsResponse | null; problem: string } {
    return tryCheck(checkItemsResponse, this.searchResult);
  },
  get searchProblem(): string {
    if (this.centersError) return "センターの一覧を読み込めませんでした";
    if (this.searchError) return `検索できませんでした（${"status" in this.searchError ? this.searchError.status : "通信エラー"}）`;
    return this.searchChecked.problem;
  },
  get items(): Item[] {
    return this.searchChecked.ok?.items ?? [];
  },
  get searchTotal(): number {
    return this.searchChecked.ok?.total ?? 0;
  },
  get searchHasPeriod(): boolean {
    return hasPeriod(formFromQuery(this.query));
  },
  get periodWrong(): boolean {
    return this["form.from"] !== "" && this["form.to"] !== "" && this["form.from"] > this["form.to"];
  },
  get pageLinks(): PageLink[] {
    return pageLinks(formFromQuery(this.query), this.searchTotal, this.searchPage);
  },
  get showPager(): boolean {
    return this.searchTotal > 20;
  },
  get searchSummary(): string {
    if (!this.searchChecked.ok) return "";
    return `${this.searchTotal}件`;
  },
  get "items.*.href"(): string {
    return `/items/${this[".id"]}`;
  },
  get "items.*.centerName"(): string {
    const id = this["items.*.centerId"];
    return this.centers.find((c) => c.id === id)?.name ?? "";
  },
  get "items.*.depositLabel"(): string {
    return yen(this["items.*.deposit"]);
  },
  // `free` is optional (only with a period): read it off the row, not by path — a path to a key the row
  // does not have warns [wcs/read-path-missing] at run time
  get "items.*.freeLabel"(): string {
    const it = this["items.*"];
    return it.free === undefined ? "" : `空き ${it.free} / ${it.stock}`;
  },
  get "items.*.none"(): boolean {
    return this["items.*"].free === 0;
  },
  get "items.*.noteText"(): string {
    return this["items.*.note"] ?? "";
  },

  // ---- item detail (/items/:id) ----
  itemResult: null as unknown,
  itemLoading: false,
  itemError: null as FetchError,
  get itemId(): number | null {
    const id = this.routeParams.id;
    return this.routeName === "item" && typeof id === "number" ? id : null;
  },
  get itemUrl(): string | null {
    return this.itemId !== null && this.auth ? `/api/items/${this.itemId}` : null;
  },
  get itemChecked(): { ok: ItemDetail | null; problem: string } {
    return tryCheck(checkItemDetail, this.itemResult);
  },
  /** the fetched item — only when it is the one in the URL (value is the previous one until the next lands) */
  get item(): ItemDetail | null {
    const it = this.itemChecked.ok;
    return it && it.id === this.itemId ? it : null;
  },
  get itemNotFound(): boolean {
    const e = this.itemError;
    return !this.itemLoading && e !== null && "status" in e && e.status === 404;
  },
  get itemProblem(): string {
    const e = this.itemError;
    if (e && !("status" in e && e.status === 404)) return "備品を読み込めませんでした";
    return this.itemChecked.problem;
  },
  get itemCenterName(): string {
    const it = this.item;
    return it ? (this.centers.find((c) => c.id === it.centerId)?.name ?? "") : "";
  },
  get itemDepositLabel(): string {
    return this.item ? yen(this.item.deposit) : "";
  },
  get itemNote(): string {
    return this.item?.note ?? "";
  },
  pick: { from: "", to: "", quantity: 1 },
  calMonth: "",
  addedMessage: "",
  get calendarWeeks(): CalendarWeek[] {
    const it = this.item;
    if (!it) return [];
    return buildCalendar({
      month: this.calMonth || this.today.slice(0, 7), today: this.today, lastDay: this.lastDay, stock: it.stock,
      booked: it.booked, from: this["pick.from"], to: this["pick.to"],
    });
  },
  get calTitle(): string {
    return monthTitle(this.calMonth || this.today.slice(0, 7));
  },
  get canPrevMonth(): boolean {
    return canGoPrev(this.calMonth || this.today.slice(0, 7), this.today);
  },
  get canNextMonth(): boolean {
    return canGoNext(this.calMonth || this.today.slice(0, 7), this.today);
  },
  get pickProblem(): string {
    const from = this["pick.from"];
    const to = this["pick.to"];
    if (from === "" && to === "") return "カレンダーで期間を選んでください（1回目に開始日、2回目に終了日）";
    if (!isIsoDate(from) || !isIsoDate(to)) return "終了日を選んでください";
    if (from > to) return "終了日が開始日より前です";
    if (from < this.today) return "今日より前の日は選べません";
    if (to > this.lastDay) return "3か月より先は選べません";
    if (this.pickFree === 0) return "この期間は空きがありません";
    return "";
  },
  get pickFree(): number {
    const it = this.item;
    const from = this["pick.from"];
    const to = this["pick.to"];
    if (!it || !isIsoDate(from) || !isIsoDate(to) || from > to) return 0;
    return freeInPeriod(it.stock, it.booked, from, to);
  },
  get pickMax(): number {
    return Math.max(1, this.pickFree);
  },
  get pickSummary(): string {
    const from = this["pick.from"];
    const to = this["pick.to"];
    if (!isIsoDate(from) || !isIsoDate(to) || from > to) return "";
    return `${formatPeriod(from, to)}　空き ${this.pickFree}`;
  },
  get cannotAdd(): boolean {
    return this.pickProblem !== "";
  },
  prevMonth(): void {
    if (this.canPrevMonth) this.calMonth = addMonths(this.calMonth || this.today.slice(0, 7), -1);
  },
  nextMonth(): void {
    if (this.canNextMonth) this.calMonth = addMonths(this.calMonth || this.today.slice(0, 7), 1);
  },
  pickDay(_e: Event, week: number, day: number): void {
    const cell = this.calendarWeeks[week]?.days[day];
    if (!cell || cell.pad || cell.disabled) return;
    const next = clickDay(this["pick.from"], this["pick.to"], cell.date);
    this.pick = { ...this.pick, from: next.from, to: next.to, quantity: 1 };
    this.addedMessage = "";
  },
  addToCart(): void {
    const it = this.item;
    if (!it || this.cannotAdd) return;
    const from = this["pick.from"];
    const to = this["pick.to"];
    const quantity = Math.min(this["pick.quantity"], this.pickFree);
    const before = this.cart.find((l) => l.key === lineKey(it.id, from, to));
    this.cart = mergeLine(this.cart, { itemId: it.id, name: it.name, centerId: it.centerId, deposit: it.deposit, max: this.pickFree, from, to, quantity });
    this.addedMessage = before ? "かごの同じ行に追加しました" : "かごに入れました";
  },

  // ---- cart (/cart) — <wcs-storage key="midori.cart"> through an accessor pair ----
  cart: [] as CartLine[],
  get "cart.*.saved"(): CartLine {
    return {
      key: this["cart.*.key"], itemId: this["cart.*.itemId"], name: this["cart.*.name"], centerId: this["cart.*.centerId"],
      deposit: this["cart.*.deposit"], max: this["cart.*.max"], from: this["cart.*.from"], to: this["cart.*.to"],
      quantity: this["cart.*.quantity"],
    };
  },
  get savedCart(): CartLine[] {
    return this.$getAll<CartLine>("cart.*.saved", []);
  },
  set savedCart(v: CartLine[]) {
    const c = sanitizeCart(v);
    if (c) this.cart = c;
  },
  get "cart.*.period"(): string {
    return periodLabel({ from: this["cart.*.from"], to: this["cart.*.to"] });
  },
  get "cart.*.depositLabel"(): string {
    return yen(lineDeposit({ deposit: this["cart.*.deposit"], quantity: this["cart.*.quantity"] }));
  },
  get "cart.*.centerName"(): string {
    const id = this["cart.*.centerId"];
    return this.centers.find((c) => c.id === id)?.name ?? "";
  },
  get "cart.*.href"(): string {
    return `/items/${this["cart.*.itemId"]}`;
  },
  get "cart.*.error"(): string {
    return this.submitProblems.byLine[this["cart.*.key"]] ?? "";
  },
  get "cart.*.hasError"(): boolean {
    return this["cart.*.error"] !== "";
  },
  get totals(): CartTotals {
    return cartTotals(this.$getAll<CartLine>("cart.*.saved", []));
  },
  get totalDepositLabel(): string {
    return yen(this.totals.deposit);
  },
  get cartCount(): number {
    return this.cart.length;
  },
  get cartEmpty(): boolean {
    return this.cart.length === 0;
  },
  removeLine(_e: Event, i: number): void {
    this.cart = this.cart.toSpliced(i, 1);
  },
  order: { purpose: "", pickupAt: "" },
  get purposeCount(): number {
    return [...this["order.purpose"]].length;
  },
  get purposeTooLong(): boolean {
    return this.purposeCount > 200;
  },
  submitBody: null as ReservationRequest | null,
  submitSending: false,
  submitLoading: false,
  submitError: null as FetchError,
  /** the line keys in the order they were sent: a 422's "lines.2" is sentKeys[2] */
  sentKeys: [] as string[],
  submitMessage: "",
  get submitProblems(): SubmitProblems {
    const e = this.submitError;
    if (!e || !("status" in e) || e.status !== 422) return NO_PROBLEMS;
    return mapSubmitErrors(parseValidationErrors(httpBody(e)), this.sentKeys);
  },
  get cannotSubmit(): boolean {
    return this.cart.length === 0 || this.submitLoading || this.purposeTooLong;
  },
  submit(e: Event): void {
    e.preventDefault();
    if (this.cannotSubmit) return;
    this.submitMessage = "";
    this.sentKeys = this.cart.map((l) => l.key);
    this.submitBody = { lines: toRequestLines(this.cart), purpose: this["order.purpose"], pickupAt: this["order.pickupAt"] };
    this.submitSending = true;
  },

  // ---- reservations (/reservations, /reservations/:id, /admin) ----
  /** the user's requests (staff: everyone's) — a key we own: the fetch fills it, the live updates change it */
  reservations: [] as Reservation[],
  resResult: null as unknown,
  resLoading: false,
  resError: null as FetchError,
  resProblem: "",
  resLoaded: false,
  get resUrl(): string | null {
    return this.auth ? "/api/reservations" : null;
  },
  get statusFilter(): string {
    const s = this.query.status ?? "";
    return (RESERVATION_STATUSES as readonly string[]).includes(s) ? s : "";
  },
  get shownReservations(): Reservation[] {
    const f = this.statusFilter;
    return this.reservations.filter((r) => !f || r.status === f).toSorted((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  },
  get noReservations(): boolean {
    return this.resLoaded && this.shownReservations.length === 0;
  },
  get "shownReservations.*.statusLabel"(): string {
    return STATUS_JA[this["shownReservations.*.status"]];
  },
  get "shownReservations.*.href"(): string {
    return `/reservations/${this["shownReservations.*.id"]}`;
  },
  get "shownReservations.*.summary"(): string {
    return linesSummary(this["shownReservations.*.lines"]);
  },
  get "shownReservations.*.createdLabel"(): string {
    return formatDateTime(this["shownReservations.*.createdAt"]);
  },
  get "shownReservations.*.canCancel"(): boolean {
    return this["shownReservations.*.status"] === "pending" && this.isGroup;
  },
  get "shownReservations.*.unseen"(): boolean {
    const r = this["shownReservations.*"];
    return decided(r) && this.seenIds !== null && !this.seenIds.includes(r.id);
  },
  get statusTabs(): { label: string; href: string }[] {
    return [{ label: "すべて", href: "/reservations?" }, ...RESERVATION_STATUSES.map((s) => ({ label: STATUS_JA[s], href: `/reservations?status=${s}` }))];
  },
  cancelMessage: "",
  cancel(_e: Event, i: number): void {
    const r = this.shownReservations[i];
    if (!r) return;
    this.cancelById(r.id);
  },
  cancelDetail(): void {
    const r = this.reservation;
    if (r) this.cancelById(r.id);
  },
  cancelById(id: number): void {
    if (!window.confirm(`申込 #${id} を取り消しますか？`)) return;
    this.cancelMessage = "";
    this.$command.cancelReq.emit(`/api/reservations/${id}/cancel`, { method: "POST" });
  },

  /** decided requests already seen (<wcs-storage> per user); null until stored */
  seenIds: null as number[] | null,
  get seenKey(): string | null {
    return this.auth && this.auth.user.role === "group" ? `midori.seen.${this.auth.user.id}` : null;
  },
  get unseenCount(): number {
    const seen = this.seenIds;
    if (!this.isGroup || seen === null) return 0;
    return this.reservations.filter((r) => decided(r) && !seen.includes(r.id)).length;
  },
  get hasUnseen(): boolean {
    return this.unseenCount > 0;
  },
  markSeen(): void {
    const ids = this.reservations.filter(decided).map((r) => r.id).toSorted((a, b) => a - b);
    const cur = this.seenIds ?? [];
    if (ids.length !== cur.length || ids.some((id, i) => cur[i] !== id)) this.seenIds = ids;
  },

  get reservationId(): number | null {
    const id = this.routeParams.id;
    return this.routeName === "reservation" && typeof id === "number" ? id : null;
  },
  get reservation(): Reservation | null {
    const id = this.reservationId;
    return this.reservations.find((r) => r.id === id) ?? null;
  },
  get reservationNotFound(): boolean {
    return this.resLoaded && this.reservationId !== null && this.reservation === null;
  },
  get detailStatusLabel(): string {
    const r = this.reservation;
    return r ? STATUS_JA[r.status] : "";
  },
  get detailCanCancel(): boolean {
    return this.reservation?.status === "pending" && this.isGroup;
  },
  get detailSteps(): { label: string; at: string }[] {
    const r = this.reservation;
    if (!r) return [];
    const steps = [{ label: "申請", at: formatDateTime(r.createdAt) }];
    if (r.decidedAt) steps.push({ label: r.status === "denied" ? "却下" : "承認", at: `${formatDateTime(r.decidedAt)}（${r.decidedBy?.name ?? ""}）` });
    if (r.cancelledAt) steps.push({ label: "取消", at: formatDateTime(r.cancelledAt) });
    return steps;
  },
  get detailLines(): { name: string; period: string; quantity: number; deposit: string }[] {
    const r = this.reservation;
    return r ? r.lines.map((l) => ({ name: l.itemName, period: formatPeriod(l.from, l.to), quantity: l.quantity, deposit: yen(l.deposit * l.quantity) })) : [];
  },
  get detailPickup(): string {
    const r = this.reservation;
    return r ? formatDateTime(r.pickupAt) : "";
  },
  get detailReason(): string {
    return this.reservation?.reason ?? "";
  },

  // ---- admin (/admin) ----
  reasonDrafts: {} as Record<string, string>,
  adminMessage: "",
  get pendingList(): Reservation[] {
    return this.reservations.filter((r) => r.status === "pending").toSorted((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
  },
  get noPending(): boolean {
    return this.resLoaded && this.pendingList.length === 0;
  },
  get "pendingList.*.conflict"(): string {
    const r = this["pendingList.*"];
    const c = stockConflicts(r, this.reservations);
    return c.map((x) => `在庫を超えます: ${x.itemName} ${Number(x.day.slice(5, 7))}/${Number(x.day.slice(8, 10))}`).join("　");
  },
  get "pendingList.*.hasConflict"(): boolean {
    return this["pendingList.*.conflict"] !== "";
  },
  get "pendingList.*.summary"(): string {
    const r = this["pendingList.*"];
    return r.lines.map((l) => `${l.itemName}×${l.quantity}（${formatPeriod(l.from, l.to)}）`).join("、");
  },
  get "pendingList.*.createdLabel"(): string {
    return formatDateTime(this["pendingList.*.createdAt"]);
  },
  get "pendingList.*.pickupLabel"(): string {
    return formatDateTime(this["pendingList.*.pickupAt"]);
  },
  get "pendingList.*.reasonDraft"(): string {
    return this.reasonDrafts[String(this["pendingList.*.id"])] ?? "";
  },
  setReason(e: Event, i: number): void {
    const r = this.pendingList[i];
    if (!r || !(e.target instanceof HTMLInputElement)) return;
    this.reasonDrafts = { ...this.reasonDrafts, [String(r.id)]: e.target.value };
  },
  approve(_e: Event, i: number): void {
    const r = this.pendingList[i];
    if (r) this.decide(r.id, "approved", "");
  },
  deny(_e: Event, i: number): void {
    const r = this.pendingList[i];
    if (!r) return;
    const reason = (this.reasonDrafts[String(r.id)] ?? "").trim();
    if (!reason) {
      this.adminMessage = `申込 #${r.id}: 却下の理由を入力してください`;
      return;
    }
    this.decide(r.id, "denied", reason);
  },
  decide(id: number, decision: "approved" | "denied", reason: string): void {
    this.adminMessage = "";
    this.$command.decideReq.emit(`/api/reservations/${id}/decision`, { method: "POST", body: reason ? { decision, reason } : { decision } });
  },

  // ---- live updates (<wcs-sse>) ----
  sseConnected: false,
  get sseUrl(): string | null {
    const a = this.auth;
    return a ? `/api/events?token=${encodeURIComponent(a.token)}` : null;
  },

  // ---- formatting helpers for the templates ----
  get todayLabel(): string {
    return formatLong(this.today);
  },

  $commandTokens: ["logoutReq", "cancelReq", "decideReq", "reloadReservations"],
  $eventTokens: ["loginResponded", "submitResponded", "resResponded", "cancelResponded", "decideResponded", "sseMessage", "apiResponded"],
  // `state` is the state (its methods typed `any`); `ev` is narrowed to what each element dispatches
  $on: {
    loginResponded(state, ev: CustomEvent<FetchResponseDetail>) {
      const { status, value } = ev.detail;
      if (status === 200 && isLoginResponse(value)) {
        state.session = value;
        state.loginForm = { id: "", phrase: "" };
        state.replaceUrl = state.loginNext;
      } else if (status === 401) {
        state.loginMessage = "団体番号かあいことばが違います";
      } else {
        state.loginMessage = status === 0 ? "通信できませんでした。接続を確かめてください。" : `サインインできませんでした（${status}）`;
      }
    },
    submitResponded(state, ev: CustomEvent<FetchResponseDetail>) {
      const { status, value } = ev.detail;
      if (status === 401) return state.expire();
      if (status === 201) {
        const r = tryCheck(checkReservation, value).ok;
        state.cart = [];
        state.order = { purpose: "", pickupAt: "" };
        state.sentKeys = [];
        if (r) {
          state.reservations = upsert(state.reservations, r);
          state.navigateUrl = `/reservations/${r.id}`;
        } else state.navigateUrl = "/reservations";
        return;
      }
      if (status === 422) {
        state.submitMessage = "入力内容を確かめてください";
        return;
      }
      state.submitMessage = status === 0 ? "送信できませんでした。接続を確かめてもう一度お試しください。" : `送信できませんでした（${status}）。もう一度お試しください。`;
    },
    resResponded(state, ev: CustomEvent<FetchResponseDetail>) {
      const { status, value } = ev.detail;
      if (status === 401) return state.expire();
      if (status !== 200) {
        state.resProblem = `申込を読み込めませんでした（${status || "通信エラー"}）`;
        return;
      }
      const checked = tryCheck(checkReservations, value);
      state.resProblem = checked.problem;
      if (!checked.ok) return;
      state.reservations = checked.ok;
      state.resLoaded = true;
      if (state.seenIds === null || state.routeName === "reservations") state.markSeen();
    },
    cancelResponded(state, ev: CustomEvent<FetchResponseDetail>) {
      const { status, value } = ev.detail;
      if (status === 401) return state.expire();
      const r = tryCheck(checkReservation, value).ok;
      if (status === 200 && r) {
        state.reservations = upsert(state.reservations, r);
        state.cancelMessage = `申込 #${r.id} を取り消しました`;
      } else if (status === 409) {
        state.cancelMessage = "職員がすでに決定したため取り消せませんでした";
        state.$command.reloadReservations.emit();
      } else {
        state.cancelMessage = `取り消せませんでした（${status || "通信エラー"}）`;
      }
    },
    decideResponded(state, ev: CustomEvent<FetchResponseDetail>) {
      const { status, value } = ev.detail;
      if (status === 401) return state.expire();
      const r = tryCheck(checkReservation, value).ok;
      if (status === 200 && r) {
        state.reservations = upsert(state.reservations, r);
        state.adminMessage = `申込 #${r.id} を${STATUS_JA[r.status]}しました`;
      } else if (status === 409) {
        state.adminMessage = "この申込はすでに決定済みか取り消されています";
        state.$command.reloadReservations.emit();
      } else if (status === 422) {
        state.adminMessage = "却下の理由を入力してください";
      } else {
        state.adminMessage = `決定を送れませんでした（${status || "通信エラー"}）。もう一度お試しください。`;
      }
    },
    sseMessage(state, ev: CustomEvent<SseMessageDetail>) {
      if (ev.detail.event !== "reservation" || !state.auth) return;
      const r = tryCheck(checkReservation, ev.detail.data).ok;
      if (!r) return;
      state.reservations = upsert(state.reservations, r);
      if (state.routeName === "reservations" || state.routeName === "reservation") state.markSeen();
    },
    /** every authenticated GET reports here: a 401 anywhere signs the user out */
    apiResponded(state, ev: CustomEvent<FetchResponseDetail>) {
      if (ev.detail.status === 401) state.expire();
    },
  },

  $watch: {
    query(cur: Record<string, string>): void {
      if (this.routeName !== "search") return;
      const f = formFromQuery(cur);
      if (!sameSearch(f, this.form)) this.form = f;
    },
    routeName(cur: string): void {
      if (cur === "search") {
        const f = formFromQuery(this.query);
        if (!sameSearch(f, this.form)) this.form = f;
      }
      if (cur === "item") {
        this.calMonth = this.today.slice(0, 7);
        this.pick = { from: "", to: "", quantity: 1 };
        this.addedMessage = "";
      }
      if (cur === "reservations" || cur === "reservation" || cur === "admin") {
        this.cancelMessage = "";
        this.adminMessage = "";
        if (this.auth) this.$command.reloadReservations.emit();
      }
      if (cur === "reservations") this.markSeen();
    },
    settledQ(cur: string | null): void {
      if (cur === null || this.routeName !== "search") return;
      const now = formFromQuery(this.query);
      if (cur.trim() !== now.q.trim()) this.replaceUrl = searchHref({ ...now, q: cur }, 1);
    },
    "form.category"(): void { this.pushSearch(); },
    "form.center"(): void { this.pushSearch(); },
    "form.from"(): void { this.pushSearch(); },
    "form.to"(): void { this.pushSearch(); },
    "form.sort"(): void { this.pushSearch(); },
    clockTick(): void {
      this.nowMs = Date.now();
    },
    auth(cur: LoginResponse | null, prev: LoginResponse | null | undefined): void {
      // another tab signed out (storage event), or a 401: leave the member pages
      if (!cur && prev && this.routeName !== "login" && !this.signingOut) {
        this.replaceUrl = `/login?next=${encodeURIComponent(this.currentHref)}`;
      }
      if (cur) this.signingOut = false;
      // another tab signed in while this one shows the sign-in page
      if (cur && !prev && this.routeName === "login") this.replaceUrl = this.loginNext;
    },
    sseConnected(cur: boolean, prev: boolean | undefined): void {
      // the stream came back (the server restarted, the laptop woke): what arrived meanwhile is not replayed
      if (cur && prev === false && this.auth) this.$command.reloadReservations.emit();
    },
  },

  pushSearch(): void {
    if (this.routeName !== "search") return;
    const now = formFromQuery(this.query);
    const next: SearchForm = { ...this.form, q: now.q };
    if (!sameSearch(next, now)) this.navigateUrl = searchHref(next, 1);
  },

  get periodDaysLabel(): string {
    const from = this["pick.from"];
    const to = this["pick.to"];
    return isIsoDate(from) && isIsoDate(to) && from <= to ? `${periodDays(from, to)}日` : "";
  },
});
