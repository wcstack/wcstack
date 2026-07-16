# wcstack アーキテクチャ難所の堅牢化

- **作成日**: 2026-07-14
- **状態**: 一部採択・実装済み。phase 0-6 の PoC 実装は完了し、phase 2（方向認識初期同期）/ phase 3
  （因果伝播）は既定 `true` に反転済み。opt-in → 既定化 / IO 族横展開の進捗と残作業は
  [10-defaulting-rollout-status.md](10-defaulting-rollout-status.md) が追跡する。未実装の設計提案は
  各論点 doc（01-08）に残る。
- **対象スナップショット**:
  - wcstack: `27371dca55888c864028042e71d8a7e7149365b4`（v1.20.0）
  - wc-bindable-protocol: `5ec0deef212578a072b2f669d2a5554f254253e0`
  - npm 公開版: `@wc-bindable/core@0.8.0`

## 目的

wcstack は、リアクティブコア、UI、I/O ノードを共通プロトコルで疎結合にする。
交換可能性が高い一方、初期化順序、双方向伝播、非同期実行、観測性などの難しさも
境界上に現れる。本ディレクトリは、その難所を個別に分解し、現状、未解決点、推奨する
対策、互換性、検証条件を記録する。

本文書群は設計判断の材料であり、記載した API やメタデータは未実装である。
既存の規範文書と矛盾する場合は、採択と実装に先立って当該規範文書を更新する。

## 論点一覧

1. [タグ定義とバインディング確立の順序](01-binding-initialization-order.md)
2. [接続直後の初期状態配送](02-initial-state-delivery.md)
3. [双方向バインディングのエコー制御](03-two-way-echo-control.md)
4. [非同期実行と wc-bindable 境界](04-async-execution-and-wc-bindable.md)
5. [観測性・デバッグと wc-bindable 境界](05-observability-and-wc-bindable.md)
6. [パス文字列の型安全性](06-path-type-safety.md)
7. [ブラウザ capability 差の吸収](07-browser-capability-variance.md)
8. [プロトコル進化と互換性](08-protocol-evolution.md)

## 8 論点を横断する修正設計

- [8 論点を横断する修正設計](09-remediation-design.md) — `BindableDeclarationReader`、
  `BindingSession`、`PropagationContext`、`OperationTicket`、`wcstack.manifest.json` の責務分割、
  段階導入、回帰テスト、decision gate をまとめる。

## 既定化・横展開ステータス

- [既定化・横展開ステータスと残作業](10-defaulting-rollout-status.md) — phase 0-6 の PoC 実装完了後の
  opt-in → 既定化 / IO 族横展開の進捗と残作業を追跡する living document（Phase 2/3 既定化済み、
  errorInfo 8/35 ノード、5a CI ゲート化 / 5b analyzer 既定 ON / 残ノード横展開 が未）。

## 横断原則

1. **暗黙の時刻依存を、明示的なフェーズまたは状態へ変える。**
2. **初期スナップショットと後続イベントを分ける。**
3. **値、イベント、コマンド、ライブハンドルの意味を混ぜない。**
4. **正しさは世代・所有権・順序契約で担保し、キャンセル API だけに依存しない。**
5. **本番コストを増やさず、開発時には因果関係を観測可能にする。**
6. **ビルドレスを維持し、型検査と capability 情報は漸進的に追加する。**
7. **既存プロトコルの意味を変更せず、追加情報は後方互換な形で表現する。**

## wc-bindable の参照方針

論点 4・5 は、wcstack 内の `static wcBindable` 宣言だけでなく、公式
wc-bindable-protocol の最新仕様を参照する。特に次を前提とする。

- コアの `properties` は producer から consumer への観測面である。
- `inputs` と `commands` はコアでは宣言メタデータであり、呼び出し意味論は拡張仕様に属する。
- 初期同期、teardown、forward compatibility はコア仕様の規範である。
- remote の ack、順序、timeout、AbortSignal、back-pressure、wire capability は拡張仕様の規範である。
- デバッグ計装はコアの観測意味論を変えず、別の side channel として設計する。

参照先は更新による意味のずれを避けるため、本文書作成時のコミットに固定する。

- [wc-bindable SPEC.md](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/SPEC.md)
- [wc-bindable SPEC-extensions.md](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/SPEC-extensions.md)
- [wc-bindable remote README](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/packages/remote/README.md)
- [wc-bindable CONFORMANCE.md](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/5ec0deef212578a072b2f669d2a5554f254253e0/CONFORMANCE.md)

## 採択の進め方

各文書の提案は独立に採択できる。ただし、初期同期に関する 1・2、実行と観測に関する
4・5、型情報とプロトコル進化に関する 6・8 は相互依存する。実装へ進む際は、各文書の
「決定ゲート」を先に確定し、[8 論点を横断する修正設計](09-remediation-design.md) の phase と適合テストを
実装の完了条件に含める。
