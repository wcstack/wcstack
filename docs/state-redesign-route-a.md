# state 再設計 — A 路線 詳細仕様（動的深追跡を維持して内部を整える）

- **状態**: 詳細仕様ドラフト（2026-06-27）。評議会 [state-redesign-council.md](state-redesign-council.md) の **the one true fork が {A, 現状} に決着**した帰結として、唯一土俵に残った「動的深追跡を維持する」路線の詳細を起こす。
- **前提（決着済み・本書では再論しない）**:
  - **動的深追跡（proxy・文字列パス・`walkDependency`）は維持**する。静的cell降格（B/C）は `data-wcs` の構文の壁を壊すため不採用（council §10・ADR-8）。
  - **B/C＝signals 系は廃止しない**。別系統の併存として維持（本書は state 単独の仕様）。
  - 死守の壁（構文＋プロトコル）は1ミリも動かさない。裏（実装・内部表現・TS API）は全焼可。async は IOノード/resource seam に隔離し state コアは純同期（council ADR-2）。
- **本書の眼目**: A 路線は「動的か静的か」では決着済みなので、残る問いは **「どこまで作り直すか」**。**no-regret 加点 → ツーリング正本化 → オラクル整備 → 構造再構築** の4ステージに段階化し、各ステージに**挙証ゲート**を置く。**安い・低リスク・高ROI から順に並べ、各ゲートで「ここで止めてよいか」を判定**できるようにする。全部やる必要はない。

---

## 0. 設計原理（A 路線の背骨）

1. **state は同期宣言層に徹する**。`data-wcs` が「HTML が宣言的にリアクティブになる」体験を提供し、その同期エンジンを**完成させる**のが A の目標。async を一級化しない（それは signals の仕事）。
2. **裏は全焼してよいが、表は golden で凍結**。構文契約（`IBindingInfo` パーサ出力・パス意味論・token 振る舞い）を characterization test で pin し、内部を入れ替える。
3. **「作り直し」は最終手段**。Gate 0 / Step 2 が「主要な勝ちは現行コアに足せる」と実証した以上、**まず加点で取れるものを取り切り**、構造再構築は癒着解消という構造的動機が残ったときのみ。
4. **挙証責任（council ADR-4）を各ステージに継承**。次ステージへ進むには「前ステージでは届かない便益」を示す。

---

## 1. ステージ全体図

```
Stage A1  no-regret 加点         ── 低リスク・加点・再構築不要・最高ROI
  同値ガード / wcs:ready / 更新理由トレース / command-token規範化
  （※ computed同値短絡は実測の結果 A1 でなく A4 へ格下げ・§A1-2 ★）
        │ ゲート: 実 example のプロファイルで同値書込比率を測り、加点が純益か確認
Stage A2  ツーリング正本化        ── 中ROI・state外の構造欠陥(二重実装)を断つ
  単一正本 manifest / @wcstack/state/syntax 純パーサ / vscode-wcs を Volar.js へ載せ替え
        │ ゲート: 二重実装の同期コストが消えたか・補完/診断が現行同等以上か
Stage A3  オラクル整備           ── Stage A4 の前提（レッドチーム kill shot への回答）
  構文壁の characterization test 群 / タイミング契約の成文化・観測可能化
        │ ゲート: 内部を入れ替えても表の不変を機械検証できる状態になったか
Stage A4  構造再構築            ── 最高リスク・構造的癒着が動機として残る場合のみ
  GraphCore / ListReconciler / Scheduler 3層整流 / 癒着解消 / list commit前倒し / statePhase
        │ ゲート: 癒着が実害（バグ/拡張困難）を生んでいるか・A3 のオラクルが緑のままか
```

各ステージは**独立に出荷可能**で、A1 だけで止めても価値が確定する。A4 は「やらない」が正当な選択肢。

---

## 2. Stage A1 — no-regret 加点（最優先・低リスク）

現行コアに足すだけで、作り直しを要しない。Gate 0 / 性能審が実証・特定した加点群。

### A1-1. 同値ガード（same-value guard）★ Gate 0 実装・計測済み

