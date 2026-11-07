/**
 * wcsTsc.ts — the `wcs-tsc` command: `tsc` over `.html` files.
 *
 *   wcs-tsc [--url-imports=any|error] [--wcs-defaults] [tsc arguments...]
 *
 * Every `<wcs-state>` inline `<script type="module">` is mapped through the same
 * Volar language plugin the VS Code extension uses (dist/tsc-core.cjs, built from
 * vscode-wcs), so `this.coutn++` fails CI with a `file.html(line,col): error TS2339`
 * exactly where the editor underlines it. On TypeScript 5 and 6 the mechanism is
 * vue-tsc's: `@volar/typescript`'s `runTsc` patches the `typescript/lib/tsc.js` the
 * project already has to accept `.html` and to build the program through the plugin.
 * On TypeScript 7.1 and later it is the content mapper this package declares, run by
 * the project's own `tsc --runExternalCode` (wcsTscMapper.ts).
 *
 * Options
 *   --url-imports=any    (default) treat every `https://` / `http://` module import
 *                        as `any` — buildless pages import from a CDN, and tsc has
 *                        nothing to resolve those against. `@wcstack/state` URL
 *                        imports are stripped by the plugin and typed by its preamble.
 *   --url-imports=error  leave URL imports alone (TS2307 for each).
 *   --wcs-defaults       when the project tsconfig lacks what the check needs
 *                        (`include` covering `**\/*.html`, `noImplicitThis`, `allowJs`,
 *                        `checkJs`), run with a temporary config that extends it and
 *                        adds them, instead of only warning.
 *
 * Peers: `typescript` (required: 5 or 6, or 7.1 and later — 7.0 has neither lib/tsc.js
 * nor content mappers, see typescriptSupport.ts), `@volar/typescript` +
 * `@volar/language-core` (optional — only this command needs them, and only on 5 / 6).
 * Resolved from the project first, then from this package's own location.
 *
 * Exit codes: tsc's own (0 clean; 1 or 2 with errors — tsc gives 2 for type errors
 * when it does not skip emitting, `--noEmit` included) — plus 2 when the peers are
 * missing or unsupported, or the arguments are invalid. A refusal and a type error
 * can both be 2; the message on stderr tells them apart.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { typeScriptSupport, unsupportedTscMessage } from "../typescriptSupport.js";
import { argsWithProject, runWithContentMapper, type RunCommand } from "./wcsTscMapper.js";
import { VERSION } from "../version.js";

export interface TscIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly cwd: () => string;
}

export interface TscArgs {
  readonly urlImports: "any" | "error";
  /** `--url-imports` was given (on 7.1, a tsconfig that configures the mapper wins over it). */
  readonly urlImportsExplicit: boolean;
  readonly wcsDefaults: boolean;
  readonly help: boolean;
  readonly version: boolean;
  /** Everything else, handed to tsc verbatim. */
  readonly tscArgs: readonly string[];
  readonly invalid: readonly string[];
}

const USAGE =
  "usage: wcs-tsc [--url-imports=any|error] [--wcs-defaults] [tsc arguments...]\n" +
  "       e.g. wcs-tsc --noEmit            wcs-tsc -p tsconfig.json --noEmit\n";

export function parseTscArgs(argv: readonly string[]): TscArgs {
  let urlImports: TscArgs["urlImports"] = "any";
  let urlImportsExplicit = false;
  let wcsDefaults = false;
  let help = false;
  let version = false;
  const tscArgs: string[] = [];
  const invalid: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith("--url-imports=")) {
      const value = arg.slice("--url-imports=".length);
      if (value === "any" || value === "error") {
        urlImports = value;
        urlImportsExplicit = true;
      } else invalid.push(arg);
    } else if (arg === "--wcs-defaults") wcsDefaults = true;
    else if (arg === "--wcs-help") help = true;
    else if (arg === "--wcs-version") version = true;
    else tscArgs.push(arg);
  }
  return { urlImports, urlImportsExplicit, wcsDefaults, help, version, tscArgs, invalid };
}

/** Resolve a module from the project (cwd) first, then from this package. */
export function resolveFromProject(id: string, cwd: string, fromUrl: string = import.meta.url): string | undefined {
  for (const base of [join(cwd, "__wcs_tsc_resolve__.js"), fromUrl]) {
    try {
      return createRequire(base).resolve(id);
    } catch {
      /* try the next base */
    }
  }
  return undefined;
}

