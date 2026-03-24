# `defineState()` — Typed State Definitions

## Overview

`defineState()` is a utility function that adds TypeScript type support to `@wcstack/state` state objects. It is an **identity function** at runtime (returns its argument as-is) with zero overhead — all the work happens at the type level via `ThisType<>`.

By wrapping your state object with `defineState()`, you get:

- **Typed `this`** inside methods and getters — direct property access is type-checked
- **Dot-path autocompletion** — `this["users.*.name"]` resolves to `string` in the IDE
- **State Proxy API types** — `$getAll`, `$postUpdate`, `$1`–`$9`, etc. are typed on `this`

## Basic Usage

### TypeScript

```typescript
import { defineState } from '@wcstack/state';

export default defineState({
  count: 0,
  users: [] as { name: string; age: number }[],

  increment() {
    this.count++;            // ✅ number
    this["users.*.name"];    // ✅ string
  },

  get "users.*.ageCategory"() {
    return this["users.*.age"] < 25 ? "Young" : "Adult";
  }
});
```

### JavaScript (with JSDoc / `checkJs`)

```javascript
import { defineState } from '@wcstack/state';

export default defineState({
  count: 0,
  increment() {
    this.count++;  // ✅ type-checked with checkJs enabled
  }
});
```

### HTML Inline Script

```html
<wcs-state>
  <script type="module">
    import { defineState } from '@wcstack/state';
    export default defineState({
      count: 0,
      increment() { this.count++; }
    });
  </script>
</wcs-state>
```

## How It Works

`defineState<T>()` infers the type `T` from the object literal you pass in. It then applies `ThisType<WcsThis<T>>` so that `this` inside every method and getter is typed as:

```
WcsThis<T> = T & WcsStateApi & WcsPathAccessor<T> & Record<string, any>
```

| Layer | What it provides |
|---|---|
| `T` | Direct properties — `this.count`, `this.users`, `this["users.*.ageCategory"]` |
| `WcsStateApi` | Proxy APIs — `this.$getAll()`, `this.$postUpdate()`, `this.$1`–`$9` |
| `WcsPathAccessor<T>` | Dot-path resolution — `this["users.*.name"]`, `this["cart.items.*.price"]` |
| `Record<string, any>` | Fallback for dynamic paths — `this[\`items.${i}.name\`]` |

## Dot-Path Type Resolution

### `WcsPaths<T>` — Path Generation

`WcsPaths<T>` generates a union of all valid dot-notation paths from a type. Arrays use `*` as a wildcard.

```typescript
import type { WcsPaths } from '@wcstack/state';

type AppState = {
  count: number;
  users: { name: string; age: number }[];
  cart: { items: { price: number }[] };
};

type Paths = WcsPaths<AppState>;
// = "count"
// | "users" | "users.*" | "users.*.name" | "users.*.age"
// | "cart" | "cart.items" | "cart.items.*" | "cart.items.*.price"
```

**Rules:**

| Property type | Generated paths |
|---|---|
| Primitive (`string`, `number`, etc.) | `key` only |
| Plain object | `key`, plus recursive sub-paths (`key.subKey`) |
| Array of plain objects | `key`, `key.*`, plus recursive sub-paths (`key.*.subKey`) |
| Array of primitives | `key`, `key.*` |
| Built-in object (`Date`, `Map`, `Set`, `RegExp`, etc.) | `key` only (no recursion) |
| Function (methods) | Excluded entirely |

**Recursion depth limit:** 4 levels (to preserve compilation performance).

### `WcsPathValue<T, P>` — Path Value Resolution

`WcsPathValue<T, P>` resolves the value type at a given dot-path.

```typescript
import type { WcsPathValue } from '@wcstack/state';

type AppState = {
  cart: { items: { price: number; qty: number }[] };
};

type A = WcsPathValue<AppState, "cart.items.*.price">; // number
type B = WcsPathValue<AppState, "cart.items.*">;        // { price: number; qty: number }
type C = WcsPathValue<AppState, "cart">;                 // { items: { price: number; qty: number }[] }
```

**Resolution order:**

1. Direct key of `T` (includes computed getters like `"users.*.ageCategory"`)
2. `K.*` — array element type
3. `K.rest` — recursive object/array traversal

### Multi-Level Wildcards

Nested arrays with multiple wildcards are fully supported:

```typescript
type State = {
  categories: {
    label: string;
    products: { name: string; price: number }[];
  }[];
};

type Paths = WcsPaths<State>;
// Includes:
// "categories.*.products.*.name"
// "categories.*.products.*.price"
// "categories.*.label"
// etc.

type V = WcsPathValue<State, "categories.*.products.*.name">; // string
```

## State Proxy API (`WcsStateApi`)

The following properties and methods are available on `this` inside `defineState()`:

### Methods