- **仕様**: `setByAddress` 冒頭で、値が primitive（`value === null || typeof value !== "object"`）かつ `Object.is(oldValue, value)` のとき、set / enqueue / `walkDependency` を**丸ごとスキップ**。参照型（object/array）は in-place mutation 取りこぼし防止のため**素通し**（ガードしない）。
- **実測（council §9）**: 同値スカラ **−74%**・同値リスト **−65%**、値変更スカラ **+14〜21% overhead**（old 値読み出しコスト）、損益分岐 **同値書込比率 ≈16〜20%**。全1457テスト強制ONで**契約破壊ゼロ**。
- **規範（ADR-7）**: 値型のみガード／参照型素通し。**不変更新を推奨**（in-place mutation する利用者は更新が止まる＝SPEC に MUST で明記）。escape hatch は既存 `$postUpdate(path)`（ガード貫通）。
- **互換審の宿題（要対応）**: 現行ガードは同値時に `updatedCallback` / DCC bindable イベントの発火も飛ばす。テストスイートはこの契約を検証していない（被覆ギャップ）。**examples・双方向バインドのエコー・DCC で「同値時に発火を期待するコード」が無いか監査**してから既定 ON にする。監査が済むまでは `config.sameValueGuard`（opt-in・既定 false）として出荷。
- **段階導入**: ①opt-in フラグで出荷 → ②実 example でプロファイル（同値書込比率を測る）→ ③比率が分岐点超 & 互換監査クリアなら既定 ON。
- **現状【既定 ON 化済・2026-06-27】**: `config.sameValueGuard`（`IConfig`/`IWritableConfig` に追加・**既定 true**・`setConfig({ sameValueGuard: false })` で opt-out 可）。実装は `setByAddress.ts` の `--- same-value guard ---` ブロック。プロファイル用カウンタは **`benchFlags.profile`（既定 false）で gate** し本番ホットパスから分離（本番は counters を更新しない）。`src/_bench.ts` は profile フラグ・カウンタ・A1-2 実験フラグの置き場として残置。
  - **既定 ON 化の検証**: 白箱2件（`proxy.setByAddress.test.ts` の swap カバレッジ）は beforeEach で `setConfig({ sameValueGuard: false })` 固定（ガードは swap 機構と直交）。**フル 1469 テスト + カバレッジ全閾値クリア**（setByAddress/_bench 100%）＝既定 ON が suite レベルで安全と実証。
  - **⚠ 挙動変化（リリース判断が必要）**: 既定 ON で「同値 primitive set は真の no-op」になる（標準的リアクティブ挙動・Vue/Svelte/Solid と同じ）。同値 set に副作用を期待するコードは影響を受ける（例: `__e2e__/data-fetch` の `$updatedCallback` で同じ branch 再選択時にコミット再取得 → 既定 ON では再取得しない＝wcs-fetch の url 同値ガードと整合的）。これは**挙動変化なのでリリース時に minor 版アップ + changelog 明記が必要**。[[feedback_version_alignment]] に従い state/fetch/autoloader/router の版を揃える前提なので、**版アップは横断リリース判断**。不同意なら config 既定を false へ戻すだけ（1行）で opt-in に復帰可。作業ツリー上の変更で未リリースのため、メンテナがリリース時にレビューできる。

#### ★ プロファイル・互換監査の実測結果（2026-06-27）

`__tests__/audit.sameValueGuard.test.ts` で、実 example 相当ワークロードの**同値書き込み比率**と**契約変化**を計測した。

**同値書き込み比率（損益分岐 ≈16〜20%）**:

| ワークロード | same-value% | 判定 |
|---|---|---|
| W1 Todo bulk（markAll/個別toggle） | **56.3%** | 分岐点を大きく超え純益 |
| W2 冪等 re-set（fetch 応答マージ/フォームリセット） | **98.0%** | ほぼ全部同値・純益最大 |
| W3 変更主体（カウンタ/タイピング） | **0.0%** | 純オーバーヘッド |

→ 比率は**ワークロード依存だが、bulk 操作・冪等再代入・サーバ状態マージという普遍的パターンが 56〜98%** と分岐点（16〜20%）を楽に超える。純タイピングは 0%。実アプリは両者の混在だが、**fetch 応答マージ（最頻出・大半のフィールドが不変）が比率を強く押し上げる**ため、多くのアプリで純益と見込める。

