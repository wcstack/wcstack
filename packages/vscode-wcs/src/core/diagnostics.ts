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
  PathReadonly: "wcs/path-readonly",
  PathReservedName: "wcs/path-reserved-name",
  PathDynamicUnknown: "wcs/path-dynamic-unknown",
  // --- existing binding-expression validators (retrofitted) ---
  FilterUnknown: "wcs/filter-unknown",
  FilterArity: "wcs/filter-arity",
  FilterArgType: "wcs/filter-arg-type",
  FilterInputType: "wcs/filter-input-type",
  BindingPathMissing: "wcs/binding-path-missing",
  BindingTypeExpectation: "wcs/binding-type-expectation",
  TokenUndeclared: "wcs/token-undeclared",
  TokenMisconfigured: "wcs/token-misconfigured",
  NestedAssign: "wcs/nested-assign",
  // --- 意味論（構文・存在検査では捕まらない取り違え。service/semanticValidator.ts） ---
  // `$getAll` / `$setAll` / `$resolve` の添字の本数がパスの `*` の本数と噛み合わない。
  // ランタイムは同じ code で raiseError する（超過は以前は黙って無視されていた）。
  IndexArity: "wcs/index-arity",
  // ワイルドカードの階数がスコープの段数を超える（`matrix.*.*` を 1 段の for で読む、
  // `$2` を 1 段のループで読む。ランタイムの #1401）。既存の「for の外」検査の深さ方向の一般化。
  // 4.0 は各段の `*` が**その段で囲む for のリスト**の行であることも確かめる（#1403・F32 — `for: a`
  // の行の中の `b.*.y` は投げる）。静的側も囲む for の一覧と段ごとに比べて同じ code で報告する。
  WildcardRank: "wcs/wildcard-rank",
  // ループの添字の範囲（`$1`〜`$128`。上限は manifest の `syntax.indexParam.maxDepth`）の外。ランタイムと同じ code:
  // for の中のマークアップの `$129`（バインディングが失敗する）と、スクリプトの `this.$0` / `this.$129` / `this.$1000`
  // （読んだ時点で throw）。error。マークアップの `$0` / `$1000` は添字の形でないので、ランタイムと同じく
  // `wcs/binding-path-missing`（ただしけっして動かないので error）。for の外の `$129` はランタイムでは #1401 なので
  // 従来どおり「for の外のループ添字」（`wcs/template-syntax`）で報告する。
  IndexParamRange: "wcs/index-param-range",
  // パス getter どうしの循環参照。ランタイムはアドレススタック上限まで再帰してから落ちる。
  GetterCycle: "wcs/getter-cycle",
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
  GetterUntrackedRead: "wcs/getter-untracked-read",
  // --- <wcs-state> script: $watch declaration ---
  // ランタイム（watch/processWatchDeclaration.ts）が raiseError で落とす宣言。
  // 越境 `@` / `$` 始まり / 空キー・空セグメント / 明らかな非関数ハンドラ。
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
  // 無いのに `**` を使った。runtime は PathInfo の不変条件として raiseError するか
  //(API 経由)、getter を黙って無視する(宣言なしの `**` getter)。
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
  // 未知メンバーへのバインド(プロパティ / command. / eventToken. キー)。黙って無視される。
  TagMemberUnknown: "wcs/tag-member-unknown",
  // タグのメンバー名が "on" で始まる（`once` 等）のに先頭ドット無しで束縛した: ランタイムはイベント束縛にして
  // "ce" イベントを待ち、値は届かない。明示のプロパティ形 `.once:` を提案する（@wcstack/state 3.1・要件 B5 / 3.x 計画 D36）
  OnPrefixedMember: "wcs/on-prefixed-member",
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
  // --- accessibility (docs/a11y-design.md §8 / D9) ---
  // `attr.aria-*` バインドの属性名が WAI-ARIA に存在しない(タイポ)。
  // setAttribute はそのまま書き、支援技術は黙って無視する。severity は warning
  // (error 昇格時は packages/lint/scripts/smoke-test.mjs の対ケース更新が必須)。
  AriaAttrUnknown: "wcs/aria-attr-unknown",
  // --- document-level load configuration ---
  // @wcstack/state/auto より後に他 wcstack /auto が読まれている。
  ScriptOrder: "wcs/script-order",
  // router/auto があるのに <base href> がない(SPA の basename 誤導出)。
  BaseHrefMissing: "wcs/base-href-missing",
  // @wcstack/signals と /dom エントリの同一ページ混在(リアクティブコア二重化)。
  SignalsDualEntry: "wcs/signals-dual-entry",
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
