/**
 * Demo server for street-reports — みどり市 道路・公園の不具合 受付台帳: the staff's ledger of problem reports from
 * citizens, in Japanese. A React team's app moved to wcstack (the React original is in react-original/, for
 * reading): a list filtered through the URL, a report with comments and a photo lightbox, a form with a draft and a
 * leave dialog, a board with live moves, statistics — state + router + fetch + storage + debounce + sse + autoloader.
 *
 *   node examples/street-reports/server.js                http://localhost:3000/ (PORT=… to change)
 *   WCS_LOCAL=1 node examples/street-reports/server.js    the repository's packages/*\/dist instead of esm.run
 *
 * Node built-ins only (and examples/shared/server.js): nothing to install to run it. The data is generated in
 * memory from a fixed seed and a fixed clock (2026-11-20 09:00 in Japan), so every start (and every
 * POST /api/_test/reset) gives the same reports.
 *
 * API:
 *   GET   /api/staff
 *   GET   /api/reports?status=&category=&q=&assignee=&sort=&page=&per=   → { items, total, page, per }
 *   GET   /api/reports/summary | /board | /export?from=&to=
 *   GET   /api/reports/:id                               → the report with prevId / nextId | 404
 *   POST  /api/reports                                   → 201 the report | 422 { errors }
 *   PATCH /api/reports/:id { version, status?, assigneeId?, priority? }   → the report | 409 { report } | 404
 *   POST  /api/reports/bulk { ids, patch }               → { updated }
 *   GET / POST /api/reports/:id/comments
 *   GET   /api/events                                    server-sent events: report (the changed report)
 *   GET   /photos/<n>.svg
 *   Every /api/* request may add ?delay=<ms> (answer later).
 *
 * Test hooks (used by e2e/tests/street-reports.spec.ts):
 *   POST /api/_test/reset                                the seed again; the log, the rules and the clock reset
 *   POST /api/_test/fail { path, method?, status, times }      the next matching requests fail
 *   POST /api/_test/delay { path, method?, query?, ms, times } the next matching requests answer late
 *   POST /api/_test/clock { now }                        the server's clock
 *   GET  /api/_test/log                                  every API request since the last reset, and the streams
 */
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDemoServer } from "../shared/server.js";
import { createSeed, SUBCATEGORIES, PHOTO_COUNT } from "./data.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC = join(__dirname, "public");
const REPO_ROOT = resolve(__dirname, "..", "..");
const PORT = Number(process.env.PORT || 3000);
const LOCAL = process.env.WCS_LOCAL === "1";

const STATUSES = ['new', 'triaged', 'assigned', 'done'];
const CATEGORIES = Object.keys(SUBCATEGORIES);
const DAY = 24 * 3600 * 1000;
const BOARD_LIMIT = 80;

// ---------------------------------------------------------------- state
let db;
let log;
let failures;
let delays;
let generation = 0; // bumps on reset; SSE connections from older generations are not logged
const sseClients = new Set();

function reset() {
  db = createSeed();
  log = [];
  failures = [];
  delays = [];
  generation += 1;
  for (const client of sseClients) client.res.end();
  sseClients.clear();
}
reset();

const nowIso = () => db.now;
const nowMs = () => Date.parse(db.now);

// ---------------------------------------------------------------- helpers
function send(res, status, body) {
  const json = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(json);
}

function lightweight(report) {
  const { description, photos, closedAt, ...rest } = report;
  return rest;
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      if (!raw) return resolve(undefined);
      try { resolve(JSON.parse(raw)); } catch { resolve({ __invalid: raw }); }
    });
  });
}

function matches(rule, method, pathname, query) {
  if (rule.path !== pathname) return false;
  if (rule.method && rule.method.toUpperCase() !== method) return false;
  if (rule.query) {
    for (const [k, v] of Object.entries(rule.query)) if (query[k] !== String(v)) return false;
  }
  return true;
}

