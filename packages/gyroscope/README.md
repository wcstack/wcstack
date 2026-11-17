# @wcstack/gyroscope

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/gyroscope` is a headless Generic Sensor API (Gyroscope) component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns device angular velocity readings into reactive state.

With `@wcstack/state`, `<wcs-gyroscope>` can be bound directly through path contracts:

- **input surface**: `frequency` (sampling rate in Hz)
- **output state surface**: `x`, `y`, `z`, `error`, `errorInfo`, and — since 4.25 — `permissionState`, `supported`

This means rotation-rate-driven UI can be expressed declaratively in HTML, without writing `Gyroscope`/`reading`/`error`-listener glue in your UI layer.

`@wcstack/gyroscope` follows the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) (Core / Shell / Binding Contract) architecture:

- **Core** (`GyroscopeCore`) constructs the platform `Gyroscope`, tracks its live `reading`/`error` events
- **Shell** (`<wcs-gyroscope>`) connects that state to DOM lifecycle
- **Binding Contract** (`static wcBindable`) declares observable `properties` and `start`/`stop` `commands` (since 4.25, `requestPermission` too)

## Why this exists — a rare case where the platform API already matches never-throw

The Generic Sensor API's `Accelerometer`/`Gyroscope`/`Magnetometer`/`AmbientLightSensor` family all share one base shape: `.start()`/`.stop()`, a `'reading'` event per sample, and — notably — an `'error'` **event** for failures instead of a thrown exception. This already lines up with wcstack's never-throw convention; the one place this Core still needs a defensive `try/catch` is the synchronous `Gyroscope` **constructor** itself, which can throw (`SecurityError`) on permission denial or a Permissions-Policy block.

> **Compose with `@wcstack/permission`.** `navigator.permissions.query({name:"gyroscope"})` already exists — pair `<wcs-gyroscope>` with `<wcs-permission name="gyroscope">` for `granted`/`denied`/`prompt` status rather than duplicating that state here (see `docs/sensor-tag-design.md`).

> **Chromium/Android-centric support.** Desktop browsers commonly reject with `SecurityError` even when the `Gyroscope` class exists. Design any UI around `unsupported`/denied being the common case, not the exception. Since 4.25, a browser with no `Gyroscope` class but with `devicemotion` — Safari on an iPhone or iPad, Firefox on Android — is read through that event instead: see [Where it runs](#where-it-runs--the-sensor-class-or-devicemotion).

## Install

```bash
npm install @wcstack/gyroscope
```

## Quick Start

### 1. Read live angular velocity

`<wcs-gyroscope>` does **not** auto-start on connect — binding alone leaves
`x`/`y`/`z` at their initial `null`. You must fire the `start` command
(e.g. from a button) before readings flow:

```html
<script type="module" src="https://esm.run/@wcstack/gyroscope/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["startGyro"],
      x: null, y: null, z: null,
    };
  </script>
</wcs-state>

<wcs-gyroscope
  data-wcs="x: x; y: y; z: z; command.start: $command.startGyro"
></wcs-gyroscope>

<button data-wcs="onclick: $command.startGyro">Start</button>
<p data-wcs="textContent: x"></p>
```

The button never touches `<wcs-gyroscope>` directly: its click emits the `startGyro` command token (`$commandTokens: ["startGyro"]` declares the name), and `<wcs-gyroscope>` subscribes to it via `command.start: $command.startGyro` (the [command-token protocol](../state/) — the element with the command method is the *subscriber*, not the emitter).

### 2. Gate on permission, then start

This example also needs `@wcstack/permission` registered (alongside the
`@wcstack/state` / `@wcstack/gyroscope` scripts from example 1), with its
own self-contained `<wcs-state>` declaring `gyroGranted`:

```html
<script type="module" src="https://esm.run/@wcstack/permission/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["startGyro"],
      gyroGranted: false,
    };
  </script>
</wcs-state>

<wcs-permission name="gyroscope" data-wcs="granted: gyroGranted"></wcs-permission>
<wcs-gyroscope data-wcs="command.start: $command.startGyro"></wcs-gyroscope>

