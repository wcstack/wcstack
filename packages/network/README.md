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
    };
  </script>
</wcs-state>

<wcs-network data-wcs="effectiveType: effectiveType"></wcs-network>

<img data-wcs="src.attr: lowQuality|iif('/thumb.jpg','/full.jpg')">
```

### 2. Respect Data Saver

```html
<wcs-network data-wcs="saveData: saveData"></wcs-network>
<video data-wcs="autoplay.attr: !saveData" muted loop></video>
```

### 3. Hide connection-quality UI when unsupported

```html
<wcs-network data-wcs="supported: netSupported; effectiveType: effectiveType"></wcs-network>
<div data-wcs="hidden: !netSupported">Connection: <span data-wcs="textContent: effectiveType"></span></div>
```

## Observable Properties (outputs)

| Property        | Event               | Description |
| ---------------- | -------------------- | ------------ |
| `effectiveType`  | `wcs-network:change` | `"slow-2g"` / `"2g"` / `"3g"` / `"4g"`, or `null` when unsupported. |
| `downlink`       | `wcs-network:change` | Estimated downlink bandwidth in Mbps, or `null` when unsupported. |
| `rtt`            | `wcs-network:change` | Estimated round-trip time in ms, or `null` when unsupported. |
| `saveData`       | `wcs-network:change` | `true` when the user has enabled Data Saver mode, or `null` when unsupported. |
| `supported`      | `wcs-network:change` | `true` once a real `navigator.connection` was found; `false` otherwise. |

All five derive from the single `wcs-network:change` event (a full snapshot dispatched together, mirroring how the native API reports all fields on one `change` event).

`downlinkMax` and connection `type` (wifi/cellular/…) are intentionally not surfaced — see `docs/network-tag-design.md` §2 for the rationale (low real-world utility, and `type` is unreliable across browsers for fingerprinting-mitigation reasons).

## Commands

**None.** `navigator.connection` is read-only — there is no action to invoke. `<wcs-network>` is a pure monitor.

## Attributes / Inputs

**None.** `navigator.connection` is a single global; there is nothing per-instance to configure.

## Notes & limitations

- **Firefox and Safari do not implement `navigator.connection`.** `supported` stays `false` and the other four properties stay `null` in those browsers — design around this as the common case, not an edge case.
- **No `_gen` generation guard.** Unlike most wcstack IO nodes, subscribing to `navigator.connection`'s `change` event is fully synchronous — there is no asynchronous probe whose stale resolution could race a `dispose()`. See `docs/network-tag-design.md` §5.
- **Reconnect re-subscribes.** Removing and re-inserting the element tears down the `change` listener on disconnect and re-establishes it (against whatever `navigator.connection` currently is) on reconnect.
- **SSR (`@wcstack/server`).** Declares `static hasConnectedCallbackPromise = true` and exposes `connectedCallbackPromise`, though since `observe()` is synchronous this promise always settles immediately.
- **Same-value guard.** A defensive field-by-field comparison suppresses a redundant `change` dispatch if the browser were ever to fire `change` with identical values.

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
