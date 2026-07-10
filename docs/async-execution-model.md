# wcstack 非同期実行モデルの契約 (Async Execution Model Contract)

- **対象**: `@wcstack` 非同期 I/O ノードの実装者とレビュアー。新規ノードの設計時、および既存ノードの非同期挙動（排他・キャンセル・再試行・タイムアウト）に触れる変更のレビュー時
- **状態**: 規範ドキュメント（normative）。「MUST / SHOULD / MAY」は RFC 2119 の意味で使う。ただし §12 の実態インベントリは記述的（informative）であり、規範は §2〜§11 と §13
- **本書が変えないもの（最重要）**:
  - **プロトコルには一切手を入れない**。wc-bindable-protocol（`IWcBindableProperty` / `IWcBindableCommand`）・command-token・event-token の語彙・型・構文の変更を本書は行わない（本書に基づく実装もこれらを変更してはならない — MUST NOT）
  - **既存ノードの実行時挙動の変更を要求しない**。既存実装は §12 で追認し、本書の規範と食い違う点は「逸脱」として記録する（既存実装が正）。適合のためのリファクタは任意
- **なぜ存在するか**: [async-io-node-guidelines.md](./async-io-node-guidelines.md) は骨格（Core/Shell 分離・never-throw・`_gen` 世代ガード・`observe()/dispose()/ready`）を規範化した。しかし次の論点はノードごとの暗黙実装に留まっていた — (1) **排他方式**（古い実行と新しい実行の優先関係）、(2) **キャンセルの第一級手段**、(3) **再試行ポリシー**、(4) **タイムアウト**、(5) **エラー envelope と利用者中断の区別**。この5点が暗黙のままだと、新規ノードのたびに同じ問題（古い結果が新しい結果を上書きする・入力が連続変化する・切断後に処理が完了する・完了順が保証されない）を独自解決することになり、微妙に違う意味論が増殖する。本書はこれらに**名前と正規形**を与え、ノード集を「非同期処理の共通実行モデル」として揃える
- **関連**: 骨格規約は [async-io-node-guidelines.md](./async-io-node-guidelines.md)（本書はその §3.3/§3.4/§3.6 を実行意味論の側から拡張する）。ノード別の発火タイミングの正本は [timing-and-firing-contract.md](./timing-and-firing-contract.md)。複数オペレーションの並行追跡（本書のスコープ外）は [multi-promise-io-node-design.md](./multi-promise-io-node-design.md)

---

## 0. TL;DR — 実行意味論の不変条件

1. ノードは自分の**実行形**（one-shot / stream / hold / monitor、§2）を設計ドキュメントで宣言する（MUST）
2. 非同期を開始する各**レーン**について**排他モード**（latest / queue / exhaust / overlap、§5）を宣言する（MUST）
3. 世代ガードは **world generation**（`dispose()` 境界）と **operation generation**（レーン単位）の2概念で設計する（§4）。`dispose()` は全レーンを無効化する（MUST）
4. **キャンセルの第一級手段は世代 bump**。`AbortSignal` / ネイティブハンドルはリソース解放のための追加手段であり、正しさは世代が担う（§6）
5. タイムアウトは「時間切れを理由とするキャンセル」。結果は `error` envelope（`name: "TimeoutError"`）であり、`cancelled` 軸は立てない（§7）
6. 自動再試行は必ず**有限**（MUST）。**意図的停止**と**恒久エラー**の後に再試行してはならない（MUST NOT、§8）
7. 失敗は never-throw で `error` プロパティへ。envelope は最低 `message` を読める形（MUST）。**利用者都合の中断（dismiss）は error ではなく `cancelled` 軸**（§9）
8. 状態プロパティは同値ガード MUST・イベント性は同値ガード MUST NOT（guidelines §3.3）。それ以外の重複排除は §10 の決定表から選ぶ
9. §3 の参照状態機械は**内部意味論の規範**であり、`status` enum を observable として公開する義務はない（公開する場合も additive とし、プロトコル語彙は変えない）

---

## 1. スコープと非目標

