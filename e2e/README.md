# wcstack e2e — examples 実ブラウザ smoke テスト

`examples/` のデモアプリを実ブラウザ (Chromium / Playwright) で開き、
**ローカルの `packages/*/dist` バンドル**でバインディングが実際に動くことを検証する smoke テストです。
全パッケージの単体テストは happy-dom 上で動くため、「本物のブラウザで custom element +
`data-wcs` バインディングが end-to-end で機能するか」はここでのみ検証されます。

## 実行方法

```bash
cd e2e
npm ci                                   # 依存インストール (初回のみ)
npx playwright install chromium          # ブラウザインストール (初回のみ)
npm test
```

静的サーバーは Playwright の `webServer` 設定 (`playwright.config.ts`) が自動起動します。
手動でページを確認したい場合は `npm run serve` で `http://127.0.0.1:4173/examples/<name>/` を開けます。

各テストは共通して次を検証します:

1. ページを開き、`pageerror`(未捕捉例外) と `console.error` を収集する
2. バインディングが動いた証拠となる UI (フェッチ結果の一覧行・ステータス文言など) の描画を待つ
3. 収集したエラーが 0 件であることを assert する

## CDN → ローカル書き換えの仕組み

examples の `index.html` は `https://esm.run/@wcstack/*` (CDN) を参照していますが、
テストは「現在のワーキングツリー」を検証しなければなりません。そこで `serve.mjs`
(依存ゼロ、`node:http` のみ) がリポジトリルートを配信し、**HTML レスポンスのみ**を
次のルールで書き換えます (他のアセットは素通し、examples のファイル自体は変更しません):

| HTML 内の参照 | 書き換え先 |
|---|---|
| `https://esm.run/@wcstack/<pkg>/auto` | `/packages/<pkg>/dist/auto.min.js` |
| `https://esm.run/@wcstack/<pkg>` | `/packages/<pkg>/dist/index.esm.min.js` |

正規表現はインライン import map 内の URL にもそのまま適用されます (`@version` ピンは除去)。
`auto.min.js` は `./index.esm.min.js` を相対 import するため、`dist/` 配下からの配信で
そのまま解決されます。**dist はコミット済みのものを使う**ので、パッケージのソースを変更した
場合は該当パッケージで `npm run build` してから実行してください。

また、examples の一部は自前の `server.js` (port 3000 固定・同時起動不可) で `/api/*` を
提供するため、`serve.mjs` が同形のモック API (`/api/search`, `/api/users`) を最小フィクスチャで
代替しています (レスポンス形状は `examples/*/server.js` に準拠、人工遅延なし)。

## 対象 / スキップ examples

### テスト対象 (3)

| example | 検証内容 |
|---|---|
| `state-search` | state + fetch + debounce。初期全件フェッチの一覧描画、`locale` フィルタ、eventToken のリクエストカウンタ、入力 → 300ms デバウンス → 再フェッチの絞り込み |
| `state-fetch` | state + fetch。一覧 auto-fetch、行クリック → computed url → 詳細フェッチ、manual POST → 成功バナー → command-token による一覧リロード |
| `state-cross-tab-todo` | state + storage + broadcast。2 ページ (=2 タブ) 間で localStorage 経由のリスト同期と BroadcastChannel 経由の live シグナル |

### スキップ (13)

dist が存在しないためスキップした example はありません (vscode-wcs を除く全パッケージに dist あり)。
スキップ理由はすべて実行環境の制約です:

| example | 理由 |
|---|---|
| `react-websocket` / `vue-websocket` | Vite ビルド + WebSocket サーバーが必要 (CDN 参照でない) |
| `state-websocket` | WebSocket サーバー (`server.js`) が必要 |
| `signals-live-search` | 自前 `server.js` が import map 用ローカルパス (`/signals/*`) を配信する前提 |
| `ssr` | サーバーサイドレンダリング構成 (静的配信モデル外) |
| `state-camera-record-upload` | カメラデバイス + `getUserMedia` 権限が必要 |
| `state-notification-chat` | Notification 権限 + OS 通知が必要 |
| `state-permission-banner` | Geolocation 権限が必要 |
| `state-speak-highlight` / `state-speech-echo` | SpeechSynthesis / SpeechRecognition (headless では音声環境なし) |
| `state-defined-loader` | 追加候補 (API 不要の静的構成。未対象なだけで技術的障害なし) |
| `state-infinite-scroll` / `state-intersect-scroll` | 追加候補 (各 `server.js` の API をモックすれば対象化可能) |

## CI

`.github/workflows/e2e.yml` が `examples/**`・`packages/**/dist/**`・`e2e/**` に触れる
pull request と `workflow_dispatch` で実行されます。
