# 実装計画: `@wcstack/camera`（`<wcs-camera>` + `<wcs-recorder>`）

- **状態**: ✅ 実装完了（2026-06-17・未リリース v1.13.1）。テスト 83 本・カバレッジ 100/97.35/100/100、build 成功。設計は [camera-recorder-tag-design.md](./camera-recorder-tag-design.md) を正とする。
- **実装メモ**: Phase 0 PoC（`__tests__/poc.directChannel.test.ts`）を**実 @wcstack/state**（`file:../state` devDependency）で先行実証し、生 `MediaStream` が event-token→`$on`→command-token→`Reflect.apply` を**参照同一のまま通過**し reactive state に格納されないこと（多重配布・transient 生存含む）を確認 → 設計 §2 を確定して本実装へ。雛形は speech（2タグ1パッケージ）。Core 別インスタンス（camera が getUserMedia+permission二相+lifecycle、recorder は MediaRecorder のみ・stream は借用）。`media/` で取得ロジック共有。happy-dom が `srcObject` に MediaStream 型チェックを掛けるため、テストの `FakeMediaStream` は happy-dom の `MediaStream` を継承させて通した。`keep-alive: recording` バインドで可視性/録画コーディネーションを宣言的に解決（example）。実装補正=(1)RecorderCore.dispose は `_gen++` 後に native stop を呼ぶため onstop が gen ガードで bail → `_recording`/`_paused` を直接リセット。(2)Camera Shell の visibilitychange リスナはテスト間で leak し得るため `document.body.replaceChildren()` でクリーンアップ。(3)`_now()`/`_isTypeSupported` の到達不能な防御分岐を簡約しカバレッジ 100 を達成。

---

## 0. 実装結果サマリ

- `packages/camera/` 一式（src 12 + media/ 2 + auto 2 + 設定 4 + README 2 + package.json）。
- `CameraCore`（getUserMedia + permission 二相 + restart 世代ガード + desired/actual + track.stop + visibility suspend/resume）/ `RecorderCore`（attachStream 借用 + MediaRecorder + chunk→Blob + objectURL revoke + 世代ガード）。
- `WcsCamera`（shadow `<video autoplay muted playsinline part=video>` 内包・srcObject 内部代入）/ `WcsRecorder`（display:none）。
- テスト 8 ファイル 83 本: `poc.directChannel`（4 受け入れ条件）/ `cameraCore`(15) / `recorderCore`(18) / `camera`(9) / `recorder`(5) / `permission`(7) / `config`(5) / `coverage`(残り分岐)。カバレッジ 100/97.35/100/100。
- example `examples/state-camera-record-upload/`（permission→preview→録画→再生→upload 一本道・`keep-alive: recording`）+ README ja/en。
- package README ja/en + ルート README（Twenty-four 化・パッケージ一覧・ディレクトリツリー追記）。
- **state 依存は devDependency（`file:../state`）のみ**＝published パッケージは依存ゼロ（`files:["dist"]`）。PoC 回帰テストのためだけに実 state を使う唯一のテスト。

---

> 以下は計画時の工程表（参考）。実装は本工程に概ね沿って完了した。

---
- **方針**: `packages/speech/`（2タグ1パッケージ・command/event-token 双対・`_gen` ライフサイクルガード）を雛形にコピー → 名称置換 → 差分実装。permission からは permission 二相監視を、wakelock からは desired/actual 二層を、upload からは blob 受け口を移植する。
- **PoC を先に置く理由**: 本ノードの新規性の核（設計 §1・§2＝**生ハンドルを state に格納せず command-token 引数素通しで要素間直結する**）は、既存タグに前例が無く机上では綺麗でも実機で詰まりやすい。**Phase 0（PoC）で直結チャネルだけを最小実証してから本実装に入る**。signals PoC（無改変の実 Core を食わせて DOM 到達まで確認）と同じく「核を最速で潰す」工程設計。
- **speech との主な差分**（実装で効くポイント）:
  1. 扱う値が **シリアライズ不能な生ハンドル**（`MediaStream`）→ state に出さず event-token/command-token の**引数として通過させるだけ**（§2）。speech は値（文字列）を state に出していた。
  2. **リソース解放が物理的に観測可能**（カメラ/マイクのランプ）→ `track.stop()` 漏れが致命的。desired/actual 二層（wakelock 流用）と `_gen` 世代ガードが必須。
  3. constraints 変更で **stream を stop→再取得（switchMap 相当の restart）**。speech に無かった「依存駆動 cancel/restart」。
  4. camera が **shadow DOM に `<video>` preview を内包**（案B）→ speech のような完全 headless でなく描画責務を持つ。
  5. recorder の出力は **Blob（structured-clone 可＝「値」側）** → state に出してよく、`new File()` 化で既存 upload ノードへ一本道接続。

