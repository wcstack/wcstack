# @wcstack/eyedropper

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/eyedropper` is a headless EyeDropper API component for the wcstack ecosystem.

It is not a visual UI widget.
It turns `new EyeDropper().open()` — the browser's native color-picking cursor — into reactive state, so a "pick a color from the screen" button can be wired up declaratively instead of with imperative `addEventListener`/`try...catch` glue.

With `@wcstack/state`, `<wcs-eyedropper>` can be bound directly through path contracts:

- **command surface**: `open()` — invoke via `command.open:` / `$command.<name>`; `abort()` — invoke via `command.abort:` / `$command.<name>`
- **output state surface**: `value` (the picked color), `loading`, `error`, `cancelled`

`@wcstack/eyedropper` follows the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) (Core / Shell / Binding Contract) architecture:

- **Core** (`EyedropperCore`) wraps `new EyeDropper().open(options)`
- **Shell** (`<wcs-eyedropper>`) connects that state to DOM lifecycle and the command-token protocol
- **Binding Contract** (`static wcBindable`) declares observable `properties` and the `open`/`abort` commands

## Why this exists — the same archetype as `@wcstack/share`, plus `abort`

`<wcs-eyedropper>` shares its architecture with [`@wcstack/share`](https://www.npmjs.com/package/@wcstack/share): a state-thin, command-only node built on a simplified derivative of `FetchCore._doFetch` (see `docs/eyedropper-tag-design.md` and `docs/web-share-tag-design.md` §2) — single `_gen` generation guard, same-value-guarded private setters, never-throw try/catch.

The one deliberate difference: **`EyeDropper.open()` accepts a `{signal}` `AbortSignal` option**, unlike `navigator.share()`. This gives a caller a real platform mechanism to cancel an in-flight color pick, so this Core restores `AbortController`/`abort()` from `FetchCore` (packages/fetch/src/core/FetchCore.ts), including the identity check on the locally-held controller in the `finally` block that keeps a fast `abort()` → `open()` sequence from letting a stale controller null out the new call's controller.

Both the user dismissing the picker with <kbd>Escape</kbd> and the caller invoking `abort()` reject `open()` with the same `AbortError` — both land on `cancelled` without distinction. There is no need to tell them apart: either way, "the pick did not complete."

## Chromium-only, desktop-oriented

As of 2026, the EyeDropper API is implemented only in Chromium-based browsers (Chrome, Edge, Opera, ...) — Firefox and Safari do not support it. Picking an arbitrary on-screen pixel is also not meaningful in a touch context (precise pixel-level pointing is impractical with a finger, and mobile Chrome does not implement the API). Design your UI around this as a **desktop-only, progressive-enhancement feature**: hide the "pick a color" button (or offer a fallback `<input type="color">`) when `error` fires immediately on first use, rather than assuming the API is universally available.

## Install

```bash
npm install @wcstack/eyedropper
```

## Quick Start

### 1. A color-picker button

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/eyedropper/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["open"],
      pickColor() {
        this.$command.open.emit();
      },
    };
  </script>
</wcs-state>

<wcs-eyedropper data-wcs="command.open: $command.open"></wcs-eyedropper>

<button id="pick-button" data-wcs="onclick: pickColor">Pick a color</button>
```

### 2. Reflecting the picked color, and cancelling

```html
<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["open", "abort"],
      pickedColor: null,
      picking: false,
      pickError: null,
      // pickedColor stays null until the first successful pick, so bind the
      // hex through a null-safe computed getter (binding a raw
      // pickedColor.sRGBHex path would traverse into null before any pick).
      get pickedHex() {
        return this.pickedColor?.sRGBHex ?? "";
      },
      pickColor() {
        this.$command.open.emit();
      },
      cancelPick() {
        this.$command.abort.emit();
      },
    };
  </script>
</wcs-state>

<wcs-eyedropper
  data-wcs="command.open: $command.open; command.abort: $command.abort; value: pickedColor; loading: picking; error: pickError"
></wcs-eyedropper>

<button data-wcs="onclick: pickColor; disabled: picking">
  Pick a color
</button>
<button data-wcs="onclick: cancelPick; hidden: picking|not">Cancel</button>

<div data-wcs="style.backgroundColor: pickedHex"></div>
<p data-wcs="hidden: pickError|falsy">Something went wrong.</p>
```

