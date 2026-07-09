# router + state + fetch デモ（SPA 商品カタログ）

`@wcstack/router`・`@wcstack/state`・`@wcstack/fetch` を組み合わせた小さな
シングルページアプリです。商品一覧、商品ごとの詳細ページ、静的な About ページ、
404 ページを、本物の URL・ディープリンク・ブラウザ履歴つきで実装しています。

このデモの主題は **「URL もただのリアクティブな状態である」** こと。
`<wcs-router>` は wc-bindable プロトコルを話すので、router⇄state の橋渡しは
バインディング 2 本だけで完結します:

```html
<wcs-router data-wcs="path: path; navigateUrl: navigateUrl">
```

- `path` — router → state。ナビゲーションのたびに `state.path` が更新され、
  getter がそこから現在のページと fetch の URL を導出します。
- `navigateUrl` — state → router。state のメソッドがパスを代入すると
  （`this.navigateUrl = "/products/3"`）router が遷移します。遷移完了時に
  プロパティは自動で `null` に戻ります。

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
  `path` から導出される state getter — 「遷移すること」がそのまま fetch の
  トリガーです。
- **再訪は即表示**: 同じ商品を開き直しても再フェッチしません（url の同値
  ガード）。キャッシュ済みの値が即座に描画されます。

## データフロー

```
アドレスバー / <wcs-link> / 履歴            this.navigateUrl = "/products/3"
                 │                                        ▲
                 ▼                                        │ openProduct()
            <wcs-router> ──path──▶ state.path             │
                 ▲                     │        （一覧の行クリック）
                 │                     ▼
            navigateUrl      getter が path から導出:
                 └─────────  isList / isDetail / "productFetch.url"
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
それぞれが得意なことをやり、結合は `path` バインディングだけです。

## 押さえどころ

- **ディープリンクには `<base href="/">` が必須。** ないと router は
  `document.baseURI` から basename を導出するため、`/products/3` を直接
  ロードするとそのパス自体が basename になり、すべてのディープリンクが
  アプリルートに解決されてしまいます（router README の「basename 解決順序」
  参照）。
- **サーバーには SPA フォールバックが必要**: `server.js` は拡張子なし・
  非 API の GET（`/products/3` や `/about`）すべてに `index.html` を返し、
  リロードや直リンクをクライアント側ルーターに届けます。
- **state 側の `path: location.pathname` シード**が初期ロードをカバーします:
  router の最初の `path-changed` イベントより前でも初回描画が正しくなります。
  router の `path` setter と state の同値ガードがどちらも無変化のエコーを
  抑止するため、双方向バインディングがループすることはありません。
- **`navigateUrl` は自己リセット**: 遷移完了時に router が `null` に戻す
  （`navigate-url-changed` を発火する）ので、後で同じパスを代入しても再度
  遷移します。
- **ページ外の fetch は沈黙**: `get "productFetch.url"()` は詳細ページ以外で
  `undefined` を返し、`undefined` は要素に書き込まれない（write-skip
  セマンティクス）ため、`<wcs-fetch>` は直前の url を保持したまま何もしません。
- **stale 表示なし**: `detailReady` は `value.id === productId` を要求する
  ので、商品 A から商品 B への遷移中はスピナーが出て、B の URL の下に A の
  データが見えることはありません。
