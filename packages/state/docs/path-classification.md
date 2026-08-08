# Path Classification

State paths in `@wcstack/state` are classified by their structure as follows.

## Classification Tree

```
Path
├── Static Path — No wildcards
│   ├── Simple Path           — Single segment: count, name
│   └── Nested Path           — Two or more segments: cart.totalPrice, user.profile.name
│
├── Pattern Path — Contains wildcard `*`
│   ├── Single-level Pattern  — One `*`: users.*.name
│   └── Multi-level Pattern   — Two or more `*`: categories.*.products.*.price
│
├── Shorthand Path — Dot-prefixed path inside a for context
│   ├── Single-level Shorthand  — .name → users.*.name
│   └── Multi-level Shorthand   — .products.*.name → categories.*.products.*.name
│
├── Resolved Path — `*` replaced with a concrete index
│   ├── Fully Resolved Path       — All `*` resolved: users.0.name
│   └── Partially Resolved Path   — Some `*` unresolved (unsupported)
│
└── Computed Path — Virtual path defined by a getter
    └── e.g. get "users.*.ageCategory"() { ... }
```

## 1. Static Path

A path without wildcards that uniquely points to a specific location in the state tree.

### Simple Path

A reference to a top-level property without dot delimiters.

```
count          → number
name           → string
active         → boolean
users          → array
```

**Usage:**
```html
<div data-wcs="textContent: count"></div>
<template data-wcs="for: users">...</template>
```

### Nested Path

Traverses the hierarchy via dot delimiters. References a nested property of an object.

```
cart.totalPrice        → number
user.profile.name      → string
cart.items.length      → number (built-in array property)
```

**Usage:**
```html
<div data-wcs="textContent: cart.totalPrice"></div>
```

**Note:** Assignment via nested path `this.cart.totalPrice = 100` is not detected by the Proxy.
Use `this["cart.totalPrice"] = 100` instead.

## 2. Pattern Path

An abstract path containing the wildcard `*`, corresponding to each element of an array.
Used within `for` template bindings.

### Single-level Pattern

One `*`. Iterates over a single array.

```
users.*                → { name: string, age: number } (full array element)
users.*.name           → string
users.*.age            → number
```

**Usage:**
```html
<template data-wcs="for: users">
  <span data-wcs="textContent: .name"></span>
  <!-- .name is shorthand for users.*.name -->
</template>
```

### Multi-level Pattern

Two or more `*`. Iterates over nested arrays.

```
categories.*.products.*.price    → number
categories.*.products.*.name     → string
```

**Usage:**
```html
<template data-wcs="for: categories">
  <template data-wcs="for: .products">
    <span data-wcs="textContent: .price"></span>
  </template>
</template>
```

## 3. Shorthand Path

A path starting with `.` inside a `for` template.
Automatically prefixed with the parent `for` path and expanded to a pattern path.

### Single-level Shorthand

Shorthand within a single `for` context.

```
Inside for: users context:
  .name       → users.*.name
  .age        → users.*.age
```

**Usage:**
```html
<template data-wcs="for: users">
  <span data-wcs="textContent: .name"></span>
  <span data-wcs="textContent: .age"></span>
</template>
```

### Multi-level Shorthand

Shorthand within nested `for` contexts. The innermost `for` path becomes the prefix.

```
Inside for: categories > for: .products context:
  .name       → categories.*.products.*.name
  .price      → categories.*.products.*.price
```

**Usage:**
```html
<template data-wcs="for: categories">
  <h2 data-wcs="textContent: .name"></h2>
  <template data-wcs="for: .products">
    <span data-wcs="textContent: .name"></span>
    <!-- .name expands to categories.*.products.*.name -->
  </template>
</template>
```

**Expansion rules:**
1. Paths starting with `.` are treated as shorthand paths
2. The prefix `path.*` of the **innermost (nearest ancestor) `for` path** is prepended
3. After expansion, the path is treated as a pattern path

**Note:** In nested `for` loops, shorthand paths always expand against the innermost `for`.
To reference a property of an outer `for`, use the full pattern path instead.

```html
<template data-wcs="for: categories">
  <template data-wcs="for: .products">
    <span data-wcs="textContent: .name"></span>
    <!-- .name → categories.*.products.*.name (expands against inner for: .products) -->

    <span data-wcs="textContent: categories.*.name"></span>
    <!-- Full path required to reference outer categories name -->
  </template>
</template>
```

## 4. Resolved Path

A path where `*` has been replaced with a concrete index.
Primarily used programmatically within methods.

### Fully Resolved Path

All `*` replaced with concrete indices.