**互換監査（契約変化）**: 唯一の契約変化は「**同値 set が真の no-op になる**（`$updatedCallback` / DCC イベントを発火しない）」。これは (a) 標準的なリアクティブ挙動（Vue/Svelte/Solid 全て同じ）、(b) **既に wcstack の IO ノードの哲学**（wcs-fetch は url が直前と同値なら auto-fetch をスキップ・state-search example のコメントが明記）、(c) `$updatedCallback` を使う唯一の example（`__e2e__/data-fetch` の currentBranch 変化→コミット再取得）でも同値 no-op はむしろ wcs-fetch と整合的、(d) DCC は example でゼロ使用。

**フル suite 強制ON 監査**: 1,457 テスト中**失敗は 2件のみ**、両方とも `proxy.setByAddress.test.ts` の swap カバレッジテストが `getByAddress` 呼び出し回数をモックで仮定している白箱ブリットルネス（ガードが old 値読み出しで1回足したためズレ）。**1,455 の挙動テスト（統合・SSR・双方向・リスト・イベント）は全パス＝契約破壊ゼロ**。

→ **判定: 同値ガードは既定 ON 可能（低リスク）**。推奨手順: (1) `config.sameValueGuard` opt-in で出荷＋契約変化を SPEC 明記、(2) 昇格時に上記2件の白箱テストを「呼び出し回数非依存」に修正、(3) 既定 ON。bulk/merge を含むアプリで純益。

### A1-2. computed 同値短絡（dependent value-equality short-circuit）★ 性能審が特定

- **動機**: 現行は `setByAddress` の `walkDependency` callback が、ヒットした依存を**無条件に** dirty + enqueue する（`setByAddress.ts` finally・L79-87）。computed（getter）の**再計算結果が前回と同値でも**、下流 binding は enqueue され評価まで走る（最後の DOM 代入だけ `applyChangeToText` の `!==` で握り潰される）。中間の getter 評価・filter 適用は走り切る。
- **仕様**: `walkDependency` callback で依存が getter パスの場合、**その getter を再計算し前値（`cacheEntry.value`）と `Object.is` 比較**。同値ならその getter を起点とする下流伝播を**打ち切る**（`result.add` しない / enqueue しない）。座標系は absAddress のまま（cell 不要・性能審裁定①）。
- **注意**: computed が重い場合の eager 再計算コストとのトレードオフ。dirty な getter 限定 + ヒューリスティック（fan-out が一定以上のときだけ）で適用。**A1-1 とは別物**（A1-1=set側で同値を止める / A1-2=getter出力が同値なら下流を止める）。

#### ★ 実装・実測結果（2026-06-27・重要な反証）

walkDependency に eager 短絡（getter 依存ノードを pop した時点で再計算→`Object.is` 同値なら部分木を枝刈り）をプロトタイプ実装し（`_bench.ts` フラグ `computedShortCircuit`・`walkDependency.ts` の A1-2 ブロック）、深い getter チェーン（`n → tens → label → caption`・n を1ずつ増やすと中間は10回に1回しか変わらない）で計測した:

| 構成 | ms | Δ vs off | prunes | proceeds |
|---|---|---|---|---|
| off (baseline) | 10.2 | — | 0 | 0 |
| sameValueGuard のみ | 12.4 | +21%（n は毎回変化＝ガード空振り） | 0 | 0 |
| **computedShortCircuit のみ** | **14.6〜15.4** | **+44〜51%（純損）** | 126,000 | 42,000 |
| both | 15.6〜16.0 | +54% | 126,000 | 42,000 |

**9/10 を枝刈り（prune 12.6万回）したのに +44〜51% 遅くなった。** 根本原因: wcstack は **microtask coalescing**（`updater` の `queueMicrotask` + 絶対アドレス Set 重複排除 + 遅延 pull）で、M 回の set による下流再計算を**flush あたり 1 回に畳んでいる**。baseline の walk は「ダーティ化するだけ」で getter を実行せず、再計算は apply 時に1回だけ起きる。一方 eager 短絡は**プルーン判定のため毎 set で getter を eager 再計算**し、この coalescing を破壊する。**枝刈りで「省いた」下流再計算は baseline では既に1回に畳まれていた**ので、節約はゼロに近く、eager 再計算コストだけが純増する。

