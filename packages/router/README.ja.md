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
            <main-dashboard></main-dashboard>
          </wcs-route>

          <!-- pathが"/products"の場合、トップレベル以外は相対パス -->
          <wcs-route path="products">
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
| `path` | トップレベルルートの場合、"/"で始まる絶対パスを指定、それ以外は相対パスを指定。パラメータを指定する場合、`:パラメータ名`。トップレベルルートでは相対パスを指定できない。 |
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

### Link(wcs-link)

リンク。`<a>`へ変換され、to属性で指定されたパスはURLへ変換される。

| 属性 | 説明 |
|------|------|
| `to` | 遷移先の絶対ルートパスもしくはURL。`/`で始まる場合はルートパス（basenameが付与される）。それ以外は外部URLとして扱われる |

