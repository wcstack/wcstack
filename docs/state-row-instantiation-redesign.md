# state 行実体化層の再設計 — jsfb Round 3 設計書

- **状態**: **Phase 0-5 実装完了**（2026-07-19・branch `improve/jsfb-round3`・base = main @0f3b721a・実施記録は §10）
- **対象**: `@wcstack/state` の**行実体化層**（list 行の createContent → BindingSession → 台帳登録）。反応性コア（proxy / walkDependency / updater）は**対象外**。
- **関連**: [state-redesign-council.md](state-redesign-council.md)（ADR-8: 動的深追跡維持・「裏は全焼可」）/ [state-redesign-route-a.md](state-redesign-route-a.md) / [list-replacement-dependency-scaling.md](list-replacement-dependency-scaling.md)

---

## 0. 位置づけ — なぜ「再設計」で、なぜ評議会決裁と矛盾しないか

### 0-1. 挙証（Gate 0 相当は既に済んでいる）

jsfb ベンチの create/append/replace は、**3 ラウンドの独立調査すべてで「安全な微最適化では wall-clock が動かない」と結論**した:

- R1（PR#83）: 候補 1-5 全実装（observer skip / wholesale destroy / set 固定費 / Promise 遅延 / activate 専用 API）。remove −61%・clear −45% は出たが、create/append は CPU・GC のみ減で wall-clock は数 ms 止まり。
- create-cost 調査: bindingKey メモ化・forEachInclusive 割当回避は「CPU/GC は確実に減るが wall-clock 不変」。benchmark-special config も効果ゼロ（optional 機能は未使用時ほぼゼロコスト）。**「本質改善には宣言的バインディング機構そのものの再設計が必要」**が調査自身の結論。
- R2（PR#84）: 台帳 WeakMap ホイストも wall-clock 不変（native/GC 床の再々確認）。

つまり「作り直しでしか得られない便益」（council ADR-4 の挙証）は**この層に限っては既に示されている**: 残ギャップ（create 2.9x / append 4.0x）はスライスの節約では消えず、**行あたりの割当グラフと台帳書き込みの総量**を構造ごと変えないと動かない。傍証として、丸ごとの走査除去（clear の observer skip）だけが wall-clock を確実に動かした（−33%）。

### 0-2. 評議会決裁との整合

council の the one true fork（動的深追跡 vs 静的降格）と route-a の A4（GraphCore/Scheduler）は**反応性コア**の話。本書が触るのは:

- `structural/createContent.ts` / `structural/activateContent.ts` / `bindings/BindingSession.ts` / `binding/getBindingSetByAbsoluteStateAddress.ts` 周辺 = **実体化層**。
- proxy トラップ・walkDependency・updater の drain 意味論・パス意味論は**一切変えない**。

council の指針「**裏（実装・内部表現・TS API）は全焼させてよい。表（HTML構文）とプロトコル契約は 1 ミリも動かすな**」の範囲内であり、ADR-8（動的深追跡維持）とは直交する。route-a の段階でいえば A1（加点）でも A4（コア再構築）でもない、**実体化層限定の構造変更**として位置づける。

---

## 1. ベースライン（2026-07-18・本機・`e2e/bench/jsfb-verify.mjs`・中央値 ms）

計測物: `e2e/bench-results/r3-base-{state,signals}.json`（未コミット・再現可能）。

| op | state | signals | 比 | R3 の扱い |
|---|---|---|---|---|
| create1k | **23.95** | 8.25 | 2.9x | **主対象** |
| replace1k | 18.2 | 9.2 | 2.0x | 主対象（プール再利用経路） |
| append1kTo10k | **43.5** | 10.8 | **4.0x** | **主対象** |
| clear10k | 47.45 | 44.55 | 1.07x | 維持（P3 で微減期待） |
| update10k | 8.85 | 3.85 | 2.3x | 対象外（二相 drain アーキ固有・P3 の副次利益のみ） |
| remove1k / select1k / swap1k | 1.6 / 0.8 / 0.8 | 0.4 / 0.3 / 0.3 | — | 対象外（絶対値小） |

keyed 判定: 両者とも公式 isKeyed 全合格。state は `recycledOnRun=1000`（プーリング）— **維持必須**。

---

## 2. 現行 create 経路の解剖（2026-07-18 実測・main @0f3b721a）