<button data-wcs="onclick: $command.startGyro; disabled: gyroGranted|not">Start</button>
```

Every bound state path must be declared up front — binding an undeclared path throws at initialization. Negation in a `data-wcs` path is done with the `|not` filter (`gyroGranted|not`), not a leading `!`. This example waits for the Generic Sensor's permission, which belongs to the `Gyroscope` class. Where the element reads `devicemotion` instead (an iPhone), that permission says nothing about it: since 4.25, use example 3 there.

### 3. Count shakes (fast turns) — on an iPhone too

Since 4.25. One tap asks (where there is something to ask) and starts; every reading goes to a state handler through an event token, which looks at the size of the turn rate, not at its direction:

```html
<script type="module" src="https://esm.run/@wcstack/gyroscope/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["ask", "start"],
      $eventTokens: ["reading"],
      $on: {
        // The size of the angular velocity, in rad/s: 2π (about 6.3) is one full turn a second.
        reading: (state, event) => {
          const { x, y, z } = event.detail;
          if (Math.hypot(x, y, z) > 6 && Date.now() - state.lastShakeAt > 1000) {
            state.lastShakeAt = Date.now();
            state.shakes += 1;
          }
        },
      },
      shakes: 0,
      lastShakeAt: 0,
      motionSupported: false,
      enableShake() {
        // Both in the tap handler: iOS shows its question only from a tap.
        this.$command.ask.emit();
        this.$command.start.emit();
      },
    };
  </script>
</wcs-state>

<wcs-gyroscope frequency="30"
  data-wcs="supported: motionSupported; eventToken.x: reading;
            command.requestPermission: $command.ask; command.start: $command.start"
></wcs-gyroscope>

