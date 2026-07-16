# @wcstack/wakelock

`@wcstack/wakelock` is a headless Screen Wake Lock component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** — but, unlike every other @wcstack sensor, it runs *the other way*. `@wcstack/geolocation`, `@wcstack/intersection`, and friends are **producers** (`element → state`): they turn a device signal into reactive state. `@wcstack/wakelock` is a **pure sink** (`state → element`): a bound boolean drives whether the screen is kept awake.

With `@wcstack/state`, `<wcs-wakelock>` reads as one declarative line:

```html
<wcs-wakelock data-wcs="active: isPlaying"></wcs-wakelock>
```

*"Keep the screen awake **while** `isPlaying` is true."* No `navigator.wakeLock.request()`, no `visibilitychange` re-acquire glue, no teardown.

- **input surface**: `active`, `type`, `manual`
- **output state surface**: `held`, `error`, `errorInfo`
- **commands**: `request()`, `release()`

`@wcstack/wakelock` follows the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) (Core / Shell / Binding Contract) architecture:

- **Core** (`WakeLockCore`) owns the sentinel, the desired/actual split, the auto-release re-acquire loop, and never-throw failure handling
- **Shell** (`<wcs-wakelock>`) maps the `active` attribute to `request()` / `release()` and manages lifecycle
- **Binding Contract** (`static wcBindable`) declares observable `properties`, writable `inputs`, and callable `commands`

## Why this exists

The Screen Wake Lock API has an awkward edge: the OS **automatically releases** the lock the moment the page stops being visible (tab hidden, window minimized). To actually "keep the screen awake while playing", you must hold the desired intent yourself and re-acquire the lock every time the page becomes visible again.

`@wcstack/wakelock` moves that lease management into the component. You bind a boolean; the component keeps the lock alive across visibility changes for as long as the boolean is true.

## Desired (`active`) vs actual (`held`)

Because of auto-release, *what you want* and *what is currently held* diverge — so they are two separate surfaces:

| Surface  | Direction        | Meaning |
|----------|------------------|---------|
| `active` | input            | **Desired intent.** Hold the lock while `true`. Survives an OS auto-release. |
| `held`   | output           | **Actual state.** Whether a sentinel is held *right now*. Flips to `false` on auto-release, back to `true` when the page is visible again. |

`active` is deliberately **not** an observable output: it does not change when the OS drops the lock — only `held` does. Bind `held` if your UI needs to reflect the live "screen is being kept awake" state.

## Install

```bash
npm install @wcstack/wakelock
```

## Quick Start

### Keep the screen awake during video playback

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/wakelock/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      playing: false,
      startPlaying() { this.playing = true; },
      stopPlaying() { this.playing = false; },
    };
  </script>

  <video
    src="/movie.mp4"
    data-wcs="onplay: startPlaying; onpause: stopPlaying"
  ></video>

  <!-- Lock is held only while `playing` is true, and survives tab switches. -->
  <wcs-wakelock data-wcs="active: playing"></wcs-wakelock>
</wcs-state>
```

### Reflect the actual lock state in the UI

```html
<wcs-wakelock data-wcs="active: keepAwake; held: screenLocked"></wcs-wakelock>

<span data-wcs="textContent: screenLocked"></span>
```

### Command-driven (imperative)

```html
<wcs-wakelock data-wcs="command.request: $command.stayAwake"></wcs-wakelock>
```

> **Commands do not mirror the `active` attribute.** The `request` / `release`
> commands flip the desired intent on the Core directly without touching the
> `active` attribute, so the element's `active` property (an attribute mirror) can
> read `false` while `held` is `true` (or vice versa) after a command. Don't mix
> command-driven control with `active` attribute binding on the same element —
> pick one. Bind via `active: ...` for a single source of truth.

## Attributes

| Attribute | Type    | Default  | Description |
|-----------|---------|----------|-------------|
| `active`  | boolean | `false`  | Desired intent: hold the screen awake while present. The headline binding (`active: isPlaying`). |
| `type`    | string  | `screen` | Lock type. Only `screen` is standardized; the attribute exists for forward compatibility. |
| `manual`  | boolean | `false`  | Do not auto-acquire on connect even if `active` is present; drive via `request()` / `release()` instead. |

> **`manual` is a connect-time policy, not a live switch.** Removing the `manual` attribute *after* connect does not auto-acquire — toggle `active` or call `request()`. (A live `active` toggle always drives request/release regardless of `manual`.)

## Output state

| Property | Type             | Description |
|----------|------------------|-------------|
| `held`   | `boolean`        | Whether a wake lock sentinel is currently held. Reflects OS auto-release and re-acquisition. |
| `error`  | `Error \| null`  | The last request failure (e.g. denied, unsupported), or `null`. |
| `errorInfo` | `WcsIoErrorInfo \| null` | Serializable failure taxonomy (stable `code` / `phase` / `recoverable`) derived from `error`, or `null`. Additive — the `error` shape is unchanged. |

> **`wcs-wakelock:error` is a property-change notification** (wc-bindable model), not just a failure signal: it fires with `detail` = the Error on a failed request, and fires again with `detail = null` when a later request succeeds and the `error` property is cleared. Read `error == null` as "no error *right now*", not "an error never happened".

## Commands

| Command     | Description |
|-------------|-------------|
| `request()` | Mark the lock desired and acquire it (if visible & supported). Never rejects — see `error`. |
| `release()` | Mark the lock no longer desired and release any held sentinel. |

## CSS styling with `:state()`

`<wcs-wakelock>` reflects two boolean output states onto its
[`ElementInternals` `CustomStateSet`](https://developer.mozilla.org/en-US/docs/Web/API/CustomStateSet),
so you can style it directly from CSS with the `:state()` pseudo-class — no
`data-wcs` binding or extra class toggling required.

| State | On when |
|-------|---------|
| `held` | `wcs-wakelock:held-changed` fires with `true` (cleared on `false`) |
| `error` | `wcs-wakelock:error` fires with a non-`null` detail (cleared on `null`) |

```css
wcs-wakelock:state(held) ~ .awake-indicator { display: block; }
wcs-wakelock:state(held) ~ .awake-indicator { display: none; } /* default */

