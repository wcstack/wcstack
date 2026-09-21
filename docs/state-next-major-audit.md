# State next-major audit

**日本語**: [state-next-major-audit.ja.md](./state-next-major-audit.ja.md)

Date: 2026-09-18. Target: `@wcstack/state` 2.5.0, revision `bf27363fec154f1abb861b6b2d0f525d45274178`.
This is an investigation with measurements and reproducible examples, not an implementation change. Runtime sources and checked-in distribution files were not changed.

## 1. Recommendation

**Design the next major around a small state engine, a DOM adapter, and optional features. Decide whether to rewrite the engine through a comparative prototype.**

There are four separate problems:

1. **Delivery size:** the normal buildless ESM entry is not minified. Minifying the named-export entry reduces gzip from 311 KB to 71 KB without rewriting the engine.
2. **Coupling:** scan, recursion, streams, component mounting, and SSR are statically connected to the runtime. Even importing a helper retains initialization side effects. Splitting requires new initialization and dependency boundaries.
3. **Update cost:** large row creation/destruction and notifications from shared state to every row getter are expensive. Proxy overhead alone does not explain these costs.
4. **Semantic consistency:** read/write APIs, empty values, and quoted syntax have reproducible inconsistencies. State, DOM, and component-contract perspectives also coexist in the same vocabulary.

Reimplementing every existing feature with identical semantics can recreate the same size and complexity. Define the required core contract and optional feature boundaries first.

## 2. Method and limits

- Windows, Intel Core Ultra 9 275HX, Node 22.19.0, Rollup 4.56.0, Terser 5.46.0, TypeScript 5.9.3. The exact Chromium version is in the [browser record](./research/state-next/selection-and-profiles.json).
- Rebuilt all four JavaScript entries through the existing Rollup configuration into an OS temporary directory. After CRLF normalization, rebuilt `auto.min.js` exactly matches the checked-in distribution. Existing circular-dependency and inlineSources warnings remain.
- KB means 1,000 bytes. Compression uses local gzip level 9 and Brotli quality 11, not measured CDN responses.
- Existing `jsfb-verify.mjs` measures click-to-DOM-condition with a MutationObserver. It does not measure paint, networking, cold import, or complete page startup. These are not official js-framework-benchmark scores or comparisons with other libraries.
- Normal and CPU slowdown ×4 runs were sequential. Creation/append/clear have eight samples, replacement/partial updates and several other operations have ten after warmup, swap has 21. Raw samples are saved. CPU throttling does not reproduce a particular device.
- Selection comparison uses three warmups and 15 samples per condition. The click target is resolved before timing; timed selection checks do not enumerate all rows. Correct selection of exactly one row is checked after every operation.
- CPU profiles use the unminified named runtime and a 100µs sampling interval, one run per operation. They are diagnostic, not comparable benchmark timings. `(program)` and other samples include protocol/idle overhead; percentages would not be causal cost shares.
- Memory uses three samples per scenario, with explicit GC. It measures JS heap, not native DOM memory or process RSS.
- All 70 existing tests in five related parser/filter-parser/resolve files passed. The additional browser audit recorded zero uncaught page errors. Audit-script syntax and documentation links were checked. The complete package regression/coverage suite was not run.
- This is exploratory work on one machine. Differences from older `bench-run.json` files are not regression percentages. Long-running leaks, mobile devices, complete SSR behavior, and all workload comparisons remain unmeasured.
- The workspace already contained untracked work, and address-unification documents and other files changed independently during the audit. Those changes were not edited or adopted here. Runtime measurements use the distribution matching the recorded revision.

## 3. Size

### 3.1 Measurements

| Artifact / experiment | bytes | gzip bytes | Brotli bytes |
|---|---:|---:|---:|
| Normal `index.esm.js` | 1,123,671 | 310,916 | 225,933 |
| Self-starting `auto.min.js` | 235,472 | 68,843 | 58,343 |
| Named ESM, experimental minification | 244,371 | 71,194 | 60,192 |
| Only `defineState` re-exported from normal entry, tree-shaken and minified | 89,768 | 26,806 | 23,634 |
| Only `VERSION`, same experiment | 89,751 | 26,816 | 23,640 |
| `parser.esm.js` | 58,038 | 15,978 | 13,053 |
| `manifest.esm.js` | 44,596 | 10,382 | 8,642 |

