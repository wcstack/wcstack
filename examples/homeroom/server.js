/**
 * homeroom — 3年B組 連絡帳, a class's notice board: the API, the WebSocket and the static files, in one server that
 * serves one of two copies of the app at the same origin (so both read the same localStorage):
 *
 *   public/   the app as it is now (upgraded from 4.2.0), loading the unpinned esm.run one-liners
 *   v4.2.0/   the app as it was written on wcstack 4.2.0, every URL pinned @4.2.0, with its workarounds
 *
 *   cd examples/homeroom && npm install       once: `ws`, and the 4.2.0 packages under npm aliases (for WCS_LOCAL=1)
 *   node server.js                             http://localhost:5566/ (PORT=… to change; TOKEN_TTL=<seconds>, default 1800)
 *   PUBLIC_DIR=v4.2.0 node server.js           the 4.2.0 copy (POST /api/_test/public-dir switches it while running)
 *   WCS_LOCAL=1 node server.js                 no CDN: the current copy's one-liners become this repository's
 *                                              packages/*\/dist, the 4.2.0 copy's @4.2.0 URLs the npm aliases' files
 *
 * Node built-ins plus `ws`. Data lives in memory and is seeded with 25 notices.
 * Accounts: teacher sato / sensei1; parents tanaka / oya1 (田中 一郎), suzuki / oya2 (鈴木 二郎).
 *
 * API (Authorization: Bearer <token> on everything but the login; the socket takes ?token=):
 *   POST /api/login { id, password }          → 200 { token, user } | 401
 *   POST /api/logout                          → 204 (the server forgets the token)
 *   GET  /api/notices?cat=&page=              → { items, page, pages, total } (10 a page, newest first)
 *   POST /api/notices { title, cat, body, deadline } (teacher)        → 201 notice | 422 { errors: { field: message } }
 *   GET  /api/notices/:id                     → notice | 404     PUT /api/notices/:id (teacher) → 200 | 422
 *   POST /api/notices/:id/read                → 204
 *   GET  /api/notices/:id/questions           → [question]
 *   POST /api/notices/:id/attachments         multipart, the file in "file" (PDF / PNG / JPEG, 5 MB) → 201 | 413 | 415
 *   GET  /files/<key>/<name>                  an attachment (a capability URL: a download link cannot carry the token)
 *   GET  /api/absences                        → [absence] (a parent's own; the teacher sees all)
 *   POST /api/absences { date, reason, note } (parent) → 201 | 422
 *   POST /api/client-errors { message, stack, url }    → 204 (the page's error reporter)
 *   WS   /ws/notices/:id?token=               { type: "ask", text } (parent) / { type: "answer", questionId, text }
 *                                             (teacher) in; { type: "question" | "answer" | "auth-error" } out
 *
 * Test hooks (open to anyone — this is an example; used by e2e/tests/homeroom.spec.ts):
 *   POST /api/_test/reset                     fresh data; the default copy served again; delays, failures, the log cleared
 *   POST /api/_test/public-dir { dir }        serve "public" or "v4.2.0" from now on, sessions kept
 *   POST /api/_test/expire                    every token expires now
 *   POST /api/_test/ws/drop                   close every socket (the page reconnects by itself)
 *   POST /api/_test/ws-delay { ms, user? }   hold every WebSocket handshake (of that user id) that long: a socket left connecting
 *   POST /api/_test/fail { path, status, times }  the next requests to that path answer that status
 *   POST /api/_test/clear-category { cat }    delete a category's notices
 *   POST /api/_test/component-delay { ms }    answer the app's own components (/components/*) that late
 *   GET  /api/_test/client-errors             what the error reporter sent
 *   GET  /api/_test/log                       what the server saw: every attachment upload with how its token came
 *                                             (header / query / none) and the answer; every socket opened and closed
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";

const HERE = fileURLToPath(new URL("./", import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const LOCAL = process.env.WCS_LOCAL === "1";
// The two copies of the app. PUBLIC_DIR picks the one served at start; the test hook switches it while the server
// (and its sessions) keeps running — what a deploy and a rollback do under an open tab.
const COPIES = ["public", "v4.2.0"];
const DEFAULT_COPY = COPIES.includes(process.env.PUBLIC_DIR) ? process.env.PUBLIC_DIR : "public";
const copyDir = (copy) => join(HERE, copy) + sep;
let served = DEFAULT_COPY;
let ROOT = copyDir(served);
const PORT = Number(process.env.PORT ?? 5566);

// ---------------------------------------------------------------- WCS_LOCAL=1: the packages without a CDN
// The current copy's one-liners (https://esm.run/@wcstack/<pkg>/auto) become this repository's packages/*/dist;
// the 4.2.0 copy's pinned URLs (…/<pkg>@4.2.0/auto, and the root entry of upload it imports) the published 4.2.0
// files, installed under npm aliases (package.json: "state-4.2.0": "npm:@wcstack/state@4.2.0", …).
const OLD = "4.2.0";
const OLD_PACKAGES = ["autoloader", "fetch", "network", "router", "state", "storage", "upload", "view-transition", "websocket"];
if (LOCAL && !existsSync(join(HERE, "node_modules", `state-${OLD}`))) {
  console.error("examples/homeroom: run `npm install` in examples/homeroom first (the 4.2.0 packages for WCS_LOCAL=1).");
  process.exit(1);
}
function localUrls(text) {
  return text
    .replace(/https:\/\/esm\.run\/@wcstack\/([\w-]+)\/auto/g, (_m, pkg) => `/packages/${pkg}/dist/auto.min.js`)
    .replace(/https:\/\/esm\.run\/@wcstack\/([\w-]+)@(\d+\.\d+\.\d+)(\/auto)?(?=["'])/g, (m, pkg, version, auto) =>
      version === OLD && OLD_PACKAGES.includes(pkg) ? `/vendor/@wcstack/${pkg}@${version}/dist/${auto ? "auto.min.js" : "index.esm.js"}` : m);
}
const TOKEN_TTL = Number(process.env.TOKEN_TTL ?? 1800); // seconds
const MAX_FILE = 5 * 1024 * 1024;
const PAGE_SIZE = 10;
const CATS = ["event", "homework", "health", "general"];
const ALLOWED_TYPES = new Map([
  ["application/pdf", ".pdf"],
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
]);

// ---------------------------------------------------------------- data
const USERS = {
  sato: { id: "sato", password: "sensei1", name: "佐藤 先生", role: "teacher" },
  tanaka: { id: "tanaka", password: "oya1", name: "田中 花子", role: "parent", child: "田中 一郎" },
  suzuki: { id: "suzuki", password: "oya2", name: "鈴木 美咲", role: "parent", child: "鈴木 二郎" },
};
const publicUser = (u) => ({ id: u.id, name: u.name, role: u.role, ...(u.child ? { child: u.child } : {}) });

/** token -> { userId, expiresAt } */
const tokens = new Map();
/** id -> notice; attachments keep their bytes in `data` */
const notices = new Map();
/** noticeId -> question[] */
const questions = new Map();
/** fileKey -> attachment (download by capability URL, see README) */
const files = new Map();
const absences = [];
const clientErrors = [];
/** pathname -> { status, times } */
const failures = new Map();
/** what the server saw, for the tests: GET /api/_test/log */
const log = { uploads: [], sockets: [] };
let openSockets = 0;
let wsDelay = { ms: 0, user: null };   // test hook: hold the handshakes (of one user, or everyone's)
let nextNoticeId = 1;
let nextQuestionId = 1;
let nextAttachmentId = 1;
let nextAbsenceId = 1;

const jstIso = (date) => {
  // ISO 8601 in Japan time with an explicit offset, e.g. 2026-10-17T08:30:00+09:00
  const t = new Date(date.getTime() + 9 * 3600e3).toISOString().slice(0, 19);
  return `${t}+09:00`;
};
const daysAgo = (n, hh = 8, mm = 0) => {
  const d = new Date();
  const jst = new Date(d.getTime() + 9 * 3600e3);
  jst.setUTCDate(jst.getUTCDate() - n);
  jst.setUTCHours(hh, mm, 0, 0);
  return new Date(jst.getTime() - 9 * 3600e3);
};

function seed() {
  const titles = {
    event: ["遠足のお知らせ", "授業参観について", "運動会の練習日程", "音楽会のご案内", "社会科見学（消防署）", "学習発表会について", "避難訓練の実施"],
    homework: ["今週の漢字練習", "算数プリント（分数）", "夏休み自由研究の提出", "音読カードについて", "計算ドリル p.30〜35", "読書感想文の書き方", "社会の調べ学習"],
    health: ["インフルエンザ予防接種", "歯科検診の結果", "保健だより10月号", "視力検査のお知らせ", "熱中症に気をつけましょう", "感染症の流行について"],
    general: ["学級通信 第12号", "持ち物のお願い", "個人面談の日程調整", "図書室の利用について", "給食費の引き落とし"],
  };
  const order = [];
  for (const cat of CATS) for (const t of titles[cat]) order.push({ cat, title: t });
  // interleave so every page has a mix of categories
  order.sort((a, b) => (a.title.length % 5) - (b.title.length % 5) || a.title.localeCompare(b.title, "ja"));
  order.forEach((n, i) => {
    const id = nextNoticeId++;
    const posted = daysAgo(order.length - 1 - i, 7 + (i % 3), 15 * (i % 4));
    const hasDeadline = n.cat === "event" || n.cat === "homework" || i % 4 === 0;
    const deadline = hasDeadline ? daysAgo(order.length - 1 - i - 7, 17, 0) : null;
    const notice = {
      id,
      title: n.title,
      cat: n.cat,
      body: `${n.title}についてお知らせします。\n\nご家庭でもお子さんと一緒にご確認ください。ご不明な点は下の「質問と回答」からお気軽にどうぞ。\n\n3年B組 担任 佐藤`,
      postedAt: jstIso(posted),
      deadline: deadline ? jstIso(deadline) : null,
      attachments: [],
      readBy: new Set(),
    };
    if (i % 5 === 0) addAttachment(notice, `${n.title}.pdf`, "application/pdf", Buffer.from("%PDF-1.4\n% sample\n"));
    if (i % 7 === 0) addAttachment(notice, "地図.png", "image/png", Buffer.from("89504e470d0a1a0a", "hex"));
    notices.set(id, notice);
    questions.set(id, []);
  });
  // a few questions on the newest notices
  const newest = [...notices.values()].sort(byPostedDesc).slice(0, 3);
  addQuestion(newest[0].id, USERS.tanaka, "持ち物に水筒は必要ですか？", "はい、お茶か水を入れて持たせてください。");
  addQuestion(newest[0].id, USERS.suzuki, "雨天の場合はどうなりますか？", null);
  addQuestion(newest[1].id, USERS.suzuki, "提出は月曜日でも大丈夫でしょうか。", "月曜日の朝までで大丈夫です。");
  // tanaka has read the two oldest notices
  const oldest = [...notices.values()].sort(byPostedDesc).slice(-2);
  for (const n of oldest) n.readBy.add("tanaka");
  absences.push({ id: nextAbsenceId++, userId: "suzuki", child: USERS.suzuki.child, date: jstIso(daysAgo(3)).slice(0, 10), reason: "illness", note: "発熱のため", createdAt: jstIso(daysAgo(3, 7, 10)) });
}

function addAttachment(notice, name, type, data) {
  const id = nextAttachmentId++;
  const key = randomBytes(12).toString("hex");
  const att = { id, name, size: data.length, type, data, key, url: `/files/${key}/${encodeURIComponent(name)}` };
  notice.attachments.push(att);
  files.set(key, att);
  return att;
}
function addQuestion(noticeId, user, text, answerText) {
  const q = {
    id: nextQuestionId++,
    from: user.name,
    fromId: user.id,
    text,
    at: jstIso(new Date()),
    answer: answerText ? { text: answerText, at: jstIso(new Date()) } : null,
  };
  questions.get(noticeId).push(q);
  return q;
}
const byPostedDesc = (a, b) => (a.postedAt < b.postedAt ? 1 : a.postedAt > b.postedAt ? -1 : b.id - a.id);
const publicAttachment = (a) => ({ id: a.id, name: a.name, size: a.size, url: a.url });
const listItem = (n, userId) => ({
  id: n.id, title: n.title, cat: n.cat, postedAt: n.postedAt, deadline: n.deadline,
  read: n.readBy.has(userId), attachments: n.attachments.length,
});
const fullNotice = (n, userId) => ({
  id: n.id, title: n.title, cat: n.cat, body: n.body, postedAt: n.postedAt, deadline: n.deadline,
  read: n.readBy.has(userId), attachments: n.attachments.map(publicAttachment),
});

seed();

// ---------------------------------------------------------------- helpers
function send(res, status, body, headers = {}) {
  if (body === undefined || status === 204) {
    res.writeHead(status, headers);
    res.end();
    return;
  }
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(json);
}
function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error("too large"), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
async function readJson(req) {
  const buf = await readBody(req);
  if (buf.length === 0) return {};
  try { return JSON.parse(buf.toString("utf8")); } catch { return null; }
}
function authUser(req, url) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : url?.searchParams.get("token") ?? "";
  const entry = tokens.get(token);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return USERS[entry.userId];
}
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? "");
  if (!m) return [];
  const boundary = Buffer.from("--" + (m[1] ?? m[2]));
  const parts = [];
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length;
    if (buf.slice(start, start + 2).toString() === "--") break;
    const headerEnd = buf.indexOf("\r\n\r\n", start);
    if (headerEnd === -1) break;
    const headerText = buf.slice(start + 2, headerEnd).toString("utf8");
    const next = buf.indexOf(boundary, headerEnd);
    if (next === -1) break;
    const data = buf.slice(headerEnd + 4, next - 2);
    const headers = {};
    for (const line of headerText.split("\r\n")) {
      const i = line.indexOf(":");
      if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    const disp = headers["content-disposition"] ?? "";
    const name = /name="([^"]*)"/.exec(disp)?.[1];
    const filename = /filename\*=UTF-8''([^;]+)/i.exec(disp)?.[1] ?? /filename="([^"]*)"/.exec(disp)?.[1];
    parts.push({ name, filename: filename ? safeDecode(filename) : undefined, type: headers["content-type"], data });
    pos = next;
  }
  return parts;
}
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

