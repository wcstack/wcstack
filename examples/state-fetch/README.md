# state + fetch demo

A demo integrating `@wcstack/state` and `@wcstack/fetch`. It demonstrates fetching a user list, filtering by role, viewing user details, and creating new users via POST.

## Getting Started

The packages load from a CDN ([esm.run](https://esm.run)), so no local build is needed — Node.js alone is enough.

```bash
node examples/state-fetch/server.js
```

Open http://localhost:3000 in your browser.

## Features

- **User List**: Fetches data from `/api/users` and renders a list
- **Role Filter**: Filter by All / Admin / Editor / Viewer
- **Detail View**: Click a user to fetch details from `/api/users/:id`
- **Create User**: Submit a form to POST a new user; the list auto-reloads on success

## Key Points

- **1 fetch = 1 state slot**: each `<wcs-fetch>` is wired with the `...:` spread (`...: listFetch`, etc.), which binds all of its `wcBindable` properties and inputs at once. Initialize only the outputs the template reads (`value` / `loading` / `error` / `status`) and the inputs you change from their defaults; uninitialized (`undefined`) paths are left as "no opinion" so the element keeps its defaults.
- **Empty url suppresses auto-fetch**: `get "detailFetch.url"()` returns `""` when nothing is selected (initial view, and after a filter clears the selection). `<wcs-fetch>` treats an empty url as "no request" and skips the auto-fetch, so the detail pane stays idle. This contract matters: without it the relative `""` would resolve to the page itself and the fetch would try to parse the HTML document as JSON.
- **Spread order + `manual: true`**: the `createFetch` slot sets `manual: true`. The spread writes `url` *before* `manual`, but `<wcs-fetch>` coalesces the auto-fetch decision into a microtask and re-reads the *final* state, so the later `manual: true` wins and no stray POST runs at load. (The framework guarantees this; see `packages/fetch`'s "microtask coalesce" tests.)
- **Command token vs `data-fetchtarget`**: the list reloads via a **command token** (`$command.refreshList.emit()` from the `userResponded` handler), wired with `command.fetch: $command.refreshList`. The Create button instead uses the **`data-fetchtarget="create-fetch"`** autoTrigger attribute — the click-driven shortcut for running a fetch. Use the attribute from a plain button, the token from code.
- **Event token + status guard**: `eventToken.value: userResponded` lets state receive `create-fetch`'s response. `wcs-fetch:response` is **not** success-only — it also fires on HTTP/network errors (`value=null`, `status=`error code). The `$on` handler checks `status` is 2xx before resetting the form, so a failed POST keeps the user's input.
- **`*` resolves to the clicked row**: `selectUser` reads `listFetch.value.*.id`, where `*` is the index of the row clicked inside the `for:` loop — i.e. the id of that specific user.
- **Exclusive UI states**: the detail pane (`detailLoading` / `detailReady` / `detailIdle`) and the create banner (`createSucceeded`) are derived as mutually exclusive getters, so the "Click a user…" hint never shows on top of the spinner and the success message never overlaps the next submit.
- **Stale-while-revalidate**: on a filter switch the spinner shows only on the first load (`listLoadingFirst`); afterwards the previous rows stay and are dimmed via `class.stale`, so the list never flashes empty.
- **`onclick` takes no arguments**: it binds a method by name, so each filter button has a zero-arg wrapper (`filterAdmin`, …) around the shared `filterBy(role)`.
- **Accessibility**: rows are `<button>`s (keyboard-focusable, Enter/Space activate), labels are tied to inputs via `for`/`id`, spinners are `aria-hidden`, and status banners use `role="status"`.

> **Note on filtering while creating**: if you create a *viewer* while the *Admin* filter is active, the "Created" banner appears but the new user isn't in the visible list — the list reflects the current server-side filter (`/api/users?role=admin`). Switch to **All** to see it.