Named-entry minification reduces gzip by **77.1%**. `auto` bootstraps the runtime and is not a drop-in replacement for named imports. Direct browser imports do not tree-shake.

The [previous audit](./state-bundle-size-analysis.md) recorded v2.4.0 `auto` at 229,206 bytes / 66,981 gzip bytes: v2.5.0 adds approximately 2.8% gzip. Relative to v2.0.0's 52,977 gzip bytes, the increase is approximately 29.9%.

### 3.2 Composition

Approximate attribution from the generated `auto` source map, not gzip contributions or guaranteed savings from removing a feature:

| Area | Attributed minified bytes |
|---|---:|
| webComponent: mount, volume, overlay | 24,409 |
| components: State, Ssr | 23,871 |
| bindings: sessions, collection, initialization | 21,375 |
| proxy | 19,082 |
| apply | 16,497 |
| scan | 14,851 |
| recursion | 14,339 |
| event | 11,994 |
| list | 10,506 |
| structural | 9,616 |
| stream | 6,176 |
| watch | 5,987 |
| parser | 5,246 |
| filters | 5,019 |
| DCC | 4,537 |
| devtools | 3,708 |

This table lists major areas, not all files. SSR spans multiple areas. Removing only DevTools or filters cannot address most of the footprint.

`State.ts` directly connects declarations, lifecycle, DOM, and features; `updater.ts` also references watch/scan. Watch and stream runtimes register listeners at module evaluation, retaining about 27 KB gzip even for a `defineState` import. Adding subpaths or blanket `sideEffects: false` without relocating initialization is insufficient.

Sources: [State](../packages/state/src/components/State.ts), [updater](../packages/state/src/updater/updater.ts), [watch](../packages/state/src/watch/watchRuntime.ts), [streams](../packages/state/src/stream/streamRuntime.ts), [bootstrap](../packages/state/src/bootstrapState.ts).

## 4. Runtime and memory

### 4.1 Existing benchmark medians

| Operation | Normal ms | CPU slowdown ×4 ms |
|---|---:|---:|
| Create 1,000 rows | 42.85 | 127.80 |
| Replace 1,000 rows | 24.35 | 136.95 |
| Update every tenth row out of 10,000: 1,000 writes | 13.10 | 67.35 |
| Select a row out of 1,000 | 0.10 | 0.45 |
| Swap two rows out of 1,000 | 1.30 | 4.70 |
| Remove one row out of 1,000 | 3.15 | 16.50 |
| Append 1,000 to 10,000 rows | 66.00 | 320.70 |
| Clear 10,000 rows | 72.95 | 329.60 |

All existing keyed checks passed. However, a full replacement reuses 1,000 TR nodes from the pool. Preserving identity during same-key moves and recycling DOM for different data are distinct contracts. Focus, unsynchronized input values, and custom-element internal state need separate correctness tests.

### 4.2 Ordinary getters versus manual optimization

The current fixture reads `selectedIndex` through `$untrackDependency` and explicitly notifies only the old/new rows. The alternative uses ordinary reactive code:

```js
get "data.*.selected"() { return this.$1 === this.selectedIndex; }
onSelect(event, index) { this.selectedIndex = index; }
```

| Selection | 1,000 rows ms | 10,000 rows ms |
|---|---:|---:|
| Existing manual two-row invalidation | 0.10 | 0.10 |
| Ordinary tracked getter | 1.00 | 21.10 |

Timer resolution makes ratios against 0.1ms misleading; no such speedup ratio is claimed.

`checkDependency` primarily registers edges between path patterns. A scalar read by every row causes `walkDependency` to expand rows, invalidate caches, and enqueue notifications. Suppressing identical DOM writes does not eliminate upstream reevaluation. Cross-row reads recorded in `crossRowListPaths` also cause full expansion.

