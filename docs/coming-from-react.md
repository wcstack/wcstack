# Coming from React

For someone who knows React and is about to write — or move — an app with wcstack. It comes from the
`street-reports` seam app ([seam-apps.md](./seam-apps.md)): a working React 19 app (react-router, effects with
`AbortController`, Context, controlled inputs, portals, a lazy route, an error boundary) and its e2e suite were handed
to a first-time author, who moved it to wcstack without changing the suite and wrote down, construct by construct,
where each thing went and where a habit led the wrong way. This page is that record, tidied.

日本語: [coming-from-react.ja.md](./coming-from-react.ja.md)

## Six things that are not React

1. **A binding takes a path and filters, not an expression.** `data-wcs="hidden: loading|not"`, not `!loading`;
   `if: count|gt(0)`, not `count > 0`. What a filter cannot say goes in a getter of the state
   (`get badgeText() { return …; }`) and the binding names the getter. JSX takes any expression where a value goes;
   here the markup holds names, and the JavaScript is all in the state.
2. **`if:` and `for:` live on a `<template>`; `{{ }}` is text.** `{cond && <p>…</p>}` is
   `<template data-wcs="if: cond"><p>…</p></template>`. Written on the `<p>` itself it does nothing. `{{ name }}`
   works between tags only: an attribute is bound (`data-wcs="attr.href: href"`), never interpolated.
3. **There is one state for the page, and it outlives the route.** A React page component unmounts and its
   `useState` is gone; `key={id}` resets it on purpose. Here a route's nodes are taken out and put back, and the state
   is one object for the whole tab: the selection, the search text, the last record shown are all still there when the
   user comes back — and while record 51 loads, record 50 is still in the state. What a page should forget, it resets
   when it is entered or left: a `$watch` on the router's `routeName` (bound from `<wcs-router>`) is the place.
4. **A list's rows are its objects; there is no `key`.** Reorder or filter by assigning a new array of the same
   objects and the rows move with them. A row whose object is *replaced* is a new row (and loses the focus): keep the
   object, or declare `$listKeys` so that refetched data keeps its rows. Mutating in place (`push`, `sort`,
   `this.report.status = v`, `Set.add`) is not seen: assign.
5. **Form controls and a part's inputs are two-way.** `value: form.title` writes back; that is the controlled
   input, without the handler. Where the state must not follow the element — a select that shows the URL — write
   `value#ro:` and handle the event. A part's bindable member is two-way as well: `#ro` makes it a prop.
6. **An effect is one of four things.** A value derived from others is a getter. A reaction with a side effect is
   a `$watch` entry (it does not run at the start, and it fires when a watched getter's inputs change, not only its
   value). Fetching, storage, timers, streams and the document title are elements (`<wcs-fetch>`, `<wcs-storage>`,
   `<wcs-debounce>`, `<wcs-sse>`, `<wcs-head>`). What is left — a listener on `document`, an interval — is started and
   stopped by hand where the page is entered and left (see 3).

## Where each thing went

| React | wcstack | |
|---|---|---|
| A page component | A `<wcs-route>` body in the page's HTML, and a section of the state | a different shape |
| A small reusable component | A part: a Declarative Custom Component (HTML only) or a class with `bind-component` | a different shape |
| `props` | A part's `$bindables`, bound with `#ro` | two-way without `#ro` |
| A callback prop (`onPageChange`) | An event the part dispatches: `eventToken.page: pageChosen` on the tag, `$on.pageChosen` in the state | a different shape |
| `children` | Plain nesting in the page; a part takes them through a `<slot>` it declares | — |
| `useState` | A key of the state (it outlives the page — reset it) | a different shape |
| `useReducer` | Methods that write keys | a different shape |
| `useMemo` | A getter (cached by its dependencies) | direct |
| `useCallback`, `useEffectEvent`, `StrictMode` | Nothing: methods are stable and read the current state | not needed |
| `useRef` to an element | `document.getElementById` in a method or a `$watch` handler; `indeterminate:` and the like are property bindings | by hand |
| `useId` | Ids from a row getter (`attr.id: .domId`); a part's shadow root for a part | by hand |
| `useContext` | Read the top-level key by its path — there is no provider. A part does not read the page's state: hand it the value | a different shape |
| Fetching in an effect, with abort | `<wcs-fetch manual>`, a `$watch` on the url getter that emits its command; its `value` is the last response, so check that it is the one the page shows | a different shape |
| A debounced value | `<wcs-debounce wait="300" data-wcs="source: text; value: textSettled">` | direct |
| `localStorage` + the `storage` event | `<wcs-storage key="…" data-wcs="value#init=element: theme">` (a string is stored as it is, not as JSON) | direct |
| The document title | `<wcs-head><title>…</title></wcs-head>` in the route | direct |
| An event stream | `<wcs-sse url="…" events="report" data-wcs="eventToken.message: onReport">` | direct |
| Routes, `useParams`, `useLocation`, `useSearchParams`, `useNavigate` | `<wcs-router>` with `params:` / `path:` / `searchParams:` bound into the state; write `navigateUrl` (push) or `replaceUrl` (replace) | direct |
| `<Link>`, `<NavLink>` | `<wcs-link to="…">`; `match="prefix"` for a section, and `current="page"` to say so to a screen reader (since 4.30) | direct |
| `<Navigate replace>` | A guard that returns the path | a different shape |
| `useBlocker` + your own dialog | Since 4.32 (not released yet), `leaveHold: dirty` on `<wcs-router>`: it holds the navigation, `leaving` names where to, and your dialog answers with the router's `proceed()` / `stay()` (router README, "A page's own \"leave?\" dialog"). Up to 4.31, `leaveConfirm` asked with the browser's `confirm()` only | none |
| `React.lazy` | The autoloader loads a part when its tag first appears; code is `import()`ed in a method and a state flag gates what reads it | a different shape |
| An error boundary | `$errorCallback(error, info)` on the state: it hears a binding that failed, and the page shows its own fallback (`if: pageOk`). It is per state — a part has its own | a different shape |
| A portal | Write the dialog and the toasts at the end of `<body>`, outside the router: nothing needs moving. Bound markup must be inside `<body>` | a different shape |
| `flushSync`, a ref right after `setState` | A write is drawn in a microtask: look the element up in a `$watch` of what made it appear | none |
| `className={cx(…)}` | `class.NAME: flag` per class, or `attr.class:` with a getter | a different shape |
| `style={{ width: pct + '%' }}` | `style.width: pct|unit(%)` | direct |
| `onClick={() => remove(id)}` | `onclick: remove` — a handler is a method name and receives `(event, ...loopIndexes)`; read the row through `this[".id"]` or a `data-*` attribute | a different shape |
| Controlled input | `value: path` | direct |
| Radio group | `attr.value: .value; radio: form.priority` — the value first | direct |
| Optimistic update and rollback | The same code, writing keys | direct |
| Batching | The same: several writes in a row are drawn once | direct |

