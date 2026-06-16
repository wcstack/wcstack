# signals + &lt;wcs-fetch&gt; デモ

実験的パッケージ **`@wcstack/signals`** のデモ。ビルドレスで signals ベースの反応性
コア（TC39 Signals 形・ランタイム依存ゼロ）が、fine-grained な `h()` で実 DOM を駆動し、
さらに実在の `<wcs-fetch>` IO ノードを wc-bindable アダプタ経由で消費します。

## はじめに

`@wcstack/signals` は未公開なので、先にローカルでビルドしてからサーバを起動します。
`@wcstack/fetch` は CDN（[esm.run](https://esm.run)）から読み込みます。

```bash
# 1. signals バンドルをビルド（初回のみ）
cd packages/signals && npm install && npm run build && cd -

# 2. デモを起動
node examples/signals-live-search/server.js
```

ブラウザで http://localhost:3000 を開きます。サーバはローカルビルドした
`packages/signals/dist/dom.esm.js` を `/signals/dom.esm.js` で配信し、import map で解決します。

## 見どころ

- **カウンター** — `SignalsElement` を継承した `<signal-counter>` カスタム要素。IO なしの純粋
  signals。`connectedCallback` が `render()` をオーナーシップ root 配下に mount し、
  `disconnectedCallback` で全 effect を dispose。`×2` ラベルは `computed` なので、二倍の
  **値**が変わったときだけ再描画されます（値等価の伝播短絡）。
- **ライブ人名検索** — `query` signal が実 `<wcs-fetch>` の `url` を設定し、要素が自動 fetch、
  アダプタがそのイベントを signal に畳み戻し、`h` がリストを描画。高速入力時は進行中の
  リクエストが abort されます（FetchCore が古いリクエストをキャンセル）。

## ポイント

- **アダプタ1枚で任意の IO ノード。** `bindNode(fetchEl)` は要素の `wcBindable` 記述子
  （`fetchEl.constructor.wcBindable`）を読み、出力プロパティ（`value` / `loading` / `error` /
  `status`）を読み取り専用 signal にします。`<wcs-fetch>` は背後に signal コアがいることを
  **一切知りません**。これが要点＝「IO はノード、反応性はコア」。
- **fine-grained な `h`、VDOM なし。** `h(tag, props, ...children)` は real DOM を一度生成し、
  関数/signal で渡した prop・child だけを effect に紐付けて更新。reconciler は出荷しません。
- **JSX 形だが JSX は出荷しない。** `h` は classic JSX factory（利用者が自分の tsconfig で
  `jsxFactory: "h"` を指定すれば JSX を乗せられる）ですが、本デモはビルドレスで `h` を直接呼びます。
- **オーナーシップ → ライフサイクル。** `createRoot` が `render()` 中に作られた全 effect を集約し、
  カスタム要素が disconnect 時にその root を dispose。effect はリークしません。
- **両エントリで単一コアを共有。** ページはヘッドレスなコアを `@wcstack/signals` から、DOM 層を
  `@wcstack/signals/dom` から import します（import map とモジュールスクリプトを参照）。本番パッケージング
  （Rollup の code-splitting）は両エントリが import する単一の共有チャンク `core-*.esm.js` を出力するため、
  両エントリを混ぜても反応性インスタンスは**一つ**だけ読み込まれます。（Pre-Phase-1 では各エントリが
  コアを自前にインライン化し、モジュールグローバルが二重化して継ぎ目で反応性が壊れていましたが、現在は解消済みです。）

> 設計は `docs/signals-state-design.md`、実装とテストは `packages/signals` を参照してください。
