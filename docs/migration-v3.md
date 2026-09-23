# wcstack 2.x → 3.x migration guide

**日本語版**: [migration-v3.ja.md](./migration-v3.ja.md)

The changes in wcstack 3.0.0 are concentrated in `@wcstack/state`, and they have two themes. **Forms that 2.x silently rounded off are now rejected by name, or read as written.** And **the core is split from its features, so a page can take only the features it uses.** The other packages (router, the I/O nodes, the protocols) only move to the shared version; their behaviour does not change.

There is no compatibility layer. Instead, **2.6.x announces every form that 3.0 rejects or reads differently, as `wcs/v3-migration`** — it keeps running the form as 2.x did and names it once per form and site. The shortest path is to upgrade to 2.6.1, clear the warnings, then upgrade to 3.0 ([§2](#2-mechanical-steps)).

The default entries of `@wcstack/state` (`@wcstack/state` and `/auto`) still carry every feature, so a page that does not use the split entries loads the package exactly as before.

The design record is [state-next-major-requirements.md](./state-next-major-requirements.md) (decisions in §6); the per-release list is the root [CHANGELOG](../CHANGELOG.md).

## 1. The idea

The 2.x parser and value application had places that did something plausible instead of reporting an error.

```html
<input data-wcs="value#ro#wo: name">              <!-- drops everything after the second #, keeps ro -->
<span data-wcs="textContent: tags|join('; ')"></span> <!-- the ; inside the quotes splits the binding in two -->
<li data-wcs="class.done: done|eq(true)"></li>    <!-- compares a boolean with the string "true": always false -->
<img data-wcs="attr.alt: caption">                 <!-- caption undefined gives alt="undefined" -->
```

3.0 rejects the broken inputs with a code such as `[wcs/binding-syntax]`, and reads the inputs whose intent is clear as written.

```html
<input data-wcs="value#ro,wo: name">               <!-- modifiers are comma-separated after one # -->
<span data-wcs="textContent: tags|join('; ')"></span> <!-- a ; or | inside quotes is not a separator -->
<li data-wcs="class.done: done|eq(true)"></li>    <!-- an unquoted true is a boolean -->
<img data-wcs="attr.alt: caption">                 <!-- undefined / null remove the attribute -->
```

The other pillar is the split entries. `@wcstack/state/core` holds the binding engine only; `$watch`, `bind-component`, SSR, the formatting filters and the rest are added from `@wcstack/state/features/*` with `installFeatures([...])`. This is an **additional form** and does not concern existing pages ([§4](#4-behaviour-changes-that-are-not-syntax)).

## 2. Mechanical steps

1. **Upgrade to 2.6.1 first and run the page.** Each time a form that changes in 3.0 goes through, the console says so:

   ```
   [@wcstack/state] [wcs/v3-migration] "value#ro#wo": 3.0 rejects a second "#". Write "value#ro,wo".
   See "Preparing for 3.0" in the @wcstack/state README.
   ```

   The syntax rows are checked when a binding is first parsed; the value rows only when the value actually arrives. A quiet console says nothing about paths you did not exercise.
2. **Sweep statically with the validator.** The 2.6.x `@wcstack/lint` and the VS Code extension report the syntax rows with the same check, as `wcs/v3-migration` at info severity. The value rows (an `undefined` on a display surface, a write through a readonly proxy, …) cannot be seen statically; step 1 and your tests find those.

   ```bash
   npx @wcstack/lint@2.6 index.html
   ```
3. **Fix the warnings one by one.** Each warning names the replacement, and so does [the 2.6.1 README, "Preparing for 3.0"](https://github.com/wcstack/wcstack/blob/v2.6.1/packages/state/README.md#preparing-for-30-wcsv3-migration). Every replacement can be written in 2.x, so the fixed page runs the same on 2.6.1 and on 3.0.
4. **Upgrade to 3.0.** Pin every `@wcstack/*` package to the same version. The 3.0 `@wcstack/lint` and VS Code extension report the forms 3.0 rejects as `wcs/binding-syntax` at **error** severity.

## 3. Every breaking change

All of them are in `@wcstack/state`. "2.6 notice" says whether 2.6.x's `wcs/v3-migration` names the form.

**Syntax** (fails when the binding is parsed; lint and the VS Code extension use the same check)

| Form | 2.x | 3.0 | Write instead | 2.6 notice |
|---|---|---|---|---|
| A second `#` (`value#ro#wo:`) | keeps the first modifier list only | `[wcs/binding-syntax]` | `value#ro,wo:` | runtime, lint |
| A value after `else:` (`else: x`) | drops the right-hand side | `[wcs/binding-syntax]` | `else:` | runtime, lint |
| Modifiers or filters on the left of `for` / `if` / `elseif` / `else` / `...` | becomes a plain property binding | `[wcs/binding-syntax]` | the keyword alone | runtime, lint |
| An unterminated quote in filter arguments (`join('x)`) | closed silently | `[wcs/binding-syntax]` | close the quote | runtime, lint |
| More or fewer arguments than a filter accepts (`join(a,b)`) | extras ignored | `[wcs/filter-arity]` when the bindings are planned | drop the extras | runtime, lint |
| An empty filter (`x\|`, `x\|\|y`, `x\|(1)`) | `[wcs/filter-unknown]` (name `""`) | `[wcs/binding-syntax]` (only the code changes) | remove the empty filter | — |
| `radio#ro:` / `checkbox#ro:` | a plain property called `radio`, which does not work as a radio / checkbox binding | a radio / checkbox binding that honours the modifiers | — (check it does what you meant) | runtime, lint |
| `;` / `\|` inside quotes (`join('; ')`, `join(' \| ')`) | splits the binding there and breaks it | not a separator — works as written | — | — (pages that worked on 2.x are unaffected) |

**Values and writes** (change when that value or that write arrives)

| Form | 2.x | 3.0 | Write instead | 2.6 notice |
|---|---|---|---|---|
| Unquoted `true` / `false` / `null` in `eq` / `ne` (`eq(true)`) | compares boolean and `null` values with the text (a boolean never matches) | compares with the typed value | `eq('true')` to keep comparing with text | runtime, lint (on the source text) |
| Unquoted `true` / `false` / `null` in `defaults` | the text (`"null"`) is the default | the typed value (`null`) | `defaults('null')` to keep the text | runtime, lint (on the source text) |
| An unquoted number in `defaults` (`defaults(0)`) | the text `"0"` is the default | the number `0` | `defaults('0')` to keep the text | — (displays the same; the type matters to a later filter or comparison) |
| `0n` reaching `truthy` / `falsy` / `defaults` | truthy | falsy (JavaScript's truthiness, like `boolean`) | — | runtime |
| `undefined` reaching `textContent` / `innerText` / `innerHTML` | keeps the previous text (in a reused row, **the previous row's** text) | empties it | keep the value yourself if you meant "keep what is shown" | runtime |
| `undefined` / `null` reaching `attr.*` | writes `"undefined"` / `"null"` | removes the attribute | — | runtime |
| `undefined` reaching `style.*` | keeps the previous value | clears it | — | runtime |
| `$resolve(path, indexes, undefined)` | reads | writes `undefined` (the argument count decides read or write) | `$resolve(path, indexes)` to read | runtime |
| `$resolve(path, indexes, value)` / `$setAll` (the `**` broadcast included) on a readonly proxy | writes | throws `This state is readonly.` | write inside `createState("writable", …)` | runtime |
| A component write through a `#ro` mount (`state#ro: user`, `state.title#ro: doc.title`) | writes to the host tree | throws `[wcs/mount-readonly]`; a two-way input inside the component does not write back | write on the host, or drop the `#ro` | runtime |
| A component's own default for a key an explicit partial mount covers (`state = { message: "" }` with `state.message: user.name`) | the default wins (`wcs/mount-own-key-shadow` warning) | the explicit mount wins — the host value arrives | remove the default | runtime |

**Tooling surfaces** (only for tools that import `@wcstack/state/parser`)

| Surface | 2.x | 3.0 |
|---|---|---|
| `inFilters` / `outFilters` of `ParseBindTextResult` | `IFilterInfo` (carries `filterFn`) | `IParsedFilter` (`filterName` / `args` / `literals`). The implementation is resolved when the bindings are planned, so parsing alone does not fail on an unknown filter |
| `findV3MigrationIssues` / `findEmbeddedV3MigrationIssues` | only in 2.6.x | removed (the notice has done its job) |
| `splitBindTexts` | — | added: the runtime's own quote-aware `;` splitter |

### 3.1 and 3.2 — what a 2.x page also meets on the way to 3.2

Nothing here refuses a form that worked on 3.0, but a page coming from 2.x lands on the newest 3.x, so read these too. Each one's full entry is in the [CHANGELOG](../CHANGELOG.md).

| Release | Change | What it means when you come from 2.x |
|---|---|---|
| 3.1 | **An explicit property form, `.name:`** (requirement B5) | Additive. `online: x` is still an event binding (a `"line"` listener); `.online: x` is the element's `online` **property**. The leading dot used to fail at apply time, so nothing that worked changes. A namespace word after the dot (`.class`, `.attr`, `.style`, `.command`, `.eventToken`, `.state`) and an empty name are `[wcs/binding-syntax]` |
| 3.1 | **An injection point for volumes**, `<wcs-state mount="cart" data-wcs="state.taxRate: settings.taxRate">` (requirement B14③) | Additive, with one consequence: on a `<wcs-state mount=…>`, a left-hand side that starts with `state.` is now read as an injection declaration and is **not** collected as a binding. On 2.x it was a binding that failed to apply as a write to a missing `state` property, so no working page changes. Written on a `<wcs-state>` **without** `mount=`, it is `[wcs/mount-path-invalid]` |
| 3.2 | **Canonical filter / API / declaration names, with the old names as aliases** (requirement B12) | Everything from 2.x keeps working through 3.x. Rename at your own pace: `inc`/`dec` → `add`/`sub`, `fix` → `toFixed`, `uc`/`lc`/`cap` → `upper`/`lower`/`capitalize`, `rep`/`rev` → `repeat`/`reverse`, `pad` → `padStart`, `null` → `nullIfEmpty`; `$trackDependency`/`$untrackDependency` → `$dependOn`/`$untracked`; `$updatedCallback` → `$renderedCallback`, `$streams` → `$stream`. Lint and the VS Code extension flag each old name as `wcs/name-alias` (info); the runtime warns only in the last 3.x minor, and 4.0 removes them. **Declaring both spellings of a declaration key is `[wcs/declaration-alias]`** — that is the one form that stops working. A declaration key written with an old name is **moved** onto the canonical one when the state enters the runtime, so the old name is gone from the object afterwards: state code that read its own declaration back (`this.$streams`, `this.$updatedCallback`) has to read the canonical name (`this.$stream`, `this.$renderedCallback`). Declaring is what keeps working, not reading the declaration back |
| 3.2 | `add` / `sub` (`inc` / `dec`) require their argument | On 2.x the arity table said the argument was optional, so `inc` without one passed lint and then failed without a code. It is now `[wcs/filter-arity]` |
| 3.2 | New filters `padEnd(n, c)` and `coalesce(v)` | Additive. `coalesce` replaces only `null` / `undefined`; `defaults` keeps replacing every falsy value. `padStart` pads with `0` by default and `padEnd` with a space — the pair is deliberately not symmetric (`padStart` is almost always used for zero padding) |

## 4. Behaviour changes that are not syntax

- **Split entries (added).** New entries: `@wcstack/state/core`, `@wcstack/state/features/{temporal,scopes,recursion,ssr,formats,devtools,diagnostics}` and `@wcstack/state/define`. With `@wcstack/state` and `/auto`, `bootstrapState()` installs every feature, so existing pages keep the same behaviour and the same API. On a core page, a declaration whose feature is not installed fails with `[wcs/feature-not-installed]`, naming the entry to import (`bind-component`, `mount=` and DCC included — 2.x had no such thing as a missing feature). Load the split form from jsDelivr's plain `/npm/` path or through a bundler, **never through `esm.run`** (each entry would carry its own engine). Details in the state README, [Split entries](../packages/state/README.md#split-entries-only-the-features-you-use); integrity in [sri.md §5.1](./sri.md#51-the-split-entries-of-wcstackstate).
- **The empty-value contract applies to server rendering too.** `@wcstack/server` renders with the same runtime as the browser, so an `undefined` / `null` attribute is not emitted and an `undefined` text is empty. Snapshot tests may need new expectations.
- **`$errorCallback` on a volume or a mounted component is warned about.** Same as 2.6.0 (2.5 and earlier ignored it silently). It still runs only on the root state. What runs in which scope is one table under the state README's [`mount=`](../packages/state/README.md#mounting-additional-state-mount).
- **The named entry (`dist/index.esm.js`) is minified.** 321 KB → 78.5 KB gzip. Function names in stack traces and profiles are no longer readable; build from source with `WCS_STATE_UNMINIFIED=1 npm run build` when you need them.
- **Size.** `auto.min.js` grows from 71.6 KB (2.6.1) to about 77 KB gzip — the feature receptacles and the breaking fixes above. The split form's core alone, with no feature installed, is about 52 KB (the sum of its chunks, each gzipped).
- **Performance.** Medians against 2.5.1: creating 10,000 rows (cold) −18.7 %, appending 1,000 rows −15.9 %, clearing 10,000 rows −14.7 %. Creating 1,000 rows warm is unchanged, and no measure regressed. The heap per row goes from 3.6 to 3.0 KB (against a 2.6-equivalent build).

## 5. Tools

| Tool | What changes |
|---|---|
| `@wcstack/lint` / VS Code extension | New `wcs/binding-syntax` (**error**): an unterminated quote, a second `#`, a value after `else:`, modifiers or filters on a structural directive or spread, an empty filter. The judgement is the canonical parser's (`@wcstack/state/parser`), so it cannot drift from the runtime. 2.6.x's `wcs/v3-migration` (info) is gone. A `;` inside quotes is not a separator |
| `@wcstack/devtools` | The State pane gains a **Keyed selection** section: the `$eq` / `$eqPath` / `$eqIndex` subscriptions per path, with a `tracked` badge on a getter path that re-evaluates every row. The source it reads, `keyedSubscriptions(rootNode)`, is an additive pull API, so the hook protocol stays at v2: a 2.x devtools build still displays a 3.0 state (without the section), and a 3.0 build hides the section on a 2.x state |
| `@wcstack/server` | API unchanged. Use it with the 3.0 `@wcstack/state`; its output follows the empty-value rules in §4 |
| `@wcstack/testing` / `wcs-schema` (`@wcstack/typescript`) / manifest | Unchanged (the manifest stays at `schemaVersion` 2) |
| `wcstack/auto`, CDN pins | Every package is released together. Pin every `@wcstack/*` tag to the same version. Each release's SRI digests are on its GitHub Release page and in [sri.md](./sri.md) |

## 6. Checklist

```text
[ ] run the pages and tests on 2.6.1          → no wcs/v3-migration warning
[ ] npx @wcstack/lint@2.6 <all html>          → no wcs/v3-migration (info)
[ ] value#ro#wo → value#ro,wo ; else: x → else: ; no modifiers / filters on structural directives
[ ] remove unterminated quotes, extra filter arguments, empty filters
[ ] check what eq(true) / defaults(null) mean to you (quote them to keep text)
[ ] no undefined returned in the hope of keeping what is shown (display surfaces empty now)
[ ] no $resolve(p, i, undefined) meant as a read
[ ] no writes through a readonly proxy or a #ro mount
[ ] remove defaults that an explicit partial mount covers
[ ] tools on @wcstack/state/parser: move to IParsedFilter
[ ] pin every @wcstack/* to one 3.0 version
[ ] npx @wcstack/lint <all html>              → no error
```

## 7. What else changed late in 2.x

If you upgrade from before 2.6.0, these came in minor or patch releases and affect you independently of 3.0. The [CHANGELOG](../CHANGELOG.md) has the details of each.

- **2.6.1 — holes in keyed selection fixed:** selection did not reach the rows for object keys, writes to an ancestor of `path`, and a getter `path`.
- **2.6.0 — keyed selection (`$eq` / `$eqPath` / `$eqIndex`) added.** Importing only `defineState` no longer keeps the runtime.
- **2.5.0 — `setInitialState()` on an initialized element re-renders the page** (the old display used to stay until the next write). `setInitialState()` on a loaded volume throws.
