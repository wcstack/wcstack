# ページネーション、5つの作り方

[English](./README.md)

同じページネーション付きリスト（**200 件・1 ページ 12 件・サーバー側に遅延あり**）を、**1 つの共通
サーバー**に対して 5 通りに実装しました。データ・生成される DOM・スタイルは 5 つとも完全に同一で、
変わるのはフロントエンドの作り方だけです。**5 つすべてが同一のヘッドレス `<wcs-fetch>` ノード**
を **wc-bindable プロトコル**経由で駆動するので、取得・abort・古いレスポンスの破棄はすべて要素側に
あり、違うのは「各パラダイムがその要素をどう購読するか（結線層）」だけです。各デモは要素の状態マシン
（`page → state → HTTP status`）も表示します。非同期処理を*オーケストレーションする*のではなく、要素が
今どの状態（idle → loading → ready / error）にあるかを*読むだけ*、という点を可視化しています。実際の
ページネーションに必ず必要な次の 3 点を、各パラダイムがどう扱うかを横並びで比較できます。

1. 現在のページを保持する
2. ページが変わったら再取得する
3. **古くなったリクエストを破棄する**（遅れて返ってきた前ページの結果が新しいページを上書きしないように）

| デモ | アプローチ | ビルド |
|------|-----------|--------|
| [`state/`](./state/) | `@wcstack/state` — 宣言的な `<wcs-fetch>` + `data-wcs`、JS のつなぎコードなし | 不要（buildless） |
| [`signals/`](./signals/) | `@wcstack/signals` — `bindNode()` で `<wcs-fetch>` を signals 化、`bindInput` で url 書き戻し | 不要（buildless） |
| [`vanilla/`](./vanilla/) | 手書きの DOM + ヘッドレス `<wcs-fetch>`（`@wc-bindable/core` の `bind()` で購読） | 不要（buildless） |
| [`react/`](./react/) | React 19 — `useState` + `<wcs-fetch>`（`@wc-bindable/react` の `useWcBindable`） | Vite |
| [`vue/`](./vue/) | Vue 3 — Composition API + `<wcs-fetch>`（`@wc-bindable/vue` の `useWcBindable`） | Vite |

## 共通サーバー

[`shared/`](./shared/) に、全デモが叩く唯一のサーバーがあります。

- `data.js` — 決定的に生成した 200 件のメンバー（`id` / `name` / `email` / `role` / `joinedAt`）
- `server.js` — `createPaginationServer()` と、直接実行用の「ハブ」
- `style.css` — 5 デモ共通の唯一のスタイルシート（だから見た目が揃う）

エンドポイント：

```
GET /api/items?page=<1始まり>&limit=12
  -> { items: [...], page, limit, total, totalPages }   （+ 約400ms の遅延）
```

`page` はサーバー側で `[1, totalPages]` にクランプされます。

## 起動方法

**state / signals / vanilla** は buildless で、ハブが配信します（`/` のギャラリーと `/api/items`
も同じハブが提供）。`@wcstack/signals` を含む依存はすべて CDN から読み込むので、事前ビルドは不要です。

```bash
node packages/fetch/examples/pagination/shared/server.js
# http://localhost:3400 を開く
```

**React / Vue** は Vite を使い、各自が自分のポートでビルド・配信します（`/api/items` の契約は共通）。

```bash
cd packages/fetch/examples/pagination/react && npm install && npm run start   # http://localhost:3404
cd packages/fetch/examples/pagination/vue   && npm install && npm run start   # http://localhost:3405
```

フレームワークの dev モード（`npm run dev`）を使う場合はハブも起動してください。Vite の dev サーバー
が `/api` をハブにプロキシします。

## 見どころ

- **state** は機能のほぼ全てを HTML で表現します。`page` が変わると `url` getter が再計算され、
  `<wcs-fetch>` が再取得して前のリクエストを自動 abort、リスト／ページャーは純粋な `data-wcs`
  バインディング — 命令的な fetch コードは一切ありません。
- **signals** は同じ `<wcs-fetch>` を `bindNode()` で signals 化します。要素の `value` / `loading`
  / `error` が read signal になり、`page` から組み立てた `url` を `bindInput` で要素に書き戻すと、
  要素が再取得して前リクエストを自動 abort（switchMap 相当のキャンセル／リスタートは要素側）。
  `resource()` も手書きの `AbortController` も要りません。
- **vanilla** は同じ `<wcs-fetch>` を最小構成で消費します。`@wc-bindable/core` の `bind()` が要素の
  `value` / `loading` / `error` をプレーンな `state` に流し込み、あとは手書きの DOM 更新だけ。
  `AbortController` も loading の状態管理も要素が持つので、書くのは描画だけです。
- **React / Vue** は同じ `<wcs-fetch>` を各フレームワークのアダプタ（`useWcBindable`）で購読します。
  `page` から URL を組み立てて要素に渡すだけで、再取得・abort・stale 対策は要素側が担います。
  `useEffect` / `watch` での `AbortController` 手回しはもう要りません。
