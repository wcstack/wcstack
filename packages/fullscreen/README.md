# @wcstack/fullscreen

`@wcstack/fullscreen` is a headless Fullscreen API component for the wcstack ecosystem.

It is not a visual UI widget.
It is a **control node**: unlike most wcstack IO nodes (which act on themselves), `<wcs-fullscreen>` drives `requestFullscreen()` / `exitFullscreen()` on a *referenced* element — the same way `@wcstack/intersection` observes a referenced element rather than itself.

With `@wcstack/state`, `<wcs-fullscreen>` can be bound directly through path contracts:

- **input surface**: `target` (which element to operate on — see below)
- **output state surface**: `active`, `error`, `errorInfo`
- **commands**: `requestFullscreen()`, `exitFullscreen()`

`@wcstack/fullscreen` follows the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) (Core / Shell / Binding Contract) architecture:

- **Core** (`FullscreenCore`) drives the Fullscreen API and tracks `document`'s `fullscreenchange` event
- **Shell** (`<wcs-fullscreen target="...">`) resolves `target` to a DOM element and connects Core state to DOM lifecycle
- **Binding Contract** (`static wcBindable`) declares the observable `active` / `error` / `errorInfo` properties and the `requestFullscreen`/`exitFullscreen` commands

## Why this exists — you operate on the *target*, not on the tag itself

`Element.requestFullscreen()` is a method on the element you want to fullscreen — an image, a video, a card UI — not on `<wcs-fullscreen>` itself. So this tag is a non-visual control element (its `display` is set per target-resolution mode — see the table below) that points at another element via its `target` attribute, exactly like `<wcs-intersect>`:

| `target`        | operates on             | display     | typical use               |
| ---------------- | ------------------------ | ------------ | -------------------------- |
| omitted           | first element child      | `contents`   | wrap a gallery image/video |
| `"#hero"` / selector | the matched element   | `none`       | point at a distant node     |
| `"self"`           | the element itself        | `block`      | fullscreen the wrapper itself |

## Install

```bash
npm install @wcstack/fullscreen
```

## Quick Start

### 1. Fullscreen an image on button click

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/fullscreen/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["goFullscreen"],
    };
  </script>
</wcs-state>

<wcs-fullscreen target="#hero" data-wcs="command.requestFullscreen: $command.goFullscreen"></wcs-fullscreen>
<img id="hero" src="/photo.jpg">
<button data-wcs="onclick: $command.goFullscreen">Fullscreen</button>
```

The button never touches `<wcs-fullscreen>` directly: its click emits the `goFullscreen` command token, and `<wcs-fullscreen>` subscribes to that token via `command.requestFullscreen: $command.goFullscreen` (the [command-token protocol](../state/) — the element with the command method is the *subscriber*, not the emitter).

### 2. Wrap a video and show an exit button while active

```html
<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["exitFs"],
      isFullscreen: false,
    };
  </script>
</wcs-state>

<wcs-fullscreen data-wcs="active: isFullscreen; command.exitFullscreen: $command.exitFs">
  <video src="/movie.mp4" controls></video>
