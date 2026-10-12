# Seam apps: building apps that find what tests miss

**日本語版**: [seam-apps.ja.md](./seam-apps.ja.md)

A *seam app* is an application written to find defects, not to show a feature. This document says why we build them, what makes one find things, how to run one, and where the result goes. The last section is the log of the apps built so far.

## Why

The shop tutorial on the site (16 steps, one app growing from a single product to a routed, tested, published shop) led to four patch releases in two days:

| Release | Found while writing | Kind |
|---|---|---|
| 4.0.1 | A bare `class:` / `attr:` was accepted and did nothing. The lint reported every row field of a list derived in a getter as missing — **the `wcstack` README's own Todo app** had three such warnings. | A wrong form passes silently; a right form is flagged |
| 4.0.2 | A write below a `<wcs-storage>`-bound path is never saved; a seeded slot loses its seed on a first visit. | Broken after a reload, silently |
| 4.0.3 | An accessor pair bound without `#init=element` saves over the stored value; `<wcs-fetch>`'s `body` is sent once — **the fetch README's POST example** sent no body the second time. | Broken on the second time or after a reload, silently |
| 4.0.4 | A `<wcs-outlet>` away from its router stays empty while the pages render elsewhere — **`examples/router-i18n`** had it wrong. | Works, but not where the author meant, silently |

