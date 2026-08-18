# 実装計画: `$watch`（@wcstack/state）

- **状態**: **Phase A–D 完了**（2026-08-19）。state は 243 files / 2376 tests green・lint 0・`src/watch` は 100/100/100/100、vscode-wcs は 412 tests green。残るのはリリース（minor bump）。設計の正本は [state-watch-hook-design.md](./state-watch-hook-design.md)（以下「設計書」）。本書はその §2〜§11 を着手可能なタスク粒度・テスト対応・完了条件に展開した手順書。
- **Phase A の裁定記録**:
  - `setPathInfo` の再利用は問題なし（§6-1 の宿題）。`"prop"` 渡しでは `_pathSet` への追加と親子 `addStaticDependency` チェーン生成だけが走り、`listPaths` / `elementPaths` は触らない。なお `_pathSet` は `_state` セッターでクリアされるため、watch の依存登録も再 set のたびにやり直す必要がある（`processWatchDeclaration` を `_pathSet.clear()` より後に置くことで担保）。
  - **切断時に registry を捨ててはいけない**（計画の初稿の誤り）。`_state` セッターは初回ロード時にしか走らないため、registry まで消すと再接続で宣言を作り直す経路が無く watch が二度と発火しない。`$streams` の `abortAllStreams` / `clearStreamRegistry` と同じ二段構え（`deactivateWatch` / `clearWatchRegistry`）に修正。
  - **再入ガードは「ハンドラ実行中に enqueue が起きたか」で数える**必要がある。「watch が発火したら次バッチの深さを +1」にすると、毎操作で watch が発火するアプリが 32 操作で誤打ち切りされる。updater と watchRuntime の両方から参照する葉モジュール `watch/chainDepth.ts` を切り出し、`updater.enqueueAbsoluteAddress` から `noteEnqueueForWatchChain()` を呼ぶ形にした（devtools/sink.ts と同じ循環回避パターン）。
  - **ワイルドカードの発火は Phase A の実装で既に動く**（照合がパス一致、`cur` は `$resolve`）。カバレッジを埋める必要もあり、基本ケース（行ごと発火・indexes・昇順）のテストは Phase A に含めた。Phase B は多段・`$listKeys` 併用・bind-component 越境の詰めに絞る。
  - **manifest の予約名は Phase D を待たずに追加が必要**。`manifest.test.ts` が「define.ts の `$` 定数を過不足なく網羅する」ことをゲートしており、`STATE_WATCH_NAME` を足した時点で赤くなる。D-1 のうち manifest だけ Phase A で消化した（vscode-wcs 側は Phase D のまま）。
- **ブランチ**: `feature/state-watch-hook`（設計書・本書と同居。実装コミットもここに積む）。
- **参照実装**: `packages/state/src/stream/*` と `docs/state-streams-impl-plan.md`。宣言マップ・registry・drain リスナー・後始末・ゼロコスト契約はすべて `$streams` に先例があり、**構造をそのまま踏襲する**（差分は §0-2 に列挙）。
- **作業ディレクトリ**: `packages/state/`。Phase D でのみ `packages/vscode-wcs/` に触れる。

---

## 0. 全体方針

### 0-1. 進め方

- **Phase A → B → C → D の順に、Phase 単位でコミット**する。各 Phase の DoD は共通:
  1. `npm test` green（既存テスト含む）
  2. `npm run test:coverage` の閾値維持（100/97/100/100。`src/watch/*` は 100/100/100/100 を目標）
  3. `npm run lint` pass
- テストは各モジュールと**同時に**書く。ファイル命名は `stream.*.test.ts` に倣い `watch.*.test.ts`。記述は日本語。
- 受け入れ条件は §5 のマトリクス（P1–P16 / S1–S12）を正とし、各タスクに ID を付す。
- 公開 API の追加はない（`$watch` は宣言マップのみ）。`exports.ts` / rollup 設定は変更不要。

### 0-2. `$streams` との構造差分（ここだけが新規）