### 1.1 スコープ

- 単一 Core インスタンス内の非同期実行の意味論: 開始・置換（supersede）・完了・失敗・キャンセル・タイムアウト・再試行・重複排除
- 複数レーン（独立した排他単位）を持つ Core のレーン間分離の規律

### 1.2 非目標（明示的スコープ外）

- **プロトコル変更**。動的キー付きプロパティ（`loading.<operationId>` のような表面）は wc-bindable の語彙に存在せず（[multi-promise-io-node-design.md](./multi-promise-io-node-design.md) §4）、本書はこれを導入しない
- **複数オペレーションの並行追跡（`parallel`）**。同一レーンで複数 in-flight を個別に追跡するモデルは既存 25+ パッケージに先例がない新領域（同 §1）。本書では予約語としてのみ定義する（§5）
- **既存ノードの挙動変更**。本書は既存実装の追認＋語彙化であり、[state-redesign-council.md](./state-redesign-council.md) の no-regret 原則に従う
- **入力側の時間的整形（debounce / throttle）**。利用者責務（guidelines §1）。ノード内で扱うのは microtask coalesce（§3.1 の `scheduled`）まで
- **実装コードの共有**。本書は規範のみを共有する。実行プリミティブ（世代・タイマー・再試行を束ねたヘルパ）のコード共有は §14 の未決事項

---

## 2. 実行形（execution form）— 4類型

新規ノードは tag-design doc で、自分がどの実行形か（複合の場合はどの組み合わせか）を宣言する（MUST）。実行形が決まると、参照状態機械（§3）・排他モードの既定（§5）・エラー面の要否が決まる。

| 実行形 | 定義 | 完了の性質 | 既存の例 |
|---|---|---|---|
| **one-shot** | 開始 → settle で終わる単発操作 | 終端あり（settle 後に再実行可能） | fetch, upload, share, contacts, credential, eyedropper, idle の `start` 確立部, clipboard の read/write, geolocation の `getCurrentPosition`, storage の load/save |
| **stream** | 確立 → イベント連続 → 切断 | 終端しない（切断は終端でなく状態） | websocket, sse, broadcast, worker, timer, raf, geolocation の watch, listen |
| **hold** | 獲得 → 保持 → 解放。**desired / actual の二相** | 外因（OS・visibility）で actual だけが落ちうる | wakelock, camera |
| **monitor** | 購読のみ（`commands: []`）または監視レーン | live（変化を追い続ける）or 単調終端 | permission, network, defined（単調終端）, screen-orientation / fullscreen の監視面 |

- 複合の例: geolocation = one-shot + stream + monitor(permission)、clipboard = one-shot + monitor、notification = one-shot(request) + fire(notify) + monitor(click 中継)
- キュー型 command（speak）は one-shot の変種（排他モード `queue`、§5）

---

## 3. 参照状態機械

状態機械は**実装が満たすべき遷移の規範**である。observable としての公開義務はなく（§3.5）、既存の観測面語彙（`loading` / `value` / `error` / `cancelled` / `connected` …）への写像で満たされる。

### 3.1 one-shot

```
idle ──(トリガ)──▶ scheduled ──(coalesce 窓明け)──▶ running ──▶ settled ──▶ idle（再実行可能）
                                                       settled = success | error | cancelled | timeout
```

- **`scheduled` は coalesce 窓**（同一 microtask 内の複数トリガを1回の実行に畳む段階）。持たないノードでは idle → running が直結する。coalesce を持つ場合は microtask で実装し、「microtask が task に先行する」契約（[timing-and-firing-contract.md](./timing-and-firing-contract.md) §3）を守る（MUST）。fetch の auto-fetch（同 §1.2: microtask 遅延＋同一 url de-dup）が参照実装
- 観測面への写像（既存語彙のまま、新プロパティを要求しない）:
  - `running` ⇔ `loading: true`（送信ごとに1回・await 前に立てる — timing 契約 §1.1 の一般化）
  - `success` ⇔ `value` 更新（error は §9.2 のクリア/sticky 宣言に従う）
  - `error` ⇔ `error` envelope（§9.2）
  - `cancelled` ⇔ `cancelled: true`（§9.3。利用者都合の中断のみ）
  - `timeout` ⇔ `error` envelope で `name: "TimeoutError"`（§7）
