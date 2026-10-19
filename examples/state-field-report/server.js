/**
 * Demo server for the field report (state + router + camera + geolocation + speech + fetch + upload + storage +
 * network + notification + permission + wakelock + timer).
 *
 *   node examples/state-field-report/server.js           http://localhost:3000 (PORT=… to change)
 *   WCS_LOCAL=1 node examples/state-field-report/server.js   the repository's packages/*\/dist instead of esm.run
 *   node examples/state-field-report/server.js --prod    the production form: SRI=1 + CSP=1 + PP=1
 *
 * Switches (environment):
 *   SRI=1        pinned jsDelivr files with integrity=, read from the GitHub Release's sri.json of WCS_VERSION
 *                (default: the version in packages/state/package.json, else npm latest). No digest → no page.
 *                Ignored with WCS_LOCAL=1 (the scripts are the repository's).
 *   CSP=1        a Content-Security-Policy without 'unsafe-inline' (the state is a file; nothing inline)
 *   PP=1         Permissions-Policy: camera, microphone and geolocation for this origin only
 *   DELAY=<ms>   delay every API answer (also ?delay=<ms>)
 *   MAX_UPLOAD   the largest accepted clip in bytes (default 2 MB)
 *
 * API (in memory; three reports are seeded):
 *   GET  /api/reports                → [{ id, title, createdAt, mediaCount }] newest first
 *   GET  /api/reports/:id            → { id, title, note, position, address, createdAt, media: [{ id, name, type, size, url }] } | 404
 *   POST /api/reports                { title, note, position, address } → 201 | 422 { errors: { title: "required" } } | 500 with ?fail=1
 *   POST /api/reports/:id/media      multipart, the file in `file` → 201 | 404 | 413 | 415 (not video/audio/image) | 500 with ?fail=1;
 *                                    ?slow=1 reads the body slowly
 *   GET  /media/:id                  the file
 *   GET  /embed[?allow=1]            a page on the other loopback name (localhost ⇄ 127.0.0.1) framing /new,
 *                                    without or with allow="camera; microphone; geolocation"
 * Test hooks (used by e2e/tests/state-field-report.spec.ts):
 *   POST /api/test/reset             the three seeded reports again, MAX_UPLOAD back to its default
 *   POST /api/test/max-upload?bytes= set MAX_UPLOAD
 *   POST /api/test/fail-next?kind=create|upload   the next such request answers 500
 *   POST /api/test/drop-uploads      destroy the upload connections in flight (a dropped network)
 */
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { createDemoServer, jsonResponse, delay } from "../shared/server.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const PORT = Number(process.env.PORT || 3000);
if (process.argv.includes("--prod")) { process.env.SRI ??= "1"; process.env.CSP ??= "1"; process.env.PP ??= "1"; }
const LOCAL = process.env.WCS_LOCAL === "1";
const SRI = process.env.SRI === "1" && !LOCAL;
const CSP = process.env.CSP === "1";
const PP = process.env.PP === "1";
const ENV_DELAY = Number(process.env.DELAY || 0);
const DEFAULT_MAX_UPLOAD = Number(process.env.MAX_UPLOAD || 2 * 1024 * 1024);

// ---------------------------------------------------------------- the page's scripts
// WCS_LOCAL=1: the esm.run one-liners become the repository's bundles (served below from packages/).
function rewriteLocal(html) {
  return html.replace(/https:\/\/esm\.run\/@wcstack\/([\w-]+)\/auto/g, (_m, pkg) => `/packages/${pkg}/dist/auto.min.js`);
}
// SRI=1: version-pinned jsDelivr files, with the digests from that release's sri.json (never from the CDN).
let sriPromise = null;
async function pinVersion() {
  if (process.env.WCS_VERSION) return process.env.WCS_VERSION;
  const pkg = await readFile(join(REPO_ROOT, "packages", "state", "package.json"), "utf8").catch(() => null);
  if (pkg) return JSON.parse(pkg).version;
  const res = await fetch("https://registry.npmjs.org/@wcstack/state/latest");
  return (await res.json()).version;
}
function loadSri() {
  sriPromise ??= (async () => {
    const version = await pinVersion();
    const res = await fetch(`https://github.com/wcstack/wcstack/releases/download/v${version}/sri.json`);
    if (!res.ok) throw new Error(`no sri.json for v${version} (${res.status})`);
    const sri = await res.json();
    if (sri.version !== version) throw new Error(`sri.json is for ${sri.version}, not ${version}`);
    return sri;
  })();
  return sriPromise;
}
async function rewritePinned(html) {
  const sri = await loadSri();
  const tags = [...html.matchAll(/<script type="module" src="https:\/\/esm\.run\/(@wcstack\/[\w-]+)\/auto"><\/script>/g)];
  for (const [tag, pkg] of tags) {
    const entry = sri.packages[pkg];
    if (!entry) throw new Error(`no SRI digest for ${pkg}@${sri.version}`);
    html = html.replace(tag, `<script type="module" src="${entry.url}" integrity="${entry.integrity}"></script>`);
  }
  return html;
}
async function page() {
  const html = await readFile(join(__dirname, "index.html"), "utf8");
  if (LOCAL) return rewriteLocal(html);
  return SRI ? rewritePinned(html) : html;
}

