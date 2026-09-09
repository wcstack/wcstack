# 実装計画: 再帰パス（@wcstack/state）

- **状態**: **Phase A 完了・Phase A' 実施中**（2026-09-09）。Phase A の実測で既存機構の修正（E1〜E3）が Phase B の前提であることが判明したため、§9 の着手順に Phase A' を追加した。ゲートは全て推奨で採択済み。
- **ブランチ**: `feat/state-recursive-path`
- **設計検討**: [state-recursive-path-design.md](./state-recursive-path-design.md)。前回レビュー後の D4 / D7 / D10 / D11 の修正を前提にする。未決項目の実装上の扱いを本書に具体化し、Phase A で設計書と同期する。
- **到達点**: 描画していない木でも、再帰 getter、全深さの `$getAll`、`$setAll` による属性の一括更新が動き、葉の更新・子の追加削除・リスト置換に集計が追従する。**この到達点は既存機構の修正 E1（§3-2）を前提にする** — Phase A の実測で、`for` の無いリストへの構造書き込みが台帳の世代を分裂させることが確定したため。

## 1. 初版の範囲と契約

### 1-1. 対象

初版は state ごとに単一の自己再帰宣言を扱う。アンカーと反復サブパスは、固定プロパティ列の末尾に `.*` が一つある形に限定する（`nodes.*` / `children.*`、`data.nodes.*` / `branch.children.*` など）。途中のワイルドカード、複数アンカー、相互再帰、複数の `**` は明示的に拒否する。

```js
class TreeState {
  $recursion = { "nodes.*": "children.*" };
  nodes = [];

  get "nodes.**.total"() {
    return this["nodes.**.value"] +
      this.$getAll("nodes.**.children.*.total").reduce((a, b) => a + b, 0);
  }

  get treeTotal() {
    return this.$getAll("nodes.**.value", []).reduce((a, b) => a + b, 0);
  }

  clearSelection() {
    this.$setAll("nodes.**.selected", [], false);
  }
}
```

対象は再帰 getter の定義と getter 本体の読み、読み取り API、一括書き込み API。通常の具体パスからも、対応する深さの再帰 getter を遅延実体化して読めるようにする。`$resolve` に渡すパス自体は従来どおり固定本数の `*` のみ。

再帰テンプレート、HTML の `data-wcs` に直接書く `**`、再帰 setter の定義、直接代入 `this["nodes.**.x"] = ...`、`$watch` 等への `**` 指定、`$depth`、公開 `{ maxDepth }` オプションは初版に含めない。未対応の消費者は `**` を普通のプロパティとして解釈せず、診断を出す。既存の自己参照コンポーネントで描画し、通常の getter 名で集計を表示する。

### 1-2. 文脈と API の規則

| 操作 | 初版の意味 |
|---|---|
| 再帰 getter 内の `this["nodes.**.value"]` | 評価中の再帰宣言・深さ・行に束縛する |
| 同 getter 内の `$getAll("nodes.**.children.*.total")` | `**` を現在深さの具体パスへ置換し、既存の省略時の接頭辞規則で直下の子を列挙する |
| `$getAll("nodes.**.value", [])` | 呼び出し元の行に関係なく、宣言アンカー全体の全深さを列挙する |
| 再帰文脈のないトップレベルでの `$getAll("nodes.**.value")` | 既存のトップレベル省略形に合わせ、全深さを列挙する |
| 無関係な行文脈での省略形 | 文脈不一致として throw。全体を読む場合は `[]` を明示する |
| `$getAll` の非空 `indexes` | 再帰パスでは throw。通常の `*` パスの接頭辞規則は維持する |
| `$setAll("nodes.**.selected", [], false)` | 全深さへのブロードキャスト。戻り値・`undefined` スキップ・`null` の扱いは既存規則を継ぐ |
| 再帰 `$setAll` の添字省略・非空添字・mapper・`spread: true` | 列挙や書き込みを始める前に throw |
| `$resolve("nodes.**.value", ...)` | throw。展開後の具体パスと厳密一致する添字タプルの使用は従来どおり |

通常の具体パスの行 getter やイベントから再帰文脈を得る場合は、当該 state の宣言に合致する「最深のノード接頭辞」と実際の ListIndex から導出する。再帰 getter の評価中は、生成アクセサのメタデータで深さを確定する。文字列中の `children` の出現数や、別スコープの添字の流用で推測しない。

