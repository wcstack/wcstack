# state + fetch demo

A demo integrating `@wcstack/state` and `@wcstack/fetch`. It demonstrates fetching a user list, filtering by role, viewing user details, and creating new users via POST.

## Getting Started

The packages load from a CDN ([esm.run](https://esm.run)), so no local build is needed — Node.js alone is enough.

```bash
node packages/fetch/examples/users-crud/server.js
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
- **What fills `error`**: `<wcs-fetch>` sets the `error` property on **both** HTTP non-2xx responses (e.g. the `400` from the empty-name guard, where `error = {status, statusText, body}` and `body` is the already-read response **text**) **and** network throws (where `error` is the raw `Error`, with no `body`); only an aborted/superseded request leaves it null. So the single `createFailed` flag (`!loading && !!error`) covers every real failure — there is no silent-failure gap on the 400 path.
- **The server message round-trips today**: because `body` holds the read text, a nested path off the fetch output binds reactively just like `detailFetch.value.name`. The error banner derives `createErrorMessage` from `createFetch.error.body` — it parses the server's `{ "error": "<reason>" }` and shows `"Name is required"` on the empty-name 400, falling back to a generic line when the body isn't that JSON shape (e.g. a network error). No framework change is needed; `error.body` is part of the contract (nailed by the `error.body === "Not Found"` assertion in the `fetchCore` HTTP-error test).
- **Request headers are declarative**: `create-fetch` sends `Content-Type: application/json` by nesting a `<wcs-fetch-header name="…" value="…">` child element — headers are stacked as child tags rather than set in code.
- **Live region for status**: the success/error banner lives inside a *permanent* `<div role="status">`; the templates only swap content inside it. An `aria-live` region must already be in the DOM to announce reliably, so mounting it on-demand with its text would often be missed.
- **`*` resolves to the clicked row**: `selectUser` reads `listRows.*.id`, where `*` is the index of the row clicked inside the `for:` loop — i.e. the id of that specific user. (`listRows` is the null-safe projection of `listFetch.value`, which is `null` until the first response; the list's `for:` binds it for the same reason.)
- **Exclusive UI states**: the detail pane (`detailLoading` / `detailReady` / `detailIdle`) and the create banner (`createSucceeded`) are derived as mutually exclusive getters, so the "Click a user…" hint never shows on top of the spinner and the success message never overlaps the next submit.
- **Stale-while-revalidate**: on a filter switch the spinner shows only on the first load (`listLoadingFirst`); afterwards the previous rows stay and are dimmed via `class.stale`, so the list never flashes empty.
- **`onclick` takes no arguments**: it binds a method by name, so each filter button has a zero-arg wrapper (`filterAdmin`, …) around the shared `filterBy(role)`.
- **Accessibility**: rows are `<button>`s (keyboard-focusable, Enter/Space activate), labels are tied to inputs via `for`/`id`, spinners are `aria-hidden`, and status banners use `role="status"`.

> **Note on filtering while creating**: if you create a *viewer* while the *Admin* filter is active, the "Created" banner appears but the new user isn't in the visible list — the list reflects the current server-side filter (`/api/users?role=admin`). Switch to **All** to see it.
