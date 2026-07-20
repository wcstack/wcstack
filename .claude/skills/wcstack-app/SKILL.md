---
name: wcstack-app
description: Build web apps, SPAs, and demo pages with wcstack (@wcstack/state, router, signals, and the wcs-* I/O node components such as wcs-fetch / wcs-storage / wcs-ws). Follows the project's standards-first, zero-config, buildless principles — one-line CDN loading, then state design → data-wcs binding → I/O node wiring → routing, with exact syntax. Use when the user asks (in any language) to build something with wcstack, wcs-state, data-wcs, wcs-fetch or other wcs-* tags, or a signals-based app (e.g. "build an app with wcstack", 「wcstackでアプリを作って」「wcs-fetchで〜して」). Do NOT use for generic Web Components / Custom Elements questions unrelated to wcstack, for other frameworks (React / Vue / Lit / NoJS), or for developing or modifying the wcstack packages themselves.
metadata:
  wcstack-version: "1.21.6"
---

# Building apps with wcstack

## Overview

wcstack is a family of "standards-first, zero-config, buildless" Web Components packages. An app is correctly a **single HTML file + one-line CDN loads** — do not introduce bundlers, build steps, or npm install unless the user explicitly asks for them.

Content verified against **wcstack v1.21.6** (READMEs, examples, and source as of 2026-07). If the installed/CDN version is much newer, spot-check syntax against the package READMEs.

Generated-code accuracy lives in the exact syntax. **This file holds only the workflow, a cheat sheet, and the failure-mode matrix**; full syntax is split into references/ next to this file. Read the matching reference before entering each phase:

| File | Read before |
|---|---|
| `references/state-binding.md` | writing `<wcs-state>` / `data-wcs` / filters / command- & event-tokens |
| `references/router-and-scaffold.md` | writing SPA routing / autoloader / index.html scaffold / server |
| `references/io-node-catalog.md` | wiring I/O nodes (35 wcs-* tags) or writing a signals app |

## Workflow

### 1. Pick the stack (state vs signals)

