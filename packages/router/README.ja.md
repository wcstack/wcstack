# @wcstack/router

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

**もしルーティングがただのHTMLタグだったら？**

アプリのナビゲーション構造をマークアップだけで定義できる未来を想像してみてください。ネストされたルート、レイアウト、型付きパラメータ — これらすべてがネイティブなHTML要素として存在します。ルーター設定オブジェクトも、JavaScriptの煩雑な手続きも不要です。タグそのものが、「どこに何を配置するか」を明確に示します。

これこそが `<wcs-router>`, `<wcs-route>` が追求するコンセプトです。CDNからの読み込みのみで動作し、依存ライブラリはゼロ。構文はすべてHTMLです。

## 特徴

### 基本機能
* **宣言的ルーティング**: HTMLの `<template>` 内に `<wcs-route>` タグを並べるだけで定義完了。JS設定オブジェクト不要。
* **階層化されたルート定義**: ネスト構造で `/products/:id` などを直感的に表現。
* **パラメータサポート**: パスパラメータ（`:id`）対応。
* **フォールバック (404)**: `<wcs-route fallback>` で未定義パスをハンドリング。
* **Navigation API ベース**: モダンな標準規格 Navigation API を採用し、ブラウザネイティブの挙動と親和性が高い。
* **ゼロコンフィグ / ビルドレス**: バンドル不要でブラウザでそのまま動作。

### ユニークな機能
* **Light DOM レイアウトシステム**: Shadow DOM を強制せず、通常のDOM（Light DOM）上でレイアウトテンプレートを展開。グローバルCSSが適用しやすく、`<slot>` 差し込みも容易。
* **型付きパラメータ (`Typed Parameters`)**: `:id(int)` のように型制約を指定可能。自動的に `number` 型への変換も行います。
* **レイアウトとルートの混在定義**: ルーティングツリー内に `<wcs-layout>` を自由にネストでき、エリアごとのレイアウト切り替えがHTML構造だけで完結。
* **自動バインディング**: `data-bind` 属性でURLパラメータをコンポーネントに自動注入（`props`, `states`, `attr`, 直接プロパティの4モード対応）。
* **宣言的な `<head>` 管理**: `<wcs-head>` でページごとの `title` や `meta` を宣言的に切り替え。

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

子要素のtemplateタグ内にルーティング・レイアウトスロット定義する。直下にtemplateタグが必要。定義に従って、`<wcs-outlet>`へ出力する。`basename` が異なれば、同一ドキュメント内に複数の Router を共存可能

| 属性 | 説明 |
|------|------|
| `basename` | サブフォルダのURLでルーティングする場合に、サブフォルダを指定。サブフォルダで動作させない場合は、指定不要 |
| `focus` | commit したナビゲーション後に適用するオプトインのフォーカスポリシー。`"heading"` でリーフ route 内容の最初の見出しへフォーカス。「アクセシビリティ契約」参照 |
| `announce` | オプトインのルート告知。`"title"` で commit 時点の `document.title` スナップショットを router 保有の live region へ書き込む。「アクセシビリティ契約」参照 |

#### state バインディング（wc-bindable）

`<wcs-router>` は live DOM に居る要素としてナビゲーション状態の全量を wc-bindable プロトコルで露出する。`@wcstack/state`（あるいは任意の binding core）は `data-wcs` 一つで配線できる：

```html
<wcs-router data-wcs="path: path; typedParams: routeParams; searchParams: query;
                      routeName: routeName; navigateUrl: navigateUrl; replaceUrl: replaceUrl">
```

