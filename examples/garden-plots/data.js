// The in-memory data: the same on every start (a seeded generator), so tests can count on it.

/** mulberry32 — a small deterministic PRNG. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FAMILY = ["佐藤", "鈴木", "高橋", "田中", "伊藤", "渡辺", "山本", "中村", "小林", "加藤", "吉田", "山田", "佐々木",
  "山口", "松本", "井上", "木村", "林", "斎藤", "清水", "山崎", "森", "池田", "橋本", "阿部", "石川", "前田", "藤田", "小川", "岡田"];
const GIVEN = ["太郎", "花子", "一郎", "美咲", "健太", "陽子", "誠", "由美", "翔", "恵子", "大輔", "直子", "剛", "裕子", "拓也",
  "真理", "浩", "明美", "隆", "幸子"];

/** The postal codes the lookup knows. */
export const POSTAL = {
  "1000001": "みどり市中央一丁目",
  "1000002": "みどり市中央二丁目",
  "1000011": "みどり市北の丘一丁目",
  "1000012": "みどり市北の丘二丁目",
  "1000021": "みどり市川沿町",
  "1000031": "みどり市さくら台三丁目",
  "1000041": "みどり市東町",
  "1000051": "みどり市西町四丁目",
};
const POSTAL_CODES = Object.keys(POSTAL);

const GARDENS = [
  { name: "みどり中央農園", address: "みどり市中央二丁目 4-1", areas: [["A 区画", 24], ["B 区画", 24], ["C 区画", 30]] },
  { name: "北の丘農園", address: "みどり市北の丘一丁目 12", areas: [["東エリア", 36], ["西エリア", 40]] },
  { name: "川沿い農園", address: "みどり市川沿町 3-8", areas: [["第1", 12], ["第2", 20], ["第3", 16], ["第4", 20]] },
  { name: "さくら台農園", address: "みどり市さくら台三丁目 21", areas: [["北", 28], ["中", 24], ["南", 24]] },
];

function pad(n, w = 2) { return String(n).padStart(w, "0"); }
function day(r, fromYear = 2019) {
  const y = fromYear + Math.floor(r() * (2026 - fromYear));
  return `${y}-${pad(1 + Math.floor(r() * 12))}-${pad(1 + Math.floor(r() * 28))}`;
}

export function makeData() {
  const r = rng(20261123);
  let plotId = 0;
  let tenantId = 0;
  const person = () => {
    const code = POSTAL_CODES[Math.floor(r() * POSTAL_CODES.length)];
    return {
      name: `${FAMILY[Math.floor(r() * FAMILY.length)]} ${GIVEN[Math.floor(r() * GIVEN.length)]}`,
      phone: `0${Math.floor(r() * 9) + 1}0-${pad(Math.floor(r() * 10000), 4)}-${pad(Math.floor(r() * 10000), 4)}`,
      postal: `${code.slice(0, 3)}-${code.slice(3)}`,
      address: `${POSTAL[code]} ${1 + Math.floor(r() * 30)}-${1 + Math.floor(r() * 20)}`,
    };
  };
  const history = new Map();
  const gardens = GARDENS.map((g, gi) => ({
    id: gi + 1,
    name: g.name,
    address: g.address,
    areas: g.areas.map(([name, count], ai) => ({
      id: (gi + 1) * 10 + ai + 1,
      name,
      plots: Array.from({ length: count }, (_, pi) => {
        plotId += 1;
        const x = r();
        const status = x < 0.18 ? "free" : x < 0.8 ? "used" : x < 0.92 ? "renewal" : "paused";
        const hasTenant = status === "used" || status === "renewal";
        const since = hasTenant ? day(r) : null;
        const tenant = hasTenant ? { id: ++tenantId, ...person() } : null;
        const h = [{ at: "2018-04-01", what: "区画を開設", who: "農政課" }];
        if (hasTenant) h.push({ at: since, what: `利用開始（${tenant.name}）`, who: "農政課" });
        if (status === "renewal") h.push({ at: "2026-10-01", what: "更新手続きの案内を送付", who: "農政課" });
        if (status === "paused") h.push({ at: day(r, 2025), what: "休止（土壌改良）", who: "農政課" });
        history.set(plotId, h);
        return { id: plotId, no: `${String.fromCharCode(65 + ai)}-${pad(pi + 1)}`, size: [10, 15, 20, 30][Math.floor(r() * 4)], status, tenant, since, version: 1 };
      }),
    })),
  }));

  const waiting = Array.from({ length: 70 }, (_, i) => ({
    id: 1001 + i,
    ...person(),
    gardenId: 1 + Math.floor(r() * 4),
    appliedAt: day(r, 2024),
    priority: i + 1,
  }));
  // Priority is a separate order from the application date: shuffle it deterministically.
  const order = waiting.map((w) => w.id).sort(() => r() - 0.5);
  order.forEach((id, i) => { waiting.find((w) => w.id === id).priority = i + 1; });

  let faqId = 0;
  const q = (t) => ({ q: `${t}は？`, a: `${t}については農政課までお問い合わせください。` });
  const node = (title, questions, children = []) => ({ id: ++faqId, title, questions: questions.map(q), children });
  const faq = [
    node("申し込み", ["申し込みの時期", "申し込みの方法"], [
      node("資格", ["市外の人の申し込み"], [
        node("家族", ["家族名義での申し込み", "同居していない家族"], [
          node("代理", ["代理人による申し込み"], [
            node("書類", ["委任状の書式", "本人確認書類"]),
          ]),
        ]),
        node("法人", ["法人の申し込み"]),
      ]),
      node("抽選", ["抽選の日程", "抽選結果の通知"], [node("落選", ["落選後の待機登録"])]),
      node("待機", ["待機順位の確認"]),
    ]),
    node("利用", ["利用時間"], [
      node("設備", ["水道の使用", "物置の使用"], [
        node("道具", ["道具の貸し出し"], [node("農機具", ["耕運機の予約", "燃料の負担"], [node("事故", ["けがをしたとき"])])]),
        node("駐車場", ["駐車場の利用"]),
      ]),
      node("作物", ["育ててはいけない作物"], [node("農薬", ["農薬の使用"]), node("肥料", ["肥料の置き場"])]),
      node("ごみ", ["ごみの持ち帰り"]),
      node("マナー", ["近隣への配慮", "ペットの同伴"]),
    ]),
    node("料金", ["年間の利用料"], [
      node("支払い", ["支払い方法", "支払いの期限"], [node("口座振替", ["口座振替の手続き"]), node("減免", ["減免の条件"], [node("証明書", ["必要な証明書"])])]),
      node("返金", ["途中解約の返金"]),
    ]),
    node("更新と返還", ["更新の手続き"], [
      node("更新", ["更新の期限"], [node("期限切れ", ["期限を過ぎたとき"])]),
      node("返還", ["返還の手続き", "原状回復"], [node("立ち会い", ["返還時の立ち会い"])]),
      node("休止", ["区画の休止"]),
    ]),
    node("その他", ["問い合わせ先"], [node("災害", ["台風のとき"]), node("見学", ["見学の申し込み"])]),
  ];

  return { gardens, history, waiting, faq };
}
