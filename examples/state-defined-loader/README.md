# defined loader gate demo

`@wcstack/state` + `@wcstack/defined` (`<wcs-defined>`). A readiness gate for lazily-loaded Web Components: show a spinner while components register, the real UI once they are ready, and a **load-failure fallback** when one never arrives.

## Getting Started

Open `index.html` in a browser (any static server, or just the file). No build step — everything loads from `esm.run`.

The demo simulates lazy loading: `demo-chart` "imports" successfully after ~1.2s, while `demo-table` is intentionally never registered, so it times out into `missing`. Click **Retry** to register it late and watch the gate complete.

## Features

- **`<wcs-defined tags="demo-chart,demo-table" timeout="3000">` watches** `customElements.whenDefined()` for both tags and reports `defined` / `pending` / `missing` / `count` / `total` / `error` as state. It is read-only: no commands.
- **Readiness gate with `data-wcs="hidden: ready|not"`**: the gated section appears only once every watched tag is registered (`mode="all"` default). The `|not` filter inverts `ready`, so the section is `hidden` while `ready` is false and shown once it flips true.
- **Timeout failure detection**: after 3s, any still-pending tag drops into `missing` — surfaced as a red "load failed" banner. CSS `:not(:defined)` cannot do this; it would hide the component forever.
- **Progress bar** driven by `count / total`.
- **Late promotion**: clicking Retry registers `demo-table`, which moves it out of `missing` back into the ready count, and the gate opens.

## Key Points

- **CSS `:defined` vs `<wcs-defined>`.** For pure flash-of-unstyled-content avoidance, CSS `:not(:defined)` is enough. This element earns its keep with **timeout-based failure detection**, multi-tag aggregation (`all` / `any`), and exposing readiness as reactive state you can branch on.
- **Companion to the autoloader.** In a real app the watched tags come from an Import Map + `@wcstack/autoloader` (`@components/` prefix). A failed dynamic import leaves `whenDefined` pending forever; the `timeout` turns that hang into observable `missing` state.
- **event-token only.** `<wcs-defined>` is a one-way element → state monitor — there is no command to "define" a tag, only observation, so it has no command-token surface.
