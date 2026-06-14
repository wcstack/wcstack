# 設計メモ: `@wcstack/notification`（`<wcs-notify>`）

- **状態**: 設計検討中（未実装）。本文書は実装前の論点整理と決定事項のスナップショット。
- **対象 WebAPI**: Notifications API（`Notification` コンストラクタ、`Notification.requestPermission()`、`Notification.permission`、`click`/`close`/`show`/`error` イベント）。Push API（サーバ起点）は別物でスコープ外。
- **位置づけ**: OS レベルのデスクトップ通知を宣言的に state 化する IO ノード。**command-token（表示）と event-token（クリック/クローズ）の双対が「1つのAPI・1タグ内」で完結する初の例**。
- **前提資産**: permission（permission 二相監視・4値 state・派生 boolean getter・`_permGen` 世代ガード・unsupported・never-throw・zero-log・secure-context・Core/Shell・SSR）、speech/SpeakCore（imperative command・引数束縛 `command.<name>: <path>`・`_gen` ライフサイクルガード・dispose で in-flight を無効化）、broadcast（タブ/SW 境界越えの pub/sub）、event-token / command-token プロトコル、wc-bindable protocol v1。

---

## 0. 大前提: このノードは「双方向が1タグで閉じる」初の例

これまでの双方向の実証は構成が分かれていた:

| ノード | command-token（state→element） | event-token（element→state） | 構成 |
|---|---|---|---|
| `<wcs-permission>` | なし（request 標準が無い） | あり（権限変化） | 片肺（event 専用） |
| `@wcstack/speech` | `<wcs-speak>` の `speak` | `<wcs-listen>` の認識結果 | 双対を**2タグ**で実現 |
| `<wcs-notify>` | **`notify`（表示）** | **`click`/`close`/`show`/`error`** | **双対を1タグで実現** |

> notification は「表示せよ（command）」と「クリックされた（event）」が同じ API・同じタグに同居する。command-token／event-token プロトコルの対称性を、1ノードで丸ごと実証できる唯一の題材。[[command-token-protocol]] / [[event-token-protocol]] / [[command-token-arguments-proposal]] の参照実装として価値が高い。

---

## 1. permission の所有権 — **request 標準が「ある」ことの含意**【最重要・要決定】

notification 固有の最大論点。`<wcs-permission>` は `request()` 標準が無いため command-token が成立しない片肺ノードになった（[[permission-tag-design]] §0）。**Notification は逆に `Notification.requestPermission()` という request 標準を持つ**ため、command-token が成立する。

| 案 | request の扱い | トレードオフ |
|---|---|---|
| **A 自己完結** | notify タグが `command.request:` を持ち、自分で `Notification.requestPermission()` を撃つ | geo が `getCurrentPosition` で暗黙にプロンプトするのと同じく「機能ノードが許可を取りに行く」責務。permission-tag-design §2 の責務分離（取りに行くのは機能ノード側）と整合。単独で完結 |
| B 委譲 | 監視は `<wcs-permission name="notifications">` に任せ、notify は show のみ | 責務は綺麗に分離するが「request は誰が？」の穴が残り、結局 A が必要になる |
| C ハイブリッド | show 時に permission が `default` なら自動 request してから表示 | DX 最良。ただしユーザージェスチャ要件（§7 罠）と衝突しやすく、暗黙挙動が「魔法」化する |

**推奨: 案A**（command として明示）＋ permission state は本ノードが内部監視して publish。`<wcs-permission>` 併置で監視を重ねるのは利用者の自由（責務分離デモにはなる）。

→ **決定: 案A（自己完結）**（2026-06-14）。`command.request` を持ち、permission state は内部監視で publish。`commands = [request, notify, notice(reactive側は input), close, closeAll]`。

---

## 2. show = command-token（引数束縛の参照実装）

`command.notify: $command.showAlert` のように配線し、state 側で `this.$command.showAlert.emit(title, options)`。

```html
<wcs-notify data-wcs="command.notify: $command.showAlert; eventToken.click: alertClicked"></wcs-notify>
```
```js
$commandTokens: ["showAlert"],
$eventTokens: ["alertClicked"],
$on: {
  alertClicked: (state, event) => { /* event.detail = {tag, data} */ }
}
// どこかで: this.$command.showAlert.emit("新着メッセージ", { body: "...", tag: "msg-42" })
```