**正当性**: 線形チェーン・ダイヤモンド（`r=p+q, p=x, q=2x`）の最終 DOM 値は短絡 ON でも正しい（`__tests__/bench.a1-2.test.ts` の probe がパス）。フル 1461 テストはフラグ OFF で全緑、フラグ ON 時の失敗 15 件は walkDependency 白箱単体テストのモックが `getterPaths` を持たないことによる（`?.` で防御済み・アプリ挙動のグリッチではない）。eager 版のグリッチ（masking false-prune）は原理的には構成可能だが、実テストでは顕在化せず——だが**そもそも eager 版は純損なので moot**。

**結論（A1-2 の再分類）**: 性能審の「walk callback に挟むだけ（cache 前値で Object.is）」は**実証的に覆った**。per-set eager 短絡は coalescing を壊すため A では**純損**。正しく＋効率的にやるには **flush 境界で（flush あたり1回・トポロジカルに）再計算→比較**する必要があり、それは **Scheduler のスケジューリング刷新（A4）＝三色/トポロジカルの複雑性＝まさに cell の構造的優位（候補①）**。よって **A1-2 は no-regret な A1 加点ではない。A4（Scheduler 層）の項目に格下げ、さもなくば不採用**。安価な A1 の勝ちは **A1-1 同値ガードのみ**に確定する。

**「上限」問題への含意**: 「coarse proxy が安価に取れる性能の上限」は**事実上 A1-1 同値ガードだけ**。computed 短絡の利得は Scheduler 刷新（A4）を要し、しかも効くのは「複数階層で束縛された深い安定チェーン」に限られ、microtask coalescing が既に緩和している。**cell の専有利得（候補①）は実在するが、その実現可能な実効値は小さく、fork 判定（{A, 現状}）を覆さない**。むしろ「将来 B/C を考える必要があるか」への答えを**一段と「否」に寄せる**（cell に乗り換えても①の実効は coalescing に食われて小さい）。

### A1-3. `wcs:ready`（初回適用完了の一級イベント）★ #9 の安価版

- **動機**: 現行は state ロード完了（`_initializePromise`）≠初回バインディング適用（`buildBindings`）で、初回適用完了を観測する単一フックが無い。消費側は `State.getBindingsReady()` を明示 await（#9）。
- **仕様**: `<wcs-state>` が初回バインディング適用完了時に `wcs:ready` CustomEvent を dispatch（DOM 観測可能・命令的 await 不要）。`$connectedCallback` の async 完了・url 適用・command 結線済みを包含した after-all として定義。これは**現行ライフサイクルに足すだけ**（statePhase の本格再設計は A4）。

### A1-4. 更新理由トレース（dev-mode）★ #3/#4 の可観測化

- **仕様**: 各 enqueue に理由 `reason{ trigger: "set"|"getter-dep"|"list-diff"|"postUpdate"|"command", sourcePath, sourceListIndex, viaDependency?: path[] }` を dev-mode で付与し `window.__WCS_DEVTOOLS__` に流す。「set `cart.items.0.qty` → dirty `cart.totalPrice`(getter dep) → re-render binding#42」の因果連鎖を出せる。production は `config.debug` 静的分岐で dead-code elimination（既存 spread debug の前例と一貫）。

### A1-5. command-token 引数転送の規範化 ★ #10・コード変更不要

- 実装は既に正しい（`Token.emit` の位置引数素通し・await しない、`applyChangeToCommand` の `Reflect.apply`）。欠けているのは規範文書のみ。SPEC に「位置引数 MUST 素通し / async は await しない / undefined 引数も素通し」を成文化（提案は `docs/spec-proposal-command-token-arguments.md` に既存）。23pkg 相互運用を契約として保証。

