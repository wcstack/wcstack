# Pagination — Vanilla JS

共有ページネーションデモの、フレームワークを使わない実装です。素の ES モジュール、
手書きの `state` オブジェクト、手組みの DOM 更新だけで、ビルドも要りません。ただし
取得はヘッドレスな `<wcs-fetch>`（`@wcstack/fetch` のデータノード）に任せ、その状態を
`@wc-bindable/core` の `bind()` で購読します。`fetch` も `AbortController` も自前では
書きません。他の 4 デモ（React / Vue / `@wcstack/state` / `@wcstack/signals`）と **同じ**
DOM を描画し、**同じ** `/api/items` サーバーを叩く比較の基準です。

## 使用しているもの

- `@wcstack/fetch`（CDN: `esm.run`）
- `@wc-bindable/core`（CDN: `esm.run`）

## 起動手順

このデモは共有ハブから配信されます。デモ個別のサーバーはありません。

```bash
node packages/fetch/examples/pagination/shared/server.js
```

ブラウザで <http://localhost:3400/vanilla/> を開いてください。ハブは
`/api/items`（全デモ共通のページネーションエンドポイント
`GET /api/items?page=<1始まり>&limit=12`、約 400ms の遅延、200 件 / 17 ページ）
も配信します。`@wc-bindable/core` はページ内の import map から
CDN（esm.run）で解決します。

## 注目ポイント

- **取得は `<wcs-fetch>` に委譲** — `fetcher.url` を書き換えると要素が再取得し、
  進行中の前リクエストを自動 abort します。新しいページに切り替わった後に解決した
  古いレスポンスが新しいページを上書きすることはありません。`AbortController` の
  手回しはここにはありません。
- **最小アダプタ `bind()`** — `@wc-bindable/core` の `bind(fetcher, onUpdate)` が要素の
  `value` / `loading` / `error` をプレーンな `state` に流し込み、変化のたびに `render()`
  を呼びます。書くのは描画だけです。
- **stale-while-revalidate** — 行が一度表示されたら、スピナーで置き換えることは
  しません。次ページの読み込み中は `<ul>` に `stale` クラスを付けるだけなので、
  リストが一瞬空になることがありません。これは **`<wcs-fetch>` の契約**に依存して
  います。リロード進行中、要素は前回の `value` を保持し、次のレスポンスが来るまで
  新しい `value` イベントを発火しないため、前ページの行がそのまま残ります。HTTP /
  ネットワークエラー時は `<wcs-fetch>` が `value` を `null` に戻すため、`totalPages` は
  `1` にフォールバックし、ページャは 1 ページに最小化されます（5 デモ共通の復帰状態です）。
- **手組みの DOM** — ノードは `createElement` / `textContent` で生成し
  （`innerHTML` への文字列埋め込みは使わない）、ページネーションの nav に
  付けた 1 つのイベント委譲リスナーが `data-page` を読んでページを切り替えます。