- settle は**高々1回**。世代ガード（§4）により、置換・破棄された実行は観測面に何も書かない（MUST）

### 3.2 stream

```
closed ──connect()/start()──▶ connecting ──▶ open ──(message / tick)*──▶ closed
                                  ▲                                        │
                                  └──── reconnecting（§8 の予算内）◀───────┘（外因切断のみ）
```

- 切断は終端でなく状態。**意図的切断**（close/stop/dispose、WebSocket close code 1000）と**外因切断**を区別し、意図的切断から `reconnecting` に入ってはならない（MUST NOT — websocket の `_intentionalClose` が先例）
- `message` / `tick` はイベント性であり同値ガードしない（guidelines §3.3）
- 確立系のコマンド（connect/start）の排他は `exhaust`（実行中は冪等 no-op）を既定とする（SHOULD、§5）

### 3.3 hold

```
released ──request()──▶ acquiring ──▶ held ──(外因 release)──▶ released
```

- **desired（利用者の意図）と actual（実際の保持）を別フィールドで分離する（MUST）**。wakelock の `active`(desired)/`held`(actual)、camera の `_desired`/`active` が先例
- 外因で actual が落ちても desired が立っていれば自動再獲得してよい（MAY、予算は §8）。**恒久拒否（permission denied 等）では desired を落とす（MUST）** — 無限再獲得ループの禁止

### 3.4 monitor

```
unresolved ──(初回プローブ settle)──▶ live（変化を追う） or terminal（単調確定。例: defined）
```

- 初回プローブの settle が `ready`（guidelines §3.8）。unsupported は error でなく状態に畳み込む（permission の先例、guidelines §3.6）

### 3.5 状態機械と観測面の分離

- 遷移図をそのまま `status` enum として公開する義務はない。観測面は既存の分解流儀「boolean ＋ 派生 getter」（guidelines §4.2）に従う
- 公開する場合も additive（既存プロパティの意味変更禁止）とし、CSS への反映は [custom-state-reflection-design.md](./custom-state-reflection-design.md) の規則（派生 boolean getter の無い enum は反映しない）に従う

---

## 4. 世代ガードの正規形

guidelines §3.4 は「`_gen` を持て」とだけ定めている。本節はその**正規形**を定める。既存実装の 1本（dispose のみ）/ 1本（per-op）/ 2本 / 3本というバラつきは、次の2概念の合成として説明できる。

### 4.1 world generation（世界世代）

- `dispose()` で必ず bump（MUST）。`observe()` での bump は任意
- **すべての非同期継続**（then / コールバック / タイマー / 再試行タイマー / リスナー登録）は開始時に世代を捕捉し、発火時に照合する（MUST）。再試行タイマーも対象（worker の restart タイマー捕捉が先例）
- レーンごとに別カウンタを持つ場合、`dispose()` は**全カウンタ**を bump しなければならない（MUST — 1本でも取りこぼすと、そのレーンだけ torn-down 要素への stale 書き込みが残る。[multi-promise-io-node-design.md](./multi-promise-io-node-design.md) §3）
- **免除**: 全パスが同期のノード（sensor 4兄弟・network・tilt 等）には照合すべき非同期継続が存在しないため世代は不要（timing 契約 §8.2 / §9.4 / §10.3 に記録済みの先例）。免除の根拠（全パス同期であること）を timing 契約に記録する（MUST）

### 4.2 operation generation（操作世代）

