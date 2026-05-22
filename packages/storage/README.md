# @wcstack/storage

`@wcstack/storage` is a headless storage component for the wcstack ecosystem.

It is not a visual UI widget.
It is an **I/O node** that connects browser storage (localStorage / sessionStorage) to reactive state.

When combined with `@wcstack/state`, `<wcs-storage>` can be bound directly through a path contract:

- **Input / Command Surface**: `key`, `type`, `trigger`
- **Output State Surface**: `value`, `loading`, `error`

This means you can express browser storage persistence declaratively in HTML, without writing `localStorage.getItem()`, `JSON.parse()`, or serialization glue code in the UI layer.

`@wcstack/storage` follows the [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md) architecture:

- **Core** (`StorageCore`) handles storage read/write and cross-tab sync
- **Shell** (`<wcs-storage>`) connects that state to the DOM
- Frameworks and binding systems consume it via the [wc-bindable-protocol](https://github.com/wc-bindable-protocol/wc-bindable-protocol)

## Why this exists

Frontend applications frequently use localStorage / sessionStorage for persisting user settings and session data. Yet the glue code — reading, JSON parsing, saving, error handling — follows the same pattern every time.

`@wcstack/storage` moves that glue code into a reusable component and exposes the stored value as bindable state.

The flow with `@wcstack/state`:

1. `<wcs-storage>` auto-loads from storage on connection
2. `value` is bound to the UI via `data-wcs`
3. State changes are automatically written back to storage
4. Changes from other tabs are automatically detected

Persistence becomes a **state transition**, not imperative glue code.

## Install

```bash
npm install @wcstack/storage
```

## Quick Start

### 1. Primitive value auto-save

Primitive values (strings, numbers, booleans) work with just a `value` binding for two-way persistence.

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/storage/auto"></script>

<wcs-state>
  <script type="module">
    export default { username: "" };
  </script>
</wcs-state>

<wcs-storage key="username" data-wcs="value: username"></wcs-storage>

<input data-wcs="value: username" placeholder="Username">
<p>Saved: <span data-wcs="textContent: username"></span></p>
```

This is the default mode:

- Set a `key` to auto-load on connection
- Bind to `value` for two-way persistence
- Optionally bind `loading` and `error` as well

### 2. Persisting objects with `$trackDependency`

When sub-properties of an object (e.g. `settings.theme`) change, the parent path `settings` binding does **not** fire.
This is because `@wcstack/state`'s dependency walk is **parent → child only**.

In this case, use `$trackDependency` to explicitly list the sub-properties to watch, and save via `trigger`:

```html
<wcs-state>
  <script type="module">
    export default defineState({
      settings: { theme: "light", lang: "en" },

      get settingsChanged() {
        this.$trackDependency("settings.theme");
        this.$trackDependency("settings.lang");
        return true;
      },
    });
  </script>
</wcs-state>

<wcs-storage key="app-settings" manual
  data-wcs="value: settings; trigger: settingsChanged">
</wcs-storage>

<select data-wcs="value: settings.theme">
  <option value="light">Light</option>
  <option value="dark">Dark</option>
</select>

<select data-wcs="value: settings.lang">
  <option value="en">English</option>
  <option value="ja">日本語</option>
</select>
```

**Flow:**

1. User changes theme → `settings.theme` updates
2. Dynamic dependency triggers `settingsChanged` re-evaluation → returns `true`
3. `trigger: settingsChanged` binding fires → `save()` executes
4. The entire `settings` object is saved to localStorage

### 3. Using sessionStorage

Use `type="session"` for sessionStorage:

```html
<wcs-state>
  <script type="module">
    export default { sessionData: null };
  </script>
</wcs-state>

<wcs-storage key="session-data" type="session"
  data-wcs="value: sessionData">
</wcs-storage>

<p data-wcs="textContent: sessionData"></p>
```

### 4. Cross-tab sync

localStorage changes are automatically detected from other tabs:

```html
<wcs-state>
  <script type="module">
    export default { sharedCounter: 0 };
  </script>
</wcs-state>

<wcs-storage key="shared-counter"
  data-wcs="value: sharedCounter">
</wcs-storage>

<!-- Changes from other tabs update this value automatically -->
<p data-wcs="textContent: sharedCounter"></p>
```

> **Note**: The `storage` event only fires for changes made in other tabs of the same origin. Since sessionStorage is not shared across tabs, cross-tab sync only works with localStorage.

## State Surface vs Command Surface

`<wcs-storage>` exposes two kinds of properties.

### Output State (bindable state)

Represents the current storage value and is the CSBC main surface:

| Property | Type | Description |
|----------|------|-------------|
| `value` | `any` | Value stored in storage |
| `loading` | `boolean` | `true` during read/write |
| `error` | `WcsStorageError \| Error \| null` | Storage operation error |

### Input / Command Surface

Controls storage operations from HTML, JS, or `@wcstack/state` bindings:

| Property | Type | Description |
|----------|------|-------------|
| `key` | `string` | Storage key |
| `type` | `"local" \| "session"` | Storage type |
| `value` | `any` | Setting this auto-saves (when not `manual`) |
| `trigger` | `boolean` | One-way save trigger |
| `manual` | `boolean` | Disables auto-load and auto-save |

## Architecture

`@wcstack/storage` follows the CSBC architecture.

### Core: `StorageCore`

`StorageCore` is a pure `EventTarget` class. It encapsulates:

- Storage read, write, and remove
- Automatic JSON serialization / deserialization
- Cross-tab sync via `storage` event
- `wc-bindable-protocol` declaration

It works headlessly in any runtime that supports `EventTarget` and `localStorage` / `sessionStorage`.

### Shell: `<wcs-storage>`

`<wcs-storage>` is a thin `HTMLElement` wrapper around `StorageCore`. It adds:

- Attribute / property mapping
- DOM lifecycle integration (auto-load on connect, cleanup on disconnect)
- Auto-save via the `value` setter
- Declarative execution helpers like `trigger`

This separation keeps storage logic portable while enabling natural integration with DOM-based binding systems like `@wcstack/state`.

### Target injection

Core uses **target injection** to fire events directly on the Shell, avoiding event re-dispatch.

## Headless usage (Core only)

`StorageCore` can be used standalone without DOM. It declares `static wcBindable`, so you can subscribe to state with `bind()` from `@wc-bindable/core` — the same mechanism used by framework adapters:

```typescript
import { StorageCore } from "@wcstack/storage";
import { bind } from "@wc-bindable/core";

const core = new StorageCore();

const unbind = bind(core, (name, value) => {
  console.log(`${name}:`, value);
});

core.key = "my-data";
core.load();

unbind();
```

### Auto JSON serialization

`StorageCore` automatically serializes and deserializes based on data type:

| Type on save | Format in storage | Type on load |
|-------------|-------------------|-------------|
| Object / Array | `JSON.stringify()` result | `JSON.parse()` result |
| String | As-is | Parsed if valid JSON, otherwise the raw string |
| Number / boolean | `JSON.stringify()` result | `JSON.parse()` result |
| `null` / `undefined` | Key removed | `null` |

## Element Reference

### `<wcs-storage>`

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `key` | `string` | — | Storage key |
| `type` | `"local" \| "session"` | `local` | Storage type |
| `manual` | `boolean` | `false` | Disables auto-load and auto-save |

| Property | Type | Description |
|----------|------|-------------|
| `value` | `any` | Storage value (auto-saves on set) |
| `loading` | `boolean` | `true` during read/write |
| `error` | `WcsStorageError \| Error \| null` | Error info |
| `trigger` | `boolean` | Set `true` to execute save |
| `manual` | `boolean` | Manual mode |

| Method | Description |
|--------|-------------|
| `load()` | Load value from storage |
| `save()` | Save current value to storage |
| `remove()` | Remove key from storage |

## wc-bindable-protocol

Both `StorageCore` and `<wcs-storage>` conform to the wc-bindable-protocol, enabling interop with any protocol-aware framework or component.

The declaration follows the full wc-bindable interface model — three independent surfaces:

- **`properties`** — observable outputs that `bind()` subscribes to (`value`, `loading`, `error`, and the Shell's `trigger`)
- **`inputs`** — the settable surface (`key`, `type`, …); declarative metadata that tooling, codegen, and remote proxying read
- **`commands`** — invocable methods (`load`, `save`, `remove`); a binding system such as `@wcstack/state` can invoke them by name

Per the protocol, only `properties` is interpreted by core `bind()`; `inputs` / `commands` (and the `attribute` / `async` hints) are descriptive. They do **not** create implicit two-way data flow.

### Core (`StorageCore`)

`StorageCore` declares the bindable state any runtime can subscribe to, plus its portable input/command surface:

```typescript
static wcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "value",   event: "wcs-storage:value-changed",
      getter: (e) => e.detail },
    { name: "loading", event: "wcs-storage:loading-changed" },
    { name: "error",   event: "wcs-storage:error" },
  ],
  inputs: [
    { name: "key" },
    { name: "type" },
  ],
  commands: [
    { name: "load" },
    { name: "save" },
    { name: "remove" },
  ],
};
```

Headless consumers call `core.load()` / `core.save(value)` directly — no `trigger` needed.

### Shell (`<wcs-storage>`)

The Shell extends the Core declaration with the `trigger` output and the DOM-driven input surface; `commands` (`load` / `save` / `remove`) are inherited unchanged:

```typescript
static wcBindable = {
  ...StorageCore.wcBindable,
  properties: [
    ...StorageCore.wcBindable.properties,
    { name: "trigger", event: "wcs-storage:trigger-changed" },
  ],
  inputs: [
    { name: "key" },
    { name: "type" },
    { name: "value" },
    { name: "manual" },
    { name: "trigger" },
  ],
};
```

The Shell's inputs intentionally carry no `attribute` hint: the `key` / `type` / `manual` setters already reflect to their attributes, so a binding system that mirrors `inputs[].attribute` would set the attribute twice.

## TypeScript Types

```typescript
import type {
  WcsStorageError, WcsStorageCoreValues, WcsStorageValues, StorageType
} from "@wcstack/storage";
```

```typescript
type StorageType = "local" | "session";

