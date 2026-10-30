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

## ルートの本文はどこに置くか

1.32 以降は 2 つの形がどちらも動きますが、交換可能ではありません。プロジェクト単位でなく、ページごとに選びます。

**既定: 本文を `<wcs-route>` の中に置く。** router が入場時にスタンプし、退場時に取り除きます。中の `data-wcs` バインディングはスタンプ時に束ねられる（binder プロトコル）ので、state が描画するマークアップ —— `for:`・`if:`・テキスト —— も他の場所と同じように動きます。router が提供するものはすべてルート本文を基準にしています: ルートごとの `<wcs-head>`、`focus="heading"` / `announce=` ポリシー（*スタンプされた内容の中の*見出しを探す）、ルート切替ごとのビュートランジション。router が state に渡すのはルート本文の要素だけなので、`<wcs-route>` の直下の（要素に包まれていない）テキストの `{{ }}` が束ねられるのは、着地のルートで state の最初の走査が見つけたときだけで、ナビゲーションで入ったときは束ねられません（@wcstack/state 3.x・4.0 とも）。そうしたテキストは要素で包みます（`<p>{{ title }}</p>`）。

```html
<wcs-route path="/products/:productId(int)">
  <wcs-head><title data-wcs="textContent: product.name"></title></wcs-head>
  <article>
    <h2 data-wcs="textContent: product.name"></h2>
    <ul><template data-wcs="for: product.variants"><li data-wcs="textContent: .name"></li></template></ul>
  </article>
</wcs-route>
```

構造のテンプレート（`for:` / `if:`）は、上の `<ul>` のようにルート本文の要素の中に置きます。これは @wcstack/state のどの版でも動きます。`<wcs-route>` の直下に置いたものは、版によって扱いが変わります。

- **@wcstack/state 4.0** は、着地のルートでも、ナビゲーションで入ったルートでも描き、描いた行や枝（`elseif:` / `else:` を含む）はルートと一緒に出入りします。router は state の binder に「ルートの範囲を持ち運ぶ」と宣言して内容を渡し（binder プロトコルの `bind(subtree, { range: true })`）、4.0 はその宣言があるときだけ、内容の直下で渡された構造のテンプレートを描きます。宣言なしで渡されたもの（古い router）は `[wcs/template-syntax]` #204 として報告します。
- **@wcstack/state 3.x** が描くのは、state のページの最初の走査のときだけです（着地のルートで、router がスタンプした後に state が読み込みを終えたとき）。ナビゲーションで入ったルートは内容を state に渡し、3.x は、渡された構造のテンプレートそのものは描かず、束縛の適用の失敗として報告します。3.5.0 までは、`data-wcs` を自分に持つ直下の要素を、テンプレートを含む要素より前に置くこともできません（`<wcs-route>` の直下の `<h2 data-wcs="…">` の後ろに `<ul>` が続く形）。3.5.0 までの 3.x はそうした要素を親から走査して束ねるので、まだ準備のできていない後ろのテンプレートに届き、ナビゲーションのときに同じ失敗を報告します。3.5.1 からは、渡された要素だけを束ねます。上の `<article>` のように本文を 1 つの要素で包めば、どちらも避けられます。

router は、スタンプしたルート本文の終わりにコメントの印 `<!--@@wcs-route-end:<path>-->`（SSR と同じ印）を置き、退場のときにルートの placeholder からこの印までをまとめて持ち出し、次の入場で戻します。ルート自身のノードのほか、その間に後から描かれたもの（直下のテンプレートが描いた行や枝など）も含みます。作者のコードがこの 2 つのコメントの間に差し込んだノードはルートと一緒に出入りします。ルート本文から外へ移したノード（`<body>` へ移したダイアログなど）は、これまでどおり退場のときにルート本文へ戻して持ちます。戻すのは持ち出したものなので、作者のコードがルート本文から取り除いた直下のノード（閉じたお知らせなど）は、次の入場でも戻りません。印はコメントなので、`wcs-outlet:empty` には影響しません。

**例外: ナビゲーションをまたいで DOM を文書に置いたままにしたいときは state で切り替える（`<template data-wcs="if: …">`）。** ルートを離れると本文は文書から外され、入場のときに同じノードが戻されます。ノードが持つもの（入力途中のフォームの値）は残りますが、文書につながっていることが要るものは残りません。再生中の `<video>` は止まり、スクロール済みのリストはスクロール位置を失い（Chromium と WebKit）、`disconnectedCallback` で後始末する部品は初めからやり直します。そうした内容は router の外に置き、router の `routeName` / `typedParams` 出力が立てる state のフラグにバインドし、ルート要素は空（または `<wcs-head>` だけ）にします。

```html
<wcs-router data-wcs="routeName: routeName">
  <template>
    <wcs-route path="/editor" name="editor"><wcs-head><title>Editor</title></wcs-head></wcs-route>
    <wcs-route path="/help" name="help"><wcs-head><title>Help</title></wcs-head></wcs-route>
  </template>
</wcs-router>
<template data-wcs="if: isEditor">
  <my-editor></my-editor>   <!-- /editor → /help → /editor をまたいで DOM を保つ -->
</template>
```

