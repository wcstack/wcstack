# state + intersection + `$streams` デモ（`<wcs-intersect>` による無限スクロール）

[`infinite-scroll`](../../packages/fetch/examples/infinite-scroll) の低レベル版です。
`<wcs-intersect>` は可視性だけを報告し、`@wcstack/state` の `$streams` がページ取得、
switchMap 型キャンセル、有界リトライを所有します。

重要なのは、単に fetch を stream 内へ移したことではありません。要求ページは `page++` ではなく、
**commit 済み** item 数から導出します。page N の実行中または失敗後に交差 edge が繰り返されても、
再び N を書くだけなので同値 no-op です。N の commit 後は同じ式が N+1 を返し、その依存変更を
`$streams` が検出して旧 producer を abort し、最新 producer を起動します。

## 起動

package は CDN（[esm.run](https://esm.run)）から読み込むため、必要なのは Node.js だけです。

```bash
node examples/state-intersect-scroll/server.js
```

http://localhost:3000 を開いてスクロールしてください。

失敗注入もできます。

```bash
# page 1 が2回失敗し、自動リトライ予算内で復帰
FAIL_PAGE=1 node examples/state-intersect-scroll/server.js

# maxRetries=3 を使い切り、手動 Retry ボタンへ移行
FAIL_PAGE=1 FAIL_TIMES=9 node examples/state-intersect-scroll/server.js

# 各ページが40%の確率で失敗
FLAKY=0.4 node examples/state-intersect-scroll/server.js
```

## データフロー

```text
<wcs-intersect> enter
  -> page = floor(items.length / pageSize) + 1
       | 同じ page: 同値 no-op（実行中／error の edge は skip も retry もしない）
       | 次の page: $streams の args 依存が変化
       v
$streams.pageResult
  -> 旧 run を abort
  -> AbortSignal 付きで要求ページを fetch
  -> 失敗時: producer 内で有界 delay/retry
  -> { kind: "success", items } を yield
       v
$updatedCallback
  -> 長寿命の items へページを append
  -> command.reobserve
       v
現在の可視性を再通知、または次の scroll を待つ
```

## 要点

- **README が宣伝する switchMap semantics を実際に使います。** `$streams.pageResult.args` が
  `page`、`pageSize`、`maxRetries`、`retryNonce` を読みます。いずれかが変わると、実行中の fetch
  または retry delay を abort し、最新の依存 snapshot で再起動します。古い run は page を commit できません。
- **手書きの loading/error exhaust guard はありません。** sentinel handler には
  `if (loading) return` も `if (error) return` もありません。commit 済み item 数から要求 page を導出するため、
  成功前の enter は同値 no-op、成功後の enter は必ず次の1ページだけを選びます。ここで単純に `page++` すると、
  2回目の edge が page N を cancel して N+1 へ飛ばすため、switchMap と組み合わせる実装としては誤りです。
- **`$streams` は switchMap であって retryWhen ではありません。** 自動再接続は意図的に持たないため、
  async generator `loadPage` が有限の `1 + maxRetries` attempt と abort 対応の固定 delay を所有します。
  retry 進捗は通常の stream 値として yield し、最終失敗は
  `$streamStatus.pageResult === "error"` と `$streamError.pageResult` に現れます。
- **手動 Retry も依存駆動です。** ボタンは `retryNonce` を増やします。page 番号は変えずに、error 状態の
  stream を新しい予算で restart できます。
- **ページ単位と feed 全体の寿命を分離します。** `$streams` の値は restart ごとに reset されるため、
  `pageResult` は現在ページだけを保持します。成功値は `$updatedCallback` が長寿命の `items` へ commit します。
  hidden な `pageResult` binding はこの commit 境界を明示します（`$updatedCallback` は binding に参加する path を観測します）。
- **再観測で short-page stall を防ぎます。** full page の成功後に `reobserve()` を呼び、sentinel が境界を
  跨いでいなくても現在の可視性を再通知させます。partial page は `noMore` を立てて終了します。
- **retry 予算は有限です。** `maxRetries: 3` なら恒久失敗時は正確に4 request で止まり、その後は人間へ
  schedule を返します。交差 edge は同じ page を書くだけなので、予算外 retry 経路を作れません。

## テスト

実ブラウザテストは
[`e2e/tests/state-intersect-scroll.spec.ts`](../../e2e/tests/state-intersect-scroll.spec.ts) にあります。

```bash
cd e2e
npx playwright test state-intersect-scroll
```

失敗系テストは意図的に一切スクロールしません。active run の cancel と stale 結果の破棄、予算内の自動復帰、
`1 + maxRetries` での厳密な停止、手動復帰、layout 起点の retry loop が無いことを検証します。
正常系は各 page を1回ずつ要求して87件すべてを読み、partial page で終了します。

## 関連

- [`@wcstack/state` stream リファレンス](../../packages/state/docs/streams.md) — 依存捕捉、switchMap restart、
  status/error 名前空間、cancel、lifecycle
- [タイミングと発火の契約](../../docs/timing-and-firing-contract.md) — 同値 page 選択と強制再観測
- [非同期実行モデル](../../docs/async-execution-model.md) — `latest` と有界 retry の語彙
