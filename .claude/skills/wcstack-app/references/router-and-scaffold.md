# wcstack router / autoloader / アプリ雛形 リファレンス

出典: `packages/router/README.ja.md`・`packages/autoloader/README.ja.md`・ルート `README.md`・`examples/README.ja.md`・`examples/router-spa/`（index.html / server.js / README.ja.md）・`packages/router/src/`。すべて実ファイル確認済み。

## 1. SPA の最小雛形

### CDN 読み込み（1 パッケージ 1 行、`/auto` エントリ）

```html
<script type="module" src="https://esm.run/@wcstack/fetch/auto"></script>
<script type="module" src="https://esm.run/@wcstack/router/auto"></script>
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
```

`/auto` は登録のみ行うゼロコンフィグ・ブートストラップ。I/O ノード系を state より先に並べるのがベストプラクティス（state は whenDefined で保留するため必須要件ではない）。

### ルーターの基本構造

**`<wcs-router>` の直下に `<template>` が必須**。その中に `<wcs-route>` を並べる。表示先は `<wcs-outlet>`（HTML に書かなければ router が自動生成）。

```html
<wcs-router>
  <template>
    <wcs-route path="/">
      <wcs-head><title>Home</title></wcs-head>
      <app-home></app-home>
    </wcs-route>
    <wcs-route path="/about">
      <about-page></about-page>
    </wcs-route>
    <wcs-route fallback>
      <error-404></error-404>
    </wcs-route>
  </template>
</wcs-router>
<wcs-outlet></wcs-outlet>
```

- コンポーネント表示 = **`<wcs-route>` の子要素として直接書く**。マッチ時に子要素が `<wcs-outlet>` へスタンプされる。
- 静的 HTML（`data-wcs` なし）をルート内に直接書いてもよい。

### `<wcs-route>` 属性一覧

| 属性 | 説明 |
|------|------|
| `path` | トップレベルは `/` 始まりの絶対パス、ネスト時は相対パス。パラメータは `:名前`。キャッチオールは `*`。トップレベルに相対パスは不可 |
| `index` | 上位のパスを引き継ぐ（親パスそのものにマッチ） |
| `fallback` | どのルートにもマッチしない場合に表示 |
| `fullpath` | 上位を含むフルパス（読み取り専用） |
| `name` | 識別用 |
| `guard` | ガード有効化。値はガードキャンセル時のリダイレクト先絶対パス |

プロパティ: `params`（文字列パラメータ）/ `typedParams`（型変換済み）/ `guardHandler`。

### マッチング優先順位

1. セグメント数が多い方 → 2. 静的セグメントが多い方（`"users"` > `":id"` > `"*"`）→ 3. 定義順。`/products` と `/products/` は同一扱い。

## 2. 型付きパスパラメータ

構文: `:パラメータ名(型名)`

```html
<wcs-route path="/users/:userId(int)"><user-detail data-bind="props"></user-detail></wcs-route>
<wcs-route path="/posts/:date(isoDate)/:slug(slug)"><post-detail data-bind="props"></post-detail></wcs-route>
```

| 型名 | 説明 | 変換後の型 |
|------|------|------|
| `int` | 整数 | `number` |
| `float` | 浮動小数点数 | `number` |
| `bool` | `true`/`false`/`0`/`1` | `boolean` |
| `uuid` | UUID v1-5 | `string` |
| `slug` | 小文字英数字とハイフン | `string` |
| `isoDate` | ISO 8601 日付 | `Date` |
| `any` | 任意文字列（デフォルト） | `string` |

型不一致の値は**そのルートにマッチしない**（エラーにならず他ルートや fallback に落ちる）。未知の型名は `any` にフォールバック。

### パラメータの受け取り方

**(a) JS から**: `route.params.userId`（文字列）/ `route.typedParams.userId`（型変換済み）。

**(b) `data-bind` 自動バインディング** — ルート内の要素にパラメータを自動注入:

| `data-bind` の値 | 動作 |
|------|------|
| `"props"` | `element.props` にマージ |
| `"states"` | `element.states` にマージ |
| `"attr"` | `setAttribute()` で設定 |
| `""`（空文字） | 直接プロパティ（`element.userId = value`） |

