# @wcstack/state Reference

Sources: `packages/state/README.ja.md` (normative), `packages/state/examples/*`, `packages/fetch/examples/users-crud`, `src/filters/builtinFilters.ts`, `src/bindTextParser/*`. All verified against real code.

## 1. CDN Loading

```html
<!-- Auto-initialization (the one-liner used in all real examples) -->
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
```

```html
<!-- Manual initialization -->
<script type="module">
  import { bootstrapState } from 'https://esm.run/@wcstack/state';
  bootstrapState();
</script>
```

## 2. `<wcs-state>` State Definition (6 methods)

Resolution order: `state` attribute → `src` (.json/.js) → `json` attribute → inner `<script>` → wait for `setInitialState()`.

```html
<!-- 1. Reference a <script type="application/json"> by id -->
<script type="application/json" id="state">{ "count": 0 }</script>
<wcs-state state="state"></wcs-state>

<!-- 2. Inline JSON attribute -->
<wcs-state json='{ "count": 0 }'></wcs-state>

<!-- 3. External JSON -->
<wcs-state src="./data.json"></wcs-state>

<!-- 4. External JS module (export default {...}) -->
<wcs-state src="./state.js"></wcs-state>

<!-- 5. Inline script (most common. export default with type="module") -->
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

`<wcs-state>` attributes: `name` (state name, default `"default"`) / `state` / `src` / `json` / `bind-component` (Web Component binding) / `enable-ssr`.

### Named states

```html
<wcs-state name="cart">...</wcs-state>
<div data-wcs="textContent: total@cart"></div>
```

## 3. `data-wcs` Binding Syntax

```
property[#modifier[,modifier...]][|input filter...]: path[@state][|output filter...]
```

- Multiple bindings are **separated by `;`**: `data-wcs="textContent: count; class.over: count|gt(10)"`
- Filters on the left side (property side) apply in the **DOM→state input direction**: `<select data-wcs="value|number: selectedProductId">`
- Right-side filters apply in the state→DOM output direction.
- Multiple modifiers are comma-separated after a single `#`: `value#ro,init=none: path`

### Property types

| Property | Description |
|---|---|
| `value` | Element value (two-way for input/select/textarea) |
| `checked` | checkbox/radio checked state (two-way) |
| `textContent` / `text` | Text (`text` is an alias) |
| `html` | innerHTML |
| `class.NAME` | CSS class on/off (toggled by truthiness) |
| `style.PROP` | CSS style property |
| `attr.NAME` | Attribute setting (SVG namespace supported) |
| `radio` | Radio group → single value (two-way) |
| `checkbox` | Checkbox group → array (two-way) |
| `onclick`, `on*` | Event handlers |

In addition, any DOM property name can be used (e.g. `disabled: createFetch.loading`).

### Modifiers

| Modifier | Description |
|---|---|
| `#ro` | Read-only (disables two-way binding) |
| `#prevent` | `event.preventDefault()` |
| `#stop` | `event.stopPropagation()` |
| `#onchange` | Two-way binding on the `change` event instead of `input` |
| `#init=state\|element\|auto\|none` | Binding authority (direction of initial sync for wcBindable elements) |
| `#sync=call\|connect` | Snapshot read timing under element authority |

### Two-way binding (auto-enabled)

`<input>` (value/checked/valueAsNumber/valueAsDate), `<select>` (value, change event), `<textarea>` (value). `<input type="button">` is excluded.

### Mustache syntax

`{{ path|filter }}` in text nodes (enabled by default):

```html
<p>Hello, {{ user.name }}!</p>
<p>Count: {{ count|locale }}</p>
```

## 4. List Rendering (`for`)

```html
<template data-wcs="for: users">
  <div>
    <span data-wcs="textContent: users.*.name"></span>  <!-- full path -->
    <span data-wcs="textContent: .name"></span>          <!-- dot shorthand -->
  </div>
</template>
```

- No key attribute needed (value-based diffing). Arrays must **always be reassigned as new arrays** (`concat`/`toSpliced`/`filter`/`toSorted`/`toReversed`/`with`). `push`/`splice`/`sort` are not detected.
- Dot shorthand: `.name` → `users.*.name`, `.` → `users.*` (element value for primitive arrays); `.name|uc` and `.name@state` also work.
- `{{ .name }}` also works inside Mustache.

### Nested loops

```html
<template data-wcs="for: regions">
  <template data-wcs="for: .states">        <!-- .states → regions.*.states -->
    <span data-wcs="textContent: .name"></span> <!-- → regions.*.states.*.name -->
  </template>
</template>
```

### Loop index

- Inside getters/handlers: `this.$1` (outer), `this.$2` (inner), ...
- Inside templates: `{{ $1|inc(1) }}` (1-based row number)
- `.length` paths also work: `data-wcs="if: cart.items.length|gt(0)"`

## 5. Conditional Rendering (`if` / `elseif` / `else`)

```html
<template data-wcs="if: count|gt(0)"><p>Positive</p></template>
<template data-wcs="elseif: count|lt(0)"><p>Negative</p></template>
<template data-wcs="else:"><p>Zero</p></template>
```

`else:` **requires the trailing colon** (no right side). Nested `if` is allowed.

## 6. computed (path getters) and the Proxy API

**Getters on a plain object**, not class syntax. Dot-path string keys + `*` wildcard:

```javascript
export default {
  users: [{ id: 1, firstName: "Alice", lastName: "Smith" }],
  get total() { return this.price * (1 + this.tax); },          // top level
  get "cart.totalPrice"() { /* nested computed */ },
  get "users.*.fullName"() {                                     // wildcard
    return this["users.*.firstName"] + " " + this["users.*.lastName"];
  },
  set "users.*.fullName"(value) { /* path setter, two-way capable */ },
  get "categories.*.items.*.label"() { /* multiple wildcards */ },
};
```

- Inside a getter, `this["users.*.firstName"]` auto-resolves to the current loop element. Automatic dependency tracking, per-address caching.
- Direct numeric-index access works: `this["users.0.name"]`, `` this[`cart.items.${i}.quantity`] += 1 ``.
- Chaining into a getter's returned object works: `this["cart.items.*.product.price"]`.

### Proxy API (via `this`)

| API | Description |
|---|---|
| `this.$getAll(path, indexes?)` | Get all values of a wildcard path as an array (for aggregation). Partial index specification allowed: `this.$getAll("regions.*.states.*.population", [this.$1])` |
| `this.$resolve(path, indexes, value?)` | Read/write at specific indexes |
| `this.$postUpdate(path)` | Manually emit an update notification |
| `this.$trackDependency(path)` / `this.$untrackDependency(fn)` | Manually register / suppress dependencies |
| `this.$stateElement` | IStateElement access |
| `this.$1`, `this.$2`, ... | Loop indexes |

### Iron rule of state updates

```javascript
this["user.name"] = "Bob";   // ✅ path assignment → DOM update
this.user.name = "Bob";      // ❌ not detected
```

## 7. Filters (fixed at 40 built-ins; no custom registration API)

- Comparison: `eq` `ne` `not` `lt` `le` `gt` `ge`
- Arithmetic: `inc` `dec` `mul` `div` `mod`
- Number formatting: `fix` `round` `floor` `ceil` `locale` `percent`
- String: `uc` `lc` `cap` `trim` `slice` `substr` `pad` `rep` `rev`
- Type conversion: `int` `float` `boolean` `number` `string` `null`
- Date: `date` `time` `datetime` `ymd`
- Truthy/default: `truthy` `falsy` `defaults`

With arguments: `gt(10)`, `substr(0,10)`, `pad(5,0)`, `locale(ja-JP)`, `ymd(/)`, `eq('admin')` (quotes allowed, bare allowed, comma-separated). Chaining: `price|mul(1.1)|round(2)|locale(ja-JP)`. Do transformations the built-ins cannot express in a getter.

## 8. Event Handling

```html
<button data-wcs="onclick: handleClick">Click</button>
<form data-wcs="onsubmit#prevent: handleSubmit">...</form>
```

```javascript
export default {
  items: ["A", "B", "C"],
  handleClick(event) { /* this = state proxy */ },
  removeItem(event, index) {        // (event, ...listIndexes) when inside a loop
    this.items = this.items.toSpliced(index, 1);
  }
};
```

- Signature: `(event, ...listIndexes)`. Inside loops, the enclosing loop indexes are appended after the event.
- **`onclick:` binds a method name only and cannot pass arguments** — for argument variants, define zero-argument wrapper methods (e.g. `filterAll() { this.filterBy(""); }`).
- Writing `$command.<name>` on the right side emits directly: `<button data-wcs="onclick: $command.refreshList">`.

## 9. command-token / event-token

### command token (state → element method invocation)

```html
<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["refreshList"],
      onClick() { this.$command.refreshList.emit("/api/users", { method: "GET" }); }
    };
  </script>
</wcs-state>
<!-- Subscriber side. The right side must be $command.<name> (bare names not allowed) -->
<wcs-fetch data-wcs="command.fetch: $command.refreshList"></wcs-fetch>
```

- Declare with `$commandTokens: string[]` → `this.$command.<name>.emit(...args)`. Arguments are forwarded verbatim to the subscribing element's method (not awaited; wait on Promises with `Promise.all(token.emit(...))`).
- One token fans out to multiple elements; subscribe order is preserved.

### event token (element → state)

```html
<wcs-state>
  <script type="module">
    export default {
      users: [],
      $eventTokens: ["userCreated"],
      $on: {
        userCreated(state, event) {          // state is the first argument, not this
          state.users = state.users.concat(event.detail);
        },
        // emitter inside a loop: (state, event, ...listIndexes)
      }
    };
  </script>
</wcs-state>
<!-- The key is the wcBindable property name (not the raw event name). The token name is bare (no $) -->
<my-form data-wcs="eventToken.created: userCreated"></my-form>
```

### state ↔ wcs-fetch working example (skeleton of the users-crud example)

```html
<script type="module" src="https://esm.run/@wcstack/fetch/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["refreshList"],
      $eventTokens: ["userResponded"],
      // 1 fetch = 1 state slot. For outputs the element is the authority, so seed with real initial values (null)
      listFetch: { value: null, loading: false, error: null, status: 0 },
      createFetch: { url: "/api/users", method: "POST", manual: true,
                     body: { name: "" }, value: null, error: null, loading: false, status: 0 },
      get "listFetch.url"() { return "/api/users"; },   // compute the URL with a nested getter inside the slot
      get listRows() { return this["listFetch.value"] ?? []; }, // for: requires an array, so null-guard
      $on: {
        userResponded: (state, event) => {
          const status = event.detail?.status ?? 0;
          if (status < 200 || status >= 300) return;   // wcs-fetch:response also fires on errors
          state.$command.refreshList.emit();
        },
      },
    };
  </script>
</wcs-state>

<wcs-fetch data-wcs="...: listFetch; command.fetch: $command.refreshList"></wcs-fetch>
<wcs-fetch data-wcs="...: createFetch; eventToken.value: userResponded">
  <wcs-fetch-header name="Content-Type" value="application/json"></wcs-fetch-header>
</wcs-fetch>
```

### spread binding (`...`)

- `...: target` wires all wcBindable properties + inputs at once. `commands`/event tokens are excluded (explicit wiring required).
- Inside for: `...: storesFetches.*` (recommended) or `...: .`.
- Last-wins override: `...: usersFetch; status: alternateStatus`.
- Right-side filters are an **error**. `@stateName` propagates. Elements without a wcBindable declaration are an **error**.
- `undefined` state paths are write-skipped for the property (the element default survives). Clear by assigning `null`.

## 10. Other Features

- **Lifecycle**: On the state object: `$connectedCallback` (async allowed, awaited, runs on every reconnection), `$disconnectedCallback` (sync only), `$updatedCallback(paths, indexesListByPath)` (async allowed, not awaited). On the Web Component side: `async $stateReadyCallback(stateProp)`.
- **$streams**: `$streams: { name: { args?, source, fold?, initial? } }` — source is `(args, signal) => AsyncIterable|ReadableStream|Promise<same>`, honoring AbortSignal is mandatory, `initial` is required when `fold` is specified. status/error: `$streamStatus.<name>` (`"idle"|"active"|"done"|"error"`) / `$streamError.<name>`. args are synchronous, cannot read wildcards, self-dependency forbidden. Infinite streams require a bounded fold.
- **Web Component**: `<wcs-state bind-component="state">` inside the shadowRoot; from the host `data-wcs="state.message: user.name"`. In Light DOM the `name` attribute is required + `@name` references are required (namespace collisions otherwise).
- **DCC**: `<my-counter data-wc-definition><template shadowrootmode="open">...<wcs-state>...` + `$bindables: ["count"]` defines a custom element with no JS class.
- **Configuration**: `bootstrapState({ locale, debug, enableMustache, bindAttributeName, tagNames: { state }, enableDirectionalInitialSync, enablePropagationContext, enableContractAnalyzer })`.
- **TypeScript**: Wrap with `defineState({...})` for `this` type completion (zero runtime cost).
- **SSR**: `<wcs-state enable-ssr>` + `renderToString()` from `@wcstack/server`.

## Pitfall Checklist

1. `this.user.name = "Bob"` is not detected — always `this["user.name"] = "Bob"`.
2. Destructive methods like `push`/`splice`/`sort` are not detected — reassign a new array.
3. `onclick:` cannot take arguments — use zero-argument wrapper methods.
4. The `for:` path must be an array — while the fetch `value` is null, interpose a `?? []` derived getter.
5. Bare names (`fetchUsers`) on the command binding right side are not allowed — `$command.fetchUsers` is required.
6. The `eventToken.` key is the wcBindable **property name**, not the raw DOM event name.
7. `wcs-fetch:response` (the value event) also fires on HTTP/network errors — check the status in `$on`.
8. Do not seed convenient initial values into output-only wcBindable members (the element's real initial value replaces them).
9. `$streams` sources must not ignore AbortSignal.
10. Do not forget the trailing colon on `else:`.
11. Duplicate entries in `$commandTokens`/`$eventTokens` and undeclared keys in `$on` are initialization-time errors. Accessing an undeclared token (`this.$command.typo`) yields `undefined`.
12. There is no custom filter registration API — do transformations the 40 built-ins cannot express in a getter.
13. The only valid separator for multiple bindings in `data-wcs` is `;`.
