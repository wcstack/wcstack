# Recursive Tree — a tree whose depth is data

[日本語版](./README.ja.md)

A demo of **recursive paths** in **`@wcstack/state`**. A path bakes its depth into the string — `nodes.*.children.*.total` is depth 2 and nothing else — so a tree whose shape is decided at runtime has nowhere to put its aggregation. `$recursion` declares where the tree repeats, and `**` stands for "however deep this evaluation is", which lets **one** getter cover every depth.

```js
$recursion: { "nodes.*": "children.*" },   // anchor → the self-similar subpath

get "nodes.**.total"() {
  return this["nodes.**.value"]
    + this.$getAll("nodes.**.children.*.total").reduce((a, b) => a + b, 0);
},
```

## Getting Started

Static page — no build, no API. Serve `packages/state/examples/` over http (the page pulls the released package from the CDN as an ES module, which `file://` cannot load) and open `/recursive-tree/`.

```bash
cd packages/state/examples
npx serve .          # or any static file server
```

The `$streams` demo's bundled server also serves this whole folder, if one is already running:
`node examples/streams/server.js` → http://localhost:3000/recursive-tree/.

## What to look at

- **One definition, every depth** — `get "nodes.**.total"()` is the Σ printed on every row, from the roots down to the node you just created. The accessor for a given depth is materialized the first time something reads it, so only the depths actually visited exist.
- **The markup never says `**`** — inside `<tree-node>` every path is one level deep (`label`, `value`, `total`, `children`). `**` is an authoring symbol for the state definition; it never reaches a bound path.
- **Drawing is the self-referencing component** — `<tree-node>` uses `<tree-node>` inside its own shadow root, mounted on the row with `data-wcs="state: ."`. The depth lives in the DOM; the paths stay flat.
- **`[]` reads every depth at once** — Total, Nodes and Selected are `$getAll("nodes.**.…", [])` merged depth-first, pre-order, ascending index. Total agrees with the sum of the top-level Σ values because the recursive getter counts each level exactly once.
- **One broadcast clears everything** — **Clear selection** is `$setAll("nodes.**.selected", [], false)`, a single write to every node at every depth.
- **Aggregation is not only addition** — **Height** (`h`*n* on each row) is `get "nodes.**.depth"()`, the same shape with `max` instead of `+`.
- **+ child** appends a node at that level, making the subtree deeper than anything the page had rendered before. Every Σ above it, plus Total, Nodes and Height, follows with no extra wiring — that is the whole point.

## Notes

- **The self-referencing component has two conditions**, and breaking either fails silently. Its initial `state` must not declare the data keys it is mounted over (an own key is private and would hide the tree — rule R1 of `docs/state-mount-design.md`); methods are fine. And the shadow root must be built in `connectedCallback`, not in the constructor — filling `innerHTML` in the constructor upgrades the elements inside `<template>` on implementations that do not keep template content inert, and the constructor recurses forever.
- **The input contract is a tree.** If the same array instance is reachable from two parents, the walk refuses (`wcs/recursion-shared-list`, `wcs/recursion-cycle`) instead of silently double-counting. A cycle is the special case of that.
- **`**` is authoring-only.** It is never handed to a `PathInfo`, so `$resolve` does not take it, and writing it in `data-wcs` is not supported (`wcs/recursion-unsupported`). Reading `this["nodes.**.value"]` outside a recursive evaluation has no depth to bind to and raises `wcs/recursion-context`.
- **Index forms differ per API.** Inside a recursive getter, an index-omitted `$getAll` is bound to the depth being evaluated; `$getAll(path, [])` is the merged all-depths reading; a non-empty prefix cannot be defined and is refused (`wcs/recursion-getall-form`).
- **The recursive write is the broadcast only**: a non-empty prefix is `wcs/recursion-setall-form`; a mapper, `spread` and omitted indexes are refused too (the number of indexes changes with depth — the runtime names the form in its message, the linter reports them under that same code), and no structural writes (the node itself, its children list or that list's `length`, a child node, or — with a multi-segment repeat such as `branch.children.*` — the object on the way to the list: `wcs/recursion-structural-write`). Structural changes stay ordinary writes, which is what **+ child** and **−** do from inside one level's own scope.
- **Depth is bounded.** The expanded path may hold at most `MAX_WILDCARD_DEPTH` (128) wildcard segments; going past it raises `wcs/recursion-depth-exceeded` naming the anchor and depth, rather than looping.

> See `docs/state-recursive-path-design.md` at the repository root for the design decisions, and `packages/state/src/recursion/` for the implementation.
