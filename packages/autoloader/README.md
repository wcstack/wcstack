# @wcstack/autoloader

**What if custom elements loaded themselves?**

Imagine a future where you just write a custom element tag and the browser figures out where to find it. No `import`, no `customElements.define()`, no registration boilerplate. You write the tag, it loads.

That's what `<wcs-autoloader>` explores. One CDN import, zero dependencies, powered by Import Maps.

## Features

### Basic Features
- **Auto Detection & Loading**: Detects undefined custom element tags and automatically `import()`s them.
- **Dynamic Content Support**: Instantly detects elements added later via `innerHTML` or `appendChild`.
- **Zero Config / Buildless**: Works with browser standard features only; no bundler configuration required.
- **Zero Dependencies**: Lightweight with no external dependencies.

### Unique Features
- **Import Map Extension**: A standards-compliant approach that defines `@components/` rules within standard Import Maps.
- **Namespace Prefix Auto-Resolution**: No need to register components one by one. Just define a prefix like `@components/ui/`, and it auto-resolves `<ui-button>` to `button.js`.
- **Inline Loader Specification**: Specify loaders in Import Map keys like `@components/ui|lit/`. Easily mix multiple frameworks.
- **Advanced `is` Attribute Support**: Automatically loads extended built-in elements. Infers `extends` from class definitions and calls `define` appropriately.
- **Abstracted Loaders**: The file loading logic itself is pluggable, allowing customization of extensions and processing systems.

## Usage

### 1. Setup Import Map

Define the autoloader path using the `@wcstack/autoloader` key.
Define your component paths in an import map using the `@components/` prefix.

```html
<script type="importmap">
  {
    "imports": {
      "@wcstack/autoloader": "/path/to/autoloader",
      "@components/ui/": "./components/ui/",
      "@components/app/": "./components/app/"
    }
  }
</script>
```

### 2. Load the Autoloader

Load the autoloader script via `<script>` tag, or import and call `bootstrapAutoloader` manually.

```html
<!-- Option A: Zero-config script (recommended) -->
<script type="module" src="https://esm.run/@wcstack/autoloader/auto"></script>

<!-- Option B: Manual initialization -->
<script type="module">
  import { bootstrapAutoloader } from "@wcstack/autoloader";
  bootstrapAutoloader();
</script>
```

### 3. Place the `<wcs-autoloader>` Element

Add `<wcs-autoloader>` to your HTML. This element triggers the loading lifecycle — eager loading starts on element creation, and lazy loading starts when the element is connected to the DOM.

```html
<body>
  <wcs-autoloader></wcs-autoloader>
  <!-- your app components -->
</body>
```

### 4. Use Components

Just use your custom elements in HTML. `@wcstack/autoloader` will automatically import the matching file.

```html
<!-- Loads ./components/ui/button.js -->
<ui-button></ui-button>

<!-- Loads ./components/app/header.js -->
<app-header></app-header>
```

## Import Map Syntax

`@wcstack/autoloader` parses keys in the import map starting with `@components/`.

### Lazy Loading (Namespaces)

To enable lazy loading for a group of components, use a key ending with `/`.

Format: `"@components/<prefix>[|<loader>]/": "<path>"`

- **Prefix**: The tag prefix. Slashes are converted to dashes.
- **Loader** (Optional): The loader to use (e.g., `vanilla`, `lit`). Defaults to `vanilla`.

**Examples:**

```json
{
  "imports": {
    // Maps <my-component> to ./components/component.js
    "@components/my/": "./components/",

    // Maps <ui-button> to ./ui/button.js (using 'lit' loader if configured)
    "@components/ui|lit/": "./ui/"
  }
}
```

### Eager Loading

To load a specific component immediately, use a key that does NOT end with `/`.

Format: `"@components/<tagName>[|<loader>[,<extends>]]": "<path>"`

- **Loader** (Optional): If omitted, it is automatically resolved based on the file extension (e.g., `.js` -> default loader, `.lit.js` -> lit-loader).
- **Extends** (Optional): If omitted, it is automatically detected if the component class extends a built-in HTML element (e.g., `HTMLButtonElement` -> `extends: 'button'`).

**Examples:**

```json
{
  "imports": {
    // Eager loads <my-button> from ./my-button.js
    // Loader: Auto-detected (.js)
    // Extends: Auto-detected (e.g. if class extends HTMLButtonElement)
    "@components/my-button": "./my-button.js",

    // Explicitly specifying loader and extends
    "@components/fancy-input|vanilla,input": "./fancy-input.js",
    
    // Auto-detect loader for Lit element (if lit-loader is configured)
    "@components/my-lit-button": "./my-button.lit.js"
  }
}
```

