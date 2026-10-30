// In-memory data for the city-library seam app. The backend is not under test;
// it only has to honour the contract in the brief.

export const LANGS = ["ja", "en", "ar"];

export const BRANCHES = [
  { id: "central", name: { ja: "中央図書館", en: "Central Library", ar: "المكتبة المركزية" } },
  { id: "riverside", name: { ja: "川辺分館", en: "Riverside Branch", ar: "فرع ضفة النهر" } },
  { id: "hilltop", name: { ja: "丘の上分館", en: "Hilltop Branch", ar: "فرع التل" } },
];

// Weekly hours per branch, in the branch's zone (Asia/Tokyo). null = closed.
// Index 0 = Sunday.
export const WEEKLY_HOURS = {
  central: [["10:00", "18:00"], ["09:00", "20:00"], ["09:00", "20:00"], ["09:00", "20:00"], ["09:00", "20:00"], ["09:00", "22:00"], ["10:00", "18:00"]],
  riverside: [["10:00", "17:00"], null, ["10:00", "19:00"], ["10:00", "19:00"], ["10:00", "19:00"], ["10:00", "19:00"], ["10:00", "17:00"]],
  hilltop: [null, ["09:30", "17:00"], ["09:30", "17:00"], ["09:30", "17:00"], ["09:30", "17:00"], ["09:30", "17:00"], ["09:30", "12:30"]],
};

