# :state() showcase

> **Note**: The `:state()` visual reflection shown by this demo requires
> `@wcstack/fetch` / `@wcstack/websocket` **v1.17.0 or later**. If an older
> version resolves from the CDN (`esm.run`), the components themselves keep
> working normally, but none of the state-driven CSS will ever match
> (`:state()` selectors just silently never fire — nothing breaks).

## What this is

A demo combining `@wcstack/state` with `@wcstack/fetch` / `@wcstack/websocket`. Every wcstack
I/O node reflects its boolean output state (`loading`, `error`, `connected`, …) onto its own
element via [`CustomStateSet`](https://developer.mozilla.org/en-US/docs/Web/API/CustomStateSet),
so a loading spinner, an error banner, and a connection indicator can all be built from plain
CSS `:state()` selectors alone.

**This page's `<wcs-state>` script never reads `loading` / `error` / `connected`.** The spinner,
the error banners, and the connection dot are driven entirely by the `<style id="state-css">`
block (expand "Show the CSS" at the bottom of the page to see exactly which rules are in
effect).

## Getting started

Each package loads from the CDN ([esm.run](https://esm.run)), so no local build is required.

```bash
# 1. Install the shared WebSocket server's dependency (once — shared with examples/state-websocket)
cd examples/shared/websocket && npm install && cd ../../..

# 2. Start
node examples/state-custom-states/server.js
```

Visit http://localhost:3303.

The port can be overridden with the `PORT` environment variable (default `3303`).

## Features

- **Section 1: async data loading** (no permission prompt — the first-view demo).
  Three buttons — "Load (fast)", "Load (slow, ~2.5s)", "Load (fails)" — hit the mock API
  `/api/widgets?mode=fast|slow|fail`. `<wcs-fetch>`'s `:state(loading)` shows a spinner and
  dims the list; `:state(error)` shows an error banner. As a `:has()` example, a shared error
  banner positioned near the *top* of the page (before the headless nodes in DOM order) also
  reacts to the same `:state(error)` — the `~` sibling combinator can only select *later*
  siblings, so `:has()` on a common ancestor is the only way to reach something earlier in the
  document.
- **Section 2: connection indicator**. `<wcs-ws>`'s `:state(connected)` turns the dot green,
  `:state(loading)` (connecting/reconnecting) turns it amber, and `:state(error)` puts a red
  outline on the whole card. The Disconnect / Reconnect buttons go through the command-token
  protocol (`$command.disconnectWs` / `$command.reconnectWs` → `<wcs-ws>`'s `close()` /
  `connect()`).
- **Debug observability checkbox**. Toggles the `debug-states` attribute on both nodes
  (`#widgets-fetch` / `#ws-conn`). With it on and DevTools' Elements panel open, clicking the
  buttons shows `data-wcs-state-loading` / `data-wcs-state-error` /
  `data-wcs-state-connected` toggling live (a debug-only mirror, not meant for styling).
- **CSS is the star**. "Show the CSS" at the bottom of the page reveals exactly the `:state()`
  rules in effect — the small script at the end of the page just copies
  `<style id="state-css">`'s own text content into the `<pre>`, so the snippet can never drift
  from the CSS actually applied.

## Notes

- **Zero state-subscription lines**: the `<wcs-state>` `<script type="module">` only reads/writes
  `mode` / `attempt` / `widgets` (data), `url` (input), and the two command tokens. `loading` /
  `error` / `connected` are never bound — CSS reads the component's own `:state()` directly, so
  no JS subscription glue is needed.
- **`:state()` cannot be written from outside**: unlike attributes or classes, `:state()` can't
  be set by external code, so there's no risk of confusing this output state with an input
  (`docs/custom-state-reflection-design.md` decisions 1 & 2).
- **The sibling combinator is the default tool**: `#widgets-fetch:state(loading) ~ .spinner`
  only reaches elements *after* the stateful element in sibling order (including their
  descendants). `<wcs-fetch>` / `<wcs-ws>` are headless, so placing them before the visual
  markup they drive is the standard layout.
- **`:has()` is the only way to reach forward/ancestor**: to style something that appears
  *before* the stateful element in the DOM (like the page-top shared banner here), select a
  common ancestor (`<body>`) with `:has()` instead.
- **Graceful degradation is silent**: below the supported browser baseline (Chrome/Edge < 125,
  Safari < 17.4, Firefox < 126) or without `attachInternals` support, states are simply never
  set, so `:state()` selectors never match. The component's own functionality is unaffected
  (never-throw).
- **No SSR support**: `:state()` can't be serialized into HTML, so server-rendered markup from
  `@wcstack/server` never carries these states on first paint. Pair a rule with
  `wcs-fetch:not(:defined)` if you need to style that pre-hydration gap.
- **Reusing the `ws` dependency**: this demo's WebSocket server adds no new dependency — like
  `examples/state-websocket`, it reuses the shared helper under `examples/shared/websocket/`
  (where the `ws` package is already installed).

## Related docs

- [docs/custom-state-reflection-design.md](../../docs/custom-state-reflection-design.md) — the design doc for this feature
- The "CSS styling with `:state()`" section in `packages/fetch/README.md` / `packages/websocket/README.md`
