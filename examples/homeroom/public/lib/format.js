// Pure helpers used by the state module's getters. No DOM, no state — unit-tested directly.
const TZ = "Asia/Tokyo";

export const CATEGORIES = [
  { key: "event", label: "行事" },
  { key: "homework", label: "宿題" },
  { key: "health", label: "保健" },
  { key: "general", label: "連絡" },
];
export const CAT_KEYS = CATEGORIES.map((c) => c.key);
export const catLabel = (key) => CATEGORIES.find((c) => c.key === key)?.label ?? "";

export const REASONS = [
  { key: "illness", label: "病気" },
  { key: "injury", label: "けが" },
  { key: "family", label: "家庭の事情" },
  { key: "other", label: "その他" },
];
export const reasonLabel = (key) => REASONS.find((r) => r.key === key)?.label ?? "";

const dayFmt = new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, month: "long", day: "numeric", weekday: "short" });
const timeFmt = new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

const toDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** "10月17日(土)" */
export function formatDay(iso) {
  const d = toDate(iso);
  return d ? dayFmt.format(d) : "";
}

/** "10月24日(土) 17:00まで" */
export function formatDeadline(iso) {
  const d = toDate(iso);
  return d ? `${dayFmt.format(d)} ${timeFmt.format(d)}まで` : "";
}

/** "10月17日(土) 08:30" — for question / answer times */
export function formatDayTime(iso) {
  const d = toDate(iso);
  return d ? `${dayFmt.format(d)} ${timeFmt.format(d)}` : "";
}

/** "12 KB" / "1.5 MB" */
export function formatSize(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** ISO → { date: "2026-10-24", time: "17:00" } in Japan time; empty strings for null */
export function splitDeadline(iso) {
  const d = toDate(iso);
  if (!d) return { date: "", time: "" };
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/**
 * The form's date + time inputs → an ISO string in Japan time, or null for "no deadline".
 * A date without a time means 17:00 (the end of the school day). A time without a date is an error.
 */
export function joinDeadline(date, time) {
  const d = (date ?? "").trim();
  const t = (time ?? "").trim();
  if (!d && !t) return { value: null, error: null };
  if (!d) return { value: null, error: "日付も入力してください。" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { value: null, error: "日付が正しくありません。" };
  const tt = t || "17:00";
  if (!/^\d{2}:\d{2}$/.test(tt)) return { value: null, error: "時刻が正しくありません。" };
  return { value: `${d}T${tt}:00+09:00`, error: null };
}

/** today in Japan time, "2026-10-31" */
export function todayJst(now = new Date()) {
  return splitDeadline(now.toISOString()).date;
}

/** Initials for the avatar: the first letter of each of the first two words (Latin), else the first character. */
export function initials(name) {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (/^[A-Za-z]/.test(words[0])) return words.slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  return [...words[0]][0];
}

/** A `next` target is followed only when it is a path inside this app (never another origin). */
export function safeNext(next, fallback = "/notices") {
  if (typeof next !== "string" || !next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (next === "/login" || next.startsWith("/login?")) return fallback;
  return next;
}

/** Notices list query → canonical route path ("/notices?cat=event&page=2"); defaults are omitted. */
export function noticesPath({ cat = "", page = 1 } = {}) {
  const sp = new URLSearchParams();
  if (cat) sp.set("cat", cat);
  if (page > 1) sp.set("page", String(page));
  const s = sp.toString();
  return "/notices" + (s ? "?" + s : "");
}

/**
 * The same path for a <wcs-link to>: without a query it ends with "?" — an explicit, empty query, so the link is
 * the current page only where the URL has none (router 4.11). A bare "/notices" compares the pathname only.
 */
export function noticesLinkTo(options) {
  const path = noticesPath(options);
  return path.includes("?") ? path : path + "?";
}

/** Parse ?page= from the router's searchParams (strings) */
export function parsePage(value) {
  const n = parseInt(value ?? "", 10);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * Merge questions by id: the server's list is authoritative for the rows it has; rows we hold that it
 * does not (a question that arrived over the socket while the GET was in flight) are kept. Sorted by id.
 */
export function mergeQuestions(local, incoming) {
  const byId = new Map();
  for (const q of local ?? []) byId.set(q.id, q);
  for (const q of incoming ?? []) byId.set(q.id, q);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/** Client-side attachment check (the server checks again: 413 / 415). */
export const MAX_FILE = 5 * 1024 * 1024;
export const ALLOWED_TYPES = ["application/pdf", "image/png", "image/jpeg"];
export function checkFile(file) {
  if (!file) return null;
  if (file.size > MAX_FILE) return "5MBを超えるファイルは添付できません。";
  if (!ALLOWED_TYPES.includes(file.type)) return "PDF・PNG・JPEG のみ添付できます。";
  return null;
}
export function uploadErrorMessage(status) {
  if (status === 413) return "ファイルが大きすぎます（5MBまで）。";
  if (status === 415) return "この種類のファイルは添付できません（PDF・PNG・JPEG）。";
  if (status === 401) return "ログインの有効期限が切れました。";
  if (status === 0) return "通信できませんでした。";
  return "アップロードに失敗しました。";
}
