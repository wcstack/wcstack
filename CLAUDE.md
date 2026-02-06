# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

ユーザーへの応答は常に日本語で行うこと。コード・コミットメッセージ・変数名などは英語のまま。

## Project Overview

**wcstack** (Web Components Stack) is a monorepo of three TypeScript packages for building Web Components-based SPAs. The design philosophy is standards-first (Custom Elements, Shadow DOM, ES Modules, Import Maps), zero-config, and buildless with zero runtime dependencies.

## Monorepo Structure

Each package lives under `packages/` and is independently built, tested, and published:

- **`@wcstack/autoloader`** — Automatically detects and dynamically imports undefined custom elements by scanning the DOM and Import Map entries with `@components/` prefixes. Uses MutationObserver for dynamically-added elements.
- **`@wcstack/router`** — Declarative SPA routing via `<wcs-router>`, `<wcs-route>`, `<wcs-layout>` custom elements. Built on the Navigation API (popstate fallback). Supports typed path parameters (`:id(int)`, `:slug(slug)`, etc.), layout nesting, head management (`<wcs-head>`), and route guards.
- **`@wcstack/state`** — Reactive state management with declarative data binding via `<wcs-state>` and `data-bind-state` attributes. Features reactive proxy, computed properties, list rendering with diffing, conditional rendering, wildcard paths, and a filter pipeline.

## Build & Development Commands

All commands run from within a specific package directory (e.g., `packages/autoloader/`):

```bash
npm run build            # Clean dist, compile TypeScript, bundle with Rollup
npm run clean            # Remove dist/
npm test                 # Run tests once (vitest run)
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage (enforces thresholds)
npm run lint             # ESLint on src/
```

To run a single test file:
```bash
npx vitest run __tests__/someFile.test.ts
```

There is no root-level package.json or workspace orchestration — each package is managed independently.

## Build Pipeline

Each package follows the same build flow: `rimraf dist` → `tsc` → `rollup -c`

Rollup produces three outputs from `src/exports.ts`:
- `dist/index.esm.js` — ESM bundle
- `dist/index.esm.min.js` — Minified ESM bundle (via Terser)
- `dist/index.d.ts` — Bundled type declarations (via rollup-plugin-dts)

The autoloader and router also copy pre-built bootstrap scripts from `src/auto/` to `dist/`.

## Testing

- **Framework:** Vitest with happy-dom environment
- **Test location:** `__tests__/` directory in each package, pattern `*.{test,spec}.ts`
- **Setup file:** `__tests__/setup.ts` per package
- **Coverage thresholds:** 100% statements, 97% branches, 100% functions, 100% lines
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
- `State.ts` initializes state from inline JSON, `<script>` tags, or external files
- `proxy/` implements a reactive proxy that tracks property access and mutations
- `binding/` handles the binding lifecycle; `bindings/` has specific handlers (value, text, html, class, style, attribute, etc.)
- `structural/` manages `<template>` conditional and list rendering
- `list/` provides array diffing for efficient DOM updates
- `filters/` provides value transformation pipeline
- Binding syntax: `[property][#modifier]: [path][@state][|(filter | filter(args))...]`

## Module System

All packages use `"type": "module"` (ESM only). No CommonJS support.
