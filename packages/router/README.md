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

## Reference

### Router (wcs-router)

Define routes and layout slots inside a child template tag. A direct child template tag is required. Outputs according to definitions to `<wcs-outlet>`. Multiple routers can coexist in the same document when each has a distinct `basename`.

| Attribute | Description |
|------|------|
| `basename` | When routing in a subfolder URL, specify the subfolder. Not required if you don’t run in a subfolder. |
| `focus` | Opt-in focus policy applied after a committed navigation. `"heading"` focuses the first heading of the leaf route's content. See "Accessibility contract". |
| `announce` | Opt-in route announcement. `"title"` writes the commit-time `document.title` snapshot into the router-owned live region. See "Accessibility contract". |

#### State binding (wc-bindable)

`<wcs-router>` is the live-DOM element that exposes the whole navigation state over the wc-bindable protocol, so `@wcstack/state` (or any binding core) wires it with a single `data-wcs`:

```html
<wcs-router data-wcs="path: path; typedParams: routeParams; searchParams: query;
                      routeName: routeName; navigateUrl: navigateUrl; replaceUrl: replaceUrl">
```

| Member | Direction | Description |
|------|------|------|
| `path` | output only | Current route path (basename already sliced). Fires `wcs-router:path-changed`. |
| `params` | output only | Merged params of the matched route chain, as strings (`Record<string, string>`). `{}` on a fallback match or before initialization. |
| `typedParams` | output only | The same params, type-converted (`:id(int)` → `number`). Shares `wcs-router:params-changed` with `params` (the event detail is `{ params, typedParams }`). |
| `searchParams` | output only | Current URL query as `Record<string, string>`. Duplicate keys (`?tag=a&tag=b`) are **last-wins**; values are decoded by `URLSearchParams` (including `+` → space). `{}` when there is no query. Fires `wcs-router:search-changed`. |
| `routeName` | output only | `name` attribute of the deepest matched route. On a fallback match, the fallback route's `name` (so a 404 view can key off `routeName` too). `""` when unnamed or before initialization. Fires `wcs-router:route-name-changed`. |
| `navigateUrl` | write surface (null-idle transient) | Write a target to push-navigate. `null` means idle; writing a string starts `navigate()`, and the property resets itself to `null` when the navigation finishes. `null` / `""` writes are no-ops. |
| `replaceUrl` | write surface (null-idle transient) | Identical contract to `navigateUrl`, but the navigation **replaces** the current history entry. |
| `basename` | input | Mirrors the `basename` attribute. |

Commands `navigate(path)` and `replace(path)` (both async) are also declared, so they can be invoked through the command-token protocol.

Output-only members are **read** when a binding attaches and streamed through their change events afterwards — the value is read, not awaited, so a binding that attaches after the router already resolved its first route misses nothing.

**Firing contract**: on a committed navigation the router commits *all* internal values first and only then fires events, in the order `params-changed` → `route-name-changed` → `search-changed` → `path-changed`, each only when its value actually changed. Any listener that reads the element's properties sees the consistent post-navigation snapshot; `path` fires last and doubles as the "navigation finished" signal. A guard-rejected navigation updates nothing and fires nothing.

The exposed objects are **frozen snapshots** owned by the router: a new object per navigation, never mutated in place. Mutating them throws — copy into your own state instead.

**Choosing a write surface**:

- Pagination, tabs — the back button should step through them: `navigateUrl = "?page=2"`.
- Search boxes, filters — the history should not record every keystroke: `replaceUrl = "?q=" + …`, with `<wcs-debounce>` in front of high-frequency input.

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
| `path` | For top-level routes, specify an absolute path starting with `/`. Otherwise, specify a relative path. For parameters, use `:paramName`. For catch-all, use `*`. Top-level routes cannot use relative paths. |
| `index` | Inherits the upper path. |
| `fallback` | Displayed when no route matches the path. |
| `fullpath` | Path including parent routes (read-only). |
| `name` | Identifier. |
| `guard` | Enables guard handling. Specify the full path to navigate to on guard cancellation. |

| Property | Description |
|------|------|
| `guardHandler` | Sets the guard decision function. |

