/**
 * typescriptSupport.ts — which `typescript` this package can run on.
 *
 * TypeScript 5 and 6 publish a JavaScript compiler API: `wcs-schema` (and
 * `loadStateFile`) read state files through `import ts from "typescript"`, and
 * `wcs-tsc` runs the project's `typescript/lib/tsc.js` through Volar's `runTsc`.
 * TypeScript 7 (the native compiler) publishes neither — its `typescript` export is
 * `{ version, versionMajorMinor }` and its `exports` has no `./lib/tsc`. From 7.1 it
 * reads other file types through content mappers, and this package is one
 * (`typescript.contentMapper` in its package.json, docs/typescript-content-mapper.md):
 * `wcs-tsc` runs the project's `tsc` with it. 7.0 has neither, and `wcs-schema` has
 * no 7 path yet; both refuse by name instead of failing on what is missing.
 */

/** How `wcs-tsc` runs on a TypeScript version. An unreadable version is taken as the API's. */
export type TypeScriptSupport = "api" | "content-mapper" | "unsupported";

export function typeScriptSupport(version: string | undefined): TypeScriptSupport {
  const match = /^(\d+)\.(\d+)/.exec(version ?? "");
  if (match === null) return "api";
  const major = Number(match[1]);
  if (major < 7) return "api";
  return major === 7 && Number(match[2]) === 0 ? "unsupported" : "content-mapper";
}

/** `wcs-tsc`'s refusal of TypeScript 7.0 (exit code 2), without a trailing newline. */
export function unsupportedTscMessage(version: string): string {
  return `the project has TypeScript ${version}, which has neither a JavaScript compiler API nor content mappers; wcs-tsc needs TypeScript 5 or 6, or 7.1 and later: npm i -D typescript@^7.1 (or typescript@6)`;
}

/** The version, when `wcs-schema` / `loadStateFile` cannot run on it (7 and later); otherwise `undefined`. */
export function unsupportedTypeScript(version: string | undefined): string | undefined {
  return Number.parseInt(version ?? "", 10) >= 7 ? version : undefined;
}

/** The refusal `wcs-schema` and `loadStateFile` report (exit code 2), without a trailing newline. */
export function unsupportedTypeScriptMessage(version: string): string {
  return `@wcstack/typescript reads state files with the JavaScript compiler API of TypeScript 5 or 6, and the project has TypeScript ${version}, which has none: npm i -D typescript@6`;
}
