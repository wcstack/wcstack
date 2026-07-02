# @wcstack/idle

`@wcstack/idle` is a headless Idle Detection component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns `IdleDetector`'s live user/screen state into reactive state, gated behind an explicit, gesture-driven permission command.

With `@wcstack/state`, `<wcs-idle>` can be bound directly through path contracts:

- **input surface**: `threshold` (ms, minimum 60000)
- **output state surface**: `userState`, `screenState`, `active`, `error`

## Why this exists — the reference implementation for gesture-gated permission

`IdleDetector.requestPermission()` is a **static method** that must be called from within a real user gesture. `connectedCallback` runs outside that context, so **this node never auto-starts on connect** — the caller drives `requestPermission()` → `start()` explicitly, typically from a click handler.

> **Compose with `@wcstack/permission`.** `navigator.permissions.query({name:"idle-detection"})` already exists — pair `<wcs-idle>` with `<wcs-permission name="idle-detection">` for `granted`/`denied`/`prompt` status. `<wcs-idle>` itself only exposes the actual idle state plus the one-time `requestPermission()` action; it does not duplicate the 4-value permission state.

> **Chromium-only.** Firefox and Safari do not implement `IdleDetector`.

## Install

```bash
npm install @wcstack/idle
```

## Quick Start

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/permission/auto"></script>
<script type="module" src="https://esm.run/@wcstack/idle/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      async enableIdleDetection() {
        const el = document.querySelector("wcs-idle");
        const result = await el.requestPermission();
        if (result === "granted") await el.start();
      },
    };
  </script>
</wcs-state>

<wcs-permission name="idle-detection" data-wcs="granted: idleGranted"></wcs-permission>
<wcs-idle threshold="60000" data-wcs="active: presenceActive"></wcs-idle>

<button data-wcs="onclick: enableIdleDetection">Enable presence detection</button>
<template data-wcs="if: !presenceActive">
  <span class="badge">Away</span>
</template>
```

## Observable Properties (outputs)

| Property      | Event            | Description |
| ------------- | ----------------- | ------------ |
| `userState`   | `wcs-idle:change`  | `"active"` \| `"idle"`, or `null` before `start()`. |
| `screenState` | `wcs-idle:change`  | `"locked"` \| `"unlocked"`, or `null` before `start()`. |
| `active`      | `wcs-idle:change`  | `true` when `userState === "active"`. |
| `error`       | `wcs-idle:error`   | The last `requestPermission()`/`start()` failure, or `null`. |

## Commands

| Command            | Async | Description |
| ------------------- | ----- | ------------ |
| `requestPermission` | yes   | Wraps the static, gesture-gated `IdleDetector.requestPermission()`. **Must be called from within a real user gesture handler.** Never-throw: a rejection resolves to `"denied"`. |
| `start`             | yes   | Begin an idle-detection session (`threshold` in ms, minimum 60000). Superseded by a later `start()`/`stop()`. |
| `stop`              | no    | Stop the current session. Safe to call when not started. |

## Attributes / Inputs

| Attribute   | Type   | Default | Description |
| ----------- | ------ | ------- | ------------ |
| `threshold` | number | `60000` | Minimum idle time (ms) before `userState` becomes `"idle"`. Not validated — an out-of-range value is left to the browser's own rejection. |

## Notes & limitations

- **Does not auto-start on connect.** See "Why this exists" above.
- **Does not duplicate permission state.** Compose with `<wcs-permission name="idle-detection">`.
- Chromium-only; `unsupported` (via `error`) is the default elsewhere.

## Headless usage (`IdleCore`)

```typescript
import { IdleCore } from "@wcstack/idle";

const core = new IdleCore();
core.addEventListener("wcs-idle:change", (e) => {
  console.log((e as CustomEvent).detail); // { userState, screenState }
});

// from within a real user gesture handler:
const result = await core.requestPermission();
if (result === "granted") await core.start(60000);

// later:
core.dispose();
```

## License

MIT
