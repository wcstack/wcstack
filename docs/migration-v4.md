# @wcstack/state 3.x → 4.0 migration guide (preview)

**日本語版**: [migration-v4.ja.md](./migration-v4.ja.md)

> **Preview — 4.0 is not released yet.** This guide describes the 4.0 engine as it stands in development (October 2026), so that 3.x users can prepare. Names, messages and details may still change before the release. Items marked *(not final)* are known to be under review. The 4.0.0 entry of the [CHANGELOG](../CHANGELOG.md) will be the definitive list.

**Who this is for**: application developers whose pages use `@wcstack/state` 3.x — through `@wcstack/state`, `/auto`, the split entries or the `wcstack/auto` bundle — together with the packages released alongside it (`@wcstack/router`, `@wcstack/server`, the I/O node packages, `@wcstack/lint`).

## What changes in 4.0

4.0 replaces the engine inside `@wcstack/state` with a rewritten one. What you write against stays the same: `<wcs-state>`, `data-wcs`, `{{ }}` and comment bindings, `for` / `if`, paths and path getters, the `$` APIs, `bind-component`, `mount=` volumes, `enable-ssr`, and the package entries (`.`, `/auto`, `/core`, `/features/*`, `/define`, `/parser`, `/manifest`). What changes:

- The 3.2 old names, the `substr` filter and `$scan` are removed.
- Three `bootstrapState()` options move into the state as `$behavior`, and every package's `bootstrapXxx()` throws on an option it does not have.
- `on*:` handlers for the common bubbling events are delegated to the root, so `event.currentTarget` is the root. `#direct` opts a binding out.
- Writing a list element replaces the value at that position; rows no longer move with values.
- A volume no longer runs `$watch`, `$listKeys` or `$renderedCallback`, and takes no injections.
- SSR output is not compatible with 3.x: `@wcstack/server` and the client move together (a 4.0 client renders 3.x output again on the client).
- A few rendering rules and public API members change.

The path is: **upgrade to 3.5 first, clear its warnings (all but those for the three options that move to `$behavior`, §1.8), then move to 4.0.** All `@wcstack/*` packages move to each version together, as in every release.

## Summary checklist

On 3.5 (§1):

- [ ] Pin CDN URLs to major version 3, so the 4.0 release does not reach your pages before you are ready.
- [ ] Move every `@wcstack/*` package to 3.5.
- [ ] Run the page with the full entry and clear the `[wcs/v4-migration]` console warnings — except those about the three options that move to `$behavior`, which keep warning until you upgrade (§1.8).
- [ ] Clear the warnings that each package's `bootstrapXxx()` prints about its options.
- [ ] Run `@wcstack/lint` 3.5 and clear what it reports.
- [ ] Replace the 3.2 old names with the canonical ones.
- [ ] Replace `substr(start, length)` with `slice(start, start + length)`.
- [ ] Rewrite `$scan` with `$watch` / `$on`.
- [ ] Handlers that read `event.currentTarget`: add `#direct`, or use `event.target.closest(...)`.
- [ ] Delete `debug`, `commentTextPrefix` and `enablePropagationContext` from `bootstrapState()`.

When upgrading to 4.0 (§2, §3):

- [ ] Move every `@wcstack/*` package to 4.0 at once.
- [ ] Deploy `@wcstack/server` 4.0 together with the 4.0 client (§3.6).
- [ ] Move `enableMustache` / `sameValueGuard` / `enableDirectionalInitialSync` from `bootstrapState()` into the `$behavior` of each root state that needs them (§3.2).
- [ ] Review `#stop` and page code that calls `stopPropagation()` (§3.3).
- [ ] Reorder rows by assigning a new array, not by writing list elements (§3.4).
- [ ] Replace CSS or test selectors on `[data-wcs]` that target row or branch elements (§3.4).
- [ ] Replace `outerHTML:` / `outerText:` inside `for:` / `if:` templates with `innerHTML:` on a wrapper (§3.4).
- [ ] Replace filters on `for:` with a getter that returns the filtered list (§3.4).
- [ ] Move volume `$watch` / `$listKeys` / `$renderedCallback` to the root state (§3.5).
- [ ] Replace volume injections with getters on the root state (§3.5).
- [ ] Replace uses of `listPaths` / `getterPaths` / `setterPaths` / `nextVersion()` (§3.7).
- [ ] Pages on `/core`: install `features/list-keys` if they use `$listKeys` (§3.8).
- [ ] Pages on `/core`: install `features/diagnostics` while developing (§3.8).
- [ ] Read the changes nothing reports: children of content-binding elements, `<noscript>` / `<iframe>`, comments in `<textarea>` / `<title>`, `$watch` on a numeric-index key or on an array several rows share, reads past the end of a list (§3.4); post-processing of SSR output (§3.6); the extra child node in the router outlet (§3.9).
- [ ] Run `@wcstack/lint` 4.0 and fix what it reports (§4).

> **Comment bindings stay.** `<!--@@: path-->` and `<!--@@wcs-text: path-->` are still supported in 4.0. This is the form the lint recommends instead of `{{ }}` outside a `<template>`, to avoid a flash of unrendered text, and 4.0 binds it even when `enableMustache` is off. Only the `commentTextPrefix` option, which renamed the keyword, is gone. Details in §3.4.

## 1. Before you upgrade: move to 3.5 first

3.5 is the step before 4.0. It keeps the 3.x behaviour and warns, in the console and in the lint, about the forms 4.0 removes or changes. Everything you change in this section works on 3.5 and keeps working on 4.0. The `@wcstack/state` 3.5 README has a "Preparing for 4.0" section with the same list.

### 1.1 Pin the major version, then take 3.5

`https://esm.run/@wcstack/state/auto` follows the latest release, so it will load 4.0 on the day 4.0 is published. Pin the major version until you have migrated; the pinned URL picks up 3.5:

```html
<script type="module" src="https://esm.run/@wcstack/state@3/auto"></script>
```

Do the same for the other packages you load from a CDN, and for `wcstack/auto`, which bundles `@wcstack/state`. With npm, move every `@wcstack/*` package to 3.5; a range such as `^3.5.0` stays on 3.x. `@wcstack/router` 3.5 already brings the router changes described in §3.9.

### 1.2 Clear the runtime warnings

