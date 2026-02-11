# @wcstack/state

Declarative reactive state management for Web Components.  
`<wcs-state>` custom element and `data-wcs` attribute binding — zero runtime dependencies.

## Features

- **Declarative data binding** — `data-wcs` attribute for property / text / event / structural binding
- **Reactive Proxy** — ES Proxy-based automatic DOM updates with dependency tracking
- **Structural directives** — `for`, `if` / `elseif` / `else` via `<template>` elements
- **Built-in filters** — 37 filters for formatting, comparison, arithmetic, date, and more
- **Two-way binding** — automatic for `<input>`, `<select>`, `<textarea>`
- **Web Component binding** — bidirectional state binding with Shadow DOM components
- **Computed properties** — getter-based derivation with automatic cache invalidation
- **Mustache syntax** — `{{ path|filter }}` in text nodes
- **Multiple state sources** — JSON, JS module, inline script, API, attribute
- **SVG support** — full binding support inside `<svg>` elements
- **Zero dependencies** — no runtime dependencies

## Installation

### CDN (recommended)

```html
<!-- Auto-initialization — これだけで動作します -->
<script type="module" src="https://cdn.jsdelivr.net/npm/@wcstack/state/dist/auto.js"></script>
```

### CDN (manual initialization)

```html
<script type="module">
  import { bootstrapState } from 'https://cdn.jsdelivr.net/npm/@wcstack/state/dist/index.esm.js';
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
| `onclick`, `on*` | Event handler binding |

### Modifiers

| Modifier | Description |
|---|---|
| `#ro` | Read-only — disables two-way binding |
| `#prevent` | Calls `event.preventDefault()` on event handlers |
| `#stop` | Calls `event.stopPropagation()` on event handlers |
| `#onchange` | Uses `change` event instead of `input` for two-way binding |

### Two-Way Binding

Automatically enabled for:

| Element | Property | Event |
|---|---|---|
| `<input type="checkbox/radio">` | `checked` | `input` |
| `<input>` (other types) | `value`, `valueAsNumber`, `valueAsDate` | `input` |
| `<select>` | `value` | `change` |
| `<textarea>` | `value` | `input` |

`<input type="button">` is excluded. Use `#ro` to disable, `#onchange` to change the event.

### Mustache Syntax

When `enableMustache` is `true` (default), `{{ expression }}` in text nodes is supported:

```html
<p>Hello, {{ user.name }}!</p>
<p>Count: {{ count|locale }}</p>
```

Internally converted to comment-based bindings (`<!--@@:expression-->`).

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

Nested loops are supported with multi-level wildcards:

```html
<template data-wcs="for: regions">
  <template data-wcs="for: .states">
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

## Computed Properties (Getters)

Define computed properties using JavaScript getters with dot-path keys:

```html
<wcs-state>
  <script type="module">
    export default {
      price: 100,
      tax: 0.1,
      get total() {
        return this.price * (1 + this.tax);
      },
      users: [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" }
      ],
      get "users.*.displayName"() {
        return this["users.*.name"] + " (ID: " + this["users.*.id"] + ")";
      }
    };
  </script>
</wcs-state>
```

- Getters are automatically tracked and cached
- When dependencies change, the cache is invalidated (dirty) and recomputed on next access
- Wildcard getters (`users.*.displayName`) work inside loops

### Proxy APIs

Inside state objects (getters / methods), the following APIs are available via `this`:

| API | Description |
|---|---|
| `this.$getAll(path, indexes?)` | Get all values matching a wildcard path |
| `this.$resolve(path, indexes, value?)` | Resolve a wildcard path with specific indexes |
| `this.$postUpdate(path)` | Manually trigger update notification for a path |
| `this.$trackDependency(path)` | Manually register a dependency for cache invalidation |
| `this.$stateElement` | Access to the `IStateElement` instance |
| `this.$1`, `this.$2`, ... | Current loop index (1-based naming, 0-based value) |

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
    this.items.splice(index, 1);
  }
};
```

```html
<template data-wcs="for: items">
  <button data-wcs="onclick: removeItem">Delete</button>
</template>
```

## Filters

37 built-in filters are available for both input (DOM → state) and output (state → DOM) directions.

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

`@wcstack/state` supports bidirectional state binding with custom elements using Shadow DOM.

### Component Definition

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

- `bind-component="state"` inside Shadow DOM maps the component's `state` property to `<wcs-state>`
- `data-wcs="state.message: user.name"` on the host element binds outer state paths to inner component state properties
- Changes propagate bidirectionally between the component and the outer state

### Loop with Components

```html
<template data-wcs="for: users">
  <my-component data-wcs="state.message: .name"></my-component>
</template>
```

## SVG Support

All bindings work inside `<svg>` elements. Use `attr.*` for SVG attributes:

```html
<svg width="200" height="100">
  <template data-wcs="for: points">
    <circle data-wcs="attr.cx: .x; attr.cy: .y; attr.fill: .color" r="5" />
  </template>
</svg>
```

## Configuration

```javascript
import { config } from '@wcstack/state';

// All options with defaults:
config.bindAttributeName = 'data-wcs';          // Binding attribute name
config.bindComponentAttributeName = 'bind-component'; // Component binding attribute
config.tagNames.state = 'wcs-state';            // State element tag name
config.locale = 'en';                           // Default locale for filters
config.debug = false;                           // Debug mode
config.enableMustache = true;                   // Enable {{ }} syntax
```

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
  ├── registerComponents()    // Register <wcs-state> custom element
  └── registerHandler()       // DOMContentLoaded handler
        ├── waitForStateInitialize()    // Wait for all <wcs-state> to load
        ├── convertMustacheToComments() // {{ }} → comment nodes
        ├── collectStructuralFragments() // Collect for/if templates
        └── initializeBindings()        // Walk DOM, parse data-wcs, set up bindings
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

## License

MIT
