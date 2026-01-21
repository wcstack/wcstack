# @wcstack/router

カスタム要素を使って宣言的に定義し、SPAのルーティングを行います

## 特徴
* カスタム要素を使った宣言的なルーティング定義
* ルーティング定義内にレイアウト定義を混在できる
* レイアウト定義ではLightDOMを使ったslot指定が可能
* navigation API対応
* 簡易ではあるもののパラメータバインド対応
* グローバルフォールバック対応
* ゼロコンフィグ
* 依存関係ゼロ
* ビルドレス

## 使い方

```html
<wcs-router>
  <template>
    <!-- pathが"/"の場合 -->
    <wcs-route path="/">
      <!-- "main-layout"レイアウトを適用 -->
      <wcs-layout layout="main-layout">
        <main-header slot="header"></main-header>
        <main-body>
          <!-- pathが"/"の場合 -->
          <wcs-route index>
            <wcs-head>
              <title>Main Page</title>
            </wcs-head>
            <main-dashboard></main-dashboard>
          </wcs-route>

          <!-- pathが"/products"の場合、トップレベル以外は相対パス -->
          <wcs-route path="products">
            <wcs-head>
              <title>Product Page</title>
            </wcs-head>
            <!-- pathが"/products"の場合 -->
            <wcs-route index>
              <product-list></product-list>
            </wcs-route>
            <!-- pathが"/products/:productId"の場合 -->
            <wcs-route path=":productId">
              <!-- productItem.props.productId = productId -->
              <product-item data-bind="props"></product-item>
            </wcs-route>
          </wcs-route>
        </main-body>
      </wcs-layout>
    </wcs-route>

    <!-- pathが"/admin"の場合 -->
    <wcs-route path="/admin">
      <!-- "admin-layout"レイアウトを適用 -->
      <wcs-layout layout="admin-layout">
        <wcs-head>
          <title>Admin Page</title>
        </wcs-head>
        <admin-header slot="header"></admin-header>
        <admin-body></admin-body>
      </wcs-layout>
    </wcs-route>

    <!-- pathが一致しない場合 -->
    <wcs-route fallback>
      <error-404></error-404>
    </wcs-route>
  </template>
</wcs-router>

<wcs-outlet>
  <!-- ルートパス・レイアウトに従ったDOMツリーを作成し、ここに表示 -->
</wcs-outlet>

<!-- "main-layout"レイアウト -->
<template id="main-layout">
  <section>
    <h1> Main </h1>
    <slot name="header"></slot>
  </section>
  <section>
    <slot></slot>
  </section>
</template>

<!-- "admin-layout"レイアウト -->
<template id="admin-layout">
  <section>
    <h1> Admin Main </h1>
    <slot name="header"></slot>
  </section>
  <section>
    <slot></slot>
  </section>
</template>

```

※<main-header><main-body><main-dashboard><product-list><product-item><admin-header><admin-body><error-404>はアプリ側のカスタムコンポーネント
※上記カスタム要素は、オートローダーやコードによる定義が別途必要

## リファレンス

### Router(wcs-router)

子要素のtemplateタグ内にルーティング・レイアウトスロット定義する。ドキュメント内で1つのみ存在可能。直下にtemplateタグが必要。定義に従って、`<wcs-outlet>`へ出力する

| 属性 | 説明 |
|------|------|
| `basename` | サブフォルダのURLでルーティングする場合に、サブフォルダを指定。サブフォルダで動作させない場合は、指定不要 |

### Route(wcs-route)

ルートパスが一致する場合、子要素を表示。パスの一致の優先順位は静的パス＞パラメータ。

| 属性 | 説明 |
|------|------|
| `path` | トップレベルルートの場合、"/"で始まる絶対パスを指定、それ以外は相対パスを指定。パラメータを指定する場合、`:パラメータ名`。キャッチオールは`*`。トップレベルルートでは相対パスを指定できない。 |
| `index` | 上位のパスを引き継ぐ |
| `fallback` | ルートパスに対応するルートがない場合、表示する |
| `fullpath` | 上位ルートを含むパス、読み取り専用 |
| `name` | 識別用 |
| `guard` | ガード処理を実施。値にはガードキャンセル時の絶対ルートパスを指定 |

