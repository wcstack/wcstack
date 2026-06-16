# Changelog

All notable changes to `@wcstack/signals` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

See [Stability](./README.md#stability) for which APIs are stable vs. evolving / experimental.

## [Unreleased]

### Added

- **`DisposedError` / `isDisposedError`** are now public. Every mutating `BoundNode` method throws a `DisposedError` after `dispose()`; prefer the brand-based `isDisposedError(err)` over `instanceof` (it survives a bundler duplicating the class across realms).
- **`ListView` and `NodeShape` (plus `DefaultNodeShape`)** are now exported, so `For` / `Index` return types and `bindNode` shapes can be referenced in user code.
- **Generic typing for `bindNode<S extends NodeShape>`.** Pass a `NodeShape` type argument (`signals` / `inputs` / `commands`) to type the whole result — `bound.signals.*`, `set`, `command`, etc. become checked. Omit it for the back-compat all-`unknown` shape.
- **`createSignalsElement()`** — builds the (memoized) `SignalsElement` base on call, resolving `HTMLElement` at that point and throwing a clear error if there is no DOM. The SSR-safe way to obtain the base.
- **Opt-in development mode** (`globalThis.__WCS_DEV__ = true`). Emits deduped `console.warn` diagnostics for silent failure modes (duplicate / non-primitive / nullish `For` keys, unowned effects / inserts, orphan cleanups, reactive cycles). Off by default, tree-shakeable, zero production cost.
- **`streamResource` cooperative-cancellation rescue.** On abort, a plain `AsyncIterable` / async generator source now has its iterator's `return()` called so `finally` / cleanup fires. (A producer that parks forever while ignoring its `AbortSignal` still cannot be force-unwound — see Notes & limitations.)
- **Benchmark harness** — `__benchmarks__/signals.bench.ts`, run via `npm run bench`.
- **Type-check gate** — `tsconfig.test.json` + `npm run typecheck` (`tsc --noEmit`) to catch type regressions in tests.
- **`"sideEffects": false`** in `package.json`, so a bundler can tree-shake anything you don't import (including development mode).

### Changed

- **`For` reorder now uses a LIS-based minimal-move strategy.** Output DOM is unchanged; reordering performs the fewest possible row moves (better performance on large keyed lists).
- **`insertReactive` single-text fast-path.** A reactive child that resolves to a single text node is now updated in place instead of being removed and re-inserted.
- **`isSettableProperty` is memoized** by `(prototype, key)` (a `WeakMap` keyed by prototype), avoiding a repeated prototype-chain walk on every `bindProp` / `setProp`.
- **`flushEffects` uses double buffering** for the effect queue.

### BREAKING

- **`bindNode(target)` — `target` type narrowed from `EventTarget & Record<string, any>` to `EventTarget`.** Untyped member pass-through is no longer available on the public signature (the indexing surface is cast internally), so it no longer erases your element's type.
  - **Migration:** type the result with `bindNode<Shape>(...)` for a checked surface, or omit the type argument for a near-identical back-compat shape where values are `unknown`. Runtime behaviour is unchanged.
- **`SignalsElement` is now a lazy Proxy alias instead of a concrete class.** `HTMLElement` is resolved on first subclass / use, so importing `@wcstack/signals/dom` no longer throws `ReferenceError: HTMLElement is not defined` in SSR / non-DOM contexts. `extends SignalsElement` and `instanceof` are unchanged.
  - **Migration:** if you need the concrete base class value (rather than extending it), call `createSignalsElement()` to build it explicitly (it throws a clear error if there is no DOM).

### Docs

- README gained sections for **browser & runtime support** (ES2022; Chrome / Edge 94+, Firefox 90+, Safari 16.4+), **bundle size** (core ≈ 2.5 KB, dom ≈ 2.1 KB gzipped), the **error-handling contract**, **development mode**, and a **Stability** matrix + deprecation policy.
- Documented the `streamResource` `AsyncIterable` cooperative-cancellation contract ("the `source` MUST honor its `AbortSignal`").

[Unreleased]: https://github.com/wcstack/wcstack/compare/v1.13.1...HEAD
