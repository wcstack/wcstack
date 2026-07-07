# @wcstack/ambient-light-sensor

`@wcstack/ambient-light-sensor` is a headless Generic Sensor API (AmbientLightSensor) component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns ambient light readings into reactive state.

With `@wcstack/state`, `<wcs-ambient-light-sensor>` can be bound directly through path contracts:

- **input surface**: `frequency` (sampling rate in Hz)
- **output state surface**: `illuminance`, `error`

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

## Commands

| Command | Async | Description |
| ------- | ----- | ------------ |
| `start` | no    | Construct the sensor (never-throw: a synchronous constructor exception is caught and surfaced via `error`) and begin reading. |
| `stop`  | no    | Stop the sensor and detach its listeners. Safe to call when not started. |

## Notes & limitations

- **No `_gen` generation guard.** `start()`/`stop()` are a synchronous subscribe/unsubscribe toggle with no asynchronous probe to race against a `dispose()` — see `docs/sensor-tag-design.md` §1.5.
- **`error` is sticky.** It holds the last observed failure (e.g. `unsupported`, `SecurityError`) and is **not** auto-cleared by a later successful `start()` or by incoming `reading`s. A `stop()` + `start()` retry that succeeds still leaves the previous `error` in place — clear or reinterpret it in your own state if needed.
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
