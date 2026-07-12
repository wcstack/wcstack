# state + sse + network デモ（ライブメトリクス・2 つの流儀）

1 本の Server-Sent Events フィードを、同じページで 2 通りに消費します:

- **左パネル** — `<wcs-sse>`: *タグ*が接続を所有します。名前付きイベントは `eventToken.message` で state に流れ、`$on` ハンドラで畳み込みます。
- **右パネル** — `$streams`: *state* が接続を所有します。`EventSource` を async iterable にブリッジし、単一のリアクティブプロパティに fold します。

`<wcs-sse>` と `$streams` は同じ仕事を取り合う競合手段です。だからこのデモはあえて両者を**並置**し、直列にはつなぎません — どちらをいつ選ぶかを見せるのが主題です。

## 起動方法

```bash
node examples/state-sse-dashboard/server.js
```

http://localhost:3000 を開いてください。3 パッケージ（`state` / `sse` / `network`）はすべて CDN からロードします — `$streams` は v1.19.0 でリリース済みのため、ローカルビルドは不要です。

## 見せ場: ホスト切り替え

**host A / host B** ボタンでフィードが切り替わります。両パネルとも再接続しますが:

- 左パネルの履歴リセットは `setHost()` 内の**手書き 3 行**です（`sseUrl` が変わればタグは勝手に再接続しますが、state に fold した履歴は勝手には消えません）。
- 右パネルには**その 3 行が存在しません**: `args: (state) => ({ host: state.host })` が依存を捕捉しているので、`host` への書き込みが旧 `EventSource` を abort し、fold を `initial` から再開します（switchMap セマンティクス）。

## その他の見どころ

- **名前付き SSE イベント**: `events="metric,deploy"` はすべての名前付きイベントを単一の `message` 出力に集約します。どれが発火したかは `message.event` が教えてくれます。時折届く `deploy` イベントが左パネルのバナーを駆動します。
- **有界 fold**: 両パネルとも last-20 窓＋累計カウントだけを保持します。このスタックは backpressure を明示的に放棄しているため、長寿命ストリームでは**有界**の集約が契約です。
- **ネイティブ再接続**: `<wcs-sse>` は再接続ロジックを持ちません — サーバーを落として再起動すると、`EventSource` が自力で復帰するのが見えます（`retry: 3000` ヒントはストリーム側から送っています）。
- **network タイル**: `<wcs-network>` は Network Information API の純粋なモニタです — 接続の*品質*（`effectiveType` / `downlink` / `rtt` / `saveData`）であって online/offline ではありません。属性もコマンドもありません。初期スナップショットは接続時に同期 dispatch されるため、ページ側は `$connectedCallback` で現在値を一度 pull し、以降の変化はバインディング経由で受けます。
