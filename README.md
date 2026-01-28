# wcstack
Web Components Stack

Web Components Stack provides a set of tools for building applications with Web Components.

## Concept
We leverage Web Components standards to make everyday development easy to write, easy to read, and hard to break.
The design minimizes setup and dependencies so it can be adopted with minimal effort.

## Why wcstack exists
- **Longevity through standards**: Reduce framework lock-in and rely on browser-native primitives.
- **Declarative structure**: Keep UI structure and behavior readable and reviewable in HTML.
- **Minimal but complete foundation**: Provide routing and autoloading without heavy runtime costs.
- **Low operational overhead**: Minimize build/config complexity to ease onboarding and migration.

## Recommended for
- Developers who want to use Web Components in production quickly
- Teams who prioritize developer experience over configuration
- Projects that want a declarative and consistent API

## What you can expect
- App foundations like routing and layout out of the box
- Clear naming and structure that scale well in teams

## Design philosophy (overall)
- **Standards first**: Favor Custom Elements, Shadow DOM, ES Modules, and Import Maps.
- **Declarative and readable structure**: The HTML structure should express application intent.
- **Zero-config & buildless**: Make onboarding fast and reduce operational overhead.
- **Minimal dependencies**: No runtime dependencies to keep risk and maintenance low.
- **Low learning cost**: Build on familiar Web standards.
- **Predictable and resilient behavior**: Prefer explicit behavior over hidden magic.

## Architecture highlights
- **Autoloader**
	- Automatically loads components just by writing the tag in HTML.
	- Uses import maps to map namespaces to file locations, reducing ambiguity.
	- Supports both lazy and eager loading for a balanced startup and scalability.
	- Tracks DOM changes to load only what is necessary.
	- Details: [Autoloader](packages/autoloader/README.md)
- **Router**
	- Declarative routing via custom elements like `<wcs-router>` and `<wcs-route>`.
	- Treats layouts and outlets as standard DOM structure for clearer UI composition.
	- Prefers the Navigation API with `popstate` fallback for unsupported browsers.
	- Strict path normalization and route ordering for unambiguous matching.
	- Details: [Router](packages/router/README.md)

## Quality focus
- Each package is designed with tests and type definitions as a baseline.
- Linting and testing are standardized to prevent quality regressions at scale.

## Best fit
- Web Components apps that want minimal build steps
- Teams that value declarative, readable structure
- Small to mid-sized SPAs that benefit from lightweight composition