| 項目 | `$streams` | `$watch` |
|---|---|---|
| 宣言キー | フラット名のみ（`.` `*` 禁止） | **パス**（`.` `*` を許可）。検証も解析も別物（§1-3） |
| 依存グラフ | `args` の評価で per-run 捕捉 | **宣言時に静的登録が必須**（設計書 §8）。ここが最大の新規実装 |
| drain リスナー | 依存アドレス（小）を回して `batch.has()` | **バッチ側を回して**逆引き（ワイルドカードは絶対アドレスが行ごとに違う） |
| 旧値 | 不要 | **バッチ内 first-write-wins の台帳**が必要（§2-4） |
| ユーザーコードの実行 | `args` / `fold` / `source` | **ハンドラ本体**。再入と例外の隔離が要る（§4） |

---

## Phase A — 背骨（完全一致パス・スカラ限定）

ゴール: `$watch: { isLoading(cur, prev) {...} }` が、**binding が 1 つも無い状態で**書き込みに反応して呼ばれる。ワイルドカード・computed は Phase B/C。

### A-0. 定数 — `src/define.ts`

- `STATE_WATCH_NAME = "$watch"`
- `MAX_WATCH_CHAIN_DEPTH = 32`（`MAX_PROPAGATION_HOPS` と同値だが**定数は共有しない** — 別の打ち切り機構なので独立に動かせるようにする）
- テスト不要。

### A-1. 型 — `src/watch/types.ts`

```ts
export type WatchHandler = (cur: unknown, prev: unknown, ...indexes: number[]) => void;

export interface IWatchEntry {
  readonly path: string;
  readonly pathInfo: IPathInfo;      // getPathInfo の結果（wildcardCount を持つ）
  readonly handler: WatchHandler;
  readonly order: number;            // $watch の宣言順（設計書 §3-2 層 2 のソートキー）
}
```

### A-2. registry — `src/watch/watchRegistry.ts`

`streamRegistry.ts` / `activeStateElements.ts` と対称:

- `WeakMap<IStateElement, Map<string, IWatchEntry>>`
- `setWatchEntries` / `getWatchEntries`（無ければ空 Map）/ `clearWatchRegistry`
- 発火対象の走査元となる `activeWatchStateElements: Set<IStateElement>`（add は接続時、delete は `disconnectedCallback` / `clearWatchRegistry`）。**リーク防止の不変条件は `stream/activeStateElements.ts` の解説と同じ**ので、同じ注意書きを置く
- `__private__` で registry を露出（既存慣行）
- テスト: `watch.watchRegistry.test.ts` — 4〜6 本

### A-3. 宣言パース＋依存グラフ登録 — `src/watch/processWatchDeclaration.ts`

シグネチャ: `processWatchDeclaration(stateElement, state): void`。`processStreamsDeclaration` の検証スタイルを踏襲する。

**検証**（違反は `raiseError`、設計書 §2-2）:

- `$watch` が非オブジェクト / 値が非関数
- キーが空文字 / `$` 始まり / `Object.prototype` の継承名
- キーに `@` を含む（**越境 watch は不採用**、D8）
- `getPathInfo(path)` が解析できない / `wildcardCount > MAX_WILDCARD_DEPTH`

**依存グラフ登録**（設計書 §8 — これが無いと headless が成立しない）:

- 各 watch パスについて `stateElement.setPathInfo(path, <非 for の bindingType>)` 相当を呼び、親 → 子の `addStaticDependency` チェーンを生やす
- `bindingType` は `"prop"` を渡す（`setPathInfo` は `"for"` のときだけ `listPaths` / `elementPaths` を触る — `components/State.ts:686-696`。`"prop"` なら親子チェーン生成だけが走る）
- **`setPathInfo` を再利用するか、watch 用に薄いラッパを置くかはここで決める**: 再利用が正。`BindingSession` 以外からの呼び出しは初になるので、State 側の JSDoc に「binding 以外に `$watch` 宣言からも呼ばれる」と明記する

テスト: `watch.processWatchDeclaration.test.ts` — 全違反ケース（**S1**）＋ 正常系（登録・**依存チェーンが生えること = P1**）で 10〜12 本。依存チェーンの確認は `stateElement.staticDependency` を直接見る。

