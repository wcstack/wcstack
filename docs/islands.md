# A page wcstack does not own

**日本語版**: [islands.ja.md](./islands.ja.md)

Most wcstack documents assume the page is wcstack's: one HTML file, the state binds it once, `@wcstack/router` inserts what it shows. Two common pages break that assumption. A **server-rendered site** builds its pages from its own templates and swaps them with htmx or Turbo, and wcstack adds a few interactive pieces — islands — to it. A **widget** is pasted into other sites' pages, some of which run wcstack themselves, at another version. This guide says what changes on such pages, what wcstack does, and what the page has to do. It comes from the `community-hall` seam app: a community hall's CMS site with htmx 2 and five wcstack islands, and a booking widget on a partner inn's Turbo site that runs wcstack 4.17 for its own contact form ([seam-apps.md](./seam-apps.md)).

## What changes

| On the page | What happens | What to do |
|---|---|---|
| The body is replaced (htmx's `hx-boost`, Turbo Drive) | The root `<wcs-state>` goes with the old body; the new body's root binds the new page. | Put one root in the body the navigator swaps. Not in a part it keeps (`hx-preserve`, `data-turbo-permanent`): the old root stays, and the new page's markup is never bound. |
| A part of the page is replaced (`hx-get` into `#results`, a Turbo frame) | The new markup is not bound: the state walked the page once. Since 4.20 the `diagnostics` add-on warns (`[wcs/inserted-unbound]`). | Hand each inserted element to the binder, and let go of what is thrown away ([Handing over inserted markup](#handing-over-inserted-markup)). |
| Back / Forward restores a cached copy (htmx's history, Turbo's snapshot cache) | The copy is the page as it was drawn: no `<template>` to render from, no comment binding to update. It looks right and never changes. Since 4.20 the `diagnostics` add-on warns (`[wcs/rendered-copy]`). | Turn that cache off where islands are: `hx-history="false"` on `<body>`; `<meta name="turbo-cache-control" content="no-cache">`. Back then loads the page from the server (a round trip; htmx restores no scroll position without its snapshot). |
| The server updates an element a binding renders (`hx-swap-oob`) | The bound element is replaced by an unbound one: the binding goes on writing into the old element, which is gone. | One owner per element: the island renders it, or the server does. |
| htmx attributes inside a `for:` / `if:` template | Rows are cloned after htmx processed the page: htmx never sees an `hx-get` in a row. A binding that changes an `hx-*` attribute is not seen either (htmx reads them when it processes the element). | Keep `hx-*` outside wcstack templates, or call `htmx.process()` on the rows. |
| htmx decides on the event a binding answers | htmx acts during the event's dispatch; wcstack applies bindings a microtask later. An attribute a binding sets (`attr.data-invalid:`) still has its previous value when htmx reads it. | Decide in htmx's own events (`htmx:confirm`), or add a `delay:` to the trigger. |
| The server's templates also use `{{ }}` | A CMS field the server leaves in the page would become a binding. | `$behavior: { enableMustache: false }` in the state, and write bindings as `data-wcs` and comment bindings (`<!--@@: x-->`). Since 4.20 the lint follows the declaration. |
| Two `<wcs-state src="x.js">` in one document over time | Up to 4.19 they shared one object: the next page started with what the last one wrote. | Since 4.20 each gets its own evaluation of the module. |
| A volume (`mount=`) on a swapped page | Up to 4.19 every other htmx swap refused the new page's volume (htmx inserts the new content before it removes the old). | Since 4.20 the volume is decided when it starts. |

## Where the root goes

One root per page, in the swapped body, holding every island of that page under its own key (`booking.*`, `filter.*`). What the server knows about the page — the record it rendered, the URL's filters — reaches the state as data: a `<script type="application/json" id="page-seed">` read in `$connectedCallback`, or a volume with `json=`. Islands that are separate roots on one document collide (`[wcs/second-root]`, `#47`), and which one wins depends on load timing.

A root written in the server's layout once and loaded with `src=` is fine since 4.20: every page gets a fresh state. Up to 4.19, write the state inline and build it with a factory (`export default createSiteState();` in an inline module), which needs an import map entry for the factory's module — an inline state is evaluated from a `blob:` URL, against which `"/js/site.js"` does not resolve.

## Handing over inserted markup

```js
const binder = () => globalThis[Symbol.for("wcstack.binder")];
const REGIONS = "#results, #booking";   // the regions the page's htmx swaps into

// htmx: htmx:load for each element a swap inserted; htmx:beforeCleanupElement for each it removes
document.addEventListener("htmx:load", (e) => {
  if (e.detail.elt.parentElement?.closest(REGIONS)) binder()?.bind(e.detail.elt);
});
document.addEventListener("htmx:beforeCleanupElement", (e) => {
  // a region's own children — what the server rendered there first too, which the page walk bound
  if (e.detail.elt.parentElement?.matches(REGIONS)) binder()?.release?.(e.detail.elt);
});

// Turbo frames: the frame element stays and its children are replaced
document.addEventListener("turbo:before-frame-render", (e) => {
  for (const el of e.target.children) binder()?.release?.(el);
});
document.addEventListener("turbo:frame-render", (e) => {
  for (const el of e.target.children) binder()?.bind(el);
});
```

- **The new nodes, not their container.** An element the page walk visited is left alone when it is handed over again, with everything in it: handing over `#results` after a swap into it binds nothing.
- **A `for:` / `if:` template at the top of a fragment** is not rendered when handed over (`#204`): its rows would sit beside it, out of the inserter's reach. Put it inside an element.
- **`release` is for good, and takes whatever is bound under the node** — what you handed over, and what the page walk bound there first (the server's first results). It unregisters the subtree's bindings and disposes its `for:` / `if:` views (since 4.20, binder protocol version 2, the `release` add-on — in `@wcstack/state` and `/auto`). Without it, a page that replaces its results for an hour keeps every set it showed, and each change writes into all of them. Released nodes are not bound again. Do not release what comes back (a panel you hide and show).
- **Before `@wcstack/state` has loaded** the binder is `undefined`; markup inserted before then is bound by the first walk.

The rules are in the state README ([Inserting markup yourself](../packages/state/README.md#inserting-markup-yourself)) and the protocol in [binder-protocol-design.md](./binder-protocol-design.md) §10.

## A widget on a page that runs its own wcstack

A page defines `<wcs-state>` once: the first copy of `@wcstack/state` it evaluates defines it, and a second copy does nothing (`[wcs/package-twice]`, [timing-and-firing-contract.md §24](./timing-and-firing-contract.md)). A widget that loads wcstack's `/auto` on a page that already runs wcstack therefore runs on the page's copy, of whatever version that is, and breaks the day the page upgrades or the widget needs something newer. A widget whose markup sits in the page's light DOM also meets the page's root (`#47`) and the page's stylesheet.

Give the widget a shadow root with a [scoped custom element registry](./scoped-custom-element-registries.md) of its own, and define wcstack's tags into that registry. Every package's `bootstrapXxx(config, registry)` takes the registry as its second argument, `@wcstack/state`'s `bootstrapState(config, registry)` included:

```js
import { bootstrapState } from "https://esm.run/@wcstack/state@4.20.0";
import { bootstrapSse } from "https://esm.run/@wcstack/sse@4.20.0";

let registry = null;
function widgetRegistry() {
  if (registry === null) {
    registry = new CustomElementRegistry();
    bootstrapSse(undefined, registry);
    bootstrapState(undefined, registry);
  }
  return registry;
}

class PartnerWidget extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const shadow = this.attachShadow({ mode: "open", customElementRegistry: widgetRegistry() });
    shadow.innerHTML = `<wcs-state src="${new URL("./widget-state.js", import.meta.url)}"></wcs-state>…`;
  }
}
customElements.define("partner-widget", PartnerWidget);
```

- Import the package's main entry (it exports `bootstrapState`), not `/auto` (which defines into the page's global registry), and pin the version.
- The shadow root is the widget's own root: one state tree there, beside the page's, and neither stylesheet reaches the other.
- **Browsers.** Scoped registries ship in Chrome / Edge 146 and Safari 26; Firefox has not shipped them ([scoped-custom-element-registries.md](./scoped-custom-element-registries.md)). Where `new CustomElementRegistry()` throws, decide what the widget does — `community-hall`'s shows a link to the event on the hall's site rather than run on the page's copy.
- **Turbo.** Turbo's snapshot is a clone of the page, and a clone has no shadow root: a widget restored from it starts again in `connectedCallback`. Turbo's preview (`data-turbo-preview` on `<html>`) is thrown away a moment later; a placeholder there saves a connection.

## Checking such a site

- **The lint** reads the server's templates, in which `{{ }}` is the server's syntax, and fragments that have no `<wcs-state>`. Since 4.20 it follows `enableMustache: false` and reports a file with bindings and no state (`wcs/state-absent`) instead of passing it unchecked. To check a fragment's paths, lint the pages as the browser gets them: render them through the server, put each fragment into its page, and run `wcs-validate --root=<the site's public directory>` on the result.
- **The diagnostics add-on** (in `@wcstack/state` and `/auto`) reports inserted markup nothing bound (`[wcs/inserted-unbound]`) and a cached copy of a drawn page (`[wcs/rendered-copy]`). A main-flow test that fails on any console warning catches both.
- **Unit tests** with `@wcstack/testing` import a state module anew for each `mount()`, so they never saw two roots share one module's object (fixed in 4.20). Test page-to-page flows in a browser.
