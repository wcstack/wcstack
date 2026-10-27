/**
 * Demo server for family-ledger — a household budget (家計簿) shared by two people
 * (state + router + fetch + storage + sse + network + clipboard + upload).
 *
 *   node examples/family-ledger/server.js                http://localhost:3000 (PORT=… to change)
 *   WCS_LOCAL=1 node examples/family-ledger/server.js    the repository's packages/*\/dist instead of esm.run
 *
 * Node built-ins only (and examples/shared/server.js): nothing to install to run it.
 *
 * Users: mom@example.com (母) and dad@example.com (父), password "pass".
 *
 * API (in memory; entries are seeded in 2026-09 and 2026-10, with budgets for both months):
 *   POST   /api/login { email, password }          → 200 { token, expiresAt, user: { id, name } } | 401
 *   Every other /api/* needs Authorization: Bearer <token> (the stream: ?token=) → 401 { error: "expired" | "unauthorized" }
 *   GET    /api/categories                         → [{ id, name, color }]
 *   GET    /api/entries?month=YYYY-MM              → { month, entries: [{ id, date, amount, categoryId, memo, receiptUrl,
 *                                                      createdBy: { id, name }, version, updatedAt }] }  (unsorted)
 *   GET    /api/entries/:id                        → entry | 404
 *   POST   /api/entries { date, amount, categoryId, memo, clientId } → 201 entry | 422 { errors: { field: message } };
 *                                                    the same clientId again returns the first answer
 *   PUT    /api/entries/:id { date, amount, categoryId, memo, version } → 200 entry
 *                                                    | 409 { error: "conflict", current: entry } | 404 | 422
 *   DELETE /api/entries/:id                        → 204 | 404
 *   POST   /api/entries/:id/receipt                multipart/form-data, the file in the field "file" (JPEG / PNG / WebP,
 *                                                    5 MB at most) → 200 { receiptUrl } | 413 | 415; GET the receiptUrl serves it
 *   GET    /api/budgets?month=YYYY-MM              → { month, budgets: { [categoryId]: amount } }
 *   PUT    /api/budgets?month=YYYY-MM { budgets }  → 200 { month, budgets } | 422 { errors: { [categoryId]: message } }
 *   GET    /api/events?token=                      text/event-stream: entry-created / entry-updated / entry-deleted
 *                                                    (the entry, or { id, month }) and budget-updated ({ month, budgets }),
 *                                                    each with id: <seq>; honours Last-Event-ID; retry: 3000
 *   Every /api/* request may add ?delay=<ms> (answer later) or ?fail=1 (answer 500). A page URL's delay / fail are
 *   passed on to every API call the page makes, and the month's Retry drops fail.
 *
 * Test hooks (POST; used by e2e/tests/family-ledger.spec.ts; never 502):
 *   /__reset                  fresh data (the seeded entries, budgets, receipts; every session ends; streams closed)
 *   /__token-ttl?ms=          the lifetime of tokens issued from now on (default 30 minutes)
 *   /__expire                 every token expires now
 *   /__drop                   close every event stream (the browser reconnects by itself)
 *   /__restart?ms=            close every stream and answer 502 to everything for that long (the browser gives the
 *                             stream up after the 502; <wcs-sse auto-reconnect> opens it again)
 *   /__receipt-max?bytes=     the largest receipt the server takes (default 5 MB) — makes it refuse a file the page let through
 * GET /__log                  the server's view: the open streams, every /api/events request with its status, every
 *                             receipt upload with how its token came (header / query / none) and the answer
 */
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import zlib from "node:zlib";
import { createDemoServer, delay } from "../shared/server.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC = join(__dirname, "public");
const REPO_ROOT = resolve(__dirname, "..", "..");
const PORT = Number(process.env.PORT || 3000);
const LOCAL = process.env.WCS_LOCAL === "1";
const MAX_RECEIPT = 5 * 1024 * 1024;
const MAX_BODY = 12 * 1024 * 1024;

// ---------------------------------------------------------------- the page
// WCS_LOCAL=1: the esm.run one-liners become the repository's bundles (served below from packages/).
async function page() {
  const html = await readFile(join(PUBLIC, "index.html"), "utf8");
  return LOCAL ? html.replace(/https:\/\/esm\.run\/@wcstack\/([\w-]+)\/auto/g, (_m, pkg) => `/packages/${pkg}/dist/auto.min.js`) : html;
}