| メンバー | 方向 | 説明 |
|------|------|------|
| `path` | output のみ | 現在のルートパス（basename スライス後）。`wcs-router:path-changed` を発火 |
| `params` | output のみ | マッチしたルートチェーンのマージ済みパラメータ（文字列、`Record<string, string>`）。fallback マッチ・初期化前は `{}` |
| `typedParams` | output のみ | 同パラメータの型変換済み値（`:id(int)` → `number`）。イベントは `params` と共有（detail は `{ params, typedParams }`） |
| `searchParams` | output のみ | 現在 URL のクエリ（`Record<string, string>`）。キー重複（`?tag=a&tag=b`）は **last-wins**、デコードは `URLSearchParams` に委ねる（`+` → 空白を含む）。クエリ無しは `{}`。`wcs-router:search-changed` を発火 |
| `routeName` | output のみ | 最深マッチルートの `name` 属性値。fallback マッチ時は fallback ルートの `name`（404 画面も `routeName` 分岐で書ける）。無名・初期化前は `""`。`wcs-router:route-name-changed` を発火 |
| `navigateUrl` | 書き込み面（null-idle transient） | ターゲットを書くと push 遷移。null は待機、文字列の書き込みで `navigate()` が起動し、完了後に自分で null へ戻る。null / `""` の書き込みは no-op |
| `replaceUrl` | 書き込み面（null-idle transient） | `navigateUrl` と完全同型の契約。ただし現在の履歴エントリを**置き換える** |
| `basename` | input | `basename` 属性のミラー |

コマンド `navigate(path)` / `replace(path)`（いずれも async）も宣言され、command-token プロトコルから起動できる。

output-only メンバーはバインド attach 時に**読まれ**、以後は変更イベントで流れる — 値は「読むもの」であり「待つもの」ではないので、router が最初のルートを解決した後に attach したバインドでも取りこぼしはない。

**発火規範**: commit されたナビゲーションでは、router はまず**全内部値をコミット**し、その後で `params-changed` → `route-name-changed` → `search-changed` → `path-changed` の順に、値が実際に変化したものだけを発火する。どのイベントのリスナーから要素プロパティを読んでも遷移後スナップショットの一貫した値が見える。`path` は最後に発火し「ナビゲーション完了」の信号を兼ねる。guard 拒否されたナビゲーションでは何も更新せず何も発火しない。

露出オブジェクトは router が所有する **frozen スナップショット**（ナビゲーションごとに新しいオブジェクト、in-place 変異なし）。変異は throw する — 自分の state へコピーして使うこと。

**書き込み面の使い分け**:

- ページネーション・タブ（戻るボタンで戻りたい）→ `navigateUrl = "?page=2"`
- 検索ボックス・絞り込み（履歴を打鍵ごとに汚したくない）→ `replaceUrl = "?q=" + …`（高頻度入力には `<wcs-debounce>` を挟む）

**マルチ Router**: `params` / `routeName` は各 Router 自身のマッチを反映するが、ページの URL にクエリは 1 つしかない — どの Router 経由で書いてもページ全体のクエリが置き換わる。一方**読み取り面は per-Router**: Router は自分の `basename` 配下のナビゲーションを処理したときだけ `searchParams` を commit するので、その値は「その Router が最後に処理したナビゲーション時点のクエリ」である。

#### ナビゲーションターゲットのクエリ文字列

`navigate()` / `replace()` / `navigateUrl` / `replaceUrl` / `<wcs-link to>` は次を受理する：

| 形 | 意味 |
|------|------|
| `/path` | パス遷移。現在のクエリは**引き継がない**（引き継ぎたい場合は `searchParams` から組み立てる） |
| `/path?k=v` | パス遷移＋クエリ指定 |
| `?k=v` | クエリのみ遷移：pathname は現在値を維持 |
| `?` | クエリの全消去（pathname 維持） |

basename 結合と pathname 正規化は pathname にのみ適用され、クエリとハッシュはそのまま再結合される（ハッシュは素通し — router はハッシュではルーティングしない）。クエリはルートマッチングに一切関与しない。

同一パスへのクエリのみ遷移は **same-match** ナビゲーションになる：ルートガードは再実行されず（ガードが守るのはルートへの**進入**であり、クエリ変化は進入ではない）、ルート内容は再スタンプされず、view transition も依頼されず、再アナウンスもされず、フォーカス・スクロールは動かない（履歴の traverse ではブラウザのスクロール復元が従来どおり働く）。変わるのは `searchParams` と URL だけである。

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
| `guardHandler` | ガード判定関数を設定 |

> **`params` / `typedParams` はどこへ？** `<wcs-router>` にある — 「state バインディング（wc-bindable）」参照。パース後の route 要素は detached なコントローラであり live DOM に属さないため、`querySelector` では見つからず `data-wcs` でも結線できない。マッチ結果の観測面は router 要素である。