**Stage A1 のゲート**: 実 example（todo / search / cross-tab-todo / camera-record-upload 等）で**同値書込比率をプロファイル**し、A1-1/A1-2 が純益か確認。純益なら既定化、微妙なら opt-in 維持。ここで止めても state は「同期エンジンの同値短絡・初回適用観測・トレース・規範化」を得て大きく前進する。

---

## 3. Stage A2 — ツーリング正本化（二重実装を構造で断つ）

DX 派が特定した構造欠陥（vscode-wcs が state の構文・型・フィルタ・パス型を手で二重実装）を、**規律でなく構造**で解消。state コアの反応性には触れない。

- **A2-1. 単一正本 manifest**【第一増分 実装済・2026-06-27】: state がビルド時に `dist/wcs-manifest.json` を生成（構文区切り `: # @ | ;`・フィルタ名+引数仕様を `builtinFilters` から自動抽出・stateApi・予約ライフサイクル名）。`completionData.ts` の手リストを廃し manifest を読む。**ドリフト検出テスト**（manifest のフィルタ名 == `builtinFilters` のキー集合）を state 側に置き、フィルタ追加で manifest 再生成を忘れると CI が落ちる。
  - **実装済の第一増分**: `src/manifest.ts`（`getWcsManifest()`）── フィルタ名を `Object.keys(outputBuiltinFilters)` で**実装から自動導出**（手リストを持たない＝構造的にドリフト不可）、構文（bindAttribute/tagName/pathDelimiter/wildcard/structuralDirectives）・予約ライフサイクル・予約 state API を config/define から導出。`__tests__/manifest.test.ts` が (a) 実装からの自動導出、(b) **golden リストとの一致**（フィルタ増減で CI が落ち、vscode-wcs の `BUILTIN_FILTERS` 同期忘れを強制）、(c) 構文・予約名を検証。現在 vscode-wcs の手リストは40フィルタ全て揃っており**ドリフト無し**（＝検出器は将来の乖離を防ぐ番人）。
  - **第二増分 実装済（フィルタ構造化 meta）**: `src/filters/filterMeta.ts` に全40フィルタの構造化メタデータ（description/hasArgs/resultType/acceptTypes/minArgs/maxArgs/argTypes）を **state 側の正本として移設**（これまで vscode-wcs `BUILTIN_FILTERS` が手で保持していたもの）。`getWcsManifest().filterMeta` で公開。`__tests__/manifest.test.ts` が (a) **filterMeta キー集合 == builtinFilters キー集合**（フィルタ追加時の meta 書き忘れ・余剰を検出）、(b) 各エントリの妥当性（minArgs≤maxArgs・hasArgs⇔maxArgs>0・argTypes 長一致）を検証。カバレッジ filterMeta.ts/manifest.ts 100%。
  - **第三増分 実装済（ビルド時 JSON 生成）**: `npm run build` に `node scripts/emit-manifest.mjs` を追加し、DOM 非依存の rollup エントリ `dist/manifest.esm.js`（+ `dist/manifest.d.ts`）から `getWcsManifest()` を呼んで **`dist/wcs-manifest.json` を生成**。package.json に `./manifest`・`./wcs-manifest.json` の exports サブパス、exports.ts に `getWcsManifest`/`builtinFilterMeta`/型を公開。生成 JSON は40 filters + 40 filterMeta + 構文 + 予約名（10KB）。
  - **第四増分 実装済（vscode-wcs の手リスト撤去）★二重実装の構造的解消**: `packages/vscode-wcs/src/service/completionData.ts` の手書き `BUILTIN_FILTERS`（40行）を撤去し、**@wcstack/state の `builtinFilterMeta` 正本から `Object.entries(...).map(...)` で自動導出**。linkage は `src/service/wcsManifest.ts` 1ファイルに隔離（現状モノレポ内ソース参照・公開後は `@wcstack/state/manifest` import へ差し替え可）。`FilterInfo` は `IFilterMeta` を extends（型も一本化）。ドリフトテスト `__tests__/filterMeta.manifest.test.ts` 追加。**vitest 189件 + esbuild ビルド両方緑**＝二重実装が消え、フィルタ増減は state 側 1箇所の編集で vscode-wcs に反映される。
  - **第五増分 実装済（DSL 区切り + 構造ディレクティブの正本化）**: ①DSL 区切り `; : # @ |` は3つのパーサファイル（parseBindTextsForElement/parsePropPart/parseStatePart）に**散在するリテラル**だったので、`define.ts` に5定数（BINDING/PROP_VALUE/MODIFIER/STATE_NAME/FILTER_SEPARATOR）を正本化しパーサを定数参照に置換（挙動同一）。`manifest.syntax.delimiters` で公開。②構造ディレクティブは `manifest.syntax.structuralDirectives` を正本 `STRUCTURAL_BINDING_TYPE_SET` から `Array.from` で導出（手書き配列を排除）。③**vscode-wcs の `STRUCTURAL_DIRECTIVES` 手リストを撤去** → 正本集合から導出（説明は補完UI用に local 保持）、`wcsManifest.ts` が集合・区切り定数も再エクスポート、drift テスト追加。state 1469 + vscode-wcs 191 + 両 build 緑。
  - **第六増分 実装済（linkage 本番化）**: vscode-wcs を `@wcstack/state` の **file: devDependency**（`"@wcstack/state": "file:../state"`）化し、`wcsManifest.ts` の相対ソース参照（`../../../state/src/...`）を **`@wcstack/state/manifest` の published import** へ切替え。`./manifest` サブパスが `dist/manifest.esm.js`（DOM非依存バンドル）を解決。manifest.ts は消費側のため `builtinFilterMeta`/`STRUCTURAL_BINDING_TYPE_SET`/`IFilterMeta`/`getWcsManifest` を再エクスポート。191テスト + esbuild build 緑。これで vscode-wcs は state の**内部ソース構造から完全に decouple**され、公開パッケージの manifest 契約だけに依存する（build 順: state → vscode-wcs）。
  - **残る増分（未実装）**: `completionData.ts` の他の手リスト（DOM プロパティ/イベント）は Web 標準で state 固有でないため正本化対象外。state 固有の修飾子のみ将来候補。npm 公開後は `file:../state` を版指定に切替え。
