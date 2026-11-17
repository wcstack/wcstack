# @wcstack/fullscreen

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/fullscreen` is a headless Fullscreen API component for the wcstack ecosystem.

It is not a visual UI widget.
It is a **control node**: unlike most wcstack IO nodes (which act on themselves), `<wcs-fullscreen>` drives `requestFullscreen()` / `exitFullscreen()` on a *referenced* element — the same way `@wcstack/intersection` observes a referenced element rather than itself.

With `@wcstack/state`, `<wcs-fullscreen>` can be bound directly through path contracts:

- **input surface**: `target` (which element to operate on — see below)
- **output state surface**: `active`, `error`, `errorInfo`, `supported`
- **commands**: `requestFullscreen()`, `exitFullscreen()`

`@wcstack/fullscreen` follows the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) (Core / Shell / Binding Contract) architecture:

- **Core** (`FullscreenCore`) drives the Fullscreen API and tracks `document`'s `fullscreenchange` event
- **Shell** (`<wcs-fullscreen target="...">`) resolves `target` to a DOM element and connects Core state to DOM lifecycle
- **Binding Contract** (`static wcBindable`) declares the observable `active` / `error` / `errorInfo` / `supported` properties and the `requestFullscreen`/`exitFullscreen` commands

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
<script type="module" src="https://esm.run/@wcstack/fullscreen/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>

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
| `active`  | `wcs-fullscreen:change` | `true` while `document.fullscreenElement` is *this instance's resolved target*; `false` otherwise. Since 4.25 (not released yet), also `false` while the element is out of the document (see [When the element leaves the document](#when-the-element-leaves-the-document)). |
| `error`   | `wcs-fullscreen:error` | The most recent failure: a rejected promise (e.g. a `TypeError` for a gesture-less call), `{ message: "Fullscreen API is not supported." }` when the platform API is missing, `{ message: "Fullscreen target could not be resolved." }` when `target` did not resolve to an element, or `null` if the last attempt succeeded / nothing has failed yet. Since 4.25 (not released yet), also a `NotAllowedError` `DOMException` (`"The browser refused the fullscreen request."`) for a refusal the browser reports only as an event (see Notes & limitations). |
| `errorInfo` | `wcs-fullscreen:error-info-changed` | Serializable failure taxonomy (`WcsIoErrorInfo`: stable `code` / `phase` / `recoverable`) derived from `error`, or `null`. Additive — the `error` value shape is unchanged. |
| `supported` | `wcs-fullscreen:supported-changed` | Since 4.25 (not released yet). `true` when this page can use element fullscreen; `false` otherwise (an iPhone, a frame the Permissions-Policy forbids). The event's `detail` is the boolean. See below. |

### `supported` — can this page use fullscreen?

Since 4.25 (not released yet). `supported` is `true` when this page can use element fullscreen: the document reports it enabled (`document.fullscreenEnabled`, or the prefixed `webkitFullscreenEnabled`), an element has `requestFullscreen()` (or `webkitRequestFullscreen()`), and no Permissions-Policy turns it off — the server's `Permissions-Policy: fullscreen=()` header, or a cross-origin `<iframe>` without `allow="fullscreen"` (or `allowfullscreen`). Otherwise it is `false`, whatever the reason. **An iPhone (Safari on iOS) has no element fullscreen, so `supported` is `false` there** (an iPad has it).

It does not say that a request will succeed: that still needs a user gesture, and the user can leave fullscreen at any moment. Fullscreen does not need a secure context, so a plain `http:` page is not `false` for that reason.

The value is read from the browser each time it is asked for (never cached), so a binding gets the right value when it attaches. The element also dispatches `wcs-fullscreen:supported-changed` when it is connected, if the value differs from the last one it dispatched (it starts at `false`, so a page that can use fullscreen hears `true` once). Offer the button only where it can work:

```html
<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["goFullscreen"],
      fsSupported: false,
    };
  </script>
</wcs-state>