---

## 0. パッケージ構成の全体像

`@wcstack/camera` 1パッケージに2タグ（設計 §8 確定）。

```
packages/camera/
  src/
    media/
      getUserMedia.ts      # getUserMedia ラッパ + エラー分類 + track 一括 stop ヘルパ
      permission.ts        # camera/microphone の二相監視（permission パッケージ流用）
    core/
      CameraCore.ts        # getUserMedia + permission 二相 + stream ライフサイクル + preview 供給
      RecorderCore.ts      # MediaRecorder ラップ + attachStream(借用) + chunk収集→Blob
    components/
      Camera.ts            # <wcs-camera> Shell（<video> preview 内包）
      Recorder.ts          # <wcs-recorder> Shell
    config.ts
    registerComponents.ts
    bootstrapCamera.ts
    exports.ts
    raiseError.ts
    types.ts
  __tests__/
    helpers.ts             # FakeMediaStream / FakeMediaStreamTrack / FakeMediaRecorder / getUserMedia モック
    poc.directChannel.test.ts   # Phase 0
    cameraCore.test.ts
    recorderCore.test.ts
    camera.test.ts
    recorder.test.ts
    config.test.ts / bootstrapCamera.test.ts
  rollup.config.js / vitest.config.ts / tsconfig.json / eslint.config.js / package.json
  README.md / README.ja.md
  src/auto/auto.js / auto.min.js
```

> **Core は別インスタンス**: camera が getUserMedia + permission + lifecycle を持ち、recorder は MediaRecorder のみ。recorder は stream を**借りる**だけで取得・stop しない（§2・§3-b）。「Core 共有」は取得ロジック（`media/`）の共有を指し、stream インスタンスを camera→recorder で 1 本共有する意味。

---

## 1. Phase 0 — PoC: state を介さない直結チャネルの実証【最優先・本実装の前提】

**目的**: 設計 §1・§2 の不変条件「生ハンドルは reactive state に格納されず、command-token の引数として transient に要素間を通過する」が**実機（実 state パッケージ）で成立する**ことを、本実装に入る前に最小構成で確認する。

### 0-a. PoC スコープ（最小）
- `FakeMediaStream`（識別可能な `id` を持つだけのダミー生オブジェクト）を用意。
- 最小の `<poc-source>`（stream を event-token `streamReady` で発火）と `<poc-sink>`（`attachStream(stream)` command を持ち、受領した stream を内部に保持）を happy-dom で定義。
- **実 state パッケージ**（`@wcstack/state`）の `data-wcs` で配線:
  ```html
  <wcs-state>
    <poc-source data-wcs="eventToken.streamReady: gotStream"></poc-source>
    <poc-sink   data-wcs="command.attachStream: $command.feed"></poc-sink>
  </wcs-state>
  ```
  ```js
  $eventTokens: ["gotStream"], $commandTokens: ["feed"],
  $on: { gotStream: (state, event) => state.$command.feed.emit(event.detail) }
  ```

### 0-b. PoC が証明すべきこと（受け入れ条件）
1. **到達**: `<poc-source>` が発火した `FakeMediaStream` インスタンスが、**同一参照のまま** `<poc-sink>.attachStream` に届く（`Reflect.apply` 素通し・[[command-token-arguments-proposal]]）。`received === emitted`（参照同一）を assert。
2. **非格納**: 一連の流れの後、state スナップショット（`state.$getAll()` 相当）に `MediaStream` が**一切現れない**ことを assert。生ハンドルは reactive プロパティに乗らない。
3. **多重配布**: 同じ `gotStream` ハンドラから 2 つの sink（preview 相当 + recorder 相当）へ emit すると、両方に同一 stream が届く（preview と recorder の 1 stream 共有を先取り実証）。
4. **transient 性**: ハンドラ実行後に source を dispose しても、既に渡った sink の参照は生存（state が握っていないので GC 経路が要素側に閉じる）。

### 0-c. PoC の成果
- 受け入れ条件を満たせば **§2 案2-1 を本実装の正式経路として確定**し Phase 1 へ。
- もし `Reflect.apply` 素通しで生オブジェクトが壊れる/シリアライズが噛む等の想定外があれば、設計 §2 へ差し戻し（案2-2 ref 新設の再検討）。**この差し戻しを安く起こすために PoC を先頭に置く**。
- PoC テスト（`poc.directChannel.test.ts`）は本実装後も**回帰テストとして残す**（直結チャネルの契約を固定）。