function validateNotice(body) {
  const errors = {};
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!title) errors.title = "タイトルを入力してください。";
  else if ([...title].length > 60) errors.title = "タイトルは60文字以内で入力してください。";
  if (!CATS.includes(body?.cat)) errors.cat = "区分を選んでください。";
  if (!text) errors.body = "本文を入力してください。";
  let deadline = null;
  if (body?.deadline != null && body.deadline !== "") {
    const d = new Date(body.deadline);
    if (Number.isNaN(d.getTime())) errors.deadline = "締め切りの日時が正しくありません。";
    else if (d.getTime() < Date.now()) errors.deadline = "締め切りに過去の日時は指定できません。";
    else deadline = jstIso(d);
  }
  return { errors, value: { title, cat: body?.cat, body: text, deadline } };
}
const REASONS = ["illness", "injury", "family", "other"];
function validateAbsence(body) {
  const errors = {};
  const date = typeof body?.date === "string" ? body.date : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.date = "日付を入力してください。";
  else {
    const today = jstIso(new Date()).slice(0, 10);
    const limit = jstIso(new Date(Date.now() - 30 * 86400e3)).slice(0, 10);
    if (date < limit) errors.date = "30日より前の日付は届け出できません。";
    else if (date > jstIso(new Date(Date.now() + 365 * 86400e3)).slice(0, 10)) errors.date = "日付が正しくありません。";
    void today;
  }
  if (!REASONS.includes(body?.reason)) errors.reason = "理由を選んでください。";
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if ([...note].length > 200) errors.note = "メモは200文字以内で入力してください。";
  return { errors, value: { date, reason: body?.reason, note } };
}

