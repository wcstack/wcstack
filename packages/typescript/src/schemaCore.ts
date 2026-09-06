/**
 * schemaCore.ts — the validator core bundle (`dist/schema-core.cjs`, built from
 * packages/vscode-wcs by scripts/build-schema-core.mjs), loaded lazily.
 *
 * The bundle is a self-contained CJS file that requires neither `typescript` nor
 * `vscode`; it is located relative to the running module so the same loader
 * works from `dist/index.esm.js`, `dist/wcs-schema.mjs`, and the TypeScript
 * sources under vitest (`src/…` → `../dist`).
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface WcsDiagnostic {
  readonly code: string;
  readonly start: number;
  readonly end: number;
  readonly message: string;
  readonly severity: "error" | "warning" | "info";
}

export interface SchemaCore {
  validateManifestArtifact(artifact: { text: string; source: string }): WcsDiagnostic[];
  validateDocument(
    text: string,
    options?: {
      bindAttribute?: string;
      stateTagName?: string;
      locale?: string;
      fileReader?: (relativePath: string) => string | undefined;
      applicationStates?: ReadonlyMap<string, unknown>;
    },
  ): WcsDiagnostic[];
  ALLOWED_SCHEMA_KEYWORDS: ReadonlySet<string>;
  WcsDiagnosticCode: Readonly<Record<string, string>>;
}

const BUNDLE = "schema-core.cjs";

/** Candidate locations, nearest first: dist/ (built), ../dist (src/), ../../dist (src/cli/). */
export function schemaCoreCandidates(fromUrl: string = import.meta.url): string[] {
  const here = dirname(fileURLToPath(fromUrl));
  return [join(here, BUNDLE), join(here, "..", "dist", BUNDLE), join(here, "..", "..", "dist", BUNDLE)];
}

let cached: SchemaCore | undefined;

export function loadSchemaCore(): SchemaCore {
  if (cached !== undefined) return cached;
  const candidates = schemaCoreCandidates();
  const found = candidates.find((p) => existsSync(p));
  /* v8 ignore next 5 -- tests run after `npm run build`, so the bundle is always present */
  if (found === undefined) {
    throw new Error(
      `${BUNDLE} not found — run \`npm run build\` in packages/typescript (looked in: ${candidates.join(", ")})`,
    );
  }
  cached = createRequire(import.meta.url)(found) as SchemaCore;
  return cached;
}