/** The tsconfig tsc will read: `-p/--project` (a file or a directory), else ./tsconfig.json. */
export function findProjectConfig(tscArgs: readonly string[], cwd: string): { path: string; index: number } | undefined {
  for (let i = 0; i < tscArgs.length; i++) {
    const arg = tscArgs[i];
    let value: string | undefined;
    let index = i;
    if (arg === "-p" || arg === "--project") {
      value = tscArgs[i + 1];
      index = i + 1;
    } else if (arg.startsWith("--project=") || arg.startsWith("-p=")) {
      value = arg.slice(arg.indexOf("=") + 1);
    }
    if (value === undefined) continue;
    let path = isAbsolute(value) ? value : resolve(cwd, value);
    if (existsSync(path) && !path.endsWith(".json")) path = join(path, "tsconfig.json");
    return { path, index };
  }
  const fallback = join(cwd, "tsconfig.json");
  return existsSync(fallback) ? { path: fallback, index: -1 } : undefined;
}

export interface ConfigAudit {
  /** Human-readable names of what is missing (empty = ready). */
  readonly missing: readonly string[];
  readonly include: readonly string[] | undefined;
  readonly compilerOptions: Readonly<Record<string, unknown>>;
  /** No `target` / `lib` at all (tsc defaults to ES5, whose lib lacks the Map / Set / Promise types the `this` preamble uses). */
  readonly needsTarget: boolean;
}

/**
 * Check the project tsconfig for what the HTML check needs. `include` is only
 * checked when present (tsc's default `**\/*` already picks `.html` up once the
 * extension is registered); a `files`-only config never sees HTML.
 */
/**
 * Whether an `include` pattern reaches `.html`, read as tsc reads it: a last segment with
 * neither an extension nor a wildcard names a directory (`src` is `src/**\/*`), a trailing
 * wildcard (`**\/*`, `src/*`) takes every supported extension — `.html` among them under
 * wcs-tsc — and any other pattern names its own extension.
 */
export function includeCoversHtml(pattern: string): boolean {
  const last = pattern.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? "";
  if (/\.html?$/.test(last)) return true;
  if (/[*?]/.test(last)) return last.endsWith("*");
  return last === "." || last === ".." || !last.includes(".");
}

export function auditConfig(configPath: string, ts: TypeScriptLike): ConfigAudit {
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  const raw = (read.config ?? {}) as { include?: unknown; files?: unknown; compilerOptions?: Record<string, unknown> };
  const parsed = ts.parseJsonConfigFileContent(read.config ?? {}, ts.sys, toPosix(dirname(configPath)), undefined, toPosix(configPath));
  const options = parsed.options as Record<string, unknown>;
  const missing: string[] = [];
  const include = Array.isArray(raw.include) ? (raw.include as string[]) : undefined;
  if (include !== undefined && !include.some(includeCoversHtml)) missing.push('include: "**/*.html"');
  else if (include === undefined && Array.isArray(raw.files)) missing.push('include: "**/*.html" (a files-only config never sees HTML)');
  // `strict: true` implies noImplicitThis unless it is explicitly turned off.
  const noImplicitThis = options.noImplicitThis ?? options.strict === true;
  if (noImplicitThis !== true) missing.push("compilerOptions.noImplicitThis: true");
  if (options.allowJs !== true) missing.push("compilerOptions.allowJs: true");
  if (options.checkJs !== true) missing.push("compilerOptions.checkJs: true");
  // With neither target nor lib, tsc's ES5 default lib has no Map / Set / Promise:
  // the preamble's `_WcsThis<T>` degrades silently and `this.typo` stops being an error.
  const target = options.target as number | undefined;
  const needsTarget = options.lib === undefined && (target === undefined || target < ts.ScriptTarget.ES2015);
  if (needsTarget) missing.push('compilerOptions.target: "ES2015" or later (the this-typing preamble uses Map / Set / Promise)');
  return { missing, include, compilerOptions: raw.compilerOptions ?? {}, needsTarget };
}

