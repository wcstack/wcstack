# @wcstack/intersection

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/intersection` is a headless IntersectionObserver component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns an element's *visibility* into reactive state — the same way `@wcstack/fetch` turns a network request into reactive state and `@wcstack/geolocation` turns the device's location into reactive state.

With `@wcstack/state`, `<wcs-intersect>` can be bound directly through path contracts:

- **input / command surface**: `target`, `root`, `root-margin`, `threshold`, `once`, `manual`, `trigger`
- **output state surface**: `entry`, `intersecting`, `ratio`, `visible`, `observing`

This means visibility-aware work — lazy-loading, infinite scroll, scroll-spying — can be expressed declaratively in HTML, without writing `new IntersectionObserver()`, `observe()`, `disconnect()`, or teardown glue in your UI layer.

`@wcstack/intersection` follows the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) (Core / Shell / Binding Contract) architecture:

- **Core** (`IntersectionCore`) owns the observer, entry normalization, the `visible` latch, and observation lifecycle
- **Shell** (`<wcs-intersect>`) resolves *what* to observe from the DOM, manages display, lifecycle, and declarative commands
- **Binding Contract** (`static wcBindable`) declares observable `properties`, writable `inputs`, and callable `commands`

## Why this exists

IntersectionObserver is different from every other @wcstack sensor: the thing it observes is **a DOM element**, not a headless resource. Imperatively, wiring it up means creating an observer, resolving a target node, handling the entry callback, and tearing it all down on disconnect.

`@wcstack/intersection` moves that logic into a reusable component and exposes the result as bindable state. An element scrolling into view becomes a **state transition**, not imperative callback wiring. It is a read-only producer: the element/layout only produces values for the state (`element/layout → state`), with no path back.

## The `target` attribute decides everything

`target` is the single knob that selects *what* is observed — and, with it, how `<wcs-intersect>` renders. It never injects a layout box unless you explicitly ask for one:

| `target`          | observes              | `display`   | use case             |
|-------------------|-----------------------|-------------|----------------------|
| *omitted*         | first element child   | `contents`  | lazy-load wrapper    |
| `"#hero"` / sel.  | the matched element   | `none`      | scrollspy (single)   |
| `"self"`          | the element itself    | `block`     | infinite-scroll edge |

`display:contents` means wrapping a child injects no box of its own — so `<wcs-intersect><img></wcs-intersect>` does not disturb a flex/grid parent. Only the explicit `target="self"` sentinel takes a box.

> **First element child.** When `target` is omitted, the *first element child* is observed. The target is re-resolved on every `observe()` (which runs on connect and on each observed-attribute change), so adding or removing the first child after connect switches the observed element on the next re-observe. If there is no element child at resolution time, it falls back to observing itself (`display:block`). Observing multiple targets at once is intentionally out of scope — wrap each target in its own `<wcs-intersect>`.

## Install

```bash
npm install @wcstack/intersection
```

## Quick Start

### 1. Lazy-load an image (`visible` latch)

`visible` flips to `true` the first time the target intersects and **stays** `true`. Bind the image `src` to it and the image only loads once it scrolls into view.

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/intersection/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      shown: false,
      get src() {
        return this.shown ? "/photo.jpg" : "";
      }
    };
  </script>
</wcs-state>

<wcs-intersect once data-wcs="visible: shown">
  <img data-wcs="src: src" alt="lazy">
</wcs-intersect>
```

`once` disconnects the observer after the first intersection — ideal for one-shot lazy loads.

### 2. Infinite scroll (sentinel)

Place an empty `target="self"` marker at the bottom of a list; bind `intersecting` to a state flag that triggers loading more.

```html
<ul data-wcs="for: items">
  <li data-wcs="textContent: items.*.name"></li>
</ul>

<wcs-intersect target="self" data-wcs="intersecting: atEnd"></wcs-intersect>
```

```js
export default {
  items: [],
  atEnd: false,
  get _loadMore() {
    // a computed/effect that reacts to atEnd becoming true
    return this.atEnd ? fetchNextPage() : null;
  }
};
```

### 3. Scrollspy (single section)

Point `target` at a section elsewhere in the document; bind `intersecting` to highlight the matching nav item.

```html
<nav>
  <a href="#features" data-wcs="class.active: featuresVisible">Features</a>
</nav>

<section id="features">…</section>

<wcs-intersect target="#features" threshold="0.5"
  data-wcs="intersecting: featuresVisible"></wcs-intersect>
```

## Attributes

| Attribute      | Type    | Default    | Description |
|----------------|---------|------------|-------------|
| `target`       | string  | *(omitted)*| What to observe: omitted → first child, a selector → that element, `self` → this element. |
| `root`         | string  | *(viewport)* | Selector for the scroll root. |
| `root-margin`  | string  | `0px`      | Margin around the root (CSS-margin syntax). |
| `threshold`    | string  | `0`        | A single ratio (`0.5`) or comma list (`0,0.5,1`) of `0..1` thresholds. Invalid / out-of-range values are dropped. |
| `once`         | boolean | `false`    | Disconnect after the first intersecting observation. |
| `manual`       | boolean | `false`    | Do not auto-observe on connect; drive it via commands instead. |

> **`trigger`** has *no attribute* — it is a momentary command-property meant for `@wcstack/state` wiring only. A `false → true` write re-runs `observe()` and the property auto-resets to `false` (a one-shot acknowledgement; read `observing` for the actual outcome). Prefer the command-token protocol (`command.observe: …`) over this boolean for state-driven observation.

## Output state

