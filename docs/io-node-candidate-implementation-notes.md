# 非同期IOノード候補: 実装論点集

> **注記（現況・2026-07）**: 本書は候補選定時点のスナップショットである。ここで「候補/未着手/将来」として扱う IO ノードの多くは既に `packages/` 配下に実装済み（accelerometer / ambient-light-sensor / broadcast / camera / clipboard / contacts / credential / debounce / defined / eyedropper / fetch / fullscreen / geolocation / gyroscope / idle / intersection / magnetometer / network / notification / permission / picture-in-picture / pointer-lock / resize / screen-orientation / share(web-share) / speech / sse / storage / tilt / timer / upload / wakelock / websocket / worker 等）。個別の「タグ名案」「実装論点」の記述は当時の計画であり現況とは異なる（実装済みノードは各 `docs/<name>-tag-design.md` と README を正とする）。

- **対象**: [io-node-candidate-screening.md](./io-node-candidate-screening.md) でスクリーニングした各API候補について、実装に着手する場合に検討すべき論点を書き出す
- **状態**: 調査メモ（非規範）。ここでの検討は「実装した場合にぶつかる壁」の洗い出しであり、設計決定ではない。実装着手時は改めて `docs/<name>-tag-design.md` を起草すること（[async-io-node-guidelines.md](./async-io-node-guidelines.md) §1 MUST）
- **注記**: API仕様・ブラウザ対応状況は執筆時点の把握であり、着手時に一次情報（MDN / spec）で再検証すること

---

## グループA — 素直に通る候補

### 1. Screen Orientation

- **API**: `screen.orientation.type`/`.angle`、`change`イベント、`lock(type)`/`unlock()`（Promise、reject/throwあり）
- **タグ名案**: `<wcs-orientation>` / event prefix `wcs-orientation:`
- **方向性**: 双方向（monitor + lock/unlock command）

実装論点:
- `lock()`は多くの実装でモバイル限定・特定条件下でのみ動作し、デスクトップでは`NotSupportedError`等でrejectしやすい → never-throwで`error`へ吸収。「lockが効かない環境」を`unsupported`状態として明示するかは要判断
- `screen.orientation`自体がEventTargetなので`addEventListener`/`removeEventListener`をそのまま使える。API解決は`typeof screen !== "undefined" && screen.orientation`で毎回チェック（§3.7）
- `type`から`portrait`/`landscape`の派生boolean getterを切るのは「1イベント+派生getter」の典型例（permissionの4値パターンと同型）
- Fake double: `FakeScreenOrientation extends EventTarget`で`type`/`angle`/`lock`/`unlock`をスタブすれば足りる。既存ノードのFake実装パターンを流用可能

### 2. Idle Detection

- **API**: `new IdleDetector()`、`.start({threshold, signal})`（Promise）、`'change'`イベント、`.userState`/`.screenState`。**別に静的**`IdleDetector.requestPermission()`（要user gesture）
- **タグ名案**: `<wcs-idle>`
- **方向性**: monitor専用（`commands: []`）— `permission`パッケージと同型

実装論点:
- `requestPermission()`はuser gesture文脈でのみ成功する。Shellの`connectedCallback`は基本gesture外なので、**`observe()`内で自動的に叩けない** → 明示的な`requestPermission`commandを公開し、呼び出し元（ユーザーのクリックハンドラ）に叩かせる設計が必須。この論点は既存`permission`パッケージが同じ問題をどう解決しているか先に確認し、パターンを踏襲すべき
- `start({signal})`はAbortSignalでキャンセルする設計 → `dispose()`は新しい`AbortController.abort()`、`_gen`は「都度新しいAbortControllerを発行」でwebsocket/geolocationの再接続パターンに近い形になる
- `threshold`は仕様上60秒以上必須という制約があり、不正値はcatchして`error`へ
- Chromium系限定のAPI → `typeof IdleDetector === "undefined"`のunsupported分岐必須
- Fake double: `EventTarget`ベースの`FakeIdleDetector`＋静的`requestPermission`のモック（クラス自体を差し替える必要があり、他ノードのFakeより一段複雑）

### 3. Network Information

- **API**: `navigator.connection`（`NetworkInformation`、非標準拡張）、`.effectiveType`/`.downlink`/`.rtt`/`.saveData`、`'change'`イベント
- **タグ名案**: `<wcs-network>`
- **方向性**: monitor専用

実装論点:
- Safari/Firefoxで`navigator.connection`が未実装 → `_api()`が`undefined`を返す前提を最初から設計に織り込む。unsupported時の各プロパティ既定値（`null`/`false`固定）を決める
- 命令面が無く、desired/actualの区別も不要な最も単純なmonitorノードの一つ
- Fake double: `EventTarget`ベースの`FakeConnection`に`effectiveType`等をプロパティとして持たせるだけで足りる

