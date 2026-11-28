#!/usr/bin/env node
import { existsSync, mkdtempSync, writeFileSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, isAbsolute, resolve, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * typescriptSupport.ts — which `typescript` this package can run on.
 *
 * Both commands drive the JavaScript compiler API of TypeScript 5 and 6:
 * `wcs-schema` through `import ts from "typescript"`, `wcs-tsc` by running the
 * project's `typescript/lib/tsc.js` through Volar's `runTsc`. TypeScript 7 (the
 * native compiler) publishes neither — its `typescript` export is
 * `{ version, versionMajorMinor }` and its `exports` has no `./lib/tsc` — so both
 * refuse it by name instead of failing on what is missing. TypeScript 7 reads other
 * file types through content mappers (7.1); this package does not provide one yet.
 */
/** The version, when it is one neither command can run on (7 and later); otherwise `undefined`. */
function unsupportedTypeScript(version) {
    return Number.parseInt(version ?? "", 10) >= 7 ? version : undefined;
}
/** The refusal both commands report (exit code 2), without a trailing newline. */
function unsupportedTypeScriptMessage(version) {
    return `@wcstack/typescript runs on TypeScript 5 or 6, and the project has TypeScript ${version}, which has no JavaScript compiler API: npm i -D typescript@6`;
}

var version = "4.32.0";
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
 * exactly where the editor underlines it. The script is checked as JavaScript — what
 * the browser runs (4.26): JSDoc types count, TypeScript syntax is an error (TS8010…),
 * and the plugin's `// @ts-check` turns the check on whatever `checkJs` says. The mechanism is vue-tsc's:
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
 *                        (`include` covering `**\/*.html`, a `target` / `lib` of ES2015 or
 *                        later), run with a temporary config that extends it and adds
 *                        them, instead of only warning. (`noImplicitThis`, `allowJs` and
 *                        `checkJs` are not needed since 4.26: the script is JavaScript,
 *                        whose `this` is typed without `noImplicitThis`, and the plugin
 *                        turns the check on itself.)
 *
 * Peers: `typescript` (required, 5 or 6 — TypeScript 7 has no lib/tsc.js, see
 * typescriptSupport.ts), `@volar/typescript` + `@volar/language-core` (optional —
 * only this command needs them). Resolved from the project first, then from this
 * package's own location.
 *
 * Exit codes: tsc's own (0 clean / 1 type errors / 2 usage) — plus 2 when the peers
 * are missing or unsupported, or the arguments are invalid.
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
/** Without the plugin's parser: a `<wcs-state>` start tag followed by a `<script` before its end tag. */
const roughInlineStateTest = (html) => /<wcs-state\b[^>]*>(?:(?!<\/wcs-state\s*>)[\s\S])*?<script\b/i.test(html);
/**
 * Whether an `include` pattern reaches `.html`, read as tsc reads it: a last segment with
 * neither an extension nor a wildcard names a directory (`src` is `src/**\/*`), a trailing
 * wildcard (`**\/*`, `src/*`) takes every supported extension — `.html` among them under
 * wcs-tsc — and any other pattern names its own extension.
 */
function includeCoversHtml(pattern) {
    const last = pattern.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? "";
    if (/\.html?$/.test(last))
        return true;
    if (/[*?]/.test(last))
        return last.endsWith("*");
    return last === "." || last === ".." || !last.includes(".");
}
/**
 * Check the project tsconfig for what the HTML check needs:
 * - when there are pages with an inline `<wcs-state>` script under the config's directory (and not
 *   excluded), at least one of them is in the program — `include: ["src"]` covers `src/**\/*.html` but not
 *   a page beside the tsconfig, so the patterns alone cannot tell; the left-out pages are named. A config
 *   that checks some pages and leaves others out (vendored docs, fixtures) chose to: it is not reported;
 * - failing that, `include` reaches `.html` at all (a page may live outside the config's directory), and a
 *   `files`-only config never sees HTML;
 * - a `target` / `lib` of ES2015 or later.
 */
function auditConfig(configPath, ts, hasInlineState = roughInlineStateTest) {
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    const config = (read.config ?? {});
    const basePath = toPosix(dirname(configPath));
    const extensions = htmlExtensions(ts);
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, basePath, undefined, toPosix(configPath), undefined, extensions);
    const options = parsed.options;
    const missing = [];
    const include = Array.isArray(config.include) ? config.include : undefined;
    // every file the config would see with `include: ["**/*"]` (its `exclude` kept), minus what it does see
    const { files: _files, include: _include, ...rest } = config;
    const everything = ts.parseJsonConfigFileContent({ ...rest, include: ["**/*"] }, ts.sys, basePath, undefined, toPosix(configPath), undefined, extensions);
    const isPage = (file) => /\.html?$/i.test(file) && hasInlineState(ts.sys.readFile(file) ?? "");
    const inProgram = new Set(parsed.fileNames);
    const pagesInProgram = parsed.fileNames.filter(isPage).length;
    const leftOut = everything.fileNames.filter((file) => !inProgram.has(file) && isPage(file));
    if (pagesInProgram === 0 && leftOut.length > 0) {
        missing.push(`include: "**/*.html" (no page with an inline <wcs-state> is in the program: ${describePages(leftOut, basePath)} ${leftOut.length === 1 ? "is" : "are"} not)`);
    }
    else if (include !== undefined && !include.some(includeCoversHtml))
        missing.push('include: "**/*.html"');
    else if (include === undefined && Array.isArray(config.files))
        missing.push('include: "**/*.html" (a files-only config never sees HTML)');
    // noImplicitThis / allowJs / checkJs are not needed (4.26): the inline script is checked as
    // JavaScript, where TypeScript types an object literal's `this` from ThisType<> without
    // noImplicitThis, the `.html` file is in the program through the plugin's extension (not allowJs),
    // and the plugin's `// @ts-check` turns the check on.
    // With neither target nor lib, tsc's ES5 default lib has no Map / Set / Promise:
    // the preamble's `_WcsThis<T>` degrades silently and `this.typo` stops being an error.
    const target = options.target;
    const needsTarget = options.lib === undefined && (target === undefined || target < ts.ScriptTarget.ES2015);
    if (needsTarget)
        missing.push('compilerOptions.target: "ES2015" or later (the this-typing preamble uses Map / Set / Promise)');
    return { missing, include, compilerOptions: config.compilerOptions ?? {}, needsTarget, pagesInProgram, leftOut };
}
/** `.html` / `.htm` as the plugin registers them, so tsc's file matching takes them (as wcs-tsc's runTsc does). */
function htmlExtensions(ts) {
    return ["html", "htm"].map((extension) => ({ extension, isMixedContent: true, scriptKind: ts.ScriptKind.Deferred }));
}
/** `counter.html, admin/a.html, … and 3 more` (relative to the config's directory). */
function describePages(files, basePath) {
    const names = files.map((file) => posixRelative(basePath, file));
    const shown = names.slice(0, 3).join(", ");
    return names.length > 3 ? `${shown} and ${names.length - 3} more` : shown;
}
function posixRelative(from, to) {
    return toPosix(relative(from, to));
}
/** Write a temporary config next to the project one that extends it with the missing pieces. */
function writeDefaultsConfig(configPath, audit) {
    const dir = dirname(configPath);
    const tempPath = join(dir, `.wcs-tsc.${process.pid}.tsconfig.json`);
    const include = audit.include !== undefined ? [...audit.include, "**/*.html"] : ["**/*", "**/*.html"];
    const config = {
        extends: `./${basename(configPath)}`,
        // only when the project set neither target nor lib — never override an explicit choice
        ...(audit.needsTarget ? { compilerOptions: { target: "ESNext" } } : {}),
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
    // TypeScript 7 resolves as `typescript` but has no lib/tsc.js: name it rather than say typescript is missing.
    const tsPackagePath = deps.resolve("typescript/package.json", cwd);
    const unsupported = tsPackagePath === undefined
        ? undefined
        : unsupportedTypeScript(deps.load(tsPackagePath).version);
    if (unsupported !== undefined) {
        io.stderr(`wcs-tsc: ${unsupportedTypeScriptMessage(unsupported)}\n`);
        return 2;
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
    const ts = deps.load(tsApiPath);
    const core = deps.load(corePath);
    const { createWcsLanguagePlugin, parseWcsScriptBlocks } = core;
    const tscArgs = [...args.tscArgs];
    const temporaries = [];
    const project = findProjectConfig(tscArgs, cwd);
    if (project !== undefined && existsSync(project.path)) {
        // the plugin's own reading of a page (a tsc-core.cjs older than 4.26 has no parser to hand out)
        /* v8 ignore next */
        const hasInlineState = parseWcsScriptBlocks !== undefined ? (html) => parseWcsScriptBlocks(html, "wcs-state").length > 0 : roughInlineStateTest;
        const audit = auditConfig(project.path, ts, hasInlineState);
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
                // "warning:" — a CI log filter that keeps error / warning lines keeps this one (the exit code stays tsc's)
                io.stderr(`wcs-tsc: warning: ${project.path} is missing ${audit.missing.join(", ")} — HTML may not be checked; pass --wcs-defaults or add them\n`);
            }
        }
    }
    const declaration = args.urlImports === "any" ? writeUrlImportsDeclaration() : undefined;
    if (declaration !== undefined)
        temporaries.push(declaration);
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
        // <wcs-state> block of a page is combined into one virtual JavaScript module.
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

export { auditConfig, findProjectConfig, includeCoversHtml, main, parseTscArgs, resolveFromProject, roughInlineStateTest, writeDefaultsConfig, writeUrlImportsDeclaration };
//# sourceMappingURL=wcs-tsc.mjs.map
