# @wcstack/picture-in-picture

`@wcstack/picture-in-picture` is a headless Picture-in-Picture component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns a `<video>` element's Picture-in-Picture state into reactive state — the same way `@wcstack/fullscreen` turns an element's fullscreen state into reactive state.

With `@wcstack/state`, `<wcs-pip>` can be bound directly through path contracts:

- **input surface**: `target` — which `<video>` element to control
- **output state surface**: `active`, `error`
- **command surface**: `requestPictureInPicture()`, `exitPictureInPicture()`

This means a "pop out" video button — with no live-region layout thrashing, no manual `document.pictureInPictureElement` polling — can be expressed declaratively in HTML.

`@wcstack/picture-in-picture` follows the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) (Core / Shell / Binding Contract) architecture:

- **Core** (`PipCore`) resolves the Picture-in-Picture API (call-time, never cached), subscribes to `enterpictureinpicture`/`leavepictureinpicture` on the target `<video>`, and tracks `active`/`error`
- **Shell** (`<wcs-pip>`) resolves *which* `<video>` element to control from the DOM, manages display, lifecycle, and declarative commands
- **Binding Contract** (`static wcBindable`) declares observable `properties`, writable `inputs`, and callable `commands`

## Why this exists — and why it doesn't operate on itself

Like `@wcstack/fullscreen`, this Shell is a non-visible **control tag**: it does not put itself into Picture-in-Picture. It resolves a `target` element and invokes the Picture-in-Picture API against *that* element. The typical use case is a video player's "pop out" button.

`@wcstack/picture-in-picture` shares its `target`-resolution archetype with `@wcstack/fullscreen` and `@wcstack/intersection` (see `docs/fullscreen-tag-design.md` §1 for the detailed rationale) — the same 3-mode `target` resolution, the same `_safeQuery` never-throw wrapper, the same single Core-level `_gen` generation guard, and the same simple `error` field (no permission-style 4-value state; see `docs/fullscreen-tag-design.md` §8).

## Scope: classic Picture-in-Picture API only (`<video>`-only)

There are two unrelated web platform proposals under the "Picture-in-Picture" name:

- **The classic Picture-in-Picture API** (`HTMLVideoElement.requestPictureInPicture()`) — `<video>`-only, broadly supported. **This is what `<wcs-pip>` wraps.**
- **The Document Picture-in-Picture API** (`documentPictureInPicture.requestWindow()`) — lets you float an arbitrary DOM subtree in a separate always-on-top window, not limited to video. Its API shape (acquiring a separate `Window` and moving DOM into it) is fundamentally different from the "resolve a target, watch a document-level state" archetype this node shares with `fullscreen`/`pointer-lock`.

**`<wcs-pip>` targets the classic, `<video>`-only API. The Document Picture-in-Picture API is out of scope for v1** — see `docs/picture-in-picture-tag-design.md` §4. It may become a separate node (e.g. `<wcs-doc-pip>`) in the future.

### The `target` MUST resolve to a `<video>` element

Unlike Fullscreen (which any `Element` supports), Picture-in-Picture is only defined on `HTMLVideoElement`. If `target` resolves to a non-`<video>` element, `<wcs-pip>` treats it the same as an unresolved target: `requestPictureInPicture()` never throws — it immediately sets `error` to `{ message: "target must be a <video> element." }` and resolves.

## Install

```bash
npm install @wcstack/picture-in-picture
```

## Quick Start

### 1. A "pop out" button for a video player

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/picture-in-picture/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["popOut", "backToPage"],
      pipActive: false,
    };
  </script>
</wcs-state>

<video id="player" src="/movie.mp4" controls></video>

<wcs-pip target="#player" data-wcs="active: pipActive; command.requestPictureInPicture: $command.popOut; command.exitPictureInPicture: $command.backToPage"></wcs-pip>

<button data-wcs="onclick: $command.popOut">Pop out</button>
<button data-wcs="onclick: $command.backToPage; hidden: pipActive|not">Back to page</button>
```

Neither button touches `<wcs-pip>` directly: each click emits a command token, and `<wcs-pip>` subscribes to those tokens via `command.requestPictureInPicture: $command.popOut` / `command.exitPictureInPicture: $command.backToPage` (the [command-token protocol](../state/) — the element with the command method is the *subscriber*, not the emitter). Every bound state path must be declared up front — `pipActive: false` here; binding an undeclared path throws at initialization. Negation in a `data-wcs` path is done with the `|not` filter (`pipActive|not`), not a leading `!` — paths do not support prefix operators.

### 2. Wrapping the `<video>` as a child (no selector needed)

```html
<wcs-state>
  <script type="module">
    export default {
      pipActive: false,
    };
  </script>
</wcs-state>

<wcs-pip data-wcs="active: pipActive">
  <video src="/movie.mp4" controls></video>
