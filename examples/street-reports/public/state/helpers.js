// @ts-check
// Framework-free helpers the root state uses. Most are lifted unchanged from the React components
// (BoardPage.jsx, ReportListPage.jsx, NewReportPage.jsx, Modal.jsx), so they can be unit-tested on their own.
import { EMPTY_REPORT, isReportDirty } from '../lib/validation.js';

export const PER_PAGE = 20;
export const LAST_SEEN_KEY = 'street-reports:lastSeen';
export const DRAFT_KEY = 'street-reports:draft';
export const MAX_VISIBLE_TOASTS = 3;
export const TOAST_DURATION = 4000;
export const LOADING_DELAY_MS = 250;
export const NOW_INTERVAL_MS = 10000;

/** Layout.jsx NAV_ITEMS */
export const NAV_ITEMS = [
  { to: '/reports', label: '通報一覧' },
  { to: '/reports/new', label: '新規登録' },
  { to: '/board', label: 'ボード' },
  { to: '/stats', label: '統計' },
];

/** Layout.jsx NAV_ITEMS[].isActive */
export function isNavActive(to, pathname) {
  const p = pathname || '';
  if (to === '/reports') return p === '/reports' || (p.startsWith('/reports/') && p !== '/reports/new');
  return p === to;
}

/** ReportListPage.jsx */
export function isTypingTarget(target) {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

/** ReportListPage.jsx useLastSeen(): the threshold for 新着, read once when the list is entered. */
export function readLastSeen() {
  const value = window.localStorage.getItem(LAST_SEEN_KEY);
  return value && !Number.isNaN(Date.parse(value)) ? Date.parse(value) : null;
}

export function writeLastSeen() {
  window.localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
}

/** NewReportPage.jsx readDraft() / clearDraft() */
export function readDraft() {
  try {
    const draft = JSON.parse(window.localStorage.getItem(DRAFT_KEY));
    return draft && typeof draft === 'object' ? { ...EMPTY_REPORT, ...draft } : null;
  } catch {
    return null;
  }
}

export function clearDraft() {
  window.localStorage.removeItem(DRAFT_KEY);
}

export function saveDraft(values) {
  if (isReportDirty(values)) window.localStorage.setItem(DRAFT_KEY, JSON.stringify(values));
  else clearDraft();
}

/** NewReportPage.jsx initForm() — what the form starts from when the page is entered. */
export function initialForm() {
  const draft = readDraft();
  const restored = Boolean(draft && isReportDirty(draft));
  return { values: restored ? draft : { ...EMPTY_REPORT }, restored };
}

/** BoardPage.jsx */
export function byPriorityThenUpdate(a, b) {
  return b.priority - a.priority || b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id;
}

/** BoardPage.jsx: applies a live update — replaces a known card unless we hold a newer version, or adds it. */
export function upsert(cards, report) {
  if (!cards) return cards;
  const index = cards.findIndex((c) => c.id === report.id);
  if (index === -1) return [...cards, report];
  if (cards[index].version > report.version) return cards;
  return cards.with(index, { ...cards[index], ...report });
}

/** BoardPage.jsx */
export function toCard({ description, photos, prevId, nextId, ...card }) {
  return card;
}

/** Modal.jsx */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Modal.jsx handleKeyDown, the Tab part: keeps the focus inside `dialog`. */
export function trapTab(event, dialog) {
  const items = [...dialog.querySelectorAll(FOCUSABLE)];
  if (items.length === 0) {
    event.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  const inside = dialog.contains(active);
  if (event.shiftKey && (active === first || !inside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !inside)) {
    event.preventDefault();
    first.focus();
  }
}

/** ReportListPage.jsx updateParams(): the next query string, `null` / '' / undefined removing a key. */
export function nextSearch(current, changes) {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === '' || value === undefined) next.delete(key);
    else next.set(key, String(value));
  }
  return next.toString();
}