<button data-wcs="hidden: motionSupported|not; onclick: enableShake">Enable shake</button>
<p>Shakes: <span data-wcs="textContent: shakes"></span></p>
```

`eventToken.x: reading` hands the `reading` token every `wcs-gyroscope:reading` event — the event `x` is published with — and the handler takes all three axes from `event.detail`. `requestPermission` asks only where there is a question, which is Safari on an iPhone or iPad, and answers `"granted"` at once everywhere else, so the same two lines work in every browser. Every bound path, and every token (`$commandTokens`, `$eventTokens`), is declared on the state. Give the shake a button that does the same thing (see [Accessibility](#accessibility)).

## Attributes / Inputs

| Attribute   | Type   | Default | Description |
| ----------- | ------ | ------- | ------------ |
| `frequency` | number | —       | Sampling rate in Hz, forwarded to the `Gyroscope` constructor. Read only when `start()` runs — changing it while already started has no effect until `stop()` + `start()` (see Notes). Since 4.25: on the `devicemotion` fallback it thins the readings instead ([Where it runs](#where-it-runs--the-sensor-class-or-devicemotion)), and a value that is not a positive number is said once in the console when `start()` runs (`[wcs/frequency-invalid]`, see Notes). |

**`null` and `undefined`.** The input backed by an attribute (`frequency`) takes `null` as "clear": the attribute is removed and the input falls back to its default (the platform's sampling rate). `undefined` means "no value supplied": the attribute goes back to what it was before the first write — the value written in the markup, or none. Neither is ever written as the string `"null"` / `"undefined"`. (`@wcstack/state` never writes `undefined`; React 19 does when a prop that had a value is removed, and so can a direct assignment.)

## Observable Properties (outputs)

| Property | Event                     | Description |
| -------- | ------------------------- | ------------ |
| `x`      | `wcs-gyroscope:reading` | Angular velocity around the x-axis, or `null` before the first reading. |
| `y`      | `wcs-gyroscope:reading` | Angular velocity around the y-axis. |
| `z`      | `wcs-gyroscope:reading` | Angular velocity around the z-axis. |
| `error`  | `wcs-gyroscope:error`   | Normalized `{ error, message }`, or `null`. |
| `errorInfo` | `wcs-gyroscope:error-info-changed` | Serializable failure taxonomy (`WcsIoErrorInfo` — stable `code` / `phase` / `recoverable`), or `null`. Additive, derived from `error`; the existing `error` shape is unchanged. |
| `permissionState` | `wcs-gyroscope:permission-changed` | Since 4.25. `"granted"` \| `"denied"` \| `"unknown"` — what the browser answered to `requestPermission()`; `"unknown"` until it answers. It is not the Generic Sensor's permission (that is `<wcs-permission name="gyroscope">`). |
| `supported` | `wcs-gyroscope:supported-changed` | Since 4.25. `true` when this page can use the sensor. See [`supported`](#supported--can-this-page-use-it). |

`x`/`y`/`z` all derive from the single `wcs-gyroscope:reading` event (one native `reading` event updates all three axes together).

## Commands

| Command | Async | Description |
| ------- | ----- | ------------ |
| `requestPermission` | yes | Since 4.25. Where the element reads `devicemotion` and the browser has `DeviceMotionEvent.requestPermission()` (Safari on an iPhone or iPad), calls it — **from a tap**. Everywhere else the sensor can be started there is nothing to ask, and it resolves to `"granted"` at once. Resolves to `permissionState` as it is after the call; never rejects. |
| `start` | no    | Construct the sensor (never-throw: a synchronous constructor exception is caught and surfaced via `error`) and begin reading. Idempotent while already started (a redundant call is a no-op). Since 4.25: where the browser has no `Gyroscope` class it subscribes to `devicemotion` instead, and after the sensor's own `error` event the next `start()` builds a fresh sensor. |
| `stop`  | no    | Stop the sensor and detach its listeners. Safe to call when not started. |

## `supported` — can this page use it

Since 4.25. `supported` is `true` when this page can use the sensor: the browser has the `Gyroscope` class or `DeviceMotionEvent`, the page is a secure context, and no Permissions-Policy turns `gyroscope` off for it (the server's header, or an `<iframe>` without `allow="gyroscope"` — read where the browser lets a page see its policy, which is Chromium). Where it is `false`, `start()` cannot work and no tap changes that: do not offer the feature.

It does **not** say that the user will allow it (`permissionState`, and `<wcs-permission name="gyroscope">` for the sensor class), and it **cannot say whether the device has the sensor**: a PC has the API and no sensor. There the readings simply never come, or the sensor reports it through `error`.

The value is read from the browser each time it is asked for, so a binding gets the right value when it attaches; the element also dispatches `wcs-gyroscope:supported-changed` (the boolean as `detail`) when it is connected, if the value differs from the last one it dispatched (it starts at `false`).

```html
<wcs-gyroscope data-wcs="supported: sensorSupported; command.start: $command.startSensor"></wcs-gyroscope>
<button data-wcs="hidden: sensorSupported|not; onclick: $command.startSensor">Start</button>
```

(`sensorSupported: false` and `$commandTokens: ["startSensor"]` on the state.)

## Where it runs — the sensor class, or `devicemotion`

Since 4.25. `start()` uses the Generic Sensor `Gyroscope` class where the browser has it, and `window`'s `devicemotion` event where it does not. Which of the two is decided at each `start()`.

| Browser | What `start()` reads | `requestPermission()` |
| --- | --- | --- |
| Chrome, Edge and other Chromium browsers (Android, desktop) | the `Gyroscope` class | `"granted"` at once — nothing is asked here; the sensor's own permission is watched with `<wcs-permission name="gyroscope">` |
| Safari on an iPhone or iPad | `devicemotion` | asks, from a tap ([On an iPhone](#on-an-iphone)) |
| Firefox on Android | `devicemotion` | `"granted"` at once |
| a browser with neither | nothing — `error` is `unsupported` | `error` is `unsupported` |

Up to 4.24 only the first row worked: the others ended as `unsupported`.

**The same outputs either way.** Readings arrive through the same `wcs-gyroscope:reading` event and `x` / `y` / `z`: angular velocity in radians per second around the device's x / y / z axes, what `Gyroscope` reports. On the fallback they come from the event's `rotationRate`, which is in degrees per second and names its axes differently: `x = beta × π/180`, `y = gamma × π/180`, `z = alpha × π/180`. An event with no values — a PC without the sensor fires them — is skipped.

**Signs are not verified.** The mapping follows the specifications; this project has not verified the direction of each axis on devices. Use the size of the reading (`Math.hypot(x, y, z)`), as the shake example does, or check the signs on the devices you target.

**`frequency` thins, it does not set.** `devicemotion` has its own rate, which a page cannot set. On the fallback, `frequency` drops readings instead: one that arrives sooner than `1000 / frequency` ms after the last published one is not published, so at most `frequency` readings a second come through. Without `frequency`, every event is published.

**No `error` on the fallback.** `devicemotion` reports no failure: a device without the sensor sends nothing. `supported` cannot tell that ([below](#supported--can-this-page-use-it)).

## On an iPhone

Since 4.25. Safari on an iPhone or iPad has no `Gyroscope` class, so `<wcs-gyroscope>` reads `devicemotion` there, and iOS gates that event behind `DeviceMotionEvent.requestPermission()`:

- **Ask from a tap.** iOS shows its question only when the method is called from a tap. Emit `requestPermission` and `start` from the same tap handler, as the shake example does. `start()` does not check the permission: it subscribes at once, and the readings begin once the user has allowed.
- **A refusal to ask is not a refusal by the user.** Called outside a tap, iOS rejects the call and shows nothing. `permissionState` then stays as it was — it changes only when the browser answers: `"granted"`, or `"denied"` for any other answer. The rejection lands in `error`, with `errorInfo.code: "not-allowed"` and `recoverable: true`, because a call from a tap can still be granted. Write "you refused" only for `permissionState: "denied"`.
- **The second visit.** After a reload `permissionState` is `"unknown"` again: the element keeps nothing between page loads, and iOS tells a page its answer only when the page asks, which needs a tap.
- **`<wcs-tilt>`'s question is a separate one.** `<wcs-tilt>` calls `DeviceOrientationEvent.requestPermission()`; this element calls `DeviceMotionEvent.requestPermission()`. A page that uses both emits both from one tap handler — bind both elements' `command.requestPermission` to the same token.

## CSS styling with `:state()`

`<wcs-gyroscope>` reflects one boolean output state onto its
[`ElementInternals` `CustomStateSet`](https://developer.mozilla.org/en-US/docs/Web/API/CustomStateSet),
so you can style it directly from CSS with the `:state()` pseudo-class — no
`data-wcs` binding or extra class toggling required. `<wcs-gyroscope>` has no
`loading`/`connected`-style boolean output (`start`/`stop` are synchronous
subscribe/unsubscribe toggles), so `error` is the only reflected state.

| State | On when |
|-------|---------|
| `error` | `wcs-gyroscope:error` fires with a non-`null` detail (cleared on `null`) |

```css
wcs-gyroscope:state(error) ~ .banner { display: block; }
```

Unlike attributes or classes, `:state()` cannot be written from outside the
element, so there is no risk of confusing this output state with an input.

Note that `error` is **sticky** (see Notes & limitations below): once set, it
stays on until the page is reloaded or you clear it yourself — a successful
`start()` does not turn it back off. Since 4.25, an answered `requestPermission()` clears it too.

**Browser support** (`:state(x)` syntax): Chrome/Edge 125+, Safari 17.4+,
Firefox 126+. In older browsers the states are simply never set — `:state()`
selectors never match, but `<wcs-gyroscope>` itself keeps working normally
(graceful degradation, never-throw).

**SSR**: `:state()` cannot be serialized into HTML, so server-rendered markup
never carries these states on first paint (`@wcstack/server` is unaffected).
If you need to style the pre-hydration gap, pair your rule with
`wcs-gyroscope:not(:defined)` instead.

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
  <wcs-gyroscope debug-states></wcs-gyroscope>
  ```

