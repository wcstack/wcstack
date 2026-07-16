# @wcstack/geolocation

`@wcstack/geolocation` is a headless geolocation component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns the device's location into reactive state — the same way `@wcstack/fetch` turns a network request into reactive state and `@wcstack/timer` turns the passage of time into reactive state.

With `@wcstack/state`, `<wcs-geo>` can be bound directly through path contracts:

- **input / command surface**: `high-accuracy`, `timeout`, `maximum-age`, `watch`, `manual`, `trigger`
- **output state surface**: `position`, `latitude`, `longitude`, `accuracy`, `coords`, `timestamp`, `watching`, `loading`, `error`, `permission`

This means location-aware work can be expressed declaratively in HTML, without writing `navigator.geolocation.getCurrentPosition()`, `watchPosition()`, `clearWatch()`, or teardown glue in your UI layer.

`@wcstack/geolocation` follows the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) (Core / Shell / Binding Contract) architecture:

- **Core** (`GeolocationCore`) handles acquisition, the one-shot / watch phases, position normalization, error handling, and live permission tracking
- **Shell** (`<wcs-geo>`) connects that state to DOM attributes, lifecycle, and declarative commands
- **Binding Contract** (`static wcBindable`) declares observable `properties`, writable `inputs`, and callable `commands`

## Why this exists

Geolocation is, like `fetch`, an asynchronous source of values — but it also has a permission gate and a continuous-watch mode. Imperatively it requires callback wiring, permission queries, and cleanup on disconnect.

`@wcstack/geolocation` moves that logic into a reusable component and exposes the result as bindable state. A location fix becomes a **state transition**, not imperative callback wiring. It is a read-only sensor: the element only produces values for the state (`element → state`), with no "send" path back.

> **Secure context required.** The Geolocation API only works in a secure context (HTTPS, or `localhost`). Over plain HTTP on a non-localhost origin acquisition fails and `<wcs-geo>` surfaces an `error`. The exact code is browser-dependent: only when `navigator.geolocation` itself is absent does `<wcs-geo>` report `POSITION_UNAVAILABLE` (code `2`); most browsers keep `navigator.geolocation` present and reject the request, so the error usually arrives as `PERMISSION_DENIED` (code `1`). Bind `error` and handle the failure rather than switching on a single code.

## Install

```bash
npm install @wcstack/geolocation
```

## Quick Start

### 1. One-shot fix on connect (default)

When `<wcs-geo>` is connected to the DOM, it requests a single position fix and publishes the result.

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/geolocation/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      lat: null,
      lng: null,
      get label() {
        return this.lat == null ? "Locating…" : `${this.lat}, ${this.lng}`;
      }
    };
  </script>
</wcs-state>

<wcs-geo data-wcs="latitude: lat; longitude: lng"></wcs-geo>

<p data-wcs="textContent: label"></p>
```

### 2. Continuous watch

Add the `watch` attribute to stream fixes via `watchPosition` until the element is disconnected.

```html
<wcs-geo watch data-wcs="latitude: lat; longitude: lng; watching: isTracking"></wcs-geo>
```

### 3. High accuracy / options

```html
<wcs-geo high-accuracy timeout="10000" maximum-age="0"
  data-wcs="coords: position; error: geoError"></wcs-geo>
```

### 4. Manual acquisition on demand

`manual` skips the auto fix on connect. Trigger acquisition imperatively, via a DOM click, or from state.

```html
<wcs-geo id="loc" manual data-wcs="latitude: lat; longitude: lng"></wcs-geo>

