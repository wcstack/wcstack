# state + storage + broadcast demo (cross-tab todo)

A todo list that lives in two layers at once:

- **Durable** — `@wcstack/storage` (`<wcs-storage>`) persists the list to `localStorage` and, for free, mirrors it into every other tab.
- **Ephemeral** — `@wcstack/broadcast` (`<wcs-broadcast>`) carries live "who just did what" signals that are deliberately **never** persisted.

There is **no backend**: the data is `localStorage`, the cross-tab transport is `BroadcastChannel` — both pure browser APIs. The server only serves `index.html`.

## Getting Started

The packages load from a CDN ([esm.run](https://esm.run)), so no local build is needed — Node.js alone is enough.

```bash
node examples/state-cross-tab-todo/server.js
```

Open **http://localhost:3000 in two tabs side by side**, then add and check off todos. Reload to prove the list survives and the activity banner does not.

## The honest premise: why two packages?

`<wcs-storage>` with `type="local"` already syncs across tabs on its own — its `startSync()` listens to the browser's native `storage` event, which fires in *other* tabs whenever `localStorage` changes. So the todo list re-renders everywhere with storage alone; broadcast is **not** what moves the data.

That is exactly the point of the split:

| | `<wcs-storage>` (durable) | `<wcs-broadcast>` (ephemeral) |
|---|---|---|
| Holds | the todo list | "Octopus completed *Buy milk*", the tab's identity |
| Survives reload? | **yes** (that's the job) | **no** (and shouldn't) |
| Cross-tab? | yes, via the `storage` event | yes, via `BroadcastChannel` |
| Wrong tool for the other's data | a stored activity log nobody asked for | a todo list that vanishes on refresh |

The same click produces **both**: a durable mutation (persist + sync the list) *and* an ephemeral notification (flash a banner in the other tabs). They have opposite persistence semantics, so they ride different nodes.

## Features

- **Durable list**: `<wcs-storage data-wcs="value: todos">` — a two-way `value` binding is the entire integration. Auto-loads on connect, auto-saves on every change, auto-syncs from other tabs. No `manual`, no trigger, no command.
- **Ephemeral activity banner**: every mutation also `post`s a small `{who, kind, text}` to `<wcs-broadcast>`; other tabs show it as a transient banner. Gone on reload.
- **Per-session identity**: each tab picks a random animal (🦊 Fox, 🐙 Octopus…) at load — never stored, so a reload re-rolls it. The textbook "broadcast, not storage" datum.
- **Self-exclusion is the feature**: `BroadcastChannel` never delivers a post to its own sender, so a tab never banners *its own* action — only the others do.
- **Graceful degradation**: storage quota errors and a missing `BroadcastChannel` surface through each node's `error` property as a notice; the durable list keeps working even with broadcast off.

## Data Flow

```
  ── in THIS tab ──────────────────────────────────────────────
  click / Enter ──▶ addTodo() / toggleTodo() / removeTodo() / clearDone()
        │
        ├─▶ this.todos = [...]            (REPLACE the array, never mutate)
        │        │  value: todos  (two-way)
        │        ▼
        │   <wcs-storage>  ──▶ localStorage.setItem   (durable)
        │
        └─▶ this.$command.announce.emit({who, kind, text})
                 │  command.post
                 ▼
            <wcs-broadcast>  ──▶ BroadcastChannel.postMessage   (ephemeral)

  ── in OTHER tabs ────────────────────────────────────────────
  localStorage change ──▶ native `storage` event
        ▼  <wcs-storage> startSync → value-changed
   state.todos = <new list>   ──▶  list re-renders     (DURABLE path)

  BroadcastChannel message ──▶ wcs-broadcast:message
        ▼  eventToken.message: liveSignal
   $on.liveSignal → state.lastActivity = {…}; liveCount++   (EPHEMERAL path)
```

The two inbound paths are independent: the list only ever comes from storage, the banner only ever from broadcast. Nothing is applied twice.

## Key Points

- **Replace the array, never mutate it.** `@wcstack/state`'s dependency walk is parent → child only, so an in-place `todos.push(...)` would not fire the `value: todos` binding and nothing would persist. Every mutation builds a new array (`[...]`, `.map`, `.filter`) and assigns it to `this.todos`, which fires the binding → `<wcs-storage>` saves it → the `storage` event fans it out to other tabs.
- **The checkbox reflection is `checked#ro`, not `checked`.** A plain `checked: .done` on `<input type="checkbox">` is *implicitly two-way* — the browser's `input` event writes `.done` back to state. Pairing that with `onchange: toggleTodo` (which also flips `.done`) means a real click fires both: the two-way sets `done = true`, then the handler flips it to `false`, so the toggle nets to nothing. `#ro` makes the reflection read-only (state → DOM), leaving `onchange: toggleTodo` as the single writer that flips `.done` *and* fires the broadcast announce. (Two-way `checked: .done` alone would also toggle correctly — but then there's no hook to post the ephemeral signal.)
- **Read `list`, not `todos`.** An empty `localStorage` key loads as `null` (not `[]`), so `<wcs-storage>` writes `null` into `todos` on first run. Templates and mutations read the `get list()` getter, which normalizes `null` → `[]`. The `for:` never sees a non-array.
- **Storage is the only writer of the list; broadcast never touches it.** `$on.liveSignal` updates only `lastActivity` / `liveCount`. If it also edited `todos`, every cross-tab change would be applied twice (once by the `storage` event, once by the broadcast). Keeping the list single-sourced (storage) is what makes the broadcast layer safe to add.
- **No echo loop.** Two things could in principle loop, and neither does. (1) *Same tab.* Replacing `todos` writes through the `value: todos` binding to `<wcs-storage>`, which calls `setItem` and re-emits `value-changed`. That event flows back into `todos` and re-runs the binding outbound — but the apply step compares the element's current `value` against what it's about to write (`<wcs-storage>` already holds that exact array reference), sees no change, and skips the write, so `save()` is never re-invoked. There is no state-proxy value guard doing this; the round-trip stops on the binding's apply-side equality check. The `storage` event itself never fires in the originating tab either (it's delivered to *other* tabs only). (2) *Other tabs.* Broadcast self-excludes, so a post never returns to its sender. Neither layer loops.
- **`command.post` / `eventToken.message` are wired explicitly, not by spread.** The `...:` spread covers a node's `properties` + `inputs`, but intentionally excludes `commands` and event tokens — the pub/sub boundary (state → element action, element → state notification) is always written out, so the round-trip is visible in the markup.
- **Count proves the channel, not the data.** `liveCount` only counts signals from *other* tabs (self-exclusion), so it's a clean live signal that broadcast is delivering — separate from the list, which storage already keeps in sync whether or not broadcast fired.

## See also

- [`@wcstack/storage`](../../packages/storage/README.md) — persistence + native cross-tab `storage` sync
- [`@wcstack/broadcast`](../../packages/broadcast/README.md) — `BroadcastChannel` wrapper, structured-clone payloads, self-exclusion
- [`state-fetch`](../state-fetch) — the spread / command-token / event-token wiring this demo builds on
