import { useId, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link } from 'react-router';
import { useStaff } from '../context/StaffContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useReportsStore } from '../context/ReportsStore.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useEventSource } from '../hooks/useEventSource.js';
import { useFetch } from '../hooks/useFetch.js';
import { api } from '../lib/api.js';
import { PRIORITY_LABELS, STATUSES, STATUS_LABELS, pageTitle, staffName, stepStatus } from '../lib/labels.js';

const BACK = -1;
const FORWARD = 1;

function byPriorityThenUpdate(a, b) {
  return b.priority - a.priority || b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id;
}

/** Applies a live update: replaces a known card unless we already hold a newer version, or adds a new one. */
function upsert(cards, report) {
  if (!cards) return cards;
  const index = cards.findIndex((c) => c.id === report.id);
  if (index === -1) return [...cards, report];
  if (cards[index].version > report.version) return cards;
  const next = cards.slice();
  next[index] = { ...cards[index], ...report };
  return next;
}

function toCard({ description, photos, prevId, nextId, ...card }) {
  return card;
}

export default function BoardPage() {
  useDocumentTitle(pageTitle('ボード'));
  const { staff, currentStaffId } = useStaff();
  const { statusChanged, refreshSummary } = useReportsStore();
  const showToast = useToast();
  const { data: cards, error, reload, mutate } = useFetch('/api/reports/board');
  const [mineOnly, setMineOnly] = useState(false);
  const buttonRefs = useRef(new Map());
  const mineId = useId();

  // The board's own live subscription; it closes when the board unmounts.
  useEventSource('/api/events', 'report', (report) => mutate((list) => upsert(list, report)));

  const columns = useMemo(() => {
    const visible = (cards ?? []).filter((c) => !mineOnly || c.assigneeId === currentStaffId);
    return STATUSES.map((status) => ({
      status,
      cards: visible.filter((c) => c.status === status).sort(byPriorityThenUpdate),
    }));
  }, [cards, mineOnly, currentStaffId]);

  function focusCardButton(id, direction) {
    const preferred = buttonRefs.current.get(`${id}:${direction}`);
    const fallback = buttonRefs.current.get(`${id}:${-direction}`);
    const target = preferred && !preferred.disabled ? preferred : fallback;
    target?.focus();
  }

  function replaceCard(id, update) {
    flushSync(() => mutate((list) => list.map((c) => (c.id === id ? update(c) : c))));
  }

  async function move(card, direction) {
    const to = stepStatus(card.status, direction);
    if (!to) return;
    replaceCard(card.id, (c) => ({ ...c, status: to }));
    focusCardButton(card.id, direction);
    statusChanged(card.status, to);
    try {
      const updated = await api.patchReport(card.id, card.version, { status: to });
      mutate((list) => upsert(list, toCard(updated)));
    } catch (err) {
      statusChanged(to, card.status);
      if (err.status === 409 && err.data?.report) {
        replaceCard(card.id, () => toCard(err.data.report));
        refreshSummary();
        showToast('他の職員が更新しました');
      } else {
        replaceCard(card.id, (c) => ({ ...c, status: card.status, version: card.version }));
        showToast('更新に失敗しました');
      }
      focusCardButton(card.id, direction);
    }
  }

  const setButtonRef = (id, direction) => (el) => {
    const key = `${id}:${direction}`;
    if (el) buttonRefs.current.set(key, el);
    else buttonRefs.current.delete(key);
  };

  return (
    <section className="page">
      <div className="page-header">
        <h1>ボード</h1>
        <label className="inline" htmlFor={mineId}>
          <input id={mineId} type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
          自分の担当のみ
        </label>
      </div>

      {error && (
        <div className="error-box" role="alert">
          <p>読み込みに失敗しました</p>
          <button type="button" onClick={reload}>再試行</button>
        </div>
      )}
      {!cards && !error && <p className="loading">読み込み中…</p>}

      {cards && (
        <div className="board">
          {columns.map((column) => (
            <section key={column.status} className="column" aria-labelledby={`column-${column.status}`}>
              <div className="column-header">
                <h2 id={`column-${column.status}`}>{STATUS_LABELS[column.status]}</h2>
                <span className="count">{column.cards.length} 件</span>
              </div>
              <ul className="cards">
                {column.cards.map((card) => (
                  <li key={card.id}>
                    <article className="card" aria-labelledby={`card-${card.id}`}>
                      <h3 id={`card-${card.id}`}>
                        <Link to={`/reports/${card.id}`}>{card.title}</Link>
                      </h3>
                      <p className="card-meta">
                        <span>{card.district}</span>
                        <span>担当: {staffName(staff, card.assigneeId)}</span>
                        <span className={`priority priority-${card.priority}`}>優先度 {PRIORITY_LABELS[card.priority]}</span>
                      </p>
                      <div className="card-actions">
                        <button
                          type="button"
                          ref={setButtonRef(card.id, BACK)}
                          disabled={!stepStatus(card.status, BACK)}
                          onClick={() => move(card, BACK)}
                        >
                          ← 戻す
                        </button>
                        <button
                          type="button"
                          ref={setButtonRef(card.id, FORWARD)}
                          disabled={!stepStatus(card.status, FORWARD)}
                          onClick={() => move(card, FORWARD)}
                        >
                          進める →
                        </button>
                      </div>
                    </article>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
