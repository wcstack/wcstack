# パスの分類

`@wcstack/state` における状態パスは、その構造に応じて以下のように分類される。

## 分類図

```
パス (Path)
├── 静的パス (Static Path) — ワイルドカードを含まない
│   ├── 単純パス (Simple Path)     — セグメント1つ: count, name
│   └── ネストパス (Nested Path)   — セグメント2つ以上: cart.totalPrice, user.profile.name
│
├── パターンパス (Pattern Path) — ワイルドカード `*` を含む
│   ├── 単層パターン (Single-level Pattern)  — `*` が1つ: users.*.name
│   └── 多層パターン (Multi-level Pattern)   — `*` が2つ以上: categories.*.products.*.price
│
├── 省略パス (Shorthand Path) — for コンテキスト内のドット始まりパス
│   ├── 単層省略 (Single-level Shorthand)  — .name → users.*.name
│   └── 多層省略 (Multi-level Shorthand)   — .products.*.name → categories.*.products.*.name
│
├── 解決済みパス (Resolved Path) — `*` が具体的なインデックスに置換済み
│   ├── 完全解決パス (Fully Resolved Path)    — 全 `*` が解決: users.0.name
│   └── 部分解決パス (Partially Resolved Path) — 一部の `*` が未解決（非サポート）
│
└── 算出パス (Computed Path) — getter で定義された仮想パス
    └── 例: get "users.*.ageCategory"() { ... }
```

## 1. 静的パス (Static Path)

ワイルドカードを含まず、状態ツリーの特定の位置を一意に指す。

### 単純パス (Simple Path)

ドット区切りを含まない、トップレベルのプロパティへの参照。

```
count          → number
name           → string
active         → boolean
users          → array
```

**使用例:**
```html
<div data-wcs="textContent: count"></div>
<template data-wcs="for: users">...</template>
```

### ネストパス (Nested Path)

ドット区切りで階層を辿る。オブジェクトのネストされたプロパティへの参照。

```
cart.totalPrice        → number
user.profile.name      → string
cart.items.length      → number（配列の組み込みプロパティ）
```

**使用例:**
```html
<div data-wcs="textContent: cart.totalPrice"></div>
```

**注意:** ネストパスへの代入 `this.cart.totalPrice = 100` は Proxy で検出できない。
`this["cart.totalPrice"] = 100` を使用する。

## 2. パターンパス (Pattern Path)

ワイルドカード `*` を含み、配列要素の各項目に対応する抽象的なパス。
`for` テンプレート内のバインディングで使用される。

### 単層パターン (Single-level Pattern)

`*` が1つ。1つの配列をイテレーションする。

```
users.*                → { name: string, age: number }（配列要素全体）
users.*.name           → string
users.*.age            → number
```

**使用例:**
```html
<template data-wcs="for: users">
  <span data-wcs="textContent: .name"></span>
  <!-- .name は users.*.name のショートハンド -->
</template>
```

### 多層パターン (Multi-level Pattern)

`*` が2つ以上。ネストされた配列をイテレーションする。

```
categories.*.products.*.price    → number
categories.*.products.*.name     → string
```

**使用例:**
```html
<template data-wcs="for: categories">
  <template data-wcs="for: .products">
    <span data-wcs="textContent: .price"></span>
  </template>
</template>
```

## 3. 省略パス (Shorthand Path)

`for` テンプレート内でドット `.` から始まるパス。
親の `for` パスを暗黙の接頭辞として補完し、パターンパスに展開される。

### 単層省略 (Single-level Shorthand)

1段の `for` コンテキストでの省略。

```
for: users のコンテキスト内:
  .name       → users.*.name
  .age        → users.*.age
```

**使用例:**
```html
<template data-wcs="for: users">
  <span data-wcs="textContent: .name"></span>
  <span data-wcs="textContent: .age"></span>
</template>
```

### 多層省略 (Multi-level Shorthand)