## Component Requirements

By default (using the `vanilla` loader), your component files should:

1.  Have a `.js` extension (configurable).
2.  Export the custom element class as `default`.

```javascript
// components/ui/button.js
export default class UiButton extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML = '<button><slot></slot></button>';
  }
}
```

## Customized Built-in Elements (`is` attribute)

The autoloader detects customized built-in elements using the `is` attribute:

```html
<!-- Autoloader detects and loads "my-button" -->
<button is="my-button">Click me</button>
```

**Lazy loading**: The `extends` value is automatically inferred from the host element tag (e.g., `<button>` → `extends: "button"`).

**Eager loading**: The `extends` value is inferred from the component class prototype (e.g., `HTMLButtonElement` → `extends: "button"`), or can be specified explicitly in the import map:

```json
{
  "imports": {
    "@components/my-button|vanilla,button": "./my-button.js"
  }
}
```

```javascript
// my-button.js
export default class MyButton extends HTMLButtonElement {
  connectedCallback() {
    this.style.color = 'red';
  }
}
// Autoloader calls: customElements.define('my-button', MyButton, { extends: 'button' })
```

## Configuration

Initialize the autoloader with optional configuration via `bootstrapAutoloader()`:

```typescript
interface ILoader {
  postfix: string;
  loader: (path: string) => Promise<CustomElementConstructor | null>;
}

interface IWritableTagNames {
  autoloader?: string;
}

interface IWritableConfig {
  loaders?: Record<string, ILoader | string>;
  observable?: boolean;
  tagNames?: IWritableTagNames;
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `loaders` | `Record<string, ILoader \| string>` | See below | Loader definitions. Values can be `ILoader` objects or string aliases pointing to other loader keys. |
| `observable` | `boolean` | `true` | Enables MutationObserver to detect dynamically added elements. Set to `false` to disable. |
| `tagNames` | `IWritableTagNames` | `{ autoloader: "wcs-autoloader" }` | Custom element tag name. Can be changed to avoid naming conflicts. |

### Default Configuration

```javascript
{
  loaders: {
    // Built-in vanilla loader: imports module and returns default export
    vanilla: { postfix: ".js", loader: vanillaLoader },
    // Default key: used as fallback when no loader matches
    "*": "vanilla"
  },
  observable: true
}
```

- **`vanilla`**: The built-in loader that dynamically imports a module and returns its `default` export as the custom element constructor.
- **`"*"` (default key)**: Fallback loader. Its value is a string alias `"vanilla"`, meaning unmatched components use the vanilla loader.

### Loader Resolution

When a component has no explicit loader key (e.g., lazy-loaded namespaces without `|loader`), the autoloader resolves the loader as follows:

1. **Postfix matching**: Checks the file path against all registered loaders' `postfix` values (longest match first).
2. **Default key fallback**: If no postfix matches, uses the loader referenced by the `"*"` key.

### Example

```javascript
import { bootstrapAutoloader } from "@wcstack/autoloader";

bootstrapAutoloader({
  loaders: {
    // Override vanilla loader's file extension
    vanilla: { postfix: ".vanilla.js" },
    // Add a custom loader for .lit.js files
    lit: {
      postfix: ".lit.js",
      loader: async (path) => {
        const module = await import(path);
        return module.default;
      }
    }
  },
  // Disable MutationObserver (no dynamic content detection)
  observable: false
});
```

## How it Works

### Loading Lifecycle

1. **Registration**: `bootstrapAutoloader()` registers the `<wcs-autoloader>` custom element via `customElements.define()`.
2. **Constructor** (on element creation): All `<script type="importmap">` elements are parsed for `@components/` entries. Eager loading starts immediately for non-namespaced keys (not ending with `/`).
3. **connectedCallback** (on DOM attachment): Waits for `DOMContentLoaded` if the document is still loading, then scans the DOM using TreeWalker for undefined custom elements matching registered namespaces.
4. **Nested Loading**: After each custom element is defined and upgraded, its Shadow DOM (if present) is also scanned for nested custom elements.
5. **Observation** (if `observable: true`): A MutationObserver watches for new elements added to the DOM and triggers lazy loading.
6. **disconnectedCallback** (on removal): Disconnects the MutationObserver and releases the singleton instance.

### Error Handling

- Components that fail to load are tracked internally and will not be retried on subsequent scans.
- Duplicate loading is prevented: if a component is already being loaded, subsequent requests wait for the existing load to complete.

## License

MIT
