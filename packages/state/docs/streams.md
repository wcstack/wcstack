# `$stream` — Folding Async Producers into Reactive Properties

## What Is This?

Take a look at the following state definition.

```javascript
export default {
  prompt: "",

  $stream: {
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

`$stream` is a declaration map on the state object — the same family as `$commandTokens`, `$eventTokens`, and `$on`. Each entry connects an **async producer** (an async iterable, an async generator, or a `ReadableStream`) to a single **reactive property**. Every chunk the producer yields is passed through `fold`, and the folded result becomes the new value of `state.tokens` — flowing through the ordinary update cycle, so bindings, computed getters, `$watch` and `$renderedCallback` all react to it like any other property.

`$stream` is part of the `temporal` add-on, together with `$watch`. `@wcstack/state` and `/auto` include it; a page on `/core` installs `@wcstack/state/features/temporal`, and a state that declares `$stream` without it fails with `[wcs/feature-not-installed]`. See the README's [Streams](../README.md#streams-stream) section for the overview and [Choosing a Time Mechanism](../README.md#choosing-a-time-mechanism) for when to use `$stream`, `$watch` or a path getter.

Two things `$stream` is deliberately **not**:

- It is **not a general streams pipeline**. There are no operators, no tees, no transforms — just "consume, fold, assign".
- It does **not preserve backpressure**. Demand never flows back to the producer. This is an explicit non-goal, and it has one important consequence: [your fold must be bounded](#bounded-fold-must).

---

## Declaration Reference

### The `$stream` Map

Each key of `$stream` is a flat property name; each value is a stream definition.

```javascript
export default {
  $stream: {
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
| `source` | `(args, signal) => AsyncIterable \| ReadableStream \| Promise<same>` | ✔ | **MUST honor the `AbortSignal`** (cooperative cancellation). Restart and disposal are driven through this signal — a source that ignores it cannot be reliably cancelled. A `ReadableStream` satisfies this automatically: anything getReader-bearing is consumed via `getReader()` (even when natively async-iterable — the spec serializes `iterator.return()` behind a pending `next()`, so only `reader.cancel()` can force-unwind a parked read), and on abort the runtime cancels the reader, which runs the stream's `cancel()` callback. For any other async iterable the runtime calls the iterator's `return()` on abort; a generator parked in an `await` that ignores `signal` cannot be unwound from outside. May return a `Promise` of the producer. Any other return value is a `TypeError`, surfaced through the error state. |
| `args` | `(state) => any` | — | **Synchronous, pure function.** Receives a read-only view of the state; every path read here is captured as a dependency (see [Dependency-Driven Restart](#dependency-driven-restart)). Omitted = no dependencies — the stream starts once and never restarts. The return value is passed verbatim as `source`'s first argument (bundle multiple values in an object or array). Returning a `Promise` is an error. |
| `fold` | `(acc, chunk) => next` | — | **Synchronous function.** Omitted = latest (each chunk replaces the value). **Must return a new value** — in-place mutation of `acc` is unsupported (see [Return a New Value](#return-a-new-value-no-in-place-mutation)). A throwing fold puts the stream into the error state and aborts the producer. |
| `initial` | any | ✔ when `fold` is given | Seed value. The property is reset to `initial` on every start and restart. |

### Validation

Violations of the declaration are raised when the state is taken in: on the first load the `<wcs-state>` fails to initialize (the error is reported with `console.error` and `connectedCallbackPromise` rejects with it), and a re-set with `setInitialState()` throws and keeps the old state:

- `$stream` must be an object mapping stream names to definitions.
- Each entry name must be a **flat property name**: non-empty, no `.`, no `*`, and must not start with `$` (reserved namespace).
- Entry names must not be property names inherited from `Object.prototype` (`__proto__`, `constructor`, `toString`, `hasOwnProperty`, …). Such names break the runtime's own-property assumptions (`__proto__` would even rewrite the state's prototype on start). Note that a literal `__proto__:` key in an object literal is prototype-setting syntax — it never becomes an own key, so such an entry is silently ignored rather than rejected.
- Entry names must not collide with a getter or setter declared on the state.
- Entry names must not collide with a **method** — a function-valued property, own or inherited from the state's prototype chain (the check reads property descriptors, so a getter is never evaluated). Without it the method would be silently overwritten by the start-time reset to `initial`, and the failure would surface far from the declaration, as `not a function` inside some getter, `$watch` or command. The check reads the state object as it is: a function-valued `initial`, or a `fold` that returns functions, works, but re-setting the **same** object after the runtime has written a function into that property raises the collision — re-set with a fresh object.
- Each entry must be an object (`{ args?, source, fold?, initial? }`).
- `source` must be a function. `fold`, if present, must be a function. `fold` without `initial` is an error (reduce needs a seed value).
- `args`, if present, must be a function.
- The 3.x name `$streams` is removed: declaring it throws `[wcs/declaration-alias] $streams was removed: write $stream.` (`#1601`) where the `diagnostics` add-on is installed (`@wcstack/state`, `/auto`); without it the declaration is ignored.

Violations detected when `args` is evaluated (at start / restart):

- `args` returned a `Promise` (the synchronous contract).
- `args` read the stream itself — `<name>`, `$streamStatus.<name>`, or `$streamError.<name>` (a self-dependency would restart the stream on its own writes).
- `args` read a wildcard path (including via `$getAll`) — wildcard dependencies are out of scope for now.

How a violation (or any exception `args` throws) surfaces depends on the path:

- **Eager start** (on connect, or re-setting the state while connected) — the error is thrown as is (loud fail): on connect it is reported like an exception in `$connectedCallback` (`… $connectedCallback failed.`, and `connectedCallbackPromise` rejects with it), and on a re-set `setInitialState()` throws it.
- **Dependency-driven restart** — nothing is thrown: the error is normalized into `$streamStatus.<name> = "error"` / `$streamError.<name>`, and restarts of other entries continue. The dependencies captured by the last successful run are kept, so writing to one of them retries the stream and can recover it.

### The Value Property

When the declaration is read, if `state[name]` is undefined it is materialized as an ordinary data property holding `initial` (or `undefined` when there is no fold). This means the initial render — and SSR output — shows `initial` even before the stream starts.

You may pre-declare the property yourself (useful for typing with `defineState`), but the value is **overwritten with `initial` when the stream starts**. Once started, the property is owned by the stream runtime: assigning to it from user code is not blocked, but the behavior is undefined — the next fold simply folds on top of whatever you wrote.

The reset to `initial` on every start and restart is an ordinary write: bindings and a `$watch` on the value see it when it changes the value (always, when `initial` is an object or array).

To keep an accumulation across restarts, keep it as an ordinary key and write it from a `$watch` handler on the stream's value path; a reset is a `$watch` handler that writes the initial value back. The stream's own value still resets to `initial` on every restart.

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
| `error` | The run failed (source threw or rejected, fold threw, the producer was not iterable, or `args` failed on a restart) |

Semantics:

- **Read-only.** Assigning to either namespace (including via two-way binding) throws `"$streamStatus.<name>" is read-only (the stream runtime owns it).` — also when the assigned value equals the current one: the read-only check runs before the same-value guard.
- `$streamError.<name>` is reset to `null` on every start and restart.
- On error, the **value property keeps the last folded value** — it is not reset. The reset to `initial` happens on the next (re)start.
- Names not declared in `$stream` read as `undefined` (no throw), same as the `$command` namespace convention.

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
- Stream values and companion paths participate in ordinary binding updates as `<name>`, `$streamStatus.<name>`, and `$streamError.<name>`.
- `$renderedCallback` is **binding-driven**: its `paths` list contains paths whose live DOM bindings were actually applied in that drain. Declaring a `$stream` entry does not by itself subscribe `$renderedCallback` to its value or companions.
- To react to a stream without rendering it, declare `$watch` on its value path. `$watch` is the state-only (headless) subscription and fires whether or not the path is bound. Its `prev` follows the `$watch` rule: the value before the batch when the stream writes a primitive, `undefined` when it writes an object (a fold that builds an array). The reserved companion namespaces (`$streamStatus.<name>` / `$streamError.<name>`) cannot be watched — a watch path may not start with `$`. If you need the completion *status*, bind it in the UI, read it in a getter, or fold the terminal condition into the value.

---

## Dependency-Driven Restart

Every path read inside `args` is captured as a dependency — automatically, the same way computed getters track theirs. When a captured dependency changes, the stream restarts at the end of that update batch, after the `$watch` handlers:

1. The current run is **aborted** (through the `AbortSignal` given to `source`).
2. The value property is **reset to `initial`**.
3. `args` is **re-evaluated** (dependencies are re-captured per run — conditional reads are followed correctly).
4. `source` is called with the new args value and a fresh signal.

This is **switchMap semantics**: the newest dependency state always wins, and stale runs are cancelled rather than raced. Once a run is aborted, nothing from it reaches the state any more: chunks it still yields, its completion and its error are all dropped, so the value, `$streamStatus` and `$streamError` belong to the new run.

```javascript
$stream: {
  tokens: {
    args:   (state) => state.prompt,     // ← writing state.prompt aborts the old run and starts a new one
    source: (prompt, signal) => llmStream(prompt, signal),
    fold:   (acc, chunk) => acc + chunk,
    initial: "",
  },
},
```

Details:

- **Coalescing** — multiple dependency writes within one update batch trigger exactly **one** restart.
- **Status is irrelevant** — `done` and `error` streams also restart when a dependency is written. This is the retry story: there is no automatic reconnection; retrying = touching a dependency.
- **Restart is change-driven** — a change that reaches `args` restarts the stream even if `args` then returns an equal value, but a write of an equal primitive is dropped by the same-value guard before it reaches anything. There is no occurrence-only restart command: "run again with the same arguments" must be represented by changing an additional dependency (for example, a generation counter), or by replacing the state declaration.
- **Computed dependencies work** — if `args` reads a getter, changes to the getter's own dependencies trigger the restart.
- **Stream chaining is legitimate** — stream B's `args` may read stream A's value, or `$streamStatus.A`. A's chunk arrivals (or status transitions) then restart B, chaining switchMaps naturally.
- **Canonical form for namespace reads in `args` / getters** is the dotted bracket form `state["$streamStatus.a"]`. The chained form `state.$streamStatus.a` returns the value but does **not** register a dependency — the chain breaks silently.
- **Self-dependency is an error** — `args` reading its own `<name>` / `$streamStatus.<name>` / `$streamError.<name>` is a violation (it would restart forever on its own writes); see [Validation](#validation) for how it surfaces on each path.
- **Restarts count toward the write-chain limit** — a restart's writes (the reset to `initial`, the status) continue the chain of the write that reached its `args`, the same chain `$watch` handlers extend. A restart more than 32 links deep is not made: the chain is cut and reported once with `console.error` (`$watch handlers / $stream restarts kept writing for 32 batches; the chain is cut (nothing is rolled back).`), and the next change of its inputs restarts it. What a run writes later in the task it started in — the values its source yields, its `done` / `error` status — continues the same chain, for the `$watch` handlers it fires too: a `$watch` on the stream's value that moves what `args` reads, with a source that yields at once (an async generator yielding from memory, a `ReadableStream` that enqueues in `start`), is cut after about 16 laps instead of freezing the page. From a later task, a value starts a chain afresh. See the README's [Watch](../README.md#watch-watch) section for the chain rules.
- **Mutual cycles are MUST NOT** — A's `args` reading B's value while B's `args` reads A's value is not refused at declaration. When the sources yield in the same task as their run's (re)start, the values count toward that run's chain and the limit above cuts the cycle; when they arrive in later tasks (a network response, a message, a timer), each lap starts afresh and the two streams restart each other forever. Avoiding them is your responsibility.

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
- DOM reflection follows the updater's microtask batching. Chunks from an async iterator each arrive in their own microtask, so in practice **each chunk causes one drain** (one DOM flush, one `$renderedCallback`). The flush rate is bounded by the chunk arrival rate.
- A folded value that is a primitive equal to the current value — with the latest fold, a repeated primitive chunk — is **skipped entirely** by the same-value guard: no binding update, no `$watch`, no `$renderedCallback` entry.
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
- **Reconnect** — streams restart **from `initial`**, after `$connectedCallback` runs again. There is no "resume where it left off".
- **Re-setting the state object** (`setInitialState()` on an initialized element) — old runs are aborted and stop without writing to the new state. The new declaration is read, every binding is re-applied to the new state (bindings to a stream the new declaration no longer has read `undefined`), and then, if connected, the new streams start. No double-starts.
- **SSR** — the declaration is read and value properties are materialized with `initial`, but streams **do not start**; server output shows `initial`. On an `enable-ssr` page the client side starts streams normally — a stream is a runtime side effect, not serializable state.

Where a `$stream` declaration runs:

- **A root `<wcs-state>`** — runs it, as above. Streams live and die with that element's connection.
- **A volume** (`<wcs-state mount="…">`) — refuses it: the volume is not grafted and `console.error` reports `$stream is not run in a volume — declare it on the root state.` Declare the stream on the root state.
- **A mounted component** (`bind-component` with `state: …`) — ignores it, with a one-time `wcs/mount-dollar-declaration` warning that points to the root state.
- **A DCC** — the definition's `<wcs-state>` (inside the `data-wc-definition` host) only defines the tag and runs nothing. Each instance's inner `<wcs-state>` is an ordinary root, so its streams start and stop independently per instance. A stream name is a member of the DCC class and may be listed in `$bindables`; each change of its value dispatches the change event.

---

## Out of Scope (First Stage)

The following are explicitly not supported:

1. Wildcard or dotted paths as stream names, and wildcard reads inside `args` (both raise an error).
2. Async `fold`.
3. Observable (`subscribe`-style) sources — converting to an async iterable is up to you.
4. Automatic reconnection — retrying = re-touching a dependency.
5. Lazy start (a future `lazy: true` option is reserved, not implemented).
6. Per-binding / per-structural-block stream lifetimes — streams live and die with the `<wcs-state>` element's connection.
7. Backpressure preservation (a permanent non-goal, not a first-stage gap).

---

## Examples

### Accumulating LLM Tokens

A finite token stream, accumulated into a string. Editing the prompt aborts the in-flight response and starts a new one.

```javascript
export default {
  prompt: "",

  $stream: {
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
  $stream: {
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

  $stream: {
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

For an event API (`EventSource`, `WebSocket`, DOM events), wrap it in a `ReadableStream` that enqueues in `start` and releases the resource in `cancel` — the README's [Streams](../README.md#streams-stream) section has the pattern.

---

## Summary

| Concept | Description |
|---|---|
| `$stream` | Declaration map: async producer → fold → reactive property (`temporal` add-on) |
| `source(args, signal)` | Returns the producer. MUST honor the `AbortSignal` |
| `args(state)` | Synchronous dependency capture; its reads drive restart |
| `fold(acc, chunk)` | Synchronous, returns a new value. Default: latest |
| `initial` | Seed; the value resets to it on every (re)start |
| `$streamStatus.<name>` | `idle` / `active` / `done` / `error` — read-only |
| `$streamError.<name>` | Last error or `null`; reset to `null` on (re)start |
| Restart | Dependency change → abort → reset to `initial` → new run (switchMap); an aborted run's chunks, end and error are dropped |
| Bounded fold | MUST on infinite streams — backpressure is not preserved |
| Lifecycle | Eager start after `$connectedCallback`; abort on disconnect; `initial` on reconnect; no start in SSR; root states only |
