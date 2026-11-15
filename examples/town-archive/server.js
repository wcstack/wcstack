/**
 * Demo server for town-archive — みどり市 まちの記憶アーカイブ: a city's archive of 12,000 photographs, in Japanese.
 * Two pages over one set of records, each a long list:
 *   /        the public site (state + router + fetch + intersection + resize + storage + debounce + media-query):
 *            a list loaded 60 at a time as the user scrolls, filters in the URL, a photo page, favourites
 *   /staff   the cataloguers' table (signals + fetch + sse + resize): all 12,000 records in memory
 *
 *   node examples/town-archive/server.js                http://localhost:3000/ (PORT=… to change)
 *   WCS_LOCAL=1 node examples/town-archive/server.js    the repository's packages/*\/dist instead of esm.run
 *
 * Node built-ins only (and examples/shared/server.js): nothing to install to run it. The data is generated in
 * memory from a fixed seed, so every start (and every POST /api/_test/reset) gives the same 12,000 records.
 *
 * API:
 *   GET   /api/areas                                    → [{ code, name }]
 *   GET   /api/photos?q=&area=&sort=old|new|title&offset=&limit=   → { items, total, offset } (public records, 60 at most)
 *   GET   /api/photos/position?…&decade=1990 | &id=4711 → { offset } | 404 | 400 (a decade with sort=title)
 *   GET   /api/photos/:id                               → the record with description and seen | 404
 *   GET   /img/:id?w=160|320|640|1280                   → an SVG in the record's colour and shape
 *   POST  /api/seen { ids }                             → 204 | 413 (more than 100); also a sendBeacon body
 *   GET   /api/staff/photos                             → every record, in a short form
 *   PATCH /api/staff/photos/:id { title?, tags?, public? }   → the record | 422 { errors }
 *   PATCH /api/staff/photos { ids, patch }              → { updated }
 *   GET   /api/staff/events                             server-sent events: updated / added, to every listener
 *   Every /api/* and /img/* request may add ?delay=<ms> (answer later).
 *
 * Test hooks (used by e2e/tests/town-archive.spec.ts):
 *   POST /api/_test/reset                               the seed again, the log emptied
 *   POST /api/_test/fail { path, status, times, match? }    the next requests to a path fail
 *   POST /api/_test/staff-event { type, record } | { burst: { perSecond, seconds } }   events as other staff would send
 *   GET  /api/_test/log                                 every request since the last reset (the pictures too)
 */
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDemoServer } from "../shared/server.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC = join(__dirname, "public");
const REPO_ROOT = resolve(__dirname, "..", "..");
const PORT = Number(process.env.PORT || 3000);
const LOCAL = process.env.WCS_LOCAL === "1";

