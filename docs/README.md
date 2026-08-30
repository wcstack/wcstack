# wcstack docs

Design documents, implementation plans, and spec proposals. Per-package `README.md` remains the normative reference for that package's public surface; the documents here cover cross-package contracts and the reasoning behind them.

**日本語版**: [README.ja.md](./README.ja.md)

## Naming convention

| Suffix | Language |
|---|---|
| `<name>.md` | English (canonical) |
| `<name>.ja.md` | 日本語 |

Four rules go with it:

1. **Links stay within a language.** An English document links to `other.md`; the Japanese one links to `other.ja.md`. Never mix, so a reader never falls out of their language mid-chain.
2. **While the migration is unfinished, a link from an English document to a not-yet-translated file is marked `(ja)`** on first mention — repeating it on every inline line-link to the same document would be noise. That is honest about where the reader lands. Drop the marker when the target is translated.
3. **Rename only when the English version is ready.** Moving a Japanese file to `.ja.md` before its `.md` exists breaks every existing reference to `docs/<name>.md` from code, examples, and READMEs.
4. **A reference to a file that no longer exists is a commit permalink.** A relative link 404s and the line numbers cited alongside it stop meaning anything, so point at the last commit that still had the file — `https://github.com/wcstack/wcstack/blob/<full-sha>/<path>#L<n>` — and name the deleting commit on first mention. This is the one place absolute URLs are correct; everything that still exists stays relative. The synth-playground prototype `wcs-synth.js` (deleted in `cbd5598e`, cited at `1e26a2a9`) is the case this rule was written for.

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
| [timing-and-firing-contract.md](./timing-and-firing-contract.md) | [timing-and-firing-contract.ja.md](./timing-and-firing-contract.ja.md) |
| [a11y-sr-testing.md](./a11y-sr-testing.md) | [a11y-sr-testing.ja.md](./a11y-sr-testing.ja.md) |
| [devtools-hook-protocol.md](./devtools-hook-protocol.md) | [devtools-hook-protocol.ja.md](./devtools-hook-protocol.ja.md) |
| [custom-state-reflection-design.md](./custom-state-reflection-design.md) | [custom-state-reflection-design.ja.md](./custom-state-reflection-design.ja.md) |
| [signals-definition-timing.md](./signals-definition-timing.md) | [signals-definition-timing.ja.md](./signals-definition-timing.ja.md) |
| [signals-state-design.md](./signals-state-design.md) | [signals-state-design.ja.md](./signals-state-design.ja.md) |
| [state-binding-init-races.md](./state-binding-init-races.md) | [state-binding-init-races.ja.md](./state-binding-init-races.ja.md) |
| [typescript.md](./typescript.md) | [typescript.ja.md](./typescript.ja.md) |
| [scoped-custom-element-registries.md](./scoped-custom-element-registries.md) | [scoped-custom-element-registries.ja.md](./scoped-custom-element-registries.ja.md) |
| [screen-orientation-tag-design.md](./screen-orientation-tag-design.md) | [screen-orientation-tag-design.ja.md](./screen-orientation-tag-design.ja.md) |
| [audio-impl-plan.md](./audio-impl-plan.md) | [audio-impl-plan.ja.md](./audio-impl-plan.ja.md) |
| [view-transition-design.md](./view-transition-design.md) | [view-transition-design.ja.md](./view-transition-design.ja.md) |
| [architecture-hardening/README.md](./architecture-hardening/README.md) | [README.ja.md](./architecture-hardening/README.ja.md) |
| [architecture-hardening/09-remediation-design.md](./architecture-hardening/09-remediation-design.md) | [09…ja.md](./architecture-hardening/09-remediation-design.ja.md) |
| [architecture-hardening/10-defaulting-rollout-status.md](./architecture-hardening/10-defaulting-rollout-status.md) | [10…ja.md](./architecture-hardening/10-defaulting-rollout-status.ja.md) |
| [architecture-hardening/12-wc-bindable-observable-inventory.md](./architecture-hardening/12-wc-bindable-observable-inventory.md) | [12…ja.md](./architecture-hardening/12-wc-bindable-observable-inventory.ja.md) |
| [architecture-hardening/13-framework-adapter-binding-constraints.md](./architecture-hardening/13-framework-adapter-binding-constraints.md) | [13…ja.md](./architecture-hardening/13-framework-adapter-binding-constraints.ja.md) |
| [architecture-hardening/14-handle-graph-wiring.md](./architecture-hardening/14-handle-graph-wiring.md) | [14…ja.md](./architecture-hardening/14-handle-graph-wiring.ja.md) |
| [architecture-hardening/15-state-component-mechanism-consistency.md](./architecture-hardening/15-state-component-mechanism-consistency.md) | [15…ja.md](./architecture-hardening/15-state-component-mechanism-consistency.ja.md) |

That is the whole priority set — every document code, an example, or a README points at. What remains untranslated is the internal design notes and implementation plans (`*-tag-design.md`, `*-impl-plan.md`, `state-*.md`, `io-node-*.md`, `architecture-hardening/01`-`08`, `11`), translated on demand as they are touched.

**Staying Japanese — internal strategy and council records**

These are internal working documents, not part of the published surface, so they keep a Japanese `.md` and get no English counterpart:

- `go-to-market-2026-08.md`, `go-to-market-2026-08-council.md`, `go-to-market-2026-08-synthesis-review.md`
- `project-strategy-2026-07.md`
- `state-redesign-council.md`
