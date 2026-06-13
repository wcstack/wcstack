# 設計メモ: `@wcstack/permission`（`<wcs-permission>`）

- **状態**: 設計検討中（未実装）。本文書は実装前の論点整理と決定事項のスナップショット。
- **対象 WebAPI**: Permissions API（`navigator.permissions.query()` ＋ `PermissionStatus` の `change` イベント）
- **位置づけ**: ブラウザ権限状態を宣言的に state 化する**横断基盤プリミティブ**。geo / clipboard / notifications / camera 等が共通依存しうる権限監視を、単独の IO ノードとして切り出す。
- **前提資産**: geolocation（二相＋permission 監視＋never-throw＋secure-context＋`unsupported` state＋`_permGen` 世代ガード＋Core/Shell 分割）、clipboard（permission 2系統・`_queryPermission` ヘルパ）、wakelock（boolean state の宣言的束縛＝派生 getter）、event-token / command-token プロトコル、wc-bindable protocol v1。

---

## 0. 大前提: このノードは構造的に「片肺」

他の IO ノード（geo / clipboard / sse / wakelock …）は **機能を実行し状態を state 化するプロデューサ**である。一方 Permissions API は **`query()` しか持たない read-only API**で、`request()` に相当する標準が存在しない。許可を促すには各機能 API（`getCurrentPosition` 等）を呼ぶしかない。

| | 他の IO ノード | `<wcs-permission>` |
|---|---|---|
| 方向 | 双方向（command-token ＋ event-token） | **要素 → state の一方向のみ** |
| command-token | 成立（起動・送信） | **成立しない**（request 標準が無い） |
| event-token | 成立 | 成立（権限変化を受ける） |
| 副作用 | あり（fetch・発話・書込） | **なし**（query は純粋な読み取り） |

> この非対称性が以降の全論点の根。**`<wcs-permission>` は event-token 専用ノード＝command-token が成立しない初の例**であり、プロトコルの境界そのものを実証する題材になる（[[event-token-protocol]] / [[command-token-protocol]] の対称性の例外ケース）。

加えて、権限監視ロジック（query → `PermissionStatus` → `change` 購読 → `"unsupported"` フォールバック → `_permGen` 世代ガード → reinit/dispose）は**既に `GeolocationCore` と `ClipboardCore` に重複実装済み**。本ノードは新規プリミティブであると同時に、その重複の**集約先候補**でもある（§6）。

---

## 1. 存在意義 — 何を解決するノードか

geo/clipboard が自前 permission を持つ中での独立タグの価値を明文化する。想定ユースケース:

- **機能を呼ばずに状態だけ知りたい**: 「カメラを許可してください」バナーを `granted` なら隠す等、UI の事前出し分け（`hidden@granted`）。
- **対応タグの無い権限の監視**: `notifications` / `push` / `midi` / `accelerometer` / `geolocation` など、まだ専用ノードが無い／作る予定の無い権限を、機能実装ぬきで監視できる。
- **横断基盤**: `PermissionCore` を切り出し、将来 geo/clipboard をそれに載せ替える集約先になりうる（§6・スコープ外）。

---

## 2. request 問題 — **決定: 案A（監視専用ノード）**

- **案A: 純粋監視ノードと割り切る** ✅ — command を一切持たず、property ＋ event-token のみの純プロデューサ。geo の「読み取り専用センサ」と同型で、設計が明快。
- ~~案B: `request` command を提供~~ — 内部で権限名ごとに対象機能 API（`getCurrentPosition` / `Notification.requestPermission` 等）へディスパッチする戦略テーブルを持つ案。だが request 手段の無い権限（`midi` 等）があり、権限名とトリガ API の対応表が肥大化・保守破綻しやすい。不採用。

> 設計意図の明文化: **`<wcs-permission>` は副作用ゼロの観測ノード**である。「許可を取りに行く」のは対象機能ノード（`<wcs-geo>` の `getCurrentPosition` 等）の責務であり、本ノードはその結果としての権限状態を**監視するだけ**。command-token が成立しないこと自体が、このノードの正体を表す。

---

## 3. 対象権限の指定方法 — **決定: 単一権限 / タグ**

センサ系には無かった新論点。「何を観測するか」を要素側で指定する（[[intersection-tag-design]] の「観測対象は単一」方針と整合）。

- **決定: 1タグ＝1権限**（`<wcs-permission name="geolocation">`）。clipboard の read/write 2系統は clipboard 固有の事情で、汎用ノードは name 1個/タグが素直。複数監視したければタグを複数置く。
- **descriptor 付き権限の扱い**: 一部の権限は `query()` に追加プロパティを要する。属性 → descriptor へマッピングする:

| 権限 | descriptor | Shell 属性 |
|---|---|---|
| `geolocation` / `notifications` / `camera` / `microphone` … | `{name}` | `name` のみ |
| `push` | `{name:"push", userVisibleOnly:true}` | `user-visible-only` |
| `midi` | `{name:"midi", sysex:true}` | `sysex` |

- 未知 / 非対応の name は §5 の `"unsupported"` に倒す（バリデーションで弾かず、ブラウザの reject に委ねる）。

---

## 4. 公開する state（値サーフェス草案・geo types.ts 同型）

`PermissionCore`（観測プロパティ）:

```
state: PermissionState         // "prompt" | "granted" | "denied" | "unsupported"
granted: boolean               // 派生 getter（state === "granted"）
denied: boolean                // 派生 getter（state === "denied"）
prompt: boolean                // 派生 getter（state === "prompt"）
unsupported: boolean           // 派生 getter（state === "unsupported"）
```