- 排他モード `latest`（§5）のレーンは**操作開始ごとに bump** し、置換された古い操作の継続を無効化する
- `overlap` / `exhaust` / `queue` のレーンは per-op bump しない（それがモードの定義）。世代は捕捉のみ行い、dispose（と明示 cancel）だけが無効化する
- 1つのカウンタが world と op を兼ねてよい（fetch の `_gen` は「操作開始でも dispose でも bump」で両方を担う）。ただし「per-op bump するか否か」はレーンごとの明示的な設計判断であり、フィールドコメントに理由を書く（MUST — share の「capture-only、dispose のみ bump」・credential の「per-call bump」のコメントが先例）
- **boolean フラグでの代替は禁止**（MUST NOT — dispose→observe で false→true に戻り、古い継続がすり抜ける。guidelines §3.4）

### 4.3 レーン

- レーン = 独立した排他単位。**レーン間で世代・キャンセルが干渉してはならない（MUST）** — 片方のレーンの操作開始やキャンセルが、もう片方の in-flight を無効化してはいけない
- 例: geolocation は 3レーン（one-shot 取得 `_acqGen` / watch `_watchGen` / permission `_permGen`）、clipboard は 2レーン（非同期 op `_acqGen` / permission `_permGen`）
- 1レーンを複数コマンドが共有してもよい（credential の `get()`/`store()` が単一 `_gen` を共有し相互 supersede する先例）。共有する場合、コマンド間で supersede が起きることを設計ドキュメントに明記する（MUST）
- **permission probe は標準レーン**。permission 監視を持つノードは専用の `_permGen` レーンとして分離する（SHOULD — geolocation / clipboard / listen / permission の先例）

---

## 5. 排他モード（exclusivity mode）の語彙

レーンごとに次のいずれかを宣言する（MUST）。

| モード | 意味 | 古い in-flight の扱い | 先例 |
|---|---|---|---|
| **`latest`** | 新しい開始が古い実行を置換する（switchMap 型） | 中断（可能なら §6.2）＋世代 bump で結果破棄 | fetch, upload, camera(acquire), credential, eyedropper, idle(start), fullscreen, screen-orientation(lock), recorder(start) |
| **`queue`** | 積んで順に実行。明示 cancel で全消し | 生かす（先行が完了するまで待つ） | speak |
| **`exhaust`** | 実行中・確立中は新規開始を冪等 no-op にする | 生かす | timer/raf の start（running 中冪等）, sse（同一 url）, broadcast（同一 name）, worker（同一 src）, wakelock（`_acquiring` フラグ）, geolocation watch（watching 中冪等） |
| **`overlap`** | 複数 in-flight を許容するが**個別追跡はしない**。各完了が到着順に観測面へ上書き（後着勝ち）。世代は capture-only（dispose のみ無効化） | 生かす（どれも置換されない） | share / contacts（実際は OS モーダルが直列化）, clipboard の read/write, geolocation の getCurrentPosition |
| **`parallel`** | 複数 in-flight を**個別に追跡**する | — | **予約語。先例なし・スコープ外**（[multi-promise-io-node-design.md](./multi-promise-io-node-design.md) の (a)/(b)/(c) 選択が先） |

- 迷ったら: one-shot は `latest`、stream の確立コマンドは `exhaust` を既定とする（SHOULD — 既存分布の最頻であり、「古いリクエストの結果が新しい結果を上書きする」問題を既定で塞ぐ）
- `overlap` を選ぶのは「置換が意味を持たない」場合に限る（SHOULD）: プラットフォームが直列化するモーダル操作（share）、完了が速く供給者が単一の操作（clipboard）。**後着勝ちの上書きが起きうることを設計ドキュメントに明記する（MUST）**
- `exhaust` の「無視」は黙殺ではなく**冪等**（同じ望ましい状態に収束する）であることが条件。設定を変えての再開始は `dispose()`→`observe()` か明示 restart コマンドで行う（guidelines §3.5）
- websocket の `connect()` は接続レーンとしては `latest`（新 connect が旧接続を閉じて置換）に分類する。「stream だから exhaust」ではなく、**レーン単位**で宣言するのが本書の規律

---

## 6. キャンセル

