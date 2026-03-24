# `defineState()` — 型付き状態定義

## 概要

`defineState()` は `@wcstack/state` の状態オブジェクトに TypeScript の型サポートを追加するユーティリティ関数です。ランタイムでは**アイデンティティ関数**（引数をそのまま返す）としてのみ動作し、オーバーヘッドはゼロです。すべての型付けは `ThisType<>` による型レベルの処理です。

`defineState()` でラップすることで、以下が得られます:

- **型付き `this`** — メソッドや getter 内でのプロパティアクセスが型チェックされる
- **ドットパス自動補完** — `this["users.*.name"]` が IDE で `string` として解決される
- **State Proxy API の型** — `$getAll`, `$postUpdate`, `$1`〜`$9` 等が `this` 上で型付け

## 基本的な使い方

### TypeScript

```typescript
import { defineState } from '@wcstack/state';

export default defineState({
  count: 0,
  users: [] as { name: string; age: number }[],

  increment() {
    this.count++;            // ✅ number
    this["users.*.name"];    // ✅ string
  },

  get "users.*.ageCategory"() {
    return this["users.*.age"] < 25 ? "Young" : "Adult";
  }
});
```

### JavaScript（JSDoc / `checkJs`）

```javascript
import { defineState } from '@wcstack/state';

export default defineState({
  count: 0,
  increment() {
    this.count++;  // ✅ checkJs 有効時に型チェック
  }
});
```

### HTML インラインスクリプト

```html
<wcs-state>
  <script type="module">
    import { defineState } from '@wcstack/state';
    export default defineState({
      count: 0,
      increment() { this.count++; }
    });
  </script>
</wcs-state>
```

## 仕組み

`defineState<T>()` は渡されたオブジェクトリテラルから型 `T` を推論します。`ThisType<WcsThis<T>>` を適用することで、メソッドや getter 内の `this` が以下の型になります:

```
WcsThis<T> = T & WcsStateApi & WcsPathAccessor<T> & Record<string, any>
```

| レイヤー | 提供する型 |
|---|---|
| `T` | 直接プロパティ — `this.count`, `this.users`, `this["users.*.ageCategory"]` |
| `WcsStateApi` | Proxy API — `this.$getAll()`, `this.$postUpdate()`, `this.$1`〜`$9` |
| `WcsPathAccessor<T>` | ドットパス解決 — `this["users.*.name"]`, `this["cart.items.*.price"]` |
| `Record<string, any>` | 動的パスのフォールバック — `this[\`items.${i}.name\`]` |

## ドットパス型解決

### `WcsPaths<T>` — パス生成

`WcsPaths<T>` は型からドット区切りの全パスを union として生成します。配列は `*` をワイルドカードとして使用します。

```typescript
import type { WcsPaths } from '@wcstack/state';

type AppState = {
  count: number;
  users: { name: string; age: number }[];
  cart: { items: { price: number }[] };
};

type Paths = WcsPaths<AppState>;
// = "count"
// | "users" | "users.*" | "users.*.name" | "users.*.age"
// | "cart" | "cart.items" | "cart.items.*" | "cart.items.*.price"
```

**ルール:**

| プロパティ型 | 生成されるパス |
|---|---|
| プリミティブ (`string`, `number` 等) | `key` のみ |
| プレーンオブジェクト | `key` + 再帰的サブパス (`key.subKey`) |
| プレーンオブジェクトの配列 | `key`, `key.*` + 再帰的サブパス (`key.*.subKey`) |
| プリミティブの配列 | `key`, `key.*` |
| 組み込みオブジェクト (`Date`, `Map`, `Set`, `RegExp` 等) | `key` のみ（再帰なし） |
| 関数（メソッド） | 完全に除外 |

**再帰の深さ制限:** 最大4レベル（コンパイル性能の確保）。

### `WcsPathValue<T, P>` — パス値解決

`WcsPathValue<T, P>` は指定されたドットパスの値の型を解決します。

```typescript
import type { WcsPathValue } from '@wcstack/state';

type AppState = {
  cart: { items: { price: number; qty: number }[] };
};

type A = WcsPathValue<AppState, "cart.items.*.price">; // number
type B = WcsPathValue<AppState, "cart.items.*">;        // { price: number; qty: number }
type C = WcsPathValue<AppState, "cart">;                 // { items: { price: number; qty: number }[] }
```

**解決順序:**

1. `T` の直接キー（computed getter 含む。例: `"users.*.ageCategory"`）
2. `K.*` — 配列要素型
3. `K.rest` — オブジェクト/配列の再帰的走査

### 多重ワイルドカード

ネストされた配列の複数ワイルドカードに完全対応:

```typescript
type State = {
  categories: {
    label: string;
    products: { name: string; price: number }[];
  }[];
};

type Paths = WcsPaths<State>;
// 含まれるパス:
// "categories.*.products.*.name"
// "categories.*.products.*.price"
// "categories.*.label"
// 等

type V = WcsPathValue<State, "categories.*.products.*.name">; // string
```

## State Proxy API (`WcsStateApi`)

`defineState()` 内の `this` で利用できるプロパティとメソッド:

### メソッド

