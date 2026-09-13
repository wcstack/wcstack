# WcStack IntelliSense

A VS Code extension for [@wcstack/state](https://github.com/wcstack/wcstack) v2. Provides TypeScript language features for `<wcs-state>` inline scripts, and completions / hover / navigation / diagnostics for `data-wcs` bindings in HTML.

The same validator core is shipped headlessly as the `wcs-validate` CLI ([`@wcstack/lint`](https://www.npmjs.com/package/@wcstack/lint)), so the editor and CI report the same diagnostic codes on the same ranges.

## Features

### Inline Script Type Support

TypeScript completions work inside `<script type="module">` within `<wcs-state>`. No `import` or `defineState()` required — the script is wrapped for you.

```html
<wcs-state>
  <script type="module">
export default {
  count: 0,
  users: [{ name: "Alice", age: 30 }],

  increment() {
    this.count++;                 // number
    this["users.*.name"];         // string
    this["users.*.age"];          // number
    this.$getAll("users.*.age");  // number[]
  },

  get "users.*.ageCategory"() {
    return this["users.*.age"] < 25 ? "Young" : "Adult";
  }
};
  </script>
</wcs-state>
```

The wrapper's preamble knows the runtime API surface: `$getAll(path, indexes?)`, `$setAll`, `$resolve`, `$command.<name>`, `$streamStatus.<name>` / `$streamError.<name>`, and the contextual types of `$watch` handlers and `$listKeys` key functions (no false `noImplicitAny` errors).

### Attribute Binding Completions

Completions for property names, state paths, modifiers, and filter names in `data-wcs` attribute values.

- `data-wcs="` → `textContent`, `class.`, `style.`, `attr.`, `onclick`, `for`, `if`, `...`, `radio`, `checkbox`, `command.`, `eventToken.` ...
- `data-wcs="textContent: ` → `count`, `users`, `users.*.name` ...
- `data-wcs="textContent: count|` → `gt`, `eq`, `uc`, `trim` ... (all 46 built-in filters)
- `data-wcs="value|` → write-back (input) filters such as `int`
- `data-wcs="onclick#` → `prevent`, `stop`, `ro` (the modifier list is the same after any `#`; `ro` suppresses write-back on two-way bindings)
- `data-wcs="for: ` → only array-typed paths
- `data-wcs="onclick: ` → only methods and `$command.<name>`
- `data-wcs="command.play: ` → only `$command.<name>` (from the `$commandTokens` declaration)
- `data-wcs="eventToken.value: ` → only token names from the `$eventTokens` declaration

Path candidates are derived from the `<wcs-state>` script (and from JSON state): nested arrays are followed (`a.*.b.*.c`), `$streams` entries appear as values plus `$streamStatus.<name>` / `$streamError.<name>`, and `$listKeys` declarations materialize list paths whose initial value is an empty array (the list path, `.*`, `.length` and the key field — not the other row fields).

The **row shape** of a list that starts as `[]` is read from the row literals in the assignments that add or replace rows — `this.items = this.items.concat({ id, kind: "general" })`, `.toSpliced(i, n, { … })`, `.with(i, { … })`, and `[...this.items, { … }]` / `[{ … }, ...this.items]` — anywhere in the script (methods, getters, `$connectedCallback`, `$watch` handlers). Only a path already known to be an array gains fields this way, and an explicit initial value always wins. A `$listKeys` entry is the other way to say "this is a list": `$listKeys: { items: "id" }` alone makes the analyzer know `items`, `items.*`, `items.length`, and the key field `items.*.id` — nothing else about the row. A row passed as a variable (`concat(row)`) cannot be read — declare a `stateSchema` for that case.

#### for-context Completions

Inside `<template data-wcs="for: items">`, shorthand paths (`.name`, `.age`) are generated as completion candidates.

```html
<wcs-state>
  <script type="module">
export default {
  items: [{ name: "Alice", age: 30 }]
};
  </script>
</wcs-state>

<template data-wcs="for: items">
  <!-- .name, .age appear as candidates for data-wcs="textContent: " -->
  <span data-wcs="textContent: .name"></span>
</template>
```

Pattern paths (`items.*.name`) and shorthand paths (`.name`) are excluded from completions outside `<template for>`.

### Template Syntax Support

Completions and diagnostics also work in Mustache `{{ }}` and comment binding `<!--@@:-->` syntax. Both are parsed through the same text-channel parser as the runtime, so `{{ a; b }}` is one path, exactly as the runtime reads it.

```html
<!-- Mustache syntax — path and filter completions -->
<p>{{ count|gt(0) }}</p>

<!-- Comment binding syntax — no FOUC -->
<p><!--@@:count|gt(0)--></p>
<p><!--@@wcs-text:count--></p>
```

### wcs-* Tag Completions (HTML Custom Data)

The extension ships [`wcs.html-data.json`](./wcs.html-data.json) — [VS Code HTML custom
data](https://github.com/microsoft/vscode-custom-data) generated from every I/O
package's `static wcBindable` surface and `observedAttributes`
(`npm run emit:builtin-tags`; freshness against the committed bundles is CI-gated).
It provides, in any HTML file with no `<wcs-state>` required:

- Tag-name completion for all `wcs-*` elements (`<wcs-f` → `<wcs-fetch>`)
- Hover on a tag showing its contract — bindable properties, inputs, `command.*`
  names — with a link to the package README
- Attribute completion (observed attributes and input attribute mirrors)
- `data-wcs` declared as a global attribute with a binding-syntax summary

Other editors that use the standard HTML language service (and VS Code setups
without this extension) get the same completions by copying the file into the
project and referencing it from the `html.customData` setting:

```json
{ "html.customData": ["./wcs.html-data.json"] }
```

### Hover, Go to Definition, Find References, Inlay Hints

Binding paths are runtime identifiers written directly in HTML, so navigation works without source maps. All four features are queries over the same positional reference index that powers diagnostics.

- **Hover** on a binding path shows its kind (data / computed / list / method / command token / event token), inferred type, owning state, and declaration line. `for`-shorthand paths show their expansion (`` `.name` → `users.*.name` ``). Hovering a filter name shows its signature, description, and type transform (`number → string`); hovering a modifier (`#prevent`, `#stop`, `#ro`, `#init=`, `#sync=`, `#on<event>`) explains its semantics. Unresolvable paths get no hover (zero-false-hint policy) — except `src`-external states, which are explicitly labeled as externally defined.
- **Go to Definition** (F12) jumps from a path in `data-wcs` / `{{ }}` / `<!--@@:-->` to its declaration in the inline `<wcs-state>` script. Dotted paths fall back to their first segment; `$command.<name>` jumps to `$commandTokens`, `$streamStatus.*` / `$streamError.*` jump to `$streams`, event-token wirings jump to `$eventTokens`. Paths of a `src`-external state jump to the `<wcs-state src=…>` tag.
- **Find References** (Shift+F12) works in both directions: from a binding path to all its occurrences across every channel (shorthand occurrences are unified with their expanded form), and from a declaration name inside the state script to every binding that reads it (including subpaths). `$1`…`$9` are scoped to their `for` template, so unrelated loops are not merged.
- **Inlay hints** show the expanded path after a `for`-shorthand (`.name` `= users.*.name`) — the exact attribute rewrite the runtime performs — the result type at the end of a filter chain (`→ string`), and the expansion size of a spread (`...: target` → `→ 13 props`, built-in wcs-* tags only — user-defined tags cannot be statically expanded). Hints are omitted whenever the type cannot be statically determined.

Hover text follows `wcstack.messageLanguage` (default: the VS Code display language).

### Diagnostics

Real-time validation of `data-wcs` attributes, `{{ }}`, `<!--@@:-->`, the `<wcs-state>` script, and the page's wcstack `<script>` setup. Every finding carries a stable code (`wcs/…`); the code and range are identical in the editor and in the CLI, and messages are available in Japanese and English.

Severity policy: **error** = the runtime raises or the binding can never work; **warning** = it runs but silently does the wrong thing (the class of bug these checks exist for); **info** = advisory.

#### Binding expressions (`data-wcs` / `{{ }}` / `<!--@@:-->`)

| Code | Detects | Severity |
|---|---|---|
| `wcs/binding-path-missing` | Path not found in the state (`textContent: typo`). Skipped when no path candidates can be derived | ⚠ warning |
| `wcs/path-nonexistent` | Same, but the state is declared in a sidecar `stateSchema`, so absence is definite | ❌ error |
| `wcs/path-type-mismatch` | `for:` on a path the `stateSchema` proves is not an array | ❌ error |
| `wcs/binding-type-expectation` | Non-array `for:` (error); non-boolean `if:` / `class.`, non-string `attr.` / `style.` (warning) | ❌ / ⚠ |
| `wcs/filter-unknown` | Unknown filter name (`count\|fake`) | ⚠ warning |
| `wcs/filter-arity` | Too few / too many filter arguments (`count\|mul`) | ❌ error |
| `wcs/filter-arg-type` | Filter argument type mismatch (`count\|gt(abc)`) | ⚠ warning |
| `wcs/filter-input-type` | Filter chain input type mismatch (`count\|uc`) | ⚠ warning |
| `wcs/token-undeclared` | `$command.<name>` / `eventToken.<prop>: <name>` not declared in `$commandTokens` / `$eventTokens` | ⚠ warning |
| `wcs/token-misconfigured` | `command.<method>:` right-hand side that is not a `$command.<name>` | ⚠ warning |
| `wcs/template-syntax` | Structural directive (`for` / `if` / `elseif` / `else`) combined with other bindings; spread with a filter or without a target (error). Pattern path `items.*.name` or shorthand `.name` outside `<template for>`; numerically resolved path `items.0.name`; a filter on an event handler (`onclick: fn\|gt(10)`) (warning). `{{ }}` outside a `<template>` (FOUC) and `<!--@@:-->` visualization (info) | ❌ / ⚠ / ℹ |
| `wcs/wildcard-rank` | More `*` ranks (or a higher `$N`) than the enclosing `for` nesting provides | ⚠ warning |
| `wcs/index-arity` | `$getAll` / `$setAll` / `$resolve` index count does not match the `*` count of the path | ⚠ warning |
| `wcs/aria-attr-unknown` | `attr.aria-*` name that does not exist in WAI-ARIA (with a "did you mean" suggestion) | ⚠ warning |

#### Built-in `wcs-*` tag contracts

| Code | Detects | Severity |
|---|---|---|
| `wcs/tag-member-unknown` | Binding to a property / `command.` / `eventToken.` key the tag does not declare in `wcBindable` — silently ignored at runtime | ⚠ warning |
| `wcs/spread-no-bindable` | `...:` spread onto a helper tag without `wcBindable` (`wcs-fetch-header`, `wcs-fetch-body`, `wcs-infinite-scroll`, `wcs-voice`) — the runtime raises | ❌ error |
| `wcs/trigger-seeded-truthy` | A `trigger` slot seeded with `true` (fires immediately, no edge) | ⚠ warning |
| `wcs/storage-seed-clobber` | Non-manual `<wcs-storage>` value bound to an empty seed — the initial write-back overwrites the stored value | ⚠ warning |

#### `<wcs-state>` script

| Code | Detects | Severity |
|---|---|---|
| `wcs/nested-assign` | `this.user.name = x`, `+=`, `++`, expression-index chains — not reactive; use `this["user.name"] = x` | ❌ error |
| `wcs/array-mutation` | `push` / `splice` / `sort` … (9 destructive methods) — not reactive; the message names the non-destructive alternative (`concat`, `toSpliced`, `toSorted` …) | ❌ error |
| `wcs/array-index-assign` | `this.items[0] = x` (bracket-only chain, all compound forms) — use `this["items.0"] = x` or `with()` | ❌ error |
| `wcs/getter-cycle` | Path getters that reference each other in a cycle | ⚠ warning |
| `wcs/getter-untracked-read` | `this.form.name` inside a getter — only `form` is tracked, so the getter never re-runs when `form.name` changes; reported only when the document writes `form.name` somewhere (`value:` / `checked:` / spread / an I/O node output / `this["form.name"] = …`), so a root that is only ever replaced wholesale (router params, `$streams` folds) stays quiet. Read `this["form.name"]` instead | ⚠ warning |
| `wcs/updated-callback-unbound` | `$updatedCallback` tests a path that no binding reads — the branch never runs (the callback is binding-driven) | ⚠ warning |
| `wcs/watch-declaration-invalid` | `$watch` key the runtime rejects: `$`-prefixed, empty segment, non-function handler literal | ❌ error |
| `wcs/watch-path-missing` | `$watch` key that does not exist in the state — the handler silently never fires | ⚠ warning |
| `wcs/scan-declaration-invalid` | `$scan` entry the runtime rejects: non-flat or `Object.prototype` output name, output clashing with a getter, setter or `$streams` entry, neither or both of `from` / `on`, missing `initial` / `fold`, `on` token not in `$eventTokens`, malformed `from` / `resetOn` path, `from` reading its own output, `resetOn` with `*`, equal to `from` or under it, or reading a scan output | ❌ error |
| `wcs/scan-source-computed` | `$scan` `from` / `resetOn` that is a getter (or sits under one) — folding it would count re-evaluations, not events | ❌ error |
| `wcs/scan-path-missing` | `$scan` `from` / `resetOn` path that does not exist in the state — it silently never folds (or never resets) | ⚠ warning |
| `wcs/type-annotation` | JSDoc `@type` incompatible with the initial value (see below) | ⚠ warning |

`$listKeys` declarations are consumed rather than diagnosed: malformed keys (empty path, trailing `*`, non-flat field) simply produce no path candidates, so a broken declaration is never confirmed by the static side.

#### Page setup

| Code | Detects | Severity |
|---|---|---|
| `wcs/script-order` | Another wcstack `/auto` script loaded after `@wcstack/state/auto` | ⚠ warning |
| `wcs/base-href-missing` | `router/auto` present without `<base href>` (basename would be mis-derived) | ⚠ warning |
| `wcs/signals-dual-entry` | `@wcstack/signals` and `@wcstack/signals/dom` on the same page (duplicated reactive core) | ❌ error |

#### v2 migration

| Code | Detects | Severity |
|---|---|---|
| `wcs/named-state-deprecated` | Named states — `<wcs-state name="x">`, `path@x`, `{{ path@x }}` — removed in v2; the message points to `<wcs-state mount="x">` and the prefixed path `x.path` | ❌ error |
| `wcs/mount-path-invalid` | `mount=` value the runtime rejects: empty, empty segment, wildcard, or reserved characters `$` `#` `@` | ❌ error |

#### Sidecar manifest (`wcstack.manifest.json`)

All `wcs/manifest-*` and `wcs/drift-*` findings are errors, except `wcs/manifest-namespace-version` (warning) and `wcs/manifest-override` (info — an intentional, declared shadow). Codes: `manifest-broken`, `manifest-schema-version`, `manifest-kind-invalid`, `manifest-unknown-keyword`, `manifest-external-ref`, `manifest-ref-cycle`, `manifest-ref-unresolved`, `manifest-namespace-version`, `manifest-tag-collision`, `manifest-filter-collision`, `manifest-state-collision`, `manifest-override`, `drift-missing-member`, `drift-event-mismatch`.

Three further codes (`wcs/path-readonly`, `wcs/path-reserved-name`, `wcs/path-dynamic-unknown`) are reserved in the code table but not emitted yet. The single source of truth for codes is `src/core/diagnostics.ts`.

### JSDoc Type Validation

Validates consistency between `@type` annotations and initial values (`wcs/type-annotation`):

```javascript
/** @type {string} */
label: null,        // ⚠ Type "null" is not compatible with @type {string}

/** @type {string|null} */
label: null,        // ✅ OK
```

### Sidecar Manifest, `stateSchema`, and the CLI

**Sidecar manifests.** `wcstack.manifest.json` files are validated against the
supported JSON-Schema subset: envelope / `kind` checks, cross-file package
resolution, same-name tag/filter collision, forbidden override-after-collision, and
drift against the live `static wcBindable` surface. The sidecar is **tooling-only**:
it never overrides the runtime `static wcBindable` declaration, and a missing or stale
file never changes runtime behavior. The normative schema and resolution rules live in
[`docs/wcstack-manifest-schema.md`](../../docs/wcstack-manifest-schema.md).

**`stateSchema`.** An application manifest may declare the shape of a state
(`wcstack.application.states[<name>].stateSchema`). The nearest `wcstack.manifest.json`
above the HTML file is discovered automatically (one file, no merging). For a declared
state, a missing path is reported as `wcs/path-nonexistent` (error) instead of
`wcs/binding-path-missing` (warning), and `for:` on a schema-confirmed non-array is
`wcs/path-type-mismatch`. Methods, getters, and `$listKeys` from the script count as
existing even when absent from the schema; beneath a bare `{}` the validator stays silent.
Write the schema by hand, or generate it from a TypeScript state file with `wcs-schema`
from [`@wcstack/typescript`](https://www.npmjs.com/package/@wcstack/typescript) — see
[`docs/typescript.md`](../../docs/typescript.md). The same package's `wcs-tsc` type-checks
inline `<wcs-state>` scripts across a project using this extension's language plugin in
`tsc` mode.

**CLI.** A single `validateDocument` entry point drives both the in-editor diagnostics
and the CLI, so the IDE and CI report identically for the same inputs. One deliberate
asymmetry: external state referenced via `<wcs-state src="...">` is resolved only by
the CLI (relative to the HTML file) — the IDE analyzes the single HTML file and skips
`src`. The bundled **`wcs-validate`** CLI runs the same checks headlessly — over
`wcstack.manifest.json` sidecars (any `*.manifest.json` argument) and/or HTML
`data-wcs` bindings — and is distributed on npm as
[**`@wcstack/lint`**](https://www.npmjs.com/package/@wcstack/lint), a zero-dependency
wrapper around the exact same CLI bundle:

```bash
npx @wcstack/lint [--attr=data-wcs] [--state-tag=wcs-state] [--lang=ja|en] [--errors-only] [--strict] <file> [<file> ...]
```

| Option | Effect |
|---|---|
| `--attr=<name>` | Bind attribute name (default `data-wcs`) |
| `--state-tag=<name>` | State element tag name (default `wcs-state`) |
| `--lang=ja\|en` | Message language. Default: environment locale (`LC_ALL` / `LC_MESSAGES` / `LANG`, then the OS locale); codes and ranges do not depend on it |
| `--errors-only` (alias `--quiet`) | Print only error-severity lines; warning / info counts and the exit code are unchanged |
| `--strict` | Exit `1` on warnings too. Severities are unchanged — only the exit-code threshold moves. Use it to fail CI on a path typo (`wcs/binding-path-missing` is a warning) |

Exit code: `0` no error (with `--strict`: no error or warning) · `1` at least one error (with `--strict`: error or warning) · `2` usage or file-read failure.

When working on the validator itself, or in this repo's CI (the `wcs-validate` job runs it exactly this way), build from source and invoke the CLI with `node`:

```bash
# one-time build (from the repo root)
cd packages/vscode-wcs && npm ci && npm run build && cd ../..

node packages/vscode-wcs/dist/cli.cjs [--attr=data-wcs] [--state-tag=wcs-state] [--lang=ja|en] [--errors-only] [--strict] <file> [<file> ...]
```

## Settings

| Setting | Default | Description |
|---|---|---|
| `wcstack.bindAttributeName` | `"data-wcs"` | Bind attribute name |
| `wcstack.stateTagName` | `"wcs-state"` | Custom element tag name for state definition |
| `wcstack.messageLanguage` | `"auto"` | Language of diagnostic and hover messages: `auto` (VS Code display language; non-Japanese locales get English), `ja`, or `en`. Codes and ranges are language-independent |

## Requirements

- VS Code 1.110+
- HTML files containing `<wcs-state>` elements (tag completions and hover for `wcs-*` elements work in any HTML file)

## Reporting Issues

Use the [extension issue form](https://github.com/wcstack/wcstack/issues/new?template=vscode-wcs.yml) — it asks for the extension and VS Code versions and a minimal `<wcs-state>` reproduction, and files the report under the `@wcstack/vscode-wcs` label.

## License

MIT
