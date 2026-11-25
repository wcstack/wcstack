export function Pagination({ page, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;
  return (
    <nav className="pagination" aria-label="ページ送り">
      <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        前へ
      </button>
      <span>
        {page} / {totalPages} ページ
      </span>
      <button type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
        次へ
      </button>
    </nav>
  );
}