パラメータは `connectedCallback` 発火前に割り当て。未定義カスタム要素は `customElements.whenDefined()` 解決後に遅延割り当て（autoloader と共存可能）。

**(c) state から（wc-bindable 経由）** — `<wcs-router>` の `path` 出力から getter で導出（§5・§7 参照）。

## 3. ネストレイアウトと `<wcs-head>`

### `<wcs-layout>`

テンプレートを読み込み、子要素を `<slot>` に挿入して `<wcs-layout-outlet>` へ書き出す。

| 属性 | 説明 |
|------|------|
| `layout` | テンプレートとなる `<template>` の id |
| `src` | 外部ファイルテンプレートの URL |
| `name` | 識別名 |
| `enable-shadow-root` / `disable-shadow-root` | outlet の Shadow/Light DOM 切替 |

### ルート×レイアウト混在の実例

```html
<wcs-router>
  <template>
    <wcs-route path="/">
      <wcs-layout layout="main-layout">
        <main-header slot="header"></main-header>
        <main-body>
          <wcs-route index>
            <wcs-head><title>Main Page</title></wcs-head>
            <main-dashboard></main-dashboard>
          </wcs-route>
          <wcs-route path="products">          <!-- ネストは相対パス -->
            <wcs-route index><product-list></product-list></wcs-route>
            <wcs-route path=":productId"><product-item data-bind="props"></product-item></wcs-route>
          </wcs-route>
        </main-body>
      </wcs-layout>
    </wcs-route>
    <wcs-route fallback><error-404></error-404></wcs-route>
  </template>
</wcs-router>
<wcs-outlet></wcs-outlet>

<template id="main-layout">
  <section><h1> Main </h1><slot name="header"></slot></section>
  <section><slot></slot></section>   <!-- デフォルトスロットにルート内容が入る -->
</template>
```

### Light DOM の制限

`disable-shadow-root` ではスロット置換は **`<wcs-layout>` の直接の子要素のみ**が対象。`<wcs-route>` の中の `slot` 属性付き要素はスロットに入らない。

### `<wcs-head>`

ルートごとにドキュメント `<head>` を管理。スタックベースで最後に接続されたものが優先。対応要素: `<title>` `<meta>` `<link>` `<base>` `<script>` `<style>`。全 `<wcs-head>` 切断で初期状態に復元。`<meta>` は `name`/`property`/`http-equiv`、`<link>` は `rel`/`href` で識別。

## 4. ガード・basename・フォールバック

### ルートガード

```html
<wcs-route path="/dashboard" guard="/login">
  <wcs-guard-handler>
    <script type="module">
      export default function(toPath, fromPath) {
        return document.cookie.includes('session=');   // boolean | Promise<boolean>
      }
    </script>
  </wcs-guard-handler>
  <dashboard-page></dashboard-page>
</wcs-route>
```

`false` でキャンセル → `guard` 属性のパスへ遷移。`<wcs-guard-handler>` はパース後 DOM から除去。`<wcs-route>` 外に置くと無視。JS からは `route.guardHandler = fn` でも設定可。

### basename

```html
<wcs-router basename="/app"> ... </wcs-router>
```

決定順: ① `basename` 属性 → ② `<base href>` から導出 → ③ 空文字。正規化: 先頭 `/` 付与・連続スラッシュ畳み込み・末尾 `/` 削除・`*.html` 末尾削除（`/app/index.html` → `/app`）。basename が異なれば同一ドキュメントに複数 Router 共存可。

### フォールバック / キャッチオール

- `<wcs-route fallback>` — 404 用。
- `path` 末尾の `*` は残りパス全体にマッチ、取得は `params['*']`、優先度最低。

## 5. ナビゲーション

### 宣言的リンク: `<wcs-link>`（生の `<a>` ではなくこれを使う）

```html
<wcs-link to="/">Products</wcs-link>
<wcs-link to="/about">About</wcs-link>
```

- `<a>` に変換。`to` が `/` 始まりならルートパス（basename 自動付与）、それ以外は外部 URL 扱い。
- 現在地一致で `active` CSS クラス自動付与: `a.active { font-weight: bold; }`

### プログラム的ナビゲーション

