# @wcstack/upload

`@wcstack/upload` is a declarative file upload component for the wcstack ecosystem.

It is not a visible UI widget.
It is a hidden **upload I/O node** that turns file upload into bindable state.

With `@wcstack/state`, `<wcs-upload>` exposes a small async state surface:

- input / command surface: `files`, `trigger`
- configuration surface: `url`, `method`, `field-name`, `accept`, `max-size`, `manual`, `multiple`
- output state surface: `value`, `loading`, `progress`, `error`, `status`

This means file upload can be expressed as state transitions and DOM bindings instead of ad-hoc `XMLHttpRequest` glue code.

`@wcstack/upload` follows the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) (Core / Shell / Binding Contract) architecture:

- **Core** (`UploadCore`) handles XHR upload, progress tracking, abort, and async state
- **Shell** (`<wcs-upload>`) exposes that state as a custom element and DOM-facing runtime surface
- **Binding Contract** (`static wcBindable`) declares observable `properties`, writable `inputs`, and callable `commands`

## Why this exists

File upload usually spreads across too many places:

- file input handling
- `FormData` creation
- progress events
- loading flags
- error handling
- abort on disconnect

`@wcstack/upload` moves that logic into a reusable component and exposes the result as bindable state.

## Install

```bash
npm install @wcstack/upload
```

## Quick Start

### 1. Auto upload when files are assigned

```html
<script type="module" src="https://esm.run/@wcstack/upload/auto"></script>

<wcs-upload id="avatar-upload" url="/api/upload"></wcs-upload>
<input id="avatar-input" type="file" accept="image/*">

<script type="module">
  const upload = document.getElementById("avatar-upload");
  const input = document.getElementById("avatar-input");

  input.addEventListener("change", () => {
    upload.files = input.files;
  });

  upload.addEventListener("wcs-upload:progress", (event) => {
    console.log("progress", event.detail);
  });

  upload.addEventListener("wcs-upload:response", (event) => {
    console.log("uploaded", event.detail.value);
  });
</script>
```

Default behavior:

- assigning `files` starts upload immediately
- files are sent as `multipart/form-data`
- request method defaults to `POST`
- field name defaults to `file`

### 2. Manual upload with `trigger`

Use `manual` when you want to choose files first and upload later.

```html
<script type="module" src="https://esm.run/@wcstack/upload/auto"></script>

<wcs-upload id="resume-upload" url="/api/upload" manual></wcs-upload>

<input id="resume-input" type="file">
<button id="resume-button">Upload</button>

<script type="module">
  const upload = document.getElementById("resume-upload");
  const input = document.getElementById("resume-input");
  const button = document.getElementById("resume-button");

  input.addEventListener("change", () => {
    upload.files = input.files;
  });

  button.addEventListener("click", () => {
    upload.trigger = true;
  });
</script>
```

`trigger` is a one-way command surface:

- writing `true` starts `upload()`
- after completion it resets itself to `false`
- that reset dispatches `wcs-upload:trigger-changed`

Only the `false` reset is observable: the `true` transition (upload start) does **not** dispatch `wcs-upload:trigger-changed`. A binding system writes `true` to start and observes the single `false` edge to know the command finished. This is the same trade-off as `@wcstack/fetch`'s `trigger`.

### 3. Declarative trigger target

When auto trigger is enabled, a clickable element can point at a `<wcs-upload>` by id.

```html
<script type="module" src="https://esm.run/@wcstack/upload/auto"></script>

<wcs-upload id="photo-upload" url="/api/upload" manual></wcs-upload>
<input id="photo-input" type="file">
<button data-uploadtarget="photo-upload">Upload</button>

<script type="module">
  const upload = document.getElementById("photo-upload");
  const input = document.getElementById("photo-input");

  input.addEventListener("change", () => {
    upload.files = input.files;
  });
</script>
```

By default, the trigger attribute is `data-uploadtarget`.

