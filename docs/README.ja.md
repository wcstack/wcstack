# wcstack docs

設計ドキュメント・実装計画・仕様提案。各パッケージの公開面については当該パッケージの `README.md` が正本であり、ここに置くのはパッケージを横断する契約とその判断理由。

**English**: [README.md](./README.md)

## 命名規約

| 接尾辞 | 言語 |
|---|---|
| `<name>.md` | 英語（正本） |
| `<name>.ja.md` | 日本語 |

付随するルールが 3 つある:

1. **リンクは言語内で閉じる。** 英語ドキュメントは `other.md` を、日本語は `other.ja.md` を指す。混ぜない — 読んでいる途中で言語から落ちないようにするため。
2. **移行が終わるまで、英語ドキュメントから未翻訳ファイルへのリンクには `(ja)` を付す。** 読者がどこに着地するかを正直に示す。翻訳が済んだら外す。
3. **英語版ができてからリネームする。** `.md` が存在しない状態で日本語ファイルを `.ja.md` に動かすと、コード・examples・README から `docs/<name>.md` への既存参照が全部切れる。

## 移行状況

下の表に無い `.md` はまだ日本語。コードや README が指しているものを優先して、必要になった順に翻訳する。

**翻訳済み**

| 英語 | 日本語 |
|---|---|
| [csp.md](./csp.md) | [csp.ja.md](./csp.ja.md) |
| [sri.md](./sri.md) | [sri.ja.md](./sri.ja.md) |
| [framework-adapter-integration.md](./framework-adapter-integration.md) | [framework-adapter-integration.ja.md](./framework-adapter-integration.ja.md) |
| [async-execution-model.md](./async-execution-model.md) | [async-execution-model.ja.md](./async-execution-model.ja.md) |
| [async-io-node-guidelines.md](./async-io-node-guidelines.md) | [async-io-node-guidelines.ja.md](./async-io-node-guidelines.ja.md) |

**待ち — コード / examples / README から参照されているもの**

| ドキュメント | 参照元 |
|---|---|
| `timing-and-firing-contract.md` | `packages/screen-orientation/README.md`・ガイドライン §9 から MUST 参照 |
| `devtools-hook-protocol.md` | `architecture-hardening/05` |
| `custom-state-reflection-design.md` | `examples/state-custom-states`, `packages/{worker,screen-orientation}` のテスト |
| `signals-definition-timing.md` | `examples/signals-tilt-maze`, `examples/signals-live-search` |
| `signals-state-design.md` | `examples/signals-live-search/README.md` |
| `state-binding-init-races.md` | `e2e/tests/state-deferred-apply.spec.ts`, `e2e/tests/state-cross-tab-todo.spec.ts` |
| `screen-orientation-tag-design.md` | `packages/screen-orientation/src/**` |
| `audio-impl-plan.md` | `e2e/tests/audio-offline.spec.ts` |
| `architecture-hardening/README.md` | ADR 群の索引 |
| `architecture-hardening/09-remediation-design.md` | `io-core/*.ts`, `packages/screen-orientation/src/core/platformCapability.ts` |
| `architecture-hardening/10-defaulting-rollout-status.md` | `scripts/conformance-bindable-inputs.mjs` |
| `architecture-hardening/12-wc-bindable-observable-inventory.md` | `packages/worker/__tests__/wcBindableSemantics.test.ts` |
| `architecture-hardening/13-framework-adapter-binding-constraints.md` | `protocol/upgrade-properties.ts` |
| `architecture-hardening/14-handle-graph-wiring.md` | CLAUDE.md, `examples/synth-playground` |
| `architecture-hardening/15-state-component-mechanism-consistency.md` | `e2e/tests/state-*.spec.ts` 8 本 |

**日本語のまま — 内部戦略・評議会記録**

公開面ではない内部作業文書なので、日本語の `.md` を維持し英語版は作らない:

- `go-to-market-2026-08.md`, `go-to-market-2026-08-council.md`, `go-to-market-2026-08-synthesis-review.md`
- `project-strategy-2026-07.md`
- `state-redesign-council.md`
