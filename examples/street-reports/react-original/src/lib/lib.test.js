import { describe, expect, it } from 'vitest';
import { addDays, formatDate, formatDateTime, formatRelative, toIsoDay } from './format.js';
import { EMPTY_REPORT, canSubmitComment, isReportDirty, toReportPayload, validateReport } from './validation.js';
import { aggregate, formatAverageDays, presetRange, sortRows } from './stats.js';
import { buildQuery } from './api.js';
import { stepStatus } from './labels.js';

describe('format', () => {
  it('formats in Japan time', () => {
    expect(formatDate('2026-11-19T15:30:00Z')).toBe('2026/11/20');
    expect(formatDateTime('2026-11-20T00:05:00Z')).toBe('2026/11/20 09:05');
    expect(toIsoDay('2026-11-19T14:59:59Z')).toBe('2026-11-19');
    expect(toIsoDay('2026-11-19T15:00:00Z')).toBe('2026-11-20');
  });

  it('adds days across month boundaries', () => {
    expect(addDays('2026-11-20', -89)).toBe('2026-08-23');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('describes relative times', () => {
    const now = new Date('2026-11-20T00:00:00Z');
    expect(formatRelative('2026-11-19T23:59:30Z', now)).toBe('たった今');
    expect(formatRelative('2026-11-19T23:58:00Z', now)).toBe('2 分前');
    expect(formatRelative('2026-11-19T21:00:00Z', now)).toBe('3 時間前');
    expect(formatRelative('2026-11-18T00:00:00Z', now)).toBe('2026/11/18');
  });
});

describe('validation', () => {
  const valid = {
    ...EMPTY_REPORT,
    title: '街灯が点かない',
    category: 'light',
    subcategory: '不点灯',
    district: '中央',
    address: 'みどり市中央1-1',
    description: '夜になっても点灯しません。',
    reporterName: '山田',
  };

  it('accepts a complete report', () => {
    expect(validateReport(valid)).toEqual({});
  });

  it('reports every missing field', () => {
    expect(Object.keys(validateReport(EMPTY_REPORT)).sort()).toEqual(
      ['address', 'category', 'description', 'district', 'reporterName', 'subcategory', 'title'].sort(),
    );
  });

  it('checks lengths, the subcategory/category pair and the phone format', () => {
    expect(validateReport({ ...valid, title: 'あ'.repeat(61) }).title).toMatch(/60文字以内/);
    expect(validateReport({ ...valid, description: '短い' }).description).toMatch(/10文字以上/);
    expect(validateReport({ ...valid, subcategory: '陥没・穴' }).subcategory).toBeDefined();
    expect(validateReport({ ...valid, reporterPhone: '090-12ab' }).reporterPhone).toBeDefined();
    expect(validateReport({ ...valid, reporterPhone: '090-1234-5678' })).toEqual({});
  });

  it('does not require or send reporter fields for anonymous reports', () => {
    const anonymous = { ...valid, anonymous: true, reporterName: '', reporterPhone: 'x' };
    expect(validateReport(anonymous)).toEqual({});
    const payload = toReportPayload({ ...valid, anonymous: true });
    expect(payload).not.toHaveProperty('reporterName');
    expect(payload).not.toHaveProperty('reporterPhone');
  });

  it('knows when the form is dirty and when a comment can be sent', () => {
    expect(isReportDirty(EMPTY_REPORT)).toBe(false);
    expect(isReportDirty({ ...EMPTY_REPORT, title: 'x' })).toBe(true);
    expect(canSubmitComment('   ')).toBe(false);
    expect(canSubmitComment('a'.repeat(500))).toBe(true);
    expect(canSubmitComment('a'.repeat(501))).toBe(false);
  });
});

describe('stats', () => {
  const reports = [
    { status: 'new', category: 'road', reportedAt: '2026-11-18T01:00:00Z' },
    { status: 'done', category: 'road', reportedAt: '2026-11-18T03:00:00Z', closedAt: '2026-11-20T03:00:00Z' },
    { status: 'done', category: 'park', reportedAt: '2026-11-19T16:00:00Z', closedAt: '2026-11-20T04:00:00Z' },
  ];

  it('aggregates by status, category and day (Japan time) with the average handling time', () => {
    const s = aggregate(reports, '2026-11-18', '2026-11-20');
    expect(s.total).toBe(3);
    expect(s.byStatus).toEqual({ new: 1, triaged: 0, assigned: 0, done: 2 });
    expect(s.byCategory.road).toBe(2);
    expect(s.perDay).toEqual([
      { day: '2026-11-18', count: 2 },
      { day: '2026-11-19', count: 0 },
      { day: '2026-11-20', count: 1 },
    ]);
    expect(s.averageDays).toBeCloseTo(1.25);
    expect(formatAverageDays(s.averageDays)).toBe('1.3 日');
    expect(formatAverageDays(null)).toBe('—');
    expect(s.rows.find((r) => r.category === 'road')).toMatchObject({ new: 1, done: 1, total: 2 });
  });

  it('sorts matrix rows stably in both directions', () => {
    const rows = [{ k: 'a', n: 2 }, { k: 'b', n: 1 }, { k: 'c', n: 2 }];
    expect(sortRows(rows, 'n', 'ascending').map((r) => r.k)).toEqual(['b', 'a', 'c']);
    expect(sortRows(rows, 'n', 'descending').map((r) => r.k)).toEqual(['a', 'c', 'b']);
    expect(sortRows(rows, null)).toBe(rows);
  });

  it('computes preset ranges ending today', () => {
    expect(presetRange(7, '2026-11-20')).toEqual({ from: '2026-11-14', to: '2026-11-20' });
  });
});

describe('api / labels', () => {
  it('builds query strings without empty values', () => {
    expect(buildQuery({ status: 'new', q: '', page: 2, category: null })).toBe('?status=new&page=2');
    expect(buildQuery({})).toBe('');
  });

  it('steps statuses within bounds', () => {
    expect(stepStatus('new', 1)).toBe('triaged');
    expect(stepStatus('new', -1)).toBeNull();
    expect(stepStatus('done', 1)).toBeNull();
  });
});
