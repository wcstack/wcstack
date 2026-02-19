# パスgetter — ネストされたデータのためのフラットな仮想プロパティ

## これは何か

次のコードを見てください。

```javascript
get "users.*.fullName"() {
  return this["users.*.firstName"] + " " + this["users.*.lastName"];
}
```

一見奇妙に見えるかもしれません。文字列をgetterの名前に？ワイルドカードが入っている？

しかしこれは**完全に合法なJavaScript**です。ECMAScriptはcomputed property nameとgetter構文の組み合わせを許容しており、オブジェクトのキーは任意の文字列を取れます。`this["users.*.firstName"]` もブラケット記法による通常のプロパティアクセスです。構文違反はどこにもありません。

このgetterは `@wcstack/state` において**パスgetter**と呼ばれ、ライブラリの中核機能です。ドットパス文字列をキーに使うことで、データツリーの任意の深さに計算プロパティを定義できます。

```javascript
export default {
  users: [
    { firstName: "Alice", lastName: "Smith" },
    { firstName: "Bob", lastName: "Jones" }
  ],
  get "users.*.fullName"() {
    return this["users.*.firstName"] + " " + this["users.*.lastName"];
  }
};
```

`users.*.fullName` はデータに格納されません。これは**仮想プロパティ**です — アクセスされた時点で計算され、要素ごとにキャッシュされ、依存する値が変わると自動的に無効化されます。

---

## パスgetterが解く問題

### 他のフレームワークでのネストの壁

React、Vue、Angularでは、データがネストされると問題が起きます。配列の各要素に対する計算プロパティを定義するには、**要素ごとのコンポーネントが必要**です。

例として「地域 → 都道府県 → 市区町村」の3階層のデータを考えます。各階層に人口の集計や密度の計算が必要な場合、Reactではこうなります。

```
RegionList
  └── RegionItem          ← 地域の人口合計を計算
        └── PrefectureItem  ← 都道府県の人口合計を計算
              └── CityItem    ← 人口密度を計算
```

計算プロパティを置くために3つのコンポーネントが必要になり、propsのバケツリレーかグローバルステートで値を繋ぐことになります。UIの都合ではなく、**データの深さがコンポーネント設計を支配する**という問題です。新しい階層に計算が必要になるたび、新しいコンポーネントを作る必要があります。

Vueでも本質は同じです。`computed` はコンポーネントのスコープに閉じるため、配列要素ごとの計算には子コンポーネントへの分割が避けられません。

### パスgetterによる解決

パスgetterはこの結合を取り除きます。すべての計算プロパティを — 階層に関係なく — ひとつのフラットなオブジェクトに並べるだけです。

```javascript
export default {
  regions: [
    { name: "Kanto", prefectures: [
      { name: "Tokyo", cities: [
        { name: "Shibuya", population: 230000, area: 15.11 },
        { name: "Shinjuku", population: 346000, area: 18.22 }
      ]},
      { name: "Kanagawa", cities: [
        { name: "Yokohama", population: 3750000, area: 437.56 }
      ]}
    ]}
  ],

  // --- 階層に関係なく、すべてフラットに定義 ---

  // 市区町村レベル
  get "regions.*.prefectures.*.cities.*.density"() {
    return this["regions.*.prefectures.*.cities.*.population"]
         / this["regions.*.prefectures.*.cities.*.area"];
  },

  // 都道府県レベル — 市区町村から集約
  get "regions.*.prefectures.*.totalPopulation"() {
    return this.$getAll("regions.*.prefectures.*.cities.*.population", [])
      .reduce((a, b) => a + b, 0);
  },

  // 地域レベル — 都道府県から集約
  get "regions.*.totalPopulation"() {
    return this.$getAll("regions.*.prefectures.*.totalPopulation", [])
      .reduce((a, b) => a + b, 0);
  },

  // トップレベル — 地域から集約
  get totalPopulation() {
    return this.$getAll("regions.*.totalPopulation", [])
      .reduce((a, b) => a + b, 0);
  }
};
```