## What bites, and who says so

Each of these was written by the author — or made on purpose in a copy of the finished app — and run through the
lint, the type check, the unit tests, the e2e suite and a browser. "Lint" and the `[wcs/…]` console messages below
are as of 4.30; up to 4.29 most of them said nothing.

| The habit | What happens | Who says so |
|---|---|---|
| An expression in a binding (`!loading`, `count + 1`, a ternary, `` `/r/${id}` ``, `format(date)`) | The binding fails: no such path | Lint `wcs/binding-expression`; the console: "An expression is not a path" |
| `{{ }}` in an attribute (`href="/reports/{{ id }}"`) | The attribute keeps the braces | Lint `wcs/attribute-mustache`; `[wcs/attribute-mustache]` |
| `if:` / `for:` on the element | Always shown; one row | Lint `wcs/structural-element`; `[wcs/structural-element]` |
| `key={…}` | Nothing | Lint `wcs/key-binding` |
| `this.items.push(x)`, `this.report.status = v` | Nothing is drawn | Lint `wcs/array-mutation`, `wcs/nested-assign` |
| `this.selected.add(id)` on a `Set` | Nothing is drawn | Lint `wcs/collection-mutation` |
| `style: { width }` | No style | `[wcs/style-object]` |
| `attr.disabled: flag` with `false` | `disabled="false"`: disabled for ever | Lint `wcs/binding-type-expectation` |
| `onSubmit: handler` on a part | A listener for an event named `Submit` | Lint `wcs/event-name-case` |
| A fixed `id` in a row | Every row has it: a label reaches the first row | Lint `wcs/row-id-shared` |
| `import` of `./lib/x.js` in an inline state | The state fails to start (it is evaluated from a `blob:` URL) | Lint `wcs/inline-import`; the console says what to write |
| A page's state not reset (no unmount, no `key={id}`) | The last page's selection, text and record are still there | Nobody: a test of yours |
| An effect without its cleanup | Intervals and streams of pages that were left | Nobody |
| A fetch without the abort, a write after an `await` | An old answer under a new URL | Nobody |
| A ref right after a write | `null` — the element is drawn a microtask later | A plain `TypeError` |
| `onchange:` expected on every keystroke | It is the DOM's `change`: on commit | Nobody |
| A transformation in a handler under `value#ro:` | The field keeps what was typed when the state did not change | Nobody: normalize in a setter |
| Bound markup put outside `<body>` | Never bound | Nobody |
| Text given `false` | Prints `false` (React prints nothing) | Nobody |
| JSX-style line breaks between elements | HTML keeps the whitespace: `新規 28 件`, not `新規28 件` | A test of yours |
| An async handler clicked twice | Two requests | Nobody: `disabled: sending`, and a guard at the top |

What carries over unchanged: batching, optimistic updates, immutable updates of an object under bound inputs (the
focus and the caret stay), typing under a slow CPU and with an input method, and `lib/` — code without React in it
moved as it was.

## Checking the port

- Keep the e2e suite you have and run it against the port: it found what nothing static did. Locate by role, label
  and text, and it does not care which framework drew the page.
- `npx @wcstack/lint --strict --root=<the served directory> index.html parts/*.html`, with a `stateSchema` from
  `wcs-schema` ([`@wcstack/typescript`](../packages/typescript/README.md)) so that a misspelt path is an error.
  A state built with a `...spread` of page modules is not read by the lint: keep the state one object literal, or
  split it with `mount=` volumes.
- `@wcstack/testing`'s `mount()` loads the real state file and the parts for unit tests.