| プロパティ | 説明 |
|------|------|
|guardHandler|ガード判定関数を設定|

ガード判定関数の型：
function (toPath: string, fromPath: string): boolean | Promise<boolean>

### Layout(wcs-layout)

テンプレートを読み込み、子要素を`<slot>`へ挿入して`<wcs-layout-outlet>`へ書き出す。Light DOM対応。外部ファイル対応。

| 属性 | 説明 |
|------|------|
| `layout` | テンプレートとなる`<template>`タグのid属性 |
| `src` | 外部ファイルテンプレートのURL |
| `name` | 識別名、`wcs-layout-outlet`へ引き継がれる |
| `enable-shadow-root` | `<wcs-layout-outlet>`でShadow DOMを使用 |
| `disable-shadow-root` | `<wcs-layout-outlet>`でLight DOMを使用 |

### Outlet(wcs-outlet)

ルーティング・レイアウト設定に従いDOMツリーを表示する。HTML内に定義するか、ない場合は`<wcs-router>`により作成される。

### LayoutOutlet(wcs-layout-outlet)

レイアウト（`<wcs-layout>`）設定に従いDOMツリーを`<wcs-outlet>`へ表示する。`<wcs-layout>`の名前属性を引き継ぐ。スタイリングの設定時、name属性で識別する。

| 属性 | 説明 |
|------|------|
| `name` | `<wcs-layout>`の名前属性。スタイリングの設定時、name属性で識別する。 |

#### Light DOMの制限事項

`disable-shadow-root`（Light DOM）の場合、スロット置換は`<wcs-layout>`の**直接の子要素のみ**が対象です。`<wcs-route>`の中にある`slot`属性付き要素はスロットに配置されません。

```html
<!-- NG: <div slot="header">はwcs-layoutの直接の子ではないため、スロットに入らない -->
<wcs-layout layout="main" disable-shadow-root>
  <wcs-route path="/page">
    <div slot="header">Header Content</div>
  </wcs-route>
</wcs-layout>

<!-- OK: slot属性付き要素をwcs-layoutの直接の子にする -->
<wcs-layout layout="main" disable-shadow-root>
  <div slot="header">Header Content</div>
  <wcs-route path="/page">
    <!-- ページ本体 -->
  </wcs-route>
</wcs-layout>
```

`enable-shadow-root`（Shadow DOM）の場合は、ネイティブの`<slot>`機能が使われるため、この制限はありません。

### Link(wcs-link)

リンク。`<a>`へ変換され、to属性で指定されたパスはURLへ変換される。

| 属性 | 説明 |
|------|------|
| `to` | 遷移先の絶対ルートパスもしくはURL。`/`で始まる場合はルートパス（basenameが付与される）。それ以外は外部URLとして扱われる |

## パス仕様案（Router / Route / Link 共通）

### 用語

* **URL Pathname**: `location.pathname`（例: `/app/products/42`）
* **basename**: アプリの“マウント先”のパス（例: `/app`）
* **internalPath**: basename を除いたアプリ内ルーティング用パス（例: `/products/42`）

---

## 1) basename の仕様

### 1.1 basename の決定順

1. `<wcs-router basename="/app">` の `basename` 属性
2. `<base href="/app/">` がある場合は `new URL(document.baseURI).pathname` から導出
3. どちらも無い場合は **空文字** `""`（= ルート直下で動く想定）

### 1.2 basename の正規化（重要）

basename は **必ず次に正規化**する：

* 先頭 `/` を付ける（空はそのまま）
* 連続スラッシュを 1つに畳む
* 末尾の `/` は削除（ただし `/` そのものは空 `""` と等価扱い）
* `.../index.html` や `.../*.html` はファイルとみなし削除
* 結果が `/` になったら basename は `""` とする

例：

* `"/"` → `""`
* `"/app/"` → `"/app"`
* `"/app/index.html"` → `"/app"`

### 1.3 basename と直リンクの整合性

* basename が `""` で `<base>` も無いのに、初期表示の `pathname !== "/"` の場合は **エラー**（現行思想を踏襲）
* basename が `"/app"` の場合：

  * `"/app"` と `"/app/"` は **同じ意味**（アプリの root）
  * `"/app"` は `"/app"` または `"/app/..."` にのみ一致（`"/appX"` には一致しない）

