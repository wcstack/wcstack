# 設計メモ: `@wcstack/camera`（`<wcs-camera>` + `<wcs-recorder>`）

- **状態**: ✅ 実装完了（2026-06-17・未リリース v1.13.1）。論点1・2・パッケージ構成はユーザー承認済。実装手順と結果は [camera-recorder-impl-plan.md](./camera-recorder-impl-plan.md) を参照。本文書は論点整理と決定事項のスナップショット。
- **対象 WebAPI**: Media Capture and Streams（`navigator.mediaDevices.getUserMedia()`、`MediaStream`、`MediaStreamTrack`、`enumerateDevices()`、`devicechange` イベント）＋ MediaStream Recording（`MediaRecorder`、`dataavailable`/`stop`/`error`/`pause`/`resume` イベント、`Blob`）。
- **位置づけ**: **生のライブリソースハンドル（`MediaStream`）を扱う初の IO ノード**。これまでの全タグは「シリアライズ可能な値」を state に出し入れしてきたが、本ノードはシリアライズ不能・参照同一性のみ・リークが物理的に観測可能（カメラ/マイクのインジケータ）な生ハンドルを扱う。**「I/Oノード体系は値以外も流せるか」の試金石**。
- **前提資産**: permission（permission 二相監視・4値 state・派生 boolean getter・`_permGen` 世代ガード・unsupported・never-throw・secure-context・Core/Shell・SSR）、speech（command/event-token 双対を2タグで実証・imperative command・`command.<name>: <path>` 引数束縛・`_gen` ライフサイクルガード・dispose で in-flight 無効化）、wakelock（desired/actual 二層・OS 起点の状態剥奪追従）、state-stream-type-design（依存駆動 cancel/restart = switchMap 相当の最難所）、upload（`FileList|File[]` 入力＝blob 受け口）、command-token-arguments（位置引数素通し MUST）。

---

## 0. 大前提: このノードだけが「値ではない生ハンドル」を扱う

既存 IO ノード（fetch / storage / broadcast / speech / notification …）はすべて **シリアライズ可能な値** を state に出し入れしてきた。`MediaStream` / `MediaRecorder` は質的に異なる。

| 性質 | 既存の値（string / object / Blob） | `MediaStream` / `MediaRecorder` |
|---|---|---|
| シリアライズ | 可（JSON / structured clone） | **不可**（生ライブハンドル） |
| 等値性 | 値比較に意味がある | **参照のみ**・same-value ガードが無意味 |
| 時間性 | settle した不変スナップショット | **settle しない**ライブ接続。スナップショット概念と矛盾 |
| リーク | 観測不能（GC 任せ） | **物理的に観測可能**（カメラ/マイクのランプが消えない） |

→ この4つの違いが全論点の根。state が前提する「値の器・diff・computed・JSON 永続化」のモデルに生ハンドルを載せると体系が壊れる。よって本ノードの新規性の核は **「生ハンドルを state の外でどう流すか」** に集約される（§1・§2）。

---

## 1. 生ハンドルの所在 — state を通すか通さないか【最重要・決定済】

`applyChangeToProperty` は undefined 以外の生オブジェクトを `element[prop] = value` で素通しする（[applyChangeToProperty.ts](../packages/state/src/apply/applyChangeToProperty.ts)）。つまり **機械的には state 経由で `video.srcObject` に `MediaStream` を書けてしまう**。動く。が、それは禁じる。

| 案 | 生ハンドルの流れ | トレードオフ |
|---|---|---|
| A state にopaque値 | state が `MediaStream` を保持し property binding で `srcObject` へ | 実装最小。だが state のスナップショット/diff/computed/JSON モデルを汚染。settle しないハンドルを「値」扱いする矛盾 |
| **B camera 内包 preview** | camera が `<video>` を shadow DOM に内包し `srcObject` 代入を内部で完結 | boundary を越えさせない。state を一切汚さない。代償＝preview の見た目を camera が所有（CSS 露出設計が要る） |
| **C state 非経由の直結チャネル** | 生ハンドルは state の外を流れ、要素プロパティへ直結（recorder 等へ） | 体系を汚さず再利用も効く。conduit の正体が論点2 |