- **A2-2. `@wcstack/state/syntax` 純パーサ**: `bindTextParser/*`（DOM 非依存の純粋文字列パーサ）をサブパス export し、vscode-wcs の独立パーサ（`bindingValidator.ts`）を**これに差し替え**。パース規則のドリフト余地を消す。
- **A2-3. vscode-wcs を Volar.js Virtual Code へ載せ替え**（先行技術調査の確立基盤）: data-wcs 式を `<wcs-state>` inline script の型コンテキスト上で等価 TS へ変換した仮想ファイルを生成 → 本物の TS Language Service に通す → CodeMapping で HTML 属性内の元位置へ射影。**buildless と矛盾しない**（仮想ファイルはエディタ/型チェック時のメモリ生成のみ・ランタイム不変）。`preamble.ts` の手書き型は `defineState.d.ts` から生成物に。
- **天井（Lit が示す原理的限界）**: 要素型は Import Map / autoloader で到達できる範囲しか見えない（未解決要素は optional 退化）。ワイルドカードパス・フィルタの型射影は設計次第で精度頭打ち。proxy 深追跡の動的キー/配列境界と静的型の原理的ギャップは残る。

**Stage A2 のゲート**: 二重実装の同期コストが消え、補完・診断が現行同等以上か。A1 と独立に出荷可能。

---

## 4. Stage A3 — オラクル整備（A4 の前提・レッドキム kill shot への回答）

レッドチームの A への kill shot は「凍結すべき仕様（タイミング癒着）が**暗黙で明文化されておらず**、golden で pin できない＝oracle 不在の書き直し」。**A4（構造再構築）に進むなら、その前にオラクルを作る**のが回答。