ガード判定関数の型：
`(toPath: string, fromPath: string) => boolean | Promise<boolean>`

#### GuardHandler(wcs-guard-handler)

`<wcs-route>` の子要素として配置し、ガード判定関数を宣言的に定義します。`<script type="module">` の `default export` で判定関数を返してください。`<wcs-guard-handler>` 要素自体はパース後にDOMから除去されます。

```html
<wcs-route path="/dashboard" guard="/login">
  <wcs-guard-handler>
    <script type="module">
      export default function(toPath, fromPath) {
        return document.cookie.includes('session=');
      }
    </script>
  </wcs-guard-handler>
  <dashboard-page></dashboard-page>
</wcs-route>
```

- `guard` 属性の値はガードがキャンセルされた場合のリダイレクト先パス
- 判定関数が `false` を返すとナビゲーションがキャンセルされ、`guard` 属性のパスへ遷移
- 判定関数は `Promise<boolean>` を返すことも可能（非同期チェック対応）
- `<wcs-route>` の外に配置された `<wcs-guard-handler>` は無視される
- `<script type="module">` がない場合、`guardHandler` は設定されない
- **Content-Security-Policy 下では**、ガードスクリプトは `blob:` URL 経由で評価されるため `script-src blob:` が必要。ガードはインライン専用で、`<wcs-state>` のような `src=` 退避経路は存在しない。詳細は [docs/csp.ja.md](../../docs/csp.ja.md)

#### 型付きパラメータ

パスパラメータに型を指定することで、値の検証と自動変換が行えます。

**構文**: `:パラメータ名(型名)`

```html
<!-- 数値型パラメータ -->
<wcs-route path="/users/:userId(int)">
  <user-detail></user-detail>
</wcs-route>

<!-- 複合型パラメータ -->
<wcs-route path="/posts/:date(isoDate)/:slug(slug)">
  <post-detail></post-detail>
</wcs-route>
```

**ビルトイン型**:

| 型名 | 説明 | 例 | 変換後の型 |
|------|------|------|------|
| `int` | 整数 | `123`, `-45` | `number` |
| `float` | 浮動小数点数 | `3.14`, `-2.5` | `number` |
| `bool` | 真偽値 | `true`, `false`, `0`, `1` | `boolean` |
| `uuid` | UUID v1-5 | `550e8400-e29b-41d4-a716-446655440000` | `string` |
| `slug` | スラッグ（小文字英数字とハイフン） | `my-post-title` | `string` |
| `isoDate` | ISO 8601 日付 | `2024-01-23` | `Date` |
| `any` | 任意の文字列（デフォルト） | 任意 | `string` |

**値の取得**:

マッチ結果は `<wcs-router>` 要素に露出される（route 要素自体は detached なコントローラで、live DOM からは取得できない）：

```html
<!-- 宣言的: 解析結果をそのまま state へバインド -->
<wcs-router data-wcs="typedParams: routeParams"></wcs-router>
```

```javascript
// 命令的: router 要素から読む
const router = document.querySelector('wcs-router');
console.log(router.params.userId);       // "123"
console.log(router.typedParams.userId);  // 123 (number)
```

**動作仕様**:
- 型に一致しない値の場合、そのルートはマッチしません（エラーにはなりません）
- 型を指定しない場合は `any` として扱われます（従来の動作と同じ）
- 未知の型名を指定した場合も `any` にフォールバックします

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

### Head(wcs-head)

ルートごとにドキュメントの `<head>` 要素を管理する。スタックベースで、最後に接続された Head が優先される。

```html
<wcs-route path="/about">
  <wcs-head>
    <title>About Us</title>
    <meta name="description" content="About our company">
  </wcs-head>
  <about-page></about-page>
</wcs-route>
```

**対応要素**: `<title>`, `<meta>`, `<link>`, `<base>`, `<script>`, `<style>`

**動作**:
- 初回接続時に初期の `<head>` 状態をキャプチャ
- 複数の `<wcs-head>` が同時にアクティブな場合、最後に接続されたものが優先（上書き）
- 全ての `<wcs-head>` が切断されると、初期状態に復元
- 要素はキーで識別（例: `<meta>` は `name`/`property`/`http-equiv`、`<link>` は `rel`/`href`）

### Link(wcs-link)