<!-- Optional DOM triggering: click requests a one-shot fix -->
<button data-geotarget="loc">Locate me</button>
```

> A `data-geotarget` click always requests a **single** fix via `getCurrentPosition()`, regardless of mode. Pointing it at a `watch` element runs a one-shot fix (briefly toggling `loading`) alongside the ongoing watch, rather than restarting the watch. The intended target is a `manual` element.

## Attributes / Inputs

| Attribute       | Type    | Default    | Description                                                              |
| --------------- | ------- | ---------- | ----------------------------------------------------------------------- |
| `high-accuracy` | boolean | `false`    | Request the best possible results (`enableHighAccuracy`).               |
| `timeout`       | number  | `Infinity` | Max ms to wait for a fix. Invalid values fall back to `Infinity`.       |
| `maximum-age`   | number  | `0`        | Max age (ms) of an acceptable cached fix. Invalid values fall back to `0`. |
| `watch`         | boolean | `false`    | Continuously watch the position on connect instead of a single fix.     |
| `manual`        | boolean | `false`    | Do not auto-acquire on connect; acquire via command / trigger.          |

## Observable Properties (outputs)

| Property     | Event                          | Description                                                            |
| ------------ | ------------------------------ | --------------------------------------------------------------------- |
| `position`   | `wcs-geo:position`             | Normalized snapshot `{ latitude, longitude, accuracy, altitude, altitudeAccuracy, heading, speed, timestamp, coords }`. |
| `latitude`   | `wcs-geo:position`             | Latitude of the latest fix.                                           |
| `longitude`  | `wcs-geo:position`             | Longitude of the latest fix.                                          |
| `accuracy`   | `wcs-geo:position`             | Accuracy in meters of the latest fix.                                 |
| `coords`     | `wcs-geo:position`             | The coordinates sub-object of the latest fix.                         |
| `timestamp`  | `wcs-geo:position`             | Acquisition timestamp of the latest fix.                              |
| `watching`   | `wcs-geo:watching-changed`     | `true` while continuously watching, `false` otherwise.                |
| `loading`    | `wcs-geo:loading-changed`      | `true` during a one-shot `getCurrentPosition` request.                |
| `error`      | `wcs-geo:error`                | Normalized `{ code, message }` (`PERMISSION_DENIED=1`, `POSITION_UNAVAILABLE=2`, `TIMEOUT=3`). |
| `permission` | `wcs-geo:permission-changed`   | `"prompt"` / `"granted"` / `"denied"` / `"unsupported"`, tracked live via the Permissions API. |
| `errorInfo`  | `wcs-geo:error-info-changed`   | Serializable failure taxonomy (`WcsIoErrorInfo`), or `null`. Additive — derived from `error` (`code` → `permission-denied` / `position-unavailable` / `timeout`; `recoverable` is `false` only for `permission-denied`). The `error` shape is unchanged. |

## Commands

| Command             | Description                                                         |
| ------------------- | ----------------------------------------------------------------- |
| `getCurrentPosition`| Acquire a single fix (async; never rejects — failures go to `error`). |
| `watchPosition`     | Begin continuously watching (no-op if already watching).          |
| `clearWatch`        | Stop watching; `watching` becomes `false`.                        |

State-driven invocation uses the command-token protocol:

```html
<wcs-geo manual data-wcs="command.getCurrentPosition: $command.locate"></wcs-geo>
```

## CSS styling with `:state()`

`<wcs-geo>` reflects three boolean output states onto its
[`ElementInternals` `CustomStateSet`](https://developer.mozilla.org/en-US/docs/Web/API/CustomStateSet),
so you can style it directly from CSS with the `:state()` pseudo-class — no
`data-wcs` binding or extra class toggling required.

| State | On when |
|-------|---------|
| `watching` | `wcs-geo:watching-changed` fires with `true` (cleared on `false`) |
| `loading` | `wcs-geo:loading-changed` fires with `true` (cleared on `false`) |
| `error` | `wcs-geo:error` fires with a non-`null` detail (cleared on `null`) |

`permission` is not reflected: it has no derived boolean getter (e.g. `granted` /
`denied`) to hang a state on, which is out of scope for v1 — bind `permission`
directly instead.

```css
wcs-geo:state(loading) ~ .spinner { display: block; }
wcs-geo:state(watching) ~ .stop-button { display: inline-block; }

