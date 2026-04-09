# state + websocket demo

`@wcstack/state` と `@wcstack/websocket` を組み合わせた、リアルタイム通信のローカルデモです。
サーバー側に Echo / Broadcast の WebSocket エンドポイントを内蔵しています。

## 使用パッケージ

- `@wcstack/state` — CDN (`esm.run`) 経由
- `@wcstack/websocket` — CDN (`esm.run`) 経由

## 起動手順

```bash
# 1. 共有 WebSocket サーバーの依存をインストール
cd examples/shared/websocket && npm install && cd ../../..

# 2. 起動
node examples/state-websocket/server.js
```

ブラウザで `http://localhost:3300` を開いてください。
複数タブを開くとブロードキャストの動作を確認できます。

## 環境変数

- `PORT`: 任意。既定値は `3300`

## WebSocket プロトコル

サーバーは `/ws` パスで WebSocket 接続を受け付けます。

### 受信メッセージ形式

```json
{ "type": "echo", "content": "送信テキスト" }
{ "type": "broadcast", "content": "配信テキスト", "from": "nickname" }
```

### 送信メッセージ形式

| type | 説明 |
|------|------|
| `echo` | エコー応答。`{ content, timestamp }` |
| `broadcast` | 全クライアントに配信。`{ content, from, timestamp }` |
| `stats` | 3秒ごと。`{ clients, uptime }` |

## このデモで確認できること

- `<wcs-ws>` の `message` / `connected` / `loading` / `error` を `<wcs-state>` に束縛
- `send` プロパティを使った state 起点のメッセージ送信
- `auto-reconnect` による自動再接続
- JSON メッセージの自動パース
- メッセージ種別ごとの条件分岐表示（`for:` + `if:` + `eq` フィルタ）
- リアルタイムなクライアント数・アップタイムの表示
