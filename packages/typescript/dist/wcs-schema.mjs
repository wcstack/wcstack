#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

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
/** Defaults used when no tsconfig.json is found — enough to type a plain state file. */
const DEFAULT_COMPILER_OPTIONS = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ["lib.esnext.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    strict: true,
};
/** The compiler API compares paths it attaches diagnostics to against `/`-separated ones; feed it those on Windows too. */
function toPosix(path) {
    return path.replace(/\\/g, "/");
}
function resolveCompilerOptions(stateFile, options = {}) {
    const configPath = options.tsconfig !== undefined
        ? toPosix(resolve(options.tsconfig))
        : ts.findConfigFile(toPosix(dirname(stateFile)), ts.sys.fileExists, "tsconfig.json");
    let base = { ...DEFAULT_COMPILER_OPTIONS };
    if (configPath !== undefined) {
        let parsedOptions;
        try {
            const read = ts.readConfigFile(configPath, ts.sys.readFile);
            if (read.error !== undefined) {
                throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
            }
            parsedOptions = ts.parseJsonConfigFileContent(read.config, ts.sys, toPosix(dirname(configPath)), undefined, configPath).options;
        }
        catch (e) {
            throw new Error(`cannot read ${configPath}: ${e.message}`);
        }
        base = { ...DEFAULT_COMPILER_OPTIONS, ...parsedOptions };
    }
    return {
        ...base,
        // The generator only reads types: never write, always accept JS (JSDoc types), keep it fast.
        noEmit: true,
        allowJs: true,
        checkJs: true,
        skipLibCheck: true,
        declaration: false,
        declarationMap: false,
        sourceMap: false,
        composite: false,
        incremental: false,
        tsBuildInfoFile: undefined,
    };
}
/** Unwrap `defineState(x)` (any callee whose last identifier is `defineState`) and `satisfies` / `as`-free wrappers. */
function stateExpression(expression) {
    let current = expression;
    while (ts.isParenthesizedExpression(current))
        current = current.expression;
    if (ts.isCallExpression(current) && current.arguments.length > 0) {
        const callee = current.expression;
        const name = ts.isIdentifier(callee)
            ? callee.text
            : ts.isPropertyAccessExpression(callee)
                ? callee.name.text
                : undefined;
        if (name === "defineState")
            return current.arguments[0];
    }
    return current;
}
function loadStateFile(file, options = {}) {
    const abs = resolve(file);
    if (!existsSync(abs))
        throw new Error(`cannot read ${file}: no such file`);
    // Read up front so an unreadable file fails with a plain message, not a compiler internals one.
    readFileSync(abs, "utf8");
    const compilerOptions = resolveCompilerOptions(abs, options);
    const program = ts.createProgram([abs], compilerOptions);
    const sourceFile = program.getSourceFile(abs);
    /* v8 ignore next -- the file exists and is a root name; the compiler always returns it */
    if (sourceFile === undefined)
        throw new Error(`cannot open ${file} as a TypeScript/JavaScript source`);
    const syntax = program.getSyntacticDiagnostics(sourceFile);
    if (syntax.length > 0) {
        const lines = syntax.map((d) => {
            // Syntactic diagnostics always carry their file and position; the fallback is type-level only.
            /* v8 ignore next 2 */
            const pos = d.file !== undefined && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : undefined;
            const where = pos !== undefined ? `${file}:${pos.line + 1}:${pos.character + 1}` : file;
            return `${where} ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`;
        });
        throw new Error(`syntax error(s) in ${file}:\n${lines.join("\n")}`);
    }
    const exportAssignment = sourceFile.statements.find((s) => ts.isExportAssignment(s) && !s.isExportEquals);
    if (exportAssignment === undefined) {
        throw new Error(`${file} has no \`export default\` — a wcstack state file exports its state object as the default export`);
    }
    const location = stateExpression(exportAssignment.expression);
    const checker = program.getTypeChecker();
    const type = checker.getTypeAtLocation(location);
    const warnings = [];
    if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) {
        warnings.push(`the default export of ${file} has type \`${checker.typeToString(type)}\`; the generated stateSchema will be open ({})`);
    }
    return { program, checker, sourceFile, type, location, warnings };
}

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
const DEFAULT_MAX_DEPTH = 5;
/**
 * Convert the type of a state object into a `stateSchema` node.
 */