→ **決定: 案B＋案C のハイブリッド**（2026-06-17・承認済）。不変条件として **「生ハンドル（`MediaStream`）は reactive state に格納しない」** を固定。
- camera は preview の `<video>` を内包し、`srcObject` 代入は shadow DOM 内で完結（案B）。
- camera→recorder 等の要素間受け渡しは state を介さない直結チャネル（案C＝論点2）。
- **state に出すのは派生した「値」だけ**: `active:bool` / `permission:4値` / `audioPermission:4値` / `deviceId` / `devices[]` / `recording:bool` / `paused:bool` / `duration:number` / `blob:Blob` / `objectURL:string` / `error`。`Blob` は structured-clone 可能なので「値」側に置いてよい（§5-b）。

---

## 2. state を介さない直結チャネルの正体【決定済】

案C の conduit を何にするか。state を経由せず `MediaStream` を camera→recorder（および外部 `<video>`）へ渡す経路。

| 案 | conduit | トレードオフ |
|---|---|---|
| **2-1 command-token 引数素通し** | camera が `stream-ready` を event-token 発火（`event.detail`=stream）→ `$on` ハンドラが `$command.attachStream(stream)` を呼ぶ → recorder の `attachStream(stream)` へ | `Token.emit(...args) → Reflect.apply` が引数を**素通し**（[Token.ts](../packages/state/src/token/Token.ts)）。stream は**トークンバスを transient に通過するだけで reactive state に格納されない**。新規プリミティブ不要 |
| 2-2 新 ref/property-wire | 要素↔要素を直結する宣言記法を新設 | 表現は綺麗だが体系に新概念が増える |

→ **決定: 案2-1（command-token 引数素通し）**（2026-06-17・承認済）。配線例:

```html
<wcs-camera   data-wcs="eventToken.streamReady: gotStream; active: cameraOn"></wcs-camera>
<wcs-recorder data-wcs="command.attachStream: $command.feedStream; eventToken.recorded: gotBlob"></wcs-recorder>
```
```js
$eventTokens: ["gotStream", "gotBlob"],
$commandTokens: ["feedStream"],
$on: {
  // camera が stream を握った瞬間、その生ハンドルを recorder へ transient に手渡す。
  // stream は state には一切保存されない（引数として通過するだけ）。
  gotStream: (state, event) => state.$command.feedStream.emit(event.detail),  // event.detail = MediaStream
  gotBlob:   (state, event) => { state.lastClip = event.detail; }             // Blob は「値」なので state OK
}
```

- [[command-token-arguments-proposal]] の「位置引数素通し（MUST）」がそのまま効く。`emit(stream)` → `attachStream(stream)` へ透過。speech の `speak(text, options)` と同型。
- **規範メモ**: 生ハンドルを load する command-token（`attachStream`）は **async await せず同期で受け取り即代入**。stream の所有権（誰が `track.stop()` するか）は §3 で recorder 側に渡さず camera 保持を既定とする（二重 stop 防止）。

---

## 3. stream ライフサイクル【serializable タグと決定的に違う部分・要決定多数】

生ハンドルゆえ、取得・解放・再取得が固有論点になる。

### 3-a. 取得（acquire）
- `getUserMedia(constraints)` は async＋permission gate。secure-context（https）必須。
- constraints＝`video`/`audio` 有無・`facingMode`（user/environment）・解像度・`deviceId`。属性で宣言。
- **acquire のトリガ**: reactive（constraints バインドの変化で自動取得）と imperative（`command.start`）の両サーフェス（§4）。

### 3-b. 解放（release）— **最重要**
- `disconnectedCallback` で **必ず全 `track.stop()`**。怠るとカメラ/マイクのランプが消えない＝**リークが物理的に観測可能**。これが既存タグと決定的に違う点。
- wakelock の **desired/actual 二層**（[[wakelock-tag-design]]）と同型。`active`（desired＝利用者が ON を望む）と実 stream の生死（actual）を分離管理。OS/他タブにデバイスを奪われると（`NotReadableError` や track の `ended`）actual だけ落ちる。
- 所有権: stream を `attachStream` で受けた recorder は **`stop()` しない**（参照を借りるだけ）。stop 権限は取得元 camera が単独保持 → 二重 stop / use-after-stop を防ぐ。

