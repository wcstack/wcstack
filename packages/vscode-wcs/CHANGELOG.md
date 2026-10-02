# Changelog

この拡張は npm パッケージ群（`@wcstack/*`）とは独立に版数を振る。1.11.0 より前の版数（0.1.0 / 1.10.0）は Marketplace に公開していない内部版で、その経緯は git 履歴にある。

## Unreleased

`@wcstack/state` 4.0 で外れる・読み方が変わる書き方を、3.x のうちに知らせる（2.6 の `wcs/v3-migration` と同じ運用）。3.x では動く形は **`wcs/v4-migration`（info）** — 既定の CLI でも `--strict` でも CI を落とさない。3.x でも既に正しく動かない形（4.0 は初期化で拒む）は、その形の code の **warning**。error は 1 件も足さない。

### 4.0 への準備（`wcs/v4-migration`、新設、info）

文面は「4.0 への準備（3.x ではこのまま動きます）」（en: "Preparing for 4.0 (this still runs on 3.x)"）で始まり、3.x のままで書ける書き換え先を言う。

- **root の state の `$scan`** — 4.0 は読み込み時に throw する。パスの変化は `$watch`、イベントは `$on` のハンドラで畳むよう案内する。値が `undefined` のリテラルは宣言なし扱い。ボリューム・マウントしたコンポーネントの `$scan` は 3.x でも動かず既存の `wcs/scan-declaration-invalid` が報告するので重ねない。宣言の形の検査（3.x の事実）とは別の関数（`validateScanV4Migration`）で、`$scan` の綴りが無い文書は `<wcs-state>` を読まない。
- **フィルタ `substr`**（`data-wcs`・入力フィルタ・`{{ }}`・`<!--@@:-->`） — `slice(start, start + length)` を案内し、引数が 0 以上の整数リテラルなら具体形も示す（`substr(2, 3)` → `slice(2, 5)`）。負の数・引用符付き・識別子の引数は一般形だけ（負の数は文字列の長さで `slice` の結果が変わるので、具体形にすると意味が変わる）。
- **4.0 が root へ委譲するイベントのハンドラが読む `event.currentTarget`** — `click`・`dblclick`・`input`・`change`・`submit`・`keydown`・`keyup`・`mousedown`・`mouseup`・`pointerdown`・`pointerup`（state-next の `BUBBLING` の写し）の `on*:` で、`#direct` が無く、ハンドラが root の state のメソッドで、第 1 引数の `currentTarget` を読む（`e.currentTarget`・`e["currentTarget"]`・`const { currentTarget } = e`・引数の分割代入）とき。4.0 ではそこが要素ではなく root になる。書き換え先は書かれた修飾子に `direct` を足した左辺（`onclick#prevent:` → `onclick#prevent,direct:`）か `event.target.closest(...)`。最初に中断する `await` の**被演算子の中**の読みは中断の前なので拾う（`await fetch(url, { body: new FormData(e.currentTarget) })` — よくある async の submit）。router の route の `<template>` の中の束縛も文書の root の state の束縛として扱う。誤報を避けて黙る形: 中断した後・入れ子の関数の中の読み（3.x でも dispatch 後は null）、引数の名前の束縛し直し、カスタム要素の `input` / `change` / `submit`（コンポーネントが bubbles しない dispatch をすると 4.0 は要素で聞く — ネイティブの bubbling はカスタム要素でも 4.0 は root で聞くので `click` などは出す）、自前の `<wcs-state>` を持つ `<template>`（宣言的 shadow root・DCC）の中の束縛と、その `<wcs-state>` のメソッド、ボリュームのメソッド・データプロパティに置いた関数・外部ファイルの state。判定は acorn（`scriptAst.ts` の `readsEventCurrentTarget`）で、`currentTarget` の綴りがあるメソッドだけを解析する。

### 3.x でも既に壊れている形（warning）

