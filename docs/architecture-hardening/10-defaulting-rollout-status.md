# 10 既定化・横展開ステータスと残作業

最終更新: 2026-07-16

`09-remediation-design.md` §8「段階導入」で定義した phase 0-6 は **PoC 実装はすべて完了**している。
本書はそこから先の **opt-in → 既定化 / IO 族への横展開** の進捗と残作業を追跡する living document。
規範は各設計 doc（01-09）であり、本書は状態表とタスク一覧に徹する。

## 1. 現在地

phase 実装（PoC）は 0-6 すべて完了済み。局面は既定化・横展開フェーズ。

| phase | 実装 | 既定化 / 横展開 状況 |
| --- | --- | --- |
| 0 foundation | 型 / conformance mirror / platform guard | フラグ無しで既定稼働（完） |
| 1 lifecycle ownership | `BindingSession` / record / teardown | フラグ無しで既定稼働（完） |
| 2 初期同期 | `enableDirectionalInitialSync` / `#init=` `#sync=` | **既定 `true`（2026-07-16 flip 完）**。恒久 opt-out フラグ残置 |
| 3 因果伝播 | `enablePropagationContext` / `WriteReceipt` | **既定 `true`（flip 完）**。恒久 opt-out フラグ残置 |
| 4 非同期 lane / trace | `OperationLane` / commit guard / terminal CAS | operation **6 ノード**へ横展開完（残候補は非競合/session で対象外＝完）。DevTools trace の全体適用は要確認（§F） |
| 5a 静的契約 | validator core / `wcs-validate` CLI | 実装完。**CI 必須ゲート化 完（§B、2026-07-16）** |
| 5b 開発時照合 | `enableContractAnalyzer` analyzer | 実装完。**explicit opt-in を正式仕様として確定（§C、dev 既定 ON は不採用）** |
| 6 capability | probe / report / error taxonomy | **27 / 35 IO ノード**適用済み（+19、2026-07-16。view 族は bindable 化で error も観測面に）。残 8 = defer 3（permission/network/defined、ユーザー判断）+ 非該当 5。詳細 §A |

### 既定化済みフラグ（`packages/state/src/config.ts`）

- `enableDirectionalInitialSync: true` — Phase 2。output-only な `wcBindable` メンバは初期値を element→state で読み取り、双方向/input メンバは state→element を維持。setup-path コストは初期 render の 5% 未満（producer-value observer は echo しうる双方向 wire にのみ登録）。
- `enablePropagationContext: true` — Phase 3。write-path コストは一方向バインドでほぼゼロ（echo しうる双方向 wire のみ因果 bookkeeping）。
- `enableContractAnalyzer: false` — Phase 5b。唯一 opt-in のまま（§C）。

いずれも decision 3 に従い**フラグは撤去せず恒久 opt-out** として残す。

### lane 適用済み operation ノード（6）

`fetch`(latest) / `share`(exhaust) / `contacts`(exhaust) / `eyedropper`(latest) / `credential`(latest) / `upload`(latest)。
正典は `io-core/{operation-lane,platform-capability}.ts`、`scripts/sync-io-core.mjs` が各 `src/core/` へ生成コピー（copy-distribution、新 npm 依存なし）。CI は `sync-io-core.mjs --check` で再生成差分を検査。

### errorInfo 適用済みノード（27、2026-07-16 時点）

- 初期 8: lane 6 ノード + 非競合 2（`clipboard` / `geolocation`）。
- +19（本セッション、全て `CAPABILITY_ONLY`）: `storage` / `accelerometer` / `gyroscope` / `magnetometer` / `ambient-light-sensor` / `notification` / `wakelock` / `tilt` / `screen-orientation` / `worker` / `broadcast` / `idle` / `websocket` / `sse` / `camera`（2 コア）/ `speech`（2 コア）/ `fullscreen` / `picture-in-picture` / `pointer-lock`（view 族は error も bindable 化）。
- 検証: 各パッケージ test:coverage（100% or 閾値内）+ lint + build を独立再実行で確認、`sync-io-core --check` = 33 生成整合、git dist 差分 0。README(en/ja)も全 27 ノード分 errorInfo 記載済み。詳細は §A。