// ---------------------------------------------------------------- headers
const otherHost = (host) => (host.startsWith("127.0.0.1") ? `localhost:${PORT}` : `127.0.0.1:${PORT}`);
function pageHeaders(res) {
  if (CSP) {
    const scripts = LOCAL ? "'self'" : SRI ? "'self' https://cdn.jsdelivr.net" : "'self' https://esm.run https://cdn.jsdelivr.net";
    const loopback = `http://localhost:${PORT} http://127.0.0.1:${PORT}`;
    res.setHeader("Content-Security-Policy", [
      "default-src 'self'", `script-src ${scripts}`, "style-src 'self'", "img-src 'self' data: blob:",
      "media-src 'self' blob:", "connect-src 'self'", "object-src 'none'", "base-uri 'self'",
      `frame-src 'self' ${loopback}`, `frame-ancestors 'self' ${loopback}`,
    ].join("; "));
  }
  if (PP) res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(self)");
}

// ---------------------------------------------------------------- data
let nextReportId = 1;
let nextMediaId = 1;
let maxUpload = DEFAULT_MAX_UPLOAD;
const failNext = new Set();
const reports = new Map();
const media = new Map();
const inflightUploads = new Set();

function seed() {
  reports.clear(); media.clear(); nextReportId = 1; nextMediaId = 1;
  const base = Date.parse("2026-10-15T09:00:00Z");
  [
    { title: "North gate fence damaged", note: "Two panels bent near the gate.", position: { latitude: 35.6812, longitude: 139.7671, accuracy: 12 }, address: "" },
    { title: "Drainage blocked at lot B", note: "Water pooling after rain.", position: null, address: "Lot B, east corner" },
    { title: "Scaffold inspection — tower 3", note: "Tags up to date. One missing toe board on level 4.", position: { latitude: 35.6586, longitude: 139.7454, accuracy: 30 }, address: "" },
  ].forEach((r, i) => {
    const id = nextReportId++;
    reports.set(id, { id, ...r, createdAt: new Date(base + i * 3600_000).toISOString(), media: [] });
  });
}
seed();

const publicMedia = (m) => ({ id: m.id, name: m.name, type: m.type, size: m.size, url: `/media/${m.id}` });
const summary = (r) => ({ id: r.id, title: r.title, createdAt: r.createdAt, mediaCount: r.media.length });
const full = (r) => ({ id: r.id, title: r.title, note: r.note, position: r.position, address: r.address, createdAt: r.createdAt, media: r.media.map(publicMedia) });

async function readBody(req, slow = false) {
  const chunks = [];
  if (!slow) { for await (const c of req) chunks.push(c); return Buffer.concat(chunks); }
  return new Promise((done, fail) => {     // about 64 KB per 100 ms, so progress shows on localhost
    let budget = 64 * 1024;
    const tick = setInterval(() => { budget = 64 * 1024; req.resume(); }, 100);
    req.on("data", (c) => { chunks.push(c); budget -= c.length; if (budget <= 0) req.pause(); });
    req.on("end", () => { clearInterval(tick); done(Buffer.concat(chunks)); });
    req.on("error", (e) => { clearInterval(tick); fail(e); });
    req.on("close", () => clearInterval(tick));
  });
}
function filePart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? "");
  if (!m) return null;
  const boundary = Buffer.from("--" + (m[1] ?? m[2]));
  for (let pos = buf.indexOf(boundary); pos !== -1;) {
    const headEnd = buf.indexOf("\r\n\r\n", pos);
    const next = headEnd === -1 ? -1 : buf.indexOf(boundary, headEnd + 4);
    if (next === -1) return null;
    const head = buf.slice(pos + boundary.length + 2, headEnd).toString("utf8");
    if (/name="file"/i.test(head)) {
      return { filename: /filename="([^"]*)"/i.exec(head)?.[1] ?? "", type: /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim() ?? "", data: buf.slice(headEnd + 4, next - 2) };
    }
    pos = next;
  }
  return null;
}
const takeFail = (kind, url) => url.searchParams.get("fail") === "1" || failNext.delete(kind);