// Storage operation error
interface WcsStorageError {
  operation: "load" | "save" | "remove";
  message: string;
}

// Core (headless) — 3 state properties
interface WcsStorageCoreValues<T = unknown> {
  value: T;
  loading: boolean;
  error: WcsStorageError | Error | null;
}

// Shell (<wcs-storage>) — extends Core with trigger
interface WcsStorageValues<T = unknown> extends WcsStorageCoreValues<T> {
  trigger: boolean;
}
```

## Why it works well with `@wcstack/state`

`@wcstack/state` uses path strings as the sole contract between UI and state.
`<wcs-storage>` fits naturally into this model:

- `<wcs-storage>` auto-loads from storage on connection
- `value` is bound to a state path, reflected in the UI
- User interactions update state, which auto-saves back to storage
- State survives page reloads

Persistence looks just like any other state update.

## Framework Integration

`<wcs-storage>` is CSBC + `wc-bindable-protocol`, so it works in any framework via thin `@wc-bindable/*` adapters.

### React

```tsx
import { useWcBindable } from "@wc-bindable/react";
import type { WcsStorageValues } from "@wcstack/storage";

interface Settings { theme: string; lang: string; }

function SettingsPanel() {
  const [ref, { value: settings, loading, error }] =
    useWcBindable<HTMLElement, WcsStorageValues<Settings>>();

  return (
    <>
      <wcs-storage ref={ref} key="app-settings" />
      {loading && <p>Loading...</p>}
      {settings && <p>Theme: {settings.theme}</p>}
    </>
  );
}
```

### Vue

```vue
<script setup lang="ts">
import { useWcBindable } from "@wc-bindable/vue";
import type { WcsStorageValues } from "@wcstack/storage";

interface Settings { theme: string; lang: string; }

const { ref, values } = useWcBindable<HTMLElement, WcsStorageValues<Settings>>();
</script>

<template>
  <wcs-storage :ref="ref" key="app-settings" />
  <p v-if="values.loading">Loading...</p>
  <p v-else-if="values.value">Theme: {{ values.value.theme }}</p>
</template>
```

### Svelte

```svelte
<script>
import { wcBindable } from "@wc-bindable/svelte";

let settings = $state(null);
let loading = $state(false);
</script>

<wcs-storage key="app-settings"
  use:wcBindable={{ onUpdate: (name, v) => {
    if (name === "value") settings = v;
    if (name === "loading") loading = v;
  }}} />

{#if loading}
  <p>Loading...</p>
{:else if settings}
  <p>Theme: {settings.theme}</p>
{/if}
```

### Solid

```tsx
import { createWcBindable } from "@wc-bindable/solid";
import type { WcsStorageValues } from "@wcstack/storage";

interface Settings { theme: string; lang: string; }

function SettingsPanel() {
  const [values, directive] = createWcBindable<WcsStorageValues<Settings>>();

  return (
    <>
      <wcs-storage ref={directive} key="app-settings" />
      <Show when={!values.loading} fallback={<p>Loading...</p>}>
        <p>Theme: {values.value?.theme}</p>
      </Show>
    </>
  );
}
```

### Vanilla — direct `bind()`

```javascript
import { bind } from "@wc-bindable/core";

const storageEl = document.querySelector("wcs-storage");

bind(storageEl, (name, value) => {
  console.log(`${name} changed:`, value);
});
```

## Optional DOM Triggering

When `autoTrigger` is enabled (default), clicking an element with a `data-storagetarget` attribute executes `save()` on the corresponding `<wcs-storage>`:

```html
<button data-storagetarget="settings-store">Save Settings</button>
<wcs-storage id="settings-store" key="settings" manual
  data-wcs="value: settings"></wcs-storage>
```

## Configuration

```javascript
import { bootstrapStorage } from "@wcstack/storage";

bootstrapStorage({
  autoTrigger: true,
  triggerAttribute: "data-storagetarget",
  tagNames: {
    storage: "wcs-storage",
  },
});
```

## Design Notes

- `value`, `loading`, `error` are **output state**
- `key`, `type`, `trigger` are **input / command surface**
- `trigger` is intentionally one-way: writing `true` saves, reset signals completion. If the underlying `save()` throws (e.g. `key` is unset), `trigger` is still reset to `false` and the completion event still fires, so it never gets stuck in the `true` state.
- The `value` setter auto-saves when not in `manual` mode
- **`value` setter vs `save()` / `trigger`**: assigning `value` (non-manual) persists the *assigned* argument (write-through). `save()` and `trigger`, by contrast, persist the *current* `value` — which a prior `load()` or a cross-tab `storage` event may have updated. This means `trigger`/`save()` can write back a value that arrived from another tab.
- **`value` in `manual` mode**: the `value` setter **stages** the value (no storage write) instead of persisting it. `el.value = x` updates the readable value (`el.value === x`) but does **not** touch storage; the actual write happens only via `save()` / `trigger`. This is what makes the `value: …` + `trigger: …` binding pair work — the bound value is staged, then committed on trigger.
- **No echo guard on the non-manual `value` path**: only the *staging* path (the Core `value` setter, used in `manual` mode) skips a same-value `value-changed` re-dispatch. The main non-manual path (`value` setter → `save()`) is deliberately write-through: every assignment persists and re-emits `value-changed`, even when the assigned value equals the current one. This is intentional — the write-through contract above must hold, and same-tab `storage` events do not re-fire, so there is no feedback loop. In a `data-wcs="value: x"` two-way binding the echoed `value-changed` is harmless: `@wcstack/state` dedups the round-trip on its side.
- **`save` command arity**: the headless Core takes `save(value)`, while the Shell exposes `save()` (persists the current value). Both appear under the same `commands` name `save`; the protocol's `commands` metadata is descriptive and arity-less, so this is contractual, not a protocol violation.
- **Invalid `type`**: any `type` attribute other than `"session"` is treated as `"local"`. An invalid value (e.g. `type="foo"`) silently falls back to `local` rather than throwing.
- **Runtime `type` change**: changing the `type` attribute after connection updates the Core's storage area for subsequent operations but does **not** re-load from the new area (only `key` changes auto-reload in non-manual mode). Re-load explicitly with `load()` if you need the value from the newly selected area.
- **`error` shape**: on a storage failure, `error` is set to a `WcsStorageError` (`{ operation, message }`) identifying which operation (`load` / `save` / `remove`) failed. `key is required` (calling an operation with no key) is thrown synchronously, not surfaced via `error`. In practice `error` is therefore always either a `WcsStorageError` or `null`; the wider `WcsStorageError | Error | null` type is kept for forward compatibility and consistency with sibling packages.
- JSON auto-serialization handles objects, arrays, and primitives transparently
- Saving `null` / `undefined` removes the key from storage
- Cross-tab sync via `storage` event works only with localStorage. The Shell binds the watcher to its current `key` / `type` on connect (and re-binds on re-attach), so cross-tab sync works even in `manual` mode where no auto-load runs. Changing the `key` attribute after connection always re-syncs the Core key, so cross-tab sync follows the new key even in `manual` mode or when the key is cleared. A successful cross-tab update also clears any stale `error` (just like `load()` / `save()` / `remove()` do at the start of a successful operation), so a fresh value never coexists with a leftover error from an earlier failure.
- `manual` is useful when you want explicit control over save timing

## License

MIT
