/**
 * filters/filterAliases.ts — 組み込みフィルタの旧名 → 正式名（要件 B12・docs/state-3x-naming.ja.md V1〜V9）。
 *
 * 旧名は 3.x の間エイリアスとして残り、4.0 で外す（D4）。解決は登録簿（core/filterRegistry）が行い、
 * 実装・引数の個数・メタデータは正式名だけが持つ。formats の install と manifest（tooling）の両方が読むので、
 * 実装にもメタデータにも依存しない小さな表として独立させている。
 */
export const builtinFilterAliases: Readonly<Record<string, string>> = {
  inc: "add",
  dec: "sub",
  fix: "toFixed",
  uc: "upper",
  lc: "lower",
  cap: "capitalize",
  rep: "repeat",
  rev: "reverse",
  pad: "padStart",
  null: "nullIfEmpty",
};