```
users.0.name           → "Alice"
users.1.age            → 25
cart.items.2.price     → 300
```

**Usage (inside methods):**
```javascript
increment() {
  // Bracket access with dot path
  this["users.0.name"] = "Bob";

  // Dynamic specification with template literal
  this[`users.${this.$1}.name`] = "Bob";

  // Via $resolve API
  this.$resolve("users.*.name", [0], "Bob");
}
```

### Partially Resolved Path — Unsupported

A path where only some `*` are replaced with indices.

```
categories.0.products.*.name    ← Unsupported
```

This pattern is not supported by `@wcstack/state`.
Either resolve all `*` or keep all `*` as wildcards.

## 5. Computed Path

A virtual path defined by a getter in the state object.
Does not exist as data; computed dynamically on access.

```javascript
export default {
  users: [{ name: "Alice", age: 30 }],

  // Computed path: users.*.ageCategory
  get "users.*.ageCategory"() {
    return this["users.*.age"] < 25 ? "Young" : "Adult";
  },

  // Computed path: cart.totalPrice
  get "cart.totalPrice"() {
    return this.$getAll("cart.items.*.price", []).reduce((sum, v) => sum + v, 0);
  },
};
```

**Characteristics:**
- Can be defined in pattern path form (`users.*.ageCategory`)
- Can be defined in static path form (`cart.totalPrice`)
- Automatically recomputed when dependent paths change
- Read-only (unless a setter is defined)

## Path Classification Quick Reference

| Classification | Example | `*` | Index | Usage |
|---|---|---|---|---|
| Simple Path | `count` | None | None | Direct binding |
| Nested Path | `cart.totalPrice` | None | None | Object hierarchy access |
| Single-level Pattern | `users.*.name` | One | None | Binding inside for template |
| Multi-level Pattern | `a.*.b.*.c` | Two+ | None | Nested for templates |
| Single-level Shorthand | `.name` | None (after expansion) | None | Shorthand inside for template |
| Multi-level Shorthand | `.products.*.name` | None (after expansion) | None | Shorthand in nested for template |
| Fully Resolved Path | `users.0.name` | None | Yes | Programmatic access in methods |
| Partially Resolved Path | `a.0.b.*.c` | Mixed | Mixed | **Unsupported** |
| Computed Path | `get "x.*.y"()` | Any | None | Automatic derived data |

## Availability Matrix by Situation

### Legend

- ✅ Available
- ❌ Not available
- ⚠ Conditional (see notes)

### UI (HTML Bindings)

| Situation | Simple | Nested | Pattern | Shorthand | Resolved | Computed |
|---|---|---|---|---|---|---|
| `data-wcs` outside `for` | ✅ | ✅ | ❌ ^1 | ❌ ^2 | ❌ ^3 | ✅ |
| `data-wcs` inside `for` | ✅ | ✅ | ✅ | ✅ | ❌ ^3 | ✅ |
| `{{ }}` / `<!--@@:-->` outside `for` | ✅ | ✅ | ❌ ^1 | ❌ ^2 | ❌ ^3 | ✅ |
| `{{ }}` / `<!--@@:-->` inside `for` | ✅ | ✅ | ✅ | ✅ | ❌ ^3 | ✅ |
| `for:` value (iteration target) | ✅ | ✅ | ✅ ^4 | ⚠ ^5 | ❌ | ✅ ^4 |
| `if:` / `elseif:` value | ✅ | ✅ | ⚠ ^6 | ✅ | ❌ | ✅ |
| Event handler `onclick:` value | — | — | — | — | — | — |

^1 No loop context to resolve `*`
^2 No parent `for` to expand against
^3 UI bindings do not use concrete indices (the loop context automatically resolves `*`)
^4 A pattern path is possible inside a nested `for` (e.g., `for: users.*.items` — `*` resolved by the parent `for: users` context). A computed getter returning an array is a legal iteration target too, in static form (`get weeks()` → `for: weeks`) or pattern form (`get "weeks.*.days"()` → `for: weeks.*.days`, which carries the same nested-`for` requirement) — see `packages/state/examples/calendar`
^5 Only possible inside nested `for` (e.g., `for: .products`)
^6 Only possible inside `for` template

### State (JavaScript — inside defineState)

