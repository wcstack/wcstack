# wcstack

**Web Components Stack** — A standards-first toolkit for building SPAs with Web Components.

Three independent packages. Zero runtime dependencies. No build step required.

## Packages

| Package | Description |
|---------|-------------|
| [`@wcstack/autoloader`](packages/autoloader/) | Auto-detect and dynamically import custom elements via Import Maps |
| [`@wcstack/router`](packages/router/) | Declarative SPA routing with layouts, typed parameters, and head management |
| [`@wcstack/state`](packages/state/) | Reactive state management with declarative data binding and computed properties |

---

## @wcstack/autoloader

Write a custom element tag — it loads automatically.

```html
<script type="importmap">
  {
    "imports": {
      "@components/ui/": "./components/ui/",
      "@components/ui|lit/": "./components/ui-lit/"
    }
  }
</script>

<!-- Auto-loaded from ./components/ui/button.js -->
<ui-button></ui-button>

<!-- Auto-loaded with Lit loader from ./components/ui-lit/card.js -->
<ui-lit-card></ui-lit-card>
```

- **Import Map based** namespace resolution — no per-component registration
- **Eager & lazy loading** — load critical components first, the rest on demand
- **MutationObserver** — dynamically added elements are detected automatically
- **Pluggable loaders** — mix Vanilla, Lit, or any custom loader
- **`is` attribute support** — customized built-in elements with auto `extends` detection

[Full documentation &rarr;](packages/autoloader/README.md)

---

## @wcstack/router

Declarative SPA routing — define routes in HTML, not JavaScript.

```html
<wcs-router>
  <template>
    <wcs-route path="/">
      <wcs-layout layout="main-layout">
        <nav slot="header">
          <wcs-link to="/">Home</wcs-link>
          <wcs-link to="/products">Products</wcs-link>
        </nav>
        <wcs-route index>
          <wcs-head><title>Home</title></wcs-head>
          <app-home></app-home>
        </wcs-route>
        <wcs-route path="products">
          <wcs-head><title>Products</title></wcs-head>
          <wcs-route index>
            <product-list></product-list>
          </wcs-route>
          <wcs-route path=":id(int)">
            <product-detail data-bind="props"></product-detail>
          </wcs-route>
        </wcs-route>
      </wcs-layout>
    </wcs-route>
    <wcs-route fallback>
      <error-404></error-404>
    </wcs-route>
  </template>
</wcs-router>
<wcs-outlet></wcs-outlet>
```

- **Nested routes & layouts** — compose UI structure declaratively with Light DOM layout system
- **Typed parameters** — `:id(int)`, `:slug(slug)`, `:date(isoDate)` with auto-conversion
- **Auto-binding** — inject URL params into components via `data-bind` (`props`, `states`, `attr`)
- **Head management** — `<wcs-head>` switches `<title>` and `<meta>` per route
- **Navigation API** — built on the modern standard with popstate fallback
- **Route guards** — protect routes with async decision functions

[Full documentation &rarr;](packages/router/README.md)

---

## @wcstack/state

Reactive state with declarative bindings — no virtual DOM, no compilation.

```html
<wcs-state>
  <script type="module">
    export default {
      taxRate: 0.1,
      cart: {
        items: [
          { name: "Widget", price: 500, quantity: 2 },
          { name: "Gadget", price: 1200, quantity: 1 }
        ]
      },
      removeItem(event, index) {
        this["cart.items"] = this["cart.items"].toSpliced(index, 1);
      },
      // Path getter — computed per loop element
      get "cart.items.*.subtotal"() {
        return this["cart.items.*.price"] * this["cart.items.*.quantity"];
      },
      get "cart.total"() {
        return this.$getAll("cart.items.*.subtotal", []).reduce((a, b) => a + b, 0);
      },
      get "cart.grandTotal"() {
        return this["cart.total"] * (1 + this.taxRate);
      }
    };
  </script>
</wcs-state>

<template data-wcs="for: cart.items">
  <div>
    {{ .name }} &times;
    <input type="number" data-wcs="value: .quantity">
    = <span data-wcs="textContent: .subtotal|locale"></span>
    <button data-wcs="onclick: removeItem">Delete</button>
  </div>
</template>
<p>Grand Total: <span data-wcs="textContent: cart.grandTotal|locale(ja-JP)"></span></p>
```

- **Path getters** — `get "users.*.fullName"()` virtual properties at any depth, all defined flat in one place with auto dependency tracking
- **Structural directives** — `for`, `if` / `elseif` / `else` via `<template>`
- **37 built-in filters** — comparison, arithmetic, string, date, number formatting
- **Two-way binding** — automatic for `<input>`, `<select>`, `<textarea>`, radio & checkbox groups
- **Mustache syntax** — `{{ path|filter }}` in text nodes
- **Web Component binding** — bidirectional state binding with Shadow DOM components

[Full documentation &rarr;](packages/state/README.md)

---

## Design Philosophy

| Principle | Description |
|-----------|-------------|
| **Standards first** | Custom Elements, Shadow DOM, ES Modules, Import Maps |
| **Declarative** | HTML structure expresses application intent |
| **Zero-config & buildless** | No bundler, no transpiler — works in the browser as-is |
| **Zero dependencies** | No runtime dependencies across all packages |
| **Low learning cost** | Built on familiar Web standards |
| **Predictable behavior** | Explicit over implicit — no hidden magic |

## Project Structure

```
wcstack/
├── packages/
│   ├── autoloader/    # @wcstack/autoloader
│   ├── router/        # @wcstack/router
│   └── state/         # @wcstack/state
```

Each package is independently built, tested, and published. No root-level workspace orchestration.

## Development

Commands run from within a specific package directory (e.g., `packages/state/`):

```bash
npm run build            # Clean dist, compile TypeScript, bundle with Rollup
npm test                 # Run tests (Vitest)
npm run test:coverage    # Coverage with 100% thresholds
npm run lint             # ESLint
```

## License

MIT
