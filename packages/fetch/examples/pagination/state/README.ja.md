# ページネーション — `@wcstack/state`

宣言的な **`<wcs-fetch>` + `data-wcs` バインディングだけ** で作るメンバー一覧のページネーションです。
`fetch()` の呼び出しも、loading/abort のつなぎコードも、JavaScript の配線も一切ありません。
これは 5 つのデモ（React / Vue / `@wcstack/state` / `@wcstack/signals` / Vanilla）のひとつで、
すべて同じ UI を同じ `/api/items` エンドポイントに対してレンダリングします。違いはアプローチだけです。

## 使用しているもの

- `@wcstack/state`（CDN: `esm.run`）
- `@wcstack/fetch`（CDN: `esm.run`）

## 実行方法

このビルドレスデモは共有のページネーションハブが配信します（デモ個別のサーバーはありません）:

```bash
node packages/fetch/examples/pagination/shared/server.js
```

`http://localhost:3400/state/` を開いてください。

ハブはギャラリー、他のビルドレスデモ、そしてライブの `/api/items` エンドポイントも配信します
（`GET /api/items?page=<1始まり>&limit=12`、約 400ms の遅延、200 件 / 17 ページ）。

## 見どころ

- **JS のつなぎコードがゼロ。** すべての流れが HTML で完結します。算出 getter `itemsFetch.url` が
  `page` から URL を組み立て、1 つの `<wcs-fetch data-wcs="...: itemsFetch">` がリクエストを実行し、
  レスポンスの JSON が `itemsFetch.value` に入ります。この出力は要素が authority で、初回レスポンス前
  とエラー後は `null` になるため、テンプレートから直接は読みません。null 安全な getter
  （`rows` / `total` / `totalPages`）で射影し、リストは `for: rows` にバインドします。
- **古いレスポンスからの自動保護。** ページをクリックすると `page` が変わるだけです。URL getter が
  再計算され、`<wcs-fetch>` が新しい `url` を検知し、**進行中の前のリクエストを自動的に中断** してから
  新しいリクエストを開始します。`AbortController` も「これはまだ現在のページか？」という判定も不要です。
- **宣言的な stale-while-revalidate。** `class.stale: itemsFetch.loading` が再読み込み中の現在の行を
  スピナーに置き換えず薄く表示します。初回ロードのスピナーは、`loading` が true かつ行がまだ無いとき
  （`firstLoading`）だけ表示されます。HTTP / ネットワークエラー時は `<wcs-fetch>` が `value` を `null`
  に戻すため、`totalPages` は `1` にフォールバックし、ページャは 1 ページに最小化されます
  （5 デモ共通の復帰状態です）。
- **述語による相互排他。** `@wcstack/state` には `else` が無いため、3 つのブロック
  （スピナー / エラー / リスト）はそれぞれ独立した `if` で、述語によって相互排他にしています。
  `firstLoading`、`itemsFetch.error`、そして `showList`（= `!firstLoading && !error`）の 3 つです。
  新しいレスポンスは `error` をクリアし、エラーは value をクリアするので、常にこの 3 つのうち
  ちょうど 1 つだけが true になります。React / Vue / Vanilla / signals デモの `if/else-if/else`
  チェーンと同じ挙動です。
- **ページャをデータとして扱う。** `pageTokens` getter がページウィンドウ（先頭・末尾・現在 ±1、間は
  省略記号に畳む）をオブジェクトの配列として返し、`for:` ループが各要素をボタンか省略記号に変換します。
  `onclick` は引数を取れないため、クリックハンドラは `*` ループパス（`this["pageTokens.*"]`）で
  クリックされたトークンを読み取ります。

スプレッド `...: itemsFetch` は `<wcs-fetch>` のすべてのプロパティと入力
（`url` / `value` / `loading` / `error` / `status` / …）を 1 行で `itemsFetch` スロットに配線します。
