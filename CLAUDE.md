# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

ユーザーへの応答は常に日本語で行うこと。コード・コミットメッセージ・変数名などは英語のまま。

## Project Overview

**wcstack** (Web Components Stack) is a monorepo of focused TypeScript packages for building Web Components-based SPAs. The design philosophy is standards-first (Custom Elements, Shadow DOM, ES Modules, Import Maps), zero-config, buildless, with zero runtime dependencies. Each package is a self-contained custom element (or core utility) that can be dropped onto a page via CDN/Import Map and composed like LEGO bricks.

## Monorepo Structure

Each package lives under `packages/` and is independently built, tested, versioned, and published. There is no root-level `package.json` or workspace orchestration — every package is managed on its own. All published packages currently share the same version (kept aligned on release).

**Core / framework packages:**
- **`@wcstack/state`** (`<wcs-state>`) — Reactive state management with declarative data binding via `data-wcs` attributes. Reactive proxy, computed properties, list rendering with diffing, conditional rendering, wildcard paths, filter pipeline.
- **`@wcstack/router`** (`<wcs-router>`, `<wcs-route>`, `<wcs-layout>`) — Declarative SPA routing on the Navigation API (popstate fallback). Typed path params (`:id(int)`, `:slug(slug)`), nested layouts, head management (`<wcs-head>`), route guards, basename support.
- **`@wcstack/autoloader`** — Auto-detects and dynamically imports undefined custom elements by scanning the DOM and Import Map entries with `@components/` prefixes. Uses MutationObserver for dynamically-added elements.
- **`@wcstack/signals`** — Signals-based lightweight reactive core (an alternative to `state`, not a replacement) with async-IO resource adapters and a `wc-bindable` → signal bridge.

**I/O node components** — declarative wrappers over a Web platform API, exposed via the `wc-bindable-protocol` so they interoperate with `state`/`signals`:
- **`@wcstack/fetch`** (`<wcs-fetch>`) — Async data fetching
- **`@wcstack/storage`** (`<wcs-storage>`) — localStorage / sessionStorage binding
- **`@wcstack/upload`** (`<wcs-upload>`) — File upload with progress
- **`@wcstack/websocket`** (`<wcs-ws>`) — Real-time WebSocket comms
- **`@wcstack/sse`** (`<wcs-sse>`) — Server-Sent Events (EventSource, one-way streaming)
- **`@wcstack/broadcast`** (`<wcs-broadcast>`) — Cross-tab messaging (BroadcastChannel)
- **`@wcstack/worker`** (`<wcs-worker>`) — Dedicated Web Worker primitive
- **`@wcstack/timer`** (`<wcs-timer>`) — Interval / timeout primitive
- **`@wcstack/raf`** (`<wcs-raf>`) — requestAnimationFrame frame-source primitive (first-class `dt`, `suspended` two-phase output)
- **`@wcstack/debounce`** (`<wcs-debounce>`, `<wcs-throttle>`) — Signal coalescing
- **`@wcstack/clipboard`** (`<wcs-clipboard>`) — Clipboard read / write
- **`@wcstack/geolocation`** (`<wcs-geo>`) — Geolocation API
- **`@wcstack/permission`** (`<wcs-permission>`) — Permissions API monitor
- **`@wcstack/notification`** (`<wcs-notify>`) — Desktop notifications (Service Worker support)
- **`@wcstack/intersection`** (`<wcs-intersect>`) — IntersectionObserver visibility
- **`@wcstack/resize`** (`<wcs-resize>`) — ResizeObserver element-size
- **`@wcstack/wakelock`** (`<wcs-wakelock>`) — Screen Wake Lock
- **`@wcstack/camera`** (`<wcs-camera>`, `<wcs-recorder>`) — Camera capture + media recording (binds live `MediaStream` handles directly to elements, never through serializable state)
- **`@wcstack/speech`** (`<wcs-speak>`, `<wcs-listen>`) — SpeechSynthesis (TTS) + SpeechRecognition (STT)
- **`@wcstack/defined`** (`<wcs-defined>`) — Custom-element readiness gate (`customElements.whenDefined` with timeout-based load-failure detection)
- **`@wcstack/fullscreen`** (`<wcs-fullscreen>`) — Fullscreen API
- **`@wcstack/picture-in-picture`** (`<wcs-pip>`) — Picture-in-Picture for video
- **`@wcstack/pointer-lock`** (`<wcs-pointer-lock>`) — Pointer Lock API
- **`@wcstack/screen-orientation`** (`<wcs-screen-orientation>`) — Screen Orientation monitor / lock
- **`@wcstack/idle`** (`<wcs-idle>`) — Idle Detection API
- **`@wcstack/network`** (`<wcs-network>`) — Network Information monitor
- **`@wcstack/share`** (`<wcs-share>`) — Web Share API
- **`@wcstack/contacts`** (`<wcs-contacts>`) — Contact Picker API
- **`@wcstack/credential`** (`<wcs-credential>`) — Credential Management API
- **`@wcstack/eyedropper`** (`<wcs-eyedropper>`) — EyeDropper color picker
- **`@wcstack/tilt`** (`<wcs-tilt>`) — Device Orientation (tilt) events
- **`@wcstack/accelerometer`** (`<wcs-accelerometer>`) — Accelerometer sensor
- **`@wcstack/gyroscope`** (`<wcs-gyroscope>`) — Gyroscope sensor
- **`@wcstack/magnetometer`** (`<wcs-magnetometer>`) — Magnetometer sensor
- **`@wcstack/ambient-light-sensor`** (`<wcs-ambient-light-sensor>`) — Ambient Light sensor

