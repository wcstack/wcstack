# @wcstack/fetch

`@wcstack/fetch` は wcstack エコシステムのためのヘッドレス fetch コンポーネントです。

視覚的な UI ウィジェットではありません。
HTTP リクエストとリアクティブな状態をつなぐ **I/O ノード** です。

`@wcstack/state` と組み合わせると、`<wcs-fetch>` はパス契約を通じて直接バインドできます:

- **入力 / コマンドサーフェス**: `url`, `body`, `trigger`
- **出力ステートサーフェス**: `value`, `loading`, `error`, `status`

つまり、非同期通信を HTML 内で宣言的に表現できます。UI レイヤーに `fetch()`、`async/await`、loading/error のグルーコードを書く必要はありません。

`@wcstack/fetch` は [HAWC](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/main/docs/articles/HAWC.md) アーキテクチャに従います:

- **Core** (`FetchCore`) が HTTP、abort、非同期状態を処理
- **Shell** (`<wcs-fetch>`) がその状態を DOM に接続
- フレームワークやバインディングシステムは [wc-bindable-protocol](https://github.com/wc-bindable-protocol/wc-bindable-protocol) 経由で利用

## なぜこれが存在するのか

多くのフロントエンドアプリで、移行が最も困難なのはテンプレートではなく、非同期ロジックです。
HTTP リクエスト、ローディングフラグ、エラー処理、リトライ、ライフサイクルのクリーンアップ。

`@wcstack/fetch` はその非同期ロジックを再利用可能なコンポーネントに移し、結果をバインド可能な状態として公開します。

`@wcstack/state` と組み合わせたフローは:

1. 状態が `url` を算出
2. `<wcs-fetch>` がリクエストを実行
3. 非同期の結果が `value`, `loading`, `error`, `status` として返る
4. UI は `data-wcs` でそれらのパスにバインド

非同期通信が命令的な UI コードではなく、**状態遷移**になります。

## インストール

```bash
npm install @wcstack/fetch
```

## クイックスタート

### 1. 状態からのリアクティブ fetch

`url` が変わると、`<wcs-fetch>` は自動的に新しいリクエストを実行します。
既にリクエストが進行中の場合、前のリクエストは abort されます。

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/fetch/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      users: [],
      get usersUrl() {
        return "/api/users";
      },
    };
  </script>

  <wcs-fetch data-wcs="url: usersUrl; value: users"></wcs-fetch>

  <ul>
    <template data-wcs="for: users">
      <li data-wcs="textContent: users.*.name"></li>
    </template>
  </ul>
</wcs-state>
```

これがデフォルトモードです:

- `url` を接続
- `value` を受け取る
- 任意で `loading`、`error`、`status` もバインド

### 2. リアクティブ URL の例

算出 URL がデータ取得を自動的に駆動します:

```html
<wcs-state>
  <script type="module">
    export default {
      filterRole: "",
      users: [],

      get usersUrl() {
        const role = this.filterRole;
        return role ? "/api/users?role=" + role : "/api/users";
      },
    };
  </script>

  <select data-wcs="value: filterRole">
    <option value="">すべて</option>
    <option value="admin">Admin</option>
    <option value="staff">Staff</option>
  </select>

  <wcs-fetch
    data-wcs="url: usersUrl; value: users; loading: listLoading; error: listError">
  </wcs-fetch>

  <template data-wcs="if: listLoading">
    <p>読み込み中...</p>
  </template>
  <template data-wcs="if: listError">
    <p>ユーザーの読み込みに失敗しました。</p>
  </template>

  <ul>
    <template data-wcs="for: users">
      <li data-wcs="textContent: users.*.name"></li>
    </template>
  </ul>
</wcs-state>
```

### 3. `trigger` による手動実行

入力を先に準備し、後から実行したい場合は `manual` を使います。

```html
<wcs-state>
  <script type="module">
    export default {
      users: [],
      shouldRefresh: false,

      reload() {
        this.shouldRefresh = true;
      },
    };
  </script>

  <wcs-fetch
    url="/api/users"
    manual
    data-wcs="trigger: shouldRefresh; value: users; loading: listLoading">
  </wcs-fetch>

  <button data-wcs="onclick: reload">更新</button>
