/**
 * Demo server for city-library — a city library's patron site in Japanese, English and Arabic
 * (state + router + fetch + sse + storage + debounce + timer + media-query + view-transition).
 *
 *   node examples/city-library/server.js                http://localhost:5520 (PORT=… to change)
 *   WCS_LOCAL=1 node examples/city-library/server.js    the repository's packages/*\/dist instead of esm.run
 *
 * Node built-ins only: nothing to install to run it. The data lives in memory (data.js).
 *
 * Library cards: 1001 (Japanese name), 1002 (English), 1003 (Arabic), PIN 1234.
 *
 * Pages: "/" and every extensionless path serve public/index.html; its head script settles the
 * language (/ja/, /en/ or /ar/) and repairs a URL without one.
 *
 * API (every /api/* takes ?lang=ja|en|ar for its messages, ?delay=<ms> to answer later, ?fail=1 to answer 500):
 *   POST   /api/login { card, pin }                    → 200 { token, name, card } | 401
 *   GET    /api/catalog?q&type&branch&sort&page&per    → { total, page, per, items }
 *   GET    /api/items/:id                              → the item with its copies | 404
 *   GET    /api/branches                               → [{ id, name, timeZone: "Asia/Tokyo" }]
 *   GET    /api/hours?branch&from=YYYY-MM-DD&days=N    → { branch, timeZone, days: [{ date, opens, closes }] } (Tokyo time;
 *                                                        the /hours page passes its own ?from= through)
 *   GET    /api/stream?token=                          text/event-stream: hold-ready / hold-expired, each with id:;
 *                                                        honours Last-Event-ID
 *   With Authorization: Bearer <token>:
 *   GET    /api/me/holds, /api/me/fees
 *   POST   /api/holds { itemId, branch, notify, phone } → 201 | 422 { errors: { field: { code, message } } } | 409
 *   DELETE /api/holds/:id                              → 204 | 404
 *
 * Test hooks (POST; used by e2e/tests/city-library.spec.ts):
 *   /__reset                         fresh data (no sessions, no holds; streams closed)
 *   /__ready?hold=<id>[&days=N]      the hold is ready to collect (a hold-ready event)
 *   /__expire?hold=<id>              the hold expired (a hold-expired event)
 *   /__resend?hold=<id>[&sameId=1]   the hold's last event again, with a new id (or its own)
 *   /__streams                       the cards with an open event stream
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { BRANCHES, ITEMS, LANGS, PATRONS, FEES, MESSAGES, WEEKLY_HOURS, itemView, itemDetail } from "./data.js";

const ROOT = resolve(fileURLToPath(new URL("./public/", import.meta.url)));
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const PAGE = join(ROOT, "index.html");
const PORT = Number(process.env.PORT || 5520);
const LOCAL = process.env.WCS_LOCAL === "1";
const LOG = process.env.LOG === "1";

// WCS_LOCAL=1: the esm.run one-liners become the repository's bundles (served below from packages/).
async function page() {
  const html = await readFile(PAGE, "utf8");
  return LOCAL ? html.replace(/https:\/\/esm\.run\/@wcstack\/([\w-]+)\/auto/g, (_m, pkg) => `/packages/${pkg}/dist/auto.min.js`) : html;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

// ---------------------------------------------------------------- state ----
let tokens = new Map();        // token -> card
let holds = [];                // { id, card, itemId, branch, notify, phone, status, position, readyUntil, createdAt }
let nextHoldId = 1;
let events = [];               // { seq, card, type, holdId, snapshot }
let seq = 0;
const streams = new Set();     // { res, card, lang }

function reset() {
  tokens = new Map();
  holds = [];
  nextHoldId = 1;
  events = [];
  seq = 0;
  for (const s of streams) { try { s.res.end(); } catch {} }
  streams.clear();
}

// ---------------------------------------------------------------- helpers --
function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(data === undefined ? "" : JSON.stringify(data));
}
function langOf(url) {
  const l = url.searchParams.get("lang");
  return LANGS.includes(l) ? l : "ja";
}
function msg(code, lang) { return MESSAGES[code][lang]; }
async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  if (!body) return {};
  return JSON.parse(body);
}
function authCard(req, url, { allowQuery = false } = {}) {
  const h = req.headers.authorization || "";
  let token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token && allowQuery) token = url.searchParams.get("token");
  return token && tokens.has(token) ? tokens.get(token) : null;
}
const branchName = (id, lang) => BRANCHES.find((b) => b.id === id)?.name[lang] ?? id;

// An ISO date-time in Tokyo (+09:00) for an instant.
function tokyoIso(ms) {
  const d = new Date(ms + 9 * 3600_000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00+09:00`;
}
// Today's date (YYYY-MM-DD) in Tokyo.
function tokyoToday() { return tokyoIso(Date.now()).slice(0, 10); }

function holdView(h, lang) {
  const item = ITEMS.find((i) => i.id === h.itemId);
  return {
    id: h.id,
    itemId: h.itemId,
    title: item.title[lang],
    branch: h.branch,
    status: h.status,
    position: h.position,
    readyUntil: h.readyUntil,
    notify: h.notify,
  };
}

// ---------------------------------------------------------------- SSE ------
function eventPayload(ev, lang) {
  const h = holds.find((x) => x.id === ev.holdId) ?? ev.snapshot;
  const view = holdView(h, lang);
  const make = MESSAGES[ev.type][lang];
  view.message = ev.type === "hold-ready" ? make(view.title, branchName(view.branch, lang)) : make(view.title);
  return view;
}
function writeEvent(s, ev) {
  s.res.write(`id: ${ev.seq}\nevent: ${ev.type}\ndata: ${JSON.stringify(eventPayload(ev, s.lang))}\n\n`);
}
function publish(card, type, hold) {
  const ev = { seq: ++seq, card, type, holdId: hold.id, snapshot: { ...hold } };
  events.push(ev);
  for (const s of streams) if (s.card === card) writeEvent(s, ev);
  return ev;
}

// ---------------------------------------------------------------- API ------
async function api(req, res, url) {
  const lang = langOf(url);
  const delay = Number(url.searchParams.get("delay") || 0);
  if (delay > 0) await new Promise((r) => setTimeout(r, Math.min(delay, 30000)));
  if (url.searchParams.get("fail") === "1") return json(res, 500, { error: { code: "server-error", message: msg("server-error", lang) } });

  const p = url.pathname;
  const m = req.method;

  if (p === "/api/login" && m === "POST") {
    const { card, pin } = await readJson(req);
    const patron = PATRONS[String(card ?? "").trim()];
    if (!patron || String(pin ?? "") !== patron.pin) {
      return json(res, 401, { error: { code: "bad-pin", message: msg("bad-pin", lang) } });
    }
    const token = randomBytes(12).toString("hex");
    tokens.set(token, patron.card);
    return json(res, 200, { token, name: patron.name[lang], card: patron.card });
  }

  if (p === "/api/catalog" && m === "GET") {
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const type = url.searchParams.get("type") || "";
    const branch = url.searchParams.get("branch") || "";
    const sort = url.searchParams.get("sort") || "title";
    const per = Math.max(1, Math.min(50, Number(url.searchParams.get("per") || 10) || 10));
    let page = Math.max(1, Number(url.searchParams.get("page") || 1) || 1);
    let list = ITEMS.filter((it) => {
      if (type && it.type !== type) return false;
      if (branch && !it.copies.some((c) => c.branch === branch)) return false;
      if (!q) return true;
      const hay = [...Object.values(it.title), ...Object.values(it.author)].join(" ").toLowerCase();
      return hay.includes(q);
    });
    const collator = new Intl.Collator(lang);
    if (sort === "year") list = list.toSorted((a, b) => a.year - b.year || a.id - b.id);
    else if (sort === "-year") list = list.toSorted((a, b) => b.year - a.year || a.id - b.id);
    else list = list.toSorted((a, b) => collator.compare(a.title[lang], b.title[lang]) || a.id - b.id);
    const total = list.length;
    const pages = Math.max(1, Math.ceil(total / per));
    if (page > pages) page = pages;
    const items = list.slice((page - 1) * per, page * per).map((it) => {
      const v = itemView(it, lang);
      v.holds += holds.filter((h) => h.itemId === it.id && h.status !== "expired").length;
      return v;
    });
    return json(res, 200, { total, page, per, items });
  }

  let mm;
  if ((mm = p.match(/^\/api\/items\/(\d+)$/)) && m === "GET") {
    const item = ITEMS.find((i) => i.id === Number(mm[1]));
    if (!item) return json(res, 404, { error: { code: "not-found", message: msg("not-found", lang) } });
    const extra = holds.filter((h) => h.itemId === item.id && h.status !== "expired").length;
    return json(res, 200, itemDetail(item, lang, extra));
  }

  if (p === "/api/branches" && m === "GET") {
    return json(res, 200, BRANCHES.map((b) => ({ id: b.id, name: b.name[lang], timeZone: "Asia/Tokyo" })));
  }

  if (p === "/api/hours" && m === "GET") {
    const branch = url.searchParams.get("branch") || "central";
    if (!WEEKLY_HOURS[branch]) return json(res, 404, { error: { code: "not-found", message: msg("not-found", lang) } });
    // Extension: ?from=YYYY-MM-DD&days=N (defaults: today in Tokyo, 7 days).
    const from = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("from") || "") ? url.searchParams.get("from") : tokyoToday();
    const days = Math.max(1, Math.min(31, Number(url.searchParams.get("days") || 7) || 7));
    const [y, mo, d] = from.split("-").map(Number);
    const out = [];
    for (let i = 0; i < days; i++) {
      const dt = new Date(Date.UTC(y, mo - 1, d + i));
      const date = dt.toISOString().slice(0, 10);
      const h = WEEKLY_HOURS[branch][dt.getUTCDay()];
      out.push(h ? { date, opens: h[0], closes: h[1] } : { date, opens: null, closes: null });
    }
    return json(res, 200, { branch, timeZone: "Asia/Tokyo", days: out });
  }

  if (p === "/api/stream" && m === "GET") {
    const card = authCard(req, url, { allowQuery: true });
    if (!card) return json(res, 401, { error: { code: "unauthorized", message: msg("unauthorized", lang) } });
    const streamLang = url.searchParams.get("lang") ? lang : PATRONS[card].lang;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    res.write(": open\n\n");
    const s = { res, card, lang: streamLang };
    streams.add(s);
    const last = Number(req.headers["last-event-id"] || url.searchParams.get("since") || 0);
    if (last > 0) for (const ev of events) if (ev.seq > last && ev.card === card) writeEvent(s, ev);
    const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 15000);
    req.on("close", () => { clearInterval(ping); streams.delete(s); });
    if (LOG) console.log(`[sse] open card=${card} lang=${streamLang} last=${last}`);
    return;
  }

  if (p.startsWith("/api/me/") || p.startsWith("/api/holds")) {
    const card = authCard(req, url);
    if (!card) return json(res, 401, { error: { code: "unauthorized", message: msg("unauthorized", lang) } });

    if (p === "/api/me/holds" && m === "GET") {
      return json(res, 200, holds.filter((h) => h.card === card).map((h) => holdView(h, lang)));
    }
    if (p === "/api/me/fees" && m === "GET") {
      return json(res, 200, { currency: "JPY", items: FEES[card].map((f) => ({ id: f.id, reason: f.reason[lang], amount: f.amount, date: f.date })) });
    }
    if (p === "/api/holds" && m === "POST") {
      const body = await readJson(req);
      const errors = {};
      const itemId = Number(body.itemId);
      const item = ITEMS.find((i) => i.id === itemId);
      if (!item) errors.itemId = { code: "item-unknown", message: msg("item-unknown", lang) };
      if (!body.branch) errors.branch = { code: "required", message: msg("branch-required", lang) };
      else if (!BRANCHES.some((b) => b.id === body.branch)) errors.branch = { code: "unknown", message: msg("branch-unknown", lang) };
      if (!["email", "sms", "none"].includes(body.notify)) errors.notify = { code: "invalid", message: msg("notify-invalid", lang) };
      const phone = String(body.phone ?? "").replace(/[\s-]/g, "");
      if (body.notify === "sms" && !phone) errors.phone = { code: "required", message: msg("phone-required", lang) };
      else if (phone && !/^\d{10,11}$/.test(phone)) errors.phone = { code: "format", message: msg("phone-format", lang) };
      if (Object.keys(errors).length) return json(res, 422, { errors });
      if (holds.some((h) => h.card === card && h.itemId === itemId && h.status !== "expired")) {
        return json(res, 409, { error: { code: "already-held", message: msg("already-held", lang) } });
      }
      const position = item.baseHolds + holds.filter((h) => h.itemId === itemId && h.status === "waiting").length + 1;
      const hold = { id: nextHoldId++, card, itemId, branch: body.branch, notify: body.notify, phone: phone || null, status: "waiting", position, readyUntil: null, createdAt: Date.now() };
      holds.push(hold);
      return json(res, 201, holdView(hold, lang));
    }
    if ((mm = p.match(/^\/api\/holds\/(\d+)$/)) && m === "DELETE") {
      const i = holds.findIndex((h) => h.id === Number(mm[1]) && h.card === card);
      if (i < 0) return json(res, 404, { error: { code: "not-found", message: msg("not-found", lang) } });
      holds.splice(i, 1);
      res.writeHead(204); res.end();
      return;
    }
  }

  return json(res, 404, { error: { code: "not-found", message: msg("not-found", lang) } });
}

// ------------------------------------------------------------ test hooks ---
function hooks(req, res, url) {
  const p = url.pathname;
  if (p === "/__reset") { reset(); return json(res, 200, { ok: true }); }
  // The open event streams per card (the spec waits for a page's stream before it publishes).
  if (p === "/__streams") return json(res, 200, { open: [...streams].map((s) => s.card) });
  const id = Number(url.searchParams.get("hold"));
  const hold = holds.find((h) => h.id === id);
  if (!hold) return json(res, 404, { error: "no such hold" });
  if (p === "/__ready") {
    const days = Number(url.searchParams.get("days") || 7);
    hold.status = "ready";
    hold.position = 0;
    // Ready until closing time (20:00 Tokyo) `days` days from now.
    const target = new Date(Date.now() + days * 86400_000 + 9 * 3600_000);
    hold.readyUntil = `${target.toISOString().slice(0, 10)}T20:00:00+09:00`;
    return json(res, 200, { seq: publish(hold.card, "hold-ready", hold).seq });
  }
  if (p === "/__expire") {
    hold.status = "expired";
    return json(res, 200, { seq: publish(hold.card, "hold-expired", hold).seq });
  }
  if (p === "/__resend") {
    const last = [...events].reverse().find((e) => e.holdId === id);
    if (!last) return json(res, 404, { error: "no event for that hold" });
    // The same event again. ?sameId=1 repeats its id; otherwise it gets a new one.
    const ev = url.searchParams.get("sameId") === "1" ? last : { ...last, seq: ++seq };
    if (ev !== last) events.push(ev);
    for (const s of streams) if (s.card === ev.card) writeEvent(s, ev);
    return json(res, 200, { seq: ev.seq });
  }
  return json(res, 404, { error: "unknown hook" });
}

// --------------------------------------------------------------- static ----
async function serveStatic(res, pathname) {
  const file = resolve(ROOT, "." + pathname);
  if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (LOG) console.log(req.method, url.pathname + url.search);
    if (url.pathname.startsWith("/__")) return hooks(req, res, url);
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    if (url.pathname === "/favicon.ico") { res.writeHead(204); return res.end(); }
    // WCS_LOCAL=1: the bundles the page names instead of esm.run.
    if (LOCAL && req.method === "GET" && url.pathname.startsWith("/packages/")) {
      const file = resolve(REPO_ROOT, "." + decodeURIComponent(url.pathname));
      if (!file.startsWith(join(REPO_ROOT, "packages") + sep)) { res.writeHead(403); return res.end(); }
      const body = await readFile(file).catch(() => null);
      if (!body) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
      res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      return res.end(body);
    }
    // The SPA: "/" and every extensionless path serve the one page; its head
    // script settles the language and repairs the URL.
    if (req.method === "GET" && extname(url.pathname) === "") {
      res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
      return res.end(await page());
    }
    return await serveStatic(res, decodeURIComponent(url.pathname));
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 400, { error: { code: "bad-request", message: String(err.message) } });
  }
});

server.listen(PORT, () => {
  console.log(`city-library on http://localhost:${PORT}/  (pid ${process.pid})`);
  if (LOCAL) console.log("WCS_LOCAL=1: esm.run one-liners rewritten to the local packages/*/dist");
});
