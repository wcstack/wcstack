/**
 * prod-booking — a meeting-room booking app under /booking/, served in six delivery profiles, each in two
 * versions (v1 = @wcstack/* 4.6.2 from npm, v2 = 4.7 — the published 4.7.0, or this repository's packages).
 *
 *   cd examples/prod-booking && npm install          once: the published files of both versions
 *   node examples/prod-booking/server.js             the profiles on PORT … PORT+5 (PORT defaults to 3000)
 *   WCS_LOCAL=1 node examples/prod-booking/server.js v2 is the repository's packages/*\/dist, and every
 *                                                     profile is served from this server (no CDN)
 *
 * Profiles (port = PORT + index):
 *   0 pinned            one script per package (dist/auto.min.js) with integrity
 *   1 split-importmap   @wcstack/state/core + the add-ons through an import map with integrity for every file;
 *                       production: no `diagnostics`
 *   2 split-auto        dist/split/auto.js, features="scopes" + $features; the import map's integrity covers
 *                       the add-ons and chunks it loads
 *   3 csp               pinned, under a strict Content-Security-Policy: a nonce per response,
 *                       require-trusted-types-for 'script', no 'unsafe-inline'
 *   4 selfhost          split-auto from /booking/vendor/@wcstack/<pkg>@<version>/… (immutable caching), the app's
 *                       components from /booking/<v1|v2>/components/… — the old versions stay on the server
 *   5 selfhost-inplace  the mistake: /booking/vendor/<pkg>/… (immutable) and /booking/components/… replaced in
 *                       place at a deploy, no integrity
 * Without WCS_LOCAL, profiles 0–3 load jsDelivr's files pinned to each version. Every digest is computed from
 * the files this server would serve (the npm tarballs, or packages/*\/dist), never from a CDN response.
 *
 * API (in memory, per profile):
 *   GET    /booking/api/rooms                          → 200 [{ id, name, capacity, pricePerHour, currency, equipment }]
 *   GET    /booking/api/rooms/:id/slots?date=YYYY-MM-DD → 200 { date, slots: [{ start, end, booked }] } | 404
 *   POST   /booking/api/bookings  { roomId, date, start, end, title, attendees? } → 201 | 409 { error: "taken" } | 422 { errors }
 *   GET    /booking/api/bookings?mine=1                → 200 [booking]
 *   DELETE /booking/api/bookings/:id                   → 204 | 404
 *   GET    /booking/api/version                        → 200 { app: "v1" | "v2" }
 *   POST   /booking/api/client-errors                  → 204 (kept; GET lists them)
 *   GET    /booking/api/admin/stats  (Authorization: Bearer admin) → 200 { bookings, rooms } | 401
 *   every answer: ?delay=<ms>, ?fail=1 (500)
 * Test hooks (e2e/tests/prod-booking.spec.ts):
 *   POST /api/test/reset                 data, client errors, failures cleared; v2 deployed
 *   POST /api/test/deploy?to=v1|v2       switch what the profile serves, without a restart
 *   POST /api/test/fail-next?path=rooms  the next GET /booking/api/rooms answers 500
 */
