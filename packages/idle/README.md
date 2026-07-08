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
      // Assume present until told otherwise: `wcs-idle:change` never fires
      // before start(), so a `false` default here would show "Away" on
      // every initial load even though presence is simply unknown yet.
      presenceActive: true,
      idleGranted: false,
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

<!-- Note: don't bind `disabled: idleGranted` here — the grant persists across
     page loads, so on a revisit the button would start out disabled and start()
     (only reachable through this click) could never run. Re-clicking when
     already granted is harmless: requestPermission() resolves "granted"
     immediately and start() proceeds. -->
<button data-wcs="onclick: enableIdleDetection">Enable presence detection</button>
<p>Permission granted: <span data-wcs="textContent: idleGranted"></span></p>
<template data-wcs="if: presenceActive|not">
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

## CSS styling with `:state()`

`<wcs-idle>` reflects two boolean output states onto its
[`ElementInternals` `CustomStateSet`](https://developer.mozilla.org/en-US/docs/Web/API/CustomStateSet),
so you can style it directly from CSS with the `:state()` pseudo-class — no
`data-wcs` binding or extra class toggling required.

| State | On when |
|-------|---------|
| `active` | `wcs-idle:change` fires with `detail.userState === "active"` (cleared when it becomes `"idle"`) |
| `error` | `wcs-idle:error` fires with a non-`null` detail (cleared on `null`) |

`screenState` has no derived boolean getter (§4.2), so it is not reflected in v1.

```css
wcs-idle:state(active) ~ .presence-dot { background: green; }
wcs-idle:not(:state(active)) ~ .presence-dot { background: gray; }

form:has(wcs-idle:state(error)) .banner { display: block; }
```

Unlike attributes or classes, `:state()` cannot be written from outside the
element, so there is no risk of confusing this output state with an input.

**Browser support** (`:state(x)` syntax): Chrome/Edge 125+, Safari 17.4+,
Firefox 126+. In older browsers the states are simply never set — `:state()`
selectors never match, but `<wcs-idle>` itself keeps working normally
(graceful degradation, never-throw).

**SSR**: `:state()` cannot be serialized into HTML, so server-rendered markup
never carries these states on first paint (`@wcstack/server` is unaffected).
If you need to style the pre-hydration gap, pair your rule with
`wcs-idle:not(:defined)` instead.

### Debugging

Custom states are invisible in DevTools' Elements panel and `attachInternals()`
cannot be called twice, so there is no console way to inspect them directly.
Two debug-only aids are provided for that:

- `el.debugStates` — a **snapshot** array of the currently-on state names
  (e.g. `["active"]`). It is not part of `wc-bindable` (not a bind target)
  and its shape is not a guaranteed contract — use it for debugging only.
- The `debug-states` attribute (opt-in, default off) mirrors state changes
  onto `data-wcs-state-active` / `data-wcs-state-error` attributes on the
  element, so the Elements panel highlights them as they toggle:

  ```html
  <wcs-idle debug-states></wcs-idle>
  ```

**Write your CSS against `:state()`, not `data-wcs-state-*`.** The mirrored
attributes exist purely to make state changes visible while debugging with
DevTools open; they are not a supported styling hook.

## Notes & limitations

- **Does not auto-start on connect.** See "Why this exists" above.
- **Does not duplicate permission state.** Compose with `<wcs-permission name="idle-detection">`.
- **Chromium-only, and secure-context-only.** Firefox and Safari do not implement `IdleDetector` at all. Even in Chromium, `IdleDetector` is a `[SecureContext]`-only interface, so over plain `http://` (other than `localhost`) `window.IdleDetector` itself is `undefined` — same as an unsupported browser, this falls into the `unsupported` (via `error`) path.
- **Permissions-Policy gate.** Idle detection is governed by the `idle-detection` Permissions-Policy directive (default allowlist: `self`). Using `<wcs-idle>` inside a cross-origin `<iframe>` requires `allow="idle-detection"` on that `<iframe>` element — otherwise `requestPermission()`/`start()` fail the same way as an unsupported browser.
- **`stop()`/disconnect does not reset `userState`/`screenState`/`active`.** They keep their last observed value until the next successful `start()` — the same "retain the last reading" behavior as the Generic Sensor family (`<wcs-gyroscope>` et al.).

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