---

## 2. 残作業

### A. Phase 6 — errorInfo taxonomy の横展開【決定: 適用可能な全ノード展開。**完了 27/35 適用＋defer 3＋非該当 5（2026-07-16）**】

> 以下は横展開の時系列ログ（進捗数はその時点の値）。最終状態は「残ノードの最終分類」を参照。

**方針決定済み（2026-07-16）**: `09` §8 phase 6 の design 意図どおり **適用可能な全 IO ノードへ順次適用**（scope 補正は下記参照）。

**進捗 13 / 35**（+storage +accelerometer +gyroscope +magnetometer +ambient-light-sensor）。errorInfo 適用可能な**残 15 ノード**:

> websocket, sse, broadcast, worker, notification, wakelock, camera, speech, defined,
> fullscreen, picture-in-picture, pointer-lock, screen-orientation, idle, tilt

（errorInfo 非該当 5 + 保留 2 は下記 scope 補正を参照）

**⚠ 2nd scope 補正（2026-07-16、error の observability 精査）**: 残 15 のうち **view 族 3（fullscreen / picture-in-picture / pointer-lock）は `error` が imperative getter のみ**（`_setError` は `this._error = error` するだけで **event 未 dispatch・wcBindable 非宣言**）。sensor/storage/clipboard の「bindable errorInfo（event 付き property）」テンプレが素直に適用できない。**設計判断が必要**: (a) errorInfo も imperative getter として error をミラー（event 無し・wcBindable 非宣言、最小変更で一貫）か (b) error イベントを新設し errorInfo を bindable 化（族の「error イベント未 dispatch」backlog と併せて解決）。⇒ **view 族 3 は保留**（error-event 方針決定後に着手）。
- ⇒ 残 15 のうち **bindable-error 12 ノード**（`name:"error"` + event あり: websocket / sse / broadcast / worker / notification / wakelock / camera / speech / defined / screen-orientation / idle / tilt）が sensor/storage テンプレで素直に進められる本命。**先にこの 12 を進める**。

**bindable-error batch 1 完了（14-17 ノード目、2026-07-16、並列サブエージェント＋独立検証）**: `notification` / `wakelock` / `tilt` / `screen-orientation`。**進捗 17 / 35**。各サブエージェントが**実 Core を検証して設計 taxonomy との差異を捕捉**（memory hazard 機能）:
- `notification`（error `.error` が既に code）: 私の 4 コード想定に対し **5 つ目 `no-service-worker`**（`_showViaSw` の SW 欠如）を Core から発見・追加。111 テスト 100%。
- `wakelock`（raw `Error`）: **unsupported は silent no-op で `_setError` を通らない**→`capability-missing` 分岐は dead code として正しく省略。NotAllowedError→not-allowed / 他→wakelock-error。77 テスト 100%。
- `tilt`（`{error: e}` wrap、DeviceOrientation）: unsupported 経路なし（requestPermission 不在時は granted 解決）→NotAllowedError→not-allowed / 他→tilt-error。72 テスト 100%。
- `screen-orientation`（`{message:"unsupported"}` / caught 混在）: **storage 型 explicit discriminator `_setError(error, name?)`** 採用。**memory の「NotSupportedError→NotAllowedError 訂正」は誤り**で、README/test は NotSupportedError を使う（「name で分岐せず 1 outcome 扱い」）と実証→NotAllowed|NotSupported|Security→not-allowed / AbortError→aborted(recoverable) / 他→orientation-error。`Promise.reject(undefined)` の never-throw 堅牢化（`_errorInfoMessage`）も追加。87 テスト 100%。
- **教訓再確認**: taxonomy は各ノードの実 error 面（error 名 / silent 経路 / doc の記述）を精読して設計する必要があり、共有想定は当てにならない。sync-io-core --check=23 生成整合、git dist 差分 0。**残 bindable-error 8**: websocket / sse / broadcast / worker / camera / speech / defined / idle。

