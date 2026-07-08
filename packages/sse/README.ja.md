# @wcstack/sse

`@wcstack/sse` は wcstack エコシステムのためのヘッドレス Server-Sent Events（`EventSource`）コンポーネントです。

視覚的な UI ウィジェットではありません。
SSE ストリームとリアクティブな状態をつなぐ **単方向 I/O ノード** です。

`@wcstack/state` と組み合わせると、`<wcs-sse>` はパス契約を通じて直接バインドできます:

- **入力 / コマンドサーフェス**: `url`, `trigger`（加えて接続オプション `withCredentials`, `events`, `raw`, `manual`）
- **出力ステートサーフェス**: `message`, `connected`, `loading`, `error`, `readyState`

つまり、サーバーからのストリーミングプッシュを HTML 内で宣言的に表現できます。UI レイヤーに `new EventSource()`、`onmessage`、接続管理のグルーコードを書く必要はありません。

`@wcstack/sse` は [CSBC](https://github.com/csbc-dev/arch/blob/main/README.md)（Core / Shell / Binding Contract）アーキテクチャに従います:

- **Core** (`SseCore`) が接続、メッセージのパース、非同期状態を処理
- **Shell** (`<wcs-sse>`) がその状態を DOM 属性、ライフサイクル、宣言的コマンドに接続
- **Binding Contract** (`static wcBindable`) が観測可能な `properties`、書き込み可能な `inputs`、呼び出し可能な `commands` を宣言

## `@wcstack/websocket` との関係

`<wcs-sse>` は `<wcs-ws>` の **受信専用・単方向** の対応物です。形は同じですが、SSE の方がシンプルです:

| | `<wcs-ws>` | `<wcs-sse>` |
|---|---|---|
| 方向 | 双方向 | **サーバー → クライアントのみ** |
| 送信 | `send` / `sendMessage()` | —（利用不可） |
| 再接続 | 手動（`auto-reconnect`） | **ネイティブ**（ブラウザが処理） |
| 名前付きイベント | — | **`events` 属性**（`event:` フィールド） |
| ワイヤフォーマット | テキスト/バイナリフレーム | UTF-8 テキストのみ |

ストリームを消費するだけなら `<wcs-sse>` を選ぶとよいでしょう。設定すべき項目が少なく、再接続も自動です。

## インストール

```bash
npm install @wcstack/sse
```

## クイックスタート

### 1. 状態からのリアクティブストリーム

`<wcs-sse>` が DOM に接続され `url` が設定されると、自動的に `EventSource` を開きます。JSON ペイロードは自動パースされます。

```html
<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/sse/auto"></script>

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

  <wcs-sse
    url="/events"
    data-wcs="message: lastMessage; connected: isConnected; loading: isLoading">
  </wcs-sse>

  <p data-wcs="textContent: connectionLabel"></p>
  <pre data-wcs="textContent: lastMessageJson"></pre>
</wcs-state>
```

これがデフォルトモードです:

- `url` を設定
- `message` を受け取る
- 任意で `connected`、`loading`、`error`、`readyState` もバインド

### 2. `message` の形

受信したすべてのイベント — 名前なしの `message` に加えて、サブスクライブした名前付きイベント — は単一のオブジェクトとして届きます:

```ts
{
  event: string;        // イベントタイプ（名前なしイベントは "message"）
  data: unknown;        // パース済みペイロード（`raw` 指定時は生の文字列）
  lastEventId: string;  // SSE の `id:` フィールド（存在する場合）
}
```

state 側のコードは `event` で分岐して処理を決めます。これにより、SSE の名前付きイベントをサポートしつつ、バインディングサーフェスを静的に宣言された単一のプロパティに保てます。

### 3. 名前付きイベント

SSE ストリームは `event:` フィールドでイベントにラベルを付けられます:

```
event: price
data: {"symbol":"AAPL","value":189.2}

event: trade
data: {"side":"buy","qty":10}
```

受け取りたい名前を `events` 属性に列挙します（カンマ区切り）。これらは同じ `message` プロパティに集約され、`message.event` でどれが発火したかが分かります。

```html
<wcs-sse
  url="/market"
  events="price, trade"
  data-wcs="message: lastEvent">
</wcs-sse>
```

名前なしの `data:` 行は、設定なしで常に `message`（イベントタイプ `"message"`）として届きます。

### 4. 生テキストストリーム

デフォルトでは、JSON としてパースできる文字列ペイロードは自動パースされます。リテラルな文字列が欲しいプレーンテキストストリーム（ログ、進捗、トークンストリーム）では — そして `"123"` が数値 `123` になるような驚きを避けるため — `raw` を設定します。

```html
<wcs-sse url="/log" raw data-wcs="message: lastLine"></wcs-sse>
```

### 5. `trigger` による手動接続

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
      openStream() {
        this.shouldConnect = true;
      },
    };
  </script>

  <wcs-sse
    url="/events"
    manual
    data-wcs="trigger: shouldConnect; message: lastMessage; connected: isConnected">
  </wcs-sse>

  <button data-wcs="onclick: openStream">接続</button>
  <p data-wcs="textContent: connectionLabel"></p>
