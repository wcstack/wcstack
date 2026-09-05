# @wcstack/state

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

**これは便利な既存FWの別実装ではありません。フロントエンド開発の前提を組み替える、別系譜の試みです。**

多くのライブラリは、UI・状態・コンポーネントの結合点を JavaScript の中に置きます。`@wcstack/state` はそこを選びません。仮想DOMも、コンパイルも、hook も、selector も前提にせず、HTML とパス文字列だけを契約として UI と状態を結びつけます。

それが `<wcs-state>` と `data-wcs` のアプローチです。CDNからの読み込みだけで動作し、依存パッケージはゼロ、構文はHTMLそのままです。CDNのスクリプトはカスタム要素の定義を登録するだけで、ロード時にはそれ以外の処理は走りません。`<wcs-state>` 要素がDOMに接続されたときにはじめて、状態ソースを読み取り、同一ルートノード（`document` または `ShadowRoot`）内の `data-wcs` バインディングを走査してリアクティビティを構築します。初期化プロセスはすべて要素のライフサイクルによって駆動されるため、独自の初期化コードを書く必要はありません。

## ここには存在しないもの

以下は未実装ではありません。**設計上、存在しません。**

- 変数を取り出す API
- 要素ごとに状態を束縛するオブジェクト
- hook（`useState` / `useStore` 系。`$connectedCallback` などのライフサイクルコールバックはこれに当たりません）
- selector
- reactive primitive をコンポーネントへ引き込むための glue code

これらはどれも、設計上存在しません。

なぜなら、このライブラリでは UI と状態の結合点を JavaScript の中に置かないからです。状態を「取り出して」コンポーネントへ渡すのではなく、HTML 側がパス文字列によって状態を参照します。要素は状態を所有せず、状態も要素を知りません。両者が共有するのはパスだけです。

## 位置づけ — 選ぶとき・選ばないとき

これは React / Vue / Solid の別構文ではありません。あちらは UI と状態の結合点をコンポーネントの中に置き、こちらはパス文字列に置きます。**前提自体が違う**ので、比較は正しい軸で行ったときにだけ意味を持ちます。

| コンポーネント型 FW が前提にするもの | `@wcstack/state` が前提にするもの |
|---|---|
| コンポーネントが UI と状態の結合点 | パス文字列が UI と状態の結合点 |
| JavaScript が描画の中心 | HTML と DOM が中心 |
| state を取り出して component へ流し込む | path を宣言して DOM を状態へ接続する |
| hook / selector / signal で購読する | 属性とパスで束縛する |
| フレームワークの実行モデルにアプリ全体を載せる | ブラウザ標準の上に薄い reactive layer を足す |

より近い親戚は **属性ディレクティブ型・ビルド不要のライブラリ** — Alpine.js や petite-vue の系統です。前提（素の HTML への属性・コンパイラ不要）は共有しつつ、選択を分ける違いが 2 つあります。

