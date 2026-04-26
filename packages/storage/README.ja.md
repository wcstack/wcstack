# @wcstack/storage

`@wcstack/storage` は wcstack エコシステムのためのヘッドレス ストレージ コンポーネントです。

視覚的な UI ウィジェットではありません。
ブラウザのストレージ（localStorage / sessionStorage）とリアクティブな状態をつなぐ **I/O ノード** です。

`@wcstack/state` と組み合わせると、`<wcs-storage>` はパス契約を通じて直接バインドできます:

- **入力 / コマンドサーフェス**: `key`, `type`, `trigger`
- **出力ステートサーフェス**: `value`, `loading`, `error`

つまり、ブラウザストレージの永続化を HTML 内で宣言的に表現できます。UI レイヤーに `localStorage.getItem()`、`JSON.parse()`、シリアライズのグルーコードを書く必要はありません。

`@wcstack/storage` は [HAWC](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/main/docs/articles/HAWC.md) アーキテクチャに従います:

- **Core** (`StorageCore`) がストレージの読み書き、クロスタブ同期を処理
- **Shell** (`<wcs-storage>`) がその状態を DOM に接続
- フレームワークやバインディングシステムは [wc-bindable-protocol](https://github.com/wc-bindable-protocol/wc-bindable-protocol) 経由で利用

## なぜこれが存在するのか

フロントエンドアプリケーションでは、ユーザー設定やセッションデータの永続化に localStorage / sessionStorage を頻繁に使います。
しかし、読み込み、JSON パース、保存、エラー処理のグルーコードは毎回同じようなパターンです。

`@wcstack/storage` はそのグルーコードを再利用可能なコンポーネントに移し、ストレージの値をバインド可能な状態として公開します。

`@wcstack/state` と組み合わせたフローは:

1. `<wcs-storage>` が接続時にストレージから自動読み込み
2. `value` が `data-wcs` で UI にバインド
3. 状態が変わると自動的にストレージに書き戻し
4. 他のタブでの変更も自動検知

永続化が命令的なグルーコードではなく、**状態遷移**になります。

## インストール

```bash
npm install @wcstack/storage
```

## クイックスタート

### 1. プリミティブ値の自動保存

プリミティブ値（文字列、数値、boolean）は `value` バインディングだけで双方向永続化できます。

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/storage/auto"></script>

<wcs-state>
  <script type="module">
    export default { username: "" };
  </script>
</wcs-state>

<wcs-storage key="username" data-wcs="value: username"></wcs-storage>

<input data-wcs="value: username" placeholder="ユーザー名">
<p>保存済み: <span data-wcs="textContent: username"></span></p>
```

これがデフォルトモードです:

- `key` を設定すると接続時に自動読み込み
- `value` にバインドすると双方向永続化
- 任意で `loading`、`error` もバインド

### 2. オブジェクトの永続化と `$trackDependency`

オブジェクトのサブプロパティ（`settings.theme` 等）を変更しても、親パス `settings` へのバインディングは発火しません。
`@wcstack/state` の依存走査は**親→子方向**のみだからです。

この場合は `$trackDependency` で監視したいサブプロパティを明示し、`trigger` 経由で保存します:

```html
<wcs-state>
  <script type="module">
    export default defineState({
      settings: { theme: "light", lang: "ja" },

      get settingsChanged() {
        this.$trackDependency("settings.theme");
        this.$trackDependency("settings.lang");
        return true;
      },
    });
  </script>
</wcs-state>

<wcs-storage key="app-settings" manual
  data-wcs="value: settings; trigger: settingsChanged">
</wcs-storage>

<select data-wcs="value: settings.theme">
  <option value="light">ライト</option>
  <option value="dark">ダーク</option>
</select>

<select data-wcs="value: settings.lang">
  <option value="ja">日本語</option>
  <option value="en">English</option>
</select>
```

**フロー:**

1. ユーザーがテーマを変更 → `settings.theme` が更新
2. 動的依存により `settingsChanged` が再評価 → `true` を返す
3. `trigger: settingsChanged` バインディングが発火 → `save()` 実行
4. `settings` オブジェクト全体が localStorage に保存

### 3. sessionStorage の使用

`type="session"` で sessionStorage を使用します:

```html
<wcs-state>
  <script type="module">
    export default { sessionData: null };
  </script>
</wcs-state>

<wcs-storage key="session-data" type="session"
  data-wcs="value: sessionData">
</wcs-storage>

<p data-wcs="textContent: sessionData"></p>
```

### 4. クロスタブ同期

localStorage の変更は、別のタブからの更新も自動的に検知されます:

```html
<wcs-state>
  <script type="module">
    export default { sharedCounter: 0 };
  </script>
</wcs-state>

<wcs-storage key="shared-counter"
  data-wcs="value: sharedCounter">
</wcs-storage>

<!-- 他のタブで localStorage を変更すると、この値も自動更新される -->
<p data-wcs="textContent: sharedCounter"></p>
```

> **注意**: `storage` イベントは同一オリジンの他のタブでの変更時にのみ発火します。sessionStorage はタブ間で共有されないため、クロスタブ同期は localStorage でのみ動作します。

## ステートサーフェス vs コマンドサーフェス

`<wcs-storage>` は 2 種類のプロパティを公開します。

### 出力ステート（バインド可能な状態）

現在のストレージの値を表し、HAWC のメインサーフェスです:

| プロパティ | 型 | 説明 |
|------------|------|------|
| `value` | `any` | ストレージに保存された値 |
| `loading` | `boolean` | 読み書き中は `true` |
| `error` | `WcsStorageError \| Error \| null` | ストレージ操作のエラー |

### 入力 / コマンドサーフェス

HTML、JS、または `@wcstack/state` バインディングからストレージ操作を制御します:

| プロパティ | 型 | 説明 |
|------------|------|------|
| `key` | `string` | ストレージキー |
| `type` | `"local" \| "session"` | ストレージタイプ |
| `value` | `any` | 設定すると自動保存（`manual` でない場合） |
| `trigger` | `boolean` | 単方向の保存トリガー |
| `manual` | `boolean` | 自動読み込み・自動保存を無効化 |

## アーキテクチャ

`@wcstack/storage` は HAWC アーキテクチャに従います。

### Core: `StorageCore`

`StorageCore` は純粋な `EventTarget` クラスです。
以下を内包します:

- ストレージの読み込み・保存・削除
- JSON の自動シリアライズ / デシリアライズ
- クロスタブ同期（`storage` イベント監視）
- `wc-bindable-protocol` 宣言

`EventTarget` と `localStorage` / `sessionStorage` をサポートする任意のランタイムでヘッドレスに動作します。

### Shell: `<wcs-storage>`

`<wcs-storage>` は `StorageCore` の薄い `HTMLElement` ラッパーです。
以下を追加します:

- 属性 / プロパティマッピング
- DOM ライフサイクル統合（接続時に自動読み込み、切断時にクリーンアップ）
- `value` セッター経由の自動保存
- `trigger` などの宣言的実行ヘルパー

この分離により、ストレージロジックのポータビリティを保ちながら、`@wcstack/state` のような DOM ベースのバインディングシステムとの自然な連携を可能にしています。

### Target injection

Core は **target injection** により Shell 上で直接イベントを発火するため、イベントの再ディスパッチは不要です。

## ヘッドレス利用（Core 単体）

`StorageCore` は DOM なしで単体利用できます。`static wcBindable` を宣言しているため、`@wc-bindable/core` の `bind()` で状態をサブスクライブできます — フレームワークアダプタと同じ仕組みです:

```typescript
import { StorageCore } from "@wcstack/storage";
import { bind } from "@wc-bindable/core";

const core = new StorageCore();

const unbind = bind(core, (name, value) => {
  console.log(`${name}:`, value);
});

core.key = "my-data";
core.load();

unbind();
```

### JSON 自動シリアライズ

`StorageCore` はデータ型に応じて自動的にシリアライズ / デシリアライズを行います:

| 保存時の型 | ストレージ上の形式 | 読み込み時の型 |
|-----------|-------------------|--------------|
| オブジェクト / 配列 | `JSON.stringify()` 結果 | `JSON.parse()` 結果 |
| 文字列 | そのまま | JSON パース成功時はパース結果、失敗時はそのまま文字列 |
| 数値 / boolean | `JSON.stringify()` 結果 | `JSON.parse()` 結果 |
| `null` / `undefined` | キーを削除 | `null` |

## 要素一覧

### `<wcs-storage>`

| 属性 | 型 | デフォルト | 説明 |
|------|------|------------|------|
| `key` | `string` | — | ストレージキー |
| `type` | `"local" \| "session"` | `local` | ストレージタイプ |
| `manual` | `boolean` | `false` | 自動読み込み・自動保存を無効化 |

| プロパティ | 型 | 説明 |
|------------|------|------|
| `value` | `any` | ストレージの値（設定すると自動保存） |
| `loading` | `boolean` | 読み書き中は `true` |
| `error` | `WcsStorageError \| Error \| null` | エラー情報 |
| `trigger` | `boolean` | `true` を設定すると save を実行 |
| `manual` | `boolean` | 自動モードの無効化 |

| メソッド | 説明 |
|----------|------|
| `load()` | ストレージから値を読み込み |
| `save()` | 現在の値をストレージに保存 |
| `remove()` | ストレージからキーを削除 |

## wc-bindable-protocol

`StorageCore` と `<wcs-storage>` はどちらも wc-bindable-protocol に準拠しており、プロトコル対応の任意のフレームワークやコンポーネントと相互運用できます。

### Core (`StorageCore`)

```typescript
static wcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "value",   event: "wcs-storage:value-changed",
      getter: (e) => e.detail },
    { name: "loading", event: "wcs-storage:loading-changed" },
    { name: "error",   event: "wcs-storage:error" },
  ],
};
```

### Shell (`<wcs-storage>`)

Shell は Core の宣言を拡張し、バインディングシステムから宣言的にストレージ操作を実行できるようにします:

```typescript
static wcBindable = {
  ...StorageCore.wcBindable,
  properties: [
    ...StorageCore.wcBindable.properties,
    { name: "trigger", event: "wcs-storage:trigger-changed" },
  ],
};
```

## TypeScript 型

```typescript
import type {
  WcsStorageError, WcsStorageCoreValues, WcsStorageValues, StorageType
} from "@wcstack/storage";
```

```typescript
type StorageType = "local" | "session";