### 3-c. 再取得（restart）— switchMap 相当の最難所
- constraints 変更（カメラ切替・解像度変更）は **古い stream を stop → 新規 getUserMedia** の restart。これは [[state-stream-type-design]] が「最難所」とした **依存駆動 cancel/restart（switchMap 相当）** がここでも顔を出す。
- 世代ガード（`_gen`・SpeakCore 同型）で、再取得中に解決した古い getUserMedia Promise が新しい stream を上書きしないよう bail。
- **論点 3-c-1（要決定）**: 再取得中に recorder が録画中だったらどうするか。①録画中は constraints 変更を拒否（safest・推奨）／②録画を止めてから切替／③別 stream を裏で取得。**推奨①**（録画中はカメラ切替不可・README 明記）。

### 3-d. visibilitychange — **要決定**
- ページ hidden 時に stream を自動 stop してインジケータを消すか。wakelock は OS の自動解放→可視復帰で再取得した。
- **論点 3-d-1**: ①録画中でなければ hidden で stop・visible で再取得（リーク最小・推奨）／②常に保持（プレビュー継続だが裏でランプ点灯）。**推奨①**（録画中は §3-c-1 と同じく保持）。

---

## 4. command-token / event-token サーフェス【reactive＋imperative 両採用】

speech・notification と対称に、reactive（束縛変化で発火・same-value ガード）と imperative（command・毎回発火）を両採用。

### `<wcs-camera>`
| サーフェス | 種別 | 起動 | 用途 |
|---|---|---|---|
| reactive constraints | input | `facing-mode`/`device-id` 属性 or 束縛の変化 | 宣言的にカメラを選ぶ。変化で restart（§3-c） |
| `command.start` / `stop` / `switchCamera` | command-token | 明示 emit | 「今 ON/OFF」「前後カメラ切替」 |
| event `streamReady` | event-token | stream 取得完了 | `event.detail`=MediaStream（§2 で recorder へ流す） |
| event `error` / `devicesChanged` / `ended` | event-token | エラー / `devicechange` / track 終了 | 状態遷移を state へ |

- 値プロパティ（state binding 可）: `active` / `permission` / `audioPermission` / `deviceId` / `devices` / `error`。
- **non-serializable プロパティ（`srcObject` / `stream`）は wcBindable に出すが state binding 対象外**＝input property 扱い（§7）。`attachStream(stream)` は recorder 側の command。

### `<wcs-recorder>`
| サーフェス | 種別 | 起動 | 用途 |
|---|---|---|---|
| `command.attachStream` | command-token | §2 の直結で stream を受領 | 録画対象 stream を借りる（stop しない） |
| `command.start` / `stop` / `pause` / `resume` | command-token | 明示 emit | 録画制御 |
| event `recorded` | event-token | `stop` 完了・Blob 組立後 | `event.detail`=Blob（§5） |
| event `dataavailable` / `stateChanged` / `error` | event-token | chunk 到着 / 状態遷移 / エラー | 進捗・状態を state へ |

- 値プロパティ: `recording` / `paused` / `duration` / `mimeType` / `blob` / `objectURL` / `error`。

---

## 5. recorder 出力（Blob）の扱い【Blob は「値」側】

### 5-a. chunk 収集 → Blob 組立
- `MediaRecorder` の `dataavailable` で `Blob` chunk が届く。Core が配列に収集し、`stop` 時に `new Blob(chunks, {type: mimeType})` で組立 → `recorded` event-token で publish。
- **論点 5-a-1（要決定）**: chunk を都度 event-token で流すか（ストリーミングアップロード用）、stop で1個にまとめるか。**推奨: 既定は stop で1個**（`recorded`）。`timeslice` 属性指定時のみ `dataavailable` も event-token に出す（上級者向け・チャンク化）。

### 5-b. Blob / objectURL は state に置いてよい
- `Blob` は structured-clone 可能＝「値」寄り。MediaStream と違い state に格納可（§1 不変条件の対象外）。
- `objectURL`（`URL.createObjectURL(blob)`）は string＝値。ただし **`URL.revokeObjectURL` のライフサイクルあり** → Core が前回 URL を revoke してから新規発行（リーク防止）。dispose で最後の URL も revoke。

### 5-c. 一本道デモ: blob → upload ノード接続
- `blob → new File([blob], "clip.webm", {type}) → element.files` で既存 upload ノードへ（[UploadCore](../packages/upload/src/core/UploadCore.ts) は `FileList|File[]` 入力）。
- permission ゲート → getUserMedia → preview → 録画 → upload が**無改変で一本道**に繋がる。これが「IO ノード体系が値以外も扱えても、最終出力は既存の値レールに合流する」ことの実証。

