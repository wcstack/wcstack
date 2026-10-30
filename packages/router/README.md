# @wcstack/router

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

**What if routing was just HTML tags?**

Imagine a future where you define your app's navigation structure in markup — nested routes, layouts, typed parameters — all as native HTML elements. No router config objects, no JavaScript ceremony. Just tags that describe where things go.

That's what `<wcs-router>`, `<wcs-route>`, and friends explore. One CDN import, zero dependencies, pure HTML syntax.

## Features

### Basic Features
* **Declarative Routing**: Simply list `<wcs-route>` tags within an HTML `<template>`. No JS configuration object required.
* **Nested Route Definitions**: Intuitively express nested structures like `/products/:id`.
* **Parameter Support**: Supports path parameters (`:id`).
* **Fallback (404)**: Handle undefined paths with `<wcs-route fallback>`.
* **Navigation API Based**: Built on the modern standard Navigation API, offering high affinity with native browser behavior.
* **Zero Config / Buildless**: Works directly in the browser without bundling.

### Unique Features
* **Light DOM Layout System**: Defines layout templates in normal DOM (Light DOM) without forcing Shadow DOM. Makes global CSS application and `<slot>` insertion easy.
* **Typed Parameters**: Specify type constraints like `:id(int)`. Automatically converts values to `number` type.
* **Mixed Layouts & Routes**: Freely nest `<wcs-layout>` within the routing tree, managing layout switching per area purely through HTML structure.
* **Auto-Binding**: Automatically injects URL parameters into components using `data-bind` attribute (supports `props`, `states`, `attr`, and direct property modes).
* **Declarative `<head>` Management**: Declaratively switch `title` and `meta` tags for each page using `<wcs-head>`.

## Usage

```html
<wcs-router>
	<template>
		<!-- When path is "/" -->
		<wcs-route path="/">
			<!-- Apply the "main-layout" layout -->
			<wcs-layout layout="main-layout">
				<main-header slot="header"></main-header>
				<main-body>
					<!-- When path is "/" -->
					<wcs-route index>
						<wcs-head>
							<title>Main Page</title>
						</wcs-head>
						<main-dashboard></main-dashboard>
					</wcs-route>

					<!-- When path is "/products" (relative paths below top-level) -->
					<wcs-route path="products">
						<wcs-head>
							<title>Product Page</title>
						</wcs-head>
						<!-- When path is "/products" -->
						<wcs-route index>
							<product-list></product-list>
						</wcs-route>
						<!-- When path is "/products/:productId" -->
						<wcs-route path=":productId">
							<!-- productItem.props.productId = productId -->
							<product-item data-bind="props"></product-item>
						</wcs-route>
					</wcs-route>
				</main-body>
			</wcs-layout>
		</wcs-route>

		<!-- When path is "/admin" -->
		<wcs-route path="/admin">
			<!-- Apply the "admin-layout" layout -->
			<wcs-layout layout="admin-layout">
				<wcs-head>
					<title>Admin Page</title>
				</wcs-head>
				<admin-header slot="header"></admin-header>
				<admin-body></admin-body>
			</wcs-layout>
		</wcs-route>

		<!-- When no path matches -->
		<wcs-route fallback>
			<error-404></error-404>
		</wcs-route>
	</template>
</wcs-router>

<wcs-outlet>
	<!-- Build a DOM tree according to the route path and layout and render it here -->
</wcs-outlet>

<!-- "main-layout" layout -->
<template id="main-layout">
	<section>
		<h1> Main </h1>
		<slot name="header"></slot>
	</section>
	<section>
		<slot></slot>
	</section>
</template>

<!-- "admin-layout" layout -->
<template id="admin-layout">
	<section>
		<h1> Admin Main </h1>
		<slot name="header"></slot>
	</section>
	<section>
		<slot></slot>
	</section>
</template>

```

* <main-header><main-body><main-dashboard><product-list><product-item><admin-header><admin-body><error-404> are custom components in your app.
* The custom elements above must be defined separately (via an autoloader or manual registration).

## Where route content lives

Two shapes work since 1.32, and they are not interchangeable. Pick per page, not per project.

**Default: put the content inside `<wcs-route>`.** The router stamps it on entry and removes it on exit. `data-wcs` bindings inside it are bound when it is stamped (the binder protocol), so state-rendered markup — `for:`, `if:`, text — works there like anywhere else. Everything the router offers is keyed to the route body: `<wcs-head>` per route, the `focus="heading"` / `announce=` policies (they look for the heading *in the stamped content*), and a view transition per route swap. The router hands state only the route body's elements, so a `{{ }}` in text directly under `<wcs-route>` (not inside an element) is bound only on the landing route, by state's first scan — not when the route is entered by navigation (@wcstack/state 3.x and 4.0 alike). Wrap such text in an element (`<p>{{ title }}</p>`).

```html
<wcs-route path="/products/:productId(int)">
  <wcs-head><title data-wcs="textContent: product.name"></title></wcs-head>
  <article>
    <h2 data-wcs="textContent: product.name"></h2>
    <ul><template data-wcs="for: product.variants"><li data-wcs="textContent: .name"></li></template></ul>
  </article>
</wcs-route>
```

Put a structural template (`for:` / `if:`) inside an element of the route body, as the `<ul>` above does: that works with every version of @wcstack/state. One directly under `<wcs-route>` depends on the version:

- **@wcstack/state 4.0** renders it whether the route is the landing one or entered by navigation, and its rows or branch (with its `elseif:` / `else:`) leave and come back with the route. The router tells state's binder that it carries the route's range (`bind(subtree, { range: true })`, the binder protocol), and only then does 4.0 render a template handed over at the top of the content; handed over without it (an older router) it reports `[wcs/template-syntax]` #204.
- **@wcstack/state 3.x** renders it only in state's first scan of the page — the landing route, when state finishes loading after the router stamped it. A route entered by navigation hands its content to state, and 3.x does not render a structural template handed over itself: it reports that the binding failed to apply. Up to 3.5.0, a top-level element that carries `data-wcs` itself must not come before the element that holds the template either (an `<h2 data-wcs="…">` directly under `<wcs-route>`, followed by the `<ul>`): 3.5.0 and earlier bind such an element by walking from its parent, which reaches the later template before it is set up, and report the same failure on navigation; 3.5.1 and later bind only the element handed over. Wrapping the body in one element, as the `<article>` above does, avoids both.

The router marks where a stamped route body ends with a comment, `<!--@@wcs-route-end:<path>-->` (the same marker SSR uses), and on exit takes everything from the route's placeholder up to it along — the route's own nodes and whatever was rendered among them since, such as the rows or branch a top-level template rendered — and puts it all back on the next entry. A node your own code inserts between those two comments goes and comes back with the route; one you moved out of the route body (a dialog moved to `<body>`) is taken back into it on exit, as before. What comes back is what was taken out: a top-level node your code removed from the route body (a dismissed notice) stays removed on the next entry. The marker is a comment, so `wcs-outlet:empty` is unaffected.

