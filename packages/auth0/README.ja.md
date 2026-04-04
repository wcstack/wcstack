# @wcstack/auth0

`@wcstack/auth0` は wcstack エコシステムのためのヘッドレス認証コンポーネントです。

> **注意:** このパッケージは **`@wcstack` の正式パッケージではありません**。
> `@wcstack` の正式パッケージはランタイム依存ゼロを原則としています。
> `@wcstack/auth0` は `@auth0/auth0-spa-js` をピア依存として必要とするため、
> 同じ HAWC アーキテクチャに従う **コミュニティスタイルの拡張** として提供されます。

視覚的な UI ウィジェットではありません。
Auth0 認証とリアクティブな状態をつなぐ **I/O ノード** です。

`@wcstack/state` と組み合わせると、`<wcs-auth>` はパス契約を通じて直接バインドできます:

- **入力 / コマンドサーフェス**: `domain`, `client-id`, `trigger`
- **出力ステートサーフェス**: `authenticated`, `user`, `token`, `loading`, `error`

つまり、認証状態を HTML 内で宣言的に表現できます。UI レイヤーに OAuth フロー、トークン管理、ログイン/ログアウトのグルーコードを書く必要はありません。

`@wcstack/auth0` は [HAWC](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/main/docs/articles/HAWC.md) アーキテクチャに従います:

- **Core** (`AuthCore`) が Auth0 SDK 連携、トークン管理、認証状態を処理
- **Shell** (`<wcs-auth>`) がその状態を DOM に接続
- フレームワークやバインディングシステムは [wc-bindable-protocol](https://github.com/wc-bindable-protocol/wc-bindable-protocol) 経由で利用

## なぜこれが存在するのか

認証は SPA で最も一般的な横断的関心事のひとつです。
ログインフロー、トークンリフレッシュ、ユーザープロフィール取得、ルート保護には大量の命令的コードが必要です。

`@wcstack/auth0` は認証ロジックを再利用可能なコンポーネントに移し、結果をバインド可能な状態として公開します。

`@wcstack/state` と組み合わせたフローは:

1. `<wcs-auth>` が接続時に Auth0 クライアントを初期化
2. リダイレクトコールバックを自動処理
3. 認証結果が `authenticated`, `user`, `token`, `loading`, `error` として返る
4. UI は `data-wcs` でそれらのパスにバインド

認証が命令的な UI コードではなく、**状態遷移**になります。

## インストール

```bash
npm install @wcstack/auth0
```

### ピア依存

`@wcstack/auth0` は Auth0 SPA SDK を必要とします:

```bash
npm install @auth0/auth0-spa-js
```

## クイックスタート

### 1. 状態バインディングによる基本認証

`<wcs-auth>` が DOM に接続されると、Auth0 クライアントを初期化し、保留中のリダイレクトコールバックを処理し、認証状態を同期します。

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/auth0/auto"></script>

<wcs-state>
  <script type="module">
    export default {
      isLoggedIn: false,
      currentUser: null,
      accessToken: null,
      authLoading: true,
    };
  </script>

  <wcs-auth
    id="auth"
    domain="example.auth0.com"
    client-id="your-client-id"
    redirect-uri="/callback"
    audience="https://api.example.com"
    data-wcs="
      authenticated: isLoggedIn;
      user: currentUser;
      token: accessToken;
      loading: authLoading
    ">
  </wcs-auth>

  <template data-wcs="if: authLoading">
    <p>認証中...</p>
  </template>

  <template data-wcs="if: isLoggedIn">
    <p data-wcs="textContent: currentUser.name"></p>
    <wcs-auth-logout target="auth">サインアウト</wcs-auth-logout>
  </template>

  <template data-wcs="if: !isLoggedIn">
    <button data-authtarget="auth">サインイン</button>
  </template>
</wcs-state>
```

### 2. 状態からのログイントリガー

`trigger` を使用して、状態メソッドからログインを開始できます:

```html
<wcs-state>
  <script type="module">
    export default {
      isLoggedIn: false,
      currentUser: null,
      shouldLogin: false,

      login() {
        this.shouldLogin = true;
      },
    };
  </script>

  <wcs-auth
    domain="example.auth0.com"
    client-id="your-client-id"
    data-wcs="
      authenticated: isLoggedIn;
      user: currentUser;
      trigger: shouldLogin
    ">
  </wcs-auth>

  <template data-wcs="if: !isLoggedIn">
    <button data-wcs="onclick: login">サインイン</button>
  </template>
</wcs-state>
```

`trigger` は **一方向コマンドサーフェス** です:

- `true` を書き込むと `login()` が開始
- 完了後に自動的に `false` にリセット
- リセット時に `wcs-auth:trigger-changed` を発行

```
外部書き込み:  false → true   イベントなし（ログイン開始）
自動リセット:  true  → false  wcs-auth:trigger-changed を発行
```

### 3. ポップアップログインモード

`popup` 属性を使用して、リダイレクトの代わりにポップアップウィンドウを開きます:

```html
<wcs-auth
  domain="example.auth0.com"
  client-id="your-client-id"
  popup
  data-wcs="authenticated: isLoggedIn; user: currentUser">
</wcs-auth>
```

### 4. `@wcstack/fetch` との認証済み API リクエスト

`<wcs-auth>` と `<wcs-fetch>` を組み合わせて認証済みデータ取得を行います:

```html
<wcs-state>
  <script type="module">
    export default {
      isLoggedIn: false,
      accessToken: null,
      users: [],

      get usersUrl() {
        return this.isLoggedIn ? "/api/users" : "";
      },
    };
  </script>

  <wcs-auth
    domain="example.auth0.com"
    client-id="your-client-id"
    audience="https://api.example.com"
    data-wcs="authenticated: isLoggedIn; token: accessToken">
  </wcs-auth>

  <wcs-fetch
    data-wcs="url: usersUrl; value: users">
    <wcs-fetch-header
      name="Authorization"
      data-wcs="value: accessToken|prepend('Bearer ')">
    </wcs-fetch-header>
  </wcs-fetch>

  <ul>
    <template data-wcs="for: users">
      <li data-wcs="textContent: users.*.name"></li>
    </template>
  </ul>
</wcs-state>
```

## ステートサーフェス vs コマンドサーフェス

`<wcs-auth>` は 2 種類のプロパティを公開します。

### 出力状態（バインド可能な認証状態）

現在の認証状態を表すプロパティで、HAWC のメインサーフェスです:

| プロパティ | 型 | 説明 |
|----------|------|-------------|
| `authenticated` | `boolean` | ユーザーがログイン中なら `true` |
| `user` | `WcsAuthUser \| null` | Auth0 からのユーザープロフィール |
| `token` | `string \| null` | アクセストークン |
| `loading` | `boolean` | 初期化中またはログイン中なら `true` |
| `error` | `WcsAuthError \| Error \| null` | 認証エラー |

### 入力 / コマンドサーフェス

HTML、JS、または `@wcstack/state` バインディングから認証を制御するプロパティ:

| プロパティ | 型 | 説明 |
|----------|------|-------------|
| `domain` | `string` | Auth0 テナントドメイン |
| `client-id` | `string` | Auth0 アプリケーションクライアント ID |
| `redirect-uri` | `string` | ログイン後のリダイレクト URI |
| `audience` | `string` | API オーディエンス識別子 |
| `scope` | `string` | OAuth スコープ（デフォルト: `openid profile email`） |
| `trigger` | `boolean` | 一方向ログイントリガー |
| `popup` | `boolean` | リダイレクトの代わりにポップアップを使用 |

## アーキテクチャ

`@wcstack/auth0` は HAWC アーキテクチャに従います。

### Core: `AuthCore`

`AuthCore` は純粋な `EventTarget` クラスです。
以下を含みます:

- Auth0 SPA SDK クライアント初期化
- リダイレクトコールバック処理
- ログイン / ログアウト / トークン管理
- 認証状態遷移
- `wc-bindable-protocol` 宣言

`EventTarget` をサポートする任意のランタイムでヘッドレスに実行できます。

### Shell: `<wcs-auth>`

`<wcs-auth>` は `AuthCore` の薄い `HTMLElement` ラッパーです。
以下を追加します:

- 属性 / プロパティマッピング
- DOM ライフサイクル統合
- 接続時の自動初期化
- `trigger` や `popup` などの宣言的実行ヘルパー

この分離により、認証ロジックをポータブルに保ちつつ、`@wcstack/state` などの DOM ベースのバインディングシステムとの自然な連携を可能にします。

### ターゲットインジェクション

Core は **ターゲットインジェクション** により Shell 上で直接イベントをディスパッチするため、イベントの再ディスパッチは不要です。

## ヘッドレス利用（Core のみ）

`AuthCore` は Shell 要素なしで使用できます。`static wcBindable` を宣言しているため、`@wc-bindable/core` の `bind()` で状態をサブスクライブできます:

```typescript
import { AuthCore } from "@wcstack/auth0";
import { bind } from "@wc-bindable/core";

const core = new AuthCore();

const unbind = bind(core, (name, value) => {
  console.log(`${name}:`, value);
});

await core.initialize({
  domain: "example.auth0.com",
  clientId: "your-client-id",
});

if (!core.authenticated) {
  await core.login();
}

unbind();
```

> **注意:** `AuthCore` はリダイレクトコールバック処理のためにブラウザグローバル（`location`, `history`）を必要とし、`@auth0/auth0-spa-js` 自体もブラウザ環境を前提としています。ここでの「ヘッドレス」は **Shell 要素なし** を意味し、ブラウザなしではありません。

## リダイレクトコールバック

ユーザーが Auth0 のログインページから戻ると、URL に `code` と `state` クエリパラメータが含まれます。`<wcs-auth>` は初期化時にこのコールバックを自動的に検出して処理します:

1. Auth0 クライアントの `handleRedirectCallback()` を呼び出し
2. `history.replaceState()` で URL から `code` と `state` を除去
3. 認証状態を同期（`authenticated`, `user`, `token`）

追加の設定やルート処理は不要です。

## プログラム的な使用

```javascript
const authEl = document.querySelector("wcs-auth");

// 初期化完了を待つ
await authEl.connectedCallbackPromise;

// 状態の読み取り
console.log(authEl.authenticated); // boolean
console.log(authEl.user);          // ユーザープロフィールまたは null
console.log(authEl.token);         // アクセストークンまたは null
console.log(authEl.loading);       // boolean
console.log(authEl.error);         // エラーまたは null

// Auth0 クライアントへの直接アクセス
console.log(authEl.client);        // Auth0Client インスタンス

// メソッド
await authEl.login();
await authEl.logout();
const token = await authEl.getToken();
```

## オプションの DOM トリガー

`autoTrigger` が有効（デフォルト）の場合、`data-authtarget` を持つ要素をクリックすると、対応する `<wcs-auth>` 要素のログインがトリガーされます:

```html
<button data-authtarget="auth">サインイン</button>
<wcs-auth id="auth" domain="example.auth0.com" client-id="your-client-id"></wcs-auth>
```

イベント委譲を使用しているため、動的に追加された要素でも動作します。`closest()` API がネストされた要素（ボタン内のアイコンなど）を処理します。

対象 ID に一致する要素がない場合、または一致した要素が `<wcs-auth>` でない場合、クリックは無視されます。

これは便利機能です。
wcstack アプリケーションでは、**`trigger` による状態駆動のトリガー** が通常の主要パターンです。

## 要素

### `<wcs-auth>`

| 属性 | 型 | デフォルト | 説明 |
|-----------|------|---------|-------------|
| `domain` | `string` | — | Auth0 テナントドメイン |
| `client-id` | `string` | — | Auth0 アプリケーションクライアント ID |
| `redirect-uri` | `string` | — | ログイン後のリダイレクト URI |
| `audience` | `string` | — | API オーディエンス識別子 |
| `scope` | `string` | `openid profile email` | OAuth スコープ |
| `cache-location` | `"memory" \| "localstorage"` | `memory` | トークンキャッシュ場所 |
| `use-refresh-tokens` | `boolean` | `false` | サイレント更新にリフレッシュトークンを使用 |
| `popup` | `boolean` | `false` | ログインにリダイレクトの代わりにポップアップを使用 |

| プロパティ | 型 | 説明 |
|----------|------|-------------|
| `authenticated` | `boolean` | ログイン中なら `true` |
| `user` | `WcsAuthUser \| null` | ユーザープロフィール |
| `token` | `string \| null` | アクセストークン |
| `loading` | `boolean` | 初期化中またはログイン中なら `true` |
| `error` | `WcsAuthError \| Error \| null` | エラー情報 |
| `trigger` | `boolean` | `true` に設定してログインを実行 |
| `client` | `Auth0Client` | Auth0 クライアントインスタンス |

| メソッド | 説明 |
|--------|-------------|
| `initialize()` | Auth0 クライアントを初期化（接続時に自動呼び出し） |
| `login(options?)` | ログイン開始（`popup` 属性に応じてリダイレクトまたはポップアップ） |
| `logout(options?)` | Auth0 からログアウト |
| `getToken(options?)` | アクセストークンをサイレントに取得 |

### `<wcs-auth-logout>`

宣言的ログアウト要素。クリックすると関連する `<wcs-auth>` のログアウトをトリガーします。

| 属性 | 型 | デフォルト | 説明 |
|-----------|------|---------|-------------|
| `target` | `string` | — | `<wcs-auth>` 要素の ID |
| `return-to` | `string` | — | ログアウト後のリダイレクト先 URL |

ターゲット解決:
- `target` が設定されている場合: ID のみで解決。ID が `<wcs-auth>` に一致しない場合、クリックは無視される（フォールバックなし）。
- `target` が未設定の場合: 最寄りの祖先 `<wcs-auth>`、次にドキュメント内の最初の `<wcs-auth>`。

## wc-bindable-protocol

`AuthCore` と `<wcs-auth>` は `wc-bindable-protocol` 準拠を宣言しており、プロトコルをサポートする任意のフレームワークやコンポーネントと相互運用可能です。

### Core (`AuthCore`)

`AuthCore` は任意のランタイムがサブスクライブできるバインド可能な認証状態を宣言します:

```typescript
static wcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "authenticated", event: "wcs-auth:authenticated-changed" },
    { name: "user",          event: "wcs-auth:user-changed" },
    { name: "token",         event: "wcs-auth:token-changed" },
    { name: "loading",       event: "wcs-auth:loading-changed" },
    { name: "error",         event: "wcs-auth:error" },
  ],
};
```

ヘッドレスの利用者は `core.login()` / `core.logout()` を直接呼び出します — `trigger` は不要です。

### Shell (`<wcs-auth>`)

Shell は Core 宣言に `trigger` を追加し、バインディングシステムが宣言的にログインを実行できるようにします:

```typescript
static wcBindable = {
  ...AuthCore.wcBindable,
  properties: [
    ...AuthCore.wcBindable.properties,
    { name: "trigger", event: "wcs-auth:trigger-changed" },
  ],
};
```

## TypeScript 型

```typescript
import type {
  WcsAuthUser, WcsAuthError, WcsAuthCoreValues, WcsAuthValues, Auth0ClientOptions
} from "@wcstack/auth0";
```

```typescript
// ユーザープロフィール
interface WcsAuthUser {
  sub: string;
  name?: string;
  email?: string;
  picture?: string;
  [key: string]: any;
}

