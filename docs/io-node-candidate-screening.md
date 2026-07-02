# 非同期IOノード候補スクリーニング

- **対象**: `@wcstack` に次の非同期IOノードを追加する際の候補選定
- **状態**: 調査メモ（非規範）。個別ノードの実装が決まったら `docs/<name>-tag-design.md` を別途起草する（[async-io-node-guidelines.md](./async-io-node-guidelines.md) §1 MUST）。本書はその手前の「候補として妥当か」を篩い分けるための一次スクリーニング
- **既存25パッケージ**: `fetch` / `storage` / `upload` / `websocket` / `sse` / `broadcast` / `worker` / `timer` / `debounce` / `clipboard` / `geolocation` / `permission` / `notification` / `intersection` / `resize` / `wakelock` / `camera` / `speech` / `defined` / `router` / `autoloader` / `state` / `signals` / `server` / `vscode-wcs`（2026-07-01 時点、`packages/` 実ディレクトリで確認済み）

---

## 1. スクリーニング基準（3ゲート）

[async-io-node-guidelines.md](./async-io-node-guidelines.md) から、新規ノード候補が「アーキテクチャに乗るか」を判定する3つのゲートを抽出する。実装の巧拙ではなく、**その候補APIがこの骨格にそもそも乗る形をしているか**を問う。

1. **Gate 1 — Core が DOM 非依存で書けるか**（§3.1 MUST）。`navigator` / `globalThis.X` だけで完結するか。例外は「Element参照をコンストラクタでキャッシュせず `observe(target)` の引数として都度受け取る」形のみ（intersection/resize が先例）。この抜け道を使ってもなお要素の**内部構造**（レイアウト計算等）に依存しなければ許容範囲とする
2. **Gate 2 — observable surface が「1イベント＋派生 getter」に分解できるか**（§4.2）。複合状態を1つの `CustomEvent` に載せ、そこから boolean/値を派生 getter として切り出せるか。これができないと宣言的バインド（`hidden@granted` 相当）に落ちない
3. **Gate 3 — never-throw / `_gen` 世代ガード / 冪等 `observe()` が成立する購読 or コマンドモデルに収まるか**（§3.4–3.6）。API が「1回きりの解決」ではなく「途中終了・再開・重複呼び出し」に自然に耐える形をしているか

3ゲート全部を通ることは「実装可能」の必要条件であり、「ノード化すべき」の十分条件ではない。**observable surface が薄すぎる候補**（状態を持たず成功/失敗しかない一発コマンド）は3ゲートを通っても採否は別軸（§4 参照）。

---

## 2. スクリーニング結果

### グループA — 素直に通る（3ゲートとも無理なくクリア）

| API | Gate1 | Gate2 | Gate3 | 備考 |
|---|---|---|---|---|
| **Screen Orientation** (`screen.orientation`) | ✅ | ✅ `change` イベント → `type`/`angle` 派生getter | ✅ `lock()`/`unlock()` はcommand、状態はmonitor | ブラウザ対応良好。permission系と並ぶ「教科書的な最小構成」候補 |
| **Idle Detection** (`IdleDetector`) | ✅ | ✅ `change` イベント → `userState`/`screenState` 派生getter（permissionの4値パターンと同型） | ✅ `start({signal})`/`abort` が observe/dispose と自然対応 | Chromium系のみ・要permission。permissionノードの姉妹実装として好例 |
| **Network Information** (`navigator.connection`) | ✅ | ✅ `change` イベント → `effectiveType`/`downlink`/`saveData` 派生getter | ✅ 単純monitor | Safari/Firefox未対応（Chromium系のみ）。`unsupported`分岐の実例が増える |
| **Page Visibility** (`document.visibilitychange`) | ✅（`document`はglobal相当） | ✅ 単一イベント → `visibilityState`/`hidden` 派生getter | ✅ ほぼステートレス | 全ブラウザ対応。**ただし状態が単一boolean相当で薄く、パッケージ化する価値は要検討**（§4 境界ケース寄り） |
| **Web Locks** (`navigator.locks`) | ✅ | △ 単一イベントには載るが、lockの獲得が「callbackの実行期間=保持期間」という特殊な非同期モデル | △ observe()/dispose()との対応が非対称（明示release APIが無く、渡した関数の完了で自動解放） | Gate3がやや歪。実装可能だが `_gen` ガードの設計に一工夫要る |
| **Device Orientation/Motion** (`devicemotion`/`deviceorientation`) | ✅ | ✅ 単一イベント → `alpha`/`beta`/`gamma` 等の派生getter | ✅ | iOS Safariは明示的なユーザー操作起点のpermission要求が必須（secure-context分岐の実例） |
| **Generic Sensor API**（Accelerometer/Gyroscope/Magnetometer等） | ✅ | ✅ `reading` イベント → `x`/`y`/`z` 派生getter | ✅ | 各センサーごとに別クラス。permission-gated。Chromium系中心 |
| **Gamepad** (`navigator.getGamepads()`) | ✅ | ✅（`gamepadconnected`はイベントだが、ボタン/軸状態はAPI自体に変更イベントが無い） | ✅ ただし**ポーリングが必須**（`requestAnimationFrame`ループでCoreが内部合成イベントを発火）。`timer`パッケージの内部ポーリング先例があるので逸脱ではない | 唯一「イベント駆動でなくポーリングでイベントを合成する」パターン。設計ドキュメントでこの逸脱理由を明記する必要あり（ガイドライン冒頭のMUST NOT逸脱時の記録義務） |

