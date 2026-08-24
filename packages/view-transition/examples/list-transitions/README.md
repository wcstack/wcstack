# list transitions demo

`@wcstack/state` + `@wcstack/view-transition` (`<wcs-view-transition>`). The two list animations plain CSS cannot reach — **leave** and **move** — plus the one it can, so the difference is visible side by side.

## Getting Started

Open `index.html` in a browser (any static server, or just the file). No build step — everything loads from `esm.run`.

Add rows, shuffle them, remove one. Then tick **disable transitions** and do it again: entering rows still fade in (that is CSS), while leaving and moving snap instantly (that is what the tag was doing).

## Features

- **Enter costs nothing.** `li { transition: …; @starting-style { … } }` animates a newly inserted row. No package is involved — this worked before `@wcstack/view-transition` existed and is written down here because it is easy to miss.
- **Leave and move need the snapshot.** A removed row is detached synchronously and a reorder has no intermediate state, so there is nothing left for CSS to transition. `<wcs-view-transition>` hands the drain's DOM change to `document.startViewTransition`, and the browser captures the old state *before* the change.
- **`naming="auto"`** gives every row a unique `view-transition-name` plus the `wcs-row` group class, so one pair of rules — `::view-transition-old(*.wcs-row)` / `::view-transition-new(*.wcs-row)` — styles the whole list.
- **`data-wcs="disabled: animationsOff"`** switches the arbiter off from state. The DOM change still lands; only the animation is dropped.

## Key Points

- **The tag is a policy node.** It renders nothing, binds no data of its own, and never describes an animation — the animation is CSS against `::view-transition-*`. Remove the tag and the page behaves exactly as it did before, at the original timing.
- **Removal stays synchronous.** No row is kept mounted to animate it, so the list diffing, the content pool and the `if`/`for` invariants are untouched. That is the reason View Transitions were chosen over Vue-style leave classes ([design doc](../../../../docs/view-transition-design.md) §2).
- **One consequence to know.** While the tag accepts the `state` participant (the default), the drain applies on a frame instead of a microtask. Code that writes state and then reads the DOM after `await Promise.resolve()` has to wait for the transition; `$updatedCallback` still fires right after the bindings are applied.
- **Load order matters for `auto`.** Names are assigned as content mounts, so this page loads `@wcstack/view-transition` **before** `@wcstack/state` — otherwise the first rows mount unnamed and never get revisited.