**bindable-error batch 2 完了（18-22 ノード目、2026-07-16、並列サブエージェント＋独立検証）**: `worker` / `broadcast` / `idle` / `websocket` / `sse`。**進捗 22 / 35**。再び各サブエージェントが実 Core を検証し想定を訂正:
- `worker`（`{name,message}`）: name "TypeError" は validation 専用でない（`Worker` 不在も "not a constructor" で TypeError）と発見→**message で弁別**、不在（TypeError/ReferenceError）→capability-missing、validation→invalid-argument、他→worker-error。`dispose()` は `_setError` を通らないので errorInfo の明示 null クリアを追加。117 テスト。
- `broadcast`（`{name,message}`）: `_unsupportedError().name` は **"NotSupportedError"**（"unsupported" でない）と実証。DataCloneError→invalid-argument、他→broadcast-error。97 テスト。
- `idle`（`{message}`/`{error:e}` 混在）: storage 型 discriminator + `{error:e}` の message 一段 unwrap。unsupported→capability-missing、NotAllowedError→not-allowed、他→idle-error。79 テスト。
- `websocket`（`{message}`/caught/Event 混在）: explicit discriminator `_setError(error, code?)`。url→invalid-argument、未接続 send→invalid-state、構築失敗/error Event→connection-error(recoverable)。131 テスト。
- `sse`（Error/Event 混在）: **Core が fatal(readyState CLOSED)/transient(CONNECTING 再接続) を区別**すると発見し recoverable=true をその一択に限定。url→invalid-argument、他→connection-error。106 テスト。
- sync-io-core --check=28 生成整合、git dist 差分 0。errorInfo export 済み **22 パッケージ**。
- **残 applicable 3（要個別対応）**: `camera`（2 コア CameraCore+RecorderCore、MediaStream 特殊）/ `speech`（2 コア ListenCore+SpeakCore）/ `defined`（error 面が独立 event でなく `wcs-defined:change` 内、`_setError` 無し＝要調査）。加えて **view 族 3・capability-only 2 は保留**（上記 scope 補正）。

**2-core 族 完了（23-24 ノード目、2026-07-16、並列サブエージェント＋独立検証）**: `camera` / `speech`。**進捗 24 / 35**。
- `camera`（CameraCore + RecorderCore、共有 `mediaCapabilities.ts` の `deriveMediaErrorInfo`）: getUserMedia/MediaRecorder の `.name` を分類。unsupported→capability-missing、NotAllowed/Security→not-allowed、NotFound→not-found、NotReadable→not-readable、Overconstrained/**NotSupported**（Recorder 構築失敗、Core から発見）→invalid-argument、NoStreamError→invalid-state、Abort→aborted(recoverable)、他→media-error。161 テスト 100%。
- `speech`（ListenCore + SpeakCore、`speechCapabilities.ts` に 2 derive）: `.error` が既に W3C の code。Listen（no-speech/audio-capture/network/not-allowed/aborted/language-not-supported…）/ Speak（canceled/interrupted/audio-busy/audio-hardware/network/synthesis-*/…）を各々分類。188 テスト。
- sync-io-core --check=30 生成整合、git dist 差分 0。**errorInfo 実装済み 24 パッケージ（16 ノード追加）**。

### 残ノードの最終分類（2026-07-16）

**適用済み 27**（8 既存 + storage + 4 sensor + notification/wakelock/tilt/screen-orientation + worker/broadcast/idle/websocket/sse + camera/speech + **view 族 3**）。**残 8 = defer 3（ユーザー判断）+ 非該当 5**:

