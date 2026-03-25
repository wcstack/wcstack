# Changelog

## 0.1.0

Initial release.

### Features

- **Inline script type support** — Full TypeScript IntelliSense inside `<wcs-state>` `<script type="module">` blocks
  - Typed `this` access with dot-path resolution (`this["users.*.age"]` → `number`)
  - Auto-wraps `export default { ... }` with `defineState()` for `ThisType<T>` support
  - No imports required in inline scripts

- **Attribute binding completions** — IntelliSense for `data-wcs` attribute values
  - Property name completions (`textContent`, `class.`, `style.`, `attr.`, `onclick`, etc.)
  - State path completions (dynamically generated from `<wcs-state>` script analysis)
  - Filter name completions (40+ built-in filters)
  - Event modifier completions (`prevent`, `stop`)

- **Binding diagnostics** — Real-time validation of `data-wcs` expressions
  - Unknown path detection
  - Unknown filter detection
  - Type checking for `for:` (requires array), `if:` (requires boolean), `class.` (requires boolean), `attr.`/`style.` (requires string)
  - Filter chain type tracking (input/output type compatibility)
  - Filter argument count and type validation
  - Event handler + filter misuse detection

- **State type validation** — JSDoc `@type` annotation checking
  - Validates initial values against declared types
  - Supports union types (`boolean|null`)

- **Configurable** — `wcstack.bindAttributeName` setting for custom attribute names
