# WcStack IntelliSense

A VSCode extension for [@wcstack/state](https://github.com/wcstack/wcstack). Provides TypeScript language features for `<wcs-state>` inline scripts and `data-wcs` attributes in HTML.

## Features

### Inline Script Type Support

TypeScript completions work inside `<script type="module">` within `<wcs-state>`. No `import` or `defineState()` required.

```html
<wcs-state>
  <script type="module">
export default {
  count: 0,
  users: [{ name: "Alice", age: 30 }],

  increment() {
    this.count++;              // number
    this["users.*.name"];      // string
    this["users.*.age"];       // number
    this.$getAll("path", []);  // WcsStateApi
  },

  get "users.*.ageCategory"() {
    return this["users.*.age"] < 25 ? "Young" : "Adult";
  }
};
  </script>
</wcs-state>
```

### Attribute Binding Completions

Completions for property names, state paths, and filter names in `data-wcs` attribute values.

- `data-wcs="` → `textContent`, `class.`, `style.`, `onclick`, `for`, `if` ...
- `data-wcs="textContent: ` → `count`, `users`, `users.*.name` ...
- `data-wcs="textContent: count|` → `gt`, `eq`, `uc`, `trim` ...
- `data-wcs="onclick#` → `prevent`, `stop`
- `data-wcs="for: ` → only array-typed paths
- `data-wcs="onclick: ` → only methods

#### for-context Completions

Inside `<template data-wcs="for: items">`, shorthand paths (`.name`, `.age`) are auto-generated as completion candidates.

```html
<wcs-state>
  <script type="module">
export default {
  items: [{ name: "Alice", age: 30 }]
};
  </script>
</wcs-state>

<template data-wcs="for: items">
  <!-- .name, .age appear as candidates for data-wcs="textContent: " -->
  <span data-wcs="textContent: .name"></span>
</template>
```

Pattern paths (`items.*.name`) and shorthand paths (`.name`) are excluded from completions outside `<template for>`.

#### State Name Completions

State name completions activate after `@`. Available in all syntax types: `data-wcs`, `{{ }}`, and `<!--@@:-->`.

```html
<span data-wcs="textContent: count@"></span>  <!-- state name candidates after @ -->
<span>{{ count@ }}</span>                      <!-- same -->
```

### Template Syntax Support

Completions and diagnostics also work in Mustache `{{ }}` and comment binding `<!--@@:-->` syntax.

```html
<!-- Mustache syntax — path, filter, and state name completions -->
<p>{{ count|gt(0) }}</p>

<!-- Comment binding syntax — no FOUC -->
<p><!--@@:count|gt(0)--></p>
<p><!--@@wcs-text:count--></p>
```

### Binding Diagnostics

Real-time validation for `data-wcs` attributes, `{{ }}` syntax, and `<!--@@:-->` syntax:

| Check | Example | Severity |
|---|---|---|
| Unknown path | `textContent: typo` | ⚠ warning |
| Unknown filter | `textContent: count\|fake` | ⚠ warning |
| Non-array for `for:` | `for: count` | ❌ error |
| Non-boolean for `if:` | `if: count` | ⚠ warning |
| Non-boolean for `class.` | `class.active: count` | ⚠ warning |
| Non-string for `attr.`/`style.` | `attr.href: count` | ⚠ warning |
| Filter input type mismatch | `count\|uc` (number→string filter) | ⚠ warning |
| Missing filter arguments | `count\|mul` | ❌ error |
| Filter argument type mismatch | `count\|gt(abc)` | ⚠ warning |
| Event + filter | `onclick: fn\|gt(10)` | ⚠ warning |
| Pattern path outside `<template for>` | `textContent: items.*.name` | ⚠ warning |
| Shorthand path outside `<template for>` | `textContent: .name` | ⚠ warning |
| Resolved path (numeric index) | `textContent: items.0.name` | ⚠ warning |
| `{{ }}` outside `<template>` (FOUC) | `<p>{{ count }}</p>` | ℹ info |
| Nested property assignment | `this.user.name = "..."` | ⚠ warning |
| `<!--@@:-->` binding visualization | `<!--@@:count-->` | ℹ info |

Filter chain type tracking correctly validates expressions like `if: count|gt(0)` (number→boolean) as OK.

### JSDoc Type Validation

Validates consistency between `@type` annotations and initial values:

```javascript
/** @type {string} */
label: null,        // ⚠ Type "null" is not compatible with @type {string}

/** @type {string|null} */
label: null,        // ✅ OK
```

### Nested Property Assignment Warning

Detects nested property assignments in `<wcs-state>` scripts and warns that they do not trigger reactive updates.

```javascript
// ⚠ Nested property assignment does not trigger reactive updates
this.user.name = "Bob";

// ✅ Use dot-path notation instead
this["user.name"] = "Bob";
```

## Settings

| Setting | Default | Description |
|---|---|---|
| `wcstack.bindAttributeName` | `"data-wcs"` | Bind attribute name |
| `wcstack.stateTagName` | `"wcs-state"` | Custom element tag name for state definition |

## Requirements

- VSCode 1.95+
- HTML files containing `<wcs-state>` elements

## License

MIT