**Switching to signals does not remove the dependency when every row reads the same scalar.** Test per-row subscriptions, downstream suppression when computed values remain equal, and a dedicated keyed-selection subscription index separately. Ordinary value comparisons should not require manual notification, but arbitrary getters cannot be promised O(1) selection updates.

Sources: [fixture](../packages/state/__e2e__/benchmark/index.html), [dependency registration](../packages/state/src/proxy/methods/checkDependency.ts), [dependency traversal](../packages/state/src/dependency/walkDependency.ts).

### 4.3 Candidate bottlenecks

| Candidate | Evidence | Next controlled experiment |
|---|---|---|
| Row allocation/initialization | CPU samples include `importNode`, `resolveNodePath`, `initializeRow`, registrations, GC | Shared binding slots versus current representation, with identical HTML and a DOM-only control |
| Destruction/pooling | Clear profile includes `applyChangeToFor`, GC, disposal and ledger removal | Pool limits 0/small/1,000; measure both teardown and recreation |
| Synchronous invalidation | `setByAddress.notifyWrite` runs `walkDependency` per write, before drain deduplication | 1/100/1,000 writes to the same upstream value; preserve read-after-write semantics |
| Address conversions | Resolved/path/state/absolute tables, lifting and row-identity lookups | Independent address-unification prototype, including plain reads |
| Fast row-plan eligibility | Two-way bindings, custom elements, nested structures, radio/checkbox, etc. make `compileRowPlan` fall back for the entire row | Equal-sized display, form, I/O-node and child-component rows |

These are candidates supported by code and profiles, not measured savings. Leaf-path early exits, differential expansion, LIS, row plans, caches, and same-value guards already exist; they should not be proposed as missing features.

Coordinate address work with the [existing design](./state-address-unification-design.md) and [implementation plan](./state-address-unification-impl-plan.md). This audit does not replace their accepted names/phases or imply address unification solves the entire performance problem.

### 4.4 Memory

| Scenario | Post-GC JS heap MiB, median |
|---|---:|
| Ready, no rows | 1.04 |
| 1,000 rows | 5.72 |
| Five total 1,000-row creations/replacements | 6.34 |
| 1,000 rows, five partial updates | 5.98 |
| 10,000 rows | 35.37 |
| Create then clear 10,000 rows | 13.34 |

Clearing does not return to the initial heap. `applyChangeToFor` retains up to 1,000 pooled contents per anchor, which explains part of the retention. The whole difference cannot be assigned to the pool, and a single measurement does not prove a leak. Measure repeated-cycle slopes, collection after anchor/root disposal, and heap retainers.

`PathInfo`, `ResolvedAddress`, and filter string caches also use unbounded Maps. This is separate from weak row-address caches. Applications generating many distinct paths need explicit lifetime boundaries. Arbitrary LRU eviction may break intern-identity assumptions.

## 5. Syntax and semantic audit

### 5.1 Reproduced issues

Parser results and browser behavior are distinguished. Parser acceptance does not establish runtime or lint acceptance.

| Issue | Observed behavior | Classification / priority |
|---|---|---|
| Quotes versus delimiters | `join(', ')` works; `join(';')` and `join('\|')` fail because outer splitting precedes quote parsing | Grammar defect, high |
| Malformed syntax accepted | Unclosed quote in `join('unterminated)` accepted; `value#ro#wo` keeps only `ro`; `else: ignored` discards RHS | Parser strictness, high |
| Filter cache key | `args.join(',')` conflates `['a,b']` and `['a','b']`. Parsing `join('a,b')` first makes accepted `join(a,b)` produce `Xa,bY` too | Validate arity and use a structural key, medium. The second expression has excess arguments but is currently accepted |
| Modifiers change binding kind | `radio: x` is specialized; `radio#ro: x` becomes a generic property. Similar branching exists for structural keywords | Explicitly support or reject, high |
| `on` prefix reservation | `only: x` and `online: x` parse as events, conflicting with arbitrary DOM/CE properties | Namespace design, medium |
| `$resolve` overload | Starting at 7, `$resolve(path, [], undefined)` leaves 7: it cannot write undefined | API defect, high |
| Readonly bypass | Direct assignment throws; `$resolve(...,9)` and `$setAll(...,10)` on the same readonly proxy write successfully | Inconsistent write checks, high |
| Filter literal types | Applying `eq(true)` to boolean true returns false; `eq(1)` on number 1 returns true. Arguments are strings, with numeric coercion only | Literal type rules, medium |
| Truthiness | `truthy` on `0n` returns true; `boolean` returns false | Inconsistent with JavaScript truthiness, medium |