> PoC は `packages/camera/__tests__/poc.directChannel.test.ts` として書き、`@wcstack/state` を devDependency に入れて実 state で検証する（speech の example が実 state を使うのと同じ依存方向）。

---

## 2. パッケージ雛形（コピー → リネーム）

`packages/speech/` を `packages/camera/` へコピーし機械置換。

| speech | camera |
|---|---|
| `src/core/SpeakCore.ts` | `src/core/CameraCore.ts` |
| `src/core/ListenCore.ts` | `src/core/RecorderCore.ts` |
| `src/components/Speak.ts` | `src/components/Camera.ts` |
| `src/components/Listen.ts` | `src/components/Recorder.ts` |
| `src/bootstrapSpeech.ts` | `src/bootstrapCamera.ts` |
| `bootstrapSpeech` | `bootstrapCamera` |
| タグ `wcs-speak`/`wcs-listen` | `wcs-camera`/`wcs-recorder` |
| イベント接頭辞 `wcs-speak:`/`wcs-listen:` | `wcs-camera:`/`wcs-recorder:` |
| `[@wcstack/speech]`（raiseError 接頭辞） | `[@wcstack/camera]` |

無改変コピー: `rollup.config.js`（3 出力 ＋ auto コピー）・`tsconfig.json`・`eslint.config.js`・`src/auto/*`（bootstrap 名のみ置換）。`autoTrigger.ts`/`listenAutoTrigger.ts` は **camera/recorder に autoTrigger を持たせない方針**なら削除（speech の autoTrigger は不要・要判断 §7）。

---

## 3. `package.json`

- `name`: `@wcstack/camera`
- `version`: 既存クライアント群と揃え `1.13.x` 起点（[[feedback_version_alignment]]・直近 permission/notification/speech が 1.13.1）。
- `description`: "Declarative camera capture and media recording for Web Components. Binds live MediaStream handles directly to elements (never through serializable state) via getUserMedia + MediaRecorder."
- `keywords`: `web-components`, `getusermedia`, `mediastream`, `mediarecorder`, `camera`, `webcam`, `recording`, `wc-bindable`, `command-token`, `event-token`, `zero-dependencies`
- `repository.directory`: `packages/camera`
- `exports`/`files`/`scripts` は speech 同型（`.` ＋ `./auto`）。**sw 別エントリは不要**（notification と違い SW 連携なし）→ rollup は 3 出力のまま。
- `devDependencies` に **`@wcstack/state`** を追加（PoC/example で実 state を使うため）。

---

## 4. ソース実装

### 4.1 `src/types.ts`
speech の wc-bindable インターフェース群（`IWcBindable*`/`IConfig`）を流用。`tagNames` を `{ camera: string; recorder: string }` に。値型を定義:

```ts
export type MediaPermissionState = "prompt" | "granted" | "denied" | "unsupported";
export type FacingMode = "user" | "environment";

export interface WcsCameraValues {
  active: boolean;
  permission: MediaPermissionState;        // camera
  audioPermission: MediaPermissionState | null; // microphone（audio 未使用時 null）
  deviceId: string | null;
  devices: MediaDeviceInfo[];
  error: WcsMediaErrorDetail | null;
}
export interface WcsRecorderValues {
  recording: boolean;
  paused: boolean;
  duration: number;          // ms
  mimeType: string;
  blob: Blob | null;         // structured-clone 可＝「値」側で state OK
  objectURL: string | null;  // revoke ライフサイクル管理
  error: WcsMediaErrorDetail | null;
}
export interface WcsMediaErrorDetail {
  name: string;   // NotAllowedError / NotFoundError / NotReadableError / OverconstrainedError ...
  message: string;
}
```
> `srcObject`/`stream`（MediaStream）は**値型に含めない**＝state binding 対象外（§7・不変条件の型レベル担保）。`types.ts` は coverage 除外。

### 4.2 `src/media/`（取得ヘルパ・共有）
- `getUserMedia.ts`: `navigator.mediaDevices.getUserMedia(constraints)` を try/catch でラップし `WcsMediaErrorDetail` に正規化（never-throw）。secure-context 未満は `unsupported`。`stopAllTracks(stream)` ヘルパ（`stream.getTracks().forEach(t => t.stop())`）。
- `permission.ts`: `query({name:'camera'})` / `query({name:'microphone'})` を permission パッケージのパターンで監視（4値・`change` 再購読・静的フォールバック）。query 拒否環境は監視を諦め getUserMedia 成否で granted/denied 推定（設計 §6）。