### A-4. 旧値台帳 — `src/watch/prevValues.ts` ＋ `setByAddress` フック

台帳: `Map<IAbsoluteStateAddress, unknown>`（モジュールスコープ、drain 後にクリア）。

- `recordPrevValue(absAddress, oldValue)`: **`has` が false のときだけ** set（first-write-wins、設計書 §4-1）
- `takePrevValue(absAddress)`: 読み出し（無ければ `undefined`）
- `clearPrevValues()`: drain 終端で呼ぶ

**フック位置** — `src/proxy/methods/setByAddressCore` の 2 箇所（fast path :296-346 / 通常経路 :349-395）。どちらも同じ形:

```
absAddress を生成した直後（devtoolsSink の分岐の隣）:
  if (stateElement.watchPaths !== null && devHasOldValue) {
    if (stateElement.watchPaths.has(path)) recordPrevValue(absAddress, devOldValue);
  }
```

要点:

- **`devOldValue` を再利用する**（same-value guard が既に読んでいる）。watch のために追加の `getByAddress` はしない
- したがって **prev が取れるのは「guard が旧値を読んだとき」＝ primitive かつ `config.sameValueGuard` ON のときだけ**。参照型は `undefined`（設計書 §4-1 のとおり）
- `config.sameValueGuard = false` のときも prev は `undefined` になる。**これは設計書 §4-2 の表に 1 行追記して規範化する**（本計画で判明した帰結）
- 判定は `watchPaths`（`Set<string>`）の `has` 1 回。未宣言時は `watchPaths === null` の分岐 1 個で抜ける（ゼロコスト契約）

テスト: `watch.prevValues.test.ts` — first-write-wins（**P2**）・クリア・未宣言時に記録しない（**S2**）で 5〜7 本。

### A-5. runtime — `src/watch/watchRuntime.ts`

`registerUpdateBatchListener` にモジュール初期化時に 1 つ登録する（`streamRuntime.ts:236` と同型）。

**先に `updater.ts` に優先度を足す**（設計書 §3-2 層 1）:

- `registerUpdateBatchListener(listener, priority = 0)` に第 2 引数を追加。内部の `Set` を優先度付きの配列に変え、`notifyUpdateBatchListeners` は昇順に呼ぶ。同値は登録順（安定ソート）
- 定数は `define.ts` に `WATCH_LISTENER_PRIORITY = 10` / `STREAM_LISTENER_PRIORITY = 20` を置き、`streamRuntime.ts` の登録も明示的に書き換える
- `unregisterUpdateBatchListener` は配列からの除去に変える（テスト間の分離用途は不変）
- 既存の updater テストが `Set` を前提にしていないか確認する

```
function fireWatchOnUpdateBatch(batch) {
  if (activeWatchStateElements.size === 0) return;   // ゼロコスト early return
  const depth = consumePendingChainDepth();
  if (depth > MAX_WATCH_CHAIN_DEPTH) { console.error(...); clearPrevValues(); return; }
  // 収集フェーズ: バッチを 1 周し、発火対象を配列に貯める
  for (const absAddress of batch) {
    const stateElement = absAddress.absolutePathInfo.stateElement;   // ← 同名 state でも一意
    if (!activeWatchStateElements.has(stateElement)) continue;
    const entry = getWatchEntries(stateElement).get(absAddress.absolutePathInfo.pathInfo.path);
    if (entry === undefined) continue;
    hits.push({ stateElement, entry, absAddress });
  }
  // 発火フェーズ: entry ごとに try/catch（§4-1）
  ...
  clearPrevValues();
}
```

**`absolutePathInfo.stateElement` で発火先を引ける**のが効く（`address/AbsolutePathInfo.ts:23,28`）。絶対アドレスは stateElement 単位の WeakMap でキャッシュされるので、同名 state が複数の rootNode に居ても取り違えない。`stateName` 文字列で照合してはいけない。

発火は `stateElement.createState("writable", state => entry.handler.call(state, cur, prev))`（D8）。`cur` は `state[path]`（Phase A は完全一致パスなので素直に読める）。

**収集と発火を 2 相に分ける理由**は 2 つある:

