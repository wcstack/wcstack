/**
 * Demo server for garden-plots — みどり市 市民農園 区画管理: the 農政課's console for the city's allotment gardens
 * (4 gardens, 298 plots), in Japanese, assembled from parts — みどり市 共通部品:
 *   /             the staff app (state + router + autoloader + sse + storage + defined): the map of plots, a plot's
 *                 page, the waiting list, the FAQ tree, the settings. A root state and one volume per feature
 *   /public.html  the citizens' page: the same parts over another state, read-only
 *   /parts.html   the parts' showcase
 * The designers' parts are HTML files (Declarative Custom Components, loaded by the autoloader's dcc loader), the
 * developers' parts are classes mounted on the page's data (bind-component), and vendor/ken-postal.js is another
 * vendor's element.
 *
 *   node examples/garden-plots/server.js                http://localhost:3000/ (PORT=… to change)
 *   WCS_LOCAL=1 node examples/garden-plots/server.js    the repository's packages/*\/dist instead of esm.run
 *
 * Node built-ins only (and examples/shared/server.js): nothing to install to run it. The data is generated in
 * memory from a fixed seed, so every start (and every POST /api/_test/reset) gives the same gardens.
 *
 * API:
 *   GET   /api/gardens                                  → the gardens with their areas and plots
 *   GET   /api/public/gardens                           → the same without the tenants
 *   GET   /api/plots/:id                                → a plot with its history and its neighbours | 404
 *   PATCH /api/plots/:id { version, tenant?, status? }  → the plot | 409 { plot } | 422 { errors }
 *   POST  /api/plots/:id/assign { version, applicantId } | /return { version }   → the plot | 409 | 422
 *   GET   /api/waiting?page=&per=&sort=applied|priority → { items, total, page }
 *   POST  /api/waiting · PATCH / DELETE /api/waiting/:id · POST /api/waiting/:id/move { direction }
 *   GET   /api/faq                                      → the FAQ tree
 *   GET   /api/postal/:code                             → { address } | 404
 *   GET   /api/events                                   server-sent events: plot (the changed plot), waiting
 *   Every /api/* request may add ?delay=<ms> (answer later).
 *
 * Test hooks (used by e2e/tests/garden-plots.spec.ts):
 *   POST /api/_test/reset                               the seed again, the log and the rules emptied
 *   POST /api/_test/fail { path, status, times, method? }    the next requests to an API path fail
 *   POST /api/_test/static { path, delay?, status?, body?, times? }   a static file late, failing, or with another body
 *   GET  /api/_test/log                                 every request since the last reset
 */
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDemoServer } from "../shared/server.js";
import { makeData, POSTAL } from "./data.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC = join(__dirname, "public");
const REPO_ROOT = resolve(__dirname, "..", "..");
const PORT = Number(process.env.PORT || 3000);
const LOCAL = process.env.WCS_LOCAL === "1";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
};
const PAGES = ["/index.html", "/public.html", "/parts.html"];

// ---------------------------------------------------------------- the API (as the app's author wrote it)
let db;
let log = [];
let apiFails = []; // { path, status, times }
let staticRules = []; // { path, delay, status, body, times }
const sseClients = new Set();

function reset() {
  db = makeData();
  log = [];
  apiFails = [];
  staticRules = [];
}
reset();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function send(res, status, body, headers = {}) {
  const text = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(text);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try { return JSON.parse(text); } catch { return null; }
}

function allPlots() {
  return db.gardens.flatMap((g) => g.areas.flatMap((a) => a.plots.map((p) => ({ p, g, a }))));
}
function findPlot(id) { return allPlots().find((x) => x.p.id === id); }

function plotDetail(id) {
  const list = allPlots();
  const i = list.findIndex((x) => x.p.id === id);
  if (i < 0) return null;
  const { p, g, a } = list[i];
  return {
    ...structuredClone(p), gardenId: g.id, areaId: a.id, gardenName: g.name, areaName: a.name,
    prevId: i > 0 ? list[i - 1].p.id : null, nextId: i < list.length - 1 ? list[i + 1].p.id : null,
    history: [...(db.history.get(id) ?? [])].reverse(),
  };
}

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
  for (const res of sseClients) res.write(msg);
}

function today() { return new Date().toISOString().slice(0, 10); }

