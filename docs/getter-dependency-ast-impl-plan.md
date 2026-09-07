# 実装計画: getter 本体の依存読み取りを AST で解析する（vscode-wcs / lint）

- **状態**: 2026-09-08 起草・同日 Phase 0〜2 実装（branch `feat/lint-getter-dependency-ast`）。Phase 3 の出荷（Marketplace publish・skill 追随）は未。
- **届ける相手**: `wcstack-intellisense`（VS Code 拡張）と `wcs-validate`（`@wcstack/lint`）の利用者。ランタイム（`@wcstack/state`）は**一切変更しない**。
- **動機**: `@wcstack/state` の「依存追跡の境界」規則 1（[state README](../packages/state/README.ja.md) §依存追跡の境界）— `this.form.name` は `form` しか追跡しない — は、踏んだときの症状が「値が更新されない・エラーは出ない」で、runtime 側では検出不能。PR#245 のアプリ実装 AI の指摘で実際に踏まれた。静的解析なら getter 本体を読むだけで断定できる。
- **現状**: getter 本体の読み取り抽出は `semanticValidator.ts` の `collectReadPaths`（正規表現 3 本）だけで、`wcs/getter-cycle` が使っている。関数境界・`$untrackDependency` スコープ・分割代入・`this` エイリアスは正規表現では扱えない。
- **ブランチ**: `feat/lint-getter-dependency-ast`（main から `--no-track`）。コミットは `git commit -F`。`packages/lint/dist/cli.cjs`（tracked）はビルドで変わるので**コミット前に戻す**（リリース時に再生成する既存慣行）。

## 0. 決定レコード

| # | 論点 | 決定 | 根拠 |
|---|---|---|---|
| **D1** | パーサ | **acorn を `devDependencies` に追加し esbuild で inline する**（acorn-walk は不要 — 子走査は自前 20 行）。`typescript` は使わない | `esbuild.config.js` は全バンドルで `typescript` を `external` にしており、`@wcstack/lint` は「typescript を require しない runtime 依存ゼロの単一 `cli.cjs`」が契約（`packages/lint/scripts/build.mjs` 冒頭・[static-wiring-dx-design.md](./static-wiring-dx-design.md) §7）。typescript 同梱は数十 MB で不成立。acorn は依存ゼロ・MIT・`ecmaVersion: "latest"` で最新構文を受ける。inline されるので vsix / lint dist の runtime deps は不変 |
| **D2** | 解析単位 | **callable 本体ごと**にパースする（スクリプト全体ではない）。位置決めは既存の `analyzeCallableBodies`（正規表現）を使い、本体を `(async function* () {\n` … `\n})` で包んで parse する。パース失敗＝その getter については黙る | 編集中の壊れた getter 1 本が他の getter の診断を巻き込まない。構文エラー自体は TS 言語サービス（`defineState()` 仮想 TS）が既に報告している。`async function*` ラッパーは `await` / `yield` / `for await` を全部受ける超集合 |
| **D3** | 適用範囲 | **get アクセサ本体のみ**。setter・メソッド・`$watch` ハンドラ・`$connectedCallback` は対象外 | runtime は setter 内・`$untrackDependency` 内の読み取りを依存に登録しない（境界表 規則 2）。依存意味論を持つのは getter だけ。`parseTopLevelProperties` の accessor 正規表現は `(?:get\|set)` を非捕捉で畳んでいるため、`accessor: 'get' \| 'set'` を `PropertyInfo` / `CallableBody` に足す |
| **D4** | 静的と runtime の差の扱い | 静的解析の依存集合は runtime の**超集合**（分岐で実行されない読み取りも拾う）。超集合で安全な規則（循環・追跡されない読み取り）だけ作り、「依存が足りない」系の規則は作らない | 偽陰性ゼロを保ちつつ、分岐由来の偽陽性を構造的に排除する |
| **D5** | 既存の正規表現規則 | **据え置き**。AST 化するのは `wcs/getter-cycle` だけ | `nested-assign` / `array-mutation` / `array-index-assign` / `updated-callback-unbound` は「スコープに依存しない形」の検出で、正規表現で十分かつ実績がある。AST はスコープ（関数境界・`$untrackDependency`）が要る規則に限る。パーサ分裂（設計書 §1-1）は増やさない |
| **D6** | 新診断の severity | `wcs/getter-untracked-read` は **warning** | `form` が常に丸ごと置換される設計なら壊れない（条件付きの欠陥）。error 三兄弟（nested-assign 等）は「常に壊れる」が基準（`nestedAssignValidator.ts` 冒頭）。warning なら `wcs-validate` の exit code 契約（`packages/lint/scripts/smoke-test.mjs`）にも触れない |
| **D7** | 配列ルート | `this.items[0].name` / `this.items.length` は**報告しない** | `items` の依存で足りる: 行の置換は `with()` / `toSpliced()` で `items` 自体が書き換わり、in-place 変異は `wcs/array-mutation`（error）が既に止めている。オブジェクトリテラル初期値のルートだけが「子パスへの書き込みで親が動かない」欠陥を持つ |
| **D8** | 証拠ゲート（実装時に追加） | `wcs/getter-untracked-read` は、そのルートへの**入れ子書き込みの証拠**がドキュメントにあるときだけ報告する。証拠＝`value:` / `checked:` / `radio:` / `checkbox:` バインド、spread `...: root`、組み込み wcs-* タグの出力プロパティへのバインド、スクリプトの `this["root.x"] = …`（複合代入・増減含む）/ `$setAll("root.…")` / 値付き `$resolve`、`<wcs-state mount="root">` | Phase 2 step 5 の初回実行で 7 件出た指摘が**全部**「ルートが丸ごと置換されるだけの形」（router-spa の `typedParams: routeParams` / `searchParams: query`・sse-dashboard の `$streams` fold 値 `metrics`）だった。getter は壊れておらず、router / stream を使う全員に出る系統的な偽陽性になる。「断定できるときだけ報告」の方針どおり証拠で絞る。証拠があっても別経路で丸ごと置換していれば壊れないので severity は warning のまま |