// `t`: a title per language. `keep`: an English title kept in every language
// (mixed-direction text inside Arabic and Japanese pages).
const RAW = [
  [1, "book", 1905, { ja: "夏目漱石", en: "Natsume Sōseki", ar: "ناتسومي سوسيكي" }, { ja: "吾輩は猫である", en: "I Am a Cat", ar: "أنا قط" }],
  [2, "book", 1948, { ja: "川端康成", en: "Yasunari Kawabata", ar: "ياسوناري كاواباتا" }, { ja: "雪国", en: "Snow Country", ar: "بلد الثلج" }],
  [3, "book", 1987, { ja: "村上春樹", en: "Haruki Murakami", ar: "هاروكي موراكامي" }, { ja: "ノルウェイの森", en: "Norwegian Wood", ar: "الغابة النرويجية" }],
  [4, "book", 1999, { ja: "Andrew Hunt, David Thomas", en: "Andrew Hunt, David Thomas", ar: "Andrew Hunt, David Thomas" }, null, "The Pragmatic Programmer"],
  [5, "book", 2008, { ja: "Robert C. Martin", en: "Robert C. Martin", ar: "Robert C. Martin" }, null, "Clean Code"],
  [6, "kids", 1969, { ja: "エリック・カール", en: "Eric Carle", ar: "إريك كارل" }, { ja: "はらぺこあおむし", en: "The Very Hungry Caterpillar", ar: "اليرقة الجائعة جدًا" }],
  [7, "kids", 1963, { ja: "中川李枝子", en: "Rieko Nakagawa", ar: "ريكو ناكاغاوا" }, { ja: "ぐりとぐら", en: "Guri and Gura", ar: "غوري وغورا" }],
  [8, "av", 1988, { ja: "宮崎駿", en: "Hayao Miyazaki", ar: "هاياو ميازاكي" }, { ja: "となりのトトロ", en: "My Neighbor Totoro", ar: "جاري توتورو" }],
  [9, "av", 2001, { ja: "宮崎駿", en: "Hayao Miyazaki", ar: "هاياو ميازاكي" }, { ja: "千と千尋の神隠し", en: "Spirited Away", ar: "المخطوفة" }],
  [10, "av", 1959, { ja: "Miles Davis", en: "Miles Davis", ar: "Miles Davis" }, null, "Kind of Blue"],
  [11, "book", 2015, { ja: "東京都編", en: "Tokyo Metropolitan Archives", ar: "أرشيف طوكيو" }, { ja: "東京の歴史", en: "A History of Tokyo", ar: "تاريخ طوكيو" }],
  [12, "book", 2010, { ja: "山田花子", en: "Hanako Yamada", ar: "هاناكو يامادا" }, { ja: "日本語文法入門", en: "Introduction to Japanese Grammar", ar: "مقدمة في قواعد اللغة اليابانية" }],
  [13, "kids", 1943, { ja: "サン＝テグジュペリ", en: "Antoine de Saint-Exupéry", ar: "أنطوان دو سانت إكزوبيري" }, { ja: "星の王子さま", en: "The Little Prince", ar: "الأمير الصغير" }],
  [14, "book", 1008, { ja: "紫式部", en: "Murasaki Shikibu", ar: "موراساكي شيكيبو" }, { ja: "源氏物語", en: "The Tale of Genji", ar: "حكاية غينجي" }],
  [15, "book", 1706, { ja: "作者不詳", en: "Anonymous", ar: "مجهول" }, { ja: "千夜一夜物語", en: "One Thousand and One Nights", ar: "ألف ليلة وليلة" }],
  [16, "book", 1966, { ja: "タイーブ・サーレフ", en: "Tayeb Salih", ar: "الطيب صالح" }, { ja: "北へ遷りゆく時", en: "Season of Migration to the North", ar: "موسم الهجرة إلى الشمال" }],
  [17, "book", 1923, { ja: "カリール・ジブラーン", en: "Kahlil Gibran", ar: "جبران خليل جبران" }, { ja: "預言者", en: "The Prophet", ar: "النبي" }],
  [18, "kids", 1974, { ja: "藤子・F・不二雄", en: "Fujiko F. Fujio", ar: "فوجيكو ف. فوجيو" }, { ja: "ドラえもん 1", en: "Doraemon, vol. 1", ar: "دورايمون، المجلد ١" }],
  [19, "book", 1994, { ja: "Erich Gamma et al.", en: "Erich Gamma et al.", ar: "Erich Gamma et al." }, null, "Design Patterns"],
  [20, "book", 2008, { ja: "Douglas Crockford", en: "Douglas Crockford", ar: "Douglas Crockford" }, null, "JavaScript: The Good Parts"],
  [21, "av", 1969, { ja: "The Beatles", en: "The Beatles", ar: "The Beatles" }, null, "Abbey Road"],
  [22, "av", 1954, { ja: "黒澤明", en: "Akira Kurosawa", ar: "أكيرا كوروساوا" }, { ja: "七人の侍", en: "Seven Samurai", ar: "الساموراي السبعة" }],
  [23, "av", 1950, { ja: "黒澤明", en: "Akira Kurosawa", ar: "أكيرا كوروساوا" }, { ja: "羅生門", en: "Rashomon", ar: "راشومون" }],
  [24, "av", 1989, { ja: "宮崎駿", en: "Hayao Miyazaki", ar: "هاياو ميازاكي" }, { ja: "魔女の宅急便", en: "Kiki's Delivery Service", ar: "خدمة توصيل كيكي" }],
  [25, "kids", 1952, { ja: "E・B・ホワイト", en: "E. B. White", ar: "إي. بي. وايت" }, { ja: "シャーロットのおくりもの", en: "Charlotte's Web", ar: "شبكة شارلوت" }],
  [26, "book", 1914, { ja: "夏目漱石", en: "Natsume Sōseki", ar: "ناتسومي سوسيكي" }, { ja: "こころ", en: "Kokoro", ar: "كوكورو" }],
  [27, "book", 1948, { ja: "太宰治", en: "Osamu Dazai", ar: "أوسامو دازاي" }, { ja: "人間失格", en: "No Longer Human", ar: "لم يعد إنسانًا" }],
  [28, "book", 1990, { ja: "Thomas H. Cormen et al.", en: "Thomas H. Cormen et al.", ar: "Thomas H. Cormen et al." }, null, "Introduction to Algorithms"],
  // Mixed-direction titles: an English name inside Arabic / Japanese text.
  [29, "book", 2019, { ja: "佐藤一郎", en: "Ichiro Sato", ar: "إيتشيرو ساتو" }, { ja: "はじめての JavaScript 入門", en: "JavaScript for Beginners", ar: "مقدمة إلى JavaScript للمبتدئين" }],
  [30, "kids", 2021, { ja: "鈴木美咲", en: "Misaki Suzuki", ar: "ميساكي سوزوكي" }, { ja: "東京のねこ 100 ぴき", en: "100 Cats of Tokyo", ar: "١٠٠ قطة في Tokyo" }],
  [31, "av", 2023, { ja: "NHK", en: "NHK", ar: "NHK" }, { ja: "ドキュメンタリー 東京 2023", en: "Documentary: Tokyo 2023", ar: "وثائقي: طوكيو 2023" }],
  [32, "book", 2005, { ja: "高橋陽子", en: "Yoko Takahashi", ar: "يوكو تاكاهاشي" }, { ja: "図書館のひみつ", en: "Secrets of the Library", ar: "أسرار المكتبة" }],
];

const DESCRIPTIONS = {
  ja: (t, a, y) => `${a} による ${y} 年の作品「${t}」。館内で閲覧・貸出ができます。`,
  en: (t, a, y) => `“${t}” by ${a} (${y}). Available to read in the library or to borrow.`,
  ar: (t, a, y) => `«${t}» من تأليف ${a} (${y}). متاح للقراءة في المكتبة أو للاستعارة.`,
};

// Deterministic copies: 1-3 per item across the branches.
function copiesFor(id) {
  const count = (id % 3) + 1;
  const out = [];
  for (let i = 0; i < count; i++) {
    const branch = BRANCHES[(id + i) % BRANCHES.length].id;
    const kind = (id * 7 + i * 3) % 5;
    const status = kind < 2 ? "in" : kind < 4 ? "out" : "hold";
    // Due dates at 23:59 Tokyo, a few days apart; one lands on the London DST
    // change (2026-10-25) and one around midnight.
    const day = 20 + ((id + i) % 14);
    const month = day > 31 ? 11 : 10;
    const d = month === 11 ? day - 31 : day;
    const dueAt = status === "out" ? `2026-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}T23:59:00+09:00` : null;
    out.push({ branch, status, dueAt });
  }
  return out;
}

