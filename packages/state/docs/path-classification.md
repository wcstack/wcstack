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
│   └── Multi-level Shorthand   — .name inside for: .products → categories.*.products.*.name
│
├── Resolved Path — `*` replaced with a concrete index
│   ├── Fully Resolved Path       — All `*` resolved: users.0.name
│   └── Mixed Path                — Indexes and `*` together: categories.0.products.*.name
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

In markup, each `*` is the row of the `for` around it at that level: a path with more `*` than the enclosing `for` nesting, or a `*` that names another list (`{{ items.*.title }}` inside `for: users`), fails with `[wcs/wildcard-rank]`.

## 3. Shorthand Path

A path starting with `.` inside a `for` template.
Automatically prefixed with the parent `for` path and expanded to a pattern path. `.` alone is the current element.

### Single-level Shorthand

Shorthand within a single `for` context.

```
Inside for: users context:
  .name       → users.*.name
  .age        → users.*.age
  .           → users.*
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
It names **whatever row is at that index now**, and works in bindings as well as in scripts: it follows writes, reordering, removals and list replacement. An index past the end of a list reads as `undefined`, and a write there throws `no row for "users.*.name"` (`#3`). See the README's [How It Works](../README.md#how-it-works) (Direct index access) for the details.

### Fully Resolved Path

All `*` replaced with concrete indices.

```
users.0.name           → "Alice"
users.1.age            → 25
cart.items.2.price     → 300
```

**Usage (bindings):**
```html
<p data-wcs="textContent: users.0.name"></p>
<p>{{ users.1.name }}</p>
<template data-wcs="if: users.0.active">...</template>
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

A numeric segment after the first is always read as an index, so numeric keys under a plain object (`sales.2024.total`) are a known limitation — see the same README section.

### Mixed Path

A path where some `*` are replaced with indices and the others are kept.

```
categories.0.products.*.name
```

The `*` in it is expanded or looped over, as in a pattern path, while the index fixes its level:

```html
<template data-wcs="for: categories.0.products">
  <span data-wcs="textContent: .name"></span>
  <!-- .name → categories.0.products.*.name -->
</template>
```

```javascript
this.$getAll("categories.0.products.*.name", [])   // the names of the first category's products
```

Inside such a loop the indexed level is not a loop context: `categories.*.name` there fails with `[wcs/wildcard-rank]` (`#1403`) — write `categories.0.name`.

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
- Evaluated lazily and cached; recomputed when read after a dependent path changed
- Read-only (unless a setter is defined)

## Path Classification Quick Reference

| Classification | Example | `*` | Index | Usage |
|---|---|---|---|---|
| Simple Path | `count` | None | None | Direct binding |
| Nested Path | `cart.totalPrice` | None | None | Object hierarchy access |
| Single-level Pattern | `users.*.name` | One | None | Binding inside for template |
| Multi-level Pattern | `a.*.b.*.c` | Two+ | None | Nested for templates |
| Single-level Shorthand | `.name` | None as written (one after expansion) | None | Shorthand inside for template |
| Multi-level Shorthand | `.name` in `for: .products` | None as written (two+ after expansion) | None | Shorthand in nested for template |
| Fully Resolved Path | `users.0.name` | None | Yes | Bindings and scripts: the row at that index now |
| Mixed Path | `a.0.b.*.c` | Some | Some | `for:` over one row's list, `$getAll` |
| Computed Path | `get "x.*.y"()` | Any | None | Automatic derived data |

## Availability Matrix by Situation

### Legend

- ✅ Available
- ❌ Not available
- ⚠ Conditional (see notes)

### UI (HTML Bindings)

| Situation | Simple | Nested | Pattern | Shorthand | Resolved | Computed |
|---|---|---|---|---|---|---|
| `data-wcs` outside `for` | ✅ | ✅ | ❌ ^1 | ❌ ^2 | ✅ ^3 | ✅ |
| `data-wcs` inside `for` | ✅ | ✅ | ✅ | ✅ | ✅ ^3 | ✅ |
| `{{ }}` / `<!--@@:-->` outside `for` | ✅ | ✅ | ❌ ^1 | ❌ ^2 | ✅ ^3 | ✅ |
| `{{ }}` / `<!--@@:-->` inside `for` | ✅ | ✅ | ✅ | ✅ | ✅ ^3 | ✅ |
| `for:` value (iteration target) | ✅ | ✅ | ✅ ^4 | ⚠ ^5 | ✅ ^3 | ✅ ^4 |
| `if:` / `elseif:` value | ✅ | ✅ | ⚠ ^6 | ⚠ ^6 | ✅ ^3 | ✅ |
| Event handler `onclick:` value | — | — | — | — | — | — |

