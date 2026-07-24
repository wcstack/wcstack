# @wcstack/debounce

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/debounce` is a headless debounce / throttle component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that coalesces a noisy stream of signals into a single quiet-period emission — the same way `@wcstack/timer` turns the passage of time into reactive state.

It ships two custom elements over one engine:

- `<wcs-debounce>` — emit once after the signal has been idle for `wait` ms.
- `<wcs-throttle>` — emit at most once per `wait` ms (debounce with `maxWait === wait`, leading on).

`@wcstack/debounce` follows the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) (Core / Shell / Binding Contract) architecture:

- **Core** (`DebounceCore`) ports lodash's debounce algorithm (`leading` / `trailing` / `maxWait`) and publishes results as events.
- **Shell** (`<wcs-debounce>` / `<wcs-throttle>`) connects that engine to DOM attributes, lifecycle, and declarative commands.
- **Binding Contract** (`static wcBindable`) declares observable `properties`, writable `inputs`, and callable `commands`.

## Two surfaces

The essence is "debouncing a signal". A signal can carry a **value** or be a bare **pulse with arguments**, so there are two surfaces — use one per element.

### Value surface — `source` → `value`

Write to `source`; after the quiet period the debounced value is published on the `value` property (event `wcs-debounce:settled`). Wire it as `source: src; value: debounced` — `value` flows back into state.

### Signal surface — `trigger(...args)` → `fired`

Call the `trigger` command repeatedly; after the quiet period one `wcs-debounce:fired` event carries the last args. Because state cannot read a transient pulse as a value, the relay uses tokens:

```
source →(command-token)→ debounce.trigger →[coalesce]→ fired →(event-token)→ state → target.method
```

State fires the entry with the [command-token protocol](../state/) (`command.trigger: $command.X`) and receives the single coalesced pulse with the [event-token protocol](../state/) (`eventToken.fired: Y`), then re-dispatches it to the real method.

> A single element instance is meant for **one** surface. If both `source` and `trigger` are driven on the same element, the last scheduled signal wins (lodash's last-args semantics).

## Install

```bash
npm install @wcstack/debounce
```

## Quick Start

### 1. Debounce an input value

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/debounce/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      query: "",
      debouncedQuery: ""
    };
  </script>
</wcs-state>

<input data-wcs="value: query">
<wcs-debounce wait="300" data-wcs="source: query; value: debouncedQuery"></wcs-debounce>
<p>Searching for: {{ debouncedQuery }}</p>
```

### 2. Debounce a method call (signal surface)

```html
<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["search"],
      $eventTokens: ["searchSettled"],
      query: "",
      $on: {
        searchSettled: (state, event) => {
          // fires once, 300ms after the last keystroke
          const [q] = event.detail.args;
          state.results = doSearch(q);
        }
      }
    };
  </script>
</wcs-state>

<input data-wcs="oninput: $command.search">
<wcs-debounce
  wait="300"
  data-wcs="command.trigger: $command.search; eventToken.fired: searchSettled">
</wcs-debounce>
```

### 3. Throttle a fast value stream

```html
<wcs-throttle wait="100" data-wcs="source: scrollY; value: throttledScrollY"></wcs-throttle>
```

`<wcs-throttle>` leads by default (emits immediately, then at most once per `wait` ms).

## Attributes / Inputs

| Attribute     | Type    | Default (`<wcs-debounce>`) | Default (`<wcs-throttle>`) | Description |
| ------------- | ------- | -------------------------- | -------------------------- | ----------- |
| `wait`        | number  | `250`                      | `250`                      | Quiet period in ms. Invalid / negative / non-numeric values fall back to the default. |
| `leading`     | boolean | off                        | **on** (`no-leading` opts out) | Emit on the first signal of a burst. |
| `no-trailing` | boolean | off (trailing on)          | off (trailing on)          | Opt out of the trailing-edge emission. |
| `max-wait`    | number  | none                       | `wait`                     | Force an emission at least every `max-wait` ms under continuous input. Clamped to `>= wait`. |
| `source`      | any     | —                          | —                          | Value-surface input; its debounced echo returns on `value`. |

## Observable Properties (outputs)

