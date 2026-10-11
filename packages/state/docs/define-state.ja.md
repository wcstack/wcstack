# `defineState()` — 型付き状態定義

## 概要

`defineState()` は `@wcstack/state` の状態オブジェクトに TypeScript の型サポートを追加するユーティリティ関数です。ランタイムでは**アイデンティティ関数**（引数をそのまま返す）としてのみ動作し、オーバーヘッドはゼロです。すべての型付けは `ThisType<>` による型レベルの処理です。

`defineState()` でラップすることで、以下が得られます:

- **型付き `this`** — メソッドや getter 内でのプロパティアクセスが型チェックされる
- **ドットパス自動補完** — `this["users.*.name"]` が IDE で `string` として解決される
- **State Proxy API の型** — `$getAll`, `$postUpdate`, `$1`〜`$9` 等が `this` 上で型付け

import 元は **`@wcstack/state/define`** にしてください: このエントリは `defineState` と型だけを持ち、ランタイムを含みません。`@wcstack/state` から `defineState` を import しても動きますが、エンジン全体が一緒に読み込まれます。

## 基本的な使い方

### TypeScript

```typescript
import { defineState } from '@wcstack/state/define';

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
import { defineState } from '@wcstack/state/define';

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
    import { defineState } from '@wcstack/state/define';
    export default defineState({
      count: 0,
      increment() { this.count++; }
    });
  </script>
</wcs-state>
```

ブラウザでは bare specifier に import map のエントリが必要です — たとえば `"@wcstack/state/define": "https://cdn.jsdelivr.net/npm/@wcstack/state@4/dist/define.js"`（jsDelivr の `/npm/` パスは `exports` を読まないので、ファイル名まで書きます）。

## 仕組み

`defineState<T>()` は渡されたオブジェクトリテラルから型 `T` を推論します。`ThisType<WcsThis<T>>` を適用することで、メソッドや getter 内の `this` が以下の型になります:

```
WcsThis<T> = T & WcsStateApi & WcsPathAccessor<T>
```

| レイヤー | 提供する型 |
|---|---|
| `T` | 直接プロパティ — `this.count`, `this.users`, `this["users.*.ageCategory"]` |
| `WcsStateApi` | Proxy API — `this.$getAll()`, `this.$postUpdate()`, `this.$1`〜`$9`, `this["$streamStatus.<name>"]` |
| `WcsPathAccessor<T>` | ドットパス解決 — `this["users.*.name"]`, `this["cart.items.*.price"]` |

