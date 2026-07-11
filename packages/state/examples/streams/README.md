# `$streams` — fetch body streaming デモ

**`@wcstack/state`** の `$streams`（外部の async producer を fold して reactive プロパティに適合させる core 拡張）のデモ。チャンク送出される HTTP レスポンス本文（`response.body`）を `TextDecoderStream` で文字列化し、`fold` でテキストとして累積表示します。

## はじめに

`$streams` は未リリースのため、CDN（`https://esm.run/@wcstack/state/auto`）ではなく**ローカルビルド**を読み込みます。server.js が `packages/state/dist` を `/state-dist/` で配信するので、先にビルドしてください。

```bash
cd packages/state
npm run build                      # dist を生成（$streams を含むローカルビルド）
node examples/streams/server.js    # ポート 3000（PORT 環境変数で変更可）
```

ブラウザで http://localhost:3000/streams/ を開きます（`/` は examples ギャラリー）。

## 見どころ

- **依存駆動 restart（switchMap）** — prompt の `<input>`（two-way `value: prompt`）を `args` が読んでいるため、1 キーストロークごとに旧 run が AbortSignal で abort され、`story` が `initial` にリセットされて新しい args で張り直されます。
- **再試行 = 依存の叩き直し** — 自動再接続はありません。**Regenerate** ボタンは `seed` をインクリメントするだけ（`args` が読む依存パスへの書き込み）。`done` / `error` からも同じ操作で再起動します。
- **コンパニオン名前空間** — ステータスチップは `$streamStatus.story` を HTML で直接 binding。JS 側の getter は dotted ブラケット形 `this["$streamStatus.story"]` で読みます（依存捕捉される正規形）。
- **error 時の直前値保持** — prompt に `error` を含めるとサーバーが途中で切断します。`$streamStatus.story` が `error` になり `$streamError.story` にエラーが格納されますが、**累積済みのテキストはリセットされません**。

## ポイント

- **協調キャンセル契約** — `source` は渡された AbortSignal を必ず尊重すること（MUST）。この例では `fetch(url, { signal })` に渡すだけで、restart / 切断時に HTTP リクエストごと中断されます。server.js 側もクライアント abort（`close`）で送出を止めるので、restart を連打してもサーバーの仕事は積み上がりません。
- **有界 fold 規範** — この例の全文累積（`(acc, chunk) => acc + chunk`）は**有限ストリームだから**許されます。無限 / 長寿命ストリームでは latest・last-N・ウィンドウ集計など有界な fold を使ってください。
- **ReadableStream の消費** — `source` は `AsyncIterable` / `ReadableStream`（またはその Promise）を返せます。`Symbol.asyncIterator` を持たない ReadableStream は `getReader()` フォールバックで消費されます。
- **fold は新しい値を返す** — 文字列連結は毎回新しい値になるのでこの規範（in-place 変異の禁止）を自然に満たします。

> 設計はリポジトリルートの `docs/state-streams-design.md`、実装は `packages/state/src/stream/` を参照してください。
