# 実装計画: `$streams`（@wcstack/state）

- **状態**: 計画策定済・未着手（2026-07-11）。設計の正本は [state-streams-design.md](./state-streams-design.md)（以下「設計書」）。本書は設計書 §9 のフェーズ分割を、着手可能なタスク粒度・テスト対応・完了条件に展開した手順書。
- **ブランチ**: `feature/state-streams`（本書・設計書と同居。実装コミットもここに積む）。
- **参照実装**: `packages/signals/src/streamResource.ts` ＋ `packages/signals/__tests__/streamResource.test.ts`（fake source ヘルパの移植元でもある）。
- **作業ディレクトリ**: `packages/state/`。signals パッケージには触れない（fold-throw abort の逆輸入は別 PR、設計書 §11-3）。

---

## 0. 全体方針

- **Phase A → B → C → D の順に、Phase 単位でコミット**する。各 Phase の完了条件（DoD）は共通:
  1. `npm test` green（既存テスト含む）
  2. `npm run test:coverage` の閾値維持（100/97/100/100）
  3. `npm run lint` pass
- テストは各モジュールと**同時に**書く（後追いでカバレッジを埋めない）。テストファイル命名は既存規約 `<module>.<name>.test.ts` に従い `stream.*.test.ts` とする。記述は日本語。
- 受け入れ条件の対応は設計書 §10 のマトリクス（P1–P16 / S1–S18）を正とし、各タスクに対応 ID を付す。
- 公開 API の追加はない（`$streams` は宣言マップのみ）。`exports.ts` / rollup 設定は変更不要。

---

## Phase A — 供給の背骨（依存 restart なし）

ゴール: `$streams` 宣言 → connect で eager 起動 → チャンクが fold されて reactive プロパティに反映 → done/error → disconnect で abort、まで一気通貫。`args` は受理・検証するが restart 配線は Phase C。

### A-0. 予約名定数

- `src/define.ts` に追加:
  - `STATE_STREAMS_NAME = "$streams"`
  - `STATE_STREAM_STATUS_NAMESPACE_NAME = "$streamStatus"`
  - `STATE_STREAM_ERROR_NAMESPACE_NAME = "$streamError"`
- テスト不要（定数）。

### A-1. 型定義 — `src/stream/types.ts`

- `StreamStatus` / `StreamSource` / `StreamProducer`（signals の同名型を state 語彙で再定義）、`IStreamDefinition` / `IStreamEntry`（設計書 §2-1）。
- `IStreamEntry.depAddresses: Set<IAbsoluteStateAddress>` は Phase C まで空 Set のまま。

### A-2. consume 移植 — `src/stream/consumeSource.ts`

- signals `streamResource.ts` の `consume` / `iterate` / `readableToAsyncIterable` を移植。**状態書き込みをコールバック注入に変える**のが唯一の構造差分:
  ```ts
  interface ConsumeSink {
    fold(chunk: unknown): void;     // 呼び出し側で fold + setByAddress
    done(): void;
    fail(error: unknown): void;
  }
  export async function consumeSource(
    source: StreamSource, args: unknown, signal: AbortSignal, sink: ConsumeSink
  ): Promise<void>;
  ```
- 維持する要点（設計書 §3-3）: 明示的 iterator 取得＋abort 時 `return()` 救済／`return()` の throw・reject 握りつぶし／source await 中 abort の後始末／getReader フォールバック（`reader.cancel()` で parked read 解放・done まで消費なら cancel しない）／全経路 stale-drop／非 producer 戻り値の明示 TypeError。
- **state 版の差分**: sink.fold 内で throw された場合（fold throw）も fail 経路に流し、呼び出し側で `controller.abort()` する（S14）。
- テスト: `stream.consumeSource.test.ts` — **P4, P8, P9, P10, P11, P12, P13, P14, P15** を signals テストから語彙変換して移植。fake ヘルパ（手動 resolve の async generator / fake ReadableStream）は `__tests__/helpers/fakeStreamSources.ts` として signals から移植。
- 見積もり: テスト 10〜12 本。ここが Phase A の最大タスク。