### 4. Page Visibility

- **API**: `document.visibilityState`（`'visible'`|`'hidden'`）、`document`への`'visibilitychange'`イベント
- **タグ名案**: `<wcs-visibility>`
- **方向性**: monitor専用

実装論点:
- **DOM依存が`navigator`ではなく`document`**という点で他候補と異なる。Gate1（§3.1）の「navigator/globalThis.Xだけ」という原則の対象に`document`グローバルを含めてよいかは、`screen.orientation`（同じく`screen`を触る）を先例として扱えるかの整理が要る
- 状態が実質1個（`visibilityState`）で、「1イベント+派生getter」を持ち出すまでもなく単純 → **単独パッケージとして立てる価値が薄い**。作るなら教材的価値が主目的になる
- 非同期処理が実質無いため`_gen`世代ガードが不要（fetchの`observe()`が即`_ready`を返すのと同型の「ほぼ同期的なノード」の扱いをどう位置づけるか）
- 既存`intersection`（要素のビューポート内可視性）との名前・概念の混同に注意（「タブが見えているか」と「要素が画面内か」は別物）

### 5. Web Locks

- **API**: `navigator.locks.request(name, {mode, ifAvailable, signal}, callback)` — **callbackが返すPromiseがresolveするまでロックを保持し続ける**という独特のモデル。明示的な`release()`は仕様に存在しない
- **タグ名案**: `<wcs-lock>`
- **方向性**: 双方向（acquire=command, held=monitor）

実装論点:
- **他候補に無い非対称モデル**: 「保持期間 = 渡したcallbackの実行期間」という設計のため、単純な`acquire()`/`release()`commandペアに素直には落ちない
- 実装案: Core内部で「保持を継続させる内部Promise」を持ち、外側から`resolve`できる関数を保持しておくことで、擬似的な`release()`commandを合成する必要がある。**これはガイドラインに無い新しい実装パターン**であり、設計ドキュメントで明示的に扱う必要がある
- `_gen`ガードは`signal`（AbortSignal）経由で`abort()`、`dispose()`時も同様
- `ifAvailable:true`でロック取得失敗時は`callback(null)`が呼ばれる仕様 → これを`error`扱いにするか、通常のfalse状態にするかの設計判断
- ユースケースが「複数タブ間の排他制御」なので`broadcast`パッケージとの役割分担・併用パターンをREADMEで明示する価値がある

### 6. Device Orientation/Motion

- **API**: `window`への`'deviceorientation'`（`alpha`/`beta`/`gamma`）/`'devicemotion'`イベント。iOS 13+ Safariは静的`DeviceOrientationEvent.requestPermission()`（要user gesture）
- **タグ名案**: `<wcs-tilt>`（Screen Orientationとの名前衝突回避）
- **方向性**: monitor専用

実装論点:
- iOSの`requestPermission()`は**Idle Detectionと全く同じ「gesture-gated静的メソッド」問題**を抱える → 先に実装した方をもう一方の参照実装にできる
- 非iOSブラウザには`requestPermission`自体が存在しない → `typeof DeviceOrientationEvent?.requestPermission === "function"`で分岐し、無ければ即購読開始
- secure context（HTTPS）必須
- ブラウザ間で角度の精度・`event.absolute`フィールドの扱いに差異がある可能性、Fake double作成時に要注意

### 7. Generic Sensor API

- **API**: `Accelerometer`/`Gyroscope`/`AmbientLightSensor`/`Magnetometer`（共通の`Sensor`基底）。`.start()`/`.stop()`、`'reading'`イベント、`.x`/`.y`/`.z`。エラーは例外throwでなく`'error'`イベントで通知
- **タグ名案**: センサー種別ごとに個別ノードか、`<wcs-sensor type="accelerometer">`で一本化するか
- **方向性**: monitor専用

実装論点:
- **粒度決定が最初の論点**: 4種を1ノードで`type`属性切替にするか、4パッケージに分けるか。API形状はほぼ共通なので実装共有は容易だが、`camera`/`recorder`のようにタグを分ける既存慣習に照らすと分割の方が一貫性がある
- `'error'`イベントで失敗を通知する設計自体がnever-throw原則と一致しており、実装は素直
- Permissions APIとの連携必須（`navigator.permissions.query({name:"accelerometer"})`）→ `permission`パッケージとの組み合わせを前提にするか、内部で独自にクエリするか要検討
- Chromium系・Android実機がメインで、デスクトップでは`SecurityError`になりやすい → unsupported分岐を厚めに用意

### 8. Gamepad

- **API**: `navigator.getGamepads()`（null埋め配列）。イベントは`'gamepadconnected'`/`'gamepaddisconnected'`のみで、**ボタン/軸の値変化にイベントが無い**
- **タグ名案**: `<wcs-gamepad>`
- **方向性**: monitor専用

