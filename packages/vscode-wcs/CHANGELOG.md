# Changelog

この拡張は npm パッケージ群（`@wcstack/*`）とは独立に版数を振る。1.11.0 より前の版数（0.1.0 / 1.10.0）は Marketplace に公開していない内部版で、その経緯は git 履歴にある。

## Unreleased

`@wcstack/state` 3.2（名前の正典化）に追随する。

### 検証

- **`wcs/name-alias`（新設、info）** — `@wcstack/state` 3.2 で正式名を改めた旧名に付く。フィルタ（`uc` → `upper` など）、依存 API（`this.$trackDependency(` → `$dependOn`）、宣言キー（`$streams` → `$stream`、`$updatedCallback` → `$renderedCallback`）が対象で、正式名を提案する。旧名は 3.x の間は動くので info（`--strict` でも落ちない）。
- **正式名を旧名と同じに解析する** — 旧名のフィルタは正式名の引数個数・型で検査する。`$dependOn` / `$untracked` は依存の読みの解析と `**` の拒否に、`$stream` は値プロパティの実体化・`this` の型・配線レンズに、`$renderedCallback` は updated-callback-unbound の検査に、それぞれ旧名と同じに入る。補完は正式名だけを出す。mustache のフィルタの報告範囲が `|` の後の空白から始まっていた癖も直した。

## 1.17.0 — 2026-09-22

`@wcstack/state` 3.1.0 の dist を同梱。3.1（明示のプロパティ形・ボリュームの注入口）に追随する。

### 検証

- **`wcs/on-prefixed-member`（新設、warning）** — 組み込みタグのメンバーのうち名前が `on` で始まるもの（`<wcs-timer>` などの入力 `once`）を先頭ドット無しで束縛した形。ランタイムはイベント束縛にして "ce" イベントを待ち、値は届かない。`.once:` と書くよう提案する（3.x 計画 D36）。
- **明示のプロパティ形 `.name:` を契約検査で照合する** — ドットを外した名前でメンバーを引く。未知の名前は `wcs/tag-member-unknown`、ドットの後の名前空間の語は正本パーサの `wcs/binding-syntax` に任せる。

## 1.16.0 — 2026-09-22

`@wcstack/state` 3.0.0 の dist を同梱。3.0 の文法の厳格化に追随する（1.15.0 の後の 2.5 / 2.6 の変更も、この版で初めて拡張に届く）。

### 型

- **プリアンブルに `$eq` / `$eqPath` / `$eqIndex`（`@wcstack/state` 2.6.0 の鍵付き選択）** — インラインスクリプトの `this.$eqPath(…)` が型エラーにならなくなった（1.15.0 は宣言より前の版）。

### 検証

- **`wcs/binding-syntax`（新設、error）** — ランタイムの正本パーサが `[wcs/binding-syntax]` で拒否する書き方を、同じ判定で報告する: フィルタ引数の閉じていない引用符／2 つ目の `#`（`value#ro#wo` — `value#ro,wo` と書く）／`else:` の後ろの値／`for`・`if`・`elseif`・`else`・`...` の左辺の修飾子やフィルタ／空のフィルタ（`x|`・`x||y`）。属性と mustache の両方。判定は `@wcstack/state/parser` に委ね、ここでは複製しない（`service/bindingSyntaxValidator.ts`）。

### 修正

- **式の区切りをランタイムと同じにした** — 位置付きパーサ（参照インデックス・配線レンズ）は `;` を無条件に区切っていたが、ランタイムは 3.0 から引用符の中の `;` を区切らない（`join(';')`）。正本が公開する `splitBindTexts` をそのまま使う。
- **`{{ count | }}` のような空のフィルタが参照インデックスの problems に載らなくなっていた** — `@wcstack/state` がフィルタ関数の解決を束縛計画の段へ移した（D16）ことで、空の名前がパースを通っていた。正本が空のフィルタを文法の誤りとして拒否するようになり、元に戻った（CI の wcs-validate の失敗の原因）。

