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
| R2 | Plan-level initial render | reads 7 → 4 and applies 3 → 1 per row, activation phase −34 %, warm 1,000 rows −34 % (§4-1) | **3.0 (implemented, §4-1)** | `applyValueToBinding` exported internally |
| R3 | Row record + one session per list | heap −18 % (3,616 → 2,953 B/row), time unchanged (§5-1) | **3.0 (implemented, §5-1)** | `BindingSession`'s core (`disposeBindings`, `destroyRow`, `isRowSession`, a composed `getRecord`) |
| R4 | Unify `BindingSession`'s two paths | **premise invalidated** (§6-1); only the ledger entry / exit was folded, −143 B minified | **3.0 (implemented, §6-1)** | internal only |
| R5 | Cold allocation (sibling-pointer node resolution, plain arrays in the row record, the drain's loops) | cold 1,000-row creation allocates −12 %, `resolveNodePath` 4.0 → 1.7 ms; time within the noise (§7-1) | **3.0 (implemented, §7-1)** | none (pool pre-warming not started — a surface decision) |

R2 before R3 follows the order the measurements were stacked in (§10.13 → §10.14). R4 comes after R3 has already touched `BindingSession`, in the same vehicle.

## 4. R2 — the plan-level initial render

- **Which slots**: those whose state path is a plain leaf under the row (no prefix is a getter, no wildcard in the tail, not an event or index binding). The check reads `getterPaths` per row — it is not cached, because a re-set rebuilds that set.
- **What happens**: the row object is read once through the proxy (`state[getByAddressSymbol](loopContext)`) and each slot's raw value goes to `applyValueToBinding` (the DOM-writing half of `_applyChange`, extracted). A getter slot keeps going through `applyChange`.
- **When it falls back**: a state with `$updatedCallback` (the per-binding address collection is needed) and a state with `**` (the expanded getters are not in `getterPaths`).
- **What breaks easily** (8 tests failed on the prototype's first version): recursion and `_state` re-set — the expanded getters and the rebuilt `getterPaths`. Two boundary tests pin them.
- **Verification**: the counters' third stage (reads 7 → 4, applies 3 → 1), the profile (initial apply 6.0 → 4.2 µs/row) and the benchmark timings (warm 1,000 rows 19.0 → 17.4; cold unchanged).

### 4-1. R2's implementation record (2026-09-21, `packages/state`)

The prototype's shape (survey §10.13) went into the product as is: a new `structural/planByContent.ts` (plan lookup for a content), `applyValueToBinding` exported from `apply/applyChange.ts`, and `applyPlanRow` in `structural/activateContent.ts`.

- **Which slots qualify is row-invariant**, so it is computed once per (plan, row path) and kept in a `WeakMap<IRowPlan, Map<rowPath, tails>>`. Only the getter test is redone per row, against `getterPaths` (a re-set rebuilds that set).
- **The two things that broke the prototype (recursion, re-set) were built in from the start**, so all 3,704 tests passed on the first run. Six boundary tests were added ([structural.planRender.test.ts](../packages/state/__tests__/structural.planRender.test.ts): plain leaves beside getters, updating a row, a nested list, a `**` state, a re-set that turns a getter into plain data, and a state with `$updatedCallback`).
- **Measured** with [audit-state-tech-counters.mjs](../scripts/audit-state-tech-counters.mjs) `--content --fixture tracked` (the "before" side is a copy of HEAD measured with `--pkg`), two runs each, medians. Artefacts: [-r2-before.json](./research/state-next/runtime-counters-content-tracked-r2-before.json), [-r2-before-2.json](./research/state-next/runtime-counters-content-tracked-r2-before-2.json), [-r2-after-1.json](./research/state-next/runtime-counters-content-tracked-r2-after-1.json), [runtime-counters-content-tracked.json](./research/state-next/runtime-counters-content-tracked.json).

| Measure | Before | After |
|---|---:|---:|
| Reads per row | 7 | **4** |
| Applies per row | 3 | **1** |
| Warm 1,000 rows (elapsed, 8 samples) | 20.7 ms | **13.6 ms** (−34 %) |
| Warm 1,000 rows (activation phase) | 14.9 ms | **8.1 ms** (−46 %) |
| Create 10,000 rows (activation phase, 6 samples) | 150.1 ms | **98.9 ms** (−34 %) |
| Create 10,000 rows (elapsed, 6 samples) | 353.8 ms | 335.2 ms (−5 %; the samples, 323–371 and 285–362, overlap) |

- **Elapsed sinks into the sample spread** (creating 10,000 rows moves ±30 ms on this machine). What is solid is the counters and the phase the change targets. The prototype's −10 % in §10.13 was measured on a sandbox that also carried the row record and the clear patches, which is consistent with the −5 % here.

## 5. R3 — the row record and one session per list

- **Row record**: the per-binding 25-field record and its three ledger writes become one record per row (a slot array: phase, flags, address / pattern registration, teardown) plus one session lookup per binding. `getRecord`, `shouldApplyState`, `addTeardown`, `disposeBinding`, `dispose`, `destroyRecords`, `rebindAddresses`, `forEachActiveBindingNode` and `getBindingSession` answer from the row record.
- **Shared session**: a `BindingSession` holds a Set of row records, one per `for` binding (that node) shared by every row. The content side's per-row operations (`unmount`, `unmountInPlace`, `tryDestroy`) become `disposeBindings` / `destroyRow`, which touch one row.
- **The shared session's deferred rule**: a pending definition task is cancelled with the row whose node it belongs to, and all of them are cancelled once no row is alive. Two wholesale integration tests pin that rule.
- **The gain is heap, not time** (3,630 → 3,033 B/row): the five collections a per-row session holds (3 WeakMaps, 2 Sets) are about 600 B/row. §10.11's estimate of 1.65 KB/row was too high, and §10.14 corrected it.
- **The 3.0 KB/row that remain**: addresses, caches, listIndex, dependency ledgers and binding objects, plus module-side ledgers (the per-loop-context listIndex cache, the content ledgers). That is where the next cut would come from, but **it has not been attributed yet** (the continuation of survey §10.11).

### 5-1. R3's implementation record (2026-09-21, `packages/state`)

Both prototypes (the row record of survey §10.7 and the shared session of §10.14) went into the product back to back. Both applied to the current source unchanged, and the type check and the whole suite passed on the first run — **coverage did not**, and that turned out to be the lesson of this stage.

- **The shape**: a plan row's bookkeeping is one record per row (slot arrays: phase, flags, address / pattern registration), and one `BindingSession` per `for` binding (that node) holds those rows in a Set. The content side's per-row operations became `disposeBindings` / `destroyRow`, and `unmountInPlace` / `unmount` dispose only this content's row when the session is shared (disposing the session would take the list's living rows with it).
- **Heap** ([audit-state-tech-heap.mjs](../scripts/audit-state-tech-heap.mjs), 10,000 rows, difference after a forced GC; [heap-per-row-r3.json](./research/state-next/heap-per-row-r3.json) — `shipped` is R3 and `proto` the build before R2 and R3; time in [runtime-counters-content-tracked-r3.json](./research/state-next/runtime-counters-content-tracked-r3.json)): **3,616 → 2,953 bytes per row (−18 %)**, a little better than the prototype's −16 %. Time is unchanged (the counters' create 10,000, warm 1,000, append and clear all sit inside the sample spread). The measurement confirms §2's expectation that R3 buys heap, not time.
- **The real subject is the coverage drop (92.5 %)**. The row record takes plan rows off the record path, so **branches that plan rows used to exercise on that path stopped being reached at all**. The prototype had stopped at "all tests green", so the hole only became visible on the port. The fix split in two:
  - **Delete what cannot be reached**: plan eligibility (`compileRowPlan`) rejects custom elements and two-way bindings, so a plan row can hold neither a definition wait nor a deferred apply. The per-slot teardown array (`addTeardown`'s row branch and `row.teardowns`) existed only for that deferred apply and is gone. Cancelling the definition waits when the last row dies **stayed** — an integration test (wholesale destroy) pins that contract, and removing it failed two tests. A useful reminder that "never called" and "must never be called" are different claims.
  - **Cover the rest with tests**: the integration file [bindings.rowSession.test.ts](../packages/state/__tests__/bindings.rowSession.test.ts) (12 cases — sharing, reuse, partial removal, pool revival, two lists, events, disconnect, re-set, and a plan-ineligible list) and the white-box [bindings.rowSession.branches.test.ts](../packages/state/__tests__/bindings.rowSession.branches.test.ts) (12 cases — unregistered rows, authority, a failed event attach, a missing state tree, double registration, rebinding, destroyRecords with rows). Three record-path cases were added to the existing [bindings.BindingSession.branches.test.ts](../packages/state/__tests__/bindings.BindingSession.branches.test.ts) to replace the traffic plan rows used to bring.
- **Result**: all 3,739 tests pass, coverage 99.64 / 98.50 / 100 / 99.81 (exactly at the thresholds), lint clean, all four gates pass. `auto.min.js` goes 73,968 → 75,137 B gzip and the split core's closure 49,148 → 50,324 B — the cost of the row record and the shared session. The size baselines were re-recorded.

## 6. R4 — unifying `BindingSession`'s two paths

- **Today**: the plan path (2.0 KB minified) and the general path (4.9 KB minified) do the same job in two shapes. `BindingSession` is 13.0 KB minified inside the core — its largest single module (wiring design §8-11's attribution).
- **The idea**: once R3 has given plan rows and non-plan rows the same bookkeeping shape, the two paths can become one. The estimate is core −2.9 KB minified (wiring design §5).
- **Order**: R3 first. The other way round means rebuilding the merged path a second time.
- **Undecided**: what the unified shape is (fold the general path into the plan path, or a third shape that covers both). Decide it after R3, from the actual diff of `BindingSession`'s internal surface.

### 6-1. R4's implementation record (2026-09-21, `packages/state`) — the premise did not survive

Doing what this section left open — "decide the unified shape after R3, from the actual diff" — showed that **the premise of unifying no longer held**.

- **Measured**: `BindingSession`'s 15.5 KB minified, attributed per method through the source map (`dist/split/chunks/binder.js`). The row path's own methods (`initializeRow` 493, `activatePlanRows` 570, `registerRowSlot` 346, `unregisterRowSlot` 266, `addKnownRowBinding` 271, `disposeBindings` / `destroyRow` and friends) come to about 2.9 KB; the record path (`start` 759, `attachAfterDefinition` 608, `settleInitialRecord` 558, `runTeardowns` 537, `registerAddress` 523, `addTeardown` 585 and friends) to about 5.8 KB.
- **Neither can go**: the wiring design's "−2.9 KB" (§5) assumed one of the two paths would be deleted. After R2 and R3, though, the row path is **the fast path for plan-eligible rows** — R2's plan render and R3's −18 % heap both ride on it — and the record path takes everything the row path deliberately does not hold: custom-element definition waits, two-way, radio / checkbox, tokens, connect-time snapshots, deferred-apply teardowns. Deleting the row path would give back R2 and R3; the record path cannot be deleted. **"Two paths doing the same job in two shapes" described the code before R2 and R3.**
- **Only the real duplicate was folded**: entering and leaving the address ledgers — registration in two places (`registerRowSlot` / `registerAddress`), removal in three (`unregisterRowSlot` / `runTeardowns` / `rebindAddresses`) — became three functions, `registerPattern` / `registerAbsoluteAddress` / `unregisterFromLedger`. What was registered (an address, or a pattern's pathInfo + listIndex) is written into the caller's own storage; returning a pair would add an allocation per row, so that shape was not taken. The old order — keep the storage when a removal throws, so a revived row does not register twice — is preserved.
- **Result**: `BindingSession` 15,536 → 15,393 B minified (−143 B). `auto.min.js` 75,137 → 75,094 B gzip, the split core's closure 50,324 → 50,283 B. All 3,739 tests pass, coverage 99.64 / 98.50 / 100 / 99.81, all four gates pass. The size matters less than the fact that **a binding now enters and leaves the ledgers through one place** — asymmetric register / unregister code was a regular source of past defects.
- **What it means for A2**: of the two stages §5 still listed for A2, R4 is now known to do almost nothing. What remains is moving diagnostics to a dev build (`pathDiagnostics` 3.6 KB and friends), which leaves the core around 42–43 KB gzip. As §9 says, 35 KB is out of reach for this structure.

## 7. R5 — cold (the audit benchmark's 1,000 rows)

Cold's 38 ms excess over warm is content creation 18, GC 10, warm-up 7 (survey §10.15). The three stages took it 66 → 58 ms, and what worked was the allocation (GC). What is left:

1. **The T4 clone / node-path forms** (8 ms of cold): pull marked templates with one `querySelectorAll`, or `cloneNode` plus precomputed child indices. Survey §6.1 measured ≤2 ms per 1,000 rows — **a poor trade**.
2. **Pool pre-warming** (an opt-in attribute that builds N rows' content before the first render): the shortest route from cold to warm, at the price of building rows that may never be used. D14 chose (a), the revised denominator, so this is **lower priority, not ruled out**.
3. **Less allocation still**: depends on the attribution that §10.11's continuation owes.

### 7-1. R5's implementation record (2026-09-21, `packages/state`)

Following principle 4, the cold breakdown was first re-taken on the current product (R2–R4 in; [profile-create1k-coldwarm-r4.json](./research/state-next/profile-create1k-coldwarm-r4.json), 9 pages). The window is 58.6 ms cold / 29.2 ms warm. GC is down from §10.15's 10.0 to **5.7 ms**, and the largest lump is `importNode` 4.85 + `resolveNodePath` 4.01 = 8.9 ms (both 0 when warm — the pool hides them). Allocation was sampled by adding `--op create1k` to [audit-state-tech-allocsample.mjs](../scripts/audit-state-tech-allocsample.mjs) (6.27 MB per run = 6.3 KB/row; [alloc-sample-create1k-r4.json](./research/state-next/alloc-sample-create1k-r4.json)). Attributing the native frames (`Map#set`, `Set#add`, an iterator's `next`) to their nearest JS caller showed three allocations that carry no semantics:

- **`childNodes[i]` in `resolveNodePath`**: on a freshly cloned row, every node whose `childNodes` is touched grows a NodeList (and NodeRareData) that lives as long as the row. It now walks sibling pointers (`firstChild` / `nextSibling`). On a DOM floor page, 1,000 rows with five paths each go 3.3 → 2.5 ms (cloning alone is 1.5 ms; reusing an already-resolved prefix as the starting point added nothing — the paths are short). For the same reason the `Content` constructor's `Array.from(fragment.childNodes)` now collects by sibling pointers too: once `resolveNodePath` stopped touching the fragment's `childNodes`, `Content` paid for creating it — a profile after the first fix showed `Content` going 0.89 → 2.22 ms.
- **The row record's two `Uint8Array`s** (`phases` / `flags`): a typed array costs over 100 B with its backing store, 250 B per row for the two. They are now plain arrays (Smis) like the record's other three.
- **`for...of` in the drain (`Updater._applyChange`)**: the drain runs once per batch, so it never reaches an optimizing tier, and `for...of` allocates a result object per iteration (plus the `[key, value]` array over a Map). Creating 1,000 rows queues a few addresses per row through the dependency expansion (`data` → the added rows' `data.*` → their derivations; appending 1,000 rows counts 4,001 enqueues), and these loops alone allocated 0.6 MB. They are index loops and `Map#forEach` now, and the landed set is built in the first loop instead of from the Map's keys (same order).

**Not taken**: the `markNodeRegistered` / `resolveInitializedBinding` ledgers (re-scan protection and the initialization wait — ledgers that carry semantics, principle 2); the binding object copy (`{ ...slot.template, node, replaceNode }` — a binding keys many WeakMaps, and sharing through a prototype would break users of spread / `Object.keys`); `importNode` (`cloneNode` would create a row's custom elements in the inert document and move their upgrade).

**Results** (before = the R4 build, after = R5; artefacts [alloc-sample-create1k-r5.json](./research/state-next/alloc-sample-create1k-r5.json) and [profile-create1k-coldwarm-r5.json](./research/state-next/profile-create1k-coldwarm-r5.json)):

| Measure | Before | After |
|---|---:|---:|
| Cold 1,000-row creation, allocated (9 pages) | 6.27 MB | **5.52 MB (−12 %)** |
| `resolveNodePath` (profile, cold) | 4.01 ms | **1.71 ms** |
| `Content` (same) | 0.89 ms | 0.15 ms |
| GC (same) | 5.7 ms | 5.6 ms |
| Window (while profiling, cold / warm) | 58.6 / 29.2 ms | 50.1 / 24.7 ms |

Benchmark timing ([audit-state-tech-warmth.mjs](../scripts/audit-state-tech-warmth.mjs) `--fixture tracked`, before and after alternated four times each; median of 24 samples; p is a two-sided Mann-Whitney; samples in [warm-vs-cold-r5-alternating.json](./research/state-next/warm-vs-cold-r5-alternating.json)):

| Measure | Before | After | Difference |
|---|---:|---:|---|
| Create 1,000 rows (cold) | 47.5 ms | 48.5 ms | p = 0.67 |
| Create 1,000 rows (warm) | 18.5 ms | 16.3 ms | p = 0.29 |
| Append 1,000 to 10,000 (cold) | 60.7 ms | 51.8 ms | p = 0.11 |
| Clear 10,000 (cold) | 55.8 ms | 49.3 ms | p = 0.06 |
| Clear 10,000 (warm) | 68.8 ms | 65.0 ms | p = 0.05 |

- **What is certain is the allocation and the profile; no timing difference reaches p < 0.05.** Append and clear moved the right way (the clear is borderline), but the audit benchmark's own measure, the cold creation of 1,000 rows, moved the wrong way inside the noise. The same timing, taken once on the build before the `Content` fix, gave the cold creation 48.4 → 45.6 ms (p = 0.15): the direction flips from run to run, and a cold sample on this machine moves ±10 ms from page to page. The warm clear is the measure §8.5 excludes for its GC spikes.
- **GC did not move.** Cutting a tenth of the allocation does not change how many scavenges (steps) a 1,000-row creation triggers. Moving cold GC through §7's candidate 3 would take cutting a much larger share (how much changes the step is not measured).
- All 3,743 tests pass (two boundary tests added for `resolveNodePath` — an out-of-range index, and text / comment nodes counted as children); coverage 99.64 / 98.50 / 100 / 99.81; all four gates pass.
- **Pool pre-warming (candidate 2) is what remains.** It is the shortest route from cold to warm, but it is a surface decision (an opt-in attribute), so it is not started here (§9).

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

Decided (2026-09-21, second round; requirements §6):

- **R4's unified shape**: settled. After R2 and R3 the premise of unifying did not hold, and only the ledger entry / exit was folded (§6-1).
- **D24**: no pool pre-warming attribute in 3.0. It only moves the creation cost before the first render — the total does not shrink and unused rows are waste. It can be added non-breakingly in 3.x on request (R5's candidates 1 and 3 are implemented, §7-1).
- **D25**: cutting the remaining 3.0 KB/row waits until after 3.0 (R3 took −18 %; no acceptance criterion asks for more).
- **D22**: A2 is restated as 3.0's measured core, 43.2 KB gzip. R4 did almost nothing (§6-1), and after separating the diagnostics (wiring design §8-14) the core is 43.2 KB. **35 KB is out of reach for this structure** (proxy + dependency graph + two initial-sync paths); reaching it is D1's (c), the full reimplementation, which is research after 3.0.

Undecided: none.
