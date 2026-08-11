# Wiring a graph of live handles through the DOM (handle graph wiring)

- **Written**: 2026-08-02
- **Status**: ✅ **adopted (2026-08-02)**. G1, G2, and G6 are approved by the user; G3, G4, and G5 are adopted as recommended (see §8). The implementation plan is [audio-impl-plan.md](../audio-impl-plan.md).
- **What prompted it**: [examples/synth-playground](../../examples/synth-playground/) (2026-08-01, `1e26a2a9`) — an experiment handling the Web Audio API declaratively through 14 `<wcs-*>` tags. Deciding whether to promote it into a package demands one decision at the level of the whole system.
- **Prerequisites**: [11-react-immutable-snapshot-boundary.md](11-react-immutable-snapshot-boundary.md) (ja) (separating state / event / handle), [12-wc-bindable-observable-inventory.md](12-wc-bindable-observable-inventory.md) (the handle inventory — 1 out of 231 properties), [camera-recorder-tag-design.md](../camera-recorder-tag-design.md) (ja) §1 and §2 (the invariant that a raw handle does not enter state), [async-io-node-guidelines.md](../async-io-node-guidelines.md) (the normative node skeleton).
- **Relation to the cross-cutting principles**: the README's cross-cutting principle **3, "do not mix the meanings of values, events, commands, and live handles"**, is tested here for the first time in the form of "there are several live handles and they connect to each other".
- **日本語版**: [14-handle-graph-wiring.ja.md](14-handle-graph-wiring.ja.md)

---

## 0. What is new here

Every existing I/O node has this shape:

> **Tags are independent of one another, and only a state path holds the relationship between them** (Path as the Universal Contract).

Web Audio is different. `OscillatorNode → BiquadFilterNode → GainNode → destination` — **the connection relationship itself is the substance of the processing**, and that relationship is not a value. The "non-serializable live handle" camera brought in was a single one; audio has N of them, and **the handles are wired to each other**.

| | Existing nodes | camera (2026-06) | audio (this document) |
|---|---|---|---|
| What flows | serializable values | one `MediaStream` | a directed graph of `AudioNode`s |
| Exposing the handle | — | exposed through `streamReady` (the only instance of the handle classification) | **undecided (G2)** |
| The relationship between tags | through a state path | pass-through of a command-token argument (handing over one handle) | **the topology itself (undecided, G1)** |
| Where the relationship is described | `data-wcs` | `data-wcs` | **undecided (G1, G3)** |

The novelty is not "handling a handle" — camera settled that. The novelty collapses onto one point: **who owns the connection topology between handles, and how it is described**.

### 0.1 The part the system has already answered

Per the inventory ([12](12-wc-bindable-observable-inventory.md) §3), **worker / websocket / broadcast each hold a non-serializable live handle internally (`Worker` / `WebSocket` / `BroadcastChannel`) and expose no handle at all**. Core owns it, Core destroys it, and only values and events go out. camera exposed a handle because it **had to hand the `MediaStream` to another element** (recorder, `<video>`), not because it was a handle.

→ **audio's handles do not need to leave the element** (the graph closes within the package). So there is a good chance G2 can be settled as "do not expose", and that is the first thing this ADR should confirm.

---

## 1. Decision gate G1 — who owns the topology [✅ decided: option D]

Where does the fact that `<wcs-osc>` is connected to `<wcs-filter>` live?

