# @wcstack/fetch

`@wcstack/fetch` is a headless fetch component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **I/O node** that connects HTTP requests to reactive state.

With `@wcstack/state`, `<wcs-fetch>` can be bound directly through path contracts:

- **input / command surface**: `url`, `body`, `trigger`
- **output state surface**: `value`, `loading`, `error`, `status`

This means async communication can be expressed declaratively in HTML, without writing `fetch()`, `async/await`, or loading/error glue code in your UI layer.

`@wcstack/fetch` follows the [HAWC](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/main/docs/articles/HAWC.md) architecture:

- **Core** (`FetchCore`) handles HTTP, abort, and async state
- **Shell** (`<wcs-fetch>`) connects that state to the DOM
- frameworks and binding systems consume it through [wc-bindable-protocol](https://github.com/wc-bindable-protocol/wc-bindable-protocol)

## Why this exists

In many frontend apps, the hardest part to migrate is not the template — it is the async logic:
HTTP requests, loading flags, errors, retries, and lifecycle cleanup.

`@wcstack/fetch` moves that async logic into a reusable component and exposes the result as bindable state.

With `@wcstack/state`, the flow becomes:

1. state computes `url`
2. `<wcs-fetch>` executes the request
3. async results return as `value`, `loading`, `error`, `status`
4. UI binds to those paths with `data-wcs`

This turns async communication into **state transitions**, not imperative UI code.

## Install

```bash
npm install @wcstack/fetch
```

## Quick Start

### 1. Reactive fetch from state

When `url` changes, `<wcs-fetch>` automatically runs a new request.
If another request is already in flight, it aborts the previous one.

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/fetch/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      users: [],
      get usersUrl() {
        return "/api/users";
      },
    };
  </script>

  <wcs-fetch data-wcs="url: usersUrl; value: users"></wcs-fetch>

  <ul>
    <template data-wcs="for: users">
      <li data-wcs="textContent: users.*.name"></li>
    </template>
  </ul>
</wcs-state>
```

This is the default mode:

- connect `url`
- receive `value`
- optionally bind `loading`, `error`, and `status`

### 2. Reactive URL example

A computed URL can drive data fetching automatically:

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

  <select data-wcs="value: filterRole">
    <option value="">All</option>
    <option value="admin">Admin</option>
    <option value="staff">Staff</option>
  </select>

  <wcs-fetch
    data-wcs="url: usersUrl; value: users; loading: listLoading; error: listError">
  </wcs-fetch>

  <template data-wcs="if: listLoading">
    <p>Loading...</p>
  </template>
  <template data-wcs="if: listError">
    <p>Failed to load users.</p>
  </template>

  <ul>
    <template data-wcs="for: users">
      <li data-wcs="textContent: users.*.name"></li>
    </template>
  </ul>
</wcs-state>
```

### 3. Manual execution with `trigger`

Use `manual` when you want to prepare inputs first and execute later.

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

  <wcs-fetch
    url="/api/users"
    manual
    data-wcs="trigger: shouldRefresh; value: users; loading: listLoading">
  </wcs-fetch>

  <button data-wcs="onclick: reload">Refresh</button>
</wcs-state>
```

`trigger` is a **one-way command surface**:

- writing `true` starts `fetch()`
- it resets itself to `false` after completion
- the reset emits `wcs-fetch:trigger-changed`

```
external write:  false → true   No event (triggers fetch)
auto-reset:      true  → false  Dispatches wcs-fetch:trigger-changed
```

### 4. POST with reactive body

```html
<wcs-state>
  <script type="module">
    export default {
      newUser: {
        name: "",
        email: "",
      },
      submitRequest: false,
      submitResult: null,
      submitError: null,

      submit() {
        this.submitRequest = true;
      },
    };
  </script>

  <input data-wcs="value: newUser.name" placeholder="Name">
  <input data-wcs="value: newUser.email" placeholder="Email">

  <button data-wcs="onclick: submit">Create</button>

  <wcs-fetch
    url="/api/users"
    method="POST"
    manual
    data-wcs="
      body: newUser;
      trigger: submitRequest;
      value: submitResult;
      error: submitError;
      loading: submitLoading
    ">
    <wcs-fetch-header name="Content-Type" value="application/json"></wcs-fetch-header>
  </wcs-fetch>

  <template data-wcs="if: submitLoading">
    <p>Submitting...</p>
  </template>
  <template data-wcs="if: submitError">
    <p>Submit failed.</p>
  </template>
