# @wcstack/fetch

`@wcstack/fetch` is a headless fetch component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **I/O node** that connects HTTP requests to reactive state.

With `@wcstack/state`, `<wcs-fetch>` can be bound directly through path contracts:

- **input / command surface**: `url`, `body`, `trigger`
- **output state surface**: `value`, `loading`, `error`, `status`

This means async communication can be expressed declaratively in HTML, without writing `fetch()`, `async/await`, or loading/error glue code in your UI layer.

`@wcstack/fetch` follows the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) (Core / Shell / Binding Contract) architecture:

- **Core** (`FetchCore`) handles HTTP, abort, and async state
- **Shell** (`<wcs-fetch>`) connects that state to the DOM
- **Binding Contract** (`static wcBindable`) declares observable `properties`, writable `inputs`, and callable `commands`

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
</wcs-state>

<wcs-fetch data-wcs="url: usersUrl; value: users"></wcs-fetch>

<ul>
  <template data-wcs="for: users">
    <li data-wcs="textContent: users.*.name"></li>
  </template>
</ul>
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
</wcs-state>

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
</wcs-state>

<wcs-fetch
  url="/api/users"
  manual
  data-wcs="trigger: shouldRefresh; value: users; loading: listLoading">
</wcs-fetch>

<button data-wcs="onclick: reload">Refresh</button>
```

`trigger` is a **one-way command surface**:

- writing `true` starts `fetch()`
- it resets itself to `false` after completion
- the reset emits `wcs-fetch:trigger-changed`

```
external write:  false → true   No event (triggers fetch)
auto-reset:      true  → false  Dispatches wcs-fetch:trigger-changed
```

If `url` is empty when `true` is written (e.g. a state-driven computed url not yet
resolved), the write is **silently ignored**: no fetch runs, `trigger` stays `false`,
and no event fires. Set the `url` first, then write `true` again to execute.

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
</wcs-state>

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
```

### 5. Infinite scroll with `<wcs-infinite-scroll>`

`<wcs-infinite-scroll>` runs an existing `<wcs-fetch>` when its sentinel element enters the viewport.
Keep page numbers, next URLs, and response append behavior in `@wcstack/state`; this tag only owns scroll detection.

Behavior rules:

- it does not trigger again while the target `<wcs-fetch>` is `loading`
- `once` is strict: after the first execution, changing attributes does not re-arm observation
- if `target` does not resolve, or resolves to a non-`<wcs-fetch>` element, it is a silent no-op

```html
<wcs-state>
  <script type="module">
    export default {
      page: 1,
      users: [],
      get nextUsersUrl() {
        return "/api/users?page=" + this.page;
      },
    };
  </script>
</wcs-state>

<wcs-fetch
  id="next-page-fetch"
  manual
  data-wcs="url: nextUsersUrl; loading: listLoading; error: listError">
</wcs-fetch>

<ul>
  <template data-wcs="for: users">
    <li data-wcs="textContent: users.*.name"></li>
  </template>
</ul>

<wcs-infinite-scroll
  target="next-page-fetch"
  root-margin="240px 0px">
</wcs-infinite-scroll>
```

Attributes:

- `target`: `id` of the `<wcs-fetch>` to run
- `root`: `id` of the scroll container. Defaults to the viewport
- `root-margin`: preload distance. Passed to `IntersectionObserver.rootMargin`
- `threshold`: intersection threshold. Defaults to `0`
- `disabled`: stops observing
- `once`: disconnects after the first execution and does not re-arm afterwards

## State Surface vs Command Surface

`<wcs-fetch>` exposes two different kinds of properties.

### Output state (bindable async state)

These properties represent the result of the current request and are the main observable surface:

| Property | Type | Description |
|----------|------|-------------|
| `value` | `any` | Response data. **Reset to `null` on HTTP error** (status >= 400) |
| `loading` | `boolean` | `true` while a request is in flight |
| `error` | `WcsFetchHttpError \| Error \| null` | HTTP or network error |
| `status` | `number` | HTTP status code |
| `objectURL` | `string \| null` | Managed object URL for a `response-type="blob"` response; `null` otherwise. The Core revokes the previous URL on each new response and on dispose, so it can be bound straight into `<img src>` |
| `errorInfo` | `WcsIoErrorInfo \| null` | Serializable failure taxonomy (stable `code` / `phase` / `recoverable`), or `null`. Additive — the `error` shape is unchanged; fires `wcs-fetch:error-info-changed` |

