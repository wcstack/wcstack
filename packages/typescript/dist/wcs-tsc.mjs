#!/usr/bin/env node
import { existsSync, mkdtempSync, writeFileSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, isAbsolute, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

var version = "2.1.0";
var pkg = {
	version: version};

const VERSION = pkg.version;

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
const USAGE = "usage: wcs-tsc [--url-imports=any|error] [--wcs-defaults] [tsc arguments...]\n" +
    "       e.g. wcs-tsc --noEmit            wcs-tsc -p tsconfig.json --noEmit\n";
function parseTscArgs(argv) {
    let urlImports = "any";
    let wcsDefaults = false;
    let help = false;
    let version = false;
    const tscArgs = [];
    const invalid = [];
    for (const arg of argv) {
        if (arg.startsWith("--url-imports=")) {
            const value = arg.slice("--url-imports=".length);
            if (value === "any" || value === "error")
                urlImports = value;
            else
                invalid.push(arg);
        }
        else if (arg === "--wcs-defaults")
            wcsDefaults = true;
        else if (arg === "--wcs-help")
            help = true;
        else if (arg === "--wcs-version")
            version = true;
        else
            tscArgs.push(arg);
    }
    return { urlImports, wcsDefaults, help, version, tscArgs, invalid };
}
/** Resolve a module from the project (cwd) first, then from this package. */
function resolveFromProject(id, cwd, fromUrl = import.meta.url) {
    for (const base of [join(cwd, "__wcs_tsc_resolve__.js"), fromUrl]) {
        try {
            return createRequire(base).resolve(id);
        }
        catch {
            /* try the next base */
        }
    }
    return undefined;
}
/** The tsconfig tsc will read: `-p/--project` (a file or a directory), else ./tsconfig.json. */
function findProjectConfig(tscArgs, cwd) {
    for (let i = 0; i < tscArgs.length; i++) {
        const arg = tscArgs[i];
        let value;
        let index = i;
        if (arg === "-p" || arg === "--project") {
            value = tscArgs[i + 1];
            index = i + 1;
        }
        else if (arg.startsWith("--project=") || arg.startsWith("-p=")) {
            value = arg.slice(arg.indexOf("=") + 1);
        }
        if (value === undefined)
            continue;
        let path = isAbsolute(value) ? value : resolve(cwd, value);
        if (existsSync(path) && !path.endsWith(".json"))
            path = join(path, "tsconfig.json");
        return { path, index };
    }
    const fallback = join(cwd, "tsconfig.json");
    return existsSync(fallback) ? { path: fallback, index: -1 } : undefined;
}
/**
 * Check the project tsconfig for what the HTML check needs. `include` is only
 * checked when present (tsc's default `**\/*` already picks `.html` up once the
 * extension is registered); a `files`-only config never sees HTML.
 */
function auditConfig(configPath, ts) {
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    const raw = (read.config ?? {});
    const parsed = ts.parseJsonConfigFileContent(read.config ?? {}, ts.sys, toPosix(dirname(configPath)), undefined, toPosix(configPath));
    const options = parsed.options;
    const missing = [];
    const include = Array.isArray(raw.include) ? raw.include : undefined;
    const coversHtml = (patterns) => patterns.some((p) => /\.html?$|\*\*\/\*$|\*$/.test(p) && !/\.(ts|js|tsx|jsx|mts|cts|mjs|cjs)$/.test(p));
    if (include !== undefined && !coversHtml(include))
        missing.push('include: "**/*.html"');
    else if (include === undefined && Array.isArray(raw.files))
        missing.push('include: "**/*.html" (a files-only config never sees HTML)');
    // `strict: true` implies noImplicitThis unless it is explicitly turned off.
    const noImplicitThis = options.noImplicitThis ?? options.strict === true;
    if (noImplicitThis !== true)
        missing.push("compilerOptions.noImplicitThis: true");
    if (options.allowJs !== true)
        missing.push("compilerOptions.allowJs: true");
    if (options.checkJs !== true)
        missing.push("compilerOptions.checkJs: true");
    // With neither target nor lib, tsc's ES5 default lib has no Map / Set / Promise:
    // the preamble's `_WcsThis<T>` degrades silently and `this.typo` stops being an error.
    const target = options.target;
    const needsTarget = options.lib === undefined && (target === undefined || target < ts.ScriptTarget.ES2015);
    if (needsTarget)
        missing.push('compilerOptions.target: "ES2015" or later (the this-typing preamble uses Map / Set / Promise)');
    return { missing, include, compilerOptions: raw.compilerOptions ?? {}, needsTarget };
}
/** Write a temporary config next to the project one that extends it with the missing pieces. */
function writeDefaultsConfig(configPath, audit) {
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
function writeUrlImportsDeclaration() {
    const dir = mkdtempSync(join(tmpdir(), "wcs-tsc-"));
    const path = join(dir, "url-imports.d.ts");
    writeFileSync(path, `// wcs-tsc --url-imports=any: CDN module imports resolve to any.\ndeclare module "https://*";\ndeclare module "http://*";\n`, "utf8");
    return path;
}
function toPosix(path) {
    return path.replace(/\\/g, "/");
}
function tscCoreCandidates(fromUrl) {
    const here = dirname(fileURLToPath(fromUrl));
    return [join(here, "tsc-core.cjs"), join(here, "..", "dist", "tsc-core.cjs"), join(here, "..", "..", "dist", "tsc-core.cjs")];
}
/* v8 ignore start -- the real resolver / loader; tests inject fakes to keep tsc from exiting the process */
const defaultDeps = {
    resolve: (id, cwd) => resolveFromProject(id, cwd),
    load: (path) => createRequire(import.meta.url)(path),
};
/* v8 ignore stop */
/**
 * Prepare and run. Returns an exit code only on the paths that do not reach tsc;
 * tsc itself calls `process.exit` with its own code.
 */
function main(argv, io = defaultIo(), deps = defaultDeps) {
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
    const ts = deps.load(tsApiPath);
    const tscArgs = [...args.tscArgs];
    const temporaries = [];
    const project = findProjectConfig(tscArgs, cwd);
    if (project !== undefined && existsSync(project.path)) {
        const audit = auditConfig(project.path, ts);
        if (audit.missing.length > 0) {
            if (args.wcsDefaults) {
                const tempConfig = writeDefaultsConfig(project.path, audit);
                temporaries.push(tempConfig);
                if (project.index === -1)
                    tscArgs.push("-p", tempConfig);
                else
                    tscArgs[project.index] = tempConfig;
                io.stderr(`wcs-tsc: running with a temporary config that adds ${audit.missing.join(", ")} (--wcs-defaults)\n`);
            }
            else {
                io.stderr(`wcs-tsc: ${project.path} is missing ${audit.missing.join(", ")} — HTML may not be checked; pass --wcs-defaults or add them\n`);
            }
        }
    }
    const declaration = args.urlImports === "any" ? writeUrlImportsDeclaration() : undefined;
    if (declaration !== undefined)
        temporaries.push(declaration);
    const { createWcsLanguagePlugin } = deps.load(corePath);
    const { runTsc } = deps.load(runTscPath);
    const cleanup = () => {
        for (const file of temporaries.splice(0)) {
            /* v8 ignore next -- a temp file that vanished before cleanup is not an error */
            try {
                unlinkSync(file);
            }
            catch { /* best effort */ }
        }
    };
    process.once("exit", cleanup);
    // tsc reads its arguments from process.argv when typescript/lib/tsc.js loads.
    process.argv = [process.argv[0], tscPath, ...tscArgs];
    runTsc(tscPath, { extraSupportedExtensions: [".html"], extraExtensionsToRemove: [] }, (_ts, options) => {
        if (declaration !== undefined)
            options.rootNames.push(declaration);
        // tsc mode: proxyCreateProgram supports one service script per file, so every
        // <wcs-state> block of a page is combined into one virtual TS module.
        return [createWcsLanguagePlugin("wcs-state", { mode: "tsc" })];
    });
    // Reached only when runTsc returns (tsc normally exits the process itself).
    cleanup();
    return 0;
}
/* v8 ignore start -- process plumbing; exercised by running the built bin */
function defaultIo() {
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
    if (code !== 0)
        process.exit(code);
}
/* v8 ignore stop */

export { auditConfig, findProjectConfig, main, parseTscArgs, resolveFromProject, writeDefaultsConfig, writeUrlImportsDeclaration };
//# sourceMappingURL=wcs-tsc.mjs.map
