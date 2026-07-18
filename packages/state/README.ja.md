# @wcstack/state

**これは便利な既存FWの別実装ではありません。フロントエンド開発の前提を組み替える、別系譜の試みです。**

多くのライブラリは、UI・状態・コンポーネントの結合点を JavaScript の中に置きます。`@wcstack/state` はそこを選びません。仮想DOMも、コンパイルも、hook も、selector も前提にせず、HTML とパス文字列だけを契約として UI と状態を結びつけます。

それが `<wcs-state>` と `data-wcs` のアプローチです。CDNからの読み込みだけで動作し、依存パッケージはゼロ、構文はHTMLそのままです。CDNのスクリプトはカスタム要素の定義を登録するだけで、ロード時にはそれ以外の処理は走りません。`<wcs-state>` 要素がDOMに接続されたときにはじめて、状態ソースを読み取り、同一ルートノード（`document` または `ShadowRoot`）内の `data-wcs` バインディングを走査してリアクティビティを構築します。初期化プロセスはすべて要素のライフサイクルによって駆動されるため、独自の初期化コードを書く必要はありません。

## ここには存在しないもの

以下は未実装ではありません。**設計上、存在しません。**

- 変数を取り出す API
- 要素ごとに状態を束縛するオブジェクト
- hook
- selector
- reactive primitive をコンポーネントへ引き込むための glue code

これらはどれも、設計上存在しません。

なぜなら、このライブラリでは UI と状態の結合点を JavaScript の中に置かないからです。状態を「取り出して」コンポーネントへ渡すのではなく、HTML 側がパス文字列によって状態を参照します。要素は状態を所有せず、状態も要素を知りません。両者が共有するのはパスだけです。

## 既存FWとは比較しません

これは React / Vue / Solid と同じ問題を別の方法で解いているのではありません。**前提自体が違います。**

| 一般的なFWが前提にするもの | `@wcstack/state` が前提にするもの |
|---|---|
| コンポーネントが UI と状態の結合点 | パス文字列が UI と状態の結合点 |
| JavaScript が描画の中心 | HTML と DOM が中心 |
| state を取り出して component へ流し込む | path を宣言して DOM を状態へ接続する |
| hook / selector / signal で購読する | 属性とパスで束縛する |
| フレームワークの実行モデルにアプリ全体を載せる | ブラウザ標準の上に薄い reactive layer を足す |

比較表を作るより先に、この前提差を理解してください。同じ棚に置いても、解いている問題の切り取り方が違います。

## 第一原理: パスが唯一の契約

既存の多くのフレームワークでは、**コンポーネント**がUIと状態の結合点になっています。状態ストアを外部に切り出しても、コンポーネント内にフックやセレクタ、リアクティブプリミティブといった**状態を引き込むためのコード**が必ず必要になります。つまり、UIと状態は常にJavaScriptの中で結びついているのです。

`@wcstack/state` はこの結合を完全に排除しました。UIと状態を結びつけているのは**パス文字列**だけです — `user.name` や `cart.items.*.subtotal` のようなドット区切りのアドレスのみが、2つのレイヤー間の唯一の契約（コントラクト）になります:

| レイヤー | 知っていること | 知らないこと |
|----------|----------------|--------------|
| **状態** (`<wcs-state>`) | データ構造とビジネスロジック | どのDOM要素がバインドされているか |
| **UI** (`data-wcs`) | パス文字列と表示意図 | 状態がどう保存・算出されているか |
| **コンポーネント** (`@name`) | 名前付き状態から必要なパス | 他コンポーネントの内部実装 |

3つのレベルのパス契約が疎結合を実現しています:

1. **UI ↔ 状態** — `data-wcs="textContent: user.name"` という属性がバインディングのすべてです。フックもセレクタもリアクティブプリミティブもありません。コンポーネントのJavaScriptには、状態を参照するコードが**一行も**必要ありません。

2. **コンポーネント ↔ コンポーネント** — コンポーネント間の通信は、名前付き状態の参照（`@stateName`）で行われます。コンポーネント同士がお互いを直接インポートしたり参照したりすることはありません。共有するのはパスの命名規約だけです。

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
- **組み込みフィルタ** — フォーマット、比較、算術、日付など 40 種類
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
- **TypeScript サポート** — `defineState()` によるドットパス自動補完付き型付き状態定義（[詳細](docs/define-state.ja.md)）
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