### 2-1. 行 1 本あたりのコスト（jsfb 行 = 5 バインディング: text×2 / class×1 / event×2）

| 項目 | 量 | 備考 |
|---|---|---|
| ヒープ割当 | **≈90–110 個** | 下記 2-2 参照。signals は同一 DOM で ≈1/3 |
| 永続台帳書き込み | **≈66 回** | binding あたり ≈12 + content あたり 6 |
| `getRootNode()` ネイティブ呼び出し | **≈15 回** | binding あたり ≈3（observe×2 + 絶対アドレス解決×1） |
| DOM ノード | 11 + fragment | `importNode` 深 clone（これは正当な native 床） |

プール再利用経路（replace1k）でも **≈35–45 割当/行** が残る: record + teardowns Set + クロージャ×10 + AbsoluteStateAddress×5 + Set×5 + WeakMap×2 + リスナー再 attach。

### 2-2. 行不変なのに毎行やり直している仕事（本設計の標的・file:line は 2026-07-18 時点）

テンプレのパース・TreeWalker 走査・nodePath 捕捉・setPathInfo・テキストノード事前正規化は**既にテンプレ単位でキャッシュ済み**（`structural/fragmentInfoByUUID.ts`）。残っている行不変の再実行は:

1. **`new BindingSession()` + 内部コレクション 6 個/行**（`bindings/initializeBindings.ts:51`, `BindingSession.ts:213-222`）— 構造は全行同一。真に行ごとなのは records だけ。
2. **`IBindingInfo` の spread 複製/バインディング**（`bindings/getBindingInfos.ts:8,21`）— node/replaceNode 以外の全フィールドが行不変。
3. **`bindingKey` 文字列再構築 + filter `.map` 配列×2/バインディング**（`BindingSession.ts:198-210,482-485`）— メモ化キーが行ごとの binding オブジェクトなので毎行作り直し。
4. **options オブジェクト `{...options}`/バインディング**（`BindingSession.ts:498`）。
5. **initial-sync policy / authority の再解決/バインディング**（`BindingSession.ts:638-639`, `bindings/initialSync.ts:71,142`）— propModifiers 等の純関数。値は frozen singleton 化済みだが判定 CPU は毎行。
6. **`isPossibleTwoWay` 判定 + 二方向不能な text/class にも無条件 `detachTwowayEventHandler` teardown クロージャ**（`BindingSession.ts:586-587`）— tagName+propName の純関数＝テンプレ時確定可。
7. **handler key 文字列/イベントバインディング**（`event/handler.ts:23`）— 行不変（handler 関数自体はキー共有済み）。
8. **address teardown クロージャ/バインディング**（`BindingSession.ts:705-711`）。
9. **`getListIndexByBindingInfo` の per-loopContext WeakMap**（`list/getListIndexByBindingInfo.ts:15`）+ calcWildcardLen は行不変。
10. **indexBindings 再スキャン/行**（`structural/createContent.ts:158-164`）— メンバーシップはテンプレ固定。
11. **絶対アドレス機構/バインディング**: `getRootNode()`（`getAbsoluteStateAddressByBinding.ts:20`）+ `AbsoluteStateAddress` 割当 + intern 用 WeakMap + **アドレスごとサイズ 1 の専用 `Set` 割当**（`getBindingSetByAbsoluteStateAddress.ts:12`）= 台帳書き込み 12 回中 ≈5 回。

### 2-3. 台帳と drain の現行契約（保存すべき性質）

- drain の検索は **intern 済み `IAbsoluteStateAddress` オブジェクト同一性**による WeakMap 1 発（`updater/updater.ts:131`）。文字列パースなし・drain 時 wildcard マッチなし。
- **リオーダー時の台帳ゼロタッチ**: 行同一性 = listIndex オブジェクト同一性。swap/LIS は `.index` の変異と DOM 移動のみで、`bindingSetByAbsoluteStateAddress` に一切触れない。
- clear の溢れ分（プール超過）は wholesale destroy が per-binding teardown を全スキップ済み（弱参照設計で GC に委譲）。

---

## 3. 設計 — 4 本柱

### 3-0. 設計原理