## 1.15.0 — 2026-09-15

`@wcstack/state` 2.4.0 の dist を同梱。

### 検証

- **`$scan` 宣言の静的検証（新設）** — `@wcstack/state` の `$scan`（時間軸方向の累積・`docs/state-scan-design.md`）に追随する。code はランタイムと同じ語彙で 3 つ。

  - **`wcs/scan-declaration-invalid`**（error） — 出力名が平坦でない（`.` / `*` / `$` 始まり）・`Object.prototype` の継承名・getter / setter や `$streams` 名との衝突／エントリがオブジェクトでない／`from` と `on` が 0 本か 2 本／`initial` の欠落・`fold` の欠落や非関数リテラル／`on` が `$eventTokens` に無い／出力名が空・同名のメソッドと衝突／`from`・`on` が空でない文字列でない・`resetOn` に文字列でない要素／`from`・`resetOn` のパスの形（`$` 始まり・`@`・空セグメント・`Object.prototype` の継承名）／`from` が自分の出力を読む／`resetOn` の `*`・自分の `from` かその配下・scan 出力の読み／scan 同士が `from` の根を辿って循環する／`$scan` の値やエントリが配列リテラル／`from` が getter の無い setter（その配下を含む。`resetOn` の setter は引き金として通す）／ボリューム（`mount=`）の `$scan`（マウントされたコンポーネント（`bind-component`）の `$scan` は warning。どちらも中身は検証しない）
  - **`wcs/scan-source-computed`**（error） — `from`・`resetOn` が getter（その配下を含む）／`from` が `$recursion` の `**` getter の展開形（`nodes.*.total`・その値の内側）
  - **`wcs/scan-path-missing`**（warning） — `from`・`resetOn` のパスが状態定義に無い（`wcs/watch-path-missing` と同じ severity。`$recursion` の展開形は `$watch` と同じく宣言済みとみなす）

  `from`・`resetOn` の `**` はランタイムと同じく `wcs/recursion-unsupported`（error）で報告する。識別子参照・計算キー・spread で中身が読めないエントリと、配列リテラルでない `$eventTokens` では断定しない。stream との前進ループ（`wcs/scan-feedback-loop`）は getter が何を読むかという依存グラフが要るので runtime 専用。ワイルドカード段数の上限（128）は `$watch` と同じく静的には見ない。

- **`$scan` の出力を候補パスとして実体化** — `$streams` の値プロパティと同じ規則で、`initial` のリテラルから子パスも展開する（`for: feed.items` が `wcs/binding-path-missing` にならない）。明示宣言された同名プロパティが優先する。`$eventTokens` と同じ名前の出力と `$streams` の値も実体化する（トークン名はパスではないが、同名の候補とみなして子パスを展開せず、`for: message.items` に偽の `wcs/binding-path-missing` を出していた。`$streams` の値にも以前からあった穴）

- **プリアンブル** — `defineState` の宣言に `$scan?:` を追加（`fold` の引数に文脈型を与える）。`fold` は `this: void` で型付けする（ランタイムは `this` 無しで呼ぶので、メソッド形の `fold` で `this` を読むと型エラーになる）。getter やメソッドの `this` から `$scan` の出力と `$streams` の値を読めるようにした（型は `any`。`$streams` の値を `this` から読むと型エラーになっていた既存の穴も同時に塞ぐ。同名のプロパティを明示的に事前宣言していれば、その型を保つ）

- **`bind-component` の判定を属性名で行う** — `$scan` と `$recursion` の検証が、`<wcs-state>` の開始タグ全体に対する正規表現で `bind-component` を探していたため、属性値の中の文字列（`data-note="no bind-component here"`）でもルートの state をマウント扱いにし、warning を出して中身の検証を飛ばしていた。開始タグの属性を先頭から読んだ属性名で判定する

## 1.14.0 — 2026-09-12

`@wcstack/state` 2.3.0 の dist を同梱。

