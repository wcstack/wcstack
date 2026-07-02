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

<video id="player" src="/movie.mp4" controls></video>

<wcs-pip target="#player" data-wcs="active: pipActive"></wcs-pip>

<button command.click:$command.requestPictureInPicture>Pop out</button>
<button command.click:$command.exitPictureInPicture hidden@!pipActive>Back to page</button>
```

### 2. Wrapping the `<video>` as a child (no selector needed)

```html
<wcs-pip data-wcs="active: pipActive">
  <video src="/movie.mp4" controls></video>
</wcs-pip>
```

### 3. Reporting failures (e.g. gesture-context rejection)

```html
<wcs-pip target="#player" data-wcs="active: pipActive; error: pipError"></wcs-pip>
<p hidden@!pipError>Could not enter Picture-in-Picture.</p>
```

## The `target` attribute decides what is controlled

| `target`        | controls               | `display`   | use case                |
|-----------------|-------------------------|-------------|--------------------------|
| omitted         | first element child     | `contents`  | wrap a `<video>` inline  |
| `"#player"` / sel | the matched element   | `none`      | separate control tag     |
| `"self"`        | the element itself       | `block`     | `<wcs-pip>` doubling as the `<video>` (rare) |

`display:contents` means wrapping a `<video>` child injects no box of its own. Only the explicit `target="self"` sentinel takes a box. See `packages/intersection`'s `_resolveTarget()` — this Shell reuses it verbatim (docs/fullscreen-tag-design.md §1).

## Attributes

| Attribute | Type   | Default     | Description |
|-----------|--------|-------------|--------------|
| `target`  | string | *(omitted)* | Which `<video>` to control: omitted → first child, a selector → that element, `self` → this element. Must resolve to a `<video>` element. |

## Output state

| Property | Type      | Event            | Description |
|----------|-----------|------------------|--------------|
| `active` | `boolean` | `wcs-pip:change` | Whether the resolved `<video>` target is currently the document's Picture-in-Picture element. |
| `error`  | `any`     | *(none — read via getter)* | The most recent command failure (wrong tag, unsupported API, gesture-context rejection), or `null`. |

`active` is derived from comparing `document.pictureInPictureElement` against the resolved `<video>` target whenever `enterpictureinpicture`/`leavepictureinpicture` fires **on that target element** — not from a `document`-level event (see "Event subscription" below).

## Commands

| Command                      | Description |
|-------------------------------|--------------|
| `requestPictureInPicture()`   | Resolve the `target` `<video>` and request Picture-in-Picture for it. Never throws: a non-`<video>` target, an unsupported API, or a gesture-context rejection (`NotAllowedError`) all funnel into `error`. |
| `exitPictureInPicture()`      | Exit Picture-in-Picture. **Silent no-op** if nothing is currently in Picture-in-Picture (mirrors `@wcstack/fullscreen`'s `exitFullscreen()` — see `docs/fullscreen-tag-design.md` §7). |

### User gesture requirement

`requestPictureInPicture()` must be called from within a user gesture (e.g. a click handler). This is a browser-level requirement `<wcs-pip>` cannot work around — see `docs/fullscreen-tag-design.md` §3 for the same constraint on Fullscreen. Prefer wiring the command directly to a click via the command-token protocol:

```html
<button command.click:$command.requestPictureInPicture>Pop out</button>
```

Calling it from inside a `setTimeout` or deep inside a `.then()` chain loses the gesture context and the browser will reject the request — this is unrelated to wcstack and cannot be fixed at this layer.

## Event subscription: the `<video>` element itself, not `document`

Unlike Fullscreen's `fullscreenchange` (which fires on `document`), Picture-in-Picture's `enterpictureinpicture`/`leavepictureinpicture` events fire **on the `<video>` element itself**. `PipCore` attaches these listeners directly to the resolved `<video>`, and re-wires them (detaching from the old target, attaching to the new one) whenever `target` is re-resolved (e.g. the `target` attribute changes).

This also means multiple `<wcs-pip>` instances naturally self-filter: each instance only hears events from its own `<video>` target, so one instance entering Picture-in-Picture never flips another instance's `active` to `true` (see `docs/picture-in-picture-tag-design.md` §5).

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
- **`document.pictureInPictureElement` is a single document-wide value**, like `document.fullscreenElement`. Multiple `<wcs-pip>` instances self-filter via their own `<video>` target's `enterpictureinpicture`/`leavepictureinpicture` listeners — see "Event subscription" above.
- **No `desired`/`actual` two-phase state** — this node exposes a single `active` boolean plus `error`, mirroring `@wcstack/fullscreen`'s simpler-than-`permission` state model.

## License

MIT
