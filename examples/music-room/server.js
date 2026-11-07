// 音楽室の練習キーボード — static files + in-memory API (Node built-ins only).
//
//   node examples/music-room/server.js                 http://localhost:5610 (PORT=… to change); packages from esm.run
//   WCS_LOCAL=1 node examples/music-room/server.js     the repository's packages/*/dist instead of esm.run
//
// Test hooks (POST): /__reset (the seed sounds and takes again), /api/_test/fail { path, status, times }.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("./public/", import.meta.url));
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const PORT = Number(process.env.PORT ?? 5610);
const LOCAL = process.env.WCS_LOCAL === "1";
const TEACHER_KEY = "ongaku";

// WCS_LOCAL=1: the esm.run one-liners become the repository's bundles (served below from packages/).
async function page() {
  const html = await readFile(join(ROOT, "index.html"), "utf8");
  return LOCAL ? html.replace(/https:\/\/esm\.run\/@wcstack\/([\w-]+)\/auto/g, (_m, pkg) => `/packages/${pkg}/dist/auto.min.js`) : html;
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
};

// ---- the sound contract -------------------------------------------------
export const RANGES = {
  detune: [0, 50],
  cutoff: [80, 12000],
  resonance: [0.1, 20],
  attack: [0, 2],
  decay: [0, 2],
  sustain: [0, 1],
  release: [0, 4],
  vibratoRate: [0.1, 12],
  delayMix: [0, 1],
  volume: [0, 1],
};
export const WAVES = ["sine", "triangle", "sawtooth", "square"];
const LABELS = {
  wave: "波形", detune: "デチューン", cutoff: "カットオフ", resonance: "レゾナンス",
  attack: "アタック", decay: "ディケイ", sustain: "サステイン", release: "リリース",
  vibratoRate: "ビブラートの速さ", delayMix: "エコー", volume: "音量",
};

function validateSound(body) {
  const errors = {};
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) errors.name = "名前を入力してください。";
  else if ([...name].length > 30) errors.name = "名前は30文字以内にしてください。";
  const v = body?.values ?? {};
  if (!WAVES.includes(v.wave)) errors.wave = `${LABELS.wave}は sine / triangle / sawtooth / square のどれかです。`;
  for (const [key, [min, max]] of Object.entries(RANGES)) {
    const n = v[key];
    if (typeof n !== "number" || !Number.isFinite(n)) errors[key] = `${LABELS[key]}を数で指定してください。`;
    else if (n < min || n > max) errors[key] = `${LABELS[key]}は${min}から${max}のあいだです。`;
  }
  return { errors, name };
}

// ---- seed data ----------------------------------------------------------
const sound = (wave, detune, cutoff, resonance, attack, decay, sustain, release, vibratoRate, delayMix, volume) =>
  ({ wave, detune, cutoff, resonance, attack, decay, sustain, release, vibratoRate, delayMix, volume });

const SEED_SOUNDS = () => [
  { id: 1, name: "やわらかいピアノ風", values: sound("triangle", 6, 2400, 1, 0.005, 0.8, 0.25, 0.6, 5, 0.15, 0.8) },
  { id: 2, name: "オルガン", values: sound("square", 4, 1800, 0.7, 0.01, 0.1, 0.9, 0.12, 6, 0.1, 0.6) },
  { id: 3, name: "ストリングス", values: sound("sawtooth", 14, 1600, 1.5, 0.35, 0.4, 0.8, 0.9, 5.5, 0.3, 0.7) },
  { id: 4, name: "フルート", values: sound("sine", 2, 3000, 0.5, 0.06, 0.2, 0.85, 0.25, 5, 0.2, 0.9) },
  { id: 5, name: "シンセベース", values: sound("sawtooth", 10, 600, 8, 0.005, 0.25, 0.5, 0.15, 4, 0, 0.8) },
];

const SEED_TAKES = () => [
  {
    id: 1, name: "ドレミの練習", bpm: 90, createdAt: "2026-11-01T09:00:00.000Z",
    events: [60, 62, 64, 65, 67].flatMap((note, i) => [
      { t: i * 667, type: "on", note, velocity: 0.8 },
      { t: i * 667 + 600, type: "off", note, velocity: 0 },
    ]),
  },
  {
    id: 2, name: "和音の練習", bpm: 72, createdAt: "2026-11-02T09:00:00.000Z",
    events: [[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67]].flatMap((chord, i) => chord.flatMap((note) => [
      { t: i * 1667, type: "on", note, velocity: 0.7 },
      { t: i * 1667 + 1500, type: "off", note, velocity: 0 },
    ])),
  },
];
let sounds, nextSoundId, takes, nextTakeId;
function reset() {
  sounds = SEED_SOUNDS();
  nextSoundId = sounds.length + 1;
  takes = SEED_TAKES();
  nextTakeId = takes.length + 1;
  failures.clear();
}
const takeLength = (t) => t.events.reduce((m, e) => Math.max(m, e.t), 0);
const takeSummary = (t) => ({ id: t.id, name: t.name, bpm: t.bpm, length: takeLength(t), createdAt: t.createdAt });