None of them was a crash. Every one sat **between two packages** (state × storage, state × fetch, router × the page's layout), showed only **over time** (a reload, a second submit, a deep link), and was **silent**: nothing in the console, nothing from the lint. Three of them were in our own README or examples.

The repository already had about forty examples, each with a real-browser e2e test. They did not find these, for three reasons:

- **They are one screen and one or two packages.** A demo shows a feature; it rarely crosses a seam or lives through a reload.
- **Their author knows the rules.** Whoever writes a demo for a package steers around its sharp edges without noticing.
- **Their tests check presence, not intent.** `router-i18n`'s test checked that the page text appeared; the text appeared — in the router's own outlet, not the one the page placed.

The tutorial was different on each count, and that is what this document turns into a method.

## What makes an app find things

1. **It grows, and it lives.** Build it in steps, each adding a package or a feature, and live through what real use brings: a reload, the second time, a deep link, Back and Forward, a second tab, a slow or failing network, an expired session. Most of the defects above appear only on the second pass.
2. **It crosses seams on purpose.** Pick the app for the seams it crosses — two packages exchanging values, a package meeting the page's layout, the runtime meeting the lint — not for the features it shows. Another app of a shape already built finds less.
3. **It is written from the public documents only.** The author reads what a user can read — the package READMEs, the root and `wcstack` READMEs, the AI authoring skill, the examples — and not `packages/*/src`. When the documents do not say, the author guesses as a user would, and the guess is the finding.
4. **Every friction is recorded.** Each time the author stops — a form that does not work, a sentence that does not answer, a message that does not help — it goes in the friction log, with what was read, what was written, what happened, and what was expected.
5. **It makes the common mistakes on purpose.** For each likely mistake, write it and see whether anything says so: the runtime, the lint, the type checker. A mistake that fails silently is a finding even when the app itself is right.
6. **It is checked for intent, not presence.** Assert *where* a thing rendered, *what* survived the reload, *what* the second request sent, *which* URL the page is on — not only that some text appeared.
7. **It goes through the whole toolchain.** `wcs-validate`, `wcs-tsc` where the state is typed, `@wcstack/testing` for a headless test, and a pinned, integrity-checked page for production — each is a seam too.

## How to run one

1. **Brief.** Write the app's story, its steps, the seams each step crosses, the life events to go through, the mistakes to try, and the server API it needs (the backend is not under test, so its contract is fixed up front). The candidates below are briefs in short form.
2. **Build from the documents.** A first-time author builds it — in practice a subagent given the brief and told which files it may read (the public documents above) and which it may not (`packages/*/src`, the tests, `docs/` design notes). It runs the app against the published packages on the CDN, as a user would, and keeps the friction log.
3. **Verify intent.** Open the app in a real browser and go through the life events; write them as an e2e spec that asserts intent (the checklist below). Run `wcs-validate` over the page.
4. **Make the mistakes.** Go through the mistake list; record which ones are loud and which are silent.
5. **Classify.** Every entry of the friction log and the mistake pass is one of:
   - **runtime defect** — a package does the wrong thing;
   - **lint gap** — a mistake the static check could see and does not;
   - **document gap** — the documents do not say, or say wrong (an example that does not work counts here);
   - **design question** — the behavior is as designed, but the design is the friction.

   Each gets an outcome: fixed in a PR, an issue, or a decision recorded (as [router-outlet-placement.md](./router-outlet-placement.md) records one).
6. **Keep what crosses a new seam.** The app goes to `examples/` with its e2e spec; the findings go in the log below and in the app's README. A fix lands with its own tests in the package it changes, as usual — the app is not the regression test for it.

### Intent checklist

Not every app needs every line, but each line skipped should be a choice:

- **Where**: the content rendered in the element the page meant (not just somewhere in the document).
- **Reload**: what the app keeps across a reload is there, and what it should not keep is not.
- **Second time**: the second submit, the second navigation to the same route, the second item added behave like the first.
- **Deep link**: opening a URL directly (not through the app's links) lands on the same page with the same data.
- **History**: Back and Forward restore the page, the URL and the data, and do not show what should be gone (a page after logging out).
- **Another tab**: two tabs on the same data agree, or deliberately do not.
- **Network**: a slow response, a failing one (4xx / 5xx), and no network at all each show something sensible, and recovering works.
- **Console**: no errors and no warnings in the right app; the expected warning in each mistake.

## Where they go

**In `examples/`**, as cross-package apps alongside the demos, with an e2e spec in `e2e/tests/`.

- `examples/` already holds "apps that compose two or more packages", which a seam app is. The shared demo server, the `WCS_LOCAL=1` switch to the local `dist`, the e2e setup that starts an example's own server, the CI e2e job and the `wcs-validate` job that reads every page in the repository all apply without new infrastructure.
- A separate top-level directory (`apps/`) would duplicate that infrastructure and leave the demos as the shallow tier. Holding the examples to the intent checklist is the better outcome.
- The site's tutorial stays the teaching material; a seam app is larger and not written to be read step by step.
- A separate repository would cut the e2e off from the local `dist`, so a fix and the app that found it could not be checked in one PR.

What does not go there: the first-time author's raw attempt (excerpts go in the findings), and the mistake variants (each becomes a unit or lint test in the package that makes it loud).

Seam apps are listed in their own table in [examples/README.md](../examples/README.md), with the seams they cross. Like every example, they load the packages from `esm.run` (npm `latest`), so they must keep working on each release; the e2e job runs them against the local `dist`.

## Candidates and log

| App | Seams | Life events | Status |
|---|---|---|---|
| `router-auth` — a members area: log in, protected pages, an order history from an API that needs a token | router guards × state, `<wcs-fetch>` 401 × navigation, `<wcs-storage>` × the guard, guard loaders (`data`) | deep link while logged out → log in → back to that page; reload while logged in; the session expiring mid-use; Back after logging out; logging out in another tab | planned |
| `router-admin` — an admin console: nested layouts, a list with server-side paging and sorting in the URL, edit forms with server validation, view transitions, two languages | `<wcs-layout>` × state, query ⇄ state ⇄ fetch, two-way form bindings × fetch `body`, `<wcs-view-transition>` × router × lists, locale in the basename | deep link to page 3 sorted by name; edit, save, save again; a 422 with field errors; reload on an edit page; Back from a detail | planned |
| `state-collab-board` — a shared board: changes from others arrive over SSE, yours are applied at once and rolled back if the server refuses | `<wcs-sse>` × state lists, `<wcs-fetch>` × optimistic updates, `<wcs-network>` × state, reconnect × resync | two browsers; a refused change; going offline and back; the server restarting | planned |
| `signals-shop` — the tutorial's shop on `@wcstack/signals` | signals × router, signals × `<wcs-fetch>` / `<wcs-storage>` through the wc-bindable bridge | the tutorial's own (reload, deep link, Back, a second tab) | planned |
