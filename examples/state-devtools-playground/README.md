# state-devtools-playground

The smallest page where all three `<wcs-devtools>` panes have real work to do:

- **State** — a counter (plain write + computed getter), a todo list (list diff,
  wildcard getter), and clock state. Values are editable inline; edits go through
  the normal reactive pipeline, so the page (and the `double` getter) update.
- **Wiring** — every `data-wcs` binding on the page as a live ledger. Click a
  path in the State pane (or use ⌖ pick on a page element) to highlight the
  bound nodes.
- **Timeline** — `write` → `batch` rows from every interaction, plus
  `command`/`event` rows from the `<wcs-timer>` clock. The **fire ghost
  command** button emits a command token with zero subscribers — the classic
  "wired before `whenDefined`" race — and shows the warning badge.

## Run

```bash
node examples/state-devtools-playground/server.js
# → http://localhost:3000/  then Alt+Shift+D (or click the WCS badge)
```

The server serves the **repo root** because the page loads the locally built
dist of `@wcstack/devtools` and the instrumented `@wcstack/state` (run
`npm run build` in `packages/devtools`, `packages/state` and `packages/timer`
first). After the next release the `<script>` tags can switch to the usual
`https://esm.run/@wcstack/<pkg>/auto` CDN one-liners.

## Notes

- The devtools script is loaded **first** so the hook attaches before bindings
  are built — that is why the Wiring pane shows live bindings. Move the script
  below `@wcstack/state` (or inject it later) to see the "declared" fallback
  and its reload hint instead.
- The overlay panel covers part of the page while open (dock it right, or
  close it, to interact with covered controls).
