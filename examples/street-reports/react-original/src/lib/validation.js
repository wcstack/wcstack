import { SUBCATEGORIES } from './labels.js';

export const TITLE_MAX = 60;
export const DESCRIPTION_MIN = 10;
export const DESCRIPTION_MAX = 1000;
export const COMMENT_MAX = 500;

/** Order used to pick the first invalid field to focus. */
export const REPORT_FIELDS = [
  'title', 'category', 'subcategory', 'district', 'address', 'description', 'reporterName', 'reporterPhone',
];

export const EMPTY_REPORT = {
  title: '',
  category: '',
  subcategory: '',
  district: '',
  address: '',
  description: '',
  priority: 2,
  anonymous: false,
  reporterName: '',
  reporterPhone: '',
};

/** Returns `{ field: message }` for every invalid field of the new-report form. */
export function validateReport(values) {
  const errors = {};
  const title = values.title.trim();
  if (!title) errors.title = '件名を入力してください';
  else if (title.length > TITLE_MAX) errors.title = `件名は${TITLE_MAX}文字以内で入力してください`;
  if (!values.category) errors.category = 'カテゴリを選択してください';
  if (!values.subcategory || !(SUBCATEGORIES[values.category] ?? []).includes(values.subcategory)) {
    errors.subcategory = '種別を選択してください';
  }
  if (!values.district) errors.district = '地区を選択してください';
  if (!values.address.trim()) errors.address = '住所を入力してください';
  const description = values.description.trim();
  if (description.length < DESCRIPTION_MIN) errors.description = `詳細は${DESCRIPTION_MIN}文字以上で入力してください`;
  else if (description.length > DESCRIPTION_MAX) errors.description = `詳細は${DESCRIPTION_MAX}文字以内で入力してください`;
  if (!values.anonymous) {
    if (!values.reporterName.trim()) errors.reporterName = '通報者名を入力してください';
    if (values.reporterPhone && !/^[0-9-]+$/.test(values.reporterPhone)) {
      errors.reporterPhone = '電話番号は数字とハイフンで入力してください';
    }
  }
  return errors;
}

/** The request body for `POST /api/reports`; reporter fields are dropped for anonymous reports. */
export function toReportPayload(values) {
  const payload = {
    title: values.title.trim(),
    category: values.category,
    subcategory: values.subcategory,
    district: values.district,
    address: values.address.trim(),
    description: values.description.trim(),
    priority: values.priority,
    anonymous: values.anonymous,
  };
  if (!values.anonymous) {
    payload.reporterName = values.reporterName.trim();
    if (values.reporterPhone) payload.reporterPhone = values.reporterPhone;
  }
  return payload;
}

export function isReportDirty(values) {
  return Object.keys(EMPTY_REPORT).some((key) => values[key] !== EMPTY_REPORT[key]);
}

export function canSubmitComment(body) {
  const length = body.trim().length;
  return length > 0 && body.length <= COMMENT_MAX;
}