| Property  | Event                          | Description                                          |
| --------- | ------------------------------ | ---------------------------------------------------- |
| `value`   | `wcs-debounce:settled`         | The debounced value of the latest `source` write.    |
| `fired`   | `wcs-debounce:fired`           | The coalesced args of the latest `trigger()` pulse.  |
| `pending` | `wcs-debounce:pending-changed` | `true` while a debounce is in flight.                |

`<wcs-throttle>` publishes the same shape under the `wcs-throttle:*` namespace.

## Commands

| Command   | Description                                                       |
| --------- | ---------------------------------------------------------------- |
| `trigger` | Signal-surface entry: coalesce a pulse carrying `...args`.       |
| `cancel`  | Drop any pending emission without firing (getters keep values).  |
| `flush`   | Emit any buffered payload immediately (no-op if nothing pending). |

## CSS styling with `:state()`

`<wcs-debounce>` / `<wcs-throttle>` reflect one boolean output state onto their
[`ElementInternals` `CustomStateSet`](https://developer.mozilla.org/en-US/docs/Web/API/CustomStateSet),
so you can style them directly from CSS with the `:state()` pseudo-class — no
`data-wcs` binding or extra class toggling required.

| State | On when |
|-------|---------|
| `pending` | `wcs-debounce:pending-changed` fires with `true` (cleared on `false`) |

`<wcs-throttle>` reflects the same `pending` state from its own
`wcs-throttle:pending-changed` event (it shares the `Debounce` base class, but
the event namespace — and therefore the wiring — tracks its own `eventPrefix`).

```css
wcs-debounce:state(pending) ~ .spinner { display: block; }
wcs-debounce:state(pending) ~ .spinner { display: none; } /* default */

wcs-throttle:state(pending) ~ .indicator { opacity: 1; }
```

Unlike attributes or classes, `:state()` cannot be written from outside the
element, so there is no risk of confusing this output state with an input.

**Browser support** (`:state(x)` syntax): Chrome/Edge 125+, Safari 17.4+,
Firefox 126+. In older browsers the states are simply never set — `:state()`
selectors never match, but `<wcs-debounce>` / `<wcs-throttle>` themselves keep
working normally (graceful degradation, never-throw).

**SSR**: `:state()` cannot be serialized into HTML, so server-rendered markup
never carries these states on first paint. If you need to style the
pre-hydration gap, pair your rule with `wcs-debounce:not(:defined)` instead.

### Debugging

Custom states are invisible in DevTools' Elements panel and `attachInternals()`
cannot be called twice, so there is no console way to inspect them directly.
Two debug-only aids are provided for that:

- `el.debugStates` — a **snapshot** array of the currently-on state names
  (e.g. `["pending"]`). It is not part of `wc-bindable` (not a bind target)
  and its shape is not a guaranteed contract — use it for debugging only.
- The `debug-states` attribute (opt-in, default off) mirrors state changes
  onto a `data-wcs-state-pending` attribute on the element, so the Elements
  panel highlights it as it toggles:

  ```html
  <wcs-debounce wait="300" debug-states></wcs-debounce>
  ```

**Write your CSS against `:state()`, not `data-wcs-state-*`.** The mirrored
attribute exists purely to make state changes visible while debugging with
DevTools open; it is not a supported styling hook.

## Optional DOM Triggering

When `config.autoTrigger` is on (default), a click on an element carrying `data-debouncetarget="<id>"` fires a single coalesced `trigger()` pulse on the referenced `<wcs-debounce>` / `<wcs-throttle>` (the click's default action is suppressed).

## Headless usage (`DebounceCore`)

The Core has no DOM dependency and can be used directly with `bind()` from `@wc-bindable/core`:

```typescript
import { DebounceCore } from "@wcstack/debounce";

const core = new DebounceCore("wcs-debounce", undefined, { wait: 300 });
core.addEventListener("wcs-debounce:settled", (e) => {
  console.log((e as CustomEvent).detail.value);
});
core.setSource("a");
core.setSource("b"); // only "b" settles, 300ms later
```

Throttle is the same engine with a different prefix and `maxWait === wait`:

```typescript
const throttle = new DebounceCore("wcs-throttle", undefined, { wait: 100, leading: true, maxWait: 100 });
```

## License

MIT
