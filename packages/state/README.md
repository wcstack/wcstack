# @wcstack/state

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

**This is not another convenient frontend framework. It brings a lineage established outside frontend development — the one where a path string is the contract between view and model — onto web standards.**

Most libraries place the coupling point between UI, state, and components inside JavaScript. `@wcstack/state` does not. It assumes no virtual DOM, no compilation step, no hooks, no selectors. UI and state are connected by HTML and path strings alone.

That is what `<wcs-state>` and `data-wcs` explore. One CDN import, zero dependencies, pure HTML syntax. The CDN script only registers the custom element definition — nothing else happens at load time. When a `<wcs-state>` element connects to the DOM, it reads its state source, scans all `data-wcs` bindings within the same root node (`document` or `ShadowRoot`), and wires up reactivity. All initialization is driven by the element's lifecycle, not by your code.

## What Does Not Exist Here

The following are not missing features. **They do not exist by design.**

- APIs for pulling variables out of state into components
- Per-element binding objects that mediate state access
- hooks (`useState` / `useStore`-style — the `$connectedCallback` lifecycle callbacks are not that)
- selectors
- glue code that imports reactive primitives into component code

None of these exist by design.

Why: this library does not put the UI-state coupling point inside JavaScript. State is not pulled into components. HTML refers to state through path strings. Elements do not own state, and state does not know elements. The only shared contract is the path.

## Where It Sits — and When Not to Choose It

This is not React / Vue / Solid with a different syntax. Those put the coupling point between UI and state inside a component; this puts it in a path string. **The premises are different**, and a comparison only says something when it is made along the right axis.

| What component frameworks assume | What `@wcstack/state` assumes |
|---|---|
| Components are the coupling point between UI and state | Path strings are the coupling point between UI and state |
| JavaScript is the center of rendering | HTML and the DOM are the center |
| State is pulled into components | Paths are declared and the DOM connects to state |
| hooks / selectors / signals express subscriptions | Attributes and paths express bindings |
| The whole app runs inside a framework execution model | A reactive layer is added on top of web standards, and the page stays a page |

The nearer relatives are the **attribute-directive, no-build libraries** — Alpine.js, petite-vue and their kind. They share the premise (attributes on plain HTML, no compiler) and differ on two points that decide the choice:

