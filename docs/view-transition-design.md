# Transition animation design — `<wcs-view-transition>` and the transition-runner protocol

**日本語版**: [view-transition-design.ja.md](./view-transition-design.ja.md)

How wcstack animates the DOM changes it makes itself: list rows appearing and
disappearing, `if` branches mounting and unmounting, and routes swapping. This
document fixes the decisions, defines the protocol the packages talk over, and
records the phased rollout.

## 1. What was missing, and what was not

wcstack mutates the DOM in exactly three places:

| Site | Code | How removal happens today |
|---|---|---|
| List rows | [`applyChangeToFor`](../packages/state/src/apply/applyChangeToFor.ts) | `deactivateContent` then `content.unmount()` **synchronously**; nodes are detached at once and the content goes to the per-anchor pool |
| Conditional branches | [`applyChangeToIf`](../packages/state/src/apply/applyChangeToIf.ts) | same — detached the moment the condition turns false |
| Route contents | [`hideRoute`](../packages/router/src/hideRoute.ts) / [`showRoute`](../packages/router/src/showRoute.ts) | `removeChild` then `insertBefore`, synchronously |

Two things already work without any framework change, and were simply never
documented:

- **Value transitions.** `class.x:` and `style.y:` bindings write to the live
  element, so an ordinary CSS `transition` applies.
- **Enter animations.** `@starting-style` (plus `transition-behavior: allow-discrete`
  where a discrete property is involved) covers newly inserted elements, which is
  exactly what a new list row and a mounting `if` branch are.

What was genuinely missing is **leave** and **move**:

- a row / branch / route that is removed cannot animate out, because its nodes are
  gone by the time the next frame is painted;
- a reordered list cannot animate the move, because the reorder is a series of
  `insertBefore` calls with no intermediate state.

## 2. Why the View Transition API, and not enter/leave classes

The obvious alternative — Vue-style `.x-leave-active` classes with a deferred
`unmount()` — requires keeping removed content in the DOM until its animation
finishes. That collides with every invariant `applyChangeToFor` currently relies
on: the sequential `lastNode` walk and the `stableIndexSet` / `isPhysicallyAfter`
position guard, the content pool (a leaving content must not be handed to a new
row), re-entry when the same key is re-added mid-leave, whether a leaving row
still receives state updates, the `parentNode.textContent = ''` full-clear fast
path, and the MutationObserver skip marks.

The View Transition API sidesteps all of it: the browser snapshots the old state
*before* the mutation, so a leaving element does not have to exist afterwards.
Removal stays synchronous and immediate, the pool and the ledgers are untouched,
and reorder morphing comes for free once elements carry a `view-transition-name`.

That makes View Transitions the mechanism for Phases 1–2. Enter/leave classes stay
on the table as Phase 3, to be justified by demand rather than by symmetry with
other frameworks.

## 3. Decisions

| # | Question | Decision |
|---|---|---|
| G1 | May the synchronous drain contract be broken? | **Yes, opt-in.** Wrapping the drain in `startViewTransition` moves the DOM mutation to a later frame. The opt-in is the presence of `<wcs-view-transition>`, narrowable with `for=`. |
| G2 | How is exclusion handled (one transition at a time)? | **By the `<wcs-view-transition>` tag.** It is the single arbiter: it coalesces every request made in the same microtask into one transition and applies a declared `mode` (`latest` / `queue` / `exhaust`) when one is already running. |
| G3 | Automatic or manual `view-transition-name`? | **Both, selected on the tag** via `naming="manual" \| "auto"` (default `manual`). |
| G4 | `prefers-reduced-motion` | **Skip by default.** The mutation then runs synchronously — byte-for-byte today's behavior. Override with `reduced-motion="animate"`. |
| G5 | SSR / hydration | **Disabled.** The arbiter itself refuses to start a transition while the document carries `data-wcs-server`, and the tag is inert without `document.startViewTransition`. The gate lives in the arbiter, not in each participant: the protocol is public, and a third-party participant has no reason to know wcstack's SSR marker. `@wcstack/state` keeps its own `inSsr()` short-circuit as a fast path, and `@wcstack/router` needs none. |

## 4. The transition-runner protocol

The packages must not depend on each other, so `@wcstack/state` and
`@wcstack/router` do not import the tag. They look up a runner on a well-known
global symbol, and fall back to calling the mutation directly when there is none —
which is exactly today's behavior.

Canonical source: [`/protocol/transition-runner.ts`](../protocol/transition-runner.ts),
mirrored into each consuming package as `src/protocol/transitionRunner.ts` by
`scripts/sync-protocol-types.mjs`.

