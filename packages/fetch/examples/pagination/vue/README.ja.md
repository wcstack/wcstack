# ページネーション — Vue

共通ページネーションデモの **Vue 3** 実装です。Composition API（`ref` + `computed`）
で組み立て、ヘッドレスな `<wcs-fetch>`（`@wcstack/fetch` のデータノード）を
`@wc-bindable/vue` の `useWcBindable` で購読します。`page` から組み立てた `url` を
`:url` で要素に渡すだけで取得が走り、`fetch` も `AbortController` も自前では書きません
— 取得・abort・古いレスポンスの破棄はすべて要素側にあります。データも見た目も挙動も
他の 4 デモと同一で、違うのはフロントエンドのコードだけです。

> `<wcs-fetch>` をネイティブのカスタム要素として扱うため、`vite.config.js` で
> `compilerOptions.isCustomElement`（`wcs-` 始まりのタグ）を設定しています。

## 実行方法

```bash
cd packages/fetch/examples/pagination/vue
npm install
npm run start          # ビルドして dist を http://localhost:3405 で配信
```

ブラウザで <http://localhost:3405> を開きます。`npm run start` だけで完結します。
その `server.js` が同じポートで `/api/items` も配信するため、共有ハブを別途起動する
必要は **ありません**（ハブが必要なのは下の `npm run dev` のときだけです）。

開発時にライブデータを使う場合は、`/api/items` を提供する共有ハブを起動してから
Vite を起動します。dev サーバーは `/api` をハブにプロキシします:

```bash
# ターミナル 1 — 共有 API ハブ (:3400)
node packages/fetch/examples/pagination/shared/server.js
# ターミナル 2 — Vite dev サーバー
cd packages/fetch/examples/pagination/vue && npm run dev
```

他の 4 つのデモと同じ共有エンドポイント
`GET /api/items?page=<n>&limit=12` にアクセスします。

## このアプローチの見どころ

- **取得は `<wcs-fetch>` に委譲** — `page` から `url` を `computed` で組み立てて
  `:url` で要素に渡すだけ。要素が再取得し、進行中の前リクエストを自動 abort する
  ので、古いレスポンスが新しいページを上書きすることはありません。`load()` も
  `AbortController` も要りません。
- **`useWcBindable` で状態を購読** — アダプタが要素の `value` / `loading` / `error`
  をリアクティブな `values` にミラーするので、派生値は通常どおり `computed` で
  書けます。
- **stale-while-revalidate** — 行が一度表示されたら、リロード中もスピナーで
  ちらつかせず、`stale` クラスで薄く表示したまま維持します。スピナーは初回ロード時
  のみ表示されます。HTTP / ネットワークエラー時は `<wcs-fetch>` が `value` を `null`
  に戻すため、`totalPages` は `1` にフォールバックし、ページャは 1 ページに最小化
  されます（5 デモ共通の復帰状態です）。
- **派生値はすべて `computed`** — ページウィンドウのトークン・範囲テキスト・
  ページラベルはすべて `computed` で、テンプレートは宣言的なまま保てます。
