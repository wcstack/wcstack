/**
 * core/sidecar/schemaSubset.ts
 *
 * JSON-Schema subset(§4)の検証と、state path 解決(論点6)。
 * 許可 keyword: type / properties / required / items / enum / const / anyOf / $defs /
 * local $ref。external $ref は禁止、cycle は検出、未知 keyword は unsupported。
 *
 * 検証は 2 パス構成:
 *  1. keyword 検証 — ツリー全体($defs 含む)を 1 度だけ歩き、未知 keyword /
 *     external $ref / 未解決 $ref を報告する($ref は辿らない = 各 $def を重複なく
 *     正しい pointer で検証)。
 *  2. cycle 検出 — $ref グラフを DFS(gray/black 記憶)で辿り、循環参照のみ報告する。
 *
 * pure(DOM / vscode 非依存)。
 */

import { WcsDiagnostic, WcsDiagnosticCode } from "../diagnostics.js";
import { JsonSchemaNode } from "./types.js";
import { JsonSpan } from "./jsonSource.js";

export const ALLOWED_SCHEMA_KEYWORDS: ReadonlySet<string> = new Set([
  "type", "properties", "required", "items", "enum", "const", "anyOf", "$defs", "$ref",
]);

/** 診断の追加を span 索きと一緒に行う context。sidecar 全体で共有する。 */
export class DiagnosticContext {
  readonly diagnostics: WcsDiagnostic[] = [];
  constructor(private readonly spans: ReadonlyMap<string, JsonSpan>) {}

  add(
    code: WcsDiagnostic["code"],
    pointer: string,
    message: string,
    severity: WcsDiagnostic["severity"],
    extra: Pick<WcsDiagnostic, "tag" | "member" | "statePath"> = {},
    useKeySpan = false,
  ): void {
    const span = this.spans.get(pointer);
    const start = span === undefined ? 0 : (useKeySpan ? span.keyStart ?? span.start : span.start);
    const end = span === undefined ? 0 : (useKeySpan ? span.keyEnd ?? span.end : span.end);
    this.diagnostics.push({ code, start, end, message, severity, ...extra });
  }
}