### 検証

- **`$recursion` 宣言と `**` の静的検証（新設）** — ランタイムと同じ code 語彙で、パス文字列と宣言だけで決まるものを先に出す。データを見ないと決まらない共有配列・循環・深さ超過（`wcs/recursion-shared-list` / `-cycle` / `-depth-exceeded`）と、評価時の呼び出し文脈で決まる `wcs/recursion-context` は runtime 専用で、静的側は出さない。code ごとの最終的な判定範囲は次のとおり。

  - **`wcs/recursion-declaration-invalid`**（error） — `$recursion` の値がオブジェクトでない（関数・配列リテラルを含む）／アンカーが 1 本でない／アンカー・反復サブパスの形が不正（`.*` で終わらない・空セグメント・途中の `*`・`**`・`$` 始まり・`#` セグメント・**途中の添字セグメント**）／反復サブパスが文字列でないと断定できる（数値・真偽値・null・配列・オブジェクト・関数）。`**` を含むキーの宣言も同じ code —— setter・getter でない・ノード自身を名指す `get "nodes.**"`・接尾辞が構造そのもの（`get "nodes.**.children"()` / `.children.*` / `.children.length` / 多段なら `.branch`。添字綴り `nodes.**.children.0` も畳んでから見る）・同じ具体パス族へ展開する 2 本の getter・`**` getter の展開形と同名の具体 getter / データプロパティ（`get "nodes.*.children.*.total"()`）。ボリューム（`mount=`）の `$recursion` / `**` getter も同 code の error（ランタイムは接ぎ木前に throw）、マウントされたコンポーネント（`bind-component`）のそれは同 code の warning（ランタイムは `wcs/mount-dollar-declaration` で警告して捨てる）
  - **`wcs/recursion-unsupported`**（error） — `**` を解釈しない消費者に `**` が渡った: `data-wcs` / mustache / `$watch` のキー / `$listKeys` のキー / `$resolve` / `$postUpdate` / `$trackDependency` / 代入（複合代入・`++` / `--` 含む）。宣言が無いのに `**` を使った場合も同じ（ただし `**` getter のキーだけは warning — ランタイムは宣言の無い `**` getter を黙って無視するので落ちない）。代入の走査は文字列・テンプレートリテラルの中身を見ない
  - **`wcs/recursion-anchor`**（error） — 宣言と合わない `**`（綴り違い・2 つ目の `**`）と、`**` の後ろが整形されていない形（空セグメント `nodes.**.` / `nodes.**..x`、`**` 直後の素の `*` `nodes.**.*`）。getter キーと `$getAll` / `$setAll` のパス引数の両方で見る（ランタイムの `splitRecursivePath` と同じ判定）
  - **`wcs/recursion-getall-form`** / **`wcs/recursion-setall-form`**（error） — `**` に対して定義できない添字・値の形。`$getAll` は非空の接頭辞と配列でないリテラルの添字（`undefined` は束縛形なので黙る）、`$setAll` は非空の接頭辞・添字省略・mapper・`{ spread: true }`
  - **`wcs/recursion-structural-write`**（error） — 再帰 `$setAll` がノード自身・子リスト・子ノード・子リストの `length`・多段の反復サブパスなら子リストへ至る途中のオブジェクトを名指す。接尾辞は添字を畳んでから見るので、`nodes.**.children.0` は子ノード、`nodes.**.children.0.children` と `nodes.**.children.length` はリスト（とその length）として報告する
  - **`wcs/recursion-readonly`**（error） — 再帰 getter とその展開形（添字綴り `nodes.1.total` / `nodes.*.children.0.total` を含む）、およびその値の内側への書き込み: `$setAll` / 値付き `$resolve` / `this["…"] = …`（複合代入・`++` / `--` 含む）。反復語ぶんずれた形（`nodes.**.children.*.total.x` と `get "nodes.**.total"()`）も接尾辞の `.` 境界ごとに族を照合して報告する（ランタイムも列挙より前に同じ判定で落とす）

