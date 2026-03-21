# @wcstack/fetch

Declarative fetch component for Web Components. A [HAWC](https://github.com/nicolo-ribaudo/tc39-proposal-wc-bindable-protocol) (Headless Async Web Component) that encapsulates HTTP communication and exposes reactive state via [wc-bindable-protocol](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/main/docs/articles/HAWC.md).

Zero runtime dependencies. Works with any framework — React, Vue, Svelte, Solid, Angular, or vanilla JavaScript.

## Install

```bash
npm install @wcstack/fetch
```

## Quick Start

```javascript
import { bootstrapFetch } from "@wcstack/fetch";

bootstrapFetch();
```

Or use the auto-bootstrap script:

```html
<script type="module" src="https://esm.run/@wcstack/fetch/auto"></script>
```

## Architecture — Core / Shell

`@wcstack/fetch` follows the HAWC Core/Shell pattern:

```
┌─────────────────────────────────────────────────┐
│  FetchCore (EventTarget)                        │
│  - async logic, state, dispatchEvent            │
│  - runs anywhere: browser, Node, Deno, Workers  │
├─────────────────────────────────────────────────┤
│  Fetch (HTMLElement) — Shell                    │
│  - attribute mapping, lifecycle                 │
│  - enables framework binding via ref            │
└─────────────────────────────────────────────────┘
```

**Core (`FetchCore`)** — Extends `EventTarget`, contains all async logic (HTTP requests, abort, state management). No DOM dependency — works in any JavaScript runtime.

**Shell (`<wcs-fetch>`)** — Thin `HTMLElement` wrapper. Maps HTML attributes to Core parameters, manages DOM lifecycle, and enables framework binding via refs. Contains no business logic.

The Core dispatches events directly on the Shell via **target injection**, so no event re-dispatch is needed.

### Headless Usage (Core only)

`FetchCore` can be used standalone without the DOM. Since it declares `static wcBindable`, you can use `@wc-bindable/core`'s `bind()` to subscribe to its state — the same way framework adapters work:

```typescript
import { FetchCore } from "@wcstack/fetch";
import { bind } from "@wc-bindable/core";

const core = new FetchCore();

const unbind = bind(core, (name, value) => {
  console.log(`${name}:`, value);
  // "loading: true"
  // "value: [{ id: 1, name: "Tanaka" }, ...]"
  // "status: 200"
  // "loading: false"
});

await core.fetch("/api/users");

// Clean up when done
unbind();
```

This works in Node.js, Deno, Cloudflare Workers — anywhere `EventTarget` and `fetch` are available.

## Usage

### JSON Mode — API Data Fetching

```html
<wcs-fetch id="user-api" url="/api/users" method="GET"></wcs-fetch>
```

Response data is exposed via `wc-bindable-protocol`. With `@wcstack/state`:

```html
<wcs-fetch url="/api/users" data-wcs="value: users"></wcs-fetch>
<wcs-state>
  <ul>
    <template data-wcs="for: users">
      <li data-wcs="textContent: users.*.name"></li>
    </template>
  </ul>
</wcs-state>
```

### HTML Replace Mode — htmx-like

```html
<div id="content">Initial content</div>
<wcs-fetch url="/api/partial" target="content"></wcs-fetch>

<button data-fetchtarget="my-fetch">Load</button>
<wcs-fetch id="my-fetch" url="/api/fragment" target="content"></wcs-fetch>
```

When `target` is set, the response HTML replaces the target element's innerHTML.

### POST with Headers and Body

```html
<wcs-fetch url="/api/users" method="POST">
  <wcs-fetch-header name="Authorization" value="Bearer token123"></wcs-fetch-header>
  <wcs-fetch-header name="Accept" value="application/json"></wcs-fetch-header>
  <wcs-fetch-body type="application/json">
    {"name": "Tanaka", "email": "tanaka@example.com"}
  </wcs-fetch-body>
</wcs-fetch>
```

### Programmatic Usage

```javascript
const fetchEl = document.querySelector("wcs-fetch");

// Set body via JS API (takes priority over <wcs-fetch-body>)
fetchEl.body = { name: "Tanaka" };
await fetchEl.fetch();

console.log(fetchEl.value);   // response data
console.log(fetchEl.status);  // HTTP status code
console.log(fetchEl.loading); // boolean
console.log(fetchEl.error);   // error info or null
```

## Elements

### `<wcs-fetch>`

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | — | Request URL (required) |
| `method` | string | `GET` | HTTP method (`GET`, `POST`, etc.) |
| `target` | string | — | DOM element id for HTML replace mode |

| Property | Type | Description |
|----------|------|-------------|
| `value` | any | Response data (JSON object or HTML string) |
| `loading` | boolean | `true` while request is in flight |
| `error` | object \| null | Error info (`{ status, statusText, body }`) |
| `status` | number | HTTP status code |
| `body` | any | Request body (set via JS, resets after `fetch()`) |
| `trigger` | boolean | Set to `true` to execute fetch. Resets to `false` on completion. |
| `manual` | boolean | When `true`, disables auto-fetch on connect and `url` change |

| Method | Description |
|--------|-------------|
| `fetch()` | Execute the HTTP request. Returns a `Promise`. |
| `abort()` | Cancel the in-flight request. |

### `<wcs-fetch-header>`

Defines a request header. Place as a child of `<wcs-fetch>`. Multiple headers supported.

| Attribute | Type | Description |
|-----------|------|-------------|
| `name` | string | Header name (e.g., `Authorization`) |
| `value` | string | Header value (e.g., `Bearer xxx`) |

### `<wcs-fetch-body>`

Defines the request body. Place as a child of `<wcs-fetch>`.

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `type` | string | `application/json` | Content-Type |

The body content is the element's text content.

## wc-bindable-protocol

`FetchCore` and `<wcs-fetch>` both declare `wc-bindable-protocol` compliance, making them interoperable with any framework or component that supports the protocol.

### Core (FetchCore)

`FetchCore` declares 4 bindable properties — the async state that any runtime can subscribe to:

```typescript
// FetchCore.wcBindable
static wcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "value",   event: "wcs-fetch:response",
      getter: (e) => e.detail.value },
    { name: "loading", event: "wcs-fetch:loading-changed" },
    { name: "error",   event: "wcs-fetch:error" },
    { name: "status",  event: "wcs-fetch:response",
      getter: (e) => e.detail.status },
  ],
};
```

Headless consumers call `core.fetch(url)` directly — no `trigger` needed.

### Shell (`<wcs-fetch>`)

The Shell extends Core's declaration with `trigger` — a property for declarative fetch execution from binding systems like `@wcstack/state`:

```typescript
// Fetch.wcBindable
static wcBindable = {
  ...FetchCore.wcBindable,
  properties: [
    ...FetchCore.wcBindable.properties,
    { name: "trigger", event: "wcs-fetch:trigger-changed" },
  ],
};
```

### TypeScript Value Types

The package exports two value type interfaces matching Core and Shell:

```typescript
import type { WcsFetchCoreValues, WcsFetchValues } from "@wcstack/fetch";

// WcsFetchCoreValues — for headless (FetchCore) usage
// {
//   value: unknown;
//   loading: boolean;
//   error: { status: number; statusText: string; body: string } | null;
//   status: number;
// }

// WcsFetchValues — for Shell (<wcs-fetch>) usage, extends Core
// {
//   ...WcsFetchCoreValues;
//   trigger: boolean;
// }
```

## URL Observation

By default, `<wcs-fetch>` automatically executes a request when:

1. **Connected to DOM** — if `url` is set and `manual` is not present
2. **`url` attribute changes** — re-fetches with the new URL (unless `manual`)

This enables reactive data fetching when combined with `@wcstack/state`:

```html
<wcs-state>
  <script type="module">
    export default {
      filterRole: "",
      users: [],
      get usersUrl() {
        const role = this.filterRole;
        return role ? "/api/users?role=" + role : "/api/users";
      },
    };
  </script>
  <!-- URL changes automatically trigger re-fetch -->
  <wcs-fetch data-wcs="url: usersUrl; value: users"></wcs-fetch>
</wcs-state>
```

Set the `manual` attribute to disable auto-fetch and control execution explicitly via `fetch()` or `trigger`.

## Trigger Property

The `trigger` property provides a declarative way to execute fetch from state — no DOM references needed.

When set to `true`, it executes `fetch()` and automatically resets to `false` on completion (success or error).

```html
<wcs-state>
  <script type="module">
    export default {
      users: [],
      shouldRefresh: false,
      reload() {
        this.shouldRefresh = true;
      },
    };
  </script>
  <wcs-fetch url="/api/users" manual
    data-wcs="trigger: shouldRefresh; value: users">
  </wcs-fetch>
  <button data-wcs="onclick: reload">Refresh</button>
</wcs-state>
```

The `wcs-fetch:trigger-changed` event is dispatched when the trigger resets, allowing `@wcstack/state` to sync the bound property back to `false`.

## Auto Trigger

When `autoTrigger` is enabled (default), clicking any element with `data-fetchtarget` attribute triggers the corresponding `<wcs-fetch>` element:

```html
<button data-fetchtarget="user-fetch">Load Users</button>
<wcs-fetch id="user-fetch" url="/api/users"></wcs-fetch>
```

Event delegation is used — works with dynamically added elements. The `closest()` API handles nested elements (e.g., icon inside a button).

## Configuration

```javascript
import { bootstrapFetch } from "@wcstack/fetch";

bootstrapFetch({
  autoTrigger: true,               // default: true
  triggerAttribute: "data-fetchtarget", // default: "data-fetchtarget"
  tagNames: {
    fetch: "wcs-fetch",            // default: "wcs-fetch"
    fetchHeader: "wcs-fetch-header",
    fetchBody: "wcs-fetch-body",
  },
});
```

## Framework Integration

Since `<wcs-fetch>` is a HAWC with `wc-bindable-protocol` compliance, it works with any framework through thin adapters from `@wc-bindable/*`. No `useEffect`, no async state management, no cleanup, no race conditions — the adapter reads `wcBindable` declarations automatically.

### React

```tsx
import { useWcBindable } from "@wc-bindable/react";
import type { WcsFetchValues } from "@wcstack/fetch";

function UserList() {
  const [ref, { value: users, loading, error }] =
    useWcBindable<HTMLElement, WcsFetchValues>();

  return (
    <>
      <wcs-fetch ref={ref} url="/api/users" />
      {loading && <p>Loading...</p>}
      {error && <p>Error: {error.statusText}</p>}
      <ul>
        {users?.map((user) => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
    </>
  );
}
```

### Vue

```vue
<script setup lang="ts">
import { useWcBindable } from "@wc-bindable/vue";
import type { WcsFetchValues } from "@wcstack/fetch";

const { ref, values } = useWcBindable<HTMLElement, WcsFetchValues>();
</script>

<template>
  <wcs-fetch :ref="ref" url="/api/users" />
  <p v-if="values.loading">Loading...</p>
  <p v-else-if="values.error">Error: {{ values.error.statusText }}</p>
  <ul v-else>
    <li v-for="user in values.value" :key="user.id">{{ user.name }}</li>
  </ul>
</template>
```

### Svelte

```svelte
<script>
import { wcBindable } from "@wc-bindable/svelte";

let users = $state(null);
let loading = $state(false);
</script>

<wcs-fetch url="/api/users"
  use:wcBindable={{ onUpdate: (name, v) => {
    if (name === "value") users = v;
    if (name === "loading") loading = v;
  }}} />

{#if loading}
  <p>Loading...</p>
{:else if users}
  <ul>
    {#each users as user (user.id)}
      <li>{user.name}</li>
    {/each}
  </ul>
{/if}
```

### Solid

```tsx
import { createWcBindable } from "@wc-bindable/solid";
import type { WcsFetchValues } from "@wcstack/fetch";

function UserList() {
  const [values, directive] = createWcBindable<WcsFetchValues>();

  return (
    <>
      <wcs-fetch ref={directive} url="/api/users" />
      <Show when={!values.loading} fallback={<p>Loading...</p>}>
        <ul>
          <For each={values.value}>{(user) => <li>{user.name}</li>}</For>
        </ul>
      </Show>
    </>
  );
}
```

### Vanilla — `bind()` directly

```javascript
import { bind } from "@wc-bindable/core";

const fetchEl = document.querySelector("wcs-fetch");

bind(fetchEl, (name, value) => {
  console.log(`${name} changed:`, value);
});
```

## License

MIT