ネストされた `for` コンテキストでの省略。最も内側の `for` パスが接頭辞になる。

```
for: categories > for: .products のコンテキスト内:
  .name       → categories.*.products.*.name
  .price      → categories.*.products.*.price
```

**使用例:**
```html
<template data-wcs="for: categories">
  <h2 data-wcs="textContent: .name"></h2>
  <template data-wcs="for: .products">
    <span data-wcs="textContent: .name"></span>
    <!-- .name は categories.*.products.*.name に展開 -->
  </template>
</template>
```

**省略パスの展開規則:**
1. `.` から始まるパスは省略パスとみなされる
2. **最も内側（最も近い祖先）の `for` パス**の `パス.*` が接頭辞として付与される
3. 展開後はパターンパスとして扱われる

**注意:** ネストされた `for` では、省略パスは常に最も内側の `for` に対して展開される。
外側の `for` のプロパティを参照したい場合は、省略パスではなく完全なパターンパスを使用する。

```html
<template data-wcs="for: categories">
  <template data-wcs="for: .products">
    <span data-wcs="textContent: .name"></span>
    <!-- .name → categories.*.products.*.name（内側の for: .products に対して展開） -->

    <span data-wcs="textContent: categories.*.name"></span>
    <!-- 外側の categories の name を参照するには完全パスが必要 -->
  </template>
</template>
```

## 4. 解決済みパス (Resolved Path)


パターンパスの `*` を具体的なインデックスに置き換えたパス。
主にメソッド内でプログラム的に使用する。

### 完全解決パス (Fully Resolved Path)

全ての `*` が具体的なインデックスに置換されたパス。

```
users.0.name           → "Alice"
users.1.age            → 25
cart.items.2.price     → 300
```

**使用例（メソッド内）:**
```javascript
increment() {
  // ブラケットアクセスでドットパスとして指定
  this["users.0.name"] = "Bob";

  // テンプレートリテラルで動的に指定
  this[`users.${this.$1}.name`] = "Bob";

  // $resolve API で指定
  this.$resolve("users.*.name", [0], "Bob");
}
```

### 部分解決パス (Partially Resolved Path) — 非サポート

一部の `*` のみがインデックスに置換され、残りが未解決のパス。

```
categories.0.products.*.name    ← 非サポート
```

このパターンは `@wcstack/state` ではサポートされない。
全ての `*` を解決するか、全て `*` のままにする。

## 5. 算出パス (Computed Path)

状態オブジェクト内の getter で定義される仮想パス。
データとしては存在せず、アクセス時に動的に計算される。

```javascript
export default {
  users: [{ name: "Alice", age: 30 }],

  // 算出パス: users.*.ageCategory
  get "users.*.ageCategory"() {
    return this["users.*.age"] < 25 ? "Young" : "Adult";
  },

  // 算出パス: cart.totalPrice
  get "cart.totalPrice"() {
    return this.$getAll("cart.items.*.price", []).reduce((sum, v) => sum + v, 0);
  },
};
```

**特徴:**
- パターンパスの形式で定義可能（`users.*.ageCategory`）
- 静的パスの形式でも定義可能（`cart.totalPrice`）
- 依存パスの変更時に自動再計算される
- 読み取り専用（setter を定義しない限り）

## パス分類の早見表

| 分類 | 例 | `*` | インデックス | 用途 |
|---|---|---|---|---|
| 単純パス | `count` | なし | なし | 直接バインディング |
| ネストパス | `cart.totalPrice` | なし | なし | オブジェクト階層アクセス |
| 単層パターン | `users.*.name` | 1つ | なし | for テンプレート内バインディング |
| 多層パターン | `a.*.b.*.c` | 2つ以上 | なし | ネスト for テンプレート |
| 単層省略 | `.name` | なし（展開後あり） | なし | for テンプレート内ショートハンド |
| 多層省略 | `.products.*.name` | なし（展開後あり） | なし | ネスト for テンプレート内ショートハンド |
| 完全解決パス | `users.0.name` | なし | あり | メソッド内プログラム的アクセス |
| 部分解決パス | `a.0.b.*.c` | 混在 | 混在 | **非サポート** |
| 算出パス | `get "x.*.y"()` | 任意 | なし | 派生データの自動計算 |

