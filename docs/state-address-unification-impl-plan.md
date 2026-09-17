# 実装計画: アドレス型の統合（@wcstack/state）

- **状態**: 計画（2026-09-18）。**未着手**。**ゲートは全て決着済み**（2026-09-18・§2）— 案 A を進める。残る未確定は Spike S の実測で決まる intern の置き場所（G6）だけで、その判定規則（§5-2）は合意済み。Phase 0 から着手できる。
- **ブランチ**: Phase ごとに 1 本（§1 の表）。
- **設計検討**: [state-address-unification-design.md](./state-address-unification-design.md)（以下「設計書」）。`設計書 §n`・`Dn`・`I1`/`I2`・`C1`/`C2`・`P1`〜`P3` は設計書の番号。本書の節は単に `§n` と書く。
- **到達点**: `IAbsoluteStateAddress` と lift / downgrade の往復が消え、`IStateAddress` が `stateElement` を持つ 1 本になる。proxy・updater・依存グラフ・drain の契約は不変（C1）。素のパスの読みと行バインディング登録が退行しない（P1）。`<wcs-state>` が GC から隠れない（I2）。同じ配列を持つ 2 ツリーが混線しない（I1）。旧 devtools × 新 state、新 devtools × 旧 state のどちらも壊れない（D7）。
- **基準コミット**: main `9be7fe3c`。本書の箇所数・行番号はすべてこの時点の実測。

## 1. 全体像

| Phase | PR | ブランチ | 内容 | 振る舞い | 着手の条件 | 規模 |
|---|---|---|---|---|---|---|
| **0** | ⓪ | `test/state-address-guard-and-baseline` | 番人（案 E）・基準試験・ベンチ項目 | 不変（`src/` 変更ゼロ） | なし（**着手可**） | 新規 5 ファイル前後 |
| **S** | なし（捨てブランチ） | `spike/state-address-intern-placement` | (a2) と (b) を実測して G6 を決める | — | Phase 0 のベンチ | intern だけの最小パッチ × 2 |
| **1** | ① | `refactor/state-address-tree-path` | lift の 1 関数化・`ITreePath` へ改名 | 不変 | Phase 0 | src 約 20 ファイル・機械的 |
| **2** | ② | `refactor/state-address-unification` | 統合本体・devtools 両読み・docs | 内部の同一性だけ変わる（§7-0） | Phase 1 ＋ Spike S の結果（G6） | src 約 45 ファイル・テスト 50+ ファイル |
| **3** | ③ | `chore/state-address-compat-removal` | 互換 getter 撤去・版印 3 | 破壊的 | 次の major（G5） | 小 |

依存: `0 → (S ∥ 1) → 2 → 3`。S と 1 は互いに独立なので並行できる。案 A から降りる出口は 1 つだけ残っている — **Spike S で (a2) も素のパスの読みを退行させたら、着手を止めて設計へ戻す**（§5-2 の 5）。その場合でも Phase 0 は案 D ＋ E（設計書 §6-3）の恒久策として残る。

## 2. ゲートと決定（2026-09-18・著者決定）

全て決着した。G7 とリリース粒度は設計書に無く、本書で足した論点。

| # | 論点 | 塞いでいた Phase | **決定** |
|---|---|---|---|
| **G1** | 優先順位（設計書 §10-1） | S・1・2・3 | **P1 > P2 > P3**。案 A を進める |
| **G2** | `IResolvedAddress` を畳むか（§10-2） | なし | **範囲外**。設計書 §10 に未決として残すだけで、Issue も切らない |
| **G3** | `Absolute` の改名先（§10-3） | 1 | **`ITreePath`** / `TreePath.ts` / `getTreePath`。設計書の第一候補 `IScopedPath` は採らない — state の `src/` では `scope` が**マウントスコープ**の語として定着しており（`scopeRoot`・`getScopedIndexes`・`mountScope` ほか識別子で 150 回以上）、「マウントスコープ内のパス」と読まれる。`Tree` は `translateTreePath`（ツリーの絶対パスへ翻訳）と同じ意味で、設計書の「パス × ツリー」をそのまま名にできる |
| **G4** | D5 の assert の範囲（§10-4） | 2（C4） | 出荷物は **`config.debug` 時のみ**。**テストスイートでは常時 ON**（`__tests__/setup.ts` で専用フラグ）— 取り違えの炙り出しを出荷コスト無しで得る |
| **G5** | 互換 getter の撤去時期（§10-5） | 3 | **次の major** |
| **G6** | intern の表の置き場所（§10-6） | 2（C1b） | **§5-2 の規則で実測して決める**。規則は合意済みで、測ったあとに動かさない |
| **G7** | `*AbsoluteStateAddress*` を名に含むファイル・関数の改名 | なし | **PR ② の後に別 PR ②-b**（§7-3）。devtools payload のフィールド名 `absoluteAddress` はプロトコルの一部なので**永久に改名しない** |
| **—** | PR ② のリリース粒度 | なし | **minor・state と devtools を同時**（§11） |

