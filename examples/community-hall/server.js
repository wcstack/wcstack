// みどり市民会館 — the CMS (templates + htmx fragments), its API, and the partner inn's site on a second port.
// Node built-ins only; data in memory. htmx, Turbo and the inn's wcstack 4.17.0 come from this example's
// node_modules (npm install).
//
//   node examples/community-hall/server.js              hall http://localhost:5621, inn :5622 (HALL_PORT / INN_PORT)
//   WCS_LOCAL=1 node examples/community-hall/server.js  the hall's and the widget's wcstack from the repository's
//                                                        packages/*/dist instead of esm.run; the inn's 4.17.0 from
//                                                        node_modules (state-4.17.0)
//
// Test hooks: ?delay=<ms> on /api/* and the fragments; POST /api/_test/fail { path, status, times },
// /api/_test/seats { id, remaining }, /api/_test/reset.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(ROOT, "..", "..");
const LOCAL = process.env.WCS_LOCAL === "1";
const HALL_PORT = Number(process.env.HALL_PORT || 5621);
const INN_PORT = Number(process.env.INN_PORT || 5622);
const HOST = "localhost";
const HALL_ORIGIN = `http://${HOST}:${HALL_PORT}`;
const INN_ORIGIN = `http://${HOST}:${INN_PORT}`;

// ---------------------------------------------------------------------------------------------------------------
// render(template, data): {{field}} escaped, {{{field}}} raw, {{#each list}}…{{/each}}, {{> partial}}.
// Templates are read from disk on every render, so an edit by the CMS team shows on the next request.
// ---------------------------------------------------------------------------------------------------------------
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function lookup(stack, name) {
  if (name === ".") return stack[stack.length - 1];
  for (let i = stack.length - 1; i >= 0; i--) {
    let v = stack[i];
    let found = true;
    for (const part of name.split(".")) {
      if (v != null && typeof v === "object" && part in v) v = v[part];
      else { found = false; break; }
    }
    if (found) return v;
  }
  return undefined;
}

