# @wcstack/media-query

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/media-query` is a headless `matchMedia` component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **async primitive node** that turns a CSS media query into reactive state — the same way `@wcstack/network` turns the connection-quality signal into reactive state.

With `@wcstack/state`, `<wcs-media-query>` can be bound directly through path contracts:

- **input surface**: `query` — the media query string, mirrored from the `query` attribute
- **output state surface**: `matched`, `media`, `supported`

This means "is the user in dark mode", "does the user prefer reduced motion", "is the viewport narrower than 600px" become plain booleans in state — usable by `data-wcs` conditionals, computed getters, and other I/O nodes — without writing `matchMedia` / `change`-listener glue in your UI layer.

`@wcstack/media-query` follows the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) (Core / Shell / Binding Contract) architecture:

- **Core** (`MediaQueryCore`) calls `matchMedia(query)` and tracks the list's live `change` event
- **Shell** (`<wcs-media-query>`) connects that state to DOM lifecycle and re-subscribes when `query` changes
- **Binding Contract** (`static wcBindable`) declares observable `properties`, one `input` (`query`), and **no commands**

## Why this exists — CSS already has `@media`; state does not

A media query that only changes *styling* belongs in a stylesheet. This node is for the cases where the answer has to reach **logic**: choosing a default theme value, pausing a `<wcs-raf>` loop under `prefers-reduced-motion`, swapping a table for a card list below a breakpoint, or detecting `(display-mode: standalone)` for a PWA. Each of those is four lines of imperative wiring by hand (`matchMedia` → `addEventListener("change")` → initial sync → cleanup); here it is one tag with the same skeleton as every other wcstack I/O node.

> **`matched`, not `matches`.** The platform property is `MediaQueryList.matches`, but `Element.prototype.matches(selector)` already exists on every element and a wc-bindable property is read straight off the Shell — so the output is named `matched` to leave the DOM method intact. See `docs/media-query-tag-design.md` §2.1.

> **No secure-context requirement, no permission.** `matchMedia` is available on every page.

## Install

```bash
npm install @wcstack/media-query
```

CDN (pinned): `https://esm.run/@wcstack/media-query@2.6.0/auto`

## Quick Start

### 1. Dark-mode default for a theme

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/media-query/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      isDark: false,
      get theme() {
        return this.isDark ? "dark" : "light";
      },
    };
  </script>
</wcs-state>

<wcs-media-query query="(prefers-color-scheme: dark)" data-wcs="matched: isDark"></wcs-media-query>

<main data-wcs="attr.data-theme: theme">…</main>
```

One timing rule applies to every example on this page: `<wcs-media-query>` publishes its snapshot through `wcs-media-query:change` events, and the *first* snapshot fires synchronously at connect — before `@wcstack/state` has attached its binding listeners. The initial value still arrives, because every observable property on `<wcs-media-query>` is output-only (declared in `properties`, absent from `inputs`): that makes the default binding authority `element`, so the binding **reads the property directly when it attaches** instead of waiting for an event it already missed (directional initial sync, on by default since v1.21.0). No manual pull is needed (see Notes & limitations).

### 2. Respect `prefers-reduced-motion` in a `<wcs-raf>` loop

```html
<wcs-state>
  <script type="module">
    export default {
      reduceMotion: false,
      frame: 0,
    };
  </script>
</wcs-state>

<wcs-media-query query="(prefers-reduced-motion: reduce)" data-wcs="matched: reduceMotion"></wcs-media-query>
<wcs-raf data-wcs="tick: frame; command.pause: reduceMotion|truthy; command.resume: reduceMotion|not" manual></wcs-raf>
```

(`<wcs-raf>` also has its own `reduced-motion="pause"` attribute for exactly this case; the example shows the general shape — any I/O node's commands can be driven from a media query.)

### 3. Layout switch at a breakpoint

```html
<wcs-state>
  <script type="module">
    export default {
      narrow: false,
      rows: [],
    };
  </script>
</wcs-state>

<wcs-media-query query="(max-width: 600px)" data-wcs="matched: narrow"></wcs-media-query>

<template data-wcs="if: narrow">
  <ul data-wcs="for: rows"><li data-wcs="textContent: rows.*.name"></li></ul>
</template>
<template data-wcs="if: narrow|not">
  <table>…</table>
