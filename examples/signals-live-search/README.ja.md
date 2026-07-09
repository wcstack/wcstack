# signals + &lt;wcs-fetch&gt; デモ

**`@wcstack/signals`** パッケージのデモ。ビルドレスで signals ベースの反応性
コア（TC39 Signals 形・ランタイム依存ゼロ）が、fine-grained な `h()` で実 DOM を駆動し、
さらに実在の `<wcs-fetch>` IO ノードを wc-bindable アダプタ経由で消費します。

## はじめに

完全ビルドレス: `@wcstack/signals` も `@wcstack/fetch` も CDN
（[esm.run](https://esm.run)）から読み込みます。

```bash
node examples/signals-live-search/server.js
```

ブラウザで http://localhost:3000 を開きます。

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
- **CDN ではページごとに 1 エントリ。** ページはヘッドレスなコアも DOM 層も、すべて単一の
  `@wcstack/signals/dom` エントリから import します（このエントリはコア全体を再エクスポート）。
  CDN では各エントリがコアを内蔵した自己完結バンドルになるため、`@wcstack/signals` と
  `@wcstack/signals/dom` を 1 ページで混在 import すると反応性インスタンスが二重化し、
  継ぎ目で反応性が壊れます。（ローカルの npm インストールにはこの制約はありません:
  Rollup の code-splitting により両エントリは共有チャンク `core-*.esm.js` を 1 つだけ読み込みます。）

> 設計は `docs/signals-state-design.md`、実装とテストは `packages/signals` を参照してください。
