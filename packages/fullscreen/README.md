# @wcstack/fullscreen

`@wcstack/fullscreen` is a headless Fullscreen API component for the wcstack ecosystem.

It is not a visual UI widget.
It is a **control node**: unlike most wcstack IO nodes (which act on themselves), `<wcs-fullscreen>` drives `requestFullscreen()` / `exitFullscreen()` on a *referenced* element — the same way `@wcstack/intersection` observes a referenced element rather than itself.

With `@wcstack/state`, `<wcs-fullscreen>` can be bound directly through path contracts:

- **input surface**: `target` (which element to operate on — see below)
- **output state surface**: `active`, `error`
- **commands**: `requestFullscreen()`, `exitFullscreen()`

`@wcstack/fullscreen` follows the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) (Core / Shell / Binding Contract) architecture:

- **Core** (`FullscreenCore`) drives the Fullscreen API and tracks `document`'s `fullscreenchange` event
- **Shell** (`<wcs-fullscreen target="...">`) resolves `target` to a DOM element and connects Core state to DOM lifecycle
- **Binding Contract** (`static wcBindable`) declares the observable `active` property and the `requestFullscreen`/`exitFullscreen` commands

## Why this exists — you operate on the *target*, not on the tag itself

`Element.requestFullscreen()` is a method on the element you want to fullscreen — an image, a video, a card UI — not on `<wcs-fullscreen>` itself. So this tag is a non-visual control element (`display:none` by default) that points at another element via its `target` attribute, exactly like `<wcs-intersect>`:

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
    export default {};
  </script>
</wcs-state>

<wcs-fullscreen target="#hero" id="fs"></wcs-fullscreen>
<img id="hero" src="/photo.jpg">
<button command.click:$command.requestFullscreen $for="fs">Fullscreen</button>
```

### 2. Wrap a video and show an exit button while active

```html
<wcs-fullscreen data-wcs="active: isFullscreen">
  <video src="/movie.mp4" controls></video>
</wcs-fullscreen>
<button data-wcs="hidden: !isFullscreen" command.click:$command.exitFullscreen>Exit fullscreen</button>
```

## Observable Properties (outputs)

| Property | Event                 | Description |
| --------- | ---------------------- | ------------ |
| `active`  | `wcs-fullscreen:change` | `true` while `document.fullscreenElement` is *this instance's resolved target*; `false` otherwise. |
| `error`   | *(none — plain getter)* | The most recent failure (rejected promise, or `{ message }` for an unsupported API), or `null` if the last attempt succeeded / nothing has failed yet. |

## Commands

| Command             | Async | Description |
| --------------------- | ------ | ------------ |
| `requestFullscreen()` | yes   | Resolve `target` and call `requestFullscreen()` on it. |
| `exitFullscreen()`     | yes   | Call `document.exitFullscreen()`. Silent no-op if nothing is currently fullscreen. |

## Attributes / Inputs

| Attribute | Description |
| ---------- | ------------ |
| `target`   | Same 3-mode resolution as `@wcstack/intersection`'s `target`: `"self"`, a CSS selector, or omitted (first child). |

## Notes & limitations

- **User gesture requirement.** `requestFullscreen()` only succeeds when called synchronously from within a real user gesture (e.g. a click handler). This node cannot manufacture a gesture — if you invoke `requestFullscreen` via the command-token protocol (`command.click:$command.requestFullscreen`), make sure the *triggering* event itself is a genuine user gesture. Calling it from inside a `setTimeout` or deep in a promise chain will reject with `NotAllowedError` regardless of how it was invoked — this is a browser-level constraint, not something wcstack can work around.
- **Vendor prefixes.** Some older Safari versions only implement `webkitRequestFullscreen` / `webkitExitFullscreen` / `webkitFullscreenElement` / `webkitfullscreenchange`. The Core probes the standard name first and falls back to the legacy name at *call time* (never cached), so both are supported transparently.
- **Multiple instances.** `document.fullscreenElement` is a single, document-wide value. If you have several `<wcs-fullscreen>` instances pointed at different targets, only the instance whose `target` matches `document.fullscreenElement` reports `active: true` — the others correctly report `false`. Each instance tracks *its own* resolved target internally; it does not simply mirror "is anything fullscreen".
- **`exitFullscreen()` is a safe no-op.** Calling it when nothing is fullscreen (or when the API is unsupported) resolves without error — it is treated as an idempotent "make sure we're not fullscreen" command, not a failable precondition check.
- **`error` has no dedicated event.** Unlike most wcstack IO nodes, `error` is a plain getter with no `wcs-fullscreen:error` event of its own — read it after a command settles (or bind it directly; it changes alongside `active` whenever a command completes).
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
