// The framework-free pieces lifted out of the React components (state/helpers.js).
import { describe, expect, it } from 'vitest';
import {
  DRAFT_KEY, initialForm, isNavActive, nextSearch, readLastSeen, saveDraft, trapTab, upsert, writeLastSeen,
} from '../public/state/helpers.js';
import { EMPTY_REPORT } from '../public/lib/validation.js';

describe('Layout NAV_ITEMS.isActive', () => {
  it('marks 通報一覧 on the list and on detail pages, not on the form', () => {
    expect(isNavActive('/reports', '/reports')).toBe(true);
    expect(isNavActive('/reports', '/reports/12')).toBe(true);
    expect(isNavActive('/reports', '/reports/new')).toBe(false);
    expect(isNavActive('/reports/new', '/reports/new')).toBe(true);
    expect(isNavActive('/board', '/stats')).toBe(false);
  });
});

describe('updateParams (nextSearch)', () => {
  it('sets, replaces and removes keys', () => {
    expect(nextSearch({ status: 'new', page: '2' }, { category: 'road', page: null })).toBe('status=new&category=road');
    expect(nextSearch({}, { q: '' })).toBe('');
  });
});

describe('BoardPage upsert', () => {
  const cards = [{ id: 1, version: 2, status: 'new' }, { id: 2, version: 1, status: 'triaged' }];
  it('replaces a known card unless ours is newer, and adds an unknown one', () => {
    expect(upsert(cards, { id: 1, version: 3, status: 'triaged' })[0].status).toBe('triaged');
    expect(upsert(cards, { id: 1, version: 1, status: 'done' })).toBe(cards);
    expect(upsert(cards, { id: 9, version: 1, status: 'new' })).toHaveLength(3);
    expect(upsert(null, { id: 9 })).toBe(null);
  });
});

describe('NewReportPage draft', () => {
  it('restores a dirty draft and ignores a clean one', () => {
    expect(initialForm()).toEqual({ values: EMPTY_REPORT, restored: false });
    saveDraft({ ...EMPTY_REPORT, title: '下書き' });
    expect(initialForm()).toMatchObject({ values: { title: '下書き' }, restored: true });
    saveDraft({ ...EMPTY_REPORT });
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});

describe('ReportListPage useLastSeen', () => {
  it('reads what the last visit wrote', () => {
    expect(readLastSeen()).toBeNull();
    writeLastSeen();
    expect(typeof readLastSeen()).toBe('number');
  });
});

describe('Modal focus trap', () => {
  it('wraps Tab and Shift+Tab inside the dialog', () => {
    document.body.innerHTML = '<div id="d"><button id="a">a</button><button id="b">b</button></div>';
    const dialog = document.getElementById('d');
    document.getElementById('b').focus();
    trapTab(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }), dialog);
    expect(document.activeElement.id).toBe('a');
    trapTab(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true }), dialog);
    expect(document.activeElement.id).toBe('b');
  });
});