// ---------------------------------------------------------------- data
const USERS = {
  "mom@example.com": { id: 1, name: "母", password: "pass" },
  "dad@example.com": { id: 2, name: "父", password: "pass" },
};
const CATEGORIES = [
  { id: "food", name: "食費", color: "#e8590c" },
  { id: "daily", name: "日用品", color: "#1c7ed6" },
  { id: "transport", name: "交通", color: "#2f9e44" },
  { id: "fun", name: "娯楽", color: "#ae3ec9" },
  { id: "other", name: "その他", color: "#868e96" },
];
const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

// a tiny striped PNG for the seeded receipts
function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makePng(w, h, [r, g, b]) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const stripe = (x + y) % 16 < 8 ? 0 : 30;
      raw[o] = Math.min(255, r + stripe); raw[o + 1] = Math.min(255, g + stripe); raw[o + 2] = Math.min(255, b + stripe);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

let state;
function seed() {
  const S = {
    nextId: 1, seq: 0, events: [], entries: new Map(), budgets: new Map(), receipts: new Map(),
    sessions: new Map(), clients: new Map(), streams: new Set(), ttl: 30 * 60 * 1000, downUntil: 0,
    maxReceipt: MAX_RECEIPT, log: { streams: [], uploads: [] },
  };
  const add = (date, amount, categoryId, memo, user, receipt) => {
    const id = S.nextId++;
    const e = { id, date, amount, categoryId, memo, receiptUrl: null, createdBy: { id: user, name: user === 1 ? "母" : "父" }, version: 1, updatedAt: new Date().toISOString() };
    if (receipt) { S.receipts.set(`r${id}.png`, { type: "image/png", data: makePng(96, 64, receipt) }); e.receiptUrl = `/receipts/r${id}.png`; }
    S.entries.set(id, e);
  };
  add("2026-09-03", 2480, "food", "スーパー", 1);
  add("2026-09-08", 980, "daily", "洗剤", 2);
  add("2026-09-12", 5400, "transport", "定期券", 2);
  add("2026-09-15", 3200, "fun", "映画", 1);
  add("2026-09-21", 7650, "food", "外食", 2, [200, 120, 60]);
  add("2026-09-28", 1500, "other", "郵便・雑費", 1);
  add("2026-10-01", 3120, "food", "まとめ買い", 1);
  add("2026-10-05", 1280, "daily", "ティッシュ", 2);
  add("2026-10-09", 4600, "transport", "新幹線", 2);
  add("2026-10-12", 2200, "fun", "ボウリング", 1);
  add("2026-10-18", 12345, "food", "焼肉", 2, [60, 140, 200]);
  add("2026-10-22", 860, "other", "薬", 1);
  add("2026-10-26", 1980, "food", "夕食の買い物", 1);
  S.budgets.set("2026-09", { food: 30000, daily: 5000, transport: 8000, fun: 5000, other: 3000 });
  S.budgets.set("2026-10", { food: 30000, daily: 5000, transport: 8000, fun: 5000, other: 3000 });
  return S;
}
state = seed();

function publish(event, data) {
  const id = ++state.seq;
  const rec = { id, event, data };
  state.events.push(rec);
  if (state.events.length > 500) state.events.shift();
  for (const res of state.streams) writeEvent(res, rec);
}
function writeEvent(res, rec) {
  res.write(`id: ${rec.id}\nevent: ${rec.event}\ndata: ${JSON.stringify(rec.data)}\n\n`);
}
function dropStreams() {
  for (const res of state.streams) res.destroy();
  state.streams.clear();
}
const monthOf = (date) => date.slice(0, 7);

