# wcstack examples

Cross-package demo apps: each one composes **two or more wcstack packages** (or
showcases a repo-level concern like SSR or framework interop). Focused
single-package demos live in that package's own `examples/` directory instead:

- `packages/fetch/examples/` — `pagination` (5-stack comparison), `users-crud`, `infinite-scroll`
- `packages/speech/examples/` — `speech-echo`, `speak-highlight`
- `packages/defined/examples/` — `defined-loader`
- `packages/state/examples/` — binding basics

Every demo is buildless and loads packages straight from the CDN
(`https://esm.run/@wcstack/<pkg>/auto` one-liners; signals demos import the
single `@wcstack/signals/dom` entry) — except the React/Vue variants of
`websocket-chat`, which use Vite.

## Demo list

| Demo | Combines | Run | URL |
|------|----------|-----|-----|
| [`websocket-chat/`](websocket-chat/) | websocket × 5 stacks (vanilla / state / signals / React / Vue) | see its [README](websocket-chat/README.md) | :3300–:3305 |
| [`router-spa/`](router-spa/) | router + fetch + state (SPA catalog: URL ⇄ state bridge) | `node examples/router-spa/server.js` | :3000 |
| [`state-camera-record-upload/`](state-camera-record-upload/) | camera + permission + upload + state | any static server (secure context) | — |
| [`state-cross-tab-todo/`](state-cross-tab-todo/) | storage + broadcast + state | `node examples/state-cross-tab-todo/server.js` (open 2 tabs) | :3000 |
| [`state-custom-states/`](state-custom-states/) | fetch + websocket + state (`:state()` showcase) | `node examples/state-custom-states/server.js` (needs the [websocket-chat shared install](websocket-chat/README.md#setup)) | :3303 |
| [`state-intersect-scroll/`](state-intersect-scroll/) | fetch + intersection + state | `node examples/state-intersect-scroll/server.js` | :3000 |
| [`state-notification-chat/`](state-notification-chat/) | notification + permission + state | any static server | — |
| [`state-permission-banner/`](state-permission-banner/) | geolocation + permission + state | any static server | — |
| [`state-search/`](state-search/) | fetch + debounce + state | `node examples/state-search/server.js` | :3000 |
| [`state-tilt-maze/`](state-tilt-maze/) | tilt + accelerometer + raf + wakelock + state (sensor game) | any static server (secure context) | — |
| [`signals-live-search/`](signals-live-search/) | signals + fetch | `node examples/signals-live-search/server.js` | :3000 |
| [`signals-tilt-maze/`](signals-tilt-maze/) | signals × the same 4 sensor nodes as `state-tilt-maze` (core swap comparison) | any static server (secure context) | — |
| [`ssr/`](ssr/) | @wcstack/server (SSR + hydration) | `cd examples/ssr && npm install && node server.js` | :3001 |

Demos marked "any static server" have no backend at all — any way of serving
the directory over `http://localhost` works, e.g.:

```bash
npx serve examples/state-permission-banner
```

## Shared server core

`shared/server.js` is the static-file + JSON API core the demos above delegate
to — each demo's `server.js` stays a thin file declaring only its own routes.
When copying a single demo out of this repo, copy `examples/shared/` alongside
it. (`websocket-chat/` is the exception: it ships its own self-contained server
under `websocket-chat/shared/` because it needs the `ws` dependency, so that
scenario is portable as one directory.)

Most demo servers default to port 3000 (override with `PORT=…`), so run them
one at a time — or use the e2e static server (`cd e2e && npm run serve`), which
serves the whole repo with mocked APIs at `http://127.0.0.1:4173`.