- **式言語を持たない。** それらは属性に JavaScript 式を書き、実行時に評価します。`data-wcs` に載るのはパスとフィルタチェーンだけで、計算は state 側のパス getter に置きます。バインディングを静的に検査できる（`@wcstack/lint`・VS Code 拡張・`@wcstack/typescript`）のも、`unsafe-eval` なしの厳格な CSP で動く（[docs/csp.ja.md](../../docs/csp.ja.md)）のも、この選択の帰結です。
- **Web Components 同士を配線する。** wc-bindable・command-token・event-token の各プロトコルと `bind-component` マウントが、互いを import しない要素同士を接続します。[I/O ノード群](../../README.ja.md#追加パッケージ)はその上に成り立っています。

**選ぶとき**: HTML が主役のページ — サーバー描画や静的なマークアップにリアクティブな部分を足す、カスタム要素を組み合わせてページを作る、「HTML を読めばデータ依存が全部わかる」ことに価値があり、ビルド工程が前提ではなくコストであるとき。

**選ばないとき**: チームが既にコンポーネント型 FW の中で暮らしている — I/O ノードは[フレームワークアダプタ](../../docs/framework-adapter-integration.ja.md)経由で使ってください。ホットパスが巨大な keyed リスト — [パフォーマンス](#パフォーマンス)節の計測では生成・追加が [`@wcstack/signals`](../signals/) の 2.5〜3.5 倍で、相互運用できる signals のほうが適任です。テンプレートに式を書きたい — 意図的に存在しません。テンプレートの型検査をツールではなくコンパイラに求める — パスは文字列で、`@wcstack/typescript` は差を縮めますが埋めはしません。

この軸に乗せれば比較は具体的になります。下の[パフォーマンス](#パフォーマンス)節がその一例で、`e2e/bench/` のドライバで手元のハードウェアでも再現できます。

## 第一原理: パスが唯一の契約

既存の多くのフレームワークでは、**コンポーネント**がUIと状態の結合点になっています。状態ストアを外部に切り出しても、コンポーネント内にフックやセレクタ、リアクティブプリミティブといった**状態を引き込むためのコード**が必ず必要になります。つまり、UIと状態は常にJavaScriptの中で結びついているのです。

`@wcstack/state` はこの結合を完全に排除しました。UIと状態を結びつけているのは**パス文字列**だけです — `user.name` や `cart.items.*.subtotal` のようなドット区切りのアドレスのみが、2つのレイヤー間の唯一の契約（コントラクト）になります:

| レイヤー | 知っていること | 知らないこと |
|----------|----------------|--------------|
| **状態** (`<wcs-state>`) | データ構造とビジネスロジック | どのDOM要素がバインドされているか |
| **UI** (`data-wcs`) | パス文字列と表示意図 | 状態がどう保存・算出されているか |
| **コンポーネント** (`state: path`) | ホストが書くマウント表 | 他コンポーネントの内部実装 |

3つのレベルのパス契約が疎結合を実現しています:

1. **UI ↔ 状態** — `data-wcs="textContent: user.name"` という属性がバインディングのすべてです。フックもセレクタもリアクティブプリミティブもありません。コンポーネントのJavaScriptには、状態を参照するコードが**一行も**必要ありません。

2. **コンポーネント ↔ コンポーネント** — ホストが各コンポーネントへ部分木をマウントし（`<my-card data-wcs="state: user">`）、ボリュームが追加モジュールをツリーに接ぎ木します（`<wcs-state mount="i18n">`）。コンポーネント同士がお互いを直接インポートしたり参照したりすることはありません。すべての接続は単一ツリー上のパス接頭辞だけです。

3. **ループコンテキスト** — `for` ループ内では `*` が抽象インデックスとして機能します。`items.*.price` のようなバインディングは自動的に現在の要素へと解決されます。テンプレートは自身の具体的な位置（インデックス）を知る必要がなく、ワイルドカードがその契約となります。

### なぜこれが重要なのか

これはUIと状態の完全な分離を、**JavaScriptのコードを介することなく**実現していることを意味します。つまり:

- UIをすべて作り直しても、状態のロジックに触れる必要がありません。
- 状態のデータ構造をリファクタリングしても、パス文字列の更新だけで済みます。
- HTMLを読むだけで、すべてのデータ依存関係を把握できます。

このパスによる契約は、REST APIのURLと同じ発想です — 両者が合意するシンプルな文字列だけが存在し、そこに共有するコードはありません。これはJavaScriptの上に独自のテンプレート言語を発明するのではなく、HTML本来の宣言的な性質をフルに活かした結果として生まれた設計です。

以下の機能はすべて、この原理の帰結です。機能が先にあり、その説明として哲学を後付けしているのではありません。

## わずか4ステップで動作

```html
<!-- 1. CDN を読み込む -->
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>

<!-- 2. <wcs-state> タグを書く -->
<wcs-state>
  <!-- 3. 状態オブジェクトを定義する -->
  <script type="module">
    export default {
      message: "Hello, World!"
    };
  </script>
</wcs-state>

<!-- 4. data-wcs 属性でバインドする -->
<div data-wcs="textContent: message"></div>
```

これだけです。ビルドツールも、初期化コードも、重いフレームワークも必要ありません。

## この原理から導かれる機能

- **宣言的データバインディング** — `data-wcs` 属性によるプロパティ / テキスト / イベント / 構造バインディング
- **リアクティブ Proxy** — ES Proxy による依存追跡付き自動 DOM 更新
- **構造ディレクティブ** — `<template>` 要素による `for`, `if` / `elseif` / `else`
- **ボリューム** — `<wcs-state mount="cart">` がモジュールを 1 本の state ツリーに接ぎ木し、バインディングは `cart.…` で読む
- **行の同一性** — `$listKeys` が再取得した配列でも行の DOM と行オブジェクトを保つ
- **ワイルドカード集計** — `$getAll` / `$setAll` が配列を作り直さずに `items.*.price` を横断して読み書きする
- **組み込みフィルタ** — フォーマット、比較、算術、日付など 46 種類
- **双方向バインディング** — `<input>`, `<select>`, `<textarea>` で自動有効
- **Web Component バインディング** — Shadow DOM コンポーネントとの双方向状態バインディング
- **command token** — pub/sub チャネル（`command.<method>: tokenName`）で state から wc-bindable カスタム要素のメソッドを起動
- **event token** — command token の双対。wc-bindable 要素が dispatch するイベントを `eventToken.<prop>: tokenName` + `$on` マップで state が受信
- **stream** — `$streams` 宣言で連続的な非同期フロー（async iterable / `ReadableStream`）を fold して reactive プロパティ化。switchMap 型の依存駆動 restart 付き
- **パス getter** — ドットパスキー getter（`get "users.*.fullName"()`）によるデータツリーの任意の深さへのフラットな仮想プロパティ定義、自動依存追跡・キャッシュ
- **Mustache 構文** — テキストノードでの `{{ path|filter }}`
- **複数の状態ソース** — JSON, JS モジュール, インラインスクリプト, API, 属性
- **SVG サポート** — `<svg>` 要素内でのフルバインディング対応
- **ライフサイクルフック** — `$connectedCallback` / `$disconnectedCallback` / `$updatedCallback`、Web Component 用 `$stateReadyCallback`
- **headless な watch** — `$watch` はパスが描画されていてもいなくても state の変化で発火する
- **診断** — 解決しないパス・添字の本数・getter の循環を `@wcstack/lint`・VS Code 拡張と同じ診断 code で報告する
- **TypeScript サポート** — `defineState()` によるドットパス自動補完付き型付き状態定義（[詳細](docs/define-state.ja.md)）。`@wcstack/typescript` は同じ型を HTML の検証器へ運び（`wcs-schema`）、インライン state スクリプトを型検査する（`wcs-tsc`）— [docs/typescript.ja.md](../../docs/typescript.ja.md)
- **サーバーサイドレンダリング** — `enable-ssr` 属性 + `@wcstack/server` でフル SSR と自動ハイドレーション
- **依存ゼロ** — ランタイム依存なし

## インストール

### CDN（推奨）

```html
<!-- 自動初期化 — これだけで動作します -->
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
```

### CDN（手動初期化）

```html
<script type="module">
  import { bootstrapState } from 'https://esm.run/@wcstack/state';
  bootstrapState();
</script>
```

## 基本的な使い方

```html
<wcs-state>
  <script type="module">
    export default {
      count: 0,
      user: { id: 1, name: "Alice" },
      users: [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
        { id: 3, name: "Charlie" }
      ],
      countUp() { this.count += 1; },
      clearCount() { this.count = 0; },
      get "users.*.displayName"() {
        return this["users.*.name"] + " (ID: " + this["users.*.id"] + ")";
      }
    };
  </script>
</wcs-state>

<!-- テキストバインディング -->
<div data-wcs="textContent: count"></div>
{{ count }}

<!-- 双方向入力バインディング -->
<input type="text" data-wcs="value: user.name">

<!-- イベントバインディング -->
<button data-wcs="onclick: countUp">Increment</button>

<!-- 条件付きクラス -->
<div data-wcs="textContent: count; class.over: count|gt(10)"></div>

<!-- ループ -->
<template data-wcs="for: users">
  <div>
    <span data-wcs="textContent: .id"></span>:
    <span data-wcs="textContent: .displayName"></span>
  </div>
</template>

<!-- 条件分岐レンダリング -->
<template data-wcs="if: count|gt(0)">
  <p>カウントは正の値です。</p>
</template>
<template data-wcs="elseif: count|lt(0)">
  <p>カウントは負の値です。</p>
</template>
<template data-wcs="else:">
  <p>カウントはゼロです。</p>
</template>
```

## 状態の初期化

`<wcs-state>` は複数の方法で初期状態を読み込めます：

```html
<!-- 1. <script type="application/json"> を id で参照 -->
<script type="application/json" id="state">
  { "count": 0 }
</script>
<wcs-state state="state"></wcs-state>

<!-- 2. インライン JSON 属性 -->
<wcs-state json='{ "count": 0 }'></wcs-state>

<!-- 3. 外部 JSON ファイル -->
<wcs-state src="./data.json"></wcs-state>

<!-- 4. 外部 JS モジュール (export default { ... }) -->
<wcs-state src="./state.js"></wcs-state>

<!-- 5. インラインスクリプトモジュール -->
<wcs-state>
  <script type="module">
    export default { count: 0 };
  </script>
</wcs-state>

<!-- 6. プログラム API -->
<script>
  const el = document.createElement('wcs-state');
  el.setInitialState({ count: 0 });
  document.body.appendChild(el);
</script>
```

解決順序: `state` → `src` (.json / .js) → `json` → 内包 `<script>` → `setInitialState()` 待機。

> **Content-Security-Policy 下では:** 5 番（内包 `<script type="module">`）は `blob:` URL 経由で評価されるため `script-src blob:` が必要です。ページの nonce では救えません。厳格な CSP を敷く場合は 4 番（`src="./state.js"`）を使ってください。追加ディレクティブは不要です。詳細は [docs/csp.ja.md](../../docs/csp.ja.md)。

### 追加の状態をマウントする（`mount=`）

状態のツリーは **1 つの root に 1 本**です。状態をモジュールに分けたい場合はボリュームをマウントします。データはマウントパスの位置でルートツリーに接ぎ木され、バインディングは接頭辞付きのパスで読みます。

```html
<wcs-state mount="cart" src="./cart.js"></wcs-state>
<wcs-state src="./app.js"></wcs-state>

<div data-wcs="textContent: cart.total"></div>
```

ボリュームは getter・`$watch`・`$listKeys`・`$updatedCallback`・`$connectedCallback`/`$disconnectedCallback` を宣言できます（すべてマウントパス相対）。読み込み順は自由です（ルートより先に接続されたボリュームは、ルートの登録時に接ぎ木されます）。マウントパスは静的パスのみです（`*`・`$`・`#`・`@` は不可）。初期化後に `mount` 属性を変更することはできません — 変更は console 警告付きで無視されます。要素を取り除き、望むパスで新しい要素を追加してください。

> **v1 の名前付き状態からの移行:** `<wcs-state name="cart">` + `total@cart` は `<wcs-state mount="cart">` + `cart.total` になります。v2 では `name` 属性は fail-fast し、パス中の `@` は parse error です（どちらもこの誘導文付き）。移行の対応表: [docs/state-mount-design.md](../../docs/state-mount-design.md) §9。

## 状態の更新

`@wcstack/state` では、すべての状態は**パス**を持ちます — `count`、`user.name`、`items` のように。状態をリアクティブに更新するには、**パスに代入**します:

```javascript
this.count = 10;               // パス "count"
this["user.name"] = "Bob";     // パス "user.name"
```

ルールは1つだけです。**「パスに直接代入する」ことで、関連するDOMが自動的に更新されます。**

### なぜ `this.user.name = "Bob"` ではDOMが更新されないのか

これは単なる制約ではなく、**契約境界が見えている箇所**です。

通常のプロパティアクセスの書き方だと、まず `this.user` でプレーンな `user` オブジェクトを読み取り（パスの読み取り）、取得したオブジェクトの `.name` を直接書き換える挙動になります。これは「パスに対するプロパティ代入」という契約を通っていません。そのため、システム側は変更を検知しません：

```javascript
// ✅ パスへの代入 — 変更が検知される
this["user.name"] = "Bob";

// ❌ パスへの代入ではない — 変更は検知されない
this.user.name = "Bob";
```

`this.user.name = "Bob"` も動くようにすると、一見便利にはなります。しかしその瞬間に「UI と状態はパスだけで結ばれる」という原理が崩れます。どこで依存を追跡し、どこで更新を確定するかが曖昧になり、契約境界が失われます。

### 配列

配列についても全く同じルールが適用されます。常に**パスに対して新しい配列を代入**してください。`push` や `splice`、`sort` などの破壊的な配列メソッドは、パスへの代入を介さずに状態をその場で（in-placeに）書き換えてしまうため、変更が検知されません。代わりに、新しい配列を返す非破壊的なメソッドを使用します：

```javascript
// ✅ 新しい配列をパスに代入 — 変更が検知される
this.items = this.items.concat({ id: 4, text: "New" });
this.items = this.items.toSpliced(index, 1);
this.items = this.items.filter(item => !item.done);
this.items = this.items.toSorted((a, b) => a.id - b.id);
this.items = this.items.toReversed();
this.items = this.items.with(index, newValue);

// ❌ その場での変更 — パスへの代入なし、変更は検知されない
this.items.push({ id: 4, text: "New" });
this.items.splice(index, 1);
this.items.sort((a, b) => a.id - b.id);
```

## バインディング構文

### `data-wcs` 属性

```
property[#modifier]: path[|filter[|filter(args)...]]
```

複数バインディングは `;` で区切ります：

```html
<div data-wcs="textContent: count; class.over: count|gt(10)"></div>
```

| 要素 | 説明 | 例 |
|---|---|---|
| `property` | バインドする DOM プロパティ | `value`, `textContent`, `checked` |
| `#modifier` | バインディング修飾子 | `#ro`, `#prevent`, `#stop`, `#onchange` |
| `path` | 状態プロパティパス | `count`, `user.name`, `users.*.name` |
| `\|filter` | 変換フィルタチェーン | `\|gt(0)`, `\|round\|locale` |

### プロパティ種別

| プロパティ | 説明 |
|---|---|
| `value` | 要素の値（input では双方向） |
| `checked` | チェックボックス / ラジオボタンの選択状態（双方向） |
| `textContent` | テキストコンテンツ |
| `text` | textContent のエイリアス |
| `html` | innerHTML |
| `class.NAME` | CSS クラスの切り替え |
| `style.PROP` | CSS スタイルプロパティの設定 |
| `attr.NAME` | 属性の設定（SVG 名前空間対応） |
| `radio` | ラジオボタングループバインディング（双方向） |
| `checkbox` | チェックボックスグループの配列バインディング（双方向） |
| `onclick`, `on*` | イベントハンドラバインディング |

### 修飾子

| 修飾子 | 説明 |
|---|---|
| `#ro` | 読み取り専用 — 双方向バインディングを無効化 |
| `#prevent` | イベントハンドラで `event.preventDefault()` を呼び出す |
| `#stop` | イベントハンドラで `event.stopPropagation()` を呼び出す |
| `#onchange` | 双方向バインディングで `input` の代わりに `change` イベントを使用 |
| `#init=<authority>` | バインディングの authority / 初期同期の向き — [バインディング authority](#バインディング-authority-init--sync) 参照 |
| `#sync=<timing>` | 要素スナップショットの読み取りタイミング — [バインディング authority](#バインディング-authority-init--sync) 参照 |

複数の修飾子は 1 つの `#` の後にカンマ区切りで書きます: `value#ro,init=none: path`

### 双方向バインディング

以下の要素で自動的に有効化されます：

| 要素 | プロパティ | イベント |
|---|---|---|
| `<input type="checkbox/radio">` | `checked` | `input` |
| `<input>`（その他の type） | `value`, `valueAsNumber`, `valueAsDate` | `input` |
| `<select>` | `value` | `change` |
| `<textarea>` | `value` | `input` |

`<input type="button">` は除外されます。`#ro` で無効化、`#onchange` でイベントを変更できます。

### バインディング authority (`#init=` / `#sync=`)

`static wcBindable` を宣言したカスタム要素への prop バインディングは、**authority**（バインディング attach 時の**初期同期**をどちら側が勝つか）を解決します。定常時の方向は authority とは別に、メンバの宣言形状で決まります: output-only メンバは state からの書き込みを恒久的に受け付けず（契約）、双方向メンバは初期同期の勝者と無関係に以後は両方向に流れます。既定 authority はメンバの宣言位置から導出されます（`enableDirectionalInitialSync` で既定 ON）：

| メンバの宣言位置 | 既定 authority | 効果 |
|---|---|---|
| `properties` のみ（output-only） | `element` | 要素の値が state に流れる。**state からこのメンバへは書き込まれない** |
| `inputs` のみ | `state` | state が要素に書き込む |
| `properties` + `inputs`（双方向） | `state` | 従来挙動 — state が先に書き、以後は要素イベントが state を更新 |
| —（`wcBindable` 非宣言・素の HTML 要素） | `state` | 従来と不変 |

> **作法：** settable なメンバは **`properties` と `inputs` の両方**に宣言してください。`properties` にしか宣言されていないメンバは output-only 扱いになり、state→element 書き込みがバインディングの生存期間ずっと抑止され、要素側の初期値が state 側のシード値を上書きします（`@wcstack` の I/O ノード Shell と DCC の `$bindables` はこの作法に従っています）。

authority はバインディング単位で `#init=` により上書きできます：

| 値 | 初期同期 | 使える宣言 |
|---|---|---|
| `init=state` | state の値を要素へ書く（双方向の既定） | inputs のみ・双方向 |
| `init=element` | 要素のスナップショットを state へ入れる — 双方向メンバではその後は通常の双方向に戻る（次の変更から state→element も流れる） | output-only・双方向 |
| `init=auto` | state スロットが未初期化なら `element`、それ以外は `state` | 双方向 |
| `init=none` | 初期同期なし — 次の変更から通常どおり流れる（event バインディングはこの値のみ許可） | すべて |

`#init=` が決めるのは初期競合の勝者だけです。state→element 書き込みの**恒久**抑止は「メンバが output-only 宣言であること」から来るのであって、修飾子からは来ません。これにより `#init=element`（または `#init=auto`）が **load-before-bind** の宣言的な解になります: 要素が自身の `connectedCallback` で永続値をロード済み（バインディング確立より先）でも state 初期値に潰されず、以後の state 変更は要素へ届きます（例えば `<wcs-storage>` の保存は生き続けます）：

```html
<!-- 永続化済みリストが todos を初期化し、以後の todos 代入は保存もされる -->
<wcs-storage key="todos" type="local" data-wcs="value#init=element: todos"></wcs-storage>
```

`#sync=` は element authority のバインディングで要素スナップショットを**いつ**読むかを制御します：

| 値 | 意味 |
|---|---|
| `sync=call`（既定） | バインディングの attach 時に即読み取り |
| `sync=connect` | 要素が document に接続されるまで読み取りを保留 |

```html
<x-clock  data-wcs="value#init=element: clock.now"></x-clock>
<x-input  data-wcs="value#init=auto: form.name"></x-input>
<x-widget data-wcs="value#init=element,sync=connect: widget.snapshot"></x-widget>
```

`sync=connect` では、接続時スナップショットが初期競合を解決するまで state→element 書き込みも保留されます。

注意：

- `enableDirectionalInitialSync: false`（opt-out）のとき `#init=`/`#sync=` を書くと throw します。
- **1.20 以前からの移行：** output-only メンバに対して state 側に都合のよい初期値（`value: []`、`query: ""` 等）をシードしないでください — 要素側の実初期値（多くは `null`/`undefined`）がシードを置き換えます。シードは要素の実初期値に合わせ、表示用の値は派生 getter で null ガードしてください。
- **1.21.x まで**、`init=element` / `init=auto` / `init=none` はバインディングの生存期間全体で state→element 書き込みを抑止しており、真に双方向なメンバには使えませんでした。現在は authority は初期同期のみを支配します（`docs/architecture-hardening/09-remediation-design.ja.md` §3.6）。

### ラジオボタンバインディング

`radio` でラジオボタングループを単一の状態値にバインドします：

```html
<input type="radio" value="red" data-wcs="radio: selectedColor">
<input type="radio" value="blue" data-wcs="radio: selectedColor">
```

状態値と一致する `value` を持つラジオボタンが自動的にチェックされます。ユーザーが別のラジオボタンを選択すると、状態が更新されます。`#ro` で読み取り専用にできます。

`for` ループ内での使用：

```html
<template data-wcs="for: branches">
  <label>
    <input type="radio" data-wcs="value: .; radio: currentBranch">
    {{ . }}
  </label>
</template>
```

### チェックボックスバインディング

`checkbox` でチェックボックスグループを状態配列にバインドします：

```html
<input type="checkbox" value="apple" data-wcs="checkbox: selectedFruits">
<input type="checkbox" value="banana" data-wcs="checkbox: selectedFruits">
<input type="checkbox" value="orange" data-wcs="checkbox: selectedFruits">
```

チェックボックスの `value` が状態配列に含まれている場合にチェック状態になります。チェックボックスの切り替えで配列への値の追加・削除が行われます。`|int` で文字列値を数値に変換、`#ro` で読み取り専用にできます。

### Mustache 構文

`enableMustache` が `true`（デフォルト）の場合、テキストノードで `{{ expression }}` が使用できます：

```html
<p>こんにちは、{{ user.name }}さん！</p>
<p>カウント: {{ count|locale }}</p>
```

内部的にはコメントベースのバインディング（`<!--@@:expression-->`）に変換されます。

### Spread バインディング (`...`)

`wc-bindable` プロトコルを宣言したカスタム要素に対して、`...: target` を使うと要素の **properties + inputs を 1 行で一括配線**できます：

```html
<wcs-fetch data-wcs="...: usersFetch"></wcs-fetch>
```

```js
export default {
  usersFetch: {
    url: "/api/users",
    method: "GET",
    value: null,
    loading: false,
    error: null,
    status: null,
  }
}
```

ランタイムが `customClass.wcBindable.properties + inputs` を読み取り、各 name を個別バインディング（`usersFetch.value`、`usersFetch.url`、...）に展開します。

**対象範囲**：spread は *データサーフェス*（properties + inputs）のみを対象とします。`commands` や event token は **対象外** — pub/sub の発火点が HTML から読めるように、明示配線を維持してください。

**for ループ内**：`...: items.*`（推奨）または dot ショートカット `...: .` を使います：

```html
<template data-wcs="for: storesFetches">
  <wcs-fetch data-wcs="...: storesFetches.*"></wcs-fetch>
</template>
```

**後勝ち上書き** — spread の後ろに同名 prop を書くと、明示側が優先されます：

```html
<wcs-fetch data-wcs="...: usersFetch; status: alternateStatus"></wcs-fetch>
```

**`undefined` は「無意見」** — 展開された state パスが `undefined` に解決される場合（slot オブジェクトでその input を初期化していない場合など）、プロパティ書き込みは**スキップ**され、要素側の既定値がそのまま生きます。実際に使うパスだけ初期化すれば十分で、`<wcs-fetch>` が `method` / `manual` / `body` を宣言していても `usersFetch: { value: null, loading: false }` だけで動きます。明示的にクリアしたい場合は `null` を代入してください（`null` は常に書き込まれます）。このスキップは spread に限らずすべてのプロパティバインディングに適用され、`config.debug` 時はスキップごとに `console.debug` でログが出ます。

**制約事項**：

- spread 右辺へのフィルタ（`...: target|filter`）はエラー
- 右辺パスの途中に `*` を含めても OK（例：`...: stores.*.fetch`）
- 右辺は素のツリーパス（`...: fetchX`、途中の `*` も可）
- カスタム要素クラスが未登録の場合、`customElements.whenDefined(tag)` 解決時に遅延展開される（autoloader による遅延ロードに対応）
- `wcBindable` 宣言**のない**要素はエラー（明示配線で書いてください）。spread は何を展開すべきかを契約から読み取るため

**Composite shell**（wc-bindable Composition Profile）はそのままサポートされます：composite shell は標準の `target.constructor.wcBindable` を通じて synthesized declaration を露出するため、`"s3.progress"` のような composed name はフラットな要素メンバーキーとして扱われます。state を composed 構造に合わせて (`{ s3: { progress: 0 } }`) 持てば、`...: pipeline` が自動的に nested state path へ展開されます。

## 構造ディレクティブ

構造ディレクティブは `<template>` 要素で使用します：

### ループ (`for`)

```html
<template data-wcs="for: users">
  <div>
    <!-- フルパス -->
    <span data-wcs="textContent: users.*.name"></span>
    <!-- 省略形（ループコンテキストからの相対パス） -->
    <span data-wcs="textContent: .name"></span>
  </div>
</template>
```

`for:` ディレクティブは**値ベースの差分アルゴリズム**を使用します。配列の各要素の値そのものが識別キーとして機能します。配列が再代入されると、差分アルゴリズムが新旧の要素を値で照合し、変更のない要素の DOM ノードを再利用しつつ、追加・削除・並び替えを効率的に処理します。

つまり、**行オブジェクトの参照さえ保たれていれば、行の追加・削除・並べ替えに明示的なキー属性（React の `key` や Vue の `:key`）は不要です**。非破壊の配列メソッド（`toSorted` / `toReversed` / `filter` / `with` / `toSpliced`）はいずれも要素の参照を保つため、ソートやフィルタは構造的に keyed に動作し、「キーの付け方を間違える」種類のバグが原理的に発生しません。

例外は、**新しく生成されたオブジェクトとして届くデータ**です。`fetch(...).json()`、ストレージからの `JSON.parse`、WebSocket / SSE の全件スナップショット、Worker の `postMessage` などがこれにあたります。これらの行は参照で照合できないため、全行が破棄・再構築されます。次の [`$listKeys`](#listkeys--再取得された行の同一性) を参照してください。

#### `$listKeys` — 再取得された行の同一性

行がバインディングの管理外の DOM 状態（フォーカス、IME 変換中の文字列、`<details>` の開閉、行内スクロール位置、`<canvas>` の描画内容、`<video>` の再生位置）を持つ場合、行の再構築でそれらは失われます。キーを宣言すると、リフレッシュをまたいで行を同定できます：

```js
{
  items: [],
  $listKeys: {
    "items": "id",                        // フィールド名
    "items.*.children": (row) => row.uid, // 複合キー用の関数も可
  },
}
```

キーを宣言すると、新しい配列を代入しても**既存の行オブジェクトが据え置かれ**、実際に変化したフィールドだけがそこへ書き込まれます。行の DOM は再構築されず再利用されます：

```js
// 行オブジェクトはすべて新しいが id で照合されるため、DOM・フォーカス・
// <details> の状態は保たれ、差分のあるフィールドだけが書き込まれる
this.items = await (await fetch("/api/items")).json();
```

補足：

- **opt-in かつパス単位**です。宣言していないリストは従来どおりの挙動で、追加コストもありません。
- **ネストも opt-in** です。宣言されたパスだけがキー照合され、未宣言のネスト配列は従来どおり参照置換されます。リスト単位で段階的に導入できます。
- **無変化のリフレッシュはゼロコスト**です。何も変わっていなければフィールド書き込みも DOM 操作も一切発生しません。
- **行は plain object** である必要があり、キーは存在かつ一意でなければなりません。キーの重複・欠落・クラスインスタンスは、静かに劣化させず即座にエラーになります。
- **行から消えたフィールドは `null` でクリア**されます。`null` はこのパッケージにおける明示的なクリアの語彙です（`undefined` は「状態が値を持たない」を意味し、書き込み自体がスキップされます）。
- 格納される配列は照合済みの行オブジェクトから組み直されるため、代入後は `this.items !== 代入した配列` になります。

#### ドット省略記法

`for` ループ内では、`.` で始まるパスがループの配列パスを基準に展開されます：

| 省略形 | 展開後 | 説明 |
|---|---|---|
| `.name` | `users.*.name` | 現在の要素のプロパティ |
| `.` | `users.*` | 現在の要素そのもの |
| `.name\|uc` | `users.*.name\|uc` | フィルタは保持される |

プリミティブ配列では、`.` が要素の値を直接参照します：

```html
<template data-wcs="for: branches">
  <label>
    <input type="radio" data-wcs="value: .; radio: currentBranch">
    {{ . }}
  </label>
</template>
```

多重ワイルドカードによるネストループに対応しています。ネストされた `for` ディレクティブの `.` 省略記法も親ループのパスを基準に展開されます：

```html
<template data-wcs="for: regions">
  <!-- .states → regions.*.states -->
  <template data-wcs="for: .states">
    <!-- .name → regions.*.states.*.name -->
    <span data-wcs="textContent: .name"></span>
  </template>
</template>
```

### 条件分岐 (`if` / `elseif` / `else`)

```html
<template data-wcs="if: count|gt(0)">
  <p>正の値</p>
</template>
<template data-wcs="elseif: count|lt(0)">
  <p>負の値</p>
</template>
<template data-wcs="else:">
  <p>ゼロ</p>
</template>
```

条件をチェーンできます。`elseif` は前の条件を自動的に反転します。

## パス getter（算出プロパティ）

**パス getter** は `@wcstack/state` の中核機能です。JavaScript の getter に**ドットパス文字列キー**とワイルドカード（`*`）を使って定義します。**データツリーの任意の深さに仮想プロパティを追加でき、すべてを1箇所にフラットに定義できます**。データのネストがどれほど深くても、定義側は同じレベルに並び、ループ要素ごとの自動依存追跡が機能します。

### 基本的なパス getter

```html
<wcs-state>
  <script type="module">
    export default {
      users: [
        { id: 1, firstName: "Alice", lastName: "Smith" },
        { id: 2, firstName: "Bob", lastName: "Jones" }
      ],
      // パス getter — ループ内で要素ごとに実行
      get "users.*.fullName"() {
        return this["users.*.firstName"] + " " + this["users.*.lastName"];
      },
      get "users.*.displayName"() {
        return this["users.*.fullName"] + " (ID: " + this["users.*.id"] + ")";
      }
    };
  </script>
</wcs-state>

<template data-wcs="for: users">
  <div data-wcs="textContent: .displayName"></div>
</template>
<!-- 出力:
  Alice Smith (ID: 1)
  Bob Jones (ID: 2)
-->
```

パス getter 内の `this["users.*.firstName"]` は、手動でインデックスを指定することなく、自動的に現在のループ要素に解決されます。

### トップレベル算出プロパティ

ワイルドカードなしの getter は通常の算出プロパティとして動作します：

```javascript
export default {
  price: 100,
  tax: 0.1,
  get total() {
    return this.price * (1 + this.tax);
  }
};
```

### getter のチェーン

パス getter は他のパス getter を参照でき、依存チェーンを形成します。上流の値が変更されると、キャッシュは自動的に無効化されます：

```html
<wcs-state>
  <script type="module">
    export default {
      taxRate: 0.1,
      cart: {
        items: [
          { productId: "P001", quantity: 2, unitPrice: 500 },
          { productId: "P002", quantity: 1, unitPrice: 1200 }
        ]
      },
      // アイテムごとの小計
      get "cart.items.*.subtotal"() {
        return this["cart.items.*.unitPrice"] * this["cart.items.*.quantity"];
      },
      // 集計: 全小計の合計
      get "cart.totalPrice"() {
        return this.$getAll("cart.items.*.subtotal", []).reduce((sum, v) => sum + v, 0);
      },
      // チェーン: totalPrice から税を算出
      get "cart.tax"() {
        return this["cart.totalPrice"] * this.taxRate;
      },
      // チェーン: 合計金額
      get "cart.grandTotal"() {
        return this["cart.totalPrice"] + this["cart.tax"];
      }
    };
  </script>
</wcs-state>

<template data-wcs="for: cart.items">
  <div>
    <span data-wcs="textContent: .productId"></span>:
    <span data-wcs="textContent: .subtotal|locale"></span>
  </div>
</template>
<p>合計: <span data-wcs="textContent: cart.totalPrice|locale"></span></p>
<p>税: <span data-wcs="textContent: cart.tax|locale"></span></p>
<p>総合計: <span data-wcs="textContent: cart.grandTotal|locale"></span></p>
```

依存チェーン: `cart.grandTotal` → `cart.tax` → `cart.totalPrice` → `cart.items.*.subtotal` → `cart.items.*.unitPrice` / `cart.items.*.quantity`。アイテムの `unitPrice` や `quantity` を変更すると、チェーン全体が自動的に再計算されます。

### ネストされたワイルドカード getter

ネストされた配列構造では複数のワイルドカードが使用できます：

```html
<wcs-state>
  <script type="module">
    export default {
      categories: [
        {
          name: "果物",
          items: [
            { name: "りんご", price: 150 },
            { name: "バナナ", price: 100 }
          ]
        },
        {
          name: "野菜",
          items: [
            { name: "にんじん", price: 80 }
          ]
        }
      ],
      get "categories.*.items.*.label"() {
        return this["categories.*.name"] + " / " + this["categories.*.items.*.name"];
      }
    };
  </script>
</wcs-state>

<template data-wcs="for: categories">
  <h3 data-wcs="textContent: .name"></h3>
  <template data-wcs="for: .items">
    <div data-wcs="textContent: .label"></div>
  </template>
</template>
<!-- 出力:
  果物
    果物 / りんご
    果物 / バナナ
  野菜
    野菜 / にんじん
-->
```

### フラットな仮想プロパティ — ネストの深さに依存しない定義

パス getter の重要な利点は、**データのネストがどれほど深くても、すべての仮想プロパティを1箇所にフラットに定義できる**ことです。各ネストレベルに算出プロパティを持たせるためだけにコンポーネントを分割する必要がありません。

```javascript
export default {
  regions: [
    { name: "関東", prefectures: [
      { name: "東京", cities: [
        { name: "渋谷", population: 230000, area: 15.11 },
        { name: "新宿", population: 346000, area: 18.22 }
      ]},
      { name: "神奈川", cities: [
        { name: "横浜", population: 3750000, area: 437.56 }
      ]}
    ]}
  ],

  // --- ネストの深さに関係なく、すべてフラットに定義 ---

  // 市レベル — 仮想プロパティ
  get "regions.*.prefectures.*.cities.*.density"() {
    return this["regions.*.prefectures.*.cities.*.population"]
         / this["regions.*.prefectures.*.cities.*.area"];
  },
  get "regions.*.prefectures.*.cities.*.label"() {
    return this["regions.*.prefectures.*.name"] + " "
         + this["regions.*.prefectures.*.cities.*.name"];
  },

  // 県レベル — 市からの集約。`indexes` 省略時はループ文脈（[$1, $2]）が
  // 既定になるので、この県の市だけが合計される
  get "regions.*.prefectures.*.totalPopulation"() {
    return this.$getAll("regions.*.prefectures.*.cities.*.population")
      .reduce((a, b) => a + b, 0);
  },

  // 地方レベル — 県からの集約（文脈 [$1] でこの地方に絞られる）
  get "regions.*.totalPopulation"() {
    return this.$getAll("regions.*.prefectures.*.totalPopulation")
      .reduce((a, b) => a + b, 0);
  },

  // トップレベル — ループ文脈なし。[] は「マッチ全件」
  get totalPopulation() {
    return this.$getAll("regions.*.totalPopulation", [])
      .reduce((a, b) => a + b, 0);
  }
};
```

3階層のネスト、5つの仮想プロパティ — すべてが1つのフラットなオブジェクト内に並んで定義されています。各レベルは任意の深さの値を参照でき、`$getAll` による集約は下位から上位へ自然に流れます。コンポーネントベースのフレームワークでは、一般的に各ネストレベルに個別のコンポーネントを作成し、算出値をツリーの上位に渡す方法が採られます。パス getter は、すべての定義を1箇所にまとめるという異なるトレードオフを提供します。

### getter の戻り値のサブプロパティへのアクセス

パス getter がオブジェクトを返す場合、ドットパスでそのサブプロパティにアクセスできます：

```javascript
export default {
  products: [
    { id: "P001", name: "ウィジェット", price: 500, stock: 10 },
    { id: "P002", name: "ガジェット", price: 1200, stock: 3 }
  ],
  cart: {
    items: [
      { productId: "P001", quantity: 2 },
      { productId: "P002", quantity: 1 }
    ]
  },
  get productByProductId() {
    return new Map(this.products.map(p => [p.id, p]));
  },
  // 完全な product オブジェクトを返す
  get "cart.items.*.product"() {
    return this.productByProductId.get(this["cart.items.*.productId"]);
  },
  // 戻り値のサブプロパティにアクセス
  get "cart.items.*.total"() {
    return this["cart.items.*.product.price"] * this["cart.items.*.quantity"];
  }
};
```

`this["cart.items.*.product.price"]` は `cart.items.*.product` getter が返すオブジェクトを透過的にチェーンします。

### パス setter

`set "path"()` でカスタム setter ロジックを定義できます：

```javascript
export default {
  users: [
    { firstName: "Alice", lastName: "Smith" },
    { firstName: "Bob", lastName: "Jones" }
  ],
  get "users.*.fullName"() {
    return this["users.*.firstName"] + " " + this["users.*.lastName"];
  },
  set "users.*.fullName"(value) {
    const [first, ...rest] = value.split(" ");
    this["users.*.firstName"] = first;
    this["users.*.lastName"] = rest.join(" ");
  }
};
```

```html
<template data-wcs="for: users">
  <input type="text" data-wcs="value: .fullName">
</template>
```

パス setter は双方向バインディングと連携します — input を編集すると setter が呼ばれ、`firstName` / `lastName` に分割して書き戻します。

### 対応するパス getter パターン

| パターン | 説明 | 例 |
|---|---|---|
| `get prop()` | トップレベル算出 | `get total()` |
| `get "a.b"()` | ネスト算出（ワイルドカードなし） | `get "cart.totalPrice"()` |
| `get "a.*.b"()` | 単一ワイルドカード | `get "users.*.fullName"()` |
| `get "a.*.b.*.c"()` | 複数ワイルドカード | `get "categories.*.items.*.label"()` |
| `set "a.*.b"(v)` | ワイルドカード setter | `set "users.*.fullName"(v)` |

### 仕組み

1. **コンテキスト解決** — `for:` ループのレンダリング時に、各イテレーションが `ListIndex` をアドレススタックにプッシュします。パス getter 内の `this["users.*.name"]` はこのスタックを使って `*` を解決するため、常に現在の要素を参照します。

2. **自動依存追跡** — getter が `this["users.*.name"]` にアクセスすると、`users.*.name` から getter のパスへの動的依存が登録されます。`users.*.name` が変更されると、getter のキャッシュが dirty になります。

3. **キャッシュ** — getter の結果は具体的なアドレス（パス + ループインデックス）ごとにキャッシュされます。`users.*.fullName` のインデックス 0 とインデックス 1 は別々のキャッシュエントリを持ちます。依存先が変更された場合のみキャッシュが無効化されます。

4. **直接インデックスアクセス** — 数値インデックスで特定の要素にアクセスすることもできます：`this["users.0.name"]` はループコンテキストなしで `users[0].name` に解決されます。

### getter は state に対して純粋であること

getter のキャッシュを無効化するのは**依存グラフだけ**で、依存グラフに載るのは getter が **`this` を通して読んだもの**だけです。それ以外の入力は無効化から見えないため、**最初に計算した値がそのまま残り続けます**：

```javascript
// ❌ 二度と再計算されない — 依存グラフ上の何も変化しないため
get stamp() { return `${this.label} @ ${Date.now()}`; }   // Date.now() は追跡外
get theme() { return document.body.dataset.theme; }        // DOM は追跡外
get total() { return this.price * exchangeRate; }          // モジュール変数は追跡外
```

規則は「**`this` を通してのみ読む。getter から state を書かない・DOM を触らない**」です。追跡外の入力をどうしても使いたい場合は、その入力を state に持たせてパスに代入する（通常の契約に戻す）か、以下の逃げ道を使ってください：

| API | 用途 |
|---|---|
| `this.$trackDependency(path)` | 依存を明示的に追加し、そのパスの変更でこの getter を dirty にする |
| `this.$postUpdate(path)` | 追跡外の入力が変わったことを getter の外から通知する |
| `this.$untrackDependency(fn)` | 依存として登録せずにパスを読む（上の対称） |

```javascript
// ✅ 時計を state 側で刻み、getter は純粋なまま
export default {
  now: Date.now(),
  get stamp() { return `${this.label} @ ${this.now}`; },
  $connectedCallback() { setInterval(() => { this.now = Date.now(); }, 1000); },
};
```

getter の例外は握り潰されません。評価された場所（バインディングの適用・`$watch` の評価・自分での読み取り）でそのまま表面化します。

### ループインデックス変数（`$1`, `$2`, ...）

getter やイベントハンドラ内で、`this.$1`、`this.$2` などで現在のループイテレーションのインデックスを取得できます（0始まりの値、1始まりの命名）：

```javascript
export default {
  users: ["Alice", "Bob", "Charlie"],
  get "users.*.rowLabel"() {
    return "#" + (this.$1 + 1) + ": " + this["users.*"];
  }
};
```

```html
<template data-wcs="for: users">
  <div data-wcs="textContent: .rowLabel"></div>
</template>
<!-- 出力:
  #1: Alice
  #2: Bob
  #3: Charlie
-->
```

ネストループでは、`$1` が外側のインデックス、`$2` が内側のインデックスです。

テンプレート内でループインデックスを直接表示することもできます：

```html
<template data-wcs="for: items">
  <td>{{ $1|inc(1) }}</td>  <!-- 1始まりの行番号 -->
</template>
```

### Proxy API

状態オブジェクト内（getter / メソッド）で `this` 経由で以下の API が利用できます：

| API | 説明 |
|---|---|
| `this.$getAll(path, indexes?)` | ワイルドカードパスにマッチする全ての値を取得 |
| `this.$setAll(path, indexes, value, options?)` | ワイルドカードパスにマッチする全アドレスへ一括書き込み |
| `this.$resolve(path, indexes, value?)` | ワイルドカードパスを特定のインデックスで解決 |
| `this.$postUpdate(path)` | 指定パスの更新通知を手動で発行 |
| `this.$trackDependency(path)` | キャッシュ無効化のための依存関係を手動で登録 |
| `this.$untrackDependency(fn)` | fn 実行中の依存追跡を抑止して値を読む（`$trackDependency` と対称） |
| `this.$stateElement` | `IStateElement` インスタンスへのアクセス |
| `this.$1`, `this.$2`, ... | 現在のループインデックス（1始まりの命名、0始まりの値） |

#### `$getAll` — 配列要素全体の集計

`$getAll` はワイルドカードパスにマッチする全ての値を配列として収集します。集計パターンに不可欠です：

```javascript
export default {
  scores: [85, 92, 78, 95, 88],
  get average() {
    const all = this.$getAll("scores.*", []);
    return all.reduce((sum, v) => sum + v, 0) / all.length;
  },
  get max() {
    return Math.max(...this.$getAll("scores.*", []));
  }
};
```

`indexes` はパスの `*` に対する**前方一致の接頭辞**です。不足した階層は全展開され、`[]` は常に「マッチ全件」を意味します。**省略**した場合はループ文脈の添字（`[$1, $2, ...]`）が既定になり、パスが文脈と共有するワイルドカード階層に敷かれます：

```javascript
export default {
  regions: [ /* { prefectures: [ { population: … }, … ] } */ ],
  // ループ文脈 [$1] — 省略すると現在の地方に絞られる
  get "regions.*.total"() {
    return this.$getAll("regions.*.prefectures.*.population").reduce((a, b) => a + b, 0);
  },
  // ループ文脈なし — 省略は全展開（[] と同じ）
  get grandTotal() {
    return this.$getAll("regions.*.total").reduce((a, b) => a + b, 0);
  }
};
```

文脈がパスより深い分は切り詰められます（`[$1, $2]` の文脈は `*` 1 本のパスを `[$1]` で絞ります）。一方、文脈がループ添字を持っているのにパスと**ワイルドカード階層をまったく共有しない**場合 —— たとえば `regions.*` の getter 内での `$getAll("users.*.name")` —— は、黙って全 users を読む代わりに **throw** します。文脈の添字は別のリストのものであり、流用しても無視しても書き手の意図とは食い違うためです。この形では添字を明示してください（全件なら `[]`）。

#### `$setAll` — 配列要素を作り直さずに一括更新

`$setAll` は `$getAll` の書き側の対称形で、ワイルドカードパスにマッチする全アドレスへ書き込みます。狙いは記述の短さではなく、**配列そのものを保つ**ことです。`this.users = this.users.map(...)` のように作り直すと ListIndex・行 getter のキャッシュ・差分描画がまとめて捨てられますが、`$setAll` は行ごとの in-place な書き込みに分解するのでリストの同一性が保たれます。

```javascript
export default {
  users: [{ selected: false }, { selected: false }],

  toggleAll(e) {
    this.$setAll("users.*.selected", [], e.target.checked);   // ブロードキャスト
  },
  invertAll() {
    this.$setAll("users.*.selected", [], cur => !cur);        // mapper
  },
  rankTopThree() {
    // undefined を返したアドレスはスキップされる（＝この行は変えない）
    this.$setAll("users.*.score", [], (cur, i) => i < 3 ? cur * 2 : undefined);
  }
};
```

形は 3 つあり、3 番目だけは明示的に要求する必要があります。

| 第 3 引数 | 意味 |
|---|---|
| 関数 | **mapper** — マッチしたアドレスごとに `(current, ...indexes)` で呼ばれる |
| それ以外 | **ブロードキャスト** — 配列も含め、同じ値が全アドレスに書かれる |
| 配列 ＋ `{ spread: true }` | **spread** — マッチ順に 1 件ずつ配る |

配列が既定でブロードキャストされるのは、対象プロパティ自体が配列型でありうるためです。`$setAll("users.*.tags", [], ["admin"])` は「全員に `["admin"]`」なのか「1 人目に `"admin"`」なのか判別できません。`{ spread: true }` を明示すればこの推測が消え、長さがマッチ件数と噛み合わなければ黙って誤配せずに throw します。

`indexes` の意味は `$getAll` と同じ**前方一致の接頭辞**（不足はその階層を全展開）ですが、**省略はできません**。書き込みには暗黙のループ文脈を与えないため、`for` テンプレートの中でも `this.$setAll("users.*.selected", [], true)` は現在行ではなく**全行**を意味します。

```javascript
this.$setAll("matrix.*.*", [0], 0);                    // 0 行目だけ全列
this.$setAll("users.*", [], rows, { spread: true });   // 配列を保ったまま各行を差し替え
```

`undefined` はどの形でも書き込まれず「このアドレスはスキップ」を意味します。mapper が `return` を忘れて全行を潰す事故を防ぐためで、クリアしたい場合は `null` を使います。戻り値は実際に書き込んだ件数です。

なお `$setAll` は依存解決を一括化する仕組みではありません。描画は 1 バッチに畳まれますが、書き込みは 1 件ずつ登録されるので、コストは置き換え対象の手書きループと同じです。得られるのはリストが保たれることであって、実行回数の削減ではありません。

#### `$resolve` — 明示的なインデックスでのアクセス

`$resolve` は特定のワイルドカードインデックスの値を読み書きします：

```javascript
export default {
  items: ["A", "B", "C"],
  swapFirstTwo() {
    const a = this.$resolve("items.*", [0]);
    const b = this.$resolve("items.*", [1]);
    this.$resolve("items.*", [0], b);
    this.$resolve("items.*", [1], a);
  }
};
```

## イベントハンドリング

`on*` プロパティでイベントハンドラをバインドします：

```html
<button data-wcs="onclick: handleClick">クリック</button>
<form data-wcs="onsubmit#prevent: handleSubmit">...</form>
```

ハンドラメソッドはイベントとループインデックスを受け取ります：

```javascript
export default {
  items: ["A", "B", "C"],
  handleClick(event) {
    console.log("clicked");
  },
  removeItem(event, index) {
    // index はループコンテキスト ($1)
    this.items = this.items.toSpliced(index, 1);
  }
};
```

```html
<template data-wcs="for: items">
  <button data-wcs="onclick: removeItem">削除</button>
</template>
```

## フィルタ

46 種類の組み込みフィルタが入力（DOM → 状態）と出力（状態 → DOM）の両方向で利用できます。

### 比較

| フィルタ | 説明 | 例 |
|---|---|---|
| `eq(value)` | 等しい | `count\|eq(0)` → `true/false` |
| `ne(value)` | 等しくない | `count\|ne(0)` |
| `not` | 論理否定 | `isActive\|not` |
| `lt(n)` | より小さい | `count\|lt(10)` |
| `le(n)` | 以下 | `count\|le(10)` |
| `gt(n)` | より大きい | `count\|gt(0)` |
| `ge(n)` | 以上 | `count\|ge(0)` |

### 算術

| フィルタ | 説明 | 例 |
|---|---|---|
| `inc(n)` | 加算 | `count\|inc(1)` |
| `dec(n)` | 減算 | `count\|dec(1)` |
| `mul(n)` | 乗算 | `price\|mul(1.1)` |
| `div(n)` | 除算 | `total\|div(100)` |
| `mod(n)` | 剰余 | `index\|mod(2)` |
| `abs` | 絶対値 | `delta\|abs` |
| `clamp(min, max)` | 範囲内に丸める | `ratio\|clamp(0,100)` |

### 数値フォーマット

| フィルタ | 説明 | 例 |
|---|---|---|
| `fix(n)` | 固定小数点桁数 | `price\|fix(2)` → `"100.00"` |
| `round(n?)` | 四捨五入 | `value\|round(2)` |
| `floor(n?)` | 切り捨て | `value\|floor` |
| `ceil(n?)` | 切り上げ | `value\|ceil` |
| `locale(loc?)` | ロケール数値フォーマット | `count\|locale` / `count\|locale(ja-JP)` |
| `percent(n?)` | パーセンテージフォーマット | `ratio\|percent(1)` |
| `unit(u)` | 単位（任意の接尾辞）を付加 | `width\|unit(px)` → `"40px"` |

### 文字列

| フィルタ | 説明 | 例 |
|---|---|---|
| `uc` | 大文字変換 | `name\|uc` |
| `lc` | 小文字変換 | `name\|lc` |
| `cap` | 先頭大文字 | `name\|cap` |
| `trim` | 空白除去 | `text\|trim` |
| `slice(n)` | 文字列スライス | `text\|slice(5)` |
| `substr(start, length)` | 部分文字列 | `text\|substr(0,10)` |
| `pad(n, char?)` | 先頭パディング | `id\|pad(5,0)` → `"00001"` |
| `rep(n)` | 繰り返し | `text\|rep(3)` |
| `rev` | 反転 | `text\|rev` |
| `truncate(n, suffix?)` | 切り詰めて省略記号を付加 | `title\|truncate(20)` → `"…"` 付き |
| `join(sep?)` | 配列を連結（既定 `", "`） | `tags\|join` / `tags\|join(/)` |

### 型変換

| フィルタ | 説明 | 例 |
|---|---|---|
| `int` | 整数パース | `input\|int` |
| `float` | 浮動小数点パース | `input\|float` |
| `boolean` | 真偽値に変換 | `value\|boolean` |
| `number` | 数値に変換 | `value\|number` |
| `string` | 文字列に変換 | `value\|string` |
| `null` | null に変換 | `value\|null` |

### 日付 / 時刻

| フィルタ | 説明 | 例 |
|---|---|---|
| `date(loc?)` | 日付フォーマット | `timestamp\|date` / `timestamp\|date(ja-JP)` |
| `time(loc?)` | 時刻フォーマット | `timestamp\|time` |
| `datetime(loc?)` | 日付 + 時刻 | `timestamp\|datetime(en-US)` |
| `ymd(sep?)` | YYYY-MM-DD | `timestamp\|ymd` / `timestamp\|ymd(/)` |
| `hms(sep?)` | HH:MM:SS | `timestamp\|hms` / `timestamp\|hms(-)` |

### 真偽値 / デフォルト

| フィルタ | 説明 | 例 |
|---|---|---|
| `truthy` | truthy チェック | `value\|truthy` |
| `falsy` | falsy チェック | `value\|falsy` |
| `defaults(v)` | フォールバック値 | `name\|defaults(Anonymous)` |

### フィルタチェーン

フィルタは `|` で連結できます：

```html
<div data-wcs="textContent: price|mul(1.1)|round(2)|locale(ja-JP)"></div>
```

## Web Component バインディング

`@wcstack/state` は Shadow DOM または Light DOM を使用したカスタム要素との双方向状態バインディングに対応しています。

多くのフレームワークでは、コンポーネント間の状態共有に props のバケツリレー、Context Provider、あるいは外部ストア（Redux, Pinia など）といったパターンが用いられます。`@wcstack/state` はこれらとは異なるアプローチを採ります。親コンポーネントと子コンポーネントは**パスの契約**によって結びつけられます。親は `data-wcs` 属性を使って外部の状態パスを子コンポーネントのプロパティにバインドし、子は自身の状態として通常通り読み書きを行うだけです：

1. 子コンポーネントは、自身の状態プロキシを通じて親の状態を参照・更新します。props の受け渡しやイベント発行など、親の存在を意識したコーディングは必要ありません。
2. 親の状態が変更されると、Proxy の `set` トラップが影響するパスを参照している子のバインディングへ自動的に通知します。
3. 結合点は**パス名のみ**であるため、親と子は完全に疎結合な状態を保ち、それぞれ独立してテスト可能です。
4. 実行コストは、パスの解決（初回アクセス後はキャッシュされるため O(1) で動作します）と、依存グラフを通じた変更の伝播のみです。

これは、コンポーネントレベルの複雑な抽象化ではなく、「パスの解決」に基づいたコンポーネント間状態管理への軽量なアプローチです。

### コンポーネント定義（Shadow DOM）

```javascript
class MyComponent extends HTMLElement {
  state = { message: "" };

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <wcs-state bind-component="state"></wcs-state>
      <div>{{ message }}</div>
      <input type="text" data-wcs="value: message" />
    `;
  }
}
customElements.define("my-component", MyComponent);
```

### コンポーネント定義（Light DOM）

Light DOM コンポーネントは Shadow DOM を使用しません。v2 では Shadow 形と同じ書き方になります —— コンポーネントのバインディングはマウント位置でホストのツリーへ変換されるため、**name も `@` セレクタも不要**で、同じコンポーネントをリストの行ごとに置けます:

```javascript
class MyLightComponent extends HTMLElement {
  state = { message: "" };

  connectedCallback() {
    this.innerHTML = `
      <wcs-state bind-component="state"></wcs-state>
      <div data-wcs="text: message"></div>
      <input type="text" data-wcs="value: message" />
    `;
  }
}
customElements.define("my-light-component", MyLightComponent);
```

- `<wcs-state>` はコンポーネント要素の直下に配置する必要があります
- **ホストからの配線が必須**です（`<my-light-component data-wcs="state.message: user.name">` または `state: user`）。配線の無い plain な Light DOM `bind-component` は v2 では成立しません（親と root を共有したまま独立ツリーは持てない）—— 誘導文付きで loud に失敗します: shadow を付けるか、ホストから配線してマウントにしてください。

> **注意**: `State.getBindingsReady(root)` はマウント記録の確定後、マウントスコープも待ちます。
> コンポーネント内部の描画完了まで待ちたい場合は、コンポーネント側の `<wcs-state>` の初期化を
> 待ってください。

### ホスト側の使用方法

```html
<wcs-state>
  <script type="module">
    export default {
      user: { name: "Alice" }
    };
  </script>
</wcs-state>

<!-- コンポーネントの state.message を外側の user.name にバインド -->
<my-component data-wcs="state.message: user.name"></my-component>
```

- `bind-component="state"` でコンポーネントの `state` プロパティを `<wcs-state>` にマッピング
- `data-wcs="state.message: user.name"` でホスト要素上の外部状態パスを内部コンポーネント状態プロパティにバインド
- 変更はコンポーネントと外部状態間で双方向に伝播

### 丸ごとマウント（`state: path`）

プロパティ単位で配線する代わりに、ホストは自分の状態の**サブツリーを丸ごと**コンポーネントのルートとしてマウントできます。コンポーネントの中のパスは、すべてマウント先からの相対になります:

```html
<!-- ホスト側 -->
<wcs-state json='{"user":{"name":"Alice","email":"alice@example.com"},"theme":{"mode":"light"}}'></wcs-state>
<user-card data-wcs="state: user"></user-card>
```

```javascript
// コンポーネント側（Shadow DOM）
class UserCard extends HTMLElement {
  state = {
    // マウント先の上で計算する getter — `this.name` はツリーの `user.name`
    get display() { return `${this.name} <${this.email}>`; },
  };
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }
  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <wcs-state bind-component="state"></wcs-state>
      <span data-wcs="textContent: name"></span>
      <span data-wcs="textContent: display"></span>
      <input data-wcs="value: name">
    `;
  }
}
customElements.define("user-card", UserCard);
```

- `state: user` はコンポーネントのルートをツリーのパス `user` に置きます。中の `name` は `user.name` **そのもの**です。読み・書き（`value: name`、`this.state.name = ...`）・getter・`for:` はすべてツリーに対して解決され、ホストの丸ごと差し替え（`this.user = {...}`）も部分書き込み（`this["user.name"] = ...`）もコンポーネントに届きます
- 部分マウントを併用できます: `state: user; state.theme: theme` は `theme` を 2 つ目の入口としてマウントします（最長接頭辞が勝つので、中の `theme.mode` はツリーの `theme.mode` を読みます）
- ループでは**行そのもの**をマウントします: `<template data-wcs="for: users"><user-row data-wcs="state: ."></user-row></template>`。行コンポーネントの中の `name` は `users.*.name`、中の `for: tags` は `users.*.tags.*` を回します
- **自前のキーは私有**です（[docs/state-mount-design.md](../../docs/state-mount-design.md) §4-3 の R1）: コンポーネントが自分で宣言したデータキー（`state = { mode: "view" }`）はその要素のもので、ツリーには書かれません。マウント先に同名のキーがあってそれを隠す形（`user.name` の上に `state = { name: "" }`）では、ランタイムが 1 回だけ warn します（`wcs/mount-own-key-shadow`）— ツリーを読みたければ既定値を消し、私有のままにしたければ名前を変えてください
- 配列そのものをルートにマウントする形（`state: rows` ＋ 中で `for`）は非対応です。行をマウントする（`state: .`）か、配列を持つオブジェクトをマウントして中で `for` を回してください（`state: group` ＋ `for: children`）。どちらも契約テストで固定されており、マウントがツリー拡張の唯一の手段です

> プロパティ単位の形（`state.message: user.name`）はそのまま動きます — 同じ機構の上の部分マウントです。
> R1 はすべてのマウント形で厳格です — マップされるキーに既定値を
> 宣言しているコンポーネント（`state = { message: "" }` ＋ `state.message: ...`）は自前のキーが
> **私有**になり、ホストの値を隠します（1 回だけ `wcs/mount-own-key-shadow` が指します）。ツリーを
> 読むには既定値を消してください。Light DOM のマウントに `name` は不要で、
> `element.state`（および getter / メソッド内の `this`）の `$getAll` / `$setAll` / `$resolve` /
> `$postUpdate` はコンポーネント自身の語彙で書けます — パスはマウント先へ翻訳され、ホスト行の
> 添字は自動で前置されます。

### 独立した Web Component への状態注入（`__e2e__/single-component`）

ホストの外部状態に依存しないコンポーネントでも、`bind-component` で `state` を注入してリアクティブにできます。

```javascript
class MyComponent extends HTMLElement {
  state = Object.freeze({
    message: "Hello, World!"
  });

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <wcs-state bind-component="state"></wcs-state>
      <div>{{ message }}</div>
    `;
  }

  async $stateReadyCallback(stateProp) {
    console.log("state ready:", stateProp); // "state"
  }
}
customElements.define("my-component", MyComponent);
```

- 初期 `state` は `Object.freeze(...)` で定義できます（注入後は書き換え可能なリアクティブ状態に置き換え）
- `bind-component="state"` により `this.state` が `@wcstack/state` の状態プロキシとして利用可能になります
- `this.state.message = "..."` のような代入で、Shadow DOM 内の `{{ message }}` が即時に更新されます
- `async $stateReadyCallback(stateProp)` は、Web Component 側で状態が利用可能になった直後に呼ばれます（`stateProp` は `bind-component` のプロパティ名）

### 制約事項

- `bind-component` 付きの `<wcs-state>` はコンポーネント要素の**直下**（トップレベル）に配置すること
- 親要素は**カスタム要素**（ハイフンを含むタグ名）であること
- Light DOM コンポーネントはホストからの配線が必須（plain 形は v2 で廃止）

### ループ内でのコンポーネント使用

```html
<template data-wcs="for: users">
  <my-component data-wcs="state.message: .name"></my-component>
</template>

<!-- または行そのものをマウントする: コンポーネントの中の `name` は `users.*.name` -->
<template data-wcs="for: users">
  <user-row data-wcs="state: ."></user-row>
</template>
```

### コンポーネント側でリストを描画する

配列をコンポーネントに束ね、`for:` をコンポーネントの内側で回すこともできます。
値の正本は外側の状態のままで、行の追加・削除・並べ替え・行フィールドの書き込みは双方向に届きます。

```html
<!-- ホスト側 -->
<wcs-state json='{"rows":[{"name":"Alice"},{"name":"Bob"}]}'></wcs-state>
<my-list data-wcs="state.items: rows"></my-list>
```

```javascript
// コンポーネント側（Shadow DOM）
this.shadowRoot.innerHTML = `
  <wcs-state bind-component="state"></wcs-state>
  <ul>
    <template data-wcs="for: items">
      <li data-wcs="textContent: .name"></li>
    </template>
  </ul>
`;
```

- ホストが `rows` を差し替えても、行フィールド（`rows.0.name`）だけを書いても、コンポーネント内の行に反映されます
- コンポーネント側から `items.*.name` を書き戻すと、ホストの `rows` に届きます

#### 入れ子とスコープの重ね方

コンポーネント自身がホスト側の `for` の中にあり、**さらにコンポーネント内でも `for` を回す**入れ子構成にも対応しています。外側の行と内側の行の対応はフレームワークが保ちます：

```html
<template data-wcs="for: groups">
  <my-list data-wcs="state.items: groups.*.children"></my-list>
</template>
```

コンポーネントの中にさらにコンポーネントを置いて、**スコープを重ねる**こともできます。途中のコンポーネントが配列を素通しするだけで自分では `for` を回さなくても、正本スコープ起点の行フィールド書き込みは最下層の行まで届きます。

コンポーネントの作者が自分の置かれる深さを意識する必要はありません。`$1` / イベントハンドラのインデックス / `$updatedCallback` / `$getAll` はいずれも**自分のスコープ内の位置**を報告します。

## Command Token（メソッドバインディング）

プロパティバインディング（`state.message: user.name`）はコンポーネントへ流れ込むデータを扱いますが、**state からコンポーネントのメソッドを起動する**こと —— `<wcs-fetch>.fetch()`、`<wcs-dialog>.open()` など —— はカバーしません。**command token** は型付きの pub/sub チャネルでこの隙間を埋めます：

- 要素は `command.<methodName>: $command.<tokenName>` で購読する
- state は `this.$command.<tokenName>.emit(...args)` で emit する
- `emit` に渡した引数はそのまま要素のメソッドへ転送される
- 1つの token は複数の要素へファンアウトでき、subscribe 順は保持される

これによりパス契約は保たれます。state は要素への参照を一切保持せず、要素も state から何もインポートしません。共有されるオブジェクトは token のみです。

### 基本的な使い方

```html
<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["fetchUsers", "refreshOrders"],

      onClickFetch() {
        this.$command.fetchUsers.emit("/api/users", { method: "GET" });
      },
      onClickRefresh() {
        this.$command.refreshOrders.emit();
      }
    };
  </script>
</wcs-state>

<!-- 購読者 — wc-bindable なカスタム要素であること -->
<wcs-fetch data-wcs="command.fetch: $command.fetchUsers"></wcs-fetch>
<wcs-fetch data-wcs="command.fetch: $command.refreshOrders"></wcs-fetch>

<button data-wcs="onclick: onClickFetch">Fetch users</button>
<button data-wcs="onclick: onClickRefresh">Refresh orders</button>
```

`onClickFetch` が実行されると、`fetchUsers` token を購読しているすべての要素の `fetch(...)` メソッドが転送された引数とともに呼び出されます。

### `$commandTokens` 宣言

`$commandTokens` 配列は、state 上の `$command` 名前空間に公開するチャネルを宣言します。token は `this.$command.<name>` でアクセスでき、memo 化されます —— 同じ名前は常に同一の token インスタンスを返します。

```javascript
export default {
  $commandTokens: ["fetchUsers", "refreshOrders"],

  click() {
    this.$command.fetchUsers.emit("/api/users");
  }
};
```

- エントリは空でない文字列であること
- 重複するエントリは初期化時にエラーになる
- 予約名 `$command` 自体は配列に含められない
- token は `$command` 配下にまとめられるためトップレベルの state 名前空間を汚さない。token と同名のリアクティブプロパティが共存できる
- `$command` 上の未宣言の名前にアクセスする（例: `this.$command.typo`）と `undefined` が返る。typo はその後の `.emit()` 呼び出しで `TypeError` として、あるいはバインディングの右辺で使った場合は「CommandToken 値が必要」エラーとしてバインディング時に表面化する

### `command.<methodName>:` バインディング

```html
<wcs-fetch data-wcs="command.fetch: $command.fetchUsers"></wcs-fetch>
```

| 部位 | 説明 |
|---|---|
| `command.` | 固定の prefix |
| `<methodName>` | 起動する要素のメソッド。名前は `static wcBindable.commands` に `{ name: "<methodName>" }` として現れること |
| `$command.<tokenName>` | `CommandToken` に解決される明示的な名前空間パス。`<tokenName>` は `$commandTokens` で宣言された名前であること |

右辺は `$command.<tokenName>` と書く必要があります —— ベア名の省略形（`fetchUsers`）は非対応です。`$command.` 名前空間を経由することでバインディングの意図が HTML 上で明示され、トップレベルの state 名前空間を token 名で汚さずに済みます。

`wcBindable.commands` は wc-bindable v1 仕様の形 —— `{ name: string; async?: boolean }` の配列 —— に従います：

```javascript
class MyFetcher extends HTMLElement {
  static wcBindable = {
    protocol: "wc-bindable", version: 1,
    properties: [],
    commands: [
      { name: "fetch", async: true },
      { name: "reset" },
    ],
  };
  fetch(url) { /* ... */ }
  reset()    { /* ... */ }
}
```

> **v1.9.1 以降の破壊的変更**: `commands` フィールドは `{ name, async? }` オブジェクトの配列になりました。以前の `commands: ["fetch"]` という素の文字列形式はもう受け付けられません —— そのような宣言に対するバインディングは `Command "<name>" is not declared in wcBindable.commands` を throw します。レガシーフォールバックはありません。宣言をオブジェクト形式に更新してください。

検証ルール（バインディング時に強制）：

- 要素は `protocol: "wc-bindable"` かつ整数 `version` が `1` 以上（現行プロトコルは `1`。1 以上のすべてのバージョンが core 互換）の `static wcBindable` を公開するカスタム要素であること
- `methodName` は `wcBindable.commands` に（`name` で）現れること
- バインドされる値は `CommandToken` であること（token 以外の値の代入は throw する —— 例えば未宣言の名前 `$command.typo` は `undefined` に解決され、ここで拒否される）

### Token API

```typescript
interface CommandToken {
  readonly name: string;
  readonly size: number;                            // 現在の購読者数
  subscribe(fn: (...args) => unknown): () => void;  // unsubscribe を返す
  unsubscribe(fn: (...args) => unknown): boolean;
  emit(...args: unknown[]): unknown[];              // subscribe 順に購読者の戻り値を返す
}
```

`emit` は各購読者の戻り値の配列を（subscribe 順で）返します。`Promise` を返すメソッドは `Promise.all(token.emit(...))` でラップしてすべてを待ち受けてください。

### 購読のライフサイクル

- 購読者は要素を `WeakRef` で保持するため、token の購読者セットに残っていても、取り外された要素はガベージコレクト可能
- `emit` 時、WeakRef が回収済みか要素が接続されていない（`isConnected === false`）場合、購読は自動的に破棄される（lazy purge）
- 所有する `<wcs-state>` が disconnect されると、token レジストリ全体がクリアされる

要素のメソッドは `emit` の引数で呼び出されます：

```javascript
this.$command.fetchUsers.emit(url, options);
// → すべての購読者で element.fetch(url, options)
```

### DOM イベントから command を emit する

command token は state コードから emit する必要はありません。DOM イベントバインディングの右辺を、state メソッド名ではなく `$command.<name>` パスに向けることで、直接 emit できます：

```html
<button data-wcs="onclick: $command.refreshList">Refresh</button>
```

| 形式 | 右辺 | イベント時の動作 |
|---|---|---|
| `onclick: someMethod` | state メソッド名 | `state.someMethod(event, ...listIndexes)` |
| `onclick: $command.someToken` | `$command.<name>` パス | `state.$command.someToken.emit(event, ...listIndexes)` |

これは純粋な配線です。イベント端点を command token 端点に接続するだけで、間にロジックは入りません。`emit` の引数はハンドラ呼び出しとまったく同じく透過されます —— まず DOM の `Event`、続いて内包するリストインデックス —— なので購読者は `(event, ...listIndexes)` を受け取ります。購読者の中で必要なものをイベントから取り出してください（`event.target.value`、`event.detail` など）。

- 右辺は `$command.<name>` であり、`<name>` は `$commandTokens` で宣言されていること。`CommandToken` に解決されないパス（例: typo）はイベント時に throw する。
- 修飾子はそのまま機能する: `onclick#prevent: $command.someToken` は emit の前に `preventDefault()` を呼ぶ（`#stop` も同様）。
- これは state が emit するのと同じ token を emit するので、`command.<method>: $command.someToken` で配線された要素の購読者は、誰がトリガを引いたかに関わらず受け取る。

```html
<!-- click が command を全購読者へファンアウトする。state メソッドは不要 -->
<button data-wcs="onclick: $command.reset">Reset all</button>
<my-field data-wcs="command.clear: $command.reset"></my-field>
<my-list  data-wcs="command.reset: $command.reset"></my-list>
```

## Event Token（イベントバインディング）

command token はコンポーネントへ *押し込み* ます（state がメソッドを起動）。**event token** はその正確な双対 —— コンポーネントから *引き出し* ます（要素がイベントを dispatch し、state が受信）。両者で要素 ↔ state 境界の双方向をカバーし、どちらの側も相手への参照を一切持ちません。共有されるのは token のみです。

| Token | 方向 | 購読者 | emit する側 |
|---|---|---|---|
| **command token** | state → 要素 | 要素（`command.<method>:`） | state（`$command.<name>.emit`） |
| **event token** | 要素 → state | state（`$on`） | 要素（DOM イベントリスナー） |

- 要素側は wc-bindable カスタム要素に `eventToken.<property>: <tokenName>` を配線する
- state 側は `$eventTokens` でチャネルを宣言し、`$on` マップで受信する
- 購読者は `(state, event, ...listIndexes)` で呼び出される —— command token の emit 規約と対称

### 基本的な使い方

```html
<wcs-state>
  <script type="module">
    export default {
      users: [],
      error: null,

      $eventTokens: ["userCreated", "createFailed"],
      $on: {
        userCreated(state, event) {
          state.users = state.users.concat(event.detail);
        },
        createFailed(state, event) {
          state.error = event.detail;
        }
      }
    };
  </script>
</wcs-state>

<!-- emitter — wc-bindable なカスタム要素であること -->
<my-form data-wcs="eventToken.created: userCreated; eventToken.error: createFailed"></my-form>
```

`<my-form>` が自身の `created` プロパティに対応する DOM イベントを dispatch すると、`userCreated` token が発火し、`$on.userCreated` ハンドラが `(state, event)` で実行されます。

### `$eventTokens` 宣言

`$eventTokens` 配列は、`eventToken.<prop>:` バインディングと `$on` キーが参照できるチャネル名を宣言します。宣言された名前のみが有効です（typo 耐性）。

```javascript
export default {
  $eventTokens: ["userCreated", "createFailed"],
};
```

- エントリは空でない文字列であること
- 重複するエントリは初期化時にエラーになる
- ここで宣言されたが `$on` に無い token は購読者ゼロ —— emit しても no-op

### `$on` —— state 側での受信

`$on` は各 event-token 名をハンドラに対応づけます。state は **第1引数** として渡される（`this` ではない）ため、ハンドラはメソッド省略記法でもアロー関数でも書けます —— `this` を束縛しない点は command token の emit 規約と同じです：

```javascript
$on: {
  // どちらの形式でも可 —— state は常に第1引数
  userCreated: (state, event) => { state.lastId = event.detail.id; },
  rowFailed(state, event, ...listIndexes) {
    const [i] = listIndexes;          // `for` 内から発火した場合のループインデックス
    state.failedRows = state.failedRows.concat(i);
  }
}
```

- `$on` のすべてのキーは `$eventTokens` で宣言済みであること（さもなくば初期化時に throw）
- 各値は関数であること
- シグネチャは `(state, event, ...listIndexes)` —— まず DOM の `Event`、続いて内包するループインデックス

### `eventToken.<property>:` バインディング

```html
<my-target data-wcs="eventToken.error: createFailed"></my-target>
```

| 部位 | 説明 |
|---|---|
| `eventToken.` | 固定の prefix |
| `<property>` | **wcBindable プロパティ名** —— 生の DOM イベント名ではない。実イベント名は `wcBindable.properties[].event` から解決される |
| `<tokenName>` | `$eventTokens` で宣言されたベアな event-token 名（command token と違い `$` 名前空間 prefix は付けない） |

キーを生イベント名ではなくプロパティ名にすることで、command バインディングと同じ `wcBindable` 契約を経由でき、namespaced なイベント名（`ns:evt`）がバインディングの `:` 区切りと衝突しません。フレームワークは `properties[].event` を引いてその実イベントのリスナーを attach します：

```javascript
class MyTarget extends HTMLElement {
  static wcBindable = {
    protocol: "wc-bindable", version: 1,
    properties: [
      { name: "error",   event: "thing-error" },     // eventToken.error → "thing-error" を listen
      { name: "created", event: "thing-created" },
    ],
  };
}
```

検証ルール：

- 要素は wc-bindable なカスタム要素であること（`static wcBindable`・`protocol: "wc-bindable"`・整数 `version` が 1 以上。1 以上のすべてのバージョンが core 互換）。非 wc-bindable 要素は attach 時に拒否される。
- `<property>` は `wcBindable.properties` に現れること —— **attach 時** に検証（fail-fast。クラス参照のみで足り、DOM 接続に非依存）。
- `<tokenName>` は `$eventTokens` で宣言されていること —— **発火時** に検証。state はイベント発火時に要素の live root から解決されるため、attach 時にノードが detached になりうる `for` / `if` ブロック内や SSR ハイドレーション後でも機能する。
- 修飾子 `#prevent` / `#stop` は通常のイベントバインディングと同様に機能する: `eventToken.error#prevent: createFailed`。

### ループ内での使用

emitter が `for` ブロック内にある場合、`on*` ハンドラと同じく、内包するループインデックスがイベントの後ろに付与されます：

```html
<template data-wcs="for: rows">
  <my-row data-wcs="eventToken.failed: rowFailed"></my-row>
</template>
```

```javascript
$on: {
  rowFailed(state, event, ...listIndexes) {
    const [i] = listIndexes;          // 発火した行のインデックス
    state.failedRows = state.failedRows.concat(i);
  }
}
```

### ファンインとチェイン

複数の要素が同じ token を配線できます（`eventToken.x: shared`）—— すべての dispatch が1つの `$on` ハンドラに届き、command token のファンアウトと対称です。さらに `$on` ハンドラは `state` を受け取るため、そこから command token を再 emit して 要素 → state → 要素 のチェインを組めます：

```javascript
$commandTokens: ["doRefresh"],
$eventTokens: ["completed"],
$on: {
  completed(state) {
    state.$command.doRefresh.emit();  // event in → command out
  }
}
```

### Token API

event token は command token と同じ `Token` pub/sub プリミティブを共有します —— `name` / `size` / `subscribe` / `unsubscribe` / `emit`、subscribe 順の保持つき（[Token API](#token-api) 参照）。token はイベントごとに registry から解決されるため、`setInitialState()` による再構築後も最新の `$on` 購読者に届きます。所有する `<wcs-state>` が disconnect されると、event-token registry はクリアされます。

## Stream（`$streams`）

command token / event token が運ぶのは離散的なやり取りです。**`$streams`** は残る形 —— 連続的なフローをカバーします。非同期 producer（async iterable / async generator / `ReadableStream`）を宣言すると、フレームワークがそれを **fold して単一の reactive プロパティに畳み込みます** —— 各チャンクは通常のパス代入を通るため、バインディング・パス getter・`$updatedCallback` は自分で値を代入した場合とまったく同じように反応します。`args` 関数が読んだ state パスが変化すると、実行中の producer は abort され、新しい引数で source が張り直されます（switchMap 型の依存駆動 restart）。stream は `$connectedCallback` 完了後に eager に起動し、要素の disconnect で abort されます。

`$updatedCallback` は引き続き binding 駆動です。stream 宣言だけでは headless な購読にならず、その value/status/error の live DOM binding が実際に適用されたときだけ callback の path に現れます。描画せずに stream の値へ反応したい場合は、そのパスに [`$watch`](#watch-watch) を宣言してください。観測契約は [stream リファレンス](docs/streams.md) を参照してください。

```html
<wcs-state>
  <script type="module">
    export default {
      prompt: "",

      $streams: {
        // フル形: LLM トークンストリームを累積
        tokens: {
          args:    (state) => state.prompt,                 // 依存はここでのみ捕捉される
          source:  (prompt, signal) => llmStream(prompt, signal),
          fold:    (acc, chunk) => acc + chunk,             // reduce（累積）
          initial: "",                                      // fold 指定時は必須
        },

        // 最小形: fold 省略 = latest（最新チャンクで置換）、args 省略 = 一度だけ起動
        ticker: {
          source: (_args, signal) => priceStream(signal),
        },
      },
    };
  </script>
</wcs-state>
```

| フィールド | 必須 | 契約 |
|---|---|---|
| `source` | ✔ | `(args, signal) => AsyncIterable \| ReadableStream \| Promise<同>`。**`AbortSignal` を必ず尊重すること** —— restart / 破棄はこの signal で駆動される |
| `args` | — | readonly な state proxy を受ける同期・純粋関数。ここで読んだパスが依存として捕捉される。省略時は一度だけ起動し restart しない |
| `fold` | — | 同期関数 `(acc, chunk) => next`。省略時は latest（チャンクで置換）。毎回新しい値を返すこと —— `acc` の in-place 変異は非サポート |
| `initial` | `fold` 指定時 ✔ | 初期値。起動・restart のたびにプロパティはこの値にリセットされる |

stream の値は普通のプロパティで、コンパニオンの status / error は読み取り専用の名前空間から参照できます：

```html
<p data-wcs="textContent: tokens"></p>
<p data-wcs="textContent: $streamStatus.tokens"></p>  <!-- "idle" | "active" | "done" | "error" -->
<p data-wcs="textContent: $streamError.tokens"></p>   <!-- 直近のエラー。(re)start で null -->
```

error 時、プロパティは直前の fold 結果を保持し、エラーは `$streamError.<name>` に入ります。`done` / `error` の stream も依存の変化で restart します（再試行 = 依存の叩き直し）。

**イベント API の橋渡し** —— 実際の source の多くはコールバック型（`EventSource`・`WebSocket`・DOM イベント）で、async iterable ではありません。標準の `ReadableStream` で包んでください: `start` で enqueue し、`cancel` でリソースを解放します。`AbortSignal` には一切触れません —— restart / 破棄時は runtime が reader を cancel し、parked read を強制解放して `cancel()` まで届けます：

```js
$streams: {
  metrics: {
    args: (state) => ({ host: state.host }),
    source: ({ host }) => {
      const es = new EventSource(`/api/metrics?host=${host}`);
      return new ReadableStream({
        start(controller) {
          es.addEventListener("metric", (e) => controller.enqueue(JSON.parse(e.data)));
        },
        cancel() { es.close(); },   // restart / 破棄時に走る
      });
    },
    fold: (acc, sample) => [...acc, sample].slice(-20),
    initial: [],
  },
},
```

手書きの async generator も producer 側の制御が要るときは引き続き完全サポートですが、abort 救済は*部分的*です: `signal` を無視して `await` で park した generator は外から強制解放できません。イベント API の橋渡しには `ReadableStream` 形を推奨します。

重要な規範：

- **協調キャンセル（MUST）** —— `source` は渡された `AbortSignal` を必ず監視し、発火したら生産を停止すること。`ReadableStream` の source はこの契約を `cancel()` コールバック経由で自動的に満たします（abort 時に runtime が reader を cancel します）。自前の async iterable だけが `signal` を自分で監視する必要があります。
- **有界 fold** —— 需要は producer に逆流しません（backpressure は明示的に放棄）。無限 / 長寿命ストリームでは latest・count・last-N（`(acc, chunk) => [...acc.slice(-99), chunk]`）・ウィンドウ集計など有界な fold を使うこと。生の全チャンク累積は有限ストリーム限定。
- **`args` は同期** —— Promise を返すとエラー。`args` 内での wildcard 読みも拒否されます。
- **自己依存・相互サイクルの禁止** —— `args` が自 stream の値や status を読むとエラーになります。2 つの stream の相互サイクル（A の `args` が B の値を読み、B の `args` が A の値を読む）は検出されず無限 restart になるため組まないこと。一方向のチェイン（A の値を B の `args` が読む）は正当です。
- **SSR では起動しない** —— サーバーでは宣言のパースとプロパティの実体化（`initial`）のみ行い、source は実行されません。クライアント側は通常どおり起動します。

完全な契約 —— ライフサイクルと所有権・restart セマンティクス・flush 粒度・スコープ外リスト —— は [docs/streams.ja.md](docs/streams.ja.md) を参照してください。

## 評価のきっかけ（demand root）

パス getter は **lazy** です。誰も読まなければ一度も評価されません。したがって「この getter は走るか」は getter 自身を読んでも決まりません —— **需要（demand）がどこから来るか**で決まります。

需要の根は **3 つだけ**です：

| 根 | 場所 | 描画に依存するか |
|---|---|---|
| **live DOM バインディング** | `data-wcs` / mustache / コメントバインディング | **する**（その要素が消えると需要も消える） |
| **`$watch` の宣言** | state 側 | しない（headless） |
| **`$streams` の `args`** | state 側 | しない（起動・restart のたびに評価される） |

**`$updatedCallback` は根ではありません。** それは「バインディングが適用された結果」の報告であり、需要を作りません。

### 描画がプログラムの意味論を変えうる

この 3 つのうち 1 つ目が DOM にあることの帰結として、**表示専用のつもりの要素が購読の実体になり得ます**。実際に踏んだ例が [`examples/state-intersect-scroll`](../../examples/state-intersect-scroll) にあります：

```html
<!-- 表示のつもりだった要素。これが唯一の需要の根だった -->
<b data-wcs="textContent: $streamStatus.pageResult"></b>
```

```javascript
// $updatedCallback は binding 駆動 —— 上の <b> を消すと paths に現れなくなり、
// フィードの commit が黙って止まる
$updatedCallback(paths) {
  if (!paths.includes("$streamStatus.pageResult")) return;
  this.items = this.items.concat(this.pageResult.items);
}
```

**規則:** 描画に依存させたくないロジックは、`$watch`（または `$streams` の `args`）に根を置いてください。`$updatedCallback` は「描かれたものに追随する」用途に限ります。

上の例は `$watch` に置き換え済みで、`<b>` は表示専用に戻っています。この形（`$updatedCallback` が、どのバインディングにも現れないパスを判定に使っている）は **`wcs/updated-callback-unbound`** として静的に検出されます。

### 残る制約

需要の根が 3 か所に分かれること自体は変わりません。**ある getter が評価されるかを知るには、その 3 か所（ページの全バインディング・全 `$watch`・全 `$streams.args`）を見る必要があり、getter の定義だけを読んでも分かりません。** lint と DevTools の配線カバレッジはこの照合を機械にやらせるためのものです。

なお `$watch` に宣言したスカラー getter は **eager** になります（接続時に 1 回、以後は依存に触れたバッチごとに評価）。ワイルドカード行の getter は eager 化しません（初回評価がリスト全体を舐めるため）。

## Watch（`$watch`）

`$updatedCallback` は **binding 駆動** です。その更新で live DOM binding が実際に適用された path だけを報告するため、**描画していない値の変化は見えません**。**`$watch`** はその headless 版で、ページ上でそのパスがバインドされているかどうかに関わらず、state の変化で発火します（**ワイルドカードの行パスだけは例外**で、headless に成立させるには `$listKeys` が要ります。後述）。

```html
<wcs-state>
  <script type="module">
    export default {
      isLoading: false,
      items: [],
      startedAt: 0,

      $watch: {
        // 立ち上がり検出は cur/prev を自分で比較する
        isLoading(cur, prev) {
          if (cur === true && prev === false) { this.startedAt = Date.now(); }
        },

        // ワイルドカードパスは変化した行ごとに 1 回発火する
        //（リストを `for` で描画しているか、`$listKeys` の宣言が要る。後述）
        "items.*.price"(cur, prev, index) {
          this.lastPriceChange = `#${index}: ${prev} → ${cur}`;
        },
      },
    };
  </script>
