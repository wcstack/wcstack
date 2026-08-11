# Hardening the hard parts of the wcstack architecture

- **Written**: 2026-07-14
- **Status**: partly adopted and implemented. The PoC implementations of phases 0-6 are complete, and phase 2
  (direction-aware initial sync) and phase 3 (causal propagation) have been flipped to `true` by default.
  Progress and remaining work on opt-in → default and the roll-out across the I/O family are tracked by
  [10-defaulting-rollout-status.md](10-defaulting-rollout-status.md). Unimplemented design proposals remain
  in the per-topic docs (01-08, 11, 13, 15).
- **Snapshot this covers**:
  - wcstack: `27371dca55888c864028042e71d8a7e7149365b4` (v1.20.0)
  - wc-bindable-protocol: `5ec0deef212578a072b2f669d2a5554f254253e0`
  - published on npm: `@wc-bindable/core@0.8.0`
- **日本語版**: [README.ja.md](README.ja.md)

## Purpose

wcstack keeps its reactive core, the UI, and its I/O nodes loosely coupled through shared protocols. That buys a
high degree of interchangeability, but the difficulties — initialization order, two-way propagation, async
execution, observability — surface on those same boundaries. This directory takes those hard parts apart one by
one and records, for each, the current state, what is unresolved, the recommended remedy, compatibility, and the
conditions for verification.

These documents are material for design decisions; the APIs and metadata they describe are not implemented.
Where one contradicts an existing normative document, that normative document is updated before adoption and
implementation.

## The topics

1. [The order of tag definition and binding establishment](01-binding-initialization-order.md) (ja)
2. [Delivering the initial state right after connection](02-initial-state-delivery.md) (ja)
3. [Echo control in two-way bindings](03-two-way-echo-control.md) (ja)
4. [Async execution and the wc-bindable boundary](04-async-execution-and-wc-bindable.md) (ja)
5. [Observability, debugging, and the wc-bindable boundary](05-observability-and-wc-bindable.md) (ja)
6. [Type safety for path strings](06-path-type-safety.md) (ja)
7. [Absorbing browser capability variance](07-browser-capability-variance.md) (ja)
8. [Protocol evolution and compatibility](08-protocol-evolution.md) (ja)

## The remediation design that cuts across all eight

- [The remediation design across the eight topics](09-remediation-design.md) (ja) — collects the division of
  responsibility between `BindableDeclarationReader`, `BindingSession`, `PropagationContext`, `OperationTicket`,
  and `wcstack.manifest.json`, together with the staged introduction, the regression tests, and the decision gates.

## Defaulting and roll-out status

- [Defaulting and roll-out status, and what remains](10-defaulting-rollout-status.md) — a living document
  tracking the progress of opt-in → default and the roll-out across the I/O family after the phase 0-6 PoC
  implementations landed (phases 2/3 now default; errorInfo applied to 27/35 nodes plus 3 deferred plus 5 not
  applicable; 5a gated in CI; 5b settled as explicit opt-in. Remaining: the dist rebuild at release time, the
  decision on the deferred nodes, and the lane trace bridge).

## Additional boundary designs

- [React immutable snapshots and the wc-bindable I/O boundary](11-react-immutable-snapshot-boundary.md) (ja) —
  separates the correctness of an async commit, the immutability of a React snapshot, and the lifetime of a live
  resource, and sorts out the responsibilities of the React adapter, the I/O node, and the protocol metadata.
  Includes the inventory of `state` / `event` / `handle` and a staged introduction plan.
- [The wc-bindable observable inventory](12-wc-bindable-observable-inventory.md) — the fixed Phase 0
  snapshot. Classifies 231 properties into 210 `state`, 20 `event`, and 1 `handle`, and audits mutation, stale
  commits, and resource ownership across eight priority areas including camera / recorder / fetch. §5.6 holds
  the per-adapter failure modes (signals' same-value dedupe, RxJS replay and resource retention, Qwik serialization).
- [Framework adapter binding constraints](13-framework-adapter-binding-constraints.md) — the axis of
  "does the bind take at all", rather than what a value means. Covers the problem where a late upgrade makes
  every adapter go silent and fail to bind, the Shell-side defect where a property assigned before the upgrade
  shadows the accessor, and how expressible an event name containing a colon is.
- [Wiring a graph of live handles through the DOM](14-handle-graph-wiring.md) — ✅ **adopted (2026-08-02)**.
  Once handles go from one to N and are wired to each other, who owns that topology and how is it described.
  Decides G1 through G6, as brought in by Web Audio
  ([examples/synth-playground](../../examples/synth-playground/)). It is the first field test of cross-cutting
  principle 3, "do not mix the meanings of values, events, commands, and live handles", and the conclusion is
  "the topology is a descriptor; Core owns the handles and never lets them cross the boundary" — that is,
  **no new observation semantics are added**.
- [A consistency audit of state's three component mechanisms](15-state-component-mechanism-consistency.md) (ja) —
  **not adopted, not fixed**. Turns doc 13's "does the bind take" axis inward, onto wcstack itself. It pins down
  where the three mechanisms `@wcstack/state` carries — the wc-bindable protocol, DCC, and bind-component — fail
  to agree with each other. The root causes are three: (1) DCC's `createWcBindable` partially implements the
  declaration spec of the first mechanism, (2) bind-component's internal channel proxy is exposed as the public
  API `this.state` as-is, and (3) the lifecycle discipline is not shared between the mechanisms.
  Decision gates G1-G4 are open.

## Cross-cutting principles

1. **Turn implicit time dependence into an explicit phase or state.**
2. **Separate the initial snapshot from subsequent events.**
3. **Do not mix the meanings of values, events, commands, and live handles.**
4. **Rest correctness on generations, ownership, and ordering contracts — not on a cancellation API alone.**
5. **Add no production cost, and make causality observable during development.**
6. **Stay buildless, and add type checking and capability information incrementally.**
7. **Change the meaning of no existing protocol, and express additional information backward-compatibly.**

## How wc-bindable is referenced

Topics 4 and 5 reference not only the `static wcBindable` declarations inside wcstack but the latest official
wc-bindable-protocol spec. In particular, they take the following as given.

- The core's `properties` is the observation surface from producer to consumer.
- `inputs` and `commands` are declarative metadata in the core; their invocation semantics belong to the extension spec.
- Initial sync, teardown, and forward compatibility are normative in the core spec.
- Remote acks, ordering, timeouts, AbortSignal, back-pressure, and wire capability are normative in the extension spec.
- Debug instrumentation does not change the core's observation semantics and is designed as a separate side channel.

The references are pinned to the commit as of the time these documents were written, to avoid meaning drifting
out from under them through updates.

- [wc-bindable SPEC.md](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/SPEC.md)
- [wc-bindable SPEC-extensions.md](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/SPEC-extensions.md)
- [wc-bindable remote README](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/packages/remote/README.md)
- [wc-bindable CONFORMANCE.md](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/CONFORMANCE.md)

## How adoption proceeds

The proposal in each document can be adopted independently. But 1 and 2 (initial sync), 4 and 5 (execution and
observation), and 6 and 8 (type information and protocol evolution) are mutually dependent. Before moving to
implementation, settle each document's "decision gates" first, and include the phases and conformance tests of
[the remediation design across the eight topics](09-remediation-design.md) (ja) in the completion criteria.
