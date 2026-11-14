/**
 * core/diagnostics.ts
 *
 * Phase 5a (docs/architecture-hardening/09-remediation-design.md §7.1) の共有診断モデル。
 * 「diagnostic は安定した code、source range、severity、関連する tag / member / state path
 * を持つ」を型で表現する。同じ validator core を VS Code / CI CLI / dev runtime が呼ぶため、
 * 同一入力からは常に同一 code / range が出る(§8 完了条件「IDE と CI の diagnostic code /
 * range が一致」)。
 *
 * このモジュールは DOM / vscode / typescript に依存しない pure library。
 */

import type { LineColumn } from "./offsetToPosition.js";

export type WcsSeverity = "error" | "warning" | "info";

/**
 * 安定した診断 code の単一正本。文字列値は quick-fix / suppression / docs の
 * キーになるため、一度公開したら値を変えない(追加は自由)。
 */
export const WcsDiagnosticCode = {
  // --- sidecar manifest envelope / schema subset ---
  ManifestBroken: "wcs/manifest-broken",
  ManifestSchemaVersion: "wcs/manifest-schema-version",
  ManifestKindInvalid: "wcs/manifest-kind-invalid",
  ManifestUnknownKeyword: "wcs/manifest-unknown-keyword",
  ManifestExternalRef: "wcs/manifest-external-ref",
  ManifestRefCycle: "wcs/manifest-ref-cycle",
  ManifestRefUnresolved: "wcs/manifest-ref-unresolved",
  ManifestNamespaceVersion: "wcs/manifest-namespace-version",
  // --- sidecar resolution: collision / override ---
  // 同名 tag / filter の後勝ち禁止(§5-3)。override:true が無い再定義もこの collision で表す。
  ManifestTagCollision: "wcs/manifest-tag-collision",
  ManifestFilterCollision: "wcs/manifest-filter-collision",
  // 同名 state の stateSchema が複数の application artifact に宣言されている(§5-3 の
  // application 版・D8)。勝者なし: その state は未宣言扱い(schema 検証は沈黙)。
  ManifestStateCollision: "wcs/manifest-state-collision",
  // 明示 override:true(§5-4)。衝突ではなく意図的な shadow の告知(info)。
  ManifestOverride: "wcs/manifest-override",
  // --- sidecar vs live declaration drift ---
  DriftMissingMember: "wcs/drift-missing-member",
  DriftEventMismatch: "wcs/drift-event-mismatch",
  // --- path / type resolution against a stateSchema ---
  PathNonexistent: "wcs/path-nonexistent",
  PathTypeMismatch: "wcs/path-type-mismatch",
  // 書き戻す束縛（`value:` / `checked:` / `radio:` / `checkbox:`、`#ro` なし）が、setter の無い getter を指す。ランタイムは
  // 入力のたびに `"<path>" is a getter without a setter` を投げる（code なし — 7GUIs の評価の Temperature）。error。
  PathReadonly: "wcs/path-readonly",
  PathReservedName: "wcs/path-reserved-name",
  // lint の限界の告知（作者の誤りではない）: `export default { … }` のトップレベルの spread が持ち込むキーは読めないので、
  // stateSchema の無い state のパスは検査しない — それを spread の上で 1 回だけ言う。info。値の読めないキー（辿れない名前、
  // 読めない spread を持つオブジェクトリテラルの種 `draft: { ...makeDraft() }`）の下を束ねたときも、キーの上で 1 回言う。
  PathDynamicUnknown: "wcs/path-dynamic-unknown",
  // lint の限界の告知（作者の誤りではない）: 読めない `<wcs-state src>`（/ から始まるパス・URL・無いファイル）の state は
  // パスもスクリプトの規則も検査しない — それを src の上で 1 回だけ言う。info（docs/seam-apps.md、prod-booking）。
  StateSrcUnread: "wcs/state-src-unread",
  // lint の限界の告知（作者の誤りとは限らない）: 束縛（`data-wcs`・コメント束縛）があるのに `<wcs-state>` の無いファイル
  // （ページが取り込む CMS の部分テンプレート・ルートの中身の断片・state をスクリプトで作るページ）。束縛のパスは
  // 検査していない — それをファイルに 1 回だけ、最初の束縛の上で言う。stateSchema があれば検査するので黙る。info
  // （継ぎ目アプリ community-hall — 何も出ず `nothing to check:` にも載らないので、検査済みに見えた）。
  StateAbsent: "wcs/state-absent",
  // --- existing binding-expression validators (retrofitted) ---
  FilterUnknown: "wcs/filter-unknown",
  FilterArity: "wcs/filter-arity",
  FilterArgType: "wcs/filter-arg-type",
  FilterInputType: "wcs/filter-input-type",
  BindingPathMissing: "wcs/binding-path-missing",
  BindingTypeExpectation: "wcs/binding-type-expectation",
  TokenUndeclared: "wcs/token-undeclared",
  TokenMisconfigured: "wcs/token-misconfigured",
  // 宣言したコマンドトークンを emit する（スクリプトの `.emit()`・マークアップの `on*: $command.x`）のに、どの
  // `command.<method>:` 束縛にも結ばれていない。emit は誰にも届かず、ランタイムは何も言わない（7GUIs の評価）。warning
  // （ページの外 — 別ファイルのルートのテンプレート — で束ねる形は見えない）。
  CommandTokenUnbound: "wcs/command-token-unbound",
  // `$eventTokens` に宣言したのに、ドキュメントのどの `eventToken.<member>: <name>` 束縛も出さないトークン（command-token-unbound
  // の逆）。どの要素も発火させないので `$on` のハンドラは走らず、ランタイムは何も言わない（継ぎ目アプリ ledger-repair — 束縛と
  // ハンドラを外して `deleteFetch.status` を見た）。warning。ファイルから読むレイアウト（`<wcs-layout src>`）や、state の
  // モジュールのほかに `eventToken.` の束縛を書くスクリプトがあるページは、見えない束縛が出しうるので黙る。root の state だけ。
  EventTokenUnbound: "wcs/event-token-unbound",
  // state が宣言していないトップレベルのキーへの書き込み（`this.selectedID = …` と `selectedId`）。新しいキーができる
  // だけで、宣言したキーの束縛は変わらない。ランタイムは何も言わない。近い名前（打ち間違い）があるときだけ、warning。
  WritePathMissing: "wcs/write-path-missing",
  // getter・メソッドの中で読む state のパス（`this["items.*.amout"]`・`$getAll("items.*.amout")`・`this.totl`）が宣言に無い。
  // 入れ子のパスの読みは undefined になり、そこから計算した金額が黙って違う（確定申告の下書きツールの評価）。トップレベルの
  // キーは読んだ時点で throw する。近い名前（打ち間違い）があるときだけ、warning。ランタイムの diagnostics も同じ code。
  ReadPathMissing: "wcs/read-path-missing",
  NestedAssign: "wcs/nested-assign",
  // --- 意味論（構文・存在検査では捕まらない取り違え。service/semanticValidator.ts） ---
  // `$getAll` / `$setAll` / `$resolve` / `$update` の添字の本数がパスの `*` の本数と噛み合わない。
  // ランタイムは #901 / #902 で throw する（diagnostics の後付けがあれば同じ code の文面。超過は 3.x では
  // 黙って無視されていた）。error。
  IndexArity: "wcs/index-arity",
  // ワイルドカードの階数がスコープの段数を超える（`matrix.*.*` を 1 段の for で読む、
  // `$2` を 1 段のループで読む。ランタイムの #1401）。既存の「for の外」検査の深さ方向の一般化。
  // 4.0 は各段の `*` が**その段で囲む for のリスト**の行であることも確かめる（#1403・F32 — `for: a`
  // の行の中の `b.*.y` は投げる）。静的側も囲む for の一覧と段ごとに比べて同じ code で報告する
  // （ランタイムの文面に code が付くのは diagnostics の後付けがあるとき）。for のスコープを組み直しきれない
  // ので、ランタイムは初期化を失敗させるが warning のまま（vscode-wcs の README の重大度の例外）。
  WildcardRank: "wcs/wildcard-rank",
  // ループの添字の範囲（`$1`〜`$128`。上限は manifest の `syntax.indexParam.maxDepth`）の外。ランタイムと同じ code:
  // for の中のマークアップの `$129`（バインディングが失敗する）と、スクリプトの `this.$0` / `this.$129` / `this.$1000`
  // （読んだ時点で throw）。error。マークアップの `$0` / `$1000` は添字の形でないので、ランタイムと同じく
  // `wcs/binding-path-missing`（ただしけっして動かないので error）。for の外の `$129` はランタイムでは #1401 なので
  // 従来どおり「for の外のループ添字」（`wcs/template-syntax`）で報告する。
  IndexParamRange: "wcs/index-param-range",
  // パス getter どうしの循環参照。4.0 のランタイムは評価の時点で #701 として throw し、その getter を読む
  // 束縛はすべて失敗する（3.x はアドレススタック上限まで再帰してから落ちた）。error。
  GetterCycle: "wcs/getter-cycle",
  // --- what a getter, a setter or a method writes (docs/script-write-checks.md) ---
  // getter の評価中の書き込み（代入・複合代入・増減・`$setAll` / `$update` / 引数 3 つの `$resolve`、getter が同期に呼ぶ
  // メソッドの書き込みも）。4.0 のランタイムは書き込みのたびに throw する（4.17 から書いたパスと getter を名指す）。
  // 入れ子の関数の中は、評価中に走るとは限らないので見ない。error。
  GetterWrite: "wcs/getter-write",
  // setter が自分のパスに書く、または setter どうしが互いに書く（同期の書き込みだけ）。setter のパスはアクセサそのもの
  // なので、書けば setter がまた呼ばれ、スタックが溢れるまで続く（4.17 から diagnostics の後付けが名指して throw する）。
  // 自分のパスは error、2 つ以上の循環は条件で止まりうるので warning。
  SetterCycle: "wcs/setter-cycle",
  // setter が書くものを、同じ名前の getter が（呼ぶ getter・メソッドを通しても）一つも読まない。setter の後に getter は
  // 元の値を返し、双方向の入力はそこへ戻る — 何も知らせない（4.17 から diagnostics の後付けが警告する）。setter・getter
  // の読み書きを追えない（`this[key]`・`fn(this)`・知らないメソッド）なら黙る。warning。
  SetterUnobserved: "wcs/setter-unobserved",
  // 1 つのアクセサを複数のパスに宣言するキー（`get "users.*.full,employees.*.full"()`、4.22）の書き方の誤り:
  // カンマの前後の空白・空の項目・再帰のキー（`**`）。ランタイムはカンマで分けた間をそのままパスにするので、
  // 空白入りのパスは誰も読まないパスになる（diagnostics の後付けは同じコードで初期化を失敗させる）。error。
  AccessorListSyntax: "wcs/accessor-list-syntax",
  // 複数のリストに宣言したアクセサの本体が、そのうち 1 つのリストの行を絶対パス（`this["users.*.first"]`）で
  // 読み書きしている。ほかのリストの行ではそのパスに行が無く、読みは undefined、書きは例外になる。本体は
  // 行からの相対パス（`this[".first"]`）で書く（diagnostics の後付けは同じコードで警告する）。error。
  AccessorListPath: "wcs/accessor-list-path",
  // `$renderedCallback`（3.x の旧名 `$updatedCallback`）が、どのバインディングにも現れないパスを判定に使っている。
  // 同コールバックは **binding 駆動**（live binding が適用された path しか報告しない）
  // なので、その分岐は一度も実行されない。表示要素が購読の実体になる事故
  // （examples/state-intersect-scroll の README に記録）の静的検出。
  UpdatedCallbackUnbound: "wcs/updated-callback-unbound",
  // getter の中で `this.form.name` のように、パス読み取りの先で素のプロパティアクセスを
  // 続けている。追跡されるのは `form` だけで、`form.name` の変更では再評価されない
  // （state README「依存追跡の境界」規則 1）。ランタイムは素のアクセスと区別できないので
  // 静的にしか検出できない。対象はオブジェクトリテラル初期値のルートだけ（配列は `items`
  // の依存で足りる — 行の置換は `items` 自体を書き換え、in-place 変異は array-mutation が止める）。
  // 読んだパスをページの束縛（組み込みタグの spread・書き戻す束縛・要素の出力）が書くなら error（その書き込みは
  // getter に届かないと断定できる — 継ぎ目アプリ family-ledger）、スクリプトの書き込みだけなら warning（ルートも
  // 置き換えるなら壊れない）。時刻・`location` を読む getter も同じ code（warning）。
  GetterUntrackedRead: "wcs/getter-untracked-read",
  OnHandlerThis: "wcs/on-handler-this",
  // --- <wcs-state> script: $watch declaration ---
  // temporal の後付け（state の temporal/watch.ts）が読み込みで throw する宣言: 越境 `@` / `$` 始まり /
  // 空キー / 明らかな非関数ハンドラ。空の段（`a..b`）はランタイムが調べず、その watch は黙って発火しない
  // （lint だけが知らせる — docs/mistake-catalogue.md）。
  WatchDeclarationInvalid: "wcs/watch-declaration-invalid",
  // `$watch` のキーが状態定義に存在しない。バインディング側と違い黙って発火しない
  // だけなので気づけない。severity は binding-path-missing に揃える（warning）。
  WatchPathMissing: "wcs/watch-path-missing",
  // --- <wcs-state> script: $scan declaration ---
  // 4.0 は `$scan` を外した（読み込み時に throw — ランタイムの文面は番号 #1 だけでコードを持たない）。
  // 宣言のキーに 1 件だけ出す。3.x で宣言の形・パスを検査していた `wcs/scan-source-computed` /
  // `wcs/scan-path-missing` は 4.0 では出さない（宣言そのものが動かないため）。
  ScanDeclarationInvalid: "wcs/scan-declaration-invalid",
  // --- <wcs-state> script: $recursion declaration / `**` paths ---
  // ランタイムと同じ code 語彙(@wcstack/state src/recursion/ が正本。
  // docs/state-recursive-path-impl-plan.md §7)。静的に出すのは**パス文字列と宣言だけで
  // 決まる**ものに限る。データを見ないと決まらない wcs/recursion-shared-list /
  // wcs/recursion-cycle / wcs/recursion-depth-exceeded、および評価時の呼び出し文脈に
  // 依存する wcs/recursion-context は runtime 専用(静的側は出さない)。
  //
  // `**` を解釈しない場所へ `**` が渡った(data-wcs / mustache / $watch キー / $listKeys
  // キー / $resolve / $postUpdate / $dependOn(旧名 $trackDependency) / 代入)、または `$recursion` 宣言が
  // 無いのに `**` を使った。4.0 の runtime はどれも #1101 で throw する — 宣言なしの `**` getter も、
  // アクセサを登録する時点で（3.x は黙って無視した）。error。
  RecursionUnsupported: "wcs/recursion-unsupported",
  // 宣言済みアンカーと合致しない `**`(綴り違い・2 つ目の `**`)、または `**` の後ろが
  // 整形されていない(空セグメント・`**` 直後の素の `*`)。
  RecursionAnchor: "wcs/recursion-anchor",
  // `$getAll` の添字の形が `**` に対して定義できない(非空の接頭辞 / 配列でない値)。
  RecursionGetAllForm: "wcs/recursion-getall-form",
  // `$setAll` の添字・値の形が `**` に対して定義できない
  //(非空の接頭辞 / 添字省略 / mapper / spread)。
  RecursionSetAllForm: "wcs/recursion-setall-form",
  // ノード自身・子リスト・子ノード・子リストの length・多段の反復サブパスなら子リストへ
  // 至る途中のオブジェクトへの一括書き込み(確定済みの子アドレスを壊す)。
  RecursionStructuralWrite: "wcs/recursion-structural-write",
  // 再帰 getter(およびその派生値の中)への書き込み。setter は初版では持てない。
  RecursionReadonly: "wcs/recursion-readonly",
  // `$recursion` 宣言そのもの、または `**` getter の宣言の形が不正(アンカー / 反復
  // サブパスの形・複数宣言・setter・getter でない・ノード自身・構造を名指す接尾辞・
  // 展開形と同名の具体 getter・ボリューム / マウント下での宣言)。
  //(ランタイムは初期化時に raiseError)。wcs/watch-declaration-invalid の再帰版。
  RecursionDeclarationInvalid: "wcs/recursion-declaration-invalid",
  TypeAnnotation: "wcs/type-annotation",
  // テンプレート・構造の書き方。ランタイムと同じ code: for / if テンプレートの中の `outerHTML:` /
  // `outerText:`（4.0 の #203、初期化で throw）・構造ディレクティブの併記（#201）など。挿入された内容の
  // 先頭に置かれた構造テンプレート（#204）は実行時にしか分からないので静的には出さない。
  TemplateSyntax: "wcs/template-syntax",
  // ランタイムの正本パーサが [wcs/binding-syntax] で拒否する書き方(@wcstack/state 3.0 の文法の
  // 厳格化: 閉じていない引用符・2 つ目の '#'・else: の値・構造ディレクティブの修飾子・空のフィルタ。
  // 4.0 はパスの右辺の `__proto__` / `prototype` の段も拒む — #120)。
  // 判定は正本パーサに委ねる(service/bindingSyntaxValidator.ts)。
  BindingSyntax: "wcs/binding-syntax",
  // --- <wcs-state> script: array reactivity hazards ---
  // 配列破壊的メソッド呼び出し(push 等 9 種)。Proxy を素通りしリアクティブ更新されない。
  // 同一参照の自己再代入でも要素の追加・削除は反映されない(docs/array-mutation-diagnostic-design.md §3)。
  ArrayMutation: "wcs/array-mutation",
  // 配列インデックスへの直接代入(bracket-only チェーン)。同上。正はドットパス代入。
  // ドットアクセスを含むチェーン代入は NestedAssign の担当(相補・二重報告なし)。
  ArrayIndexAssign: "wcs/array-index-assign",
  // --- built-in wcs-* tag contract (generated/builtinTags.generated.ts が正本) ---
  // 未知メンバーへのバインド(プロパティ / command. / eventToken. キー)。4.0 のランタイムは #38 / #1203 /
  // #1204 で拒み、root では初期化が、行では束縛が失敗する（3.x の「黙って無視」ではない）。error。
  TagMemberUnknown: "wcs/tag-member-unknown",
  // `semantics: "handle"` の出力（`<wcs-camera>` の `streamReady` = 生の MediaStream）を、値としてパスに
  // 束ねた。プロトコルは「値の置き場ではなく ref / callback で受ける」と定める（protocol/wc-bindable.ts）。
  // ランタイムは書くので動くが、スナップショット・DevTools・SSR に載らないオブジェクトが state に入る
  // （docs/seam-apps.md、state-field-report）。warning。5.0 でランタイムが拒むかは誤りの目録の議題。
  HandleBoundAsValue: "wcs/handle-bound-as-value",
  // タグのメンバー名が "on" で始まる（`once` 等）のに先頭ドット無しで束縛した: ランタイムはイベント束縛にして
  // "ce" イベントを待ち、値は届かない。明示のプロパティ形 `.once:` を提案する（@wcstack/state 3.1・要件 B5 / 3.x 計画 D36）
  OnPrefixedMember: "wcs/on-prefixed-member",
  // 4.0 が root へ委譲するイベント（`dom/view.ts` の `BUBBLING`）の `on*:` で、ハンドラのメソッドがイベント引数の
  // `currentTarget` を同期的に読む。委譲されたイベントの `currentTarget` は要素ではなく root なので、要素を
  // 使う処理（`setPointerCapture`・`getBoundingClientRect`・`new FormData(e.currentTarget)`）が壊れる。
  // ランタイムは何も報告しない（root は正しい値）ので lint の code。`#direct` か `event.target.closest(...)` を
  // 案内する。読みが実行されない分岐にあることもあるので warning。
  DelegatedCurrentTarget: "wcs/delegated-current-target",
  // `<form data-wcs="onsubmit: login">` の `#prevent` 忘れ（ハンドラも preventDefault を呼ばない）。ブラウザが
  // フォームも送る — ページが読み直されるか、router があれば GET が欄（パスワードも）を URL と履歴に載せる
  // （docs/seam-apps.md、router-auth）。error（4.21 から — 4.20 までは warning で、`--errors-only` に隠れた: 継ぎ目アプリ
  // ledger-repair）。action 付きのフォームと、読めないハンドラでは黙る。
  SubmitWithoutPrevent: "wcs/submit-without-prevent",
  // `localStorage` / `sessionStorage` / `document.cookie` を、1 回しか評価されないモジュールのトップレベル（関数の外）で読む。
  // `<wcs-guard-handler>` のモジュールは 1 回だけ評価され、export した関数が遷移のたびに走る（router の README）ので、ガードは
  // 読み込みの時点のセッションで決め続ける — ログインしても守られたページはすべて /login へ戻され、何も言わない（継ぎ目アプリ
  // ledger-repair）。ガードは error、`<wcs-state>` のモジュール（インライン・`src=`）は warning（state は読み込みの時点の値を
  // 持ち続ける — 意図した種もありうる）。関数の中（export した関数・そこから呼ぶ補助関数・getter・メソッド）の読みは黙る。
  SessionReadAtModuleTop: "wcs/session-read-at-module-top",
  // 4.0 で外れた API の旧名（`this.$trackDependency` → `$dependOn`、`$untrackDependency` → `$untracked`）。
  // ランタイムは読んだ時点で同じ code（#1701）で throw するので error。3.x（3.2〜3.3）では「動くが 4.0 で
  // 外れる」info だった。フィルタの旧名（`uc` など）は 4.0 のランタイムと同じく `wcs/filter-unknown` で、
  // 宣言キーの旧名は `wcs/declaration-alias` で報告する（どれも正式名を提案する）
  NameAlias: "wcs/name-alias",
  // 4.0 で外れた宣言キーの旧名を `this.` 越しに**読んだ**（`this.$streams`）。4.0 の state にその
  // キーは無いので、読み出しは例外も出さずに undefined になる（lint 専用の code — ランタイムは
  // 読みを止めない）。severity は検出経路で変わる — AST で断定できたら warning、読めない形
  //（class 構文など）の正規表現フォールバックは info（誤検出しうる経路を warning にしない）。
  DeclarationAliasRead: "wcs/declaration-alias-read",
  // 4.0 で外れた宣言キーの旧名（`$streams` → `$stream`、`$updatedCallback` → `$renderedCallback`）を
  // 宣言した。ランタイムは読み込み時に同じ code（#1601）で throw する（ボリュームは読み込みを通らず、接ぎ木を
  // 拒んで console.error で報告する）＝ その state は動かないので
  // error（宣言が静的に読めない class 構文の正規表現フォールバックだけ warning）。3.x では「旧名と正式名を
  // 両方書いた」形だけが error だった
  DeclarationAlias: "wcs/declaration-alias",
  // --- 4.0 の設定（`$behavior` / `$features` / root の `features=`。config-impl-plan.ja.md §4 段 4） ---
  // `$behavior` の値・キー・型、ボリュームの `$behavior`。ランタイムは読み込み時に throw する
  //（#44。ボリュームは接ぎ木を拒んで console.error で報告する。ランタイムの文面は番号だけでコードを持たないので、lint の code）。
  BehaviorInvalid: "wcs/behavior-invalid",
  // `$features` の要素・root の `features=` の名前が後付けの名前（8 つ）でない。分割 auto の
  // ランタイムと同じ code（読み込み関数の許可リスト）。全部入り・バンドラのページでは
  // `[wcs/feature-not-installed]` になる（どの入口を読んだかは静的に分からないので、lint はこちらで報告する）。
  FeatureUnknown: "wcs/feature-unknown",
  // `$features` が配列でない・ボリュームの `$features`（error。ランタイムは読み込み時に throw）、
  // 文書の root 以外の `<wcs-state>` の `features=`（warning。ランタイムは読まない — 設計 A3 で lint だけ）。
  FeaturesInvalid: "wcs/features-invalid",
  // wcBindable 無宣言タグ(wcs-fetch-header 等のヘルパー)への spread。
  // ランタイム(expandSpread)は raiseError で落とす。
  SpreadNoBindable: "wcs/spread-no-bindable",
  // trigger バインド先スロットの true シード(エッジ検出なし・manual バイパスで即発火)。
  TriggerSeededTruthy: "wcs/trigger-seeded-truthy",
  // 非 manual <wcs-storage> value バインド先の空値シード(初期書き戻しが保存値を上書き)。
  StorageSeedClobber: "wcs/storage-seed-clobber",
  // `value#init=element` の <wcs-storage> バインド先の null 以外のリテラルシード
  // (空のキーは null を読むので、初回の引き込みでシードが null に置き換わる)。
  StorageInitSeed: "wcs/storage-init-seed",
  // 組み込み I/O ノードの入力を束ねたパスの下へ、ページが書き込む(`value: cart` と
  // `this["cart.0.quantity"] = …`)。束縛はそのパス自身への代入でしか当て直されないので、
  // 下への書き込みは要素に届かない(storage なら保存されない)。
  InputNestedWrite: "wcs/input-nested-write",
  // --- accessibility (docs/a11y-design.md §8 / D9) ---
  // `attr.aria-*` バインドの属性名が WAI-ARIA に存在しない(タイポ)。
  // setAttribute はそのまま書き、支援技術は黙って無視する。severity は warning
  // (error 昇格時は packages/lint/scripts/smoke-test.mjs の対ケース更新が必須)。
  AriaAttrUnknown: "wcs/aria-attr-unknown",
  // ライブリージョン（`aria-live`、`role="status"` / `"log"`）を `if:` / `for:` の template か `<wcs-route>` の中に
  // 置き、文と一緒に挿入される。スクリーンリーダーは読み上げない（読み上げるのは、ページにある間に文が変わったとき）。
  // 挿入で読み上げられる `role="alert"` は対象外。継ぎ目アプリ city-library（view transition ありの Chromium で 0/10）。warning。
  LiveRegionInserted: "wcs/live-region-inserted",
  // --- フォームの入力（要素の束縛が、利用者の入力に対して何をするか。service/formInputValidator.ts） ---
  // `for:` の行の中の、`name` をリテラルで書いたラジオ（`<input type="radio" name="sex" data-wcs="radio: .sex">`）。
  // どの行のラジオも同じ name になるので、ブラウザは全部の行を 1 つのグループにする: ページ全体で 1 つしか選ばれた
  // 状態にならず、表示は最初の描画から行ごとの値と食い違う。ランタイムは何も言わない（ブラウザの規則 — 継ぎ目アプリ
  // ekiden-entry）。name を束ねてあるとき（`attr.name:`）・行のものでないパス（`radio: selectedId` — 行をまたぐ 1 つの
  // グループが意図）・行ごとに `<form>` があるときは黙る。warning。
  RadioNameShared: "wcs/radio-name-shared",
  // 書き戻すときに変換しない双方向の `value:` が、state が数値で持つパス（種・JSDoc の `@type`・stateSchema）を指す。
  // 要素の `value` は文字列なので、5 と入力した後の state は `"5"` で、`count + 1` は `"51"` になる。ランタイムは何も
  // 言わない（ekiden-entry — 弁当 1 個と 2 個が 12 個になった）。数値にする入力フィルタ（`value|number:`）・
  // `valueAsNumber:`・`#ro`・アクセサペア（setter が変換しうる）では黙る。warning。
  NumberWrittenAsString: "wcs/number-written-as-string",
  // 双方向の `value:` / `valueAsNumber:` に付けた出力フィルタ（`value: code|upper`・`value: price|locale`）。フィルタは
  // 要素が書き戻すたび（既定では 1 打鍵ごと）に state の値を整形して欄へ書き直す: キャレットは末尾へ飛び、IME の変換は
  // 途切れ、state が受け取るのは整形済みの文字（出力フィルタは書き戻しで元に戻らない）。確定した値を書き戻す束縛
  // （`#onchange`・スライダー・`<select>`）は入力中に書き換わらないので、入力フィルタ（作者が用意した戻り道 —
  // `value#onchange|number: price|toFixed(2)`）が無いときだけ報告する。要素の書いた文字をそのまま返すフィルタ
  // （`string`・`nullIfEmpty`・`coalesce(…)`・`defaults('')`）と `#ro` では黙る。warning。
  TwoWayOutputFilter: "wcs/two-way-output-filter",
  // --- document-level load configuration ---
  // @wcstack/state/auto より後に @wcstack/devtools/auto が読まれている。info: 4.0 は後から付いた DevTools に
  // 既存の束縛を送り直すので、欠けるのは付く前のタイムラインだけ。
  ScriptOrder: "wcs/script-order",
  // router/auto があるのに <base href> がない(SPA の basename 誤導出)。
  BaseHrefMissing: "wcs/base-href-missing",
  // <wcs-router> の直後に無い <wcs-outlet>（どの router にも使われない）と、直後に outlet を持たない
  // router。router は自前の outlet を直後に作り、ページはそこに描かれ、置いた outlet は空のまま。
  // ランタイムも同じ code で警告する（docs/router-outlet-placement.md）。
  RouterOutletMisplaced: "wcs/router-outlet-misplaced",
  // `query-keys` を持つ `<wcs-link>` の `to` が付けるキーが、どれも `query-keys` に無い。リンクは名指したキーだけを
  // 比べるので、自分のクエリは判定に効かず、名指したキーが合えばどこでも現在になる（そう書いたタブは同時にすべて
  // 現在）。`to` のキーの一部だけを比べない形（`to="?cat=a&page=1" query-keys="cat"`）は意図どおりなので黙る
  // （docs/formal-methods-study.md §4.2）。warning。
  LinkQueryKeyIgnored: "wcs/link-query-key-ignored",
  // @wcstack/signals と /dom エントリの同一ページ混在(リアクティブコア二重化)。
  SignalsDualEntry: "wcs/signals-dual-entry",
  // wcstack を自分で読み込むページが、あるパッケージのタグ（`<wcs-upload>`・`<wcs-upload-header>`）を書くのに、その
  // パッケージのスクリプトを読み込んでいない。要素は定義されず、束縛は待ち続け、コンソールにも何も出ない（継ぎ目アプリ
  // homeroom — 保存が「送信中 0%」で止まった）。パッケージごとに 1 回、最初のタグに。読めないローカルのスクリプトがある
  // ページ・autoloader の `@components/` が覆うタグ・wcstack を自分で読み込まないページ（断片・バンドラ）では黙る。error
  // （4.21 から — 4.20 までは warning で、`--errors-only` に隠れた: 継ぎ目アプリ ledger-repair）。
  TagPackageMissing: "wcs/tag-package-missing",
  // `<wcs-router>` の無いページの、内部のパス（`to="/…"`）へ飛ぶ `<wcs-link>`。リンクは接続で
  // `[@wcstack/router] wcs-link is not connected to a router.` を投げ、ホストは `display: none` のまま `<a>` を作らない
  // — リンクが消える（継ぎ目アプリ community-hall — サーバーが描くページにアイランドを置く形）。wcstack を自分で
  // 読み込み、router を読み込むページだけ（断片・ルートの中身・レイアウトのファイルは黙る）。router を読み込まない
  // ページは `wcs/tag-package-missing` が報告する。ページが HTML コメントの外のどこかで `wcs-router` を名指せば
  // （`<template>` の中の `<wcs-router>`・それを作るスクリプトも）黙る。warning。
  LinkRouterMissing: "wcs/link-router-missing",
  // ページの URL が、lint の規則の版（lint を作った @wcstack/state の版）より新しい minor の wcstack を固定している
  // （`@wcstack/state@4.11.0` と lint 4.10.1）。古い lint は新しい規則を知らず、新しい正しい書き方を error にもする
  // （homeroom — 4.2.0 の lint が 4.10 の `datetime(ja-JP,short,Asia/Tokyo)` を `wcs/filter-arity` に）。ページに 1 回、
  // いちばん新しい固定に。版の無い URL・major だけの `@4`・lint の方が新しいときは黙る。warning。
  LintVersionBehind: "wcs/lint-version-behind",
  // `<wcs-route>`（またはレイアウトのテンプレート）の直下のテキストの `{{ }}`。最初に着いたルートでしか束ねられず、
  // 遷移で入ったルートでは書いたままの文字が出る（router の README「Where route content lives」— docs/seam-apps.md、
  // router-admin）。warning。
  RouteBareMustache: "wcs/route-bare-mustache",
  // 既定の `<slot>` の無いレイアウトのテンプレートに、名前付きスロットの外の中身（入れ子のルート）を渡している。
  // 中身は表示されない。ランタイムも同じ code で警告する（docs/seam-apps.md、router-admin）。warning。
  LayoutSlotMissing: "wcs/layout-slot-missing",
  // --- deprecations ---
  // 名前付き State（`<wcs-state name>` / `path@name`）。v2 でマウント（`mount=` と接頭辞付きパス）に
  // 置き換わる（docs/state-mount-design.md D16）。1.x では warning、v2 では parse error と同時に error。
  NamedStateDeprecated: "wcs/named-state-deprecated",
  // --- volume mount ---
  // ボリューム（`<wcs-state mount>`）が受け付けない宣言（@wcstack/state 4.0 の scopes/volume.ts の `REJECTED` /
  // `NOT_RUN`）。ランタイムの文面はコードを持たないので lint の code。REJECTED は接ぎ木を拒んで console.error
  // （その state は木に載らない）＝ error、NOT_RUN は console.warn で知らせてその宣言を無視する ＝ warning。
  // 宣言が静的に読めない形（class 構文）の正規表現フォールバックは 1 段下げる。REJECTED のうち、ほかの検査が
  // 自分の code で報告するもの（`$scan`・`$recursion`・`$behavior`・`$features`・旧名の `$streams` /
  // `$updatedCallback`）はここでは出さない。
  VolumeDeclaration: "wcs/volume-declaration",
  // `<wcs-state bind-component>` に `state` / `src` / `json` 属性か中の `<script type="module">` がある。マウントした
  // コンポーネントの state はホスト要素のプロパティだけで、ランタイム（scopes/component.ts の `load`）は読み込みを
  // 拒んで console.error で報告する（コンポーネントはマウントされない）＝ error。ランタイムの文面はコードを持たないので
  // lint の code。そのスクリプトはランタイムが読まないので、マウントしたコンポーネントが実行しない宣言
  // （`INERT` — `[wcs/mount-dollar-declaration]`）は HTML からは見えず、静的には出さない。
  BindComponentSource: "wcs/bind-component-source",
  // 文書（`<template>` の外）に、`mount` も `bind-component` も持たない `<wcs-state>` が 2 つ以上ある。state の木は
  // root ごとに 1 つで、ランタイムは後から読み込んだ方を拒んで console.error で報告する（v2 から。4.0 の #47 —
  // ランタイムの文面は番号だけでコードを持たないので lint の code）＝ error。2 つ目以降の開始タグに出す。
  SecondRoot: "wcs/second-root",
  // `<wcs-state mount="...">` の値が runtime の validateVolumeMountPath で raise する形
  // （空・空セグメント・ワイルドカード・予約文字 $ # @）。runtime と同条件・同文言（v2）。
  MountPathInvalid: "wcs/mount-path-invalid",
} as const;

