# Vue + wcstack websocket demo

Vue 3 アプリ内で `<wcs-ws>` Web Component を `@wc-bindable/vue` アダプター経由で使う、フレームワーク相互運用デモです。
サーバー側に Echo / Broadcast の WebSocket エンドポイントを内蔵しています。

## このデモが示すこと

**`<wcs-ws>` はポータブルな IO ノードです。** WebSocket の接続管理・再接続・メッセージングといった IO 処理を、フレームワークに依存しない単一の Custom Element に閉じ込めています。従来、WebSocket を Vue で扱うには Vue 専用のライブラリか生の WebSocket API の二択でしたが、`<wcs-ws>` は薄いアダプター (`@wc-bindable/vue`) を介して**状態購読**という統一的な形で利用できます。IO ノード自体はフレームワークを問わずポータブルであり、同じ `<wcs-ws>` が React でも素の HTML でもそのまま動作します。

### 注目ポイント: 非同期処理を書いていない

WebSocket は本質的に非同期な通信ですが、このデモのアプリケーションコードには **`await`、`Promise`、`Suspense`、`async` 関数が一切登場しません。**

通常、Vue で WebSocket を扱うには以下のような非同期処理が付きまといます:

- 接続の確立・切断を `onMounted` / `onUnmounted` のライフサイクルフックで管理
- メッセージ受信を `addEventListener` や `onmessage` コールバックで購読
- 再接続ロジック（タイマー、バックオフ、リトライ上限）の自前実装
- 接続状態を `Suspense` や loading state で UI に反映

`<wcs-ws>` はこれらを **Web Component の内部に閉じ込めて** います。アプリケーション側から見ると、WebSocket の非同期性は完全に隠蔽され、`ws.connected` や `ws.message` といった**同期的なリアクティブプロパティの読み取り**だけで済みます。

```vue
<script setup>
// これだけで WebSocket の全状態が Vue リアクティブ state に同期される
const { ref: wsEl, values: ws } = useWcBindable({
  message: null,
  connected: false,
  loading: false,
  error: null,
});
</script>

<template>
  <!-- テンプレート内では同期的な値として扱うだけ -->
  <p>{{ ws.connected ? 'Connected' : 'Disconnected' }}</p>
  <p>{{ ws.message?.content }}</p>
</template>
```

つまり `<wcs-ws>` は、WebSocket という非同期処理を**状態機械の購読**という形に変換しています。アプリケーションは非同期のイベントストリームを扱う代わりに、状態機械が公開するプロパティを購読するだけで済みます。非同期の複雑さは `<wcs-ws>` が吸収し、Vue アプリケーションは**同期的な値の表示に専念**できます。

## スタック

| レイヤー | 技術 |
|---------|-----|
| UI | Vue 3 + SFC (`<script setup>`) |
| ビルド | Vite |
| アダプター | `@wc-bindable/vue` |
| WebSocket | `@wcstack/websocket` (`<wcs-ws>`) |
| サーバー | Node.js + ws |

## 起動手順

```bash
# 1. 共有 WebSocket サーバーの依存をインストール
cd examples/shared/websocket && npm install && cd ../../..

# 2. 依存インストール & ビルド
cd examples/vue-websocket && npm install && npm run build && cd ../..

# 3. サーバー起動
node examples/vue-websocket/server.js
```

ブラウザで `http://localhost:3302` を開いてください。
複数タブを開くとブロードキャストの動作を確認できます。

### 開発モード

```bash
cd examples/vue-websocket
npm run dev
```

Vite dev サーバーが HMR 付きで起動します。WebSocket サーバーは別途起動が必要です。

## 環境変数

- `PORT`: 任意。既定値は `3302`

## @wc-bindable による Vue での使い方

```vue
<script setup>
import { useWcBindable } from "@wc-bindable/vue";

const { ref: wsEl, values: ws } = useWcBindable({
  message: null,
  connected: false,
  loading: false,
  error: null,
});
</script>

<template>
  <wcs-ws ref="wsEl" url="ws://..." auto-reconnect />
  <p>Status: {{ ws.connected ? 'Connected' : 'Disconnected' }}</p>
</template>
```

## WebSocket プロトコル

[state-websocket example](../state-websocket/README.ja.md#websocket-プロトコル) と同じです。

## このデモで確認できること

- Vue SFC テンプレート内での `<wcs-ws>` 直接利用
- `useWcBindable()` による自動プロパティ同期 — 手動イベントリスナー不要
- `send` プロパティセッターを使ったメッセージ送信
- `auto-reconnect` による自動再接続
- リアルタイムなクライアント数・アップタイム表示
- 標準的な Vite + Vue ビルドパイプライン（SFC、バンドル、ミニファイ）
