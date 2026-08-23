# Scoped custom element registries in wcstack

- **Written**: 2026-08-23
- **Status**: phases 0 and 1 are implemented. Phases 2 and 3 are designed here and **not started** — phase 2 is
  blocked on Firefox, phase 3 is not.
- **Platform baseline**: Chrome/Edge 146 (2026-03) and Safari 26 (2025-09) ship the feature enabled by default.
  Firefox has not shipped it ([bugzilla 1874414](https://bugzilla.mozilla.org/show_bug.cgi?id=1874414)).
- **日本語版**: [scoped-custom-element-registries.ja.md](./scoped-custom-element-registries.ja.md)

A scoped registry lets a shadow tree resolve custom element names against its own
`CustomElementRegistry` instead of `window.customElements`, so two components can share a tag name on one page.
This document records what wcstack already does about that, and what the two remaining phases would take.

## 1. The three facts that carry every decision

Design against the shipped MVP, not against the older drafts. Earlier proposal revisions described registries
that *chain* to a parent, and `ShadowRoot.createElement()` / `ShadowRoot.importNode()` for cloning a template
into a scope. **Neither shipped.** Searching for this feature still surfaces those drafts, so this section
pins the surface that actually exists.

1. **There is no inheritance.** The
   [proposal](https://wicg.github.io/webcomponents/proposals/Scoped-Custom-Element-Registries.html) states it
   plainly: "Definitions in this registry do not apply to the main document, and vice-versa. The registry must
   contain definitions for all elements used." A tree with a scoped registry sees *none* of wcstack's tags
   unless they are defined into that registry too. This is the fact that made phase 1 necessary.
2. **A registry association is immutable.** MDN: "Once set to a `CustomElementRegistry` object, it cannot be
   changed." It is fixed when the element is created — via `createElement`'s option, or by being parsed in a
   context that has a scoped registry. `initialize()` therefore "can only set the registry on nodes where it is
   still `null`". Getting the association wrong is unrecoverable, not merely inconvenient.
3. **Uniqueness is per registry.** `define()` throws `NotSupportedError` when *that* registry already holds the
   name or the constructor. The same class may be defined in the global registry and in any number of scoped
   ones, which is what makes "register wcstack's tags into your registry" a legal move at all.

The shipped surface:

| API | Purpose |
|---|---|
| `new CustomElementRegistry()` | Create an independent registry |
| `attachShadow({ customElementRegistry })` | Associate one with a shadow root; `null` means "no registry yet" |
| `document.createElement(tag, { customElementRegistry })` | Scope an element and its descendants, wherever it is later inserted |
| `registry.initialize(root)` | Set this registry on the subtree's **null-registry** nodes, then upgrade |
| `<template shadowrootmode shadowrootcustomelementregistry>` | Tell the parser to leave the declarative shadow root's registry `null` |
| `Element` / `Document` / `ShadowRoot` `.customElementRegistry` | Read-only; the registry governing that node |

## 2. The constraint that shapes the roadmap: Firefox

Firefox has not shipped scoped registries, and wcstack is a buildless, CDN-first stack whose pages are expected
to run the same everywhere. That yields one rule:

> **Scoping may improve isolation. It may never carry semantics.**

A page whose *behaviour* depends on two trees resolving the same tag name differently is a page that breaks on
Firefox — not gracefully, but by silently binding to the wrong component. So any wcstack feature built on
scoping has to be judged by what it degrades to when `Node.customElementRegistry` is `undefined`.

This inverts the intuitive ordering of the two remaining phases:

- **Phase 2 (DCC local definitions) is gated on Firefox.** Its entire value is "the same tag name means
  different things in different scopes", which is exactly the semantics the rule forbids while a major engine
  lacks the feature.
- **Phase 3 (widget / island mode) is not gated.** Its value is "do not pollute the host page", and it degrades
  to today's behaviour — a global define, with the existing `if (!registry.get(tag))` guard — on Firefox.

## 3. What already landed (phases 0 and 1)

Implemented on branch `feat/scoped-custom-element-registry`.

**Phase 0 — stop breaking.** Every "is this tag defined?" question now resolves against the node it is about,
because with scoped registries that question has no page-wide answer.

| Package | Change |
|---|---|
| `state` | [`platform/customElementRegistry.ts`](../packages/state/src/platform/customElementRegistry.ts) resolves `Node.customElementRegistry`; all call sites pass their node. DCC defines into the registry governing its own host — a global define never applied to its own siblings. |
| `defined` | `DefinedCore` takes the registry to watch; `<wcs-defined>` passes the one its subtree resolves against. |
| `autoloader` | Lazy loading defines into the scanned root's registry, and keeps the in-flight load ledger per registry. |

One invariant is worth restating because everything downstream depends on it:

- `Node.customElementRegistry === undefined` means the platform has no scoped registries → **fall back to the
  global registry**, so behaviour is unchanged everywhere it is not supported.
- `Node.customElementRegistry === null` means the node deliberately has no registry → **do not fall back**.
  Reporting globally-defined tags as usable there would write plain own properties onto elements that are still
  un-upgraded, shadowing the accessors a later upgrade installs — the exact failure the deferred-apply path in
  [state-binding-init-races.md](./state-binding-init-races.md) §2 exists to prevent.

**Phase 1 — make registration addressable.** All 40 packages that ship a `registerComponents.ts` now take the
registry to define into, defaulting to the global one, and each `bootstrapXxx()` threads it through.
`@wcstack/devtools` is deliberately excluded: it defines one tag and appends its panel to `document.body`, so it
belongs to the document's registry rather than to any tree's.

ADR-15 §3.4's fail-fast on a duplicate DCC tag name is unchanged in kind — uniqueness is simply per registry now.

## 4. Phase 2 — DCC local definitions

**Blocked on Firefox shipping.** Do not start before then; see §2.

### What it would unlock

Two `<my-card data-wc-definition>` definitions on one page, in different scopes, each with its own template and
state. Today the second one is a hard error, by deliberate decision
([ADR-15 §3.4](./architecture-hardening/15-state-component-mechanism-consistency.md)).

### What phase 0 already did

`defineDCC` resolves the definition registry from its host element, so a DCC written inside a shadow root that
*already has* a scoped registry registers into that scope rather than globally. The plumbing is done.

### What is actually missing

**wcstack never creates a registry.** Phase 0 only respects one that the page already established. For a DCC
author to get scoping, something has to call `new CustomElementRegistry()` and attach it — and because a
registry association is immutable (§1.2), that must happen at `attachShadow()` time.

wcstack does control one such call: `_ensureShadow()` in
[`defineDCC.ts`](../packages/state/src/dcc/defineDCC.ts) attaches each DCC *instance*'s shadow. Passing a
registry there would make a DCC's internals genuinely private. But because there is no inheritance, a fresh
registry starts empty — the instance's own `<wcs-state>`, and every I/O tag its template uses, would resolve to
nothing. Phase 1 exists so that seeding is possible; deciding *what* to seed is the hard part.

### Decision gates

- **G1** — Does a DCC instance's shadow get its own registry: never, opt-in per definition, or by default?
  Default-on changes the meaning of every existing DCC and is almost certainly wrong.
- **G2** — What is seeded into it? "Everything wcstack ships" is easy but reintroduces the global namespace
  inside every scope; "only what the author declares" is correct but is a new authoring surface, and wcstack has
  no dependency manifest for a DCC today.
- **G3** — What does the duplicate-name diagnostic say once uniqueness is per registry? The current message
  ("`X` is already registered") stops being actionable when the reader cannot tell *which* scope collided.
- **G4** — What is the authored contract on Firefox? Two same-name DCCs must still fail fast there, which means
  an author who relies on scoping has written a page that only works in two of three engines. Either the feature
  is documented as progressive isolation only (never same-name), or it waits for Baseline.

G4 is the one that decides whether phase 2 is worth doing at all.

## 5. Phase 3 — widget / island mode

**Not blocked.** This is the phase with a real user today.

### What it would unlock

Embedding a wcstack widget into a page that wcstack does not own, without claiming a single global tag name —
including a page that already runs a *different version* of wcstack. This is the "framework-absent page" buyer
identified in the go-to-market work, and it is the one place scoped registries pay for themselves immediately.

### What phase 1 already did

`registerComponents(registry)` and `bootstrapXxx(config, registry)` accept the target registry across all 40
packages, so defining the whole stack into a scope is already expressible:

```js
const registry = new CustomElementRegistry();
bootstrapState(undefined, registry);
bootstrapFetch(undefined, registry);
const shadow = host.attachShadow({ mode: "open", customElementRegistry: registry });
```

### What is actually missing

1. **No aggregate entry point.** The snippet above lists every package by hand. The only place that can
   aggregate is the `wcstack` meta-package — which today is a dependency manifest with no runtime role.
2. **Template cloning is unverified.** `state`'s structural rendering (`for` / `if`) clones template content.
   Because a registry travels with the node from creation (§1.2) and `createElement`'s option scopes an element
   "no matter which part of the DOM [it is] later inserted into", the strong expectation is that **a clone
   carries the template's registry, not the destination's** — and since `initialize()` only fills in `null`
   registries, that would be unrecoverable. The shipped MVP has no `ShadowRoot.importNode()` to fix it (§1).
   This must be measured on a real browser before any of phase 3 is designed, because the answer decides whether
   [`structural/createContent.ts`](../packages/state/src/structural/createContent.ts) needs to change at all.
3. **Import maps are document-scoped.** [`importmap.ts`](../packages/autoloader/src/importmap.ts) reads
   `document.querySelectorAll('script[type="importmap"]')`. An island cannot bring its own module map; it reads
   the host page's. That is probably the right semantics — module resolution *is* document-global — but it means
   `<wcs-autoloader>` inside a widget resolves against a map the widget does not control, and that has to be
   said out loud rather than discovered.

### Decision gates

- **G5** — Does `wcstack` gain a runtime entry (`bootstrapAll(registry)`), or does the widget recipe stay
  hand-written documentation? Giving the meta-package a runtime changes what installing it means.
- **G6** — Does structural rendering need scope-aware cloning? Blocked on the measurement in item 2.
- **G7** — Is `<wcs-autoloader>` supported inside an island, and against whose import map?
- **G8** — What is the Firefox fallback contract? The widget's `define` is skipped when the host page already
  defined the tag, so the widget silently runs on the host's version. That is acceptable for a patch-level skew
  and not for a major one, and wcstack has no version negotiation to detect the difference.

### On SSR

Scoped registries do **not** unblock parallel SSR. `renderToString`'s `Mutex` in
[`render.ts`](../packages/server/src/render.ts) exists because 13 globals are swapped, of which
`customElements` is one. What they *do* offer is a future hydration path: declarative shadow DOM with
`shadowrootcustomelementregistry` emits a null-registry tree that the client associates with
`registry.initialize()`. The server does not emit declarative shadow DOM today, so this is downstream of that
work, not of this document.

## 6. Not planned

- **Making scoping load-bearing anywhere in the core.** See §2. Every use is opt-in and degrades to the global
  registry.
- **A scoped registry for `@wcstack/devtools`.** It is a page-level overlay appended to `document.body`; the
  document's registry is the correct target.

## 7. When to revisit

Phase 3's gates can be opened now; the blocking work is the phase-3 item 2 measurement, not a browser.
Phase 2 waits for Firefox to ship — track
[bugzilla 1874414](https://bugzilla.mozilla.org/show_bug.cgi?id=1874414) and
[the web-features entry](https://web-platform-dx.github.io/web-features-explorer/features/scoped-custom-element-registries/).
