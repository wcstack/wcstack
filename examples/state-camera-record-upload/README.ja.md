# camera → record → upload デモ

`@wcstack/state` + `@wcstack/permission` + `@wcstack/camera`（`<wcs-camera>` / `<wcs-recorder>`）+ `@wcstack/upload`。カメラのプレビュー → クリップ録画 → 再生 → アップロードまでを一本道で繋ぐデモ。しかも **生の `MediaStream` は一切 state を通りません**。

## はじめに

セキュアコンテキスト（`localhost` または `https://`）で `index.html` を開いてください。`file://` では `getUserMedia` がプロンプトしません。ビルド不要——すべて `esm.run` から読み込みます。

## 何を示すか

- **`<wcs-camera>` がプレビューを所有。** ストリームを取得し `<video>` を内部で描画します（`srcObject` を shadow root 内で代入）。シリアライズ不能なハンドルは state 境界を越えません。
- **直結チャネル。** `stream-ready` で生の `MediaStream` を **command-token の引数**として `<wcs-recorder>` に手渡します——`$command.feedRecorder.emit(event.detail)`——トークンバスを transient に通過するだけ。reactive な state パスには代入されず、state に入るのは派生値（`active`・`recording`・録画 `Blob`・object URL）だけです。
- **録画 `Blob` → upload（無改変）。** 録画クリップは確定した `Blob`（値）なので、`File` に包んで既存の `<wcs-upload>` ノードへバインド——IO ノードのパイプラインが通常の値レールに合流します。

## ポイント

- **`keep-alive: recording`** —— 可視性と録画の問題への一行の宣言的な解。`recording` が true の間はタブが非表示でもカメラを生かし、そうでなければ非表示で suspend・復帰で再取得します。
- **2 つの役割・2 つの要素。** `<wcs-permission name="camera">` は許可を純粋な state として*監視*し、`<wcs-camera>` が `getUserMedia` で*取得*（プロンプト）します。
- **ストリームの所有権はカメラ側。** recorder はストリームを*借用*しトラックを止めません。解放するのはカメラだけ（停止 / 切断時）で、ハードウェアインジケータを消します。
