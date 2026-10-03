# `defineState()` — Typed State Definitions

## Overview

`defineState()` is a utility function that adds TypeScript type support to `@wcstack/state` state objects. It is an **identity function** at runtime (returns its argument as-is) with zero overhead — all the work happens at the type level via `ThisType<>`.

By wrapping your state object with `defineState()`, you get:

- **Typed `this`** inside methods and getters — direct property access is type-checked
- **Dot-path autocompletion** — `this["users.*.name"]` resolves to `string` in the IDE
- **State Proxy API types** — `$getAll`, `$postUpdate`, `$1`–`$9`, etc. are typed on `this`

Import it from **`@wcstack/state/define`**: that entry carries `defineState` and the types only, with no runtime. Importing `defineState` from `@wcstack/state` works too, but brings in the whole engine with it.

## Basic Usage

### TypeScript

```typescript
import { defineState } from '@wcstack/state/define';

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
import { defineState } from '@wcstack/state/define';

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
    import { defineState } from '@wcstack/state/define';
    export default defineState({
      count: 0,
      increment() { this.count++; }
    });
  </script>
</wcs-state>
```

In the browser, a bare specifier needs an import map entry — for example `"@wcstack/state/define": "https://cdn.jsdelivr.net/npm/@wcstack/state@4/dist/define.js"` (jsDelivr's `/npm/` path does not read `exports`, so name the file).

## How It Works

`defineState<T>()` infers the type `T` from the object literal you pass in. It then applies `ThisType<WcsThis<T>>` so that `this` inside every method and getter is typed as:

```
WcsThis<T> = T & WcsStateApi & WcsPathAccessor<T>
```

| Layer | What it provides |
|---|---|
| `T` | Direct properties — `this.count`, `this.users`, `this["users.*.ageCategory"]` |
| `WcsStateApi` | Proxy APIs — `this.$getAll()`, `this.$postUpdate()`, `this.$1`–`$9`, `this["$streamStatus.<name>"]` |
| `WcsPathAccessor<T>` | Dot-path resolution — `this["users.*.name"]`, `this["cart.items.*.price"]` |

There is no catch-all index signature: a bracket access is typed only when its key is one of the paths above, so a path that does not exist (`this["users.*.nmae"]`) is a type error, and so is a dynamic path ([Dynamic paths are not typed](#dynamic-paths-are-not-typed)). One exception: inside a getter whose return type is inferred, the reads its return value depends on are typed `any` ([Getters with an inferred return type](#getters-with-an-inferred-return-type)).

## Dot-Path Type Resolution

### `WcsPaths<T>` — Path Generation

`WcsPaths<T>` generates a union of all valid dot-notation paths from a type. Arrays use `*` as a wildcard.

```typescript
import type { WcsPaths } from '@wcstack/state/define';

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
| `$`-prefixed key (`$stream`, `$watch`, `$connectedCallback`, …) | Excluded entirely |

**Recursion depth limit:** 4 levels (to preserve compilation performance).

### `WcsPathValue<T, P>` — Path Value Resolution

`WcsPathValue<T, P>` resolves the value type at a given dot-path.

```typescript
import type { WcsPathValue } from '@wcstack/state/define';

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

### Recursive Paths (`**`)

A state that declares `$recursion` may read recursive paths through `this`. `**` stands for a
whole family of depths, which no finite path union can enumerate, so these paths are typed
`any` through a pattern index signature:

```typescript
export default defineState({
  nodes: [] as { value: number; children: any[] }[],
  $recursion: { "nodes.*": "children.*" },
  get "nodes.**.total"(): number {
    return (this["nodes.**.value"] as number)
      + (this.$getAll("nodes.**.children.*.total") as number[]).reduce((a, b) => a + b, 0);
  },
});
```

Only keys that actually contain `**` take the `any` type (the bare `this["nodes.**"]`, which
binds to the node itself inside a recursive getter, included) — ordinary dot paths keep their
resolved value type, and a typo in one is still an error. The VS Code extension's preamble
declares the same signature, so the editor and `tsc` agree. See the README's
[Recursive Paths](../README.md#recursive-paths-recursion) section and
[state-recursive-path-design.md](../../../docs/state-recursive-path-design.md).

## State Proxy API (`WcsStateApi`)

The following properties and methods are available on `this` inside `defineState()`:

### Methods

| API | Signature | Description |
|---|---|---|
| `$getAll` | `$getAll<V = any>(path: string, indexes?: number[]): V[]` | Get all values matching a wildcard path. `indexes` is a prefix over the wildcards (`[]` = every match); omitted, it is taken from the loop context |
| `$setAll` | `$setAll<V = any>(path: string, indexes: number[], value: V \| ((current: V, ...indexes: number[]) => V \| undefined)): number` | Write to every address matching a wildcard path (broadcast or mapper). A second overload takes an array and `{ spread: true }` to hand one entry to each address. Returns the number of addresses written |
| `$postUpdate` | `$postUpdate(path: string): void` | Manually trigger update for a path |
| `$resolve` | `$resolve(path: string, indexes: number[], value?: any): any` | Read (two arguments) or write (three) a wildcard path at specific indexes |
| `$dependOn` | `$dependOn(path: string): void` | Manually register a dependency |
| `$untracked` | `$untracked<T>(fn: () => T): T` | Run fn with dependency tracking (dynamic deps and `$1` index deps) suppressed |
| `$eq` | `$eq(path: string, key: unknown): boolean` | Keyed selection: is the value of `path` equal to `key`? |
| `$eqPath` | `$eqPath(path: string, keyPath: string): boolean` | `$eq` with the key read from `keyPath` (wildcards resolve to the current row) |
| `$eqIndex` | `$eqIndex(path: string, level?: number): boolean` | `$eq` with the current row's index as the key |

The README's [Proxy APIs](../README.md#proxy-apis) and [Keyed selection](../README.md#keyed-selection-eq--eqpath--eqindex) sections describe their behavior. The 3.x names `$trackDependency` / `$untrackDependency` are not in the types; at runtime they throw `[wcs/name-alias]`.

### Properties

| API | Type | Description |
|---|---|---|
| `$stateElement` | `HTMLElement` | Reference to the `<wcs-state>` element |
| `$command` | `Record<string, { emit(...args: any[]): any }>` | The command tokens declared in `$commandTokens` |
| `$streamStatus` / `$streamError` | `Record<string, …>` | The `$stream` companion namespaces (reads through this object register no dependency) |
| `this["$streamStatus.<name>"]` / `this["$streamError.<name>"]` | `"idle" \| "active" \| "done" \| "error"` / `unknown` | The tracked form to use inside getters |
| `$1` – `$9` | `number` | Loop index variables (0-based value, 1-based naming). The runtime resolves up to `$128`; the types stop at `$9` |

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

  $renderedCallback() {
    console.log('DOM updated');
  }
});
```

The 3.x name `$updatedCallback` throws when the state loads; write `$renderedCallback`.

## `$stream` Declaration

Alongside `$commandTokens` / `$eventTokens` / `$on`, the state object recognizes the `$stream` declaration map. Each entry folds an async producer (async iterable / async generator / `ReadableStream`) into a single reactive property:

```typescript
import { defineState } from '@wcstack/state/define';

// Any (args, AbortSignal) => AsyncIterable | ReadableStream producer works.
declare function llmStream(prompt: string, signal: AbortSignal): AsyncIterable<string>;

export default defineState({
  prompt: "",
  answer: "",  // owned by the stream at runtime; pre-declaring it types `this.answer`

  $stream: {
    answer: {
      // `$stream` callbacks get no contextual type yet (typing the declaration
      // map is a planned follow-up), so annotate the parameters explicitly.
      args:    (state: { prompt: string }) => state.prompt,  // paths read here drive restart
      source:  (prompt: string, signal: AbortSignal) => llmStream(prompt, signal),
      fold:    (acc: string, token: string) => acc + token,
      initial: "",
    },
  },
});
```

The stream starts after `$connectedCallback`, folds each chunk into `this.answer`, and restarts (abort → reset to `initial` → new run) whenever a path read in `args` changes. Runtime state is exposed through the read-only companion paths `$streamStatus.answer` / `$streamError.answer`.

See [Streams](./streams.md) for the full contract — cooperative cancellation, the bounded-fold rule, validation, and lifecycle.

## Examples

### Counter

```typescript
import { defineState } from '@wcstack/state/define';

export default defineState({
  count: 0,
  increment() { this.count++; },
  decrement() { this.count--; },
});
```

### User List with Computed Properties

```typescript
import { defineState } from '@wcstack/state/define';

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
import { defineState } from '@wcstack/state/define';

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
import { defineState } from '@wcstack/state/define';

export default defineState({
  items: [] as { name: string }[],

  onDelete(_event: Event) {
    const index = this.$1; // loop index (0-based)
    this.items = this.items.toSpliced(index, 1);
  },
});
```

A handler also receives the loop indexes after the event (`onDelete(event, index)`); type them as `number`.

### Async Data Loading

```typescript
import { defineState } from '@wcstack/state/define';

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

### Getters with an inferred return type

A getter's type is part of `T`, and `T` is what types `this` — so when a getter has no return type annotation, TypeScript breaks the circle by typing the `this` reads its return value depends on as `any`. Inside such a getter a misspelled path in that chain is not reported, and a type argument on a `this` method there is an error:

```typescript
defineState({
  items: [] as { price: number }[],
  get total() {
    // ❌ this.$getAll<number>(...) — TS2347 "Untyped function calls may not accept type arguments"
    // ✅ assert the result instead:
    const prices = this.$getAll("items.*.price", []) as number[];
    return prices.reduce((s, v) => s + v, 0);
  },
  get checked(): number {
    // ✅ with the return type annotated, `this` is fully typed (typos are errors)
    return this.$getAll<number>("items.*.price", []).length;
  },
});
```

Methods are not affected, and neither is a read whose result the return value does not depend on. Annotate a getter's return type when you want its body checked.

### Dynamic paths are not typed

`WcsThis<T>` has no catch-all index signature, so a path built at run time is not one of the typed keys. Under `strict`, `` this[`items.${i}.name`] `` is an error (TS7053, "Element implicitly has an 'any' type"). Read and write such addresses through `$resolve`, which takes the indexes separately (and returns `any`), or cast:

```typescript
defineState({
  items: [] as { name: string }[],
  rename(i: number, name: string) {
    // ❌ this[`items.${i}.name`] = name;             — TS7053
    this.$resolve("items.*.name", [i], name);         // ✅
    // (this as Record<string, any>)[`items.${i}.name`] = name;   // ✅ also works
  },
});
```

### Recursion depth limit

`WcsPaths<T>` limits recursion to 4 levels to avoid excessive compilation time. For extremely deep structures, paths beyond the 4th nesting level are not generated.

## Reaching the HTML: `wcs-schema` → `wcs-validate`

`defineState` types the state file. It says nothing about the HTML that binds to it — and the static validator (`wcs-validate`, the VS Code extension) reads the state with a regex analyzer, not the type checker, so `users: [] as { name: string }[]` leaves `users.*.name` unresolvable there. To carry the types across, generate the sidecar `stateSchema` from the same file with [`@wcstack/typescript`](../../typescript/README.md):

```bash
npx wcs-schema emit src/state.ts        # writes wcstack.manifest.json from the TS type
npx wcs-validate --strict index.html    # paths the type lacks are now errors, false warnings are gone
```

`wcs-schema check src/state.ts` fails CI when the manifest drifts from the type. The whole TypeScript story for a wcstack app is collected in [docs/typescript.md](../../../docs/typescript.md).

## Exported Types

`@wcstack/state/define` exports the function and the types below; `@wcstack/state` and `@wcstack/state/core` export the same names.

| Type | Description |
|---|---|
| `defineState<T>(definition): T` | Identity function with `ThisType<WcsThis<T>>` |
| `WcsThis<T>` | The `this` type inside state methods/getters |
| `WcsStateApi` | Proxy API interface (`$getAll`, `$postUpdate`, `$1`–`$9`, etc.) |
| `WcsPaths<T>` | Union of all valid dot-paths for type `T` |
| `WcsPathValue<T, P>` | Resolved value type at path `P` in type `T` |