| ノード | 分類 | 状態 |
| --- | --- | --- |
| fullscreen / picture-in-picture / pointer-lock | **view 族・完了（bindable 化）** | **ユーザー判断=(b) bindable 化採用（2026-07-16）**。`error` が imperative getter のみだったのを、`error` イベント（`wcs-<ns>:error`）＋ `errorInfo` イベント（`:error-info-changed`）を新設し wcBindable に宣言＝**族の「error イベント未 dispatch」backlog も同時解決**。fullscreen を手作業 reference（error 観測化＋errorInfo、明示 `kind` discriminator、taxonomy=capability-missing/invalid-argument/not-allowed(gesture, recoverable)/  `<node>`-error）→ pip/pointer-lock を並列サブエージェントでミラー。README(en/ja)も「error は bindable でない」旨を訂正。各 100% coverage・lint・build green 独立確認。event 追加は additive で既存 imperative `el.error` を壊さず後方互換。 |
| permission / network | **capability-only・defer** | **ユーザー判断=defer**。error 面が無く `supported`/`unsupported` boolean のみ。errorInfo は `capability-missing` 単独で既存 boolean と重複、価値限定的。 |
| defined | **特殊・defer** | **ユーザー判断=defer**。`error` が snapshot 内 string（"no tags specified" / timeout 蓄積）で `_setError` 無し・caught 例外でない。 |
| timer / raf / debounce / intersection / resize | **非該当（確定）** | error も失敗 capability も無い。errorInfo 適用しない。 |

**README backfill 完了（2026-07-16、並列サブエージェント）**: errorInfo 追加 16 ノード全ての README（en `README.md` + ja `README.ja.md`、camera/speech は 2 要素分）に errorInfo を記載。Output 一覧・観測プロパティ表・wcBindable スニペット（存在する README のみ）・Design Notes の taxonomy 説明を追加。各ノードの taxonomy は capabilities ファイルと照合し実装と一致を確認（例: `wakelock` は capability-missing 無し、`screen-orientation` のイベントは `wcs-orientation:error-info-changed`＝タグ名でなく namespace）。view 族 3 も含め **errorInfo を記載した README = 全 27 ノード分**（fullscreen/pip/pointer-lock は「error は bindable でない」旨を訂正）。**残タスク = 項目 D（リリース前 dist rebuild + state 依存回帰）のみ**（リリース時対応）。

**sensor family 4 兄弟 完了（10-13 ノード目、2026-07-16）**: `accelerometer` を手作業で reference 実装（sensor 型テンプレ＝error detail の `.error` が Error.name を持つ clipboard 型、name-capture 不要）、`gyroscope` / `magnetometer` / `ambient-light-sensor` を **並列サブエージェント**で accelerometer を雛形に厳密ミラー。taxonomy は 4 兄弟で完全一致（`unsupported`→capability-missing/probe、`SecurityError`|`NotAllowedError`→not-allowed/start、`NotReadableError`→not-readable/execute、他→sensor-error/execute、全 recoverable=false）を grep で検証。**sensor は error を sticky に保つ（clear 経路が公開 API に無い）ため、errorInfo が error と同期して null にクリアされる契約を white-box `_setError(null)` テストで固定**（`error === null` 分岐カバレッジ）。各 100% coverage・lint・build green を独立再実行で確認（accel なし=73/74/72 テスト）。sync-io-core --check=19 生成ファイル整合。**残: sensor 族 README への errorInfo 追記（族 crosscut 債務と併せて要対応、[[sensor-family-crosscut-debt]]）**。

**storage=9 ノード目 完了（reference node、2026-07-16）**: CAPABILITY_ONLY テンプレを command 駆動の monitor ノードへ適用。taxonomy = `invalid-argument`（validation: 不正 type / key 未設定、phase start）/ `quota-exceeded`（QuotaExceededError、recoverable）/ `not-allowed`（SecurityError）/ `storage-error`（その他 caught、execute）。**設計の学び**: storage は `_toStorageError` で caught 例外の `Error.name` を捨てるため、geolocation（error に code を持つ）と違い name を errorInfo 分類へ運ぶ経路が要る。**public `error` shape は不変**のまま、`_setError(error, name?)` の任意引数＋`_errName(e)` helper（非 Error→`""`→storage-error、validation は name 無し→invalid-argument）で分類。這うと「非 Error throw を invalid-argument に誤分類」する潜在バグを `_errName` の単一 chokepoint で排除。148 テスト・100% coverage・lint / build / sync-check green。**caught-exception 系ノードの横展開テンプレ**（clipboard=error に name あり、storage=name を別経路で運ぶ、の 2 型が確立）。

- `09` §8 phase 6 は「I/O package へ順次適用」＝全 IO package 想定。