<wcs-fullscreen target="#hero" data-wcs="supported: fsSupported; command.requestFullscreen: $command.goFullscreen"></wcs-fullscreen>
<img id="hero" src="/photo.jpg">
<button data-wcs="hidden: fsSupported|not; onclick: $command.goFullscreen">Fullscreen</button>
```

In a frame the policy forbids, WebKit (Safari) writes an error to the console each time `supported` is read: it offers no way to ask the policy, and reports the read of `document.fullscreenEnabled` there. The value (`false`) is right, and nothing is thrown.

## Commands

| Command             | Async | Description |
| --------------------- | ------ | ------------ |
| `requestFullscreen()` | yes   | Resolve `target` and call `requestFullscreen()` on it. |
| `exitFullscreen()`     | yes   | Call `document.exitFullscreen()`. Silent no-op if nothing is currently fullscreen. |

## Attributes / Inputs

| Attribute | Description |
| ---------- | ------------ |
| `target`   | Same 3-mode resolution as `@wcstack/intersection`'s `target`: `"self"`, a CSS selector, or omitted (first child). |

**`null` and `undefined`.** The `target` input, backed by its attribute, takes `null` as "clear": the attribute is removed and `target` falls back to its default, the first child. `undefined` means "no value supplied": the attribute goes back to what it was before the first write — the value written in the markup, or none. Neither is ever written as the string `"null"` / `"undefined"` (such a selector would resolve nothing, so every request would fail). (`@wcstack/state` never writes `undefined`; React 19 does when a prop that had a value is removed, and so can a direct assignment.)

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
boolean `:state()` reflection to represent. `supported` is not reflected either:
bind it (`supported: fsSupported`).

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

## When the element leaves the document

Since 4.25 (not released yet). `<wcs-fullscreen>` listens to the document only while it is connected. When it is disconnected while `active` is `true` — an `if:` branch that goes away, a route's content that `@wcstack/router` takes out — it publishes `active: false`, with its `wcs-fullscreen:change` event, so a bound state path and `:state(active)` follow: an element that is out of the document can no longer vouch for the value. It does **not** exit fullscreen. When it is connected again it reads the truth: if its target is still fullscreen, `active` goes back to `true`, with the event. An element that is moved (taken out and put back) therefore reports `false`, then `true`. Up to 4.24 a disconnect left `active` as it was, and state kept showing `true` after the fullscreen had ended.

What the browser does with the fullscreen is its own: **when the fullscreen element is removed from the document, the browser ends the fullscreen.** A target inside a route's content leaves with the route, and the fullscreen ends there. To keep something fullscreen across a navigation, put the target — and its `<wcs-fullscreen>` — outside the router, next to the layout that stays ([router README — Where route content lives](../router/README.md#where-route-content-lives)). With only the target outside and the `<wcs-fullscreen>` inside a route, the fullscreen goes on, but `active` is `false` while that route is away and `true` again when it comes back.

## Locking the screen orientation while fullscreen

In a browser tab the orientation can be locked only while the document is fullscreen (`lock()` of [`<wcs-screen-orientation>`](../screen-orientation/README.md)). Request fullscreen in the click, and lock from a `$watch` on the path bound to `active`. Do not lock in the handler that requests fullscreen: there the request is made but fullscreen is not active yet, and the browser refuses the lock.

```html
<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["goFullscreen", "exitFs", "lockOrientation", "unlockOrientation"],
      isFullscreen: false,
      lockError: null,

      enter() {
        this.$command.goFullscreen.emit(); // inside the click: the user gesture
      },

      $watch: {
        isFullscreen(cur) {
          if (cur) this.$command.lockOrientation.emit("landscape"); // fullscreen is active now
          else this.$command.unlockOrientation.emit();
        },
      },
    };
  </script>
</wcs-state>

<wcs-fullscreen target="#stage"
  data-wcs="active: isFullscreen; command.requestFullscreen: $command.goFullscreen; command.exitFullscreen: $command.exitFs"></wcs-fullscreen>
<wcs-screen-orientation
  data-wcs="command.lock: $command.lockOrientation; command.unlock: $command.unlockOrientation; error: lockError"></wcs-screen-orientation>

<div id="stage">
  <button data-wcs="onclick: enter; hidden: isFullscreen">Fullscreen, landscape</button>
  <button data-wcs="onclick: $command.exitFs; hidden: isFullscreen|not">Exit</button>
