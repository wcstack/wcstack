/**
 * Demo server for ekiden-entry — a team entry wizard for a city's relay race (みどり市民駅伝), in Japanese:
 * a page that is mostly a form (state + router + fetch + upload + storage + debounce, and two form-associated
 * custom elements of the page's own).
 *
 *   node examples/ekiden-entry/server.js                http://localhost:3000/entry/team (PORT=… to change)
 *   WCS_LOCAL=1 node examples/ekiden-entry/server.js    the repository's packages/*\/dist instead of esm.run
 *
 * Node built-ins only (and examples/shared/server.js): nothing to install to run it.
 *
 * Pages: every extensionless GET is the wizard (/entry/team … /entry/done; / and /entry continue where the
 * draft was left). /plain is the two shared controls in a classic <form method="post"> with no wcstack; the
 * server echoes what it received.
 *
 * API (in memory):
 *   GET    /api/prefectures                 → [{ code, name }]
 *   GET    /api/postal/:code                → { prefecture, city, town } | 404 (codes that start with 999 answer after 2 s)
 *   GET    /api/teams/available?name=       → { available }
 *   POST   /api/consents                    multipart/form-data, one file (PDF / JPEG / PNG by content, 5 MB at most)
 *                                           → 201 { id, name } | 400 | 413 | 415
 *   DELETE /api/consents/:id                → 204
 *   POST   /api/entries  (the entry)        → 201 { id, total } | 409 { error: "team-name-taken" }
 *                                           | 422 { errors: { "<json path>": message } } — a path may name a field of
 *                                             any step, and a runner by its index in the entry sent (runners.2.name)
 *   Every /api/* request may add ?delay=<ms> (answer later).
 *
 * Test hooks (POST, JSON body; used by e2e/tests/ekiden-entry.spec.ts):
 *   /api/_test/reset                        fresh data
 *   /api/_test/fail   { path, status, times }   the next `times` requests to `path` answer `status` (0: the connection drops)
 *   /api/_test/reject { errors, times }     the next `times` POST /api/entries answer 422 with `errors`
 *   /api/_test/take   { name }              a team name becomes taken
 */
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createDemoServer } from "../shared/server.js";
import { validateEntry, ageOn, RACE_DAY, totalFee, isKatakana, PREFECTURES } from "./public/lib/entry-logic.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC = join(__dirname, "public");
const REPO_ROOT = resolve(__dirname, "..", "..");
const PORT = Number(process.env.PORT || 3000);
const LOCAL = process.env.WCS_LOCAL === "1";

// ---------------------------------------------------------------- the page
// WCS_LOCAL=1: the esm.run one-liners become the repository's bundles (served below from packages/).
async function page() {
  const html = await readFile(join(PUBLIC, "index.html"), "utf8");
  return LOCAL ? html.replace(/https:\/\/esm\.run\/@wcstack\/([\w-]+)\/auto/g, (_m, pkg) => `/packages/${pkg}/dist/auto.min.js`) : html;
}

// ---------------------------------------------------------------- data
const POSTAL_SEED = {
  "3790000": { prefecture: "10", city: "みどり市", town: "中央" },
  "3792311": { prefecture: "10", city: "みどり市", town: "笠懸町阿左美" },
  "3760101": { prefecture: "10", city: "みどり市", town: "大間々町大間々" },
  "3710023": { prefecture: "10", city: "前橋市", town: "本町" },
  "3700073": { prefecture: "10", city: "高崎市", town: "緑町" },
  "1000005": { prefecture: "13", city: "千代田区", town: "丸の内" },
  "1600022": { prefecture: "13", city: "新宿区", town: "新宿" },
  "1500002": { prefecture: "13", city: "渋谷区", town: "渋谷" },
  "1050011": { prefecture: "13", city: "港区", town: "芝公園" },
  "1310045": { prefecture: "13", city: "墨田区", town: "押上" },
  "2310023": { prefecture: "14", city: "横浜市中区", town: "山下町" },
  "3300063": { prefecture: "11", city: "さいたま市浦和区", town: "高砂" },
  "2600013": { prefecture: "12", city: "千葉市中央区", town: "中央" },
  "3200806": { prefecture: "09", city: "宇都宮市", town: "中央" },
  "5300001": { prefecture: "27", city: "大阪市北区", town: "梅田" },
  "6008216": { prefecture: "26", city: "京都市下京区", town: "東塩小路町" },
  "4600008": { prefecture: "23", city: "名古屋市中区", town: "栄" },
  "0600001": { prefecture: "01", city: "札幌市中央区", town: "北一条西" },
  "8100001": { prefecture: "40", city: "福岡市中央区", town: "天神" },
  "9000006": { prefecture: "47", city: "那覇市", town: "おもろまち" },
  "9990001": { prefecture: "10", city: "みどり市", town: "東町" },   // slow (999…)
  "9990002": { prefecture: "13", city: "八王子市", town: "元本郷町" }, // slow (999…)
};
const TAKEN_SEED = ["みどりRC", "桐生ランナーズ", "チーム赤城", "わたらせ走友会"];
const OTHER_TEAM_RUNNERS_SEED = [{ name: "既存 太郎", birth: "1990-01-01" }];

