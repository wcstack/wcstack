# @wcstack/fetch

Web Components による宣言的な非同期通信コンポーネント。[wc-bindable-protocol](https://github.com/nicolo-ribaudo/tc39-proposal-wc-bindable-protocol) 準拠でフレームワーク非依存。

ランタイム依存ゼロ。React、Vue、Svelte、vanilla JavaScript のどこからでも使えます。

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
<script type="module" src="@wcstack/fetch/auto"></script>
```

## 使い方

### JSON モード — API データ取得

```html
<wcs-fetch id="user-api" url="/api/users" method="GET"></wcs-fetch>
```

レスポンスデータは wc-bindable-protocol 経由で公開されます。`@wcstack/state` と組み合わせた例:

```html
<wcs-state name="app">
  <wcs-fetch url="/api/users" data-wcs="value: users"></wcs-fetch>
  <ul>
    <!--wcs-for items -->
    <template>
      <li data-wcs="textContent: items.*.name"></li>
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

`<wcs-fetch>` は wc-bindable-protocol に準拠しており、プロトコル対応の任意のフレームワークやコンポーネントと相互運用できます。

```typescript
static wcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "value",   event: "wcs-fetch:response" },
    { name: "loading", event: "wcs-fetch:loading-changed" },
    { name: "error",   event: "wcs-fetch:error" },
    { name: "status",  event: "wcs-fetch:response",
      getter: (e) => e.detail.status },
  ],
};
```

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

## React との連携

`@wc-bindable/react` アダプタを使用:

```tsx
import { useWcBindable } from "@wc-bindable/react";

function UserList() {
  const [ref, { value: users, loading, error }] = useWcBindable<HTMLElement>({
    value: null,
    loading: false,
    error: null,
  });

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

useEffect 不要、非同期状態の useState 不要、クリーンアップ不要、レースコンディション対策不要。アダプタが `wc-bindable` 宣言を自動的に読み取り、バインドします。

## ライセンス

MIT
