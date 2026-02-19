# Path Getters — Flat Virtual Properties for Nested Data

## What Is This?

Take a look at the following code.

```javascript
get "users.*.fullName"() {
  return this["users.*.firstName"] + " " + this["users.*.lastName"];
}
```

It may look strange at first. A string as a getter name? With wildcards in it?

But this is **perfectly valid JavaScript**. ECMAScript allows the combination of computed property names and getter syntax, and object keys can be any string. `this["users.*.firstName"]` is also just ordinary bracket notation for property access. There is no syntax violation anywhere.

This getter is called a **path getter** in `@wcstack/state`, and it is the library's core feature. By using dot-path strings as keys, you can define computed properties at any depth in a data tree.

```javascript
export default {
  users: [
    { firstName: "Alice", lastName: "Smith" },
    { firstName: "Bob", lastName: "Jones" }
  ],
  get "users.*.fullName"() {
    return this["users.*.firstName"] + " " + this["users.*.lastName"];
  }
};
```

`users.*.fullName` is not stored in the data. It is a **virtual property** — computed when accessed, cached per element, and automatically invalidated when its dependencies change.

---

## The Problem Path Getters Solve

### The Nesting Wall in Other Frameworks

In React, Vue, and Angular, nested data creates a problem. To define computed properties for each element in an array, **a component per element is required**.

Consider a three-level data hierarchy: regions, prefectures, and cities. If you need population totals and density calculations at each level, in React it looks like this:

```
RegionList
  └── RegionItem          ← computes region population total
        └── PrefectureItem  ← computes prefecture population total
              └── CityItem    ← computes population density
```

Three components are needed just to hold computed properties, connected by props drilling or global state. It is not UI needs but **data depth that dictates component design**. Every time a new level requires computation, a new component must be created.

The same is true in Vue. Since `computed` is scoped to a component, splitting into child components is unavoidable for per-element calculations in arrays.

### The Path Getter Solution