</wcs-state>
```

`trigger` は **単方向のコマンドサーフェス** です:

- `true` を書き込むと `fetch()` を開始
- 完了後に自動で `false` にリセット
- リセット時に `wcs-fetch:trigger-changed` を発火

```
外部からの書き込み:  false → true   イベントなし（fetch を開始）
自動リセット:        true  → false  wcs-fetch:trigger-changed を発火
```

### 4. リアクティブ body での POST

```html
<wcs-state>
  <script type="module">
    export default {
      newUser: {
        name: "",
        email: "",
      },
      submitRequest: false,
      submitResult: null,
      submitError: null,

      submit() {
        this.submitRequest = true;
      },
    };
  </script>

  <input data-wcs="value: newUser.name" placeholder="名前">
  <input data-wcs="value: newUser.email" placeholder="メール">

  <button data-wcs="onclick: submit">作成</button>

  <wcs-fetch
    url="/api/users"
    method="POST"
    manual
    data-wcs="
      body: newUser;
      trigger: submitRequest;
      value: submitResult;
      error: submitError;
      loading: submitLoading
    ">
    <wcs-fetch-header name="Content-Type" value="application/json"></wcs-fetch-header>
  </wcs-fetch>

  <template data-wcs="if: submitLoading">
    <p>送信中...</p>
  </template>
  <template data-wcs="if: submitError">
    <p>送信に失敗しました。</p>
  </template>
</wcs-state>
```

## ステートサーフェス vs コマンドサーフェス

`<wcs-fetch>` は 2 種類のプロパティを公開します。

### 出力ステート（バインド可能な非同期状態）

現在のリクエストの結果を表し、HAWC のメインサーフェスです:

| プロパティ | 型 | 説明 |
|------------|------|------|
| `value` | `any` | レスポンスデータ |
| `loading` | `boolean` | リクエスト実行中は `true` |
| `error` | `WcsFetchHttpError \| Error \| null` | HTTP またはネットワークエラー |
| `status` | `number` | HTTP ステータスコード |

### 入力 / コマンドサーフェス

HTML、JS、または `@wcstack/state` バインディングからリクエスト実行を制御します:

| プロパティ | 型 | 説明 |
|------------|------|------|
| `url` | `string` | リクエスト URL |
| `body` | `any` | リクエストボディ（`fetch()` 後に `null` にリセット） |
| `trigger` | `boolean` | 単方向の実行トリガー |
| `manual` | `boolean` | 接続時 / URL 変更時の自動実行を無効化 |

## アーキテクチャ

`@wcstack/fetch` は HAWC アーキテクチャに従います。

### Core: `FetchCore`

`FetchCore` は純粋な `EventTarget` クラスです。
以下を内包します:

- HTTP 実行
- abort 制御
- 非同期状態遷移
- `wc-bindable-protocol` 宣言

`EventTarget` と `fetch` をサポートする任意のランタイムでヘッドレスに動作します。

### Shell: `<wcs-fetch>`

`<wcs-fetch>` は `FetchCore` の薄い `HTMLElement` ラッパーです。
以下を追加します:

- 属性 / プロパティマッピング
- DOM ライフサイクル統合
- `trigger` などの宣言的実行ヘルパー

この分離により、非同期ロジックのポータビリティを保ちながら、`@wcstack/state` のような DOM ベースのバインディングシステムとの自然な連携を可能にしています。

### Target injection

Core は **target injection** により Shell 上で直接イベントを発火するため、イベントの再ディスパッチは不要です。

## ヘッドレス利用（Core 単体）

`FetchCore` は DOM なしで単体利用できます。`static wcBindable` を宣言しているため、`@wc-bindable/core` の `bind()` で状態をサブスクライブできます — フレームワークアダプタと同じ仕組みです:

```typescript
import { FetchCore } from "@wcstack/fetch";
import { bind } from "@wc-bindable/core";

const core = new FetchCore();

const unbind = bind(core, (name, value) => {
  console.log(`${name}:`, value);
});

await core.fetch("/api/users");

unbind();
```

Node.js、Deno、Cloudflare Workers など、`EventTarget` と `fetch` が利用可能な環境で動作します。

## URL の監視

`<wcs-fetch>` はデフォルトで以下のタイミングに自動的にリクエストを実行します:

1. DOM に接続され、`url` が設定されているとき
2. `url` が変更されたとき

URL 変更時にリクエストが進行中の場合、前のリクエストは自動的に abort されてから新しいリクエストが開始されます。

`manual` 属性を設定すると自動実行が無効になり、`fetch()` メソッドや `trigger` プロパティで明示的に制御できます。

## プログラムからの利用

```javascript
const fetchEl = document.querySelector("wcs-fetch");

// JS API 経由で body を設定（<wcs-fetch-body> より優先）
fetchEl.body = { name: "田中" };
await fetchEl.fetch();
// 注意: body は fetch() 後に自動で null にリセットされます。
// 再度送信する場合は、毎回 body を設定してください。

