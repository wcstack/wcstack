import { createContext, use, useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { createPortal } from 'react-dom';

const ToastContext = createContext(null);
export const MAX_VISIBLE_TOASTS = 3;
export const TOAST_DURATION = 4000;

function toastReducer(toasts, action) {
  switch (action.type) {
    case 'add':
      return [...toasts, action.toast];
    case 'dismiss':
      return toasts.filter((t) => t.id !== action.id);
    default:
      return toasts;
  }
}

function Toast({ toast, onDismiss }) {
  // The timer starts when the toast becomes visible, so queued toasts get their full 4 s.
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_DURATION);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div className="toast">
      <span>{toast.message}</span>
      <button type="button" className="toast-close" aria-label="通知を閉じる" onClick={() => onDismiss(toast.id)}>
        ×
      </button>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, dispatch] = useReducer(toastReducer, []);
  const nextId = useRef(1);

  const showToast = useCallback((message) => {
    dispatch({ type: 'add', toast: { id: nextId.current++, message } });
  }, []);
  const dismiss = useCallback((id) => dispatch({ type: 'dismiss', id }), []);
  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext value={value}>
      {children}
      {createPortal(
        <div className="toasts" role="status" aria-live="polite">
          {toasts.slice(0, MAX_VISIBLE_TOASTS).map((toast) => (
            <Toast key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext>
  );
}

export function useToast() {
  return use(ToastContext).showToast;
}