1. **第一級手段は世代 bump（MUST）**。ネイティブ API に中断手段が無くても（Geolocation の one-shot / Clipboard / Permissions / Web Share …）、世代照合により「破棄された実行は観測面に何も書かない」ことは常に保証できる。本モデルの「キャンセル」の定義はこれである（実行そのものの停止は保証しない）
2. ネイティブの中断手段が存在するなら、リソース解放のために**併用**する（SHOULD）: `AbortController`（fetch / idle / eyedropper — いずれも platform API が `signal` を受けるケース）、`XMLHttpRequest.abort()`（upload）、`close()`（websocket/sse/broadcast）、`terminate()`（worker）、`clearWatch()`（geolocation watch）、`cancelAnimationFrame()`（raf — best-effort、正しさは世代が担う）
3. `AbortController` を使う場合、**ノード自身が所有**する。`AbortSignal` を入力として受け取ることは要求しない。後始末は identity check（「自分がいま保持しているものである時だけ null 化」）で行い、fast abort→restart で新しい実行の controller を古い `finally` が消さないようにする（MUST — FetchCore / EyedropperCore / IdleCore が相互参照している形）
4. **利用者都合の中断（picker / モーダルの dismiss）はキャンセルであって失敗ではない** → `cancelled` 軸へ（§9.3）
5. `dispose()` = 全レーンのキャンセル＋リソース解放。意図的に残すもの（notification は表示済み通知を消さない）は理由をコメントに記録する（guidelines §3.5）

---

## 7. タイムアウト

- タイムアウト = **「時間切れを理由とするキャンセル」**。実装はキャンセルと同経路（世代 bump ＋ ネイティブ中断手段があれば併用）で行う（MUST）。独自の第3の停止経路を作らない
- 観測面: `error` envelope で `name: "TimeoutError"`（DOMException の語彙に合わせる）（MUST）。**`cancelled` は立てない**（利用者の意図による中断ではないため）（MUST）
- ネイティブにタイムアウト入力を持つ API はそれへ委譲し、二重にタイマーを張らない（SHOULD — geolocation は `GeoOptions.timeout` を素通しする先例）
- 新規の one-shot ノードで**無期限 pend がありうる**もの（ネットワーク・ユーザー操作待ち以外の外部 settle 待ち）は `timeout` 入力の提供を検討する（SHOULD consider）。既存ノードへの追加は任意（additive に導入可能。既定は「タイムアウトなし」で現行挙動を変えない）
- 注意: defined の `timeout` は「pending → missing への確定」機能であり、本節の request timeout とは**別概念**（名前が同じだけ。逸脱ではない）

---

## 8. 再試行・再接続ポリシー

自動再試行（reconnect / restart / re-acquire / auto-restart）を持つノードは、ポリシーを次の4要素で設計ドキュメントに記述する（MUST）。

| 要素 | 意味 | 規範 |
|---|---|---|
| `max`（上限） | 再試行回数の予算 | **有限であること（MUST）**。無限再試行は禁止 |
| `interval`（間隔） | 再試行までの待ち | 既定は固定間隔（現行の全採用ノードが固定間隔）。指数バックオフは opt-in 入力として additive に追加してよい（MAY）。導入時は既定を fixed のままにする（既存挙動保護） |
| `resetOn`（予算リセット） | どの「前進シグナル」で回数を戻すか | 成功確立（open）や成果受信（result）でリセットする（SHOULD — websocket は open で、listen は result 受信でリセットする先例）。リセット条件を持たない累積 cap（worker）も許容されるが、その旨を明記する |
| `excludeWhen`（除外条件） | 再試行してはならない条件 | **意図的停止**（close/stop/dispose、WebSocket close code 1000）と**恒久エラー**（permission denied / `NotAllowedError` / not-allowed）では再試行してはならない（MUST NOT） |

追加規範:

- **一時エラーと恒久エラーを区別する**（SHOULD — camera の `NotReadableError`（一時: desired 維持）と `NotAllowedError`（恒久: desired 破棄）の先例）
- hold 型の自動再獲得は desired が立っている間のみ。恒久拒否で desired を落とす（MUST、§3.3）
- プラットフォームが再接続を内蔵しているなら委譲し、自前実装と二重化しない（SHOULD — sse は EventSource のネイティブ再接続に委譲し、`readyState` で再接続中/恒久 CLOSED を判別する先例）
- 再試行の安全既定は **off**（SHOULD — listen の `maxRestarts=0` 既定が先例。エコーループ等、再試行自体が害になるドメインがある）
- 再試行タイマーの継続も世代照合の対象（MUST、§4.1）

