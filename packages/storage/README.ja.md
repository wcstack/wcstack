# @wcstack/storage

`@wcstack/storage` は wcstack エコシステムのためのヘッドレス ストレージ コンポーネントです。

視覚的な UI ウィジェットではありません。
ブラウザのストレージ（localStorage / sessionStorage）とリアクティブな状態をつなぐ **I/O ノード** です。

`@wcstack/state` と組み合わせると、`<wcs-storage>` はパス契約を通じて直接バインドできます:

- **入力 / コマンドサーフェス**: `key`, `type`, `trigger`
- **出力ステートサーフェス**: `value`, `loading`, `error`

つまり、ブラウザストレージの永続化を HTML 内で宣言的に表現できます。UI レイヤーに `localStorage.getItem()`、`JSON.parse()`、シリアライズのグルーコードを書く必要はありません。

`@wcstack/storage` は [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います:

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
    export default {
      // 意図的に undefined — "" や null で初期化すると双方向バインディング
      // 経由で書き戻され、リロードのたびに保存値を上書きしてしまう
      // （下記「5. load-before-bind」参照）
      username: undefined,
    };
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
- バインドする state スロットは `undefined` で開始する — 完全な idiom は「5. load-before-bind」を参照

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
    export default {
      // 意図的に undefined — 下記「5. load-before-bind」参照
      sharedCounter: undefined,
    };
  </script>
</wcs-state>

<wcs-storage key="shared-counter"
  data-wcs="value: sharedCounter">
</wcs-storage>

<!-- 他のタブで localStorage を変更すると、この値も自動更新される -->
<p data-wcs="textContent: sharedCounter"></p>
```

> **注意**: `storage` イベントは同一オリジンの他のタブでの変更時にのみ発火します。sessionStorage はタブ間で共有されないため、クロスタブ同期は localStorage でのみ動作します。

### 5. load-before-bind: 永続スロットの idiom

`<wcs-storage>` は自身の `connectedCallback` で永続値をロードして通知します。スクリプトのロード状況によっては、これは `<wcs-state>` のバインディング確立**前**に起こりえます — 帰結は 2 つ:

1. **上書き消去（clobber）**: バインドした state スロットが `""` / `0` / `null` / `[]` で始まると、初期の state→element 適用がその値を `value` に書き込み、write-through 保存が**リロードのたびに永続データを上書き**します。
2. **ロードの取り逃し**: ロード完了を知らせる value イベントが誰も聴いていない間に発火し、state スロットが初期値のまま残ることがあります。

両方を塞ぐ idiom:

```html
<wcs-state>
  <script type="module">
    export default {
      // 1. undefined =「無意見」: 初期適用がスキップされ、
      //    永続値が上書きされることはない
      todos: undefined,
      // 読み出しは正規化 getter 経由
      get list() {
        return Array.isArray(this.todos) ? this.todos : [];
      },
      // 2. <wcs-storage> がロード済みの値を一度だけ pull する
      $connectedCallback() {
        (async () => {
          await customElements.whenDefined("wcs-storage");
          const el = document.querySelector("wcs-storage");
          if (!el) return;
          await el.connectedCallbackPromise;
          if (!Array.isArray(this.todos) && Array.isArray(el.value)) {
            this.todos = el.value;
          }
        })();
      },
    };
  </script>
</wcs-state>

<wcs-storage key="todos" type="local" data-wcs="value: todos"></wcs-storage>
```

- 原則: **`value` に双方向バインドする state スロットは `undefined` で開始する** — `""` / `0` / `null` / `[]` にしない。
- `$connectedCallback` の pull が必要なのは、永続値を初回描画で表示したい場合だけです。ユーザー操作後にしか書かないスロットなら `undefined` だけで十分です。
- 動作する実例: `examples/state-cross-tab-todo`、`examples/state-color-palette`。

## ステートサーフェス vs コマンドサーフェス

`<wcs-storage>` は 2 種類のプロパティを公開します。

### 出力ステート（バインド可能な状態）

現在のストレージの値を表し、CSBC のメインサーフェスです:

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

## `:state()` による CSS スタイリング

`<wcs-storage>` は 2 つの boolean 出力ステートを
[`ElementInternals` の `CustomStateSet`](https://developer.mozilla.org/ja/docs/Web/API/CustomStateSet)
に反映します。そのため `data-wcs` バインディングやクラスの手動トグルなしに、CSS の
`:state()` 疑似クラスで直接スタイリングできます。

| ステート | on になる条件 |
|----------|----------------|
| `loading` | `wcs-storage:loading-changed` が `true` で発火（`false` でクリア） |
| `error` | `wcs-storage:error` が非 `null` の detail で発火（`null` でクリア） |

```css
wcs-storage:state(loading) ~ .spinner { display: block; }
wcs-storage:state(loading) ~ .spinner { display: none; } /* デフォルト */

form:has(wcs-storage:state(error)) .banner { display: block; }
```

属性やクラスと異なり `:state()` は要素の外部から書き込めないため、この出力ステートが
入力と混同される心配がありません。

**対応ブラウザ**（新構文 `:state(x)`）: Chrome/Edge 125+、Safari 17.4+、Firefox 126+。
非対応の環境ではステートが一切 set されないだけです — `:state()` セレクタがマッチしなく
なりますが、`<wcs-storage>` 自体は通常どおり動作し続けます（graceful degradation・never-throw）。

**SSR:** `:state()` は HTML にシリアライズできないため、サーバーレンダリングされた
マークアップの初期ペイントにはこれらのステートは乗りません（`@wcstack/server` は無改変）。
ハイドレーション前の見た目を制御したい場合は、代わりに `wcs-storage:not(:defined)` と組み合わせてください。

### デバッグ

カスタムステートは DevTools の Elements パネルには表示されず、`attachInternals()`
は同一要素に 2 回呼べないため、コンソールから直接覗く手段がありません。そのための
デバッグ専用の補助を 2 つ用意しています:

- `el.debugStates` — 現在 on になっているステート名の**スナップショット**配列
  （例: `["loading"]`）。`wc-bindable` の一部ではなく（バインド対象ではない）、
  形状も契約として保証されません — デバッグ用途にのみ使ってください。
- `debug-states` 属性（opt-in・既定 OFF）は、ステート変化を要素の
  `data-wcs-state-loading` / `data-wcs-state-error` 属性にミラーします。
  Elements パネルを開いておけば、トグルのたびにハイライトされます:

  ```html
  <wcs-storage key="prefs" debug-states></wcs-storage>
  ```

**CSS は `data-wcs-state-*` ではなく `:state()` に書いてください。** ミラーされた
属性は、DevTools を開いた状態でステート変化を可視化するためだけのものであり、
スタイリング用の正式なフックではありません。

## アーキテクチャ

`@wcstack/storage` は CSBC アーキテクチャに従います。

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

宣言は wc-bindable インターフェースモデルの全体に従い、3 つの独立したサーフェスを持ちます:

- **`properties`** — `bind()` が購読する観測可能な出力（`value`, `loading`, `error`, および Shell の `trigger`）
- **`inputs`** — 設定可能なサーフェス（`key`, `type` など）。ツール・コード生成・リモートプロキシが読む宣言的メタデータ
- **`commands`** — 呼び出し可能なメソッド（`load`, `save`, `remove`）。`@wcstack/state` のようなバインディングシステムが名前で呼び出せる

プロトコル上、コアの `bind()` が解釈するのは `properties` のみです。`inputs` / `commands`（および `attribute` / `async` ヒント）は記述的なメタデータであり、暗黙の双方向データフローを生成しません。

### Core (`StorageCore`)

`StorageCore` は任意のランタイムが購読できるバインド可能な状態に加え、ポータブルな入力 / コマンドサーフェスを宣言します:

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
  inputs: [
    { name: "key" },
    { name: "type" },
  ],
  commands: [
    { name: "load" },
    { name: "save" },
    { name: "remove" },
  ],
};
```

ヘッドレス利用では `core.load()` / `core.save(value)` を直接呼び出します — `trigger` は不要です。

### Shell (`<wcs-storage>`)

Shell は Core の宣言を `trigger` 出力と DOM 駆動の入力サーフェスで拡張します。`commands`（`load` / `save` / `remove`）は Core からそのまま継承されます:

```typescript
static wcBindable = {
  ...StorageCore.wcBindable,
  properties: [
    ...StorageCore.wcBindable.properties,
    { name: "trigger", event: "wcs-storage:trigger-changed" },
  ],
  inputs: [
    { name: "key" },
    { name: "type" },
    { name: "value" },
    { name: "manual" },
    { name: "trigger" },
  ],
};
```

Shell の inputs は意図的に `attribute` ヒントを持ちません: `key` / `type` / `manual` のセッターは既に各属性へ反映するため、`inputs[].attribute` を反映するバインディングシステムだと属性を二重に設定してしまうからです。

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
  operation: "load" | "save" | "remove" | "type";
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
- バインドするスロットは `undefined` で開始する（クイックスタート 5）ため、リロードが保存値を上書きしない

永続化が通常の状態更新と同じように見えるようになります。

## フレームワーク連携

`<wcs-storage>` は CSBC + `wc-bindable-protocol` なので、`@wc-bindable/*` の薄いアダプタを通じて任意のフレームワークで動作します。

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
- `trigger` は意図的に単方向: `true` を書き込むと保存、リセットで完了を通知。`save()` は never-throw（`key` 未設定などの失敗は throw せず `error` プロパティに流す）で、`trigger` は成否にかかわらず `false` へ復帰し完了イベントも発火するため、`true` で固着しない。
- `value` セッターは `manual` でない場合に自動保存を行う
- **`value` セッター vs `save()` / `trigger`**: `value` への代入（非 manual）は *代入された引数* を保存する（ライトスルー）。一方 `save()` と `trigger` は *現在の `value`*（直前の `load()` や他タブからの `storage` イベントで更新されうる）を保存する。このため `trigger`/`save()` は他タブ由来の値を書き戻す可能性がある。
- **`manual` モードでの `value`**: `manual` では `value` セッターは値を**ステージング**する（ストレージへは書き込まない）。`el.value = x` で読み取り値は更新される（`el.value === x`）が、ストレージには触れず、実際の書き込みは `save()` / `trigger` でのみ行われる。これにより `value: …` + `trigger: …` のバインディング対が機能する — バインドされた値がステージングされ、トリガー時にコミットされる。
- **非 manual の `value` 経路にはエコーガードを置かない**: 同値の `value-changed` 再発火をスキップするのは*ステージング*経路（`manual` モードで使う Core の `value` セッター）のみ。主経路である非 manual の `value` セッター → `save()` は意図的にライトスルーであり、代入値が現在値と等しくても毎回保存し `value-changed` を再発火する。これは仕様である — 上記のライトスルー契約を保つ必要があり、同一タブでは `storage` イベントが再発火しないためフィードバックループは生じない。`data-wcs="value: x"` の双方向バインディングでもエコーされる `value-changed` は無害で、`@wcstack/state` 側がラウンドトリップを重複排除する。
- **`save` コマンドのアリティ**: ヘッドレスな Core は `save(value)`、Shell は `save()`（現在値を保存）。どちらも同じ `commands` 名 `save` に現れるが、プロトコルの `commands` メタデータは記述的でアリティを持たないため、これは契約上の差異でありプロトコル違反ではない。
- **不正な `type`**: `"session"` 以外の `type` 属性はすべて `"local"` として扱う。不正値（例: `type="foo"`）は例外を投げず暗黙に `local` へフォールバックする。
- **実行時の `type` 変更**: 接続後に `type` 属性を変更すると以降の操作で使うストレージ領域は切り替わるが、新しい領域から**自動で再ロードはしない**（非 manual で自動再ロードするのは `key` 変更時のみ）。新領域の値が必要なら明示的に `load()` を呼ぶこと。
- **`error` の形状**: ストレージ失敗時、`error` には失敗した呼び出し（`load` / `save` / `remove`、あるいはヘッドレスで不正な `type` を代入した場合の `type`）を示す `WcsStorageError`（`{ operation, message }`）が設定される。操作は **never-throw**: key 未設定での操作呼び出しは throw せず `error` に `{ operation, message: "key is required." }` として流れる（`wcs-storage:error` も発火）。したがって実際には `error` は常に `WcsStorageError` か `null` のいずれかになる。より広い `WcsStorageError | Error | null` 型は前方互換性と兄弟パッケージとの一貫性のために維持している。
- JSON 自動シリアライズにより、オブジェクト / 配列 / プリミティブを透過的に扱える
- `null` / `undefined` の保存はストレージからのキー削除として扱われる
- `storage` イベントによるクロスタブ同期は localStorage でのみ動作。Shell は接続時（および再 attach 時）に監視を現在の `key` / `type` へ結びつけるため、自動ロードが走らない `manual` モードでもクロスタブ同期が機能する。接続後に `key` 属性を変更した場合も常に Core の key を再同期するため、`manual` モードや key を空にした場合でもクロスタブ同期は新しい key を追従する。クロスタブ更新が成功すると残存していた `error` もクリアされる（`load()` / `save()` / `remove()` が成功時に冒頭で error を null にするのと同様）。これにより、過去の失敗で残った error と新鮮な value が共存しない。
- `manual` は保存タイミングを明示的に制御したい場合に有用

## ライセンス

MIT