// ---------------------------------------------------------------- helpers
function send(res, status, body, headers = {}) {
  const isJson = body !== undefined && typeof body !== "string" && !Buffer.isBuffer(body);
  const payload = body === undefined ? "" : isJson ? JSON.stringify(body) : body;
  res.writeHead(status, { ...(isJson ? { "Content-Type": "application/json; charset=utf-8" } : {}), "Cache-Control": "no-store", ...headers });
  res.end(payload);
  return true;
}
function readBody(req, limit = MAX_BODY) {
  return new Promise((done) => {
    const chunks = []; let size = 0; let over = false;
    req.on("data", (c) => { size += c.length; if (size > limit) over = true; else chunks.push(c); });
    req.on("end", () => done({ buf: Buffer.concat(chunks), over }));
    req.on("error", () => done({ buf: Buffer.alloc(0), over }));
  });
}
async function readJson(req) {
  const { buf } = await readBody(req, 1024 * 1024);
  try { return JSON.parse(buf.toString("utf8") || "{}"); } catch { return null; }
}
function tokenOf(req, url) {
  const h = req.headers.authorization || "";
  if (h.startsWith("Bearer ")) return { token: h.slice(7), via: "header" };
  const q = url.searchParams.get("token");
  return q ? { token: q, via: "query" } : { token: null, via: "none" };
}
function authUser(token) {
  if (!token) return { status: 401, error: "unauthorized" };
  const s = state.sessions.get(token);
  if (!s) return { status: 401, error: "unauthorized" };
  if (s.expiresAt <= Date.now()) return { status: 401, error: "expired" };
  return { user: s.user };
}
function validDate(d) {
  if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const [y, m, dd] = d.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, dd));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === dd && y >= 2000 && y <= 2099;
}
function validate(b) {
  const errors = {};
  if (b.date === undefined || b.date === null || b.date === "") errors.date = "日付を入力してください";
  else if (!validDate(b.date)) errors.date = "日付が正しくありません（実在する日付を YYYY-MM-DD で）";
  if (b.amount === undefined || b.amount === null || b.amount === "") errors.amount = "金額を入力してください";
  else if (typeof b.amount !== "number" || !Number.isInteger(b.amount)) errors.amount = "金額は整数で入力してください";
  else if (b.amount <= 0) errors.amount = "金額は1円以上で入力してください";
  else if (b.amount > 100000000) errors.amount = "金額が大きすぎます";
  if (!b.categoryId) errors.categoryId = "カテゴリを選んでください";
  else if (!CATEGORY_IDS.has(b.categoryId)) errors.categoryId = "不明なカテゴリです";
  if (b.memo !== undefined && b.memo !== null && typeof b.memo !== "string") errors.memo = "メモは文字列で入力してください";
  else if ((b.memo || "").length > 100) errors.memo = "メモは100文字以内で入力してください";
  return errors;
}
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!m) return null;
  const boundary = Buffer.from("--" + (m[1] || m[2]));
  const parts = [];
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    const next = buf.indexOf(boundary, pos + boundary.length);
    if (next === -1) break;
    let part = buf.subarray(pos + boundary.length, next);
    if (part.subarray(0, 2).toString() === "\r\n") part = part.subarray(2);
    const headEnd = part.indexOf("\r\n\r\n");
    if (headEnd !== -1) {
      const head = part.subarray(0, headEnd).toString("utf8");
      let data = part.subarray(headEnd + 4);
      if (data.subarray(data.length - 2).toString() === "\r\n") data = data.subarray(0, data.length - 2);
      const name = /name="([^"]*)"/i.exec(head)?.[1];
      const type = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim();
      parts.push({ name, type, data });
    }
    pos = next;
  }
  return parts;
}