</wcs-state>
```

`trigger` は **単方向のコマンドサーフェス** です:

- `true` を書き込むと接続試行（`connect()`）を開始
- 試行開始後に自動で `false` にリセット
- リセット時に `wcs-sse:trigger-changed` を発火

```
外部からの書き込み:  false → true   イベントなし（接続を開始）
自動リセット:        true  → false  wcs-sse:trigger-changed を発火
```

注意: `trigger` は常に自動リセットを行い `wcs-sse:trigger-changed` を発火しますが、新しい接続が開くことは **保証しません**。`url` が未設定の場合、または要素がすでに同じ `url` に接続済みの場合、`connect()` は no-op になり（後者は upgrade の二重発火を吸収する冪等ガードです）、その場合はリセットのみが発火します。同じ `url` を開き直す必要がある場合は、先に `close()` を呼んでください。

## 再接続はネイティブ

`<wcs-ws>` とは異なり、`auto-reconnect` / `reconnect-interval` / `max-reconnects` の設定は **ありません**。`EventSource` は接続が切れると自動的に再接続し、サーバーが SSE の `retry:` フィールドで遅延を制御します。

`<wcs-sse>` はこれを状態として表面化します:

- ブラウザが再接続中は、`loading` が `true`、`connected` が `false`、`readyState` が `CONNECTING (0)`
- 恒久的な失敗（例: 非 2xx レスポンス、誤ったコンテンツタイプ）の場合、`readyState` が `CLOSED (2)` になり `loading` が `false`
- `error` は最新のエラー `Event` を保持

再接続を止めるには、`close()` を呼ぶ（または DOM から要素を削除する）。

## ステートサーフェス vs コマンドサーフェス

### 出力ステート（バインド可能な非同期状態）

| プロパティ | 型 | 説明 |
|------------|------|------|
| `message` | `WcsSseMessage \| null` | 最新の受信イベント `{ event, data, lastEventId }`（JSON 自動パース） |
| `connected` | `boolean` | ストリーム接続中は `true` |
| `loading` | `boolean` | 接続中または再接続中は `true` |
| `error` | `Event \| Error \| null` | 接続エラー |
| `readyState` | `number` | `EventSource` readyState 定数 |

### 入力 / コマンドサーフェス

| プロパティ | 型 | 説明 |
|------------|------|------|
| `url` | `string` | SSE エンドポイント URL |
| `withCredentials` | `boolean` | リクエストに資格情報を送信 |
| `events` | `string` | サブスクライブする名前付きイベント（カンマ区切り） |
| `raw` | `boolean` | JSON 自動パースを無効化 |
| `trigger` | `boolean` | 単方向の接続トリガー |
| `manual` | `boolean` | DOM 接続時の自動接続を無効化 |

## `:state()` による CSS スタイリング

`<wcs-sse>` は 3 つの boolean 出力ステートを
[`ElementInternals` の `CustomStateSet`](https://developer.mozilla.org/ja/docs/Web/API/CustomStateSet)
に反映します。そのため `data-wcs` バインディングやクラスの手動トグルなしに、CSS の
`:state()` 疑似クラスで直接スタイリングできます。

| ステート | on になる条件 |
|----------|----------------|
| `connected` | `wcs-sse:connected-changed` が `true` で発火（`false` でクリア） |
| `loading` | `wcs-sse:loading-changed` が `true` で発火（`false` でクリア） |
| `error` | `wcs-sse:error` が非 `null` の detail で発火（`null` でクリア） |

```css
wcs-sse:state(connected) ~ .indicator { color: green; }

wcs-sse:state(loading) ~ .spinner { display: block; }
wcs-sse:state(loading) ~ .spinner { display: none; } /* デフォルト */