function takeRule(list, method, pathname, query) {
  const rule = list.find((r) => r.times > 0 && matches(r, method, pathname, query));
  if (!rule) return null;
  rule.times -= 1;
  return rule;
}

const isDateOnly = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00+09:00`));
const isOpen = (r) => r.status !== 'done';
const staffExists = (id) => db.staff.some((s) => s.id === id);

function broadcast(report) {
  const payload = `event: report\ndata: ${JSON.stringify(lightweight(report))}\n\n`;
  for (const client of sseClients) client.res.write(payload);
}

function applyPatch(report, patch) {
  if (patch.status !== undefined && patch.status !== report.status) {
    report.status = patch.status;
    report.closedAt = patch.status === 'done' ? nowIso() : null;
  }
  if (patch.assigneeId !== undefined) report.assigneeId = patch.assigneeId;
  if (patch.priority !== undefined) report.priority = patch.priority;
  report.updatedAt = nowIso();
  report.version += 1;
}

function validatePatch(patch) {
  const errors = {};
  if (!patch || typeof patch !== 'object') return { patch: 'invalid' };
  if (patch.status !== undefined && !STATUSES.includes(patch.status)) errors.status = '状態が不正です';
  if (patch.assigneeId !== undefined && patch.assigneeId !== null && !staffExists(patch.assigneeId)) errors.assigneeId = '担当者が不正です';
  if (patch.priority !== undefined && ![1, 2, 3].includes(patch.priority)) errors.priority = '優先度が不正です';
  return errors;
}

function validateNewReport(b) {
  const errors = {};
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  if (!str(b.title)) errors.title = '件名を入力してください';
  else if (str(b.title).length > 60) errors.title = '件名は60文字以内で入力してください';
  if (!CATEGORIES.includes(b.category)) errors.category = 'カテゴリを選択してください';
  else if (!SUBCATEGORIES[b.category].includes(b.subcategory)) errors.subcategory = '種別を選択してください';
  if (!str(b.district)) errors.district = '地区を選択してください';
  if (!str(b.address)) errors.address = '住所を入力してください';
  else if (db.reports.some((r) => isOpen(r) && r.address === str(b.address))) errors.address = '同じ住所で対応中の通報がすでにあります';
  const desc = str(b.description);
  if (desc.length < 10) errors.description = '詳細は10文字以上で入力してください';
  else if (desc.length > 1000) errors.description = '詳細は1000文字以内で入力してください';
  if (![1, 2, 3].includes(b.priority)) errors.priority = '優先度を選択してください';
  if (!b.anonymous) {
    if (!str(b.reporterName)) errors.reporterName = '通報者名を入力してください';
    if (b.reporterPhone && !/^[0-9-]+$/.test(b.reporterPhone)) errors.reporterPhone = '電話番号は数字とハイフンで入力してください';
  }
  return errors;
}

// ---------------------------------------------------------------- API routes
function listReports(query) {
  let items = db.reports.slice();
  if (query.status) items = items.filter((r) => r.status === query.status);
  if (query.category) items = items.filter((r) => r.category === query.category);
  if (query.assignee) {
    items = query.assignee === 'none'
      ? items.filter((r) => r.assigneeId === null)
      : items.filter((r) => r.assigneeId === Number(query.assignee));
  }
  if (query.q) {
    const q = query.q.trim().toLowerCase();
    items = items.filter((r) => [r.title, r.address, r.district].some((f) => f.toLowerCase().includes(q)));
  }
  const sort = query.sort || '-reportedAt';
  const byNewest = (a, b) => b.reportedAt.localeCompare(a.reportedAt) || b.id - a.id;
  if (sort === 'reportedAt') items.sort((a, b) => -byNewest(a, b));
  else if (sort === '-priority') items.sort((a, b) => b.priority - a.priority || byNewest(a, b));
  else items.sort(byNewest);
  const per = Math.min(100, Math.max(1, Number(query.per) || 20));
  const page = Math.max(1, Number(query.page) || 1);
  return {
    items: items.slice((page - 1) * per, page * per).map(lightweight),
    total: items.length,
    page,
    per,
  };
}

async function handleApi(req, res, url, pathname, query, body) {
  const method = req.method;
  const seg = pathname.split('/').filter(Boolean); // ['api', ...]

  if (method === 'GET' && pathname === '/api/staff') return send(res, 200, db.staff);

  if (method === 'GET' && pathname === '/api/reports') return send(res, 200, listReports(query));

  if (method === 'GET' && pathname === '/api/reports/summary') {
    const summary = { new: 0, triaged: 0, assigned: 0, done: 0 };
    for (const r of db.reports) summary[r.status] += 1;
    return send(res, 200, summary);
  }

  if (method === 'GET' && pathname === '/api/reports/board') {
    const weekAgo = nowMs() - 7 * DAY;
    const items = db.reports
      .filter((r) => isOpen(r) || (r.closedAt && Date.parse(r.closedAt) >= weekAgo))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)
      .slice(0, BOARD_LIMIT)
      .map(lightweight);
    return send(res, 200, items);
  }

  if (method === 'GET' && pathname === '/api/reports/export') {
    if (!isDateOnly(query.from) || !isDateOnly(query.to)) return send(res, 400, { error: 'from と to (YYYY-MM-DD) が必要です' });
    const from = Date.parse(`${query.from}T00:00:00+09:00`);
    const to = Date.parse(`${query.to}T00:00:00+09:00`) + DAY;
    const items = db.reports
      .filter((r) => { const t = Date.parse(r.reportedAt); return t >= from && t < to; })
      .map((r) => ({ ...lightweight(r), ...(r.status === 'done' ? { closedAt: r.closedAt } : {}) }));
    return send(res, 200, items);
  }

  if (method === 'POST' && pathname === '/api/reports') {
    const b = body && typeof body === 'object' ? body : {};
    const errors = validateNewReport(b);
    if (Object.keys(errors).length) return send(res, 422, { errors });
    const id = db.reports.reduce((m, r) => Math.max(m, r.id), 0) + 1;
    const report = {
      id,
      title: b.title.trim(),
      category: b.category,
      subcategory: b.subcategory,
      status: 'new',
      priority: b.priority,
      district: b.district.trim(),
      address: b.address.trim(),
      description: b.description.trim(),
      reportedAt: nowIso(),
      updatedAt: nowIso(),
      assigneeId: null,
      anonymous: Boolean(b.anonymous),
      photos: [],
      version: 1,
      closedAt: null,
    };
    if (!report.anonymous) {
      report.reporterName = b.reporterName.trim();
      if (b.reporterPhone) report.reporterPhone = b.reporterPhone;
    }
    db.reports.push(report);
    broadcast(report);
    const { closedAt, ...out } = report;
    return send(res, 201, out);
  }

  if (method === 'POST' && pathname === '/api/reports/bulk') {
    const ids = body?.ids;
    const patch = body?.patch;
    if (!Array.isArray(ids) || ids.length === 0) return send(res, 422, { errors: { ids: '対象がありません' } });
    const patchErrors = validatePatch(patch);
    if (Object.keys(patchErrors).length) return send(res, 422, { errors: patchErrors });
    const targets = ids.map((id) => db.reports.find((r) => r.id === id));
    if (targets.some((t) => !t)) return send(res, 404, { error: '存在しない通報が含まれています' });
    const clean = { status: patch.status, assigneeId: patch.assigneeId };
    for (const t of targets) applyPatch(t, clean);
    for (const t of targets) broadcast(t);
    return send(res, 200, { updated: targets.map(lightweight) });
  }

  if (seg[1] === 'reports' && seg[2] && seg.length <= 4) {
    const id = /^\d+$/.test(seg[2]) ? Number(seg[2]) : NaN;
    const report = db.reports.find((r) => r.id === id);
    const sub = seg[3];

    if (!sub && method === 'GET') {
      if (!report) return send(res, 404, { error: '通報が見つかりません' });
      const ids = db.reports.map((r) => r.id).sort((a, b) => a - b);
      const i = ids.indexOf(id);
      const { closedAt, ...out } = report;
      return send(res, 200, { ...out, prevId: ids[i - 1] ?? null, nextId: ids[i + 1] ?? null });
    }

    if (!sub && method === 'PATCH') {
      if (!report) return send(res, 404, { error: '通報が見つかりません' });
      const b = body && typeof body === 'object' ? body : {};
      const { closedAt, ...current } = report;
      if (b.version !== report.version) return send(res, 409, { report: current });
      const { version, ...patch } = b;
      const errors = validatePatch(patch);
      if (Object.keys(errors).length) return send(res, 422, { errors });
      applyPatch(report, { status: patch.status, assigneeId: patch.assigneeId, priority: patch.priority });
      broadcast(report);
      const { closedAt: _c, ...out } = report;
      return send(res, 200, out);
    }

    if (sub === 'comments') {
      if (!report) return send(res, 404, { error: '通報が見つかりません' });
      if (method === 'GET') {
        const list = db.comments
          .filter((c) => c.reportId === id)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
        return send(res, 200, list);
      }
      if (method === 'POST') {
        const text = typeof body?.body === 'string' ? body.body.trim() : '';
        if (!text) return send(res, 422, { errors: { body: 'コメントを入力してください' } });
        if (text.length > 500) return send(res, 422, { errors: { body: 'コメントは500文字以内で入力してください' } });
        if (!staffExists(body.authorId)) return send(res, 422, { errors: { authorId: '投稿者が不正です' } });
        const comment = {
          id: db.comments.reduce((m, c) => Math.max(m, c.id), 0) + 1,
          reportId: id,
          authorId: body.authorId,
          body: text,
          createdAt: nowIso(),
        };
        db.comments.push(comment);
        return send(res, 201, comment);
      }
    }
  }

  return send(res, 404, { error: 'Not found' });
}

function handleTest(req, res, pathname, body) {
  const b = body && typeof body === 'object' ? body : {};
  if (req.method === 'POST' && pathname === '/api/_test/reset') { reset(); return send(res, 200, { ok: true }); }
  if (req.method === 'GET' && pathname === '/api/_test/log') return send(res, 200, log);
  if (req.method === 'POST' && pathname === '/api/_test/fail') {
    failures.push({ path: b.path, method: b.method, query: b.query, status: Number(b.status) || 500, times: Number(b.times) || 1 });
    return send(res, 200, { ok: true });
  }
  if (req.method === 'POST' && pathname === '/api/_test/delay') {
    delays.push({ path: b.path, method: b.method, query: b.query, ms: Number(b.ms) || 0, times: Number(b.times) || 1 });
    return send(res, 200, { ok: true });
  }
  if (req.method === 'POST' && pathname === '/api/_test/clock') {
    if (Number.isNaN(Date.parse(b.now))) return send(res, 422, { errors: { now: 'invalid date' } });
    db.now = new Date(b.now).toISOString();
    return send(res, 200, { now: db.now });
  }
  return send(res, 404, { error: 'Not found' });
}

function openEvents(req, res) {
  const gen = generation;
  const client = { res };
  log.push({ sse: 'open', at: new Date().toISOString() });
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  res.write('retry: 1000\n\n');
  sseClients.add(client);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  ping.unref();
  req.on('close', () => {
    clearInterval(ping);
    sseClients.delete(client);
    if (gen === generation) log.push({ sse: 'close', at: new Date().toISOString() });
  });
}

// ---------------------------------------------------------------- static
function photoSvg(n) {
  const hue = (n * 47) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
<rect width="320" height="240" fill="hsl(${hue} 45% 55%)"/>
<circle cx="250" cy="60" r="28" fill="hsl(${hue} 60% 80%)"/>
<path d="M0 200 L90 120 L160 180 L230 110 L320 190 L320 240 L0 240 Z" fill="hsl(${hue} 35% 35%)"/>
<text x="20" y="40" font-size="26" font-family="sans-serif" fill="#fff">写真 ${n}</text>
</svg>`;
}

