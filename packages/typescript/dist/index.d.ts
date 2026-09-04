import ts from 'typescript';

/**
 * program.ts — open a state file with the TypeScript compiler API and locate the
 * type of its `export default`.
 *
 * `defineState(x)` is an identity function, so the exported type is `x`'s type —
 * but the call is unwrapped syntactically anyway: when `@wcstack/state` is not
 * resolvable from the state file (a CDN-only page, a fixture in a temp dir), the
 * call expression would type as `any` and every path would be lost, while the
 * argument literal still carries the full object type.
 */

interface LoadStateOptions {
    /** Explicit tsconfig.json path. Default: the nearest tsconfig.json above the state file, else built-in defaults. */
    readonly tsconfig?: string;
}
interface LoadedState {
    readonly program: ts.Program;
    readonly checker: ts.TypeChecker;
    readonly sourceFile: ts.SourceFile;
    /** The type of the default export (the `defineState(...)` argument when wrapped). */
    readonly type: ts.Type;
    /** Node to use as the location for `getTypeOfSymbolAtLocation`. */
    readonly location: ts.Node;
    /** Non-fatal notes for the caller (e.g. the state type resolved to `any`). */
    readonly warnings: readonly string[];
}
/** Defaults used when no tsconfig.json is found — enough to type a plain state file. */
declare const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions;
declare function resolveCompilerOptions(stateFile: string, options?: LoadStateOptions): ts.CompilerOptions;
declare function loadStateFile(file: string, options?: LoadStateOptions): LoadedState;

/**
 * typeToSchema.ts — TypeScript type → `stateSchema` (the JSON-Schema subset of
 * docs/wcstack-manifest-schema.md §4: type / properties / required / items /
 * enum / const / anyOf only).
 *
 * Rules (docs/app-testing-and-typescript-impl-plan.md §4-2-2):
 * - `$`-prefixed keys are dropped (runtime namespaces, never data paths).
 * - Members with call signatures (methods, function-valued properties) are dropped.
 * - Getters contribute their return type. Path getters (`get "users.*.ageCategory"()`)
 *   are injected at the path they compute, so the validator sees them as members.
 * - Arrays → `items`; unions split `null` out into `anyOf`; literal unions → `enum`.
 * - Built-in / library object types (`Date`, `Map`, DOM types, …) become a **bare `{}`**
 *   — never `{ "type": "object" }`: the validator treats a bare `{}` as *unknown*
 *   (silent) and a typed object without the member as *nonexistent* (error).
 * - Nesting stops at `maxDepth` (default 5 = the validator's candidate budget) with a bare `{}`.
 */

interface JsonSchemaNode {
    type?: string;
    properties?: Record<string, JsonSchemaNode>;
    required?: string[];
    items?: JsonSchemaNode;
    enum?: unknown[];
    const?: unknown;
    anyOf?: JsonSchemaNode[];
}
declare const DEFAULT_MAX_DEPTH = 5;
interface SchemaOptions {
    /** Object nesting depth at which a bare `{}` is emitted instead of descending. Default 5. */
    readonly maxDepth?: number;
}
/**
 * Convert the type of a state object into a `stateSchema` node.
 */
declare function stateTypeToSchema(checker: ts.TypeChecker, program: ts.Program, type: ts.Type, location: ts.Node, options?: SchemaOptions): JsonSchemaNode;

/**
 * generate.ts — one call from a state file to its `stateSchema`.
 */

interface GenerateOptions extends LoadStateOptions, SchemaOptions {
}
interface GeneratedSchema {
    readonly schema: JsonSchemaNode;
    /** Non-fatal notes (e.g. the state type resolved to `any`). */
    readonly warnings: readonly string[];
}
declare function generateStateSchema(file: string, options?: GenerateOptions): GeneratedSchema;

/**
 * manifest.ts — build / merge / compare the `application` sidecar artifact.
 *
 * The manifest is a **derived artifact** (D9): the TypeScript type is the source
 * of truth, `wcs-schema emit` writes the manifest, and `wcs-schema check`
 * detects drift between the two in CI.
 *
 * v2 (schemaVersion 2): the application namespace carries a **single**
 * `stateSchema` — one state tree per root, no name dimension
 * (docs/state-mount-design.md D15). A volume (`<wcs-state mount="path">`)
 * contributes a **subtree**: `--mount=<path>` merges the module's schema under
 * that path inside the single `stateSchema`. `--merge` keeps everything else in
 * an existing manifest (filters, listContexts); a hand-written schema for the
 * same slot does not survive, by design: there is no implicit merge in the
 * sidecar spec (§5).
 */

