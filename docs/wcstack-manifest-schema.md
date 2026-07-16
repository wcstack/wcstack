# `wcstack.manifest.json` — sidecar schema and resolution rules

- **Status**: Normative for the Phase 5a static-contract subsystem (`docs/architecture-hardening/09-remediation-design.md` §7 / §7.1 / §11 decision gate "sidecar の探索・merge 規則", 決定時点 = *phase 5a 着手前*).
- **Scope**: fixes the envelope, the artifact separation (package vs application), the JSON-Schema subset, and — as the decision gate requires — **discovery order, package resolution, same-name tag/filter collision, and override forbid/allow**, so there is **no implicit last-file-wins merge**.
- **Invariant (§11 tail)**: the sidecar's optional information is **never promoted to a required input of runtime correctness**. A missing or stale sidecar never disables runtime competition prevention (`wcstack.async` is tooling-only; the real lane policy and commit guard are the I/O Core's code). The live `static wcBindable` declaration is **never overridden** by the sidecar.

## 1. Envelope

Every artifact is a JSON object with:

| field | type | meaning |
| --- | --- | --- |
| `schemaVersion` | integer | Envelope major. A reader declares the majors it supports; an unsupported major is a `manifest-schema-version` error. |
| `kind` | `"package"` \| `"application"` | Selects the artifact role (§2). Any other value is `manifest-kind-invalid`. |
| `bindingProtocol` | `{ protocol: "wc-bindable", minimumVersion: integer }` | The binding protocol the artifact targets. |
| `behavioralRequirements` | `{ required: string[], optional: string[] }` | Declares needed/optional behavioral extensions. **Descriptive only** — it never turns a target Extension-1-capable. |
| `manifestExtensions` | object of `wcstack.*` namespaces | The typed contract payload (§3). Unknown top-level namespaces are ignored with an `info` diagnostic, never an error. |

## 2. Artifact separation (package vs application)

`package` and `application` **may share the same `schemaVersion` but MUST be separate files**. They are never merged into one file, and the validator resolves package contracts and then checks the application's bindings against them.

- **package** artifact — a reusable *component contract*. Holds `manifestExtensions.wcstack.types` / `wcstack.async` / `wcstack.platformCapabilities`, keyed per custom-element tag (e.g. `wcs-fetch`). Published by a component package; mirrors its `static wcBindable` surface.
- **application** artifact — the concrete app. Holds `manifestExtensions.wcstack.application` with the root `stateSchema` (JSON-Schema subset), per-`@state` schemas, filter input/output declarations, and list-context roots. Application binding graphs are checked against the resolved package contracts.

## 3. `manifestExtensions` namespaces

Each namespace carries its own `version` (checked against a supported range) and a `components` (package) or `states`/`filters` (application) map.

- **`wcstack.types`** (package): `components[tag] = { observables[name] = { event, schema }, inputs[name] = { schema }, commands[name] = { args, result } }`. All `schema` values are the JSON-Schema subset (§4).
- **`wcstack.async`** (package, tooling-only): `components[tag] = { operations[op] = { lane, policy } }`. **Never** consulted for runtime correctness — the I/O Core's lane is authoritative.
- **`wcstack.platformCapabilities`** (package): `components[tag] = { required: capId[], optional: capId[] }`. Capability IDs are opaque stable strings (`web.fetch`, reverse-DNS for third-party); they are **never eval'd as a global property path**.
- **`wcstack.application`** (application): `states[name] = { stateSchema }`, `filters[name] = { input, output }`, `listContexts: path[]`.

## 4. Type representation — JSON-Schema subset

Types are **not** arbitrary TypeScript strings. Only these keywords are allowed:

```
type, properties, required, items, enum, const, anyOf, $defs, $ref (local only)
```

- **`$ref`**: local only — must start with `#/`. Any external `$ref` (a URI or non-`#` target) is a `manifest-external-ref` error.
- **cycles**: the resolver detects `$ref` cycles and reports `manifest-ref-cycle` (it never loops).
- **unknown keyword**: never runtime-inferred. Surfaces a `manifest-unknown-keyword` diagnostic (unsupported), and the node resolves to `unknown` (does not block runtime).
- **unresolved `$ref`**: a local `$ref` whose target is absent is `manifest-ref-unresolved`.

## 5. Discovery, resolution, collision, override (decision gate — fixed here)

These rules are **fixed**; there is **no implicit last-file-wins merge**.

1. **Discovery order** — application artifacts are discovered in a deterministic, caller-supplied order (the CLI sorts input paths lexicographically; the IDE uses workspace order). Discovery order affects only *diagnostic ordering*, never *which contract wins* (see collision).
2. **Package resolution** — a component tag is resolved from the set of loaded `package` artifacts. A tag defined by exactly one package artifact resolves to that contract.
3. **Same-name collision** — if two *package* artifacts both define `wcstack.types.components[tag]` for the **same tag**, or two artifacts both declare the same `filters[name]`, that is a **`manifest-tag-collision` / `manifest-filter-collision` error** — the later definition does **not** silently win. Resolution yields no contract for the collided name (so downstream checks treat it as `unknown`, not as a silently-chosen winner).
4. **Override** — overriding a package contract is **forbidden by default**. A redefinition of an already-defined tag **without** `"override": true` is the same as a collision and surfaces as `manifest-tag-collision` (error), withdrawing the contract. An explicit `"override": true` on the redefining component entry is required to intentionally shadow; the validator then emits a `manifest-override` **info** diagnostic (never an error) and retains the original contract.
5. **Drift** (§7 of the design) — a member present in the sidecar `wcstack.types` but **absent from the live `static wcBindable`** declaration, or whose **event name differs**, is a **`drift-missing-member` / `drift-event-mismatch` error** in CI. The live declaration is authoritative; the sidecar never overrides it.

## 6. Diagnostics

The validator core emits `WcsDiagnostic { code, start, end, message, severity, tag?, member?, statePath? }`:

- **`code`** — a stable, documented string id (`docs`/quick-fixes/suppression key off it). The same input yields the same code from the IDE and the CI CLI (the completion criterion).
- **`range`** — character offsets over the raw source (`start`/`end`); the CLI maps them to `line:col`.
- **severity** — *unknown type / dynamic path* → `warning`/`info`; *definite type mismatch / nonexistent member / broken manifest* → `error`.

Dynamically-constructed paths resolve to `unknown` (an `info`, never an error) so the runtime is never blocked by a static gap.
