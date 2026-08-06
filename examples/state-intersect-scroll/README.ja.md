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

既存 item がある状態で error 確定
  -> 「error 確定時から scrollY が動いた」証拠を持つ sentinel edge が retryNonce を増加
       | scrollY が動いた leave: 次の enter を arm
       | scrollY が動いた enter: それ自体で成立
       | scrollY 不変の edge（error layout shift）: 無視
  -> 同じ page を新しい有界予算で restart
```

## 要点

- **README が宣伝する switchMap semantics を実際に使います。** `$streams.pageResult.args` が
  `page`、`pageSize`、`maxRetries`、`retryNonce` を読みます。いずれかが変わると、実行中の fetch
  または retry delay を abort し、最新の依存 snapshot で再起動します。古い run は page を commit できません。
- **pagination に手書きの loading/error exhaust guard はありません。** sentinel handler は
  `if (loading) return` で守る代わりに、commit 済み item 数から要求 page を導出します。
  成功前の enter は同値 no-op、成功後の enter は必ず次の1ページだけを選びます。ここで単純に `page++` すると、
  2回目の edge が page N を cancel して N+1 へ飛ばすため、switchMap と組み合わせる実装としては誤りです。
  handler に存在する `showError` 分岐は「その edge がユーザー操作か」を判定する retry 資格判定であり、
  pagination を守る exhaust gate ではありません。
- **`$streams` は switchMap であって retryWhen ではありません。** 自動再接続は意図的に持たないため、
  async generator `loadPage` が有限の `1 + maxRetries` attempt と abort 対応の固定 delay を所有します。
  retry 進捗は通常の stream 値として yield し、最終失敗は
  `$streamStatus.pageResult === "error"` と `$streamError.pageResult` に現れます。
- **自動予算後の Retry も依存駆動です。** ボタンは `retryNonce` を増やします。既存 item があれば、
  sentinel から離れて戻る scroll も同じ書き込みを行います。資格は「error 確定時から scrollY が動いたこと」で、
  どちらの edge でも運べます — scrollY が動いた `leave` は次の `enter` を arm し、scrollY が動いた `enter` は
  それ自体で成立します。後者が要るのは、error UI の挿入自体が sentinel を観測 band 外へ押し出す構成です。
  その leave は scrollY 不変のまま発火して arm できず、ユーザーが離れても（既に band 外なので）新しい edge は
  出ないため、arm だけを資格にすると最初の一往復が黙って無効化されます。page 番号は変えずに、error 状態の
  stream を新しい予算で restart します。
- **ページ単位と feed 全体の寿命を分離します。** `$streams` の値は restart ごとに reset されるため、
  `pageResult` は現在ページだけを保持します。成功値は `$updatedCallback` が長寿命の `items` へ commit します。
  `$updatedCallback` は binding 駆動なので、表示中の stream status meter をこの commit 境界の明示的な
  観測点にしています。hidden なダミー購読は使いません。
- **再観測で short-page stall を防ぎます。** full page の成功後に `reobserve()` を呼び、sentinel が境界を
  跨いでいなくても現在の可視性を再通知させます。partial page は `noMore` を立てて終了します。
- **retry 予算は有限です。** `maxRetries: 3` なら恒久失敗時は正確に4 request で停止します。error 時に
  `reobserve()` は呼びません。可視 sentinel を再観測すると、error layout 自体が無限 retry scheduler に
  なり得るためです。復帰にはボタン、または error 確定後に scrollY が動いた sentinel edge が必要です。
  空 feed では scroll できないため、引き続きボタンが必要です。

## 意図的に残る命令的境界

この例は、`$streams` が RxJS 規模のデータフロー代数を持つと主張するものではありません。
残っている命令的処理は、現行 API の実際の境界です。

- producer 内の `fold` は依存 restart ごとに `initial` へ戻ります。page run を跨いで結果を畳み込めないため、
  `items = items.concat(batch)` は feed 全体の長寿命 state へ commit する命令的処理です。
- `$streams` が持つのは switchMap 型 restart であり、`retryWhen`、timer、merge、occurrence operator は
  ありません。そのため attempt loop と abort 対応 delay は producer が所有します。
- `retryNonce` は「同じ page をもう一度」を occurrence から変化する依存値へ変換します。これは意図的ですが、
  value ベースの restart API が必要とする符号化であることに変わりはありません。
- commit-before-reobserve はグラフの型ではなく `$updatedCallback` の文順で表します。ただし `reobserve()` が
  発火するのは後続 observer task であり、page は commit 済み件数から冪等に導出されるため、2文間の同期 race に
  正しさを依存させてはいません。
- scroll retry の資格判定は `window.scrollY` を読みます。これは state モジュールが他では一切触らない帯域外の
  viewport source であり、document 自体が scroll container であることも仮定しています。本来の要件は
  「2つの交差 edge の間にユーザーが scroll したか」で、それを判定できるのは scroll を観測する driver だけです。
  `<wcs-intersect>` には資格付き再進入 event が無いため、state 側が edge 時点の scroll 位置から近似しています。
  また trigger は edge だけです。観測 band を跨がない往復は event を一切生まないため、edge を鍵にする
  資格判定はどれも観測できません（前回の位置を越えて scroll すれば復帰します）。資格判定済みの
  `retryRequested` event token を発する I/O ノードがあれば、2つのフィールドと `window` 参照は
  `$on` の1行に畳めます。

宣言的なのは依存・cancel の edge です。run を跨ぐ蓄積、retry policy、終端 commit は命令的に残ります。
これらを隠すのではなく消すには、state-only effect/watch API と時間・合成 operator が必要です。

## テスト

実ブラウザテストは
[`e2e/tests/state-intersect-scroll.spec.ts`](../../e2e/tests/state-intersect-scroll.spec.ts) にあります。

```bash
cd e2e
npx playwright test state-intersect-scroll
```

失敗系テストは active run の cancel と stale 結果の破棄、予算内の自動復帰、`1 + maxRetries` での厳密な停止、
ボタン復帰、layout 起点の retry loop が無いことを検証します。別のテストでは40件 commit 後に page 3 の予算を
使い切らせ、自動再試行せず停止すること、その後の sentinel `leave → enter` が page 3 を再試行することを確認します。
さらに、error UI 自体が sentinel を観測 band 外へ押し出す構成（唯一の leave edge が scrollY 不変で発火する）でも、
scroll 一往復で再試行できることを検証します。正常系は各 page を1回ずつ要求して87件すべてを読み、
partial page で終了します。

## 関連

- [`@wcstack/state` stream リファレンス](../../packages/state/docs/streams.md) — 依存捕捉、switchMap restart、
  status/error 名前空間、cancel、lifecycle
- [タイミングと発火の契約](../../docs/timing-and-firing-contract.md) — 同値 page 選択と強制再観測
- [非同期実行モデル](../../docs/async-execution-model.md) — `latest` と有界 retry の語彙
