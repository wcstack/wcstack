# State 次期メジャー 配線分離の設計案（草案）

**English**: [state-next-major-wiring-design.md](./state-next-major-wiring-design.md)

起草日: 2026-09-20。状態: **草案。決定ではない。** S1・S2 は同日に実装した（§8-1、未コミット）。 [要件](./state-next-major-requirements.ja.md)の D1 (b)「core / DOM アダプタの段階置換」、G2「機能の結合を切る」、B13「分割エントリと明示的・冪等な登録」、N2「副作用のないヘルパー入口」、A2「base＋DOM で gzip 35 KB 以下」に対応する。根拠は[要素技術調査](./state-next-major-tech-survey.ja.md)の T1（静的結合）・T7（スタブ化ビルドの残量とメンバー帰属）。

この文書は「core が機能を静的に import しない構造」を、受け口（hook）と機能側の登録に分解して書く。文法・プロトコル（`data-wcs`・wc-bindable・command-token・event-token・transition-runner）は変えない。

## 1. 現状（計測済み）

- core → 機能の値 import は 49 本（調査 §3.3）。`webComponent` 16・`devtools` 12・`recursion` 8・`components/Ssr` 5・`stream` 3・`watch` 2・`dcc` 2・`scan` 1。うち 15 本は `proxy/methods/getByAddress`・`setByAddress`・`proxy/traps/get` の 3 ファイルに集まる。
- モジュール評価時に登録処理を走らせるのは `watch/watchRuntime.ts:410`・`stream/streamRuntime.ts:241`・`webComponent/volume.ts:415` の 3 箇所（調査 §3.2）。これが「`defineState` を import しただけで約 27 KB gzip が残る」正体。
- `State.ts`（18.8 KB minify）の 54% は volume / mount / DCC / stream / watch / scan / stateLoader を参照するメンバー、`setByAddress.ts` の 55% は dcc / devtools / webComponent / watch に触れる関数（調査 §9.2）。`BindingSession.ts` は機能群を参照しない。
- 機能をすべて切っても core は gzip 44 KB（minify 147.6 KB）。A2 の 35 KB には minify で約 30 KB の削減が要り、本設計の配線切り出しで取れるのは 10〜13 KB（調査 §9.2）。

## 2. 設計原理

1. **core は機能を知らない。** core が持つのは受け口だけで、受け口が空のときの hot path は「配列長 0 の判定 1 回」（現行の `hasMounts === true` / `hasRecursion === true` と同じ D18 方式）。
2. **登録は明示的で冪等。** 機能モジュールは `install(registry)` を export し、評価時には何もしない。full / auto エントリが全 `install` を呼ぶので、既存の利用者には見えない。分割エントリの利用者は必要な機能だけを `install` する。同じ機能を 2 回 `install` しても 1 回と同じ。
3. **未登録は黙って無視しない。** 宣言（`$watch` / `$scan` / `$streams` / `**` / `mount=` / DCC）が機能を要求しているのに `install` されていなければ、初期化で明示エラー（要件 §10 の readiness barrier）。
4. **順序契約は core が持つ。** drain 内の順序（render hook → scan → watch → streams restart）は listener の優先度定数として core が定義し、機能側はその定数で登録する。
5. **単一 core チャンク。** 分割エントリは core を再同梱せず、1 つの core チャンクを共有する（要件 B13）。別 URL の二重ロードは検出して警告する。

## 3. 受け口の一覧

| # | 受け口 | 置き換える辺・メンバー | 呼び出し時機 | 未登録時 |
|---|---|---|---|---|
| H1 | **読み書き境界 hook**: `registerAddressHook({ read, write, get })` | `getByAddress` → volumeShared / mount / overlay / exportIndex / argsTrace / streamNamespace、`setByAddress` → volumeShared / exportIndex / overlay / dispatchBindableEvent、`traps/get` → mount / streamNamespace / recursion の expand・bind（計 27 本） | `getByAddress` / `setByAddress` / get トラップの先頭で、登録済み hook を順に呼び、`NOT_HANDLED` 以外を返した hook で確定 | 配列長 0 の判定 1 回で素通し |
| H2 | **drain 完了 listener**: 既存の `registerUpdateBatchListener(listener, priority)` | `watchRuntime.ts:410`・`streamRuntime.ts:241`・`updater` → scan の eventReset / watch の chainDepth | 現行どおり drain 終了時。**呼び出しを評価時から `install()` へ移す** | listener なし |
| H3 | **ライフサイクル hook**: `registerLifecycle({ onDeclarations, onConnected, onDisconnected, onStateReplaced, onInitializeFailed })` | `State.connectedCallback`（stream / watch の起動）、`disconnectedCallback`（停止）、`_initializeBindWebComponent`・`_initializeVolume`・`_acquireVolumeSlot`・`_releaseVolumeSlot`・`mergeVolumeListKeys`・`addVolumeWatchPaths`・`_failInitializeLoudly`・`reportVolumeWithoutRoot`・`_initializeDCC`・`_loadStateFromSource`（計約 10 KB minify） | `State` の各ライフサイクルで、登録済み hook を登録順に呼ぶ | hook なし。`mount=` / DCC / `src=` 属性があれば H5 のエラー |
| H4 | **宣言 hook**: `registerDeclaration(key, handler)` | `_state` setter（`$watch` `$scan` `$streams` `$commandTokens` `$eventTokens` `**` の解釈、1.2 KB） | state オブジェクトの予約キーを走査し、キーごとに handler へ渡す | 予約キーに handler が無ければ明示エラー（H5） |
| H5 | **readiness barrier** | （新規） | H3 / H4 で、要求された機能が未登録なら `[wcs/feature-not-installed] "$streams" needs @wcstack/state/features/temporal` の形で throw | — |
| H6 | **devtools sink** | core 12 箇所からの `devtools/sink` import | core が `let devtoolsSink = null` と `setDevtoolsSink()` を持ち、devtools モジュールが core を import して設定する（依存方向の反転） | `null` 判定 1 回 |
| H7 | **volume graft handler** | `volume.ts:415` の `setVolumeGraftHandler(graftIsolated)` | 既存の登録 API。**呼び出しを評価時から `install()` へ移す** | handler なし |
| H8 | **SSR / hydrate hook** | `exports` / `hydrateBindings` / `buildSsrDocument` / `registerComponents` → `Ssr.ts`、apply / bindings の循環に入っている `Ssr` | core は `ssrMode` と hydration の受け口だけを持ち、`Ssr` モジュールが登録する | 受け口なし |

H1 の返り値契約: `read(stateElement, address, receiver) → { handled: true, value } | NOT_HANDLED`、`write(stateElement, address, value, receiver) → { handled: true, result } | NOT_HANDLED`。複数 hook の順序は登録順で、最初に `handled` を返した hook が勝つ。現行の分岐（`hasGraftedVolumes` → `hasMounts` → `hasRecursion` → 通常）と同じ優先順位で `install` する。

**hook の置き場（調査 §10.8 で確定）**: 受け口だけなら費用ゼロだが、install 済みの hook を大域配列に載せて毎回走査すると、その state で使っていなくても読み +17 ns（+40%）・書き +15 ns、選択変更 1 万行で 3〜4% になり §7-4 の 1% を超える。hook は **宣言時に state 要素ごとへ付ける**（`_state` setter で予約キー・`mount=`・`**` を見て、その state が要求する機能の hook だけを並べる）。機能の無い state は現行の D18 と同じ boolean 判定 1 回で抜け（実測 +0.1 ns）、`install` はレジストリに hook を置くだけで hot path には触れない。

## 4. エントリ（案）

