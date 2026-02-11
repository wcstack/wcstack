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
- **Path getters** — dot-path key getters (`get "users.*.fullName"()`) for per-element computed properties with automatic dependency tracking and caching
- **Mustache syntax** — `{{ path|filter }}` in text nodes
- **Multiple state sources** — JSON, JS module, inline script, API, attribute
- **SVG support** — full binding support inside `<svg>` elements
- **Lifecycle hooks** — `$connectedCallback` / `$disconnectedCallback` for initialization and cleanup
- **Zero dependencies** — no runtime dependencies

## Installation

### CDN (recommended)

```html
<!-- Auto-initialization — this is all you need -->
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

## Path Getters (Computed Properties)

**Path getters** are the core feature of `@wcstack/state`. Define computed properties using JavaScript getters with **dot-path string keys** containing wildcards (`*`). They act as per-element derived properties that automatically run in the context of `for:` loops.

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

## Lifecycle Hooks

State objects can define `$connectedCallback` and `$disconnectedCallback` methods that are called when the `<wcs-state>` element is connected to or disconnected from the DOM.

```html
<wcs-state>
  <script type="module">
    export default {
      timer: null,
      count: 0,

      // Called when <wcs-state> is connected to the DOM (supports async)
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
| `$connectedCallback` | After state initialization on first connect; on every reconnect thereafter | Yes (`async` supported) |
| `$disconnectedCallback` | When the element is removed from the DOM | No (sync only) |

- `this` inside hooks is the state proxy with full read/write access
- `$connectedCallback` is called **every time** the element is connected (including re-insertion after removal), making it suitable for setup that should be re-established
- `$disconnectedCallback` is called synchronously — use it for cleanup such as clearing timers, removing event listeners, or releasing resources

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