3.x の実行時の挙動を確かめたうえで、4.0 の予告ではなく 3.x の不具合として、その形の code の warning にした。

- **for / if / elseif / else テンプレートの中の `outerHTML:` / `outerText:`（`wcs/template-syntax`）** — 3.x は描けるが、行や枝は元のノードを持ち続けるので、行が外れる・リストが置き換わる・枝が閉じると、置き換えた中身がページに取り残される（実測）。4.0 は初期化で拒む（#203）。明示のプロパティ形 `.outerHTML:` も対象、`class.outerHTML:` は対象外。別の `<template>` の中に入れ子にした構造でない `<template>`（行や枝の中の template、route の中に置いたアプリの雛形 `<template id="row-tpl">` など — 中身が差し込まれても入れ子の template は inert のまま）の中、中身を置き換える束縛（`textContent:` / `innerHTML:` など）を持つ要素の子孫、raw text 要素（`<noscript>` / `<iframe>` を含む）の中は束縛として読まれないので報告しない。文書の直下の `<template>`（router の route そのもの）は差し込まれた先で束縛されるので、その中の for / if も対象。自前の `<wcs-state>` を持つ `<template>`（宣言的 shadow root・DCC）の中は検査しない — `<wcs-state>` の持ち主は最も内側の構造でない template で、for / if の枝を越えて上へは探さない（route の中の `if:` の枝に置いた `<wcs-state>` で route 全体が黙らないように）。終了タグの省略（`<li>…<li>`・`<p>…<div>`・表）は HTML のパーサに合わせて閉じる。
- **行の中の別のリストの `*`（`wcs/wildcard-rank`）** — `for: a` の行の中の `b.*.y`。3.x はループ文脈とパスのワイルドカードの接頭辞の共通部分だけ添字を渡すので、添字が null のまま解決に進み、囲む `for` ごと描けない（`Cannot resolve state address for binding with wildcard statePathName "b.*.y" because list index is null.`、実測）。囲む for の一覧と段ごとに比べる（相対 `for:`・絶対 `for:`・`for:` の右辺・mustache / コメント束縛も）。4.0 は #1403 で拒む。
- **ループの添字の表の外の `$` ＋数字** — マークアップの `$0` / `$01` / `$129` / `$1000` は、ランタイムの表（`$1`〜`$128`）に無いので状態のパスとして読まれ、`[wcs/binding-path-missing]` で束縛（for の中では囲む for ごと）が失敗する（実測）。同じ code（`wcs/binding-path-missing`、warning）で報告する。黙るのは、文書の root の state（`<template>` の外）がそのキーを宣言していると**確かめられた**ときだけ（宣言していれば 3.x はそのキーを読む）。宣言は `state=` / `json=`・`src=`（CLI と IDE が `fileReader` で読めたとき — `.js` は同名の `.ts` を先に読む）・中のスクリプトのトップレベルから集める。読めない `src=`・宣言の無い class 構文・状態の候補が 1 つも無い文書でも報告する（これまでの「for の外のループ添字」「129 段のループが要る」も候補によらず出ていた）。宣言的 shadow root の `<wcs-state>` のキーは数えない。これまで for の中の `$129` は「129 段のループが要る」（`wcs/wildcard-rank`）、for の外の `$0` は「for の外のループ添字」（`wcs/template-syntax`）と言っていたのを改めた。スクリプトの `this.$0` / `this.$129` / `this["$01"]`（getter・メソッド・`$watch` のハンドラ）は、ランタイムが読んだ時点で `[wcs/index-param-range]` を投げるので、**`wcs/index-param-range`（新設、warning）**。読みだけ — 単純代入・分割代入の左辺（`this.$0 = v`）は set トラップしか通らず投げないので報告しない（複合代入 `+=` は先に読むので報告する）。AST で読めた state だけ（class 構文は黙る）。旧名の宣言キーの読み（`wcs/declaration-alias-read`）と同じ 1 回の AST 走査で集める。
- **同じ root の 2 つ目の `<wcs-state>`（`wcs/second-root`、新設、warning）** — `mount` も `bind-component` も `name` も無い（`name=` の要素は登録の前に初期化で失敗するので root を占めない）`<wcs-state>` が文書（`<template>`・コメント・`<script>` / `<style>` / `<textarea>` / `<title>` などの中身の外）に 2 つ以上。ランタイムは後から登録しに来た方を拒む（"A state tree is already registered on this root"）。v2 からの規則で 3.x の lint は報告していなかった。router の route（`<wcs-router><template>` の中）・宣言的 shadow root・JS の `innerHTML` の文字列は数えない。`<wcs-state` の開始タグが 2 つ以上ある文書だけを 1 回走査する。