| Situation | Simple | Nested | Pattern | Shorthand | Resolved | Computed |
|---|---|---|---|---|---|---|
| **Property declaration** (key name) | ✅ | ❌ ^7 | ❌ ^7 | ❌ | ❌ | ❌ |
| **getter/setter declaration** (key name) | ✅ ^8 | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Inside getter (read)** | ✅ | ✅ | ⚠ ^9 | ❌ | ⚠ ^10 | ✅ |
| **Inside method (outside for context)** | ✅ | ✅ | ❌ ^11 | ❌ | ✅ | ✅ ^12 |
| **Inside method (inside for context)** | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ ^12 |
| **`$getAll(path)`** | ❌ ^13 | ❌ ^13 | ✅ | ❌ | ❌ | ❌ |
| **`$resolve(path, indexes)`** | ❌ ^14 | ❌ ^14 | ✅ | ❌ | ❌ | ❌ |
| **`$postUpdate(path)`** | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| **`$trackDependency(path)`** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |

^7 Data properties are object literal keys, not paths (`count: 0` is valid but `"cart.totalPrice": 0` represents a different data structure)
^8 A simple path getter declaration is a computed value for a nested path (e.g., `get "totalPrice"()` — effectively `get totalPrice()`)
^9 Only pattern paths sharing the same wildcard scope as the declaration are allowed (see "Wildcard Scope in Getters" below). Does not apply to `$getAll`/`$resolve` arguments
^10 `this["users.0.name"]` technically works but dependency tracking may not be accurate. Using `$resolve` is recommended
^11 No loop context to resolve `*`. Use `$getAll` or `$resolve` instead
^12 Read-only for computed paths (cannot write unless a setter is defined)
^13 `$getAll` returns all elements matching wildcards — not typically used with static paths (technically works)
^14 `$resolve` resolves wildcards with indices — unnecessary for paths without wildcards

### Event Handler Notes

The value of event handlers like `onclick:` specifies a **method name**, not a path.
Path classification does not apply.

```html
<button data-wcs="onclick: increment">+</button>
<button data-wcs="onclick#prevent: handleSubmit">Submit</button>
```

Inside `for` templates, event handler methods receive loop indices via `$1`–`$9` arguments.

```html
<template data-wcs="for: users">
  <button data-wcs="onclick: deleteUser">Delete</button>
  <!-- deleteUser(event, $1) where $1 is the array index -->
</template>
```

### Wildcard Scope in Getters

When a getter is declared with a pattern path, `this["..."]` access inside the getter body
may only use paths that **share the same wildcard scope (same `*` positions in the same array)**.

This constraint applies to direct `this["..."]` access.
It does not apply to `$getAll` or `$resolve` arguments (these resolve wildcards independently).

#### What is Wildcard Scope?

Information about which array and which level each `*` in a path refers to.
When a getter executes, `*` is implicitly bound to a specific array index.
Paths sharing the same scope refer to the same element.

#### Example

```javascript
export default {
  users: [
    { name: "Alice", age: 30, profile: { bio: "..." } }
  ],
  items: [
    { title: "Item A" }
  ],

  // Declaration: users.*.isAdult — scope is users.*
  get "users.*.isAdult"() {
    // ✅ OK: shares users.*
    return this["users.*.age"] >= 18;
  },

  get "users.*.displayName"() {
    // ✅ OK: shares users.* (nested static property is fine)
    return this["users.*.profile.bio"];

    // ❌ NG: items.* is a different array scope
    // return this["items.*.title"];

    // ❌ NG: users.*.profile.licenses.* adds a deeper wildcard level than users.*
    // return this["users.*.profile.licenses.*.title"];
  },

  get "users.*.summary"() {
    // ✅ OK: $getAll is not subject to scope constraints
    const allNames = this.$getAll("users.*.name", []);

    // ✅ OK: $resolve is not subject to scope constraints either
    const firstItem = this.$resolve("items.*.title", [0]);

    return `${this["users.*.name"]} (${allNames.length} users)`;
  },
};
```

#### Decision Rules

Compare the wildcard portions of the declaration path and the reference path:

| Declaration Path | Reference Path | Result | Reason |
|---|---|---|---|
| `users.*.isAdult` | `users.*.age` | ✅ | Same scope `users.*` |
| `users.*.isAdult` | `users.*.profile.bio` | ✅ | Same scope `users.*` (deeper static path is OK) |
| `users.*.isAdult` | `items.*.title` | ❌ | Different array scope |
| `users.*.isAdult` | `users.*.tags.*.label` | ❌ | Adds deeper wildcard level than `users.*` |
| `a.*.b.*.x` | `a.*.b.*.y` | ✅ | Same scope `a.*.b.*` |
| `a.*.b.*.x` | `a.*.c` | ✅ | Shares `a.*` (does not reference deeper `b.*`) |
| `a.*.b.*.x` | `a.*.b.*.c.*.d` | ❌ | Adds deeper wildcard level than `a.*.b.*` |