---

## 6. permission の二相【monitor＋acquire・camera と microphone は別権限】

permission タグは `request` 標準が無く monitor 専用（command-token 不成立）だった（[[permission-tag-design]] §0）。**camera/recorder は `getUserMedia` 自体が request** ＝ command-token 成立（notification と同型）。

- **monitor**: Permissions API `query({name:'camera'})` / `query({name:'microphone'})` を [[permission-tag-design]] の PermissionCore パターンで監視。4値 state（`prompt`/`granted`/`denied`/`unsupported`）＋派生 boolean。`_permGen` 世代ガード。
- **acquire**: `getUserMedia` がプロンプトを誘発（active 取得）。
- **論点 6-1（要決定）**: camera と microphone は**別 permission**。audio+video 同時取得時にどう見せるか。①`permission`（=camera）と `audioPermission`（=microphone）を別々に publish（透明・推奨）／②AND 合成した単一 state。**推奨①**（2権限を別 getter で出す。利用者が必要な方を束縛）。`audio` 制約を使わない時は `audioPermission` は監視しない（`unsupported` ではなく null/未購読）。
- Permissions API が `camera`/`microphone` descriptor を拒否する環境（Firefox 等）→ notification と同じく **静的フォールバック**（query 失敗時は監視を諦め、getUserMedia の成否で granted/denied を推定）。

---

## 7. Core / Shell と wcBindable【既存踏襲・non-serializable property の扱い】

- **Core/Shell 分割**: null descriptor 構築 → `connectedCallback` で observe（permission/notification 同型）。`MediaStreamCore`（getUserMedia + permission 監視 + stream ライフサイクル）を camera/recorder で**共有**（§パッケージ構成）。
- **non-serializable プロパティの wcBindable 表現**: `stream` / `srcObject` は wcBindable.properties には宣言する（型・イベントは持つ）が、**state の data-wcs バインド対象にはしない**＝`inputs` でなく内部 property、もしくは「command でのみ受ける」(`attachStream`)。これが「値でないものは state レールに乗せない」を型レベルで担保する箇所。
- `_gen` ライフサイクルガード（SpeakCore 同型）で dispose 後/再取得後の遅延 getUserMedia・MediaRecorder コールバックが torn-down 要素を触らないよう bail。

---

## 8. パッケージ構成: 2タグ1パッケージ【決定済】

→ **決定: `@wcstack/camera` の1パッケージに `<wcs-camera>` + `<wcs-recorder>` の2タグ**（2026-06-17・承認済・speech 同型）。
- `MediaStream` 取得部（getUserMedia + permission 二相 + ライフサイクル）を Core 共有。
- recorder は camera の stream を §2 の直結で受ける（**1 stream 共有**・recorder は自前 getUserMedia しない＝permission/取得の二重化を回避）。
- **論点 8-1（要検討）**: recorder 単独利用（外部 stream を直接食わせる headless 用途）を許すか。Core が stream を外から受ける口（`attachStream` command）は元々あるので、**recorder 単独でも `attachStream` 経由なら動く**（camera 必須にしない）。

---

## 9. 罠（README Notes 行き）

- **secure context（https）必須**。`getUserMedia` は非 https で `undefined`/例外。
- **インジケータ消えない＝リーク**: `track.stop()` 漏れの可視化。disconnect/visibility での解放を強調。
- **ユーザージェスチャ要件**: 一部ブラウザで getUserMedia はユーザー操作起点が要る。reactive（タイマー等）で撃つと無言で失敗 → never-throw で `error` に出す。
- **エラー分類**: `NotAllowedError`（拒否）/`NotFoundError`（デバイス無し）/`NotReadableError`（他アプリ使用中）/`OverconstrainedError`（制約不一致）を `error` detail で区別。
- **録画中のカメラ切替不可**（§3-c-1）・**stream 所有権は camera**（recorder は stop しない・§3-b）。
- **mimeType 互換**: `MediaRecorder.isTypeSupported` でブラウザ差（webm/mp4）。未指定はブラウザ既定。
- **objectURL revoke 漏れ**（§5-b）。

---

## 10. 横断・流用元