</wcs-state>
```

## State Surface vs Command Surface

`<wcs-fetch>` exposes two different kinds of properties.

### Output state (bindable async state)

These properties represent the result of the current request and are the main HAWC surface:

| Property | Type | Description |
|----------|------|-------------|
| `value` | `any` | Response data |
| `loading` | `boolean` | `true` while a request is in flight |
| `error` | `WcsFetchHttpError \| Error \| null` | HTTP or network error |
| `status` | `number` | HTTP status code |

### Input / command surface

These properties control request execution from HTML, JS, or `@wcstack/state` bindings:

| Property | Type | Description |
|----------|------|-------------|
| `url` | `string` | Request URL |
| `body` | `any` | Request body (resets to `null` after `fetch()`) |
| `trigger` | `boolean` | One-way execution trigger |
| `manual` | `boolean` | Disables auto-fetch on connect / URL change |

## Architecture

`@wcstack/fetch` follows the HAWC architecture.

### Core: `FetchCore`

`FetchCore` is a pure `EventTarget` class.
It contains:

- HTTP execution
- abort control
- async state transitions
- `wc-bindable-protocol` declaration

It can run headlessly in any runtime that supports `EventTarget` and `fetch`.

### Shell: `<wcs-fetch>`

`<wcs-fetch>` is a thin `HTMLElement` wrapper around `FetchCore`.
It adds:

- attribute / property mapping
- DOM lifecycle integration
- declarative execution helpers such as `trigger`

This split keeps the async logic portable while allowing DOM-based binding systems such as `@wcstack/state` to interact with it naturally.

### Target injection

The Core dispatches events directly on the Shell via **target injection**, so no event re-dispatch is needed.

## Headless Usage (Core only)

`FetchCore` can be used standalone without the DOM. Since it declares `static wcBindable`, you can use `@wc-bindable/core`'s `bind()` to subscribe to its state — the same way framework adapters work:

```typescript
import { FetchCore } from "@wcstack/fetch";
import { bind } from "@wc-bindable/core";

const core = new FetchCore();

const unbind = bind(core, (name, value) => {
  console.log(`${name}:`, value);
});

await core.fetch("/api/users");

unbind();
```

This works in Node.js, Deno, Cloudflare Workers — anywhere `EventTarget` and `fetch` are available.

## URL Observation

By default, `<wcs-fetch>` automatically executes a request when:

1. it is connected to the DOM and `url` is set
2. the `url` changes

If a request is already in flight when the URL changes, the previous request is automatically aborted before the new one starts.

Set the `manual` attribute to disable auto-fetch and control execution explicitly via `fetch()` or `trigger`.

## Programmatic Usage

```javascript
const fetchEl = document.querySelector("wcs-fetch");

// Set body via JS API (takes priority over <wcs-fetch-body>)
fetchEl.body = { name: "Tanaka" };
await fetchEl.fetch();
// Note: body is automatically reset to null after fetch().
// Set it again before each call if needed.