全深さの結果順は**深さ優先・行きがけ・添字昇順**。後続サブパスの `*` は、各ノードで既存の固定長走査と同じ順に展開する。getter の評価順は結果配列の順と区別する（親の値を求めるため子 getter が先に評価されてもよい）。

`[]` 指定そのものは正当な全体検索であり、再帰 getter 内という理由だけで禁止しない。集計の二重計上を一般に静的判定できるとは約束しない。同じ getter アドレスへ戻る循環は実行時ガードで検出する。

### 1-3. 停止・寿命・書き込みの境界

- 展開後のパス全体の `wildcardCount` を `MAX_WILDCARD_DEPTH` 以下にする。アンカー、反復部分、後続部分をすべて数える。通常の既存パスに対する新たな一律制限とは分離する。
- 次のノードが存在し上限を超えるときに、アンカー・深さ・対象パスを含む診断で throw。最大深さの葉で空の children を確認しただけでは超過にしない。
- データの循環は走査中の祖先参照で検出する。getter の再入と併せて停止を保証する。`StateHandler` の評価スタック上限と依存グラフの上限も別に存在するため、128 段の集計が必ず評価できるとは記載しない。Phase A で境界を実測し、実効上限と診断を設計書へ記録する。
- 初版の入力契約は木とする。同じ子リストを複数の親で共有する DAG は、現行のリスト値をキーにした台帳が親ごとの同一性を表せるか未検証なので、Phase A で確認し、非対応なら明示的に拒否する。
- `PathInfo` のグローバル intern は消さない。生成アクセサとそのメタデータは state の世代ごとに所有し、同一深さで重複登録しない。木が浅くなっても到達済みの深さは保持し、state の置換では旧世代を解放する。
- WeakMap の存在だけで回収を保証しない。キャッシュ・アドレス・registry からリストや ListIndex への強参照も確認する。毎ノードの固有パスを intern しない。
- `$setAll` は全対象を確定した後に書く。列挙中の深さ超過・循環・入力違反では書き込み件数ゼロを保証する。ユーザー setter が書き込み中に throw する場合のロールバックは追加しない。
- 再帰ノード自体や再帰経路の children を置換する一括操作は初版では拒否し、葉属性の更新に限定する。親を置換して確定済みの子のアドレスを壊す問題を避ける。判定対象の構造パスは宣言から導出する。

## 2. 実装の構成

`**` は既存の `PathInfo` に渡す前に解釈する。固定長パス用の `collectWildcardIndexes(): number[][]` の契約を変えず、再帰側は具体パスと添字を対で持つ結果を作る。

| 領域 | 変更案 |
|---|---|
| `src/recursion/`（新設） | 宣言検証、state ごとの registry、再帰パス解析、具体パス生成、文脈解決、全深さ列挙、停止ガード |
| `src/components/State.ts` | state 初期化・再設定時の宣言処理。生成 getter の登録。`defineTreeAccessor` の再利用と依存・リスト経路の登録 |
| `src/proxy/StateHandler.ts` / `src/proxy/types.ts` | 必要な場合に評価文脈を追加。同期ネストの push/pop と例外時の復元 |
| `src/proxy/traps/get.ts` / `src/proxy/methods/getByAddress.ts` | 再帰パスの束縛と、具体パスからの生成 getter 初回読み。キャッシュ確認前に実体化する |
| `src/proxy/apis/getAll.ts` / `setAll.ts` | 再帰パスだけ分岐。既存の固定長 API はそのまま利用する |
| `src/proxy/apis/wildcardIndexes.ts` / `src/list/createListDiff.ts` | 台帳生成・差分基準・同一性の既存経路を再利用。共有コードの抽出が必要なら固定長 API の互換テストを伴わせる |
| `src/pathDiagnostics.ts` / `src/define.ts` / `src/types.ts` / `src/manifest.ts` | 予約名、宣言の型、診断コード、公開する対応範囲。予約名の manifest 登録は宣言追加と同時 |
| `src/parser.ts` / `packages/vscode-wcs/src/service/` | 宣言・getter・API 利用の静的解析。必要な解析部分は DOM 非依存で共有する |
| `packages/lint/` | validator core を取り込む CLI の build と smoke test。ここに架空の `src/` は作らない |