- **No expression language.** Those libraries put JavaScript expressions in attributes and evaluate them at runtime. `data-wcs` carries a path and a filter chain, nothing else; computation lives in path getters on the state. That is what lets a binding be checked statically (`@wcstack/lint`, the VS Code extension, `@wcstack/typescript`) and lets a page run under a strict CSP with no `unsafe-eval` ([docs/csp.md](../../docs/csp.md)).
- **It wires Web Components to each other.** The wc-bindable, command-token and event-token protocols and `bind-component` mounts connect elements that never import one another. The [I/O node packages](../../README.md#additional-packages) are what that buys.

**Choose it** for HTML-first pages: server-rendered or static markup with reactive parts, a page composed from custom elements, anywhere "read the HTML and know every data dependency" matters and a build step is a cost rather than a given.

**Do not choose it** when the team already lives inside a component framework — use the I/O nodes through the [framework adapters](../../docs/framework-adapter-integration.md) instead; when the hot path is a very large keyed list — [Performance](#performance) measures create / append at 2.5–3.5× [`@wcstack/signals`](../signals/), which interoperates with this package and is the better fit there; when templates need inline expressions — deliberately absent; or when the template must be type-checked by the compiler rather than by tooling — paths are strings, and `@wcstack/typescript` narrows that gap without closing it.

On those axes the comparison is concrete: the [Performance](#performance) section below is one, and the drivers under `e2e/bench/` regenerate it on your own hardware.

### The Lineage Outside JavaScript

The premise — *a path string is the whole contract between a view and a model* — is older than the framework era, and most of it was worked out outside JavaScript. Inside it, the direct ancestors are Knockout's `data-bind="text: user.name"` (an attribute carrying the binding, though it evaluates expressions and needs `ko.observable` wrappers) and Polymer's path system, which had dotted paths, `items.*` observers and `this.set("users.0.name", v)` — but required `set()` / `notifyPath()`, because plain assignment could not be observed on the platform of its time. Naming the older lineage is more useful than claiming novelty:

| Lineage | What it already had | What differs here |
|---|---|---|
| **Spreadsheets** (VisiCalc, 1979) | An address, a formula declaring what a cell **is**, a dependency graph, lazy recomputation — and no update code anywhere | Names instead of grid coordinates, and one formula per *shape* rather than per cell: `get "cart.items.*.subtotal"()` is not filled down into the rows; the wildcard is the definition |
| **Cocoa Bindings / KVC–KVO** (NeXT's EOF, 1994; Mac OS X 10.3, 2003) | Key paths (`person.address.street`), a binding triple of target + key path + value transformer, and collection operators that aggregate along a path (`@sum.items.price`) | The triple lives in the markup instead of a nib or a `bind:toObject:withKeyPath:` call, so it can be grepped, linted and diffed. Change detection is an ES Proxy over plain objects rather than KVC compliance |
| **XForms** (W3C Recommendation, 2003) | Model / instance / view separation, `ref` paths into the instance, and `<bind calculate="…">` — a computed value declared **at a path**, the direct ancestor of a path getter | The path is an address and nothing else: the computation is a JavaScript getter on the state, not XPath inside an attribute. And it runs in a stock browser, with no XForms processor |
| **WPF / XAML** (2006) | `{Binding Path=User.Name, Mode=TwoWay}`; a `DataContext` that re-roots a whole subtree; `UpdateSourceTrigger` choosing when the source is written; `IValueConverter` between the ends | One state tree per root, rather than a context inherited down the visual tree with `RelativeSource` / `ElementName` escapes — `state: user` is that re-rooting, written in the host's HTML. Converters are a closed set of 46 filters, not classes you register, and nothing is compiled |
| **Android Data Binding** (2015) | The path in the layout file itself — `android:text="@{user.name}"`, `@={}` for two-way | No build step and no generated binding class, and no expressions inside the attribute |
| **SCADA / HMI tag binding** (industrial, decades) | Widget properties wired to tag paths (`Line1/Tank/Level`) by configuration alone, and *indirect* bindings that parameterize the path (`Folder/Tag_{1}`) so one screen drives many devices | The tree carries derived values, lists and mounted components, not a flat namespace of scalars; the parameter is a loop's wildcard, resolved by the row the binding sits in rather than assigned from a dropdown |

Wildcards also resemble MQTT topic filters (`sensor/+/temperature`) and OSC address patterns (`/synth/*/freq`), but those select **messages in flight**. `items.*.price` names state addresses, and the one string is both the subscription and the write target.

What survives the comparison as genuinely new is narrow: the **wildcard path getter** — a getter whose *key* is a path pattern, so one definition serves every row and the dependency edge is held per pattern instead of per cell. The rest is a recombination of the lineage above onto three things none of them could assume: Custom Elements, ES Proxy and Import Maps.

## First Principle: Path as the Universal Contract

In every existing framework, the **component** is the coupling point between UI and state. Components import state hooks, selectors, or reactive primitives, and the binding happens inside JavaScript. No matter how cleanly you separate your state store, there is always glue code in the component that pulls state in.

`@wcstack/state` eliminates that coupling entirely. The **only** thing connecting UI and state is a **path string** — a dot-separated address like `user.name` or `cart.items.*.subtotal`. This is the sole contract between the two layers:

| Layer | What it knows | What it doesn't know |
|-------|---------------|----------------------|
| **State** (`<wcs-state>`) | Data structure and business logic | Which DOM nodes are bound |
| **UI** (`data-wcs`) | Path strings and display intent | How state is stored or computed |
| **Components** (`state: path`) | The mount table the host writes | Who mounted it, and what the rest of the tree holds |

Three levels of path contracts keep everything loosely coupled:

1. **UI ↔ State** — A `data-wcs="textContent: user.name"` attribute is the entire binding. No hooks, no selectors, no reactive primitives: no component code imports a reactive primitive or registers a subscription. A `bind-component` class still declares its own plain `state` object and reads it like a plain object — what never appears is glue that pulls state into the component.

2. **Component ↔ Component** — The host mounts a subtree onto each component (`<my-card data-wcs="state: user">`), and volumes graft extra modules onto the tree (`<wcs-state mount="i18n">`). Components never import one another, and a whole-object mount is a path prefix on the single tree and nothing more. Two declarative forms reach further, each spelled out where it is defined: the [per-property form](#host-usage) (`state.message: user.name`) has the host name the component's own keys, and an [exported getter](#exported-getters-reading-a-components-getter-from-outside) lets the host read a value the component computes — that binding then depends on a component being mounted there.

3. **Loop context** — Inside a `for` loop, `*` acts as an abstract index. Bindings like `items.*.price` resolve to the current element automatically. The template doesn't know its concrete position — the wildcard is the contract.

### Why This Matters

This separates UI and state with **no JavaScript intermediary**. You can:

- Redesign the UI without touching state logic — as far as the logic does not hang off what is rendered: a live binding is one of the three [demand roots](#demand-roots--what-makes-a-getter-run), so an element you think of as display-only can be the page's only subscription
- Refactor state structure and only update path strings
- Read the HTML and know every binding; the dependencies that are not in the HTML (`$watch`, `$streams`, `$scan`) are all declared in one place, the state

The path contract works like a URL in a REST API — a simple string that both sides agree on, with no shared code between them. It's the natural result of building on HTML's declarative nature rather than inventing a template language on top of JavaScript.

Every feature below is a consequence of this principle. The principle comes first; the features follow from it.

## 4 Steps to Reactive HTML

```html
<!-- 1. Load the CDN -->
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>

<!-- 2. Write a <wcs-state> tag -->
<wcs-state>
  <!-- 3. Define your state object -->
  <script type="module">
    export default {
      message: "Hello, World!"
    };
  </script>
</wcs-state>

<!-- 4. Bind with data-wcs attributes -->
<div data-wcs="textContent: message"></div>
```

That's it. No build, no bootstrap code, no framework.

## Features Derived from This Principle

Every row is a section of this README. Unless it appears under [Where the neighbours come in](#where-the-neighbours-come-in), it ships in this package.

| Area | In one line | Reference |
|---|---|---|
| **Path model** | Dot paths address state; `*` is an abstract index, `**` a depth, `$1` / `$2` name the axes | [First principle](#first-principle-path-as-the-universal-contract) · [Loop index variables](#loop-index-variables-1-2) |
| **Binding syntax** | One `data-wcs` attribute carries property / text / class / style / attribute / event bindings; `{{ }}` in text nodes; the same inside `<svg>` | [Binding syntax](#binding-syntax) · [Mustache](#mustache-syntax) · [SVG](#svg-support) |
| **Structural directives** | `for` and `if` / `elseif` / `else` on `<template>` elements | [Structural directives](#structural-directives) |
| **Row identity** | Rows diff by reference, so a sort or a filter reuses the DOM; `$listKeys` keeps row DOM and row objects across refetched arrays | [`$listKeys`](#listkeys--identity-for-refetched-rows) |
| **Forms** | Two-way binding for `input` / `select` / `textarea`, a radio group to one value, a checkbox group to an array, `#ro` / `#onchange` / `#prevent` / `#stop` | [Two-way binding](#two-way-binding) · [Modifiers](#modifiers) |
| **Filters** | 46 built-ins, chainable, locale-aware formatting that reads `<html lang>` | [Filters](#filters) · [Locale](#locale) |
| **Derived state** | Path getters declare virtual properties at any depth from one flat place; they chain, and they take setters | [Path getters](#path-getters-computed-properties) |
| **Aggregation and bulk write** | `$getAll` / `$setAll` / `$resolve` read and write across `items.*.price` without rebuilding the array | [Proxy APIs](#proxy-apis) |
| **Recursive paths** | `$recursion` declares where a tree's shape repeats; one `**` getter covers every depth | [Recursive paths](#recursive-paths-recursion) |
| **Reactivity** | An ES Proxy tracks reads per address, caches per address, invalidates in dependency order and batches DOM writes on a microtask | [Updating state](#updating-state) · [Dependency tracking boundaries](#dependency-tracking-boundaries) |
| **What makes a getter run** | Getters are lazy. Demand comes from a live binding, a `$watch` or a `$streams` `args` — and from nowhere else | [Demand roots](#demand-roots--what-makes-a-getter-run) |
| **Modularity** | `mount=` grafts a module onto the one tree; `state: path` mounts a subtree onto a component; the per-property form maps single keys, and a mounted component's getters are exported at its mount point | [Volumes](#mounting-additional-state-mount) · [Whole-object mount](#whole-object-mount-state-path) |
| **Components** | Two mutually exclusive mechanisms: a JavaScript class with `bind-component`, or HTML-only DCC | [Choosing a mechanism](#choosing-a-component-mechanism) |
| **Wiring to other elements** | The wc-bindable protocol, spread (`...: obj`), `#init=` / `#sync=` authority, property-to-attribute mirroring | [Binding authority](#binding-authority-init--sync) · [Spread](#spread-binding) · [Inputs](#inputs-and-attribute-mirror) |
| **Tokens** | Command tokens call an element's methods from state; event tokens carry the element's events back | [Command token](#command-token-method-binding) · [Event token](#event-token-event-binding) |
| **Time** | `$streams` folds an async source, `$watch` reacts headlessly, `$scan` owns an accumulation that outlives both | [Choosing a time mechanism](#choosing-a-time-mechanism) |
| **Initialization and lifecycle** | Six ways to supply the state; `$connectedCallback` … `$stateReadyCallback`; `bootstrapState()` / `createState()` | [State initialization](#state-initialization) · [Lifecycle hooks](#lifecycle-hooks) · [API reference](#api-reference) |
| **Diagnostics** | Unresolved paths, index arity, wildcard rank and getter cycles are reported; one failing binding stays confined, and neither values nor the DOM are rolled back | [Diagnostics](#diagnostics-and-failure-handling) |
| **Delivery** | Zero runtime dependencies, no build step, ESM, one CDN `/auto` tag; no `unsafe-eval`, Trusted Types supported | [Installation](#installation) · [docs/csp.md](../../docs/csp.md) |

### Where the neighbours come in

`@wcstack/state` is the reactive core and nothing else. Tooling, I/O and routing live in sibling packages, and the split is always the same shape: this package provides the hook and the contract, the neighbour provides the machinery.

| Package | What it adds | What this package already provides |
|---|---|---|
| [`@wcstack/server`](../server/) | Renders the page on the server and hydrates the markup the client receives | The `enable-ssr` attribute and the hydration contract — [SSR](#server-side-rendering) |
| [`@wcstack/lint`](../lint/) | `npx @wcstack/lint <file>` checks every `data-wcs` in an HTML file before it runs | The diagnostic codes and `getWcsManifest()`, both derived from this implementation — [Diagnostics](#diagnostics-and-failure-handling) |
| VS Code extension (`wcstack-intellisense`) | The same diagnostics, plus completion, inside the editor | The same manifest and codes |
| [`@wcstack/typescript`](../typescript/) | `wcs-schema` carries the types into the HTML validator; `wcs-tsc` type-checks inline state scripts | `defineState()`, `WcsPaths<T>` / `WcsPathValue<T, P>` — [TypeScript support](#typescript-support) |
| [`@wcstack/devtools`](../devtools/) | A browser panel over state, wiring and update history | The instrumentation the panel reads |
| [`@wcstack/testing`](../testing/) | `mount()` / `settle()` / `fire()` as one import | The bare recipes that need no extra package — [Testing your page](#testing-your-page) |
| [`@wcstack/view-transition`](../view-transition/) | Animates list moves, removals and branch swaps through the View Transition API | The transition-runner hand-off; with no arbiter on the page the mutation applies directly — [Transition animations](#transition-animations) |
| [`@wcstack/router`](../router/) · [`@wcstack/autoloader`](../autoloader/) | Declarative routing; automatic loading of undefined custom elements | Paths a route can write into, and bindings that wait for a late definition |
| The [I/O nodes](../../README.md#additional-packages) — `fetch`, `storage`, `ws`, `midi`, … | The platform APIs as elements | The wc-bindable wiring, spread and the token protocols that connect them — [Spread](#spread-binding) |
| [`@wcstack/signals`](../signals/) | A different reactive core, 2.5–3.5× faster on create / append for very large keyed lists | Interop — both speak wc-bindable, so the I/O nodes and DCCs are shared — [Performance](#performance) |

## Installation

### CDN (recommended)

```html
<!-- Auto-initialization — this is all you need -->
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
```

### CDN (manual initialization)

```html
<script type="module">
  import { bootstrapState } from 'https://esm.run/@wcstack/state';
  bootstrapState();
</script>
```

## Basic Usage

```html
<wcs-state>
  <script type="module">
    export default {
      count: 0,
      user: { id: 1, name: "Alice" },
      users: [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
        { id: 3, name: "Charlie" }
      ],
      countUp() { this.count += 1; },
      clearCount() { this.count = 0; },
      get "users.*.displayName"() {
        return this["users.*.name"] + " (ID: " + this["users.*.id"] + ")";
      }
    };
  </script>
</wcs-state>

<!-- Text binding -->
<div data-wcs="textContent: count"></div>
{{ count }}

<!-- Two-way input binding -->
<input type="text" data-wcs="value: user.name">

<!-- Event binding -->
<button data-wcs="onclick: countUp">Increment</button>

<!-- Conditional class -->
<div data-wcs="textContent: count; class.over: count|gt(10)"></div>

<!-- Loop -->
<template data-wcs="for: users">
  <div>
    <span data-wcs="textContent: .id"></span>:
    <span data-wcs="textContent: .displayName"></span>
  </div>
</template>

<!-- Conditional rendering -->
<template data-wcs="if: count|gt(0)">
  <p>The count is positive.</p>
</template>
<template data-wcs="elseif: count|lt(0)">
  <p>The count is negative.</p>
</template>
<template data-wcs="else:">
  <p>The count is zero.</p>
</template>
```

## State Initialization

`<wcs-state>` supports multiple ways to load initial state:

```html
<!-- 1. Reference a <script type="application/json"> by id -->
<script type="application/json" id="state">
  { "count": 0 }
</script>
<wcs-state state="state"></wcs-state>

<!-- 2. Inline JSON attribute -->
<wcs-state json='{ "count": 0 }'></wcs-state>

<!-- 3. External JSON file -->
<wcs-state src="./data.json"></wcs-state>

<!-- 4. External JS module (export default { ... }) -->
<wcs-state src="./state.js"></wcs-state>

<!-- 5. Inline script module -->
<wcs-state>
  <script type="module">
    export default { count: 0 };
  </script>
</wcs-state>

<!-- 6. Programmatic API -->
<script>
  const el = document.createElement('wcs-state');
  el.setInitialState({ count: 0 });
  document.body.appendChild(el);
</script>
```

Resolution order: `state` → `src` (.json / .js) → `json` → inner `<script>` → wait for `setInitialState()`.

> **Under a Content-Security-Policy:** form 5 (inline `<script type="module">`) is evaluated through a `blob:` URL and therefore requires `script-src blob:`. A page nonce does not cover it. If you enforce a strict CSP, use form 4 (`src="./state.js"`) instead — it needs no extra directive. See [docs/csp.md](../../docs/csp.md).

### Mounting Additional State (`mount=`)

There is **one state tree per root**. To split state across modules, mount a volume: its data grafts onto the root tree at the mount path, and bindings read it by prefix.

```html
<wcs-state mount="cart" src="./cart.js"></wcs-state>
<wcs-state src="./app.js"></wcs-state>

<div data-wcs="textContent: cart.total"></div>
```

A volume may declare getters, `$watch`, `$listKeys`, `$updatedCallback`, and `$connectedCallback`/`$disconnectedCallback` — all relative to its mount path. `$errorCallback` is root-only (a binding failure is reported once, to the tree's owner). Load order does not matter (a volume connected before the root is grafted when the root registers). If the root `<wcs-state>` fails to initialize, the volumes already waiting for it settle with a report of their own instead of waiting forever. That report is the end of the line for those volumes: a volume reported as an orphan does not graft itself later, so connecting a corrected root afterwards does not bring it back. A volume that settles without grafting — orphaned, failed to load, or failed to graft — releases its mount slot, and so does a volume detached while it is still loading or waiting for its root. Such a volume takes the slot back when it is re-attached to the same root, or otherwise just before it grafts, and still grafts as before when the slot is free — even while detached; if another volume took the slot in the meantime, it reports that and does not graft. A synchronous throw from a volume's `$connectedCallback` is reported like an asynchronous one, and the volume counts as grafted. To recover without reloading the page, remove the broken root and the orphaned volumes and add new elements. A grafted volume keeps its slot even when detached, because its data stays in the tree. Mount paths must be static (`*`, `$`, `#`, `@` are rejected). Changing `mount` after the element has initialized is not supported: the change is ignored with a console warning — remove the element and add a new one with the desired path.

> **Migrating from v1's named states:** `<wcs-state name="cart">` + `total@cart` becomes `<wcs-state mount="cart">` + `cart.total`. In v2 the `name` attribute fails fast and `@` in a path is a parse error, each with this exact guidance. Migration table: [docs/state-mount-design.md](../../docs/state-mount-design.md) §9.

## Updating State

In `@wcstack/state`, every piece of state has a **path** — like `count`, `user.name`, or `items`. To update state reactively, **assign to the path**:

```javascript
this.count = 10;               // path "count"
this["user.name"] = "Bob";     // path "user.name"
```

That's the one rule: **assign to the path, and the DOM updates automatically.**

### Why `this.user.name = "Bob"` Doesn't Work

This is not just a limitation. It is where the contract boundary becomes visible.

`this.user.name` first reads the `user` object via `this.user` (a path read), then sets `.name` on that plain object — this does not go through the contract of path assignment, so the change is not detected:

```javascript
// ✅ Path assignment — change detected
this["user.name"] = "Bob";

// ❌ Not a path assignment — change NOT detected
this.user.name = "Bob";
```

It may seem more convenient to make `this.user.name = "Bob"` reactive too. But doing that would break the principle that UI and state are connected only through paths. Dependency tracking and update boundaries would become implicit and ambiguous. The visible contract boundary is the point.

### Arrays

The same rule applies: assign a new array to the path. Mutating methods (`push`, `splice`, `sort`, ...) modify the array in place without path assignment, so use non-destructive alternatives:

```javascript
// ✅ New array assigned to path — change detected
this.items = this.items.concat({ id: 4, text: "New" });
this.items = this.items.toSpliced(index, 1);
this.items = this.items.filter(item => !item.done);
this.items = this.items.toSorted((a, b) => a.id - b.id);
this.items = this.items.toReversed();
this.items = this.items.with(index, newValue);

// ❌ In-place mutation — no path assignment, change NOT detected
this.items.push({ id: 4, text: "New" });
this.items.splice(index, 1);
this.items.sort((a, b) => a.id - b.id);
```

## Binding Syntax

### `data-wcs` Attribute

```
property[#modifier]: path[|filter[|filter(args)...]]
```

Multiple bindings separated by `;`:

```html
<div data-wcs="textContent: count; class.over: count|gt(10)"></div>
```

| Part | Description | Example |
|---|---|---|
| `property` | DOM property to bind | `value`, `textContent`, `checked` |
| `#modifier` | Binding modifier | `#ro`, `#prevent`, `#stop`, `#onchange` |
| `path` | State property path | `count`, `user.name`, `users.*.name` |
| `\|filter` | Transform filter chain | `\|gt(0)`, `\|round\|locale` |

### Property Types

| Property | Description |
|---|---|
| `value` | Element value (two-way for inputs) |
| `checked` | Checkbox / radio checked state (two-way) |
| `textContent` | Text content |
| `text` | Alias for textContent |
| `html` | innerHTML |
| `class.NAME` | Toggle a CSS class |
| `style.PROP` | Set a CSS style property |
| `attr.NAME` | Set an attribute (supports SVG namespace) |
| `radio` | Radio button group binding (two-way) |
| `checkbox` | Checkbox group binding to array (two-way) |
| `onclick`, `on*` | Event handler binding |

### Modifiers

| Modifier | Description |
|---|---|
| `#ro` | Read-only — disables two-way binding |
| `#prevent` | Calls `event.preventDefault()` on event handlers |
| `#stop` | Calls `event.stopPropagation()` on event handlers |
| `#onchange` | Uses `change` event instead of `input` for two-way binding |
| `#init=<authority>` | Binding authority / initial sync direction — see [Binding Authority](#binding-authority-init--sync) |
| `#sync=<timing>` | Element snapshot timing — see [Binding Authority](#binding-authority-init--sync) |

Multiple modifiers are comma-separated after a single `#`: `value#ro,init=none: path`.

### Two-Way Binding

Automatically enabled for:

| Element | Property | Event |
|---|---|---|
| `<input type="checkbox/radio">` | `checked` | `input` |
| `<input>` (other types) | `value`, `valueAsNumber`, `valueAsDate` | `input` |
| `<select>` | `value` | `change` |
| `<textarea>` | `value` | `input` |

`<input type="button">` is excluded. Use `#ro` to disable, `#onchange` to change the event.

### Binding Authority (`#init=` / `#sync=`)

**The problem this solves.** An element that already holds a value when its binding attaches — `<wcs-storage>` after loading a persisted value, a clock, a widget restoring its own snapshot — is overwritten by the state seed, because the initial sync of a two-way binding writes state→element. Adding `#init=element` to that one binding makes the *element* win the initial sync instead; later changes flow both ways as usual. That case (load-before-bind) is spelled out below; the rest of this section is the general rule it is an instance of.

For custom elements that declare `static wcBindable`, every prop binding resolves an **authority** — which side wins the **initial sync** when the binding attaches. The steady-state direction is decided separately, by the member's declared shape: an output-only member never accepts state writes (a permanent contract), while a two-way member flows both ways after the initial sync regardless of which side won it. The default authority is derived from where the member is declared (on by default via `enableDirectionalInitialSync`):

| Member declared in | Default authority | Effect |
|---|---|---|
| `properties` only (output-only) | `element` | The element's value flows into state; **state never writes this member** |
| `inputs` only | `state` | State writes the element |
| `properties` + `inputs` (two-way) | `state` | Classic behavior — state writes first, element events update state afterwards |
| — (no `wcBindable`; plain HTML elements) | `state` | Unchanged behavior |

> **Authoring rule:** declare every settable member in **both** `properties` and `inputs`. A member declared only in `properties` is output-only — state→element writes are suppressed for the life of the binding, and the element's own initial value overwrites whatever the state seeded. (`@wcstack` I/O node Shells and DCC `$bindables` follow this rule.)

#### What the element writes back (`properties[].getter`)

When the element dispatches `properties[].event`, the value written to state is **`getter(event)`**. With no `getter`, the protocol default applies — [`(e) => e.detail`](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/main/SPEC.md#default-getter): the **whole `detail`, as-is**. The declared property is *not* read off the element at that point; the event payload is authoritative. A plain HTML element (no `wcBindable`) is the other way round: `element[propName]` is read on `input`/`change`.

So an element that dispatches `detail: { value: 7654321 }` without a `getter` writes the **object** `{ value: 7654321 }` to state, not the number — and the failure is mostly silent: the write-back (`Number({ value: … })` → `NaN`) throws nothing, and `@wcstack/lint` cannot see it (the payload shape is not static). The runtime warns once per element and property (`wcs/default-getter-mismatch`) for the two shapes it can tell apart at the event: a `detail` that is `undefined` while the element property has a value (a plain `Event`, or a forgotten `detail`), and a `detail` object carrying a `<propName>` key while the property is not an object (the wrapper above). Any other mismatch goes through unnoticed, and the write is applied as-is either way. Use one of the two conforming shapes:

```javascript
class YenInput extends HTMLElement {
  static wcBindable = {
    protocol: "wc-bindable", version: 1,
    properties: [
      // (a) the value itself is the detail — the protocol's recommendation; no getter needed
      { name: "value", event: "yen-input:value-changed" },
      // (b) the detail is an object, or the event is not a CustomEvent — say how to read it
      // { name: "value", event: "yen-input:value-changed", getter: (e) => e.detail.value },
      // { name: "value", event: "input",                  getter: (e) => e.target.value },
    ],
    inputs: [{ name: "value" }],
  };
  #onInput() {
    // (a): dispatch the value, not a wrapper object
    this.dispatchEvent(new CustomEvent("yen-input:value-changed", { detail: this.value, bubbles: true }));
  }
}
```

Whichever you pick, `element.value` and the value extracted from the event must be the same logical state (the protocol's *Producer State Consistency Invariant*): the initial sync reads the property, every later update reads the event. Both shapes are in use inside wcstack — `<wcs-fetch>`'s `loading` dispatches the boolean as `detail` with no `getter`, its `value` reads `detail.value` through one — and DCC `$bindables` declare `getter: (e) => e.target[name]` because a sub-path write has no single value to put in `detail`. The default itself is not going to change: it is normative for every wc-bindable adapter (`@wc-bindable/core`'s `bind()` and the framework adapters implement the same `e.detail`), and the protocol classes a different default as a breaking change requiring a new protocol identifier.

Override the authority per binding with `#init=`:

| Value | Initial sync | Allowed on |
|---|---|---|
| `init=state` | The state value is written to the element (two-way default) | inputs-only, two-way |
| `init=element` | The element's snapshot seeds the state instead — on a two-way member the binding then continues as normal two-way (state→element writes flow from the next change on) | output-only, two-way |
| `init=auto` | `element` if the state slot is uninitialized, otherwise `state` | two-way |
| `init=none` | No initial sync — changes flow normally from the next update (event bindings accept only this value) | any |

`#init=` decides only who wins the initial race. The *permanent* suppression of state→element writes comes from the member being declared output-only, never from the modifier. This makes `#init=element` (or `#init=auto`) the declarative fix for **load-before-bind**: an element that loads a persisted value in its own `connectedCallback` — before the binding attaches — is no longer clobbered by the state seed, and later state changes still reach the element (so e.g. `<wcs-storage>` keeps saving):

```html
<!-- The persisted list seeds `todos`; assigning `todos` later still saves. -->
<wcs-storage key="todos" type="local" data-wcs="value#init=element: todos"></wcs-storage>
```

`#sync=` controls **when** the element snapshot is read for element-authority bindings:

| Value | Meaning |
|---|---|
| `sync=call` (default) | Read immediately when the binding attaches |
| `sync=connect` | Defer the read until the element is connected to the document |

```html
<x-clock  data-wcs="value#init=element: clock.now"></x-clock>
<x-input  data-wcs="value#init=auto: form.name"></x-input>
<x-widget data-wcs="value#init=element,sync=connect: widget.snapshot"></x-widget>
```

With `sync=connect`, state→element writes stay suppressed until the connect snapshot has resolved the initial race.

Notes:

- With `enableDirectionalInitialSync: false` (opt-out), writing `#init=`/`#sync=` throws.
- **Migrating from ≤ 1.20:** do not seed state with placeholder values (`value: []`, `query: ""`) for output-only members — the element's real initial value (often `null`/`undefined`) replaces the seed. Match the seed to the element's actual initial value and null-guard display values with a derived getter.
- **Until 1.21.x**, `init=element` / `init=auto` / `init=none` suppressed state→element writes for the binding's whole lifetime, which made them unusable on genuinely two-way members. Authority now governs only the initial sync (`docs/architecture-hardening/09-remediation-design.md` §3.6).

### Radio Binding

Bind a radio button group to a single state value with `radio`:

```html
<input type="radio" value="red" data-wcs="radio: selectedColor">
<input type="radio" value="blue" data-wcs="radio: selectedColor">
```

The radio button whose `value` matches the state value is automatically checked. When the user selects a different radio button, the state is updated. Use `#ro` for read-only.

Inside a `for` loop:

```html
<template data-wcs="for: branches">
  <label>
    <input type="radio" data-wcs="value: .; radio: currentBranch">
    {{ . }}
  </label>
</template>
```

### Checkbox Binding

Bind a checkbox group to a state array with `checkbox`:

```html
<input type="checkbox" value="apple" data-wcs="checkbox: selectedFruits">
<input type="checkbox" value="banana" data-wcs="checkbox: selectedFruits">
<input type="checkbox" value="orange" data-wcs="checkbox: selectedFruits">
```

A checkbox is checked when its `value` is included in the state array. Toggling a checkbox adds or removes the value from the array. Use `|int` to convert string values to numbers, and `#ro` for read-only.

### Mustache Syntax

When `enableMustache` is `true` (default), `{{ expression }}` in text nodes is supported:

```html
<p>Hello, {{ user.name }}!</p>
<p>Count: {{ count|locale }}</p>
```

Internally converted to comment-based bindings (`<!--@@:expression-->`).

### Spread Binding (`...`)

For custom elements that declare the [`wc-bindable` protocol](#bindables--commands-and-the-wc-bindable-protocol), `...: target` wires all of the element's **properties + inputs** to a single state object in one line:

```html
<wcs-fetch data-wcs="...: usersFetch"></wcs-fetch>
```

```js
export default {
  usersFetch: {
    url: "/api/users",
    method: "GET",
    value: null,
    loading: false,
    error: null,
    status: null,
  }
}
```

Runtime reads `customClass.wcBindable.properties + inputs` and expands each name into an individual binding (`usersFetch.value`, `usersFetch.url`, ...).

**Scope**: spread covers the *data surfaces* (properties + inputs). `commands` and event tokens are intentionally **not** included — wire them explicitly so the pub/sub points remain visible in HTML.

**Inside a for loop**: use `...: items.*` (recommended) or the dot shortcut `...: .`:

```html
<template data-wcs="for: storesFetches">
  <wcs-fetch data-wcs="...: storesFetches.*"></wcs-fetch>
</template>
```

**Last-wins override** — explicit binding after `...` overrides the spread:

```html
<wcs-fetch data-wcs="...: usersFetch; status: alternateStatus"></wcs-fetch>
```

**`undefined` is "no opinion"** — when an expanded state path resolves to `undefined` (e.g. the slot object doesn't initialize that input), the property write is **skipped** and the element keeps its own default. You only need to initialize the paths you actually use; `usersFetch: { value: null, loading: false }` is enough even though `<wcs-fetch>` also declares `method` / `manual` / `body`. To explicitly clear a value, assign `null` — `null` is always written. (This skip applies to every property binding, not just spread; with `config.debug` each skipped write is logged via `console.debug`.)

**Constraints**:

- Filters on the spread target (`...: target|filter`) are rejected.
- The right-hand path may contain `*` anywhere (e.g. `...: stores.*.fetch`).
- The right-hand side is a plain tree path (`...: fetchX` or `...: stores.*.fetch`).
- If the custom element class is not yet registered, expansion is deferred until `customElements.whenDefined(tag)` resolves — autoloader-style late registration is supported.
- Elements **without** a `wcBindable` declaration are rejected (write bindings explicitly). Spread requires the contract to know what to expand.

**Composite shells** (wc-bindable Composition Profile) are supported transparently: a composite shell exposes its synthesized declaration through the standard `target.constructor.wcBindable` surface, and composed names like `"s3.progress"` are kept as flat element member keys. Mirror the composed structure in state (`{ s3: { progress: 0 } }`) and `...: pipeline` expands into nested state paths automatically.

## Structural Directives

Structural directives use `<template>` elements:

### Loop (`for`)

```html
<template data-wcs="for: users">
  <div>
    <!-- Full path -->
    <span data-wcs="textContent: users.*.name"></span>
    <!-- Shorthand (relative to loop context) -->
    <span data-wcs="textContent: .name"></span>
  </div>
</template>
```

The `for:` directive uses a **value-based diff algorithm** — each array element's value itself serves as the identity key. When the array is reassigned, the differ matches old and new elements by value, reusing existing DOM nodes for unchanged items and efficiently adding, removing, or reordering the rest.

This means **no explicit `key` attribute is needed for adding, removing, or reordering rows** (like React's `key` or Vue's `:key`) — as long as row objects keep their references. Non-destructive array methods (`toSorted`, `toReversed`, `filter`, `with`, `toSpliced`) all preserve element references, so sorting and filtering are keyed by construction, and the whole class of "wrong key" bugs cannot occur.

The exception is data that arrives as **freshly created objects** — `fetch(...).json()`, `JSON.parse` from storage, a WebSocket/SSE full snapshot, or a Worker `postMessage`. Those rows never match by reference, so every row is torn down and rebuilt. See [`$listKeys`](#listkeys--identity-for-refetched-rows) below.

#### `$listKeys` — identity for refetched rows

When rows carry DOM state the bindings do not own — focus, an in-flight IME composition, `<details>` open state, inner scroll position, `<canvas>` contents, `<video>` playback — rebuilding the rows loses it. Declare a key so the framework can recognize rows across a refresh:

```js
{
  items: [],
  $listKeys: {
    "items": "id",                        // field name
    "items.*.children": (row) => row.uid, // or a function, for composite keys
  },
}
```

With a key declared, assigning a new array **keeps the existing row objects** and writes only the fields that actually changed into them. The row's DOM is reused rather than rebuilt:

```js
// Every row object is new, but rows are matched by id — DOM, focus and
// <details> state survive, and only the fields that differ are written.
this.items = await (await fetch("/api/items")).json();
```

Notes:

- **Opt-in and per-path.** Lists without a declaration behave exactly as before, at no cost.
- **Nesting is opt-in too.** Only declared paths are matched by key; undeclared nested arrays are replaced by reference as usual. This lets you adopt it one list at a time.
- **A no-op refresh is free.** If nothing changed, no field is written and no DOM work happens at all.
- **Rows must be plain objects**, and keys must be present and unique. Duplicate keys, missing keys, and class instances raise an error immediately rather than degrading silently.
- **Fields dropped from a row are cleared with `null`**, which is this package's vocabulary for an explicit clear (`undefined` means "the state has no opinion" and skips the write).
- The stored array is rebuilt from matched row objects, so `this.items !== theArrayYouAssigned` afterwards.

#### Dot Shorthand

Inside a `for` loop, paths starting with `.` are expanded relative to the loop's array path:

| Shorthand | Expanded to | Description |
|---|---|---|
| `.name` | `users.*.name` | Property of the current element |
| `.` | `users.*` | The current element itself |
| `.name\|uc` | `users.*.name\|uc` | Filters are preserved |

For primitive arrays, `.` refers to the element value directly:

```html
<template data-wcs="for: branches">
  <label>
    <input type="radio" data-wcs="value: .; radio: currentBranch">
    {{ . }}
  </label>
</template>
```

Nested loops are supported with multi-level wildcards. The `.` shorthand in nested `for` directives also expands relative to the parent loop path:

```html
<template data-wcs="for: regions">
  <!-- .states → regions.*.states -->
  <template data-wcs="for: .states">
    <!-- .name → regions.*.states.*.name -->
    <span data-wcs="textContent: .name"></span>
  </template>
</template>
```

### Conditional (`if` / `elseif` / `else`)

```html
<template data-wcs="if: count|gt(0)">
  <p>Positive</p>
</template>
<template data-wcs="elseif: count|lt(0)">
  <p>Negative</p>
</template>
<template data-wcs="else:">
  <p>Zero</p>
</template>
```

Conditions can be chained. `elseif` automatically inverts the previous condition.

## Path Getters (Computed Properties)

**Path getters** are the core feature of `@wcstack/state`. Define computed properties using JavaScript getters with **dot-path string keys** containing wildcards (`*`). They act as **virtual properties that can be attached at any depth in a data tree — all defined flat in one place**. No matter how deeply data is nested, path getters keep definitions at the same level with automatic dependency tracking per loop element.

### Basic Path Getter

```html
<wcs-state>
  <script type="module">
    export default {
      users: [
        { id: 1, firstName: "Alice", lastName: "Smith" },
        { id: 2, firstName: "Bob", lastName: "Jones" }
      ],
      // Path getter — runs per-element inside a loop
      get "users.*.fullName"() {
        return this["users.*.firstName"] + " " + this["users.*.lastName"];
      },
      get "users.*.displayName"() {
        return this["users.*.fullName"] + " (ID: " + this["users.*.id"] + ")";
      }
    };
  </script>
</wcs-state>

<template data-wcs="for: users">
  <div data-wcs="textContent: .displayName"></div>
</template>
<!-- Output:
  Alice Smith (ID: 1)
  Bob Jones (ID: 2)
-->
```

Inside a path getter, `this["users.*.firstName"]` automatically resolves to the current loop element — no manual indexing needed.

### Top-Level Computed Properties

Getters without wildcards work as standard computed properties:

```javascript
export default {
  price: 100,
  tax: 0.1,
  get total() {
    return this.price * (1 + this.tax);
  }
};
```

### Getter Chaining

Path getters can reference other path getters, forming a dependency chain. The cache is automatically invalidated when any upstream value changes:

```html
<wcs-state>
  <script type="module">
    export default {
      taxRate: 0.1,
      cart: {
        items: [
          { productId: "P001", quantity: 2, unitPrice: 500 },
          { productId: "P002", quantity: 1, unitPrice: 1200 }
        ]
      },
      // Per-item subtotal
      get "cart.items.*.subtotal"() {
        return this["cart.items.*.unitPrice"] * this["cart.items.*.quantity"];
      },
      // Aggregate: sum of all subtotals
      get "cart.totalPrice"() {
        return this.$getAll("cart.items.*.subtotal", []).reduce((sum, v) => sum + v, 0);
      },
      // Chained: tax derived from totalPrice
      get "cart.tax"() {
        return this["cart.totalPrice"] * this.taxRate;
      },
      // Chained: grand total
      get "cart.grandTotal"() {
        return this["cart.totalPrice"] + this["cart.tax"];
      }
    };
  </script>
</wcs-state>

<template data-wcs="for: cart.items">
  <div>
    <span data-wcs="textContent: .productId"></span>:
    <span data-wcs="textContent: .subtotal|locale"></span>
  </div>
</template>
<p>Total: <span data-wcs="textContent: cart.totalPrice|locale"></span></p>
<p>Tax: <span data-wcs="textContent: cart.tax|locale"></span></p>
<p>Grand Total: <span data-wcs="textContent: cart.grandTotal|locale"></span></p>
```

Dependency chain: `cart.grandTotal` → `cart.tax` → `cart.totalPrice` → `cart.items.*.subtotal` → `cart.items.*.unitPrice` / `cart.items.*.quantity`. Changing any item's `unitPrice` or `quantity` automatically recomputes the entire chain.

### Nested Wildcard Getters

Multiple wildcards are supported for nested array structures:

```html
<wcs-state>
  <script type="module">
    export default {
      categories: [
        {
          name: "Fruits",
          items: [
            { name: "Apple", price: 150 },
            { name: "Banana", price: 100 }
          ]
        },
        {
          name: "Vegetables",
          items: [
            { name: "Carrot", price: 80 }
          ]
        }
      ],
      get "categories.*.items.*.label"() {
        return this["categories.*.name"] + " / " + this["categories.*.items.*.name"];
      }
    };
  </script>
</wcs-state>

<template data-wcs="for: categories">
  <h3 data-wcs="textContent: .name"></h3>
  <template data-wcs="for: .items">
    <div data-wcs="textContent: .label"></div>
  </template>
</template>
<!-- Output:
  Fruits
    Fruits / Apple
    Fruits / Banana
  Vegetables
    Vegetables / Carrot
-->
```

### Flat Virtual Properties Across Any Depth

A key advantage of path getters is that **no matter how deeply data is nested, all virtual properties are defined flat in one place**. This eliminates the need to split components just to hold computed properties at each nesting level.

```javascript
export default {
  regions: [
    { name: "Kanto", prefectures: [
      { name: "Tokyo", cities: [
        { name: "Shibuya", population: 230000, area: 15.11 },
        { name: "Shinjuku", population: 346000, area: 18.22 }
      ]},
      { name: "Kanagawa", cities: [
        { name: "Yokohama", population: 3750000, area: 437.56 }
      ]}
    ]}
  ],

  // --- All flat, regardless of nesting depth ---

  // City level — virtual properties
  get "regions.*.prefectures.*.cities.*.density"() {
    return this["regions.*.prefectures.*.cities.*.population"]
         / this["regions.*.prefectures.*.cities.*.area"];
  },
  get "regions.*.prefectures.*.cities.*.label"() {
    return this["regions.*.prefectures.*.name"] + " "
         + this["regions.*.prefectures.*.cities.*.name"];
  },

  // Prefecture level — aggregate from cities. `indexes` omitted: it defaults to
  // the loop context ([$1, $2]), so only this prefecture's cities are summed
  get "regions.*.prefectures.*.totalPopulation"() {
    return this.$getAll("regions.*.prefectures.*.cities.*.population")
      .reduce((a, b) => a + b, 0);
  },

  // Region level — aggregate from prefectures (context [$1] narrows to this region)
  get "regions.*.totalPopulation"() {
    return this.$getAll("regions.*.prefectures.*.totalPopulation")
      .reduce((a, b) => a + b, 0);
  },

  // Top level — no loop context; [] means "every match"
  get totalPopulation() {
    return this.$getAll("regions.*.totalPopulation", [])
      .reduce((a, b) => a + b, 0);
  }
};
```

Three levels of nesting, five virtual properties — all defined side by side in a single flat object. Each level can reference values from any depth, and aggregation flows naturally from bottom to top via `$getAll`. In component-based frameworks, the typical approach is to create a separate component for each nesting level and pass computed values through the tree. Path getters offer a different trade-off by keeping all definitions in one place.

### Accessing Sub-Properties of Getter Results

When a path getter returns an object, you can access its sub-properties via dot-path:

```javascript
export default {
  products: [
    { id: "P001", name: "Widget", price: 500, stock: 10 },
    { id: "P002", name: "Gadget", price: 1200, stock: 3 }
  ],
  cart: {
    items: [
      { productId: "P001", quantity: 2 },
      { productId: "P002", quantity: 1 }
    ]
  },
  get productByProductId() {
    return new Map(this.products.map(p => [p.id, p]));
  },
  // Returns the full product object
  get "cart.items.*.product"() {
    return this.productByProductId.get(this["cart.items.*.productId"]);
  },
  // Access sub-property of the returned object
  get "cart.items.*.total"() {
    return this["cart.items.*.product.price"] * this["cart.items.*.quantity"];
  }
};
```

`this["cart.items.*.product.price"]` transparently chains through the object returned by the `cart.items.*.product` getter.

### Path Setters

Custom setter logic can be defined with `set "path"()`:

```javascript
export default {
  users: [
    { firstName: "Alice", lastName: "Smith" },
    { firstName: "Bob", lastName: "Jones" }
  ],
  get "users.*.fullName"() {
    return this["users.*.firstName"] + " " + this["users.*.lastName"];
  },
  set "users.*.fullName"(value) {
    const [first, ...rest] = value.split(" ");
    this["users.*.firstName"] = first;
    this["users.*.lastName"] = rest.join(" ");
  }
};
```

```html
<template data-wcs="for: users">
  <input type="text" data-wcs="value: .fullName">
</template>
```

Two-way binding works with path setters — editing the input calls the setter, which splits and writes back to `firstName` / `lastName`.

### Supported Path Getter Patterns

| Pattern | Description | Example |
|---|---|---|
| `get prop()` | Top-level computed | `get total()` |
| `get "a.b"()` | Nested computed (no wildcard) | `get "cart.totalPrice"()` |
| `get "a.*.b"()` | Single wildcard | `get "users.*.fullName"()` |
| `get "a.*.b.*.c"()` | Multiple wildcards | `get "categories.*.items.*.label"()` |
| `set "a.*.b"(v)` | Wildcard setter | `set "users.*.fullName"(v)` |

### How It Works

1. **Context resolution** — When a `for:` loop renders, each iteration pushes a `ListIndex` onto the address stack. Inside a path getter, `this["users.*.name"]` resolves the `*` using this stack, so it always points to the current element.

2. **Automatic dependency tracking** — When a getter accesses `this["users.*.name"]`, the system registers a dynamic dependency from `users.*.name` to the getter's path. When `users.*.name` changes, the getter's cache is dirtied.

3. **Caching** — Getter results are cached per concrete address (path + loop index). `users.*.fullName` at index 0 has a separate cache entry from index 1. The cache is invalidated only when dependencies change.

4. **Direct index access** — You can also access specific elements by numeric index: `this["users.0.name"]` resolves as `users[0].name` without needing loop context.

### Getters must be pure with respect to state

A getter's cache is invalidated **only** through the dependency graph, and the graph only records what the getter read **through `this`**. Anything else a getter reads is invisible to invalidation, so the first value computed is the value you keep:

```javascript
// ❌ Never recomputes — nothing in the dependency graph ever changes
get stamp() { return `${this.label} @ ${Date.now()}`; }   // Date.now() is untracked
get theme() { return document.body.dataset.theme; }        // the DOM is untracked
get total() { return this.price * exchangeRate; }          // a module variable is untracked
```

The rule: **read only through `this`, and don't write state or touch the DOM from a getter.** For the cases where an untracked input genuinely has to participate, put the input into state and assign to it (the normal path-assignment contract), or use the escape hatches:

| API | Use it for |
|---|---|
| `this.$trackDependency(path)` | Register an extra dependency so this getter is dirtied when that path changes |
| `this.$postUpdate(path)` | Announce that an untracked input changed, from outside the getter |
| `this.$untrackDependency(fn)` | Read a path *without* registering it as a dependency (the inverse) |

```javascript
// ✅ The clock ticks in state; the getter stays pure
export default {
  now: Date.now(),
  get stamp() { return `${this.label} @ ${this.now}`; },
  $connectedCallback() { setInterval(() => { this.now = Date.now(); }, 1000); },
};
```

Getters that throw are not swallowed: the exception surfaces where the getter was evaluated (a binding apply, a `$watch` evaluation, or your own read).

#### Dependency tracking boundaries

Three rules decide what the dependency graph sees. None of them matters until you cross one, and when you do the symptom is a value that stops updating with no error — so they are collected here:

| Rule | What it looks like when crossed |
|---|---|
| **Only path reads through `this` are tracked.** `this.form` tracks `form`; `this["form.name"]` tracks `form.name`; `this.form.name` tracks **`form` only** — the `.name` is a plain property access on the object that came back. `Date.now()`, the DOM, a module variable, a closed-over object register nothing | The getter is never re-evaluated for that input; the first value sticks (the examples above). A getter that reads `this.form.name` does not re-run when a bound `<input data-wcs="value: form.name">` changes — read `this["form.name"]` |
| **Reads inside a setter are not tracked.** A setter is an imperative assignment, not a derivation, so nothing it reads becomes a dependency of anything | A setter that reads `this.a` to decide what to write does not run again when `a` changes — only a getter re-runs |
| **The same-value guard applies to primitives only.** A primitive write `Object.is`-equal to the current value is dropped before anything is enqueued; an object or array write always passes, even the same reference | Assigning the same string again fires nothing; assigning the same object again re-fires its bindings and `$watch` (`config.sameValueGuard`; a `semantics: "event"` property is exempt either way) |

The first rule is the one static analysis can catch: `wcs-validate` and the VS Code extension report `wcs/getter-untracked-read` when a getter reads `this.form.name` and the document writes `form.name` somewhere (a `value:` binding, a spread, `this["form.name"] = …`). A root that is only ever replaced wholesale — router params, a `$streams` fold — is left alone.

`$untrackDependency(fn)` applies the setter rule to a getter on purpose: reads inside `fn` are not tracked. `$trackDependency(path)` is the escape hatch for the first rule.

### Loop Index Variables (`$1`, `$2`, ...)

Inside getters and event handlers, `this.$1`, `this.$2`, etc. provide the current loop iteration index (0-based value, 1-based naming):

```javascript
export default {
  users: ["Alice", "Bob", "Charlie"],
  get "users.*.rowLabel"() {
    return "#" + (this.$1 + 1) + ": " + this["users.*"];
  }
};
```

```html
<template data-wcs="for: users">
  <div data-wcs="textContent: .rowLabel"></div>
</template>
<!-- Output:
  #1: Alice
  #2: Bob
  #3: Charlie
-->
```

For nested loops, `$1` is the outer index and `$2` is the inner index.

You can also display the loop index directly in templates:

```html
<template data-wcs="for: items">
  <td>{{ $1|inc(1) }}</td>  <!-- 1-based row number -->
</template>
```

### Proxy APIs

Inside state objects (getters / methods), the following APIs are available via `this`:

| API | Description |
|---|---|
| `this.$getAll(path, indexes?)` | Get all values matching a wildcard path |
| `this.$setAll(path, indexes, value, options?)` | Write to every address matching a wildcard path |
| `this.$resolve(path, indexes, value?)` | Resolve a wildcard path with specific indexes |
| `this.$postUpdate(path)` | Manually trigger update notification for a path |
| `this.$trackDependency(path)` | Manually register a dependency for cache invalidation |
| `this.$untrackDependency(fn)` | Read values inside fn without registering dependencies (symmetric to `$trackDependency`) |
| `this.$command.<name>` | Access a `CommandToken` declared in `$commandTokens` (see [Command Token](#command-token-method-binding)) |
| `this.$stateElement` | Access to the `IStateElement` instance |
| `this.$1`, `this.$2`, ... | Current loop index (1-based naming, 0-based value) |

#### `$getAll` — Aggregate Across Array Elements

`$getAll` collects all values that match a wildcard path, returning them as an array. Essential for aggregation patterns:

```javascript
export default {
  scores: [85, 92, 78, 95, 88],
  get average() {
    const all = this.$getAll("scores.*", []);
    return all.reduce((sum, v) => sum + v, 0) / all.length;
  },
  get max() {
    return Math.max(...this.$getAll("scores.*", []));
  }
};
```

`indexes` is a **prefix** over the path's wildcards: missing levels expand fully, and `[]` always means "every match". When `indexes` is **omitted**, it defaults to the enclosing loop context (`[$1, $2, ...]`), applied to the wildcard levels the path shares with that context:

```javascript
export default {
  regions: [ /* { prefectures: [ { population: … }, … ] } */ ],
  // Loop context [$1] — omission narrows to the current region
  get "regions.*.total"() {
    return this.$getAll("regions.*.prefectures.*.population").reduce((a, b) => a + b, 0);
  },
  // No loop context — omission expands everything (same as [])
  get grandTotal() {
    return this.$getAll("regions.*.total").reduce((a, b) => a + b, 0);
  }
};
```

Context levels deeper than the path needs are dropped (a `[$1, $2]` context narrows a one-wildcard path by `[$1]`). But if the path shares **no** wildcard level with a context that does hold loop indexes — say `$getAll("users.*.name")` inside a `regions.*` getter — `$getAll` **throws** instead of silently reading every user: the context indexes belong to a different list, and neither reusing nor ignoring them is what the author meant. Pass indexes explicitly there (`[]` for every match).

#### `$setAll` — Update Every Array Element In Place

`$setAll` is the write-side counterpart of `$getAll`: it writes to every address a wildcard path matches. The point is not brevity but **keeping the array itself**. Rebuilding it (`this.users = this.users.map(...)`) throws away the list indexes, the per-row getter caches, and the render diff; `$setAll` decomposes into in-place per-row writes instead, so the list identity survives.

```javascript
export default {
  users: [{ selected: false }, { selected: false }],

  toggleAll(e) {
    this.$setAll("users.*.selected", [], e.target.checked);   // broadcast
  },
  invertAll() {
    this.$setAll("users.*.selected", [], cur => !cur);        // mapper
  },
  rankTopThree() {
    // `undefined` skips that address — "leave this row alone"
    this.$setAll("users.*.score", [], (cur, i) => i < 3 ? cur * 2 : undefined);
  }
};
```

Three forms, and the third one has to be asked for explicitly:

| Third argument | Meaning |
|---|---|
| a function | **mapper** — called as `(current, ...indexes)` per matched address |
| anything else | **broadcast** — the same value is written everywhere, arrays included |
| an array **plus** `{ spread: true }` | **spread** — one entry handed to each matched address, in match order |

Arrays broadcast by default because the target property may itself be array-valued — `$setAll("users.*.tags", [], ["admin"])` would otherwise be ambiguous. Opting into `{ spread: true }` removes the guesswork, and a length that does not equal the match count throws rather than silently misaligning.

`indexes` works exactly as in `$getAll` — a **prefix**, where missing levels mean "expand all of them" — but it is **required**. Writes get no implicit loop context, so inside a `for` template `this.$setAll("users.*.selected", [], true)` still means *every* user, never the current row.

```javascript
this.$setAll("matrix.*.*", [0], 0);        // row 0 only, every column
this.$setAll("users.*", [], rows, { spread: true });   // replace each row, keep the array
```

`undefined` is never written — it means "skip this address" in all three forms, which keeps a mapper that forgets to `return` from wiping every row. Use `null` to clear. The return value is the number of addresses actually written.

One thing `$setAll` is not: a shortcut for the dependency walk. Rendering still coalesces into a single batch, but each write is enqueued individually, so the cost matches the hand-written loop it replaces. What it buys you is the preserved list, not fewer cycles.

#### `$resolve` — Access by Explicit Index

`$resolve` reads or writes a value at a specific wildcard index:

```javascript
export default {
  items: ["A", "B", "C"],
  swapFirstTwo() {
    const a = this.$resolve("items.*", [0]);
    const b = this.$resolve("items.*", [1]);
    this.$resolve("items.*", [0], b);
    this.$resolve("items.*", [1], a);
  }
};
```

Swapping rows this way moves the rendered rows with their values once the swap is complete: the row blocks are reordered rather than rewritten in place, so a row's `$1` and any state it holds outside bindings (such as text typed into an unbound input) follow the value. Writing a value that was not in the list replaces that row in place: its block stays where it is and its bindings show the new value, so an input bound to the row keeps focus while you type. In a list of primitives, equal values cannot be told apart, so writes that end in a reordering of the same values count as a swap.

## Recursive Paths (`$recursion`)

A path burns its depth into the string. `nodes.*.children.*.total` has exactly two wildcard levels, and nothing about it stretches to three when the tree grows a level — but a tree's depth belongs to the data, not to the code. `$recursion` closes that gap: declare where the shape repeats, then write `**` for "however deep this is".

```javascript
export default {
  $recursion: { "nodes.*": "children.*" },   // anchor → repeating sub-path

  nodes: [
    { value: 1, selected: false, children: [
      { value: 10, selected: false, children: [
        { value: 100, selected: false, children: [] }
      ]},
      { value: 20, selected: false, children: [] }
    ]},
    { value: 2, selected: false, children: [] }
  ],

  // One getter, every depth: `**` is bound to the depth being evaluated
  get "nodes.**.total"() {
    return this["nodes.**.value"]
         + this.$getAll("nodes.**.children.*.total").reduce((a, b) => a + b, 0);
  },

  // Whole-tree aggregate: `[]` unions every depth
  get treeTotal() {
    return this.$getAll("nodes.**.value", []).reduce((a, b) => a + b, 0);
  },

  clearSelection() {
    this.$setAll("nodes.**.selected", [], false);
  }
};
```

For that forest the totals are `131 / 110 / 100 / 20 / 2` and `treeTotal` is `133`.

**`**` is authoring notation only — it never reaches the engine.** Reading a concrete path (`nodes.*.children.*.total`) materializes the getter for *that* depth on demand, one accessor per depth you actually touch, and everything downstream — `PathInfo`, the dependency graph, `$1`…`$n`, `$resolve`, the list diff — still sees an ordinary fixed-arity path. The reactive core did not learn a new shape.

### Declaring the recursion point

`$recursion` maps one **anchor** to the **repeating sub-path** that descends one level. Both name the *element* of a list — a fixed property chain ending in `.*`, never the list itself:

```javascript
$recursion: { "nodes.*": "children.*" }     // nodes[i].children[j].children[k]…
$recursion: { "data.tree.*": "kids.*" }     // a deeper anchor is fine
$recursion: { "nodes.*": "nodes.*" }        // self-similar spelling is fine too
```

The declaration is what gives `**` a meaning at all: with no `$recursion` on the state, `**` is not a path character (`wcs/recursion-unsupported`), so the notation can never quietly slide into a descendant search. This version accepts **exactly one self-recursive anchor per state**. A wildcard in the middle of an anchor, a second entry, mutual recursion between two anchors, a second `**` in one path, `get "nodes.**"` (that names the node itself, not a computed path under it), a `**` getter whose suffix names the structure (`get "nodes.**.children"()`, `.children.*`, `.children.length` — it would hide the real child list at every depth), two `**` getters that expand to the same concrete path, and recursive *setters* are all rejected when the declaration is read — never reinterpreted.

The family a declaration defines is infinite, and the state only ever grows the depths it is asked for:

```
k=0   nodes.*
k=1   nodes.*.children.*
k=2   nodes.*.children.*.children.*
```

### What `**` means where

`**` is a variable over depth, and whether it is *bound* or *unioned* is decided by context — the same split `*` already has between "the current row" and "every row":

| Where `**` appears | What it means |
|---|---|
| A getter key — `get "nodes.**.total"()` | Bound to the depth being evaluated |
| A path read inside that getter — `this["nodes.**.value"]` | Bound to the same depth |
| `$getAll(path)`, indexes **omitted** | Bound to that depth; only the wildcards *after* `**` expand |
| `$getAll(path, [])`, **explicit** | **Union of every depth** — depth-first, pre-order, ascending index |
| `$getAll(path, [i, …])` | Rejected: a prefix cannot say which depth it applies to (`wcs/recursion-getall-form`) |
| `$setAll(path, [], value)` | Broadcast to every depth, in that same order |
| `$resolve`, `$postUpdate`, `$trackDependency`, `$watch` keys, `$listKeys` keys, `data-wcs` in markup, direct assignment | Rejected (`wcs/recursion-unsupported`) |

The bound forms need a depth to bind to, so they only resolve **inside** a recursive getter — or inside an ordinary row getter under the anchor, or an event handler bound to such a row — each of those carries a real `ListIndex` to read the depth from. Read `this["nodes.**.value"]` from the top level and you get `wcs/recursion-context`, not a silent guess at which node you meant. The depth is read from the innermost evaluation frame only, the same frame the row index comes from: a plain getter that a recursive getter calls (`get "nodes.**.x"() { return this.helper }` with `get helper() { return this["nodes.**.value"] }`) has no row of its own and gets `wcs/recursion-context` too — read `**` in the recursive getter and pass the value on. The union form needs no depth, so it can be read from anywhere: a top-level getter, a plain row getter, a method.

```javascript
this.$getAll("nodes.**.value", []);   // [1, 10, 100, 20, 2] — depth-first, pre-order
```

Wildcards *after* `**` expand at each node in the ordinary fixed-arity order, and the walk finishes them before descending to that node's children. With `tags` on the nodes above (`1` → `[3, 4]`, `10` → `[5]`, `20` → `[7]`, the rest empty):

```javascript
this.$getAll("nodes.**.tags.*.v", []);   // [3, 4, 5, 7] — node 1's tags, then node 10's, then node 20's
```

### Aggregating without counting grandchildren twice

That split is the whole game for aggregation, because the recursive getter is what folds the tree:

```javascript
// ✅ Omitted — bound to this depth, so the sum walks only the direct children
get "nodes.**.total"() {
  return this["nodes.**.value"]
       + this.$getAll("nodes.**.children.*.total").reduce((a, b) => a + b, 0);
}

// ❌ `[]` — every child total at every depth. Each node's total would contain its
//    own descendants' totals again, and the getter ends up asking for itself: in
//    practice you do not get a wrong number, you get `wcs/getter-cycle`.
get "nodes.**.total"() {
  return this["nodes.**.value"]
       + this.$getAll("nodes.**.children.*.total", []).reduce((a, b) => a + b, 0);
}
```

The same mistake made from *outside* the recursion is the quiet one — there is no cycle to trip over, just a plausible number that is too big. A union of an aggregate counts every grandchild once inside its parent's total, and once more as an element of the union:

```javascript
// ❌ 363 — every node's total, and every total already contains its subtree
get treeTotalWrong() {
  return this.$getAll("nodes.**.total", []).reduce((a, b) => a + b, 0);
}
// ✅ 133 — union the raw leaf values
get treeTotal() {
  return this.$getAll("nodes.**.value", []).reduce((a, b) => a + b, 0);
}
// ✅ 133 — or add up the roots, since each root total already folds its subtree
get treeTotalFromRoots() {
  return this.$getAll("nodes.*.total", []).reduce((a, b) => a + b, 0);
}
```

**Union raw values, or sum the roots — never union something that already aggregates its own subtree.** Whether an aggregate double-counts is not decidable from the path string, so no diagnostic claims to catch this one.

### Writing: broadcast only

`$setAll` accepts `**` in exactly one form — `[]` plus a plain value — and returns the number of addresses written (5 for the forest above):

```javascript
this.$setAll("nodes.**.selected", [], false);   // every node, at every depth
```

Every other form is refused *before* the walk writes anything, so a rejected call leaves the tree untouched. That guarantee covers the checks on the *form*; a leaf under an index spelling (`nodes.**.children.0.value`) can still stop part-way on the *data* — a node whose `children` is empty has no child `0` to write into — exactly as the fixed-arity `$setAll("nodes.*.children.0.value", [], v)` does.

| Form | Why it is refused |
|---|---|
| a non-empty prefix | A prefix cannot say which depth it applies to (`wcs/recursion-setall-form`) |
| omitted indexes | The write API takes no context, so there is no depth to bind to — pass `[]` |
| a mapper function | `(current, ...indexes)` has a different arity at every depth |
| `{ spread: true }` | Handing a flat array to a tree needs the author to know the walk order |
| `nodes.**`, `nodes.**.children`, `nodes.**.children.*`, `nodes.**.children.length` — and, for a multi-segment repeat such as `branch.children.*`, the `nodes.**.branch` on the way to the list. Index spellings fold to the same forms: `nodes.**.children.0` is a child node, `nodes.**.children.0.total` is the getter | Writing the structure itself (assigning `length` truncates the list) invalidates the child addresses this very write already resolved (`wcs/recursion-structural-write`) |
| `nodes.**.total`, or a path inside its value | A recursive getter has no setter — write what it derives from (`wcs/recursion-readonly`) |

The read-only rule does not depend on spelling `**`. A recursive getter's concrete expansions — `nodes.*.total`, `nodes.*.children.*.total`, … — are refused at the write entry as well, whether the write is a fixed-arity `$setAll`, a `$resolve(path, indexes, value)` or a direct assignment, and whether or not that depth has been materialized yet. Before this check, an unmaterialized expansion looked like a plain missing key and the write landed on the node object, pinning the assigned value as the getter's cached result.

### The input has to be a tree

The walk descends by depth and checks the shape it needs as it goes: reaching the **same array instance** twice is refused. If that array belongs to one of the current node's ancestors it is a cycle (`wcs/recursion-cycle`); otherwise two nodes share one child list (`wcs/recursion-shared-list`). Give every node its own `children` array — sharing an *empty* one is fine and untracked, because it has no rows to alias.

Replacing a row object while keeping its `children` array — `this.nodes = this.nodes.map(n => ({ ...n }))` — is an ordinary update, and the aggregates follow it. The child list keeps its existing row objects — so anything keyed by row identity, such as a `bind-component` child scope's rendered rows and any state you have not bound there, survives — and only the retired row they hung under is swapped for the live one, so the next leaf update dirties the row that is actually on screen ([#256](https://github.com/wcstack/wcstack/issues/256)). Two rows *sharing* one `children` array is a different thing. While both rows are in the list it is unchanged: an array has one set of rows, so both rows always agree on every value, and a row getter that reads its parent (`this["nodes.*.value"]`) is evaluated in the context of the row that owns those rows — the one that first expanded the array. What changed is what happens when that owner is removed from the list: the rows follow one of the rows still on screen, so that row's aggregate tracks the shared data instead of freezing at the removed row's numbers — an array still has one set of rows, so with three rows sharing one array a single survivor follows and the others stay frozen. Putting the removed row back hands them straight back to it when that row's own object comes back — whether you reassign the same array instance, build a new array holding the same rows, or put the row back at a different position. When every row is rebuilt instead (`this.nodes = this.nodes.map(n => ({ ...n }))`), no row object matches and the rows end up under whichever row now occupies the owner's old position. Only the same-array-instance restore behaves this way on 2.3.0; restoring with a new array leaves both rows frozen there. Give every node its own array when a child getter reads upward.

The ceiling is **128 wildcard levels** on the expanded path. The aggregate above reads one level below the node it is evaluating, so it folds a chain 127 deep and stops at 128 with `wcs/recursion-depth-exceeded`, naming the anchor, the depth reached, the path it was building, and the limit. That check trips before the getter stack's own 128-frame limit (`wcs/getter-depth-exceeded`), so a deep tree is reported as deep instead of being accused of a cycle. Nothing is truncated on the way: a partial aggregate would be a wrong number reported as a right one.

### Rendering the tree

`**` cannot appear in markup and there is no recursive `<template>`. A tree is rendered by a **self-referential component** — one custom element whose shadow mounts itself for each child. Inside every scope only one level of path is ever used (`node.children.*`), so the markup does not depend on the depth, and `node.total` resolves through the mount onto the root state's recursive getter, so each node shows its own subtree's aggregate.

```html
<!-- host -->
<template data-wcs="for: nodes">
  <tree-node data-wcs="state.node: nodes.*"></tree-node>
</template>
```

```javascript
const markup = `
  <wcs-state bind-component="state"></wcs-state>
  <span data-wcs="textContent: node.label"></span>
  <span data-wcs="textContent: node.total"></span>
  <template data-wcs="for: node.children">
    <tree-node data-wcs="state.node: node.children.*"></tree-node>
  </template>`;

customElements.define("tree-node", class extends HTMLElement {
  state = {};                            // ← no own `node` key — it arrives from the mount
  constructor() { super(); this.attachShadow({ mode: "open" }); }
  connectedCallback() {                  // ← build the shadow here, not in the constructor
    if (this.shadowRoot.childNodes.length === 0) this.shadowRoot.innerHTML = markup;
  }
});
```

Two things bite here, and both were hit for real:

- **The component's `state` must not declare the key it is mounted over.** Unrelated methods and private keys are fine — a `node` of its own is not: it hides the mount, so the child shows its own default and never descends. The runtime names that one (`wcs/mount-own-key-shadow`).
- **Build the shadow in `connectedCallback`, not in the constructor.** Assigning `innerHTML` in the constructor upgrades the elements inside `<template>` on implementations that do not keep template content inert, and a self-referential element then recurses forever in its own constructor. Real browsers survive it, which makes it an environment-dependent trap rather than an honest crash.

Fixed depths need none of this: the expanded paths are ordinary paths, so nested `for` templates bind `nodes.*.total` and `nodes.*.children.*.total` like anything else.

### Not in this version

Each of these is a diagnostic, never a silent reinterpretation:

- More than one anchor, mutual recursion, a wildcard in the middle of an anchor, a second `**` in one path
- Recursive setters, a `**` getter whose suffix names the structure (`get "nodes.**.children"()`), a concrete getter with the same name as a `**` getter's expansion, and writing through `**` by assignment (`this["nodes.**.x"] = v`, `++` included)
- In a recursive `$setAll`: a mapper, `{ spread: true }`, omitted indexes, a non-empty prefix, or a non-array `indexes`. The write API has no evaluation context to bind a depth to, so `[]` is mandatory
- In a recursive `$getAll`: a non-empty prefix, or a non-array `indexes`. **Omitting the indexes is valid** — inside a recursive getter it is the bound form, and it reads the depth being evaluated
- `**` in `data-wcs`, in `$watch` or `$listKeys` keys, or in `$resolve` / `$postUpdate` / `$trackDependency`
- `$recursion` and `**` getters in a volume (`mount=`) or a mounted component (`bind-component`) — declare them on the root state
- A recursive `<template>`, a `$depth` variable, and a public `maxDepth` option — none of the three exist

## Event Handling

Bind event handlers with `on*` properties:

```html
<button data-wcs="onclick: handleClick">Click me</button>
<form data-wcs="onsubmit#prevent: handleSubmit">...</form>
```

Handler methods receive the event and loop indexes:

```javascript
export default {
  items: ["A", "B", "C"],
  handleClick(event) {
    console.log("clicked");
  },
  removeItem(event, index) {
    // index is the loop context ($1)
    this.items = this.items.toSpliced(index, 1);
  }
};
```

```html
<template data-wcs="for: items">
  <button data-wcs="onclick: removeItem">Delete</button>
</template>
```

## Filters

46 built-in filters are available for both input (DOM → state) and output (state → DOM) directions.

### Comparison

| Filter | Description | Example |
|---|---|---|
| `eq(value)` | Equal | `count\|eq(0)` → `true/false` |
| `ne(value)` | Not equal | `count\|ne(0)` |
| `not` | Boolean NOT | `isActive\|not` |
| `lt(n)` | Less than | `count\|lt(10)` |
| `le(n)` | Less than or equal | `count\|le(10)` |
| `gt(n)` | Greater than | `count\|gt(0)` |
| `ge(n)` | Greater than or equal | `count\|ge(0)` |

### Arithmetic

| Filter | Description | Example |
|---|---|---|
| `inc(n)` | Add | `count\|inc(1)` |
| `dec(n)` | Subtract | `count\|dec(1)` |
| `mul(n)` | Multiply | `price\|mul(1.1)` |
| `div(n)` | Divide | `total\|div(100)` |
| `mod(n)` | Modulo | `index\|mod(2)` |
| `abs` | Absolute value | `delta\|abs` |
| `clamp(min, max)` | Constrain to a range | `ratio\|clamp(0,100)` |

### Number Formatting

| Filter | Description | Example |
|---|---|---|
| `fix(n)` | Fixed decimal places | `price\|fix(2)` → `"100.00"` |
| `round(n?)` | Round | `value\|round(2)` |
| `floor(n?)` | Floor | `value\|floor` |
| `ceil(n?)` | Ceiling | `value\|ceil` |
| `locale(loc?)` | Locale number format | `count\|locale` / `count\|locale(ja-JP)` |
| `percent(n?)` | Percentage format | `ratio\|percent(1)` |
| `unit(u)` | Append a unit (any suffix) | `width\|unit(px)` → `"40px"` |

### String

| Filter | Description | Example |
|---|---|---|
| `uc` | Upper case | `name\|uc` |
| `lc` | Lower case | `name\|lc` |
| `cap` | Capitalize | `name\|cap` |
| `trim` | Trim whitespace | `text\|trim` |
| `slice(n)` | Slice string | `text\|slice(5)` |
| `substr(start, length)` | Substring | `text\|substr(0,10)` |
| `pad(n, char?)` | Pad start | `id\|pad(5,0)` → `"00001"` |
| `rep(n)` | Repeat | `text\|rep(3)` |
| `rev` | Reverse | `text\|rev` |
| `truncate(n, suffix?)` | Shorten and append an ellipsis | `title\|truncate(20)` |
| `join(sep?)` | Join an array (default `", "`) | `tags\|join` / `tags\|join(/)` |

### Type Conversion

| Filter | Description | Example |
|---|---|---|
| `int` | Parse integer | `input\|int` |
| `float` | Parse float | `input\|float` |
| `boolean` | To boolean | `value\|boolean` |
| `number` | To number | `value\|number` |
| `string` | To string | `value\|string` |
| `null` | To null | `value\|null` |

### Date / Time

| Filter | Description | Example |
|---|---|---|
| `date(loc?)` | Date format | `timestamp\|date` / `timestamp\|date(ja-JP)` |
| `time(loc?)` | Time format | `timestamp\|time` |
| `datetime(loc?)` | Date + Time | `timestamp\|datetime(en-US)` |
| `ymd(sep?)` | YYYY-MM-DD | `timestamp\|ymd` / `timestamp\|ymd(/)` |
| `hms(sep?)` | HH:MM:SS | `timestamp\|hms` / `timestamp\|hms(-)` |

### Boolean / Default

| Filter | Description | Example |
|---|---|---|
| `truthy` | Truthy check | `value\|truthy` |
| `falsy` | Falsy check | `value\|falsy` |
| `defaults(v)` | Fallback value | `name\|defaults(Anonymous)` |

### Filter Chaining

Filters can be chained with `|`:

```html
<div data-wcs="textContent: price|mul(1.1)|round(2)|locale(ja-JP)"></div>
```

## Web Component Binding

`@wcstack/state` supports bidirectional state binding with custom elements using Shadow DOM or Light DOM.

Many frameworks use patterns like prop drilling, context providers, or external stores (Redux, Pinia) to share state across components. `@wcstack/state` takes a different approach: parent and child components are connected through **path contracts** — the parent binds an outer state path to an inner component property via `data-wcs`, and the child simply reads and writes its own state as usual:

1. The child references and updates the parent's state through its own state proxy — no props, no events, no awareness of the parent.
2. When the parent's state changes, the Proxy `set` trap automatically notifies any child bindings that reference the affected path.
3. Because the only coupling is the **path name**, both sides stay loosely coupled. A Shadow DOM component also runs on its own ([standalone injection](#standalone-web-component-injection-e2esingle-component)); a Light DOM one does not — the host has to wire it.
4. The cost is path resolution (cached at O(1) after first access), change propagation through the dependency graph, and the per-row binding ledger the package builds for every row it renders.

This is cross-component state management built on path resolution rather than on component-level abstractions. It is not the cheapest way to render: [Performance](#performance) puts create and append at 2.5–3.5× [`@wcstack/signals`](../signals/), which is what the per-row ledger costs. What it buys is wiring that stays declarative and inspectable.

### Component Definition (Shadow DOM)

```javascript
class MyComponent extends HTMLElement {
  state = { message: "" };

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <wcs-state bind-component="state"></wcs-state>
      <div>{{ message }}</div>
      <input type="text" data-wcs="value: message" />
    `;
  }
}
customElements.define("my-component", MyComponent);
```

### Component Definition (Light DOM)

Light DOM components do not use Shadow DOM. In v2 the form is identical to the Shadow form — the component's bindings are translated onto the host's tree at its mount point, so **no name and no `@` selectors are needed**, and the same component can sit on every row of a list:

```javascript
class MyLightComponent extends HTMLElement {
  state = { message: "" };

  connectedCallback() {
    this.innerHTML = `
      <wcs-state bind-component="state"></wcs-state>
      <div data-wcs="text: message"></div>
      <input type="text" data-wcs="value: message" />
    `;
  }
}
customElements.define("my-light-component", MyLightComponent);
```

- `<wcs-state>` must be a direct child of the component element
- The host **must wire it** (`<my-light-component data-wcs="state.message: user.name">` or `state: user`) — a plain, unwired Light DOM `bind-component` cannot exist in v2 (an independent tree cannot share the parent's root). It fails loudly with the migration guidance: attach a shadow root, or mount it from the host.

> **Note**: `State.getBindingsReady(root)` covers mounted scopes once the mount record resolves; await
> the component's own `<wcs-state>` initialization when you need its contents rendered.

### Host Usage

```html
<wcs-state>
  <script type="module">
    export default {
      user: { name: "Alice" }
    };
  </script>
</wcs-state>

<!-- Bind component's state.message to outer user.name -->
<my-component data-wcs="state.message: user.name"></my-component>
```

- `bind-component="state"` maps the component's `state` property to `<wcs-state>`
- `data-wcs="state.message: user.name"` on the host element binds outer state paths to inner component state properties
- Changes propagate bidirectionally between the component and the outer state

### Whole-object Mount (`state: path`)

Instead of wiring the component's state property by property, the host can mount a **whole subtree** of its state as the component's root. Inside the component every path is then relative to the mount point:

```html
<!-- Host -->
<wcs-state json='{"user":{"name":"Alice","email":"alice@example.com"},"theme":{"mode":"light"}}'></wcs-state>
<user-card data-wcs="state: user"></user-card>
```

```javascript
// Component (Shadow DOM)
class UserCard extends HTMLElement {
  state = {
    // a getter computed over the mount — `this.name` is the tree's `user.name`
    get display() { return `${this.name} <${this.email}>`; },
  };
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }
  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <wcs-state bind-component="state"></wcs-state>
      <span data-wcs="textContent: name"></span>
      <span data-wcs="textContent: display"></span>
      <input data-wcs="value: name">
    `;
  }
}
customElements.define("user-card", UserCard);
```

- `state: user` mounts the component's root at the tree path `user`: `name` inside the component **is** `user.name`. Reads, writes (`value: name`, `this.state.name = ...`), getters and `for:` all resolve against the tree; the host's `this.user = {...}` replacement and `this["user.name"] = ...` writes both reach the component.
- A partial mount can sit next to it: `state: user; state.theme: theme` mounts `theme` as a second entry point (longest prefix wins, so `theme.mode` inside the component reads the tree's `theme.mode`).
- In a loop, mount **the row itself**: `<template data-wcs="for: users"><user-row data-wcs="state: ."></user-row></template>`. Inside the row component `name` is `users.*.name`, and its own `for: tags` runs over `users.*.tags.*`.
- **Own keys are private** (rule R1 in [docs/state-mount-design.md](../../docs/state-mount-design.md) §4-3): a data key the component declares itself (`state = { mode: "view" }`) belongs to that element and is never written to the tree. If it hides a key that exists at the mount point (`state = { name: "" }` mounted over `user.name`), the runtime warns once (`wcs/mount-own-key-shadow`) — remove the default to read the tree, or rename it to keep it private.
- Mounting an array as the root (`state: rows` with `for` over it inside) is not supported; mount the row (`state: .`) or the object that holds the array (`state: group` with `for: children` inside). Both forms are contract-tested; mounts are the only way to extend the tree.

> The per-property form (`state.message: user.name`) keeps working — it is a partial mount on
> the same machinery. R1 is strict for every mount form — a component that declares a default
> for a mapped key (`state = { message: "" }` together with `state.message: ...`) keeps its
> own key **private**, hiding the host value (a one-time `wcs/mount-own-key-shadow` warning
> points at it). Drop the default to read the tree. The mounted `<wcs-state>` needs no `name`
> in Light DOM, and `$getAll` / `$setAll` / `$resolve` / `$postUpdate` on `element.state`
> (and on `this` inside getters/methods) speak the component's own vocabulary — paths are
> translated onto the mount and the host row's indexes are prepended automatically.

#### Exported getters (reading a component's getter from outside)

A mounted component's getters are **exported** at the mount point: **a read of a key the tree does not have is answered by the getter of the component mounted there. A key the tree does have wins. Private keys and methods are never visible.** With the `user-card` above, the host can bind `session`-level markup to the component's derived value:

```html
<user-card data-wcs="state: user"></user-card>
<span data-wcs="textContent: user.display"></span>   <!-- "Alice <alice@example.com>" — the component's getter -->
```

- Row mounts export per row: `$getAll("users.*.display")` and `text: .display` inside the same `for` read each row component's getter. Dependencies flow through: when `user.name` changes, everything that read `user.display` re-renders.
- Accessors whose component-local path contains a wildcard, such as `get "children.*.label"()`, work inside the component but are **not exported**. Define `get label()` on a component mounted on each child row instead. Only accessors whose exported path has the mount point's wildcard count are exported.
- The parent evaluates before the child component registers, so the first read may see `undefined`; the value converges as soon as the component mounts. Write derived expressions defensively (`(x ?? 0)`).
- Missing-path warnings are deferred by one macrotask (`setTimeout(0)`), independently of `getBindingsReady`. With an autoloader or delayed custom-element definition, an initial warning may appear before the component registers, even when the binding eventually resolves.
- If the tree already has the key (including an inherited property), the tree wins and the runtime warns once (`wcs/mount-export-shadowed`). Two components exporting the same key on the same instance is a configuration error detected during candidate scans (`wcs/mount-export-ambiguous`). A validated cache hit does not rescan other candidates, so adding a conflicting component after the first resolution may escape detection.
- Writing to an exported key from outside runs the accessor's setter, or throws if it only has a getter (the tree never grows a key that would hide the getter). `in` does not see exported keys.
- **Self-recursive components** (trees of unbounded depth) become expressible: a component that renders `<template data-wcs="for: children"><tree-node data-wcs="state: ."></tree-node></template>` inside itself can define `get total() { return this.value + this.$getAll("children.*.total").reduce((a, b) => a + (b ?? 0), 0); }` — each level's formula closes over one level, and the ledger resolves the recursion. Paths cannot express recursion themselves (their wildcard count is fixed), so the recursion lives in the DOM and the paths are its unrolled form. Design: [docs/state-overlay-export-design.md](../../docs/state-overlay-export-design.md).

### Standalone Web Component Injection (`__e2e__/single-component`)

Even when a component is independent from outer host state, you can inject reactive state with `bind-component`.

```javascript
class MyComponent extends HTMLElement {
  state = Object.freeze({
    message: "Hello, World!"
  });

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <wcs-state bind-component="state"></wcs-state>
      <div>{{ message }}</div>
    `;
  }

  async $stateReadyCallback(stateProp) {
    console.log("state ready:", stateProp); // "state"
  }
}
customElements.define("my-component", MyComponent);
```

- Initial component `state` can be defined with `Object.freeze(...)` (it is replaced with a writable reactive state after injection)
- `bind-component="state"` exposes `this.state` as a state proxy powered by `@wcstack/state`
- Assignments like `this.state.message = "..."` immediately update `{{ message }}` inside Shadow DOM
- `async $stateReadyCallback(stateProp)` is called right after component state becomes ready for use (`stateProp` is the property name from `bind-component`)

### Constraints

- `<wcs-state>` with `bind-component` must be a **direct child** of the component element (top-level)
- The parent element must be a **custom element** (tag name containing a hyphen)
- Light DOM components must be wired from the host (the plain, unwired form was removed in v2)
- A **mounted** scope does not execute declaration surfaces: `$watch`, `$streams` and `$scan` are ignored there with a one-time warning, and `$recursion` / `**` getters are rejected. Declare them on the root state — a volume (`<wcs-state mount>`) can host `$watch`, while `$scan` and `$recursion` are root-only. An unwired Shadow DOM child owns an independent tree and can declare all of them

### Loop with Components

```html
<template data-wcs="for: users">
  <my-component data-wcs="state.message: .name"></my-component>
</template>

<!-- or mount the row itself: inside the component, `name` is `users.*.name` -->
<template data-wcs="for: users">
  <user-row data-wcs="state: ."></user-row>
</template>
```

### Rendering a List Inside the Component

An array can be bound into a component and iterated with `for:` **inside** it. The outer state
stays the source of truth; row additions, removals, reordering and row-field writes flow both ways.

```html
<!-- Host -->
<wcs-state json='{"rows":[{"name":"Alice"},{"name":"Bob"}]}'></wcs-state>
<my-list data-wcs="state.items: rows"></my-list>
```

```javascript
// Component (Shadow DOM)
this.shadowRoot.innerHTML = `
  <wcs-state bind-component="state"></wcs-state>
  <ul>
    <template data-wcs="for: items">
      <li data-wcs="textContent: .name"></li>
    </template>
  </ul>
`;
```

- Replacing `rows` or writing a single row field (`rows.0.name`) both reach the rows inside the component
- Writing `items.*.name` from inside the component reaches the host's `rows`

#### Nesting and stacking scopes

A component that sits inside a host `for:` *and* runs its own `for:` over the array it was handed
is supported. The framework keeps the outer row and the inner row related:

```html
<template data-wcs="for: groups">
  <my-list data-wcs="state.items: groups.*.children"></my-list>
</template>
```

Components can also be placed inside components, **stacking scopes**. An intermediate component
that only passes the array through — running no `for:` of its own — still lets a row-field write
from the owning scope reach the rows at the bottom.

A component's author never has to know how deeply it is placed. `$1`, event-handler indexes,
`$updatedCallback` and `$getAll` all report positions **within the component's own scope**.

## Command Token (Method Binding)

Property binding (`state.message: user.name`) covers data flowing into a component, but it does not cover **invoking a method on a component from state** — `<wcs-fetch>.fetch()`, `<wcs-dialog>.open()`, and so on. **Command tokens** fill that gap with a typed pub/sub channel:

- The element subscribes via `command.<methodName>: $command.<tokenName>`
- State emits via `this.$command.<tokenName>.emit(...args)`
- Arguments passed to `emit` are forwarded to the element's method
- One token can fan out to multiple elements; the subscriber order is preserved

This keeps the path contract intact: state never holds a reference to the element, and the element never imports anything from state. The token is the only shared object.

### Basic Usage

```html
<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["fetchUsers", "refreshOrders"],

      onClickFetch() {
        this.$command.fetchUsers.emit("/api/users", { method: "GET" });
      },
      onClickRefresh() {
        this.$command.refreshOrders.emit();
      }
    };
  </script>
</wcs-state>

<!-- Subscribers — must be wc-bindable custom elements -->
<wcs-fetch data-wcs="command.fetch: $command.fetchUsers"></wcs-fetch>
<wcs-fetch data-wcs="command.fetch: $command.refreshOrders"></wcs-fetch>

<button data-wcs="onclick: onClickFetch">Fetch users</button>
<button data-wcs="onclick: onClickRefresh">Refresh orders</button>
```

When `onClickFetch` runs, every element subscribed to the `fetchUsers` token has its `fetch(...)` method called with the forwarded arguments.

### `$commandTokens` Declaration

The `$commandTokens` array declares the channels exposed under the `$command` namespace on state. Tokens are accessed as `this.$command.<name>` and are memoized — the same name always returns the same token instance.

```javascript
export default {
  $commandTokens: ["fetchUsers", "refreshOrders"],

  click() {
    this.$command.fetchUsers.emit("/api/users");
  }
};
```

- Entries must be non-empty strings
- Duplicate entries throw an error at initialization
- The reserved name `$command` itself cannot appear in the array
- Tokens are gathered under `$command` so they do not pollute the top-level state namespace; reactive properties with the same name as a token can coexist
- Accessing an undeclared name on `$command` (e.g. `this.$command.typo`) returns `undefined`. The typo then surfaces as a `TypeError` on the subsequent `.emit()` call, or — when used as a binding right-hand side — as a "requires a CommandToken value" error at binding time

### `command.<methodName>:` Binding

```html
<wcs-fetch data-wcs="command.fetch: $command.fetchUsers"></wcs-fetch>
```

| Part | Description |
|---|---|
| `command.` | Fixed prefix |
| `<methodName>` | The element's method to invoke. The name must appear as `{ name: "<methodName>" }` in `static wcBindable.commands` |
| `$command.<tokenName>` | Explicit namespace path that resolves to a `CommandToken`. `<tokenName>` must be a name declared in `$commandTokens` |

The right-hand side must be written as `$command.<tokenName>` — the bare-name shorthand (`fetchUsers`) is not supported. Going through the `$command.` namespace makes the binding's intent explicit in the HTML and keeps the top-level state namespace free of token names.

`wcBindable.commands` follows the wc-bindable v1 spec shape — an array of `{ name: string; async?: boolean }`:

```javascript
class MyFetcher extends HTMLElement {
  static wcBindable = {
    protocol: "wc-bindable", version: 1,
    properties: [],
    commands: [
      { name: "fetch", async: true },
      { name: "reset" },
    ],
  };
  fetch(url) { /* ... */ }
  reset()    { /* ... */ }
}
```

> **Breaking change since v1.9.1**: the `commands` field is now an array of `{ name, async? }` objects. The earlier `commands: ["fetch"]` plain-string form is no longer accepted — bindings against such declarations throw `Command "<name>" is not declared in wcBindable.commands`. There is no legacy fallback; update the declaration to the object form.

Validation rules (enforced at binding time):

- The element must be a custom element exposing `static wcBindable` with `protocol: "wc-bindable"` and an integer `version` of `1` or later (the current protocol version is `1`; all versions ≥ 1 are core-compatible)
- `methodName` must appear (by `name`) in `wcBindable.commands`
- The bound value must be a `CommandToken` (assigning a non-token value throws — for example, an undeclared name like `$command.typo` resolves to `undefined` and is rejected here)

### Token API

```typescript
interface CommandToken {
  readonly name: string;
  readonly size: number;                            // current subscriber count
  subscribe(fn: (...args) => unknown): () => void;  // returns unsubscribe
  unsubscribe(fn: (...args) => unknown): boolean;
  emit(...args: unknown[]): unknown[];              // returns subscriber results in subscribe order
}
```

`emit` returns an array of return values from each subscriber (in subscribe order). For `Promise`-returning methods, wrap with `Promise.all(token.emit(...))` to await all of them.

### Subscription Lifecycle

- The subscriber holds the element via `WeakRef`, so a removed element can still be garbage collected even while it remains in the token's subscriber set
- On `emit`, if the WeakRef has been collected or the element is no longer connected (`isConnected === false`), the subscription is purged automatically (lazy purge)
- Disconnecting the owning `<wcs-state>` keeps the token registry, so the subscriptions still receive commands after the root `<wcs-state>` is re-attached (for example when its host moves in the DOM). While it is disconnected, the state cannot be created, so nothing emits through `$command`

The element's method is invoked with the arguments from `emit`:

```javascript
this.$command.fetchUsers.emit(url, options);
// → element.fetch(url, options) on every subscriber
```

### Emitting a Command from a DOM Event

A command token does not have to be emitted from state code. A DOM event binding can emit one directly by pointing its right-hand side at a `$command.<name>` path instead of a state method name:

```html
<button data-wcs="onclick: $command.refreshList">Refresh</button>
```

| Form | Right-hand side | Behavior on event |
|---|---|---|
| `onclick: someMethod` | a state method name | `state.someMethod(event, ...listIndexes)` |
| `onclick: $command.someToken` | a `$command.<name>` path | `state.$command.someToken.emit(event, ...listIndexes)` |

This is pure wiring: the event endpoint is connected to a command-token endpoint, with no logic in between. The `emit` arguments are passed through exactly like a handler call — the DOM `Event` first, then any enclosing list indexes — so subscribers receive `(event, ...listIndexes)`. Inside a subscriber, pull what you need from the event (`event.target.value`, `event.detail`, …).

- The right-hand side must be `$command.<name>` with `<name>` declared in `$commandTokens`. A path that does not resolve to a `CommandToken` (e.g. a typo) throws at event time.
- Modifiers work unchanged: `onclick#prevent: $command.someToken` calls `preventDefault()` before emitting (`#stop` likewise).
- This emits the same token the state emits, so element subscribers wired with `command.<method>: $command.someToken` receive it regardless of who pulled the trigger.

```html
<!-- click fans the command out to every subscriber, no state method needed -->
<button data-wcs="onclick: $command.reset">Reset all</button>
<my-field data-wcs="command.clear: $command.reset"></my-field>
<my-list  data-wcs="command.reset: $command.reset"></my-list>
```

## Event Token (Event Binding)

Command tokens push *into* a component (state invokes a method). **Event tokens** are the exact dual — they pull *out* of a component (an element dispatches an event, state receives it). Together they cover both directions of the element ↔ state boundary, and neither side ever holds a reference to the other — the token is the only shared object.

| Token | Direction | Subscribes | Emits |
|---|---|---|---|
| **Command token** | state → element | element (`command.<method>:`) | state (`$command.<name>.emit`) |
| **Event token** | element → state | state (`$on`) | element (DOM event listener) |

- The element wires `eventToken.<property>: <tokenName>` on a wc-bindable custom element.
- State declares channels with `$eventTokens` and receives them with the `$on` map.
- Subscribers are called as `(state, event, ...listIndexes)` — symmetric with the command-token emit convention.

### Basic Usage

```html
<wcs-state>
  <script type="module">
    export default {
      users: [],
      error: null,

      $eventTokens: ["userCreated", "createFailed"],
      $on: {
        userCreated(state, event) {
          state.users = state.users.concat(event.detail);
        },
        createFailed(state, event) {
          state.error = event.detail;
        }
      }
    };
  </script>
</wcs-state>

<!-- Emitters — must be wc-bindable custom elements -->
<my-form data-wcs="eventToken.created: userCreated; eventToken.error: createFailed"></my-form>
```

When `<my-form>` dispatches the DOM event mapped to its `created` property, the `userCreated` token fires and the `$on.userCreated` handler runs with `(state, event)`.

### `$eventTokens` Declaration

The `$eventTokens` array declares the channel names that `eventToken.<prop>:` bindings and `$on` keys may reference. Only declared names are valid (typo resistance).

```javascript
export default {
  $eventTokens: ["userCreated", "createFailed"],
};
```

- Entries must be non-empty strings
- Duplicate entries throw an error at initialization
- A token declared here but absent from `$on` simply has no subscriber — emitting it is a no-op

### `$on` — Receiving on the State Side

`$on` maps each event-token name to a handler. Because state is passed as the **first argument** (not via `this`), handlers can be written as either method shorthand or arrow functions — this mirrors the command-token emit convention, where `this` is likewise not bound:

```javascript
$on: {
  // both forms work — state is always the first parameter
  userCreated: (state, event) => { state.lastId = event.detail.id; },
  rowFailed(state, event, ...listIndexes) {
    const [i] = listIndexes;          // loop index when fired from inside a `for`
    state.failedRows = state.failedRows.concat(i);
  }
}
```

- Every `$on` key must be declared in `$eventTokens` (otherwise an error is thrown at initialization)
- Each value must be a function
- The signature is `(state, event, ...listIndexes)` — the DOM `Event` first, then any enclosing loop indexes

### `eventToken.<property>:` Binding

```html
<my-target data-wcs="eventToken.error: createFailed"></my-target>
```

| Part | Description |
|---|---|
| `eventToken.` | Fixed prefix |
| `<property>` | A **wcBindable property name** — not a raw DOM event name. The real event name is resolved from `wcBindable.properties[].event` |
| `<tokenName>` | A bare event-token name declared in `$eventTokens` (no `$`-namespace prefix, unlike command tokens) |

The key is a property name rather than a raw event name so the binding goes through the same `wcBindable` contract that command bindings use — and so a namespaced event name (`ns:evt`) cannot collide with the binding's `:` separator. The framework looks up `properties[].event` and attaches a listener for that real event:

```javascript
class MyTarget extends HTMLElement {
  static wcBindable = {
    protocol: "wc-bindable", version: 1,
    properties: [
      { name: "error",   event: "thing-error" },     // eventToken.error → listens for "thing-error"
      { name: "created", event: "thing-created" },
    ],
  };
}
```

Validation rules:

- The element must be a wc-bindable custom element (`static wcBindable`, `protocol: "wc-bindable"`, integer `version` ≥ 1 — all versions ≥ 1 are core-compatible). A non-wc-bindable element is rejected at attach time.
- `<property>` must appear in `wcBindable.properties` — checked at **attach time** (fail-fast; needs only the class, not DOM connection).
- `<tokenName>` must be declared in `$eventTokens` — checked at **fire time**. State is resolved from the element's live root node when the event fires, so the binding also works inside `for` / `if` blocks and after SSR hydration, where the node may still be detached at attach time.
- Modifiers `#prevent` / `#stop` work as on any event binding: `eventToken.error#prevent: createFailed`.

### Inside a Loop

When the emitter sits inside a `for` block, the enclosing loop indexes are appended after the event, exactly like an `on*` handler:

```html
<template data-wcs="for: rows">
  <my-row data-wcs="eventToken.failed: rowFailed"></my-row>
</template>
```

```javascript
$on: {
  rowFailed(state, event, ...listIndexes) {
    const [i] = listIndexes;          // index of the row that fired
    state.failedRows = state.failedRows.concat(i);
  }
}
```

### Fan-in and Chaining

Multiple elements can wire the same token (`eventToken.x: shared`) — every dispatch reaches the one `$on` handler, mirroring command-token fan-out. And because an `$on` handler receives `state`, it can re-emit a command token, chaining element → state → element:

```javascript
$commandTokens: ["doRefresh"],
$eventTokens: ["completed"],
$on: {
  completed(state) {
    state.$command.doRefresh.emit();  // event in → command out
  }
}
```

### Token API

Event tokens share the same `Token` pub/sub primitive as command tokens — `name` / `size` / `subscribe` / `unsubscribe` / `emit`, with subscribe-order preservation (see [Token API](#token-api)). The token is resolved from the registry on every event so a re-`setInitialState()` rebuild still reaches the latest `$on` subscribers. Disconnecting the owning `<wcs-state>` keeps the event-token registry, so `$on` handlers (and `on` scans) receive events again once the root `<wcs-state>` is re-attached; an event dispatched while it is disconnected finds no state tree and is not delivered.

## Choosing a Time Mechanism

The next four sections answer four different questions, and the usual mistake is to reach for the wrong one. Choose by **what you are declaring**, not by where the data comes from:

| Declaration | What you declare | Owns a value | Fires | Typical use |
|---|---|---|---|---|
| [Path getter](#path-getters-computed-properties) | What a value **is**, in terms of the current state | No — it is recomputed and cached per address | Lazily, when a demand root reads it | Subtotals, classification, aggregates |
| [`$streams`](#streams-streams) | An async producer, and the value folded **within one run** | Yes — the runtime owns the output | Per chunk; restarts, back to `initial`, when `args` change | Feeds, sockets, continuous observation |
| [`$watch`](#watch-watch) | A reaction to a change | No | Once per batch per changed address, after the scan write | Side effects, "when this becomes true" |
| [`$scan`](#scan-scan) | An accumulation over time, and what resets it | Yes — the runtime owns the output | Once per landing (`from`) or once per event (`on`) | Paging accumulation, history, counters |

Two rules cut most of the confusion:

- **`$updatedCallback` is not on this list.** It reports the bindings that were applied, so anything hung on it silently depends on what is rendered. See [Demand roots](#demand-roots--what-makes-a-getter-run).
- **A `$streams` fold resets on every restart; a `$scan` does not.** When the value has to survive the restart, or has to count events rather than states, it belongs in `$scan`.

## Streams (`$streams`)

Command tokens and event tokens carry discrete interactions. **`$streams`** covers the remaining shape: a continuous flow. Declare an async producer (async iterable / async generator / `ReadableStream`) and the framework **folds it into a single reactive property** — each chunk goes through normal path assignment, so bindings, path getters, and `$updatedCallback` react exactly as if you had assigned the value yourself. When a state path read by the `args` function changes, the running producer is aborted and the source is restarted with the new arguments (switchMap-style dependency-driven restart). Streams start eagerly after `$connectedCallback` completes and are aborted when the element disconnects.

`$updatedCallback` remains binding-driven: a stream declaration alone is not a headless subscription. Its path appears in the callback only when a live DOM binding for that value/status/error is actually applied. To react to a stream's value without rendering it, declare [`$watch`](#watch-watch) on that path; see the [stream reference](docs/streams.md) for the observation contract.

```html
<wcs-state>
  <script type="module">
    export default {
      prompt: "",

      $streams: {
        // Full form: accumulate an LLM token stream
        tokens: {
          args:    (state) => state.prompt,                 // dependencies are captured here, and only here
          source:  (prompt, signal) => llmStream(prompt, signal),
          fold:    (acc, chunk) => acc + chunk,             // reduce (accumulate)
          initial: "",                                      // required when fold is specified
        },

        // Minimal form: no fold = latest (replace with the newest chunk), no args = start once
        ticker: {
          source: (_args, signal) => priceStream(signal),
        },
      },
    };
  </script>
</wcs-state>
```

| Field | Required | Contract |
|---|---|---|
| `source` | ✔ | `(args, signal) => AsyncIterable \| ReadableStream \| Promise<same>`. **Must honor the `AbortSignal`** — restart and disposal are driven by it |
| `args` | — | Synchronous pure function over a readonly state proxy. Paths read here are captured as dependencies; omitted = start once, never restart |
| `fold` | — | Synchronous `(acc, chunk) => next`. Omitted = latest (replace with the chunk). Must return a new value — no in-place mutation of `acc` |
| `initial` | with `fold` ✔ | Seed value. The property resets to it on every (re)start |

The stream's value is an ordinary property, and its companion status / error live under read-only namespaces:

```html
<p data-wcs="textContent: tokens"></p>
<p data-wcs="textContent: $streamStatus.tokens"></p>  <!-- "idle" | "active" | "done" | "error" -->
<p data-wcs="textContent: $streamError.tokens"></p>   <!-- last error, null after (re)start -->
```

On error the property keeps its last folded value and the error lands in `$streamError.<name>`; a `done` or `error` stream restarts when its dependencies change (retrying = re-hitting the dependency).

**Bridging an event API** — most real sources are callback-shaped (`EventSource`, `WebSocket`, DOM events), not async iterables. Wrap them in a standard `ReadableStream`: enqueue in `start`, release the resource in `cancel`. You never touch the `AbortSignal` — on restart/dispose the runtime cancels its reader, which force-unwinds a parked read and runs your `cancel()`:

```js
$streams: {
  metrics: {
    args: (state) => ({ host: state.host }),
    source: ({ host }) => {
      const es = new EventSource(`/api/metrics?host=${host}`);
      return new ReadableStream({
        start(controller) {
          es.addEventListener("metric", (e) => controller.enqueue(JSON.parse(e.data)));
        },
        cancel() { es.close(); },   // runs on restart / dispose
      });
    },
    fold: (acc, sample) => [...acc, sample].slice(-20),
    initial: [],
  },
},
```

Hand-rolled async generators remain fully supported when you need producer-side control, but they are only *partially* rescued on abort: a generator parked in an `await` that ignores `signal` cannot be force-unwound from outside. Prefer the `ReadableStream` form for event-API bridging.

Key rules:

- **Cooperative cancellation (MUST)** — `source` must observe the passed `AbortSignal` and stop producing when it fires. A `ReadableStream` source satisfies this automatically through its `cancel()` callback (the runtime cancels the reader on abort); only hand-rolled async iterables need to observe `signal` themselves.
- **Bounded fold** — demand never flows back to the producer (backpressure is deliberately abandoned). For infinite / long-lived streams use a bounded fold — latest, count, last-N (`(acc, chunk) => [...acc.slice(-99), chunk]`), windowed aggregates. Raw accumulation of every chunk is for finite streams only.
- **`args` is synchronous** — returning a Promise is an error, and wildcard reads inside `args` are rejected.
- **No self-dependency, no mutual cycles** — `args` reading the stream's own value or status raises an error. Mutual cycles between two streams (A's `args` reads B's value and vice versa) are not detected and restart forever — do not build them. One-way chains (A's value feeding B's `args`) are legitimate.
- **SSR does not start streams** — on the server the declaration is parsed and the property is materialized with `initial`, but no source runs; the client starts streams as usual.

See [docs/streams.md](docs/streams.md) for the full contract — lifecycle and ownership, restart semantics, flush granularity, and the out-of-scope list.

## Demand roots — what makes a getter run

Path getters are **lazy**. One that nobody reads is never evaluated. So "does this getter run?" is not answerable from the getter itself — it depends on **where the demand comes from**.

There are exactly **three** demand roots:

| Root | Lives in | Depends on rendering |
|---|---|---|
| **A live DOM binding** | `data-wcs` / mustache / comment bindings | **Yes** — remove the element and the demand goes with it |
| **A `$watch` declaration** | the state | No (headless) |
| **A `$streams` `args` function** | the state | No (evaluated on start and on every restart) |

**`$updatedCallback` is not a root.** It reports what the bindings did; it does not create demand.

### Rendering can change program semantics

Because the first root lives in the DOM, **an element you think of as display-only can be the actual subscription**. This one was hit for real, in [`examples/state-intersect-scroll`](../../examples/state-intersect-scroll):

```html
<!-- Meant as display. It was the only demand root. -->
<b data-wcs="textContent: $streamStatus.pageResult"></b>
```

```javascript
// $updatedCallback is binding-driven — delete that <b> and the path stops
// appearing in `paths`, so the feed silently stops committing.
$updatedCallback(paths) {
  if (!paths.includes("$streamStatus.pageResult")) return;
  this.items = this.items.concat(this.pageResult.items);
}
```

**The rule:** logic that must not depend on what is rendered belongs on a `$watch`, a `$scan`, or a `$streams` `args`. Keep `$updatedCallback` for "follow what was drawn".

That example now accumulates its feed with `$scan` (and re-arms the sentinel from a `$watch`), and the `<b>` is display-only again. This shape — `$updatedCallback` testing a path that is not bound anywhere — is detected statically as **`wcs/updated-callback-unbound`**.

### The limitation that remains

Demand still comes from three separate places. **To know whether a getter is evaluated you have to inspect all three — every binding on the page, every `$watch`, and every `$streams` `args` — and reading the getter's definition will not tell you.** The linter and the DevTools wiring-coverage view exist to make a machine do that cross-check.

Note that a scalar getter named in `$watch` becomes **eager** (evaluated once at connect, then at the end of every batch touching its dependencies). Wildcard row getters do not become eager, because the first evaluation would walk the whole list.

## Watch (`$watch`)

`$updatedCallback` is **binding-driven**: it reports the paths whose live DOM bindings were actually applied in that update, so a value you never render is invisible to it. **`$watch`** is the headless counterpart — it fires on state changes whether or not anything on the page is bound to the path. (One exception, spelled out below: a *wildcard* row path needs `$listKeys` to work headlessly.)

```html
<wcs-state>
  <script type="module">
    export default {
      isLoading: false,
      items: [],
      startedAt: 0,

      $watch: {
        // rising-edge detection: you compare cur/prev yourself
        isLoading(cur, prev) {
          if (cur === true && prev === false) { this.startedAt = Date.now(); }
        },

        // wildcard paths fire once per changed row
        // (needs the list rendered with `for`, or `$listKeys` declared — see below)
        "items.*.price"(cur, prev, index) {
          this.lastPriceChange = `#${index}: ${prev} → ${cur}`;
        },
      },
    };
  </script>
</wcs-state>
```

The handler runs with `this` bound to a **writable** state proxy, so it can write back; those writes land in the next update batch. The return value is ignored and never awaited.

| Argument | Contract |
|---|---|
| `cur` | The value at drain time (the settled value for the batch) |
| `prev` | The value at the **start of the batch** (first-write-wins). Recorded **only when a primitive is written** (the value before may be an object) — see below |
| `...indexes` | Only for wildcard paths: this scope's own loop indexes, same convention as `$1`, `$2` |

**`prev` comes only with primitive writes.** It reuses the old value the same-value guard reads before writing a primitive, so watch costs no extra read — and it is `undefined` when the new value is a reference type (an in-place mutation would give you the same reference anyway), for `$postUpdate`, and when `config.sameValueGuard` is off. A primitive written over an object passes that object as `prev`.

**Watch adds no firing condition of its own.** It fires for whatever landed in the update batch. That falls out well: an equal primitive write is already dropped before it is enqueued (so you effectively get change-only firing), while an occurrence write — a `semantics: "event"` property — is deliberately *not* dropped, and still fires with `cur === prev`. If you need edge detection, compare `cur` and `prev` in the handler.

**Watching a getter makes it eager.** A computed getter is normally lazy, and its dependencies are only recorded when it is evaluated — so an unrendered getter would never fire at all. Declaring one in `$watch` evaluates it once at connect and again at the end of every batch that touches its dependencies. Its `prev` is the previous evaluation. Watch a heavy computed and you pay that evaluation on every batch; exceptions inside it surface through the watch instead of staying dormant. Wildcard getters (`items.*.tax`) are **not** made eager — priming one would sweep the whole list — so that form fires only when it is also bound to the DOM, and its `prev` is always `undefined` (no per-row evaluation is remembered).

Firing order is defined in three layers, and only the middle one is yours to steer:

| Layer | Order | Your control |
|---|---|---|
| Mechanisms | `$updatedCallback` → `$scan` → `$watch` → `$streams` restart | fixed |
| Between handlers | declaration order in `$watch` | **reorder the declarations** |
| Between rows of one path | ascending `indexes` | fixed |

**The one thing that moves the mechanism layer** is a `<wcs-view-transition>` that accepts the `state` participant. Binding application — and with it `$updatedCallback` — then lands on a frame, while `$scan`, `$watch` and the `$streams` restart stay on the microtask the drain was queued on, because they consume state addresses and not the DOM. For as long as the tag is present the order is `$scan` → `$watch` → `$streams` restart → `$updatedCallback`. Nothing else on the page reorders this layer; see [docs/timing-and-firing-contract.md](https://github.com/wcstack/wcstack/blob/main/docs/timing-and-firing-contract.md) §4.3.

Key rules:

- **Paths of the tree only** — a path may not contain `@` (the v1 name selector); such a declaration is rejected loudly.
- **Intermediate values are not observable** — a batch that goes `a → b → c` fires once with `cur = c`, `prev = a`, the same contract as binding updates.
- **Rows follow the list as it stands at the drain** — a row written and then removed, replaced or cut off in the same job does not fire, a row that only moved into another position does not fire, and each position fires at most once. Replacing a nested list fires for every row of the new array.
- **Row-level diffs want `$listKeys`** — without it, assigning a whole array fires the row watch for *every* row with `prev === undefined`, because no row went through a path write. With `$listKeys` declared, the key match decomposes the assignment into per-field writes, so only changed rows fire and `prev` is a real scalar.
- **A headless row watch requires `$listKeys`** — this is the one place `$watch` is *not* headless on its own. Expanding `items` into `items.*.price` is driven by the list's `for` binding, and declaring a watch deliberately does not register the path as a list. So with neither a `for` binding nor `$listKeys`, assigning the array fires the row watch **zero** times. Add `$listKeys` (the key match writes each field by path, bypassing the expansion) or render the list. Scalar paths — including nested ones like `user.name` — are headless with no such condition.
- **Handler exceptions are isolated** — a throw is reported to the console and the remaining watches (and stream restarts) still run. This differs from `$connectedCallback` / `$updatedCallback`, which fail loudly.
- **Write chains are bounded** — a handler's writes form a new batch, so mutually-writing watches would loop forever; the chain is cut off after 32 links with a console error. Values and DOM are not rolled back.
- **Not run on a mounted `bind-component` scope** — mounted components do not execute declaration surfaces: the `$watch` declaration is ignored with a one-time console warning that points to the root state (or a volume — `<wcs-state mount>` hosts `$watch` / `$listKeys` / `$updatedCallback`). This applies to `$streams` too. A plain (unwired Shadow) child owns an independent tree and can declare it.
- **SSR does not run watches** — handler side effects would otherwise execute on both server and client.

## Scan (`$scan`)

`$streams` folds *within* one run — every restart resets the value to `initial` — and `$watch` owns no value. **`$scan`** declares the value that has to outlive both: an accumulation over time, with an owner, a firing unit and a reset condition.

```html
<wcs-state>
  <script type="module">
    export default {
      page: 1,
      host: "a",
      $eventTokens: ["message"],
      $streams: {
        pageResult: { args: (s) => s.page, source: loadPage },
      },
      $scan: {
        // from: fold each landing of a state path — here, the stream's value
        feed: {
          from: "pageResult",
          initial: { items: [], pages: [] },
          fold: (feed, chunk) =>
            chunk?.kind === "success" && !feed.pages.includes(chunk.page)
              ? { items: feed.items.concat(chunk.items), pages: [...feed.pages, chunk.page] }
              : feed,
        },
        // on: fold each event of a declared event token
        log: {
          on: "message",
          initial: [],
          fold: (log, event) => [...log.slice(-49), event.detail],
          resetOn: ["host"], // back to [] whenever host changes
        },
      },
    };
  </script>
</wcs-state>

<template data-wcs="for: feed.items">…</template>
```

| Field | Contract |
|---|---|
| `from` | A state path. Wildcards are allowed; it may not start with `$`, and may not be a getter or sit under one. Declare exactly one of `from` / `on`. |
| `on` | An event-token name declared in `$eventTokens`. |
| `initial` | Required. The seed of the accumulator, and what `resetOn` returns to. |
| `fold` | Required. `from`: `(acc, cur, prev, ...indexes) => next`. `on`: `(acc, event, ...indexes) => next`. Synchronous, called without `this`, returns a new value. Returning `acc` itself writes nothing. |
| `resetOn` | Optional array of plain state paths. When one of them is written, the output returns to `initial`: a `from` scan skips that batch's fold, and an `on` scan folds any event that comes after the write into `initial`. A path under `from` raises; an ancestor of `from` is allowed (start over when the parent is replaced). An object path resets only when that object itself is written, not on writes to its children — list the leaf paths or use a nonce. |

**The runtime owns the output**, like a `$streams` value. It is materialized from `initial` when the state does not already have that property (plain data is copied, so writing a child path in the plain part of the output never changes the declared `initial`; class instances, frozen values and other non-plain values stay shared with it), and you bind it like any other path. It survives stream restarts, disconnect and reconnect, and a re-set of the same object; a re-set with a new declaration rebuilds the scan. An output name that collides with a getter, a setter, a method or a `$streams` entry raises.

How the two sources fire:

| | `from` (a path) | `on` (an event token) |
|---|---|---|
| Unit | One fold per address that landed in an update batch. Writes made in one job are coalesced. | One fold per event. Two events in one task fold twice. |
| When | At the end of the drain, before `$watch`. | Inside the event, before that token's `$on` handlers. |
| Output visible | From the next batch. A `$watch` on the output fires then, normally with `prev === undefined` (see below). | Immediately. The `$on` handlers of the same event already see it. |

Key rules:

- **Never fold a getter.** A getter re-evaluates whenever its inputs change, so a fold over it would count re-evaluations, not events. A getter as `from` or `resetOn` — or an expansion of a `$recursion` `**` getter such as `nodes.*.total` as `from` — raises at declaration (`wcs/scan-source-computed`).
- **One fold per landing, not per page.** A retry after the page is `done`, or reconnecting the page, lands the same page again. When that matters, keep an idempotency key in the fold — the `pages` list above.
- **Do not derive a stream's `args` from its own scan output.** A getter over `feed` — or over another scan that folds `feed` — read by `pageResult`'s `args` would restart the stream on its own result, so the runtime raises `wcs/scan-feedback-loop`. Advance the cursor from an event instead. A chunk that lands in the same batch as its stream's restart belongs to the aborted run and is not folded.
- **Receive element events through `on`.** A `from` path sees every write to that path, including a bound element's initial sync and a whole-parent write (which arrives with `prev === undefined`). `prev` follows `$watch`'s ledger, so it is also `undefined` for a write made inside the `$scan` / `$watch` listener — by a `$watch` handler, or by another scan whose output is the `from`. The ledger is cleared at the end of that listener, so the `$streams` restart that runs after it in the same drain keeps `prev`.
- **Keep folds bounded.** An infinite source must fold into a bounded value (the last N, a count), exactly as with `$streams`.
- **Errors are isolated.** A throw, a returned Promise or a value that cannot be read is reported to the console and DevTools and writes nothing (an unreadable row of a wildcard `from` is skipped alone, and row landings are narrowed to one per list position); the other scans, watches and stream restarts still run.
- **`$watch` runs after the scan write.** A `$watch` handler in the same drain reads the output as folded, and a value it writes to the output stays. When the `from` source is written again before the output's landing drains — by a `$watch` handler in that drain, say — both land in one batch: a `$watch` on the output then gets the landed value in `prev`, sees `cur` one step ahead, and can fire again with the same value in the next batch, so make it tolerant of a repeated value. Clear an accumulation from a user action with a nonce read by `resetOn`.
- **Root only.** A volume (`mount=`) refuses `$scan`, and a mounted `bind-component` scope ignores it with a one-time warning. Under SSR, `from` does not fold; the output is still materialized.

Reference: [docs/scan.md](https://github.com/wcstack/wcstack/blob/main/packages/state/docs/scan.md). Design record: [docs/state-scan-design.md](https://github.com/wcstack/wcstack/blob/main/docs/state-scan-design.md).

## Inputs and Attribute Mirror

`wcBindable.inputs` declares one-way property inputs (state → element). When an entry sets `attribute`, the framework writes the value to that HTML attribute every time it writes the property, so `attributeChangedCallback`, CSS attribute selectors, and DevTools all stay in sync with the property value.

`inputs` is not just attribute-mirroring metadata: under directional initial sync (default on), it is what marks a member as **settable from state**. A settable member declared only in `properties` becomes output-only and state writes to it are suppressed — see [Binding Authority](#binding-authority-init--sync).

```javascript
class MyChip extends HTMLElement {
  static wcBindable = {
    protocol: "wc-bindable", version: 1,
    properties: [],
    inputs: [
      { name: "data", attribute: "data" },        // property name === attribute name
      { name: "labelText", attribute: "label-text" }, // kebab-case mirror
      { name: "internal" },                       // no mirror, property-only
    ],
  };
}
```

```html
<my-chip data-wcs="data: chip.payload; labelText: chip.title"></my-chip>
```

When state updates the value, both the property and the attribute are written:

```text
chip.payload = { id: 1 }    → element.data = { id: 1 } and setAttribute("data", '{"id":1}')
chip.title   = "新着"        → element.labelText = "新着" and setAttribute("label-text", "新着")
chip.payload = null          → element.data = null and removeAttribute("data")
```

Attribute value encoding:

| Value type | Mirrored attribute |
|---|---|
| `string` / `number` / `boolean` / `bigint` | `String(value)` |
| `null` / `undefined` | attribute removed |
| `object` / `array` | `JSON.stringify(value)` (falls back to `String(value)` on circular references) |

Notes:

- `inputs` entries **without** `attribute` are property-only — the value is written to the property but no attribute is touched
- Mirror is best-effort: a `setAttribute` failure is swallowed (with a `debug` warning) and does not block the property write
- Native HTML elements ignore `inputs` entirely — the mirror only activates for custom elements that expose `static wcBindable`

## Choosing a Component Mechanism

Two mechanisms give a custom element its own state, and they are **mutually exclusive** — pick one per component:

| | [DCC](#declarative-custom-components-dcc) | [`bind-component`](#web-component-binding) |
|---|---|---|
| How the element is defined | HTML only (`data-wc-definition` + Declarative Shadow DOM) | A JavaScript `class extends HTMLElement` you write |
| Where the state lives | An inline `<script type="module">` in the template, loaded per instance | A property on the component instance (`this.state`) |
| `static wcBindable` | Generated from `$bindables` / `$commands` | **None** — the element is not a wc-bindable producer |
| Parent binds a value | `count: parentCount` (two-way, change events) | `state.msg: user.name` (path mapping) |
| Parent invokes a method | `command.bumpBy: $command.bump` | Not available — expose it on the class and call it yourself |
| Spread (`...: obj`) | Available | Not available (requires a `wcBindable` declaration) |
| Component reads/writes its own state | `this.count` on the element | `this.state.msg` |

The rule of thumb: **if the component has no JavaScript class, use DCC; if you are already writing a class, use `bind-component`.** Combining them raises — a `<wcs-state bind-component>` inside a `data-wc-definition` host is a configuration error, because DCC state belongs to the template and is loaded per instance.

`bind-component` components deliberately stay outside the wc-bindable protocol: they are wired by **path**, not by a declared property surface. That is why spread and command tokens, both of which need a `wcBindable` declaration, do not apply to them.

## Declarative Custom Components (DCC)

Define custom elements **entirely in HTML** — no JavaScript class definition needed. Using `data-wc-definition` and Declarative Shadow DOM (`<template shadowrootmode>`), you can declare reusable components with reactive state inline.

### Basic Definition

```html
<!-- 1. Define the component (hidden by CSS) -->
<my-counter data-wc-definition>
  <template shadowrootmode="open">
    <p>{{ count }}</p>
    <button data-wcs="onclick: increment">+1</button>
    <wcs-state>
      <script type="module">
        export default {
          count: 0,
          increment() { this.count++; },
          $bindables: ["count"]
        };
      </script>
    </wcs-state>
  </template>
</my-counter>

<!-- 2. Use it — each instance gets its own state -->
<my-counter></my-counter>
<my-counter></my-counter>
```

When `<wcs-state>` detects it is inside a `data-wc-definition` host, it:

1. Loads the state object (from `<script type="module">` or `src="*.js"`)
2. Generates a custom element class with getter/setter/method properties on the prototype
3. Registers it via `customElements.define()`

The definition element is hidden; each instance clones the template into its own Shadow DOM and initializes its own `<wcs-state>`.

### Recommended CSS

```css
:not(:defined) { display: none; }
[data-wc-definition] { display: none; }
```

### `$bindables` / `$commands` and the wc-bindable Protocol

`$bindables` declares which state **properties** are exposed as component properties with change events. `$commands` declares which state **methods** are exposed as invocable commands. Together they build the [wc-bindable protocol](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/main/README.md) declaration:

```javascript
export default {
  count: 0,
  bumpBy(step) { this.count += step; },
  $bindables: ["count"],
  $commands: ["bumpBy"]
};
```

This generates:

- `static wcBindable` on the class — protocol metadata for framework adapters. Each `$bindables` member is declared in both `properties` and `inputs` (two-way), so parent-state → DCC writes keep working under directional initial sync — see [Binding Authority](#binding-authority-init--sync). Each `$commands` member becomes a `commands` entry
- Getter/setter on the prototype for `$bindables`, a method for `$commands` — both go through the reactive proxy
- `CustomEvent` dispatch — `my-counter:count-changed` fires on every mutation of a `$bindables` member

`commands` entries are always declared `async: true`. A DCC method chains on the inner `<wcs-state>`'s initialization, so it returns a Promise whether or not the state method itself was written `async`.

Both declarations are validated when the component is defined, with the same strictness as `$commandTokens`. Each of the following raises:

- not an array
- an entry that is not a non-empty string
- an entry starting with `$` (internal properties are never exposed on the component prototype)
- a duplicated entry — this one used to fail silently: a duplicate name makes the whole `wcBindable` declaration unreadable, so the element would quietly stop being two-way bindable
- an entry that does not exist on the state (own properties and the prototype chain are both searched; `$streams` names count as existing since their value properties are materialized per instance)
- a method listed in `$bindables`, or a value property listed in `$commands`

### Driving a DCC Method

A `$commands` member can be invoked from the parent state with a [command token](#command-token-method-binding), exactly like an I/O node:

```html
<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["bump"],
      fire() { this.$command.bump.emit(3); }
    };
  </script>
</wcs-state>

<button data-wcs="onclick: fire">bump</button>
<my-counter data-wcs="command.bumpBy: $command.bump"></my-counter>
```

Positional arguments pass through verbatim, so `emit(3)` calls `bumpBy(3)` on the component's state.

### Binding to DCC Properties

Other `<wcs-state>` instances can bind to DCC properties just like any Web Component:

```html
<my-counter data-wcs="count: parentCount"></my-counter>

<wcs-state>
  <script type="module">
    export default { parentCount: 0 };
  </script>
</wcs-state>
<div data-wcs="textContent: parentCount"></div>
```

### Shadow Root Mode

Both `open` and `closed` modes are supported:

```html
<my-component data-wc-definition>
  <template shadowrootmode="closed">
    <!-- closed shadow DOM -->
  </template>
</my-component>
```

### Internal Properties

Properties prefixed with `$` are internal and not exposed on the component prototype:

| Property | Purpose |
|----------|---------|
| `$bindables` | Declares observable properties |
| `$commands` | Declares invocable methods |
| `$connectedCallback` | Lifecycle hook (runs on each instance) |
| `$disconnectedCallback` | Cleanup hook |
| `$updatedCallback` | Called after state mutations |

## SVG Support

All bindings work inside `<svg>` elements. Use `attr.*` for SVG attributes:

```html
<svg width="200" height="100">
  <template data-wcs="for: points">
    <circle data-wcs="attr.cx: .x; attr.cy: .y; attr.fill: .color" r="5" />
  </template>
</svg>
```

## Lifecycle Hooks

State objects can define `$connectedCallback`, `$disconnectedCallback`, `$updatedCallback`, and `$errorCallback` for initialization, cleanup, update, and binding-failure handling.

```html
<wcs-state>
  <script type="module">
    export default {
      timer: null,
      count: 0,

      // Called when <wcs-state> is connected to the DOM
      async $connectedCallback() {
        const res = await fetch("/api/initial-count");
        this.count = await res.json();
        this.timer = setInterval(() => { this.count++; }, 1000);
      },

      // Called when <wcs-state> is disconnected from the DOM (sync only)
      $disconnectedCallback() {
        clearInterval(this.timer);
      }
    };
  </script>
</wcs-state>
```

| Hook | Timing | Async |
|---|---|---|
| `$connectedCallback` | After state initialization on first connect; on every reconnect thereafter | Yes (awaited) |
| `$disconnectedCallback` | When the element is removed from the DOM | No (sync only) |
| `$updatedCallback(paths, indexesListByPath)` | After updates are applied to live bindings | Yes (not awaited) |
| `$errorCallback(error, info)` | After a drain in which a binding failed to apply — once per failed binding, after `$updatedCallback` | Yes (not awaited) |

All hooks except `$disconnectedCallback` support `async` — you can use `async/await` in any of them. Since the reactive proxy detects every property assignment as a change, standard `async/await` with direct property updates is sufficient for asynchronous operations — loading flags, fetched data, and error messages are all just property assignments, without requiring additional abstractions for async state management.

- `this` inside hooks is the state proxy with full read/write access
- `$connectedCallback` is called **every time** the element is connected (including re-insertion after removal), making it suitable for setup that should be re-established
- `$disconnectedCallback` is called synchronously — use it for cleanup such as clearing timers, removing event listeners, or releasing resources
- `$updatedCallback(paths, indexesListByPath)` receives the paths whose live bindings were applied in that drain. Unbound state writes do not invoke it or appear in `paths`. For wildcard updates, `indexesListByPath` contains the updated index sets. Marker paths of mounted components (`#m…`) never appear in `paths` — a component's private keys stay private (DevTools shows them in its overlays view). Can be `async`, but the return value is not awaited
- `$errorCallback(error, info)` is the in-page **error boundary** for bindings. When applying a binding throws — a path getter or filter threw, a structural directive failed — the failure is isolated (the rest of the batch still applies, and neither the value nor the DOM is rolled back) and, without this hook, reported with `console.error`. Declare the hook and the report comes to you instead: `error` is what was thrown, `info` is `{ path, bindingType, node }` identifying the binding (`path` as written in `data-wcs`, wildcards intact). `this` is the writable state proxy, so the usual shape is to write the message into state and render it like anything else:

  ```js
  export default {
    user: null, loadError: "",
    get title() { return this.user.profile.name; },   // throws while user is null
    $errorCallback(error, { path }) {
      this.loadError = `${path}: ${error.message}`;   // <p data-wcs="textContent: loadError">
    },
  };
  ```

  The hook runs after the batch (after `$updatedCallback`), is not awaited, and an exception thrown inside it is reported to the console without breaking the drain. DevTools still receives every failure as `state:binding-apply-error` whether or not the hook exists. Root-only: a volume (`<wcs-state mount>`) declaring it is ignored. It does not cover `$watch` handlers (isolated and reported separately) or errors thrown by `$connectedCallback` / `$updatedCallback` (those fail loudly).
- In Web Components, define `async $stateReadyCallback(stateProp)` to receive a hook when the bound state becomes available via `bind-component`

## Transition animations

Enter animations need nothing from this package — a new `for` row and a mounting `if` branch are newly inserted elements, so plain CSS covers them:

```css
li {
  transition: opacity 0.2s, transform 0.2s;
  @starting-style { opacity: 0; transform: translateY(-4px); }
}
```

**Leaving** and **moving** cannot be reached that way: removed rows are detached synchronously, and a reorder has no intermediate state. Adding [`@wcstack/view-transition`](https://github.com/wcstack/wcstack/tree/main/packages/view-transition) makes the drain apply its DOM changes inside a View Transition, where the browser snapshots the old state for you:

```html
<script type="module" src="https://esm.run/@wcstack/view-transition/auto"></script>
<wcs-view-transition naming="auto"></wcs-view-transition>
```

Two consequences to know while that tag accepts the `state` participant:

- The drain lands on a frame instead of a microtask, so code that writes state and then reads the DOM after `await Promise.resolve()` must wait for the transition. `$updatedCallback` still fires immediately after the bindings are applied — its *position* is unchanged, but it moves a frame later along with them.
- Because `$scan`, `$watch` and the `$streams` restart stay on the original microtask, they now run **before** `$updatedCallback` instead of after it.

Only a batch that actually has bindings to apply is handed to the tag, so a write to a headless path never starts a transition. Without the tag the drain is exactly what it was. See [docs/timing-and-firing-contract.md](https://github.com/wcstack/wcstack/blob/main/docs/timing-and-firing-contract.md) §4.3.

## Diagnostics and failure handling

### Wiring to a path that does not exist is reported

When a wired path provably does not resolve against the state, you get one warning at binding time (at declaration time for `$watch` and `$scan`). The diagnostic codes are shared by the console, `@wcstack/lint`, and the VS Code extension:

```
[@wcstack/state] [wcs/binding-path-missing] Bound path "user.nmae" does not resolve on the state tree:
"nmae" is not declared. Did you mean "name"? Updates to this path will be silently
dropped. Validate statically: npx @wcstack/lint <file>.
```

| Situation | Behavior |
|---|---|
| Typo in a nested path (`user.nmae`) | `console.warn` (`wcs/binding-path-missing`). Updates still never arrive — you fix it |
| Typo in a top-level path (`cout`) | Throws on read, with the same wording and did-you-mean |
| Typo in a `$watch` key | `console.warn` (`wcs/watch-path-missing`), reported even for a single segment |
| Typo in a `$scan` `from` / `resetOn` path | `console.warn` (`wcs/scan-path-missing`), reported even for a single segment. The scan never folds (or never resets) |

The check **under-approximates**: it stays silent for anything it cannot decide statically, because a false alarm costs more than a missed one. None of these warn:

- A `null` / `undefined` parent (the "seed as `null`, assign later" shape)
- Row fields of a list that starts empty (the row shape is unknown)
- Sub-properties of an intermediate getter's return value
- Marker paths of mounted components (`#m…` — private keys and getters live on the mount overlay, not the raw state)
- Reserved `$` namespaces (`$command.*` and friends)

So **no warning is not a proof of correctness.** For exhaustive checking, run `npx @wcstack/lint <file>`.

### Index arity, wildcard rank, and getter cycles are checked too

Anything that follows mechanically from the path string is reported at runtime and by the linter under the same diagnostic code. Six of the codes below are **runtime-only** in this release — the linter does not emit them: `wcs/getter-depth-exceeded`, `wcs/index-param-range`, `wcs/recursion-context`, `wcs/recursion-shared-list`, `wcs/recursion-cycle` and `wcs/recursion-depth-exceeded`.

| Diagnostic | What it checks | Fix |
|---|---|---|
| `wcs/index-arity` | `$resolve(path, indexes)` must match the `*` count **exactly**; `$getAll(path, indexes)` / `$setAll(path, indexes, …)` have it as an **upper bound** (fewer is a legitimate prefix meaning "expand the rest") | Match the count |
| `wcs/wildcard-rank` | The path's `*` count (and the N in `$N`) must not exceed the enclosing `for` nesting | Add a `for`, or name the row with `$resolve(path, indexes)` |
| `wcs/getter-cycle` | Path getters must not form a dependency cycle. At runtime this is the address stack revisiting an address it already holds | Break the cycle |
| `wcs/getter-depth-exceeded` | Getter evaluation nests deeper than the engine evaluates in one pass (128 frames), with no address visited twice — the data is simply that deep | Aggregate in fewer levels, or flatten the tree |
| `wcs/index-param-range` | `$N` must name an existing wildcard level: `$1` through `$128`, no leading zeros | Use a level that exists |
| `wcs/recursion-unsupported` | `**` reached something that does not interpret it — markup, a `$watch` or `$listKeys` key, `$resolve` / `$postUpdate` / `$trackDependency`, an assignment — or the state declares no `$recursion` at all | Use a concrete path, or declare the anchor |
| `wcs/recursion-declaration-invalid` | The `$recursion` declaration or a `**` getter key has a shape this version refuses: an anchor or repeat that is not a list element or carries an index segment (`"nodes.0.items.*"`), more than one anchor, a `**` key that is not a getter or has a setter, `get "nodes.**"`, a getter that names the structure, two getters expanding to one concrete path, a concrete getter with the same name as an expansion. The linter reports it first; at runtime it throws when the declaration is read | Fix the declaration as the message says |
| `wcs/recursion-anchor` | A `**` path that does not match the one declared anchor (this version takes exactly one self-recursive anchor per state), or whose suffix after `**` is not well-formed — an empty segment (`nodes.**.`, `nodes.**..x`) or a bare `*` right after `**` (`nodes.**.*`) | Spell the anchor as declared, and a real path after it |
| `wcs/recursion-context` | A **bound** `**` was read where there is no depth to bind to — the top level, or a getter outside the anchor | Read it from a recursive or row getter, or pass `[]` to union every depth |
| `wcs/recursion-getall-form` / `wcs/recursion-setall-form` | An `indexes` argument `**` cannot define. The code is carried by the non-empty prefix (both APIs) and by a non-array `indexes` on `$getAll` (`null`, a string…); omission, a mapper and `{ spread: true }` in a `$setAll` are the same mistake and the linter reports them under the same code, but at runtime they throw with the form named in the message and no code | Omit for the current depth, `[]` for every depth |
| `wcs/recursion-structural-write` | A recursive `$setAll` targets the structure itself — a node, its child list, that list's `length`, a child node, or an object on the way to the child list when the repeating sub-path has several segments | Broadcast to a leaf property instead |
| `wcs/recursion-readonly` | A write targets a recursive getter, or a path inside the value it derives — a recursive `$setAll` on `nodes.**.total`, or any write to a concrete expansion such as `nodes.*.children.*.total` (fixed-arity `$setAll`, `$resolve` with a value, direct assignment) | Write what the getter derives from |
| `wcs/recursion-shared-list` / `wcs/recursion-cycle` | The walk reached the same array instance twice: two nodes sharing one child list, or a list reachable from its own ancestor | Give every node its own child array |
| `wcs/recursion-depth-exceeded` | The expanded path needs more than 128 wildcard levels — the tree nests deeper than the engine can address, or it contains a cycle | Flatten the tree, or find the cycle |

The form each `wcs/recursion-*` row is refusing — and the form to write instead — is spelled out under [Recursive Paths](#recursive-paths-recursion).

Previously **extra indexes were silently discarded** by both APIs, so a mixed-up call returned a plausible-looking wrong value. Both now throw:

```javascript
// ❌ Only one "*" in the path, two indexes given — used to return items[0]'s value
this.$resolve("items.*.price", [row, col]);

// ✅ Two levels, two indexes
this.$resolve("matrix.*.*", [row, col]);
// ✅ Fewer is fine for $getAll — it means "expand the remaining levels"
this.$getAll("matrix.*.*", [row]);
```

### One failing binding is confined to that binding

If applying a binding throws, the rest of that batch, `$updatedCallback`, `$watch`, and `$streams` restarts all still run. The failure is not swallowed — it goes to `console.error` and to DevTools (`state:binding-apply-error`):

```
[@wcstack/state] binding "text: items.*.label" failed to apply; the rest of this batch continues.
```

Without that confinement, a single throw left "new values, half-updated DOM" behind, and silently dropped every `$watch` handler and stream restart for the batch — quietly breaking the firing-order contract documented above.

### Values and the DOM are never rolled back

Every failure mode reports and continues; nothing already applied is reverted:

| Mechanism | Limit | On exceeding |
|---|---|---|
| Propagation hops | 32 | Quarantine the transaction's remaining records |
| `$watch` write chain | 32 | Skip watch firing for that batch |
| Binding apply failure | — | Skip that one binding |

## Configuration

Pass a partial configuration object to `bootstrapState()`:

```javascript
import { bootstrapState } from '@wcstack/state';

bootstrapState({
  locale: 'ja-JP',
  debug: true,
  enableMustache: false,
  tagNames: { state: 'my-state' },
});
```

All options with defaults:

| Option | Default | Description |
|---|---|---|
| `bindAttributeName` | `'data-wcs'` | Binding attribute name |
| `tagNames.state` | `'wcs-state'` | State element tag name |
| `tagNames.ssr` | `'wcs-ssr'` | Tag name of the SSR hydration-data element |
| `locale` | `<html lang>`, else `'en'` | Locale for the locale-dependent filters (`locale` / `date` / `time` / `datetime`) — see [Locale](#locale) |
| `debug` | `false` | Debug mode |
| `enableMustache` | `true` | Enable `{{ }}` syntax |
| `enableDirectionalInitialSync` | `true` | Direction-aware binding authority (`#init=` / `#sync=` binding modifiers) — see [Binding Authority](#binding-authority-init--sync). Default on; set `false` to opt out |
| `enablePropagationContext` | `true` | Causal propagation tracking across bindings (echo/diamond loop prevention). Default on; set `false` to opt out |
| `enableContractAnalyzer` | `false` | Opt-in dev-time contract analyzer (exposes `analyzeContract`) |
| `sameValueGuard` | `true` | Drop a primitive write whose value is `Object.is`-equal to the current one before anything is enqueued — bindings and `$watch` effectively fire on change only; reference types always pass. `false` lets equal writes through and makes `$watch`'s `prev` `undefined` |

### Locale

Four filters format by locale — `locale`, `date`, `time`, `datetime`. They read
`config.locale`, which **defaults to `<html lang>`**:

```html
<html lang="ja-JP">
  <script type="module" src="https://esm.run/@wcstack/state/auto"></script>
```

Nothing else is needed; `<html lang>` is the standard place to record a page's
language, and making it the default keeps one source of truth. It also means the
CDN one-liner can set the locale at all — `auto` calls `bootstrapState()` with no
arguments, so before this there was no way in. An explicit
`bootstrapState({ locale })` still wins, and an invalid BCP-47 tag is reported
and ignored rather than left to throw inside `Intl`.

**Changing `config.locale` later does not re-render anything.** It is a global
setting, not state, so it is not part of the dependency graph. The filters do
read it on every application rather than capturing it when the binding is built,
which means a binding that re-renders for its own reasons will pick up the new
value — enough to recover from a mis-ordered startup, not enough to switch a
page's language. Set the language before the page renders: writing `<html lang>`
in the markup, or from a synchronous `<head>` script, does that structurally.

Per-call overrides stay available and are fixed at bind time, since they are part
of the binding expression: `price|locale(fr-FR)`. For a page that switches
language without reloading, see [docs/i18n-design.md](../../docs/i18n-design.md) —
the short answer is that translations belong on a path, not in a filter.

**Where i18n sits, and what was decided.** There is no i18n package and no live
language switch, on purpose. A dictionary is an ES module chosen per locale and mounted as a
volume (`<wcs-state mount="i18n" src="/i18n/state.js">`), then read as ordinary
paths (`i18n.checkout.title`); the locale is decided **before** the page renders — from
`<html lang>` for the filters, and from the URL for the router, where the locale
lives in the `basename` (`/ja/…`) rather than in a route parameter. Switching
language is therefore a real navigation to another basename, not a state write:
the router intercepts links under its own basename only, so a `/:lang` parameter
would silently keep the old language, and a live switch would need every locale-
dependent module to re-evaluate. The `<base href>` that carries the basename has a
real cost (page-fragment anchors, SVG fragment references, relative `src` under
CSP all resolve against it), and two alternatives were weighed — the router reading
`<html lang>` itself, and a per-link opt-out of interception — and left recorded.
Read [docs/i18n-design.md](../../docs/i18n-design.md) §9-1 before choosing a
different shape; `examples/router-i18n` is the reference layout.

> These three are **architecture-hardening** features; their normative reference is
> `docs/architecture-hardening/`. `enablePropagationContext` defaults **on** — its
> write-path cost is near-zero for one-way bindings (only echo-capable two-way
> wires do the causal bookkeeping) — with the flag kept as a permanent opt-out.
> `enableDirectionalInitialSync` also defaults **on**: it assigns per-property
> initial-sync authority (an output-only `wcBindable` member reads its initial value
> element→state; two-way / input members keep state→element). Its setup-path cost is
> under 5% of initial render (the producer-value observer is only registered for
> echo-capable two-way wires), and the flag is a permanent opt-out. `enableContractAnalyzer`
> is opt-in (default `false`, zero runtime cost when off); when on, the exported
> `analyzeContract()` API reports drift between a live `static wcBindable` surface and
> a sidecar manifest for dev-time diagnostics.

## Testing Your Page

A page built on `<wcs-state>` is plain DOM, so it can be tested headlessly with [happy-dom](https://github.com/capricorn86/happy-dom) — no browser, no build step, no test-only API. Three recipes follow; every one of them runs as written (recipe 1 is pinned by [`__tests__/readme.testingRecipe.test.ts`](__tests__/readme.testingRecipe.test.ts), which executes the same lines).

Want it as one import? [`@wcstack/testing`](../testing/README.md) packages recipe 1 as `mount()` / `settle()` / `fire()` (and waits for `<wcs-router>` too). The bare recipes below stay valid without it.

### 1. vitest + happy-dom

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "happy-dom", setupFiles: ["./tests/setup.ts"] },
});
```

`tests/setup.ts` — register the elements once, and route inline `<script type="module">` state through the `data:` URL loader (Node cannot import `blob:` URLs; without this line an inline-script state never finishes loading):

```ts
import { bootstrapState } from "@wcstack/state";

bootstrapState();
URL.createObjectURL = undefined as any;
```

A test:

```ts
import { expect, it } from "vitest";
import { getBindingsReady } from "@wcstack/state";

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

it("renders, re-renders, and runs handlers", async () => {
  // 1. Mount the fragment under test
  document.body.innerHTML = `
    <wcs-state json='{"count": 1, "items": ["apple", "banana"]}'></wcs-state>
    <p id="count" data-wcs="textContent: count"></p>
    <ul id="items">
      <template data-wcs="for: items">
        <li data-wcs="textContent: items.*"></li>
      </template>
    </ul>
  `;

  // 2. Wait for the state element, then for every binding under `document`
  const stateEl = document.querySelector("wcs-state") as any;
  await stateEl.connectedCallbackPromise;
  await getBindingsReady(document);

  // 3. Assert the initial render
  expect(document.querySelector("#count")!.textContent).toBe("1");
  expect(document.querySelectorAll("#items li").length).toBe(2);

  // 4. Write through a writable proxy — exactly what a handler does
  await stateEl.createStateAsync("writable", async (state: any) => {
    state.count = 42;
    state.items = [...state.items, "cherry"];
  });
  await settle();

  // 5. Assert the re-render
  expect(document.querySelector("#count")!.textContent).toBe("42");
  expect(document.querySelectorAll("#items li").length).toBe(3);
});
```

To drive the page the way a user does, keep the state inline (methods included) and dispatch DOM events; a `data-wcs="onclick: up"` handler runs on `button.click()`, and the DOM reflects the write after one `settle()`.

- `getBindingsReady(root)` resolves once every binding under `root` (a `document` or a shadow root) is built, and rejects if binding initialization fails (v1.26+) or if the root's `<wcs-state>` failed to initialize — a root that never loaded reports the failure instead of "ready".
- Updates settle on the microtask queue; a single `setTimeout(0)` after a write is enough.
- `state.items = [...state.items, "cherry"]` is the reactive form — `state.items.push()` is not observed (same rule as in handlers).
- Under happy-dom, `customElements.define` upgrades existing nodes by **replacing** them; "a value reaches the same node after a late define" cannot be asserted headlessly. Event timing differences between happy-dom and real browsers are the other blind spot — keep one browser e2e (Playwright) for those.
- happy-dom's `textContent` setter turns a numeric `0` into an empty string (browsers render `"0"`), so a `textContent: count` binding reads `""` at zero in this recipe. Assert on the state value, or use `@wcstack/testing`, whose `mount()` shims the setter.

### 2. Bare Node (no vitest)

`@wcstack/server` already exports the globals swap it uses for SSR; reuse it. **Import `@wcstack/state` dynamically after `installGlobals`** — the element classes pick their base class when the module is evaluated, so a static import at the top of the file registers elements that happy-dom cannot construct:

```js
import { Window } from "happy-dom";
import { installGlobals } from "@wcstack/server";

const window = new Window({ url: "http://localhost/" });
const restore = installGlobals(window);   // document, customElements, HTMLElement, ... (GLOBALS_KEYS)
try {
  const { bootstrapState, getBindingsReady } = await import("@wcstack/state");
  bootstrapState();
  // ... the same mount / await / assert steps as recipe 1
} finally {
  restore();
  await window.happyDOM.close();
}
```

`installGlobals` also disables `URL.createObjectURL` for you, so inline-script state loads the same way as in recipe 1.

### 3. Snapshot the rendered HTML

[`renderToString()`](../server/README.md) from `@wcstack/server` returns the fully rendered markup as a string; compare it against a stored snapshot:

```ts
import { expect, it } from "vitest";
import { renderToString } from "@wcstack/server";

it("matches the rendered snapshot", async () => {
  const html = await renderToString(`
    <wcs-state json='{"items": ["apple", "banana"]}' enable-ssr></wcs-state>
    <ul><template data-wcs="for: items"><li data-wcs="textContent: items.*"></li></template></ul>
  `);
  expect(html).toMatchSnapshot();
});
```

## TypeScript Support

`defineState()` wraps your state object and provides type-safe `this` inside methods and getters — with zero runtime cost (identity function).

```typescript
import { defineState } from '@wcstack/state';

export default defineState({
  count: 0,
  users: [] as { name: string; age: number }[],

  increment() {
    this.count++;            // ✅ number
    this["users.*.name"];    // ✅ string (dot-path resolution)
    this.$getAll("users.*.age", []); // ✅ API method
  },

  get "users.*.ageCategory"() {
    return this["users.*.age"] < 25 ? "Young" : "Adult";
  }
});
```

Utility types `WcsPaths<T>` and `WcsPathValue<T, P>` are also exported for advanced use cases. See [docs/define-state.md](docs/define-state.md) for full documentation.

`defineState()` types the state file. To carry those types into the HTML, [`@wcstack/typescript`](../typescript/README.md) adds two CLIs: `wcs-schema` writes the `stateSchema` sidecar that `@wcstack/lint` and the VS Code extension validate `data-wcs` paths against, and `wcs-tsc` runs the TypeScript compiler over inline `<script type="module">` state. The whole story is in [docs/typescript.md](../../docs/typescript.md).

## API Reference

### `bootstrapState()`

Initialize the state system. Registers `<wcs-state>` custom element and sets up DOM content loaded handler.

```javascript
import { bootstrapState } from '@wcstack/state';
bootstrapState();
```

### Other exports

| Export | Description |
|---|---|
| `getBindingsReady(root)` | Resolves once every binding under `root` (a `document` or a shadow root) is built; rejects if binding initialization fails, or if the root's state element failed to initialize |
| `buildBindings(root)` | Build the bindings under a `document` or `ShadowRoot` explicitly — what the first `<wcs-state>` registered on a root schedules for it |
| `getConfig()` | The current configuration (read-only view) |
| `defineState(obj)` | Identity function that types `this` inside methods and getters — see [TypeScript Support](#typescript-support) |
| `VERSION` | The package version; stamped into `<wcs-ssr>` and compared on hydration |
| `getWcsManifest()` / `WCS_MANIFEST_VERSION` | Machine-readable manifest of the binding syntax, built-in filters and reserved names — derived from the implementation, consumed by `@wcstack/lint` and the VS Code extension |
| `builtinFilterMeta` | Argument and result metadata for every built-in filter |
| `analyzeContract()` | Dev-time contract analyzer; a no-op unless `enableContractAnalyzer` is on |

Subpath entries for tooling: `@wcstack/state/parser` (the `data-wcs` parser as a DOM-free pure function), `@wcstack/state/manifest`, and `@wcstack/state/wcs-manifest.json` (the manifest as a prebuilt JSON file).

### `<wcs-state>` Element

| Attribute | Description |
|---|---|
| `mount` | Static tree path to graft this state onto the root tree as a **volume** (v2 — replaces the removed `name` attribute; one state tree per root) |
| `state` | ID of a `<script type="application/json">` element |
| `src` | URL to `.json` or `.js` file |
| `json` | Inline JSON string |
| `bind-component` | Property name for web component binding |
| `enable-ssr` | Opt into SSR: the server emits `<wcs-ssr>` hydration data for this state and the client hydrates from it instead of re-rendering — see [Server-Side Rendering](#server-side-rendering) |

### IStateElement

| Property / Method | Description |
|---|---|
| `initializePromise` | Resolves when state is fully initialized — and also **when initialization fails**, so one element's failure never blocks the rest of the page's bindings; the error is delivered on `connectedCallbackPromise` |
| `connectedCallbackPromise` | Resolves once `connectedCallback` has completed (state loaded, `$connectedCallback` run) — what the testing recipes await. A **root** element that fails to initialize **rejects** it with the original error, unwrapped, and reports the failure once with `console.error`: an invalid `$` declaration, a source it cannot load, the SSR data merge, a DCC or `bind-component` setup error, or a second root `<wcs-state>` on the same root node (that second element stays unregistered but keeps the state it loaded, so remove it; moving a healthy element in the DOM is not a duplicate and is never refused). A **volume** (`<wcs-state mount="…">`) never rejects it — a volume failure resolves it instead, and some volume failures report nothing of their own: the error leaves as the `connectedCallback` promise that custom-element reactions discard, which a browser console shows as "Uncaught (in promise)" but nothing awaiting these promises (a test recipe, `renderToString()`) ever sees. Detaching an element while its source is still loading rejects nothing — that connection just ends, and re-appending the element (row pooling) initializes it and resolves normally. For the exact behaviour of any single failure site, read `__tests__/integration.initFailureDiagnostics.test.ts`: it pins every case |
| `listPaths` | Set of paths used in `for` loops |
| `getterPaths` | Set of paths defined as getters |
| `setterPaths` | Set of paths defined as setters |
| `createState(mutability, callback)` | Create a state proxy (`"readonly"` or `"writable"`) |
| `createStateAsync(mutability, callback)` | Async version of `createState` |
| `setInitialState(state)` | Set state programmatically. Before initialization it supplies the initial state. On an initialized element it replaces the whole state and re-applies every established binding to the new state before it returns (a detached element re-applies them when it reconnects); a binding whose path the new state no longer has reports a failed apply instead of keeping the old text. A re-set is not a write: it fires no `$watch` handler and no `$updatedCallback`. Lists are matched by array identity, so pass a new array when a list's length changed — re-setting with the same array instance after pushing to or splicing it in place is not supported. Throws on a loaded volume (`<wcs-state mount="…">` — its data was copied into the root tree, so write the paths under the mount path on the root instead), on a tree with grafted volumes or mounted components, and on an element that already failed to initialize — such an element cannot be re-armed; remove it and create a new one |
| `nextVersion()` | Increment and return version number |

## Architecture

```
bootstrapState()
  └── registerComponents()              // Register <wcs-state> custom element

<wcs-state> connectedCallback
  ├── one of, by placement:
  │   ├── _initializeDCC()              // under a data-wc-definition host: define the DCC class
  │   ├── _initializeVolume()           // mount=: graft this volume onto the root tree
  │   ├── _initializeBindWebComponent() // bind-component: alias the host's tree at the mount point
  │   └── _initialize()                 // root: load state (state attr / src / json / script / API)
  │         └── setStateElement()       // Register to WeakMap<Node, IStateElement> — one tree per root
  │               └── (first registration per rootNode)
  │                     └── queueMicrotask → buildBindings()
  ├── _callStateConnectedCallback()     // Call $connectedCallback if defined

buildBindings(root)
  ├── waitForStateInitialize()          // Wait for all <wcs-state> initializePromise
  ├── convertMustacheToComments()       // {{ }} → comment nodes
  ├── collectStructuralFragments()      // Collect for/if templates
  └── initializeBindings()              // Walk DOM, parse data-wcs, set up bindings
```

### Reactivity Flow

1. State changes via Proxy `set` trap → `setByAddress()`
2. Address resolved → updater enqueues absolute address
3. Dependency walker invalidates (dirties) downstream caches
4. Updater applies changes to bound DOM nodes via `applyChangeFromBindings()`

### State Address System

Paths like `users.*.name` are decomposed into:

- **PathInfo** — static path metadata (segments, wildcard count, parent path)
- **ListIndex** — runtime loop index chain
- **StateAddress** — combination of PathInfo + ListIndex
- **TreePath / AbsoluteStateAddress** — a PathInfo pinned to the state element that owns the tree, plus its ListIndex. Mounted components and volumes translate their relative paths onto the host tree at this level; v2 has one tree per root, so an address carries no state name

## Performance

Measured with the repository's [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark)-style
drivers (`e2e/bench/jsfb-verify.mjs`, `e2e/bench/memory-profile.mjs`) against the
standard 1,000 / 10,000-row table page — headless Chromium, medians, both
implementations measured back-to-back in the same session. `@wcstack/state`
passes the official keyed-mode classification while recycling row DOM through a
bounded pool (up to 1,000 rows).

| Duration (ms, median) | `@wcstack/state` | [`@wcstack/signals`](../signals/) |
|---|---|---|
| create 1,000 rows | 25.2 | 9.5 |
| replace all 1,000 rows | 18.8 | 12.5 |
| update every 10th of 10,000 | 11.4 | 4.7 |
| select row | 0.1 | 0.4 |
| swap 2 rows | 0.9 | 0.4 |
| remove row | 2.8 | 0.6 |
| append 1,000 to 10,000 | 48.6 | 14.2 |
| clear 10,000 rows | 54.6 | 52.2 |

| Heap after forced GC (MB) | `@wcstack/state` | `@wcstack/signals` |
|---|---|---|
| page ready | 1.0 | 0.6 |
| after create 1,000 | 5.6 | 3.5 |
| after 5× replace 1,000 | 6.4 | 3.7 |
| after create 10,000 | 35.1 | 18.0 |
| after create 10,000 + clear | 13.2 | 1.9 |

How to read this, honestly:

- Interactive operations (select / swap / remove) run in a few milliseconds or
  less, and clearing a huge list matches the signals implementation.
- Creating and appending rows costs ~2.5–3.5× `@wcstack/signals`. That is the
  price of the declarative binding ledger this package builds per row — the same
  ledger that powers `data-wcs` inspection, DevTools wiring, and SSR hydration.
  The two packages interoperate, so a hot list can be rendered with signals'
  `For` while the rest of the page stays declarative.
- The heap retained after a clear is the bounded row pool that makes the next
  list population cheap.

Absolute numbers are from one development machine, taken at v1.21.6 + the
clear-leak fix in PR#87. The v2.0 mount work was gated on the same drivers by
same-session A/B runs and stayed within run-to-run noise
([docs/state-mount-impl-plan.md](../../docs/state-mount-impl-plan.md) §2-2 and
slice 27), so the table has not been re-taken; absolute values swing by ±20%
with machine state, and the drivers in `e2e/bench/` reproduce the comparison on
your own hardware.

## Server-Side Rendering

`@wcstack/state` supports SSR via the companion [`@wcstack/server`](../server/) package. The same templates you write for the client render on the server — no changes needed.

### Quick Setup

1. Add `enable-ssr` to your `<wcs-state>` element:

```html
<wcs-state enable-ssr>
  <script type="module">
    export default {
      items: [],
      async $connectedCallback() {
        const res = await fetch("/api/items");
        this.items = await res.json();
      }
    };
  </script>
</wcs-state>
<template data-wcs="for: items">
  <div data-wcs="textContent: items.*.name"></div>
</template>
```

2. Render on the server:

```javascript
import { renderToString } from "@wcstack/server";

const html = await renderToString(template, {
  baseUrl: "http://localhost:3000"
});
```

That's it. The client-side `@wcstack/state` automatically detects the `<wcs-ssr>` element, restores state from the JSON snapshot, and resumes reactivity without re-rendering.

### How It Works

| Phase | What happens |
|-------|-------------|
| **Server** | `renderToString()` runs your template in happy-dom, executes `$connectedCallback` (including `fetch()`), applies all bindings, and outputs rendered HTML with a `<wcs-ssr>` element containing hydration data |
| **Client** | `<wcs-state enable-ssr>` loads state from `<wcs-ssr>` JSON, skips `$connectedCallback`, and `hydrateBindings()` wires up reactivity on the existing DOM |
| **Fallback** | If server/client versions mismatch, the SSR DOM is cleaned up and `buildBindings()` runs a full client-side render |

### What `enable-ssr` Does

| Context | Behavior |
|---------|----------|
| **Server** (`renderToString`) | Generates `<wcs-ssr>` with state JSON, template fragments, and property data |
| **Client** (hydration) | Reads `<wcs-ssr>`, restores state, skips `$connectedCallback`, hydrates bindings on existing DOM |

See [`@wcstack/server` README](../server/README.md) for full API documentation.

## License

MIT