import { fileURLToPath } from "node:url";
import { readFile, readdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { extname, join, resolve, sep } from "node:path";
import { createDemoServer, jsonResponse, delay } from "../shared/server.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const PORT = Number(process.env.PORT || 3000);
const LOCAL = process.env.WCS_LOCAL === "1";
const PACKAGES = ["autoloader", "fetch", "storage", "router", "state"];   // the order the scripts are written in
const ADDONS = ["temporal", "formats", "scopes", "list-keys"];

// ---------------------------------------------------------------- where each version's files are
function packageDir(version, pkg) {
  if (version === "v1") return join(HERE, "node_modules", `${pkg}-v1`);
  return LOCAL ? join(REPO_ROOT, "packages", pkg) : join(HERE, "node_modules", "@wcstack", pkg);
}
if (!existsSync(packageDir("v1", "state")) || (!LOCAL && !existsSync(packageDir("v2", "state")))) {
  console.error("examples/prod-booking: run `npm install` in examples/prod-booking first (the published files of both versions).");
  process.exit(1);
}
const VERSIONS = Object.fromEntries(["v1", "v2"].map((v) =>
  [v, JSON.parse(readFileSync(join(packageDir(v, "state"), "package.json"), "utf8")).version]));

const PROFILES = [
  { name: "pinned", delivery: "bundles", host: "cdn" },
  { name: "split-importmap", delivery: "split-importmap", host: "cdn" },
  { name: "split-auto", delivery: "split-auto", host: "cdn" },
  { name: "csp", delivery: "bundles", host: "cdn", csp: true },
  { name: "selfhost", delivery: "split-auto", host: "versioned" },
  { name: "selfhost-inplace", delivery: "split-auto", host: "inplace" },
];
const hostOf = (profile) => (profile.host === "cdn" && LOCAL ? "versioned" : profile.host);

function vendorBase(profile, version, pkg) {
  const host = hostOf(profile);
  if (host === "cdn") return `https://cdn.jsdelivr.net/npm/@wcstack/${pkg}@${VERSIONS[version]}/`;
  if (host === "inplace") return `/booking/vendor/${pkg}/`;
  return `/booking/vendor/@wcstack/${pkg}@${VERSIONS[version]}/`;
}

const digests = new Map();
async function integrityOf(version, pkg, file) {
  const path = join(packageDir(version, pkg), file);
  if (!digests.has(path)) digests.set(path, "sha384-" + createHash("sha384").update(await readFile(path)).digest("base64"));
  return digests.get(path);
}
async function splitFiles(version, sub) {
  return (await readdir(join(packageDir(version, "state"), "dist", "split", sub))).filter((f) => f.endsWith(".js"));
}

// ---------------------------------------------------------------- the page: the profile's <head> block
async function deliveryBlock(profile, version, nonce) {
  const n = nonce ? ` nonce="${nonce}"` : "";
  const withIntegrity = hostOf(profile) !== "inplace";
  const components = hostOf(profile) === "inplace" ? "./components/" : `./${version}/components/`;
  const imports = { "@components/booking/": components + "booking/", "@components/price/": components + "price/" };
  const integrity = {};
  const scripts = [];
  const stateBase = vendorBase(profile, version, "state");
  const cover = async (file) => { if (withIntegrity) integrity[stateBase + file] = await integrityOf(version, "state", file); };

  for (const pkg of PACKAGES) {
    if (pkg !== "state" || profile.delivery === "bundles") {
      const url = vendorBase(profile, version, pkg) + "dist/auto.min.js";
      const sri = withIntegrity ? ` integrity="${await integrityOf(version, pkg, "dist/auto.min.js")}"` : "";
      scripts.push(`<script type="module"${n} src="${url}"${sri}></script>`);
    } else if (profile.delivery === "split-importmap") {
      imports["@wcstack/state/core"] = stateBase + "dist/split/core.js";
      await cover("dist/split/core.js");
      for (const addon of ADDONS) {
        imports[`@wcstack/state/features/${addon}`] = stateBase + `dist/split/features/${addon}.js`;
        await cover(`dist/split/features/${addon}.js`);
      }
      for (const chunk of await splitFiles(version, "chunks")) await cover(`dist/split/chunks/${chunk}`);
      scripts.push(`<script type="module"${n}>
  import { bootstrapState, installFeatures } from "@wcstack/state/core";
  import temporal from "@wcstack/state/features/temporal";
  import formats from "@wcstack/state/features/formats";
  import scopes from "@wcstack/state/features/scopes";
  import listKeys from "@wcstack/state/features/list-keys";
  installFeatures([temporal, formats, scopes, listKeys]);
  bootstrapState();
</script>`);
    } else {   // split-auto: the entry, and integrity for the add-ons and chunks it imports
      const sri = withIntegrity ? ` integrity="${await integrityOf(version, "state", "dist/split/auto.js")}"` : "";
      scripts.push(`<script type="module"${n} src="${stateBase}dist/split/auto.js"${sri}></script>`);
      for (const addon of await splitFiles(version, "features")) await cover(`dist/split/features/${addon}`);
      for (const chunk of await splitFiles(version, "chunks")) await cover(`dist/split/chunks/${chunk}`);
    }
  }
  const map = JSON.stringify({ imports, ...(Object.keys(integrity).length ? { integrity } : {}) }, null, 2);
  return [`<script${n} src="/booking/report.js"></script>`, `<script type="importmap"${n}>\n${map}\n</script>`, ...scripts].join("\n");
}

async function page(profile, version) {
  const nonce = profile.csp ? randomBytes(16).toString("base64") : null;
  let html = await readFile(join(HERE, version, "index.html"), "utf8");
  html = html.replace(/<!-- server\.js writes the delivery profile here[^>]*-->/, await deliveryBlock(profile, version, nonce));
  const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" };
  if (nonce) {
    html = html.replace(/<script(?![^>]*\snonce=)/g, `<script nonce="${nonce}"`);   // the page's own scripts too
    const cdn = hostOf(profile) === "cdn" ? " https://cdn.jsdelivr.net" : "";
    headers["Content-Security-Policy"] = [
      "default-src 'self'", `script-src 'nonce-${nonce}' 'self'${cdn}`, "style-src 'self'", "connect-src 'self'",
      "img-src 'self' data:", "object-src 'none'", "base-uri 'self'", "require-trusted-types-for 'script'",
    ].join("; ");
  }
  return { html, headers };
}

// ---------------------------------------------------------------- static files
const MIME = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".map": "application/json; charset=utf-8", ".json": "application/json; charset=utf-8" };
const IMMUTABLE = "public, max-age=31536000, immutable";
async function sendFile(res, dir, rel, cache) {
  const root = resolve(dir);
  const file = resolve(root, "." + rel);
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); res.end("Forbidden"); return; }
  const body = await readFile(file).catch(() => null);
  if (!body) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Not Found"); return; }
  res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream", "Cache-Control": cache });
  res.end(body);
}

