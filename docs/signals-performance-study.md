# Why `@wcstack/signals` stayed slow — a study, and what 4.18 changes

- **Status**: study and implementation, 2026-11-07. The author took the recommendations the same day (§5); the work is in the 4.18 minor (§6).
- **日本語版**: [signals-performance-study.ja.md](./signals-performance-study.ja.md)

The 4.0 rewrite made `@wcstack/state` fast on js-framework-benchmark; `@wcstack/signals` was not touched and stayed where it was. This document records how the gap was measured, where the time went, the five prototypes, what was decided, what was built, and what is left.

## 1. The gap

On the official js-framework-benchmark harness (keyed, weighted geometric mean of the CPU benchmarks, lower is better), two runs in October and November 2026:

| | weighted geomean |
|---|---|
| vanillajs | 1.02 |
| `@wcstack/state` 4.x | 1.06 – 1.07 |
| `@wcstack/signals` 4.x | 1.20 – 1.22 |

In July, before the rewrite, signals was the faster of the two. A fine-grained signals library (Solid's model) is usually close to vanilla on this benchmark, so the distance was in the implementation, not in the model.

## 2. How it was measured

jsfb's own measure (from the click to the paint) could not separate prototypes a few milliseconds apart: two runs of the same page gave 46.8 and 67.0 ms for "create rows". The prototypes were compared on **the JS time in the page** instead:

- the repository's benchmark page (`packages/signals/__e2e__/benchmark/index.html`) served with each variant's `dist/` in Chromium (Playwright), the CPU throttled 4× through the DevTools protocol;
- for each jsfb operation, the time from calling the action to the end of `flushSync()` — the JS work of the update, without layout or paint;
- variants alternating round by round, a fresh page for each, the median of rounds × repetitions;
- for "where", the DevTools sampling profiler around the same operations; for memory, the heap after two forced collections (jsfb's "run memory": 1,000 rows).

The scripts are not in the repository; the method is this section.

## 3. Where the time went

- **Create 1,000 rows**: about 60 % in DOM natives (`createElement`, `appendChild`, `addEventListener`), 10 % GC, 30 % JS. Per row the JS made two signals for `For`'s index and current-item accessors (most rows read neither), an observers `Set` for each effect (an effect is never read), a closure per owned node, and an anchor comment per reactive text child; `bindProp` ran two regular expressions per prop.
- **Clear 10,000 rows**: a fifth of it was `removeEventListener`, called once per listener when each row's owner was disposed — on elements that had just been removed and would be collected with their listeners anyway.
- **Select a row**: each row's `class` binding compared `selected.get() === item.id`, so one click re-ran all 1,000 bindings to change two.
- **Memory**: 2.99 MB for 1,000 rows, for the same reasons as "create".

Two ideas were measured and set aside: building rows by cloning a template is only a tenth faster than `createElement` for the DOM part (12.2 vs 13.9 ms at 4×), not worth a new API; and the `isDev()` read on every call is about 3 % of "create", left for later.

## 4. Prototypes

Each prototype was built on the 4.17.0 source and measured against the 4.17.0 dist (JS time in the page, ms, median; two independent runs; a change within ±10 % is noise at these sizes):

| | create 1k | replace 1k | update 10k | select 1k | swap 1k | remove 1k | append 1k | clear 10k |
|---|---|---|---|---|---|---|---|---|
| 4.17.0 | 25.1 | 50.4 | 7.9 | 1.4 | 1.6 | 1.6 | 45.2 | 229.2 |
| A | +15 % | −3 % | −14 % | −7 % | −6 % | −6 % | −31 % | 0 % |
| A + B | −8 % | −19 % | −23 % | −14 % | −12 % | −13 % | −32 % | −22 % |
| A + B + C | −13 % | −28 % | −23 % | −7 % | −13 % | −13 % | −29 % | −26 % |
| A + B + C + D | −7 % / −12 % | −15 % / −18 % | −10 % / −6 % | **−86 %** | −12 % | −13 % / 0 % | −27 % / −7 % | −19 % / −27 % |
| A + B + C + D + E | −10 % | −23 % | −5 % | −79 % | −13 % | 0 % | −6 % | −27 % |

(Two figures: the first run / the second run. The rows up to C were in the first run only. A's +15 % on "create" and −31 % on "append" are more than its changes can explain — the 4.17.0 dist itself moved from 45.2 to 34.9 ms on "append" between the runs — so only what both runs agree on is read as a result.)

- **A** — `For`'s index and current-item signals made the first time `each`'s accessor is read; an effect without its own observers `Set`; an owned node registered as itself instead of a closure; the `on…` test without a regular expression.
- **B** — no `removeEventListener` at owner disposal. Two tests failed: a listener on an element that **stays** in the document (a kept element under a reactive child) would stay too. This is what led to B′ (§5).
- **C** — a reactive child whose value is text places no anchor comment; its Text node is the position. An anchor is placed the first time the value becomes nodes.
- **D** — `selector()`, Solid's `createSelector`, and the page's row class through it. The prototype kept each key's subscription after its last reader left: the heap after five create/clear cycles grew from 1.35 to 1.90 MB.
- **E** — dependency edges as arrays with slots instead of `Set`s (Solid's layout). No gain in time or memory over D, and a larger change of the core: not adopted.

Memory, 1,000 rows: 2.99 MB → 2.27 MB with A to C.

## 5. Decisions

The author took the recommendations on 2026-11-07 ("推奨で進めて"):

1. **A and C are adopted** as they were measured.
2. **B′ instead of B**: at owner disposal, a listener is removed only when its element is still in the document (`el.isConnected`). An element that stays loses its listeners as before; one that has left (a removed row, a replaced subtree, a disconnected `SignalsElement`'s content) goes with them. `For` removes a row's node before it disposes the row, so clearing a list takes B's whole gain.
3. **`selector()` is added**, with the leak fixed (a key is forgotten when its last reader leaves), and the benchmark page reads the selected row through it.
4. **This document**, and the release in the next minor (4.18).

Not adopted: E, template cloning. Not decided here: submitting the new page to js-framework-benchmark upstream.

## 6. What was built

- `packages/signals/src/reactive.ts`
  - An owner's children are disposer functions or nodes with a `_disposeOwned()` method; computeds and effects register themselves (no closure each). Effects share one empty observers `Set`.
  - `selector(source)`: one `Map` from key to a small observable; an internal effect on `source` marks the readers of the key it left and of the key it took. `untrack()` calls an observable's `_unobserved` hook when its last observer leaves, and the key's entry is deleted. A call outside a computation reads `source` and subscribes nothing.
  - Keys are compared as a `Map` compares them (SameValueZero). The prototype's `equals` parameter was dropped: a custom equality cannot find the subscription a `Map` holds under another object, so `selected.set({ id: 2 })` never reached the reader of `{ id: 2 }`. To select an object, select its id through a `computed`.
- `packages/signals/src/dom.ts`
  - `bindProp`: the `on…` test by character codes; B′ in the listener's cleanup.
  - `insertReactive`: C — the first Text node is the position while the value stays text; an anchor comment is placed after it the first time the value becomes nodes.
  - `For`: a row holds its position and item as plain values, and makes the index / current signal from them on first read.
  - `selector` re-exported, as from `@wcstack/signals`.
- `packages/signals/src/dev.ts`: a raw NUL character in the dedupe key written as `\u0000`.
- Tests: the listener tests rewritten for B′ (removed in the document, kept outside it, and a `For` that removes 3,000 rows calls `removeEventListener` 0 times), anchor-less text in every transition, lazy index / current read after a move, and `selector` (readers re-run, the same tick round trip, a fresh read before the flush, `NaN`, computed source and reader, keys forgotten, calls outside a computation, disposal, a `For` of 100 rows where one selection change re-runs 2 bindings). Coverage stays at 100 %.

What an author can notice:

- A handler on an element removed **outside** the document is not removed: a script that keeps such an element and dispatches an event to it still calls the handler. Users cannot click it.
- A reactive text child has no comment node next to it: a test that counted `childNodes` sees one node fewer.

## 7. Result

4.17.0 against this work, the same method as §4 (the page before this change for 4.17.0, the page with `selector` for this work):

| | create 1k | replace 1k | update 10k | select 1k | swap 1k | remove 1k | append 1k | clear 10k |
|---|---|---|---|---|---|---|---|---|
| 4.17.0, ms (run 1 / run 2) | 25.6 / 27.5 | 56.3 / 48.6 | 7.7 / 7.1 | 1.4 / 1.5 | 1.5 / 1.5 | 1.8 / 1.6 | 50.3 / 40.3 | 235.4 / 232.7 |
| this work | +12 % / −9 % | −19 % / −11 % | −8 % / +1 % | **−79 % / −80 %** | +7 % / −7 % | −17 % / 0 % | −30 % / −13 % | −21 % / −23 % |

What both runs agree on: selecting a row about −80 %, clearing 10,000 rows −21 to −23 %, replacing 1,000 rows −11 to −19 %, appending 1,000 rows to 10,000 −13 to −30 %. Update, swap and remove stay within the noise. "Create" moved the most between runs — the 4.17.0 dist itself took 25.6 and 27.5 ms — so it was measured once more alone with "replace" (6 rounds × 10, the prototypes beside it): create −16 % (A + B + C −13 %, the prototype with D −10 %; this work on the page without `selector` −13 %), replace −19 % (−24 %, −22 %; −19 %).

Memory after two forced collections:

| | 4.17.0 | this work |
|---|---|---|
| 1,000 rows | 2.99 MB | 2.63 MB |
| after five create / clear cycles | 1.36 MB | 1.36 MB |

The second line is the leak fixed: the prototype with D kept 1.90 MB there. Of the 0.72 MB that A to C saved on 1,000 rows, `selector`'s subscription per key (a `Set` each) takes back about half; making that subscription a class instead of an object with a closure saved nothing measurable, so it stayed an object.

## 8. What is left

- **Event delegation** — one listener per event type on the root, a handler found from the target — is what the fastest libraries do for "create" and "clear". It changes how `h()` attaches handlers (and what `currentTarget` is), so it needs its own design. Done as an opt-in in 4.19 (§9).
- **`isDev()`** is read on every call that may warn; reading it once per operation would save about 3 % of "create".
- The new page has not been run on the official harness; from §7 the weighted geomean should land near 1.13 – 1.15, which is an estimate, not a measurement.

## 9. Event delegation (4.19)

The first item of §8, done as an opt-in on 2026-11-08 (the author asked for it).

**Design.** `delegateEvents(types?, root = document)` (from `/dom`). From the call on, `h()` keeps the `on…` handler of a delegated type in a symbol-keyed slot on its element — no listener, no cleanup — and the root has one listener per type. That listener walks the event's composed path from the target outwards and calls each slot with the element as `currentTarget` and `this`. It stops where `stopPropagation()` was called, and a handler that throws is reported while the walk goes on, as with listeners. A composed event that reaches both a shadow root and the document is walked once. It is opt-in because the reach and the order differ from a listener on the element:

| | A listener on the element | Delegated |
|---|---|---|
| When it runs | At the element, before the listeners of its ancestors | When the event reaches the root, after them; not at all if one of them stops it |
| An element outside the document | Called on `el.click()` | Not called |
| Which events | Any | Those that bubble and are composed — `click`, `dblclick`, `contextmenu`, `input`, `beforeinput`, `keydown`, `keyup`, `focusin`, `focusout`, the pointer and mouse events; others throw |
| Inside a closed shadow root | — | Pass the root |
| After its owner is disposed | Removed while the element is in the document (4.18) | Stays with its element |

Touch and wheel events bubble and are composed, but they are refused: Chromium makes a root's listener for them passive, so `preventDefault()` in a handler would be ignored. `change` and `submit` bubble but are not composed.

**Measurements.** The page-level A/B could not resolve the change. On this machine about a third of the CPU was busy with other programs: one build measured against itself differed by up to 16 %, and a paired run (A B B A in each round, 8 rounds) put "create 1,000 rows" anywhere between −8 % and +47 %. Clearing 10,000 rows was faster in 7 of 8 rounds (−6 %, median). The work itself was measured in isolation instead: 2,000 handlers on 1,000 rows, the four ways interleaved in one page, in three runs.

| 2,000 handlers | Building (ms, 4× CPU) |
|---|---|
| No handler | 6.5 – 6.7 |
| A listener and its cleanup (4.18) | 8.5 – 9.2 |
| A symbol-keyed slot (this work) | 6.7 – 6.9 |
| A string-keyed slot | 6.3 – 6.6 |

A listener and its cleanup cost about 2.3 ms per 2,000 handlers at 4× CPU, 7 – 9 % of creating 1,000 rows. A slot costs about 0.2 ms, and clearing has no cleanup closure per handler to run. The slot is keyed by a symbol, not `$click` as in Solid: a few tenths of a millisecond, for not putting an enumerable name on an author's elements. The benchmark page delegates `click`.

**Size.** `./dom` grows 376 B brotli (6,401 → 6,777 B). `delegateEvents` and the walk are about 277 B, which a bundler drops when the function is not imported; the slot in `h()` is about 124 B. The budget moves from 6.5 to 6.9 kB.
