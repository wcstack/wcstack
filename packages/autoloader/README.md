# @wcstack/autoloader

Automatically loads custom elements (requires Web Components support) just by writing the tags in HTML.

## Features
- Define rules in importmap
- Supports eager/lazy loading
- Lazy loading auto-resolves load file names by namespace prefix
- Dynamically loads by detecting undefined tags
- Supports built-in custom elements via the is attribute
- Supports dynamically added elements via MutationObserver
- Switchable loaders allow changing frameworks (requires Web Components support)
- Zero config
- Zero dependencies
- Buildless

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

### 2. Register the Handler

Import and call `registerHandler` in your main script.

```html
<script type="module">
  import { registerHandler } from "@wcstack/autoloader";
  registerHandler();
</script>
```

### 3. Use Components

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

## Configuration

You can configure loaders by modifying the `config` object.

```javascript
import { registerHandler, config } from "@wcstack/autoloader";

// Example: Change default postfix
config.loaders.vanilla.postfix = ".vanilla.js";

registerHandler();
```

## License

MIT
