import { useId, useState } from 'react';
import { Link, useParams } from 'react-router';
import { CommentForm } from '../components/CommentForm.jsx';
import { Lightbox } from '../components/Lightbox.jsx';
import { useStaff } from '../context/StaffContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useReportsStore } from '../context/ReportsStore.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useFetch } from '../hooks/useFetch.js';
import { useNow } from '../hooks/useNow.js';
import { api } from '../lib/api.js';
import { formatDateTime, formatRelative } from '../lib/format.js';
import {
  CATEGORY_LABELS, PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS, pageTitle, staffName,
} from '../lib/labels.js';

/** Keyed by id so that moving to another report starts from a clean slate (and aborts the old request). */
export default function ReportDetailPage() {
  const { id } = useParams();
  return <ReportDetail key={id} id={id} />;
}

function NotFound() {
  useDocumentTitle(pageTitle('通報が見つかりません'));
  return (
    <section className="page">
      <h1>通報が見つかりません</h1>
      <p>指定された通報は存在しないか、削除されました。</p>
      <Link to="/reports">通報一覧へ戻る</Link>
    </section>
  );
}

/** 前の通報 / 次の通報. While a report loads, ids are assumed contiguous so users can keep flipping. */
function DetailNav({ prevId, nextId }) {
  return (
    <nav className="detail-nav" aria-label="前後の通報">
      <Link to="/reports">← 一覧へ</Link>
      <span className="spacer" />
      {prevId != null && <Link to={`/reports/${prevId}`}>前の通報</Link>}
      {nextId != null && <Link to={`/reports/${nextId}`}>次の通報</Link>}
    </nav>
  );
}

function ReportDetail({ id }) {
  const valid = /^\d+$/.test(id);
  const { data: report, error, loading, reload, mutate } = useFetch(valid ? `/api/reports/${id}` : null);

  useDocumentTitle(report ? pageTitle(`${report.title} - 通報 #${report.id}`) : pageTitle(`通報 #${id}`));

  if (!valid || error?.status === 404) return <NotFound />;
  if (error) {
    return (
      <section className="page">
        <div className="error-box" role="alert">
          <p>読み込みに失敗しました</p>
          <button type="button" onClick={reload}>再試行</button>
        </div>
      </section>
    );
  }
  if (loading || !report) {
    return (
      <section className="page" aria-busy="true">
        <DetailNav prevId={Number(id) > 1 ? Number(id) - 1 : null} nextId={Number(id) + 1} />
        <p className="loading">読み込み中…</p>
      </section>
    );
  }
  return <ReportView report={report} mutate={mutate} />;
}

function ReportView({ report, mutate }) {
  const { staff } = useStaff();
  const showToast = useToast();
  const { statusChanged, refreshSummary } = useReportsStore();
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [lightbox, setLightbox] = useState(null); // { index, opener }
  const ids = { status: useId(), assignee: useId(), priority: useId() };

  async function change(field, value) {
    const previous = report;
    if (previous[field] === value) return;
    mutate((r) => ({ ...r, [field]: value }));
    if (field === 'status') statusChanged(previous.status, value);
    setSaving(true);
    setConflict(false);
    try {
      const updated = await api.patchReport(previous.id, previous.version, { [field]: value });
      mutate((r) => ({ ...r, ...updated }));
    } catch (err) {
      if (field === 'status') statusChanged(value, previous.status);
      if (err.status === 409 && err.data?.report) {
        mutate((r) => ({ ...r, ...err.data.report }));
        setConflict(true);
        refreshSummary();
      } else {
        mutate((r) => ({ ...r, [field]: previous[field], version: previous.version }));
        showToast('更新に失敗しました');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="page detail">
      <DetailNav prevId={report.prevId} nextId={report.nextId} />

      <p className="report-number">通報 #{report.id}</p>
      <h1>{report.title}</h1>

      {conflict && (
        <p className="notice warning" role="alert">
          他の職員が更新しました。最新の内容を表示しています。
        </p>
      )}

      <fieldset className="controls" disabled={saving}>
        <legend>対応状況</legend>
        <div className="field">
          <label htmlFor={ids.status}>状態</label>
          <select id={ids.status} value={report.status} onChange={(e) => change('status', e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.assignee}>担当</label>
          <select
            id={ids.assignee}
            value={report.assigneeId ?? ''}
            onChange={(e) => change('assigneeId', e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="">未割り当て</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.priority}>優先度</label>
          <select id={ids.priority} value={report.priority} onChange={(e) => change('priority', Number(e.target.value))}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
            ))}
          </select>
        </div>
      </fieldset>

      <dl className="fields">
        <dt>カテゴリ</dt>
        <dd>{CATEGORY_LABELS[report.category]}（{report.subcategory}）</dd>
        <dt>地区</dt>
        <dd>{report.district}</dd>
        <dt>住所</dt>
        <dd>{report.address}</dd>
        <dt>受付日時</dt>
        <dd>{formatDateTime(report.reportedAt)}</dd>
        <dt>更新日時</dt>
        <dd>{formatDateTime(report.updatedAt)}</dd>
        <dt>通報者</dt>
        <dd>
          {report.anonymous ? '匿名' : `${report.reporterName}${report.reporterPhone ? `（${report.reporterPhone}）` : ''}`}
        </dd>
        <dt>詳細</dt>
        <dd className="description">{report.description}</dd>
      </dl>

      {report.photos.length > 0 && (
        <section aria-labelledby="photos-heading">
          <h2 id="photos-heading">写真</h2>
          <ul className="thumbs">
            {report.photos.map((photo, index) => (
              <li key={photo.id}>
                <button
                  type="button"
                  className="thumb"
                  aria-label={`写真 ${index + 1} を拡大`}
                  onClick={(event) => setLightbox({ index, opener: event.currentTarget })}
                >
                  <img src={photo.url} alt="" width="120" height="90" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Comments reportId={report.id} staff={staff} />

      {lightbox && (
        <Lightbox
          photos={report.photos}
          index={lightbox.index}
          onIndexChange={(index) => setLightbox((lb) => ({ ...lb, index }))}
          onClose={() => setLightbox(null)}
          returnFocusTo={lightbox.opener}
        />
      )}
    </article>
  );
}

function Comments({ reportId, staff }) {
  const { currentStaffId } = useStaff();
  const { data: comments, error, mutate } = useFetch(`/api/reports/${reportId}/comments`);
  const now = useNow(10000);

  async function addComment(body) {
    const comment = await api.addComment(reportId, currentStaffId, body);
    mutate((list) => [...(list ?? []), comment]);
  }

  return (
    <section className="comments" aria-labelledby="comments-heading">
      <h2 id="comments-heading">コメント</h2>
      {error && <p role="alert">コメントを読み込めませんでした</p>}
      {comments && comments.length === 0 && <p className="muted">コメントはまだありません</p>}
      {comments && comments.length > 0 && (
        <ol className="comment-list">
          {comments.map((c) => (
            <li key={c.id}>
              <div className="comment-meta">
                <span className="author">{staffName(staff, c.authorId)}</span>
                <time dateTime={c.createdAt} title={formatDateTime(c.createdAt)}>
                  {formatRelative(c.createdAt, now)}
                </time>
              </div>
              <p>{c.body}</p>
            </li>
          ))}
        </ol>
      )}
      <CommentForm onSubmit={addComment} />
    </section>
  );
}