/** Write a temporary config next to the project one that extends it with the missing pieces. */
export function writeDefaultsConfig(configPath: string, audit: ConfigAudit): string {
  const dir = dirname(configPath);
  const tempPath = join(dir, `.wcs-tsc.${process.pid}.tsconfig.json`);
  const include = audit.include !== undefined ? [...audit.include, "**/*.html"] : ["**/*", "**/*.html"];
  const config = {
    extends: `./${basename(configPath)}`,
    compilerOptions: {
      allowJs: true,
      checkJs: true,
      noImplicitThis: true,
      // only when the project set neither target nor lib — never override an explicit choice
      ...(audit.needsTarget ? { target: "ESNext" } : {}),
    },
    include,
  };
  writeFileSync(tempPath, JSON.stringify(config, null, 2), "utf8");
  return tempPath;
}

/** Ambient shorthand modules: every `http(s)://` import types as `any`. */
export function writeUrlImportsDeclaration(): string {
  const dir = mkdtempSync(join(tmpdir(), "wcs-tsc-"));
  const path = join(dir, "url-imports.d.ts");
  writeFileSync(path, `// wcs-tsc --url-imports=any: CDN module imports resolve to any.\ndeclare module "https://*";\ndeclare module "http://*";\n`, "utf8");
  return path;
}

export interface TypeScriptLike {
  readConfigFile(path: string, readFile: (path: string) => string | undefined): { config?: unknown; error?: unknown };
  parseJsonConfigFileContent(json: unknown, host: unknown, basePath: string, existing?: unknown, configFileName?: string): { options: unknown };
  sys: { readFile(path: string): string | undefined };
  ScriptTarget: { ES2015: number };
}

function toPosix(path: string): string {
  return path.replace(/\\/g, "/");
}

function tscCoreCandidates(fromUrl: string): string[] {
  const here = dirname(fileURLToPath(fromUrl));
  return [join(here, "tsc-core.cjs"), join(here, "..", "dist", "tsc-core.cjs"), join(here, "..", "..", "dist", "tsc-core.cjs")];
}

/** Module resolution / loading, injectable so the whole flow can be tested in-process. */
export interface MainDeps {
  readonly resolve: (id: string, cwd: string) => string | undefined;
  readonly load: (path: string) => unknown;
  /** Runs the project's tsc on TypeScript 7.1 and later (`node <bin> ...args`). */
  readonly run?: RunCommand;
}

