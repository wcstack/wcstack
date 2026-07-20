# @wcstack/state

**This is not another convenient frontend framework. It is a different lineage that rearranges the premises of frontend development.**

Most libraries place the coupling point between UI, state, and components inside JavaScript. `@wcstack/state` does not. It assumes no virtual DOM, no compilation step, no hooks, no selectors. UI and state are connected by HTML and path strings alone.

That is what `<wcs-state>` and `data-wcs` explore. One CDN import, zero dependencies, pure HTML syntax. The CDN script only registers the custom element definition — nothing else happens at load time. When a `<wcs-state>` element connects to the DOM, it reads its state source, scans all `data-wcs` bindings within the same root node (`document` or `ShadowRoot`), and wires up reactivity. All initialization is driven by the element's lifecycle, not by your code.

## What Does Not Exist Here

The following are not missing features. **They do not exist by design.**

- APIs for pulling variables out of state into components
- Per-element binding objects that mediate state access
- hooks
- selectors
- glue code that imports reactive primitives into component code

None of these exist by design.

Why: this library does not put the UI-state coupling point inside JavaScript. State is not pulled into components. HTML refers to state through path strings. Elements do not own state, and state does not know elements. The only shared contract is the path.

## Do Not Compare This to Existing Frameworks

This is not solving the same problem as React / Vue / Solid with a different syntax. **The premises are different.**

| What mainstream frameworks assume | What `@wcstack/state` assumes |
|---|---|
| Components are the coupling point between UI and state | Path strings are the coupling point between UI and state |
| JavaScript is the center of rendering | HTML and the DOM are the center |
| State is pulled into components | Paths are declared and the DOM connects to state |
| hooks / selectors / signals express subscriptions | Attributes and paths express bindings |
| The whole app runs inside a framework execution model | A thin reactive layer is added on top of web standards |

Before making a comparison chart, understand this difference in premises. These tools may live in the same ecosystem, but they cut the problem space very differently.

## First Principle: Path as the Universal Contract

In every existing framework, the **component** is the coupling point between UI and state. Components import state hooks, selectors, or reactive primitives, and the binding happens inside JavaScript. No matter how cleanly you separate your state store, there is always glue code in the component that pulls state in.

`@wcstack/state` eliminates that coupling entirely. The **only** thing connecting UI and state is a **path string** — a dot-separated address like `user.name` or `cart.items.*.subtotal`. This is the sole contract between the two layers:

| Layer | What it knows | What it doesn't know |
|-------|---------------|----------------------|
| **State** (`<wcs-state>`) | Data structure and business logic | Which DOM nodes are bound |
| **UI** (`data-wcs`) | Path strings and display intent | How state is stored or computed |
| **Components** (`@name`) | The path they need from a named state | The other component's internals |

Three levels of path contracts keep everything loosely coupled:

1. **UI ↔ State** — A `data-wcs="textContent: user.name"` attribute is the entire binding. No hooks, no selectors, no reactive primitives. The component's JavaScript doesn't contain a single line that references state.

2. **Component ↔ Component** — Cross-component communication happens through named state references (`@stateName`). Components never import or depend on each other; they share a naming convention, nothing more.

3. **Loop context** — Inside a `for` loop, `*` acts as an abstract index. Bindings like `items.*.price` resolve to the current element automatically. The template doesn't know its concrete position — the wildcard is the contract.

### Why This Matters

This is complete separation of UI and state with **no JavaScript intermediary**. You can:

- Redesign the entire UI without touching state logic
- Refactor state structure and only update path strings
- Read the HTML alone and understand every data dependency

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