### 4.3 `src/core/CameraCore.ts`（中核1）

**状態フィールド**:
```
_active=false / _permission="prompt" / _audioPermission=null
_deviceId=null / _devices=[] / _error=null
_stream: MediaStream | null = null     // ← state に出さない内部保持
_constraints / _gen=0 / _permGen=0 / _subscribed=false
_desired=false                         // wakelock 流用: 利用者が ON を望むか（actual=_stream の生死）
_ready: Promise<void>
```

**`wcBindable`**: 値プロパティ（`active`/`permission`/`audioPermission`/`deviceId`/`devices`/`error`）を `wcs-camera:change` ＋ getter で公開。`commands: [start, stop, switchCamera]`。**event-token 用 property**: `streamReady`（`wcs-camera:stream-ready`・detail=MediaStream）/`error`（`wcs-camera:error`）/`devicesChanged`/`ended`。`stream`/`srcObject` は **wcBindable に出すが inputs 非掲載**（state binding 不可）。

**メソッド**:
- `observe(constraints)`: `connectedCallback` から。permission 二相監視開始（`media/permission`）。reactive acquire（constraints があれば取得）。
- `start()`/`stop()`/`switchCamera()`: imperative command。`switchCamera` は facingMode トグル → restart。
- `_acquire(constraints)`: `_gen` をキャプチャ → `getUserMedia` → 解決時 `gen !== _gen` なら取得 stream を即 stop して bail（**restart の世代ガード**・§3-c）。成功で `_stream` 保持・`_active=true`・`streamReady` を dispatch（detail=stream）・`enumerateDevices` で `_devices` 更新。
- `_release()`: `stopAllTracks(_stream)`・`_stream=null`・`_active=false`。track の `ended` 監視で OS 起点の剥奪を `ended` event 化（desired は true のまま actual だけ落とす・§3-b）。
- `_restart(constraints)`: `_gen++` → `_release()` → `_acquire()`。constraints 変化・`switchCamera` で呼ぶ。
- `dispose()`: `_gen++`・`_permGen++`・`_release()`・permission 購読解除。
- `_publish()`: same-value ガード後に `wcs-camera:change` dispatch（detail=値スナップショット）。

### 4.4 `src/core/RecorderCore.ts`（中核2）

**状態フィールド**:
```
_recording=false / _paused=false / _duration=0 / _mimeType=""
_blob=null / _objectURL=null / _error=null
_recorder: MediaRecorder | null = null
_stream: MediaStream | null = null   // 借用（stop しない）
_chunks: Blob[] = [] / _gen=0
```

**`wcBindable`**: 値プロパティ（`recording`/`paused`/`duration`/`mimeType`/`blob`/`objectURL`/`error`）＋ `commands: [attachStream, start, stop, pause, resume]`。event-token property: `recorded`（`wcs-recorder:recorded`・detail=Blob）/`dataavailable`（timeslice 時のみ）/`stateChanged`/`error`。

**メソッド**:
- `attachStream(stream)`: §2 直結で stream を**借用**（`_stream=stream`・**stop しない**）。同期受領・即代入（async await しない・[[command-token-arguments-proposal]] 規範）。
- `start(options?)`: `new MediaRecorder(_stream, {mimeType})` ＋ `dataavailable`/`stop`/`error` 配線 ＋ `_recorder.start(timeslice?)`。`isTypeSupported` で mimeType 検証。
- `stop()`: `_recorder.stop()` → `stop` ハンドラで `new Blob(_chunks, {type})` 組立 → 前回 `_objectURL` を revoke → 新規発行 → `recorded`(Blob) dispatch ＋ `blob`/`objectURL` を state へ。
- `pause()`/`resume()`: 委譲 ＋ `_paused`/`duration` 更新。
- `dispose()`: `_gen++`・録画中なら停止・**最後の `_objectURL` を revoke**・`_stream=null`（借用解除のみ・stop しない＝所有権は camera）。

