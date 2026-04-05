# Vue + wcstack websocket demo

Vue 3 アプリ内で `<wcs-ws>` Web Component を `@wc-bindable/vue` アダプター経由で使う、フレームワーク相互運用デモです。
サーバー側に Echo / Broadcast の WebSocket エンドポイントを内蔵しています。

## このデモが示すこと

**Web Components はどのフレームワークでも動く。** `<wcs-ws>` カスタム要素は [wc-bindable プロトコル](https://github.com/user/wc-bindable-protocol) を実装しています。`@wc-bindable/vue` アダプターの `useWcBindable()` コンポーザブルにより、全バインド可能プロパティが自動的に Vue リアクティブ state に同期されます。手動の `addEventListener` は不要です。

## 使用するもの

- Vue 3（esm.sh 経由の ESM、ビルド不要）
- `@wc-bindable/vue` アダプター
- `/packages/websocket/dist/auto.js`

## 起動手順

```bash
# 1. websocket パッケージをビルド
cd packages/websocket && npm run build && cd ../..

# 2. サーバー依存をインストール
cd examples/vue-websocket && npm install && cd ../..

# 3. 起動
node examples/vue-websocket/server.js
```

ブラウザで `http://localhost:3302` を開いてください。
複数タブを開くとブロードキャストの動作を確認できます。

## 環境変数

- `PORT`: 任意。既定値は `3302`

## @wc-bindable による Vue での使い方

```js
import { useWcBindable } from "@wc-bindable/vue";

setup() {
  // wc-bindable プロパティが自動的に同期される
  const { ref: wsEl, values: ws } = useWcBindable({
    message: null,
    connected: false,
    loading: false,
    error: null,
  });

  // ws.connected, ws.message 等はライブな Vue リアクティブ state
  return { wsEl, ws };
}
```

```html
<wcs-ws ref="wsEl" url="ws://..." auto-reconnect />
<p>Status: {{ ws.connected ? 'Connected' : 'Disconnected' }}</p>
```

## WebSocket プロトコル

[state-websocket example](../state-websocket/README.ja.md#websocket-プロトコル) と同じです。

## このデモで確認できること

- Vue テンプレート内での `<wcs-ws>` 直接利用
- `useWcBindable()` による自動プロパティ同期 — 手動イベントリスナー不要
- `send` プロパティセッターを使ったメッセージ送信
- `auto-reconnect` による自動再接続
- リアルタイムなクライアント数・アップタイム表示
- 完全 ESM、ビルドレス（Import Maps + esm.sh）