- `@wcstack/state` 3.5 prints `[wcs/v4-migration]` warnings in the console, once per message. Only the full entries print them (`@wcstack/state` and `/auto`), not the split `/core`: check a split page once with the full entry, or rely on the lint (§1.3).
- They cover the 3.2 old names, `$scan` and `substr`, the `bootstrapState()` options 4.0 removes or moves to `$behavior`, unknown or wrong-typed `bootstrapState()` options, a `$behavior` / `$features` value that 3.x does not honour or that 4.0 throws on, and `$behavior` / `$features` in a volume (4.0 refuses to graft it).
- The warnings about `enableMustache`, `sameValueGuard` and `enableDirectionalInitialSync` cannot be cleared on 3.5: keep those options in `bootstrapState()` until you upgrade (§1.8), and expect the warnings until then.
- Every other package's `bootstrapXxx()` — the router and the autoloader included — warns about an option 4.0 rejects: an unknown option, a value of the wrong type, or an unknown or non-string `tagNames` entry. The autoloader also warns about `scanImportmap`.
- A quiet console says nothing about code your session did not run.

### 1.3 Run the 3.5 lint

```bash
npx @wcstack/lint@3.5 index.html
```

The VS Code extension shows the same findings.

- `wcs/name-alias` (info): a 3.2 old name. A state that declares both an old and a canonical key gets `wcs/declaration-alias` (error), and reading a declaration key by its old name (`this.$streams`) gets `wcs/declaration-alias-read` (warning or info).
- `wcs/v4-migration` (info): `$scan`; `substr`, with the exact `slice` call when the arguments are non-negative literals; an `on*:` handler of a bubbling event that reads `event.currentTarget`.
- Warnings for forms that are already broken on 3.x and that 4.0 rejects: `outerHTML:` / `outerText:` inside `for:` / `if:` templates, a `*` of another list inside a row, `$0` / `$129` in markup, `this.$0` / `this.$129` in the script (`wcs/index-param-range`), a second root `<wcs-state>` (`wcs/second-root`).

Info never affects the exit code, and `--errors-only` hides it: read the full output.

### 1.4 Use the canonical names

3.2 renamed these and kept the old names as aliases through 3.x. 4.0 removes the aliases.

| Kind | Old name (removed in 4.0) | Write instead |
|---|---|---|
| Filter | `inc` / `dec` | `add` / `sub` |
| Filter | `fix` | `toFixed` |
| Filter | `uc` / `lc` / `cap` | `upper` / `lower` / `capitalize` |
| Filter | `rep` / `rev` | `repeat` / `reverse` |
| Filter | `pad` | `padStart` |
| Filter | `null` | `nullIfEmpty` |
| Proxy API | `$trackDependency` / `$untrackDependency` | `$dependOn` / `$untracked` |
| Declaration key | `$updatedCallback` | `$renderedCallback` |
| Declaration key | `$streams` | `$stream` |

### 1.5 Replace `substr` with `slice`

4.0 removes the `substr` filter. `slice` takes an end index, not a length:

```html
<!-- 3.x only -->
<span data-wcs="textContent: code|substr(2, 3)"></span>

<!-- 3.5 and 4.0 -->
<span data-wcs="textContent: code|slice(2, 5)"></span>
```

For a start of 0 or more, `substr(start, length)` is `slice(start, start + length)`. A negative start counts from the end in both filters, but the end differs; check those calls by hand.

### 1.6 Rewrite `$scan` with `$watch` or `$on`

4.0 removes `$scan`. Keep the accumulated value as an ordinary key and write it from a handler:

- a scan with `from: "path"` becomes a `$watch` handler on that path;
- a scan with `on: "token"` becomes an `$on` handler for that event token;
- `resetOn` becomes a `$watch` handler that writes the initial value back.

```js
// 3.x only
export default {
  amount: 0,
  room: "lobby",
  $eventTokens: ["message"],
  $scan: {
    total: { from: "amount", initial: 0, fold: (sum, cur) => sum + cur },
    log: { on: "message", initial: [], fold: (log, e) => [...log.slice(-49), e.detail], resetOn: ["room"] },
  },
};
```

```js
// 3.5 and 4.0
export default {
  amount: 0,
  room: "lobby",
  total: 0,
  log: [],
  $eventTokens: ["message"],
  $watch: {
    amount(cur) { this.total = this.total + cur; },
    room() { this.log = []; },
  },
  $on: {
    message: (state, e) => { state.log = [...state.log.slice(-49), e.detail]; },
  },
};
```

Like a `from` scan, a `$watch` handler sees one settled value per update batch. Two things differ: the value is now plain state that you own (a re-set replaces it like any other key), and the reset happens when the `$watch` handler runs at the end of the batch, not at the moment of the write.

### 1.7 Stop reading `event.currentTarget`

In 4.0 the common bubbling events are delegated, and `event.currentTarget` is the root (§3.3). Find the element from `event.target` (for example `event.target.closest("li")`), use the loop index the handler receives, or add `#direct` to the binding (`onclick#direct: select`). `#direct` works on 3.x today, because 3.x already attaches handlers to the element; the 3.5 VS Code extension offers it in completion.

### 1.8 `bootstrapState()` options

- Delete `debug`, `commentTextPrefix` and `enablePropagationContext`. Before deleting `commentTextPrefix`, rewrite your comment bindings with the default keyword (`<!--@@: path-->` or `<!--@@wcs-text: path-->`). On 3.x, deleting `enablePropagationContext: false` turns the propagation context back on, its default; 4.0 has none.
- Keep `enableMustache`, `sameValueGuard` and `enableDirectionalInitialSync` in `bootstrapState()` for now: 3.x does not read `$behavior`. Move them when you upgrade (§3.2); until then, the 3.5 warnings about them are expected.

## 2. Upgrading to 4.0

- Move every `@wcstack/*` package to the same 4.0 version.
- Deploy `@wcstack/server` 4.0 and the 4.0 client together (§3.6).
- Update CDN URLs to the new major version (`https://esm.run/@wcstack/state@4/auto`).
- `@wcstack/lint`, `@wcstack/typescript` and the VS Code extension get the 4.0 rules in releases published together with 4.0. Keep the 3.5 ones for 3.x projects: the 4.0 rules report forms that 3.x still accepts.

**How 4.0 reports errors.** Messages carry the same `[wcs/<code>]` codes as the lint, and many also have a number:

