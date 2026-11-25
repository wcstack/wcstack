import { Link } from 'react-router';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { pageTitle } from '../lib/labels.js';

export default function NotFoundPage() {
  useDocumentTitle(pageTitle('ページが見つかりません'));
  return (
    <section className="page">
      <h1>ページが見つかりません</h1>
      <p>お探しのページは移動または削除された可能性があります。</p>
      <Link to="/">トップへ戻る</Link>
    </section>
  );
}