- [[command-token-arguments-proposal]] の「位置引数素通し（MUST）」がそのまま効く。`emit(title, options)` → `notify(title, options)` へ透過。speech の `speak(text, options)` と完全同型。
- commands 候補: `notify`（表示）／`close`（tag 指定でクローズ）／`closeAll`（全クローズ）。

### 2-b. reactive input 版を併設するか — **要検討**

speech は論点5で reactive `say`（same-value ガード有）＋ imperative `speak`（毎回発火）を両採用した（[[speech-tag-design]]）。通知は「状態が変わるたびに自動で OS 通知を出す」用途が**むしろ危険**（通知スパム）なので:

→ **決定: 両採用**（2026-06-14・speech と対称）。発火条件で住み分け、軸＝「same-value 再発火するか」。

| | input/command | 起動 | same-value | 用途 |
|---|---|---|---|---|
| reactive `notice` | input（束縛元の変化で発火） | 暗黙 | ガード**あり**（重複抑止） | 状態変化を通知（在庫切れ・新着件数）。**スパム防止が前提** |
| imperative `notify` | command（`command.notify: $command.X`） | 明示 emit | **毎回発火** | 「今これを通知」（ボタン押下・到着イベント） |

- 命名: speech の `say`(reactive)/`speak`(command) 改名前例に倣い別名。reactive=`notice`、imperative command=`notify`。
- **reactive のスパム防止が新論点（§2-c）**: 通知の自動発火は危険度が speech より高い（OS 通知を撃つ）。same-value ガード必須＋debounce 前提＋`tag` による OS 側 dedupe を推奨。reactive がバインドするのは**タイトル文字列1パス**（options は属性 `body`/`icon`/`tag` から）。`notice@unreadLabel|debounce(1000)` のように利用者が debounce を噛ませる前提。

---

## 3. click/close/show/error = event-token（インスタンス識別が新論点）

通知イベントを state が `$on` で受ける。event-token の純粋な実証。`click → router 遷移 / window.focus()` を「event-token 受信 → command-token 発火」のチェインで書ける（[[event-token-protocol]] の連鎖パターン）。

### 3-b. 【新論点】複数インスタンスの識別

speech は単一発話キューだったが、**notification は複数通知が同時に開きうる**。「どの通知がクリックされたか」を識別する必要。既存タグに無かった論点。

- 各 `notify(title, options)` の `options.tag` / `options.data` を Core が保持し、イベント payload（`event.detail`）に `{ tag, data }` を載せる。
- state 側は `event.detail.tag` で分岐。tag 未指定時は **Core 採番の内部 id**（`wcs-<n>`）を振り、constructor 経路と SW 経路で同一形に揃える（SW の `notificationclick` でも tag が必須キーになるため）。

→ **決定: `{ tag, data, action }` 固定**（2026-06-14）。tag 未指定は Core 採番 id。`action` は SW 通知のアクションボタン用（constructor 経路では常に `""`）。constructor/SW 両経路で payload 形を統一。

---

## 4. インスタンスのライフサイクル管理【要検討】

- `new Notification()` が返すインスタンスを Core が追跡（tag → Notification の Map）。同一 tag の再 notify は OS が置換するので Map も置換。
- `requireInteraction`（自動で消えない）・auto-close の扱い。OS/ブラウザ任せが基本だが、明示 `close(tag)` command は提供。
- **dispose 時に開いている通知を close するか**: speech は `cancel()` で全停止した。通知は「タブを離れても残ってほしい」のが通常 → **dispose では close しない（残す）**。SW 経由通知は元々ページ非依存で残るのが正なので、constructor 経路もそれに揃える。
- `_gen` ライフサイクルガード（SpeakCore 同型）で、dispose 後／再接続後の遅延 click コールバックが torn-down 要素を触らないよう bail。BroadcastChannel 購読も dispose で解除（`_gen` で遅延メッセージを無効化）。

