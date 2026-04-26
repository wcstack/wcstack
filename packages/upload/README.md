# @wcstack/upload

`@wcstack/upload` is a declarative file upload component for the wcstack ecosystem.

It is not a visible UI widget.
It is a hidden **upload I/O node** that turns file upload into bindable state.

With `@wcstack/state`, `<wcs-upload>` exposes a small async state surface:

- input / command surface: `files`, `trigger`
- configuration surface: `url`, `method`, `field-name`, `accept`, `max-size`, `manual`, `multiple`
- output state surface: `value`, `loading`, `progress`, `error`, `status`

This means file upload can be expressed as state transitions and DOM bindings instead of ad-hoc `XMLHttpRequest` glue code.

`@wcstack/upload` follows the same HAWC-style split as other wcstack I/O packages:

- **Core** (`UploadCore`) handles XHR upload, progress tracking, abort, and async state
- **Shell** (`<wcs-upload>`) exposes that state as a custom element and `wc-bindable` surface
- frameworks and binding systems consume it through `wc-bindable-protocol`

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
| `multiple` | `boolean` | `false` | Marks the element as multi-file capable |
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
| `promise` | `Promise<any>` | resolved `null` | Current upload promise |

### Methods

#### `upload()`

Starts upload with the current `files` and returns a promise.
Returns `null` when there are no files or validation fails.

#### `abort()`

Aborts the current request.

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

Validation failure dispatches `wcs-upload:error` and the request is not started.

## wc-bindable surface

`<wcs-upload>` exposes a `wcBindable` definition with these bindable properties:

- `value`
- `loading`
- `progress`
- `error`
- `status`
- `trigger`
- `files`

This makes the element consumable from wc-bindable-aware systems, including `@wcstack/state`.

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