export const ITEMS = RAW.map(([id, type, year, author, title, keep]) => ({
  id,
  type,
  year,
  author,
  title: keep ? { ja: keep, en: keep, ar: keep } : title,
  keepEnglish: Boolean(keep),
  baseHolds: id % 4,
  copies: copiesFor(id),
}));

export function itemView(item, lang) {
  const title = item.title[lang];
  const author = item.author[lang];
  return {
    id: item.id,
    title,
    author,
    year: item.year,
    type: item.type,
    available: item.copies.filter((c) => c.status === "in").length,
    holds: item.baseHolds,
  };
}

export function itemDetail(item, lang, extraHolds = 0) {
  const view = itemView(item, lang);
  view.holds += extraHolds;
  return {
    ...view,
    description: DESCRIPTIONS[lang](view.title, view.author, view.year),
    copies: item.copies.map((c) => ({ ...c })),
  };
}

export const PATRONS = {
  "1001": { card: "1001", pin: "1234", lang: "ja", name: { ja: "山田 太郎", en: "Taro Yamada", ar: "تارو يامادا" }, display: "山田 太郎" },
  "1002": { card: "1002", pin: "1234", lang: "en", name: { ja: "Emily Carter", en: "Emily Carter", ar: "Emily Carter" }, display: "Emily Carter" },
  "1003": { card: "1003", pin: "1234", lang: "ar", name: { ja: "ليلى حسن", en: "ليلى حسن", ar: "ليلى حسن" }, display: "ليلى حسن" },
};

export const FEES = {
  "1001": [
    { id: 1, reason: { ja: "延滞料（吾輩は猫である）", en: "Late return (I Am a Cat)", ar: "تأخير في الإرجاع (أنا قط)" }, amount: 100, date: "2026-10-02" },
    { id: 2, reason: { ja: "コピー代", en: "Photocopies", ar: "نسخ ضوئي" }, amount: 30, date: "2026-10-15" },
  ],
  "1002": [
    { id: 3, reason: { ja: "延滞料（Clean Code）", en: "Late return (Clean Code)", ar: "تأخير في الإرجاع (Clean Code)" }, amount: 1200, date: "2026-09-28" },
  ],
  "1003": [],
};

export const MESSAGES = {
  "bad-pin": { ja: "カード番号または暗証番号が違います。", en: "The card number or PIN is wrong.", ar: "رقم البطاقة أو الرقم السري غير صحيح." },
  "unauthorized": { ja: "ログインが必要です。", en: "You need to log in.", ar: "يجب تسجيل الدخول." },
  "not-found": { ja: "見つかりません。", en: "Not found.", ar: "غير موجود." },
  "server-error": { ja: "サーバーエラーが発生しました。", en: "Something went wrong on the server.", ar: "حدث خطأ في الخادم." },
  "already-held": { ja: "この資料はすでに予約しています。", en: "You already have a hold on this item.", ar: "لديك حجز على هذه المادة بالفعل." },
  "branch-required": { ja: "受取館を選んでください。", en: "Choose a pickup branch.", ar: "اختر فرع الاستلام." },
  "branch-unknown": { ja: "その受取館はありません。", en: "That branch does not exist.", ar: "هذا الفرع غير موجود." },
  "notify-invalid": { ja: "連絡方法を選んでください。", en: "Choose how to be told.", ar: "اختر طريقة الإبلاغ." },
  "phone-required": { ja: "SMS で連絡するには電話番号が必要です。", en: "A phone number is needed for SMS.", ar: "رقم الهاتف مطلوب للرسائل القصيرة." },
  "phone-format": { ja: "電話番号は数字 10〜11 桁で入力してください（例: 09012345678）。", en: "Enter the phone number as 10 or 11 digits (for example 09012345678).", ar: "أدخل رقم الهاتف من ١٠ أو ١١ رقمًا (مثل 09012345678)." },
  "item-unknown": { ja: "その資料はありません。", en: "That item does not exist.", ar: "هذه المادة غير موجودة." },
  "hold-ready": {
    ja: (t, b) => `予約した「${t}」が${b}で受け取れます。`,
    en: (t, b) => `Your hold “${t}” is ready at ${b}.`,
    ar: (t, b) => `حجزك «${t}» جاهز للاستلام في ${b}.`,
  },
  "hold-expired": {
    ja: (t) => `予約した「${t}」の取り置き期限が切れました。`,
    en: (t) => `Your hold “${t}” has expired.`,
    ar: (t) => `انتهت مدة حجزك «${t}».`,
  },
};

export const FEE_TEXT = { ja: "手数料", en: "Fee", ar: "رسوم" };
