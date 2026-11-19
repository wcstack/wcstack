// The API (Node only, data in memory). Run: node server/main.ts  (Node strips the types).

import type { IncomingMessage, ServerResponse } from "node:http";
import { createHmac } from "node:crypto";
import type {
  CounterEntry, CounterResponse, DecisionRequest, ItemDetail, ItemsResponse, LoginRequest, LoginResponse,
  Reservation, ReservationLine, ReservationRequest, ReservationStatus, TestFailRequest, TestLogEntry, User,
} from "../shared/api.ts";
import { RESERVATION_STATUSES } from "../shared/api.ts";
import { addMonthsToDate, isIsoDate, japanDate, japanDateTime } from "../shared/dates.ts";
import { bookingsOf, freeInPeriod } from "../shared/stock.ts";
import type { Account, Db } from "./data.ts";
import { ACCOUNTS, CENTERS, makeDb } from "./data.ts";

interface SseClient {
  res: ServerResponse;
  user: User | null;
}

export class Api {
  db: Db;
  todayOverride: string | null = null;
  /** Signed-out tokens. Tokens are signed (HMAC), so a restart of the server keeps everyone signed in. */
  revoked = new Set<string>();
  fails = new Map<string, { status: number; times: number }>();
  log: TestLogEntry[] = [];
  sse = new Set<SseClient>();

  constructor() {
    this.db = makeDb(this.today());
    setInterval(() => {
      for (const c of this.sse) c.res.write(": ping\n\n");
    }, 15_000).unref();
  }

  today(): string {
    return this.todayOverride ?? japanDate(Date.now());
  }

  now(): string {
    const real = japanDateTime(Date.now());
    return this.todayOverride ? `${this.todayOverride}T${real.slice(11)}` : real;
  }

  reset(today?: string): void {
    this.todayOverride = today && isIsoDate(today) ? today : null;
    this.db = makeDb(this.today());
    this.revoked.clear();
    this.fails.clear();
    this.log = [];
    for (const c of this.sse) c.res.end();
    this.sse.clear();
  }

  userOf(req: IncomingMessage, url: URL): User | null {
    const h = req.headers.authorization;
    const token = h?.startsWith("Bearer ") ? h.slice(7) : url.searchParams.get("token");
    if (!token) return null;
    if (this.revoked.has(token)) return null;
    const [id, nonce, sig] = token.split(".");
    if (!id || !nonce || sig !== sign(`${id}.${nonce}`)) return null;
    const acc = ACCOUNTS.find((a) => a.id === id);
    return acc ? publicUser(acc) : null;
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const method = req.method ?? "GET";
    const body = method === "POST" ? await readBody(req) : undefined;
    const delay = Number(url.searchParams.get("delay") ?? 0);
    if (delay > 0) await new Promise((r) => setTimeout(r, Math.min(delay, 30_000)));

    const entry: TestLogEntry = {
      method, path, query: url.search, body: body?.json ?? body?.text ?? null, status: 0,
      auth: req.headers.authorization ?? null,
    };
    if (!path.startsWith("/api/_test/")) this.log.push(entry);
    const send = (status: number, data: unknown): void => {
      entry.status = status;
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(data));
    };

    const fail = this.fails.get(path);
    if (fail && fail.times > 0 && !path.startsWith("/api/_test/")) {
      fail.times--;
      if (fail.times <= 0) this.fails.delete(path);
      return send(fail.status, { error: `test failure ${fail.status}` });
    }