/** Field validation for a person (tenant or applicant). `prefix` is "tenant." for plots. */
function validatePerson(t, prefix, { requireGarden = false } = {}) {
  const errors = {};
  if (!t || typeof t !== "object") return { [`${prefix}name`]: "氏名を入力してください" };
  if (!String(t.name ?? "").trim()) errors[`${prefix}name`] = "氏名を入力してください";
  else if (String(t.name).length > 40) errors[`${prefix}name`] = "氏名は 40 文字までです";
  if (t.phone && !/^[0-9-]{10,13}$/.test(t.phone)) errors[`${prefix}phone`] = "電話番号の形式が正しくありません";
  if (t.postal && !/^\d{3}-?\d{4}$/.test(t.postal)) errors[`${prefix}postal`] = "郵便番号は 7 桁です";
  // The server knows a rule the client does not: a phone number beginning 000 is refused (lets tests see a 422).
  if (t.phone && /^000/.test(t.phone)) errors[`${prefix}phone`] = "この電話番号は使用できません";
  if (requireGarden && ![1, 2, 3, 4].includes(Number(t.gardenId))) errors.gardenId = "希望の農園を選んでください";
  return errors;
}

function pickPerson(t) {
  return { name: String(t.name ?? "").trim(), phone: String(t.phone ?? ""), postal: String(t.postal ?? ""), address: String(t.address ?? "") };
}

function waitingSorted(sort) {
  const items = [...db.waiting];
  if (sort === "priority") items.sort((a, b) => a.priority - b.priority);
  else items.sort((a, b) => a.appliedAt.localeCompare(b.appliedAt) || a.id - b.id);
  return items;
}

function renumberPriority() {
  [...db.waiting].sort((a, b) => a.priority - b.priority).forEach((w, i) => { w.priority = i + 1; });
}