**Exception: switch it with state (`<template data-wcs="if: …">`) when the DOM must stay in the document across the navigation.** Leaving a route removes its body from the document, and entering puts the same nodes back. What the nodes hold survives (a half-filled form keeps its input), but what needs them to stay connected does not: a `<video>` stops playing, a scrolled list loses its scroll position (in Chromium and WebKit), and a component that tears down in `disconnectedCallback` starts over. Keep such content outside the router, bound to a state flag that the router's `routeName` / `typedParams` outputs set, and leave the route element empty (or holding only `<wcs-head>`).

```html
<wcs-router data-wcs="routeName: routeName">
  <template>
    <wcs-route path="/editor" name="editor"><wcs-head><title>Editor</title></wcs-head></wcs-route>
    <wcs-route path="/help" name="help"><wcs-head><title>Help</title></wcs-head></wcs-route>
  </template>
</wcs-router>
<template data-wcs="if: isEditor">
  <my-editor></my-editor>   <!-- keeps its DOM across /editor → /help → /editor -->
</template>
```

What the exception costs: `focus="heading"` finds no heading in an empty route body and falls back to the browser-default reset (`announce=` still works — it reads `document.title`), and a view transition, if `<wcs-view-transition>` is on the page, wraps the state branch update rather than the route swap. `examples/router-spa` shows both: its About page is the default shape, its product pages are the exception.

## Reference

### Router (wcs-router)

Define routes and layout slots inside a child template tag. A direct child template tag is required. Outputs according to definitions to the `<wcs-outlet>` **right after it** (see Outlet below). Multiple routers can coexist in the same document when each has a distinct `basename`.

| Attribute | Description |
|------|------|
| `basename` | When routing in a subfolder URL, specify the subfolder. Not required if you don’t run in a subfolder. The attribute does not change what relative URLs resolve against — `<wcs-fetch url="api/…">`, `<wcs-state src>`, the import map, the autoloader's `@components/` — so on a deep link they resolve under the page's URL. An app in a subfolder wants `<base href="/subfolder/">`, which also gives the router its basename. |
| `focus` | Opt-in focus policy applied after a committed navigation. `"heading"` focuses the first heading of the leaf route's content. See "Accessibility contract". |
| `announce` | Opt-in route announcement. `"title"` writes the commit-time `document.title` snapshot into the router-owned live region. See "Accessibility contract". |

#### State binding (wc-bindable)

`<wcs-router>` is the live-DOM element that exposes the whole navigation state over the wc-bindable protocol, so `@wcstack/state` (or any binding core) wires it with a single `data-wcs`:

```html
<wcs-router data-wcs="path: path; typedParams: routeParams; searchParams: query;
                      routeName: routeName; data: routeData;
                      navigateUrl: navigateUrl; replaceUrl: replaceUrl">
```

| Member | Direction | Description |
|------|------|------|
| `path` | output only | Current route path (basename already sliced). Fires `wcs-router:path-changed`. |
| `params` | output only | Merged params of the matched route chain, as strings (`Record<string, string>`). `{}` on a fallback match or before initialization. |
| `typedParams` | output only | The same params, type-converted (`:id(int)` → `number`). Shares `wcs-router:params-changed` with `params` (the event detail is `{ params, typedParams }`). |
| `searchParams` | output only | Current URL query as `Record<string, string>`. Duplicate keys (`?tag=a&tag=b`) are **last-wins**; values are decoded by `URLSearchParams` (including `+` → space). `{}` when there is no query. Fires `wcs-router:search-changed`. |
| `routeName` | output only | `name` attribute of the deepest matched route. On a fallback match, the fallback route's `name` (so a 404 view can key off `routeName` too). `""` when unnamed or before initialization. Fires `wcs-router:route-name-changed`. |
| `data` | output only | Data the current navigation's guard functions loaded — a guard that returns an object instead of `true` (see [Loading data before a route commits](#loading-data-before-a-route-commits)). `null` when no guard returned data, including before initialization; a query-only (same-match) navigation keeps the previous value. Unlike the members above it is **not** frozen: it is the object your guard returned, passed through as-is. Fires `wcs-router:data-changed`. |
| `navigateUrl` | write surface (null-idle transient) | Write a target to push-navigate. `null` means idle; writing a string starts `navigate()`, and the property resets itself to `null` when the navigation finishes. `null` / `""` writes are no-ops. The target is a **route path** — the basename is added for you: write `/products/3`, not the `href` of a link (`/ja/products/3` under the basename `/ja` lands on `/ja/ja/products/3`). |
| `replaceUrl` | write surface (null-idle transient) | Identical contract to `navigateUrl`, but the navigation **replaces** the current history entry. |
| `leaveConfirm` | input (attribute `leave-confirm`) | While it is a non-empty string, a navigation to **another route** — a link, Back / Forward, `navigate()` — first asks `confirm(leaveConfirm)` and stays when it is declined. So does a navigation that **leaves the page** and the page may cancel — a link outside the router's `basename` (a language switch, with the locale in the basename) or to another site, a form submission — where the Navigation API is (elsewhere it gets the browser's prompt); when it is accepted, the browser does not ask again. Closing or reloading the page gets the browser's own prompt (`beforeunload`). The one switch covers both: to guard only what a reload loses but a route change keeps (uploads still running in a page-level element), leave `leaveConfirm` unset for them and add your own `beforeunload` listener in `$connectedCallback`. Bind it to unsaved changes: `data-wcs="leaveConfirm: discardPrompt"` with `get discardPrompt() { return this.dirty ? "Discard your changes?" : null; }`. A query-only navigation does not ask, nor does the redirect of a navigation already confirmed. A save handler may clear it and write `navigateUrl` in the same update: the router checks after that update. A Back / Forward the browser does not let a page cancel is not asked. `null` removes the attribute. Since 4.9, a boolean works too: `true` asks with a default message in English (`Leave this page? Changes you made may not be saved.`; bind a string to ask in the page's language) and `false` asks nothing — before, the router turned it into the text, and `leaveConfirm: dirty` asked `confirm("false")` on every navigation. |
| `basename` | input | Writes the `basename` attribute, which the router reads once, when it initializes: set it before then (a later write does not move the routing base, as with the attribute). Reading it returns the basename in effect (`""` before initialization). `null` removes the attribute; `undefined` restores the attribute the element started with. |

Commands `navigate(path)` and `replace(path)` (both async) are also declared, so they can be invoked through the command-token protocol.

