# @wcstack/state 3.x → 4.0 migration guide

**日本語版**: [migration-v4.ja.md](./migration-v4.ja.md)

> **4.0 is out as a release candidate.** `4.0.0-rc.N` is published on npm's `next` tag — `npm i @wcstack/state@next`, and the same tag for every other `@wcstack/*` package — and 4.0.0 follows on `latest`. This guide describes 4.0 as the release candidate ships it. The 4.0 entry of the [CHANGELOG](../CHANGELOG.md) summarizes the changes (under `[Unreleased]` until 4.0.0 is published); §5 lists the known limitations.

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
- [ ] Replace volume injections with getters on the root state, and remove every `data-wcs` from volume elements (§3.5).
- [ ] Replace uses of `listPaths` / `getterPaths` / `setterPaths` / `nextVersion()` (§3.7).
- [ ] Import `defineState` from `@wcstack/state/define`, not from `@wcstack/state` (§3.7).
- [ ] Pages on `/core`: install `features/list-keys` if they use `$listKeys` (§3.8).
- [ ] Pages on `/core`: install `features/diagnostics` while developing (§3.8).
- [ ] Read the changes nothing reports: children of content-binding elements, `<noscript>` / `<iframe>`, comments in `<textarea>` / `<title>`, reads past the end of a list (§3.4); when `$watch` handlers fire — row watches without a `for:`, row getter watches, whole-array assignments, numeric-index keys, arrays several rows share (§3.4); post-processing of SSR output (§3.6); the extra child node in the router outlet (§3.9); the attributes 3.x wrote for a custom element's inputs (§3.4).
- [ ] Run `@wcstack/lint` 4.0 and fix what it reports (§4).

> **Comment bindings stay.** `<!--@@: path-->` and `<!--@@wcs-text: path-->` are still supported in 4.0. This is the form the lint recommends instead of `{{ }}` outside a `<template>`, to avoid a flash of unrendered text, and 4.0 binds it even when `enableMustache` is off. Only the `commentTextPrefix` option, which renamed the keyword, is gone. Details in §3.4.

## 1. Before you upgrade: move to 3.5 first

3.5 is the step before 4.0. It keeps the 3.x behaviour and warns, in the console and in the lint, about the forms 4.0 removes or changes. Everything you change in this section works on 3.5 and keeps working on 4.0. The `@wcstack/state` 3.5 README has a "Preparing for 4.0" section with the same list.

### 1.1 Pin the major version, then take 3.5

`https://esm.run/@wcstack/state/auto` follows the latest release, so it will load 4.0 on the day 4.0.0 is published (the release candidate on `next` does not reach it). Pin the major version until you have migrated; the pinned URL picks up 3.5:

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

- Move every `@wcstack/*` package to the same 4.0 version. While 4.0 is a release candidate, take it from the `next` tag (`npm i @wcstack/state@next @wcstack/router@next …`), or name the version (`4.0.0-rc.9`).
- Deploy `@wcstack/server` 4.0 and the 4.0 client together (§3.6).
- Update CDN URLs to the new major version (`https://esm.run/@wcstack/state@4/auto`). `@4` resolves once 4.0.0 is published; a range does not pick a release candidate, so name it while trying one (`https://esm.run/@wcstack/state@4.0.0-rc.9/auto`).
- `@wcstack/lint` and `@wcstack/typescript` move with every `@wcstack/*` release, so they carry the 4.0 rules from the release candidate on (`npx @wcstack/lint@next <files>`); the VS Code extension ships them as 2.0.0, together with 4.0.0. Keep the 3.5 ones (extension 1.21.x) for 3.x projects: the 4.0 rules report forms that 3.x still accepts.

**How 4.0 reports errors.** With the `diagnostics` feature, messages carry the same `[wcs/<code>]` codes as the lint and a sentence; without it, a number and the values:

```
[@wcstack/state] [wcs/filter-unknown] filter not found: uc.      ← @wcstack/state and /auto
[@wcstack/state] #501 "uc"                                        ← /core without features/diagnostics
```