- permission/geo: permission 二相監視・`_permGen` 世代ガード・unsupported フォールバック・never-throw・secure-context・Core/Shell・SSR（`connectedCallbackPromise`）。
- speech: command/event-token 双対の2タグ構成・`command.<name>: <path>` 引数束縛・`_gen` ライフサイクルガード・dispose で in-flight 無効化。
- wakelock: desired/actual 二層・OS 起点の状態剥奪追従（track の `ended`/`NotReadableError`）。
- state-stream-type-design: 依存駆動 cancel/restart（switchMap 相当）＝ constraints 変更の restart（§3-c）。
- upload: `FileList|File[]` 入力＝blob 受け口（§5-c の一本道デモ接続点）。
- command-token-arguments: 位置引数素通し MUST ＝ §2 の直結チャネルの土台。

---

## 11. 決定事項まとめ（★=要決定で未確定）

| 論点 | 決定 |
|---|---|
| §1 生ハンドルの所在 | **state に入れない（案B 内包preview＋案C 直結）**・不変条件＝MediaStream は reactive state に格納しない |
| §2 直結チャネル | **command-token 引数素通し（案2-1）**・新規プリミティブ無し |
| §3-b 解放 | **disconnect で全 track.stop()**・desired/actual 二層・stop 権限は camera 単独 |
| §3-c-1 録画中の切替 ★ | 推奨: **録画中は constraints 変更拒否** |
| §3-d-1 visibilitychange ★ | 推奨: **録画中以外は hidden で stop・visible で再取得** |
| §4 サーフェス | **reactive（constraints）＋imperative（start 等 command）両採用** |
| §5-a-1 chunk 出力 ★ | 推奨: **既定は stop で1 Blob**・`timeslice` 指定時のみ dataavailable も event 化 |
| §5-b Blob/URL | **Blob は state OK**・objectURL は revoke ライフサイクル管理 |
| §6-1 2権限 ★ | 推奨: **camera/microphone を別 getter で publish**・audio 未使用時は microphone 非監視 |
| §8 パッケージ | **`@wcstack/camera` 1パッケージ・2タグ・Core 共有・1 stream 共有** |
| §8-1 recorder 単独 ★ | 推奨: **attachStream 経由で camera 無しでも動く** |

> 核（§1・§2・§8）は承認済確定。★は実装着手前に詰める実装時論点（多くは推奨で内定）。

---

## 12. 実装順の推奨

1. **`MediaStreamCore`（共有 Core）**: permission 二相監視（permission パッケージ流用）＋ `getUserMedia(constraints)` ＋ stream ライフサイクル（acquire/`track.stop()`/restart with `_gen`/desired-actual）＋ `error` 分類。non-serializable な stream は内部保持し event-token `streamReady` で publish（state には出さない）。
2. **`<wcs-camera>` Shell**: shadow DOM に `<video autoplay muted playsinline>` 内包（案B preview）＋ `srcObject` 内部代入。constraints 属性（`facing-mode`/`device-id`/`audio`/`width`/`height`）・reactive restart・`command.start/stop/switchCamera`・`active`/`permission`/`audioPermission`/`devices` を state へ。disconnect/visibility で stop。
3. **`<wcs-recorder>` Shell**: `command.attachStream`（stream を借りる・stop しない）＋ `MediaRecorder` ラップ＋ `command.start/stop/pause/resume` ＋ chunk 収集 → `recorded`(Blob) event-token ＋ `recording`/`paused`/`duration`/`blob`/`objectURL`（revoke 管理）を state へ。
4. **直結チャネル検証（PoC 先行推奨）**: §2 の `streamReady → $command.attachStream → recorder` を最小構成で実証。stream が state を一切経由せず video preview と recorder の両方に届くことを確認。
5. **example: カメラ撮影 → 録画 → アップロード一本道**。`<wcs-camera>` で preview、`$on.gotStream` で recorder へ直結、録画 Blob を `new File()` 化して既存 upload ノードへ。`<wcs-permission name="camera">` 併置で権限監視デモも。
6. **テスト**: `FakeMediaStream`/`FakeMediaStreamTrack`/`FakeMediaRecorder`/`getUserMedia` モック（[[intersection-tag-design]] の FakeIntersectionObserver 同型）。restart の世代ガード・二重 stop 防止・objectURL revoke・permission フォールバックを重点。
7. **README ja/en**（secure-context・インジケータ/リーク・ユーザージェスチャ・エラー分類・録画中切替不可・mimeType 互換・stream 所有権を明記）。
