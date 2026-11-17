/**
 * Demo server for stamp-rally — みどり市 まち歩きスタンプラリー: a town-walk stamp rally, in Japanese, opened on the
 * walker's own phone and on a PC from home. One page (state + router + the screen and sensor elements):
 *   /                 はじめに and 端末のチェック (the device check: five answers kept apart)
 *   /login            signing in (saved passwords offered after the server accepted the pair)
 *   /team             a team: a colour from the screen (the eye dropper), members from the contact picker
 *   /walk             the compass to the next place, steps and a shake to stamp, a theme from the light
 *   /spots/:id        a place: a picture to look around in (fullscreen held in landscape, the mouse captured on a
 *                     PC), a guide video in a small window that goes on across pages, the share sheet
 *   /card             the stamp card (shared as a picture), the finisher's certificate
 *   /portal/allowed   the city's portal showing the rally in an <iframe> from another origin (localhost ↔
 *   /portal/forbidden 127.0.0.1), one that allows the features and one that allows none
 *   /?policy=none     the page itself served with a Permissions-Policy header that forbids them
 *
 *   node examples/stamp-rally/server.js                http://localhost:3000/ (PORT=… to change)
 *   WCS_LOCAL=1 node examples/stamp-rally/server.js    the repository's packages/*\/dist instead of esm.run
 *
 * Node built-ins only (and examples/shared/server.js): nothing to install to run it. The data is in memory and the
 * same on every start (and after POST /api/_test/reset): ten participants, 1001 to 1010, whose あいことば is
 * midori-<number>.
 *
 * API (a Bearer token from /api/login for everything below /api/spots):
 *   POST /api/login { number, phrase }        → { token, participant } | 401
 *   GET  /api/spots                           → the eight places
 *   GET  /api/me                              → { participant, team, stamps } | 401
 *   POST /api/logout                          → 204
 *   PUT  /api/team { name, color, members }   → the team | 422 { errors }
 *   POST /api/stamps { spotId, lat?, lng?, code? }   → { stamps } | 409 (already) | 422 (not near, wrong code)
 *   Every /api/* request may add ?delay=<ms> (answer later).
 *   GET  /pano/:id, /video/:id (Range; ?format=mp4|webm), /poster.svg   the generated picture, the guide clip, the poster
 *
 * Test hooks (used by e2e/tests/stamp-rally.spec.ts):
 *   POST /api/_test/reset                     the data again, the log emptied
 *   GET  /api/_test/log                       every API request since the last reset
 *   POST /api/_test/fail { path, status, times }   the next requests to a path fail
 *   POST /api/_test/revoke                    every token forgotten (the next request is a 401)
 *   POST /api/_test/phrase { number, phrase } a participant's あいことば changed
 */
import { readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { createDemoServer } from "../shared/server.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC = join(__dirname, "public");
const REPO_ROOT = resolve(__dirname, "..", "..");
const PORT = Number(process.env.PORT || 3000);
const LOCAL = process.env.WCS_LOCAL === "1";

// ---------------------------------------------------------------- data
// Eight old places of a small town (coordinates: the old post town of Ōmama, Midori City, Gunma — within ~1 km).
const SPOTS = [
  { id: 1, name: "旧大間々銀行", kana: "きゅうおおまましぎんこう", lat: 36.43620, lng: 139.27780,
    story: "明治の終わりに建てられた洋風の銀行。いまは町の博物館として、生糸と銅の町の歴史を伝えています。" },
  { id: 2, name: "高津戸峡", kana: "たかつどきょう", lat: 36.43910, lng: 139.28160,
    story: "渡良瀬川がつくった深い谷。はねたき橋から見下ろす岩と水の色は、季節ごとに変わります。" },
  { id: 3, name: "ながめ余興場", kana: "ながめよきょうじょう", lat: 36.43990, lng: 139.28040,
    story: "昭和のはじめに建てられた芝居小屋。回り舞台と花道がいまも残り、年に何度か幕が上がります。" },
  { id: 4, name: "大間々神明宮", kana: "おおまましんめいぐう", lat: 36.43480, lng: 139.27560,
    story: "宿場の人々が守ってきたお宮。夏祭りには山車が町を練り歩きます。" },
  { id: 5, name: "岩下家の蔵", kana: "いわしたけのくら", lat: 36.43350, lng: 139.27900,
    story: "白い漆喰の土蔵が並ぶ通り。かつては生糸の問屋が軒を連ねていました。" },
  { id: 6, name: "わたらせ渓谷鐵道 大間々駅", kana: "おおままえき", lat: 36.43210, lng: 139.27470,
    story: "トロッコ列車が出る小さな駅。木造の駅舎は大正の面影を残しています。" },
  { id: 7, name: "光栄寺の大銀杏", kana: "こうえいじのおおいちょう", lat: 36.43700, lng: 139.27320,
    story: "樹齢四百年といわれる銀杏。秋には境内が黄色いじゅうたんになります。" },
  { id: 8, name: "旧桐生道の道標", kana: "きゅうきりゅうみちのどうひょう", lat: 36.43080, lng: 139.27950,
    story: "「右 きりう道 左 あかぎ道」と刻まれた石の道しるべ。旅人がここで道を選びました。" },
].map((s) => ({ ...s, panorama: `/pano/${s.id}`, video: `/video/${s.id}` }));

function freshData() {
  const participants = new Map();
  for (let n = 1001; n <= 1010; n++) {
    participants.set(String(n), { number: String(n), name: `参加者${n}`, phrase: `midori-${n}`, team: null, stamps: [] });
  }
  return { participants, tokens: new Map(), log: [], fail: new Map() };
}
let db = freshData();

// ---------------------------------------------------------------- helpers
const FEATURES = [
  "accelerometer", "gyroscope", "magnetometer", "ambient-light-sensor", "fullscreen", "picture-in-picture",
  "web-share", "geolocation", "screen-wake-lock", "clipboard-write", "autoplay",
];
const POLICY_NONE = FEATURES.map((f) => `${f}=()`).join(", ");

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const payload = body == null ? "" : isBuf || typeof body === "string" ? body : JSON.stringify(body);
  const type = headers["Content-Type"] ?? (isBuf || typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8");
  const len = status === 204 ? 0 : Buffer.byteLength(payload);
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "Content-Length": len, ...headers });
  res.end(status === 204 ? undefined : payload);
  return true;
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { return text; }
}
function auth(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
  const number = m && db.tokens.get(m[1]);
  return number ? db.participants.get(number) : null;
}
function meOf(p) {
  return { participant: { number: p.number, name: p.name }, team: p.team, stamps: p.stamps };
}
function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---------------------------------------------------------------- generated assets
function panoramaSvg(id) {
  const spot = SPOTS.find((s) => s.id === id);
  const W = 3600, H = 600;
  const hue = (id * 47) % 360;
  const points = [["北", 0], ["北東", 45], ["東", 90], ["南東", 135], ["南", 180], ["南西", 225], ["西", 270], ["北西", 315]];
  let hills = "";
  for (let i = 0; i <= 36; i++) {
    const x = i * 100, y = 330 + Math.round(60 * Math.sin((i + id) * 0.9) + 30 * Math.cos(i * 0.37 * id));
    hills += `${i === 0 ? "M" : "L"}${x},${y} `;
  }
  const marks = points.map(([label, deg]) => {
    const x = deg * 10;
    // each label is drawn twice near the seam so the strip wraps
    const one = (xx) => `<g><line x1="${xx}" y1="420" x2="${xx}" y2="600" stroke="#222" stroke-width="6"/>` +
      `<text x="${xx}" y="140" font-size="${deg % 90 === 0 ? 120 : 80}" text-anchor="middle" fill="#111" font-family="sans-serif">${label}</text></g>`;
    return one(x) + (x === 0 ? one(W) : "");
  }).join("");
  let ticks = "";
  for (let d = 0; d < 360; d += 15) ticks += `<text x="${d * 10}" y="590" font-size="28" text-anchor="middle" fill="#333">${d}°</text>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" data-spot="${id}">
  <rect width="${W}" height="${H}" fill="hsl(${hue},45%,82%)"/>
  <path d="${hills} L${W},${H} L0,${H} Z" fill="hsl(${(hue + 90) % 360},35%,55%)"/>
  ${marks}${ticks}
  <text x="1800" y="300" font-size="70" text-anchor="middle" fill="#fff" stroke="#000" stroke-width="2" font-family="sans-serif">場所 ${id}　${spot ? spot.name : ""}</text>
</svg>`;
}
function posterSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 800 400">
  <rect x="0" y="0" width="200" height="300" fill="#2e7d32"/><rect x="200" y="0" width="200" height="300" fill="#f9a825"/>
  <rect x="400" y="0" width="200" height="300" fill="#c62828"/><rect x="600" y="0" width="200" height="300" fill="#1565c0"/>
  <rect x="0" y="300" width="800" height="100" fill="#fafafa"/>
  <text x="400" y="365" font-size="40" text-anchor="middle" font-family="sans-serif" fill="#222">みどり市 まち歩きスタンプラリー</text>
