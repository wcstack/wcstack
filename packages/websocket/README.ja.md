# @wcstack/websocket

`@wcstack/websocket` は wcstack エコシステムのためのヘッドレス WebSocket コンポーネントです。

視覚的な UI ウィジェットではありません。
WebSocket 通信とリアクティブな状態をつなぐ **I/O ノード** です。

`@wcstack/state` と組み合わせると、`<wcs-ws>` はパス契約を通じて直接バインドできます:

- **入力 / コマンドサーフェス**: `url`, `trigger`, `send`
- **出力ステートサーフェス**: `message`, `connected`, `loading`, `error`, `readyState`

つまり、リアルタイム通信を HTML 内で宣言的に表現できます。UI レイヤーに `new WebSocket()`、`onmessage`、接続管理のグルーコードを書く必要はありません。

`@wcstack/websocket` は [HAWC](https://github.com/wc-bindable-protocol/wc-bindable-protocol/blob/main/docs/articles/HAWC.md) アーキテクチャに従います:

- **Core** (`WebSocketCore`) が接続、メッセージング、再接続、非同期状態を処理
- **Shell** (`<wcs-ws>`) がその状態を DOM に接続
- フレームワークやバインディングシステムは [wc-bindable-protocol](https://github.com/wc-bindable-protocol/wc-bindable-protocol) 経由で利用

## なぜこれが存在するのか

リアルタイム機能には通常、命令的な WebSocket 管理が必要です。接続ライフサイクル、再接続ロジック、メッセージのパース、エラー処理、切断時のクリーンアップ。

`@wcstack/websocket` はそのロジックを再利用可能なコンポーネントに移し、結果をバインド可能な状態として公開します。

`@wcstack/state` と組み合わせたフローは:

1. 状態が `url` を決定（または `trigger` が発火）
2. `<wcs-ws>` が接続を開く
3. 受信メッセージが `message` として、接続状態が `connected`、`loading`、`error` として返る
4. UI は `data-wcs` でそれらのパスにバインド

リアルタイム通信が命令的なイベント配線ではなく、**状態遷移**になります。

## インストール

```bash
npm install @wcstack/websocket
```

## クイックスタート

### 1. 状態からのリアクティブ WebSocket

`<wcs-ws>` が DOM に接続され `url` が設定されると、自動的に WebSocket 接続を開きます。JSON メッセージは自動パースされます。

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/websocket/auto"></script>

<wcs-state>
  <script type="application/json">
    {
      "lastMessage": null,
      "isConnected": false,
      "isLoading": false
    }
  </script>

  <wcs-ws
    url="wss://example.com/ws"
    data-wcs="message: lastMessage; connected: isConnected; loading: isLoading">
  </wcs-ws>

  <p data-wcs="textContent: isConnected|then('接続中','切断')"></p>
  <pre data-wcs="textContent: lastMessage|json"></pre>
</wcs-state>
```

これがデフォルトモードです:

- `url` を設定
- `message` を受け取る
- 任意で `connected`、`loading`、`error`、`readyState` もバインド

### 2. 状態からのメッセージ送信

`send` プロパティでサーバーにデータを送信します。`send` に値を設定すると即時送信され、オブジェクトは自動的に JSON 文字列化されます。

```html
<wcs-state>
  <script type="module">
    export default {
      chatInput: "",
      lastMessage: null,
      outgoing: null,

      sendChat() {
        this.outgoing = { type: "chat", content: this.chatInput };
        this.chatInput = "";
      },
    };
  </script>

  <wcs-ws
    url="wss://example.com/ws"
    data-wcs="message: lastMessage; send: outgoing">
  </wcs-ws>

  <input data-wcs="value: chatInput" placeholder="メッセージを入力">
  <button data-wcs="onclick: sendChat">送信</button>

  <pre data-wcs="textContent: lastMessage|json"></pre>
</wcs-state>
```

### 3. `trigger` による手動接続

接続タイミングを制御したい場合は `manual` を使います。

```html
<wcs-state>
  <script type="module">
    export default {
      shouldConnect: false,
      lastMessage: null,
      isConnected: false,

      openConnection() {
        this.shouldConnect = true;
      },
    };
  </script>

  <wcs-ws
    url="wss://example.com/ws"
    manual
    data-wcs="trigger: shouldConnect; message: lastMessage; connected: isConnected">
  </wcs-ws>

  <button data-wcs="onclick: openConnection">接続</button>
  <p data-wcs="textContent: isConnected|then('接続中','切断')"></p>
</wcs-state>
```

`trigger` は **単方向のコマンドサーフェス** です:

- `true` を書き込むと接続を開始
- 接続開始後に自動で `false` にリセット
- リセット時に `wcs-ws:trigger-changed` を発火

```
外部からの書き込み:  false → true   イベントなし（接続を開始）
自動リセット:        true  → false  wcs-ws:trigger-changed を発火
```

### 4. 自動再接続

```html
<wcs-ws
  url="wss://example.com/ws"
  auto-reconnect
  reconnect-interval="5000"
  max-reconnects="10"
  data-wcs="message: lastMessage; connected: isConnected; error: wsError">
</wcs-ws>
```

接続が異常切断された場合（クローズコード 1000 以外）、`<wcs-ws>` は自動的に再接続します:

- `reconnect-interval` ミリ秒待機（デフォルト: 3000）
- 最大 `max-reconnects` 回リトライ（デフォルト: Infinity）
- 再接続成功時にリトライカウントをリセット

## ステートサーフェス vs コマンドサーフェス

`<wcs-ws>` は 2 種類のプロパティを公開します。

### 出力ステート（バインド可能な非同期状態）

現在の接続状態を表し、HAWC のメインサーフェスです:

| プロパティ | 型 | 説明 |
|------------|------|------|
| `message` | `any` | 最新の受信メッセージ（JSON 自動パース） |
| `connected` | `boolean` | WebSocket 接続中は `true` |
| `loading` | `boolean` | 接続処理中は `true` |
| `error` | `WcsWsError \| Event \| null` | 接続またはクローズエラー |
| `readyState` | `number` | WebSocket readyState 定数 |

### 入力 / コマンドサーフェス

HTML、JS、または `@wcstack/state` バインディングから接続とメッセージングを制御します:

| プロパティ | 型 | 説明 |
|------------|------|------|
| `url` | `string` | WebSocket エンドポイント URL |
| `trigger` | `boolean` | 単方向の接続トリガー |
| `send` | `any` | 値を設定するとデータを送信（オブジェクトは自動文字列化） |
| `manual` | `boolean` | DOM 接続時の自動接続を無効化 |

## アーキテクチャ

`@wcstack/websocket` は HAWC アーキテクチャに従います。

### Core: `WebSocketCore`

`WebSocketCore` は純粋な `EventTarget` クラスです。
以下を内包します:

- WebSocket 接続管理
- 自動再接続ロジック
- JSON メッセージパース
- 非同期状態遷移
- `wc-bindable-protocol` 宣言

`EventTarget` と `WebSocket` をサポートする任意のランタイムでヘッドレスに動作します。

### Shell: `<wcs-ws>`

`<wcs-ws>` は `WebSocketCore` の薄い `HTMLElement` ラッパーです。
以下を追加します:

- 属性 / プロパティマッピング
- DOM ライフサイクル統合
- `trigger`、`send` などの宣言的ヘルパー

この分離により、接続ロジックのポータビリティを保ちながら、`@wcstack/state` のような DOM ベースのバインディングシステムとの自然な連携を可能にしています。

### Target injection

Core は **target injection** により Shell 上で直接イベントを発火するため、イベントの再ディスパッチは不要です。

## ヘッドレス利用（Core 単体）

`WebSocketCore` は DOM なしで単体利用できます。`static wcBindable` を宣言しているため、`@wc-bindable/core` の `bind()` で状態をサブスクライブできます:

```typescript
import { WebSocketCore } from "@wcstack/websocket";
import { bind } from "@wc-bindable/core";

const core = new WebSocketCore();

const unbind = bind(core, (name, value) => {
  console.log(`${name}:`, value);
});

core.connect("wss://example.com/ws", {
  autoReconnect: true,
  reconnectInterval: 5000,
});

// メッセージ送信
core.send(JSON.stringify({ type: "ping" }));

// クリーンアップ
core.close();
unbind();
```

Node.js、Deno、Cloudflare Workers など、`EventTarget` と `WebSocket` が利用可能な環境で動作します。

## URL の監視

`<wcs-ws>` はデフォルトで以下のタイミングに自動的に接続を開きます:

1. DOM に接続され、`url` が設定されているとき
2. DOM 接続中に `url` 属性が変更されたとき

`manual` 属性を設定すると自動接続が無効になり、`connect()` メソッドや `trigger` プロパティで明示的に制御できます。

## プログラムからの利用

```javascript
const wsEl = document.querySelector("wcs-ws");

// 手動接続
wsEl.connect();

// データ送信
wsEl.sendMessage(JSON.stringify({ type: "chat", content: "こんにちは" }));

console.log(wsEl.message);    // 最新メッセージ
console.log(wsEl.connected);  // boolean
console.log(wsEl.loading);    // boolean
console.log(wsEl.error);      // エラー情報 or null
console.log(wsEl.readyState); // WebSocket readyState

// 切断
wsEl.close();
```

## オプションの DOM トリガー

`autoTrigger` が有効（デフォルト）の場合、`data-wstarget` 属性を持つ要素のクリックで対応する `<wcs-ws>` の接続が実行されます:

```html
<button data-wstarget="my-ws">接続</button>
<wcs-ws id="my-ws" url="wss://example.com/ws" manual></wcs-ws>
```

イベント委譲を使用しているため、動的に追加された要素でも動作します。`closest()` API により、ネストされた子要素（ボタン内のアイコン等）のクリックも検出します。

指定した id に一致する要素が存在しない場合、または一致した要素が `<wcs-ws>` でない場合、クリックは無視されます（エラーは発生しません）。

これは便利機能です。
wcstack アプリケーションでは、**`trigger` によるステート駆動のトリガー**が通常の主要パターンです。

## 要素一覧

### `<wcs-ws>`

| 属性 | 型 | デフォルト | 説明 |
|------|------|------------|------|
| `url` | `string` | — | WebSocket エンドポイント URL |
| `protocols` | `string` | — | カンマ区切りのサブプロトコルリスト |
| `manual` | `boolean` | `false` | 自動接続を無効化 |
| `auto-reconnect` | `boolean` | `false` | 自動再接続を有効化 |
| `reconnect-interval` | `number` | `3000` | 再接続間隔（ミリ秒） |
| `max-reconnects` | `number` | `Infinity` | 最大再接続回数 |

| プロパティ | 型 | 説明 |
|------------|------|------|
| `message` | `any` | 最新の受信メッセージ（JSON 自動パース） |
| `connected` | `boolean` | WebSocket 接続中は `true` |
| `loading` | `boolean` | 接続処理中は `true` |
| `error` | `WcsWsError \| Event \| null` | エラー情報 |
| `readyState` | `number` | WebSocket readyState 定数 |
| `trigger` | `boolean` | `true` を設定すると接続を開始 |
| `send` | `any` | 値を設定するとデータを送信 |

| メソッド | 説明 |
|----------|------|
| `connect()` | WebSocket 接続を開く |
| `sendMessage(data)` | 接続経由でデータを送信 |
| `close(code?, reason?)` | 接続を閉じる |

## wc-bindable-protocol

`WebSocketCore` と `<wcs-ws>` はどちらも wc-bindable-protocol に準拠しており、プロトコル対応の任意のフレームワークやコンポーネントと相互運用できます。

### Core (`WebSocketCore`)

`WebSocketCore` は任意のランタイムからサブスクライブできるバインド可能な非同期状態を宣言します:

```typescript
static wcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "message",    event: "wcs-ws:message" },
    { name: "connected",  event: "wcs-ws:connected-changed" },
    { name: "loading",    event: "wcs-ws:loading-changed" },
    { name: "error",      event: "wcs-ws:error" },
    { name: "readyState", event: "wcs-ws:readystate-changed" },
  ],
};
```

ヘッドレスの利用者は `core.connect(url)` を直接呼ぶため、`trigger` は不要です。

### Shell (`<wcs-ws>`)

Shell は Core の宣言を拡張し、バインディングシステムから宣言的に接続とメッセージングを制御できるようにします:

```typescript
static wcBindable = {
  ...WebSocketCore.wcBindable,
  properties: [
    ...WebSocketCore.wcBindable.properties,
    { name: "trigger", event: "wcs-ws:trigger-changed" },
    { name: "send",    event: "wcs-ws:send-changed" },
  ],
};
```

## TypeScript 型

```typescript
import type {
  WcsWsError, WcsWsCoreValues, WcsWsValues
} from "@wcstack/websocket";
```

```typescript
// WebSocket エラー
interface WcsWsError {
  code?: number;
  reason?: string;
  message?: string;
}

