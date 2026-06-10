# @wcstack/resize

`@wcstack/resize` is a headless ResizeObserver component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns an element's *size* into reactive state — the same way `@wcstack/fetch` turns a network request into reactive state and `@wcstack/intersection` turns an element's visibility into reactive state.

With `@wcstack/state`, `<wcs-resize>` can be bound directly through path contracts:

- **input / command surface**: `target`, `box`, `round`, `once`, `manual`, `trigger`
- **output state surface**: `entry`, `width`, `height`, `observing`

This means size-aware logic — canvas redraws, virtual lists, picking an image size, switching a layout mode — can be expressed declaratively in HTML, without writing `new ResizeObserver()`, `observe()`, `disconnect()`, or teardown glue in your UI layer.

`@wcstack/resize` follows the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) (Core / Shell / Binding Contract) architecture:

- **Core** (`ResizeCore`) owns the observer, entry normalization, box-following size derivation, and observation lifecycle
- **Shell** (`<wcs-resize>`) resolves *what* to observe from the DOM, manages display, lifecycle, and declarative commands
- **Binding Contract** (`static wcBindable`) declares observable `properties`, writable `inputs`, and callable `commands`

## When to reach for this (and when not to)

For **styling** that depends on a container's size, use CSS [`@container` queries](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment/Container_queries) — that is what they exist for, and they never round-trip through JavaScript.

`@wcstack/resize` is for the cases CSS can't express: **size-dependent logic**. Redrawing a `<canvas>` at the element's pixel size, computing how many virtual-list rows fit, choosing which image resolution to fetch, flipping a non-style state flag past a width threshold. An element changing size becomes a **state transition**, not imperative callback wiring. It is a read-only producer: the element/layout only produces values for the state (`element/layout → state`), with no path back.

## The `target` attribute decides everything

`target` is the single knob that selects *what* is observed — and, with it, how `<wcs-resize>` renders. It never injects a layout box unless you explicitly ask for one:

| `target`          | observes              | `display`   | use case               |
|-------------------|-----------------------|-------------|------------------------|
| *omitted*         | first element child   | `contents`  | size a wrapped child   |
| `"#panel"` / sel. | the matched element   | `none`      | size an existing node  |
| `"self"`          | the element itself    | `block`     | container-width probe   |

`display:contents` means wrapping a child injects no box of its own — so `<wcs-resize><div></wcs-resize>` does not disturb a flex/grid parent. A `display:none` element generates **no box**, so a selector-pointer `<wcs-resize>` correctly observes the referenced node (which has a box), not itself.

> **`target="self"` is a container probe.** A `self` `<wcs-resize>` renders as a `display:block`, zero-height element, so it stretches to fill its parent's available inline size. Binding `width` then tracks the *parent container's* width — the JS counterpart to a CSS container query. (A `display:contents` / `display:none` element has no box and would never fire, which is why `self` takes a `block` box.)

> **First element child.** When `target` is omitted, the *first element child* is observed. The target is re-resolved on every `observe()` (which runs on connect and on each observed-attribute change), so adding or removing the first child after connect switches the observed element on the next re-observe. If there is no element child at resolution time, it falls back to observing itself (`display:block`). Observing multiple targets at once is intentionally out of scope — wrap each target in its own `<wcs-resize>`.

## Install

```bash
npm install @wcstack/resize
```

## Quick Start

### 1. Container-width probe (`self`)

Bind `width` to a state value and react to the *parent container's* size in your state logic.

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/resize/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      width: 0,
      get layout() {
        return this.width < 480 ? "stack" : "columns";
      }
    };
  </script>
</wcs-state>

<div class="panel">
  <wcs-resize target="self" round data-wcs="width: width"></wcs-resize>
  <!-- bind `layout` to a class, attribute, etc. -->
</div>
```

`round` rounds `width` to an integer so a sub-pixel layout change does not churn the bound state.

### 2. Size a wrapped child (canvas redraw)

Omit `target` to observe the first child without injecting a box. Bind `width` / `height` to drive a redraw command.

```html
<wcs-resize round data-wcs="width: canvasWidth; height: canvasHeight">
  <canvas data-wcs="..."></canvas>
