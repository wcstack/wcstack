# @wcstack/ambient-light-sensor

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/ambient-light-sensor` is a headless Generic Sensor API (AmbientLightSensor) component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns ambient light readings into reactive state.

With `@wcstack/state`, `<wcs-ambient-light-sensor>` can be bound directly through path contracts:

- **input surface**: `frequency` (sampling rate in Hz)
- **output state surface**: `illuminance`, `error`, `errorInfo`

This means light-level-driven UI (auto dark mode, screen dimming) can be expressed declaratively in HTML, without writing `AmbientLightSensor`/`reading`/`error`-listener glue in your UI layer.

`@wcstack/ambient-light-sensor` follows the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) (Core / Shell / Binding Contract) architecture:

- **Core** (`AmbientLightSensorCore`) constructs the platform `AmbientLightSensor`, tracks its live `reading`/`error` events
- **Shell** (`<wcs-ambient-light-sensor>`) connects that state to DOM lifecycle
- **Binding Contract** (`static wcBindable`) declares observable `properties` and `start`/`stop` `commands`

## Why this exists — the weakest-supported member of the Generic Sensor family

The Generic Sensor API's `Accelerometer`/`Gyroscope`/`Magnetometer`/`AmbientLightSensor` family all share one base shape: `.start()`/`.stop()`, a `'reading'` event per sample, and — notably — an `'error'` **event** for failures instead of a thrown exception. This already lines up with wcstack's never-throw convention; the one place this Core still needs a defensive `try/catch` is the synchronous `AmbientLightSensor` **constructor** itself, which can throw (`SecurityError`) on permission denial or a Permissions-Policy block.

Unlike its three siblings, **`AmbientLightSensor` reports a single scalar** (`illuminance`, in lux) rather than x/y/z axes.

> **Support is deteriorating, not just narrow.** Beyond the usual Chromium/Android-centric limits shared with the rest of the family, `AmbientLightSensor` specifically has been disabled or removed in several browsers over fingerprinting concerns. Verify current support (MDN/caniuse) before depending on this package — it may not be worth shipping at all depending on your target browsers.

> **Compose with `@wcstack/permission`.** `navigator.permissions.query({name:"ambient-light-sensor"})` exists where the sensor itself is supported — pair `<wcs-ambient-light-sensor>` with `<wcs-permission name="ambient-light-sensor">` for `granted`/`denied`/`prompt` status rather than duplicating that state here (see `docs/sensor-tag-design.md`).

## Install

```bash
npm install @wcstack/ambient-light-sensor
```

## Quick Start

### 1. Read live illuminance

`<wcs-ambient-light-sensor>` does **not** auto-start on connect — binding alone
leaves `illuminance` at its initial `null`. You must fire the `start` command
(e.g. from a button) before readings flow:

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/ambient-light-sensor/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["startLight"],
      illuminance: null,
    };
  </script>
</wcs-state>

<wcs-ambient-light-sensor
  data-wcs="illuminance: illuminance; command.start: $command.startLight"
></wcs-ambient-light-sensor>

<button data-wcs="onclick: $command.startLight">Start</button>
<p data-wcs="textContent: illuminance"></p>
```

The button never touches `<wcs-ambient-light-sensor>` directly: its click emits the `startLight` command token (`$commandTokens: ["startLight"]` declares the name), and `<wcs-ambient-light-sensor>` subscribes to it via `command.start: $command.startLight` (the [command-token protocol](../state/) — the element with the command method is the *subscriber*, not the emitter).

### 2. Gate on permission, then start

This example also needs `@wcstack/permission` registered (alongside the
`@wcstack/state` / `@wcstack/ambient-light-sensor` scripts from example 1), with its
own self-contained `<wcs-state>` declaring `lightGranted`:

```html
<script type="module" src="https://esm.run/@wcstack/permission/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["startLight"],
      lightGranted: false,
    };
  </script>
</wcs-state>

<wcs-permission name="ambient-light-sensor" data-wcs="granted: lightGranted"></wcs-permission>
<wcs-ambient-light-sensor data-wcs="command.start: $command.startLight"></wcs-ambient-light-sensor>

<button data-wcs="onclick: $command.startLight; disabled: lightGranted|not">Start</button>
```

Every bound state path must be declared up front — binding an undeclared path throws at initialization. Negation in a `data-wcs` path is done with the `|not` filter (`lightGranted|not`), not a leading `!`.

## Attributes / Inputs

| Attribute   | Type   | Default | Description |
| ----------- | ------ | ------- | ------------ |
| `frequency` | number | —       | Sampling rate in Hz, forwarded to the `AmbientLightSensor` constructor. |

## Observable Properties (outputs)

| Property      | Event                                | Description |
| ------------- | -------------------------------------- | ------------ |
| `illuminance` | `wcs-ambient-light-sensor:reading`      | Ambient light level in lux, or `null` before the first reading. |
| `error`       | `wcs-ambient-light-sensor:error`        | Normalized `{ error, message }`, or `null`. |
| `errorInfo`   | `wcs-ambient-light-sensor:error-info-changed` | Serializable failure taxonomy (`WcsIoErrorInfo` — stable `code` / `phase` / `recoverable`), or `null`. Additive, derived from `error`; the existing `error` shape is unchanged. |

