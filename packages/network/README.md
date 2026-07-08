# @wcstack/network

`@wcstack/network` is a headless Network Information component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns the browser's connection-quality signal into reactive state — the same way `@wcstack/permission` turns a permission grant into reactive state.

With `@wcstack/state`, `<wcs-network>` can be bound directly through path contracts:

- **input surface**: none — `navigator.connection` is a single global with nothing to configure
- **output state surface**: `effectiveType`, `downlink`, `rtt`, `saveData`, `supported`

This means adaptive-loading UI — lower image quality on a slow connection, pausing autoplay when Data Saver is on — can be expressed declaratively in HTML, without writing `navigator.connection` or `change`-listener glue in your UI layer.

`@wcstack/network` follows the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) (Core / Shell / Binding Contract) architecture:

- **Core** (`NetworkCore`) reads `navigator.connection` and tracks its live `change` event
- **Shell** (`<wcs-network>`) connects that state to DOM lifecycle
- **Binding Contract** (`static wcBindable`) declares observable `properties` (and, deliberately, **no commands and no inputs**)

## Why this exists — the smallest Shell in wcstack, and unsupported is the common case

Every other wcstack IO node configures *something* (a `target`, a `name`, a `url`). `navigator.connection` is a single global object with nothing to point at, so `<wcs-network>` takes **no attributes at all**.

More importantly: **Firefox and Safari do not implement `navigator.connection`.** Unlike most IO nodes, where "unsupported" is a rare fallback, here it is the default reality for a large share of users. Design your UI around graceful degradation — "if it fires, use it; if it never fires, fall back to sensible defaults" — not around the assumption that this data will be available.

> **No secure-context requirement.** Unlike `@wcstack/geolocation` or `@wcstack/permission`, the Network Information API has no secure-context restriction.

## Install

```bash
npm install @wcstack/network
```

## Quick Start

### 1. Adaptive image quality

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/network/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      effectiveType: null,
      get lowQuality() {
        return this.effectiveType === "2g" || this.effectiveType === "slow-2g";
      },
      get imgSrc() {
        return this.lowQuality ? "/thumb.jpg" : "/full.jpg";
      },
      // The initial snapshot fires before bindings attach — pull it once (see Notes).
      async $connectedCallback() {
        await customElements.whenDefined("wcs-network");
        this.effectiveType = document.querySelector("wcs-network").effectiveType;
      },
    };
  </script>
</wcs-state>

<wcs-network data-wcs="effectiveType: effectiveType"></wcs-network>

<img data-wcs="attr.src: imgSrc">
```

One timing rule applies to every example on this page: `<wcs-network>` publishes its snapshot through `wcs-network:change` events, and the *first* snapshot fires synchronously at connect — before `@wcstack/state` has attached its binding listeners — so bound paths only start updating from the *next* connection change. The `$connectedCallback` block pulls that initial snapshot once; without it, this page would not adapt when the connection is already slow at load time (see Notes & limitations).

### 2. Respect Data Saver

```html
<wcs-state>
  <script type="module">
    export default {
      saveData: null,
      // Initial pull, as in example 1 — Data Saver may already be on at load time.
      async $connectedCallback() {
        await customElements.whenDefined("wcs-network");
        this.saveData = document.querySelector("wcs-network").saveData;
      },
    };
  </script>
</wcs-state>

<wcs-network data-wcs="saveData: saveData"></wcs-network>
<video data-wcs="autoplay: saveData|falsy" muted loop></video>
```

`saveData` is `boolean | null` (`null` while unknown or unsupported), so the null-tolerant `|falsy` filter is used instead of the boolean-only `|not`: autoplay stays on unless Data Saver is *known* to be on — the graceful-degradation default. `autoplay` is bound as a property (not `attr.autoplay`) because a boolean content attribute cannot be switched off through an attribute binding.

### 3. Hide connection-quality UI when unsupported

```html
<wcs-state>
  <script type="module">
    export default {
      netSupported: false,
      effectiveType: null,
      async $connectedCallback() {
        await customElements.whenDefined("wcs-network");
        const net = document.querySelector("wcs-network");
        this.netSupported = net.supported;
        this.effectiveType = net.effectiveType;
      },
    };
  </script>
</wcs-state>

