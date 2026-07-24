# wcstack

**wcstack** is a set of 41 zero-dependency Web Components packages: reactive data binding, declarative SPA routing, and 30+ Web APIs exposed as HTML tags. No build step, no bundler, no framework runtime. One CDN `<script>` tag per package.

Project site: **https://wcstack.github.io** · Source: **https://github.com/wcstack/wcstack**

---

## Read this first if you are an AI coding agent

This file is a complete, self-contained guide to writing a correct wcstack app. Read it top to bottom, then **verify what you wrote**:

```bash
npx @wcstack/lint index.html    # exit code 0 = clean. Iterate until it exits 0.
```

Do not guess at syntax that is not documented here. wcstack has little presence in training data, so invented syntax will look plausible and be wrong. Two rules cover most failures:

- **Filters transform values. They never attach to event handlers.**
- **State must be reassigned, not mutated in place.**

Both are spelled out under [What does not work](#what-does-not-work).

---

## Do not install this package

This package contains documentation only. wcstack is buildless — load what you need from a CDN:

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/router/auto"></script>
<script type="module" src="https://esm.run/@wcstack/fetch/auto"></script>
```

Each `/auto` script registers its custom elements and does nothing else. No initialization call, no bootstrap. Tags activate when the browser parses them.

If you do want npm packages, install the individual ones (`@wcstack/state`, `@wcstack/router`, …) rather than this one.

---

## A complete working app

This is a full todo app. Save it as `index.html` and open it in a browser — nothing else is required.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Todo</title>
  <script type="module" src="https://esm.run/@wcstack/state/auto"></script>
  <style>
    .done { text-decoration: line-through; color: #999; }
  </style>
</head>
<body>

<wcs-state>
  <script type="module">
    export default {
      // ---- data ----
      todos: [
        { id: 1, text: "Read the guide", done: false }
      ],
      nextId: 2,
      draft: "",
      filter: "all",

      // ---- computed: plain getters, recalculated automatically ----
      get visible() {
        if (this.filter === "active") return this.todos.filter(t => !t.done);
        if (this.filter === "done")   return this.todos.filter(t => t.done);
        return this.todos;
      },
      get remaining() {
        return this.todos.filter(t => !t.done).length;
      },
      get isEmpty() {
        return this.todos.length === 0;
      },

      // ---- methods: always REASSIGN, never mutate ----
      add() {
        const text = this.draft.trim();
        if (!text) return;
        this.todos = [...this.todos, { id: this.nextId, text, done: false }];
        this.nextId = this.nextId + 1;
        this.draft = "";
      },
      toggle() {
        // Inside a `for:` loop, the current row is readable by wildcard path.
        const id = this["visible.*.id"];
        this.todos = this.todos.map(t => t.id === id ? { ...t, done: !t.done } : t);
      },
      remove() {
        const id = this["visible.*.id"];
        this.todos = this.todos.filter(t => t.id !== id);
      },
      showAll()    { this.filter = "all"; },
      showActive() { this.filter = "active"; },
      showDone()   { this.filter = "done"; }
    };
  </script>
</wcs-state>

<form data-wcs="onsubmit#prevent: add">
  <input data-wcs="value: draft" placeholder="What needs doing?">
  <button type="submit">Add</button>
</form>

<ul>
  <template data-wcs="for: visible">
    <li>
      <input type="checkbox" data-wcs="checked#ro: .done; onchange: toggle">
      <span data-wcs="textContent: .text; class.done: .done"></span>
      <button type="button" data-wcs="onclick: remove">x</button>
    </li>
  </template>
</ul>

<template data-wcs="if: isEmpty">
  <p>Nothing yet.</p>
</template>

<p><span data-wcs="textContent: remaining"></span> remaining</p>

<button type="button" data-wcs="onclick: showAll">All</button>
<button type="button" data-wcs="onclick: showActive">Active</button>
<button type="button" data-wcs="onclick: showDone">Done</button>

</body>
</html>
```

Note `checked#ro:` on the checkbox. Without `#ro`, the two-way binding writes `.done` back on `input`, and the `onchange` handler flips it again — a double toggle that nets to nothing. When a handler is the single writer, mark the reflection read-only.

---

## Binding syntax

State and UI are connected by **path strings only**. There are no hooks, selectors, or per-element binding objects.

```
property[#modifier]: path[@state][|filter[|filter(args)]...]
```

Multiple bindings are separated by `;`:

```html
<div data-wcs="textContent: count; class.over: count|gt(10)"></div>
```

### Properties

| Property | Meaning |
|---|---|
| `value` | Element value (two-way on inputs) |
| `checked` | Checkbox / radio state (two-way) |
| `textContent` / `text` | Text content |
| `html` | innerHTML |
| `class.NAME` | Toggle one CSS class |
| `style.PROP` | Set one style property |
| `attr.NAME` | Set an attribute (SVG-aware) |
| `radio` | Radio group (two-way) |
| `checkbox` | Checkbox group bound to an array (two-way) |
| `onclick`, `on*` | Event handler |

### Modifiers

| Modifier | Meaning |
|---|---|
| `#ro` | Read-only — disables the two-way write-back |
| `#prevent` | `event.preventDefault()` on handlers |
| `#stop` | `event.stopPropagation()` on handlers |
| `#onchange` | Use `change` instead of `input` for two-way binding |
| `#init=element` | The element owns the initial value (use with `<wcs-storage>` and monitors) |

Combine after one `#`, comma separated: `value#ro,init=none: path`.

### Paths

| Form | Meaning |
|---|---|
| `count`, `user.name` | Plain property path |
| `items.*.price` | Wildcard — the current row inside a `for:` loop |
| `.price` | Shorthand for the current row's property inside a loop |
| `path@cart` | Read from a *named* state element (`<wcs-state name="cart">`) |

### Structural directives

Always on a `<template>` element:

```html
<template data-wcs="for: items"> ... </template>
<template data-wcs="if: isReady"> ... </template>
<template data-wcs="elseif: isLoading"> ... </template>
<template data-wcs="else:"> ... </template>
```

### Computed values

Plain getters. Wildcard getters compute per row, and `$getAll` aggregates across rows:

```javascript
get "cart.items.*.subtotal"() {
  return this["cart.items.*.price"] * this["cart.items.*.quantity"];
},
get "cart.total"() {
  return this.$getAll("cart.items.*.subtotal", []).reduce((a, b) => a + b, 0);
}
```

### Event handlers

Handlers receive the event, then the loop indexes:

```javascript
removeItem(event, index) {
  // `index` is the loop position — correct only when the template iterates
  // the same array you are mutating. If you loop over a FILTERED getter,
  // identify the row by id via the wildcard path instead (see the app above).
  this.items = this.items.toSpliced(index, 1);
}
```

---

## What does not work

These are the mistakes that actually occur. Each has a working replacement.

```html
<!-- Filters transform VALUES. An event handler never takes a filter. -->
BAD:  <input data-wcs="onkeydown: add|enter">
GOOD: <input data-wcs="onkeydown: add">        <!-- check event.key inside add() -->

<!-- Structural directives require a <template>. -->
BAD:  <div data-wcs="for: items"> ... </div>
GOOD: <template data-wcs="for: items"> ... </template>

<!-- `{{ }}` outside a template causes FOUC. -->
BAD:  <p>{{ count }}</p>
GOOD: <p><span data-wcs="textContent: count"></span></p>
```

```javascript
// State must be REASSIGNED. In-place mutation is not tracked.
BAD:  this.items.push(x);
BAD:  this.items[0] = x;
BAD:  this.user.name = "new";
GOOD: this.items = [...this.items, x];
GOOD: this["items.0"] = x;
GOOD: this["user.name"] = "new";

// Immutable array methods are the idiom.
this.items = this.items.toSpliced(index, 1);
this.items = this.items.map(t => t.id === id ? { ...t, done: true } : t);
```

---

## Verify before you finish

```bash
# Check any HTML against the data-wcs contract. No install, no config.
npx @wcstack/lint index.html

# Errors only, for a generate-validate-fix loop:
npx @wcstack/lint --errors-only index.html
```

Exit code `0` means clean, `1` means at least one error-severity finding, `2` means a usage or read failure. Diagnostics carry stable `wcs/*` codes and `source:line:col` ranges.

---

## The rest of the stack

`<wcs-state>` is one package. Every other capability is a tag that speaks the same binding protocol, so they compose without glue code.

| Package | Tag | Role |
|---|---|---|
| `@wcstack/state` | `<wcs-state>` | Reactive state + `data-wcs` binding |
| `@wcstack/router` | `<wcs-router>` | Declarative SPA routing (Navigation API) |
| `@wcstack/autoloader` | — | Import-Map-driven auto-registration of components |
| `@wcstack/signals` | — | Signals core (`signal` / `computed` / `effect`), JS-first alternative |
| `@wcstack/fetch` | `<wcs-fetch>` | HTTP with automatic re-fetch on dependency change |
| `@wcstack/storage` | `<wcs-storage>` | localStorage / sessionStorage |
| `@wcstack/websocket` | `<wcs-ws>` | WebSocket |
| `@wcstack/sse` | `<wcs-sse>` | Server-Sent Events |
| `@wcstack/lint` | — | Static-contract validator CLI |
| `@wcstack/devtools` | — | In-page inspector overlay |

Plus 25+ more wrapping camera, speech, geolocation, notifications, clipboard, sensors, observers, and other Web APIs. Full catalog: https://wcstack.github.io

### Deeper references

- **Agent skill** (complete binding syntax, router skeletons, tag catalog): https://github.com/wcstack/wcstack-skill
- **Repository guide for agents**: https://github.com/wcstack/wcstack/blob/main/AGENTS.md
- **Per-package docs**: `npm view @wcstack/state readme`, `npm view @wcstack/router readme`, …

## License

MIT