## シチュエーション別 利用可能マトリクス

### 凡例

- ✅ 利用可能
- ❌ 利用不可
- ⚠ 条件付き（注記参照）

### UI（HTML バインディング）

| シチュエーション | 単純 | ネスト | パターン | 省略 | 解決済み | 算出 |
|---|---|---|---|---|---|---|
| `for` 外の `data-wcs` | ✅ | ✅ | ❌ ^1 | ❌ ^2 | ❌ ^3 | ✅ |
| `for` 内の `data-wcs` | ✅ | ✅ | ✅ | ✅ | ❌ ^3 | ✅ |
| `for` 外の `{{ }}` / `<!--@@:-->` | ✅ | ✅ | ❌ ^1 | ❌ ^2 | ❌ ^3 | ✅ |
| `for` 内の `{{ }}` / `<!--@@:-->` | ✅ | ✅ | ✅ | ✅ | ❌ ^3 | ✅ |
| `for:` の値（イテレーション対象） | ✅ | ✅ | ✅ ^4 | ⚠ ^5 | ❌ | ❌ |
| `if:` / `elseif:` の値 | ✅ | ✅ | ⚠ ^6 | ✅ | ❌ | ✅ |
| イベントハンドラ `onclick:` の値 | — | — | — | — | — | — |

^1 ループコンテキストがないため `*` を解決できない
^2 親の `for` がないため展開先がない
^3 UI バインディングは具体的なインデックスを使用しない（ループコンテキストが `*` を自動解決する）
^4 ネストされた `for` 内で可能（例: `for: users.*.items` — 親 `for: users` のコンテキストで `*` が解決される）
^5 ネストされた `for` 内でのみ可能（例: `for: .products`）
^6 `for` テンプレート内でのみ可能

### 状態（JavaScript — defineState 内）

| シチュエーション | 単純 | ネスト | パターン | 省略 | 解決済み | 算出 |
|---|---|---|---|---|---|---|
| **プロパティ宣言**（キー名） | ✅ | ❌ ^7 | ❌ ^7 | ❌ | ❌ | ❌ |
| **getter/setter 宣言**（キー名） | ✅ ^8 | ✅ | ✅ | ❌ | ❌ | ❌ |
| **getter 内 読み取り** | ✅ | ✅ | ⚠ ^9 | ❌ | ⚠ ^10 | ✅ |
| **メソッド内（for コンテキスト外）** | ✅ | ✅ | ❌ ^11 | ❌ | ✅ | ✅ ^12 |
| **メソッド内（for コンテキスト内）** | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ ^12 |
| **`$getAll(path)`** | ❌ ^13 | ❌ ^13 | ✅ | ❌ | ❌ | ❌ |
| **`$resolve(path, indexes)`** | ❌ ^14 | ❌ ^14 | ✅ | ❌ | ❌ | ❌ |
| **`$postUpdate(path)`** | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| **`$trackDependency(path)`** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |

^7 データプロパティはオブジェクトリテラルのキーであり、パスではない（`count: 0` は有効だが `"cart.totalPrice": 0` はデータ構造が異なる）
^8 getter の単純パス宣言はネストパスの算出値（例: `get "totalPrice"()` — 事実上 `get totalPrice()`）
^9 宣言と同一のワイルドカードスコープを共有するパターンパスのみ可能（後述「getter 内のワイルドカードスコープ」参照）。ただし `$getAll`・`$resolve` の引数には制約なし
^10 `this["users.0.name"]` は技術的に動作するが、依存追跡が正確でない可能性がある。`$resolve` の使用を推奨
^11 ループコンテキストがないため `*` を解決できない。`$getAll` または `$resolve` を使用する
^12 算出パスの読み取りのみ（setter が定義されていない場合、書き込み不可）
^13 `$getAll` はワイルドカードにマッチする全要素を返す API であり、静的パスには通常使用しない（技術的には動作する）
^14 `$resolve` はワイルドカードをインデックスで解決する API であり、ワイルドカードのないパスには不要

