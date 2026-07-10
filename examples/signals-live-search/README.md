# signals + &lt;wcs-fetch&gt; demo

A demo of the **`@wcstack/signals`** package — a buildless, signals-based
reactive core (TC39-Signals-shaped, zero runtime deps). It drives real DOM with a
fine-grained `h()` and consumes a real `<wcs-fetch>` IO node through the
wc-bindable adapter.

## Getting Started

Fully buildless: both `@wcstack/signals` and `@wcstack/fetch` load from a CDN
([esm.run](https://esm.run)).

```bash
node examples/signals-live-search/server.js
```

Open http://localhost:3000 in your browser.

## What it shows

- **Counter** — a `<signal-counter>` custom element built on `SignalsElement`. Pure
  signals, no IO. `connectedCallback` mounts `render()` under an ownership root;
  `disconnectedCallback` disposes every effect. The `×2` label is a `computed`, so it
  only re-renders when the doubled *value* changes (equality short-circuit).
- **Live people search** — a `query` signal sets the `url` of a real `<wcs-fetch>`;
  the element auto-fetches and the adapter folds its events back into signals; `h`
  renders the list. Typing fast aborts the in-flight request (FetchCore cancels the
  superseded one).

## Key points

- **One adapter, any IO node.** `bindNode(fetchEl)` reads the element's
  `wcBindable` descriptor (`fetchEl.constructor.wcBindable`) and turns its output
  properties (`value` / `loading` / `error` / `status`) into read-only signals. The
  `<wcs-fetch>` element has **no idea** a signal core is behind the binding — that is
  the whole point: IO is the node, reactivity is the core.
- **Fine-grained `h`, no VDOM.** `h(tag, props, ...children)` creates real DOM once;
  a prop or child given as a **function/signal** is wired to a targeted `effect`, so
  only that one binding updates. No reconciler is shipped.
- **JSX-shaped but not shipped.** `h` is the classic JSX factory — a consumer *could*
  set `jsxFactory: "h"` in their own tsconfig — but this demo stays buildless and
  calls `h` directly.
- **Ownership → lifecycle.** `createRoot` collects every effect created during
  `render()`; the custom element disposes that root on disconnect. No effect leaks.
- **One entry per page on the CDN.** The page imports *everything* — headless core
  and DOM layer — from the single `@wcstack/signals/dom` entry (it re-exports the
  whole core). On the CDN each entry is a self-contained bundle with its own copy of
  the core, so mixing `@wcstack/signals` and `@wcstack/signals/dom` imports on one
  page would load two reactive instances and break reactivity across the seam.
  (A local npm install doesn't have this constraint: Rollup code-splitting gives both
  entries one shared `core-*.esm.js` chunk.)

> See `docs/signals-state-design.md` for the design and `packages/signals` for the
> implementation and tests.