### そのほか

- **`wcs/name-alias` の文面** — 「4.0 で外れる」（en: "goes in 4.0"）を「4.0 で削除される」（en: "is removed in 4.0"）に。フィルタの旧名の hover、`wcs/declaration-alias-read` の class 構文向けの文面も同じ。
- **修飾子 `#direct`** — 補完の候補と hover に足した（4.0 で効く・3.x はもともと要素にリスナーを付けるので変わらない、と説明する）。3.x のランタイムは知らない修飾子を無視し（`event/handler.ts` は `prevent` / `stop` だけを見る）、正本パーサも受け付けるので、`onclick#direct:` に診断は出ない（テストで固定）。
- **`for: items;`（末尾の `;`）** — for の右辺は引用符の外の最初の `;` までを読む（`forContext.ts` の `getEnclosingFors`）。`items;` を for のリストのパスとして合成すると、行の `items.*.name` を別のリストの `*` と取り違えていた（今回の検査）。同じ原因で以前から出ていた、行の省略パス（`.name` → `items;.*.name`）の偽の `wcs/binding-path-missing` も消えた。
- **preamble** — 旧名 API（`$trackDependency` / `$untrackDependency`）の `@deprecated` も「4.0 で削除される / removed in 4.0」に揃えた。
- **文書走査のコストを足さない** — 要素の置かれた文脈（行・枝の中か・自前の state を持つ template の中か）は、候補（`outerHTML:` / `outerText:` と委譲されるイベントの束縛）を集めてからループの後で 1 回だけ走査する（`forContext.ts` の `analyzeElementContexts`。template が自前の `<wcs-state>` を持つかは offset より後ろで分かることがあるので、文書の終わりまで 1 回走査してから決める）。`asciiLowerCase`・raw text 要素の表・template の判定（`createTemplateTester`）は `language/htmlParse.ts` に 1 つだけ置いた。別のリストの `*` の判定は、段数の検査がもともと束縛ごとに引いていた囲む for のリスト（`getAvailableWildcardRank` を `getResolvedForListPath` ＋ `rankOfForList` に分けた）をそのまま使う — 呼び出しの回数は変わらない。スクリプトの `this.$129` は旧名の読みと同じ 1 回の AST 走査で集める。
- 予告しないもの: `<textarea>` / `<title>` の中のコメント束縛は、ブラウザのパーサが文字にするので 3.x でも 4.0 でも束縛されない（4.0 でも変わらない — mustache は両方とも束縛する）。`$behavior` / `$features` には触れていない。
- リポジトリの examples / packages の HTML（`wcs-validate` を全件に）: 0 error / 102 warning / 27 info → 0 error / 102 warning / 29 info。増えたのは `wcs/v4-migration` の 2 件だけ（`examples/state-intersect-scroll` の `$scan`、`examples/state-tilt-maze` の `onpointerdown: dragStart` — `dragStart` が `e.currentTarget.setPointerCapture` / `getBoundingClientRect` を読む。4.0 ではそのまま壊れる）。

## 1.20.0 — 2026-10-02

`@wcstack/state` 3.4.0 の dist を同梱。3.4.0 から実行時が数値添字が 1 つのパスの束縛（`items.0.v`）をその位置の行として読むので、診断もその読み方に揃える。

