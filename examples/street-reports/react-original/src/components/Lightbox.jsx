import { useRef } from 'react';
import { Modal } from './Modal.jsx';

export function Lightbox({ photos, index, onIndexChange, onClose, returnFocusTo }) {
  const closeRef = useRef(null);
  const photo = photos[index];
  const go = (delta) => onIndexChange((index + delta + photos.length) % photos.length);

  function handleKeyDown(event) {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      go(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      go(-1);
    }
  }

  return (
    <Modal
      title={`写真 ${index + 1} / ${photos.length}`}
      onClose={onClose}
      onKeyDown={handleKeyDown}
      initialFocusRef={closeRef}
      returnFocusTo={returnFocusTo}
      className="lightbox"
    >
      <img src={photo.url} alt={photo.alt} className="lightbox-image" />
      <div className="modal-actions">
        <button type="button" onClick={() => go(-1)}>
          ← 前の写真
        </button>
        <button type="button" onClick={() => go(1)}>
          次の写真 →
        </button>
        <button type="button" ref={closeRef} onClick={onClose}>
          閉じる
        </button>
      </div>
    </Modal>
  );
}
