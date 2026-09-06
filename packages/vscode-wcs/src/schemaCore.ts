/**
 * schemaCore.ts — `@wcstack/typescript`（`wcs-schema`）が同梱する validator core の入口。
 *
 * lint の `cli.ts` と同じ構造: esbuild が単一 CJS（`dist/schema-core.cjs`）に bundle し、
 * `packages/typescript/scripts/build.mjs` がそれをコピーする。生成器は
 * - `validateManifestArtifact` で生成物の自己検査（envelope + schema subset）
 * - `validateDocument` で「生成した stateSchema を実際に検証器に通す」end-to-end テスト
 * を行う。検査ロジックの正本は vscode-wcs（ここ）にあり、typescript 側には複製しない
 * （docs/app-testing-and-typescript-impl-plan.md §4-2-2）。
 *
 * typescript / vscode を require しない pure library だけを export すること
 * （bundle に typescript が混ざると @wcstack/typescript の zero-dependency が崩れる）。
 */

export { validateManifestArtifact } from "./core/sidecar/validate.js";
export { validateDocument } from "./core/validateDocument.js";
export type { ValidateDocumentOptions } from "./core/validateDocument.js";
export { ALLOWED_SCHEMA_KEYWORDS } from "./core/sidecar/schemaSubset.js";
export { WcsDiagnosticCode } from "./core/diagnostics.js";
export type { WcsDiagnostic } from "./core/diagnostics.js";
export type { JsonSchemaNode } from "./core/sidecar/types.js";
