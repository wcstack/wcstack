# @wcstack/fetch

Declarative fetch component for Web Components. Framework-agnostic async data fetching via [wc-bindable-protocol](https://github.com/nicolo-ribaudo/tc39-proposal-wc-bindable-protocol).

Zero runtime dependencies. Works with any framework — React, Vue, Svelte, or vanilla JavaScript.

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
<script type="module" src="@wcstack/fetch/auto"></script>
```

## Usage

### JSON Mode — API Data Fetching

```html
<wcs-fetch id="user-api" url="/api/users" method="GET"></wcs-fetch>
```

Response data is exposed via `wc-bindable-protocol`. With `@wcstack/state`:

```html
<wcs-state name="app">
  <wcs-fetch url="/api/users" data-wcs="value: users"></wcs-fetch>
  <ul>
    <!--wcs-for items -->
    <template>
      <li data-wcs="textContent: items.*.name"></li>
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

`<wcs-fetch>` declares `wc-bindable-protocol` compliance, making it interoperable with any framework or component that supports the protocol.

```typescript
static wcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "value",   event: "wcs-fetch:response" },
    { name: "loading", event: "wcs-fetch:loading-changed" },
    { name: "error",   event: "wcs-fetch:error" },
    { name: "status",  event: "wcs-fetch:response",
      getter: (e) => e.detail.status },
    { name: "trigger", event: "wcs-fetch:trigger-changed" },
  ],
};
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

## Integration with React

Using `@wc-bindable/react` adapter:

```tsx
import { useWcBindable } from "@wc-bindable/react";

function UserList() {
  const [ref, { value: users, loading, error }] = useWcBindable<HTMLElement>({
    value: null,
    loading: false,
    error: null,
  });

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

No `useEffect`, no `useState` for async state, no cleanup, no race conditions. The adapter reads `wc-bindable` declarations automatically.

## License

MIT