</template>
```

Every bound state path must be declared up front — binding an undeclared path throws at initialization. `matched` is a strict boolean (never `null`), so `|not` is safe here.

## Attributes / Inputs

| Attribute | Property | Description |
| --------- | -------- | ----------- |
| `query`   | `query`  | The media query string passed to `matchMedia()`. Changing it while connected tears down the old `MediaQueryList` subscription and subscribes to the new one. Removing the attribute means "watch nothing" — `matched` drops to `false`. An invalid query does not throw (browsers report `media: "not all"`, `matched: false`). |

`query` is the only input, declared in `wcBindable.inputs` with `attribute: "query"`. Property assignment before the element is upgraded is picked up on connect (property upgrade).

## Observable Properties (outputs)

| Property    | Event                   | Semantics | Description |
| ----------- | ----------------------- | --------- | ----------- |
| `matched`   | `wcs-media-query:change` | `state`  | `MediaQueryList.matches`. `false` whenever there is no live list (unsupported, empty `query`, or a `matchMedia` call that threw). |
| `media`     | `wcs-media-query:change` | `state`  | The browser-normalized `MediaQueryList.media` string (`"not all"` for an invalid query); `""` when there is no list. |
| `supported` | `wcs-media-query:change` | `state`  | `true` when `matchMedia` is a function in this environment, resolved on every subscription (never cached at construction). |

All three derive from the single `wcs-media-query:change` event (a full snapshot `{ matched, media, supported }`), so a query change that flips `media` and `matched` together arrives as one consistent update. Values are primitives; there are no live handles or owned objects to release.

## Commands

**None.** A `MediaQueryList` has no action to invoke. `<wcs-media-query>` is a pure monitor.

## Notes & limitations

- **One tag, one query.** Compose several `<wcs-media-query>` elements for several queries; a `queries` array would break the "one event plus derived getters" shape every node shares.
- **The initial snapshot *event* misses bindings, but the value still arrives.** The first `wcs-media-query:change` fires synchronously during `connectedCallback` — before `@wcstack/state` attaches its binding listeners — and events are not replayed to late subscribers. The value is not lost, because every observable here is output-only, which makes the default binding authority `element`: the binding reads the property directly when it attaches (directional initial sync). Only with `enableDirectionalInitialSync: false` do you need a manual `$connectedCallback` + `whenDefined` pull.
- **Generation guard.** Subscribing is synchronous, but a query change *replaces* a subscription. Each subscription's `change` listener captures a generation and ignores events once a newer subscription exists, so a `MediaQueryList` whose `removeEventListener` misbehaves can never write the old query's value over the new one's. See `docs/media-query-tag-design.md` §6.
- **Old Safari.** If the list lacks `addEventListener`, the deprecated `addListener` / `removeListener` pair is used; if it has neither, only the snapshot taken at subscription time is reported.
- **Reconnect re-subscribes.** Removing and re-inserting the element tears down the listener on disconnect and re-establishes it (for the current `query`) on reconnect.
- **SSR (`@wcstack/server`).** Declares `static hasConnectedCallbackPromise = true` and exposes `connectedCallbackPromise`; since `observe()` is synchronous this promise settles immediately. Without a `matchMedia` (Node), `supported` and `matched` are `false` and `media` is `""`.
- **Same-value guard.** A field-by-field comparison suppresses a redundant dispatch — a legacy `addListener` double-fire, or re-subscribing to an equivalent query the browser normalizes to the same `media`.

## CSS styling with `:state()`

`<wcs-media-query>` reflects two boolean output states onto its
[`ElementInternals` `CustomStateSet`](https://developer.mozilla.org/en-US/docs/Web/API/CustomStateSet),
so you can style from CSS with the `:state()` pseudo-class — no `data-wcs`
binding or class toggling required.

| State | On when |
|-------|---------|
| `matched` | `wcs-media-query:change` fires with `matched === true` |
| `supported` | `wcs-media-query:change` fires with `supported === true` |

`media` is a string and is not reflected.

```css
/* Sibling-driven theming without JS glue */
wcs-media-query:state(matched) ~ main { color-scheme: dark; }
body:has(wcs-media-query:not(:state(supported))) .needs-js-media { display: none; }
```

Unlike attributes or classes, `:state()` cannot be written from outside the
element, so there is no risk of confusing this output state with an input.

**Browser support** (`:state(x)` syntax): Chrome/Edge 125+, Safari 17.4+,
Firefox 126+. In older browsers the states are simply never set — `:state()`
selectors never match, but `<wcs-media-query>` itself keeps working normally
(graceful degradation, never-throw).

**SSR**: `:state()` cannot be serialized into HTML, so server-rendered markup
never carries these states on first paint (`@wcstack/server` is unaffected).
If you need to style the pre-hydration gap, pair your rule with
`wcs-media-query:not(:defined)` instead.

### Debugging

Custom states are invisible in DevTools' Elements panel and `attachInternals()`
cannot be called twice, so there is no console way to inspect them directly.
Two debug-only aids are provided for that:

- `el.debugStates` — a **snapshot** array of the currently-on state names
  (e.g. `["matched", "supported"]`). It is not part of `wc-bindable` (not a bind
  target) and its shape is not a guaranteed contract — use it for debugging only.
- The `debug-states` attribute (opt-in, default off) mirrors state changes
  onto `data-wcs-state-matched` / `data-wcs-state-supported` attributes on
  the element, so the Elements panel highlights them as they toggle:

  ```html
  <wcs-media-query query="(max-width: 600px)" debug-states></wcs-media-query>
  ```

**Write your CSS against `:state()`, not `data-wcs-state-*`.** The mirrored
attributes exist purely to make state changes visible while debugging with
DevTools open; they are not a supported styling hook.

## Headless usage (`MediaQueryCore`)

The Core has no DOM dependency and can be used directly with `bind()` from `@wc-bindable/core`:

```typescript
import { MediaQueryCore } from "@wcstack/media-query";

const mq = new MediaQueryCore();
mq.addEventListener("wcs-media-query:change", (e) => {
  console.log((e as CustomEvent).detail); // { matched, media, supported }
});

mq.observe("(prefers-color-scheme: dark)"); // synchronous — no promise to await for data
console.log(mq.matched);

mq.observe("(max-width: 600px)");            // switch query: old list released, new one subscribed

// later, when done:
mq.dispose();                                 // detach the live `change` listener
```

Constructor: `new MediaQueryCore(target?, { matchMedia? })`. `target` is the `EventTarget` events are dispatched to (the Core itself when omitted); `matchMedia` injects the function to call instead of resolving `globalThis.matchMedia` at call time — useful in tests and non-window hosts. The lifecycle is manual: `observe(query)` / `dispose()`.

The structural Core surface is normative across wcstack IO nodes ([async-io-node-guidelines §3.9](../../docs/async-io-node-guidelines.md)); to bind it into signals with no element at all, see [@wcstack/signals — Binding a Core directly](../signals/README.md#binding-a-core-directly-no-element).

## License

MIT