form:has(wcs-geo:state(error)) .banner { display: block; }
```

Unlike attributes or classes, `:state()` cannot be written from outside the
element, so there is no risk of confusing this output state with an input.

**Browser support** (`:state(x)` syntax): Chrome/Edge 125+, Safari 17.4+,
Firefox 126+. In older browsers the states are simply never set — `:state()`
selectors never match, but `<wcs-geo>` itself keeps working normally
(graceful degradation, never-throw).

**SSR**: `:state()` cannot be serialized into HTML, so server-rendered markup
never carries these states on first paint (`@wcstack/server` is unaffected).
If you need to style the pre-hydration gap, pair your rule with
`wcs-geo:not(:defined)` instead.

### Debugging

Custom states are invisible in DevTools' Elements panel and `attachInternals()`
cannot be called twice, so there is no console way to inspect them directly.
Two debug-only aids are provided for that:

- `el.debugStates` — a **snapshot** array of the currently-on state names
  (e.g. `["loading"]`). It is not part of `wc-bindable` (not a bind target)
  and its shape is not a guaranteed contract — use it for debugging only.
- The `debug-states` attribute (opt-in, default off) mirrors state changes
  onto `data-wcs-state-watching` / `data-wcs-state-loading` /
  `data-wcs-state-error` attributes on the element, so the Elements panel
  highlights them as they toggle:

  ```html
  <wcs-geo watch debug-states></wcs-geo>
  ```

**Write your CSS against `:state()`, not `data-wcs-state-*`.** The mirrored
attributes exist purely to make state changes visible while debugging with
DevTools open; they are not a supported styling hook.

## Notes & limitations

- **Attributes are read at connect time, not observed.** `<wcs-geo>` does not implement `observedAttributes` / `attributeChangedCallback`. Option attributes (`high-accuracy`, `timeout`, `maximum-age`, `watch`, `manual`) are read when the element connects and each time a command runs — changing them imperatively *after* connect does not by itself re-acquire or re-watch. To apply new options, call `getCurrentPosition()` / `clearWatch()` + `watchPosition()` again, or re-connect the element.
- **Reconnect re-acquires.** Removing and re-inserting the element runs `connectedCallback` again, so a default-mode element fetches a fresh fix and a `watch` element restarts watching (matching how it tears watching down on disconnect).
- **SSR (`@wcstack/server`).** The default one-shot mode declares `static hasConnectedCallbackPromise = true` and exposes `connectedCallbackPromise`, so the server renderer waits for the connect-time fix before snapshotting. (`watch` / `manual` modes have no connect-time fix to await.)
- **`timeout` / `maximum-age` parsing.** Values are parsed strictly: a non-numeric (`"10px"`), non-finite, or negative value falls back to the default (`Infinity` / `0`). Only a clean non-negative number is accepted.
- **Silent failure handling (zero-log).** Consistent with the rest of wcstack's zero-dependency, minimal philosophy, `<wcs-geo>` never logs or throws for runtime failures. A failed permission query (e.g. a browser that rejects the `geolocation` permission name, or has no Permissions API) silently falls back to `permission = "unsupported"`. Acquisition failures (`PERMISSION_DENIED` / `POSITION_UNAVAILABLE` / `TIMEOUT`, including a missing Geolocation API) are surfaced only through the `error` property / `wcs-geo:error` event — `getCurrentPosition()` resolves and never rejects. Bind `error` (and `permission`) to observe and react to these conditions.

## Headless usage (`GeolocationCore`)

The Core has no DOM dependency and can be used directly with `bind()` from `@wc-bindable/core`:

```typescript
import { GeolocationCore } from "@wcstack/geolocation";

const geo = new GeolocationCore();
geo.addEventListener("wcs-geo:position", (e) => {
  console.log((e as CustomEvent).detail); // { latitude, longitude, accuracy, ... }
});

await geo.getCurrentPosition({ enableHighAccuracy: true });
// or, for continuous updates:
geo.watch();
// ...later
geo.clearWatch();
```

## License

MIT