| API | Signature | Description |
|---|---|---|
| `$getAll` | `$getAll<V>(path: string, defaultValue?: V[]): V[]` | Get all values matching a wildcard path |
| `$postUpdate` | `$postUpdate(path: string): void` | Manually trigger update for a path |
| `$resolve` | `$resolve(path: string, indexes: number[], value?: any): any` | Resolve a wildcard path with specific indexes |
| `$trackDependency` | `$trackDependency(path: string): void` | Manually register a dependency |

### Properties

| API | Type | Description |
|---|---|---|
| `$stateElement` | `HTMLElement` | Reference to the `<wcs-state>` element |
| `$1` – `$9` | `number` | Loop index variables (0-based value, 1-based naming) |

### Lifecycle Callbacks

Define these as methods in the state object:

```typescript
defineState({
  data: null as string | null,

  async $connectedCallback() {
    this.data = await fetch('/api/data').then(r => r.json());
  },

  $disconnectedCallback() {
    this.data = null;
  },

  $updatedCallback() {
    console.log('DOM updated');
  }
});
```

## Examples

### Counter

```typescript
import { defineState } from '@wcstack/state';

export default defineState({
  count: 0,
  increment() { this.count++; },
  decrement() { this.count--; },
});
```

### User List with Computed Properties

```typescript
import { defineState } from '@wcstack/state';

export default defineState({
  users: [
    { name: "Alice", age: 30 },
    { name: "Bob", age: 25 },
  ] as { name: string; age: number }[],

  get "users.*.ageCategory"() {
    const age = this["users.*.age"]; // number (via WcsPathAccessor)
    if (age < 25) return "Young";
    if (age < 35) return "Adult";
    return "Senior";
  },
});
```

### Shopping Cart with Getter Chaining

```typescript
import { defineState } from '@wcstack/state';

type CartItem = { productId: number; quantity: number; unitPrice: number };

export default defineState({
  taxRate: 0.1,
  cart: {
    items: [] as CartItem[],
  },

  get "cart.items.*.subtotal"() {
    return this["cart.items.*.unitPrice"] * this["cart.items.*.quantity"];
  },

  get "cart.totalPrice"() {
    const prices = this.$getAll("cart.items.*.subtotal", []) as number[];
    return prices.reduce((sum, v) => sum + v, 0);
  },

  get "cart.tax"() {
    return this["cart.totalPrice"] * this.taxRate;
  },

  get "cart.grandTotal"() {
    return this["cart.totalPrice"] + this["cart.tax"];
  },

  onDeleteItem(_event: Event) {
    const index = this.$1; // number — loop index
    this["cart.items"] = this["cart.items"].toSpliced(index, 1);
  },
});
```

### Event Handler with Loop Index

```typescript
import { defineState } from '@wcstack/state';

export default defineState({
  items: [] as { name: string }[],

  onDelete(_event: Event) {
    const index = this.$1; // loop index (0-based)
    this.items = this.items.toSpliced(index, 1);
  },
});
```

### Async Data Loading

```typescript
import { defineState } from '@wcstack/state';

export default defineState({
  loading: false,
  error: null as string | null,
  users: [] as { id: number; name: string }[],

  async $connectedCallback() {
    this.loading = true;
    try {
      const res = await fetch('/api/users');
      this.users = await res.json();
    } catch (e) {
      this.error = String(e);
    } finally {
      this.loading = false;
    }
  },
});
```

## Known Limitations

### Generic type arguments inside `ThisType<>`

Due to a TypeScript limitation, generic type arguments on `this` methods do not work inside `defineState()`:

```typescript
defineState({
  items: [] as { price: number }[],
  get total() {
    // ❌ this.$getAll<number>(...) — type argument not allowed
    // ✅ Use type assertion instead:
    const prices = this.$getAll("items.*.price", []) as number[];
    return prices.reduce((s, v) => s + v, 0);
  }
});
```

### `Record<string, any>` fallback

`WcsThis<T>` includes `Record<string, any>` to support dynamic path access like `this[\`items.${i}.name\`]`. As a side effect, all bracket-access expressions resolve to `any` at the type level. The IDE still shows typed paths as autocompletion suggestions, but the inferred type at the access site is `any`.

### Recursion depth limit

`WcsPaths<T>` limits recursion to 4 levels to avoid excessive compilation time. For extremely deep structures, paths beyond the 4th nesting level are not generated.

## Exported Types

| Type | Description |
|---|---|
| `defineState<T>(definition): T` | Identity function with `ThisType<WcsThis<T>>` |
| `WcsThis<T>` | The `this` type inside state methods/getters |
| `WcsStateApi` | Proxy API interface (`$getAll`, `$postUpdate`, `$1`–`$9`, etc.) |
| `WcsPaths<T>` | Union of all valid dot-paths for type `T` |
| `WcsPathValue<T, P>` | Resolved value type at path `P` in type `T` |