console.log(fetchEl.value);   // response data
console.log(fetchEl.status);  // HTTP status code
console.log(fetchEl.loading); // boolean
console.log(fetchEl.error);   // error info or null
console.log(fetchEl.body);    // null (reset after fetch)
```

## HTML Replace Mode

`<wcs-fetch>` can also replace a target element's `innerHTML` when `target` is set.

```html
<div id="content">Initial content</div>
<wcs-fetch url="/api/partial" target="content"></wcs-fetch>
```

This mode is useful for simple fragment loading, but it is separate from the main **state-driven** usage with `@wcstack/state`.

## Optional DOM Triggering

If `autoTrigger` is enabled (default), clicking an element with `data-fetchtarget` triggers the corresponding `<wcs-fetch>` element:

```html
<button data-fetchtarget="user-fetch">Load Users</button>
<wcs-fetch id="user-fetch" url="/api/users"></wcs-fetch>
```

Event delegation is used — works with dynamically added elements. The `closest()` API handles nested elements (e.g., icon inside a button).

If the target id does not match any element, or the matched element is not a `<wcs-fetch>`, the click is silently ignored.

This is a convenience feature.
In wcstack applications, **state-driven triggering via `trigger`** is usually the primary pattern.

## Elements

### `<wcs-fetch>`

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | `string` | — | Request URL |
| `method` | `string` | `GET` | HTTP method |
| `target` | `string` | — | DOM element id for HTML replace mode |
| `manual` | `boolean` | `false` | Disable auto-fetch |

| Property | Type | Description |
|----------|------|-------------|
| `value` | `any` | Response data |
| `loading` | `boolean` | `true` while request is in flight |
| `error` | `WcsFetchHttpError \| Error \| null` | Error info |
| `status` | `number` | HTTP status code |
| `body` | `any` | Request body (resets to `null` after `fetch()`) |
| `trigger` | `boolean` | Set to `true` to execute fetch |
| `manual` | `boolean` | Explicit execution mode |

| Method | Description |
|--------|-------------|
| `fetch()` | Execute the HTTP request |
| `abort()` | Cancel the in-flight request |

### `<wcs-fetch-header>`

Defines a request header. Place it as a child of `<wcs-fetch>`.

| Attribute | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Header name |
| `value` | `string` | Header value |

### `<wcs-fetch-body>`

Defines the request body. Place it as a child of `<wcs-fetch>`.

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `type` | `string` | `application/json` | Content-Type |

The body content is taken from the element's text content.

Example:

```html
<wcs-fetch url="/api/users" method="POST">
  <wcs-fetch-header name="Authorization" value="Bearer token123"></wcs-fetch-header>
  <wcs-fetch-header name="Accept" value="application/json"></wcs-fetch-header>
  <wcs-fetch-body type="application/json">
    {"name": "Tanaka", "email": "tanaka@example.com"}
  </wcs-fetch-body>
</wcs-fetch>
```

## wc-bindable-protocol

Both `FetchCore` and `<wcs-fetch>` declare `wc-bindable-protocol` compliance, making them interoperable with any framework or component that supports the protocol.

### Core (`FetchCore`)

`FetchCore` declares the bindable async state that any runtime can subscribe to:

```typescript
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

The Shell extends the Core declaration with `trigger` so binding systems can execute fetch declaratively:

```typescript
static wcBindable = {
  ...FetchCore.wcBindable,
  properties: [
    ...FetchCore.wcBindable.properties,
    { name: "trigger", event: "wcs-fetch:trigger-changed" },
  ],
};
```

## TypeScript Types

```typescript
import type {
  WcsFetchHttpError, WcsFetchCoreValues, WcsFetchValues
} from "@wcstack/fetch";
```

```typescript
// HTTP error (status >= 400)
interface WcsFetchHttpError {
  status: number;
  statusText: string;
  body: string;
}

// Core (headless) — 4 async state properties
interface WcsFetchCoreValues {
  value: unknown;
  loading: boolean;
  error: WcsFetchHttpError | Error | null;
  status: number;
}

// Shell (<wcs-fetch>) — extends Core with trigger
interface WcsFetchValues extends WcsFetchCoreValues {
  trigger: boolean;
}
```

## Why this works well with `@wcstack/state`

`@wcstack/state` uses path strings as the only contract between UI and state.
`<wcs-fetch>` fits this model naturally:

- state computes `url`
- `<wcs-fetch>` executes the request
- async results return as `value`, `loading`, `error`, `status`
- UI binds to those paths without writing fetch glue code

This makes async processing look like ordinary state updates.

## Framework Integration

Since `<wcs-fetch>` is HAWC + `wc-bindable-protocol`, it works with any framework through thin adapters from `@wc-bindable/*`.

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
      {error && <p>Error</p>}
      <ul>
        {Array.isArray(users) && users.map((user) => (
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
  <p v-else-if="values.error">Error</p>
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

## Configuration

```javascript
import { bootstrapFetch } from "@wcstack/fetch";

bootstrapFetch({
  autoTrigger: true,
  triggerAttribute: "data-fetchtarget",
  tagNames: {
    fetch: "wcs-fetch",
    fetchHeader: "wcs-fetch-header",
    fetchBody: "wcs-fetch-body",
  },
});
```

## Design Notes

- `value`, `loading`, `error`, and `status` are **output state**
- `url`, `body`, and `trigger` are **input / command surface**
- `trigger` is intentionally one-way: writing `true` executes, reset emits completion
- `body` is reset to `null` after each `fetch()` call — set it again before each submission
- `manual` is useful when execution timing should be controlled explicitly
- HTML replace mode is optional; the primary wcstack pattern is state-driven binding

## License

MIT
