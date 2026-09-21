# State next-major requirements

**日本語**: [state-next-major-requirements.ja.md](./state-next-major-requirements.ja.md)

Drafted 2026-09-20. Baseline: the latest release, 2.5.1 (main `6bff9f2c`). Working branch: `major/state-next`, rebased onto main `6bff9f2c` on 2026-09-20.

This document lists what the next major changes and what it leaves alone. The measurements and reproductions behind it are in [state-next-major-audit.md](./state-next-major-audit.md) (investigated 2026-09-18 against 2.5.0); here they become requirements. The building blocks a §9 phase-3 prototype would use (coupling cut points, lexer, dependency-graph mechanisms, DOM floor, platform status) are measured one by one in [state-next-major-tech-survey.md](./state-next-major-tech-survey.md) (2026-09-20). Design and implementation plans stay in separate documents.

**This document is not a decision.** Points that need the author's ruling are collected in §6; every other section states only what the audit reproduced and what follows from it. Implementation does not start before §6 is settled.

## 1. Scope

- The published packages (`@wcstack/*` and `wcstack`) move to `3.0.0` in lockstep. Substantive change concentrates in `@wcstack/state`; the others are expected to follow on version alone (revisited as §6 D5).
- `packages/vscode-wcs` is versioned separately but has to follow the grammar and diagnostics requirements (B1–B5, B12). So do lint, `wcs-schema` / `wcs-tsc`, `@wcstack/testing`, the manifest `schemaVersion`, and the devtools hook `version`.
- The separate [wcstack/wcstack-skill](https://github.com/wcstack/wcstack-skill) repository carries the same grammar contract and follows the same set.
- What requires a major is defined in [Versioning and breaking changes](../README.md#versioning-and-breaking-changes) in the root README. This document does not restate that definition.

## 2. Goals

| ID | Goal | Measured today | Source |
|---|---|---|---|
| G1 | Make the delivered size usable | The named `index.esm.js` is unminified at 310,916 gzip bytes. The minification experiment reaches 71,194 (**77.1% smaller**). `auto.min.js` is 68,843 | Audit §3.1 |
| G2 | Cut the coupling between features | Importing only `defineState` still registers watch and stream listeners at module evaluation, retaining about 27 KB gzip | Audit §3.2 |
| G3 | Lower update cost | Create 1,000 rows 42.85 ms; append 1,000 to 10,000 rows 66.00 ms; clear 10,000 rows 72.95 ms (medians) | Audit §4.1 |
| G4 | Close the semantic gaps | Nine reproduced inconsistencies (quoting, readonly bypass, empty values, literal types and others) | Audit §5.1 |
| G5 | Close the known defects | [#258](https://github.com/wcstack/wcstack/issues/258) (X6/X7/X10), [#2](https://github.com/wcstack/wcstack/issues/2), and three mount gaps | §5 |

G1–G3 carry numeric targets in §8. G4 and G5 are satisfied by writing the contract down and pinning it with regression tests; choosing to keep today's behaviour is an allowed outcome.

## 3. Breaking-change candidates

Each of these requires a major. **None of them is decided.** Every "today" column is behaviour the audit reproduced.

### 3.1 Grammar and parser

| ID | Item | Today | Requirement |
|---|---|---|---|
| B1 | Quotes versus delimiters | `join(', ')` works while `join(';')` and `join('\|')` fail, because outer splitting precedes quote parsing | Split into a quote-aware lexer → AST → resolved binding plan, with delimiters inert inside quotes |
| B2 | Malformed syntax accepted | An unclosed quote in `join('unterminated)` is accepted; `value#ro#wo` keeps only `ro`; `else: ignored` discards its right-hand side | Reject them, with located diagnostics shared with lint and the editor |
| B3 | Filter arguments | The cache key is `args.join(',')`, conflating `['a,b']` with `['a','b']`; excess arguments such as `join(a,b)` are accepted | Validate arity and use a structural cache key |
| B4 | Modifiers change binding kind | `radio: x` is specialized but `radio#ro: x` falls back to a generic property; structural keywords branch the same way | A modifier must not change the kind. Support or reject each combination explicitly |
| B5 | The `on` prefix | `only: x` and `online: x` parse as events, colliding with DOM and custom-element properties of those names | Give events their own namespace |

### 3.2 Read/write semantics

| ID | Item | Today | Requirement |
|---|---|---|---|
| B6 | Readonly bypass | Direct assignment throws, but `$resolve(…, 9)` and `$setAll(…, 10)` on the same readonly proxy write successfully, because the helpers call `setByAddress` without passing through `StateHandler.set` | Put the write-capability check at one shared write boundary |
| B7 | `$resolve` overload | Starting at 7, `$resolve(path, [], undefined)` leaves 7: undefined cannot be written | Do not distinguish read from write by argument count |
| B8 | Empty-value contract | `undefined` keeps the previous value in `textContent:`, is empty in a mustache, and becomes the string `"undefined"` in `attr.title:`. `null` is empty in the first two and the string `"null"` as an attribute | Define absence, explicit clearing and display conversion as one contract across the three surfaces, including attribute removal |
| B9 | Filter literal types | `eq(true)` against boolean true returns false while `eq(1)` against number 1 returns true; arguments are strings with numeric coercion only | Specify literal-type rules for arguments |
| B10 | Truthiness | `truthy` returns true for `0n` while `boolean` returns false | Match JavaScript truthiness, or express the difference in the names |
| B11 | Scope capability | `$scan` is root-only: refused in volumes, warned-and-ignored in mounted components. Root and volume readiness promises also fail differently | Publish a capability matrix and remove silent unsupported behaviour |

### 3.3 Vocabulary

| ID | Item | Today | Requirement |
|---|---|---|---|
| B12 | Canonical names | `$trackDependency` adds an edge while `$untrackDependency` temporarily suppresses tracking — they are not inverses. `#ro` suppresses element→state, whereas a readonly proxy constrains state writes. `inc/dec` sound mutating although they are pure arithmetic. `uc/lc/cap/rep/rev/fix` sit beside `truncate/percent/datetime`. `pad` means padStart only. `defaults` also replaces zero, false and the empty string. `$updatedCallback` observes applied bindings, not all state updates. Declaration maps mix plural `$streams` with singular `$watch` / `$scan` | Make direction (to-element / from-element / two-way), initial authority and timing separate axes in the vocabulary. Give filters canonical names with compatibility aliases. Make declaration-map naming consistent while keeping the distinct semantics |

§6 D4 decides how long aliases live.

### 3.4 Delivery and mounting

| ID | Item | Today | Requirement |
|---|---|---|---|
| B13 | Exports and side effects | `exports` has `.` / `./auto` / `./manifest` / `./parser` / `./wcs-manifest.json`. Static core→feature imports mean initialization survives a `sideEffects` declaration | Add split entries with explicit, idempotent registration. Do not rebundle core into each subpath: one core chunk, one registry, shared address identity |
| B14 | Three mount gaps | ① the parser accepts `state#ro: user` but `mount.ts` never reads the modifier, so the mount stays read-write in silence ② resolution order is getter → own key → tree, so an explicit `state.name: user.name` on the host loses to an own key ③ components have an injection point (`state.taxRate: user.taxRate`) and volumes have none | ① honour the modifier in the mount record ② let an explicit partial mount win over an own key ③ give volumes an injection point. All three sit on the single write-translation point |

## 4. Non-breaking improvements

| ID | Item | Notes |
|---|---|---|
| N1 | Minify the named entry | The API does not change. Change the Rollup configuration and the synchronization scripts, not the generated copies |
| N2 | A side-effect-free helper entry | `defineState`, types, version — pulling in no runtime |
| N3 | Size CI | Pin gzip and Brotli for the four entries the audit measured, with thresholds. **In place (uncommitted)**: the re-export of `defineState` only ≤ 1 KB gzip (`audit-state-tech-helper-import.mjs --check`) and the gzip of `auto.min.js` / `index.esm.js` within +3 % of the release baseline (`check-state-size.mjs --check`, baseline in `scripts/state-size-baseline.json`, D18) |
| N4 | Fix [#258](https://github.com/wcstack/wcstack/issues/258) | X6 (after SSR hydration, row getter bindings never follow leaf updates), X7 (row bindings stop following writes after a re-set), X10 (the getter cache survives `setInitialState`). These are bug fixes and do not need to wait for a major |
| N5 | Runtime and memory | Reset machinery keyed by an address that is identical across generations; bound pool size and lifetime; give lifetime boundaries to the unbounded `PathInfo`, `ResolvedAddress` and filter-string caches |
| N6 | Keyed subscription `$eq` | The candidate answer to D7 ([survey §10.1](./state-next-major-tech-survey.md)). `$eq(path, key)` returns whether the value of `path` equals `key`, subscribing the evaluating getter's row under `key`; the write side updates only the rows keyed under the old and the new value. In the prototype a selection change over 10,000 rows drops from 20 ms to 0.2 ms, and with a dependency-free id as the key, removing one row drops from 48 to 12.7 ms and a swap costs 1.0 ms while the selection follows its row. +0.3 KB gzip, existing tests green. An additive API, so it can ship in 2.6.x. Three forms, `$eq(path, value)` / `$eqPath(path, keyPath)` / `$eqIndex(path, level)` (survey §10.10; `$eqIndex` keeps the selection on the index with removal at 17.5 ms). **Implemented in `packages/state` (uncommitted; with the "Keyed selection" README sections, the types and the VS Code extension's preamble)** |

N1–N4 and N6 can ship in 2.6.x, which is also where the deprecation notices of §7 land.

## 5. Unlanded design work and known defects

§6 decides whether each rides the major or proceeds independently.

| Item | State | What decides it |
|---|---|---|
| [#2](https://github.com/wcstack/wcstack/issues/2) adjacent-item reference | Open. A design exists: offset path syntax `items.-1.name` / `items.+1.name` with topologically ordered dependency evaluation | New syntax, so a major is a natural home — but it is an added feature, not a requirement |
| Exported getters (opening D10) | Implemented on branch `feat/state-overlay-export`, no PR. Code review left two blocking defects: a write through an exported row setter pins the parent-side cache to the assigned value; a wildcard getter in a delta=0 component silently never resolves | Both blocking defects live in the same layer as B6 and B11. Cheaper together |
| Address-type unification | Settled on option B ([design](./state-address-unification-design.md) (ja) §12). Phase 0/1 and the main-tp optimization have landed, unreleased. What remains is the unverified shape in §11-4 | Audit §4.3 states that address unification does not by itself solve the performance problem. **Treat it as an independent variable in the prototype comparison** so improvements stay attributable |
| Write-cache pinning (the #4 family) | Present on main: a write to a pre-swap address pins the cache, and an element write during a row replacement leaves the display and the state disagreeing | The same root as B6's single write boundary |

## 6. Decisions required

| ID | Question | Options | Recommendation |
|---|---|---|---|
| D1 | What happens to the engine | (a) local improvements (b) incremental core / DOM-adapter replacement (c) full rewrite with a new grammar | **(b)**. (c) only after a prototype wins and the migration is explainable (audit §7) |
| D2 | A compatibility layer for the old grammar | (a) none (b) parse legacy syntax into the new AST during the transition | Depends on how many of B1–B5 and B12 are adopted. Default to **(b)**, diagnosing semantic changes that cannot be converted |
| D3 | The default delivery form after splitting | Keep the self-contained full / auto bundle? | **Keep it.** Zero configuration and the existing SRI contract ([sri.md](./sri.md)) rest on it. Add explicit ESM composition as the second form; leave declaration-driven auto-splitting for later |
| D4 | Alias lifetime | How many releases do old names survive? | Meet the README's deprecation practice (at least one minor with a lint rule and/or runtime notice). Default: keep through 3.x, remove in 4.0 |
| D5 | Does anything outside state break | Do router, the I/O nodes or the protocols have a breaking change that only this window allows? | Not yet inventoried. **Sweep once before starting.** If nothing turns up, they follow on version alone |
| D6 | Does [#2](https://github.com/wcstack/wcstack/issues/2) ship in 3.0 | (a) yes (b) a later 3.x minor | **(b)**. New syntax is additive. Keep 3.0 focused on semantics and delivery |
| D7 | The selection contract | Promise O(1) selection through ordinary getters? | **Do not promise it.** Support optimized selection through an API and publish the cases where an ordinary getter is O(N) (audit §4.2). The candidate API is N6's keyed subscription `$eq` (survey §10.1: selection 0.2 ms; keyed by id, removal 12.7 ms and swap 1.0 ms) |
| D8 | Shipping the keyed subscription (N6) | (a) all three forms `$eq` / `$eqPath` / `$eqIndex` in 2.6.x (b) `$eq` / `$eqPath` first, `$eqIndex` in 3.0 (c) wait for 3.0 | **(a)**. An additive API that touches no existing behaviour, implemented and green (survey §10.10). Shipping makes the names public, so fix the names before release. Remaining: an SSR-path test, DevTools exposure (D13), the `wcstack-skill` update |
| D9 | Shipping the clear-allocation patches (index loops + per-parent skip count) | (a) 2.6.x (b) 3.0 | **(a)**. No semantic change, implemented, all tests green (survey §10.12 addendum 2). Clear 22–72 → 18–20 ms, directly on the audit benchmark's clear |
| D10 | Shipping the plan-level initial render | (a) 2.6.x (b) with 3.0's "separate the template plan from row instances" (audit §7) (c) drop | **(b)**. The gain is −10 % at 10,000 rows and −27 % warm at 1,000, but the audit benchmark's metric (cold 1,000 rows) does not move (survey §10.13, §10.15). It adds a second apply path for leaf slots, lighter to maintain when landed with the row-instance redesign. Choose (a) (gated, local) only if 10,000-row scenarios matter for 2.6.x |
| D11 | Shipping the row record + shared session | (a) 3.0 (b) 2.6.x | **(a)**. Touches `BindingSession`'s core (372 changed lines) and public surface (`disposeBindings` / `destroyRow`, the synthesized `getRecord` view, the shared session's deferred rule) for heap −16 % and unchanged time (survey §10.7, §10.14). Lands with the 3.0 vehicle (audit §7) |
| D12 | The attachment API of S3 (the H1 read/write boundary hook) | (a) the `_state` setter attaches hooks to the state element from the declarations (reserved keys, `**`, DCC), with the `mount=` attribute picked up in `connectedCallback` as a second pass (b) explicit through an `installFeatures` argument (c) automatic by default, explicit override | **(a)**. Follows the zero-config principle and D3: a split-entry user installs features anyway, so a declaration attaching them automatically is the natural form. Hooks live per state (a global array costs +40 % per read, survey §10.8) |
| D13 | When S3's readiness barrier fires (a declaration requires a feature that is not installed) | (a) throw in the `_state` setter (at declaration time) (b) throw on the first read / write (c) console.error only | **(a)**. Failing by name right after the declaration is closest to the cause. Never on `auto` / full (requirements §10) |
| D14 | The cold creation of 1,000 rows (the audit benchmark's metric, 50 ms) | (a) revise the denominator of A3's "25 % improvement" (measure on warm 1,000 rows and cold 10,000 rows) (b) pre-warm the pool (an opt-in attribute creating N rows before the first render) (c) keep trimming the per-binding constant | **(a)**, with (b) as an opt-in if needed. Cold is "the content creation the pool hides + the creation's GC + warm-up", which per-binding optimisation does not move (survey §10.15). (b) is the shortest path from cold to warm's 17 ms, at the price of creating rows that may go unused |
| D15 | The API shape of `install` (design §9) | (a) `installFeatures([...])` as the default (b) per-feature side-effect imports (c) (a) by default plus thin (b) entries | **(a)**. Consistent with the no-evaluation-side-effect principle (G2 / N2, reached in survey §10.5). (c) can be added later for D3's split form |
| D16 | When filter functions are resolved (design §9, the premise of `features/formats`) | (a) at parse time (today) (b) from a registry at binding-plan time | **(b)**. The grammar stage alone is 1.7–3.2 KB gzip (survey §4.3), letting the formatting filters move to `features/formats`. The "unknown filter" diagnostic that threw at parse time moves to the binding-plan stage |
| D17 | Exposing keyed subscriptions to DevTools | (a) add `state:keyed-subscribed` with 3.0's protocol version bump (b) add it in 2.6.x (c) do not expose | **(a)**. N6 in 2.6.x only lacks a display of the subscriptions; behaviour is unaffected. It needs a protocol version bump, so it belongs with 3.0 |
| D18 | The full / auto thresholds of N3's size CI | (a) the release measurement +3 %, with an explicit note required to exceed it (b) fixed values (say auto 70 KB gzip) | **(a)**. The helper-entry gate (1 KB) is in place (survey §10.5 addendum). full / auto move every release, so a relative threshold fits the routine |

| D19 | The +1.3 KB gzip that S3's receptacles add to full / auto (design §8-2, the record of slices 2 and 3) crosses D18's +3 % gate | (a) 3.0 is a major: re-record the baseline (`scripts/state-size-baseline.json`) from the 3.0 build and accept the +1.3 KB (the core of the split entries loses that much) (b) fold the 12 receptacle loops into one shared runner (estimated −0.5 KB, not measured) (c) keep the three boundary-only points (handlerScope / updated / suppressPathDiagnostic) as direct edges instead of hooks (edges 14 → 17) | **(a)**. The gate exists to catch unintended growth; S3's growth is intended. Decide (b) after measuring it when S3 lands on the 3.0 vehicle |
| D20 | The scope of 3.0 | (a) cut 3.0 from what the branch holds (the split delivery, R1–R5, keyed selection) and move B1–B14 to 3.x / 4.0 (b) decide the B items first (turn §3's reproductions into regressions and judge each) and put the breaking fixes into 3.0; drop the comparison against a new core from 3.0's prerequisites (c) follow §9's original plan through the comparison prototype | **(b)**. Breaking fixes such as B2, B5, B6, B7 and B8 fit only a major; (a) would need a 4.0 soon. The comparison prototype served A2, which D22 revises |
| D21 | What to do about A1 (named full entry ≤ about 72 KB) | (a) ship N1 (minify the named entry), measure it, restate A1 as 3.0's measurement and hold it with D18's +3 % gate (b) cut back to 72 KB (c) drop A1 | **(a)**. `auto.min.js` is 75.2 KB (the receptacles' +1.3 KB accepted by D19, +1.2 KB from R2 and R3); nothing in hand gets back to 72 KB |
| D22 | What to do about A2 (base + DOM ≤ 35 KB) | (a) restate it as 3.0's measured core, 43.2 KB gzip, held by the size CI (b) chase 35 KB through D1's (c), the full rewrite (c) drop A2 | **(a)**. 35 KB is out of reach for this structure (wiring design §8-14, row runtime design §6-1) |
| D23 | Where the attribute readiness barriers (`mount=` / DCC) land (wiring design §9) | (a) align them: DCC lands where its load failure does (`failInitializeLoudly`); `mount=` gets a landing of its own that rejects `connectedCallbackPromise` without taking the root down (b) leave them (they throw from `connectedCallback` and the promise never settles) | **(a)**. It matches v2.4's "an initialization failure reports once and rejects" (#257). As things stand, a `/core` page that forgot scopes leaves `mount()` and `getBindingsReady` waiting forever |
| D24 | An opt-in attribute for pool pre-warming (row runtime design R5, candidate 2) | (a) not in 3.0 (b) an opt-in attribute (c) a programmatic API | **(a)**. It only moves the creation cost before the first render — the total does not shrink, and unused rows are waste. D14 already revised the denominator. It can be added non-breakingly in 3.x on request |
| D25 | Cutting the remaining 3.0 KB/row (row runtime design §5) | (a) attribute the heap and cut (b) after 3.0 | **(b)**. R3 took −18 %; no acceptance criterion asks for more (A5 asks for the trend to be explained) |
| D26 | How 2.6.x is cut (shipping D8 and D9) | (a) branch release/2.6.0 from `0ce4e35e` (`597a3a44` — keyed selection, the clear's allocation, install-time wiring — plus the CI gates; its parent is main) and pick only the keyed selection's SSR-path test (it landed in `7979827d`) (b) skip 2.6 and fold it into 3.0 | **(a)**. No cherry-pick needed, exactly what D8 and D9 decided. wcstack-skill ships its v2.6+ part first too |

**Decided (2026-09-21)**: D8–D18 as recommended. D8 and D9 ship from the current working tree (implemented) in 2.6.x; D10 and D11 ride the 3.0 vehicle; D12, D13, D15 and D16 are recorded in the design draft as 3.0 decisions; D14 revises A3's denominator (§8); D17 comes with 3.0's protocol version bump; D18 is introduced as the size CI.

**Addendum (2026-09-21, after S3's three slices)**: D19 is decided as recommended, **(a)**. `scripts/state-size-baseline.json` is re-recorded from the 3.0 build and the receptacles' +1.3 KB gzip is accepted (the gate exists to catch unintended growth; S3's growth is intended). The shared runner of (b) is decided after measuring it when S3 lands on the 3.0 vehicle. The re-record happens at the 3.0 release build; until then the working tree's current value (`auto.min.js` 70.3 KB gzip) is inside the current gate.

**Decided (2026-09-21, second round)**: every remaining question is decided as recommended.

- **D1 is (b).** 3.0 ships on the improved current runtime; the full rewrite (c) is research after 3.0. On this branch creation, heap and clear all improved on the current runtime, and only A2 was out of reach.
- **D2 is (a), no compatibility layer** (changed from the table's (b)). Instead, the last 2.x minor reports the constructs 3.0 rejects or reinterprets, through lint and a runtime warning. B1–B3 reject input that is already broken and need no layer; B5's reinterpretation cannot recover the author's intent even with the old parser kept; and carrying the old grammar in the core runs against A1 / A2. The warned constructs are fixed by D20's decision on the B items.
- **D3 as recommended** (keep full / auto; the split form is the second form), implemented.
- **D4 as recommended** (keep through 3.x, remove in 4.0). It applies once B12's renames are taken.
- **D5: inventory now.** One item is already known: D17's DevTools protocol version bump (on the `@wcstack/devtools` side).
- **D6 is (b)** (a 3.x minor).
- **D7 as recommended** (no O(1) promise; supported by `$eq` / `$eqPath` / `$eqIndex`, with the O(N) cases published in the README), implemented.
- **D20–D26 as recommended.**
- D19's (b) (folding the receptacle loops into one runner) is measured now and taken if it saves at least 0.5 KB gzip without slowing the read path.
- A3 has not been judged yet. Compare 2.5.1 with 3.0 on D14's four measures first, then decide what to do about any that fall short.

## 7. Migration and deprecation

- Following the README's deprecation practice, every adopted breaking change is **announced in 2.6.x before 3.0** — a lint rule and/or a runtime notice naming the replacement. v1.x flagged named state with `wcs/named-state-deprecated` before v2.0 removed it; the same shape applies.
- Write `docs/migration-v3.md` and `.ja.md` with the structure of [migration-v2.md](./migration-v2.md).
- Followers: both READMEs, the manifest schema, lint, `packages/vscode-wcs`, DevTools, SSR, and the separate `wcstack-app` skill repository.
- Register this document and the audit in the translation table in `docs/README.md` / `.ja.md`.

## 8. Acceptance criteria

These carry over the provisional targets of audit §8. They are **targets, not measured predictions**; missing one sends the work back to the feature matrix and fresh measurements.

| ID | Criterion | How it is measured |
|---|---|---|
| A1 | Named full entry at or under about 72 KB gzip → **restated as 3.0's measurement (D21)** | Measured once N1 ships, then held by the size CI (N3, D18's +3 %). A helper-only import retains no runtime |
| A2 | Selected base + DOM at or under 35 KB gzip → **restated as 3.0's measured core, 43.2 KB (D22)** | A prototype target, measured with the excluded features listed explicitly. **Measured 2026-09-21: the split `@wcstack/state/core` is 42.7 KB gzip** (single-file bundle; extracting the wiring did not shrink it, and `features/formats` took 1.1 KB off — wiring design §8-11 and §8-13). Unifying `BindingSession` stopped being a lever after R2 and R3 (row runtime design §6-1); the last lever, separating the diagnostics (`features/diagnostics`, wiring design §8-14), leaves the core at 43.2 KB, and 35 KB is out of reach for this structure |
| A3 | At least 25% median improvement in create / append / clear, measured on **warm create 1,000, cold create 10,000, append 1,000 and clear 10,000** (D14: cold create 1,000 is "the content creation the pool hides + the creation's GC + warm-up", which per-binding optimisation does not move, survey §10.15; cold create 1,000 is only checked for regressions) | Without concealing regressions in plain reads, partial updates, swaps or startup. Alternate A/B order, use multiple browser processes and sufficient samples |
| A4 | No architecture chosen from differences near 0.1 ms | Below timer resolution, no ratio is claimed (audit §4.2) |
| A5 | Memory behaviour is explainable | Tens of create/clear and root attach/dispose cycles, with post-GC trend, retaining owners, and explicit pool bounds |
| A6 | Every reproduced inconsistency is pinned | For each item in §3, a test fixes the behaviour whichever way the decision goes |

All existing keyed checks pass today, but a full replacement reuses 1,000 TR nodes from the pool. **Preserving identity during same-key moves and recycling DOM for different data are distinct contracts**, and focus, unsynchronized input values and custom-element internal state need their own correctness tests (audit §4.1).

## 9. Sequence

1. **Freeze semantics** — turn the §3 reproductions into regressions and decide readonly, empty values, literal types, scope capabilities and ready/error behaviour. Establish one source of truth for the grammar.
2. **Fix delivery** — N1–N3, by changing Rollup templates and synchronization rather than generated copies.
3. **Compare prototypes** — the improved current runtime against a new core / DOM adapter, with address unification held as an independent variable (**dropped from 3.0's prerequisites by D20**: 3.0 ships on the improved current runtime — D1).
4. **Choose the major's scope** — inventory real usage and classify features as standard / optional / removed / compatibility. Source size is not evidence of popularity.
5. **Migrate** — §7.

The behaviour-neutral part of step 1 (the reproductions as regressions) and step 2 can ship as 2.6.x. The 3.0 tag waits for step 1's breaking fixes (D20), 2 and 4.

## 10. Risks and what is unmeasured

- The audit is exploratory work on one machine at one revision. Differences from older `bench-run.json` files are not regression percentages. Long-running leaks, mobile devices, complete SSR behaviour and all workload comparisons remain unmeasured.
- Splitting adds requests and latency and weakens compression. Do not start from very small chunks; measure base, temporal, component and SSR groups.
- Entry-script SRI does not cover dynamically loaded chunks. Keep the full and split contracts distinct ([sri.md](./sri.md)).
- Loading features from declarations or filters needs a readiness barrier, never inside synchronous getter/setter evaluation. Late DOM, `setInitialState`, reconnects and SSR hydration need the same barrier.
- Reimplementing every existing feature with identical semantics recreates the same size and complexity (audit §1).