form:has(wcs-wakelock:state(error)) .banner { display: block; }
```

Unlike attributes or classes, `:state()` cannot be written from outside the
element, so there is no risk of confusing this output state with an input.

**Browser support** (`:state(x)` syntax): Chrome/Edge 125+, Safari 17.4+,
Firefox 126+. In older browsers the states are simply never set — `:state()`
selectors never match, but `<wcs-wakelock>` itself keeps working normally
(graceful degradation, never-throw).

**SSR**: `:state()` cannot be serialized into HTML, so server-rendered markup
never carries these states on first paint (`@wcstack/server` is unaffected).
If you need to style the pre-hydration gap, pair your rule with
`wcs-wakelock:not(:defined)` instead.

### Debugging

Custom states are invisible in DevTools' Elements panel and `attachInternals()`
cannot be called twice, so there is no console way to inspect them directly.
Two debug-only aids are provided for that:

- `el.debugStates` — a **snapshot** array of the currently-on state names
  (e.g. `["held"]`). It is not part of `wc-bindable` (not a bind target)
  and its shape is not a guaranteed contract — use it for debugging only.
- The `debug-states` attribute (opt-in, default off) mirrors state changes
  onto `data-wcs-state-held` / `data-wcs-state-error` attributes on the
  element, so the Elements panel highlights them as they toggle:

  ```html
  <wcs-wakelock data-wcs="active: isPlaying" debug-states></wcs-wakelock>
  ```

**Write your CSS against `:state()`, not `data-wcs-state-*`.** The mirrored
attributes exist purely to make state changes visible while debugging with
DevTools open; they are not a supported styling hook.

## Binding Contract (`wcBindable`)

Both the Core and the Shell declare the [wc-bindable](https://github.com/csbc-dev) protocol.

```js
// WakeLockCore (headless)
WakeLockCore.wcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "held", event: "wcs-wakelock:held-changed" },
    { name: "error", event: "wcs-wakelock:error" },
    { name: "errorInfo", event: "wcs-wakelock:error-info-changed" },
  ],
  commands: [
    { name: "request", async: true }, { name: "release" },
  ],
};
```

The Shell (`<wcs-wakelock>`) inherits the Core's `properties` / `commands` and declares the DOM-driven `inputs` (`active`, `type`, `manual`).

## Using the Core standalone

`WakeLockCore` is framework-agnostic and can be used without the custom element:

```js
import { WakeLockCore } from "@wcstack/wakelock";

const core = new WakeLockCore();
core.addEventListener("wcs-wakelock:held-changed", (e) => {
  console.log("screen awake:", e.detail);
});

await core.request();   // acquire (and keep across visibility changes)
// later
core.release();         // stop keeping awake
core.dispose();         // remove the visibilitychange listener
```

When you drive the Core directly, call `dispose()` when you are done so its
`visibilitychange` listener is removed.

## Notes & limitations

- **Sink, not producer.** Unlike the other @wcstack sensors, the wake lock is driven *by* state (`state → element`). `held` is the only thing it produces back.
- **Auto-release is handled for you.** The OS may drop the lock for several reasons — the page being hidden, but also battery-low or power-saver mode while the page stays visible. The component renews the lease in both cases: a release while *visible* is re-acquired immediately, and a release while *hidden* is re-acquired on the next return to visibility — as long as `active` is still set. The binding means "keep awake *while* active", not "acquire once". A **denied** re-acquire does not loop — it surfaces via `error` and stays quiet (the dominant case: the spec rejects re-requests under battery-low / power-saver). A **granted** re-acquire renews the lease, so if the OS keeps granting and releasing, the component keeps renewing (one request per release, driven by the OS, not a synchronous spin).
- **Secure context (HTTPS).** The Screen Wake Lock API only works in a secure context (HTTPS, or `localhost`).
- **Never throws.** An unsupported environment is a silent no-op (`held` stays `false`); a rejected request surfaces via the `error` property rather than throwing. `request()` never rejects.
- **`errorInfo` taxonomy (additive).** Alongside `error`, `<wcs-wakelock>` publishes a serializable `errorInfo` (`wcs-wakelock:error-info-changed`) that classifies the *same* failure into a stable `WcsIoErrorInfo` (`code` / `phase` / `recoverable`), without changing the `error` shape. A rejected `request()` is classified by its `Error.name`: a `NotAllowedError` (page not visible, or a permission / feature-policy block) → `not-allowed` (phase `start`); anything else (e.g. a normalized non-`Error` rejection) → `wakelock-error` (phase `execute`). Both are `recoverable: false`. There is **no** `capability-missing` code: an unsupported environment is a silent no-op (`held` stays `false`, `error` unset), so that branch is unreachable. `errorInfo` transitions exactly when `error` does (cleared to `null` on a later success); the shared `WcsIoErrorInfo` type and the `WCS_WAKELOCK_ERROR_CODE` constants are exported.
- **No permission gate.** There is no separate permission prompt (a request may still be denied if the page is not visible — that surfaces as `error`).

## License

MIT