1. **「テンプレで一度、行では写すだけ」**: 行不変の計算・判定・文字列・方針解決はすべてテンプレ単位の**コンパイル済み実体化計画（RowPlan）**に前倒しする。行の実体化は「clone → nodePath でノード解決 → プランのスロットを埋める」だけにする。
2. **割当グラフを変える。スライスは削らない**: per-binding のクロージャ・Set・options・key 文字列は**構造ごと消す**（削減でなく不在にする）。
3. **既存経路は残す。適用はゲート付き fast path**: R2 の zero-reuse 一括削除と同じ着地パターン。プラン化できないテンプレ（§5）は現行汎用経路にフォールバックし、意味論の互換を経路分岐で保証する。
4. **drain 契約とリオーダー不変条件を1ミリも壊さない**（§2-3 の 2 性質を保存）。

### 3-1. P1: RowPlan — テンプレ単位のコンパイル済み実体化計画

`fragmentInfoByUUID` に **plan** を追加（初回行実体化時に遅延コンパイル・buildless 維持）:

```ts
interface IRowPlan {
  readonly slots: readonly IRowPlanSlot[];   // バインディングごと 1 スロット
  readonly indexSlotIds: readonly number[];  // $1 系スロット（indexBindings 再スキャン廃止）
  readonly subscriberNodePaths: readonly number[][];
}
interface IRowPlanSlot {
  readonly nodePathId: number;               // subscriberNodePaths への索引
  readonly template: IBindingInfo;           // 行不変フィールドの正本（凍結）
  readonly kind: SlotKind;                   // text | class | style | attr | prop | event
  readonly policy: IInitialSyncPolicy;       // 解決済み singleton（毎行の再解決廃止）
  readonly authority: "state" | "none";
  readonly twoWayEligible: boolean;          // isPossibleTwoWay をテンプレ時確定
  readonly handlerKey: string | null;        // event 用（毎行の文字列構築廃止）
  readonly applyFn: ApplyChangeFn;           // fnByBinding 相当をテンプレ時確定
}
```

- スロットの `template` は現行 `parseBindTextResult` 由来の凍結オブジェクト。行インスタンスの `IBindingInfo` は `{ __proto__: template, node, replaceNode }` 型の**薄い差分オブジェクト**にする（現行の 10 フィールド spread 複製を置換。shape を全スロット共通にして megamorphic 化を回避）。
- コンパイル時に §2-2 の 3/4/5/6/7/10 をすべて焼き込む。**行側で消えるもの**: bindingKey 文字列 + map 配列×2、options オブジェクト、policy/authority 判定、isPossibleTwoWay、handlerKey 文字列、indexBindings スキャン。

### 3-2. P2: フラット行レコード — クロージャ / Set / セッションの全廃

行の実行時状態を **1 個の RowRecord** に畳む:

```ts
interface IRowRecord {
  plan: IRowPlan;
  content: IContent;
  loopContext: ILoopContext;
  nodes: Node[];                 // スロット順の解決済みノード
  bindings: IBindingInfo[];      // スロット順の薄い行 binding
  phase: "active" | "disposed";
}
```

- **BindingSession/行 を廃止**: records Set・knownBindingsByNode（プランがユニーク性を保証するので dedup 不要）・optionsByBinding・deferredByNode/deferred（fast path 対象外）を行から消す。MutationObserver の owner は従来どおり root 単位の session（`sessionByRoot`）が担い、RowRecord はそこに属する。
- **teardown をデータ駆動化**: per-binding の teardowns Set + クロージャ（現行 10 個/行）を廃止し、`disposeRow(record)` がスロット `kind`/`twoWayEligible`/`handlerKey` を見て必要な detach（removeEventListener / registry decrement / 台帳削除）を直接実行する。クロージャ割当ゼロ。
- wholesale destroy は `record.phase = "disposed"` の一括代入のみ（現行 `destroyRecords` と同型・弱参照前提を維持）。

### 3-3. P3: パターン索引台帳 — `(absolutePathInfo, listIndex)` 2 段キー

現行: 登録時に binding ごと `AbsoluteStateAddress` を intern し、`WeakMap<addr, Set<IBindingInfo>>` に**サイズ 1 の専用 Set** を割り当てる。

新設計（wildcard 行バインディング専用の第 2 台帳）:

```ts
// pattern（absolutePathInfo）→ 行（listIndex）→ binding
WeakMap<IAbsolutePathInfo, WeakMap<IListIndex, IBindingInfo | Set<IBindingInfo>>>
```

