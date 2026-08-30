/**
 * tscCore.ts — `@wcstack/typescript`（`wcs-tsc`）が同梱する Language Plugin の入口。
 *
 * `wcs-tsc` は `@volar/typescript` の `runTsc`（vue-tsc と同じ仕組み）に、Language
 * Server と**同じ** `createWcsLanguagePlugin` を渡して `.html` を tsc に読ませる。
 * プラグインの正本は vscode-wcs（ここ）にあり、typescript 側には複製しない —
 * IDE と CI で同じ仮想コード（プリアンブル・defineState ラップ・import 剥がし）を
 * 使うことがパリティの前提（docs/typescript.md §4）。
 *
 * esbuild が単一 CJS（`dist/tsc-core.cjs`）に bundle し、
 * `packages/typescript/scripts/build-schema-core.mjs` がコピーする。
 * `@volar/*` と `typescript` は型 import のみ（runtime 依存なし）。
 */

export { createWcsLanguagePlugin, stripWcsImport } from "./language/plugin.js";
export { WCS_PREAMBLE, WCS_PREAMBLE_LENGTH } from "./language/preamble.js";