### 4.5 `src/components/Camera.ts`（Shell・preview 内包）
- `attachShadow({mode:"open"})` に `<video autoplay muted playsinline>` を内包。`_video.srcObject = stream`（`streamReady` を内部購読 or `_acquire` 成功時に直接代入）。**srcObject 代入は shadow 内で完結**＝state を越えない（§1 案B）。
- 属性: `facing-mode`/`device-id`/`audio`（bool）/`width`/`height`/`active`（manual ON/OFF）。reactive restart（属性変化 → `_core._restart`）。
- `connectedCallback`: `this._core.observe(this._constraints())`。`disconnectedCallback`: `this._core.dispose()`（**track.stop()**）。`document.visibilitychange` 購読 → 録画中以外は hidden で `_release`・visible で再取得（§3-d・要決定で内定）。
- Core 委譲 getter（値プロパティ）＋ imperative メソッド（`start`/`stop`/`switchCamera`）。
- **preview の CSS 露出**: `:host` と内部 `video` に `::part(video)` を当てて利用者がスタイル可能に。

### 4.6 `src/components/Recorder.ts`（Shell）
- 描画なし（`display:none` でも可・blob/URL は state 経由で別要素が表示）。属性: `mime-type`/`timeslice`/`audio-bits`/`video-bits`。
- `command.attachStream`/`start`/`stop`/`pause`/`resume` を Core 委譲。値 getter ×7。
- `connectedCallback`/`disconnectedCallback`（dispose で URL revoke）。

### 4.7 その他（ほぼ機械置換）
`config.ts`（`tagNames.camera="wcs-camera"`/`recorder="wcs-recorder"`）・`registerComponents.ts`（2タグ define）・`bootstrapCamera.ts`・`exports.ts`（`CameraCore`/`RecorderCore`/`WcsCamera`/`WcsRecorder` ＋型）・`raiseError.ts`（接頭辞置換・never-throw で未使用保持）。

---

## 5. テスト（`__tests__/`・happy-dom）

happy-dom は getUserMedia/MediaRecorder/MediaStream を持たないため**全モック必須**（`helpers.ts`）:
- `FakeMediaStreamTrack`（`kind`/`stop()`/`readyState`/`dispatchEvent('ended')`）
- `FakeMediaStream`（`id`/`getTracks()`/`getVideoTracks()`）
- `FakeMediaRecorder`（`start`/`stop`/`pause`/`resume`/`ondataavailable`/`onstop`・`isTypeSupported` 静的）
- `navigator.mediaDevices.getUserMedia`/`enumerateDevices`/`navigator.permissions.query` モック（[[intersection-tag-design]] の FakeIntersectionObserver・[[permission-tag-design]] の mocks.ts 同型）

**重点観点**:
1. **Phase 0 回帰**（`poc.directChannel.test.ts`）: 直結チャネルの参照同一・非格納・多重配布。
2. CameraCore: acquire 成功 → `active`/`streamReady`(detail=stream)/`devices`、permission 二相（4値・change 追従・静的フォールバック）。
3. **restart 世代ガード**: constraints 変更中に古い getUserMedia が解決 → 古い stream は即 stop され `_stream` を上書きしない。
4. **release**: disconnect で全 track.stop() 呼ばれる（FakeTrack の stop 呼出回数）。track `ended` → desired 維持・actual 落ち・`ended` event。
5. visibilitychange: hidden で release・visible で再取得（録画中は保持）。
6. RecorderCore: attachStream（借用・stop しない）→ start → dataavailable → stop で Blob 組立 → `recorded`/`blob`/`objectURL`。**二重 stop 防止**（recorder dispose が借用 stream を stop しない）。
7. **objectURL revoke**: 連続録画で前 URL が revoke・dispose で最後の URL revoke。
8. `_gen` ガード: dispose/restart 後の遅延コールバックが torn-down 要素を触らない。
9. エラー分類: NotAllowed/NotFound/NotReadable/OverConstrained を `error.name` で区別・never-throw。
10. Shell: 属性パース・preview srcObject 代入（shadow 内 `<video>.srcObject===stream`）・display/part・connectedCallbackPromise・disconnect dispose。

> **カバレッジ**: 100/97+/100/100 目標（CLAUDE.md 標準閾値）。restart bail 枝・静的フォールバック枝・録画中分岐・revoke 枝を個別に踏む。`media/`/Core は coverage 対象、`types.ts` は除外。

---

## 6. example: `examples/state-camera-record-upload/`

**主題**: 設計 §5-c の一本道（permission ゲート → getUserMedia → preview → 録画 → upload）。