| API | シグネチャ | 説明 |
|---|---|---|
| `$getAll` | `$getAll<V>(path: string, defaultValue?: V[]): V[]` | ワイルドカードパスにマッチする全値を取得 |
| `$postUpdate` | `$postUpdate(path: string): void` | パスの更新を手動トリガー |
| `$resolve` | `$resolve(path: string, indexes: number[], value?: any): any` | ワイルドカードを特定インデックスで解決 |
| `$trackDependency` | `$trackDependency(path: string): void` | 依存関係を手動登録 |

### プロパティ

| API | 型 | 説明 |
|---|---|---|
| `$stateElement` | `HTMLElement` | `<wcs-state>` 要素への参照 |
| `$1` 〜 `$9` | `number` | ループインデックス変数（値は0始まり、名前は1始まり） |

### ライフサイクルコールバック

状態オブジェクトのメソッドとして定義:

```typescript
defineState({
  data: null as string | null,

  async $connectedCallback() {
    this.data = await fetch('/api/data').then(r => r.json());
  },

  $disconnectedCallback() {
    this.data = null;
  },

  $updatedCallback() {
    console.log('DOM updated');
  }
});
```

## 使用例

### カウンター

```typescript
import { defineState } from '@wcstack/state';

export default defineState({
  count: 0,
  increment() { this.count++; },
  decrement() { this.count--; },
});
```

### ユーザーリストと computed プロパティ

```typescript
import { defineState } from '@wcstack/state';

export default defineState({
  users: [
    { name: "Alice", age: 30 },
    { name: "Bob", age: 25 },
  ] as { name: string; age: number }[],

  get "users.*.ageCategory"() {
    const age = this["users.*.age"]; // number（WcsPathAccessor 経由）
    if (age < 25) return "Young";
    if (age < 35) return "Adult";
    return "Senior";
  },
});
```

### ショッピングカートと getter チェーン

```typescript
import { defineState } from '@wcstack/state';

type CartItem = { productId: number; quantity: number; unitPrice: number };

export default defineState({
  taxRate: 0.1,
  cart: {
    items: [] as CartItem[],
  },

  get "cart.items.*.subtotal"() {
    return this["cart.items.*.unitPrice"] * this["cart.items.*.quantity"];
  },

  get "cart.totalPrice"() {
    const prices = this.$getAll("cart.items.*.subtotal", []) as number[];
    return prices.reduce((sum, v) => sum + v, 0);
  },

  get "cart.tax"() {
    return this["cart.totalPrice"] * this.taxRate;
  },

  get "cart.grandTotal"() {
    return this["cart.totalPrice"] + this["cart.tax"];
  },

  onDeleteItem(_event: Event) {
    const index = this.$1; // number — ループインデックス
    this["cart.items"] = this["cart.items"].toSpliced(index, 1);
  },
});
```

### イベントハンドラとループインデックス

```typescript
import { defineState } from '@wcstack/state';

export default defineState({
  items: [] as { name: string }[],

  onDelete(_event: Event) {
    const index = this.$1; // ループインデックス（0始まり）
    this.items = this.items.toSpliced(index, 1);
  },
});
```

### 非同期データ読み込み

```typescript
import { defineState } from '@wcstack/state';

export default defineState({
  loading: false,
  error: null as string | null,
  users: [] as { id: number; name: string }[],

  async $connectedCallback() {
    this.loading = true;
    try {
      const res = await fetch('/api/users');
      this.users = await res.json();
    } catch (e) {
      this.error = String(e);
    } finally {
      this.loading = false;
    }
  },
});
```

## 既知の制限事項

### `ThisType<>` 内でのジェネリック型引数

TypeScript の制限により、`defineState()` 内の `this` メソッドにジェネリック型引数を付けることはできません:

```typescript
defineState({
  items: [] as { price: number }[],
  get total() {
    // ❌ this.$getAll<number>(...) — 型引数は使用不可
    // ✅ 型アサーションで対応:
    const prices = this.$getAll("items.*.price", []) as number[];
    return prices.reduce((s, v) => s + v, 0);
  }
});
```

### `Record<string, any>` フォールバック

`WcsThis<T>` は動的パスアクセス（`this[\`items.${i}.name\`]`）をサポートするため `Record<string, any>` を含みます。副作用として、ブラケットアクセスの型レベルでの解決結果は `any` になります。IDE は型付きパスを自動補完候補として表示しますが、アクセス箇所での推論型は `any` です。

### 再帰の深さ制限

`WcsPaths<T>` はコンパイル時間の増大を防ぐため、再帰を4レベルに制限しています。極端に深い構造では、第4ネストレベルを超えるパスは生成されません。

## エクスポートされる型

| 型 | 説明 |
|---|---|
| `defineState<T>(definition): T` | `ThisType<WcsThis<T>>` 付きアイデンティティ関数 |
| `WcsThis<T>` | state メソッド/getter 内の `this` の型 |
| `WcsStateApi` | Proxy API インターフェース（`$getAll`, `$postUpdate`, `$1`〜`$9` 等） |
| `WcsPaths<T>` | 型 `T` の全ドットパスの union |
| `WcsPathValue<T, P>` | 型 `T` のパス `P` における値の型 |