Output-only members are **read** when a binding attaches and streamed through their change events afterwards — the value is read, not awaited, so a binding that attaches after the router already resolved its first route misses nothing.

**Firing contract**: on a committed navigation the router commits *all* internal values first and only then fires events, in the order `data-changed` → `params-changed` → `route-name-changed` → `search-changed` → `path-changed`, each only when its value actually changed (`data` compares by identity — a guard returns a fresh object per navigation). Any listener that reads the element's properties sees the consistent post-navigation snapshot; `path` fires last and doubles as the "navigation finished" signal. The first four fire **before** the route's content is placed and `path` after it, so the bindings inside the new content read the new params and data from their first evaluation. A guard-rejected navigation updates nothing and fires nothing.

The exposed objects are **frozen snapshots** owned by the router: a new object per navigation, never mutated in place. Mutating them throws — copy into your own state instead. `data` is the one exception — it is owned by the guard that returned it, and the router neither copies nor freezes it.

**Choosing a write surface**:

- Pagination, tabs — the back button should step through them: `navigateUrl = "?page=2"`.
- Search boxes, filters — the history should not record every keystroke: `replaceUrl = "?q=" + …`, with `<wcs-debounce>` in front of high-frequency input.

Two things a search page with its query in the URL gets wrong without a word:

