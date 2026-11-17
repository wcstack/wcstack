# @wcstack/tilt

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/tilt` is a headless Device Orientation component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns device tilt (`deviceorientation`) into reactive state.

With `@wcstack/state`, `<wcs-tilt>` can be bound directly through path contracts:

- **input surface**: none
- **output state surface**: `alpha`, `beta`, `gamma`, `absolute`, `permissionState`, `error`, `errorInfo`, and — since 4.25 — `heading`, `supported`

## Why this exists — the iOS gesture-gate absorption sibling to `@wcstack/idle`

iOS 13+ Safari requires an explicit, gesture-gated `DeviceOrientationEvent.requestPermission()` before `deviceorientation` fires at all. Every other platform (Android Chrome, desktop) has no such gate. `<wcs-tilt>` absorbs this difference: `requestPermission()` resolves immediately to `"granted"` on ungated platforms, so callers can write **one** `requestPermission()` → `start()` flow that works everywhere.

> **`permissionState` is a 3-value vocabulary** (`"granted"` / `"denied"` / `"unknown"`) — deliberately distinct from the 4-value Permissions API state, since there is no `navigator.permissions.query()` entry for this feature. It is tracked locally, unlike `@wcstack/idle` (which composes with `@wcstack/permission`). It changes only when the browser answers; see [On an iPhone](#on-an-iphone).

> **Does not auto-start on connect** — same reasoning as `@wcstack/idle`: attempting to subscribe before permission is granted silently receives nothing on iOS.

> **Requires a secure context** (HTTPS or localhost).

## Install

```bash
npm install @wcstack/tilt
```

## Quick Start

```html
<script type="module" src="https://esm.run/@wcstack/tilt/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["enableTilt"],
      tiltBeta: null,
      tiltGamma: null,
      get tiltTransform() {
        return `rotate(${this.tiltBeta ?? 0}deg)`;
      },
    };
  </script>
</wcs-state>

<wcs-tilt data-wcs="beta: tiltBeta; gamma: tiltGamma;
                    command.requestPermission: $command.enableTilt; command.start: $command.enableTilt"></wcs-tilt>
<button data-wcs="onclick: $command.enableTilt">Enable tilt</button>
<div data-wcs="style.transform: tiltTransform"></div>
```

The button never touches `<wcs-tilt>`: its click emits the `enableTilt` command token (`$commandTokens: ["enableTilt"]` declares the name), and `<wcs-tilt>` subscribes to it twice — `requestPermission`, then `start`, in the order written. Both run inside the tap, which is where iOS wants the question asked. `start()` does not wait for the answer: it subscribes at once, and the readings begin when the browser sends them (on iOS, once the user has allowed).

Every path referenced by `data-wcs` (`tiltBeta`, `tiltGamma`, `tiltTransform`) must be declared on the state object, and every `$command` token in `$commandTokens` — an undeclared one fails when the bindings are attached. `tiltTransform` is a plain path getter (computed property, see `@wcstack/state`'s README) — `@wcstack/state` has no string-templating filter, so build the CSS string in a getter instead. It recomputes whenever `tiltBeta` changes.

### A compass (`heading`)

Since 4.25, `heading` is the direction the top of the device points, in degrees clockwise from north (0 = north, 90 = east), or `null` until the browser has said it.

```html
<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["ask", "start"],
      heading: null,
      tiltSupported: false,
      tiltPermission: "unknown",
      enableCompass() {
        // Both in the tap handler: iOS shows its question only from a tap.
        this.$command.ask.emit();
        this.$command.start.emit();
      },
      get needleTransform() {
        return `rotate(${-(this.heading ?? 0)}deg)`;
      },
      get headingText() {
        return this.heading === null ? "—" : `${Math.round(this.heading)}°`;
      },
    };
  </script>
</wcs-state>

<wcs-tilt data-wcs="heading: heading; supported: tiltSupported; permissionState: tiltPermission;
                    command.requestPermission: $command.ask; command.start: $command.start"></wcs-tilt>