例外の代償: `focus="heading"` は空のルート本文に見出しを見つけられず、ブラウザ既定のリセットにフォールバックします（`announce=` は `document.title` を読むので動きます）。ページに `<wcs-view-transition>` があれば、ビュートランジションはルート切替ではなく state の分岐更新を包みます。`examples/router-spa` は両方を示しています: About ページが既定の形、商品ページが例外の形です。

## リファレンス

### Router(wcs-router)

子要素のtemplateタグ内にルーティング・レイアウトスロット定義する。直下にtemplateタグが必要。定義に従って、**自分のすぐ後の**`<wcs-outlet>`へ出力する(下のOutletを参照)。`basename` が異なれば、同一ドキュメント内に複数の Router を共存可能

| 属性 | 説明 |
|------|------|
| `basename` | サブフォルダのURLでルーティングする場合に、サブフォルダを指定。サブフォルダで動作させない場合は、指定不要。この属性は相対 URL の解決先を変えない — `<wcs-fetch url="api/…">`・`<wcs-state src>`・import map・autoloader の `@components/` — ので、ディープリンクではページの URL の下で解決される。サブフォルダのアプリには `<base href="/subfolder/">` を置く（router の basename にもなる） |
| `focus` | commit したナビゲーション後に適用するオプトインのフォーカスポリシー。`"heading"` でリーフ route 内容の最初の見出しへフォーカス。「アクセシビリティ契約」参照 |
| `announce` | オプトインのルート告知。`"title"` で commit 時点の `document.title` スナップショットを router 保有の live region へ書き込む。「アクセシビリティ契約」参照 |

#### state バインディング（wc-bindable）

`<wcs-router>` は live DOM に居る要素としてナビゲーション状態の全量を wc-bindable プロトコルで露出する。`@wcstack/state`（あるいは任意の binding core）は `data-wcs` 一つで配線できる：

```html
<wcs-router data-wcs="path: path; typedParams: routeParams; searchParams: query;
                      routeName: routeName; data: routeData;
                      navigateUrl: navigateUrl; replaceUrl: replaceUrl">
```