→ **決定: dispose では close しない（通知は残す）**（2026-06-14）。明示 `close`/`closeAll` command のみが閉じる。

---

## 5. Service Worker 通知対応 — **v1 スコープ外を推奨**【要決定】

`new Notification()` は**デスクトップのみ**。Android Chrome 等モバイルでは `ServiceWorkerRegistration.showNotification()` が必須で、`new Notification()` は `TypeError` を投げる。

- SW 経由だと click は **SW の `notificationclick` ハンドラ**で発火 → state（メインスレッド）に戻すのに `postMessage` / BroadcastChannel が必要（[[broadcast-tag-design]] と連携）。click を event-token に戻す経路が一気に複雑化。

→ **決定: v1 から SW も含める**（2026-06-14・モバイル必須のため妥協しない）。以下のサブ論点が派生:

### 5-a. backend 選択（constructor vs SW）— **要決定**

- 案1 auto: `ServiceWorkerRegistration` が `ready` かつ `new Notification` が使えない/モバイルなら SW、さもなくば constructor を feature-detect で自動選択。
- 案2 explicit: `mode="auto|sw|constructor"` 属性で利用者が明示。
- **推奨: 案1 auto を既定**、`mode` 属性で上書き可（既定 `auto`）。constructor が `TypeError` を投げたら SW へフォールバックも併用。

→ **決定: 案1 auto 既定＋`mode="auto|sw|constructor"` 上書き**（2026-06-14）。auto は「SW registration が ready で `new Notification` が利用不可（モバイル）なら SW、さもなくば constructor」。constructor 経路の `TypeError` 時は SW へフォールバック。

### 5-b. SW 側 click 受信の経路 — **要決定（最重要サブ論点）**

SW の `notificationclick` は **利用者の Service Worker 内**で発火する。wcstack はそこへコードを注入できないため、**SW 側ヘルパを別エントリで提供し利用者が1行 import する**必要がある:

```js
// 利用者の sw.js
import { wireNotificationClicks } from "@wcstack/notification/sw";
wireNotificationClicks();   // notificationclick を拾い BroadcastChannel("wcs-notify") へ転送
```

- メインスレッドの `NotificationCore` は `BroadcastChannel("wcs-notify")` を購読し、受信メッセージ（`{tag, data, action}`）を `wcs-notify:click` event-token に変換。
- 代替: `clients.matchAll().postMessage()` 直送（BroadcastChannel 不在環境向け）。
- README に「SW 利用時は `wireNotificationClicks()` の1行が必須」を明記。これが SW 対応の利用コスト。

→ **決定: SW 側ヘルパ `@wcstack/notification/sw` ＋ BroadcastChannel 主・postMessage フォールバック併用**（2026-06-14）。`wireNotificationClicks()` は両方へ転送し、Core は BroadcastChannel を購読（不在環境は SW message イベント経由 postMessage を購読）。重複受信は payload の Core 採番 id で de-dup。テストは両経路をモック。

---

## 6. 公開する state（値サーフェス草案）

`NotificationCore`:

```
permission: NotificationPermissionState   // §6-b 参照
granted / denied / default / unsupported : boolean   // 派生 getter
error: WcsNotifyErrorDetail | null         // never-throw でここに出す
lastClick: { tag, data } | null            // 直近クリックの識別子（event-token と別に状態でも保持するか要検討）
```

- commands: `notify` / `close` / `closeAll`（§1 の決定次第で `request` を追加）。
- events: `wcs-notify:permission-changed` / `:click` / `:close` / `:show` / `:error`。

### 6-b. 【新論点】permission の値が geo/permission と違う

Notification API の permission 値は **`"default" | "granted" | "denied"`**。geo/permission の `"prompt" | "granted" | "denied" | "unsupported"` と**「default」対「prompt」がズレる**。

- 案X: raw 維持（`"default"` をそのまま publish）。API 忠実だが既存4値と非互換。
- 案Y: `"default"` → `"prompt"` に正規化し、既存ノードと state 型を共有（`PermissionStateOrUnsupported`）。横断的に `hidden@granted` 等が同じ書き味になる。

**推奨: 案Y（prompt 正規化）**。派生 getter は `prompt`（=API の default）に揃える。