再帰列挙の内部結果は `{ pathInfo, indexes }` または対応する `IStateAddress` とし、ragged な添字だけを固定された一つの `PathInfo` と組み合わせない。正本レジストリから引いた ListIndex を用いる。具体パスごとの getter 実体化は一度だけにし、getter 本体のソースコード書き換えや `eval` は使わない。

`walkDependency` と updater の無変更は**検証すべき仮説**とする。`defineTreeAccessor` は `setPathInfo(path, "prop", "internal")` を呼ぶが、`listPaths` の登録は別である。台帳が生成できることと、リスト置換で子のキャッシュを正しく無効化できることを混同しない。

## 3. Phase A — 契約の固定と成立条件の検証（**完了**・2026-09-09）

**目的**: 本実装の前に、描画なし・構造変更・遅延登録の成立条件を実測で固定する。

7 本のプローブ（cold start / 構造変更 / リスト置換 / 遅延実体化 / 木の成長 / 上限 / 循環と共有）とその反証検証で実施した。全 7 本の反証判定は PARTIAL — つまり**どのプローブも最初の結論に訂正が入った**。以下は訂正後の確定事項。

### 3-1. 確定した事実

| # | 事実 | 影響 |
|---|---|---|
| A1 | cold（走査未経験）でも `$getAll` / `$setAll` は成功する。`$resolve` だけが throw する（第 1 相を持たない唯一の API） | 設計書 §7-2 本文を訂正。`$setAll` を throw 側から外した |
| A2 | 温度は state 単位ではなく**ワイルドカード段単位**。接頭辞で絞った `$setAll(path, [0], v)` は降りなかった枝を cold のまま残す | 再帰の全深さ走査では常に全枝を降りるので実害は無いが、契約として明記する |
| A3 | **`for` の無いルートリストへの構造書き込みで台帳の世代が分裂する**。集計が恒久 stale か恒久 throw になる | **到達点のブロッカー**。E1 で修理する |
| A4 | 壊れるのはルートリストだけ。ネストしたリスト（`nodes.*.children`）は `for` 無しでも構造変更に追従する。`for` は 1 本あればよい | 修理範囲を絞れる。回避策（アンカーに `for` を 1 本置く）も存在する |
| A5 | getter を挟まなければ headless の `$getAll` / `$resolve` は正しい。旧世代が漏れるのは**getter に文脈として渡される ListIndex** の経路 | 設計書 P5 の「描画なしで動く」は getter 無しの条件でしか成立していなかった |
| A6 | 遅延実体化は「**そのパスを最初に読むより前**に生やす」なら完全に成立する（成長・縮小・ルート差し替え・同一バッチ複数深さすべて正しい） | Phase B の実装不変条件になる |
| A7 | 先に読んで `undefined` がキャッシュに載った後に生やしても恒久的に直らない。`isCacheable` が `wildcardCount > 0` だけで true を返すため | 実体化フックはキャッシュ参照**前**に置く（E5） |
| A8 | 最小登録セットは「生 state への `defineProperty` + `getterPaths.add`」。`getterPaths` の主効果は依存追跡ではなく **receiver の引き渡し**（未登録だと getter の `this` が生 state になり `$getAll` が無くて TypeError） | 登録の設計根拠 |
| A9 | `defineTreeAccessor` が呼ぶ `setPathInfo` は静的連鎖を張るが `listPaths` は触らない。各段のリストパスを `listPaths` に載せないとリスト置換が同期例外で落ちる | E4。ただし `setPathInfo(path, "for")` の流用は禁止（`elementPaths` → `isSwappable` を変える） |
| A10 | 実効上限は 3 つとも値が違う。ワイルドカード段数＝**上限なし**（V8 の RangeError が 3000〜4000）／getter 評価スタック＝**ちょうど 128**（`pushAddress`）／依存グラフ＝1000（先に踏まない） | 再帰の実効深さは **128** |
| A11 | 129 段の診断が「循環の可能性」という**誤告発**になる。`_describeAddressCycle()` は末尾 8 段を並べるだけで重複を見ていない | E2 |
| A12 | `$129` は診断ゼロで `undefined`。`$128` は正しく 0 を返す | E3 |
| A13 | 拒否すべき最小条件は「DAG」ではなく**同じ配列インスタンスが 2 つ以上の親から到達可能**。循環はその特殊ケース。検出は `diff.newIndexes[0].parentListIndex !== listIndex` の参照比較 1 回 | E6。§1-3 の「DAG は非対応なら拒否」に具体的な述語が付いた |
| A14 | ノードオブジェクトの共有は `children` が空なら完全に安全 | 拒否条件を配列共有だけに絞れる |
| A15 | 同深度の配列共有は throw せず、もっともらしい件数・値・順序を返す。`$setAll` の**定数ブロードキャストは同値ガードでバグを隠し**、mapper 形で初めて二重適用が露出する | テストは mapper 形で書く |
| A16 | walk の最中に `defineTreeAccessor` + 登録を足しても同じバッチの結果は正しい（静的・動的マップとも live 参照） | 遅延展開をバッチ中に行ってよい |
| A17 | `$getAll` はアクセサが存在しないパスにも動的辺を張る | 依存グラフに「実体の無いパス」が載る。上限打ち切り時の残骸として要観察 |