</wcs-fullscreen>
<button data-wcs="hidden: isFullscreen|not; onclick: $command.exitFs">Exit fullscreen</button>
```

Every bound state path must be declared up front — `isFullscreen: false` here; binding an undeclared path throws at initialization. Negation in a `data-wcs` path is done with the `|not` filter (`isFullscreen|not`), not a leading `!` — paths do not support prefix operators.

## Observable Properties (outputs)

| Property | Event                 | Description |
| --------- | ---------------------- | ------------ |
| `active`  | `wcs-fullscreen:change` | `true` while `document.fullscreenElement` is *this instance's resolved target*; `false` otherwise. |
| `error`   | `wcs-fullscreen:error` | The most recent failure: a rejected promise (e.g. a `TypeError` for a gesture-less call), `{ message: "Fullscreen API is not supported." }` when the platform API is missing, `{ message: "Fullscreen target could not be resolved." }` when `target` did not resolve to an element, or `null` if the last attempt succeeded / nothing has failed yet. |
| `errorInfo` | `wcs-fullscreen:error-info-changed` | Serializable failure taxonomy (`WcsIoErrorInfo`: stable `code` / `phase` / `recoverable`) derived from `error`, or `null`. Additive — the `error` value shape is unchanged. |

## Commands

| Command             | Async | Description |
| --------------------- | ------ | ------------ |
| `requestFullscreen()` | yes   | Resolve `target` and call `requestFullscreen()` on it. |
| `exitFullscreen()`     | yes   | Call `document.exitFullscreen()`. Silent no-op if nothing is currently fullscreen. |

## Attributes / Inputs

| Attribute | Description |
| ---------- | ------------ |
| `target`   | Same 3-mode resolution as `@wcstack/intersection`'s `target`: `"self"`, a CSS selector, or omitted (first child). |

## CSS styling with `:state()`

`<wcs-fullscreen>` reflects one boolean output state onto its
[`ElementInternals` `CustomStateSet`](https://developer.mozilla.org/en-US/docs/Web/API/CustomStateSet),
so you can style it directly from CSS with the `:state()` pseudo-class — no
`data-wcs` binding or extra class toggling required.

| State | On when |
|-------|---------|
| `active` | `wcs-fullscreen:change` fires with `detail.active === true` (cleared when `active: false`) |

`error` / `errorInfo` are observable (`data-wcs` bindable via their own events —
see the Observable Properties table above), but they are **not** reflected onto
`:state()`: a failure object is not a boolean state, so there is nothing for the
boolean `:state()` reflection to represent.

```css
wcs-fullscreen:state(active) ~ .exit-hint { display: block; }
wcs-fullscreen:state(active) ~ .exit-hint { display: none; } /* default */
```

Unlike attributes or classes, `:state()` cannot be written from outside the
element, so there is no risk of confusing this output state with an input.

**Browser support** (`:state(x)` syntax): Chrome/Edge 125+, Safari 17.4+,
Firefox 126+. In older browsers the states are simply never set — `:state()`
selectors never match, but `<wcs-fullscreen>` itself keeps working normally
(graceful degradation, never-throw).

**SSR**: `:state()` cannot be serialized into HTML, so server-rendered markup
never carries these states on first paint (`@wcstack/server` is unaffected).
If you need to style the pre-hydration gap, pair your rule with
`wcs-fullscreen:not(:defined)` instead.

### Debugging

Custom states are invisible in DevTools' Elements panel and `attachInternals()`
cannot be called twice, so there is no console way to inspect them directly.
Two debug-only aids are provided for that:

- `el.debugStates` — a **snapshot** array of the currently-on state names
  (e.g. `["active"]`). It is not part of `wc-bindable` (not a bind target)
  and its shape is not a guaranteed contract — use it for debugging only.
- The `debug-states` attribute (opt-in, default off) mirrors state changes
  onto a `data-wcs-state-active` attribute on the element, so the Elements
  panel highlights it as it toggles:

  ```html
  <wcs-fullscreen target="#hero" debug-states></wcs-fullscreen>
  ```

**Write your CSS against `:state()`, not `data-wcs-state-*`.** The mirrored
attribute exists purely to make state changes visible while debugging with
DevTools open; it is not a supported styling hook.

## Notes & limitations

- **User gesture requirement.** `requestFullscreen()` only succeeds when called synchronously from within a real user gesture (e.g. a click handler). This node cannot manufacture a gesture — if you invoke `requestFullscreen` via the command-token protocol (`command.requestFullscreen: $command.<token>` on `<wcs-fullscreen>`, emitted by a button's `onclick: $command.<token>`), make sure the *triggering* event itself is a genuine user gesture. Calling it from inside a `setTimeout` or deep in a promise chain will reject with a `TypeError` (per the WHATWG Fullscreen spec's transient-activation check — not `NotAllowedError`) regardless of how it was invoked — this is a browser-level constraint, not something wcstack can work around.
- **Vendor prefixes.** Some older Safari versions only implement `webkitRequestFullscreen` / `webkitExitFullscreen` / `webkitFullscreenElement` / `webkitfullscreenchange`. The Core probes the standard name first and falls back to the legacy name at *call time* (never cached), so both are supported transparently.
- **Multiple instances.** `document.fullscreenElement` is a single, document-wide value. If you have several `<wcs-fullscreen>` instances pointed at different targets, only the instance whose `target` matches `document.fullscreenElement` reports `active: true` — the others correctly report `false`. Each instance tracks *its own* resolved target internally; it does not simply mirror "is anything fullscreen". Note the asymmetry: `exitFullscreen()` is **not** scoped per instance — it calls the document-global `document.exitFullscreen()`, so invoking it on any instance exits whatever element is currently fullscreen, even one put there by another instance's `target` (its silent no-op check is likewise document-wide: "is anything fullscreen", not "is *my* target fullscreen"). This mirrors the platform API itself.
- **`exitFullscreen()` is a safe no-op.** Calling it when nothing is fullscreen (or when the API is unsupported) resolves without error — it is treated as an idempotent "make sure we're not fullscreen" command, not a failable precondition check.
- **`error` / `errorInfo` are observable (bindable).** Both are declared in `static wcBindable.properties` with their own events (`wcs-fullscreen:error` / `wcs-fullscreen:error-info-changed`), so a binding system can observe a request/exit failure reactively (`data-wcs="error: fsError; errorInfo: fsErrorInfo"`) — or you can still read `element.error` / `element.errorInfo` imperatively after a command's promise settles. `errorInfo` is the **additive** serializable failure taxonomy derived from `error`: a stable `WcsIoErrorInfo` (`code` / `phase` / `recoverable`) without changing the `error` value shape. A missing API (`"…is not supported."`) → `capability-missing` (phase `probe`); an unresolved `target` → `invalid-argument` (phase `start`); a gesture-less rejection (`TypeError` / `NotAllowedError`) → `not-allowed` (phase `execute`, `recoverable: true` — a retry from within a genuine user gesture may succeed); anything else → `fullscreen-error` (phase `execute`). `errorInfo` transitions exactly when `error` does (cleared to `null` on success); the `WcsIoErrorInfo` type and the `WCS_FULLSCREEN_ERROR_CODE` constants are exported.
- **`_gen` generation guard.** In-flight `requestFullscreen()`/`exitFullscreen()` calls that settle after `dispose()` (or after a superseding call) do not write to torn-down state.
- **SSR (`@wcstack/server`).** Declares `static hasConnectedCallbackPromise = true` and exposes `connectedCallbackPromise`, though since subscribing to `fullscreenchange` is synchronous this promise always settles immediately.

## Headless usage (`FullscreenCore`)

The Core has no DOM dependency beyond `document` and the target `Element` you pass it explicitly — it never resolves selectors itself:

```typescript
import { FullscreenCore } from "@wcstack/fullscreen";

const core = new FullscreenCore();
core.addEventListener("wcs-fullscreen:change", (e) => {
  console.log((e as CustomEvent).detail); // { active: true | false }
});

await core.observe();                 // subscribe to document's fullscreenchange
await core.requestFullscreen(myElement); // must be called from within a user gesture
console.log(core.active);              // true once fullscreenchange confirms it

await core.exitFullscreen();
core.dispose();                        // detach the fullscreenchange listener
```

## License

MIT