## 1. 収集規則（境界表 規則 1 の機械化）

`collectGetterReads(body: string): GetterRead[] | null` が返す 1 件は `{ path, form, start, end, chain }`。`null` はパース失敗。

| 本体の形 | 収集結果 | 備考 |
|---|---|---|
| `this.a` / `this?.a` | path `a` | 現行どおり |
| `this["a.b"]` / `this?.["a.b"]` / `` this[`a.b`] ``（式なし） | path `a.b` | テンプレートリテラルは式を含まない場合だけリテラル扱い |
| `this.$getAll("p", …)` / `this.$resolve("p", …)` | path `p` | 第 1 引数が文字列リテラルのときだけ |
| `this.$trackDependency("p")` | path `p` | **現行の正規表現は未対応**。明示登録なので依存に数える |
| `const { a, b } = this` / `const { a: x } = this` | path `a`, `b` | 1 段のみ。ネスト分割（`{ a: { b } }`）は `a` まで |
| `const self = this; self.a` | path `a` | 同一関数スコープ内の `const`/`let` エイリアス 1 段 |
| `this.form.name` / `this["form"].name` / `this["a.b"].c` | **chain** `form.name` / `a.b.c`（path は `form` / `a.b`） | 依存は root のみ。chain は `wcs/getter-untracked-read` の材料 |
| `this[key]` / `this.$getAll(path)`（非リテラル） | 収集しない | 断定できない（現行方針） |
| `this.$untrackDependency(fn)` の `fn` 内 | 収集しない | 意図的な追跡抑止 |
| 入れ子の `function` / クラス本体の中の `this` | 収集しない | `this` が別物。アロー関数は透過 |
| 代入・更新の左辺（`this.a.b = x` / `this.a.b++`） | 収集しない | 読みではない。`wcs/nested-assign` の担当（二重報告なし） |
| `this.$1` … / `this.$stateElement` / `this.$command.*` | 収集しない | `$` ルートは API 名前空間（`isApiRoot`） |

`form` の判定に使う「宣言側」は `analyzeStatePaths` の `PathCandidate`（`kind: 'data'` と `rawInitial`）。オブジェクトリテラルかどうかは `stateAnalyzer.ts` の `isObjectLiteral` をそのまま使う。

## 2. フェーズ

### Phase 0 — 基盤（`src/service/scriptAst.ts`）