### 3-2. Phase A が要求する既存機構の修正

**E1（ブロッカー・Phase B より前）— 差分基準を描画経路から切り離す。**
`walkDependency` が読む基準 `lastListValueByAbsoluteStateAddress` を書くのは `applyChangeFromBindings` / `BindingSession` / `hydrateBindings` の 3 箇所だけで、すべて描画経路。`for` が無いと基準が永久に空のまま `createListDiff` の `oldList.length === 0` 分岐に落ち、新しい配列に新しい ListIndex を鋳造する。子の台帳は旧親を指したまま残り、連鎖が切れる。

**採った形（実装済み）**: 描画側の基準はそのまま残し、**state 側の基準**を新設して読み・描画・依存ウォークの 3 者で共有する（`src/list/stateListBaseline.ts`）。apply の基準は「最後に**描画した**値」で、`applyChangeToFor` が「画面に対して何を足し引きするか」を決めるために使う。統合すると walk が基準を進めた後の apply が空 diff になり描画が落ちるので、統合はできない。

計画時は「walk だけが自分の基準を持てばよい」と書いていたが、それでは足りなかった。**読みが作った台帳を、最初の構造書き込みが鋳造し直してしまう**ため、読み（`collectWildcardIndexes`）の基準も同じストアに載せる必要がある。結果として `docs/state-set-all-design.md` §6-2 の「基準の所有権は `$getAll` 側」は事実として成立しなくなり、同節を更新した。`$setAll` が commit しない（`commitDiffBaseline: false`）という不変条件は変わらない。

**確定はウォーク末尾ではなくバッチ末尾で行う。** ウォークごとに確定すると、同一バッチ内で同じリストへ 2 回構造書き込みしたとき、2 回目のウォークが「一度も描画されず直後に上書きされる中間値」を基準に diff を取る。中間値が落とした行の ListIndex が鋳造し直され、その行の子リスト台帳が恒久的に切れる（描画があれば `applyChangeToFor` が救うが、描画なしのツリーでは救いが無い）。バッチ中の観測は保留し、updater の drain の `finally` でまとめて確定する。こうするとバッチ内のどのウォークも「バッチ開始時の値」と diff を取り、描画側が取る diff と一致する。

ListIndex の同一性は台帳（`listIndexesByList`）が持つので、先に走った側が値照合で再利用すれば、後から走る側は `calcDiffIndexes`（identity join）で正しく合流する。

- 受け入れ: headless（`for` ゼロ）で並べ替え・先頭追加・先頭削除・親リスト再代入が集計に追従する。
- 回帰: 描画側の差分（add/change/delete）が変わらないこと。`$listKeys` のキー突合と SSR hydration の基準確定と競合しないこと。

**E2 — 深さ超過の診断を循環の誤告発から分ける（実装済み）。** `StateHandler.pushAddress` の 129 段目 throw を、**スタック全体に同じアドレスが再登場するか**で分岐する。文面は `[wcs/getter-cycle]`（循環）と `[wcs/getter-depth-exceeded]`（ただ深い）の 2 つ。