^1 No loop context to resolve `*` — fails with `[wcs/wildcard-rank]` (`#1401`)
^2 No parent `for` to expand against — fails with `[wcs/wildcard-rank]` (`#1402`)
^3 The row at that index now (`users.0.name`); a mixed path works as a `for:` value (`for: categories.0.products`)
^4 A pattern path is possible inside a nested `for` (e.g., `for: users.*.items` — `*` resolved by the parent `for: users` context). A computed getter returning an array is a legal iteration target too, in static form (`get weeks()` → `for: weeks`) or pattern form (`get "weeks.*.days"()` → `for: weeks.*.days`, which carries the same nested-`for` requirement) — see `packages/state/examples/calendar`. A `for:` takes no filters
^5 Only possible inside nested `for` (e.g., `for: .products`)
^6 Only possible inside `for` template

### State (JavaScript — inside defineState)

| Situation | Simple | Nested | Pattern | Shorthand | Resolved | Computed |
|---|---|---|---|---|---|---|
| **Property declaration** (key name) | ✅ | ❌ ^7 | ❌ ^7 | ❌ | ❌ | ❌ |
| **getter/setter declaration** (key name) | ✅ ^8 | ✅ | ✅ | ❌ | ❌ | — |
| **Inside getter (read)** | ✅ | ✅ | ⚠ ^9 | ❌ | ✅ ^10 | ✅ |
| **Inside method (outside for context)** | ✅ | ✅ | ❌ ^11 | ❌ | ✅ | ✅ ^12 |
| **Inside method (inside for context)** | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ ^12 |
| **`$getAll(path, indexes?)`** | ⚠ ^13 | ⚠ ^13 | ✅ | ❌ | ✅ ^14 | ✅ |
| **`$resolve(path, indexes)`** | ⚠ ^15 | ⚠ ^15 | ✅ | ❌ | ⚠ ^15 | ✅ |
| **`$postUpdate(path)`** | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| **`$dependOn(path)`** | ✅ | ✅ | ✅ | ❌ | ✅ | ⚠ ^16 |

^7 Data properties are object literal keys, not paths (`count: 0` is valid but `"cart.totalPrice": 0` represents a different data structure)
^8 A getter declared with a simple path is an ordinary top-level getter (`get "totalPrice"()` is the same as `get totalPrice()`)
^9 Only pattern paths sharing the getter's own wildcard levels resolve (see "Wildcard Scope in Getters" below); any other `*` reads `undefined`. Does not apply to `$getAll`/`$resolve` arguments
^10 `this["users.0.name"]` is tracked: the getter is recomputed when the value at that index changes — a write, a reorder, a list replacement
^11 No loop context to resolve `*`: a read gives `undefined`, a write throws `no row for "users.*.name"` (`#3`). Use `$getAll`, `$setAll` or `$resolve` instead
^12 Read-only for computed paths (writing one that has no setter throws)
^13 `$getAll` on a path without wildcards returns a one-element array (`[value]`) — it works, but it is not what the API is for
^14 A fully resolved path gives a one-element array; a mixed path expands its `*` (`$getAll("categories.0.products.*.name", [])`)
^15 `$resolve` needs exactly one index per `*` (`[wcs/index-arity]`); for a path with none, `indexes` is `[]` and the call is a plain read or write — unnecessary
^16 `$dependOn` does not evaluate the getter, so it follows the getter's inputs only while something else (a binding, a `$watch`) keeps the getter evaluated. Read the getter (`this.total`) to depend on it

### Event Handler Notes

The value of event handlers like `onclick:` specifies a **method name**, not a value path, so path classification does not apply. A dotted name reaches a method of the volume mounted at that path (`onclick: cart.checkout`).

```html
<button data-wcs="onclick: increment">+</button>
<button data-wcs="onclick#prevent: handleSubmit">Submit</button>
```

Inside `for` templates, the handler receives the event followed by the loop indexes; `this.$1`, `this.$2`, … give the same indexes.

```html
<template data-wcs="for: users">
  <button data-wcs="onclick: deleteUser">Delete</button>
  <!-- deleteUser(event, index) — index is the row's index ($1) -->
</template>
```

### Wildcard Scope in Getters

When a getter is declared with a pattern path, `this["..."]` access inside the getter body
may only use paths that **share the same wildcard scope (same `*` positions in the same array)**.
Each `*` resolves to the row the getter is evaluated for at that level; a `*` with no row there reads `undefined` — no error is raised, so the mistake shows up as an empty value.

This constraint applies to direct `this["..."]` access.
It does not apply to `$getAll` or `$resolve` arguments (these resolve wildcards independently). Pass their indexes explicitly when the path is outside the getter's scope (`[]` for every match): with the indexes omitted, `$getAll` takes them from the loop context and throws when the path shares no wildcard level with it.

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

    // ❌ NG: items.* is a different array scope (reads undefined)
    // return this["items.*.title"];

    // ❌ NG: users.*.profile.licenses.* adds a deeper wildcard level than users.* (reads undefined)
    // return this["users.*.profile.licenses.*.title"];
  },

  get "users.*.summary"() {
    // ✅ OK: $getAll is not subject to scope constraints ([] = every user)
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