| メンバー | 方向 | 説明 |
|------|------|------|
| `path` | output のみ | 現在のルートパス（basename スライス後）。`wcs-router:path-changed` を発火 |
| `params` | output のみ | マッチしたルートチェーンのマージ済みパラメータ（文字列、`Record<string, string>`）。fallback マッチ・初期化前は `{}` |
| `typedParams` | output のみ | 同パラメータの型変換済み値（`:id(int)` → `number`）。イベントは `params` と共有（detail は `{ params, typedParams }`） |
| `searchParams` | output のみ | 現在 URL のクエリ（`Record<string, string>`）。キー重複（`?tag=a&tag=b`）は **last-wins**、デコードは `URLSearchParams` に委ねる（`+` → 空白を含む）。クエリ無しは `{}`。`wcs-router:search-changed` を発火 |
| `routeName` | output のみ | 最深マッチルートの `name` 属性値。fallback マッチ時は fallback ルートの `name`（404 画面も `routeName` 分岐で書ける）。無名・初期化前は `""`。`wcs-router:route-name-changed` を発火 |
| `data` | output のみ | 現在のナビゲーションの guard 関数がロードしたデータ — `true` の代わりにオブジェクトを返した guard の返り値（[ルート commit 前のデータロード](#ルート-commit-前のデータロード) 参照）。どの guard もオブジェクトを返さなければ `null`（初期化前も `null`）。クエリのみの遷移（same-match）では前の値を保つ。上の各メンバーと違い **frozen にしない** — guard が返したオブジェクトをそのまま露出する。`wcs-router:data-changed` を発火 |
| `navigateUrl` | 書き込み面（null-idle transient） | ターゲットを書くと push 遷移。null は待機、文字列の書き込みで `navigate()` が起動し、完了後に自分で null へ戻る。null / `""` の書き込みは no-op。書くのは**ルートのパス** — basename は router が付ける: リンクの `href` ではなく `/products/3` を書く（basename `/ja` の下で `/ja/products/3` を書くと `/ja/ja/products/3` へ行く） |
| `replaceUrl` | 書き込み面（null-idle transient） | `navigateUrl` と完全同型の契約。ただし現在の履歴エントリを**置き換える** |
| `leaveConfirm` | input（属性 `leave-confirm`） | 空でない文字列の間、**別のルート**へのナビゲーション（リンク・戻る / 進む・`navigate()`）の前に `confirm(leaveConfirm)` を出し、断られたら留まる。**ページを離れる**ナビゲーションのうちページが取り消せるもの（router の `basename` の外へのリンク — 言語を basename に持つページの言語の切り替え — や別のサイトへのリンク、フォームの送信）も、Navigation API があれば同じく聞く（無ければブラウザの確認）。受け入れたらブラウザは聞き直さない。ページを閉じる・読み直すときはブラウザ自身の確認（`beforeunload`）。1 つの切り替えで両方を扱います。読み直しでは失われるがルートの移動では残るもの（ページ直下の要素で進行中のアップロード）だけを守るには、それには `leaveConfirm` を使わず、`$connectedCallback` で自分の `beforeunload` リスナーを足してください。未保存の変更に束ねる: `data-wcs="leaveConfirm: discardPrompt"` と `get discardPrompt() { return this.dirty ? "変更を破棄しますか？" : null; }`。クエリだけの遷移と、確認済みの遷移のリダイレクトでは聞かない。保存のハンドラが同じ更新でこれを外して `navigateUrl` を書いてもよい — router はその更新の後で確かめる。ブラウザがページに取り消させない戻る / 進むでは聞けない。`null` は属性を外す。4.9 から真偽値も受ける: `true` は英語の既定の文言（`Leave this page? Changes you made may not be saved.`。ページの言語で聞くなら文字列を束ねる）で聞き、`false` は聞かない — 以前は値を文言にしていたので、`leaveConfirm: dirty` は遷移のたびに `confirm("false")` を出していた |
| `basename` | input | `basename` 属性に書く。Router はこの属性を初期化のときに一度だけ読むので、それより前に書く（後から書いてもルーティングの基準は変わらない。属性を書き換えたときと同じ）。読むと使われている basename を返す（初期化前は `""`）。`null` は属性を外し、`undefined` は最初の属性へ戻す |

コマンド `navigate(path)` / `replace(path)`（いずれも async）も宣言され、command-token プロトコルから起動できる。

output-only メンバーはバインド attach 時に**読まれ**、以後は変更イベントで流れる — 値は「読むもの」であり「待つもの」ではないので、router が最初のルートを解決した後に attach したバインドでも取りこぼしはない。

**発火規範**: commit されたナビゲーションでは、router はまず**全内部値をコミット**し、その後で `data-changed` → `params-changed` → `route-name-changed` → `search-changed` → `path-changed` の順に、値が実際に変化したものだけを発火する（`data` は同一性比較 — guard は遷移ごとに新しいオブジェクトを返す）。どのイベントのリスナーから要素プロパティを読んでも遷移後スナップショットの一貫した値が見える。`path` は最後に発火し「ナビゲーション完了」の信号を兼ねる。前の 4 つはルートの中身を置く**前**に、`path` は置いた後に発火する。だから新しい中身のバインディングは、最初の評価から新しい params と data を読む。ページに `<wcs-view-transition>` があると、中身はトランジションの更新コールバックの中で 1 フレーム後に置かれるので、`path` はほかの 4 つの 1 フレーム後に来る: そのフレームの間、state の `path` はまだ離れるページ。そこで別の理由で走るコード — 応答、タイマー — が読み手の今いる場所を要るなら、`path` ではなく `routeName` / `params` / `searchParams` か `location` を読む（そのフレームで扱った 401 は、ログインの後に読み手を離れるページへ戻した）。guard 拒否されたナビゲーションでは何も更新せず何も発火しない。

露出オブジェクトは router が所有する **frozen スナップショット**（ナビゲーションごとに新しいオブジェクト、in-place 変異なし）。変異は throw する — 自分の state へコピーして使うこと。唯一の例外が `data` — 所有者は返した guard であり、router はコピーも freeze もしない。

**書き込み面の使い分け**:

- ページネーション・タブ（戻るボタンで戻りたい）→ `navigateUrl = "?page=2"`
- 検索ボックス・絞り込み（履歴を打鍵ごとに汚したくない）→ `replaceUrl = "?q=" + …`（高頻度入力には `<wcs-debounce>` を挟む）

クエリを URL に持つ検索ページが、何も言わずに間違えることが 2 つある:

- **URL が追いつくまでの、読者が打っている文字。** 検索ボックスを URL のクエリ（`searchParams.q`）に束ね、ボックスと `replaceUrl` の間に `<wcs-debounce>` を挟むと、URL は — したがってボックスも — 打鍵より遅れる: 落ち着いた値が URL を書き、router が少し後で commit する。その間、ボックスには古いクエリが書き戻され、打っている指の下で文字が消える。打っている間は打っているものを見せる: ボックス自身の `draft` と `typing` フラグを持ち、フラグは `input` で立て、debounce が落ち着き、その値が URL に入ったら下ろす。URL のクエリを見せるのはフラグが下りているときだけにする（戻る / 進むでもボックスが埋まる）。そして URL は、打たれた値が落ち着いたときにだけ書く: debounce は最初に受けた値でも 1 度落ち着くので、ディープリンク（`/search?q=a&page=2`）ではそれが URL にクエリを書き戻す — `?q=` や、`page` の無い `?q=a` を。
- **件数の読み上げ。** 文（「12 冊見つかりました」）はリクエストの応答から書く — `<wcs-fetch>` の応答のイベント、`eventToken.value: results` と `$on: { results(state, event) { … } }`（[`value` がどの応答か](../fetch/README.ja.md#出力ステートバインド可能な非同期状態)）。getter で `value` と今のクエリから組み立てない: 新しいクエリの要求が進んでいる間も `value` は前の応答のままなので、読み上げの領域は、まず新しい条件と前の件数を言った。領域はルートの内容の外に置く（[アクセシビリティ契約](#アクセシビリティ契約)）。

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
| `path` | トップレベルルートの場合、"/"で始まる絶対パスを指定、それ以外は相対パスを指定。パラメータを指定する場合、`:パラメータ名`。キャッチオールは`*`。トップレベルルートでは相対パスを指定できない。ルートの親は、そのルートを中に持つ `<wcs-route>`。周りの要素や `<wcs-layout>`、前にあるルートでは変わらない。 |
| `index` | 上位のパスを引き継ぐ |
| `fallback` | ルートパスに対応するルートがない場合、表示する |
| `fullpath` | 上位ルートを含むパス、読み取り専用 |
| `name` | 識別用 |
| `guard` | ガード関数が falsy を返したときのリダイレクト先の絶対パス（既定は `/`）。`<wcs-guard-handler>` を持つルートは、この属性が無くてもガードを持つ。JS からハンドラを設定する（`guardHandler`）ルートは、この属性でガードを有効にする |

| プロパティ | 説明 |
|------|------|
| `guardHandler` | ガード判定関数を設定 |

> **`params` / `typedParams` はどこへ？** `<wcs-router>` にある — 「state バインディング（wc-bindable）」参照。パース後の route 要素は detached なコントローラであり live DOM に属さないため、`querySelector` では見つからず `data-wcs` でも結線できない。マッチ結果の観測面は router 要素である。

ガード判定関数の型：

```ts
(toPath: string, fromPath: string, context: IGuardContext) => GuardResult | Promise<GuardResult>

interface IGuardContext {          // 進入先マッチの frozen スナップショット —
  params: Record<string, string>;  // <wcs-router> が commit 後に露出するのと同じ語彙を
  typedParams: Record<string, any>;// commit **前** に読める
  searchParams: Record<string, string>;
  routeName: string;
}
```

| 返り値 | 効果 |
|---|---|
| `true` | 進入する |
| オブジェクト | 進入し、**かつ**そのオブジェクトを `<wcs-router>.data` として commit する（loader — 下記）。チェーン上の複数 guard がオブジェクトを返したときは親→子の順で浅くマージ |
| 空でない文字列 | キャンセルし、その絶対パスへリダイレクト — **動的**なリダイレクト先。`guard` 属性より優先 |
| `false`（その他の falsy: `undefined` / `null` / `""` も同じ） | キャンセルし、`guard` 属性のパスへリダイレクト |

どの形でキャンセルされても、そのナビゲーションは何も commit せず何も発火しない。

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

- ハンドラがあればそれだけでガードが有効になり、そのルートへのナビゲーションはどれも（最初の 1 回も）ハンドラを待つ。`guard` 属性は falsy を返したときのリダイレクト先（既定は `/`）
- 判定関数が `false` を返すとナビゲーションがキャンセルされ、`guard` 属性のパスへ遷移。空でない文字列を返すとそのパスへ遷移（例: `` return `/login?next=${encodeURIComponent(toPath)}` ``）。`toPath` にクエリは含まれない。リダイレクト先に要るなら第 3 引数の `searchParams` から組み直す（`new URLSearchParams(searchParams)`）
- リダイレクトは、キャンセルしたナビゲーションの履歴エントリを**置き換える**。だから「戻る」で守られた URL へ戻る（そしてすぐまたリダイレクトされる）ことはない。リダイレクトはガードの本来の使い方なので、コンソールには何も出さない。ガード同士が送り合うリダイレクトは、続けて 10 回で止め、最後の 1 回を名指すエラーを出す。リダイレクトされたナビゲーションの `navigate()` / `replace()` は `AbortError` で reject する
- モジュールは**一度だけ**評価され、関数はナビゲーションのたびに呼ばれる。変わるもの（セッション）は、モジュールの先頭ではなく関数の中で読む
- ガードから `<wcs-state>` の状態は見えない。ページの読み込みでは、最初のルートのガードが `@wcstack/state` の読み込みより先に走ることもある。セッションは、それを保存している場所 — `<wcs-storage>` が保存する `localStorage` のキー — から直接読む。どのタブでも最新の値になる。`<wcs-storage>` はオブジェクトと配列を JSON で、文字列はそのまま保存する（[JSON 自動シリアライズ](../storage/README.ja.md#json-自動シリアライズ)）: 保存したセッションのオブジェクトは `JSON.parse(localStorage.getItem(key))` で読めるが、保存したトークンの文字列ではそれが例外を投げる — 文字列は `getItem` だけで読む
- 判定関数は `Promise` を返すことも可能（非同期チェック対応）— 解決するまでルートは commit されない
- 第 3 引数に進入先マッチ（`params` / `typedParams` / `searchParams` / `routeName`）が渡る。`toPath` / `fromPath` は basename スライス後のパス
- 中に置いた `<wcs-route>` を守る。その中のどこに置いてもよい — 入れ子のルートの前でも後でも、要素の中でも。親のガードは、子のルートへのナビゲーションでも走る
- どの `<wcs-route>` の外に置いたものも、`console.error`（`[wcs/guard-handler-ignored]`）で報告する。同じ階層で前にルートがあれば、4.3 より前と同じくそのルートを守り続ける — 中へ移すこと。前にルートが無ければ何も守らない
- `<script type="module">` がない場合 — HTML を処理するバンドラが取り去ることがある — guard は動かせず、ルートへのナビゲーションはすべて `guard` のパス（既定 `/`）へリダイレクトする。スクリプトの読み込みに失敗したときと同じ。`console.error`（`[wcs/guard-handler-ignored]`）で報告する。4.6 まではルートを守らずに表示した — `guard` 属性があると、逆に表示しなかった。4.7 から閉じる側に倒す
- **Content-Security-Policy 下では**、ガードスクリプトは `blob:` URL 経由で評価されるため、router を読み込む `<script>` にページの nonce を付けるか（blob: の import がその nonce を引き継ぐ）、`script-src blob:` が必要（blob: の import が失敗すると router は `data:` URL で読み直すので `script-src data:` でも通るが、危険の大きい source なので開けないこと）。ガードはインライン専用で、`<wcs-state>` のような `src=` 退避経路は存在しない。詳細は [docs/csp.ja.md](../../docs/csp.ja.md)
- **`require-trusted-types-for 'script'` 下では**、`<wcs-layout>` のテンプレート展開が `wcstack` という名前の Trusted Types policy を通るため、CSP に `trusted-types wcstack;` が必要（または自前の policy を注入する。詳細は [docs/csp.ja.md](../../docs/csp.ja.md) の §7）

#### ルート commit 前のデータロード

guard は、ルート本文が差し替わる**前**に走る唯一の非同期ステップである。guard から**オブジェクト**を返すと、router はそれを params と一緒に `<wcs-router>.data` として commit する — 新しいルートが空の本文で見えることがなくなり、`<wcs-view-transition>` も空フレームではなく実際の内容をアニメーションする。

```html
<wcs-router data-wcs="data: routeData; typedParams: routeParams">
  <wcs-route path="/users/:id(int)" name="user" guard="/users">
    <wcs-guard-handler>
      <script type="module">
        export default async function (toPath, fromPath, { typedParams }) {
          const res = await fetch(`/api/users/${typedParams.id}`);
          if (res.status === 404) return "/users";          // 動的リダイレクト
          if (!res.ok) return false;                          // → guard="/users"
          return { user: await res.json() };                  // ロード完了: 進入する
        }
      </script>
    </wcs-guard-handler>
    <h1 data-wcs="textContent: routeData.user.name"></h1>
  </wcs-route>
</wcs-router>
```

- guard がオブジェクトを返さないナビゲーションでは `data` は `null` になるので、ページ側で分岐できる（`<template data-wcs="if: routeData">`）
- ネストルート: 各 guard がオブジェクトを返してよく、親→子の順で 1 つの `data` に浅くマージされる
- クエリのみの遷移（same-match）では guard は再実行されず `data` は据え置き
- router はキャッシュしない。同じルートに別 params で遷移すれば再ロードする。再利用したいものは自分の state に持つこと
- SSR では guard 全般と同じ規則 — guard 付きルートチェーンはサーバーで描かないので、`data` は常にクライアントで作られる

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

テンプレートには、名前付きのスロットの外の子（入れ子のルートとそのページ）のための既定の `<slot>`（`name` の無いもの）が要る。無いとそれらは表示されず、outlet が `[wcs/layout-slot-missing]` で警告する（`wcs-validate` も報告する）。テンプレートには `<wcs-outlet>` を置かない: どの router にも使われない（`[wcs/router-outlet-misplaced]`）。入れ子のルートは既定のスロットを埋める。

@wcstack/state と組むと、outlet は置いた要素を、ページに入った後で（テンプレートの読み込みは非同期）state の binder へ渡す。レイアウトのテンプレートと、スロットに入るルートの内容の、要素の中の `data-wcs` / `{{ }}` は、着地のルートだけでなく、ナビゲーションで初めてレイアウトに入ったときから束ねられる。渡すのは要素だけなので、レイアウトのテンプレートの直下の（要素に包まれていない）テキストの `{{ }}` は、ナビゲーションでは束ねられない。ルート本文と同じく要素で包むこと（「ルートの本文はどこに置くか」の節）。`enable-shadow-root` では、テンプレートは outlet の shadow root の中にあり、ページの state は束ねない（light DOM のルートの内容は束ねる）。outlet は、router がルートの本文を渡すのと同じく範囲を宣言して内容を渡す（`bind(subtree, { range: true })`）ので、**@wcstack/state 4.0** と組むと、レイアウトのテンプレートの先頭に置いた `for:` / `if:` のテンプレートも、着地のルートでもナビゲーションでも描かれ、行や枝はルートと一緒に出入りする。@wcstack/state 3.x はナビゲーションではそれを描かない（3.x ではルート本文と同じく要素で包むこと）。

| 属性 | 説明 |
|------|------|
| `layout` | テンプレートとなる`<template>`タグのid属性 |
| `src` | 外部ファイルテンプレートのURL |
| `name` | 識別名、`wcs-layout-outlet`へ引き継がれる |
| `enable-shadow-root` | `<wcs-layout-outlet>`でShadow DOMを使用 |
| `disable-shadow-root` | `<wcs-layout-outlet>`でLight DOMを使用 |

### Outlet(wcs-outlet)

ルーティング・レイアウト設定に従いDOMツリーを表示する。**対応する`<wcs-router>`のすぐ後に置く**(間に空白・テキスト・コメントはあってよいが、別の要素は挟めない)。書かなければ、router がそこに作る。router が使うのは自分のすぐ後の要素だけで、それ以外の場所の`<wcs-outlet>`(router を`<body>`の先頭に置いたときの`<main>`の中や、router の中)は空のままになり、ルートは router のすぐ後に描かれる。router はそういう outlet を実行時に警告し、`wcs-validate`も報告する(`[wcs/router-outlet-misplaced]`)。この規則の経緯: [docs/router-outlet-placement.ja.md](../../docs/router-outlet-placement.ja.md)。

```html
<main>
  <wcs-router><template>…</template></wcs-router>
  <wcs-outlet></wcs-outlet>
  <aside>…</aside>
</main>
```

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
| `to` | 遷移先の絶対ルートパスもしくはURL。`/`で始まる場合はルートパス（basename は pathname にのみ付与され、`?クエリ` / `#ハッシュ` はそのまま温存される）。`?` で始まる場合は**クエリのみリンク**：href は「現在 pathname + 指定クエリ」で組み立てられ、ロケーション変更に追従する。それ以外は外部URLとして扱われる。`to` が空の間（`attr.to:` で束ね、まだ書かれていない — router を state より先に読むページ）は、`<a>` に `href` が無く、active にもならない。`to` が来たらそれを書く |
| `match` | `exact`（既定）か `prefix`。`prefix` なら下のパスでも active になる（サイドナビの「商品」が `/products/3` でも）。そのときの `aria-current` は `"true"`（そのパス自身では `"page"`）。下のパスへのリンクにも印が付く: `/products/new` では `prefix` の「商品」と「新しい商品」の両方が active で、`aria-current` は `"true"` と `"page"`。印を 1 つに見せるなら `[aria-current="page"]` でスタイルを書く。4.11（未リリース）から、クエリのある `prefix` のリンクは、URL のクエリがそのパラメータに加えてほかも持つときも active（`"true"`） |

**アクティブ状態**: 生成された `<a>` はパスが現在のロケーションと一致する場合に `active` クラスと、同じ事実の ARIA 表現である `aria-current="page"` を受け取る（スクリーンリーダーがナビゲーション内の現在地を読み上げられる）。クエリの無い `to` は **pathname だけ**で比べ、ページのクエリは影響しない（`to="/products"` は `/products?page=2` でも active のまま）。4.10 から、クエリのある `to` はクエリも比べる: `to="?q=a&page=2"`（「次のページ」）は `/search?q=a` では現在のページではなく、`/search?q=a&page=2` では現在のページ。4.11（未リリース）から、現在のページになるのは URL のクエリが `to` のクエリと等しいとき — 同じパラメータを同じ値で持つとき（順序は問わない）— だけ: `page` を省いた 1 ページ目へのリンク（`to="?q=a"`、新しい検索のきれいな URL）は `/search?q=a&page=2` では現在のページではない。4.10 はリンクが名指さないパラメータを構わなかったので、このリンクはどのページでも現在のページだった。重複するキー（`?tag=a&tag=b`）は同じ値の組（順序は問わない）が要り、値はデコードして比べる（`+` と `%20` は同じ）。`match="prefix"` なら、クエリのあるリンクは、URL のクエリがそのパラメータに加えてほかも持つときも `aria-current="true"` で active — `?type=book&sort=-year` の上のファセットのリンク `to="?type=book"` — 下のパスで active なのと同じ（そこでもパラメータは要る）。4.9 まではどちら側のクエリも見なかったので、ページのページ送りのリンクがすべて「現在のページ」になり、スクリーンリーダーは「次のページ、現在のページ」と読んだ。ナビゲーションイベント（`currententrychange`, `wcs:navigate`, `popstate`）で更新される — クエリだけのナビゲーションでも。

```css
/* アクティブなリンクのスタイル */
a.active { font-weight: bold; color: blue; }
```

**属性の転送**: `<a>` の生成時に、すべての `aria-*` 属性と固定 7 名（`title` / `rel` / `target` / `download` / `hreflang` / `lang` / `dir`）をホストから anchor へコピーする（`lang` / `dir` はスクリーンリーダーの読み上げ言語・方向に直結する）。`to` / `style` / `class` は決して転送しない（ホストは `display:none` であり、`class` は `active` 契約を持つ）。接続後に追従するのは固定 7 名のみで、**`aria-*` の値は anchor を作るときに 1 度だけコピーされ**、その後の変更は anchor に届かない。`data-wcs` のバインド（`<wcs-link data-wcs="attr.aria-label: ...">`）では、値をいつ書くかで決まる: `for:` の行や `if:` の枝の中の `<wcs-link>` は接続より前に束ねられるので、最初の値は anchor を作るときにホストにあってコピーされる — ただしその値の後の変更は届かない。ページのマークアップの `<wcs-link>` は、state が束ねる前に anchor を持つことがあり、そのとき値は届かない。変わらない `aria-*` は静的属性で書き、変わるリンクの名前は中身で与える: ホストの子は anchor へ移されるので、`<wcs-link>` の中の束ねた `<span data-wcs="textContent: …">` は更新され続ける。

**素の `<a>` について**: Navigation API のあるブラウザでは、basename 配下の素の `<a href="/about">` も SPA 遷移になる（router が intercept する）。フォールバックブラウザでは成立しない（SPA 経路は `<wcs-link>` の click ハンドラのみ）ため、推奨は `<wcs-link>` のまま。4.10 から、素の `<a href="#main">`（フラグメントだけ）はルートの遷移にならず、どちらの経路でも今のページの中で移る — [ページ内リンク](#ページ内リンクスキップリンク)を参照。

**読み直しについて**: 4.7 から、ページが求める読み直し — `location.reload()`・`history.go(0)`・`navigation.reload()` — は文書を読み直す。`leaveConfirm` があればブラウザ自身の確認が出る。4.6 までは router が同じ文書の中のルートの遷移として受けたので、「更新があります — 再読み込み」のボタンも Service Worker の更新も効かなかった。basename 配下のほかのナビゲーションは、`location.replace(location.href)` も含めて SPA の遷移のまま。

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

定義済みの要素（組み込み要素、およびルート描画前に定義されたカスタム要素）では、パラメータは `connectedCallback` の発火前に割り当てられる。未定義のカスタム要素の場合、割り当ては `customElements.whenDefined()` の解決後まで遅延される。この解決はアップグレードの*後*に起こるため、アップグレード時に走る `connectedCallback` ではパラメータはまだ見えない。`props` / `states` / 属性の setter（または `attributeChangedCallback`）で受け取るか、ルート描画前に要素を定義しておく（例: `@wcstack/router` より先にスクリプトを読み込む）こと。パラメータだけが変わるナビゲーション（`/users/1` → `/users/2`）は、ルートの内容を取り出して同じ位置に戻すので、`connectedCallback` がもう一度（入れ子のルートでも 1 回だけ）走り、新しいパラメータが見える。

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

`bootstrapRouter()` は、持っていないオプション、既定値と型の違う値（`null` や、オブジェクトの所の配列を含む）、定義していない `tagNames` のキー、文字列でないタグ名で例外を投げます。当てる前にすべてのオプションを確かめるので、投げたときは何も当てません。値が `undefined` のオプションは飛ばします。

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
- `<wcs-layout>` を使うルートはサーバーで描画されるが、採用されない: クライアントがルートを描き直すので、サーバーのノードは置き換わる — クライアントが読み込まれる前に読者が入力したものは失われる。
- `<wcs-link>` の anchor はサーバーで描画され（`active` / `aria-current` 付き）、クライアントが採用する — `for:` の行や `if:` の枝の中でも。
- `<wcs-head>` はサーバーでは子を持ったままにする（出力は body だけで、サーバーの `<head>` は載らない）: クライアントがルートを採用するときに `document.head` へ反映する。クローラに見せる `<title>` と説明は、出力を包む HTML に書く。

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

### ページ内リンク（スキップリンク）

4.10 から、書いたままの `href` がフラグメントだけのリンク — スキップリンクの `<a href="#main">` と、ページ先頭への `href="#"` — は今のページの中で移り、ルートの遷移にはならない:

```html
<head><base href="/"></head>
<body>
  <a class="skip-link" href="#main">本文へ移動</a>
  <wcs-router>
    <template>
      <wcs-route path="/search"><main id="main">…</main></wcs-route>
      …
    </template>
  </wcs-router>
```

- URL は今のパスとクエリ＋そのハッシュ（`/search?q=a#main`）になり、どのフラグメントのリンクとも同じく履歴が 1 つ増える（同じフラグメントをもう一度押すと置き換える）。ブラウザが行き先 — その `id` を持つ要素、または `<a name>` — へスクロールし、router がそこへフォーカスを移す。自分でフォーカスを受けない要素には、`focus="heading"` と同じく `tabindex="-1"` を足す。`#` と `#top` は先頭へスクロールし、フォーカスは動かさない。
- ルートは何も変わらない: guard は走らず、描き直しも無く、`leaveConfirm` も聞かない。2 つの履歴の間の戻る / 進むもフラグメントのナビゲーションで、ルートはそのまま、スクロール位置はブラウザが戻す。
- 理由: SPA なら必ずある `<base href="/">` の下では、`#main` は `/#main` へ解決される。だから 4.9 までは、`/search?q=a` のスキップリンクで読者はホームのルートへ移った（`<base href="/ja/">` の下では `/ja/` へ）。
- どちらの経路でも動く。Navigation API があれば、router は `navigate` イベントからリンクを読む（`sourceElement`。今の Chromium・Firefox・Safari は持つ）。無いとき、またはイベントに `sourceElement` が無いときは `window` で click を聞く — ページ自身のリスナーより後なので、ページが取り消したクリックには触らない。
- 変わらないもの: 修飾キー（Ctrl / ⌘ / Shift / Alt）付きや中ボタンのクリック、`_self` 以外の `target` や `download` を持つリンク、別のページのフラグメントへのリンク（`/faq#x`・`?q=b#x`）、どの router の `basename` の下でもないページ。

### router がページに任せること

- **ナビゲーションの後に聞かせたい知らせは、ルートの内容に置かない。** ルートの内容は文と一緒に挿入されるので、その中の `role="status"` / `aria-live` の領域は知らせを持ったまま現れる。スクリーンリーダーが読み上げるのは、すでに知っている領域の変化なので、その知らせは決して読まれない。`<wcs-view-transition>` があると、ルートを置いた後に応答で埋めた領域でさえ、文と一緒に挿入されうる（差し替えが遷移の中で走る）。領域はページに 1 つ、router とその `<wcs-outlet>` の外に置く。ナビゲーションの commit で空にし（router の `path` への `$watch`）、新しいページの文はその後、ページが言うことを持ったときに書く。ページのタイトルなら `announce="title"` が router 自身の領域でそうする。

  ```html
  <wcs-router data-wcs="path: route"><template>…</template></wcs-router>
  <wcs-outlet></wcs-outlet>
  <p class="visually-hidden" role="status" data-wcs="textContent: status"></p>
  ```

  ```js
  $eventTokens: ["results"],
  $watch: {
    route() { this.status = ""; },              // ナビゲーションで空にし…
  },
  $on: {
    results(state, event) {                     // …新しいページは言うことを持ったときに書く
      state.status = `${event.detail.value.length} 冊見つかりました`;
    },
  },
  ```

- **ダイアログを閉じた後のフォーカス。** モーダルの `<dialog>` は、閉じると開いた要素へフォーカスを返す。その要素がもう無いとき — ダイアログが、開いたボタンのあった行を消した — フォーカスは `<body>` へ落ち、キーボードやスクリーンリーダーの読者はページの先頭からやり直すことになる。そういう削除の後は自分で移す — リストかその見出しへ: `<h2 tabindex="-1" data-wcs="command.focus: $command.focusList">` と、行が消えた後の `this.$command.focusList.emit()`（ネイティブ要素の `command.` のメソッドは `native-commands` アドオンにあり、full のエントリに入っている）。

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
3. どちらも無い場合、`document.baseURI` は現在のドキュメント URL なので basename は `location.pathname` から導出される。**空文字** `""` になるのはドキュメント自体がルートで読み込まれた場合だけで、`/products/3` を直接開けば basename は `/products/3` になる。深いリンクを成立させるには `<base href="/">` か `basename` 属性が必要。こうして導いた basename が空でなければ、router は `[wcs/base-href-missing]` で警告する（`wcs-validate` がマークアップから報告するのと同じ code）

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

この切り替えはページを離れるので、`leaveConfirm` があれば先に聞く — そしてページには、
読者が受け入れたかが分からない: click のリスナーは質問より先に走り、断られた切り替えは
前の言語のままページに留まる。選んだ言語は、クリックではなく次のページで記録する:
クリックでは `sessionStorage` に印を付け、次のページの head スクリプトが、URL がその言語を
持つときに（`localStorage` へ）確定し、そうでなければ印を捨てる。

副産物が 2 つある。

* **ルートパターンからロケールが消える** —— `path="/"`・`path="/about"`。アプリ内リンクも
  ロケールを持たない（`<wcs-link to="/about">` が basename を前置する）
* **ページ上の URL をすべて絶対にする**こと。`<base>` が相対 URL の基準を変えるため。
  4.10 から、フラグメントだけのリンク（`href="#main"`）は例外で、router が
  今のページに留める（[ページ内リンク](#ページ内リンクスキップリンク)）。インライン SVG の
  フラグメント参照（`url(#gradient)`・`clip-path`）はリンクではないので、base 基準のまま

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