// ---------------------------------------------------------------- an embedding page on another origin
function embedPage(req, res, url) {
  const allow = url.searchParams.get("allow") === "1";
  const src = `http://${otherHost(req.headers.host ?? "")}${url.searchParams.get("path") ?? "/new"}`;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><link rel="icon" href="data:,"><title>Another site embeds the field report</title></head>
<body><h1>Another origin embeds the app — ${allow ? 'allow="camera; microphone; geolocation"' : "no allow="}</h1>
<iframe id="app" src="${src}" width="900" height="900"${allow ? ' allow="camera; microphone; geolocation"' : ""}></iframe></body></html>`);
}

// ---------------------------------------------------------------- routes
createDemoServer({
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

    if (pathname.startsWith("/api/test/") && req.method === "POST") {
      if (pathname === "/api/test/reset") { seed(); maxUpload = DEFAULT_MAX_UPLOAD; failNext.clear(); return jsonResponse(res, { ok: true }), true; }
      if (pathname === "/api/test/max-upload") { maxUpload = Number(url.searchParams.get("bytes")); return jsonResponse(res, { maxUpload }), true; }
      if (pathname === "/api/test/fail-next") { failNext.add(url.searchParams.get("kind") ?? "create"); return jsonResponse(res, { ok: true }), true; }
      if (pathname === "/api/test/drop-uploads") {
        const dropped = inflightUploads.size;
        for (const socket of inflightUploads) socket.destroy();
        inflightUploads.clear();
        return jsonResponse(res, { dropped }), true;
      }
    }

    if (pathname.startsWith("/api/") || pathname.startsWith("/media/")) {
      const ms = Number(url.searchParams.get("delay") || ENV_DELAY);
      if (ms) await delay(ms);
    }

    if (req.method === "GET" && pathname === "/api/reports") {
      const list = [...reports.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id).map(summary);
      return jsonResponse(res, list), true;
    }
    let m = /^\/api\/reports\/(\d+)$/.exec(pathname);
    if (req.method === "GET" && m) {
      const r = reports.get(Number(m[1]));
      return jsonResponse(res, r ? full(r) : { error: "not found" }, r ? 200 : 404), true;
    }
    if (req.method === "POST" && pathname === "/api/reports") {
      let data = null;
      try { data = JSON.parse((await readBody(req)).toString("utf8") || "{}"); } catch { data = null; }
      if (takeFail("create", url)) return jsonResponse(res, { error: "server failure" }, 500), true;
      if (!data) return jsonResponse(res, { error: "bad json" }, 400), true;
      const title = typeof data.title === "string" ? data.title.trim() : "";
      if (!title) return jsonResponse(res, { errors: { title: "required" } }, 422), true;
      const p = data.position;
      const id = nextReportId++;
      const r = {
        id, title, note: String(data.note ?? ""), address: String(data.address ?? ""), createdAt: new Date().toISOString(), media: [],
        position: p && typeof p === "object" ? { latitude: Number(p.latitude), longitude: Number(p.longitude), accuracy: Number(p.accuracy) } : null,
      };
      reports.set(id, r);
      return jsonResponse(res, full(r), 201), true;
    }
    m = /^\/api\/reports\/(\d+)\/media$/.exec(pathname);
    if (req.method === "POST" && m) {
      inflightUploads.add(req.socket);
      res.on("close", () => inflightUploads.delete(req.socket));
      const body = await readBody(req, url.searchParams.get("slow") === "1").catch(() => null);
      if (!body) return true;   // the connection went away
      const r = reports.get(Number(m[1]));
      if (takeFail("upload", url)) return jsonResponse(res, { error: "server failure" }, 500), true;
      if (!r) return jsonResponse(res, { error: "not found" }, 404), true;
      const file = filePart(body, req.headers["content-type"]);
      if (!file) return jsonResponse(res, { error: "no file" }, 400), true;
      if (file.data.length > maxUpload) return jsonResponse(res, { error: "too large" }, 413), true;
      if (!/^(video|audio|image)\//.test(file.type)) return jsonResponse(res, { error: "unsupported type" }, 415), true;
      const item = { id: nextMediaId++, name: file.filename || "clip", type: file.type, size: file.data.length, data: file.data };
      media.set(item.id, item);
      r.media.push(item);
      return jsonResponse(res, publicMedia(item), 201), true;
    }
    m = /^\/media\/(\d+)$/.exec(pathname);
    if (req.method === "GET" && m) {
      const item = media.get(Number(m[1]));
      if (!item) return jsonResponse(res, { error: "not found" }, 404), true;
      res.writeHead(200, { "Content-Type": item.type, "Content-Length": item.size });
      res.end(item.data);
      return true;
    }
    if (pathname.startsWith("/api/")) return jsonResponse(res, { error: "not found" }, 404), true;

    if (req.method === "GET" && pathname === "/embed") return embedPage(req, res, url), true;

    // Every other extensionless GET is the app (history fallback).
    if (req.method === "GET" && extname(pathname) === "") {
      let html;
      try { html = await page(); } catch (e) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`The page cannot go out: ${e.message}`);
        return true;
      }
      pageHeaders(res);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(html);
      return true;
    }
    return false;   // state.js, app.css: the shared static files
  },
  notes: [
    ...(LOCAL ? ["WCS_LOCAL=1: esm.run one-liners rewritten to the local packages/*/dist"] : []),
    ...(SRI ? ["SRI=1: pinned jsDelivr files with the release's integrity digests"] : []),
    ...(CSP ? ["CSP=1: Content-Security-Policy without 'unsafe-inline'"] : []),
    ...(PP ? ["PP=1: Permissions-Policy camera / microphone / geolocation = (self)"] : []),
    `Embedded by another origin: http://127.0.0.1:${PORT}/embed (no allow=) and /embed?allow=1`,
  ],
});