<button data-wcs="hidden: tiltSupported|not; onclick: enableCompass">Show the compass</button>
<p data-wcs="hidden: tiltPermission|ne(denied)">Motion access was refused for this site.</p>
<div style="display: inline-block" data-wcs="style.transform: needleTransform">▲</div>
<output data-wcs="textContent: headingText"></output>
```

The needle turns against the device (`-heading`), so it keeps pointing north.

Where `heading` comes from, per event, in this order:

1. a `deviceorientation` event with a finite `webkitCompassHeading` (iOS Safari, where `alpha` is relative) → that number;
2. a `deviceorientationabsolute` event (Android Chrome, where `deviceorientation` is relative), or a `deviceorientation` event with `absolute: true`, with a finite `alpha` → `(360 - alpha) % 360`;
3. any other event leaves `heading` as it is.

`start()` subscribes to `deviceorientationabsolute` as well where the browser has it; that event writes `heading` only — `alpha` / `beta` / `gamma` / `absolute` keep coming from `deviceorientation`, as before. What `heading` is not:

- **Not corrected for the screen's rotation.** It is the device's top edge, not the screen's. In landscape add the screen's angle: bind `<wcs-screen-orientation>`'s `angle` and use `(heading + angle) % 360`.
- **Not tilt-compensated.** The `(360 - alpha)` form is accurate while the device is held roughly flat (screen up). Held upright, it is not the direction you are facing.
- **Magnetic north on iOS.** `webkitCompassHeading` is measured from magnetic north, not true north.
- **Not there on a browser or device that sends neither source**: `heading` stays `null`.

## Observable Properties (outputs)

| Property          | Event                      | Description |
| ----------------- | --------------------------- | ------------ |
| `alpha`           | `wcs-tilt:change`           | Z-axis rotation, or `null` before `start()`. |
| `beta`            | `wcs-tilt:change`           | X-axis rotation. |
| `gamma`           | `wcs-tilt:change`           | Y-axis rotation. |
| `absolute`        | `wcs-tilt:change`           | Whether the reading is relative to the Earth's frame. Reliability varies by browser — verify on your target devices. |
| `heading`         | `wcs-tilt:heading-changed`  | Since 4.25. Degrees clockwise from north of the direction the top of the device points, or `null` until known. The event's `detail` is the number. See [A compass](#a-compass-heading). |
| `permissionState` | `wcs-tilt:permission-changed` | `"granted"` \| `"denied"` \| `"unknown"`. What the browser answered to `requestPermission()`; `"unknown"` until it answers. |
| `error`           | `wcs-tilt:error`            | The last `requestPermission()` / `start()` failure (e.g. a rejection outside a tap, or no `DeviceOrientationEvent` in this browser), or `null`. never-throw: failures never reject/throw, they land here instead. |
| `errorInfo`       | `wcs-tilt:error-info-changed` | Serializable failure taxonomy (`WcsIoErrorInfo`: stable `code` / `phase` / `recoverable`) derived from `error`, or `null`. Additive — the `error` shape is unchanged. |
| `supported`       | `wcs-tilt:supported-changed` | Since 4.25. `true` when this page can use Device Orientation. The event's `detail` is the boolean. See [`supported`](#supported--can-this-page-use-it). |

`heading` and `wcs-tilt:change` are separate events: an event that carries north does not always carry new angles, and the other way round. Each is same-value guarded.

## Commands

| Command            | Async | Description |
| ------------------- | ----- | ------------ |
| `requestPermission` | yes   | On iOS, calls the gesture-gated static method (**must be invoked from within a real user gesture handler**). Where `DeviceOrientationEvent` has no such method (Android, desktop), resolves to `"granted"` immediately. Resolves to `permissionState` as it is after the call. Since 4.25: a rejection leaves `permissionState` unchanged, and a browser with no `DeviceOrientationEvent` at all is an `error` (`capability-missing`), not `"granted"`. |
| `start`             | no    | Subscribe to `deviceorientation` (and, since 4.25, to `deviceorientationabsolute` where the browser has it). Idempotent. It does not check the permission. Since 4.25: in a browser with no `DeviceOrientationEvent` it subscribes to nothing and sets `error` (`capability-missing`). |
| `stop`              | no    | Unsubscribe. Safe to call when not started. The outputs keep their last values. |

## `supported` — can this page use it

Since 4.25. `supported` is `true` when this page can use Device Orientation: `DeviceOrientationEvent` exists, the page is a secure context, and no Permissions-Policy turns `accelerometer` or `gyroscope` off for it (the server's header, or an `<iframe>` without `allow="accelerometer; gyroscope"` — Chromium sends no `deviceorientation` under one). Where it is `false`, no reading will ever come, and no tap can change that: do not offer the feature.

It does **not** say that the user will allow it (that is `permissionState`), and it **cannot say whether the device has a sensor**: a desktop PC has the API and no sensor, and is `supported: true`. A page finds that out by waiting: if `beta` is still `null` a couple of seconds after `start()` — on iOS, after `permissionState` became `"granted"` — there is no sensor (Chromium on a PC fires one event whose angles are all `null`, and then nothing). A `<wcs-timer interval="2000" once manual>` started by the same command token gives the page that moment.

The value is read from the browser each time it is asked for, so a binding gets the right value when it attaches; the element also dispatches `wcs-tilt:supported-changed` when it is connected, if the value differs from the last one it dispatched (it starts at `false`).

```html
<wcs-tilt data-wcs="supported: tiltSupported; command.requestPermission: $command.enableTilt; command.start: $command.enableTilt"></wcs-tilt>
<button data-wcs="hidden: tiltSupported|not; onclick: $command.enableTilt">Enable tilt</button>
```

(`tiltSupported: false` and `$commandTokens: ["enableTilt"]` on the state.)

## On an iPhone

**Ask from a tap.** Safari on an iPhone or iPad shows the motion question only when `DeviceOrientationEvent.requestPermission()` is called from a tap (a click handler; the examples above do that). Called from anywhere else — at page load, from a timer — iOS rejects the call with a `NotAllowedError` and shows nothing.

**A refusal to ask is not a refusal by the user.** Since 4.25, such a rejection leaves `permissionState` as it was — it changes only when the browser answers: `"granted"`, or `"denied"` for any other answer. The rejection lands in `error`, with `errorInfo.code: "not-allowed"` and `recoverable: true`, because a call from a tap can still be granted; the command's promise resolves to the unchanged `permissionState`. Up to 4.24 the rejection set `permissionState: "denied"` and `recoverable: false`, so a page told the user they had refused when they had never been asked. Write "you refused" only for `permissionState: "denied"`; for an `error` with `recoverable: true`, offer the button again.

**The second visit.** After a reload `permissionState` is `"unknown"` again. The element keeps nothing between page loads, and iOS tells a page its answer only when the page asks — which needs a tap. So a returning user starts at the same button. A page that wants to remember that this user has already allowed keeps its own note (for example with `<wcs-storage>`) to choose its wording, and still calls `requestPermission()` from a tap before it expects readings.

**Two gates.** iOS gates orientation and motion with two methods: `DeviceOrientationEvent.requestPermission()`, which `<wcs-tilt>` calls, and `DeviceMotionEvent.requestPermission()`, which `<wcs-accelerometer>` and `<wcs-gyroscope>` call since 4.25. Each element asks only for its own, and each has its own `permissionState`. A page that uses both asks both from one tap — one handler can emit both commands:

```html
<wcs-tilt data-wcs="command.requestPermission: $command.ask; command.start: $command.start"></wcs-tilt>
<wcs-accelerometer data-wcs="command.requestPermission: $command.ask; command.start: $command.start"></wcs-accelerometer>
<button data-wcs="onclick: enableMotion">Enable motion</button>
```

```js
export default {
  $commandTokens: ["ask", "start"],
  enableMotion() {
    this.$command.ask.emit();    // both elements' requestPermission(), inside the tap
    this.$command.start.emit();  // both elements' start()
  },
};
```

## Attributes / Inputs

**None.**

## CSS styling with `:state()`

`<wcs-tilt>` reflects one boolean output state onto its
[`ElementInternals` `CustomStateSet`](https://developer.mozilla.org/en-US/docs/Web/API/CustomStateSet),
so you can style it directly from CSS with the `:state()` pseudo-class — no
`data-wcs` binding or extra class toggling required. `alpha` / `beta` /
`gamma` / `permissionState` are not reflected: they are continuous-valued or
enum outputs with no matching derived boolean getter (guidelines §4.2), so
`error` is the only reflected state. `absolute` is likewise excluded — it can
only be derived from the continuous `wcs-tilt:change` stream, not from a
dedicated boolean event.

| State | On when |
|-------|---------|
| `error` | `wcs-tilt:error` fires with a non-`null` detail (cleared on `null`) |

```css
form:has(wcs-tilt:state(error)) .banner { display: block; }
```

Unlike attributes or classes, `:state()` cannot be written from outside the
element, so there is no risk of confusing this output state with an input.

**Browser support** (`:state(x)` syntax): Chrome/Edge 125+, Safari 17.4+,
Firefox 126+. In older browsers the states are simply never set — `:state()`
selectors never match, but `<wcs-tilt>` itself keeps working normally
(graceful degradation, never-throw).

**SSR**: `:state()` cannot be serialized into HTML, so server-rendered markup
never carries these states on first paint (`@wcstack/server` is unaffected).
If you need to style the pre-hydration gap, pair your rule with
`wcs-tilt:not(:defined)` instead.

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
  <wcs-tilt debug-states></wcs-tilt>
  ```