**⚠ scope 補正（2026-07-16、error 面の実態調査）**: 「全 27」は一様適用可能という暗黙前提だったが、実 Core の error 面を grep 精査した結果、残ノードは 3 カテゴリに分かれる。errorInfo は Phase 6 の趣旨どおり **実際の失敗を分類する** ものなので、失敗面の無いノードに付けると「起きない失敗」の捏造になる。
- **errorInfo 適用可（error / 失敗面あり）= 19**: `websocket` `sse` `broadcast` `worker` `notification` `wakelock` `camera` `speech` `defined` `screen-orientation` `idle` `tilt` `accelerometer` `gyroscope` `magnetometer` `ambient-light-sensor`（`name:"error"` property あり）+ `fullscreen` `picture-in-picture` `pointer-lock`（`_setError` あり・error は別イベント面）。
- **capability のみ（`supported`/`unsupported` ブールあり・error 面なし）= 2**: `permission`（`unsupported`）/ `network`（`supported`）。errorInfo を付けるなら `capability-missing` 単独になるが、既存の boolean と重複気味で価値は限定的。**方針: 保留**（後日、capability-missing 単独 errorInfo に価値があるか個別判断）。
- **errorInfo 非該当（error も失敗 capability も無い）= 5**: `timer` `raf` `debounce`（pure timing、失敗しない）/ `intersection` `resize`（observer、runtime error なし・`supported` prop も無し）。**errorInfo は適用しない**（該当なしとして doc 化）。
- ⇒ 実効ターゲットは **19 ノード**（+ 保留 2 + 非該当 5）。「全展開」は「適用可能な全ノード」と解釈し、19 を対象に進める。
- 手法は確立済み: `clipboard` / `geolocation` の `CAPABILITY_ONLY` テンプレ。`_setError` 集中方式（全 error 呼出点を触らず `_setError` 内で `derive*ErrorInfo(name/code→taxonomy)` → `_commitErrorInfo`）で、生成 `platformCapability` は coverage 除外・`WcsIoErrorInfo` 型のみ利用（runtime 関数は tree-shake）。
- 個別注意: `camera` は live `MediaStream` を扱う特殊ノード（serializable state を経由しない）。

**1 ノードあたりの作業内訳（2026-07-16、geolocation テンプレ精読）**: (1) `sync-io-core.mjs` の `PACKAGE_FILES` に `CAPABILITY_ONLY` 追加 →再生成 (2) `xxxCapabilities.ts` に error code + `deriveXxxErrorInfo`（**←ここだけ node 別の taxonomy 判断が要る**。例: geolocation は spec code 1/2/3 を写し permission-denied のみ recoverable=false） (3) Core に `errorInfo` bindable property + `_errorInfo` + getter + `_commitErrorInfo`、`_setError` に derive+commit を配線 (4) Shell に `errorInfo` getter (5) `exports.ts` に `WcsIoErrorInfo` 型 + `WCS_XXX_ERROR_CODE` export (6) errorInfo テスト (7) 生成 `platformCapability.ts` を coverage 除外 (8) README / design doc 更新。**構造はボイラープレート、taxonomy（step 2）のみ判断。memory のハザード（cancel エラー名は各ノードの実 API に合わせる／共有 doc の単位・code 記述を鵜呑みにしない）を各ノードで適用する。**

### B. Phase 5a — `wcs-validate` を CI 必須ゲート化【完了 2026-07-16】

**実装済み**: `.github/workflows/ci.yml` に独立 job `wcs-validate` を追加。vscode-wcs をビルドし、`examples/` + `packages/` の HTML / manifest（node_modules/dist/coverage/.tsc-out を prune）を `wcs-validate --errors-only` にかけ、**error severity があれば build を落とす**。決定「全 HTML を error のみで gate」を採用（scoped 66 ファイルで現状 0 error → 低リスク回帰ガード）。
- CLI に `--errors-only`（別名 `--quiet`）を追加: error 行だけ表示し warning/info は count のみ（外部 state 由来の false-positive warning で CI ログを埋めない）。`runValidation` に `errorsOnly` option（表示のみ変更、count/exitCode 不変）+ 専用テスト。vscode-wcs 276 テスト green。
- vscode-wcs は `@wcstack/*` でなく detect-changes matrix 対象外のため、`protocol-types-sync` と同様の独立 job にした。