// ---------------------------------------------------------------- the API
async function api(req, res, url) {
  const path = url.pathname;
  const method = req.method;

  const ms = Math.min(Number(url.searchParams.get("delay")) || 0, 60000);
  if (ms > 0) await delay(ms);
  if (url.searchParams.get("fail") === "1") { req.resume(); return send(res, 500, { error: "failed on purpose" }); }

  if (path === "/api/login" && method === "POST") {
    const b = await readJson(req);
    const u = b && USERS[String(b.email || "").toLowerCase()];
    if (!u || u.password !== b.password) return send(res, 401, { error: "invalid credentials" });
    const token = randomUUID();
    const expiresAt = Date.now() + state.ttl;
    const user = { id: u.id, name: u.name };
    state.sessions.set(token, { user, expiresAt });
    return send(res, 200, { token, expiresAt: new Date(expiresAt).toISOString(), user });
  }

  const { token, via } = tokenOf(req, url);
  const auth = authUser(token);
  const receipt = /^\/api\/entries\/(\d+)\/receipt$/.exec(path);
  if (path === "/api/events") state.log.streams.push({ at: Date.now(), status: auth.user ? 200 : auth.status, lastEventId: req.headers["last-event-id"] ?? null });
  if (!auth.user) {
    if (receipt) state.log.uploads.push({ at: Date.now(), entryId: Number(receipt[1]), auth: via, status: auth.status });
    req.resume();
    return send(res, auth.status, { error: auth.error });
  }
  const user = auth.user;

  if (path === "/api/events" && method === "GET") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.write("retry: 3000\n\n");
    const last = Number(req.headers["last-event-id"]);
    if (Number.isFinite(last) && last > 0) for (const rec of state.events) if (rec.id > last) writeEvent(res, rec);
    const streams = state.streams;          // the set of this data: a /__reset replaces it
    streams.add(res);
    const hb = setInterval(() => res.write(": hb\n\n"), 15000);
    req.on("close", () => { clearInterval(hb); streams.delete(res); });
    return true;
  }

  if (path === "/api/categories" && method === "GET") return send(res, 200, CATEGORIES);

  if (path === "/api/entries" && method === "GET") {
    const month = url.searchParams.get("month");
    if (!/^\d{4}-\d{2}$/.test(month || "")) return send(res, 400, { error: "month=YYYY-MM required" });
    return send(res, 200, { month, entries: [...state.entries.values()].filter((e) => monthOf(e.date) === month) });
  }
  if (path === "/api/entries" && method === "POST") {
    const b = await readJson(req);
    if (!b) return send(res, 400, { error: "bad json" });
    if (b.clientId && state.clients.has(b.clientId)) { const f = state.clients.get(b.clientId); return send(res, f.status, f.body); }
    const errors = validate(b);
    if (Object.keys(errors).length) return send(res, 422, { errors });
    const e = { id: state.nextId++, date: b.date, amount: b.amount, categoryId: b.categoryId, memo: b.memo || "", receiptUrl: null, createdBy: user, version: 1, updatedAt: new Date().toISOString() };
    state.entries.set(e.id, e);
    if (b.clientId) state.clients.set(b.clientId, { status: 201, body: e });
    publish("entry-created", e);
    return send(res, 201, e);
  }
  if (receipt && method === "POST") {
    const e = state.entries.get(Number(receipt[1]));
    const { buf, over } = await readBody(req);
    const answer = (status, body) => {
      state.log.uploads.push({ at: Date.now(), entryId: Number(receipt[1]), auth: via, status });
      return send(res, status, body);
    };
    if (!e) return answer(404, { error: "not found" });
    if (over) return answer(413, { error: "領収書は5MB以下にしてください" });
    const parts = parseMultipart(buf, req.headers["content-type"]);
    const file = parts?.find((p) => p.name === "file");
    if (!file) return answer(400, { error: "file required" });
    if (file.data.length > state.maxReceipt) return answer(413, { error: "領収書は5MB以下にしてください" });
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[file.type];
    if (!ext) return answer(415, { error: "JPEG / PNG / WebP の画像のみ使えます" });
    const name = `r${e.id}-${Date.now()}.${ext}`;
    state.receipts.set(name, { type: file.type, data: file.data });
    e.receiptUrl = `/receipts/${name}`;
    e.updatedAt = new Date().toISOString();
    publish("entry-updated", e);
    return answer(200, { receiptUrl: e.receiptUrl });
  }
  const one = /^\/api\/entries\/(\d+)$/.exec(path);
  if (one) {
    const id = Number(one[1]);
    const e = state.entries.get(id);
    if (method === "GET") return e ? send(res, 200, e) : send(res, 404, { error: "not found" });
    if (method === "DELETE") {
      if (!e) return send(res, 404, { error: "not found" });
      state.entries.delete(id);
      publish("entry-deleted", { id, month: monthOf(e.date) });
      return send(res, 204);
    }
    if (method === "PUT") {
      const b = await readJson(req);
      if (!e) return send(res, 404, { error: "not found" });
      if (!b) return send(res, 400, { error: "bad json" });
      const errors = validate(b);
      if (Object.keys(errors).length) return send(res, 422, { errors });
      if (b.version !== e.version) return send(res, 409, { error: "conflict", current: e });
      Object.assign(e, { date: b.date, amount: b.amount, categoryId: b.categoryId, memo: b.memo || "", version: e.version + 1, updatedAt: new Date().toISOString() });
      publish("entry-updated", e);
      return send(res, 200, e);
    }
  }
  if (path === "/api/budgets") {
    const month = url.searchParams.get("month");
    if (!/^\d{4}-\d{2}$/.test(month || "")) return send(res, 400, { error: "month=YYYY-MM required" });
    if (method === "GET") return send(res, 200, { month, budgets: state.budgets.get(month) || {} });
    if (method === "PUT") {
      const b = await readJson(req);
      const budgets = {};
      const errors = {};
      for (const [k, v] of Object.entries(b?.budgets || {})) {
        if (!CATEGORY_IDS.has(k)) continue;
        if (typeof v !== "number" || !Number.isInteger(v) || v < 0) errors[k] = "0以上の整数で入力してください";
        else budgets[k] = v;
      }
      if (Object.keys(errors).length) return send(res, 422, { errors });
      state.budgets.set(month, budgets);
      publish("budget-updated", { month, budgets });
      return send(res, 200, { month, budgets });
    }
  }
  return send(res, 404, { error: "not found" });
}