### A-3. registry — `src/stream/streamRegistry.ts`

- `eventTokenRegistry` と対称の `WeakMap<IStateElement, Map<string, IStreamEntry>>`。
- 公開関数: `setStreamEntries` / `getStreamEntries`（無ければ空 Map）/ `abortAllStreams`（abort ＋ status="idle"・error=null、registry 保持）/ `clearStreamRegistry`（abort ＋ delete）。`__private__` で registry を露出（既存慣行）。
- テスト: `stream.streamRegistry.test.ts` — 登録・取得・abort（controller.abort が呼ばれ status が idle に戻る）・clear の 4〜6 本。

### A-4. 宣言パース — `src/stream/processStreamsDeclaration.ts`

- シグネチャ: `processStreamsDeclaration(stateElement, state): void`（entry 構築 → `setStreamEntries`。`processCommandTokensDeclaration` の検証スタイルを踏襲）。
- 検証（設計書 §1-2、違反は `raiseError`）: `$streams` 非オブジェクト／name に `.`・`*`・先頭 `$`／getterPaths・setterPaths との衝突／`source` 非関数／`fold` 非関数／`fold` あり `initial` なし／`args` 非関数。
- 値プロパティ実体化（§1-3): `name in state` が false なら `state[name] = initial ?? undefined` を代入。
- 注意: 呼び出し時点の `stateElement.getterPaths` が確定済みであること — `State._state` セッター内の **`getStateInfo` 収集より後**に呼ぶ（A-6 で順序を規定）。
- テスト: `stream.processStreamsDeclaration.test.ts` — **S15** 全違反ケース＋正常系（実体化・既存プロパティ非上書き）で 10〜12 本。

### A-5. runtime 起動・チャンク反映 — `src/stream/streamRuntime.ts`

- `startStreams(stateElement)`: 全 entry に対し `startStream(stateElement, entry)`。
- `startStream`（start = restart の共通手順、設計書 §2-2）:
  1. `entry.controller?.abort()` → 新 `AbortController`
  2. `args` 評価（Phase A では **readonly proxy で呼ぶだけ**。トレースなし。Promise が返ったら raiseError）
  3. `createState("writable", s => { s[name] = definition.initial })`（initial リセット）
  4. `entry.status = "active"; entry.error = null` ＋ status 反映（A 時点では registry 更新＋`$postUpdate` 呼び出しまで実装 — 名前空間パスの読みは Phase B で解決されるようになる。未解決でも enqueue は無害）
  5. `consumeSource(...)` を起動。sink 実装:
     - `fold(chunk)`: `createState("writable", s => { s[name] = definition.fold(s[name], chunk) })`。fold throw は catch して `controller.abort()` ＋ fail 経路（S14）
     - `done()`: status="done" 反映
     - `fail(e)`: status="error"・error=e 反映（値は触らない）
- status/error 反映ヘルパ `updateStreamStatus(stateElement, entry, status, error)`: registry 書き換え → 同値ならスキップ → connected なら writable proxy の `$postUpdate` を `$streamStatus.<name>`（error 変化時は `$streamError.<name>` も）に対して呼ぶ。
- テスト: `stream.streamRuntime.test.ts` — **P1, P2, P3, P6, P7** ＋ fold throw（**S14**）＋ 同値チャンクで binding 更新なし（**S4**、sameValueGuard 経由の確認）で 8〜10 本。updater の flush は `await Promise.resolve()`（microtask 1 周）か `testApplyChange` で決定的に駆動。

### A-6. State ライフサイクル接続 — `src/components/State.ts`