**Write your CSS against `:state()`, not `data-wcs-state-*`.** The mirrored
attribute exists purely to make state changes visible while debugging with
DevTools open; it is not a supported styling hook.

## Notes & limitations

- **No `_gen` generation guard.** `start()`/`stop()` are a synchronous subscribe/unsubscribe toggle with no asynchronous probe to race against a `dispose()` — see `docs/sensor-tag-design.md` §1.5. `requestPermission()` (since 4.25) does await the browser, but what it writes afterwards is a plain `permissionState` / `error` value — nothing a disconnect could race.
- **`error` is sticky.** It holds the last observed failure (e.g. `unsupported`, `SecurityError`) and is **not** auto-cleared by a later successful `start()` or by incoming `reading`s. A `stop()` + `start()` retry that succeeds still leaves the previous `error` in place — clear or reinterpret it in your own state if needed. Since 4.25 there is one exception: when the browser answers a `requestPermission()`, the previous `error` is cleared, as in `<wcs-tilt>`.
- **After an `error` event, `start()` works again.** Since 4.25, when the sensor reports its own `error` event (a `NotReadableError`, say), the failed sensor is torn down, so the next `start()` builds a fresh one. Up to 4.24 `start()` did nothing after such an error until `stop()` had been called, and nothing said so. `error` itself stays, as above.
- **`errorInfo` taxonomy.** An **additive** bindable output (`wcs-gyroscope:error-info-changed`) that classifies the same failure into a serializable `WcsIoErrorInfo` with a stable `code` / `phase` / `recoverable`, without changing the `error` shape. The mapping keys off the normalized error name: `unsupported` → `capability-missing` (phase `probe`); `SecurityError` / `NotAllowedError` → `not-allowed` (phase `start`); `NotReadableError` → `not-readable` (phase `execute`); any other sensor failure → `sensor-error` (phase `execute`). All are `recoverable: false`, with one exception since 4.25: a rejected `requestPermission()` (`NotAllowedError` — iOS did not ask, because the call was not in a tap) is `not-allowed` with `recoverable: true`, since a call from a tap can succeed. `errorInfo` transitions exactly when `error` does, so it is **sticky** in the same way and only returns to `null` when `error` does. The shared `WcsIoErrorInfo` type and the `WCS_GYROSCOPE_ERROR_CODE` constants are exported.
- **An unusable `frequency` is said.** Since 4.25, when `start()` runs with a `frequency` attribute that is not empty and is not a positive number (`frequency="60hz"`, `frequency="0"`), the console gets one warning per element: `[@wcstack/gyroscope] [wcs/frequency-invalid] <wcs-gyroscope> frequency="60hz" is not a positive number of Hz: the sensor runs at the browser's default rate. Write a number, e.g. frequency="30".` The sensor still starts, at the default rate — as it did before, without a word. A rate above what the browser allows is capped by the browser, and nothing says so.
- **`frequency` is read only at `start()`.** There is no `attributeChangedCallback`, and `start()` is idempotent while already started (a redundant call is a no-op — see Commands above), so changing the `frequency` attribute/property on a running sensor has no effect. To apply a new sampling rate, `stop()` then `start()` again.
- **Reparenting stops the sensor and does not resume it.** Moving a connected `<wcs-gyroscope>` element to a different parent runs `disconnectedCallback` → `connectedCallback`; since the Shell does not auto-start on connect (see Quick Start above), this is effectively a stop with no automatic restart. `x`/`y`/`z` freeze at their last sample, and no `error` is raised — the sensor stays inert until `start` is invoked again.
- **Never call the raw `new Gyroscope(...)` anywhere but the one guarded construction helper** — permission denial and Permissions-Policy blocks throw synchronously.
- Permission status (`granted`/`denied`/`prompt`) is intentionally not duplicated here — compose with `<wcs-permission name="gyroscope">`. `permissionState` (since 4.25) is only the answer to iOS's `DeviceMotionEvent.requestPermission()`, which no Permissions API entry reports.

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

Since 4.25, `core.supported` can be read at any time, `core.publishSupported()` dispatches `wcs-gyroscope:supported-changed` when the value differs from the last one dispatched, `await core.requestPermission()` asks where there is something to ask, and `core.start(frequency)` reads `devicemotion` where the `Gyroscope` class is missing.

The structural Core surface is normative across wcstack IO nodes ([async-io-node-guidelines §3.9](../../docs/async-io-node-guidelines.md)); to bind it into signals with no element at all, see [@wcstack/signals — Binding a Core directly](../signals/README.md#binding-a-core-directly-no-element).

## Accessibility

**WCAG 2.5.4 Motion Actuation (Level A)**: anything operated by rotating the device **must** also be operable without the motion, and the user must be able to disable the motion input — not every user can rotate a device, and involuntary movement turns rotation-rate input into noise. Give every motion-driven interaction a parallel input (keyboard, pointer, buttons) feeding the same code path, and expose a way to stop listening (the `stop` command). [`examples/state-tilt-maze`](https://github.com/wcstack/wcstack/tree/main/examples/state-tilt-maze) shows the shape with its sibling sensors.

## License

MIT