// ---------------------------------------------------------------- data
export const AREAS = [
  { code: "kita", name: "北町" },
  { code: "minami", name: "南町" },
  { code: "higashi", name: "東町" },
  { code: "nishi", name: "西町" },
  { code: "ekimae", name: "駅前" },
  { code: "kawabe", name: "川辺" },
  { code: "yamanote", name: "山手" },
  { code: "minato", name: "港" },
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PLACES = ["駅前通り", "商店街", "小学校", "神社", "川沿い", "市役所", "公民館", "田んぼ", "波止場", "橋", "公園", "市場", "団地", "踏切", "図書館", "銭湯", "映画館", "山道"];
const SUBJECTS = ["の風景", "の祭り", "の人々", "の朝", "の夕暮れ", "の工事", "の雪景色", "の運動会", "の賑わい", "の子どもたち", "の開通式", "の記念撮影"];
const COMMON_TAGS = ["風景", "人物", "行事", "建物", "交通", "学校", "商店", "自然", "仕事", "子ども", "祭り", "道"];
const DONORS = ["山田 花子", "佐藤 一郎", "鈴木 和子", "高橋 実", "田中 美代子", "伊藤 健", "渡辺 千代", "中村 正夫", "小林 文子", "加藤 勇", "市民の方（匿名）"];
const SHAPES = [[3, 4], [4, 5], [1, 1], [4, 3], [3, 2], [16, 9]];
// Rare tags give the result sizes the tests need (counted among PUBLIC records):
//   蒸気機関車 → 3, 花火大会 → 60, 雪まつり → 61, 路面電車 → 150; q=恐竜 → 0.
const RARE = [["蒸気機関車", 3], ["花火大会", 60], ["雪まつり", 61], ["路面電車", 150]];

function generate() {
  const rnd = mulberry32(20250401);
  const records = [];
  for (let id = 1; id <= 12000; id++) {
    const year = 1950 + Math.floor(rnd() * 70);
    const month = 1 + Math.floor(rnd() * 12);
    const area = AREAS[Math.floor(rnd() * AREAS.length)];
    const place = PLACES[Math.floor(rnd() * PLACES.length)];
    const subject = SUBJECTS[Math.floor(rnd() * SUBJECTS.length)];
    const [sw, sh] = SHAPES[Math.floor(rnd() * SHAPES.length)];
    const base = 1200;
    const w = sw >= sh ? base : Math.round((base * sw) / sh);
    const h = sw >= sh ? Math.round((base * sh) / sw) : base;
    const tags = [];
    const n = 1 + Math.floor(rnd() * 3);
    while (tags.length < n) {
      const t = COMMON_TAGS[Math.floor(rnd() * COMMON_TAGS.length)];
      if (!tags.includes(t)) tags.push(t);
    }
    const hue = Math.floor(rnd() * 360);
    const color = hslToHex(hue, 35 + Math.floor(rnd() * 30), 45 + Math.floor(rnd() * 20));
    records.push({
      id,
      title: `${area.name}${place}${subject}`,
      year,
      month,
      area: area.code,
      tags,
      w,
      h,
      color,
      donor: DONORS[Math.floor(rnd() * DONORS.length)],
      public: rnd() > 0.02, // about 2 % start as 非公開
      seen: 0,
      updatedAt: new Date(Date.UTC(2024, 0, 1) + Math.floor(rnd() * 600) * 86400000).toISOString(),
    });
  }
  // Assign the rare tags to public records spread over the years.
  const pick = mulberry32(7);
  for (const [tag, count] of RARE) {
    let given = 0;
    while (given < count) {
      const r = records[Math.floor(pick() * records.length)];
      if (!r.public || r.tags.some((t) => RARE.some(([x]) => x === t))) continue;
      r.tags = [...r.tags, tag];
      given++;
    }
  }
  return records;
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

const DESCRIPTIONS = [
  "市民の方からお寄せいただいた一枚です。当時の様子がよくわかります。",
  "写っている建物の多くは今は残っていません。",
  "提供者のご家族が撮影されたものです。",
  "撮影場所について情報をお持ちの方は、アーカイブ係までお知らせください。",
];

let records = [];
let byId = new Map();
let seq = 0; // SSE event id
let log = [];
let failRules = [];
const sseClients = new Set();

function reset() {
  records = generate();
  byId = new Map(records.map((r) => [r.id, r]));
  log = [];
  failRules = [];
  seq = 0;
}
reset();

const collator = new Intl.Collator("ja");
function sortRecords(list, sort) {
  const s = list.slice();
  if (sort === "title") s.sort((a, b) => collator.compare(a.title, b.title) || a.id - b.id);
  else if (sort === "new") s.sort((a, b) => b.year - a.year || b.month - a.month || b.id - a.id);
  else s.sort((a, b) => a.year - b.year || a.month - b.month || a.id - b.id);
  return s;
}
function query(params) {
  const q = (params.get("q") || "").trim();
  const area = params.get("area") || "";
  const sort = ["old", "new", "title"].includes(params.get("sort")) ? params.get("sort") : "old";
  const words = q.split(/[\s　]+/).filter(Boolean);
  const list = records.filter((r) => r.public
    && (!area || r.area === area)
    && words.every((w) => r.title.includes(w) || r.tags.some((t) => t.includes(w))));
  return { list: sortRecords(list, sort), sort };
}
function publicRecord(r) {
  const { public: _p, seen: _s, updatedAt: _u, ...rest } = r;
  return rest;
}
function shortRecord(r) {
  return { id: r.id, title: r.title, year: r.year, area: r.area, tags: r.tags, public: r.public, updatedAt: r.updatedAt };
}

// ---------------------------------------------------------------- helpers
function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { __invalid: text }; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function broadcast(type, record) {
  seq++;
  const payload = `id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify(shortRecord(record))}\n\n`;
  for (const res of sseClients) res.write(payload);
}

function failFor(path, queryString) {
  for (const rule of failRules) {
    if (rule.times <= 0) continue;
    if (rule.path !== path) continue;
    if (rule.match && !queryString.includes(rule.match)) continue;
    rule.times--;
    return rule.status;
  }
  return 0;
}

function svgFor(r, w) {
  const h = Math.round((w * r.h) / r.w);
  const fs = Math.max(10, Math.round(w / 9));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<rect width="100%" height="100%" fill="${r.color}"/>`
    + `<circle cx="${w * 0.72}" cy="${h * 0.3}" r="${Math.min(w, h) * 0.12}" fill="rgba(255,255,255,.35)"/>`
    + `<path d="M0 ${h * 0.8} L${w * 0.3} ${h * 0.55} L${w * 0.55} ${h * 0.75} L${w * 0.8} ${h * 0.5} L${w} ${h * 0.7} L${w} ${h} L0 ${h}Z" fill="rgba(0,0,0,.25)"/>`
    + `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="${fs}" fill="#fff">#${r.id} ${r.year}</text>`
    + `<text x="6" y="${h - 6}" font-family="sans-serif" font-size="${Math.max(9, Math.round(fs / 2))}" fill="rgba(255,255,255,.8)">${w}w</text>`
    + `</svg>`;
}

// ---------------------------------------------------------------- routes
async function handleApi(req, res, url) {
  const p = url.pathname;
  const m = req.method;

  if (p === "/api/_test/reset" && m === "POST") { reset(); res.writeHead(204); return res.end(); }
  if (p === "/api/_test/log" && m === "GET") return json(res, 200, log);
  if (p === "/api/_test/fail" && m === "POST") {
    const b = await readBody(req);
    failRules.push({ path: b.path, status: Number(b.status) || 500, times: Number(b.times ?? 1), match: b.match || "" });
    res.writeHead(204); return res.end();
  }
  if (p === "/api/_test/staff-event" && m === "POST") {
    const b = await readBody(req);
    if (b.burst) {
      const { perSecond = 10, seconds = 1 } = b.burst;
      const total = perSecond * seconds;
      let i = 0;
      const rnd = mulberry32(99 + total);
      const timer = setInterval(() => {
        if (i++ >= total) return clearInterval(timer);
        const r = records[Math.floor(rnd() * records.length)];
        r.title = r.title.replace(/（更新\d+）$/, "") + `（更新${i}）`;
        r.updatedAt = new Date().toISOString();
        broadcast("updated", r);
      }, 1000 / perSecond);
    } else if (b.record) {
      const type = b.type === "added" ? "added" : "updated";
      let r;
      if (type === "added") {
        const id = b.record.id ?? records.length + 1;
        r = { year: 2000, month: 1, area: "kita", tags: [], w: 1200, h: 900, color: "#888888", donor: "（未記入）", public: true, seen: 0, ...b.record, id, updatedAt: new Date().toISOString() };
        records.push(r); byId.set(r.id, r);
      } else {
        r = byId.get(b.record.id);
        if (!r) return json(res, 404, { error: "not found" });
        for (const k of ["title", "tags", "public", "year", "area"]) if (k in b.record) r[k] = b.record[k];
        r.updatedAt = new Date().toISOString();
      }
      broadcast(type, r);
    }
    res.writeHead(204); return res.end();
  }

  if (p === "/api/areas" && m === "GET") return json(res, 200, AREAS);

  if (p === "/api/photos/position" && m === "GET") {
    const { list, sort } = query(url.searchParams);
    if (url.searchParams.has("decade")) {
      if (sort === "title") return json(res, 400, { error: "decade needs a date order" });
      const d = Number(url.searchParams.get("decade"));
      const i = list.findIndex((r) => r.year >= d && r.year < d + 10);
      if (i < 0) return json(res, 404, { error: "none" });
      return json(res, 200, { offset: i });
    }
    const id = Number(url.searchParams.get("id"));
    const i = list.findIndex((r) => r.id === id);
    if (i < 0) return json(res, 404, { error: "not in result" });
    return json(res, 200, { offset: i });
  }

  if (p === "/api/photos" && m === "GET") {
    const { list } = query(url.searchParams);
    const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
    const limit = Math.min(60, Math.max(1, Number(url.searchParams.get("limit")) || 60));
    return json(res, 200, { items: list.slice(offset, offset + limit).map(publicRecord), total: list.length, offset });
  }

  let mm;
  if ((mm = p.match(/^\/api\/photos\/(\d+)$/)) && m === "GET") {
    const r = byId.get(Number(mm[1]));
    if (!r || !r.public) return json(res, 404, { error: "not found" });
    const description = DESCRIPTIONS[r.id % DESCRIPTIONS.length];
    return json(res, 200, { ...publicRecord(r), description, seen: r.seen });
  }

  if (p === "/api/seen" && m === "POST") {
    const b = await readBody(req);
    const ids = Array.isArray(b.ids) ? b.ids : [];
    if (ids.length > 100) return json(res, 413, { error: "at most 100 ids" });
    for (const id of ids) { const r = byId.get(Number(id)); if (r) r.seen++; }
    res.writeHead(204); return res.end();
  }

  if (p === "/api/staff/photos" && m === "GET") return json(res, 200, records.map(shortRecord));

  if (p === "/api/staff/photos" && m === "PATCH") {
    const b = await readBody(req);
    const ids = Array.isArray(b.ids) ? b.ids.map(Number) : [];
    const patch = b.patch || {};
    const now = new Date().toISOString();
    const updated = [];
    for (const id of ids) {
      const r = byId.get(id);
      if (!r) continue;
      if (typeof patch.public === "boolean") r.public = patch.public;
      if (typeof patch.addTag === "string" && patch.addTag.trim() && !r.tags.includes(patch.addTag.trim())) r.tags = [...r.tags, patch.addTag.trim()];
      r.updatedAt = now;
      updated.push(shortRecord(r));
    }
    for (const id of ids) { const r = byId.get(id); if (r) broadcast("updated", r); }
    return json(res, 200, { updated });
  }

  if ((mm = p.match(/^\/api\/staff\/photos\/(\d+)$/)) && m === "PATCH") {
    const r = byId.get(Number(mm[1]));
    if (!r) return json(res, 404, { error: "not found" });
    const b = await readBody(req);
    if ("title" in b) {
      const t = typeof b.title === "string" ? b.title.trim() : "";
      if (!t) return json(res, 422, { errors: { title: "タイトルを入力してください。" } });
      if (t.length > 60) return json(res, 422, { errors: { title: "タイトルは60文字以内にしてください。" } });
      r.title = t;
    }
    if (Array.isArray(b.tags)) r.tags = b.tags.map(String);
    if (typeof b.public === "boolean") r.public = b.public;
    r.updatedAt = new Date().toISOString();
    broadcast("updated", r);
    return json(res, 200, shortRecord(r));
  }

  if (p === "/api/staff/events" && m === "GET") {
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.write(": connected\n\n");
    sseClients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 15000);
    req.on("close", () => { clearInterval(ping); sseClients.delete(res); });
    return;
  }

  return json(res, 404, { error: "no such endpoint" });
}

async function handleImg(req, res, url, id) {
  const r = byId.get(id);
  if (!r) { res.writeHead(404); return res.end(); }
  const allowed = [160, 320, 640, 1280];
  const w = allowed.includes(Number(url.searchParams.get("w"))) ? Number(url.searchParams.get("w")) : 320;
  res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" });
  res.end(svgFor(r, w));
}

// ---------------------------------------------------------------- the pages
// WCS_LOCAL=1: the esm.run lines become the repository's bundles (served below from packages/). The table's page
// names its modules in an import map — `@wcstack/signals/dom` as well as the `/auto` entries — so the rewrite
// resolves `https://esm.run/@wcstack/<pkg>[/<subpath>]` through the package's own `exports` map.
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

function html(res, body) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
  res.end(body);
  return true;
}