<wcs-network data-wcs="supported: netSupported; effectiveType: effectiveType"></wcs-network>
<div data-wcs="hidden: netSupported|not">Connection: <span data-wcs="textContent: effectiveType"></span></div>
```

Every bound state path must be declared up front — binding an undeclared path throws at initialization. Unlike `saveData` above, `supported` is a strict boolean (never `null`), so `|not` is safe here. The initial pull is *essential* in this example: `supported` is set exactly once at connect, and a stable connection never fires another `change` — without the pull the UI would stay hidden forever even in supporting browsers. In an unsupported browser the pull reads `false`, so the UI simply stays hidden.

## Observable Properties (outputs)

| Property        | Event               | Description |
| ---------------- | -------------------- | ------------ |
| `effectiveType`  | `wcs-network:change` | `"slow-2g"` / `"2g"` / `"3g"` / `"4g"`, or `null` when unsupported. |
| `downlink`       | `wcs-network:change` | Estimated downlink bandwidth in Mbps, or `null` when unsupported. |
| `rtt`            | `wcs-network:change` | Estimated round-trip time in ms, or `null` when unsupported. |
| `saveData`       | `wcs-network:change` | `true` when the user has enabled Data Saver mode, or `null` when unsupported. |
| `supported`      | `wcs-network:change` | `true` once a real `navigator.connection` was found; `false` otherwise. |

All five derive from the single `wcs-network:change` event (a full snapshot dispatched together, mirroring how the native API reports all fields on one `change` event). The four data fields also normalize to `null` individually — even when `supported` is `true` — if the browser reports a field as missing or with an unexpected type.

`downlinkMax` and connection `type` (wifi/cellular/…) are intentionally not surfaced — see `docs/network-tag-design.md` §2 for the rationale (low real-world utility, and `type` is unreliable across browsers for fingerprinting-mitigation reasons).

## Commands

**None.** `navigator.connection` is read-only — there is no action to invoke. `<wcs-network>` is a pure monitor.

## Attributes / Inputs

**None.** `navigator.connection` is a single global; there is nothing per-instance to configure.

## Notes & limitations

- **Firefox and Safari do not implement `navigator.connection`.** `supported` stays `false` and the other four properties stay `null` in those browsers — design around this as the common case, not an edge case.
- **The initial snapshot does not reach bindings.** The first `wcs-network:change` fires synchronously during `connectedCallback` — before `@wcstack/state` attaches its binding listeners (binding setup is deferred to a later microtask; see `docs/timing-and-firing-contract.md` §4.1) — and events are not replayed to late subscribers, so bound paths update only from the *next* connection change. If the initial value matters (it almost always does for `supported` and `saveData`), pull it once in `$connectedCallback` as the Quick Start examples do. This is a property of the wc-bindable event contract shared by all monitor nodes, not a quirk of this package.
- **No `_gen` generation guard.** Unlike most wcstack IO nodes, subscribing to `navigator.connection`'s `change` event is fully synchronous — there is no asynchronous probe whose stale resolution could race a `dispose()`. See `docs/network-tag-design.md` §5.
- **Reconnect re-subscribes.** Removing and re-inserting the element tears down the `change` listener on disconnect and re-establishes it (against whatever `navigator.connection` currently is) on reconnect.
- **SSR (`@wcstack/server`).** Declares `static hasConnectedCallbackPromise = true` and exposes `connectedCallbackPromise`, though since `observe()` is synchronous this promise always settles immediately.
- **Same-value guard.** A defensive field-by-field comparison suppresses a redundant `change` dispatch if the browser were ever to fire `change` with identical values.

## CSS styling with `:state()`

`<wcs-network>` reflects two boolean output states onto its
[`ElementInternals` `CustomStateSet`](https://developer.mozilla.org/en-US/docs/Web/API/CustomStateSet),
so you can style it directly from CSS with the `:state()` pseudo-class — no
`data-wcs` binding or extra class toggling required.

| State | On when |
|-------|---------|
| `save-data` | `wcs-network:change` fires with `saveData === true` (off — including when `saveData` is `null`, i.e. unsupported) |
| `supported` | `wcs-network:change` fires with `supported === true` (off when `supported === false`) |

`effectiveType` / `downlink` / `rtt` are not reflected — see `docs/custom-state-reflection-design.md` §3.2 (continuous/high-frequency values are excluded from `:state()` reflection).

```css
wcs-network:state(supported) ~ .connection-badge { display: block; }
wcs-network:not(:state(supported)) ~ .connection-badge { display: none; } /* default */

form:has(wcs-network:state(save-data)) .low-res-hint { display: block; }
```

Unlike attributes or classes, `:state()` cannot be written from outside the
element, so there is no risk of confusing this output state with an input.

**Browser support** (`:state(x)` syntax): Chrome/Edge 125+, Safari 17.4+,
Firefox 126+. In older browsers the states are simply never set — `:state()`
selectors never match, but `<wcs-network>` itself keeps working normally
(graceful degradation, never-throw).

**SSR**: `:state()` cannot be serialized into HTML, so server-rendered markup
never carries these states on first paint (`@wcstack/server` is unaffected).
If you need to style the pre-hydration gap, pair your rule with
`wcs-network:not(:defined)` instead.

### Debugging

Custom states are invisible in DevTools' Elements panel and `attachInternals()`
cannot be called twice, so there is no console way to inspect them directly.
Two debug-only aids are provided for that:

- `el.debugStates` — a **snapshot** array of the currently-on state names
  (e.g. `["supported"]`). It is not part of `wc-bindable` (not a bind target)
  and its shape is not a guaranteed contract — use it for debugging only.
- The `debug-states` attribute (opt-in, default off) mirrors state changes
  onto `data-wcs-state-save-data` / `data-wcs-state-supported` attributes on
  the element, so the Elements panel highlights them as they toggle:

  ```html
  <wcs-network debug-states></wcs-network>
  ```

**Write your CSS against `:state()`, not `data-wcs-state-*`.** The mirrored
attributes exist purely to make state changes visible while debugging with
DevTools open; they are not a supported styling hook.

## Headless usage (`NetworkCore`)

The Core has no DOM dependency and can be used directly with `bind()` from `@wc-bindable/core`:

```typescript
import { NetworkCore } from "@wcstack/network";

const net = new NetworkCore();
net.addEventListener("wcs-network:change", (e) => {
  console.log((e as CustomEvent).detail); // { effectiveType, downlink, rtt, saveData, supported }
});

net.observe();          // synchronous — no promise to await for data
console.log(net.effectiveType);

// later, when done:
net.dispose();           // detach the live `change` listener
```

## License

MIT