form:has(wcs-sse:state(error)) .banner { display: block; }
```

属性やクラスと異なり `:state()` は要素の外部から書き込めないため、この出力ステートが
入力と混同される心配がありません。

**対応ブラウザ**（新構文 `:state(x)`）: Chrome/Edge 125+、Safari 17.4+、Firefox 126+。
非対応の環境ではステートが一切 set されないだけです — `:state()` セレクタがマッチしなく
なりますが、`<wcs-sse>` 自体は通常どおり動作し続けます（graceful degradation・never-throw）。

**SSR:** `:state()` は HTML にシリアライズできないため、サーバーレンダリングされた
マークアップの初期ペイントにはこれらのステートは乗りません（`@wcstack/server` は無改変）。
ハイドレーション前の見た目を制御したい場合は、代わりに `wcs-sse:not(:defined)` と組み合わせてください。

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
  <wcs-sse url="/api/stream" debug-states></wcs-sse>
  ```

**CSS は `data-wcs-state-*` ではなく `:state()` に書いてください。** ミラーされた
属性は、DevTools を開いた状態でステート変化を可視化するためだけのものであり、
スタイリング用の正式なフックではありません。

## アーキテクチャ

`@wcstack/sse` は CSBC アーキテクチャに従います。

### Core: `SseCore`

`SseCore` は純粋な `EventTarget` クラスです。以下を内包します:

- `EventSource` 接続管理
- `message` に集約される名前付きイベントのサブスクリプション
- JSON メッセージパース（`raw` でオプトアウト可能）
- 非同期状態遷移
- 観測可能な状態と呼び出し可能なコマンドの `wc-bindable-protocol` 宣言

`EventTarget` と `EventSource` をサポートする任意のランタイムでヘッドレスに動作します。

### Shell: `<wcs-sse>`

`<wcs-sse>` は `SseCore` の薄い `HTMLElement` ラッパーです。以下を追加します:

- 属性 / プロパティマッピング
- DOM ライフサイクル統合
- `trigger` などの宣言的ヘルパー
- DOM 向け設定のための `wc-bindable-protocol` inputs

### Target injection

Core は **target injection** により Shell 上で直接イベントを発火するため、イベントの再ディスパッチは不要です。

## ヘッドレス利用（Core 単体）

`SseCore` は DOM なしで単体利用できます。`static wcBindable` を宣言しているため、`@wc-bindable/core` の `bind()` で状態をサブスクライブできます:

```typescript
import { SseCore } from "@wcstack/sse";
import { bind } from "@wc-bindable/core";

const core = new SseCore();

const unbind = bind(core, (name, value) => {
  console.log(`${name}:`, value);
});

core.connect("/events", { events: ["price", "trade"] });

// クリーンアップ
core.close();
unbind();
```

`EventTarget` と `EventSource` が利用可能な任意のランタイムで動作します。

## プログラムからの利用

```javascript
const sseEl = document.querySelector("wcs-sse");

// 手動接続
sseEl.connect();

console.log(sseEl.message);    // 最新の { event, data, lastEventId }
console.log(sseEl.connected);  // boolean
console.log(sseEl.loading);    // boolean
console.log(sseEl.error);      // エラー情報 or null
console.log(sseEl.readyState); // EventSource readyState

// 切断
sseEl.close();
```

## 要素一覧

### `<wcs-sse>`

| 属性 | 型 | デフォルト | 説明 |
|------|------|------------|------|
| `url` | `string` | — | SSE エンドポイント URL |
| `with-credentials` | `boolean` | `false` | クロスオリジンで資格情報を送信 |
| `events` | `string` | — | サブスクライブする名前付きイベント（カンマ区切り） |
| `raw` | `boolean` | `false` | JSON 自動パースを無効化 |
| `manual` | `boolean` | `false` | 自動接続を無効化 |

| プロパティ | 型 | 説明 |
|------------|------|------|
| `message` | `WcsSseMessage \| null` | 最新の受信イベント（JSON 自動パース） |
| `connected` | `boolean` | ストリーム接続中は `true` |
| `loading` | `boolean` | 接続中または再接続中は `true` |
| `error` | `Event \| Error \| null` | エラー情報 |
| `readyState` | `number` | `EventSource` readyState 定数 |
| `trigger` | `boolean` | `true` を設定すると接続を開始 |

| メソッド | 説明 |
|----------|------|
| `connect()` | SSE 接続を開く |
| `close()` | 接続を閉じる |