- **What the reader is typing, while the URL catches up.** With the box bound to the URL's query (`searchParams.q`) and `<wcs-debounce>` between the box and `replaceUrl`, the URL — and so the box — lags the keys: a settle writes the URL, the router commits it a moment later, and in between the box is written back with the older query, under the reader's fingers. Show what is typed while it is being typed: keep the box's own `draft` and a `typing` flag, set on `input` and cleared when the debounce has settled and the URL has what it settled on, and show the URL's query only when the flag is clear (so Back / Forward still fills the box). And write the URL only from a settle of something typed: the debounce settles once for the value it starts with too, and on a deep link (`/search?q=a&page=2`) that settle would write the query back over the URL — `?q=` or `?q=a`, without the `page`.
- **Announcing the result count.** Write the sentence ("12 books found") from the response of the request — the `<wcs-fetch>`'s response event, `eventToken.value: results` with `$on: { results(state, event) { … } }` ([which response `value` holds](../fetch/README.md#output-state-bindable-async-state)) — not from `value` and the current query in a getter: `value` keeps the previous response while the new query's request is in flight, so the region first said the new query with the previous total. Put the region outside the route content (see [Accessibility contract](#accessibility-contract)).

**Multiple routers**: `params` / `routeName` reflect each router's own match, but the page URL has a single query string — a query written through *any* router replaces the query for the whole page. Reads, however, are per-router: a router commits `searchParams` only when it processes a navigation under its own `basename`, so its value is "the query as of the last navigation this router processed".

#### Query strings in navigation targets

`navigate()` / `replace()` / `navigateUrl` / `replaceUrl` / `<wcs-link to>` accept:

| Form | Meaning |
|------|------|
| `/path` | Path navigation. The current query is **not** carried over (assemble it from `searchParams` if you want to keep it). |
| `/path?k=v` | Path navigation with a query. |
| `?k=v` | Query-only navigation: the pathname keeps its current value. |
| `?` | Clears the query (pathname stays). |

`basename` joining and pathname normalization apply to the pathname only; query and hash are re-attached verbatim (the hash is passed through untouched — the router never routes on it). Queries never participate in route matching.

A query-only navigation lands on the same matched route (**same-match**): route guards do not re-run (guards protect route *entry*, and a query change is not an entry), the route content is not restamped, no view transition is requested, no announcement is made, and focus / scroll stay where they are (browser scroll restoration still applies when traversing history). Only `searchParams` — and the URL — change.

### Route (wcs-route)

Displays children when the route path matches. Match priority is static paths over parameters.

| Attribute | Description |
|------|------|
| `path` | For top-level routes, specify an absolute path starting with `/`. Otherwise, specify a relative path. For parameters, use `:paramName`. For catch-all, use `*`. Top-level routes cannot use relative paths. A route's parent is the `<wcs-route>` it is inside: elements and `<wcs-layout>` around it do not change that, and neither do the routes before it. |
| `index` | Inherits the upper path. |
| `fallback` | Displayed when no route matches the path. |
| `fullpath` | Path including parent routes (read-only). |
| `name` | Identifier. |
| `guard` | The full path to redirect to when the guard handler returns a falsy value (default `/`). A route with a `<wcs-guard-handler>` has a guard without it; a route whose handler is set from JS (`guardHandler`) needs it to enable guard handling. |

| Property | Description |
|------|------|
| `guardHandler` | Sets the guard decision function. |

> **Where are `params` / `typedParams`?** On `<wcs-router>` — see "State binding (wc-bindable)". After parsing, the route elements are detached controllers: they are not part of the live DOM, so they cannot be found with `querySelector` and cannot be bound with `data-wcs`. The router element is the observation surface for match results.

Guard decision function type:

```ts
(toPath: string, fromPath: string, context: IGuardContext) => GuardResult | Promise<GuardResult>

interface IGuardContext {          // frozen snapshot of the match being entered — the same
  params: Record<string, string>;  // vocabulary <wcs-router> exposes after the commit,
  typedParams: Record<string, any>;// readable *before* it
  searchParams: Record<string, string>;
  routeName: string;
}
```

| Return value | Effect |
|---|---|
| `true` | Enter the route. |
| an object | Enter the route **and** commit the object as `<wcs-router>.data` (a loader — see below). When several guards on the chain return objects they are shallow-merged parent → child. |
| a non-empty string | Cancel and redirect to that absolute path — a **dynamic** redirect target. It wins over the `guard` attribute. |
| `false` (or any other falsy value: `undefined`, `null`, `""`) | Cancel and redirect to the path in the `guard` attribute. |

A cancelled navigation commits nothing and fires nothing, whichever way it was cancelled.

#### GuardHandler (wcs-guard-handler)

Place as a child of `<wcs-route>` to declaratively define a guard decision function. Export the function as the `default export` from a `<script type="module">`. The `<wcs-guard-handler>` element itself is removed from the DOM after parsing.

```html
<wcs-route path="/dashboard" guard="/login">
  <wcs-guard-handler>
    <script type="module">
      export default function(toPath, fromPath) {
        return document.cookie.includes('session=');
      }
    </script>
  </wcs-guard-handler>
  <dashboard-page></dashboard-page>
</wcs-route>
```

- The handler enables guard handling by itself, and every navigation into the route waits for it — the first one included. The `guard` attribute is the redirect for a falsy result (default `/`)
- If the function returns `false`, navigation is cancelled and the user is redirected to the `guard` path; a non-empty string redirects there instead (e.g. `` return `/login?next=${encodeURIComponent(toPath)}` ``). `toPath` has no query string: rebuild it from the third argument's `searchParams` when the target needs it (`new URLSearchParams(searchParams)`)
- A redirect **replaces** the history entry of the cancelled navigation, so Back does not lead to the guarded URL (and straight back to the redirect). It is not logged — it is what the guard is for. Guards that keep redirecting each other are stopped after 10 redirects in a row, with an error naming the last one. A `navigate()` / `replace()` whose navigation is redirected rejects with an `AbortError`
- The module is evaluated **once**; the function runs on every navigation. Read anything that changes — a session — inside the function, not at the module's top level
- A guard does not see the `<wcs-state>` tree, and on a page load the landing route's guard can run before `@wcstack/state` has loaded. Read what the session is kept in directly — `localStorage`, under the key a `<wcs-storage>` saves it to — which is also current in every tab. `<wcs-storage>` stores an object or an array as JSON, but a string as it is ([Auto JSON serialization](../storage/README.md#auto-json-serialization)): `JSON.parse(localStorage.getItem(key))` reads a saved session object, and throws on a saved token string — read that with `getItem` alone
- The function can return a `Promise` for async checks — the route is not committed until it settles
- The third argument carries the match being entered (`params` / `typedParams` / `searchParams` / `routeName`); `toPath` / `fromPath` are basename-sliced paths
- It guards the `<wcs-route>` it is inside, wherever it sits there — before or after the nested routes, or inside an element. A parent's guard runs for every navigation into its child routes too
- Outside any `<wcs-route>` it is reported with `console.error` (`[wcs/guard-handler-ignored]`). If it follows a route at the same level, it keeps guarding that route, as it did before 4.3 — move it inside. Otherwise it guards nothing
- If no `<script type="module">` is present — a bundler that processes the HTML may have taken it out — the guard cannot run, and every navigation into the route is redirected to the `guard` path (default `/`), as when the script fails to load: reported with `console.error` (`[wcs/guard-handler-ignored]`). Up to 4.6 the route was shown unguarded — or, with a `guard` attribute, never shown — since 4.7 it is closed
- **Under a Content-Security-Policy**, the guard script is evaluated through a `blob:` URL, so it needs either the page's nonce on the `<script>` that loads router (the blob: import inherits it) or `script-src blob:`. (Router retries through a `data:` URL when the blob: import fails, so `script-src data:` would also pass — do not open it; it is the riskier source.) Guards are inline-only — there is no `src=` escape hatch as there is for `<wcs-state>`. See [docs/csp.md](../../docs/csp.md)
- **Under `require-trusted-types-for 'script'`**, `<wcs-layout>` expands its template through a Trusted Types policy named `wcstack`, so the CSP needs `trusted-types wcstack;` (or your own policy, injected as described in [docs/csp.md](../../docs/csp.md) section 7)

#### Loading data before a route commits

A guard is already the one asynchronous step that runs *before* the route content is swapped in. Return an **object** from it and the router commits that object as `<wcs-router>.data` together with the params — so the page never shows the new route with empty content, and a `<wcs-view-transition>` animates real content instead of a blank frame.

```html
<wcs-router data-wcs="data: routeData; typedParams: routeParams">
  <wcs-route path="/users/:id(int)" name="user" guard="/users">
    <wcs-guard-handler>
      <script type="module">
        export default async function (toPath, fromPath, { typedParams }) {
          const res = await fetch(`/api/users/${typedParams.id}`);
          if (res.status === 404) return "/users";          // dynamic redirect
          if (!res.ok) return false;                          // → guard="/users"
          return { user: await res.json() };                  // loaded: enter the route
        }
      </script>
    </wcs-guard-handler>
    <h1 data-wcs="textContent: routeData.user.name"></h1>
  </wcs-route>
</wcs-router>
```

- `data` is `null` on every navigation whose guards return no object, so a page can gate on it (`<template data-wcs="if: routeData">`).
- Nested routes: each guard may return an object; they are shallow-merged parent → child into one `data`.
- A query-only navigation (same-match) does not re-run guards and keeps `data`.
- The router does not cache. Navigating to the same route with other params loads again; keep anything you want to reuse in your own state.
- Under SSR the same rule as every guard applies: a route chain with a guard is not rendered on the server, so `data` is always produced on the client.

#### Typed Parameters

By specifying types for path parameters, you can perform value validation and automatic conversion.

**Syntax**: `:paramName(typeName)`

```html
<!-- Integer parameter -->
<wcs-route path="/users/:userId(int)">
  <user-detail></user-detail>
</wcs-route>

<!-- Complex parameters -->
<wcs-route path="/posts/:date(isoDate)/:slug(slug)">
  <post-detail></post-detail>
</wcs-route>
```

**Built-in Types**:

| Type Name | Description | Example | Converted Type |
|------|------|------|------|
| `int` | Integer | `123`, `-45` | `number` |
| `float` | Floating point number | `3.14`, `-2.5` | `number` |
| `bool` | Boolean | `true`, `false`, `0`, `1` | `boolean` |
| `uuid` | UUID v1-5 | `550e8400-e29b-41d4-a716-446655440000` | `string` |
| `slug` | Slug (lowercase alphanumeric and hyphens) | `my-post-title` | `string` |
| `isoDate` | ISO 8601 Date | `2024-01-23` | `Date` |
| `any` | Any string (default) | Any | `string` |

**Retrieving Values**:

The match result is exposed on the `<wcs-router>` element (the route elements themselves are detached controllers and cannot be queried from the live DOM):

```html
<!-- Declarative: bind the parsed result straight into state -->
<wcs-router data-wcs="typedParams: routeParams"></wcs-router>
```

```javascript
// Imperative: read from the router element
const router = document.querySelector('wcs-router');
console.log(router.params.userId);       // "123"
console.log(router.typedParams.userId);  // 123 (number)
```

**Behavior**:
- If the value does not match the type, the route will not match (it does not result in an error).
- If no type is specified, it is treated as `any` (same as previous behavior).
- Specifying an unknown type name also falls back to `any`.

### Layout (wcs-layout)

Loads a template, inserts children into `<slot>`, and writes to `<wcs-layout-outlet>`. Light DOM supported. External file supported.

The template needs a default `<slot>` (one without `name`) for what the layout holds outside its named slots — the routes nested in it and their pages. Without one they are not shown, and the outlet warns `[wcs/layout-slot-missing]` (`wcs-validate` reports it too). A `<wcs-outlet>` does not go in the template: no router uses it (`[wcs/router-outlet-misplaced]`); the nested routes fill the default slot.

With @wcstack/state, the outlet hands the elements it places — and with them the `data-wcs` / `{{ }}` inside elements of the layout template and of the route content in its slots — to state's binder once they are in the page (the template loads asynchronously), so both are bound on the very first navigation into the layout, not only on the landing route. Only elements are handed over: a `{{ }}` in text directly under the layout template (not inside an element) is not bound on a navigation — wrap it in an element, as for a route body (see "Where route content lives"). With `enable-shadow-root`, the template lives in the outlet's shadow root, which the page's state does not bind (the route content in the light DOM is bound). The outlet hands its content over the way the router hands over a route body, declaring the range (`bind(subtree, { range: true })`), so with **@wcstack/state 4.0** a `for:` / `if:` template at the top of the layout template renders as well — on the landing route and on navigation — and its rows or branch leave and come back with the route; @wcstack/state 3.x does not render it on a navigation (wrap it in an element there, as for a route body).

| Attribute | Description |
|------|------|
| `layout` | The id attribute of the template tag used as the template. |
| `src` | URL of an external template file. |
| `name` | Identifier passed to `wcs-layout-outlet`. |
| `enable-shadow-root` | Use Shadow DOM in `<wcs-layout-outlet>`. |
| `disable-shadow-root` | Use Light DOM in `<wcs-layout-outlet>`. |

### Outlet (wcs-outlet)

Displays a DOM tree according to the routing and layout settings. **Place it right after its `<wcs-router>`** (whitespace, text and comments may sit between them; another element may not), or leave it out and the router creates one there. A router uses only the element right after it: a `<wcs-outlet>` anywhere else — inside `<main>` while the router sits at the top of `<body>`, or inside the router — stays empty while the routes render right after the router. The router warns about such an outlet at runtime, and `wcs-validate` reports it, as `[wcs/router-outlet-misplaced]`. Why the rule is what it is: [docs/router-outlet-placement.md](../../docs/router-outlet-placement.md).

```html
<main>
  <wcs-router><template>…</template></wcs-router>
  <wcs-outlet></wcs-outlet>
  <aside>…</aside>
</main>
```

### LayoutOutlet (wcs-layout-outlet)

Displays a DOM tree into `<wcs-outlet>` according to the layout (`<wcs-layout>`) settings. Inherits the name attribute from `<wcs-layout>`. Use the name attribute to identify styling targets.

| Attribute | Description |
|------|------|
| `name` | The name attribute of `<wcs-layout>`. Use it to identify styling targets. |

#### Light DOM Limitations

When utilizing `disable-shadow-root` (Light DOM), slot replacement targets **only direct children** of `<wcs-layout>`. Elements with `slot` attributes inside `<wcs-route>` will not be placed in the slot.

```html
<!-- NG: <div slot="header"> is not a direct child of wcs-layout, so it doesn't go into the slot -->
<wcs-layout layout="main" disable-shadow-root>
  <wcs-route path="/page">
    <div slot="header">Header Content</div>
  </wcs-route>
</wcs-layout>

<!-- OK: Make the element with slot attribute a direct child of wcs-layout -->
<wcs-layout layout="main" disable-shadow-root>
  <div slot="header">Header Content</div>
  <wcs-route path="/page">
    <!-- Page content -->
  </wcs-route>
</wcs-layout>
```

In the case of `enable-shadow-root` (Shadow DOM), this limitation does not apply because the native `<slot>` function is used.

### Head (wcs-head)

Manages document `<head>` elements per route. Uses a stack-based system where the most recently connected Head is prioritized.

```html
<wcs-route path="/about">
  <wcs-head>
    <title>About Us</title>
    <meta name="description" content="About our company">
  </wcs-head>
  <about-page></about-page>
</wcs-route>
```

**Supported elements**: `<title>`, `<meta>`, `<link>`, `<base>`, `<script>`, `<style>`

**Behavior**:
- Captures the initial `<head>` state on first connection
- When multiple `<wcs-head>` elements are active, the last connected one takes priority
- When all `<wcs-head>` elements disconnect, the initial state is restored
- Elements are identified by key (e.g., `<meta>` by `name`/`property`/`http-equiv`, `<link>` by `rel`/`href`)

### Link (wcs-link)

Link. Converted to an `<a>`, and the route path in the `to` attribute is converted to a URL. When the link path matches the current URL, the `active` CSS class is automatically added to the generated `<a>` element.

| Attribute | Description |
|------|------|
| `to` | Destination path or URL. Paths starting with `/` are treated as internal paths (basename is prepended to the pathname; a `?query` / `#hash` suffix is kept as-is). A value starting with `?` is a **query-only** link: the href is assembled as "current pathname + that query" and tracks location changes. Other values are treated as external URLs. While `to` is empty — bound with `attr.to:` and not written yet, as when the router loads before state — the `<a>` has no `href` and is never active; it takes the `to` when it arrives. |
| `match` | `exact` (default) or `prefix`. With `prefix` the link is also active on the paths under it — a side navigation's "Products" on `/products/3` — with `aria-current="true"` there (`"page"` on the path itself). A link to a path under it is marked as well: on `/products/new`, a `prefix` "Products" and a "New product" are both active, with `aria-current="true"` and `"page"`; to show one mark, style `[aria-current="page"]`. Since 4.11 (not released yet), a `prefix` link with a query is also active (`"true"`) where the URL's query has the link's parameters and more. |

**Active state**: The generated `<a>` receives the `active` class when its path matches the current location, and `aria-current="page"` alongside it — the same fact, expressed in ARIA, so screen readers announce the current page in navigation. A `to` without a query compares the **pathname only** — the page's query does not matter, so `to="/products"` stays active on `/products?page=2`. Since 4.10, a `to` with a query compares the query too: `to="?q=a&page=2"` ("Next page") is not the current page on `/search?q=a`, and is on `/search?q=a&page=2`. Since 4.11 (not released yet), it is the current page only when the URL's query equals `to`'s — the same parameters with the same values, in any order: a page-1 link that leaves `page` out (`to="?q=a"`, the clean URL of a new search) is not the current page on `/search?q=a&page=2`. 4.10 allowed parameters the link does not name, so that link was the current page on every page. A repeated key (`?tag=a&tag=b`) needs the same set of values, in any order, and values are compared decoded (`+` and `%20` are the same). With `match="prefix"`, a link with a query is also active, with `aria-current="true"`, where the URL's query has its parameters and more — a facet link `to="?type=book"` on `?type=book&sort=-year` — as it is on the paths under it (with its parameters there too). Up to 4.9 the query was ignored on both sides, so every pagination link on a page was its "current page" and a screen reader read "Next page, current page". Tracking is updated on navigation events (`currententrychange`, `wcs:navigate`, `popstate`), query-only navigations included.

```css
/* Style active links */
a.active { font-weight: bold; color: blue; }
```

**Attribute forwarding**: when the `<a>` is generated, all `aria-*` attributes plus seven fixed names (`title`, `rel`, `target`, `download`, `hreflang`, `lang`, `dir`) are copied from the host to the anchor (`lang` / `dir` matter to screen readers — they set the announcement language and direction of the link text). `to`, `style`, and `class` are never forwarded (the host is `display:none`, and `class` carries the `active` contract). After connection, only the seven fixed names keep tracking changes; **an `aria-*` value is copied once, when the anchor is created**, and a later change never reaches the anchor. With a `data-wcs` binding (`<wcs-link data-wcs="attr.aria-label: ...">`) it depends on when the value is written: a `<wcs-link>` in a `for:` row or an `if:` branch is bound before it is connected, so its first value is on the host when the anchor is created and is copied — but a later change of that value is not; a `<wcs-link>` in the page markup may have its anchor before state binds it, and then the value never arrives. Write `aria-*` that does not change as static attributes, and give a link a name that changes through its content: the host's children are moved into the anchor, so a bound `<span data-wcs="textContent: …">` inside `<wcs-link>` keeps updating.

**Plain `<a>` note**: in browsers with the Navigation API, a plain `<a href="/about">` under the basename also becomes an SPA navigation (the router intercepts it). This does not hold in fallback browsers, where only `<wcs-link>`'s click handler provides SPA navigation — so `<wcs-link>` remains the recommendation. Since 4.10, a plain `<a href="#main">` (a bare fragment) is never a route change: it moves within the current page, on both paths — see [In-page links](#in-page-links-skip-links).

**Reload note**: since 4.7, a reload the page asks for — `location.reload()`, `history.go(0)`, `navigation.reload()` — reloads the document, and with `leaveConfirm` set it gets the browser's own prompt. Up to 4.6 the router took it as a route change in the same document, so an "update available — reload" button or a service worker's update flow did nothing. Every other navigation under the basename, `location.replace(location.href)` included, stays an SPA navigation.

## Auto-Binding (`data-bind`)

Two mechanisms deliver route params, with different destinations:

| You want params… | Use |
|------|------|
| …in state (reactive rendering, derived values) | Bind `typedParams` / `params` on `<wcs-router>` — see "State binding (wc-bindable)" |
| …directly on elements inside the route (pages without state, generic components) | `data-bind` below |

Elements with the `data-bind` attribute automatically receive matched route parameters. Four binding modes are available:

| `data-bind` value | Target | Description |
|------|------|------|
| `"props"` | `element.props` | Merges params into the `props` property |
| `"states"` | `element.states` | Merges params into the `states` property |
| `"attr"` | HTML attributes | Sets params as HTML attributes via `setAttribute()` |
| `""` (empty) | Direct properties | Sets params directly on the element (e.g., `element.id = value`) |

```html
<wcs-route path="/users/:userId(int)">
  <!-- element.props = { userId: 123 } -->
  <user-detail data-bind="props"></user-detail>

  <!-- element.setAttribute("userId", 123) -->
  <div data-bind="attr"></div>
</wcs-route>
```

For elements that are already defined (built-in elements and custom elements defined before the route renders), parameters are assigned before `connectedCallback` fires. For custom elements that are not yet defined, assignment is deferred until `customElements.whenDefined()` resolves — that happens *after* the upgrade, so the `connectedCallback` run by the upgrade does not see the parameters yet. Read them in the `props` / `states` / attribute setter (or in `attributeChangedCallback`) instead, or make sure the element is defined before the route is rendered (e.g. load its script before `@wcstack/router`). A navigation that changes only a parameter (`/users/1` → `/users/2`) takes the route's content out and puts it back in place, so `connectedCallback` runs again — once, in a nested route too — and sees the new parameters.

## Configuration

Initialize the router with optional configuration via `bootstrapRouter()`:

```javascript
import { bootstrapRouter } from '@wcstack/router';

bootstrapRouter({
  // Custom tag names (all optional)
  tagNames: {
    router: 'wcs-router',       // default
    route: 'wcs-route',         // default
    outlet: 'wcs-outlet',       // default
    layout: 'wcs-layout',       // default
    layoutOutlet: 'wcs-layout-outlet', // default
    link: 'wcs-link',           // default
    head: 'wcs-head'            // default
  },
  // Use Shadow DOM for outlets (default: false)
  enableShadowRoot: false,
  // File extensions stripped from basename (default: [".html"])
  basenameFileExtensions: [".html"]
});
```

`bootstrapRouter()` throws on an option it does not have, on a value whose type differs from the option's default (`null`, or an array where an object is expected, included), and on a `tagNames` key it does not define or a tag name that is not a string. It checks every option before applying any, so nothing is applied when it throws. An option whose value is `undefined` is skipped.

## Route transition animations

Route swaps are a plain `removeChild` / `insertBefore` pair, so the outgoing view cannot animate out on its own. Adding [`@wcstack/view-transition`](https://github.com/wcstack/wcstack/tree/main/packages/view-transition) to the page makes the swap run inside a View Transition, which you then style in CSS:

```html
<script type="module" src="https://esm.run/@wcstack/view-transition/auto"></script>
<wcs-view-transition for="router"></wcs-view-transition>

<style>
  ::view-transition-old(root) { animation: fade-out 0.2s both; }
  ::view-transition-new(root) { animation: fade-in 0.2s both; }
</style>
```

The router runs its guards first and hands only the hide/show pair to the transition, so a guard that awaits does not hold the transition open. The first route application — the one that paints the page on load — is always synchronous: there is no previous route to animate against, and an entrance is `@starting-style`'s job. Without the tag nothing changes at all; the swap stays synchronous. See [docs/view-transition-design.md](https://github.com/wcstack/wcstack/blob/main/docs/view-transition-design.md) §7.1.

## Server-side rendering (SSR)

`<wcs-router enable-ssr>` opts the router into [`@wcstack/server`](https://github.com/wcstack/wcstack/tree/main/packages/server)'s SSR: `renderToString({ url })` renders the initial route of the request URL on the server, and the client-side router **adopts** the server-rendered DOM on boot instead of re-rendering it — state bindings hydrated on those nodes stay live. Without the attribute the router never initializes on the server and the page renders client-side as usual (partial CSR).

- If the server output does not verify against the current URL and route definitions, the client silently falls back to normal client-side rendering.
- Guarded routes are never rendered on the server — a guard is an authorization point and runs client-side; the outlet is served empty.
- Routes using `<wcs-layout>` are rendered on the server but not adopted: the client renders the route again, so the server's nodes are replaced — what a reader typed into them before the client loaded is lost.
- `<wcs-link>` renders its anchor on the server (with `active` / `aria-current`) and adopts it on the client — in a `for:` row or an `if:` branch too.
- `<wcs-head>` keeps its children on the server (the output is the body only, so the server's `<head>` is not in it): the client applies them to `document.head` when it adopts the route. Write the `<title>` and description a crawler should see in the HTML you wrap the output in.

See the `@wcstack/server` README for the server-side setup and [docs/ssr-router-design.md](https://github.com/wcstack/wcstack/blob/main/docs/ssr-router-design.md) (ja) for the design.

## Accessibility contract

The router delegates scroll and focus handling to the browser wherever the platform already does the right thing.

**Navigation API path** (Chromium and other supporting browsers): the router calls `event.intercept()` with the spec defaults written out explicitly — `scroll: "after-transition"` and `focusReset: "after-transition"`:

- a push navigation scrolls to the top; a traverse (back/forward) restores the previous scroll position;
- after the transition, focus moves to the first `[autofocus]` element of the new content, or to `<body>` when there is none.

These are the specification defaults; writing them out records the delegation as intent. Changing either to `"manual"` is a change to this contract, not a refactor.

**Fallback path** (browsers without the Navigation API): navigation runs through `history.pushState` plus a `popstate` listener. After a committed push navigation the router scrolls to the top, matching the Navigation API default; a navigation rejected by a route guard does not scroll. Back/forward scroll restoration is the browser's `history.scrollRestoration` (default `auto`), so the router never scrolls on `popstate`.

**Opt-in policies** — `<wcs-router focus="heading" announce="title">`. Both default to off; with no attribute, the browser behavior above is all there is. Both run right after a committed navigation, never on the first route application (page load belongs to the browser), and never on a guard-rejected navigation.

- `focus="heading"`: moves focus to the first **visible** `h1`–`h6` of the **leaf** route's inserted content, adding `tabindex="-1"` when the heading has none (hidden headings — `hidden`, `display:none` — are skipped, since focusing them is a no-op). While set, the router passes `focusReset: "manual"` on the Navigation API path so the browser's reset does not double-handle. If the new content has no visible heading, the router reproduces the spec-default reset itself: focus moves to the first `[autofocus]` element, or to `<body>` when there is none — the previously focused element (say, a persistent nav link) would otherwise keep focus on the old screen. Still: give every route a heading when you opt in, and put it near the top of the route content — focusing a heading scrolls it into view, but the scroll-to-top that follows a push navigation wins, so a heading far down the page ends up focused off-screen. Only the exact value `"heading"` activates the policy; an empty or unknown value falls back to the browser default.
- `announce="title"`: writes the commit-time `document.title` snapshot into a router-owned live region (`role="status"`, visually clipped, direct child of `<wcs-router>`, one per router). Known limits: a bound title (`<title data-wcs>`) may still be stale at commit, a title change outside navigation is not re-announced, and navigating between routes that share the same title may not be re-announced by some screen reader / browser combinations (the live region text does not change).

See [docs/a11y-design.md](https://github.com/wcstack/wcstack/blob/main/docs/a11y-design.md) §3 for the design record.

### In-page links (skip links)

Since 4.10, a link whose `href` as written is a bare fragment — a skip link, `<a href="#main">`, and `href="#"` for the top of the page — moves within the current page, and is never a route change:

```html
<head><base href="/"></head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <wcs-router>
    <template>
      <wcs-route path="/search"><main id="main">…</main></wcs-route>
      …
    </template>
  </wcs-router>
```

- The URL becomes the current path and query plus that hash (`/search?q=a#main`), with a history entry as any fragment link makes (the same fragment again replaces it). The browser scrolls to the target — the element with that `id`, or an `<a name>` — and the router moves focus to it, adding `tabindex="-1"` when it does not take focus itself, as `focus="heading"` does. `#` and `#top` scroll to the top and leave focus where it is.
- Nothing about the route changes: no guard runs, nothing is rendered again, `leaveConfirm` does not ask. Back / Forward between the two entries are fragment navigations as well — the route stays and the browser restores the scroll position.
- Why: under `<base href="/">`, which every SPA has, `#main` resolves to `/#main`. Up to 4.9 a skip link on `/search?q=a` therefore took the reader to the home route (under `<base href="/ja/">`, to `/ja/`).
- It works on both paths. With the Navigation API the router reads the link from the `navigate` event (`sourceElement`, which current Chromium, Firefox and Safari give); without it, or where the event has no `sourceElement`, it listens for the click on `window`, after the page's own listeners — a click the page cancelled is left alone.
- Unchanged: a click with a modifier (Ctrl / ⌘ / Shift / Alt) or the middle button, a link with a `target` other than `_self` or with `download`, a link to another page's fragment (`/faq#x`, `?q=b#x`), and a page outside every router's `basename`.

### What the router leaves to the page

- **A message meant to be heard after a navigation does not belong in the route content.** The route content is inserted together with its text, so a `role="status"` / `aria-live` region in it arrives with its message already there, and a screen reader announces changes to a region it already knows: the message is never read. With `<wcs-view-transition>`, even a region filled from a response after the route was placed can be inserted with its text (the swap runs inside the transition). Keep one region for the page, outside the router and its `<wcs-outlet>`; empty it when a navigation commits (a `$watch` on the router's `path`), and write the new page's sentence after that, when the page has it. For the page title, `announce="title"` does this already, in the router's own region.

  ```html
  <wcs-router data-wcs="path: route"><template>…</template></wcs-router>
  <wcs-outlet></wcs-outlet>
  <p class="visually-hidden" role="status" data-wcs="textContent: status"></p>
  ```

  ```js
  $eventTokens: ["results"],
  $watch: {
    route() { this.status = ""; },              // a navigation empties it…
  },
  $on: {
    results(state, event) {                     // …and the new page writes when it has something to say
      state.status = `${event.detail.value.length} books found`;
    },
  },
  ```

- **Focus after a dialog closes.** A modal `<dialog>` gives focus back to the element that opened it when it closes. When that element is gone — the dialog deleted the row whose button opened it — focus falls to `<body>`, and a keyboard or screen-reader user starts again from the top of the page. Move it yourself after such a removal, to the list or its heading: `<h2 tabindex="-1" data-wcs="command.focus: $command.focusList">` and `this.$command.focusList.emit()` once the row is gone (a native element's `command.` methods come with the `native-commands` add-on, in the full entries).

## Path Specification (Router / Route / Link)

### Terminology

* **URL Pathname**: `location.pathname` (e.g. `/app/products/42`)
* **basename**: The app mount path (e.g. `/app`)
* **internalPath**: The routing path inside the app after removing basename (e.g. `/products/42`)

---

## 1) basename specification

### 1.1 basename resolution order

1. The `basename` attribute on `<wcs-router basename="/app">`
2. If `<base href="/app/">` exists, derive from `new URL(document.baseURI).pathname`
3. If neither exists, `document.baseURI` is the current document URL, so the basename is still derived from `location.pathname`. It becomes **empty string** `""` only when the document itself was loaded at the root — a direct load of `/products/3` yields the basename `/products/3`, so an app that must survive deep links needs `<base href="/">` or an explicit `basename` attribute. When the basename is derived this way and is not empty, the router warns `[wcs/base-href-missing]` (the code `wcs-validate` reports from the markup)

### 1.2 basename normalization (important)

basename is always normalized as follows:

* Add leading `/` (except empty string)
* Collapse multiple slashes into one
* Remove trailing `/` (except `/` itself, which is treated as empty)
* Treat `.../index.html` or `.../*.html` as files and remove them
* If the result is `/`, basename becomes `""`

Examples:

* `"/"` → `""`
* `"/app/"` → `"/app"`
* `"/app/index.html"` → `"/app"`

### 1.3 basename and direct links

* If basename is `""`, no `<base>` exists, and the initial `pathname !== "/"`, it is **an error**
* If basename is `"/app"`:

	* `"/app"` and `"/app/"` are **the same** (app root)
	* `"/app"` matches only `"/app"` or `"/app/..."` (does not match `"/appX"`)

### 1.4 basename as the locale segment (multilingual sites)

For a site served at `/en/…` and `/ja/…`, put the locale **in the basename**,
not in a route pattern. Write `<base href="/ja/">` from a synchronous `<head>`
script once the locale is known, and the router picks it up through resolution
order 1.2.

This is not a stylistic preference — a `/:lang` route parameter breaks the
language switch:

> `<wcs-router>` hands **every** same-origin navigation under its basename to
> `intercept()`, plain `<a>` clicks included. With the locale inside the
> basename, a link to another language is handled client-side: the page never
> reloads, so anything the app loaded per-locale (a dictionary module, `Intl`
> formatters) is never re-evaluated and **the language silently does not
> change** — no error, nothing visibly broken.

With basename `/ja`, a link to `/en/orders` falls outside `_isOwnPath`, the
router declines to intercept, and the browser performs a real navigation. The
"just a link" language switch works *because* of the basename.

It also leaves the page, so with `leaveConfirm` set it asks first — and the page
cannot tell whether the reader accepted: a click listener runs before the
question, and a declined switch stays on the page in the old language. Record
the chosen language on the next page, not on the click: mark it in
`sessionStorage` on click, and let the next page's head script commit it (to
`localStorage`) when the URL carries that language, and drop the mark otherwise.

Two consequences worth having:

* **Route patterns carry no locale** — `path="/"`, `path="/about"`. In-app links
  stay locale-free too (`<wcs-link to="/about">` prepends the basename).
* **Every URL on the page must be absolute**, since `<base>` now changes what
  relative URLs resolve against. A link to a bare fragment (`href="#main"`) is
  the exception since 4.10: the router keeps it on the current page
  ([In-page links](#in-page-links-skip-links)). Inline-SVG fragment references
  (`url(#gradient)`, `clip-path`) are not links, and still resolve against the base.

Repairing a URL that carries no locale, or an unknown one, belongs in that same
head script (`location.replace`) rather than a route guard: a guard's redirect
target is the static `guard="…"` attribute, so it cannot preserve the rest of
the path. Doing it before the DOM is parsed also wastes no render and no fetch.

See [`examples/router-i18n`](../../examples/router-i18n/) for the whole shape,
and [docs/i18n-design.md](../../docs/i18n-design.md) for why the dictionary is
an ES module rather than reactive state.

---

## 2) internalPath specification

### 2.1 internalPath normalization

internalPath is always treated as an **absolute path**.

* Add leading `/`
* Collapse multiple slashes
* Remove trailing `/` (except root `/`)
* If empty, become `/`
* In Router normalization, remove trailing `*.html` when present

Examples:

* `""` → `/`
* `"products"` → `/products`
* `"/products/"` → `/products`
* `"///a//b/"` → `/a/b`

### 2.2 Get internalPath from URL

Obtain `internalPath` by matching `URL Pathname` with `basename`.

* If `pathname === basename`, then `internalPath = "/"`
* If `pathname` starts with `basename + "/"`, then `internalPath = pathname.slice(basename.length)`
* Otherwise `internalPath = pathname`
* If the slice result is `""`, then `internalPath = "/"`

Examples (basename=`/app`):

* pathname=`/app` → internalPath=`/`
* pathname=`/app/` → internalPath=`/`
* pathname=`/app/products/42` → internalPath=`/products/42`

---

## 3) `<wcs-route path="...">` specification

### 3.1 path notation

`path` follows **internalPath rules**.

* Root (top-level) is `"/"`
* Child routes allow **relative** paths (recommended)

	* Example: parent `/products`, child `":id"` → `/products/:id`

> In implementation, paths are converted to absolute during parsing.

### 3.2 Matching rules

* **Exact match** by segment
* Parameter `:id` matches a single segment
* Catch-all `*` matches the remaining path (accessible via `params['*']`)

### 3.3 Priority (longest match definition)

If multiple candidates exist, pick the higher priority:

1. **More segments**
2. If same, **more static segments** (`"users"` > `":id"` > `"*"`)
3. If still same, **definition order**

> Catch-all `*` has the lowest priority, so more specific routes always take precedence.

Example:

* `/admin/users/:id` (static2 + param1)
* `/admin/users/profile` (static3)
	→ latter wins

### 3.4 Trailing slash

* Matching is done after internal normalization, so

	* `/products` and `/products/` are treated the same (either URL is OK)

### 3.5 Catch-all (`*`)

Specify `*` at the end of a path to match the entire remaining path.

```html
<wcs-route path="/admin/profile"></wcs-route>  <!-- Priority -->
<wcs-route path="/admin/*"></wcs-route>        <!-- Fallback for /admin/xxx -->
<wcs-route path="/*"></wcs-route>              <!-- Last resort -->
```

| Path | Match | Reason |
|------|-------|--------|
| `/admin/profile` | `/admin/profile` | More segments |
| `/admin/setting` | `/admin/*` | `*` matches `setting` |
| `/admin/a/b/c` | `/admin/*` | `*` matches `a/b/c` |
| `/other` | `/*` | Top-level catch-all |

The matched remaining path is accessible via `params['*']`.

---

## 4) `<wcs-link to="...">` specification

### 4.1 When `to` starts with `/`

`to` is treated as **internalPath**.

* The actual `href` is created by joining `basename + internalPath`
* Join: `"/app" + "/products"` → `"/app/products"` (no `//`)

### 4.2 When `to` does not start with `/`

Treated as an external URL (`new URL(to)` is expected to succeed).

* Example: `https://example.com/`

---

## 5) “Drop HTML files” is limited

Dropping `.html` only applies when the pathname **actually looks like a file**.

* `"/app/index.html"` → `"/app"` (OK)
* `"/products"` → `"/"` is **NG** (do not drop segments)