判定を「末尾 8 段のパス文字列の重複」にしてはならない。①周期が 8 より長い getter の輪を取り逃がし、しかも「重複が無い＝ただ深いだけ」と**積極的に誤った断定**をする（実測: 周期 9 の輪が深さ超過と報告された）②逆に「同じパスを別の行で読む」正当な再帰（隣接項目参照・累積 getter）はパス文字列が全段同じなので循環に誤告発される。`IStateAddress` は (pathInfo, listIndex) で intern されているので、アドレス同一性で見れば 3 つの形が正しく分岐する。

**展開器の上限を 128 未満に置かない限り、`src/recursion/` だけでは §1-3 の要求を満たせない**（先に `StateHandler` がこの文面で落ちる）。

**E3 — `$129` の無言 `undefined` を診断にする（実装済み）。** `traps/get.ts` の `INDEX_BY_INDEX_NAME` 表引き失敗時に、ドル記号 + 数字だけの prop なら `[wcs/index-param-range]` で `raiseError` する。判定は `prop.charCodeAt(0) === 36` で先にゲートする — 表引き失敗だけを条件にすると `$1`..`$N` 以外の**全プロパティ読み**が正規表現に触れ、行数×バインド数ぶん get トラップを回すリスト描画で効いてくる（実測 +9ns/読み）。

**E4 — `listPaths` にだけ載せる専用入口を新設する。** `defineTreeAccessor` に「この total パス + その経路上のリストパス群」を渡す形へ拡張するか、recursion registry 側から `_listPaths` にだけ追加する口を作る。`setPathInfo(path, "for")` の流用は禁止（`_elementPaths` にも入り `setByAddress` の `isSwappable` を変える）。

**E5 — 遅延実体化フックの位置を規範化する。** `getByAddress` の `checkDependency` の後・`_getByAddressWithCache` のキャッシュ参照**前**。条件は「パスが再帰宣言に合致し、かつ `getterPaths` 未登録」で、通常 state は boolean 判定 1 個で抜ける（`hasMounts` と同じ D18 パターン）。A6/A7 より、これを守れば §1-3 のキャッシュ無効化は不要。

**E6 — 共有配列／循環のガード（Phase B の新規コード）。** `src/recursion/` の深さ優先列挙で `createListDiff` の直後に `diff.newIndexes[0].parentListIndex !== listIndex` を判定する。固定 arity の正本である `wildcardIndexes.ts` には**置かない**（今日静かに壊れている非再帰の共有ケースが throw に変わり破壊的すぎる）。診断は `wcs/recursion-shared-list` 相当で、循環（親鎖に現在の listIndex が含まれる）と兄弟共有をメッセージで出し分ける。`$setAll` は第 1 相で throw させ、書き込み 0 件を保つ。

### 3-3. 再帰と無関係に見つかった既存欠陥（本計画の対象外・記録のみ）

| # | 内容 |
|---|---|
| X1 | `createState("readonly", …)` の中で `$setAll` と `$resolve(path, indexes, value)` が readonly ガードを素通りして実データを書き換える。ガードは `StateHandler` の `set` トラップにしかなく、両 API は `setByAddress` を直接呼ぶ |
| X2 | 配列を行から行へ付け替えると描画と `$getAll` が食い違う。修理案は「新親と一致しない `parentListIndex` を持つ ListIndex は再利用せず作り直す」だが、`applyChangeToFor` と `walkDependency` が ListIndex 同一性でジョインしているため独立の設計判断が要る |
| X3 | `walkDependency` のコメントが「依存グラフは epoch でメモ化される」と書いているが、`topologicalRank.ts` はメモ化していない（ヘッダにそう書いてある）。コメントの誤り |
| X4 | 描画なしの世代分裂（A3）は再帰専用ではなく、`for` を持たないリストを `$getAll` するアプリ一般に当たる既存欠陥である可能性が高い。いつ入ったかは未確認 |

X1・X2・X5 は独立の Issue にする。X3 はコメント修正のみ。X4 は E1 の修理でまとめて解消される見込み。

**成果物（完了）**:
- `__tests__/integration.recursionPrerequisites.test.ts` — 再帰が依存している「今日すでに正しく動く挙動」の回帰テスト
- `__tests__/integration.recursionKnownDefects.test.ts` — A3 / A7 / A11 / A12 / A13 / X1 の現状を固定する characterization テスト（E1〜E6 の修理で反転させる）
- 設計書への訂正（§7-2 cold start・台帳の世代分裂・共有配列 D12・停止の実効上限 §6-3）