export function render(template, data, dir = path.join(ROOT, "templates")) {
  const load = (name) => fs.readFileSync(path.join(dir, `${name}.html`), "utf8");
  const run = (src, stack) => {
    let out = "";
    let i = 0;
    const re = /\{\{(\{?)\s*([#\/>]?)\s*([\w.@-]*)\s*(?:([\w.]+)\s*)?\}?\}\}/g;
    let m;
    while ((m = re.exec(src))) {
      out += src.slice(i, m.index);
      i = re.lastIndex;
      const [, raw, sigil, a, b] = m;
      if (sigil === ">") { out += run(load(a), stack); continue; }
      if (sigil === "#" && a === "each") {
        // find the matching {{/each}}, counting nested ones
        let depth = 1, j = i, end = -1;
        const tag = /\{\{\s*([#\/])each\b[^}]*\}\}/g;
        tag.lastIndex = i;
        let t;
        while ((t = tag.exec(src))) {
          depth += t[1] === "#" ? 1 : -1;
          if (depth === 0) { end = t.index; j = tag.lastIndex; break; }
        }
        if (end < 0) throw new Error(`render: {{#each ${b}}} without {{/each}}`);
        const list = lookup(stack, b) || [];
        list.forEach((item, index) => { out += run(src.slice(i, end), [...stack, { "@index": index }, item]); });
        i = j;
        re.lastIndex = j;
        continue;
      }
      const v = lookup(stack, a);
      out += raw ? (v ?? "") : esc(v);
    }
    return out + src.slice(i);
  };
  return run(load(template), [data]);
}

// ---------------------------------------------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------------------------------------------
const CATEGORIES = ["音楽", "講座", "子ども", "展示"];
const TITLES = {
  音楽: ["ピアノ・リサイタル", "市民吹奏楽団 定期演奏会", "ジャズ・ナイト", "弦楽四重奏の午後", "合唱フェスティバル", "ギター弾き語りライブ", "和太鼓コンサート", "童謡を歌う会", "オルガン名曲選", "ゴスペル・ワークショップ"],
  講座: ["はじめての水彩画", "スマホ活用講座", "やさしい家計簿", "歴史散歩 みどり市の昔", "写真教室", "防災講座", "英会話入門", "書道教室", "健康体操", "料理教室 季節の和食"],
  子ども: ["親子リトミック", "こども科学教室", "絵本の読み聞かせ", "こどもプログラミング", "工作教室", "人形劇", "こども将棋大会", "紙芝居の会", "親子ダンス", "こども映画会"],
  展示: ["市民美術展", "写真展 みどりの四季", "陶芸作品展", "書道展", "手づくり作品展", "郷土資料展", "絵画サークル展", "生け花展", "鉄道模型展", "子ども絵画展"],
};
const VENUES = { 音楽: ["大ホール", "小ホール"], 講座: ["会議室A", "会議室B", "和室"], 子ども: ["小ホール", "多目的室"], 展示: ["展示室"] };
const PRICES = { 音楽: [2000, 1000, 1500], 講座: [800, 400, 600], 子ども: [500, 300, 400], 展示: [300, 0, 200] };

function tokyoDateParts(d) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(d); // YYYY-MM-DD
}
function seedEvents() {
  const today = new Date(tokyoDateParts(new Date()) + "T00:00:00+09:00");
  let r = 7;
  const rnd = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
  const events = [];
  for (let i = 0; i < 40; i++) {
    const category = CATEGORIES[i % 4];
    const title = TITLES[category][Math.floor(i / 4)];
    const dayOffset = 1 + Math.floor((i * 89) / 40) + (i % 3);
    const hour = [10, 13, 14, 18][i % 4];
    const d = new Date(today.getTime() + dayOffset * 86400000);
    const date = `${tokyoDateParts(d)}T${String(hour).padStart(2, "0")}:00:00+09:00`;
    const capacity = [300, 40, 30, 120][i % 4] + Math.floor(rnd() * 3) * 10;
    let remaining = Math.floor(capacity * (0.2 + rnd() * 0.7));
    if ([2, 6, 13].includes(i + 1)) remaining = 2;   // nearly sold out
    if (i + 1 === 9) remaining = 1;
    if (i + 1 === 17) remaining = 0;                // sold out
    const [adult, child, senior] = PRICES[category];
    events.push({
      id: i + 1, title, category, date,
      venue: VENUES[category][i % VENUES[category].length],
      summary: `${title}。みどり市民会館${VENUES[category][i % VENUES[category].length]}で開催します。どなたでもご参加いただけます。`,
      prices: { adult, child, senior }, capacity, remaining,
    });
  }
  return events;
}
const NEWS = [
  { date: "2026-11-01", title: "年末年始の休館日のお知らせ" },
  { date: "2026-10-20", title: "大ホールの座席を一部改修しました" },
  { date: "2026-10-05", title: "オンライン予約を始めました" },
];

let events = seedEvents();
let bookings = [];
let bookingSeq = 100;
const failRules = new Map(); // path -> { status, times }
const sseClients = new Set();

const byId = (id) => events.find((e) => e.id === Number(id));
function setRemaining(ev, remaining) {
  ev.remaining = Math.max(0, Math.min(ev.capacity, remaining));
  const msg = `event: seats\ndata: ${JSON.stringify({ id: ev.id, remaining: ev.remaining })}\n\n`;
  for (const res of sseClients) res.write(msg);
}

// ---------------------------------------------------------------------------------------------------------------
// View helpers
// ---------------------------------------------------------------------------------------------------------------
const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
function dateLabel(iso) {
  const d = new Date(iso);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(d).map((x) => [x.type, x.value]));
  const wd = WEEK[["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday)];
  return `${p.year}年${p.month}月${p.day}日（${wd}）${p.hour}:${p.minute}`;
}
const yen = (n) => (n === 0 ? "無料" : `${n.toLocaleString("ja-JP")}円`);
function view(ev) {
  return {
    ...ev, dateLabel: dateLabel(ev.date), soldOut: ev.remaining === 0,
    soldOutHidden: ev.remaining === 0 ? "hidden" : "", seatsHidden: ev.remaining === 0 ? "" : "hidden",
    priceAdult: yen(ev.prices.adult), priceChild: yen(ev.prices.child), priceSenior: yen(ev.prices.senior),
  };
}
function seatsSnapshot() {
  const o = {};
  for (const e of events) o[`e${e.id}`] = e.remaining;
  return o;
}

function parseQuery(sp) {
  const q = (sp.get("q") || "").trim();
  const cat = CATEGORIES.includes(sp.get("cat")) ? sp.get("cat") : "";
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("from") || "") ? sp.get("from") : "";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("to") || "") ? sp.get("to") : "";
  const available = sp.get("available") === "1";
  const sort = sp.get("sort") === "title" ? "title" : "date";
  const page = Math.max(1, Math.min(10, parseInt(sp.get("page") || "1", 10) || 1));
  return { q, cat, from, to, available, sort, page };
}
function queryString(f, page = f.page) {
  const sp = new URLSearchParams();
  if (f.q) sp.set("q", f.q);
  if (f.cat) sp.set("cat", f.cat);
  if (f.from) sp.set("from", f.from);
  if (f.to) sp.set("to", f.to);
  if (f.available) sp.set("available", "1");
  if (f.sort !== "date") sp.set("sort", f.sort);
  if (page > 1) sp.set("page", String(page));
  const s = sp.toString();
  return s ? `?${s}` : "";
}
function search(f) {
  let list = events.filter((e) => {
    if (f.q && !(e.title.includes(f.q) || e.summary.includes(f.q) || e.category.includes(f.q))) return false;
    if (f.cat && e.category !== f.cat) return false;
    const day = e.date.slice(0, 10);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    if (f.available && e.remaining === 0) return false;
    return true;
  });
  list = f.sort === "title" ? list.toSorted((a, b) => a.title.localeCompare(b.title, "ja")) : list.toSorted((a, b) => a.date.localeCompare(b.date));
  return list;
}
const PAGE_SIZE = 10;
function resultsData(f, { from = 1 } = {}) {
  const all = search(f);
  const shown = all.slice((from - 1) * PAGE_SIZE, f.page * PAGE_SIZE).map(view);
  const hasMore = all.length > f.page * PAGE_SIZE;
  return {
    events: shown, total: all.length, hasMore, empty: all.length === 0 ? [{}] : [],
    moreUrl: `/events/results${queryString(f, f.page + 1)}`, morePush: `/events${queryString(f, f.page + 1)}`,
    moreList: hasMore ? [{}] : [],
  };
}
function filterState(f) {
  return { q: f.q, cat: f.cat, from: f.from, to: f.to, available: f.available, sort: f.sort };
}

// ---------------------------------------------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------------------------------------------
function send(res, status, body, headers = {}) {
  res.writeHead(status, { "cache-control": "no-store", ...headers });
  res.end(body);
}
// WCS_LOCAL=1: the esm.run lines become the repository's bundles (the hall serves /packages/), and the inn's pinned
// 4.17.0 the published copy in node_modules (the inn serves /vendor/state-4.17.0/)
function local(text) {
  if (!LOCAL) return text;
  return text
    .replace(/https:\/\/esm\.run\/@wcstack\/state@4\.17\.0\/auto/g, "/vendor/state-4.17.0/auto.min.js")
    .replace(/https:\/\/esm\.run\/@wcstack\/([\w-]+)\/auto/g, (_m, pkg) => `${HALL_ORIGIN}/packages/${pkg}/dist/auto.min.js`)
    .replace(/https:\/\/esm\.run\/@wcstack\/([\w-]+)"/g, (_m, pkg) => `${HALL_ORIGIN}/packages/${pkg}/dist/index.esm.js"`);
}
const html = (res, status, body, headers = {}) => send(res, status, local(body), { "content-type": "text/html; charset=utf-8", ...headers });
function json(req, res, status, data) {
  send(res, status, JSON.stringify(data), { "content-type": "application/json; charset=utf-8", ...cors(req) });
}
function cors(req) {
  const origin = req.headers.origin;
  if (origin === INN_ORIGIN || origin === HALL_ORIGIN) {
    return { "access-control-allow-origin": origin, vary: "Origin" };
  }
  return {};
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString("utf8");
  try { return s ? JSON.parse(s) : {}; } catch { return null; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json" };
function serveFile(req, res, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const body = path.extname(file) === ".js" && file.startsWith(path.join(ROOT, "public")) ? local(fs.readFileSync(file, "utf8")) : fs.readFileSync(file);
  send(res, 200, body, {
    "content-type": MIME[path.extname(file)] || "application/octet-stream",
    // the widget's files are loaded by the partner's pages (another origin)
    "access-control-allow-origin": "*",
  });
  return true;
}
const VENDOR = {
  "/vendor/htmx.min.js": path.join(ROOT, "node_modules/htmx.org/dist/htmx.min.js"),
  "/vendor/turbo.js": path.join(ROOT, "node_modules/@hotwired/turbo/dist/turbo.es2017-esm.js"),
};

// ---------------------------------------------------------------------------------------------------------------
// Hall pages
// ---------------------------------------------------------------------------------------------------------------
function page(res, { title, template, data, nav, seed = {}, status = 200, headers = {} }) {
  const content = render(template, data);
  const body = render("layout", {
    pageTitle: title, content, pageSeed: JSON.stringify({ seats: seatsSnapshot(), ...seed }).replace(/</g, "\u003c"),
    navHome: nav === "home" ? "page" : "false", navEvents: nav === "events" ? "page" : "false", navMy: nav === "my" ? "page" : "false",
  });
  html(res, status, body, headers);
}
function eventsPage(res, f) {
  page(res, {
    title: "イベント一覧", template: "events", nav: "events", seed: { filter: filterState(f) },
    data: {
      ...resultsData(f), ...f,
      catOptions: CATEGORIES.map((c) => ({ value: c, checked: f.cat === c ? "checked" : "" })),
      catAll: f.cat ? "" : "checked", availableChecked: f.available ? "checked" : "",
      sortDate: f.sort === "date" ? "selected" : "", sortTitle: f.sort === "title" ? "selected" : "",
      hidNone: f.cat || f.from || f.to || f.available || f.sort === "title" ? "" : "hidden",
      hidDates: f.from || f.to ? "" : "hidden", hidAvail: f.available ? "" : "hidden", hidSort: f.sort === "title" ? "" : "hidden",
    },
  });
}
function eventPage(res, ev) {
  page(res, {
    title: ev.title, template: "event", nav: "events",
    data: view(ev), seed: { booking: { eventId: ev.id, prices: ev.prices } },
  });
}

async function hall(req, res) {
  const url = new URL(req.url, HALL_ORIGIN);
  const p = url.pathname;
  const isHx = req.headers["hx-request"] === "true" && req.headers["hx-history-restore-request"] !== "true";

  const delay = Number(url.searchParams.get("delay") || 0);
  const isFragment = /^\/events\/results$/.test(p) || /^\/events\/\d+\/booking$/.test(p);
  if (delay && (p.startsWith("/api/") || isFragment)) await sleep(Math.min(delay, 20000));

  if (req.method === "OPTIONS" && p.startsWith("/api/")) {
    return send(res, 204, "", { ...cors(req), "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "600" });
  }

  // test hooks: make the next requests to a path fail
  const rule = failRules.get(p);
  if (rule && !p.startsWith("/api/_test/")) {
    rule.times -= 1;
    if (rule.times <= 0) failRules.delete(p);
    return p.startsWith("/api/")
      ? json(req, res, rule.status, { error: "test-failure" })
      : html(res, rule.status, "<p>サーバーエラー（テスト）</p>");
  }

  if (p.startsWith("/api/")) return api(req, res, url);

  if (VENDOR[p]) return serveFile(req, res, VENDOR[p]);
  if (LOCAL && p.startsWith("/packages/")) {
    const file = path.join(REPO_ROOT, path.normalize(p).replace(/^([/\\])+/, ""));
    if (file.startsWith(path.join(REPO_ROOT, "packages")) && /[/\\]dist[/\\]/.test(file) && serveFile(req, res, file)) return;
    return send(res, 404, "not found");
  }
  if (p === "/widget/markup") {
    // the partner widget's markup, rendered from templates/widget.html (another origin reads it)
    const ev = byId(url.searchParams.get("event"));
    if (!ev) return html(res, 404, "", { "access-control-allow-origin": "*" });
    return html(res, 200, render("widget", { ...view(ev), hallOrigin: HALL_ORIGIN }), { "access-control-allow-origin": "*" });
  }
  if (p.startsWith("/js/") || p.startsWith("/css/") || p.startsWith("/widget/")) {
    const file = path.join(ROOT, "public", path.normalize(p).replace(/^([/\\])+/, ""));
    if (file.startsWith(path.join(ROOT, "public")) && serveFile(req, res, file)) return;
    return send(res, 404, "not found");
  }

  if (req.method !== "GET") return send(res, 405, "method not allowed");

  if (p === "/") {
    const upcoming = events.toSorted((a, b) => a.date.localeCompare(b.date)).slice(0, 6).map(view);
    return page(res, { title: "ホーム", template: "home", nav: "home", data: { events: upcoming, news: NEWS } });
  }
  if (p === "/events") return eventsPage(res, parseQuery(url.searchParams));
  if (p === "/events/results") {
    const f = parseQuery(url.searchParams);
    if (!isHx) return eventsPage(res, f);
    const more = url.searchParams.get("more") === "1";
    // the search box asks for /events/results, but the address bar must show the page's own URL
    const headers = { "HX-Push-Url": `/events${queryString(f)}` };
    if (more) return html(res, 200, render("more", resultsData(f, { from: f.page })), headers);
    return html(res, 200, render("results", { ...resultsData(f), oob: [{}] }), headers);
  }
  let m;
  if ((m = p.match(/^\/events\/(\d+)$/))) {
    const ev = byId(m[1]);
    if (!ev) return page(res, { title: "見つかりません", template: "notfound", status: 404, data: {} });
    return eventPage(res, ev);
  }
  if ((m = p.match(/^\/events\/(\d+)\/booking$/))) {
    const ev = byId(m[1]);
    if (!ev) return html(res, 404, "<p>イベントが見つかりません。</p>");
    if (!isHx) return eventPage(res, ev);
    return html(res, 200, render("booking", view(ev)));
  }
  if (p === "/my") return page(res, { title: "マイリスト", template: "my", nav: "my", data: {} });
  return page(res, { title: "見つかりません", template: "notfound", status: 404, data: {} });
}

// ---------------------------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------------------------
const NAME_RE = /\S/;
const PHONE_RE = /^0\d{1,4}-?\d{1,4}-?\d{3,4}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validateBooking(b) {
  const errors = {};
  const ev = byId(b?.eventId);
  if (!ev) errors.eventId = "イベントが見つかりません";
  const t = b?.tickets || {};
  let count = 0;
  for (const k of ["adult", "child", "senior"]) {
    const n = t[k] ?? 0;
    if (!Number.isInteger(n) || n < 0 || n > 6) errors[`tickets.${k}`] = "枚数は0〜6枚で指定してください";
    else count += n;
  }
  if (!Object.keys(errors).some((k) => k.startsWith("tickets.")) && count === 0) errors.tickets = "チケットを1枚以上選んでください";
  const att = Array.isArray(b?.attendees) ? b.attendees : [];
  if (att.length !== count) errors.attendees = `参加者のお名前は${count}人分必要です`;
  att.forEach((a, i) => { if (typeof a !== "string" || !NAME_RE.test(a)) errors[`attendees.${i}`] = "参加者のお名前を入力してください"; });
  if (typeof b?.name !== "string" || !NAME_RE.test(b.name)) errors.name = "代表者のお名前を入力してください";
  if (typeof b?.phone !== "string" || !PHONE_RE.test(b.phone.trim())) errors.phone = "電話番号の形式が正しくありません（例: 0276-12-3456）";
  if (typeof b?.email !== "string" || !EMAIL_RE.test(b.email.trim())) errors.email = "メールアドレスの形式が正しくありません";
  return { errors, ev, count };
}

async function api(req, res, url) {
  const p = url.pathname;
  let m;
  if (req.method === "GET" && p === "/api/events") {
    const ids = (url.searchParams.get("ids") || "").split(",").map(Number).filter(Boolean);
    const list = ids.length ? ids.map(byId).filter(Boolean) : events;
    return json(req, res, 200, list);
  }
  if (req.method === "GET" && (m = p.match(/^\/api\/events\/(\d+)$/))) {
    const ev = byId(m[1]);
    return ev ? json(req, res, 200, ev) : json(req, res, 404, { error: "not-found" });
  }
  if (req.method === "GET" && p === "/api/seats") {
    return json(req, res, 200, Object.fromEntries(events.map((e) => [String(e.id), e.remaining])));
  }
  if (req.method === "GET" && p === "/api/seats/stream") {
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", ...cors(req) });
    res.write("retry: 2000\n\n");
    sseClients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 15000);
    req.on("close", () => { clearInterval(ping); sseClients.delete(res); });
    return;
  }
  if (req.method === "POST" && p === "/api/bookings") {
    const b = await readBody(req);
    if (!b) return json(req, res, 400, { error: "bad-json" });
    const { errors, ev, count } = validateBooking(b);
    if (Object.keys(errors).length) return json(req, res, 422, { errors });
    if (ev.remaining < count) return json(req, res, 409, { error: "sold-out", remaining: ev.remaining });
    const total = b.tickets.adult * ev.prices.adult + (b.tickets.child || 0) * ev.prices.child + (b.tickets.senior || 0) * ev.prices.senior;
    const id = `MH-${++bookingSeq}`;
    bookings.push({ id, ...b, total });
    setRemaining(ev, ev.remaining - count);
    return json(req, res, 201, { id, total });
  }
  // --- test hooks -------------------------------------------------------------------------------------------
  if (req.method === "POST" && p === "/api/_test/fail") {
    const b = await readBody(req);
    failRules.set(b.path, { status: Number(b.status) || 500, times: Number(b.times) || 1 });
    return json(req, res, 200, { ok: true });
  }
  if (req.method === "POST" && p === "/api/_test/seats") {
    const b = await readBody(req);
    const ev = byId(b.id);
    if (!ev) return json(req, res, 404, { error: "not-found" });
    setRemaining(ev, Number(b.remaining));
    return json(req, res, 200, { id: ev.id, remaining: ev.remaining });
  }
  if (req.method === "POST" && p === "/api/_test/reset") {
    events = seedEvents(); bookings = []; failRules.clear();
    for (const ev of events) setRemaining(ev, ev.remaining);
    return json(req, res, 200, { ok: true });
  }
  return json(req, res, 404, { error: "not-found" });
}

// ---------------------------------------------------------------------------------------------------------------
// The inn's site (旅館みどり荘) — another origin, Turbo Drive, its own stylesheet, its own wcstack 4.17.0 form
// ---------------------------------------------------------------------------------------------------------------
const INN_DIR = path.join(ROOT, "inn");
const INN_PAGES = {
  "/": { template: "index", title: "旅館みどり荘" },
  "/stay": { template: "stay", title: "ご宿泊プラン | 旅館みどり荘" },
  "/events": { template: "events", title: "周辺のイベント | 旅館みどり荘" },
};
function inn(req, res) {
  const url = new URL(req.url, INN_ORIGIN);
  const p = url.pathname;
  if (p === "/inn.css") return serveFile(req, res, path.join(INN_DIR, "inn.css")) || send(res, 404, "");
  if (VENDOR[p]) return serveFile(req, res, VENDOR[p]);
  if (LOCAL && p.startsWith("/vendor/state-4.17.0/")) {
    const dist = path.join(ROOT, "node_modules/state-4.17.0/dist");
    const file = path.join(dist, path.normalize(p.slice("/vendor/state-4.17.0/".length)));
    return (file.startsWith(dist) && serveFile(req, res, file)) || send(res, 404, "not found");
  }
  const pg = INN_PAGES[p];
  if (!pg) return html(res, 404, "<h1>ページがありません</h1>");
  const nav = Object.fromEntries(Object.keys(INN_PAGES).map((k) => [k === "/" ? "navTop" : `nav${k[1].toUpperCase()}${k.slice(2)}`, k === p ? "page" : "false"]));
  const content = render(pg.template, { hallOrigin: HALL_ORIGIN, mode: url.searchParams.get("mode") || "" }, INN_DIR);
  html(res, 200, render("layout", { title: pg.title, content, hallOrigin: HALL_ORIGIN, ...nav }, INN_DIR));
}

function start(port, handler, name) {
  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((err) => {
      console.error(err);
      if (!res.headersSent) send(res, 500, "internal error");
    });
  });
  server.listen(port, HOST, () => console.log(`community-hall ${name} on http://${HOST}:${port}/`));
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start(HALL_PORT, hall, "hall");
  start(INN_PORT, inn, "inn");
}
