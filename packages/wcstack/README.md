# wcstack

**wcstack** is a set of 48 zero-dependency Web Components packages: reactive data binding, declarative SPA routing, and 30+ Web APIs exposed as HTML tags. No build step, no bundler, no framework runtime. One CDN `<script>` tag per package — or one `wcstack/auto` tag for the whole SPA core.

Project site: **https://wcstack.github.io** · Source: **https://github.com/wcstack/wcstack**

---

## Read this first if you are an AI coding agent

This file is a complete, self-contained guide to writing a correct wcstack app. Read it top to bottom, then **verify what you wrote**:

```bash
npx @wcstack/lint index.html    # exit 0 = no error-severity finding. Iterate until it exits 0.
```

Exit `0` does **not** mean the file is clean: warnings and info diagnostics are printed and still exit `0`. Read what it printed, or add `--strict` to make warnings fail too.

Do not guess at syntax that is not documented here. wcstack has little presence in training data, so invented syntax will look plausible and be wrong. Two rules cover most failures:

- **Filters transform values. They never attach to event handlers.**
- **State must be reassigned, not mutated in place.**

Both are spelled out under [What does not work](#what-does-not-work).

This guide describes **`@wcstack/state` 4.0** and the packages released with it. Upgrading an existing 3.x app: read the [3.x → 4.0 migration guide](https://github.com/wcstack/wcstack/blob/main/docs/migration-v4.md) instead.

---

## Loading wcstack — single packages, or this package's SPA-core bundle

wcstack is buildless — load what you need from a CDN. The default is one tag per package, paying only for what the page uses:

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/router/auto"></script>
<script type="module" src="https://esm.run/@wcstack/fetch/auto"></script>
```

Each `/auto` script registers its custom elements and does nothing else. No initialization call, no bootstrap. Tags activate when the browser parses them. The tags fetch in parallel (every `/auto` is self-contained), so multiple tags cost requests, not a waterfall.

For an app that uses the SPA core anyway, **this package ships the bundle**: `wcstack/auto` is `@wcstack/state` + `@wcstack/router` + `@wcstack/fetch` + `@wcstack/storage` + `@wcstack/autoloader` pre-linked by Rollup into one self-contained file (218 KB min / 70 KB gzip as of 4.0) — one request, and in production one `integrity` hash covering every line of the core that runs (digests ship with each GitHub Release; see `docs/sri.md`):

```html
<script type="module"
        src="https://cdn.jsdelivr.net/npm/wcstack@3.5.4/dist/auto.min.js"
        integrity="sha384-…"></script>
```

Loading the bundle alongside an individual package's `/auto` is safe: whichever copy evaluates first owns the page; the second is inert. Do **not** merge the files yourself through jsDelivr's `/combine/` endpoint — concatenated minified ESM does not even parse (`docs/sri.md` §3.1).

If you want npm packages for local development, install the individual ones (`@wcstack/state`, `@wcstack/router`, …); this package publishes only the bundle and this guide.

`@wcstack/state` also ships **split entries** for a page that deliberately leaves features out. The full-package `/auto` above includes every feature, needs none of this, and stays the default. The features are `temporal` (`$watch` / `$stream`), `list-keys` (`$listKeys`), `native-commands` (`command.<method>:` on native elements — `showModal` on a `<dialog>`, `focus` on an `<input>`), `scopes` (`bind-component`, `mount=`, DCC), `recursion` (`$recursion`), `ssr` (`enable-ssr`), `formats` (every filter but the 10 conditions: arithmetic, conversion, defaults and the formatting filters), `diagnostics` (full message sentences and development warnings) and `devtools`. A declaration whose feature is missing throws `[wcs/feature-not-installed]`. Two ways to load them:

- **The split auto entry**, one tag and no import map. `features="…"` on the document's root `<wcs-state>` names what must be there before any `<wcs-state>` starts (`scopes`) and the development aids (`diagnostics`, `devtools`); each state's `$features` names what it needs (`$features: ["temporal", "formats"]`), loaded before that state is built. An unknown name fails with `[wcs/feature-unknown]`.

  ```html
  <script type="module" src="https://cdn.jsdelivr.net/npm/@wcstack/state@<version>/dist/split/auto.js"></script>
  <wcs-state features="scopes diagnostics">…</wcs-state>
  ```

- **A bundler or an import map**: import `bootstrapState` and `installFeatures` from `@wcstack/state/core`, then call `installFeatures([...])` with the features from `@wcstack/state/features/<name>` **before** `bootstrapState()`.

Load the split files from jsDelivr's plain, version-pinned `/npm/…/dist/split/` paths or a bundler — **never `esm.run`**, which re-bundles a separate engine into each entry and breaks the split auto entry's relative loads. See `npm view @wcstack/state readme`.

---

## A complete working app

This is a full todo app. Save it as `index.html` and open it in a browser — nothing else is required.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Todo</title>
  <script type="module" src="https://esm.run/@wcstack/state/auto"></script>
  <style>
    .done { text-decoration: line-through; color: #999; }
  </style>
</head>
<body>

<wcs-state>
  <script type="module">
    export default {
      // ---- data ----
      todos: [
        { id: 1, text: "Read the guide", done: false }
      ],
      nextId: 2,
      draft: "",
      filter: "all",

      // ---- computed: plain getters, recalculated automatically ----
      get visible() {
        if (this.filter === "active") return this.todos.filter(t => !t.done);
        if (this.filter === "done")   return this.todos.filter(t => t.done);
        return this.todos;
      },
      get remaining() {
        return this.todos.filter(t => !t.done).length;
      },
      get isEmpty() {
        return this.todos.length === 0;
      },

      // ---- methods: always REASSIGN, never mutate ----
      add() {
        const text = this.draft.trim();
        if (!text) return;
        this.todos = [...this.todos, { id: this.nextId, text, done: false }];
        this.nextId = this.nextId + 1;
        this.draft = "";
      },
      toggle() {
        // Inside a `for:` loop, the current row is readable by wildcard path.
        const id = this["visible.*.id"];
        this.todos = this.todos.map(t => t.id === id ? { ...t, done: !t.done } : t);
      },
      remove() {
        const id = this["visible.*.id"];
        this.todos = this.todos.filter(t => t.id !== id);
      },
      showAll()    { this.filter = "all"; },
      showActive() { this.filter = "active"; },
      showDone()   { this.filter = "done"; }
    };
  </script>
</wcs-state>

<form data-wcs="onsubmit#prevent: add">
  <input data-wcs="value: draft" placeholder="What needs doing?">
  <button type="submit">Add</button>
</form>

<ul>
  <template data-wcs="for: visible">
    <li>
      <input type="checkbox" data-wcs="checked#ro: .done; onchange: toggle">
      <span data-wcs="textContent: .text; class.done: .done"></span>
      <button type="button" data-wcs="onclick: remove">x</button>
    </li>
  </template>
</ul>

<template data-wcs="if: isEmpty">
  <p>Nothing yet.</p>
</template>

<p><span data-wcs="textContent: remaining"></span> remaining</p>

<button type="button" data-wcs="onclick: showAll">All</button>
<button type="button" data-wcs="onclick: showActive">Active</button>
<button type="button" data-wcs="onclick: showDone">Done</button>

</body>
</html>
```

Note `checked#ro:` on the checkbox. Without `#ro`, the two-way binding writes `.done` back on `input`, and the `onchange` handler flips it again — a double toggle that nets to nothing. When a handler is the single writer, mark the reflection read-only.

---

## Binding syntax

State and UI are connected by **path strings only**. There are no hooks, selectors, or per-element binding objects.

```
property[#modifier]: path[|filter[|filter(args)]...]
```

Multiple bindings are separated by `;`:

```html
<div data-wcs="textContent: count; class.over: count|gt(10)"></div>
```

### Properties

| Property | Meaning |
|---|---|
| `value` | Element value (two-way on inputs) |
| `checked` | Checkbox / radio state (two-way) |
| `textContent` / `text` | Text content |
| `html` | innerHTML |
| `class.NAME` | Toggle one CSS class |
| `style.PROP` | Set one style property |
| `attr.NAME` | Set an attribute (SVG-aware) |
| `radio` | Radio group (two-way) |
| `checkbox` | Checkbox group bound to an array (two-way) |
| `onclick`, `on*` | Event handler (common bubbling events are delegated to the root — see [Event handlers](#event-handlers)) |
| `.NAME` | Explicit property (3.1) — the same binding as `NAME:`, except it is never an event |

**A property whose name starts with `on` needs the dotted form (3.1).** `online: x` is parsed as an event binding: it listens for a `"line"` event and **never writes the element's `online` property**. Put a dot in front to bind the property itself:

```html
<my-status data-wcs=".online: isOnline; onclick: refresh"></my-status>
```

`.value:` stays two-way like `value:`, and modifiers and filters work as usual. A namespace word after the dot (`.class`, `.attr`, `.style`, `.command`, `.eventToken`) or an empty name is rejected with `[wcs/binding-syntax]`.

### Modifiers

| Modifier | Meaning |
|---|---|
| `#ro` | Read-only — disables the two-way write-back |
| `#prevent` | `event.preventDefault()` on handlers |
| `#stop` | `event.stopPropagation()` on handlers |
| `#direct` | On an `on*:` binding only: listen on the element itself instead of delegating to the root (see [Event handlers](#event-handlers)) |
| `#onchange` | Use `change` instead of `input` for two-way binding |
| `#init=<authority>` | Who wins the **initial** sync: `element` (the element's own value seeds the state — use with `<wcs-storage>` and monitors), `state`, `auto`, `none`. Without it the default comes from the member's `wcBindable` declaration |
| `#sync=<timing>` | When an element-authority binding reads the element: `call` (default — when the binding attaches) or `connect` (once the element is in the document) |

Combine after one `#`, comma separated: `value#ro,init=none: path`, `value#init=element,sync=connect: path`, `onclick#direct,stop: save`. A second `#` is a parse error.

### Paths

| Form | Meaning |
|---|---|
| `count`, `user.name` | Plain property path |
| `items.*.price` | Wildcard — the current row inside a `for:` loop |
| `.price` | Shorthand for the current row's property inside a loop |
| `cart.path` | Read a mounted volume (`<wcs-state mount="cart">`) by its path prefix — one tree per root, extended by mounts (`name=` / `path@name` were removed in v2) |

### Splitting state across files (`mount=`)

A second `<wcs-state mount="cart" src="./cart.js">` grafts its module onto the root tree at `cart`; the page then reads `cart.total`, and calls the volume's methods by path too (`onclick: cart.add`). A volume holds data, getters, methods and its own `$connectedCallback` / `$disconnectedCallback`, with `this` rooted at its mount path — nothing else:

- **It cannot read root paths.** There is no injection on the volume element (`data-wcs="state.taxRate: …"` is refused). A value that combines both belongs in a root getter, written with full paths:

  ```javascript
  // root state
  get cartTotalWithTax() { return this["cart.subtotal"] * (1 + this["settings.taxRate"]); }
  ```

- **Declarations go on the root state**, with full paths (`$watch: { "cart.total"(cur) { … } }`). A volume that declares `$watch`, `$listKeys`, `$renderedCallback`, `$stream`, `$recursion`, `$behavior` or `$features`, or carries an injection, is not grafted (`console.error` says why). `$commandTokens`, `$eventTokens`, `$on` and `$errorCallback` in a volume are ignored with a `console.warn`.
- The root's `$renderedCallback(paths)` receives the whole tree's paths (`cart.items.*.name`); filter them by prefix.

### Structural directives

Always on a `<template>` element:

```html
<template data-wcs="for: items"> ... </template>
<template data-wcs="if: isReady"> ... </template>
<template data-wcs="elseif: isLoading"> ... </template>
<template data-wcs="else:"> ... </template>
```

- **`for:` takes no filters.** `for: items|take(2)` fails initialization with `[wcs/binding-syntax]` #121. Declare a getter that returns the list to show (`get firstTwo() { return this.items.slice(0, 2); }`) and loop over it (`for: firstTwo`).
- **`outerHTML:` / `outerText:` cannot be used inside `for:` / `if:` templates** (`[wcs/template-syntax]` #203): a row or branch keeps its nodes by position. Bind `innerHTML:` on a wrapper element instead.
- **Inside a row, a `*` means the row of the `for:` around it.** `{{ b.*.y }}` inside `for: a` throws `[wcs/wildcard-rank]` #1403; read another list's row in a getter with `$resolve(path, indexes)`.
- `{{ }}` and `$1` (the loop index) work inside templates. The elements 4.0 clones for rows and branches do not keep their `data-wcs` attribute, so do not select them with `[data-wcs…]` in CSS or tests — give them a class.

### Computed values

Plain getters. Wildcard getters compute per row, and `$getAll` aggregates across rows:

```javascript
get "cart.items.*.subtotal"() {
  return this["cart.items.*.price"] * this["cart.items.*.quantity"];
},
get "cart.total"() {
  return this.$getAll("cart.items.*.subtotal", []).reduce((a, b) => a + b, 0);
}
```

### Event handlers

Handlers receive the event, then the loop indexes:

```javascript
removeItem(event, index) {
  // `index` is the loop position — correct only when the template iterates
  // the same array you are mutating. If you loop over a FILTERED getter,
  // identify the row by id via the wildcard path instead (see the app above).
  this.items = this.items.toSpliced(index, 1);
}
```

**`on*:` handlers of `click`, `dblclick`, `input`, `change`, `submit`, `keydown`, `keyup`, `mousedown`, `mouseup`, `pointerdown` and `pointerup` are delegated**: one listener per event type sits on the root the state binds (the document, a shadow root, or a Light DOM component's host) and runs the handlers of the elements the event passed, innermost first. Other event types, and two-way bindings (`value:`, `checked:`), listen on the element. With delegation:

- `event.currentTarget` is the root, not the element. Find the element with `event.target.closest("li")`, or use the loop index or a wildcard path.
- `#stop` stops the outer `on*:` handlers, but not listeners your own code added to an ancestor (they already ran). Your own `stopPropagation()` on an ancestor keeps the `on*:` handlers inside it from running. An element moved under another root (a dialog moved to `document.body`) loses its handler.

Where a handler needs the element-level behaviour, write `on*#direct:`. The listener is then on the element itself: `currentTarget` is the element, `#stop` stops your ancestor listeners, an ancestor's `stopPropagation()` does not affect it, and it follows the element anywhere. It combines with `#prevent` / `#stop` (`onclick#direct,stop: save`). An outer `#direct` handler runs before the delegated handlers inside it, so an inner `#stop` stops it only if the inner binding is `#direct` too.

### Initialization and errors

- `<wcs-state>` loads its state, builds and applies every binding under its root, then runs `$connectedCallback`. By then the bindings exist, so `$connectedCallback` can emit commands to a defined element right away. A custom element whose class is not defined yet gets its property / `command.` / `eventToken.` bindings when it is defined: `await customElements.whenDefined("wcs-fetch")` before poking it.
- A state source that fails (a `src=` that throws, a `src="*.json"` that cannot be fetched, a `state="id"` with no `<script type="application/json" id="id">`) or a binding at page level that cannot be read (a syntax error, an unknown filter, #121, #203, #1403) fails initialization: `connectedCallbackPromise` rejects with the error, and the console reports it once — `[@wcstack/state] <wcs-state src="./state.js"> failed to initialize.` followed by the error. Run the lint (below) before you deploy.
- A `$connectedCallback` that throws or rejects is reported as `… $connectedCallback failed.`; `connectedCallbackPromise` rejects, but `getBindingsReady()` resolves — the page is bound.
- A binding that fails inside a `for:` / `if:` row, or that fails to apply later, goes to `$errorCallback(error, { path, bindingType, node })` when the state declares one, else to the console; the rest of the page keeps working.
- One root `<wcs-state>` per document or shadow root: a second one fails to initialize. Graft more state with `mount=`.
- On `/core` without the `diagnostics` feature, messages carry a number and the values (`[@wcstack/state] #501 "uc"`) instead of the code and the sentence: look the number up in [`docs/state-errors.md`](https://github.com/wcstack/wcstack/blob/main/docs/state-errors.md).

---

## What does not work

These are the mistakes that actually occur. Each has a working replacement.

```html
<!-- Filters transform VALUES. An event handler never takes a filter. -->
BAD:  <input data-wcs="onkeydown: add|enter">
GOOD: <input data-wcs="onkeydown: add">        <!-- check event.key inside add() -->

<!-- Structural directives require a <template>. -->
BAD:  <div data-wcs="for: items"> ... </div>
GOOD: <template data-wcs="for: items"> ... </template>

<!-- `{{ }}` outside a template causes FOUC (the raw text shows until state loads). -->
BAD:  <p>{{ count }}</p>
GOOD: <p><span data-wcs="textContent: count"></span></p>
GOOD: <p><!--@@: count--></p>              <!-- comment binding: no FOUC, no extra element -->

<!-- `for:` takes no filters. -->
BAD:  <template data-wcs="for: items|take(2)">
GOOD: <template data-wcs="for: firstTwo">   <!-- get firstTwo() { return this.items.slice(0, 2); } -->

<!-- In a delegated handler, currentTarget is the root. -->
BAD:  select(event) { event.currentTarget.classList.add("on"); }   <!-- with onclick: select -->
GOOD: select(event) { event.target.closest("li").classList.add("on"); }
GOOD: <li data-wcs="onclick#direct: select">                      <!-- currentTarget is the <li> -->

<!-- Markup inside an element whose content a binding sets is not bound. -->
BAD:  <div data-wcs="textContent: title"><b data-wcs="textContent: count"></b></div>
GOOD: <div><span data-wcs="textContent: title"></span><b data-wcs="textContent: count"></b></div>
```

A comment binding is `<!--@@: expr-->` (or `<!--@@wcs-text: expr-->`): the same text binding as `{{ expr }}`, filters included, at page level and inside templates; the comment is replaced by a text node. It binds even with `$behavior.enableMustache: false`. It is not a binding inside `<textarea>` or `<title>`, which the browser parses as text. The same goes for the children of `<noscript>` and `<iframe>`.

```javascript
// State must be REASSIGNED. In-place mutation is not tracked.
BAD:  this.items.push(x);
BAD:  this.items[0] = x;
BAD:  this.user.name = "new";
GOOD: this.items = [...this.items, x];
GOOD: this["items.0"] = x;
GOOD: this["user.name"] = "new";

// Immutable array methods are the idiom.
this.items = this.items.toSpliced(index, 1);
this.items = this.items.map(t => t.id === id ? { ...t, done: true } : t);

// Writing a list element replaces the value AT THAT POSITION: the row (focus, typed text,
// <details> open state) stays. To move rows with their values, assign a new array —
// rows follow their objects.
const items = this.items.slice();
[items[0], items[1]] = [items[1], items[0]];
this.items = items;

// $scan, substr and the 3.2 old names are gone (see the table below).
BAD:  $scan: { total: { from: "amount", initial: 0, fold: (sum, cur) => sum + cur } }
GOOD: total: 0, $watch: { amount(cur) { this.total = this.total + cur; } }

// bootstrapState() takes markup spelling only; behaviour is declared in the state.
BAD:  bootstrapState({ enableMustache: false });   // throws
GOOD: export default { $behavior: { enableMustache: false }, /* … */ };
```

---

## Configuration

A page that loads `/auto` calls nothing. With the module entries (`@wcstack/state`, `@wcstack/state/core`), `bootstrapState(config)` takes only how the page **spells** the markup — `bindAttributeName`, `tagNames.state` / `tagNames.ssr`, `commentForPrefix` / `commentIfPrefix` / `commentElseIfPrefix` / `commentElsePrefix` — plus `locale` and `enableContractAnalyzer`. The default `locale` is `<html lang>`, read when the module is evaluated: write it in the markup.

How a state tree behaves, and which features it needs, is declared in the state:

```javascript
export default {
  $behavior: { enableMustache: false },   // enableMustache, sameValueGuard, enableDirectionalInitialSync — booleans, all true by default
  $features: ["temporal"],                // the features this state needs (checked; loaded by the split auto entry)
  count: 0,
};
```

- `$behavior` covers the tree of the `<wcs-state>` that declares it, its volumes included. Every root state that needs it declares it — the page's root, a root in a shadow root, a mounted component, a DCC; nothing is inherited, and a volume cannot declare it. An unknown key or a non-boolean throws (#44); a re-set (`setInitialState()`) cannot change it (#45). It works in JSON states and on `/auto` pages too.
- **Every package's `bootstrapXxx(config)`** — `bootstrapState`, `bootstrapRouter`, `bootstrapFetch`, … — throws on an option it does not have, on a value whose type differs from the option's default, and on a `tagNames` key it does not define, and then applies nothing. An `undefined` value is skipped.

---

## User content and security

`@wcstack/state` does not sanitize values. Values are safe where they are text, and only there:

- **Bind user text with `textContent:`, `{{ }}` or a comment binding.** A value a binding writes is never read as a binding: `{{ }}` or `data-wcs` inside a value stays literal.
- **`innerHTML:` / `html:` only with HTML you sanitized** — install a sanitizing Trusted Types policy (`docs/csp.md` §7).
- **`href:`, `src:` and `attr.href:` accept `javascript:` URLs, and `attr.on*:` accepts handler strings.** state rejects neither: validate the value, and use a CSP whose `script-src` has no `'unsafe-inline'`.
- **Never put user content into the page's markup** — a server template that is not wcstack SSR, or HTML your code inserts. The page walk reads every `{{ … }}`, `data-wcs` attribute and comment binding (`<!--@@: x-->`) in the markup as a binding (client-side template injection), and `$behavior.enableMustache: false` does not stop comment bindings. 4.0 has no attribute that excludes a subtree from the walk (there is no `data-wcs-ignore`). Deliver such content as state data — a `<script type="application/json">` read with `state="id"`, a `src=` module, `fetch` — and bind it with `textContent:`.

---

## Names 4.0 removed

Older names appear all over the training data. 4.0 rejects them: write the name in the left column.

| Write | Removed in 4.0 |
|---|---|
| `upper` · `lower` · `capitalize` | `uc` · `lc` · `cap` |
| `add` · `sub` | `inc` · `dec` |
| `toFixed` · `padStart` | `fix` · `pad` |
| `repeat` · `reverse` | `rep` · `rev` |
| `nullIfEmpty` | `null` |
| `slice(start, start + length)` (an end index, not a length) | `substr(start, length)` |
| `$stream` (async producer → state) | `$streams` |
| `$renderedCallback` (hook) | `$updatedCallback` |
| `$watch` (fold a path's changes) · `$on` (fold event tokens) into an ordinary key | `$scan` |
| `this.$dependOn(path)` · `this.$untracked(fn)` | `$trackDependency` · `$untrackDependency` |

An old filter name or `substr` fails initialization with `[wcs/filter-unknown]` (the full entries name the replacement); `$streams`, `$updatedCallback` and `$scan` throw when the state loads; `$trackDependency` / `$untrackDependency` throw when read (the `diagnostics` feature, which `/auto` includes, detects these five; on `/core` without it they do nothing). The lint reports the declarations and API names as errors, and the filters as `wcs/filter-unknown` warnings (a page may register filters of its own) — which still throw at run time. `$renderedCallback` reports the **bindings that were applied**, not every state change — use `$watch` for those.

---

## Known limitations

- **One object at two positions of one list, or in two arrays no getter relates** (`backup = items; items = items.filter(…)`, both rendered): a write below one row does not reach the other row's bindings and row getters. Do not write below such a row; replace the object in the top-level list instead, as the app above does (`toggle()` reassigns `todos` with a new object for the changed item, and the checkbox is `checked#ro:`). Arrays a getter relates are fine: with `get shown()` returning a filtered copy of `todos`, a write below a row of either list reaches the other's row, `todos.*` readers and the filter.

Details: the migration guide, [§5](https://github.com/wcstack/wcstack/blob/main/docs/migration-v4.md#5-known-limitations).

---

## Verify before you finish

```bash
# Check any HTML against the data-wcs contract. No install, no config.
npx @wcstack/lint index.html

# Errors only, for a generate-validate-fix loop:
npx @wcstack/lint --errors-only index.html
```

Exit code `0` means no error-severity finding, `1` means at least one, `2` means a usage or read failure. **Warnings and info diagnostics do not change the exit code** — `0` is not the same as "no findings", so read the output too (or pass `--strict`, which makes warnings exit `1` as well). Two warnings throw at run time in 4.0 — `wcs/filter-unknown` and `wcs/wildcard-rank` — so treat them as errors. Diagnostics carry stable `wcs/*` codes (the same codes the runtime prints) and `source:line:col` ranges.

---

## The rest of the stack

`<wcs-state>` is one package. Every other capability is a tag that speaks the same binding protocol, so they compose without glue code.

| Package | Tag | Role |
|---|---|---|
| `@wcstack/state` | `<wcs-state>` | Reactive state + `data-wcs` binding |
| `@wcstack/router` | `<wcs-router>` | Declarative SPA routing (Navigation API) |
| `@wcstack/autoloader` | — | Import-Map-driven auto-registration of components |
| `@wcstack/signals` | — | Signals core (`signal` / `computed` / `effect`), JS-first alternative |
| `@wcstack/fetch` | `<wcs-fetch>` | HTTP with automatic re-fetch on dependency change |
| `@wcstack/storage` | `<wcs-storage>` | localStorage / sessionStorage |
| `@wcstack/websocket` | `<wcs-ws>` | WebSocket |
| `@wcstack/sse` | `<wcs-sse>` | Server-Sent Events |
| `@wcstack/lint` | — | Static-contract validator CLI |
| `@wcstack/devtools` | — | In-page inspector overlay |

Plus 25+ more wrapping camera, speech, geolocation, notifications, clipboard, sensors, observers, and other Web APIs. Full catalog: https://wcstack.github.io

### Deeper references

- **Agent skill** (complete binding syntax, router skeletons, tag catalog): https://github.com/wcstack/wcstack-skill
- **Repository guide for agents**: https://github.com/wcstack/wcstack/blob/main/AGENTS.md
- **Per-package docs**: `npm view @wcstack/state readme`, `npm view @wcstack/router readme`, …

## License

MIT
