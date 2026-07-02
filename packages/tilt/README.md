# @wcstack/tilt

`@wcstack/tilt` is a headless Device Orientation component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns device tilt (`deviceorientation`) into reactive state.

With `@wcstack/state`, `<wcs-tilt>` can be bound directly through path contracts:

- **input surface**: none
- **output state surface**: `alpha`, `beta`, `gamma`, `absolute`, `permissionState`

## Why this exists — the iOS gesture-gate absorption sibling to `@wcstack/idle`

iOS 13+ Safari requires an explicit, gesture-gated `DeviceOrientationEvent.requestPermission()` before `deviceorientation` fires at all. Every other platform (Android Chrome, desktop) has no such gate. `<wcs-tilt>` absorbs this difference: `requestPermission()` resolves immediately to `"granted"` on ungated platforms, so callers can write **one** `requestPermission()` → `start()` flow that works everywhere.

> **`permissionState` is a 3-value vocabulary** (`"granted"` / `"denied"` / `"unknown"`) — deliberately distinct from the 4-value Permissions API state, since there is no `navigator.permissions.query()` entry for this feature. It is tracked locally, unlike `@wcstack/idle` (which composes with `@wcstack/permission`).

> **Does not auto-start on connect** — same reasoning as `@wcstack/idle`: attempting to subscribe before permission is granted silently receives nothing on iOS.

> **Requires a secure context** (HTTPS or localhost).

## Install

```bash
npm install @wcstack/tilt
```

## Quick Start

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/tilt/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      async enableTilt() {
        const el = document.querySelector("wcs-tilt");
        const result = await el.requestPermission();
        if (result === "granted") el.start();
      },
    };
  </script>
</wcs-state>

<wcs-tilt data-wcs="beta: tiltBeta; gamma: tiltGamma"></wcs-tilt>
<button data-wcs="onclick: enableTilt">Enable tilt</button>
<div data-wcs="style.transform: tiltBeta|tpl('rotate(${0}deg)')"></div>
```

## Observable Properties (outputs)

| Property          | Event                      | Description |
| ----------------- | --------------------------- | ------------ |
| `alpha`           | `wcs-tilt:change`           | Z-axis rotation, or `null` before `start()`. |
| `beta`            | `wcs-tilt:change`           | X-axis rotation. |
| `gamma`           | `wcs-tilt:change`           | Y-axis rotation. |
| `absolute`        | `wcs-tilt:change`           | Whether the reading is relative to the Earth's frame. Reliability varies by browser — verify on your target devices. |
| `permissionState` | `wcs-tilt:permission-changed` | `"granted"` \| `"denied"` \| `"unknown"`. |

## Commands

| Command            | Async | Description |
| ------------------- | ----- | ------------ |
| `requestPermission` | yes   | On iOS, calls the gesture-gated static method (**must be invoked from within a real user gesture handler**). On every other platform, resolves to `"granted"` immediately. |
| `start`             | no    | Subscribe to `deviceorientation`. Idempotent. |
| `stop`              | no    | Unsubscribe. Safe to call when not started. |

## Attributes / Inputs

**None.**

## Notes & limitations

- **Does not auto-start on connect.**
- **Does not compose with `@wcstack/permission`** (no matching Permissions API entry exists) — `permissionState` is tracked locally.
- No `_gen` generation guard: subscribing is fully synchronous.

## Headless usage (`TiltCore`)

```typescript
import { TiltCore } from "@wcstack/tilt";

const core = new TiltCore();
core.addEventListener("wcs-tilt:change", (e) => {
  console.log((e as CustomEvent).detail); // { alpha, beta, gamma, absolute }
});

await core.requestPermission();
core.start();
// later:
core.dispose();
```

## License

MIT
