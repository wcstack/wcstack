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

スニペットは `<html lang>` を書き、**このページはそれ以外のどこにもロケールを渡して
いない**。辞書モジュールはこの属性を読み、router の basename もここから来て、
`bootstrapState` は `config.locale` の既定をここから採る。だから注文ページに 1 つだけ
置いた `|date` フィルタが、何も教えられずに `/en` で `8/26/2026`、`/ja` で `2026/8/26`
と出る。正本は 1 つ、しかも HTML が元からそのために用意している場所である。

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

## スニペットを持っていく

`index.html` の交渉スニペットが、自分のページに移植する部分である。パッケージに
していないのは意図的で、**module より先に同期で走る**必要があり、カスタム要素では
upgrade が間に合わないため（設計書 D7）。

変えるのは 4 箇所。

| | |
|---|---|
| `SUPPORTED` | 対応ロケールと書字方向の対応（`{ en: "ltr", ar: "rtl" }`） |
| `FALLBACK` | カタログが完全であることを保証するロケール |
| `STORAGE_KEY` | 既存のキーと衝突する場合だけ |
| `<a data-lang>` のリンク | 言語切替 UI。この属性が明示選択の記録に使われる |

制約が 2 つ付いてくる。

- **アプリはオリジンのルートに置かれていること。** スニペットは先頭パスセグメントを
  ロケールとして読む。サブパス配備（`/shop/ja/orders`）にするには、セグメント計算と
  `<base href>` の両方に mount 接頭辞を通す必要がある
- **ページ上の URL をすべて絶対にすること。** ロケールを router に渡しているのが
  `<base href="/ja/">` なので、相対 URL はそれを基準に解決されるようになる

挙動は [`e2e/tests/router-i18n.spec.ts`](../../e2e/tests/router-i18n.spec.ts) が固定して
いる（決定順・URL 修復の 3 形・ハード/ソフトナビゲーションの別）。この spec が共有
サーバーではなくデモ自身のサーバーを立てるのは、上のルート配置の理由による。

## 既知の欠陥

このデモを作る過程で `@wcstack/router` の欠陥が 2 件見つかった。**どちらも i18n 固有
ではなく**、その位置に置いたバインド全般に効く。Phase 3 の課題として記録済み。

- **`<wcs-head>` 内のバインドした `<title>` が空になる。** `<wcs-head>` は子要素を
  `cloneNode(true)` で `document.head` に反映するが、クローンは state がバインドした
  ノードとは別物なのでバインドが届かない。結果ページから**タイトルが消える**ので、
  未翻訳より悪い。したがってこのデモは `<wcs-head>` を置かず、document 自身の静的な
  `<title>` を残している
- **`<wcs-route>` 内のバインドは、そのルートがページ読み込み時に active でない限り
  効かない。** `data-wcs` のバインドは state が構築した時点で document に居たノードに
  しか存在せず、非活性なルートの内容はそのとき切り離されている。走査されないので、
  あとから挿入されてもバインドされない。**行き来しても回復しない。** 注文ページから
  About をクリックすると見出しは空のままになる。`e2e/tests/router-i18n.spec.ts` が
  「失敗するはず」として固定しているので、直れば向こうから知らせてくる

2 件は**同じ原因**（state は起動後に document へ入ったサブツリーをバインドしない）で、
このデモがデータ駆動の描画をすべて router の外に置いているのはそのためである。

修正はパッチではなく設計判断が要るので、当面 router が**そう言う**ようにした。ルート
内容や `<wcs-head>` の子に `data-wcs` があれば、原因と回避策を名指しした警告が出る。
コンソールを開いたまま About に移動すれば見える。修正そのものは
[`docs/binder-protocol-design.md`](../../docs/binder-protocol-design.md) で追う。

## サーバーサイドレンダリング

head スニペットは 1 つの規則の**クライアント側の半分**にすぎない —— **ロケールは、誰かが
読むより前に確定している**。SSR ではサーバーが確定させ、スニペットはそれを覆さない。

サーバーは URL のセグメントから決め、無ければ `Accept-Language` に落ちて、結果を送出する
マークアップに書き込む。

```js
const locale = localeFromPath(url.pathname) ?? negotiate(req.headers["accept-language"]);
const page = `<!DOCTYPE html>
<html lang="${locale}">…`;
```

下流はすべて既に `<html lang>` を読んでいる（辞書モジュール・router の basename・
`config.locale`）ので、他に変えるところは無い。クライアントのスニペットは URL に対応
ロケールを見つけるので、そのまま手を出さない。

**間違えると目に見える。** クライアントがサーバーと違うロケールに落ち着くと、ハイドレーション
直後にページ全体の言語が入れ替わる —— ちらつきに加えて、既に正しかったマークアップの
全再描画である。URL セグメントがあるときにサーバーから見えないもの（`navigator.languages`・
`localStorage`）でロケールを決めてはならないのはこのためである。

このデモはクライアント専用で、サーバーレンダリングとハイドレーションそのものは
[`examples/ssr`](../ssr/) が扱う。意図的に分けている —— SSR デモにはロケール依存の要素が
無いので、交渉を配線しても何も実証しないコードが増えるだけになる。

## 作業ツリーに対して検証する

既定では公開済みの CDN バンドルを読み込む。ローカルビルドに対して動かすには:

```bash
(cd packages/state && npm run build)
(cd packages/router && npm run build)
WCS_LOCAL=1 node examples/router-i18n/server.js
```

`WCS_LOCAL=1` は `esm.run` の一行を `/packages/<pkg>/dist/…` に書き換えてリポジトリ
から配る。`e2e/serve.mjs` と同じ手口である。

> このデモは `@wcstack/state` の **1.31.0 より後**を必要とする。変更は 2 つ。
> `<wcs-state src="/app.js">` が state パッケージ自身の場所を基準に URL を解決して
> いた（CDN から読み込んだページでは CDN 側を取りに行って 404）点と、
> `config.locale` の既定が `<html lang>` でなかった（`auto` の一行で読み込んだ
> ページにはロケールを設定する口が無かった）点である。両方が公開されるまでは
> `WCS_LOCAL=1` を使うこと。

このデモをリポジトリの外にコピーするときは `examples/shared/` も一緒に持っていく。