let state;
function resetState() {
  state = {
    taken: new Set(TAKEN_SEED),
    otherRunners: OTHER_TEAM_RUNNERS_SEED.map((r) => ({ ...r })),
    consents: new Map(),
    entries: [],
    seq: 0,
    fail: new Map(),      // path -> { status, times }
    reject: null,         // { errors, times }
  };
}
resetState();

// ---------------------------------------------------------------- helpers
function send(res, status, body, headers = {}) {
  if (body === undefined || body === null) { res.writeHead(status, headers); res.end(); return true; }
  const isString = typeof body === "string" || Buffer.isBuffer(body);
  res.writeHead(status, { "Content-Type": isString ? "text/plain; charset=utf-8" : "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(isString ? body : JSON.stringify(body));
  return true;
}
function readBody(req, limit = 6 * 1024 * 1024) {
  return new Promise((done, reject) => {
    const chunks = []; let size = 0; let over = false;
    req.on("data", (c) => { size += c.length; if (size > limit) over = true; else chunks.push(c); });
    req.on("end", () => done({ buf: Buffer.concat(chunks), over, size }));
    req.on("error", reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!m) return [];
  const boundary = Buffer.from("--" + (m[1] || m[2]));
  const parts = [];
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length;
    if (buf.slice(start, start + 2).toString() === "--") break;
    const next = buf.indexOf(boundary, start);
    if (next === -1) break;
    const part = buf.slice(start + 2, next - 2); // strip CRLF
    const headerEnd = part.indexOf("\r\n\r\n");
    const headers = part.slice(0, headerEnd).toString("utf8");
    const data = part.slice(headerEnd + 4);
    const name = /name="([^"]*)"/i.exec(headers)?.[1];
    const filename = /filename="([^"]*)"/i.exec(headers)?.[1];
    const type = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim();
    parts.push({ name, filename, type, data });
    pos = next;
  }
  return parts;
}

