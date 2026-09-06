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
  // `$2` を 1 段のループで読む）。既存の「for の外」検査の深さ方向の一般化。
  WildcardRank: "wcs/wildcard-rank",
  // パス getter どうしの循環参照。ランタイムはアドレススタック上限まで再帰してから落ちる。
  GetterCycle: "wcs/getter-cycle",
  // `$updatedCallback` が、どのバインディングにも現れないパスを判定に使っている。
  // 同コールバックは **binding 駆動**（live binding が適用された path しか報告しない）
  // なので、その分岐は一度も実行されない。表示要素が購読の実体になる事故
  // （examples/state-intersect-scroll の README に記録）の静的検出。
  UpdatedCallbackUnbound: "wcs/updated-callback-unbound",
  // --- <wcs-state> script: $watch declaration ---
  // ランタイム（watch/processWatchDeclaration.ts）が raiseError で落とす宣言。
  // 越境 `@` / `$` 始まり / 空キー・空セグメント / 明らかな非関数ハンドラ。
  WatchDeclarationInvalid: "wcs/watch-declaration-invalid",
  // `$watch` のキーが状態定義に存在しない。バインディング側と違い黙って発火しない
  // だけなので気づけない。severity は binding-path-missing に揃える（warning）。
  WatchPathMissing: "wcs/watch-path-missing",
  TypeAnnotation: "wcs/type-annotation",
  TemplateSyntax: "wcs/template-syntax",
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
