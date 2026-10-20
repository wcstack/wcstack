import { useParams, useNavigate, Link } from "react-router";
import type { WcsFetchValues } from "@wcstack/fetch";
import { useIoNode } from "./useIoNode";
import type { ProductDetail } from "./types";
import { Photos } from "./Photos";

export function ProductPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [ref, detail, el] = useIoNode<HTMLElement & { fetch(): Promise<unknown> }, WcsFetchValues<ProductDetail | null>>({
    value: null, loading: false, error: null, status: 0,
  });

  const p = detail.value;
  const notFound = (detail.error as any)?.status === 404;
  // the page shows a value only if it is the one asked for (quick navigation between products)
  const current = p && String(p.id) === id ? p : null;
  return (
    <section>
      <wcs-fetch ref={ref} url={`/api/products/${id}`} data-testid="detail-fetch"></wcs-fetch>
      <p><button data-testid="back" onClick={() => ((window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate("/"))}>← Back</button> <Link to="/">All products</Link></p>
      {detail.loading && <p data-testid="detail-loading">Loading product {id}…</p>}
      {notFound && <p className="error" data-testid="not-found">Product {id} does not exist.</p>}
      {detail.error && !notFound ? (
        <p className="error" data-testid="detail-error">Could not load product {id}. <button onClick={() => el.current?.fetch()}>Retry</button></p>
      ) : null}
      {current && (
        <article data-testid="detail">
          <h2 data-testid="detail-name">{current.name}</h2>
          <p>{current.sku} · stock <span data-testid="detail-stock">{current.stock}</span> · {current.price.toFixed(2)}</p>
          <Photos productId={current.id} initial={current.photos} />
        </article>
      )}
    </section>
  );
}