---

## 9. エラー envelope と cancelled 軸

### 9.1 never-throw（再確認）

guidelines §3.6 のとおり。公開メソッドは例外を投げず、Promise を返すなら never-reject（全パス resolve）。本書はこれを前提に「では失敗は**どういう形**で観測されるか」を定める。

### 9.2 envelope

- `error` プロパティ（イベント detail）は最低 **`message: string` を読める形**であること（MUST）。`name: string` も持つことが望ましい（SHOULD）。新規ノードの既定形は既存の `Wcs<Name>ErrorDetail { name, message }` 系とする
- ドメイン固有フィールドの追加は MAY（fetch / upload の `{ status, statusText, body }` は HTTP 方言として追認）
- プラットフォームの生 Error / Event をそのまま流している既存ノード（share, websocket, fullscreen 等）は追認。新規ノードは envelope へ正規化する（SHOULD — プラットフォーム例外の形の揺れをノードが吸収するのが責務）
- `unsupported` は error ではなく**状態**（4値 permission surface か専用フラグ）（guidelines §3.6）
- **クリア/sticky の宣言（MUST）**: 成功 settle で `error` をクリアするか（geolocation: 成功 fix でクリア）、次の明示開始まで sticky に残すか（sensor 4兄弟: 成功 reading ではクリアしない）は、どちらも許容されるがノードごとに宣言し timing 契約に記録する。無宣言は不可
- error の同値ガード比較方法は §10 の決定表から選ぶ

### 9.3 cancelled 軸

- **利用者都合の中断（picker / モーダル / ダイアログの dismiss）は `error` に流さず、独立した boolean `cancelled` として観測させる（MUST）** — share / contacts（`AbortError` → cancelled）、credential（`NotAllowedError` dismiss → cancelled）の先例を規範化
- プラットフォームごとに dismiss の例外名は違う（share は `AbortError`、credential は `NotAllowedError`）。**例外名の差異を吸収して `cancelled` に正規化するのはノードの責務**（MUST）。判別不能な場合は error 側に倒す
- `cancelled` は次の実行開始でクリアする（loading と同じリセット規律）

---

## 10. 重複排除の決定表

「同じ command が重複して届く」「同じ値が連続して流れる」への対処は、対象ごとに次から選ぶ。

| 対象 | 手段 | 規範 | 先例 |
|---|---|---|---|
| 状態プロパティ（loading / permission / connected …） | 同値ガード（`===` 参照比較が既定） | **MUST**（guidelines §3.3） | 全ノード |
| イベント性（message / tick / result / position fix / copied …） | ガードしない（同値2回は「2回の発生」） | **MUST NOT**（同上） | 全ノード |
| settle ごとに fresh なオブジェクトになる error | 内容比較（`name`＋`message`、必要なら値の種別も） | MAY | wakelock（denied が毎回 fresh Error）、sensor（name＋message 複合キー） |
| リスト snapshot（voices / devices / 集計値） | 内容比較 or JSON snapshot key | SHOULD | speak `_voicesEqual` / camera `_devicesEqual` / defined `_publishedKey` |
| 多重輸送チャネルの二重配信（同一イベントが2経路で届く） | id による de-dup。**記憶は FIFO 上限付き**（無制限に成長させない） | 採用する場合 cap は **MUST** | notification `_seenIds`（BroadcastChannel と SW message の二重輸送、FIFO 50 cap） |
| 双方向バインドのフィードバックループ遮断 | 公開 setter の `Object.is` ガード | SHOULD | storage `set value` |
| 入力トリガの collapse（連続変化を1回の実行へ） | microtask coalesce（§3.1 の `scheduled`） | MAY。導入時は timing 契約への追記が **MUST** | fetch auto-fetch（timing 契約 §1.2） |