</wcs-state>
```

ハンドラの `this` は **writable** な state proxy なので書き戻せます。その書き込みは次の更新バッチに乗ります。戻り値は無視され、await もされません。

| 引数 | 契約 |
|---|---|
| `cur` | drain 時点の値（そのバッチの確定値） |
| `prev` | **バッチ開始時点**の値（first-write-wins）。意味を持つのは**スカラのときだけ**（下記） |
| `...indexes` | ワイルドカードパスのときのみ。そのスコープ自身のループ添字（`$1` / `$2` と同じ規約） |

**`prev` はスカラ限定です。** same-value guard が既に読んでいる旧値を再利用するため watch のための追加読みは発生せず、その帰結として参照型（in-place 変異では同じ参照になるため）・`$postUpdate` 経由・`config.sameValueGuard` オフのときは `undefined` になります。

**`$watch` は独自の発火条件を持ちません。** 更新バッチに載ったものをそのまま発火します。これはうまく噛み合っていて、同値の primitive 書き込みは enqueue 前に落ちている（＝実質的に変化時のみ発火）一方、occurrence（`semantics: "event"` の property）は**意図的に**落とされないので `cur === prev` で発火します。エッジ検出が要るならハンドラ内で `cur` と `prev` を比較してください。

**getter を watch すると eager になります。** computed は本来 lazy で、依存は評価時にしか記録されません —— つまり描画していない getter は本来一度も発火しません。`$watch` に宣言すると接続時に 1 回評価され、以後は依存に触れたバッチの終端で毎回評価されます。`prev` は前回の評価値です。重い computed を watch すればその評価コストが毎バッチ乗り、getter 内の例外は watch 経由で表面化します。ワイルドカード getter（`items.*.tax`）は eager 化**しません**（初回評価がリスト全体を舐めることになるため）。この形は DOM にバインドされている場合にのみ発火し、`prev` は常に `undefined` です（行ごとの評価値を保持しないため）。

発火順序は 3 層に分かれ、利用者が意思を持てるのは真ん中の層だけです。

| 層 | 順序 | 制御 |
|---|---|---|
| 機構間 | `$updatedCallback` → `$watch` → `$streams` restart | 固定 |
| ハンドラ間 | `$watch` の宣言順 | **宣言を並べ替える** |
| 同一パスの行間 | `indexes` 昇順 | 固定 |

**機構間の層を動かす唯一のもの**が、`state` 参加者を受け付ける `<wcs-view-transition>` です。バインディング適用 —— したがって `$updatedCallback` —— がフレームで着地する一方、`$watch` と `$streams` restart は state アドレスを消費し DOM を見ないので、drain がキューされた microtask に留まります。タグがある間の順序は `$watch` → `$streams` restart → `$updatedCallback` です。この層を並べ替えるものはページ上でこれ 1 つだけです。[docs/timing-and-firing-contract.ja.md](https://github.com/wcstack/wcstack/blob/main/docs/timing-and-firing-contract.ja.md) §4.3 を参照してください。

主なルール:

- **ツリーのパスのみ** —— パスに `@`（v1 の名前セレクタ）は書けません。含む宣言は loud に拒否されます。
- **中間値は観測できません** —— 1 バッチ内の `a → b → c` は `cur = c` / `prev = a` で 1 回だけ発火します（binding 更新と同じ契約）。
- **行単位の差分を見たいなら `$listKeys`** —— 未宣言のまま配列全体を代入すると、行 watch は**全行**について `prev === undefined` で発火します（どの行もパス書き込みを通っていないため）。`$listKeys` を宣言すればキー突合が per-field 書き込みに分解するので、変化した行だけが発火し `prev` もスカラで取れます。
- **headless な行 watch には `$listKeys` が必要** —— `$watch` が単独では headless にならない唯一の箇所です。`items` から `items.*.price` への展開はリストの `for` バインディングが駆動しており、watch を宣言してもそのパスをリストとしては登録しません（意図的）。したがって `for` バインドも `$listKeys` も無い状態で配列を代入すると、行 watch は**一度も**発火しません。`$listKeys` を宣言する（キー突合がフィールドごとにパス書き込みするので展開を経由しない）か、リストを描画してください。スカラーパスは `user.name` のようなネストしたものも含め、この条件なしに headless で発火します。
- **ハンドラの例外は隔離されます** —— throw はコンソールに報告され、残りの watch（と stream の restart）は続行します。loud fail する `$connectedCallback` / `$updatedCallback` とは異なる扱いです。
- **書き込みの連鎖には上限があります** —— ハンドラの書き込みは新しいバッチを作るため、相互に書き合う watch は無限ループになり得ます。32 段で打ち切り、コンソールに報告します（値と DOM は巻き戻しません）。
- **マウントされた `bind-component` スコープでは実行されません** —— マウントされたコンポーネントは宣言面を実行せず、`$watch` の宣言があると 1 回だけ console.warn でルート state（またはボリューム —— `<wcs-state mount>` は `$watch` / `$listKeys` / `$updatedCallback` を持てます）へ誘導します（`$streams` も同様）。plain な（配線なし Shadow の）子は独立ツリーを持つので宣言できます。
- **SSR では実行されません** —— ハンドラの副作用がサーバーとクライアントで二重に走るためです。

## Inputs と属性ミラー

`wcBindable.inputs` は一方向のプロパティ入力（state → 要素）を宣言します。エントリに `attribute` を設定すると、フレームワークはプロパティを書き込むたびにその値を当該 HTML 属性へも書き込むため、`attributeChangedCallback`・CSS の属性セレクタ・DevTools がすべてプロパティ値と同期し続けます。

`inputs` は属性ミラーのためだけのメタデータではありません。方向認識初期同期（既定 ON）の下では、メンバが **state から settable であること**を示すのが `inputs` です。settable なのに `properties` にしか宣言されていないメンバは output-only 扱いになり、state からの書き込みが抑止されます — [バインディング authority](#バインディング-authority-init--sync) を参照してください。

```javascript
class MyChip extends HTMLElement {
  static wcBindable = {
    protocol: "wc-bindable", version: 1,
    properties: [],
    inputs: [
      { name: "data", attribute: "data" },        // プロパティ名 === 属性名
      { name: "labelText", attribute: "label-text" }, // kebab-case ミラー
      { name: "internal" },                       // ミラーなし、プロパティのみ
    ],
  };
}
```

```html
<my-chip data-wcs="data: chip.payload; labelText: chip.title"></my-chip>
```

state が値を更新すると、プロパティと属性の両方が書き込まれます：

```text
chip.payload = { id: 1 }    → element.data = { id: 1 } かつ setAttribute("data", '{"id":1}')
chip.title   = "新着"        → element.labelText = "新着" かつ setAttribute("label-text", "新着")
chip.payload = null          → element.data = null かつ removeAttribute("data")
```

属性値のエンコード：

| 値の型 | ミラーされる属性 |
|---|---|
| `string` / `number` / `boolean` / `bigint` | `String(value)` |
| `null` / `undefined` | 属性を削除 |
| `object` / `array` | `JSON.stringify(value)`（循環参照時は `String(value)` にフォールバック） |

補足：

- `attribute` を**持たない** `inputs` エントリはプロパティのみ —— 値はプロパティに書き込まれるが属性には触れない
- ミラーはベストエフォート: `setAttribute` の失敗は握りつぶされ（`debug` 警告付き）、プロパティ書き込みをブロックしない
- ネイティブ HTML 要素は `inputs` を完全に無視する —— ミラーは `static wcBindable` を公開するカスタム要素でのみ有効になる

## コンポーネント機構の選び方

カスタム要素に独自の状態を持たせる機構は 2 つあり、**排他**です。コンポーネントごとにどちらか一方を選びます。

| | [DCC](#宣言的カスタムコンポーネント-dcc) | [`bind-component`](#web-component-バインディング) |
|---|---|---|
| 要素の定義方法 | HTML だけ（`data-wc-definition` + Declarative Shadow DOM） | 自分で書く `class extends HTMLElement` |
| 状態の在処 | テンプレート内のインライン `<script type="module">`（インスタンスごとにロード） | コンポーネントインスタンスのプロパティ（`this.state`） |
| `static wcBindable` | `$bindables` / `$commands` から生成 | **無し** — wc-bindable の producer ではない |
| 親から値をバインド | `count: parentCount`（双方向・変更イベントあり） | `state.msg: user.name`（パスマッピング） |
| 親からメソッド起動 | `command.bumpBy: $command.bump` | 不可 — クラス側に公開して自分で呼ぶ |
| spread（`...: obj`） | 使える | 使えない（`wcBindable` 宣言が必要） |
| コンポーネント自身の読み書き | 要素の `this.count` | `this.state.msg` |

判断の目安は「**JavaScript クラスが無いなら DCC、既にクラスを書いているなら `bind-component`**」です。併用はエラーになります。`data-wc-definition` ホストの中に `<wcs-state bind-component>` を置くのは設定ミスです — DCC の状態はテンプレートに属し、インスタンスごとにロードされるためです。

`bind-component` のコンポーネントが wc-bindable プロトコルの外に留まっているのは意図的です。宣言されたプロパティ面ではなく**パス**で配線するのがこの機構だからで、`wcBindable` 宣言を必要とする spread と command token が使えないのはその帰結です。

## 宣言的カスタムコンポーネント (DCC)

JavaScript のクラス定義なしで、**HTML だけ**でカスタム要素を定義できます。`data-wc-definition` と Declarative Shadow DOM (`<template shadowrootmode>`) を使い、リアクティブな状態を持つ再利用可能なコンポーネントをインラインで宣言します。

### 基本的な定義

```html
<!-- 1. コンポーネントを定義（CSSで非表示） -->
<my-counter data-wc-definition>
  <template shadowrootmode="open">
    <p>{{ count }}</p>
    <button data-wcs="onclick: increment">+1</button>
    <wcs-state>
      <script type="module">
        export default {
          count: 0,
          increment() { this.count++; },
          $bindables: ["count"]
        };
      </script>
    </wcs-state>
  </template>