- **パスの存在検査が `$recursion` の展開形を認める** — `nodes.*.children.*.children.*.total` のような具体パスは、反復語を剥がして深さ 0 の形へ畳んでから候補集合に当てる（ランタイムの `checkDeclaredPath` と同じ規則）。接尾辞に反復語を含む `**` getter（`get "nodes.**.children.*.total"()`）の展開形も、オブジェクトを返す `**` getter の値の内側（`nodes.*.stats.count`）も存在扱いで、`**` getter の下は「評価しないと分からない」として黙る。宣言だけから確定する構造パス（`nodes` / `nodes.*.children` / …）も候補になる。`**` を含む getter のキーは候補に載るが補完には出さない

- **既存 code の境界** — `wcs/index-arity` は `**` を含むパスを判定しない（固定本数の `*` ではないため。形の判定は上の 2 code が担う）。`wcs/getter-cycle` は再帰 getter を「文字列上の自己参照」という理由では循環扱いしない —— 深さが進む読み（`nodes.**.total` の中の `nodes.**.children.*.total`）は辺にならず、深さ差 0 の辺だけが循環になる

- **宣言を静的に読めない形では断定しない** — 識別子参照（`$recursion: REC` / `{ "nodes.*": REPEAT }`）・spread（`{ ...REC }` / `export default { ...tree, … }`）・計算キー（`{ ["nodes.*"]: … }`）・class 構文・`${}` 付きテンプレートのときは、宣言も `**` の使い方も報告しない（ランタイムは正当に動く）。「未宣言」と報告するのは `export default { … }` のオブジェクトリテラルが読めて、トップレベルに spread が無く、そこに `$recursion` が無いときだけ。`${}` の無いテンプレートリテラルは綴りが確定するので、宣言の値でも API のパス引数でも文字列として読む

- **`${}` の無いテンプレートリテラルを API のパス引数として読む** — `` $getAll(`items.*.price`, [0]) `` のようなバッククォート綴りのパスは、これまで `wcs/index-arity` ほかの判定対象外だった（宣言の値側だけが受理していた）。綴りが確定するので文字列リテラルと同じに扱う（`${}` 付きは従来どおり黙る）

- **preamble** — `$recursion?: Record<string, string>` と、`**` を含むキーの読みを許す索引シグネチャ（`@wcstack/state` の `defineState` が公開する型面と同じ形）

## 1.13.0 — 2026-09-08

`@wcstack/state` 2.2.0 の dist を同梱。

### 検証

- **`wcs/getter-untracked-read`（warning・新設）** — getter の中の `this.form.name` を報告する。追跡されるのは `form` だけなので、`form.name` が書き換わってもその getter は再評価されない（`@wcstack/state` README「依存追跡の境界」規則 1。症状は「値が更新されない・エラーは出ない」で、ランタイムは素のプロパティアクセスと区別できない）。提案は `this["form.name"]`。報告するのは、ルートがオブジェクトリテラル初期値の宣言済みパスで、かつドキュメントのどこかに `form.name` への**入れ子書き込みの証拠**（`value:` / `checked:` / `radio:` / `checkbox:` バインド、spread、組み込み wcs-* タグの出力プロパティ、スクリプトの `this["form.name"] = …` / `$setAll` / 値付き `$resolve`、`mount=` ボリューム）があるときだけ。router の `typedParams: params` や `$streams` の fold のようにルートが丸ごと置換されるだけの設計では黙る。配列ルート（`this.items[0].name`）は `items` の依存で足りるので対象外。`this.form.validate()` のようなルートのメソッド呼び出し、setter・メソッド・`$watch` ハンドラの中、`$untrackDependency` の中、入れ子 `function` の中、代入の左辺（`wcs/nested-assign` の担当）も報告しない
- **`wcs/getter-cycle` の読み取り収集を正規表現から AST（acorn）に置き換えた。** 分割代入（`const { b } = this`）・`this` エイリアス（`const self = this`）・`$trackDependency("b")` 経由の循環を検出するようになり、`$untrackDependency` の中・入れ子 `function` の `this`・単純代入の左辺・setter の中の読みは辺にしなくなった（ランタイムが依存に登録しない読み）。複合代入・増減（`++this.a`）は get → set の順に動くので読みとして辺になる。エイリアスは関数スコープ単位で解き（引数や再代入が影にする・クロージャ越しの通常 `function` でも生きる）、曖昧なら辺にしない。get/set ペアは get 側の名前にだけ報告する。診断コード・severity・文言は不変
- getter 本体は 1 本ずつパースするので、編集中に壊れている getter があっても他の getter の診断は出続ける。パースできない本体は「断定できない」として黙る（構文エラー自体は TypeScript 側が報告する）

