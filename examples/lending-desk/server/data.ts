// The server's data: the same on every start (deterministic), seeded relative to "today in Japan".

import type { Category, Center, Item, Reservation, ReservationLine, User } from "../shared/api.ts";
import { CATEGORIES } from "../shared/api.ts";
import { addDays } from "../shared/dates.ts";

export const CENTERS: Center[] = [
  { id: 1, name: "中央地区センター" },
  { id: 2, name: "北地区センター" },
  { id: 3, name: "南地区センター" },
  { id: 4, name: "東地区センター" },
];

export interface Account extends User {
  phrase: string;
}

const GROUP_NAMES = [
  "みどり町一丁目町内会",
  "さくら台自治会",
  "みどり市子ども会連合",
  "ひまわり商店会",
  "北みどり老人クラブ",
  "みどり川清掃ボランティア",
  "南みどり防災会",
  "みどり市民バンド",
];

export const ACCOUNTS: Account[] = [
  ...GROUP_NAMES.map((name, i): Account => {
    const n = String(i + 1).padStart(2, "0");
    return { id: `G${n}`, name, role: "group", phrase: `midori-g${n}` };
  }),
  { id: "S01", name: "職員", role: "staff", phrase: "midori-s01" },
];

interface Base {
  name: string;
  stock: number;
  deposit: number;
  note: string | null;
}

const BASES: Record<Category, Base[]> = {
  "テント・タープ": [
    { name: "イベントテント 3×3m", stock: 4, deposit: 3000, note: "おもり付き" },
    { name: "イベントテント 2×2m", stock: 3, deposit: 2000, note: null },
    { name: "タープ", stock: 2, deposit: 1500, note: null },
    { name: "運動会用テント", stock: 2, deposit: 5000, note: "設営に4人必要" },
    { name: "テント用横幕", stock: 6, deposit: 500, note: null },
    { name: "テントおもり", stock: 16, deposit: 0, note: "1個10kg" },
    { name: "ワンタッチテント", stock: 3, deposit: 2500, note: null },
    { name: "日よけシェード", stock: 2, deposit: 1000, note: null },
    { name: "テント用ペグ一式", stock: 5, deposit: 0, note: null },
    { name: "ブルーシート 5×5m", stock: 10, deposit: 0, note: null },
    { name: "ブルーシート 3×3m", stock: 12, deposit: 0, note: null },
    { name: "キャンプ用テント", stock: 2, deposit: 2000, note: "4人用" },
  ],
  "机・椅子": [
    { name: "折りたたみ長机", stock: 20, deposit: 0, note: "180×45cm" },
    { name: "折りたたみ椅子", stock: 50, deposit: 0, note: null },
    { name: "パイプ椅子", stock: 40, deposit: 0, note: null },
    { name: "丸テーブル", stock: 6, deposit: 1000, note: null },
    { name: "子ども用机", stock: 10, deposit: 0, note: null },
    { name: "受付台", stock: 2, deposit: 500, note: null },
    { name: "演台", stock: 1, deposit: 3000, note: "木製" },
    { name: "ベンチ", stock: 8, deposit: 0, note: null },
    { name: "テーブルクロス", stock: 15, deposit: 0, note: "白" },
    { name: "台車", stock: 3, deposit: 1000, note: null },
    { name: "スタッキングチェア", stock: 30, deposit: 0, note: null },
    { name: "ハイテーブル", stock: 4, deposit: 1000, note: null },
  ],
  "映像・音響": [
    { name: "プロジェクター", stock: 2, deposit: 10000, note: "HDMI接続" },
    { name: "スクリーン 100型", stock: 2, deposit: 5000, note: null },
    { name: "ワイヤレスマイク", stock: 4, deposit: 3000, note: "電池は各自" },
    { name: "ポータブルスピーカー", stock: 2, deposit: 5000, note: null },
    { name: "拡声器（メガホン）", stock: 5, deposit: 1000, note: null },
    { name: "延長コード 10m", stock: 8, deposit: 0, note: null },
    { name: "ビデオカメラ", stock: 1, deposit: 15000, note: "三脚付き" },
    { name: "ミキサー", stock: 1, deposit: 8000, note: null },
    { name: "譜面台", stock: 12, deposit: 0, note: null },
    { name: "ホワイトボード", stock: 3, deposit: 1000, note: "キャスター付き" },
    { name: "DVDプレーヤー", stock: 1, deposit: 3000, note: null },
    { name: "トランシーバー", stock: 6, deposit: 2000, note: "2台1組" },
  ],
  "調理・イベント": [
    { name: "ポップコーン機", stock: 1, deposit: 5000, note: "材料は各自" },
    { name: "綿菓子機", stock: 1, deposit: 5000, note: null },
    { name: "かき氷機", stock: 2, deposit: 3000, note: null },
    { name: "大鍋", stock: 3, deposit: 1000, note: "50人分" },
    { name: "ガスコンロ", stock: 4, deposit: 2000, note: "ボンベは各自" },
    { name: "鉄板", stock: 2, deposit: 2000, note: null },
    { name: "保冷ボックス", stock: 6, deposit: 500, note: null },
    { name: "給水タンク", stock: 5, deposit: 0, note: "20L" },
    { name: "紅白幕", stock: 3, deposit: 2000, note: "10m" },
    { name: "抽選器（ガラガラ）", stock: 2, deposit: 1000, note: null },
    { name: "法被", stock: 20, deposit: 0, note: "大人用" },
    { name: "ちょうちん", stock: 30, deposit: 0, note: null },
  ],
  "スポーツ・レク": [
    { name: "綱引きロープ", stock: 2, deposit: 1000, note: "30m" },
    { name: "玉入れセット", stock: 2, deposit: 1000, note: null },
    { name: "大玉", stock: 2, deposit: 1000, note: null },
    { name: "ゼッケン", stock: 60, deposit: 0, note: "1〜60番" },
    { name: "ストップウォッチ", stock: 6, deposit: 0, note: null },
    { name: "ラインカー", stock: 2, deposit: 500, note: null },
    { name: "コーン", stock: 20, deposit: 0, note: null },
    { name: "モルック", stock: 3, deposit: 1000, note: null },
    { name: "グラウンドゴルフセット", stock: 4, deposit: 1000, note: null },
    { name: "卓球台", stock: 2, deposit: 2000, note: null },
    { name: "バドミントンセット", stock: 4, deposit: 0, note: null },
    { name: "得点板", stock: 2, deposit: 500, note: null },
  ],
  "防災・安全": [
    { name: "発電機", stock: 2, deposit: 10000, note: "燃料は各自" },
    { name: "投光器", stock: 4, deposit: 3000, note: null },
    { name: "救急箱", stock: 6, deposit: 0, note: null },
    { name: "AEDトレーナー", stock: 1, deposit: 5000, note: "講習用" },
    { name: "担架", stock: 2, deposit: 1000, note: null },
    { name: "誘導棒", stock: 12, deposit: 0, note: null },
    { name: "カラーコーン用バー", stock: 10, deposit: 0, note: null },
    { name: "腕章", stock: 30, deposit: 0, note: "スタッフ" },
    { name: "消火器（訓練用）", stock: 3, deposit: 1000, note: null },
    { name: "防災テント", stock: 1, deposit: 5000, note: null },
    { name: "ヘルメット", stock: 20, deposit: 0, note: null },
    { name: "非常用トイレセット", stock: 2, deposit: 2000, note: null },
  ],
};