### 名前付き状態

複数の状態要素を `name` 属性で共存できます。バインディングでは `@name` で参照します：

```html
<wcs-state name="cart">...</wcs-state>
<wcs-state name="user">...</wcs-state>

<div data-wcs="textContent: total@cart"></div>
<div data-wcs="textContent: name@user"></div>
```

デフォルト名は `"default"`（`@` 不要）です。

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
property[#modifier]: path[@state][|filter[|filter(args)...]]
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
| `@state` | 名前付き状態の参照 | `@cart`, `@user` |
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

`static wcBindable` を宣言したカスタム要素への prop バインディングは、**authority**（そのワイヤをどちら側が所有するか）を解決します。authority は初期値の出所だけでなく、**そのバインディングの生存期間全体で state→element 書き込みが有効かどうか**を決めます。既定はメンバの宣言位置から導出されます（`enableDirectionalInitialSync` で既定 ON）：

| メンバの宣言位置 | 既定 authority | 効果 |
|---|---|---|
| `properties` のみ（output-only） | `element` | 要素の値が state に流れる。**state からこのメンバへは書き込まれない** |
| `inputs` のみ | `state` | state が要素に書き込む |
| `properties` + `inputs`（双方向） | `state` | 従来挙動 — state が先に書き、以後は要素イベントが state を更新 |
| —（`wcBindable` 非宣言・素の HTML 要素） | `state` | 従来と不変 |

> **作法：** settable なメンバは **`properties` と `inputs` の両方**に宣言してください。`properties` にしか宣言されていないメンバは output-only 扱いになり、state→element 書き込みがバインディングの生存期間ずっと抑止され、要素側の初期値が state 側のシード値を上書きします（`@wcstack` の I/O ノード Shell と DCC の `$bindables` はこの作法に従っています）。

authority はバインディング単位で `#init=` により上書きできます：

| 値 | authority | 使える宣言 |
|---|---|---|
| `init=state` | state 所有：state → element（双方向メンバは要素イベントも引き続き受信） | inputs のみ・双方向 |
| `init=element` | element 所有：要素のスナップショットとイベント → state。state からの書き込みは抑止 | output-only・双方向 |
| `init=auto` | state スロットが未初期化なら `element`、それ以外は `state` | 双方向 |
| `init=none` | 初期同期なし（event バインディングはこの値のみ許可） | すべて |

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

注意：

- `enableDirectionalInitialSync: false`（opt-out）のとき `#init=`/`#sync=` を書くと throw します。
- **1.20 以前からの移行：** output-only メンバに対して state 側に都合のよい初期値（`value: []`、`query: ""` 等）をシードしないでください — 要素側の実初期値（多くは `null`/`undefined`）がシードを置き換えます。シードは要素の実初期値に合わせ、表示用の値は派生 getter で null ガードしてください。

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
- `@stateName` 修飾子は各展開エントリへ伝播（`...: fetchX@store`）
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

`for:` ディレクティブは**値ベースの差分アルゴリズム**を使用します。配列の各要素の値そのものが識別キーとして機能するため、React の `key` や Vue の `:key` のような明示的なキー属性は不要です。配列が再代入されると、差分アルゴリズムが新旧の要素を値で照合し、変更のない要素の DOM ノードを再利用しつつ、追加・削除・並び替えを効率的に処理します。

#### ドット省略記法

`for` ループ内では、`.` で始まるパスがループの配列パスを基準に展開されます：

| 省略形 | 展開後 | 説明 |
|---|---|---|
| `.name` | `users.*.name` | 現在の要素のプロパティ |
| `.` | `users.*` | 現在の要素そのもの |
| `.name\|uc` | `users.*.name\|uc` | フィルタは保持される |
| `.name@state` | `users.*.name@state` | 状態名は保持される |

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

  // 県レベル — 市からの集約
  get "regions.*.prefectures.*.totalPopulation"() {
    return this.$getAll("regions.*.prefectures.*.cities.*.population", [])
      .reduce((a, b) => a + b, 0);
  },

  // 地方レベル — 県からの集約
  get "regions.*.totalPopulation"() {
    return this.$getAll("regions.*.prefectures.*.totalPopulation", [])
      .reduce((a, b) => a + b, 0);
  },

  // トップレベル — 地方からの集約
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

40 種類の組み込みフィルタが入力（DOM → 状態）と出力（状態 → DOM）の両方向で利用できます。

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

### 数値フォーマット

| フィルタ | 説明 | 例 |
|---|---|---|
| `fix(n)` | 固定小数点桁数 | `price\|fix(2)` → `"100.00"` |
| `round(n?)` | 四捨五入 | `value\|round(2)` |
| `floor(n?)` | 切り捨て | `value\|floor` |
| `ceil(n?)` | 切り上げ | `value\|ceil` |
| `locale(loc?)` | ロケール数値フォーマット | `count\|locale` / `count\|locale(ja-JP)` |
| `percent(n?)` | パーセンテージフォーマット | `ratio\|percent(1)` |

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

Light DOM コンポーネントは Shadow DOM を使用しません。CSS と同様に state の名前空間も上位スコープと共有されるため、`name` 属性が必須です。

```javascript
class MyLightComponent extends HTMLElement {
  state = { message: "" };

  connectedCallback() {
    this.innerHTML = `
      <wcs-state bind-component="state" name="my-light"></wcs-state>
      <div data-wcs="text: message@my-light"></div>
      <input type="text" data-wcs="value: message@my-light" />
    `;
  }
}
customElements.define("my-light-component", MyLightComponent);
```

- Light DOM コンポーネントでは `name` 属性が**必須**です（名前空間が上位スコープと共有されるため）
- バインディングでは `@my-light` のように状態名を明示的に参照する必要があります
- `<wcs-state>` はコンポーネント要素の直下に配置する必要があります

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
- Light DOM コンポーネントでは `name` 属性が**必須**（上位スコープとの名前空間衝突を回避するため）
- Light DOM のバインディングでは状態名を明示的に参照すること（例: `@my-light`）

### ループ内でのコンポーネント使用

```html
<template data-wcs="for: users">
  <my-component data-wcs="state.message: .name"></my-component>
</template>
```

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

重要な規範：

- **協調キャンセル（MUST）** —— `source` は渡された `AbortSignal` を必ず監視し、発火したら生産を停止すること。
- **有界 fold** —— 需要は producer に逆流しません（backpressure は明示的に放棄）。無限 / 長寿命ストリームでは latest・count・last-N（`(acc, chunk) => [...acc.slice(-99), chunk]`）・ウィンドウ集計など有界な fold を使うこと。生の全チャンク累積は有限ストリーム限定。
- **`args` は同期** —— Promise を返すとエラー。`args` 内での wildcard 読みも拒否されます。
- **自己依存・相互サイクルの禁止** —— `args` が自 stream の値や status を読むとエラーになります。2 つの stream の相互サイクル（A の `args` が B の値を読み、B の `args` が A の値を読む）は検出されず無限 restart になるため組まないこと。一方向のチェイン（A の値を B の `args` が読む）は正当です。
- **SSR では起動しない** —— サーバーでは宣言のパースとプロパティの実体化（`initial`）のみ行い、source は実行されません。クライアント側は通常どおり起動します。

完全な契約 —— ライフサイクルと所有権・restart セマンティクス・flush 粒度・スコープ外リスト —— は [docs/streams.ja.md](docs/streams.ja.md) を参照してください。

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

### `$bindables` と wc-bindable プロトコル

`$bindables` 配列は、変更イベント付きのコンポーネントプロパティとして公開する状態プロパティを宣言します。[wc-bindable プロトコル](https://github.com/nicenemo/nicenemo/blob/main/docs/wc-bindable-protocol.md)に準拠しています：

```javascript
export default {
  count: 0,
  increment() { this.count++; },
  $bindables: ["count"]
};
```

これにより以下が生成されます：

- クラスの `static wcBindable` — フレームワークアダプタ用のプロトコルメタデータ。各 `$bindables` メンバは `properties` と `inputs` の両方に宣言され（双方向）、方向認識初期同期の下でも親 state → DCC の書き込みが機能します — [バインディング authority](#バインディング-authority-init--sync) 参照
- プロトタイプの getter/setter — リアクティブプロキシ経由で読み書き
- `CustomEvent` のディスパッチ — 値が変更されるたびに `my-counter:count-changed` が発火

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
| `$updatedCallback(paths, indexesListByPath)` | 状態変更が適用された後に呼び出し | 可（await されない） |

`$disconnectedCallback` を除くすべてのフックで `async` を使用できます。リアクティブ Proxy はすべてのプロパティへの代入を変更として検知します。そのため、標準の `async/await` による処理とプロパティへの直接代入だけで非同期ロジックが完結します。ローディングフラグの切り替え、取得したデータの格納、エラーメッセージの更新といった処理もすべて単なるプロパティ代入で行えるため、非同期状態を管理するための複雑な抽象化機能は必要ありません。

- フック内の `this` は読み書き可能な状態プロキシです。
- `$connectedCallback` は要素が接続される**たびに**呼ばれます（一度削除された後の再接続も含みます）。再確立が必要なセットアップ処理に適しています。
- `$disconnectedCallback` は同期的に呼び出されます。タイマーのクリア、イベントリスナーの削除、リソースの解放といったクリーンアップ処理に使用してください。
- `$updatedCallback(paths, indexesListByPath)` は更新された状態パスの一覧を受け取ります。ワイルドカードをもつパスが更新された場合は、`indexesListByPath` から対象のインデックス情報も取得可能です。`async` を使用できますが、戻り値は await されません。
- Web Component を使用している場合は、コンポーネント側に `async $stateReadyCallback(stateProp)` を定義おくことで、`bind-component` でバインドした状態が利用可能になった瞬間にフックとして呼び出されます。

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
| `locale` | `'en'` | フィルタのデフォルトロケール |
| `debug` | `false` | デバッグモード |
| `enableMustache` | `true` | `{{ }}` 構文の有効化 |
| `enableDirectionalInitialSync` | `true` | 方向認識のバインディング authority（`#init=` / `#sync=` バインド modifier）— [バインディング authority](#バインディング-authority-init--sync) 参照。既定 on。`false` で opt-out |
| `enablePropagationContext` | `true` | バインド間の因果伝播トラッキング（echo/diamond のループ防止）。既定 on。`false` で opt-out |
| `enableContractAnalyzer` | `false` | opt-in の開発時 contract analyzer（`analyzeContract` を公開） |

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

## API リファレンス

### `bootstrapState()`

状態システムを初期化します。`<wcs-state>` カスタム要素を登録し、DOM コンテンツ読み込みハンドラを設定します。

```javascript
import { bootstrapState } from '@wcstack/state';
bootstrapState();
```

### `<wcs-state>` 要素

| 属性 | 説明 |
|---|---|
| `name` | 状態名（デフォルト: `"default"`） |
| `state` | `<script type="application/json">` 要素の ID |
| `src` | `.json` または `.js` ファイルの URL |
| `json` | インライン JSON 文字列 |
| `bind-component` | Web Component バインディングのプロパティ名 |

### IStateElement

| プロパティ / メソッド | 説明 |
|---|---|
| `name` | 状態名 |
| `initializePromise` | 状態の完全な初期化時に解決される Promise |
| `listPaths` | `for` ループで使用されるパスの Set |
| `getterPaths` | getter として定義されたパスの Set |
| `setterPaths` | setter として定義されたパスの Set |
| `createState(mutability, callback)` | 状態プロキシを作成（`"readonly"` または `"writable"`） |
| `createStateAsync(mutability, callback)` | `createState` の非同期版 |
| `setInitialState(state)` | プログラムから状態を設定（初期化前） |
| `bindProperty(prop, descriptor)` | 生の状態オブジェクトにプロパティを定義 |
| `nextVersion()` | バージョン番号をインクリメントして返す |

## アーキテクチャ

```
bootstrapState()
  └── registerComponents()              // <wcs-state> カスタム要素を登録

<wcs-state> connectedCallback
  ├── _initializeBindWebComponent()     // bind-component: 親コンポーネントから状態を取得
  ├── _initialize()                     // 状態をロード (state属性 / src / json / script / API)
  │     └── setStateElementByName()     // WeakMap<Node, Map<name, element>> に登録
  │           └── (rootNode への初回登録時)
  │                 └── queueMicrotask → buildBindings()
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
- **AbsoluteStateAddress** — 状態名 + StateAddress（クロス状態参照用）

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
