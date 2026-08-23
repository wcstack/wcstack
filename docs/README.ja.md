# wcstack docs

設計ドキュメント・実装計画・仕様提案。各パッケージの公開面については当該パッケージの `README.md` が正本であり、ここに置くのはパッケージを横断する契約とその判断理由。

**English**: [README.md](./README.md)

## 命名規約

| 接尾辞 | 言語 |
|---|---|
| `<name>.md` | 英語（正本） |
| `<name>.ja.md` | 日本語 |

付随するルールが 4 つある:

1. **リンクは言語内で閉じる。** 英語ドキュメントは `other.md` を、日本語は `other.ja.md` を指す。混ぜない — 読んでいる途中で言語から落ちないようにするため。
2. **移行が終わるまで、英語ドキュメントから未翻訳ファイルへのリンクには初出で `(ja)` を付す。** 同じ文書への行リンクを繰り返すたびに付けるのはノイズなので初出のみ。読者がどこに着地するかを正直に示すためであり、翻訳が済んだら外す。
3. **英語版ができてからリネームする。** `.md` が存在しない状態で日本語ファイルを `.ja.md` に動かすと、コード・examples・README から `docs/<name>.md` への既存参照が全部切れる。
4. **消えたファイルへの参照は commit permalink にする。** 相対リンクは 404 になり、併記した行番号も意味を失う。ファイルが最後に存在した commit を指し（`https://github.com/wcstack/wcstack/blob/<full-sha>/<path>#L<n>`）、どの commit で削除されたかを初出で書く。絶対 URL が正しいのはここだけで、現存するものへのリンクは相対のまま。出どころは synth-playground の原型 `wcs-synth.js`（`cbd5598e` で削除・`1e26a2a9` を参照）。

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
| [timing-and-firing-contract.md](./timing-and-firing-contract.md) | [timing-and-firing-contract.ja.md](./timing-and-firing-contract.ja.md) |
| [devtools-hook-protocol.md](./devtools-hook-protocol.md) | [devtools-hook-protocol.ja.md](./devtools-hook-protocol.ja.md) |
| [custom-state-reflection-design.md](./custom-state-reflection-design.md) | [custom-state-reflection-design.ja.md](./custom-state-reflection-design.ja.md) |
| [signals-definition-timing.md](./signals-definition-timing.md) | [signals-definition-timing.ja.md](./signals-definition-timing.ja.md) |
| [signals-state-design.md](./signals-state-design.md) | [signals-state-design.ja.md](./signals-state-design.ja.md) |
| [state-binding-init-races.md](./state-binding-init-races.md) | [state-binding-init-races.ja.md](./state-binding-init-races.ja.md) |
| [scoped-custom-element-registries.md](./scoped-custom-element-registries.md) | [scoped-custom-element-registries.ja.md](./scoped-custom-element-registries.ja.md) |
| [screen-orientation-tag-design.md](./screen-orientation-tag-design.md) | [screen-orientation-tag-design.ja.md](./screen-orientation-tag-design.ja.md) |
| [audio-impl-plan.md](./audio-impl-plan.md) | [audio-impl-plan.ja.md](./audio-impl-plan.ja.md) |
| [architecture-hardening/README.md](./architecture-hardening/README.md) | [README.ja.md](./architecture-hardening/README.ja.md) |
| [architecture-hardening/09-remediation-design.md](./architecture-hardening/09-remediation-design.md) | [09…ja.md](./architecture-hardening/09-remediation-design.ja.md) |
| [architecture-hardening/10-defaulting-rollout-status.md](./architecture-hardening/10-defaulting-rollout-status.md) | [10…ja.md](./architecture-hardening/10-defaulting-rollout-status.ja.md) |
| [architecture-hardening/12-wc-bindable-observable-inventory.md](./architecture-hardening/12-wc-bindable-observable-inventory.md) | [12…ja.md](./architecture-hardening/12-wc-bindable-observable-inventory.ja.md) |
| [architecture-hardening/13-framework-adapter-binding-constraints.md](./architecture-hardening/13-framework-adapter-binding-constraints.md) | [13…ja.md](./architecture-hardening/13-framework-adapter-binding-constraints.ja.md) |
| [architecture-hardening/14-handle-graph-wiring.md](./architecture-hardening/14-handle-graph-wiring.md) | [14…ja.md](./architecture-hardening/14-handle-graph-wiring.ja.md) |
| [architecture-hardening/15-state-component-mechanism-consistency.md](./architecture-hardening/15-state-component-mechanism-consistency.md) | [15…ja.md](./architecture-hardening/15-state-component-mechanism-consistency.ja.md) |

ここまでで優先分（コード・examples・README が参照している文書）は全て完了。残る未翻訳は内部の設計メモと実装計画（`*-tag-design.md` / `*-impl-plan.md` / `state-*.md` / `io-node-*.md` / `architecture-hardening/01`〜`08`・`11`）で、触るときに合わせて翻訳する。

**日本語のまま — 内部戦略・評議会記録**

公開面ではない内部作業文書なので、日本語の `.md` を維持し英語版は作らない:

- `go-to-market-2026-08.md`, `go-to-market-2026-08-council.md`, `go-to-market-2026-08-synthesis-review.md`
- `project-strategy-2026-07.md`
- `state-redesign-council.md`
