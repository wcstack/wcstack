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
| 5a 静的契約 | validator core / `wcs-validate` CLI | 実装完。**CI 必須ゲート化が未（§B）** |
| 5b 開発時照合 | `enableContractAnalyzer` analyzer | 実装完（opt-in）。**dev 既定 ON 化が未（§C）** |
| 6 capability | probe / report / error taxonomy | **8 / 35 IO ノード**適用済み。**残 27 ノードの横展開が未（§A）** |

### 既定化済みフラグ（`packages/state/src/config.ts`）

- `enableDirectionalInitialSync: true` — Phase 2。output-only な `wcBindable` メンバは初期値を element→state で読み取り、双方向/input メンバは state→element を維持。setup-path コストは初期 render の 5% 未満（producer-value observer は echo しうる双方向 wire にのみ登録）。
- `enablePropagationContext: true` — Phase 3。write-path コストは一方向バインドでほぼゼロ（echo しうる双方向 wire のみ因果 bookkeeping）。
- `enableContractAnalyzer: false` — Phase 5b。唯一 opt-in のまま（§C）。

いずれも decision 3 に従い**フラグは撤去せず恒久 opt-out** として残す。

### lane 適用済み operation ノード（6）

`fetch`(latest) / `share`(exhaust) / `contacts`(exhaust) / `eyedropper`(latest) / `credential`(latest) / `upload`(latest)。
正典は `io-core/{operation-lane,platform-capability}.ts`、`scripts/sync-io-core.mjs` が各 `src/core/` へ生成コピー（copy-distribution、新 npm 依存なし）。CI は `sync-io-core.mjs --check` で再生成差分を検査。

### errorInfo 適用済みノード（8）

lane 6 ノード + 非競合 2（`clipboard` / `geolocation`、`CAPABILITY_ONLY`＝errorInfo のみ）。

---

## 2. 残作業

### A. Phase 6 — errorInfo taxonomy の横展開【要方針決定 → 機械的】

現状 **8 / 35 IO ノード**。未実装 **27 ノード**:

> storage, websocket, sse, broadcast, worker, timer, raf, debounce, permission, notification,
> intersection, resize, wakelock, camera, speech, defined, fullscreen, picture-in-picture,
> pointer-lock, screen-orientation, idle, network, tilt, accelerometer, gyroscope,
> magnetometer, ambient-light-sensor

- **先に方針決定が必要**: 全ノードへ広げるか、代表ノードで止めるか。`09` §8 phase 6 は「I/O package へ順次適用」＝全 IO package 想定。
- 手法は確立済み: `clipboard` / `geolocation` の `CAPABILITY_ONLY` テンプレ。`_setError` 集中方式（全 error 呼出点を触らず `_setError` 内で `derive*ErrorInfo(name/code→taxonomy)` → `_commitErrorInfo`）で、生成 `platformCapability` は coverage 除外・`WcsIoErrorInfo` 型のみ利用（runtime 関数は tree-shake）。
- 個別注意: `camera` は live `MediaStream` を扱う特殊ノード（serializable state を経由しない）。

### B. Phase 5a — `wcs-validate` を CI 必須ゲート化【機械的・独立・低リスク】

- validator core + `wcs-validate` CLI は実装済み。`.github/workflows/ci.yml` には現状 `sync-io-core.mjs --check` **のみ**で、`wcs-validate` 実行が無い。
- manifest drift / path / modifier 違反で build を落とすステップを ci.yml に追加する。
- 完了条件「IDE と CI の diagnostic code / range が一致」（`09` §8 5a）は達成済み。残るは CI ゲート化のみ。

### C. Phase 5b — `enableContractAnalyzer` を dev 既定 ON【要判断 → 実装】

- 現状 opt-in（`default false`）。「無効時 runtime 挙動・cost 不変」（`09` §8 5b）は達成済み。
- dev モード検出（どう判定するか）＋既定 ON 化の判断と実装が残る。state 系フラグで唯一 opt-in のまま。

### D. ビルド / リリース衛生 — 各パッケージ dist 再ビルド【リリース時】

- **`state` dist は stale**（Phase 2/3 の flip が `dist/*.js` に未反映）。`fetch` / `share` / `contacts` / `eyedropper` / `credential` / `upload` / `clipboard` / `geolocation` も src 変更が dist 未反映。
- 設計上リリース build で解消するが、公開 artifact は現状フラグ反映前。リリースまでに:
  1. 各パッケージ rebuild（`rimraf dist` → `tsc` → `rollup -c`）
  2. **`state` に依存する `router` / `signals` / `server` / `examples` の回帰確認**（dist 更新で新既定が効くため）

### E. ドキュメント / normative 更新【軽微】

- `03-two-way-echo-control.md` / `09` §3.6（directional）/ §4（propagation）は feature-flag 前提の記述 → 「既定 on・恒久 opt-out」を反映。
- `09` §8 phase 表に defaulting 完了状況を注記（または本書へのリンク）。

### F. 確認事項【未確定】

- Phase 4 `09` §6「非同期 trace queue（DevTools side-channel）」が `fetch` 以外の lane ノードまで適用済みか要確認。`packages/state` に `devtoolsSink` は存在するが、lane 側の trace queue の全体適用状況は未検証。

---

## 3. 推奨順序

1. **A の方針決定**（全展開か代表止めか）— 残工数が大きく変わるため最初に確定
2. **B（CI ゲート）** — 独立・機械的・低リスク、すぐ着手可
3. **C（analyzer dev 既定 ON）** — 判断 → 実装
4. **A の横展開実行** — 方針次第で 27 ノード or 一部
5. **E（doc）→ D（release build + 依存回帰）** — リリース前にまとめて

---

## 付記: 検証した事実（2026-07-16 時点）

- errorInfo 実装済み 8 パッケージ = `grep -rl errorInfo packages/*/src/exports.ts`。
- lane 生成コピー保有 6 パッケージ = `packages/*/src/core/operationLane.ts`。
- CI の architecture-hardening 関連ステップは `sync-io-core.mjs --check` のみ（`wcs-validate` / analyzer 参照なし）。
- Phase 2 flip は commit `aaeb784`（メッセージは "geolocation errorInfo" と実態を過小記述、state 変更を混載）に含まれる。作業ツリーは clean。