### 修正

- **数値添字のパスの束縛（`textContent: items.0.v`・`{{ items.1.v }}`・行 getter の `items.0.double`）の診断を、`@wcstack/state` の実行時の読み方に揃えた**（#355）。`@wcstack/state` は #332（3.4.0）から、数値添字が 1 つのパスを「いまその位置にある行」として読み、書き込みに追従し、行 getter も読む（実行時の警告も出ない）。拡張は存在判定が候補集合との完全一致で（`items.0.double` は行 getter `items.*.double` に当たらない）、`wcs/template-syntax` は数値のセグメントがあれば一律に「解決済みパスは UI バインディングでは使用できません」と言っていたので、束縛 1 つに warning が 2 件出ていた（Issue のページで 10 件 → いまは `groups.0.items.0.v` の `wcs/template-syntax` 1 件だけ）。判定は `service/indexPath.ts` に置き、実行時の `isIndexPath`（`address/indexPathAccessor.ts`）と `resolvePathExistence`（`diagnostics/pathChecks.ts`）に合わせた。
  - **数値添字が 1 つのパス**（`*` を持たず、先頭が数値でなく、親がリスト）は、添字を `*` に読み替えて照合する: `items.01.v` / `items.1e0.v` も行 1、オブジェクトの数値キー（`sales.2024.total`）は素のキーのまま、`items.-1.v` と `items.0.nope` は従来どおり `wcs/binding-path-missing`。拡張できない state（`Object.freeze` など）では実行時は素のパスになるが、静的には見ない。型の検査（`class.` / `for:` の型・フィルタの入力型）も読み替えた形の型で行う — `class.on: items.0.name`（文字列。実行時は `binding "prop: items.0.name" failed to apply`）・`textContent: items.0.tags|upper`・`for: items.0.name` に、パターンパス（`items.*.name` など）と同じ診断が出る。
  - **添字が 2 つ以上のパス・`*` と混ざるパス**（`groups.0.items.0.v`・`for` の行の `.tags.0`）は実行時も素のパスで、添字を通した書き込みが届かないので `wcs/template-syntax` を残し、文面をそのとおりに改めた。存在は実行時と同じく配列の上の添字（`"0"` のような配列のキーの綴りだけ）を要素として辿り、要素の形（`*`）のデータの候補と照合するので、`groups.0.items.0.v`・`.tags.0` の偽の `wcs/binding-path-missing` は消えた。素のパスは行を持たないので、行 getter をこの形で読むと実行時は空で描く — `wcs/binding-path-missing` のまま（`groups.01.items.0.v` も同じ）。要素の個数は静的に見ないので、その位置に要素があるものとして扱う。
  - **`for:` の対象が数値の添字を持つリスト**（`for: groups.0.items`・`for: items.0.tags`）には、添字が 1 つでも `wcs/template-syntax`（warning）を出す。実行時は初期表示とリストの置き換えには追従するが、行が `groups.0.items.*.…` として解決され、行への双方向束縛（`value: .v`）は `Partial wildcard type is not supported yet`、添字のパスへの書き込み（`this["groups.0.items.0.v"] = 5`）は `[wcs/wildcard-rank]` で投げる（`@wcstack/state` #363）。文面は `for: groups` の中に `for: .items` を入れ子にする形を勧める。行の中の省略パス（`.v` → `groups.0.items.*.v`）は上の素のパスとして存在するので、警告は `for:` の 1 か所に出る。
  - **`stateSchema` を宣言したページ**では、schema の解決も読み替えた形で行う。行の下の打ち間違い（`items.0.nmae`）、素のパスの打ち間違い（`groups.0.items.0.nmae`、`for: groups.0.items` の中の `.nmae`、`$ref` で再帰する `nodes.0.children.0.valu`）が `wcs/path-nonexistent`（error・CLI は exit 1）になる — これまでは `0` のまま配列の上で property を探して判定不能に倒れ、存在の検査は無言だった。
  - **`$watch` の数値添字が 1 つのキー**（`"items.0.v"`・`"items.0.double"`）の `wcs/watch-path-missing` は、文面を「一度も発火しない」から「リストが丸ごと置き換わると発火するが、添字を通した書き込みでは発火しない（同じパスをマークアップで束縛していれば発火する）」に改めた（実行時の実測どおり。code・severity は同じ）。キーの打ち間違い（`"items.0.nmae"`）は従来の文面のまま。
  - リポジトリの examples / packages の HTML 全体では、修正前後で診断の出力は変わらない。

