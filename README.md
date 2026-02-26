# wcstack

**What if the browser had these built in?**

wcstack is a thought experiment turned into code. We imagine what future web standards *could* look like — reactive data binding, declarative routing, automatic component loading — and build them as if they already existed in the browser.

No framework. Just HTML tags that *should* exist.

---

## Rules of the Game

This project follows five strict constraints. They're what make it interesting.

| # | Rule | Why |
|---|------|-----|
| 1 | **Single CDN import** | One `<script>` tag. That's it. No npm, no bundler, no config. |
| 2 | **Features as custom tags** | Everything is a custom element. If it can't be expressed as `<wcs-something>`, it doesn't belong here. |
| 3 | **Initial load = tag definitions only** | The script just registers custom elements. No initialization code, no bootstrap ritual. |
| 4 | **HTML-native syntax** | No DSL, no special template syntax. If it doesn't look like regular HTML, we find another way. |
| 5 | **Latest ECMAScript** | We actively adopt cutting-edge JS features. No transpiling to ES5. This is the future, after all. |

These rules sound simple. They're not.

Constraining yourself to HTML-native syntax means you need to deeply understand how HTML was designed. Building everything as custom tags means solving lifecycle, ordering, and communication within the Custom Elements spec. No dependencies means every algorithm is yours to write. And it all has to feel like it *could* be a browser built-in.

---

## Packages

Three independent packages. Zero runtime dependencies. No build step required.

### What if HTML had reactive data binding?

[`@wcstack/state`](packages/state/) — Declare state inline, bind it to the DOM with attributes.

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

- **Path getters** — `get "users.*.fullName"()` computed properties at any depth
- **Structural directives** — `for`, `if` / `elseif` / `else` via `<template>`
- **40+ built-in filters** — comparison, arithmetic, string, date, formatting
- **Two-way binding** — automatic for `<input>`, `<select>`, `<textarea>`
- **Mustache syntax** — `{{ path|filter }}` in text nodes
- **Web Component binding** — bidirectional state sync with Shadow DOM

[Full documentation &rarr;](packages/state/README.md)

---

### What if routing was just HTML tags?

[`@wcstack/router`](packages/router/) — Define your app's navigation structure in markup.

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

- **Nested routes & layouts** — compose UI declaratively with Light DOM
- **Typed parameters** — `:id(int)`, `:slug(slug)`, `:date(isoDate)` with auto-conversion
- **Auto-binding** — inject URL params into components via `data-bind`
- **Head management** — `<wcs-head>` switches `<title>` and `<meta>` per route
- **Navigation API** — built on the modern standard with popstate fallback
- **Route guards** — protect routes with async decision functions

[Full documentation &rarr;](packages/router/README.md)

---

### What if custom elements loaded themselves?

[`@wcstack/autoloader`](packages/autoloader/) — Write a tag, it loads. No registration needed.

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

- **Import Map based** — namespace resolution, no per-component registration
- **Eager & lazy loading** — load critical components first, the rest on demand
- **MutationObserver** — dynamically added elements are auto-detected
- **Pluggable loaders** — mix Vanilla, Lit, or any custom loader
- **`is` attribute** — customized built-in elements with auto `extends` detection

[Full documentation &rarr;](packages/autoloader/README.md)

---

## Quick Start

```html
<!DOCTYPE html>
<html>
<head>
  <script type="module" src="https://esm.run/@wcstack/state"></script>
</head>
<body>

<wcs-state>
  <script type="module">
    export default { count: 0 };
  </script>
</wcs-state>

<p>Count: {{ count }}</p>
<button data-wcs="onclick: count++">+1</button>

</body>
</html>
```

One `<script>` tag. One custom element. Pure HTML. That's it.

---

## Project Structure

```
wcstack/
├── packages/
│   ├── state/         # @wcstack/state
│   ├── router/        # @wcstack/router
│   └── autoloader/    # @wcstack/autoloader
```

Each package is independently built, tested, and published.

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