---

## 11. 実行識別（operationId / requestId）

- イベント detail に相関用メタ（id・tag 等）を含めることは MAY（notification の tag 採番 `data.__wcsId` が先例）
- **operationId をキーとした動的 observable（`loading.<id>` のような表面）は定義しない**。wc-bindable にその語彙が無く（[multi-promise-io-node-design.md](./multi-promise-io-node-design.md) §4）、本書はプロトコルを変えないため
- request/response 相関が必要なユースケースは、①コレクション化（1つの observable に集約して丸ごと再 dispatch）② userland 相関（ノードは薄い bus のまま。worker が明示採用）のいずれかを選ぶ（同 §5 (a)(b)）。プロトコル拡張 (c) は本書の外

---

## 12. 既存ノード実態インベントリ（informative、2026-07-11 時点）

本表は**追認**であり規範ではない。本書の語彙で既存実装を記述したもの。逸脱・特記は末尾に記録する。

| パッケージ | 実行形 | レーン（世代） | 排他モード | キャンセル手段 | 再試行 | タイムアウト |
|---|---|---|---|---|---|---|
| fetch | one-shot | 1（per-op bump） | latest | AbortController＋世代 | — | — |
| upload | one-shot | 1（per-op bump） | latest | XHR.abort()＋世代 | — | — |
| websocket | stream | 2（`_gen`＋`_socketGen`） | connect=latest | close()・意図フラグ | 固定間隔・cap・code1000 除外・open でリセット | — |
| sse | stream | 2（`_gen`＋`_connGen`） | exhaust（同一 url） | close() | EventSource ネイティブ委譲 | — |
| broadcast | stream | 1（open＋dispose） | exhaust（同一 name） | close() | — | — |
| worker | stream | 1 | exhaust（同一 src） | terminate() | restartOnError 固定間隔・累積 cap | — |
| timer | stream | 2（`_gen`＋`_runGen`） | exhaust（running 冪等） | stop() | — | — |
| raf | stream | 1（arming counter） | exhaust（running 冪等） | stop()＋cancelAnimationFrame（best-effort） | — | — |
| geolocation | one-shot＋stream＋monitor | 3（`_acqGen`/`_watchGen`/`_permGen`） | 取得=overlap（capture-only）・watch=exhaust | clearWatch()・世代 | — | ネイティブ `timeout` 素通し |
| clipboard | one-shot＋monitor | 2（`_acqGen`/`_permGen`） | overlap（capture-only、`_runOp` 共通） | 世代のみ（API に中断なし） | — | — |
| storage | 同期 one-shot＋sync 監視 | 1（listener 用） | —（同期） | stopSync() | — | — |
| speak | queue | 1（cancel＋dispose で bump） | queue | cancel()（全消し） | — | — |
| listen | stream（セッション） | perm レーン＋`_active` 意図フラグ | exhaust（active 中冪等） | stop()/abort() | auto-restart（既定 off・budget・result でリセット・terminal error 除外） | — |
| notification | one-shot＋fire＋monitor | 1（observe＋dispose） | overlap（tag で個別管理） | close(tag)/closeAll() | show backend の TypeError フォールバックのみ | — |
| wakelock | hold | 1＋`_acquiring` フラグ | exhaust（獲得中冪等） | release()・世代 | visibility 再獲得＋lease-renewal＋coalesced retry（denied で停止） | — |
| camera | hold | 1（acquire で bump） | latest（switchMap。orphan stream は停止して破棄） | 世代（orphan 停止） | visibility resume・一時/恒久区別 | — |
| recorder | セッション | 1（start で bump） | latest（recording 中は start 冪等） | stop() | — | — |
| permission | monitor | 1（`_permGen`） | —（query は capture） | 世代 | — | — |
| defined | monitor（単調終端） | 1 | —（単調） | 世代＋timeout clear | — | ※`timeout` は pending→missing 確定機能（§7 注意） |
| share | one-shot | 1（**dispose のみ bump**） | overlap（OS モーダルが直列化） | なし（dismiss→cancelled） | — | — |
| contacts | one-shot | 1（dispose のみ bump） | overlap（同上） | dismiss→cancelled | — | — |
| credential | one-shot | 1（**per-call bump、get/store 共有**） | latest（コマンド間 supersede あり） | dismiss（`NotAllowedError`）→cancelled | — | — |
| eyedropper | one-shot | 1（per-op bump） | latest | AbortController＋世代 | — | — |
| idle | one-shot 確立＋monitor | 1（start/stop/dispose で bump） | latest（start は supersede 型） | AbortController＋世代 | — | — |
| fullscreen | one-shot＋monitor | 1（per-op bump） | latest | 世代 | — | — |
| screen-orientation | monitor＋one-shot(lock) | lock レーン（後勝ち） | lock=latest | unlock()/dispose() で世代無効化 | — | — |
| sensor 4兄弟 / network / tilt | monitor / stream | **なし（全パス同期のため免除**、§4.1） | — | stop() | — | — |