function stateTypeToSchema(checker, program, type, location, options = {}) {
    const ctx = {
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
function convertType(type, depth, ctx, isRoot) {
    const flags = type.flags;
    if (flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.TypeParameter | ts.TypeFlags.NonPrimitive)) {
        return {};
    }
    if (flags & ts.TypeFlags.Null)
        return { type: "null" };
    if (flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void))
        return {};
    if (flags & ts.TypeFlags.Boolean)
        return { type: "boolean" };
    if (flags & ts.TypeFlags.BooleanLiteral)
        return { type: "boolean", const: literalValue(type, ctx) };
    if (flags & ts.TypeFlags.StringLiteral)
        return { type: "string", const: type.value };
    if (flags & ts.TypeFlags.NumberLiteral)
        return { type: "number", const: type.value };
    if (flags & (ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral | ts.TypeFlags.ESSymbolLike))
        return {};
    if (flags & ts.TypeFlags.String)
        return { type: "string" };
    if (flags & ts.TypeFlags.Number)
        return { type: "number" };
    if (type.isUnion())
        return convertUnion(type, depth, ctx);
    if (ctx.checker.isArrayType(type) || ctx.checker.isTupleType(type)) {
        return convertArray(type, depth, ctx);
    }
    const callable = type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0;
    if (callable && ctx.checker.getPropertiesOfType(type).length === 0)
        return {};
    const symbol = type.getSymbol() ?? type.aliasSymbol;
    if (symbol !== undefined && isLibrarySymbol(symbol, ctx))
        return {};
    return convertObject(type, depth, ctx, isRoot);
}
function convertUnion(type, depth, ctx) {
    const members = type.types.filter((t) => (t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) === 0);
    const hasNull = members.some((t) => (t.flags & ts.TypeFlags.Null) !== 0);
    const nonNull = members.filter((t) => (t.flags & ts.TypeFlags.Null) === 0);
    let node;
    if (nonNull.length === 0) {
        return { type: "null" };
    }
    else if (nonNull.every((t) => (t.flags & ts.TypeFlags.BooleanLiteral) !== 0) && nonNull.length === 2) {
        node = { type: "boolean" };
    }
    else if (nonNull.every((t) => t.isLiteral() || (t.flags & ts.TypeFlags.BooleanLiteral) !== 0)) {
        const values = nonNull.map((t) => literalValue(t, ctx));
        const kinds = [...new Set(values.map((v) => typeof v))];
        node = kinds.length === 1 && (kinds[0] === "string" || kinds[0] === "number" || kinds[0] === "boolean")
            ? { type: kinds[0], enum: values }
            : { enum: values };
    }
    else if (nonNull.length === 1) {
        node = convertType(nonNull[0], depth, ctx, false);
    }
    else {
        const converted = dedupeNodes(nonNull.map((t) => convertType(t, depth, ctx, false)));
        node = converted.length === 1 ? converted[0] : { anyOf: converted };
    }
    if (!hasNull)
        return node;
    if (node.type === "null")
        return node;
    return node.anyOf !== undefined ? { anyOf: [...node.anyOf, { type: "null" }] } : { anyOf: [node, { type: "null" }] };
}
function convertArray(type, depth, ctx) {
    const args = ctx.checker.getTypeArguments(type);
    if (args.length === 0)
        return { type: "array", items: {} };
    if (ctx.checker.isTupleType(type)) {
        const converted = dedupeNodes(args.map((t) => convertType(t, depth, ctx, false)));
        return { type: "array", items: converted.length === 1 ? converted[0] : { anyOf: converted } };
    }
    return { type: "array", items: convertType(args[0], depth, ctx, false) };
}
function convertObject(type, depth, ctx, isRoot) {
    if (depth >= ctx.maxDepth)
        return {};
    if (ctx.stack.has(type))
        return {};
    ctx.stack.add(type);
    try {
        const properties = {};
        const required = [];
        for (const prop of ctx.checker.getPropertiesOfType(type)) {
            const name = prop.getName();
            if (name.startsWith("$"))
                continue;
            if (isMethodSymbol(prop))
                continue;
            const propType = ctx.checker.getTypeOfSymbolAtLocation(prop, ctx.location);
            if (isFunctionValued(propType, ctx))
                continue;
            if (isRoot && (name.includes(".") || name.includes("*"))) {
                // A path getter declares a member at a nested position; inject it once the tree exists.
                ctx.pathGetters.push({ segments: name.split("."), type: propType });
                continue;
            }
            properties[name] = convertType(propType, depth + 1, ctx, false);
            if (!isOptional(prop, propType))
                required.push(name);
        }
        const node = { type: "object", properties };
        if (required.length > 0)
            node.required = required;
        return node;
    }
    finally {
        ctx.stack.delete(type);
    }
}
/** Walk `segments` (`*` = array items) into a definite object and add the leaf; unknown (`{}`) containers stay unknown. */
function injectPath(root, segments, leaf) {
    const last = segments[segments.length - 1];
    if (last === "*" || last === "")
        return;
    let node = root;
    for (const segment of segments.slice(0, -1)) {
        node = segment === "*" ? node.items : descendObject(node)?.properties?.[segment];
        if (node === undefined)
            return;
        node = unwrapNullable(node);
    }
    const container = descendObject(node);
    if (container === undefined || container.properties === undefined)
        return;
    container.properties[last] = leaf;
}
/** For `anyOf: [object, null]` return the object member; otherwise the node itself. */
function unwrapNullable(node) {
    if (node.anyOf === undefined)
        return node;
    const objects = node.anyOf.filter((n) => n.properties !== undefined || n.items !== undefined);
    return objects.length === 1 ? objects[0] : node;
}
function descendObject(node) {
    if (node === undefined)
        return undefined;
    const unwrapped = unwrapNullable(node);
    return unwrapped.properties !== undefined ? unwrapped : undefined;
}
function isMethodSymbol(symbol) {
    if (symbol.flags & ts.SymbolFlags.Method)
        return true;
    return (symbol.declarations ?? []).some((d) => ts.isMethodDeclaration(d) || ts.isMethodSignature(d) || ts.isFunctionDeclaration(d));
}
function isFunctionValued(type, ctx) {
    const members = type.isUnion() ? type.types : [type];
    return members.some((t) => t.getCallSignatures().length > 0 && ctx.checker.getPropertiesOfType(t).length === 0);
}
function isOptional(symbol, type) {
    if (symbol.flags & ts.SymbolFlags.Optional)
        return true;
    return type.isUnion() && type.types.some((t) => (t.flags & ts.TypeFlags.Undefined) !== 0);
}
/** Declared in a default lib (`lib.*.d.ts`) or under node_modules → opaque `{}` (Date, Map, DOM types, third-party classes). */
function isLibrarySymbol(symbol, ctx) {
    const declarations = symbol.declarations ?? [];
    if (declarations.length === 0)
        return false;
    return declarations.every((d) => {
        const sf = d.getSourceFile();
        return ctx.program.isSourceFileDefaultLibrary(sf) || /[\\/]node_modules[\\/]/.test(sf.fileName);
    });
}
function literalValue(type, ctx) {
    if (type.flags & ts.TypeFlags.BooleanLiteral)
        return ctx.checker.typeToString(type) === "true";
    /* v8 ignore next 4 -- callers only pass literal types; the tail is the type-level fallback */
    if (type.isLiteral()) {
        const value = type.value;
        return typeof value === "object" ? Number(`${value.negative ? "-" : ""}${value.base10Value}`) : value;
    }
    return undefined;
}
function dedupeNodes(nodes) {
    const seen = new Set();
    const out = [];
    for (const n of nodes) {
        const key = JSON.stringify(n);
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(n);
    }
    return out;
}