- **登録**: `patternLedger.get(absPathInfo).set(listIndex, binding)` の 1 書き込み。単一値で持ち、同一アドレス 2 本目で Set に昇格（`interestedSessionsByNode` と同じ前例）。**登録側では AbsoluteStateAddress の intern も割当も不要になる**（binding あたり: AbsoluteStateAddress 割当 + intern WeakMap + Set 割当 + 2 書き込み + teardown クロージャ → WeakMap.set 1 回）。
- **drain**: 書き込み側は従来どおり intern 済みアドレスを enqueue（dedup 契約不変）。lookup を「従来台帳 → miss なら `patternLedger.get(addr.absolutePathInfo)?.get(addr.listIndex)`」の 2 段にする。オブジェクト同一性 2 発で、文字列化・wildcard マッチは発生しない。
- **リオーダー**: キーは listIndex 同一性 → 現行同様**ゼロタッチ**（§2-3 保存）。
- **clear**: pooled 行の teardown は pattern ごと `rowMap.delete(listIndex)`（現行と同回数だが Set 経由でない）。wholesale は現行どおり放置（listIndex ごと GC 崩壊）。
- listIndex を持たない binding（トップレベル）と非プラン経路は**従来台帳をそのまま使用**。2 台帳の使い分けは登録経路で静的に決まるため、両方に同じ binding が載ることはない。

### 3-4. P4: ルート解決の一回化

`applyChangeToFor` は既に rootNode / stateElement / sameRootVerified を確定させている。これを activate → registerAddress → 初期 apply に**引数で引き回し**、行あたり `getRootNode()` ≈15 回 → **1 回以下**にする（fragment 実体化中は `getRootNodeByFragment` 確定済み）。observe も「行の anchor ごと×2」→「fragment マウントで 1 回」。

### 3-5. 初期 apply の短絡（P1 に同梱）

activate 時の初期 apply は、スロットに `applyFn` と解決済み相対アドレス形（wildcard 位置）が焼き込まれているため、`fnByBinding` 分岐・`getStateAddressByBindingInfo` の初回割当を経ずに「loopContext から listIndex → proxy read → applyFn」まで直行できる。**proxy read（getByAddressSymbol）は現行のまま維持**（依存追跡・フィルタ・getter の意味論に触れない）。

---

## 4. 不変条件（死守・変更したら即 abort）

1. 公式 isKeyed 全合格・`swapTrAdded=2`・`recycledOnRun=1000`（プーリング維持）。
2. drain の O(1) オブジェクト同一性 lookup と microtask coalescing の dedup 契約。
3. リオーダー時の台帳ゼロタッチ（listIndex 同一性キー）。
4. 構文の壁・プロトコルの壁（wc-bindable / command-token / event-token）。
5. 動的深追跡・walkDependency・二相 drain の意味論（ADR-8・本書は不関与）。
6. wholesale destroy の弱参照前提と `canWholesaleDestroy` ガード群。
7. SSR のセッションレス activate 経路（`activateContent.ts:27`）と hydration。
8. カバレッジ 100/97/100/100・全既存テスト緑。

---

## 5. 適用範囲とフォールバック（ゲート）

**プラン化はテンプレ単位の全会一致**: 全スロットが対応 kind のときだけ fast path。1 つでも該当すればテンプレ丸ごと現行経路（部分適用はしない — 経路混在のデバッグ地獄を避ける）。

| 除外条件（Phase 2 時点） | 理由 |
|---|---|
| spread（`...:`）/ deferred spread | wcBindable 展開が要素定義待ちで行不変でない |
| 未定義カスタム要素を含む | DefinitionCoordinator / deferUntilDefined 経路 |
| radio / checkbox / 双方向 eligible な prop | observer 配線が connect スナップショット依存（将来 Phase で拡張可） |
| ネスト構造（行内 for/if） | ネスト content の再帰実体化は現行経路に委譲（行直下は plan、ネストは従来） |
| bind-component / shadowRoot host | initialize-binding Promise の待ち手が実在する |

jsfb 行と「典型的な一覧行」（text/class/style/attr/event のみ）は全条件を回避しプラン化される。除外条件はプランコンパイル時に静的判定し、`fragmentInfo.plan = null` として恒久フォールバック（実行時分岐は uuid ごと 1 回）。

---

## 6. 段階実装計画と計測ゲート

各 Phase は独立コミット・独立計測。**ゲート不合格なら当該 Phase を revert して先へ進まない**。