// 認証エラー
interface WcsAuthError {
  error: string;
  error_description?: string;
  [key: string]: any;
}

// Core（ヘッドレス）— 5 つの認証状態プロパティ
interface WcsAuthCoreValues {
  authenticated: boolean;
  user: WcsAuthUser | null;
  token: string | null;
  loading: boolean;
  error: WcsAuthError | Error | null;
}

// Shell（<wcs-auth>）— Core に trigger を追加
interface WcsAuthValues extends WcsAuthCoreValues {
  trigger: boolean;
}
```

## `@wcstack/state` との相性が良い理由

`@wcstack/state` は UI と状態の間の唯一の契約としてパス文字列を使用します。
`<wcs-auth>` はこのモデルに自然に適合します:

- `<wcs-auth>` が Auth0 ライフサイクルを初期化・管理
- 認証結果が `authenticated`, `user`, `token`, `loading`, `error` として返る
- UI は認証グルーコードを書かずにそれらのパスにバインド

認証が通常の状態更新のように見えます。

## フレームワーク連携

`<wcs-auth>` は HAWC + `wc-bindable-protocol` であるため、`@wc-bindable/*` の薄いアダプタを通じて任意のフレームワークで動作します。

### React

```tsx
import { useWcBindable } from "@wc-bindable/react";
import type { WcsAuthValues } from "@wcstack/auth0";

function AuthGuard() {
  const [ref, { authenticated, user, loading }] =
    useWcBindable<HTMLElement, WcsAuthValues>();

  return (
    <>
      <wcs-auth ref={ref}
        domain="example.auth0.com"
        client-id="your-client-id" />
      {loading && <p>読み込み中...</p>}
      {authenticated ? (
        <p>ようこそ、{user?.name}</p>
      ) : (
        <button onClick={() => ref.current?.login()}>サインイン</button>
      )}
    </>
  );
}
```

### Vue

```vue
<script setup lang="ts">
import { useWcBindable } from "@wc-bindable/vue";
import type { WcsAuthValues } from "@wcstack/auth0";

const { ref, values } = useWcBindable<HTMLElement, WcsAuthValues>();
</script>

<template>
  <wcs-auth :ref="ref"
    domain="example.auth0.com"
    client-id="your-client-id" />
  <p v-if="values.loading">読み込み中...</p>
  <p v-else-if="values.authenticated">ようこそ、{{ values.user?.name }}</p>
  <button v-else @click="ref.value?.login()">サインイン</button>
</template>
```

### Svelte

```svelte
<script>
import { wcBindable } from "@wc-bindable/svelte";

let authenticated = $state(false);
let user = $state(null);
let loading = $state(true);
</script>

<wcs-auth domain="example.auth0.com" client-id="your-client-id"
  use:wcBindable={{ onUpdate: (name, v) => {
    if (name === "authenticated") authenticated = v;
    if (name === "user") user = v;
    if (name === "loading") loading = v;
  }}} />

{#if loading}
  <p>読み込み中...</p>
{:else if authenticated}
  <p>ようこそ、{user?.name}</p>
{:else}
  <p>サインインしてください</p>
{/if}
```

### Solid

```tsx
import { createWcBindable } from "@wc-bindable/solid";
import type { WcsAuthValues } from "@wcstack/auth0";

function AuthGuard() {
  const [values, directive] = createWcBindable<WcsAuthValues>();

  return (
    <>
      <wcs-auth ref={directive}
        domain="example.auth0.com"
        client-id="your-client-id" />
      <Show when={!values.loading} fallback={<p>読み込み中...</p>}>
        <Show when={values.authenticated}
          fallback={<button>サインイン</button>}>
          <p>ようこそ、{values.user?.name}</p>
        </Show>
      </Show>
    </>
  );
}
```

### Vanilla — `bind()` を直接使用

```javascript
import { bind } from "@wc-bindable/core";

const authEl = document.querySelector("wcs-auth");

bind(authEl, (name, value) => {
  console.log(`${name} changed:`, value);
});
```

## 設定

```javascript
import { bootstrapAuth } from "@wcstack/auth0";

bootstrapAuth({
  autoTrigger: true,
  triggerAttribute: "data-authtarget",
  tagNames: {
    auth: "wcs-auth",
    authLogout: "wcs-auth-logout",
  },
});
```

## 設計ノート

- `authenticated`, `user`, `token`, `loading`, `error` は **出力状態**
- `domain`, `client-id`, `trigger` は **入力 / コマンドサーフェス**
- `trigger` は意図的に一方向: `true` を書き込むとログイン実行、リセットで完了を通知
- 初期化は `connectedCallback` で 1 回のみ — 接続後に `domain` や `client-id` を変更しても再初期化しない
- リダイレクトコールバックは初期化時に自動検出・処理
- `<wcs-auth-logout>` は明示的 `target` ありなら ID のみで解決（フォールバックなし）、`target` なしなら最寄りの祖先、ドキュメント内最初の順
- `popup` モードは `loginWithPopup` を使用 — リダイレクト不要、ポップアップ閉鎖後に状態同期
- Shell のメソッド（`login()`, `logout()`, `getToken()`）は実行前に初期化完了を待つ — 接続直後に呼んでも安全
- `@auth0/auth0-spa-js` はピア依存 — 利用者側でバージョンを管理
- `AuthCore` はブラウザグローバルを必要とする — 「ヘッドレス」は Shell なしの意味で、ブラウザなしではない

## ライセンス

MIT