/**
 * generate.ts — one call from a state file to its `stateSchema`.
 */
function generateStateSchema(file, options = {}) {
    const loaded = loadStateFile(file, options);
    const schema = stateTypeToSchema(loaded.checker, loaded.program, loaded.type, loaded.location, options);
    return { schema, warnings: loaded.warnings };
}

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
const APPLICATION_MANIFEST_FILENAME = "wcstack.manifest.json";
const SCHEMA_VERSION = 2;
const APPLICATION_NAMESPACE = "wcstack.application";
/**
 * Create the manifest object for the state tree, or graft into `existing`
 * (a parsed manifest object; envelope fields are normalized to v2 — a v1
 * manifest's `states` map does not survive, its replacement is exactly this
 * regeneration path).
 *
 * `mountPath === null` replaces the whole `stateSchema`; a mount path merges
 * the schema as a subtree at that path (intermediate object nodes are created).
 */
function buildManifest(mountPath, schema, existing) {
    const base = existing !== null && typeof existing === "object" && !Array.isArray(existing)
        ? { ...existing }
        : {};
    base.schemaVersion = SCHEMA_VERSION;
    base.kind = "application";
    const extensions = base.manifestExtensions !== null && typeof base.manifestExtensions === "object" && !Array.isArray(base.manifestExtensions)
        ? { ...base.manifestExtensions }
        : {};
    const nsRaw = extensions[APPLICATION_NAMESPACE];
    const ns = nsRaw !== null && typeof nsRaw === "object" && !Array.isArray(nsRaw) ? { ...nsRaw } : {};
    ns.version = SCHEMA_VERSION;
    // v1 leftovers: the name dimension is gone; regeneration does not carry it
    delete ns.states;
    if (mountPath === null) {
        ns.stateSchema = schema;
    }
    else {
        const rootRaw = ns.stateSchema;
        const root = rootRaw !== null && typeof rootRaw === "object" && !Array.isArray(rootRaw)
            ? { ...rootRaw }
            : { type: "object" };
        let node = root;
        const segments = mountPath.split(".");
        for (let i = 0; i < segments.length; i++) {
            const properties = node.properties !== null && typeof node.properties === "object" && !Array.isArray(node.properties)
                ? { ...node.properties }
                : {};
            node.properties = properties;
            if (i === segments.length - 1) {
                properties[segments[i]] = schema;
                break;
            }
            const childRaw = properties[segments[i]];
            const child = childRaw !== null && typeof childRaw === "object" && !Array.isArray(childRaw)
                ? { ...childRaw }
                : { type: "object" };
            properties[segments[i]] = child;
            node = child;
        }
        ns.stateSchema = root;
    }
    extensions[APPLICATION_NAMESPACE] = ns;
    base.manifestExtensions = extensions;
    return base;
}
/** Read the single `stateSchema` from a parsed manifest object, or undefined. */
function readStateSchema(manifest) {
    if (manifest === null || typeof manifest !== "object")
        return undefined;
    const extensions = manifest.manifestExtensions;
    if (extensions === null || typeof extensions !== "object")
        return undefined;
    const ns = extensions[APPLICATION_NAMESPACE];
    if (ns === null || typeof ns !== "object")
        return undefined;
    return ns.stateSchema;
}
/**
 * True for a v1-shaped manifest (`schemaVersion: 1` or a `states` map in the
 * application namespace). `check` uses it to point at the regeneration path
 * instead of reporting a confusing "missing stateSchema".
 */