1. `acorn@^8.18` を `packages/vscode-wcs` の `devDependencies` に追加（esbuild が inline する。`typescript` のように `dependencies` に置かない）。lock は npm 11 が無関係な dedupe（vitest 配下の esbuild 入れ子 27 件）を巻き込むので、acorn のエントリだけを手で差し込んだ。
2. `parseTopLevelProperties` の accessor 正規表現の `(?:get|set)` を捕捉にし、`PropertyInfo` と `CallableBody` に `accessor?: 'get' | 'set'` を足す。既存の消費者は `kind` しか見ていないので互換。
3. `scriptAst.ts` に §1 の `collectGetterReads` を実装する。ラッパー接頭辞の長さを引いて `bodyStart` 相対のオフセットに戻す。子走査は自前（`forEachChild`）で、関数境界を自分で切る（`FunctionExpression` / `FunctionDeclaration` / `ClassExpression` / `ClassDeclaration` で降りない、`ArrowFunctionExpression` は降りる）。
4. 単体テスト `__tests__/scriptAst.test.ts`（§1 の各行を 1 ケース以上・パース失敗で `null`・オフセットが原文と一致すること）。

受け入れ条件: 既存テスト全緑・`cli.cjs` のサイズ増を実測して本書 §5 に記録（見込み +100〜200KB）・`node dist/cli.cjs` が `typescript` を require しないこと（`grep -c "require(\"typescript\")" dist/cli.cjs` が 0）。

### Phase 1 — `wcs/getter-cycle` を AST 化

1. `validateGetterCycles` の `collectReadPaths` 呼び出しを `collectGetterReads` に置き換える。`accessor === 'set'` は辺の起点から外す（setter の読みは依存ではない）。`null`（パース失敗）の getter は辺なしとして扱う。
2. `collectReadPaths` と `READ_*` 正規表現を削除する。
3. 既存 30 ケース維持 + 追加: 分割代入経由の循環／エイリアス経由の循環／`$untrackDependency` 内の読みは辺にならない／入れ子 `function` 内の `this` は辺にならない／setter 経由は循環にならない／片方の getter が壊れていても他方の循環は報告される。

受け入れ条件: 診断 code・severity・文言は不変（追加のみ／公開後不変の規範）。`packages/lint` の smoke-test 緑。

### Phase 2 — 新診断 `wcs/getter-untracked-read`

1. `diagnostics.ts` に `GetterUntrackedRead: "wcs/getter-untracked-read"` を**意味論グループの末尾に追加**（コードは追加のみ）。
2. `messages.ts` に ja / en を追加。文言案（en）: `Reading this.form.name inside a getter tracks only "form" — the getter is not re-evaluated when "form.name" changes. Read this["form.name"] instead.`
3. `semanticValidator.ts` に `validateGetterUntrackedReads(script, scriptStart, locale)` を追加し `validateSemantics` から呼ぶ（`validateDocument` は変更不要）。報告条件は**すべて**満たすとき:
   - `accessor === 'get'` の本体で、§1 の chain を持つ読み取りである
   - root パスが `analyzeStatePaths` で `kind: 'data'` かつ `isObjectLiteral(rawInitial)` である（D7: 配列・JSON 由来・schema 由来・getter は対象外）
   - chain の全段が識別子または文字列リテラル（式添字を含む chain は黙る）
   - chain の最終段が呼び出しの callee なら 1 段落とし、残りが root だけなら黙る（`this.form.validate()` は報告しない・`this.form.name.trim()` は `form.name` を報告する）
   - 提案パスは `root + chainToDotted(chain)` の形で `this["form.name"]` を示す（`scriptPatterns.ts` の部品を再利用）
4. テスト（`semanticValidator.test.ts` に describe 追加）: 陽性 4（ドット／ブラケット root／optional chain／メソッド呼び出しの手前まで）・陰性 8（配列 root／未宣言 root／getter root／setter 内／`$untrackDependency` 内／入れ子 function／代入左辺／式添字）。
5. **リポジトリ全体に対する初回実行**: `node packages/vscode-wcs/dist/cli.cjs` を `examples/` と各パッケージの `examples/` に掛け、新規則の指摘を全件読む。偽陽性があれば規則を絞り、真陽性があれば例を直す（別コミット）。結果を本書 §5 に記録する。