</svg>`;
}
function portalPage(kind, req) {
  // The rally is embedded from another origin (localhost ↔ 127.0.0.1), as a city portal on its own host would be.
  const host = req.headers.host ?? `localhost:${PORT}`;
  const appHost = host.startsWith("127.0.0.1") ? `localhost:${PORT}` : `127.0.0.1:${PORT}`;
  const allow = kind === "allowed"
    ? `accelerometer; gyroscope; magnetometer; ambient-light-sensor; fullscreen; picture-in-picture; web-share; geolocation; screen-wake-lock; clipboard-write; autoplay`
    : FEATURES.map((f) => `${f} 'none'`).join("; ");
  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>みどり市ポータル — スタンプラリー (${kind})</title>
<style>body{font-family:system-ui,sans-serif;margin:0;background:#eef3ee}header{background:#2e7d32;color:#fff;padding:.6rem 1rem}
iframe{display:block;width:100%;height:calc(100vh - 3rem);border:0;background:#fff}</style></head>
<body><header>みどり市ポータル — まち歩きスタンプラリー</header>
<iframe id="rally" title="スタンプラリー" src="http://${appHost}/" allow="${allow}"></iframe>
</body></html>`;
}

// ---------------------------------------------------------------- API
async function api(req, res, url) {
  const path = url.pathname;
  const delay = Number(url.searchParams.get("delay") || 0);
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
  if (!path.startsWith("/api/_test/")) {
    const entry = { t: Date.now(), method: req.method, path, query: Object.fromEntries(url.searchParams) };
    if (body !== undefined) entry.body = body;
    if (req.headers.authorization) entry.auth = true;
    db.log.push(entry);
  }
  if (delay > 0) await new Promise((r) => setTimeout(r, Math.min(delay, 30000)));

  const failing = db.fail.get(path);
  if (failing && failing.times > 0 && !path.startsWith("/api/_test/")) {
    failing.times--;
    return send(res, failing.status, { error: "テスト用の失敗です" });
  }

  // --- test hooks
  if (path === "/api/_test/reset" && req.method === "POST") { db = freshData(); return send(res, 204); }
  if (path === "/api/_test/log" && req.method === "GET") return send(res, 200, db.log);
  if (path === "/api/_test/fail" && req.method === "POST") {
    db.fail.set(body.path, { status: Number(body.status ?? 500), times: Number(body.times ?? 1) });
    return send(res, 204);
  }
  if (path === "/api/_test/revoke" && req.method === "POST") { db.tokens.clear(); return send(res, 204); }
  if (path === "/api/_test/phrase" && req.method === "POST") {
    const p = db.participants.get(String(body.number));
    if (p) p.phrase = String(body.phrase);
    return send(res, 204);
  }

  // --- public
  if (path === "/api/login" && req.method === "POST") {
    const p = db.participants.get(String(body?.number ?? ""));
    if (!p || p.phrase !== String(body?.phrase ?? "")) return send(res, 401, { error: "参加者番号かあいことばが違います" });
    const token = randomBytes(16).toString("hex");
    db.tokens.set(token, p.number);
    return send(res, 200, { token, participant: { number: p.number, name: p.name } });
  }
  if (path === "/api/spots" && req.method === "GET") return send(res, 200, SPOTS);

  // --- signed in
  const p = auth(req);
  if (!p) return send(res, 401, { error: "サインインしてください" });
  if (path === "/api/me" && req.method === "GET") return send(res, 200, meOf(p));
  if (path === "/api/logout" && req.method === "POST") {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization)[1];
    db.tokens.delete(token);
    return send(res, 204);
  }
  if (path === "/api/team" && req.method === "PUT") {
    const errors = {};
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) errors.name = "チーム名を入れてください";
    else if ([...name].length > 20) errors.name = "チーム名は20文字までです";
    if (typeof body?.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(body.color)) errors.color = "色は #rrggbb で指定してください";
    const members = Array.isArray(body?.members) ? body.members : [];
    if (members.length > 5) errors.members = "メンバーは5人までです";
    members.forEach((m, i) => {
      const email = typeof m?.email === "string" ? m.email.trim() : "";
      if (email && !email.includes("@")) errors[`members.${i}.email`] = "メールアドレスに @ がありません";
    });
    if (Object.keys(errors).length) return send(res, 422, { errors });
    p.team = { name, color: body.color.toLowerCase(), members: members.map((m) => ({ name: String(m?.name ?? ""), email: String(m?.email ?? "") })) };
    return send(res, 200, p.team);
  }
  if (path === "/api/stamps" && req.method === "POST") {
    const spot = SPOTS.find((s) => s.id === Number(body?.spotId));
    if (!spot) return send(res, 422, { error: "その場所はありません" });
    if (p.stamps.some((s) => s.spotId === spot.id)) return send(res, 409, { error: "この場所のスタンプはもう押してあります" });
    const near = typeof body.lat === "number" && typeof body.lng === "number" && distanceM(body.lat, body.lng, spot.lat, spot.lng) <= 30;
    const codeOk = String(body.code ?? "") === String(spot.id).repeat(4);
    if (!near && !codeOk) return send(res, 422, { error: body.code ? "番号が違います" : "場所から30m以内で押すか、看板の番号を入れてください" });
    p.stamps = [...p.stamps, { spotId: spot.id, at: new Date().toISOString() }];
    return send(res, 200, { stamps: p.stamps });
  }
  return send(res, 404, { error: "not found" });
}

