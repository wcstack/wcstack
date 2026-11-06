# What a state's script writes — checks from one write set per body

- **Status**: study and implementation, 2026-11-07. The author took the recommended scope, the core change and this document the same day (§5); the work is in the 4.17 minor (§6).
- **日本語版**: [script-write-checks.ja.md](./script-write-checks.ja.md)

The question was what `@wcstack/state` could check if the lint knew, from the AST, which assignments a setter or a method makes. This document records what was already there, what one write set per body adds, what was decided and what was built.

## 1. What was there

The lint already read writes. [scriptAst.ts](../packages/vscode-wcs/src/service/scriptAst.ts) walks each getter, setter and method body with acorn and collects what reaches the state through `this`: a compound assignment or `++` / `--` as a read that writes (`written: true`), and — with the `writes` option of 4.16 — a plain assignment's target and the path of `$setAll` / `$update` (`form: 'write'` / `'api-write'`). Two kinds of rule used them:

- **Does the path exist?** `wcs/write-path-missing` (4.4 top level, 4.16 nested).
- **Does the write go through the proxy?** `wcs/nested-assign`, `wcs/array-mutation`, `wcs/array-index-assign` (regular expressions over the script).

Each looked at one write at a time. None joined what a body writes with what a getter reads.

## 2. What a write set adds

Collect, for each callable, every path it writes — through the methods it calls — and join that with the getters' read sets (already collected for `wcs/getter-cycle`). That graph decides four things the runtime either reports without naming anything, or does not report at all:

| Code | The mistake | The runtime before 4.17 | Since 4.17 (runtime / lint) |
|---|---|---|---|
| `wcs/getter-write` | A getter writes while it is evaluated, itself or in a method it calls | Throws `#8` `This state is readonly.` — no path, no getter | Names the path and the getter / error |
| `wcs/path-readonly` | A script writes a getter without a setter (`this.total = 0`) | Throws `"total" is a getter without a setter`, no code; the lint read two-way bindings only | The code and the fix / error on script writes too |
| `wcs/setter-cycle` | A setter writes its own path, or setters write each other | No guard: the stack overflows with a `RangeError` that names nothing | The diagnostics add-on throws naming the cycle at 64 calls / error for a self-write, warning for a longer cycle |
| `wcs/setter-unobserved` | A setter none of whose writes its getter reads | Silent: the getter keeps its value, and a two-way input goes back to it | The diagnostics add-on warns once per setter / warning |

The last is the one the "silence zero" direction ([v4-direction-2026-10.md](./v4-direction-2026-10.md), ja) asks for most: nothing at all said it.

## 3. The two directions of approximation

The checks rest on opposite facts, so their sets are approximated in opposite directions.

- **"A write exists"** (`getter-write`, `setter-cycle`): under-approximate. A write in a nested function — a handler the getter returns, a callback that runs later — may not run while the body does, so it is not counted (`nested: true` in the AST). A write in a branch is counted: when the branch runs, the runtime throws.
- **"No write reaches a read"** (`setter-unobserved`): over-approximate both sides — every write, nested or not; every read, including inside `$untracked` (an untracked read still happens, and the setter's own landing makes its getter evaluate again). Anything that cannot be followed makes the rule silent for that setter: `this[key]`, `this` handed to a function or spread, an API path that is not a literal, a call of a method the state does not declare (`form: 'opaque'` in the AST).

`path-readonly` reports a write wherever it is, nested or not: when it runs it throws. It needs every declaration to be readable, so it is silent in a state with a top-level spread, which may bring the setter.

A write reaches a read when one path is the other or under it, a numeric segment or `*` matching any: a write of `user.name` reaches a getter that reads `user`, and a write of `names` one that reads `names.first`. A write of a setter's path counts what that setter writes, as at run time.

## 4. Runtime and lint together

The direction ranks the layers: design it out, then report at run time, then the lint, then the documents. Each check therefore has a runtime side, and the runtime side stays out of the core where it can:

- **`getter-write`** needs the core: the core raised `#8` without arguments. One method, `Engine.refuseWrite(path)`, replaces the three checks (`$update`, `write`, `$setAll`; the recursion add-on calls it too) and passes the path and the getter being evaluated (`top`). The diagnostics add-on renders `[wcs/getter-write] "count" is written while the getter "total" is evaluated: a getter only reads. …`; a readonly callback says `cannot write "count": this state is readonly.` The core grows by 15 B (20,392 → 20,407 B of 20,480).
- **`path-readonly`**: the sentence of `#2` carries the code, the fix and the lint pointer. 0 B in the core.
- **`setter-cycle`** and **`setter-unobserved`**: the diagnostics add-on brackets each call of an author's setter. `beforeWrite` (handling nothing) pushes the call; `written` adds each write to every call on the stack, and the setter's own landing — the one landing with `direct` false that passes `element` — pops it. At 64 nested calls it throws `[wcs/setter-cycle]` with the cycle. When a call ends having written something, while the getter has read something (`sources`), and no write is under or over a path in the getter's read closure (its sources, and the sources of the getters among them), it warns `[wcs/setter-unobserved]` once per setter. A drain clears the stack. 0 B in the core; the add-on grows by about 600 B, given as a 384 B slack until the release re-records the baseline.

## 5. Decisions (2026-11-07)

The author took the three recommendations:

1. **The scope of 4.17**: `getter-write` (lint and the runtime's message), `path-readonly` on script writes, `setter-cycle`, `setter-unobserved`. Left out: a `*` path written where no row is in context (needs the binding sites and a call graph; the runtime throws `no row` naming the path), a write nothing reads (an info, noisy), suggesting `$update` for a compound assignment in a loop (a style, against "fix without adding"), raising `wcs/getter-untracked-read` to an error when no script replaces the root (it would fail existing pages' `--errors-only`; measure first).
2. **The core change** for the runtime's `getter-write` message, within a few bytes (15 B measured).
3. **This document** first, with the decisions recorded, as the 4.15 and 4.16 studies.

## 6. What was built

- `packages/state`: `Engine.refuseWrite`, the sentences of `#2` and `#8`, the setter bracket in `features/diagnostics.ts`; `__tests__/script-writes.test.ts`.
- `packages/vscode-wcs` (and so `@wcstack/lint`, `@wcstack/typescript`, the extension): `scriptAst.ts`'s options `resolveWrites`, `untracked`, `opaque` and the `nested` mark; `scriptWriteValidator.ts`; `__tests__/scriptWrite.test.ts`.
- [mistake-catalogue.md](./mistake-catalogue.md): four entries, and the two-way binding's entry now reported with the code.
- No page in the repository (`examples/`, the seam apps, every package's `examples/`) is reported by the four codes.