実装論点:
- **唯一のポーリング型ノード**。`requestAnimationFrame`ループをCore内部で回し、毎フレーム`getGamepads()`のスナップショットを前フレームと比較、差分があった時だけ`CustomEvent`を発火（同値ガードがフレーム単位で自然に成立する）
- `dispose()`で`cancelAnimationFrame`、`_gen`は「rAFループのIDが現世代と一致するか」でガードする（`timer`パッケージの内部ポーリング実装パターンを転用できないか要確認）
- 複数ゲームパッド接続時、配列全体を公開するか単一index指定属性にするかの設計判断
- 「APIが自らイベントを発火する」という8原則の暗黙の前提から外れる**唯一の逸脱パターン**。設計ドキュメントで逸脱理由を明記する必要がある（ガイドライン冒頭のMUST NOT逸脱時記録義務）

---

## グループB — 例外路線（要素参照が必要）

### 9. Fullscreen

- **API**: `element.requestFullscreen()`（要user gesture）、`document.exitFullscreen()`、`'fullscreenchange'`イベント（document）、`document.fullscreenElement`
- **タグ名案**: `<wcs-fullscreen target="...">`

実装論点:
- `target`属性で対象要素idを参照する設計は`intersection`/`resize`の「Shell自身でなく指定要素を対象にする」パターンをそのまま転用できる
- `requestFullscreen()`はuser gesture必須で、gesture文脈外の呼び出しはreject → never-throwでcatchするしかなく、呼び出し元の責務であることをREADMEで明示する必要がある
- 一部のSafariバージョンでベンダープレフィックス実装が残る可能性 → API解決層（`_api()`相当）で吸収
- `fullscreenElement`は**document全体で1要素のみ**が持てる値なので、複数の`<wcs-fullscreen>`が同時に存在する場合「自分がfullscreen中か」は`fullscreenElement === target`の比較で判定する必要がある

### 10. Picture-in-Picture

- **API**: `videoElement.requestPictureInPicture()`、`'enterpictureinpicture'`/`'leavepictureinpicture'`イベント（video要素上）、`document.pictureInPictureElement`
- **タグ名案**: `<wcs-pip target="...">`（`<video>`要素限定）

実装論点:
- 対象が**`<video>`要素のみ**という制約があり、`target`解決時に`tagName === "VIDEO"`を確認しないものはerrorにする必要がある
- `camera`/`recorder`パッケージが扱う`<video>`との連携シナリオ（録画プレビューをPiPで見る等）が自然に発生する → READMEでの言及価値あり
- 任意DOM要素をPiP化できる新仕様（Document Picture-in-Picture API）も別途存在する → 初版は`<video>`限定の旧APIにするか、新APIも含めるかのスコープ決定が要る
- Fullscreenと同様「ブラウザ全体で1要素のみ」という制約を持つ

### 11. Pointer Lock

- **API**: `element.requestPointerLock()`、`'pointerlockchange'`イベント（document）、lock中の`mousemove`で`movementX`/`movementY`
- **タグ名案**: `<wcs-pointer-lock target="...">`

実装論点:
- 用途がゲーム/描画UI限定で、wcstackの「宣言的SPA構築」という主眼からは外れ気味 → **優先度は低い**、需要確認が先
- lock中の`mousemove`は高頻度イベント → Core側で間引くか、`debounce`/`throttle`パッケージとの組み合わせを前提にするかの設計判断が要る

---

## グループC — 境界ケース（一発command・observable surfaceが薄い）

### 12. Web Share

- **API**: `navigator.share({title, text, url, files})`（Promise）。`canShare(data)`で事前検証可能。ユーザーキャンセルは`AbortError`
- **タグ名案**: `<wcs-share>`

実装論点:
- 状態を持たないため`properties`が実質空に近い → ガイドラインが明示する「monitor専用は`commands: []`」の逆パターン（「command専用で`properties`がほぼ空」）はwcstackに前例が薄く、**新しい形の先例になる**
- `AbortError`（ユーザーキャンセル）を失敗として`error`に含めるか、専用の`cancelled`状態として分けるかの判断が要る
- `canShare()`の結果を事前チェック用getterとして公開するかも論点

### 13. EyeDropper

- **API**: `new EyeDropper().open()`（Promise）。キャンセルは`AbortError`
- **タグ名案**: `<wcs-eyedropper>`

実装論点: Web Shareとほぼ同型（状態が薄い一発command）。Chromium系限定でunsupported分岐の比重が高い

### 14. Contact Picker

- **API**: `navigator.contacts.select(properties, {multiple})`（Promise）
- **タグ名案**: `<wcs-contacts>`

実装論点: Web Shareと同型の論点構成。Android Chrome限定でデスクトップ非対応が大半 → unsupportedがデフォルトの環境が多いことを前提に設計する

### 15. Beacon