何でも受け付ける索引シグネチャはありません: ブラケットアクセスに型が付くのは、キーが上のいずれかのパスであるときだけです。そのため存在しないパス（`this["users.*.nmae"]`）は型エラーになり、動的パスも同様です（[動的パスには型が付かない](#動的パスには型が付かない)）。例外が 1 つあります: 戻り値の型が推論される getter の中では、戻り値が依存する読みが `any` になります（[戻り値の型が推論される getter](#戻り値の型が推論される-getter)）。

## ドットパス型解決

### `WcsPaths<T>` — パス生成

`WcsPaths<T>` は型からドット区切りの全パスを union として生成します。配列は `*` をワイルドカードとして使用します。

```typescript
import type { WcsPaths } from '@wcstack/state/define';

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
| `$` で始まるキー（`$stream`, `$watch`, `$connectedCallback` など） | 完全に除外 |

**再帰の深さ制限:** 最大4レベル（コンパイル性能の確保）。

### `WcsPathValue<T, P>` — パス値解決

`WcsPathValue<T, P>` は指定されたドットパスの値の型を解決します。

```typescript
import type { WcsPathValue } from '@wcstack/state/define';

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

### 再帰パス（`**`）

`$recursion` を宣言した state では、`this` 経由で再帰パスを読めます。`**` は深さの族そのものを
表し、有限のパスのユニオンでは列挙できないので、これらのパスはパターン索引シグネチャで
`any` になります:

```typescript
export default defineState({
  nodes: [] as { value: number; children: any[] }[],
  $recursion: { "nodes.*": "children.*" },
  get "nodes.**.total"(): number {
    return (this["nodes.**.value"] as number)
      + (this.$getAll("nodes.**.children.*.total") as number[]).reduce((a, b) => a + b, 0);
  },
});
```

`any` になるのは実際に `**` を含むキーだけです（再帰 getter の中でノード自身に束縛される素の
`this["nodes.**"]` も含みます）。通常のドットパスは解決された値の型を保ち、綴り間違いは従来どおり
型エラーになります。VS Code 拡張の preamble も同じシグネチャを宣言しているので、エディタと `tsc` の
判定は一致します。README の [再帰パス](../README.ja.md#再帰パスrecursion) 節と
[state-recursive-path-design.md](../../../docs/state-recursive-path-design.md) も参照してください。

## State Proxy API (`WcsStateApi`)

`defineState()` 内の `this` で利用できるプロパティとメソッド:

### メソッド

| API | シグネチャ | 説明 |
|---|---|---|
| `$getAll` | `$getAll<V = any>(path: string, indexes?: number[]): V[]` | ワイルドカードパスにマッチする全値を取得。`indexes` はワイルドカードに対する前方一致の接頭辞（`[]` = 全件）。省略時はループ文脈から取る |
| `$setAll` | `$setAll<V = any>(path: string, indexes: number[], value: V \| ((current: V, ...indexes: number[]) => V \| undefined)): number` | ワイルドカードパスにマッチする全アドレスへ書き込む（ブロードキャストまたは mapper）。配列と `{ spread: true }` を取る 2 つ目のオーバーロードは、各アドレスに 1 件ずつ配る。戻り値は書き込んだアドレス数 |
| `$postUpdate` | `$postUpdate(path: string): void` | パスの更新を手動トリガー |
| `$resolve` | `$resolve(path: string, indexes: number[], value?: any): any` | ワイルドカードを特定インデックスで解決して読む（引数 2 つ）・書く（引数 3 つ） |
| `$dependOn` | `$dependOn(path: string): void` | 依存関係を手動登録 |
| `$untracked` | `$untracked<T>(fn: () => T): T` | fn 実行中の依存追跡（動的依存・`$1` インデックス依存）を抑止して値を読む |
| `$eq` | `$eq(path: string, key: unknown): boolean` | 鍵付き選択: `path` の値が `key` と等しいか |
| `$eqPath` | `$eqPath(path: string, keyPath: string): boolean` | 鍵を `keyPath`（ワイルドカードは評価中の行で解決）から読む `$eq` |
| `$eqIndex` | `$eqIndex(path: string, level?: number): boolean` | 評価中の行の index を鍵にする `$eq` |

挙動は README の [Proxy API](../README.ja.md#proxy-api) 節と [鍵付き選択](../README.ja.md#鍵付き選択eq--eqpath--eqindex) 節にあります。3.x の名前 `$trackDependency` / `$untrackDependency` は型にありません。ランタイムでは、`diagnostics` アドオンが入っていれば（`@wcstack/state`・`/auto`）読んだ時点で `[wcs/name-alias]` を throw し、入っていなければ `undefined` を読みます。

### プロパティ

| API | 型 | 説明 |
|---|---|---|
| `$stateElement` | `HTMLElement` | `<wcs-state>` 要素への参照 |
| `$command` | `Record<string, { emit(...args: any[]): any }>` | `$commandTokens` で宣言した command token |
| `$streamStatus` / `$streamError` | `Record<string, …>` | `$stream` のコンパニオン名前空間（このオブジェクト経由の読みは依存を登録しない） |
| `this["$streamStatus.<name>"]` / `this["$streamError.<name>"]` | `"idle" \| "active" \| "done" \| "error"` / `unknown` | getter 内で使う、追跡される形 |
| `$1` 〜 `$9` | `number` | ループインデックス変数（値は0始まり、名前は1始まり）。ランタイムは `$128` まで解決しますが、型は `$9` までです |

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

  $renderedCallback() {
    console.log('DOM updated');
  }
});
```

3.x の名前 `$updatedCallback` は状態の読み込み時に throw します。`$renderedCallback` と書いてください。

## `$stream` 宣言

`$commandTokens` / `$eventTokens` / `$on` と並んで、状態オブジェクトは `$stream` 宣言マップを認識します。各エントリは非同期プロデューサー（async iterable / async generator / `ReadableStream`）を単一のリアクティブプロパティに畳み込みます:

```typescript
import { defineState } from '@wcstack/state/define';

// (args, AbortSignal) => AsyncIterable | ReadableStream のプロデューサーなら何でもよい
declare function llmStream(prompt: string, signal: AbortSignal): AsyncIterable<string>;

export default defineState({
  prompt: "",
  answer: "",  // ランタイムでは stream の所有物。先に宣言しておくと `this.answer` に型が付く

  $stream: {
    answer: {
      // `$stream` のコールバックにはまだ文脈型が付かない（宣言マップの型付けは
      // 後続課題）ため、引数の型は明示的に注釈する。
      args:    (state: { prompt: string }) => state.prompt,  // ここで読んだパスが restart を駆動する
      source:  (prompt: string, signal: AbortSignal) => llmStream(prompt, signal),
      fold:    (acc: string, token: string) => acc + token,
      initial: "",
    },
  },
});
```

stream は `$connectedCallback` の後に起動し、各チャンクを `this.answer` に畳み込み、`args` 内で読んだパスが変化するたびに restart（abort → `initial` リセット → 新 run）します。ランタイム状態は読み取り専用のコンパニオンパス `$streamStatus.answer` / `$streamError.answer` として公開されます。

完全な契約 — 協調キャンセル・有界 fold 規範・バリデーション・ライフサイクル — は [Streams](./streams.ja.md) を参照してください。

## 使用例

### カウンター

```typescript
import { defineState } from '@wcstack/state/define';

export default defineState({
  count: 0,
  increment() { this.count++; },
  decrement() { this.count--; },
});
```

### ユーザーリストと computed プロパティ

```typescript
import { defineState } from '@wcstack/state/define';

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
import { defineState } from '@wcstack/state/define';

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
import { defineState } from '@wcstack/state/define';

export default defineState({
  items: [] as { name: string }[],

  onDelete(_event: Event) {
    const index = this.$1; // ループインデックス（0始まり）
    this.items = this.items.toSpliced(index, 1);
  },
});
```

ハンドラはイベントの後ろにループインデックスも受け取ります（`onDelete(event, index)`）。型は `number` にしてください。

### 非同期データ読み込み

```typescript
import { defineState } from '@wcstack/state/define';

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

### 戻り値の型が推論される getter

getter の型は `T` の一部で、`this` の型を決めるのはその `T` です — そのため戻り値の型注釈が無い getter では、TypeScript はこの循環を断つために、戻り値が依存する `this` の読みを `any` にします。そのような getter の中では、その依存の連鎖にある綴り間違いのパスは報告されず、`this` のメソッドに型引数を付けるとエラーになります:

```typescript
defineState({
  items: [] as { price: number }[],
  get total() {
    // ❌ this.$getAll<number>(...) — TS2347「Untyped function calls may not accept type arguments」
    // ✅ 代わりに結果をアサーションする:
    const prices = this.$getAll("items.*.price", []) as number[];
    return prices.reduce((s, v) => s + v, 0);
  },
  get checked(): number {
    // ✅ 戻り値の型を注釈すれば `this` は完全に型付けされる（綴り間違いもエラー）
    return this.$getAll<number>("items.*.price", []).length;
  },
});
```

メソッドは影響を受けません。戻り値が依存しない読みも同様です。getter の本体を型チェックさせたいときは、戻り値の型を注釈してください。

### 動的パスには型が付かない

`WcsThis<T>` には何でも受け付ける索引シグネチャが無いため、実行時に組み立てたパスは型付きのキーになりません。`strict` では `` this[`items.${i}.name`] `` はエラーです（TS7053「Element implicitly has an 'any' type」）。そのようなアドレスは、インデックスを別に渡す `$resolve`（戻り値は `any`）で読み書きするか、キャストしてください:

```typescript
defineState({
  items: [] as { name: string }[],
  rename(i: number, name: string) {
    // ❌ this[`items.${i}.name`] = name;             — TS7053
    this.$resolve("items.*.name", [i], name);         // ✅
    // (this as Record<string, any>)[`items.${i}.name`] = name;   // ✅ これも可
  },
});
```

### 再帰の深さ制限

`WcsPaths<T>` はコンパイル時間の増大を防ぐため、再帰を4レベルに制限しています。極端に深い構造では、第4ネストレベルを超えるパスは生成されません。

## HTML に届ける: `wcs-schema` → `wcs-validate`

`defineState` が型を付けるのは state ファイルです。それをバインドする HTML には何も伝わりません — 静的検証器（`wcs-validate`・VS Code 拡張）は state を型チェッカーでなく正規表現アナライザで読むので、`users: [] as { name: string }[]` の `users.*.name` はそこでは解決できません。型を向こう側へ渡すには、同じファイルから [`@wcstack/typescript`](../../typescript/README.ja.md) で sidecar の `stateSchema` を生成します:

```bash
npx wcs-schema emit src/state.ts        # TS の型から wcstack.manifest.json を書く
npx wcs-validate --strict index.html    # 型に無いパスは error に、偽警告は消える
```

`wcs-schema check src/state.ts` は manifest が型から乖離すると CI を落とします。wcstack アプリの TypeScript の話全体は [docs/typescript.ja.md](../../../docs/typescript.ja.md) にまとめています。

## エクスポートされる型

`@wcstack/state/define` は関数と下の型をエクスポートします。`@wcstack/state` と `@wcstack/state/core` も同じ名前をエクスポートします。

| 型 | 説明 |
|---|---|
| `defineState<T>(definition): T` | `ThisType<WcsThis<T>>` 付きアイデンティティ関数 |
| `WcsThis<T>` | state メソッド/getter 内の `this` の型 |
| `WcsStateApi` | Proxy API インターフェース（`$getAll`, `$postUpdate`, `$1`〜`$9` 等） |
| `WcsPaths<T>` | 型 `T` の全ドットパスの union |
| `WcsPathValue<T, P>` | 型 `T` のパス `P` における値の型 |