以下は決定に至った検証記録:

- validator core + `wcs-validate` CLI は実装済み。`.github/workflows/ci.yml` には現状 `sync-io-core.mjs --check` **のみ**で、`wcs-validate` 実行が無い。
- manifest drift / path / modifier 違反で build を落とすステップを ci.yml に追加する。
- 完了条件「IDE と CI の diagnostic code / range が一致」（`09` §8 5a）は達成済み。残るは CI ゲート化のみ。

**検証（2026-07-16、CLI 試走）— 検証対象が要決定**:
- repo に `wcstack.manifest.json` は **0 個**（manifest drift チェックは現状「対象なし」）。
- `examples/` + `packages/` の HTML **648 ファイル**を CLI にかけると **error は実質 0**（唯一の 1 error は `packages/vscode-wcs/coverage/.../templateSyntax.ts.html` = coverage 生成物の誤検出。coverage/dist/node_modules を除外すれば 0）。
- ただし例（例: `state-notification-chat`）は `wcs/binding-path-missing` **warning** を多数出す。原因は state を外部 script / CDN でロードし静的解決できないため（例のバグでなく validator の限界）。exit code は error 時のみ 1 なので warning は build を落とさないが、CI 出力が大量の false-positive で埋まる。
- ⇒ **「何を検証対象にするか」の決定が必要**。選択肢: (a) 全 HTML を error のみで gate（今は 0・低リスクだが warning ノイズ大）(b) inline state の self-contained fixture を用意して gate（クリーンだが要作成）(c) IO ノードの `static wcBindable` から manifest を生成して drift-check（"manifest drift" の本旨に最も忠実だが最大工数）。

### C. Phase 5b — `enableContractAnalyzer` は explicit opt-in を正式仕様化【決定済み 2026-07-16】

- **決定: dev 既定 ON は採らず、explicit opt-in（`default false`）を正式仕様とする。**
- 理由: wcstack は buildless / zero-config で NODE_ENV 相当の確実な dev/prod 判定が無い。hostname（localhost 等）や non-minified の heuristic で auto-ON すると誤検出で prod にコストを乗せうる。明示 dev フラグ（`window.__WCS_DEV__` 等）も利用者の手動設定が要り zero-config を崩す。⇒ 現状の `default false` + `setConfig({ enableContractAnalyzer: true })` を最も安全な設計として確定。
- 反映: [config.ts](../../packages/state/src/config.ts) の `enableContractAnalyzer` にこの意図を明記。「無効時 runtime 挙動・cost 不変」（`09` §8 5b）は達成済みなので、opt-in である限り追加実装は不要。state 系フラグは directional / propagation が既定 ON、analyzer のみ意図的 opt-in で確定。

### D. ビルド / リリース衛生 — 各パッケージ dist 再ビルド【リリース時】

- **2026-07-17 検証で訂正**: `state` / `fetch` の dist は**最新**（再ビルドで byte 差分ゼロを確認。state dist は `enableDirectionalInitialSync: true` / `enablePropagationContext: true` を含む）。当初の「state dist は stale」は誤りだった。
- `share` / `contacts` / `eyedropper` / `credential` / `upload` / `clipboard` / `geolocation` の dist も Phase 4/6 の成果物（errorInfo）を含むことを確認（marker 検査）。当初の「src 変更が dist 未反映」リストは全体として誤りだった。
- 一方 `router` は本日の wcBindable 修正（下記）が dist 未反映（再ビルドで差分が出ることを確認し、リリース時方針に合わせて dist は据置）。加えて `protocol/wcBindable.ts` の再生成（`version: 1` → `version: number`）を取り込んでいない dist が残る（`debounce` / `network` / `router` の再ビルド差分で確認）。**リリース時は全パッケージ一括 rebuild が安全**。
- 設計上リリース build で解消するが、公開 artifact は現状フラグ反映前。リリースまでに:
  1. 各パッケージ rebuild（`rimraf dist` → `tsc` → `rollup -c`）
  2. **`state` に依存する `router` / `signals` / `server` / `examples` の回帰確認**（dist 更新で新既定が効くため）

