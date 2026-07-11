# `$streams` — Folding Async Producers into Reactive Properties

## What Is This?

Take a look at the following state definition.

```javascript
export default {
  prompt: "",

  $streams: {
    tokens: {
      args:    (state) => state.prompt,
      source:  (prompt, signal) => llmStream(prompt, signal),
      fold:    (acc, chunk) => acc + chunk,
      initial: "",
    },
  },
};
```

```html
<p data-wcs="textContent: tokens"></p>
<p data-wcs="textContent: $streamStatus.tokens"></p>
<p data-wcs="textContent: $streamError.tokens"></p>
```

`$streams` is a declaration map on the state object — the same family as `$commandTokens`, `$eventTokens`, and `$on`. Each entry connects an **async producer** (an async iterable, an async generator, or a `ReadableStream`) to a single **reactive property**. Every chunk the producer yields is passed through `fold`, and the folded result becomes the new value of `state.tokens` — flowing through the ordinary update cycle, so bindings, computed getters, and `$updatedCallback` all react to it like any other property.

Two things `$streams` is deliberately **not**:

- It is **not a general streams pipeline**. There are no operators, no tees, no transforms — just "consume, fold, assign".
- It does **not preserve backpressure**. Demand never flows back to the producer. This is an explicit non-goal, and it has one important consequence: [your fold must be bounded](#bounded-fold-must).

---

## Declaration Reference

### The `$streams` Map

Each key of `$streams` is a flat property name; each value is a stream definition.

```javascript
export default {
  $streams: {
    // Full form: accumulate an LLM token stream
    tokens: {
      args:    (state) => state.prompt,                   // dependencies are captured here, and only here
      source:  (prompt, signal) => llmStream(prompt, signal),
      fold:    (acc, chunk) => acc + chunk,               // reduce (accumulate)
      initial: "",                                        // required when fold is given
    },

    // Minimal form: fold omitted = latest (replace with newest chunk),
    // args omitted = start once, never restart
    ticker: {
      source: (_args, signal) => priceStream(signal),
    },
  },
};
```

### Field Contract

| Field | Type | Required | Contract |
|---|---|---|---|
| `source` | `(args, signal) => AsyncIterable \| ReadableStream \| Promise<same>` | ✔ | **MUST honor the `AbortSignal`** (cooperative cancellation). Restart and disposal are driven through this signal — a source that ignores it cannot be reliably cancelled. May return a `Promise` of the producer. A `ReadableStream` without `Symbol.asyncIterator` is consumed via a `getReader()` fallback. Any other return value is a `TypeError`, surfaced through the error state. |
| `args` | `(state) => any` | — | **Synchronous, pure function.** Receives a read-only view of the state; every path read here is captured as a dependency (see [Dependency-Driven Restart](#dependency-driven-restart)). Omitted = no dependencies — the stream starts once and never restarts. The return value is passed verbatim as `source`'s first argument (bundle multiple values in an object or array). Returning a `Promise` is an error. |
| `fold` | `(acc, chunk) => next` | — | **Synchronous function.** Omitted = latest (each chunk replaces the value). **Must return a new value** — in-place mutation of `acc` is unsupported (see [Return a New Value](#return-a-new-value-no-in-place-mutation)). A throwing fold puts the stream into the error state and aborts the producer. |
| `initial` | any | ✔ when `fold` is given | Seed value. The property is reset to `initial` on every start and restart. |

### Validation

Violations raise an error when the state is set (declaration parse time):

- `$streams` must be an object mapping stream names to definitions.
- Each entry name must be a **flat property name**: non-empty, no `.`, no `*`, and must not start with `$` (reserved namespace).
- Entry names must not collide with a getter or setter declared on the state.
- Each entry must be an object (`{ args?, source, fold?, initial? }`).
- `source` must be a function. `fold`, if present, must be a function. `fold` without `initial` is an error (reduce needs a seed value).
- `args`, if present, must be a function.

Violations raise an error at start / restart time (when `args` is evaluated):

- `args` returned a `Promise` (the synchronous contract).
- `args` read the stream itself — `<name>`, `$streamStatus.<name>`, or `$streamError.<name>` (a self-dependency would restart the stream on its own writes).
- `args` read a wildcard path (including via `$getAll`) — wildcard dependencies are out of scope for now.

### The Value Property

At parse time, if `state[name]` is undefined it is materialized as an ordinary data property holding `initial` (or `undefined` when there is no fold). This means the initial render — and SSR output — shows `initial` even before the stream starts.

You may pre-declare the property yourself (useful for typing with `defineState`), but the value is **overwritten with `initial` when the stream starts**. Once started, the property is owned by the stream runtime: assigning to it from user code is not blocked, but the behavior is undefined — the next fold simply folds on top of whatever you wrote.

---

## Companion Namespaces: `$streamStatus` / `$streamError`

Every stream exposes two read-only companion paths:

- `$streamStatus.<name>` — `"idle" | "active" | "done" | "error"`
- `$streamError.<name>` — the most recent error, or `null`

| Status | Meaning |
|---|---|
| `idle` | Declared but not running (before connect, or after disconnect) |
| `active` | The current run is consuming chunks |
| `done` | The producer ended normally |
| `error` | The run failed (source threw or rejected, fold threw, or the producer was not iterable) |

Semantics:

- **Read-only.** Assigning to either namespace (including via two-way binding) throws an error. One known tolerance: assigning a value **identical to the current one** is silently ignored instead of throwing (the same-value guard short-circuits before the write defense; nothing is corrupted — the misuse diagnostic is just delayed until a differing write).
- `$streamError.<name>` is reset to `null` on every start and restart.
- On error, the **value property keeps the last folded value** — it is not reset. The reset to `initial` happens on the next (re)start.
- Names not declared in `$streams` read as `undefined` (no throw), same as the `$command` namespace convention.

They bind like any other path:

```html
<button data-wcs="disabled: $streamStatus.tokens|eq(active)">Ask</button>
<p data-wcs="class.error: $streamStatus.tokens|eq(error); textContent: $streamError.tokens"></p>
```

And they can be read from computed getters — use the **dotted bracket form**, which registers a dependency:

```javascript
get isStreaming() {
  return this["$streamStatus.tokens"] === "active";   // ✅ tracked — recomputes on status change
  // this.$streamStatus.tokens                        // ⚠️ reads the value but registers NO dependency
}
```

Observation guarantees:

- Intermediate statuses are not guaranteed to be observable. Transitions coalesced into one update batch (e.g. `active → done` within the same tick) may render only the final value — the same contract as every other binding update.
- `$updatedCallback` receives `<name>`, `$streamStatus.<name>`, and `$streamError.<name>` as ordinary update paths.

---

## Dependency-Driven Restart

Every path read inside `args` is captured as a dependency — automatically, the same way computed getters track theirs. When a captured dependency changes:

1. The current run is **aborted** (through the `AbortSignal` given to `source`).
2. The value property is **reset to `initial`**.
3. `args` is **re-evaluated** (dependencies are re-captured per run — conditional reads are followed correctly).
4. `source` is called with the new args value and a fresh signal.

This is **switchMap semantics**: the newest dependency state always wins, and stale runs are cancelled rather than raced.

```javascript
$streams: {
  tokens: {
    args:   (state) => state.prompt,     // ← writing state.prompt aborts the old run and starts a new one
    source: (prompt, signal) => llmStream(prompt, signal),
    fold:   (acc, chunk) => acc + chunk,
    initial: "",
  },
},
```

Details:

- **Coalescing** — multiple dependency writes within one tick trigger exactly **one** restart.
- **Status is irrelevant** — `done` and `error` streams also restart when a dependency is written. This is the retry story: there is no automatic reconnection; retrying = touching a dependency.
- **Computed dependencies work** — if `args` reads a getter, changes to the getter's own dependencies trigger the restart.
- **Stream chaining is legitimate** — stream B's `args` may read stream A's value, or `$streamStatus.A`. A's chunk arrivals (or status transitions) then restart B, chaining switchMaps naturally.
- **Canonical form for namespace reads in `args` / getters** is the dotted bracket form `state["$streamStatus.a"]`. The chained form `state.$streamStatus.a` returns the value but does **not** register a dependency — the chain breaks silently.
- **Self-dependency is an error** — `args` reading its own `<name>` / `$streamStatus.<name>` / `$streamError.<name>` raises (it would restart forever on its own writes).
- **Mutual cycles are MUST NOT** — A's `args` reading B's value while B's `args` reads A's value is an infinite restart loop. Unlike self-dependency, cycles are **not** detected at runtime; avoiding them is your responsibility.

---

## Rules and Footguns

### Bounded Fold (MUST)

Backpressure is abandoned: demand never flows back to the producer, so nothing slows an eager source down. On an infinite or long-lived stream, accumulating every raw chunk is an unbounded memory leak.

**Use a bounded fold** — latest, a count, a last-N window, a running aggregate:

```javascript
// ✅ last 100 entries — bounded
fold: (acc, line) => [...acc.slice(-99), line],

// ✅ running aggregate — bounded
fold: (acc, sample) => ({ count: acc.count + 1, max: Math.max(acc.max, sample) }),

// ❌ raw accumulation on an infinite stream — unbounded
fold: (acc, chunk) => [...acc, chunk],
```

Raw accumulation (like the LLM token example) is fine **only for finite streams**.

### Return a New Value (No In-Place Mutation)

`fold` must return a fresh value. Mutating `acc` in place defeats both the same-value guard and list diffing:

```javascript
// ❌ unsupported — same array reference, diffing and guards cannot see the change
fold: (acc, chunk) => { acc.push(chunk); return acc; },

// ✅ new array every time (and bounded, too)
fold: (acc, chunk) => [...acc.slice(-99), chunk],
```

### Chunk Reflection Granularity

- `fold` is applied to **every chunk, exactly once** — no chunk is skipped or duplicated.
- DOM reflection follows the updater's microtask batching. Chunks from an async iterator each arrive in their own microtask, so in practice **each chunk causes one drain** (one DOM flush, one `$updatedCallback`). The flush rate is bounded by the chunk arrival rate.
- With the latest fold, **same-value primitive chunks are skipped entirely** by the same-value guard: no binding update, no `$updatedCallback` entry.
- There is **no built-in throttling**. If your producer is too chatty for the DOM, thin it out at the producer, in the fold, or downstream with `wcs-debounce` / `wcs-throttle`.

---

## Lifecycle

```
(declared)──parse──▶ idle ──start(connect)──▶ active ──normal end──▶ done
                      ▲                        │  │
                      │                        │  └──throw/reject──▶ error
                      └──disconnect(abort)─────┤
                                               └──dependency change──▶ (abort → reset → restart) active
```

- **Eager start** — streams start when the `<wcs-state>` element connects, **after** `$connectedCallback` completes (so `args` can read values you initialized there). There is no lazy mode.
- **Disconnect** — all streams are aborted; status returns to `idle`. The declaration is kept.
- **Reconnect** — streams restart **from `initial`**. There is no "resume where it left off". Known limitation: if **another state element with the same name** was registered on the same root while this one was disconnected, reconnection fails with the same "already registered" error as a duplicate first connect (duplicate names on one root are an error condition to begin with).
- **Re-setting the state object** — old streams are aborted and their registry discarded; the new declaration is parsed and (if connected) started immediately. No double-starts.
- **SSR** — the declaration is parsed and value properties are materialized with `initial`, but streams **do not start**; server output shows `initial`. On an `enable-ssr` page the client side starts streams normally — a stream is a runtime side effect, not serializable state.

---

## Out of Scope (First Stage)

The following are explicitly not supported:

1. Wildcard or dotted paths as stream names, and wildcard reads inside `args` (both raise an error).
2. Async `fold`.
3. Observable (`subscribe`-style) sources — converting to an async iterable is up to you.
4. Automatic reconnection — retrying = re-touching a dependency.
5. Lazy start (a future `lazy: true` option is reserved, not implemented).
6. Per-binding / per-structural-block stream lifetimes — streams live and die with the `<wcs-state>` element's connection.
7. `$streams` inside DCC (`data-wc-definition`) definitions — the declaration is ignored there.
8. Backpressure preservation (a permanent non-goal, not a first-stage gap).

Known edge: if re-setting the state **removes** a stream declaration, bindings to its `$streamStatus.<name>` / `$streamError.<name>` are not notified of the removal and keep showing the last rendered value (subsequent reads resolve to `undefined`).

---

## Examples

### Accumulating LLM Tokens

A finite token stream, accumulated into a string. Editing the prompt aborts the in-flight response and starts a new one.

```javascript
export default {
  prompt: "",

  $streams: {
    answer: {
      args:    (state) => state.prompt,
      source:  (prompt, signal) => llmStream(prompt, signal),  // async generator honoring signal
      fold:    (acc, token) => acc + token,
      initial: "",
    },
  },

  get isStreaming() {
    return this["$streamStatus.answer"] === "active";
  },
};
```

```html
<input type="text" data-wcs="value: prompt">
<button data-wcs="disabled: isStreaming">Ask</button>
<pre data-wcs="textContent: answer"></pre>
<p data-wcs="textContent: $streamError.answer"></p>
```

### Latest-Value Ticker

An infinite price feed. The latest fold (the default) keeps exactly one value — bounded by construction. No `args`, so it starts once and runs until disconnect.

```javascript
export default {
  $streams: {
    price: {
      source: (_args, signal) => priceStream(signal),  // infinite; latest fold keeps it bounded
    },
  },
};
```

```html
<span data-wcs="textContent: price"></span>
<span data-wcs="textContent: $streamStatus.price"></span>
```

### Streaming a Fetch Response Body

`response.body` is a `ReadableStream`; piping it through `TextDecoderStream` yields text chunks. Passing the `signal` to `fetch` makes cancellation cooperative — changing `url` aborts the request mid-body and starts a new one.

```javascript
export default {
  url: "/api/report",

  $streams: {
    body: {
      args: (state) => state.url,
      source: async (url, signal) => {
        const res = await fetch(url, { signal });
        return res.body.pipeThrough(new TextDecoderStream());
      },
      fold:    (acc, text) => acc + text,
      initial: "",
    },
  },
};
```

```html
<pre data-wcs="textContent: body"></pre>
<p data-wcs="textContent: $streamStatus.body"></p>
```

---

## Summary

| Concept | Description |
|---|---|
| `$streams` | Declaration map: async producer → fold → reactive property |
| `source(args, signal)` | Returns the producer. MUST honor the `AbortSignal` |
| `args(state)` | Synchronous dependency capture; its reads drive restart |
| `fold(acc, chunk)` | Synchronous, returns a new value. Default: latest |
| `initial` | Seed; the value resets to it on every (re)start |
| `$streamStatus.<name>` | `idle` / `active` / `done` / `error` — read-only |
| `$streamError.<name>` | Last error or `null`; reset to `null` on (re)start |
| Restart | Dependency change → abort → reset to `initial` → new run (switchMap) |
| Bounded fold | MUST on infinite streams — backpressure is not preserved |
| Lifecycle | Eager start after `$connectedCallback`; abort on disconnect; `initial` on reconnect; no start in SSR |
