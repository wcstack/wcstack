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
 *
 * `stateSource` (4.26) names the file the root schema was generated from, relative
 * to the manifest's directory with forward slashes: the validator applies the
 * schema only to a page whose root `<wcs-state src>` is that file (`.js` / `.ts`
 * of the same path count as the same), so one manifest at the root serves an app
 * whose other pages have states of their own.
 *
 * `stateMounts` (4.28) lists the mount paths written with `--mount`: the tree is the
 * root's type plus those subtrees, each generated from a file of its own. The root's
 * `check` compares the tree without them, and a root `emit` into an existing manifest
 * keeps them — without the list, `check <root>` reported every volume's key as drift,
 * and the `emit --merge` it suggested dropped the volumes (docs/seam-apps.md, garden-plots).
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
      /** The root state file the schema comes from, relative to the manifest's directory. */
      stateSource?: string;
      /** The mount paths whose subtrees were written with `--mount` (each from a volume's own file). */
      stateMounts?: string[];
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
 *
 * `stateSource` is recorded with the root schema: given, it replaces the one in
 * `existing`; omitted, the root schema's source is unknown and an old
 * `stateSource` is dropped (it named the file of the schema being replaced).
 * A volume's schema (`mountPath` set) leaves `stateSource` as it is, and is recorded in
 * `stateMounts`; a root schema written into `existing` keeps the recorded mounts' subtrees.
 */
export function buildManifest(mountPath: string | null, schema: JsonSchemaNode, existing?: unknown, stateSource?: string): ApplicationManifest {
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
  const mounts = readStateMounts(ns);
  if (mountPath === null) {
    // the root's slot is the tree without the volumes: their subtrees are carried over
    let tree: unknown = schema;
    for (const path of mounts) {
      const subtree = subtreeAt(ns.stateSchema, path);
      if (subtree !== undefined) tree = graft(tree, path, subtree);
    }
    ns.stateSchema = tree as JsonSchemaNode;
    if (stateSource === undefined) delete ns.stateSource;
    else ns.stateSource = stateSource;
  } else {
    ns.stateSchema = graft(ns.stateSchema, mountPath, schema) as JsonSchemaNode;
    ns.stateMounts = [...new Set([...mounts, mountPath])].sort();
  }
  extensions[APPLICATION_NAMESPACE] = ns;
  base.manifestExtensions = extensions;
  return base as unknown as ApplicationManifest;
}

/** `tree` with `subtree` at `mountPath` (the nodes on the way are copied, or created as objects). */
function graft(tree: unknown, mountPath: string, subtree: unknown): Record<string, unknown> {
  const root: Record<string, unknown> =
    tree !== null && typeof tree === "object" && !Array.isArray(tree)
      ? { ...(tree as Record<string, unknown>) }
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
      properties[segments[i]] = subtree;
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
  return root;
}

/** The mount paths recorded in an application namespace (strings only). */
function readStateMounts(ns: Record<string, unknown> | undefined): string[] {
  const mounts = ns?.stateMounts;
  return Array.isArray(mounts) ? mounts.filter((path): path is string => typeof path === "string" && path !== "") : [];
}

/**
 * `tree` without the subtree at `mountPath`, and without the object nodes the graft created on
 * the way to it (an object with no property left and nothing else said about it).
 */
function prune(tree: unknown, segments: readonly string[]): unknown {
  if (tree === null || typeof tree !== "object" || Array.isArray(tree)) return tree;
  const node = tree as Record<string, unknown>;
  const properties = node.properties;
  if (properties === null || typeof properties !== "object" || Array.isArray(properties) || !(segments[0] in properties)) return tree;
  const rest: Record<string, unknown> = { ...(properties as Record<string, unknown>) };
  if (segments.length === 1) delete rest[segments[0]];
  else {
    const child = prune(rest[segments[0]], segments.slice(1));
    if (stableStringify(child) === '{"properties":{},"type":"object"}') delete rest[segments[0]];
    else rest[segments[0]] = child;
  }
  return { ...node, properties: rest };
}

function applicationNamespace(manifest: unknown): Record<string, unknown> | undefined {
  if (manifest === null || typeof manifest !== "object") return undefined;
  const extensions = (manifest as Record<string, unknown>).manifestExtensions;
  if (extensions === null || typeof extensions !== "object") return undefined;
  const ns = (extensions as Record<string, unknown>)[APPLICATION_NAMESPACE];
  if (ns === null || typeof ns !== "object") return undefined;
  return ns as Record<string, unknown>;
}