1. ハンドラ内の書き込みが registry / active 集合を同期的に変えうる（`_state` 再 set・切断）。`restartStreamsOnUpdateBatch` が hits 実行時に live 再チェックしているのと同じ問題なので、**同じ再チェック（active か / entry が現行 registry のものか）を発火直前に行う**
2. **順序規約（設計書 §3-2 層 2・層 3）のために hits をソートする必要がある**。バッチの反復順は enqueue 順なので、収集してから並べ替える

**ソートキー**: `(entry.order, indexes 辞書順)`。`entry.order` は宣言時に振る連番（`Object.keys` の順＝ `$watch` の宣言順）。indexes 比較は段ごとに数値比較し、先に差が出た段で決める。ソートは hits にのみ及ぶので、watch 未宣言時のコストはゼロ。

テスト: `watch.watchRuntime.test.ts` — **P3**（binding ゼロで発火＝ headless の中核）・**P4**（cur/prev）・**P5**（1 バッチ 1 回に coalesce）・**S3**（同値は発火しない）・**S4**（occurrence は同値でも発火）・**S5**（`$postUpdate` で prev=undefined）・**S6**（越境アドレスは発火しない）で 10〜12 本。drain は `testApplyChange` か `await Promise.resolve()` で決定的に駆動する。

### A-6. 例外隔離と再入ガード — 同ファイル

- **例外**（設計書 §7-1）: ハンドラごとに try/catch → `console.error` ＋ devtools sink（`devtoolsSink !== null` の分岐内でイベント生成）→ 次の hit へ進む。drain リスナーの throw は握りつぶさない契約（`updater.ts:38-42`）なので、watch 側で閉じる
- **再入**（設計書 §7-2）: モジュールスコープに
  - `pendingChainDepth`（次バッチの深さ）／ハンドラ実行中フラグ
  - ハンドラ実行中は「次に作られるバッチの深さ = 現在の深さ + 1」を立てる
  - drain 冒頭で消費し、`MAX_WATCH_CHAIN_DEPTH` 超過なら**その drain の watch 発火だけ**を打ち切り、パス名を `console.error` で報告（値と binding 適用は巻き戻さない）
  - watch と無関係な書き込みが同じバッチに混ざると深さが伝染して保守的に大きくなる。**これは許容**（打ち切りは 32、実害は watch 発火の停止のみ）— この保守性を計画・設計書の両方に明記する

テスト: **S7**（1 ハンドラの throw が他 watch と streams restart を巻き添えにしない）・**S8**（相互 watch が 32 で打ち切られ `console.error` が出る）で 4〜6 本。

### A-7. State ライフサイクル接続 — `src/components/State.ts` ／ `components/types.ts`

- `IStateElement` に `readonly watchPaths?: ReadonlySet<string> | null` を追加（`listKeys` の隣。optional なのはテスト用モック互換のため — 既存の注釈と同じ理由）
- `_state` セッター: `getStateInfo` 反映の**後**（＝ `getterPaths` 確定後、`processStreamsDeclaration` の隣）に `clearWatchRegistry(this)` → `processWatchDeclaration(this, value)`
- `connectedCallback`: `$connectedCallback` 完了後、**`startStreams` より前**に active 集合へ add（stream の初期化書き込みを watch が観測できるようにする）。ただし **SSR では走らせない**（`inSsr()` 判定。設計書 §11）
- `disconnectedCallback`: `abortAllStreams` の並びに `clearWatchRegistry(this)`

テスト: `watch.lifecycle.test.ts`（`<wcs-state>` を happy-dom で実際に connect する統合テスト。既存の `waitForStateInitialize` に従う）— **P6**（宣言 → connect → 書き込み → 発火）・**S9**（`_state` 再 set で旧宣言が発火しない）・**S10**（切断後は発火しない）で 6〜8 本。

**Phase A コミット**: `feat(state): add $watch declaration and headless update subscription (phase A)`

---

## Phase B — ワイルドカード（完了）

ゴール: `"items.*.price"(cur, prev, index)` が行ごとに発火し、indexes が bind-component 越境でも壊れない。

