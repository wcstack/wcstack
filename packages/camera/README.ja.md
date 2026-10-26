# @wcstack/camera

> 🤖 **AI coding agents**: This README is a package-level reference, not the primary entry point for building a wcstack application. If you have not already done so, first read the repository [README](https://github.com/wcstack/wcstack#readme) and [AGENTS.md](https://github.com/wcstack/wcstack/blob/main/AGENTS.md), then use the [wcstack-app skill](https://github.com/wcstack/wcstack-skill).

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

**`null` と `undefined`。** 入力（`audio`・`facingMode`・`deviceId`・`width`・`height`・`autostart`・`keepAlive`）はすべて属性に対応し、`null` を「クリア」として扱います。属性を外し、入力は既定値に戻ります（`facingMode` は `user`、デバイス指定なし、幅・高さの制約なし、boolean は off）。`undefined` は「値が無い」で、属性を最初の書き込みの前の状態 — マークアップに書かれた値、無ければ属性なし — に戻します。どちらも文字列 `"null"` / `"undefined"` として書くことはなく、どのカメラにも一致しない `deviceId` の exact 制約になることもありません（`@wcstack/state` は `undefined` を書きませんが、React 19 は値のあった prop を外したときに書き、直接の代入でも届きます）。

**コマンド:** `start()`・`stop()`・`switchCamera()`（前後カメラ切替）。

**バインド可能な値:** `active`（ストリーム生存）・`permission` / `audioPermission`（`prompt`/`granted`/`denied`/`unsupported`。4.5 から、このページでカメラ／マイクを使えないとき — secure context でない、Permissions-Policy が切っている — も `unsupported`。そのとき `start()` はブラウザに聞かず、`errorInfo` は理由付きの `capability-missing`）・`deviceId`（ストリームが使っているデバイス。`wcs-camera:device-changed` で publish。プロパティを読むと、決まった後はこの値、それまでは要求した `device-id` を返す。要求そのものは属性に残る）・`devices`（映像入力の一覧。`[{ deviceId, label, groupId, kind: "videoinput" }]`。許可されるまで label は空）・`error`・`errorInfo`（`WcsIoErrorInfo | null`——`error` から派生するシリアライズ可能な失敗分類。`wcs-camera:error-info-changed` で publish。下記「注意・落とし穴」参照）。

**イベント（event-token）:** `streamReady`（`wcs-camera:stream-ready`、detail = 生 `MediaStream`）・`error`・`ended`（OS によるトラック剥奪）。`streamReady` の「プロパティ」は event-token 配線用で、値としてバインドしないでください。

### ライフサイクル

- `disconnectedCallback` で全トラックを `track.stop()` し、ハードウェアインジケータを消します。ストリームのリークは本ノード固有の唯一の失敗様式です。4.5 から、`active` も `false` に戻し、`wcs-camera:active-changed` で知らせます。ルートを離れた要素は、次に入るときのためにノードを束縛ごと残すので（router の README「ルートの中身の置き場所」）、4.4 までは戻ってきたページがカメラが動いていると表示し続け、`active` の間は押せない開始ボタンも押せないままでした。
- 要素を DOM 内で移動（remove → 再 append）すると `disconnectedCallback`（dispose・トラック停止）の後に `connectedCallback`（再 observe）が走ります。`autostart` 付きなら reconnect 時に再取得します（再プロンプトの可能性あり）。移動をまたいでストリームを維持したい場合は `autostart` を使わず自分で再 `start()` するか、要素を detach しないでください。
- 制約変更（`device-id`・`facing-mode`・`switchCamera()`）は **再取得**（stop → 新 `getUserMedia`）を起こし、世代カウンタでガードするため、supersede された取得が orphan ストリームを生かしたまま残すことはありません。
- ページ非表示中はストリームを suspend し、復帰時に再取得します——`keep-alive` がある場合を除く。`keepAlive: recording` をバインドすると録画中はカメラを生かし続けられます。suspend したストリームの録画はそこで終わり、それまでの分がクリップになります。4.5 から、`<wcs-recorder>` が録画中のストリームを suspend するとき、カメラが警告します（`[wcs/camera-keep-alive-missing]`、1 要素につき 1 回）。

## `<wcs-recorder>`

`attachStream`（カメラの `stream-ready` からの直結チャネル）で受け取った**借用**ストリームを録画します。ストリームを所有・停止することはありません——それはカメラの責務です。

**属性:** `mime-type`・`timeslice`（この間隔で `dataavailable` を出す。省略時は stop で 1 つの `Blob`）・`audio-bits`・`video-bits`。

**`null` と `undefined`** は `<wcs-camera>` と同じです。入力 `mimeType`（要求）・`timeslice`・`audioBitsPerSecond`・`videoBitsPerSecond` では、`null` は属性を外し（何も要求せず、ブラウザが選びます）、`undefined` はマークアップに書かれた属性、無ければ属性なしに戻します。どちらも文字列として書くことはありません。

**コマンド:** `attachStream(stream)`・`start()`・`stop()`・`pause()`・`resume()`。

**バインド可能な値:** `recording`・`paused`・`duration`（ms・下記注記参照）・`mimeType`（**解決後**の録画タイプ。要求した `mime-type` 属性と異なる、または未指定時にブラウザが補完した値）・`blob`・`objectURL`・`error`・`errorInfo`（`WcsIoErrorInfo | null`——`error` から派生するシリアライズ可能な失敗分類。`wcs-recorder:error-info-changed` で publish。下記「注意・落とし穴」参照）。

**イベント（event-token）:** `recorded`（`wcs-recorder:recorded`、detail = `{ blob, objectURL, mimeType, duration }`）・`dataavailable`（`timeslice` モードのみ）・`error`。

> **`duration` は stop/pause で確定する値で、録画中はライブ更新しません。** 内部に経過タイマーは持たないため、`start()` から最初の `pause()`／`stop()` までは `0` のままです。録画中の経過時間を表示したい場合は `recording` フラグを起点にクライアント側でタイマーを回してください。

> **`mimeType` は「要求」と「解決後」の二面を持ちます。** **入力**は `mime-type` *属性*（recorder に使ってほしいタイプの要求）、**出力**は `mimeType` *バインド可能値*（ブラウザが実際に選んだタイプ。`wcs-recorder:mimetype-changed` で publish）です。基底名を共有しますが別サーフェスで、属性側で要求を設定し（`mime-type` 属性／要素 setter）、値プロパティ側で解決後タイプを読みます。`mimeType` を読んでも書いた値はエコーされません——録画結果を反映します。
>
> 宣言は `mimeType` を入力にも出力にも挙げているので、`@wcstack/state` は `mimeType: path` を双方向として扱います。双方向の束縛は、まず state の値を要素に書きます。初期値が `null` なら `mime-type` が外れ、型はブラウザが選びます。要求に触れずに解決後のタイプを読むには `mimeType#init=element: path` と書いてください。
>
> Chromium は録画を始めるときにタイプを決めます（タイプを指定せずに作った `MediaRecorder` は、それまで `""` を返します）。4.4 までは、`mime-type` が無いとクリップの `Blob` に型が無く、`mimeType` も `""` のままで、型を確かめるサーバや `<wcs-upload accept="video/*">` がクリップを拒みました。4.5 から、`mimeType` は録画を始めたときのタイプ（無ければ最初のチャンクのタイプ）になり、`Blob` もその型を持ちます。

組み立てた `Blob` は structured-clone 可能なので *値* であり、state に流せます——例えば `new File([blob], "clip.webm", { type: blob.type })` を [`@wcstack/upload`](../upload/) へ。object URL は管理され、新しいクリップ前と **`disconnectedCallback`（dispose）時** に前の URL を revoke します。

**録画中に文書から外れたとき**（ルートを離れた、`if:` の枝が閉じた）: 4.4 までは録画を捨て、`recorded` も出さず、state の `recording` は `true` のままでした。4.5 から、ストリームのトラックが終わったときと同じく録画を止めます。`recording` / `paused` はその場で `false` に戻してイベントで知らせ、クリップはブラウザが渡したとき（少し後）に `wcs-recorder:recorded` で届きます。その `objectURL` は、次のクリップか次の切断まで有効です。

> **`objectURL` の寿命は recorder に束縛されます。** dispose が最後の object URL を revoke し、**さらに次の録画は前のクリップの URL を新規発行前に revoke する**ため、古い URL を指したままの `<video src>` / `<wcs-upload>` は `<wcs-recorder>` が外れる・次のクリップが完成した時点で壊れます。常に最新の `objectURL` / `recorded` 値を追従し、古い URL を保持しないでください。URL を寿命の長い消費側へ渡す場合は、URL を使い終わるまで recorder を接続したままにするか、`Blob` から自前で URL を作り（`URL.createObjectURL(blob)`）revoke も自分で管理してください。structured-clone 可能な **`blob`** にはこの結合がありません——`Blob` を state に流し、利用箇所で URL を生成するのが安全です。

## `:state()` による CSS スタイリング

`<wcs-camera>` と `<wcs-recorder>` は boolean 出力ステートを
[`ElementInternals` の `CustomStateSet`](https://developer.mozilla.org/ja/docs/Web/API/CustomStateSet)
に反映します。そのため `data-wcs` バインディングやクラスの手動トグルなしに、CSS の
`:state()` 疑似クラスで直接スタイリングできます。

| 要素 | ステート | on になる条件 |
|------|----------|----------------|
| `wcs-camera` | `active` | `wcs-camera:active-changed` が `true` で発火（`false` でクリア） |
| `wcs-camera` | `error` | `wcs-camera:error` が非 `null` の detail で発火（`null` でクリア） |
| `wcs-recorder` | `recording` | `wcs-recorder:recording-changed` が `true` で発火（`false` でクリア） |
| `wcs-recorder` | `paused` | `wcs-recorder:paused-changed` が `true` で発火（`false` でクリア） |
| `wcs-recorder` | `error` | `wcs-recorder:error` が非 `null` の detail で発火（`null` でクリア） |

> `permission` / `audioPermission` には現時点で boolean 派生 getter が無いため
> 反映対象外です（v1 スコープ。docs/custom-state-reflection-design.ja.md §7 参照）。
> `duration` は連続値のため意図的に除外しています。

```css
wcs-camera:state(active) ~ .live-badge     { display: block; }
form:has(wcs-camera:state(error)) .banner  { display: block; }

wcs-recorder:state(recording) ~ .rec-dot   { animation: blink 1s infinite; }
wcs-recorder:state(paused) ~ .rec-dot      { animation: none; opacity: .4; }
```

属性やクラスと異なり `:state()` は要素の外部から書き込めないため、この出力ステートが
入力と混同される心配がありません。

**対応ブラウザ**（新構文 `:state(x)`）: Chrome/Edge 125+、Safari 17.4+、Firefox 126+。
非対応の環境ではステートが一切 set されないだけです — `:state()` セレクタがマッチしなく
なりますが、各要素自体は通常どおり動作し続けます（graceful degradation・never-throw）。

**SSR:** `:state()` は HTML にシリアライズできないため、サーバーレンダリングされた
マークアップの初期ペイントにはこれらのステートは乗りません（`@wcstack/server` は無改変）。
ハイドレーション前の見た目を制御したい場合は、代わりに `wcs-camera:not(:defined)` /
`wcs-recorder:not(:defined)` と組み合わせてください。

### デバッグ

カスタムステートは DevTools の Elements パネルには表示されず、`attachInternals()`
は同一要素に 2 回呼べないため、コンソールから直接覗く手段がありません。そのための
デバッグ専用の補助を 2 つ用意しています:

- `el.debugStates` — 現在 on になっているステート名の**スナップショット**配列
  （例: `["active"]`）。`wc-bindable` の一部ではなく（バインド対象ではない）、
  形状も契約として保証されません — デバッグ用途にのみ使ってください。
- `debug-states` 属性（opt-in・既定 OFF）は、ステート変化を要素の
  `data-wcs-state-*` 属性にミラーします。Elements パネルを開いておけば、
  トグルのたびにハイライトされます:

  ```html
  <wcs-camera autostart debug-states></wcs-camera>
  ```

**CSS は `data-wcs-state-*` ではなく `:state()` に書いてください。** ミラーされた
属性は、DevTools を開いた状態でステート変化を可視化するためだけのものであり、
スタイリング用の正式なフックではありません。

## ヘッドレス Core

`CameraCore` / `RecorderCore` を非 DOM 用途向けにエクスポートしています（`@wc-bindable/core` の `bind()`）。Shell は薄いラッパです。

Core の構造サーフェスは wcstack I/O ノード横断の規範です([async-io-node-guidelines §3.9](../../docs/async-io-node-guidelines.ja.md))。要素なしで signals に束縛するには [@wcstack/signals — Core を直接束縛する](../signals/README.ja.md#core-を直接束縛する要素なし) を参照。

## 注意・落とし穴

- **4.8 から、`<wcs-camera>` は接続の 1 マイクロタスク後に決める**: 開始するか（`autostart`）、どの `device-id` / `facing-mode` / `audio` / `width` / `height` でかを、そのときの属性で（[タイミング契約](../../docs/timing-and-firing-contract.ja.md) §23）。`@wcstack/router` はパラメータだけの遷移でルートの要素を入れ直し、`@wcstack/state` が次のルートの入力を書くのはその後 — その場で始めると前のルートのデバイスを取得し、その映像が残っていた。制約の変化は次のマイクロタスクで 1 回にまとめて取得し直す。`start()` は今の属性を使い、同じタスクの `stop()` は自動開始を取り消す。
- **セキュアコンテキスト（https）必須。** `getUserMedia` は `file://` / 素の `http://` では使えません。
- **Content-Security-Policy。** 4.5 から、プレビュー自身のスタイルは構築したスタイルシートで、`style-src` の対象外です。`'unsafe-inline'` の無いポリシーでもプレビューの配置が保たれます。4.4 までは shadow root の `<style>` で、そうしたポリシーに止められました（プレビューの `<video>` が元の大きさで描かれる）。その版では自分のスタイルシートで `wcs-camera::part(video) { display: block; width: 100%; height: 100% }` と書いてください。
- **`error` / `errorInfo` は最後の試みを表します。** 後から（サイトの設定で）許可されても消えません。`permission` はすぐに許可に追従しますが、`errorInfo` は次の `start()` が成功するまで `not-allowed` のままです。「止められている」は `permission` で判断し、最後のエラーが `not-allowed` で `permission` が `granted` なら、もう一度開始を促してください。
- **カメラインジケータ＝リーク検出器。** 終了後も点灯したままなら、トラックが停止されていません。
- **ユーザージェスチャ。** 一部ブラウザは `getUserMedia` をユーザー操作起点で要求します。タイマーから撃つと無言で失敗することがあります（`error` に出ます・throw しません）。
- **エラーは分類され throw されません:** `NotAllowedError`（拒否）・`NotFoundError`（デバイス無し）・`NotReadableError`（他アプリ使用中）・`OverconstrainedError`。
- **`errorInfo`——付加的な失敗分類。** `error` と並んで、`<wcs-camera>` / `<wcs-recorder>` はどちらも付加的なバインド可能出力 `errorInfo`（`WcsIoErrorInfo` = 安定した `code` / `phase` / `recoverable` / `message`）を公開します。同じ失敗から派生し、`wcs-camera:error-info-changed` / `wcs-recorder:error-info-changed` で publish されます。`error` の形状は不変で、`errorInfo` は `error` と完全に同期して遷移します（成功時に `null` へクリア）。両要素は 1 つの code セット（`core/mediaCapabilities.ts` の `WCS_MEDIA_ERROR_CODE`）を共有します:
  - `capability-missing`（phase `probe`）——`getUserMedia` / `MediaRecorder` 非対応（非セキュアコンテキスト含む）。4.5 から、Permissions-Policy が切ったカメラ／マイクも（ブラウザに聞く前に見つける）。
  - `not-allowed`（phase `start`）——`NotAllowedError` / `SecurityError`（権限拒否。4.4 までは feature-policy ブロックも）。
  - `not-found`（phase `start`）——`NotFoundError`（要求した種類のカメラ / マイクが存在しない）。
  - `not-readable`（phase `start`）——`NotReadableError`（デバイス占有・ハードウェア障害）。
  - `invalid-argument`（phase `start`）——`OverconstrainedError` / `NotSupportedError`（制約・mimeType が満たせない）。
  - `invalid-state`（phase `start`）——`NoStreamError`（stream 未 attach で録画開始 — 何も録画されず、要素が `[wcs/command-not-ready]` で警告する。stream がまた attach されるまで 1 回 — 4.8 から。それまでは 1 要素につき 1 回）。
  - `aborted`（phase `execute`・`recoverable: true`）——`AbortError`（実行途中の中断、retry で回復しうる）。
  - `media-error`（phase `execute`）——その他の実行時失敗（例: `RecorderError` / 想定外の `MediaRecorder` エラー）。

  `WcsIoErrorInfo` 型と `WCS_MEDIA_ERROR_CODE` 定数は export されます。
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