</div>
```

The watch runs when `active` becomes `true` — the lock is asked for with fullscreen in place — and again when it goes back to `false`: the user pressed Esc or the Exit button, or — since 4.25 (not released yet) — the element left the document. `$watch` is part of `@wcstack/state`'s full entries (`/auto`). Where the browser has no orientation lock (Safari, desktop browsers), `lockError` says so and the fullscreen is unaffected.

## Notes & limitations

- **iPhone has no element fullscreen.** Safari on an iPhone does not implement fullscreen for elements: `supported` is `false` and a request ends in `error`. Hide the button with `supported`. A `<video controls>` still has the system's own full-screen button there.
- **A refusal that arrives as an event.** Since 4.25 (not released yet). The standard `requestFullscreen()` returns a promise, and its rejection is the `error`. The prefixed API of older Safari (`webkitRequestFullscreen()`) returns nothing: a refusal reaches the page only as the document's `webkitfullscreenerror` / `fullscreenerror` event. `<wcs-fullscreen>` listens for it while connected, and when it fires for a request this element made with a call that returned no promise, `error` becomes a `NotAllowedError` `DOMException` — `"The browser refused the fullscreen request."`, `errorInfo.code` `not-allowed`. The event carries no reason, so the message says no more. It arrives after the command's promise has settled: bind `error` instead of reading it right after `await`. A request whose call returned a promise is answered by that promise alone, so the same refusal is never reported twice, and an event with no request of this element waiting — another instance's — is ignored.
- **A target the same update renders.** A command runs when it is emitted; state renders a microtask later. `this.showPlayer = true; this.$command.goFullscreen.emit();` therefore asks for a `target` that an `if:` branch has not put in the document yet, and `error` is `{ message: "Fullscreen target could not be resolved." }`. Emit after the render, from `$renderedCallback` — `if (paths.includes("showPlayer") && this.showPlayer) this.$command.goFullscreen.emit();` — which is still within the click's user activation ([state README — Command Token](../state/README.md#command-token-method-binding)).
- **User gesture requirement.** `requestFullscreen()` only succeeds when called synchronously from within a real user gesture (e.g. a click handler). This node cannot manufacture a gesture — if you invoke `requestFullscreen` via the command-token protocol (`command.requestFullscreen: $command.<token>` on `<wcs-fullscreen>`, emitted by a button's `onclick: $command.<token>`), make sure the *triggering* event itself is a genuine user gesture. Calling it from inside a `setTimeout` or deep in a promise chain will reject with a `TypeError` (per the WHATWG Fullscreen spec's transient-activation check — not `NotAllowedError`) regardless of how it was invoked — this is a browser-level constraint, not something wcstack can work around.
- **Vendor prefixes.** Some older Safari versions only implement `webkitRequestFullscreen` / `webkitExitFullscreen` / `webkitFullscreenElement` / `webkitFullscreenEnabled` / `webkitfullscreenchange` / `webkitfullscreenerror`. The Core probes the standard name first and falls back to the legacy name at *call time* (never cached), so both are supported transparently.
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
core.dispose();                        // detach the document listeners
```

Since 4.25 (not released yet), `dispose()` publishes `active: false` when it was `true` (a disposed Core no longer hears the document) and `setTarget(element)` reads it again — the Shell calls it on every connect. `core.supported`, and the `wcs-fullscreen:supported-changed` event `observe()` dispatches, say whether the page can use fullscreen.

The structural Core surface is normative across wcstack IO nodes ([async-io-node-guidelines §3.9](../../docs/async-io-node-guidelines.md)); to bind it into signals with no element at all, see [@wcstack/signals — Binding a Core directly](../signals/README.md#binding-a-core-directly-no-element).

## Accessibility

**WCAG 2.1.2 No Keyboard Trap / 2.4.3 Focus Order**: Esc always exits fullscreen (browser-guaranteed — do not repurpose it), but also offer a visible in-app exit wired to the `exitFullscreen` command; not every user knows the convention. Entering fullscreen changes what is on screen without a navigation: make sure focus lands somewhere sensible inside the fullscreen element (focus its first interactive control, or the element itself with `tabindex="-1"`), and check where focus returns when fullscreen ends — it should go back to the control that opened it.

## License

MIT