function isV1Manifest(manifest) {
    if (manifest === null || typeof manifest !== "object")
        return false;
    if (manifest.schemaVersion === 1)
        return true;
    const extensions = manifest.manifestExtensions;
    if (extensions === null || typeof extensions !== "object")
        return false;
    const ns = extensions[APPLICATION_NAMESPACE];
    if (ns === null || typeof ns !== "object")
        return false;
    return ns.states !== undefined;
}
/** Navigate `properties` by mount-path segments; undefined when the subtree is absent. */
function subtreeAt(schema, mountPath) {
    let node = schema;
    for (const segment of mountPath.split(".")) {
        if (node === null || typeof node !== "object")
            return undefined;
        const properties = node.properties;
        if (properties === null || typeof properties !== "object")
            return undefined;
        node = properties[segment];
    }
    return node;
}
/** JSON with object keys sorted at every level — the canonical form used for comparison. */
function stableStringify(value) {
    return JSON.stringify(sortKeys(value));
}
function sortKeys(value) {
    if (Array.isArray(value))
        return value.map(sortKeys);
    if (value !== null && typeof value === "object") {
        const out = {};
        for (const key of Object.keys(value).sort()) {
            out[key] = sortKeys(value[key]);
        }
        return out;
    }
    return value;
}
/**
 * Compare the schema generated from the type with the one stored in `manifestText`
 * (the whole tree, or the subtree at `mountPath`).
 * `changes` lists JSON pointers: `+ ptr` (only in generated), `- ptr` (only in
 * manifest), `~ ptr` (both, different value).
 */
