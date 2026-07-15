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
  TypeAnnotation: "wcs/type-annotation",
  TemplateSyntax: "wcs/template-syntax",
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