function sniffType(data) {
  if (data.slice(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return null;
}

// ---------------------------------------------------------------- the entry, as the server checks it
// Everything the page checks (the same module), plus what only the server can know.
function serverCheck(entry) {
  const errors = { ...validateEntry(entry) };   // the page's own rules, by JSON path
  const name = entry?.team?.name ?? "";
  if (name && state.taken.has(name)) return { conflict: true };
  const division = entry?.team?.division;
  const repBirth = entry?.rep?.birth;
  if (repBirth && ageOn(repBirth, RACE_DAY) < 18) errors["rep.birth"] ??= "代表者は大会当日に18歳以上である必要があります。";
  (entry?.runners ?? []).forEach((r, i) => {
    if (!r) return;
    if (state.otherRunners.some((o) => o.name === r.name && o.birth === r.birth)) {
      errors[`runners.${i}.name`] ??= "この走者はすでに他のチームで申し込まれています。";
    }
    if (r.birth) {
      const age = ageOn(r.birth, RACE_DAY);
      if (age < 18 && !r.consentId) errors[`runners.${i}.consentId`] ??= "18歳未満の走者は保護者の同意書が必要です。";
      if (r.consentId && !state.consents.has(r.consentId)) errors[`runners.${i}.consentId`] ??= "同意書が見つかりません。もう一度アップロードしてください。";
      if (division === "中学生" && (age < 12 || age > 15)) errors[`runners.${i}.birth`] ??= "中学生の部は大会当日に12〜15歳の走者のみです。";
      if (division === "高校生" && (age < 15 || age > 18)) errors[`runners.${i}.birth`] ??= "高校生の部は大会当日に15〜18歳の走者のみです。";
    }
    if (r.kana && !isKatakana(r.kana)) errors[`runners.${i}.kana`] ??= "フリガナは全角カタカナで入力してください。";
    if (r.emergencyPhone && !/^\d{10,11}$/.test(r.emergencyPhone)) errors[`runners.${i}.emergencyPhone`] ??= "電話番号は数字10〜11桁です。";
  });
  const phone = entry?.rep?.phone;
  if (phone && !/^\d{10,11}$/.test(phone)) errors["rep.phone"] ??= "電話番号は数字10〜11桁です。";
  if (entry?.rep?.postal && !/^\d{7}$/.test(entry.rep.postal)) errors["rep.postal"] ??= "郵便番号は数字7桁です。";
  return { errors };
}

// ---------------------------------------------------------------- routes
async function api(req, res, url) {
  const wait = Number(url.searchParams.get("delay") || 0);
  if (wait > 0) await sleep(Math.min(wait, 30000));
  const path = url.pathname;

  if (path.startsWith("/api/_test/")) {
    if (req.method !== "POST") return send(res, 405, "POST only");
    const { buf } = await readBody(req);
    const body = buf.length ? JSON.parse(buf.toString("utf8")) : {};
    if (path === "/api/_test/reset") { resetState(); return send(res, 204); }
    if (path === "/api/_test/fail") { state.fail.set(body.path, { status: body.status ?? 500, times: body.times ?? 1 }); return send(res, 204); }
    if (path === "/api/_test/reject") { state.reject = { errors: body.errors ?? {}, times: body.times ?? 1 }; return send(res, 204); }
    if (path === "/api/_test/take") { state.taken.add(body.name); return send(res, 204); }
    return send(res, 404, { error: "not-found" });
  }

  const failure = state.fail.get(path);
  if (failure && failure.times > 0) {
    failure.times -= 1;
    if (failure.status === 0) { req.socket.destroy(); return true; }   // status 0: the connection drops
    return send(res, failure.status, { error: "injected" });
  }

  if (req.method === "GET" && path === "/api/prefectures") return send(res, 200, PREFECTURES);

  let m;
  if (req.method === "GET" && (m = /^\/api\/postal\/(\d{7})$/.exec(path))) {
    const code = m[1];
    if (code.startsWith("999")) await sleep(2000);
    const hit = POSTAL_SEED[code];
    return hit ? send(res, 200, hit) : send(res, 404, { error: "not-found" });
  }

  if (req.method === "GET" && path === "/api/teams/available") {
    const name = url.searchParams.get("name") ?? "";
    return send(res, 200, { available: !state.taken.has(name) });
  }

  if (req.method === "POST" && path === "/api/consents") {
    const { buf, over } = await readBody(req, 5 * 1024 * 1024 + 64 * 1024);
    if (over) return send(res, 413, { error: "too-large" });
    const file = parseMultipart(buf, req.headers["content-type"]).find((p) => p.filename !== undefined);
    if (!file) return send(res, 400, { error: "no-file" });
    if (file.data.length > 5 * 1024 * 1024) return send(res, 413, { error: "too-large" });
    const type = sniffType(file.data);
    if (!type) return send(res, 415, { error: "unsupported-type" });
    const id = randomUUID();
    state.consents.set(id, { name: file.filename, type, size: file.data.length });
    return send(res, 201, { id, name: file.filename });
  }
  if (req.method === "DELETE" && (m = /^\/api\/consents\/([\w-]+)$/.exec(path))) {
    state.consents.delete(m[1]);
    return send(res, 204);
  }

  if (req.method === "POST" && path === "/api/entries") {
    const { buf } = await readBody(req);
    let entry;
    try { entry = JSON.parse(buf.toString("utf8")); } catch { return send(res, 400, { error: "bad-json" }); }
    if (state.reject && state.reject.times > 0) {
      state.reject.times -= 1;
      return send(res, 422, { errors: state.reject.errors });
    }
    const result = serverCheck(entry);
    if (result.conflict) return send(res, 409, { error: "team-name-taken" });
    if (Object.keys(result.errors).length) return send(res, 422, { errors: result.errors });
    state.seq += 1;
    const id = `ME-2027-${String(state.seq).padStart(4, "0")}`;
    state.taken.add(entry.team.name);
    for (const r of entry.runners) state.otherRunners.push({ name: r.name, birth: r.birth });
    state.entries.push({ id, entry });
    return send(res, 201, { id, total: totalFee(entry) });
  }
  return send(res, 404, { error: "not-found" });
}

/** POST /plain: what a classic form sent, echoed (the shared controls without wcstack). */
async function plainEcho(req, res) {
  const { buf } = await readBody(req);
  const params = new URLSearchParams(buf.toString("utf8"));
  const rows = [...params].map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td><output data-name="${esc(k)}">${esc(v)}</output></td></tr>`).join("");
  return send(res, 200, `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>受信した項目</title></head>
<body><h1>受信した項目</h1><table><tbody>${rows}</tbody></table><p><a href="/plain">戻る</a></p></body></html>`,
  { "Content-Type": "text/html; charset=utf-8" });
}

createDemoServer({
  port: PORT,
  root: PUBLIC,
  async api(req, res, url) {
    const { pathname } = url;

    // ---- WCS_LOCAL=1: the bundles the page names instead of esm.run ----
    if (LOCAL && req.method === "GET" && pathname.startsWith("/packages/")) {
      const file = resolve(REPO_ROOT, "." + pathname);
      if (!file.startsWith(join(REPO_ROOT, "packages"))) return send(res, 403, "Forbidden");
      const body = await readFile(file).catch(() => null);
      if (!body) return send(res, 404, "Not found");
      return send(res, 200, body, { "Content-Type": file.endsWith(".map") ? "application/json" : "text/javascript; charset=utf-8" });
    }

    if (pathname.startsWith("/api/")) return api(req, res, url);
    if (pathname === "/plain") {
      if (req.method === "POST") return plainEcho(req, res);
      return send(res, 200, await readFile(join(PUBLIC, "plain.html")), { "Content-Type": "text/html; charset=utf-8" });
    }
    // Every other extensionless GET is the wizard (history fallback).
    if (req.method === "GET" && extname(pathname) === "") return send(res, 200, await page(), { "Content-Type": "text/html; charset=utf-8" });
    return false;   // state.js, lib/, components/, app.css: the shared static files from public/
  },
  notes: [
    ...(LOCAL ? ["WCS_LOCAL=1: esm.run one-liners rewritten to the local packages/*/dist"] : []),
    "The wizard: /entry/team — the shared controls without wcstack: /plain",
  ],
});
