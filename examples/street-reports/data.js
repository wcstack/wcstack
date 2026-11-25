// Deterministic seed data. Every call to createSeed() returns a fresh, identical copy.
// No randomness from Math.random: a small seeded PRNG (mulberry32) drives all choices.

export const FIXED_NOW = '2026-11-20T00:00:00.000Z'; // 2026-11-20T09:00:00+09:00

export const STAFF = [
  { id: 1, name: '佐藤 花子' },
  { id: 2, name: '鈴木 一郎' },
  { id: 3, name: '高橋 美咲' },
  { id: 4, name: '田中 健太' },
  { id: 5, name: '伊藤 さくら' },
];

export const SUBCATEGORIES = {
  road: ['陥没・穴', 'ひび割れ', '段差', '冠水'],
  light: ['不点灯', '点滅', '灯具の破損'],
  park: ['遊具の破損', 'ベンチの破損', 'トイレの不具合', '倒木・枝折れ'],
  sign: ['標識の破損', '標識が見えにくい', '落書き'],
  other: ['不法投棄', 'その他'],
};

export const DISTRICTS = ['中央', '北町', '南町', '東が丘', '西浜', '緑ヶ丘'];

const LANDMARKS = [
  '駅前通り', '市役所前', '小学校通学路', 'バス停', '交差点', '商店街', '中央公園', '児童公園',
  '川沿いの遊歩道', '歩道橋', '図書館前', '病院入口', '団地内通路', '神社前', '体育館裏',
];

const DESCRIPTIONS = {
  road: '路面に大きな穴があり、自転車や歩行者が転倒しそうで危険です。早めの補修をお願いします。',
  light: '夜間に街灯が点かず、周囲が真っ暗で通行が不安です。確認をお願いします。',
  park: '公園の設備が壊れていて、子どもがけがをしないか心配です。立入禁止などの対応をお願いします。',
  sign: '標識が傾いていたり汚れていたりして、運転中に内容が読み取れません。',
  other: '道路脇にごみが放置されたままになっています。回収をお願いします。',
};

const COMMENT_BODIES = [
  '現地を確認しました。担当課へ連絡済みです。',
  '業者に見積もりを依頼しました。',
  '通報者に連絡し、詳しい場所を確認しました。',
  '応急処置としてカラーコーンを設置しました。',
  '補修工事の日程が決まりました。',
  '類似の通報が近隣からも来ています。',
];

const REPORTER_NAMES = ['山本 太郎', '中村 由美', '小林 誠', '加藤 美穂', '吉田 拓也', '山田 恵', '松本 翔'];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
export const REPORT_COUNT = 120;
export const PHOTO_COUNT = 12;

export function createSeed() {
  const rand = mulberry32(20261120);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const now = Date.parse(FIXED_NOW);
  const start = now - 90 * DAY;
  const categories = Object.keys(SUBCATEGORIES);

  const reports = [];
  const comments = [];
  const titles = new Set();
  let photoSeq = 0;
  let commentSeq = 0;

  for (let id = 1; id <= REPORT_COUNT; id += 1) {
    // id order == chronological order; strictly increasing and always before "now".
    const slot = (90 * DAY) / REPORT_COUNT;
    const reportedAt = Math.floor((start + (id - 1) * slot + rand() * slot * 0.8) / 1000) * 1000;
    const category = pick(categories);
    const subcategory = pick(SUBCATEGORIES[category]);
    const district = pick(DISTRICTS);
    const chome = 1 + Math.floor(rand() * 5);
    let title = `${district}${chome}丁目 ${pick(LANDMARKS)}の${subcategory}`;
    while (titles.has(title)) title = `${district}${chome}丁目 ${pick(LANDMARKS)}付近の${subcategory}`;
    if (titles.has(title)) title = `${title}（${id}）`;
    titles.add(title);
    const address = `みどり市${district}${chome}丁目${id}-${1 + Math.floor(rand() * 30)}`;

    // Newer reports are more likely to still be open.
    const age = (now - reportedAt) / (90 * DAY); // 0 (newest) .. 1 (oldest)
    const r = rand();
    let status;
    if (age < 0.3) status = r < 0.62 ? 'new' : r < 0.82 ? 'triaged' : 'assigned';
    else if (age < 0.6) status = r < 0.12 ? 'new' : r < 0.32 ? 'triaged' : r < 0.62 ? 'assigned' : 'done';
    else status = r < 0.05 ? 'triaged' : r < 0.2 ? 'assigned' : 'done';

    const priority = 1 + Math.floor(rand() * 3);
    const anonymous = rand() < 0.35;
    const lag = Math.min(now - reportedAt - HOUR, Math.floor(rand() * 20 * DAY));
    let updatedAt = status === 'new' ? reportedAt : reportedAt + Math.max(HOUR, lag);
    // A few reports were closed during the last week (they still appear on the board).
    if (status === 'done' && id % 6 === 0) updatedAt = now - ((id % 5) + 1) * DAY + 3 * HOUR;
    updatedAt = Math.floor(updatedAt / 1000) * 1000;
    const assigneeId = status === 'assigned' || status === 'done' ? STAFF[Math.floor(rand() * STAFF.length)].id : null;

    const photos = [];
    if (id % 9 === 0 || id === 118) {
      const count = 2 + ((id / 9) % 3); // 2..4
      for (let p = 0; p < count; p += 1) {
        photoSeq += 1;
        const n = ((photoSeq - 1) % PHOTO_COUNT) + 1;
        photos.push({ id: photoSeq, url: `/photos/${n}.svg`, alt: `${title}の写真 ${p + 1}` });
      }
    }

    const report = {
      id,
      title,
      category,
      subcategory,
      status,
      priority,
      district,
      address,
      description: `${DESCRIPTIONS[category]}（${address}）`,
      reportedAt: new Date(reportedAt).toISOString(),
      updatedAt: new Date(updatedAt).toISOString(),
      assigneeId,
      anonymous,
      photos,
      version: 1,
      closedAt: status === 'done' ? new Date(updatedAt).toISOString() : null,
    };
    if (!anonymous) {
      report.reporterName = pick(REPORTER_NAMES);
      report.reporterPhone = `090-${String(1000 + id).padStart(4, '0')}-${String(5000 + id * 7).slice(-4)}`;
    }
    reports.push(report);

    const commentCount = status === 'new' ? 0 : Math.floor(rand() * 4);
    for (let c = 0; c < commentCount; c += 1) {
      commentSeq += 1;
      const createdAt = Math.min(now - HOUR, reportedAt + (c + 1) * Math.max(HOUR, (updatedAt - reportedAt) / (commentCount + 1)));
      comments.push({
        id: commentSeq,
        reportId: id,
        authorId: pick(STAFF).id,
        body: pick(COMMENT_BODIES),
        createdAt: new Date(createdAt).toISOString(),
      });
    }
  }

  return { staff: STAFF.map((s) => ({ ...s })), reports, comments, now: FIXED_NOW };
}
