# State 次期メジャー 要素技術調査

**English**: [state-next-major-tech-survey.md](./state-next-major-tech-survey.md)

調査日: 2026-09-20。対象: `@wcstack/state` 2.5.1（main `6bff9f2c`、作業ブランチ `major/state-next`）。[監査](./state-next-major-audit.ja.md)（2026-09-18）と[要件](./state-next-major-requirements.ja.md)の続き。要件 §9 フェーズ 3「試作を比べる」に入る前に、試作の部品になる要素技術を 1 つずつ独立に計測し、採否の材料を作る。ソースと配布物は変更していない（計測は一時ディレクトリへのビルドで行う）。**この文書は決定ではない。**

| ID | 要素技術 | 問い | 対応する要件 |
|---|---|---|---|
| T1 | core と機能の静的結合 | 分割エントリを作るとき、どの辺を切れば core が機能を引かずに済むか | G2・B13・N2 |
| T2 | 引用符を知る字句解析 → AST → 互換アダプタ | 3 段構成の文法層は何行・何 KB で、現行の文法をどこまで受理し、監査の不整合をどう報告するか。現行の出力契約は再現できるか | B1〜B5・D2 |
| T3 | 依存グラフの機構 | 「全行が 1 つのスカラを読む」を path-pattern・cell（signals）・鍵付き索引の 3 機構で比べると、時間とメモリはどう違うか | D7・A3・A5 |
| T4 | DOM 操作の下限 | ランタイム無しで同じ表を生成・追加・更新・消去すると何 ms かかるか。`moveBefore` は何を保つか | A3・監査 §4.3 |
| T5 | 2026-09 のプラットフォーム | 依存してよい標準と、まだ無い標準 | D1・D3・§10 |
| T6 | 実ランタイムの計数 | 現行ランタイムの各操作で、展開・アドレス生成・getter 評価・束縛検索・適用・行生成・diff・プールは何回起き、時間はどこに落ちるか | A3・監査 §4.3 |
| T7 | スタブ化ビルドの残量 | 機能群を切ったとき、現行ソースの core は何 KB 残り、どのモジュール・どのメンバーが占めるか | A2・G1 |

## 1. 判断

1. **分割の切断点は少ない。** core→機能の値 import は 49 本、モジュール評価時に登録処理を走らせるのはライブラリ内 3 箇所（watch・stream・volume）と `auto.ts` の bootstrap だけ。`defineState.ts` は値 import を 1 本も持たないので、副作用の無いヘルパー入口（N2）は Rollup にエントリを足すだけで作れる。残る難所は apply / bindings / structural / event / mount / SSR にまたがる 28 モジュールの循環。
2. **文法の 3 段化は行数では安いが、サイズは減らない。** 引用符対応の字句解析＋AST は 258 行、互換アダプタは 69 行で、corpus の `data-wcs` 539 種のうち 523 種で現行パーサとフィルタ関数の挙動まで同一の出力を返す。差はすべて意図した診断か現行の受理の緩さ。ただし文法段だけを同じ条件で束ねると現行 1.7 KB gzip（`bindTextParser/` 単体）に対し試作＋アダプタは 3.2 KB で、診断・アリティ検査・引用符処理の分 1.5 KB 増える。`parser.esm.js` 16 KB の大半はフィルタ実関数と PathInfo で、文法の書き換えでは減らない。B4 は「曖昧」ではなく、README に載っている `radio#ro` / `checkbox|int` を実行時が専用処理に乗せない実害だと分かった。
3. **「全行が 1 つのスカラを読む」は機構を変えても O(N)。** path-pattern も signals の cell も 1 万行で 1 万回評価する。O(1) になるのは比較する鍵で購読を索引した機構だけで、D7 の「最適化された選択を API で支援する」に対応する。signals の cell は行あたり 2.3〜9.9 KB で path-pattern の 14〜17 倍。評議会 性能審 ③「cell-per-field は要素数で爆発する」を数値で裏付ける。
4. **現行ランタイムの選択コストは形ではなく定数係数で、内訳が取れた。** 追跡 getter の選択変更（1 万行）は、書き込み側（set トラップ → 依存 walk → enqueue）が約 25%、drain が約 75%（うち束縛適用が 8 割、getter 読みがその半分）。行あたり 1 回の enqueue・2 回の getter 読み・3 回の get トラップ・6 個のアドレスオブジェクト生成・1 回の束縛検索・1 回の適用が走る。同じ O(N) 形の機構モデルは行あたり 1 回の評価と 0 個の割り当てで済んでいた。
5. **行生成の費用は DOM 複製ではなく帳簿にある。** 1 万行生成の適用 281 ms（中央値）のうち行コンテンツ生成が 145 ms（新規 9,000 行、1 行 16 µs）で、その内訳は template 複製 2.5 µs（DOM 下限と同じ）、ノードパス解決 1.9 µs（1 行 5 回）、束縛 record の生成とイベント付与 4.9 µs、台帳登録と束縛オブジェクトの複製 約 6.5 µs。続く活性化が 105 ms（1 行 10.5 µs）、DOM 挿入・diff・残りが約 30 ms。行あたり約 26 µs のうち DOM が 2〜4 µs で、残りは record・台帳・活性化の帳簿作業。消去後にプールから再利用される 1,000 行生成は初回 65 ms から 12〜20 ms まで下がる。1 行削除は index を読む getter のために 11,000 行を再評価し、swap の diff 二重は 2.3 ms で移動処理 4.7 ms より小さい。書き込み側は 1 回 2.4 µs。
6. **消去はエンジン 21 ms＋レイアウト済み行の取り外し約 25〜40 ms。** ランタイム内部で測った消去の drain は 19〜25 ms。外から測った消去が約 25 ms と約 65〜80 ms に割れるのは、行が一度でも描画（レイアウト）されたかで決まる。ランタイム無しの `replaceChildren()` は生成直後（フレーム未描画）なら 3.6 ms、rAF 2 回の後（描画済み）なら 28 ms。トレースでは高い側の窓に `Layout` も GC も無く、全てがスクリプトが呼ぶ DOM 操作の内側にある。利用者が見る画面では行は必ず描画済みなので、監査の 72.95 ms が現実の値で、そのうちエンジンの費用は約 21〜25 ms。
7. **DOM の下限は wcstack より 1 桁小さい。** Chromium で 1,000 行生成 2.2〜6.3 ms（wcstack 42.85 ms）、1,000 行更新 1.9 ms（13.10 ms）、1 万行への 1,000 行追加 2.4 ms（66.00 ms）。ベンチの再走行は監査の中央値と 10〜30% 以内で一致し、配布物の数値は走行間で安定している。Firefox 151 は生成が Chromium の 2.4 倍、消去が 3.4 倍、WebKit 26.5 はほぼ Chromium 並み。`moveBefore` は Chromium / Firefox でフォーカスと選択範囲を保ち、WebKit には無い。
8. **機能を全部切っても core は gzip 44 KB。`State.ts` の 54% は機能への配線。** devtools・時間系・再帰・コンポーネントスコープ・SSR・書式フィルタをスタブにしても minify 147.6 KB（gzip 44.0 KB）が残り、`State.ts` 18.8 KB と `BindingSession.ts` 12.9 KB で 21%。メンバー単位で見ると `State.ts` の 10.1 KB（54%）は webComponent / stream / watch / scan / dcc / stateLoader を参照するメンバー（`connectedCallback` 2.7 KB、`_initializeBindWebComponent` 2.3 KB、volume 系 4 メンバー 2.3 KB、`_state` setter 1.2 KB ほか）にあり、`BindingSession.ts` は機能群を一切参照しない DOM アダプタの芯で、プラン経路と汎用経路の二重化が 2.0 KB 対 4.9 KB。`setByAddress.ts` も 55% が dcc / devtools / webComponent / watch に触れる。A2 の 35 KB は minify で約 30 KB の削減に相当し、配線の切り出し（約 10〜13 KB）と経路の一本化を合わせて初めて視野に入る。
9. **プラットフォームは待たない設計にする。** TC39 Signals は Stage 1 のまま、DOM Parts は未出荷、`moveBefore` と Scoped Custom Element Registries は WebKit / Firefox のどちらかが欠ける。反応コアと template plan は自前を続け、`moveBefore` は機能検出で使う。逆に Navigation API・import map `integrity`・`AbortSignal.any()` は 3 エンジンに揃った。

## 2. 条件と限界

- 監査と同じ端末（Intel Core Ultra 9 275HX、Node 22.19.0、TypeScript 5.9.3、terser 5.46.0）。ブラウザは Playwright 1.61.1 の Chromium 149.0.7827.55・Firefox 151.0・WebKit 26.5。
- T1 は tsc の出力 JS を解析した。tsconfig に `verbatimModuleSyntax` が無いので、TS 原文を解析すると型だけの import（`type` 修飾なし）が値の辺に混ざる（原文解析では辺 68 本・循環 46 モジュール、出力解析では 49 本・28 モジュール）。行数は TS 原文の改行数（コメント・空行込み）で、257 モジュール・29,294 行。
- T2 の corpus は `examples/`・`packages/*/examples/`・`packages/*/__e2e__/` の HTML と `packages/*/README{,.ja}.md` から `data-wcs="…"` を正規表現で拾った。README の地の文にある断片が含まれる（両方が拒否）。アダプタの比較は、束縛の射影に加えて各フィルタ関数を 8 個の探針値（`['X','Y']`・`'abc'`・`3`・`0`・`true`・`null`・`undefined`・`1234.567`）に適用した結果（例外の型を含む）まで一致を見た。サイズ比較は、現行は `src/bindTextParser/` を単独で束ね（ディレクトリ外への import は external）、試作は字句解析＋アダプタを単独で束ねた（PathInfo とフィルタ実関数は注入）。
- T3 は **機構のモデル**で、wcstack ランタイムではない。同じスタブ DOM と同じ束縛レコードを使い、反応の帳簿だけを変えた。中央値 7 回、`--expose-gc`。ヒープは行データ確保後・build 後の差分。signals は `packages/signals/dist` の配布物。
- T4 はランタイムを一切読まず、監査と同じ表・CSS・`buildData.js` を使い、監査と同じ MutationObserver 計時（op → MO コールバック。MO 記録の生成コストを含む）。**Chromium を 2 回走らせた差**は 1 万行生成 27.9 / 37.0 ms、CPU 4 倍の 1 万行生成 255.7 / 145.5 ms、同消去 267.6 / 180.1 ms。表は 2 回目（JSON と同じ）で、CPU 4 倍の値は比率に使わない。1,000 行では変種間の差（2.2〜6.3 ms）は計時分解能と GC の揺れの範囲。Firefox の `performance.now()` は 1 ms 刻み。
- 監査のベンチ（`e2e/bench/jsfb-verify.mjs`、配布済み `auto.min.js`、8 標本）を同日に再走行した（[browser-1x-rerun.json](./research/state-next/browser-1x-rerun.json)）。中央値は監査と 10〜30% 以内で一致する（§6.3）。ベンチは **1 標本ごとにページを読み直す**（cold）。
- 消去の二峰性の切り分け（§8.5）は、ベンチと同じ計時関数を持つ [audit-state-tech-warmth.mjs](../scripts/audit-state-tech-warmth.mjs) で、cold（標本ごとに読み直し）と warm（同一ページで連続）を各 6 標本、条件（バンドル・fixture・直前の操作列・計時方法・setup の方式・GC 強制）を 1 つずつ入れ替えて取った。トレース（§8.6）は CDP `Tracing` の `devtools.timeline`・`disabled-by-default-devtools.timeline`・`v8`・`disabled-by-default-v8.gc` カテゴリで、`performance.mark` の窓の内側を同一スレッドの完了イベントで集計した。**トレースは実行を遅くする**（1 万行生成 288 → 481 ms）ので、内訳の比率にだけ使う。フレーム実験（§8.6）は標本ごとに新規ページ、6 標本。
- T5 は web-features 3.39.0 と BCD 8.1.2 の 2026-09-20 時点。全表と出典は[記録](./research/state-next/platform-status-2026-09.md)。
- T6 は名前付きエントリを一時ディレクトリへ再ビルドし、Rollup の transform で関数をラップして計数した。第 1 段（展開・アドレス・読み・適用）は 11 モジュール、第 2 段（リスト適用の内部と書き込み側）は 13 モジュール、第 3 段（行コンテンツ生成の内部）は 12 モジュール。**ラッパーの分だけ経過時間は膨らみ、段によってラッパー集合が違うので経過時間は段の間でも比較しない**（追跡 getter の選択 1 万行: 第 1 段 24.4 ms・第 2 段 12.3 ms・監査 21.10 ms）。回数は全段で一致し正確。第 1・2 段の生成・追加・消去は 1 標本、第 3 段は 1 万行生成・追加・消去が 3 標本の中央値、1,000 行生成は 5 標本（初回はコンテンツ新規生成、2 回目以降はプール再利用）。fixture は監査と同じで、`tracked` は監査の「普通の追跡付き getter」、`manual` は fixture の手書き 2 行通知。
- T7 のスタブは元モジュールの export 名だけを `undefined` で残す。core 側の呼び出し箇所はそのまま残るので**実行はできず、サイズは上限**。full の値（71.1 KB）は監査の minify 実験（71.2 KB）と一致する。モジュール別・メンバー別の帰属はソースマップ由来の minify bytes で、gzip ではない（この残量では gzip は minify の約 30%）。メンバーが参照する機能群は「そのメンバーの中で使われている import 名の由来ディレクトリ」で、`I` で始まるインターフェース風の名前は除外した。

## 3. T1 — core と機能の静的結合

### 3.1 入口ごとの到達範囲

| 入口 | 到達モジュール | 行 | 評価時に処理を走らせるモジュール |
|---|---:|---:|---:|
| `exports.ts` | 227 | 28,211 | 10 |
| `auto.ts` | 228 | 28,221 | 11 |
| `bootstrapState.ts` | 222 | 27,327 | 10 |
| `components/State.ts` | 216 | 26,421 | 10 |
| `proxy/StateHandler.ts` | 177 | 19,792 | 7 |
| `updater/updater.ts` | 133 | 14,543 | 7 |
| `parser.ts` | 17 | 1,899 | 0 |
| `manifest.ts` | 10 | 1,609 | 0 |
| `defineState.ts` | 1 | 396 | 0 |

`defineState.ts` は自分以外を 1 つも値 import しない。監査 §3.1 の「`defineState` だけで gzip 26.8 KB」は、束ねた `index.esm.js` から再 export したため副作用モジュールが残った結果で、**ソースから直接エントリを切れば 0 に近い**。`parser.ts` の 1,899 行のうち 916 行は `filters/`。パーサがフィルタの実関数を解析時に作るためで（監査 §7）、文法段だけなら T2 の 1.7〜3.2 KB で済む。

### 3.2 モジュール評価時の副作用

| モジュール | 行 | 内容 |
|---|---:|---|
| `watch/watchRuntime.ts` | 410 | `registerUpdateBatchListener(fireWatchOnUpdateBatch, …)` |
| `stream/streamRuntime.ts` | 241 | `registerUpdateBatchListener(restartStreamsOnUpdateBatch, …)` |
| `webComponent/volume.ts` | 415 | `setVolumeGraftHandler(graftIsolated)` |
| `auto.ts` | 9 | `await bootstrapState()` |
| `updater/updater.ts` | 304 | `updater = new Updater()`（単一インスタンス） |
| `event/{handler,twowayHandler,radioHandler,checkboxHandler}.ts` | 24 / 19 / 11 / 11 | `createHandlerBindingRegistry()` |

上 3 つが G2 の「import しただけで残る」正体。呼び出し側（`updater` / `mountScope`）が登録を受ける形にすれば、機能側は import されない限り評価されない。

追記（同日、§10.5）: 上 3 つは S2 で `install()` 化し、評価時に処理を走らせるモジュールは 11 → 8 になった。表は計測時点のまま残す。

### 3.3 core から機能への辺（49 本）

| 機能 | 本数 | 主な起点 |
|---|---:|---|
| `webComponent` | 16 | `proxy/methods/getByAddress` → volumeShared / mount / overlay / exportIndex、`setByAddress` → volumeShared / exportIndex / overlay、`proxy/traps/get` → mount、`apply/applyChangeToFor` → mountScope、`event/handler` → mount、`list/loopContextByNode` → mount |
| `devtools` | 12 | すべて `devtools/sink` へ（`bootstrapState` のみ bridge） |
| `recursion` | 8 | `proxy/apis/{getAll,setAll,trackDependency}`、`proxy/traps/get` → expand / bind |
| `components` | 5 | `Ssr.ts` へ 4 本（exports / hydrateBindings / buildSsrDocument / registerComponents）、`State.ts` へ 1 本 |
| `stream` | 3 | `getByAddress` → argsTrace / streamNamespace、`traps/get` → streamNamespace |
| `watch` | 2 | `setByAddress` → prevValues、`updater` → chainDepth |
| `dcc` | 2 | `setByAddress` / `postUpdate` → dispatchBindableEvent |
| `scan` | 1 | `updater` → eventReset |

