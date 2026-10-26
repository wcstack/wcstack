/**
 * Demo server for shift-desk — a support desk's operator console that stays open for a shift
 * (state + router + fetch + sse + websocket + storage + broadcast + timer + raf + network + idle + wakelock +
 * notification + debounce).
 *
 *   cd examples/shift-desk && npm install && node server.js       http://localhost:3000 (PORT=… to change)
 *   WCS_LOCAL=1 node examples/shift-desk/server.js                the repository's packages/*\/dist instead of esm.run
 *
 * Users: ana, ben, carl — password "pw". carl is the other operator: the server lets him claim a ticket now and then.
 *
 * Switches (environment):
 *   TICK_MS=<ms>     a new ticket every <ms> of server time (default 20000; 0: none)
 *   PING_MS=<ms>     the chat's application-level ping (default 20000)
 *   TOKEN_TTL=<ms>   how long an access token lives (default 15 minutes of server time)
 *   START_AT=<ms>    the server's clock at start (default: real time)
 *   A page URL may carry ?stale=<ms>: the page goes out with that stale-after on its stream and chat (tests).
 *
 * API (in memory; 25 tickets are seeded):
 *   POST /api/login { user, password }        → 200 { token, refreshToken, expiresAt } | 401
 *   POST /api/refresh { refreshToken }        → 200 { token, expiresAt } | 401 { error: "revoked" }
 *   Every other /api/* needs Authorization: Bearer <token> (the stream and the chat: ?token=) → 401 { error: "expired" }
 *   GET  /api/tickets?status=open|mine|closed → { seq, tickets } — seq is the last event the snapshot includes
 *   GET  /api/tickets/:id                     → { …ticket, messages } | 404
 *   POST /api/tickets/:id/claim               → 200 ticket | 409 { error: "claimed", by }
 *   POST /api/tickets/:id/replies { text, clientId } → 201 { id, at } | 409 { error: "closed" } | 422 { errors: { text } };
 *                                               the same clientId again returns the first answer
 *   POST /api/tickets/:id/close               → 200 ticket
 *   GET  /api/stats/today                     → { date, opened, closed, breached } (the server's local day)
 *   GET  /api/events?since=<seq>&token=        text/event-stream: ticket-created / -updated / -claimed / -closed, each with
 *                                               id: <seq>; honours Last-Event-ID; retry: 3000
 *   WS   /ws/chat?ticket=<id>&token=           { type: "message", id, from, text, at } | { type: "typing", from } |
 *                                               { type: "ping" } every PING_MS; the customer answers after a few seconds
 *   Every /api/* answer may be delayed with ?delay=<ms>; ?fail=1 answers 500.
 *   GET  /elsewhere                            a page to leave to and come back from (open it on the other loopback name)
 *
 * Test hooks (POST; used by e2e/tests/shift-desk.spec.ts; never 502):
 *   /api/test/reset?at=<ms>       fresh data, as if the server started at that server time (tokens, joins, counters too)
 *   /api/test/time?at=|add=<ms>   move the server's clock (tickets created and closed meanwhile catch up)
 *   /api/test/tick?ms=            the interval between new tickets (0: none)      /api/test/ping?ms=   the chat's ping
 *   /api/test/drop                close every stream and socket                   /api/test/restart?ms=   502 for that long
 *   /api/test/blackhole           stop writing to every open stream and socket without closing them (a connection that
 *                                 died silently: a laptop's sleep, a NAT, a proxy)
 *   /api/test/token-ttl?ms=  /api/test/expire (every access token now)  /api/test/revoke (every refresh token so far)
 *   /api/test/burst?n=            n queue events at once                          /api/test/customer?ticket=&text=
 *   GET /api/test/state           the server's view: now, seq, open ids, today, the stream and chat connections, joins
 *   GET /api/test/ticket?id=      a ticket with its messages
 */
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { WebSocketServer } from "ws";
import { createDemoServer, jsonResponse, delay } from "../shared/server.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const PORT = Number(process.env.PORT || 3000);
const LOCAL = process.env.WCS_LOCAL === "1";