| エントリ | 内容 | 互換 |
|---|---|---|
| `@wcstack/state` | core ＋ 全機能を `install` 済み。公開 API は現行と同じ | 変更なし |
| `@wcstack/state/auto` | 同上＋bootstrap。自己完結・SRI 契約（[sri](./sri.ja.md)）は現行どおり | 変更なし |
| `@wcstack/state/core` | core（proxy・address・dependency・updater・bindings・apply・structural・event・list・bindTextParser・`State` の骨格）。機能なし | 新規 |
| `@wcstack/state/features/temporal` | watch / scan / streams の `install` | 新規 |
| `@wcstack/state/features/scopes` | volume / mount / overlay / DCC の `install` | 新規 |
| `@wcstack/state/features/recursion` | `**` の `install` | 新規 |
| `@wcstack/state/features/ssr` | `Ssr` / hydrate の `install` | 新規 |
| `@wcstack/state/features/devtools` | sink の設定 | 新規 |
| `@wcstack/state/features/formats` | 書式フィルタ群の登録（実装済み、§8-13。実関数の解決は束縛計画の段） | 新規 |
| `@wcstack/state/define` | `defineState` と型のみ。値 import 0（調査 §3.1） | 新規（N2） |

使い方（分割）:

```js
import { bootstrapState, installFeatures } from "@wcstack/state/core";
import temporal from "@wcstack/state/features/temporal";
import scopes from "@wcstack/state/features/scopes";
installFeatures([temporal, scopes]);   // 冪等
await bootstrapState();
```

buildless の利用者は import map で `@wcstack/state/core` と `features/*` を CDN の同一版に固定する。Rollup 側は multi-entry ＋ `manualChunks` で core を 1 チャンクにし、`features/*` はそのチャンクを import する（core の再同梱を CI で禁止: 各 `features/*` の出力に `proxy/` のコードが含まれないことをソースマップ帰属で検査）。

## 5. サイズ見積もり（調査 T7 に基づく）

| 段階 | core の minify 見込み | 根拠 |
|---|---:|---|
| 現状（機能スタブ化の上限） | 147.6 KB（gzip 44.0 KB） | 調査 §9 |
| H1〜H8 で配線を機能側へ | 135〜138 KB（gzip 約 40〜41 KB） | `State.ts` の配線 10 KB・`setByAddress` 等の分岐 1〜3 KB（§9.2） |
| ＋ 診断文言を dev ビルドへ | 130〜133 KB | `pathDiagnostics` 3.6 KB・`reportVolumeWithoutRoot` 0.7 KB・`warnDefaultGetterMismatch` 0.7 KB |
| ＋ wc-bindable 契約解析を adapter へ | 123〜126 KB | `contractAnalyzer`・`wcBindableReader`・`expandSpread`・`protocol` 約 7 KB |
| ＋ `BindingSession` 二重経路の一本化 | 120〜124 KB（gzip 約 36〜37 KB） | プラン経路 2.0 KB 対 汎用経路 4.9 KB |

A2 の 35 KB（minify 約 117 KB）は、この 4 段をすべて積んで届くかどうかの水準。本設計（H1〜H8）単独では届かない。**実測での訂正（2026-09-21）**: 2 段目（配線の切り出し）は core を縮めず（§8-11）、4 段目（`BindingSession` の一本化）は R2・R3 の後で前提が崩れた（[行ランタイム設計](./state-next-major-runtime-design.ja.md) §6-1）。3 段目の契約解析は既に core に入っていない。行 record を畳む設計（調査 §10.2）はサイズより時間・メモリに効く。

## 6. 互換性と契約

- **表は不変**: HTML 文法・宣言キー・`$` API・プロトコル。`@wcstack/state` と `/auto` の公開面も不変。
- **順序契約の明文化**: drain 内 listener の優先度（render → scan → watch → streams restart）と例外隔離を core の契約として README に書く（要件 §10）。
- **readiness**: 分割エントリで機能未登録のまま宣言を使うと初期化で throw。`auto` では起きない。
- **二重インスタンス**: core チャンクは `Symbol.for("wcstack.state.core")` で 1 つのレジストリを共有し、別 URL の 2 本目は警告する。
- **SRI**: full / auto の単一ファイル契約は維持。分割形は import map の `integrity`（3 エンジン対応。調査 §7）で各チャンクを覆う。

## 7. 検証

1. **静的**: 調査の [audit-state-tech-coupling.mjs](../scripts/audit-state-tech-coupling.mjs) を CI に載せ、`core` エントリから `watch` / `scan` / `stream` / `recursion` / `webComponent` / `dcc` / `devtools` / `components/Ssr` への値の辺が 0 本であること、評価時の登録処理が 0 箇所であることを固定する。
2. **サイズ**: N3 のサイズ CI に `core` と `full` の gzip を閾値付きで追加。
3. **挙動**: 既存 3,650 テストは `full` エントリで全緑を維持。`core` のみで宣言を使ったときの明示エラーと、`install` の冪等性のテストを追加。
4. **性能**: 監査ベンチと調査の計数器（T6）で、hook 判定の追加が hot path（get トラップ・`getByAddress`・`setByAddress`）に与える差を測る。配列長 0 の判定 1 回なので、選択変更 1 万行（get トラップ 30,003 回）で 1% 未満が目標。

## 8. 段階

| 段階 | 内容 | 出荷 | 挙動変化 |
|---|---|---|---|
| S1 | H6 devtools sink の依存反転（12 辺） | 2.6.x（実装済み、§8-1） | なし |
| S2 | H2 / H7 の登録呼び出しを評価時から `install()` へ。full / auto が呼ぶ | 2.6.x（実装済み、§8-1） | なし（順序契約を文書化） |
| S3 | H1 読み書き境界 hook（27 辺） | 3.0（実装済み、§8-2） | なし（hot path に判定 1 回） |
| S4 | H3 / H4 ライフサイクル・宣言 hook、H5 readiness barrier | 3.0（実装済み、§8-3〜§8-8） | 分割エントリのみ（未登録は throw） |
| S5 | H8 SSR の分離、エントリ分割、単一 core チャンク、CI | 3.0（実装済み、§8-9〜§8-12） | 新エントリの追加のみ |

S1・S2 は非破壊で先行できる（要件 §4 の N1〜N3 と同じ列）。S3 以降は major の器に載せる。**S3〜S5 は 2026-09-21 に `packages/state` へ移植済み**（§8-12、未コミット）。残るのは `features/formats`（D16 のフィルタ登録簿が前提）。

### 8-1. S1・S2 の実装記録（2026-09-20、未コミット）

計測の詳細は調査 §10.5。

- **S1**: `devtools/sink.ts` → `platform/devtoolsSink.ts`（`git mv`）。`devtools/bridge.ts` が core 側を import する向きになり、core → `devtools` の辺は 12 → 1（`bootstrapState.ts → devtools/bridge.ts`。これは入口の辺で、3.0 では `features/devtools` に移る）。
- **S2**: `installWatchRuntime()` / `installStreamRuntime()` / `installVolumeGraft()`（いずれも冪等）を `bootstrapState()` が `registerComponents()` の前に呼ぶ。**設計との差**: 機能側の初回利用点（`startWatch` / `startStreams` / `graftOrQueueVolume` の queue 経路）でも同じ `install` を呼ぶ。`bootstrapState()` を経ずに要素を定義する経路（テストがそう）の保険で、H5 の readiness barrier が入れば外す。Vitest の `setupFiles` から `install` する案は、setup が実モジュール群を先に評価して各テストの `vi.mock` を無効にするため採れなかった（267 件失敗）。
- 結果: 3,650 テスト成功、カバレッジ閾値内。評価時に処理を走らせるモジュール 11 → 8、core → 機能の辺 49 → 41。`defineState` だけの再 export は tree-shake 後 26.7 KB → 1.9 KB gzip（要件 G2・N2 をこの段で満たす）。
- **§7-1 の CI**: `audit-state-tech-coupling.mjs --check` と基準 [state-coupling-baseline.json](../scripts/state-coupling-baseline.json) を `ci.yml` の state ジョブに載せた。基準は「評価時に処理を走らせてよいモジュール・core → 機能の辺 41 以下・`defineState.ts` の到達 1」で、§7-1 の「0 本」は S3〜S5 が進むたびに締める。
- **同日追記（PURE 注釈）**: 残っていた評価時の呼び出し初期化子 8 箇所（`updater` の単一インスタンス、event 登録簿 ×4、`createNotFilter()`、`createEmptySet()`、`new RegExp`）に `/*#__PURE__*/` を付け、評価時に処理を走らせるモジュールは `auto.ts` だけになった（基準も `["auto.ts"]` に締めた）。`defineState` だけの再 export は 309 bytes gzip（調査 §10.5 追記）。§7-1 の「評価時の登録処理 0 箇所」はこれで達成。

