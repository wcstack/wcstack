# Changelog

この拡張は npm パッケージ群（`@wcstack/*`）とは独立に版数を振る。1.11.0 より前の版数（0.1.0 / 1.10.0）は Marketplace に公開していない内部版で、その経緯は git 履歴にある。

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
