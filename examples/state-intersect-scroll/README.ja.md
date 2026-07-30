# state + fetch + intersection + timer デモ（`<wcs-intersect>` による無限スクロール）

[`infinite-scroll`](../../packages/fetch/examples/infinite-scroll) と同じ無限スクロール
フィードを、全部入りの `<wcs-infinite-scroll>` ではなく低レベルな `@wcstack/intersection`
プリミティブで組んだもの。ここではセンチネルは*可視性を報告するだけ*で、それをどう
使うかは **state が決める**。

この版は **full-auto**：`manual` も `trigger` も無い。センチネルが `page` 番号を進め、
`<wcs-fetch>` の url は `page` から導出され、url が変わると素の auto-fetch が各ページを読む。
**url のバインドそのものが happy path のトリガー**——最もシンプルな配線で、`<wcs-intersect>`
が state に書き込めるからこそ可能（`<wcs-infinite-scroll>` では不可）。

失敗経路にはノードがもう1つ要る。センチネルは**エッジ検出器**であって時計ではない：
可視性が変化したことは報告できるが、何かをスケジュールすることはできない。フィードが空の
まま失敗したページはスクロールする対象を持たず、検出すべきエッジも二度と来ない——
「スクロールして再試行」は指示ではなくデッドロックになる。そこで `<wcs-timer manual once>` が
欠けていた `delay` を供給し、その上に有界な自動リトライを載せている（ポイント参照）。

トリガーを自分で制御したいとき（独自のガード、再武装、`ratio`/`visible` に反応したい等）、
あるいは汎用の可視性プリミティブが `@wcstack/fetch` とどう組み合わさるかを見たいときに、
こちらを使う。

## はじめに

