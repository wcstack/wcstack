# state + eyedropper + clipboard + storage デモ（カラーパレット）

`@wcstack/state`・`@wcstack/eyedropper`・`@wcstack/clipboard`・`@wcstack/storage` を組み合わせたカラーパレットです。**画面上のどこからでも**色を採取し、スウォッチをクリックすると hex がクリップボードにコピーされ、パレットはリロードをまたいで永続化 — タブ間でも同期します。

## 起動方法

パッケージは CDN（[esm.run](https://esm.run)）からロードするため、バックエンドもビルドも不要です。`http://localhost`（または HTTPS）の静的サーバーなら何でも動きます。

```bash
npx serve examples/state-color-palette
```

EyeDropper API は **Chromium 限定**（Chrome / Edge）です。他のブラウザには `<input type="color">` のフォールバックがあり、デモの残りの部分はそのまま動きます。

## 見どころ

- **command → event の往復**: `command.open` で OS のピッカーを起動し、採取した色は `value` event token として `{ sRGBHex }` で戻ってきます。Esc キャンセルは静かに `cancelled` に落ち、`error` にはなりません。
- **引数素通しコピー**: スウォッチのクリックハンドラはワイルドカードパス `this["list.*.hex"]` で自分の行を解決して emit します — `$command.copy.emit(hex)` の引数はそのまま `writeText(hex)` に渡ります（command-token の引数素通し）。`writeText` は設計上 fire-and-forget（成功イベントなし）で、失敗は `error` 出力に現れます。
- **1 行の永続化**: `<wcs-storage key="wcs-color-palette" type="local" data-wcs="value: palette">` の双方向バインド 1 本で、接続時ロード・代入時セーブ・タブ間同期（ネイティブ `storage` イベント）がすべて付いてきます。2 タブで開いて色を採ってみてください。
- **リスト差分描画**: パレットは正規化 getter `list` 上の `for:` テンプレートです。変更は常に配列の置換で行い、それが再描画と自動セーブの両方のトリガーになります。
- **load-before-bind ガード**: storage ノードは自身の `connectedCallback` で永続値をロードして通知しますが、これはバインディング確立*前*に起こりえます — このとき state 初期値が `null`/`[]` だと、双方向バインディング経由で書き戻されて永続パレットをリロードのたびに潰してしまいます。このデモは `palette` を `undefined` で開始し（プロパティ書き込みがスキップされる「無意見」セマンティクス）、ロード済みの値を `$connectedCallback` で一度だけ pull します。

## 配線のポイント

```html
<wcs-eyedropper
  data-wcs="loading: picking; command.open: $command.pick; eventToken.value: colorPicked"></wcs-eyedropper>

<wcs-clipboard
  data-wcs="error: clipboardError; command.writeText: $command.copy"></wcs-clipboard>

<wcs-storage key="wcs-color-palette" type="local"
  data-wcs="value: palette; error: storageError"></wcs-storage>
```

- サポート判定はあえてページ側で行います: eyedropper ノードに `supported` フラグはなく、`typeof EyeDropper === "function"` そのものがフラグです。
- clipboard の `copied` event token をここで使わないのは意図的です: あれは *monitor*（`startMonitor()` によるユーザーの Ctrl+C）用で、`writeText()` の完了通知ではありません。
