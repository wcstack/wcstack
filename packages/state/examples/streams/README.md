# `$streams` — fetch body streaming demo

[日本語版](./README.ja.md)

A demo of `$streams` in **`@wcstack/state`** — the core extension that folds an external async producer into a reactive property. It decodes a chunked HTTP response body (`response.body`) through `TextDecoderStream` and accumulates the text with `fold`.

## Getting Started

`$streams` is released, so this demo loads state from the CDN (`https://esm.run/@wcstack/state/auto`) like every other one. No build is needed — but the chunked streaming route (`/api/story`) cannot be served statically, so start the bundled server.js.

```bash
cd packages/state
node examples/streams/server.js    # port 3000 (override with the PORT env var)
```

Open http://localhost:3000/streams/ in a browser (`/` is the examples gallery).

## What to look at

- **Dependency-driven restart (switchMap)** — `args` reads the prompt `<input>` (two-way `value: prompt`), so every keystroke aborts the running producer through its AbortSignal, resets `story` to `initial`, and starts a new run with the fresh args.
- **Retry = poke a dependency** — there is no auto-reconnect. The **Regenerate** button only increments `seed`, i.e. it writes to a path `args` reads. The same action restarts the stream from `done` / `error`.
- **Companion namespaces** — the status chip binds `$streamStatus.story` directly in HTML; the JS getters read it in the dotted bracket form `this["$streamStatus.story"]` (the canonical, dependency-tracked spelling).
- **The last value survives an error** — put `error` in the prompt and the server drops the connection mid-stream. `$streamStatus.story` turns `error` and `$streamError.story` is filled, but **the text folded so far is not reset**.

## Notes

- **Cooperative cancellation contract** — `source` MUST honor the AbortSignal it is given. Here that is just handing it to `fetch(url, { signal })`, which tears the HTTP request down on restart or disconnect. server.js also stops emitting on client abort (`close`), so hammering restart does not pile work up on the server.
- **Bounded fold rule** — accumulating the whole text (`(acc, chunk) => acc + chunk`) is acceptable here **only because the stream is finite**. For infinite / long-lived streams use a bounded fold: latest, last-N, or a windowed aggregate.
- **Consuming a ReadableStream** — `source` may return an `AsyncIterable` / `ReadableStream` (or a Promise of either). A ReadableStream without `Symbol.asyncIterator` is consumed through the `getReader()` fallback.
- **fold returns a new value** — string concatenation produces a new value every time, so it satisfies that rule (no in-place mutation) naturally.

> See `docs/state-streams-design.md` at the repository root for the design, and `packages/state/src/stream/` for the implementation.