// ---------------------------------------------------------------- websocket rooms
/** noticeId -> Set<ws> */
const rooms = new Map();
function broadcast(noticeId, payload) {
  const text = JSON.stringify(payload);
  for (const ws of rooms.get(noticeId) ?? []) if (ws.readyState === 1) ws.send(text);
}

// ---------------------------------------------------------------- routes
async function api(req, res, url) {
  const path = url.pathname;
  const method = req.method;

  const fail = failures.get(path);
  if (fail && fail.times > 0 && !path.startsWith("/api/_test/")) {
    fail.times -= 1;
    if (fail.times <= 0) failures.delete(path);
    // read the request first: answering in the middle of an upload resets the connection, and the browser
    // then reports a network error instead of the status
    await readBody(req, 64 * 1024 * 1024).catch(() => {});
    send(res, fail.status, { error: "injected failure" });
    return;
  }

  // --- open endpoints
  if (path === "/api/login" && method === "POST") {
    const body = await readJson(req);
    const user = USERS[body?.id];
    if (!user || user.password !== body?.password) { send(res, 401, { error: "ユーザーIDかパスワードが違います。" }); return; }
    const token = randomUUID();
    tokens.set(token, { userId: user.id, expiresAt: Date.now() + TOKEN_TTL * 1000 });
    send(res, 200, { token, user: publicUser(user) });
    return;
  }
  if (path === "/api/_test/expire" && method === "POST") {
    for (const entry of tokens.values()) entry.expiresAt = 0;
    send(res, 204);
    return;
  }
  if (path === "/api/_test/ws/drop" && method === "POST") {
    for (const set of rooms.values()) for (const ws of set) ws.close(1012, "dropped for test");
    send(res, 204);
    return;
  }
  if (path === "/api/_test/fail" && method === "POST") {
    const body = await readJson(req);
    if (!body?.path) { send(res, 400, { error: "path required" }); return; }
    failures.set(body.path, { status: Number(body.status ?? 500), times: Number(body.times ?? 1) });
    send(res, 204);
    return;
  }
  if (path === "/api/_test/client-errors" && method === "GET") { send(res, 200, clientErrors); return; }
  if (path === "/api/_test/clear-category" && method === "POST") {
    const body = await readJson(req);
    for (const [id, n] of notices) if (n.cat === body?.cat) notices.delete(id);
    send(res, 204);
    return;
  }
  if (path === "/api/_test/reset" && method === "POST") {
    // drop what tests created: notices beyond the seed, questions, absences, errors
    notices.clear(); questions.clear(); files.clear(); absences.length = 0; clientErrors.length = 0; failures.clear();
    nextNoticeId = 1; nextQuestionId = 1; nextAttachmentId = 1; nextAbsenceId = 1;
    seed();
    // …and the server's switches: the default copy, no delays, an empty log
    served = DEFAULT_COPY; ROOT = copyDir(served);
    componentDelayMs = 0; wsDelay = { ms: 0, user: null };
    log.uploads.length = 0; log.sockets.length = 0;
    send(res, 204);
    return;
  }
  if (path === "/api/_test/ws-delay" && method === "POST") {
    const body = await readJson(req);
    wsDelay = { ms: Number(body?.ms ?? 0), user: typeof body?.user === "string" ? body.user : null };
    send(res, 204);
    return;
  }
  if (path === "/api/_test/log" && method === "GET") { send(res, 200, { served, openSockets, ...log }); return; }

  // --- everything else needs a token
  const user = authUser(req);
  if (!user) { send(res, 401, { error: "ログインが必要です。" }); return; }

  if (path === "/api/client-errors" && method === "POST") {
    const body = await readJson(req);
    clientErrors.push({ message: String(body?.message ?? ""), stack: String(body?.stack ?? ""), url: String(body?.url ?? ""), user: user.id, at: jstIso(new Date()) });
    if (clientErrors.length > 500) clientErrors.shift();
    send(res, 204);
    return;
  }
  if (path === "/api/logout" && method === "POST") {
    const token = req.headers.authorization.slice(7);
    tokens.delete(token);
    send(res, 204);
    return;
  }
  if (path === "/api/notices" && method === "GET") {
    const cat = CATS.includes(url.searchParams.get("cat")) ? url.searchParams.get("cat") : null;
    const all = [...notices.values()].filter((n) => !cat || n.cat === cat).sort(byPostedDesc);
    const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const items = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((n) => listItem(n, user.id));
    send(res, 200, { items, page, pages, total: all.length });
    return;
  }
  if (path === "/api/notices" && method === "POST") {
    if (user.role !== "teacher") { send(res, 403, { error: "先生のみ投稿できます。" }); return; }
    const { errors, value } = validateNotice(await readJson(req));
    if (Object.keys(errors).length) { send(res, 422, { errors }); return; }
    const id = nextNoticeId++;
    const notice = { id, ...value, postedAt: jstIso(new Date()), attachments: [], readBy: new Set([user.id]) };
    notices.set(id, notice);
    questions.set(id, []);
    send(res, 201, fullNotice(notice, user.id));
    return;
  }
  if (path === "/api/absences" && method === "GET") {
    const list = absences.filter((a) => user.role === "teacher" || a.userId === user.id)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id))
      .map(({ userId, ...a }) => a);
    send(res, 200, list);
    return;
  }
  if (path === "/api/absences" && method === "POST") {
    if (user.role !== "parent") { send(res, 403, { error: "保護者のみ届け出できます。" }); return; }
    const { errors, value } = validateAbsence(await readJson(req));
    if (Object.keys(errors).length) { send(res, 422, { errors }); return; }
    const absence = { id: nextAbsenceId++, userId: user.id, child: user.child, ...value, createdAt: jstIso(new Date()) };
    absences.push(absence);
    const { userId, ...out } = absence;
    send(res, 201, out);
    return;
  }

  let m = /^\/api\/notices\/(\d+)(?:\/(read|attachments|questions))?$/.exec(path);
  if (m) {
    const notice = notices.get(Number(m[1]));
    if (!notice) { send(res, 404, { error: "お知らせが見つかりません。" }); return; }
    const sub = m[2];
    if (!sub && method === "GET") { send(res, 200, fullNotice(notice, user.id)); return; }
    if (!sub && method === "PUT") {
      if (user.role !== "teacher") { send(res, 403, { error: "先生のみ編集できます。" }); return; }
      const { errors, value } = validateNotice(await readJson(req));
      if (Object.keys(errors).length) { send(res, 422, { errors }); return; }
      Object.assign(notice, value);
      send(res, 200, fullNotice(notice, user.id));
      return;
    }
    if (sub === "read" && method === "POST") { notice.readBy.add(user.id); send(res, 204); return; }
    if (sub === "questions" && method === "GET") {
      send(res, 200, questions.get(notice.id).map(({ fromId, ...q }) => q));
      return;
    }
    if (sub === "attachments" && method === "POST") {
      if (user.role !== "teacher") { send(res, 403, { error: "先生のみ添付できます。" }); return; }
      const length = Number(req.headers["content-length"] ?? 0);
      if (length > MAX_FILE + 64 * 1024) { req.resume(); send(res, 413, { error: "ファイルは5MBまでです。" }, { Connection: "close" }); return; }
      let buf;
      try { buf = await readBody(req, MAX_FILE + 64 * 1024); }
      catch (e) { send(res, e.status ?? 400, { error: "ファイルは5MBまでです。" }, { Connection: "close" }); return; }
      const part = parseMultipart(buf, req.headers["content-type"]).find((p) => p.name === "file" && p.filename);
      if (!part) { send(res, 400, { error: "file フィールドがありません。" }); return; }
      if (part.data.length > MAX_FILE) { send(res, 413, { error: "ファイルは5MBまでです。" }); return; }
      const type = (part.type ?? "").toLowerCase();
      if (!ALLOWED_TYPES.has(type)) { send(res, 415, { error: "PDF・PNG・JPEG のみ添付できます。" }); return; }
      const att = addAttachment(notice, part.filename, type, part.data);
      send(res, 201, publicAttachment(att));
      return;
    }
  }
  send(res, 404, { error: "not found" });
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".map": "application/json; charset=utf-8",
};
// Test hook: delay the app's own component scripts (simulates a slow network).
let componentDelayMs = Number(process.env.COMPONENT_DELAY_MS ?? 0);

