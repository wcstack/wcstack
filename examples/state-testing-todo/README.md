# state-testing-todo

A todo page on `@wcstack/state`, and a vitest suite that drives it headlessly with [`@wcstack/testing`](../../packages/testing/) — mount the page fragment, type into the form, submit, toggle, and assert the DOM. No browser, no build.

```bash
cd examples/state-testing-todo
npm install
npm test
```

The page itself is buildless: open `index.html` from any static server (it loads `@wcstack/state` from the CDN). The tests never touch the CDN — `mount()` registers the elements itself, so the suite mounts only the `<main id="app">` fragment.

What the suite shows:

- `mount(html)` → the initial render is there to assert.
- Typing (`input.value = …; fire(input, "input")`) and submitting (`fire(form, "submit")`) go through the same two-way binding and handler the user does; `await settle()` lets the write reach the DOM.
- `app.state().write(...)` drives the page from the state side; `app.state().read(...)` inspects it.
- A computed getter (`remaining`, via `$getAll("todos.*.done", [])`) re-renders when a row's checkbox changes.

The `file:` devDependencies point at this repository's packages so the example runs from a checkout; in your own project use the published versions (`npm i -D @wcstack/testing @wcstack/state @wcstack/server vitest happy-dom`).

日本語版: [README.ja.md](./README.ja.md)
