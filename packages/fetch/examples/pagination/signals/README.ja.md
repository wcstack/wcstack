# ページネーション — `@wcstack/signals`

同じページネーション付きメンバー一覧を 5 つの実装で並べて比較するデモのひとつです
（React / Vue / `@wcstack/state` / `@wcstack/signals` / Vanilla JS）。5 つとも同一の
DOM を描画し、同じスタイルシートを共有し、同じ `/api/items` エンドポイントを叩きます。
違うのはフロントエンドのコードだけです。

このバージョンは **`@wcstack/signals`**（ビルドレスなきめ細かいリアクティブコア）を
使います。VDOM も DSL もありません。`signal()` / `computed()` を直接呼び、`h()` / `For()`
で実 DOM を組み立てます。取得そのものは、他の 4 デモと同じヘッドレスな `<wcs-fetch>`
（`@wcstack/fetch` のデータノード）に任せ、`bindNode()` でその要素を signals 化します。

## 実行方法

このデモは完全に buildless です。依存はすべて CDN から読み込むので、事前ビルドは要りません。
共有の**ハブ**がページと `/api/items` エンドポイントを配信します。

```bash
node packages/fetch/examples/pagination/shared/server.js
```

ブラウザで <http://localhost:3400/signals/> を開きます。

import map で signals の 2 つのエントリと `@wcstack/fetch/auto`（`<wcs-fetch>` を登録）を
すべて CDN に割り当てています。

```html
<script type="importmap">
{
  "imports": {
    "@wcstack/signals": "https://esm.run/@wcstack/signals",
    "@wcstack/signals/dom": "https://esm.run/@wcstack/signals/dom",
    "@wcstack/fetch/auto": "https://esm.run/@wcstack/fetch/auto"
  }
}
</script>
```

このデモは DOM レイヤー（`@wcstack/signals/dom`）からすべてを import します。DOM レイヤーは
ヘッドレスコア（`signal` / `computed` / `bindNode` / …）を DOM ヘルパー（`h` / `render` /
`For`）と一緒に再 export しているので、この `/dom` 1 つの import で足ります（CDN 上の
自己完結バンドル 1 つ＝リアクティブインスタンス 1 つ）。`@wcstack/signals` エントリはコアだけを
直接 import したいとき用に割り当てを残しています。CDN では各エントリが独立したバンドルなので、
1 ページからは 1 エントリだけを import してください。

## 注目ポイント

- **`bindNode()` で `<wcs-fetch>` を signals 化。** `bindNode(fetcher)` は要素の wc-bindable
  記述子を読み取り、出力プロパティ（`value` / `loading` / `error`）を read signal として
  公開します。`computed()` でその上に派生値を組めます。
- **`bindInput()` で url を書き戻し → switchMap キャンセル。** `page` から組み立てた `url`
  シグナルを `bound.bindInput("url", url)` で要素に書き戻すと、`page` が変わるたびに要素が
  再取得し、進行中の前リクエストを自動 abort します（switchMap 相当のキャンセル／リスタートは
  要素側）。`resource()` も手書きの `AbortController` も要りません。
- **`h()` によるきめ細かい DOM。** `h(tag, props, ...children)` は実 DOM を一度だけ生成
  します。関数で渡した子やプロパティ（`() => rangeText.get()`、`class: () => …`、
  `disabled: () => …`）は対象を絞った effect に紐づき、依存シグナルが変わったときに
  その 1 箇所だけが更新されます。
- **`For()` によるキー付きリスト。** `<ul>` は `For(() => items.get(), …, { key: m => m.id })`
  を使い、行を再生成せず id でキーイングして in-place に差分更新します。リストは
  **一度だけ**生成してリロードをまたいでマウントし続けるため、ページ変更時も行の状態が
  保持されます。
- **Stale-while-revalidate。** 行が既にある状態でのリロードでは、行を画面に残したまま
  `<ul>` に `stale` クラスを付けるだけです
  （`class: () => loading ? "member-list stale" : "member-list"`）。リストは行が
  存在してから初めてマウントされるので `loading` だけで十分です。
  初回ロード用のスピナーは最初のレスポンスが来る前だけ表示されます。HTTP /
  ネットワークエラー時は `<wcs-fetch>` が `value` を `null` に戻すため、`totalPages` は
  `1` にフォールバックし、ページャは 1 ページに最小化されます（5 デモ共通の復帰状態です）。

データはすべて共有の `/api/items?page=<n>&limit=12` サーバ（約 400ms のレイテンシ、
200 件、17 ページ）から取得します。これは他の 4 つのデモと同じエンドポイントです。