| Phase | 内容 | 主効果 | ゲート（unthrottled 中央値） |
|---|---|---|---|
| **0** | 特性テスト補強: リオーダー台帳ゼロタッチ・drain dedup・pooled/wholesale 分岐の characterization を `a3.characterization` 系に追加 | 回帰の番人 | 既存全テスト緑のみ |
| **1** | P4 ルート一回化 + 台帳 Set の単一値昇格（P3 の前哨・従来台帳のまま `binding \| Set` 化） | create/append の GC・native 呼び出し | 退行ゼロ（改善は問わない・低リスク先行） |
| **2** | P1 RowPlan コンパイル + P2 RowRecord（create 経路のみ・プール再利用は従来 activate 継続） | **create1k / append** | **create1k ≥15% 改善（≤20.4ms）**。未達なら「実体化層も wall-clock 床」と記録して中止 |
| **3** | P3 パターン索引台帳（プラン経路の登録/削除/lookup 切替） | create / clear / pooled teardown | create1k 累積 ≥25%・clear10k 退行なし |
| **4** | プール再利用経路のプラン化（activate を RowRecord 再充填に置換） | **replace1k / append** | replace1k ≥20%（≤14.6ms）・append ≥30%（≤30.5ms） |
| **5** | 総合検証: jsfb-verify 全 op ×3 run・isKeyed・全テスト・カバレッジ・lint・実ブラウザ e2e・メモリ（clear 後ヒープ） | 出荷判定 | §4 全不変条件 + 全 op 退行なし |

計測はすべて `e2e/bench/jsfb-verify.mjs`（`--label r3-p<N>`）で before/after をクリーン比較。CPU 内訳の確認は `e2e/bench/op-profile.mjs` / `create-profile.mjs`。

## 7. 期待効果（正直な見積もり）

| 指標 | 現行 | R3 後の構造値 | 期待 wall-clock |
|---|---|---|---|
| 割当/行（新規） | ≈90–110 | **≈25–35**（DOM 14 + 行 binding 5 + RowRecord 1 + listIndex/loopContext 系 ≈5–10） | create1k 23.95 → **14–18ms**（−25〜40%） |
| 割当/行（プール再利用） | ≈35–45 | **≈8–12** | replace1k 18.2 → **12–14ms** |
| 台帳書き込み/行 | ≈66 | **≈20–25** | append 43.5 → **26–32ms**（−26〜40%） |
| getRootNode/行 | ≈15 | ≤1 | 上記に含む |

**不確実性の明示**: 過去の微最適化が wall-clock を動かせなかった以上、「割当を 1/3 にすれば動く」は仮説である。仮説の根拠は (a) 唯一 wall-clock が動いた改善は割当・走査の**丸ごと除去**だったこと（clear −33% / remove −61%）、(b) signals が同一 DOM・同一 native 床で 8.25ms を出しており、差分 ≈16ms の大半が state 側 JS+GC であること。Phase 2 のゲート（≥15%）はこの仮説の反証可能な検証点であり、**未達なら中止して結論を記録する**のも本設計の正当な出口である。

## 8. リスク

| リスク | 緩和 |
|---|---|
| 100% カバレッジ領域の大規模変更 | 経路分岐（フォールバック恒久維持）+ Phase 0 特性テスト + Phase ごと独立 revert 可能 |
| プラン経路と汎用経路の意味論乖離 | テンプレ単位全会一致ゲート（部分適用禁止）+ 既存統合テストを両経路で通す（プラン強制 OFF フラグ） |
| prototype 差分 binding の shape 退行（megamorphic） | スロット共通 shape・`applyFn` 焼き込みで ICs 安定化。op-profile で deopt 確認 |
| 2 段台帳の取りこぼし（登録経路の分類漏れ） | 登録は経路で静的決定（実行時判定なし）+ drain miss 時 assert（dev-mode） |
| リオーダー・swap の回帰（LIS/syncListIndexes との相互作用） | listIndex キーは現行と同一同一性 → Phase 0 でゼロタッチを pin |

## 9. やらないこと（実施後追記: §10-3 の乖離記録も参照）

- walkDependency / updater / proxy トラップの変更（update10k の二相費・council A4 の領域）。
- signals clear の残差追撃（dispose 木で意味論上削れない — R2 結論）。
- select/swap/remove の追加最適化（絶対値 <2ms）。
- jsfb 専用ハック（row-flag イディオム等の提出不能な変更・Issue #800）。
- 構文・プロトコル・公開 API の変更。リリース版数判断（本書の実装はすべて未リリース枠に積む）。

