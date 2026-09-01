/**
 * manifest.ts — build / merge / compare the `application` sidecar artifact.
 *
 * The manifest is a **derived artifact** (D9): the TypeScript type is the source
 * of truth, `wcs-schema emit` writes the manifest, and `wcs-schema check`
 * detects drift between the two in CI. `--merge` replaces exactly one
 * `states[name].stateSchema` and keeps everything else (other states, filters,
 * listContexts) — a hand-written schema for the same state does not survive,
 * by design: there is no implicit merge in the sidecar spec (§5).
 */

import type { JsonSchemaNode } from "./typeToSchema.js";

export const APPLICATION_MANIFEST_FILENAME = "wcstack.manifest.json";
export const SCHEMA_VERSION = 1;
export const APPLICATION_NAMESPACE = "wcstack.application";

export interface ApplicationManifest {
  schemaVersion: number;
  kind: "application";
  manifestExtensions: {
    [APPLICATION_NAMESPACE]: {
      version: number;
      states?: Record<string, { stateSchema: JsonSchemaNode }>;
      [key: string]: unknown;
    };
    [namespace: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Create the manifest object for one state, or graft the state into `existing`
 * (a parsed manifest object; envelope fields are filled in when absent).
 */
export function buildManifest(stateName: string, schema: JsonSchemaNode, existing?: unknown): ApplicationManifest {
  const base: Record<string, unknown> =
    existing !== null && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  base.schemaVersion = typeof base.schemaVersion === "number" ? base.schemaVersion : SCHEMA_VERSION;
  base.kind = "application";
  const extensions =
    base.manifestExtensions !== null && typeof base.manifestExtensions === "object" && !Array.isArray(base.manifestExtensions)
      ? { ...(base.manifestExtensions as Record<string, unknown>) }
      : {};
  const nsRaw = extensions[APPLICATION_NAMESPACE];
  const ns: Record<string, unknown> =
    nsRaw !== null && typeof nsRaw === "object" && !Array.isArray(nsRaw) ? { ...(nsRaw as Record<string, unknown>) } : {};
  ns.version = typeof ns.version === "number" ? ns.version : SCHEMA_VERSION;
  const statesRaw = ns.states;
  const states: Record<string, unknown> =
    statesRaw !== null && typeof statesRaw === "object" && !Array.isArray(statesRaw) ? { ...(statesRaw as Record<string, unknown>) } : {};
  states[stateName] = { stateSchema: schema };
  ns.states = states;
  extensions[APPLICATION_NAMESPACE] = ns;
  base.manifestExtensions = extensions;
  return base as unknown as ApplicationManifest;
}

/** Read `states[name].stateSchema` from a parsed manifest object, or undefined. */
export function readStateSchema(manifest: unknown, stateName: string): unknown {
  if (manifest === null || typeof manifest !== "object") return undefined;
  const extensions = (manifest as Record<string, unknown>).manifestExtensions;
  if (extensions === null || typeof extensions !== "object") return undefined;
  const ns = (extensions as Record<string, unknown>)[APPLICATION_NAMESPACE];
  if (ns === null || typeof ns !== "object") return undefined;
  const states = (ns as Record<string, unknown>).states;
  if (states === null || typeof states !== "object") return undefined;
  const entry = (states as Record<string, unknown>)[stateName];
  if (entry === null || typeof entry !== "object") return undefined;
  return (entry as Record<string, unknown>).stateSchema;
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
  | { readonly kind: "broken"; readonly message: string };

/**
 * Compare the schema generated from the type with the one stored in `manifestText`.
 * `changes` lists JSON pointers: `+ ptr` (only in generated), `- ptr` (only in
 * manifest), `~ ptr` (both, different value).
 */
export function compareStateSchema(manifestText: string, stateName: string, generated: JsonSchemaNode): SchemaComparison {
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestText);
  } catch (e) {
    return { kind: "broken", message: (e as Error).message };
  }
  const stored = readStateSchema(parsed, stateName);
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