</wcs-pip>
```

### 3. Reporting failures (e.g. gesture-context rejection)

`error` has no dedicated event and is not `data-wcs` bindable (see "Output state" below) — read it imperatively after the command's promise settles:

```html
<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["popOut"],
      pipActive: false,
    };
  </script>
</wcs-state>

<wcs-pip target="#player" data-wcs="active: pipActive; command.requestPictureInPicture: $command.popOut"></wcs-pip>
<button data-wcs="onclick: $command.popOut">Pop out</button>
```

```js
const pip = document.querySelector("wcs-pip");
await pip.requestPictureInPicture();
if (pip.error) {
  console.log("Could not enter Picture-in-Picture:", pip.error);
}
```

## The `target` attribute decides what is controlled

| `target`        | controls               | `display`   | use case                |
|-----------------|-------------------------|-------------|--------------------------|
| omitted         | first element child     | `contents`  | wrap a `<video>` inline  |
| `"#player"` / sel | the matched element   | `none`      | separate control tag     |
| `"self"`        | the element itself       | `block`     | **always fails** — `<wcs-pip>` itself can never be a `<video>`, so `requestPictureInPicture()` immediately errors (see "The `target` MUST resolve to a `<video>` element" above) |

`display:contents` means wrapping a `<video>` child injects no box of its own. Only the explicit `target="self"` sentinel takes a box. See `packages/intersection`'s `_resolveTarget()` — this Shell reuses it verbatim (docs/fullscreen-tag-design.md §1).

Unlike `@wcstack/fullscreen` (where `target="self"` is a legitimate way to fullscreen the wrapper itself, since any `Element` can be fullscreened), `target="self"` here is a structural dead end: `<wcs-pip>`'s own `tagName` is never `VIDEO`, so it always fails the `<video>`-only check and every `requestPictureInPicture()` call resolves into `error`. The mode is still accepted rather than rejected as an invalid attribute value — for parity with the shared 3-mode `_resolveTarget()` archetype — it just never does anything useful.

## Attributes

| Attribute | Type   | Default     | Description |
|-----------|--------|-------------|--------------|
| `target`  | string | *(omitted)* | Which `<video>` to control: omitted → first child, a selector → that element, `self` → this element (always fails — see above). |

## Output state

| Property | Type      | Event            | Description |
|----------|-----------|------------------|--------------|
| `active` | `boolean` | `wcs-pip:change` | Whether the resolved `<video>` target is currently the document's Picture-in-Picture element. |
| `error`  | `any`     | *(none — plain getter, not data-wcs bindable)* | The most recent command failure (wrong tag, unsupported API, gesture-context rejection), or `null`. |

`active` is derived from comparing `document.pictureInPictureElement` against the resolved `<video>` target whenever `enterpictureinpicture`/`leavepictureinpicture` fires **on that target element** — not from a `document`-level event (see "Event subscription" below).

## Commands

| Command                      | Description |
|-------------------------------|--------------|
| `requestPictureInPicture()`   | Resolve the `target` `<video>` and request Picture-in-Picture for it. Never throws: a non-`<video>` target, an unsupported API, or a gesture-context rejection (`NotAllowedError`) all funnel into `error`. |
| `exitPictureInPicture()`      | Exit Picture-in-Picture. **Silent no-op** if nothing is currently in Picture-in-Picture (mirrors `@wcstack/fullscreen`'s `exitFullscreen()` — see `docs/fullscreen-tag-design.md` §7). |

### User gesture requirement

`requestPictureInPicture()` must be called from within a user gesture (e.g. a click handler). This is a browser-level requirement `<wcs-pip>` cannot work around — see `docs/fullscreen-tag-design.md` §3 for the same constraint on Fullscreen. Prefer wiring the command directly to a click via the command-token protocol (`command.requestPictureInPicture: $command.<token>` on `<wcs-pip>`, emitted by a button's `onclick: $command.<token>` — see the Quick Start above), making sure the *triggering* event itself is a genuine user gesture.

Calling it from inside a `setTimeout` or deep inside a `.then()` chain loses the gesture context and the browser will reject the request — this is unrelated to wcstack and cannot be fixed at this layer.

## Event subscription: the `<video>` element itself, not `document`

Unlike Fullscreen's `fullscreenchange` (which fires on `document`), Picture-in-Picture's `enterpictureinpicture`/`leavepictureinpicture` events fire **on the `<video>` element itself**. `PipCore` attaches these listeners directly to the resolved `<video>`, and re-wires them (detaching from the old target, attaching to the new one) whenever `target` is re-resolved (e.g. the `target` attribute changes).

This also means multiple `<wcs-pip>` instances naturally self-filter: each instance only hears events from its own `<video>` target, so one instance entering Picture-in-Picture never flips another instance's `active` to `true` (see `docs/picture-in-picture-tag-design.md` §5).

## CSS styling with `:state()`

`<wcs-pip>` reflects one boolean output state onto its
[`ElementInternals` `CustomStateSet`](https://developer.mozilla.org/en-US/docs/Web/API/CustomStateSet),
so you can style it directly from CSS with the `:state()` pseudo-class — no
`data-wcs` binding or extra class toggling required.

| State | On when |
|-------|---------|
| `active` | `wcs-pip:change` fires with `detail.active === true` (cleared when it fires with `false`) |

```css
wcs-pip:state(active) ~ .back-to-page-button { display: inline-block; }
wcs-pip:state(active) ~ .back-to-page-button { display: none; } /* default */
```

Unlike attributes or classes, `:state()` cannot be written from outside the
element, so there is no risk of confusing this output state with an input.
`error` is intentionally **not** reflected — it has no dedicated event (see
"Output state" above), so there is nothing to derive a state toggle from.

**Browser support** (`:state(x)` syntax): Chrome/Edge 125+, Safari 17.4+,
Firefox 126+. In older browsers the states are simply never set — `:state()`
selectors never match, but `<wcs-pip>` itself keeps working normally
(graceful degradation, never-throw).

**SSR**: `:state()` cannot be serialized into HTML, so server-rendered markup
never carries these states on first paint (`@wcstack/server` is unaffected).
If you need to style the pre-hydration gap, pair your rule with
`wcs-pip:not(:defined)` instead.

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
  <wcs-pip target="#player" debug-states></wcs-pip>
  ```

