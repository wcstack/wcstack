# @wcstack/accelerometer

`@wcstack/accelerometer` is a headless Generic Sensor API (Accelerometer) component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns device acceleration readings into reactive state.

With `@wcstack/state`, `<wcs-accelerometer>` can be bound directly through path contracts:

- **input surface**: `frequency` (sampling rate in Hz)
- **output state surface**: `x`, `y`, `z`, `error`

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

`x`/`y`/`z` all derive from the single `wcs-accelerometer:reading` event (one native `reading` event updates all three axes together).

## Commands

| Command | Async | Description |
| ------- | ----- | ------------ |
| `start` | no    | Construct the sensor (never-throw: a synchronous constructor exception is caught and surfaced via `error`) and begin reading. |
| `stop`  | no    | Stop the sensor and detach its listeners. Safe to call when not started. |

## Notes & limitations

- **No `_gen` generation guard.** `start()`/`stop()` are a synchronous subscribe/unsubscribe toggle with no asynchronous probe to race against a `dispose()` — see `docs/sensor-tag-design.md` §1.5.
- **`error` is sticky.** It holds the last observed failure (e.g. `unsupported`, `SecurityError`) and is **not** auto-cleared by a later successful `start()` or by incoming `reading`s. A `stop()` + `start()` retry that succeeds still leaves the previous `error` in place — clear or reinterpret it in your own state if needed.
- **Never call the raw `new Accelerometer(...)` anywhere but the one guarded construction helper** — permission denial and Permissions-Policy blocks throw synchronously.
- Permission status (`granted`/`denied`/`prompt`) is intentionally not duplicated here — compose with `<wcs-permission name="accelerometer">`.

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
