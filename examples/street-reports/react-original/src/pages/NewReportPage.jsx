import { useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { useBlocker, useNavigate } from 'react-router';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useReportsStore } from '../context/ReportsStore.jsx';
import { useBeforeUnloadGuard } from '../hooks/useBeforeUnload.js';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { api } from '../lib/api.js';
import {
  CATEGORIES, CATEGORY_LABELS, DISTRICTS, PRIORITIES, PRIORITY_LABELS, SUBCATEGORIES, pageTitle,
} from '../lib/labels.js';
import {
  DESCRIPTION_MAX, EMPTY_REPORT, REPORT_FIELDS, isReportDirty, toReportPayload, validateReport,
} from '../lib/validation.js';

const DRAFT_KEY = 'street-reports:draft';
const DRAFT_SAVE_MS = 400;

function readDraft() {
  try {
    const draft = JSON.parse(window.localStorage.getItem(DRAFT_KEY));
    return draft && typeof draft === 'object' ? { ...EMPTY_REPORT, ...draft } : null;
  } catch {
    return null;
  }
}

function clearDraft() {
  window.localStorage.removeItem(DRAFT_KEY);
}

function initForm() {
  const draft = readDraft();
  return {
    values: draft && isReportDirty(draft) ? draft : EMPTY_REPORT,
    touched: {},
    submitAttempted: false,
    serverErrors: {},
    restored: Boolean(draft && isReportDirty(draft)),
  };
}

function formReducer(state, action) {
  switch (action.type) {
    case 'change': {
      const values = { ...state.values, [action.field]: action.value };
      if (action.field === 'category') values.subcategory = '';
      const { [action.field]: _cleared, ...serverErrors } = state.serverErrors;
      return { ...state, values, serverErrors };
    }
    case 'blur':
      return { ...state, touched: { ...state.touched, [action.field]: true } };
    case 'submitFailed':
      return { ...state, submitAttempted: true };
    case 'serverErrors':
      return { ...state, submitAttempted: true, serverErrors: action.errors };
    case 'discardDraft':
      return { values: EMPTY_REPORT, touched: {}, submitAttempted: false, serverErrors: {}, restored: false };
    default:
      return state;
  }
}

