# @wcstack/websocket

`@wcstack/websocket` は wcstack エコシステムのためのヘッドレス WebSocket コンポーネントです。

視覚的な UI ウィジェットではありません。
WebSocket 通信とリアクティブな状態をつなぐ **I/O ノード** です。

`@wcstack/state` と組み合わせると、`<wcs-ws>` はパス契約を通じて直接バインドできます:

- **入力 / コマンドサーフェス**: `url`, `trigger`, `send`
- **出力ステートサーフェス**: `message`, `connected`, `loading`, `error`, `errorInfo`, `readyState`

つまり、リアルタイム通信を HTML 内で宣言的に表現できます。UI レイヤーに `new WebSocket()`、`onmessage`、接続管理のグルーコードを書く必要はありません。

`@wcstack/websocket` は [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います:

- **Core** (`WebSocketCore`) が接続、メッセージング、再接続、非同期状態を処理
- **Shell** (`<wcs-ws>`) がその状態を DOM 属性、ライフサイクル、宣言的コマンドに接続
- **Binding Contract** (`static wcBindable`) が観測可能な `properties`、書き込み可能な `inputs`、呼び出し可能な `commands` を宣言

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
  <script type="module">
    export default {
      lastMessage: null,
      isConnected: false,
      isLoading: false,

      get connectionLabel() {
        return this.isConnected ? "接続中" : "切断";
      },
      get lastMessageJson() {
        return JSON.stringify(this.lastMessage, null, 2);
      },
    };
  </script>

  <wcs-ws
    url="wss://example.com/ws"
    data-wcs="message: lastMessage; connected: isConnected; loading: isLoading">
  </wcs-ws>

  <p data-wcs="textContent: connectionLabel"></p>
  <pre data-wcs="textContent: lastMessageJson"></pre>
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

      get lastMessageJson() {
        return JSON.stringify(this.lastMessage, null, 2);
      },
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

  <pre data-wcs="textContent: lastMessageJson"></pre>
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

      get connectionLabel() {
        return this.isConnected ? "接続中" : "切断";
      },
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
  <p data-wcs="textContent: connectionLabel"></p>
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

現在の接続状態を表す、主な観測サーフェスです:

| プロパティ | 型 | 説明 |
|------------|------|------|
| `message` | `any` | 最新の受信メッセージ（JSON 自動パース） |
| `connected` | `boolean` | WebSocket 接続中は `true` |
| `loading` | `boolean` | 接続処理中は `true` |
| `error` | `WcsWsError \| Event \| null` | 接続またはクローズエラー |
| `errorInfo` | `WcsIoErrorInfo \| null` | シリアライズ可能な失敗タクソノミ（安定した `code` / `phase` / `recoverable`）。`error` から導出される。追加的で、`error` の形状は不変。 |
| `readyState` | `number` | WebSocket readyState 定数 |

### 入力 / コマンドサーフェス

HTML、JS、または `@wcstack/state` バインディングから接続とメッセージングを制御します:

| プロパティ | 型 | 説明 |
|------------|------|------|
| `url` | `string` | WebSocket エンドポイント URL |
| `trigger` | `boolean` | 単方向の接続トリガー |
| `send` | `any` | 値を設定するとデータを送信（オブジェクトは自動文字列化） |
| `manual` | `boolean` | DOM 接続時の自動接続を無効化 |

## `:state()` による CSS スタイリング

`<wcs-ws>` は 3 つの boolean 出力ステートを
[`ElementInternals` の `CustomStateSet`](https://developer.mozilla.org/ja/docs/Web/API/CustomStateSet)
に反映します。そのため `data-wcs` バインディングやクラスの手動トグルなしに、CSS の
`:state()` 疑似クラスで直接スタイリングできます。

| ステート | on になる条件 |
|----------|----------------|
| `connected` | `wcs-ws:connected-changed` が `true` で発火（`false` でクリア） |
| `loading` | `wcs-ws:loading-changed` が `true` で発火（`false` でクリア） |
| `error` | `wcs-ws:error` が非 `null` の detail で発火（`null` でクリア） |

```css
wcs-ws:state(connected) ~ .indicator { color: green; }
wcs-ws:state(loading) ~ .indicator   { color: orange; }

form:has(wcs-ws:state(error)) .banner { display: block; }
```

属性やクラスと異なり `:state()` は要素の外部から書き込めないため、この出力ステートが
入力と混同される心配がありません。

**対応ブラウザ**（新構文 `:state(x)`）: Chrome/Edge 125+、Safari 17.4+、Firefox 126+。
非対応の環境ではステートが一切 set されないだけです — `:state()` セレクタがマッチしなく
なりますが、`<wcs-ws>` 自体は通常どおり動作し続けます（graceful degradation・never-throw）。

**SSR:** `:state()` は HTML にシリアライズできないため、サーバーレンダリングされた
マークアップの初期ペイントにはこれらのステートは乗りません（`@wcstack/server` は無改変）。
ハイドレーション前の見た目を制御したい場合は、代わりに `wcs-ws:not(:defined)` と組み合わせてください。

### デバッグ

カスタムステートは DevTools の Elements パネルには表示されず、`attachInternals()`
は同一要素に 2 回呼べないため、コンソールから直接覗く手段がありません。そのための
デバッグ専用の補助を 2 つ用意しています:

- `el.debugStates` — 現在 on になっているステート名の**スナップショット**配列
  （例: `["connected"]`）。`wc-bindable` の一部ではなく（バインド対象ではない）、
  形状も契約として保証されません — デバッグ用途にのみ使ってください。
- `debug-states` 属性（opt-in・既定 OFF）は、ステート変化を要素の
  `data-wcs-state-connected` / `data-wcs-state-loading` / `data-wcs-state-error`
  属性にミラーします。Elements パネルを開いておけば、トグルのたびにハイライトされます:

  ```html
  <wcs-ws url="wss://example.com/socket" debug-states></wcs-ws>
  ```

**CSS は `data-wcs-state-*` ではなく `:state()` に書いてください。** ミラーされた
属性は、DevTools を開いた状態でステート変化を可視化するためだけのものであり、
スタイリング用の正式なフックではありません。

## アーキテクチャ

`@wcstack/websocket` は CSBC アーキテクチャに従います。

### Core: `WebSocketCore`

`WebSocketCore` は純粋な `EventTarget` クラスです。
以下を内包します:

- WebSocket 接続管理
- 自動再接続ロジック
- JSON メッセージパース
- 非同期状態遷移
- 観測可能な状態と呼び出し可能なコマンドの `wc-bindable-protocol` 宣言

`EventTarget` と `WebSocket` をサポートする任意のランタイムでヘッドレスに動作します。

### Shell: `<wcs-ws>`

`<wcs-ws>` は `WebSocketCore` の薄い `HTMLElement` ラッパーです。
以下を追加します:

- 属性 / プロパティマッピング
- DOM ライフサイクル統合
- `trigger`、`send` などの宣言的ヘルパー
- DOM 向け設定とコマンドプロパティのための `wc-bindable-protocol` inputs

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
| `binary-type` | `"blob" \| "arraybuffer"` | `blob` | 受信バイナリフレームを `message` でどう表現するか。`arraybuffer` 以外の値は `blob` に正規化される |

| プロパティ | 型 | 説明 |
|------------|------|------|
| `message` | `any` | 最新の受信メッセージ（JSON 自動パース） |
| `connected` | `boolean` | WebSocket 接続中は `true` |
| `loading` | `boolean` | 接続処理中は `true` |
| `error` | `WcsWsError \| Event \| null` | エラー情報 |
| `errorInfo` | `WcsIoErrorInfo \| null` | 失敗タクソノミ（`code` / `phase` / `recoverable`）。`error` から導出される |
| `readyState` | `number` | WebSocket readyState 定数 |
| `binaryType` | `"blob" \| "arraybuffer"` | バイナリフレーム表現（`binary-type` 属性を背後に持つ。既定 `blob`） |
| `trigger` | `boolean` | `true` を設定すると接続を開始 |
| `send` | `any` | 値を設定するとデータを送信 |

| メソッド | 説明 |
|----------|------|
| `connect()` | WebSocket 接続を開く |
| `sendMessage(data)` | 接続経由でデータを送信 |
| `close(code?, reason?)` | 接続を閉じる |

## wc-bindable-protocol

`WebSocketCore` と `<wcs-ws>` はどちらも `wc-bindable-protocol` 契約を宣言しており、プロトコル対応の任意のフレームワーク、アダプタ、remote proxy、ツール層と相互運用できます。

現在の契約は独立した 3 つのサーフェスで構成されます:

- `properties`: `bind()` とフレームワークアダプタが消費する観測可能な出力
- `inputs`: DOM 設定とコマンド的プロパティのための書き込み可能なインターフェースメタデータ
- `commands`: ツールや remote 対応 consumer から呼び出せるメソッド

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
    { name: "errorInfo",  event: "wcs-ws:error-info-changed" },
    { name: "readyState", event: "wcs-ws:readystate-changed" },
  ],
  commands: [
    { name: "connect" },
    { name: "send" },
    { name: "close" },
  ],
};
```

ヘッドレスの利用者は `core.connect(url)` を直接呼ぶため、`trigger` は不要です。Core は settable な `url` / option プロパティを公開しないため `inputs` を宣言せず、それらの値は `connect()` コマンドに渡します。

### Shell (`<wcs-ws>`)

Shell は Core の宣言を拡張し、DOM 向け input、コマンドプロパティ、HTMLElement メソッドを通じて、バインディングシステムから宣言的に接続とメッセージングを制御できるようにします:

```typescript
static wcBindable = {
  ...WebSocketCore.wcBindable,
  properties: [
    ...WebSocketCore.wcBindable.properties,
    { name: "trigger", event: "wcs-ws:trigger-changed" },
    { name: "send",    event: "wcs-ws:send-changed" },
  ],
  inputs: [
    { name: "url", attribute: "url" },
    { name: "protocols", attribute: "protocols" },
    { name: "autoReconnect", attribute: "auto-reconnect" },
    { name: "reconnectInterval", attribute: "reconnect-interval" },
    { name: "maxReconnects", attribute: "max-reconnects" },
    { name: "binaryType", attribute: "binary-type" },
    { name: "manual", attribute: "manual" },
    { name: "trigger" },
    { name: "send" },
  ],
  commands: [
    { name: "connect" },
    { name: "sendMessage" },
    { name: "close" },
  ],
};
```

## TypeScript 型

```typescript
import type {
  WcsWsError, WcsWsCoreValues, WcsWsValues,
  WcsWsInputs, WcsWsCoreCommands, WcsWsCommands
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

interface WcsWsInputs {
  url: string;
  protocols: string;
  autoReconnect: boolean;
  reconnectInterval: number;
  maxReconnects: number;
  binaryType: BinaryType; // "blob" | "arraybuffer"
  manual: boolean;
  trigger: boolean;
  send: unknown;
}

interface WcsWsCoreCommands {
  connect(url: string, options?: {
    protocols?: string | string[];
    autoReconnect?: boolean;
    reconnectInterval?: number;
    maxReconnects?: number;
    binaryType?: BinaryType;
  }): void;
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}

interface WcsWsCommands {
  connect(): void;
  sendMessage(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
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

`<wcs-ws>` は CSBC の `wc-bindable-protocol` 契約を公開するため、`@wc-bindable/*` の薄いアダプタを通じて任意のフレームワークで動作します。

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
- **`errorInfo` タクソノミ**: `error` に現れるのと同じ失敗を、シリアライズ可能な `WcsIoErrorInfo`（安定した `code` / `phase` / `recoverable`）に分類する**追加的な**バインド可能出力（`wcs-ws:error-info-changed`）です。`error` の形状は変えません。`url` を指定しない `connect()` は `invalid-argument`（phase `start`、回復不可）、open 前の `send()` は `invalid-state`（phase `execute`、回復不可——先に connect が必要）、`new WebSocket()` の構築例外またはプラットフォームの `error` Event は `connection-error`（phase `execute`、**`recoverable: true`**——接続エラーは通常一過性で、再接続で回復しうる）です。`errorInfo` は `error` と同じタイミングで遷移し（`error` と共にクリアされる）ます。共有の `WcsIoErrorInfo` 型と `WCS_WEBSOCKET_ERROR_CODE` 定数は export 済みです。

## ライセンス

MIT