- `<wcs-camera>` で preview、`$on.gotStream` で recorder へ直結（§2）、録画 Blob を `new File([blob],"clip.webm")` 化して既存 **`<wcs-upload>`** へ。
- `<wcs-permission name="camera">` 併置で権限監視デモ（責務分離の重ねがけ）。
- UI: 録画ボタン（`command.start`/`stop`）・`recording@…` の赤丸・`{duration}` 表示・録画後 `<video src={objectURL}>` で再生・アップロードボタン。
- README.ja / README.md（secure-context・https 必須・カメラランプ＝リーク・録画中切替不可・mimeType 互換を明記）。
- ルート `examples/README` 一覧へ追記。

---

## 7. 要決定（実装着手前に確定する★・設計 §11 と対応）

| 項目 | 内定 | 確定タイミング |
|---|---|---|
| autoTrigger を持つか | **持たない**（speech の autoTrigger.ts は削除） | §2 雛形コピー時 |
| 録画中の constraints 変更 | **拒否**（§3-c-1） | RecorderCore 実装時 |
| visibilitychange 解放 | **録画中以外 hidden で stop**（§3-d-1） | Camera Shell 実装時 |
| chunk 出力単位 | **既定 stop で1 Blob・timeslice 時のみ dataavailable**（§5-a-1） | RecorderCore 実装時 |
| 2権限の見せ方 | **camera/microphone 別 getter・audio 未使用時 microphone 非監視**（§6-1） | CameraCore 実装時 |
| recorder 単独利用 | **attachStream 経由で camera 無しでも動く**（§8-1） | RecorderCore 実装時 |

> いずれも設計で推奨内定済。実装中に覆れば設計 §11 表を更新。

---

## 8. ビルド & 検証手順

`packages/camera/` で順に:
```bash
npm install
npm run lint
npm test                # Phase 0 PoC 含む全観点グリーン
npm run test:coverage
npm run build           # rimraf → tsc → rollup（index.esm/.min/.d.ts ＋ auto コピー）
```
- `dist/index.d.ts` に値型・`CameraCore`/`RecorderCore` が現れ、`MediaStream` が**値プロパティ型に漏れていない**ことを確認。
- example をローカルサーバで開き、(a) 許可→preview 表示、(b) 録画→停止→再生、(c) アップロード成功、(d) タブ離脱でカメラランプ消灯（リーク無し）、(e) 録画中の切替拒否、を目視。

---

## 9. 成果物チェックリスト

- [ ] **Phase 0 PoC**（`poc.directChannel.test.ts`）グリーン＝直結チャネル確定
- [ ] `packages/camera/` 一式（src・media/・core×2・components×2・設定・README×2・auto）
- [ ] `CameraCore`（getUserMedia + permission 二相 + restart 世代ガード + desired/actual + track.stop）
- [ ] `RecorderCore`（attachStream 借用 + MediaRecorder + chunk→Blob + objectURL revoke）
- [ ] `WcsCamera`（preview 内包・srcObject shadow 内完結・visibility）/ `WcsRecorder`
- [ ] `__tests__/` 全観点・カバレッジ 100/97+/100/100
- [ ] `examples/state-camera-record-upload/`（permission→preview→録画→upload 一本道）
- [ ] README ja/en ＋ ルート README 追記（対応タグ一覧）
- [ ] バージョン整合（1.13.x）
- [ ] `npm run build` 成功・`dist` 型確認（MediaStream 非漏洩）

---

## 10. 着手順（推奨）

1. **Phase 0 PoC** を最初に：`packages/camera/__tests__/poc.directChannel.test.ts` ＋ 最小 fake で §1 受け入れ条件 1〜4 を緑化。**ここで設計 §2 を確定**（詰まれば設計へ差し戻し）。
2. 雛形コピー＋名称置換（§2・§3）→ `npm install`。`types.ts`/`config.ts`/`registerComponents.ts`/`bootstrapCamera.ts`/`exports.ts`（土台）。
3. `media/`（getUserMedia ラッパ＋permission 監視）＋ `helpers.ts` モック。
4. `CameraCore`（§4.3）を TDD：`cameraCore.test.ts` の観点 2〜5・8〜9 を先に書き緑化。restart 世代ガードと track.stop を最重点。
5. `RecorderCore`（§4.4）＋ `recorderCore.test.ts`（観点 6〜7）。借用 stream の二重 stop 防止と objectURL revoke を最重点。
6. `WcsCamera`（preview 内包・§4.5）＋ `WcsRecorder`（§4.6）＋ Shell テスト（観点 10）。
7. カバレッジ詰め → example ＋ README ＋ ルート README 追記。
8. `npm run build` ＋ example 目視（特にカメラランプ消灯＝リーク無し）→ 完了。