リンク。`<a>`へ変換され、to属性で指定されたパスはURLへ変換される。リンクのパスが現在のURLと一致する場合、生成された `<a>` 要素に `active` CSSクラスが自動付与される。

| 属性 | 説明 |
|------|------|
| `to` | 遷移先の絶対ルートパスもしくはURL。`/`で始まる場合はルートパス（basename は pathname にのみ付与され、`?クエリ` / `#ハッシュ` はそのまま温存される）。`?` で始まる場合は**クエリのみリンク**：href は「現在 pathname + 指定クエリ」で組み立てられ、ロケーション変更に追従する。それ以外は外部URLとして扱われる |

**アクティブ状態**: 生成された `<a>` はパスが現在のロケーションと一致する場合に `active` クラスと、同じ事実の ARIA 表現である `aria-current="page"` を受け取る（スクリーンリーダーがナビゲーション内の現在地を読み上げられる）。比較は **pathname のみ**で行われ、どちら側のクエリも影響しない（`to="/products"` は `/products?page=2` でも active のまま。クエリのみリンクはそのページに居る間つねに active）。ナビゲーションイベント（`currententrychange`, `wcs:navigate`, `popstate`）で更新される。

```css
/* アクティブなリンクのスタイル */
a.active { font-weight: bold; color: blue; }
```

**属性の転送**: `<a>` の生成時に、すべての `aria-*` 属性と固定 7 名（`title` / `rel` / `target` / `download` / `hreflang` / `lang` / `dir`）をホストから anchor へコピーする（`lang` / `dir` はスクリーンリーダーの読み上げ言語・方向に直結する）。`to` / `style` / `class` は決して転送しない（ホストは `display:none` であり、`class` は `active` 契約を持つ）。接続後に追従するのは固定 7 名のみで、**動的な `aria-*` 変更は anchor に届かない** — `<wcs-link data-wcs="attr.aria-label: ...">` のような `data-wcs` バインドもコピー後にホストへ書くため届かない。`<wcs-link>` の `aria-*` は静的属性で書くこと。

**素の `<a>` について**: Navigation API のあるブラウザでは、basename 配下の素の `<a href="/about">` も SPA 遷移になる（router が intercept する）。フォールバックブラウザでは成立しない（SPA 経路は `<wcs-link>` の click ハンドラのみ）ため、推奨は `<wcs-link>` のまま。

## 自動バインディング (`data-bind`)

ルートパラメータの配送には行き先の異なる 2 つの機構がある：

| パラメータの行き先 | 使うもの |
|------|------|
| state へ（リアクティブ描画・派生値） | `<wcs-router>` の `typedParams` / `params` バインド — 「state バインディング（wc-bindable）」参照 |
| route 内の要素へ直接（state を使わないページ・汎用コンポーネント） | 下記の `data-bind` |

`data-bind` 属性を持つ要素は、マッチしたルートパラメータを自動的に受け取る。4つのバインディングモードに対応：

| `data-bind` の値 | ターゲット | 説明 |
|------|------|------|
| `"props"` | `element.props` | `props` プロパティにパラメータをマージ |
| `"states"` | `element.states` | `states` プロパティにパラメータをマージ |
| `"attr"` | HTML属性 | `setAttribute()` でパラメータをHTML属性に設定 |
| `""` (空文字) | 直接プロパティ | 要素に直接プロパティを設定（例: `element.id = value`） |

```html
<wcs-route path="/users/:userId(int)">
  <!-- element.props = { userId: 123 } -->
  <user-detail data-bind="props"></user-detail>

  <!-- element.setAttribute("userId", 123) -->
  <div data-bind="attr"></div>
</wcs-route>
```

パラメータは `connectedCallback` の発火前に割り当てられる。未定義のカスタム要素の場合、`customElements.whenDefined()` の解決後に割り当てが遅延される。

## 設定

`bootstrapRouter()` でオプション設定を指定して初期化：

