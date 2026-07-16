# @wcstack/accelerometer

`@wcstack/accelerometer` is a headless Generic Sensor API (Accelerometer) component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns device acceleration readings into reactive state.

With `@wcstack/state`, `<wcs-accelerometer>` can be bound directly through path contracts:

- **input surface**: `frequency` (sampling rate in Hz)
- **output state surface**: `x`, `y`, `z`, `error`, `errorInfo`

This means tilt/shake-gesture UI can be expressed declaratively in HTML, without writing `Accelerometer`/`reading`/`error`-listener glue in your UI layer.

`@wcstack/accelerometer` follows the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) (Core / Shell / Binding Contract) architecture:

- **Core** (`AccelerometerCore`) constructs the platform `Accelerometer`, tracks its live `reading`/`error` events
- **Shell** (`<wcs-accelerometer>`) connects that state to DOM lifecycle
- **Binding Contract** (`static wcBindable`) declares observable `properties` and `start`/`stop` `commands`

## Why this exists — a rare case where the platform API already matches never-throw

The Generic Sensor API's `Accelerometer`/`Gyroscope`/`Magnetometer`/`AmbientLightSensor` family all share one base shape: `.start()`/`.stop()`, a `'reading'` event per sample, and — notably — an `'error'` **event** for failures instead of a thrown exception. This already lines up with wcstack's never-throw convention; the one place this Core still needs a defensive `try/catch` is the synchronous `Accelerometer` **constructor** itself, which can throw (`SecurityError`) on permission denial or a Permissions-Policy block.

> **Compose with `@wcstack/permission`.** `navigator.permissions.query({name:"accelerometer"})` already exists — pair `<wcs-accelerometer>` with `<wcs-permission name="accelerometer">` for `granted`/`denied`/`prompt` status rather than duplicating that state here (see `docs/sensor-tag-design.md`).

> **Chromium/Android-centric support.** Desktop browsers commonly reject with `SecurityError` even when the `Accelerometer` class exists. Design any UI around `unsupported`/denied being the common case, not the exception.

## Install

```bash
npm install @wcstack/accelerometer
```

## Quick Start

### 1. Read live acceleration

`<wcs-accelerometer>` does **not** auto-start on connect — binding alone leaves
`x`/`y`/`z` at their initial `null`. You must fire the `start` command
(e.g. from a button) before readings flow:

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/accelerometer/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["startAccel"],
      x: null, y: null, z: null,
    };
  </script>
</wcs-state>

<wcs-accelerometer
  data-wcs="x: x; y: y; z: z; command.start: $command.startAccel"
></wcs-accelerometer>

<button data-wcs="onclick: $command.startAccel">Start</button>
<p data-wcs="textContent: x"></p>
```

The button never touches `<wcs-accelerometer>` directly: its click emits the `startAccel` command token (`$commandTokens: ["startAccel"]` declares the name), and `<wcs-accelerometer>` subscribes to it via `command.start: $command.startAccel` (the [command-token protocol](../state/) — the element with the command method is the *subscriber*, not the emitter).

### 2. Gate on permission, then start

This example also needs `@wcstack/permission` registered (alongside the
`@wcstack/state` / `@wcstack/accelerometer` scripts from example 1), with its
own self-contained `<wcs-state>` declaring `accelGranted`:

```html
<script type="module" src="https://esm.run/@wcstack/permission/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["startAccel"],
      accelGranted: false,
    };
  </script>
</wcs-state>

<wcs-permission name="accelerometer" data-wcs="granted: accelGranted"></wcs-permission>
<wcs-accelerometer data-wcs="command.start: $command.startAccel"></wcs-accelerometer>