**完了条件（達成）**: 集計が構造変更に追従するための登録経路（E1 / E4 / E5）と、停止保証に必要なガード（E2 / E6）が特定されている。既存機構の修正が必要であることが判明したため、**Phase B の前に E1〜E3 を実施する Phase A' を追加する**（§9 の着手順を更新）。
## 4. Phase B — 宣言・パス展開・生成 getter（**完了**・2026-09-09）

- [x] `$recursion` の読み取りと宣言検証（`src/recursion/declaration.ts`）。`getAllPropertyDescriptors` で descriptor だけを見るので getter 本体は実行しない。
- [x] 診断: 宣言なしの `**`／不正なアンカー・反復部分／複数宣言／再帰 setter／`**` が getter でない／接尾辞が空の `**`／**展開先が重なる 2 本の `**` getter**（宣言だけから静的に検出）／既存の具体アクセサとの衝突（生成物と作者定義は WeakSet で見分ける）。
- [x] 深さごとの具体パスを作る純関数（`src/recursion/expand.ts`）。生成前に上限を検査する。
- [x] state の初期化順に registry を組み込む（`_state` セッタ、`$listKeys` の直後）。再セットで作り直す。
- [x] 具体パスの読み取り直前に生成 getter を実体化する（`getByAddress` の `checkDependency` 後・キャッシュ参照前）。深さは生成アクセサのアドレスから復元する。
- [x] 直接読みの `**` を具体化する（get トラップ・`$getAll` の path 引数）。アンカー照合を深さ解決より先に行う。
- [x] 未対応の `**` に対する入口の診断。`getPathInfo` の intern miss 分岐で `**` を拒否し、**設計不変条件（D2）そのものを機構で強制**する。

**実装で決めたこと（計画時に未定だったもの）**:

| 論点 | 決定 |
|---|---|
| 反復サブパスがアンカーと同じ語で始まる形（`{ "nodes.*": "nodes.*" }`） | **受理する**。`{ nodes: [{ nodes: [...] }] }` は自己相似な木の最も自然な綴りで、相対か絶対かは名前の形では判定できない |
| `listPaths` への登録口 | `IStateElement.addListPath` を新設（E4）。`setPathInfo(path, "for")` は `elementPaths` にも入れて swap 経路を変えるので流用しない |
| 遅延実体化の早期 return | `registry.isMaterialized(path)`。`getterPaths.has` で見ると、前世代の生成物が残る再セット後に `listPaths` の登録だけが抜ける |
| バインド確立時のパス存在検査 | `checkDeclaredPath` が `matchesRecursivePath` を先に見る（実体化はしない）。見ないと、正しく描画・更新されているのに「更新は黙って捨てられる」と警告が出る |
| 接頭辞と接尾辞の重なり | 一致とみなさない。`nodes.**.*` の接尾辞 `.*` がアンカーの末尾と重なると slice が空文字に畳まれ、アンカー自身（実データの行）が深さ 0 の展開形に化ける |

**成果物**: `src/recursion/{types,declaration,expand,registry,materialize,bind}.ts`、State / proxy / manifest / pathDiagnostics の接続、`recursion.declaration.test.ts`（27）/ `recursion.expand.test.ts`（38）/ `integration.recursionGetter.test.ts`（81）。

**完了条件（達成）**: 具体パスでアクセスした再帰 getter が正しい深さの値を返す。`PathInfo` / 依存グラフに `**` が入らない（機構で強制）。同一 state・同一深さの登録が重複しない。全件 3001 件緑・カバレッジ閾値を下げていない。

## 5. Phase C — `$getAll` と再帰集計

- [ ] 省略形の文脈束縛と `[]` の全深さ列挙を別経路として実装する。無文脈・無関係な行文脈の規則を §1-2 に合わせる。
- [ ] 明示スタックによる深さ優先列挙を基本とし、台帳生成は既存の `createListDiff` を利用する。祖先循環の検出と上限チェックを含める。
- [ ] 空・未定義の children は既存走査の終端規則と揃える。不正な非配列値の扱いは Phase A で設計書に固定する。
- [ ] 結果値だけでなく、各深さのリスト読みと具体パスへの依存を登録する。空の children に依存を残し、初めて追加された子を検出できるようにする。
- [ ] 葉更新、末端への追加、枝削除、順序変更、親リスト置換、同一バッチの複数変更を検証する。list diff の最適化による取りこぼしも確認する。
- [ ] 三段の鎖 `1 → 2 → 3` で各ノードの total が `6 / 5 / 3`、全 value の合計が `6` になることを固定する。複数ルート・複数の子で文脈混入も検証する。