</wcs-resize>
```

### 3. Measure once (`once`)

`ResizeObserver` always reports the initial size when observation starts, so `once` makes `<wcs-resize>` a one-shot measurement.

```html
<wcs-resize target="#card" once data-wcs="width: cardWidth"></wcs-resize>
```

## Avoiding resize loops

A `ResizeObserver` whose callback changes the observed element's size can feed itself: *size → state → DOM size → size*. The browser has a built-in loop breaker (it defers same-frame re-notifications to the next frame, so you never hang), and `@wcstack/state`'s same-value guard stops a binding that converges in one pass. The remaining hazard is **sub-pixel oscillation** (a width flipping between `99.99` and `100.01` forever).

Two defenses, in order of preference:

1. **Don't wire a size output back into a size input.** Treat `width` / `height` as read-only sensors for *logic*, not as a layout driver.
2. **Quantize the signal.** Use `round` to snap to integers, or compose with `@wcstack/debounce`'s `<wcs-throttle>` to rate-limit the state update:

```html
<!-- coalesce rapid resizes into one state update every 100ms -->
<wcs-resize target="self" data-wcs="width: rawWidth"></wcs-resize>
<wcs-throttle wait="100" data-wcs="source: rawWidth; value: settledWidth"></wcs-throttle>
```

## Attributes

| Attribute | Type    | Default       | Description |
|-----------|---------|---------------|-------------|
| `target`  | string  | *(omitted)*   | What to observe: omitted → first child, a selector → that element, `self` → this element. |
| `box`     | string  | `content-box` | Which box to report: `content-box`, `border-box`, `device-pixel-content-box`. Unrecognized values fall back to `content-box`. |
| `round`   | boolean | `false`       | Round `width` / `height` to integers (absorbs sub-pixel jitter). |
| `once`    | boolean | `false`       | Disconnect after the first size observation (measure-once). |
| `manual`  | boolean | `false`       | Do not auto-observe on connect; drive it via commands instead. |

> **`trigger`** has *no attribute* — it is a momentary command-property meant for `@wcstack/state` wiring only. A `false → true` write re-runs `observe()` and the property auto-resets to `false` (a one-shot acknowledgement; read `observing` for the actual outcome). Prefer the command-token protocol (`command.observe: …`) over this boolean for state-driven observation.

## Output state

| Property    | Type                     | Description |
|-------------|--------------------------|-------------|
| `entry`     | `WcsResizeEntry \| null` | Plain snapshot of the latest `ResizeObserverEntry` (`contentRect` and the box-size fragments normalized to plain numbers), plus the live `target` node. |
| `width`     | `number`                 | Headline width from the observed `box` (falls back to `contentRect`), rounded when `round` is set. |
| `height`    | `number`                 | Headline height, same rules as `width`. |
| `observing` | `boolean`                | Whether an observation is currently active. |

> **`width` follows `box`.** With `box="border-box"`, `width` is the border-box width; with `device-pixel-content-box`, the device-pixel width; otherwise the content-box width. The raw `inlineSize` / `blockSize` fragments are mapped to `width` / `height` (correct for horizontal writing modes) and are also available un-rounded on `entry`.

## Commands

| Command        | Description |
|----------------|-------------|
| `observe()`    | Re-resolve `target` from the DOM and (re)start observing. |
| `unobserve()`  | Stop observing the current target. |
| `disconnect()` | Stop all observation. |

## Binding Contract (`wcBindable`)

Both the Core and the Shell declare the [wc-bindable](https://github.com/csbc-dev) protocol.

```js
// ResizeCore (headless)
ResizeCore.wcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "entry", event: "wcs-resize:change" },
    { name: "width", event: "wcs-resize:change", getter: (e) => e.detail.width },
    { name: "height", event: "wcs-resize:change", getter: (e) => e.detail.height },
    { name: "observing", event: "wcs-resize:observing-changed" },
  ],
  commands: [
    { name: "observe" }, { name: "unobserve" }, { name: "disconnect" },
  ],
};
```

The Shell (`<wcs-resize>`) inherits the Core's `properties` / `commands`, adds the momentary `trigger` property, and declares the DOM-driven `inputs` (`target`, `box`, `round`, `once`, `manual`, `trigger`).

## Using the Core standalone

`ResizeCore` is framework-agnostic and can be used without the custom element. You hand it the element to observe (the Shell does this resolution for you):

```js
import { ResizeCore } from "@wcstack/resize";

const core = new ResizeCore();
core.addEventListener("wcs-resize:change", (e) => {
  console.log(e.detail.width, e.detail.height);
});
core.observe(document.querySelector("#panel"), { box: "border-box", round: true });
// later
core.disconnect();
```

## Notes & limitations

- **Single target.** Each `<wcs-resize>` observes exactly one element so the state maps to a single value surface. For many targets, use many elements.
- **Never throws.** Unsupported environments (no `ResizeObserver`) are silent no-ops. A valid-but-unsupported `box` (e.g. `device-pixel-content-box` on engines that lack it) is retried once with `content-box`; if that also fails, `observing` stays `false` rather than throwing.
- **For styling, prefer CSS `@container`.** This component is for size-dependent *logic*, not size-dependent *styles*.

## License

MIT