**(a) JS API**: router 要素の `async navigate(path: string): Promise<void>`（Navigation API、なければ pushState フォールバック）。

**(b) state から** — `<wcs-router>` の wc-bindable 面は `path`（output-only）と `navigateUrl`（input/output 両対応）:

```html
<wcs-router data-wcs="path: path; navigateUrl: navigateUrl">
```

```javascript
export default {
  path: "",          // router → state（現在パスが流れ込む）
  navigateUrl: null, // state → router（代入で遷移）
  openProduct() { this.navigateUrl = "/products/" + this["products.*.id"]; },
  goToProducts() { this.navigateUrl = "/"; },
};
```

- `navigateUrl` は**自己リセット**: 遷移完了時に router が `null` に戻すので、同じパスの再代入でも再遷移する。
- `path` は output-only なので state から書き戻さない（router が authority。バインディング確立時に現在値を読むためディープリンクでも取りこぼしなし）。

## 6. autoloader

### Import Map + 要素配置

```html
<script type="importmap">
  {
    "imports": {
      "@components/ui/": "./components/ui/",
      "@components/app/": "./components/app/"
    }
  }
</script>
<script type="module" src="https://esm.run/@wcstack/autoloader/auto"></script>
<body>
  <wcs-autoloader></wcs-autoloader>   <!-- ロードライフサイクルのトリガー。必須 -->
  <ui-button></ui-button>    <!-- ./components/ui/button.js を自動 import -->
  <app-header></app-header>  <!-- ./components/app/header.js を自動 import -->
</body>
```

### 解決規則

**遅延読み込み（名前空間）** — キーが `/` で終わる: `"@components/<プレフィックス>[|<ローダー>]/": "<パス>"`
- タグ名のプレフィックス部がマッチし残りがファイル名: `@components/ui/` + `<ui-button>` → `./components/ui/button.js`
- プレフィックス内のスラッシュはダッシュに変換。ローダー指定: `"@components/ui|lit/": "./ui/"`（デフォルト `vanilla`）

**即時読み込み** — キーが `/` で終わらない: `"@components/my-button": "./my-button.js"`、`"@components/fancy-input|vanilla,input": "./fancy-input.js"`（extends 省略時はプロトタイプから自動検出）

**コンポーネント要件**（vanilla ローダー）: `.js` 拡張子 + カスタム要素クラスを `default` export:

```javascript
// components/ui/button.js
export default class UiButton extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML = '<button><slot></slot></button>';
  }
}
```

- `is` 属性（拡張ビルトイン）も自動検出（autoloader が `{ extends }` 付きで define）。
- ロード失敗コンポーネントは再試行されない（失敗検出は `@wcstack/defined` の領分）。MutationObserver で動的追加要素も検知。

## 7. 実デモの index.html 全体構造（examples/router-spa 実物骨格）

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!-- ディープリンク必須: 無いと /products/3 直ロード時にそのパスが basename になる -->
  <base href="/">
  <title>wcstack: router + state + fetch demo</title>
  <style>/* a.active でアクティブリンク装飾 */</style>
  <script type="module" src="https://esm.run/@wcstack/state/auto"></script>
  <script type="module" src="https://esm.run/@wcstack/fetch/auto"></script>
  <script type="module" src="https://esm.run/@wcstack/router/auto"></script>
</head>
<body>

<nav aria-label="Main">
  <wcs-link to="/">Products</wcs-link>
  <wcs-link to="/about">About</wcs-link>
</nav>

<wcs-state>
  <script type="module">
    export default {
      path: "",
      navigateUrl: null,
      productsFetch: { value: null, loading: false, error: null, status: 0 },
      productFetch: { value: null, loading: false, error: null, status: 0 },
      get productId() {
        const m = this.path.match(/^\/products\/(\d+)$/);
        return m ? Number(m[1]) : null;
      },
      get isList() { return this.path === "/" || this.path === ""; },
      get isDetail() { return this.productId !== null; },
      get "productFetch.url"() {
        return this.productId ? "/api/products/" + this.productId : undefined;
      },
      get products() { return this["productsFetch.value"] ?? []; },
      openProduct() { this.navigateUrl = "/products/" + this["products.*.id"]; },
      goToProducts() { this.navigateUrl = "/"; },
    };
  </script>
