# router + state + fetch デモ（SPA 商品カタログ）

`@wcstack/router`・`@wcstack/state`・`@wcstack/fetch` を組み合わせた小さな
シングルページアプリです。商品一覧、商品ごとの詳細ページ、静的な About ページ、
404 ページを、本物の URL・ディープリンク・ブラウザ履歴つきで実装しています。

このデモの主題は **「URL もただのリアクティブな状態である」** こと。
`<wcs-router>` は wc-bindable プロトコルを話すので、router⇄state の橋渡しは
`data-wcs` 1 行で完結します:

```html
<wcs-router data-wcs="path: path; typedParams: routeParams; searchParams: query;
                      routeName: routeName; navigateUrl: navigateUrl; replaceUrl: replaceUrl">
```

- `typedParams` / `searchParams` / `routeName` / `path` — router → state。
  ナビゲーションのたびに router の**解析済み**結果が state へ流れます:
  `:productId(int)` の値は number として、クエリはプレーンな Record として、
  マッチしたルートは name で届きます。state がパス文字列を解釈することは
  ありません — このデモに正規表現は 1 つもありません。
- `navigateUrl` / `replaceUrl` — state → router。state のメソッドがターゲットを
  代入すると（`this.navigateUrl = "/products/3"`、
  `this.replaceUrl = "?category=audio"`）router が遷移します（push / replace）。
  遷移完了時にプロパティは自動で `null` に戻ります。

## はじめかた

パッケージは CDN（[esm.run](https://esm.run)）から読み込むため、ローカルビルドは
不要です。Node.js だけで動きます。

```bash
node examples/router-spa/server.js
```

ブラウザで http://localhost:3000 を開いてください。ディープリンクも動きます:
http://localhost:3000/products/3 、 http://localhost:3000/about 。

## 機能

- **型付きパラメータの宣言的ルート**: `/products/:productId(int)` は整数にしか
  マッチしません — `/products/abc` は `<wcs-route fallback>`（404 ページ）に
  落ち、`/products/999` はルートにはマッチするが API が 404 を返します。
  2 種類の「not found」を、それぞれ適切なレイヤーが処理します。
- **ページごとの `<title>`**: 各ルートが `<wcs-head>` を持ち、ナビゲーションで
  ドキュメントタイトルが切り替わります。
- **アクティブなナビリンク**: `<wcs-link>` は `<a>` を描画し、現在地に応じて
  `active` クラスを付け外しします。
- **ナビゲーションが fetch を駆動**: 詳細ページの `<wcs-fetch>` の url は
  `routeParams` から導出される state getter — 「遷移すること」がそのまま fetch
  のトリガーです。
- **クエリ文字列も状態**: カテゴリ絞り込みは URL に住みます
  （`/?category=audio`）。読みは `searchParams`、書きは `replaceUrl` 経由なので
  絞り込みで履歴は増えません — そしてクエリのみ遷移は *same-match* として扱われ、
  router はガードを再実行せず、再スタンプもせず、フォーカスもスクロールも
  動かしません。ディープリンクと戻る/進むで絞り込みは自然に復元されます。
- **再訪は即表示**: 同じ商品を開き直しても再フェッチしません（url の同値
  ガード）。キャッシュ済みの値が即座に描画されます。

## データフロー

```
アドレスバー / <wcs-link> / 履歴          this.navigateUrl = "/products/3"
                 │                        this.replaceUrl  = "?category=audio"
                 ▼                                        ▲
            <wcs-router> ──typedParams──▶ state.routeParams   （openProduct /
                 ▲       ──searchParams─▶ state.query          selectCategory）
                 │       ──routeName────▶ state.routeName
       navigateUrl / replaceUrl               │
                 └────────────────  getter が解析済み結果を消費:
                                    productId / isList / category /
                                    products（絞り込み済み）/ "productFetch.url"
                                       │
                                       ▼
                        <wcs-fetch>  （url 変化で自動フェッチ）
                                       │  value / loading / error / status
                                       ▼
                        state.productFetch.*  ──▶  詳細ページ（if: ブロック）
```

## 役割分担（ページ DOM が state テンプレート側にある理由）

- **router が持つもの**: URL・履歴・ページごとの `<title>`・完全に静的な
  ページ。About と 404 の内容は `<wcs-route>` の中に静的に書かれ、マッチ時に
  `<wcs-outlet>` へスタンプされます。
- **state が持つもの**: データバインドされたページすべて。一覧と詳細の DOM は
  常にドキュメント内にある `<template data-wcs="if: ...">` ブロックです。

この分担は意図的なものです。`@wcstack/state` はバインド時点で DOM にある
`data-wcs` を収集し、router が後からスタンプするノードは監視しません。
そのため router が出し入れするコンテンツは静的（`data-wcs` なし）に、
データバインドされるコンテンツは state 管理の構造テンプレート配下に置きます。
それぞれが得意なことをやり、結合は `<wcs-router>` 上の wc-bindable
バインディングだけです。

## 押さえどころ

- **ディープリンクには `<base href="/">` が必須。** ないと router は
  `document.baseURI` から basename を導出するため、`/products/3` を直接
  ロードするとそのパス自体が basename になり、すべてのディープリンクが
  アプリルートに解決されてしまいます（router README の「basename 解決順序」
  参照）。
- **サーバーには SPA フォールバックが必要**: `server.js` は拡張子なし・
  非 API の GET（`/products/3` や `/about`）すべてに `index.html` を返し、
  リロードや直リンクをクライアント側ルーターに届けます。
- **初期ロードにシードは不要**: 観測メンバ（`typedParams` / `searchParams` /
  `routeName` / `path`）は output-only な `wcBindable` メンバなので router が
  authority となり、state はバインディング確立時に router の現在値を読み取り、
  以降の変化は `*-changed` イベントで受けます。router が最初のルート解決を
  バインディング確立より先に終えていても、その値は「待つ」のではなく「読む」ため
  取りこぼしがなく、ディープリンクも正しく描画されます。state から書き戻すことは
  ないので、抑止すべきエコー自体も存在しません。
- **`navigateUrl` / `replaceUrl` は output と input の両方として宣言**されており、
  これが `this.navigateUrl = "/products/3"` で遷移できる理由です。`properties` に
  だけ宣言されたメンバは output-only となり、state からは書き込まれません。
- **`navigateUrl` / `replaceUrl` は自己リセット**: 遷移完了時に router が `null` に
  戻す（`*-url-changed` を発火する）ので、後で同じターゲットを代入しても再度
  遷移します。
- **`/path` ターゲットは現在のクエリを引き継ぎません**: ページをまたいで
  絞り込みを保つのは明示的な選択 — `openProduct()` / `goToProducts()` は
  `searchParams` から組み立てたサフィックス（`get categorySuffix()`）を
  付け足しています。
- **ページ外の fetch は沈黙**: `get "productFetch.url"()` は詳細ページ以外で
  `undefined` を返し、`undefined` は要素に書き込まれない（write-skip
  セマンティクス）ため、`<wcs-fetch>` は直前の url を保持したまま何もしません。
- **stale 表示なし**: `detailReady` は `value.id === productId` を要求する
  ので、商品 A から商品 B への遷移中はスピナーが出て、B の URL の下に A の
  データが見えることはありません。