- **Declarative data binding** — `data-wcs` attribute for property / text / event / structural binding
- **Reactive Proxy** — ES Proxy-based automatic DOM updates with dependency tracking
- **Structural directives** — `for`, `if` / `elseif` / `else` via `<template>` elements
- **Built-in filters** — 40 filters for formatting, comparison, arithmetic, date, and more
- **Two-way binding** — automatic for `<input>`, `<select>`, `<textarea>`
- **Web Component binding** — bidirectional state binding with Shadow DOM components
- **Command tokens** — invoke methods on wc-bindable custom elements from state via a pub/sub channel (`command.<method>: tokenName`)
- **Event tokens** — the dual of command tokens: receive a wc-bindable element's dispatched events in state via `eventToken.<prop>: tokenName` + the `$on` map
- **Streams** — fold continuous async flows (async iterables / `ReadableStream`) into reactive properties via the `$streams` declaration, with switchMap-style dependency-driven restart
- **Path getters** — dot-path key getters (`get "users.*.fullName"()`) for virtual properties at any depth in a data tree, all defined flat in one place with automatic dependency tracking and caching
- **Mustache syntax** — `{{ path|filter }}` in text nodes
- **Multiple state sources** — JSON, JS module, inline script, API, attribute
- **SVG support** — full binding support inside `<svg>` elements
- **Lifecycle hooks** — `$connectedCallback` / `$disconnectedCallback` / `$updatedCallback`, plus `$stateReadyCallback` for Web Components
- **TypeScript support** — `defineState()` for typed state definitions with dot-path autocompletion ([details](docs/define-state.md))
- **Server-Side Rendering** — `enable-ssr` attribute + `@wcstack/server` for full SSR with automatic hydration
- **Zero dependencies** — no runtime dependencies

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

### Named State

Multiple state elements can coexist with the `name` attribute. Bindings reference them with `@name`:

```html
<wcs-state name="cart">...</wcs-state>
<wcs-state name="user">...</wcs-state>

<div data-wcs="textContent: total@cart"></div>
<div data-wcs="textContent: name@user"></div>
```