    try {
      await this.route(method, path, url, req, res, body?.json, send, entry);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) send(500, { error: "internal error" });
    }
  }

  async route(
    method: string, path: string, url: URL, req: IncomingMessage, res: ServerResponse, json: unknown,
    send: (status: number, data: unknown) => void, entry: TestLogEntry,
  ): Promise<void> {
    // ---- test hooks ----
    if (path === "/api/_test/reset" && method === "POST") {
      const b = (json ?? {}) as { today?: string };
      this.reset(b.today);
      return send(200, { ok: true, today: this.today() });
    }
    if (path === "/api/_test/today" && method === "POST") {
      const b = (json ?? {}) as { date?: string };
      if (!isIsoDate(b.date)) return send(400, { error: "date" });
      this.todayOverride = b.date;
      return send(200, { ok: true, today: this.today() });
    }
    if (path === "/api/_test/fail" && method === "POST") {
      const b = json as TestFailRequest;
      this.fails.set(b.path, { status: b.status, times: b.times });
      return send(200, { ok: true });
    }
    if (path === "/api/_test/log" && method === "GET") return send(200, this.log);

    // ---- public ----
    if (path === "/api/login" && method === "POST") {
      const b = (json ?? {}) as Partial<LoginRequest>;
      const acc = ACCOUNTS.find((a) => a.id === String(b.id ?? "").trim().toUpperCase() && a.phrase === b.phrase);
      if (!acc) return send(401, { error: "団体番号かあいことばが違います" });
      const nonce = Math.random().toString(36).slice(2, 10);
      const token = `${acc.id}.${nonce}.${sign(`${acc.id}.${nonce}`)}`;
      const out: LoginResponse = { token, user: publicUser(acc) };
      return send(200, out);
    }
    if (path === "/api/today" && method === "GET") return send(200, { today: this.today() });
    if (path === "/api/centers" && method === "GET") return send(200, CENTERS);
    if (path === "/api/counter" && method === "GET") {
      const c = Number(url.searchParams.get("center"));
      const center = CENTERS.find((x) => x.id === c);
      if (!center) return send(404, { error: "センターがありません" });
      return send(200, this.counter(center.id));
    }
    if (path === "/api/events" && method === "GET") {
      const user = this.userOf(req, url);
      if (url.searchParams.has("token") && !user) return send(401, { error: "unauthorized" });
      entry.status = 200;
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
      res.write("retry: 2000\n\n");
      const client: SseClient = { res, user };
      this.sse.add(client);
      req.on("close", () => this.sse.delete(client));
      return;
    }

    // ---- signed in ----
    const user = this.userOf(req, url);
    if (!user) return send(401, { error: "サインインしてください" });

    if (path === "/api/me" && method === "GET") return send(200, { user });
    if (path === "/api/logout" && method === "POST") {
      const h = req.headers.authorization ?? "";
      this.revoked.add(h.slice(7));
      return send(200, { ok: true });
    }
    if (path === "/api/items" && method === "GET") return send(200, this.items(url));
    let m = /^\/api\/items\/(\d+)$/.exec(path);
    if (m && method === "GET") {
      const it = this.db.items.find((i) => i.id === Number(m![1]));
      if (!it) return send(404, { error: "見つかりません" });
      const today = this.today();
      const until = addMonthsToDate(today, 3);
      const detail: ItemDetail = { ...it, booked: bookingsOf(it.id, this.db.reservations, { from: today, to: until }) };
      return send(200, detail);
    }
    if (path === "/api/reservations" && method === "GET") {
      const status = url.searchParams.get("status");
      let list = this.db.reservations.filter((r) => user.role === "staff" || r.groupId === user.id);
      if (status && (RESERVATION_STATUSES as readonly string[]).includes(status)) list = list.filter((r) => r.status === status);
      return send(200, list.toSorted((a, b) => b.id - a.id));
    }
    if (path === "/api/reservations" && method === "POST") {
      if (user.role !== "group") return send(403, { error: "団体のみ申し込めます" });
      const result = this.validate(json);
      if ("errors" in result) return send(422, { errors: result.errors });
      const acc = ACCOUNTS.find((a) => a.id === user.id) as Account;
      const r: Reservation = {
        id: this.db.nextReservationId++, groupId: acc.id, groupName: acc.name, status: "pending",
        lines: result.lines, purpose: result.purpose, pickupAt: result.pickupAt, createdAt: this.now(),
      };
      this.db.reservations.push(r);
      this.broadcast(r);
      return send(201, r);
    }
    m = /^\/api\/reservations\/(\d+)$/.exec(path);
    if (m && method === "GET") {
      const r = this.db.reservations.find((x) => x.id === Number(m![1]));
      if (!r || (user.role !== "staff" && r.groupId !== user.id)) return send(404, { error: "見つかりません" });
      return send(200, r);
    }
    m = /^\/api\/reservations\/(\d+)\/cancel$/.exec(path);
    if (m && method === "POST") {
      const r = this.db.reservations.find((x) => x.id === Number(m![1]));
      if (!r || r.groupId !== user.id) return send(404, { error: "見つかりません" });
      if (r.status !== "pending") return send(409, { error: "すでに決定済みのため取り消せません", reservation: r });
      r.status = "cancelled";
      r.cancelledAt = this.now();
      this.broadcast(r);
      return send(200, r);
    }
    m = /^\/api\/reservations\/(\d+)\/decision$/.exec(path);
    if (m && method === "POST") {
      if (user.role !== "staff") return send(403, { error: "職員のみ" });
      const r = this.db.reservations.find((x) => x.id === Number(m![1]));
      if (!r) return send(404, { error: "見つかりません" });
      const b = (json ?? {}) as Partial<DecisionRequest>;
      if (r.status !== "pending") return send(409, { error: "この申込はすでに決定済みか取り消されています", reservation: r });
      if (b.decision !== "approved" && b.decision !== "denied") return send(422, { errors: { decision: "承認か却下を選んでください" } });
      const reason = typeof b.reason === "string" ? b.reason.trim() : "";
      if (b.decision === "denied" && !reason) return send(422, { errors: { reason: "却下の理由を入力してください" } });
      r.status = b.decision;
      r.decidedAt = this.now();
      r.decidedBy = { id: user.id, name: user.name };
      if (reason) r.reason = reason;
      this.broadcast(r);
      return send(200, r);
    }
    send(404, { error: "not found" });
  }

  items(url: URL): ItemsResponse {
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const category = url.searchParams.get("category") ?? "";
    const center = Number(url.searchParams.get("center") ?? 0);
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    const sort = url.searchParams.get("sort") === "deposit" ? "deposit" : "name";
    const per = Math.min(500, Math.max(1, Number(url.searchParams.get("per") ?? 20) || 20));
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
    let list = this.db.items.filter((i) =>
      (!q || i.name.toLowerCase().includes(q) || (i.note ?? "").toLowerCase().includes(q)) &&
      (!category || i.category === category) &&
      (!center || i.centerId === center));
    const collator = new Intl.Collator("ja");
    list = list.toSorted((a, b) => sort === "deposit"
      ? a.deposit - b.deposit || collator.compare(a.name, b.name) || a.id - b.id
      : collator.compare(a.name, b.name) || a.centerId - b.centerId || a.id - b.id);
    const withPeriod = isIsoDate(from) && isIsoDate(to) && from <= to;
    const pageItems = list.slice((page - 1) * per, page * per).map((i) => withPeriod
      ? { ...i, free: freeInPeriod(i.stock, bookingsOf(i.id, this.db.reservations), from, to) }
      : { ...i });
    return { items: pageItems, total: list.length, page };
  }

  validate(json: unknown): { errors: Record<string, string> } | { lines: ReservationLine[]; purpose: string; pickupAt: string } {
    const b = (json ?? {}) as Partial<ReservationRequest>;
    const errors: Record<string, string> = {};
    const today = this.today();
    const until = addMonthsToDate(today, 3);
    const purpose = typeof b.purpose === "string" ? b.purpose.trim() : "";
    if (!purpose) errors.purpose = "利用目的を入力してください";
    else if ([...purpose].length > 200) errors.purpose = "利用目的は200文字以内で入力してください";
    const pickupAt = typeof b.pickupAt === "string" ? b.pickupAt : "";
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(pickupAt) || !isIsoDate(pickupAt.slice(0, 10))) errors.pickupAt = "受け取り日時を入力してください";
    else if (pickupAt.slice(0, 10) < today) errors.pickupAt = "受け取り日時が今日より前です";
    const lines: ReservationLine[] = [];
    const input = Array.isArray(b.lines) ? b.lines : [];
    if (input.length === 0) errors.lines = "申込かごが空です";
    const accepted: { itemId: number; from: string; to: string; quantity: number }[] = [];
    input.forEach((l, i) => {
      const it = this.db.items.find((x) => x.id === Number(l?.itemId));
      if (!it) { errors[`lines.${i}.itemId`] = "備品がありません"; return; }
      const from = String(l.from ?? "");
      const to = String(l.to ?? "");
      if (!isIsoDate(from)) { errors[`lines.${i}.from`] = "開始日が正しくありません"; return; }
      if (!isIsoDate(to)) { errors[`lines.${i}.to`] = "終了日が正しくありません"; return; }
      if (from > to) { errors[`lines.${i}.from`] = "開始日が終了日より後です"; return; }
      if (from < today) { errors[`lines.${i}.from`] = "今日より前の日は選べません"; return; }
      if (to > until) { errors[`lines.${i}.to`] = "3か月より先は申し込めません"; return; }
      const quantity = Number(l.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) { errors[`lines.${i}.quantity`] = "数量は1以上です"; return; }
      const others = bookingsOf(it.id, this.db.reservations).concat(accepted.filter((a) => a.itemId === it.id));
      const free = freeInPeriod(it.stock, others, from, to);
      if (quantity > free) { errors[`lines.${i}.quantity`] = free === 0 ? "この期間は空きがありません" : `この期間の空きは${free}です`; return; }
      accepted.push({ itemId: it.id, from, to, quantity });
      lines.push({ itemId: it.id, from, to, quantity, itemName: it.name, centerId: it.centerId, stock: it.stock, deposit: it.deposit });
    });
    if (Object.keys(errors).length > 0) return { errors };
    return { lines, purpose, pickupAt };
  }

  counter(centerId: number): CounterResponse {
    const today = this.today();
    const pickups: CounterEntry[] = [];
    const returns: CounterEntry[] = [];
    for (const r of this.db.reservations) {
      if (r.status !== "approved") continue;
      for (const l of r.lines) {
        if (l.centerId !== centerId) continue;
        const base = { reservationId: r.id, groupName: r.groupName, itemName: l.itemName, quantity: l.quantity, status: r.status as ReservationStatus };
        if (l.from === today) pickups.push({ ...base, at: r.pickupAt.slice(0, 10) === today ? r.pickupAt.slice(11) : "" });
        if (l.to === today) returns.push({ ...base, at: "" });
      }
    }
    const center = CENTERS.find((c) => c.id === centerId)!;
    return { centerId, centerName: center.name, date: today, pickups, returns };
  }

  broadcast(r: Reservation): void {
    const data = JSON.stringify(r);
    const today = this.today();
    const centers = new Set(r.lines.filter((l) => l.from === today || l.to === today).map((l) => l.centerId));
    for (const c of this.sse) {
      if (c.user && (c.user.role === "staff" || c.user.id === r.groupId)) c.res.write(`event: reservation\ndata: ${data}\n\n`);
      for (const centerId of centers) c.res.write(`event: counter\ndata: ${JSON.stringify({ centerId })}\n\n`);
    }
  }
}

const SECRET = process.env.TOKEN_SECRET ?? "midori-dev-secret";
function sign(id: string): string {
  return createHmac("sha256", SECRET).update(id).digest("base64url").slice(0, 22);
}

function publicUser(a: Account): User {
  return { id: a.id, name: a.name, role: a.role };
}

async function readBody(req: IncomingMessage): Promise<{ text: string; json: unknown }> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  let json: unknown = undefined;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { text, json };
}