- `_state` セッター: `getStateInfo` 反映の**後**に `clearStreamRegistry(this)` → `processStreamsDeclaration(this, value)`。接続済み（`_rootNode !== null` かつ initialized）での再 set なら続けて `startStreams(this)`（S13 の二重起動なしを担保）。
- `connectedCallback`: `_callStateConnectedCallback()` の直後に `if (!inSsr()) startStreams(this)`（S1, S2。`enable-ssr` クライアント側は起動する — 分岐条件に注意: SSR スキップは `inSsr()` のみで判定）。
- `disconnectedCallback`: `clearEventTokenRegistry` の並びに `abortAllStreams(this)` を追加（P16/S12 の abort 側）。
- テスト: `stream.lifecycle.test.ts`（`<wcs-state>` を happy-dom で実際に connect する統合テスト。既存の `waitForStateInitialize` / `components.*` 系の待ち方に従う）— **S1, S2, S12（abort＋再接続で initial から）, S13, S3（1 tick N チャンク→flush 1 回）, S16（stream 値依存の computed が dirty 化）, S17（$updatedCallback に載る）** で 8〜10 本。

**Phase A コミット**: `feat(state): add $streams declaration, eager start, and fold pipeline (phase A)`

---

## Phase B — コンパニオン名前空間

ゴール: `$streamStatus.<name>` / `$streamError.<name>` が binding・JS 両経路で読め、reactive に追従し、書き込みは防御される。

### B-1. namespace proxy — `src/stream/streamNamespace.ts`

- `commandNamespace.ts` と対称: `getStreamStatusNamespace(stateElement)` / `getStreamErrorNamespace(stateElement)`（WeakMap memo・read-only proxy・宣言外キーは undefined・`set`/`deleteProperty` は raiseError・`ownKeys` は宣言済み stream 名）＋ `clearStreamNamespace`。
- 値の解決は registry entry の `status` / `error` を読む thin gateway。
- テスト: `stream.streamNamespace.test.ts` — memo 同一性・宣言外 undefined・Symbol キー耐性・read-only（**S11** の単体側）で 6〜8 本。

### B-2. 読み取り経路の配線

- `src/proxy/methods/getByAddress.ts`: `$command` 分岐（`_getByAddress` 冒頭）の直後に `$streamStatus` / `$streamError` の分岐を対称追加（第 1 セグメント判定 → namespace を渡り歩く同型ループ）。
- `src/proxy/traps/get.ts`: switch に 2 case 追加（namespace proxy を返す）。
- `State.disconnectedCallback` / `_state` セッターに `clearStreamNamespace` を追加（`clearCommandNamespace` の並び）。
- テスト: 既存 `proxy.*` テストの流儀で `stream.namespaceResolution.test.ts` — binding パス解決（`data-wcs="text: $streamStatus.tokens"` の実 binding）・JS 直接アクセス・two-way set の raiseError（**S9, S10, S11** の統合側）で 6〜8 本。

### B-3. 反映の end-to-end 確認

- A-5 の `$postUpdate` 呼び出しが binding 更新に到達することの統合テスト（idle→active→done の遷移が観測される — coalesce により中間が潰れる場合があることもテストで明文化）。**S9/S10 完結**。
- `$streamStatus.<name>` を読む computed（`get isStreaming()`）が status 変化で再計算されることを 1 本（`$postUpdate` の walkDependency 経由、設計書 §4-3）。

**Phase B コミット**: `feat(state): resolve $streamStatus/$streamError namespaces (phase B)`

---

## Phase C — 依存駆動 cancel/restart（核心）

ゴール: `args` が読んだパスの変化で abort → initial リセット → 張り直し。1 tick 複数変化 = 1 restart。

### C-1. args トレース — `streamRuntime.ts` 内 `trackArgs`

- モジュールスコープの collector（`Set<IAbsoluteStateAddress> | null`）。`getByAddress` の入口（`checkDependency` 呼び出し直後）に 1 フック追加:
  ```ts
  // getByAddress.ts — ホットパスなので null チェック 1 回のみ
  collectStreamDependency(stateElement, address);  // collector が null なら即 return
  ```
  実装はフラグ関数を `streamRuntime.ts`（または `stream/argsTraceCollector.ts`）から export し、getByAddress 側は 1 行の呼び出しに留める。