5つの計算プロパティ、3階層のネスト、追加コンポーネントはゼロ。`$getAll` がワイルドカードに一致するすべての値を収集し、ボトムアップの集約が自然に流れます。

---

## ひとつの構文、多くの機能

パスgetterの注目すべき点は、`get "path"() {}` というたった一つの構文形式に、多くの機能が凝縮されていることです。

### 1. 仮想プロパティの定義

データに存在しないパスを、あたかもプロパティのように定義できます。

```javascript
get "users.*.fullName"() {
  return this["users.*.firstName"] + " " + this["users.*.lastName"];
}
```

テンプレートからは実データと同じように参照できます。

```html
<template data-wcs="for: users">
  <span data-wcs="textContent: .fullName"></span>
</template>
```

`.fullName` がgetterで定義された仮想プロパティか、データに格納された実プロパティかは、テンプレート側からは区別がつきません。

### 2. getter間の参照と演算

パスgetterは他のパスgetterを参照でき、チェーンを形成します。

```javascript
get "cart.items.*.subtotal"() {
  return this["cart.items.*.product.price"] * this["cart.items.*.quantity"];
},
get "cart.totalPrice"() {
  return this.$getAll("cart.items.*.subtotal", []).reduce((sum, v) => sum + v, 0);
},
get "cart.tax"() {
  return this["cart.totalPrice"] * this.taxRate;
},
get "cart.grandTotal"() {
  return this["cart.totalPrice"] + this["cart.tax"];
}
```

依存チェーン: `cart.grandTotal` → `cart.tax` → `cart.totalPrice` → `cart.items.*.subtotal`。いずれかの `quantity` が変われば、チェーン全体が自動的に再計算されます。

### 3. 自動的な依存追跡

getterが `this["users.*.firstName"]` にアクセスした瞬間、システムは `users.*.firstName` → `users.*.fullName` の依存関係を登録します。手動で依存配列を書く必要はありません。

```
users.*.fullName
  ├── 依存: users.*.firstName
  └── 依存: users.*.lastName

users[0].firstName を変更 → users[0].fullName のみ無効化
                           → users[1].fullName のキャッシュはそのまま
```

Reactの `useMemo` との対比が明確です。

```javascript
// React: 依存配列を手動で列挙する
const fullName = useMemo(
  () => firstName + " " + lastName,
  [firstName, lastName]  // ← 開発者の責任
);

// パスgetter: アクセスが依存を自動登録する
get "users.*.fullName"() {
  return this["users.*.firstName"] + " " + this["users.*.lastName"];
  // ← 依存配列は不要。読んだものが依存になる
}
```

### 4. 要素ごとのキャッシュ

各具体的なアドレス（パス + ループインデックス）に独立したキャッシュがあります。

```
users.*.fullName [0] → "Alice Smith"  （独立してキャッシュ）
users.*.fullName [1] → "Bob Jones"    （独立してキャッシュ）
```

1000件の配列で1件だけ更新しても、再計算されるのはその1件のgetterだけです。

### 5. 階層を問わない定義

市区町村レベルの計算もトップレベルの集計も、同じオブジェクトの同じ階層に並びます。

```javascript
// 3階層下の計算
get "regions.*.prefectures.*.cities.*.density"() { ... },
// トップレベルの集計
get totalPopulation() { ... }
```

定義の場所がデータの深さに縛られません。

### 6. ループコンテキストによるワイルドカードの解決

パス中の `*` は実行時にループインデックスに解決されます。

```
テンプレート:
  <template data-wcs="for: users">     ← インデックスをスタックにプッシュ
    {{ .fullName }}                      ← users.*.fullName を読み取り

インデックス0:  this["users.*.firstName"]  →  users[0].firstName  →  "Alice"
インデックス1:  this["users.*.firstName"]  →  users[1].firstName  →  "Bob"
```

ネストされたループでは、ワイルドカードが左から順にインデックスに対応します。

```javascript
get "categories.*.items.*.label"() {
  // 最初の * → カテゴリインデックス、2番目の * → アイテムインデックス
  return this["categories.*.name"] + " / " + this["categories.*.items.*.name"];
}
```