**完了条件**: 再帰テンプレートなしで getter 集計が更新され、全深さ列挙の結果と順序が確定する。通常の `$getAll` の省略規則・返り順・差分基準を維持する。

## 6. Phase D — `$setAll` のブロードキャスト

- [ ] 呼び出し形の検査を列挙前に行い、再帰では `[]` とブロードキャストだけを許可する。
- [ ] 全深さ列挙から具体アドレスをすべて確定してから、既存の `setByAddress` で書く。`commitDiffBaseline: false` を維持する。
- [ ] 再帰構造自体への書き込みを検出し拒否する。ユーザー setter の副作用・例外では既存の逐次書き込み契約に従うことを文書化する。
- [ ] 空木、readonly state、`undefined`、`null`、配列値のブロードキャスト、件数、全深さへの適用順、書き込み後の集計と表示を検証する。
- [ ] 上限超過・循環・不正引数で一件も書かれていないことを確認する。通常の `*` パスの mapper / spread は回帰テストで維持する。

**完了条件**: 初回呼び出しから描画なしで一括更新できる。読みと書きが同じ列挙順を使い、書き込みが読みの差分基準を動かさない。

## 7. Phase E — 統合、静的解析、利用例

- [ ] bind-component / mount のスコープ内で宣言・評価深さ・添字が混入しないことを確認する。未対応の配置があれば無言の誤動作にせず公開制約と診断にする。
- [ ] state 置換、切断・再接続、木の拡大縮小で registry と生成アクセサの世代を検証する。固定の最大深さの下で反復しても登録数が増え続けないことを見る。
- [ ] SSR と hydration で集計の一致および hydration 後の葉更新を確認する。クライアントで宣言から再生成する方式を先に試し、必要性を確かめず展開深さを snapshot protocol に追加しない。
- [ ] vscode-wcs の宣言抽出・パス検証・getter 依存解析を対応させる。再帰 getter を文字列上の自己参照という理由だけで循環扱いせず、深さが進む辺と同じアドレスへ戻る辺を区別する。
- [ ] runtime と静的解析で、未宣言・未対応形・文脈不一致・深さ超過の診断コードと範囲を揃える。正当な明示全体検索を一律にエラーにしない。
- [ ] `packages/lint` を更新された validator core から build して smoke test を行う。
- [ ] 自己参照コンポーネントで木を描画し、合計・全選択解除・深い子の追加を操作できる example を一つ追加する。HTML 内では対応済みの通常パスを利用する。
- [ ] state の `README.md` / `README.ja.md`、必要な manifest・型・診断一覧を更新する。外部の wcstack-app skill に同期すべき参照変更を整理し、構文・契約に及ぶ場合は公開前の更新対象にする。

**完了条件**: runtime、エディター、CLI、ドキュメントで初版の対応範囲が一致し、example を静的検証と headless 操作テストで検証できる。

## 8. 受け入れ条件と検証

| ID | 条件 | 主な Phase |
|---|---|---|
| R1 | 三段以上の集計で孫を二重計上せず、兄弟・別ルートの文脈が混ざらない | C |
| R2 | `for` なしで初回 `$getAll` / 初回 `$setAll` が成立する | A・C・D |
| R3 | 葉更新、空枝への追加、削除、置換、移動、同一バッチの変更が集計に反映される | A・C |
| R4 | 初回評価より深い木への成長でアクセサと依存が遅延登録される | B・C |
| R5 | 省略・`[]`・非空添字・無関係文脈の規則が API ごとに一致する | B・C・D |
| R6 | 全深さの読みと一括書き込みが同じ決定的な順序になる | C・D |
| R7 | 上限境界・循環を診断し、書き込みの列挙失敗ではデータを変更しない | A・C・D |
| R8 | `**` が通常の PathInfo に入らず、具体パスの arity と `$resolve` の厳密一致を維持する | B・D |
| R9 | 同一深さの反復・木の縮小拡大で生成物が重複せず、state 世代間で漏れない | B・E |
| R10 | 通常の `*`、getter キャッシュ、ListIndex 同一性、mapper / spread に回帰がない | 全 Phase |
| R11 | SSR / hydration 後の値と更新、スコープ越境が正しいか明示的な診断になる | E |
| R12 | runtime・vscode-wcs・lint が同じ対応範囲を認識する | E |

