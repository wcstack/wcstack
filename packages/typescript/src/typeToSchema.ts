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

import ts from "typescript";

export interface JsonSchemaNode {
  type?: string;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchemaNode[];
}

export const DEFAULT_MAX_DEPTH = 5;

export interface SchemaOptions {
  /** Object nesting depth at which a bare `{}` is emitted instead of descending. Default 5. */
  readonly maxDepth?: number;
}

interface Context {
  readonly checker: ts.TypeChecker;
  readonly program: ts.Program;
  readonly location: ts.Node;
  readonly maxDepth: number;
  /** Object types currently being expanded (recursion guard). */
  readonly stack: Set<ts.Type>;
  /** Path getters found on the root object, injected after the tree is built. */
  readonly pathGetters: Array<{ segments: string[]; type: ts.Type }>;
}

/**
 * Convert the type of a state object into a `stateSchema` node.
 */
export function stateTypeToSchema(
  checker: ts.TypeChecker,
  program: ts.Program,
  type: ts.Type,
  location: ts.Node,
  options: SchemaOptions = {},
): JsonSchemaNode {
  const ctx: Context = {
    checker,
    program,
    location,
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    stack: new Set(),
    pathGetters: [],
  };
  const root = convertType(type, 0, ctx, true);
  for (const getter of ctx.pathGetters) {
    injectPath(root, getter.segments, convertType(getter.type, getter.segments.length, ctx, false));
  }
  return root;
}

function convertType(type: ts.Type, depth: number, ctx: Context, isRoot: boolean): JsonSchemaNode {
  const flags = type.flags;
  if (flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.TypeParameter | ts.TypeFlags.NonPrimitive)) {
    return {};
  }
  if (flags & ts.TypeFlags.Null) return { type: "null" };
  if (flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) return {};
  if (flags & ts.TypeFlags.Boolean) return { type: "boolean" };
  if (flags & ts.TypeFlags.BooleanLiteral) return { type: "boolean", const: literalValue(type, ctx) };
  if (flags & ts.TypeFlags.StringLiteral) return { type: "string", const: (type as ts.StringLiteralType).value };
  if (flags & ts.TypeFlags.NumberLiteral) return { type: "number", const: (type as ts.NumberLiteralType).value };
  if (flags & (ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral | ts.TypeFlags.ESSymbolLike)) return {};
  if (flags & ts.TypeFlags.String) return { type: "string" };
  if (flags & ts.TypeFlags.Number) return { type: "number" };
  if (type.isUnion()) return convertUnion(type, depth, ctx);

  if (ctx.checker.isArrayType(type) || ctx.checker.isTupleType(type)) {
    return convertArray(type as ts.TypeReference, depth, ctx);
  }

  const callable = type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0;
  if (callable && ctx.checker.getPropertiesOfType(type).length === 0) return {};

  const symbol = type.getSymbol() ?? type.aliasSymbol;
  if (symbol !== undefined && isLibrarySymbol(symbol, ctx)) return {};

  return convertObject(type, depth, ctx, isRoot);
}

function convertUnion(type: ts.UnionType, depth: number, ctx: Context): JsonSchemaNode {
  const members = type.types.filter((t) => (t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) === 0);
  const hasNull = members.some((t) => (t.flags & ts.TypeFlags.Null) !== 0);
  const nonNull = members.filter((t) => (t.flags & ts.TypeFlags.Null) === 0);

  let node: JsonSchemaNode;
  if (nonNull.length === 0) {
    return { type: "null" };
  } else if (nonNull.every((t) => (t.flags & ts.TypeFlags.BooleanLiteral) !== 0) && nonNull.length === 2) {
    node = { type: "boolean" };
  } else if (nonNull.every((t) => t.isLiteral() || (t.flags & ts.TypeFlags.BooleanLiteral) !== 0)) {
    const values = nonNull.map((t) => literalValue(t, ctx));
    const kinds = [...new Set(values.map((v) => typeof v))];
    node = kinds.length === 1 && (kinds[0] === "string" || kinds[0] === "number" || kinds[0] === "boolean")
      ? { type: kinds[0], enum: values }
      : { enum: values };
  } else if (nonNull.length === 1) {
    node = convertType(nonNull[0], depth, ctx, false);
  } else {
    const converted = dedupeNodes(nonNull.map((t) => convertType(t, depth, ctx, false)));
    node = converted.length === 1 ? converted[0] : { anyOf: converted };
  }

  if (!hasNull) return node;
  if (node.type === "null") return node;
  return node.anyOf !== undefined ? { anyOf: [...node.anyOf, { type: "null" }] } : { anyOf: [node, { type: "null" }] };
}

function convertArray(type: ts.TypeReference, depth: number, ctx: Context): JsonSchemaNode {
  const args = ctx.checker.getTypeArguments(type);
  if (args.length === 0) return { type: "array", items: {} };
  if (ctx.checker.isTupleType(type)) {
    const converted = dedupeNodes(args.map((t) => convertType(t, depth, ctx, false)));
    return { type: "array", items: converted.length === 1 ? converted[0] : { anyOf: converted } };
  }
  return { type: "array", items: convertType(args[0], depth, ctx, false) };
}