## Commands

| Command | Async | Description |
| ------- | ----- | ------------ |
| `start` | no    | Construct the sensor (never-throw: a synchronous constructor exception is caught and surfaced via `error`) and begin reading. |
| `stop`  | no    | Stop the sensor and detach its listeners. Safe to call when not started. |

## CSS styling with `:state()`

`<wcs-ambient-light-sensor>` reflects one boolean output state onto its
[`ElementInternals` `CustomStateSet`](https://developer.mozilla.org/en-US/docs/Web/API/CustomStateSet),
so you can style it directly from CSS with the `:state()` pseudo-class — no
`data-wcs` binding or extra class toggling required.

| State | On when |
|-------|---------|
| `error` | `wcs-ambient-light-sensor:error` fires with a non-`null` detail (cleared on `null`) |

`illuminance` is not reflected — it is a continuous/high-frequency reading, out
of scope for `:state()` reflection (see the design doc's excluded-values list).

```css
wcs-ambient-light-sensor:state(error) ~ .fallback { display: block; }
```

Unlike attributes or classes, `:state()` cannot be written from outside the
element, so there is no risk of confusing this output state with an input.

**Browser support** (`:state(x)` syntax): Chrome/Edge 125+, Safari 17.4+,
Firefox 126+. In older browsers the states are simply never set — `:state()`
selectors never match, but `<wcs-ambient-light-sensor>` itself keeps working normally
(graceful degradation, never-throw).

**SSR**: `:state()` cannot be serialized into HTML, so server-rendered markup
never carries these states on first paint (`@wcstack/server` is unaffected).
If you need to style the pre-hydration gap, pair your rule with
`wcs-ambient-light-sensor:not(:defined)` instead.

### Debugging

Custom states are invisible in DevTools' Elements panel and `attachInternals()`
cannot be called twice, so there is no console way to inspect them directly.
Two debug-only aids are provided for that:

- `el.debugStates` — a **snapshot** array of the currently-on state names
  (e.g. `["error"]`). It is not part of `wc-bindable` (not a bind target)
  and its shape is not a guaranteed contract — use it for debugging only.
- The `debug-states` attribute (opt-in, default off) mirrors state changes
  onto `data-wcs-state-error` attribute on the element, so the Elements
  panel highlights it as it toggles:

  ```html
  <wcs-ambient-light-sensor debug-states></wcs-ambient-light-sensor>
  ```

**Write your CSS against `:state()`, not `data-wcs-state-*`.** The mirrored
attribute exists purely to make state changes visible while debugging with
DevTools open; it is not a supported styling hook.

## Notes & limitations

- **No `_gen` generation guard.** `start()`/`stop()` are a synchronous subscribe/unsubscribe toggle with no asynchronous probe to race against a `dispose()` — see `docs/sensor-tag-design.md` §1.5.
- **`error` is sticky.** It holds the last observed failure (e.g. `unsupported`, `SecurityError`) and is **not** auto-cleared by a later successful `start()` or by incoming `reading`s. A `stop()` + `start()` retry that succeeds still leaves the previous `error` in place — clear or reinterpret it in your own state if needed.
- **`errorInfo` taxonomy.** An **additive** bindable output (`wcs-ambient-light-sensor:error-info-changed`) that classifies the same failure into a serializable `WcsIoErrorInfo` with a stable `code` / `phase` / `recoverable`, without changing the `error` shape. The mapping keys off the normalized error name: `unsupported` → `capability-missing` (phase `probe`); `SecurityError` / `NotAllowedError` → `not-allowed` (phase `start`); `NotReadableError` → `not-readable` (phase `execute`); any other sensor failure → `sensor-error` (phase `execute`). All are `recoverable: false`. `errorInfo` transitions exactly when `error` does, so it is **sticky** in the same way and only returns to `null` when `error` does. The shared `WcsIoErrorInfo` type and the `WCS_AMBIENT_LIGHT_SENSOR_ERROR_CODE` constants are exported.
- **Never call the raw `new AmbientLightSensor(...)` anywhere but the one guarded construction helper** — permission denial and Permissions-Policy blocks throw synchronously.
- Permission status (`granted`/`denied`/`prompt`) is intentionally not duplicated here — compose with `<wcs-permission name="ambient-light-sensor">`.
- **Confirm current browser support before adopting this package** — see "Why this exists" above.

## Headless usage (`AmbientLightSensorCore`)

```typescript
import { AmbientLightSensorCore } from "@wcstack/ambient-light-sensor";

const core = new AmbientLightSensorCore();
core.addEventListener("wcs-ambient-light-sensor:reading", (e) => {
  console.log((e as CustomEvent).detail); // { illuminance }
});

core.start();
// later:
core.dispose();
```

## License

MIT
