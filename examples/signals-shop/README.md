# signals + router + fetch + storage demo (the tutorial's shop)

"Little Roastery", the shop that [the wcstack tutorial](https://wcstack.github.io/tutorial/) builds with `@wcstack/state` (its step 14), written again with [`@wcstack/signals`](../../packages/signals/README.md). The state version describes the page with `data-wcs` paths. This one uses `signal` / `computed` / `effect` and `h()` in JavaScript, and drives the same I/O elements — `<wcs-fetch>`, `<wcs-storage>`, `<wcs-router>` — through the wc-bindable bridge (`mountNode` / `bindNode`). Both shops use the same stylesheet and markup class names, so they look the same.

## Run it

The packages load from a CDN ([esm.run](https://esm.run)), so Node.js alone is enough:

```bash
node examples/signals-shop/server.js                  # http://localhost:3000
PORT=3456 node examples/signals-shop/server.js
FAIL_CATALOG=1 node examples/signals-shop/server.js   # products.json answers 500 once — try "Try again"
WCS_LOCAL=1 node examples/signals-shop/server.js      # use the locally built packages/*/dist
```

The server builds on `examples/shared/server.js` — copy `examples/shared/` along with this directory if you take it out of the repo. Every `GET` that is not a file serves `index.html`, so deep links (`/products/3`) and reloads work. `WCS_LOCAL=1` rewrites every `https://esm.run/@wcstack/…` URL in the import map through that package's `exports` (`@wcstack/signals/dom` → `/packages/signals/dist/dom.esm.js`, `…/auto` → `dist/auto.min.js`) and serves `/packages/` from the repository.

## Things to try

- Add two of a coffee and one tea, then reload → the same cart, totals and badge. localStorage (`little-roastery-cart`) holds only ids and quantities.
- Open a second tab → the same cart. Press `+` in either tab → the other tab follows.
- Open `/products/3` directly, go to the catalog, type a search and pick a category, open a product, add it, press Back → the catalog, with the search text and category as you left them.
- Search "zzz" → "No products match."
- `/products/99` → "No such product."; `/products/abc` and `/nope` → the fallback page.

## How it fits together

| Seam | How the page crosses it |
|---|---|
| signals ↔ `<wcs-fetch>` | `mountNode("wcs-fetch", { attrs: { url: "products.json" } })`. Its `value` / `loading` / `error` are signals, and "Try again" calls its `fetch` command. |
| signals ↔ `<wcs-storage>` | `mountNode("wcs-storage", { attrs: { key } })` loads the key while it connects. The cart signal is seeded from `signals.value.peek()` **before** `bindInput("value", cart)` — the signals form of `#init=element` ([signals README §7](../../packages/signals/README.md)). Values from other tabs, and the element's echo of its own save, come back through `signals.value`. The cart signal's equality (`sameLines`) makes a value with the same lines a no-op, so the round-trip cannot loop. |
| signals ↔ `<wcs-router>` | Each route's content is a `SignalsElement` (`<catalog-page>`, `<product-page>`). The router stamps it when the route is entered and takes the same nodes out when it is left. The element renders on connect and disposes on disconnect. `bindNode(<wcs-router>).signals.typedParams` gives the product id (`:id(int)` → a number). The search text and category are module-level signals, so they outlive the catalog page's DOM. |
| A page ↔ a component | `<product-card>` (`product-card.js`, a `SignalsElement`) receives the product object as a property (`h("product-card", { product })`). It is imported before any card is created, so the card is defined when `h()` makes it. (A card defined later used to get `product="[object Object]"` as an attribute; signals now holds the object and assigns it once the element is defined.) Pressing its button fires a bubbling `add-to-cart` event, which the page hears with `"onadd-to-cart"`. |
| Keyed rows ↔ immutable updates | The cart holds `[{ id, quantity }]`, and every change replaces the array and the line it touches. The cart rows are `For(cartLines, …, { key: (line) => line.id })`: `+`/`−` keeps the row (and its focused button), and the row reads the new quantity through the third argument, `current()`. |

## Compared with the state shop

The state version needs a row getter plus `$getAll` and an accessor pair to save `cart.*.quantity` changes. Here the cart model and totals are plain `computed`s, and saving is one `bindInput`. The price is what `data-wcs` does for you. Route content has no binder, so pages are custom elements. Writes must be immutable (`Object.is`), so a line is never edited in place. The storage and router timing that `#init=element` and the binder protocol hide is written out in the module.

## What building it found

This shop was built from the public documents only, to find what signals makes hard on a real app. The findings and where each one went are recorded in [docs/seam-apps.md](../../docs/seam-apps.md). In short, 4.1.0 changed two things the shop relies on:

- a keyed `For` row now gets `current()`, the item under its key now (a row used to keep showing the first object it was built with);
- any `on…` key with a function is an event listener in `h()` (a lowercase `onclick` used to run at render time).

The signals README also gained §7, on pages behind the router and seeding from `<wcs-storage>`.

## Tests

[`e2e/tests/signals-shop.spec.ts`](../../e2e/tests/signals-shop.spec.ts) runs this server with `WCS_LOCAL=1` in Chromium. It covers the cart after a reload, two tabs both ways, the deep link and Back, an immutable update reaching the kept row, "No products match.", the not-found pages and the retry. It also checks that the console has no errors or warnings.
