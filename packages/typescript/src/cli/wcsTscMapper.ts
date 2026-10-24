/**
 * wcsTscMapper.ts — `wcs-tsc` on TypeScript 7.1 and later.
 *
 * TypeScript 7 has no `lib/tsc.js` to patch; it reads `.html` through the content
 * mapper this package declares (`typescript.contentMapper` in package.json, built
 * from packages/vscode-wcs — docs/typescript-content-mapper.md). `wcs-tsc` stays one
 * command across both worlds: it runs the project's own `tsc` with
 * `--runExternalCode`, and when the project's tsconfig does not name the mapper, with
 * a temporary config next to it that `extends` it and adds the mapper:
 *
 *   { "extends": "./tsconfig.json",
 *     "contentMappers": [ ...inherited, { "package": "@wcstack/typescript", "extensions": [".html"] } ] }
 *
 * A config's `contentMappers` replaces the inherited array, so the inherited entries
 * are copied (tsconfigChain.ts). TypeScript resolves the mapper package from the
 * config's directory, so the project must have `@wcstack/typescript` installed —
 * `wcs-tsc` checks that first, because `tsc --showConfig` (used to audit what the
 * check needs) does not report a mapper it cannot resolve: the `.html` files just
 * disappear from `files`.
 *
 * The temporary config has a fixed name (`.wcs-tsc.<config file name>`), so an
 * `incremental` project keeps one `.tsbuildinfo` for it instead of a new one per run;
 * two runs on the same config at the same time share it. It is removed on exit and on
 * SIGINT / SIGTERM / SIGHUP (SIGBREAK on Windows).
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { constants } from "node:os";
import { basename, dirname, join } from "node:path";
import { effectiveContentMappers, type ContentMapperEntry } from "./tsconfigChain.js";
import type { TscArgs, TscIo } from "./wcsTsc.js";
import { VERSION } from "../version.js";

/** The package TypeScript loads the mapper from, as a tsconfig names it. */
export const MAPPER_PACKAGE = "@wcstack/typescript";

/** Run `node <file> ...args`: tsc's output goes to the terminal, or `stdout` is captured. */
export type RunCommand = (file: string, args: readonly string[], options: { readonly cwd: string; readonly capture: boolean }) => {
  readonly status: number | null;
  readonly stdout: string;
};

export interface MapperRun {
  /** The project's TypeScript version (7.1 or later). */
  readonly version: string;
  /** Its `typescript/package.json` and that file's contents. */
  readonly tsPackagePath: string;
  readonly tsPackage: { readonly bin?: unknown };
  readonly args: TscArgs;
  /** The tsconfig tsc reads (`-p`, or ./tsconfig.json), and the index of the `-p` value in `args.tscArgs` (-1: none). */
  readonly project: { readonly path: string; readonly index: number } | undefined;
  readonly io: TscIo;
  readonly run: RunCommand;
}

/** `tsc`'s bin in the project's `typescript` (7 has no `typescript/lib/tsc.js` export). */
export function tscBinOf(tsPackagePath: string, tsPackage: { readonly bin?: unknown }): string {
  const bin = tsPackage.bin;
  const relative = typeof bin === "string" ? bin
    : typeof bin === "object" && bin !== null && typeof (bin as Record<string, unknown>).tsc === "string" ? (bin as Record<string, string>).tsc
    : "bin/tsc";
  return join(dirname(tsPackagePath), relative);
}

/** `@wcstack/typescript` as TypeScript would find it from `dir` (node_modules, walking up). */
export function findInstalledMapper(dir: string): { readonly path: string; readonly version: string } | undefined {
  for (let at = dir; ; at = dirname(at)) {
    const path = join(at, "node_modules", "@wcstack", "typescript", "package.json");
    if (existsSync(path)) {
      try {
        const pkg = JSON.parse(readFileSync(path, "utf8")) as { name?: unknown; version?: unknown };
        if (pkg.name === MAPPER_PACKAGE) return { path, version: String(pkg.version) };
      } catch {
        /* an unreadable package.json is not the mapper */
      }
    }
    if (dirname(at) === at) return undefined;
  }
}