function compareStateSchema(manifestText, mountPath, generated) {
    let parsed;
    try {
        parsed = JSON.parse(manifestText);
    }
    catch (e) {
        return { kind: "broken", message: e.message };
    }
    if (isV1Manifest(parsed))
        return { kind: "v1-manifest" };
    let stored = readStateSchema(parsed);
    if (stored !== undefined && mountPath !== null) {
        stored = subtreeAt(stored, mountPath);
    }
    if (stored === undefined)
        return { kind: "missing-state" };
    if (stableStringify(stored) === stableStringify(generated))
        return { kind: "same" };
    const a = flatten(generated);
    const b = flatten(stored);
    const changes = [];
    for (const key of [...new Set([...a.keys(), ...b.keys()])].sort()) {
        const inA = a.has(key);
        const inB = b.has(key);
        if (inA && !inB)
            changes.push(`+ ${key}`);
        else if (!inA && inB)
            changes.push(`- ${key}`);
        else if (a.get(key) !== b.get(key))
            changes.push(`~ ${key}`);
    }
    return { kind: "differs", changes };
}
/** Leaf pointer → canonical JSON. Objects with children are not listed themselves; empty objects/arrays are leaves. */
function flatten(value, pointer = "", out = new Map()) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        const entries = Object.entries(value);
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

/**
 * schemaCore.ts — the validator core bundle (`dist/schema-core.cjs`, built from
 * packages/vscode-wcs by scripts/build-schema-core.mjs), loaded lazily.
 *
 * The bundle is a self-contained CJS file that requires neither `typescript` nor
 * `vscode`; it is located relative to the running module so the same loader
 * works from `dist/index.esm.js`, `dist/wcs-schema.mjs`, and the TypeScript
 * sources under vitest (`src/…` → `../dist`).
 */
const BUNDLE = "schema-core.cjs";
/** Candidate locations, nearest first: dist/ (built), ../dist (src/), ../../dist (src/cli/). */
function schemaCoreCandidates(fromUrl = import.meta.url) {
    const here = dirname(fileURLToPath(fromUrl));
    return [join(here, BUNDLE), join(here, "..", "dist", BUNDLE), join(here, "..", "..", "dist", BUNDLE)];
}
let cached;
function loadSchemaCore() {
    if (cached !== undefined)
        return cached;
    const candidates = schemaCoreCandidates();
    const found = candidates.find((p) => existsSync(p));
    /* v8 ignore next 5 -- tests run after `npm run build`, so the bundle is always present */
    if (found === undefined) {
        throw new Error(`${BUNDLE} not found — run \`npm run build\` in packages/typescript (looked in: ${candidates.join(", ")})`);
    }
    cached = createRequire(import.meta.url)(found);
    return cached;
}

var version = "1.32.0";
var pkg = {
	version: version};

const VERSION = pkg.version;