Path getters remove this coupling. You simply line up all computed properties — regardless of depth — in one flat object.

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

  // --- All flat, regardless of depth ---

  // City level
  get "regions.*.prefectures.*.cities.*.density"() {
    return this["regions.*.prefectures.*.cities.*.population"]
         / this["regions.*.prefectures.*.cities.*.area"];
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

Five computed properties, three levels of nesting, zero extra components. `$getAll` collects all values matching a wildcard, and bottom-up aggregation flows naturally.

---

## One Syntax, Many Features

What makes path getters remarkable is that a single syntactic form — `get "path"() {}` — packs in many capabilities.

### 1. Virtual Property Definition

You can define paths that do not exist in the data as if they were properties.

```javascript
get "users.*.fullName"() {
  return this["users.*.firstName"] + " " + this["users.*.lastName"];
}
```

Templates reference them just like real data.

```html
<template data-wcs="for: users">
  <span data-wcs="textContent: .fullName"></span>
</template>
```

Whether `.fullName` is a virtual property defined by a getter or a real property stored in data is indistinguishable from the template side.

### 2. Cross-Getter References and Computation

Path getters can reference other path getters, forming chains.

```javascript
get "cart.items.*.subtotal"() {
  return this["cart.items.*.product.price"] * this["cart.items.*.quantity"];
},
get "cart.totalPrice"() {
  return this.$getAll("cart.items.*.subtotal", []).reduce((sum, v) => sum + v, 0);
},
get "cart.tax"() {
  return this["cart.totalPrice"] * this.taxRate;
},
get "cart.grandTotal"() {
  return this["cart.totalPrice"] + this["cart.tax"];
}
```

Dependency chain: `cart.grandTotal` → `cart.tax` → `cart.totalPrice` → `cart.items.*.subtotal`. When any `quantity` changes, the entire chain is automatically recomputed.

### 3. Automatic Dependency Tracking

The moment a getter accesses `this["users.*.firstName"]`, the system registers a dependency from `users.*.firstName` → `users.*.fullName`. There is no need to write dependency arrays manually.

```
users.*.fullName
  ├── depends on: users.*.firstName
  └── depends on: users.*.lastName

Change users[0].firstName → invalidates users[0].fullName only
                           → users[1].fullName cache remains intact
```

The contrast with React's `useMemo` is clear.

```javascript
// React: manually enumerate dependency array
const fullName = useMemo(
  () => firstName + " " + lastName,
  [firstName, lastName]  // ← developer's responsibility
);

// Path getter: access automatically registers dependencies
get "users.*.fullName"() {
  return this["users.*.firstName"] + " " + this["users.*.lastName"];
  // ← no dependency array needed. What you read becomes a dependency
}
```

### 4. Per-Element Cache

Each concrete address (path + loop index) has an independent cache.

```
users.*.fullName [0] → "Alice Smith"  (cached independently)
users.*.fullName [1] → "Bob Jones"    (cached independently)
```

In an array of 1,000 items, updating just one recalculates only that one getter.

### 5. Depth-Independent Definition

City-level calculations and top-level aggregations sit side by side in the same object.

```javascript
// 3 levels deep
get "regions.*.prefectures.*.cities.*.density"() { ... },
// Top level
get totalPopulation() { ... }
```

Where you define a getter is not bound by data depth.

### 6. Wildcard Resolution via Loop Context

The `*` in a path resolves to the loop index at runtime.

```
Template:
  <template data-wcs="for: users">     ← pushes index onto stack
    {{ .fullName }}                      ← reads users.*.fullName

At index 0:  this["users.*.firstName"]  →  users[0].firstName  →  "Alice"
At index 1:  this["users.*.firstName"]  →  users[1].firstName  →  "Bob"
```

In nested loops, wildcards correspond to indexes from left to right.

```javascript
get "categories.*.items.*.label"() {
  // First * → category index, second * → item index
  return this["categories.*.name"] + " / " + this["categories.*.items.*.name"];
}
```

```html
<template data-wcs="for: categories">
  <template data-wcs="for: .items">
    <span>{{ .label }}</span>
  </template>
</template>
```

---

All of these derive from a single syntactic form: `get "path"() {}`. Because the path is a string, it can contain wildcards. Because it is a getter, dependencies are recorded on access. Because the path is a flat string, it is not bound by hierarchy. One design decision cascades into all of these capabilities.

---

## Practical Patterns

### Lookup Table

Join data with a Map and transparently access sub-properties of the returned object.

```javascript
export default {
  products: [
    { id: "P001", name: "Widget", price: 500 },
    { id: "P002", name: "Gadget", price: 1200 }
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

  // Join: cart item → product
  get "cart.items.*.product"() {
    return this.productByProductId.get(this["cart.items.*.productId"]);
  },

  // Access sub-properties of the object returned by the getter
  get "cart.items.*.subtotal"() {
    return this["cart.items.*.product.price"] * this["cart.items.*.quantity"];
  }
};
```

`this["cart.items.*.product.price"]` naturally chains through the `.price` of the object returned by the `cart.items.*.product` getter.

### Two-Way Binding with Path Setters

Define custom write logic with `set "path"()`.

```javascript
export default {
  users: [
    { firstName: "Alice", lastName: "Smith" }
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

Editing the input calls the setter, which splits and writes back to `firstName` and `lastName`.

### Conditional Formatting

Classify state with a getter and bind classes in the template.

```javascript
export default {
  items: [
    { name: "Server A", cpu: 85 },
    { name: "Server B", cpu: 45 },
    { name: "Server C", cpu: 95 }
  ],
  get "items.*.status"() {
    const cpu = this["items.*.cpu"];
    if (cpu >= 90) return "critical";
    if (cpu >= 70) return "warning";
    return "normal";
  }
};
```

```html
<template data-wcs="for: items">
  <div data-wcs="class.critical: .status|eq(critical); class.warning: .status|eq(warning)">
    {{ .name }}: {{ .cpu }}%
  </div>
</template>
```

---

## State Update Rules

The prerequisite for path getters to work is that state changes pass through the Proxy `set` trap.

### Path Assignment Is Required

```javascript
// ✅ Path assignment — change detected
this.count = 10;
this["user.name"] = "Bob";

// ❌ Direct nested access — bypasses the Proxy
this.user.name = "Bob";
```

### Use Non-Destructive Methods for Arrays

```javascript
// ✅ Returns a new array + assignment
this.items = this.items.concat(newItem);
this.items = this.items.toSpliced(index, 1);
this.items = this.items.filter(item => !item.done);
this.items = this.items.toSorted((a, b) => a.id - b.id);

// ❌ Mutating methods — no assignment occurs
this.items.push(newItem);
this.items.splice(index, 1);
```

This design pairs well with ES2023's non-destructive array methods (`toSpliced`, `toSorted`, `toReversed`, `with`).

---

## Summary

| Concept | Description |
|---|---|
| Path getter | `get "a.*.b"()` — virtual property at any depth |
| Wildcard `*` | Resolved to loop index at runtime |
| Flat definition | All in one place, regardless of depth |
| Auto dependency tracking | Access registers dependencies. No manual dependency arrays |
| Per-element cache | Only the affected element is invalidated |
| Getter chaining | Cross-getter references cascade computation |
| `$getAll` | Collects all values matching a wildcard for aggregation |
| Path setter | `set "a.*.b"(v)` — custom write logic |

The idea behind path getters is simple — define computed properties **where the data lives, not where the components are**. This single decision removes the obligation to split components and fundamentally changes how nested data is handled.