**逸脱・特記の記録**:

- listen は操作世代でなく `_active` 意図フラグ＋restart budget で制御する。stream セッションの「意図」管理として追認（世代が必要な非同期継続は permission レーン側にのみ存在する）
- fetch / upload の HTTP エラー envelope `{ status, statusText, body }` は §9.2 の方言として追認
- websocket / share / fullscreen が生 Error / Event を error に流すのは §9.2 の追認対象（新規ノードは envelope へ正規化）
- 再試行を持つ4ノード（websocket / worker / listen / wakelock）はいずれも固定間隔で、指数バックオフの採用例はまだ無い（§8 の `interval` 規範どおり、導入する場合は opt-in）
- timer / raf / permission / sensor 系は error 面自体を持たない（永続失敗モードが無い）。§9 は「error 面を持つノード」にのみ適用される

---

## 13. レビュー収束チェックリスト追補

guidelines §10 に加えて、非同期実行を持つノードは以下を満たすまでマージしない。

- [ ] 実行形（§2）とレーン構成（§4.3）を tag-design doc で宣言した
- [ ] 各レーンの排他モード（§5）を宣言した。`latest` なら per-op bump、それ以外なら capture-only である理由をフィールドコメントに書いた
- [ ] `dispose()` が**全レーン**の世代を無効化する（テストあり）
- [ ] キャンセルは世代が正、ネイティブ中断は best-effort 併用（§6）。AbortController を使うなら identity check で後始末する
- [ ] 自動再試行があるなら §8 の4要素（max/interval/resetOn/excludeWhen）で記述し、有限・意図的停止除外・恒久エラー除外を満たす（テストあり）
- [ ] `timeout` を持つなら結果は `name: "TimeoutError"` の error であり `cancelled` を立てない（§7）
- [ ] error envelope は `message`（＋`name`）を読める形（§9.2）。成功時クリア or sticky を宣言し timing 契約に記録した
- [ ] 利用者都合の dismiss は `cancelled` 軸に正規化した（§9.3）
- [ ] 重複排除は §10 の決定表から選び、id de-dup を使うなら FIFO cap がある

---

## 14. 未決事項

- **`status` enum の observable 公開**（§3.5）: 公開するなら additive で、[custom-state-reflection-design.md](./custom-state-reflection-design.md) の反映規則と揃える必要がある。現時点では要求も禁止もしない
- **指数バックオフの実採用**: 現行の再試行ノードは全て固定間隔。採用する場合は opt-in 入力（既定 fixed）で、どのノードから入れるかは未定
- **排他モード `parallel`**: [multi-promise-io-node-design.md](./multi-promise-io-node-design.md) の戦略選択（コレクション化 / userland 相関 / プロトコル拡張）が先。本書は予約語のみ
- **実行プリミティブのコード共有**: 本書は規範のみで実装を共有しない。世代・タイマー・再試行を束ねたヘルパ（`OperationLane` 相当）を共有するなら、ランタイム依存を導入しない「コピー配布」方式（`wcBindable.ts` と同じ）が前提。是非は未決