/** `tscArgs` reading `configPath` instead of the project's config. */
export function argsWithProject(tscArgs: readonly string[], index: number, configPath: string): string[] {
  const args = [...tscArgs];
  if (index >= 0) {
    const flag = args[index].startsWith("-") ? args[index] : undefined;
    if (flag !== undefined) args[index] = `${flag.slice(0, flag.indexOf("=") + 1)}${configPath}`;
    else args[index] = configPath;
  } else {
    args.push("-p", configPath);
  }
  return args;
}

/** What the HTML check needs and `configPath` (as tsc resolves it) lacks. */
export interface MapperAudit {
  readonly missing: readonly string[];
  /** The resolved `include`, relative to the config's directory (tsc rebases inherited patterns). */
  readonly include: readonly string[] | undefined;
  readonly hasFiles: boolean;
  readonly needsHtml: boolean;
  readonly needsNoImplicitThis: boolean;
}

/** Read `tsc --showConfig` output; `undefined` when tsc could not show the config (the real run reports why). */
export function auditShownConfig(shown: string): MapperAudit | undefined {
  let config: { compilerOptions?: Record<string, unknown>; include?: unknown; files?: unknown };
  try {
    config = JSON.parse(shown) as typeof config;
  } catch {
    return undefined;
  }
  const files = Array.isArray(config.files) ? (config.files as unknown[]) : [];
  const options = config.compilerOptions ?? {};
  // TypeScript 7's default is `strict: true`, which turns noImplicitThis on.
  const noImplicitThis = options.noImplicitThis ?? options.strict ?? true;
  const needsHtml = !files.some((file) => typeof file === "string" && /\.html$/i.test(file));
  const needsNoImplicitThis = noImplicitThis !== true;
  const missing: string[] = [];
  if (needsHtml) missing.push('include: "**/*.html" (no .html file is in the program)');
  if (needsNoImplicitThis) missing.push("compilerOptions.noImplicitThis: true");
  return {
    missing,
    include: Array.isArray(config.include) ? (config.include as string[]) : undefined,
    hasFiles: files.length > 0,
    needsHtml,
    needsNoImplicitThis,
  };
}

/**
 * Run the project's tsc with the content mapper. Returns tsc's exit code (0 clean; 1 or 2
 * with errors), or 2 when it cannot start.
 */
