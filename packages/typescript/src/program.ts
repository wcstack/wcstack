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

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { unsupportedTypeScript, unsupportedTypeScriptMessage } from "./typescriptSupport.js";

export interface LoadStateOptions {
  /** Explicit tsconfig.json path. Default: the nearest tsconfig.json above the state file, else built-in defaults. */
  readonly tsconfig?: string;
}

export interface LoadedState {
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly sourceFile: ts.SourceFile;
  /** The type of the default export (the `defineState(...)` argument when wrapped). */
  readonly type: ts.Type;
  /** Node to use as the location for `getTypeOfSymbolAtLocation`. */
  readonly location: ts.Node;
  /** Non-fatal notes for the caller (e.g. the state type resolved to `any`). */
  readonly warnings: readonly string[];
  /** A top-level spread brings in keys its type does not list: the state's schema is open (`{}`), whatever `type` says. */
  readonly open: boolean;
}

/**
 * Defaults used when no tsconfig.json is found — enough to type a plain state file.
 * The enums are read with `?.` so that this module still loads under TypeScript 7,
 * whose `typescript` has none: `loadStateFile` then refuses that compiler by name.
 */
export const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget?.ESNext,
  module: ts.ModuleKind?.ESNext,
  moduleResolution: ts.ModuleResolutionKind?.Bundler,
  lib: ["lib.esnext.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  strict: true,
};

/** The compiler API compares paths it attaches diagnostics to against `/`-separated ones; feed it those on Windows too. */
function toPosix(path: string): string {
  return path.replace(/\\/g, "/");
}

export function resolveCompilerOptions(stateFile: string, options: LoadStateOptions = {}): ts.CompilerOptions {
  const configPath = options.tsconfig !== undefined
    ? toPosix(resolve(options.tsconfig))
    : ts.findConfigFile(toPosix(dirname(stateFile)), ts.sys.fileExists, "tsconfig.json");
  let base: ts.CompilerOptions = { ...DEFAULT_COMPILER_OPTIONS };
  if (configPath !== undefined) {
    let parsedOptions: ts.CompilerOptions;
    try {
      const read = ts.readConfigFile(configPath, ts.sys.readFile);
      if (read.error !== undefined) {
        throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
      }
      parsedOptions = ts.parseJsonConfigFileContent(read.config, ts.sys, toPosix(dirname(configPath)), undefined, configPath).options;
    } catch (e) {
      throw new Error(`cannot read ${configPath}: ${(e as Error).message}`);
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
function stateExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  if (ts.isCallExpression(current) && current.arguments.length > 0) {
    const callee = current.expression;
    const name = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : undefined;
    if (name === "defineState") return current.arguments[0];
  }
  return current;
}

export function loadStateFile(file: string, options: LoadStateOptions = {}): LoadedState {
  const unsupported = unsupportedTypeScript(ts.version);
  if (unsupported !== undefined) throw new Error(unsupportedTypeScriptMessage(unsupported));
  const abs = resolve(file);
  if (!existsSync(abs)) throw new Error(`cannot read ${file}: no such file`);
  // Read up front so an unreadable file fails with a plain message, not a compiler internals one.
  readFileSync(abs, "utf8");

  const compilerOptions = resolveCompilerOptions(abs, options);
  const program = ts.createProgram([abs], compilerOptions);
  const sourceFile = program.getSourceFile(abs);
  /* v8 ignore next -- the file exists and is a root name; the compiler always returns it */
  if (sourceFile === undefined) throw new Error(`cannot open ${file} as a TypeScript/JavaScript source`);

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

  const exportAssignment = sourceFile.statements.find(
    (s): s is ts.ExportAssignment => ts.isExportAssignment(s) && !s.isExportEquals,
  );
  if (exportAssignment === undefined) {
    throw new Error(`${file} has no \`export default\` — a wcstack state file exports its state object as the default export`);
  }

  const location = stateExpression(exportAssignment.expression);
  const checker = program.getTypeChecker();
  const warnings: string[] = [];
  // A spread whose type does not list its keys first: the type of the whole literal is not needed then (and is the
  // expensive one, below)
  const spread = openSpread(checker, sourceFile, location);
  if (spread !== null) {
    warnings.push(`the spread \`${spread.text}\` (${file}:${spread.line}) brings in keys its type does not list (\`${spread.type}\`); the generated stateSchema will be open ({}). Give that expression a type that lists them (a JSDoc @returns or @type)`);
    return { program, checker, sourceFile, type: checker.getAnyType(), location, warnings, open: true };
  }
  let type: ts.Type;
  try {
    type = checker.getTypeAtLocation(location);
  } catch (e) {
    /* v8 ignore next 2 -- the checker's own overflow, exercised against the built dist (stack.test.ts) */
    if (!(e instanceof RangeError)) throw e;
    throw new Error(`the TypeScript checker ran out of stack on ${file}: an \`export default { … }\` with a top-level spread makes it recurse once per getter that reads \`this\`. The wcs-schema command runs on a larger stack; from the API, call generateStateSchema() on a worker with a larger resourceLimits.stackSizeMb`);
  }
  if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) {
    warnings.push(`the default export of ${file} has type \`${checker.typeToString(type)}\`; the generated stateSchema will be open ({})`);
  }
  return { program, checker, sourceFile, type, location, warnings, open: false };
}

/**
 * A top-level spread of the state literal whose type does not list the keys it brings in — `any`, `unknown`, or an
 * index signature (`...sanitizeInputs({}).inputs` returning `Record<string, unknown>`). The compiler drops an
 * index signature from a spread, so the literal's type then lists only its own keys: a schema made from it would
 * call every key of the spread nonexistent (`wcs/path-nonexistent`, an error), where the validator knows nothing.
 * Found by an outside evaluation (a tax return draft whose 34 inputs come from such a spread).
 */
function openSpread(checker: ts.TypeChecker, sourceFile: ts.SourceFile, location: ts.Expression): { text: string; line: number; type: string } | null {
  if (!ts.isObjectLiteralExpression(location)) return null;
  for (const property of location.properties) {
    if (!ts.isSpreadAssignment(property)) continue;
    const type = checker.getTypeAtLocation(property.expression);
    const open = (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0
      || (type.isUnion() ? type.types : [type]).some((t) => checker.getIndexInfosOfType(t).length > 0);
    if (!open) continue;
    return {
      text: property.getText(sourceFile),
      line: sourceFile.getLineAndCharacterOfPosition(property.getStart(sourceFile)).line + 1,
      type: checker.typeToString(type),
    };
  }
  return null;
}
