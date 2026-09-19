# 実装計画: アドレス型の統合（@wcstack/state）

- **状態**: **完了（案 A は閉じた — 2026-09-20・著者決定・設計書 §12）**。Phase 0・Phase 1 は main 着地（PR #291・#292）。Spike S（§5-3）と追試 E1（§5-4）はどちらも規則で不成立。**Phase 2・Phase 3 は実施しない**。残作業は `TreePath` の引き方の最適化（main-tp）を統合と切り離して単独で着地させること（設計書 §12-2）。
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
| **2** | ② | `refactor/state-address-unification` | 統合本体・devtools 両読み・docs | 内部の同一性だけ変わる（§7-0） | **中止**（案 A を閉じた — 設計書 §12） | — |
| **3** | ③ | `chore/state-address-compat-removal` | 互換 getter 撤去・版印 3 | 破壊的 | **中止**（同上） | — |

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
| **G6** | intern の表の置き場所（§10-6） | 2（C1b） | **§5-2 の規則で実測して決める**。規則は合意済みで、測ったあとに動かさない。統計量だけ、変種を測る前に精密化した（中央値 → 最小値＋p25。Phase 0 の A/A 測定による・承認済み） |
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
| **F10** | 読みのベンチで、**同一バンドルどうしの中央値が 25% ずれた**（Phase 0 の A/A 測定）。ページごとの最初の計測がまだ遅く、サンプルが約 44ns と約 83ns の二峰に割れる。1 ページ 5 サンプルの**最小値**なら A/A の差は R1 で 0.0ns・R2 で 0.5ns・R3 で 1.5ns（約 1% 以内） | §5-2 の「中央値の差をノイズ床とする」は、そのままでは**どの変種も床以内になって規則が効かない**。統計量を最小値（p25 併記）に精密化する（§5-2） |

## 4. Phase 0 — 番人と基準試験（PR ⓪）（**実装済み**・2026-09-18）

**目的**: 案 A を採るかどうかに関係なく価値が残るものを先に入れ、Phase 2 の受け入れ条件になる試験を**現行実装に対して**通して基準を取る。`src/` は触らない。

**結果の要約**: 基準は 3 種とも main で緑。そして 3 種とも、**壊したビルドで実際に落ちること**を確かめた（§4-2・§4-3 の「検出力」）。通るだけの試験は Phase 2 の受け入れ条件にならない。

### 4-1. 番人（案 E）

