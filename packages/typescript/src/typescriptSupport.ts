/**
 * typescriptSupport.ts — which `typescript` this package can run on.
 *
 * Both commands drive the JavaScript compiler API of TypeScript 5 and 6:
 * `wcs-schema` through `import ts from "typescript"`, `wcs-tsc` by running the
 * project's `typescript/lib/tsc.js` through Volar's `runTsc`. TypeScript 7 (the
 * native compiler) publishes neither — its `typescript` export is
 * `{ version, versionMajorMinor }` and its `exports` has no `./lib/tsc` — so both
 * refuse it by name instead of failing on what is missing. TypeScript 7 reads other
 * file types through content mappers (7.1); this package does not provide one yet.
 */

/** The version, when it is one neither command can run on (7 and later); otherwise `undefined`. */
export function unsupportedTypeScript(version: string | undefined): string | undefined {
  return Number.parseInt(version ?? "", 10) >= 7 ? version : undefined;
}

/** The refusal both commands report (exit code 2), without a trailing newline. */
export function unsupportedTypeScriptMessage(version: string): string {
  return `@wcstack/typescript runs on TypeScript 5 or 6, and the project has TypeScript ${version}, which has no JavaScript compiler API: npm i -D typescript@6`;
}
