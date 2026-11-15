# state + fetch デモ（`<wcs-infinite-scroll>` による無限スクロール）

`@wcstack/state` と `@wcstack/fetch` で作る無限スクロールのフィード。末尾のセンチネル
（`<wcs-infinite-scroll>`）がビューポートに入ると `<wcs-fetch>` を実行し、各ページを
state 側で**追記（append）**していくため、リストはちらつきも再読み込みもなく伸びていきます。

`<wcs-infinite-scroll>` は **`@wcstack/fetch` に同梱**されており、追加パッケージは不要です。
こちらは高レベル・全部入りの選択肢。手配線する低レベル版は姉妹デモ
`@wcstack/state` の `$stream` と低レベル intersection primitive を使う
[`state-intersect-scroll`](../../../../examples/state-intersect-scroll) を参照してください。その中間の
[`state-intersect-fetch`](../../../../examples/state-intersect-fetch) は `<wcs-fetch>` をそのまま使い、
`<wcs-intersect>` のセンチネルと state でつなぎます（event token で受け、command token で動かす）。

## はじめに

パッケージは CDN（[esm.run](https://esm.run)）から読み込まれるため、ローカルビルドは不要です。Node.js だけで動きます。

```bash
node packages/fetch/examples/infinite-scroll/server.js
```

ブラウザで http://localhost:3000 を開き、スクロールしてください。

## 特徴

- **センチネル駆動のロード**: `<wcs-infinite-scroll target="page-fetch">` がマーカーのビューポート侵入（240px の先読みマージン付き）で fetch を起動
- **ページの蓄積は state 側**: `<wcs-fetch>.value` は常に1ページ分しか保持しないため、各レスポンスをイベントトークン経由で `state.items` に追記
- **終端検出**: `pageSize` 未満のページが来たら最終ページ → `noMore` を立ててセンチネルを無効化
- **二重ロードしない**: fetch は `manual` なので、`page` を進めて（url が変わって）も余計なリクエストは飛ばない
- **ウィンドウの高さを選ばない**: 読み込んだページがセンチネルを画面に残したら（縦に長いウィンドウ、縮小表示）、センチネルが画面を出るかフィードが終わるまで次のページを読む
- **失敗は利用者を待つ**: センチネルは失敗したリクエストを繰り返さない。「Try again」か、スクロールで離れて戻ると、もう一度走る

## データフロー

```
scroll ──▶ <wcs-infinite-scroll>  （センチネルがビューポートに侵入）
                 │  対象に trigger=true をセット
                 ▼
           <wcs-fetch id=page-fetch manual>   url = /api/items?page=(page+1)
                 │  wcs-fetch:response  { value, status }
                 ▼  eventToken.value: pageArrived
           $on.pageArrived  ──▶  items = items.concat(batch);  page++
                 │                     └─ batch.length < pageSize なら noMore = true
                 ▼
           <ul for: items>            （伸びていくフィード）

           disabled: noMore  ──▶  <wcs-infinite-scroll>  が観測停止
```

## ポイント

- **`value` は「置換」であって「追記」ではない。** `<wcs-fetch>` は最新レスポンスだけを公開する。無限スクロールは全ページが要るので、リストに `value` を直接バインドしない。`eventToken.value: pageArrived` で各レスポンスを `$on` に渡し、`items.concat(...)` で蓄積する。蓄積は state の責務、タグはスクロール検出だけを持つ。
- **`manual` は必須。** url getter は `page+1` を返すので毎回 url が変わる。`manual` がないとその url 変化で自動 fetch が走り二重ロードになる。`manual` ならセンチネルの `trigger=true` だけがリクエストを起動する。
- **`url` は state から書く — 1 ページ目の静的な `url` は置かない。** センチネルはたいてい、state が `url` を書くより先に報告する。4.24 からは `url` が書かれたときにリクエストを走らせるので、最初のページのために他に要るものは無い。静的な `url="/api/items?page=1&limit=20"`（このデモは 4.23 までそうしていた）だと、state が要素を束ねる前にリクエストが始まり、最初の答えが `eventToken.value` のハンドラが付く前に届くことがある — Firefox では毎回失われた。
- **センチネルには実箱が要る。** `<wcs-infinite-scroll>` は既定 `display:inline` で、中身が無いと 0×0 に潰れ、`IntersectionObserver` が不安定に観測する（初回交差を取りこぼし得る）。デモでは `display:block; min-height:1px` を与えて初回観測を決定的にしている。
- **センチネルはリストの直後、スピナーとメッセージより上に置く。** センチネルを動かすのは行だけになる。下に置くと、読み込み中のスピナーがセンチネルを押し下げて 240px のマージンの外へ出し、続いているスクロールが戻す。要素から見るとこれはセンチネルがもう一度画面に入ったことなので、その間に失敗したリクエストをもう一度取りに行く。
- **`page` の前進はレスポンス後。** `page++` は `$on.pageArrived` の成功時のみ。早すぎるとページ抜け、エラー時に進めると失敗ページを丸ごと飛ばす（失敗時は `page` を据え置く）。センチネルは失敗したリクエストを自分では繰り返さない: 利用者がスクロールで離れて戻るか、「Try again」を押す — これは `command.fetch:` で同じ url のリクエストを走らせる。
- **終端契約＝短いページ。** サーバは素の配列を返し、`pageSize` 未満ならカタログ終端。`noMore` がセンチネルの `disabled` を立て、`applyChangeToProperty` が要素の `disabled` プロパティを代入 → setter が属性へ反映 → 観測ロジックが再評価され観測停止する。
- **センチネルを画面に残したページの後は、次のページが続く**（4.24 から）。`IntersectionObserver` は可視性の*変化*でしか発火しないので、縦に長いウィンドウ・縮小表示・短いページでは、以前はここで止まった。今は、リクエストが行を足して終わると要素がもう一度見て、センチネルが画面を出るまで続ける。行を足さなかった応答で終わる。

## 関連

このデモが依存する fetch の発火／タイミング挙動（auto-fetch の de-dup、`response` はエラーでも発火、センチネルに box が要る、センチネルが画面に残っている間の動き — §26）は [docs/timing-and-firing-contract.ja.md](../../../../docs/timing-and-firing-contract.ja.md) にまとめてあります。このデモの先で長い一覧に要るもの — ページの読み込み中に変わる絞り込み、行、行の窓、戻ってきたとき — は [docs/long-lists.ja.md](../../../../docs/long-lists.ja.md) にあります。