パッケージは CDN（[esm.run](https://esm.run)）から読み込まれるため、ローカルビルドは不要です。Node.js だけで動きます。

```bash
node examples/state-intersect-scroll/server.js
```

ブラウザで http://localhost:3000 を開き、スクロールしてください。

失敗経路を試すには、サーバー側で 503 を注入できます。

```bash
# page1 が2回失敗する。フィードは空のまま始まるので、リトライ時計だけが復帰できる
FAIL_PAGE=1 node examples/state-intersect-scroll/server.js

# リトライ予算（maxRetries = 3）を使い切らせて手動 Retry ボタンまで到達させる
FAIL_PAGE=1 FAIL_TIMES=9 node examples/state-intersect-scroll/server.js

# 全ページが 40% の確率で失敗する
FLAKY=0.4 node examples/state-intersect-scroll/server.js
```

## 特徴

- **イベント駆動のセンチネル**: `<wcs-intersect target="self">` が `wcs-intersect:change` を発火し、`$on.sentinelChanged` が侵入エッジを `page` の前進に変換
- **`manual` なしの auto-fetch**: `<wcs-fetch>` の url は `page` から導出されるので、`page` を進めると url が変わり次ページを auto-fetch。`trigger` も fetch コマンドも不要
- **自己修復する再武装**: 各ページの後に state がセンチネルの `reobserve()` コマンドで強制再観測するため、マーカーを画面外へ押し出せない短いページでも次ページを読み込める
- **時計に載せた有界な自動リトライ**: 失敗したページが `<wcs-timer manual once>` を起動し、その tick が同じ url を再実行。`maxRetries` まで繰り返し、使い切ったらスケジュールを Retry ボタン（＝人間）に渡す
- **蓄積と終端契約は高レベル版と同一**: `$on` で追記、短いページで停止

## データフロー

```
scroll ──▶ <wcs-intersect target=self>   （可視性の変化）
                 │  wcs-intersect:change { isIntersecting }
                 ▼  eventToken.intersecting: sentinelChanged
           $on.sentinelChanged ── isIntersecting && !loading && !noMore && !error ──▶ page++
                 │  （page は url getter の唯一の入力）
                 ▼  get "pageFetch.url"  →  /api/items?page=N
           <wcs-fetch id=page-fetch>   （manual なし → url 変化で auto-fetch）
                 │  wcs-fetch:response { value, status }
                 ▼  eventToken.value: pageArrived
           $on.pageArrived ──▶ items = items.concat(page)        （ここでは page を進めない）
                 │                  ├─ page.length < pageSize → noMore = true
                 │                  └─ それ以外 → rearm  （reobserve()：強制再観測 → コールバック）
                 ▼
           <ul for: items>

   connect ──▶ url = /api/items?page=1  ──▶ auto-fetch が page1 を読む（明示トリガー無し）

   失敗経路（status < 200 || >= 300 — HTTP エラーもネットワークエラーもここに落ちる）

           $on.pageArrived ── retryAttempt < maxRetries ──▶ armRetry
                 │                                             │  start()：1回だけの遅延 tick
                 │                                             ▼
                 │                                       <wcs-timer manual once>
                 │                                             │  wcs-timer:tick
                 │                                             ▼  eventToken.tick: retryTick
                 │                                       $on.retryTick ──▶ refetch（同じ url）
                 │
                 └── 予算切れ ──▶ showError ──▶ <button onclick: retryNow>
```

## ポイント

- **url のバインドがトリガー。** `manual` が無いので `<wcs-fetch>` は connect 時と url 変化の度に auto-fetch する。url は `page` だけから導出され、`page` は交差時しか進まないので、auto-fetch は*ページ毎にちょうど1回*——連鎖しない。page1 は connect 時の auto-fetch で読まれ、`$connectedCallback` もコマンドも命令的トリガーも要らない。
- **intersect タグに「fetch を走らせる」挙動はない。** `<wcs-infinite-scroll>` と違い、純粋な可視性プロデューサだが *state に書き込める*。`eventToken.intersecting: sentinelChanged` が生の `wcs-intersect:change` を `$on` に届け、そこで `page` を進める。state に書けることこそ `<wcs-infinite-scroll>` にできない点で、それがこの `manual` 無し設計を可能にしている（あのタグは `trigger` を撃つだけなので `manual` が必須になる）。
- **前進は交差時、応答時ではない。** `page++` は `sentinelChanged` に置き、`pageArrived` には決して置かない。応答ハンドラで `page` を進めると、ページ着信の度に url が変わり auto-fetch が全カタログを連鎖ロードしてしまう。前進を交差エッジに置くことが「スクロール毎に1リクエスト」に抑える鍵。
- **エラーリトライには明示 fetch が要る。** 前進が交差時（成功と無関係）なので、失敗したページは `page` が据え置かれる。リトライは*そのページ*を再実行する必要があり、先へ進めると失敗ページを永久に飛ばす。だが url は不変で、auto-fetch は不変 url を de-dup する（v1.13）ため、バインドだけでは「再試行」を表現できない。**パスは場所であり、代入は状態変化である**——同じ値を2回代入することは1回代入することと区別できないが、同じ url を2回 fetch することは明確に区別される。`$command.refetch` があるのはそのため：明示 fetch は de-dup を迂回し、`FetchCore` はリクエスト開始時に `error` をクリアするので、成功すればフィードが再開する。これは回避策ではなく、値レールが運べる範囲の境界そのもの。
- **リトライには時計が要り、センチネルは時計ではない。** `<wcs-intersect>` が言えるのは「可視性が*変化*した」だけで、「1.5秒後にもう一度」は言えない。しかも失敗したページの後には報告すべき変化が残っていないことがある——page1 で失敗したフィードには中身が無く、スクロールする対象も、来るべきエッジも無い。センチネルだけに依存した復帰はデッドロックになる。そこで `$on.pageArrived` が `<wcs-timer manual once>` を起動し（`once` は `repeat="1"` の糖衣＝遅延 tick ちょうど1回＝素の `delay`）、`$on.retryTick` が `refetch` を撃つ。wcstack では他のあらゆる能力と同じく**時間もノード**であり、デモはそれを使えばよいだけだった。
- **センチネルは「ついでのリトライ」もしてはならない。** `$on.sentinelChanged` は `pageFetch.error` が立っていたら早期 return する。交差エッジで `refetch` を撃つのは一見無害（「ユーザーがスクロールしたのだから拾えばいい」）だが、実際にはライブロックになる：*「retrying…」*行の表示／非表示がレイアウトを変え、センチネルが observer のマージンを跨ぎ、それ自体が交差エッジを生む——予算を一切消費しない自己持続リトライループ。実際 e2e トレースで、ガード追加前は失敗サイクルごとにちょうど1回の予算外 refetch が計測された。**すべてのリトライ経路は予算付きか人間起動でなければならない**——現在それは2本（時計、そしてボタン）だけ。
- **予算は「起動時」ではなく「発射時」に消費する。** `retryAttempt` は時計を起動する `$on.pageArrived` ではなく、`refetch` を撃つ直前の `$on.retryTick` で増える。起動時に数えると、tick がまだ保留中なのに `retriesExhausted` が真になり、既に飛んでいるリトライの下で Retry ボタンが一瞬出てしまう。またガードで skip された tick が、リクエストを出さずに予算だけ食う。`maxRetries: 3` なら恒久的に失敗するページのリクエストはちょうど4回で止まる。
- **リトライポリシーは既定の作法どおり。** [docs/async-execution-model.md](../../docs/async-execution-model.md) §8 のとおり、自動リトライは4点を宣言する：`max`（有限＝`maxRetries`。無限は MUST NOT）、`interval`（固定。指数バックオフは opt-in でまだ採用ノード無し）、`resetOn`（ページ着信で予算リセット）、`excludeWhen`（`noMore` / リクエスト実行中 / error が既にクリア済み）。予算を使い切ることは設計の失敗ではなく、**スケジュールを人間に返す点**であり、それが Retry ボタンの役割。フィードが空のときはそのボタンが唯一残ったスケジューラになる。
- **リトライ間隔は意図的に静的属性。** `interval` をバインドすると周期は updater のマイクロタスク drain に載る値になるが、`command.start` は `$on` から同期発火するため、タイマーは*ひとつ前*の周期で開始してしまう。固定間隔リトライはどのみち既定の作法なので、静的属性にすれば何も失わずに順序ハザードだけ消せる。（既に走っているタイマーなら周期のバインドで問題ない：`attributeChangedCallback` が `changeInterval()` でライブに差し替える。）
- **再武装でショートページ停止を回避。** `IntersectionObserver` は可視性の*変化*でしか発火しない。ページ追記後の `$on.pageArrived` はセンチネルの `reobserve()` コマンドを呼ぶ。素の `observe()` は no-op——`IntersectionCore.observe()` は同一 target+options に対して冪等で**コールバックを再送せず early-return** する——ため、`<wcs-intersect>` は `reobserve()` を公開しており、これが observer を作り直して現在状態に対する初回コールバックを出す：センチネルがまだ見えていれば `page` が進み、画面外なら not-intersecting が返り次のスクロールを待つ。高レベルな `<wcs-infinite-scroll>` にはこのコマンドが**ない**ので、それがこのレベルに降りる主な理由。
- **ガード。** `$on.sentinelChanged` は `!loading` と `!noMore` でガード。`!loading` は二役：連鎖防止と*ページスキップ防止*。`page` 前進は次の auto-fetch をマイクロタスクに積み、それが次の IntersectionObserver コールバック（タスク）より前に `loading=true` を立てるので、急な2回目の enter は `loading=true` を見て無視される——`page` を2回進めてページを飛ばすことがない。（二重発火はリフェッチではなく*スキップ*になるため、ページ単位のサーバ冪等性では救えない。守っているのはこのマイクロタスク対タスクの順序。）

## テスト

実ブラウザのカバレッジは [`e2e/tests/state-intersect-scroll.spec.ts`](../../e2e/tests/state-intersect-scroll.spec.ts)（`cd e2e && npx playwright test state-intersect-scroll`）。失敗系のテストは**一切スクロールしない**——スクロールしないと直らない回帰こそが、ここで防ぎたいデッドロックそのものだから。

## 関連

このデモが依存するタイミング／発火の挙動（auto-fetch の de-dup と明示 fetch、`observe()` の冪等性と `reobserve()`、microtask 対 task の順序）は [docs/timing-and-firing-contract.md](../../docs/timing-and-firing-contract.md) にまとめてあります。

リトライポリシーの語彙（`max` / `interval` / `resetOn` / `excludeWhen` と、排他モード `latest` / `queue` / `exhaust` / `overlap`）は [docs/async-execution-model.md](../../docs/async-execution-model.md) §5・§8 が規範。ただし現状その語彙が使えるのは I/O ノードの**内側**だけで、userland は同等のガードを手書きするしかない——ここの `$on.sentinelChanged` と `$on.retryTick` がまさにそれ。state 側からも宣言できるようにすべきかは [docs/architecture-hardening/04-async-execution-and-wc-bindable.md](../../docs/architecture-hardening/04-async-execution-and-wc-bindable.md) の決定ゲート1。
