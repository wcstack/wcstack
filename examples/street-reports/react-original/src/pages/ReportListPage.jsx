import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Pagination } from '../components/Pagination.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { useStaff } from '../context/StaffContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useReportsStore } from '../context/ReportsStore.jsx';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { useDelayedFlag } from '../hooks/useDelayedFlag.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useFetch } from '../hooks/useFetch.js';
import { api, buildQuery } from '../lib/api.js';
import { formatDate } from '../lib/format.js';
import {
  CATEGORIES, CATEGORY_LABELS, PRIORITY_LABELS, SORTS, STATUSES, STATUS_LABELS, pageTitle, staffName,
} from '../lib/labels.js';

const PER_PAGE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const LAST_SEEN_KEY = 'street-reports:lastSeen';
const NO_SELECTION = new Set();

function isTypingTarget(target) {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

/** Remembers when the list was last left; reports newer than that are "新着" on the next visit. */
function useLastSeen() {
  const [lastSeen] = useState(() => {
    const value = window.localStorage.getItem(LAST_SEEN_KEY);
    return value && !Number.isNaN(Date.parse(value)) ? Date.parse(value) : null;
  });
  useEffect(() => () => window.localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString()), []);
  return lastSeen;
}

export default function ReportListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get('status') ?? '';
  const category = searchParams.get('category') ?? '';
  const q = searchParams.get('q') ?? '';
  const sort = searchParams.get('sort') ?? SORTS[0].value;
  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1);

  useDocumentTitle(pageTitle('通報一覧'));
  const { staff, currentStaffId } = useStaff();
  const { statusChanged } = useReportsStore();
  const showToast = useToast();
  const lastSeen = useLastSeen();
  const searchRef = useRef(null);
  const headerCheckboxRef = useRef(null);
  const ids = { search: useId(), status: useId(), category: useId(), sort: useId() };

  const updateParams = useCallback(
    (changes, options) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === '' || value === undefined) next.delete(key);
          else next.set(key, String(value));
        }
        return next;
      }, options);
    },
    [setSearchParams],
  );

  // Search text: local while typing, written to the URL (replace, page reset) once it settles.
  const [text, setText] = useState(q);
  const [syncedQ, setSyncedQ] = useState(q);
  if (q !== syncedQ) {
    setSyncedQ(q);
    setText(q); // the URL changed from outside (Back, 条件をクリア)
  }
  const debouncedText = useDebouncedValue(text, SEARCH_DEBOUNCE_MS);
  useEffect(() => {
    if (debouncedText === text && debouncedText !== q) {
      updateParams({ q: debouncedText, page: null }, { replace: true });
    }
  }, [debouncedText, text, q, updateParams]);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const url = `/api/reports${buildQuery({ status, category, q, sort, page, per: PER_PAGE })}`;
  const { data, error, loading, reload, mutate } = useFetch(url);
  const showLoading = useDelayedFlag(loading, 250);
  const items = useMemo(() => data?.items ?? [], [data]);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.per)) : 1;

  // Selection belongs to one set of filters; changing any of them starts empty.
  const filterKey = `${status}|${category}|${q}|${sort}|${page}`;
  const [selection, setSelection] = useState({ key: filterKey, ids: NO_SELECTION });
  const selected = selection.key === filterKey ? selection.ids : NO_SELECTION;
  const selectedOnPage = items.filter((r) => selected.has(r.id));
  const allSelected = items.length > 0 && selectedOnPage.length === items.length;
  const someSelected = selectedOnPage.length > 0 && !allSelected;
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    if (headerCheckboxRef.current) headerCheckboxRef.current.indeterminate = someSelected;
  }, [someSelected]);

  function setSelected(next) {
    setSelection({ key: filterKey, ids: next });
  }

  function toggleRow(id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function toggleAll() {
    setSelected(allSelected ? NO_SELECTION : new Set(items.map((r) => r.id)));
  }

  async function runBulk(patch) {
    const targets = items.filter((r) => selected.has(r.id));
    if (targets.length === 0) return;
    const before = new Map(targets.map((r) => [r.id, r]));
    const moves = patch.status ? targets.filter((r) => r.status !== patch.status) : [];
    mutate((d) => ({ ...d, items: d.items.map((r) => (before.has(r.id) ? { ...r, ...patch } : r)) }));
    moves.forEach((r) => statusChanged(r.status, patch.status));
    setBulkBusy(true);
    try {
      const { updated } = await api.bulkUpdate([...before.keys()], patch);
      const byId = new Map(updated.map((r) => [r.id, r]));
      mutate((d) => ({ ...d, items: d.items.map((r) => byId.get(r.id) ?? r) }));
      setSelected(NO_SELECTION);
      showToast(`${updated.length} 件を更新しました`);
    } catch {
      mutate((d) => ({ ...d, items: d.items.map((r) => before.get(r.id) ?? r) }));
      moves.forEach((r) => statusChanged(patch.status, r.status));
      showToast('更新に失敗しました');
    } finally {
      setBulkBusy(false);
    }
  }

  const hasFilters = Boolean(status || category || q || searchParams.get('sort') || searchParams.get('page'));

  return (
    <section className="page">
      <div className="page-header">
        <h1>通報一覧</h1>
        {data && <p className="total">全 {data.total} 件</p>}
      </div>

      <div className="filters" role="search">
        <div className="field">
          <label htmlFor={ids.search}>検索</label>
          <input
            id={ids.search}
            ref={searchRef}
            type="search"
            placeholder="件名・住所で検索"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={ids.status}>状態</label>
          <select id={ids.status} value={status} onChange={(e) => updateParams({ status: e.target.value, page: null })}>
            <option value="">すべて</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.category}>カテゴリ</label>
          <select id={ids.category} value={category} onChange={(e) => updateParams({ category: e.target.value, page: null })}>
            <option value="">すべて</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.sort}>並び順</label>
          <select id={ids.sort} value={sort} onChange={(e) => updateParams({ sort: e.target.value === SORTS[0].value ? null : e.target.value, page: null })}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="secondary"
          disabled={!hasFilters && !text}
          onClick={() => {
            setText('');
            setSearchParams({});
          }}
        >
          条件をクリア
        </button>
      </div>

      {selected.size > 0 && (
        <div className="bulk-bar" role="region" aria-label="一括操作">
          <span>{selected.size} 件を選択中</span>
          <button type="button" disabled={bulkBusy || currentStaffId == null} onClick={() => runBulk({ assigneeId: currentStaffId })}>
            自分に割り当て
          </button>
          <button type="button" disabled={bulkBusy} onClick={() => runBulk({ status: 'done' })}>
            完了にする
          </button>
        </div>
      )}

      {showLoading && <p className="loading">読み込み中…</p>}

      {error ? (
        <div className="error-box" role="alert">
          <p>読み込みに失敗しました</p>
          <button type="button" onClick={reload}>再試行</button>
        </div>
      ) : (
        <table className="report-table" aria-busy={loading} aria-label="通報">
          <thead>
            <tr>
              <th scope="col" className="col-check">
                <input
                  ref={headerCheckboxRef}
                  type="checkbox"
                  aria-label="このページの通報をすべて選択"
                  checked={allSelected}
                  disabled={items.length === 0}
                  onChange={toggleAll}
                />
              </th>
              <th scope="col">件名</th>
              <th scope="col">カテゴリ</th>
              <th scope="col">状態</th>
              <th scope="col">優先度</th>
              <th scope="col">地区</th>
              <th scope="col">受付日</th>
              <th scope="col">担当</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => {
              const isNew = lastSeen !== null && Date.parse(r.reportedAt) > lastSeen;
              return (
                <tr key={r.id} className={selected.has(r.id) ? 'selected' : undefined}>
                  <td className="col-check">
                    <input
                      type="checkbox"
                      aria-label={`「${r.title}」を選択`}
                      checked={selected.has(r.id)}
                      onChange={() => toggleRow(r.id)}
                    />
                  </td>
                  <th scope="row" className="col-title">
                    <Link to={`/reports/${r.id}`}>{r.title}</Link>
                    {isNew && <span className="new-marker">新着</span>}
                  </th>
                  <td>{CATEGORY_LABELS[r.category]}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>{PRIORITY_LABELS[r.priority]}</td>
                  <td>{r.district}</td>
                  <td>{formatDate(r.reportedAt)}</td>
                  <td>{staffName(staff, r.assigneeId)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {data && !error && !loading && items.length === 0 && <p className="empty">該当する通報はありません</p>}

      {data && !error && (
        <Pagination page={page} totalPages={totalPages} onPageChange={(p) => updateParams({ page: p === 1 ? null : p })} />
      )}
    </section>
  );
}
