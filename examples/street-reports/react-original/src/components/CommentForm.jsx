import { useId, useRef, useState } from 'react';
import { COMMENT_MAX, canSubmitComment } from '../lib/validation.js';

/** `onSubmit(body)` returns a promise; the text is cleared only when it resolves. */
export function CommentForm({ onSubmit }) {
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const textareaRef = useRef(null);
  const id = useId();
  const counterId = `${id}-counter`;
  const errorId = `${id}-error`;
  const canSubmit = canSubmitComment(body) && !submitting;
  const over = body.length > COMMENT_MAX;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(body);
      setBody('');
    } catch {
      setError('コメントを送信できませんでした。時間をおいて再度お試しください。');
    } finally {
      setSubmitting(false);
      textareaRef.current?.focus();
    }
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form
      className="comment-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label htmlFor={id}>コメント</label>
      <textarea
        id={id}
        ref={textareaRef}
        rows={3}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={handleKeyDown}
        aria-invalid={over || undefined}
        aria-describedby={error ? `${counterId} ${errorId}` : counterId}
      />
      <div className="comment-form-footer">
        <span id={counterId} className={over ? 'counter over' : 'counter'}>
          {body.length} / {COMMENT_MAX}
        </span>
        <button type="submit" disabled={!canSubmit}>
          {submitting ? '送信中…' : '送信'}
        </button>
      </div>
      {error && (
        <p id={errorId} className="field-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