### Phase 3 — 文書・追随・出荷

- `packages/vscode-wcs/README.md` の `<wcs-state>` script 診断表に 1 行追加（`README.ja.md` は診断表を持たない — 確認済み）。
- `packages/vscode-wcs/CHANGELOG.md` に `1.13.0` 節（getter-cycle の精度向上も 1 行）。
- `packages/state/README.md` / `README.ja.md` の境界表 規則 1 の行末に「lint / 拡張は `wcs/getter-untracked-read` でこれを検出する」を追記。
- `packages/lint/scripts/smoke-test.mjs` に新規則の warning ケースを 1 つ（exit code 不変の契約検査に同乗）。
- wcstack-skill リポジトリの references に診断コードを追記（リリース時・ユーザー操作）。
- 出荷: vscode-wcs `1.12.0 → 1.13.0`（Marketplace publish）・`@wcstack/lint` は次回 npm リリースに同乗（dist 再生成は release workflow）。

## 3. やらないこと（理由付き）

| 項目 | 理由 |
|---|---|
| 依存グラフの出力（`--format=json` への依存辺の同梱） | 設計書 §5-4 の換金面。本計画は診断 2 件に絞る。基盤（Phase 0）は再利用できる |
| `nested-assign` / `array-mutation` / `updated-callback-unbound` の AST 化 | D5。動いている正規表現を置き換える動機がない |
| スクリプト全体の AST 化・`stateAnalyzer` の宣言抽出の置き換え | 影響範囲が全診断に及ぶ。callable 本体だけを AST にすれば目的は達成できる |
| `this.a.b` 読み取りの runtime 側 dev-mode 警告 | runtime は素のプロパティアクセスと区別できない。静的にしか検出できない |
| 「getter が依存を取りこぼしていないか」の一般的検査 | D4。分岐由来の偽陽性を構造的に持つ |

## 4. 罠

- **`typescript` を validator core から import しない。** `cli.cjs` は `external` で `typescript` を落とすので、import した瞬間に `@wcstack/lint` が実行時に落ちる。CI の `wcs-validate` job は通っても npm 版が壊れる（#183 と同型の「正本と契約テストの場所のずれ」）。Phase 0 の受け入れ条件で機械検査する。
- **acorn は不完全な入力で throw する。** 編集中のスクリプトでは頻発する。D2 の本体単位パースと `null` 戻りで局所化する。`try/catch` を抜けた例外は言語サーバーの全診断を落とすので、`collectGetterReads` の外に例外を出さない。
- **オフセット。** ラッパー接頭辞（`(async function* () {\n`）の長さを引く。改行を入れておくと 1 行目のコメント（`// …`）がラッパーを飲み込まない。`sourceType: 'module'`（`import.meta` を受ける）・`ecmaVersion: 'latest'`。
- **`set` の畳み込み。** `analyzeStatePaths` は get/set ペアを 1 候補に畳んでいる。`accessor` を足しても `paths` 側の畳み込みは変えない（補完候補の重複を作らない）。
- **`packages/lint/dist/cli.cjs` は tracked。** ビルドで変わる。コミット前に `git checkout -- packages/lint/dist/cli.cjs`。
- **`examples/` に真陽性が出たら直す先は例のほう。** 規則を緩めてはいけない（境界表は規範）。
- **メッセージ文言は診断 code と同じく公開後の安定面ではない**が、`smoke-test.mjs` が文言を固定している箇所があるので既存の文言は動かさない。

## 5. 実測記録（実装時に埋める）

- `cli.cjs` サイズ: 254,476 B（着手前）→ **466,881 B**（acorn は非 minify で同梱。esbuild 設定は minify なしのまま）。`typescript` の require は 0 件（機械検査済み）。schema-core.cjs も同量増える（validator core を共有）
- `examples/` 初回実行（証拠ゲート前）: 7 件・2 ファイル。真陽性 0 / 「ルート丸ごと置換で動作している形」7（router-spa 2・state-sse-dashboard 5）→ D8 の証拠ゲートを追加して再実行 **0 件**。他の診断は不変（76 warning / 16 info）
- テスト: vscode-wcs 717（scriptAst 34・semanticValidator 62 — getter-cycle +8・untracked-read +22）・lint smoke 15