## 1.19.0 — 2026-09-24

`@wcstack/state` 3.3.0 の dist を同梱。3.2（名前の正典化）の追随漏れと、分割規則の二重実装を潰す。3.3 が新たに拒否する形（`.state:`、右辺の空セグメント、フィルタの閉じ括弧より後ろの残余、プロパティ名の無い左辺）は同梱した正本パーサがそのまま `wcs/binding-syntax` として報告する。

### 検証

- **`wcs/declaration-alias`（新設、error）** — 旧名と正式名の宣言キーを**両方**書いた state（`$streams` と `$stream`、`$updatedCallback` と `$renderedCallback`）。ランタイムはどちらが効くか推測せず読み込み時に throw する（ページ初期化ごと止まる）のに、拡張は `wcs/name-alias`（info）を 2 件出すだけだった。3.2 への移行中（新名を足して旧名を消し忘れる）にちょうど起きる形。
- **`wcs/declaration-alias-read`（新設、warning / info）** — 宣言キーを旧名で**読んだ**（`this.$streams`）。宣言と違い 3.x でも動かない — 正規化が正式名へ写したあと旧名の自前プロパティを `delete` するので、読み出しは例外も出さずに `undefined` になる。「動くが 4.0 で外れる」という `wcs/name-alias` とは別の事実なので code を分けた（移行中に `wcs/name-alias` を抑制したチームが、この「今日すでに壊れている」まで一緒に消さないため）。検出は AST（`this` のスコープを追い、文字列リテラルの中や他オブジェクトのプロパティには当たらない）で、断定できた場合は warning。`export default class …` のように静的に読めない形だけ正規表現へ落として info に留める。文言も経路で分ける — ランタイムの `delete` は**自前プロパティ**のときだけなので、オブジェクトリテラル（AST 経路）は必ず `undefined` と断定でき、class 構文（フォールバック経路）は**プロトタイプ**に置いたメソッド / アクセサなら今も読める（4.0 で外れる）と両方を説明する。走査対象は**ランタイムが `this` を state に束縛して呼ぶ関数だけ** — トップレベルの getter / メソッドと `$watch` のハンドラ（`watchRuntime.ts` の `handler.call(state, …)`）。**宣言面のうち**再束縛するのは `$watch` だけで、`$scan` の `fold`・`$stream` の `source`・`$on` のハンドラ・`$listKeys` のキー関数は素の関数呼び出しなので対象外（`$on` は `processOnDeclaration.ts` が「`this` 束縛は行わず引数で state を渡す」と明記しており、そこでの旧名読みは TypeError でこの診断の文言が当たらない）。なお宣言面の外では、イベント束縛が解決した関数も `this` が state になる（`event/handler.ts` の `Reflect.apply(handler, state, …)`）— 通常はトップレベルのメソッドなので走査済みだが、入れ子のパス（`onclick: handlers.click`）は追わない（限界として `collectDeclarationAliasReads` の JSDoc に明記）。

### 修正