**Write your CSS against `:state()`, not `data-wcs-state-*`.** The mirrored
attribute exists purely to make state changes visible while debugging with
DevTools open; it is not a supported styling hook.

## Binding Contract (`wcBindable`)

Both the Core and the Shell declare the [wc-bindable](https://github.com/csbc-dev) protocol.

```js
// PipCore (headless)
PipCore.wcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "active", event: "wcs-pip:change", getter: (e) => e.detail.active },
  ],
  commands: [
    { name: "requestPictureInPicture", async: true },
    { name: "exitPictureInPicture", async: true },
  ],
};
```

The Shell (`<wcs-pip>`) inherits the Core's `properties`/`commands` and declares the `target` input.

## Using the Core standalone

`PipCore` is framework-agnostic. You resolve and hand it the `<video>` element to control (the Shell does this resolution for you):

```js
import { PipCore } from "@wcstack/picture-in-picture";

const core = new PipCore();
core.addEventListener("wcs-pip:change", (e) => {
  console.log(e.detail.active);
});

const video = document.querySelector("video");
core.observe(video);            // subscribe to enterpictureinpicture/leavepictureinpicture
await core.requestPictureInPicture(video);

// later
await core.exitPictureInPicture();
core.dispose();                 // detach listeners
```

## Notes & limitations

- **`<video>`-only.** `target` must resolve to an `HTMLVideoElement`. Any other element is treated as unresolved: `error` is set to `{ message: "target must be a <video> element." }`, never throws.
- **Document Picture-in-Picture API is out of scope.** See "Scope" above.
- **Never throws.** Unsupported environments, wrong-tag targets, and gesture-context rejections are all funneled into `error`.
- **`document.pictureInPictureElement` is a single document-wide value**, like `document.fullscreenElement`. Multiple `<wcs-pip>` instances self-filter via their own `<video>` target's `enterpictureinpicture`/`leavepictureinpicture` listeners — see "Event subscription" above. Note the asymmetry, though: `exitPictureInPicture()` is **not** scoped per instance — it calls the document-global `document.exitPictureInPicture()`, so invoking it on any instance exits whatever `<video>` is currently in Picture-in-Picture, even one entered via another instance's `target` (its silent no-op check is likewise document-wide: "is anything in Picture-in-Picture", not "is *my* target in Picture-in-Picture"). This mirrors the platform API itself and `@wcstack/fullscreen`'s `exitFullscreen()` (see `docs/fullscreen-tag-design.md` §7's "scope note" alongside §2.1, and the "Multiple instances" bullet in `packages/fullscreen/README.md`).
- **No `desired`/`actual` two-phase state** — this node exposes a single `active` boolean plus `error`, mirroring `@wcstack/fullscreen`'s simpler-than-`permission` state model.
- **`error` has no dedicated event, and is not `data-wcs` bindable.** Like `@wcstack/fullscreen`, `error` is a plain getter with no `wcs-pip:error` event of its own, and it is not declared in `static wcBindable.properties` — a binding system has nothing to subscribe to and cannot observe it reactively. Read `element.error` imperatively after a command's promise settles (e.g. `await el.requestPictureInPicture(); if (el.error) { ... }`).

## License

MIT