```ts
const TRANSITION_RUNNER_KEY = Symbol.for("wcstack.transition-runner");

interface IWcsTransitionRunner {
  readonly protocol: "wcs-transition-runner";
  readonly version: number;            // readers accept >= 1
  readonly naming: "manual" | "auto";
  readonly namingLimit: number;        // max auto-assigned names (see §6)
  accepts(source: string): boolean;    // participant gate, backs `for=`
  run(mutate: () => void, options?: { source?: string; types?: readonly string[] }): Promise<void>;
}
```

Rules:

1. **`run()` always invokes `mutate` exactly once.** A transition that cannot start
   (unsupported browser, reduced motion, `disabled`, an already-running transition
   under `exhaust`) is not a reason to drop a DOM update.
2. **The returned promise resolves after `mutate` ran**, not after the animation
   finished. Participants that must sequence work after the DOM changed (the
   router updating `router.path`) await it; nothing waits for the animation.
3. **When the transition is skipped, `mutate` runs synchronously** inside `run()`.
   This keeps the reduced-motion and unsupported paths on exactly the timing they
   have today.
4. **Requests in the same microtask join one transition**, in call order. A route
   change and the state drain it triggers animate as a single transition rather
   than fighting each other.
5. **A throwing `mutate` never takes the batch down.** Each mutation is isolated;
   its own promise rejects, the others still run.
6. **No runner, or `accepts(source) === false`, means synchronous apply.** Neither
   package changes behavior unless the tag is on the page.
7. **A participant does not call `run()` for a mutation that changes nothing.** The
   arbiter has no way to tell an empty mutation from a real one, and a transition
   it starts for one is not merely wasted: it takes a full-page snapshot, and under
   the default `latest` it *skips the transition already running*. Filtering is the
   participant's job because only the participant knows whether it has work — see
   §7.2 for the case that makes this concrete.

## 5. `<wcs-view-transition>`

A policy node, not an I/O node: it has no data to bind, it declares how transitions
behave for the whole page. One per document.

| Attribute | Values | Default | Meaning |
|---|---|---|---|
| `for` | space-separated participants (`router`, `state`) | `router state` | Which participants animate. `for="router"` leaves the state drain fully synchronous. |
| `mode` | `latest` / `queue` / `exhaust` | `latest` | What happens when a request arrives while a transition is running. `latest`: skip the running one and start a new one. `queue`: chain after it finishes. `exhaust`: apply the mutation immediately, without animating. In every case the mutation is applied. |
| `naming` | `manual` / `auto` | `manual` | See §6. |
| `naming-limit` | integer | `200` | Cap on auto-assigned names. |
| `reduced-motion` | `skip` / `animate` | `skip` | G4. |
| `types` | space-separated | — | Passed to `startViewTransition({ types })` where supported, for `:active-view-transition-type()` styling. |
| `disabled` | boolean | absent | Inert runner: every request applies synchronously. Lets a page keep the tag and switch transitions off from state. |

wc-bindable surface: `active` (a transition is running) and `error` as observable
properties, `disabled` / `mode` / `naming` / `types` as inputs, and `skip` /
`start` commands.

## 6. Naming

`view-transition-name` must already be on an element **before** the snapshot is
taken, so it cannot be assigned inside the mutation callback. That rules out
"name only what changed" and forces the choice the `naming` attribute exposes:

- **`manual` (default).** The author binds it: `style.viewTransitionName: id`.
  Works today, costs nothing, and gives full control over which elements morph.
- **`auto`.** `@wcstack/state` assigns a unique, stable `view-transition-name` to
  the first element of every structural content (list row, `if` branch) as it
  mounts, plus a `view-transition-class` (`wcs-row` / `wcs-branch`) so CSS can
  address the whole group. The name follows the *content*, so pooled reuse and
  reordering both behave the way the DOM does.

Auto naming is capped (`naming-limit`, default 200 names). Every named element
becomes its own snapshot group, and a few hundred of them make a transition
visibly slow; past the cap state stops naming and warns once. A page with big
lists should name deliberately in manual mode.

The counter and the cap live on a `Symbol.for` slot rather than in module scope,
for the same reason the runner key does: two copies of `@wcstack/state` on one page
would otherwise both mint `wcs-row-1`, and a duplicate `view-transition-name`
makes the browser abort the whole transition.