| Property       | Type                       | Description |
|----------------|----------------------------|-------------|
| `entry`        | `WcsIntersectEntry \| null`| Plain snapshot of the latest `IntersectionObserverEntry` (rects normalized to plain numbers), plus the live `target` node. |
| `intersecting` | `boolean`                  | Whether the target currently intersects the root. |
| `ratio`        | `number`                   | The latest `intersectionRatio`. |
| `visible`      | `boolean`                  | Latch: `true` once the target has intersected; cleared only by `reset()`. |
| `observing`    | `boolean`                  | Whether an observation is currently active. |

## Commands

| Command       | Description |
|---------------|-------------|
| `observe()`   | Re-resolve `target` / `root` from the DOM and (re)start observing. Idempotent: an unchanged target+options is a no-op (no fresh callback). |
| `reobserve()` | Force a fresh observation even when `target` / options are unchanged — tears the observer down and rebuilds it, so a new initial callback fires for the *current* visibility. Use to re-arm an edge-driven consumer (e.g. infinite scroll) after the layout shifted without a visibility transition. `observing` stays `true` across a successful re-arm (no false blip). |
| `unobserve()` | Stop observing the current target. |
| `disconnect()`| Stop all observation. |
| `reset()`     | Clear the `visible` latch so a later intersection can set it again. |

## CSS styling with `:state()`

`<wcs-intersect>` reflects three boolean output states onto its
[`ElementInternals` `CustomStateSet`](https://developer.mozilla.org/en-US/docs/Web/API/CustomStateSet),
so you can style it directly from CSS with the `:state()` pseudo-class — no
`data-wcs` binding or extra class toggling required.

| State | On when |
|-------|---------|
| `visible` | `wcs-intersect:visible-changed` fires with `true` (a latch — only cleared by `reset()`, which fires the event with `false`) |
| `observing` | `wcs-intersect:observing-changed` fires with `true` (cleared on `false`) |
| `intersecting` | `wcs-intersect:change` fires with a detail whose `isIntersecting` is `true` (cleared when it is `false`) |

`ratio` and `entry` are not reflected (continuous / data values).

```css
wcs-intersect:state(intersecting) ~ .marker { opacity: 1; }
wcs-intersect:state(visible) img { display: block; } /* lazy-load reveal */
wcs-intersect:not(:state(observing)) ~ .paused-badge { display: block; }
```

Unlike attributes or classes, `:state()` cannot be written from outside the
element, so there is no risk of confusing this output state with an input.

**Browser support** (`:state(x)` syntax): Chrome/Edge 125+, Safari 17.4+,
Firefox 126+. In older browsers the states are simply never set — `:state()`
selectors never match, but `<wcs-intersect>` itself keeps working normally
(graceful degradation, never-throw).

**SSR**: `:state()` cannot be serialized into HTML, so server-rendered markup
never carries these states on first paint (`@wcstack/server` is unaffected).
If you need to style the pre-hydration gap, pair your rule with
`wcs-intersect:not(:defined)` instead.

### Debugging

Custom states are invisible in DevTools' Elements panel and `attachInternals()`
cannot be called twice, so there is no console way to inspect them directly.
Two debug-only aids are provided for that:

- `el.debugStates` — a **snapshot** array of the currently-on state names
  (e.g. `["observing", "intersecting"]`). It is not part of `wc-bindable`
  (not a bind target) and its shape is not a guaranteed contract — use it for
  debugging only.
- The `debug-states` attribute (opt-in, default off) mirrors state changes
  onto `data-wcs-state-visible` / `data-wcs-state-observing` /
  `data-wcs-state-intersecting` attributes on the element, so the Elements
  panel highlights them as they toggle:

  ```html
  <wcs-intersect target="#hero" debug-states></wcs-intersect>
  ```

**Write your CSS against `:state()`, not `data-wcs-state-*`.** The mirrored
attributes exist purely to make state changes visible while debugging with
DevTools open; they are not a supported styling hook.

## Binding Contract (`wcBindable`)

Both the Core and the Shell declare the [wc-bindable](https://github.com/csbc-dev) protocol.

```js
// IntersectionCore (headless)
IntersectionCore.wcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "entry", event: "wcs-intersect:change" },
    { name: "intersecting", event: "wcs-intersect:change", getter: (e) => e.detail.isIntersecting },
    { name: "ratio", event: "wcs-intersect:change", getter: (e) => e.detail.intersectionRatio },
    { name: "visible", event: "wcs-intersect:visible-changed" },
    { name: "observing", event: "wcs-intersect:observing-changed" },
  ],
  commands: [
    { name: "observe" }, { name: "reobserve" }, { name: "unobserve" }, { name: "disconnect" }, { name: "reset" },
  ],
};
```

The Shell (`<wcs-intersect>`) inherits the Core's `properties` / `commands`, adds the momentary `trigger` property, and declares the DOM-driven `inputs` (`target`, `root`, `rootMargin`, `threshold`, `once`, `manual`, `trigger`).

## Using the Core standalone

`IntersectionCore` is framework-agnostic and can be used without the custom element. You hand it the element to observe (the Shell does this resolution for you):

```js
import { IntersectionCore } from "@wcstack/intersection";

const core = new IntersectionCore();
core.addEventListener("wcs-intersect:change", (e) => {
  console.log(e.detail.isIntersecting, e.detail.intersectionRatio);
});
core.observe(document.querySelector("#hero"), { threshold: [0, 0.5, 1] });
// later
core.disconnect();
```

## Notes & limitations

- **Single target.** Each `<wcs-intersect>` observes exactly one element so the state maps to a single value surface. For many targets, use many elements.
- **Never throws.** Unsupported environments (no `IntersectionObserver`) and invalid options (e.g. a malformed `root-margin`) are silent no-ops: `observing` stays `false` rather than throwing.
- **No permission gate / secure context requirement** (unlike `@wcstack/geolocation`).

## License

MIT