- **4値 state は geo/clipboard と完全同一**（`"prompt" | "granted" | "denied" | "unsupported"`）。型は `PermissionStateOrUnsupported` として共有可。
- **派生 boolean getter** が本ノードの使い勝手の肝。wakelock の `active@x` のように boolean を直接束縛でき、`hidden@granted` / `disabled@!granted` のような宣言的配線が一行で書ける。geo の「同型イベント 1 つから複数 getter」手法をそのまま流用（`state` 1 プロパティから 4 つの boolean を派生）。
- **commands: なし**（§2 の決定）。
- **inputs（属性）**: `name`（必須）、`user-visible-only`、`sysex`。
- イベント: 権限変化を `wcs-permission:change`（state 派生）で publish。event-token で受ける純プロデューサ。

---

## 5. 二相 / unsupported / SSR（既存パターン踏襲・新規論点ではない）

- **二相（初回 query ＋ change 監視）**: geo と同型。ただし geo は `position` と `permission` が別物だったのに対し、本ノードは**両相が同じ単一 `state` を更新する**ためよりシンプル。監視は常時 ON（opt-out 不要・query に副作用が無いため）。
- **unsupported / 非対応**: `navigator.permissions` 不在、または `query()` が reject する name（Firefox の `clipboard-*`、Safari の各種）は `"unsupported"` フォールバック。never-throw・zero-log（[[geolocation-tag-design]] の方針を踏襲）。
- **`_permGen` 世代ガード**: reinit（再接続）→ change レースで旧 `PermissionStatus` の遅延コールバックを bail。geo/clipboard と同方式。
- **SSR**: `query()` が async なので geo 同型の `hasConnectedCallbackPromise` ＋ `connectedCallbackPromise`（既定モードのみ追跡）。
- **secure-context**: Permissions API は secure context 限定。README に明記（geo と同様）。

---

## 6. 横断基盤への集約 — **決定: 今回スコープ外（後続）**

`PermissionCore`（query ＋ change ＋ 世代ガード ＋ reinit ＋ dispose）を共通モジュール化し、`GeolocationCore` / `ClipboardCore` をそれに載せ替えれば重複が消える。だが:

- **やる**: 重複解消・一貫性。一方で既存2パッケージへの破壊的変更＋テスト再整備コストが発生。
- **やらない（今回）** ✅: まず `<wcs-permission>` を独立実装で立て、既存はそのまま共存。重複は許容。集約は本ノードが安定してからの後続タスクとする。

> [[csbc-dev-package-split]] の仕分け軸では permission は純 Web 標準プリミティブ → ベンダー連携でなく **wcstack 本体／独立パッケージ** `@wcstack/permission`・タグ `<wcs-permission>`。Shell クラス名は global `Permissions` を避け `WcsPermission`（geo の `WcsGeolocation` / clipboard の `WcsClipboard` 先例）。

---

## 7. Shell / autoTrigger

- **autoTrigger なし**: 監視専用（§2）なので、geo の `data-geotarget` クリック起動に相当する経路が無い。query は副作用ゼロで安全なため、接続時に常に実行してよく `manual` も不要。
- **Shell 属性**: `name`（必須）＋ descriptor 系（`user-visible-only` / `sysex`）のみ。geo の `watch` / `trigger` / `high-accuracy` のような実行制御属性は無い。
- `connectedCallback`: `display:none` ＋ `reinitPermission()`（接続時 query）。`disconnectedCallback`: `dispose()`（change 解除・`_permGen++`）。

---

## 8. テスト方針（happy-dom）

happy-dom は `navigator.permissions` を持たないため `__tests__/mocks.ts` で全モック。geo/clipboard の既存モック（`installPermissions` で controllable な `query`・change 駆動）を流用。観点:

- 初回 query の 4 値解決（granted/denied/prompt）と派生 boolean。
- change イベントでの state 遷移と再 publish。
- 非対応（permissions 不在）／reject name の `"unsupported"` フォールバック。
- reinit → change レースで旧コールバック bail（`_permGen`）。
- dispose 後に change が来ても publish しない。
- descriptor 属性（`user-visible-only` / `sysex`）が `query()` の引数に正しく載る。

---

## 9. 決定事項まとめ

| 論点 | 決定 |
|---|---|
| §2 request の扱い | **案A: 監視専用**（command なし・event-token 専用） |
| §3 権限の指定 | **1タグ＝1権限**、descriptor は属性マッピング |
| §4 公開 state | 4値 `state` ＋ 派生 boolean getter（`granted` 等） |
| §6 既存集約 | **今回スコープ外**（独立実装→後続で集約検討） |
| §7 autoTrigger | なし（監視専用・`manual` 不要） |
| パッケージ/タグ | `@wcstack/permission` / `<wcs-permission>` / Shell `WcsPermission` |

---

## 10. 実装順の推奨

1. `PermissionCore`（query ＋ change ＋ 派生 getter ＋ 世代ガード ＋ unsupported）を geo の permission 部分を抽出する形で実装。
2. Shell `<wcs-permission>`（`name` ＋ descriptor 属性、display:none、connect/disconnect ライフサイクル）。
3. example: **権限バナーの出し分け**（`hidden@granted` で「許可してください」を消す）を目玉に。`<wcs-geo>` と並置し「geo が取りに行く／permission が監視する」の責務分離を示す。
4. README ja/en（secure-context・unsupported・never-throw・監視専用＝request しない旨を明記）。
5. 後続課題として §6 の集約（geo/clipboard を `PermissionCore` へ載せ替え）を別タスク化。