**結果: 実装変更ゼロ。** 照合がパス一致・`cur` は `$resolve`・indexes は `getScopedIndexes` と、すべて Phase A で既存機構に乗っていたため、Phase B はテストによる契約の確定だけになった（`watch.wildcard.test.ts` 6 本 ＋ `watch.bindComponent.test.ts` 3 本）。判明した事実 2 つ:

- **`$listKeys` 未宣言時の行 watch は「変化した行だけ」ではなく全行**発火し、`prev` は常に `undefined`（どの行も `setByAddress` を通っていない）。設計書 §6-2 の表を実測値に修正した。行の差分を見たいなら `$listKeys` の宣言が事実上の前提になる。
- **mapped な bind-component の子スコープでは `$watch` を宣言できない**（設計書 §9-1）。innerState proxy の get/has トラップが `$` 始まりを遮るため、宣言が `_state` セッターに届かない。`$streams` を含む全ての `$` 宣言マップに共通の既存仕様。plain 形なら宣言でき、親の `for` の中（Δ>0）でも indexes は自スコープ分だけになる。

### B-1. 逆引きと indexes 展開

- A-5 の照合は既に `pathInfo.path` 一致なので、`items.*.price` 形式のパスはそのまま引ける（**追加実装は不要**）。Phase B の実体は cur の読み出しと indexes 展開
- `indexes = getScopedIndexes(absAddress.listIndex, entry.pathInfo.wildcardCount)`（`list/wildcardLevel.ts:50-57`）
- `cur` はワイルドカードを含むパスなので `state[path]` では読めない。**`$resolve(path, indexes)` 相当**（`proxy/apis/resolve.ts`）で読む。`getScopedIndexes` が返す列がそのまま `$resolve` の引数として使える（同ファイルの解説どおり往復する）
- 発火順序は enqueue 順（**行の昇順は保証しない**）とテストにも明記する

テスト: `watch.wildcard.test.ts` — **P7**（行ごとに 1 回・indexes）・**P8**（多段ワイルドカード）・**S11**（`$listKeys` 併用で変化行だけ発火し prev がスカラで取れる／未宣言なら配列 1 write）で 8〜10 本。§6-2 の表がそのままテストケース表になる。

### B-2. bind-component 越境

- 子スコープ（Δ>0）で indexes が自スコープ分だけになることを確認する。既存の `getScopedIndexes` に乗るだけなので**実装は不要**、回帰テストのみ
- テスト: **P9** — 2〜3 本。既存の bind-component 統合テストの構成を流用

**Phase B コミット**: `feat(state): support wildcard paths in $watch (phase B)`

---

## Phase C — computed（getter）の eager 化（完了）

ゴール: getter を watch すると eager になる。設計書 §5 の 3 つの副作用を明示的にテストで固定する。

**着地時の判明事項**:

- 実測で確認: **バインドされていない getter は Phase A のままでは一度も発火しない**（依存が評価時にしか張られないため）。C-3 の初回評価がこの機能の成否そのもの。
- **ワイルドカードを含む getter は eager 化しない**と決めた（設計書 §5-3）。初回評価に行ごとの indexes が要り、全行評価は宣言しただけでリスト全体を舐めることになる。この形は「バインドされていれば発火する」ままで、スカラ getter と非対称になる。
- **`_state` 再 set は getter キャッシュを無効化しない**（設計書 §5-4）。同じ getter パスを再 set 前後で watch し続けると、初回評価が再 set 前のキャッシュ値を読む。watch とは独立した既存の挙動なのでスコープ外とし、watch 側は「台帳を宣言と寿命を共にさせる」責務だけを果たす。
- **発見して修正した欠陥**: ワイルドカードパスなのに listIndex を持たない絶対アドレスがバッチに載ると、`indexes` が空のまま発火して `cur` の解決（`$resolve`）が「indexes 不足」で throw していた。例外隔離が握るため症状は `console.error` だけで、テストは「発火しない」で緑になる ── 隠れる形の失敗だった。収集段階で落とすよう修正（設計書 §6-1）。