console.log(fetchEl.value);   // レスポンスデータ
console.log(fetchEl.status);  // HTTP ステータスコード
console.log(fetchEl.loading); // boolean
console.log(fetchEl.error);   // エラー情報 or null
console.log(fetchEl.body);    // null（fetch 後にリセット済み）
```

## HTML リプレースモード

`target` を設定すると、`<wcs-fetch>` は対象要素の `innerHTML` を差し替えます。

```html
<div id="content">初期コンテンツ</div>
<wcs-fetch url="/api/partial" target="content"></wcs-fetch>
```

このモードはシンプルなフラグメント読み込みに便利ですが、`@wcstack/state` との**ステート駆動**な利用とは別の機能です。

## オプションの DOM トリガー

`autoTrigger` が有効（デフォルト）の場合、`data-fetchtarget` 属性を持つ要素のクリックで対応する `<wcs-fetch>` が実行されます:

```html
<button data-fetchtarget="user-fetch">ユーザー読み込み</button>
<wcs-fetch id="user-fetch" url="/api/users"></wcs-fetch>
```

イベント委譲を使用しているため、動的に追加された要素でも動作します。`closest()` API により、ネストされた子要素（ボタン内のアイコン等）のクリックも検出します。

指定した id に一致する要素が存在しない場合、または一致した要素が `<wcs-fetch>` でない場合、クリックは無視されます（エラーは発生しません）。

これは便利機能です。
wcstack アプリケーションでは、**`trigger` によるステート駆動のトリガー**が通常の主要パターンです。

## 要素一覧

### `<wcs-fetch>`

| 属性 | 型 | デフォルト | 説明 |
|------|------|------------|------|
| `url` | `string` | — | リクエスト URL |
| `method` | `string` | `GET` | HTTP メソッド |
| `target` | `string` | — | HTML リプレース対象の DOM 要素 id |
| `manual` | `boolean` | `false` | 自動実行を無効化 |

| プロパティ | 型 | 説明 |
|------------|------|------|
| `value` | `any` | レスポンスデータ |
| `loading` | `boolean` | リクエスト実行中は `true` |
| `error` | `WcsFetchHttpError \| Error \| null` | エラー情報 |
| `status` | `number` | HTTP ステータスコード |
| `body` | `any` | リクエストボディ（`fetch()` 後に `null` にリセット） |
| `trigger` | `boolean` | `true` を設定すると fetch を実行 |
| `manual` | `boolean` | 明示的実行モード |

| メソッド | 説明 |
|----------|------|
| `fetch()` | HTTP リクエストを実行 |
| `abort()` | 実行中のリクエストをキャンセル |

### `<wcs-fetch-header>`

リクエストヘッダを定義。`<wcs-fetch>` の子要素として配置。

| 属性 | 型 | 説明 |
|------|------|------|
| `name` | `string` | ヘッダ名 |
| `value` | `string` | ヘッダ値 |

### `<wcs-fetch-body>`

リクエストボディを定義。`<wcs-fetch>` の子要素として配置。

| 属性 | 型 | デフォルト | 説明 |
|------|------|------------|------|
| `type` | `string` | `application/json` | Content-Type |

要素のテキストコンテンツがボディとして送信されます。

例:

```html
<wcs-fetch url="/api/users" method="POST">
  <wcs-fetch-header name="Authorization" value="Bearer token123"></wcs-fetch-header>
  <wcs-fetch-header name="Accept" value="application/json"></wcs-fetch-header>
  <wcs-fetch-body type="application/json">
    {"name": "田中", "email": "tanaka@example.com"}
  </wcs-fetch-body>
</wcs-fetch>
```

## wc-bindable-protocol

`FetchCore` と `<wcs-fetch>` はどちらも wc-bindable-protocol に準拠しており、プロトコル対応の任意のフレームワークやコンポーネントと相互運用できます。

### Core (`FetchCore`)

`FetchCore` は任意のランタイムからサブスクライブできるバインド可能な非同期状態を宣言します:

```typescript
static wcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "value",   event: "wcs-fetch:response",
      getter: (e) => e.detail.value },
    { name: "loading", event: "wcs-fetch:loading-changed" },
    { name: "error",   event: "wcs-fetch:error" },
    { name: "status",  event: "wcs-fetch:response",
      getter: (e) => e.detail.status },
  ],
};
```

ヘッドレスの利用者は `core.fetch(url)` を直接呼ぶため、`trigger` は不要です。

### Shell (`<wcs-fetch>`)

Shell は Core の宣言を拡張し、バインディングシステムから宣言的に fetch を実行できるようにします:

```typescript
static wcBindable = {
  ...FetchCore.wcBindable,
  properties: [
    ...FetchCore.wcBindable.properties,
    { name: "trigger", event: "wcs-fetch:trigger-changed" },
  ],
};
```

## TypeScript 型

```typescript
import type {
  WcsFetchHttpError, WcsFetchCoreValues, WcsFetchValues
} from "@wcstack/fetch";
```

```typescript
// HTTP エラー（status >= 400）
interface WcsFetchHttpError {
  status: number;
  statusText: string;
  body: string;
}

