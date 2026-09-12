# 実装計画: 再帰パス（@wcstack/state）

- **状態**: **全 Phase 完了**（2026-09-10）・**main マージ済み**（PR#259 / #260・2026-09-11）・**未リリース**。A → A' → B → C → D → E をこの順で実施し、着地後は品質改善のレビューサイクルを重ねている（§7-3 以降）。ゲートは全て推奨で採択済み。残るのは §8 の受け入れ条件の最終確認とリリース判断。
- **ブランチ**: `feat/state-recursive-path`（main へマージ済み）。品質改善は `improve/recursive-path-quality` で §7-7 〜 §7-10 を実施
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
| 再帰文脈のないトップレベルでの `$getAll("nodes.**.value")`（添字省略） | `[wcs/recursion-context]` で throw する。束縛する深さが無いのに黙って全深さへ読み替えない（全体は `[]` を明示する）。計画時は「トップレベル省略形に合わせて全深さを列挙」だったが、Phase B で束縛形と合併形を別経路にした時点でこちらに倒した（README・テストとも throw が正本） |
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
| X2 | 配列を行から行へ付け替えると描画と `$getAll` が食い違う。修理案は「新親と一致しない `parentListIndex` を持つ ListIndex は再利用せず作り直す」だが、`applyChangeToFor` と `walkDependency` が ListIndex 同一性でジョインしているため独立の設計判断が要る。→ [#256](https://github.com/wcstack/wcstack/issues/256) |
| X3 | `walkDependency` のコメントが「依存グラフは epoch でメモ化される」と書いているが、`topologicalRank.ts` はメモ化していない（ヘッダにそう書いてある）。コメントの誤り |
| X4 | 描画なしの世代分裂（A3）は再帰専用ではなく、`for` を持たないリストを `$getAll` するアプリ一般に当たる既存欠陥である可能性が高い。いつ入ったかは未確認 |
| X5 | 宣言の検証が **初回マウント**で throw すると、`_resolveLoading()` に届かず `connectedCallbackPromise` が永久 pending になる（作者が受け取るのは診断ではなく無言のハング）。再セット経路なら同じ宣言が正しい文面で同期 throw する。`$listKeys` / `$watch` / `$streams` も同じ性質なので Phase B の回帰ではないが、`$recursion` は新しい宣言面なので**出荷前に決着させたい**。宣言検証全般を `_failInitialization` と同じ「resolve してから raise」経路に載せる独立の Issue にする。**着地後レビュー（§7-3）で実測確認**: `$recursion: { "nodes": "children.*" }` は同期 throw 無し・`console.error` 0 件・promise 永久 pending。→ [#257](https://github.com/wcstack/wcstack/issues/257)（**修理済み**: 着地は `connectedCallback` の `await this._initialize()` を包む catch（`State._failInitializeLoudly`）1 箇所。`connectedCallbackPromise` を元のエラーで reject ＋ `console.error` 1 件、`initializePromise` は解決のまま。`__tests__/integration.initFailureDiagnostics.test.ts` と欠陥9 で固定） |

X2 は #256、X5 は #257 として Issue 化した（X1 は未作成）。X10 は X6・X7 と同じ #258（§7-2）。X3 はコメント修正のみ。X4 は E1 の修理でまとめて解消される見込み。

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
| 遅延実体化の早期 return | `registry.isMaterialized(path)`。`getterPaths.has` で見ると、前世代の生成物が残る再セット後に `listPaths` の登録だけが抜ける（**→ §7-4 で撤去**。判定は `materializeFor` の台帳 `_accessors` 参照に一本化し、§7-10 で `PathInfo` キーの記憶を前段に置いた） |
| バインド確立時のパス存在検査 | `checkDeclaredPath` が `matchesRecursivePath` を先に見る（実体化はしない）。見ないと、正しく描画・更新されているのに「更新は黙って捨てられる」と警告が出る（**→ §7-4 で撤去**。現在は `expand.ts` の `depthOfConcretePath` / `isStructuralSuffix` を使う畳み込みで判定する） |
| 接頭辞と接尾辞の重なり | 一致とみなさない。`nodes.**.*` の接尾辞 `.*` がアンカーの末尾と重なると slice が空文字に畳まれ、アンカー自身（実データの行）が深さ 0 の展開形に化ける |

**成果物**: `src/recursion/{types,declaration,expand,registry,materialize,bind}.ts`（`materialize.ts` は §7-9 で `registry.ts` / `generation.ts` へ吸収して撤去）、State / proxy / manifest / pathDiagnostics の接続、`recursion.declaration.test.ts`（27）/ `recursion.expand.test.ts`（38）/ `integration.recursionGetter.test.ts`（81）。

**完了条件（達成）**: 具体パスでアクセスした再帰 getter が正しい深さの値を返す。`PathInfo` / 依存グラフに `**` が入らない（機構で強制）。同一 state・同一深さの登録が重複しない。全件 3001 件緑・カバレッジ閾値を下げていない。

## 5. Phase C — `$getAll` と再帰集計（**完了**・2026-09-10）

- [x] 省略形の文脈束縛（Phase B）と `[]` の全深さ列挙を**別経路**として実装した。非空接頭辞は `[wcs/recursion-getall-form]` で拒否する（`**` のどの深さの何段目かを言えないため）。
- [x] 深さ優先・行きがけ・添字昇順の列挙（`src/recursion/walk.ts`）。深さ方向だけを自前で降り、各深さの具体パスは固定 arity のまま扱う。
- [x] 台帳生成は既存の `createListDiff` を利用し、差分基準は E1 の共有正本を読む。読みのときだけ走査の最後に確定する。
- [x] 空・未定義の children は既存走査の終端規則と揃えた（`createListDiff` が空の行に畳む）。
- [x] 触れた具体パスへの依存は `getByAddress` の `checkDependency` が登録する。空の children を読むこと自体が依存になるので、初めて追加された子が検出される。
- [x] 葉更新・末端への追加・枝削除・順序変更・親リスト置換・同一バッチの複数変更を、描画あり／なしの両方で検証した。
- [x] 三段の鎖 `1 → 2 → 3` で各ノードの total が `6 / 5 / 3`、全 value の合計が `6`。
- [x] **E6（D12）を同時に実装**。共有配列と循環を拒否する。

**E6 の述語（反証レビューで作り直した）**:

当初は「台帳の親が、いま降りてきた親か」（`newIndexes[0].parentListIndex !== parentListIndex`）で判定していたが、**これは共有と同値ではない**。台帳はリスト配列の identity だけをキーにしているので、行オブジェクトを作り直すふつうのイミュータブル更新（`nodes.map(n => ({...n}))` は children を参照ごと引き継ぐ）でも親 ListIndex が別物になり、正当な木が恒久的に拒否された。しかも診断文は「各ノードに自分の children 配列を与えよ」と、作者が既にやっていることを要求していた。

正しい述語は**走査そのもの**が持つ。訪れた配列の集合と、いま降りている枝の祖先の集合を持ち、同じ配列に 2 度到達したかで決める。祖先に居れば循環、そうでなければ兄弟共有。空配列は行を持たず別名化のしようがないので追跡しない（`[]` の使い回しは正当）。コストは配列 1 本あたり Set 操作 2 回。

**その他、レビューで直したもの**:

| # | 内容 |
|---|---|
| 祖先判定が `null` を比較しない | ルート配列へ戻る循環（最も素直な循環）が `shared-list` と報告されていた。走査ベースの述語にしたことで解消 |
| 実効深さが 1 段浅かった | 葉の 1 段先を投機的に読んでいたため、仕様の 128 段ちょうどの木が上限超過で落ちた。上限検査は「その深さに実際にノードが居ると分かってから」行う |
| ノードごとのパス生成 | 深さごとに 1 回決まるものを行ごとに作り直していた（1023 ノードで 0.81ms → 深さごとなら 0.003ms） |
| 接尾辞展開が O(N·D) | 行の ListIndex を持っているのに `collectWildcardIndexes` を階層 0 から呼び直していた。接尾辞ぶんだけを行起点で展開する |
| 依存登録の重複 | `getByAddress` の `checkDependency` が同じ辺を張る。書き写した版は `untracking` も他行読み取り検出も欠く劣化版だった |

**完了条件（達成）**: 再帰テンプレートなしで getter 集計が更新され、全深さ列挙の結果と順序が確定する。通常の `$getAll` の省略規則・返り順・差分基準を維持する（全件 3083 件緑・カバレッジ閾値を下げていない）。

**成果物**: `src/recursion/{walk,getAllRecursive}.ts`、`integration.recursionGetAll.test.ts`（61）/ `integration.recursionShape.test.ts`（7）。

## 6. Phase D — `$setAll` のブロードキャスト（**完了**・2026-09-10）

- [x] 呼び出し形の検査を**列挙より前**に行い、再帰では `[]` のブロードキャストだけを許す。
- [x] 全深さ列挙から具体アドレスを確定してから `setByAddress` で書く。
- [x] 再帰構造自体への書き込み（ノード・子リスト・子ノード）を `[wcs/recursion-structural-write]` で拒否する。
- [x] 再帰 getter を指す書き込みを `[wcs/recursion-readonly]` で拒否する。
- [x] 空木・`undefined`・`null`・配列値・件数・適用順・書き込み後の集計と表示を検証した。
- [x] 上限超過・循環・共有・不正引数で 1 件も書かれないことを確認した。通常の `*` パスの mapper / spread は回帰テストで維持。

**拒否する形と理由**（設計書 §7-3）:

| 形 | 診断 | 理由 |
|---|---|---|
| mapper | `wcs/…-value-kind` | `(current, ...indexes)` の添字が深さごとに本数を変える。深さを渡す別シグネチャを決めてから入れる |
| `{ spread: true }` | 同上 | 木に 1 次元配列を配るのは作者が走査順を知らないと使えない |
| 添字の省略 | 同上 | 書き込み API に暗黙の文脈依存を持たせない（`$setAll` の既存の決定 D4） |
| 非空接頭辞 | `wcs/recursion-setall-form` | どの深さの何段目かを言えない |
| 構造への書き込み | `wcs/recursion-structural-write` | ノードを差し替えると確定済みの子アドレスが壊れる |
| 再帰 getter | `wcs/recursion-readonly` | setter が無い |

**レビューで直したもの（blocking 2 件）**:

**書き側も差分基準を確定する。** 当初は固定 arity の `$setAll` に合わせて `commitDiffBaseline: false` で列挙していた。しかしあの契約は「読みの**私有**基準を書きから動かさない」という E1 以前の所有権モデルの話で、いまの基準は読み・描画・依存ウォークが共有する state 側の正本である（§3-2）。確定しないと、cold（読みも描画も経ていない）状態の `$setAll` が全深さぶんの ListIndex 世代を鋳造したまま基準を残さず、次の構造変更でその世代を見られない diff が行を鋳造し直す。生き残った深い children の台帳だけが死んだ世代の親を指し、以後**再帰 getter の読みが恒久的に落ちる**。値の合併は動き続けるので getter を読むまで無症状で、**1 件も書かない `undefined` のブロードキャストでも壊れる**（＝「書き込み 0 件」は「状態が動いていない」を意味しない）。再現には孫が要る — 削除される兄弟の隣に子を持つノードが居ないと、孤児にする台帳が無い。

**再帰 getter の判定を族ベースにする。** 接尾辞の完全一致しか見ていなかったので、反復語の整数倍だけ違う綴り（`nodes.**.children.*.total` と `nodes.**.total`）が素通りしていた。これは同じファイルの宣言衝突検査が既に持っている条件で、書き側だけがその規則を欠いていた。判定を共有ヘルパ `_sameFamily` に寄せ、あわせて getter の**下**（`nodes.**.total.x`）への書き込みも拒否する（setByAddress が getter を評価して返ったオブジェクトへ書き、キャッシュを汚したまま「書けた」と数えていた）。

**既知の制限として残したもの**:

- ブロードキャストは同一参照を全ノードへ配るので、値が配列だと共有が生まれる。`$setAll("nodes.**.tags", [], arr)` の後に `$getAll("nodes.**.tags.*", [])` を読むと、再帰の診断ではなく `wcs/wildcard-rank` で落ちる。共有の検査を接尾辞側にも掛けると、接尾辞が反復語を含む形（`nodes.**.children.*.value`）で**同じ族を 2 通りに綴れる**ことによる自己衝突を起こすため、検査は深さ方向にだけ掛けている。
- 戻り値は「書き込みを試みたアドレス数」であって「値が変わった数」ではない（同値ガードで setter が呼ばれなくても数える）。既存 `$setAll` と同じ規約。
- 第 2 相でユーザー setter が throw してもロールバックしない（§1-3 の記述どおり）。
- `createState("readonly", …)` の中でも書ける（X1。再帰固有ではなく、X1 の修理でそのまま反転する）。

**完了条件（達成）**: 初回呼び出しから描画なしで一括更新でき、読みと書きが同じ列挙順を使う。全件 3146 件緑・カバレッジ閾値を下げていない。

**成果物**: `src/recursion/setAllRecursive.ts`、`integration.recursionSetAll.test.ts`（60）、`integration.recursionShape.test.ts` に cold 書き込みの回帰 2 件。

## 7. Phase E — 統合、静的解析、利用例（**完了**・2026-09-10）

- [x] bind-component / mount のスコープで宣言・評価深さ・添字が混入しないことを確認した。未対応の配置は**無言の誤動作をやめ、診断にした**。
- [x] state 置換・切断再接続・木の伸縮で registry と生成アクセサの世代を検証した（登録数が頭打ちになることを実測）。
- [x] SSR / hydration を検証した。**クライアントが宣言だけから再生成する方式で足りる** — スナップショットには `**` も展開後の具体パスも `$recursion` も載らない。展開深さを snapshot protocol に足す必要は無い。
- [x] vscode-wcs の宣言抽出・パス検証・getter 依存解析を対応させた（`src/service/recursionPaths.ts` / `recursionValidator.ts` 新設）。再帰 getter を文字列上の自己参照という理由だけで循環扱いしない。
- [x] 静的に判定できる診断（未宣言の `**`・未対応の形・非空接頭辞・構造への書き込み・再帰 getter への書き込み）を lint 側に出し、実行時にしか分からないもの（共有配列・循環・深さ超過）は runtime 専用にした。正当な `$getAll(path, [])` は一律にエラーにしない。
- [x] `packages/lint` を更新後の validator core から build して smoke test（17 件）を通した。
- [x] `examples/recursive-tree/` を追加した。自己参照コンポーネントで木を描き、合計・全選択解除・深い子の追加を操作できる。CI と同じ `wcs-validate` で error 0 件。
- [x] `README.md` / `README.ja.md` に「Recursive Paths」の節と診断表の追記を入れた。

### 7-1. 統合で見つかった欠陥と、その修理

8 件（blocking 1・major 5・minor 2）。うち 4 件を修理し、4 件は範囲外として記録した。

**修理した 4 件**:

| # | 内容 | 修理 |
|---|---|---|
| blocking | 再帰パスを一度読んだ後に `setInitialState` で再セットすると、以後アンカーへの構造書き込みが**毎回** `Cannot expand dynamic dependency…` で落ち、自己回復しない。値は書かれるのでデータと表示が乖離する | アンカーのリストパスは宣言から静的に分かるので、宣言の時点で `listPaths` に登録する。加えて、**旧世代の生成アクセサを指す依存辺だけ**を再セット時に外す（`RecursionRegistry.forgetGeneratedDependencies`） |
| major | ボリューム（`mount=`）の `$recursion` が warn も error も無く黙って捨てられていた（`$streams` は名指しで拒否される） | `validateVolumeDeclarations` で接ぎ木前に拒否する |
| major | ボリュームの `**` getter が「データだけ載ってアクセサが 1 本も無い」半端な接ぎ木を残していた（検査が `defineTreeAccessor` まで遅れるため） | 同上。接ぎ木前に `**` を含むキーを拒否する |
| major | マウントされたコンポーネントの `$recursion` に `wcs/mount-dollar-declaration` の誘導が出ず、作者が受け取るのは翻訳後のパスを名指しする無関係な `binding-path-missing` だけだった | `MOUNT_DOLLAR_DECLARATIONS` に `$recursion` を追加 |
| major | `Ssr.extractStateData` が `Object.entries` で own+enumerable な getter を**生の state オブジェクトを this にして**評価していた。パス getter なら NaN → JSON の null で静かに壊れ、`$getAll` を呼ぶ getter なら TypeError でページ全体の SSR が落ちる | アクセサは評価しない。スナップショットが運ぶのはデータで、派生値はクライアントが同じ宣言から作り直す |

**依存表のクリアは採らなかった。** blocking の真因は「`_listPaths` はクリアされるのに依存辺は残る」ことなので、依存表そのものをクリアする案を実験した。全件は通ったが、**再セット後に集計 getter まで更新されなくなる**回帰を自前のプローブで検出したので撤回した（既存バインディングの辺まで消える）。この世代が作った辺だけを外す形に落ち着いた。

### 7-2. 範囲外として記録した既存欠陥

| # | 内容 |
|---|---|
| X6 | SSR ハイドレーション後、`for` の中のワイルドカード getter バインドが葉の更新に永久に追従しない。**再帰固有ではない**（`nodes.*.double` でも同一症状）。ハイドレーションが初期適用を行わないため依存辺が張られない。トップレベルの集計は追従するので「合計は動くのに行だけ止まる」形になる |
| X7 | `setInitialState` の再セット後、`for` の行バインドが以後の書き込みに追従しない（集計 getter は追従する）。X6 と同じクラス。再帰とは独立 |
| X8 | マウントされたコンポーネントの子スコープで `onclick: <method>` がホスト state 側のメソッドを指すと、その `for` が 1 行も描画されず診断も出ない。設計書 §1-1 の `clearSelection()` を行のボタンから呼ぶ形を塞ぐ |
| X9 | マウントスコープから `$getAll("rows.**.value", [])` を呼ぶと、診断が**翻訳後**のパス（`nodes.**.value`）を名指しする。作者のソースに無い綴りなので grep しても見つからない |
| X10 | `setInitialState` の再セット後、**wildcard 無しの getter** が旧世代のキャッシュ値を返す（`{ items: [1,2], get sum }` を `{ items: [5,6] }` に再セットしても `sum` は 3 のまま。§7-3 で発見）。`_state` セッタは listPaths / getterPaths / pathSet と再帰の生成辺は整理するが getter キャッシュには触らず、wildcard 無しの絶対アドレスは世代をまたいで同一。再帰の合併形 getter も同じで、再セット前に読んだものだけが旧値を返す。X7 と同じ「再セット後」クラス。`integration.recursionKnownDefects.test.ts` 欠陥8 で現状固定。**追記（§7-4）**: wildcard 無しに限らない。listIndex 付きの絶対アドレスも、再セットで**同じ配列インスタンス**が引き継がれれば台帳（配列 identity がキー）ごと世代を跨ぐ。再帰の生成アクセサについては §7-4 で辺と一緒にキャッシュも落とすようにしたが、作者が手で書いた行 getter のキャッシュは同じ形で残る（辺が残るので構造書き込みで dirty にはなる）。proxy を経ず生配列を `splice` してから同じオブジェクトを再セットした場合は、データパス（`nodes.*.value` 等）のキャッシュも旧値のまま残る — 生データの直接変更は契約外だが、#258 の修正計画で「再セット時に世代を跨ぐキャッシュ」を扱うならこの形も対象に含める |

X6・X7・X10 は同じ「再セット・ハイドレーション後に一部の機構だけ世代を跨ぐ」クラスなので、1 つの Issue にまとめた → [#258](https://github.com/wcstack/wcstack/issues/258)。

### 7-3. 着地後レビュー（2026-09-11）

全 Phase 完了後のコードレビュー（プローブ 9 本で実測）。blocking 1 件を修理し、既存欠陥 3 件を記録した。

**修理した blocking — 多段の反復サブパスで途中のオブジェクトへの一括書き込みが素通りしていた。** `{ "nodes.*": "branch.children.*" }` で `$setAll("nodes.**.branch", [], { children: [] })` が `wcs/recursion-structural-write` にならなかった。`assertNotStructural`（runtime）と `structuralWriteTarget`（vscode-wcs）が、反復単位を剥がした残りを `"." + repeatList` との**完全一致**でしか見ていなかったため。実測では 2 件書いて深さ 1 のノードを消し、`treeTotal` は古いまま残った（この書き込み自身が確定した深さ 1 のアドレスが宙に浮く、拒否の理由そのもの）。判定を「反復サブパスのセグメント接頭辞」（`""` / `.branch` / `.branch.children`）に直し、両側に回帰テストを足した。

**問題なしを実測で確認したもの**: `$updatedCallback` からの再置換（ネストしたバッチ・基準はバッチ開始時の値で一致する）／再セット後・読みより前の入れ子リストへの構造書き込み／行イベントハンドラからの束縛形（`setLoopContext` がループのアドレスを積むので深さが取れる。`integration.recursionGetAll.test.ts` に固定）／固定 arity の cold `$setAll` → swap → 読み。

**既存欠陥（再帰固有でない）**: X2 は「行オブジェクトを作り直して children 配列を引き継ぐ置換（`nodes.map(n => ({...n}))`）」のあと、その行の集計だけが葉の更新に追従しない形で再現する。手書きの 3 段 getter でも同じ。Phase C レビューでこの形を正当な木として通したが、通した先で黙って誤るので、README の既知の制限に載せる（`integration.recursionKnownDefects.test.ts` 欠陥7 で現状固定）。X5 の無言ハングを実測で確認した。X10 を新規発見した（上の表）。

**あわせて直したもの**: `bindRecursivePath` の二重照合／`concretePathAt` が上限超過のパスを intern してから throw していた点（文字列から数えて先に検査）／`IStateElement.recursionRegistry` の `unknown` 型とキャスト（`import type` で型付け）／「`$setAll` は基準を commit しない」という記述 3 箇所（set-all-design §6-2・`walk.ts`・`stateListBaseline.ts`）が再帰 `$setAll` と矛盾していた点／§1-2 の「トップレベル省略形は全深さ列挙」（実装は throw）。

**完了条件（達成）**: runtime・エディター・CLI・ドキュメントで初版の対応範囲が一致し、example を静的検証で確認できる。packages/state 3179 件緑・カバレッジ閾値維持、vscode-wcs 798 件緑（coverage 込み）、lint smoke 17 件緑。

### 7-4. 着地後レビュー・第 2 回（2026-09-11）

指摘 16 件（高 3・中 6・低 7）。15 件を修理し、1 件（15）を理由付きで却下した。ランタイムとエディタ診断の判定パリティを原則に、片側を直したものは対になる側も直した。

**修理（ランタイム）**:

| # | 内容 | 修理 |
|---|---|---|
| 1（高） | 未実体化の生成 getter の**具体パス**（`nodes.*.children.*.total`）への書き込みが `**` を経ないので読み取り専用検査を通らず、`setByAddress` の fast path が行オブジェクトへ素の値を書き、代入値を `dirty:false` で固定して集計を壊す。実体化後は `Reflect.set` false の無言 no-op | `RecursionRegistry.recursiveGetterOwning`（展開形とその値の内側を、実体化せずに `**` getter に帰属させる・記憶付き）を新設し、`setByAddressCore` の入口で `hasRecursion` ゲート付きで `wcs/recursion-readonly` にする。固定 arity `$setAll`・値付き `$resolve`・直接代入・値の内側をすべて塞ぐ |
| 2（高） | class 構文（prototype）の同名具体 getter を `_define` の own-only 検査が素通りし、生成アクセサが無言で影にする | `IStateElement.getOwnStateDescriptor` を `findStateDescriptor`（プロトタイプチェーン走査）に置き換え。データプロパティも衝突として拒否 |
| 5（中） | `$setAll("nodes.**.children.length", [], 0)` が通過し全深さの children を切り詰める | `assertNotStructural` に `"." + repeatList + ".length"` を追加 |
| 6（中） | `currentRecursionDepth` がスタックを外側へ走査して深さだけを拾い、添字は先頭からしか取れないので、`**` getter → 素の getter → `**` の形が `ListIndex not found` か「深さ × 全行」の無言誤値になる | 深さも**先頭フレームだけ**から取る（README「each of those carries a real ListIndex」の通り）。`addressStackAt` は撤去。設計上の後退ではない — 外側走査が「支える」と主張していた形は実際には一度も成立していなかった |
| 7（中） | 同じ state オブジェクト（同じ配列）の再セットで、生成アクセサの辺だけ外れてキャッシュが残り、読む前の構造書き込みが集計に届かない | `forgetGenerated` で辺と一緒にキャッシュも落とす。旧 state のデータを台帳（配列 identity）に沿って辿り、各深さの行 × その深さのアクセサの絶対アドレスを列挙する |
| 8（中） | オブジェクトを返す `**` getter の値の内側へのバインドが偽の `binding-path-missing` | `checkDeclaredPath` が `recursiveGetterOwning` で「値の内側」まで黙る |
| 10（低） | `$listKeys` の `**` キーを無言で受理 | `processListKeysDeclaration` で `wcs/recursion-unsupported` |
| 11（低） | `$getAll("…**…", null)` が生の TypeError。アンカー照合が添字検査より後で静的側と別コード | 形の検査を `getAllRecursive` へ移し、アンカー照合 → 添字の形の順にした。固定 arity の `$getAll` の非配列 `indexes` も診断にした |
| 13（低） | 未使用フィールド・重複照合 | `IRecursionAccessor` を `{ recursivePath, depth }` に、`IRecursivePathParts.spec` / `registry.concretePath()` / `isMaterialized` / `resolveRecursiveAddresses` を削除、`assertNotStructural` は `IRecursionSpec` |
| 14（低） | コメント・文言の齟齬 | `getAllRecursive.ts` / `getAll.ts` の「`$setAll` は更新しない」を固定 arity 限定に、`PathInfo.ts` の文面に `$setAll` を追加、`scriptCallArgs.ts` の「正規表現もどき」を削除 |
| 16（低） | `_nonAccessors` の有界性 | コメントで根拠（キーは intern 済みのワイルドカード形パスの部分集合 ＝ D10 と同じ上限）を残した |

**修理（vscode-wcs）**: 3（宣言が静的に読めない形で「未宣言」と断定しない）・4（`matchesRecursion` が畳む深さを 0 まで降りる）・5（`.length`）・8（`**` getter の値の内側は存在扱い）・9（代入 / `$postUpdate` / `$trackDependency` / `$listKeys` の `**` を `recursion-unsupported`）・1（具体パス綴りの `$setAll` / 値付き `$resolve` / 代入を `recursion-readonly`）・12（ボリュームの `$recursion` / `**` getter を `recursion-declaration-invalid`）。

**却下（理由付き）**: 15（`walk.ts` の二重走査 — 2 度目の `getByAddress` はキャッシュ命中、`createListDiff` は台帳既存で `isSameList` の O(n) 比較のみ。合併形かつ接尾辞に反復語を含む稀な形の定数倍で、`descend` と `expandSuffix` の読みを共有すると形の検査（`guardShape`）の掛け方が絡んで走査が複雑になる）。**採らなかった案**: 9 の「README の表を実装に合わせる」（表が正しく、実装を表に合わせた）／6 の「外側走査を残して診断だけ足す」（残すと定義にない値を返す経路が残る）。

**残課題**: 静的側は通常（非再帰）の getter の値の内側（`total.count`）にも `binding-path-missing` を出す（ランタイムは UNKNOWN で黙る）。本 PR 固有ではないので手を付けていない。

### 7-5. 着地後レビュー・第 3 回（2026-09-11）

第 2 回の修理はすべて解決を確認（副作用も無し）。新規 5 件（中 1・低 4）をすべて修理した。

| # | 内容 | 修理 |
|---|---|---|
| 1（中） | `...tree` で `$recursion` を持ち込むオブジェクトリテラルは「読める」ので `undeclared` になり、正当なコードに `recursion-unsupported`（error）が出て `wcs-validate` が exit 1 | `stateAnalyzer.hasTopLevelSpread` を新設し、「オブジェクトリテラルが読めて、トップレベルに spread が無く、`$recursion` が無い」ときだけ断定する |
| 2（低） | 新設の代入走査が `blankComments` で、文字列・テンプレートの中の `this["…"] = 1` を代入と誤認 | `maskCommentsAndStrings`（export 化）の鏡像で探し、パスは同じ位置を原文から切り出す。`validateApiCalls` は既存 validator 家系と同じ `blankComments` のまま（テンプレート補間の中の呼び出しを見失わないため） |
| 3（低） | 添字綴り（`this["nodes.1.total"] = 9`）はランタイムが `nodes.*.total` に畳んで拒否するが静的側は沈黙。加えて**ランタイム側**も API のパス引数（`$setAll("nodes.1.total", [], 9)` / 値付き `$resolve`）は getResolvedAddress を経ないので素通りし、`nodes[1].total` を生の行に書いていた（getter が勝ち続けるので集計は無事だが `$getAll("nodes.1.total", [])` は汚れた値を返す） | 両側で添字セグメントを `*` に畳んでから照合する（runtime `recursiveGetterOwning` / static `owningGetterSuffix`）。バインディングの添字綴りは静的側が元から `template-syntax` で拒否するので `matchesRecursion` には掛けない |
| 4（低） | class 構文テストの「影にされていない」assert が `{}` を検査していて空振り | `__state` を対象にし、prototype と作者 getter の値（-1）まで見る |
| 5（低） | §7-4 の件数、`bindingValidator.ts` の撤去済み API 名 | 文言修正 |

**参考（非指摘・記録のみ）**: 同一オブジェクトの再セット直前に proxy を経ず生配列を `splice` した場合は、生成アクセサだけでなくデータパスのキャッシュも旧値のまま残る。生データの直接変更は契約外（§7-2 X10 の追記を参照）。

### 7-6. 着地後レビュー・第 4 回（2026-09-11）

第 3 回の修理 5 件はすべて解決を確認（添字畳みの述語がランタイムの `ResolvedAddress` と一致することも突合済み）。新規 2 件を修理した。

| # | 内容 | 修理 |
|---|---|---|
| 1（中） | ランタイムの添字畳みを「アンカーで始まらないとき」にしか掛けていなかったので、ワイルドカードと添字の**混在綴り**（`nodes.*.children.0.total`）が畳まれず素通り。`$setAll` は行 0 に書いた後に children が空の行 1 で生の `Reflect.set called on non-object`（部分書き込み）、`$resolve` は無言で汚染。静的側は無条件に畳むので捕まえていた（パリティ欠陥） | `recursiveGetterOwning` で無条件に畳む（パスごとに初回 1 回・記憶済み）。混在綴りの `$setAll` / `$resolve` / 値の内側と、葉の対照を両側のテストに追加 |
| 2（低） | 静的側の添字述語が整数綴り（`^\d+$`）だけで、ランタイムが添字と読む空セグメント・`1e3`・`-1`・`0x1` に沈黙 | 述語をランタイムと同じ「`*` でなく `Number()` が NaN でない区切り」に揃えた |

### 7-7. 第 2 サイクル・第 1 回レビュー（2026-09-12）

先入観の無い指摘者による実装全体の再点検。9 件（高 2・中 3・低 4）をすべて修理した。

| # | 内容 | 修理 |
|---|---|---|
| 1（高） | `**` パスの**接尾辞側**の添字綴り（`nodes.**.children.0` / `.children.0.children` / `.children.0.total`）が構造・読み取り専用の検査をすり抜け、子を置換して集計が stale、または部分書き込みの途中で生の `Reflect.set called on non-object` | `indexSegmentsToWildcard` を `expand.ts` へ移して両呼び手で共有し、`setAllRecursive` は接尾辞（先頭の区切りの後ろ）を畳んでから `assertNotStructural` / `conflictingRecursiveGetter` に掛ける。列挙は綴りのまま（接尾辞の添字は「その子だけ」の意味）。静的側 `validateSetAllForm` も同じ。README の構造行に「添字綴りも同じ形」を追記 |
| 2（中） | 同一オブジェクト再セットのキャッシュ落としが、接尾辞にワイルドカードを持つ `**` getter（`get "nodes.**.tags.*.up"()`）に届かない（タグ行の ListIndex に載るキャッシュを、ノード行の ListIndex で引いていた） | `_forgetCacheEntries` を生成パスごとに `wildcardParentPathInfos` を台帳に沿って末端まで降りる形に書き直した |
| 3（高） | `$trackDependency("nodes.**.value")` が生文字列のまま依存表に載って無言に受理され、getter が stale（`$postUpdate` / `$resolve` / `$watch` は `getPathInfo` の不変条件で落ちる — この 1 入口だけの穴） | `trackDependency.ts` の先頭で `**` を `wcs/recursion-unsupported` に。宣言の有無に関わらず拒否 |
| 4（中） | 反復サブパスが単純な文字列リテラルでないと静的側が `recursion-declaration-invalid`（error）を出す偽陽性（識別子参照 `REPEAT` はランタイムでは正当）。テストがその偽陽性を固定していた | `RecursionEntryInfo.repeatDefinitelyNotString` を足し、数値・真偽値・null・配列・オブジェクト・関数・メソッド短縮記法と断定できるときだけ error。`${}` の無いテンプレートは文字列として受理。テストの期待を反転 |
| 5（中） | `**` getter の接尾辞が構造そのもの（`nodes.**.children` / `.children.*` / `.children.length` / 多段なら `.branch`）でも宣言時に拒否されず、生成 getter が実データの子リストを全深さで影にする（`$getAll("nodes.**.value", [])` が `[1, 2]` に縮む） | 述語を `expand.ts` の `isStructuralSuffix` に統合し、`RecursionRegistry` の構築時と `validateRecursiveGetters` の両方で拒否（`recursionGetterInvalid(…, 'structural')`）。README の拒否一覧に追記 |
| 6（低） | `$getAll("…**…", null)` と配列でないリテラルに静的側が沈黙（`validateSetAllForm` は拾っていた） | `$getAll` 分岐で `null` / 文字列・数値・真偽値・オブジェクトリテラルを `recursionGetAllForm(…, 'notArray')` に。`undefined` は束縛形なので黙る。README の getall-form 行を更新（runtime-only の 6 コード表は不変） |
| 7（低） | `_state` セッタが `forgetGenerated` を新宣言の検証より先に実行し、不正な `$recursion` での再セットが throw すると旧レジストリだけが残る半端な状態に | 新しい宣言とレジストリを先に組み立て、通ってから旧世代を忘れて差し替える順に変更。#257 の修理には踏み込まない |
| 8（低） | 束縛形の読みが評価ごとに `concretePathAt` で文字列連結＋ワイルドカード数えをやり直す | `RecursionRegistry.concretePathAt(suffix, depth)`（接尾辞 → 深さ順の記憶。上限超過は throw するので載らない） |
| 9（低） | `IRecursionWalkOptions.commitDiffBaseline` が両呼び手 true 固定／`IRecursivePathParts` が `suffix` 1 フィールド／`hasRecursion` / `recursionRegistry` が optional で読み方が 2 系統／`bind.ts` の `"."` | オプションと引数を撤去し走査は常に確定／`splitRecursivePath` は静的側と同じ `string \| null`／2 フィールドを必須にし、読み手は `hasRecursion === true` ゲート ＋ `!` に統一（テストのモックはフィールドを持たなくてよい — ゲートが偽になるだけ）／`DELIMITER` |

**記録**: 接尾辞に添字を含む `**` パスの葉（`$setAll("nodes.**.children.0.value", [], v)`）は、children が空の行で「親の無いパスへの書き込み」として生の TypeError になる。固定 arity の `$setAll("nodes.*.children.0.value", [], v)` と同じ既存の性質で、再帰固有ではないので手を付けていない（README の「a rejected call leaves the tree untouched」の直後に、形の検査に限る旨を添えた）。

**再検証後の追記（指摘 7 の残り＋記録事項）**:

- **指摘 7（完了）**: 順序変更だけでは `this.__state = value` と `getterPaths` の再収集が検証より先に走り、throw 後も「state は新・レジストリは旧」のままだった。`processRecursionDeclaration(value)` と `new RecursionRegistry(spec, value)` は `value` しか読まない（コンストラクタは `getAllPropertyDescriptors(state)` と純関数だけ）ので、`processCommandTokensDeclaration` と同じく **`__state` の差し替え前**に持ち上げた。再セットの宣言不正時は要素が丸ごと旧世代に留まる（テストで `__state` 据え置き・旧世代の `[131, 2]` が読めることまで固定）。
- **#257 の表面（修理済み）**: 指摘 5 で新設した「構造を名指す `**` getter」の構築時 raise も、初回マウントで他の宣言検証と同じ着地に載る —— `connectedCallbackPromise` が**元のエラーのまま** reject し、`console.error` が 1 件出る（`initializePromise` は従来どおり解決）。着地は `connectedCallback` の `await this._initialize()` を包む catch 1 箇所に置いたので、`_initialize` が投げうるもの（宣言検証 7 種・ソースのロード 4 経路・SSR データの merge・`setStateElement` の「1 rootNode 1 ツリー」違反）が全部載る。`integration.recursionKnownDefects.test.ts` 欠陥9 は現状固定から**契約の固定**へ反転し、着地の全面は `integration.initFailureDiagnostics.test.ts`。
- **添字綴りの getter キー**: `get "nodes.**.children.0"()` も両側で区切り後ろを畳んでから構造の述語に掛ける（指摘 1 と同じ扱い）。
- 据え置き: `$recursion: { get "nodes.*"() {…} }`（ランタイム受理・静的 error）は作為的な形なので対応しない。

### 7-8. 第 3 サイクル（2026-09-12）

3 体目の指摘者（先入観なし）による再点検。12 件（高 1・中 3・低 8）のうち 11 件を修理し、1 件（4: `packages/lint/dist/cli.cjs` の再生成）は統括者が最後に行う（smoke-test の 1 件追加だけ先に入れた）。

| # | 内容 | 修理 |
|---|---|---|
| 1（高） | `**` getter の展開形と同名の具体 getter（`get "nodes.*.children.*.total"()`）を、ランタイムは「その深さを最初に読んだとき」にしか拒否せず、静的側は `**` どうししか見ていなかった。データが浅い間は通り、木が 1 段深くなった瞬間にバインディングが落ちる | `RecursionRegistry._assertNoConcreteCollision`（構築時・前世代の生成物は除外）と、静的 `validateRecursiveGetters` の非 `**` 宣言への `concreteExpansionSuffix` 照合（`recursionConcreteCollision`）。既存の「読みの時点で落ちる」テストは再セット経路に書き換え、`_define` の保険は「構築後に生の state へ足す」形で残した。初回マウントでは #257 の無言ハングになる — 欠陥9 に 1 件追加 |
| 2（中） | `$recursion: { ["nodes.*"]: … }` / `{ ...REC }` を静的側が「it is empty」と偽陽性で拒否 | `analyzeRecursionDeclaration` が計算キー・spread を含むオブジェクトを `objectLiteral: false`（断定しない）に倒す（`hasUndecidableEntries`） |
| 3（中） | マウントされたコンポーネントの `**` getter が warn も error も無く黙って捨てられる | `warnMountedDollarDeclarations` が `**` を含む getter キーも `wcs/mount-dollar-declaration` に載せる。静的側は `bind-component` の `<wcs-state>` の `$recursion` / `**` getter を `recursion-declaration-invalid`（warning）で報告 |
| 4（中） | `packages/lint/dist/cli.cjs` が古い | **統括者が再生成**。smoke-test に「spread で宣言を持ち込む state が exit 0」を追加（再生成まで赤） |
| 5（低） | 代入走査が `++` / `--` を見ない | `scriptPatterns` の `ROOT_BRACKET` / `ASSIGN_TAIL` / `PRE_INCDEC` を共有（semanticValidator と同じ部品） |
| 6（低） | `_ownerByPath` が添字綴りの数だけ単調に増える | 記憶のキーを畳んだ形（`pattern`）に。`_accessors.get(concretePath)` の先頭命中はそのまま |
| 7（低） | 上限の境界値（127 通る / 128 落ちる）がテストに無い | 集計は 127 段の鎖で `[127]`（実体化 127）、128 段の鎖で深さ 127 の葉が 129 段を要求して `recursion-depth-exceeded`。合併形は 128 段の鎖で 128 件、129 段で落ちる（README「folds a chain 127 deep and stops at 128」どおり） |
| 8（低） | `walkDependency.ts` の陳腐化したコメント | 「キャッシュ無し・再セットで辺が外れることがある」に改めた |
| 9（低） | `[wcs/recursion-anchor]` の文面が 3 箇所に逐語コピー | `pathDiagnostics.recursionAnchorMismatchMessage` に集約 |
| 10（低） | `hasRecursion` / `recursionRegistry` の doc と `setAllRecursive` の `indexes` 型 | doc を実態（必須。モックが通るのは vitest が型検査しないから）に、`indexes: unknown` に統一 |
| 11（低） | README「Not in this version」の抜け、デモ README の構造書き込みの範囲、接尾辞ワイルドカードの合併形の順序 | 3 点とも en/ja 対で追記（`nodes.**.tags.*.v` → `[3, 4, 5, 7]` の例） |
| 12（低） | CHANGELOG [Unreleased] の Fixed が 1 段落・Added と重複 | 未リリース機能なので Fixed を Added に吸収し、利用者に見える最終契約だけを残した。vscode-wcs 側も同じ粒度に整理 |

### 7-9. 第 4 サイクル（2026-09-12）

4 体目の指摘者（先入観なし）による再点検。11 件（中 4・低 7）をすべて修理した。

| # | 内容 | 修理 |
|---|---|---|
| 1（中） | 反復語ぶんずれた展開形の値の内側（`$setAll("nodes.**.children.*.total.x", [], v)`）を `conflictingRecursiveGetter` / `conflictingGetterSuffix` が拾えず、静的側は沈黙、ランタイムは走査（基準 commit）の後の第 2 相で初めて readonly | `expand.coversSuffix` / `recursionPaths.coversSuffix`（接尾辞の `.` 境界の各接頭辞に `sameFamily`）を両側の述語にし、列挙より前に `wcs/recursion-readonly` |
| 2（中） | `$recursion` を宣言した state では全書き込み（アンカー外も）が `recursiveGetterOwning` の畳み（split + `Number()` + join）を毎回払う（+101ns / +180〜252ns） | intern 済み `PathInfo` をキーにした `WeakMap` 記憶（`recursiveGetterOwningPath`）を前段に置き、畳みは miss 時だけ。**修正後の計測**（50,000 回・5 ラウンド最良値・2 回実行）: `s.counter = i` +7ns / +19ns（1.02× / 1.07×）、`s["form.a"] = i` +4ns / +26ns（1.01× / 1.09×） |
| 3（中） | 宣言時（構築時）の診断にランタイム側のコードが無い。getter キーのアンカー不一致は 4 本目の手書き文面。README 診断表に `wcs/recursion-declaration-invalid` が無い | `declaration.ts` / `registry.ts` の宣言時 raise に `[wcs/recursion-declaration-invalid]` を付け、アンカー不一致は `recursionAnchorMismatchMessage`。README 診断表に行を追加（lint が先に出す旨）。CHANGELOG に一言 |
| 4（中） | `mount` / `read` / `write` / `TNode` / `node` / `forest` / `recursionState` が 7 ファイルにほぼ同文でコピー | `__tests__/helpers/recursionTestUtils.ts`（`makeMount(prefix)` / `read` / `write` / `writeCount` / `writeError` / `node` / `forest` / `recursionState` 基本形 / `UNION_TOTAL` / `UNION_VALUES`）に抽出し、5 ファイルの mount と 7 ファイルの read / write を差し替え（挙動不変の機械的抽出）。合併形 getter を足す getAll / setAll は基本形を包む局所ラッパーで同じ state を組む。返り値の形が違う Shape の `mount` と Integration の `mountHost` は据え置き |
| 5（低） | registry.ts の責務混在 | `_sameFamily` → `expand.sameFamily`、「区切り後ろだけ畳む」イディオム → `foldSuffixIndexes`（両側・4 箇所）、`materialize.ts` は削除して `getByAddress` が `registry.materializeFor` を直接呼ぶ（空レジストリのガードは `materializeFor` 内 → §7-10 で `materializeForPathInfo` へ移設）。世代の後始末（own 生成アクセサの削除・辺・キャッシュ）は `generation.ts` に分離（`forgetGeneration` / `isGeneratedGetter` / `markGeneratedGetter`） |
| 6（低） | `**` の接尾辞に空セグメント・末尾区切り・素の `*` があっても受理 | `splitRecursivePath`（両側）で拒否 → `wcs/recursion-anchor`（文面に「整形された接尾辞」を追記） |
| 7（低） | 同じ state を `$recursion` 無しで再セットしても own の生成アクセサが残り、`getterPaths` に拾い直されて `recursion-unsupported` になる | `forgetGeneration` が own の生成 getter を `delete`。セッタの順序を「宣言検証 → 旧世代の後始末 → 差し替え → 再収集」に整理し、`getStateInfo` より前に呼ぶ。テストで再セット後の `getterPaths` に生成パスが無いことを固定 |
| 8（低） | 再セットで `$recursion` が不正なとき `_commandTokenNames` / `_eventTokenNames` は throw より前に差し替わる | `value` しか読まない**純検証をすべて先に**（`$recursion` の宣言とレジストリ構築・`$commandTokens`・`$eventTokens`）済ませ、その後で後始末（`forgetGenerated`）→ 差し替え → 再収集。§7-7「要素が丸ごと旧世代に留まる」はこれで正確になった（テストでトークン名の据え置きも固定）。**再検証で回帰を検出**: 最初の整理ではトークン検証が後始末の後に回っており、`$recursion` は正当で `$commandTokens` が不正な再セットが「レジストリは新・own 生成アクセサと辺は消えた・`__state` は旧」で throw していた（別アンカーなら旧世代の集計が無言で消える）。トークン検証もレジストリ構築の直後に移し、別アンカー＋不正トークンで旧世代の `[131, 2]` が読めることを固定 |
| 9（低） | 陳腐化した記述 4 点 | `setAll.ts` のコメント／set-all-design §6-2／design §10（決着済みの注記）と §6-3（`$129` 修理済み）／デモ README のコード付与の説明を現行実装に合わせた |
| 10（低） | 合併形の走査ごとに `concretePathAt` をやり直す | `collectRecursiveAddresses` に `registry` を渡し、`pathsAt` が `registry.concretePathAt` の記憶を使う |
| 11（低） | `recursion.expand.test.ts` の同名 `it` | 後者を `listPathsUpTo:` 付きの題名に |

**再検証後の追記（低 2 件・第 4 サイクル）**: #8 の回帰（上の行に記載）を修理。lint の挙動が増えた 2 点（`wcs/recursion-anchor` の不整形接尾辞・`wcs/recursion-readonly` の反復語ぶんずれた値の内側）を vscode-wcs CHANGELOG に追記し、README 診断表の `wcs/recursion-anchor` 行にも不整形接尾辞を添えた（en/ja）。

**再検証後の追記（低 3 件・第 3 サイクル）**: 行 7 の修理欄を実装どおり（集計 127 / 128、合併形 128 / 129）に訂正。マウント／ボリュームのブロックでも宣言に依存しない検査（`**` の代入・`$resolve` / `$postUpdate` / `$trackDependency`・`$listKeys` キー）を走らせる（`spec = null`・`undeclared = false` で呼び、宣言依存の `$getAll` / `$setAll` の形は黙る — §7-4 #12 の判断と矛盾しない）。Fixed の撤去で落ちていた「固定 arity の `$getAll` に配列でない `indexes` を渡すと生の TypeError ではなく診断」（既リリース API の挙動変更）を `### Changed` に戻した。

### 7-10. 第 5 サイクル（2026-09-12・最終点検）

5 体目の指摘者（先入観なし）による最終点検。19 件（中 7・低 12）をすべて修理した。

| # | 内容 | 修理 |
|---|---|---|
| 1（中） | `defineState()` の公開型面に `**` の索引シグネチャが無く、`this["nodes.**.value"]` が TS2551。VS Code 拡張の preamble だけが対応していて型面のパリティが割れていた | `WcsStateApi` に preamble と同じ `` readonly [key: `${string}.**.${string}`]: any `` を追加（再検証で、素の `nodes.**` に合致しないと指摘され `` readonly [key: `${string}.**`]: any `` も両側に追加）。`docs/define-state.md` に「再帰パスは `any`・通常のドットパスは損なわない」節、`docs/typescript.md` §1 に 1 行。`__tests__/defineState.test.ts` に**実際に tsc へ通す型テスト**を 3 件（`**` の読みが通る／通常パスの綴り間違いは従来どおり error／通常パスの値型は保たれる） |
| 2（中） | 宣言のある state では全読みが `materializeFor` の文字列キー `Map.get` + `Set.has` + `startsWith` を親ウォークの段数ぶん払う | 書き側 `recursiveGetterOwningPath` と対称に `WeakMap<IPathInfo, IRecursionAccessor \| null>` の記憶（`materializeForPathInfo`）を前段に置き、`getByAddress` が `address.pathInfo` を渡す。否定も記憶する（定義集合は世代内で不変・記憶はレジストリが持つので世代を跨がない）。**計測**（同一プロセス内 A/B・50 万回・9 ラウンド最良値）: ゲート 1 回あたり `counter` 9.3 → 6.3ns、`nodes.*.value` 13.3 → 5.4ns、`nodes.*.total`（展開形）6.2 → 4.1ns。読み全体（10 万回・9 ラウンド）は plain 比の差がプロセス間ノイズ（±40ns）に埋もれる水準。空レジストリのガードは `materializeFor` から `materializeForPathInfo` へ移設した（二重になり到達不能化したため）。**再検証**: 指摘者の計測で plain 比 +123ns → +42ns を確認。前段の記憶を置いた後は文字列キーの `_nonAccessors` が PathInfo 記憶と同じ否定判定を二重に持つだけ（PathInfo は intern されパス文字列と 1:1）だったので撤去し、否定の記憶は `_accessorByPathInfo` の 1 か所にした |
| 3（中） | README「このバージョンに含まれないもの」が `$setAll` と `$getAll` を 1 文に束ね、`$getAll` の添字省略（束縛形＝正当）まで拒否されると読めた | 2 つの箇条に分け、`$getAll` は「**添字省略は正当**（再帰 getter の中では束縛形）」と明記（en/ja 対） |
| 4（中） | デモの注記「添字を省くと呼び出し文脈の深さに束縛される」が誤り（再帰 `$setAll` の省略は常に拒否） | 「書き込み API はどこから呼んでも文脈を取らないので拒否される」に修正 |
| 5（中） | ルート CHANGELOG が `$setAll` の 4 形すべてに `wcs/recursion-setall-form` を付けていた（ランタイムでコードが付くのは非空接頭辞だけ） | README 診断表と同じ切り分けに修正（mapper / spread / 添字省略は文面で形を名指し、lint は同じコードで報告する旨） |
| 6（中） | vscode-wcs CHANGELOG の未リリース節が積み上げ履歴のままで、後の箇条が前を上書きしていた | code ごとに最終的な判定範囲を 1 回だけ書く形へ統合（root と同じ「最終契約だけ」） |
| 7（中） | `integration.recursionSetAll.test.ts` のコメントが現在の契約の逆（`commitDiffBaseline: false`） | 「再帰の `$setAll` は観測したリスト値を基準へ確定する（固定 arity だけが確定しない）」に書き換え |
| 8（低） | 設計書 D12 / §7-2 が共有配列の検出を旧案（`createListDiff` 戻り値の参照比較）のまま掲げていた | D12 の決定欄を「走査そのもの」に直し、§7-2 に訂正注記（Phase A 訂正と同じ書式）を追加 |
| 9（低） | `$recursion: ["nodes.*"]` を静的側が黙る（ランタイムは `recursion-declaration-invalid`）。配列リテラルだけ断定の候補から漏れていた | `analyzeRecursionDeclaration` の `definite` に `/^\[/` を追加。テストで固定 |
| 10（低） | `${}` の無いテンプレートリテラルのパス引数（`` $setAll(`nodes.**.children`, [], []) ``）を静的側が黙る（宣言の値側は受理していた） | `scriptCallArgs.literalString` が置換の無いテンプレートも読む。`wcs/index-arity` ほか API 引数を見る検査すべてに効く |
| 11（低） | アンカー / 反復サブパスの途中の添字セグメント（`{ "nodes.*": "children.0.*" }`）を両側とも受理。エンジンは添字を `*` に畳むので意味を持たない奇形 | `assertNodePath` / `checkNodePath` の両方で `wcs/recursion-declaration-invalid`（畳みと同じ述語 `!isNaN(Number(segment))`）。README 診断表と CHANGELOG にも追記 |
| 12（低） | 撤去済み API 名がコメントに残る 4 箇所 | `recursionPaths.ts` の 2 箇所（`_sameFamily` / `assertNotStructural` → `expand.ts` の `sameFamily` / `isStructuralSuffix`）、getter テストの `forgetGeneratedDependencies`（現 `forgetGeneration`）、Phase B 表の `isMaterialized` / `matchesRecursivePath` に「→ §7-4 で撤去」 |
| 13（低） | `diagnostics.ts` / `messages.ts` の code の doc コメントが初版の部分集合のまま | 現在の型ユニオン（`RecursionWildcardSite` の 8 種・`StructuralWriteTarget` の 4 種・不整形接尾辞・宣言形の全列挙）に更新 |
| 14（低） | `anchorList` / `repeatList` をランタイムが 7 箇所で再計算（静的側 `RecursionSpec` は持っている） | `processRecursionDeclaration` で確定して `IRecursionSpec` に載せ、`expand` / `walk` / `setAllRecursive` / `registry` / `State.ts`（`_listPaths.add` のアンカーリスト — 再検証で漏れを指摘され修理、未使用になった `DELIMITER` import も削除）の再計算を差し替え。名前は静的側と同じ |
| 15（低） | `State.findStateDescriptor` と `pathDiagnostics.findDescriptor` が同じ走査の 2 本立て | `findDescriptor` を export して共有（打ち切り位置が 2 本に分かれない） |
| 16（低） | 使われない戻り値・export | `assertNodePath` は `void`、`nodePathAt` は非 export（テストの同語反復 1 件を削除）、`hasDefinitions` / `materializedPaths` は「テスト専用」と doc に明記 |
| 17（低） | `integration.recursionShape.test.ts` に `console.log` が 4 箇所 | 削除 |
| 18（低） | impl-plan ヘッダの状態・ブランチが §7-7〜§7-9 と食い違う | 「main マージ済み（PR#259 / #260）・品質改善は `improve/recursive-path-quality` で §7-7 〜 §7-10」に更新 |
| 19（低） | README の Features 一覧に「再帰パス」が無い | 1 行追加（en/ja 対） |

**再検証後の追記（部分解決 1 件・低 6 件・第 5 サイクル）**: #14 の漏れ（`State.ts` のアンカーリスト再計算）を修理。`**` の索引シグネチャが素の `nodes.**`（再帰 getter の中でノード自身に束縛される読み）に合致しなかったので、`` `${string}.**` `` を `defineState` と preamble の両方に足し、型テストを両側に 1 件ずつ追加。#1 の en 文書に対応する ja（`define-state.ja.md` の「再帰パス」節・`typescript.ja.md` §1 の段落）を追加。vscode-wcs CHANGELOG の `wcs/recursion-unsupported` に「宣言の無い `**` getter のキーだけは warning」を添え、入れ子のバッククォートを二重バッククォートに直した。#10 の拡張が `wcs-validate` の既存検査（`wcs/index-arity`・`wcs/getter-untracked-read` の入れ子書き込みの証拠）にも効くので、ルート CHANGELOG の `### Changed` に `@wcstack/lint` の 1 行を追加。#2 の前段記憶と二重になっていた `_nonAccessors` を撤去（上の #2 の行に記載）。

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