// Core（ヘッドレス）— 5 つの非同期状態プロパティ
// T のデフォルトは unknown。型引数を渡すと message が型付けされる
interface WcsWsCoreValues<T = unknown> {
  message: T;
  connected: boolean;
  loading: boolean;
  error: WcsWsError | Event | null;
  readyState: number;
}

// Shell（<wcs-ws>）— Core を拡張し trigger と send を追加
interface WcsWsValues<T = unknown> extends WcsWsCoreValues<T> {
  trigger: boolean;
  send: unknown;
}
```

## なぜ `@wcstack/state` とうまく連携するのか

`@wcstack/state` は UI と状態の唯一の契約としてパス文字列を使います。
`<wcs-ws>` はこのモデルに自然に適合します:

- 状態が `url` を決定、または `trigger` を発火
- `<wcs-ws>` が接続を開いて管理
- 受信データが `message` として、ステータスが `connected`、`loading`、`error` として返る
- UI は WebSocket のグルーコードを書かずにそれらのパスにバインド
- 送信データは `send` プロパティ経由で流れる

リアルタイム通信が通常の状態更新と同じように見えるようになります。

## フレームワーク連携

`<wcs-ws>` は HAWC + `wc-bindable-protocol` なので、`@wc-bindable/*` の薄いアダプタを通じて任意のフレームワークで動作します。

### React

```tsx
import { useWcBindable } from "@wc-bindable/react";
import type { WcsWsValues } from "@wcstack/websocket";

interface ChatMessage { type: string; content: string; }

function Chat() {
  const [ref, { message, connected, loading }] =
    useWcBindable<HTMLElement, WcsWsValues<ChatMessage>>();

  return (
    <>
      <wcs-ws ref={ref} url="wss://example.com/ws" auto-reconnect />
      {loading && <p>接続中...</p>}
      {connected && <p>接続済み</p>}
      {message && <pre>{JSON.stringify(message)}</pre>}
    </>
  );
}
```

### Vue

```vue
<script setup lang="ts">
import { useWcBindable } from "@wc-bindable/vue";
import type { WcsWsValues } from "@wcstack/websocket";

interface ChatMessage { type: string; content: string; }

const { ref, values } = useWcBindable<HTMLElement, WcsWsValues<ChatMessage>>();
</script>

<template>
  <wcs-ws :ref="ref" url="wss://example.com/ws" auto-reconnect />
  <p v-if="values.loading">接続中...</p>
  <p v-else-if="values.connected">接続済み</p>
  <pre v-if="values.message">{{ values.message }}</pre>
</template>
```

### Svelte

```svelte
<script>
import { wcBindable } from "@wc-bindable/svelte";

let message = $state(null);
let connected = $state(false);
</script>

<wcs-ws url="wss://example.com/ws" auto-reconnect
  use:wcBindable={{ onUpdate: (name, v) => {
    if (name === "message") message = v;
    if (name === "connected") connected = v;
  }}} />

<p>{connected ? "接続済み" : "切断"}</p>
{#if message}
  <pre>{JSON.stringify(message)}</pre>
{/if}
```

### Solid

```tsx
import { createWcBindable } from "@wc-bindable/solid";
import type { WcsWsValues } from "@wcstack/websocket";

interface ChatMessage { type: string; content: string; }

function Chat() {
  const [values, directive] = createWcBindable<WcsWsValues<ChatMessage>>();

  return (
    <>
      <wcs-ws ref={directive} url="wss://example.com/ws" auto-reconnect />
      <Show when={values.connected} fallback={<p>切断</p>}>
        <p>接続済み</p>
      </Show>
      <Show when={values.message}>
        <pre>{JSON.stringify(values.message)}</pre>
      </Show>
    </>
  );
}
```

### Vanilla — `bind()` を直接利用

```javascript
import { bind } from "@wc-bindable/core";

const wsEl = document.querySelector("wcs-ws");

bind(wsEl, (name, value) => {
  console.log(`${name} changed:`, value);
});
```

## 設定

```javascript
import { bootstrapWebSocket } from "@wcstack/websocket";

bootstrapWebSocket({
  autoTrigger: true,
  triggerAttribute: "data-wstarget",
  tagNames: {
    ws: "wcs-ws",
  },
});
```

## 設計メモ

- `message`、`connected`、`loading`、`error`、`readyState` は **出力ステート**
- `url`、`trigger`、`send` は **入力 / コマンドサーフェス**
- `trigger` は意図的に単方向: `true` を書き込むと接続、リセットで完了を通知
- `send` は即時送信後に `null` にリセット — 送信のたびに値を設定する
- JSON メッセージは受信時に自動パース、オブジェクトは送信時に自動文字列化
- `manual` は接続タイミングを明示的に制御したい場合に有用
- 自動再接続は異常切断時のみ発動（コード 1000 以外）

## ライセンス

MIT