**Write your CSS against `:state()`, not `data-wcs-state-*`.** The mirrored
attribute exists purely to make state changes visible while debugging with
DevTools open; it is not a supported styling hook.

## Notes & limitations

- **Does not auto-start on connect.**
- **Does not compose with `@wcstack/permission`** (no matching Permissions API entry exists) — `permissionState` is tracked locally.
- **`errorInfo` taxonomy (additive).** Alongside `error`, `<wcs-tilt>` publishes a serializable `errorInfo` (`wcs-tilt:error-info-changed`) that classifies the *same* failure into a stable `WcsIoErrorInfo` (`code` / `phase` / `recoverable`), without changing the `error` shape (`{ error: <the rejection reason> }`). A rejected `requestPermission()` is classified by the reason's `Error.name`: a `NotAllowedError` (iOS did not ask, because the call was not in a tap) → `not-allowed` (phase `start`, `recoverable: true` since 4.25 — a call from a tap can succeed); anything else (another failure, a non-`Error` reason) → `tilt-error` (phase `execute`, `recoverable: false`). Since 4.25, a browser with no `DeviceOrientationEvent` at all — some desktop browsers — is `capability-missing` (phase `probe`, `recoverable: false`) from both `requestPermission()` and `start()`, with `error` as `{ error: { name: "unsupported", message: "DeviceOrientationEvent is not supported in this browser." } }`; up to 4.24 `requestPermission()` answered `"granted"` there and `start()` listened for an event that could not come. Where `DeviceOrientationEvent` exists without `requestPermission` (Android, desktop), `"granted"` at once is unchanged. `errorInfo` transitions exactly when `error` does (cleared to `null` when the browser answers); the shared `WcsIoErrorInfo` type and the `WCS_TILT_ERROR_CODE` constants are exported.
- No `_gen` generation guard: subscribing is fully synchronous.
- **On a non-secure origin (plain HTTP), `deviceorientation` never fires** — the browser suppresses it natively, so tilt values stay `null`, `wcs-tilt:change` never dispatches, and `permissionState` stays `"unknown"` (until you call `requestPermission()`). Calling `requestPermission()` cannot detect this: on gate-less platforms it resolves `"granted"` without probing anything. `supported` can — it is `false` on a non-secure origin. If nothing seems to happen, check your origin first.
- **Permissions-Policy gate.** The `deviceorientation` event is only dispatched when the `accelerometer` and `gyroscope` Permissions-Policy directives are allowed (default allowlist: `self`, per the Device Orientation Events spec §4). Using `<wcs-tilt>` inside a cross-origin `<iframe>` requires `allow="accelerometer; gyroscope"` on that `<iframe>` element — otherwise the event silently never fires, the same failure mode as the non-secure-origin case above. `supported` is `false` there where the browser lets a page read its policy (Chromium).
- **High-frequency stream.** `deviceorientation` can fire tens of times per second on many devices. `@wcstack/state` has no built-in debounce/throttle filter — if you need a coarser rate, relay through `@wcstack/debounce`'s value surface: `<wcs-tilt data-wcs="beta: tiltBeta">` then `<wcs-throttle wait="100" data-wcs="source: tiltBeta; value: throttledBeta"></wcs-throttle>` (see `@wcstack/debounce`'s README).
- **`stop()` and a disconnect keep the last values.** `alpha` / `beta` / `gamma` / `absolute` / `heading` are not reset; they are simply no longer updated.