### 3. Hiding the button on unsupported browsers

`<wcs-eyedropper>` has no dedicated `supported` flag — check `typeof EyeDropper` directly, or simply attempt `open()` and react to the immediate `error`:

```html
<script type="module">
  const supported = typeof EyeDropper !== "undefined";
  // #pick-button is the "Pick a color" button from example 1.
  document.querySelector("#pick-button").hidden = !supported;
  // On unsupported mobile/Firefox/Safari, offer a fallback <input type="color"> instead.
</script>
```

## Observable Properties (outputs)

| Property    | Event                              | Description |
| ----------- | ----------------------------------- | ------------ |
| `value`     | `wcs-eyedropper:complete`           | The platform's own result object, `{ sRGBHex: string }`, used verbatim — no synthesis needed (unlike `@wcstack/share`'s `value`, which echoes the caller's input). `null` before any successful pick. |
| `loading`   | `wcs-eyedropper:loading-changed`    | `true` while the eyedropper cursor is active (an `open()` call is in flight). |
| `error`     | `wcs-eyedropper:error`              | A true platform failure (anything other than the picker being dismissed). `null` when there has been no failure yet, or after the next `open()` call resets it. |
| `cancelled` | `wcs-eyedropper:cancelled-changed`  | `true` when the pick did not complete — either the user pressed Escape, or the caller invoked `abort()`. Both surface as the same `AbortError` and are not distinguished. |
| `errorInfo` | `wcs-eyedropper:error-info-changed` | Serializable failure taxonomy (stable `code` / `phase` / `recoverable`), or `null`. Additive — the `error` shape is unchanged; `code` is `capability-missing` when unsupported or `pick-failed` on a genuine failure. Cancellation is `cancelled`, not `errorInfo`. |

`cancelled` and `error` are both reset (`false` / `null`) at the **start** of the next `open()` call, so a stale outcome from a previous call never lingers into the next one's result.

**Concurrency.** `EyeDropper.open()` accepts an `AbortSignal`, so `<wcs-eyedropper>`
runs its calls through the shared io-core lane with the `latest` policy (like
`<wcs-fetch>`): a new `open()` **supersedes** the in-flight one (aborting it), and
the `abort()` command cancels the active pick.

## Commands

| Command | Async | Description |
| ------- | ----- | ------------ |
| `open`  | Yes   | Calls `new EyeDropper().open({ signal })`. Takes **no arguments** — the `{signal}` option is supplied internally by the Core's own `AbortController`, never via the command-token surface. |
| `abort` | No    | Cancels the in-flight `open()` call, if any (no-op otherwise). Rejects the pending `open()` with `AbortError`, landing on `cancelled`. |

## Attributes / Inputs

**None.** `open()` takes no per-call configuration — there is nothing to park on the element ahead of time.

## Notes & limitations

- **Chromium-only, desktop-oriented.** See above. Firefox and Safari do not implement `EyeDropper` as of 2026, and it has no meaningful touch-input equivalent.
- **`abort()` cancels an in-flight `open()`.** Both a user pressing Escape and a caller-invoked `abort()` resolve to the same `cancelled` outcome — there is no way (and no need) to distinguish them.
- **One eyedropper at a time (platform-global).** The spec's `InvalidStateError` is a global exclusion — if another eye dropper is already open (a second `<wcs-eyedropper>` instance, or another tab), `open()` rejects with it and lands on `error` (not `cancelled`). Within a single instance this never fires: a new `open()` first aborts the previous in-flight pick.
- **Fast `abort()` → `open()` sequences do not cross-wire `AbortController`s.** A new `open()` call aborts any previous in-flight call and issues a fresh `AbortController`; the previous call's cleanup only clears the field it still owns (mirrors `FetchCore`'s identity check).
- **Unsupported detection.** There is no `supported` flag. `open()` checks `typeof EyeDropper === "function"` at call time and, if absent, sets `error` immediately (`_gen` is not advanced — no asynchronous work is started, and `new EyeDropper()` is never constructed).
- **`_gen` generation guard.** An `open()` call that settles after `dispose()` (e.g. a fast disconnect while the picker is active) is stale and does not write state to a torn-down element.
- **No `autoTrigger`.** Like `@wcstack/share`, `open()` must be invoked from within a user-gesture context; wire the click handler directly to `$command.open.emit()`.
- **SSR (`@wcstack/server`).** Declares `static hasConnectedCallbackPromise = true` and exposes `connectedCallbackPromise`; since there is no asynchronous probe to await, it always settles immediately.
- **Same-value guard.** `value`/`loading`/`error`/`cancelled` setters only dispatch when the value actually changes.

