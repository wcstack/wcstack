# @wcstack/fetch

Web Components による宣言的な非同期通信コンポーネント。HTTP 通信をカプセル化し、[wc-bindable-protocol](https://github.com/wc-bindable-protocol/wc-bindable-protocol) でリアクティブな状態を公開する [HAWC](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/main/docs/articles/HAWC.md)（Headless Async Web Component）です。

ランタイム依存ゼロ。React、Vue、Svelte、Solid、Angular、vanilla JavaScript のどこからでも使えます。

## インストール

```bash
npm install @wcstack/fetch
```

## クイックスタート

```javascript
import { bootstrapFetch } from "@wcstack/fetch";

bootstrapFetch();
```

または自動ブートストラップ:

```html
<script type="module" src="https://esm.run/@wcstack/fetch/auto"></script>
```

## アーキテクチャ — Core / Shell

`@wcstack/fetch` は HAWC の Core/Shell パターンに従います:

```
┌─────────────────────────────────────────────────┐
│  FetchCore (EventTarget)                        │
│  - 非同期ロジック、状態管理、dispatchEvent      │
│  - ブラウザ、Node、Deno、Workers で動作         │
├─────────────────────────────────────────────────┤
│  Fetch (HTMLElement) — Shell                    │
│  - 属性マッピング、ライフサイクル               │
│  - ref 経由のフレームワークバインディング       │
└─────────────────────────────────────────────────┘
```

**Core (`FetchCore`)** — `EventTarget` を継承し、すべての非同期ロジック（HTTP リクエスト、abort、状態管理）を内包。DOM 依存ゼロで、任意の JavaScript ランタイムで動作します。

**Shell (`<wcs-fetch>`)** — 薄い `HTMLElement` ラッパー。HTML 属性を Core のパラメータにマッピングし、DOM ライフサイクルを管理し、ref 経由のフレームワークバインディングを可能にします。ビジネスロジックは含みません。

Core は **target injection** により Shell 上で直接イベントを発火するため、イベントの再ディスパッチは不要です。

### ヘッドレス利用（Core 単体）

`FetchCore` は DOM なしで単体利用できます。`static wcBindable` を宣言しているため、`@wc-bindable/core` の `bind()` で状態をサブスクライブできます — フレームワークアダプタと同じ仕組みです:

```typescript
import { FetchCore } from "@wcstack/fetch";
import { bind } from "@wc-bindable/core";

const core = new FetchCore();

const unbind = bind(core, (name, value) => {
  console.log(`${name}:`, value);
  // "loading: true"
  // "value: [{ id: 1, name: "田中" }, ...]"
  // "status: 200"
  // "loading: false"
});

await core.fetch("/api/users");

// 不要になったらクリーンアップ
unbind();
```

Node.js、Deno、Cloudflare Workers など、`EventTarget` と `fetch` が利用可能な環境で動作します。

## 使い方

### JSON モード — API データ取得

```html
<wcs-fetch id="user-api" url="/api/users" method="GET"></wcs-fetch>
```

レスポンスデータは wc-bindable-protocol 経由で公開されます。`@wcstack/state` と組み合わせた例:

```html
<wcs-fetch url="/api/users" data-wcs="value: users"></wcs-fetch>
<wcs-state>
  <ul>
    <template data-wcs="for: users">
      <li data-wcs="textContent: users.*.name"></li>
    </template>
  </ul>
</wcs-state>
```

### HTML リプレースモード — htmx 的な動作

```html
<div id="content">初期コンテンツ</div>
<wcs-fetch url="/api/partial" target="content"></wcs-fetch>

<button data-fetchtarget="my-fetch">読み込む</button>
<wcs-fetch id="my-fetch" url="/api/fragment" target="content"></wcs-fetch>
```

`target` を指定すると、レスポンスの HTML で対象要素の innerHTML を差し替えます。

### POST — ヘッダとボディの指定

```html
<wcs-fetch url="/api/users" method="POST">
  <wcs-fetch-header name="Authorization" value="Bearer token123"></wcs-fetch-header>
  <wcs-fetch-header name="Accept" value="application/json"></wcs-fetch-header>
  <wcs-fetch-body type="application/json">
    {"name": "田中", "email": "tanaka@example.com"}
  </wcs-fetch-body>
</wcs-fetch>
```

### プログラムからの利用

```javascript
const fetchEl = document.querySelector("wcs-fetch");

// JS API 経由で body を設定（<wcs-fetch-body> より優先）
fetchEl.body = { name: "田中" };
await fetchEl.fetch();

console.log(fetchEl.value);   // レスポンスデータ
console.log(fetchEl.status);  // HTTP ステータスコード
console.log(fetchEl.loading); // boolean
console.log(fetchEl.error);   // エラー情報 or null
```

## 要素一覧

### `<wcs-fetch>`

| 属性 | 型 | デフォルト | 説明 |
|------|------|------------|------|
| `url` | string | — | リクエスト URL（必須） |
| `method` | string | `GET` | HTTP メソッド（`GET`, `POST` 等） |
| `target` | string | — | HTML リプレース対象の DOM 要素 id |

| プロパティ | 型 | 説明 |
|------------|------|------|
| `value` | any | レスポンスデータ（JSON オブジェクトまたは HTML 文字列） |
| `loading` | boolean | リクエスト実行中は `true` |
| `error` | object \| null | エラー情報（`{ status, statusText, body }`） |
| `status` | number | HTTP ステータスコード |
| `body` | any | リクエストボディ（JS 経由で設定、`fetch()` 後にリセット） |
| `trigger` | boolean | `true` を設定すると fetch を実行。完了後に自動で `false` に戻る |
| `manual` | boolean | `true` の場合、接続時や `url` 変更時の自動実行を無効化 |

| メソッド | 説明 |
|----------|------|
| `fetch()` | HTTP リクエストを実行。`Promise` を返す |
| `abort()` | 実行中のリクエストをキャンセル |

### `<wcs-fetch-header>`

リクエストヘッダを定義。`<wcs-fetch>` の子要素として配置。複数指定可。

| 属性 | 型 | 説明 |
|------|------|------|
| `name` | string | ヘッダ名（例: `Authorization`） |
| `value` | string | ヘッダ値（例: `Bearer xxx`） |

### `<wcs-fetch-body>`

リクエストボディを定義。`<wcs-fetch>` の子要素として配置。

| 属性 | 型 | デフォルト | 説明 |
|------|------|------------|------|
| `type` | string | `application/json` | Content-Type |

要素のテキストコンテンツがボディとして送信されます。

## wc-bindable-protocol

`FetchCore` と `<wcs-fetch>` はどちらも wc-bindable-protocol に準拠しており、プロトコル対応の任意のフレームワークやコンポーネントと相互運用できます。

### Core (FetchCore)

`FetchCore` は 4 つのバインド可能なプロパティを宣言します — 任意のランタイムからサブスクライブできる非同期状態です:

```typescript
// FetchCore.wcBindable
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

Shell は Core の宣言を拡張し、`trigger` を追加します — `@wcstack/state` などのバインディングシステムから宣言的に fetch を実行するためのプロパティです:

```typescript
// Fetch.wcBindable
static wcBindable = {
  ...FetchCore.wcBindable,
  properties: [
    ...FetchCore.wcBindable.properties,
    { name: "trigger", event: "wcs-fetch:trigger-changed" },
  ],
};
```

### TypeScript 値型

パッケージは Core と Shell に対応する 2 つの値型インターフェースをエクスポートします:

```typescript
import type { WcsFetchCoreValues, WcsFetchValues } from "@wcstack/fetch";

// WcsFetchCoreValues — ヘッドレス（FetchCore）用
// {
//   value: unknown;
//   loading: boolean;
//   error: { status: number; statusText: string; body: string } | null;
//   status: number;
// }

// WcsFetchValues — Shell（<wcs-fetch>）用、Core を拡張
// {
//   ...WcsFetchCoreValues;
//   trigger: boolean;
// }
```

## URL の監視

`<wcs-fetch>` はデフォルトで以下のタイミングに自動的にリクエストを実行します:

1. **DOM に接続されたとき** — `url` が設定済みかつ `manual` 属性がない場合
2. **`url` 属性が変更されたとき** — 新しい URL で再フェッチ（`manual` がない場合）

`@wcstack/state` と組み合わせると、状態の変更に連動したリアクティブなデータ取得が可能です:

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
  <!-- URL が変わると自動的に再フェッチ -->
  <wcs-fetch data-wcs="url: usersUrl; value: users"></wcs-fetch>
</wcs-state>
```

`manual` 属性を設定すると自動実行が無効になり、`fetch()` メソッドや `trigger` プロパティで明示的に制御できます。

## trigger プロパティ

`trigger` プロパティを使うと、DOM 参照なしに状態から宣言的に fetch を実行できます。

`true` を設定すると `fetch()` が実行され、完了後（成功・エラー問わず）自動的に `false` にリセットされます。

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
  <wcs-fetch url="/api/users" manual
    data-wcs="trigger: shouldRefresh; value: users">
  </wcs-fetch>
  <button data-wcs="onclick: reload">更新</button>
</wcs-state>
```

リセット時に `wcs-fetch:trigger-changed` イベントが発火し、`@wcstack/state` がバインドされたプロパティを `false` に同期します。

## オートトリガー

`autoTrigger` が有効（デフォルト）の場合、`data-fetchtarget` 属性を持つ要素のクリックで対応する `<wcs-fetch>` が自動実行されます:

```html
<button data-fetchtarget="user-fetch">ユーザー読み込み</button>
<wcs-fetch id="user-fetch" url="/api/users"></wcs-fetch>
```

イベント委譲を使用しているため、動的に追加された要素でも動作します。`closest()` API により、ネストされた子要素（ボタン内のアイコン等）のクリックも検出します。

## 設定

```javascript
import { bootstrapFetch } from "@wcstack/fetch";

bootstrapFetch({
  autoTrigger: true,               // デフォルト: true
  triggerAttribute: "data-fetchtarget", // デフォルト: "data-fetchtarget"
  tagNames: {
    fetch: "wcs-fetch",            // デフォルト: "wcs-fetch"
    fetchHeader: "wcs-fetch-header",
    fetchBody: "wcs-fetch-body",
  },
});
```

## フレームワーク連携

`<wcs-fetch>` は wc-bindable-protocol 準拠の HAWC なので、`@wc-bindable/*` の薄いアダプタを通じて任意のフレームワークで動作します。useEffect 不要、非同期状態管理不要、クリーンアップ不要、レースコンディション対策不要 — アダプタが `wcBindable` 宣言を自動的に読み取ります。

### React

```tsx
import { useWcBindable } from "@wc-bindable/react";
import type { WcsFetchValues } from "@wcstack/fetch";

function UserList() {
  const [ref, { value: users, loading, error }] =
    useWcBindable<HTMLElement, WcsFetchValues>();

  return (
    <>
      <wcs-fetch ref={ref} url="/api/users" />
      {loading && <p>読み込み中...</p>}
      {error && <p>エラー: {error.statusText}</p>}
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

const { ref, values } = useWcBindable<HTMLElement, WcsFetchValues>();
</script>

<template>
  <wcs-fetch :ref="ref" url="/api/users" />
  <p v-if="values.loading">読み込み中...</p>
  <p v-else-if="values.error">エラー: {{ values.error.statusText }}</p>
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

function UserList() {
  const [values, directive] = createWcBindable<WcsFetchValues>();

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

## ライセンス

MIT