async function api(req, res, url) {
  const path = url.pathname;
  const method = req.method;

  // Test controls first — they are never delayed or failed.
  if (path === "/api/_test/reset" && method === "POST") { reset(); broadcast("waiting", {}); return send(res, 200, { ok: true }); }
  if (path === "/api/_test/log" && method === "GET") return send(res, 200, log);
  if (path === "/api/_test/fail" && method === "POST") {
    const b = await readBody(req);
    apiFails.push({ path: b.path, status: b.status ?? 500, times: b.times ?? 1, method: b.method });
    return send(res, 200, { ok: true });
  }
  if (path === "/api/_test/static" && method === "POST") {
    const b = await readBody(req);
    staticRules.push({ path: b.path, delay: b.delay ?? 0, status: b.status, body: b.body, times: b.times ?? Infinity });
    return send(res, 200, { ok: true });
  }

  const delay = Number(url.searchParams.get("delay") || 0);
  if (delay > 0) await sleep(Math.min(delay, 60000));

  const fail = apiFails.find((f) => f.times > 0 && (f.path === path || (f.path.endsWith("*") && path.startsWith(f.path.slice(0, -1)))) && (!f.method || f.method === method));
  if (fail) {
    fail.times -= 1;
    return send(res, fail.status, { error: "injected failure" });
  }

  let m;
  if (path === "/api/gardens" && method === "GET") return send(res, 200, db.gardens);
  if (path === "/api/public/gardens" && method === "GET") {
    return send(res, 200, db.gardens.map((g) => ({ ...g, areas: g.areas.map((a) => ({ ...a, plots: a.plots.map(({ tenant, ...p }) => p) })) })));
  }
  if ((m = path.match(/^\/api\/plots\/(\d+)$/))) {
    const id = Number(m[1]);
    const found = findPlot(id);
    if (!found) return send(res, 404, { error: "not found" });
    if (method === "GET") return send(res, 200, plotDetail(id));
    if (method === "PATCH") {
      const b = await readBody(req);
      if (!b) return send(res, 400, { error: "bad json" });
      if (b.version !== found.p.version) return send(res, 409, { plot: plotDetail(id) });
      const errors = {};
      if (b.status !== undefined && !["free", "used", "renewal", "paused"].includes(b.status)) errors.status = "状態が正しくありません";
      if (b.tenant !== undefined && b.tenant !== null) Object.assign(errors, validatePerson(b.tenant, "tenant."));
      if (Object.keys(errors).length) return send(res, 422, { errors });
      const what = [];
      if (b.tenant !== undefined) {
        found.p.tenant = b.tenant === null ? null : { id: found.p.tenant?.id ?? 9000 + id, ...pickPerson(b.tenant) };
        what.push("利用者情報を更新");
      }
      if (b.status !== undefined && b.status !== found.p.status) {
        what.push(b.status === "paused" ? "休止" : found.p.status === "paused" ? "休止を解除" : `状態を ${b.status} に変更`);
        found.p.status = b.status;
      }
      found.p.version += 1;
      db.history.get(id).push({ at: today(), what: what.join("・") || "変更なし", who: String(req.headers["x-staff"] || "職員") });
      broadcast("plot", found.p);
      return send(res, 200, plotDetail(id));
    }
  }
  if ((m = path.match(/^\/api\/plots\/(\d+)\/(assign|return)$/)) && method === "POST") {
    const id = Number(m[1]);
    const found = findPlot(id);
    if (!found) return send(res, 404, { error: "not found" });
    const b = await readBody(req);
    if (!b) return send(res, 400, { error: "bad json" });
    if (b.version !== found.p.version) return send(res, 409, { plot: plotDetail(id) });
    if (m[2] === "assign") {
      if (found.p.status !== "free") return send(res, 422, { errors: { status: "空き区画ではありません" } });
      const ai = db.waiting.findIndex((w) => w.id === Number(b.applicantId));
      if (ai < 0) return send(res, 422, { errors: { applicantId: "待機者が見つかりません" } });
      const [w] = db.waiting.splice(ai, 1);
      renumberPriority();
      found.p.tenant = { id: w.id, ...pickPerson(w) };
      found.p.status = "used";
      found.p.since = today();
      db.history.get(id).push({ at: today(), what: `利用開始（${w.name}）`, who: String(req.headers["x-staff"] || "職員") });
      broadcast("waiting", {});
    } else {
      if (!found.p.tenant) return send(res, 422, { errors: { status: "利用者がいません" } });
      db.history.get(id).push({ at: today(), what: `返還（${found.p.tenant.name}）`, who: String(req.headers["x-staff"] || "職員") });
      found.p.tenant = null;
      found.p.status = "free";
      found.p.since = null;
    }
    found.p.version += 1;
    broadcast("plot", found.p);
    return send(res, 200, plotDetail(id));
  }
  if (path === "/api/waiting" && method === "GET") {
    const per = Math.max(1, Math.min(100, Number(url.searchParams.get("per") || 20)));
    const sort = url.searchParams.get("sort") === "priority" ? "priority" : "applied";
    const all = waitingSorted(sort);
    const pages = Math.max(1, Math.ceil(all.length / per));
    const page = Math.max(1, Math.min(pages, Number(url.searchParams.get("page") || 1)));
    return send(res, 200, { items: all.slice((page - 1) * per, page * per), total: all.length, page });
  }
  if (path === "/api/waiting" && method === "POST") {
    const b = await readBody(req);
    if (!b) return send(res, 400, { error: "bad json" });
    const errors = validatePerson(b, "", { requireGarden: true });
    if (Object.keys(errors).length) return send(res, 422, { errors });
    const id = Math.max(1000, ...db.waiting.map((w) => w.id)) + 1;
    const w = { id, ...pickPerson(b), gardenId: Number(b.gardenId), appliedAt: today(), priority: db.waiting.length + 1 };
    db.waiting.push(w);
    broadcast("waiting", {});
    return send(res, 201, w);
  }
  if ((m = path.match(/^\/api\/waiting\/(\d+)$/))) {
    const w = db.waiting.find((x) => x.id === Number(m[1]));
    if (!w) return send(res, 404, { error: "not found" });
    if (method === "PATCH") {
      const b = await readBody(req);
      if (!b) return send(res, 400, { error: "bad json" });
      const merged = { ...w, ...b };
      const errors = validatePerson(merged, "", { requireGarden: true });
      if (Object.keys(errors).length) return send(res, 422, { errors });
      Object.assign(w, pickPerson(merged), { gardenId: Number(merged.gardenId) });
      broadcast("waiting", {});
      return send(res, 200, w);
    }
    if (method === "DELETE") {
      db.waiting = db.waiting.filter((x) => x !== w);
      renumberPriority();
      broadcast("waiting", {});
      return send(res, 200, { ok: true });
    }
  }
  if ((m = path.match(/^\/api\/waiting\/(\d+)\/move$/)) && method === "POST") {
    const b = await readBody(req);
    const list = [...db.waiting].sort((a, c) => a.priority - c.priority);
    const i = list.findIndex((x) => x.id === Number(m[1]));
    if (i < 0) return send(res, 404, { error: "not found" });
    const j = b?.direction === "up" ? i - 1 : i + 1;
    if (j >= 0 && j < list.length) {
      const t = list[i].priority; list[i].priority = list[j].priority; list[j].priority = t;
      broadcast("waiting", {});
    }
    return send(res, 200, { ok: true });
  }
  if (path === "/api/faq" && method === "GET") return send(res, 200, db.faq);
  if ((m = path.match(/^\/api\/postal\/(\d{7})$/)) && method === "GET") {
    const address = POSTAL[m[1]];
    return address ? send(res, 200, { address }) : send(res, 404, { error: "unknown" });
  }
  if (path === "/api/events" && method === "GET") {
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.write("retry: 1000\n: hello\n\n");
    sseClients.add(res);
    const ping = setInterval(() => res.write(`event: ping\ndata: {}\n\n`), 15000);
    req.on("close", () => { clearInterval(ping); sseClients.delete(res); });
    return;
  }
  return send(res, 404, { error: "no such api" });
}