### 4. With `@wcstack/state`

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/upload/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      uploadResult: null,
      uploadLoading: false,
      uploadProgress: 0,
      uploadError: null,
    };
  </script>

  <wcs-upload
    id="state-upload"
    url="/api/upload"
    manual
    data-wcs="
      value: uploadResult;
      loading: uploadLoading;
      progress: uploadProgress;
      error: uploadError
    ">
  </wcs-upload>

  <input id="state-upload-input" type="file">
  <button data-uploadtarget="state-upload">Upload</button>

  <progress max="100" data-wcs="value: uploadProgress"></progress>
  <p data-wcs="textContent: uploadLoading"></p>

  <script type="module">
    const upload = document.getElementById("state-upload");
    const input = document.getElementById("state-upload-input");

    input.addEventListener("change", () => {
      upload.files = input.files;
    });
  </script>
</wcs-state>
```

In this setup, upload becomes a bindable async node:

- the element performs the request
- async state flows back as `value`, `loading`, `progress`, `error`, `status`
- the UI binds to those paths declaratively

## Public API

### Element attributes and properties

| Name | Type | Default | Description |
|---|---|---|---|
| `url` | `string` | `""` | Upload endpoint |
| `method` | `string` | `"POST"` | HTTP method |
| `field-name` | `string` | `"file"` | FormData field name |
| `multiple` | `boolean` | `false` | Declarative marker only — it advertises multi-file intent but does not enforce file count (any number of files in `files` is sent regardless) |
| `max-size` | `number` | `Infinity` | Maximum allowed file size in bytes |
| `accept` | `string` | `""` | Accepted MIME types or file extensions |
| `manual` | `boolean` | `false` | Disables auto upload on `files` assignment |
| `files` | `FileList \| File[] \| null` | `null` | Files to upload |
| `trigger` | `boolean` | `false` | Write-only command surface for manual upload |
| `value` | `any` | `null` | Parsed response body or response text |
| `loading` | `boolean` | `false` | Upload state flag |
| `progress` | `number` | `0` | Upload progress from `0` to `100` |
| `error` | `any` | `null` | Validation, network, or response error |
| `status` | `number` | `0` | HTTP response status |
| `errorInfo` | `WcsIoErrorInfo \| null` | `null` | Serializable failure taxonomy (stable `code` / `phase` / `recoverable`). Additive — `error` is unchanged; `code` is `capability-missing`, `invalid-argument`, `network`, or `http-error`. An `abort()` is not a failure (no `errorInfo`) |
| `promise` | `Promise<any>` | resolved `null` | Current upload promise |

### Methods

#### `upload()`

Starts upload with the current `files` and returns a promise.

The promise **resolves** in every terminal case and never rejects:

- success → resolves to the parsed response body (`value`)
- no files / no `url` → resolves to `null` (no-op; no request is started and no error is dispatched)
- validation failure → resolves to `null` (and dispatches `wcs-upload:error`)
- HTTP error (status >= 400) → resolves to `null` (the error object is exposed on `error` / `wcs-upload:error`)
- network error → resolves to `null` (the error is exposed on `error` / `wcs-upload:error`)
- abort → resolves to `null`

Because `null` is also a valid resolved value, do not use the resolved value to detect failure — observe `error` / `status` (or the `wcs-upload:error` / `wcs-upload:response` events) instead. This mirrors `@wcstack/fetch`, where errors flow through state rather than promise rejection.

> Note on the headless Core: `UploadCore.upload(url, files)` is `async` and **never throws / never rejects**. A synchronously-detectable argument error (missing `url` or empty `files`) is surfaced on the `error` property as a plain `{ message }` object and dispatched as `wcs-upload:error`, and the call resolves to `null`. The Shell's `upload()` never reaches this path: it owns the `url`/file lifecycle and returns `null` for a missing `url` or missing files, treating "no destination" / "no files" as a **silent** no-op (no `error` is set, no event fired).

#### `abort()`

Aborts the current request. Loading is cleared through the request's abort path (consistent with `@wcstack/fetch`).

## Events

| Event | `detail` | Description |
|---|---|---|
| `wcs-upload:files-changed` | `FileList \| File[] \| null` | Fired when `files` changes |
| `wcs-upload:trigger-changed` | `boolean` | Fired when `trigger` resets to `false` |
| `wcs-upload:loading-changed` | `boolean` | Fired when loading state changes |
| `wcs-upload:progress` | `number` | Fired on upload progress updates |
| `wcs-upload:error` | error object | Fired on validation, network, or HTTP error |
| `wcs-upload:response` | `{ value, status }` | Fired on successful HTTP response |

## Validation

`<wcs-upload>` validates files before sending:

- `max-size` rejects files larger than the configured byte size
- `accept` supports MIME types like `image/*`, exact MIME types like `application/pdf`, and extensions like `.pdf`

Files whose `type` is empty (the OS could not determine a MIME type) cannot be matched against MIME patterns. Such files are accepted only if `accept` contains a matching extension pattern (e.g. `.png`); if `accept` lists MIME patterns exclusively, an empty-type file is rejected because its type cannot be verified.

Validation failure dispatches `wcs-upload:error` and the request is not started.

### Error vs response on the state surface

On a successful response (status 2xx), both `value` and `status` are updated via `wcs-upload:response`. On an HTTP error (status >= 400), only `error` is updated (via `wcs-upload:error`) — **`status` is not propagated to the state surface in the error case**, because `status` is bound to the `wcs-upload:response` event, which is not dispatched for errors. The HTTP status code is still available inside the `error` object (`error.status`). This is the same trade-off as `@wcstack/fetch`: error details flow through the single `error` channel rather than splitting across response/error events.

> Reading `core.status` / `el.status` directly returns the HTTP status of the last response, including error statuses such as `413` or `500` (the getter reflects the raw XHR status). This differs from the bound `status` path (driven by `wcs-upload:response`), which stays at its previous value on an error. Code that reads the getter imperatively and code that binds to `status` therefore observe different values after an HTTP error; prefer one path consistently. This is the same structure as `@wcstack/fetch`.

### Progress on error

`progress` is only reset to `0` at the start of each upload and set to `100` on success. On an HTTP, network, or abort error, **`progress` is intentionally left at its last value** (e.g. `70`) so the UI can show where the transfer stopped. Use `error` / `loading` (not `progress`) to detect failure, and reset or hide the progress indicator from your UI in response to `wcs-upload:error` if you do not want a stale value displayed. A subsequent `upload()` resets `progress` back to `0`.

## CSS styling with `:state()`

`<wcs-upload>` reflects two boolean output states onto its
[`ElementInternals` `CustomStateSet`](https://developer.mozilla.org/en-US/docs/Web/API/CustomStateSet),
so you can style it directly from CSS with the `:state()` pseudo-class — no
`data-wcs` binding or extra class toggling required.

| State | On when |
|-------|---------|
| `loading` | `wcs-upload:loading-changed` fires with `true` (cleared on `false`) |
| `error` | `wcs-upload:error` fires with a non-`null` detail (cleared on `null`) |

`progress` is not reflected (continuous values are excluded from `:state()` reflection).

```css
wcs-upload:state(loading) ~ .spinner { display: block; }
wcs-upload:state(loading) ~ .spinner { display: none; } /* default */