## CSS styling with `:state()`

`<wcs-eyedropper>` reflects three boolean output states onto its
[`ElementInternals` `CustomStateSet`](https://developer.mozilla.org/en-US/docs/Web/API/CustomStateSet),
so you can style it directly from CSS with the `:state()` pseudo-class — no
`data-wcs` binding or extra class toggling required.

| State | On when |
|-------|---------|
| `loading` | `wcs-eyedropper:loading-changed` fires with `true` (cleared on `false`) |
| `cancelled` | `wcs-eyedropper:cancelled-changed` fires with `true` (cleared on `false`) |
| `error` | `wcs-eyedropper:error` fires with a non-`null` detail (cleared on `null`) |

```css
wcs-eyedropper:state(loading) ~ .cursor-hint { display: block; }

form:has(wcs-eyedropper:state(cancelled)) .cancelled-banner { display: block; }
form:has(wcs-eyedropper:state(error)) .error-banner { display: block; }
```

Unlike attributes or classes, `:state()` cannot be written from outside the
element, so there is no risk of confusing this output state with an input.

**Browser support** (`:state(x)` syntax): Chrome/Edge 125+, Safari 17.4+,
Firefox 126+. In older browsers the states are simply never set — `:state()`
selectors never match, but `<wcs-eyedropper>` itself keeps working normally
(graceful degradation, never-throw).

**SSR**: `:state()` cannot be serialized into HTML, so server-rendered markup
never carries these states on first paint (`@wcstack/server` is unaffected).
If you need to style the pre-hydration gap, pair your rule with
`wcs-eyedropper:not(:defined)` instead.

### Debugging

Custom states are invisible in DevTools' Elements panel and `attachInternals()`
cannot be called twice, so there is no console way to inspect them directly.
Two debug-only aids are provided for that:

- `el.debugStates` — a **snapshot** array of the currently-on state names
  (e.g. `["loading"]`). It is not part of `wc-bindable` (not a bind target)
  and its shape is not a guaranteed contract — use it for debugging only.
- The `debug-states` attribute (opt-in, default off) mirrors state changes
  onto `data-wcs-state-loading` / `data-wcs-state-cancelled` /
  `data-wcs-state-error` attributes on the element, so the Elements panel
  highlights them as they toggle:

  ```html
  <wcs-eyedropper debug-states></wcs-eyedropper>
  ```

**Write your CSS against `:state()`, not `data-wcs-state-*`.** The mirrored
attributes exist purely to make state changes visible while debugging with
DevTools open; they are not a supported styling hook.

## Headless usage (`EyedropperCore`)

The Core has no DOM dependency and can be used directly with `bind()` from `@wc-bindable/core`:

```typescript
import { EyedropperCore } from "@wcstack/eyedropper";

const eyedropper = new EyedropperCore();
eyedropper.addEventListener("wcs-eyedropper:complete", (e) => {
  console.log((e as CustomEvent).detail.value); // { sRGBHex: "#aabbcc" }
});
eyedropper.addEventListener("wcs-eyedropper:cancelled-changed", (e) => {
  console.log("cancelled:", (e as CustomEvent).detail);
});

const result = await eyedropper.open();

// cancel an in-flight pick:
eyedropper.abort();
```

## License

MIT