### 8-2. S3 の実装形（案、未着手）

調査 §10.8 の結果（大域配列の hook は 3〜4%、state ごとの門なら 0）を受けた S3 の具体形。実装は着手していない。決めるべき点が 2 つあり、いずれも設計者の判断が要る。

- **hook の置き場**: `State` 要素に `addressHooks: { read: ReadHook[]; write: WriteHook[]; get: GetHook[] } | null` を持たせ、`_state` setter が宣言（予約キー・`mount=` 属性・`**`・DCC）を見て、その state が要求する機能の hook だけをレジストリから並べる。hot path は `stateElement.addressHooks === null` の判定 1 回で抜ける（現行の `hasMounts === true` と同じ費用、実測 +0.1 ns）。`install()` はレジストリ（機能名 → hook 実装）に置くだけで hot path に触れない。
- **27 辺の移し方**: `getByAddress` / `setByAddress` / get トラップの分岐を、機能ごとの hook モジュール（`features/scopes/addressHooks.ts` = volume / mount / overlay / export、`features/temporal/addressHooks.ts` = stream の namespace と argsTrace、`features/recursion/addressHooks.ts` = materialize / bind）へ 1 対 1 で移す。分岐の**順序**は現行と同じ（volume → mount → recursion → 通常）で、レジストリの登録順で固定する。
- **未決**: (1) hook を宣言時に付ける API の形（`_state` setter で自動か、`installFeatures` の引数で明示か）。前者は宣言を見るだけで済むが、`mount=` 属性のように宣言の外にある要求（属性・DCC）を `connectedCallback` で拾い直す 2 段構えになる。(2) devtools（H6）と同じく「hook が無いとき」の診断（readiness barrier、H5）をどの時点で出すか。
- **検証**: 全テスト 3,650 件が full エントリで緑、調査 [audit-state-tech-hookcost.mjs](../scripts/audit-state-tech-hookcost.mjs) で読み +1 ns 以内、[audit-state-tech-coupling.mjs](../scripts/audit-state-tech-coupling.mjs) で core → 機能の辺 41 → 14（27 本が消える）。

**第 1 片の実装記録（2026-09-21、stream、サンドボックス）**: D12 / D13 の決定を受けて、[s3StreamSlicePatch.mjs](../scripts/research/s3StreamSlicePatch.mjs) で上の形を stream 機能に当てた。

- `core/addressHooks.ts`: 機能名 → hook 実装のレジストリ（`registerFeatureHooks`、install が呼ぶ）、state 要素ごとの hook 束（`IAttachedHooks`）、`requireFeature`（未 install なら宣言名で throw、D13）。
- `State`: `addressHooks` プロパティと `attachAddressHooks(feature, declaration)`。`_state` setter が `$streams` を見つけたら `installStreamRuntime()` の後に付ける（full エントリでは State が stream runtime を静的に import しているので、barrier が落ちるのは H3 切り出し後の分割エントリだけ）。hook は要素の寿命の間は付いたまま（再 set で `$streams` が消えても、残った `$streamStatus` / `$streamError` の束縛は名前空間の null を読む — 従来と同じ）。
- `stream/addressHooks.ts`: `getByAddress` の `collectStreamDependency` と `$streamStatus` / `$streamError` の名前空間分岐、get トラップの 2 case を read / get hook に移した。`installStreamRuntime()` がレジストリに置く。
- core の受け口: `getByAddress`（`checkDependency` と再帰の実体化の後）・`setByAddressCore` の先頭・get トラップの文字列プロパティ先頭で `stateElement.addressHooks` を見て、null なら判定 1 回で抜ける。
- 結果: 全テスト 3,668 件成功（`stream.argsTrace` のモック state 要素に hook を付けるテスト側の調整 1 箇所）。core → 機能の辺 41 → **38**（core → stream の hot path の 3 本が消え、残るのは `bootstrapState → streamRuntime` の入口辺だけ）。読みのマイクロベンチは base 43.6 / 第 1 片 45.6 ns（最小 43.4 / 42.2）で差は標本ばらつきの内側。
**第 2 片（recursion・dcc・watch、[s3FeatureSlicePatch.mjs](../scripts/research/s3FeatureSlicePatch.mjs)）と第 3 片（scopes ＝ マウント・ボリューム、[s3ScopesSlicePatch.mjs](../scripts/research/s3ScopesSlicePatch.mjs)）の実装記録（2026-09-21、同じサンドボックス）**: 残りの 24 本を同じ形で移し、core → 機能の辺は 38 → 27 → **14**（設計の目標どおり。残る 14 ＝ `bootstrapState` の入口辺 4・SSR 4・`registerComponents → State` 1・apply 側 3・`updater` の drain listener 2）。全テスト 3,668 件が両片とも成功。

- **受け口は 1 種では足りなかった**。「先頭で奪う」1 点では 27 本を 1 対 1 に移せず、core の呼び出し点は 12 種になった（`core/addressHooks.ts` の表）: `read`（getByAddress の先頭、キャッシュより前）・`readMissing`（ツリーにそのキーが無い点。親が無ければ null）・`write`（setByAddress の先頭）・`writeMissing`（fast path で親にキーが無い点。公開 getter への書き込み）・`writeObserve`（旧値が分かった点）・`written`（書き込み・`$postUpdate` の後）・`swapped`（要素の入れ替えで行が動いた点）・`get`（get トラップの文字列プロパティ先頭。`target` も渡す）・`indexShift`（`$n` の段ずれ）・`handlerScope`（ハンドラの添字の段数）・`updated`（`$updatedCallback` の後）・`suppressPathDiagnostic`（束縛時の診断抑止）。どれも hook の無い state は `addressHooks` の null 判定 1 個で抜ける。state ごとでない受け口は 2 つだけ（`list/loopContextByNode` のマウント済み ShadowRoot からホストへ抜ける resolver と、`stateElementByName` の登録 listener）で、どちらも境界で 1 回しか走らない。
- **付ける時点**（D12 の具体化）: `$recursion`・`$watch` / `$scan`（ボリュームの合流分も）・`$streams` は `_state` setter、`$bindables` は DCC の束ね先になった時点（`setBindableEventMap`）、マウントは記録の登録（`markHasMounts`）、ボリュームはスロットの予約・接ぎ木（`markHasVolume` / `markHasGraftedVolumes`）。ルートより先に予約されたボリュームは、ルートの登録 listener（`installVolumeGraft` が配線）が付ける。
- **hook は要素の寿命の間は付いたまま**なので、再セットで宣言が消えうる機能（recursion）は hook の先頭で `hasRecursion` を見て core と同じ経路へ戻す。`$trackDependency` の `**` 拒否は宣言の有無に関わらないので core に残した（`define` の定数で 1 行）。公開 getter への書き込み hook が throw しても代入値をキャッシュに固定しないよう、core は hook を呼ぶ前に印を立てる（E10 で固定）。
- **テスト側の調整は 4 箇所**（機能の振る舞いを期待するモック state 要素に hook を付ける: `stream.argsTrace`・`proxy.setByAddress` の DCC・`proxy.apis.updatedCallback` のボリューム・`integration.volumeMount` で台帳へ直接予約するテスト）。移した分岐のうち統合テストが通らなくなった 8 つ（readiness barrier の throw・冪等な install・再セット後の再帰 hook の素通し・scopes hook の該当しない state での素通し・`$postUpdate` 後の `written`）は境界テスト `core.addressHooks.test.ts` で固定した。カバレッジは 99.62 / 98.6 / 100 / 99.8（3,676 件、閾値内）で、repo の既存の欠けの他に残るのは scopes hook の 4 分岐（マウントの無い state での `$n` 補正・切断中の診断）だけ — 製品へ載せるときに境界テストへ足す。
- **読みのコスト**（[hook-cost-micro-s3slice2.json](research/state-next/hook-cost-micro-s3slice2.json)・[hook-cost-micro-s3slice3.json](research/state-next/hook-cost-micro-s3slice3.json)）: 第 2 片は base 42.5 / 41.3 ns（最小 41.8 / 40.3）、書き 44 / 41 ns — ばらつきの内側（機能の無い state は DCC の表引きと再帰の判定が書きから消えた分だけ軽い）。第 3 片（3 片全部）も base 43.1 / 41.5 ns（最小 41.8 / 40.3）、書き 44 / 41 ns で同じ。§7-4 の「読み +1% 以内」は満たす。
- **サイズ（新しい判断点、要件 D19）**: 3 片を載せた full の `auto.min.js` は 71.6 KB gzip で、同じ作業ツリー（N6・消去 patch 込み）の 70.3 KB より **+1.3 KB（+1.9%）**。リリース基準 68.7 KB の +3% の門（70.8 KB）を越える。受け口 12 種のループと機能側 4 モジュールの glue の分で、分割エントリでは core が痩せる側に働くが、full には純増になる。rollup の循環警告は従来と同じ 2 件（`stateElementByName` 経由）で増えていない。