## wc-bindable-protocol

`SseCore` と `<wcs-sse>` はどちらも `wc-bindable-protocol` 契約を宣言しており、プロトコル対応の任意のフレームワーク、アダプタ、remote proxy、ツール層と相互運用できます。

### Core (`SseCore`)

```typescript
static wcBindable = {
  protocol: "wc-bindable",
  version: 1,
  properties: [
    { name: "message",    event: "wcs-sse:message" },
    { name: "connected",  event: "wcs-sse:connected-changed" },
    { name: "loading",    event: "wcs-sse:loading-changed" },
    { name: "error",      event: "wcs-sse:error" },
    { name: "readyState", event: "wcs-sse:readystate-changed" },
  ],
  commands: [
    { name: "connect" },
    { name: "close" },
  ],
};
```

ヘッドレスの利用者は `core.connect(url, options)` を直接呼ぶため、`trigger` は不要です。Core はオプションを `connect()` コマンドで渡すため `inputs` を宣言しません。

### Shell (`<wcs-sse>`)

```typescript
static wcBindable = {
  ...SseCore.wcBindable,
  properties: [
    ...SseCore.wcBindable.properties,
    { name: "trigger", event: "wcs-sse:trigger-changed" },
  ],
  inputs: [
    { name: "url", attribute: "url" },
    { name: "withCredentials", attribute: "with-credentials" },
    { name: "events", attribute: "events" },
    { name: "raw", attribute: "raw" },
    { name: "manual", attribute: "manual" },
    { name: "trigger" },
  ],
  commands: [
    { name: "connect" },
    { name: "close" },
  ],
};
```

## TypeScript 型

```typescript
import type {
  WcsSseMessage, WcsSseCoreValues, WcsSseValues,
  WcsSseInputs, WcsSseCoreCommands, WcsSseCommands
} from "@wcstack/sse";
```

```typescript
// 受信イベント
interface WcsSseMessage<T = unknown> {
  event: string;
  data: T;
  lastEventId: string;
}

// Core（ヘッドレス）— 5 つの非同期状態プロパティ。
// `error` は生の失敗情報: EventSource からの `error` Event、または EventSource
// コンストラクタが投げた Error。SSE のエラーイベントは構造化フィールドを持たないため、
// 生の値をそのまま表面化する（正規化するものがない）。
interface WcsSseCoreValues<T = unknown> {
  message: WcsSseMessage<T> | null;
  connected: boolean;
  loading: boolean;
  error: Event | Error | null;
  readyState: number;
}

// Shell（<wcs-sse>）— Core を拡張し trigger を追加
interface WcsSseValues<T = unknown> extends WcsSseCoreValues<T> {
  trigger: boolean;
}

interface WcsSseInputs {
  url: string;
  withCredentials: boolean;
  events: string;
  raw: boolean;
  manual: boolean;
  trigger: boolean;
}

interface WcsSseCoreCommands {
  connect(url: string, options?: {
    withCredentials?: boolean;
    events?: string[];
    raw?: boolean;
  }): void;
  close(): void;
}

interface WcsSseCommands {
  connect(): void;
  close(): void;
}
```

## 設定

```javascript
import { bootstrapSse } from "@wcstack/sse";

bootstrapSse({
  tagNames: {
    sse: "wcs-sse",
  },
});
```

## 設計メモ

- `message`、`connected`、`loading`、`error`、`readyState` は **出力ステート**
- `url`、`trigger` は **入力 / コマンドサーフェス**。`withCredentials`、`events`、`raw` は接続オプション
- `message` は `{ event, data, lastEventId }` を運ぶため、名前付きイベントが1つのバインド可能プロパティを共有する — state 側で `event` により分岐する
- `trigger` は意図的に単方向: `true` を書き込むと接続、リセットで完了を通知
- JSON ペイロードは受信時に自動パース。リテラルなテキストストリームには `raw` を使う
- 再接続はネイティブ — 再接続の設定はなく、`close()` で停止する
- `manual` は接続タイミングを明示的に制御したい場合に有用
- `wcs-sse:error` は単なる失敗シグナルではなく **プロパティ変更通知**（wc-bindable モデル）です: 失敗時には `detail` = エラーで発火し、接続が確立/回復して `error` プロパティがクリアされると `detail = null` で再度発火します。`error == null` は「過去にエラーが一度もなかった」ではなく「現在エラーがない」と解釈してください

## ライセンス

MIT