### C-1. スナップショット台帳 — `src/watch/computedSnapshots.ts`

- `WeakMap<IStateElement, Map<IAbsoluteStateAddress, unknown>>`（**stateElement 寿命**。バッチ跨ぎで prev を保持する点が A-4 の台帳と違う）
- `_state` 再 set / 切断で prune（`pruneLastNotified` と同型）

### C-2. 強制評価

- A-5 の発火フェーズで、entry が getter パス（`stateElement.getterPaths.has(path)`）なら:
  1. `cur` = 強制評価（readonly proxy で読む。dirty なら再計算される）
  2. `prev` = スナップショット台帳（初回 `undefined`）
  3. 評価後に台帳を更新
- **A-4 の旧値台帳は使わない**（getter は `setByAddress` を通らない）

### C-3. 依存の初回登録

- getter の依存（dynamicDependency）は**評価時に張られる**ので、一度も評価されていない getter はバッチに載らない。A-3 の静的登録に加え、**接続時に 1 回評価してスナップショットを埋める**（＝ここで dynamicDependency も張られる）
- この初回評価が「watch した getter は lazy でなくなる」の実体。README にそのまま書く

テスト: `watch.computed.test.ts` — **P10**（依存書き込みで発火）・**P11**（prev がバッチ跨ぎで保持される）・**P12**（画面に出していない getter でも発火＝ eager 化の確認）・**S12**（getter 内 throw が §4-1 の隔離に乗る）で 8〜10 本。

**Phase C コミット**: `feat(state): watch computed getters with opt-in eager evaluation (phase C)`

---

## Phase D — 追随先とドキュメント（完了）

**着地時の判明事項**:

- **vscode-wcs / lint の validator は `$watch` の追加で壊れない**。`stateAnalyzer` はトップレベルの `$` 始まりキーを一律で予約名として扱い、個別の `RESERVED_*_KEY` 定数を持つのは「宣言から新しいパスを導出する」もの（`$streams` の値実体化・`$listKeys`）だけ。`$watch` は既存パスを購読するだけなので導出が要らない。
- **preamble には型が要る**。`$listKeys` に `_WcsListKeys` を足したのと同じ理由で、ハンドラ引数が `noImplicitAny` 下で偽エラーになる。`_WcsWatch` を追加し `defineState` のシグネチャに載せた（`this` は既存の `ThisType<_WcsThis<T>>` で state 型になる）。
- **example の主張はテストで固定した**（`watch.example.test.ts`）。example は CDN 経由でしか実行されず壊れても気づかないため、同じ state 定義で「バインドしていない getter が発火する」「行 watch の cur/prev/index」「`$listKeys` 下の全行置換で変化行だけ発火」を検証している。なお happy-dom の innerHTML パースは table 内の `<template>` を保持しないため、テスト側だけ `<ul>` に置き換えてある（example 本体は cart example と同じ table 形）。

設計書 §11 の消化。**ここを落とすと壊れるのが「次の build 時」になる**（CI マトリクス外）ので、Phase D 自体を DoD に含める。

### D-1. manifest とツールチェーン

- `src/manifest.ts` の `reservedStateApi` に `STATE_WATCH_NAME` を追加（:110-121）
- **manifest golden テストの更新**
- `packages/vscode-wcs`: validator（stateAnalyzer / preamble）と `packages/lint` の予約キー。**state のビルド済み dist を消費する**ため、state を `npm run build` してから確認する（[[state-reserved-key-lint-followup]] の前例）

### D-2. ドキュメント

- `packages/state/README.md` / `README.ja.md`: `$watch` の節を新設（`$streams` の節の隣）。**スカラ限定の prev**・**eager 化**・**headless**・**越境不可**の 4 点を明記
- `packages/state/docs/streams.md`（:144）と README 内の **「現行 API に state-only な `$watch` / `$effects` はない」を書き換える**（`$watch` は入った／`$effects` は非スコープ）
- `docs/state-watch-hook-design.md` に、実装中に判明した事実を追記（A-4 の「guard OFF では prev が取れない」など）
- SPEC / `wcstack/wcstack-skill`（別リポジトリ）の references