**Other packages:**
- **`@wcstack/server`** — Server-side rendering for wcstack components.
- **`packages/vscode-wcs`** (`wcstack-intellisense`) — VSCode extension providing TypeScript language features for `<wcs-state>` inline scripts in HTML. Versioned independently from the published npm packages.

## Build & Development Commands

All commands run from within a specific package directory (e.g., `packages/state/`):

```bash
npm run build            # Clean dist, compile TypeScript, bundle with Rollup
npm run clean            # Remove dist/ (where defined)
npm test                 # Run tests once (vitest run)
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage (enforces thresholds)
npm run lint             # ESLint on src/
```

To run a single test file:
```bash
npx vitest run __tests__/someFile.test.ts
```

## Build Pipeline

Each package follows the same build flow: `rimraf dist .tsc-out` → `tsc` → `rollup -c`

Rollup produces three outputs from `src/exports.ts`:
- `dist/index.esm.js` — ESM bundle
- `dist/index.esm.min.js` — Minified ESM bundle (via Terser)
- `dist/index.d.ts` — Bundled type declarations (via rollup-plugin-dts)

Most packages also ship a pre-built bootstrap pair (`src/auto/auto.js` and `auto.min.js`) that a Rollup `copy-auto` plugin copies into `dist/` during the build. These let a page activate the component with a single `<script>` tag (no manual registration).

## Testing

- **Framework:** Vitest with happy-dom environment
- **Test location:** `__tests__/` directory in each package, pattern `*.{test,spec}.ts`
- **Setup file:** `__tests__/setup.ts` per package
- **Coverage thresholds:** roughly 100% statements / functions / lines and ~97%+ branches (each package configures its own; treat 100/97/100/100 as the baseline target)
- Test descriptions are written in Japanese

## Linting

ESLint flat config format. Notable rules:
- `no-explicit-any` and `no-this-alias` are off
- Unused vars prefixed with `_` are allowed
- Test files have relaxed rules
- `src/auto/` directories are excluded

## TypeScript Configuration

Root `tsconfig.json` sets ESNext target/module with bundler module resolution, strict mode, and DOM lib types. Each package extends this and sets its own `outDir`/`rootDir`.

## Architecture Notes

### Core interop protocols

These protocols are how `state`/`signals` talk to I/O node components, and how custom tags bind to one another. They are the heart of the project — read the per-package `README.md` and `docs/` before changing them.