```html
<template data-wcs="for: categories">
  <template data-wcs="for: .items">
    <span>{{ .label }}</span>
  </template>
</template>
```

---

これらはすべて `get "path"() {}` というひとつの構文形式から導出されます。パスが文字列だからワイルドカードを含められる。getterだからアクセス時に依存が記録できる。パスがフラットな文字列だから階層に縛られない。ひとつの設計判断が連鎖的にこれらの機能を生んでいます。

---

## 実践パターン

### ルックアップテーブル

Mapでデータを結合し、返されたオブジェクトのサブプロパティに透過的にアクセスします。

```javascript
export default {
  products: [
    { id: "P001", name: "Widget", price: 500 },
    { id: "P002", name: "Gadget", price: 1200 }
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

  // カートアイテム → 商品を結合
  get "cart.items.*.product"() {
    return this.productByProductId.get(this["cart.items.*.productId"]);
  },

  // getterが返すオブジェクトのサブプロパティにアクセス
  get "cart.items.*.subtotal"() {
    return this["cart.items.*.product.price"] * this["cart.items.*.quantity"];
  }
};
```

`this["cart.items.*.product.price"]` は、`cart.items.*.product` getterが返したオブジェクトの `.price` に自然にチェーンします。

### 双方向バインディングとパスsetter

`set "path"()` でカスタムの書き込みロジックを定義できます。

```javascript
export default {
  users: [
    { firstName: "Alice", lastName: "Smith" }
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

入力を編集するとsetterが呼ばれ、`firstName` と `lastName` に分割して書き戻します。

### 条件付きフォーマット

getterで状態を分類し、テンプレートでクラスをバインドします。

```javascript
export default {
  items: [
    { name: "Server A", cpu: 85 },
    { name: "Server B", cpu: 45 },
    { name: "Server C", cpu: 95 }
  ],
  get "items.*.status"() {
    const cpu = this["items.*.cpu"];
    if (cpu >= 90) return "critical";
    if (cpu >= 70) return "warning";
    return "normal";
  }
};
```

```html
<template data-wcs="for: items">
  <div data-wcs="class.critical: .status|eq(critical); class.warning: .status|eq(warning)">
    {{ .name }}: {{ .cpu }}%
  </div>
</template>
```

---

## 状態の更新ルール

パスgetterが機能するための前提は、状態変更がProxyの `set` トラップを通過することです。

### パス代入が必須

```javascript
// ✅ パス代入 — 変更が検知される
this.count = 10;
this["user.name"] = "Bob";

// ❌ 直接のネストアクセス — Proxyをバイパスする
this.user.name = "Bob";
```

### 配列は非破壊的メソッドで

```javascript
// ✅ 新しい配列を返す + 代入
this.items = this.items.concat(newItem);
this.items = this.items.toSpliced(index, 1);
this.items = this.items.filter(item => !item.done);
this.items = this.items.toSorted((a, b) => a.id - b.id);

// ❌ 破壊的メソッド — 代入が発生しない
this.items.push(newItem);
this.items.splice(index, 1);
```

ES2023の非破壊配列メソッド（`toSpliced`, `toSorted`, `toReversed`, `with`）との相性が良い設計です。

---

## まとめ

| 概念 | 説明 |
|---|---|
| パスgetter | `get "a.*.b"()` — 任意の深さの仮想プロパティ |
| ワイルドカード `*` | 実行時にループインデックスに解決 |
| フラットな定義 | 深さに関係なくすべて一箇所に |
| 自動依存追跡 | アクセスが依存を登録。手動の依存配列は不要 |
| 要素ごとのキャッシュ | 影響を受けた要素のみ無効化 |
| getterチェーン | getter同士の参照で計算が連鎖 |
| `$getAll` | ワイルドカードに一致する全値を収集して集約 |
| パスsetter | `set "a.*.b"(v)` — カスタムの書き込みロジック |

パスgetterの考え方はシンプルです — 計算プロパティは、**コンポーネントの場所ではなくデータのある場所に定義する**。この一つの判断がコンポーネント分割の強制を取り除き、ネストされたデータの扱いを根本的に変えます。