```
[@wcstack/state] [wcs/filter-unknown] filter not found: uc.      ← @wcstack/state and /auto
[@wcstack/state] [wcs/filter-unknown] #501 "uc"                   ← /core without features/diagnostics
```

The sentence comes from the `diagnostics` feature, which `@wcstack/state` and `/auto` include. A page on `/core` without it prints the code, the number and the values (3.x printed the full sentence either way). A number keeps its meaning across versions. The tables in §4 list the messages this guide mentions.

**A removed filter name gets its replacement, not a "Did you mean".** For the 3.2 old names and `substr`, the message names what to write instead of the nearest built-in name, which for these is an unrelated filter (following `dec` → `eq` would change the meaning silently):

```
[@wcstack/state] [wcs/filter-unknown] filter not found: dec. "dec" was renamed "sub" in 3.2 and removed in 4.0 — write "sub". Validate statically: npx @wcstack/lint <file>.
```

The replacement, like the sentence, comes from the `diagnostics` feature. Without it the message is `#501 "dec"`: use the table in §1.4, or the replacement the lint names.

## 3. Breaking changes

### 3.1 Removed names and declarations

| 3.x | In 4.0 | Runtime message | 4.0 lint |
|---|---|---|---|
| Old filter names (`uc`, `fix`, …) | throws when the page is initialized | `[wcs/filter-unknown] filter not found: uc.` followed by `"uc" was renamed "upper" in 3.2 and removed in 4.0 — write "upper".` (#501) | `wcs/filter-unknown` (warning; names the replacement) |
| `substr(start, length)` | same | `[wcs/filter-unknown] filter not found: substr.` followed by `"substr" was removed in 4.0 — write slice(start, start + length) …` | `wcs/filter-unknown` (warning; suggests the `slice` call) |
| `$trackDependency` / `$untrackDependency` | throws when read | `[wcs/name-alias] $trackDependency was removed: write $dependOn.` (#1701) | `wcs/name-alias` (error) |
| `$updatedCallback` / `$streams` | throws when the state loads | `[wcs/declaration-alias] $streams was removed: write $stream.` (#1601) | `wcs/declaration-alias` (error) |
| `$scan` | throws when the state loads | `$scan was removed (use $watch or $on)` (#1) | `wcs/scan-declaration-invalid` (error) |

Without the `diagnostics` feature the runtime message is only the code, the number and the name, and does not name the replacement (§2).

In a volume (`<wcs-state mount=…>`), the removed declaration keys and `$scan` do not throw: the volume is not grafted and the reason goes to `console.error` (§3.5).

The lint reports `wcs/filter-unknown` as a warning although the runtime throws, because a page can register filters of its own at run time.

What to do: §1.4–§1.6.

### 3.2 Configuration

#### `bootstrapState()` keeps the markup spelling; behaviour moves to `$behavior`

| Option | 3.x | 4.0 |
|---|---|---|
| `bindAttributeName`, `tagNames.state`, `tagNames.ssr`, `commentForPrefix`, `commentIfPrefix`, `commentElseIfPrefix`, `commentElsePrefix`, `locale`, `enableContractAnalyzer` | `bootstrapState()` | `bootstrapState()` (unchanged) |
| `enableMustache`, `sameValueGuard`, `enableDirectionalInitialSync` | `bootstrapState()` | the `$behavior` of each root state |
| `debug`, `commentTextPrefix`, `enablePropagationContext` | `bootstrapState()` | removed |

```js
// 3.x
bootstrapState({ locale: "ja-JP", enableMustache: false, sameValueGuard: false });
```

```js
// 4.0
bootstrapState({ locale: "ja-JP" });
```

```js
// 4.0 — each root state that needs the options
export default {
  $behavior: { enableMustache: false, sameValueGuard: false },
  count: 0,
};
```

`$behavior`:

- Three boolean keys, each `true` by default, with the same meaning as the 3.x options. An unknown key or a value that is not a boolean throws `#44`.
- It applies per state tree: to the tree of the `<wcs-state>` that declares it, its volumes included. A 3.x option covered the whole page; in 4.0 **each root state** that needs it declares its own — the page's root, a root `<wcs-state>` in a shadow root, a mounted component, a DCC. Nothing is inherited from a host. A volume cannot declare it (§3.5).
- A re-set (`setInitialState()` on an initialized element) cannot change it: that throws `#45`. A re-set state without `$behavior` is compared with the defaults, so repeat the declaration in it.
- It also works on `/auto` pages and in JSON states. In 3.x, `/auto` had no way to pass these options.
- Under SSR the server reads the same state, so server and client agree.

The removed options:

- `debug`: no replacement.
- `commentTextPrefix`: it renamed the keyword of comment bindings. Write them as `<!--@@: path-->` or `<!--@@wcs-text: path-->`.
- `enablePropagationContext`: 4.0 has no propagation context, so there is nothing to switch off.

#### Unknown options throw, in every package

`bootstrapState()` throws on an option it does not have (a moved or removed one included), on a value whose type differs from the default (`null`, or an array where an object is expected), on a name under `tagNames` it does not define, and on a tag name that is not a string. It checks every option before applying any, so nothing is applied when it throws. An `undefined` value is skipped (`bootstrapState({ locale: maybeLocale })`).

```
[@wcstack/state] bootstrapState: "enableMustache" is not one of its options, or not of the option's type. 4.0 moved it to the state's $behavior.
```

Every other package's `bootstrapXxx()` — `bootstrapRouter`, `bootstrapFetch`, `bootstrapAutoloader`, `bootstrapStorage` and the rest — applies the same rule. 3.x ignored such options silently; 3.5 warns about them (§1.2).

```
[@wcstack/fetch] bootstrapFetch: "tagName" is not one of its options, or not of the option's type.
```

The autoloader's `scanImportmap` option is removed. 3.x accepted it but never read it — the autoloader read the import map either way — so delete it; passing it now throws.

Pages that only load the `/auto` entries are not affected: they call `bootstrapXxx()` without options.

How to find it: the 3.5 warnings (§1.2), or search your scripts for `bootstrap` calls. The lint does not check them, because they are outside `<wcs-state>`.

#### Default locale

The default `locale` reads `<html lang>` when the module is evaluated; 3.x read it when `bootstrapState()` ran. Write `<html lang>` in the markup, or pass `locale` to `bootstrapState()`.

### 3.3 Events: delegation and `#direct`

In 3.x, every `on*:` binding added a listener to its element. In 4.0, `on*:` bindings for `click`, `dblclick`, `input`, `change`, `submit`, `keydown`, `keyup`, `mousedown`, `mouseup`, `pointerdown` and `pointerup` are **delegated**: one listener per event type sits on the root that the state binds, and it runs the handlers of the elements the event passed, innermost first. That root is the document or a shadow root — or, inside a Light DOM mounted component, the host element. Other event types, and an event a custom element dispatches with `bubbles: false`, are still heard on the element. Two-way bindings (`value:`, `checked:`, radio, checkbox) keep their listener on the element.

| | 3.x | 4.0 (delegated) |
|---|---|---|
| `event.currentTarget` in the handler | the element | the root (document, shadow root, or a Light DOM component's host) |
| `#stop` on an inner `on*:` binding | stops the outer `on*:` handlers | the same |
| `#stop` inside an element your own code listens on (`addEventListener` on an ancestor, e.g. a clickable card) | stops that listener | does not stop it: it ran before the event reached the root |
| Your code calls `stopPropagation()` on an ancestor (e.g. a modal's content keeping clicks from the overlay) | the inner `on*:` handler still runs | the inner handler never runs |
| The element is moved under another root (e.g. a dialog moved from a shadow root to `document.body`) | its handler runs | its handler does not run |

What to do:

- Find the element from `event.target` (for example `event.target.closest("li")`), or use the loop index the handler receives (`removeItem(event, index)`), instead of `event.currentTarget`.
- Where a handler has to behave as in 3.x, add `#direct`:

```html
<!-- a button inside a card whose click listener your own code added -->
<button data-wcs="onclick#direct,stop: save">Save</button>
```

`on*#direct:` adds the listener to the element itself, as 3.x did: `currentTarget` is the element, `#stop` stops your own listeners on ancestors, an ancestor's `stopPropagation()` does not keep it from running, and it still runs after the element moves under another root. It combines with `#prevent` and `#stop`. Inside `for:` / `if:` it is attached per row and removed with the row.

Handlers run where the DOM puts them. An outer `#direct` handler runs before the delegated handlers inside it, because those run at the root. So an inner `#stop` cannot stop an outer `#direct` handler unless the inner binding is `#direct` too (`onclick#direct,stop:`).

`#direct` can be added on 3.x already (§1.7).

How to find it: the 3.5 lint reports handlers of bubbling events that read `event.currentTarget` (`wcs/v4-migration`). It cannot see `#stop` inside elements your own code listens on, `stopPropagation()` in page code, or elements you move between roots: look for those yourself. The 4.0 lint warns (`wcs/template-syntax`) when `#direct` is put on a binding that is not an event binding.

### 3.4 Rendering and binding rules

#### Writing a list element replaces the value at that position

In 3.x, swapping values with element writes (`$resolve("items.*", [0], b)`, `this["items.0"] = …`) moved the rendered rows with their values once the swap was complete. In 4.0, an element write replaces the value at that position. The row stays where it is, with its `$1`, and DOM state that bindings do not own (focus, text typed into an unbound input, `<details>` open state) stays with the position; everything derived below the row is computed again. To move rows together with their values, assign a new array: rows are matched to the elements of the new array by identity.

```js
// 3.x: the two rows trade places once both writes have landed
const a = this.$resolve("items.*", [0]);
const b = this.$resolve("items.*", [1]);
this.$resolve("items.*", [0], b);
this.$resolve("items.*", [1], a);

// 4.0: assign a new array; the rows move with their objects
const items = this.items.slice();
[items[0], items[1]] = [items[1], items[0]];
this.items = items;
```

How to find it: look for `$resolve(path, indexes, value)` and index-path writes used to reorder a list. The lint cannot tell.

#### `data-wcs` is removed from row and branch elements

4.0 removes the `data-wcs` attribute from the elements it clones for `for:` rows and `if:` branches; 3.x kept it, with the paths expanded. A CSS rule or a test selector such as `[data-wcs*="items"]` that targets those elements no longer matches. Use a class or a `data-*` attribute of your own. Elements outside `for:` / `if:` templates are not affected.

#### `outerHTML:` / `outerText:` inside `for:` / `if:` templates

A row or a branch keeps its nodes by position, so a binding that replaces its element cannot be used inside one. 4.0 fails initialization with `[wcs/template-syntax] #203`; 3.x applied it once. Bind `innerHTML:` on a wrapper element instead. At page level, outside templates, `outerHTML:` / `outerText:` work as before.

```html
<!-- 3.x -->
<template data-wcs="for: posts">
  <div data-wcs="outerHTML: .html"></div>
</template>

<!-- 4.0 -->
<template data-wcs="for: posts">
  <div data-wcs="innerHTML: .html"></div>
</template>
```

The 3.5 lint warns about it; the 4.0 lint reports it as `wcs/template-syntax` (error).

#### Filters on `for:`

`for:` takes no output filters. `for: items|take(2)` fails initialization with `[wcs/binding-syntax] #121`, whatever the filter (an unregistered name too); 3.x rendered the rows of the filtered array. A row of `for: items` is `items.<index>`, so the rows of a filtered array would name other elements, and writes through them would land on the wrong ones. Declare a getter that returns the filtered list, and loop over it:

```html
<!-- 3.x -->
<template data-wcs="for: items|take(2)">…</template>

<!-- 4.0, with get firstTwo() { return this.items.slice(0, 2); } -->
<template data-wcs="for: firstTwo">…</template>
```

The getter returns a copy, so the limitation in §5 applies: a write through the original path (`this["items.1.n"] = 7`) does not reach the copy's row. Write through the row instead (`firstTwo.1.n`, or a binding inside the row).

How to find it: look for `|` in `for:` bindings. The 3.5 lint does not report it; the 4.0 lint reports it as `wcs/binding-syntax` (error).

#### A `*` from another list inside a row

A binding inside a `for:` row whose `*` ranges over a different list than the enclosing `for:` at that level (`{{ b.*.y }}` inside `for: a`) throws `[wcs/wildcard-rank] #1403` when the page is initialized. 3.x failed each such binding with `ListIndex not found`. Read the other list's row in a getter with `$resolve(path, indexes)`. The 3.5 lint warns about it; the 4.0 lint reports it as `wcs/wildcard-rank` (warning).

#### Markup errors stop initialization *(not final)*

In the current preview, a binding that cannot be read — a syntax error, an unknown filter, a wildcard-rank error — stops the binding there. At page level the `<wcs-state>` fails to initialize (`connectedCallbackPromise` rejects), and the bindings after the error are not attached. An error found while a binding is attached inside a `for:` / `if:` row (an undeclared token or wcBindable member, for example) goes to `$errorCallback` as that binding's failure, and the row is still built; at page level the same error fails initialization. 3.x reported a page-level error and failed only that binding. This behaviour is still under review. Run the 4.0 lint before you deploy. As in 3.5, a failed initialization is reported once with `console.error`, first the element and where its state comes from (`<wcs-state src="./state.js"> failed to initialize.`), then the error. A `$connectedCallback` that throws or rejects once the bindings are built is not an initialization failure: it is reported as `<wcs-state …> $connectedCallback failed.` followed by the error, `connectedCallbackPromise` rejects with it, and `getBindingsReady()` resolves, since the page is bound.

#### Comment bindings

`<!--@@: expr-->` and `<!--@@wcs-text: expr-->` bind as in 3.x: the same text binding as `{{ expr }}`, filters included, at page level and inside templates. The comment is replaced by a text node at the same position (the same DOM as 3.x). They bind even with `$behavior.enableMustache: false`. Differences from 3.x:

- A comment inside `<textarea>` or `<title>` is not bound (a browser parses that content as text).
- The expression may span several lines (3.x took one line).
- The keyword is empty or `wcs-text`. The `commentTextPrefix` option that renamed it is gone.
- 3.x also rendered its internal anchor comments (`<!--@@wcs-for: x-->`, `<!--@@wcs-if: x-->`, …) as text bindings. 4.0 leaves them alone.

#### Content-binding elements, `<noscript>` and `<iframe>`

- The children of an element whose content a binding sets (`textContent:`, `text:`, `innerText:`, `innerHTML:`, `html:`) are not bound, at page level or inside templates: `{{ }}`, `data-wcs` and structural templates in them stay literal. This also holds when `#init=element` or `#init=none` leaves the children you wrote in place. Put markup that needs bindings in a separate element.
- The children of `<noscript>` and `<iframe>` are not bound (3.x skipped only `<script>` and `<style>`). The element's own `data-wcs` (`srcdoc:`, `attr.src:`) still binds.
- The children of a page-level element bound with `outerHTML:` or `outerText:` are not bound.

#### Order at page level

At page level, an element's children are bound before the element's own bindings. A custom element's first property writes, and the order in which `$errorCallback` receives failures, are therefore reversed compared with 3.x (children first). Inside templates the order is document order, as before.

#### Smaller differences

- Writing a top-level key that the state does not have creates it (3.x failed the write). Reading one still throws `[wcs/binding-path-missing]`.
- A path that goes through `__proto__` or `prototype` throws `[wcs/binding-syntax] #120`: in bindings, writes, `$resolve`, `$setAll`, and reads such as `this.__proto__`.
- `state="id"` reads only a `<script type="application/json">` with that id.
- A `$watch` key with a numeric index (`"items.0.v"`) fires only when the value at that index changes. 3.x (since 3.4) fires it on a write through the index, on an element replacement, and on a write to any row of the list, possibly with an unchanged value.
- When several outer rows hold the same array, writing one of its elements fires `$watch("groups.*.items.*")` once for every outer row that holds it, each with its own indexes: the value changed at every one of those paths. 3.x fired it once, at the position written.
- An index past the end of a list: a write (`this["items.5.v"] = 1`, `$resolve("items.*.v", [5], 1)`) throws `no row for "items.*.v"` and changes nothing, and a read returns `undefined`. 3.x threw `ListIndex not found` on both.

### 3.5 Volumes and mounted components

#### Volumes (`<wcs-state mount="p">`)

| In a volume | 3.x | 4.0 |
|---|---|---|
| `$watch`, `$listKeys`, `$renderedCallback` | run, relative to `p` | refused: the volume is not grafted, `console.error` |
| `$stream`, `$scan`, `$recursion` | refused | refused |
| `$behavior`, `$features` | — | refused |
| `$commandTokens`, `$eventTokens`, `$on`, `$errorCallback` | not run, warning | not run, `console.warn` |
| An injection on the volume element (`data-wcs="state.taxRate: settings.taxRate"`, 3.1) | supported | refused: the volume is not grafted, `console.error` |
| The volume's methods | not on the tree | reachable by path (`onclick: p.method`, `this["p.method"]`) |

The messages read `$watch is not run in a volume — declare it on the root state.` and `injections (data-wcs="state.<key>: …") are not supported — read the root path in a root getter.`, after `[@wcstack/state] <wcs-state mount="p">`. A refused volume still resolves its `connectedCallbackPromise`.

Move the declarations to the root state, with full paths. Inside the root's handlers `this` is the root state, so paths are written from the root (`this["cart.items"]`).

```js
// 3.x: cart.js, mounted at "cart"
export default {
  items: [],
  get total() { /* … */ },
  $watch: { total(cur) { /* … */ } },
};
```

```js
// 4.0: cart.js keeps its data and getters; the root state takes the watch
export default {
  $watch: { "cart.total"(cur) { /* … */ } },
};
```

A volume's `$renderedCallback` received paths relative to its mount path. The root's `$renderedCallback(paths, indexes)` receives the paths of the whole tree, written from the root (`cart.items.*.name`), so filter them by the prefix: `paths.filter((p) => p.startsWith("cart."))`.

Replace an injection with a getter on the root state that reads both paths:

```html
<!-- 3.x -->
<wcs-state mount="cart" src="./cart.js" data-wcs="state.taxRate: settings.taxRate"></wcs-state>
<!-- cart.js: get totalWithTax() { return this.subtotal * (1 + this.taxRate); } -->
```

```html
<!-- 4.0 -->
<wcs-state mount="cart" src="./cart.js"></wcs-state>
<!-- root state: get cartTotalWithTax() { return this["cart.subtotal"] * (1 + this["settings.taxRate"]); } -->
```

A `<wcs-state mount>` inside the shadow root of a component that is wired to its host (`data-wcs="state…"` on the host) is refused with `will not graft: its component is wired to its host.`, and its `connectedCallbackPromise` resolves; 3.x left it pending. A wired component reads the host's tree, so put that data in the host's state.

The 4.0 lint reports these declarations as `wcs/volume-declaration`, `$behavior` / `$features` in a volume as `wcs/behavior-invalid` / `wcs/features-invalid`, and the removed names as in §3.1. The lint cannot read a volume's state loaded with `src=`, so a root `$watch` key or a binding under that mount path (`cart.total`) gets `wcs/watch-path-missing` / `wcs/binding-path-missing` warnings although it works. Expect them there; `--strict` turns them into CI failures.

#### Mounted components (`bind-component` with `state: …`)

| In a mounted component | 3.x | 4.0 |
|---|---|---|
| `$listKeys` | not run, warning | runs on the component's own lists |
| `$commandTokens`, `$eventTokens`, `$on` | not run, warning | run, on the component's own bindings |
| `$errorCallback` | not run, warning | receives the failures of the component's own bindings |
| `$recursion` | not run, warning | throws `[wcs/mount-dollar-declaration] <tag>: $recursion is not run in a mounted component — declare it on the root state.` |
| `$watch`, `$stream`, `$renderedCallback` | not run, warning | not run, `[wcs/mount-dollar-declaration]` warning (unchanged) |
| A write of the host row's element (`this["users.1"] = obj`) | the component's private data is rebuilt | the component element stays, and so do its private keys (see "Writing a list element" in §3.4) |
| Its `<wcs-state bind-component>` replaced by a new one | the scope is initialized again: the bindings of the nodes kept start again, and the nodes added are bound | while nodes the old one bound or rendered are still there, the new element takes the scope over: those bindings, rows and `{{ }}` text stay as they are, and nodes with bindings (`data-wcs`, `{{ }}`) added beside them are not bound — a `console.warn` says so. Otherwise (the content rendered again with it; kept nodes without bindings, such as a `<style>` or whitespace, do not count) the new element binds the content afresh |

A component's `<wcs-state bind-component>` that fails to mount rejects its `connectedCallbackPromise` with the error, as 3.x's README promised for configuration errors. 4.0 also rejects in two cases 3.x did not: a component wired to a root that failed to initialize (`<tag>.state will not mount: the root state failed to initialize.`; 3.x left its `connectedCallbackPromise` unsettled, so whatever waited for it hung, whether the component connected with the page or later), and a second `<wcs-state bind-component>` connected in one component (`<tag> already has a connected <wcs-state bind-component="state">.`; 3.x resolved it). `@wcstack/server`'s `renderToString()` and `@wcstack/testing`'s `mount()` wait for every `connectedCallbackPromise`, a Light DOM component's included, so they reject in these cases too. A component's `$connectedCallback` that fails rejects it as well, after the component is rendered (`… $connectedCallback failed.`, §3.4).

### 3.6 SSR

- **Deploy `@wcstack/server` 4.0 and the 4.0 client together.** A 4.0 client cannot hydrate the output of a 3.x `@wcstack/server`, which renders with `@wcstack/state` 3.x (or of any other major.minor). It warns — `<wcs-ssr version="3.5.0"> does not match 4.0.0: its snapshot is discarded, and the page renders on the client from its own state.` — and renders the page on the client as if there were no server: the server's snapshot is not used, the state loads from its own source (`json=`, `src=`, the inline script, `setInitialState()`), `$connectedCallback` runs on the client, and the server's rows, branches and markers give way to the templates they were rendered from. In a Light DOM component wired from the page (`data-wcs="state: user"`, `state.label: user.name`), 3.x wrote the paths as the page's (`user.name`); they are mapped back through the host's wiring. The page works, but what the server did is done again on the client (and data that `$connectedCallback` fetches is fetched again).
- One thing does not come back from 3.x output: a text binding outside the templates — a `{{ }}` or `<!--@@: -->` at page level or in a Light DOM component's content — loses its filters, because 3.x's markers keep only its path (`{{ price|toFixed(2) }}` shows the unformatted value). The warning says so for 3.x output. Inside `for:` / `if:` templates the expressions are kept whole. When you switch, purge the HTML rendered by 3.x, such as pages cached before the upgrade.
- The opposite combination, a 4.0 server with a 3.x client, is not supported. The 3.x client warns that it falls back to a full render (`SSR version mismatch: server="4.0.0", client="3.5.0". Falling back to full render.`), but it does not read 4.0's markers. Only the `data-wcs` attribute bindings outside templates follow state changes; text bindings, rows and branches stay as the server's HTML.
- If `@wcstack/state` 4.0 renders under an older `@wcstack/server` (for example through an npm override), the output can lack `<wcs-ssr>` entirely; the page then stays as the server's HTML, with no warning. Use the `@wcstack/server` released with 4.0.
- The `@wcstack/server` API (`renderToString()`) does not change. The format of its output does: do not post-process the output based on 3.x's markers.
- Keep the comments in the output. Text bindings and the row and branch markers are comments: removing them in a later minification step (html-minifier's `removeComments` and the like) breaks hydration, and `{{ }}` inside values may be read as bindings on the client.
- `outerHTML:` / `outerText:` are applied on the client, not on the server. The server output contains the element as written, so the value is not in the HTML that search engines or no-JS views see.
- Children that a Light DOM custom element bound at page level renders from a value are not in the server output; the client renders them. Children you wrote stay in it.
- As in 3.x, the snapshot is JSON: `Date`, `Set`, `Map` and class instances do not survive it. Keep JSON values in SSR state and derive the rest in getters (`get created() { return new Date(this.createdIso); }`).

### 3.7 Public API (JavaScript / TypeScript)

| 3.x | 4.0 |
|---|---|
| `IStateElement.listPaths`, `getterPaths`, `setterPaths`, `nextVersion()` | removed, no replacement |
| `Ssr` (`<wcs-ssr>`) `hydrateProps` | always empty (4.0 applies every binding when it adopts the server's DOM) |
| `Ssr` internal static methods (`extractStateData`, `buildContent`, …) | removed; what `ISsrElement` declares remains |
| `IWritableConfig` / `getConfig()` | without the six options of §3.2 |
| `$errorCallback(error, info)` | `info.node` is `null` (type `Node \| null`) for a list that no `for:` renders |
| `@wcstack/state/parser` results | no `uuid`; a `__proto__` / `prototype` segment in a path is rejected with #120 |
| `@wcstack/state/manifest` | the old-name tables are empty (`builtinFilterAliases` is `{}`); `$scan` is no longer reserved; `$behavior` and `$features` are reserved; new `behaviorOptions` and `features` |
| `defineState` types | without `$trackDependency` / `$untrackDependency` |
| `installFeatures()` | skips a feature it already installed (3.x called `install()` again; both are idempotent) |
| `@wcstack/state` | also exports the type `IStateElement` |

### 3.8 Split entries and features

- **`$listKeys` moved out of the core** into a new feature, `@wcstack/state/features/list-keys`. `@wcstack/state` and `/auto` include it. A `/core` page that uses `$listKeys` must install it; otherwise the state fails with `[wcs/feature-not-installed] $listKeys needs the add-on @wcstack/state/features/list-keys`.
- `features/temporal` serves `$watch` and `$stream` (`$scan` is gone).
- On `/core` without `features/diagnostics`, messages are numbered (§2). Install `diagnostics` while developing.
- Call `installFeatures([...])` before `bootstrapState()`, as in 3.x. A state that declares a feature's key before that feature is installed fails with `[wcs/feature-not-installed]`.
- The file names under `dist/split/chunks/` now carry a content hash. If you list chunk files yourself (preload links, `integrity` in an import map), take the names from the 4.0 build.

New in 4.0, and optional:

- **The split auto entry**, `dist/split/auto.js`, loads the split build from one script tag, without an import map. Load it from a plain, version-pinned `/npm/` path, not through `esm.run`. It is not in `exports`; with a bundler, keep `@wcstack/state/core` and `installFeatures`.

  ```html
  <script type="module" src="https://cdn.jsdelivr.net/npm/@wcstack/state@4.0.0/dist/split/auto.js"></script>
  <wcs-state features="scopes diagnostics">…</wcs-state>
  ```

- **`features="…"`** on the document's root `<wcs-state>` (the first one without `mount` and `bind-component`) is read once, before `<wcs-state>` is defined. It is the place for `scopes`, which must be there before any `<wcs-state>` starts, and for development aids (`diagnostics`, `devtools`). Only the split auto entry reads it.
- **`$features: ["temporal", "formats"]`** in a state names the features that state needs. The split auto entry loads the missing ones before it builds the state; the other entries only check that they are installed. A value that is not an array throws `#46`.
- The names are `formats`, `diagnostics`, `temporal`, `list-keys`, `scopes`, `recursion`, `ssr` and `devtools`. Any other name in `features=` makes the split auto entry fail with `[wcs/feature-unknown]` before it defines `<wcs-state>`. In `$features`, it fails that state with `[wcs/feature-unknown]` on the split auto entry and with `[wcs/feature-not-installed]` on the other entries.

### 3.9 Other packages

- **`@wcstack/router` 3.5 and later** (you get these on the way, with 3.5)
  - Shown route content now ends with a comment, `<!--@@wcs-route-end:/path-->` (the text of the SSR end marker), so the outlet has one more child node. `:empty` is unaffected.
  - Leaving a route takes out everything from the route's start to that marker — including rows and branches that `@wcstack/state` rendered there and nodes your code inserted — and entering puts it back. The router up to 3.4.0 moved only the route's original nodes and left the rest in the outlet. What comes back is what was taken out: a top-level node your code removed from the route body stays removed on the next entry. Showing the route that is already shown (a parameter change) takes its content out and puts it back in order, so its custom elements reconnect once and see the new parameters, nested routes included (the router up to 3.4.0 re-inserted the original nodes one by one, which reordered them, and reconnected a nested route wrapped in an element twice, first with the old parameter).
  - `for:` / `if:` templates placed directly under `<wcs-route>` render when the route is entered by navigation, with `@wcstack/state` 4.0. With the router up to 3.4.0, inside `<wcs-head>`, or when other code inserts the content, 4.0 does not render them and reports `[wcs/template-syntax] #204` on the console; 3.x never rendered them. Wrapped in an element, they render in every combination.
  - Route content inside a `<wcs-layout>`, and the layout template's own bindings, are bound on the first navigation into it too (the router up to 3.4.0 left them unbound when the route was entered by navigation, and a `for:` inside never rendered, even on later visits).
  - Unchanged: text `{{ }}` placed directly in a route body or a layout template, not inside an element, is not bound when the route is entered by navigation. Wrap it in an element.
- **`@wcstack/server`**: §3.6.
- **`@wcstack/autoloader` and the I/O node packages**: the `bootstrapXxx()` options rule and `scanImportmap` (§3.2).
- **`wcstack/auto`** bundles `@wcstack/state`, the router, fetch, storage and the autoloader, so it brings all of the above.
- **`@wcstack/devtools`**: works unchanged (hook protocol v2).
- **The binder protocol**: `bind(subtree, options?)` gains an optional second argument. Code that inserts content and later moves it in and out as one block passes `{ range: true }` (the router 3.5 and later does), and only then are `for:` / `if:` templates at the top of the inserted content rendered. This matters only if you call the binder yourself.
- **The [wcstack-app skill](https://github.com/wcstack/wcstack-skill)** is updated separately for 4.0.

## 4. Finding affected code

Before upgrading, the 3.5 console warnings and the 3.5 lint (§1.2, §1.3) find most of the forms in §1. After upgrading, use the 4.0 lint and the runtime messages below.

### 4.1 The 4.0 lint

Run `npx @wcstack/lint@4 <files>` once 4.0 is published (the VS Code extension shows the same codes). `--strict` also fails CI on warnings, which helps because two of the warnings below throw at run time. With `--strict`, expect the false warnings on paths of a volume loaded with `src=` (§3.5).

| Code | What it reports | Severity |
|---|---|---|
| `wcs/filter-unknown` | the 3.2 old filter names and `substr`, with the replacement | warning (the runtime throws) |
| `wcs/name-alias` | `$trackDependency`, `$untrackDependency` | error |
| `wcs/declaration-alias` | `$streams`, `$updatedCallback` | error |
| `wcs/scan-declaration-invalid` | `$scan` | error |
| `wcs/behavior-invalid` | `$behavior`: unknown key, non-boolean value, not an object, declared in a volume | error |
| `wcs/feature-unknown` | an unknown name in `$features` or in `features=` | error |
| `wcs/features-invalid` | `$features` not an array or in a volume (error); `features=` on a `<wcs-state>` that is not the document's root (warning) | error / warning |
| `wcs/volume-declaration` | `$stream`, `$watch`, `$listKeys`, `$renderedCallback` in a volume (error); `$commandTokens`, `$eventTokens`, `$on`, `$errorCallback` in a volume (warning) | error / warning |
| `wcs/template-syntax` | `outerHTML:` / `outerText:` inside `for:` / `if:` (error); `#direct` on a binding that is not an event binding (warning) | error / warning |
| `wcs/wildcard-rank` | another list's `*` inside a row (#1403); a pattern path, shorthand path or loop index outside any `for` | warning (the runtime throws) |
| `wcs/binding-syntax` | a `__proto__` / `prototype` path segment; filters on `for:` | error |
| `wcs/index-param-range` | `$129` and above inside a `for`; `this.$0`, `this.$129` in the script | error |
| `wcs/second-root` | a second root `<wcs-state>` in the document (the runtime refused it in 3.x too) | error |
| `wcs/bind-component-source` | `<wcs-state bind-component>` with `state` / `src` / `json` or an inline script (the runtime refused it in 3.x too) | error |

The lint does not see: `bootstrapXxx()` options, `#stop` and `stopPropagation()` around delegated handlers, moved elements, element writes used to reorder rows, `[data-wcs]` selectors, SSR post-processing, and uses of the removed `IStateElement` members.

### 4.2 Runtime messages

The sentences are what `@wcstack/state` and `/auto` print; without the diagnostics feature a message shows its code, number and values instead.

| Message | Number | § |
|---|---|---|
| `$scan was removed (use $watch or $on)` | #1 | 3.1 |
| `[wcs/declaration-alias] $streams was removed: write $stream.` | #1601 | 3.1 |
| `[wcs/name-alias] $trackDependency was removed: write $dependOn.` | #1701 | 3.1 |
| `[wcs/filter-unknown] filter not found: <name>.` (for an old name, followed by `"<name>" was renamed "<new name>" in 3.2 and removed in 4.0 — write "<new name>".`) | #501 | 3.1 |
| `bootstrapState: "<key>" is not one of its options, or not of the option's type.` (also with `$behavior:` and `state:` for the state's `$behavior`) | #44 | 3.2 |
| `a re-set state may not change $behavior: create the element again.` | #45 | 3.2 |
| `[@wcstack/<package>] bootstrapXxx: "<key>" is not one of its options, or not of the option's type.` | — | 3.2 |
| `[wcs/template-syntax] "outerHTML:" replaces its element, so it cannot be used inside a "for" / "if" template …` | #203 | 3.4 |
| `[wcs/binding-syntax] "for: items\|take(2)": "for:" takes no filters …` | #121 | 3.4 |
| `[wcs/wildcard-rank] "b.*.y" ranges over the rows of "b", but the enclosing "for" template at that level renders "a".` | #1403 | 3.4 |
| `[wcs/binding-syntax] "<path>": a state path cannot go through "__proto__" or "prototype" …` | #120 | 3.4 |
| `<wcs-state src="./state.js"> failed to initialize.` (`console.error`, followed by the error; names `state=`, `src=`, `mount=` and `bind-component=` when present) | #49 | 3.4 |
| `<wcs-state> $connectedCallback failed.` (`console.error`, followed by the error; once the bindings are built) | #50 | 3.4 |
| `<wcs-state mount="p">`: `$watch is not run in a volume — declare it on the root state.` (`console.error`) | — | 3.5 |
| `<wcs-state mount="p">`: `injections (data-wcs="state.<key>: …") are not supported — read the root path in a root getter.` (`console.error`) | — | 3.5 |
| `<wcs-state mount="p"> will not graft: its component is wired to its host.` (`console.error`) | — | 3.5 |
| `[wcs/mount-dollar-declaration] <tag>: $recursion is not run in a mounted component — declare it on the root state.` | — | 3.5 |
| `<wcs-ssr version="3.x.y"> does not match 4.0.0: its snapshot is discarded, and the page renders on the client from its own state.` (`console.warn`; for 3.x output, followed by `3.x output keeps only the path of a text binding outside a template, so such a binding loses its filters: deploy @wcstack/server 4.0 with this client.`) | — | 3.6 |
| `[wcs/feature-not-installed] <key> needs the add-on @wcstack/state/features/<name>` | — | 3.8 |
| `$features must be an array of add-on names (["temporal", "formats"]).` | #46 | 3.8 |
| `[wcs/feature-unknown] "<name>" is not an add-on (…).` | — | 3.8 |
| `[wcs/template-syntax] a "for:" template at the top of inserted content was not rendered, …` | #204 | 3.9 |

## 5. Known limitations of the preview *(not final)*

- **One object reachable from two rows.** When the same object sits at two positions of one list, a write below one of the rows (`this["items.0.name"] = "z"`) does not reach the other row's bindings and row getters; plain reads, root getters and `$getAll` see the new value. The same happens when one object is reachable from two lists, as in a TodoMVC-style filter: `get shown()` returning a filtered copy of `todos`, rendered with `for: shown`, while a checkbox writes the row. When the getter returns `todos` itself again, the rows it kept are shown again. 3.x has the same issue (#365). It is recorded as a known 4.0 limitation, and its scope is under review.
- **Numeric keys under a plain object** (`sales.2024.total`, `usersById.42.name`). Markup renders them, but in 4.0 a script read (`this["sales.2024.total"]`, also inside a getter) gives `undefined`, `$eq` on such a path is always false, a write throws `no row for "sales.*.total"`, and a two-way write-back fails. 3.x (since 3.4) still reads them as plain keys, and writes them that way through `$resolve` / `$setAll`. Until this is settled, read them as `this.sales[2024].total`, and write by assigning a new object to the top-level key (`this.sales = { ...this.sales, 2024: { ...this.sales[2024], total: 10 } }`), or use keys that are not numbers.
- **After a re-set**, `Object.keys(this)`, `in`, `delete` and `JSON.stringify(this)` still see the old state.
- **Markup errors and initialization**: see §3.4.
