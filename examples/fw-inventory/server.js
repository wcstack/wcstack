/**
 * Server for the fw-inventory seam app: the built app (dist/, `npm run build`) and its API.
 * Plain Node, no dependencies. Self-contained, as websocket-chat's: the app is a Vite build.
 *
 *   node examples/fw-inventory/server.js        http://localhost:3000 (PORT=… to change)
 *
 * Switches (environment):
 *   PORT         default 3000
 *   DELAY=<ms>   delay every API answer (not the stream)
 *   TICK=0       no random stock changes on the stream (the e2e spec pushes its own)
 *   STATIC       the directory to serve (default ./dist)
 *
 * API (in memory; a restart resets it):
 *   GET  /api/products?q=&page=&size=&sort=name|stock|-stock   → { items, total }
 *   GET  /api/products/:id           → the product with its photos | 404
 *   POST /api/products/:id/photos    multipart, the file in `file` → 201 { id, url } | 404 | 413 (over 1 MB)
 *   GET  /photos/:id                 the file
 *   POST /api/stock/import           { rows: [{ sku, stock }] } → 200 { updated } | 422 { errors: [{ row, message }] }
 *   GET  /api/stock/stream           SSE: `event: stock`, `data: { id, stock }`; resumes from Last-Event-ID
 * Test hooks (used by e2e/tests/fw-inventory.spec.ts):
 *   POST /api/test/reset             the products, photos and stream as at start
 *   POST /api/test/fail-next?kind=products|upload|import   the next such request answers 500
 *   POST /api/test/burst?n=5         n stock events in one write (products 1…n, stock + 1)
 *   POST /api/test/push?id=&stock=   one stock event (the same value twice, if sent twice)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DEFAULT_DELAY = Number(process.env.DELAY || 0);
const TICK = process.env.TICK !== "0";
const STATIC_DIR = path.resolve(__dirname, process.env.STATIC || "dist");
const BOOT = Date.now();

// ---- data -----------------------------------------------------------------
const NAMES = ["Anchor", "Bolt", "Cable", "Drill", "Epoxy", "Flange", "Gasket", "Hinge", "Insulator", "Joint",
  "Knob", "Latch", "Magnet", "Nozzle", "O-ring", "Pulley", "Quill", "Rivet", "Spring", "Toggle"];
let products = [];
let photoSeq = 0;
const photoBlobs = new Map(); // id -> { type, buf }
const failNext = new Set();
function seed() {
  products = [];
  for (let i = 1; i <= 40; i++) {
    const base = NAMES[(i - 1) % NAMES.length];
    products.push({
      id: i,
      name: `${base} ${i > 20 ? "XL" : "S"}`,
      sku: `SKU-${String(i).padStart(4, "0")}`,
      stock: (i * 7) % 50,
      price: Math.round((i * 3.7 + 1) * 100) / 100,
      photos: [],
    });
  }
  photoSeq = 0;
  photoBlobs.clear();
  failNext.clear();
}
seed();

// ---- the stock stream -----------------------------------------------------
let eventSeq = 0;
const eventLog = []; // { seq, id, stock }
const clients = new Set();
function event(ev) {
  return `event: stock\nid: ${BOOT}-${ev.seq}\ndata: ${JSON.stringify({ id: ev.id, stock: ev.stock })}\n\n`;
}
// Several events go out in one write when there are several: a burst, or the replay after a reconnect.
function pushStock(changes) {
  const events = changes.map(({ id, stock }) => ({ seq: ++eventSeq, id, stock }));
  eventLog.push(...events);
  while (eventLog.length > 500) eventLog.shift();
  const chunk = events.map(event).join("");
  for (const res of clients) res.write(chunk);
  return events;
}
let lastEv = null;
let tickCount = 0;
function scheduleTick() {
  setTimeout(() => {
    tickCount++;
    if (lastEv && tickCount % 3 === 0) {
      // the same value again, on purpose
      [lastEv] = pushStock([{ id: lastEv.id, stock: lastEv.stock }]);
    } else {
      const p = products[Math.floor(Math.random() * products.length)];
      p.stock = Math.max(0, p.stock + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 3)));
      [lastEv] = pushStock([{ id: p.id, stock: p.stock }]);
    }
    scheduleTick();
  }, 1000 + Math.floor(Math.random() * 1000)).unref();
}
if (TICK) scheduleTick();

// ---- helpers --------------------------------------------------------------
function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on("data", (c) => {
      size += c.length;
      if (limit && size > limit) { tooBig = true; return; }
      chunks.push(c);
    });
    req.on("end", () => resolve({ buf: Buffer.concat(chunks), size, tooBig }));
    req.on("error", reject);
    req.on("aborted", () => reject(new Error("aborted")));
  });
}
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!m) return [];
  const boundary = Buffer.from("--" + (m[1] || m[2]));
  const parts = [];
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length;
    if (buf.slice(start, start + 2).toString() === "--") break;
    const headerEnd = buf.indexOf("\r\n\r\n", start);
    if (headerEnd === -1) break;
    const headers = buf.slice(start + 2, headerEnd).toString();
    const next = buf.indexOf(boundary, headerEnd);
    const body = buf.slice(headerEnd + 4, next - 2);
    const name = /name="([^"]*)"/i.exec(headers)?.[1];
    const filename = /filename="([^"]*)"/i.exec(headers)?.[1];
    const type = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1] || "application/octet-stream";
    parts.push({ name, filename, type, body });
    pos = next;
  }
  return parts;
}
function publicProduct(p) {
  const { photos, ...rest } = p;
  return rest;
}
function failing(kind) {
  return failNext.delete(kind);
}
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".map": "application/json",
};
function serveStatic(req, res, pathname) {
  const file = path.join(STATIC_DIR, decodeURIComponent(pathname));
  if (!file.startsWith(STATIC_DIR)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
    return;
  }
  if (path.extname(pathname)) { res.writeHead(404); res.end("not found"); return; }
  // the SPA fallback: /warehouse* → warehouse.html, any other path → index.html (react-router)
  const html = path.join(STATIC_DIR, pathname.startsWith("/warehouse") ? "warehouse.html" : "index.html");
  if (!fs.existsSync(html)) { res.writeHead(404); res.end("build first: npm run build"); return; }
  res.writeHead(200, { "Content-Type": MIME[".html"] });
  fs.createReadStream(html).pipe(res);
}

// ---- routes ---------------------------------------------------------------
async function handleApi(req, res, url) {
  const p = url.pathname;

  if (req.method === "GET" && p === "/api/products") {
    if (failing("products")) return json(res, 500, { error: "simulated failure" });
    const q = (url.searchParams.get("q") || "").toLowerCase();
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const size = Math.max(1, Number(url.searchParams.get("size") || 10));
    const sort = url.searchParams.get("sort") || "name";
    let items = products.filter((x) => !q || x.name.toLowerCase().includes(q) || x.sku.toLowerCase().includes(q));
    const cmp = {
      name: (a, b) => a.name.localeCompare(b.name) || a.id - b.id,
      stock: (a, b) => a.stock - b.stock || a.id - b.id,
      "-stock": (a, b) => b.stock - a.stock || a.id - b.id,
    }[sort] || ((a, b) => a.id - b.id);
    items = items.slice().sort(cmp);
    const total = items.length;
    items = items.slice((page - 1) * size, page * size).map(publicProduct);
    return json(res, 200, { items, total });
  }

  let m;
  if (req.method === "GET" && (m = /^\/api\/products\/([^/]+)$/.exec(p))) {
    const prod = products.find((x) => String(x.id) === m[1]);
    if (!prod) return json(res, 404, { error: "not found" });
    return json(res, 200, { ...publicProduct(prod), photos: prod.photos });
  }

  if (req.method === "POST" && (m = /^\/api\/products\/([^/]+)\/photos$/.exec(p))) {
    const prod = products.find((x) => String(x.id) === m[1]);
    const LIMIT = 1024 * 1024;
    let body;
    try { body = await readBody(req, LIMIT + 64 * 1024); } catch { return; }
    if (!prod) return json(res, 404, { error: "not found" });
    if (failing("upload")) return json(res, 500, { error: "simulated failure" });
    const parts = parseMultipart(body.buf, req.headers["content-type"]);
    const file = parts.find((x) => x.name === "file");
    if (body.tooBig || (file && file.body.length > LIMIT)) return json(res, 413, { error: "file over 1 MB" });
    if (!file) return json(res, 400, { error: "field 'file' missing" });
    const id = ++photoSeq;
    photoBlobs.set(id, { type: file.type, buf: file.body });
    const photo = { id, url: `/photos/${id}` };
    prod.photos.push(photo);
    return json(res, 201, photo);
  }

  if (req.method === "POST" && p === "/api/stock/import") {
    let body;
    try { body = await readBody(req, 5 * 1024 * 1024); } catch { return; }
    if (failing("import")) return json(res, 500, { error: "simulated failure" });
    let data;
    try { data = JSON.parse(body.buf.toString("utf8") || "null"); } catch { return json(res, 400, { error: "invalid JSON" }); }
    if (!data || !Array.isArray(data.rows)) return json(res, 422, { errors: [{ row: 0, message: "rows must be an array" }] });
    const errors = [];
    data.rows.forEach((r, i) => {
      if (!r || typeof r.sku !== "string") errors.push({ row: i + 1, message: "sku missing" });
      else if (!products.some((x) => x.sku === r.sku)) errors.push({ row: i + 1, message: `unknown sku ${r.sku}` });
      if (!r || !Number.isInteger(r.stock) || r.stock < 0) errors.push({ row: i + 1, message: "stock must be a non-negative integer" });
    });
    if (errors.length) return json(res, 422, { errors });
    const changes = [];
    for (const r of data.rows) {
      const prod = products.find((x) => x.sku === r.sku);
      if (prod.stock !== r.stock) { prod.stock = r.stock; changes.push({ id: prod.id, stock: prod.stock }); }
    }
    if (changes.length) pushStock(changes);
    return json(res, 200, { updated: data.rows.length });
  }

  if (req.method === "GET" && p === "/api/stock/stream") {
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.write(`retry: 1000\n\n`);
    const last = req.headers["last-event-id"];
    if (last) {
      const [boot, seq] = String(last).split("-").map(Number);
      // resume: replay what this client missed, in one write (only from this server's own run)
      if (boot === BOOT) res.write(eventLog.filter((ev) => ev.seq > seq).map(event).join(""));
    }
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (req.method === "POST" && p === "/api/test/reset") {
    seed();
    return json(res, 200, { ok: true });
  }
  if (req.method === "POST" && p === "/api/test/fail-next") {
    failNext.add(url.searchParams.get("kind") || "products");
    return json(res, 200, { ok: true });
  }
  if (req.method === "POST" && p === "/api/test/burst") {
    const n = Number(url.searchParams.get("n") || 5);
    const changes = products.slice(0, n).map((prod) => ({ id: prod.id, stock: ++prod.stock }));
    return json(res, 200, { pushed: pushStock(changes).map(({ id, stock }) => ({ id, stock })) });
  }
  if (req.method === "POST" && p === "/api/test/push") {
    const id = Number(url.searchParams.get("id"));
    const stock = Number(url.searchParams.get("stock"));
    const prod = products.find((x) => x.id === id);
    if (prod) prod.stock = stock;
    pushStock([{ id, stock }]);
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: "not found" });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/photos/")) {
    const ph = photoBlobs.get(Number(url.pathname.slice(8)));
    if (!ph) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": ph.type });
    res.end(ph.buf);
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    if (DEFAULT_DELAY > 0 && url.pathname !== "/api/stock/stream") await new Promise((r) => setTimeout(r, DEFAULT_DELAY));
    try { await handleApi(req, res, url); } catch (e) { if (!res.headersSent) json(res, 500, { error: String(e) }); }
    return;
  }
  serveStatic(req, res, url.pathname);
});
server.listen(PORT, () => console.log(`fw-inventory server running at http://localhost:${PORT}`));