createDemoServer({
  port: PORT,
  root: PUBLIC,
  async api(req, res, url) {
    const { pathname } = url;

    // ---- WCS_LOCAL=1: the bundles the pages name instead of esm.run ----
    if (LOCAL && req.method === "GET" && pathname.startsWith("/packages/")) {
      const file = resolve(REPO_ROOT, "." + pathname);
      if (!file.startsWith(join(REPO_ROOT, "packages"))) { res.writeHead(403); res.end("Forbidden"); return true; }
      const body = await readFile(file).catch(() => null);
      if (!body) { res.writeHead(404); res.end("Not found"); return true; }
      res.writeHead(200, { "Content-Type": file.endsWith(".map") ? "application/json" : "text/javascript; charset=utf-8" });
      res.end(body);
      return true;
    }

    const isApi = pathname.startsWith("/api/");
    const imgMatch = pathname.match(/^\/img\/(\d+)$/);
    try {
      if ((isApi && !pathname.startsWith("/api/_test/")) || imgMatch) {
        const entry = { t: Date.now(), method: req.method, path: pathname, query: url.search.replace(/^\?/, "") };
        log.push(entry);
        if (req.method !== "GET" && pathname !== "/api/staff/events") {
          // Keep the body for the log: the handler reads it again through a buffered copy.
          const chunks = [];
          for await (const c of req) chunks.push(c);
          const text = Buffer.concat(chunks).toString("utf8");
          try { entry.body = text ? JSON.parse(text) : undefined; } catch { entry.body = text; }
          req[Symbol.asyncIterator] = async function* () { yield Buffer.from(text); };
        }
        const delay = Number(url.searchParams.get("delay")) || 0;
        if (delay > 0) await sleep(Math.min(delay, 30000));
        const failStatus = failFor(pathname, url.search);
        if (failStatus) { json(res, failStatus, { error: "injected failure" }); return true; }
        if (imgMatch) { await handleImg(req, res, url, Number(imgMatch[1])); return true; }
        await handleApi(req, res, url);
        return true;
      }
      if (isApi) { await handleApi(req, res, url); return true; }
    } catch (e) {
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: String(e) });
      else res.end();
      return true;
    }

    // ---- the pages: the table at /staff, and every other extensionless GET is the public site (history fallback)
    if (req.method === "GET" && (pathname === "/staff" || pathname === "/staff/")) return html(res, await page("staff.html"));
    if (req.method === "GET" && extname(pathname) === "") return html(res, await page("index.html"));
    return false; // css/, js/: the shared static files from public/
  },
  notes: [
    ...(LOCAL ? ["WCS_LOCAL=1: esm.run lines rewritten to the local packages/*/dist"] : []),
    "The public site: / — the cataloguers' table: /staff",
  ],
});