- [x] `__tests__/addressLedgerKeyGuard.test.ts` を新設。`src/**/*.ts` を読み、**モジュール直下**（行頭の `const` / `let` / `var` / `export const`）の `WeakMap` / `Map` / `WeakSet` / `Set` 宣言で、`IStateAddress` または `ILoopContext` をキーにするものを失敗にする。前例は `__tests__/tagNameMap.test.ts`。走査の部品は `__tests__/helpers/sourceScan.ts` に分けた — Phase 1 の import 境界の番人（§6-B）が同じ部品を使う。
- [x] 宣言が複数行にまたがる綴り・CRLF・型注釈が無くコンストラクタの型引数だけに現れる綴り（`new Map<ILoopContext, …>()`）・入れ子（`Map<string, WeakMap<IStateAddress, …>>`）を拾う。関数内の局所コレクション、モジュール直下の関数式の本体、クラスのフィールドは拾わない。
- [x] 許可リストは 1 件: [getListIndexByBindingInfo.ts:7](../packages/state/src/list/getListIndexByBindingInfo.ts#L7)。理由（内側キー `IBindingInfo` がツリー単位）をテスト内に書いた。**許可リストの各項目が今も該当宣言として実在すること**も試験する — 古い許可を残さないためで、同時に「実ソースから実際に検出できている」ことの証明になる。
- [x] **番人自身の試験**（11 件）。加えて、走査したファイル数が 200 を超えることを確認する（空振りの番人は無いのと同じ）。

実ソースの該当は許可リストの 1 件だけ。`walkDependency` の `visited` / `result` と `StateHandler` の `seen` は局所なので対象外（設計書 §6-4 のとおり）。

### 4-2. クロスツリーの基準試験

`__tests__/integration.crossTreeAddress.test.ts` を新設。独立した ShadowRoot に `<wcs-state>` を 1 つずつ持つコンポーネントを 2 つ並べる。

- [x] **同じパス形状**（2 件）: 両ツリーが同名のルート配列を持つ。片方の行の書き込み・構造変更が、もう片方の描画・キャッシュ・差分基準・null 行の getter・`$updatedCallback` に触れない。
- [x] **同じ配列インスタンス**（3 件）: 両ツリーの初期値に同一の配列を渡して `for` で描画する。行バインディングの台帳が同じ `ListIndex` でもツリーごとに引ける／片方の行への書き込みが、もう片方の描画・キャッシュ・`$updatedCallback` に触れない／片方を外しても残った側が同じ `ListIndex` で更新を続ける。
- [x] **前提の固定**（characterization・1 件）: 同じ配列インスタンスのとき、両ツリーの 1 行目の `ListIndex` が同一オブジェクトで、`createStateAddress` の戻り値と**ループ文脈**も同一オブジェクトであること。設計書 §3-1 の実測をテストに落とした。**Phase 2 の C1b で反転させるのはこの 2 つの期待値だけ**で、テスト内に `FLIP` の印がある（`ListIndex` の共有は反転しない）。
- [x] 台帳を white-box で引くためのアドレス生成は、テスト内の `absOf()` 1 箇所に閉じた。Phase 2 で書き換わるのはそこだけ。

6 件とも現行で緑（今日は `IAbsolutePathInfo` が分けている）。

**検出力**（scratchpad にコピーした src を壊して同じテストを流した）:

| 変異 | 結果 |
|---|---|
| 対照（無変異） | 6 / 6 緑 |
| **行付きの intern からだけ要素の段を落とす**（D11 が禁じる形・Phase 2 で最も起きやすい誤り） | 「同じパス形状」の 2 件は緑のまま、「同じ配列インスタンス」の 3 件が赤 — 片方への書き込みがもう片方のキャッシュを書き換え、片方を外すと残った側が**更新されなくなる**。例外は出ない |
| ツリー次元を丸ごと落とす（`TreePath` の intern を全ツリーで共有） | 5 / 6 赤。緑の 1 件（配列が別のツリーへの行書き込み）は、配列が別なら `ListIndex` が別なので行アドレスがそもそも分かれるため。null 行の混線は「構造変更＋`count`」の件が捕まえる |

### 4-3. GC の基準試験

`e2e/tests/state-address-gc.spec.ts` ＋ `e2e/fixtures/state-address-gc.html`。Chromium 専用プロジェクトなので `page.context().newCDPSession(page)` が使える。

手順: ページ内で `<wcs-state>` を持つホストを接続 → 素のパス・getter・行付きパスを読ませて intern を作る → `WeakRef` を取る → ホストを外して参照を捨てる → **drain の完了を待つ**（F8）→ `HeapProfiler.collectGarbage` を 2 回 → `deref()` が `undefined` であること。

- [x] 単一ツリー・null 行の読みだけ（設計書 §5-3 の I2 が直接効く形）
- [x] 単一ツリー・行付き（書き込みで updater の queue と drain も通す）
- [x] **行を共有する 2 ツリーの片方だけを破棄**。破棄した側が回収され、残った側が引き続き正しく描画・更新される
- [x] 対照: 参照を握ったままなら回収**されない**こと（試験が GC を本当に観測している証明）
- [x] `WCS_STATE_BUNDLE=<絶対パス>` で、ページが読む state のバンドルを差し替えられる（`page.route` でリクエストを横取りするので、tracked な dist もリポジトリ内のファイルも触らない）。Spike S と Phase 2 で、別ブランチのビルドに対してこの spec を流すための口。

4 件とも main で緑。**intern と無関係な保持源は無かった**ので、この spec はそのまま Phase 2 の受け入れ条件に使える（計画時に用意した「基準が赤だった場合」の迂回路は不要になった）。

**検出力**（src のコピーを壊して esbuild で束ね、`WCS_STATE_BUNDLE` で流した）:

| 変異 | 結果 |
|---|---|
| 対照（無変異を esbuild で束ねたもの） | 4 / 4 緑 — 差し替えの口と束ね方が正しいことの確認 |
| **null 行の intern を不滅の `PathInfo` キーにする**（設計書 §5-3 が警告する形そのもの） | 単一ツリーの 2 件を含む 3 件が「host も state も回収されない」で赤。対照は緑のまま |
| **行アドレスを `ListIndex` から強参照するだけ**（同一性は正しいまま＝機能は壊れない） | 「片方だけ破棄」の 1 件だけが赤。単一ツリーの 2 件は緑 — 単一ツリーでは `ListIndex` がツリーと一緒に死ぬので漏れが現れない。**設計書 §5-3 の最後の段落の形でしか見えない漏れ**で、このシナリオが無ければ素通りする |
| 行付きの intern から要素の段を落とす（I1 と I2 の両方の違反） | 「片方だけ破棄」の件が赤。ただし GC の表明に届く前に、機能の表明（残す側が自分への書き込みを受け取らない）で落ちる |

### 4-4. ベンチ項目「読み」

既存のベンチ（append / clear / create・深さ方向）は設計書 §5-5 の表の 1 行目を測れない。

- [x] `packages/state/__e2e__/benchmark-read/index.html` ＋ `e2e/bench/plain-read.mjs` を新設。state のメソッド内で N 回読む（`this` が proxy なので、1 回ごとに get トラップを往復する）。各メソッドはチェックサムを返し、スクリプトは**全変種が同じ値を計算したこと**を確認する。
  - **R1** 素のパス（ワイルドカードも getter も無い・`isCacheable` が偽）— 設計書 §5-5 の 1 行目
  - **R2** getter（キャッシュを引く読み・null 行）
  - **R3** 行の getter を添字つきのパス（`items.5.size`）で読む（キャッシュを引く読み・行付き）
- [x] `--variant <名前>=<バンドル>` を複数与えると、変種を**ラウンドごとに順序を回しながら交互に**測る（熱ドリフトと背景負荷を全変種に均等に載せる）。差し替えは `page.route` なので **tracked な `packages/state/dist` を書き換えない**（§12 の罠 1）。同じバンドルを 2 つの名前で与えれば、それがノイズ床の測定になる。
- [x] **統計量は最小値と p25**（中央値ではない — F10）。1 ページ 5 サンプル × 12 ページ、計測前にウォームアップ 3 回。
- [x] main の基準値（2026-09-18・main `bf27363f`・この開発機・スロットル無し・200 万読み / サンプル）:

  | 形 | min (ns/読み) | p25 | A/A の差（min） | A/A の差（p25） |
  |---|---|---|---|---|
  | R1 素のパス | 42.7 | 43.6 | 0.0 ns（0%） | 0.05 ns（0.1%） |
  | R2 getter | 46.4 | 47.8 | 0.5 ns（1.1%） | 0.14 ns（0.3%） |
  | R3 行の getter | 128.6 | 130.0 | 1.5 ns（1.2%） | 0.31 ns（0.2%） |

  R1 と R2 が近い値なのは偶然の一致で、**ここから lift のコストは読み取れない**。2 つは通る経路が違う — R1 は `_getByAddress` で実値を読み、R2 は lift してキャッシュを引いて返す。lift の実コスト（設計書 §5-5 の見積もりで 3〜4 段）は、Spike S で (a2)・(b) の R2・R3 を main と並べて初めて分かる。
- [ ] 既存ベンチ（`jsfb-verify` / `list-component` / `create-cost` / `clear-cost` / `append-accumulation`）の基準は**取らなかった**。`e2e/bench-results/` は `.gitignore` 済みで数字が残らず、絶対値は機械と日で動くので、保存した基準と比べても意味が無い。Phase 1・Phase 2 の検証で **main と branch を同じセッションで**測る（§9）。

### 4-5. 設計書の同期

- [x] §3 の F1〜F9 を設計書に反映した（§4-6 の `placementOf`、§5-2 の親連鎖が死にコードであること、§7-1 の互換 getter が内部では使えないこと、§8 のプロパティ名とパーマリンク、§9 の閾値・GC の手段と基準・ベンチの統計量と基準・SSR スモークの指す先）。F10 は設計書 §9 の性能の項に入れた。

**完了条件（達成）**: `src/` の差分ゼロ。state の全テスト 303 ファイル・3648 件が緑、カバレッジ 99.62 / 98.78 / 100 / 99.78（閾値 99.5 / 98.5 / 100 / 99.5）、lint 緑、GC spec 4 件が緑。e2e の全 spec は CI で流す。

**成果物**: `__tests__/addressLedgerKeyGuard.test.ts`（14）・`__tests__/helpers/sourceScan.ts`・`__tests__/integration.crossTreeAddress.test.ts`（6）・`e2e/tests/state-address-gc.spec.ts`（4）・`e2e/fixtures/state-address-gc.html`・`packages/state/__e2e__/benchmark-read/index.html`・`e2e/bench/plain-read.mjs`。

## 5. Spike S — intern の置き場所を測る（マージしない）（**実施済み**・2026-09-19・結果＝規則 5）

記録と再現に要るもの（patch 5 本・計測 3 セッションの JSON・ビルドの出所）は [spikes/state-address-intern-placement/](./spikes/state-address-intern-placement/README.md)。数値の読み方と設計への含意は設計書 §5-6、そのあとの選択肢は設計書 §11。

### 5-1. 最小パッチ

統合本体を書かずに R1 の実コストを測る。Phase 0 のブランチから捨てブランチを切り、**`createStateAddress` に省略可能な第 3 引数 `stateElement?` を足す**。渡すのは [traps/get.ts:220](../packages/state/src/proxy/traps/get.ts#L220)（`handler.stateElement` が手元にある）と、R2・R3 が通る経路だけ。要素が渡されたときだけ新しい intern を通す。型も台帳も触らない。

- 変種 **(b)**: `src/address/` に `WeakMap<IStateElement, Map<IPathInfo, TreePath>>`。`TreePath` が `nullRowAddress` / `rowAddresses` を持つ（設計書 §5-4）。
- 変種 **(a2)**: 同じ `Map<IPathInfo, TreePath>` を要素の symbol キーのプロパティに置く。`State` クラスは**フィールドとして宣言**する（後付けのプロパティ追加は要素の hidden class を変える）。モックには初回に遅延生成。

**やってはいけない最適化**: (b) の外側の引きを「直前の要素」のモジュール変数メモで省くこと。モジュール変数は要素を強参照で掴むので **I2 違反**（最後に触ったツリーが回収されなくなる）。`WeakRef` にすると `deref()` のコストで意味が無くなる。

### 5-2. 判定規則（測る前に固定する）

> **精密化（2026-09-18・Phase 0 の実測による・著者承認済み）**
> 最初に合意した規則の 1 は「R1 の**中央値**の差をノイズ床とする」だった。Phase 0 の A/A 測定で、同一バンドルどうしの中央値が 25% ずれることが分かった（F10）。そのままだと床が広すぎて、**どの変種も「床以内」になり、規則が何も決めない**。変種を測る前に、次の 3 点を精密化した。規則の骨格（床以内なら (b)・超えたら (a2)・(a2) も超えたら設計へ戻す）は変えていない。**これが確定版で、変種を測ったあとには動かさない。**
>
> - **統計量**: 中央値ではなく**最小値**。p25 を併記して照合する（1 ページ 5 サンプル × 12 ページ）。
> - **ノイズ床**: 同じセッションで main を 2 つの変種名（`main` / `main-again`）で測り、R1 の |Δmin| と |Δp25| の大きい方。ただし**下限を main の R1 の 1%** とする。Phase 0 の A/A では R1 の Δmin がちょうど 0.0ns だった — 下限が無いと、偶然 0 が出た回に規則が「1 サンプルの揺らぎも許さない」に化ける。1% は A/A で観測した 3 つの形の最大（R3 の 1.2%）に合わせた値。
> - **床以内の判定**: Δmin と Δp25 の**両方**が床以内のとき。

1. main を 2 つの変種名で同じセッションに入れて測り、R1 の |Δmin| と |Δp25| の大きい方を**ノイズ床**とする（下限は main の R1 の 1%）。
2. main・main-again・(a2)・(b) を**交互に**測る（`plain-read.mjs` がラウンドごとに順序を回す）。条件（スロットル・件数）は全変種で同一。全変種のチェックサムが一致すること。
3. `R1(b) − R1(main)` が、min と p25 の両方でノイズ床以内 → **(b)**（P3 で最も安い。約 63 本のモックに手が入らない）。
4. 超える → **(a2)**。P1 > P3 なので、差分の小ささは理由にしない。
5. **(a2) もノイズ床を超える → 着手を止めて設計へ戻す**。案 A そのものが P1 を破っている。
6. R2・R3 は設計書 §5-5 の見積もり（3〜4 段の減少）の確認用。悪化していたら見積もりが誤りなので、原因を特定するまで進めない。

**成果物**: 測定 JSON と、設計書 §5-5・§10-6 への結果の追記（G6 の決着）。ブランチは捨てる。

### 5-3. 実施と結果（2026-09-19）

**やり方**: 捨てブランチではなく scratchpad の src コピー上で実装し、patch を docs に残した（§12 の罠 7 の手順）。(a2) と (b) は別々のエージェントが並行実装し、3 観点（配置の忠実さ／ホットパスの公平さ／I1・I2 と後方互換）× 2 変種の反証を 2 巡通した — 1 巡目はガードの綴りの非対称（`!= null` と `!== undefined && !== null`）で反証され、揃えた。両バンドルの実体差分は外側の段 3 行と State の class field だけ。§5-1 の計画から 1 点ずれ: 要素を渡すのは get trap の 1 箇所だけにした（R1〜R3 はすべてそこを通る）。

**数字を見る前に決めた 2 つの扱い**: ① R2 / R3 は spike の形では新しい段を 2 回通る（get trap の intern と、残した lift の `getTreePath`）ので判定に使わず、a2 と b の整合性確認にだけ使う。② 両変種は main に無い `!= null` の比較を全呼び出しで払う（統合後のコードには無い足場）ので、それだけを入れた対照 **main-guard** を足し、配置の比較先とする。main との差も併記し、判定が食い違えば報告する（食い違わなかった）。1 セッション目のあと、切り分けのために **a2flat**（null 行を `TreePath` 節点を経由せず要素直下の `Map` から引く・診断用・規則の候補ではない）と **main-tp**（`TreePath` の引き方の変更だけ・統合不要）を足した。

**結果（R1・main との差・min / p25・ns/読み・3 セッション）**:

| 変種 | S1 | S2 | S3 |
|---|---|---|---|
| 床（main-again・下限 1%） | 0.42 | 0.42 | 1.00 |
| main-guard | +0.45 / +0.71 | +0.70 / +0.27 | +1.05 / +0.25 |
| **b** | **+3.95 / +4.38** | **+3.15 / +4.26** | **+5.20 / +5.08** |
| **a2** | **+3.05 / +4.29** | **+3.10 / +4.10** | **+3.55 / +4.45** |
| a2flat（診断） | — | +0.60 / +1.12 | +1.10 / +1.65 |

**判定**: 規則 3（b が床以内）・規則 4（a2 が床以内）とも 3 セッションで不成立。**規則 5 — 着手を止めて設計へ戻す。** main-guard を比較先にしても同じ（b +2.45〜4.15 / +3.67〜4.83、a2 +2.40〜2.60 / +3.58〜4.20）。独立した審査 3 名（機械的適用・懐疑・忠実さ）が一致し、比較先の違いで判定は動かなかった。

**設計へ持ち帰る事実**（設計書 §5-6・§11）: 退行の主因は置き場所ではなく、素の読みが `TreePath` 節点を経由すること（a2 − a2flat ＝ +2.7 の固定費）。置き場所の差は ≤1.65。a2flat は min では main-guard と同等だが、ページの半分以上で +2〜3 のレベルに固定される（JIT 依存・機構は未同定）。§5-5 の段数モデルは否定された。main-tp は R1 中立で R2 −1.0 / R3 −3.3〜4.6 — 統合と切り離して採れる。

**言えないこと**（批評の指摘）: 「案 A は死んだ」「要素の段は X ns」「a2flat は床以内」「R2 / R3 が見積もりを確認した」「main-tp の改善は確立した事実」。Chromium・開発機 1 台・無圧縮 esbuild・単一パス単一要素でしか測っていない。

**この spike で見つけた、規則そのものの弱点**: 床が脆い（S3 の 1.00 は main の 1 サンプルの偶然）。±1ns の問いを裁くなら A/A を 3 名以上入れる。変種のページ最小値が離散レベルに割れる現象は、min 統計量の前提の外にある。どちらも設計書 §11-3 に持ち越した。

### 5-4. 追試 E1（2026-09-19・著者が設計書 §11 の A を選択）— 結果＝不成立

**事前登録**: 足場なしの flat 形（get trap は常に要素を渡す・`createElementAddress` は単一経路でガード無し・null 行は要素の class field の `Map<pathInfo, address>`・`TreePath` は行だけ）を、ガードを含まない main-tp と、2 セッション・24 ページ・A/A 3 名（main / main-again / main-third）で同じ規則にかける。床はセッションごとに A/A 2 組の最大（下限 1%）。**両統計量・両セッションで床以内なら成立**。main との差も併記。

**実施**: flat はエージェントが実装し、3 観点の反証で refuted なし。全テスト 304 / 3656 が緑（モック 4 ファイルにフィールド追加のみ）。バンドルの実体差分は symbol・関数・trap の 1 呼び出し・class field だけ。記録（patch・JSON・出所）は [spikes/state-address-intern-placement/](./spikes/state-address-intern-placement/README.md) の「追試 E1」。

**結果（R1・flat − main-tp・min / p25）**: S1 **+0.65 / +2.00**（床 0.50）、S2 **−0.05 / +1.52**（床 0.55）→ **不成立**（p25 が 2 セッションとも床の 3〜4 倍・main 比でも同じ）。独立審査 3 名一致。1 セッション目のあと足した診断（7 変種・規則の対象外）で、symbol キーは原因でない（文字列名でも同じ）こと、モジュール側の `WeakMap<要素, …>` は全ページで +2.5〜3ns の固定費であることが分かった。残るコストは「ページの半分以上で +1.5〜2ns のレベルに乗る確率」で、機構は未同定（JIT／identity hash の配置／要素のプロパティ状態のどれか — 設計書 §5-7）。

**次**: 著者が A を選ぶときに「A が不成立なら B」と述べているので、本書の推奨は B。main-tp（`getTreePath` の引き方の変更だけ）は 4 セッションで R1 中立・R2/R3 改善が一貫しているが、単独の型検査・テスト・リリース物での確認が要る。未検証の形（設計書 §11-4）を試すなら、E1 の再試行ではなく新しい spike として規則を先に固定する。

## 6. Phase 1 — 内部化と改名（PR ①・振る舞い不変）（**実装済み**・2026-09-18）

ブランチ `refactor/state-address-tree-path`（Phase 0 のブランチの上に積んだ）。

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

- [x] 上の 18 箇所を `liftAddress` / `absoluteAddressOf` に置き換えた（`createAbsoluteStateAddress` の呼びで数えると 19 — `setByAddress.ts:320` が 1 つの `absPathInfo` から 2 本作る。設計書の「21」の残り 2 つは `patternLedger` の devtools sink（`getBindingSetByAbsoluteStateAddress.ts:98` / `:117`）で、`TreePath` を直接受けるので残す）。`generation.ts` と `setByAddress.ts:320` は今日 `absPathInfo` をループの外に巻き上げているが、どちらもコールドパス（再帰の実体化・スワップ）なので毎回引く形にした。置き場所は `src/address/liftAddress.ts`。`watchRuntime.ts` にあった同名の局所関数 `absoluteAddressOf(stateElement, entry)` は、共通の入口を直接呼ぶ形に畳んだ（呼び出しは 1 箇所だった）。
- [x] `src/address/` の外に残る intern の直接呼びは、計画どおり 3 箇所だけ: `BindingSession.ts` の `getTreePath`（パターン台帳への登録）と、`getBindingSetByAbsoluteStateAddress.ts` の `createAbsoluteStateAddress` × 2（devtools sink）。
- [x] 2 行にまたがる置換になる。**CRLF のファイルに対する perl の複数行置換は空振りする**（§12 の罠 3）ので、Edit で 1 箇所ずつか、TS の AST を使う。実際には「CRLF を LF に正規化 → 完全一致で**ちょうど 1 回**当たることを確認して置換 → 元の改行に戻す」node スクリプトで行った。当たりが 1 回でなければ例外にするので、空振りも二重置換も起きない。

### 6-B. 改名（G3）

- [x] `IAbsolutePathInfo` → `ITreePath`、`AbsolutePathInfo.ts` → `TreePath.ts`（`git mv`）、`getAbsolutePathInfo` → `getTreePath`。クラス名も `TreePath`。40 ファイル・162 箇所（src と `__tests__`）。他パッケージに該当は無い（devtools は自前のミラー型 `IAbsolutePathInfoLike` を持ち、state の型を import していない）。
- [x] **プロパティ名 `absolutePathInfo` / `parentAbsolutePathInfo` は変えない**（F6）。置換を語境界つき（`AbsolutePathInfo`）にすれば機械的に守れる — 前者は小文字の `a` で始まり、後者は `A` の前が語の文字なので、どちらも当たらない。
- [x] 境界の番人 `__tests__/addressImportBoundary.test.ts`（8 件）。`sourceScan.ts` に import を拾う部品（`collectImportedModules` — 静的・type・複数行・`export from`・動的・副作用 import を、ファイルの位置から解決する）を足した。`address/TreePath` を `src/address/` の外から import してよいのは `bindings/BindingSession.ts` だけ、`address/AbsoluteStateAddress` は `binding/getBindingSetByAbsoluteStateAddress.ts` だけ（計画時は前者に `getBindingSetByAbsoluteStateAddress.ts` も挙げていたが、あのファイルは `ITreePath` を引数で受けるだけで `getTreePath` を呼ばない）。**この番人は Phase 2 のあとも残る**。
- [x] テストは名前の追随のみ。**期待値は 1 つも変えていない**。

**完了条件（達成）**: 差分が「呼び出しの畳み込み」と「名前」だけで読める（コミットを分けた — 改名だけ／畳み込みだけ）。state の全テスト 304 ファイル・3656 件が**期待値の変更ゼロで**緑、カバレッジ 99.62 / 98.78 / 100 / 99.78（Phase 0 と同じ）、lint 緑、GC spec を Phase 1 のビルドに対して流して 4 / 4 緑。e2e の全 spec は CI で流す。

**性能（2026-09-18・main と Phase 1 の src を同じ esbuild で束ね、同一セッションで交互に測定）**: 退行なし。lift の関数化ぶんの呼び出し 1 段はインライン化されている。

| 読み（ns/読み・min） | main | main-again（床） | Phase 1 |
|---|---|---|---|
| R1 素のパス | 41.9 | +0.5 | **+0.6**（p25 は −0.09） |
| R2 getter — `getByAddress` のキャッシュ経路が `liftAddress` を通る | 45.45 | +0.6 | **+0.3**（p25 は −0.44） |
| R3 行の getter | 123.95 | +0.05 | **−0.25**（p25 は −0.89） |

| リスト（`jsfb-verify`・中央値 ms） | main | Phase 1 | main（2 回目） | Phase 1（2 回目） |
|---|---|---|---|---|
| create1k | 41.55 | 42.0 | 41.05 | 40.45 |
| replace1k | 17.6 | 16.35 | 26.35 | 25.15 |
| update10k | 11.85 | 12.45 | 12.2 | 11.85 |
| swap1k | 0.8 | 1.0 | 1.0 | 1.0 |
| remove1k | 2.95 | 3.2 | 3.0 | 2.65 |
| append1kTo10k | 60.9 | 56.7 | 56.55 | 60.65 |
| clear10k | 69.5 | 70.2 | 68.15 | 69.3 |

どの操作も、Phase 1 と main の差は **main どうしの実行間の揺れより小さい**（replace1k は main の 2 回で 17.6 と 26.35）。keyed の判定（`isKeyed`・`swapTrAdded=2`）は 4 回とも同一。絶対値は無圧縮の esbuild バンドルでの値で、リリース物の数字ではない。

`jsfb-verify.mjs` に `--bundle <path>` を足した（読みのベンチ・GC spec と同じく、リクエストを横取りして差し替える）。これが無いと、リスト性能を main と並べて測るには tracked な dist を書き換えるしかなかった。

**成果物**: `src/address/liftAddress.ts`・`src/address/TreePath.ts`（`AbsolutePathInfo.ts` から `git mv`）・`__tests__/addressImportBoundary.test.ts`（8）・`__tests__/helpers/sourceScan.ts`（import を拾う部品を追加）・`e2e/bench/jsfb-verify.mjs`（`--bundle`）。

## 7. Phase 2 — 統合と lift 削除（PR ②）（**中止**・2026-09-20・設計書 §12）

以下は採択時の計画をそのまま残したもの。実施しない。

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

## 8. Phase 3 — 互換面の撤去（PR ③・次の major）（**中止**・2026-09-20）

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
5. branches 98.5% の閾値は余裕が薄い（2026-09-18 の main で 98.78%）。assert や分岐を足したコミットは単独で `test:coverage` を回す。
6. **scratchpad プローブの `--root` は、パスの `c--Users-…` の区間を大文字の `C--Users-…` で渡す**。小文字で渡すと、vite が同じファイルを 2 つのパス表記（`c--Users` と `C--Users`）で解決して**モジュールを二重にロードする**。描画は片方のモジュールグラフで動き、テストが直接 import した台帳はもう片方の空のインスタンスを見るので、「描画はされるのに `getStateElement()` が null」という形で全テストが落ちる。Phase 0 では、これを変異の検出と取り違えかけた — **変異を当てる前に、必ず無変異の対照を流すこと**。
7. 変異を入れたビルドが要るときは、src のコピーを `packages/state/node_modules/.bin/esbuild <copy>/src/auto.ts --bundle --format=esm` で束ねれば足りる（rollup の設定も tracked な dist も触らない）。できたファイルを `WCS_STATE_BUNDLE`（GC spec）か `--variant`（読みのベンチ）に渡す。