// ---- test hooks ---------------------------------------------------------
// POST /api/_test/fail { path, status, times } → the next `times` requests to `path` fail with `status`.
const failures = new Map();
reset();
function takeFailure(path) {
  const f = failures.get(path);
  if (!f) return null;
  f.times -= 1;
  if (f.times <= 0) failures.delete(path);
  return f.status;
}

// ---- helpers ------------------------------------------------------------
function send(res, status, body) {
  const text = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(text);
}
async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 5_000_000) throw Object.assign(new Error("too large"), { status: 413 });
    chunks.push(c);
  }
  if (chunks.length === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("bad json"), { status: 400 }); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(req, res, url) {
  const delay = Number(url.searchParams.get("delay") ?? 0);
  if (delay > 0) await sleep(Math.min(delay, 30_000));
  const path = url.pathname;

  if (path === "/api/_test/fail" && req.method === "POST") {
    const { path: p, status = 500, times = 1 } = await readJson(req);
    if (!p) failures.clear(); else failures.set(p, { status, times });
    return send(res, 204);
  }
  const failStatus = takeFailure(path);
  if (failStatus) return send(res, failStatus, { error: "テスト用の失敗です。" });

  if (path === "/api/sounds" && req.method === "GET") return send(res, 200, sounds);
  if (path === "/api/sounds" && req.method === "POST") {
    if (req.headers["x-teacher-key"] !== TEACHER_KEY) return send(res, 403, { error: "先生の鍵がちがいます。" });
    const body = await readJson(req);
    const { errors, name } = validateSound(body);
    if (Object.keys(errors).length) return send(res, 422, { errors });
    const v = body.values;
    const created = { id: nextSoundId++, name, values: Object.fromEntries(["wave", ...Object.keys(RANGES)].map((k) => [k, v[k]])) };
    sounds.push(created);
    return send(res, 201, created);
  }
  let m = path.match(/^\/api\/sounds\/(\d+)$/);
  if (m && req.method === "GET") {
    const s = sounds.find((x) => x.id === Number(m[1]));
    return s ? send(res, 200, s) : send(res, 404, { error: "その音は見つかりません。" });
  }

  if (path === "/api/takes" && req.method === "GET") return send(res, 200, takes.map(takeSummary).toReversed());
  if (path === "/api/takes" && req.method === "POST") {
    const body = await readJson(req);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return send(res, 422, { errors: { name: "名前を入力してください。" } });
    if ([...name].length > 30) return send(res, 422, { errors: { name: "名前は30文字以内にしてください。" } });
    const events = Array.isArray(body.events) ? body.events : [];
    if (events.length > 5000) return send(res, 413, { error: "演奏が長すぎます（5000イベントまで）。" });
    const clean = events
      .filter((e) => e && (e.type === "on" || e.type === "off") && Number.isFinite(e.t) && Number.isInteger(e.note))
      .map((e) => ({ t: Math.max(0, Math.round(e.t)), type: e.type, note: e.note, velocity: Math.min(1, Math.max(0, Number(e.velocity) || 0)) }));
    const take = { id: nextTakeId++, name, bpm: Number(body.bpm) || 100, createdAt: new Date().toISOString(), events: clean };
    takes.push(take);
    return send(res, 201, { ...takeSummary(take), events: take.events });
  }
  m = path.match(/^\/api\/takes\/(\d+)$/);
  if (m && req.method === "GET") {
    const t = takes.find((x) => x.id === Number(m[1]));
    return t ? send(res, 200, { id: t.id, name: t.name, bpm: t.bpm, events: t.events }) : send(res, 404, { error: "その演奏は見つかりません。" });
  }
  return send(res, 404, { error: "not found" });
}

async function staticFile(req, res, url) {
  const rel = decodeURIComponent(url.pathname);
  // SPA fallback: every extensionless GET returns the page
  if (extname(rel) === "") {
    res.writeHead(200, { "Content-Type": TYPES[".html"], "Cache-Control": "no-cache" });
    return res.end(await page());
  }
  // WCS_LOCAL=1: the bundles the page names instead of esm.run
  if (LOCAL && rel.startsWith("/packages/")) {
    const file = resolve(REPO_ROOT, "." + rel);
    if (!file.startsWith(join(REPO_ROOT, "packages") + sep)) { res.writeHead(403); return res.end(); }
    const body = await readFile(file).catch(() => null);
    if (!body) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    return res.end(body);
  }
  const file = normalize(join(ROOT, rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error("not a file");
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  try {
    if (url.pathname === "/__reset" && req.method === "POST") { reset(); return send(res, 204); }
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    return await staticFile(req, res, url);
  } catch (e) {
    send(res, e.status ?? 500, { error: e.status === 413 ? "大きすぎます。" : "サーバーのエラーです。" });
  }
});

server.listen(PORT, () => {
  console.log(`music-room on http://localhost:${PORT}/`);
  if (LOCAL) console.log("WCS_LOCAL=1: esm.run one-liners rewritten to the local packages/*/dist");
});
