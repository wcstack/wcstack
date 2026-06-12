# state + fetch + intersection デモ（`<wcs-intersect>` による無限スクロール）

[`state-infinite-scroll`](../state-infinite-scroll) と同じ無限スクロールフィードを、
全部入りの `<wcs-infinite-scroll>` ではなく低レベルな `@wcstack/intersection`
プリミティブで組んだもの。ここではセンチネルは*可視性を報告するだけ*で、それをどう
使うかは **state が決める**。

この版は **full-auto**：`manual` も `trigger` も fetch コマンドも無い。センチネルが
`page` 番号を進め、`<wcs-fetch>` の url は `page` から導出され、url が変わると素の
auto-fetch が各ページを読む。**url のバインドそのものがトリガー**——最もシンプルな配線で、
`<wcs-intersect>` が state に書き込めるからこそ可能（`<wcs-infinite-scroll>` では不可）。

トリガーを自分で制御したいとき（独自のガード、再武装、`ratio`/`visible` に反応したい等）、
あるいは汎用の可視性プリミティブが `@wcstack/fetch` とどう組み合わさるかを見たいときに、
こちらを使う。

## はじめに

パッケージは CDN（[esm.run](https://esm.run)）から読み込まれるため、ローカルビルドは不要です。Node.js だけで動きます。

```bash
node examples/state-intersect-scroll/server.js
```

ブラウザで http://localhost:3000 を開き、スクロールしてください。

## 特徴

- **イベント駆動のセンチネル**: `<wcs-intersect target="self">` が `wcs-intersect:change` を発火し、`$on.sentinelChanged` が侵入エッジを `page` の前進に変換
- **`manual` なしの auto-fetch**: `<wcs-fetch>` の url は `page` から導出されるので、`page` を進めると url が変わり次ページを auto-fetch。`trigger` も fetch コマンドも不要
- **自己修復する再武装**: 各ページの後に state がセンチネルの `reobserve()` コマンドで強制再観測するため、マーカーを画面外へ押し出せない短いページでも次ページを読み込める
- **蓄積と終端契約は高レベル版と同一**: `$on` で追記、短いページで停止

## データフロー

```
scroll ──▶ <wcs-intersect target=self>   （可視性の変化）
                 │  wcs-intersect:change { isIntersecting }
                 ▼  eventToken.intersecting: sentinelChanged
           $on.sentinelChanged ── isIntersecting && !loading && !noMore ──▶ page++
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
```

## ポイント

- **url のバインドがトリガー。** `manual` が無いので `<wcs-fetch>` は connect 時と url 変化の度に auto-fetch する。url は `page` だけから導出され、`page` は交差時しか進まないので、auto-fetch は*ページ毎にちょうど1回*——連鎖しない。page1 は connect 時の auto-fetch で読まれ、`$connectedCallback` もコマンドも命令的トリガーも要らない。
- **intersect タグに「fetch を走らせる」挙動はない。** `<wcs-infinite-scroll>` と違い、純粋な可視性プロデューサだが *state に書き込める*。`eventToken.intersecting: sentinelChanged` が生の `wcs-intersect:change` を `$on` に届け、そこで `page` を進める。state に書けることこそ `<wcs-infinite-scroll>` にできない点で、それがこの `manual` 無し設計を可能にしている（あのタグは `trigger` を撃つだけなので `manual` が必須になる）。
- **前進は交差時、応答時ではない。** `page++` は `sentinelChanged` に置き、`pageArrived` には決して置かない。応答ハンドラで `page` を進めると、ページ着信の度に url が変わり auto-fetch が全カタログを連鎖ロードしてしまう。前進を交差エッジに置くことが「スクロール毎に1リクエスト」に抑える鍵。
- **エラーリトライには明示 fetch が要る。** 前進が交差時（成功と無関係）なので、失敗したページは `page` が据え置かれる。次の交差ではそのページを*再試行*する必要があり、先へ進めると失敗ページを永久に飛ばす。だが url は不変で、auto-fetch は不変 url を de-dup する（v1.13）ため、バインドだけでは「再試行」を表現できない。そこで `sentinelChanged` はまず `pageFetch.error` を見て、立っていれば `command.fetch`（`$command.refetch`）を撃つ——明示 fetch は de-dup を迂回し、`FetchCore` はリクエスト開始時に `error` をクリアするので、成功すればフィードが再開する。happy path はバインド駆動のまま、fetch コマンドはこの再試行専用。
- **再武装でショートページ停止を回避。** `IntersectionObserver` は可視性の*変化*でしか発火しない。ページ追記後の `$on.pageArrived` はセンチネルの `reobserve()` コマンドを呼ぶ。素の `observe()` は no-op——`IntersectionCore.observe()` は同一 target+options に対して冪等で**コールバックを再送せず early-return** する——ため、`<wcs-intersect>` は `reobserve()` を公開しており、これが observer を作り直して現在状態に対する初回コールバックを出す：センチネルがまだ見えていれば `page` が進み、画面外なら not-intersecting が返り次のスクロールを待つ。高レベルな `<wcs-infinite-scroll>` にはこのコマンドが**ない**ので、それがこのレベルに降りる主な理由。
- **ガード。** `$on.sentinelChanged` は `!loading` と `!noMore` でガード。`!loading` は二役：連鎖防止と*ページスキップ防止*。`page` 前進は次の auto-fetch をマイクロタスクに積み、それが次の IntersectionObserver コールバック（タスク）より前に `loading=true` を立てるので、急な2回目の enter は `loading=true` を見て無視される——`page` を2回進めてページを飛ばすことがない。（二重発火はリフェッチではなく*スキップ*になるため、ページ単位のサーバ冪等性では救えない。守っているのはこのマイクロタスク対タスクの順序。）

## 関連

このデモが依存するタイミング／発火の挙動（auto-fetch の de-dup と明示 fetch、`observe()` の冪等性と `reobserve()`、microtask 対 task の順序）は [docs/timing-and-firing-contract.md](../../docs/timing-and-firing-contract.md) にまとめてあります。