### 8-3. S4 の第 1 片の実装記録（2026-09-21、ボリューム、サンドボックス）

H3（ライフサイクル hook）と H5（readiness barrier）を、まずボリューム（`mount=`）に当てた（[s4VolumeLifecyclePatch.mjs](../scripts/research/s4VolumeLifecyclePatch.mjs)、S3 の 3 片の上に重ねる）。

- **受け口は 4 種**（`core/lifecycleHooks.ts`）: `connecting`（接続を引き取る）・`reconnecting`（初期化済みの要素の再接続を引き取る）・`disconnecting`（切断を引き取る）・`replacingState`（state の差し替えを拒む）。聞く順は登録順ではなく `order` の昇順で、従来の分岐順（DCC 10 → ボリューム 20 → bind-component 30）を番号で固定する。
- **`connecting` は「引き取らない」を null で返す**。引き取るときだけ「その初期化の Promise」を返すので、引き取り手の無い素の state（大多数）に microtask の境界が 1 つも増えない。これは実装中に見つけた制約で、`Promise<boolean>` にすると全要素の接続に await が 1 つ入る。
- **要素の内部面は 5 つだけ**: `connectedRootNode` / `clearConnectedRootNode` / `markInitialized` / `settleInitialization` / `loadStateFromSource`。ボリュームの private フィールド 5 つは要素ごとの台帳（WeakMap）として機能側へ移り、`State` はボリュームという概念を持たなくなった。
- **readiness barrier**（H5 / D13）: 引き取り手の居ない `mount=` は「scopes 機能が未 install」として属性名で throw する。full / auto は `bootstrapState()` が install するので起きない。
- **結果**: 全テスト 3,676 件成功（テスト側の調整 2 箇所 — private メソッド `_initializeVolume` を直に叩いていたテストを hook の `connecting` に差し替え）。`State.ts` は 1,683 → **1,542 行**（−141）。`auto.min.js` は +0.4 KB gzip（71.6 → 72.0 KB。D19 の受け入れ幅の内側）。
- **残り**: `State.ts` にはまだ機能の import が 24 本ある（bind-component / マウント 12・stream 4・watch 4・recursion 3・dcc 2）。分割エントリ（S5）で `core` が機能を引きずらなくなるのは、この残りを同じ受け口へ移してから。

### 8-4. S4 の第 2 片の実装記録（2026-09-21、宣言 hook、サンドボックス）

H4（宣言 hook）を temporal の `$streams` と `$watch` に当てた（[s4TemporalDeclarationPatch.mjs](../scripts/research/s4TemporalDeclarationPatch.mjs)）。

- **「予約キーを走査して handler に渡す」形は採れなかった**。`_state` セッターはこのパッケージで最も順序に敏感で、どの検証が世代を進める前に走りどれが後かがそのままテスト（`integration.stateGenerationReset.test.ts`）で固定されている。受け口は**段（phase）**にした（`core/declarationHooks.ts`）: `apply`（新しい `getterPaths` / `setterPaths` の収集後 — `$streams` の衝突検査がそれを見る）・`register`（`_rebuildPathInfo` と `$scan` の登録の後）・`activate`（接続中の再 set と接続の末尾）・`deactivate`（切断）。機能は要る段だけ実装し、core は従来の分岐があった位置で各段を呼ぶ。
- **deactivate は降順で聞く**。`apply` / `register` / `activate` は `order` の昇順、停止だけ逆順にすると、「watch は stream より先に起動し、後に停止する」という従来 `State` に直書きされていた順序契約が番号 2 つ（watch 10・streams 20）だけで保たれる。
- **起動のガードは機能側へ**。`$connectedCallback` の await 中の切断・「切断 → 即再接続」の世代照合・SSR の除外・`$streams` の二重起動防止は、core の `if` から stream / watch の `activate` へ移った。core が渡すのは「その接続で捕捉した世代」か、宣言側からの起動を表す null だけ。`_streamsStartedGeneration` は `State` の private フィールドから stream 機能の要素ごとの台帳になった。
- **`$scan` はこの片では core に残した**（意図的。次の片で移した — §8-5）。
- **結果**: 全テスト 3,676 件が一度で成功（テスト側の調整 0）。`State.ts` は 1,683 → **1,464 行**（S4 の 2 片で −219）。`auto.min.js` は 72.4 KB gzip（作業ツリー比 +2.1 KB、D19 の (a) で受け入れる幅）。rollup の循環警告は従来と同じ 2 件で増えていない。
- **5 本のスクリプトは順に当てれば同じ木を再現する**（S3 の 3 片 → S4 の 2 片）。新しいコピーへ replay して、サンドボックスと 1 バイトも違わないことを確認した。

### 8-5. S4 の第 3 片の実装記録（2026-09-21、文脈袋、サンドボックス）

§8-4 が残した課題（`$scan` は世代を進める前に検証し、他の宣言が作る値を要る）を、受け口の**文脈袋**で解いた（[s4ScanContextPatch.mjs](../scripts/research/s4ScanContextPatch.mjs)）。

- **文脈袋**（`IDeclarationContext`）は 1 回の `_state` set のあいだだけ生きる小さな受け渡し口。core が自分の作った値（`$eventTokens` の名前・再帰レジストリ）を publish し、`$scan` の検証がそれを読む。解析したエントリも袋に入れ、validate → applyEarly → register を渡り歩く。機能どうしが直接 import し合わずに値を渡せるので、宣言の依存関係が `order` と袋だけで表せる。
- **段が 2 つ増えた**: `validate`（世代を進める前。`value` しか読まない検証で、ここで throw した再セットは世代を進めない）と `applyEarly`（`__state` 差し替え直後・`$on` の配線より前。`$scan` の出力の実体化と購読は `_rebuildPathInfo` より前・`$on` より前という D11 の契約）。これで宣言の段は validate → applyEarly → apply → register → activate → deactivate の 6 つになった。
- **`order` が register の並びも決める**: scan 8 < watch 10 なので、`$scan` の依存グラフ登録が `$watch` より先という従来の並び（「scan だけを宣言した state も drain の発火対象に載せる」）がそのまま保たれる。
- **結果**: 全テスト 3,676 件成功。`State.ts` は 1,463 行。core → 機能の辺は 14 → **15**: `bootstrapState` が scan の install を 1 本増やしたため。これは設計が認めている「入口の辺」（残る 15 のうち 5 本が install 系）で、分割形では `installFeatures([...])` が肩代わりする。`auto.min.js` は 72.6 KB gzip。
- **6 本のスクリプトは順に当てれば同じ木を再現する**（新しいコピーへの replay で確認）。

### 8-6. S4 の第 4 片の実装記録（2026-09-21、bind-component とマウント、サンドボックス）

要素の配線で最大の塊（`_initializeBindWebComponent` 約 190 行 ＋ 接続・再接続・切断の 3 分岐）を機能へ移した（[s4BindComponentPatch.mjs](../scripts/research/s4BindComponentPatch.mjs)）。