</my-counter>

<!-- 2. 使う — 各インスタンスが独自の状態を持つ -->
<my-counter></my-counter>
<my-counter></my-counter>
```

`<wcs-state>` が `data-wc-definition` 付きのホスト内にあることを検出すると：

1. 状態オブジェクトをロード（`<script type="module">` または `src="*.js"`）
2. getter/setter/メソッドをプロトタイプに定義したカスタム要素クラスを生成
3. `customElements.define()` で登録

定義要素は非表示になり、各インスタンスはテンプレートを自身の Shadow DOM にクローンして、独自の `<wcs-state>` を初期化します。

### 推奨 CSS

```css
:not(:defined) { display: none; }
[data-wc-definition] { display: none; }
```

### `$bindables` / `$commands` と wc-bindable プロトコル

`$bindables` は変更イベント付きのコンポーネント**プロパティ**として公開する状態プロパティを、`$commands` は起動可能な**コマンド**として公開する状態メソッドを宣言します。この 2 つで [wc-bindable プロトコル](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/main/README.md)の宣言が組み立てられます：

```javascript
export default {
  count: 0,
  bumpBy(step) { this.count += step; },
  $bindables: ["count"],
  $commands: ["bumpBy"]
};
```

これにより以下が生成されます：

- クラスの `static wcBindable` — フレームワークアダプタ用のプロトコルメタデータ。各 `$bindables` メンバは `properties` と `inputs` の両方に宣言され（双方向）、方向認識初期同期の下でも親 state → DCC の書き込みが機能します — [バインディング authority](#バインディング-authority-init--sync) 参照。各 `$commands` メンバは `commands` エントリになります
- `$bindables` はプロトタイプの getter/setter、`$commands` はメソッド — いずれもリアクティブプロキシ経由
- `CustomEvent` のディスパッチ — `$bindables` メンバが変更されるたびに `my-counter:count-changed` が発火

`commands` エントリは常に `async: true` です。DCC のメソッドは内側の `<wcs-state>` の初期化に chain するため、状態側のメソッドが `async` でなくても戻り値は Promise になります。

どちらの宣言もコンポーネント定義時に `$commandTokens` と同じ強度で検証されます。次はいずれもエラーになります。

- 配列でない
- 非空文字列でないエントリ
- `$` 始まりのエントリ（内部プロパティはコンポーネントの prototype に公開されません）
- 重複したエントリ — これは従来サイレントに壊れていました。重複名があると `wcBindable` 宣言全体が読み取り不能になり、その要素が黙って双方向バインド不可になります
- 状態に存在しないエントリ（自身とプロトタイプチェーンの両方を探索します。`$streams` の名前は値プロパティがインスタンスごとに実体化されるため「存在する」と見なされます）
- `$bindables` にメソッドを書いた場合、または `$commands` に値プロパティを書いた場合

### DCC のメソッドを起動する

`$commands` メンバは、I/O ノードと同じように親 state から [command token](#command-tokenメソッドバインディング) で起動できます：

```html
<wcs-state>
  <script type="module">
    export default {
      $commandTokens: ["bump"],
      fire() { this.$command.bump.emit(3); }
    };
  </script>
