/**
 * wcsSchema.ts — the `wcs-schema` command.
 *
 *   wcs-schema emit  <state.ts|state.js> [--state=default] [--out=wcstack.manifest.json] [--merge] [--tsconfig=<path>] [--max-depth=5]
 *   wcs-schema check <state.ts|state.js> [--state=default] [--manifest=wcstack.manifest.json] [--tsconfig=<path>] [--max-depth=5]
 *
 * exit codes
 *   emit : 0 written / 2 usage, unreadable file, syntax error, or the generated manifest failed its self-check
 *   check: 0 manifest matches the type / 1 drift (changes listed on stderr) / 2 usage, unreadable file, broken or state-less manifest
 *
 * `--out=-` prints the manifest to stdout instead of writing a file. `--merge`
 * keeps everything in an existing manifest except `states[<name>].stateSchema`.
 *
 * The generated artifact is always run through the validator core's
 * `validateManifestArtifact` (dist/schema-core.cjs, built from vscode-wcs) so a
 * generator bug can never write a manifest the validator would reject.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateStateSchema } from "../generate.js";
import { APPLICATION_MANIFEST_FILENAME, buildManifest, compareStateSchema } from "../manifest.js";
import { loadSchemaCore } from "../schemaCore.js";
import { VERSION } from "../version.js";

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly cwd: () => string;
}

const USAGE =
  "usage: wcs-schema emit  <state.ts|state.js> [--state=default] [--out=wcstack.manifest.json] [--merge] [--tsconfig=<path>] [--max-depth=5]\n" +
  "       wcs-schema check <state.ts|state.js> [--state=default] [--manifest=wcstack.manifest.json] [--tsconfig=<path>] [--max-depth=5]\n";

export interface ParsedArgs {
  readonly command: "emit" | "check" | "version" | "help" | undefined;
  readonly file: string | undefined;
  readonly state: string;
  readonly out: string;
  readonly manifest: string;
  readonly merge: boolean;
  readonly tsconfig: string | undefined;
  readonly maxDepth: number | undefined;
  readonly unknown: readonly string[];
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  let command: ParsedArgs["command"];
  let file: string | undefined;
  let state = "default";
  let out = APPLICATION_MANIFEST_FILENAME;
  let manifest = APPLICATION_MANIFEST_FILENAME;
  let merge = false;
  let tsconfig: string | undefined;
  let maxDepth: number | undefined;
  const unknown: string[] = [];
  for (const arg of argv) {
    if (arg === "--version" || arg === "-v") command ??= "version";
    else if (arg === "--help" || arg === "-h") command ??= "help";
    else if (arg.startsWith("--state=")) state = arg.slice("--state=".length);
    else if (arg.startsWith("--out=")) out = arg.slice("--out=".length);
    else if (arg.startsWith("--manifest=")) manifest = arg.slice("--manifest=".length);
    else if (arg.startsWith("--tsconfig=")) tsconfig = arg.slice("--tsconfig=".length);
    else if (arg.startsWith("--max-depth=")) maxDepth = Number(arg.slice("--max-depth=".length));
    else if (arg === "--merge") merge = true;
    else if (arg.startsWith("-")) unknown.push(arg);
    else if (command === undefined && (arg === "emit" || arg === "check")) command = arg;
    else if (file === undefined) file = arg;
    else unknown.push(arg);
  }
  return { command, file, state, out, manifest, merge, tsconfig, maxDepth, unknown };
}

export function main(argv: readonly string[], io: CliIo = defaultIo()): number {
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
    if (args.unknown.length > 0) io.stderr(`unknown argument(s): ${args.unknown.join(" ")}\n`);
    io.stderr(USAGE);
    return 2;
  }
  if (args.maxDepth !== undefined && (!Number.isInteger(args.maxDepth) || args.maxDepth < 1)) {
    io.stderr("--max-depth must be a positive integer\n");
    return 2;
  }
  if (!/^[A-Za-z_$][\w$-]*$/.test(args.state)) {
    io.stderr(`--state must be a state name (got "${args.state}")\n`);
    return 2;
  }

  let generated;
  try {
    generated = generateStateSchema(resolve(io.cwd(), args.file), { tsconfig: args.tsconfig, maxDepth: args.maxDepth });
  } catch (e) {
    io.stderr(`${(e as Error).message}\n`);
    return 2;
  }
  for (const warning of generated.warnings) io.stderr(`warning: ${warning}\n`);

  return args.command === "emit" ? emit(args, generated.schema, io) : check(args, generated.schema, io);
}

function emit(args: ParsedArgs, schema: ReturnType<typeof generateStateSchema>["schema"], io: CliIo): number {
  const toStdout = args.out === "-";
  const outPath = toStdout ? undefined : resolve(io.cwd(), args.out);

  let existing: unknown;
  if (args.merge && outPath !== undefined && existsSync(outPath)) {
    try {
      existing = JSON.parse(readFileSync(outPath, "utf8"));
    } catch (e) {
      io.stderr(`cannot merge into ${args.out}: ${(e as Error).message}\n`);
      return 2;
    }
  }

  const manifest = buildManifest(args.state, schema, existing);
  const text = `${JSON.stringify(manifest, null, 2)}\n`;

  // Self-check: the validator must accept what the generator wrote.
  const core = loadSchemaCore();
  const problems = core.validateManifestArtifact({ text, source: args.out });
  for (const d of problems.filter((p) => p.severity !== "error")) {
    io.stderr(`${d.severity} ${d.code} ${d.message}\n`);
  }
  const errors = problems.filter((p) => p.severity === "error");
  if (errors.length > 0) {
    for (const d of errors) io.stderr(`error ${d.code} ${d.message}\n`);
    io.stderr(`generated manifest failed its self-check (${errors.length} error(s)); nothing written\n`);
    return 2;
  }

  if (toStdout) {
    io.stdout(text);
    return 0;
  }
  writeFileSync(outPath!, text, "utf8");
  io.stderr(`wrote ${args.out} (state "${args.state}")\n`);
  return 0;
}

function check(args: ParsedArgs, schema: ReturnType<typeof generateStateSchema>["schema"], io: CliIo): number {
  const manifestPath = resolve(io.cwd(), args.manifest);
  if (!existsSync(manifestPath)) {
    io.stderr(`cannot read ${args.manifest}: no such file (run \`wcs-schema emit\` first)\n`);
    return 2;
  }
  const comparison = compareStateSchema(readFileSync(manifestPath, "utf8"), args.state, schema);
  switch (comparison.kind) {
    case "same":
      io.stderr(`${args.manifest}: state "${args.state}" is up to date\n`);
      return 0;
    case "missing-state":
      io.stderr(`${args.manifest}: state "${args.state}" has no stateSchema (run \`wcs-schema emit --merge\`)\n`);
      return 2;
    case "broken":
      io.stderr(`${args.manifest}: broken JSON: ${comparison.message}\n`);
      return 2;
    case "differs":
      io.stderr(`${args.manifest}: state "${args.state}" is out of date (${comparison.changes.length} change(s)):\n`);
      for (const change of comparison.changes) io.stderr(`  ${change}\n`);
      io.stderr(`run \`wcs-schema emit --merge --out=${args.manifest}\` to update it\n`);
      return 1;
  }
}

/* v8 ignore start -- process plumbing; exercised by running the built bin, not by unit tests */
function defaultIo(): CliIo {
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
