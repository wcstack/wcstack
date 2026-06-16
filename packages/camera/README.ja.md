# @wcstack/camera

Web Components 向けの宣言的な**カメラ取得**（`<wcs-camera>`）と**メディア録画**（`<wcs-recorder>`）。`getUserMedia` + `MediaRecorder` がベース。フレームワーク非依存・ランタイム依存ゼロで、[wc-bindable プロトコル](../../docs)経由で公開します。

> English version: [README.md](./README.md).

## 着想: state を通らない生ハンドル

他のすべての `@wcstack` IO ノードは **シリアライズ可能な値** を state に出し入れします。`MediaStream` は異質です——**生のシリアライズ不能なライブハンドル**で、意味を持つのは参照同一性のみ、「確定」せず、リークが*物理的に観測可能*（カメラのインジケータが消えない）です。

そこで本パッケージは生ストリームを **state の外** に置きます:

- `<wcs-camera>` は shadow root に `<video>` プレビューを内包し、`srcObject` を**内部で**代入します——ハンドルは state 境界を越えません。
- 他の利用者（recorder や外部 `<video>`）へは `wcs-camera:stream-ready` **event-token** で公開し、**command-token の引数**として手渡します——トークンバスを transient に通過するだけで、reactive なパスには書かれません。
- state に入るのは **派生した値** だけです: `active`・`permission`・録画 `Blob`・object URL など。

```html
<wcs-camera data-wcs="
  command.start: $command.camStart;
  eventToken.streamReady: gotStream;
  active: camActive; permission: camPerm"></wcs-camera>

<wcs-recorder data-wcs="
  command.attachStream: $command.feed;
  command.start: $command.recStart;
  command.stop: $command.recStop;
  recording: recording; objectURL: clipUrl;
  eventToken.recorded: onRecorded"></wcs-recorder>
```
```js
$commandTokens: ["camStart", "feed", "recStart", "recStop"],
$eventTokens: ["gotStream", "onRecorded"],
$on: {
  // 生の MediaStream は command 引数として転送するだけ——保存しない。
  gotStream: (state, e) => state.$command.feed.emit(e.detail),
  // 録画 Blob は値——state に入れてよい。
  onRecorded: (state, e) => { state.clipBlob = e.detail.blob; },
}
```

## `<wcs-camera>`

カメラストリームを取得しプレビューを描画します。取得は**明示的**で、`start()`（または `autostart` 属性）でプロンプトします。接続しただけでは取得しません。

**属性:** `facing-mode`（`user`/`environment`）・`device-id`・`audio`（マイクを有効化）・`width`・`height`・`autostart`・`keep-alive`（ページ非表示時に停止しない・録画中に立てる）。

**コマンド:** `start()`・`stop()`・`switchCamera()`（前後カメラ切替）。

**バインド可能な値:** `active`（ストリーム生存）・`permission` / `audioPermission`（`prompt`/`granted`/`denied`/`unsupported`）・`deviceId`・`devices`・`error`。

**イベント（event-token）:** `streamReady`（`wcs-camera:stream-ready`、detail = 生 `MediaStream`）・`error`・`ended`（OS によるトラック剥奪）。`streamReady` の「プロパティ」は event-token 配線用で、値としてバインドしないでください。

### ライフサイクル

- `disconnectedCallback` で全トラックを `track.stop()` し、ハードウェアインジケータを消します。ストリームのリークは本ノード固有の唯一の失敗様式です。
- 制約変更（`device-id`・`facing-mode`・`switchCamera()`）は **再取得**（stop → 新 `getUserMedia`）を起こし、世代カウンタでガードするため、supersede された取得が orphan ストリームを生かしたまま残すことはありません。
- ページ非表示中はストリームを suspend し、復帰時に再取得します——`keep-alive` がある場合を除く。`keep-alive: recording` をバインドすると録画中はカメラを生かし続けられます。

## `<wcs-recorder>`

`attachStream`（カメラの `stream-ready` からの直結チャネル）で受け取った**借用**ストリームを録画します。ストリームを所有・停止することはありません——それはカメラの責務です。

**属性:** `mime-type`・`timeslice`（この間隔で `dataavailable` を出す。省略時は stop で 1 つの `Blob`）・`audio-bits`・`video-bits`。

**コマンド:** `attachStream(stream)`・`start()`・`stop()`・`pause()`・`resume()`。

**バインド可能な値:** `recording`・`paused`・`duration`（ms）・`mimeType`・`blob`・`objectURL`・`error`。

**イベント（event-token）:** `recorded`（`wcs-recorder:recorded`、detail = `{ blob, objectURL, mimeType, duration }`）・`dataavailable`（`timeslice` モードのみ）・`error`。

組み立てた `Blob` は structured-clone 可能なので *値* であり、state に流せます——例えば `new File([blob], "clip.webm")` を [`@wcstack/upload`](../upload/) へ。object URL は管理され、新しいクリップ前と dispose 時に前の URL を revoke します。

## ヘッドレス Core

`CameraCore` / `RecorderCore` を非 DOM 用途向けにエクスポートしています（`@wc-bindable/core` の `bind()`）。Shell は薄いラッパです。

## 注意・落とし穴

- **セキュアコンテキスト（https）必須。** `getUserMedia` は `file://` / 素の `http://` では使えません。
- **カメラインジケータ＝リーク検出器。** 終了後も点灯したままなら、トラックが停止されていません。
- **ユーザージェスチャ。** 一部ブラウザは `getUserMedia` をユーザー操作起点で要求します。タイマーから撃つと無言で失敗することがあります（`error` に出ます・throw しません）。
- **エラーは分類され throw されません:** `NotAllowedError`（拒否）・`NotFoundError`（デバイス無し）・`NotReadableError`（他アプリ使用中）・`OverconstrainedError`。
- **ストリームの所有権はカメラ側。** recorder は借用するだけ。録画中のカメラ切替は非対応（先に録画停止）。
- **mimeType の対応はブラウザ差**（webm/mp4）。非対応の `mime-type` は無視され既定が使われます。

## インストール

```html
<script type="module" src="https://esm.run/@wcstack/camera/auto"></script>
```

またはプログラムから:

```js
import { bootstrapCamera } from "@wcstack/camera";
bootstrapCamera();
```

MIT © mogera551
