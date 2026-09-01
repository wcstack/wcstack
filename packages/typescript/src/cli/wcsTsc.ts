/**
 * wcsTsc.ts — the `wcs-tsc` command: `tsc` over `.html` files.
 *
 *   wcs-tsc [--url-imports=any|error] [--wcs-defaults] [tsc arguments...]
 *
 * Every `<wcs-state>` inline `<script type="module">` is mapped through the same
 * Volar language plugin the VS Code extension uses (dist/tsc-core.cjs, built from
 * vscode-wcs), so `this.coutn++` fails CI with a `file.html(line,col): error TS2339`
 * exactly where the editor underlines it. The mechanism is vue-tsc's:
 * `@volar/typescript`'s `runTsc` patches the `typescript/lib/tsc.js` the project
 * already has to accept `.html` and to build the program through the plugin.
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
 * Peers: `typescript` (required), `@volar/typescript` + `@volar/language-core`
 * (optional — only this command needs them). Resolved from the project first,
 * then from this package's own location.
 *
 * Exit codes: tsc's own (0 clean / 1 type errors / 2 usage) — plus 2 when the peers
 * are missing or the arguments are invalid.
 */

import { existsSync, mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "../version.js";

export interface TscIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly cwd: () => string;
}

export interface TscArgs {
  readonly urlImports: "any" | "error";
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
  let wcsDefaults = false;
  let help = false;
  let version = false;
  const tscArgs: string[] = [];
  const invalid: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith("--url-imports=")) {
      const value = arg.slice("--url-imports=".length);
      if (value === "any" || value === "error") urlImports = value;
      else invalid.push(arg);
    } else if (arg === "--wcs-defaults") wcsDefaults = true;
    else if (arg === "--wcs-help") help = true;
    else if (arg === "--wcs-version") version = true;
    else tscArgs.push(arg);
  }
  return { urlImports, wcsDefaults, help, version, tscArgs, invalid };
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
export function auditConfig(configPath: string, ts: TypeScriptLike): ConfigAudit {
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  const raw = (read.config ?? {}) as { include?: unknown; files?: unknown; compilerOptions?: Record<string, unknown> };
  const parsed = ts.parseJsonConfigFileContent(read.config ?? {}, ts.sys, toPosix(dirname(configPath)), undefined, toPosix(configPath));
  const options = parsed.options as Record<string, unknown>;
  const missing: string[] = [];
  const include = Array.isArray(raw.include) ? (raw.include as string[]) : undefined;
  const coversHtml = (patterns: readonly string[]): boolean => patterns.some((p) => /\.html?$|\*\*\/\*$|\*$/.test(p) && !/\.(ts|js|tsx|jsx|mts|cts|mjs|cjs)$/.test(p));
  if (include !== undefined && !coversHtml(include)) missing.push('include: "**/*.html"');
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
}

/* v8 ignore start -- the real resolver / loader; tests inject fakes to keep tsc from exiting the process */
const defaultDeps: MainDeps = {
  resolve: (id, cwd) => resolveFromProject(id, cwd),
  load: (path) => createRequire(import.meta.url)(path),
};
/* v8 ignore stop */

/**
 * Prepare and run. Returns an exit code only on the paths that do not reach tsc;
 * tsc itself calls `process.exit` with its own code.
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

  const runTscPath = deps.resolve("@volar/typescript/lib/quickstart/runTsc.js", cwd);
  if (runTscPath === undefined) {
    io.stderr("wcs-tsc needs @volar/typescript (an optional peer): npm i -D @volar/typescript@~2.4.0 @volar/language-core@~2.4.0\n");
    return 2;
  }
  const tscPath = deps.resolve("typescript/lib/tsc.js", cwd);
  const tsApiPath = deps.resolve("typescript", cwd);
  if (tscPath === undefined || tsApiPath === undefined) {
    io.stderr("wcs-tsc needs typescript (a peer): npm i -D typescript\n");
    return 2;
  }
  const corePath = tscCoreCandidates(import.meta.url).find((p) => existsSync(p));
  /* v8 ignore next 4 -- tests run after `npm run build`, so the bundle is always present */
  if (corePath === undefined) {
    io.stderr("wcs-tsc: dist/tsc-core.cjs not found — run `npm run build` in packages/typescript\n");
    return 2;
  }

  const ts = deps.load(tsApiPath) as TypeScriptLike;
  const tscArgs = [...args.tscArgs];
  const temporaries: string[] = [];

  const project = findProjectConfig(tscArgs, cwd);
  if (project !== undefined && existsSync(project.path)) {
    const audit = auditConfig(project.path, ts);
    if (audit.missing.length > 0) {
      if (args.wcsDefaults) {
        const tempConfig = writeDefaultsConfig(project.path, audit);
        temporaries.push(tempConfig);
        if (project.index === -1) tscArgs.push("-p", tempConfig);
        else tscArgs[project.index] = tempConfig;
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