<button data-wcs="onclick: $command.startAccel; disabled: accelGranted|not">Start</button>
```

Every bound state path must be declared up front — binding an undeclared path throws at initialization. Negation in a `data-wcs` path is done with the `|not` filter (`accelGranted|not`), not a leading `!`.

## Attributes / Inputs

| Attribute   | Type   | Default | Description |
| ----------- | ------ | ------- | ------------ |
| `frequency` | number | —       | Sampling rate in Hz, forwarded to the `Accelerometer` constructor. |

## Observable Properties (outputs)

| Property | Event                     | Description |
| -------- | ------------------------- | ------------ |
| `x`      | `wcs-accelerometer:reading` | Acceleration along the x-axis, or `null` before the first reading. |
| `y`      | `wcs-accelerometer:reading` | Acceleration along the y-axis. |
| `z`      | `wcs-accelerometer:reading` | Acceleration along the z-axis. |
| `error`  | `wcs-accelerometer:error`   | Normalized `{ error, message }`, or `null`. |
| `errorInfo` | `wcs-accelerometer:error-info-changed` | Serializable failure taxonomy (`WcsIoErrorInfo` — stable `code` / `phase` / `recoverable`), or `null`. Additive, derived from `error`; the existing `error` shape is unchanged. |

`x`/`y`/`z` all derive from the single `wcs-accelerometer:reading` event (one native `reading` event updates all three axes together).

## Commands

| Command | Async | Description |
| ------- | ----- | ------------ |
| `start` | no    | Construct the sensor (never-throw: a synchronous constructor exception is caught and surfaced via `error`) and begin reading. |
| `stop`  | no    | Stop the sensor and detach its listeners. Safe to call when not started. |

## Notes & limitations

- **No `_gen` generation guard.** `start()`/`stop()` are a synchronous subscribe/unsubscribe toggle with no asynchronous probe to race against a `dispose()` — see `docs/sensor-tag-design.md` §1.5.
- **`error` is sticky.** It holds the last observed failure (e.g. `unsupported`, `SecurityError`) and is **not** auto-cleared by a later successful `start()` or by incoming `reading`s. A `stop()` + `start()` retry that succeeds still leaves the previous `error` in place — clear or reinterpret it in your own state if needed.
- **`errorInfo` taxonomy.** An **additive** bindable output (`wcs-accelerometer:error-info-changed`) that classifies the same failure into a serializable `WcsIoErrorInfo` with a stable `code` / `phase` / `recoverable`, without changing the `error` shape. The mapping keys off the normalized error name: `unsupported` → `capability-missing` (phase `probe`); `SecurityError` / `NotAllowedError` → `not-allowed` (phase `start`); `NotReadableError` → `not-readable` (phase `execute`); any other sensor failure → `sensor-error` (phase `execute`). All are `recoverable: false`. `errorInfo` transitions exactly when `error` does, so it is **sticky** in the same way and only returns to `null` when `error` does. The shared `WcsIoErrorInfo` type and the `WCS_ACCELEROMETER_ERROR_CODE` constants are exported.
- **Never call the raw `new Accelerometer(...)` anywhere but the one guarded construction helper** — permission denial and Permissions-Policy blocks throw synchronously.
- Permission status (`granted`/`denied`/`prompt`) is intentionally not duplicated here — compose with `<wcs-permission name="accelerometer">`.

## CSS styling with `:state()`

`<wcs-accelerometer>` reflects one boolean output state onto its
[`ElementInternals` `CustomStateSet`](https://developer.mozilla.org/en-US/docs/Web/API/CustomStateSet),
so you can style it directly from CSS with the `:state()` pseudo-class — no
`data-wcs` binding or extra class toggling required. `x`/`y`/`z` (continuous
sensor readings) are intentionally **not** reflected — see
`docs/custom-state-reflection-design.md` §3.2.

| State | On when |
|-------|---------|
| `error` | `wcs-accelerometer:error` fires with a non-`null` detail (cleared on `null`) |

```css
wcs-accelerometer:state(error) ~ .fallback { display: block; }
```

Note `error` is sticky (see "Notes & limitations" above): once set, the
`error` state stays on until a later `wcs-accelerometer:error` event fires
with a `null` detail — it is not auto-cleared by a subsequent successful
`start()` or by incoming `reading`s.

Unlike attributes or classes, `:state()` cannot be written from outside the
element, so there is no risk of confusing this output state with an input.

**Browser support** (`:state(x)` syntax): Chrome/Edge 125+, Safari 17.4+,
Firefox 126+. In older browsers the states are simply never set — `:state()`
selectors never match, but `<wcs-accelerometer>` itself keeps working normally
(graceful degradation, never-throw).

**SSR**: `:state()` cannot be serialized into HTML, so server-rendered markup
never carries these states on first paint (`@wcstack/server` is unaffected).
If you need to style the pre-hydration gap, pair your rule with
`wcs-accelerometer:not(:defined)` instead.

### Debugging

Custom states are invisible in DevTools' Elements panel and `attachInternals()`
cannot be called twice, so there is no console way to inspect them directly.
Two debug-only aids are provided for that:

- `el.debugStates` — a **snapshot** array of the currently-on state names
  (e.g. `["error"]`). It is not part of `wc-bindable` (not a bind target)
  and its shape is not a guaranteed contract — use it for debugging only.
- The `debug-states` attribute (opt-in, default off) mirrors state changes
  onto a `data-wcs-state-error` attribute on the element, so the Elements
  panel highlights it as it toggles:

  ```html
  <wcs-accelerometer debug-states></wcs-accelerometer>
  ```

**Write your CSS against `:state()`, not `data-wcs-state-*`.** The mirrored
attribute exists purely to make state changes visible while debugging with
DevTools open; it is not a supported styling hook.

## Headless usage (`AccelerometerCore`)

```typescript
import { AccelerometerCore } from "@wcstack/accelerometer";

const core = new AccelerometerCore();
core.addEventListener("wcs-accelerometer:reading", (e) => {
  console.log((e as CustomEvent).detail); // { x, y, z }
});

core.start();
// later:
core.dispose();
```

## License

MIT