- **「引き取るか否か」の形が合わなかった**。`bind-component` の初期化は該当要素で**必ず**走り、**マウントスコープを組んだときだけ**その後の初期化（独立ツリーの構築）を打ち切る。第 1 片の `connecting`（引き取るなら Promise、でなければ null）では表せないので、受け口に `preparing` の段を足した: 「前処理をして、この要素を**丸ごと引き取ったか**を返す」。
- **190 行は書き写さず、スクリプトが `State.ts` から抽出して書き換えた**。`this.` の参照だけを機能の台帳と要素の内部面へ機械的に置換し、置換後に `this.` が 1 つでも残っていればスクリプトが落ちる。移動が目で追える差分になり、書き写しの取りこぼしが構造的に起きない。
- **微妙な挙動の罠を 1 つ踏んだ（テストが捕まえた）**。従来この位置には素の state でも必ず `await this._initializeBindWebComponent()` があり、microtask の境界が 1 つ入っていた。引き取り手が無いとき await を省く「最適化」を入れたら、内包スクリプトのロードのようにその境界に依存する経路が時間切れになった（2 本のテスト）。接続は 1 要素 1 回なので費用は無く、**常に await する**のが正しい。`connecting`（第 1 片）は従来も同期の属性判定だったので null 返しのままでよい — 段ごとに従来の形に合わせる、が結論。
- **結果**: 全テスト 3,676 件成功（テスト側の調整は 18 箇所 — private メソッドを直に叩いていた呼び出しを hook の `preparing` に差し替え、3 ファイル）。`State.ts` は 1,683 → **1,277 行**（S4 の 4 片で −406）。機能の import は 24 → **7 本**（recursion 3・DCC 2・scopes の install 2）。`auto.min.js` は 72.7 KB gzip、rollup の循環警告は 2 件のまま。

### 8-7. S4 の第 5・6 片の実装記録（2026-09-21、`$recursion` と残りの import、サンドボックス）

最後の宣言 `$recursion` と、`State.ts` に残っていた細い import を外した（[s4RecursionDeclarationPatch.mjs](../scripts/research/s4RecursionDeclarationPatch.mjs)・[s4TrimStateImportsPatch.mjs](../scripts/research/s4TrimStateImportsPatch.mjs)）。

- **文脈袋が機能どうしの受け渡しになった**。`$recursion` が構築したレジストリを袋に置き、`$scan` の検証がそれを読む。core は「ある宣言が別の宣言に値を渡す」ことを知らなくなり、袋に publish するのは `previousState` とトークン名だけになった。
- **段は 2 つ増えて 8 つ**: `validateEarly`（core 自身のトークン / `$listKeys` の解析より前 — `$recursion` は元からここ）と `preCommit`（検証がすべて済み、まだ世代を進めていない点 — 旧世代の後始末と差し替え）。「順序が変わらないと思う」より「従来その点があったなら名前を付ける」ほうを選んだ。順序契約はテストが固定しており、推測で畳むと壊れる。
- **`installScopeHooks()` / `installDccHooks()` を要素から外した**。機能の install は入口（`bootstrapState()`）か機能自身（DCC は束ねる時点）の仕事で、要素が保険で呼ぶものではない。これで readiness barrier が本来の形で効くようになり、`defineDCC` を通さず `setBindableEventMap` を直に叩く単体テストが 1 本落ちた — **barrier が正しく発火した**ので、テスト側が install するよう直した（分割エントリのページがすることと同じ）。
- **`RecursionRegistry` は型だけの import になった**（`import type`）ので、値の辺としては消えた。
- **結果**: 全テスト 3,676 件成功。`State.ts` は 1,683 → **1,252 行**（S4 の 6 片で −431）。機能の import は 24 → **3 本**（うち 1 本は型のみ）。残る値の import は DCC の `defineDCC` と、ルート初期化失敗の着地（`clearFailedRootNode` / `failPendingVolumes`）の 2 つだけで、どちらも専用の受け口が要る。
- **core → 機能の辺は 16**。内訳は install 6・SSR 4（S5 の H8）・apply 側 3・drain listener 2・`registerComponents → State` 1 で、**読み書きと接続の hot path の辺は 1 本も残っていない**。install の辺は分割形で `installFeatures([...])` が肩代わりする。


**第 7 片（2026-09-21、ルート初期化失敗の着地）**: ルートが初期化に失敗したとき、そのルートを待っている保留中のボリュームに知らせる経路と、失敗したルート要素自身が DOM から消えたときに印を消す経路が、`State` から機能への最後の 2 呼び出しだった（[s4FailedRootPatch.mjs](../scripts/research/s4FailedRootPatch.mjs)）。受け口 `initializeFailed` / `initializeFailureCleared` を足し、core には自分のもの（`markBindingsUnavailable`）だけを残した。全テスト 3,676 件成功。**`State.ts` に残る機能の import は 2 本（型のみの `RecursionRegistry` と、DCC の `defineDCC`）— 値の import は 1 本だけ**になった。

### 8-8. S4 の第 8 片の実装記録（2026-09-21、DCC の接続、サンドボックス）

`State.ts` に残っていた最後の値 import（DCC の `defineDCC`）を外した（[s4DccLifecyclePatch.mjs](../scripts/research/s4DccLifecyclePatch.mjs)）。

- **第 1 片の `connecting` がそのまま合った**。`[data-wc-definition]` ホスト内の `<wcs-state>` は自分のツリーを持たず、ソースを読んでホストのテンプレートからカスタム要素を定義したら終わる — 「この接続を引き取る／null」の形そのもの。order は 10 で、ボリューム（20）・bind-component（30）より先という従来の分岐順を番号で保つ。分岐と `_initializeDCC` は `dcc/dccLifecycle.ts` へ移った。
- **要素の内部面が 2 つ増えた**: `failInitializeLoudly`（DCC のロード失敗は `_initialize` と同じ着地に載る — #257。ボリュームの失敗は載らないので、core の `await claimed` を包んで着地させる形は採れない）と `markTreeless`（従来の `_dcc` フラグ。再接続の分岐が「この rootNode のツリーとして登録し直さない」ために読む）。後者は「自分のツリーを持たずに初期化を終えた」という core の概念なので、フラグは `State` に `_treeless` の名で残し、DCC をその最初の利用者とした。
- **readiness barrier に DCC の形を足した**（`mount=` と同じ場所・同じ順）: 引き取り手の居ない `[data-wc-definition]` ホスト内の `<wcs-state>` は `a <wcs-state> inside a [data-wc-definition] host needs the "dcc" feature` で落ちる。`bootstrapState()` が `installDccLifecycle()` を呼ぶので、full / auto では起きない。境界テスト `core.lifecycleHooks.test.ts`（4 件）が 2 つの barrier と `order` の契約（install の順でなく昇順・同名の再登録は置き換え）を固定する。`mount=` の barrier にはこれまでテストが無かった。
- **前の片の取りこぼしを 2 つ拾った**: 呼び出し元の無い `isLifecycleFeatureRegistered` / `isDeclarationFeatureRegistered`（カバレッジの関数 100% を割っていた 2 関数）を削り、第 1 片の `CLAIMED = Promise.resolve()` に `/*#__PURE__*/` を付けた。後者は評価時の呼び出しで、製品へ移すと CI の結合門（評価時に処理を走らせるのは `auto.ts` だけ）に掛かる。
- **結果**: 全テスト 3,680 件成功。テスト側の調整は `dcc.State.test.ts` の install 1 行（`bootstrapState()` を経ない単体テストなので、分割エントリのページと同じく自分で install する）。カバレッジ 99.61 / 98.51 / 100 / 99.8 で閾値内。`State.ts` は 1,252 → **1,220 行**（S4 の 8 片で −463）、機能の import は 24 → **1 本（型のみの `RecursionRegistry`）で、値の import は 0 本**。SSR（`Ssr`）はこれまでの数え方と同じく勘定の外で、S5 の H8 で切る。core → 機能の辺は 16 → 17（`bootstrapState → dcc/dccLifecycle` の install 辺が 1 本増え、install 辺は 7 本。分割形では `installFeatures([...])` が肩代わりする）。結合門（`--check`）はサンドボックスで通過（評価時モジュールは `auto.ts` だけ）。`auto.min.js` は 72,850 → 73,024 B gzip（+174 B）、rollup の循環警告は 2 件のまま。
- **11 本のスクリプトは順に当てれば同じ木を再現する**（リポジトリの `packages/state` の新しいコピーへ replay し、サンドボックスと src・テストとも 1 バイトも違わないことを確認）。

