# @wcstack/gyroscope

`@wcstack/gyroscope` is a headless Generic Sensor API (Gyroscope) component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns device angular velocity readings into reactive state.

With `@wcstack/state`, `<wcs-gyroscope>` can be bound directly through path contracts:

- **input surface**: `frequency` (sampling rate in Hz)
- **output state surface**: `x`, `y`, `z`, `error`

This means rotation-rate-driven UI can be expressed declaratively in HTML, without writing `Gyroscope`/`reading`/`error`-listener glue in your UI layer.

`@wcstack/gyroscope` follows the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) (Core / Shell / Binding Contract) architecture:

- **Core** (`GyroscopeCore`) constructs the platform `Gyroscope`, tracks its live `reading`/`error` events
- **Shell** (`<wcs-gyroscope>`) connects that state to DOM lifecycle
- **Binding Contract** (`static wcBindable`) declares observable `properties` and `start`/`stop` `commands`

## Why this exists — a rare case where the platform API already matches never-throw

The Generic Sensor API's `Accelerometer`/`Gyroscope`/`Magnetometer`/`AmbientLightSensor` family all share one base shape: `.start()`/`.stop()`, a `'reading'` event per sample, and — notably — an `'error'` **event** for failures instead of a thrown exception. This already lines up with wcstack's never-throw convention; the one place this Core still needs a defensive `try/catch` is the synchronous `Gyroscope` **constructor** itself, which can throw (`SecurityError`) on permission denial or a Permissions-Policy block.

> **Compose with `@wcstack/permission`.** `navigator.permissions.query({name:"gyroscope"})` already exists — pair `<wcs-gyroscope>` with `<wcs-permission name="gyroscope">` for `granted`/`denied`/`prompt` status rather than duplicating that state here (see `docs/sensor-tag-design.md`).

> **Chromium/Android-centric support.** Desktop browsers commonly reject with `SecurityError` even when the `Gyroscope` class exists. Design any UI around `unsupported`/denied being the common case, not the exception.

## Install

```bash
npm install @wcstack/gyroscope
```

## Quick Start

### 1. Read live angular velocity

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/gyroscope/auto"></script>

<wcs-state>
  <script type="module">
    export default { x: null, y: null, z: null };
  </script>
</wcs-state>

<wcs-gyroscope data-wcs="x: x; y: y; z: z"></wcs-gyroscope>
<p data-wcs="textContent: x"></p>
```

### 2. Gate on permission, then start

```html
<wcs-permission name="gyroscope" data-wcs="granted: gyroGranted"></wcs-permission>
<wcs-gyroscope data-wcs="command.start: $command.startGyro"></wcs-gyroscope>

<button data-wcs="onclick: startGyro; disabled: !gyroGranted">Start</button>
```

## Attributes / Inputs

| Attribute   | Type   | Default | Description |
| ----------- | ------ | ------- | ------------ |
| `frequency` | number | —       | Sampling rate in Hz, forwarded to the `Gyroscope` constructor. |

## Observable Properties (outputs)

| Property | Event                     | Description |
| -------- | ------------------------- | ------------ |
| `x`      | `wcs-gyroscope:reading` | Angular velocity around the x-axis, or `null` before the first reading. |
| `y`      | `wcs-gyroscope:reading` | Angular velocity around the y-axis. |
| `z`      | `wcs-gyroscope:reading` | Angular velocity around the z-axis. |
| `error`  | `wcs-gyroscope:error`   | Normalized `{ error, message }`, or `null`. |

`x`/`y`/`z` all derive from the single `wcs-gyroscope:reading` event (one native `reading` event updates all three axes together).

## Commands

| Command | Async | Description |
| ------- | ----- | ------------ |
| `start` | no    | Construct the sensor (never-throw: a synchronous constructor exception is caught and surfaced via `error`) and begin reading. |
| `stop`  | no    | Stop the sensor and detach its listeners. Safe to call when not started. |

## Notes & limitations

- **No `_gen` generation guard.** `start()`/`stop()` are a synchronous subscribe/unsubscribe toggle with no asynchronous probe to race against a `dispose()` — see `docs/sensor-tag-design.md` §1.5.
- **Never call the raw `new Gyroscope(...)` anywhere but the one guarded construction helper** — permission denial and Permissions-Policy blocks throw synchronously.
- Permission status (`granted`/`denied`/`prompt`) is intentionally not duplicated here — compose with `<wcs-permission name="gyroscope">`.

## Headless usage (`GyroscopeCore`)

```typescript
import { GyroscopeCore } from "@wcstack/gyroscope";

const core = new GyroscopeCore();
core.addEventListener("wcs-gyroscope:reading", (e) => {
  console.log((e as CustomEvent).detail); // { x, y, z }
});

core.start();
// later:
core.dispose();
```

## License

MIT