- **`$dependOn` に `wcs/recursion-unsupported` が出ていなかった** — 呼び出し検出の API 一覧に正式名が無く、旧名 `$trackDependency` を書いた人だけが守られていた（ランタイムはどちらでも throw する）。文言も旧名を直書きしていたので、書かれた名前が出るようにした（ランタイムと同じ）。
- **フィルタの旧名で型検査が黙っていた** — エイリアスの正規化がフィルタ 1 件の検査にしか入っておらず、フィルタ鎖の型検査 2 か所が正式名キーだけの表を旧名で引いて中断していた。`count|uc` で `wcs/filter-input-type` / `wcs/binding-type-expectation` / `wcs/path-type-mismatch` が消えていた。
- **コメントバインディング `<!--@@:…-->` が `wcs/binding-syntax` の対象から落ちていた** — v2 移行 validator の撤去に伴う退行。ランタイムは mustache と同じ経路で throw するのに lint だけが黙っていた。
- **式の分割規則が拡張内で 2 つに割れていた** — 契約検査（`ioNodeValidator` / `bindingValidator` / `ariaValidator` / `namedStateValidator`）だけが括弧深度を見る独自実装のままで、引用符を見ていなかった。`interval: 'a;b'` を 2 式に割って偽の `wcs/tag-member-unknown` を出していた。正本（`@wcstack/state/parser` の `splitBindTexts`）へ委譲する。
- **バインド属性の走査が、HTML コメントの中の説明文とエスケープ済みテキストを実属性として拾っていた** — `findAllBindAttributes`（診断・参照インデックス・配線レンズの 6 経路が共有する単一の走査）が HTML 全体を素の正規表現で走っていたため、`examples/router-i18n` の `<!-- <template data-wcs="for:"> は … -->`（コメント）と `examples/router-spa` の `<code>&lt;template data-wcs="if: ..."&gt;</code>`（`&lt;` でエスケープされたテキスト ＝ タグですらない）を属性として正本パーサに通していた。どちらも**説明として正しく書かれた散文**で、直すべきは走査側。`<script>` / `<style>` 本体の文字列も同様。`language/htmlParse.ts` に `findStartTagRegions`（開始タグの属性領域だけを返す走査。コメント・DOCTYPE・終了タグを飛ばし、タグ終端は引用符を跨がずに探し、raw text 要素は本体ごと飛ばす）を置き、探索をそこに限定した。右辺の空セグメントを拒否する変更がランタイムへ入ると偽の `wcs/binding-syntax`（error）になり CI の `wcs-validate` が落ちる形で、実際に state を新しくビルドした dist で再現・修正後に解消を確認した。
- **`<wcs-state>` スクリプトの検査が、コメント・文字列リテラルに書いた「例示」を実コードとして検出していた** — リポジトリ自身の e2e フィクスチャが 7 件 **error**（`wcs/nested-assign`）で落ちていた。落ちていたのは「`this.rows[0].name = ...` は set トラップを通らない」という**注意書き**で、直下には推奨形が書いてある ＝ **正解を書いた注意書きを error にしていた**。`AGENTS.md` は `--errors-only` が exit 0 になるまで回すよう指示しているので、偽 error はエージェントを正しいコードを壊す方向へ誘導する。`scriptPatterns.ts` に `execAllMasked`（コメント・文字列の中身を空白へ潰した**長さを保つ鏡像**で走査し、キャプチャは原文から切り出す）を置き、同じ欠陥クラスを全数で潰した: `wcs/nested-assign` / `wcs/array-mutation` / `wcs/array-index-assign`（error）、`wcs/recursion-unsupported`（**error** — 文字列の中の `$resolve("nodes.**.x")`）、`wcs/index-arity`（warning — コメント・文字列の両方）、`wcs/name-alias`（info）。`$renderedCallback` の `paths.includes("…")` 検査だけは**文字列リテラルそのものが検査対象**なので従来どおりコメントだけを潰す（理由をコメントに明記）。
- **明示のプロパティ形の拒否語に `state` が無かった** — ランタイムの `EXPLICIT_PROPERTY_REJECTED_HEADS` は 6 語（`VOLUME_INJECTION_PROP` = `state` を含む）なのに拡張は 5 語で、dist が src に追いつくと `.state.x:` に `wcs/binding-syntax`(error) と `wcs/tag-member-unknown`(warning) が同じ 1 か所へ二重に出る。5 語を manifest から導出し、`state` だけ手書きにしたうえで、正本（state の src）とのずれを `__tests__/explicitPropertyHeads.drift.test.ts` が固定する。
- **旧名テーブルのドリフト番人を置いた** — フィルタの別名は manifest 導出で止まっているのに、API（`$trackDependency` → `$dependOn`）と宣言キー（`$streams` → `$stream`）の別名は手書きでテストが 0 件だった。正本は `manifest.ts` の `STATE_API_ALIASES` と `declarationAliases.ts` の `DECLARATION_ALIASES` だが**コミット済み dist がまだ export していない**ので、`quoteAware.ts` と同じ形の TODO を置き、state の src を読んで突き合わせるテストを追加した。
- **補完の修飾子 `textEdit` が、リストの 2 個目を補完すると先に書いた修飾子を消していた** — `value#ro,w` で `wo` を選ぶと「カーソル前の最後の `#`」から置換して `value#wo` になっていた。置換開始を「最後の `#` **または** `,` の次」にする。あわせて `provideCompletionItems`（**拡張が生成する唯一のテキスト編集経路**）のテストを新設した（これまで 0 件で、引用符対応を素の `lastIndexOf` に戻しても全テストが緑だった）。
- **兄弟ボリュームでマウント接頭辞が重複候補になっていた** — `mount="shop.cart"` と `mount="shop.user"` で `shop` が 2 回載り、パス補完に同じ項目が並んでいた。
- **`state: cart`（ボリュームの根へのマウント）が `wcs/binding-path-missing` に誤報されていた** — ボリューム（`mount=`）の候補が接頭辞付きの子パス（`cart.total`）だけで、**マウントパスそのもの**を積んでいなかった。`state: cart` は `@wcstack/state` の README に載っている正規の書き方で、ランタイムは解決する。ネストしたマウント（`mount="deep.vol"`）では途中の `deep` も載せる。子パスを 1 つも解決できなかったとき（IDE が読まない `src=` 外部 state など）は足さない — 存在の根拠が無いので `cart.total` と同じく黙る側に揃える。
- **補完の文脈判定に残っていた引用符を見ない区切り走査を潰した** — `data-wcs` の値をカーソル位置で読む経路（`bindingContext` / mustache の補完）だけ素の `split` / `indexOf` / `lastIndexOf` が残っており、`textContent: items|join('|')` の末尾で「フィルタ名を入力中」と誤判定して `')` を候補の前方一致に使い、`textContent: 'a;b'` では引用符の中の `;` で式を割って別のバインディングを見ていた（どちらも実測）。診断ではないので false error にはならないが、補完が的外れになる。入力途中で引用符が開きっぱなしの形（`join('`）は、その先が全部「引用符の中」になるので手前の実区切りが選ばれ、従来どおり「引数の中なので補完しない」に落ちる。修飾子の区切り `#` も同じで、`value|defaults('#')` の引数の `#` を修飾子帯の開始と読んでプロパティ補完の代わりにイベント修飾子を出し、置換範囲もその引数の中から取っていた（選ぶと引数を壊す編集になる）。あわせて残りの区切り走査（`forContext` / `namedStateValidator` / `wiringLens` / `positionalParser`）も `quoteAware` へ寄せ、**拡張内にバインディング構文の素の区切り走査を 0 件**にした。`core/parser/quoteAware.ts` の JSDoc に、**この構文で区切りになる文字の全数**（`; : # | , ( )` が引用符の影響を受ける／`. * $ @ ...` と修飾子リストの `,` は受けない、それぞれ理由付き。`@wcstack/state` の `define.ts` と manifest と突き合わせ済み）と、対象外と判定した走査の一覧（`parseBindingExpression` 後の `property` に対する `#`・JS ソースの実引数分割・マスク済み鏡像に対する走査・JSON 字句解析・型ユニオンの `|`）を残した。
- **左辺と右辺を分ける `:` を引用符対応にした** — 入力（左辺）フィルタの引数に `:` があると左辺が `value|defaults('` で切れ、引数が消えて `wcs/filter-arity`（「引数 0 個」）を**誤報**していた（`value|defaults(':'): name` / `value|truncate(3,':'): name`）。パスも取り違えるので `wcs/binding-path-missing` まで巻き添えになる。走査は `core/parser/quoteAware.ts` に 1 本だけ置き、契約検査（`bindingValidator` / `namedStateValidator`）・補完文脈（`bindingContext`）・配線レンズ（`wiringLens`）・位置付きパーサの全消費者が同じものを使う（拡張内に素の `indexOf(':')` による左右分割は 1 つも残っていない）。
- **フィルタ引数の区切り `,` を引用符対応にし、空引数の扱いをランタイムに合わせた** — 素の `split(',')` + 空引数の一括除去だったため、`items|join(', ')`（要件 B1 の代表例）・`join(',')` / `join('a,b')` / `defaults('a,b')` が「引数 2 個」に、`defaults(,)` が「引数 0 個」に数えられ、**正しい式に error 重大度の `wcs/filter-arity` を誤報**していた。`validateBindings` は `wcs-validate` CLI にも載るので、そのままでは正しいページで CI が exit 1 になる。ランタイムの規則（引用符の外の `,` だけで区切る／落とすのは**末尾の空引数だけ**で先頭・中間は位置を保つ）に揃えた。
- **フィルタの区切り `|` と引数の終端 `)` も正本と同値にした** — `|` は括弧深度ではなく引用符で判定する（`join('(')|upper` で後続フィルタを見失っていた）。引数の終端はランタイムと同じく**最後の** `)`（`[^)]*` だと `join('a)b','x')` の 2 個目の引数ごと消えて arity 超過を見逃す）。mustache / コメントバインディング側の `|` 分割も同様で、`{{ items|join('|') }}` の後片を未知フィルタと誤報していた。
- **宣言キーの旧名の走査を宣言側の正本に寄せた** — 正規表現ベースだったため文字列リテラルの中（`{ msg: "see $streams: docs" }`）で誤検出し、引用符付きキー（`"$streams": { … }`）を取りこぼしていた。宣言が静的に読めない形（class 構文の state — ボリューム（`mount=`）の通常形）では従来の正規表現へフォールバックして info を出す（class フィールドの `$streams = …` も見る）。フォールバック経路は誤検出しうるので `wcs/declaration-alias`（error）へは昇格させない。
- **旧名の宣言キーの「読み出し」を宣言側と分けた** — 文言（「3.x の間は動きます」→「読み出しは動かないので正式名を読むこと」）に加え、code と severity も分けた（上記 `wcs/declaration-alias-read`）。
- **同じフィルタを 2 回書いたとき、mustache の報告範囲が 2 件とも 1 個目を指していた**（`{{ name | uc | uc }}`）。
- **`wcs/on-prefixed-member` の提案文が修飾子を落としていた** — `once#ro:` に対して `.once#ro:` と言う。また、正本パーサが `wcs/binding-syntax` で落とす形（`..once:` / `.:`）に `wcs/tag-member-unknown` を重ねない。
- **旧名のフィルタの hover が「旧名である」ことを言わなかった** — 正式名の説明を出すだけだった。

### ドキュメント

- README の例と診断表に残っていた旧名（`count|uc` / `$streams` / `$updatedCallback`）を正式名に揃えた（旧名の説明が目的の `wcs/name-alias` の行は除く）。補完候補の例と組み込みフィルタ数（48）も正本に合わせた。

## 1.18.0 — 2026-09-22

`@wcstack/state` 3.2.0 の dist を同梱。3.2（名前の正典化）に追随する。

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