- `trackArgs(stateElement, entry)`: collector を立てて readonly proxy で `definition.args(state)` を実行 → `entry.depAddresses` を**丸ごと置換**（per-run 再捕捉）→ 検査:
  - 自己依存（`<name>` / `$streamStatus.<name>` / `$streamError.<name>` が含まれる）→ raiseError（**S8**）
  - wildcard を含むパス → raiseError（設計書 §3-1）
- `startStream` の手順 2 を「評価のみ」から `trackArgs` に差し替え。
- テスト: `stream.trackArgs.test.ts` — 依存収集（直接パス／getter 経由＝キャッシュ命中時は getter 自身のアドレスのみでよいことを両方固定）・自己依存 raiseError・wildcard raiseError・args なしは空 Set、で 6〜8 本（**S7 の単体側, S8**）。

### C-2. updater drain フック — `src/updater/updater.ts`

- `registerUpdateBatchListener(listener)` ＋ `_applyChange` 末尾で `notifyUpdateBatchListeners(absoluteAddressSet)`（設計書 §3-2 の骨子どおり）。listener 内の throw は握りつぶさない（内部バグの隠蔽防止。streams 側 listener が自前で try/catch する）。
- テスト解除用に `unregisterUpdateBatchListener` も用意（テスト間の分離。`__private__` 経由でも可）。
- テスト: 既存 `updater.updater.test.ts` に追記 — listener が drain ごとに Set を受け取ること・`testApplyChange` から同期に呼べること、2〜3 本。

### C-3. restart 配線 — `streamRuntime.ts`

- モジュール初期化時に listener を 1 つ登録。listener の処理:
  1. 起動中（connected・registry あり）の stateElement を列挙できる必要がある → **弱参照で列挙できないため、`activeStateElements: Set<IStateElement>` を streamRuntime が保持**（`startStreams` で add、`abortAllStreams`/`clearStreamRegistry` で delete。disconnect と連動するのでリークしない）。
  2. 各 entry: `entry.status` を問わず（done/error からも再試行）、`entry.depAddresses` と batch の交差を `Set.has` で判定。
  3. hit → `startStream(stateElement, entry)`（start = restart 同一手順なので新規コードは交差判定のみ）。
- 交差判定の注意: batch は `AbsoluteStateAddress` インスタンスの Set、depAddresses も同（インスタンス同一性が成立、設計書 §2-1）。**wildcard 側からの照合は不要**（args の wildcard 読みは C-1 で禁止済み）。
- テスト: `stream.restart.test.ts` — **P5（abort→initial リセット→張り直し→stale-drop）, S5（1 tick 複数書き→restart 1 回）, S6（無関係パス→restart なし）, S7（computed 依存の統合側）, S18（stream 間連鎖）**、＋「同一 drain にチャンク反映と restart トリガが同居 → restart が勝つ」（設計書 §3-2）で 8〜10 本。

**Phase C コミット**: `feat(state): dependency-driven stream restart via updater drain hook (phase C)`

---

## Phase D — 仕上げ

### D-1. ドキュメント

- `packages/state/docs/streams.md` / `streams.ja.md` を新規作成（既存の `define-state.md` / `path-getters.md` と同じ en/ja トピック文書ペアの流儀）。内容 = 規範一式: `$streams` 宣言契約（§1-1/1-2）・協調キャンセル契約（source は signal を尊重すること MUST）・**有界 fold 規範（MUST）**・fold は新値 return（in-place 変異禁止）・observability 保証（中間 status 非保証）・スコープ外リスト（設計書 §8）。
- `packages/state/docs/define-state.md` / `.ja.md` に `$streams` 宣言の節を追記（`$commandTokens` / `$eventTokens` / `$on` の並び）。
- `README.md` / `README.ja.md`: 宣言例（LLM トークン累積＋ticker latest）・`$streamStatus`/`$streamError` の binding 例・fetch streaming の一節・streams.md へのリンク。
- `packages/state/CLAUDE.md` の Directory Structure に `stream/` を追記。