/**
 * wcsSchema.ts — the `wcs-schema` command.
 *
 *   wcs-schema emit  <state.ts|state.js> [--mount=<path>] [--out=wcstack.manifest.json] [--merge] [--tsconfig=<path>] [--max-depth=5]
 *   wcs-schema check <state.ts|state.js> [--mount=<path>] [--manifest=wcstack.manifest.json] [--tsconfig=<path>] [--max-depth=5]
 *
 * exit codes
 *   emit : 0 written / 2 usage, unreadable file, syntax error, or the generated manifest failed its self-check
 *   check: 0 manifest matches the type / 1 drift (changes listed on stderr) / 2 usage, unreadable file, broken or state-less manifest
 *
 * `--out=-` prints the manifest to stdout instead of writing a file. `--merge`
 * keeps everything in an existing manifest except the slot being written —
 * the whole `stateSchema`, or the subtree at `--mount=<path>` (a volume's type
 * merges as a subtree of the single tree, docs/state-mount-design.md D15).
 *
 * The generated artifact is always run through the validator core's
 * `validateManifestArtifact` (dist/schema-core.cjs, built from vscode-wcs) so a
 * generator bug can never write a manifest the validator would reject.
 */
const USAGE = "usage: wcs-schema emit  <state.ts|state.js> [--mount=<path>] [--out=wcstack.manifest.json] [--merge] [--tsconfig=<path>] [--max-depth=5]\n" +
    "       wcs-schema check <state.ts|state.js> [--mount=<path>] [--manifest=wcstack.manifest.json] [--tsconfig=<path>] [--max-depth=5]\n";
