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
- **1 行の永続化**: `<wcs-storage key="wcs-color-palette" type="local" data-wcs="value#init=element: palette">` の双方向バインド 1 本で、接続時ロード・代入時セーブ・タブ間同期（ネイティブ `storage` イベント）がすべて付いてきます。2 タブで開いて色を採ってみてください。
- **リスト差分描画**: パレットは正規化 getter `list` 上の `for:` テンプレートです。変更は常に配列の置換で行い、それが再描画と自動セーブの両方のトリガーになります。
- **load-before-bind を `#init=element` で解決**: storage ノードは自身の `connectedCallback` で永続値をロードして通知しますが、これはバインディング確立*前*に起こりえます。`value` は双方向メンバなので既定 authority は `state` で、放置すると初期 apply が state 側のシード値を書き戻し、永続パレットをリロードのたびに潰します。`#init=element` は初期同期の authority を要素側に倒し、初期書き込みを行わずロード済みの値を `palette` へ pull します。支配するのは初期同期のみなので、以後の代入による自動セーブは生きたままです。

## 配線のポイント

```html
<wcs-eyedropper
  data-wcs="loading: picking; command.open: $command.pick; eventToken.value: colorPicked"></wcs-eyedropper>

<wcs-clipboard
  data-wcs="error: clipboardError; command.writeText: $command.copy"></wcs-clipboard>

<wcs-storage key="wcs-color-palette" type="local"
  data-wcs="value#init=element: palette; error: storageError"></wcs-storage>
```

- サポート判定はあえてページ側で行います: eyedropper ノードに `supported` フラグはなく、`typeof EyeDropper === "function"` そのものがフラグです。
- clipboard の `copied` event token をここで使わないのは意図的です: あれは *monitor*（`startMonitor()` によるユーザーの Ctrl+C）用で、`writeText()` の完了通知ではありません。