`getByAddress` / `setByAddress` / `traps/get` の 3 ファイルに 15 本が集まる。B6 の「書き込み境界 1 点」と同じ場所で、そこにフックの受け口を置けば webComponent / stream / watch / dcc の辺はまとめて消える。`devtools` は sink 1 点なので、no-op の sink を core に置くだけでよい。

追記（同日、§10.5）: S1 で `devtools` の 12 本は 1 本になり、S2 で `bootstrapState.ts` → watch / stream / volume の 3 本が入って、計 41 本。

### 3.4 循環

値 import だけで見た循環は 1 つ、28 モジュール・8 グループ。

| グループ | メンバー |
|---|---|
| `apply` | applyChange, applyChangeFromBindings, applyChangeToFor, applyChangeToIf, scheduleDeferredApply |
| `bindings` | BindingSession, binder, collectNodesAndBindingInfos, getParseBindTextResults, initialSync, initializeBindings |
| `structural` | activateContent, collectStructuralFragments, createContent, fragmentInfoByUUID, getFragmentNodeInfos, rowPlan |
| `event` | handler, twowayHandler, radioHandler, checkboxHandler, eventTokenHandler |
| `(root)` | buildBindings, hydrateBindings, stateElementByName |
| `binding` | getAbsoluteStateAddressByBinding |
| `components` | Ssr |
| `webComponent` | mountScope |

「束縛を作る → 行を作る → 行の中の束縛を作る」の再帰が循環の芯で、これは設計上の循環（テンプレートは入れ子になる）。切るべきは循環そのものではなく、`Ssr` と `mountScope` がこの輪に入っていること。原文解析で循環に入っていた `proxy` / `updater` / `watch` / `stream` / `scan` / `recursion` の 18 モジュールは型だけの import で、`import type` に書き換えれば静的にも消える。

## 4. T2 — 引用符を知る字句解析 → AST → 互換アダプタ

試作: [bindTextLexerSpike.mjs](../scripts/research/bindTextLexerSpike.mjs)。1 パスで文字を走査し、引用符の内側では `; : | # , ( )` を構造として扱わない。throw せず位置付きの診断を集め、フィルタの実関数は作らない。互換アダプタ: [bindTextAdapterSpike.mjs](../scripts/research/bindTextAdapterSpike.mjs)（69 行）。AST から現行の `IParsedBinding` を組み立て、PathInfo とフィルタ実関数は注入される。

### 4.1 監査の再現例に対する結果

| 入力 | 現行 | 試作 |
|---|---|---|
| `join(';')` `join('\|')` | エラー | 受理（B1） |
| `join('unterminated)` | 受理 | `E_QUOTE_UNTERMINATED`（B2） |
| `value#ro#wo: x` | `ro` だけ残す | `E_MODIFIER_SEPARATOR`（B2） |
| `else: ignored` | 右辺を捨てる | `E_ELSE_STATE_PART`（B2） |
| `join(a,b)` | 受理。キャッシュキーが `join('a,b')` と衝突 | `E_FILTER_ARITY`。キーは `["join",["a","b"]]`（B3） |
| `eq(1,2)` `eq()` | 受理 | `E_FILTER_ARITY`（B3） |
| `radio#ro: x` | 種別 `prop` | 種別 `radio`＋修飾子 `ro`（B4） |
| `checkbox\|int: values` | 種別 `prop` | 種別 `checkbox`＋入力フィルタ `int`（B4） |
| `for#x: items` | 受理 | `E_MODIFIER_NOT_ALLOWED` |
| `value#init: w` | 受理 | `E_MODIFIER_VALUE` |
| `join('a') extra` | 受理 | `E_FILTER_TRAILING` |
| `textContent:` | 受理（空パス） | `E_PATH_REQUIRED` |
| `x\|nope` | 解析時に throw | `W_FILTER_UNKNOWN`（実関数の解決は後段。アダプタは解決時に throw） |
| `only: x` `online: x` | イベント | イベント（B5 は名前空間の決定で、字句解析では解けない） |