// ---------------------------------------------------------------- data
const ROOMS = [
  ["Maple", 4, 1500, ["projector", "whiteboard"]], ["Birch", 6, 2000, ["tv"]], ["Cedar", 8, 2500, ["whiteboard"]],
  ["Willow", 10, 3000, ["projector", "phone"]], ["Aspen", 2, 800, []], ["Rowan", 12, 4000, ["tv", "camera"]],
  ["Hazel", 6, 1800, ["whiteboard", "phone"]], ["Linden", 20, 6000, ["projector", "tv", "camera"]],
].map(([name, capacity, pricePerHour, equipment], i) => ({ id: i + 1, name, capacity, pricePerHour, currency: "JPY", equipment }));
const STARTS = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"];
const endOf = (start) => String(Number(start.slice(0, 2)) + 1).padStart(2, "0") + ":00";

async function readJson(req) {
  let text = "";
  for await (const chunk of req) text += chunk;
  try { return JSON.parse(text || "null"); } catch { return undefined; }
}
const noContent = (res) => { res.writeHead(204); res.end(); };

// ---------------------------------------------------------------- one listener per profile
function serve(profile, port) {
  const s = { deployed: "v2", bookings: new Map(), nextId: 1, clientErrors: [], failNext: new Set() };
  const reset = () => { s.deployed = "v2"; s.bookings.clear(); s.nextId = 1; s.clientErrors = []; s.failNext.clear(); };

  async function api(req, res, url, rest) {
    const delayMs = Number(url.searchParams.get("delay") || 0);
    if (delayMs > 0) await delay(delayMs);
    if (url.searchParams.get("fail") === "1") return jsonResponse(res, { error: "internal error" }, 500);
    const m = req.method;
    let match;
    if (m === "GET" && rest === "rooms") {
      if (s.failNext.delete("rooms")) return jsonResponse(res, { error: "internal error" }, 500);
      return jsonResponse(res, ROOMS);
    }
    if (m === "GET" && (match = rest.match(/^rooms\/(\d+)\/slots$/))) {
      const room = ROOMS.find((r) => r.id === Number(match[1]));
      const date = url.searchParams.get("date") || "";
      if (!room || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return jsonResponse(res, { error: "not found" }, 404);
      const taken = new Set([...s.bookings.values()].filter((b) => b.roomId === room.id && b.date === date).map((b) => b.start));
      return jsonResponse(res, { date, slots: STARTS.map((start) => ({ start, end: endOf(start), booked: taken.has(start) })) });
    }
    if (m === "POST" && rest === "bookings") {
      const b = await readJson(req);
      if (!b || typeof b !== "object") return jsonResponse(res, { errors: { body: "a JSON object is required" } }, 422);
      const room = ROOMS.find((r) => r.id === Number(b.roomId));
      const errors = {};
      if (!room) errors.roomId = "unknown room";
      if (typeof b.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) errors.date = "date is required";
      if (!STARTS.includes(b.start)) errors.start = "pick a slot";
      if (typeof b.title !== "string" || b.title.trim() === "") errors.title = "title is required";
      if (b.attendees != null && !(Number.isInteger(b.attendees) && b.attendees >= 1 && (!room || b.attendees <= room.capacity))) {
        errors.attendees = room ? `1 to ${room.capacity}` : "a positive integer";
      }
      if (Object.keys(errors).length) return jsonResponse(res, { errors }, 422);
      if ([...s.bookings.values()].some((x) => x.roomId === room.id && x.date === b.date && x.start === b.start)) {
        return jsonResponse(res, { error: "taken" }, 409);
      }
      const booking = { id: s.nextId++, roomId: room.id, date: b.date, start: b.start, end: endOf(b.start), title: b.title.trim() };
      if (b.attendees != null) booking.attendees = b.attendees;
      s.bookings.set(booking.id, booking);
      return jsonResponse(res, booking, 201);
    }
    if (m === "GET" && rest === "bookings") return jsonResponse(res, [...s.bookings.values()]);
    if (m === "DELETE" && (match = rest.match(/^bookings\/(\d+)$/))) {
      return s.bookings.delete(Number(match[1])) ? noContent(res) : jsonResponse(res, { error: "not found" }, 404);
    }
    if (m === "GET" && rest === "version") return jsonResponse(res, { app: s.deployed });
    if (m === "POST" && rest === "client-errors") {
      s.clientErrors.push({ deployed: s.deployed, report: await readJson(req) });
      return noContent(res);
    }
    if (m === "GET" && rest === "client-errors") return jsonResponse(res, s.clientErrors);
    if (m === "GET" && rest === "admin/stats") {
      if (req.headers.authorization !== "Bearer admin") return jsonResponse(res, { error: "unauthorized" }, 401);
      return jsonResponse(res, { bookings: s.bookings.size, rooms: ROOMS.length });
    }
    return jsonResponse(res, { error: "not found" }, 404);
  }

  const server = createDemoServer({
    port,
    root: join(HERE, "v2"),   // never reached: every request is answered below
    notes: [`prod-booking profile "${profile.name}"`],
    api: async (req, res, url) => {
      const path = decodeURIComponent(url.pathname);
      if (path.startsWith("/api/test/") && req.method === "POST") {
        if (path === "/api/test/reset") { reset(); return jsonResponse(res, { ok: true }), true; }
        if (path === "/api/test/deploy") {
          const to = url.searchParams.get("to");
          if (!VERSIONS[to]) return jsonResponse(res, { error: "to=v1|v2" }, 400), true;
          s.deployed = to;
          return jsonResponse(res, { deployed: to }), true;
        }
        if (path === "/api/test/fail-next") { s.failNext.add(url.searchParams.get("path")); return jsonResponse(res, { ok: true }), true; }
      }
      if (path === "/") { res.writeHead(302, { Location: "/booking/" }); res.end(); return true; }
      if (path === "/booking") { res.writeHead(301, { Location: "/booking/" }); res.end(); return true; }
      if (path.startsWith("/wiki/")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Wiki</title></head><body><h1>Intranet wiki</h1></body></html>`);
        return true;
      }
      if (!path.startsWith("/booking/")) { res.writeHead(404); res.end("Not Found"); return true; }

      const rel = path.slice("/booking".length);   // "/…"
      if (rel.startsWith("/api/")) { await api(req, res, url, rel.slice("/api/".length)); return true; }
      let match;
      if ((match = rel.match(/^\/vendor\/@wcstack\/([\w-]+)@([\w.-]+)(\/.*)$/))) {
        const version = Object.keys(VERSIONS).find((v) => VERSIONS[v] === match[2]);
        if (!version || !PACKAGES.includes(match[1])) { res.writeHead(404); res.end("Not Found"); return true; }
        await sendFile(res, packageDir(version, match[1]), match[3], IMMUTABLE);
        return true;
      }
      if ((match = rel.match(/^\/vendor\/([\w-]+)(\/.*)$/)) && PACKAGES.includes(match[1])) {
        await sendFile(res, packageDir(s.deployed, match[1]), match[2], IMMUTABLE);   // replaced in place
        return true;
      }
      if ((match = rel.match(/^\/(v1|v2)(\/components\/.*)$/))) {
        await sendFile(res, join(HERE, match[1]), match[2], IMMUTABLE);
        return true;
      }
      if (rel === "/app.css" || rel === "/report.js") { await sendFile(res, HERE, rel, "no-cache"); return true; }
      if (rel === "/state.js" || rel === "/late-autoloader.js" || rel.startsWith("/components/")) {
        await sendFile(res, join(HERE, s.deployed), rel, "no-cache");
        return true;
      }
      if (extname(rel) === "") {   // every route of the app: the deployed version's page
        const { html, headers } = await page(profile, s.deployed);
        res.writeHead(200, headers);
        res.end(html);
        return true;
      }
      res.writeHead(404); res.end("Not Found");
      return true;
    },
  });
  return server;
}

let listening = 0;
PROFILES.forEach((profile, i) => {
  serve(profile, PORT + i).on("listening", () => {
    if (++listening === PROFILES.length) {
      console.log(`prod-booking server running: ${PROFILES.map((p, j) => `${p.name} :${PORT + j}`).join(", ")}`);
      console.log(`  v1 = @wcstack/* ${VERSIONS.v1} (npm), v2 = ${VERSIONS.v2} (${LOCAL ? "packages/*/dist, WCS_LOCAL=1" : "npm / jsDelivr"})`);
    }
  });
});