export type WcsDiagnosticCodeValue = (typeof WcsDiagnosticCode)[keyof typeof WcsDiagnosticCode];

/**
 * 全 consumer が扱う正規化診断。start / end は生ソース上の文字オフセット
 * (CLI が line:col へ写像、IDE の LSP document が positionAt で写像)。
 */
export interface WcsDiagnostic {
  readonly code: WcsDiagnosticCodeValue;
  readonly start: number;
  readonly end: number;
  readonly message: string;
  readonly severity: WcsSeverity;
  /** 関連するカスタム要素タグ(あれば)。 */
  readonly tag?: string;
  /** 関連する member 名(observable / input / command / filter)。 */
  readonly member?: string;
  /** 関連する state path。 */
  readonly statePath?: string;
  /**
   * A finding in a state file the page loads with `src=` (core/externalState.ts): `start` / `end` are the `src`
   * value in the page — where the IDE shows it — and this is where it is in the file, which the CLI reports.
   */
  readonly origin?: WcsDiagnosticOrigin;
}

export interface WcsDiagnosticOrigin {
  /** The file, as the page names it (relative to the HTML file). */
  readonly path: string;
  /** Offsets into the file. */
  readonly start: number;
  readonly end: number;
  /** 1-based line and column of `start` and `end`. */
  readonly startPosition: LineColumn;
  readonly endPosition: LineColumn;
}

/** severity の LSP 数値(1=Error, 2=Warning, 3=Information)への写像。 */
export function severityToLsp(severity: WcsSeverity): 1 | 2 | 3 {
  if (severity === "error") return 1;
  if (severity === "warning") return 2;
  return 3;
}

/** 安定ソート: start → severity(error 優先)→ code。CLI / IDE 出力順を一致させる。 */
export function sortDiagnostics(diagnostics: readonly WcsDiagnostic[]): WcsDiagnostic[] {
  const severityRank: Record<WcsSeverity, number> = { error: 0, warning: 1, info: 2 };
  return [...diagnostics].sort((a, b) =>
    a.start - b.start
    || severityRank[a.severity] - severityRank[b.severity]
    || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}
