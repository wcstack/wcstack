# WcStack IntelliSense

A VS Code extension for [@wcstack/state](https://github.com/wcstack/wcstack) 4.0. Provides TypeScript language features for `<wcs-state>` inline scripts, and completions / hover / navigation / diagnostics for `data-wcs` bindings in HTML.

> **@wcstack/state 4.0.** The bundled parser and manifest are 4.0's, and the checks follow the 4.0 rules: names 4.0 removed (the 3.2 old names, `$scan`, `substr`) are reported with their replacement, numeric index paths (`items.0.name`, `groups.0.items.1.v`) are not, and the 4.0 settings (`$behavior`, `$features`, `<wcs-state features>`) and the `#direct` modifier are understood. For a project still on 3.x, keep extension 1.21.x (1.21.0 bundles 3.5 and points out, as `wcs/v4-migration` hints, what 4.0 changes).

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

The wrapper's preamble knows the runtime API surface: `$getAll(path, indexes?)`, `$setAll`, `$resolve`, `$command.<name>`, `$streamStatus.<name>` / `$streamError.<name>`, and the contextual types of `$watch` handlers and `$listKeys` key functions (no false `noImplicitAny` errors). It types the 4.0 declarations `$behavior` (`enableMustache` / `sameValueGuard` / `enableDirectionalInitialSync`, booleans) and `$features` (add-on names), and has no member for the names 4.0 removed — `this.$trackDependency(…)` is a type error, as it is a runtime error.

### Attribute Binding Completions

Completions for property names, state paths, modifiers, and filter names in `data-wcs` attribute values.

- `data-wcs="` → `textContent`, `class.`, `style.`, `attr.`, `onclick`, `for`, `if`, `...`, `radio`, `checkbox`, `command.`, `eventToken.` ...
- `data-wcs="textContent: ` → `count`, `users`, `users.*.name` ...
- `data-wcs="textContent: count|` → `gt`, `eq`, `upper`, `trim` ... (all 47 built-in filters of 4.0)
- `data-wcs="value|` → write-back (input) filters such as `int`
- `data-wcs="onclick#` → `prevent`, `stop`, `ro`, `direct` (the modifier list is the same after any `#`; `ro` suppresses write-back on two-way bindings; `direct` attaches an `on*:` listener to the element itself instead of delegating it to the root — 4.0)
- `data-wcs="for: ` → only array-typed paths
- `data-wcs="onclick: ` → only methods and `$command.<name>`
- `data-wcs="command.play: ` → only `$command.<name>` (from the `$commandTokens` declaration)
- `data-wcs="eventToken.value: ` → only token names from the `$eventTokens` declaration

Path candidates are derived from the `<wcs-state>` script (and from JSON state): nested arrays are followed (`a.*.b.*.c`), `$stream` entries appear as values plus `$streamStatus.<name>` / `$streamError.<name>`, and `$listKeys` declarations materialize list paths whose initial value is an empty array (the list path, `.*`, `.length` and the key field — not the other row fields).

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

@wcstack/state 4.0 still binds comment bindings — even with `$behavior: { enableMustache: false }` — and they remain the recommended way to avoid FOUC outside a `<template>` on a page without SSR. Expressions may span lines in both forms. A comment inside `<textarea>` or `<title>` is text to the browser, so it is not a binding there (and is not validated as one); `{{ }}` inside them is a text node and is bound.

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

- **Hover** on a binding path shows its kind (data / computed / list / method / command token / event token), inferred type, owning state, and declaration line. `for`-shorthand paths show their expansion (`` `.name` → `users.*.name` ``). Hovering a filter name shows its signature, description, and type transform (`number → string`); hovering a modifier (`#prevent`, `#stop`, `#ro`, `#direct`, `#init=`, `#sync=`, `#on<event>`) explains its semantics. Hovering a filter name 4.0 removed (`uc`, `fix`, `substr`, …) names its replacement. Unresolvable paths get no hover (zero-false-hint policy) — except `src`-external states, which are explicitly labeled as externally defined.
- **Go to Definition** (F12) jumps from a path in `data-wcs` / `{{ }}` / `<!--@@:-->` to its declaration in the inline `<wcs-state>` script. Dotted paths fall back to their first segment; `$command.<name>` jumps to `$commandTokens`, `$streamStatus.*` / `$streamError.*` jump to `$stream`, event-token wirings jump to `$eventTokens`. Paths of a `src`-external state jump to the `<wcs-state src=…>` tag.
- **Find References** (Shift+F12) works in both directions: from a binding path to all its occurrences across every channel (shorthand occurrences are unified with their expanded form), and from a declaration name inside the state script to every binding that reads it (including subpaths). `$1`…`$9` are scoped to their `for` template, so unrelated loops are not merged.
- **Inlay hints** show the expanded path after a `for`-shorthand (`.name` `= users.*.name`) — the exact attribute rewrite the runtime performs — the result type at the end of a filter chain (`→ string`), and the expansion size of a spread (`...: target` → `→ 13 props`, built-in wcs-* tags only — user-defined tags cannot be statically expanded). Hints are omitted whenever the type cannot be statically determined.

Hover text follows `wcstack.messageLanguage` (default: the VS Code display language).

### Diagnostics

Real-time validation of `data-wcs` attributes, `{{ }}`, `<!--@@:-->`, the `<wcs-state>` script, and the page's wcstack `<script>` setup. Every finding carries a stable code (`wcs/…`); the code and range are identical in the editor and in the CLI, and messages are available in Japanese and English.

Severity policy: **error** = the runtime raises or the binding can never work; **warning** = it runs but silently does the wrong thing (the class of bug these checks exist for); **info** = advisory.

Deliberate exceptions — the 4.0 runtime throws at init, but the finding is a **warning**: `wcs/filter-unknown` (including the filters 4.0 removed and `substr`), because a page can register its own filters at runtime and the validator cannot see that; and `wcs/wildcard-rank` (a pattern path, a shorthand path or a loop index outside any `for`, #1401 / #1402; too few loop levels, #1401; or another list's `*`, #1403), because the `for` scope is reconstructed from the markup and is not exact in every shape. Run `wcs-validate --strict` to fail CI on them too.

The `outerHTML:` / `outerText:` check (#203) rebuilds the element nesting from the raw markup: it closes omitted end tags (`<li>…<li>`, `<p>…<div>`, table rows and cells) by looking at the element opened last only — an approximation of the HTML parser's scope rules — and honors `/>` only on void elements and inside `<svg>` / `<math>`. A `data-wcs` attribute without quotes is read for the enclosing templates and elements, but the bindings themselves are validated only in a quoted attribute.

#### Binding expressions (`data-wcs` / `{{ }}` / `<!--@@:-->`)

| Code | Detects | Severity |
|---|---|---|
| `wcs/binding-path-missing` | Path not found in the state (`textContent: typo`). Skipped when no path candidates can be derived. A numeric index path (`items.0.name`, `groups.0.items.1.v`, `groups.*.sel.0.id`) is looked up with its indexes read as `*` — 4.0 reads any number of indexes as the row at that position and follows writes, so the path itself is not a finding (warning). `$0`, `$01` or `$1000` — not a loop index (no `$1`…`$128` form), and the `$` namespace holds no state path: the runtime fails the binding with this code, inside a `for` or not (error, reported even without path candidates) | ⚠ / ❌ |
| `wcs/index-param-range` | `$129` (or up to `$999`) inside a `for` — a loop index past the limit; the runtime fails the binding with this code. The limit, `$128`, comes from the manifest (`syntax.indexParam.maxDepth`). Outside a `for` it is the loop-index-outside-`for` warning (`wcs/wildcard-rank`), since the runtime throws #1401 first. Also `this.$0` / `this.$129` / `this.$1000` in the `<wcs-state>` script (see below) | ❌ error |
| `wcs/path-nonexistent` | Same, but the state is declared in a sidecar `stateSchema`, so absence is definite | ❌ error |
| `wcs/path-type-mismatch` | `for:` on a path the `stateSchema` proves is not an array | ❌ error |
| `wcs/binding-type-expectation` | Non-array `for:` (error); non-boolean `if:` / `class.`, non-string `attr.` / `style.` (warning) | ❌ / ⚠ |
| `wcs/filter-unknown` | Unknown filter name (`count\|fake`) — as the 4.0 runtime reports it. This includes the filters 4.0 removed: the 3.2 old names (`uc` → `upper`, `fix` → `toFixed`, …; the message names the replacement) and `substr`, folded into `slice` — the message says to write `slice(start, start + length)` (with the literal result, `substr(2, 3)` → `slice(2, 5)`, when the arguments are non-negative literals) | ⚠ warning |
| `wcs/filter-arity` | Too few / too many filter arguments (`count\|mul`) | ❌ error |
| `wcs/filter-arg-type` | Filter argument type mismatch (`count\|gt(abc)`) | ⚠ warning |
| `wcs/filter-input-type` | Filter chain input type mismatch (`count\|upper`) | ⚠ warning |
| `wcs/token-undeclared` | `$command.<name>` / `eventToken.<prop>: <name>` not declared in `$commandTokens` / `$eventTokens` | ⚠ warning |
| `wcs/token-misconfigured` | `command.<method>:` right-hand side that is not a `$command.<name>` | ⚠ warning |
| `wcs/template-syntax` | Structural directive (`for` / `if` / `elseif` / `else`) combined with other bindings; spread with a filter or without a target; `outerHTML:` / `outerText:` inside a `for` / `if` template — a row or branch keeps its nodes by position, and 4.0 throws at init (#203) (error). A filter on an event handler (`onclick: fn\|gt(10)`); `#direct` on a binding that is not an `on*:` event binding (ignored) (warning). `{{ }}` outside a `<template>` (FOUC) and `<!--@@:-->` visualization (info) | ❌ / ⚠ / ℹ |
| `wcs/delegated-current-target` | An `on*:` binding of an event 4.0 delegates to the root (`click`, `dblclick`, `input`, `change`, `submit`, `keydown`, `keyup`, `mousedown`, `mouseup`, `pointerdown`, `pointerup`) whose handler, a method of the root state, reads `currentTarget` from its event parameter before its first `await` resumes (acorn): there it is the root, not the element. Write `on*#direct:` (keeping the other modifiers) or use `event.target.closest(…)`. Not reported for `#direct`, for `input` / `change` / `submit` on a custom element (it may dispatch them without bubbling, heard on the element), or inside a `<template>` with its own `<wcs-state>` (declarative shadow root, DCC); router route templates are checked | ⚠ warning |
| `wcs/binding-syntax` | What the runtime parser rejects since `@wcstack/state` 3.0 (error): an unterminated quote in filter arguments, a second `#` (`value#ro#wo` — write `value#ro,wo`), a value after `else:`, modifiers or left-side filters on `for` / `if` / `elseif` / `else` / `...`, an empty filter (`x|`, `x||y`), and (4.0, #120) a state path through `__proto__` / `prototype` (`a.__proto__.x` — not `$command.<name>`, an event token, or a method named alone, as at runtime). Judged by the canonical parser (`@wcstack/state/parser`), so lint and the runtime agree; quoted `;` / `|` in filter arguments are not separators |
| `wcs/wildcard-rank` | A pattern path `items.*.name`, a shorthand `.name` or a loop index `$1` outside `<template for>` (4.0 throws #1401 / #1402 at init — the code is the runtime's); more `*` ranks (or a higher `$N`) than the enclosing `for` nesting provides; or a `*` that ranges over a list other than the one the enclosing `for` renders at that level (`b.*.y` inside `for: a` — 4.0 throws, #1403; read another list's row in a getter with `$resolve(path, indexes)`) | ⚠ warning |
| `wcs/index-arity` | `$getAll` / `$setAll` / `$resolve` index count does not match the `*` count of the path | ⚠ warning |
| `wcs/aria-attr-unknown` | `attr.aria-*` name that does not exist in WAI-ARIA (with a "did you mean" suggestion) | ⚠ warning |

#### Built-in `wcs-*` tag contracts

| Code | Detects | Severity |
|---|---|---|
| `wcs/tag-member-unknown` | Binding to a property / `command.` / `eventToken.` key the tag does not declare in `wcBindable` — silently ignored at runtime | ⚠ warning |
| `wcs/on-prefixed-member` | A tag member whose name starts with `on` (`once` on `<wcs-timer>`), bound without the leading dot: the runtime makes it an event binding and the value never arrives. Write `.once:` (`@wcstack/state` 3.1) | ⚠ warning |
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
| `wcs/getter-untracked-read` | `this.form.name` inside a getter — only `form` is tracked, so the getter never re-runs when `form.name` changes; reported only when the document writes `form.name` somewhere (`value:` / `checked:` / spread / an I/O node output / `this["form.name"] = …`), so a root that is only ever replaced wholesale (router params, `$stream` folds) stays quiet. Read `this["form.name"]` instead | ⚠ warning |
| `wcs/updated-callback-unbound` | `$renderedCallback` tests a path that no binding reads — the branch never runs (the callback is binding-driven) | ⚠ warning |
| `wcs/name-alias` | A dependency API name that 3.2 renamed and 4.0 removed (`$trackDependency` → `$dependOn`, `$untrackDependency` → `$untracked`) — the runtime throws when it is read; the message suggests the canonical name | ❌ error |
| `wcs/declaration-alias` | A declaration key that 3.2 renamed and 4.0 removed (`$streams` → `$stream`, `$updatedCallback` → `$renderedCallback`) — the runtime throws at load time (a volume, `mount=`, is refused at graft instead and reported with `console.error`). Warning when the script cannot be parsed statically (a `class` state, found by a pattern) | ❌ / ⚠ |
| `wcs/declaration-alias-read` | *Reading* a removed declaration key (`this.$streams`) — 4.0's state has no such key, so the read is silently `undefined`. Warning when the AST proves the read; info when the script cannot be parsed statically | ⚠ / ℹ |
| `wcs/behavior-invalid` | `$behavior` (4.0) that the runtime rejects at load time: not an object, a key the manifest's `behaviorOptions` does not list (now `enableMustache` / `sameValueGuard` / `enableDirectionalInitialSync`; with a "did you mean"), a value of another type than the option's (all boolean now), or `$behavior` declared in a volume (`mount=`) | ❌ error |
| `wcs/feature-unknown` | A name in `$features` or in the root `<wcs-state features="…">` that is not an add-on (the manifest's `features`: `formats`, `diagnostics`, `temporal`, `list-keys`, `scopes`, `recursion`, `ssr`, `devtools`; with a "did you mean") — the runtime throws. A `$features` name fails as `wcs/feature-unknown` on a split `auto` page and as `wcs/feature-not-installed` elsewhere; the `features=` attribute is read only by the split `auto` (`dist/split/auto.js`), which fails with `wcs/feature-unknown` (other entries ignore the attribute) | ❌ error |
| `wcs/features-invalid` | `$features` that is not an array, or declared in a volume (error); `features=` on a `<wcs-state>` that is not the document's root — the runtime reads it only on the first `<wcs-state>` without `mount` and `bind-component` (warning) | ❌ / ⚠ |
| `wcs/index-param-range` | `this.$0` / `this.$129` / `this["$1000"]` in a getter, a method or a `$watch` handler — 4.0 throws when a `$` followed by a digit is read and is not `$1`…`$128`. Warning when the script cannot be parsed statically (a `class` state, found by a pattern) | ❌ / ⚠ |
| `wcs/watch-declaration-invalid` | `$watch` key the runtime rejects: `$`-prefixed, empty segment, non-function handler literal | ❌ error |
| `wcs/watch-path-missing` | `$watch` key that does not exist in the state — the handler silently never fires. (A volume's `$watch` is not checked: the volume is refused as a whole — `wcs/volume-declaration`.) | ⚠ warning |
| `wcs/scan-declaration-invalid` | `$scan` — removed in 4.0: the runtime throws at load time (in a mounted component too; a volume is refused at graft and reported with `console.error`). Fold a path's changes in a `$watch` handler, or events in an `$on` handler. One finding on the key; warning when the script cannot be parsed statically (a `class` state). (The 3.x checks of the entries, `wcs/scan-source-computed` and `wcs/scan-path-missing`, are gone with it.) | ❌ / ⚠ |
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

#### Volumes, component mounts and roots (4.0)

| Code | Detects | Severity |
|---|---|---|
| `wcs/volume-declaration` | A declaration a volume (`<wcs-state mount="…">`) does not take — the lists are 4.0's `scopes/volume.ts`. `$stream`, `$watch`, `$listKeys`, `$renderedCallback`: the runtime refuses to graft the volume and reports it with `console.error` — the state is not on the tree (error). `$commandTokens`, `$eventTokens`, `$on`, `$errorCallback`: the runtime says so with `console.warn` and ignores the declaration — they belong to the root (warning). One level lower when the script cannot be parsed statically (a `class` state). The other keys the runtime refuses in a volume keep their own codes (`$scan`, `$recursion`, `$behavior`, `$features`, the old names `$streams` / `$updatedCallback`). A value of literal `undefined` is no declaration, as at runtime | ❌ / ⚠ |
| `wcs/bind-component-source` | A `<wcs-state bind-component>` with a `state` / `src` / `json` attribute or an inline `<script type="module">`: a mounted component's state is the host element's property only, and the runtime refuses to load it (`console.error`; the component does not mount). Reported on the start tag; the script inside is not checked further, since the runtime never reads it | ❌ error |
| `wcs/second-root` | A second `<wcs-state>` without `mount` and `bind-component` in the document (outside `<template>`): there is one state tree per root, and the runtime refuses the one that loads second (`console.error`). Graft a subtree with `<wcs-state mount="path">`. Reported on each further start tag | ❌ error |

#### Sidecar manifest (`wcstack.manifest.json`)

All `wcs/manifest-*` and `wcs/drift-*` findings are errors, except `wcs/manifest-namespace-version` (warning) and `wcs/manifest-override` (info — an intentional, declared shadow). Codes: `manifest-broken`, `manifest-schema-version`, `manifest-kind-invalid`, `manifest-unknown-keyword`, `manifest-external-ref`, `manifest-ref-cycle`, `manifest-ref-unresolved`, `manifest-namespace-version`, `manifest-tag-collision`, `manifest-filter-collision`, `manifest-state-collision`, `manifest-override`, `drift-missing-member`, `drift-event-mismatch`.

Three further codes (`wcs/path-readonly`, `wcs/path-reserved-name`, `wcs/path-dynamic-unknown`) are reserved in the code table but not emitted yet. The single source of truth for codes is `src/core/diagnostics.ts`.

The codes are the runtime's: a message the 4.0 runtime prints in the console carries the same `[wcs/…]` code. Without the diagnostics add-on (`@wcstack/state/core` alone) the runtime prints the code, a message number and the values — `[@wcstack/state] [wcs/template-syntax] #203 "outerHTML"` — and the full `auto` bundle (which installs the add-on) prints the sentence. Some runtime codes depend on what only the running page knows and have no static counterpart: `wcs/feature-not-installed` (which entry and `installFeatures` the page uses), `wcs/recursion-context`, and the `wcs/template-syntax` #204 case (a structural template at the top of content inserted later). The `wcs/mount-dollar-declaration` warning (`$watch` / `$stream` / `$renderedCallback` on a mounted component) has none either: that state is the component's JavaScript property, which the validator does not read — a script inside `<wcs-state bind-component>` is never loaded (`wcs/bind-component-source`).

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
