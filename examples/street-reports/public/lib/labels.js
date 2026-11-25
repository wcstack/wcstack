export const APP_NAME = 'みどり市 道路・公園の不具合 受付台帳';
export const TITLE_SUFFIX = 'みどり市 不具合受付';

export const STATUSES = ['new', 'triaged', 'assigned', 'done'];
export const STATUS_LABELS = { new: '新規', triaged: '確認済み', assigned: '対応中', done: '完了' };

export const CATEGORIES = ['road', 'light', 'park', 'sign', 'other'];
export const CATEGORY_LABELS = { road: '道路', light: '街灯', park: '公園', sign: '標識', other: 'その他' };

export const SUBCATEGORIES = {
  road: ['陥没・穴', 'ひび割れ', '段差', '冠水'],
  light: ['不点灯', '点滅', '灯具の破損'],
  park: ['遊具の破損', 'ベンチの破損', 'トイレの不具合', '倒木・枝折れ'],
  sign: ['標識の破損', '標識が見えにくい', '落書き'],
  other: ['不法投棄', 'その他'],
};

export const DISTRICTS = ['中央', '北町', '南町', '東が丘', '西浜', '緑ヶ丘'];

export const PRIORITIES = [1, 2, 3];
export const PRIORITY_LABELS = { 1: '低', 2: '中', 3: '高' };

export const SORTS = [
  { value: '-reportedAt', label: '新しい順' },
  { value: 'reportedAt', label: '古い順' },
  { value: '-priority', label: '優先度順' },
];

/** The status one step forward/backward on the board, or null at either end. */
export function stepStatus(status, direction) {
  const next = STATUSES.indexOf(status) + direction;
  return next >= 0 && next < STATUSES.length ? STATUSES[next] : null;
}

export function staffName(staff, id) {
  if (id == null) return '未割り当て';
  return staff.find((s) => s.id === id)?.name ?? `職員 #${id}`;
}

export function pageTitle(...parts) {
  return [...parts.filter(Boolean), TITLE_SUFFIX].join(' | ');
}