/** About 300 items: each centre carries a deterministic subset of the 72 base items. */
export function makeItems(): Item[] {
  const items: Item[] = [];
  let id = 1;
  for (const center of CENTERS) {
    CATEGORIES.forEach((category, ci) => {
      BASES[category].forEach((b, bi) => {
        // centre 1 has everything; the others skip a deterministic few
        if (center.id !== 1 && (bi + ci + center.id) % 7 === 0) return;
        items.push({
          id: id++,
          name: b.name,
          category,
          centerId: center.id,
          stock: Math.max(1, b.stock - ((center.id + bi) % 3 === 0 && b.stock > 2 ? 1 : 0)),
          deposit: b.deposit,
          note: b.note,
        });
      });
    });
  }
  return items;
}

export interface Db {
  items: Item[];
  reservations: Reservation[];
  nextReservationId: number;
}

function line(items: Item[], itemId: number, from: string, to: string, quantity: number): ReservationLine {
  const it = items.find((i) => i.id === itemId);
  if (!it) throw new Error(`seed: no item ${itemId}`);
  return { itemId, from, to, quantity, itemName: it.name, centerId: it.centerId, stock: it.stock, deposit: it.deposit };
}

function findItem(items: Item[], centerId: number, name: string): number {
  const it = items.find((i) => i.centerId === centerId && i.name === name);
  if (!it) throw new Error(`seed: no ${name} at ${centerId}`);
  return it.id;
}

