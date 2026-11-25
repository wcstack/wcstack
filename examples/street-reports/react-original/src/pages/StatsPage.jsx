import { useId, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useFetch } from '../hooks/useFetch.js';
import { buildQuery } from '../lib/api.js';
import { toIsoDay } from '../lib/format.js';
import { CATEGORY_LABELS, STATUSES, STATUS_LABELS, pageTitle } from '../lib/labels.js';
import { aggregate, formatAverageDays, presetRange, sortRows } from '../lib/stats.js';

const PRESETS = [7, 30, 90];
const DEFAULT_PRESET = 30;
const isIsoDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

const COLUMNS = [
  ...STATUSES.map((s) => ({ key: s, label: STATUS_LABELS[s] })),
  { key: 'total', label: '合計' },
];

function DailyChart({ perDay }) {
  const titleId = useId();
  const width = 640;
  const height = 160;
  const max = Math.max(1, ...perDay.map((d) => d.count));
  const barWidth = width / Math.max(1, perDay.length);
  const total = perDay.reduce((sum, d) => sum + d.count, 0);
  const peak = perDay.reduce((best, d) => (d.count > best.count ? d : best), perDay[0] ?? { day: '', count: 0 });
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={titleId} preserveAspectRatio="none">
        <title id={titleId}>
          {`日別の通報数: ${perDay.length} 日間で合計 ${total} 件、最多は ${peak.day} の ${peak.count} 件`}
        </title>
        {perDay.map((d, i) => {
          const h = (d.count / max) * (height - 10);
          return <rect key={d.day} x={i * barWidth + 1} y={height - h} width={Math.max(1, barWidth - 2)} height={h} />;
        })}
      </svg>
      <details>
        <summary>日別の件数を表で見る</summary>
        <table className="compact">
          <thead>
            <tr>
              <th scope="col">日付</th>
              <th scope="col">件数</th>
            </tr>
          </thead>
          <tbody>
            {perDay.map((d) => (
              <tr key={d.day}>
                <td>{d.day}</td>
                <td>{d.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

export default function StatsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  useDocumentTitle(pageTitle('統計'));
  if (searchParams.get('boom') === '1') throw new Error('統計の描画に失敗しました（テスト用）');

  const today = toIsoDay(new Date());
  const fallback = presetRange(DEFAULT_PRESET, today);
  const from = searchParams.get('from') ?? fallback.from;
  const to = searchParams.get('to') ?? fallback.to;
  const inverted = isIsoDay(from) && isIsoDay(to) && from > to;
  const valid = isIsoDay(from) && isIsoDay(to) && !inverted;

  const { data, error, loading, reload } = useFetch(valid ? `/api/reports/export${buildQuery({ from, to })}` : null);
  const stats = useMemo(() => (data && valid ? aggregate(data, from, to) : null), [data, valid, from, to]);
  const [sort, setSort] = useState({ key: null, direction: 'ascending' });
  const rows = useMemo(() => (stats ? sortRows(stats.rows, sort.key, sort.direction) : []), [stats, sort]);
  const fromId = useId();
  const toId = useId();

  function setRange(range, options) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('from', range.from);
      next.set('to', range.to);
      return next;
    }, options);
  }

  function toggleSort(key) {
    setSort((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === 'ascending' ? 'descending' : 'ascending' }
        : { key, direction: 'ascending' },
    );
  }

  const maxCategory = stats ? Math.max(1, ...Object.values(stats.byCategory)) : 1;

  return (
    <section className="page">
      <h1>統計</h1>

      <div className="filters">
        <div className="presets" role="group" aria-label="期間のプリセット">
          {PRESETS.map((days) => {
            const range = presetRange(days, today);
            return (
              <button
                key={days}
                type="button"
                className="secondary"
                aria-pressed={range.from === from && range.to === to}
                onClick={() => setRange(range)}
              >
                {days}日
              </button>
            );
          })}
        </div>
        <div className="field">
          <label htmlFor={fromId}>開始日</label>
          <input
            id={fromId}
            type="date"
            value={from}
            aria-invalid={inverted || undefined}
            aria-describedby={inverted ? `${fromId}-error` : undefined}
            onChange={(e) => e.target.value && setRange({ from: e.target.value, to }, { replace: true })}
          />
        </div>
        <div className="field">
          <label htmlFor={toId}>終了日</label>
          <input
            id={toId}
            type="date"
            value={to}
            onChange={(e) => e.target.value && setRange({ from, to: e.target.value }, { replace: true })}
          />
        </div>
      </div>

      {inverted && (
        <p id={`${fromId}-error`} className="field-error" role="alert">
          開始日は終了日以前の日付を指定してください
        </p>
      )}
      {error && (
        <div className="error-box" role="alert">
          <p>読み込みに失敗しました</p>
          <button type="button" onClick={reload}>再試行</button>
        </div>
      )}
      {valid && loading && !stats && <p className="loading">読み込み中…</p>}

      {stats && (
        <div className="stats" aria-busy={loading}>
          <section aria-labelledby="totals-heading">
            <h2 id="totals-heading">状態別</h2>
            <ul className="totals" aria-label="状態別件数">
              <li>
                <span>合計</span> <strong>{stats.total} 件</strong>
              </li>
              {STATUSES.map((s) => (
                <li key={s}>
                  <span>{STATUS_LABELS[s]}</span> <strong>{stats.byStatus[s]} 件</strong>
                </li>
              ))}
              <li>
                <span>平均対応日数</span> <strong>{formatAverageDays(stats.averageDays)}</strong>
              </li>
            </ul>
          </section>

          <section aria-labelledby="category-heading">
            <h2 id="category-heading">カテゴリ別</h2>
            <ul className="bars" aria-label="カテゴリ別件数">
              {Object.entries(stats.byCategory).map(([category, count]) => (
                <li key={category}>
                  <span className="bar-label">{CATEGORY_LABELS[category]}</span>
                  <span className="bar-track" aria-hidden="true">
                    <span className="bar-fill" style={{ width: `${(count / maxCategory) * 100}%` }} />
                  </span>
                  <span className="bar-value">{count} 件</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="daily-heading">
            <h2 id="daily-heading">日別の通報数</h2>
            <DailyChart perDay={stats.perDay} />
          </section>

          <section aria-labelledby="matrix-heading">
            <h2 id="matrix-heading">カテゴリ × 状態</h2>
            <table className="matrix">
              <thead>
                <tr>
                  <th scope="col">カテゴリ</th>
                  {COLUMNS.map((col) => (
                    <th key={col.key} scope="col" aria-sort={sort.key === col.key ? sort.direction : undefined}>
                      <button type="button" className="sort-button" onClick={() => toggleSort(col.key)}>
                        {col.label}
                        <span aria-hidden="true">
                          {sort.key === col.key ? (sort.direction === 'ascending' ? ' ▲' : ' ▼') : ''}
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.category}>
                    <th scope="row">{CATEGORY_LABELS[row.category]}</th>
                    {COLUMNS.map((col) => (
                      <td key={col.key}>{row[col.key]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </section>
  );
}