// ---------------------------------------------------------------- the API
async function api(req, res, url, pathname) {
  const query = Object.fromEntries(url.searchParams);
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);

  if (pathname.startsWith('/api/_test/')) return handleTest(req, res, pathname, body);

  if (pathname === '/api/events' && req.method === 'GET') return openEvents(req, res);

  // Requests made by the e2e suite itself (to compute expectations) can opt out of the log.
  if (!req.headers['x-test-no-log']) {
    log.push({ method: req.method, path: pathname, query, body: body ?? null, at: new Date().toISOString() });
  }
  const gen = generation;

  let wait = Number(query.delay) || 0;
  const delayRule = takeRule(delays, req.method, pathname, query);
  if (delayRule) wait = Math.max(wait, delayRule.ms);
  const failRule = takeRule(failures, req.method, pathname, query);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  if (res.destroyed || gen !== generation) { if (!res.destroyed) send(res, 503, { error: 'reset' }); return; }

  if (failRule) return send(res, failRule.status, { error: `injected failure (${failRule.status})` });
  if (body && body.__invalid !== undefined) return send(res, 400, { error: 'invalid JSON' });
  try {
    await handleApi(req, res, url, pathname, query, body);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: 'internal error' });
  }
}

// ---------------------------------------------------------------- the page
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