```javascript
import { bootstrapRouter } from '@wcstack/router';

bootstrapRouter({
  // カスタムタグ名（すべてオプション）
  tagNames: {
    router: 'wcs-router',       // デフォルト
    route: 'wcs-route',         // デフォルト
    outlet: 'wcs-outlet',       // デフォルト
    layout: 'wcs-layout',       // デフォルト
    layoutOutlet: 'wcs-layout-outlet', // デフォルト
    link: 'wcs-link',           // デフォルト
    head: 'wcs-head'            // デフォルト
  },
  // outlet で Shadow DOM を使用（デフォルト: false）
  enableShadowRoot: false,
  // basename から除去するファイル拡張子（デフォルト: [".html"]）
  basenameFileExtensions: [".html"]
});
```

## ルート遷移アニメーション

ルートの差し替えは素の `removeChild` / `insertBefore` なので、去っていくビューは自力では退場できない。ページに [`@wcstack/view-transition`](https://github.com/wcstack/wcstack/tree/main/packages/view-transition) を足すと、差し替えが View Transition の中で行われ、見た目は CSS で書ける。

```html
<script type="module" src="https://esm.run/@wcstack/view-transition/auto"></script>
<wcs-view-transition for="router"></wcs-view-transition>

<style>
  ::view-transition-old(root) { animation: fade-out 0.2s both; }
  ::view-transition-new(root) { animation: fade-in 0.2s both; }
</style>
```

ルータはガードを先に走らせ、hide/show の対だけを遷移へ渡す。await するガードが遷移を開きっぱなしにしないため。ページを最初に描く「最初のルート適用」は常に同期で行う —— 対比すべき旧ルートが無く、入場は @starting-style の担当だから。タグが無ければ何も変わらない（差し替えは同期のまま）。[docs/view-transition-design.ja.md](https://github.com/wcstack/wcstack/blob/main/docs/view-transition-design.ja.md) §7.1 参照。

## サーバーサイドレンダリング（SSR）

`<wcs-router enable-ssr>` を付けると [`@wcstack/server`](https://github.com/wcstack/wcstack/tree/main/packages/server) の SSR に参加する: `renderToString({ url })` がリクエスト URL の初期ルートをサーバーで描画し、クライアント側 router は起動時にサーバー描画済み DOM を再描画せずに**採用（adopt）**する — 採用ノード上で state のバインディングは生きたまま。属性が無ければ router はサーバーで一切初期化されず、従来どおりクライアントで描画される（部分 CSR）。

- サーバー出力が現在の URL・ルート定義と検証で一致しない場合、クライアントは静かに通常のクライアント描画へフォールバックする。
- guard 付きルートはサーバーで描画されない — guard は認可点でありクライアントで実行される。outlet は空のまま配信される。
- `<wcs-layout>` を使うルートは採用時にクライアント描画へフォールバックする。
- `<wcs-link>` の anchor はサーバーで描画され（`active` / `aria-current` 付き）、クライアントが採用する。

サーバー側の設定は `@wcstack/server` の README、設計は [docs/ssr-router-design.md](https://github.com/wcstack/wcstack/blob/main/docs/ssr-router-design.md) を参照。

## アクセシビリティ契約

router は、プラットフォームが既に正しく行うことについては、スクロールとフォーカスの扱いをブラウザへ委譲する。

**Navigation API 経路**（Chromium ほか対応ブラウザ）: router は `event.intercept()` に仕様既定を明示的に書いて渡す — `scroll: "after-transition"` と `focusReset: "after-transition"`。

- push 遷移はページ先頭へスクロールし、traverse（戻る/進む）は以前のスクロール位置を復元する
- 遷移後、フォーカスは新しい内容の最初の `[autofocus]` 要素へ、無ければ `<body>` へ移る

これらは仕様の既定値であり、明示は委譲が意図であることの記録。どちらかを `"manual"` に変える変更はリファクタではなくこの契約の変更にあたる。

**フォールバック経路**（Navigation API の無いブラウザ）: ナビゲーションは `history.pushState` + `popstate` リスナで動く。commit した push 遷移の後は router がページ先頭へスクロールし、Navigation API の既定と揃える。route guard に拒否された遷移ではスクロールしない。戻る/進むのスクロール復元はブラウザの `history.scrollRestoration`（既定 `auto`）の仕事なので、router は `popstate` では決してスクロールしない。

**オプトインのポリシー** — `<wcs-router focus="heading" announce="title">`。どちらも既定はオフで、属性が無ければ上記のブラウザ挙動がすべて。どちらも commit したナビゲーションの直後にだけ走り、最初のルート適用（ページロードはブラウザの担当）と guard 拒否されたナビゲーションでは決して動かない。

- `focus="heading"`: **リーフ** route が挿入した内容の最初の**可視の** `h1`〜`h6` へフォーカスを移す（見出しに tabindex が無ければ `tabindex="-1"` を付与。`hidden` / `display:none` の見出しは focus() が空振りするためスキップ）。指定中は Navigation API 経路で `focusReset: "manual"` を渡し、ブラウザ既定のリセットとの二重処理を防ぐ。可視の見出しが無ければ、router が仕様既定のリセットを自前で再現する — 最初の `[autofocus]` 要素へ、無ければ `<body>` へ落とす（永続ナビのリンク等、旧フォーカス要素が遷移後も生き残るケースでフォーカスが前画面に取り残されないため）。それでもオプトインするなら各ルートに見出しを置き、ルート内容の**冒頭**に置くこと — 見出しへの focus はスクロールインを起こすが、push 遷移直後の scroll-to-top が勝つため、ページ下方の見出しは画面外のままフォーカスされる。ポリシーが有効になるのは値がちょうど `"heading"` のときだけで、空文字・未知値はブラウザ既定に落ちる。
- `announce="title"`: commit 時点の `document.title` のスナップショットを router 保有の live region（`role="status"`・視覚的にクリップ・`<wcs-router>` 直下・router ごとに 1 つ）へ書き込む。既知の制限: バインド title（`<title data-wcs>`）は commit 時点で古いことがあり、ナビゲーション外の title 変化は再読み上げされない。また同じ title を共有するルート間の遷移は live region のテキストが変化しないため、SR / ブラウザの組み合わせによっては再読み上げされないことがある。

設計の記録は [docs/a11y-design.md](https://github.com/wcstack/wcstack/blob/main/docs/a11y-design.md) §3 を参照。

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
3. どちらも無い場合、`document.baseURI` は現在のドキュメント URL なので basename は `location.pathname` から導出される。**空文字** `""` になるのはドキュメント自体がルートで読み込まれた場合だけで、`/products/3` を直接開けば basename は `/products/3` になる。深いリンクを成立させるには `<base href="/">` か `basename` 属性が必要

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

### 1.4 ロケールを basename に置く（多言語サイト）

`/en/…` と `/ja/…` で配るサイトでは、ロケールを**ルートパターンではなく basename** に置く。
ロケールが決まった時点で `<head>` の同期スクリプトから `<base href="/ja/">` を書けば、
router は解決順 1.2 で拾う。

これは好みの問題ではない。`/:lang` をルートパラメータにすると**言語切替が壊れる**。

> `<wcs-router>` は basename 配下の同一オリジンナビゲーションを、素の `<a>` クリックも
> 含めて**すべて** `intercept()` に渡す。ロケールが basename の内側にあると、他言語への
> リンクはクライアント側で処理される —— ページが再読み込みされないので、ロケールごとに
> 読み込んだもの（辞書モジュール・`Intl` のフォーマッタ）は再評価されず、**言語が
> 変わらないまま何も壊れて見えない**。

basename が `/ja` なら `/en/orders` へのリンクは `_isOwnPath` を外れ、router は intercept を
辞退し、ブラウザが本物のナビゲーションを行う。「ただのリンクで切り替わる」のは basename の
**おかげ**である。

副産物が 2 つある。

* **ルートパターンからロケールが消える** —— `path="/"`・`path="/about"`。アプリ内リンクも
  ロケールを持たない（`<wcs-link to="/about">` が basename を前置する）
* **ページ上の URL をすべて絶対にする**こと。`<base>` が相対 URL の基準を変えるため

ロケールを持たない URL や未対応のロケールの修復も、同じ head スクリプトで `location.replace`
する。ルートガードには置けない —— guard の redirect 先は静的な `guard="…"` 属性なので、
残りのパスを保てない。DOM 解析前に済ませれば描画もフェッチも無駄にならない。

全体像は [`examples/router-i18n`](../../examples/router-i18n/)、辞書をリアクティブな state では
なく ES モジュールにした理由は [docs/i18n-design.md](../../docs/i18n-design.md) を参照。

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