/* v8 ignore start -- the real resolver / loader / runner; tests inject fakes to keep tsc from exiting the process */
const defaultRun: RunCommand = (file, args, options) => {
  const result = spawnSync(process.execPath, [file, ...args], {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  return { status: result.status, stdout: result.stdout ?? "" };
};

const defaultDeps: MainDeps = {
  resolve: (id, cwd) => resolveFromProject(id, cwd),
  load: (path) => createRequire(import.meta.url)(path),
  run: defaultRun,
};
/* v8 ignore stop */

/**
 * Prepare and run. On TypeScript 5 / 6, returns an exit code only on the paths that do
 * not reach tsc; tsc itself calls `process.exit` with its own code. On 7.1 and later,
 * returns tsc's exit code.
 */
export function main(argv: readonly string[], io: TscIo = defaultIo(), deps: MainDeps = defaultDeps): number {
  const args = parseTscArgs(argv);
  if (args.version) {
    io.stdout(`${VERSION}\n`);
    return 0;
  }
  if (args.help) {
    io.stdout(USAGE);
    return 0;
  }
  if (args.invalid.length > 0) {
    io.stderr(`invalid option(s): ${args.invalid.join(" ")}\n${USAGE}`);
    return 2;
  }
  const cwd = io.cwd();

  // TypeScript 7 resolves as `typescript` but has no lib/tsc.js: 7.1 and later take the
  // content mapper, and 7.0 is named rather than reported as typescript missing.
  const tsPackagePath = deps.resolve("typescript/package.json", cwd);
  const tsPackage = tsPackagePath === undefined ? undefined : (deps.load(tsPackagePath) as { version?: string; bin?: unknown });
  const version = tsPackage?.version ?? "";
  const support = typeScriptSupport(version);
  if (support === "unsupported") {
    io.stderr(`wcs-tsc: ${unsupportedTscMessage(version)}\n`);
    return 2;
  }
  if (support === "content-mapper") {
    return runWithContentMapper({
      version,
      tsPackagePath: tsPackagePath as string,
      tsPackage: tsPackage as { bin?: unknown },
      args,
      project: findProjectConfig(args.tscArgs, cwd),
      io,
      run: deps.run ?? defaultRun,
    });
  }

  const runTscPath = deps.resolve("@volar/typescript/lib/quickstart/runTsc.js", cwd);
  if (runTscPath === undefined) {
    io.stderr("wcs-tsc needs @volar/typescript (an optional peer): npm i -D @volar/typescript@~2.4.0 @volar/language-core@~2.4.0\n");
    return 2;
  }
  const tscPath = deps.resolve("typescript/lib/tsc.js", cwd);
  const tsApiPath = deps.resolve("typescript", cwd);
  if (tscPath === undefined || tsApiPath === undefined) {
    io.stderr("wcs-tsc needs typescript (a peer): npm i -D typescript@6\n");
    return 2;
  }
  const corePath = tscCoreCandidates(import.meta.url).find((p) => existsSync(p));
  /* v8 ignore next 4 -- tests run after `npm run build`, so the bundle is always present */
  if (corePath === undefined) {
    io.stderr("wcs-tsc: dist/tsc-core.cjs not found — run `npm run build` in packages/typescript\n");
    return 2;
  }

  const ts = deps.load(tsApiPath) as TypeScriptLike;
  let tscArgs = [...args.tscArgs];
  const temporaries: string[] = [];

  const project = findProjectConfig(tscArgs, cwd);
  if (project !== undefined && existsSync(project.path)) {
    const audit = auditConfig(project.path, ts);
    if (audit.missing.length > 0) {
      if (args.wcsDefaults) {
        const tempConfig = writeDefaultsConfig(project.path, audit);
        temporaries.push(tempConfig);
        tscArgs = argsWithProject(tscArgs, project.index, tempConfig);
        io.stderr(`wcs-tsc: running with a temporary config that adds ${audit.missing.join(", ")} (--wcs-defaults)\n`);
      } else {
        io.stderr(`wcs-tsc: ${project.path} is missing ${audit.missing.join(", ")} — HTML may not be checked; pass --wcs-defaults or add them\n`);
      }
    }
  }

  const declaration = args.urlImports === "any" ? writeUrlImportsDeclaration() : undefined;
  if (declaration !== undefined) temporaries.push(declaration);

  const { createWcsLanguagePlugin } = deps.load(corePath) as {
    createWcsLanguagePlugin: (stateTagName?: string, options?: { mode: "tsc" }) => unknown;
  };
  const { runTsc } = deps.load(runTscPath) as {
    runTsc: (
      tscPath: string,
      options: { extraSupportedExtensions: string[]; extraExtensionsToRemove: string[] },
      getLanguagePlugins: (ts: unknown, options: { rootNames: readonly string[] }) => unknown[],
    ) => unknown;
  };

  const cleanup = (): void => {
    for (const file of temporaries.splice(0)) {
      /* v8 ignore next -- a temp file that vanished before cleanup is not an error */
      try { unlinkSync(file); } catch { /* best effort */ }
    }
  };
  process.once("exit", cleanup);

  // tsc reads its arguments from process.argv when typescript/lib/tsc.js loads.
  process.argv = [process.argv[0], tscPath, ...tscArgs];
  runTsc(
    tscPath,
    { extraSupportedExtensions: [".html"], extraExtensionsToRemove: [] },
    (_ts, options) => {
      if (declaration !== undefined) (options.rootNames as string[]).push(declaration);
      // tsc mode: proxyCreateProgram supports one service script per file, so every
      // <wcs-state> block of a page is combined into one virtual TS module.
      return [createWcsLanguagePlugin("wcs-state", { mode: "tsc" })];
    },
  );
  // Reached only when runTsc returns (tsc normally exits the process itself).
  cleanup();
  return 0;
}

/* v8 ignore start -- process plumbing; exercised by running the built bin */
function defaultIo(): TscIo {
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    cwd: () => process.cwd(),
  };
}

const invokedAsBin = typeof process !== "undefined"
  && Array.isArray(process.argv)
  && /wcs-tsc(\.mjs)?$/.test(process.argv[1] ?? "");
if (invokedAsBin) {
  const code = main(process.argv.slice(2));
  if (code !== 0) process.exit(code);
}
/* v8 ignore stop */