## Headless usage (`TiltCore`)

```typescript
import { TiltCore } from "@wcstack/tilt";

const core = new TiltCore();
core.addEventListener("wcs-tilt:change", (e) => {
  console.log((e as CustomEvent).detail); // { alpha, beta, gamma, absolute }
});
core.addEventListener("wcs-tilt:heading-changed", (e) => {
  console.log((e as CustomEvent).detail); // degrees clockwise from north
});

await core.requestPermission();
core.start();
// later:
core.dispose();
```

Since 4.25, `core.supported` can be read at any time, and `core.observe()` (or `core.publishSupported()`) dispatches `wcs-tilt:supported-changed` when the value differs from the last one dispatched.

The structural Core surface is normative across wcstack IO nodes ([async-io-node-guidelines §3.9](../../docs/async-io-node-guidelines.md)); to bind it into signals with no element at all, see [@wcstack/signals — Binding a Core directly](../signals/README.md#binding-a-core-directly-no-element).

## Accessibility

**WCAG 2.5.4 Motion Actuation (Level A)**: anything operated by moving the device **must** also be operable without moving it, and the user must be able to disable the motion input. Not everyone can tilt a phone — devices get mounted on wheelchairs, and tremors turn tilt input into noise. Concretely: every tilt-driven interaction needs a parallel input (keyboard, pointer, buttons) feeding the same code path, plus a way to stop reacting to the sensor (the `stop` command is exactly that). [`examples/state-tilt-maze`](https://github.com/wcstack/wcstack/tree/main/examples/state-tilt-maze) is the reference shape: arrow keys and pointer drag ride the same simulated-tilt channel as the sensor, so the game logic never knows which input is active.

## License

MIT