declare const APPLICATION_MANIFEST_FILENAME = "wcstack.manifest.json";
declare const SCHEMA_VERSION = 2;
declare const APPLICATION_NAMESPACE = "wcstack.application";
interface ApplicationManifest {
    schemaVersion: number;
    kind: "application";
    manifestExtensions: {
        [APPLICATION_NAMESPACE]: {
            version: number;
            stateSchema?: JsonSchemaNode;
            [key: string]: unknown;
        };
        [namespace: string]: unknown;
    };
    [key: string]: unknown;
}
/**
 * Create the manifest object for the state tree, or graft into `existing`
 * (a parsed manifest object; envelope fields are normalized to v2 — a v1
 * manifest's `states` map does not survive, its replacement is exactly this
 * regeneration path).
 *
 * `mountPath === null` replaces the whole `stateSchema`; a mount path merges
 * the schema as a subtree at that path (intermediate object nodes are created).
 */
declare function buildManifest(mountPath: string | null, schema: JsonSchemaNode, existing?: unknown): ApplicationManifest;
/** Read the single `stateSchema` from a parsed manifest object, or undefined. */
declare function readStateSchema(manifest: unknown): unknown;
/** JSON with object keys sorted at every level — the canonical form used for comparison. */
declare function stableStringify(value: unknown): string;
type SchemaComparison = {
    readonly kind: "same";
} | {
    readonly kind: "differs";
    readonly changes: readonly string[];
} | {
    readonly kind: "missing-state";
} | {
    readonly kind: "v1-manifest";
} | {
    readonly kind: "broken";
    readonly message: string;
};
/**
 * Compare the schema generated from the type with the one stored in `manifestText`
 * (the whole tree, or the subtree at `mountPath`).
 * `changes` lists JSON pointers: `+ ptr` (only in generated), `- ptr` (only in
 * manifest), `~ ptr` (both, different value).
 */
declare function compareStateSchema(manifestText: string, mountPath: string | null, generated: JsonSchemaNode): SchemaComparison;

/**
 * schemaCore.ts — the validator core bundle (`dist/schema-core.cjs`, built from
 * packages/vscode-wcs by scripts/build-schema-core.mjs), loaded lazily.
 *
 * The bundle is a self-contained CJS file that requires neither `typescript` nor
 * `vscode`; it is located relative to the running module so the same loader
 * works from `dist/index.esm.js`, `dist/wcs-schema.mjs`, and the TypeScript
 * sources under vitest (`src/…` → `../dist`).
 */
interface WcsDiagnostic {
    readonly code: string;
    readonly start: number;
    readonly end: number;
    readonly message: string;
    readonly severity: "error" | "warning" | "info";
}
interface SchemaCore {
    validateManifestArtifact(artifact: {
        text: string;
        source: string;
    }): WcsDiagnostic[];
    validateDocument(text: string, options?: {
        bindAttribute?: string;
        stateTagName?: string;
        locale?: string;
        fileReader?: (relativePath: string) => string | undefined;
        applicationStates?: ReadonlyMap<string, unknown>;
    }): WcsDiagnostic[];
    ALLOWED_SCHEMA_KEYWORDS: ReadonlySet<string>;
    WcsDiagnosticCode: Readonly<Record<string, string>>;
}
/** Candidate locations, nearest first: dist/ (built), ../dist (src/), ../../dist (src/cli/). */
declare function schemaCoreCandidates(fromUrl?: string): string[];
declare function loadSchemaCore(): SchemaCore;

declare const VERSION: string;

export { APPLICATION_MANIFEST_FILENAME, APPLICATION_NAMESPACE, DEFAULT_COMPILER_OPTIONS, DEFAULT_MAX_DEPTH, SCHEMA_VERSION, VERSION, buildManifest, compareStateSchema, generateStateSchema, loadSchemaCore, loadStateFile, readStateSchema, resolveCompilerOptions, schemaCoreCandidates, stableStringify, stateTypeToSchema };
export type { ApplicationManifest, GenerateOptions, GeneratedSchema, JsonSchemaNode, LoadStateOptions, LoadedState, SchemaComparison, SchemaCore, SchemaOptions, WcsDiagnostic };