### 8-9. S5 の第 1 片の実装記録（2026-09-21、install と SSR 以外の辺、サンドボックス）

S4 の後に残った core → 機能の辺 17 本のうち、install（7）でも SSR（4）でも `registerComponents → State`（1）でもない 5 本を受け口へ移した（[s5CoreEdgesPatch.mjs](../scripts/research/s5CoreEdgesPatch.mjs)）。§3 の表に無い受け口が 3 つ要った。

- **enqueue listener**（H2 の enqueue 側）: `updater` は書き込みの enqueue ごとに、`$watch` の連鎖深さ（`watch/chainDepth`）と `on` scan の保留 reset（`scan/eventReset`）へ直接知らせていた。`registerEnqueueListener` を足し、watch と scan の install が登録する。2 つは互いに独立なので、drain listener のような優先度は持たない。未 install なら enqueue は配列長 0 の判定 1 回で済む。
- **カスタム要素のプロパティ束縛の受け口**（`core/componentApplyHooks.ts`）: `apply` は bind-component の台帳 2 つ（完了・宣言の `completeWebComponent`、完了前の書き込みの控えの `preCompletionWrites`）を直接引いていた。受け口 1 つにまとめ、bind-component の install（`installBindComponentLifecycle`）が置く。置かれていなければ、カスタム要素への束縛も素のプロパティ書き込みになり、何も控えない。控えの読み手は bind-component の中にしか居ないので、控えても使われない。実装は台帳 2 つだけに依存する軽いモジュール（`webComponent/componentApply.ts`）に分けた。単体テストが重いライフサイクルのモジュールを評価せずに受け口を置けるようにするため。
- **per-state hook の 13 種目 `rowReused`**: その場で使い回した行は DOM から外れないので `connectedCallback` が来ない。その行の中のマウントスコープを張り直す呼び出しを、スコープ機能の hook に移した。マウントもボリュームも無い state には hook が無いので、null 判定 1 個で抜ける。スコープの hook はボリュームだけの state にも付くため、hook 自身は従来どおり「マウントがあるか」で抜ける（境界テスト `webComponent.rowReused.test.ts`）。
- **拾い物: `bind-component` に readiness barrier が無かった**。スコープ機能が未 install だと `preparing` の引き取り手が居ないまま null が返り、属性は黙って無視されて素の state になっていた（分割エントリだけの経路）。今は名指しで落ちる。置き場所は bind-component の他の設定エラーと同じ try の中なので、#257 の着地に載る（`connectedCallbackPromise` を reject し、診断を 1 件出す）。
- **結果**: 全テスト 3,687 件成功。テスト側の調整は 3 ファイルで受け口を置く 1 行ずつで、境界テストを 7 件足した。カバレッジ 99.61 / 98.51 / 100 / 99.8 で閾値内。core → 機能の辺は 17 → **12**（install 7・SSR 4・`registerComponents → State` 1）。`auto.min.js` は 73,024 → 73,036 B gzip（+12 B）、rollup の循環警告は 2 件のまま。12 本のスクリプトは順に当てれば同じ木を再現する。
- **測らなかったもの**: enqueue の変更は「同じ 2 関数を直接呼ぶ」から「同じ 2 関数を配列で回す」への置き換えで、既存の読み書きのマイクロベンチでは測れない（同値書き込みは enqueue の手前で返る）。分割形の core では配列が空なので、書き込みごとの呼び出しが 2 つ減る。

### 8-10. S5 の第 2 片の実装記録（2026-09-21、SSR の分離＝H8、サンドボックス）

SSR を core から外した（[s5SsrSplitPatch.mjs](../scripts/research/s5SsrSplitPatch.mjs)）。`components/Ssr.ts`・`hydrateBindings.ts`・`buildSsrDocument.ts` の約 960 行が `src/ssr/` へ移り、core に残ったのは自分のものだけになった。

- **core が持つのは SSR の「モード」だけ**: `inSsr()` と、apply 側が書く `@@wcs-*` コメント・`ssrPropertyStore`。H8 が意図してそうしている — これは描画の様式であってモジュール依存ではない。機能へ渡るのは `enable-ssr` 属性の 3 点で、受け口 1 つ（`core/ssrHooks.ts`）に畳んだ: `hydrate`（ルート登録）・`loadState`（`_initialize` の冒頭で `<wcs-ssr>` のデータを読む）・`emitSnapshot`（サーバー側で、バインディング完了後に `<wcs-ssr>` を書き出す）。
- **タグの定義は definer で登録する**: `registerComponents` は `<wcs-state>` だけを定義し、機能のタグは `registerComponentDefiner` で預ける。definer は state より**先**に走らせる — SSR 出力の `<wcs-ssr>` は state の接続が読むので、未 upgrade のまま state が先に動くと `stateData` が無い（従来 `registerComponents` が Ssr を先に define していたのと同じ順序を、受け口の契約として明示した）。
- **readiness barrier**: `enable-ssr` を宣言したのに ssr 機能が未 install なら名指しで落ちる（`the "enable-ssr" attribute needs the "ssr" feature`）。`_loadFromSsrElement` は `_initialize` の中なので #257 の着地に載る。
- **結果**: 全テスト 3,692 件成功（テスト側の調整は 2 箇所 — `registerComponents` のモックに新しい export を足す、`<wcs-ssr>` を期待するテストが `installSsr()` を呼ぶ。境界テスト `core.ssrHooks.test.ts` 3 件と definer の 2 件を追加）。カバレッジ 99.61 / 98.52 / 100 / 99.8 で閾値内。core → 機能の辺は 12 → **10 で、すべて入口の辺**（`bootstrapState` の install 8・`exports → ssr/Ssr`・`registerComponents → components/State`）。rollup の循環は 31 → **28 モジュール**に縮んだ（`hydrateBindings` が輪から抜けた）。警告は従来どおり 2 件。
- **full のサイズは +390 B gzip**（73,036 → 73,426）。受け口と install の分で、full は必ず払う側。分割形の core が SSR の 960 行を落とせるかは、エントリを分ける次の片で実測する（スタブ化ビルドの見積もりではなく、実際の tree-shake で）。
- **13 本のスクリプトは順に当てれば同じ木を再現する**。

### 8-11. S5 の第 3 片の実装記録（2026-09-21、エントリ分割、サンドボックス）

受け口が揃ったので、機能にエントリを与えてページが組み合わせられるようにした（[s5SplitEntriesPatch.mjs](../scripts/research/s5SplitEntriesPatch.mjs)）。

