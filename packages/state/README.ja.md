# @wcstack/state

Web Components のための宣言的リアクティブ状態管理。  
`<wcs-state>` カスタム要素と `data-wcs` 属性バインディング — ランタイム依存ゼロ。

## 特徴

- **宣言的データバインディング** — `data-wcs` 属性によるプロパティ / テキスト / イベント / 構造バインディング
- **リアクティブ Proxy** — ES Proxy による依存追跡付き自動 DOM 更新
- **構造ディレクティブ** — `<template>` 要素による `for`, `if` / `elseif` / `else`
- **組み込みフィルタ** — フォーマット、比較、算術、日付など 40 種類
- **双方向バインディング** — `<input>`, `<select>`, `<textarea>` で自動有効
- **Web Component バインディング** — Shadow DOM コンポーネントとの双方向状態バインディング
- **パス getter** — ドットパスキー getter（`get "users.*.fullName"()`）によるデータツリーの任意の深さへのフラットな仮想プロパティ定義、自動依存追跡・キャッシュ
- **Mustache 構文** — テキストノードでの `{{ path|filter }}`
- **複数の状態ソース** — JSON, JS モジュール, インラインスクリプト, API, 属性
- **SVG サポート** — `<svg>` 要素内でのフルバインディング対応
- **ライフサイクルフック** — `$connectedCallback` / `$disconnectedCallback` / `$updatedCallback`、Web Component 用 `$stateReadyCallback`
- **依存ゼロ** — ランタイム依存なし

## インストール

### CDN（推奨）

```html
<!-- 自動初期化 — これだけで動作します -->
<script type="module" src="https://cdn.jsdelivr.net/npm/@wcstack/state/dist/auto.js"></script>
```

### CDN（手動初期化）

```html
<script type="module">
  import { bootstrapState } from 'https://cdn.jsdelivr.net/npm/@wcstack/state/dist/index.esm.js';
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

状態の変更は**プロパティへの代入**（Proxy の `set` トラップ）で検知されます。リアクティブな DOM 更新をトリガーするには、状態プロパティに値を**代入**する必要があります。

### プリミティブ・オブジェクトプロパティ

直接のプロパティ代入は任意の深さで検知されます：

```javascript
this.count = 10;            // ✅ 検知される
this.user.name = "Bob";     // ✅ 検知される（ネストされた代入）
```

### 配列

配列の破壊的メソッド（`push`, `splice`, `sort`, `reverse` 等）はその場で配列を変更するだけで**プロパティ代入を発生させない**ため、リアクティブシステムは変更を検知しません。代わりに、新しい配列を返す**非破壊的メソッド**を使用し、結果を代入してください：

```javascript
// ✅ 非破壊的 + 代入 — 変更が検知される
this.items = this.items.concat({ id: 4, text: "New" });
this.items = this.items.toSpliced(index, 1);
this.items = this.items.filter(item => !item.done);
this.items = this.items.toSorted((a, b) => a.id - b.id);
this.items = this.items.toReversed();
this.items = this.items.with(index, newValue);

// ❌ 破壊的 — 代入なし、変更は検知されない
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

### 双方向バインディング

以下の要素で自動的に有効化されます：

| 要素 | プロパティ | イベント |
|---|---|---|
| `<input type="checkbox/radio">` | `checked` | `input` |
| `<input>`（その他の type） | `value`, `valueAsNumber`, `valueAsDate` | `input` |
| `<select>` | `value` | `change` |
| `<textarea>` | `value` | `input` |

`<input type="button">` は除外されます。`#ro` で無効化、`#onchange` でイベントを変更できます。

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

3階層のネスト、5つの仮想プロパティ — すべてが1つのフラットなオブジェクト内に並んで定義されています。各レベルは任意の深さの値を参照でき、`$getAll` による集約は下位から上位へ自然に流れます。コンポーネントベースのフレームワーク（React、Vue）で同じことを実現するには、各ネストレベルに個別のコンポーネントを作成し、算出値をツリーの上位に渡すための props バケツリレーや状態管理が必要になります。

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

`@wcstack/state` は Shadow DOM を使用したカスタム要素との双方向状態バインディングに対応しています。

### コンポーネント定義

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

- `bind-component="state"` で Shadow DOM 内のコンポーネントの `state` プロパティを `<wcs-state>` にマッピング
- `data-wcs="state.message: user.name"` でホスト要素上の外部状態パスを内部コンポーネント状態プロパティにバインド
- 変更はコンポーネントと外部状態間で双方向に伝播

### 独立した Web Component への状態注入（`examples/single-component`）

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

### ループ内でのコンポーネント使用

```html
<template data-wcs="for: users">
  <my-component data-wcs="state.message: .name"></my-component>
</template>
```

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

      // <wcs-state> が DOM に接続された時に呼ばれる（async 対応）
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
| `$connectedCallback` | 初回接続時は状態初期化後、再接続時は毎回呼び出し | 可（`async` 対応） |
| `$disconnectedCallback` | 要素が DOM から削除された時 | 不可（同期のみ） |
| `$updatedCallback(paths, indexesListByPath)` | 状態変更が適用された後に呼び出し | 戻り値は未使用（待機されない） |

- フック内の `this` は読み書き可能な状態プロキシです
- `$connectedCallback` は要素が接続される**たびに**呼ばれます（削除後の再接続を含む）。再確立が必要なセットアップ処理に適しています
- `$disconnectedCallback` は同期的に呼び出されます — タイマーのクリア、イベントリスナーの削除、リソースの解放などのクリーンアップに使用します
- `$updatedCallback(paths, indexesListByPath)` は更新された状態パスの一覧を受け取ります。ワイルドカードパス更新時は `indexesListByPath` で更新対象インデックスも受け取れます
- Web Component では `async $stateReadyCallback(stateProp)` を定義すると、`bind-component` でバインドされた状態が利用可能になったタイミングで呼び出されます

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
  ├── registerComponents()    // <wcs-state> カスタム要素を登録
  └── registerHandler()       // DOMContentLoaded ハンドラ
        ├── waitForStateInitialize()    // 全 <wcs-state> の読み込み待機
        ├── convertMustacheToComments() // {{ }} → コメントノードに変換
        ├── collectStructuralFragments() // for/if テンプレートを収集
        └── initializeBindings()        // DOM 走査、data-wcs 解析、バインディング設定
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

## ライセンス

MIT