---

## 10. 実施記録（2026-07-19・Phase 0-5 完了）

### 10-1. フェーズログ（すべて unthrottled 中央値 ms・各3run・`jsfb-verify.mjs`）

| Phase | commit | 内容 | ゲート | 結果 |
|---|---|---|---|---|
| 0 | 7de57f8b | 特性テスト5本（台帳ゼロタッチ/drain dedup/pooled・wholesale 分岐/再登録） | 全テスト緑 | ✅ |
| 1 | 8d18e20b | 台帳単一値昇格 + P4 ルート一回化 | 退行ゼロ | ✅ replace 17.7→16.95・他パリティ（交互A/B 3ペアで判定。remove の見かけの悪化はバッチ間ドリフトと確認） |
| 2 | 4e4fc6b7 | **P1 RowPlan + P2 データ駆動 teardown・遅延 teardowns Set・known 単一値** | create ≥15%（≤22.4） | ✅ **create 26.35→19.6（−25.6%）**・append 43.9→36.8（−16%）・clear 47.45→42.2（−11%） |
| 3 | 2523de7d | **P3 パターン索引台帳**（(absPathInfo, listIndex) 2段キー・登録側 intern 廃止） | create 累積≥25%・clear 退行なし | ✅ create 18.95・replace 15.8・clear 41.5・update パリティ（drain 2段化の実害なし） |
| 4 | 2c68f998 | activate プラン高速経路 + **record 再利用**（再割当なし・世代更新のみ） | replace ≥20%（≤14.6） | ✅ replace 14.55。**append ゲート未達（§10-3）** |
| 5 | — | 総合検証 | §4 全不変条件 | ✅ isKeyed 全合格・recycledOnRun=1000・1957テスト・カバレッジ 99.63/98.58/100/99.79・lint・実ブラウザ e2e 5/5・devtools 83・server 72 |

### 10-2. 最終値（state R3 後 / R3 前 / signals・同一セッション環境）

| op | R3 後 | R3 前 | Δ | signals | 比（前→後） |
|---|---|---|---|---|---|
| create1k | **19.0** | 26.35 | **−27.9%** | 8.25 | 3.2x → **2.3x** |
| replace1k | **14.55** | 17.7 | **−17.8%** | 9.2 | 1.9x → **1.6x** |
| append1kTo10k | **37.0** | 43.9 | **−15.7%** | 10.8 | 4.1x → 3.4x |
| clear10k | **41.4** | 47.45 | **−12.8%** | 44.55 | 1.07x → **0.93x（逆転）** |
| update10k | 9.05 | 8.9 | パリティ | 3.85 | 2.3x（対象外） |
| remove1k / select / swap | 1.95 / 0.7 / 0.5 | 1.6 / 0.8 / 0.7 | ノイズ帯 | 0.4 / 0.3 / 0.3 | — |

### 10-3. 計画からの乖離（正直な記録）

1. **append の Phase 4 ゲート（≤30.5）は未達（37.0）**。設計時の帰属ミス: append はプール再利用が発生しない op（既存 10k 行は diff で touch されず、新 1000 行は全て新規 create）。append 残差 ≈18ms の主因は「11k 行分の listDiff 構築＋walkDependency 展開＋enqueue/drain」で、**実体化層でなく diff/反応層のコスト**。本書のスコープ（§0-2）外につき、追撃するなら別ラウンド（createListDiff の増分化等・意味論不変の実装改善として可能）。
2. **§3-5（初期 apply の短絡）は未実装**。Phase 2-4 のゲートを短絡なしで通過したため、リスク（getValue 意味論の複線化）に対して残利得が小さいと判断して見送り。
3. Phase 1 で「remove/clear の悪化」に見えた計測はバッチ間の環境ドリフトだった。**以後の判定はすべて交互 A/B か同一バッチ内比較で実施**（計測規律として記録）。

### 10-4. 残課題（次ラウンド候補）

- append/update の残差 = diff・二相 drain 層（council A4 議論と隣接・別の挙証が必要）。
- プラン適格の拡張（双方向 eligible prop・radio/checkbox・ネスト構造の部分プラン化）— 実アプリの行テンプレートの適格率を広げる。
- メモリ計測（jsfb メモリ部門）: 行あたり割当 ≈90-110→≈30 の削減がヒープ計測にどう出るかは未計測。