form:has(wcs-upload:state(error)) .banner { display: block; }
```

Unlike attributes or classes, `:state()` cannot be written from outside the
element, so there is no risk of confusing this output state with an input.

**Browser support** (`:state(x)` syntax): Chrome/Edge 125+, Safari 17.4+,
Firefox 126+. In older browsers the states are simply never set — `:state()`
selectors never match, but `<wcs-upload>` itself keeps working normally
(graceful degradation, never-throw).

**SSR**: `:state()` cannot be serialized into HTML, so server-rendered markup
never carries these states on first paint (`@wcstack/server` is unaffected).
If you need to style the pre-hydration gap, pair your rule with
`wcs-upload:not(:defined)` instead.

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
  <wcs-upload url="/api/upload" debug-states></wcs-upload>
  ```

**Write your CSS against `:state()`, not `data-wcs-state-*`.** The mirrored
attributes exist purely to make state changes visible while debugging with
DevTools open; they are not a supported styling hook.

## wc-bindable-protocol

Both `UploadCore` and `<wcs-upload>` declare `wc-bindable-protocol` compliance, making them interoperable with any framework or component that supports the protocol.

The declaration follows the full wc-bindable interface model — three independent surfaces:

- **`properties`** — observable outputs that `bind()` subscribes to (`value`, `loading`, `progress`, `error`, `status`, and the Shell's `trigger` / `files`)
- **`inputs`** — the settable surface (`url`, `method`, `fieldName`, …); declarative metadata that tooling, codegen, and remote proxying read
- **`commands`** — invocable methods (`upload`, `abort`); a binding system such as `@wcstack/state` can invoke them by name

Per the protocol, only `properties` is interpreted by core `bind()`; `inputs` / `commands` (and the `attribute` / `async` hints) are descriptive. They do **not** create implicit two-way data flow.

### Core (`UploadCore`)

`UploadCore` declares the bindable async state that any runtime can subscribe to, plus its portable input/command surface:

```typescript
static wcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "value",    event: "wcs-upload:response",
      getter: (e) => e.detail.value },
    { name: "loading",  event: "wcs-upload:loading-changed" },
    { name: "progress", event: "wcs-upload:progress" },
    { name: "error",    event: "wcs-upload:error" },
    { name: "status",   event: "wcs-upload:response",
      getter: (e) => e.detail.status },
  ],
  inputs: [
    { name: "url" },
    { name: "method" },
    { name: "fieldName" },
  ],
  commands: [
    { name: "upload", async: true },
    { name: "abort" },
  ],
};
```

Headless consumers call `core.upload(url, files)` directly — no `trigger` needed.

### Shell (`<wcs-upload>`)

The Shell extends the Core declaration with the `trigger` / `files` outputs and the DOM-driven input surface; `commands` (`upload` / `abort`) are inherited unchanged:

```typescript
static wcBindable = {
  ...UploadCore.wcBindable,
  properties: [
    ...UploadCore.wcBindable.properties,
    { name: "trigger", event: "wcs-upload:trigger-changed" },
    { name: "files",   event: "wcs-upload:files-changed" },
  ],
  inputs: [
    { name: "url" },
    { name: "method" },
    { name: "fieldName" },
    { name: "multiple" },
    { name: "maxSize" },
    { name: "accept" },
    { name: "manual" },
    { name: "files" },
    { name: "trigger" },
  ],
};
```

The Shell's inputs intentionally carry no `attribute` hint: each attribute-backed setter (`url`, `method`, `fieldName`, `multiple`, `maxSize`, `accept`, `manual`) already reflects to its attribute, so a binding system that mirrors `inputs[].attribute` would set the attribute twice.

This makes the element consumable from any wc-bindable-aware system, including `@wcstack/state`.

## Headless API

If you do not need the custom element shell, you can use `UploadCore` directly:

```ts
import { UploadCore } from "@wcstack/upload";

const core = new UploadCore();
const result = await core.upload("/api/upload", files, {
  method: "PUT",
  fieldName: "attachment",
  headers: {
    Authorization: "Bearer token",
  },
});
```

`UploadCore` exposes the same async state as properties and dispatches the same events.

## Manual bootstrap

```ts
import { bootstrapUpload } from "@wcstack/upload";

bootstrapUpload({
  autoTrigger: true,
  triggerAttribute: "data-uploadtarget",
  tagNames: {
    upload: "wcs-upload",
  },
});
```

Use this when you want to customize the tag name or trigger attribute instead of relying on `@wcstack/upload/auto`.