</wcs-state>

<!-- Router: URL・履歴・ページ <title>・静的ページを所有 -->
<wcs-router data-wcs="path: path; navigateUrl: navigateUrl">
  <template>
    <wcs-route path="/">
      <wcs-head><title>Products</title></wcs-head>
    </wcs-route>
    <wcs-route path="/products/:productId(int)">
      <wcs-head><title>Product detail</title></wcs-head>
    </wcs-route>
    <wcs-route path="/about">
      <wcs-head><title>About</title></wcs-head>
      <section><!-- 静的コンテンツを直接記述（data-wcs なし） --></section>
    </wcs-route>
    <wcs-route fallback>
      <wcs-head><title>Not found</title></wcs-head>
      <section>
        <h2>404</h2>
        <p><wcs-link to="/">Back</wcs-link></p>
      </section>
    </wcs-route>
  </template>
</wcs-router>
<wcs-outlet></wcs-outlet>

<!-- ヘッドレス fetch ノード（spread で全出力を state スロットへ） -->
<wcs-fetch url="/api/products" data-wcs="...: productsFetch"></wcs-fetch>
<wcs-fetch data-wcs="...: productFetch"></wcs-fetch>

<!-- データバインドされるページは state 管理の <template data-wcs="if:"> 配下（body 直下） -->
<template data-wcs="if: isList">
  <section aria-label="Product list">
    <ul>
      <template data-wcs="for: products">
        <li>
          <button type="button" data-wcs="onclick: openProduct; attr.aria-label: .name">
            <span data-wcs="textContent: .name"></span>
            <span>¥<span data-wcs="textContent: .price|locale('ja-JP')"></span></span>
          </button>
        </li>
      </template>
    </ul>
  </section>
</template>

<template data-wcs="if: isDetail">
  <section aria-label="Product detail">
    <button type="button" data-wcs="onclick: goToProducts">&larr; Back</button>
    <h2 data-wcs="textContent: productFetch.value.name"></h2>
  </section>
</template>

</body>
</html>
```

### サーバー側の SPA フォールバック（examples/router-spa/server.js 実物）

```javascript
// SPA fallback: 非 API・拡張子なし GET はすべて index.html を返す
if (!url.pathname.startsWith("/api/") && extname(url.pathname) === "") {
  const html = await readFile(join(__dirname, "index.html"));
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
  return true;
}
```

## 8. 自作カスタム要素をルートに載せる作法

- ルート内にタグを直接書き、パラメータは `data-bind`（§2）で受ける。
- **define は router の責務外** — autoloader（§6）か手動 `customElements.define()` が別途必要。
- 代替パターン（router-spa の実証）: カスタム要素を作らず、ルートには `<wcs-head>` + 静的コンテンツのみ置き、データバインドされるページ DOM は body 直下の `<template data-wcs="if: ...">` で `path` 由来の getter により切り替える（§9-3 の制約のため、このパターンが state 併用時の既定解）。

## 9. 落とし穴チェックリスト

1. **`<base href="/">` がないとディープリンクが壊れる**（basename が `document.baseURI` から誤導出される）。
2. **サーバーに SPA フォールバックが必要** — 無いとリロード・直リンクが 404。
3. **router がスタンプするノードに `data-wcs` を書いても state は監視しない** — state はバインド時点の DOM しか収集しない。データバインドは body 直下の `<template data-wcs="if:">` に置く。
4. script の順序 — I/O ノード系を `@wcstack/state` より先に並べるのがベストプラクティス。
5. Light DOM レイアウトでは `slot` 属性付き要素は `<wcs-layout>` の直接の子のみ有効。
6. 型不一致はエラーでなく「マッチしない」— `/products/abc` は `:productId(int)` を素通りして fallback へ。
7. トップレベルルートに相対パスは書けない。ネストルートは相対パス。
8. `undefined` は要素に書き込まれない（write-skip）— getter が `undefined` を返すと `<wcs-fetch>` は沈黙。url 同値ガードで同一 URL は再フェッチしない。
9. autoloader のロード失敗は再試行されない。
