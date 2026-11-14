// Pure logic of the entry — no DOM, no wcstack. Shared by the page, the route guards, the server and the unit tests.

export const RACE_DAY = "2027-03-07";
export const DIVISIONS = ["一般", "高校生", "中学生", "ミックス"];
export const DIVISION_FEE = { 一般: 12000, ミックス: 10000, 高校生: 8000, 中学生: 5000 };
export const RESERVE_FEE = 1000;
export const PARKING_FEE = 500;
export const LUNCH_FEE = 800;
export const LEGS = 5;
export const MAX_RUNNERS = 7;
export const SEXES = [{ value: "male", label: "男" }, { value: "female", label: "女" }, { value: "none", label: "回答しない" }];
export const SHIRTS = ["S", "M", "L", "XL"];
export const PAYMENTS = [
  { value: "transfer", label: "銀行振込" },
  { value: "konbini", label: "コンビニ払い" },
  { value: "cash", label: "当日現金" },
];
export const STORES = ["セブン-イレブン", "ローソン", "ファミリーマート", "ミニストップ", "デイリーヤマザキ", "セイコーマート"];
export const STEPS = [
  { key: "team", path: "/entry/team", label: "チームと代表者" },
  { key: "runners", path: "/entry/runners", label: "走者" },
  { key: "options", path: "/entry/options", label: "オプションと支払い" },
  { key: "confirm", path: "/entry/confirm", label: "確認" },
  { key: "done", path: "/entry/done", label: "完了" },
];

export const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県",
  "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県", "三重県",
  "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県",
  "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
].map((name, i) => ({ code: String(i + 1).padStart(2, "0"), name }));

// ---------- characters ----------
const FW_DIGITS = /[０-９]/g;
/** Keep half-width digits only: full-width digits are converted, everything else (hyphens, 〒, ー, spaces) dropped. */
export function digitsOnly(s) {
  return String(s ?? "").replace(FW_DIGITS, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\D/g, "");
}

