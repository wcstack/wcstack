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

					<!-- When path is "/products" -->
					<wcs-route path="products">
						<product-list></product-list>
					</wcs-route>

					<!-- When path is "/products/:productId" -->
					<wcs-route path="products/:productId">
						<!-- productItem.props.productId = productId -->
						<product-item data-bind="props"></product-item>
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

* <main-header/><main-body/><main-dashboard/><product-list/><product-item/><admin-header/><admin-body/><error-404/> are custom components in your app.
* The custom elements above must be defined separately (via an autoloader or manual registration).
