// Pure helpers for the ledger (no DOM, no wcstack) — unit-tested in tests/lib.test.js.

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export const SORTS = ["date", "-date", "amount", "-amount"];

export function isValidMonth(m) {
  return typeof m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
}

export function monthOfDate(date, fallback) {
  const m = typeof date === "string" ? date.slice(0, 7) : "";
  return isValidMonth(m) ? m : fallback;
}

export function currentMonth(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function todayString(now = new Date()) {
  return `${currentMonth(now)}-${String(now.getDate()).padStart(2, "0")}`;
}

export function shiftMonth(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(month) {
  if (!isValidMonth(month)) return "";
  const [y, m] = month.split("-").map(Number);
  return `${y}年${m}月`;
}

export function formatYen(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  return `${n < 0 ? "-" : ""}¥${Math.abs(n).toLocaleString("ja-JP")}`;
}

// "2026-10-26" -> "10月26日(月)"
export function formatDateLabel(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
  if (!m) return date || "";
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return `${mo}月${d}日(${WEEKDAYS[wd]})`;
}

export function normalizeSort(sort) {
  return SORTS.includes(sort) ? sort : "date";
}

export function filterAndSort(entries, category, sort) {
  const list = (entries || []).filter((e) => !category || e.categoryId === category);
  const key = normalizeSort(sort);
  const dir = key.startsWith("-") ? -1 : 1;
  const field = key.replace("-", "");
  return list.slice().sort((a, b) => {
    const av = field === "amount" ? a.amount : a.date;
    const bv = field === "amount" ? b.amount : b.date;
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return (a.id - b.id) * dir;
  });
}

export function monthTotal(entries) {
  return (entries || []).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
}

// Per category: spent against budget. `percent` is capped at 100 for the bar; `over` is true when spent > budget.
export function categorySummaries(entries, budgets, categories) {
  const spent = {};
  for (const e of entries || []) spent[e.categoryId] = (spent[e.categoryId] || 0) + (Number(e.amount) || 0);
  return (categories || []).map((c) => {
    const s = spent[c.id] || 0;
    const b = budgets && typeof budgets[c.id] === "number" ? budgets[c.id] : null;
    const over = b !== null && s > b;
    const percent = b === null ? 0 : b === 0 ? (s > 0 ? 100 : 0) : Math.min(100, Math.round((s / b) * 100));
    return {
      id: c.id, name: c.name, color: c.color, spent: s, budget: b, over, percent,
      spentLabel: formatYen(s), budgetLabel: b === null ? "予算なし" : formatYen(b),
      remainingLabel: b === null ? "" : over ? `${formatYen(s - b)} 超過` : `残り ${formatYen(b - s)}`,
    };
  });
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// rows: [{ date, categoryName, memo, amount, by }]
export function toCsv(rows) {
  const head = ["日付", "カテゴリ", "メモ", "金額", "入力者"];
  const lines = [head, ...(rows || []).map((r) => [r.date, r.categoryName, r.memo, r.amount, r.by])];
  return lines.map((l) => l.map(csvCell).join(",")).join("\r\n");
}

// The amount field is free text so the server can judge it: "1200" -> 1200, "abc" / "-5.5" stay strings.
export function parseAmount(text) {
  const s = String(text ?? "").trim();
  if (s === "") return "";
  return /^-?\d+$/.test(s) ? Number(s) : s;
}

// `error` of <wcs-fetch> on an HTTP error is { status, statusText, body } (body = response text).
export function parseErrorBody(error) {
  if (!error || typeof error.body !== "string") return null;
  try { return JSON.parse(error.body); } catch { return null; }
}

export function parseFieldErrors(error) {
  if (!error || error.status !== 422) return {};
  const body = parseErrorBody(error);
  return body && body.errors && typeof body.errors === "object" ? { ...body.errors } : {};
}

export function describeError(error) {
  if (!error) return "";
  if (typeof error.status === "number") {
    const body = parseErrorBody(error);
    if (body && typeof body.error === "string") return `${error.status}: ${body.error}`;
    return `HTTP ${error.status}`;
  }
  return error.message || "ネットワークエラー";
}

export const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const RECEIPT_MAX = 5 * 1024 * 1024;

export function receiptProblem(file) {
  if (!file) return "";
  if (!RECEIPT_TYPES.includes(file.type)) return "領収書は JPEG / PNG / WebP の画像だけ選べます。";
  if (file.size > RECEIPT_MAX) return "領収書のサイズが 5MB を超えています。小さい画像を選んでください。";
  return "";
}

// "?delay=3000&fail=1" style developer switches ride along on every API call.
export function devParams(query) {
  const p = [];
  if (query && query.delay) p.push(`delay=${encodeURIComponent(query.delay)}`);
  if (query && query.fail) p.push(`fail=${encodeURIComponent(query.fail)}`);
  return p;
}

export function withParams(path, params) {
  if (!params.length) return path;
  return path + (path.includes("?") ? "&" : "?") + params.join("&");
}

export function buildQuery(query, changes) {
  const merged = { ...(query || {}), ...changes };
  const parts = [];
  for (const [k, v] of Object.entries(merged)) {
    if (k === "next") continue;
    if (v === undefined || v === null || v === "") continue;
    if (k === "sort" && v === "date") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return "?" + parts.join("&");
}

// Only same-origin absolute paths may be used as the post-login destination.
export function safeNext(next) {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "";
}
