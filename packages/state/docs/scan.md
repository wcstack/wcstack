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
| `from` | `string` | one of `from` / `on` | A state path. Wildcards are allowed (folded per row). Not allowed: a leading `$`, `@`, empty segments, a getter, a path under a getter, the entry's own output or anything under it. |
| `on` | `string` | one of `from` / `on` | An event-token name declared in `$eventTokens`. |
| `initial` | any | ✔ | The seed of the output and what `resetOn` returns to. An explicit `undefined` is fine. |
| `fold` | function | ✔ | See [The fold contract](#the-fold-contract). |
| `resetOn` | `string[]` | — | See [resetOn](#reseton). |

### Fold arguments

| Source | Arguments |
|---|---|
| `from` | `(acc, cur, prev, ...indexes)` — `cur` is the settled value for the batch, `prev` the value at the start of the batch (meaningful for scalars only; the same ledger `$watch` uses), `indexes` the row indexes of a wildcard path |
| `on` | `(acc, event, ...indexes)` — `event` is the event the element dispatched, `indexes` the loop indexes of the element's context |

### Declaration-time checks (raise)

These violations raise with `[wcs/scan-declaration-invalid]` or `[wcs/scan-source-computed]` when the state is set. The checks read only the declared value, so a re-set that throws leaves the element on the previous generation.

- `$scan` is not an object, or an entry is not an object.
- An output name is empty, contains `.` or `*`, starts with `$`, or is inherited from `Object.prototype`. It collides with a getter, a setter or a `$streams` name.
- An entry declares neither or both of `from` and `on`. `on` is not declared in `$eventTokens`.
- `from` is not a well-formed path, is a getter or sits under one (`wcs/scan-source-computed`), or reads the entry's own output.
- `initial` is missing, or `fold` is not a function.
- `resetOn` is not an array of strings, or one of its paths contains a wildcard, is a getter (`wcs/scan-source-computed`), equals the entry's own `from`, or reads any scan output.
- Scans feed each other through the roots of their `from` paths (the `from` of `a` is `b`'s output and the `from` of `b` is `a`'s output, and so on).

---

## Firing

### `from` — a scan of changes

- **It fires at the end of the updater's drain**, once per absolute address that landed in the batch.
- **Several writes in one job** are coalesced into one fold (`cur` is the last value, `prev` the value at the start of the batch). Receive occurrences you need one by one through `on`.
- **A wildcard `from`** folds per row. When several rows land in one batch, `acc` is chained through them in ascending index order and the output is written once at the end. For row addresses to land, the list has to be rendered with `for` or declared in `$listKeys` — the same condition as `$watch`.
- **An equal primitive write** never reaches the batch (the same-value guard drops it), so in practice the fold runs on change. A configuration with `config.sameValueGuard` turned off is not supported.
- **A whole-parent write** (`state.user = { … }`) also lands a child `from` such as `user.name`, with `prev === undefined`.
- **An element output property** (such as `message`) as `from` also folds the initial sync that runs when the binding is established. Receive element occurrences through `on`.

The order between mechanisms is fixed:

| Order | Mechanism |
|---|---|
| 1 | `$updatedCallback` (inside binding application) |
| 2 | `$scan` (`from` / `resetOn`) |
| 3 | `$watch` |
| 4 | the dependency-driven `$streams` restart |

While a `<wcs-view-transition>` accepts the `state` participant, binding application moves to a frame, and the order becomes `$scan` → `$watch` → `$streams` restart → `$updatedCallback` ([timing-and-firing-contract.md](../../../docs/timing-and-firing-contract.md) §4.3).

A scan's write lands in the next batch. A `$watch` on the output therefore fires in that batch, and its `prev` is always `undefined` — the same as watching something another `$watch` handler wrote.

### `on` — a scan of occurrences

- An `on` scan is a subscriber of the event token. When the element dispatches the event, it folds and writes synchronously, right there.
- **One fold per event.** Two events dispatched in the same task fold twice.
- It runs **before that token's `$on` handlers**, so a `$on` handler reads the already-folded output.
- When the element sits inside a `for`, its loop indexes are passed as `indexes`.

### Where it meets `$streams`

- **Restart wins.** When the root of `from` is a `$streams` name and the same batch carries a restart dependency of that stream, the fold is skipped: the chunk that landed belongs to the run that the same drain aborts (the same rule as "a chunk and its restart trigger in one drain — restart wins" in [streams.md](./streams.md)).
- **A self-loop raises.** For a scan whose `from` root is a `$streams` name, if that stream's `args` read a path reachable from the scan output through the dependency graph (the output itself, or a getter derived from it), `[wcs/scan-feedback-loop]` is raised on every start and restart. At start the exception propagates; in a dependency-driven restart it is normalized into `$streamError.<name>`.

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
- **A throw or a returned Promise** is reported to the console and to DevTools (`state:watch-error` with `phase: "fold"` and `path: "$scan.<output>"`), and writes nothing. The other scans, `$watch`, the `$streams` restart and the same token's `$on` still run.

### Once per landing, not once per page

The runtime guarantees one fold per landing. There are ways for the same page to land twice:

- a page that is already `done` is run again, through a `retryNonce` or similar;
- the state element is detached and re-attached, and the stream restarts on the current `page`.

To fold each page once, keep an idempotency key in the fold (`pages` in the first example).

### Never fold a getter

A getter re-evaluates whenever any of its inputs change. A fold over a getter counts re-evaluations instead of occurrences, and appends the same value again when an unrelated dependency changes. The declaration check refuses a getter as `from` / `resetOn` and as any ancestor of those paths. When a `from` becomes a getter after the declaration (a volume registering an accessor), it reports `[wcs/scan-source-computed]` once on firing and stops that scan.

### Bounded folds

There is no backpressure. Folding the raw occurrences of an infinite or long-lived source grows memory without limit.

```javascript
fold: (log, event) => [...log.slice(-99), event.detail], // ✓ the last 100
fold: (count) => count + 1,                              // ✓ a count
fold: (log, event) => [...log, event.detail],            // ✗ unbounded on an infinite source
```

---

## resetOn

- When any `resetOn` path lands in a batch, the output returns to `initial` and **that batch's fold is skipped** (reset wins).
- If the output is already the same reference as `initial`, nothing is written.
- It resets **the output only**. A cooperating cursor (such as `page`) is not rewound; if the cursor has to move too, write that as a side effect in `$watch` or similar.
- It fires on addresses, without comparing values (the same as `$streams` `args`). A primitive only lands when it actually changes, thanks to the same-value guard; an object path resets even when re-assigned with the same contents.
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
| Setting `_state` | Checks the declaration and materializes a missing output from `initial`. An existing value is kept, so a re-set of the same object or SSR hydration does not lose the accumulation. |
| Connect | Scans with `from` / `resetOn` join the drain's firing set. `on` scans were subscribed when the state was set. |
| Disconnect | `from` / `resetOn` stop firing (the registry is kept). Occurrences while disconnected are not folded. The output is kept. |
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
| `resetOn` | When a path lands, the output returns to `initial` and that batch's fold is skipped |
| Getters | Never a source (raises at declaration) |
| With `$streams` | Restart wins; deriving `args` from the scan's own output raises |
| Idempotency | Once per landing; keep a key in the fold for once per page |
| Lifetime | The output survives restarts, reconnects and re-sets of the same object |

Design record: [docs/state-scan-design.md](../../../docs/state-scan-design.md).
