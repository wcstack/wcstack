# @wcstack/defined

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/defined` is a headless custom-element readiness component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns "are these custom elements registered yet?" into reactive state — the way `@wcstack/permission` turns a browser grant into reactive state.

With `@wcstack/state`, `<wcs-defined>` can be bound directly through path contracts:

- **input surface**: `tags`, `mode`, `timeout`
- **output state surface**: `defined`, `pending`, `missing`, `count`, `total`, `error`

This means readiness-aware UI — loading gates, skeletons, lazy-load failure fallbacks — can be expressed declaratively in HTML, without writing `customElements.whenDefined()` chains and timeout glue in your UI layer.

`@wcstack/defined` follows the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) (Core / Shell / Binding Contract) architecture:

- **Core** (`DefinedCore`) waits on `whenDefined()` for each tag, aggregates per `mode`, and drives the timeout
- **Shell** (`<wcs-defined>`) connects that state to DOM attributes and lifecycle
- **Binding Contract** (`static wcBindable`) declares observable `properties` (and, deliberately, **no commands**)

## Why this exists — and why not just CSS `:defined`

CSS already solves flash-of-unstyled-content for undefined elements, declaratively and with zero JS:

```css
my-widget:not(:defined) { visibility: hidden; }
```

So if all you need is to hide an un-upgraded element, **use CSS** — you do not need this package. `<wcs-defined>` earns its place by doing what `:defined` cannot:

- **Timeout-based failure detection.** A custom element loaded via a dynamic import (e.g. `@wcstack/autoloader`) whose module fails to load leaves `whenDefined()` pending *forever*. CSS can only keep hiding it. With a `timeout`, the tag drops into `missing`, so a load failure becomes observable state (`missing.length > 0`) you can show a real error for.
- **Multi-tag aggregation.** Wait for *all* tags (`mode="all"`) or *any* tag (`mode="any"`) with one element.
- **Readiness as reactive state.** Drive conditional rendering, gates, and progress (`count` / `total`) — not just styling.

`<wcs-defined>` is a one-way **element → state** monitor: it *observes* registration, it never *defines* anything. Like `<wcs-permission>`, it has **no commands at all** — command-token does not apply, only event-token. The signal is **monotonic** (a tag, once defined, stays defined), so the state is terminal: it settles once every tag resolves, or once the `timeout` elapses.

> **Companion to the autoloader.** In a real app the watched tags come from an Import Map + `@wcstack/autoloader` (`@components/` prefix). `<wcs-defined>` is how you know when those lazily-imported components are ready — and, via the timeout, when one failed to arrive.

## Install

```bash
npm install @wcstack/defined
```

## Quick Start

### 1. Gate the UI on readiness

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/defined/auto"></script>

<wcs-state>
  <script type="module">
    export default { ready: false };
  </script>
</wcs-state>

<wcs-defined tags="my-chart,my-grid" data-wcs="defined: ready"></wcs-defined>

<div data-wcs="hidden: ready">Loading components…</div>
<div data-wcs="hidden: ready|not"><my-chart></my-chart><my-grid></my-grid></div>
```

### 2. Detect a load failure with `timeout`

```html
<wcs-state>
  <script type="module">
    export default {
      ready: false,
      missing: [],
      get hasFailed() { return this.missing.length > 0; },
    };
  </script>
</wcs-state>

<!-- If a tag has not registered within 5s, it moves to `missing`. -->
<wcs-defined tags="my-chart" timeout="5000"
  data-wcs="defined: ready; missing: missing"></wcs-defined>

<div data-wcs="hidden: hasFailed">…spinner / content…</div>
<div data-wcs="hidden: hasFailed|not">A component failed to load. Please reload.</div>
```

### 3. `mode` and progress

```html
<wcs-state>
  <script type="module">
    export default {
      anyReady: false, loaded: 0, total: 0,
      get progress() { return `${this.loaded} / ${this.total}`; },
    };
  </script>
</wcs-state>

<!-- mode="any": defined flips true as soon as the first tag registers. -->
<wcs-defined tags="a-card,b-card,c-card" mode="any"
  data-wcs="defined: anyReady; count: loaded; total: total"></wcs-defined>

<span data-wcs="textContent: progress"></span>
```

See `examples/defined-loader` for the full demo (readiness gate + timeout failure + late promotion).

## Attributes / Inputs

| Attribute | Type   | Default        | Description                                                                                          |
| --------- | ------ | -------------- | ---------------------------------------------------------------------------------------------------- |
| `tags`    | string | `""`           | Comma-separated custom element tag names to watch. Required — empty sets `error = "no tags specified"`. |
| `mode`    | string | `"all"`        | `"all"` → `defined` is true once every tag is registered. `"any"` → true once the first one is.       |
| `timeout` | number | `0` (no limit) | Milliseconds. After it elapses, still-pending tags move to `missing` (a load failure). `0`/unset waits forever. |

Attributes are read at connect time, not observed (see Notes).

## Observable Properties (outputs)

| Property  | Event              | Description                                                                          |
| --------- | ------------------ | ------------------------------------------------------------------------------------ |
| `defined` | `wcs-defined:change` | Aggregate readiness per `mode` (`count === total` for `all`, `count >= 1` for `any`). |
| `pending` | `wcs-defined:change` | Tags still waiting to register (pre-timeout).                                         |
| `missing` | `wcs-defined:change` | Tags that timed out or are undefinable (invalid name) — i.e. load failures.           |
| `count`   | `wcs-defined:change` | Number of tags registered so far.                                                    |
| `total`   | `wcs-defined:change` | Number of tags being watched.                                                        |
| `error`   | `wcs-defined:change` | Human-readable message for misconfiguration / invalid names, else `null`.            |