- **`wc-bindable-protocol`** — A component declares its bindable surface with `static wcBindable`, exposing `properties` (two-way bindable), `event`, and `getter`. This lets `data-wcs` (and signals' `bindNode`) wire DOM elements together without per-element glue. I/O node components implement this so they interoperate with `state`.
- **`command-token` protocol** — `state → element` imperative command invocation: `$commandTokens` / `$command.<name>` / `command.<method>:`. Positional arguments are passed through verbatim (`Token.emit` → `Reflect.apply`); the runtime does not `await` them.
- **`event-token` protocol** — the dual of command-token: `element → state` event dispatch. `$eventTokens` / `eventToken.<prop>: <name>` / `$on`. Keys are `wcBindable` property names.

### Component package layout (I/O node pattern)

Each I/O node component splits into two layers:
- **Core** (`XxxCore.ts`, often under `core/`) — framework-agnostic logic over the platform API. Holds state, exposes `commands`, emits events. Testable without the DOM custom element.
- **Shell** (`WcsXxx.ts` / `WcsXxxShell.ts`, often under `shell/`) — the actual custom element (`HTMLElement` subclass) that wraps Core, handles attributes/lifecycle, and declares `static wcBindable`. The Shell class is exported so adopters can subclass it.

`exports.ts` is the Rollup entry; `src/auto/` holds the single-tag bootstrap.

### Autoloader Flow
1. Parses the page's Import Map for `@components/` namespace entries
2. Scans the DOM using TreeWalker for undefined custom elements
3. Resolves tag names to module URLs via namespace matching
4. Dynamically imports and registers components
5. Observes DOM via MutationObserver for elements added after initial scan

### Router Architecture
- `Router.ts` orchestrates navigation, matching routes, and rendering
- `Route.ts` matches URL patterns and manages route visibility
- `Layout.ts` / `LayoutOutlet.ts` handle nested layout templates
- `Navigation.ts` wraps the Navigation API with popstate fallback
- Route priority: static paths > parameterized > catch-all (`*`)
- Supports basename for sub-directory deployment

### State Reactive System
- `defineState.ts` / `bootstrapState.ts` initialize state from inline JSON, `<script>` tags, or external files
- `proxy/` implements a reactive proxy that tracks property access and mutations
- `binding/` handles the binding lifecycle; `bindings/` has specific handlers (value, text, html, class, style, attribute, etc.)
- `structural/` manages `<template>` conditional and list rendering
- `list/` provides array diffing for efficient DOM updates
- `filters/` provides the value transformation pipeline
- `command/`, `event/`, `token/`, `protocol/` implement the command-token / event-token / wc-bindable interop
- Binding syntax: `[property][#modifier]: [path][@state][|(filter | filter(args))...]`

## Examples

- Root `examples/` holds cross-package demo apps only (e.g. `state-camera-record-upload`, `state-notification-chat`, `state-cross-tab-todo`, `ssr`) plus `websocket-chat/` — one chat scenario implemented in five stacks (vanilla / state / signals / React / Vue) on one shared WebSocket server. See `examples/README.md` for the full list and ports.
- `examples/shared/server.js` is the shared static-file + JSON API core; each demo's `server.js` is a thin file declaring only its own routes. `websocket-chat/shared/` keeps its own self-contained server (needs the `ws` dependency).
- Single-package demos live in that package's own `examples/` (e.g. `fetch` has `pagination` / `users-crud` / `infinite-scroll`, `speech` has `speech-echo` / `speak-highlight`, `defined` has `defined-loader`, `state` has its basics).
- All state-based demos load packages via CDN one-liners (`https://esm.run/@wcstack/<pkg>/auto`); signals demos import from the single `@wcstack/signals/dom` CDN entry (mixing `.`/`.dom` entries on one CDN page duplicates the reactive core).

## Docs & Design Notes

`docs/` contains design documents, implementation plans, and spec proposals (e.g. tag-design notes, `signals-migration-plan.md`, `spec-proposal-*.md`, `timing-and-firing-contract.md`, `async-io-node-guidelines.md`). Consult the relevant doc before extending a component's behavior or its protocol. Per-package `README.md`/`README.ja.md` are the normative references for that package.

## Module System

All packages use `"type": "module"` (ESM only). No CommonJS support.