/** The start of the data, relative to `today` (Japan). */
export function makeDb(today: string): Db {
  const items = makeItems();
  const d = (n: number) => addDays(today, n);
  const projector1 = findItem(items, 1, "プロジェクター");
  const tent2 = findItem(items, 2, "イベントテント 3×3m");
  const table2 = findItem(items, 2, "折りたたみ長机");
  const popcorn1 = findItem(items, 1, "ポップコーン機");
  const megaphone3 = findItem(items, 3, "拡声器（メガホン）");
  const chairs2 = findItem(items, 2, "折りたたみ椅子");
  const screen1 = findItem(items, 1, "スクリーン 100型");
  const reservations: Reservation[] = [
    {
      id: 1, groupId: "G01", groupName: "みどり町一丁目町内会", status: "approved",
      lines: [line(items, projector1, d(10), d(11), 1)],
      purpose: "町内会総会", pickupAt: `${d(10)}T09:00`, createdAt: `${d(-5)}T10:12`,
      decidedAt: `${d(-4)}T09:30`, decidedBy: { id: "S01", name: "職員" },
    },
    {
      id: 2, groupId: "G02", groupName: "さくら台自治会", status: "pending",
      lines: [line(items, projector1, d(10), d(10), 1), line(items, tent2, d(12), d(13), 2)],
      purpose: "防災訓練", pickupAt: `${d(10)}T08:30`, createdAt: `${d(-2)}T14:05`,
    },
    {
      id: 3, groupId: "G01", groupName: "みどり町一丁目町内会", status: "denied",
      lines: [line(items, popcorn1, d(3), d(3), 1)],
      purpose: "子ども祭り", pickupAt: `${d(3)}T09:00`, createdAt: `${d(-6)}T11:00`,
      decidedAt: `${d(-5)}T16:20`, decidedBy: { id: "S01", name: "職員" }, reason: "同日に市の行事で使用します",
    },
    {
      id: 4, groupId: "G03", groupName: "みどり市子ども会連合", status: "approved",
      lines: [line(items, tent2, d(0), d(1), 2), line(items, table2, d(0), d(0), 6)],
      purpose: "子ども会バザー", pickupAt: `${d(0)}T08:00`, createdAt: `${d(-9)}T09:00`,
      decidedAt: `${d(-8)}T10:00`, decidedBy: { id: "S01", name: "職員" },
    },
    {
      id: 5, groupId: "G04", groupName: "ひまわり商店会", status: "approved",
      lines: [line(items, chairs2, d(-2), d(0), 20)],
      purpose: "商店会イベント", pickupAt: `${d(-2)}T09:00`, createdAt: `${d(-12)}T09:00`,
      decidedAt: `${d(-11)}T10:00`, decidedBy: { id: "S01", name: "職員" },
    },
    {
      id: 6, groupId: "G05", groupName: "北みどり老人クラブ", status: "pending",
      lines: [line(items, megaphone3, d(5), d(5), 1)],
      purpose: "ウォーキング大会", pickupAt: `${d(5)}T08:00`, createdAt: `${d(-1)}T15:40`,
    },
    {
      id: 7, groupId: "G01", groupName: "みどり町一丁目町内会", status: "pending",
      lines: [line(items, tent2, d(20), d(21), 1)],
      purpose: "夏祭り準備", pickupAt: `${d(20)}T09:00`, createdAt: `${d(-1)}T09:15`,
    },
    {
      id: 8, groupId: "G08", groupName: "みどり市民バンド", status: "approved",
      lines: [line(items, screen1, d(15), d(15), 2)],
      purpose: "定期演奏会", pickupAt: `${d(15)}T10:00`, createdAt: `${d(-3)}T10:00`,
      decidedAt: `${d(-3)}T11:00`, decidedBy: { id: "S01", name: "職員" },
    },
    // taken over the phone and entered by staff before #8 was approved: approving it now would exceed
    // the stock — what the /admin check is for (the API itself refuses such a request: 422)
    {
      id: 9, groupId: "G06", groupName: "みどり川清掃ボランティア", status: "pending",
      lines: [line(items, screen1, d(14), d(15), 1)],
      purpose: "活動報告会", pickupAt: `${d(14)}T09:00`, createdAt: `${d(-4)}T16:00`,
    },
  ];
  return { items, reservations, nextReservationId: 10 };
}