- **記述子と `installFeatures`**（`core/features.ts`）: 機能のエントリは `{ name, install }` を default export し、ページは `installFeatures([temporal, scopes])` で要るものだけ入れる。**冪等は機能側の install が持つ**（どれも `installed` フラグを持っている）。core 側で名前を覚えて重複を弾く形も書いてみたが、同じことを 2 箇所に持つうえ「`bootstrapState()` の 2 回目は機能の install に届かない」という観測できる差が増え、既存テストがそれを捕まえた。core は並べた順に呼ぶだけにした。
- **barrier はエントリを名指しする**（`core/featureEntries.ts`）: 当たったページが要るのは「どの import を足すか」で、内部の機能名（watch / scan / stream）と入れるエントリ（temporal）は 1 対 1 ではない。対応表を 1 箇所に置き、3 つの barrier が共有する。
- **bootstrap は 2 つに割れた**: `core/bootstrapCore.ts`（設定・タグ登録・binder。install は一切しない）と、従来どおりの `bootstrapState()`（`installFeatures(ALL_FEATURES)` → `bootstrapCore()`）。full / auto の挙動は変わらない。
- **`@wcstack/state/core` は「ビルドできる」だけでなく動く**: 機能を 1 つも入れないページで、束縛・更新・リスト描画が通ることを `entries.core.test.ts` が固定する。
- **サイズ（実測、単一ファイル束ね・gzip -9。[split-entry-sizes.json](research/state-next/split-entry-sizes.json)、[measureSplitEntries.mjs](../scripts/research/measureSplitEntries.mjs) が生成）**: core だけ **43,779 B**（minify 147,356）。機能を足した差分は scopes +15,368・temporal +8,324・recursion +4,806・ssr +3,080・devtools +1,949 B で、全部入り 73,504 B（full の `auto.min.js` 73,561 とほぼ同じ）。**core の実測値は、調査 §9 の「機能をスタブ化した上限」44.0 KB とほぼ同じ**で、設計 §5 が見込んだ「配線の切り出しで 10〜13 KB 減る」は起きなかった — その配線はスタブ化ビルドでも既に機能側に数えられていた分で、受け口を足した分と相殺している。A2（35 KB）は本設計だけでは届かない、という §5 の結論は実測でも変わらない。
- **core の内訳（source map 帰属、minify バイト）**: `bindings/BindingSession.ts` 13.0 KB・`components/State.ts` 12.6 KB・`filters/builtinFilters.ts` 4.7 KB・`proxy/methods/setByAddress.ts` 4.6 KB・`apply/applyChangeToFor.ts` 4.0 KB・`pathDiagnostics.ts` 3.6 KB。グループでは bindings 14.7%・proxy 12.9%・apply 10.8%・components 8.5%。**契約解析（`contract/`）と devtools は core に 1 バイトも残っていない**。A2 に効く次の手は §5 の表どおり（BindingSession の一本化・診断の dev ビルド化・`features/formats`）。
- **単一 core チャンク（要件 B13）は成立した**: multi-entry ビルド（`rollup.split.config.js` → `dist-split/`）で、**どの機能エントリにも core のモジュールは入っていない**（source map 帰属で確認: scopes は webComponent / dcc だけ、temporal は stream / scan だけ…）。core は共有チャンク（`chunks/binder.js` ほか）に 1 つだけ置かれ、全機能がそれを import する。
- **分割配信のチャンク代**: 同じ core が、単一ファイルなら 43.8 KB gzip、分割形（8 ファイル）では合計 **49,535 B（+13%）**。ファイルごとに gzip するためで、全部入りなら 84,609 B（単一ファイルの 73,504 より +11 KB）。**分割形は「機能を落とすページ」のためのもので、全部入りのページは従来どおり full / auto を使うのが軽い**。
- **結合監査の分類を直した**: `components/State.ts` は core 自身の要素なのに「機能」に数えられていた（グループ名 `components` が `components/Ssr.ts` のために機能側だった）。機能はモジュール単位でも見るようにし（`FEATURE_MODULES = { components/Ssr.ts }`）、`components` はグループとしては core に戻した。その結果リポジトリ側の辺は 41 → **62** と見え方が変わる（同じコードの数え直し。基準 [state-coupling-baseline.json](../scripts/state-coupling-baseline.json) を取り直した）。**サンドボックスは 62 → 6** で、残るのは full エントリの辺だけ（`bootstrapState → features/*` 5 本と `exports → ssr/Ssr`）。
- **CI の新しい門**: 監査に `reachability: { "entries/core.ts": { "noFeatures": true } }` を足せる形を入れた（core エントリが機能グループへ 1 本でも到達したら落ちる）。基準に載せるのは `src/entries/core.ts` が製品に入るときで、サンドボックスでは通ることを確認した。
- **結果**: 全テスト 3,697 件成功、カバレッジ 99.61 / 98.52 / 100 / 99.8。`auto.min.js` は 73,426 → 73,561 B gzip（+135）。14 本のスクリプトは順に当てれば同じ木を再現する。
- **まだやっていない**: `package.json` の `exports` への `./core` / `./features/*` / `./define` の追加、本体 `rollup.config.js` への分割出力の組み込み、import map ＋ SRI の実形、`features/formats`（D16 のフィルタ登録簿が要る）。

### 8-12. 製品への移植（2026-09-21、`packages/state`）

S3・S4・S5 の 14 本のスクリプトを `packages/state` に当て、サンドボックスの試作を製品にした。**サンドボックスでは出せない配線**（`exports` マップ・本体ビルド・CI の門）はここで足している。

- **エントリ**: `package.json` の `exports` に `./core`・`./features/*`・`./define` を追加。`.`（full）と `./auto` は不変。
- **ビルド**: `rollup.config.js` に multi-entry の分割ビルド（`dist/split/` — `core.js`・`features/*.js`・`chunks/*.js`、minify・source map 付き、チャンク名はハッシュ無し）と、その型（`dist/split/**/*.d.ts`）、それに `dist/define.js`（minify で **49 バイト** — 恒等関数と型だけ）・`dist/define.d.ts` を足した。source map は任意ではない: 「機能が core を再同梱していない」門がそれを読む。
- **CI の門を 2 つ**: [check-state-split.mjs](../scripts/check-state-split.mjs)（各 `features/*` が core のチャンクを共有し、自分では core のコードを持たないこと ＝ 要件 B13）と、[check-state-size.mjs](../scripts/check-state-size.mjs) に core エントリを **閉包（`core.js` ＋ 引き込むチャンク）**で足した（エントリのファイル自体は 1 KB の殻なので、単体では意味の無い数字になる）。結合の基準は `maxCoreToFeatureEdges` 6 と `reachability: { "entries/core.ts": { "noFeatures": true } }` に締めた。
- **掃除**: 片が残した未使用 import（`State.ts` の 6 本・`getByAddress` の 2 つの名前空間定数・宣言モジュールの型 3 本）を外した。lint の警告は 0 になり、同じ掃除をスクリプト側（§8-11 の第 7 段）にも入れてある。
- **他パッケージ**: `@wcstack/server` / `router` / `wcstack` / e2e は `@wcstack/state` の公開面と `dist/auto.min.js` しか触っていないので、`components/Ssr.ts` → `ssr/Ssr.ts` の移動の影響は無い（`exports.ts` からの `Ssr` の再 export はそのまま）。
- **文書**: README（ja/en）に分割エントリの節、[sri](./sri.ja.md) §5.1 に import map ＋ `integrity` の実形。
- **結果**: 全テスト 3,697 件成功、カバレッジ 99.61 / 98.52 / 100 / 99.8、lint 0、ビルド成功。門は 4 つとも通る（結合 6 辺・ヘルパー入口 311 B gzip・サイズ・core の再同梱なし）。`dist` の実測は `auto.min.js` 73,561・`index.esm.js` 329,418・分割 core の閉包 49,535 B gzip（8 ファイル）。

### 8-13. `features/formats`（2026-09-21、フィルタ登録簿、`packages/state`）

D16 の決定（「実関数の解決は束縛計画の段。文法段だけを core に残し、書式フィルタ群を `features/formats` へ」）を実装した。§4 の表で最後に残っていたエントリ。

- **段が分かれた**: 解析の段（`bindTextParser/parseFilters.ts`）は **名前と引数しか作らない**（`IParsedFilter`）。実関数は束縛計画の段（`bindings/planFilters.ts`）が登録簿（`core/filterRegistry.ts`）から引き、`IBindingInfo` にだけ `filterFn` が載る（`IFilterInfo extends IParsedFilter`）。
- **束縛計画は 2 か所**: 通常経路の `getBindingInfos`（ノードごと）と、行プラン `structural/rowPlan.ts`（テンプレートごとに 1 回）。後者は「行不変の解決を焼き込む」という元の設計にそのまま乗る — 行ごとに引き直さない。
- **診断が動いた**: 未知のフィルタは解析時 throw から **束縛計画の段**へ。文言（`[wcs/filter-unknown]` と did-you-mean）は lint と同じまま。パーサだけを使う tooling は実装を持たないので、そもそも「知らない名前」を解析の段で判定できない — 移動は必然だった。
- **core が持つフィルタは `not` だけ**。`if` / `else` はエンジンが `not` を足した束縛として組み立てるので、`features/formats` を入れないページでも要る。`structural/createNotFilter.ts` は解析の段の形（名前と引数）を返すだけになった。
- **実装の置き場**: `filters/builtinFilters.ts` と `filters/errorMessages.ts` は `src/formats/` へ（`git mv`）。`filters/` に残るのは型と `filterMeta`（manifest / tooling が読むメタデータ）。`manifest.ts` は実装から名前を引く正本なので `formats/builtinFilters` を import する — 入口の辺が 1 本増えて基準は 8 本になった。
- **サイズ**: core 単体 43,779 → **42,705 B gzip**（minify 147,356 → 143,050）。`features/formats` は +1,272 B。full の `auto.min.js` は 73,561 → 73,968（+407 — 登録簿の間接化の分）。分割 core の閉包は 49,535 → 49,148 B。
- **結果**: 全テスト 3,704 件成功（テスト側の調整は 3 ファイル: 解析時解決を前提にしていた 7 件を新しい契約へ書き直し、境界テスト `core.filterRegistry.test.ts` を追加）。カバレッジ・lint・門は 4 つとも通る。