---

## 2) internalPath の仕様

### 2.1 internalPath の正規化

internalPath は常に **絶対パス形式**で扱う。

* 先頭 `/` を付ける
* 連続スラッシュを畳む
* 末尾 `/` は削除（ただし root `/` は保持）
* 空になったら `/`
* Router が扱う internalPath の正規化では末尾が `*.html` の場合は削除

例：

* `""` → `/`
* `"products"` → `/products`
* `"/products/"` → `/products`
* `"///a//b/"` → `/a/b`

### 2.2 URLから internalPath を得る

`URL Pathname` を `basename` と突き合わせて得る。

* `pathname === basename` なら `internalPath = "/"`
* `pathname` が `basename + "/"` で始まるなら `internalPath = pathname.slice(basename.length)`
* それ以外は `internalPath = pathname`
* slice 結果が `""` なら `internalPath = "/"`

例：basename=`/app`

* pathname=`/app` → internalPath=`/`
* pathname=`/app/` → internalPath=`/`
* pathname=`/app/products/42` → internalPath=`/products/42`

---

## 3) `<wcs-route path="...">` の仕様

### 3.1 path の書き方

`<wcs-route path="...">` の `path` は **internalPath のルールに従う**。

* ルート（トップ）は `"/"`
* 子routeは **相対**を許可する（推奨は相対）

  * 例: 親が `/products`、子が `":id"` → `/products/:id`

> ただし実装側では、解析時に「絶対化」して持つ方が事故が少ないです（相対のまま保持しない）。

### 3.2 マッチング規則

* **完全一致**（セグメント単位）
* パラメータ `:id` は1セグメントにマッチ
* キャッチオール `*` は残りのパス全体にマッチ（`params['*']` で取得可能）

### 3.3 優先順位（最長マッチの定義）

候補が複数ある場合、次の順で高いものを採用：

1. **セグメント数が多い**
2. 同セグメント数なら **静的セグメントが多い**（`"users"` > `":id"` > `"*"`）
3. それでも同じなら **定義順**

> キャッチオール `*` は優先度が最も低いため、より具体的なルートが常に優先されます。

例：

* `/admin/users/:id`（静的2 + param1）
* `/admin/users/profile`（静的3）
  → 後者が勝つ

### 3.4 トレーリングスラッシュ

* マッチングは **内部正規化後**に行うため、

  * `/products` と `/products/` は同一扱い（URL表現はどちらでもOK）

### 3.5 キャッチオール（`*`）

パス末尾に `*` を指定すると、残りのパス全体にマッチします。

```html
<wcs-route path="/admin/profile"></wcs-route>  <!-- 優先 -->
<wcs-route path="/admin/*"></wcs-route>        <!-- /admin/xxx でフォールバック -->
<wcs-route path="/*"></wcs-route>              <!-- 最後の砦 -->
```

| パス | マッチ | 理由 |
|------|--------|------|
| `/admin/profile` | `/admin/profile` | セグメント数多い |
| `/admin/setting` | `/admin/*` | `*` が `setting` にマッチ |
| `/admin/a/b/c` | `/admin/*` | `*` が `a/b/c` にマッチ |
| `/other` | `/*` | トップレベルcatch-all |

マッチした残りパスは `params['*']` で取得できます。

---

## 4) `<wcs-link to="...">` の仕様

### 4.1 to が `/` で始まる場合

`to` は **internalPath** とみなす。

* 実際の `href` は `basename + internalPath` を join して生成
* join は `"/app" + "/products"` → `"/app/products"`（`//`を作らない）

### 4.2 to が `/` で始まらない場合

外部リンクとして扱う（`new URL(to)` が成立する想定）。

* 例: `https://example.com/`

---

## 5) “HTMLファイルを落とす” ルールは限定的に

`.html` を落とすのは **pathname の末尾が本当にファイルっぽい場合だけ**。

* `"/app/index.html"` → `"/app"`（OK）
* `"/products"` を `"/"` にするのは **NG**（セグメントを落とさない）