</wcs-state>

<button data-wcs="onclick: fire">bump</button>
<my-counter data-wcs="command.bumpBy: $command.bump"></my-counter>
```

位置引数はそのまま素通しされるので、`emit(3)` はコンポーネント側の状態の `bumpBy(3)` を呼びます。

### DCC プロパティへのバインディング

他の `<wcs-state>` インスタンスから、通常の Web Component と同じように DCC プロパティにバインドできます：

```html
<my-counter data-wcs="count: parentCount"></my-counter>

<wcs-state>
  <script type="module">
    export default { parentCount: 0 };
  </script>
</wcs-state>
<div data-wcs="textContent: parentCount"></div>
```

### Shadow Root モード

`open` と `closed` の両モードに対応しています：

```html
<my-component data-wc-definition>
  <template shadowrootmode="closed">
    <!-- closed shadow DOM -->
  </template>
</my-component>
```

### 内部プロパティ

`$` プレフィックス付きのプロパティは内部用で、コンポーネントのプロトタイプには公開されません：

| プロパティ | 用途 |
|----------|---------|
| `$bindables` | 観測可能プロパティの宣言 |
| `$commands` | 起動可能メソッドの宣言 |
| `$connectedCallback` | ライフサイクルフック（各インスタンスで実行） |
| `$disconnectedCallback` | クリーンアップフック |
| `$updatedCallback` | 状態変更後に呼ばれる |

## SVG サポート

全てのバインディングが `<svg>` 要素内で動作します。SVG 属性には `attr.*` を使用します：

```html
<svg width="200" height="100">
  <template data-wcs="for: points">
    <circle data-wcs="attr.cx: .x; attr.cy: .y; attr.fill: .color" r="5" />
  </template>
