# @wcstack/router

Provides SPA routing with declarative definitions using custom elements.

## Features
* Declarative routing definitions with custom elements
* Layout definitions can be mixed into routing definitions
* Layout definitions can use slot assignment with Light DOM
* Supports the Navigation API
* Simple parameter binding support
* Global fallback support
* Zero config
* Zero dependencies
* Buildless

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
						<main-dashboard></main-dashboard>
					</wcs-route>

					<!-- When path is "/products" (relative paths below top-level) -->
					<wcs-route path="products">
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

Define routes and layout slots inside a child template tag. Only one can exist in a document. A direct child template tag is required. Outputs according to definitions to `<wcs-outlet>`.

| Attribute | Description |
|------|------|
| `basename` | When routing in a subfolder URL, specify the subfolder. Not required if you don’t run in a subfolder. |

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
| `params` | Matched parameters (strings). |
| `typedParams` | Matched parameters (converted types). |
| `guardHandler` | Sets the guard decision function. |

Guard decision function type:
function (toPath: string, fromPath: string): boolean | Promise<boolean>

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

```javascript
// Get from the route element
const route = document.querySelector('wcs-route[path="/users/:userId(int)"]');

// Get as string
console.log(route.params.userId);       // "123"

// Get as typed value
console.log(route.typedParams.userId);  // 123 (number)
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

### Link (wcs-link)

Link. Converted to an `<a>`, and the route path in the `to` attribute is converted to a URL.

| Attribute | Description |
|------|------|
| `to` | Destination absolute route path. |

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
3. If neither exists, use **empty string** `""` (assumes running at root)

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