| Option | Where the topology lives | Assessment |
|---|---|---|
| **A. The DOM owns it** | nesting is the signal chain; an id reference through `out=`/`param=` is everything else. What synth-playground does today | Matches the core idea that "HTML does the wiring". You can read the patch from View Source. But the DOM doubles as the computation graph — a liberal reading of HTML semantics |
| B. state owns it | put a patch description (an array/object) in state and have the root read it and assemble the graph | The topology becomes a "value" and rides diff / computed / JSON persistence. But it is a return of the contradiction camera §1 forbade — treating something that never settles as a value — and the wiring disappears from HTML (approaching what killed Polymer: forcing a proprietary runtime onto both ends) |
| **C. The DOM holds structure, state only parameters** | the topology is the DOM (option A), and only numbers such as `frequency` / `gain` flow from state | Today's design plus wcBindable. A clean separation of responsibility, explainable in one line: **"structure is declared, values react"** |
| D. A descriptor is canonical and the DOM is one representation of it | Core receives a patch description as a plain object. The DOM walker is the layer that produces it | A superset of C. Core becomes DOM-independent and satisfies [the MUST NOT of guidelines §3.1](../async-io-node-guidelines.md). A headless adopter can assemble a patch directly |

- **Recommendation: D (C carried all the way to the Core/Shell boundary)**.
  - Reason 1: guidelines §3.1 makes it normative that "Core MUST NOT depend on DOM elements". Putting a graph compiler that walks the DOM into Core violates that immediately. Interposing a descriptor tree does not.
  - Reason 2: since Core is a public headless surface (§3.9), "a patch is a data structure" is meaningful as public API under semver.
  - Reason 3: testability. Verifying the connection shape of the graph can be written without the DOM (§7 below).
- **Consequence**: "the topology is not a value, so it does not go into state" is preserved, while admitting that "the topology *is* **describable data**". The two are compatible (a value is something that flows reactively; a description is something read once at construction).

> **The G1 question**: is it acceptable to make a descriptor tree the canonical topology and position the DOM as one authoring surface for it?

---

## 2. Decision gate G2 — do handles go out through wcBindable [✅ they do not]