export function runWithContentMapper(context: MapperRun): number {
  const { args, io, run, version } = context;
  const cwd = io.cwd();
  const tscBin = tscBinOf(context.tsPackagePath, context.tsPackage);
  const tscArgs = args.tscArgs.filter((arg) => arg !== "--runExternalCode");

  if (tscArgs.some((arg) => arg === "-b" || arg === "--build")) {
    io.stderr(`wcs-tsc: --build runs tsc as it is: each project's tsconfig has to name ${MAPPER_PACKAGE} in "contentMappers" for its HTML to be checked\n`);
    if (args.urlImportsExplicit) io.stderr(`wcs-tsc: --url-imports has no effect with --build; set "options": { "urlImports": … } on the contentMappers entry\n`);
    return run(tscBin, [...tscArgs, "--runExternalCode"], { cwd, capture: false }).status ?? 1;
  }

  const project = context.project;
  if (project === undefined || !existsSync(project.path)) {
    const why = project === undefined ? `there is no tsconfig.json in ${cwd}` : `${project.path} does not exist`;
    io.stderr(`wcs-tsc: TypeScript ${version} checks <wcs-state> through a content mapper named in the project's tsconfig, and ${why}: pass -p <tsconfig>\n`);
    return 2;
  }
  const configDir = dirname(project.path);
  const installed = findInstalledMapper(configDir);
  if (installed === undefined) {
    io.stderr(`wcs-tsc: TypeScript ${version} loads the content mapper from ${MAPPER_PACKAGE} installed for ${project.path}, and there is none: npm i -D ${MAPPER_PACKAGE}\n`);
    return 2;
  }
  if (installed.version !== VERSION) {
    io.stderr(`wcs-tsc: the project has ${MAPPER_PACKAGE} ${installed.version} and this wcs-tsc is ${VERSION}; TypeScript runs the project's content mapper\n`);
  }

  const declared = effectiveContentMappers(project.path);
  const inherited: readonly ContentMapperEntry[] = declared?.entries ?? [];
  const named = inherited.some((entry) => entry.package === MAPPER_PACKAGE);
  if (!named) {
    const clash = inherited.find((entry) => Array.isArray(entry.extensions) && entry.extensions.includes(".html"));
    if (clash !== undefined) {
      io.stderr(`wcs-tsc: ${declared!.from} maps .html with ${String(clash.package)}, and TypeScript takes one content mapper per extension: map .html with ${MAPPER_PACKAGE} there\n`);
      return 2;
    }
  } else if (args.urlImportsExplicit) {
    io.stderr(`wcs-tsc: --url-imports is ignored: ${declared!.from} configures ${MAPPER_PACKAGE}; set "options": { "urlImports": … } on its entry\n`);
  }

  const tempPath = join(configDir, `.wcs-tsc.${basename(project.path)}`);
  const temporary: Record<string, unknown> = { extends: `./${basename(project.path)}` };
  if (!named) {
    const ours: ContentMapperEntry = { package: MAPPER_PACKAGE, extensions: [".html"], ...(args.urlImports === "error" ? { options: { urlImports: "error" } } : {}) };
    temporary.contentMappers = [...inherited, ours];
  }
  const files: string[] = [];
  const writeTemporary = (): string => {
    writeFileSync(tempPath, JSON.stringify(temporary, null, 2), "utf8");
    if (!files.includes(tempPath)) files.push(tempPath);
    return tempPath;
  };

  return withCleanup(files, () => {
    let config = named ? project.path : writeTemporary();
    const showArgs = argsWithProject(tscArgs, project.index, config).filter((arg) => arg !== "-w" && arg !== "--watch");
    const shown = run(tscBin, [...showArgs, "--showConfig", "--runExternalCode"], { cwd, capture: true });
    const audit = shown.status === 0 ? auditShownConfig(shown.stdout) : undefined;
    if (audit !== undefined && audit.missing.length > 0) {
      if (args.wcsDefaults) {
        if (audit.needsNoImplicitThis) temporary.compilerOptions = { noImplicitThis: true };
        if (audit.needsHtml) temporary.include = [...(audit.include ?? (audit.hasFiles ? [] : ["**/*"])), "**/*.html"];
        config = writeTemporary();
        io.stderr(`wcs-tsc: running with a temporary config that adds ${audit.missing.join(", ")} (--wcs-defaults)\n`);
      } else {
        io.stderr(`wcs-tsc: ${project.path} is missing ${audit.missing.join(", ")} — HTML may not be checked; pass --wcs-defaults or add them\n`);
      }
    }
    return run(tscBin, [...argsWithProject(tscArgs, project.index, config), "--runExternalCode"], { cwd, capture: false }).status ?? 1;
  });
}

/** Run `body`, removing `files` afterwards — also when the process exits or is interrupted. */
export function withCleanup<T>(files: string[], body: () => T): T {
  const cleanup = (): void => {
    for (const file of files.splice(0)) {
      try {
        unlinkSync(file);
      } catch {
        /* already gone */
      }
    }
  };
  // tsc runs synchronously; a signal is delivered to these listeners once it returns.
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP", ...(process.platform === "win32" ? (["SIGBREAK"] as NodeJS.Signals[]) : [])];
  const onSignal = (signal: NodeJS.Signals): void => {
    cleanup();
    process.exit(128 + (constants.signals[signal] ?? 0));
  };
  for (const signal of signals) process.on(signal, onSignal);
  process.on("exit", cleanup);
  try {
    return body();
  } finally {
    cleanup();
    for (const signal of signals) process.off(signal, onSignal);
    process.off("exit", cleanup);
  }
}