</svg>
```

## ライフサイクルフック

状態オブジェクトに `$connectedCallback` / `$disconnectedCallback` / `$updatedCallback` を定義すると、初期化・クリーンアップ・更新時のフックとして利用できます。

```html
<wcs-state>
  <script type="module">
    export default {
      timer: null,
      count: 0,

      // <wcs-state> が DOM に接続された時に呼ばれる
      async $connectedCallback() {
        const res = await fetch("/api/initial-count");
        this.count = await res.json();
        this.timer = setInterval(() => { this.count++; }, 1000);
      },

      // <wcs-state> が DOM から切断された時に呼ばれる（同期のみ）
      $disconnectedCallback() {
        clearInterval(this.timer);
      }
    };
  </script>
</wcs-state>
```

| フック | タイミング | 非同期 |
|---|---|---|
| `$connectedCallback` | 初回接続時は状態初期化後、再接続時は毎回呼び出し | 可（await される） |
| `$disconnectedCallback` | 要素が DOM から削除された時 | 不可（同期のみ） |
| `$updatedCallback(paths, indexesListByPath)` | live binding に更新が適用された後に呼び出し | 可（await されない） |

`$disconnectedCallback` を除くすべてのフックで `async` を使用できます。リアクティブ Proxy はすべてのプロパティへの代入を変更として検知します。そのため、標準の `async/await` による処理とプロパティへの直接代入だけで非同期ロジックが完結します。ローディングフラグの切り替え、取得したデータの格納、エラーメッセージの更新といった処理もすべて単なるプロパティ代入で行えるため、非同期状態を管理するための複雑な抽象化機能は必要ありません。

- フック内の `this` は読み書き可能な状態プロキシです。
- `$connectedCallback` は要素が接続される**たびに**呼ばれます（一度削除された後の再接続も含みます）。再確立が必要なセットアップ処理に適しています。
- `$disconnectedCallback` は同期的に呼び出されます。タイマーのクリア、イベントリスナーの削除、リソースの解放といったクリーンアップ処理に使用してください。
- `$updatedCallback(paths, indexesListByPath)` は、その drain で live binding が適用された path の一覧を受け取ります。binding のない state 書き込みでは呼ばれず、`paths` にも現れません。ワイルドカードをもつパスが更新された場合は、`indexesListByPath` から対象のインデックス情報も取得可能です。マウントされたコンポーネントのマーカーパス（`#m…`）は `paths` に現れません — コンポーネントの私有キーは私有のままです（DevTools の overlays 表示で見えます）。`async` を使用できますが、戻り値は await されません。
- Web Component を使用している場合は、コンポーネント側に `async $stateReadyCallback(stateProp)` を定義おくことで、`bind-component` でバインドした状態が利用可能になった瞬間にフックとして呼び出されます。