### D-2. example

- `packages/state/examples/` に 1 本: **fetch body streaming → reduce で text 累積**（`response.body` を source にし、`$streamStatus` でプログレス表示、prompt 入力の変更で switchMap restart が見えるもの）。CDN 一発ルール（`esm.run/@wcstack/state/auto`）に従う。examples/shared のサーバー流儀があれば chunked レスポンスのルートを足す。

### D-3. 品質ゲート

- `npm run test:coverage` で 100/97/100/100 を確認（不足分は異常系テストで埋める — 特に consumeSource の分岐）。
- `npm run lint` / `npm run build`（rollup 3 出力＋d.ts 生成が通ること。新規ディレクトリの tsc パス漏れに注意）。
- 可能なら実ブラウザで example を目視（happy-dom に無い実 ReadableStream / TextDecoder 経路の確認）。

### D-4. 残課題の切り出し（実装しない）

- signals `streamResource` への fold-throw abort 逆輸入 → 別 PR メモ。
- `IState` への `$streams` TS 型付与と `packages/vscode-wcs` への型供給 → 別課題。
- DCC 内 `$streams` 対応 → 別課題。

**Phase D コミット**: `docs(state): $streams spec, README, and streaming example (phase D)`

---

## リスクと詰まりどころ（先回りメモ）

| # | リスク | 対応 |
|---|---|---|
| R1 | happy-dom に実 ReadableStream が無い/挙動差 | signals テストと同じ **fake**（手動 resolve generator・fake getReader オブジェクト）で単体を固め、実 ReadableStream は D-3 の実ブラウザ確認に委ねる |
| R2 | `connectedCallback` が async で、startStreams の時点が binding 初期化と交錯 | S1 テストで「$connectedCallback 完了後に args 評価」を固定。binding 初期レンダとの前後は保証しない（観測保証 §4-4 に一致） |
| R3 | `getByAddress` へのフック追加はホットパス | collector は module-scope 変数の null チェック 1 回のみ。`_bench` があれば before/after を 1 回だけ確認（sameValueGuard 導入時と同じ判断基準） |
| R4 | restart 内の書き込みが drain 再入を起こす | 設計どおり「新しい microtask バッチ」になることをテストで固定（S5 で restart 起因の書き込みが同一 drain に混ざらないこと） |
| R5 | 再接続（S12）で eventToken 側 registry が disconnect で消える既存挙動との非対称 | streams は「disconnect=abort のみ・registry 保持」で設計済み（§5-2）。event-token 側の再接続挙動には触れない（スコープ外） |
| R6 | カバレッジ 100% と防御的コードの衝突（到達不能分岐） | wcs-raf の前例（到達不能ガードは削除）に従い、書く前に到達可能性を考える |

## 見積もり

- 新規 src 6 ファイル（stream/ 配下）＋既存 4 ファイル変更（define / State / updater / getByAddress・get trap）。
- テスト: 新規 8 ファイル・計 55〜70 本（P1–P16・S1–S18 を全て消化。バリデーション・異常系の内訳で増える）。
- 作業順序は上記どおり厳守（A-2 の consume 移植を最初の大タスクに置き、B は A と独立性が高いので詰まったら先行入れ替え可。C は A・B 完了が前提）。

## 関連

- [state-streams-design.md](./state-streams-design.md) — 設計の正本（§10 受け入れマトリクスの ID を本書のタスクが参照）。
- [state-stream-type-design.md](./state-stream-type-design.md) — 背景と境界規約。
- `packages/signals/__tests__/streamResource.test.ts` — 移植元テストと fake ヘルパの原本。