### D-3. example（本 PR に含める）

- `packages/state/examples/` に置く。題材は **`$streams` の完了を `$watch` で拾う**最小例 — 両機能の関係と「binding に出していない値でも観測できる」という `$watch` の存在理由が 1 画面で分かる
- 既存 example の作法に従う（CDN 一発の `https://esm.run/@wcstack/state/auto`、サーバー不要なら静的 HTML 1 枚）

**Phase D コミット**: `docs(state): document $watch and update reserved-key consumers (phase D)`

---

## 5. 受け入れ条件マトリクス

| ID | 条件 | Phase |
|---|---|---|
| P1 | `$watch` 宣言でパスが依存グラフに登録される | A-3 |
| P2 | 旧値台帳がバッチ内 first-write-wins で記録する | A-4 |
| P3 | **binding が 1 つも無いパスの変更で発火する（headless の中核）** | A-5 |
| P4 | `cur` / `prev` が正しい（スカラ） | A-5 |
| P5 | 同一バッチの複数書き込みは 1 回に畳まれる（`cur` は確定値・`prev` はバッチ開始値） | A-5 |
| P6 | connect → 書き込み → 発火のライフサイクルが通る | A-7 |
| P7 | ワイルドカードが行ごとに発火し `indexes` が渡る | B-1 |
| P8 | 多段ワイルドカードで `indexes` の段数が合う | B-1 |
| P9 | bind-component の子スコープで `indexes` が自スコープ分だけになる | B-2 |
| P10 | watch した getter が依存書き込みで発火する | C-2 |
| P11 | getter の `prev` がバッチ跨ぎで保持される | C-2 |
| P12 | 画面に出していない getter でも発火する（eager 化） | C-3 |
| P13 | 順序層 1: `$updatedCallback` → `$watch` → stream restart（優先度で担保） | A-5 |
| P14 | 順序層 2: 複数の watch ハンドラが `$watch` の宣言順に呼ばれる | A-5 |
| P15 | 順序層 3: 同一パスの複数行が indexes 昇順に呼ばれる | B-1 |
| P16 | `$watch` 未宣言時、drain に追加コストが乗らない | A-5 |
| S1 | 宣言バリデーションの全違反ケース（`@` 越境含む） | A-3 |
| S2 | 未宣言パスへの書き込みで旧値を記録しない | A-4 |
| S3 | 同値の primitive 書き込みでは発火しない（guard 経由） | A-5 |
| S4 | occurrence（`semantics: "event"`）は同値でも発火する | A-5 |
| S5 | `$postUpdate` 経由は `prev === undefined` で発火する | A-5 |
| S6 | 他 state のアドレスでは発火しない（越境不可） | A-5 |
| S7 | ハンドラの throw が他 watch と stream restart を巻き添えにしない | A-6 |
| S8 | 相互 watch が `MAX_WATCH_CHAIN_DEPTH` で打ち切られる | A-6 |
| S9 | `_state` 再 set で旧宣言のハンドラが発火しない | A-7 |
| S10 | 切断後は発火しない | A-7 |
| S11 | `$listKeys` の有無で粒度と `prev` の質が設計書 §6-2 の表どおりに変わる | B-1 |
| S12 | getter 内の throw が例外隔離に乗る | C-2 |

---

## 6. 着手前の判断（すべて確定済み・2026-08-19）

1. **`setPathInfo` を再利用する**（A-3）。`"prop"` 渡しなら親子チェーン生成だけが走る。実装時に副作用が無いことをコードで再確認し、State 側の JSDoc に「binding 以外に `$watch` 宣言からも呼ばれる」と明記する
2. **リスナー順序は優先度で担保する**（A-5）。`registerUpdateBatchListener(listener, priority)` に priority を追加。import 順に順序が乗っていると無関係な import 整理で静かに壊れるため。順序規約は設計書 §3-2 / §3-3 の 3 層に確定
3. **`config.sameValueGuard = false` のときの `prev` は `undefined`**（A-4）。追加の `getByAddress` は払わない。設計書 §4-1 に追記済み
4. **example は本 PR に含める**（Phase D-3）