## 3. 計画時の実測 — 設計書との差分

設計書の数値は main で測り直して一致を確認した: lift 21（`createAbsoluteStateAddress`）・`getAbsolutePathInfo` 19・downgrade 11 ＋ 9・`createStateAddress` 31 箇所 / 18 ファイル・テスト 17 ファイル / 123 箇所・絶対型に触れるテスト 50 / 302 本・`stateElement` を自前で作るテスト約 63 本。

そのうえで、計画を変える事実が 9 つあった。**Phase 0 で設計書に反映する**（§4-5）。

| # | 事実 | 計画への影響 |
|---|---|---|
| **F1** | state のカバレッジ閾値は設計書 §9 の 100/97/100/100 ではなく **99.5 / 98.5 / 100 / 99.5**（[vitest.config.ts](../packages/state/vitest.config.ts)） | 受け入れ条件は実際の閾値で書く。branches 98.5% は余裕が薄いので、分岐を足すコミット（C1b・C4）ごとに `test:coverage` を回す |
| **F2** | [rowLanding.ts](../packages/state/src/watch/rowLanding.ts) の `placementOf` は**引数を足さなくてよい**。`row.absAddress` が要素を運んでいる | 設計書 §4-6 の「引数の追加が要る 4 箇所 3 関数」は、引数追加＝`getStateAddressByBindingInfo` の 1 関数、順序入れ替え＝`hydrateBlocks`、`placementOf` は行から取る、に縮む |
| **F3** | `parentAbsoluteAddress` / `parentAbsolutePathInfo` の読み手は `src/address/` の外に**ゼロ** | 設計書 §5-2 は「1 本にまとまる」だが、実際は絶対側の親連鎖が死にコード。`AbsolutePathInfo` のコンストラクタが親連鎖を**先行生成**している分（パス 1 本につき祖先ぶんの割当）も Phase 2 で落とせる |
| **F4** | state の vitest には GC を強制する手段が無い（`global.gc` の使用例ゼロ・`--expose-gc` 設定なし）。リポジトリの既存手段は CDP の `HeapProfiler.collectGarbage`（[memory-profile.mjs](../e2e/bench/memory-profile.mjs)） | GC 回帰は **Playwright spec** で書く（§4-3）。e2e の CI は src が dist より新しいパッケージをビルドしてから走るので、spec は新しいコードを見る |
| **F5** | 互換 getter `get absolutePathInfo() { return this }` の戻り値は**アドレス自身**で、`TreePath` ではない | **`patternLedger` のキーに使えない**。[getBindingSetByAbsoluteStateAddress.ts:136](../packages/state/src/binding/getBindingSetByAbsoluteStateAddress.ts#L136) を同じコミットで内部フィールドへ切り替える。忘れると行バインディングの更新が**例外なしで全滅**する（§7-1 の C2） |
| **F6** | Phase 1 で改名できるのは型・ファイル・関数まで。**プロパティ名 `absolutePathInfo` は改名できない**（devtools が `absoluteAddress.absolutePathInfo.pathInfo.path` を読む＝プロトコル面） | Phase 1 の「振る舞い不変」は、このプロパティ名を残すことで守る |
| **F7** | [docs/README.md](./README.md) の規則 4: 消えたファイルへの参照は**コミットのパーマリンク**にする。対象の相対リンクは 3 本（設計書 §7-1・`devtools-hook-protocol.md:326`・同 `.ja.md:318`、いずれも `AbsoluteStateAddress.ts#L5`） | Phase 2 の docs コミットで処理する。`AbsolutePathInfo.ts` への相対リンクは docs に無いので Phase 1 では不要 |
| **F8** | [prevValues.ts](../packages/state/src/watch/prevValues.ts) の台帳は**強参照の `Map`**（drain 終端でクリア） | 保持関係は今日と同じで変更不要。ただし GC 試験は **drain が終わってから**観測する |
| **F9** | 「素の Node の SSR スモーク」に当たるのは root e2e の `ssr-router.spec.ts`（`serve.mjs` が素の Node で `packages/server/dist` を通して描画する）。`packages/server` の `test:e2e` は happy-dom 上の vitest で、素の Node ではない | Phase 2 の受け入れ条件は前者を指す |

## 4. Phase 0 — 番人と基準試験（PR ⓪）

**目的**: 案 A を採るかどうかに関係なく価値が残るものを先に入れ、Phase 2 の受け入れ条件になる試験を**現行実装に対して**通して基準を取る。`src/` は触らない。

### 4-1. 番人（案 E）

- [ ] `__tests__/addressLedgerKeyGuard.test.ts` を新設。`src/**/*.ts` を読み、**モジュール直下**（行頭の `const` / `let` / `export const`）の `WeakMap` / `Map` / `WeakSet` / `Set` 宣言で、型引数が `IStateAddress` または `ILoopContext` で始まるものを失敗にする。前例は `__tests__/tagNameMap.test.ts`。
- [ ] 宣言が複数行にまたがる綴りも拾う（行単位ではなく、宣言の開始から `=` までを 1 単位に見る）。
- [ ] 許可リストは 1 件: [getListIndexByBindingInfo.ts:7](../packages/state/src/list/getListIndexByBindingInfo.ts#L7)。理由（内側キー `IBindingInfo` がツリー単位）をテスト内に書く。
- [ ] **番人自身の試験**: 禁止する綴りを含む文字列を走査関数に渡し、検出されることを確認する。発火しない番人は無いのと同じ。

### 4-2. クロスツリーの基準試験

`__tests__/integration.crossTreeAddress.test.ts` を新設。独立した ShadowRoot に `<wcs-state>` を 1 つずつ持つコンポーネントを 2 つ並べる。

- [ ] **同じパス形状**: 両ツリーが同名のルート配列を持つ。片方の構造変更・行の書き込みが、もう片方の baseline・cache・bindings・描画に触れない。
- [ ] **同じ配列インスタンス**: 両ツリーの初期値に同一の配列を渡して `for` で描画する。片方の行への書き込みが、もう片方の台帳と描画に触れない。
- [ ] **前提の固定**（characterization）: 同じ配列インスタンスのとき、両ツリーの 1 行目の `ListIndex` が同一オブジェクトで、`createStateAddress` の戻り値も同一オブジェクトであること。設計書 §3-1 の実測をテストに落とす。**Phase 2 の C1b で「アドレスは別オブジェクト」に反転させる唯一の期待値**（`ListIndex` の共有は反転しない）。

どれも現行で通るはず（今日は `IAbsolutePathInfo` が分けている）。**通らなければ既存欠陥**なので、Issue を切って本計画とは別に扱う。

### 4-3. GC の基準試験

`e2e/tests/state-address-gc.spec.ts` ＋ `e2e/fixtures/state-address-gc.html`。Chromium 専用プロジェクトなので `page.context().newCDPSession(page)` が使える。

手順: ページ内で `<wcs-state>` を持つホストを接続 → 素のパス・getter・行付きパスを読ませて intern を作る → `WeakRef` を取る → ホストを外して参照を捨てる → **drain の完了を待つ**（F8）→ `HeapProfiler.collectGarbage` を 2 回 → `deref()` が `undefined` であること。

- [ ] 単一ツリー・null 行の読みだけ（設計書 §5-3 の I2 が直接効く形）
- [ ] 単一ツリー・行付き
- [ ] **行を共有する 2 ツリーの片方だけを破棄**。破棄した側が回収され、残った側が引き続き正しく描画・更新される
- [ ] 対照: 参照を握ったままなら回収**されない**こと（試験が GC を本当に観測している証明）

**基準が main で赤だった場合**: intern と無関係な保持源（`liveStateElements`・イベント台帳・devtools など）がある。`Runtime.queryObjects` かヒープスナップショットで保持経路を特定し、既存リークなら Issue 化する。その間は、この spec を Phase 2 の受け入れ条件に使えない — 代わりに intern の表の形を見る white-box 試験（表の根が `stateElement` を弱キーにしているか、要素が所有しているか）を vitest 側に置く。

### 4-4. ベンチ項目「読み」

既存のベンチ（append / clear / create・深さ方向）は設計書 §5-5 の表の 1 行目を測れない。

- [ ] `packages/state/__e2e__/benchmark-read/index.html` ＋ `e2e/bench/plain-read.mjs` を新設。state のメソッド内で N 回読む。
  - **R1** 素のパス（ワイルドカードも getter も無い・`isCacheable` が偽）— 設計書 §5-5 の 1 行目
  - **R2** getter（キャッシュを引く読み・null 行）
  - **R3** ループ文脈の中の行付きパス（キャッシュを引く読み・行付き）
- [ ] 出力は ns/読みの中央値。結果は `e2e/bench-results/address-unification-*.json`（既存の置き場）。
- [ ] `--bundle <path>` でバンドルを差し替えられるようにする。**tracked な `packages/state/dist` を書き換えずに**、main / (a2) / (b) の 3 本を並べて測るため（§12 の罠 1）。
- [ ] main に対して R1〜R3 と既存ベンチ（`jsfb-verify` / `list-component` / `create-cost` / `clear-cost` / `append-accumulation`）を流し、基準値を記録する。

### 4-5. 設計書の同期

- [ ] §3 の F1〜F9 を設計書に反映する（§9 の閾値、§4-6 の 4 箇所 3 関数、§5-2 の親連鎖、§9 の GC 手段と SSR スモークの指す先）。

**完了条件**: `src/` の差分ゼロ。`npm test`・`npm run test:coverage`（99.5/98.5/100/99.5）・`npm run lint`・e2e が緑。基準値が JSON で残っている。

## 5. Spike S — intern の置き場所を測る（マージしない）

### 5-1. 最小パッチ

統合本体を書かずに R1 の実コストを測る。Phase 0 のブランチから捨てブランチを切り、**`createStateAddress` に省略可能な第 3 引数 `stateElement?` を足す**。渡すのは [traps/get.ts:220](../packages/state/src/proxy/traps/get.ts#L220)（`handler.stateElement` が手元にある）と、R2・R3 が通る経路だけ。要素が渡されたときだけ新しい intern を通す。型も台帳も触らない。

- 変種 **(b)**: `src/address/` に `WeakMap<IStateElement, Map<IPathInfo, TreePath>>`。`TreePath` が `nullRowAddress` / `rowAddresses` を持つ（設計書 §5-4）。
- 変種 **(a2)**: 同じ `Map<IPathInfo, TreePath>` を要素の symbol キーのプロパティに置く。`State` クラスは**フィールドとして宣言**する（後付けのプロパティ追加は要素の hidden class を変える）。モックには初回に遅延生成。

**やってはいけない最適化**: (b) の外側の引きを「直前の要素」のモジュール変数メモで省くこと。モジュール変数は要素を強参照で掴むので **I2 違反**（最後に触ったツリーが回収されなくなる）。`WeakRef` にすると `deref()` のコストで意味が無くなる。

### 5-2. 判定規則（測る前に固定する）

1. main 同士を 2 セッション測り、R1 の中央値の差を**ノイズ床**とする。
2. main・(a2)・(b) を**交互に** 10 回以上測る（順序固定だと熱ドリフトが片側に乗る）。条件（スロットル・件数）は 3 本で同一。
3. `R1(b) − R1(main)` がノイズ床以内 → **(b)**（P3 で最も安い。約 63 本のモックに手が入らない）。
4. 超える → **(a2)**。P1 > P3 なので、差分の小ささは理由にしない。
5. **(a2) もノイズ床を超える → 着手を止めて設計へ戻す**。案 A そのものが P1 を破っている。
6. R2・R3 は設計書 §5-5 の見積もり（3〜4 段の減少）の確認用。悪化していたら見積もりが誤りなので、原因を特定するまで進めない。

**成果物**: 測定 JSON と、設計書 §5-5・§10-6 への結果の追記（G6 の決着）。ブランチは捨てる。

## 6. Phase 1 — 内部化と改名（PR ①・振る舞い不変）

### 6-A. lift の 1 関数化

`src/address/` に 2 つ置く。

```ts
export function absoluteAddressOf(stateElement: IStateElement, pathInfo: IPathInfo, listIndex: IListIndex | null): IAbsoluteStateAddress;
export function liftAddress(stateElement: IStateElement, address: IStateAddress): IAbsoluteStateAddress;  // = absoluteAddressOf(el, a.pathInfo, a.listIndex)
```

`absoluteAddressOf` が要るのは、`IStateAddress` を経ずに `(要素, pathInfo, listIndex)` から直接作る箇所があるため（`generation.ts:113`・`setByAddress.ts:320`・`watchRuntime.ts:123`・`getAbsoluteStateAddressByBinding.ts:49`）。

| ファイル | lift 箇所 |
|---|---|
| `proxy/methods/setByAddress.ts` | 6（:117 / :306 / :320–330 / :351 / :524 / :593） |
| `proxy/apis/postUpdate.ts` | 2（:27 / :42） |
| `dependency/walkDependency.ts` | 2（:61 / :285） |
| `proxy/methods/getByAddress.ts` | 1（:172 — 最ホット） |
| `proxy/apis/wildcardIndexes.ts`・`recursion/walk.ts`・`recursion/generation.ts`・`stream/argsTrace.ts`・`apply/reapplyStateBindings.ts`・`watch/watchRuntime.ts`・`binding/getAbsoluteStateAddressByBinding.ts` | 各 1 |
| `bindings/BindingSession.ts:1036` | **lift ではない**（`patternLedger` の登録）。`getTreePath` の直接呼びとして残す |

- [ ] 上の 18 箇所を `liftAddress` / `absoluteAddressOf` に置き換える（`createAbsoluteStateAddress` の呼びで数えると 19 — `setByAddress.ts:320` が 1 つの `absPathInfo` から 2 本作る。設計書の「21」の残り 2 つは `patternLedger` の devtools sink（`getBindingSetByAbsoluteStateAddress.ts:98` / `:117`）で、`TreePath` を直接受けるので残す）。`generation.ts` と `setByAddress.ts:320` は今日 `absPathInfo` をループの外に巻き上げているが、どちらもコールドパス（再帰の実体化・スワップ）なので毎回引く形にしてよい。
- [ ] 2 行にまたがる置換になる。**CRLF のファイルに対する perl の複数行置換は空振りする**（§12 の罠 3）ので、Edit で 1 箇所ずつか、TS の AST を使う。

### 6-B. 改名（G3）

- [ ] `IAbsolutePathInfo` → `ITreePath`、`AbsolutePathInfo.ts` → `TreePath.ts`（`git mv`）、`getAbsolutePathInfo` → `getTreePath`。
- [ ] **プロパティ名 `absolutePathInfo` / `parentAbsolutePathInfo` は変えない**（F6）。
- [ ] 境界の番人を足す（§4-1 と同じ走査の仕組み）: `getTreePath` を import してよいのは `src/address/**`・`binding/getBindingSetByAbsoluteStateAddress.ts`・`bindings/BindingSession.ts` だけ。`createAbsoluteStateAddress` は `src/address/**` と `patternLedger` のファイル（devtools sink の 2 箇所）だけ。
- [ ] テストは名前の追随のみ。**期待値を 1 つも変えない**。

**完了条件**: 差分が「呼び出しの畳み込み」と「名前」だけで読める。全テスト・カバレッジ・lint・e2e が緑。R1〜R3 と `jsfb-verify` を main と並べて測り、退行なし（lift の関数化は呼び出し 1 段ぶんのコストを足しうる — インライン化されるはずだが、**片側だけ測った主張は採らない**）。

## 7. Phase 2 — 統合と lift 削除（PR ②）

### 7-0. 変わるもの・変わらないもの

外から観測できる振る舞いは変わらない。変わるのは内部の同一性が 2 つ。

- 同じ配列を持つ 2 ツリーで、`createStateAddress` の戻り値が**ツリーごとに別オブジェクト**になる（§4-2 の反転）。
- 同じ形で、`ILoopContext` も**ツリーごとに別オブジェクト**になる（設計書 §5-1）。着手時に、ループ文脈を**同一性で比較・キーにしている箇所**を洗う（`=== loopContext`・`WeakMap<ILoopContext, …>`）。§4-1 の許可リストの台帳は、キーが要素を含むようになって安全側に動く。

### 7-1. コミット列

各コミットで全テストが緑であること。**意味が変わるのは C1b と C2 だけ**で、他は機械的。

**C1a — `createStateAddress` のシグネチャ変更（機械的・巨大）**
`createStateAddress(stateElement, pathInfo, listIndex)`。intern はまだ要素を**使わない**（引数は `_stateElement`）。振る舞い不変なので、**テストの期待値を 1 つも変えずに緑**になることがこのコミットの検証になる。

- [ ] `src/` 31 箇所。27 箇所は手元の `handler.stateElement` / `context.stateElement` を渡す。ただし「どの要素か」は箇所ごとに確認する — 規則は**そのアドレスを消費する proxy の要素**。判断が要るのは [overlay.ts](../packages/state/src/webComponent/overlay.ts)（:80 / :248 / :262 — 親子のツリーをまたぐ）・[event/handler.ts:69](../packages/state/src/event/handler.ts#L69)・`recursion/walk.ts`。取り違えは C4 の assert が捕まえる。
- [ ] `getStateAddressByBindingInfo(binding, stateElement)`（D12）。呼び出し元の鎖は `getValue(state, binding)` ← [applyChange.ts:94](../packages/state/src/apply/applyChange.ts#L94)（`context.stateElement`）と [initialSync.ts:142](../packages/state/src/bindings/initialSync.ts#L142)。
- [ ] [hydrateBindings.ts:226](../packages/state/src/hydrateBindings.ts#L226) — 要素の解決（今は :271）をアドレス生成より前へ。
- [ ] `rowLanding.placementOf` — `row.absAddress` から取る（F2）。
- [ ] テスト 17 ファイル・123 箇所。要素のモックが既にスコープにあるテストはそれを渡す。無いテスト（`StateAddress.test.ts` など）のために `__tests__/helpers/addressTestUtils.ts` に共有のモック要素を 1 つ置く。

**C1b — intern の組み替え（意味が変わる・小さい）**

- [ ] `IStateAddress` に `stateElement` を追加。`StateAddress` は内部に `TreePath` への参照を持つ。
- [ ] intern を `TreePath` 経由にする（`nullRowAddress` / `rowAddresses`）。表の置き場所は G6 の結果。**旧 `_cache` / `_cacheNullListIndex`（不滅の `PathInfo` がキー）を残さない**（I2）。行付きも要素の段を通す（I1・D11）。
- [ ] `parentAddress` を 1 実装にする。`TreePath` の親連鎖の先行生成をやめる（F3）。
- [ ] §4-2 の characterization を反転させる。§4-3 の GC spec と §4-2 の残りが緑のままであること。
- [ ] `test:coverage` を回す（F1）。

**C2 — エイリアス化（意味が変わる・小さい）**

- [ ] `type IAbsoluteStateAddress = IStateAddress`。`liftAddress` は恒等、`absoluteAddressOf` は `createStateAddress` の別名。`createAbsoluteStateAddress(scopedPath, listIndex)` は `TreePath` の表から統合後のアドレスを返す。
- [ ] deprecated な `get absolutePathInfo()`（`this` を返す・設計書 §7-1）を生やす。
- [ ] **同じコミットで** `patternLedger` の引き（`:136`）を内部の `TreePath` フィールドへ切り替える（F5）。
- [ ] ここが設計書 §8 の「全台帳が正しく動くことをテストで確認」の地点。全テスト ＋ e2e ＋ §4 の 3 種。

**C3 — 機械的削除**

- [ ] `liftAddress(…)` / `absoluteAddressOf(…)` の呼びを消す。`.absolutePathInfo.pathInfo` → `.pathInfo`（11）、`.absolutePathInfo.stateElement` → `.stateElement`（9）。型名 `IAbsoluteStateAddress` → `IStateAddress`（29 ファイル）。`AbsoluteStateAddress.ts` を削除。
- [ ] `getAbsoluteStateAddressByBinding` と `getStateAddressByBindingInfo` を 1 本にする（D12）: 要素を受ける本体 ＋ root から要素を解決して本体を呼ぶ薄い入口（今日の 8 呼び出し元用）。**キャッシュは 1 つにし、今日の 2 つの clear 関数が呼ばれている箇所の和集合でクリアする**。
- [ ] 設計書 §4-5 の二重キー（`computedSnapshots`・`updatedAbsAddressSetByStateElement`）は**触らない**。走査の都合で分けているもので、本計画の範囲外。

**C4 — D5 の assert（G4）**

- [ ] `getByAddress` / `setByAddress` / `hasByAddress` の入口に `address.stateElement === handler.stateElement`。出荷物は `config.debug` 時のみ、テストスイートは常時 ON。
- [ ] 別ツリーのアドレスを渡すと debug で raise すること、off では今日と同じく黙って通ること（characterization）をテストで固定。
- [ ] 常時 ON で全スイートを流して発火ゼロ。発火したら C1a の要素の選び方が誤り。

**C5 — devtools の両読み**

- [ ] [protocol/types.ts](../packages/devtools/src/protocol/types.ts) のミラー型を新旧両形に。[DevtoolsCore.ts](../packages/devtools/src/core/DevtoolsCore.ts) の 4 箇所（:647 / :719 / :726 / :763）を `address.pathInfo ?? address.absolutePathInfo.pathInfo` 形のヘルパー 1 つに集約（`stateElement` も同様）。
- [ ] 旧形の payload を流すテストは**残す**（新 devtools × 旧 state の回帰）。新形のテストを足し、roster / wiring / timeline が同じになることを確認。
- [ ] `DEVTOOLS_PROTOCOL_VERSION` は**据え置き**（追加的変更・設計書 §7-1）。

**C6 — docs**

- [ ] README internals（[README.md:2969](../packages/state/README.md#L2969)・`README.ja.md:2961`）を 3 本の説明に。`packages/state/CLAUDE.md` の Directory Structure（:37）と Address System 節。
- [ ] `devtools-hook-protocol.md` / `.ja.md` の §4.2〜§4.4・§5。`AbsoluteStateAddress.ts#L5` への相対リンク 3 本をパーマリンクへ（F7）。
- [ ] 設計書の状態を「採択・実装済み」に。本書の状態を更新。

**C7 — 番人の整理**

- [ ] §4-1 の番人は対象の型が無くなるので削除。§6-B の import 境界の番人は残す（`getTreePath` を `src/address/` と `patternLedger` に閉じる不変条件は統合後も有効）。

### 7-2. 受け入れ条件

§9 の表の全行。加えて、差分レビューで「C1a と C3 は機械的」「C1b と C2 だけを精読すればよい」と読める形になっていること。

### 7-3. PR ②-b — 名前の追随（G7）

`*ByAbsoluteStateAddress` を名に含む 4 ファイル（`getBindingSetByAbsoluteStateAddress.ts`・`getAbsoluteStateAddressByBinding.ts`・`cacheEntryByAbsoluteStateAddress.ts`・`lastListValueByAbsoluteStateAddress.ts`）と関数名の改名。`git mv` と識別子置換だけ、ロジックの差分ゼロ。`devtools-hook-protocol.md:273` が旧ファイル名にリンクしているので同時に直す。

## 8. Phase 3 — 互換面の撤去（PR ③・次の major）

- [ ] deprecated な `absolutePathInfo` getter を削除。
- [ ] `DEVTOOLS_PROTOCOL_VERSION` を 3 へ — state（[devtools/types.ts:19](../packages/state/src/devtools/types.ts#L19)）と devtools（[protocol/types.ts:16](../packages/devtools/src/protocol/types.ts#L16)）の両方。protocol doc の英日両方。
- [ ] devtools の両読みは**消さない**（旧 state 2.x を見に行ける間）。
- [ ] リリースノートに明記する: 旧 devtools をピン留めしたページは、この版の state で**検査対象アプリごと例外を受ける**（registry の配送にも `DevtoolsCore.onEvent` にも try/catch が無い — 設計書 §7-1）。

## 9. 検証マトリクス

| 項目 | 手段 | Phase 0（main） | Phase 1 | Phase 2 |
|---|---|---|---|---|
| 単体・統合 | `npm test`（state・devtools） | 緑 | 緑・期待値の変更ゼロ | 緑・反転は §4-2 の 1 件のみ |
| カバレッジ | `npm run test:coverage`（99.5 / 98.5 / 100 / 99.5） | 緑 | 緑 | 緑（C1b・C4 の後に個別に確認） |
| lint | `npm run lint` | 緑 | 緑 | 緑 |
| クロスツリー（同じ形状・同じ配列） | §4-2 | **基準を取る** | 緑 | 緑（落ちたら I1 違反） |
| GC（単一・行付き・片側破棄） | §4-3 | **基準を取る** | 緑 | 緑（落ちたら I2 違反）＝ **PR ② の受け入れ条件** |
| 読みの性能 R1〜R3 | §4-4 | **基準を取る** | main と並べて退行なし | main と並べて R1 がノイズ床以内、R2・R3 は改善 |
| リスト性能 | `jsfb-verify`・`list-component`・`create-cost`・`clear-cost`・`append-accumulation` | 基準 | 退行なし | 退行なし |
| D5 の assert | 常時 ON で全スイート | — | — | 発火ゼロ |
| devtools 互換 | 旧形・新形の payload を `DevtoolsCore` へ／state の getter 経由の旧経路／`e2e/devtools-smoke.mjs` | — | — | 緑 |
| SSR | root e2e の `ssr-router.spec.ts`（F9） | 緑 | 緑 | 緑 |
| 下流 | CI の vscode-wcs・lint・typescript ジョブ（state を再ビルドして走る） | — | 緑 | 緑 |

性能は**必ず main と branch の両方を同じセッションで測る**。片側だけの数字は採らない。

## 10. リスクと巻き戻し

| # | リスク | 兆候 | 手当て |
|---|---|---|---|
| R1 | I1 違反（行付き intern から要素の段が落ちる） | debug off では**無症状**。別ツリーの台帳を黙って読み書きする | §4-2 の同じ配列インスタンスの試験 ＋ C4 の assert を常時 ON にした全スイート |
| R2 | I2 違反（不滅のキーから要素へ強参照） | 無症状。メモリだけが増える | §4-3 の GC spec。Spike での「直前の要素」メモも同類（§5-1） |
| R3 | `patternLedger` のキー取り違え（F5） | 行バインディングの更新が例外なしで止まる | C2 で同時に切り替える。リスト描画の既存テストが捕まえる |
| R4 | 素のパスの読みの退行 | R1 の悪化 | §5-2 の判定規則を測る前に固定。(a2) でも駄目なら設計へ戻す |
| R5 | assert の誤発火（overlay・bind-component の親子またぎ） | C4 で既存テストが赤 | C1a の要素の選び方を見直す。assert を緩めない |
| R6 | ループ文脈の同一性に依存したコード（§7-0） | 2 ツリーが配列を共有する形でのみ発現 | 着手時に洗い出し、§4-2 に描画の検証を入れておく |
| R7 | (a2) の遅延生成が凍結されたモックで throw | テストだけが赤 | 共有モック（§7-1 C1a）へ寄せる |

**巻き戻し**: ⓪ と ① は振る舞い不変なので、② を revert すれば統合前に戻る。② の中では C2 が「全台帳が新しい型で動く」最初の地点なので、C3 以降に問題が出ても C2 までは保てる。③ は独立に revert できる。

## 11. リリースと追随先

- ⓪・① はリリース不要（テストと内部リファクタ）。次のリリースに相乗りでよい。
- ② は **state と devtools を同じリリースで出す**（devtools の両読みが同時に届く必要がある — 設計書 §7-1 の方針 2）。payload への `pathInfo` / `stateElement` の追加は追加的変更なので **minor**。全パッケージの版を揃える運用は従来どおり。
- ③ は次の major。
- 追随不要: wcstack-skill（オーサリング面に変化なし）・vscode-wcs（`parser` エントリ経由）・`@wcstack/server`（検証のみ）。

## 12. 作業環境の罠

1. **`packages/state/dist` は tracked**。`npm run build` も lint も上書きする。ベンチのためにビルドしたら**コミット前に戻す**（dist をコミットするのはリリース時だけ）。§4-4 の `--bundle` はこのためにある。
2. **作業ツリーを別セッションと共有していることがある**。挙動の確認は scratchpad に `--root` を向けた vitest プローブで行い、tracked なテストに一時コードを足さない。main と branch の src を並べてコピーすれば、同じプローブで両方を測れる。
3. **CRLF のファイルに対する perl の複数行置換は空振りする**。lift の 2 行パターン（§6-A）と C3 の置換はこれに当たる。
4. **サブエージェントに差分レビューを任せると src を revert されたことがある**。レビューは読み取り専用の指示で出す。
5. branches 98.5% の閾値は余裕が薄い。assert や分岐を足したコミットは単独で `test:coverage` を回す。
