# signals + &lt;wcs-fetch&gt; demo

A demo of the experimental **`@wcstack/signals`** package — a buildless, signals-based
reactive core (TC39-Signals-shaped, zero runtime deps). It drives real DOM with a
fine-grained `h()` and consumes a real `<wcs-fetch>` IO node through the
wc-bindable adapter.

## Getting Started

`@wcstack/signals` is unpublished, so build it locally first, then run the server.
`@wcstack/fetch` still loads from a CDN ([esm.run](https://esm.run)).

```bash
# 1. build the signals bundle (one-time)
cd packages/signals && npm install && npm run build && cd -

# 2. run the demo
node examples/signals-live-search/server.js
```

Open http://localhost:3000 in your browser. The server serves the locally-built
`packages/signals/dist/dom.esm.js` at `/signals/dom.esm.js` (mapped via an import map).

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
- **One shared core across both entries.** The page imports the headless core from
  `@wcstack/signals` *and* the DOM layer from `@wcstack/signals/dom` (see the import
  map and module script). The production packaging (Rollup code-splitting) emits a
  single shared `core-*.esm.js` chunk that both entries import, so the page loads
  **one** reactive instance even when mixing entries. (Pre-Phase-1 each entry inlined
  its own copy of the core, which duplicated module globals and broke reactivity
  across the seam — that is no longer the case.)

> See `docs/signals-state-design.md` for the design and `packages/signals` for the
> implementation and tests.