- **`@wcstack/state` (default)** — UI and state connected through `data-wcs` path strings in HTML; no reactive primitives appear in JS. Forms, lists, CRUD, and general apps go here.
- **`@wcstack/signals`** — write `signal()` / `computed()` / `effect()` / `h()` directly in JS. Choose it when the user wants no DSL, logic-heavy code, or typed signals. It has no deep path tracking (that is state's job).
- The two **coexist** (not rivals), but pick one per app as a rule.

### 2. HTML scaffold (CDN loading rules)

```html
<!-- state family: one /auto line per package. I/O nodes BEFORE state -->
<script type="module" src="https://esm.run/@wcstack/fetch/auto"></script>
<script type="module" src="https://esm.run/@wcstack/router/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
```

- signals apps import **only from the single `@wcstack/signals/dom` entry** (mixing `.` and `.dom` on a CDN page duplicates the reactive core and breaks reactivity at the seam).
- An SPA **must have `<base href="/">` in `<head>`** (otherwise deep links break: basename gets misderived from the URL).

### 3. State design (state family)

State is a plain object `export default`. Computed values are getters keyed by dot-path strings (`get "cart.total"()`, wildcard `get "users.*.fullName"()`). Decide up front:

- One state slot per I/O node (`listFetch: { value: null, loading: false, error: null, status: 0 }`)
- `for:` requires an array — wrap nullable sources in a derived getter: `get rows() { return this["listFetch.value"] ?? []; }`
- Never seed convenient initial values into output-only element properties (the element is the authority; seed real initial values like `null` / `false`)

### 4. Bindings → I/O wiring → routing

Read the references, then write. Four wiring forms between state and I/O nodes:

1. Property binding: `data-wcs="value: users; loading: busy"`
2. Spread: `data-wcs="...: listFetch"` (all wcBindable properties + inputs; commands/events excluded)
3. Command-token (state → element): `data-wcs="command.fetch: $command.refresh"` + `$commandTokens`
4. Event-token (element → state): `data-wcs="eventToken.value: responded"` + `$eventTokens` + `$on`

Positive rules with no failure-mode row below: use `<wcs-link to="...">` instead of raw `<a>` (basename handling + `active` class); wire live handles (MediaStream etc.) element-to-element via `eventToken` → `$command.attachStream`, never through state; `trigger` is a momentary input property fired by writing `false`→`true`, not a command.

### 5. Server and verification

- A static single page needs no server (recommend a tiny server if it fetches).
- An SPA needs the fallback "every extensionless non-API GET returns index.html" (implementation in router-and-scaffold.md §7).
- After finishing, do a minimal run in a browser or via a tiny server. For working references, see `examples/` (multi-package demos) and `packages/*/examples/` (single-package demos) in the wcstack repo.

## Cheat sheet (most-used bindings)

```html
<div data-wcs="textContent: user.name"></div>            <!-- text -->
<input data-wcs="value: form.email">                     <!-- two-way -->
<input type="checkbox" data-wcs="checked: done">
<div data-wcs="class.active: isActive; style.color: color; attr.href: url"></div>
<button data-wcs="onclick: save; disabled: saving">Save</button>
<form data-wcs="onsubmit#prevent: submit">
<span>{{ count|locale }}</span>                          <!-- mustache text -->
<template data-wcs="if: items.length|gt(0)">...</template>
<template data-wcs="else:">...</template>                <!-- trailing colon required -->
<template data-wcs="for: items"><li data-wcs="textContent: .name"></li></template>
<wcs-fetch data-wcs="...: usersFetch"></wcs-fetch>                  <!-- spread -->
<wcs-fetch data-wcs="command.fetch: $command.reload"></wcs-fetch>   <!-- command-token -->
<my-el data-wcs="eventToken.value: responded"></my-el>              <!-- event-token -->
```

```javascript
export default {
  items: [],
  usersFetch: { value: null, loading: false, error: null, status: 0 },
  get rows() { return this["usersFetch.value"] ?? []; },       // for: needs an array
  get "items.*.label"() { return this["items.*.name"]; },      // wildcard computed
  add() { this.items = this.items.concat({ name: "new" }); },  // new array + path assignment
  $commandTokens: ["reload"],
  $eventTokens: ["responded"],
  $on: { responded(state, ev) { /* check ev.detail.status first */ } },
};
```

Full syntax (modifiers, 40 built-in filters, nested loops, `$getAll` / `$resolve`, spread rules): `references/state-binding.md`.

## Silent-failure matrix (these break without an error)

Self-review every generated app against this table:

| Mistake / combination | Symptom | Correct form |
|---|---|---|
| `this.user.name = v` (property mutation) | Not detected, DOM stale | Path assignment: `this["user.name"] = v` |
| `push` / `splice` / `sort` on arrays | Not detected | Reassign a new array: `toSpliced` / `concat` / `filter` / `toSorted` |
| `for:` bound to a null / non-array path | List breaks | Derived getter with `?? []` |
| Arguments on `onclick:` | Cannot pass arguments | Zero-arg wrapper method per variant |
| Bare name on command binding (`command.fetch: reload`) | Never fires | `$command.reload` (the `$command.` prefix is mandatory) |
| Raw DOM event name as `eventToken.` key | Never fires | Use the **wcBindable property name** |
| Expecting spread (`...:`) to wire commands/events | They stay unwired | Wire `command.` / `eventToken.` explicitly |
| Right-hand filter on spread (`...: slot\|f`) | Error | Filters go on individual property bindings |
| `data-wcs` inside router-stamped content | Bindings never collected (state scans the DOM at bind time) | Put bound templates under body-level `<template data-wcs="if: ...">`; routes hold `<wcs-head>` + static content only |
| SPA without `<base href="/">` | Deep links break (basename misderived) | Add `<base href="/">` to `<head>` |
| Assuming `wcs-fetch:response` means success | Fires on HTTP/network errors too | Check `event.detail.status` in `$on` |
| Storage slot seeded with `""` / `null` | Initial write-back clobbers the saved value | Seed the bound slot with `undefined` (load-before-bind) |
| Seeding truthy initials into output-only properties | Element authority overwrites them | Seed real initial values (`null` / `false`) |
| Writing `undefined` to an element input | Write is skipped silently (write-skip) | Assign `null` to clear |
| Missing trailing colon on `else` | Parse fails | `data-wcs="else:"` |
| Mixing `@wcstack/signals` and `@wcstack/signals/dom` on a CDN page | Two reactive cores, broken seams | Import everything from the single `/dom` entry |
| Custom filter registration | No such API exists | Compose the 40 built-in filters, or compute in a getter |

## Minimal template (starting point)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <script type="module" src="https://esm.run/@wcstack/state/auto"></script>
</head>
<body>
<wcs-state>
  <script type="module">
    export default {
      count: 0,
      countUp() { this.count++; }
    };
  </script>
</wcs-state>
<p>Count: {{ count }}</p>
<button data-wcs="onclick: countUp">+1</button>
</body>
</html>
```

For a full SPA with fetch wiring and layouts, start from the router-spa skeleton in `references/router-and-scaffold.md` §7.