**examples 回帰確認 完了（2026-07-17、ローカル dist ＋ 実ブラウザ）**: 上記 2 を先行実施し、既定 ON で **実際に壊れる例を 6 件検出・修正**した（5 件は初回検証、6 件目の `packages/state/examples/spread` は全 examples の 2 回目掃引で検出）。examples は CDN（公開済み v1.20.0）を読むため、この破壊はリリースまで顕在化しない。
- **根因は 1 件が package バグ**: `router` の `wcBindable` が settable な `navigateUrl` を `properties` にだけ宣言していた（output-only 判定 → `shouldApplyState` が state→element 書き込みを**恒久抑止** → state からのプログラム遷移が死ぬ）。`inputs` へ追加して修正（§3.6 の「properties と inputs の両方 → 互換性のため state」に一致）。実ブラウザの反実仮想で確認済み（修正前: クリックしても URL 不変／修正後: 遷移）。`path` は setter が navigate しないので output-only のまま据置。
- **残り 5 件は examples 側の pattern**: output-only スロットに state 側が「都合のよい初期値」を種蒔きし（`value: []`、`debouncedQuery: ""`）、element authority の実初期値（`null` / `undefined`）で上書きされて getter が落ちる。**seed は element の実初期値に合わせ、表示用は派生 getter で null 安全化**する形に統一（state-search / router-spa / fetch pagination / fetch users-crud）。`<wcs-debounce>` の `value` も同型（`DebounceCore._value = undefined`）で、これは e2e 実行でのみ発覚した。6 件目の `packages/state/examples/spread` は逆向きの教材（state seed→element 表示が主旨）なので、inline fake-fetch の 4 メンバを inputs にも宣言して two-way 化＝state authority を維持し、実 IO ノードとの契約差はコメントで明示した。
- **副次**: `state-sse-dashboard` の `<wcs-network>` 手動 pull（初回スナップショット消失の回避策）は Phase 2 が構造的に解決したため削除。実ブラウザで自動 pull を実証（`netSupported` シード `false` → `true` に置換され tile が描画）。
- ⇒ **教訓**: 「output-only メンバに state 側の初期値を持たせる」は Phase 2 既定 ON で成立しなくなる。既存アプリの移行ガイドに要記載。`for:` パスは validator が静的に配列型を要求するため、null seed と併せて**派生 getter へ向ける**必要がある（`wcs-validate` が実際にこの誤りを捕捉した）。
- **7 件目（2026-07-17、v1.21.0 リリース後に発見）= 2 つ目の package バグ**: DCC の `createWcBindable`（`packages/state/src/dcc/wcBindable.ts`）が `properties` のみを生成し `inputs` を作らないため、`$bindables` 全メンバが output-only 判定 → 親 state → DCC 書き込みの恒久抑止に加え、DCC 側初期値が `commitProducerValue` で親 state へ逆流。output-only の許可 authority は `element|none` のみで `init=state` は throw するため、利用者側の回避手段が無い。修正 = `inputs: bindables.map((name) => ({ name }))` を追加（branch `fix/dcc-bindable-inputs`、README:「Binding to DCC Properties」の用法が対象）。
  - 検出漏れの構造要因: DCC の宣言は**実行時の動的生成**で `static wcBindable` の grep 掃引に出ない。e2e (`__e2e__/dcc/index.html`) は親 `cnt: 0` と DCC `count: 0` の seed が同値で逆流が不可視、かつ親→DCC 方向を未検証 → 非対称 seed（`cnt: 5`）と親側 increment ボタンを追加して塞いだ。回帰テストは `bindings.initialSyncPolicy.test.ts`（実 `createWcBindable` で authority=state と逆流なしを固定）+ `dcc.wcBindable.test.ts`（properties/inputs 同一集合の不変条件）。
  - 規範の明文化: 「settable なメンバは `properties` と `inputs` の両方に宣言する」を state README（en/ja）の新節「Binding Authority (`#init=` / `#sync=`)」として追加（v1.21.0 時点では `#init=`/`#sync=` の説明節自体が README に無く、規範は本ディレクトリ `09` §3.6 のみだった）。

