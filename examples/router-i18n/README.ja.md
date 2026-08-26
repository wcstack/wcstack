# router-i18n — ライブ切替を持たない多言語ページ

**English**: [README.md](./README.md)

```bash
node examples/router-i18n/server.js       # http://localhost:3000
```

`/` を開くとブラウザの言語に応じて `/en` か `/ja` に着地する。右上のボタンで
言語を切り替えられ、`/ja/about` のようなディープリンクも動く。`/xx/about` は
`/en/about` に修復される。

このデモは [docs/i18n-design.ja.md](../../docs/i18n-design.md) の参照実装で、
**ライブラリコードを 1 行も足していない**。既存の `@wcstack/state` と
`@wcstack/router` を設計どおりに使っているだけである。

## すべてはこの 1 つの決定から出てくる

**ロケールは起動時に確定する。言語切替は再描画ではなくナビゲーションである。**

これで辞書は**不変**になり、不変な値はリアクティブな state に置く理由がない。
したがって辞書の正本は **ES モジュール**になり、

- パスゲッターはただの `import` で読める（クロス state 読み取りもスコープ遡上も不要）
- shadow root の中のコンポーネントも同じ実体を import する。モジュールスコープは
  DOM スコープと無関係だから
- `Intl` のフォーマッタはモジュールスコープで 1 度だけ作れる
- fallback は**ロード時に**マージする。キーごとに辿らない

`<wcs-state name="i18n">` は、テンプレートから辞書へパスで届くためだけに存在する
（`t.app.title@i18n`）。射影であって、辞書の第二の住所ではない。

## ファイル

| ファイル | 役割 |
|---|---|
| `index.html` | head スニペット（交渉・`lang`/`dir`・`<base>`・redirect）とページ |
| `i18n/catalog.js` | **辞書の正本**。`<html lang>` を読み、1 言語を import し、fallback を deep merge して deep freeze |
| `i18n/en.js`, `i18n/ja.js` | メッセージ本体。ネストした素のオブジェクト |
| `i18n/format.js` | 実効ロケールの `Intl.*` インスタンス |
| `i18n/state.js` | 3 行。`<wcs-state src>` 用の射影 |
| `app.js` | アプリの state。行ラベルと複数形のために辞書を直接 import する |

## このデモが示す 5 つのこと

### 1. 誰かが誤って読む前にロケールが確定している

交渉スニペットは**同期**の `<script>` で、`<head>` の先頭に置く。module script は
defer されるので `catalog.js` が先に走ることは構造的にありえない。これが競合では
なく構造であることが要点で、**だからこそカスタム要素にしない** — タグでは upgrade
が遅すぎる。

決定順は URL > 明示選択（`localStorage`）> `navigator.languages` > fallback。
URL を最優先にするのは、共有されたリンクで言語が変わらないようにするため。

### 2. 言語切替は*ハード*ナビゲーションでなければならず、それを保証するのが basename

`<wcs-router>` は **basename 配下の**同一オリジンナビゲーションをすべて
`intercept()` に渡す。素の `<a>` クリックも含めてである。basename の内側にある
言語リンクはクライアント側で処理されてしまい、リロードも辞書モジュールの再評価も
起きない ＝ **言語が変わらないのに、どこも壊れて見えない**。

そこでロケールは `/:lang` ルートパラメータではなく router の **basename** に置く。
basename が `/ja` のページから `/en/` へのリンクは basename の外なので intercept
されず、ブラウザが本物のナビゲーションを行う。切替は basename の**おかげで**動く。

basename は head スニペットが `<base href="/ja/">` を書いて渡す。最も早い時点で、
かつ HTML 標準の手段である。制約は 1 つ、ページ上の URL をすべて絶対にすること。

副産物として、ルートパターンからロケールが消え（`/`・`/about`）、アプリ内リンクも
ロケールを持たない（`<wcs-link to="/about">`）。

### 3. 動的キーは行ゲッターの仕事

`t[order.status]` はバインドパスにできない。パスは正規化キーであり添字を持たない
からである。行ゲッターが引き、テンプレートは結果をバインドする。

```js
get "orders.*.statusLabel"() {
  return t.orders.status[this["orders.*.status"]];
}
```

通貨と日付も同様に、`|filter` ではなくゲッター内の `Intl` で行う。

### 4. 辞書が素のデータだから訳漏れが報告される

注文ページには、どのカタログにも無い `t.orders.subtotal` をわざとバインドしてある。
コンソールにはこう出る。

```
[wcs/binding-path-missing] Bound path "t.orders.subtotal" does not resolve on
state "i18n": "subtotal" is not declared. … npx @wcstack/lint <file>
```

これはカタログが**素のデータ**だから動く。パス存在検査は getter に当たった時点で
`unknown` として打ち切るので、辞書に便利ゲッターを 1 つ足すだけでその枝の検査が
黙って死ぬ。deep freeze しているのはこれが 2 つ目の理由である。

`about.fallbackNote` は裏側を示す。`en.js` にしか無いので、`/ja` では消えるのでは
なく英語で出る。

### 5. 構造レンダリングは router の外に置く

`<wcs-route>` の中に置いた `<template data-wcs="for: …">` は**描画されない**。state
がバインドを組み立てる時点でルートのノードは inert な `<template>` の中にあり、
内側の構造フラグメントが登録されないためである。ルート内の素のバインドは**動く**
（About ページはその場で翻訳されている）ので、この境界は踏み抜きやすい。

そこで router は `path` を publish し、state はその外側の
`<template data-wcs="if: isList">` からリストを描画する。
[router-spa](../router-spa/) と同じ分担である。

## 作業ツリーに対して検証する

既定では公開済みの CDN バンドルを読み込む。ローカルビルドに対して動かすには:

```bash
(cd packages/state && npm run build)
(cd packages/router && npm run build)
WCS_LOCAL=1 node examples/router-i18n/server.js
```

`WCS_LOCAL=1` は `esm.run` の一行を `/packages/<pkg>/dist/…` に書き換えてリポジトリ
から配る。`e2e/serve.mjs` と同じ手口である。

> このデモは `@wcstack/state` の **1.31.0 より後**を必要とする。それ以前は
> `<wcs-state src="/app.js">` が state パッケージ自身の場所を基準に URL を解決して
> いたため、CDN から読み込んだページでは CDN 側を取りに行って 404 になった。
> 修正が公開されるまでは `WCS_LOCAL=1` を使うこと。

このデモをリポジトリの外にコピーするときは `examples/shared/` も一緒に持っていく。
