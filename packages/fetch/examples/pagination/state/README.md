# Pagination — `@wcstack/state`

Paginated member list built with **declarative `<wcs-fetch>` + `data-wcs` bindings only** —
no `fetch()` calls, no loading/abort glue, no JavaScript wiring at all. This is one of five
demos (React / Vue / `@wcstack/state` / `@wcstack/signals` / Vanilla) that render the exact
same UI against the exact same `/api/items` endpoint, so the only difference is the approach.

## What it uses

- `@wcstack/state` via CDN (`esm.run`)
- `@wcstack/fetch` via CDN (`esm.run`)

## How to run

This buildless demo is served by the shared pagination hub (no per-example server):

```bash
node packages/fetch/examples/pagination/shared/server.js
```

Then open `http://localhost:3400/state/`.

The hub also serves the gallery, the other buildless demos, and the live `/api/items`
endpoint (`GET /api/items?page=<1-based>&limit=12`, ~400 ms latency, 200 members / 17 pages).

## The interesting bits

- **Zero JS glue.** The whole flow is HTML: a computed `itemsFetch.url` getter rebuilds the
  URL from `page`, one `<wcs-fetch data-wcs="...: itemsFetch">` runs the request, and the
  response JSON lands in `itemsFetch.value`. The element is the authority for that output —
  it is `null` before the first response and again after an error — so the template never
  reads it directly: null-safe getters (`rows` / `total` / `totalPages`) project it, and the
  list binds `for: rows`.
- **Automatic stale-response protection.** Clicking a page only changes `page`; the URL
  getter recomputes, `<wcs-fetch>` sees the new `url`, and it **aborts the previous in-flight
  request** before starting the new one. No `AbortController`, no "is this still the current
  page?" checks.
- **Stale-while-revalidate, declaratively.** `class.stale: itemsFetch.loading` dims the
  current rows during a reload instead of replacing them with a spinner; the first-load
  spinner shows only when `loading` is true and there are no rows yet (`firstLoading`).
  On an HTTP/network error `<wcs-fetch>` resets `value` to `null`, so `totalPages` falls
  back to `1` and the pager minimises to a single page — the same recovery state in all
  five demos.
- **Mutual exclusion via predicates.** `@wcstack/state` has no `else`, so the three
  blocks (spinner / error / list) are three independent `if`s made mutually exclusive by
  their predicates: `firstLoading`, `itemsFetch.error`, and `showList` — the last defined
  as `!firstLoading && !error`. Since a fresh response clears `error` and an error clears
  the value, exactly one of the three is ever true, matching the `if/else-if/else` chain
  in the React / Vue / Vanilla / signals demos.
- **The pager as data.** A `pageTokens` getter returns the page window (first, last,
  current ±1, with collapsed gaps) as objects, and a `for:` loop turns each into a button or
  an ellipsis. The click handler reads the clicked token via the `*` loop path
  (`this["pageTokens.*"]`) since `onclick` can't take arguments.

The spread `...: itemsFetch` wires every `<wcs-fetch>` property and input
(`url` / `value` / `loading` / `error` / `status` / …) to the `itemsFetch` slot in one line.