function parseArgs(argv) {
    let command;
    let file;
    let mount = null;
    let out = APPLICATION_MANIFEST_FILENAME;
    let manifest = APPLICATION_MANIFEST_FILENAME;
    let merge = false;
    let tsconfig;
    let maxDepth;
    const unknown = [];
    for (const arg of argv) {
        if (arg === "--version" || arg === "-v")
            command ??= "version";
        else if (arg === "--help" || arg === "-h")
            command ??= "help";
        else if (arg.startsWith("--mount="))
            mount = arg.slice("--mount=".length);
        else if (arg.startsWith("--state="))
            unknown.push(arg); // v2: 名前次元は撤去 — --mount=<path> へ
        else if (arg.startsWith("--out="))
            out = arg.slice("--out=".length);
        else if (arg.startsWith("--manifest="))
            manifest = arg.slice("--manifest=".length);
        else if (arg.startsWith("--tsconfig="))
            tsconfig = arg.slice("--tsconfig=".length);
        else if (arg.startsWith("--max-depth="))
            maxDepth = Number(arg.slice("--max-depth=".length));
        else if (arg === "--merge")
            merge = true;
        else if (arg.startsWith("-"))
            unknown.push(arg);
        else if (command === undefined && (arg === "emit" || arg === "check"))
            command = arg;
        else if (file === undefined)
            file = arg;
        else
            unknown.push(arg);
    }
    return { command, file, mount, out, manifest, merge, tsconfig, maxDepth, unknown };
}
function main(argv, io = defaultIo()) {
    const args = parseArgs(argv);
    if (args.command === "version") {
        io.stdout(`${VERSION}\n`);
        return 0;
    }
    if (args.command === "help") {
        io.stdout(USAGE);
        return 0;
    }
    if (args.command === undefined || args.file === undefined || args.unknown.length > 0) {
        if (args.unknown.some((arg) => arg.startsWith("--state="))) {
            io.stderr('--state was removed in v2 — there is a single state tree. Use --mount=<path> for a volume, or no flag for the root tree.\n');
        }
        else if (args.unknown.length > 0) {
            io.stderr(`unknown argument(s): ${args.unknown.join(" ")}\n`);
        }
        io.stderr(USAGE);
        return 2;
    }
    if (args.maxDepth !== undefined && (!Number.isInteger(args.maxDepth) || args.maxDepth < 1)) {
        io.stderr("--max-depth must be a positive integer\n");
        return 2;
    }
    if (args.mount !== null && !/^[A-Za-z_$][\w$-]*(\.[A-Za-z_$][\w$-]*)*$/.test(args.mount)) {
        io.stderr(`--mount must be a static tree path (got "${args.mount}")\n`);
        return 2;
    }
    let generated;
    try {
        generated = generateStateSchema(resolve(io.cwd(), args.file), { tsconfig: args.tsconfig, maxDepth: args.maxDepth });
    }
    catch (e) {
        io.stderr(`${e.message}\n`);
        return 2;
    }
    for (const warning of generated.warnings)
        io.stderr(`warning: ${warning}\n`);
    return args.command === "emit" ? emit(args, generated.schema, io) : check(args, generated.schema, io);
}
function emit(args, schema, io) {
    const toStdout = args.out === "-";
    const outPath = toStdout ? undefined : resolve(io.cwd(), args.out);
    let existing;
    if ((args.merge || args.mount !== null) && outPath !== undefined && existsSync(outPath)) {
        try {
            existing = JSON.parse(readFileSync(outPath, "utf8"));
        }
        catch (e) {
            io.stderr(`cannot merge into ${args.out}: ${e.message}\n`);
            return 2;
        }
    }
    const manifest = buildManifest(args.mount, schema, existing);
    const text = `${JSON.stringify(manifest, null, 2)}\n`;
    // Self-check: the validator must accept what the generator wrote.
    const core = loadSchemaCore();
    const problems = core.validateManifestArtifact({ text, source: args.out });
    for (const d of problems.filter((p) => p.severity !== "error")) {
        io.stderr(`${d.severity} ${d.code} ${d.message}\n`);
    }
    const errors = problems.filter((p) => p.severity === "error");
    if (errors.length > 0) {
        for (const d of errors)
            io.stderr(`error ${d.code} ${d.message}\n`);
        io.stderr(`generated manifest failed its self-check (${errors.length} error(s)); nothing written\n`);
        return 2;
    }
    if (toStdout) {
        io.stdout(text);
        return 0;
    }
    writeFileSync(outPath, text, "utf8");
    io.stderr(`wrote ${args.out} (${args.mount === null ? "state tree" : `mount "${args.mount}"`})\n`);
    return 0;
}
function check(args, schema, io) {
    const manifestPath = resolve(io.cwd(), args.manifest);
    if (!existsSync(manifestPath)) {
        io.stderr(`cannot read ${args.manifest}: no such file (run \`wcs-schema emit\` first)\n`);
        return 2;
    }
    const slot = args.mount === null ? "state tree" : `mount "${args.mount}"`;
    const comparison = compareStateSchema(readFileSync(manifestPath, "utf8"), args.mount, schema);
    switch (comparison.kind) {
        case "same":
            io.stderr(`${args.manifest}: ${slot} is up to date\n`);
            return 0;
        case "missing-state":
            io.stderr(`${args.manifest}: ${slot} has no stateSchema (run \`wcs-schema emit --merge\`)\n`);
            return 2;
        case "v1-manifest":
            io.stderr(`${args.manifest}: schemaVersion 1 manifest (states[name]) — the name dimension was removed in v2. Regenerate with \`wcs-schema emit --out=${args.manifest}\` (single stateSchema, schemaVersion 2)\n`);
            return 2;
        case "broken":
            io.stderr(`${args.manifest}: broken JSON: ${comparison.message}\n`);
            return 2;
        case "differs":
            io.stderr(`${args.manifest}: ${slot} is out of date (${comparison.changes.length} change(s)):\n`);
            for (const change of comparison.changes)
                io.stderr(`  ${change}\n`);
            io.stderr(`run \`wcs-schema emit --merge --out=${args.manifest}\` to update it\n`);
            return 1;
    }
}
/* v8 ignore start -- process plumbing; exercised by running the built bin, not by unit tests */
function defaultIo() {
    return {
        stdout: (text) => process.stdout.write(text),
        stderr: (text) => process.stderr.write(text),
        cwd: () => process.cwd(),
    };
}
// Entry point when executed as the `wcs-schema` bin (rollup emits dist/wcs-schema.mjs
// with a shebang). Under vitest this module is imported, and `process.argv[1]` is
// vitest's own entry, so the branch is not taken.
const invokedAsBin = typeof process !== "undefined"
    && Array.isArray(process.argv)
    && /wcs-schema(\.mjs)?$/.test(process.argv[1] ?? "");
if (invokedAsBin) {
    process.exit(main(process.argv.slice(2)));
}
/* v8 ignore stop */

export { main, parseArgs };
//# sourceMappingURL=wcs-schema.mjs.map