// ---------------------------------------------------------------- the page
// WCS_LOCAL=1: the esm.run one-liners become the repository's bundles (served below from packages/).
async function page(url) {
  let html = await readFile(join(__dirname, "index.html"), "utf8");
  if (LOCAL) html = html.replace(/https:\/\/esm\.run\/@wcstack\/([\w-]+)\/auto/g, (_m, pkg) => `/packages/${pkg}/dist/auto.min.js`);
  const stale = Number(url.searchParams.get("stale"));
  if (stale > 0) html = html.replace(/stale-after="\d+"/g, `stale-after="${stale}"`);
  return html;
}

// ---------------------------------------------------------------- the server's clock
let offset = 0;                                  // server time = real time + offset
const now = () => Date.now() + offset;

// ---------------------------------------------------------------- data
const USERS = { ana: "pw", ben: "pw", carl: "pw" };
const SLA = { urgent: 15, high: 60, normal: 240, low: 480 };
const PRIORITIES = ["low", "normal", "normal", "normal", "high", "high", "urgent"];
const SUBJECTS = ["Cannot log in", "Invoice is wrong", "App crashes on start", "Refund request",
  "Password reset mail never arrives", "Order stuck in transit", "Two charges on my card",
  "Export to CSV is empty", "Where is my parcel?", "Account locked", "Wrong size delivered",
  "Coupon not accepted", "Sync fails on Android", "Change delivery address", "Data missing after update"];
const CUSTOMERS = ["Mia Becker", "Noah Klein", "Emma Wolf", "Liam Braun", "Sofia Neumann", "Lukas Hoffmann",
  "Hana Sato", "Ken Ito", "Yui Tanaka", "Ola Nordmann", "Ines Duarte", "Tomás Silva"];
const EVENTS_CAP = 60000;

let tokenTtl = Number(process.env.TOKEN_TTL || 15 * 60 * 1000);
let tickMs = Number(process.env.TICK_MS ?? 20000);
let pingMs = Number(process.env.PING_MS || 20000);
let tokens, refreshTokens, tickets, nextTicketId, seq, events, replies, nextTicketAt, joins, streams, rng;