### E. ドキュメント / normative 更新【完了 2026-07-16】

- `03-two-way-echo-control.md` ヘッダ / `09` §3.6（directional）/ §4（propagation）/ §8 に実装ステータス
  callout を追加済み（「既定 on・恒久 opt-out」と本書へのリンク）。本文は flag 導入時の記述のまま残るが、
  callout が normative pointer として現状を指す。

### F. 確認事項【解決済み 2026-07-16】

- Phase 4 `09` §6「非同期 trace queue（DevTools side-channel）」の適用状況を検証した。**結論: lane trace は fetch を含む全 6 lane ノードで一様に休眠**しており、「fetch だけ適用済み」という非対称は存在しない。
  - `io-core/operation-lane.ts` は optional な `trace?: (event: OperationTraceEvent) => void` を持ち、渡さなければ trace record を一切生成しない（§10.3 hook-off zero-allocation gate）。この能力は各パッケージの生成コピー（byte-identical）に inline されている。
  - しかし **6 ノード全て**（`fetch` / `share` / `contacts` / `eyedropper` / `credential` / `upload`）が `new OperationLane(key, policy, { withSignal })` で構築し、**`trace` option を渡していない** → lane の `_trace` は常に undefined。
  - `packages/state` の `devtoolsSink` は state 面イベント（`state:binding-added` / `state:update-batch` / command token / contract analyzer）を受けるが、**lane の `io:operation-*` イベント型を持たず、両者を繋ぐブリッジは未実装**。
  - ⇒ 半端な適用（fetch だけ trace あり）は無い。lane trace → state devtoolsSink の橋渡しは**未着手の followup**（一貫した gap）であり、既定化ブロッカーではない。DevTools 統合を実装する時に、6 ノード一律で `trace` を配線し devtoolsSink 側に lane イベント型を追加する。

---

## 3. 推奨順序

当初の推奨順序 1-4（A 方針決定 → B CI ゲート → C analyzer 判断 → A 横展開）と E は
**すべて完了/確定済み（2026-07-16）**。残りは:

1. **D（release build + 依存回帰）** — リリース時にまとめて実施（examples 回帰は 2026-07-17 に先行実施済み、§D）
2. **defer 3 の個別判断** — permission / network（capability-only errorInfo の価値）、defined（error 面の再設計）
3. **lane trace → devtoolsSink ブリッジ** — 未着手 followup（§F、既定化ブロッカーではない）

---

## 付記: 検証した事実（2026-07-17 再検証）

- errorInfo 実装済み **27 パッケージ** = `grep -rl errorInfo packages/*/src/exports.ts`（横展開前の初期値は 8）。
- lane 生成コピー保有 6 パッケージ = `packages/*/src/core/operationLane.ts`。`sync-io-core.mjs --check` = 33 生成ファイル整合。
- CI の architecture-hardening 関連ステップは `sync-io-core.mjs --check` に加え、独立 job **`wcs-validate`**（§B で追加。examples + packages の HTML を error severity で gate、現状 0 error）。
- 2026-07-17 追加: 独立 job **`bindable-conformance`**（`scripts/conformance-bindable-inputs.mjs`）— 「settable な wcBindable メンバは `inputs` にも宣言する」不変条件を、dist バンドルを import した**評価済み宣言** × プロトタイプチェーン setter の突合で検査（41 pkg / 79 class / 441 メンバ）。ソース lint と違い動的生成宣言もカバーし、v1.20.0 router に対して `navigateUrl` を検出することを実証済み（router navigateUrl / DCC `$bindables` 型ドリフトの恒久ガード）。committed dist は src に遅行するため、release.yml でも bump 後 rebuild 直後・publish 前に同 script を再実行して補完。意図的 output-only（`Router.path` / `StorageCore.value`）は script 内 allowlist に理由付きで記録。dist export に現れない宣言ファクトリ（DCC `createWcBindable`）は state の unit test が固定。
- Phase 2 flip は commit `aaeb784`（メッセージは "geolocation errorInfo" と実態を過小記述、state 変更を混載）に含まれる。