function convertObject(type: ts.Type, depth: number, ctx: Context, isRoot: boolean): JsonSchemaNode {
  if (depth >= ctx.maxDepth) return {};
  if (ctx.stack.has(type)) return {};
  ctx.stack.add(type);
  try {
    const properties: Record<string, JsonSchemaNode> = {};
    const required: string[] = [];
    for (const prop of ctx.checker.getPropertiesOfType(type)) {
      const name = prop.getName();
      if (name.startsWith("$")) continue;
      if (isMethodSymbol(prop)) continue;
      const propType = ctx.checker.getTypeOfSymbolAtLocation(prop, ctx.location);
      if (isFunctionValued(propType, ctx)) continue;
      if (isRoot && (name.includes(".") || name.includes("*"))) {
        // A path getter declares a member at a nested position; inject it once the tree exists.
        ctx.pathGetters.push({ segments: name.split("."), type: propType });
        continue;
      }
      properties[name] = convertType(propType, depth + 1, ctx, false);
      if (!isOptional(prop, propType)) required.push(name);
    }
    const node: JsonSchemaNode = { type: "object", properties };
    if (required.length > 0) node.required = required;
    return node;
  } finally {
    ctx.stack.delete(type);
  }
}

/** Walk `segments` (`*` = array items) into a definite object and add the leaf; unknown (`{}`) containers stay unknown. */
function injectPath(root: JsonSchemaNode, segments: string[], leaf: JsonSchemaNode): void {
  const last = segments[segments.length - 1];
  if (last === "*" || last === "") return;
  let node: JsonSchemaNode | undefined = root;
  for (const segment of segments.slice(0, -1)) {
    node = segment === "*" ? node.items : descendObject(node)?.properties?.[segment];
    if (node === undefined) return;
    node = unwrapNullable(node);
  }
  const container = descendObject(node);
  if (container === undefined || container.properties === undefined) return;
  container.properties[last] = leaf;
}

/** For `anyOf: [object, null]` return the object member; otherwise the node itself. */
function unwrapNullable(node: JsonSchemaNode): JsonSchemaNode {
  if (node.anyOf === undefined) return node;
  const objects = node.anyOf.filter((n) => n.properties !== undefined || n.items !== undefined);
  return objects.length === 1 ? objects[0] : node;
}

function descendObject(node: JsonSchemaNode | undefined): JsonSchemaNode | undefined {
  if (node === undefined) return undefined;
  const unwrapped = unwrapNullable(node);
  return unwrapped.properties !== undefined ? unwrapped : undefined;
}

function isMethodSymbol(symbol: ts.Symbol): boolean {
  if (symbol.flags & ts.SymbolFlags.Method) return true;
  return (symbol.declarations ?? []).some(
    (d) => ts.isMethodDeclaration(d) || ts.isMethodSignature(d) || ts.isFunctionDeclaration(d),
  );
}

function isFunctionValued(type: ts.Type, ctx: Context): boolean {
  const members = type.isUnion() ? type.types : [type];
  return members.some(
    (t) => t.getCallSignatures().length > 0 && ctx.checker.getPropertiesOfType(t).length === 0,
  );
}

function isOptional(symbol: ts.Symbol, type: ts.Type): boolean {
  if (symbol.flags & ts.SymbolFlags.Optional) return true;
  return type.isUnion() && type.types.some((t) => (t.flags & ts.TypeFlags.Undefined) !== 0);
}

/** Declared in a default lib (`lib.*.d.ts`) or under node_modules → opaque `{}` (Date, Map, DOM types, third-party classes). */
function isLibrarySymbol(symbol: ts.Symbol, ctx: Context): boolean {
  const declarations = symbol.declarations ?? [];
  if (declarations.length === 0) return false;
  return declarations.every((d) => {
    const sf = d.getSourceFile();
    return ctx.program.isSourceFileDefaultLibrary(sf) || /[\\/]node_modules[\\/]/.test(sf.fileName);
  });
}

function literalValue(type: ts.Type, ctx: Context): unknown {
  if (type.flags & ts.TypeFlags.BooleanLiteral) return ctx.checker.typeToString(type) === "true";
  /* v8 ignore next 4 -- callers only pass literal types; the tail is the type-level fallback */
  if (type.isLiteral()) {
    const value = type.value;
    return typeof value === "object" ? Number(`${value.negative ? "-" : ""}${value.base10Value}`) : value;
  }
  return undefined;
}

function dedupeNodes(nodes: JsonSchemaNode[]): JsonSchemaNode[] {
  const seen = new Set<string>();
  const out: JsonSchemaNode[] = [];
  for (const n of nodes) {
    const key = JSON.stringify(n);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}