// ---------------------------------------------------------------- the guide clip (one for every place, with Range)
async function video(req, res, url) {
  // `?format=` picks the file; otherwise Safari/WebKit gets the MP4 (H.264) and the others the WebM (VP8).
  const ua = req.headers["user-agent"] ?? "";
  const wantMp4 = url.searchParams.get("format") === "mp4" ||
    (url.searchParams.get("format") !== "webm" && /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg/.test(ua));
  const file = join(PUBLIC, "media", wantMp4 ? "guide.mp4" : "guide.webm");
  const type = wantMp4 ? "video/mp4" : "video/webm";
  const info = await stat(file);
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
  const data = await readFile(file);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${info.size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1, "Cache-Control": "no-store" });
    res.end(data.subarray(start, end + 1));
    return true;
  }
  return send(res, 200, data, { "Content-Type": type, "Accept-Ranges": "bytes" });
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

createDemoServer({
  port: PORT,
  root: PUBLIC,
  async api(req, res, url) {
    const { pathname } = url;

    // ---- WCS_LOCAL=1: the bundles the page names instead of esm.run ----
    if (LOCAL && req.method === "GET" && pathname.startsWith("/packages/")) {
      const file = resolve(REPO_ROOT, "." + pathname);
      if (!file.startsWith(join(REPO_ROOT, "packages"))) { res.writeHead(403); res.end("Forbidden"); return true; }
      const body = await readFile(file).catch(() => null);
      if (!body) { res.writeHead(404); res.end("Not found"); return true; }
      res.writeHead(200, { "Content-Type": file.endsWith(".map") ? "application/json" : "text/javascript; charset=utf-8" });
      res.end(body);
      return true;
    }

    try {
      if (pathname.startsWith("/api/")) { await api(req, res, url); return true; }
      let m;
      if ((m = /^\/pano\/(\d+)$/.exec(pathname))) return send(res, 200, panoramaSvg(Number(m[1])), { "Content-Type": "image/svg+xml" });
      if (/^\/video\/\d+$/.test(pathname)) return await video(req, res, url);
      if (pathname === "/poster.svg") return send(res, 200, posterSvg(), { "Content-Type": "image/svg+xml" });
      if ((m = /^\/portal\/(allowed|forbidden)$/.exec(pathname))) return send(res, 200, portalPage(m[1], req), { "Content-Type": "text/html; charset=utf-8" });
      // every extensionless GET is the page (history fallback); ?policy=none serves it with a Permissions-Policy
      // header that forbids the features (Chromium is the browser that lets a page read its policy)
      if (req.method === "GET" && extname(pathname) === "") {
        const policy = url.searchParams.get("policy") === "none" ? { "Permissions-Policy": POLICY_NONE } : {};
        return send(res, 200, await page(), { "Content-Type": "text/html; charset=utf-8", ...policy });
      }
    } catch (e) {
      console.error(e);
      if (!res.headersSent) send(res, 500, { error: String(e?.message ?? e) });
      else res.end();
      return true;
    }
    return false; // app.css, state.js, js/: the shared static files from public/
  },
  notes: [
    ...(LOCAL ? ["WCS_LOCAL=1: esm.run lines rewritten to the local packages/*/dist"] : []),
    "The rally: / — the city's portal: /portal/allowed, /portal/forbidden — participants 1001–1010, あいことば midori-<number>",
  ],
});