- **A3-1. 構文壁の characterization test 群**: パーサ出力（`IBindingInfo`）・パス意味論（`path-classification` 準拠）・依存伝播の振る舞い（差分条件 getter・多段ワイルドカード展開・swap）・token 振る舞いを、**現行コードを正解として特性テストで全面 pin**。これが「裏を全焼しても表が不変」の機械的番人。
- **A3-2. タイミング契約の成文化・観測可能化**: 現行は「set→無条件 enqueue→microtask 集約→absAddress→binding 索引 push」が暗黙（`timing-and-firing-contract.md` が「examples の正しさが 同期/microtask/task の3層順序に乗る」と自認）。**「1 microtask = 1 flush = 1 不動点収束」を規範文書化**し、flush 開始/終了を dev-mode の `wcs:flush` イベントで観測可能に。`$postUpdate` を「flush 境界を明示制御する公開 API」として再定義。これでタイミング契約がテスト可能になり、A4 の不動点収束ガードの正しさを検証できる。

**Stage A3 のゲート**: 内部を入れ替えても表の不変を機械検証できる状態になったか。**A3 は A4 に進まなくても価値がある**（暗黙契約の成文化は現状維持でも負債返済）。

---

## 5. Stage A4 — 構造再構築（最高リスク・構造的動機が残る場合のみ）

A 路線の「本格的作り直し」。**性能はもう A1 で取れているので、A4 の唯一の正当化は「proxy⇄dependency⇄list の癒着が実害（バグ温床・拡張困難）を生んでいる」こと**。それが無いなら A4 はやらない。

### 癒着の物理（再掲・council §2-1）
`setByAddress` の `finally` が「無条件 enqueue + `walkDependency`」を同居させ、`walkDependency` が `createListDiff` を読み出す。一方 `applyChangeFromBindings` の `lastListValue` commit は apply 末尾。**diff が「依存伝播の入力」と「DOM 差分適用の入力」の二役を負い、last-value 更新タイミングが両者でずれている**。

### 3層整流（分離でなく所有権の割り直し）
- **GraphCore（依存グラフの単一所有者）**: 現状 `staticDependency`（パス親子チェーン）と `dynamicDependency`（getter トレース）に分かれた2 Map を、1つの有向依存グラフとして明示モデル化。`walkDependency` の DFS+wildcard 展開ロジックは**アルゴリズムをそのまま移設**（正しい。問題は「set の finally に居る」こと）。**動的トレース・条件付き getter・多段ワイルドカード展開はすべて温存**（fork 決着＝動的維持の帰結）。
- **ListReconciler（配列 diff の単一所有者）**: `createListDiff` を呼ぶ2箇所（walk と for-apply）を単一問い合わせに統一。**`lastListValue` commit を set 時に確定**（apply 末尾からの前倒し）。set 時点で list の新旧は確定しているので diff を1回計算してメモ化し、依存伝播も DOM 適用も同じ diff を読む。walk/for の last-value ずれが構造的に消える。**list commit 前倒し（Gate 0 でスコープ外とした半分）はここに入る**。
- **Scheduler（enqueue の単一関門）**: 現状 `updater.enqueueAbsoluteAddress` は無条件 push。ここを唯一の enqueue 関門にし、A1-1 同値ガードを正規装備。set→GraphCore でダーティ集合確定→Scheduler が microtask 境界で1回 flush の単方向フローに整流。ループガードは `MAX_DEPENDENCY_DEPTH`（現状 stack depth のみ）を「同一 flush 内 visited 集合」と組み合わせて**値レベルの不動点収束保証**に格上げ。
  - **A1-2 computed 同値短絡はここに属する**（A1 でなく A4）。実測（§A1-2 ★）で「per-set eager 短絡は coalescing を壊し純損」と判明したため、**flush 境界で（flush あたり1回・トポロジカル順に）dirty な getter を再計算→前値と比較→同値なら下流を dirty にしない**、という三色/トポロジカルなスケジューリングとして実装する。これが効くのは「複数階層で束縛された深い安定チェーン」に限られるため、A4 を着手する場合でも**費用対効果を計測してから**入れる。

### #9 ライフサイクルの本格化
`statePhase: loaded → bound → firstApplied → idle` の明示ライフサイクルを導入。`firstApplied` を `$connectedCallback` after-hook かつ観測可能 Promise（`whenFirstApplied()`）として公開。SSR ハイドレーション・spread deferred 展開（`whenDefined` 待ち）・`bind-component` 待ちを同じ位相基準に乗せる。A1-3 の `wcs:ready` はこの `firstApplied` の DOM イベント版に統合。