// ストレージ操作エラー
interface WcsStorageError {
  operation: "load" | "save" | "remove";
  message: string;
}

// Core（ヘッドレス）— 3 つの状態プロパティ
interface WcsStorageCoreValues<T = unknown> {
  value: T;
  loading: boolean;
  error: WcsStorageError | Error | null;
}

// Shell（<wcs-storage>）— Core を拡張し trigger を追加
interface WcsStorageValues<T = unknown> extends WcsStorageCoreValues<T> {
  trigger: boolean;
}
```

## なぜ `@wcstack/state` とうまく連携するのか

`@wcstack/state` は UI と状態の唯一の契約としてパス文字列を使います。
`<wcs-storage>` はこのモデルに自然に適合します:

- `<wcs-storage>` が接続時にストレージから自動読み込み
- `value` が状態パスにバインドされ、UI に反映
- ユーザーが UI を操作すると状態が変わり、自動的にストレージに書き戻し
- リロードしても状態が復元される

永続化が通常の状態更新と同じように見えるようになります。

## フレームワーク連携

`<wcs-storage>` は HAWC + `wc-bindable-protocol` なので、`@wc-bindable/*` の薄いアダプタを通じて任意のフレームワークで動作します。

### React

```tsx
import { useWcBindable } from "@wc-bindable/react";
import type { WcsStorageValues } from "@wcstack/storage";

interface Settings { theme: string; lang: string; }

function SettingsPanel() {
  const [ref, { value: settings, loading, error }] =
    useWcBindable<HTMLElement, WcsStorageValues<Settings>>();

  return (
    <>
      <wcs-storage ref={ref} key="app-settings" />
      {loading && <p>読み込み中...</p>}
      {settings && <p>テーマ: {settings.theme}</p>}
    </>
  );
}
```

### Vue

```vue
<script setup lang="ts">
import { useWcBindable } from "@wc-bindable/vue";
import type { WcsStorageValues } from "@wcstack/storage";

interface Settings { theme: string; lang: string; }

const { ref, values } = useWcBindable<HTMLElement, WcsStorageValues<Settings>>();
</script>

<template>
  <wcs-storage :ref="ref" key="app-settings" />
  <p v-if="values.loading">読み込み中...</p>
  <p v-else-if="values.value">テーマ: {{ values.value.theme }}</p>
</template>
```

### Svelte

```svelte
<script>
import { wcBindable } from "@wc-bindable/svelte";

let settings = $state(null);
let loading = $state(false);
</script>

<wcs-storage key="app-settings"
  use:wcBindable={{ onUpdate: (name, v) => {
    if (name === "value") settings = v;
    if (name === "loading") loading = v;
  }}} />

{#if loading}
  <p>読み込み中...</p>
{:else if settings}
  <p>テーマ: {settings.theme}</p>
{/if}
```

### Solid

```tsx
import { createWcBindable } from "@wc-bindable/solid";
import type { WcsStorageValues } from "@wcstack/storage";

interface Settings { theme: string; lang: string; }

function SettingsPanel() {
  const [values, directive] = createWcBindable<WcsStorageValues<Settings>>();

  return (
    <>
      <wcs-storage ref={directive} key="app-settings" />
      <Show when={!values.loading} fallback={<p>読み込み中...</p>}>
        <p>テーマ: {values.value?.theme}</p>
      </Show>
    </>
  );
}
```

### Vanilla — `bind()` を直接利用

```javascript
import { bind } from "@wc-bindable/core";

const storageEl = document.querySelector("wcs-storage");

bind(storageEl, (name, value) => {
  console.log(`${name} changed:`, value);
});
```

## オプションの DOM トリガー

`autoTrigger` が有効（デフォルト）の場合、`data-storagetarget` 属性を持つ要素のクリックで対応する `<wcs-storage>` の `save()` が実行されます:

```html
<button data-storagetarget="settings-store">設定を保存</button>
<wcs-storage id="settings-store" key="settings" manual
  data-wcs="value: settings"></wcs-storage>
```

## 設定

```javascript
import { bootstrapStorage } from "@wcstack/storage";

bootstrapStorage({
  autoTrigger: true,
  triggerAttribute: "data-storagetarget",
  tagNames: {
    storage: "wcs-storage",
  },
});
```

## 設計メモ

- `value`、`loading`、`error` は **出力ステート**
- `key`、`type`、`trigger` は **入力 / コマンドサーフェス**
- `trigger` は意図的に単方向: `true` を書き込むと保存、リセットで完了を通知
- `value` セッターは `manual` でない場合に自動保存を行う
- JSON 自動シリアライズにより、オブジェクト / 配列 / プリミティブを透過的に扱える
- `null` / `undefined` の保存はストレージからのキー削除として扱われる
- `storage` イベントによるクロスタブ同期は localStorage でのみ動作
- `manual` は保存タイミングを明示的に制御したい場合に有用

## ライセンス

MIT