The code and the sentence come from the `diagnostics` feature, which `@wcstack/state` and `/auto` include. A page on `/core` without it prints only the number and the values (3.x printed the full sentence either way); the hundreds of a number name its code (`#501` is `filter-unknown`). A number keeps its meaning across versions. The tables in §4 list the messages this guide mentions. Every number is listed in [state-errors.md](./state-errors.md).

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
| `$trackDependency` / `$untrackDependency` | throws when read (with `diagnostics`) | `[wcs/name-alias] $trackDependency was removed: write $dependOn.` (#1701) | `wcs/name-alias` (error) |
| `$updatedCallback` / `$streams` | throws when the state loads (with `diagnostics`) | `[wcs/declaration-alias] $streams was removed: write $stream.` (#1601) | `wcs/declaration-alias` (error) |
| `$scan` | throws when the state loads (with `diagnostics`) | `$scan was removed (use $watch or $on)` (#1) | `wcs/scan-declaration-invalid` (error) |

Without the `diagnostics` feature the runtime message for an old filter name or `substr` is only the number and the name, and does not name the replacement (§2). The other three rows are detected only by the `diagnostics` feature, which `@wcstack/state` and `/auto` include: on `/core` without it, `$scan`, `$streams` and `$updatedCallback` are ignored like any unknown `$` key, and `$trackDependency` / `$untrackDependency` read `undefined`. Install it while migrating a `/core` page, or rely on the lint, which reports all of them.

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

- Three boolean keys, each `true` by default, with the same meaning as the 3.x options. An unknown key, a value that is not a boolean, or a `$behavior` that is not an object throws `#44` — `null` and an array included, which 3.5 does not warn about.
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

How to find it: the 3.5 lint reports handlers of bubbling events that read `event.currentTarget` (`wcs/v4-migration`, info); the 4.0 lint reports the same handlers as `wcs/delegated-current-target` (warning) — an `on*:` of a delegated event, without `#direct`, whose handler reads `currentTarget` from its event argument before its first `await`. Neither can see `#stop` inside elements your own code listens on, `stopPropagation()` in page code, or elements you move between roots: look for those yourself. The 4.0 lint warns (`wcs/template-syntax`) when `#direct` is put on a binding that is not an event binding.

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

#### Markup errors stop initialization

A binding that cannot be read — a syntax error, an unknown filter or a wrong argument count, a wildcard-rank error, `for:` with filters, `outerHTML:` in a template — stops the walk there. At page level the `<wcs-state>` fails to initialize (`connectedCallbackPromise` rejects): what comes before the error in document order is bound and keeps following writes, what comes after it is not. An element that failed to initialize cannot be re-armed — `setInitialState()` on it throws (#14); remove it and create a new one. An error found while a binding is attached inside a `for:` / `if:` row (an undeclared token or wcBindable member, for example) goes to `$errorCallback` as that binding's failure, and the row is still built; at page level the same error fails initialization. 3.x reported a page-level error and failed only that binding. Run the 4.0 lint before you deploy: it reports these forms (§4.1). As in 3.5, a failed initialization is reported once with `console.error`, first the element and where its state comes from (`<wcs-state src="./state.js"> failed to initialize.`), then the error. A `$connectedCallback` that throws or rejects once the bindings are built is not an initialization failure: it is reported as `<wcs-state …> $connectedCallback failed.` followed by the error, `connectedCallbackPromise` rejects with it, and `getBindingsReady()` resolves, since the page is bound. A root's `$connectedCallback` that fails on a reconnect is reported the same way, and a root's `$disconnectedCallback` that throws or rejects as `<wcs-state …> $disconnectedCallback failed.` (#51), followed by the error; neither escapes the element's callback.

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

#### When `$watch` handlers fire

`$watch` handlers still run at the end of an update batch, with `cur`, `prev` and the row's indexes. What fires a handler on a row path changed:

- **A row watch needs neither a `for:` nor `$listKeys`.** `$watch: { "items.*.price"(cur, prev, i) { … } }` fires for a list that the page does not render: 4.0 keeps the lists a row watch ranges over in step by itself. In 3.x, with neither a `for:` binding nor `$listKeys`, assigning the list fired such a watch zero times.
- **A row getter watch is evaluated eagerly.** A watch on a wildcard getter (`get "items.*.total"()`) evaluates the getter for every row when the watch starts, and again for a row when something it read changes, whether or not a binding shows it; `prev` is that row's previous value. In 3.x such a watch fired only where the getter was also bound to the DOM, and `prev` was always `undefined`. The getter now runs for every row of the list: keep a watched row getter cheap and free of side effects.
- **Assigning a whole array fires only the rows that came in.** Rows are matched to the new array's elements by identity: a row watch fires for the elements that were not in the list before (`prev` `undefined`), not for the rows the assignment kept (a re-sort fires no data row watch). A kept row's getter watch (`items.*.label`) fires only when its value changed, unless a write in the same batch changed something the getter read outside its row — `now`, `items.length`, or a root getter that reads them (`get count() { return this.items.length }`) — or wrote the same path in another row (`items.0.due`) (#389). In 3.x, assigning a whole array to a rendered list fired a data row watch (`items.*.price`) for every row, with `prev` `undefined`, unless `$listKeys` was declared, and 3.5.1 fired a row getter watch on every kept row whose getter was bound to the DOM, changed or not. With `$listKeys`, a refetched array still writes only the changed fields into the kept rows, and those writes fire, as in 3.x.
- **A numeric index in the key** (`"items.0.v"`) fires only when the value at that index changes. 3.x (since 3.4) fires it on a write through the index, on an element replacement, and on a write to any row of the list, possibly with an unchanged value.
- **An array several outer rows share.** Writing one of its elements fires `$watch("groups.*.items.*")` once for every outer row that holds it, each with its own indexes: the value changed at every one of those paths. 3.x fired it once, at the position written.

#### Smaller differences

- Writing a top-level key that the state does not have creates it (3.x failed the write). Reading one still throws `[wcs/binding-path-missing]`.
- A re-set (`setInitialState()` on an initialized element) whose new state lacks a top-level key the old state had empties the bindings to it, renders no rows for a list under it, and gives a getter that reads it `undefined`, until the key is written — as a deeper path the new state lacks already did. 3.x reported those bindings and that list as failures and left the old text and rows on the page. The new state object is not written to (a frozen state can be re-set). A getter on a class state's prototype that the new state drops is emptied the same way.
- A path that goes through `__proto__` or `prototype` throws `[wcs/binding-syntax] #120`: in bindings, writes, `$resolve`, `$setAll`, and reads such as `this.__proto__`.
- `state="id"` reads only a `<script type="application/json">` with that id.
- When a chain of `$watch` handlers and `$stream` restarts goes past its limit (writes more than 32 deep, as in 3.x), only the handlers and restarts those writes fired are skipped; the batch's other handlers still run. 3.x skipped the whole batch. A restart's writes also count toward the render chain (100 drains): element write-backs that restart a stream a microtask apart are cut after about 50 (100 without the stream).
- What a `$stream` run writes in the same task as its (re)start (synchronously or in a microtask) — a value its source yields, its status `done` / `error` — continues that run's chain: when it reaches another stream's `args`, that stream restarts one link deeper, and a `$watch` handler it fires runs one link deeper. Two streams that read each other's values, and a `$watch` on a stream's value that moves what the stream's `args` reads, are therefore cut instead of freezing the page when the source yields at once — the latter after about 16 laps (the handler and the restart are two links), whether the loop would end or not: auto-paging driven by such a source stops there too (3.x froze on the endless loop, without a report, and completed a finite one). A value from a later task, and the `$watch` handlers it fires, start afresh.
- A write below a row re-evaluates the getters whose array holds that object (a filter, a sort): a checked row leaves an "active" filter, a renamed row moves in a sorted view. A getter whose array does not hold the object is not re-evaluated — it read the array, not the object; read `$getAll("todos.*.done")` in it to follow every row. 3.x re-evaluated neither, and the write did not reach the other array's rows (§5).
- An index past the end of a list: a write (`this["items.5.v"] = 1`, `$resolve("items.*.v", [5], 1)`) throws `no row for "items.*.v"` and changes nothing, and a read returns `undefined`. 3.x threw `ListIndex not found` on both.
- State writes a custom element's wc-bindable input to its **property only**. 3.x then also wrote the value to the attribute the input's `attribute` hint names (`String(value)`, JSON for an object, `null` removed it). The protocol defines that hint as a declaration for tooling — reflecting a property to its attribute is the element's job, in its setter — and the binder's copy fought the element's own: a `false` written as `"false"` turned on the I/O nodes that read the attribute by its presence (`<wcs-wakelock active>`, `<wcs-camera keep-alive>`, the `manual` of the I/O nodes), and an attribute the element changed itself stayed stale. Every wcstack element reflects in its setter, so nothing changes for them. An element of your own that has no setter, or reads the input only from the attribute (`attributeChangedCallback`), needs a setter that reflects it; CSS and code that matched an attribute value state wrote (`[active="false"]`) now see the element's own encoding.

### 3.5 Volumes and mounted components

#### Volumes (`<wcs-state mount="p">`)

| In a volume | 3.x | 4.0 |
|---|---|---|
| `$watch`, `$listKeys`, `$renderedCallback` | run, relative to `p` | refused: the volume is not grafted, `console.error` |
| `$stream`, `$scan`, `$recursion` | refused | refused |
| `$behavior`, `$features` | — | refused |
| `$commandTokens`, `$eventTokens`, `$on`, `$errorCallback` | not run, warning | not run, `console.warn` |
| An injection on the volume element (`data-wcs="state.taxRate: settings.taxRate"`, 3.1) | supported | refused: the volume is not grafted, `console.error` |
| Any other `data-wcs` on the volume element (`data-wcs="class.ready: loaded"`) | — | refused as an injection, the same way: any `data-wcs` attribute on a `<wcs-state mount>` counts |
| A mount path the root state already has (`mount="cart"` with a root key `cart`) | not grafted: a collision error, reported with `console.error` as `volume "cart" failed to graft.` | not grafted: `console.error` with `will not graft: the root state already has "cart".` |
| Changing `mount` after the volume initialized | ignored, with a `console.warn` | ignored, without a message (the element does not observe the attribute) |
| The volume's methods | not on the tree | reachable by path (`onclick: p.method`, `this["p.method"]`) |

The messages read `$watch is not run in a volume — declare it on the root state.` and `injections (data-wcs="state.<key>: …") are not supported — read the root path in a root getter.`, after `[@wcstack/state] <wcs-state mount="p">`. A refused volume still resolves its `connectedCallbackPromise`. To move a volume to another path, remove the element and add a new one with the new `mount`; to bind something to the volume element itself, wrap it in an element of your own.

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

- **Deploy `@wcstack/server` 4.0 and the 4.0 client together.** A 4.0 client cannot hydrate the output of a 3.x `@wcstack/server`, which renders with `@wcstack/state` 3.x (or of any other major.minor). It warns — `<wcs-ssr version="3.5.0"> does not match 4.0.0: its snapshot is discarded, and the page renders on the client from its own state.` — and renders the page on the client as if there were no server: the server's snapshot is not used, the state loads from its own source (`json=`, `src=`, the inline script, `setInitialState()`), `$connectedCallback` runs on the client, and the server's rows, branches and markers give way to the templates they were rendered from. In a Light DOM component wired from the page (`data-wcs="state: user"`, `state.label: user.name`), 3.x wrote the paths as the page's (`user.name`); they are mapped back through the host's wiring (from 3.5.3, a text binding's markers hold the component's own expression instead, which is read as it is). The page works, but what the server did is done again on the client (and data that `$connectedCallback` fetches is fetched again).
- One thing does not come back from the output of a 3.x server up to 3.5.2: a text binding outside the templates — a `{{ }}` or `<!--@@: -->` at page level or in a Light DOM component's content — loses its filters, because those markers keep only its path (`{{ price|toFixed(2) }}` shows the unformatted value). The warning says so for such output. Inside `for:` / `if:` templates the expressions are kept whole. From 3.5.3 (wcstack#373) the markers hold the binding's whole expression, filters included, and the warning leaves that sentence out: upgrading the 3.x server (`@wcstack/server` and `@wcstack/state`) to 3.5.3 or later — 3.5.4 or later, given the case below — before the switch avoids the loss (the 4.0 client tells the two formats apart by `<wcs-ssr version>`; a prerelease counts as earlier). One case remains: an expression that an HTML comment cannot hold (one with `--` in it, such as `|defaults('--')`) is written as its path alone, so that binding loses its filters too. From 3.5.4 (wcstack#427) that is all it loses: in a Light DOM component the path is the component's own, and the value shows, unfiltered. Only the output of a 3.5.3 server goes further, as 3.5.3 writes the page's path there: a key private to the component is mapped back, but a wired key is read as one of the component's own: if the component has a key of that name, the text shows that key's value (the right value only when the wiring keeps the name, as in `state.price: price`), otherwise it stays empty until a 3.5.4 or 4.0 server renders the page. Keep `--` out of such expressions while a 3.x server renders. When you switch, purge the HTML rendered by 3.x, such as pages cached before the upgrade.
- The opposite combination, a 4.0 server with a 3.x client, is not supported. The 3.x client warns that it falls back to a full render (`SSR version mismatch: server="4.0.0", client="3.5.0". Falling back to full render.`), but it does not read 4.0's markers. Only the `data-wcs` attribute bindings outside templates follow state changes; text bindings, rows and branches stay as the server's HTML.
- If `@wcstack/state` 4.0 renders under an older `@wcstack/server` (for example through an npm override), the output can lack `<wcs-ssr>` entirely; the page then stays as the server's HTML, with no warning. Use the `@wcstack/server` released with 4.0.
- The `@wcstack/server` API (`renderToString()`) does not change. The format of its output does: do not post-process the output based on 3.x's markers.
- Keep the comments in the output. Text bindings and the row and branch markers are comments: removing them in a later minification step (html-minifier's `removeComments` and the like) breaks hydration, and `{{ }}` inside values may be read as bindings on the client.
- As in 3.x, form values go into the server's HTML where they differ from the markup: an input's `value` and `checked` attributes, `selected` on the options a select has selected, a textarea's text. Three differences: a password's value is left out, a select's `value:` marks its option (3.x wrote a `value` attribute on the `<select>`), and a textarea whose value contains `{{` is left to the client.
- `outerHTML:` / `outerText:` are applied on the client, not on the server. The server output contains the element as written, so the value is not in the HTML that search engines or no-JS views see.
- Children that a Light DOM custom element bound at page level renders from a value are not in the server output; the client renders them. Children you wrote stay in it.
- As in 3.x (since 3.4.0), hydration adopts the server's rows and branches where they are: a custom element in them is connected once, when the page is parsed, and is never disconnected and connected again. The `<tr>` rows of a `<table>` written without `<tbody>` stay in the `<tbody>` the browser's parser adds. A server row that no longer matches its template (a Light DOM element that added children before a bound node) is rendered again in its place, and the rows around it stay. The new row is in the page before its bindings are applied (like an adopted row, and unlike a client-only render, which binds a row before inserting it), so a custom element in it connects before its bound values arrive. Rows and branches the client does not render (fewer rows, another branch) are removed as soon as the page is bound.
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
| `@wcstack/state/manifest` | the old-name tables are empty (`builtinFilterAliases` is `{}`); `$scan` is no longer reserved; `$behavior` and `$features` are reserved; new `behaviorOptions`, `features` and `nativeCommands` (what a native element's `command.<method>:` may call) |
| `defineState` types | without `$trackDependency` / `$untrackDependency` |
| `import { defineState } from "@wcstack/state"` alone, through a bundler | keeps the engine: about 21 KB gzip (3.x tree-shook it down to `defineState`). Import it from `@wcstack/state/define` (69 B, no runtime) |
| `installFeatures()` | skips a feature it already installed (3.x called `install()` again; both are idempotent) |
| `@wcstack/state` | also exports the type `IStateElement` |

A state file that only needs the types should import `defineState` from `@wcstack/state/define`, which carries the identity function and the types and nothing else:

```ts
// 4.0: keeps the state file free of the engine
import { defineState } from "@wcstack/state/define";
```

A bundler cannot drop the 4.0 engine's modules from the `@wcstack/state` entry, so importing only `defineState` from it keeps the whole engine (about 21 KB gzip). That costs nothing in a bundle that runs the engine anyway; it matters where the state file is bundled without it — a page that loads the runtime from a CDN, a build that only type-checks or tests the state.

### 3.8 Split entries and features

- **`$listKeys` moved out of the core** into a new feature, `@wcstack/state/features/list-keys`. `@wcstack/state` and `/auto` include it. A `/core` page that uses `$listKeys` must install it; otherwise the state fails with `[wcs/feature-not-installed] $listKeys needs the add-on @wcstack/state/features/list-keys`.
- `features/temporal` serves `$watch` and `$stream` (`$scan` is gone).
- **`/core` carries the 10 condition filters** — `eq`, `ne`, `not`, `lt`, `le`, `gt`, `ge`, `truthy`, `falsy`, `boolean`. The 3.x `/core` answered only `not`, and every other filter needed `features/formats`; the others still do. `features/formats` holds 37: arithmetic (`add`, `sub`, `mul`, `div`, `mod`, `abs`, `clamp`), conversion (`int`, `float`, `number`, `string`), defaults (`defaults`, `coalesce`, `nullIfEmpty`) and the formatting filters (`upper`, `date`, `round`, `truncate`, …). One of them on a page without it fails with `[wcs/filter-unknown]`, naming the add-on. (4.0.0-rc.1 to rc.3 carried the arithmetic, conversion and defaults filters in `/core` too; a `/core` page that dropped `features/formats` for them installs it again.)
- On `/core` without `features/diagnostics`, a message is a number and the values (§2), and the 3.x names 4.0 removed are not detected (§3.1). Install `diagnostics` while developing.
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
- The names are `formats`, `diagnostics`, `temporal`, `list-keys`, `scopes`, `recursion`, `ssr`, `devtools` and `native-commands`. Any other name in `features=` makes the split auto entry fail with `[wcs/feature-unknown]` before it defines `<wcs-state>`. In `$features`, it fails that state with `[wcs/feature-unknown]` on the split auto entry and with `[wcs/feature-not-installed]` on the other entries.
- **Native element commands**, the `native-commands` feature (`@wcstack/state` and `/auto` include it): `command.<method>:` on a native element — `<dialog data-wcs="command.showModal: $command.open">`, `focus` on an `<input>`, `play` on a `<video>` — from a fixed table of methods. 3.x refused a native element (`command binding requires a wc-bindable custom element`). See the [README](../packages/state/README.md#native-element-commands).

### 3.9 Other packages

- **`@wcstack/router` 3.5 and later** (you get these on the way, with 3.5)
  - Shown route content now ends with a comment, `<!--@@wcs-route-end:/path-->` (the text of the SSR end marker), so the outlet has one more child node. `:empty` is unaffected.
  - Leaving a route takes out everything from the route's start to that marker — including rows and branches that `@wcstack/state` rendered there and nodes your code inserted — and entering puts it back. The router up to 3.4.0 moved only the route's original nodes and left the rest in the outlet. What comes back is what was taken out: a top-level node your code removed from the route body stays removed on the next entry. Showing the route that is already shown (a parameter change) takes its content out and puts it back in order, so its custom elements reconnect once and see the new parameters, nested routes included (the router up to 3.4.0 re-inserted the original nodes one by one, which reordered them, and reconnected a nested route wrapped in an element twice, first with the old parameter).
  - `for:` / `if:` templates placed directly under `<wcs-route>` render when the route is entered by navigation, with `@wcstack/state` 4.0. So do those at the top of a `<wcs-layout>` template (the layout outlet hands its content over the same way; not with `enable-shadow-root`, whose shadow root the page's state does not bind), on the landing route and on navigation, and their rows or branch leave and come back with the route. With the router up to 3.4.0, inside `<wcs-head>`, or when other code inserts the content, 4.0 does not render them and reports `[wcs/template-syntax] #204` on the console; 3.x never rendered them. Wrapped in an element, they render in every combination.
  - Route content inside a `<wcs-layout>`, and the layout template's own bindings, are bound on the first navigation into it too (the router up to 3.4.0 left them unbound when the route was entered by navigation, and a `for:` inside never rendered, even on later visits).
  - Unchanged: text `{{ }}` placed directly in a route body or a layout template, not inside an element, is not bound when the route is entered by navigation. Wrap it in an element.
- **`@wcstack/server`**: §3.6.
- **`@wcstack/autoloader` and the I/O node packages**: the `bootstrapXxx()` options rule and `scanImportmap` (§3.2).
- **The I/O node packages: `null` and `undefined` written to an input.** `null` removes the input's attribute (its documented default) and `undefined` restores the attribute the element started with — the value written in the markup, or none (wc-bindable 0.10's producer guidance for inputs). 3.x wrote most values with `String(value)`, so `null` / `undefined` became the attributes `"null"` / `"undefined"` (`<wcs-sse>` / `<wcs-ws>` / `<wcs-worker>` opened `undefined`, a `target` selector stopped observing), and a boolean dropped the attribute written in the markup. `@wcstack/state` never writes `undefined`, so a page bound with it sees a difference only where it writes `null`: a boolean that is on by default (`<wcs-audio>`'s `limiter` and `resumeOnGesture`, `<wcs-debounce>`'s `trailing`, `<wcs-throttle>`'s `leading`) goes back on instead of off. `<wcs-storage>`'s `value = undefined` keeps the stored entry (3.x removed it). Each package's README says what its inputs do with both.
- **`wcstack/auto`** bundles `@wcstack/state`, the router, fetch, storage and the autoloader, so it brings all of the above.
- **`@wcstack/devtools`**: works unchanged (hook protocol v2). `state:render-chain-limit` is also sent when one update does not settle within 32 passes (`maxDepth: 32`). Its coverage view shows a row `$watch` without a `for:` or `$listKeys` as `never` until it fires, not `prerequisite-missing`: that prerequisite was 3.x's (§3.4).
- **The binder protocol**: `bind(subtree, options?)` gains an optional second argument. Code that inserts content and later moves it in and out as one block passes `{ range: true }` (the router 3.5 and later does, for route content and for a layout's content), and only then are `for:` / `if:` templates at the top of the inserted content rendered. This matters only if you call the binder yourself.
- **The [wcstack-app skill](https://github.com/wcstack/wcstack-skill)** is updated separately for 4.0.

## 4. Finding affected code

Before upgrading, the 3.5 console warnings and the 3.5 lint (§1.2, §1.3) find most of the forms in §1. After upgrading, use the 4.0 lint and the runtime messages below.

### 4.1 The 4.0 lint

Run `npx @wcstack/lint@4 <files>` — `@next` while 4.0 is a release candidate (the VS Code extension 2.0 shows the same codes). The 4.0 lint has no `wcs/v4-migration`: what 3.5 pointed out as info is an error or a warning of its own code there, because 4.0 breaks on it. `--strict` also fails CI on warnings, which helps because two of the warnings below throw at run time. With `--strict`, expect the false warnings on paths of a volume loaded with `src=` (§3.5).

| Code | What it reports | Severity |
|---|---|---|
| `wcs/filter-unknown` | the 3.2 old filter names and `substr`, with the replacement | warning (the runtime throws) |
| `wcs/name-alias` | `$trackDependency`, `$untrackDependency` | error |
| `wcs/declaration-alias` | `$streams`, `$updatedCallback` | error |
| `wcs/scan-declaration-invalid` | `$scan` | error |
| `wcs/behavior-invalid` | `$behavior`: unknown key, non-boolean value, not an object (`null` and an array included), declared in a volume | error |
| `wcs/feature-unknown` | an unknown name in `$features` or in `features=` | error |
| `wcs/features-invalid` | `$features` not an array or in a volume (error); `features=` on a `<wcs-state>` that is not the document's root (warning) | error / warning |
| `wcs/volume-declaration` | `$stream`, `$watch`, `$listKeys`, `$renderedCallback` in a volume (error); `$commandTokens`, `$eventTokens`, `$on`, `$errorCallback` in a volume (warning) | error / warning |
| `wcs/template-syntax` | `outerHTML:` / `outerText:` inside `for:` / `if:` (error); `#direct` on a binding that is not an event binding (warning) | error / warning |
| `wcs/delegated-current-target` | an `on*:` handler of a delegated event, without `#direct`, that reads `event.currentTarget` (the root in 4.0, §3.3) — 3.5 reported it as `wcs/v4-migration` | warning |
| `wcs/wildcard-rank` | another list's `*` inside a row (#1403); a pattern path, shorthand path or loop index outside any `for` | warning (the runtime throws) |
| `wcs/binding-syntax` | a `__proto__` / `prototype` path segment; filters on `for:` | error |
| `wcs/index-param-range` | `$129` and above inside a `for`; `this.$0`, `this.$129` in the script | error |
| `wcs/second-root` | a second root `<wcs-state>` in the document (the runtime refused it in 3.x too) | error |
| `wcs/bind-component-source` | `<wcs-state bind-component>` with `state` / `src` / `json` or an inline script (the runtime refused it in 3.x too) | error |

The lint does not see: `bootstrapXxx()` options, `#stop` and `stopPropagation()` around delegated handlers, moved elements, element writes used to reorder rows, `[data-wcs]` selectors, SSR post-processing, custom elements that relied on state writing their input attributes, and uses of the removed `IStateElement` members.

### 4.2 Runtime messages

The sentences are what `@wcstack/state` and `/auto` print; without the diagnostics feature a message shows its number and values instead.

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
| `<wcs-state> $connectedCallback failed.` (`console.error`, followed by the error; once the bindings are built, and on a reconnect) | #50 | 3.4 |
| `<wcs-state> $disconnectedCallback failed.` (`console.error`, followed by the error; a root's `$disconnectedCallback` that throws or rejects) | #51 | 3.4 |
| `<wcs-state mount="p">`: `$watch is not run in a volume — declare it on the root state.` (`console.error`) | — | 3.5 |
| `<wcs-state mount="p">`: `injections (data-wcs="state.<key>: …") are not supported — read the root path in a root getter.` (`console.error`) | — | 3.5 |
| `<wcs-state mount="p"> will not graft: its component is wired to its host.` (`console.error`) | — | 3.5 |
| `[wcs/mount-dollar-declaration] <tag>: $recursion is not run in a mounted component — declare it on the root state.` | — | 3.5 |
| `<wcs-ssr version="3.x.y"> does not match 4.0.0: its snapshot is discarded, and the page renders on the client from its own state.` (`console.warn`; for the output of 3.x up to 3.5.2, followed by `3.x output keeps only the path of a text binding outside a template, so such a binding loses its filters: deploy @wcstack/server 4.0 with this client.`) | — | 3.6 |
| `[wcs/feature-not-installed] <key> needs the add-on @wcstack/state/features/<name>` | — | 3.8 |
| `$features must be an array of add-on names (["temporal", "formats"]).` | #46 | 3.8 |
| `[wcs/feature-unknown] "<name>" is not an add-on (…).` | — | 3.8 |
| `[wcs/template-syntax] a "for:" template at the top of inserted content was not rendered, …` | #204 | 3.9 |

## 5. Known limitations

The case below is known in 4.0 and is to be fixed in 4.0.x. It comes with a way around it.

- **One object at two positions of one list, or in two arrays no getter relates.** When the same object sits at two positions of one list, a write below one of the rows (`this["items.0.name"] = "z"`) does not reach the other row's bindings and row getters; plain reads, root getters and `$getAll` see the new value. The same holds for two arrays at plain keys that share an object (`backup = items; items = items.filter(…)`, both rendered): a write below a row of one does not reach the other's row. Call `this.$postUpdate("items")` after such a write, or replace the changed item instead of writing below it (`this.items = this.items.map((x) => x === o ? { ...x, name: "z" } : x)`). When a getter relates the arrays — a TodoMVC-style filter (`get shown()` returning a filtered copy of `todos`, rendered with `for: shown`), a sort, a slice — a write from either side reaches every row holding the object, the `todos.*` readers and the filter itself. 3.x has the issue in every form (#365).