各 Phase では関連するテストを先に実行する。state の実装が揃った時点で `packages/state/` 内の `npm run build`、`npm run lint`、`npm run test:coverage` を実行する（coverage は全テストも実行する）。閾値はその時点の `vitest.config.ts` を正とし、下げない。

Phase E では `packages/vscode-wcs/` の build・test:coverage、`packages/lint/` の build・lint・test を各ディレクトリで実行する。server に変更した場合は同パッケージの関連 SSR テストと提供されているチェックも実行する。example は CI と同じ `wcs-validate` の対象に含め、error severity ゼロとする。不正 HTML のテスト入力は実行時の一時ディレクトリへ作る。

生成ファイルは正本から再生成する。共有設定・protocol・README の AI-agents バナーのコピーは直接編集しない。

## 9. 着手順と完了の判断

**A →（A'）→ B → C → D → E** の順に進める。実装コミットは成立条件の回帰テスト、既存機構の修正、宣言と生成 getter、再帰読み取り、一括書き込み、統合と公開資料の単位で分ける。

Phase A は完了した（§3）。その結果、**Phase A' を新設する** — Phase A が特定した既存機構の修正のうち、再帰の実装が前提にするものを先に入れる。

### Phase A'（新設・Phase B の前提）

- [x] **E1 — 差分基準を描画経路から切り離す**（ブロッカー）。state 側の共有基準 `src/list/stateListBaseline.ts` を新設し、読み・描画・依存ウォークで共有する。確定はバッチ末尾（updater の drain の `finally`）。
- [x] **E2 — 深さ超過の診断を循環の誤告発から分ける**。`StateHandler.pushAddress` でスタック全体のアドレス同一性により `[wcs/getter-cycle]` と `[wcs/getter-depth-exceeded]` に分岐する。
- [x] **E3 — `$129` の無言 `undefined` を診断にする**。`traps/get.ts` で `[wcs/index-param-range]`（ドル記号の charCode ゲート付き）。
- [x] `integration.recursionKnownDefects.test.ts` の該当ケースを**反転**させた（E1 で 8 件・E2/E3 で 2 件）。反転できなかった 1 件は cold な `$resolve` の throw で、これは E1 ではなく A1（`$resolve` だけが走査の第 1 相を持たない）なので現状固定のまま残した。
- [x] 反証レビューで見つかった 2 つの穴（同一バッチ二度書き・周期 8 超の循環）を修理し、それぞれ回帰テストを追加した（同一バッチ 2 件・周期 9 の輪 1 件・直線連鎖の対照 1 件）。診断コード 2 件は README の診断表にも追加した。
- [x] `packages/state` で `npm run lint`（新規の指摘 0 件）/ 全件テスト 2853 件緑 / `npm run test:coverage` を実行し、閾値を下げていない。

**完了条件**: headless（`for` ゼロ）で並べ替え・先頭追加・先頭削除・親リスト再代入が集計に追従し、深さ超過と `$129` が名指しの診断になる。既存の描画差分（add/change/delete）・`$listKeys` のキー突合・SSR hydration に回帰が無い。

E4（`listPaths` 専用入口）・E5（実体化フックの位置）・E6（共有配列ガード）は再帰の新規コードと不可分なので Phase B 以降で実施する。

R1–R12 と公開資料の整合が揃った時点で初版の実装完了とする。再帰テンプレートや相互再帰の実装は別計画とし、この計画の完了条件には含めない。
| X5 | 宣言の検証が **初回マウント**で throw すると、`_resolveLoading()` に届かず `connectedCallbackPromise` が永久 pending になる（作者が受け取るのは診断ではなく無言のハング）。再セット経路なら同じ宣言が正しい文面で同期 throw する。`$listKeys` / `$watch` / `$streams` も同じ性質なので Phase B の回帰ではないが、`$recursion` は新しい宣言面なので**出荷前に決着させたい**。宣言検証全般を `_failInitialization` と同じ「resolve してから raise」経路に載せる独立の Issue にする |