/** schema ノード形(object)か。JsonSchemaNode 型を保つため predicate は JsonSchemaNode。 */
function isSchemaObject(value: unknown): value is JsonSchemaNode {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** name→node の map(properties / $defs)か。 */
function isSchemaMap(value: unknown): value is Record<string, JsonSchemaNode> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * schema subtree の keyword 適合性を検証する。root の $defs を ref 解決に使う。
 */
export function validateSchemaSubset(
  schema: JsonSchemaNode,
  pointerBase: string,
  ctx: DiagnosticContext,
  rootDefs: Readonly<Record<string, JsonSchemaNode>>,
): void {
  // Pass 1: keyword 検証(ref は辿らない)。
  walkKeywords(schema, pointerBase, ctx, rootDefs);
  // Pass 2: cycle 検出。root と全 $defs を起点に、safe(black)を共有して DFS。
  const safe = new Set<string>();
  detectCycles(schema, pointerBase, ctx, rootDefs, new Set(), safe);
  for (const [name, def] of Object.entries(rootDefs)) {
    detectCycles(def, `${pointerBase}/$defs/${escape(name)}`, ctx, rootDefs, new Set(), safe);
  }
}

function walkKeywords(
  node: JsonSchemaNode,
  ptr: string,
  ctx: DiagnosticContext,
  rootDefs: Readonly<Record<string, JsonSchemaNode>>,
): void {
  if (!isSchemaObject(node)) return;

  for (const keyword of Object.keys(node)) {
    if (!ALLOWED_SCHEMA_KEYWORDS.has(keyword)) {
      ctx.add(
        WcsDiagnosticCode.ManifestUnknownKeyword,
        `${ptr}/${escape(keyword)}`,
        `Unsupported schema keyword "${keyword}". Allowed: ${[...ALLOWED_SCHEMA_KEYWORDS].join(", ")}.`,
        "warning",
        {},
        true,
      );
    }
  }

  if (typeof node.$ref === "string") {
    if (!node.$ref.startsWith("#/")) {
      ctx.add(
        WcsDiagnosticCode.ManifestExternalRef,
        `${ptr}/$ref`,
        `External $ref "${node.$ref}" is forbidden; only local "#/$defs/..." references are allowed.`,
        "error",
      );
    } else if (resolveLocalRef(node.$ref, rootDefs) === undefined) {
      ctx.add(
        WcsDiagnosticCode.ManifestRefUnresolved,
        `${ptr}/$ref`,
        `Unresolved local $ref "${node.$ref}".`,
        "error",
      );
    }
    // $ref は Pass 1 では辿らない(target は $defs 直下 walk で 1 度だけ検証される)。
  }

  if (isSchemaMap(node.properties)) {
    for (const [name, child] of Object.entries(node.properties)) {
      walkKeywords(child, `${ptr}/properties/${escape(name)}`, ctx, rootDefs);
    }
  }
  if (node.items !== undefined && isSchemaObject(node.items)) {
    walkKeywords(node.items, `${ptr}/items`, ctx, rootDefs);
  }
  if (Array.isArray(node.anyOf)) {
    node.anyOf.forEach((child, i) => walkKeywords(child, `${ptr}/anyOf/${i}`, ctx, rootDefs));
  }
  if (isSchemaMap(node.$defs)) {
    for (const [name, child] of Object.entries(node.$defs)) {
      walkKeywords(child, `${ptr}/$defs/${escape(name)}`, ctx, rootDefs);
    }
  }
}

/** $ref グラフの DFS。refStack = gray(現在の経路)、safe = black(循環なしと確定)。 */
function detectCycles(
  node: JsonSchemaNode,
  ptr: string,
  ctx: DiagnosticContext,
  rootDefs: Readonly<Record<string, JsonSchemaNode>>,
  refStack: Set<string>,
  safe: Set<string>,
): void {
  if (!isSchemaObject(node)) return;

  if (typeof node.$ref === "string") {
    const ref = node.$ref;
    if (!ref.startsWith("#/")) return; // external は Pass 1 が報告済み
    if (refStack.has(ref)) {
      ctx.add(WcsDiagnosticCode.ManifestRefCycle, `${ptr}/$ref`, `Cyclic $ref detected at "${ref}".`, "error");
      return;
    }
    if (safe.has(ref)) return;
    const target = resolveLocalRef(ref, rootDefs);
    if (target === undefined) return; // 未解決は Pass 1 が報告済み
    refStack.add(ref);
    detectCycles(target, ptr, ctx, rootDefs, refStack, safe);
    refStack.delete(ref);
    safe.add(ref);
    return;
  }

  if (isSchemaMap(node.properties)) {
    for (const child of Object.values(node.properties)) detectCycles(child, ptr, ctx, rootDefs, refStack, safe);
  }
  if (node.items !== undefined && isSchemaObject(node.items)) {
    detectCycles(node.items, ptr, ctx, rootDefs, refStack, safe);
  }
  if (Array.isArray(node.anyOf)) {
    for (const child of node.anyOf) detectCycles(child, ptr, ctx, rootDefs, refStack, safe);
  }
}

/** `#/$defs/Name` を rootDefs から解決する(それ以外の local pointer は未対応)。 */
function resolveLocalRef(
  ref: string,
  rootDefs: Readonly<Record<string, JsonSchemaNode>>,
): JsonSchemaNode | undefined {
  const match = /^#\/\$defs\/(.+)$/.exec(ref);
  if (match === null) return undefined;
  const name = match[1].replace(/~1/g, "/").replace(/~0/g, "~");
  return rootDefs[name];
}

// --- path resolution (論点6) ---

export type PathResolution =
  | { readonly kind: "resolved"; readonly schema: JsonSchemaNode }
  | { readonly kind: "unknown" }
  | { readonly kind: "nonexistent"; readonly segment: string; readonly depth: number }
  | { readonly kind: "ref-error"; readonly ref: string };

/**
 * dotted / wildcard path を JSON-Schema subset root に対して解決する。
 * segments の "*" は array の items(list context)を表す。`length` は array 上で number。
 * 解決不能は kind:"nonexistent"、動的や未対応構造は kind:"unknown"(runtime を妨げない)。
 */
export function resolveSchemaPath(
  root: JsonSchemaNode,
  rootDefs: Readonly<Record<string, JsonSchemaNode>>,
  segments: readonly string[],
): PathResolution {
  let current = root;
  for (let depth = 0; depth < segments.length; depth++) {
    const segment = segments[depth];
    const resolved = derefUnion(current, rootDefs);
    if (resolved.kind === "ref-error") return resolved;
    const candidates = resolved.nodes;

    // wildcard / list index → array items
    if (segment === "*") {
      const items = firstDefined(candidates, (n) => (isSchemaObject(n.items) ? n.items : undefined));
      if (items === undefined) {
        return { kind: "unknown" };
      }
      current = items;
      continue;
    }

    // `length` は array 上で number
    if (segment === "length" && candidates.some((n) => hasType(n, "array"))) {
      current = { type: "number" };
      continue;
    }

    // property navigation(union をまたいで探す)
    const child = firstDefined(candidates, (n) => (isSchemaMap(n.properties) ? n.properties[segment] : undefined));
    if (child !== undefined) {
      current = child;
      continue;
    }

    // object だが property 未宣言 → nonexistent。object と確定できない → unknown。
    const anyObject = candidates.some((n) => hasType(n, "object") || isSchemaMap(n.properties));
    if (anyObject) {
      return { kind: "nonexistent", segment, depth };
    }
    return { kind: "unknown" };
  }
  const final = derefUnion(current, rootDefs);
  if (final.kind === "ref-error") return final;
  return { kind: "resolved", schema: final.nodes.length === 1 ? final.nodes[0] : current };
}

/**
 * $ref を辿り、anyOf を union の枝に展開する。cycle 検出は経路スコープの chain で行う
 * (兄弟 anyOf 枝が同じ $ref を指しても cycle 扱いしない)。
 */
function derefUnion(
  node: JsonSchemaNode,
  rootDefs: Readonly<Record<string, JsonSchemaNode>>,
): { kind: "ok"; nodes: JsonSchemaNode[] } | { kind: "ref-error"; ref: string } {
  const out: JsonSchemaNode[] = [];
  const stack: { node: JsonSchemaNode; chain: ReadonlySet<string> }[] = [{ node, chain: new Set() }];
  while (stack.length > 0) {
    const { node: n, chain } = stack.pop()!;
    if (typeof n.$ref === "string") {
      if (!n.$ref.startsWith("#/") || chain.has(n.$ref)) {
        return { kind: "ref-error", ref: n.$ref };
      }
      const target = resolveLocalRef(n.$ref, rootDefs);
      if (target === undefined) return { kind: "ref-error", ref: n.$ref };
      stack.push({ node: target, chain: new Set([...chain, n.$ref]) });
      continue;
    }
    if (Array.isArray(n.anyOf)) {
      for (const branch of n.anyOf) stack.push({ node: branch, chain });
      continue;
    }
    out.push(n);
  }
  return { kind: "ok", nodes: out };
}

function firstDefined<T>(nodes: readonly JsonSchemaNode[], pick: (n: JsonSchemaNode) => T | undefined): T | undefined {
  for (const n of nodes) {
    const v = pick(n);
    if (v !== undefined) return v;
  }
  return undefined;
}

function hasType(node: JsonSchemaNode, t: string): boolean {
  const type = node.type;
  if (type === undefined) return false;
  return Array.isArray(type) ? type.includes(t) : type === t;
}

function escape(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}