/** Read the single `stateSchema` from a parsed manifest object, or undefined. */
export function readStateSchema(manifest: unknown): unknown {
  return applicationNamespace(manifest)?.stateSchema;
}

/** Read the `stateSource` (a string) from a parsed manifest object, or undefined. */
export function readStateSource(manifest: unknown): string | undefined {
  const source = applicationNamespace(manifest)?.stateSource;
  return typeof source === "string" ? source : undefined;
}

/**
 * True when two `stateSource` paths name the same state file: separators and a
 * leading `./` aside, `.js` and `.ts` (and `.mjs` and `.mts`) of one path are the
 * same file — a page loads the built `.js` of the `.ts` the schema came from.
 */
export function sameStateSource(a: string, b: string): boolean {
  const key = (path: string): string => path.replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\.(m?)ts$/, ".$1js");
  return key(a) === key(b);
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

/**
 * The canonical form used for comparison: JSON with object keys sorted at every level, and the members of an
 * `enum` or an `anyOf` — sets in JSON Schema — in a fixed order. TypeScript lists a union's members in the order
 * it first made their types, so an edit elsewhere in the state file reordered an `enum` with the same values,
 * and `check` reported a schema that had not changed (the Advent Calendar's record, docs/v4-direction-2026-10.md
 * §5.27). `emit` writes them in that order too; a manifest written by an earlier emit still compares equal.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

const SET_KEYWORDS = new Set(["enum", "anyOf"]);

function sortKeys(value: unknown, set = false): unknown {
  if (Array.isArray(value)) {
    const members = value.map((member) => sortKeys(member));
    if (!set) return members;
    return members
      .map((member) => [JSON.stringify(member), member] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, member]) => member);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key], SET_KEYWORDS.has(key));
    }
    return out;
  }
  return value;
}

export type SchemaComparison =
  | { readonly kind: "same" }
  | {
      readonly kind: "differs";
      /** Schema changes; empty when only `stateSource` differs. */
      readonly changes: readonly string[];
      /** The manifest names another root state file than the one the schema was generated from. */
      readonly stateSource?: { readonly stored: string; readonly expected: string };
    }
  | { readonly kind: "missing-state" }
  | { readonly kind: "v1-manifest" }
  | { readonly kind: "broken"; readonly message: string };

/**
 * Compare the schema generated from the type with the one stored in `manifestText`
 * (the whole tree, or the subtree at `mountPath`).
 * `changes` lists JSON pointers: `+ ptr` (only in generated), `- ptr` (only in
 * manifest), `~ ptr` (both, different value).
 *
 * `stateSource` (the root state file, relative to the manifest's directory) is
 * compared too, for the root tree: a manifest that names another file is drift —
 * the validator would apply the schema to the pages of that file, not of this one.
 * A manifest without `stateSource` (written before 4.26) is not.
 *
 * The root tree is compared without the subtrees `stateMounts` records.
 */
export function compareStateSchema(manifestText: string, mountPath: string | null, generated: JsonSchemaNode, stateSource?: string): SchemaComparison {
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
  } else if (stored !== undefined) {
    // the root's type does not have the volumes: each is checked with its own `--mount`
    for (const path of readStateMounts(applicationNamespace(parsed))) stored = prune(stored, path.split("."));
  }
  if (stored === undefined) return { kind: "missing-state" };
  const storedSource = mountPath === null && stateSource !== undefined ? readStateSource(parsed) : undefined;
  const sourceDiff = storedSource !== undefined && !sameStateSource(storedSource, stateSource!)
    ? { stored: storedSource, expected: stateSource! }
    : undefined;
  const source = sourceDiff === undefined ? {} : { stateSource: sourceDiff };
  if (stableStringify(stored) === stableStringify(generated)) {
    return sourceDiff === undefined ? { kind: "same" } : { kind: "differs", changes: [], stateSource: sourceDiff };
  }

  // (in the canonical form: an `enum` or `anyOf` in another order is not listed as a change)
  const a = flatten(sortKeys(generated));
  const b = flatten(sortKeys(stored));
  const changes: string[] = [];
  for (const key of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const inA = a.has(key);
    const inB = b.has(key);
    if (inA && !inB) changes.push(`+ ${key}`);
    else if (!inA && inB) changes.push(`- ${key}`);
    else if (a.get(key) !== b.get(key)) changes.push(`~ ${key}`);
  }
  return { kind: "differs", changes, ...source };
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