// Core（ヘッドレス）— 4 つの非同期状態プロパティ
// T のデフォルトは unknown。型引数を渡すと value が型付けされる
interface WcsFetchCoreValues<T = unknown> {
  value: T;
  loading: boolean;
  error: WcsFetchHttpError | Error | null;
  status: number;
}

// Shell（<wcs-fetch>）— Core を拡張し trigger を追加
interface WcsFetchValues<T = unknown> extends WcsFetchCoreValues<T> {
  trigger: boolean;
}
```

## なぜ `@wcstack/state` とうまく連携するのか

`@wcstack/state` は UI と状態の唯一の契約としてパス文字列を使います。
`<wcs-fetch>` はこのモデルに自然に適合します:

- 状態が `url` を算出
- `<wcs-fetch>` がリクエストを実行
- 非同期の結果が `value`, `loading`, `error`, `status` として返る
- UI は fetch のグルーコードを書かずにそれらのパスにバインド

非同期処理が通常の状態更新と同じように見えるようになります。

## フレームワーク連携

`<wcs-fetch>` は HAWC + `wc-bindable-protocol` なので、`@wc-bindable/*` の薄いアダプタを通じて任意のフレームワークで動作します。

### React

```tsx
import { useWcBindable } from "@wc-bindable/react";
import type { WcsFetchValues } from "@wcstack/fetch";

interface User { id: number; name: string; }

function UserList() {
  const [ref, { value: users, loading, error }] =
    useWcBindable<HTMLElement, WcsFetchValues<User[]>>();

  return (
    <>
      <wcs-fetch ref={ref} url="/api/users" />
      {loading && <p>読み込み中...</p>}
      {error && <p>エラー</p>}
      <ul>
        {users?.map((user) => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
    </>
  );
}
```

### Vue

```vue
<script setup lang="ts">
import { useWcBindable } from "@wc-bindable/vue";
import type { WcsFetchValues } from "@wcstack/fetch";

interface User { id: number; name: string; }

const { ref, values } = useWcBindable<HTMLElement, WcsFetchValues<User[]>>();
</script>

<template>
  <wcs-fetch :ref="ref" url="/api/users" />
  <p v-if="values.loading">読み込み中...</p>
  <p v-else-if="values.error">エラー</p>
  <ul v-else>
    <li v-for="user in values.value" :key="user.id">{{ user.name }}</li>
  </ul>
</template>
```

### Svelte

```svelte
<script>
import { wcBindable } from "@wc-bindable/svelte";

let users = $state(null);
let loading = $state(false);
</script>

<wcs-fetch url="/api/users"
  use:wcBindable={{ onUpdate: (name, v) => {
    if (name === "value") users = v;
    if (name === "loading") loading = v;
  }}} />

{#if loading}
  <p>読み込み中...</p>
{:else if users}
  <ul>
    {#each users as user (user.id)}
      <li>{user.name}</li>
    {/each}
  </ul>
{/if}
```

### Solid

```tsx
import { createWcBindable } from "@wc-bindable/solid";
import type { WcsFetchValues } from "@wcstack/fetch";

interface User { id: number; name: string; }

function UserList() {
  const [values, directive] = createWcBindable<WcsFetchValues<User[]>>();

  return (
    <>
      <wcs-fetch ref={directive} url="/api/users" />
      <Show when={!values.loading} fallback={<p>読み込み中...</p>}>
        <ul>
          <For each={values.value}>{(user) => <li>{user.name}</li>}</For>
        </ul>
      </Show>
    </>
  );
}
```

### Vanilla — `bind()` を直接利用

```javascript
import { bind } from "@wc-bindable/core";

const fetchEl = document.querySelector("wcs-fetch");

bind(fetchEl, (name, value) => {
  console.log(`${name} changed:`, value);
});
```

## 設定

```javascript
import { bootstrapFetch } from "@wcstack/fetch";

bootstrapFetch({
  autoTrigger: true,
  triggerAttribute: "data-fetchtarget",
  tagNames: {
    fetch: "wcs-fetch",
    fetchHeader: "wcs-fetch-header",
    fetchBody: "wcs-fetch-body",
  },
});
```

## 設計メモ

- `value`、`loading`、`error`、`status` は **出力ステート**
- `url`、`body`、`trigger` は **入力 / コマンドサーフェス**
- `trigger` は意図的に単方向: `true` を書き込むと実行、リセットで完了を通知
- `body` は `fetch()` 呼び出しごとに `null` にリセット — 再送信時は毎回設定が必要
- `manual` は実行タイミングを明示的に制御したい場合に有用
- HTML リプレースモードはオプション。wcstack の主要パターンはステート駆動バインディング

## ライセンス

MIT