/** Phone number grouping as Japanese forms show it, also for a partial number. */
export function phoneGroups(d) {
  if (/^0(120|800)/.test(d)) return [4, 3, 3];
  if (/^0[5789]0/.test(d)) return [3, 4, 4];
  if (/^0[36]/.test(d)) return [2, 4, 4];
  return [3, 3, 4];
}
function group(d, sizes, sep) {
  const out = []; let i = 0;
  for (const n of sizes) { if (i >= d.length) break; out.push(d.slice(i, i + n)); i += n; }
  if (i < d.length) out[out.length - 1] += d.slice(i);
  return out.join(sep);
}
export const FORMATS = {
  phone: { max: 11, format: (d) => group(d, phoneGroups(d), "-") },
  postal: { max: 7, format: (d) => group(d, [3, 4], "-") },
  time: { max: 4, format: (d) => (d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`) },
};
export const formatPhone = (s) => FORMATS.phone.format(digitsOnly(s).slice(0, 11));
export const formatPostal = (s) => FORMATS.postal.format(digitsOnly(s).slice(0, 7));
export const formatTime = (s) => FORMATS.time.format(digitsOnly(s).slice(0, 4));

/**
 * Normalise what is in a formatting field and say where the caret goes: after the same number of digits
 * as were before it in the raw text.
 */
export function reformat(kind, raw, caret = raw.length, previous = null) {
  const f = FORMATS[kind];
  let digitsBefore = digitsOnly(raw.slice(0, caret)).length;
  const all = digitsOnly(raw);
  // A digit typed into a field that is already full is refused (as maxlength does), rather than pushing the last
  // digit out unseen; a longer paste into a field that was not full is cut at the limit.
  if (all.length > f.max && previous !== null && previous.length === f.max) {
    digitsBefore = Math.max(0, digitsBefore - (all.length - f.max));
    return reformat(kind, f.format(previous), positionAfterDigits(f.format(previous), digitsBefore));
  }
  const digits = all.slice(0, f.max);
  const text = f.format(digits);
  const want = Math.min(digitsBefore, digits.length);
  let pos = 0; let seen = 0;
  if (want > 0) {
    for (; pos < text.length; pos++) { if (/\d/.test(text[pos])) { seen++; if (seen === want) { pos++; break; } } }
  }
  return { digits, text, caret: pos };
}

function positionAfterDigits(text, n) {
  if (n <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i++) if (/\d/.test(text[i]) && ++seen === n) return i + 1;
  return text.length;
}

/** 5 km time typed as digits "2345" → seconds; null when not a time. */
export function timeToSeconds(d) {
  const s = digitsOnly(d);
  if (s.length < 3 || s.length > 4) return null;
  const mm = Number(s.slice(0, s.length - 2)); const ss = Number(s.slice(-2));
  if (ss >= 60) return null;
  return mm * 60 + ss;
}
export function secondsToDigits(sec) {
  if (sec == null || sec === "") return "";
  const mm = Math.floor(sec / 60); const ss = sec % 60;
  return `${String(mm).padStart(2, "0")}${String(ss).padStart(2, "0")}`;
}

// kana
const HW_KANA = "｡｢｣､･ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ";
const FW_KANA = "。「」、・ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン";
const DAKUTEN_OK = "カキクケコサシスセソタチツテトハヒフヘホウ";
const HANDAKUTEN_OK = "ハヒフヘホ";
/** Hiragana and half-width katakana → full-width katakana; full-width katakana and everything else kept. */
export function toKatakana(s) {
  let out = "";
  const str = String(s ?? "");
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    const code = c.charCodeAt(0);
    if (code >= 0x3041 && code <= 0x3096) { out += String.fromCharCode(code + 0x60); continue; }
    const hw = HW_KANA.indexOf(c);
    if (hw >= 0) {
      let k = FW_KANA[hw];
      const next = str[i + 1];
      if (next === "ﾞ" && DAKUTEN_OK.includes(k)) { k = k === "ウ" ? "ヴ" : String.fromCharCode(k.charCodeAt(0) + 1); i++; }
      else if (next === "ﾟ" && HANDAKUTEN_OK.includes(k)) { k = String.fromCharCode(k.charCodeAt(0) + 2); i++; }
      out += k; continue;
    }
    // A sound mark typed on its own after a kana that takes it (ﾄ, then ﾞ — the earlier ﾄ already converted to ト)
    if (c === "ﾞ" || c === "゛" || c === "゙") {
      const prev = out.slice(-1);
      if (prev && DAKUTEN_OK.includes(prev)) { out = out.slice(0, -1) + (prev === "ウ" ? "ヴ" : String.fromCharCode(prev.charCodeAt(0) + 1)); continue; }
      out += c === "゙" ? c : "゛"; continue;
    }
    if (c === "ﾟ" || c === "゜" || c === "゚") {
      const prev = out.slice(-1);
      if (prev && HANDAKUTEN_OK.includes(prev)) { out = out.slice(0, -1) + String.fromCharCode(prev.charCodeAt(0) + 2); continue; }
      out += c === "゚" ? c : "゜"; continue;
    }
    out += c;
  }
  return out;
}
/** Same as toKatakana, with the caret mapped (a half-width ｶﾞ is two characters and becomes one). */
export function toKatakanaWithCaret(raw, caret = raw.length) {
  const before = toKatakana(raw.slice(0, caret));
  const text = toKatakana(raw);
  return { text, caret: Math.min(before.length, text.length) };
}
export const isKana = (s) => /^[ぁ-ゖァ-ヺーｦ-ﾟ゛゜・ 　]+$/.test(s);
export const isKatakana = (s) => /^[ァ-ヺー・ 　]+$/.test(s);
export const isHiraganaOrKatakanaReading = (s) => /^[ぁ-ゖァ-ヺーー]+$/.test(s);

/** Characters as a person counts them: 𠮷 and an emoji are one. */
export function charCount(s) {
  const str = String(s ?? "");
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    let n = 0;
    for (const _ of new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(str)) n++;
    return n;
  }
  return [...str].length;
}

// ---------- dates ----------
export function parseIso(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ""));
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}
export function ageOn(birthIso, dayIso = RACE_DAY) {
  const b = parseIso(birthIso); const t = parseIso(dayIso);
  if (!b || !t) return null;
  let age = t.y - b.y;
  if (t.m < b.m || (t.m === b.m && t.d < b.d)) age--;
  return age;
}
export const needsConsent = (birthIso) => { const a = ageOn(birthIso); return a !== null && a < 18; };
export function formatDateJa(iso) {
  const p = parseIso(iso);
  return p ? `${p.y}年${p.m}月${p.d}日` : "";
}
export const formatYen = (n) => `¥${Number(n || 0).toLocaleString("en-US")}`;

// ---------- fees ----------
export function feeBreakdown({ division, runnerCount, parking, lunchJa, lunchWestern }) {
  const base = DIVISION_FEE[division] ?? 0;
  const reserves = Math.max(0, (runnerCount || 0) - LEGS);
  const lines = {
    base, reserves, reserveFee: reserves * RESERVE_FEE,
    parkingFee: (Number(parking) || 0) * PARKING_FEE,
    lunchFee: ((Number(lunchJa) || 0) + (Number(lunchWestern) || 0)) * LUNCH_FEE,
  };
  lines.total = lines.base + lines.reserveFee + lines.parkingFee + lines.lunchFee;
  return lines;
}
export const totalFee = (entry) => feeBreakdown({
  division: entry?.team?.division, runnerCount: entry?.runners?.length ?? 0,
  parking: entry?.options?.parking, lunchJa: entry?.options?.lunchJa, lunchWestern: entry?.options?.lunchWestern,
}).total;

// ---------- the entry ----------
export function newRunner(id) {
  return { id, name: "", kana: "", kanaTouched: false, birth: "", sex: "", best: "", shirt: "", emergencyPhone: "", notes: "",
    consentId: "", consentName: "", detailsOpen: false };
}
export function emptyEntry(makeId = () => Math.random().toString(36).slice(2, 10)) {
  return {
    team: { name: "", kana: "", division: "" },
    rep: { name: { family: "", given: "" }, kana: { family: "", given: "" }, birth: "", postal: "", prefecture: "",
      city: "", street: "", building: "", phone: "", email: "", emailConfirm: "" },
    runners: Array.from({ length: LEGS }, () => newRunner(makeId())),
    options: { parking: 0, lunchJa: 0, lunchWestern: 0, message: "", receiptName: "", receiptTouched: false, payment: "",
      transferName: "", store: "" },
  };
}
/** 領収書の宛名: the team name until the user types something else. */
export const effectiveReceiptName = (entry) => (entry.options.receiptTouched ? entry.options.receiptName : entry.team.name);

/** The JSON the server takes. Fields a choice hides are not sent. */
export function toApiEntry(entry) {
  const o = entry.options;
  return {
    team: { name: entry.team.name, kana: entry.team.kana, division: entry.team.division },
    rep: {
      name: { family: entry.rep.name.family, given: entry.rep.name.given },
      kana: { family: entry.rep.kana.family, given: entry.rep.kana.given },
      birth: entry.rep.birth, postal: entry.rep.postal, prefecture: entry.rep.prefecture, city: entry.rep.city,
      street: entry.rep.street, building: entry.rep.building, phone: entry.rep.phone, email: entry.rep.email,
    },
    runners: entry.runners.map((r) => ({
      name: r.name, kana: r.kana, birth: r.birth, sex: r.sex, best: timeToSeconds(r.best), shirt: r.shirt,
      emergencyPhone: r.emergencyPhone, notes: r.notes, consentId: needsConsent(r.birth) ? (r.consentId || null) : null,
    })),
    options: {
      parking: Number(o.parking), lunchJa: Number(o.lunchJa), lunchWestern: Number(o.lunchWestern), message: o.message,
      receiptName: effectiveReceiptName(entry), payment: o.payment,
      ...(o.payment === "transfer" ? { transferName: o.transferName } : {}),
      ...(o.payment === "konbini" ? { store: o.store } : {}),
    },
  };
}

// ---------- validation (messages by API JSON path; runners by index) ----------
const REQUIRED = "入力してください。";
const CHOOSE = "選択してください。";
const KATAKANA = "全角カタカナで入力してください。";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateTeamStep(e) {
  const x = {};
  const name = e.team?.name ?? "";
  if (!name.trim()) x["team.name"] = "チーム名を" + REQUIRED;
  else if (charCount(name) > 20) x["team.name"] = "チーム名は20文字以内で入力してください。";
  if (!e.team?.kana) x["team.kana"] = "チーム名のフリガナを" + REQUIRED;
  else if (!isKatakana(e.team.kana)) x["team.kana"] = "フリガナは" + KATAKANA;
  if (!DIVISIONS.includes(e.team?.division)) x["team.division"] = "部門を" + CHOOSE;
  const r = e.rep ?? {};
  if (!r.name?.family?.trim()) x["rep.name.family"] = "姓を" + REQUIRED;
  if (!r.name?.given?.trim()) x["rep.name.given"] = "名を" + REQUIRED;
  if (!r.kana?.family) x["rep.kana.family"] = "セイを" + REQUIRED;
  else if (!isKatakana(r.kana.family)) x["rep.kana.family"] = "セイは" + KATAKANA;
  if (!r.kana?.given) x["rep.kana.given"] = "メイを" + REQUIRED;
  else if (!isKatakana(r.kana.given)) x["rep.kana.given"] = "メイは" + KATAKANA;
  if (!parseIso(r.birth)) x["rep.birth"] = "生年月日を正しく" + REQUIRED;
  if (!/^\d{7}$/.test(r.postal ?? "")) x["rep.postal"] = "郵便番号を7桁で" + REQUIRED;
  if (!r.prefecture) x["rep.prefecture"] = "都道府県を" + CHOOSE;
  if (!r.city?.trim()) x["rep.city"] = "市区町村を" + REQUIRED;
  if (!r.street?.trim()) x["rep.street"] = "町域・番地を" + REQUIRED;
  if (!/^0\d{9,10}$/.test(r.phone ?? "")) x["rep.phone"] = "電話番号を10〜11桁で" + REQUIRED;
  if (!EMAIL.test(r.email ?? "")) x["rep.email"] = "メールアドレスを正しく" + REQUIRED;
  if (r.emailConfirm !== undefined && r.emailConfirm !== r.email) x["rep.emailConfirm"] = "確認用のメールアドレスが一致しません。";
  return x;
}

export function validateRunnersStep(e) {
  const x = {};
  const runners = e.runners ?? [];
  if (runners.length < LEGS) x["runners"] = `走者は${LEGS}人必要です。`;
  if (runners.length > MAX_RUNNERS) x["runners"] = `走者は補欠を含めて${MAX_RUNNERS}人までです。`;
  runners.forEach((r, i) => {
    const p = `runners.${i}.`;
    if (!r.name?.trim()) x[p + "name"] = "氏名を" + REQUIRED;
    if (!r.kana) x[p + "kana"] = "フリガナを" + REQUIRED;
    else if (!isKatakana(r.kana)) x[p + "kana"] = "フリガナは" + KATAKANA;
    if (!parseIso(r.birth)) x[p + "birth"] = "生年月日を正しく" + REQUIRED;
    if (!SEXES.some((s) => s.value === r.sex)) x[p + "sex"] = "性別を" + CHOOSE;
    const best = typeof r.best === "number" ? r.best : timeToSeconds(r.best);
    if (best == null) x[p + "best"] = "ベストタイムを「分分秒秒」の数字で" + REQUIRED;
    if (!SHIRTS.includes(r.shirt)) x[p + "shirt"] = "Tシャツのサイズを" + CHOOSE;
    if (r.emergencyPhone && !/^0\d{9,10}$/.test(r.emergencyPhone)) x[p + "emergencyPhone"] = "電話番号は10〜11桁の数字です。";
    if (needsConsent(r.birth) && !r.consentId) x[p + "consentId"] = "18歳未満の走者は保護者の同意書をアップロードしてください。";
  });
  return x;
}

export function validateOptionsStep(e) {
  const x = {};
  const o = e.options ?? {};
  const intIn = (v, lo, hi) => Number.isInteger(Number(v)) && Number(v) >= lo && Number(v) <= hi && v !== "" && v !== null;
  if (!intIn(o.parking, 0, 3)) x["options.parking"] = "駐車券は0〜3枚です。";
  if (!intIn(o.lunchJa, 0, 20)) x["options.lunchJa"] = "弁当（和）は0〜20個です。";
  if (!intIn(o.lunchWestern, 0, 20)) x["options.lunchWestern"] = "弁当（洋）は0〜20個です。";
  if (charCount(o.message) > 400) x["options.message"] = "連絡事項は400文字以内で入力してください。";
  const receipt = o.receiptTouched === false ? e.team?.name : o.receiptName;
  if (!String(receipt ?? "").trim()) x["options.receiptName"] = "領収書の宛名を" + REQUIRED;
  if (!PAYMENTS.some((p) => p.value === o.payment)) x["options.payment"] = "支払い方法を" + CHOOSE;
  if (o.payment === "transfer") {
    if (!o.transferName) x["options.transferName"] = "振込名義を" + REQUIRED;
    else if (!isKatakana(o.transferName)) x["options.transferName"] = "振込名義は" + KATAKANA;
  }
  if (o.payment === "konbini" && !STORES.includes(o.store)) x["options.store"] = "コンビニを" + CHOOSE;
  return x;
}

/** Every rule the page checks, on the API JSON (the server runs this too). */
export function validateEntry(api) {
  const asState = {
    team: api?.team ?? {}, rep: { ...(api?.rep ?? {}), emailConfirm: undefined },
    runners: (api?.runners ?? []).map((r) => ({ ...r, best: r?.best })),
    options: api?.options ?? {},
  };
  return { ...validateTeamStep(asState), ...validateRunnersStep(asState), ...validateOptionsStep(asState) };
}

export const STEP_VALIDATORS = { team: validateTeamStep, runners: validateRunnersStep, options: validateOptionsStep };

/** Which step a path belongs to. */
export function stepOfPath(path) {
  const head = String(path).split(".")[0];
  return head === "options" ? "options" : head === "runners" ? "runners" : "team";
}

/** The first of team / runners / options that is not complete, or "confirm". */
export function firstIncompleteStep(entry) {
  if (!entry) return "team";
  for (const key of ["team", "runners", "options"]) {
    if (Object.keys(STEP_VALIDATORS[key](entry)).length) return key;
  }
  return "confirm";
}
export function completedSteps(entry) {
  const done = {};
  for (const key of ["team", "runners", "options"]) done[key] = Object.keys(STEP_VALIDATORS[key](entry)).length === 0;
  return done;
}

/**
 * Messages keyed by row index (`runners.2.birth`, as the server and the validators name them) → keyed by the
 * runner's id, so that a message stays with its runner when rows move.
 */
export function placeErrors(errors, runners) {
  const fields = {}; const byRunner = {}; const steps = new Set(); const unplaced = {};
  for (const [path, msg] of Object.entries(errors ?? {})) {
    steps.add(stepOfPath(path));
    const m = /^runners\.(\d+)\.(\w+)$/.exec(path);
    if (m) {
      const r = runners[Number(m[1])];
      if (!r) { unplaced[path] = msg; continue; }
      (byRunner[r.id] ??= {})[m[2]] = msg;
    } else fields[path] = msg;
  }
  return { fields, byRunner, steps: [...steps], unplaced };
}

/** The order the messages' fields come in, for "focus the first one". */
export const FIELD_ORDER = [
  "team.name", "team.kana", "team.division", "rep.name.family", "rep.name.given", "rep.kana.family", "rep.kana.given",
  "rep.birth", "rep.postal", "rep.prefecture", "rep.city", "rep.street", "rep.building", "rep.phone", "rep.email",
  "rep.emailConfirm", "runners", "options.parking", "options.lunchJa", "options.lunchWestern", "options.message",
  "options.receiptName", "options.payment", "options.transferName", "options.store",
];
export const RUNNER_FIELD_ORDER = ["name", "kana", "birth", "sex", "best", "shirt", "emergencyPhone", "notes", "consentId"];

// ---------- rows ----------
export function moveRow(list, from, to) {
  if (to < 0 || to >= list.length || from === to) return list;
  const copy = list.slice();
  const [row] = copy.splice(from, 1);
  copy.splice(to, 0, row);
  return copy;
}
/** Fastest first; rows with no valid time go last, keeping their order. */
export function sortByBest(list) {
  return list
    .map((r, i) => ({ r, i, t: timeToSeconds(r.best) }))
    .sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity) || a.i - b.i)
    .map((x) => x.r);
}
export const legLabel = (i) => (i < LEGS ? `${i + 1}区` : `補欠${i - LEGS + 1}`);