/** a file of a package, under WCS_LOCAL=1: /packages/<pkg>/… (this repository) or /vendor/@wcstack/<pkg>@4.2.0/… */
async function packageFile(res, pathname) {
  let dir, rel, m;
  if ((m = /^\/packages\/([\w-]+)(\/.*)$/.exec(pathname))) [dir, rel] = [join(REPO_ROOT, "packages", m[1]), m[2]];
  else if ((m = /^\/vendor\/@wcstack\/([\w-]+)@([\d.]+)(\/.*)$/.exec(pathname)) && m[2] === OLD && OLD_PACKAGES.includes(m[1])) {
    [dir, rel] = [join(HERE, "node_modules", `${m[1]}-${OLD}`), m[3]];
  } else { send(res, 404, { error: "not found" }); return; }
  const file = resolve(dir, "." + rel);
  if (!file.startsWith(dir + sep)) { send(res, 403, { error: "forbidden" }); return; }
  const data = await readFile(file).catch(() => null);
  if (!data) { send(res, 404, { error: "not found" }); return; }
  res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
  res.end(data);
}

async function staticFile(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (LOCAL && (pathname.startsWith("/packages/") || pathname.startsWith("/vendor/"))) { await packageFile(res, pathname); return; }
  const fm = /^\/files\/([0-9a-f]+)\//.exec(pathname);
  if (fm) {
    const att = files.get(fm[1]);
    if (!att) { send(res, 404, { error: "not found" }); return; }
    res.writeHead(200, {
      "Content-Type": att.type,
      "Content-Length": att.size,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(att.name)}`,
    });
    res.end(att.data);
    return;
  }
  if (extname(pathname) === "") pathname = "/index.html"; // SPA fallback
  const file = normalize(join(ROOT, pathname));
  if (!file.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) { send(res, 403, { error: "forbidden" }); return; }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    let data = await readFile(file);
    if (LOCAL && (extname(file) === ".html" || extname(file) === ".js")) data = localUrls(data.toString("utf8"));
    if (componentDelayMs > 0 && pathname.startsWith("/components/")) await new Promise((r) => setTimeout(r, componentDelayMs));
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  } catch {
    send(res, 404, { error: "not found" });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  try {
    if (url.pathname === "/api/_test/public-dir" && req.method === "POST") {
      const body = await readJson(req);
      if (!COPIES.includes(body?.dir)) { send(res, 400, { error: `dir: ${COPIES.join(" | ")}` }); return; }
      served = body.dir;
      ROOT = copyDir(served);
      console.log("now serving", served);
      send(res, 204);
      return;
    }
    if (url.pathname === "/api/_test/component-delay" && req.method === "POST") {
      const body = await readJson(req);
      componentDelayMs = Number(body?.ms ?? 0);
      send(res, 204);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      const upload = req.method === "POST" && /^\/api\/notices\/\d+\/attachments$/.test(url.pathname);
      const auth = (req.headers.authorization ?? "").startsWith("Bearer ") ? "header" : url.searchParams.has("token") ? "query" : "none";
      await api(req, res, url);
      if (upload) log.uploads.push({ at: Date.now(), path: url.pathname, auth, status: res.statusCode });
    } else await staticFile(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: "server error" });
  }
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", async (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const m = /^\/ws\/notices\/(\d+)$/.exec(url.pathname);
  if (!m || !notices.has(Number(m[1]))) { socket.write("HTTP/1.1 404 Not Found\r\n\r\n"); socket.destroy(); return; }
  socket.on("error", () => {});   // a browser that gave up on a held handshake resets the connection
  const held = wsDelay.ms > 0 && (wsDelay.user === null || authUser(req, url)?.id === wsDelay.user);
  if (held) await new Promise((r) => setTimeout(r, wsDelay.ms));   // test hook: the socket stays connecting
  if (socket.destroyed || !socket.readable || !socket.writable) { socket.destroy(); log.sockets.push({ at: Date.now(), noticeId: Number(m[1]), event: "gave-up" }); return; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const noticeId = Number(m[1]);
    openSockets += 1;
    log.sockets.push({ at: Date.now(), noticeId, event: "open" });
    ws.on("close", (code) => { openSockets -= 1; log.sockets.push({ at: Date.now(), noticeId, event: "close", code }); });
    const user = authUser(req, url);
    if (!user) {
      // Accept, say why, and close with an application code — a refused handshake only shows the
      // browser a generic failure (and a console error), with no way to tell "expired" from "down".
      ws.send(JSON.stringify({ type: "auth-error" }));
      ws.close(4401, "unauthorized");
      return;
    }
    if (!rooms.has(noticeId)) rooms.set(noticeId, new Set());
    rooms.get(noticeId).add(ws);
    ws.on("close", () => rooms.get(noticeId)?.delete(ws));
    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString("utf8")); } catch { return; }
      const live = tokens.get(new URL(req.url, "http://x").searchParams.get("token"));
      if (!live || live.expiresAt <= Date.now()) { ws.send(JSON.stringify({ type: "auth-error" })); ws.close(4401, "unauthorized"); return; }
      if (msg?.type === "ask" && user.role === "parent") {
        const text = String(msg.text ?? "").trim().slice(0, 500);
        if (!text) return;
        const q = addQuestion(noticeId, user, text, null);
        const { fromId, ...out } = q;
        broadcast(noticeId, { type: "question", question: out });
      } else if (msg?.type === "answer" && user.role === "teacher") {
        const q = questions.get(noticeId).find((x) => x.id === Number(msg.questionId));
        const text = String(msg.text ?? "").trim().slice(0, 1000);
        if (!q || !text) return;
        q.answer = { text, at: jstIso(new Date()) };
        broadcast(noticeId, { type: "answer", questionId: q.id, answer: q.answer });
      }
    });
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`homeroom (3年B組 連絡帳) on http://localhost:${PORT}/ — serving ${served}/  (TOKEN_TTL=${TOKEN_TTL}s, pid ${process.pid})`);
  if (LOCAL) console.log("  WCS_LOCAL=1: the one-liners → packages/*/dist, the @4.2.0 URLs → node_modules/<pkg>-4.2.0");
});