> **Note:** On an HTTP error, `value` is reset to `null` and `status` carries the
> error code. If you bind only `value` (without observing `error`), the previous
> successful value disappears when a request fails. Bind `error` to handle the
> failure case explicitly.

### Input / command surface

These properties control request execution from HTML, JS, or `@wcstack/state` bindings:

| Property | Type | Description |
|----------|------|-------------|
| `url` | `string` | Request URL |
| `body` | `any` | Request body (resets to `null` after `fetch()`) |
| `trigger` | `boolean` | One-way execution trigger |
| `manual` | `boolean` | Disables auto-fetch on connect / URL change |

## CSS styling with `:state()`

`<wcs-fetch>` reflects two boolean output states onto its
[`ElementInternals` `CustomStateSet`](https://developer.mozilla.org/en-US/docs/Web/API/CustomStateSet),
so you can style it directly from CSS with the `:state()` pseudo-class — no
`data-wcs` binding or extra class toggling required.

| State | On when |
|-------|---------|
| `loading` | `wcs-fetch:loading-changed` fires with `true` (cleared on `false`) |
| `error` | `wcs-fetch:error` fires with a non-`null` detail (cleared on `null`) |

```css
wcs-fetch:state(loading) ~ .spinner { display: block; }
wcs-fetch:state(loading) ~ .spinner { display: none; } /* default */

form:has(wcs-fetch:state(error)) .banner { display: block; }
```

Unlike attributes or classes, `:state()` cannot be written from outside the
element, so there is no risk of confusing this output state with an input.

**Browser support** (`:state(x)` syntax): Chrome/Edge 125+, Safari 17.4+,
Firefox 126+. In older browsers the states are simply never set — `:state()`
selectors never match, but `<wcs-fetch>` itself keeps working normally
(graceful degradation, never-throw).

**SSR**: `:state()` cannot be serialized into HTML, so server-rendered markup
never carries these states on first paint (`@wcstack/server` is unaffected).
If you need to style the pre-hydration gap, pair your rule with
`wcs-fetch:not(:defined)` instead.

### Debugging

Custom states are invisible in DevTools' Elements panel and `attachInternals()`
cannot be called twice, so there is no console way to inspect them directly.
Two debug-only aids are provided for that:

- `el.debugStates` — a **snapshot** array of the currently-on state names
  (e.g. `["loading"]`). It is not part of `wc-bindable` (not a bind target)
  and its shape is not a guaranteed contract — use it for debugging only.
- The `debug-states` attribute (opt-in, default off) mirrors state changes
  onto `data-wcs-state-loading` / `data-wcs-state-error` attributes on the
  element, so the Elements panel highlights them as they toggle:

  ```html
  <wcs-fetch url="/api/users" debug-states></wcs-fetch>
  ```

**Write your CSS against `:state()`, not `data-wcs-state-*`.** The mirrored
attributes exist purely to make state changes visible while debugging with
DevTools open; they are not a supported styling hook.

## Architecture

`@wcstack/fetch` follows the CSBC architecture.

### Core: `FetchCore`

`FetchCore` is a pure `EventTarget` class.
It contains:

- HTTP execution
- abort control
- async state transitions
- `wc-bindable-protocol` declaration for observable state and callable commands

It can run headlessly in any runtime that supports `EventTarget` and `fetch`.

### Shell: `<wcs-fetch>`

`<wcs-fetch>` is a thin `HTMLElement` wrapper around `FetchCore`.
It adds:

- attribute / property mapping
- DOM lifecycle integration
- declarative execution helpers such as `trigger`
- `wc-bindable-protocol` inputs for DOM-facing configuration and command properties

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

## Capability & error taxonomy

**`errorInfo`** is an additive wc-bindable property (see the property tables
above): the existing `error` property/event shape is **unchanged**, and `errorInfo`
projects the last failure's serializable taxonomy (`WcsIoErrorInfo`, shape under
[TypeScript Types](#typescript-types)) so DevTools and adopters can classify
failures without any breaking change.

Two related signals are **Core-only opt-in getters** on `FetchCore` (not
`wc-bindable` properties, so not `data-wcs` bind targets):

| Getter | Type | Description |
|--------|------|-------------|
| `supported` | `boolean` | Whether the required capability (`web.fetch`) is available **now** — call-time feature detection, not User-Agent |
| `platformAssessment` | `PlatformAssessment` | Full capability assessment (availability / readiness / preconditions), probed at call time |

Feature detection runs just before a request starts, never at module load (so
importing `FetchCore` stays safe under SSR / workers):

- If `web.fetch` is **missing** (old runtime / some SSR / headless), `fetch()`
  does **not** start — it surfaces `errorInfo.code === "capability-missing"` and
  sets `error` to a matching message (no generic network-error path).
- If `web.abort-controller` is **missing**, the request runs **degraded** (no
  native abort signal); supersede / dispose still work, and
  `platformAssessment.readiness` becomes `"degraded"`.

## URL Observation

By default, `<wcs-fetch>` automatically executes a request when:

1. it is connected to the DOM and `url` is set
2. the `url` changes

If a request is already in flight when the URL changes, the previous request is automatically aborted before the new one starts.

Set the `manual` attribute to disable auto-fetch and control execution explicitly via `fetch()` or `trigger`.

> **Note (since v1.13):** Auto-fetch is deferred to a microtask instead of firing
> synchronously. Multiple input writes in the same tick (e.g. a `...:` spread
> writing `url` and `manual` in sequence) collapse into a single decision made
> against the final element state, and rewriting an unchanged `url` does not
> refetch. To await the connect-time fetch, use `connectedCallbackPromise` —
> reading `promise` synchronously right after `appendChild` returns the initial
> resolved promise, not the auto-fetch. Explicit triggers (`fetch()`, `trigger`,
> the `fetch` command) are unaffected and still run immediately.

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

> **Security note:** The response is assigned directly to `targetElement.innerHTML`
> without sanitization. Only use `target` with fragments from a trusted endpoint
> you control. Untrusted HTML can carry XSS payloads (e.g. event-handler
> attributes). For untrusted or user-influenced content, bind `value` into state
> and render through `@wcstack/state` text bindings instead.

## Optional DOM Triggering

If `autoTrigger` is enabled (default), clicking an element with `data-fetchtarget` triggers the corresponding `<wcs-fetch>` element:

```html
<button data-fetchtarget="user-fetch">Load Users</button>
<wcs-fetch id="user-fetch" url="/api/users"></wcs-fetch>
```

Event delegation is used — works with dynamically added elements. The `closest()` API handles nested elements (e.g., icon inside a button).

A matched click calls `event.preventDefault()` before triggering the fetch, so the
element's default action is suppressed. This is intentional for the common case of
firing a request without navigating. Avoid putting `data-fetchtarget` on an element
whose default action you also want (e.g. a real `<a href>` link or a form-`submit`
button) — the navigation/submit will be cancelled. Use a plain `<button type="button">`.

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
| `response-type` | `"auto" \| "json" \| "text" \| "blob" \| "arrayBuffer"` | `auto` | How to read the response body. `auto` sniffs Content-Type; `blob` additionally publishes a managed `objectURL`. `target` (HTML-replace) overrides this |

| Property | Type | Description |
|----------|------|-------------|
| `value` | `any` | Response data |
| `loading` | `boolean` | `true` while request is in flight |
| `error` | `WcsFetchHttpError \| Error \| null` | Error info |
| `status` | `number` | HTTP status code |
| `objectURL` | `string \| null` | Managed object URL for a `response-type="blob"` response; `null` otherwise |
| `errorInfo` | `WcsIoErrorInfo \| null` | Serializable failure taxonomy (stable `code` / `phase` / `recoverable`), or `null` |
| `responseType` | `"auto" \| "json" \| "text" \| "blob" \| "arrayBuffer"` | Response body interpretation (backs the `response-type` attribute) |
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

The declaration follows the full wc-bindable interface model — three independent surfaces:

- **`properties`** — observable outputs that `bind()` subscribes to (`value`, `loading`, `error`, `status`, `objectURL`, `errorInfo`, and the Shell's `trigger`)
- **`inputs`** — the settable surface (`url`, `method`, …); declarative metadata that tooling, codegen, and remote proxying read
- **`commands`** — invocable methods (`fetch`, `abort`); a binding system such as `@wcstack/state` can invoke them by name

Per the protocol, only `properties` is interpreted by core `bind()`; `inputs` / `commands` (and the `attribute` / `async` hints) are descriptive. They do **not** create implicit two-way data flow.

### Core (`FetchCore`)

`FetchCore` declares the bindable async state that any runtime can subscribe to, plus its portable input/command surface:

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
    { name: "objectURL", event: "wcs-fetch:response",
      getter: (e) => e.detail.objectURL },
    { name: "errorInfo", event: "wcs-fetch:error-info-changed" },
  ],
  inputs: [
    { name: "url" },
    { name: "method" },
  ],
  commands: [
    { name: "fetch", async: true },
    { name: "abort" },
  ],
};
```

Headless consumers call `core.fetch(url)` directly — no `trigger` needed.

### Shell (`<wcs-fetch>`)

The Shell extends the Core declaration with the `trigger` output and the DOM-driven input surface; `commands` (`fetch` / `abort`) are inherited unchanged:

```typescript
static wcBindable = {
  ...FetchCore.wcBindable,
  properties: [
    ...FetchCore.wcBindable.properties,
    { name: "trigger", event: "wcs-fetch:trigger-changed" },
  ],
  inputs: [
    { name: "url" },
    { name: "method" },
    { name: "target" },
    { name: "manual" },
    { name: "body" },
    { name: "responseType" },
    { name: "trigger" },
  ],
};
```

The Shell's inputs intentionally carry no `attribute` hint: each setter (`url`, `method`, `target`, `manual`, `responseType`) already reflects to its attribute, so a binding system that mirrors `inputs[].attribute` would set the attribute twice.

## TypeScript Types

```typescript
import type {
  WcsFetchHttpError, WcsFetchCoreValues, WcsFetchValues, WcsIoErrorInfo
} from "@wcstack/fetch";
```

```typescript
// HTTP error (status >= 400)
interface WcsFetchHttpError {
  status: number;
  statusText: string;
  body: string;
}

// Serializable failure taxonomy (value of the `errorInfo` property)
interface WcsIoErrorInfo {
  code: string; // stable: "capability-missing" | "invalid-argument" | "network" | "http-error" | "timeout" | "aborted"
  phase: "probe" | "start" | "execute" | "decode" | "commit" | "dispose";
  recoverable: boolean;
  capabilityId?: string;
  message: string;
}

// Core (headless) — 6 async state properties
// T defaults to unknown; pass a type argument for typed `value`
interface WcsFetchCoreValues<T = unknown> {
  value: T;
  loading: boolean;
  error: WcsFetchHttpError | Error | null;
  status: number;
  objectURL: string | null; // managed object URL for a responseType:"blob" response, else null
  errorInfo: WcsIoErrorInfo | null; // last failure's serializable taxonomy, else null
}

// Shell (<wcs-fetch>) — extends Core with trigger
interface WcsFetchValues<T = unknown> extends WcsFetchCoreValues<T> {
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

Since `<wcs-fetch>` exposes a CSBC `wc-bindable-protocol` contract, it works with any framework through thin adapters from `@wc-bindable/*`.

### React

```tsx
import { useWcBindable } from "@wc-bindable/react";
import type { WcsFetchValues } from "@wcstack/fetch";

interface User { id: number; name: string; }

function UserList() {
  const [ref, { value: users, loading, error }] =
    useWcBindable<HTMLElement, WcsFetchValues<User[]>>();

  return (
    <>
      <wcs-fetch ref={ref} url="/api/users" />
      {loading && <p>Loading...</p>}
      {error && <p>Error</p>}
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

interface User { id: number; name: string; }

const { ref, values } = useWcBindable<HTMLElement, WcsFetchValues<User[]>>();
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

interface User { id: number; name: string; }

function UserList() {
  const [values, directive] = createWcBindable<WcsFetchValues<User[]>>();

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

- `value`, `loading`, `error`, `status`, `objectURL`, and `errorInfo` are **output state**
- `url`, `body`, `response-type`, and `trigger` are **input / command surface**
- `response-type` (default `auto`) selects how the response body is read; `blob` additionally publishes a managed `objectURL` (revoked on each new response / dispose). `target` (HTML-replace mode) overrides it
- `trigger` is intentionally one-way: writing `true` executes, reset emits completion. Writing `true` while `url` is empty is silently ignored (no fetch, no event, flag stays `false`)
- on an HTTP error (status >= 400), `value` is reset to `null` while `status` carries the error code — a `value`-only binding loses its previous value, so bind `error` to detect failures
- on a network error (no HTTP response — DNS failure, offline, CORS, etc.), `value` is reset to `null` and `status` to `0`; `error` holds the thrown `Error`. Like HTTP errors, a previous successful value/status does not linger
- `method="HEAD"` skips response-body reading by spec (no body); `value` stays `null` and only `status` is surfaced
- `body` is reset to `null` after each `fetch()` call — set it again before each submission
- `manual` is useful when execution timing should be controlled explicitly
- HTML replace mode is optional; the primary wcstack pattern is state-driven binding

## License

MIT