B4 の実害: [applyChange.ts:43](../packages/state/src/apply/applyChange.ts#L43) は `bindingType` で `radio` の適用を選び、[checkboxHandler.ts:81](../packages/state/src/event/checkboxHandler.ts#L81) も `bindingType === "checkbox"` でハンドラを付ける。README が案内する `radio#ro` と `checkbox|int` は現行パーサで `prop` になるので、どちらも専用処理に乗らない。テスト・examples に該当する記述は無い。

### 4.2 corpus（150 ファイル・539 種）

| 判定 | 字句解析（射影のみ） | アダプタ（射影＋フィルタ関数の挙動） | 内訳 |
|---|---:|---:|---|
| 同一 | 523 | 523 | フィルタ関数の探針 8 値で挙動差 0 |
| 試作だけ拒否 | 6 | 6 | README の穴埋め表記（`if: …` `for:` `textContent:`）と地の文 |
| 現行だけ拒否 | 2 | 0 | 字句解析は `debounce(1000)` を警告止まり、アダプタは実関数の解決で現行と同じく throw |
| 両方拒否 | 8 | 10 | README の地の文を正規表現が拾ったものと、存在しないフィルタ |

試作が実際の用法を落とすケースは無かった。1 度だけ試作側の不備で `state: .`（行そのものを指す相対パス）を拒否し、修正して再計測した。

### 4.3 文法段のサイズ（同じ条件で束ねた minify 後）

| 対象 | bytes | gzip | Brotli |
|---|---:|---:|---:|
| 現行の文法段（`src/bindTextParser/` 単体、外部 import は external） | 3,863 | 1,693 | 1,452 |
| 試作の字句解析単体 | 6,197 | 2,764 | 2,463 |
| 試作＋互換アダプタ | 7,485 | 3,236 | 2,908 |
| 参考: 配布済み `parser.esm.js`（PathInfo・フィルタ実関数・キャッシュ込み） | 58,038 | 15,978 | 13,053 |

引用符処理・位置付き診断・アリティ検査・構造的キャッシュキーの代価は gzip で約 1.5 KB。`parser.esm.js` の大半（`filters/` 916 行と PathInfo）は文法段の外にあり、文法を書き換えてもサイズは減らない。D2 の「移行期間は旧文法を新 AST にパースする」は、このアダプタ（69 行）を互換面として置く形で成立する。

### 4.4 残る論点

- `on` 接頭辞（B5）と、フィルタ実関数の解決時機（解析時に throw するか、束縛計画の段で登録簿を引くか）。後者はカスタムフィルタと分割ロードの readiness に直結する（要件 §10）。
- 引用符内のバックスラッシュ escape は新しい意味。現行にはこの概念が無い。
- 位置情報付き診断を lint / `vscode-wcs` と共有する形式。

## 5. T3 — 依存グラフの機構

3 機構を同じスタブ DOM に対して動かした（[graph-mechanisms.json](./research/state-next/graph-mechanisms.json)）。P は現行設計の形（パターン単位の辺を書き込み時に全行へ展開し、行ごとに getter を評価して同値なら適用しない）、S は `@wcstack/signals` で行ごとに `computed` と `effect` を持つ形、K は「比較する鍵で購読を索引する」形。

### 5.1 時間（中央値 ms）

| 行数 | 機構 | build | 選択変更（評価回数） | 手動 2 行通知 | 10 行ごと更新 | 全置換 |
|---:|---|---:|---:|---:|---:|---:|
| 1,000 | P | 0.244 | 0.102（1,000） | 0.001（2） | 0.023 | 0.141 |
| 1,000 | S | 2.985 | 0.411（1,002） | — | 0.047 | 1.692 |
| 1,000 | K | 0.267 | 0.000（2） | — | 0.017 | 0.068 |
| 10,000 | P | 0.462 | 0.441（10,000） | 0.000（2） | 0.126 | 0.405 |
| 10,000 | S | 14.921 | 1.603（10,002） | — | 0.341 | 19.829 |
| 10,000 | K | 0.927 | 0.000（2） | — | 0.109 | 0.845 |

S の選択変更は同値短絡が効いて effect 本体は 2 行しか走らないが、`computed` の再計算は行数ぶん走る。「Signals に置き換えるだけでは依存は消えない」（監査 §4.2）はそのとおりで、消えるのは DOM 書き込みだけ。

### 5.2 メモリ（1 万行、行あたり bytes、GC 後）

| 束縛項目数 | P | S | K |
|---:|---:|---:|---:|
| 1 | 160 | 2,260 | 335 |
| 10 | 593 | 9,858 | 767 |

### 5.3 実ランタイムとの対応

監査 §4.2 の実ブラウザ計測は、追跡付き getter で 1.00 ms（1,000 行）／21.10 ms（1 万行）、手動 2 行通知で 0.10 ms。同じ O(N) 形の P モデルは 0.10 / 0.44 ms。差の内訳は T6（§8）で取れた: 展開の形ではなく、行あたりの定数（アドレス 6 個の生成・getter 読み 2 回・get トラップ 3 回・束縛検索と適用）が約 50 倍を作っている。

D7 に対する含意: 通常 getter の O(N) は機構を選んでも残る。O(1) が要るのは「値の比較で決まる行」で、それは鍵付き索引という別の購読形で提供する（fixture が手で書いている `$untrackDependency`＋2 行書き込みを API にする）。

## 6. T4 — DOM 操作の下限

ランタイム無し、中央値 7 回（[dom-floor.json](./research/state-next/dom-floor.json)）。比較列は監査 §4.1 の wcstack 2.5.0（Chromium）。

### 6.1 Chromium 149

| 操作 | 変種 | DOM 下限 ms（min–max） | wcstack ms |
|---|---|---:|---:|
| 1,000 行生成 | template clone＋子インデックス解決＋fragment | 3.90（3.7–5.1） | 42.85 |
| 〃 | `importNode` | 2.80 | |
| 〃 | clone＋`querySelectorAll` | 2.20 | |
| 〃 | clone＋TreeWalker | 2.50 | |
| 〃 | clone＋束縛レコード確保 | 3.90 | |
| 〃 | `innerHTML` | 6.30 | |
| 〃 | `createElement` | 5.90 | |
| 1 万行生成 | clone＋子インデックス＋fragment | 37.0（33.6–47.1） | — |
| 〃 | clone、fragment 無し | 31.3（16.9–44.6） | |
| 〃 | clone＋束縛レコード確保 | 23.5（18.1–42.6） | |
| 〃 | プールから再利用 | 18.1（17.1–25.9） | |
| 〃 | `innerHTML` | 55.9 | |
| 〃 | `createElement` | 40.0（25.1–63.4） | |
| 1 万行へ 1,000 行追加 | clone＋fragment | 2.40（2.0–4.7） | 66.00 |
| 1 万行消去 | `replaceChildren()` | 38.4（5.1–48.6） | 72.95 |
| 〃 | `textContent = ''` | 42.9（5.8–48.0） | |
| 〃 | `innerHTML = ''` | 30.1（4.7–45.6） | |
| 〃 | `Range.deleteContents()` | 42.9（9.0–55.4） | |
| 〃 | 末尾から `remove()` | 37.3（12.0–57.0） | |
| 10 行ごと更新（1,000 行） | `Text.data` / `nodeValue` / `textContent` | 1.90 / 2.00 / 2.00 | 13.10 |
| 選択変更（クラス） | `classList` / `className` | 0.00 | 0.10（手動） |
| 2 行交換（1,000 行） | `insertBefore` ×2 / `moveBefore` ×2 | 0.00 / 0.00 | 1.30 |
| 1 行削除（1,000 行） | `remove()` | 0.10 | 3.15 |
| CPU 4 倍: 1 万行生成 / 1,000 行追加 / 1 万行消去 | clone / clone / `replaceChildren` | 145.5 / 17.2 / 180.1 | — / 320.7 / 329.6 |

### 6.2 Firefox 151 と WebKit 26.5（代表操作のみ）

| 操作 | Chromium 149 | Firefox 151 | WebKit 26.5 |
|---|---:|---:|---:|
| 1,000 行生成（clone） | 3.9 | 6.0 | 4.0 |
| 1 万行生成（clone） | 37.0 | 89.0 | 49.0 |
| 1 万行へ 1,000 行追加 | 2.4 | 9.0 | 5.0 |
| 1 万行消去（`replaceChildren`） | 38.4 | 130.0 | 40.0 |
| 2 行交換 `insertBefore` / `moveBefore` | 0.0 / 0.0 | 1.0 / 0.0 | 0.0 / 無し |

### 6.3 監査ベンチの再走行（配布済み `auto.min.js`、8 標本の中央値 ms）

| 操作 | 監査（2026-09-18） | 再走行（2026-09-20） | 再走行 min–max |
|---|---:|---:|---:|
| 1,000 行生成 | 42.85 | 40.05 | 34.4–60.8 |
| 1,000 行全置換 | 24.35 | 17.2 | 12.8–26.7 |
| 10 行ごと更新（1 万行） | 13.10 | 12.95 | 10.7–15.9 |
| 選択変更（手動、1,000 行） | 0.10 | 0.10 | 0.1–0.2 |
| 2 行交換（1,000 行） | 1.30 | 0.90 | 0.8–1.3 |
| 1 行削除（1,000 行） | 3.15 | 2.85 | 2.5–3.5 |
| 1 万行へ 1,000 行追加 | 66.00 | 57.7 | 42.4–71.0 |
| 1 万行消去 | 72.95 | 69.8 | 53.5–88.4 |

- 生成の差（Chromium 1,000 行で約 7〜19 倍）は束縛の初期化と行の登録にある。1 万行の変動幅（33.6〜47.1、前回走行では 19.8〜45.5）は GC で、監査の「行生成・初期化の割り当て」候補と整合する。T6 第 3 段で、行あたりの DOM 複製 2.5 µs に対し帳簿作業が約 20 µs だと分かった。
- 消去の DOM 下限が中央値 30〜43 ms・最小 5〜12 ms に割れるのは、行が描画済みかどうかで決まる（§8.6）。ランタイムの消去 70 ms との差 30〜40 ms は、レイアウト済み行の取り外しの費用で、エンジンの費用ではない。
- 追加は DOM 2.4 ms 対 wcstack 57.7〜66.0 ms。T6 で、この差が展開ではなく行の生成・初期化・活性化にあることを確認した。
- `moveBefore` の探針: `insertBefore` は `<input>` のフォーカスを失い（値と選択範囲は保つ）、カスタム要素に disconnected / connected が 1 回ずつ入る。`moveBefore` は Chromium / Firefox ともフォーカスと選択範囲を保つが、`connectedMoveCallback` を定義しないカスタム要素には同じく disconnected / connected が入る（仕様どおり）。WebKit 26.5 には `moveBefore` が無い。keyed 移動で使うなら機能検出と `insertBefore` fallback が要り、I/O ノードに `connectedMoveCallback` を足すかどうかは別に決める。

## 7. T5 — 2026-09 のプラットフォーム

全 24 項目の表・出典は [platform-status-2026-09.md](./research/state-next/platform-status-2026-09.md)。ここでは設計に関わるものだけ。

| 機能 | 状態 | 次期メジャーへの含意 |
|---|---|---|
| TC39 Signals | Stage 1（2024-06 以降進展なし、`signal-polyfill` 0.2.2 で停止） | 反応コアは自前のまま。API 形を TC39 に寄せる方針（signals パッケージ）は維持できる |
| DOM Parts / Template Instantiation | 未出荷。後継案も「レビュー前」 | template plan と行インスタンスは自前 |
| `Element.moveBefore()` | Chrome 133 / Firefox 144、WebKit 未（T4 で実確認） | 機能検出で使い、`insertBefore` に fallback。state 保持の契約には頼らない |
| Scoped Custom Element Registries | Chrome 146 / Safari 26、Firefox は Nightly のみ | autoloader / DCC の前提にできない |
| import map `integrity` | 3 エンジン | 分割配布の動的チャンクにも SRI を張れる（要件 §10・[sri](./sri.ja.md)）。複数 import map は Firefox が flag |
| Navigation API | Firefox 147 / Safari 26.2 で Baseline Newly（2026-01） | router の popstate fallback を残す期間の判断材料 |
| `AbortSignal.any()` / `timeout()` | Widely 目前（2026-09-19 / 10-18） | cancel の標準語彙に採用できる（評議会 C 派の資産） |
| `Temporal` | Chrome 144 / Firefox 139、Safari は STP のみ | 日時フィルタは `Intl` のまま |
| Explicit Resource Management（`using`） | Chrome 134 / Firefox 141、Safari は preview | dispose API の公開形には使えない |
| Observable | Chrome のみ、Mozilla が negative | イベント→signal の橋は自前のまま |
| `setHTMLUnsafe` / `parseHTMLUnsafe` | Newly 2025-09 | SSR ハイドレーションの declarative shadow DOM 解析に使える |
| Sanitizer `setHTML()` | Chrome 146 / Firefox 148、Safari 未 | `html:` 束縛の既定にはできない |
| Invoker commands（`command` / `commandfor`） | Newly 2025-12 | command-token protocol と語彙が衝突し得る。名前の整理で意識する |
| Declarative Shadow DOM | Widely 2026-08 | SSR の前提にしてよい |

## 8. T6 — 実ランタイムの計数

監査の fixture を、計数器を差し込んだ一時ビルドで動かした（Chromium 149）。第 1 段は展開・アドレス・読み・適用（[runtime-counters.json](./research/state-next/runtime-counters.json)）、第 2 段はリスト適用の内部と書き込み側（[runtime-counters-list.json](./research/state-next/runtime-counters-list.json)）、第 3 段は行コンテンツ生成の内部（[runtime-counters-content.json](./research/state-next/runtime-counters-content.json)）。`tracked` は普通の追跡付き getter、`manual` は fixture の手書き 2 行通知。時間はラッパー込みで、段の間でも比較しない。

### 8.1 第 1 段: 展開・アドレス・読み・適用

| 操作（行数） | 経過 ms | walk 回 / ms | enqueue | getter 読み / 評価 | アドレス生成（state / abs / tree） | 束縛適用 | 適用 ms | drain ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1,000 行生成 | 34.1 | 1 / 4.6 | 4,001 | 7,004 / 6,004 | 12,003 / 11,002 / 14,002 | 3,001 | 25.9 | 27.5 |
| 1 万行生成 | 277.7 | 1 / 20.5 | 40,001 | 70,004 / 60,004 | 120,003 / 110,002 / 140,002 | 30,001 | 246.4 | 251.3 |
| 選択変更 tracked（1,000） | 1.8 | 1 / 0.4 | 1,001 | 2,003 / 2,003 | 2,003 / 2,002 / 2,002 | 1,000 | 1.2 | 1.5 |
| 選択変更 tracked（1 万） | 24.4 | 1 / 4.6 | 10,001 | 20,003 / 20,003 | 20,003 / 20,002 / 20,002 | 10,000 | 16.7 | 19.7 |
| 選択変更 manual（1 万） | 0.1 | 4 / 0.0 | 4 | 14 / 12 | 12 / 8 / 8 | 2 | 0.0 | 0.0 |
| 10 行ごと更新（1 万） | 11.0 | 1,000 / 0.2 | 1,000 | 6,002 / 3,002 | 5,002 / 4,000 / 4,000 | 1,000 | 3.0 | 4.0 |
| 1,000 行追加（1 万→11,000） | 67.0 | 1 / 5.2 | 4,001 | 7,004 / 6,004 | 12,003 / 11,002 / 14,002 | 3,001 | 53.6 | 54.8 |
| 2 行交換（11,000） | 13.5 | 1 / 4.5 | 3 | 9 / 9 | 8 / 6 / 6 | 3 | 8.5 | 8.6 |
| 1 行削除（11,000） | 43.8 | 1 / 12.9 | 11,000 | 22,002 / 22,002 | 22,001 / 22,000 / 22,000 | 11,000 | 21.3 | 25.5 |
| 消去（11,000→0） | 37.9 | 2 / 1.4 | 2 | 5 / 5 | 4 / 4 / 4 | 1 | 29.9 | 29.9 |

getter 読みの時間: 選択 1 万行 9.7 ms、1 万行生成 23.1 ms、1,000 行追加 5.8 ms、1 行削除 9.7 ms、10 行ごと更新 2.3 ms。

### 8.2 第 2 段: リスト適用の内部と書き込み側

「書き込み側」は set トラップに入ってから戻るまで（`setByAddress` と依存 walk と enqueue を含む同期部分）。

| 操作（行数） | 経過 ms | 書き込み側 ms | うち walk ms | drain ms | リスト適用 ms | diff 回 / ms | listIndex 生成 | 行コンテンツ生成 回 / ms | 行初期化 回 / ms | 活性化 / 非活性化 | プール投入 | get トラップ |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1,000 行生成 | 53.1 | 7.9 | 7.1 | 42.4 | 40.6 | 2 / 0.9 | 1,000 | 1,000 / 21.1 | 1,000 / 7.4 | 1,000 / 0 | 0 | 5,004 |
| 1 万行生成（1,000 行はプール再利用） | 335.0 | 29.9 | 29.7 | 298.4 | 285.8 | 2 / 2.5 | 10,000 | 9,000 / 128.3 | 9,000 / 39.7 | 10,000 / 0 | 0 | 50,004 |
| 選択変更 tracked（1 万） | 12.3 | 3.2 | 3.0 | 9.3 | — | 1 / 0.2 | 0 | 0 | 0 | 0 / 0 | 0 | 30,003 |
| 10 行ごと更新（1 万） | 8.9 | 2.4 | 0.4 | 2.7 | — | 0 | 0 | 0 | 0 | 0 / 0 | 0 | 3,003 |
| 1,000 行追加（1 万→11,000） | 44.1 | 3.5 | 3.5 | 33.0 | 32.2 | 2 / 2.8 | 1,000 | 1,000 / 14.3 | 1,000 / 5.1 | 1,000 / 0 | 0 | 5,005 |
| 2 行交換（11,000） | 8.5 | 2.4 | 2.4 | 5.9 | 5.9 | 2 / 2.3 | 0 | 0 | 0 | 0 / 0 | 0 | 12 |
| 1 行削除（11,000） | 28.1 | 8.3 | 8.3 | 15.1 | 2.2 | 2 / 2.5 | 0 | 0 | 0 | 0 / 1 | 1 | 33,002 |
| 消去（11,000→0） | 26.8 | 1.0 | 1.0 | 21.1 | 21.1 | 3 / 1.1 | 0 | 0 | 0 | 0 / 999 | 999 | 5 |

### 8.3 第 3 段: 行コンテンツ生成の内部（プラン経路）

1 万行生成・追加・消去は 3 標本の中央値。1,000 行生成は 5 標本を順に示す（初回は 1,000 行を新規生成、2 回目以降は直前の消去でプールに入った 1,000 行を再利用するのでコンテンツ生成が 0 回）。

| 操作（行数） | 経過 ms | リスト適用 ms | コンテンツ生成 回 / ms | うち template 複製 ms | うちノードパス解決 回 / ms | うち行束縛と record ms（イベント付与 回 / ms） | 活性化 ms（うちプラン行 ms） | listIndex ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1,000 行生成 1 回目 | 64.8 | 50.9 | 1,000 / 29.2 | 5.4 | 5,005 / 4.3 | 12.5（2,000 / 2.1） | 16.5（4.4） | 0.9 |
| 〃 2〜5 回目（プール再利用） | 27.2 → 22.3 → 12.4 → 11.7 | 22.3 → 9.5 | 0 / 0 | 0 | 0 | 0（2,000 / 1.7 → 0.9） | 15.2 → 7.5（5.8 → 3.6） | 0.3 → 0.2 |
| 1 万行生成（9,000 行新規） | 302.1 | 280.8 | 9,000 / 144.8 | 22.6 | 45,000 / 17.5 | 44.4（20,000 / 11.6） | 105.3（26.9） | 1.0 |
| 1,000 行追加（1 万→11,000） | 45.3 | 33.6 | 1,000 / 16.6 | 2.4 | 5,000 / 2.5 | 5.3（2,000 / 1.4） | 16.3（5.2） | 0.1 |
| 消去（11,000→0） | 27.7 | 20.9 | 0 | 0 | 0 | 0 | 0 | 0 |

### 8.4 読み取り

- **選択変更（tracked、1 万行）**: 第 2 段で 12.3 ms ＝ 書き込み側 3.2（walk 3.0）＋ drain 9.3（束縛適用 7.1、その前後の 2.2 は updater の重複排除と束縛集合の解決）。第 1 段の比率では適用 16.7 ms のうち getter 読みが 9.7 ms。行あたり enqueue 1・getter 読み 2・get トラップ 3・アドレス生成 6（state 2・absolute 2・tree path 2）・resolved 1・束縛検索 1・適用 1。T3 の P モデル（行あたり評価 1・割り当て 0）との約 50 倍差は、この行あたりの定数で説明できる。
- **生成（1 万行、行あたり）**: リスト適用 281 ms ＝ 28 µs/行。内訳はコンテンツ生成 16 µs（template 複製 2.5・ノードパス解決 1.9・束縛 record とイベント付与 4.9・台帳登録と束縛オブジェクトの複製 約 6.5）＋ 活性化 10.5 µs（プラン行の登録 2.7、残り約 8 µs は 3 束縛の初期適用。**訂正**: 当初「loop context と session の紐付け」と書いたが、§10.7 で `applyChange` と読みを計数したところ、行あたり読み 7 回・適用 3 回の初期描画だった）＋ DOM 挿入・diff・残り 約 3。DOM 下限は 2〜4 µs/行なので、複製そのものは下限と同じで、残り約 24 µs のうち帳簿は約 16 µs、初期適用が約 8 µs。第 1 段の回数では行あたり 4 enqueue・7 読み・6 評価・37 個のアドレスオブジェクト・3 適用。
- **プールと JIT**: 消去でプールに入った 1,000 行を再利用する生成は 27 → 12 ms と回を追って下がり、初回 65 ms の 1/5。配布済みバンドルでも warm の 1,000 行生成は 13〜20 ms、cold は 35〜65 ms（§8.5）。プール上限（1,000）を超える行は毎回新規生成になるので、1 万行では効かない。
- **追加**: 展開は新規 1,000 行ぶん（1,000 行生成と同じ回数、diff 展開は機能している）。適用 33.6 ms ＝ コンテンツ 16.6＋活性化 16.3＋残り。第 1 段で見えた 53.6 ms（1,000 行生成の 2 倍）は第 2・3 段では再現せず、単独標本の GC ばらつきと判断する。**「既存行数に比例する 28 ms」は取り消す。** 配布済みバンドルの warm 追加には 140〜470 ms の GC スパイクが混じる（§8.5）。
- **1 行削除**: walk 8.3 ms（diff 込み、11,000 行 enqueue）、行束縛の適用 10.4 ms、リスト適用 2.2 ms。位置が変わった行は「index を読む getter」だけ再評価する設計（`walkDependency` の movedRows）だが、この fixture の `selected` getter は `$1` を読むので全行が該当する。DOM 下限は 0.1 ms。
- **2 行交換**: diff は walk と適用で 1 回ずつ（計 2.3 ms、監査 §4.3 の「二重 diff」）。残り 4.7 ms は行の移動・listIndex の retire / revive・DOM の移動で、diff の共有より大きい。
- **10 行ごと更新**: 書き込み側 1,000 回で 2.4 ms（1 回 2.4 µs。walk は計 0.4 ms）。第 1 段で 7 µs と読んだのはアドレス生成のラッパー込みの値で、訂正する。drain 2.7 ms。残り約 4 ms は fixture のループと get トラップ（`+=` の読み）。
- **消去**: リスト適用 19〜25 ms（第 2・3 段の 4 標本）で、非活性化・session の dispose・プール投入は 999 行（プール上限）、残る 10,000 行は台帳ごと破棄。外から測った消去が 27 ms か 70 ms かは、行が描画済みかどうかで決まる（§8.5・§8.6）。

### 8.5 消去の二峰性の切り分け（[warm-vs-cold-*.json](./research/state-next/)、配布済みバンドル基準、各 6 標本の中央値 ms）

計数器付きハーネスは消去を 27〜30 ms、監査ベンチは 70 ms と報告した。ベンチと同じ計時関数で条件を 1 つずつ入れ替えた。cold は標本ごとにページを読み直し、warm は同一ページで連続。

| バンドル / fixture / 直前の操作列 / 計時 / setup / GC | 消去 cold | 消去 warm | 1,000 行生成 cold / warm | 追加 cold / warm |
|---|---:|---:|---:|---:|
| `auto.min.js` / manual / plain / ベンチ式 / 実クリック / なし（ベンチと同条件） | 67.3 | 62.0 | 50.5 / 19.8 | 50.1 / 58.7 |
| 無 minify `index.esm.js` / manual / plain / ベンチ式 | 67.7 | 53.1 | 35.4 / 13.1 | 47.0 / 66.4 |
| 計数器付きビルド / manual / plain / ベンチ式 | 68.1 | 68.2 | 65.4 / 22.4 | 60.4 / 59.5 |
| `auto.min.js` / tracked / plain / ベンチ式 | 67.3 | 73.3 | 53.1 / 19.2 | — |
| `auto.min.js` / manual / 計数器と同じ操作列（11,000 行） / ベンチ式 | 77.1 | 78.6 | — | — |
| `auto.min.js` / manual / plain / 計数器式（tbody 監視） | 57.9 | 68.2 | 52.1 / 18.9 | 58.0 / 58.0 |
| `auto.min.js` / manual / plain / 次のマクロタスクまで | 68.2 | 69.7 | 106.1 / 68.2 | 61.0 / 229.2 |
| `auto.min.js` / manual / plain / ベンチ式 / 合成クリック setup | 64.2 | 66.2 | 41.7 / 20.4 | 60.9 / 61.6 |
| `auto.min.js` / manual / plain / ベンチ式 / 実クリック / GC 強制 | 72.6 | 69.1 | — | 68.2 / 221.6 |
| 計数器付きビルド / tracked / 計数器の操作列 / 計数器式 / 合成クリック（全部揃える） | 79.4（最小 25.2） | 82.7 | — | — |

- どの条件でも消去の中央値は 53〜83 ms で、計数器付きハーネスの 27〜30 ms は再現しない。全条件を揃えた cold の 1 標本だけが 25.2 ms だった。原因は §8.6 で特定した。
- ページの温まりが効くのは 1,000 行生成だけ（cold 35〜65 → warm 13〜22 ms。プール再利用と JIT）。監査ベンチは cold で測るので、生成 40 ms は「毎回新規生成」の値。
- 追加の warm には 140〜470 ms の GC スパイクが混じり、GC 強制後はむしろ悪化した。追加・消去の比較は cold の中央値で行い、warm は使わない。

### 8.6 トレースとフレーム実験: 二峰の正体はレイアウト済み行の取り外し

- 計数器付きハーネス（第 3 段）に CDP トレースを付けると、消去の経過は 57〜76 ms、内部の drain は 51〜67 ms に上がり、計時窓の内訳は `FunctionCall` 53〜70 ms・`Layout` 0・GC 0（[runtime-counters-content-trace.json](./research/state-next/runtime-counters-content-trace.json)）。差は描画パイプラインの独立したイベントではなく、スクリプトが呼ぶ DOM 操作の内側にある。
- フレーム実験（[frame-vs-clear.json](./research/state-next/frame-vs-clear.json)、標本ごとに新規ページ、6 標本の中央値 ms、括弧は min–max）:

| ページ | 生成 → 即消去（同一タスク） | 生成 → rAF ×2 → 消去 | 生成 → `setTimeout(0)` → 消去 |
|---|---:|---:|---:|
| ランタイム無し、`replaceChildren()` を同期計時 | 3.6（3.2–3.8） | 28.1（24.9–37.7） | 35.8（2.7–43.1） |
| 配布済みランタイム、クリック → MutationObserver | 66.7（27.2–71.0） | 49.5（47.5–74.7） | 52.4（48.1–55.5） |

- ランタイム無しでは、フレームが描画されたかで 3.6 ms と 28 ms に割れる。描画されると行にレイアウトオブジェクトが付き、その取り外しに約 25〜40 ms かかる。`setTimeout(0)` では描画される場合とされない場合があり（2.7〜43.1）、T4 の消去の二峰性（最小 5・中央値 38）もこれで説明できる。
- 配布済みランタイムは即消去でも 6 標本中 5 標本が高い側（低い側は 27.2 の 1 標本）。ランタイムの生成処理のどこかがレイアウトを強制している可能性があるが未確認。計数器付きハーネスで低い側が続いた理由は「その走行では行が描画される前に消去された」と読むのが自然で、トレースを付けると（処理が遅くなりフレームが挟まって）高い側になったことと整合する。
  - 追記（§10.6）: `blink` カテゴリ込みのトレースで確認した。生成中にレイアウトを強制する読み取りは**なく**（Layout 系イベント 0 件）、即消去の高い側は消去の窓に V8 の scavenge（22〜35 ms）が落ちるかどうかで決まる。
- 結論: 利用者が見る画面では行は必ず描画済みなので、**高い側が現実の値**。エンジンの取り分は drain の 19〜25 ms で、残り約 40 ms はレイアウト済み 1 万行の取り外しというプラットフォームの費用。A3 の「25% 改善」は監査ベンチの cold・描画済みの値（70 ms）を分母にし、改善余地はエンジン分（約 3 割）だけと明記する。

## 9. T7 — スタブ化ビルドの残量

名前付きエントリを、機能群のモジュールを export 名だけ残したスタブに置き換えてビルドし、minify 後の圧縮サイズを測った（[split-stub-sizes.json](./research/state-next/split-stub-sizes.json)）。累積で切る。

| 切った機能群（累積） | スタブ化モジュール | minify bytes | gzip | Brotli | gzip の減少 |
|---|---:|---:|---:|---:|---:|
| なし（full） | 0 | 243,535 | 71,063 | 60,088 | — |
| devtools | 2 | 239,836 | 69,764 | 59,030 | 1,299 |
| ＋ 時間系（watch / scan / stream） | 15 | 212,990 | 62,113 | 52,724 | 7,651 |
| ＋ 再帰（recursion） | 21 | 198,409 | 57,788 | 49,124 | 4,325 |
| ＋ コンポーネントスコープ（webComponent / dcc） | 34 | 169,126 | 49,338 | 42,398 | 8,450 |
| ＋ SSR（Ssr / buildSsrDocument / hydrate） | 37 | 158,581 | 46,605 | 40,143 | 2,733 |
| ＋ 書式フィルタ（filters） | 39 | 147,630 | 44,028 | 38,037 | 2,577 |

### 9.1 残り 147,630 bytes の帰属（ソースマップ、minify bytes）

| グループ | bytes | 割合 | 最大のファイル |
|---|---:|---:|---|
| `bindings` | 21,323 | 14.4% | BindingSession.ts 12,883、initialSync.ts 2,452 |
| `components` | 18,771 | 12.7% | State.ts 18,761 |
| `proxy` | 18,743 | 12.7% | setByAddress.ts 4,806、StateHandler.ts 2,212、traps/get.ts 1,980、getByAddress.ts 1,594 |
| `apply` | 16,024 | 10.9% | applyChangeToFor.ts 3,890、applyChangeToProperty.ts 2,110、applyChange.ts 2,051、applyChangeFromBindings.ts 1,880 |
| `event` | 11,937 | 8.1% | twowayHandler.ts 3,784、eventTokenHandler.ts 1,478、handler.ts 1,436、checkboxHandler.ts 1,320 |
| `(root)` | 11,665 | 7.9% | pathDiagnostics.ts 3,567、config.ts 1,626、stateElementByName.ts 1,428 |
| `list` | 10,412 | 7.1% | createListDiff.ts 1,947、createListIndex.ts 1,760、mergeKeyedList.ts 1,410 |
| `structural` | 9,161 | 6.2% | createContent.ts 3,465、collectStructuralFragments.ts 2,178 |
| `bindTextParser` | 5,222 | 3.5% | expandSpread.ts 1,907、parseBindTextsForElement.ts 1,300 |
| `dependency` | 4,373 | 3.0% | walkDependency.ts 3,547 |
| `address` | 3,995 | 2.7% | PathInfo.ts 1,732 |
| `protocol` / `updater` / `contract` / `binding` / `stateLoader` / `command` / `mustache` / `propagation` | 2,217 / 2,126 / 1,863 / 1,822 / 1,759 / 1,431 / 1,026 / 911 | 9.0% | contractAnalyzer.ts 1,863、wcBindableReader.ts 1,318 |
| スタブと残り | 約 1,300 | 0.9% | |

### 9.2 メンバー単位の帰属（full ビルド、minify bytes、[member-attribution.json](./research/state-next/member-attribution.json)）

`State.ts`: 18,714 bytes・127 メンバー。**機能群（webComponent / dcc / stream / watch / scan / stateLoader / command / recursion）を参照するメンバーが 10,142 bytes（54%）。**

| メンバー | bytes | 参照する機能群 |
|---|---:|---|
| `connectedCallback` | 2,742 | stream, watch, webComponent |
| `_initializeBindWebComponent` | 2,343 | webComponent |
| `_state` getter / setter | 1,201 / 1,201 | setter: command, event, list, recursion, scan, stream, watch |
| `_initializeVolume` | 1,074 | webComponent |
| `setInitialState` | 1,055 | （apply のみ） |
| `_loadStateFromSource` | 697 | stateLoader |
| `reportVolumeWithoutRoot` | 687 | （診断文言） |
| `disconnectedCallback` | 625 | command, stream, watch, webComponent |
| `setPathInfo` | 545 | （address のみ） |
| `_initializeDCC` | 503 | dcc, stateLoader |
| `_initialize` / `_failInitializeLoudly` / `attributeChangedCallback` / `_acquireVolumeSlot` / `constructor` | 468 / 398 / 347 / 339 / 334 | `_failInitializeLoudly` と `_acquireVolumeSlot` は webComponent |

責務でまとめると、volume / mount / DCC の配線（`_initializeBindWebComponent`・`_initializeVolume`・`reportVolumeWithoutRoot`・`_initializeDCC`・`_failInitializeLoudly`・`_acquireVolumeSlot`・`mergeVolumeListKeys`・`_releaseVolumeSlot`・`addVolumeWatchPaths`）が約 5,900 bytes（31%）、ライフサイクル（connected / disconnected / attributeChanged / `_initialize` / constructor）が約 4,700 bytes で、そのうち connected / disconnected は stream / watch の起動と停止を直接呼ぶ。宣言処理（`_state` の get / set・`setPathInfo`・`defineTreeAccessor`・`_rebuildPathInfo`）が約 3,300 bytes、外部ソースと SSR からの読込が約 900 bytes。

`BindingSession.ts`: 12,886 bytes・60 メンバー。**機能群を参照するメンバーは 0**（bindings / event / platform / binding / list / address / apply のみ）。DOM アダプタの芯そのもので、プラン経路（`initializeRow` 827・`activatePlanRows` 721・`addKnownRowBinding` 271・`knownMapFor` 219 ＝ 約 2,000）と汎用経路（`initialize` 566・`activate` 568・`settleInitialRecord` 558・`attachAfterDefinition` 608・`deferUntilDefined` 485・`registerAddress` 522・`rebindAddresses` 503・`attachListeners` 466・`shouldApplyState` 412・`settleConnectedSnapshot` 248 ＝ 約 4,900）が並存し、MutationObserver 系（`handleAddedNode`・`handleRemovedNode`・`BindingOwner.handleMutations`・`handleMutations` ＝ 約 1,240）が続く。record は 25 項目。

`setByAddress.ts`（4,827 bytes）は `setByAddressCore` 1,921 が dcc / devtools / webComponent を、`notifySwappedList` 602 が watch を参照し、**55% が機能群に触れる**。B6 の書き込み境界 1 点化と T1 §3.3 のフック受け口は、この 2 関数に対応する。`applyChangeToFor`（4,063 bytes）は本体 2,466 が webComponent（mountScope）を参照する。`twowayHandler.ts`（3,808 bytes）はハンドラ 1,310 が devtools を、`warnDefaultGetterMismatch` 719 が診断文言を持つ。

- `State.ts` の 54% と `setByAddress.ts` の 55% は、T1 の切断リストと同じ場所（volume / mount / DCC / stream / watch の配線と devtools sink）にある。ここを機能側の登録に置き換えると、`State.ts` 単体で最大 10 KB（minify）、core 全体で 10〜13 KB が機能側へ移る。
- gzip 35 KB は、この残量の圧縮率（約 30%）では minify 約 117 KB に相当し、約 30 KB の削減が要る。配線の切り出し 10〜13 KB、診断文言（`pathDiagnostics.ts` 3.6 KB・`reportVolumeWithoutRoot` 0.7 KB・`warnDefaultGetterMismatch` 0.7 KB）の dev ビルド分離約 5 KB、wc-bindable の契約解析（`contractAnalyzer`・`wcBindableReader`・`expandSpread`・`protocol` ＝ 約 7 KB）の adapter 分離、`BindingSession` の二重経路の一本化（約 2〜3 KB）を合わせて、初めて 30 KB が視野に入る。
- スタブは core 側の呼び出し箇所を残すので、実際に辺を切れば少しだけ小さくなる。逆に、切った機能を別チャンクで読み込めば合計は full を超える（要件 §10 の「分割は圧縮率を下げる」）。減り方は監査 §3.2 のソースマップ帰属と整合する。

## 10. 試作の実測（§11 の 1〜5）

§11 の 1〜5 を順に進めた（見出しの「§11 の n」は着手時の番号。§11 は結果を受けて書き直してある）。1・2・3 はリポジトリを触らず、`packages/state` をスクラッチ領域へ複製したサンドボックスに対して行った（10.1・10.2・10.4）。配線分離は設計案として別文書に起こし（10.3、[state-next-major-wiring-design.ja.md](./state-next-major-wiring-design.ja.md)）、その S1・S2 だけはリポジトリの `packages/state` に実装した（10.5、未コミット）。

### 10.1 鍵付き購読 `$eq(path, key)`（§11 の 1）

試作: [keyedPrototypePatch.mjs](../scripts/research/keyedPrototypePatch.mjs)（サンドボックスへの差し込み。アンカーが 1 回だけ一致しなければ失敗する）と、サンドボックス内の新規モジュール `dependency/keyedDependency.ts`（73 行。追記の遅延解除を足した現在は 99 行）。`$eq(path, key)` は `path` を依存を張らずに読み、評価中の getter の行アドレスを「`path` の値が `key` に等しいか」の鍵で購読し、`Object.is(value, key)` を返す。書き込み側は same-value guard が読んだ旧値と新値の鍵に登録された行だけをキャッシュ無効化＋enqueue する（`setByAddress` の fast path と通常経路に 1 行ずつ）。パターン辺は張られないので全行展開は起きない。

- サンドボックスの全テスト 304 ファイル・3,650 件が成功（既存挙動の変化なし）。`auto.min.js` は gzip +296 bytes。
- fixture の変種: `keyed` は `get "data.*.selected"() { return this.$eq("selectedIndex", this.$1); }`、`keyedId` は `this.$eq("selectedId", this["data.*.id"])` と `onSelect` で行 id を書く形。

| バンドル / 変種 | 選択変更 1,000 行 | 選択変更 1 万行 | 1 行削除 1,000 / 1 万行 | 交換 1,000 行 | 削除後の選択 |
|---|---:|---:|---:|---:|---|
| 配布済み / manual（手書き 2 行通知） | 0.10 | 0.30 | 2.6 / 38.5 | 0.5 | index に付く |
| 配布済み / tracked（追跡 getter） | 1.80 | 20.05 | 3.4 / 34.5 | 1.0 | index に付く |
| 試作 / tracked | 2.00 | 20.2 | 4.9 / 34.5 | 1.1 | index に付く |
| 試作 / keyed（`$eq` × `$1`） | 0.10 | 0.20 | 4.3 / 45.7 | 1.1 | index に付く |
| 試作 / keyedId（`$eq` × 行 id） | 0.10 | 0.25 | 4.1 / 46.5 | 4.6 | **id に付く** |

（[keyed-prototype.json](./research/state-next/keyed-prototype.json)、ベンチと同じ計時、warm 10 標本の中央値 ms。各選択後に選択行が 1 行だけで正しい行であることを検証）

- 選択変更は 1 万行で 20 ms → 0.2 ms となり、fixture の手書き最適化（0.3 ms）と同じ水準。D7 の「最適化された選択を API で支援する」は `$eq` の形で、利用者に `$untrackDependency`＋2 行書き込みを要求せずに成立する。
- 1 行削除は全変種で 34〜47 ms のままで、`$eq` では減らない。getter の再評価ではなく、行の移動に伴う帳簿（listIndex の付け直し・台帳・DOM 移動）が支配的。行 id で鍵付けした `keyedId` は削除後も選択が同じ行に付いて行くが、交換が 4.6 ms に増える（`data.*.id` への動的依存の分。未調査）。
- 試作の限界: Map の鍵比較は SameValueZero。破棄された行の購読は当初残していたが、追記のとおり遅延解除を足した。

追記（§11 の 1 の続き）。計数器の第 2 段（§8.2 と同じ計装）を試作ビルドに当てた（[runtime-counters-list-tracked-proto.json](./research/state-next/runtime-counters-list-tracked-proto.json) / [-keyed-proto.json](./research/state-next/runtime-counters-list-keyed-proto.json) / [-keyedId-proto.json](./research/state-next/runtime-counters-list-keyedId-proto.json)、計数ビルドなので経過 ms はベンチ計時より大きい）。

| 変種 / 操作 | 経過 ms | enqueue | get トラップ |
|---|---:|---:|---:|
| tracked / 選択変更 1 万行 | 13.1 | 10,001 | 30,003 |
| keyed / 選択変更 1 万行 | 0.1 | 3 | 10 |
| keyedId / 選択変更 1 万行 | 0.2 | 3 | 11 |
| tracked / 交換 | 6.4 | 3 | 12 |
| keyed / 交換 | 11.4 | 3 | 14 |
| keyedId / 交換 | 75.0 | 11,001 | 44,007 |
| tracked / 追加 1,000 行 | 46.4 | 4,001 | 5,005 |
| keyedId / 追加 1,000 行 | 112.4 | 14,001 | 46,006 |
| tracked / 1 行削除 | 30.1 | 11,000 | 33,002 |
| keyed / 1 行削除 | 57.6 | 11,000 | 44,001 |

- 選択変更 20 ms → 0.2 ms の正体は展開の消失（enqueue 10,001 → 3: `selectedIndex`・旧行・新行）で、getter の評価そのものは残る。
- `keyedId` の交換が増える理由: getter が `this["data.*.id"]` を追跡付きで読むため `data.*.id → data.*.selected` のパターン辺が張られ、リストの置換（交換・追加）でその辺が全行に展開される（`keyed` は `$1` を読むだけなので enqueue 3 のまま）。行 id の読みも依存を張らずに鍵へ渡す形（`$eq("selectedId", "data.*.id")` のようにパスで受ける）にしないと、鍵付き購読の効果が置換で消える。要件に「行ローカルな依存（index 付き）はパターン辺に昇格させない」を足す必要がある。
- 1 行削除は `keyed` でも enqueue 11,000。削除で全行の `$1` が変わり getter は全行再評価されるため、`$eq` の再登録（Map の付け替え）が 1 行 1〜2 µs 乗る（計数ビルドの drain 39.3 ms 対 16.2 ms、ベンチ計時 45.7 対 34.5）。行の同一性を index から切り離す設計（§11 の 2）が前提。
- 破棄された行の購読は `isRetiredListIndex` で通知時に読み飛ばす遅延解除を足した（[keyedDependency.prototype.ts](../scripts/research/keyedDependency.prototype.ts) 99 行、全テスト成功）。上の計時表は解除を足す前のビルドで、追記 2 で再計時した。

追記 2（書き直し後の §11 の 1・2）。行 id を依存を張らずに鍵へ渡す形を `keyedIdUntracked` として足した（getter は `this.$eq("selectedId", this.$untrackDependency(() => this["data.*.id"]))`。ランタイム内で `$eq(path, keyPath)` が行う読みと同じ）。遅延解除込みのビルドで全変種を再計時し、交換は行 2（交換対象の 1 つ）を選択してから 5 回行って、選択が 1 行のまま id と index のどちらに付いて行くかも検証する（[keyed-prototype.json](./research/state-next/keyed-prototype.json) を更新。`auto.min.js` は gzip +323 bytes。warm 10 標本の中央値 ms）。

| バンドル / 変種 | 選択 1,000 行 | 選択 1 万行 | 1 行削除 1,000 / 1 万行 | 交換 1,000 行 | 交換後・削除後の選択 |
|---|---:|---:|---:|---:|---|
| 配布済み / manual | 0.2 | 0.2 | 3.5 / 39.7 | 0.9 | index に付く |
| 配布済み / tracked | 2.0 | 20.4 | 2.8 / 38.2 | 1.0 | index に付く |
| 試作 / manual | 0.2 | 0.2 | 4.1 / 40.6 | 1.1 | index に付く |
| 試作 / tracked | 1.9 | 21.7 | 3.3 / 32.8 | 1.0 | index に付く |
| 試作 / keyed（`$eq` × `$1`） | 0.1 | 0.2 | 5.0 / 43.5 | 1.2 | index に付く |
| 試作 / keyedId（`$eq` × 追跡付き id） | 0.2 | 0.25 | 3.9 / 48.0 | 4.1 | **id に付く** |
| 試作 / keyedIdUntracked（`$eq` × 依存なし id） | 0.2 | 0.2 | **1.5 / 12.7** | **1.0** | **id に付く** |

計数器の第 2 段（[runtime-counters-list-keyedIdUntracked-proto.json](./research/state-next/runtime-counters-list-keyedIdUntracked-proto.json)、計数ビルドの経過 ms）:

| 操作 | tracked | keyedId | keyedIdUntracked |
|---|---:|---:|---:|
| 選択変更 1 万行: enqueue / get トラップ | 10,001 / 30,003 | 3 / 11 | 3 / 13 |
| 交換: enqueue / 経過 | 3 / 6.4 | 11,001 / 75.0 | 1 / 9.0 |
| 追加 1,000 行: enqueue / 経過 | 4,001 / 46.4 | 14,001 / 112.4 | 4,001 / 46.1 |
| 1 行削除: enqueue / 経過 | 11,000 / 30.1 | 11,000 / 54.5 | 1 / 13.8 |
| 1 行削除の内訳（keyedIdUntracked） | — | — | walk 3.8（差分と listIndex の付け直し 4.0 を含む）・drain 3.5（applyFor 3.4）、残りはイベント経路 |

- 追跡付きで `data.*.id` を読むと `data.*.id → data.*.selected` の動的辺が張られ（`checkDependency`）、リスト置換の walk がそれを全行に展開する（交換 11,001・追加 14,001・削除 11,000）。読みを依存なしにすると置換の walk は `data` 1 件で終わり、選択は 0.2 ms のまま、交換 4.1 → 1.0 ms、1 行削除 48 → **12.7 ms**（1,000 行では 1.5 ms）。選択は交換でも削除でも同じ行（id）に付いて行き、全操作で選択行は 1 行のまま。
- これが §11 の 2「行の同一性を index から切り離す設計で消える分」の答え: 削除 33〜48 ms のうち約 25〜35 ms は、位置が変わった 10,999 行で index 依存 getter（`$1` を読んだ getter）を再評価する分（walk 9 ms＋drain 16 ms）。id で鍵付けすればまるごと消え、残るのは差分と listIndex の付け直し（4 ms）・DOM の外しと適用（3.5 ms）・イベント経路。index に付く選択（`tracked` / `keyed`）はこの再評価を避けられない。
- 書き方の候補: getter 内で第 2 引数にパスを取る形（`$eq(path, value)` と区別するため `$eqPath(path, keyPath)` のような別名か、`$keyed: { "data.*.selected": ["selectedId", "data.*.id"] }` の宣言形）。要件 D7 の回答候補として [state-next-major-requirements.ja.md](./state-next-major-requirements.ja.md) §4・§6 に載せた。

### 10.2 行 record を畳んだ帳簿形状（§11 の 2）

`BindingSession` の作り替えは範囲が大きいので、DOM 下限ページに現行の帳簿形状（束縛ごとの template 複製 10 項目・25 項目の record・台帳 6 種、行ごとの content と台帳 5 種）と畳んだ形状（行ごとに nodes / values / listIndex / 可変項目を 1 オブジェクト、台帳 2 種）を再現し、同じ DOM 複製の上で帳簿だけを入れ替えた（[domFloorPage.js](../scripts/research/domFloorPage.js) の `createShaped`、[fold-shape.json](./research/state-next/fold-shape.json)、標本ごとに新規ページ、7 標本の中央値、ヒープは GC 強制後の差分）。

| 形状 | 1,000 行 ms | 1 万行 ms | 行あたりヒープ bytes（1 万行） |
|---|---:|---:|---:|
| none（DOM 複製と文字列書き込みのみ） | 5.0 | 42.8 | 119 |
| current（現行の帳簿形状） | 9.5 | 101.9 | 1,288 |
| folded（畳んだ形状） | 5.5 | 47.5 | 237 |

- 現行の帳簿形状は 1 行 5.9 µs・約 1.2 KB、畳んだ形状は 0.5 µs・約 120 bytes（DOM 下限との差）。差の 5.4 µs/行は T6 で測った生成 28 µs/行の約 2 割、ヒープの約 1 KB/行は監査 §4.4 の 1 万行 35 MB のうち約 10 MB に相当する。
- 残る費用（プラン行の登録 2.7 µs・初期適用約 8 µs（§8.4 の訂正）・ノードパス解決 1.9 µs・イベント付与 1.2 µs）はこの形状の外にあり、畳むだけでは消えない。このモデルの「畳んだ形状」はノード単位の台帳（interested / known）も落としているが、実ランタイムではそれが観測者の意味論を担っており、record だけを畳んでも取れない（§10.7）。

### 10.3 配線分離の設計案（§11 の 3）

[state-next-major-wiring-design.ja.md](./state-next-major-wiring-design.ja.md) に草案を置いた。core が持つ受け口（読み書き境界 hook・drain listener・ライフサイクル hook・宣言 hook・devtools sink・volume graft handler・SSR）と、機能側の `install()` による明示的・冪等な登録、`/core` `/features/*` `/define` エントリ、readiness barrier、T7 に基づくサイズ見積もり（配線の切り出し単独では gzip 約 40〜41 KB で、35 KB には診断文言・wc-bindable 解析・`BindingSession` 一本化を積む必要がある）、段階（devtools sink の反転と listener の `install` 化は 2.6.x で先行可）を書いた。決定ではない。

### 10.4 活性化の巻き上げ（§11 の 3）

[activationPrototypePatch.mjs](../scripts/research/activationPrototypePatch.mjs) をサンドボックス（`$eq` 試作込み）に当てた。`BindingSession.activatePlanRows` が束縛ごとに繰り返す `registerAddress` の探索（ノード → loop context、束縛 → listIndex、ルート → state 要素、パス → tree path）を行ごとに 1 回へ巻き上げ、slot ごとの wildcard 深さと tree path を row plan に WeakMap でキャッシュする。ワイルドカードを含まない slot は既存の `registerAddress` へ落とす。全テスト 3,650 件は成功。

計数器の第 3 段（§8.3 と同じ計装、[runtime-counters-content-tracked-proto-before.json](./research/state-next/runtime-counters-content-tracked-proto-before.json) / [-after.json](./research/state-next/runtime-counters-content-tracked-proto-after.json)、中央値 ms）:

| 操作 | activatePlan 前 → 後 | activate 前 → 後 | 経過 前 → 後 |
|---|---:|---:|---:|
| 生成 1,000 行（5 標本、初回 cold） | 3.5 → 2.9 | 7.9 → 10.4 | 14.7 → 17.4（初回 63.7 → 66.8） |
| 生成 1 万行（3 標本） | 26.5 → 24.4 | 114.0 → 109.1 | 305.5 → 311.7 |
| 追加 1,000 行（3 標本） | 3.4 → 4.2 | 13.7 → 15.6 | 40.1 → 44.5 |

- `activatePlan` は 1 万行で 2 ms 減るだけで、経過時間は増減が混じり標本のばらつきの内側。**巻き上げでは取れない。** 活性化 10.5 µs/行のうち巻き上げの対象（プラン行の登録）は 2.7 µs だけで、残り約 8 µs は 3 束縛の初期適用（§8.4 の訂正、§10.7 の計数）。登録 2.7 µs の本体は `addBindingByPattern` の台帳書き込みと `getListIndexByBindingInfo` の解決で、探索の巻き上げでは減らない。record を持たない行の試作は §10.7。

### 10.5 配線分離 S1・S2 の実装（§11 の 4）

設計案（[state-next-major-wiring-design.ja.md](./state-next-major-wiring-design.ja.md) §8）の S1・S2 をリポジトリの `packages/state` に実装した。未コミット、挙動変化なし。

- **S1（H6）**: `devtools/sink.ts` を `platform/devtoolsSink.ts` へ移し（`git mv`）、core 側 14 ファイルと `devtools/bridge.ts`、テスト 14 ファイルの import を書き換えた。core → `devtools` の辺は 12 本 → 1 本（`bootstrapState.ts → devtools/bridge.ts`）。
- **S2（H2・H7）**: `watch/watchRuntime.ts`・`stream/streamRuntime.ts`・`webComponent/volume.ts` のモジュール評価時の登録を、冪等な `installWatchRuntime()` / `installStreamRuntime()` / `installVolumeGraft()` に置き換え、`bootstrapState()` が `registerComponents()` の前に 3 つを呼ぶ。加えて機能側の初回利用点（`startWatch` / `startStreams` / `graftOrQueueVolume` の queue 経路）でも同じ `install` を呼ぶ（`bootstrapState()` を経ずに要素を定義する経路の保険。テストはこの経路）。設計案の「入口だけが呼ぶ」からの逸脱で、3.0 の readiness barrier（H5）が入れば外せる。
  - 最初の版は Vitest の `setupFiles` から 3 モジュールを import して `install` していたが、267 件が落ちた。setup が実モジュール群を先に評価するため、各テストの `vi.mock`（58 ファイル）が後から効かない。初回利用点での `install` に変えて setup は空に戻した。
- 検証: lint 通過、304 ファイル・3,650 件成功、カバレッジ 99.62 / 98.78 / 100 / 99.78（閾値 99.5 / 98.5 / 100 / 99.5）。
- T1 の再計測（[coupling.json](./research/state-next/coupling.json)）: 評価時に処理を走らせるモジュールは 11 → 8（watch / stream / volume が消えた）。core → 機能の辺は 49 → 41（devtools −11、`bootstrapState.ts` → watch / stream / volume +3。この 3 本は入口に集まる辺で、3.0 では `/core` の外に出る）。
- **ヘルパーだけの import**（[helper-import.json](./research/state-next/helper-import.json)、[audit-state-tech-helper-import.mjs](../scripts/audit-state-tech-helper-import.mjs)。監査 §3.1 と同じ方法: 束ねた `index.esm.js` から 1 名だけ再 export → Rollup の tree-shake → terser。「前」は配布済み `dist/index.esm.js`、「後」は現在の `src/exports.ts` を同じ設定でメモリ上に束ねたもの）:

| 再 export | 前（minify bytes / gzip） | 後（minify bytes / gzip） | 残る評価時の呼び出し |
|---|---:|---:|---|
| `defineState` のみ | 89,237 / 26,706 | 6,238 / 1,943 | 前: `registerUpdateBatchListener` ×2・`createNotFilter()` → 後: `createEmptySet()`・`createNotFilter()` |
| `VERSION` のみ | 89,220 / 26,711 | 6,227 / 1,949 | 同上 |

  監査 §3.1 の「`defineState` だけで 26.8 KB」は 1.9 KB になった。残していたのは watch / stream の 2 つの listener 登録（`updater` の単一インスタンスから `State` まで到達する）で、volume の handler 注入は読み手が到達不能な代入として Rollup が既に落としていた。残り 6 KB は純粋と証明できない 2 つの呼び出し初期化子。要件 G2・N2 の「副作用のないヘルパー入口」は、エントリ分割を待たずにこの段で満たされる。
  - 追記（書き直し後の §11 の 5）: 残っていた評価時の呼び出し初期化子 8 箇所（`updater = new Updater()`、event 登録簿 ×4、`createNotFilter()`、`createEmptySet()`、`parseCommentNode` の `new RegExp`）に `/*#__PURE__*/` を付けた。いずれもコンストラクタが空か Map / Set / RegExp の割り当てだけで、挙動は変わらない（lint 通過、3,650 件成功）。[audit-state-tech-coupling.mjs](../scripts/audit-state-tech-coupling.mjs) は注釈付きの初期化子を割り当て扱いにし、評価時に処理を走らせるモジュールは `auto.ts` の 1 つだけになったので、[state-coupling-baseline.json](../scripts/state-coupling-baseline.json) を `evaluatedModules: ["auto.ts"]` に締めた。ヘルパーだけの import は `defineState` のみで 6,238 / 1,943 → **589 bytes / 309 gzip**（`VERSION` のみ 315 gzip）、残る評価時の呼び出しは 0（[helper-import.json](./research/state-next/helper-import.json) を更新）。
- **CI**: [audit-state-tech-coupling.mjs](../scripts/audit-state-tech-coupling.mjs) に `--check` を足し、[state-coupling-baseline.json](../scripts/state-coupling-baseline.json)（評価時に処理を走らせてよい 8 モジュール・core → 機能の辺の上限 41・`defineState.ts` の到達 1）に対して `ci.yml` の state ジョブで走らせる。逸脱は exit 1、基準を締められるときは note を出す。締めた基準で落ちることは確認済み。

### 10.6 低優先の `blink` トレース（§11 の 5）

[audit-state-tech-blink.mjs](../scripts/audit-state-tech-blink.mjs)。配布済み `auto.min.js`、標本ごとに新規ページ、`blink`・timeline の stack・invalidationTracking を足した CDP トレースの中で「生成 1 万行 → 同じタスク内で即消去」を行い、両窓の Layout 系イベントと自己時間の内訳を取った（[blink-trace.json](./research/state-next/blink-trace.json)、5 標本。トレース中なので生成は 400〜630 ms と遅い）。

| 標本 | 消去 ms | うち script 自己時間 | うち scavenge（若い世代の GC） | GC イベント数 |
|---|---:|---:|---:|---:|
| 0 | 22.4 | 20.6 | 0 | 0 |
| 1 | 71.6 | 33.5 | 34.9 | 22 |
| 2 | 46.3 | 21.7 | 22.0 | 23 |
| 3 | 33.6 | 30.5 | 0 | 0 |
| 4 | 49.0 | 23.6 | 23.2 | 23 |

- 生成・消去の両窓とも `Layout` / `UpdateLayoutTree` は 5 標本すべてで 0 件。生成処理中にレイアウトを強制する読み取りは**ない**。
- 「生成 → 即消去」の高い側（§8.5 の 65〜71 ms）は、消去の窓に V8 の scavenge が落ちるかどうかで決まる（GC 0 なら 22〜34 ms、scavenge が入ると 46〜72 ms）。生成直後は 1 万行分の新規オブジェクトが若い世代に残っており、消去の割り当てがその回収を引く。script の自己時間は全標本で 20〜33 ms（§8.6 の「engine 約 21 ms」と整合）。
- したがって消去の二峰は条件で原因が違う: フレームを挟んだ後はレイアウト済み行の取り外し（§8.6、DOM 単体でも 28 ms）、フレームを挟まない場合は scavenge の有無。結論（§8.6）は変わらず、GC 側は行 record を畳んで割り当てを減らす設計（§10.2）が効く領域。

### 10.7 record を持たない行（書き直し後の §11 の 3）

[rowRecordPrototypePatch.mjs](../scripts/research/rowRecordPrototypePatch.mjs) をサンドボックス（`$eq` 試作込み、活性化の巻き上げは外した）に当てた。プラン行の session は行ごとに 1 つなので、束縛ごとの 25 項目 record と台帳書き込み 3 種（`recordByBinding`・`records`・`optionsByBinding`）を、行に 1 つの record（slot 配列: phase・flags・address / pattern 登録・teardown）と束縛ごとの session 逆引き 1 回に置き換えた。`getRecord` / `shouldApplyState` / `addTeardown` / `disposeBinding` / `dispose` / `destroyRecords` / `rebindAddresses` / `forEachActiveBindingNode` / `getBindingSession` は行 record から答える。型検査と全テスト 3,650 件は初回で通過。

第 3 段の計数に `applyChange` と `getByAddress` の計数を足して（[runtime-counters-content-tracked.json](./research/state-next/runtime-counters-content-tracked.json)、配布ソース）、試作（[-rowrecord-full.json](./research/state-next/runtime-counters-content-tracked-rowrecord-full.json)）と、意味論を壊して上限だけを測る 2 変種（b1: ノード単位の台帳 `interested` / `known` を束縛ごとに書かない、b2: b1 ＋ slot のパターン台帳登録も行わない。[-rowrecord-b1.json](./research/state-next/runtime-counters-content-tracked-rowrecord-b1.json) / [-b2.json](./research/state-next/runtime-counters-content-tracked-rowrecord-b2.json)）を比べた（1 万行生成、3 標本の中央値 ms）:

| ビルド | 経過 | コンテンツ生成 | うち行 record | 活性化 | うちプラン行の登録 |
|---|---:|---:|---:|---:|---:|
| 配布ソース | 324.2 | 146.3 | 41.0 | 107.5 | 28.4 |
| 試作（行 record） | 324.5 | 154.0 | 45.2 | 126.5 | 29.5 |
| b1（＋ノード台帳なし） | 411.7 | 149.3 | 31.6 | 184.6 | 43.4 |
| b2（＋パターン登録なし） | 326.4 | 118.1 | 24.7 | 114.6 | 3.7 |

- **record を畳んでも実ランタイムでは減らない**（行 record 41 → 45 ms、経過 324 → 325）。束縛ごとに残るのは、ノード単位の観測者台帳 2 種（`interestedSessionsByNode`・`knownBindingsByNode`。MutationObserver の配送先で、意味論が乗る）・session 逆引き・パターン台帳への登録（`addBindingByPattern`・`getListIndexByBindingInfo`）で、25 項目の record 自体は V8 では安い。§10.2 のモデルが 5.4 µs/行と見積もったのは、この台帳群まで落とした形だった。
- 上限（b2）でも行 record 41 → 25 ms・登録 28 → 4 ms の計 41 ms ＝ 4 µs/行で、経過は標本ばらつき（±10 ms）の内側。b1 の経過 412 は GC の乗った標本で、成分の比較には使わない。**行の帳簿を鍵ごと行単位に組み替えても取れるのは 28 µs/行のうち 4 µs まで。**
- ヒープ（[heap-per-row.json](./research/state-next/heap-per-row.json)、[audit-state-tech-heap.mjs](../scripts/audit-state-tech-heap.mjs)、1 万行、GC 強制後の差分）: 配布 3,631 bytes/行（34.6 MB。監査 §4.4 の 35 MB と一致）→ 試作 3,454 bytes/行。record の分は 177 bytes/行（5%）で、§10.2 の「約 1 KB/行」も台帳込みの値。残り 3.4 KB/行はアドレス・キャッシュ・listIndex・依存台帳・束縛オブジェクトで、別の計測が要る。
- ベンチ計時（[warm-vs-cold-file-tracked-plain-jsfb.json](./research/state-next/warm-vs-cold-file-tracked-plain-jsfb.json)）: 1,000 行生成 cold 53.4 / warm 19.0、追加 cold 61.5 で、配布済み（§8.5）と同じ水準。
- 結論: 生成 28 µs/行の内訳で設計の効く先は、帳簿（≤4 µs）より初期適用（約 8 µs、読み 7 回・適用 3 回。§8.4 の訂正）と、複製・ノードパス解決・イベント付与（約 5.5 µs）。初期適用はプラン行の値を proxy と束縛適用を通さず slot ごとに直接書く「プラン初期描画」が候補で、§11 の 3 を差し替える。

### 10.8 読み書き境界 hook（H1）のコスト（書き直し後の §11 の 4）

[addressHookPrototypePatch.mjs](../scripts/research/addressHookPrototypePatch.mjs) を、現行ソース（S1・S2 適用後）の別サンドボックスに当てた。機能の分岐はそのまま残し、`getByAddress`・`setByAddressCore`・get トラップ（文字列プロパティ）の先頭に「登録済み hook を順に呼び、`NOT_HANDLED` 以外を返した hook で確定する」受け口だけを足す（`core/addressHooks.ts`）。変種: **none**（hook 未登録、配列長 0 の判定のみ）、**inactive3**（`bootstrapState()` が受け口ごとに 3 つの hook を登録し、各 hook は state の boolean を 1 つ見て `NOT_HANDLED` を返す ＝ 機能は install 済みだがこの state では未使用）、**gated3**（inactive3 ＋ ループの前に state 要素のフラグ `hasAddressHooks === true` を見る ＝ hook を state ごとに宣言時に付ける設計）。全テスト 3,650 件成功（none）。

ベンチ計時（[hook-cost-none.json](./research/state-next/hook-cost-none.json) / [-inactive3.json](./research/state-next/hook-cost-inactive3.json) / [-base.json](./research/state-next/hook-cost-base.json)（hook なしの現行ソース） / [-protoctl.json](./research/state-next/hook-cost-protoctl.json)（§10.1 のサンドボックス）、`--only tracked`、選択変更 1 万行の warm 10 標本の中央値 ms）: 配布済み 19.3〜20.6、base 20.2、protoctl 20.7、none 14.7、inactive3 18.2。none の 14.7 は範囲（12.4〜17.1）ごと他より低いが、受け口の追加で速くなる理由は無く走行の性質（JIT 段階）と見る。この計時は走行間で ±10% 動き、設計 §7-4 の「1% 未満」は判定できない。

マイクロベンチ（[audit-state-tech-hookcost.mjs](../scripts/audit-state-tech-hookcost.mjs)、[hook-cost-micro.json](./research/state-next/hook-cost-micro.json)）: state のメソッド内で `this.selectedIndex` を 100 万回読み（get トラップ → `getByAddress` → キャッシュ）、同値を 10 万回書く（set トラップ → `setByAddress` → 同値ガード）。標本ごとに新規ページ、ページ内 5 回の最小値、9 ページ。ページは JIT の段階で速い群（約 43 ns/読み）と遅い群（60〜80 ns）に割れるので、最小値（速い群）で比べる:

| ビルド | 読み ns（最小 / 中央値） | 書き ns（最小 / 中央値） | 速い群のページ数 |
|---|---:|---:|---:|
| 配布済み | 42.1 / 65.3 | 43 / 62 | 3 / 9 |
| base（現行ソース、hook なし） | 42.9 / 44.2 | 41 / 44 | 5 / 9 |
| none（受け口のみ） | 43.2 / 58.4 | 43 / 53 | 2 / 9 |
| inactive3（大域配列に 3 hook） | 60.1 / 64.1 | 56 / 60 | 0 / 9 |
| gated3（state のフラグで門） | 43.0 / 45.8 | 42 / 44 | 5 / 9 |

- 受け口だけ（配列長 0 の判定）は読み・書きとも差が出ない（+0.3 ns）。**大域配列に install 済みの hook が 3 つ載ると、この state で使っていなくても読み +17 ns（+40%）・書き +15 ns。** 選択変更 1 万行（get トラップ 30,003・読み 10,001）に換算すると約 0.7 ms ＝ 3〜4% で、§7-4 の 1% を超える。
- state ごとのフラグで門を置くと（gated3）base と同じ（+0.1 ns）。したがって H1 の hook は大域配列を毎回走査する形ではなく、**宣言時に state ごとへ付ける（または機能マスクで門を置く）**形にする。現行の D18（`hasMounts === true`）と同じ費用で済む。設計書 §3 の H1 に反映した。

### 10.9 行の形状と消去の GC（書き直し後の §11 の 6）

[audit-state-tech-gcshape.mjs](../scripts/audit-state-tech-gcshape.mjs)、[gc-shape.json](./research/state-next/gc-shape.json)。DOM 下限ページの 3 形状（§10.2）で 1 万行を生成し、同じタスク内で `replaceChildren()` を同期計時、`v8.gc` 込みのトレースで生成窓と消去窓の GC を取った（各 5 標本の中央値）。

| 形状 | 生成 ms | 生成中の GC ms（イベント数） | 消去 ms | 消去中の GC |
|---|---:|---:|---:|---:|
| none | 50.0 | 4.6（68） | 4.3 | 0（全標本） |
| current | 109.1 | 20.1（142） | 4.6 | 0 |
| folded | 54.9 | 5.3（69） | 4.4 | 0 |

- `replaceChildren()` 自体は割り当てをしないので、DOM 単体の消去窓に scavenge は落ちない。配布済みランタイムの消去（§10.6）で scavenge が落ちるのは、消去の drain（差分・dispose・台帳）が割り当てるからで、その scavenge が運ぶのは直前の生成で若い世代に残った行の帳簿。
- 形状は生成側の GC に効く: current は生成中の GC が 20 ms（1.2 KB/行 × 1 万行 ≈ 12 MB の若い割り当て）、folded は 5 ms で none と同じ。行の割り当てを減らせば、消去で落ちる scavenge も運ぶ量に比例して縮む見込みだが、実ランタイムの 3.4 KB/行のうち帳簿は約 1 KB（§10.7）なので、消去の 22〜35 ms が消えるわけではない。

### 10.10 鍵付き購読の第 3 巡: `$eqPath` / `$eqIndex`・dispose 連動の解除・差分側の鍵付け替え（第 3 巡 §11 の 1・2）

[keyedRound3Patch.mjs](../scripts/research/keyedRound3Patch.mjs)（[keyedDependency.prototype.ts](../scripts/research/keyedDependency.prototype.ts) 第 3 版と組）をサンドボックスに当てた。

- **書き方**: `$eqPath(path, keyPath)` は鍵をパスから依存を張らずに読む（§10.1 追記 2 の `$untrackDependency` 形をランタイムに畳んだもの）。`$eqIndex(path, level = 1)` は行の index（`$1` 相当）を鍵にするが、getter を index 依存には記録しない。`$eq(path, value)` はそのまま。
- **解除**: 退役した行の購読は、差分が listIndex を退役させる時点（`createListDiff` の `retireListIndexes` 直後）で落とす。通知時の遅延判定は外した。
- **差分側の鍵付け替え**: `syncListIndexes` で listIndex の index が変わるとき、その行の `$eqIndex` 購読を新しい index の鍵へ移し、`path` の最後の書き込み値が旧 index か新 index に等しい行だけを dirty 化して enqueue する（getter の再評価はそれ以外の移動行では起きない）。
- テスト [proxy.keyedRound3.test.ts](../scripts/research/proxy.keyedRound3.test.ts)（5 件: `$eqPath` の選択・置換・削除後の解除・入れ子ワイルドカード、`$eqIndex` の削除と交換で高々 2 行の再評価）を足し、サンドボックスの 3,655 件が成功。

ベンチ計時（[keyed-round3.json](./research/state-next/keyed-round3.json)、warm 10 標本の中央値 ms）と第 2 段計数（[runtime-counters-list-keyedIdPath-proto.json](./research/state-next/runtime-counters-list-keyedIdPath-proto.json) / [-keyedIndex-proto.json](./research/state-next/runtime-counters-list-keyedIndex-proto.json)）:

| 変種 | 選択 1 万行 | 1 行削除 1,000 / 1 万行 | 交換 | 選択の付き先 | 削除の enqueue / get トラップ（計数） |
|---|---:|---:|---:|---|---:|
| tracked（同走行） | 21.2 | 2.6 / 33.3 | 1.1 | index | 11,000 / 33,002 |
| keyedIdUntracked（§10.1 追記 2） | 0.25 | 1.4 / 14.7 | 1.0 | id | 1 / 5 |
| **keyedIdPath**（`$eqPath`） | 0.2 | 1.3 / **13.6** | 1.1 | id | 1 / 5 |
| **keyedIndex**（`$eqIndex`） | 0.2 | 1.8 / **17.5** | 1.1 | **index** | **3 / 11** |

- `$eqPath` は `$untrackDependency` 形と同じ性能で、書き方だけが整った。
- `$eqIndex` は **index に付く選択のまま**、1 行削除を 33 → 17.5 ms、enqueue を 11,000 → 3（`data`＋旧 index の行＋新 index の行）にした。第 2 巡 §11 の 2「鍵付け替えを差分側へ寄せれば再評価なしで済むか」の答えは**済む**。残る差（keyedIdPath より +4 ms）は移動行 10,999 件の鍵付け替え（Map の付け替え 1 回ずつ、diff 4 → 7.6 ms）。
- 要件 N6 の書き方は `$eq(path, value)` / `$eqPath(path, keyPath)` / `$eqIndex(path, level)` の 3 形を候補にし、`$keyed` 宣言形は getter 内の呼び出しで足りるため保留。
- 追記: 同日、この 3 形をリポジトリへ移植した（§11 の 1）。getter の外での呼び出しは購読せず比較だけ返す、退役フックは 1 度も登録が無ければ Map 参照すら行わない、の 2 点を製品版で足した。

追記 2（翌日、`$eqIndex` の O(1) 化。第 4 巡 §11 の 2）: 最内段（getter 自身の行の段）の `$eqIndex` は行ごとの購読をやめ、**リスト（listIndex 配列）単位の監視を 1 つ**持つ形にした（[indexWatcherPatch.mjs](../scripts/research/indexWatcherPatch.mjs)）。書き込みは `indexes[旧値]` と `indexes[新値]` の行を enqueue し、差分は配列が変わったら監視を新しい配列へ移して「最後の値の位置にいた行と来た行」だけを enqueue する。移動行ごとの Map 操作は無くなり、退役の解除も要らない（行ごとの状態を持たない）。外側の段（`level < wildcardCount`）は従来の行ごとの購読のまま。サンドボックスで 3,661 件成功、リポジトリにも移植した。

| 変種 | 選択 1 万行 | 1 行削除 1 万行 | 削除の enqueue / diff ms（計数） |
|---|---:|---:|---:|
| keyedIndex（行ごとの購読＋差分側の付け替え、§10.10） | 0.2 | 17.5 | 3 / 7.6 |
| keyedIndex（リスト単位の監視、[keyed-round4.json](./research/state-next/keyed-round4.json)） | 0.25 | **14.5** | 3 / 5.9 |
| keyedIdPath（同走行） | 0.2 | 13.5 | 1 / — |

### 10.11 生成 1 万行の帰属: ヒープの型別とプロファイルの関数別（第 3 巡 §11 の 3）

プラン初期描画の試作に入る前に、何を省けば効くかを 2 本の帰属で確かめた。

**ヒープ**（[audit-state-tech-heapsnapshot.mjs](../scripts/audit-state-tech-heapsnapshot.mjs)、[heap-snapshot-attribution.json](./research/state-next/heap-snapshot-attribution.json)（配布 `auto.min.js`）/ [-proto.json](./research/state-next/heap-snapshot-attribution-proto.json)（非 minify の配布 `index.esm.js`、型名が読める）。1 万行生成の前後で heap snapshot を取り、ノードを型・コンストラクタ名で集計して差分を行あたりに直した）:

| 型（行あたり個数） | bytes/行 |
|---|---:|
| native（DOM ノードとそのラッパ、131 個） | 9,706 |
| array（Map / Set / WeakMap の backing store とオブジェクトの要素配列、8 個） | 1,649 |
| Object（束縛オブジェクト 5・record 5・options・content 台帳など、16 個） | 816 |
| string（2.3 個） | 136 |
| WeakMap（**6 個**） | 96 |
| StateAddress（4 個） | 96 |
| AbsoluteStateAddress（4 個） | 80 |
| Array（5 個） | 80 |
| ListIndex・Content・BindingSession（各 1）・Set（2）・WeakRef（1） | 176 |

- 合計 13.0 KB/行のうち 9.7 KB は DOM 側（native）で、JS 側は 3.3 KB/行 ＝ §10.7 の GC 差分 3.6 KB と整合（差は GC 前後の測り方）。
- JS 側 3.3 KB の半分（1.65 KB）は **コレクションの backing store**。行ごとに WeakMap 6 個・Set 2 個が作られており（`BindingSession` が行ごとに 1 つで、WeakMap 3 個＋Set 2 個を持つのが主）、record（Object 816 B の一部）より大きい。§10.7 の試作は record を畳んだが session 自体は行ごとに残したため 177 B しか減らなかった。**行ごとの session をやめてリスト（`for` 束縛）ごとに 1 つにする**のが JS ヒープの最大の削減先（見込み約 1.3 KB/行 ＝ JS 側の 4 割）。
- アドレス（StateAddress 4＋AbsoluteStateAddress 4 ＝ 176 B/行）と束縛オブジェクト 5 個は、プラン初期描画で slot ごとの解決をプランに寄せれば行から消える候補。

**プロファイル**（[audit-state-tech-profile.mjs](../scripts/audit-state-tech-profile.mjs)、[profile-create10k-index.esm.json](./research/state-next/profile-create10k-index.esm.json)。CDP Profiler、100 µs 標本、非 minify ビルド、3 ページの合計を関数の自己時間で集計。プロファイル中は生成が 511 ms に伸びる（通常 300 ms）ので、値は比率で読む）:

| 群 | µs/行（プロファイル値） | 主な関数 |
|---|---:|---|
| (program)（native・未帰属） | 63.8 | DOM 実装・IC など |
| 台帳の書き込み（WeakMap / WeakSet / Set） | 8.9 | `markNodeRegistered` 1.9・`addInterestedSession` 1.8・`setLoopContextByNode` 1.4・`resolveInitializedBinding` 1.2・`addBindingByPattern` 0.7・… |
| DOM の native 呼び出し | 7.8 | `importNode` 4.3・`insertBefore` 1.6・`appendChild` 1.1・`addEventListener` 0.9 |
| GC | 7.2 | |
| コンテンツ生成 | 6.4 | `resolveNodePath` 3.2・`getCustomElement` 1.2・`Content` 0.9 |
| 初期適用 | 6.0 | `applyChange` 2.2・`applyChangeToText` 1.2・`_applyChange` 1.6 |
| アドレスの生成・解決 | 5.3 | `createAbsoluteStateAddress` 1.2・`getStateAddressByBindingInfo` 1.1・`createStateAddress` 1.1・`getAbsoluteStateAddressByBinding` 0.8・`getListIndexByBindingInfo` 0.8 |
| 行の初期化・活性化（session） | 3.2 | `initializeRow` 2.3 |
| 読み（proxy / キャッシュ） | 2.0 | `getCacheEntryByAbsoluteStateAddress` 0.5・`_getByAddress` 0.5 |
| walk / diff / updater | 1.6 | |

- JS に帰属する分の首位は **台帳の書き込み**（8.9）で、束縛ごと・ノードごとの WeakMap / WeakSet への `set` が主体。次いで DOM、GC、コンテンツ生成（うち `resolveNodePath` 3.2）、初期適用、アドレスの生成。
- 「初期適用 8 µs/行」の中身は、読み（2.0）より **アドレスの生成・解決（5.3）と `applyChange` の門（`getCustomElement` 1.2 を含む）** が大きい。プラン初期描画は「slot ごとの address を行の listIndex から 1 回で作る（StateAddress / AbsoluteStateAddress の割り当てを束縛ごとに繰り返さない）」「プラン行では `getCustomElement` の検査を省く（プラン適格性でカスタム要素は除外済み）」の 2 点で効く見込みで、読みの経路を変える必要はない。
- `resolveNodePath` 3.2 µs/行（5 ノード）は複製した行からノードを辿る費用。§6 の DOM 下限で測った 1.9 µs と同じ項目で、template に印を付けて `querySelectorAll` 1 回で取る等の代替は T4 の候補。

### 10.12 消去の割り当ての帰属（第 3 巡 §11 の 6）

[audit-state-tech-allocsample.mjs](../scripts/audit-state-tech-allocsample.mjs)。1 万行生成の直後に消去し、その窓を CDP の allocation sampling（4 KB ごと）で取って、割り当てを関数の自己サイズで集計した（[alloc-sample-clear-shipped.json](./research/state-next/alloc-sample-clear-shipped.json)（配布ソースの非 minify ビルド） / [-proto.json](./research/state-next/alloc-sample-clear-proto.json)（§10.7 の行 record ＋ §10.10 のサンドボックス）。3 ページの合計を 1 回あたりに直す）:

| 関数（自己サイズ） | 配布 | 行 record 試作 |
|---|---:|---:|
| 消去 1 回の割り当て合計 | **8.06 MB** | **6.76 MB** |
| `next`（反復子の結果オブジェクト: Set / 配列の `for...of`） | 3.06 MB（37%） | 1.86 MB（27%） |
| `tryDestroy`（`_childNodeArray` と束縛配列の反復・観測者スキップ印） | 1.82 MB | 1.81 MB |
| `add`（`markObserverSkipOnRemove` の WeakSet / Set の成長） | 0.83 MB | 0.84 MB |
| `delete`（プール行の台帳解除に伴う再ハッシュ） | 0.69 MB | 0.59 MB |
| `destroyRecords` | 0.54 MB | 0.56 MB |
| `values` / `from`（反復子・`Array.from`） | 0.62 MB | 0.55 MB |

- 消去の窓で若い世代を埋めるのは、行の帳簿の解体そのものではなく **反復プロトコルのごみ**（`this.records` や `deleteIndexSet` の `for...of`、`Array.from(this.records)`）と **Set / WeakSet の増減**（ノードごとの観測者スキップ印、プールに入る 1,000 行の台帳解除）。これが §10.6 の「消去の窓に落ちる scavenge」の引き金。
- 行 record（§10.7）は `destroyRecords` を添字ループにしたぶん `next` が 1.2 MB 減った。残りは `tryDestroy` の反復と観測者スキップ印で、**添字ループ化・content 単位の一括スキップ印・wholesale 経路での台帳解除の省略**で消去の割り当てを 1 MB 未満に落とせる見込み。割り当てが nursery を埋めなければ scavenge は消去の窓に落ちず、§8.6 の「engine 約 21 ms」に近づく（ごみ自体は次の割り当てで回収されるので、費用は消えるのではなく窓の外へ移る）。

追記（同日、添字ループ化の試作）: [clearAllocPatch.mjs](../scripts/research/clearAllocPatch.mjs) をサンドボックスに当てた（`tryDestroy` の 2 つの `for...of` を添字ループに、`applyChangeToFor` の削除ループを `Set.forEach` に、空の record Set の反復を省く。意味論は不変で、関連テスト 34 件成功）。

| ビルド | 消去の割り当て | 消去の窓に scavenge が落ちた標本 | 消去 ms（5 標本） |
|---|---:|---:|---|
| 配布（§10.6） | 8.06 MB | 3 / 5（22〜35 ms） | 22, 34, 46, 49, 72 |
| 添字ループ化（[alloc-sample-clear-proto-loops.json](./research/state-next/alloc-sample-clear-proto-loops.json)・[blink-trace-proto-loops.json](./research/state-next/blink-trace-proto-loops.json)） | **3.52 MB** | **1 / 5**（17.7 ms） | 22, 22, 32, 34, 38 |

- 反復子のごみは `next` 3.06 → 1.27 MB、`tryDestroy` 自身は 1.8 MB → 0（割り当てなし）。残る 3.5 MB は観測者スキップ印の WeakSet 成長（`add` 0.82 MB）、プール行 1,000 件の台帳解除（`delete` 0.58 MB）、プール行の `deactivateContent` / `unmount` の反復（`next` の残り）。scavenge が窓に落ちる頻度は 3/5 → 1/5 に減り、落ちたときも 17.7 ms。**割り当てを 1 MB 未満にするには、スキップ印を content 単位にし、wholesale 経路でプール行の台帳解除を省く**のが残り。

追記 2（翌日、第 4 巡 §11 の 6）: [clearAllocPatch2.mjs](../scripts/research/clearAllocPatch2.mjs)。観測者スキップ印をノードごとの WeakSet から**親ごとの件数**に変えた（全消去は `textContent = ''` で全行が 1 つの mutation record に載るので、親に「この件数は framework の削除」と 1 回書けば observer はその record を丸ごと飛ばせる。件数が足りない record はノードごとの印に落ちる）。加えて `unmount` / `deactivateContent` / `unbindLoopContextToContent` / `_teardownBindings` の `for...of` を添字ループにした。意味論は不変で 3,661 件成功。

| ビルド | 消去の割り当て | 消去の窓に scavenge が落ちた標本 | 消去 ms（5 標本） |
|---|---:|---:|---|
| 配布（§10.6） | 8.06 MB | 3 / 5 | 22, 34, 46, 49, 72 |
| 添字ループ化 | 3.52 MB | 1 / 5 | 22, 22, 32, 34, 38 |
| ＋親ごとのスキップ件数（[alloc-sample-clear-proto-loops2.json](./research/state-next/alloc-sample-clear-proto-loops2.json)・[blink-trace-proto-loops2.json](./research/state-next/blink-trace-proto-loops2.json)） | **2.11 MB** | **0 / 5** | **18.7, 18.3, 17.8, 19.7, 17.9** |

- 消去は全標本で 18〜20 ms に収まり、§8.6 の「engine 約 21 ms」に届いた。observer の callback（`AsyncTask Run`）も 1.7〜2.9 ms → 0.2 ms。残る 2.1 MB はプール行 1,000 件の台帳解除（`delete` 0.45 MB）と反復（`next` 0.78 MB、`add` 0.57 MB）で、wholesale 経路でプール行の台帳解除を省けばさらに減るが、scavenge を窓から出す目的には既に足りている。この 2 段のパッチは意味論不変なので 2.6.x に入れられる。

### 10.13 プラン初期描画（第 4 巡 §11 の 3 (b)）

[planRenderPatch.mjs](../scripts/research/planRenderPatch.mjs) をサンドボックス（行 record・鍵付き購読・消去の添字ループ込み）に当てた。プラン行の活性化で、state パスが行の下の素の葉（どの接頭辞も getter でなく、tail にワイルドカードが無く、event / index 束縛でない）である slot は、行オブジェクトを proxy で 1 回読んで（`state[getByAddressSymbol](loopContext)`）その生の値を `applyValueToBinding`（`_applyChange` の DOM 書き込み側だけを切り出した関数）へ渡す。getter の slot（`data.*.selected`）は従来どおり `applyChange`。`$updatedCallback` を持つ state と `**` を持つ state は従来経路（前者は束縛ごとのアドレス集計が要り、後者は展開形の getter が `getterPaths` に無い）。getter 判定は行ごとに `getterPaths` を引く（再セットで集合が作り直されるためキャッシュしない）。全テスト 3,661 件成功（最初の版は再帰と再セットで 8 件落ち、この 2 点で直した）。

同じサンドボックスでの前後（第 3 段計数 [runtime-counters-content-tracked-proto-planrender-before.json](./research/state-next/runtime-counters-content-tracked-proto-planrender-before.json) / [-after.json](./research/state-next/runtime-counters-content-tracked-proto-planrender-after.json)、中央値 ms）:

| 操作 | 経過 前 → 後 | 活性化 前 → 後 | 読み 回/行 | 適用 回/行 |
|---|---:|---:|---:|---:|
| 生成 1 万行 | 313.1 → **281.0**（−10%） | 124.1 → 111.2 | 7 → 4 | 3 → 1 |
| 生成 1,000 行（warm、プール再利用） | 22.2 → **16.1** | 14.9 → 10.6 | 7 → 4 | 3 → 1 |
| 追加 1,000 行 | 38.5 → 39.3 | 12.6 → 12.2 | 7 → 4 | 3 → 1 |

- プロファイル（[profile-create10k-index.esm.json](./research/state-next/profile-create10k-index.esm.json) を試作ビルドで取り直し）: 窓 511 → 452 ms、群では初期適用 6.0 → 4.2、アドレス生成 5.3 → 3.6、読み 2.0 → 1.3、コンテンツ生成 6.4 → 5.0（葉 slot の `getCustomElement` 検査が消えた）µs/行。
- ベンチ計時（[warm-vs-cold-file-tracked-plain-jsfb-planrender.json](./research/state-next/warm-vs-cold-file-tracked-plain-jsfb-planrender.json)）: 1,000 行生成 cold **53.4 → 53.4**（変わらず）、warm 19.0 → 17.4、追加 cold 61.5 → 63.1。**監査ベンチの指標である cold の 1,000 行生成には効かない**: cold は JIT と初回の割り当てが支配し、束縛あたりの定数を削っても届かない。効くのは行数が多い生成（1 万行で 10%）と warm。
- 結論: 生成 28 µs/行のうち初期適用側で取れるのは 3 µs/行程度。cold 1,000 行を動かすには、束縛あたりの処理量ではなく「初回に走るコード量と割り当て」（JIT の暖機、テンプレート複製の初回、台帳の初期成長）を見る必要がある。

### 10.14 session をリストごとに 1 つ（第 4 巡 §11 の 3 (a)）

[sessionPerListPatch.mjs](../scripts/research/sessionPerListPatch.mjs) を、行 record（§10.7）とプラン初期描画（§10.13）の上に当てた。`BindingSession` は行 record の Set を持ち、`for` 束縛（そのノード）ごとに 1 つを全行で共有する。content 側の行単位の操作（`unmount` / `unmountInPlace` / `tryDestroy`）は行だけを対象にする `disposeBindings` / `destroyRow` に置き換え、共有 session の定義待ちタスクは「その行のノードに紐づく分は行の解体で取り消し、生きている行が無くなったら全て取り消す」規則にした（wholesale の統合テスト 2 件がこの規則で通る）。全テスト 3,661 件成功。

| 指標 | プラン描画まで（§10.13） | ＋session をリストごとに |
|---|---:|---:|
| ヒープ（[heap-per-row-session-per-list.json](./research/state-next/heap-per-row-session-per-list.json)、1 万行、bytes/行） | 3,630（配布） | **3,033**（−597、−16%） |
| 生成 1 万行（第 3 段計数、中央値 ms） | 281 | 294（[2 回目](./research/state-next/runtime-counters-content-tracked-proto-session-per-list-2.json)。[1 回目](./research/state-next/runtime-counters-content-tracked-proto-session-per-list.json)は 424 だが標本 273 / 424 / 494 で GC の乗った外れ値） |
| 1,000 行生成 cold / warm（ベンチ計時） | 53.4 / 17.4 | 50.0 / 18.2 |

- §10.11 で「1.65 KB/行の backing store の主が行ごとの session」と見積もったが、取れたのは 0.6 KB/行。行ごとの session が持つコレクションは 5 個（WeakMap 3・Set 2）で、それが約 600 bytes。残りの WeakMap（行あたり 6 個のうち 3 個）と array の backing store は、モジュール側の台帳（loop context ごとの listIndex キャッシュ、content の台帳など）に属する。§10.11 の見積もりを訂正する。
- 時間は変わらない（差は標本ばらつきの内側）。共有 session の per-node WeakMap（`knownBindingsByNode`）が 5 万件に育つが、計測上の不利は出なかった。
- 3 段（行 record → プラン初期描画 → session 共有）を積んだサンドボックスの現状: 生成 1 万行 313 → 294 ms、warm 1,000 行 22 → 16 ms、ヒープ 3.6 → 3.0 KB/行、消去 18〜20 ms で scavenge なし（§10.12）。cold 1,000 行は 50〜53 ms のまま。

### 10.15 cold の 1,000 行生成の内訳と、3 段の出荷判断材料（第 4 巡 §11 の 3 の残り）

**cold の内訳**: [audit-state-tech-profile.mjs](../scripts/audit-state-tech-profile.mjs) に `--op create1k --warm` を足し、新規ページで 1 回目（cold）を、消去して同じページで 2 回目（warm）をプロファイルし、関数ごとの自己時間を cold / warm で並べた（9 ページの平均、プロファイル中の値。[profile-create1k-coldwarm-shipped.json](./research/state-next/profile-create1k-coldwarm-shipped.json)（配布ソース）/ [-proto.json](./research/state-next/profile-create1k-coldwarm-proto.json)（3 段のサンドボックス））:

| 群（配布ソース、ms / 1,000 行） | cold | warm | cold の超過 |
|---|---:|---:|---:|
| 窓（経過） | 66.2 | 27.9 | 38.3 |
| (program)（native・未帰属） | 55.7 | 61.4 | −5.7 |
| GC | 10.0 | 0.1 | **9.9** |
| DOM の native 呼び出し（`importNode` 5.2 など） | 9.7 | 4.7 | **5.0** |
| コンテンツ生成（`resolveNodePath` 3.2・`Content` 1.5・`createContent` 0.9 など） | 7.5 | 0.6 | **6.9** |
| 台帳の書き込み（`markNodeRegistered` 1.2 など） | 4.9 | 1.8 | 3.1 |
| session（`initializeRow` 2.1） | 3.5 | 1.0 | 2.5 |
| 読み / アドレス / 適用 / walk | 19.5 | 12.3 | 7.2 |

- warm は消去でプールに入った 1,000 行を再利用するので、**コンテンツ生成（複製・ノードパス解決・record・台帳）を丸ごと飛ばす**。cold の超過 38 ms のうち、その分が約 18 ms（DOM 5＋生成 7＋台帳 3＋session 2.5）、生成の割り当てが引く若い世代の GC が約 10 ms、残り約 7 ms が読み・アドレス・適用側の初回コスト（JIT の段階と IC の暖機）。監査ベンチの cold 1,000 行 50 ms は「warm の定常 17 ms ＋ コンテンツ生成 ＋ GC ＋ 暖機」で、束縛あたりの定数を削る設計（§10.13）が効かなかったのはこのため。
- 3 段のサンドボックスでは cold 66.2 → 58.4（−12%）、GC 10.0 → 5.5、ベンチ計時の cold 1,000 行は 53.4 → 50.0。効いたのは割り当ての削減（GC）で、複製・ノードパス解決（DOM 9.4・生成 8.6）は残る。
- cold を動かす設計の候補は、(1) 行あたりの割り当てをさらに減らす（GC）、(2) 複製とノードパス解決（`importNode` ＋ `resolveNodePath` ＝ cold の 8 ms、T4 の候補: 印付き template を 1 回の `querySelectorAll` で引く、`cloneNode` と事前計算した子添字）、(3) プールを最初から温める（初回描画の前に N 行分の content を生成しておく。cold を warm に寄せる最短経路だが、使わない行の生成が無駄になる）。

**3 段の出荷判断材料**（決定ではない）:

| 段 | 触るファイル（差分行） | 公開面の変化 | 効果 | 位置づけ |
|---|---|---|---|---|
| 消去の割り当て 1＋2（§10.12） | `createContent` 30・`applyChangeToFor` 14・`observerSkip` 22・`BindingSession` 6・`activateContent` 4・`bindLoopContextToContent` 4 | なし（内部の反復と印の持ち方） | 消去 22〜72 → 18〜20 ms、scavenge が窓から出る | **2.6.x**（意味論不変。observer の件数消費に境界テスト 1 本） |
| プラン初期描画（§10.13） | `activateContent` 88・`applyChange` 6・`createContent` 3・新規 `planByContent` 10 | `applyValueToBinding` の export（内部） | 1 万行 −10%、warm 1,000 行 −27% | **2.6.x 候補**（`$updatedCallback` と `**` の state は従来経路に倒す門があり、局所） |
| 行 record（§10.7）＋ session 共有（§10.14） | `BindingSession` 372・`createContent` 30・`initializeBindings` 10 | `BindingSession` に `disposeBindings` / `destroyRow` / `isRowSession` / `currentRowPlan`、`getRecord` は行束縛に合成ビューを返す、共有 session の deferred 規則 | ヒープ −16%、時間は不変 | **3.0**（`BindingSession` の中核と公開面に触る。監査 §7 の「template plan と行インスタンスの分離」の器で入れる） |

いずれもサンドボックスで全テスト 3,661 件が通っている（テストは変更していない）。

## 11. 次に測るもの

1. 済み: 鍵付き購読（`$eq` / `$eqPath` / `$eqIndex`、dispose 連動の解除、差分側の鍵付け替え）をリポジトリの `packages/state` に移植した（`src/dependency/keyedDependency.ts`・get トラップ・`setByAddress`・`createListDiff`、`defineState` の型、VS Code 拡張の preamble、README ja/en の「鍵付き選択」節、テスト [proxy.keyed.test.ts](../packages/state/__tests__/proxy.keyed.test.ts) 11 件）。3,661 件成功・カバレッジ閾値内・結合とサイズの CI 門を通過。未コミット。翌日、SSR ハイドレーション経路のテスト（サーバー描画 → ハイドレーション後に購読が張り直され、選択の書き込みに追従する）を足した。DevTools への購読の露出は 3.0 の protocol 版上げ時（要件 D17）、`wcstack-skill` の `$` API 一覧の追随は別リポジトリの作業。
2. 済み: `$eqIndex` の最内段をリスト単位の監視にして、1 行削除 17.5 → 14.5 ms（id 鍵と同水準）。リポジトリにも移植した（§10.10 追記 2）。
3. 済み: (b) プラン初期描画（§10.13）、(a) session をリストごとに 1 つ（§10.14）、cold 1,000 行の内訳（§10.15: 超過 38 ms ＝ プールが隠すコンテンツ生成 18 ＋ GC 10 ＋ 暖機 7、プロファイル値）。次は cold に効く 3 候補（割り当て削減・複製とノードパス解決の T4 案・プールの事前生成）のうち、複製とノードパス解決を DOM 下限ページで試す。3 段の出荷は §10.15 の表を材料に設計者が決める。
4. S3 は 3 片（stream / recursion・dcc・watch / scopes）をサンドボックスで実装し終えた（設計案 §8-2 の実装記録: 全テスト 3,668 件成功、core → 機能の辺 41 → **14**、受け口は 12 種、読みのコストはばらつきの内側、full の `auto` は +1.3 KB gzip — 要件 D19 の判断待ち）。D19 は推奨 (a) で決まり（要件 §6）、S4 は 6 片で完了に近い（ボリューム §8-3、`$streams` / `$watch` §8-4、`$scan` §8-5、bind-component とマウント §8-6、`$recursion` と残り import §8-7）。`State.ts` は 1,683 → 1,252 行、機能 import は 24 → 3 本（うち 1 本は型のみ）。読み書き・接続の hot path の辺は 0 本。次は残る 2 本（DCC の分岐・ルート初期化失敗の着地）と分割エントリ（S5）。結合監査は `--pkg <sandbox>` で試作を測れる。
5. 済み: [audit-state-tech-helper-import.mjs](../scripts/audit-state-tech-helper-import.mjs) に `--check --max-gzip 1024` を足し、`ci.yml` の state ジョブに「`defineState` のみの再 export が 1 KB gzip 以下」の門を載せた（現在 309 bytes）。残りは要件 N3 の full / auto の gzip 閾値で、リリース時の数値を基準に別途決める。
6. 済み: 添字ループ化＋親ごとのスキップ件数で消去の割り当て 8.06 → 2.11 MB、scavenge は 5 標本すべてで窓の外、消去 18〜20 ms（§10.12 追記 2）。2 段のパッチを翌日リポジトリの `packages/state` に移植した（未コミット。全テスト成功、observer の件数消費の境界テスト [bindings.observerSkipRemovedChildren.test.ts](../packages/state/__tests__/bindings.observerSkipRemovedChildren.test.ts) を追加）。

## 12. 再現と成果物

```powershell
# repository root
npm ci --prefix e2e
npm ci --prefix packages/state
npx --prefix e2e playwright install firefox webkit    # Chromium 以外も測る場合
node scripts/audit-state-tech-coupling.mjs            # tsc を一時ディレクトリへ出力して解析
node scripts/audit-state-tech-coupling.mjs --source   # TS 原文を解析（型 import を過剰計上）
node scripts/audit-state-tech-lexer.mjs               # 字句解析の試作を現行パーサと比較
node scripts/audit-state-tech-adapter.mjs             # AST → IParsedBinding アダプタの比較と文法段のサイズ
node scripts/audit-state-tech-graph.mjs               # --expose-gc で自動再起動
node scripts/audit-state-tech-dom.mjs                 # Chromium / Firefox / WebKit
node scripts/audit-state-tech-counters.mjs            # 第 1 段: 展開・アドレス・読み・適用
node scripts/audit-state-tech-counters.mjs --list     # 第 2 段: リスト適用の内部と書き込み側
node scripts/audit-state-tech-counters.mjs --content [--trace]  # 第 3 段: 行コンテンツ生成の内部（--trace で CDP トレース）
node scripts/audit-state-tech-warmth.mjs [--bundle auto|index|<file>] [--fixture manual|tracked] [--sequence plain|counters] [--method jsfb|counters|task] [--setup input|sync] [--gc-before]
node scripts/audit-state-tech-frame.mjs               # 描画フレームの有無と消去コスト（DOM 単体・配布済みランタイム）
node scripts/audit-state-tech-split.mjs               # 機能群をスタブにして名前付きエントリを計測・帰属
node scripts/audit-state-tech-members.mjs             # メンバー単位の帰属と参照する機能群
node scripts/audit-state-tech-fold.mjs                # 帳簿形状（none / current / folded）別の行生成コストとヒープ
node scripts/audit-state-tech-coupling.mjs --check    # CI ゲート: scripts/state-coupling-baseline.json に対して逸脱なら exit 1
node scripts/audit-state-tech-helper-import.mjs       # ヘルパーだけの import が残す量（配布済み dist 対 現在の src）
node scripts/audit-state-tech-blink.mjs [--samples N] [--bundle <file>] [--out <name>]   # blink カテゴリ込みトレース: 生成 → 即消去の Layout / GC 内訳
node scripts/audit-state-tech-heap.mjs [--proto <file>] [--fixture manual|tracked]   # 1 万行の保持ヒープ（行あたり bytes）、配布 対 試作
node scripts/audit-state-tech-hookcost.mjs <label>=<file> ... [--samples N]          # proxy 経由の読み書きのマイクロベンチ（hook のコスト）
node scripts/audit-state-tech-gcshape.mjs [--samples N]                              # 帳簿形状別の生成 → 即消去の GC（DOM 下限ページ）
node scripts/audit-state-tech-heapsnapshot.mjs [--proto <file>] [--top N]            # 1 万行のヒープを型・コンストラクタ名で帰属（非 minify ビルドを渡すと名前が読める）
node scripts/audit-state-tech-profile.mjs [--bundle <file>] [--op create1k|create10k|append1k|select10k] [--warm]   # CDP Profiler の関数別自己時間（--warm で同じページの 2 回目も取り cold / warm を並べる）
node scripts/audit-state-tech-allocsample.mjs [--bundle <file>] [--samples N]          # 消去の窓の allocation sampling（関数別の自己サイズ）。出力は -shipped / -proto に改名
node scripts/audit-state-tech-helper-import.mjs --check --max-gzip 1024               # CI ゲート: defineState だけの再 export が 1 KB gzip 以下
node scripts/check-state-size.mjs --check [--update]                                 # CI ゲート: auto.min.js / index.esm.js の gzip がリリース基準 +3% 以内（要件 N3 / D18）
# e2e directory: 監査ベンチの再走行
node bench/jsfb-verify.mjs --label next-major-rerun --out ../docs/research/state-next/browser-1x-rerun.json --port 4297
# $eq 試作: packages/state をスクラッチ領域へ複製（src・__tests__・scripts・設定と、node_modules の junction、
# ルート tsconfig.json のコピー）してから
node scripts/research/keyedPrototypePatch.mjs <sandbox>/packages/state   # dependency/keyedDependency.ts を先に置く
(cd <sandbox>/packages/state && npx rollup -c && npx vitest run)
node scripts/audit-state-tech-keyed.mjs --proto <sandbox>/packages/state/dist/index.esm.js
node scripts/audit-state-tech-counters.mjs --list --pkg <sandbox>/packages/state --fixture tracked|keyed|keyedId|keyedIdUntracked|keyedIdPath|keyedIndex   # 第 2 段を試作ビルドに（-<fixture>-proto.json）
# 第 3 巡（§10.10）: keyedDependency.prototype.ts（第 3 版）を置き直してから当て、テストを足して計時
node scripts/research/keyedRound3Patch.mjs <sandbox>/packages/state   # proxy.keyedRound3.test.ts を __tests__ へコピー
node scripts/audit-state-tech-keyed.mjs --only tracked,keyedIdUntracked,keyedIdPath,keyedIndex --proto <sandbox>/packages/state/dist/index.esm.js --out keyed-round3.json
# プラン初期描画（§10.13）: 当てる前後で第 3 段を取り -planrender-before / -after に改名、warmth と profile も試作ビルドで
node scripts/research/planRenderPatch.mjs <sandbox>/packages/state
# session をリストごとに（§10.14）: 行 record の上に当て、heap / 第 3 段 / warmth を試作ビルドで（出力は -session-per-list に改名）
node scripts/research/sessionPerListPatch.mjs <sandbox>/packages/state
# 消去の割り当て（§10.12 追記 1・2）
node scripts/research/clearAllocPatch.mjs <sandbox>/packages/state
node scripts/research/clearAllocPatch2.mjs <sandbox>/packages/state
# S3 第 1 片（設計案 §8-2 の実装記録）: 現行ソースの別サンドボックスに当て、結合監査は --pkg で
node scripts/research/s3StreamSlicePatch.mjs <sandbox2>/packages/state
node scripts/research/s3FeatureSlicePatch.mjs <sandbox2>/packages/state   # 第 2 片（recursion・dcc・watch）
node scripts/research/s3ScopesSlicePatch.mjs <sandbox2>/packages/state    # 第 3 片（scopes）— 3 本は冪等で順に当てる
node scripts/research/s4VolumeLifecyclePatch.mjs <sandbox2>/packages/state  # S4 第 1 片（設計案 §8-3。S3 の 3 片の上に重ねる）
node scripts/research/s4TemporalDeclarationPatch.mjs <sandbox2>/packages/state  # S4 第 2 片（設計案 §8-4）
node scripts/research/s4ScanContextPatch.mjs <sandbox2>/packages/state       # S4 第 3 片（設計案 §8-5）
node scripts/research/s4BindComponentPatch.mjs <sandbox2>/packages/state     # S4 第 4 片（設計案 §8-6）
node scripts/research/s4RecursionDeclarationPatch.mjs <sandbox2>/packages/state  # S4 第 5 片（設計案 §8-7）
node scripts/research/s4TrimStateImportsPatch.mjs <sandbox2>/packages/state   # S4 第 6 片（同）
node scripts/audit-state-tech-coupling.mjs --pkg <sandbox2>/packages/state   # coupling-proto.json（片ごとの写しは coupling-proto-s3slice{2,3}.json）
node scripts/audit-state-tech-hookcost.mjs base=<sandbox-plain>/packages/state/dist/auto.min.js s3slice3=<sandbox2>/packages/state/dist/auto.min.js --samples 9   # hook-cost-micro-s3slice{2,3}.json
# 活性化の巻き上げ試作: 第 3 段を当てる前（-before）と後（-after）で取り、出力を改名
node scripts/audit-state-tech-counters.mjs --content --pkg <sandbox>/packages/state --fixture tracked
node scripts/research/activationPrototypePatch.mjs <sandbox>/packages/state
node scripts/audit-state-tech-counters.mjs --content --pkg <sandbox>/packages/state --fixture tracked
# record を持たない行の試作（§10.7）: BindingSession.ts を元に戻してから当て、第 3 段とヒープを取る
node scripts/research/rowRecordPrototypePatch.mjs <sandbox>/packages/state
(cd <sandbox>/packages/state && npx vitest run && npx rollup -c)
node scripts/audit-state-tech-counters.mjs --content --pkg <sandbox>/packages/state --fixture tracked   # 出力を -rowrecord-full に改名
node scripts/audit-state-tech-heap.mjs --proto <sandbox>/packages/state/dist/index.esm.js
# H1 hook のコスト（§10.8）: 現行ソースの別サンドボックスに当て、none / --inactive 3 / --gated --inactive 3 で 3 本ビルド
node scripts/research/addressHookPrototypePatch.mjs <sandbox2>/packages/state [--inactive 3] [--gated]
node scripts/audit-state-tech-keyed.mjs --only tracked --proto <sandbox2>/packages/state/dist/index.esm.js --out hook-cost-<variant>.json
node scripts/audit-state-tech-hookcost.mjs base=<plain dist> hookNone=<none dist> hookInactive3=<inactive3 dist> hookGated3=<gated3 dist> --samples 9
```

性能測定（dom / counters / warmth / frame / fold / keyed / blink / jsfb）は互いに並行させない。

- [coupling.json](./research/state-next/coupling.json) / [coupling-source.json](./research/state-next/coupling-source.json)
- [lexer-spike.json](./research/state-next/lexer-spike.json) / [adapter-spike.json](./research/state-next/adapter-spike.json)、試作 [bindTextLexerSpike.mjs](../scripts/research/bindTextLexerSpike.mjs) / [bindTextAdapterSpike.mjs](../scripts/research/bindTextAdapterSpike.mjs)
- [graph-mechanisms.json](./research/state-next/graph-mechanisms.json)
- [dom-floor.json](./research/state-next/dom-floor.json)、ページ側 [domFloorPage.js](../scripts/research/domFloorPage.js)、[browser-1x-rerun.json](./research/state-next/browser-1x-rerun.json)、`warm-vs-cold-<bundle>-<fixture>-<sequence>-<method>[-sync][-gc].json`、[frame-vs-clear.json](./research/state-next/frame-vs-clear.json)、[blink-trace.json](./research/state-next/blink-trace.json)
- [platform-status-2026-09.md](./research/state-next/platform-status-2026-09.md)
- [runtime-counters.json](./research/state-next/runtime-counters.json) / [runtime-counters-list.json](./research/state-next/runtime-counters-list.json) / [runtime-counters-content.json](./research/state-next/runtime-counters-content.json) / [runtime-counters-content-trace.json](./research/state-next/runtime-counters-content-trace.json)、トレース集計 [cdpTrace.mjs](../scripts/research/cdpTrace.mjs)
- [split-stub-sizes.json](./research/state-next/split-stub-sizes.json) / [member-attribution.json](./research/state-next/member-attribution.json)
- 試作: [keyed-prototype.json](./research/state-next/keyed-prototype.json)、差し込み [keyedPrototypePatch.mjs](../scripts/research/keyedPrototypePatch.mjs)、新規モジュール [keyedDependency.prototype.ts](../scripts/research/keyedDependency.prototype.ts)（サンドボックスでは `src/dependency/keyedDependency.ts` として置く。第 3 巡は [keyedRound3Patch.mjs](../scripts/research/keyedRound3Patch.mjs)・[proxy.keyedRound3.test.ts](../scripts/research/proxy.keyedRound3.test.ts)・[keyed-round3.json](./research/state-next/keyed-round3.json)）、[fold-shape.json](./research/state-next/fold-shape.json)、第 2 段計数 `runtime-counters-list-<fixture>-proto.json`、活性化の巻き上げ [activationPrototypePatch.mjs](../scripts/research/activationPrototypePatch.mjs) と `runtime-counters-content-tracked-proto-{before,after}.json`、record を持たない行 [rowRecordPrototypePatch.mjs](../scripts/research/rowRecordPrototypePatch.mjs) と `runtime-counters-content-tracked{,-rowrecord-full,-rowrecord-b1,-rowrecord-b2}.json`・[heap-per-row.json](./research/state-next/heap-per-row.json)
- 設計案: [state-next-major-wiring-design.ja.md](./state-next-major-wiring-design.ja.md)。S1・S2 の実装結果 [helper-import.json](./research/state-next/helper-import.json)、CI 基準 [state-coupling-baseline.json](../scripts/state-coupling-baseline.json)、H1 hook のコスト [addressHookPrototypePatch.mjs](../scripts/research/addressHookPrototypePatch.mjs)・`hook-cost-{none,inactive3,base,protoctl}.json`・[hook-cost-micro.json](./research/state-next/hook-cost-micro.json)
- 消去の GC: [gc-shape.json](./research/state-next/gc-shape.json)
- プラン初期描画: [planRenderPatch.mjs](../scripts/research/planRenderPatch.mjs)、`runtime-counters-content-tracked-proto-planrender-{before,after}.json`、[warm-vs-cold-file-tracked-plain-jsfb-planrender.json](./research/state-next/warm-vs-cold-file-tracked-plain-jsfb-planrender.json)
- session をリストごとに: [sessionPerListPatch.mjs](../scripts/research/sessionPerListPatch.mjs)、[heap-per-row-session-per-list.json](./research/state-next/heap-per-row-session-per-list.json)、`runtime-counters-content-tracked-proto-session-per-list{,-2}.json`
- cold の内訳: [profile-create1k-coldwarm-shipped.json](./research/state-next/profile-create1k-coldwarm-shipped.json) / [-proto.json](./research/state-next/profile-create1k-coldwarm-proto.json)
- 生成の帰属: [heap-snapshot-attribution.json](./research/state-next/heap-snapshot-attribution.json) / [-proto.json](./research/state-next/heap-snapshot-attribution-proto.json)、[profile-create10k-index.esm.json](./research/state-next/profile-create10k-index.esm.json)
- 消去の割り当て: [alloc-sample-clear-shipped.json](./research/state-next/alloc-sample-clear-shipped.json) / [-proto.json](./research/state-next/alloc-sample-clear-proto.json) / [-proto-loops.json](./research/state-next/alloc-sample-clear-proto-loops.json) / [-proto-loops2.json](./research/state-next/alloc-sample-clear-proto-loops2.json)、添字ループ化 [clearAllocPatch.mjs](../scripts/research/clearAllocPatch.mjs)・親ごとのスキップ件数 [clearAllocPatch2.mjs](../scripts/research/clearAllocPatch2.mjs)、[blink-trace-proto-loops.json](./research/state-next/blink-trace-proto-loops.json) / [-loops2.json](./research/state-next/blink-trace-proto-loops2.json)