All six derive from the single `wcs-defined:change` event, whose `detail` is the full snapshot. At every dispatch the invariant **`total === count + pending.length + missing.length`** holds; `pending` and `missing` partition the not-yet-defined tags, split by the timeout.

## Commands

**None.** There is no imperative action to "define" a tag — only observation. `<wcs-defined>` is a pure monitor (event-token only).

## CSS styling with `:state()`

`<wcs-defined>` reflects two boolean output states onto its
[`ElementInternals` `CustomStateSet`](https://developer.mozilla.org/en-US/docs/Web/API/CustomStateSet),
so you can style it directly from CSS with the `:state()` pseudo-class — no
`data-wcs` binding or extra class toggling required.

| State | On when |
|-------|---------|
| `defined` | `wcs-defined:change` fires with `detail.defined === true` (cleared when `false`) |
| `error` | `wcs-defined:change` fires with a non-`null` `detail.error` (cleared on `null`) |

`pending` / `missing` / `count` / `total` are **not** reflected — they are not
booleans, and count-like values are excluded from `:state()` reflection by
design (see `docs/custom-state-reflection-design.md` §3.2).

```css
wcs-defined:state(defined) ~ .content  { display: block; }
wcs-defined:state(defined) ~ .skeleton { display: none; } /* default */

form:has(wcs-defined:state(error)) .banner { display: block; }
```

Unlike attributes or classes, `:state()` cannot be written from outside the
element, so there is no risk of confusing this output state with an input.

**Browser support** (`:state(x)` syntax): Chrome/Edge 125+, Safari 17.4+,
Firefox 126+. In older browsers the states are simply never set — `:state()`
selectors never match, but `<wcs-defined>` itself keeps working normally
(graceful degradation, never-throw).

**SSR**: `:state()` cannot be serialized into HTML, so server-rendered markup
never carries these states on first paint (`@wcstack/server` is unaffected).
If you need to style the pre-hydration gap, pair your rule with
`wcs-defined:not(:defined)` instead.

### Debugging

Custom states are invisible in DevTools' Elements panel and `attachInternals()`
cannot be called twice, so there is no console way to inspect them directly.
Two debug-only aids are provided for that:

- `el.debugStates` — a **snapshot** array of the currently-on state names
  (e.g. `["defined"]`). It is not part of `wc-bindable` (not a bind target)
  and its shape is not a guaranteed contract — use it for debugging only.
- The `debug-states` attribute (opt-in, default off) mirrors state changes
  onto `data-wcs-state-defined` / `data-wcs-state-error` attributes on the
  element, so the Elements panel highlights them as they toggle:

  ```html
  <wcs-defined tags="my-chart,my-grid" debug-states></wcs-defined>
  ```

**Write your CSS against `:state()`, not `data-wcs-state-*`.** The mirrored
attributes exist purely to make state changes visible while debugging with
DevTools open; they are not a supported styling hook.

## Notes & limitations

- **Monotonic and terminal.** `whenDefined()` never reverts: once a tag is defined it stays defined. The state settles once every tag resolves or the `timeout` fires. After a timeout, a tag that registers *late* is promoted out of `missing` back into the `count` (so `defined` can still flip true afterwards).
- **Invalid names fail softly.** A tag name that is not a valid custom element name (no hyphen, etc.) yields a rejected `whenDefined()`; it is recorded in `error` and placed in `missing`, never thrown. Other valid tags keep being watched (never-throw).
- **Attributes are read at connect time, not observed.** `<wcs-defined>` does not implement `observedAttributes` / `attributeChangedCallback`. `tags` / `mode` / `timeout` are fixed when the element connects; to watch a different set, use a separate element (or re-connect).
- **Reconnect re-watches.** Removing and re-inserting the element runs `connectedCallback` again. A watch in flight when the element disconnects is invalidated, so a rapid disconnect→reconnect cannot leak a stale callback.
- **SSR (`@wcstack/server`).** Declares `static hasConnectedCallbackPromise = true` and exposes `connectedCallbackPromise`, so the server renderer waits for readiness before snapshotting. **Specify a `timeout` for SSR** — without one, an unresolved tag leaves the promise pending forever. The pending-forever risk is sharpest under SSR with `timeout="0"` (or unset) on an autoloaded tag: the render hangs awaiting a registration that may never happen. Always pair SSR + autoloaded tags with a finite `timeout`.
- **Array getters return fresh copies.** `pending` and `missing` (and the event `detail` arrays) are new arrays on every read/dispatch, so external mutation cannot corrupt internal state. The flip side: do not rely on referential equality between reads — compare contents, not identity.

## Headless usage (`DefinedCore`)

The Core has no DOM dependency and can be used directly with `bind()` from `@wc-bindable/core`:

```typescript
import { DefinedCore } from "@wcstack/defined";

const gate = new DefinedCore(["my-chart", "my-grid"], "all", 3000);
gate.addEventListener("wcs-defined:change", (e) => {
  const snap = (e as CustomEvent).detail;
  console.log(snap.defined, snap.count, snap.total, snap.missing);
});

await gate.ready;        // every tag resolved, or the timeout fired
console.log(gate.defined, gate.missing);

// later, when done:
gate.dispose();          // clear the timeout and stop watching
```

## License

MIT
