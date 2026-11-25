import { STATUS_LABELS } from '../lib/labels.js';

export function StatusBadge({ status }) {
  return <span className={`status status-${status}`}>{STATUS_LABELS[status]}</span>;
}
