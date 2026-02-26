# @wcstack/state

**What if HTML had reactive data binding?**

Imagine a future where the browser natively understands state — you declare data inline, bind it to the DOM with attributes, and everything stays in sync. No virtual DOM, no compilation, no framework. Just HTML that reacts.

That's what `<wcs-state>` and `data-wcs` explore. One CDN import, zero dependencies, pure HTML syntax.

The CDN script only registers the custom element definition — nothing else happens at load time. When a `<wcs-state>` element connects to the DOM, it reads its state source, scans sibling elements for `data-wcs` bindings, and wires up reactivity. All initialization is driven by the element's lifecycle, not by your code.

## Features

- **Declarative data binding** — `data-wcs` attribute for property / text / event / structural binding
- **Reactive Proxy** — ES Proxy-based automatic DOM updates with dependency tracking
- **Structural directives** — `for`, `if` / `elseif` / `else` via `<template>` elements
- **Built-in filters** — 40 filters for formatting, comparison, arithmetic, date, and more
- **Two-way binding** — automatic for `<input>`, `<select>`, `<textarea>`
- **Web Component binding** — bidirectional state binding with Shadow DOM components
- **Path getters** — dot-path key getters (`get "users.*.fullName"()`) for virtual properties at any depth in a data tree, all defined flat in one place with automatic dependency tracking and caching
- **Mustache syntax** — `{{ path|filter }}` in text nodes
- **Multiple state sources** — JSON, JS module, inline script, API, attribute
- **SVG support** — full binding support inside `<svg>` elements
- **Lifecycle hooks** — `$connectedCallback` / `$disconnectedCallback` / `$updatedCallback`, plus `$stateReadyCallback` for Web Components
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

## Updating State

State changes are detected through **property assignment** (the Proxy `set` trap). To trigger reactive DOM updates, a value must be **assigned** to a state property.

### Primitive and Object Properties

Assignment must use **dot-path notation** (bracket syntax). The reactive proxy intercepts only top-level `set` traps, so standard nested property access bypasses change detection:

```javascript
// ✅ Path assignment — change detected
this.count = 10;
this["user.name"] = "Bob";

// ❌ Direct nested access — change NOT detected
this.user.name = "Bob";     // bypasses the Proxy set trap
```

### Arrays

Array mutating methods (`push`, `splice`, `sort`, `reverse`, …) modify the array in place **without triggering a property assignment**, so the reactive system does not detect the change. Instead, use **non-destructive** methods that return a new array and assign the result:

```javascript
// ✅ Non-destructive + assignment — change detected
this.items = this.items.concat({ id: 4, text: "New" });
this.items = this.items.toSpliced(index, 1);
this.items = this.items.filter(item => !item.done);
this.items = this.items.toSorted((a, b) => a.id - b.id);
this.items = this.items.toReversed();
this.items = this.items.with(index, newValue);

// ❌ Mutating — no assignment, change NOT detected
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

### Two-Way Binding

Automatically enabled for:

| Element | Property | Event |
|---|---|---|
| `<input type="checkbox/radio">` | `checked` | `input` |
| `<input>` (other types) | `value`, `valueAsNumber`, `valueAsDate` | `input` |
| `<select>` | `value` | `change` |
| `<textarea>` | `value` | `input` |

`<input type="button">` is excluded. Use `#ro` to disable, `#onchange` to change the event.

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

Three levels of nesting, five virtual properties — all defined side by side in a single flat object. Each level can reference values from any depth, and aggregation flows naturally from bottom to top via `$getAll`. In component-based frameworks (React, Vue), achieving the same requires creating a separate component for each nesting level, with props drilling or state management to pass computed values up the tree.

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

Most frameworks tightly couple state to components, forcing patterns like prop drilling, context providers, or external stores (Redux, Pinia) just to share data across the tree. In `@wcstack/state`, parent and child components are connected through **path contracts** — the parent binds an outer state path to an inner component property via `data-wcs`, and the child simply reads and writes its own state as usual:

1. The child references and updates the parent's state through its own state proxy — no props, no events, no awareness of the parent.
2. When the parent's state changes, the Proxy `set` trap automatically notifies any child bindings that reference the affected path.
3. Because the only coupling is the **path name**, both sides remain loosely coupled and independently testable.
4. The cost is path resolution (cached at O(1) after first access) plus change propagation through the dependency graph.

This provides a concrete solution to cross-component state management that other frameworks have been working around with increasingly complex abstractions.

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
| `$updatedCallback(paths, indexesListByPath)` | After state updates are applied | Return value is ignored (not awaited) |

Since the reactive proxy detects every property assignment as a change, standard `async/await` with direct property updates is sufficient for asynchronous operations — loading flags, fetched data, and error messages are all just property assignments. There is no need for abstractions like React Suspense or dedicated loading-state primitives.

- `this` inside hooks is the state proxy with full read/write access
- `$connectedCallback` is called **every time** the element is connected (including re-insertion after removal), making it suitable for setup that should be re-established
- `$disconnectedCallback` is called synchronously — use it for cleanup such as clearing timers, removing event listeners, or releasing resources
- `$updatedCallback(paths, indexesListByPath)` receives the updated path list. For wildcard updates, `indexesListByPath` contains the updated index sets
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
