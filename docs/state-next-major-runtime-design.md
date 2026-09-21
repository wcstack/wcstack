# State next major — row runtime design (draft)

**日本語**: [state-next-major-runtime-design.ja.md](./state-next-major-runtime-design.ja.md)

Drafted 2026-09-21. Status: **draft, not a decision.**

The [wiring design](./state-next-major-wiring-design.md) §9 pushed one thing out of its scope — "unifying `BindingSession`'s two paths, and the concrete design of the row record, the shared session and the plan-level initial render belong in a document of their own". This is that document. Where the wiring design is about *the core not knowing its features*, this one is about **what one row costs to build and to keep** (time, heap, and the size of the core).

The decisions it answers to are [requirements](./state-next-major-requirements.md) §6 **D10** (the plan-level initial render rides 3.0's "template plan vs row instance" vehicle), **D11** (the row record and the shared session ride 3.0) and **D14** (the cold 1,000-row benchmark gets a revised denominator), against goals **A2** (35 KB gzip for base + DOM) and **A3** (creation and update). The evidence is the [building-block survey](./state-next-major-tech-survey.md) §10.7 and §10.11–§10.15.

The grammar and the protocols (`data-wcs`, wc-bindable, command-token, event-token, transition-runner) do not change. What changes is the internal shape of a row and `BindingSession`'s (internal) surface.

## 1. Where things stand (measured)

10,000 rows in 294 ms, a warm 1,000 in 16 ms, 3.0 KB per row and a clear in 18–20 ms are **the sandbox with all three stages stacked** (survey §10.14). The product today carries only the clear patches: 313 ms, 22 ms, 3.6 KB per row.

| Measure | Product (2.6.x) | Sandbox, three stages | Source |
|---|---:|---:|---|
| Create 10,000 rows | 313 ms | 294 ms | survey §10.13, §10.14 |
| Warm 1,000 rows | 22 ms | 16 ms | idem |
| Cold 1,000 rows | 53 ms | 50 ms | survey §10.15 |
| Heap | 3,630 B/row | 3,033 B/row | survey §10.14 |
| Clear 10,000 rows | 18–20 ms | 18–20 ms | survey §10.12 (ported) |
| Core size | 42.7 KB gzip (`BindingSession` is 13.0 KB minified of it) | — | wiring design §8-11, §8-13 |

Where the 28 µs of a row go (survey §10.7, §10.11, §10.13):

| Component | µs/row | What a design can take |
|---|---:|---|
| Ledger writes (record, observer ledgers, pattern registration) | 8.9 | **≤4** (§10.7's upper bound: the 25-field record itself is cheap) |
| DOM (clone, node-path resolution, event wiring) | 7.8 | a cold-side candidate (R5) |
| GC (the young generation the creation's allocation pulls) | 7.2 | only as much as the allocation drops (10 → 5.5 ms per 1,000 rows across the three stages) |
| Content creation (`Content`, `createContent`) | 6.4 | 5.0 (a by-product of the plan render) |
| Initial apply (7 proxy reads, 3 applies) | 6.0 | **4.2** (plan render: reads 7 → 4, applies 3 → 1) |
| Address creation | 5.3 | 3.6 (idem) |

## 2. Principles

1. **Separate the template plan from the row instance** (audit §7, third bullet). Everything row-invariant is decided once per template; a row holds only nodes, values and teardown. `rowPlan` is already that shape, and the filter functions (requirements D16) are baked into it.
2. **A row's bookkeeping belongs to the row.** Fold the per-binding record and session into per-row and per-list ones — but **do not fold a ledger that carries semantics**: the per-node observer ledgers (`interestedSessionsByNode`, `knownBindingsByNode`) are where a MutationObserver delivers, and folding them changes delivery (the b1 variant in survey §10.7 measured the upper bound *with* that semantics broken).
3. **The initial render does not go through the proxy.** For a plain leaf under the row, read the row object once and write each slot directly. A state with getters, `**` or `$updatedCallback` falls back to the ordinary path (the gate is per row, not per binding).
4. **Change nothing that has not been measured before and after.** All three stages have paired measurements; so must the ones that follow (the counters' third stage, the heap, and the benchmark timings).
5. **Speak about cold and warm separately.** The audit benchmark's cold 1,000 rows is dominated by JIT and first-time allocation, and per-binding constants do not move it (survey §10.15). D14 revised A3's denominator to warm 1,000, cold 10,000, append and clear.

## 3. Stages

| Stage | Content | Measured effect | Ships in | Surface |
|---|---|---|---|---|
| R1 | The clear's allocation (index loops, per-parent skip counts) | clear 22–72 → 18–20 ms, no scavenge inside the window | **2.6.x (ported)** | none |
| R2 | Plan-level initial render | 10,000 rows −10 %, warm 1,000 −27 % | 3.0 (D10) | `applyValueToBinding` exported internally |
| R3 | Row record + one session per list | heap −16 % (3.6 → 3.0 KB/row), time unchanged | 3.0 (D11) | `BindingSession`'s core (`disposeBindings`, `destroyRow`, `isRowSession`, a composed `getRecord`) |
| R4 | Unify `BindingSession`'s two paths | core −2.9 KB minified (wiring design §5) | 3.0 | the plan path and the general path become one |
| R5 | Cold candidates (T4 clone / node-path forms, pool pre-warming) | unmeasured (8 ms of cold is the target) | undecided | `resolveNodePath`'s shape, an opt-in attribute |

R2 before R3 follows the order the measurements were stacked in (§10.13 → §10.14). R4 comes after R3 has already touched `BindingSession`, in the same vehicle.

## 4. R2 — the plan-level initial render

- **Which slots**: those whose state path is a plain leaf under the row (no prefix is a getter, no wildcard in the tail, not an event or index binding). The check reads `getterPaths` per row — it is not cached, because a re-set rebuilds that set.
- **What happens**: the row object is read once through the proxy (`state[getByAddressSymbol](loopContext)`) and each slot's raw value goes to `applyValueToBinding` (the DOM-writing half of `_applyChange`, extracted). A getter slot keeps going through `applyChange`.
- **When it falls back**: a state with `$updatedCallback` (the per-binding address collection is needed) and a state with `**` (the expanded getters are not in `getterPaths`).
- **What breaks easily** (8 tests failed on the prototype's first version): recursion and `_state` re-set — the expanded getters and the rebuilt `getterPaths`. Two boundary tests pin them.
- **Verification**: the counters' third stage (reads 7 → 4, applies 3 → 1), the profile (initial apply 6.0 → 4.2 µs/row) and the benchmark timings (warm 1,000 rows 19.0 → 17.4; cold unchanged).

## 5. R3 — the row record and one session per list

- **Row record**: the per-binding 25-field record and its three ledger writes become one record per row (a slot array: phase, flags, address / pattern registration, teardown) plus one session lookup per binding. `getRecord`, `shouldApplyState`, `addTeardown`, `disposeBinding`, `dispose`, `destroyRecords`, `rebindAddresses`, `forEachActiveBindingNode` and `getBindingSession` answer from the row record.
- **Shared session**: a `BindingSession` holds a Set of row records, one per `for` binding (that node) shared by every row. The content side's per-row operations (`unmount`, `unmountInPlace`, `tryDestroy`) become `disposeBindings` / `destroyRow`, which touch one row.
- **The shared session's deferred rule**: a pending definition task is cancelled with the row whose node it belongs to, and all of them are cancelled once no row is alive. Two wholesale integration tests pin that rule.
- **The gain is heap, not time** (3,630 → 3,033 B/row): the five collections a per-row session holds (3 WeakMaps, 2 Sets) are about 600 B/row. §10.11's estimate of 1.65 KB/row was too high, and §10.14 corrected it.
- **The 3.0 KB/row that remain**: addresses, caches, listIndex, dependency ledgers and binding objects, plus module-side ledgers (the per-loop-context listIndex cache, the content ledgers). That is where the next cut would come from, but **it has not been attributed yet** (the continuation of survey §10.11).

## 6. R4 — unifying `BindingSession`'s two paths

- **Today**: the plan path (2.0 KB minified) and the general path (4.9 KB minified) do the same job in two shapes. `BindingSession` is 13.0 KB minified inside the core — its largest single module (wiring design §8-11's attribution).
- **The idea**: once R3 has given plan rows and non-plan rows the same bookkeeping shape, the two paths can become one. The estimate is core −2.9 KB minified (wiring design §5).
- **Order**: R3 first. The other way round means rebuilding the merged path a second time.
- **Undecided**: what the unified shape is (fold the general path into the plan path, or a third shape that covers both). Decide it after R3, from the actual diff of `BindingSession`'s internal surface.

## 7. R5 — cold (the audit benchmark's 1,000 rows)

Cold's 38 ms excess over warm is content creation 18, GC 10, warm-up 7 (survey §10.15). The three stages took it 66 → 58 ms, and what worked was the allocation (GC). What is left:

1. **The T4 clone / node-path forms** (8 ms of cold): pull marked templates with one `querySelectorAll`, or `cloneNode` plus precomputed child indices. Survey §6.1 measured ≤2 ms per 1,000 rows — **a poor trade**.
2. **Pool pre-warming** (an opt-in attribute that builds N rows' content before the first render): the shortest route from cold to warm, at the price of building rows that may never be used. D14 chose (a), the revised denominator, so this is **lower priority, not ruled out**.
3. **Less allocation still**: depends on the attribution that §10.11's continuation owes.

## 8. Verification

1. **Behaviour**: the whole suite stays green (each stage passed 3,661 tests in the sandbox; the product is at 3,704). R2 adds two boundary tests (recursion, re-set); R3 adds two integration tests for the shared session's deferred rule.
2. **Time**: [audit-state-tech-counters.mjs](../scripts/audit-state-tech-counters.mjs)'s third stage (create 10,000, warm 1,000, append), before and after.
3. **Heap**: [audit-state-tech-heap.mjs](../scripts/audit-state-tech-heap.mjs) (10,000 rows, difference after a forced GC).
4. **Size**: `scripts/check-state-size.mjs --check` (the core entry's closure, full and auto). R4 is what moves this one.
5. **Performance regression**: the audit benchmark's four measures on D14's revised denominator (warm 1,000, cold 10,000, append, clear).

## 9. Decided and undecided

Decided (requirements §6):

- **D10**: the plan-level initial render rides 3.0's "template plan vs row instance" vehicle.
- **D11**: the row record and the shared session ride 3.0.
- **D14**: the cold 1,000-row benchmark gets a revised denominator (warm 1,000, cold 10,000, append, clear).

Undecided:

- R4's unified shape (§6). Decide after R3.
- The order of R5's three candidates, and whether the pool pre-warming attribute is built at all.
- Cutting the remaining 3.0 KB/row (attribution first).
- Whether A2 (35 KB) is pursued at all: even with R4 (−2.9 KB minified) and diagnostics moved to a dev build (−5 KB minified), the core goes from 42.7 KB gzip to about 40. **35 KB is out of reach for this structure** (proxy + dependency graph + two initial-sync paths); reaching it is a decision on audit §7's "full reimplementation" side, not a refactor.