> **Where are `params` / `typedParams`?** On `<wcs-router>` — see "State binding (wc-bindable)". After parsing, the route elements are detached controllers: they are not part of the live DOM, so they cannot be found with `querySelector` and cannot be bound with `data-wcs`. The router element is the observation surface for match results.

Guard decision function type:
`(toPath: string, fromPath: string) => boolean | Promise<boolean>`

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

- The `guard` attribute value is the redirect path when the guard cancels navigation
- If the function returns `false`, navigation is cancelled and the user is redirected to the `guard` path
- The function can return `Promise<boolean>` for async checks
- `<wcs-guard-handler>` placed outside a `<wcs-route>` is ignored
- If no `<script type="module">` is present, `guardHandler` is not set
- **Under a Content-Security-Policy**, the guard script is evaluated through a `blob:` URL, so `script-src blob:` is required. Guards are inline-only — there is no `src=` escape hatch as there is for `<wcs-state>`. See [docs/csp.md](../../docs/csp.md)

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

| Attribute | Description |
|------|------|
| `layout` | The id attribute of the template tag used as the template. |
| `src` | URL of an external template file. |
| `name` | Identifier passed to `wcs-layout-outlet`. |
| `enable-shadow-root` | Use Shadow DOM in `<wcs-layout-outlet>`. |
| `disable-shadow-root` | Use Light DOM in `<wcs-layout-outlet>`. |

### Outlet (wcs-outlet)

Displays a DOM tree according to the routing and layout settings. Define it in HTML, or if missing it is created by `<wcs-router>`.

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
| `to` | Destination path or URL. Paths starting with `/` are treated as internal paths (basename is prepended to the pathname; a `?query` / `#hash` suffix is kept as-is). A value starting with `?` is a **query-only** link: the href is assembled as "current pathname + that query" and tracks location changes. Other values are treated as external URLs. |

**Active state**: The generated `<a>` receives the `active` class when its path matches the current location, and `aria-current="page"` alongside it — the same fact, expressed in ARIA, so screen readers announce the current page in navigation. The comparison uses the **pathname only** — queries on either side never affect it (so `to="/products"` stays active on `/products?page=2`, and a query-only link is active whenever you are on its page). Tracking is updated on navigation events (`currententrychange`, `wcs:navigate`, `popstate`).

```css
/* Style active links */
a.active { font-weight: bold; color: blue; }
```

**Attribute forwarding**: when the `<a>` is generated, all `aria-*` attributes plus seven fixed names (`title`, `rel`, `target`, `download`, `hreflang`, `lang`, `dir`) are copied from the host to the anchor (`lang` / `dir` matter to screen readers — they set the announcement language and direction of the link text). `to`, `style`, and `class` are never forwarded (the host is `display:none`, and `class` carries the `active` contract). After connection, only the seven fixed names keep tracking changes; **dynamic `aria-*` changes do not reach the anchor** — this includes `data-wcs` bindings such as `<wcs-link data-wcs="attr.aria-label: ...">`, which write to the host after the copy has happened. Write `aria-*` on `<wcs-link>` as static attributes.

**Plain `<a>` note**: in browsers with the Navigation API, a plain `<a href="/about">` under the basename also becomes an SPA navigation (the router intercepts it). This does not hold in fallback browsers, where only `<wcs-link>`'s click handler provides SPA navigation — so `<wcs-link>` remains the recommendation.

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

Parameters are assigned before `connectedCallback` fires. For custom elements that are not yet defined, assignment is deferred until `customElements.whenDefined()` resolves.

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
- Routes using `<wcs-layout>` fall back to client-side rendering on adoption.
- `<wcs-link>` renders its anchor on the server (with `active` / `aria-current`) and adopts it on the client.

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
3. If neither exists, `document.baseURI` is the current document URL, so the basename is still derived from `location.pathname`. It becomes **empty string** `""` only when the document itself was loaded at the root — a direct load of `/products/3` yields the basename `/products/3`, so an app that must survive deep links needs `<base href="/">` or an explicit `basename` attribute

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

Two consequences worth having:

* **Route patterns carry no locale** — `path="/"`, `path="/about"`. In-app links
  stay locale-free too (`<wcs-link to="/about">` prepends the basename).
* **Every URL on the page must be absolute**, since `<base>` now changes what
  relative URLs resolve against.

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