## 遷移アニメーション

入場アニメーションにこのパッケージは要らない。新しい `for` 行も mount する `if` 分岐も「新しく挿入された要素」なので、素の CSS で足りる。

```css
li {
  transition: opacity 0.2s, transform 0.2s;
  @starting-style { opacity: 0; transform: translateY(-4px); }
}
```

そこへ届かないのが**退場**と**移動**。削除された行は同期で detach され、並べ替えには中間状態が無い。[`@wcstack/view-transition`](https://github.com/wcstack/wcstack/tree/main/packages/view-transition) を足すと drain の DOM 変更が View Transition の中で行われ、変更前の状態はブラウザがスナップショットしてくれる。

```html
<script type="module" src="https://esm.run/@wcstack/view-transition/auto"></script>
<wcs-view-transition naming="auto"></wcs-view-transition>
```

そのタグが `state` 参加者を受け付けている間、知っておくべき帰結が 2 つある。

- drain は microtask ではなくフレームで着地する。state に書いてから `await Promise.resolve()` で DOM を読むコードは遷移を待つ必要がある。`$updatedCallback` はバインディング適用の直後という*位置*こそ変わらないが、その適用ごと 1 フレーム後ろへずれる。
- `$watch` と `$streams` restart は元の microtask に留まるため、`$updatedCallback` の**前**に走るようになる。

適用すべきバインディングが実際にあるバッチだけがタグへ渡されるので、headless なパスへの書き込みが遷移を起こすことはない。タグが無ければ drain は従来どおり。[docs/timing-and-firing-contract.ja.md](https://github.com/wcstack/wcstack/blob/main/docs/timing-and-firing-contract.ja.md) §4.3 参照。

## 診断と失敗の扱い

### 存在しないパスへの配線は報告されます

配線したパスが state 上で解決しないことが**確実**なとき、バインド確立時（`$watch` は宣言時）に 1 回だけ警告します。診断 code はコンソール・`@wcstack/lint`・VS Code 拡張で共通です：

```
[@wcstack/state] [wcs/binding-path-missing] Bound path "user.nmae" does not resolve on the state tree:
"nmae" is not declared. Did you mean "name"? Updates to this path will be silently
dropped. Validate statically: npx @wcstack/lint <file>.
```

| 状況 | 挙動 |
|---|---|
| ネストしたパスの打ち間違い（`user.nmae`） | `console.warn`（`wcs/binding-path-missing`）。更新は届かないままなので、直すのは書き手 |
| トップレベルのパスの打ち間違い（`cout`） | 読み取り時に throw。文面は上と同じ語彙（did-you-mean 付き） |
| `$watch` のキーの打ち間違い | `console.warn`（`wcs/watch-path-missing`）。単一セグメントでも報告する |

判定は**過小近似**です。静的に決められない形では黙ります —— 誤検知でページを騒がせないことを優先しているためで、以下はすべて警告しません：

- 親が `null` / `undefined`（初期値 `null` に後から代入する形）
- 初期値が空配列のリストの行フィールド（行の形が分からない）
- 途中の getter の戻り値のサブプロパティ
- マウントされたコンポーネントのマーカーパス（`#m…` —— 私有キー・getter の実体はマウントのオーバーレイ側にあり raw state には無い）
- `$` 始まりの予約名前空間（`$command.*` など）

裏を返すと、**警告が出ない ＝ 正しい保証にはなりません**。網羅した検査は `npx @wcstack/lint <file>` 側で行ってください。

### 添字の本数・階数・循環も検査されます

パス文字列から機械的に決まる整合は、実行時にも lint にも同じ診断 code で現れます。

| 診断 | 何を見るか | 直し方 |
|---|---|---|
| `wcs/index-arity` | `$resolve(path, indexes)` は `*` の本数と**厳密一致**、`$getAll(path, indexes)` / `$setAll(path, indexes, …)` は**上限**（不足は「残りの階層を全展開」という正当な接頭辞） | 本数を合わせる |
| `wcs/wildcard-rank` | パスの `*` の本数（と `$N` の N）が、囲む `for` の段数を超えていないか | `for` を足すか、`$resolve(path, indexes)` で行を明示する |
| `wcs/getter-cycle` | パス getter どうしが循環参照していないか | 循環を断つ |

`$resolve` / `$getAll` の**添字の超過は以前は黙って捨てられ**、取り違えたまま「もっともらしい値」が返っていました。現在はどちらもエラーです：

```javascript
// ❌ "*" は 1 本しか無いのに 2 本渡している → 以前は items[0] の値が返っていた
this.$resolve("items.*.price", [row, col]);

// ✅ 2 次元なら 2 本
this.$resolve("matrix.*.*", [row, col]);
// ✅ $getAll の不足は「残りを全部」の意味なので正当
this.$getAll("matrix.*.*", [row]);
```

### バインディング 1 本の失敗は 1 本に閉じ込められます

バインディングの適用が throw しても、そのバッチの残り・`$updatedCallback`・`$watch`・`$streams` の restart はすべて続行します。失敗は握り潰されず、`console.error` と DevTools（`state:binding-apply-error`）に出ます。

```
[@wcstack/state] binding "text: items.*.label" failed to apply; the rest of this batch continues.
```

隔離しない場合、1 本の throw が「値は新しいのに DOM は途中まで」という半端な状態を作り、しかも `$watch` と stream の restart が丸ごと消えていました（README のこの下にある発火順の契約が黙って破れる）。

### 値と DOM は巻き戻しません

異常系はすべて「報告して続行」で、適用済みの値を戻すことはありません。これは以下で共通の姿勢です：

| 機構 | 上限 | 超過時 |
|---|---|---|
| 因果伝播の hop | 32 | その transaction の未処理レコードのみ quarantine |
| `$watch` の書き込み連鎖 | 32 | そのバッチの watch 発火をスキップ |
| バインディングの適用失敗 | — | その 1 本のみスキップ |

## 設定

`bootstrapState()` に部分的な設定オブジェクトを渡します：

```javascript
import { bootstrapState } from '@wcstack/state';

bootstrapState({
  locale: 'ja-JP',
  debug: true,
  enableMustache: false,
  tagNames: { state: 'my-state' },
});
```

全オプションとデフォルト値：

| オプション | デフォルト | 説明 |
|---|---|---|
| `bindAttributeName` | `'data-wcs'` | バインディング属性名 |
| `tagNames.state` | `'wcs-state'` | 状態要素のタグ名 |
| `tagNames.ssr` | `'wcs-ssr'` | SSR ハイドレーションデータ要素のタグ名 |
| `locale` | `<html lang>`、無ければ `'en'` | ロケール依存フィルタ（`locale` / `date` / `time` / `datetime`）のロケール — [ロケール](#ロケール)を参照 |
| `debug` | `false` | デバッグモード |
| `enableMustache` | `true` | `{{ }}` 構文の有効化 |
| `enableDirectionalInitialSync` | `true` | 方向認識のバインディング authority（`#init=` / `#sync=` バインド modifier）— [バインディング authority](#バインディング-authority-init--sync) 参照。既定 on。`false` で opt-out |
| `enablePropagationContext` | `true` | バインド間の因果伝播トラッキング（echo/diamond のループ防止）。既定 on。`false` で opt-out |
| `enableContractAnalyzer` | `false` | opt-in の開発時 contract analyzer（`analyzeContract` を公開） |
| `sameValueGuard` | `true` | 現在値と `Object.is` で同値なプリミティブ書き込みを enqueue 前に落とす — バインディングと `$watch` は実質「変化時のみ」発火する（参照型は常に通す）。`false` で同値書き込みを通し、`$watch` の `prev` は `undefined` になる |

### ロケール

ロケールで書式化するフィルタは 4 つある — `locale` / `date` / `time` / `datetime`。
これらは `config.locale` を読み、その既定は **`<html lang>`** である。

```html
<html lang="ja-JP">
  <script type="module" src="https://esm.run/@wcstack/state/auto"></script>
```

他に何も要らない。`<html lang>` はページの言語を書く HTML 標準の場所であり、
そこを既定にすればロケールの正本が 1 つで済む。同時に、**CDN 一発のページが
ロケールを設定できるようになる** — `auto` は `bootstrapState()` を引数なしで呼ぶので、
これが無いと渡す口が無かった。明示指定（`bootstrapState({ locale })`）は常に優先し、
不正な BCP-47 タグは `Intl` の中で落ちる前に警告して無視する。

**`config.locale` を後から変えても何も再描画されない。** これは state ではなく
グローバル設定なので、依存グラフに載らない。フィルタ自体はバインド構築時に
取り込むのではなく**適用のたびに読む**ので、別の理由で再描画されたバインドは新しい値を
拾う — 起動順序の事故から復帰するには足りるが、ページの言語を切り替えるには足りない。
言語はページが描画される前に決めること。マークアップに `<html lang>` を書くか、
`<head>` の同期スクリプトで書けば構造的にそうなる。

呼び出しごとの上書き（`price|locale(fr-FR)`）は従来どおり使え、こちらはバインド式の
一部なのでバインド時に固定される。リロードなしで言語を切り替えたい場合は
[docs/i18n-design.md](../../docs/i18n-design.md) を参照。短く言えば、翻訳はフィルタでは
なくパスに置く。

> この 3 つは **architecture-hardening** 機能で、規範は `docs/architecture-hardening/` に
> あります。`enablePropagationContext` は**既定 on** — write-path コストは一方向バインドで
> ほぼゼロ（echo しうる双方向 wire のみ因果 bookkeeping を行う）で、フラグは恒久的な
> opt-out として残します。`enableDirectionalInitialSync` も**既定 on**: プロパティ単位で
> 初期同期の authority を割り当てます（output-only な `wcBindable` メンバは初期値を
> element→state で読み取り、双方向 / input メンバは state→element を維持）。setup-path
> コストは初期 render の 5% 未満（producer-value observer は echo しうる双方向 wire にのみ
> 登録）で、フラグは恒久的な opt-out として残します。`enableContractAnalyzer` は opt-in
> （既定 `false`・無効時ランタイムコストゼロ）で、有効な場合、公開 API `analyzeContract()`
> が稼働中の `static wcBindable` サーフェスと sidecar manifest の drift を開発時診断として
> 報告します。

## ページをテストする

`<wcs-state>` で組んだページは素の DOM なので、[happy-dom](https://github.com/capricorn86/happy-dom) でヘッドレスにテストできます — ブラウザ不要・ビルド不要・テスト専用 API 不要。レシピは 3 つ、いずれも書いてあるとおりに動きます（レシピ 1 は同じ行を実行する [`__tests__/readme.testingRecipe.test.ts`](__tests__/readme.testingRecipe.test.ts) で固定しています）。

1 import で済ませたいなら [`@wcstack/testing`](../testing/README.ja.md) がレシピ 1 を `mount()` / `settle()` / `fire()` にまとめています（`<wcs-router>` も待ちます）。以下の素のレシピはそれ無しでも有効です。

### 1. vitest + happy-dom

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "happy-dom", setupFiles: ["./tests/setup.ts"] },
});
```

`tests/setup.ts` — 要素の登録を 1 回だけ行い、インラインの `<script type="module">` state を `data:` URL ローダーに回します（Node は `blob:` URL を import できないため、この行が無いとインライン script の state は永久に読み込み中になります）:

```ts
import { bootstrapState } from "@wcstack/state";

bootstrapState();
URL.createObjectURL = undefined as any;
```

テスト:

```ts
import { expect, it } from "vitest";
import { getBindingsReady } from "@wcstack/state";

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

it("描画・再描画・ハンドラ実行", async () => {
  // 1. テスト対象の断片をマウント
  document.body.innerHTML = `
    <wcs-state json='{"count": 1, "items": ["apple", "banana"]}'></wcs-state>
    <p id="count" data-wcs="textContent: count"></p>
    <ul id="items">
      <template data-wcs="for: items">
        <li data-wcs="textContent: items.*"></li>
      </template>
    </ul>
  `;

  // 2. state 要素を待ち、続けて `document` 配下の全バインドを待つ
  const stateEl = document.querySelector("wcs-state") as any;
  await stateEl.connectedCallbackPromise;
  await getBindingsReady(document);

  // 3. 初期描画を検証
  expect(document.querySelector("#count")!.textContent).toBe("1");
  expect(document.querySelectorAll("#items li").length).toBe(2);

  // 4. writable プロキシ経由で書く — ハンドラがやっていることと同じ
  await stateEl.createStateAsync("writable", async (state: any) => {
    state.count = 42;
    state.items = [...state.items, "cherry"];
  });
  await settle();

  // 5. 再描画を検証
  expect(document.querySelector("#count")!.textContent).toBe("42");
  expect(document.querySelectorAll("#items li").length).toBe(3);
});
```

ユーザー操作と同じ経路で動かすなら、state はインライン（メソッド込み）のまま DOM イベントを発火します。`data-wcs="onclick: up"` のハンドラは `button.click()` で走り、`settle()` 1 回の後に DOM へ反映されます。

- `getBindingsReady(root)` は `root`（`document` か shadow root）配下の全バインド構築が終わると resolve し、バインド初期化に失敗すると reject します（v1.26+）。
- 更新はマイクロタスク境界で収束します。書き込み後の `setTimeout(0)` 1 回で十分です。
- `state.items = [...state.items, "cherry"]` がリアクティブな書き方です — `state.items.push()` は観測されません（ハンドラ内と同じ規則）。
- happy-dom は `customElements.define` 時に既存ノードを**差し替えて**アップグレードします。「遅れて define された同一ノードに値が届く」はヘッドレスでは検証できません。happy-dom と実ブラウザのイベントタイミング差ももう 1 つの死角なので、そこは実ブラウザ e2e（Playwright）を 1 本残してください。
- happy-dom の `textContent` setter は数値 `0` を空文字にします（ブラウザは `"0"`）。このレシピでは `textContent: count` のバインドが 0 のとき `""` に読めます。state の値で assert するか、setter をシムする `@wcstack/testing` の `mount()` を使ってください。

### 2. 素の Node（vitest なし）

`@wcstack/server` が SSR に使っているグローバル差し替えをそのまま export しているので再利用します。**`@wcstack/state` は `installGlobals` の後に動的 import** してください — 要素クラスはモジュール評価時に基底クラスを決めるので、ファイル先頭で静的 import すると happy-dom が構築できない要素が登録されます:

```js
import { Window } from "happy-dom";
import { installGlobals } from "@wcstack/server";

const window = new Window({ url: "http://localhost/" });
const restore = installGlobals(window);   // document, customElements, HTMLElement, ...（GLOBALS_KEYS）
try {
  const { bootstrapState, getBindingsReady } = await import("@wcstack/state");
  bootstrapState();
  // ... 以降はレシピ 1 と同じ mount / await / assert
} finally {
  restore();
  await window.happyDOM.close();
}
```

`installGlobals` は `URL.createObjectURL` の無効化も行うので、インライン script の state はレシピ 1 と同じ経路で読み込まれます。

### 3. 描画結果のスナップショット

`@wcstack/server` の [`renderToString()`](../server/README.ja.md) は描画済みマークアップを文字列で返します。保存したスナップショットと比較してください:

```ts
import { expect, it } from "vitest";
import { renderToString } from "@wcstack/server";

it("描画結果がスナップショットと一致する", async () => {
  const html = await renderToString(`
    <wcs-state json='{"items": ["apple", "banana"]}' enable-ssr></wcs-state>
    <ul><template data-wcs="for: items"><li data-wcs="textContent: items.*"></li></template></ul>
  `);
  expect(html).toMatchSnapshot();
});
```

## TypeScript サポート

`defineState()` で状態オブジェクトをラップすると、メソッドや getter 内の `this` に型補完が効きます。ランタイムコストはゼロ（アイデンティティ関数）です。

```typescript
import { defineState } from '@wcstack/state';

export default defineState({
  count: 0,
  users: [] as { name: string; age: number }[],

  increment() {
    this.count++;            // ✅ number
    this["users.*.name"];    // ✅ string（ドットパス型解決）
    this.$getAll("users.*.age", []); // ✅ API メソッド
  },

  get "users.*.ageCategory"() {
    return this["users.*.age"] < 25 ? "Young" : "Adult";
  }
});
```

ユーティリティ型 `WcsPaths<T>` と `WcsPathValue<T, P>` もエクスポートされます。詳細は [docs/define-state.ja.md](docs/define-state.ja.md) を参照してください。

`defineState()` が型を付けるのは state ファイルです。その型を HTML まで運ぶのが [`@wcstack/typescript`](../typescript/README.ja.md) の 2 つの CLI で、`wcs-schema` は `@wcstack/lint` と VS Code 拡張が `data-wcs` パスの検証に使う `stateSchema` sidecar を書き出し、`wcs-tsc` はインラインの `<script type="module">` state に TypeScript コンパイラを掛けます。全体像は [docs/typescript.ja.md](../../docs/typescript.ja.md)。

## API リファレンス

### `bootstrapState()`

状態システムを初期化します。`<wcs-state>` カスタム要素を登録し、DOM コンテンツ読み込みハンドラを設定します。

```javascript
import { bootstrapState } from '@wcstack/state';
bootstrapState();
```

### その他のエクスポート

| エクスポート | 説明 |
|---|---|
| `getBindingsReady(root)` | `root`（`document` または shadow root）配下の全バインディングが構築されたら解決。バインディング初期化が失敗すれば reject |
| `buildBindings(root)` | `document` / `ShadowRoot` 配下のバインディングを明示的に構築する — その root に最初に登録された `<wcs-state>` がスケジュールするもの |
| `getConfig()` | 現在の設定（読み取り専用ビュー） |
| `defineState(obj)` | メソッドと getter 内の `this` に型を付けるアイデンティティ関数 — [TypeScript サポート](#typescript-サポート) 参照 |
| `VERSION` | パッケージのバージョン。`<wcs-ssr>` に刻印され、ハイドレーション時に照合される |
| `getWcsManifest()` / `WCS_MANIFEST_VERSION` | バインディング構文・組み込みフィルタ・予約名の機械可読 manifest — 実装から導出され、`@wcstack/lint` と VS Code 拡張が消費する |
| `builtinFilterMeta` | 全組み込みフィルタの引数・戻り値メタデータ |
| `analyzeContract()` | 開発時の contract analyzer。`enableContractAnalyzer` が off なら no-op |

ツール向けのサブパスエントリ: `@wcstack/state/parser`（`data-wcs` パーサを DOM 非依存の純関数として公開）、`@wcstack/state/manifest`、`@wcstack/state/wcs-manifest.json`（manifest をビルド済み JSON として公開）。

### `<wcs-state>` 要素

| 属性 | 説明 |
|---|---|
| `mount` | この state をルートツリーへ**ボリューム**として接ぎ木する静的ツリーパス（v2 — 撤去された `name` 属性の後継。ツリーは 1 root に 1 本） |
| `state` | `<script type="application/json">` 要素の ID |
| `src` | `.json` または `.js` ファイルの URL |
| `json` | インライン JSON 文字列 |
| `bind-component` | Web Component バインディングのプロパティ名 |
| `enable-ssr` | SSR を有効化: サーバーはこの state の `<wcs-ssr>` ハイドレーションデータを出力し、クライアントは再描画せずそこから復元する — [サーバーサイドレンダリング](#サーバーサイドレンダリング) 参照 |

### IStateElement

| プロパティ / メソッド | 説明 |
|---|---|
| `initializePromise` | 状態の完全な初期化時に解決される Promise |
| `connectedCallbackPromise` | `connectedCallback` の完了（state のロードと `$connectedCallback` の実行）で解決される Promise — テストのレシピが await するもの |
| `listPaths` | `for` ループで使用されるパスの Set |
| `getterPaths` | getter として定義されたパスの Set |
| `setterPaths` | setter として定義されたパスの Set |
| `createState(mutability, callback)` | 状態プロキシを作成（`"readonly"` または `"writable"`） |
| `createStateAsync(mutability, callback)` | `createState` の非同期版 |
| `setInitialState(state)` | プログラムから状態を設定（初期化前） |
| `nextVersion()` | バージョン番号をインクリメントして返す |

## アーキテクチャ

```
bootstrapState()
  └── registerComponents()              // <wcs-state> カスタム要素を登録

<wcs-state> connectedCallback
  ├── 置かれ方によりいずれか 1 つ:
  │   ├── _initializeDCC()              // data-wc-definition ホスト配下: DCC クラスを定義
  │   ├── _initializeVolume()           // mount=: このボリュームをルートツリーへ接ぎ木
  │   ├── _initializeBindWebComponent() // bind-component: ホストのツリーをマウント点でエイリアス
  │   └── _initialize()                 // ルート: 状態をロード (state属性 / src / json / script / API)
  │         └── setStateElement()       // WeakMap<Node, IStateElement> に登録 — 1 root 1 ツリー
  │               └── (rootNode への初回登録時)
  │                     └── queueMicrotask → buildBindings()
  ├── _callStateConnectedCallback()     // $connectedCallback が定義されていれば呼び出し

buildBindings(root)
  ├── waitForStateInitialize()          // 全 <wcs-state> の initializePromise を待機
  ├── convertMustacheToComments()       // {{ }} → コメントノードに変換
  ├── collectStructuralFragments()      // for/if テンプレートを収集
  └── initializeBindings()              // DOM 走査、data-wcs 解析、バインディング設定
```

### リアクティビティフロー

1. Proxy の `set` トラップによる状態変更 → `setByAddress()`
2. アドレス解決 → updater が絶対アドレスをキューに登録
3. 依存関係ウォーカーが下流のキャッシュを無効化（dirty）
4. updater が `applyChangeFromBindings()` によりバインド済み DOM ノードに変更を適用

### 状態アドレスシステム

`users.*.name` のようなパスは以下に分解されます：

- **PathInfo** — 静的パスメタデータ（セグメント、ワイルドカード数、親パス）
- **ListIndex** — ランタイムループインデックスチェーン
- **StateAddress** — PathInfo + ListIndex の組み合わせ
- **AbsolutePathInfo / AbsoluteStateAddress** — ツリーを持つ state 要素に固定した PathInfo と、その ListIndex の組。マウントされたコンポーネントとボリュームは相対パスをこの層でホストのツリーへ翻訳する。v2 は 1 root 1 ツリーなので、アドレスに状態名はない

## パフォーマンス

リポジトリ同梱の [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) 流
ドライバ（`e2e/bench/jsfb-verify.mjs`・`e2e/bench/memory-profile.mjs`）で、標準の
1,000 / 10,000 行テーブルページを計測（headless Chromium・中央値・両実装を同一
セッションで連続実行）。`@wcstack/state` は公式の keyed 判定に合格しつつ、行 DOM
を上限 1,000 行の有界プールでリサイクルします。

| 所要時間（ms・中央値） | `@wcstack/state` | [`@wcstack/signals`](../signals/) |
|---|---|---|
| 1,000 行の生成 | 25.2 | 9.5 |
| 1,000 行の全置換 | 18.8 | 12.5 |
| 10,000 行の 10 行ごと更新 | 11.4 | 4.7 |
| 行の選択 | 0.1 | 0.4 |
| 2 行の入れ替え | 0.9 | 0.4 |
| 行の削除 | 2.8 | 0.6 |
| 10,000 行への 1,000 行追加 | 48.6 | 14.2 |
| 10,000 行のクリア | 54.6 | 52.2 |

| 強制 GC 後のヒープ（MB） | `@wcstack/state` | `@wcstack/signals` |
|---|---|---|
| ページ表示直後 | 1.0 | 0.6 |
| 1,000 行生成後 | 5.6 | 3.5 |
| 1,000 行×5 回置換後 | 6.4 | 3.7 |
| 10,000 行生成後 | 35.1 | 18.0 |
| 10,000 行生成 + クリア後 | 13.2 | 1.9 |

正直な読み方：

- 対話系の操作（選択 / 入れ替え / 削除）は数ミリ秒以下で、巨大リストのクリアは
  signals 実装と同等です。
- 行の生成・追加は `@wcstack/signals` の約 2.5〜3.5 倍のコストです。これは本
  パッケージが行ごとに構築する宣言的バインディング台帳の対価で、`data-wcs` の
  検査・DevTools の配線表示・SSR ハイドレーションを支えているのは同じ台帳です。
  両パッケージは相互運用できるため、ホットなリストだけ signals の `For` で描画
  し、残りのページは宣言的なまま保てます。
- クリア後に残るヒープは、次のリスト生成を安くする有界の行プールです。

絶対値は 1 台の開発機で v1.21.6 + PR#87（clear リーク修正）時点に取ったものです。
v2.0 のマウント作業は同じドライバの同一セッション A/B でゲートし、実行ごとの
ノイズ内に収まった（[docs/state-mount-impl-plan.md](../../docs/state-mount-impl-plan.md)
§2-2 と slice 27）ため、表は取り直していません。絶対値はマシン状態で ±20% 揺れます。
`e2e/bench/` のドライバで手元のハードウェアでも再現できます。

## サーバーサイドレンダリング

`@wcstack/state` は [`@wcstack/server`](../server/) パッケージと連携して SSR をサポートしています。クライアント用に書いたテンプレートがそのままサーバーでレンダリングされます — 変更不要。

### クイックセットアップ

1. `<wcs-state>` に `enable-ssr` を追加:

```html
<wcs-state enable-ssr>
  <script type="module">
    export default {
      items: [],
      async $connectedCallback() {
        const res = await fetch("/api/items");
        this.items = await res.json();
      }
    };
  </script>
</wcs-state>
<template data-wcs="for: items">
  <div data-wcs="textContent: items.*.name"></div>
</template>
```

2. サーバーでレンダリング:

```javascript
import { renderToString } from "@wcstack/server";

const html = await renderToString(template, {
  baseUrl: "http://localhost:3000"
});
```

これだけです。クライアント側の `@wcstack/state` は `<wcs-ssr>` 要素を自動検出し、JSON スナップショットから状態を復元し、再レンダリングなしでリアクティビティを再開します。

### 仕組み

| フェーズ | 動作 |
|---------|------|
| **サーバー** | `renderToString()` が happy-dom でテンプレートを実行、`$connectedCallback`（`fetch()` 含む）を実行し、全バインディングを適用、ハイドレーションデータを含む `<wcs-ssr>` 要素付きのレンダリング済み HTML を出力 |
| **クライアント** | `<wcs-state enable-ssr>` が `<wcs-ssr>` の JSON から状態をロード、`$connectedCallback` をスキップ、`hydrateBindings()` が既存の DOM にリアクティビティを接続 |
| **フォールバック** | サーバー/クライアントのバージョン不一致時、SSR DOM をクリーンアップして `buildBindings()` でフルクライアントサイドレンダリングを実行 |

### `enable-ssr` の動作

| コンテキスト | 動作 |
|------------|------|
| **サーバー**（`renderToString`） | 状態 JSON、テンプレートフラグメント、プロパティデータを含む `<wcs-ssr>` を生成 |
| **クライアント**（ハイドレーション） | `<wcs-ssr>` を読み取り、状態を復元、`$connectedCallback` をスキップ、既存 DOM のバインディングをハイドレート |

API の詳細は [`@wcstack/server` README](../server/README.ja.md) を参照してください。

## ライセンス

MIT
