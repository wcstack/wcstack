# wcstack docs

Design documents, implementation plans, and spec proposals. Per-package `README.md` remains the normative reference for that package's public surface; the documents here cover cross-package contracts and the reasoning behind them.

**日本語版**: [README.ja.md](./README.ja.md)

## Naming convention

| Suffix | Language |
|---|---|
| `<name>.md` | English (canonical) |
| `<name>.ja.md` | 日本語 |

Three rules go with it:

1. **Links stay within a language.** An English document links to `other.md`; the Japanese one links to `other.ja.md`. Never mix, so a reader never falls out of their language mid-chain.
2. **While the migration is unfinished, a link from an English document to a not-yet-translated file is marked `(ja)`.** That is honest about where the reader lands. Drop the marker when the target is translated.
3. **Rename only when the English version is ready.** Moving a Japanese file to `.ja.md` before its `.md` exists breaks every existing reference to `docs/<name>.md` from code, examples, and READMEs.

## Migration status

`.md` files not listed below are still Japanese; they are translated on demand, priority given to whatever code or a README points at.

**Translated**

| Doc | 日本語 |
|---|---|
| [csp.md](./csp.md) | [csp.ja.md](./csp.ja.md) |
| [sri.md](./sri.md) | [sri.ja.md](./sri.ja.md) |
| [framework-adapter-integration.md](./framework-adapter-integration.md) | [framework-adapter-integration.ja.md](./framework-adapter-integration.ja.md) |
| [async-execution-model.md](./async-execution-model.md) | [async-execution-model.ja.md](./async-execution-model.ja.md) |
| [async-io-node-guidelines.md](./async-io-node-guidelines.md) | [async-io-node-guidelines.ja.md](./async-io-node-guidelines.ja.md) |

**Queued — referenced from code, examples, or a README**

| Doc | Referenced from |
|---|---|
| `timing-and-firing-contract.md` | `packages/screen-orientation/README.md`, MUST-referenced from the guidelines §9 |
| `devtools-hook-protocol.md` | `architecture-hardening/05` |
| `custom-state-reflection-design.md` | `examples/state-custom-states`, `packages/{worker,screen-orientation}` tests |
| `signals-definition-timing.md` | `examples/signals-tilt-maze`, `examples/signals-live-search` |
| `signals-state-design.md` | `examples/signals-live-search/README.md` |
| `state-binding-init-races.md` | `e2e/tests/state-deferred-apply.spec.ts`, `e2e/tests/state-cross-tab-todo.spec.ts` |
| `screen-orientation-tag-design.md` | `packages/screen-orientation/src/**` |
| `audio-impl-plan.md` | `e2e/tests/audio-offline.spec.ts` |
| `architecture-hardening/README.md` | index for the ADR set |
| `architecture-hardening/09-remediation-design.md` | `io-core/*.ts`, `packages/screen-orientation/src/core/platformCapability.ts` |
| `architecture-hardening/10-defaulting-rollout-status.md` | `scripts/conformance-bindable-inputs.mjs` |
| `architecture-hardening/12-wc-bindable-observable-inventory.md` | `packages/worker/__tests__/wcBindableSemantics.test.ts` |
| `architecture-hardening/13-framework-adapter-binding-constraints.md` | `protocol/upgrade-properties.ts` |
| `architecture-hardening/14-handle-graph-wiring.md` | CLAUDE.md, `examples/synth-playground` |
| `architecture-hardening/15-state-component-mechanism-consistency.md` | eight `e2e/tests/state-*.spec.ts` |

**Staying Japanese — internal strategy and council records**

These are internal working documents, not part of the published surface, so they keep a Japanese `.md` and get no English counterpart:

- `go-to-market-2026-08.md`, `go-to-market-2026-08-council.md`, `go-to-market-2026-08-synthesis-review.md`
- `project-strategy-2026-07.md`
- `state-redesign-council.md`