### 不変条件（A4 全体）
- 構文の壁・プロトコルの壁を1ミリも動かさない（A3 の characterization test が緑のまま）。
- 動的トレース／差分条件 getter／多段ワイルドカード／任意深度 `this.a.b.c` の意味論を保存（fork 決着の前提）。
- `walkDependency` の swap（`_setByAddressWithSwap`）・部分解決非サポート等の暗黙仕様も A3-1 で pin して保存。

**Stage A4 のゲート（最も厳しい）**: 癒着が実害を生んでいる具体例（直せないバグ・入らない拡張）を1つ示せること。示せないなら A4 は「新規価値の乏しい大規模リファクタ」（A 派自認の弱点）であり、**やらないのが正しい**。

---

## 6. async の扱い（横断・layer2・state コアは触らない）

council ADR-2 の通り、async は state 再設計の対象外。A 路線でも:
- state コアは「Promise を知らない純同期」を維持（純同期コア防衛線）。
- async は IOノード（wc-bindable）/ `resource` seam に隔離し、**signals と共有実装**。
- 規範化（state 作り直しでなく seam の整備）: IOノードに**外部 AbortSignal 受け口**を足し（`command abort(signal?)`）、`resource`/`streamResource` の restart/error/fold 規範を共有（既に signals 側で確定）。`AbortSignal.any()` で「user cancel ∨ timeout ∨ 親破棄」を合成。
- 真の硬い核「proxy computed の async 寿命拡張（パス依存駆動 switchMap）」は A 路線では**コアに持ち込まない**（IOノード/resource に置く）。これは [[state-stream-type-design]] と合同で詰める残課題で、A4 の構造再構築とは独立。

---

## 7. 段階の推奨と次の安い一歩

| ステージ | リスク | ROI | 推奨 |
|---|---|---|---|
| **A1 no-regret 加点** | 低 | 最高 | **即着手**。同値ガードは opt-in 出荷→プロファイル→既定化。computed 短絡を実装し coarse の上限を確定 |
| **A2 ツーリング正本化** | 低〜中 | 高 | A1 と独立に着手可。二重実装は構造欠陥なので返済価値が高い |
| **A3 オラクル整備** | 低 | 中（A4 の前提） | A4 を視野に入れるなら必須。単独でも暗黙契約の成文化として価値 |
| **A4 構造再構築** | 高 | 条件付き | **癒着の実害が示せたときのみ**。示せないなら「やらない」が正解 |

**次の安い一歩（具体）**:
1. A1-2 **computed 同値短絡**を実装し、A1-1 同値ガードと合算で「coarse proxy が取れる性能の上限」を計測（性能審の提案ベンチ）。これで「残差＝cell の真の専有利得」が確定し、**そもそも A4 や B/C を将来考える必要があるか**の最終判断材料になる。
2. 同時に実 example で**同値書込比率をプロファイル**（A1-1 の損益分岐 16-20% を超えるか）。
3. この2つの安い計測の結果次第で、A1 を既定化して**ここで止める**か、A2/A3 へ進むかを判断する。

> A 路線の正直な総括: **fork は決着したが、その帰結は「作り直し」より「現行コアの同期エンジンを加点で完成させる」に寄っている**。Gate 0 が示した通り性能の勝ちは加点で取れ、互換審が示した通り動的深追跡は維持必須。**A1（＋必要なら A2/A3）で止めるのが最有力で、A4 の本格再構築は構造的癒着の実害という挙証を待つ**。これが「正直なコスト」に従った A 路線の姿。

---

## 関連
- [[state-redesign-council]] — 本書の親（評議会の全議論・fork 決着・Gate 0 実測・ADR）
- [[signals-state-design]] — 併存する別系統（B/C は state の置換でなくこちら）
- [[state-stream-type-design]] — async 硬い核（layer2・A 路線の対象外だが seam で共有）
- [[timing-and-firing-contract]] — A3-2 で成文化するタイミング契約の現状記述
- [[command-token-arguments-proposal]] — A1-5 の規範文書（既存）