Default name is `"default"` (no `@` needed).

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
property[#modifier]: path[@state][|filter[|filter(args)...]]
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
| `@state` | Named state reference | `@cart`, `@user` |
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

For custom elements that declare `static wcBindable`, every prop binding resolves an **authority** — which side wins the **initial sync** when the binding attaches. The steady-state direction is decided separately, by the member's declared shape: an output-only member never accepts state writes (a permanent contract), while a two-way member flows both ways after the initial sync regardless of which side won it. The default authority is derived from where the member is declared (on by default via `enableDirectionalInitialSync`):

| Member declared in | Default authority | Effect |
|---|---|---|
| `properties` only (output-only) | `element` | The element's value flows into state; **state never writes this member** |
| `inputs` only | `state` | State writes the element |
| `properties` + `inputs` (two-way) | `state` | Classic behavior — state writes first, element events update state afterwards |
| — (no `wcBindable`; plain HTML elements) | `state` | Unchanged behavior |

> **Authoring rule:** declare every settable member in **both** `properties` and `inputs`. A member declared only in `properties` is output-only — state→element writes are suppressed for the life of the binding, and the element's own initial value overwrites whatever the state seeded. (`@wcstack` I/O node Shells and DCC `$bindables` follow this rule.)

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

For custom elements that declare the [`wc-bindable` protocol](#wcbindable-protocol), `...: target` wires all of the element's **properties + inputs** to a single state object in one line:

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
- `@stateName` propagates to every expanded entry (`...: fetchX@store`).
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

The `for:` directive uses a **value-based diff algorithm** — each array element's value itself serves as the identity key. There is no need for an explicit `key` attribute (like React's `key` or Vue's `:key`). When the array is reassigned, the differ matches old and new elements by value, reusing existing DOM nodes for unchanged items and efficiently adding, removing, or reordering the rest.

#### Dot Shorthand

Inside a `for` loop, paths starting with `.` are expanded relative to the loop's array path:

| Shorthand | Expanded to | Description |
|---|---|---|
| `.name` | `users.*.name` | Property of the current element |
| `.` | `users.*` | The current element itself |
| `.name\|uc` | `users.*.name\|uc` | Filters are preserved |
| `.name@state` | `users.*.name@state` | State name is preserved |

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

  // Prefecture level — aggregate from cities
  get "regions.*.prefectures.*.totalPopulation"() {
    return this.$getAll("regions.*.prefectures.*.cities.*.population", [])
      .reduce((a, b) => a + b, 0);
  },

  // Region level — aggregate from prefectures
  get "regions.*.totalPopulation"() {
    return this.$getAll("regions.*.prefectures.*.totalPopulation", [])
      .reduce((a, b) => a + b, 0);
  },

  // Top level — aggregate from regions
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

40 built-in filters are available for both input (DOM → state) and output (state → DOM) directions.

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

### Number Formatting

| Filter | Description | Example |
|---|---|---|
| `fix(n)` | Fixed decimal places | `price\|fix(2)` → `"100.00"` |
| `round(n?)` | Round | `value\|round(2)` |
| `floor(n?)` | Floor | `value\|floor` |
| `ceil(n?)` | Ceiling | `value\|ceil` |
| `locale(loc?)` | Locale number format | `count\|locale` / `count\|locale(ja-JP)` |
| `percent(n?)` | Percentage format | `ratio\|percent(1)` |

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
3. Because the only coupling is the **path name**, both sides remain loosely coupled and independently testable.
4. The cost is path resolution (cached at O(1) after first access) plus change propagation through the dependency graph.

This provides a lightweight approach to cross-component state management based on path resolution rather than component-level abstractions.

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

Light DOM components do not use Shadow DOM. The state namespace is shared with the parent scope (just like CSS), so a `name` attribute is required.

```javascript
class MyLightComponent extends HTMLElement {
  state = { message: "" };

  connectedCallback() {
    this.innerHTML = `
      <wcs-state bind-component="state" name="my-light"></wcs-state>
      <div data-wcs="text: message@my-light"></div>
      <input type="text" data-wcs="value: message@my-light" />
    `;
  }
}
customElements.define("my-light-component", MyLightComponent);
```

- `name` attribute is **required** for Light DOM components (namespace is shared with the parent scope)
- Bindings must explicitly reference the state name with `@my-light`
- `<wcs-state>` must be a direct child of the component element

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
- Light DOM components **require** a `name` attribute to avoid namespace conflicts with the parent scope
- Light DOM bindings must reference the state name explicitly (e.g., `@my-light`)

### Loop with Components

```html
<template data-wcs="for: users">
  <my-component data-wcs="state.message: .name"></my-component>
</template>
```

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
- When the owning `<wcs-state>` is disconnected, the entire token registry is cleared

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

Event tokens share the same `Token` pub/sub primitive as command tokens — `name` / `size` / `subscribe` / `unsubscribe` / `emit`, with subscribe-order preservation (see [Token API](#token-api)). The token is resolved from the registry on every event so a re-`setInitialState()` rebuild still reaches the latest `$on` subscribers. When the owning `<wcs-state>` is disconnected, the event-token registry is cleared.

## Streams (`$streams`)

Command tokens and event tokens carry discrete interactions. **`$streams`** covers the remaining shape: a continuous flow. Declare an async producer (async iterable / async generator / `ReadableStream`) and the framework **folds it into a single reactive property** — each chunk goes through normal path assignment, so bindings, path getters, and `$updatedCallback` react exactly as if you had assigned the value yourself. When a state path read by the `args` function changes, the running producer is aborted and the source is restarted with the new arguments (switchMap-style dependency-driven restart). Streams start eagerly after `$connectedCallback` completes and are aborted when the element disconnects.

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

Key rules:

- **Cooperative cancellation (MUST)** — `source` must observe the passed `AbortSignal` and stop producing when it fires.
- **Bounded fold** — demand never flows back to the producer (backpressure is deliberately abandoned). For infinite / long-lived streams use a bounded fold — latest, count, last-N (`(acc, chunk) => [...acc.slice(-99), chunk]`), windowed aggregates. Raw accumulation of every chunk is for finite streams only.
- **`args` is synchronous** — returning a Promise is an error, and wildcard reads inside `args` are rejected.
- **No self-dependency, no mutual cycles** — `args` reading the stream's own value or status raises an error. Mutual cycles between two streams (A's `args` reads B's value and vice versa) are not detected and restart forever — do not build them. One-way chains (A's value feeding B's `args`) are legitimate.
- **SSR does not start streams** — on the server the declaration is parsed and the property is materialized with `initial`, but no source runs; the client starts streams as usual.

See [docs/streams.md](docs/streams.md) for the full contract — lifecycle and ownership, restart semantics, flush granularity, and the out-of-scope list.

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

### `$bindables` and wc-bindable Protocol

The `$bindables` array declares which state properties are exposed as component properties with change events, following the [wc-bindable protocol](https://github.com/nicenemo/nicenemo/blob/main/docs/wc-bindable-protocol.md):

```javascript
export default {
  count: 0,
  increment() { this.count++; },
  $bindables: ["count"]
};
```

This generates:

- `static wcBindable` on the class — protocol metadata for framework adapters. Each `$bindables` member is declared in both `properties` and `inputs` (two-way), so parent-state → DCC writes keep working under directional initial sync — see [Binding Authority](#binding-authority-init--sync)
- Getter/setter on the prototype — reads/writes go through the reactive proxy
- `CustomEvent` dispatch — `my-counter:count-changed` fires on every mutation

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

State objects can define `$connectedCallback`, `$disconnectedCallback`, and `$updatedCallback` for initialization, cleanup, and update lifecycle handling.

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
| `$updatedCallback(paths, indexesListByPath)` | After state updates are applied | Yes (not awaited) |

All hooks except `$disconnectedCallback` support `async` — you can use `async/await` in any of them. Since the reactive proxy detects every property assignment as a change, standard `async/await` with direct property updates is sufficient for asynchronous operations — loading flags, fetched data, and error messages are all just property assignments, without requiring additional abstractions for async state management.

- `this` inside hooks is the state proxy with full read/write access
- `$connectedCallback` is called **every time** the element is connected (including re-insertion after removal), making it suitable for setup that should be re-established
- `$disconnectedCallback` is called synchronously — use it for cleanup such as clearing timers, removing event listeners, or releasing resources
- `$updatedCallback(paths, indexesListByPath)` receives the updated path list. For wildcard updates, `indexesListByPath` contains the updated index sets. Can be `async`, but the return value is not awaited
- In Web Components, define `async $stateReadyCallback(stateProp)` to receive a hook when the bound state becomes available via `bind-component`

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
| `locale` | `'en'` | Default locale for filters |
| `debug` | `false` | Debug mode |
| `enableMustache` | `true` | Enable `{{ }}` syntax |
| `enableDirectionalInitialSync` | `true` | Direction-aware binding authority (`#init=` / `#sync=` binding modifiers) — see [Binding Authority](#binding-authority-init--sync). Default on; set `false` to opt out |
| `enablePropagationContext` | `true` | Causal propagation tracking across bindings (echo/diamond loop prevention). Default on; set `false` to opt out |
| `enableContractAnalyzer` | `false` | Opt-in dev-time contract analyzer (exposes `analyzeContract`) |

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

## API Reference

### `bootstrapState()`

Initialize the state system. Registers `<wcs-state>` custom element and sets up DOM content loaded handler.

```javascript
import { bootstrapState } from '@wcstack/state';
bootstrapState();
```

### `<wcs-state>` Element

| Attribute | Description |
|---|---|
| `name` | State name (default: `"default"`) |
| `state` | ID of a `<script type="application/json">` element |
| `src` | URL to `.json` or `.js` file |
| `json` | Inline JSON string |
| `bind-component` | Property name for web component binding |

### IStateElement

| Property / Method | Description |
|---|---|
| `name` | State name |
| `initializePromise` | Resolves when state is fully initialized |
| `listPaths` | Set of paths used in `for` loops |
| `getterPaths` | Set of paths defined as getters |
| `setterPaths` | Set of paths defined as setters |
| `createState(mutability, callback)` | Create a state proxy (`"readonly"` or `"writable"`) |
| `createStateAsync(mutability, callback)` | Async version of `createState` |
| `setInitialState(state)` | Set state programmatically (before initialization) |
| `bindProperty(prop, descriptor)` | Define a property on the raw state object |
| `nextVersion()` | Increment and return version number |

## Architecture

```
bootstrapState()
  └── registerComponents()              // Register <wcs-state> custom element

<wcs-state> connectedCallback
  ├── _initializeBindWebComponent()     // bind-component: get state from parent component
  ├── _initialize()                     // Load state (state attr / src / json / script / API)
  │     └── setStateElementByName()     // Register to WeakMap<Node, Map<name, element>>
  │           └── (first registration per rootNode)
  │                 └── queueMicrotask → buildBindings()
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
- **AbsoluteStateAddress** — state name + StateAddress (for cross-state references)

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

Absolute numbers are from one development machine (v1.21.6 + the clear-leak fix
in PR#87); the drivers in `e2e/bench/` reproduce the comparison on your own
hardware.

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