Readonly inconsistency exists between explicit path-write APIs, independently of deep immutability. Helpers call `setByAddress` without going through the check in `StateHandler.set`. Put write capability checks at the shared write boundary.

Empty-value behavior also differs between representations of the same value. Browser results after initially displaying `"seed"`:

| Input | `textContent: x` | `{{x}}` | `attr.title: x` |
|---|---|---|---|
| `undefined` | Keeps `seed` | Empty | String `"undefined"` |
| `null` | Empty | Empty | String `"null"` |

These combine native DOM behavior with framework-specific skip rules. Define absence, explicit clearing, and display conversion as a contract. If undefined means no opinion and null means clearing, specify corresponding mustache and attribute behavior, including attribute removal.

Sources: [binding parser](../packages/state/src/bindTextParser/parseBindTextsForElement.ts), [property parser](../packages/state/src/bindTextParser/parsePropPart.ts), [filter parser](../packages/state/src/bindTextParser/parseFilters.ts), [argument parser](../packages/state/src/bindTextParser/parseFilterArgs.ts), [resolve](../packages/state/src/proxy/apis/resolve.ts), [StateHandler](../packages/state/src/proxy/StateHandler.ts), [filters](../packages/state/src/filters/builtinFilters.ts), [DOM application](../packages/state/src/apply/).

### 5.2 Asymmetries to resolve or explain

| Axis | Current behavior | Recommendation |
|---|---|---|
| Reads/writes | Ordinary nested reads work; `this.user.name = …` does not notify, but `this['user.name'] = …` does | Make path access the explicit normal form; evaluate deep proxies independently |
| Bulk APIs | Omitted `$getAll` indexes use loop context; `$setAll` requires explicit indexes | A justified safeguard against accidental broad writes; retain and explain through names/types |
| Dependency APIs | `$trackDependency(path)` adds an edge; `$untrackDependency(fn)` temporarily suppresses tracking rather than removing an edge | Consider names such as `dependOn` and `untracked`, which do not imply inverse operations |
| Direction | `#ro` suppresses element→state, while readonly proxy constrains state writes | Binding vocabulary should describe direction, e.g. to-element/from-element/two-way |
| Initial synchronization | `#init` selects initial authority; `#sync` selects snapshot timing; ongoing direction depends on the component contract | Keep direction, initial authority, and timing as separate axes |
| Commands/events | Paired declarations, but `command.method: $command.name` versus `eventToken.prop: name`, with `$on` reception | Distinguish paths/token names in the AST; consider symmetry in the state adapter without casually changing external protocols |
| Temporal declarations | Plural `$streams`, singular `$watch`/`$scan`; stream folds reset per restart, scan persists | Consistent declaration-map naming; retain distinct semantics |
| Update hook | `$updatedCallback` observes applied bindings, not all state updates | Consider an after-render name; use watch for state reactions |
| Scope capability | Scan is root-only, refused in volumes, warned-and-ignored in mounted components; root/volume connection promises also fail differently | Explicit capability matrix and consistent ready/error contract; avoid silent unsupported behavior |
| Structural surfaces | Template attributes, comments and mustache; embedded text does not split semicolons | Shared tokenizer/AST, with surface adapters where needed |

Wildcard row watches also require `$listKeys` for headless operation. Decide whether the next core owns row identity and subscription lifetimes independently of the DOM.

### 5.3 Vocabulary bias

Filters strongly cover numeric, string, and date presentation, while missing-value and typed-literal semantics are weaker.