### 内部

- validator core に acorn を同梱（esbuild で inline。`typescript` は `@wcstack/lint` の `cli.cjs` に同梱できないため — 依存ゼロの単一ファイル契約）。`cli.cjs` は 254 KB → 467 KB。runtime dependencies は不変

## 1.12.0 — 2026-09-06

`@wcstack/state` 2.1.1 の dist を同梱。

### 補完・検証

- 初期値が `[]` のリストの**行の形**を、行を足す / 置き換える代入式の行リテラルから読むようになった（[#239](https://github.com/wcstack/wcstack/issues/239)）。`this.items = this.items.concat({ id, kind: "general" })` / `.toSpliced(i, n, { … })` / `.with(i, { … })` / `[...this.items, { … }]` の行リテラルにあるフィールドが `items.*.<field>` の候補になり、`for` 行内の `.kind` が `wcs/binding-path-missing` にならない。対象は既に配列と分かっているパスだけで、明示的な初期値・`$listKeys` の候補は上書きしない。変数で渡した行（`concat(row)`）は読めないので、その場合は従来どおり `stateSchema` を使う。

## 1.11.0 — Initial Marketplace release

`@wcstack/state` **v2** 対応の初公開版。以下は本版に含まれる機能の全量。見出しと診断コードの並びは README と同じ順（README とこの節を突き合わせれば差分が見える）。

### インラインスクリプトの型サポート

- `<wcs-state>` 内 `<script type="module">` を `defineState()` で包み、`this` にドットパス型（`this["users.*.age"]` → `number`）を与える。import 不要
- preamble はランタイム API を型で持つ: `$getAll(path, indexes?)` / `$setAll` / `$resolve`、`$command.<name>`、`$streamStatus.<name>` / `$streamError.<name>`、`$watch` ハンドラと `$listKeys` キー関数の文脈型（`noImplicitAny` 下で偽エラーにならない）
- `wcs-tsc` モード（`@wcstack/typescript` が同梱）— Language Plugin を `LanguagePlugin<URI | string>` に一般化し、全 `<wcs-state>` ブロックを 1 本の仮想 TS に合成してプロジェクト単位で型検査する。`stripWcsImport` は CDN URL 指定（`https://esm.run/@wcstack/state`・jsDelivr の `@version/+esm`）も剥がす

### 補完

- プロパティ名（`textContent` / `class.` / `style.` / `attr.` / イベント / `for` / `if` / `...` / `radio` / `checkbox` / `command.` / `eventToken.`）、state パス、修飾子（`#` の後に `prevent` / `stop` / `ro`）、フィルタ 46 種、prop 側 input フィルタ（`value|int`）
- 文脈絞り込み: `for:` は配列パスのみ、`onclick:` はメソッドと `$command.<name>`、`command.<method>:` は `$command.<name>` のみ、`eventToken.<prop>:` は `$eventTokens` の宣言名のみ
- `<template for>` 内の省略パス（`.name`）を生成。外では省略パス・パターンパスを候補から除外
- パス候補の導出: 入れ子配列への再帰（`a.*.b.*.c`）、`$streams` エントリの値化＋`$streamStatus.*` / `$streamError.*`、`$listKeys` 宣言による空配列リストの実体化（`<listPath>` / `.*` / `.length` / 文字列キーなら `.*.<field>`）
- mustache `{{ }}` / コメントバインド `<!--@@:-->` でも同じ補完。text チャネルはランタイムと同じ `parseBindTextForEmbeddedNode` 経路（`;` 無分割）
- `wcs.html-data.json`（HTML custom data）を同梱 — 全 `wcs-*` タグ名・属性の補完と、契約（bindable / input / `command.*`）の hover。`<wcs-state>` の無い HTML でも動く。他エディタは `html.customData` から同ファイルを参照できる。生成は `npm run emit:builtin-tags`、鮮度は CI ゲート

### hover / 定義へ移動 / 参照の検索 / インレイヒント

- 位置情報付き参照インデックス（`core/index/referenceIndex`）への 4 つのクエリ（`core/navigation/wiringLens` + `wcs-navigation` Volar プラグイン）
- hover: 種別・推定型・所属 state・宣言行。`for` 省略パスは展開後。フィルタはシグネチャと型変換、修飾子は意味説明。解決不能なパスには出さない（`src` 外部 state だけ「外部定義」と明示）
- 定義へ移動: 第 1 セグメントへフォールバック。`$command.<name>` → `$commandTokens`、`$streamStatus.*` / `$streamError.*` → `$streams`、event-token → `$eventTokens`、`src` 外部 state → `<wcs-state src>` タグ
- 参照の検索: 双方向。省略形は展開後パスで統合。`$1`〜`$9` は for テンプレート単位でスコープ
- インレイ: 省略パスの展開後、フィルタ鎖の結果型、spread の展開規模（組み込み `wcs-*` のみ）
- hover の言語は `wcstack.messageLanguage` に従う

### 診断（コード付き・IDE と CLI で同一の code / range・メッセージは ja / en）

severity の方針: error = ランタイムが raise するか配線が成立しない、warning = 動くが黙って間違う、info = 助言。

- バインディング式: `wcs/binding-path-missing`（warning）・`wcs/path-nonexistent`（error・stateSchema 宣言時）・`wcs/path-type-mismatch`（error）・`wcs/binding-type-expectation`（`for:` 非配列は error、`if:` / `class.` 非 boolean と `attr.` / `style.` 非 string は warning）・`wcs/filter-unknown`（warning）・`wcs/filter-arity`（error）・`wcs/filter-arg-type`（warning）・`wcs/filter-input-type`（warning）・`wcs/token-undeclared`（warning）・`wcs/token-misconfigured`（warning）・`wcs/template-syntax`（構造ディレクティブの併記と spread のフィルタ/ターゲット違反は error、`<template for>` 外のパターン/省略パスと数値解決パスとイベントハンドラへのフィルタは warning、`{{ }}` の FOUC と `<!--@@:-->` 可視化は info）・`wcs/wildcard-rank`（warning）・`wcs/index-arity`（warning）・`wcs/aria-attr-unknown`（warning・WAI-ARIA 1.2 全項目＋1.3 先行分・編集距離 2 の候補提示）
- 組み込み `wcs-*` タグ契約: `wcs/tag-member-unknown`（warning）・`wcs/spread-no-bindable`（error）・`wcs/trigger-seeded-truthy`（warning）・`wcs/storage-seed-clobber`（warning）
- `<wcs-state>` スクリプト: `wcs/nested-assign`（**error**・`+=` / `++` / 式添字チェーンも検出・識別子添字は `a.<i>.b` で提示）・`wcs/array-mutation`（**error**・破壊的メソッド 9 種・非破壊代替を提示）・`wcs/array-index-assign`（**error**・複合代入 15 種・`++` `--`・bracket ルート形・式添字・`this["items.0"]` と `with()` を提示。ドットアクセス混在チェーンは `nested-assign` の担当で二重報告なし）・`wcs/getter-cycle`（warning）・`wcs/updated-callback-unbound`（warning）・`wcs/watch-declaration-invalid`（error）・`wcs/watch-path-missing`（warning・候補ゼロのスクリプトでは照合しない）・`wcs/type-annotation`（warning・JSDoc `@type` と初期値の整合、union 対応）
- ページ設定: `wcs/script-order`（warning）・`wcs/base-href-missing`（warning）・`wcs/signals-dual-entry`（error）
- v2 移行: `wcs/named-state-deprecated`（**error** — 名前付き State `<wcs-state name>` / `path@name` / `{{ path@name }}` は v2 で撤去。`<wcs-state mount="x">` と接頭辞付きパス `x.path` を案内）・`wcs/mount-path-invalid`（error — runtime の `validateVolumeMountPath` と同条件・同文言）
- sidecar: `wcs/manifest-*` 12 種と `wcs/drift-*` 2 種（`manifest-namespace-version` は warning、`manifest-override` は info、他は error）。`wcs/manifest-state-collision` は同名 state の `stateSchema` が複数 application manifest に宣言された場合（勝者なし）
- 予約のみ（未発行）: `wcs/path-readonly` / `wcs/path-reserved-name` / `wcs/path-dynamic-unknown`

解析の堅牢性（偽陽性を消すために入っているもの）: コメント・文字列・テンプレートリテラルの中身を潰した鏡像に対する走査、getter / setter 本体のスキップと `set "ws.message"(v)` 形式の認識、引用符付きメソッド短縮記法 `"items.*.price"(cur, prev, i) {}` の認識、`<script type>` の ASCII case-insensitive 判定、入れ子 `<template>` の深度カウント、単独省略パス `.` の `<forPath>.*` 展開、トップレベル `$` 予約キーの候補除外、言語サーバー常駐時のパーサキャッシュ解放

### sidecar manifest / `stateSchema` / CLI

- `wcstack.manifest.json` を JSON-Schema サブセットで検査（envelope / `kind` / 越境参照 / 同名衝突 / override 後勝ち禁止 / live `wcBindable` との drift）。sidecar は tooling-only でランタイムに影響しない
- application manifest の `stateSchema` を消費: HTML から最も近い `wcstack.manifest.json` を自動発見（1 つ・合成なし）。宣言された state の未存在パスは error に昇格。存在判定は `resolveSchemaPath` の三値（素の `{}` の下は沈黙）、script 由来のメソッド / getter / `$listKeys` は schema に無くても存在扱い
- `wcs-validate` CLI（`@wcstack/lint` として npm 配布・同一バンドル）: `--attr=` / `--state-tag=` / `--lang=ja|en` / `--errors-only`（別名 `--quiet`）/ `--strict`（warning でも exit 1。severity は不変）。exit code は `0` / `1`（error、`--strict` なら warning も）/ `2`（usage・読み取り失敗）。`*.manifest.json` 引数は sidecar として検査
- IDE / CLI の非対称は 1 点のみ: `<wcs-state src>` の外部 state は CLI だけが解決する

### 設定

- `wcstack.bindAttributeName`（既定 `data-wcs`）・`wcstack.stateTagName`（既定 `wcs-state`）・`wcstack.messageLanguage`（`auto` / `ja` / `en`。診断と hover の言語。code / range は不変）

### パッケージング

- VS Code `^1.110.0`
- Marketplace メタデータ: `icon.png`（`assets/logo/wcstack-icon-black-512.png` の複製）と `galleryBanner`、`bugs.url` / `qna`（拡張専用 Issue Form `.github/ISSUE_TEMPLATE/vscode-wcs.yml` へ直リンク・ラベル `@wcstack/vscode-wcs` 自動付与）、`homepage` / `repository.directory`
- `vsce package` に `--baseContentUrl` / `--baseImagesUrl` を渡す（vsce は `repository.directory` を読まず、README の相対リンクをリポジトリルートへ書き換えるため）