- **API**: `navigator.sendBeacon(url, data)` — **同期API、Promiseすら返さずbooleanを即返す**

実装論点:
- 非同期IOノードの骨格（`_gen`世代ガード・observe/dispose）がほぼ不要なほど単純
- 用途が「ページ離脱時の送信」（`visibilitychange`/`pagehide`ハンドラ内での使用）に限定される → 単独ノード化するより**`fetch`パッケージへの`beacon`モード追加**の方が既存資産の再利用として筋が良い可能性が高い

### 16. Credential Management

- **API**: `navigator.credentials.get({password, federated, publicKey})`/`.store(credential)`（Promise、reject理由が多様）
- **タグ名案**: `<wcs-credentials>`

実装論点:
- `publicKey`オプション（WebAuthn）まで含めるとスコープが急激に複雑化する → **初版はpassword/federatedのみに限定**し、WebAuthnは別ノード（`<wcs-webauthn>`）として切り出す判断が要る
- ブラウザのネイティブUI（パスワード選択ダイアログ等）が介在するため、呼び出しタイミング（gesture要否）の制約確認が必要
- reject理由が多岐にわたるためnever-throwの実利は大きい候補

### 17. Media Session

- **API**: `navigator.mediaSession.metadata = new MediaMetadata(...)`、`.setActionHandler(actionName, handler)` — **OS/ブラウザのメディアコントロールUIからのアクションをページが受信する逆向き構造**
- **タグ名案**: `<wcs-media-session>`

実装論点:
- **方向性がevent-token的**（OS操作→ページへの通知）だが、発火元が「ユーザー入力」でも「他の宣言的ノード」でもなく**OS/ブラウザ本体**という点で、command-token/event-tokenのどちらにも綺麗に収まらない。設計ドキュメントで「第三の方向」として扱うか、event-tokenの特殊系とみなすかの決定が要る
- `metadata`のセットはinputs的、`setActionHandler`群（十数種のアクション名）は各アクションを個別の`event`として`properties`に列挙するのが自然（`{name:"playRequested", event:"wcs-media-session:play"}`等）
- 音声/動画再生を扱う既存または将来のノードとの組み合わせが前提になるユースケースが多い

---

## グループD — 弾かれる候補（参考: 着手する場合の主要な壁）

深掘りはしないが、将来議論が再燃した際のために「なぜ難しいか」の技術的な壁を記録する。

- **Web Audio**: ノードグラフ全体を宣言化するのはスコープ外。限定するなら`AudioContext.state`（running/suspended/closed）の変化だけを監視する薄いラッパーに絞る手はある
- **WebRTC**: シグナリング（SDP交換）は別途signalingサーバーとの通信（既存`websocket`ノード等）が前提で、単一ノードでは完結しない。着手するなら「シグナリングは`websocket`に任せ、`RTCPeerConnection.connectionState`等の監視だけに限定するノード」が現実的な最小スコープ
- **Web Bluetooth/USB/HID/Serial**: scan→pair→connect→characteristic監視の多段階状態機械。`websocket`の`connect/disconnect/reconnect`パターンを参考にできるが、各段階のuser-gesture要求・permission要求が絡み複雑。着手するなら需要が最もありそうな1つ（Web Bluetooth）から
- **Payment Request**: ネイティブUIダイアログが結果を待つ間ページを占有し、「バックグラウンドで進行し状態をイベント通知する」既存モデルとそもそも相性が悪い
- **File System Access**: ハンドル（`FileSystemFileHandle`）の永続化・再認可（`requestPermission()`）モデルが複雑。`upload`との住み分け整理が先決
- **IndexedDB**: [[file-blob-io-node-design-discussion]]記載の通り、`storage`パッケージのblob対応の受け皿として再検討すべき別件
- **Cache Storage/Background Sync/Background Fetch/Push/Periodic Background Sync**: Service Worker前提。`notification`が既にSW登録パターンを持つため流用できる部分はあるが、スコープの線引きが先

---

## 横断的な観察

- **Idle Detection と Device Orientation/Motion** は「user gesture起点の静的`requestPermission()`」という同一の壁を持つ。どちらかを先に実装すれば、もう一方はそのパターンをほぼそのまま転用できる
- **Web Share / EyeDropper / Contact Picker / Credential Management** は「状態を持たない一発command」という共通の形をしており、wcstackにまだ前例が無い「`properties`がほぼ空のcommand専用ノード」という新しい雛形を1つ作れば残りは横展開できる
- **Gamepad のみ**が「APIが自らイベントを発火しない＝ポーリングでイベントを合成する」という8原則からの逸脱を持つ。着手する場合はここを最初に解決し、他候補には影響しない
- **Fullscreen / Picture-in-Picture / Pointer Lock** は`intersection`/`resize`の`target`属性パターンをそのまま転用できるグループとして一括りで検討できる