### イベントハンドラ特記

`onclick:` 等のイベントハンドラの値はパスではなく**メソッド名**を指定する。
パスの分類は適用されない。

```html
<button data-wcs="onclick: increment">+</button>
<button data-wcs="onclick#prevent: handleSubmit">送信</button>
```

`for` テンプレート内のイベントハンドラでは、メソッドの引数 `$1`〜`$9` でループインデックスにアクセスする。

```html
<template data-wcs="for: users">
  <button data-wcs="onclick: deleteUser">削除</button>
  <!-- deleteUser(event, $1) の $1 が配列インデックス -->
</template>
```

### getter 内のワイルドカードスコープ

getter がパターンパスで宣言されている場合、getter 本体内の `this["..."]` アクセスは
**宣言と同一のワイルドカードスコープ（同じ配列の同じ `*` 位置）を共有するパス**のみ使用可能。

この制約は `this["..."]` による直接アクセスに適用される。
`$getAll` や `$resolve` の引数パスには適用されない（これらは独自にワイルドカードを解決する）。

#### ワイルドカードスコープとは

パスのワイルドカード `*` がどの配列のどの階層を指すかの情報。
getter 実行時、`*` は特定の配列インデックスに暗黙的にバインドされる。
同じスコープを共有するパスは、同じ要素を参照する。

#### 例

```javascript
export default {
  users: [
    { name: "Alice", age: 30, profile: { bio: "..." } }
  ],
  items: [
    { title: "Item A" }
  ],

  // 宣言: users.*.isAdult — スコープは users.*
  get "users.*.isAdult"() {
    // ✅ OK: users.* を共有
    return this["users.*.age"] >= 18;
  },

  get "users.*.displayName"() {
    // ✅ OK: users.* を共有（ネストしたプロパティも可）
    return this["users.*.profile.bio"];

    // ❌ NG: items.* は別の配列スコープ
    // return this["items.*.title"];

    // ❌ NG: users.*.profile.licenses.* は users.* より深いワイルドカード階層
    // return this["users.*.profile.licenses.*.title"];
  },

  get "users.*.summary"() {
    // ✅ OK: $getAll はスコープ制約の対象外
    const allNames = this.$getAll("users.*.name", []);

    // ✅ OK: $resolve もスコープ制約の対象外
    const firstItem = this.$resolve("items.*.title", [0]);

    return `${this["users.*.name"]} (${allNames.length} users)`;
  },
};
```

#### 判定規則

宣言パスと参照パスのワイルドカード部分を比較する:

| 宣言パス | 参照パス | 判定 | 理由 |
|---|---|---|---|
| `users.*.isAdult` | `users.*.age` | ✅ | 同一スコープ `users.*` |
| `users.*.isAdult` | `users.*.profile.bio` | ✅ | 同一スコープ `users.*`（深い静的パスは可） |
| `users.*.isAdult` | `items.*.title` | ❌ | 異なる配列スコープ |
| `users.*.isAdult` | `users.*.tags.*.label` | ❌ | `users.*` より深いワイルドカード階層を追加 |
| `a.*.b.*.x` | `a.*.b.*.y` | ✅ | 同一スコープ `a.*.b.*` |
| `a.*.b.*.x` | `a.*.c` | ✅ | `a.*` を共有（深い `b.*` は参照しない） |
| `a.*.b.*.x` | `a.*.b.*.c.*.d` | ❌ | `a.*.b.*` より深いワイルドカード階層を追加 |