| Option | Content | Assessment |
|---|---|---|
| **A. Do not expose (self-contained)** | `AudioNode`s are owned and destroyed by Core. Only values (`state` / `error` / `voices`, …) and events are exposed | The same shape as worker / websocket / broadcast. **The handle inventory stays at 1 and does not grow** — meaning it adds none of the per-adapter failure modes [12 §5.6](12-wc-bindable-observable-inventory.md) listed (signals' same-value dedupe, resource retention through RxJS replay, becoming `undefined` under Qwik serialization) |
| B. Expose | expose `AudioNode` with `semantics: "handle"` so it can be passed between elements | Lets it connect to outside Web Audio code. But the handles become N and those three failure modes surface N-fold |

- **Recommendation: A (do not expose)**. If external interoperation becomes necessary, add one **command-token argument pass-through** of the same shape as camera (`command.connectTo(node)`) later. That is a backward-compatible addition, and there is no reason to open it up in advance.
- **Consequence**: the audio package becomes a node that "holds a graph of live handles internally but lets only values cross the protocol boundary". **To the system it is the same shape as the existing worker / websocket**, and it demands no new observation semantics.

> **The G2 question**: may we fix as an invariant that `AudioNode` is not exposed through wcBindable and stays internal?

---

## 3. Decision gate G3 — do we generalize the wiring notation [✅ keep it local]

How should the wiring attributes `out="bus"` / `out="vcf.frequency"` / `param="frequency"` — a separate system from `data-wcs` — be positioned?

- Premise: per the criteria in [feedback: data-wcs is wiring, not a DSL](../../CLAUDE.md), `data-wcs` exists to "connect a state path with an element endpoint". **A direct element↔element connection has different semantics** and cannot ride on `data-wcs` (letting it would turn data-wcs into a general-purpose wiring DSL).

| Option | Content | Assessment |
|---|---|---|
| **A. Keep them as package-local attributes** | `out=` / `param=` are `@wcstack/audio` vocabulary. No other package uses them | Do not generalize from a single instance (YAGNI). Extract later if a second case appears with a video graph or WebGPU |
| B. Build a cross-cutting general wiring attribute now | make `wire-out=` and the like normative vocabulary across every package | There is only one instance to base the abstraction on. The cost of a wrong generalization is high |

- **Recommendation: A**. But **make it follow the cross-cutting rules on two points**:
  1. **Resolve ids from `getRootNode()`** (`Document | ShadowRoot`) — the rule fullscreen / pointer-lock / intersection / resize have already unified on ([Fullscreen.ts:152](../../packages/fullscreen/src/components/Fullscreen.ts#L152) and others). synth-playground's `document.getElementById` cannot resolve inside a Shadow DOM and has not caught up with that rule.
  2. **Choose an attribute name unlikely to collide, in case of a later extraction.** `out` is too generic (★ G3-a: keep `out` or make it `audio-out`).

> **The G3 question**: is it acceptable to keep the wiring notation package-local, aligning only id resolution with the existing target-reference rule? And should the `out` attribute name stay as-is or be renamed?

---

## 4. Decision gate G4 — the application-time contract for a node with an external clock [✅ expose desired only; a first for wcstack]

This is a topic the system did not have until synth-playground was read.

`AudioContext` has **a clock and a thread of its own**, `currentTime`. `param.setTargetAtTime(v, ctx.currentTime, 0.02)` does not mean "become v right now" but "approach it exponentially from the audio thread's render quantum boundary onward". The contracts in [timing-and-firing-contract.md](../timing-and-firing-contract.md), meanwhile, are written **entirely in the main thread's sync / microtask / task**.

- The nearest precedent is raf §18.4, "a state write originating from tick reaches the DOM exactly one frame late". But audio's delay is the render quantum (128 samples) plus `outputLatency`, hardware-dependent, and **cannot be written into a contract as a fixed value**.
- So it takes **the opposite** of wakelock's desired / actual pair (§15.1, "only `held` is exposed"):

| Option | Content | Assessment |
|---|---|---|
| **A. Expose desired only; actual is not exposed** | a write is accepted synchronously and the getter returns "the last desired value written". The time at which it becomes audible is not guaranteed (stated in the contract) | A contract can be written. The same-value guard closes over the desired side. It also matches user expectation (move a slider and the UI follows instantly, the sound a few ms later) |
| B. Read actual back and expose it | read `param.value` and publish the effective value | The reading depends on the render quantum boundary and the same-value guard stops working. It is meaningless unless observed every frame, which makes it raf's job |

- **Recommendation: A**. The contract wording (added as a new section to timing-and-firing-contract.md):
  > A write to an input property is accepted synchronously and the getter returns the new value immediately (desired). **The time at which that value becomes audible depends on the AudioContext's render quantum boundary and output latency, and this contract does not specify it.** The effective value (actual) is not exposed.

> **The G4 question**: may "a node with an external clock exposes desired only and does not specify the application time" be added to timing-and-firing-contract.md as a cross-cutting contract?

---

## 5. Decision gate G5 — the firing contract for structural changes [✅ make it normative]

A parameter change is reflected live; a structural change (adding or removing a tag, rewriting `out=`) induces a graph rebuild. A rebuild comes with **an audible side effect: it cuts off the sound currently playing**.

- The nearest precedent is resize §12.3, "idempotent for the same element and options / a change tears down and rebuilds, re-delivering the first entry". Same shape, except that audio's rebuild cost is **audible to the user**.
- synth-playground's implementation attaches a `MutationObserver` with `subtree: true` and **rebuilds the whole graph on any DOM change** ([wcs-synth.js:538-539](https://github.com/wcstack/wcstack/blob/1e26a2a92a009fc3e78aab37db7560cb953424ec/examples/synth-playground/wcs-synth.js#L538-L539) — the prototype was deleted in `cbd5598e`, so the link points at the commit before that). Adding a single `<div>` for a control cuts off the sound. At package quality, the granularity of observation is itself part of the contract.

- **Recommendation**: state the following three points explicitly as contract.
  1. **Enumerate the DOM changes that induce a rebuild** (adding/removing/moving an audio tag; changing the `out=`, `param=`, or `note` attributes). No other DOM change induces a rebuild (MUST NOT).
  2. **A rebuild cuts off the sound currently playing** (it comes with an audible discontinuity). State that side effect in the README and the contract.
  3. **Rebuilds coalesce on a microtask.** synth-playground uses `setTimeout(0)` ([wcs-synth.js:596](https://github.com/wcstack/wcstack/blob/1e26a2a92a009fc3e78aab37db7560cb953424ec/examples/synth-playground/wcs-synth.js#L596)) and has not caught up with the cross-cutting contract §3, "microtasks precede tasks".

> **The G5 question**: may the three points above be made normative as a new section of timing-and-firing-contract.md?

---

## 6. Decision gate G6 — do we include tags that have an appearance [✅ we do not]

synth-playground has two tags that draw UI (`<wcs-keys>`, a keyboard, and `<wcs-scope>`, an oscilloscope drawn on canvas).

- Among wcstack's published packages, **only `@wcstack/devtools` has an appearance**, and it is an explicit exception as a development tool. Every member of the I/O node family is "a declarative wrapper over a Web standard API" and does no drawing.
- A keyboard and an oscilloscope are not wrappers over a Web standard API; they are UI widgets. Breaking that boundary steps into a different product definition, "wcstack is also a UI component collection".

- **Recommendation: do not include them**.
  - `<wcs-analyser>` (exposing only `AnalyserNode`'s data, drawing nothing) is included. Drawing is done by the user with `<wcs-raf>` plus canvas. **That preserves the invariant that wcstack has no appearance**.
  - `<wcs-keys>` stays in examples (part of a demo, not the product).

> **The G6 question**: do we confirm "the I/O node family does no drawing" as an explicit invariant and drop keys / scope from the package?

---

## 7. Consequences

1. **The system gains no new observation semantics.** The handle inventory stays at 1. It brings no additional failure mode to the adapter side (React / signals / RxJS / Qwik).
2. **Only two things are new**: (a) the Core shape that makes a descriptor tree the canonical patch, and (b) the application-time contract for a node with an external clock (G4). Both are **additions** to existing norms, not changes.
3. **Core becomes DOM-independent**, so tests for the graph's connection shape can be written on happy-dom without the DOM (feeding a descriptor tree to a mock AudioContext that records `connect` calls). Verifying actual sound remains the job of the existing Playwright smoke test.
4. **`out=` stays audio-local vocabulary**, and promotion to a cross-cutting one is deferred until a second instance appears.

## 8. The decision gates

| Gate | Question | Decision |
|---|---|---|
| G1 | make a descriptor tree the canonical topology and position the DOM as an authoring surface? | ✅ **option D** (approved 2026-08-02) |
| G2 | fix the invariant that `AudioNode` is not exposed through wcBindable? | ✅ **option A, do not expose** (approved 2026-08-02) |
| G3 | keep the wiring notation package-local? / the `out` attribute name | ✅ option A (keep it local). Align id resolution with the `getRootNode()` rule. `out` stays |
| G4 | add "a node with an external clock exposes desired only" as a cross-cutting contract? | ✅ option A (yes). The §4 wording goes into timing-and-firing-contract.md |
| G5 | make the rebuild conditions, the audible side effect, and microtask coalescing normative? | ✅ yes (the three points of §5) |
| G6 | confirm "the I/O node family does no drawing" as an invariant? | ✅ **yes; keys / scope are dropped** (approved 2026-08-02) |

**The invariants now fixed** (a new node MUST NOT contradict them):

1. **The topology of live handles is not a value. It does not go into state; it is expressed as a descriptor (a description read once at construction).**
2. **Live handles are owned and destroyed by Core and never cross the protocol boundary.** Only where handing one outward becomes necessary, add a command-token argument pass-through of the same shape as camera (a backward-compatible addition, not opened in advance).
3. **A node with an external clock exposes desired only and does not specify the application time.**
4. **The I/O node family does no drawing.**

> The preceding task, [`@wcstack/midi`](../midi-tag-design.md) (ja), does not depend on this ADR (Web MIDI has neither handles nor a graph and fits the existing node skeleton as-is).
