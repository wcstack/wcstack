# ページネーション — React

共有ページネーションデモの React 19 実装です。200 件のメンバー一覧
（1 ページ 12 件）を、他の 4 つのデモと同じ `/api/items` サーバーから取得します。
データ・見た目・挙動はすべて同一で、違うのはフロントエンドのコードだけです。

この実装では、ヘッドレスな `<wcs-fetch>`（`@wcstack/fetch` のデータノード）を
`@wc-bindable/react` の `useWcBindable` で購読します。`page` から組み立てた `url` を
要素に渡すだけで取得が走り、`useState` が保持するのは `page` だけ。`fetch` も
`AbortController` も自前では書きません — 取得・abort・古いレスポンスの破棄はすべて
要素側にあります。

## 実行方法

```bash
cd packages/fetch/examples/pagination/react
npm install
npm run start          # ビルドして http://localhost:3404 で配信
```

ブラウザで http://localhost:3404 を開きます。`npm run start` だけで完結します。
その `server.js` が同じポートで `/api/items` も配信するため、共有ハブを別途起動する
必要は **ありません**（ハブが必要なのは下の `npm run dev` のときだけです）。

ホットリロード付きの開発時:

```bash
# 1. 共有 API ハブを起動（/api/items を :3400 で配信）
node packages/fetch/examples/pagination/shared/server.js

# 2. 別のターミナルで
cd packages/fetch/examples/pagination/react
npm run dev           # Vite 開発サーバー。/api はハブへプロキシされる
```

## 注目ポイント

- **取得は `<wcs-fetch>` に委譲。** `page` から `url` を組み立てて要素の `url` プロップ
  に渡すと、要素が再取得し、進行中の前リクエストを自動 abort します。古いページの
  遅いレスポンスが新しいページの行を上書きすることはありません（stale レスポンス
  保護は要素側）。React 側に `fetch` も `AbortController` もありません。
- **`useWcBindable` で状態を購読。** アダプタが要素の `value` / `loading` / `error` を
  React state にミラーするので、派生値の算出と描画は通常の React のまま書けます。
- **stale-while-revalidate。** 行が存在する状態で再読み込みすると、行はそのまま
  表示し続けて `<ul>` に `stale` クラスを付けるだけです（初回ロードのスピナーは
  最初のレスポンス前にだけ表示されます）。HTTP / ネットワークエラー時は `<wcs-fetch>`
  が `value` を `null` に戻すため、`totalPages` は `1` にフォールバックし、ページャは
  1 ページに最小化されます（5 デモ共通の復帰状態です）。
- **`useMemo` のページウィンドウ。** `pageWindow(page, totalPages)` がページ一覧を
  先頭 / 末尾 / 現在 ±1 に省略し、間を「…」で詰めます。ページ番号やページ数が
  変わったときだけ再計算されます。

5 つのデモ（React / Vue / `@wcstack/state` / `@wcstack/signals` / Vanilla）はすべて
同じ共有 `/api/items` エンドポイントを叩き、しかも **5 つとも同一の `<wcs-fetch>` ノード**
を、それぞれ異なる結線層（data-wcs / 各アダプタ / signals の `bindNode`）で消費しています。
