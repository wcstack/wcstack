# garden-plots — a page assembled from parts

みどり市 市民農園 区画管理: the 農政課's console for the city's allotment gardens (4 gardens, 298 plots), in Japanese, assembled from みどり市 共通部品 — the city's shared UI parts. A **seam app** ([docs/seam-apps.md](../../docs/seam-apps.md)): a first-time author built it from the public documents on 4.27.0, to find what goes wrong where parts meet a page. Plain HTML, CSS and JavaScript, no build step.

- **Designers' parts** — `<midori-badge>`, `<midori-toggle>`, `<midori-pager>`, `<midori-tabs>`, `<midori-dialog>`, `<midori-toast>` — are **Declarative Custom Components**: one HTML file each (`public/parts/midori-*.html`) with the markup, its style and a small state; `$bindables` lists what a page binds, `$commands` what it calls. The page's own markup goes into them through slots and keeps the page's bindings.
- **Developers' parts** — `<garden-card>` → `<area-block>` → `<plot-tile>`, `<tenant-editor>`, and `<faq-node>`, which holds itself to any depth — are classes with `<wcs-state bind-component="state">`. The page hands each one an object of its own data (`state: .` in a list) and a few things beside it (`state.view: map.view`, `state.q#ro: faq.query`); what a part derives (a card's 利用率, an editor's `dirty`) the page reads back as the part's exported getters.
- **Another vendor's element** — `public/vendor/ken-postal.js`, a closed shadow root — sits inside the editor.
- **The state** is a root (`public/app/state/app.js`) and one volume per feature: `map`, `plot`, `waiting`, `faq`, `settings`.

Every page names the parts it uses in its import map, and `@wcstack/autoloader` loads them: a `.js` file with its default loader, an `.html` file with the `dcc` loader.

| Page | |
|---|---|
| `/` | 区画マップ: the gardens as cards of tiles, filtered by status in the URL, a selected plot, the arrow keys |
| `/plots/:id` | a plot: the tenant editor (the server's `422` at the field, a `409` when someone else saved), 利用開始 from the waiting list, 返還, 休止, the history, the plots before and after |
| `/waiting` | the waiting list: pages and the sort in the URL, a row's editor that stays open through a reload and a move, add and delete in dialogs |
| `/help` | the FAQ tree with a search |
| `/settings` | theme, density and notifications, kept on this computer and applied at once in every tab |
| `/public.html` | the citizens' page: the same parts over another state, read-only |
| `/parts.html` | the parts' showcase |

```bash
node examples/garden-plots/server.js              # http://localhost:3000/
WCS_LOCAL=1 node examples/garden-plots/server.js  # this repository's packages/*/dist instead of esm.run
```

Node built-ins only; the data is in memory, the same at every start. Copy `examples/shared/` alongside when you copy this directory out. Changes made in one tab reach the others through server-sent events (`/api/events`).

## What it found

The findings and what became of each are in [docs/seam-apps.md](../../docs/seam-apps.md) ("garden-plots"). In short: a part kept in a file of its own had no loader; a volume whose file arrived after the root's failed the whole page when an element wrote under its path; a wrong name between a page and a mounted part showed an empty field and said nothing, on both sides; `#ro` on one key did not hold for a part mounted inside; a DCC ignored an input written as an attribute, and its `$connectedCallback` never saw the first value the page gave; `@wcstack/testing` did not define a DCC; `wcs-schema check` failed for a tree with volumes. 4.28.0 fixed these.

## What the page does itself

The app is as its author wrote it, without the workarounds 4.28.0 made unnecessary: a loader of the page's own for the designers' parts (the autoloader's `dcc` loader), the saved settings bound to a root key and copied to the settings volume by `$watch` (`<wcs-storage>` is bound to `settings.stored`), a poll for "the volumes are there" (a volume's `connectedCallbackPromise`), the state files' `modulepreload`, plain links that asked the router in place of `<wcs-link>`, a module-level cache of the pager's rows (the numbers are data, kept by `$listKeys`), and a hand-made definition of a part in the unit tests (`mount()` defines it). What is left is the page's own:

- **The root waits for its volumes** before it calls into one (`volumesReady()` in `app/state/app.js`): the router reports the first route before the volumes' files have arrived, and the root's code runs without a volume that is not there yet.
- **What a volume may not declare** — `$watch`, `$listKeys`, the tokens, `$on` — lives in the root, each marked with its feature; a volume's methods return a result and the root turns it into a toast, because a volume does not reach the root.
- **Toasts asked for before `<midori-toast>` is defined** wait in the state: a command emitted before its element is defined is not replayed.
- **The saved theme before the first paint**: a classic script reads the key `<wcs-storage>` writes, since the state loads later.
- **A part that has not arrived** has a look of its own (`:not(:defined)` in `parts/tokens.css`, each container for the parts it holds), and one that cannot be loaded is named in a banner (`<wcs-defined timeout="8000">`).
- **The parts' exported getters are not declared on the page** (`usage`, `freeCount`, `matchCount`, which `<garden-card>` exports): since 4.29 the lint reads them from the part. The pages name their parts from `/`, so lint them with the directory the server serves — `npx @wcstack/lint --root=public public/*.html public/parts/*.html`. Without `--root` the lint does not find the parts and reports the console's reads of those getters (`wcs/binding-path-missing`, two warnings), as it did up to 4.28, when the JSDoc type of the page's data declared them by hand — which would have hidden a rename.
- **The dialog's first focus** is set by the part: Firefox and WebKit do not look for `[autofocus]` in slotted content.

Two things were found while landing the app, both in how it was written, and are fixed here:

- **A radio takes its value before `radio:` compares it.** The theme and density radios were written `radio: settings.theme; attr.value: .value`: at the first render no radio was checked, and nothing said so (a later write of the state checks the right one). With the saved settings arriving before the page is drawn, the settings test failed. They are written `attr.value: .value; radio: settings.theme`.
- **A tab's own save comes back on the event stream**, and the server writes the event before the answer. The app compared the event with what the answer had told it, so an echo that won the race was announced as another member's change — always in WebKit. An event that arrives while a save is in flight now waits for the answer.

## Tests

- `npm install && npm test` here: 29 unit tests — the counts and percentages, the pager's numbers, the editor's rules, the FAQ counts, and each part on its own, headless, with `@wcstack/testing` (a designers' part's file is put before the page's markup, and `mount()` defines it).
- `e2e/tests/garden-plots.spec.ts`: the author's 44 browser tests, against this repository's dist — in Chromium, seven of them in Firefox too. They also pass in WebKit, which the repository's e2e does not run.
