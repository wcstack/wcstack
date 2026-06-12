# state + fetch デモ（`<wcs-infinite-scroll>` による無限スクロール）

`@wcstack/state` と `@wcstack/fetch` で作る無限スクロールのフィード。末尾のセンチネル
（`<wcs-infinite-scroll>`）がビューポートに入ると `<wcs-fetch>` を実行し、各ページを
state 側で**追記（append）**していくため、リストはちらつきも再読み込みもなく伸びていきます。

`<wcs-infinite-scroll>` は **`@wcstack/fetch` に同梱**されており、追加パッケージは不要です。
こちらは高レベル・全部入りの選択肢。手配線する低レベル版は姉妹デモ
[`state-intersect-scroll`](../state-intersect-scroll) を参照してください。

## はじめに

パッケージは CDN（[esm.run](https://esm.run)）から読み込まれるため、ローカルビルドは不要です。Node.js だけで動きます。

```bash
node examples/state-infinite-scroll/server.js
```

ブラウザで http://localhost:3000 を開き、スクロールしてください。

## 特徴

- **センチネル駆動のロード**: `<wcs-infinite-scroll target="page-fetch">` がマーカーのビューポート侵入（240px の先読みマージン付き）で fetch を起動
- **ページの蓄積は state 側**: `<wcs-fetch>.value` は常に1ページ分しか保持しないため、各レスポンスをイベントトークン経由で `state.items` に追記
- **終端検出**: `pageSize` 未満のページが来たら最終ページ → `noMore` を立ててセンチネルを無効化
- **二重ロードしない**: fetch は `manual` なので、`page` を進めて（url が変わって）も余計なリクエストは飛ばない

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
- **`page` の前進はレスポンス後。** `page++` は `$on.pageArrived` の成功時のみ。早すぎるとページ抜け、エラー時に進めると失敗ページを丸ごと飛ばす。失敗時は `page` を据え置き、次のスクロールで同じ url を再試行する。
- **終端契約＝短いページ。** サーバは素の配列を返し、`pageSize` 未満ならカタログ終端。`noMore` がセンチネルの `disabled` を立て、`applyChangeToProperty` が要素の `disabled` プロパティを代入 → setter が属性へ反映 → 観測ロジックが再評価され観測停止する。
- **ショートページの注意点。** `IntersectionObserver` は可視性の*変化*でしか発火しない。読み込んだページが短くてセンチネルを（マージン込みの）ビューポート外へ押し出せないと、次のコールバックが来ず停止する。1ページがビューポート＋240px の先読みマージンを超えるよう行の高さ／`pageSize` を確保すること。（`state-intersect-scroll` デモはページ毎にオブザーバを再武装してこれを自己修復する。）

## 関連

このデモが依存する fetch の発火／タイミング挙動（auto-fetch の de-dup、`response` はエラーでも発火、センチネルに box が要る）は [docs/timing-and-firing-contract.md](../../docs/timing-and-firing-contract.md) にまとめてあります。
