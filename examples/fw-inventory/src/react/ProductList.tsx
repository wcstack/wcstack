import { useState } from "react";
import { Link } from "react-router";
import type { WcsFetchValues } from "@wcstack/fetch";
import { useIoNode } from "./useIoNode";
import type { ProductPage, Sort } from "./types";
import { useLiveStock, ConnectionBadge } from "./LiveStock";
import { useFilterStore } from "./FilterStore";
import { usePicked } from "./Picked";

const SIZE = 10;
type FetchEl = HTMLElement & { fetch(): Promise<unknown> };

export function ProductList() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<Sort>("name");

  const store = useFilterStore({ q, page, sort }, (f) => {
    if (typeof f.q === "string") setQ(f.q);
    if (typeof f.page === "number") setPage(f.page);
    if (f.sort) setSort(f.sort);
  });

  // The url is the query: <wcs-fetch> fetches when it changes and aborts the request it replaces.
  const url = `/api/products?q=${encodeURIComponent(q)}&page=${page}&size=${SIZE}&sort=${sort}`;
  const [fetchRef, list, fetchEl] = useIoNode<FetchEl, WcsFetchValues<ProductPage | null>>({
    value: null, loading: false, error: null, status: 0,
  });

  const stock = useLiveStock();
  const picked = usePicked();
  const items = list.value?.items ?? [];
  const total = list.value?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / SIZE));

  return (
    <section>
      <wcs-fetch ref={fetchRef} url={url} data-testid="list-fetch"></wcs-fetch>
      {stock.node}
      {store.node}
      <div className="toolbar">
        <ConnectionBadge status={stock.status} />
        <input data-testid="search" placeholder="Search name or SKU" value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select data-testid="sort" value={sort} onChange={(e) => { setSort(e.target.value as Sort); setPage(1); }}>
          <option value="name">Name</option>
          <option value="stock">Stock ↑</option>
          <option value="-stock">Stock ↓</option>
        </select>
        <button data-testid="prev" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
        <span data-testid="page">Page {page} / {pages}</span>
        <button data-testid="next" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
        {/* a command, not `trigger` from React state: the second `true` would not be written */}
        <button data-testid="refresh" onClick={() => fetchEl.current?.fetch()}>Refresh</button>
        {list.loading && <span data-testid="loading">Loading…</span>}
      </div>
      {store.error ? <p className="error" data-testid="store-error">Filters not saved: {(store.error as any).message}</p> : null}
      {list.error ? (
        <p className="error" data-testid="error">
          Could not load products ({(list.error as any).status ?? (list.error as any).message}).{" "}
          <button data-testid="retry" onClick={() => fetchEl.current?.fetch()}>Retry</button>
        </p>
      ) : null}
      {!list.loading && !list.error && list.value && items.length === 0 && (
        <p data-testid="empty">No products match “{q}”.</p>
      )}
      <table>
        <thead><tr><th>SKU</th><th>Name</th><th>Stock</th><th>Price</th><th></th></tr></thead>
        <tbody data-testid="rows">
          {items.map((p) => (
            <tr key={p.id} data-id={p.id}>
              <td>{p.sku}</td>
              <td><Link to={`/products/${p.id}`} data-testid="product-link">{p.name}</Link></td>
              <td className={"stock" + (stock.lastId === p.id ? " flash" : "")} data-testid="stock" key={stock.live[p.id]}>{stock.live[p.id] ?? p.stock}</td>
              <td>{p.price.toFixed(2)}</td>
              <td><button data-testid="pick" onClick={() => picked.pick(p)}>Pick</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p data-testid="total">{total} products</p>
    </section>
  );
}
