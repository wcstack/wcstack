# @wcstack/view-transition

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

`@wcstack/view-transition` gives a wcstack page **leave and move animations** — the two things CSS alone cannot do for DOM that a framework removes.

日本語版: [README.ja.md](./README.ja.md)

```html
<script type="module" src="https://esm.run/@wcstack/view-transition/auto"></script>

<wcs-view-transition></wcs-view-transition>
```

That is the whole opt-in. From then on, route swaps by `@wcstack/router` and list / branch updates by `@wcstack/state` run inside a [View Transition](https://developer.mozilla.org/docs/Web/API/View_Transition_API), and you style them in CSS against `::view-transition-*`.

`<wcs-view-transition>` is a **policy node**, not an I/O node: it renders nothing, binds no data, and describes no animation. It decides *whether* a DOM change animates and *what happens when two of them collide*. The animation itself stays in CSS, where it belongs.

- **inputs**: `for`, `mode`, `naming`, `naming-limit`, `reduced-motion`, `types`, `disabled`
- **outputs**: `active`, `error`
- **commands**: `skip()`

## What you already had without this package

Worth knowing before you install anything, because two thirds of the problem never needed a package:

```css
/* Enter: a newly inserted row / branch animates in, no JS involved. */
li {
  transition: opacity 0.2s, transform 0.2s;
  @starting-style { opacity: 0; transform: translateY(-4px); }
}
```

`class.x:` and `style.y:` bindings write to the live element, so ordinary CSS transitions apply to any value change. `@starting-style` covers **entering** elements — which is exactly what a new `for` row and a mounting `if` branch are.

What CSS cannot reach is **leaving**: wcstack detaches removed nodes synchronously, so by the next paint there is nothing left to animate. And a reorder is a series of `insertBefore` calls with no intermediate state, so a **move** cannot be tweened either. That is what this package is for — the browser snapshots the old state before the change, so a leaving element does not have to survive it.

## Install

```bash
npm install @wcstack/view-transition
```

## Quick start

### Route transitions only

```html
<wcs-view-transition for="router"></wcs-view-transition>

<style>
  ::view-transition-old(root) { animation: fade-out 0.2s both; }
  ::view-transition-new(root) { animation: fade-in 0.2s both; }
</style>
```

`for="router"` keeps `@wcstack/state`'s update timing untouched (see [Contract](#contract)).

### List rows that move and fade

```html
<wcs-view-transition naming="auto"></wcs-view-transition>

<ul>
  <template data-wcs="for: todos">
    <li>{{ .title }}</li>
  </template>
</ul>

<style>
  /* every auto-named row shares the wcs-row group class */
  ::view-transition-group(*.wcs-row) { animation-duration: 0.25s; }
  ::view-transition-old(*.wcs-row) { animation: fade-out 0.25s both; }
  ::view-transition-new(*.wcs-row) { animation: fade-in 0.25s both; }
</style>
```

## Attributes

| Attribute | Values | Default | Meaning |
|---|---|---|---|
| `for` | `router`, `state` (space-separated) | `router state` | Which participants animate. |
| `mode` | `latest` / `queue` / `exhaust` | `latest` | What happens when a change arrives while a transition is running — see [Exclusion](#exclusion). |
| `naming` | `manual` / `auto` | `manual` | Who assigns `view-transition-name` — see [Naming](#naming). |
| `naming-limit` | integer | `200` | Cap on auto-assigned names. |
| `reduced-motion` | `skip` / `animate` | `skip` | `skip` honors `prefers-reduced-motion: reduce` by applying changes without animating. |
| `types` | space-separated | — | Passed to `startViewTransition({ types })` where supported, for `:active-view-transition-type()`. |
| `disabled` | boolean | absent | Inert: every change applies immediately, no transitions. Bindable, so a page can switch animation off from state. |

One `<wcs-view-transition>` per document. A second one warns and stays inert rather than fighting the first over the exclusion it exists to provide.

## Contract

The rule everything else is subordinate to: **a DOM change is applied exactly once, whatever happens to its animation.** An unsupported browser, a hidden tab, `prefers-reduced-motion`, `disabled`, a collision, or a `startViewTransition` that throws all still end with the change applied. The page is never left showing stale DOM because an animation could not play.

Two consequences worth knowing before you add the tag:

1. **`for="state"` (on by default) makes the state drain asynchronous.** Today's drain lands on a microtask; inside a transition it lands on a frame. Code that writes state and then reads the DOM after `await Promise.resolve()` needs to wait for the transition instead. `$updatedCallback` is unaffected — it still fires right after the bindings are applied. Use `for="router"` to keep the drain exactly as it was.
2. **Participation is per document, not per element.** One updater drains every `<wcs-state>` on the page, so `for="state"` turns transitions on for all of them.

Transitions are skipped — and the change applied synchronously, on exactly today's timing — when the browser has no `startViewTransition`, when `document.hidden` is true (a background tab gets no rendering opportunities, so a transition there would freeze the DOM until you look at the tab again), under `prefers-reduced-motion: reduce` unless `reduced-motion="animate"`, while `disabled`, and during SSR.

## Exclusion

Transitions cannot nest, so something has to arbitrate. Every request made in the same microtask joins **one** transition (a route change and the state drain it triggers animate together rather than cancelling each other), and `mode` decides what a later collision does:

| `mode` | While a transition is running |
|---|---|
| `latest` | Skip the running one, animate the newcomer. The default. |
| `queue` | Chain: the newcomer starts once the running one has finished. |
| `exhaust` | Apply the newcomer's change immediately, without animating it. |

`exhaust` drops the *animation*, never the DOM update. And in all three modes, a request that arrives before the running transition has taken its snapshot joins that transition, so changes are never applied out of order.

`skip()` finishes the running transition immediately; the DOM change it carries still happens.

## Naming

`view-transition-name` has to be on an element **before** the browser snapshots it, so it cannot be assigned while the change is being made. "Name only what changed" is therefore impossible, and you pick one of two strategies:

**`manual` (default)** — you bind it, and only what should morph gets a name:

```html
<template data-wcs="for: todos">
  <li data-wcs="style.viewTransitionName: .cssName">{{ .title }}</li>
</template>
```

**`auto`** — `@wcstack/state` names the first element of every list row and `if` branch as it mounts, and adds a `view-transition-class` (`wcs-row` / `wcs-branch`) so CSS can address the whole group. The name follows the *content*, so a pooled row reused for another item keeps its name — which is what the DOM actually did.

Auto naming is capped at `naming-limit` (200 by default) because every named element becomes its own snapshot group and a few hundred of them make a transition visibly slow. Past the cap naming stops and says so once in the console. Big lists should use `manual` and name deliberately.

**`auto` is load-order sensitive.** Names are assigned as content mounts, so rows and branches that were already on the page when this tag upgraded never get one — nothing revisits them. Put this package's script tag **before** the `@wcstack/state` one so the arbiter is installed first; otherwise the first render participates in the root snapshot rather than morphing row by row. `manual` has no such ordering constraint, because the name is an ordinary binding.

## Binding it from state

```html
<wcs-view-transition
  data-wcs="disabled: animationsOff; active: transitionRunning"
></wcs-view-transition>
```

`active` tracks whether a transition is running; `error` carries the last failure to start one (both observable). `disabled`, `mode`, `naming`, `types` and `participants` are writable inputs, and `skip` is available as a command token.

## Direct use (no DOM)

```js
import { ViewTransitionCore } from "@wcstack/view-transition";

const core = new ViewTransitionCore();
core.naming = "auto";
core.install();               // become the page's arbiter
await core.run(() => { /* mutate the DOM */ });
```

`install()` publishes the core on a well-known global symbol; `@wcstack/state` and `@wcstack/router` find it there without importing this package. The protocol is described in [docs/view-transition-design.md](https://github.com/wcstack/wcstack/blob/main/docs/view-transition-design.md) §4, and `getTransitionRunner` / `runTransition` / `TRANSITION_RUNNER_KEY` are exported for adopters who want to install an arbiter of their own.

## Demo

[`examples/list-transitions`](./examples/list-transitions/) — enter, leave and move in one page, with a checkbox that switches the arbiter off so the difference is visible. Buildless: open `index.html`.

## Browser support

Same-document View Transitions ship in Chromium 111+ and Safari 18+. Firefox does not have them yet; there, and anywhere else the API is missing, every change applies immediately with no animation and no error — the page keeps working, it just does not animate.

## License

MIT