### 8-14. `features/diagnostics`（2026-09-21、開発時の診断、`packages/state`）

§5 の表の「診断文言を dev ビルドへ」を、別ビルドではなく**機能の 1 つ**として実装した。

- **形を選んだ理由**: buildless の配布で dev / 本番の 2 系統のファイル（URL）を持つと、利用者が URL を選び分けることになり、CDN の 1 行という前提が崩れる。既にある `installFeatures` の仕組みに載せれば、full / `auto` は従来どおり診断付きのまま、`@wcstack/state/core` を選んだページだけが診断を落とせる — A2 を測っているのもその `/core` だ。
- **分けたのは「実行を止めない診断」だけ**: `pathDiagnostics.ts` には 2 種類が同居していた。束縛時のパス存在検査（打ち間違いを `console.warn` で知らせる、動作には関わらない開発時の診断）は `src/diagnostics/pathChecks.ts` へ。**throw するエラーの文言**（`$resolve` の添字の本数・ワイルドカードの段数・ルートパスの欠落など）と、その did-you-mean が使う候補集めは core に残した — エラーは機能の有無に関わらず読める文言で落ちなければならない。
- **受け口**（`core/diagnosticsHooks.ts`）: `check` / `reset` / `markExported` の 3 点。置かれていなければ何もしない。**readiness barrier は置かない** — 診断が無いのは壊れた宣言ではなく静かな本番形なので、ここは他の機能と扱いが違う。
- **サイズ**（単一ファイル束ね、gzip。[split-entry-sizes.json](research/state-next/split-entry-sizes.json)）: core **43,810 → 43,204 B**（minify 146,805 → 144,750、−2.0 KB）。`features/diagnostics` は +758 B。分割配信の閉包は 50,283 → 50,320 B とほぼ変わらない: 検査が抜けた分を、core と機能の間に新しく割れた共有チャンク（文言・`errorGuidance`・受け口）のファイルごとの gzip 代が食った。**分割配信の数字は、共有部分の割れ方しだいで減らない**ことがある。
- **結果**: 全テスト 3,741 件成功（境界テスト 2 件 — core だけのページは打ち間違いを警告しない、`installFeatures([diagnostics])` で同じ打ち間違いが名指しで警告される）。カバレッジ 99.64 / 98.50 / 100 / 99.81、門は 4 つとも通る（結合は install 辺が 1 本増えて基準 9）。
- **A2 の最終地点**: §5 の手を出し尽くした状態で core は 43.2 KB gzip。35 KB との差 8 KB はこの構造では埋まらない（[行ランタイム設計](./state-next-major-runtime-design.ja.md) §9）。

### 8-15. 属性の readiness barrier の着地（2026-09-21、要件 D23、`packages/state`）

§9 に残していた「属性の barrier の着地」を、要件 D23 の決定どおり揃えた。`mount=` と DCC の barrier は `connectedCallback` から throw するだけで、`connectedCallbackPromise` は未解決のまま残っていた — scopes を入れ忘れた `/core` のページでは、それを待つ `renderToString`・`mount()`・`getBindingsReady` が止まる。

- **DCC**: barrier を DCC のロード失敗（`dcc/dccLifecycle.ts`）と同じ着地 `_failInitializeLoudly` に載せた。診断は 1 件、`connectedCallbackPromise` は reject。DCC の `<wcs-state>` はそのシャドウのツリーの持ち主なので、ツリーごと利用不能になる（ロード失敗と同じ）。
- **`mount=`**: `_failInitializeLoudly` に `ownsTree` 引数を足し、false のときはルートの印付け（`markBindingsUnavailable`）と保留ボリュームへの通知（`runInitializeFailed`）を飛ばす。ボリュームはツリーの持ち主ではなく、ルートより先に接続したボリュームでは rootNode にまだ誰も居ないので、既定の着地だとまだ来ていないルートのノードを利用不能と印付けしてしまう（§9 に書いたとおり）。
- **他のボリュームの失敗は変えていない**: `_initializeVolume` の失敗は従来どおり promise を解決してから raise する（`integration.initFailureDiagnostics.test.ts` が固定、枠の寿命は別 Issue）。barrier だけが reject になるのは、「機能を入れ忘れた」はページの作者に必ず直してもらう設定であり、`mount()` のようなテストの入口で黙って通してはいけないから。
- **テスト**: [core.lifecycleHooks.test.ts](../packages/state/__tests__/core.lifecycleHooks.test.ts) の 2 件を着地まで確かめる形にした（`connectedCallbackPromise` の reject・診断 1 件・ツリーの印付け — DCC は付く、`mount=` は付かない）。`mount=` を既定の着地に戻すと後者が落ちることも確かめた。全テスト 3,743 件成功、カバレッジ不変。

## 9. 決めたこと・決めていないこと

決めた（2026-09-21、要件 §6 の D12・D13・D15・D16）:

- **`install` の API 形**: `installFeatures([...])` を既定にする。機能ごとの副作用 import の薄い入口は、D3 の分割形の利便として後から足せる。
- **フィルタ実関数の解決時機**: 束縛計画の段で登録簿を引く。文法段（1.7〜3.2 KB gzip、調査 §4.3）だけを core に残し、書式フィルタ群を `features/formats` に切り出す。「未知フィルタ」の診断は解析時 throw から束縛計画の段へ移す。
- **H1 hook の付与**: `_state` setter が宣言（予約キー・`**`・DCC）から state 要素の `addressHooks` を組み、`mount=` 属性は `connectedCallback` で 2 段目に拾う（§8-2）。
- **readiness barrier の発火時点**: `_state` setter（宣言の評価時）で throw。`auto` / full では起きない。
- **S3 の受け口が full に足す +1.3 KB gzip**（要件 D19、§8-2 の第 2・3 片の記録）: 3.0 のビルドで `scripts/state-size-baseline.json` を取り直して受け入れる。12 種のループを共通 runner に畳むかは、3.0 の器に載せるときに測ってから決める。

決めた（2026-09-21、第 2 回。以前は「決めていない」に置いていた 2 項目）:

- `BindingSession` の二重経路の一本化と、行 record・session 共有・プラン初期描画（調査 §10.7・§10.13・§10.14）の具体設計は本設計の外で、R1〜R5 として実装済み → [行ランタイムの設計案](./state-next-major-runtime-design.ja.md)（R1〜R5）。
- **属性の barrier の着地**（§8-8 で見つけた。**2026-09-21 に要件 D23 で「揃える」と決めた** — DCC はロード失敗と同じ着地、`mount=` はルートを巻き込まない専用の着地で `connectedCallbackPromise` を reject する。実装は §8-15）: `mount=` と DCC の barrier は `connectedCallback` から throw するだけで、`connectedCallbackPromise` は未解決のまま残る。宣言の barrier は `_initialize` の中で落ちるので #257 の着地に載る。そろえるなら、`mount=` には `_failInitializeLoudly` をそのまま使えない（ルートより先に接続したボリュームでは、まだ来ていないルートのノードを利用不能と印付けし、保留中の他のボリュームまで落とす）ので、ルートを巻き込まない着地が要る。分割エントリにしか無い経路なので、S5 で決める。§8-9 で足した `bind-component` の barrier は、bind-component の他の設定エラーと同じ try の中にあるので着地する。DCC の barrier も、DCC のロード失敗と同じ着地に載せて差し支えない。

決めていない: なし。
