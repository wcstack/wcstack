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
| `path` | For top-level routes, specify an absolute path starting with `/`. Otherwise, specify a relative path. For parameters, use `:paramName`. Top-level routes cannot use relative paths. |
| `index` | Inherits the upper path. |
| `fallback` | Displayed when no route matches the path. |
| `fullpath` | Path including parent routes (read-only). |
| `name` | Identifier. |
| `guard` | Enables guard handling. Specify the full path to navigate to on guard cancellation. |

| Property | Description |
|------|------|
| `guardHandler` | Sets the guard decision function. |

Guard decision function type:
function (toPath: string, fromPath: string): boolean | Promise<boolean>

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

### Link (wcs-link)

Link. Converted to an `<a>`, and the route path in the `to` attribute is converted to a URL.

| Attribute | Description |
|------|------|
| `to` | Destination absolute route path. |
