# Where `<wcs-outlet>` goes

**日本語版**: [router-outlet-placement.ja.md](./router-outlet-placement.ja.md)

## The rule

A `<wcs-router>` renders its routes into **the element right after it**, if that element is a `<wcs-outlet>`. If it is not, the router creates a `<wcs-outlet>` and inserts it right after itself. A `<wcs-outlet>` anywhere else — inside `<main>`, inside the router, after another element — is never used.

```html
<main>
  <wcs-router><template>…</template></wcs-router>
  <wcs-outlet></wcs-outlet>   <!-- right after the router: used -->
  <aside>…</aside>
</main>
```

Whitespace, text and comments between the two do not matter; another element does.

When the rule is broken, the page still works, but not where the author meant: the routes render right after the router (above the header, if the router sits at the top of `<body>`), and the `<wcs-outlet>` the author placed stays empty. Before 4.0.4 nothing said so.

## How it came to be

| When | Commit | What |
|---|---|---|
| 2026-01-17 | `0fa46ef9` | First router. One router per document; the outlet was the first `<wcs-outlet>` in the document (`document.querySelector`), or a new one appended to `<body>`. An outlet anywhere worked. |
| 2026-04-10 (v1.8.6) | `15ac3bc4` | Multi-router support (micro-frontends: several routers with distinct `basename`s). A document-wide lookup would hand every router the same first outlet, so the lookup was narrowed to pair each router with its own outlet: the router's **next element sibling**, else a new one created right after the router. |
| later | — | SSR adoption ([ssr-router-design.md](./ssr-router-design.md) (ja) §4) relies on the same position: the client adopts a server-rendered `<wcs-outlet data-wcs-ssr>` found where the outlet is expected. |
| 2026-10-12 | — | Found while writing Part 3 of the tutorial: the router at the top of `<body>`, the outlet inside `<main>` — the pages rendered above the header. |

The 2026-04 change was made for multi-router pages, but it changed single-router pages too, silently:

- **The rule was never written down.** The README lost "only one router can exist in a document" and gained "multiple routers can coexist when each has a distinct `basename`", but not "the outlet must be right after the router". Its outlet section still said only "define it in HTML, or the router creates it". The CHANGELOG starts after v1.8.6, so it has no entry either.
- **The comment said more than the code did.** `_getOutlet` was commented "look for the outlet among the router's siblings and descendants", but it checks the next sibling only.
- **Nothing exercised the other case.** The tests covered "the outlet is right after the router" and "there is none, so the router creates one" — not "there is one, elsewhere". The examples placed the outlet right after the router — except `examples/router-i18n`, which placed it *inside* the router after the `<template>`: unused, but the router's own outlet landed right next to it, so it looked the same.
- **Creating an outlet made the mistake invisible.** Letting the router create a missing outlet is a convenience, but combined with "next sibling only" it made an outlet in the wrong place indistinguishable from no outlet at all: no error, no warning.
- **The AI authoring skill** said only "the render target is `<wcs-outlet>`, auto-generated if not written", so pages it generated could fall into the same trap.

## Decision (2026-10-13)

**A — keep the rule, make the mistake loud, write the rule down.**

- The router warns at runtime, once per outlet, with the code `[wcs/router-outlet-misplaced]`, and names the outlet it will not use (`packages/router/src/misplacedOutletWarning.ts`). Behavior does not change.
- `wcs-validate` and the VS Code extension report the same code, as a warning, on the outlet (`packages/vscode-wcs/src/service/documentEnvValidator.ts`).
- The router README, this document and the AI authoring skill state the rule; `examples/router-i18n` moves its outlet out of the router.

Not now, until there is a real need:

- **B — widen the lookup**: when the next sibling is not an outlet, take an unclaimed `<wcs-outlet>` elsewhere in the same root. It would make single-router pages place-free, but with several routers it needs a pairing order, and the SSR adoption path assumes the adjacent position.
- **C — pair explicitly**: an attribute such as `<wcs-router outlet="main-outlet">`. Unambiguous, at the cost of API.

## How the check decides

A router takes as its outlet either the `<wcs-outlet>` right after it, or one it creates right after itself. So **a `<wcs-outlet>` whose previous element sibling is not a `<wcs-router>` is used by no router**. Both checks report such an outlet when some router has no `<wcs-outlet>` right after it — the case where that router creates its own and the page renders there.

- **Runtime**: run when a router is about to create its outlet; it looks in the router's own root (the document, or the shadow root it lives in), so a router in a shadow root does not report outlets of the document. Each outlet is reported once. A router outside the document checks nothing.
- **Static**: from the order of tags in the HTML — the tag after `</wcs-router>` is the router's next sibling if it is a start tag (none if it is an end tag); the tag before `<wcs-outlet>` tells whether its previous sibling is a router. Contents of `<script>` and `<style>` and HTML comments are ignored.

An extra outlet on a page where every router has its own outlet right after it is not reported: the router does not create anything there, and it is not what this check is about.
