# `$scan` — declaring an accumulation over time

## What this is

```javascript
export default {
  page: 1,

  $streams: {
    pageResult: { args: (s) => s.page, source: loadPage },
  },

  $scan: {
    feed: {
      from: "pageResult",
      initial: { items: [], pages: [] },
      fold: (feed, chunk) => {
        if (chunk?.kind !== "success" || feed.pages.includes(chunk.page)) return feed;
        return { items: feed.items.concat(chunk.items), pages: [...feed.pages, chunk.page] };
      },
    },
  },
};
```

```html
<template data-wcs="for: feed.items"><li data-wcs="textContent: .name"></li></template>
```

`$scan` is a declaration map on the state object, in the same family as `$streams` and `$watch`. Each entry folds the occurrences of a **source** (a state path or an event token) with `fold`, and keeps the result in an **output property**.

It needed a place of its own because neither existing declaration can hold this value:

- `$streams.fold` folds **within one run**. When a dependency changes and the stream restarts, the value goes back to `initial`.
- `$watch` **owns no value**. You can accumulate by writing `this.items = this.items.concat(...)` inside a handler, but then nothing declares who owns that value, how often it is folded, or when it resets.

What `$scan` deliberately does **not** do:

- **It is not a general stream algebra.** There are no `merge` / `filter` / `debounce` operators, and each output has exactly one source.
- **It never folds a getter's re-evaluations.** Declaring a getter as a source raises (see [Never fold a getter](#never-fold-a-getter)).
- **It has no backpressure.** An infinite source must fold into a bounded value (see [Bounded folds](#bounded-folds)).

---

## Declaration reference

```javascript
$scan: {
  feed: {
    from: "pageResult",          // a state path (exclusive with on)
    initial: { items: [] },      // required
    fold: (acc, cur, prev) => …, // required
    resetOn: ["pageSize"],       // optional
  },
  log: {
    on: "message",               // an event-token name declared in $eventTokens (exclusive with from)
    initial: [],
    fold: (acc, event) => …,
  },
},
```

### Field contracts

| Field | Type | Required | Contract |
|---|---|---|---|
| `from` | `string` | one of `from` / `on` | A state path. Wildcards are allowed (folded per row). Not allowed: a leading `$`, `@`, empty segments, a getter, a path under a getter (an expansion of a `$recursion` `**` getter such as `nodes.*.total` included), a setter without a getter or a path under one, the entry's own output or anything under it. |
| `on` | `string` | one of `from` / `on` | An event-token name declared in `$eventTokens`. |
| `initial` | any | ✔ | The seed of the output and what `resetOn` returns to. An explicit `undefined` is fine. Plain data is copied each time it is placed on the output, so writing a child path inside that plain part never changes the declared `initial`. Plain data means arrays and objects whose prototype is `Array.prototype`, `Object.prototype` or `null`, that are not frozen, and whose own properties are all enumerable string-keyed data properties (for arrays, only indices and `length`). Anything else — getters and setters, Symbol keys, non-enumerable properties, extra properties on an array, Array subclasses, frozen values, functions, class instances, `Map` / `Set`, `Date`, DOM nodes — is placed by reference, whether it is `initial` itself or sits inside it, and no getter runs. Writing into such a value changes the declared `initial` as well, and a reset does not undo it; writing into a frozen value throws. Keep what you accumulate and reset as plain data. |
| `fold` | function | ✔ | See [The fold contract](#the-fold-contract). |
| `resetOn` | `string[]` | — | See [resetOn](#reseton). |

### Fold arguments

| Source | Arguments |
|---|---|
| `from` | `(acc, cur, prev, ...indexes)` — `cur` is the settled value for the batch, `prev` the value at the start of the batch (the same ledger `$watch` uses; see [When `prev` is `undefined`](#when-prev-is-undefined)), `indexes` the row indexes of a wildcard path |
| `on` | `(acc, event, ...indexes)` — `event` is the event the element dispatched, `indexes` the loop indexes of the element's context |

#### When `prev` is `undefined`

`prev` is recorded when a write to that path itself writes a primitive (`null` included), and it is the value from before that write — which may be an object. It is `undefined` when:

- the new value is a reference type (an object or an array), the landing came from `$postUpdate`, or `config.sameValueGuard` is off — the same as `$watch`;
- the path was not written itself: a whole-parent write (`state.user = { … }` landing `user.name`) or a row of a replaced list;
- the write was made while an earlier batch was being drained: during binding application (a `$updatedCallback`, or a `$on` handler run by an event that an element dispatched synchronously while its binding was being applied), or inside the `$scan` / `$watch` listener (a `$watch` handler, or another scan writing its output). The ledger is cleared at the end of that listener, before the batch the write belongs to is drained; a write by a listener that runs after it in the same drain — the `$streams` restart writing `initial` — still carries `prev`. A `from` that is the output of a `from` scan therefore always gets `undefined`. An `on` scan writes its output inside the event — outside the drain, unless the event came during binding application — so a `from` that reads it gets `prev` like any other write.

A `$streams` chunk carries `prev` when the chunk is a primitive; an object chunk gets `undefined`. The reset to a primitive `initial` that a restart writes carries the last chunk as `prev`, even when that chunk was an object.

### Declaration-time checks (raise)

These violations raise with `[wcs/scan-declaration-invalid]` or `[wcs/scan-source-computed]` — and a `**` in `from` / `resetOn` with `[wcs/recursion-unsupported]`, with or without `$recursion` — when the state is set. The checks read only the declared value, so a re-set that throws leaves the element on the previous generation.

- `$scan` is not an object, or an entry is not an object (an array is not taken as one).
- An output name is empty, contains `.` or `*`, starts with `$`, or is inherited from `Object.prototype`. It collides with a getter, a setter, a method (a function-valued property) or a `$streams` name.
- An entry declares neither or both of `from` and `on`. `on` is not declared in `$eventTokens`.
- `from` is not a well-formed path, is a getter or sits under one — an expansion of a `$recursion` `**` getter (`nodes.*.total` for `get "nodes.**.total"()`, or a path inside its value) counts as one — (`wcs/scan-source-computed`), is a setter without a getter or sits under one (it always reads `undefined`), or reads the entry's own output.
- `initial` is missing, or `fold` is not a function.
- `resetOn` is not an array of strings, or one of its paths contains a wildcard, is a getter (`wcs/scan-source-computed`), equals the entry's own `from` or sits under it, or reads any scan output.
- Scans feed each other through the roots of their `from` paths (the `from` of `a` is `b`'s output and the `from` of `b` is `a`'s output, and so on).

---

## Firing

### `from` — a scan of changes

- **It fires at the end of the updater's drain**, once per absolute address that landed in the batch.
- **Several writes in one job** are coalesced into one fold (`cur` is the last value, `prev` the value at the start of the batch). Receive occurrences you need one by one through `on`.
- **A wildcard `from`** folds per row. When several rows land in one batch, `acc` is chained through them in ascending index order and the output is written once at the end. For row addresses to land, the list has to be rendered with `for` or declared in `$listKeys` — the same condition as `$watch`. Row landings are narrowed to one per position of the list as it is at the drain, exactly as `$watch` narrows them: the address of a row whose position no longer exists (the row was written and then the list was shortened or emptied in the same job) and the address of a row the list no longer holds (written, then removed or replaced in the same job) are not folded, and a row that only moved into a position does not land. Replacing a nested list lands every row of the new array, including the ones past the old length. Writing an element into `list.*` folds that position once, reading the value now there.
- **An equal primitive write** never reaches the batch (the same-value guard drops it), so in practice the fold runs on change. A configuration with `config.sameValueGuard` turned off is not supported.
- **A whole-parent write** (`state.user = { … }`) also lands a child `from` such as `user.name`, with `prev === undefined`.
- **An element output property** (such as `message`) as `from` also folds the initial sync that runs when the binding is established. Receive element occurrences through `on`.
- **A `from` that is another scan's output** folds that output as it landed, once per landing, whatever the declaration order. The drain first decides every scan's next value and only then writes them, so a value that a scan writes in this drain reaches the scans reading it in the next batch.

The order between mechanisms is fixed:

| Order | Mechanism |
|---|---|
| 1 | `$updatedCallback` (inside binding application) |
| 2 | `$scan` (`from` / `resetOn`) — folds and writes the outputs |
| 3 | `$watch` |
| 4 | the dependency-driven `$streams` restart |

While a `<wcs-view-transition>` accepts the `state` participant, binding application moves to a frame, and the order becomes `$scan` → `$watch` → `$streams` restart → `$updatedCallback` ([timing-and-firing-contract.md](../../../docs/timing-and-firing-contract.md) §4.3).

A scan's write lands in the next batch. A `$watch` on the output therefore fires in that batch, and its `prev` is normally `undefined` — the same as watching something another `$watch` handler wrote. `$watch` runs after the scan write, so a `$watch` handler in the same drain reads the output as folded, and a value it writes to the output stays.

One chain behaves differently. When the `from` source is written again before the output's landing drains — whether before or after the scan's write: by a `$updatedCallback` (or an `$on` handler for an event dispatched synchronously) while the same drain applies bindings, by a `$watch` handler in the same drain, or by a microtask that runs before the next drain — the output's landing and the source's new landing share a batch. The scan writes the output again in that batch before `$watch` fires, so a `$watch` on the output gets the landed value in `prev`, sees `cur` one step ahead, and can fire once more with the same value in the next batch (with `prev` `undefined`). An object output always has `prev` `undefined`, so only the repeated value shows. When the source is written while bindings are applied, before the scan's write, the fold also receives the batch's settled value twice: the value in between is never folded, so a running total can drift. That comes from reading a batch's settled value, which `$watch` does too, not from `$scan`. If you build such a chain, make the `$watch` on the output tolerant of a repeated value (an idempotency key, or a comparison with the last value it handled). To clear an accumulation from a user action, prefer a nonce read by `resetOn`.

### `on` — a scan of occurrences

- An `on` scan is a subscriber of the event token. When the element dispatches the event, it folds and writes synchronously, right there.
- **One fold per event.** Two events dispatched in the same task fold twice.
- It runs **before that token's `$on` handlers**, so a `$on` handler reads the already-folded output.
- When the element sits inside a `for`, its loop indexes are passed as `indexes`.

### Where it meets `$streams`

- **Restart wins.** When the root of `from` is a `$streams` name and the same batch carries a restart dependency of that stream, the fold is skipped: the chunk that landed belongs to the run that the same drain aborts (the same rule as §3-2 of the [`$streams` design notes](../../../docs/state-streams-design.md): when a chunk and that stream's own restart trigger land in one drain, restart wins).
- **A self-loop raises.** For a scan whose `from` root is a `$streams` name, if that stream's `args` read a path reachable from the scan output (the output itself, a getter derived from it, or the output of another scan that folds it, and so on), `[wcs/scan-feedback-loop]` is raised on every start and restart. At start it is thrown from the stream start inside the element's connection and is not normalized: the stream stays `idle`, nothing is written to `$streamError.<name>`, and `connectedCallbackPromise` never settles — the same as an `args` that reads its own stream. In a dependency-driven restart it is normalized into `$streamError.<name>`.

```javascript
// ✗ every landing advances page, restarting the stream without the sentinel
get page() { return Math.floor(this.feed.items.length / this.pageSize) + 1; },
$streams: { pageResult: { args: (s) => s.page, source: loadPage } },
$scan: { feed: { from: "pageResult", … } },

// ✓ keep the cursor a plain property and advance it from an event
page: 1,
$on: { sentinelChanged: (state) => { state.page = Math.floor(state.feed.items.length / state.pageSize) + 1; } },
```

---

## The fold contract

- **Synchronous**, and **returns a new value**. Mutating `acc` in place defeats both the same-value guard and the list diff.
- **No `this`.** Put whatever the fold needs on the source value (for example, carry `pageSize` on the stream chunk).
- **Returning `acc` itself writes nothing.** An occurrence that changes nothing (a progress chunk, say) passes through with `return acc`.
- **A throw, a returned Promise, or a value that cannot be read** is reported to the console and to DevTools (`state:watch-error` with `path: "$scan.<output>"`; `phase` is `"evaluate"` for a read, `"fold"` for the fold, and `"write"` for the output write), and writes nothing. When one row of a wildcard `from` cannot be read, only that row is skipped and the rest of the batch still folds. The other scans, `$watch`, the `$streams` restart and the same token's `$on` still run.

### Once per landing, not once per page

The runtime guarantees one fold per landing. There are ways for the same page to land twice:

- a page that is already `done` is run again, through a `retryNonce` or similar;
- the state element is detached and re-attached, and the stream restarts on the current `page`.

To fold each page once, keep an idempotency key in the fold (`pages` in the first example).

### Never fold a getter

A getter re-evaluates whenever any of its inputs change. A fold over a getter counts re-evaluations instead of occurrences, and appends the same value again when an unrelated dependency changes. The declaration check refuses a getter as `from` / `resetOn` and as any ancestor of those paths, and an expansion of a `$recursion` `**` getter as `from` (`nodes.*.total` for `get "nodes.**.total"()`, or a path inside its value). When a `from` becomes a getter after the declaration (a volume registering an accessor), it reports `[wcs/scan-source-computed]` once on firing and stops folding for that scan; `resetOn` does not read the getter, so a reset still returns the output to `initial`.

### Bounded folds

There is no backpressure. Folding the raw occurrences of an infinite or long-lived source grows memory without limit.

```javascript
fold: (log, event) => [...log.slice(-99), event.detail], // ✓ the last 100
fold: (count) => count + 1,                              // ✓ a count
fold: (log, event) => [...log, event.detail],            // ✗ unbounded on an infinite source
```

---

## resetOn

- When a `resetOn` path is written, the output returns to `initial`.
  - **A `from` scan** resets at the end of the drain, and **that batch's fold is skipped** (reset wins).
  - **An `on` scan** sees the reset from the moment of the write. An event that comes after the write — later in the same job, or dispatched synchronously by an element while the write is applied to its binding — folds into `initial`. With no event in between, the output returns to `initial` at the end of the drain. The pending reset is used up only once that event's output write succeeds: if the fold throws, returns a Promise or the write fails, the output returns to `initial` at the end of the drain. When that drain does not fire scans for the batch (the state element was disconnected before the drain, or the `$watch` chain depth limit cut the batch), the reset is dropped, the same as for a `from` scan — unless the same `resetOn` path has already been written again for the next batch, whose drain then uses it. A re-set of the state carries the pending reset over only while the write is still queued: the new declaration's `on` scan with the same output name takes it over when it still lists the written path in `resetOn`. A re-set while that write is being applied to bindings (from a `$updatedCallback`, or an `$on` handler run during binding application — before the scans of that drain), a `resetOn` path the re-set newly adds, and an output changed from `from` to `on` do not carry it: the `on` scan does not reset the value already written, while a `from` scan does. Later in the same drain the two stay in step: a re-set from a `$watch` handler comes after the scan writes, so both reset, and a re-set from a fold stops both resets for that drain (a drain that does not fire the scans drops the reset). To line them up for sure, write the `resetOn` path again after the re-set (a nonce is the reliable way).
- If the output already has the value of `initial` (plain data compared by contents, anything else by identity), nothing is written. Otherwise a fresh copy of `initial` is written, so a child path written in its plain part while the output was `initial` — a `$watch` handler annotating it, say — is cleared by the reset too (a write into a value placed by reference is not; see `initial` above). (`$streams` still places its own `initial` by reference.) Because a reset that changes nothing writes nothing, a `$watch` on the output does not fire for it; to react to every reset, `$watch` the `resetOn` path (a nonce) instead.
- It resets **the output only**. A cooperating cursor (such as `page`) is not rewound; if the cursor has to move too, write that as a side effect in `$watch` or similar.
- It fires on addresses, without comparing values (the same as `$streams` `args`). A primitive only lands when it actually changes, thanks to the same-value guard; an object path resets even when re-assigned with the same contents. An object path resets only when that object itself is written (`state.filter = { … }`), not when one of its children is (`state["filter.text"] = "b"`); to reset on a child change, list the leaf paths (`resetOn: ["filter.text", "filter.tag"]`) or bump a nonce. A write while the state element is disconnected does not reset.
- A `resetOn` path may be an **ancestor** of `from`: `from: "items.*.qty"` with `resetOn: ["items"]` folds row edits and starts over when the whole list is replaced (the rows of the new list are not folded — reset wins). A path **under** `from` raises: every write of `from` lands it too, so the reset would win every time.
- To clear from a user action, have `resetOn` read a nonce.

```javascript
clearNonce: 0,
clearLog() { this.clearNonce = this.clearNonce + 1; },
$scan: { log: { on: "message", initial: [], fold: …, resetOn: ["clearNonce"] } },
```

---

## Lifecycle

| Situation | Behavior |
|---|---|
| Setting `_state` | Checks the declaration and materializes a missing output from `initial` (a copy, for plain arrays and objects). An existing value is kept, so a re-set of the same object or SSR hydration does not lose the accumulation — also when the fold returns functions: a function value that the materialization, a fold or a reset placed on that output is not taken as a method conflict (any function value the runtime did not place there still raises: a real method of the same name in a new object, or a function written to the output from a handler, a method, `$resolve` / `$setAll` or a direct write through the state). |
| Connect | Scans with `from` / `resetOn` join the drain's firing set. `on` scans were subscribed when the state was set. |
| Disconnect | `from` / `resetOn` stop firing (the registry is kept). Occurrences while disconnected are not folded. The output is kept. A `$watch` handler that disconnects the element keeps what landed while the element was connected, because the scan writes before `$watch` fires. |
| Reconnect | `from` / `resetOn` fire again. `on` shares a known gap with `$on`: its subscription does not come back ([#273](https://github.com/wcstack/wcstack/issues/273)). |
| Re-set with a new declaration | Rebuilds the registry and the subscriptions. Scans of the old declaration no longer fire; with no declaration, nothing fires. |
| SSR (`inSsr()`) | Checks the declaration and materializes the output only; `from` does not fold. |
| Volume (`mount=`) | The declaration is refused before grafting. |
| Mounted `bind-component` | The declaration is not run, with a one-time warning (declare it on the root). |

---

## Choosing the right tool

| You want to | Use |
|---|---|
| compute from current values (a spatial derivation) | a getter (`$getAll(...).reduce`, a wildcard getter) |
| fold within one run, where a restart may discard it | `$streams` `fold` |
| accumulate across runs and events (over time) | `$scan` |
| react to a change with a side effect (firing a command, writing outside) | `$watch` / `$on` |

---

## Examples

### Accumulating a stream's pages into a feed

This is the shape of `examples/state-intersect-scroll`. `$streams` owns each page run, `$scan` owns the feed across runs, and `$watch` re-arms the sentinel once the feed has grown.

```javascript
$scan: {
  feed: {
    from: "pageResult",
    initial: { items: [], pages: [], noMore: false },
    fold: (feed, chunk) => {
      if (chunk?.kind !== "success") return feed;
      if (feed.pages.includes(chunk.page)) return feed;
      return {
        items: feed.items.concat(chunk.items),
        pages: [...feed.pages, chunk.page],
        noMore: chunk.items.length < chunk.pageSize,
      };
    },
  },
},
$watch: {
  feed(feed) {
    if (!feed.noMore) this.$command.rearm.emit();
  },
},
```

### Keeping the last N SSE messages and clearing them when the host changes

```javascript
host: "a.example",
$eventTokens: ["message"],
$scan: {
  samples: { on: "message", initial: [], fold: (s, e) => [...s.slice(-19), e.detail.data], resetOn: ["host"] },
  count: { on: "message", initial: 0, fold: (n) => n + 1, resetOn: ["host"] },
},
```

### Counting the requests that were sent

`loading` is a state property, so as a `from` it would not count an equal write (true → true at the moment one request supersedes another). Receive it as an occurrence instead.

```javascript
$eventTokens: ["requestStarted"],
$scan: {
  requestCount: { on: "requestStarted", initial: 0, fold: (n, e) => (e.detail === true ? n + 1 : n) },
},
```

```html
<wcs-fetch data-wcs="eventToken.loading: requestStarted"></wcs-fetch>
```

---

## Summary

| Concept | Description |
|---|---|
| `$scan` | Declaration map: source occurrences → fold → a runtime-owned output |
| `from` | Folds a state path's changes at the end of the drain (once per address in the batch) |
| `on` | Folds an event token's occurrences synchronously (once per event, before `$on`) |
| `fold` | Synchronous, no `this`, returns a new value; the same reference writes nothing |
| `initial` | Required: the seed and the value `resetOn` returns to |
| `resetOn` | When a path is written, the output returns to `initial` (`from`: that batch's fold is skipped; `on`: later events fold into `initial`) |
| Getters | Never a source (raises at declaration) |
| With `$streams` | Restart wins; deriving `args` from the scan's own output raises |
| Idempotency | Once per landing; keep a key in the fold for once per page |
| Lifetime | The output survives restarts, reconnects and re-sets of the same object |

Design record: [docs/state-scan-design.md](../../../docs/state-scan-design.md).