// ---------------------------------------------------------------- test hooks
function testHook(pathname, q) {
  const ms = Number(q("ms") || 0);
  switch (pathname) {
    case "/__reset": { const ttl = state.ttl; dropStreams(); state = seed(); state.ttl = ttl; return { ok: true }; }
    case "/__token-ttl": state.ttl = ms; return { ttl: ms };
    case "/__expire": for (const s of state.sessions.values()) s.expiresAt = 0; return { ok: true };
    case "/__drop": dropStreams(); return { ok: true };
    case "/__restart": state.downUntil = Date.now() + ms; dropStreams(); return { downMs: ms };
    case "/__receipt-max": state.maxReceipt = Number(q("bytes") ?? MAX_RECEIPT); return { maxReceipt: state.maxReceipt };
    default: return null;
  }
}

// ---------------------------------------------------------------- routes
createDemoServer({
  port: PORT,
  root: PUBLIC,
  api: async (req, res, url) => {
    const { pathname } = url;

    // ---- test hooks (never 502) ----
    if (pathname === "/__log" && req.method === "GET") {
      return send(res, 200, { now: Date.now(), openStreams: state.streams.size, ...state.log });
    }
    if (pathname.startsWith("/__")) {
      if (req.method !== "POST") return send(res, 405, "POST only");
      const out = testHook(pathname, (k) => url.searchParams.get(k));
      return out ? send(res, 200, out) : send(res, 404, "no such hook");
    }

    // ---- WCS_LOCAL=1: the bundles the page names instead of esm.run (the CDN does not restart with the server) ----
    if (LOCAL && req.method === "GET" && pathname.startsWith("/packages/")) {
      const file = resolve(REPO_ROOT, "." + pathname);
      if (!file.startsWith(join(REPO_ROOT, "packages"))) return send(res, 403, "Forbidden");
      const body = await readFile(file).catch(() => null);
      if (!body) return send(res, 404, "Not found");
      return send(res, 200, body, { "Content-Type": file.endsWith(".map") ? "application/json" : "text/javascript; charset=utf-8" });
    }

    if (Date.now() < state.downUntil) {
      if (pathname === "/api/events") state.log.streams.push({ at: Date.now(), status: 502, lastEventId: req.headers["last-event-id"] ?? null });
      req.resume();
      return send(res, 502, "Bad Gateway");
    }

    if (pathname.startsWith("/api/")) return api(req, res, url);
    if (pathname.startsWith("/receipts/")) {
      const r = state.receipts.get(pathname.slice("/receipts/".length));
      return r ? send(res, 200, r.data, { "Content-Type": r.type }) : send(res, 404, "not found");
    }
    // Every other extensionless GET is the app (history fallback).
    if (req.method === "GET" && extname(pathname) === "") return send(res, 200, await page(), { "Content-Type": "text/html; charset=utf-8" });
    return false;   // state.js, lib.js, app.css: the shared static files from public/
  },
  notes: [
    ...(LOCAL ? ["WCS_LOCAL=1: esm.run one-liners rewritten to the local packages/*/dist"] : []),
    "Users: mom@example.com / dad@example.com, password pass",
  ],
});
