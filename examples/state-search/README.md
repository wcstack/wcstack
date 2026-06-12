# state + fetch + debounce demo (live search)

A demo combining `@wcstack/state`, `@wcstack/fetch`, and `@wcstack/debounce` into an incremental search. It hits the API **only 300ms after the input goes quiet**, filtering a product catalog as you type.

## Getting Started

The packages load from a CDN ([esm.run](https://esm.run)), so no local build is needed — Node.js alone is enough.

```bash
node examples/state-search/server.js
```

Open http://localhost:3000 in your browser.

## Features

- **Incremental search**: The `<input>` is bound to `state`; results are fetched from `/api/search?q=` and rendered as a list
- **Debounce**: `<wcs-debounce wait="300">` coalesces keystrokes — no request while typing, one search after it settles
- **API request counter**: Shows how many requests were *sent*, making the debounce payoff visible (the count does *not* grow per keystroke)
- **Stale-response safety**: an in-flight request is aborted by `wcs-fetch` when the url changes, so a slow earlier response can't overwrite a newer result
- **Status display**: Switches between typing / searching / N hits (computed exclusively so text and colour always agree)

## Data Flow

```
<input> ──value──▶ state.query
                      │
                      ▼  source
            <wcs-debounce wait=300>
                      │  value / pending
                      ▼
        state.debouncedQuery / state.typing
                      │
                      ▼  get "searchFetch.url"()  (derives the URL from debouncedQuery)
                <wcs-fetch>  (auto-fetches when url changes)
                      │  value / loading / error
                      ▼
                state.searchFetch.*  ──▶  result list
```

## Key Points

- Uses the **value surface** (`source` → `value`) rather than the signal surface (`trigger` → `fired`): we just write the debounced *value* back into state
- `get "searchFetch.url"()` depends on `debouncedQuery`, so the `<wcs-fetch>` url only changes when the debounced value changes, triggering an auto refetch
- An empty query returns `/api/search` (the full catalog), so the initial view shows everything
- **Stale-response safety**: a new search aborts the in-flight request via `AbortController`. An aborted request emits no response event, so an older result can never overwrite a newer one. The server delay is randomized (150–800ms) on purpose so this out-of-order race is actually reproducible
- **Counted at send time**: `eventToken.loading: requestStarted` counts the `false→true` edge of `loading`. Counting `value` (the response) would under-count, since an aborted request emits no response — so a request that went out would be missed. Send-time counting is accurate regardless of aborts. This holds even when a request is superseded: `FetchCore` dispatches `loading-changed(true)` unconditionally at the start of *every* request (no value de-dup), so the superseding request is still counted. To verify, watch the server terminal — it logs `[search] #N` on each arrival; that ground-truth count matches the on-screen counter
- **Status is computed exclusively**: while a re-typed search is mid-flight, `typing` and `loading` can both be true. To keep the text (`statusText`) and colour (`class.*`) in sync, exclusive flags are derived with a `typing > loading > idle` priority and bound to `class`