→ **決定: 案Y（prompt 正規化）**（2026-06-14）。`default`→`prompt` に正規化、state 型は `PermissionStateOrUnsupported` を permission パッケージと共有。派生 getter は `granted`/`denied`/`prompt`/`unsupported`。

---

## 7. 罠（README Notes 行き）

- **ユーザージェスチャ要件**: `requestPermission()` と表示は一部ブラウザでユーザー操作起点が要る。state 駆動（非ジェスチャ・タイマー等）で撃つと無言で出ない → §1 案C が衝突しやすい根拠。
- **secure context（https）必須**。
- permission `denied` での silent failure（never-throw で `error` に出す）。
- フォーカス中タブでは表示されない/抑制される OS 挙動差。
- `new Notification()` がモバイルで `TypeError`（§5）。

---

## 8. 横断・流用元

- permission/geo: permission 二相監視・`_permGen` 世代ガード・unsupported フォールバック・never-throw・zero-log・secure-context・Core/Shell・SSR（`connectedCallbackPromise`）。
- speech/SpeakCore: imperative command・`command.<name>: <path>` 引数束縛・`_gen` ライフサイクルガード・dispose で in-flight 無効化（ただし通知は close しない方向・§4）。
- broadcast: SW 経由 click を state に戻す将来経路（§5・後続）。

---

## 9. 決定事項まとめ（★=要決定で未確定）

| 論点 | 決定 |
|---|---|
| §1 permission 所有権 | **案A（自己完結・`command.request`）** |
| §2-b reactive 併設 | **両採用**（reactive `notice` ＋ imperative `notify`） |
| §2-c reactive スパム防止 | **same-value ガードのみ**（debounce は利用者・Core はシンプル） |
| §3-b イベント payload | **`{tag, data, action}` 固定**（tag 未指定は Core 採番 id・両経路統一） |
| §4 dispose 時 close | **残す（close しない）**・明示 close/closeAll のみ |
| §5 SW 対応 | **v1 から含める** |
| §5-a backend 選択 | **auto 既定＋`mode="auto\|sw\|constructor"` 上書き** |
| §5-b SW click 経路 | **`@wcstack/notification/sw` ヘルパ＋BroadcastChannel 主・postMessage 併用** |
| §6-b permission 値 | **prompt 正規化（案Y）** |
| パッケージ/タグ | `@wcstack/notification` / `<wcs-notify>` / Shell `WcsNotify`（global `Notification` 回避） |

> 全論点確定（2026-06-14）。残る実装時論点: SW の `notificationclick` での `clients.openWindow`/`focus` を誰が担うか（ヘルパ既定 vs event-token で state 側）、reactive `notice` の options 属性の attributeChangedCallback 追従、Push API 連携（後続パッケージ）。

---

## 10. 実装順の推奨

1. `NotificationCore`（constructor 経路）: permission 監視（permission パッケージから流用）＋ `request`/`notify`/`notice`(reactive)/`close`/`closeAll` ＋ tag→Notification 追跡（未指定は Core 採番 id）＋ click/close/show/error を event 化 ＋ `_gen` ガード。reactive `notice` は same-value ガードのみ。
2. Shell `<wcs-notify>`（display:none、connect で permission 監視開始＋backend auto 判定、disconnect で dispose＝通知は残す）。`mode` 属性・options 属性（`body`/`icon`/`tag`/`require-interaction` 等）。
3. SW 経路: `@wcstack/notification/sw` の `wireNotificationClicks()`（`notificationclick` → BroadcastChannel('wcs-notify')＋postMessage 転送）。Core に BroadcastChannel 購読＋id de-dup。backend=sw 時は `registration.showNotification()`。
4. example: **チャット新着通知**（`showAlert.emit(title, {body, tag, data})` → click を event-token で受けてルーティング）を目玉に。`<wcs-permission name="notifications">` 併置で監視の重ねがけ、SW 登録ありの persistent 通知デモも。
5. README ja/en（secure-context・ユーザージェスチャ要件・SW 利用時の `wireNotificationClicks()` 1行必須・never-throw を明記）。
</content>
</invoke>
