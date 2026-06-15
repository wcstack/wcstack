# defined ローダーゲート デモ

`@wcstack/state` + `@wcstack/defined`（`<wcs-defined>`）。遅延ロードされる Web Components の readiness ゲート。コンポーネント登録中はスピナー、準備完了で本体、登録が来なければ**ロード失敗フォールバック**を表示する。

## はじめに

`index.html` をブラウザで開くだけ（静的サーバ、またはファイル直開き）。ビルド不要で、すべて `esm.run` から読み込まれる。

デモは遅延ロードを模倣する: `demo-chart` は約 1.2 秒後に「import 成功」し、`demo-table` はわざと登録されないため timeout で `missing` に落ちる。**Retry** を押すと後から登録され、ゲートが完成する様子を確認できる。

## 機能

- **`<wcs-defined tags="demo-chart,demo-table" timeout="3000">` が監視**: 両タグの `customElements.whenDefined()` を待ち、`defined` / `pending` / `missing` / `count` / `total` / `error` を state 化する。read-only でコマンドは無い。
- **`data-wcs="hidden: ready|not"` の readiness ゲート**: 監視対象すべてが登録されて初めてゲート内が表示される（既定 `mode="all"`）。`|not` フィルタが `ready` を反転するため、`ready` が false の間は `hidden`、true に転じると表示される。
- **timeout による失敗検出**: 3 秒経過で未解決タグが `missing` へ落ち、赤い「ロード失敗」バナーになる。CSS `:not(:defined)` ではこれができず、永遠に隠したままになる。
- **進捗バー**: `count / total` で駆動。
- **遅延昇格**: Retry で `demo-table` を登録すると `missing` から ready カウントへ戻り、ゲートが開く。

## ポイント

- **CSS `:defined` と `<wcs-defined>` の使い分け**。単なる FOUC 回避なら CSS `:not(:defined)` で十分。本要素の価値は **timeout による失敗検出**、複数タグの集約（`all` / `any`）、そして readiness を分岐可能な reactive state として露出することにある。
- **autoloader のコンパニオン**。実アプリでは監視対象タグは Import Map + `@wcstack/autoloader`（`@components/` プレフィックス）由来。動的 import が失敗すると `whenDefined` は永久に未解決のまま。`timeout` がそのハングを観測可能な `missing` 状態に変える。
- **event-token 専用**。`<wcs-defined>` は一方向の要素 → state 監視ノードで、「タグを定義する」コマンドは存在せず観測のみ。よって command-token のサーフェスを持たない。
