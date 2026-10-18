# server + router + state + fetch + storage demo (a server-rendered news site)

"SSR News", a small local-news site. The server renders every page with `@wcstack/server`'s `renderToString()` — the list, an article with its comments, a section layout with a sidebar — and the client hydrates it and navigates without reloads. Readers comment on articles (shown at once, confirmed by the server) and keep a text size and a reading history in `localStorage`. Without JavaScript the site still reads, links and takes comments.

## Run it

```bash
cd examples/ssr-news && npm install    # @wcstack/server, router, fetch (state comes with the server)
node server.js                         # http://localhost:3000   (PORT=… to change)
node server.js --prod                  # pinned jsDelivr files with integrity=, and a Content-Security-Policy
WCS_LOCAL=1 node examples/ssr-news/server.js   # from the repo root: render with and serve packages/*/dist (no install)
```

`DELAY=<ms>` (or `?delay=<ms>` on an API URL) slows the API; `CACHE_TTL=<ms>` sets the rendered-HTML cache (default 5000, `0` off); `CLIENT=<version>` loads another client version than the one the page was rendered with. Articles and comments live in the server's memory.

| URL | |
|---|---|
| `/` | The list |
| `/articles/:id` | An article, its comments and the comment form, in the section layout. An unknown id is "Article not found", HTTP 404 |
| anything else | "Page not found", HTTP 404 |
| `GET /api/articles`, `GET /api/articles/:id`, `GET` / `POST /api/articles/:id/comments` | The API (`POST …?fail=1` answers 500; an empty text 422 `{ errors: { text: "required" } }`) |
| `POST /articles/:id/comments` | The comment form without JavaScript (urlencoded → 303 back to the article) |

## Things to try

- Open `/articles/3` with view-source: the article, its comments and the sidebar are in the HTML, and the `<title>` is the article's. Then let it hydrate: the browser requests nothing.
- Disable JavaScript: read the list, follow a title, post a comment.
- Choose a text size, read an article, reload: the size and the "✓ read" mark come back (after hydration — the server cannot see `localStorage`).
- Post an empty comment (422), tick "make the server fail" (500), double-click Post (one comment).
- Article 1's comments are `{{ apiKey }}`, `<b>bold</b>` and a `<button data-wcs="onclick: wipe">`: they are state rendered with `textContent:`, so they stay text.

## How it is put together

- **State** is a file, `state.js` (`<wcs-state enable-ssr src="./state.js">`): the server imports it through `renderToString({ resolveModule })` (Node's loader reads no `http:` URL), the browser from `/state.js`. No inline script, so the CSP needs no nonce for it.
- **The list** is loaded in `$connectedCallback` (on the server; the client skips it when it hydrates). **The article and its comments** are `<wcs-fetch>` elements whose `url` comes from the router's params through state; the server waits for those requests, so the page goes out with them. Their url getters return `null` once the route's data is loaded (`articleFor` / `commentsFor` in the snapshot), so hydration fetches nothing. A failed request keeps its url and offers Retry through `trigger:`.
- **Links** are `<wcs-link>`, in rows and branches too: the server renders their `<a>`, the client adopts the server's rows.
- **The head**: each route's `<wcs-head>` sets the title on the client; the server writes the `<title>` and description a crawler gets into the page it wraps around the output (it duplicates the state's `pageTitle`).
- **HTTP status**: the not-found content carries `data-http-status="404"`, which the server looks for inside the rendered `<wcs-outlet>` only (the router's own `<template>` holds that markup too).
- **The client version** is the one the page was rendered with, read from `<wcs-ssr version>`; with `--prod` the integrity values come from that GitHub Release's `sri.json`, and a page with no digest does not go out.
- **The HTML cache** keeps a rendered page for 5 s per URL, and drops an article's pages when a comment is posted (the client trusts a snapshot and would not fetch the new comment).

## The seams it crosses

`@wcstack/server` × `<wcs-router enable-ssr>` × `<wcs-state enable-ssr>`; `<wcs-fetch>` on the server (a request a binding started) and at hydration (what the snapshot already holds); `<wcs-link>` / `<wcs-head>` / `<wcs-layout>` under SSR; the client's version × the server's; a form for readers without JavaScript next to the same form bound to state.

## Known limits

- **The article page is a `<wcs-layout>` route, which the client renders again** (layouts are not adopted): the server's nodes there are replaced, and what a reader typed into the comment form before the client loaded is lost. Typing into a control outside the layout (the text size) is kept.
- **`<wcs-fetch>` writes `style="display: none;"` on the server**, so the CSP keeps `style-src-attr 'unsafe-inline'`.
- **Dates are formatted in the runtime's time zone** — the server's, then the reader's — so a date near midnight can change at hydration.

## What building it found

A first-time author built it from the public documents and the published 4.2.0; what got in the way, and what was fixed for 4.3.0, is in [docs/seam-apps.md](../../docs/seam-apps.md) ("ssr-news"). Landing it here took out the workarounds 4.3.0 made unnecessary: plain `<a>` in rows (`<wcs-link>` was rendered empty), loading the article in `$connectedCallback` after waiting for the router (the render did not wait for `<wcs-fetch>`), an inline state with a nonce (`src` could not be server-rendered) and `style-src-attr` for `<wcs-link>` / `<wcs-head>`.

## Tests

`e2e/tests/ssr-news.spec.ts` (Playwright, `WCS_LOCAL=1`, one server per worker on port 5000 + the worker index) checks what the server's HTML holds, that the client adopts the server's rows and requests nothing, the title per route, typing before hydration, posting (success, 422, 500, a double click, a reload), user content staying text, Back / Forward, preferences across a reload, a failed request and Retry, a missing article, and the site without JavaScript.