// ---------------------------------------------------------------- the pages
// WCS_LOCAL=1: the esm.run lines become the repository's bundles (served below from packages/), each resolved
// through the package's own `exports` map (`https://esm.run/@wcstack/<pkg>/auto` → its `./auto` entry).
const exportsCache = new Map();

function localEntry(pkg, subpath) {
  if (!exportsCache.has(pkg)) {
    let map = null;
    try {
      map = JSON.parse(readFileSync(join(REPO_ROOT, "packages", pkg, "package.json"), "utf8")).exports ?? null;
    } catch {
      // not a package of this repository
    }
    exportsCache.set(pkg, map);
  }
  const target = exportsCache.get(pkg)?.["." + subpath];
  const file = typeof target === "string" ? target : target?.import ?? target?.default;
  return typeof file === "string" ? `/packages/${pkg}/${file.replace(/^\.\//, "")}` : null;
}

async function page(name) {
  const html = await readFile(join(PUBLIC, name), "utf8");
  if (!LOCAL) return html;
  return html.replace(
    /https:\/\/esm\.run\/@wcstack\/([\w-]+)((?:\/[\w-]+)*)(?=["'\s])/g,
    (match, pkg, subpath) => localEntry(pkg, subpath) ?? match,
  );
}

const NO_STORE = { "Cache-Control": "no-store" };

createDemoServer({
  port: PORT,
  root: PUBLIC,
  async api(req, res, url) {
    const pathname = decodeURIComponent(url.pathname);
    if (!pathname.startsWith("/api/_test/")) log.push({ method: req.method, path: url.pathname + url.search, at: Date.now() });

    // ---- WCS_LOCAL=1: the bundles the pages name instead of esm.run ----
    if (LOCAL && req.method === "GET" && pathname.startsWith("/packages/")) {
      const file = resolve(REPO_ROOT, "." + pathname);
      if (!file.startsWith(join(REPO_ROOT, "packages"))) { res.writeHead(403); res.end("Forbidden"); return true; }
      const content = await readFile(file).catch(() => null);
      if (!content) { res.writeHead(404); res.end("Not found"); return true; }
      res.writeHead(200, { "Content-Type": file.endsWith(".map") ? "application/json" : "text/javascript; charset=utf-8" });
      res.end(content);
      return true;
    }

    try {
      if (pathname.startsWith("/api/")) { await api(req, res, url); return true; }

      // every extensionless GET is the staff app (history fallback)
      const file = pathname === "/" || extname(pathname) === "" ? "/index.html" : pathname;
      // a test's rule for this file: late, failing, or with another body
      const rule = staticRules.find((r) => r.times > 0 && r.path === file);
      if (rule) {
        rule.times -= 1;
        if (rule.delay) await sleep(rule.delay);
        if (rule.status && rule.status !== 200) {
          res.writeHead(rule.status, { "Content-Type": "text/plain; charset=utf-8", ...NO_STORE });
          res.end(`injected ${rule.status}`);
          return true;
        }
        if (rule.body !== undefined) {
          res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", ...NO_STORE });
          res.end(rule.body);
          return true;
        }
      }
      if (PAGES.includes(file)) {
        res.writeHead(200, { "Content-Type": TYPES[".html"], ...NO_STORE });
        res.end(await page(file));
        return true;
      }
      // the parts, the state files, the styles: as they are, never from a cache (a test changes what a path answers)
      const target = resolve(PUBLIC, "." + file);
      const content = target.startsWith(PUBLIC) ? await readFile(target).catch(() => null) : null;
      if (content) {
        res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", ...NO_STORE });
        res.end(content);
        return true;
      }
    } catch (e) {
      console.error(e);
      if (!res.headersSent) send(res, 500, { error: String(e?.message ?? e) });
      else res.end();
      return true;
    }
    return false; // not here: the shared server answers 404
  },
  notes: [
    ...(LOCAL ? ["WCS_LOCAL=1: esm.run lines rewritten to the local packages/*/dist"] : []),
    "The staff app: / — the citizens' page: /public.html — the parts: /parts.html",
  ],
});