- `inc/dec` sound mutating although they are pure arithmetic. `add/sub` would align with `mul/div`.
- `uc/lc/cap/rep/rev/fix` mix abbreviations with `truncate/percent/datetime`. Full canonical names plus compatibility aliases would be easier to discover.
- `pad` means padStart only; `substr` and `slice` use different argument meanings. Choose a coherent subset aligned with standard operations instead of adding every possible counterpart.
- `defaults` replaces zero, false, and empty string too; distinguish it from nullish fallback. `null` means empty-string-to-null conversion, not a null literal.
- Several families are already symmetric: eq/ne, lt/le/gt/ge, inc/dec, uc/lc, date/time, ymd/hms. The vocabulary is not uniformly asymmetric.
- Prefer a small standard set and optional formatting packs over continual filter expansion. Input conversion and output formatting have different roles even when implemented by the same functions.

## 6. Split-loading design

These are dependency boundaries to investigate, not finalized API names.

| Unit | Contents | Loading point |
|---|---|---|
| Helpers/types | defineState, types, version | Independent import, no initialization side effects |
| Core | Tree, paths/refs, reads/writes, computed, batching, subscriptions/lifetimes | Always; no DOM/HTMLElement imports |
| DOM adapter | Basic property/text/class/style/attr, events, for/if | Before binding initialization |
| wc-bindable adapter | Contract direction/authority, command/event token wiring | Explicit registration in the standard I/O profile |
| Watch/scan/streams | Temporal reactions and accumulation | Before state declarations are materialized |
| Recursion | `**` expansion | Before recursive declarations are parsed |
| Component scopes / DCC | Mount, volume, overlays, definition helpers | Before component initialization |
| SSR / hydration | Server snapshots and client hydration | Separate server/hydration entries |
| Formats / DevTools | Additional date/number filters, observation tooling | Explicit opt-in |

Recommended delivery forms:

1. **Compatible full/auto:** retain a self-contained all-feature bundle for zero configuration and the existing SRI contract.
2. **Explicit ESM composition:** import selected features before bootstrap; usable both buildlessly and with bundlers.
3. **Optional auto-split later:** an asynchronous loader discovering features from declarations, after the first two forms work.

Replacing imports with `import()` is insufficient:

- Remove core→feature static imports. Use explicit, idempotent registration and feature disposal; an unused feature should leave only an empty notification mechanism on hot paths.
- Preserve or deliberately version batch ordering: render hook → scan → watch → stream restart, including exception isolation.
- Loading based on declarations/filters needs a readiness barrier. Do not silently ignore missing features or load inside synchronous getter/setter evaluation.
- Late DOM, `setInitialState`, reconnects, and SSR hydration need the same barrier. An initial document scan is insufficient.
- Do not rebundle core independently into each subpath. Share a single core chunk with one registry and address identity; detect mixed versions/duplicate URL instances.
- Very small chunks add requests/latency and weaken compression. Start by measuring base, temporal, component, and SSR groups.
- Entry-script SRI does not cover dynamically loaded chunks. Keep full/split contracts distinct under the existing [SRI policy](./sri.md).

Directory byte totals cannot establish a future core size. Measure a prototype that actually cuts the dependency edges.

## 7. Rewrite options

| Option | Benefits | Costs / remaining issues | Assessment |
|---|---|---|---|
| Local improvements | Fast minification/helper extraction and grammar fixes | Coupling and special cases remain | Appropriate first work |
| Incremental core/DOM replacement | Comparable while preserving authoring/protocol contracts | Compatibility adapters and a transition period | Preferred starting point |
| Full rewrite and new grammar | Opportunity to remove unnecessary contracts | Mounting, row identity, SSR, I/O and tooling contracts must be rebuilt | Adopt only after prototype wins and migration is explainable |

Prototype principles:

- Separate state ownership from DOM ownership; headless demand continues without a rendered element and root disposal releases subscriptions.
- Keep paths as the authoring contract but use resolved references internally. Resolve syntax/scope at registration, preserving tree and row-occurrence identity.
- Separate shared template plans from row instances. Store only required nodes/refs/values/teardowns per row, building on existing row-plan work.
- Centralize write capability, equality and invalidation across assignment, resolve, bulk, tokens and streams.
- Separate grammar from execution: quote-aware lexer → AST → resolved binding plan. The parser currently constructs executable filter closures; remove that coupling and share diagnostics/locations with lint/editor tooling.
- Compare proxies, a small custom graph, and the existing `@wcstack/signals` as implementation choices. A signals-only bundle is not comparable with the whole state/DOM package. Decide dependency packaging explicitly if zero runtime dependencies remains a constraint.

Use identical pages and features: scalar state, branch-dependent getters, aggregates, cross-row reads, nested lists, forms, I/O nodes, deferred definitions, mount/volume and SSR hydration. Reuse existing protocol conformance tests.

## 8. Sequence and adoption gates

1. **Freeze semantics:** turn reproduced cases into regressions and decide readonly, empty values, typed literals, scope capabilities, and ready/error behavior. Establish a shared grammar source of truth.
2. **Improve delivery:** named minified entry, pure helper entry, explicit feature initialization, size CI. Change Rollup templates and synchronization, not generated copies.
3. **Compare prototypes:** improved current runtime versus new core/DOM adapter. Treat address unification as a separate variable so improvements can be attributed.
4. **Choose major scope:** inventory usage and classify standard/optional/removed/compatibility features. Source size is not evidence of feature popularity.
5. **Migrate:** parse legacy syntax into the new AST during transition; diagnose semantic changes that cannot be converted. Update both READMEs, manifest, lint, editor, DevTools, SSR and the separate wcstack-app skill repository.

**Provisional targets**, not measured predictions:

- Named full entry: approximately 72 KB gzip or less as an initial baseline; helper-only imports retain no runtime.
- Selected base+DOM: prototype target of 35 KB gzip or less, explicitly listing excluded features. Reassess from the feature matrix and measurements if it misses.
- Creation/append/clear: target at least 25% median improvement without concealing regressions in plain reads, partial updates, swaps, or startup.
- Selection: support optimized selection through an API, and publish ordinary getter O(N) cases. Benchmark-only manual optimization is not sufficient success.
- Memory: tens of create/clear and root attach/dispose cycles, post-GC trends and retaining owners, with explicit pool bounds/lifetimes.
- Alternate A/B order, use multiple browser processes and sufficient samples/variation. Do not select an architecture from tiny differences or ratios near 0.1ms.

## 9. Reproduction and artifacts

Use existing repository dependencies. Do not run performance drivers concurrently.

```powershell
# Repository root: temporary build, size and parser experiments; does not write state/dist
node scripts/audit-state-next.mjs
node scripts/audit-state-browser.mjs

# e2e directory
node bench/jsfb-verify.mjs --label next-major --out ../docs/research/state-next/browser-1x.json --port 4297
node bench/jsfb-verify.mjs --label next-major-4x --throttle 4 --out ../docs/research/state-next/browser-4x.json --port 4297
node bench/memory-profile.mjs --label next-major --out ../docs/research/state-next/memory.json --port 4297
```

The additional browser audit reads the temporary build location from the size JSON, so run the size script first. Existing benchmark drivers use checked-in dist: verify `autoMatchesCheckedInIgnoringCRLF` is true. On a different revision with a mismatch, align dist before measuring.

- [Size, parser examples, environment](./research/state-next/size-and-syntax.json)
- [Normal browser samples](./research/state-next/browser-1x.json)
- [CPU slowdown ×4 samples](./research/state-next/browser-4x.json)
- [Selection, API/empty-value reproductions and CPU diagnostics](./research/state-next/selection-and-profiles.json)
- [Post-GC memory](./research/state-next/memory.json)
- [Size audit script](../scripts/audit-state-next.mjs) / [browser audit script](../scripts/audit-state-browser.mjs)

Feature splitting, a replacement engine, and grammar changes have not been implemented. This audit supplies evidence and controlled experiments for deciding those changes.