async function page() {
  const html = await readFile(join(PUBLIC, "index.html"), "utf8");
  if (!LOCAL) return html;
  return html.replace(
    /https:\/\/esm\.run\/@wcstack\/([\w-]+)((?:\/[\w-]+)*)(?=["'\s])/g,
    (match, pkg, subpath) => localEntry(pkg, subpath) ?? match,
  );
}

const HTML = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" };

createDemoServer({
  port: PORT,
  root: PUBLIC,
  async api(req, res, url) {
    const pathname = url.pathname;
    try {
      if (pathname.startsWith("/api/")) { await api(req, res, url, pathname); return true; }

      const photo = /^\/photos\/(\d+)\.svg$/.exec(pathname);
      if (photo) {
        const n = Number(photo[1]);
        if (n < 1 || n > PHOTO_COUNT) { res.writeHead(404); res.end(); return true; }
        res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" });
        res.end(photoSvg(n));
        return true;
      }

      // ---- WCS_LOCAL=1: the bundles the page names instead of esm.run ----
      if (LOCAL && req.method === "GET" && pathname.startsWith("/packages/")) {
        const file = resolve(REPO_ROOT, "." + pathname);
        if (!file.startsWith(join(REPO_ROOT, "packages"))) { res.writeHead(403); res.end("Forbidden"); return true; }
        const content = await readFile(file).catch(() => null);
        if (!content) { res.writeHead(404); res.end("Not found"); return true; }
        res.writeHead(200, { "Content-Type": file.endsWith(".map") ? "application/json" : "text/javascript; charset=utf-8" });
        res.end(content);
        return true;
      }

      // every path without an extension is the app (/reports/12, /board — the history fallback)
      if (req.method === "GET" && (pathname === "/" || pathname === "/index.html" || extname(pathname) === "")) {
        res.writeHead(200, HTML);
        res.end(await page());
        return true;
      }
    } catch (e) {
      console.error(e);
      if (!res.headersSent) send(res, 500, { error: "internal error" });
      else res.end();
      return true;
    }
    return false; // the state, the parts, lib/, the styles: the shared server serves the file
  },
  notes: [
    ...(LOCAL ? ["WCS_LOCAL=1: esm.run lines rewritten to the local packages/*/dist"] : []),
    "The app: / — the React original (source only): examples/street-reports/react-original/",
  ],
});