const rnd = (n) => Math.floor(rng() * n);
const pick = (a) => a[rnd(a.length)];
function seeded(seed) {             // a small deterministic generator: the same data after every reset
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function reset(at = Date.now()) {
  offset = at - Date.now();
  rng = seeded(42);
  tokens = new Map(); refreshTokens = new Map(); tickets = new Map(); replies = new Map();
  nextTicketId = 1; seq = 0; events = []; joins = []; streams = [];
  for (let i = 0; i < 25; i++) createTicket(now() - (25 - i) * 4 * 60000, true);   // a morning's worth
  nextTicketAt = now() + tickMs;
}

function summary(t) {
  const { messages, autoCloseAt, ...rest } = t;
  return { ...rest, lastMessageAt: messages.length ? messages[messages.length - 1].at : t.createdAt, messageCount: messages.length };
}
function emit(type, ticket) {
  seq += 1;
  const ev = { seq, type, data: summary(ticket) };
  events.push(ev);
  if (events.length > EVENTS_CAP) events.splice(0, events.length - EVENTS_CAP);
  for (const c of sseClients) sendEvent(c, ev);
}
function createTicket(at = now(), quiet = false) {
  const priority = pick(PRIORITIES);
  const id = nextTicketId++;
  const t = {
    id, subject: pick(SUBJECTS), customer: pick(CUSTOMERS), priority,
    createdAt: at, slaMinutes: SLA[priority], claimedBy: null, status: "open", closedAt: null,
    messages: [{ id: `m${id}-0`, from: "customer", text: "Hello, I need help: " + pick(SUBJECTS).toLowerCase() + ".", at }],
    autoCloseAt: at + (10 + rnd(80)) * 60000,    // the customer goes away unless an operator claims it
  };
  tickets.set(id, t);
  if (!quiet) emit("ticket-created", t);
  return t;
}
function closeTicket(t, at = now()) {
  t.status = "closed";
  t.closedAt = at;
  emit("ticket-closed", t);
}
// The server's own life: a ticket every tickMs of *server* time (catching up after a clock jump), tickets nobody
// claimed close themselves, and carl claims one now and then.
function lifeTick() {
  const t0 = now();
  let made = 0;
  while (tickMs > 0 && nextTicketAt <= t0 && made < 4000) {
    createTicket(nextTicketAt);
    nextTicketAt += tickMs;
    made += 1;
  }
  if (tickMs > 0 && nextTicketAt <= t0) nextTicketAt = t0 + tickMs;
  for (const t of tickets.values()) {
    if (t.status !== "open") continue;
    if (!t.claimedBy && t.autoCloseAt <= t0) closeTicket(t, t.autoCloseAt);
    else if (t.claimedBy === "carl" && t.autoCloseAt + 5 * 60000 <= t0) closeTicket(t, t0);
  }
  if (made && rng() < 0.25) {
    const free = [...tickets.values()].filter((t) => t.status === "open" && !t.claimedBy);
    if (free.length) { const t = pick(free); t.claimedBy = "carl"; emit("ticket-claimed", t); }
  }
}

// ---------------------------------------------------------------- outages
let downUntil = 0;
const sseClients = new Set();                    // { res, user }
const wsClients = new Set();                     // { ws, ticket, user }
const dead = new Set();                          // /api/test/blackhole: connections lost without a close
function dropAll() {
  for (const c of sseClients) c.res.destroy();
  sseClients.clear();
  for (const c of wsClients) c.ws.terminate();
  wsClients.clear();
}

// ---------------------------------------------------------------- helpers
async function readJson(req) {
  let s = "";
  for await (const chunk of req) s += chunk;
  try { return s ? JSON.parse(s) : {}; } catch { return null; }
}
function issueToken(user) {
  const token = randomBytes(12).toString("hex");
  const exp = now() + tokenTtl;
  tokens.set(token, { user, exp });
  return { token, expiresAt: exp };
}
function auth(req, url) {
  let token = url.searchParams.get("token");
  const h = req.headers.authorization;
  if (h && h.startsWith("Bearer ")) token = h.slice(7);
  if (!token) return { error: "missing" };
  const rec = tokens.get(token);
  if (!rec) return { error: "invalid" };
  if (rec.exp <= now()) return { error: "expired" };
  return { user: rec.user };
}
function localDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayStats() {
  const t0 = now();
  const day = localDate(t0);
  let opened = 0, closed = 0, breached = 0;
  for (const t of tickets.values()) {
    if (localDate(t.createdAt) === day) opened += 1;
    if (t.closedAt && localDate(t.closedAt) === day) closed += 1;
    const deadline = t.createdAt + t.slaMinutes * 60000;
    if (deadline <= t0 && localDate(deadline) === day && (t.closedAt ?? Infinity) > deadline) breached += 1;
  }
  return { date: day, opened, closed, breached };
}

// ---------------------------------------------------------------- the stream
function sendEvent(c, ev) {
  if (dead.has(c)) return;
  c.res.write(`id: ${ev.seq}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev.data)}\n\n`);
}
function openStream(req, res, url, user) {
  const lastEventId = req.headers["last-event-id"];
  const from = Number(lastEventId ?? url.searchParams.get("since") ?? seq);
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
  res.write("retry: 3000\n\n");
  const c = { res, user };
  streams.push({ at: now(), since: Number.isFinite(from) ? from : null, lastEventId: lastEventId ?? null });
  const first = events.findIndex((e) => e.seq > from);
  if (first >= 0) for (let i = first; i < events.length; i++) sendEvent(c, events[i]);
  sseClients.add(c);
  req.on("close", () => { sseClients.delete(c); });
}

// ---------------------------------------------------------------- the chat
const wss = new WebSocketServer({ noServer: true });
function wsSend(c, msg) {
  if (dead.has(c) || c.ws.readyState !== 1) return;
  c.ws.send(JSON.stringify(msg));
}
function toTicket(ticketId, msg) {
  for (const c of wsClients) if (c.ticket === ticketId) wsSend(c, msg);
}
function customerSays(t, text, wait = 2500 + rnd(3500)) {
  const live = () => t.status === "open" && tickets.get(t.id) === t;    // not closed, and not from before a reset
  setTimeout(() => {
    if (!live()) return;
    toTicket(t.id, { type: "typing", from: "customer" });
    setTimeout(() => {
      if (!live()) return;
      const m = { id: `m${t.id}-${t.messages.length}`, from: "customer", text, at: now() };
      t.messages.push(m);
      toTicket(t.id, { type: "message", ...m });
      emit("ticket-updated", t);
    }, 1500);
  }, wait);
}
let pingTimer = null;
function startPing() {
  clearInterval(pingTimer);
  pingTimer = setInterval(() => { for (const c of wsClients) wsSend(c, { type: "ping" }); }, pingMs);
}

reset(process.env.START_AT ? Number(process.env.START_AT) : Date.now());
setInterval(lifeTick, 500);
startPing();

// ---------------------------------------------------------------- test hooks
function testHook(pathname, q) {
  switch (pathname) {
    case "/api/test/reset":
      reset(q("at") ? Number(q("at")) : Date.now()); dropAll(); dead.clear(); downUntil = 0;
      lifeTick();      // the seeded tickets whose customer already left close now, not half a second into a test
      return { now: now() };
    case "/api/test/time":
      if (q("at") !== null) offset = Number(q("at")) - Date.now();
      if (q("add") !== null) offset += Number(q("add"));
      lifeTick();
      return { now: now() };
    case "/api/test/tick": tickMs = Number(q("ms") ?? 20000); nextTicketAt = now() + tickMs; return { tickMs };
    case "/api/test/ping": pingMs = Number(q("ms") ?? 20000); startPing(); return { pingMs };
    case "/api/test/drop": dropAll(); return { dropped: true };
    case "/api/test/restart": downUntil = Date.now() + Number(q("ms") ?? 5000); dropAll(); return { downUntil };
    case "/api/test/blackhole": {
      for (const c of sseClients) { dead.add(c); sseClients.delete(c); }
      for (const c of wsClients) { dead.add(c); wsClients.delete(c); }
      return { dead: dead.size };
    }
    case "/api/test/token-ttl": tokenTtl = Number(q("ms") ?? 900000); return { tokenTtl };
    case "/api/test/expire": for (const r of tokens.values()) r.exp = Math.min(r.exp, now()); return { expired: tokens.size };
    case "/api/test/revoke": for (const r of refreshTokens.values()) r.revoked = true; return { revoked: refreshTokens.size };
    case "/api/test/burst": {
      const n = Number(q("n") ?? 100);
      for (let i = 0; i < n; i++) {
        const open = [...tickets.values()].filter((t) => t.status === "open");
        if (i % 5 === 0 || !open.length) createTicket(); else emit("ticket-updated", pick(open));
      }
      return { seq };
    }
    case "/api/test/customer": {
      const t = tickets.get(Number(q("ticket")));
      if (!t) return null;
      customerSays(t, q("text") ?? "A message from the customer.", Number(q("delay") ?? 0));
      return { ok: true };
    }
    default: return null;
  }
}
function testState() {
  const open = [...tickets.values()].filter((t) => t.status === "open");
  return {
    now: now(), seq, open: open.length, openIds: open.map((t) => t.id), today: todayStats(),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    connections: { streams: sseClients.size, chats: [...wsClients].map((c) => c.ticket) },
    streams, joins,
    tickets: Object.fromEntries([...tickets.values()].map((t) => [t.id, { claimedBy: t.claimedBy, status: t.status, messages: t.messages.length }])),
  };
}

// ---------------------------------------------------------------- routes
const server = createDemoServer({
  port: PORT,
  root: __dirname,
  api: async (req, res, url) => {
    const { pathname } = url;

    if (LOCAL && req.method === "GET" && pathname.startsWith("/packages/")) {
      const file = resolve(REPO_ROOT, "." + pathname);
      if (!file.startsWith(join(REPO_ROOT, "packages"))) { res.writeHead(403); res.end("Forbidden"); return true; }
      const body = await readFile(file).catch(() => null);
      if (!body) { res.writeHead(404); res.end("Not found"); return true; }
      res.writeHead(200, { "Content-Type": file.endsWith(".map") ? "application/json" : "text/javascript; charset=utf-8" });
      res.end(body);
      return true;
    }

    // ---- test hooks (never 502) ----
    if (pathname === "/api/test/state" && req.method === "GET") return jsonResponse(res, testState()), true;
    if (pathname === "/api/test/ticket" && req.method === "GET") {
      const t = tickets.get(Number(url.searchParams.get("id")));
      return jsonResponse(res, t ? { ...summary(t), messages: t.messages } : { error: "not found" }, t ? 200 : 404), true;
    }
    if (pathname.startsWith("/api/test/") && req.method === "POST") {
      const out = testHook(pathname, (k) => url.searchParams.get(k));
      return jsonResponse(res, out ?? { error: "no such hook" }, out ? 200 : 404), true;
    }

    if (Date.now() < downUntil) { res.writeHead(502, { "Content-Type": "text/plain" }); res.end("502 Bad Gateway"); return true; }

    // ---- API ----
    if (pathname.startsWith("/api/")) {
      const ms = Number(url.searchParams.get("delay") || 0);
      if (ms) await delay(ms);
      if (url.searchParams.get("fail") === "1") return jsonResponse(res, { error: "failed on purpose" }, 500), true;

      if (pathname === "/api/login" && req.method === "POST") {
        const b = await readJson(req);
        if (!b || USERS[b.user] !== b.password) return jsonResponse(res, { error: "invalid credentials" }, 401), true;
        const refreshToken = randomBytes(12).toString("hex");
        refreshTokens.set(refreshToken, { user: b.user, revoked: false });
        return jsonResponse(res, { ...issueToken(b.user), refreshToken }), true;
      }
      if (pathname === "/api/refresh" && req.method === "POST") {
        const b = await readJson(req);
        const r = b && refreshTokens.get(b.refreshToken);
        if (!r || r.revoked) return jsonResponse(res, { error: "revoked" }, 401), true;
        return jsonResponse(res, issueToken(r.user)), true;
      }
      const a = auth(req, url);
      if (a.error) return jsonResponse(res, { error: a.error }, 401), true;
      const user = a.user;

      if (pathname === "/api/events" && req.method === "GET") return openStream(req, res, url, user), true;
      if (pathname === "/api/tickets" && req.method === "GET") {
        const status = url.searchParams.get("status") ?? "open";
        const list = [...tickets.values()].filter((t) =>
          status === "open" ? t.status === "open" : status === "mine" ? t.status === "open" && t.claimedBy === user : t.status === "closed");
        return jsonResponse(res, { seq, tickets: list.map(summary) }), true;
      }
      if (pathname === "/api/stats/today" && req.method === "GET") return jsonResponse(res, todayStats()), true;
      const m = /^\/api\/tickets\/(\d+)(?:\/(claim|replies|close))?$/.exec(pathname);
      if (m) {
        const t = tickets.get(Number(m[1]));
        if (!t) return jsonResponse(res, { error: "not found" }, 404), true;
        if (!m[2] && req.method === "GET") return jsonResponse(res, { ...summary(t), messages: t.messages }), true;
        if (m[2] === "claim" && req.method === "POST") {
          if (t.claimedBy && t.claimedBy !== user) return jsonResponse(res, { error: "claimed", by: t.claimedBy }, 409), true;
          if (t.status !== "open") return jsonResponse(res, { error: "closed" }, 409), true;
          if (t.claimedBy !== user) { t.claimedBy = user; emit("ticket-claimed", t); }
          return jsonResponse(res, summary(t)), true;
        }
        if (m[2] === "replies" && req.method === "POST") {
          const b = await readJson(req);
          const clientId = b?.clientId;
          if (clientId && replies.has(clientId)) { const r = replies.get(clientId); return jsonResponse(res, r.body, r.status), true; }
          if (t.status !== "open") return jsonResponse(res, { error: "closed" }, 409), true;
          const text = typeof b?.text === "string" ? b.text.trim() : "";
          if (!text || text.length > 2000) return jsonResponse(res, { errors: { text: text ? "Too long (2000 at most)." : "Write something." } }, 422), true;
          const msg = { id: `m${t.id}-${t.messages.length}`, from: user, text, at: now() };
          t.messages.push(msg);
          const body = { id: msg.id, at: msg.at };
          if (clientId) replies.set(clientId, { status: 201, body });
          toTicket(t.id, { type: "message", ...msg });
          emit("ticket-updated", t);
          customerSays(t, pick(["Thank you!", "That did not work.", "OK, trying that now.", "Can you check again?", "Great, it works."]));
          return jsonResponse(res, body, 201), true;
        }
        if (m[2] === "close" && req.method === "POST") {
          if (t.status === "open") closeTicket(t);
          return jsonResponse(res, summary(t)), true;
        }
      }
      return jsonResponse(res, { error: "not found" }, 404), true;
    }

    if (req.method === "GET" && pathname === "/elsewhere") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><link rel="icon" href="data:,"><title>Somewhere else</title></head>
<body><h1>Another site</h1><p>The operator looked something up here, then pressed Back.</p></body></html>`);
      return true;
    }

    // Every other extensionless GET is the app (history fallback). Not no-store: a page served with
    // Cache-Control: no-store is never restored from the back/forward cache.
    if (req.method === "GET" && extname(pathname) === "") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      res.end(await page(url));
      return true;
    }
    return false;   // state.js, app.css: the shared static files
  },
  notes: [
    ...(LOCAL ? ["WCS_LOCAL=1: esm.run one-liners rewritten to the local packages/*/dist"] : []),
    "Users: ana / ben / carl, password pw",
  ],
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/ws/chat" || Date.now() < downUntil) { socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n"); return socket.destroy(); }
  const a = auth(req, url);
  const t = tickets.get(Number(url.searchParams.get("ticket")));
  if (a.error || !t) { socket.write(`HTTP/1.1 ${a.error ? "401 Unauthorized" : "404 Not Found"}\r\n\r\n`); return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const c = { ws, ticket: t.id, user: a.user };
    wsClients.add(c);
    joins.push({ ticket: t.id, user: a.user, at: now() });
    ws.on("message", (raw) => {
      let msg; try { msg = JSON.parse(String(raw)); } catch { return; }
      if (msg?.type === "typing") toTicket(t.id, { type: "typing", from: a.user });
    });
    ws.on("close", () => wsClients.delete(c));
  });
});

// sometimes the customer types first
setInterval(() => {
  for (const c of wsClients) {
    const t = tickets.get(c.ticket);
    if (t && rng() < 0.15) customerSays(t, pick(["Any news?", "Hello?", "I tried again, still broken.", "Thanks for looking."]), 0);
  }
}, 30000);
