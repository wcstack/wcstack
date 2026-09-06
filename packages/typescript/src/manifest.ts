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

import type { JsonSchemaNode } from "./typeToSchema.js";

export const APPLICATION_MANIFEST_FILENAME = "wcstack.manifest.json";
export const SCHEMA_VERSION = 2;
export const APPLICATION_NAMESPACE = "wcstack.application";

export interface ApplicationManifest {
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
export function buildManifest(mountPath: string | null, schema: JsonSchemaNode, existing?: unknown): ApplicationManifest {
  const base: Record<string, unknown> =
    existing !== null && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  base.schemaVersion = SCHEMA_VERSION;
  base.kind = "application";
  const extensions =
    base.manifestExtensions !== null && typeof base.manifestExtensions === "object" && !Array.isArray(base.manifestExtensions)
      ? { ...(base.manifestExtensions as Record<string, unknown>) }
      : {};
  const nsRaw = extensions[APPLICATION_NAMESPACE];
  const ns: Record<string, unknown> =
    nsRaw !== null && typeof nsRaw === "object" && !Array.isArray(nsRaw) ? { ...(nsRaw as Record<string, unknown>) } : {};
  ns.version = SCHEMA_VERSION;
  // v1 leftovers: the name dimension is gone; regeneration does not carry it
  delete ns.states;
  if (mountPath === null) {
    ns.stateSchema = schema;
  } else {
    const rootRaw = ns.stateSchema;
    const root: Record<string, unknown> =
      rootRaw !== null && typeof rootRaw === "object" && !Array.isArray(rootRaw)
        ? { ...(rootRaw as Record<string, unknown>) }
        : { type: "object" };
    let node = root;
    const segments = mountPath.split(".");
    for (let i = 0; i < segments.length; i++) {
      const properties =
        node.properties !== null && typeof node.properties === "object" && !Array.isArray(node.properties)
          ? { ...(node.properties as Record<string, unknown>) }
          : {};
      node.properties = properties;
      if (i === segments.length - 1) {
        properties[segments[i]] = schema;
        break;
      }
      const childRaw = properties[segments[i]];
      const child: Record<string, unknown> =
        childRaw !== null && typeof childRaw === "object" && !Array.isArray(childRaw)
          ? { ...(childRaw as Record<string, unknown>) }
          : { type: "object" };
      properties[segments[i]] = child;
      node = child;
    }
    ns.stateSchema = root as unknown as JsonSchemaNode;
  }
  extensions[APPLICATION_NAMESPACE] = ns;
  base.manifestExtensions = extensions;
  return base as unknown as ApplicationManifest;
}

/** Read the single `stateSchema` from a parsed manifest object, or undefined. */
export function readStateSchema(manifest: unknown): unknown {
  if (manifest === null || typeof manifest !== "object") return undefined;
  const extensions = (manifest as Record<string, unknown>).manifestExtensions;
  if (extensions === null || typeof extensions !== "object") return undefined;
  const ns = (extensions as Record<string, unknown>)[APPLICATION_NAMESPACE];
  if (ns === null || typeof ns !== "object") return undefined;
  return (ns as Record<string, unknown>).stateSchema;
}

/**
 * True for a v1-shaped manifest (`schemaVersion: 1` or a `states` map in the
 * application namespace). `check` uses it to point at the regeneration path
 * instead of reporting a confusing "missing stateSchema".
 */
export function isV1Manifest(manifest: unknown): boolean {
  if (manifest === null || typeof manifest !== "object") return false;
  if ((manifest as Record<string, unknown>).schemaVersion === 1) return true;
  const extensions = (manifest as Record<string, unknown>).manifestExtensions;
  if (extensions === null || typeof extensions !== "object") return false;
  const ns = (extensions as Record<string, unknown>)[APPLICATION_NAMESPACE];
  if (ns === null || typeof ns !== "object") return false;
  return (ns as Record<string, unknown>).states !== undefined;
}

/** Navigate `properties` by mount-path segments; undefined when the subtree is absent. */
function subtreeAt(schema: unknown, mountPath: string): unknown {
  let node: unknown = schema;
  for (const segment of mountPath.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    const properties = (node as Record<string, unknown>).properties;
    if (properties === null || typeof properties !== "object") return undefined;
    node = (properties as Record<string, unknown>)[segment];
  }
  return node;
}

/** JSON with object keys sorted at every level — the canonical form used for comparison. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export type SchemaComparison =
  | { readonly kind: "same" }
  | { readonly kind: "differs"; readonly changes: readonly string[] }
  | { readonly kind: "missing-state" }
  | { readonly kind: "v1-manifest" }
  | { readonly kind: "broken"; readonly message: string };

/**
 * Compare the schema generated from the type with the one stored in `manifestText`
 * (the whole tree, or the subtree at `mountPath`).
 * `changes` lists JSON pointers: `+ ptr` (only in generated), `- ptr` (only in
 * manifest), `~ ptr` (both, different value).
 */
export function compareStateSchema(manifestText: string, mountPath: string | null, generated: JsonSchemaNode): SchemaComparison {
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestText);
  } catch (e) {
    return { kind: "broken", message: (e as Error).message };
  }
  if (isV1Manifest(parsed)) return { kind: "v1-manifest" };
  let stored = readStateSchema(parsed);
  if (stored !== undefined && mountPath !== null) {
    stored = subtreeAt(stored, mountPath);
  }
  if (stored === undefined) return { kind: "missing-state" };
  if (stableStringify(stored) === stableStringify(generated)) return { kind: "same" };

  const a = flatten(generated);
  const b = flatten(stored);
  const changes: string[] = [];
  for (const key of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const inA = a.has(key);
    const inB = b.has(key);
    if (inA && !inB) changes.push(`+ ${key}`);
    else if (!inA && inB) changes.push(`- ${key}`);
    else if (a.get(key) !== b.get(key)) changes.push(`~ ${key}`);
  }
  return { kind: "differs", changes };
}

/** Leaf pointer → canonical JSON. Objects with children are not listed themselves; empty objects/arrays are leaves. */
function flatten(value: unknown, pointer: string = "", out: Map<string, string> = new Map()): Map<string, string> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      out.set(pointer || "/", "{}");
      return out;
    }
    for (const [key, child] of entries) {
      flatten(child, `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, out);
    }
    return out;
  }
  out.set(pointer || "/", stableStringify(value));
  return out;
}