export default function NewReportPage() {
  useDocumentTitle(pageTitle('新規登録'));
  const navigate = useNavigate();
  const showToast = useToast();
  const { refreshSummary } = useReportsStore();
  const [state, dispatch] = useReducer(formReducer, undefined, initForm);
  const { values, touched, submitAttempted, serverErrors } = state;
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const leavingRef = useRef(false); // set once we navigate away on purpose
  const fieldRefs = useRef({});
  const baseId = useId();

  const errors = useMemo(() => validateReport(values), [values]);
  const dirty = isReportDirty(values);

  // Draft autosave (debounced).
  const debouncedValues = useDebouncedValue(values, DRAFT_SAVE_MS);
  useEffect(() => {
    if (leavingRef.current) return;
    if (isReportDirty(debouncedValues)) window.localStorage.setItem(DRAFT_KEY, JSON.stringify(debouncedValues));
    else clearDraft();
  }, [debouncedValues]);

  // Leave guard: in-app navigation asks in a dialog, closing/reloading the tab uses beforeunload.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !leavingRef.current && currentLocation.pathname !== nextLocation.pathname,
  );
  useBeforeUnloadGuard(dirty && !submitting);

  const fieldError = (field) =>
    serverErrors[field] ?? (touched[field] || submitAttempted ? errors[field] : undefined);

  function focusFirstError(errorMap) {
    const first = REPORT_FIELDS.find((field) => errorMap[field] && fieldRefs.current[field]);
    fieldRefs.current[first]?.focus();
  }

  function bind(field, { describedBy = [] } = {}) {
    const id = `${baseId}-${field}`;
    const error = fieldError(field);
    const described = [...describedBy, error ? `${id}-error` : null].filter(Boolean).join(' ');
    return {
      id,
      name: field,
      ref: (el) => {
        fieldRefs.current[field] = el;
      },
      value: values[field],
      onChange: (event) => dispatch({ type: 'change', field, value: event.target.value }),
      onBlur: () => dispatch({ type: 'blur', field }),
      'aria-invalid': error ? true : undefined,
      'aria-describedby': described || undefined,
    };
  }

  // The message slot is always rendered (and keeps its height) so that a message appearing on
  // blur never shifts the layout under the pointer — e.g. moving 登録 away mid-click.
  function errorText(field) {
    return (
      <p id={`${baseId}-${field}-error`} className="field-error reserved">
        {fieldError(field)}
      </p>
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submittingRef.current) return;
    if (Object.keys(errors).length > 0) {
      dispatch({ type: 'submitFailed' });
      focusFirstError(errors);
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const report = await api.createReport(toReportPayload(values));
      leavingRef.current = true;
      clearDraft();
      refreshSummary();
      showToast('通報を登録しました');
      navigate(`/reports/${report.id}`);
    } catch (err) {
      submittingRef.current = false;
      setSubmitting(false);
      if (err.status === 422 && err.data?.errors) {
        dispatch({ type: 'serverErrors', errors: err.data.errors });
        focusFirstError(err.data.errors);
      } else {
        showToast('登録に失敗しました');
      }
    }
  }

  function discardDraft() {
    clearDraft();
    dispatch({ type: 'discardDraft' });
  }

  const subcategories = SUBCATEGORIES[values.category] ?? [];
  const reporterHintId = `${baseId}-phone-hint`;
  const descriptionCounterId = `${baseId}-description-counter`;

  return (
    <section className="page">
      <h1>新規登録</h1>

      {state.restored && (
        <div className="notice" role="region" aria-label="下書き">
          <span>下書きを復元しました</span>
          <button type="button" className="secondary" onClick={discardDraft}>
            破棄
          </button>
        </div>
      )}

      <form className="report-form" noValidate onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor={`${baseId}-title`}>件名</label>
          <input type="text" autoComplete="off" {...bind('title')} />
          {errorText('title')}
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor={`${baseId}-category`}>カテゴリ</label>
            <select {...bind('category')}>
              <option value="">選択してください</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </select>
            {errorText('category')}
          </div>
          <div className="field">
            <label htmlFor={`${baseId}-subcategory`}>種別</label>
            <select {...bind('subcategory')} disabled={!values.category}>
              <option value="">選択してください</option>
              {subcategories.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {errorText('subcategory')}
          </div>
          <div className="field">
            <label htmlFor={`${baseId}-district`}>地区</label>
            <select {...bind('district')}>
              <option value="">選択してください</option>
              {DISTRICTS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            {errorText('district')}
          </div>
        </div>

        <div className="field">
          <label htmlFor={`${baseId}-address`}>住所</label>
          <input type="text" autoComplete="off" {...bind('address')} />
          {errorText('address')}
        </div>

        <div className="field">
          <label htmlFor={`${baseId}-description`}>詳細</label>
          <textarea rows={5} {...bind('description', { describedBy: [descriptionCounterId] })} />
          <span id={descriptionCounterId} className="counter">
            {values.description.length} / {DESCRIPTION_MAX}
          </span>
          {errorText('description')}
        </div>

        <fieldset className="field radio-group">
          <legend>優先度</legend>
          {PRIORITIES.map((p) => (
            <label key={p} className="inline">
              <input
                type="radio"
                name="priority"
                value={p}
                checked={values.priority === p}
                onChange={() => dispatch({ type: 'change', field: 'priority', value: p })}
              />
              {PRIORITY_LABELS[p]}
            </label>
          ))}
        </fieldset>

        <div className="field">
          <label className="inline">
            <input
              type="checkbox"
              checked={values.anonymous}
              onChange={(event) => dispatch({ type: 'change', field: 'anonymous', value: event.target.checked })}
            />
            匿名の通報
          </label>
        </div>

        {!values.anonymous && (
          <div className="field-row">
            <div className="field">
              <label htmlFor={`${baseId}-reporterName`}>通報者名</label>
              <input type="text" autoComplete="off" {...bind('reporterName')} />
              {errorText('reporterName')}
            </div>
            <div className="field">
              <label htmlFor={`${baseId}-reporterPhone`}>電話番号</label>
              <input type="tel" autoComplete="off" {...bind('reporterPhone', { describedBy: [reporterHintId] })} />
              <span id={reporterHintId} className="hint">数字とハイフン（任意）</span>
              {errorText('reporterPhone')}
            </div>
          </div>
        )}

        <div className="form-actions">
          <button type="submit" disabled={submitting}>
            {submitting ? '送信中…' : '登録'}
          </button>
        </div>
      </form>

      {blocker.state === 'blocked' && (
        <ConfirmDialog
          title="入力内容を破棄しますか？"
          message="このページを離れると、入力中の内容は失われます。"
          confirmLabel="破棄して移動"
          cancelLabel="編集に戻る"
          onConfirm={() => {
            leavingRef.current = true;
            clearDraft();
            blocker.proceed();
          }}
          onCancel={() => blocker.reset()}
        />
      )}
    </section>
  );
}
