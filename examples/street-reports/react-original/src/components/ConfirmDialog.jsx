import { useRef } from 'react';
import { Modal } from './Modal.jsx';

export function ConfirmDialog({ title, message, confirmLabel, cancelLabel, onConfirm, onCancel }) {
  const cancelRef = useRef(null);
  return (
    <Modal title={title} onClose={onCancel} initialFocusRef={cancelRef}>
      {message && <p>{message}</p>}
      <div className="modal-actions">
        <button type="button" ref={cancelRef} onClick={onCancel}>
          {cancelLabel}
        </button>
        <button type="button" className="danger" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
