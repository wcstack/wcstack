import { useMemo, useState } from "react";
import { useWcBindable } from "@wc-bindable/react";

const LIMIT = 12;

type Role = "admin" | "editor" | "viewer";

interface Member {
  id: number;
  name: string;
  email: string;
  role: Role;
  joinedAt: string;
}

interface ItemsResponse {
  items: Member[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * The wcBindable properties `<wcs-fetch>` mirrors into React state. `status` is
 * not used by the UI here, but every demo mirrors it to show <wcs-fetch> exposes
 * the HTTP status too.
 */
interface FetchValues {
  value: ItemsResponse | null;
  loading: boolean;
  error: unknown;
  status: number;
}

// Teach JSX about the headless <wcs-fetch> element (registered by
// `@wcstack/fetch/auto` in main.tsx). Only its one driven input, `url`, is
// declared as a JSX attribute — the output properties (value/loading/error/
// status) are not JSX attributes; they are subscribed via useWcBindable below.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "wcs-fetch": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & { url?: string };
    }
  }
}

/** A page-button number, or a collapsed "gap" rendered as an ellipsis. */
type PageToken = number | "gap";

/**
 * Always show: first page, last page, and current ±1; collapse gaps to an
 * ellipsis. (Identical algorithm across all five framework demos.)
 */
function pageWindow(current: number, totalPages: number): PageToken[] {
  const set = new Set([1, totalPages, current - 1, current, current + 1]);
  const sorted = [...set].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const out: PageToken[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push("gap");
    out.push(p);
    prev = p;
  }
  return out; // e.g. [1, "gap", 4, 5, 6, "gap", 17]
}

export function App() {
  const [page, setPage] = useState(1);

  // Bind the headless <wcs-fetch> node: `bindRef` attaches the adapter to the
  // element, `values` mirrors its wcBindable properties (value/loading/error/
  // status) into React state. No fetch()/AbortController here — writing `url`
  // (below) makes <wcs-fetch> refetch and abort the previous in-flight request,
  // so stale-response protection lives in the element.
  const [bindRef, values] = useWcBindable<HTMLElement, FetchValues>({
    value: null,
    loading: false,
    error: null,
    status: 0,
  });

  const url = `/api/items?page=${page}&limit=${LIMIT}`;

  const data = values.value;
  const loading = values.loading;
  const error = values.error;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const hasData = items.length > 0;

  const tokens = useMemo(() => pageWindow(page, totalPages), [page, totalPages]);

  const rangeText = hasData
    ? `${(page - 1) * LIMIT + 1}–${(page - 1) * LIMIT + items.length} of ${total}` // EN DASH (U+2013)
    : "Loading…";
  const pageLabel = hasData ? `Page ${page} / ${totalPages}` : "";

  const isFirst = page <= 1;
  const isLast = page >= totalPages;

  const go = (p: number) => {
    if (p >= 1 && p <= totalPages && p !== page) setPage(p);
  };

  const firstLoading = loading && !hasData;

  // The node IS a state machine; these expose its observable state. We don't
  // orchestrate the fetch — we read which state the node is in (idle → loading →
  // ready / error) and the HTTP status it produced.
  const machineState = error ? "error" : loading ? "loading" : hasData ? "ready" : "idle";
  const statusLabel = values.status ? `HTTP ${values.status}` : "—";

  return (
    <div className="demo">
      <header className="demo-header">
        <span className="demo-badge">React</span>
        <h1>Pagination — React</h1>
        <p>useState + &lt;wcs-fetch&gt; via @wc-bindable/react</p>
      </header>

      {/* Headless data node. Writing `url` triggers a fetch (and aborts the
          previous one); `bindRef` streams its state into `values`. */}
      <wcs-fetch ref={bindRef} url={url} />

      <div className="panel">
        {/* The node's state machine: input (the page we write) → current state →
            the HTTP status it produced. */}
        <div className="machine">
          <span className="machine-io">page {page}</span>
          <span className="machine-arrow">→</span>
          <span className={`machine-state is-${machineState}`}>{machineState}</span>
          <span className="machine-arrow">→</span>
          <span className="machine-io">{statusLabel}</span>
        </div>

        <div className="toolbar">
          <span className="status">{rangeText}</span>
          <span className="status">{pageLabel}</span>
        </div>

        {firstLoading ? (
          <div className="spinner" aria-hidden="true"></div>
        ) : error ? (
          <div className="error" role="alert">Failed to load. Try again.</div>
        ) : (
          // Only reached with rows present, so hasData is guaranteed and `loading`
          // alone drives the stale dimming — matching the other four demos.
          <ul className={loading ? "member-list stale" : "member-list"}>
            {items.map((m) => (
              <li key={m.id}>
                <div className="member-item">
                  <div className="member-main">
                    <span className="member-name">{m.name}</span>
                    <span className="member-email">{m.email}</span>
                  </div>
                  <div className="member-meta">
                    <span className="member-date">{m.joinedAt}</span>
                    <span className={`role-badge ${m.role}`}>{m.role}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <nav className="pagination" aria-label="Pagination">
          <button className="page-btn" disabled={isFirst} onClick={() => go(page - 1)}>
            ‹ Prev
          </button>
          {tokens.map((tok, i) =>
            tok === "gap" ? (
              <span className="page-ellipsis" key={`gap-${i}`}>
                …
              </span>
            ) : (
              <button
                className={tok === page ? "page-btn active" : "page-btn"}
                disabled={tok === page}
                aria-current={tok === page ? "page" : "false"}
                onClick={() => go(tok)}
                key={tok}
              >
                {tok}
              </button>
            ),
          )}
          <button className="page-btn" disabled={isLast} onClick={() => go(page + 1)}>
            Next ›
          </button>
        </nav>
      </div>

      <p className="note">
        React drives the headless <code>&lt;wcs-fetch&gt;</code> node declaratively:
        the <code>url</code> prop is derived from <code>page</code>, and{" "}
        <code>@wc-bindable/react</code>'s <code>useWcBindable</code> mirrors the
        element's <code>value</code> / <code>loading</code> / <code>error</code> into
        React state. The element refetches and aborts the previous request on its
        own — no <code>AbortController</code> glue. It hits the same shared{" "}
        <code>/api/items</code> server as the other four demos.
      </p>
    </div>
  );
}