Naming happens as content mounts, so it is **load-order sensitive**: rows and
branches that mounted before `<wcs-view-transition>` upgraded are never revisited
and stay unnamed. Put the tag's script ahead of the state bundle, or accept that
the first render participates in the root snapshot instead of morphing per row.

## 7. Participant contracts

### 7.1 `@wcstack/router`

[`showRouteContent`](../packages/router/src/showRouteContent.ts) is split into a
**guard phase** and a **mutate phase**, and only the mutate phase is wrapped. A
route guard may await anything; running that inside the update callback would hold
the transition open for as long as the guard takes (and the browser gives it about
four seconds). The split also fixes an ordering wart: previous routes were hidden
before the guards ran.

**The first route application is never wrapped**, on the same rule state follows
("initial rendering is never wrapped") and for the same reason: with no previous
route there is no old state to animate against — that is an entrance, and entrances
belong to `@starting-style` (§1). It is also load-bearing. The router awaits its
first route application inside `_initialize`, at a point where the document has not
had its first render; a transition started there can sit in Chromium without its
update callback ever being called, and the router then never finishes initializing.
Only a real browser reproduces it, so `e2e/tests/view-transition.spec.ts` is the
regression test.

The `navigate` event's `intercept({ handler })` awaits `run()`, so navigation is
"in progress" until the DOM has changed, and not for the duration of the animation.

### 7.2 `@wcstack/state`

The single wrap point is the drain in
[`Updater._applyChange`](../packages/state/src/updater/updater.ts) —
`applyChangeFromBindings(processBindings)`. Consequences, normative:

- The drain is already a microtask; with a transition it becomes **a frame**. Code
  that writes state and then reads the DOM after `await Promise.resolve()` must
  instead await the transition (or use `$updatedCallback`, which still fires after
  the bindings have been applied, inside the callback).
- **The mechanism order inverts.** `notifyUpdateBatchListeners` runs in the drain's
  `finally`, on the original microtask, because `$watch` and the `$streams` restart
  consume state addresses and not the DOM. `$updatedCallback` rides with the
  bindings into the update callback. So the order the state README declares fixed —
  `$updatedCallback` → `$watch` → `$streams` restart — becomes
  `$watch` → `$streams` restart → `$updatedCallback` while the arbiter accepts
  `state`. This is deliberate (holding `$watch` for a frame would be worse), and it
  is the one documented exception to that layer being fixed.
- **A batch with no bindings to apply is never handed to the arbiter.** Every write
  is enqueued whether or not its path is bound, so the drain routinely runs with
  `processBindings.length === 0` — a `$watch`-only path, a `$streams` internal
  value, the intermediate addresses of a list replacement. Asking for a transition
  there would snapshot the whole page for a mutation that changes nothing, and
  under `latest` it would cut short a route transition that *is* animating.
- Participation is **per document, not per element**: one updater drains every
  `<wcs-state>`, so `for="state"` turns it on for all of them.
- Initial rendering is never wrapped. Only the drain is.
- `inSsr()` short-circuits to the synchronous path (G5).

## 8. Invariants

1. A page without `<wcs-view-transition>` behaves exactly as before — same code
   path, same timing, no cost beyond one symbol lookup per drain.
2. A DOM mutation handed to `run()` is applied exactly once, whatever the runner
   decides about animating it.
3. The runner never rejects for its own reasons; only a throwing `mutate` rejects.
4. Removal stays synchronous everywhere. No content is kept mounted to animate it.
5. Auto-assigned names are unique for the lifetime of the document.
6. A participant hands the arbiter only mutations that change something. An empty
   batch takes the synchronous path, so no transition is ever started — and none is
   ever cancelled — on behalf of a change nobody can see.

## 9. Roadmap

| Phase | Content | Status |
|---|---|---|
| **0** | This document; the "already possible" surface (`@starting-style`, `style.viewTransitionName`, class toggling instead of `if`) written down where users find it | done |
| **1** | The `@wcstack/view-transition` package (protocol, tag, arbitration) and the router integration, including the guard/mutate split | done |
| **2** | The state drain integration, auto naming, and the timing-contract amendment | done |
| **3** | Declarative enter/leave classes with deferred unmount (§2) | not started — needs demand, and an ADR fixing the invariants §2 lists |

## 10. Non-goals

- Animating something the framework does not itself mutate. That is CSS's job.
- A JS animation API. `<wcs-view-transition>` starts and arbitrates transitions;
  the animation itself is written in CSS, against `::view-transition-*`.
- Cross-document transitions (`@view-transition { navigation: auto }`). An SPA
  router never leaves the document, so the same-document API is the only one that
  applies.