### グループB — 例外路線（要素参照が必要、intersection/resizeと同型）

| API | 備考 |
|---|---|
| **Fullscreen** (`element.requestFullscreen()`) | `fullscreenchange`イベント→`fullscreenElement`派生。要素参照はcommand実行時の対象。intersection/resizeと同じ「observe(target)」形が素直に成立 |
| **Picture-in-Picture** (`video.requestPictureInPicture()`) | `<video>`要素限定。イベント`enterpictureinpicture`/`leavepictureinpicture`。camera/recorderの隣接候補 |
| **Pointer Lock** (`element.requestPointerLock()`) | `pointerlockchange`イベント。ゲーム/描画UI向けで需要は限定的 |

これらは「Shellが要素をターゲットとして扱う」既存パターン（`<wcs-infinite-scroll target="...">`）を転用できる。

### グループC — 境界ケース（command専用・observable surfaceが薄い）

3ゲートは通るが、**状態を持たず成功/失敗しかない一発コマンド**に分類される。ガイドライン§1が許容する「command専用」方向そのものだが、Core/Shell分離・`_gen`世代ガードの恩恵が薄く、**パッケージ化の経済合理性が別途問われる**。

| API | 備考 |
|---|---|
| **Web Share** (`navigator.share()`) | 一発command。observable surfaceなし（Promiseのresolve/rejectのみ） |
| **EyeDropper** | 同上。UI操作を伴う一発command |
| **Contact Picker** (`navigator.contacts.select()`) | 同上 |
| **Beacon** (`navigator.sendBeacon()`) | 同期API・戻り値はboolean一つ。Core/Shellの必要性がほぼ無い。`fetch`のcompanionオプションとして畳み込む方が筋が良い可能性 |
| **Credential Management** (`navigator.credentials.get/store`) | commandだが認証フローの複合状態（success/NotAllowedError等）を持ち、A寄りの境界。never-throwの実利が大きい候補 |
| **Media Session** (`navigator.mediaSession`) | 特殊: ページ側が`setActionHandler`でOSからのcommandを**受信**する逆方向構造。event-token的だが「OSが発火元」という点で既存プロトコルと向きが異なり、単純な分類に収まらない。要個別設計検討 |

### グループD — 弾かれる/大掛かりな設計判断が要る

| API | 理由 |
|---|---|
| **Web Audio** (`AudioContext`) | ノードグラフ構造。単一イベント＋派生getterに畳めない（Gate2不成立） |
| **WebRTC** (`RTCPeerConnection`) | シグナリング・ICE・SDP交換を伴う多段階の状態機械。単一ノードの粒度を超える |
| **Web Bluetooth / WebUSB / WebHID / Web Serial** | 接続状態機械が複雑（scan→pair→connect→characteristic監視）。Chromium系限定で標準化途上。`websocket`より一段重い設計判断が要る（[[file-blob-io-node-design-discussion]]のような横断検討が先に要る） |
| **Payment Request** | ブラウザネイティブUIダイアログが介在し、Shell/Coreの薄いラップに収まらない |
| **File System Access** (`showOpenFilePicker`等) | ハンドルベースの永続的なpermission/capabilityモデル。`upload`との役割分担整理が先決 |
| **IndexedDB** | [[file-blob-io-node-design-discussion]]で既出（storage blob対応の受け皿）。単独で1パッケージ相当の大きさ、別途スコープ |
| **Cache Storage / Background Sync / Background Fetch / Push / Periodic Background Sync** | Service Worker前提でスコープが`notification`と重複・干渉しうる。低優先度、まとめて別議論 |

---

## 3. 推奨ショートリスト（次に着手する場合）

アーキテクチャ適合・ブラウザ対応・既存ノードとの非重複を総合した優先順位。

1. **Screen Orientation** — 最も摩擦が少ない。`permission`と並ぶ「教科書的な最小構成」の2例目として、ガイドライン検証・レビュー体制の慣らし運転にも向く
2. **Fullscreen** — グループBの実証。intersection/resizeの「要素参照」パターンが単一observerを超えて一般化できるかの試金石
3. **Idle Detection** — `permission`の4値パターンの応用として設計しやすいが、Chromium限定・要permissionの分岐が絡む分、1・2より一段複雑
4. **Device Orientation/Motion** — 需要（傾き操作・AR系UI）はあるが、iOS Safariのpermission要求（ユーザー操作起点必須）を設計に織り込む必要がある

**Gamepad**（ポーリング合成という逸脱）と**Web Locks**（release非対称という逸脱）は、既存の8原則から外れる箇所を持つため、着手するなら先に設計ドキュメントで逸脱理由を明記すること（ガイドライン冒頭のMUST NOT逸脱時記録義務）。

**Page Visibility**・グループCの一発command系は、「わざわざ1パッケージにする価値があるか」を先にAskUserQuestion等で決着してから着手する。

---

## 4. 未決事項

- グループCの一発command系を個別パッケージ化するか、既存ノード（`fetch`のbeaconオプション等）へ畳み込むかの方針
- Media Session の「OS起点のcommand受信」を既存プロトコル（command-token/event-token）にどう位置づけるか
- Gamepad のポーリング合成パターンをガイドラインの正式な「許容逸脱パターン」として明文化するか
